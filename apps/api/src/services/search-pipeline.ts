import type {
  D1Database,
  VectorizeIndex,
  Ai,
  KVNamespace,
} from "@cloudflare/workers-types";
import { extractQuery } from "./extractor.js";
import { parseTermValue, resolveQuery } from "./query-resolver.js";
import {
  hybridSearchWithTermRanking,
  sanitizeFtsQuery,
  type SearchResult,
} from "./search.js";
import { expandTopics } from "./topic-registry.js";
import { parseQuery } from "./query-parser.js";
import {
  applyDecisionSearchRescue,
  syncDecisionSearchExpansions,
} from "./decision-plan.js";
import {
  cacheSearchPlan,
  cacheSearchResult,
  getCachedSearchPlan,
  getCachedSearchResult,
} from "./search-cache.js";
import { errorFields, logger } from "../observability/logger.js";
import type {
  ParsedQuery,
  SearchRecoveryGroup,
  SearchPlan,
  ExtractedQuery,
  QueryHint,
  QueryHintType,
  SearchFilters,
  Hint,
  FieldFilter,
} from "@uiuc-course-search/query-types";
import type { ExtractionResult } from "./extractor.js";

export interface SearchPipelineResult {
  results: SearchResult[];
  meta: {
    query: {
      raw: string;
      residual: string;
    };
    extraction: {
      hints: Hint[];
    };
    plan: SearchPlan;
    timing: {
      extraction_ms: number;
      search_ms: number;
      total_ms: number;
    };
    fallback: {
      tierReached: number;
      constraintsRelaxed: string[];
      originalResultCount: number;
      recoveryGroups?: SearchRecoveryGroup[];
    };
  };
}

function mapHintType(type: string): QueryHintType {
  const mapping: Record<string, QueryHintType> = {
    courseCode: "course_code",
    crn: "crn",
    subject: "subject",
    instructor: "instructor",
    days: "days",
    time: "time",
    level: "level",
    levelBoost: "levelBoost",
    credits: "credits",
    online: "online",
    status: "status",
    difficulty: "difficulty",
    gened: "gened",
    term: "term",
    partOfTerm: "partOfTerm",
    negation: "negation",
  };
  return (mapping[type] || type) as QueryHintType;
}

function toQueryHint(hint: Hint): QueryHint {
  const queryHint: QueryHint = {
    type: mapHintType(hint.type),
    value:
      typeof hint.value === "object" &&
      hint.value !== null &&
      "subject" in hint.value
        ? `${hint.value.subject} ${hint.value.number}`
        : hint.value,
    confidence: hint.metadata.confidence,
    isExplicit:
      hint.metadata.source === "regex" || hint.metadata.source === "manual",
  };

  if (
    hint.type === "courseCode" &&
    typeof hint.value === "object" &&
    hint.value !== null &&
    "subject" in hint.value
  ) {
    queryHint.metadata = {
      subject: hint.value.subject,
      number: hint.value.number,
    };
  }

  return queryHint;
}

function appendQueryText(current: string, addition: string): string {
  return [current, addition].filter(Boolean).join(" ").trim();
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.toLowerCase();
  if (["true", "yes", "1", "online", "remote"].includes(normalized))
    return true;
  if (
    ["false", "no", "0", "in-person", "in_person", "inperson"].includes(
      normalized,
    )
  )
    return false;
  return undefined;
}

function applyFieldFilter(filter: FieldFilter, plan: SearchPlan): void {
  switch (filter.field) {
    case "subject":
      plan.filters.subject = filter.value.toUpperCase();
      break;
    case "gened":
      plan.filters.gened_code = filter.value.toUpperCase();
      break;
    case "credits": {
      const credits = parseInt(filter.value, 10);
      if (!Number.isNaN(credits)) plan.filters.credits = credits;
      break;
    }
    case "level": {
      const level = parseInt(filter.value, 10);
      if (!Number.isNaN(level)) plan.filters.level = level;
      break;
    }
    case "crn":
      plan.filters.crn = filter.value;
      break;
    case "status":
      plan.filters.status = filter.value.toLowerCase();
      break;
    case "online": {
      const online = parseBoolean(filter.value);
      if (online !== undefined) plan.filters.online = online;
      break;
    }
    case "days":
      plan.filters.days = filter.value.toUpperCase();
      break;
    case "time":
      plan.filters.time = filter.value.toLowerCase();
      break;
    case "term": {
      const parsed = parseTermValue(filter.value);
      if (parsed) {
        plan.filters.term = parsed.term;
        plan.filters.year = parsed.year;
      }
      break;
    }
    case "partofterm":
    case "part_of_term":
    case "pot":
      plan.filters.partOfTerm = filter.value.toUpperCase();
      break;
    case "difficulty":
      if (filter.value === "easy" || filter.value === "hard") {
        plan.filters.difficulty = filter.value;
      }
      break;
  }
}

