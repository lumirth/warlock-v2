import type { D1Database } from '@cloudflare/workers-types';
import {
  GENED_REQUIREMENT_LABELS,
  resolveRequirementAlias,
  singleRequirementFilter,
} from '@uiuc-course-search/query-types';
import type { Hint, SearchPlan } from './search-planner-types.js';
import { escapeLike, escapeRegex } from './search-text.js';
import {
  FUZZY_SUBJECT_NAME_BLOCKLIST,
  SUBJECT_REQUIREMENT_CONFLICTS,
} from './student-language-lexicon.js';

type InterpretationType = 'subject' | 'requirement';

export function resolveRequirement(value: string, plan: SearchPlan): void {
  const code = resolveRequirementAlias(value);

  if (code) {
    plan.filters.requirement = singleRequirementFilter(code);
  } else {
    plan.filters.requirement = singleRequirementFilter(value);
  }
}

export async function resolveSubjectHint(
  db: D1Database,
  hint: Extract<Hint, { type: 'subject' }>,
  subject: string,
  plan: SearchPlan,
  rawQuery: string
): Promise<void> {
  if (!SUBJECT_REQUIREMENT_CONFLICTS.has(subject)) {
    plan.filters.subject = subject;
    return;
  }

  const requirementCode = resolveRequirementAlias(subject);
  if (!requirementCode) {
    plan.filters.subject = subject;
    return;
  }

  const decision = chooseSubjectOrRequirementInterpretation({
    subject,
    hint,
    rawQuery,
  });

  if (decision.preferred === 'requirement') {
    delete plan.filters.subject;
    plan.filters.requirement = singleRequirementFilter(requirementCode);
    await addSubjectRequirementAmbiguity(db, plan, {
      term: hint.metadata.raw,
      chosen: 'requirement',
      subject,
      requirementCode,
    });
    return;
  }

  plan.filters.subject = subject;
  if (decision.showAlternative) {
    await addSubjectRequirementAmbiguity(db, plan, {
      term: hint.metadata.raw,
      chosen: 'subject',
      subject,
      requirementCode,
    });
  }
}

export async function validateSubject(
  db: D1Database,
  subject: string
): Promise<string | null> {
  const normalized = subject.toLowerCase().trim();
  const upper = subject.toUpperCase();

  const byCode = await db.prepare('SELECT id FROM subjects WHERE id = ?')
    .bind(upper)
    .first<{ id: string }>();
  if (byCode) return byCode.id;

  const byName = await db.prepare('SELECT id FROM subjects WHERE LOWER(name) = ?')
    .bind(normalized)
    .first<{ id: string }>();
  if (byName) return byName.id;

  const fuzzyClauses: string[] = [];
  const fuzzyParams: string[] = [];
  if (isFuzzySubjectNameCandidate(normalized)) {
    fuzzyClauses.push("LOWER(name) LIKE ? ESCAPE '\\'");
    fuzzyParams.push(`%${escapeLike(normalized)}%`);
  }
  if (isFuzzySubjectCodeCandidate(normalized)) {
    fuzzyClauses.push("id LIKE ? ESCAPE '\\'");
    fuzzyParams.push(`%${escapeLike(upper)}%`);
  }

  if (fuzzyClauses.length > 0) {
    const fuzzy = await db.prepare(`
      SELECT id FROM subjects
      WHERE ${fuzzyClauses.join(' OR ')}
      LIMIT 1
    `)
      .bind(...fuzzyParams)
      .first<{ id: string }>();
    if (fuzzy) return fuzzy.id;
  }

  const byCourse = await db.prepare('SELECT DISTINCT subject FROM courses WHERE subject = ? LIMIT 1')
    .bind(upper)
    .first<{ subject: string }>();
  if (byCourse) return byCourse.subject;

  return null;
}

function chooseSubjectOrRequirementInterpretation(context: {
  subject: string;
  hint: Extract<Hint, { type: 'subject' }>;
  rawQuery: string;
}): { preferred: InterpretationType; showAlternative: boolean } {
  const raw = context.rawQuery;
  const hintRaw = context.hint.metadata.raw;

  if (hasExplicitSubjectField(context.subject, raw)) {
    return { preferred: 'subject', showAlternative: false };
  }

  if (hasExplicitSubjectPhrase(context.subject, hintRaw, raw)) {
    return { preferred: 'subject', showAlternative: false };
  }

  const requirementScore = interpretationScore([
    [mentionsRequirementCodeAlias(context.subject, raw), 5],
    [hasRequirementCue(raw), 3],
    [hasStudentShoppingCue(raw), 2],
  ]);

  const subjectScore = interpretationScore([
    [hasSubjectBrowseCue(raw) && !hasStudentShoppingCue(raw), 3],
    [isBareUppercaseSubjectCode(context.subject, raw), 1],
  ]);

  if (requirementScore > subjectScore) {
    return { preferred: 'requirement', showAlternative: true };
  }

  return {
    preferred: 'subject',
    showAlternative: requirementScore > 0 || isShortAmbiguousCode(hintRaw),
  };
}

