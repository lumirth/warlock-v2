import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { makeCourseId, upsertCourse, upsertSection, type Course, type Section } from '../db/index.js';
import { CISAPIClient } from '../cisapi/client.js';
import { getRateLimiter } from '../services/rate-limiter.js';
import { parseCourseDetailXml, convertTo24Hour } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';

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

      return c.json({
        ...existing,
        sections: sections.results,
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

      return c.json({
        ...existing,
        sections: sections.results,
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

    // Get primary instructor
    const lectureSection = parsed.sections.find(s =>
      s.meetings.some(m => m.typeCode === 'LEC' || m.type === 'Lecture')
    );
    const primaryInstructor = lectureSection?.meetings[0]?.instructors[0];
    const primaryInstructorName = primaryInstructor
      ? `${primaryInstructor.lastName}${primaryInstructor.firstName ? `, ${primaryInstructor.firstName.charAt(0)}` : ''}`
      : null;

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
      last_synced: now
    });

    // Upsert sections
    const sectionResults = [];
    for (const section of parsed.sections) {
      const meeting = section.meetings[0];
      const instructorName = meeting?.instructors[0]
        ? `${meeting.instructors[0].lastName}${meeting.instructors[0].firstName ? `, ${meeting.instructors[0].firstName.charAt(0)}` : ''}`
        : null;

      await upsertSection(c.env.DB, {
        crn: section.crn,
        course_id: courseId,
        section_number: section.sectionNumber || null,
        status: section.enrollmentStatus || null,
        type: meeting?.type || null,
        days: meeting?.daysOfTheWeek || null,
        start_time: convertTo24Hour(meeting?.start || '') || null,
        end_time: convertTo24Hour(meeting?.end || '') || null,
        location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() || null : null,
        instructor: instructorName,
        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: now
      });

      sectionResults.push({
        crn: section.crn,
        sectionNumber: section.sectionNumber,
        enrollmentStatus: section.enrollmentStatus,
        type: meeting?.type,
        days: meeting?.daysOfTheWeek,
        startTime: convertTo24Hour(meeting?.start || '') || null,
        endTime: convertTo24Hour(meeting?.end || '') || null,
        location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() || null : null,
        instructor: instructorName
      });
    }

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
