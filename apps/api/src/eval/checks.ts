import { canonicalRequirementCode } from '@uiuc-course-search/query-types';

export type ResultRule = {
  subjects?: string[];
  excludeSubjects?: string[];
  requirements?: string[];
  minLevel?: number;
  maxLevel?: number;
};

export type ResultSelector = {
  subject?: string;
  number?: string;
  titleIncludes?: string;
};

export type EvalScenario = {
  name: string;
  queries: string[];
  nonEmpty?: boolean;
  top?: ResultSelector[];
  all?: ResultRule;
};

type PublicCourse = {
  id: string;
  title: string;
  subject: string;
  number: string;
  requirements: string[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requirements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = record(item);
    if (!entry) return [];
    return [entry.categoryId, entry.category_id, entry.attributeCode, entry.attribute_code]
      .filter((value): value is string => typeof value === 'string')
      .map(canonicalRequirementCode)
      .filter((code): code is string => Boolean(code));
  });
}

export function normalizeResults(response: unknown): PublicCourse[] | undefined {
  const body = record(response);
  if (!Array.isArray(body?.results)) return undefined;

  return body.results.map((item) => {
    const result = record(item) ?? {};
    const course = record(result.course) ?? result;
    return {
      id: text(course.id ?? result.id),
      title: text(course.title ?? result.title),
      subject: text(course.subject ?? result.subject),
      number: text(course.number ?? result.number),
      requirements: requirements(course.requirements ?? result.requirements),
    };
  });
}

function level(course: PublicCourse): number | undefined {
  const value = Number.parseInt(course.number[0] ?? '', 10) * 100;
  return Number.isFinite(value) ? value : undefined;
}

function matches(selector: ResultSelector, course: PublicCourse): boolean {
  return (!selector.subject || course.subject === selector.subject)
    && (!selector.number || course.number === selector.number)
    && (!selector.titleIncludes
      || course.title.toLowerCase().includes(selector.titleIncludes.toLowerCase()));
}

export function evaluateScenario(
  scenario: EvalScenario,
  response: unknown,
): string[] {
  const results = normalizeResults(response);
  if (!results) return ['response.results must be an array'];
  const top = results.slice(0, 10);
  return [...topFailures(scenario, results, top), ...ruleFailures(scenario.all, top)];
}

function topFailures(scenario: EvalScenario, results: PublicCourse[], top: PublicCourse[]): string[] {
  const failures = scenario.nonEmpty && results.length === 0 ? ['expected results'] : [];
  for (const selector of scenario.top ?? []) {
    if (!top.some(course => matches(selector, course))) {
      failures.push(`top 10 missing ${JSON.stringify(selector)}`);
    }
  }
  return failures;
}

function ruleFailures(rule: ResultRule | undefined, top: PublicCourse[]): string[] {
  if (!rule) return [];
  const allowedSubjects = new Set(rule.subjects);
  const excludedSubjects = new Set(rule.excludeSubjects);
  const required = (rule.requirements ?? [])
    .map(canonicalRequirementCode)
    .filter((code): code is string => Boolean(code));
  return top.flatMap(course => courseFailures(course, rule, allowedSubjects, excludedSubjects, required));
}

function courseFailures(
  course: PublicCourse,
  rule: ResultRule,
  allowed: Set<string>,
  excluded: Set<string>,
  required: string[],
): string[] {
  return [
    ...subjectFailures(course, allowed, excluded),
    ...required.filter(code => !course.requirements.includes(code))
      .map(code => `${course.id || course.title} lacks ${code}`),
    ...levelFailures(course, rule),
  ];
}

function subjectFailures(course: PublicCourse, allowed: Set<string>, excluded: Set<string>): string[] {
  const failures: string[] = [];
  if (allowed.size && !allowed.has(course.subject)) {
    failures.push(`${course.id || course.title} has subject ${course.subject}`);
  }
  if (excluded.has(course.subject)) {
    failures.push(`${course.id || course.title} has excluded subject ${course.subject}`);
  }
  return failures;
}

function levelFailures(course: PublicCourse, rule: ResultRule): string[] {
  const failures: string[] = [];
  const courseLevel = level(course);
  if (rule.minLevel !== undefined && (courseLevel === undefined || courseLevel < rule.minLevel)) {
    failures.push(`${course.id || course.title} is below level ${rule.minLevel}`);
  }
  if (rule.maxLevel !== undefined && (courseLevel === undefined || courseLevel > rule.maxLevel)) {
    failures.push(`${course.id || course.title} is above level ${rule.maxLevel}`);
  }
  return failures;
}
