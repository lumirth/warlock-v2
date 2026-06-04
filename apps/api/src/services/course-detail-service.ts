import type { D1Database } from '@cloudflare/workers-types';
import type { CourseDto, CourseGenedDto, InstructorLinkDto } from '@uiuc-course-search/query-types';
import type { Course, Meeting, Section } from '../db/types.js';
import { makeCourseId } from '../db/ids.js';
import { parseCourseDetailXml } from '../cisapi/parser.js';
import { courseSnapshotToCourseDto, toCourseDto, toCourseSectionDto, toInstructorLinkMap } from '../dto/course.js';
import { browserFetch } from '../http/browser-fetch.js';
import { errorFields, logger } from '../observability/logger.js';
import { fromCourseDetail } from '../transforms/course.js';
import { canonicalGenedCode } from './gened-codes.js';
import { resolveTermContext, type ResolvedTerm } from './term-state.js';
import { getUpstreamBackoff, type UpstreamBackoff } from './upstream-backoff.js';

export type CourseDetailServiceEnv = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
};

export type CourseDetailRequest = {
  subject: string;
  number: string;
  requestedYear?: string | null;
  requestedTerm?: string | null;
  bypassCache?: boolean;
};

type CourseDetailErrorBody = {
  error: string;
  retryAfter?: number | null;
  upstreamStatus?: number;
};

export type CourseDetailResponse = {
  status: 200 | 404 | 500 | 502 | 503;
  body: CourseDto | CourseDetailErrorBody;
  headers?: Record<string, string>;
};

type CourseDetailContext = {
  subject: string;
  number: string;
  resolvedTerm: ResolvedTerm;
  year: string;
  term: string;
  termId: string;
  courseId: string;
  cacheTtlMs: number;
};

type CourseWithAge = Course & {
  age_seconds: number;
};

type MeetingRow = Meeting & {
  instructor_names: string | null;
};

type SectionWithDetails = Section & {
  instructor_stats?: InstructorLinkDto[];
  meetings?: Array<Meeting & { instructor_names?: string | null; instructor_stats?: InstructorLinkDto[] }>;
};

type CourseDetailEnrichment = {
  linksMap: Record<string, InstructorLinkDto>;
  enrichedSections: ReturnType<typeof toCourseSectionDto>[];
  medianGpa: number | null;
  geneds: CourseGenedDto[];
};

type StoredDetailOptions =
  | { state: 'cached' }
  | { state: 'stale'; staleReason: string | null };

type StaleFallbackOptions = {
  staleReason: string | null;
  staleHeaderReason: string;
};

export class CourseDetailService {
  constructor(
    private readonly env: CourseDetailServiceEnv,
    private readonly nowMs: () => number = () => Date.now()
  ) {}

  async loadCourseDetail(request: CourseDetailRequest): Promise<CourseDetailResponse> {
    const context = await this.createContext(request);

    try {
      if (!request.bypassCache) {
        const cached = await this.loadStoredDetail(context, { state: 'cached' });
        if (cached) {
          return cached;
        }
      }

      const upstreamBackoff = this.createUpstreamBackoff();
      const backoffState = upstreamBackoff.getState();
      if (backoffState.isBackingOff) {
        const stale = await this.staleFallback(context, {
          staleReason: upstreamBackoff.getErrorMessage(),
          staleHeaderReason: 'rate-limited',
        });
        if (stale) return stale;

        return {
          status: 503,
          body: {
            error: 'Rate limited and no cached data available',
            retryAfter: backoffState.backoffUntil
              ? Math.ceil((backoffState.backoffUntil - this.nowMs()) / 1000)
              : null,
          },
        };
      }

      return await this.loadLiveSnapshot(context, upstreamBackoff);
    } catch (error) {
      logger.error('service.courseDetail.failed', {
        subject: context.subject,
        number: context.number,
        termId: context.termId,
        ...errorFields(error),
      });
      return { status: 500, body: { error: 'Internal server error' } };
    }
  }

