import type { D1Database } from '@cloudflare/workers-types';
import type {
  CourseGened,
  InstructorLinkReadRow,
  Section,
} from '../db/types.js';
import type {
  CourseDetailContext,
  CourseDetailEnrichment,
  CourseDetailMetadata,
  CourseDetailSectionReadModel,
  CourseWithAge,
} from './course-detail-types.js';

type MeetingRow = CourseDetailSectionReadModel['meetings'][number];

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

  async loadInstructorLinkRows(context: CourseDetailContext): Promise<InstructorLinkReadRow[]> {
    const rows = await this.db.prepare(`
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
    `).bind(context.resolvedTerm.termId, context.subject, context.number).all();

    return rows.results;
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

  async loadCourseRequirementRows(courseId: string): Promise<CourseGened[]> {
    const rows = await this.db.prepare(`
      SELECT id, course_id, category_id, category_name, attribute_code, attribute_name
      FROM course_gened
      WHERE course_id = ?
      ORDER BY category_id, attribute_code
    `).bind(courseId).all<CourseGened>();

    return rows.results;
  }

  async loadEnrichment(context: CourseDetailContext): Promise<CourseDetailEnrichment> {
    const [instructorLinkRows, sections, medianGpa, requirementRows] = await Promise.all([
      this.loadInstructorLinkRows(context),
      this.loadSectionsWithDetails(context.courseId),
      this.loadCourseMedianGpa(context.subject, context.number),
      this.loadCourseRequirementRows(context.courseId),
    ]);

    return { instructorLinkRows, sections, medianGpa, requirementRows };
  }

  async loadSectionsWithDetails(
    courseId: string,
  ): Promise<CourseDetailSectionReadModel[]> {
    const sections = await this.db.prepare(
      'SELECT * FROM sections WHERE course_id = ? ORDER BY section_number, crn'
    ).bind(courseId).all<Section>();

    if (sections.results.length === 0) {
      return [];
    }

    const sectionIds = sections.results.map(section => section.id);
    const meetingsBySection = await this.loadMeetingsBySection(sectionIds);

    return sections.results.map(section => ({
      ...section,
      meetings: meetingsBySection.get(section.id) ?? [],
    }));
  }

  private async loadMeetingsBySection(
    sectionIds: string[],
  ): Promise<Map<string, MeetingRow[]>> {
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

    const meetingsBySection = new Map<string, MeetingRow[]>();
    for (const meeting of meetings.results) {
      const list = meetingsBySection.get(meeting.section_id) ?? [];
      list.push(meeting);
      meetingsBySection.set(meeting.section_id, list);
    }

    return meetingsBySection;
  }
}
