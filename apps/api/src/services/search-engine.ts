import type { D1Database } from "@cloudflare/workers-types";
import {
  canonicalRequirementCodes,
  SEARCH_BROWSEABLE_RESULT_LIMIT,
  type CourseRegistrationSummaryDto,
  type SearchScope,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { Course } from "../db/types.js";
import { errorFields, logger } from "../observability/logger.js";
import { courseRequirementRowToDto, type CourseRequirementSourceRow } from "../transforms/course-requirements.js";
import { normalizeSectionAvailability } from "./section-availability-policy.js";
import type { SearchFilters, SearchPlan } from "./search-planner-types.js";
import type { RetrievalLane, SearchPipelineResult, SearchResult } from "./search-types.js";

type Controls = { sort: SearchSort; scope: SearchScope };
type TermRow = { term_id: string; year: number; term: string; status: string };
type CandidateRow = {
  id: string;
  lanes: string;
  lane_priority: number;
  text_score: number | null;
};
type CandidateRun = { succeeded: boolean; rows: CandidateRow[]; total: number };
type SqlValue = string | number;
type AddClause = (sql: string, ...values: SqlValue[]) => void;
type SectionQuery = {
  section: string[];
  meeting: string[];
  values: SqlValue[];
  joinMeetings: boolean;
  joinInstructors: boolean;
};

const TIME_RANGES: Record<string, [string?, string?]> = {
  early: [undefined, "09:00"], morning: [undefined, "12:00"], midday: ["10:00", "14:00"],
  afternoon: ["12:00", "17:00"], evening: ["17:00"],
};
const SORT_VALUE: Record<SearchSort["field"], (result: SearchResult) => number | null> = {
  relevance: result => result.score,
  gpa: result => result.course.avg_gpa,
  quality: result => result.course.quality_score,
  instructor_difficulty: result => result.course.difficulty_score,
  instructor_rating: result => result.course.primary_instructor_rmp,
  level: result => Number(result.course.number),
  credits: result => result.course.credit_hours,
};

export async function executeSearch(
  db: D1Database,
  plan: SearchPlan,
  requested: Controls,
): Promise<Pick<SearchPipelineResult, "results" | "totalResults"> & Pick<SearchPipelineResult["meta"], "controls" | "lanes" | "failedLanes">> {
  const controls = searchControls(requested, plan);
  const exact = isExactSearch(plan.filters);
  const keyword = plan.keywordQuery.trim();
  const fullText = fullTextQuery(keyword, plan.softPreferences?.topicExpansions);
  const lanes = retrievalLanes(exact, fullText);
  const terms = await loadTerms(db);
  const candidates = await runCandidateLane(db, plan.filters, controls, keyword, fullText, exact);
  const results = await hydrateResults(db, candidates.rows, plan, terms);
  results.sort(resultComparator(controls.sort, Boolean(plan.filters.term || plan.filters.year)));
  const limited = results.slice(0, SEARCH_BROWSEABLE_RESULT_LIMIT);
  return {
    results: limited,
    totalResults: candidates.total,
    controls,
    ...laneOutcomes(lanes, candidates.succeeded),
  };
}

function searchControls(requested: Controls, plan: SearchPlan): Controls {
  if (requested.sort.field !== "relevance" || !plan.softPreferences?.inferredSort) return requested;
  return { ...requested, sort: plan.softPreferences.inferredSort };
}

function isExactSearch(filters: SearchFilters): boolean {
  return Boolean(filters.crn || (filters.subject && filters.number));
}

function retrievalLanes(exact: boolean, fullText: string): RetrievalLane[] {
  if (exact) return ["exact"];
  return fullText ? ["official_text", "section_text"] : ["structured_course"];
}

function fullTextQuery(keyword: string, expansions: string[] = []): string {
  const clean = (value: string) => value.toLowerCase()
    .replace(/["'’]/g, " ").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const primary = clean(keyword);
  const alternatives = [...new Set(expansions.map(clean))]
    .filter(value => value && value !== primary)
    .map(value => value.includes(" ") ? `"${value}"` : value);
  return [primary, ...alternatives].filter(Boolean).join(" OR ");
}

async function loadTerms(db: D1Database): Promise<TermRow[]> {
  return db.prepare("SELECT term_id, year, term, status FROM term_state WHERE status IN ('active', 'registrable')")
    .all<TermRow>().then(result => result.results).catch(() => []);
}

async function runCandidateLane(
  db: D1Database,
  filters: SearchFilters,
  controls: Controls,
  keyword: string,
  fullText: string,
  exact: boolean,
): Promise<CandidateRun> {
  try {
    return { succeeded: true, ...await queryCandidates(db, candidateQuery(filters, controls, keyword, fullText, exact)) };
  } catch (error) {
    logger.warn("search.sql.failed", { ...errorFields(error) });
    return { succeeded: false, rows: [], total: 0 };
  }
}

async function queryCandidates(db: D1Database, query: ReturnType<typeof candidateQuery>): Promise<Pick<CandidateRun, "rows" | "total">> {
  const [candidates, count] = await Promise.all([
    db.prepare(query.rowsSql).bind(...query.params).all<CandidateRow>(),
    db.prepare(query.countSql).bind(...query.params).first<{ count: number }>(),
  ]);
  return { rows: candidates.results, total: count?.count ?? candidates.results.length };
}

function laneOutcomes(lanes: RetrievalLane[], succeeded: boolean): Pick<SearchPipelineResult["meta"], "lanes" | "failedLanes"> {
  return { lanes: succeeded ? lanes : [], failedLanes: succeeded ? [] : lanes };
}

async function hydrateResults(db: D1Database, candidateRows: CandidateRow[], plan: SearchPlan, terms: TermRow[]): Promise<SearchResult[]> {
  const ids = candidateRows.map(row => row.id);
  const [courseMap, requirements, registration] = await Promise.all([
    loadCourses(db, ids), loadRequirements(db, ids), loadRegistration(db, ids),
  ]);
  let keywordRank = 0;
  const termRank = termPriority(terms);
  return candidateRows.flatMap(row => {
    const course = courseMap.get(row.id);
    if (!course) return [];
    const laneMatches = row.lanes.split(",").filter(isLane);
    const hasKeyword = laneMatches.some(lane => lane === "official_text" || lane === "section_text");
    return [{
      course,
      requirements: requirements.get(row.id) ?? [],
      registrationSummary: registration.get(row.id),
      score: relevanceScore(course, plan, row),
      termPriority: termRank.get(`${course.year}-${course.term}`) ?? 2,
      historical: !termRank.has(`${course.year}-${course.term}`),
      ...(hasKeyword ? { keywordRank: ++keywordRank } : {}),
    }];
  });
}

function candidateQuery(
  filters: SearchFilters,
  controls: Controls,
  keyword: string,
  fullText: string,
  exact: boolean,
): { rowsSql: string; countSql: string; params: SqlValue[] } {
  const eligible = eligibleQuery(filters, controls.scope);
  const params: Array<string | number> = [...eligible.params];
  const ctes = [`eligible AS (${eligible.sql})`];
  const matches: string[] = [];
  if (exact || !fullText) {
    matches.push(`SELECT id, '${exact ? "exact" : "structured_course"}' lane, ${exact ? 0 : 3} lane_priority, NULL text_score FROM eligible`);
  }
  if (fullText) {
    matches.push(`SELECT c.id, 'official_text', 1, bm25(courses_fts)
      FROM courses_fts JOIN courses c ON c.rowid = courses_fts.rowid JOIN eligible e ON e.id = c.id
      WHERE courses_fts MATCH ?`);
    params.push(fullText);
    const title = keyword.replace(/"/g, "").toLowerCase();
    const escapedTitle = escapeLike(title);
    const prefixPattern = `${escapedTitle}%`;
    const containsPattern = `%${escapedTitle}%`;
    if (utf8Length(containsPattern) <= 50) {
      matches.push(`SELECT c.id, 'official_text', 0,
          CASE WHEN lower(c.title) = ? THEN 0 WHEN lower(c.title) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END
        FROM courses c JOIN eligible e ON e.id = c.id WHERE lower(c.title) LIKE ? ESCAPE '\\'`);
      params.push(title, prefixPattern, containsPattern);
    } else {
      matches.push(`SELECT c.id, 'official_text', 0, 0
        FROM courses c JOIN eligible e ON e.id = c.id WHERE lower(c.title) = ?`);
      params.push(title);
    }
    matches.push(`SELECT c.id, 'section_text', 2, bm25(sections_fts)
      FROM sections_fts JOIN sections s ON s.rowid = sections_fts.rowid
      JOIN courses c ON c.id = s.course_id JOIN eligible e ON e.id = c.id
      WHERE sections_fts MATCH ?`);
    params.push(fullText);
  }
  const withSql = `WITH ${ctes.join(",")}, matches(id,lane,lane_priority,text_score) AS (${matches.join(" UNION ALL ")}), ranked AS (
    SELECT id, group_concat(DISTINCT lane) lanes, min(lane_priority) lane_priority,
      min(text_score) text_score
    FROM matches GROUP BY id
  )`;
  const order = sqlOrder(controls.sort);
  return {
    params,
    rowsSql: `${withSql}
      SELECT ranked.*, c.year, c.term FROM ranked JOIN courses c ON c.id = ranked.id
      ORDER BY ${order} LIMIT ${SEARCH_BROWSEABLE_RESULT_LIMIT}`,
    countSql: `${withSql} SELECT count(*) count FROM ranked`,
  };
}

function eligibleQuery(filters: SearchFilters, scope: SearchScope): { sql: string; params: Array<string | number> } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  const add: AddClause = (sql, ...values) => { where.push(sql); params.push(...values); };
  addCourseIdentity(filters, add);
  addCourseAttributes(filters, add);
  addActiveScope(filters, scope, add);
  addRequirementFilter(filters, add);

  addSectionFilter(filters, add);

  addMeetingExclusions(filters, add);
  addCourseExclusions(filters, add);
  addRelationExclusions(filters, add);
  return { sql: `SELECT c.id FROM courses c${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`, params };
}

function addCourseIdentity(filters: SearchFilters, add: AddClause): void {
  if (filters.subject) add("c.subject = ?", filters.subject);
  if (filters.number) add("c.number = ?", filters.number);
  if (filters.credits !== undefined) add("c.credit_hours = ?", filters.credits);
  if (filters.year !== undefined) add("c.year = ?", filters.year);
  if (filters.term) add("c.term = ?", filters.term);
}

function addCourseAttributes(filters: SearchFilters, add: AddClause): void {
  if (filters.level !== undefined) {
    const operator = filters.level === 500 ? ">=" : "=";
    add(`CAST(substr(c.number, 1, 1) AS INTEGER) * 100 ${operator} ?`, filters.level);
  }
  if (filters.instructorDifficulty === "lower") add("c.difficulty_score <= ?", 45);
  if (filters.instructorDifficulty === "higher") add("c.difficulty_score > ?", 75);
}

function addActiveScope(filters: SearchFilters, scope: SearchScope, add: AddClause): void {
  if (scope !== "active" || filters.term || filters.year) return;
  add("EXISTS (SELECT 1 FROM term_state t WHERE t.year = c.year AND t.term = c.term AND t.status IN ('active','registrable'))");
}

function addRequirementFilter(filters: SearchFilters, add: AddClause): void {
  const requirement = filters.requirement;
  if (!requirement) return;
  const codes = canonicalRequirementCodes(requirement.codes);
  const matching = (alias: string) => `EXISTS (SELECT 1 FROM course_gened ${alias} WHERE ${alias}.course_id = c.id AND (${alias}.category_id = ? OR CASE WHEN ${alias}.attribute_code LIKE '1%' THEN substr(${alias}.attribute_code,2) ELSE ${alias}.attribute_code END = ?))`;
  if (requirement.mode === "all") {
    codes.forEach((code, index) => add(matching(`g${index}`), code, code));
    return;
  }
  if (!codes.length) return;
  const placeholders = marks(codes);
  add(`EXISTS (SELECT 1 FROM course_gened g WHERE g.course_id = c.id AND (g.category_id IN (${placeholders}) OR CASE WHEN g.attribute_code LIKE '1%' THEN substr(g.attribute_code,2) ELSE g.attribute_code END IN (${placeholders})))`, ...codes, ...codes);
}

function addSectionFilter(filters: SearchFilters, add: AddClause): void {
  const query: SectionQuery = { section: [], meeting: [], values: [], joinMeetings: false, joinInstructors: false };
  addSectionBasics(filters, query);
  addScheduleMeetings(filters, query);
  addDelivery(filters, query);
  addInstructorFilter(filters.instructor_ids, query, add);
  if (!query.section.length && !query.meeting.length) return;
  const meetings = query.joinMeetings ? "JOIN meetings m ON m.section_id = s.id" : "";
  const instructors = query.joinInstructors ? "JOIN meeting_instructors mi ON mi.meeting_id = m.id" : "";
  add(`EXISTS (SELECT 1 FROM sections s ${meetings} ${instructors} WHERE s.course_id = c.id AND ${[...query.section, ...query.meeting].join(" AND ")})`, ...query.values);
}

function addSectionBasics(filters: SearchFilters, query: SectionQuery): void {
  if (filters.crn) { query.section.push("s.crn = ?"); query.values.push(filters.crn); }
  if (filters.partOfTerm) { query.section.push("s.part_of_term = ?"); query.values.push(filters.partOfTerm); }
  if (filters.compressedTerm) query.section.push("coalesce(s.part_of_term,'') NOT IN ('','1')");
  if (!filters.status) return;
  const status = availabilitySql("s");
  if (filters.status === "available") query.section.push(`${status} IN ('open','restricted')`);
  else { query.section.push(`${status} = ?`); query.values.push(filters.status); }
}

function addScheduleMeetings(filters: SearchFilters, query: SectionQuery): void {
  if (filters.days) {
    query.joinMeetings = true;
    for (const day of [...new Set(filters.days.toUpperCase())]) { query.meeting.push("m.days LIKE ?"); query.values.push(`%${day}%`); }
  }
  if (filters.time) {
    query.joinMeetings = true;
    const [start, end] = TIME_RANGES[filters.time];
    if (start) { query.meeting.push("m.start_time >= ?"); query.values.push(start); }
    if (end) { query.meeting.push("m.start_time < ?"); query.values.push(end); }
  }
  if (filters.startAfterMinutes !== undefined) { query.joinMeetings = true; query.meeting.push("m.start_time >= ?"); query.values.push(clock(filters.startAfterMinutes)); }
  if (filters.startBeforeMinutes !== undefined) { query.joinMeetings = true; query.meeting.push("m.start_time < ?"); query.values.push(clock(filters.startBeforeMinutes)); }
}

function addDelivery(filters: SearchFilters, query: SectionQuery): void {
  if (filters.online === undefined) return;
  query.joinMeetings = true;
  const evidence = "(lower(coalesce(m.type_name,'')) LIKE '%online%' OR lower(coalesce(m.type_code,'')) LIKE '%online%' OR lower(coalesce(m.building_name,'')) LIKE '%online%' OR lower(coalesce(s.location,'')) LIKE '%online%')";
  query.meeting.push(filters.online ? evidence : `NOT ${evidence} AND nullif(trim(coalesce(nullif(m.building_name,''),s.location,'')),'') IS NOT NULL`);
}

function addInstructorFilter(ids: number[] | undefined, query: SectionQuery, add: AddClause): void {
  if (!ids) return;
  if (!ids.length) { add("0"); return; }
  query.joinMeetings = true;
  query.joinInstructors = true;
  query.meeting.push(`mi.instructor_id IN (${marks(ids)})`);
  query.values.push(...ids);
}

function addMeetingExclusions(filters: SearchFilters, add: AddClause): void {
  for (const value of filters.not?.time ?? []) {
    const range = TIME_RANGES[value];
    if (!range) continue;
    const conditions = ["s2.course_id = c.id"];
    const values: SqlValue[] = [];
    if (range[0]) { conditions.push("m2.start_time >= ?"); values.push(range[0]); }
    if (range[1]) { conditions.push("m2.start_time < ?"); values.push(range[1]); }
    add(`NOT EXISTS (SELECT 1 FROM sections s2 JOIN meetings m2 ON m2.section_id=s2.id WHERE ${conditions.join(" AND ")})`, ...values);
  }
  for (const value of filters.not?.days ?? []) {
    add("NOT EXISTS (SELECT 1 FROM sections s2 JOIN meetings m2 ON m2.section_id=s2.id WHERE s2.course_id=c.id AND m2.days LIKE ?)", `%${dayCode(value)}%`);
  }
}

function addCourseExclusions(filters: SearchFilters, add: AddClause): void {
  const subjects = filters.not?.subjects;
  if (subjects?.length) add(`c.subject NOT IN (${marks(subjects)})`, ...subjects);
  for (const word of filters.not?.keywords ?? []) {
    add("lower(coalesce(c.subject,'') || ' ' || coalesce(c.title,'') || ' ' || coalesce(c.description,'') || ' ' || coalesce(c.course_info,'') || ' ' || coalesce(c.degree_attributes,'')) NOT LIKE ?", `%${word.toLowerCase()}%`);
  }
}

function addRelationExclusions(filters: SearchFilters, add: AddClause): void {
  const instructors = filters.not?.instructor_ids;
  if (instructors?.length) {
    add(`NOT EXISTS (SELECT 1 FROM sections s2 JOIN meetings m2 ON m2.section_id=s2.id JOIN meeting_instructors mi2 ON mi2.meeting_id=m2.id WHERE s2.course_id=c.id AND mi2.instructor_id IN (${marks(instructors)}))`, ...instructors);
  }
  const codes = canonicalRequirementCodes(filters.not?.requirementCodes ?? []);
  if (codes.length) add(`NOT EXISTS (SELECT 1 FROM course_gened gn WHERE gn.course_id=c.id AND gn.category_id IN (${marks(codes)}))`, ...codes);
}

function relevanceScore(course: Course, plan: SearchPlan, row: CandidateRow): number {
  return (row.lanes.includes("exact") ? 100 : 10 - row.lane_priority)
    + (course.quality_score ?? 0) / 500
    + titleScore(course, plan.keywordQuery)
    + gatewayScore(course, plan.introductoryGateway)
    + preferenceScore(course, plan);
}

function titleScore(course: Course, keyword: string): number {
  const query = keyword.toLowerCase();
  const title = course.title.toLowerCase();
  if (!query) return 0;
  if (title === query) return 8;
  return title.includes(query) ? 4 : 0;
}

function gatewayScore(course: Course, enabled?: true): number {
  if (!enabled) return 0;
  const level = Number(course.number.slice(0, 1)) * 100;
  if (level === 100) return 4;
  return level >= 300 ? -2 : 0;
}

function preferenceScore(course: Course, plan: SearchPlan): number {
  const text = `${course.subject} ${course.title} ${course.description ?? ""}`.toLowerCase();
  return penalty(Boolean(plan.softPreferences?.lowMath), /\b(?:calculus|quantitative|statistics|math)\b/.test(text), .7)
    + penalty(Boolean(plan.softPreferences?.lowWriting), /\b(?:essay|writing|composition|paper)\b/.test(text), .5)
    + penalty(Boolean(plan.softPreferences?.noListedPrereq), /\bprereq/.test(course.course_info ?? ""), .4);
}

function penalty(enabled: boolean, matched: boolean, amount: number): number {
  return enabled && matched ? -amount : 0;
}

function resultComparator(sort: SearchSort, explicitTerm: boolean): (a: SearchResult, b: SearchResult) => number {
  const direction = sort.direction === "asc" ? 1 : -1;
  return (left, right) => compareResults(left, right, SORT_VALUE[sort.field], direction, explicitTerm);
}

function compareResults(
  left: SearchResult,
  right: SearchResult,
  value: (result: SearchResult) => number | null,
  direction: number,
  explicitTerm: boolean,
): number {
  const term = explicitTerm ? 0 : (left.termPriority ?? 2) - (right.termPriority ?? 2);
  if (term) return term;
  const sorted = compareNullable(value(left), value(right), direction);
  if (sorted) return sorted;
  return right.score - left.score || right.course.year - left.course.year || left.course.id.localeCompare(right.course.id);
}

function compareNullable(left: number | null, right: number | null, direction: number): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left === right ? 0 : (left - right) * direction;
}

function sqlOrder(sort: SearchSort): string {
  if (sort.field === "relevance") return "lane_priority, text_score, c.year DESC, c.subject, c.number";
  const column: Record<Exclude<SearchSort["field"], "relevance">, string> = {
    gpa: "c.avg_gpa", quality: "c.quality_score", instructor_difficulty: "c.difficulty_score",
    instructor_rating: "c.primary_instructor_rmp", level: "CAST(c.number AS INTEGER)", credits: "c.credit_hours",
  };
  return `${column[sort.field]} IS NULL, ${column[sort.field]} ${sort.direction.toUpperCase()}, c.year DESC, c.subject, c.number`;
}

async function loadCourses(db: D1Database, ids: string[]): Promise<Map<string, Course>> {
  const map = new Map<string, Course>();
  for (const batch of chunks(ids)) {
    const rows = await db.prepare(`SELECT * FROM courses WHERE id IN (${marks(batch)})`).bind(...batch).all<Course>();
    rows.results.forEach(row => map.set(row.id, row));
  }
  return map;
}

async function loadRequirements(db: D1Database, ids: string[]): Promise<Map<string, ReturnType<typeof courseRequirementRowToDto>[]>> {
  const map = new Map<string, ReturnType<typeof courseRequirementRowToDto>[]>();
  for (const batch of chunks(ids)) {
    const rows = await db.prepare(`SELECT course_id, category_id, category_name, attribute_code, attribute_name FROM course_gened WHERE course_id IN (${marks(batch)}) ORDER BY category_id, attribute_code`).bind(...batch).all<CourseRequirementSourceRow & { course_id: string }>();
    for (const row of rows.results) map.set(row.course_id, [...(map.get(row.course_id) ?? []), courseRequirementRowToDto(row)]);
  }
  return map;
}

async function loadRegistration(db: D1Database, ids: string[]): Promise<Map<string, CourseRegistrationSummaryDto>> {
  type Row = { course_id: string; status: string | null; status_code: string | null; section_status_code: string | null; last_synced: number | null };
  const map = new Map(ids.map(id => [id, emptyRegistration()]));
  const unknown = new Set<string>();
  for (const batch of chunks(ids)) {
    const rows = await db.prepare(`SELECT course_id,status,status_code,section_status_code,last_synced FROM sections WHERE course_id IN (${marks(batch)})`).bind(...batch).all<Row>();
    for (const row of rows.results) {
      const summary = map.get(row.course_id); if (!summary) continue;
      summary.total++;
      const status = normalizeSectionAvailability({ status: row.status, statusCode: row.status_code, sectionStatusCode: row.section_status_code }).status;
      if (status !== "unknown") summary[status]++;
      if (row.last_synced === null) { unknown.add(row.course_id); summary.lastSynced = null; }
      else if (!unknown.has(row.course_id)) summary.lastSynced = summary.lastSynced === null ? row.last_synced : Math.min(summary.lastSynced, row.last_synced);
    }
  }
  return map;
}

function emptyRegistration(): CourseRegistrationSummaryDto {
  return { total: 0, open: 0, restricted: 0, waitlisted: 0, closed: 0, cancelled: 0, lastSynced: null };
}
function termPriority(rows: TermRow[]): Map<string, number> {
  return new Map(rows.map(row => [row.term_id, row.status === "registrable" ? 0 : 1]));
}
function isLane(value: string): value is RetrievalLane {
  return ["exact", "official_text", "structured_course", "section_text"].includes(value);
}
function chunks<T>(values: T[], size = 80): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}
function marks(values: unknown[]): string { return values.map(() => "?").join(","); }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, match => `\\${match}`); }
function utf8Length(value: string): number { return new TextEncoder().encode(value).byteLength; }
function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function dayCode(value: string): string {
  return ({ monday: "M", tuesday: "T", wednesday: "W", thursday: "R", friday: "F" } as Record<string, string>)[value.toLowerCase()] ?? value.toUpperCase();
}
function availabilitySql(alias: string): string {
  const normalize = (column: string) => `CASE WHEN lower(coalesce(${column},'')) LIKE '%cancel%' THEN 'cancelled' WHEN lower(coalesce(${column},'')) LIKE '%wait%' THEN 'waitlisted' WHEN lower(coalesce(${column},'')) LIKE '%restrict%' THEN 'restricted' WHEN lower(coalesce(${column},'')) LIKE '%closed%' OR lower(coalesce(${column},''))='c' THEN 'closed' WHEN lower(coalesce(${column},'')) LIKE '%open%' OR lower(coalesce(${column},''))='a' THEN 'open' ELSE 'unknown' END`;
  return `coalesce(nullif(${normalize(`${alias}.status`)},'unknown'),nullif(${normalize(`${alias}.section_status_code`)},'unknown'),nullif(${normalize(`${alias}.status_code`)},'unknown'),'unknown')`;
}