  private async loadStoredDetail(
    context: CourseDetailContext,
    options: StoredDetailOptions
  ): Promise<CourseDetailResponse | null> {
    const existing = await this.loadStoredCourse(context.courseId);
    if (!existing) return null;

    if (options.state === 'cached' && existing.age_seconds * 1000 >= context.cacheTtlMs) {
      return null;
    }

    const enrichment = await this.loadEnrichment(context);
    const isStale = options.state === 'stale';

    return {
      status: 200,
      body: toCourseDto(existing, {
        sections: enrichment.enrichedSections,
        instructorLinks: enrichment.linksMap,
        geneds: enrichment.geneds,
        medianGpa: enrichment.medianGpa,
        cached: !isStale,
        stale: isStale,
        staleReason: isStale ? options.staleReason : undefined,
        ageSeconds: existing.age_seconds,
        termStatus: context.resolvedTerm.status,
      }),
      headers: isStale
        ? { 'X-Cache': 'STALE' }
        : {
          'Cache-Control': `max-age=${Math.floor(context.cacheTtlMs / 1000)}`,
          'X-Cache': 'HIT',
        },
    };
  }

  private async loadLiveSnapshot(
    context: CourseDetailContext,
    upstreamBackoff: UpstreamBackoff
  ): Promise<CourseDetailResponse> {
    await upstreamBackoff.waitIfNeeded();

    const response = await browserFetch(this.courseExplorerXmlUrl(context));
    if (!response.ok) {
      return this.handleUnsuccessfulUpstream(context, upstreamBackoff, response.status);
    }

    upstreamBackoff.recordSuccess();

    const xml = await response.text();
    if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
      return { status: 404, body: { error: 'Course not found' } };
    }

    const parsed = parseCourseDetailXml(xml);
    if (!parsed) {
      return { status: 500, body: { error: 'Failed to parse course data' } };
    }

    const nowSeconds = Math.floor(this.nowMs() / 1000);
    const snapshot = fromCourseDetail(parsed, context.subject, context.number, context.resolvedTerm.year, context.term, {
      syncTimestamp: nowSeconds,
    });
    const [linksMap, existingMetadata, medianGpa] = await Promise.all([
      this.loadInstructorLinks(context),
      this.loadExistingCourseMetadata(context.courseId),
      this.loadCourseMedianGpa(context.subject, context.number),
    ]);

