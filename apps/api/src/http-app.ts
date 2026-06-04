import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { Ai, D1Database, Fetcher, KVNamespace, RateLimit, VectorizeIndex } from '@cloudflare/workers-types';
import { requireBearerToken } from './middleware/auth.js';
import { adminRoutes, debugRoutes } from './routes/debug.js';
import { courseRoutes } from './routes/course.js';
import { feedbackRoutes } from './routes/feedback.js';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';

export type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SELF: Fetcher;
  GPA_CACHE: KVNamespace;
  SEARCH_CACHE?: KVNamespace;
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

export const app = new Hono<{ Bindings: Bindings }>();

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
