import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { D1Database, VectorizeIndex, Ai, Fetcher, KVNamespace, RateLimit } from '@cloudflare/workers-types';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';
import { courseRoutes } from './routes/course.js';
import { feedbackRoutes } from './routes/feedback.js';
import { adminRoutes, debugRoutes } from './routes/debug.js';
import { getTermsByStatus, touchTermStateChecked } from './db/index.js';
import { getSubjectsForTerm } from './services/parallel-sync.js';
import { discoverAndClassifyTerms } from './services/term-discovery.js';
import { internalAuthHeaders, requireBearerToken } from './middleware/auth.js';

import { resumeGpaSync, resetGpaSync } from './services/gpa-sync.js';
import { enrichCoursesWithGpa, enrichCoursesWithScores, coordinateEnrichment } from './services/enrichment.js';
import { coordinateRmpSync } from './services/rmp-sync.js';
import { createRunId, errorFields, logger } from './observability/logger.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SELF: Fetcher;
  GPA_CACHE: KVNamespace;
  SEARCH_RATE_LIMITER: RateLimit;
  COURSE_RATE_LIMITER: RateLimit;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;
  SYNC_CONCURRENCY: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
  ADMIN_TOKEN?: string;
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

type PublicRateLimitBinding = 'SEARCH_RATE_LIMITER' | 'COURSE_RATE_LIMITER';
type PublicRouteClass = 'search' | 'course';

function publicRateLimit(
  bindingName: PublicRateLimitBinding,
  routeClass: PublicRouteClass
): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const outcome = await c.env[bindingName].limit({ key: `${routeClass}:${ip}` });
    if (!outcome.success) {
      return c.json({ error: 'rate limit exceeded' }, 429);
    }

    await next();
  };
}

// Enable CORS for all origins
app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['X-Search-Hints', 'Content-Type', 'Authorization'],
}));

app.use('/admin/*', requireBearerToken('ADMIN_TOKEN'));
app.use('/internal/*', requireBearerToken('INTERNAL_TOKEN'));
app.use('/api/search', publicRateLimit('SEARCH_RATE_LIMITER', 'search'));
app.use('/api/course/*', publicRateLimit('COURSE_RATE_LIMITER', 'course'));
app.use('/api/feedback', publicRateLimit('SEARCH_RATE_LIMITER', 'search'));