function applyNegationToken(token: string, plan: SearchPlan): void {
  const normalized = token.toLowerCase();
  const timeWords = new Set([
    "early",
    "morning",
    "midday",
    "afternoon",
    "evening",
    "night",
  ]);
  const dayWords = new Set([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "mwf",
    "tr",
    "mw",
    "wf",
    "m",
    "t",
    "w",
    "r",
    "f",
  ]);

  if (timeWords.has(normalized)) {
    plan.filters.not = plan.filters.not || {};
    plan.filters.not.time = plan.filters.not.time || [];
    plan.filters.not.time.push(normalized === "night" ? "evening" : normalized);
    return;
  }

  if (dayWords.has(normalized)) {
    plan.filters.not = plan.filters.not || {};
    plan.filters.not.days = plan.filters.not.days || [];
    plan.filters.not.days.push(normalized);
    return;
  }

  if (["online", "remote", "virtual"].includes(normalized)) {
    plan.filters.online = false;
  }
}

function removeIntroductoryScaffolding(query: string): string {
  return query
    .replace(/\b(intro|introductory|beginner)\b/gi, " ")
    .replace(/\b(to|for|in|into|courses?|classes?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  const levelBoost = plan.softPreferences?.levelBoost;
  if (
    levelBoost !== 100 ||
    plan.filters.level !== undefined ||
    !plan.filters.subject
  ) {
    return false;
  }

  const remainingTopic = removeIntroductoryScaffolding(plan.semanticQuery);
  if (remainingTopic.length > 0) {
    return false;
  }

  const intents = new Set(plan.intents ?? []);
  intents.add("introductory_gateway");
  plan.intents = Array.from(intents);
  plan.softPreferences = {
    ...plan.softPreferences,
    introductoryIntent: "gateway",
  };
  plan.semanticQuery = "";
  plan.keywordQuery = "";
  return true;
}

function applyTopicExpansion(plan: SearchPlan): string[] {
  const sourceQuery = plan.semanticQuery || plan.keywordQuery || "";
  const expansions = expandTopics(sourceQuery);
  if (expansions.length === 0) {
    return [];
  }

  plan.softPreferences = {
    ...plan.softPreferences,
    topicExpansions: expansions,
  };
  plan.semanticQuery = appendQueryText(
    plan.semanticQuery,
    expansions.join(" "),
  );
  plan.keywordQuery = appendQueryText(plan.keywordQuery, expansions.join(" "));
  return expansions;
}

const MIN_INTRODUCTORY_GATEWAY_CANDIDATES = 40;

export function searchCandidateLimit(
  plan: SearchPlan,
  requestedLimit: number,
): number {
  const hasIntroductoryGatewayIntent =
    plan.intents?.includes("introductory_gateway") ||
    plan.softPreferences?.introductoryIntent === "gateway";

  if (!hasIntroductoryGatewayIntent) {
    return requestedLimit;
  }

  return Math.max(requestedLimit, MIN_INTRODUCTORY_GATEWAY_CANDIDATES);
}

export interface SearchPlanningInput {
  parsed: ParsedQuery;
  extraction: ExtractionResult;
  extracted: ExtractedQuery;
}

export interface SearchOverrides extends Partial<SearchFilters> {
  instructorName?: string;
}

export interface SearchPlanningResult {
  extraction: ExtractionResult;
  queryResidual: string;
  plan: SearchPlan;
}

export function extractSearchPlanningInput(query: string): SearchPlanningInput {
  const parsed = parseQuery(query);
  const extraction = extractQuery(parsed.clauses[0].residual);

  return {
    parsed,
    extraction,
    extracted: {
      rawQuery: query,
      hints: extraction.hints.map(toQueryHint),
      residual: extraction.residual,
    },
  };
}

function manualHint(
  type: Hint["type"],
  value: Hint["value"],
  raw: string,
): Hint {
  return {
    type,
    value,
    metadata: {
      source: "manual",
      confidence: 1,
      raw,
    },
  };
}

function addManualHint(hints: Hint[], hint: Hint): void {
  const signature = `${hint.type}:${JSON.stringify(hint.value)}`;
  const exists = hints.some(
    (existing) =>
      `${existing.type}:${JSON.stringify(existing.value)}` === signature,
  );
  if (!exists) {
    hints.push(hint);
  }
}

function manualHintsFromOverrides(overrides?: SearchOverrides): Hint[] {
  if (!overrides) return [];

  const hints: Hint[] = [];
  if (overrides.subject && overrides.number) {
    addManualHint(
      hints,
      manualHint(
        "courseCode",
        { subject: overrides.subject, number: overrides.number },
        `${overrides.subject} ${overrides.number}`,
      ),
    );
  } else if (overrides.subject) {
    addManualHint(
      hints,
      manualHint("subject", overrides.subject, overrides.subject),
    );
  }
  if (overrides.instructorName) {
    addManualHint(
      hints,
      manualHint(
        "instructor",
        overrides.instructorName,
        overrides.instructorName,
      ),
    );
  }
  if (overrides.term && overrides.year) {
    addManualHint(
      hints,
      manualHint(
        "term",
        { term: overrides.term, year: overrides.year },
        `${overrides.term} ${overrides.year}`,
      ),
    );
  }
  if (overrides.gened_code) {
    addManualHint(
      hints,
      manualHint("gened", overrides.gened_code, overrides.gened_code),
    );
  }
  if (overrides.credits !== undefined) {
    addManualHint(
      hints,
      manualHint("credits", overrides.credits, String(overrides.credits)),
    );
  }
  if (overrides.days) {
    addManualHint(hints, manualHint("days", overrides.days, overrides.days));
  }
  if (overrides.time) {
    addManualHint(hints, manualHint("time", overrides.time, overrides.time));
  }
  if (overrides.online !== undefined) {
    addManualHint(
      hints,
      manualHint("online", overrides.online, String(overrides.online)),
    );
  }
  if (overrides.status) {
    addManualHint(
      hints,
      manualHint("status", overrides.status, overrides.status),
    );
  }
  if (overrides.difficulty) {
    addManualHint(
      hints,
      manualHint("difficulty", overrides.difficulty, overrides.difficulty),
    );
  }

  return hints;
}

function withManualOverrideHints(
  input: SearchPlanningInput,
  overrides?: SearchOverrides,
): SearchPlanningInput {
  const manualHints = manualHintsFromOverrides(overrides);
  if (manualHints.length === 0) {
    return input;
  }

  const extractionHints = [...input.extraction.hints];
  for (const hint of manualHints) {
    addManualHint(extractionHints, hint);
  }

  return {
    ...input,
    extraction: {
      ...input.extraction,
      hints: extractionHints,
    },
    extracted: {
      ...input.extracted,
      hints: extractionHints.map(toQueryHint),
    },
  };
}

export async function createSearchPlan(
  db: D1Database,
  query: string,
  input: SearchPlanningInput = extractSearchPlanningInput(query),
  overrides?: SearchOverrides,
): Promise<SearchPlanningResult> {
  const planningInput = withManualOverrideHints(input, overrides);
  const plan = await resolveQuery(db, planningInput.extracted);
  let queryResidual = plan.semanticQuery;

  const clause = planningInput.parsed.clauses[0];
  for (const filter of clause.filters) {
    applyFieldFilter(filter, plan);
  }

  if (clause.genedMode) {
    if (clause.genedMode.any) plan.filters.gened_any = clause.genedMode.any;
    if (clause.genedMode.all) plan.filters.gened_all = clause.genedMode.all;
  }

  for (const negation of clause.negations) {
    applyNegationToken(negation, plan);
  }

  if (clause.phrases.length > 0) {
    const keywordPhrases = clause.phrases
      .map((phrase) => `"${phrase.replace(/"/g, '""')}"`)
      .join(" ");
    const semanticPhrases = clause.phrases.join(" ");
    plan.keywordQuery = appendQueryText(plan.keywordQuery, keywordPhrases);
    plan.semanticQuery = appendQueryText(plan.semanticQuery, semanticPhrases);
  }

  if (overrides) {
    const filterOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "instructorName"),
    ) as Partial<SearchFilters>;
    Object.assign(plan.filters, filterOverrides);
  }

  if (applyIntroductoryGatewayIntent(plan)) {
    queryResidual = plan.semanticQuery;
  }

  const rescueResult = applyDecisionSearchRescue(plan, query, queryResidual);
  queryResidual = rescueResult.queryResidual;

  const topicExpansions = applyTopicExpansion(plan);
  syncDecisionSearchExpansions(plan, topicExpansions);

  plan.keywordQuery = sanitizeFtsQuery(plan.keywordQuery);
  plan.semanticQuery = sanitizeFtsQuery(plan.semanticQuery);

  return { extraction: planningInput.extraction, queryResidual, plan };
}

