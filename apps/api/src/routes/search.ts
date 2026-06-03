import { Hono } from "hono";
import type {
  D1Database,
  VectorizeIndex,
  Ai,
  KVNamespace,
} from "@cloudflare/workers-types";
import {
  SearchPipeline,
  type SearchOverrides,
} from "../services/search-pipeline.js";
import type { SearchResponseDto } from "@uiuc-course-search/query-types";
import { searchResultToCourseDto } from "../dto/course.js";
import { buildSearchUiPlan } from "../dto/search-ui.js";
import {
  parseBoundedIntParam,
  parseCourseNumberParam,
  parseEnumParam,
  parseSubjectParam,
} from "../http/params.js";
import { getSearchTermSummary } from "../services/term-state.js";
import { errorFields, logger } from "../observability/logger.js";

const MAX_SEARCH_OFFSET = 1000;
const MAX_SEARCH_FETCH_WINDOW = 1200;
const TERM_VALUES = ["spring", "summer", "fall", "winter"] as const;
const TIME_VALUES = [
  "early",
  "morning",
  "midday",
  "afternoon",
  "evening",
] as const;
const STATUS_VALUES = ["open", "available", "closed"] as const;

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SEARCH_CACHE?: KVNamespace;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

function parseBooleanParam(
  raw: string,
  name: string,
): { ok: true; value: boolean } | { ok: false; error: string } {
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "online", "remote"].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (
    ["false", "0", "no", "in-person", "in_person", "inperson"].includes(
      normalized,
    )
  ) {
    return { ok: true, value: false };
  }
  return { ok: false, error: `${name} must be a boolean` };
}

function hasOverrides(overrides: SearchOverrides): boolean {
  return Object.values(overrides).some((value) => value !== undefined);
}

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get("/api/search", async (c) => {
  const query = c.req.query("q") ?? "";

  const parsedLimit = parseBoundedIntParam(c.req.query("limit"), "limit", {
    min: 1,
    max: 50,
    defaultValue: 20,
  });
  if (!parsedLimit.ok) {
    return c.json({ error: parsedLimit.error }, 400);
  }
  const limit = parsedLimit.value;

  const parsedOffset = parseBoundedIntParam(c.req.query("offset"), "offset", {
    min: 0,
    max: MAX_SEARCH_OFFSET,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) {
    return c.json({ error: parsedOffset.error }, 400);
  }
  const offset = parsedOffset.value;

  // Manual overrides from query params. These come from structured UI controls,
  // so the visible search string can stay natural-language instead of being
  // rewritten into power-user syntax.
  const overrides: SearchOverrides = {};
  const subject = c.req.query("subject");
  if (subject) {
    const parsedSubject = parseSubjectParam(subject);
    if (!parsedSubject.ok) {
      return c.json({ error: parsedSubject.error }, 400);
    }
    overrides.subject = parsedSubject.value;
  }
  const number = c.req.query("number");
  if (number) {
    const parsedNumber = parseCourseNumberParam(number);
    if (!parsedNumber.ok) {
      return c.json({ error: parsedNumber.error }, 400);
    }
    overrides.number = parsedNumber.value;
  }

  const instructor = c.req.query("instructor")?.trim();
  if (instructor) {
    if (instructor.length > 80) {
      return c.json(
        { error: "instructor must be 80 characters or fewer" },
        400,
      );
    }
    overrides.instructorName = instructor;
  }

  const term = c.req.query("term");
  if (term) {
    const parsedTerm = parseEnumParam(term.toLowerCase(), "term", TERM_VALUES);
    if (!parsedTerm.ok) {
      return c.json({ error: parsedTerm.error }, 400);
    }
    overrides.term = parsedTerm.value;
  }

  const year = c.req.query("year");
  if (year) {
    const parsedYear = parseBoundedIntParam(year, "year", {
      min: 2000,
      max: 2100,
    });
    if (!parsedYear.ok) {
      return c.json({ error: parsedYear.error }, 400);
    }
    overrides.year = parsedYear.value;
  }

  const gened = c.req.query("gened")?.trim();
  if (gened) overrides.gened_code = gened.toUpperCase();

  const credits = c.req.query("credits");
  if (credits) {
    const parsedCredits = parseBoundedIntParam(credits, "credits", {
      min: 0,
      max: 8,
    });
    if (!parsedCredits.ok) {
      return c.json({ error: parsedCredits.error }, 400);
    }
    overrides.credits = parsedCredits.value;
  }

  const days = c.req.query("days")?.trim().toUpperCase();
  if (days) {
    if (!/^[MTWRFSU]{1,7}$/.test(days)) {
      return c.json(
        { error: "days must use meeting-day letters like MWF or TR" },
        400,
      );
    }
    overrides.days = days;
  }

  const time = c.req.query("time");
  if (time) {
    const parsedTime = parseEnumParam(time.toLowerCase(), "time", TIME_VALUES);
    if (!parsedTime.ok) {
      return c.json({ error: parsedTime.error }, 400);
    }
    overrides.time = parsedTime.value;
  }

  const online = c.req.query("online");
  if (online) {
    const parsedOnline = parseBooleanParam(online, "online");
    if (!parsedOnline.ok) {
      return c.json({ error: parsedOnline.error }, 400);
    }
    overrides.online = parsedOnline.value;
  }

  const status = c.req.query("status");
  if (status) {
    const parsedStatus = parseEnumParam(
      status.toLowerCase(),
      "status",
      STATUS_VALUES,
    );
    if (!parsedStatus.ok) {
      return c.json({ error: parsedStatus.error }, 400);
    }
    overrides.status = parsedStatus.value;
  }

  const difficulty = c.req.query("difficulty");
  if (difficulty === "easy" || difficulty === "hard") {
    overrides.difficulty = difficulty;
  } else if (difficulty) {
    return c.json({ error: "difficulty must be one of: easy, hard" }, 400);
  }

  if (!query.trim() && !hasOverrides(overrides)) {
    return c.json({ error: "Missing query parameter q" }, 400);
  }

  try {
    const pipeline = new SearchPipeline(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      c.env.SEARCH_CACHE,
    );
    const requestedWindow = offset + limit + 1;
    const fetchLimit = Math.min(
      MAX_SEARCH_FETCH_WINDOW,
      Math.max(requestedWindow, (offset + limit) * 2),
    );
    const result = await pipeline.search(
      query,
      fetchLimit,
      overrides,
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
    const pageResults = result.results.slice(offset, offset + limit);
    const hasMore = result.results.length > offset + limit;

    const response: SearchResponseDto = {
      results: pageResults.map((searchResult) =>
        searchResultToCourseDto(searchResult, {
          plan: result.meta.plan,
          rawQuery: result.meta.query.raw,
          hints: result.meta.extraction.hints,
        }),
      ),
      meta: {
        ...result.meta,
        ambiguities: result.meta.plan.ambiguities,
        term: await getSearchTermSummary(c.env.DB),
        ui: buildSearchUiPlan(
          result.meta.extraction.hints,
          result.meta.plan,
          result.meta.query.residual,
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
    logger.error("route.search.failed", { ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});
