import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import type { CourseSectionDto } from '@uiuc-course-search/query-types';
import {
  makeCourseId,
  type Course,
  type Section
} from '../db/index.js';
import { getUpstreamBackoff } from '../services/upstream-backoff.js';
import { parseCourseDetailXml, convertTo24Hour } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';
import { formatInstructorName, formatInstructors } from '../transforms/course.js';
import {
  toCourseDto,
  toCourseSectionDto,
  toInstructorLinkMap,
} from '../dto/course.js';
import { resolveTermContext } from '../services/term-state.js';
import { parseBoundedIntParam, parseCourseNumberParam, parseEnumParam, parseSubjectParam } from '../http/params.js';
import { errorFields, logger } from '../observability/logger.js';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;

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
      `).bind(termId, subject, number).all();

      const linksMap = toInstructorLinkMap(instructorLinks.results);

      // Enrich sections with instructor stats
      const enrichedSections = sections.results.map(section => {
        const names = section.instructor ? section.instructor.split(';').map(s => s.trim()).filter(Boolean) : [];
        const stats = names.map(name => linksMap[name]).filter(Boolean);
        const primaryStats = stats[0];

        return toCourseSectionDto({
          ...section,
          instructor_stats: stats,
          instructor_rmp: primaryStats?.rmp_rating ?? section.instructor_rmp,
          instructor_gpa: primaryStats?.avg_gpa ?? section.instructor_gpa
        });
      });

      return c.json(toCourseDto(existing, {
        sections: enrichedSections,
        instructorLinks: linksMap,
        cached: true,
        ageSeconds: existing.age_seconds,
        termStatus: resolvedTerm.status,
      }), 200, {
        'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
        'X-Cache': 'HIT'
      });
    }
  }

  // Check rate limiter
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
      `).bind(termId, subject, number).all();

      const linksMap = toInstructorLinkMap(instructorLinks.results);

      // Enrich sections with instructor stats
      const enrichedSections = sections.results.map(section => {
        const names = section.instructor ? section.instructor.split(';').map(s => s.trim()).filter(Boolean) : [];
        const stats = names.map(name => linksMap[name]).filter(Boolean);
        const primaryStats = stats[0];

        return toCourseSectionDto({
          ...section,
          instructor_stats: stats,
          instructor_rmp: primaryStats?.rmp_rating ?? section.instructor_rmp,
          instructor_gpa: primaryStats?.avg_gpa ?? section.instructor_gpa
        });
      });

      return c.json(toCourseDto(existing, {
        sections: enrichedSections,
        instructorLinks: linksMap,
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
      if (upstreamBackoff.isRateLimited(response.status)) {
        upstreamBackoff.recordFailure(`${subject} ${number}: ${response.status}`, response.status);
      }
      return c.json({ error: `Course not found: ${response.status}` }, 404);
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

    const sectionResults: CourseSectionDto[] = [];
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

      // Keep section-level summary stats aligned with the first instructor that has data.
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

      sectionResults.push({
        crn: section.crn,
        sectionNumber: section.sectionNumber || '?',
        status: section.enrollmentStatus || 'Unknown',
        type: firstMeeting?.type || '?',
        days: firstMeeting?.daysOfTheWeek,
        startTime: convertTo24Hour(firstMeeting?.start || '') || null,
        endTime: convertTo24Hour(firstMeeting?.end || '') || null,
        location: firstMeeting ? `${firstMeeting.buildingName} ${firstMeeting.roomNumber}`.trim() || 'TBA' : 'TBA',
        instructor: instructorName || 'TBA',
        instructorRmp,
        instructorGpa,
        instructorStats: []
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
    `).bind(termId, subject, number).all();

    const linksMap = toInstructorLinkMap(instructorLinksResult.results);
    const sectionsWithStats = sectionResults.map(section => {
      const names = section.instructor.split(';').map(s => s.trim()).filter(Boolean);
      const stats = names.map(name => linksMap[name]).filter(Boolean);
      const primaryStats = stats[0];

      return {
        ...section,
        instructorStats: stats,
        instructorRmp: primaryStats?.rmp_rating ?? section.instructorRmp,
        instructorGpa: primaryStats?.avg_gpa ?? section.instructorGpa,
      };
    });

    return c.json(toCourseDto({
      id: courseId,
      subject,
      number,
      title: parsed.label,
      description: parsed.description,
      credit_hours: creditHours,
      gened: parsed.genEdCategories[0]?.id ?? null,
      year: resolvedTerm.year,
      term,
      primary_instructor: primaryInstructorName,
      quality_score: null,
      difficulty_score: null,
    }, {
      sections: sectionsWithStats,
      instructorLinks: linksMap,
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
