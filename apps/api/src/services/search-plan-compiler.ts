import type { D1Database } from "@cloudflare/workers-types";
import {
  GENERIC_REQUIREMENT_CODES,
  isKnownRequirementCode,
  isSearchInstructorDifficultyFilter,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  requirementFilter,
  singleRequirementFilter,
  type SearchRequestFiltersDto,
  type SearchSort,
  type SearchTermFilter,
} from "@warlock-v2/query-types";
import type { Hint, SearchFilters, SearchPlan } from "./search-planner-types.js";

export type SearchPlanningResult = { hints: Hint[]; residual: string; plan: SearchPlan };
type State = { text: string; filters: SearchFilters; hints: Hint[]; levelBoost?: number };
type PowerResult = { type: Hint["type"]; value: unknown } | null;

const SUBJECT_ALIASES: Record<string, string> = {
  "comp sci": "CS", compsci: "CS", "computer science": "CS",
  econ: "ECON", economics: "ECON", stats: "STAT", statistics: "STAT",
  psych: "PSYC", psychology: "PSYC", philosophy: "PHIL",
  "political science": "PS", "information sciences": "IS",
  "art history": "ARTH", "electrical computer engineering": "ECE",
  spanish: "SPAN", chemistry: "CHEM", physics: "PHYS",
  math: "MATH", mathematics: "MATH", biology: "MCB",
};
const UNSAFE_CODES = new Set(["as", "at", "be", "in", "is", "it", "of", "or"]);
const REQUIREMENTS: Array<[string, RegExp]> = [
  ["CS", /\bcultural studies(?:\s+gen\s*ed)?\b/i],
  ["HUM", /\b(?:humanities(?:\s+(?:and|&)\s+the\s+arts)?|hum\s+gen\s*ed)\b/i],
  ["NAT", /\b(?:natural sciences?(?:\s+and\s+technology)?|nat\s+gen\s*ed)\b/i],
  ["SBS", /\b(?:social\s+(?:and\s+behavioral\s+)?sciences?|sbs\s+gen\s*ed)\b/i],
  ["QR1", /\b(?:quantitative reasoning\s*(?:i|1)|qr\s*1)\b/i],
  ["QR2", /\b(?:quantitative reasoning\s*(?:ii|2)|qr\s*2)\b/i],
  ["QR", /\b(?:quantitative reasoning|qr\s+gen\s*ed)\b/i],
  ["ACP", /\b(?:advanced composition|writing intensive)\b/i],
  ["COMP1", /\b(?:composition\s*(?:i|1)|freshman comp)\b/i],
  ["NW", /\bnon[- ]western(?: cultures?)?\b/i],
  ["US", /\bus minority(?: cultures?)?\b/i],
  ["WCC", /\bwestern(?:\/| and )comparative(?: cultures?)?\b/i],
];
const TIMES = ["early", "morning", "midday", "afternoon", "evening"] as const;
const DAYS: Array<[string, RegExp]> = [
  ["MWF", /\b(?:mwf|monday\s+wednesday\s+friday|mon\s+wed\s+fri)\b/i],
  ["TR", /\b(?:tr|tuth|tuesday\s+thursday|tue\s+thu(?:r)?)\b/i],
  ["MW", /\b(?:mw|monday\s+wednesday|mon\s+wed)\b/i],
  ["WF", /\b(?:wf|wednesday\s+friday|wed\s+fri)\b/i],
];
const TOPICS: Array<[RegExp, string[]]> = [
  [/\bmachine learning\b/i, ["artificial intelligence", "statistical learning"]],
  [/\bdata science\b/i, ["data analysis", "statistics", "machine learning"]],
  [/\bweb development\b/i, ["web programming", "internet applications"]],
  [/\bclimate change\b/i, ["climate", "environment", "sustainability"]],
];

