import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import {
  makeCourseId,
  makeTermId,
  upsertCourse,
  upsertSection,
  upsertInstructor,
  upsertMeeting,
  prepareLinkMeetingInstructorByKeys,
  type Course,
  type Section
} from '../db/index.js';
import { CISAPIClient } from '../cisapi/client.js';
import { getRateLimiter } from '../services/rate-limiter.js';
import { parseCourseDetailXml, convertTo24Hour } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';
import { formatInstructorName, formatInstructors } from '../transforms/course.js';

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

// Test endpoint to fetch subjects from CISAPI
courseRoutes.get('/test/subjects', async (c) => {
  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const subjects = await client.getSubjects();
    return c.json({
      count: subjects.length,
      sample: subjects.slice(0, 5)
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Test endpoint to fetch a single course
courseRoutes.get('/test/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();

  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const course = await client.getCourseDetail(subject, number);
    return c.json(course);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Fresh fetch for a single course (bypasses cache on request, updates DB, returns live data)
courseRoutes.get('/api/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();
  const year = c.req.query('year') || c.env.CURRENT_YEAR;
  const term = c.req.query('term') || c.env.CURRENT_TERM;

  const cacheHeader = c.req.header('Cache-Control');
  const bypassCache = cacheHeader?.includes('no-cache') || c.req.query('fresh') === 'true';

  const cacheTtl = parseInt(c.env.CLIENT_CACHE_TTL_MS) || 30000;
  const courseId = makeCourseId(subject, number, parseInt(year), term);

  // If not bypassing cache, check if we have recent data
  if (!bypassCache) {
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing && existing.age_seconds * 1000 < cacheTtl) {
      const sections = await c.env.DB.prepare(
        'SELECT * FROM sections WHERE course_id = ?'
      ).bind(courseId).all<Section>();

      const instructorLinks = await c.env.DB.prepare(`
        SELECT
          l.instructor_name,
          r.rating as rmp_rating,
          r.difficulty as rmp_difficulty,
          r.rmp_id,
          g.avg_gpa,
          g.sample_size as gpa_sample_size
        FROM instructor_course_links l
        LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id
        LEFT JOIN gpa_stats g ON l.gpa_id = g.id
        WHERE l.term_id = ? AND l.subject = ? AND l.number = ?
      `).bind(makeTermId(parseInt(year), term), subject, number).all();

      const linksMap = Object.fromEntries(
        instructorLinks.results.map(r => [r.instructor_name, r])
      );

      // Enrich sections with instructor stats
      const enrichedSections = sections.results.map(section => {
        const names = section.instructor ? section.instructor.split(';').map(s => s.trim()).filter(Boolean) : [];
        const stats = names.map(name => linksMap[name]).filter(Boolean);
        const primaryStats = stats[0];

        return {
          ...section,
          instructor_stats: stats,
          instructor_rmp: primaryStats?.rmp_rating || section.instructor_rmp,
          instructor_gpa: primaryStats?.avg_gpa || section.instructor_gpa
        };
      });

      return c.json({
        ...existing,
        sections: enrichedSections,
        instructor_links: linksMap,
        _cached: true,
        _age_seconds: existing.age_seconds
      }, 200, {
        'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
        'X-Cache': 'HIT'
      });
    }
  }

  // Check rate limiter
  const rateLimiter = getRateLimiter({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = rateLimiter.getState();
  if (state.isBackingOff) {
    // Return stale data with warning if available
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing) {
      const sections = await c.env.DB.prepare(
        'SELECT * FROM sections WHERE course_id = ?'
      ).bind(courseId).all<Section>();

      const instructorLinks = await c.env.DB.prepare(`
        SELECT
          l.instructor_name,
          r.rating as rmp_rating,
          r.difficulty as rmp_difficulty,
          r.rmp_id,
          g.avg_gpa,
          g.sample_size as gpa_sample_size
        FROM instructor_course_links l
        LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id
        LEFT JOIN gpa_stats g ON l.gpa_id = g.id
        WHERE l.term_id = ? AND l.subject = ? AND l.number = ?
      `).bind(makeTermId(parseInt(year), term), subject, number).all();

      const linksMap = Object.fromEntries(
        instructorLinks.results.map(r => [r.instructor_name, r])
      );

      // Enrich sections with instructor stats
      const enrichedSections = sections.results.map(section => {
        const names = section.instructor ? section.instructor.split(';').map(s => s.trim()).filter(Boolean) : [];
        const stats = names.map(name => linksMap[name]).filter(Boolean);
        const primaryStats = stats[0];

        return {
          ...section,
          instructor_stats: stats,
          instructor_rmp: primaryStats?.rmp_rating || section.instructor_rmp,
          instructor_gpa: primaryStats?.avg_gpa || section.instructor_gpa
        };
      });

      return c.json({
        ...existing,
        sections: enrichedSections,
        instructor_links: linksMap,
        _stale: true,
        _stale_reason: rateLimiter.getErrorMessage(),
        _age_seconds: existing.age_seconds
      }, 200, {
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
    await rateLimiter.waitIfNeeded();

    const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}/${subject}/${number}.xml?mode=cascade`;
    const response = await browserFetch(url);

    if (!response.ok) {
      if (rateLimiter.isRateLimited(response.status)) {
        rateLimiter.recordFailure(`${subject} ${number}: ${response.status}`, response.status);
      }
      return c.json({ error: `Course not found: ${response.status}` }, 404);
    }

    rateLimiter.recordSuccess();

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
    const creditHours = parseInt(parsed.creditHours) || null;

    // Get all unique instructors for the course (prefer lectures)
    const allInstructors = new Set<string>();
    const lectureInstructors = new Set<string>();

    parsed.sections.forEach(s => {
      const isLecture = s.meetings.some(m => m.typeCode === 'LEC' || m.type === 'Lecture');
      s.meetings.forEach(m => {
        m.instructors.forEach(inst => {
          const name = formatInstructorName(inst);
          if (name) {
            allInstructors.add(name);
            if (isLecture) lectureInstructors.add(name);
          }
        });
      });
    });

    const primaryInstructorName = lectureInstructors.size > 0
      ? formatInstructors(Array.from(lectureInstructors))
      : formatInstructors(Array.from(allInstructors));

    // Upsert course
    await upsertCourse(c.env.DB, {
      id: courseId,
      subject,
      number,
      title: parsed.label,
      description: parsed.description || null,
      credit_hours: creditHours,
      gened: parsed.genEdCategories[0]?.id ?? null,
      year: parseInt(year),
      term,
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: primaryInstructorName,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      subject_id: null,
      course_info: parsed.courseSectionInformation || null,
      degree_attributes: parsed.sectionDegreeAttributes || null,
      class_schedule_info: parsed.classScheduleInformation || null,
      date_range_text: parsed.sectionDateRange || null,
      registration_notes: parsed.sectionRegistrationNotes || null,
      approval_code: parsed.sectionApprovalCode || null,
      last_synced: now
    });

    // Upsert sections
    const sectionResults = [];
    for (const section of parsed.sections) {
      const sectionInstructors = new Set<string>();
      section.meetings.forEach(m => {
        m.instructors.forEach(inst => {
          const name = formatInstructorName(inst);
          if (name) sectionInstructors.add(name);
        });
      });

      const instructorName = formatInstructors(Array.from(sectionInstructors));

      let instructorRmp = null;
      let instructorGpa = null;

      // For backward compatibility fields, use stats from the first instructor that has them
      for (const name of sectionInstructors) {
        const stats = await c.env.DB.prepare(
          'SELECT rmp_rating, avg_gpa FROM instructors WHERE display_name = ?'
        ).bind(name).first<{ rmp_rating: number; avg_gpa: number }>();

        if (stats && (stats.rmp_rating || stats.avg_gpa)) {
          instructorRmp = stats.rmp_rating;
          instructorGpa = stats.avg_gpa;
          break;
        }
      }

      const firstMeeting = section.meetings[0];

      await upsertSection(c.env.DB, {
        crn: section.crn,
        course_id: courseId,
        section_number: section.sectionNumber || null,
        status: section.enrollmentStatus || null,
        type: firstMeeting?.type || null,
        days: firstMeeting?.daysOfTheWeek || null,
        start_time: convertTo24Hour(firstMeeting?.start || '') || null,
        end_time: convertTo24Hour(firstMeeting?.end || '') || null,
        location: firstMeeting ? `${firstMeeting.buildingName} ${firstMeeting.roomNumber}`.trim() || null : null,
        instructor: instructorName,
        instructor_rmp: instructorRmp,
        instructor_gpa: instructorGpa,
        last_synced: now,
        section_title: section.sectionTitle || null,
        status_code: section.statusCode || null,
        section_status_code: section.sectionStatusCode || null,
        section_text: section.sectionText || null,
        section_notes: section.sectionNotes || null,
        capp_area: section.sectionCappArea || null,
        date_range_text: section.sectionDateRange || null,
        part_of_term: section.partOfTerm || null,
        start_date: section.startDate || null,
        end_date: section.endDate || null,
        credit_hours: section.creditHours || null
      });

      // Populate normalized tables
      for (let i = 0; i < section.meetings.length; i++) {
        const m = section.meetings[i];
        const meetingId = await upsertMeeting(c.env.DB, {
          section_crn: section.crn,
          meeting_index: i,
          type_code: m.typeCode || null,
          type_name: m.type || null,
          days: m.daysOfTheWeek || null,
          start_time: convertTo24Hour(m.start || '') || null,
          end_time: convertTo24Hour(m.end || '') || null,
          building_name: m.buildingName || null,
          room_number: m.roomNumber || null,
          date_range_text: m.meetingDateRange || null
        });

        for (const inst of m.instructors) {
          await upsertInstructor(c.env.DB, {
            first_name: inst.firstName || null,
            last_name: inst.lastName,
            display_name: formatInstructorName(inst) || inst.lastName,
            rmp_rating: null,
            rmp_difficulty: null,
            avg_gpa: null,
            gpa_sample_size: null
          });

          await prepareLinkMeetingInstructorByKeys(
            c.env.DB,
            section.crn,
            i,
            inst.lastName,
            inst.firstName || null
          ).run();
        }
      }

      sectionResults.push({
        crn: section.crn,
        sectionNumber: section.sectionNumber,
        enrollmentStatus: section.enrollmentStatus,
        type: firstMeeting?.type,
        days: firstMeeting?.daysOfTheWeek,
        startTime: convertTo24Hour(firstMeeting?.start || '') || null,
        endTime: convertTo24Hour(firstMeeting?.end || '') || null,
        location: firstMeeting ? `${firstMeeting.buildingName} ${firstMeeting.roomNumber}`.trim() || null : null,
        instructor: instructorName,
        instructor_rmp: instructorRmp,
        instructor_gpa: instructorGpa
      });
    }

    // Fetch instructor links for this course context
    const instructorLinksResult = await c.env.DB.prepare(`
      SELECT
        l.instructor_name,
        r.rating as rmp_rating,
        r.difficulty as rmp_difficulty,
        r.rmp_id,
        g.avg_gpa,
        g.sample_size as gpa_sample_size
      FROM instructor_course_links l
      LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id
      LEFT JOIN gpa_stats g ON l.gpa_id = g.id
      WHERE l.term_id = ? AND l.subject = ? AND l.number = ?
    `).bind(makeTermId(parseInt(year), term), subject, number).all();

    const linksMap = Object.fromEntries(
      instructorLinksResult.results.map(r => [r.instructor_name, r])
    );

    return c.json({
      id: courseId,
      subject,
      number,
      title: parsed.label,
      description: parsed.description,
      credit_hours: creditHours,
      gened: parsed.genEdCategories[0]?.id ?? null,
      year: parseInt(year),
      term,
      primary_instructor: primaryInstructorName,
      sections: sectionResults,
      instructor_links: linksMap,
      _cached: false,
      _fetched_at: now
    }, 200, {
      'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
      'X-Cache': 'MISS'
    });

  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500);
  }
});
