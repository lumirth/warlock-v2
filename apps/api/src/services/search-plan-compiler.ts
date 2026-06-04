import type { D1Database } from "@cloudflare/workers-types";
import { extractQuery } from "./extractor.js";
import { parseTermValue, resolveQuery } from "./query-resolver.js";
import { sanitizeFtsQuery } from "./search-text.js";
import { expandTopics } from "./topic-registry.js";
import { parseQuery } from "./query-parser.js";
import {
  applyDecisionSearchRescue,
  syncDecisionSearchExpansions,
} from "./decision-plan.js";
import {
  requirementFilter,
  singleRequirementFilter,
  type SearchSort,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import type {
  ExtractedQuery,
  FieldFilter,
  Hint,
  ParsedQuery,
  QueryHint,
  QueryHintType,
  SearchPlan,
} from "./search-planner-types.js";
import type { ExtractionResult } from "./extractor.js";
import {
  deepFreeze,
  searchPlanFiltersFromRequestFilters,
} from "./search-request.js";
import {
  applyStructuredNegation,
  parseBooleanFilterValue,
} from "./search-intent-policy.js";

export type SearchCompilerEventStage =
  | "parse"
  | "extract"
  | "resolve"
  | "compile"
  | "rescue"
  | "finalize";

export type SearchCompilerEvent = {
  stage: SearchCompilerEventStage;
  type: string;
  summary: string;
  data?: Record<string, unknown>;
};

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
    metadata: {
      raw: hint.metadata.raw,
      source: hint.metadata.source,
    },
  };

  if (
    hint.type === "courseCode" &&
    typeof hint.value === "object" &&
    hint.value !== null &&
    "subject" in hint.value
  ) {
    queryHint.metadata = {
      ...queryHint.metadata,
      subject: hint.value.subject,
      number: hint.value.number,
    };
  }

  return queryHint;
}

function appendQueryText(current: string, addition: string): string {
  return [current, addition].filter(Boolean).join(" ").trim();
}

function applyFieldFilter(filter: FieldFilter, plan: SearchPlan): void {
  if (filter.negated) {
    applyStructuredNegation(filter.field, filter.value, plan);
    return;
  }

  switch (filter.field) {
    case "subject":
      plan.filters.subject = filter.value.toUpperCase();
      break;
    case "gened":
      plan.filters.requirement = singleRequirementFilter(filter.value);
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
      const online = parseBooleanFilterValue(filter.value);
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
  const fieldMatch = /^(subject|gened|keyword|workload):(.+)$/.exec(normalized);
  if (fieldMatch) {
    applyStructuredNegation(fieldMatch[1], fieldMatch[2], plan);
    return;
  }

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
  plan.keywordQuery = buildTopicExpansionKeywordQuery(plan.keywordQuery, expansions);
  return expansions;
}

const TOPIC_EXPANSION_STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "class",
  "classes",
  "course",
  "courses",
  "for",
  "the",
]);

