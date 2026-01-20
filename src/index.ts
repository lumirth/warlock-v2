import { Hono } from 'hono';

type Bindings = {
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

export default app;