const POWER_FIELDS: Record<string, (value: string, filters: SearchFilters) => PowerResult> = {
  subject: (value, filters) => /^[a-z]{2,4}$/i.test(value)
    ? assign(filters, "subject", value.toUpperCase(), "subject") : null,
  requirement: (value, filters) => isKnownRequirementCode(value)
    ? assign(filters, "requirement", singleRequirementFilter(value), "requirement") : null,
  credits: (value, filters) => Number.isInteger(Number(value))
    ? assign(filters, "credits", Number(value), "credits") : null,
  level: (value, filters) => isSearchLevelFilter(Number(value))
    ? assign(filters, "level", Number(value), "level") : null,
  crn: (value, filters) => /^\d{5,6}$/.test(value)
    ? assign(filters, "crn", value, "crn") : null,
  status: (value, filters) => isSearchStatusFilter(value.toLowerCase())
    ? assign(filters, "status", value.toLowerCase(), "status") : null,
  online: (value, filters) => assign(filters, "online", !/^(?:false|no|0|in[-_]?person)$/i.test(value), "online"),
  days: (value, filters) => /^[mtwrfsu]{1,7}$/i.test(value)
    ? assign(filters, "days", value.toUpperCase(), "days") : null,
  time: (value, filters) => isSearchTimeFilter(value.toLowerCase())
    ? assign(filters, "time", value.toLowerCase(), "time") : null,
  partofterm: (value, filters) => /^[a-z0-9]$/i.test(value)
    ? assign(filters, "partOfTerm", value.toUpperCase(), "partOfTerm") : null,
  instructordifficulty: (value, filters) => isSearchInstructorDifficultyFilter(value.toLowerCase())
    ? assign(filters, "instructorDifficulty", value.toLowerCase(), "instructorDifficulty") : null,
  term: (value, filters) => {
    const term = parseTerm(value);
    if (!term) return null;
    Object.assign(filters, term);
    return { type: "term", value: term };
  },
};

export async function createSearchPlan(
  db: D1Database,
  rawQuery: string,
  requestFilters: SearchRequestFiltersDto = {},
): Promise<SearchPlanningResult> {
  const state: State = { text: rawQuery, filters: {}, hints: [] };
  parsePowerSyntax(state);
  parseEntities(state);
  parseNegations(state);
  parseAttributes(state);
  parseRequirements(state);
  parseSchedule(state);
  await parseInstructor(db, state);
  await parseSubject(db, state);
  await applyRequestFilters(db, state, requestFilters);

  const residual = cleanQuery(state.text);
  const softPreferences = preferences(rawQuery, state.levelBoost);
  const plan: SearchPlan = {
    filters: state.filters,
    keywordQuery: sanitizeFtsQuery(residual),
    ...(state.filters.subject && state.levelBoost ? { introductoryGateway: true as const } : {}),
    ...(Object.keys(softPreferences).length ? { softPreferences } : {}),
  };
  plan.ambiguities = subjectRequirementAmbiguity(rawQuery, state.filters.subject);
  return { hints: state.hints, residual, plan };
}

function parsePowerSyntax(state: State): void {
  take(state, /(?:requirement|gened):(?:any|all)\(([^)]+)\)/i, match => {
    const mode = /:all\(/i.test(match[0]) ? "all" : "any";
    const codes = match[1].split(",").map(code => code.trim().toUpperCase()).filter(isKnownRequirementCode);
    const value = requirementFilter(mode, codes);
    if (value) { state.filters.requirement = value; emit(state, "requirement", value, match[0], "regex"); }
  });
  take(state, /\b(subject|requirement|gened|credits|level|crn|status|online|days|time|term|part(?:_|-)?of(?:_|-)?term|pot|instructor(?:_|-)?difficulty):([^\s]+)/i, match => {
    const field = normalizePowerField(match[1]);
    const result = POWER_FIELDS[field]?.(match[2], state.filters);
    if (result) emit(state, result.type, result.value, match[0], "regex");
  });
  state.text = state.text.replace(/"([^"]+)"/g, "$1");
}