function buildTopicExpansionKeywordQuery(
  keywordQuery: string,
  expansions: string[],
): string {
  const terms = [
    keywordQuery,
    ...expansions,
  ]
    .flatMap(text => text.split(/\s+/))
    .map(term => term.trim())
    .filter(Boolean)
    .filter(term => !TOPIC_EXPANSION_STOPWORDS.has(term.toLowerCase()));

  const seen = new Set<string>();
  const uniqueTerms = terms.filter(term => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueTerms.join(" OR ");
}

function applySortIntent(plan: SearchPlan, rawQuery: string): boolean {
  const normalized = rawQuery.toLowerCase();
  let inferredSort: SearchSort | null = null;
  const explicitSortMatch = /\b(?:sort|order|rank)(?:\s+(?:courses?|classes?|results?))?\s+by\s+(avg\s+gpa|gpa|difficulty|workload|quality|professor\s+rating|instructor\s+rating|rating|level|credits?)\b/.exec(normalized);

  if (explicitSortMatch) {
    const field = explicitSortMatch[1];
    if (field.includes("gpa")) {
      inferredSort = { field: "gpa", direction: "desc" };
    } else if (field.includes("rating")) {
      inferredSort = { field: "instructor_rating", direction: "desc" };
    } else if (field === "quality") {
      inferredSort = { field: "quality", direction: "desc" };
    } else if (field === "level") {
      inferredSort = { field: "level", direction: "asc" };
    } else if (field.startsWith("credit")) {
      inferredSort = { field: "credits", direction: "asc" };
    } else {
      inferredSort = { field: "workload", direction: "asc" };
    }
  } else if (/\b(?:highest|best|top)\s+(?:avg\s+)?gpa\b|\b(?:avg\s+)?gpa\s+(?:highest|best|top)\b/.test(normalized)) {
    inferredSort = { field: "gpa", direction: "desc" };
  } else if (/\b(?:best|top|highest\s+rated)\s+(?:professors?|instructors?)\b|\b(?:professor|instructor)\s+rating\b/.test(normalized)) {
    inferredSort = { field: "instructor_rating", direction: "desc" };
  } else if (/\b(?:easiest|least\s+(?:work|workload)|lowest\s+workload)\b/.test(normalized)) {
    inferredSort = { field: "workload", direction: "asc" };
    plan.filters.difficulty = plan.filters.difficulty ?? "easy";
    plan.softPreferences = {
      ...(plan.softPreferences ?? {}),
      lowWorkload: 0.86,
    };
  } else if (/\b(?:hardest|most\s+difficult|highest\s+workload)\b/.test(normalized)) {
    inferredSort = { field: "workload", direction: "desc" };
    plan.filters.difficulty = plan.filters.difficulty ?? "hard";
  }

  if (!inferredSort) {
    return false;
  }

  plan.softPreferences = {
    ...(plan.softPreferences ?? {}),
    inferredSort,
  };
  plan.keywordQuery = removeSortScaffolding(plan.keywordQuery);
  plan.semanticQuery = removeSortScaffolding(plan.semanticQuery);
  return true;
}

function removeSortScaffolding(query: string): string {
  return query
    .replace(/\b(?:sort|order|rank)(?:\s+(?:courses?|classes?|results?))?\s+by\s+(?:avg\s+gpa|gpa|difficulty|workload|quality|professor\s+rating|instructor\s+rating|rating|level|credits?)\b/gi, " ")
    .replace(/\b(?:highest|best|top)\s+(?:avg\s+)?gpa\b/gi, " ")
    .replace(/\b(?:avg\s+)?gpa\s+(?:highest|best|top)\b/gi, " ")
    .replace(/\b(?:best|top|highest\s+rated)\s+(?:professors?|instructors?)\b/gi, " ")
    .replace(/\b(?:professor|instructor)\s+rating\b/gi, " ")
    .replace(/\b(?:easiest|least\s+(?:work|workload)|lowest\s+workload)\b/gi, " ")
    .replace(/\b(?:hardest|most\s+difficult|highest\s+workload)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SearchPlanningInput {
  parsed: ParsedQuery;
  extraction: ExtractionResult;
  extracted: ExtractedQuery;
}

export interface SearchPlanningResult {
  extraction: ExtractionResult;
  queryResidual: string;
  plan: SearchPlan;
  fallbackPlans: SearchPlan[];
  compilerEvents: SearchCompilerEvent[];
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

function manualHintsFromRequestFilters(filters?: SearchRequestFiltersDto): Hint[] {
  if (!filters) return [];

  const hints: Hint[] = [];
  if (filters.subject && filters.number) {
    addManualHint(
      hints,
      manualHint(
        "courseCode",
        { subject: filters.subject, number: filters.number },
        `${filters.subject} ${filters.number}`,
      ),
    );
  } else if (filters.subject) {
    addManualHint(
      hints,
      manualHint("subject", filters.subject, filters.subject),
    );
  }
  if (filters.instructor) {
    addManualHint(
      hints,
      manualHint(
        "instructor",
        filters.instructor,
        filters.instructor,
      ),
    );
  }
  if (filters.term && filters.year) {
    addManualHint(
      hints,
      manualHint(
        "term",
        { term: filters.term, year: filters.year },
        `${filters.term} ${filters.year}`,
      ),
    );
  }
  if (filters.gened) {
    addManualHint(
      hints,
      manualHint("gened", filters.gened, filters.gened),
    );
  }
  if (filters.credits !== undefined) {
    addManualHint(
      hints,
      manualHint("credits", filters.credits, String(filters.credits)),
    );
  }
  if (filters.level !== undefined) {
    addManualHint(
      hints,
      manualHint("level", filters.level, `${filters.level} level`),
    );
  }
  if (filters.days) {
    addManualHint(hints, manualHint("days", filters.days, filters.days));
  }
  if (filters.time) {
    addManualHint(hints, manualHint("time", filters.time, filters.time));
  }
  if (filters.online !== undefined) {
    addManualHint(
      hints,
      manualHint("online", filters.online, String(filters.online)),
    );
  }
  if (filters.status) {
    addManualHint(
      hints,
      manualHint("status", filters.status, filters.status),
    );
  }
  if (filters.difficulty) {
    addManualHint(
      hints,
      manualHint("difficulty", filters.difficulty, filters.difficulty),
    );
  }

  return hints;
}

function withManualRequestFilterHints(
  input: SearchPlanningInput,
  filters?: SearchRequestFiltersDto,
): SearchPlanningInput {
  const manualHints = manualHintsFromRequestFilters(filters);
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
  requestFilters?: SearchRequestFiltersDto,
): Promise<SearchPlanningResult> {
  const compilerEvents: SearchCompilerEvent[] = [
    compilerEvent("parse", "query_language", "Parsed query language clauses", {
      clauses: input.parsed.clauses.length,
      filters: input.parsed.clauses.flatMap((clause) => clause.filters).length,
    }),
    compilerEvent("extract", "student_language", "Extracted student-language hints", {
      hints: input.extraction.hints.map((hint) => hint.type),
      residual: input.extraction.residual,
    }),
  ];
  const planningInput = withManualRequestFilterHints(input, requestFilters);
  if (requestFilters) {
    compilerEvents.push(
      compilerEvent("extract", "manual_filter_hints", "Merged structured request filters as manual hints", {
        filters: Object.keys(requestFilters).filter((key) => requestFilters[key as keyof SearchRequestFiltersDto] !== undefined),
      }),
    );
  }

  const plan = await resolveQuery(db, planningInput.extracted);
  compilerEvents.push(
    compilerEvent("resolve", "validated_hints", "Resolved extracted hints into structured filters", {
      filters: Object.keys(plan.filters),
      keywordQuery: plan.keywordQuery,
      semanticQuery: plan.semanticQuery,
    }),
  );
  plan.rawQuery = query;
  let queryResidual = plan.semanticQuery;

  const clause = planningInput.parsed.clauses[0];
  for (const filter of clause.filters) {
    applyFieldFilter(filter, plan);
  }
  if (clause.filters.length > 0) {
    compilerEvents.push(
      compilerEvent("compile", "query_language_filters", "Applied explicit query-language filters", {
        fields: clause.filters.map((filter) => filter.field),
      }),
    );
  }

  if (clause.genedMode) {
    if (clause.genedMode.any) {
      plan.filters.requirement = requirementFilter("any", clause.genedMode.any);
    }
    if (clause.genedMode.all) {
      plan.filters.requirement = requirementFilter("all", clause.genedMode.all);
    }
    compilerEvents.push(
      compilerEvent("compile", "query_language_requirements", "Applied explicit requirement mode", {
        mode: clause.genedMode.any ? "any" : "all",
      }),
    );
  }

  for (const negation of clause.negations) {
    applyNegationToken(negation, plan);
  }
  if (clause.negations.length > 0) {
    compilerEvents.push(
      compilerEvent("compile", "query_language_negations", "Applied explicit query-language negations", {
        negations: clause.negations,
      }),
    );
  }

  if (clause.phrases.length > 0) {
    const keywordPhrases = clause.phrases
      .map((phrase) => `"${phrase.replace(/"/g, '""')}"`)
      .join(" ");
    const semanticPhrases = clause.phrases.join(" ");
    plan.keywordQuery = appendQueryText(plan.keywordQuery, keywordPhrases);
    plan.semanticQuery = appendQueryText(plan.semanticQuery, semanticPhrases);
    compilerEvents.push(
      compilerEvent("compile", "quoted_phrases", "Added quoted phrases to retrieval query text", {
        phrases: clause.phrases,
      }),
    );
  }

  if (requestFilters) {
    const filterOverrides = searchPlanFiltersFromRequestFilters(requestFilters);
    Object.assign(plan.filters, filterOverrides);
    compilerEvents.push(
      compilerEvent("compile", "request_filter_overrides", "Applied canonical structured request filters", {
        filters: Object.keys(filterOverrides ?? {}),
      }),
    );
  }

  if (applyIntroductoryGatewayIntent(plan)) {
    queryResidual = plan.semanticQuery;
    compilerEvents.push(
      compilerEvent("compile", "introductory_gateway", "Compiled introductory subject search as gateway intent"),
    );
  }

  const rescueResult = applyDecisionSearchRescue(plan, query, queryResidual);
  queryResidual = rescueResult.queryResidual;
  if (plan.rescue) {
    compilerEvents.push(
      compilerEvent("rescue", "decision_search_rescue", "Compiled decision-oriented query rescue metadata", {
        queryTypes: plan.rescue.queryTypes,
        negativeTerms: plan.rescue.negativeTerms,
      }),
    );
  }

  if (applySortIntent(plan, query)) {
    queryResidual = removeSortScaffolding(queryResidual);
    compilerEvents.push(
      compilerEvent("compile", "sort_intent", "Compiled sort language into request sort intent", {
        sort: plan.softPreferences?.inferredSort,
      }),
    );
  }

  const topicExpansions = applyTopicExpansion(plan);
  syncDecisionSearchExpansions(plan, topicExpansions);
  if (topicExpansions.length > 0) {
    compilerEvents.push(
      compilerEvent("compile", "topic_expansion", "Expanded student topic language for retrieval recall", {
        expansions: topicExpansions,
      }),
    );
  }

  plan.keywordQuery = sanitizeFtsQuery(plan.keywordQuery);
  plan.semanticQuery = sanitizeFtsQuery(plan.semanticQuery);
  const fallbackPlans = buildFallbackPlans(plan, queryResidual);
  if (fallbackPlans.length > 0) {
    compilerEvents.push(
      compilerEvent("finalize", "fallback_plans", "Compiled low-result fallback retrieval plans", {
        fallbackPlans: fallbackPlans.length,
      }),
    );
  }
  compilerEvents.push(
    compilerEvent("finalize", "sanitize_and_freeze", "Sanitized retrieval query text and froze compiled plan"),
  );

  return deepFreeze({
    extraction: planningInput.extraction,
    queryResidual,
    plan,
    fallbackPlans,
    compilerEvents,
  });
}

function buildFallbackPlans(plan: SearchPlan, queryResidual: string): SearchPlan[] {
  const existingExpansions = Array.isArray(plan.softPreferences?.topicExpansions)
    ? plan.softPreferences.topicExpansions
    : [];
  if (existingExpansions.length > 0) {
    return [];
  }

  const expandedKeywords = expandTopics(queryResidual);
  if (expandedKeywords.length === 0) {
    return [];
  }

  return [{
    ...plan,
    keywordQuery: sanitizeFtsQuery(
      `${plan.keywordQuery} ${expandedKeywords.join(" ")}`,
    ),
    semanticQuery: sanitizeFtsQuery(
      `${plan.semanticQuery} ${expandedKeywords.join(" ")}`,
    ),
    softPreferences: {
      ...(plan.softPreferences ?? {}),
      topicExpansions: expandedKeywords,
    },
  }];
}

function compilerEvent(
  stage: SearchCompilerEventStage,
  type: string,
  summary: string,
  data?: Record<string, unknown>,
): SearchCompilerEvent {
  return data ? { stage, type, summary, data } : { stage, type, summary };
}
