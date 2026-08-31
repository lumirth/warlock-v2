import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { D1Database, KVNamespace, RateLimit } from '@cloudflare/workers-types';
import { requireAdminToken } from './middleware/auth.js';
import { courseRoutes } from './routes/course.js';
import { feedbackRoutes } from './routes/feedback.js';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';

export type Bindings = {
  DB: D1Database;
  GPA_CACHE: KVNamespace;
  SEARCH_RATE_LIMITER: RateLimit;
  COURSE_RATE_LIMITER: RateLimit;
  FEEDBACK_RATE_LIMITER: RateLimit;
  CISAPI_BASE: string;
  FEEDBACK_ALLOWED_ORIGINS: string;
  ADMIN_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

export const app = new Hono<{ Bindings: Bindings }>();

type PublicRateLimitBinding =
  | 'SEARCH_RATE_LIMITER'
  | 'COURSE_RATE_LIMITER'
  | 'FEEDBACK_RATE_LIMITER';
type PublicRouteClass = 'search' | 'course' | 'feedback';

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

function feedbackWriteOrigin(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    if (
      c.req.method === 'POST'
      && !isAllowedFeedbackOrigin(
        c.req.header('Origin'),
        c.env.FEEDBACK_ALLOWED_ORIGINS,
      )
    ) {
      return c.json({ error: 'feedback origin is not allowed' }, 403);
    }

    await next();
  };
}

export function isAllowedFeedbackOrigin(
  requestOrigin: string | undefined,
  configuredOrigins: string | undefined,
): boolean {
  const origin = normalizedOrigin(requestOrigin);
  if (!origin) return false;

  return (configuredOrigins ?? '')
    .split(',')
    .map(normalizedOrigin)
    .some((allowedOrigin) => allowedOrigin === origin);
}

function normalizedOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type'],
}));

app.use('/admin/*', requireAdminToken());
app.use('/api/search', publicRateLimit('SEARCH_RATE_LIMITER', 'search'));
app.use('/api/course/*', publicRateLimit('COURSE_RATE_LIMITER', 'course'));
app.use('/api/feedback', feedbackWriteOrigin());
app.use('/api/feedback', publicRateLimit('FEEDBACK_RATE_LIMITER', 'feedback'));

app.route('/', healthRoutes);
app.route('/', searchRoutes);
app.route('/', syncRoutes);
app.route('/', courseRoutes);
app.route('/', feedbackRoutes);