function parseEntities(state: State): void {
  take(state, /\b([a-z]{2,4})\s*(\d{3})\b(?!\s*-?\s*level)/i, match => {
    const value = { subject: match[1].toUpperCase(), number: match[2] };
    Object.assign(state.filters, value); emit(state, "courseCode", value, match[0], "regex");
  });
  take(state, /\b(?:crn\s*)?(\d{5,6})\b/i, match => {
    state.filters.crn = match[1]; emit(state, "crn", match[1], match[0], "regex");
  });
  take(state, /\b(spring|summer|fall|winter)\s+(20\d{2})\b/i, match => {
    const value = { term: match[1].toLowerCase() as SearchTermFilter, year: Number(match[2]) };
    Object.assign(state.filters, value); emit(state, "term", value, match[0], "regex");
  });
  take(state, /\b(?:part\s+of\s+term|pot)\s+([a-z0-9])\b|\b(first|second)\s+half\b/i, match => {
    const value = match[1]?.toUpperCase() ?? (match[2].toLowerCase() === "first" ? "A" : "B");
    state.filters.partOfTerm = value; emit(state, "partOfTerm", value, match[0]);
  });
}

function parseNegations(state: State): void {
  take(state, /\b(?:no|not|avoid|without)\s+(online|remote|virtual|asynchronous)\b/i, match => {
    state.filters.online = false;
    emit(state, "online", false, match[0]);
  });
  take(state, /\b(?:no|avoid|without)\s+(early|morning|midday|afternoon|evening|night)\b/i, match => {
    const value = match[1].toLowerCase() === "night" ? "evening" : match[1].toLowerCase();
    (state.filters.not ??= {}).time = [...(state.filters.not?.time ?? []), value];
    emit(state, "negation", { target: "time", value }, match[0]);
  });
  take(state, /\b(?:no|avoid|without)\s+(monday|tuesday|wednesday|thursday|friday|mwf|tr|mw|wf)\b/i, match => {
    const value = match[1].toLowerCase();
    (state.filters.not ??= {}).days = [...(state.filters.not?.days ?? []), value];
    emit(state, "negation", { target: "days", value }, match[0]);
  });
  take(state, /\b(?:no|avoid|without)\s+(math|mathematics|statistics|stats|computer science|chemistry|physics|biology)\b/i, match => {
    const value = SUBJECT_ALIASES[match[1].toLowerCase()] ?? match[1].slice(0, 4).toUpperCase();
    (state.filters.not ??= {}).subjects = [...(state.filters.not?.subjects ?? []), value];
    emit(state, "negation", { target: "subject", value }, match[0]);
  });
  take(state, /\b(?:no|avoid|without)\s+(exams?|tests?|quizzes?|midterms?|finals?|essays?|papers?|writing|reading|labs?|coding|programming|group projects?)\b|\bnot\s+((?:writing|reading|math)[- ]heavy)\b/i, match => {
    const value = workloadKeyword(match[1] ?? match[2]);
    (state.filters.not ??= {}).keywords = [...(state.filters.not?.keywords ?? []), value];
    emit(state, "negation", { target: "workload", value }, match[0]);
  });
}

function parseAttributes(state: State): void {
  take(state, /\b(\d(?:\.\d)?)\s*-?\s*(?:credit|credits|hours?)\b/i, match => {
    state.filters.credits = Number(match[1]); emit(state, "credits", state.filters.credits, match[0]);
  });
  take(state, /\b(100|200|300|400|500)\s*-?\s*level\b/i, match => {
    const value = Number(match[1]) as NonNullable<SearchFilters["level"]>;
    state.filters.level = value; emit(state, "level", value, match[0]);
  });
  take(state, /\b(?:graduate|grad)\b/i, match => {
    state.filters.level = 500; emit(state, "level", 500, match[0]);
  });
  take(state, /\b(?:intro(?:ductory)?|beginner|freshman|first[- ]year)\b(?:\s+to)?/i, match => {
    state.levelBoost = 100; emit(state, "levelBoost", 100, match[0]);
  });
}

