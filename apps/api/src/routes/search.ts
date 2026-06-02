import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { SearchPipeline } from '../services/search-pipeline.js';
import type { SearchFilters, SearchResponseDto } from '@uiuc-course-search/query-types';
import { searchResultToCourseDto } from '../dto/course.js';
import { buildSearchUiPlan } from '../dto/search-ui.js';
import { parseBoundedIntParam, parseSubjectParam } from '../http/params.js';
import { getSearchTermSummary } from '../services/term-state.js';
import { errorFields, logger } from '../observability/logger.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get('/api/search', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  const parsedLimit = parseBoundedIntParam(c.req.query('limit'), 'limit', {
    min: 1,
    max: 50,
    defaultValue: 20,
  });
  if (!parsedLimit.ok) {
    return c.json({ error: parsedLimit.error }, 400);
  }
  const limit = parsedLimit.value;

  const parsedOffset = parseBoundedIntParam(c.req.query('offset'), 'offset', {
    min: 0,
    max: 200,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) {
    return c.json({ error: parsedOffset.error }, 400);
  }
  const offset = parsedOffset.value;

  // Manual overrides from query params
  const overrides: Partial<SearchFilters> = {};
  const subject = c.req.query('subject');
  if (subject) {
    const parsedSubject = parseSubjectParam(subject);
    if (!parsedSubject.ok) {
      return c.json({ error: parsedSubject.error }, 400);
    }
    overrides.subject = parsedSubject.value;
  }
  if (c.req.query('gened')) overrides.gened_code = c.req.query('gened');
  const credits = c.req.query('credits');
  if (credits) {
    const parsedCredits = parseBoundedIntParam(credits, 'credits', { min: 0, max: 8 });
    if (!parsedCredits.ok) {
      return c.json({ error: parsedCredits.error }, 400);
    }
    overrides.credits = parsedCredits.value;
  }

  const difficulty = c.req.query('difficulty');
  if (difficulty === 'easy' || difficulty === 'hard') {
    overrides.difficulty = difficulty;
  } else if (difficulty) {
    return c.json({ error: 'difficulty must be one of: easy, hard' }, 400);
  }

  try {
    const pipeline = new SearchPipeline(c.env.DB, c.env.VECTORIZE, c.env.AI);
    const fetchLimit = offset + limit + 1;
    const result = await pipeline.search(query, fetchLimit, overrides, c.executionCtx.waitUntil.bind(c.executionCtx));
    const pageResults = result.results.slice(offset, offset + limit);
    const hasMore = result.results.length > offset + limit;

    const response: SearchResponseDto = {
      results: pageResults.map(searchResult => searchResultToCourseDto(searchResult, {
        plan: result.meta.plan,
        rawQuery: result.meta.query.raw,
        hints: result.meta.extraction.hints,
      })),
      meta: {
        ...result.meta,
        ambiguities: result.meta.plan.ambiguities,
        term: await getSearchTermSummary(c.env.DB),
        ui: buildSearchUiPlan(
          result.meta.extraction.hints,
          result.meta.plan,
          result.meta.query.residual
        ),
      },
      pagination: {
        total: offset + pageResults.length + (hasMore ? 1 : 0),
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      },
    };

    return c.json(response);
  } catch (error) {
    logger.error('route.search.failed', { ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});