app.route('/', healthRoutes);
app.route('/', searchRoutes);
app.route('/', syncRoutes);
app.route('/', courseRoutes);
app.route('/', feedbackRoutes);
app.route('/', adminRoutes);
app.route('/admin/debug', debugRoutes);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Handle specific cron schedules
    const cron = event.cron;
    const runId = createRunId('cron');

    // Daily Term Discovery (4:00 AM & 4:00 PM CST)
    if (cron === "0 10,22 * * *") {
      logger.info('cron.termDiscovery.start', { runId, cron });
      ctx.waitUntil((async () => {
        try {
          const config = {
            frontendBase: env.FRONTEND_BASE,
            cisapiBase: env.CISAPI_BASE,
          };
          const classifications = await discoverAndClassifyTerms(env.DB, config);
          const active = classifications.filter(c => c.status === 'active');
          const registrable = classifications.filter(c => c.status === 'registrable');
          logger.info('cron.termDiscovery.complete', {
            runId,
            termCount: classifications.length,
            registrableTermCount: registrable.length,
            registrableTerms: registrable.map(c => c.term.termId).join(','),
            activeTermCount: active.length,
            activeTerms: active.map(c => c.term.termId).join(','),
          });
        } catch (err) {
          logger.error('cron.termDiscovery.failed', { runId, ...errorFields(err) });
        }
      })());
      return;
    }

    // Weekly GPA Reset (Sunday 2:00 AM CST / 8:00 AM UTC)
    if (cron === "0 8 * * 0") {
      logger.info('cron.weekly.start', { runId, cron });

      // 1. Reset GPA Sync
      ctx.waitUntil((async () => {
        try {
          await resetGpaSync(env.DB, env.GPA_CACHE);
          logger.info('cron.weekly.gpaReset.complete', { runId });
        } catch (err) {
          logger.error('cron.weekly.gpaReset.failed', { runId, ...errorFields(err) });
        }
      })());

      // 2. Trigger RMP Sync
      ctx.waitUntil((async () => {
        try {
          logger.info('cron.weekly.rmp.start', { runId });
          await coordinateRmpSync(env.DB, env.SELF, {
            rmpAuthToken: env.RMP_AUTH_TOKEN,
            internalToken: env.INTERNAL_TOKEN,
          });
          logger.info('cron.weekly.rmp.dispatched', { runId });
        } catch (err) {
          logger.error('cron.weekly.rmp.failed', { runId, ...errorFields(err) });
        }
      })());

      return;
    }

    // Frequent GPA Resume (Every 5 minutes)
    if (cron === "*/5 * * * *") {
      logger.info('cron.gpaResume.start', { runId, cron });
      ctx.waitUntil((async () => {
        try {
          const result = await resumeGpaSync(env.DB, env.GPA_CACHE);
          logger.info('cron.gpaResume.chunkComplete', {
            runId,
            rowsProcessed: result.rowsProcessed,
            isComplete: result.isComplete,
          });

          if (result.isComplete) {
            logger.info('cron.gpaResume.enrichment.start', { runId });
            await enrichCoursesWithGpa(env.DB);
            await enrichCoursesWithScores(env.DB);
            // Chain instructor-link enrichment after GPA scoring.
            await coordinateEnrichment(env.DB, env.SELF, env.INTERNAL_TOKEN);
            logger.info('cron.gpaResume.enrichment.dispatched', { runId });
          }
        } catch (err) {
          logger.error('cron.gpaResume.failed', { runId, ...errorFields(err) });
        }
      })());
      // Fall through to allow Fan-Out sync to run as well
    }

    // Default: Regular Course Sync (Fan-Out Mode)
    // Runs on every cron trigger that reaches here (including */5 * * * *)
    logger.info('cron.courseSync.start', { runId, cron });

    const activeTerms = [
      ...await getTermsByStatus(env.DB, 'registrable'),
      ...await getTermsByStatus(env.DB, 'active'),
    ];

    if (activeTerms.length === 0) {
      logger.info('cron.courseSync.noActiveTerms', { runId });
      return;
    }

    const config = {
      cisapiBase: env.CISAPI_BASE,
      concurrency: parseInt(env.SYNC_CONCURRENCY) || 25,
      // Limits don't apply to the coordinator fetching the list
    };

    for (const termState of activeTerms) {
      ctx.waitUntil((async () => {
        try {
          // 1. Get all subjects for the term
          logger.info('cron.courseSync.subjects.start', { runId, termId: termState.term_id });
          const allSubjects = await getSubjectsForTerm(config, termState.year, termState.term);
          logger.info('cron.courseSync.subjects.complete', {
            runId,
            termId: termState.term_id,
            subjectCount: allSubjects.length,
          });

          // 2. Chunk into batches of 40 (safe limit for free tier to avoid 50-subrequest limit)
          const BATCH_SIZE = 40;
          const batches: string[][] = [];
          for (let i = 0; i < allSubjects.length; i += BATCH_SIZE) {
            batches.push(allSubjects.slice(i, i + BATCH_SIZE));
          }

          logger.info('cron.courseSync.dispatch.start', {
            runId,
            termId: termState.term_id,
            batchCount: batches.length,
          });

          // 3. Dispatch batches via Service Binding (Fan-Out)
          const dispatchPromises = batches.map(async (batchSubjects, index) => {
            // We use the internal service binding 'SELF' to call our own API
            // We pass the URL and options directly to avoid TypeScript type mismatches with the Request object
            try {
              const response = await env.SELF.fetch('http://internal/internal/sync-batch', {
                method: 'POST',
                body: JSON.stringify({
                  year: termState.year,
                  term: termState.term,
                  subjects: batchSubjects,
                  status: termState.status,
                  totalSubjects: allSubjects.length
                }),
                headers: {
                  'Content-Type': 'application/json',
                  ...internalAuthHeaders(env.INTERNAL_TOKEN),
                }
              });

              if (!response.ok) {
                logger.error('cron.courseSync.dispatch.failed', {
                  runId,
                  termId: termState.term_id,
                  batchIndex: index,
                  responseStatus: response.status,
                });
              }
            } catch (e) {
               logger.error('cron.courseSync.dispatch.networkError', {
                 runId,
                 termId: termState.term_id,
                 batchIndex: index,
                 ...errorFields(e),
               });
            }
          });

          await Promise.all(dispatchPromises);
          logger.info('cron.courseSync.dispatch.complete', {
            runId,
            termId: termState.term_id,
            batchCount: batches.length,
          });

          await touchTermStateChecked(env.DB, termState.term_id, Math.floor(Date.now() / 1000));

        } catch (err) {
          logger.error('cron.courseSync.term.failed', {
            runId,
            termId: termState.term_id,
            ...errorFields(err),
          });
        }
      })());
    }
  }
};
