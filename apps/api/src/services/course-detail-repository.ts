import type { D1Database } from '@cloudflare/workers-types';
import type { InstructorLinkDto } from '@uiuc-course-search/query-types';
import type { Meeting, Section } from '../db/types.js';
import { toCourseSectionDto, toInstructorLinkMap } from '../dto/course.js';
import { canonicalRequirementCode } from './requirement-codes.js';
import type {
  CourseDetailContext,
  CourseDetailEnrichment,
  CourseDetailMetadata,
  CourseWithAge,
} from './course-detail-types.js';

type MeetingRow = Meeting & {
  instructor_names: string | null;
};

type SectionMeetingWithStats = Meeting & {
  instructor_names?: string | null;
  instructor_stats?: InstructorLinkDto[];
};

type SectionWithDetails = Section & {
  instructor_stats?: InstructorLinkDto[];
  meetings?: SectionMeetingWithStats[];
};

export class CourseDetailRepository {
  constructor(private readonly db: D1Database) {}

  async loadStoredCourse(courseId: string): Promise<CourseWithAge | null> {
    const existing = await this.db.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<CourseWithAge>();
    return existing ?? null;
  }

  async loadExistingCourseMetadata(courseId: string): Promise<CourseDetailMetadata | null> {
    const existingMetadata = await this.db.prepare(`
      SELECT avg_gpa, gpa_sample_size, primary_instructor_rmp, quality_score, difficulty_score
      FROM courses
      WHERE id = ?
    `).bind(courseId).first<CourseDetailMetadata>();
    return existingMetadata ?? null;
  }

  async loadInstructorLinks(context: CourseDetailContext): Promise<Record<string, InstructorLinkDto>> {
    const instructorLinks = await this.db.prepare(`
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

  async loadCourseMedianGpa(subject: string, number: string): Promise<number | null> {
    const direct = await this.db.prepare(`
      SELECT median_gpa
      FROM gpa_stats
      WHERE subject = ? AND number = ? AND instructor IS NULL
      LIMIT 1
    `).bind(subject, number).first<{ median_gpa: number | null }>();
    if (typeof direct?.median_gpa === 'number') {
      return direct.median_gpa;
    }

    const aggregate = await this.db.prepare(`
      SELECT AVG(median_gpa) as median_gpa
      FROM gpa_stats
      WHERE subject = ? AND number = ? AND median_gpa IS NOT NULL
    `).bind(subject, number).first<{ median_gpa: number | null }>();
    return aggregate?.median_gpa ?? null;
  }

  async loadCourseRequirements(courseId: string): Promise<CourseDetailEnrichment['requirements']> {
    const rows = await this.db.prepare(`
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
      attributeCode: canonicalRequirementCode(row.attribute_code),
      attributeName: row.attribute_name,
    }));
  }

  async loadEnrichment(context: CourseDetailContext): Promise<CourseDetailEnrichment> {
    const linksMap = await this.loadInstructorLinks(context);
    const [enrichedSections, medianGpa, requirements] = await Promise.all([
      this.loadSectionsWithDetails(context.courseId, linksMap),
      this.loadCourseMedianGpa(context.subject, context.number),
      this.loadCourseRequirements(context.courseId),
    ]);

    return { linksMap, enrichedSections, medianGpa, requirements };
  }

  async loadSectionsWithDetails(
    courseId: string,
    linksMap: Record<string, InstructorLinkDto>
  ): Promise<ReturnType<typeof toCourseSectionDto>[]> {
    const sections = await this.db.prepare(
      'SELECT * FROM sections WHERE course_id = ? ORDER BY section_number, crn'
    ).bind(courseId).all<Section>();

    if (sections.results.length === 0) {
      return [];
    }

    const sectionIds = sections.results.map(section => section.id);
    const meetingsBySection = await this.loadMeetingsBySection(sectionIds, linksMap);

    return sections.results.map(section => {
      const stats = sectionInstructorStats(section, linksMap);
      const primaryStats = stats[0];
      const sectionWithDetails: SectionWithDetails = {
        ...section,
        instructor_stats: stats,
        instructor_rmp: primaryStats?.rmpRating ?? section.instructor_rmp,
        instructor_gpa: primaryStats?.avgGpa ?? section.instructor_gpa,
        meetings: meetingsBySection.get(section.id) ?? [],
      };

      return toCourseSectionDto(sectionWithDetails);
    });
  }

  private async loadMeetingsBySection(
    sectionIds: string[],
    linksMap: Record<string, InstructorLinkDto>
  ): Promise<Map<string, SectionMeetingWithStats[]>> {
    const placeholders = sectionIds.map(() => '?').join(',');
    const meetings = await this.db.prepare(`
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

    const meetingsBySection = new Map<string, SectionMeetingWithStats[]>();
    for (const meeting of meetings.results) {
      const names = meeting.instructor_names
        ? meeting.instructor_names.split(';').map(name => name.trim()).filter(Boolean)
        : [];
      const meetingWithStats = {
        ...meeting,
        instructor_stats: names.map(name => linksMap[name]).filter(Boolean),
      };
      const list = meetingsBySection.get(meeting.section_id) ?? [];
      list.push(meetingWithStats);
      meetingsBySection.set(meeting.section_id, list);
    }

    return meetingsBySection;
  }
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