    return {
      status: 200,
      body: courseSnapshotToCourseDto({
        ...snapshot,
        course: {
          ...snapshot.course,
          avg_gpa: existingMetadata?.avg_gpa ?? firstInstructorMetric(linksMap, 'avg_gpa'),
          gpa_sample_size: existingMetadata?.gpa_sample_size ?? firstInstructorMetric(linksMap, 'gpa_sample_size'),
          primary_instructor_rmp: existingMetadata?.primary_instructor_rmp ?? firstInstructorMetric(linksMap, 'rmp_rating'),
          quality_score: existingMetadata?.quality_score ?? null,
          difficulty_score: existingMetadata?.difficulty_score ?? null,
        },
      }, {
        instructorLinks: linksMap,
        medianGpa,
        cached: false,
        fetchedAt: nowSeconds,
        termStatus: context.resolvedTerm.status,
      }),
      headers: {
        'Cache-Control': `max-age=${Math.floor(context.cacheTtlMs / 1000)}`,
        'X-Cache': 'MISS',
      },
    };
  }

  private async staleFallback(
    context: CourseDetailContext,
    options: StaleFallbackOptions
  ): Promise<CourseDetailResponse | null> {
    const stale = await this.loadStoredDetail(context, {
      state: 'stale',
      staleReason: options.staleReason,
    });
    if (!stale) return null;

    return {
      ...stale,
      headers: {
        ...stale.headers,
        'X-Stale-Reason': options.staleHeaderReason,
      },
    };
  }

  private async loadEnrichment(context: CourseDetailContext): Promise<CourseDetailEnrichment> {
    const linksMap = await this.loadInstructorLinks(context);
    const [enrichedSections, medianGpa, geneds] = await Promise.all([
      this.loadSectionsWithDetails(context.courseId, linksMap),
      this.loadCourseMedianGpa(context.subject, context.number),
      this.loadCourseGeneds(context.courseId),
    ]);

    return { linksMap, enrichedSections, medianGpa, geneds };
  }

  private async createContext(request: CourseDetailRequest): Promise<CourseDetailContext> {
    const resolvedTerm = await resolveTermContext(this.env.DB, {
      requestedYear: request.requestedYear,
      requestedTerm: request.requestedTerm,
      fallbackYear: this.env.CURRENT_YEAR,
      fallbackTerm: this.env.CURRENT_TERM,
    });
    const term = resolvedTerm.term;

    return {
      subject: request.subject,
      number: request.number,
      resolvedTerm,
      year: String(resolvedTerm.year),
      term,
      termId: resolvedTerm.termId,
      courseId: makeCourseId(request.subject, request.number, resolvedTerm.year, term),
      cacheTtlMs: parseInt(this.env.CLIENT_CACHE_TTL_MS, 10) || 30000,
    };
  }

  private async handleUnsuccessfulUpstream(
    context: CourseDetailContext,
    upstreamBackoff: UpstreamBackoff,
    status: number
  ): Promise<CourseDetailResponse> {
    const shouldUseStale = upstreamBackoff.isRateLimited(status) || status >= 500;
    if (shouldUseStale) {
      upstreamBackoff.recordFailure(`${context.subject} ${context.number}: ${status}`, status);
      const stale = await this.staleFallback(context, {
        staleReason: `upstream returned ${status}`,
        staleHeaderReason: 'upstream-unavailable',
      });
      if (stale) return stale;

      return {
        status: status === 429 || status === 503 ? 503 : 502,
        body: {
          error: 'Upstream course data unavailable',
          upstreamStatus: status,
        },
      };
    }

    if (status === 404) {
      return { status: 404, body: { error: 'Course not found' } };
    }

    return {
      status: 502,
      body: {
        error: 'Upstream course data unavailable',
        upstreamStatus: status,
      },
    };
  }

  private createUpstreamBackoff(): UpstreamBackoff {
    return getUpstreamBackoff({
      backoffBaseMs: parseInt(this.env.BACKOFF_BASE_MS, 10) || 5000,
      backoffMaxMs: parseInt(this.env.BACKOFF_MAX_MS, 10) || 60000,
      maxRetries: parseInt(this.env.MAX_RETRIES, 10) || 3,
    });
  }

  private courseExplorerXmlUrl(context: CourseDetailContext): string {
    return `${this.env.CISAPI_BASE}/schedule/${context.year}/${context.term}/${context.subject}/${context.number}.xml?mode=cascade`;
  }

  private async loadStoredCourse(courseId: string): Promise<CourseWithAge | null> {
    const existing = await this.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<CourseWithAge>();
    return existing ?? null;
  }

  private async loadExistingCourseMetadata(courseId: string): Promise<Pick<Course,
    'avg_gpa'
    | 'gpa_sample_size'
    | 'primary_instructor_rmp'
    | 'quality_score'
    | 'difficulty_score'
  > | null> {
    const existingMetadata = await this.env.DB.prepare(`
      SELECT avg_gpa, gpa_sample_size, primary_instructor_rmp, quality_score, difficulty_score
      FROM courses
      WHERE id = ?
    `).bind(courseId).first<Pick<Course,
      'avg_gpa'
      | 'gpa_sample_size'
      | 'primary_instructor_rmp'
      | 'quality_score'
      | 'difficulty_score'
    >>();
    return existingMetadata ?? null;
  }

  private async loadInstructorLinks(context: CourseDetailContext): Promise<Record<string, InstructorLinkDto>> {
    const instructorLinks = await this.env.DB.prepare(`
      SELECT
        l.instructor_name,
        r.rating as rmp_rating,
        r.difficulty as rmp_difficulty,
        r.rmp_id,
        r.num_ratings,
        r.would_take_again_pct,
        r.top_tags,
        r.department,
        g.avg_gpa,
        g.median_gpa,
        g.sample_size as gpa_sample_size
      FROM instructor_course_links l
      LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id
      LEFT JOIN gpa_stats g ON l.gpa_id = g.id
      WHERE l.term_id = ? AND l.subject = ? AND l.number = ?
    `).bind(context.termId, context.subject, context.number).all();

    return toInstructorLinkMap(instructorLinks.results);
  }

  private async loadCourseMedianGpa(subject: string, number: string): Promise<number | null> {
    const direct = await this.env.DB.prepare(`
      SELECT median_gpa
      FROM gpa_stats
      WHERE subject = ? AND number = ? AND instructor IS NULL
      LIMIT 1
    `).bind(subject, number).first<{ median_gpa: number | null }>();
    if (typeof direct?.median_gpa === 'number') {
      return direct.median_gpa;
    }

    const aggregate = await this.env.DB.prepare(`
      SELECT AVG(median_gpa) as median_gpa
      FROM gpa_stats
      WHERE subject = ? AND number = ? AND median_gpa IS NOT NULL
    `).bind(subject, number).first<{ median_gpa: number | null }>();
    return aggregate?.median_gpa ?? null;
  }

  private async loadCourseGeneds(courseId: string): Promise<CourseGenedDto[]> {
    const rows = await this.env.DB.prepare(`
      SELECT category_id, category_name, attribute_code, attribute_name
      FROM course_gened
      WHERE course_id = ?
      ORDER BY category_id, attribute_code
    `).bind(courseId).all<{
      category_id: string;
      category_name: string | null;
      attribute_code: string | null;
      attribute_name: string | null;
    }>();

    return rows.results.map(row => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      attributeCode: canonicalGenedCode(row.attribute_code),
      attributeName: row.attribute_name,
    }));
  }

  private async loadSectionsWithDetails(
    courseId: string,
    linksMap: Record<string, InstructorLinkDto>
  ): Promise<ReturnType<typeof toCourseSectionDto>[]> {
    const sections = await this.env.DB.prepare(
      'SELECT * FROM sections WHERE course_id = ? ORDER BY section_number, crn'
    ).bind(courseId).all<Section>();

    if (sections.results.length === 0) {
      return [];
    }

    const sectionIds = sections.results.map(section => section.id);
    const placeholders = sectionIds.map(() => '?').join(',');
    const meetings = await this.env.DB.prepare(`
      SELECT
        m.*,
        GROUP_CONCAT(i.display_name, ';') as instructor_names
      FROM meetings m
      LEFT JOIN meeting_instructors mi ON mi.meeting_id = m.id
      LEFT JOIN instructors i ON i.id = mi.instructor_id
      WHERE m.section_id IN (${placeholders})
      GROUP BY m.id
      ORDER BY m.section_id, m.meeting_index
    `).bind(...sectionIds).all<MeetingRow>();

    const meetingsBySection = new Map<string, Array<Meeting & { instructor_names?: string | null; instructor_stats?: InstructorLinkDto[] }>>();
    for (const meeting of meetings.results) {
      const names = meeting.instructor_names
        ? meeting.instructor_names.split(';').map(name => name.trim()).filter(Boolean)
        : [];
      const instructorStats = names.map(name => linksMap[name]).filter(Boolean);
      const meetingWithStats = {
        ...meeting,
        instructor_stats: instructorStats,
      };
      const list = meetingsBySection.get(meeting.section_id) ?? [];
      list.push(meetingWithStats);
      meetingsBySection.set(meeting.section_id, list);
    }

    return sections.results.map(section => {
      const stats = sectionInstructorStats(section, linksMap);
      const primaryStats = stats[0];
      const sectionWithDetails: SectionWithDetails = {
        ...section,
        instructor_stats: stats,
        instructor_rmp: primaryStats?.rmp_rating ?? section.instructor_rmp,
        instructor_gpa: primaryStats?.avg_gpa ?? section.instructor_gpa,
        meetings: meetingsBySection.get(section.id) ?? [],
      };

      return toCourseSectionDto(sectionWithDetails);
    });
  }
}

function firstInstructorMetric(
  linksMap: Record<string, InstructorLinkDto>,
  metric: keyof Pick<InstructorLinkDto, 'rmp_rating' | 'avg_gpa' | 'median_gpa' | 'gpa_sample_size'>
): number | null {
  const link = Object.values(linksMap).find((entry) => typeof entry[metric] === 'number');
  return link?.[metric] ?? null;
}

function sectionInstructorStats(
  section: Pick<Section, 'instructor'>,
  linksMap: Record<string, InstructorLinkDto>
): InstructorLinkDto[] {
  const names = section.instructor
    ? section.instructor.split(';').map(s => s.trim()).filter(Boolean)
    : [];
  return names.map(name => linksMap[name]).filter(Boolean);
}
