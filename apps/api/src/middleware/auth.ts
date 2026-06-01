import { createMiddleware } from 'hono/factory';

type AuthBindings = {
  ADMIN_TOKEN?: string;
  INTERNAL_TOKEN?: string;
};

type TokenBinding = keyof AuthBindings;

function getBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

function constantTimeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;

  for (let i = 0; i < maxLength; i++) {
    const aCode = i < a.length ? a.charCodeAt(i) : 0;
    const bCode = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= aCode ^ bCode;
  }

  return mismatch === 0;
}

export function requireBearerToken(binding: TokenBinding) {
  return createMiddleware<{ Bindings: AuthBindings }>(async (c, next) => {
    const provided = getBearerToken(c.req.header('Authorization'));

    if (!provided) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const expected = c.env[binding];
    if (!expected) {
      return c.json({ error: `${binding} is not configured` }, 503);
    }

    if (!constantTimeEqual(provided, expected)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  });
}

export function internalAuthHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