function parseRequirements(state: State): void {
  for (const [code, pattern] of REQUIREMENTS) take(state, pattern, match => {
    state.filters.requirement = singleRequirementFilter(code);
    emit(state, "requirement", code, match[0]);
  });
  take(state, /\b(?:any\s+)?gen[- ]?ed(?:\s+(?:course|class|requirement))?s?\b/i, match => {
    state.filters.requirement ??= requirementFilter("any", GENERIC_REQUIREMENT_CODES);
    if (state.filters.requirement) emit(state, "requirement", state.filters.requirement, match[0]);
  });
}

function parseSchedule(state: State): void {
  take(state, /\b(?:in[- ]person|on[- ]campus|face[- ]to[- ]face)\b/i, match => {
    state.filters.online = false; emit(state, "online", false, match[0]);
  });
  take(state, /\b(?:online|remote|virtual|asynchronous|async)\b/i, match => {
    state.filters.online = true; emit(state, "online", true, match[0]);
  });
  take(state, /\b(?:not\s+full|has\s+seats|available|open)(?:\s+sections?)?\b/i, match => {
    state.filters.status = "open"; emit(state, "status", "open", match[0]);
  });
  take(state, /\b(?:closed|full|waitlisted?)(?:\s+sections?)?\b/i, match => {
    state.filters.status = "closed"; emit(state, "status", "closed", match[0]);
  });
  for (const [value, pattern] of DAYS) take(state, pattern, match => {
    state.filters.days = value; emit(state, "days", value, match[0]);
  });
  for (const value of TIMES) take(state, new RegExp(`\\b${value}\\b`, "i"), match => {
    state.filters.time = value; emit(state, "time", value, match[0]);
  });
  take(state, /\b(after|before)\s+(lunch|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i, match => {
    const minutes = match[2].toLowerCase() === "lunch" ? 720 : parseClock(match[2]);
    state.filters[match[1].toLowerCase() === "after" ? "startAfterMinutes" : "startBeforeMinutes"] = minutes;
    emit(state, "time", match[0], match[0]);
  });
  take(state, /\b(?:compressed|eight[- ]week|8[- ]week|half[- ]semester)\b/i, match => {
    state.filters.compressedTerm = true; emit(state, "partOfTerm", "compressed", match[0]);
  });
}

async function parseInstructor(db: D1Database, state: State): Promise<void> {
  const match = /\b(?:professor|prof|instructor|taught\s+by|with)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*)?)/i.exec(state.text);
  if (!match) return;
  const resolved = await resolveInstructor(db, match[1]);
  if (!resolved.ids.length) return;
  state.filters.instructor_ids = resolved.ids;
  emit(state, "instructor", match[1], match[0]);
  state.text = state.text.replace(match[0], ` ${resolved.residual} `);
}

async function parseSubject(db: D1Database, state: State): Promise<void> {
  if (state.filters.subject) return;
  const subject = await resolveSubject(db, state.text);
  if (!subject) return;
  state.filters.subject = subject.code;
  emit(state, "subject", subject.code, subject.raw, subject.source);
  state.text = removePhrase(state.text, subject.raw);
}

async function applyRequestFilters(db: D1Database, state: State, source: SearchRequestFiltersDto): Promise<void> {
  const { instructor, ...filters } = source;
  Object.assign(state.filters, filters);
  if (instructor) state.filters.instructor_ids = (await resolveInstructor(db, instructor)).ids;
  for (const [type, value] of Object.entries(source)) {
    if (value !== undefined && !["number", "term", "year"].includes(type)) {
      emit(state, type as Hint["type"], value, String(value), "request");
    }
  }
  if (isSearchTermFilter(source.term)) {
    const value = Number.isInteger(source.year)
      ? { term: source.term, year: source.year as number }
      : { term: source.term };
    emit(state, "term", value, value.year ? `${value.term} ${value.year}` : value.term, "request");
  }
}