export class SearchPipeline {
  constructor(
    private db: D1Database,
    private vectorize: VectorizeIndex,
    private ai: Ai,
    private searchCache?: KVNamespace,
  ) {}

  /**
   * Main search entry point using a tiered approach.
   */
  async search(
    query: string,
    limit: number = 20,
    overrides?: SearchOverrides,
    _waitUntil?: (promise: Promise<unknown>) => void,
  ): Promise<SearchPipelineResult> {
    const startTime = performance.now();

    const cachedResult = await getCachedSearchResult(
      this.searchCache,
      query,
      limit,
      overrides,
    ).catch((error) => {
      logger.warn("search.cache.result_get_failed", { ...errorFields(error) });
      return null;
    });
    if (cachedResult) {
      return cachedResult;
    }

    let planning = await getCachedSearchPlan(
      this.searchCache,
      query,
      overrides,
    ).catch((error) => {
      logger.warn("search.cache.plan_get_failed", { ...errorFields(error) });
      return null;
    });
    if (!planning) {
      const planningInput = extractSearchPlanningInput(query);
      planning = await createSearchPlan(
        this.db,
        query,
        planningInput,
        overrides,
      );
      enqueueCacheWrite(
        cacheSearchPlan(this.searchCache, query, planning, overrides),
        _waitUntil,
        "search.cache.plan_put_failed",
      );
    }
    const extractionEndTime = performance.now();
    const { extraction, queryResidual, plan } = planning;

    const searchStartTime = performance.now();
    let results: SearchResult[];
    let tierReached: number;
    const constraintsRelaxed: string[] = [];
    let originalResultCount: number;
    const candidateLimit = searchCandidateLimit(plan, limit);

    // Tier 1: Navigational (Exact course code or CRN)
    const isNavigational = !!(
      (plan.filters.subject && plan.filters.number) ||
      plan.filters.crn
    );
    if (isNavigational) {
      tierReached = 1;
      results = await hybridSearchWithTermRanking(
        this.db,
        this.vectorize,
        this.ai,
        plan,
        candidateLimit,
      );
      originalResultCount = results.length;
    } else {
      // Tier 2: Structured (Search with extracted filters)
      tierReached = 2;
      results = await hybridSearchWithTermRanking(
        this.db,
        this.vectorize,
        this.ai,
        plan,
        candidateLimit,
      );
      originalResultCount = results.length;

      // If we have few results, try expansion
      if (results.length < 3) {
        // Tier 3: Topic Hybrid (Topic expansion)
        const existingExpansions = Array.isArray(
          plan.softPreferences?.topicExpansions,
        )
          ? plan.softPreferences.topicExpansions
          : [];
        const expandedKeywords =
          existingExpansions.length > 0 ? [] : expandTopics(queryResidual);
        if (expandedKeywords.length > 0) {
          tierReached = 3;
          const expandedPlan: SearchPlan = {
            ...plan,
            keywordQuery: sanitizeFtsQuery(
              `${plan.keywordQuery} ${expandedKeywords.join(" ")}`,
            ),
            semanticQuery: sanitizeFtsQuery(
              `${plan.semanticQuery} ${expandedKeywords.join(" ")}`,
            ),
          };

          const expandedResults = await hybridSearchWithTermRanking(
            this.db,
            this.vectorize,
            this.ai,
            expandedPlan,
            candidateLimit,
          );
          results = this.mergeResults(results, expandedResults, candidateLimit);
        }
      }
    }
    results = results.slice(0, limit);
    const recoveryGroups = buildRecoveryGroups(plan, query, results.length);
    const searchEndTime = performance.now();
    const totalEndTime = performance.now();

    const result: SearchPipelineResult = {
      results,
      meta: {
        query: {
          raw: query,
          residual: queryResidual,
        },
        extraction: {
          hints: extraction.hints, // Return the rich Hint objects
        },
        plan,
        timing: {
          extraction_ms: Math.round(extractionEndTime - startTime),
          search_ms: Math.round(searchEndTime - searchStartTime),
          total_ms: Math.round(totalEndTime - startTime),
        },
        fallback: {
          tierReached,
          constraintsRelaxed,
          originalResultCount,
          recoveryGroups,
        },
      },
    };

    enqueueCacheWrite(
      cacheSearchResult(this.searchCache, query, limit, result, overrides),
      _waitUntil,
      "search.cache.result_put_failed",
    );

    return result;
  }