function interpretationScore(signals: Array<[boolean, number]>): number {
  return signals.reduce((score, [enabled, value]) => score + (enabled ? value : 0), 0);
}

function hasExplicitSubjectField(subject: string, rawQuery: string): boolean {
  return new RegExp(`\\bsubject\\s*:\\s*${escapeRegex(subject)}\\b`, 'i').test(rawQuery);
}

function hasExplicitSubjectPhrase(subject: string, hintRaw: string, rawQuery: string): boolean {
  if (subject === 'CS') {
    return /\b(?:computer\s+science|comp\s+sci)\b/i.test(hintRaw)
      || /\b(?:computer\s+science|comp\s+sci)\b/i.test(rawQuery);
  }

  if (subject === 'PS') {
    return /\bpolitical\s+science\b/i.test(hintRaw)
      || /\bpolitical\s+science\b/i.test(rawQuery);
  }

  return false;
}

function mentionsRequirementCodeAlias(subject: string, rawQuery: string): boolean {
  return new RegExp(`\\b${escapeRegex(subject)}\\s+gen\\s*-?\\s*ed\\b`, 'i').test(rawQuery)
    || new RegExp(`\\bgen\\s*-?\\s*ed\\s+${escapeRegex(subject)}\\b`, 'i').test(rawQuery);
}

function hasRequirementCue(rawQuery: string): boolean {
  return /\b(?:requirement|gen\s*-?\s*ed|requirements?|fulfills?|counts?|category|bucket)\b/i.test(rawQuery);
}

function hasStudentShoppingCue(rawQuery: string): boolean {
  return /\b(?:easy|chill|gpa\s+booster|grade\s+booster|easy\s+a|low\s+workload)\b/i.test(rawQuery);
}

function hasSubjectBrowseCue(rawQuery: string): boolean {
  return /\b(?:courses?|classes?|department|major|minor|subject)\b/i.test(rawQuery);
}

function isBareUppercaseSubjectCode(subject: string, rawQuery: string): boolean {
  return new RegExp(`^\\s*${escapeRegex(subject)}\\s*$`).test(rawQuery);
}

function isShortAmbiguousCode(value: string): boolean {
  return /^[a-z]{2,4}$/i.test(value.trim());
}

async function addSubjectRequirementAmbiguity(
  db: D1Database,
  plan: SearchPlan,
  context: {
    term: string;
    chosen: InterpretationType;
    subject: string;
    requirementCode: string;
  }
): Promise<void> {
  const subjectLabel = await getSubjectName(db, context.subject);
  const requirementLabel = getRequirementLabel(context.requirementCode);
  const chosen = context.chosen === 'subject'
    ? { type: 'subject', value: context.subject, label: subjectLabel }
    : { type: 'requirement', value: context.requirementCode, label: requirementLabel };
  const alternative = context.chosen === 'subject'
    ? { type: 'requirement', value: context.requirementCode, label: requirementLabel }
    : { type: 'subject', value: context.subject, label: subjectLabel };

  plan.ambiguities = plan.ambiguities || [];
  plan.ambiguities.push({
    term: context.term,
    chosen,
    alternatives: [alternative],
  });
}

function isFuzzySubjectNameCandidate(normalized: string): boolean {
  if (normalized.length <= 3 || normalized.length > 32) {
    return false;
  }

  if (FUZZY_SUBJECT_NAME_BLOCKLIST.has(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 4;
}

function isFuzzySubjectCodeCandidate(normalized: string): boolean {
  return /^[a-z]{2,8}$/.test(normalized);
}

async function getSubjectName(db: D1Database, code: string): Promise<string> {
  const result = await db.prepare('SELECT name FROM subjects WHERE id = ?')
    .bind(code)
    .first<{ name: string }>();
  return result?.name || code;
}

function getRequirementLabel(code: string): string {
  return GENED_REQUIREMENT_LABELS[code] || code;
}