function preferences(rawQuery: string, levelBoost?: number): NonNullable<SearchPlan["softPreferences"]> {
  const value: NonNullable<SearchPlan["softPreferences"]> = {};
  const rules: Array<[RegExp, () => void]> = [
    [/\b(?:easy|easier|light workload|low workload)\b/i, () => Object.assign(value, { lowWriting: .7, lowReading: .7, lowMath: .7, lowExams: .7 })],
    [/\b(?:no|avoid|without)\s+(?:exams?|tests?|quizzes?|midterms?|finals?)\b/i, () => { value.lowExams = .88; }],
    [/\b(?:no|avoid|without)\s+(?:essays?|papers?|writing)\b|\bnot\s+writing[- ]heavy\b/i, () => { value.lowWriting = .9; }],
    [/\b(?:no|avoid|without)\s+reading\b|\bnot\s+reading[- ]heavy\b/i, () => { value.lowReading = .78; }],
    [/\b(?:no|avoid|without)\s+(?:math|coding|programming)\b|\bnot\s+math[- ]heavy\b/i, () => { value.lowMath = .86; }],
    [/\b(?:fun|interesting|enjoyable)\b/i, () => { value.fun = .7; }],
    [/\b(?:non[- ]major|outside my major|no prerequisites?)\b/i, () => Object.assign(value, { nonMajorFriendly: .8, noListedPrereq: true })],
  ];
  rules.forEach(([pattern, apply]) => { if (pattern.test(rawQuery)) apply(); });
  if (levelBoost) value.levelBoost = levelBoost;
  value.topicExpansions = TOPICS.find(([pattern]) => pattern.test(rawQuery))?.[1];
  const sorts: Array<[RegExp, SearchSort]> = [
    [/\bsort(?:ed)?\s+by\s+(?:instructor\s+)?difficulty\b/i, { field: "instructor_difficulty", direction: "asc" } as const],
    [/\bsort(?:ed)?\s+by\s+gpa\b|\bhighest\s+gpa\b/i, { field: "gpa", direction: "desc" } as const],
    [/\bsort(?:ed)?\s+by\s+quality\b|\bbest[- ]rated\b/i, { field: "quality", direction: "desc" } as const],
  ];
  value.inferredSort = sorts.find(([pattern]) => pattern.test(rawQuery))?.[1];
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function subjectRequirementAmbiguity(rawQuery: string, subject?: string): SearchPlan["ambiguities"] {
  if (!subject || !["CS", "PS"].includes(subject) || /\b(?:gen\s*ed|requirement)\b/i.test(rawQuery)) return undefined;
  return [{
    term: subject,
    alternatives: [{ type: "requirement", value: subject, label: `${subject} GenEd` }],
  }];
}

async function resolveSubject(db: D1Database, text: string): Promise<{ code: string; raw: string; source: "alias" | "regex" } | null> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const candidates: Array<{ raw: string; code: string; source: "alias" | "regex" }> =
    Object.entries(SUBJECT_ALIASES).map(([raw, code]) => ({ raw, code, source: "alias" }));
  try {
    const subjects = await db.prepare("SELECT id, name FROM subjects").all<{ id: string; name: string }>();
    for (const row of subjects.results) {
      candidates.push({ raw: row.name.toLowerCase(), code: row.id, source: "alias" });
      if (!UNSAFE_CODES.has(row.id.toLowerCase())) candidates.push({ raw: row.id.toLowerCase(), code: row.id, source: "regex" });
    }
  } catch { /* Explicit and topical search still work without the subject catalog. */ }
  const exact = candidates
    .filter(candidate => new RegExp(`(?:^| )${escapeRegex(candidate.raw)}(?: |$)`).test(normalized))
    .sort((left, right) => right.raw.length - left.raw.length)[0];
  if (exact || normalized.includes(" ")) return exact ?? null;
  const fuzzy = candidates
    .filter(candidate => candidate.raw.length >= 6 && editDistance(candidate.raw, normalized) <= 2)
    .sort((left, right) => editDistance(left.raw, normalized) - editDistance(right.raw, normalized))[0];
  return fuzzy ? { ...fuzzy, raw: normalized } : null;
}

