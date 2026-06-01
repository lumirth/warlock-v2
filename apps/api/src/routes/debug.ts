import { Hono } from 'hono';
import type { D1Database, Fetcher, KVNamespace } from '@cloudflare/workers-types';
import { getUpstreamBackoff, resetUpstreamBackoff } from '../services/upstream-backoff.js';
import { coordinateRmpSync } from '../services/rmp-sync.js';
import { coordinateEnrichment, enrichCoursesWithGpa } from '../services/enrichment.js';
import { resolveInstructor } from '../services/matcher.js';

type Bindings = {
  DB: D1Database;
  SELF: Fetcher;
  GPA_CACHE: KVNamespace;
  CISAPI_BASE: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

// Admin routes mounted at /
export const adminRoutes = new Hono<{ Bindings: Bindings }>();

adminRoutes.post('/admin/sync/rmp', async (c) => {
  try {
    const result = await coordinateRmpSync(c.env.DB, c.env.SELF, {
      rmpAuthToken: c.env.RMP_AUTH_TOKEN,
      internalToken: c.env.INTERNAL_TOKEN,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

adminRoutes.post('/admin/sync/enrich', async (c) => {
  try {
    await enrichCoursesWithGpa(c.env.DB);
    const result = await coordinateEnrichment(c.env.DB, c.env.SELF, c.env.INTERNAL_TOKEN);
    return c.json({ success: true, message: 'Enrichment dispatched', ...result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

adminRoutes.get('/admin/upstream-backoff-status', (c) => {
  const upstreamBackoff = getUpstreamBackoff({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = upstreamBackoff.getState();
  const errorMessage = upstreamBackoff.getErrorMessage();
  const staleWarning = upstreamBackoff.getStaleDataWarning();

  return c.json({
    ...state,
    errorMessage,
    staleWarning,
  });
});

adminRoutes.post('/admin/reset-upstream-backoff', (c) => {
  resetUpstreamBackoff();
  return c.json({ message: 'Upstream backoff reset' });
});

// Debug routes mounted at /admin/debug
export const debugRoutes = new Hono<{ Bindings: Bindings }>();

debugRoutes.get('/subjects/:year/:term', async (c) => {
  const { year, term } = c.req.param();
  const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}.xml`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml' },
      redirect: 'follow'
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (!response.ok) {
      return c.json({
        error: `HTTP ${response.status}`,
        url,
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    const xml = await response.text();
    const subjectRegex = /<subject id="([^"]+)"/g;
    const subjects: string[] = [];
    let match;

    while ((match = subjectRegex.exec(xml)) !== null) {
      subjects.push(match[1]);
    }

    return c.json({
      url,
      status: response.status,
      subjectCount: subjects.length,
      subjects: subjects.slice(0, 10),
      xmlLength: xml.length,
      xmlSnippet: xml.substring(0, 500),
      headers
    });
  } catch (error) {
    return c.json({ error: String(error), url });
  }
});

/**
 * Traces the resolveInstructor logic for a specific course.
 * GET /admin/debug/link-instructor?subject=ALEC&number=115&term=spring&year=2026
 */
debugRoutes.get('/link-instructor', async (c) => {
  const subject = c.req.query('subject') || 'ALEC';
  const number = c.req.query('number') || '115';
  const term = c.req.query('term') || 'spring';
  const year = parseInt(c.req.query('year') || '2026');

  try {
    // 1. Fetch the course
    const course = await c.env.DB.prepare(`
      SELECT * FROM courses
      WHERE subject = ? AND number = ? AND term = ? AND year = ?
      LIMIT 1
    `).bind(subject, number, term, year).first();

    if (!course) {
      return c.json({ error: 'Course not found', params: { subject, number, term, year } }, 404);
    }

    const instructorName = (course as any).primary_instructor || '';
    const instructors = instructorName.split(';').map((s: string) => s.trim()).filter(Boolean);

    if (instructors.length === 0) {
      return c.json({
        course,
        instructorPattern: null,
        rawCandidates: [],
        matchResult: null,
        message: 'No primary instructor listed for this course'
      });
    }

    // Trace the first instructor
    const name = instructors[0];
    const instructorPattern = `${name}%`;

    // 2. Fetch raw candidates from gpa_stats
    const rawCandidatesResult = await c.env.DB.prepare(`
      SELECT * FROM gpa_stats
      WHERE subject = ? AND number = ? AND instructor LIKE ?
      ORDER BY sample_size DESC
    `).bind(subject, number, instructorPattern).all();

    // 3. Call resolveInstructor
    const matchResult = await resolveInstructor(c.env.DB, {
      subject,
      number,
      instructorName: name
    });

    return c.json({
      course,
      instructorPattern,
      rawCandidates: rawCandidatesResult.results,
      matchResult
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
