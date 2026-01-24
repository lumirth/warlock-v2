import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { D1Database, VectorizeIndex, Ai, Fetcher } from '@cloudflare/workers-types';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';
import { courseRoutes } from './routes/course.js';
import { debugRoutes } from './routes/debug.js';
import { getTermsByStatus, upsertTermState, makeTermId } from './db/index.js';
import { getSubjectsForTerm } from './services/parallel-sync.js';
import { discoverAndClassifyTerms } from './services/term-discovery.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SELF: Fetcher;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;
  SYNC_INTERVAL_MS: string;
  SYNC_CONCURRENCY: string;
  TERM_CHECK_INTERVAL_MS: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for all origins
app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['X-Search-Hints', 'Content-Type', 'Authorization'],
}));

app.route('/', healthRoutes);
app.route('/', searchRoutes);
app.route('/', syncRoutes);
app.route('/', courseRoutes);
app.route('/', debugRoutes);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Handle specific cron schedules
    const cron = event.cron;

    // Daily Term Discovery (4:00 AM CST = 10:00 UTC)
    if (cron === "0 10 * * *") {
      console.log('[Cron] Starting daily term discovery...');
      ctx.waitUntil((async () => {
        try {
          const config = {
            frontendBase: env.FRONTEND_BASE,
            cisapiBase: env.CISAPI_BASE,
          };
          const classifications = await discoverAndClassifyTerms(env.DB, config);
          console.log(`[Cron] Discovery complete. Found ${classifications.length} terms.`);
          const active = classifications.filter(c => c.status === 'active');
          console.log(`[Cron] Active terms: ${active.map(c => c.term.termId).join(', ')}`);
        } catch (err) {
          console.error('[Cron] Term discovery failed:', err);
        }
      })());
      return;
    }

    // Default: Regular Course Sync (every 5 mins)
    console.log('[Cron] Starting scheduled sync (Fan-Out Mode)...');

    const activeTerms = await getTermsByStatus(env.DB, 'active');

    if (activeTerms.length === 0) {
      console.log('[Cron] No active terms to sync.');
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
          console.log(`[Cron] Fetching subject list for ${termState.term_id}...`);
          const allSubjects = await getSubjectsForTerm(config, termState.year, termState.term);
          console.log(`[Cron] Found ${allSubjects.length} subjects for ${termState.term_id}`);

          // 2. Chunk into batches of 40 (safe limit for free tier to avoid 50-subrequest limit)
          const BATCH_SIZE = 40;
          const batches: string[][] = [];
          for (let i = 0; i < allSubjects.length; i += BATCH_SIZE) {
            batches.push(allSubjects.slice(i, i + BATCH_SIZE));
          }

          console.log(`[Cron] Dispatching ${batches.length} batches...`);

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
                  subjects: batchSubjects
                }),
                headers: { 'Content-Type': 'application/json' }
              });

              if (!response.ok) {
                console.error(`[Cron] Failed to dispatch batch ${index}: HTTP ${response.status}`);
                const text = await response.text();
                console.error(`[Cron] Error details: ${text}`);
              }
            } catch (e) {
               console.error(`[Cron] Network error dispatching batch ${index}:`, e);
            }
          });

          await Promise.all(dispatchPromises);
          console.log(`[Cron] Successfully dispatched all batches for ${termState.term_id}`);

          // Update last_checked timestamp
          await upsertTermState(env.DB, {
            ...termState,
            last_checked: Math.floor(Date.now() / 1000),
            // We don't update counts here anymore as sync is distributed and async
            // The counts will be updated eventually or we can add an aggregation step later
          });

        } catch (err) {
          console.error(`[Cron] Failed to process ${termState.term_id}:`, err);
        }
      })());
    }
  }
};