async function resolveInstructor(db: D1Database, name: string): Promise<{ ids: number[]; residual: string }> {
  const words = name.trim().split(/\s+/);
  for (let end = words.length; end > 0; end--) {
    const needle = words.slice(0, end).join(" ").toLowerCase();
    const pattern = `%${needle}%`;
    const statement = new TextEncoder().encode(pattern).byteLength <= 50
      ? db.prepare("SELECT id FROM instructors WHERE LOWER(last_name) LIKE ? OR LOWER(display_name) LIKE ? LIMIT 10").bind(pattern, pattern)
      : db.prepare("SELECT id FROM instructors WHERE LOWER(last_name) = ? OR LOWER(display_name) = ? LIMIT 10").bind(needle, needle);
    const result = await statement.all<{ id: number }>();
    if (result.results.length) return { ids: result.results.map(row => row.id), residual: words.slice(end).join(" ") };
  }
  return { ids: [], residual: "" };
}

function take(state: State, pattern: RegExp, apply: (match: RegExpExecArray) => void): void {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  state.text = state.text.replace(new RegExp(pattern.source, flags), (...parts: unknown[]) => {
    const match = parts.slice(0, -2) as string[];
    apply(Object.assign(match, { index: Number(parts.at(-2)), input: String(parts.at(-1)) }) as RegExpExecArray);
    return " ";
  });
}

function emit<K extends Hint["type"]>(state: State, type: K, value: unknown, raw: string, source: Hint["metadata"]["source"] = "nlp"): void {
  state.hints.push({ type, value, metadata: { source, raw } } as unknown as Hint);
}

function assign<K extends keyof SearchFilters>(filters: SearchFilters, key: K, value: unknown, type: Hint["type"]): PowerResult {
  (filters as Record<string, unknown>)[key] = value;
  return value === undefined ? null : { type, value };
}

function normalizePowerField(field: string): string {
  const normalized = field.toLowerCase().replace(/[-_]/g, "");
  if (normalized === "gened") return "requirement";
  if (normalized === "pot") return "partofterm";
  return normalized;
}

function parseTerm(value: string): { term: SearchTermFilter; year: number } | null {
  const match = /^(?:(spring|summer|fall|winter)[-_]?(20\d{2})|(20\d{2})[-_]?(spring|summer|fall|winter))$/i.exec(value);
  const term = (match?.[1] ?? match?.[4])?.toLowerCase();
  const year = Number(match?.[2] ?? match?.[3]);
  return isSearchTermFilter(term) && year >= 2000 ? { term, year } : null;
}

function parseClock(value: string): number {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) return 0;
  let hour = Number(match[1]);
  if (match[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (match[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
  return hour * 60 + Number(match[2] ?? 0);
}

function cleanQuery(value: string): string {
  return value
    .replace(/\b(?:sort(?:ed)?\s+by\s+(?:instructor\s+)?(?:difficulty|gpa|quality)|highest\s+gpa|best[- ]rated)\b/gi, " ")
    .replace(/\b(?:easy|easier|fun|interesting|enjoyable|class|classes|course|courses|sections?|only|please)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function sanitizeFtsQuery(value: string): string {
  return value
    .replace(/c\/c\+\+/gi, "c cplusplus").replace(/c\+\+/gi, "cplusplus")
    .replace(/c#/gi, "csharp").replace(/\.net/gi, "dotnet")
    .replace(/["'’]/g, " ").replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function workloadKeyword(value: string): string {
  if (/exam|test|quiz|midterm|final/i.test(value)) return "exam";
  if (/essay|paper|writing/i.test(value)) return "writing";
  if (/reading/i.test(value)) return "reading";
  if (/lab/i.test(value)) return "lab";
  if (/group/i.test(value)) return "group project";
  return /math/i.test(value) ? "math" : "coding";
}

function removePhrase(text: string, phrase: string): string {
  return text.replace(new RegExp(`\\b${escapeRegex(phrase).replace(/\\ /g, "\\s+")}\\b`, "i"), " ");
}
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(left[i - 1] !== right[j - 1]));
    previous = current;
  }
  return previous[right.length];
}
