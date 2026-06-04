import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import type { CourseGenedDto, InstructorLinkDto } from '@uiuc-course-search/query-types';
import { makeCourseId } from '../db/ids.js';
import type { Course, Meeting, Section } from '../db/types.js';
import { getUpstreamBackoff } from '../services/upstream-backoff.js';
import { parseCourseDetailXml } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromCourseDetail } from '../transforms/course.js';
import {
  courseSnapshotToCourseDto,
  toCourseDto,
  toCourseSectionDto,
  toInstructorLinkMap,
} from '../dto/course.js';
import { resolveTermContext } from '../services/term-state.js';
import { canonicalGenedCode } from '../services/gened-codes.js';
import { parseBoundedIntParam, parseCourseNumberParam, parseEnumParam, parseSubjectParam } from '../http/params.js';
import { errorFields, logger } from '../observability/logger.js';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;

function firstInstructorMetric(
  linksMap: Record<string, InstructorLinkDto>,
  metric: keyof Pick<InstructorLinkDto, 'rmp_rating' | 'avg_gpa' | 'median_gpa' | 'gpa_sample_size'>
): number | null {
  const link = Object.values(linksMap).find((entry) => typeof entry[metric] === 'number');
  return link?.[metric] ?? null;
}

type MeetingRow = Meeting & {
  instructor_names: string | null;
};

type SectionWithDetails = Section & {
  instructor_stats?: InstructorLinkDto[];
  meetings?: Array<Meeting & { instructor_names?: string | null; instructor_stats?: InstructorLinkDto[] }>;
};

async function loadInstructorLinks(
  db: D1Database,
  termId: string,
  subject: string,
  number: string
): Promise<Record<string, InstructorLinkDto>> {
  const instructorLinks = await db.prepare(`
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
  `).bind(termId, subject, number).all();

  return toInstructorLinkMap(instructorLinks.results);
}

async function loadCourseMedianGpa(
  db: D1Database,
  subject: string,
  number: string
): Promise<number | null> {
  const direct = await db.prepare(`
    SELECT median_gpa
    FROM gpa_stats
    WHERE subject = ? AND number = ? AND instructor IS NULL
    LIMIT 1
  `).bind(subject, number).first<{ median_gpa: number | null }>();
  if (typeof direct?.median_gpa === 'number') {
    return direct.median_gpa;
  }

  const aggregate = await db.prepare(`
    SELECT AVG(median_gpa) as median_gpa
    FROM gpa_stats
    WHERE subject = ? AND number = ? AND median_gpa IS NOT NULL
  `).bind(subject, number).first<{ median_gpa: number | null }>();
  return aggregate?.median_gpa ?? null;
}