  /**
   * Merges two sets of search results, removing duplicates and maintaining sort order.
   */
  private mergeResults(
    a: SearchResult[],
    b: SearchResult[],
    limit: number,
  ): SearchResult[] {
    const map = new Map<string, SearchResult>();

    for (const r of a) {
      map.set(r.course.id, r);
    }

    for (const r of b) {
      const existing = map.get(r.course.id);
      // Prefer results with better score if already present
      if (!existing || r.score > existing.score) {
        map.set(r.course.id, r);
      }
    }

    const merged = Array.from(map.values());

    merged.sort((x, y) => {
      if (x.termPriority !== y.termPriority) {
        return (x.termPriority ?? 100) - (y.termPriority ?? 100);
      }
      return y.score - x.score;
    });

    return merged.slice(0, limit);
  }
}

function enqueueCacheWrite(
  promise: Promise<void>,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  failureEvent: string,
): void {
  const guarded = promise.catch((error) => {
    logger.warn(failureEvent, { ...errorFields(error) });
  });

  if (waitUntil) {
    waitUntil(guarded);
  } else {
    void guarded;
  }
}

export function buildRecoveryGroups(
  plan: SearchPlan,
  rawQuery: string,
  resultCount: number,
): SearchRecoveryGroup[] | undefined {
  if (resultCount > 0 || !plan.rescue?.relaxationPlan.length) {
    return undefined;
  }

  const groups = plan.rescue.relaxationPlan
    .filter((step) => step.relaxes.length > 0)
    .slice(0, 4)
    .map(
      (step): SearchRecoveryGroup => ({
        id: step.id,
        label: step.label,
        description: describeRelaxation(step.relaxes),
        relaxes: step.relaxes,
        keeps: step.keeps,
        queryPatch: {
          replaceQuery: relaxedQuery(rawQuery, step.relaxes),
        },
      }),
    );

  return groups.length > 0 ? groups : undefined;
}

