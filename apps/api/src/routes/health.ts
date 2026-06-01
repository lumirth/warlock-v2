import { Hono } from 'hono';

type Bindings = {
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

healthRoutes.get('/health', (c) => c.json({ healthy: true }));