async function loadCourseGeneds(db: D1Database, courseId: string): Promise<CourseGenedDto[]> {
  const rows = await db.prepare(`
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

function sectionInstructorStats(
  section: Pick<Section, 'instructor'>,
  linksMap: Record<string, InstructorLinkDto>
): InstructorLinkDto[] {
  const names = section.instructor
    ? section.instructor.split(';').map(s => s.trim()).filter(Boolean)
    : [];
  return names.map(name => linksMap[name]).filter(Boolean);
}

async function loadSectionsWithDetails(
  db: D1Database,
  courseId: string,
  linksMap: Record<string, InstructorLinkDto>
): Promise<ReturnType<typeof toCourseSectionDto>[]> {
  const sections = await db.prepare(
    'SELECT * FROM sections WHERE course_id = ? ORDER BY section_number, crn'
  ).bind(courseId).all<Section>();

  if (sections.results.length === 0) {
    return [];
  }

  const sectionIds = sections.results.map(section => section.id);
  const placeholders = sectionIds.map(() => '?').join(',');
  const meetings = await db.prepare(`
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

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;

  // API endpoints
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;

  // Rate limiting
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;

  // Caching
  CLIENT_CACHE_TTL_MS: string;
};

export const courseRoutes = new Hono<{ Bindings: Bindings }>();

// Fresh fetch for a single course returns live CISAPI data without mutating canonical DB tables.
courseRoutes.get('/api/course/:subject/:number', async (c) => {
  const { subject: rawSubject, number: rawNumber } = c.req.param();
  const parsedSubject = parseSubjectParam(rawSubject);
  if (!parsedSubject.ok) return c.json({ error: parsedSubject.error }, 400);

  const parsedNumber = parseCourseNumberParam(rawNumber);
  if (!parsedNumber.ok) return c.json({ error: parsedNumber.error }, 400);

  const requestedYear = c.req.query('year');
  const requestedTerm = c.req.query('term');
  if ((requestedYear && !requestedTerm) || (!requestedYear && requestedTerm)) {
    return c.json({ error: 'year and term must be provided together' }, 400);
  }

  if (requestedYear) {
    const parsedYear = parseBoundedIntParam(requestedYear, 'year', { min: 2004, max: new Date().getFullYear() + 2 });
    if (!parsedYear.ok) return c.json({ error: parsedYear.error }, 400);
  }

  if (requestedTerm) {
    const parsedTerm = parseEnumParam(requestedTerm, 'term', TERMS);
    if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);
  }

  const subject = parsedSubject.value;
  const number = parsedNumber.value;
  const resolvedTerm = await resolveTermContext(c.env.DB, {
    requestedYear,
    requestedTerm,
    fallbackYear: c.env.CURRENT_YEAR,
    fallbackTerm: c.env.CURRENT_TERM,
  });
  const year = String(resolvedTerm.year);
  const term = resolvedTerm.term;

  const cacheHeader = c.req.header('Cache-Control');
  const bypassCache = cacheHeader?.includes('no-cache') || c.req.query('fresh') === 'true';

  const cacheTtl = parseInt(c.env.CLIENT_CACHE_TTL_MS) || 30000;
  const termId = resolvedTerm.termId;
  const courseId = makeCourseId(subject, number, resolvedTerm.year, term);

  // If not bypassing cache, check if we have recent data
  if (!bypassCache) {
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing && existing.age_seconds * 1000 < cacheTtl) {
      const linksMap = await loadInstructorLinks(c.env.DB, termId, subject, number);
      const [enrichedSections, medianGpa, geneds] = await Promise.all([
        loadSectionsWithDetails(c.env.DB, courseId, linksMap),
        loadCourseMedianGpa(c.env.DB, subject, number),
        loadCourseGeneds(c.env.DB, courseId),
      ]);

      return c.json(toCourseDto(existing, {
        sections: enrichedSections,
        instructorLinks: linksMap,
        geneds,
        medianGpa,
        cached: true,
        ageSeconds: existing.age_seconds,
        termStatus: resolvedTerm.status,
      }), 200, {
        'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
        'X-Cache': 'HIT'
      });
    }
  }

  // Check upstream backoff before live CISAPI fetches.
  const upstreamBackoff = getUpstreamBackoff({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = upstreamBackoff.getState();
  if (state.isBackingOff) {
    // Return stale data with warning if available
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing) {
      const linksMap = await loadInstructorLinks(c.env.DB, termId, subject, number);
      const [enrichedSections, medianGpa, geneds] = await Promise.all([
        loadSectionsWithDetails(c.env.DB, courseId, linksMap),
        loadCourseMedianGpa(c.env.DB, subject, number),
        loadCourseGeneds(c.env.DB, courseId),
      ]);

      return c.json(toCourseDto(existing, {
        sections: enrichedSections,
        instructorLinks: linksMap,
        geneds,
        medianGpa,
        stale: true,
        staleReason: upstreamBackoff.getErrorMessage(),
        ageSeconds: existing.age_seconds,
        termStatus: resolvedTerm.status,
      }), 200, {
        'X-Cache': 'STALE',
        'X-Stale-Reason': 'rate-limited'
      });
    }

    return c.json({
      error: 'Rate limited and no cached data available',
      retryAfter: state.backoffUntil ? Math.ceil((state.backoffUntil - Date.now()) / 1000) : null
    }, 503);
  }

  // Fetch fresh data
  try {
    await upstreamBackoff.waitIfNeeded();

    const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}/${subject}/${number}.xml?mode=cascade`;
    const response = await browserFetch(url);

    if (!response.ok) {
      const shouldUseStale = upstreamBackoff.isRateLimited(response.status) || response.status >= 500;
      if (shouldUseStale) {
        upstreamBackoff.recordFailure(`${subject} ${number}: ${response.status}`, response.status);
        const existing = await c.env.DB.prepare(
          'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
        ).bind(courseId).first<Course & { age_seconds: number }>();

        if (existing) {
          const linksMap = await loadInstructorLinks(c.env.DB, termId, subject, number);
          const [enrichedSections, medianGpa, geneds] = await Promise.all([
            loadSectionsWithDetails(c.env.DB, courseId, linksMap),
            loadCourseMedianGpa(c.env.DB, subject, number),
            loadCourseGeneds(c.env.DB, courseId),
          ]);

          return c.json(toCourseDto(existing, {
            sections: enrichedSections,
            instructorLinks: linksMap,
            geneds,
            medianGpa,
            stale: true,
            staleReason: `upstream returned ${response.status}`,
            ageSeconds: existing.age_seconds,
            termStatus: resolvedTerm.status,
          }), 200, {
            'X-Cache': 'STALE',
            'X-Stale-Reason': 'upstream-unavailable'
          });
        }

        return c.json({
          error: 'Upstream course data unavailable',
          upstreamStatus: response.status,
        }, response.status === 429 || response.status === 503 ? 503 : 502);
      }

      if (response.status === 404) {
        return c.json({ error: 'Course not found' }, 404);
      }

      return c.json({
        error: 'Upstream course data unavailable',
        upstreamStatus: response.status,
      }, 502);
    }

    upstreamBackoff.recordSuccess();

    const xml = await response.text();

    // Check for HTML error page
    if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
      return c.json({ error: 'Course not found' }, 404);
    }

    const parsed = parseCourseDetailXml(xml);

    if (!parsed) {
      return c.json({ error: 'Failed to parse course data' }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const snapshot = fromCourseDetail(parsed, subject, number, resolvedTerm.year, term, {
      syncTimestamp: now,
    });
    const linksMap = await loadInstructorLinks(c.env.DB, termId, subject, number);

    const existingMetadata = await c.env.DB.prepare(`
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
    const medianGpa = await loadCourseMedianGpa(c.env.DB, subject, number);

    return c.json(courseSnapshotToCourseDto({
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
      fetchedAt: now,
      termStatus: resolvedTerm.status,
    }), 200, {
      'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
      'X-Cache': 'MISS'
    });

  } catch (error) {
    logger.error('route.course.failed', { subject, number, ...errorFields(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});