function describeRelaxation(relaxes: string[]): string {
  if (relaxes.includes("online")) {
    return "Keeps the requirement or topic intent while allowing in-person, hybrid, or unknown delivery.";
  }
  if (
    relaxes.some(
      (item) =>
        item.toLowerCase().includes("writing") ||
        item.toLowerCase().includes("exam") ||
        item.toLowerCase().includes("reading"),
    )
  ) {
    return "Keeps useful course matches and shows evidence warnings where assignment details are incomplete.";
  }
  if (relaxes.includes("specificRequirement")) {
    return "Keeps the topic and availability path while showing adjacent requirement buckets clearly labeled.";
  }
  return "Keeps the strongest interpreted intent while relaxing the least certain preference.";
}

function relaxedQuery(rawQuery: string, relaxes: string[]): string {
  let query = rawQuery;
  if (relaxes.includes("online")) {
    query = query.replace(/\b(?:online|remote|asynchronous|async)\b/gi, " ");
  }
  if (relaxes.some((item) => item.toLowerCase().includes("writing"))) {
    query = query.replace(
      /\b(?:no\s+)?(?:essays?|papers?|writing|writing-heavy|writing heavy)\b/gi,
      " ",
    );
  }
  if (relaxes.some((item) => item.toLowerCase().includes("exam"))) {
    query = query.replace(
      /\b(?:no\s+)?(?:exams?|tests?|midterms?|finals?)\b/gi,
      " ",
    );
  }
  return query.replace(/\s+/g, " ").trim() || rawQuery;
}
