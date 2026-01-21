import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';
import { courseRoutes } from './routes/course.js';
import { debugRoutes } from './routes/debug.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
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

// Enable CORS for the web client
app.use('/api/*', cors({
  origin: ['https://uiuc-course-search-web.pages.dev', 'http://localhost:5173'],
  allowHeaders: ['X-Search-Hints', 'Content-Type'],
}));

app.route('/', healthRoutes);
app.route('/', searchRoutes);
app.route('/', syncRoutes);
app.route('/', courseRoutes);
app.route('/', debugRoutes);

export default app;
