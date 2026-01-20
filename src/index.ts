import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';

type Bindings = {
  DB: D1Database;
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

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

// Test endpoint to fetch subjects from CISAPI
app.get('/test/subjects', async (c) => {
  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const subjects = await client.getSubjects();
    return c.json({
      count: subjects.length,
      sample: subjects.slice(0, 5)
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Test endpoint to fetch a single course
app.get('/test/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();

  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const course = await client.getCourseDetail(subject, number);
    return c.json(course);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

export default app;
