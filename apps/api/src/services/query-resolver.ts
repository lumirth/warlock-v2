import type { D1Database } from '@cloudflare/workers-types';
import { singleRequirementFilter } from '@uiuc-course-search/query-types';
import type { ExtractedQuery, SearchPlan, QueryHint } from './search-planner-types.js';
import {
  FUZZY_SUBJECT_NAME_BLOCKLIST,
  GENED_LOOKUP,
  SUBJECT_GENED_CONFLICTS,
} from './student-language-lexicon.js';
import { applyStructuredNegation } from './search-intent-policy.js';

type InterpretationType = 'subject' | 'gened';

type InstructorResolution = {
  ids: number[];
  residualText?: string;
};

export async function resolveQuery(db: D1Database, extracted: ExtractedQuery): Promise<SearchPlan> {
  const plan: SearchPlan = {
    filters: {},
    semanticQuery: extracted.residual,
    keywordQuery: extracted.residual,
    ambiguities: []
  };

  for (const hint of extracted.hints) {
    switch (hint.type) {
      case 'course_code':
        await resolveCourseCode(db, hint, plan);
        break;

      case 'instructor': {
        const resolution = await resolveInstructor(db, String(hint.value));
        if (resolution.ids.length > 0) {
          plan.filters.instructor_ids = resolution.ids;
          if (resolution.residualText) {
            plan.semanticQuery = appendQueryText(plan.semanticQuery, resolution.residualText);
            plan.keywordQuery = appendQueryText(plan.keywordQuery, resolution.residualText);
          }
        }
        break;
      }

      case 'gened':
        resolveGened(String(hint.value), plan);
        break;

      case 'subject': {
        const subjectValue = String(hint.value);
        const validSubj = await validateSubject(db, subjectValue);
        if (validSubj) {
          await resolveSubjectHint(db, hint, validSubj, plan, extracted.rawQuery);
        } else {
          plan.keywordQuery = (plan.keywordQuery + " " + subjectValue).trim();
          plan.semanticQuery = (plan.semanticQuery + " " + subjectValue).trim();
        }
        break;
      }

      case 'crn':
        // CRN is a direct lookup - handled specially in search
        plan.filters.crn = String(hint.value);
        break;

      case 'days':
        plan.filters.days = hint.value as string;
        break;

      case 'time':
        plan.filters.time = hint.value as string;
        break;

      case 'partOfTerm':
        plan.filters.partOfTerm = hint.value as string;
        break;

      case 'term': {
        if (typeof hint.value === 'object' && hint.value !== null && 'term' in hint.value && 'year' in hint.value) {
          plan.filters.term = hint.value.term;
          plan.filters.year = hint.value.year;
        } else if (typeof hint.value === 'string') {
          const parsed = parseTermValue(hint.value);
          if (parsed) {
            plan.filters.term = parsed.term;
            plan.filters.year = parsed.year;
          }
        }
        break;
      }

      case 'level': {
        const levelValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
        plan.filters.level = levelValue;
        break;
      }

      case 'levelBoost': {
        const levelValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
        plan.softPreferences = {
          ...plan.softPreferences,
          levelBoost: levelValue,
        };
        break;
      }

      case 'credits': {
        const creditsValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
        plan.filters.credits = creditsValue;
        break;
      }

      case 'online':
        if (typeof hint.value === 'boolean') {
          plan.filters.online = hint.value;
        } else {
          plan.filters.online = hint.value === 'true';
        }
        break;

      case 'status':
        plan.filters.status = hint.value as string;
        break;

      case 'difficulty':
        plan.filters.difficulty = hint.value as 'easy' | 'hard';
        break;

      case 'negation': {
        // Handle negation hints - they come as { target: HintType, value: string }
        const negValue = hint.value as { target: string; value: string } | string;
        if (typeof negValue === 'object' && 'target' in negValue) {
          plan.filters.not = plan.filters.not || {};
          if (negValue.target === 'time') {
            plan.filters.not.time = plan.filters.not.time || [];
            plan.filters.not.time.push(negValue.value);
          } else if (negValue.target === 'days') {
            plan.filters.not.days = plan.filters.not.days || [];
            plan.filters.not.days.push(negValue.value);
          } else if (negValue.target === 'subject') {
            applyStructuredNegation('subject', negValue.value, plan);
          } else if (negValue.target === 'gened') {
            applyStructuredNegation('gened', negValue.value, plan);
          } else if (negValue.target === 'keyword' || negValue.target === 'workload') {
            applyStructuredNegation(negValue.target, negValue.value, plan);
          }
        }
        break;
      }
    }
  }

  // Clean up empty ambiguities array
  if (plan.ambiguities?.length === 0) {
    delete plan.ambiguities;
  }

  return plan;
}

export function parseTermValue(value: string): { term: string; year: number } | null {
  const normalized = value.trim().toLowerCase();
  const match = /^(spring|fall|summer|winter)[-_ ]?(20\d{2})$/.exec(normalized)
    ?? /^(20\d{2})[-_ ]?(spring|fall|summer|winter)$/.exec(normalized);

  if (!match) {
    return null;
  }

  if (match[1].startsWith('20')) {
    return { year: parseInt(match[1], 10), term: match[2] };
  }

  return { term: match[1], year: parseInt(match[2], 10) };
}

async function resolveCourseCode(
  db: D1Database,
  hint: QueryHint,
  plan: SearchPlan
): Promise<void> {
  const subject = hint.metadata?.subject;
  const number = hint.metadata?.number;

  if (!number) return;
  if (!subject) {
    plan.filters.number = number;
    return;
  }

  // Validate subject exists
  const validSubject = await validateSubject(db, subject);

  if (validSubject) {
    plan.filters.subject = validSubject;
    plan.filters.number = number;

    // Clear residual since we've fully resolved this
    const rawValue = String(hint.value);
    plan.semanticQuery = plan.semanticQuery.replace(rawValue, '').trim();
    plan.keywordQuery = plan.keywordQuery.replace(rawValue, '').trim();
  } else {
    // Subject not found - keep in queries for fuzzy matching
    const rawValue = String(hint.value);
    plan.semanticQuery = (rawValue + " " + plan.semanticQuery).trim();
    plan.keywordQuery = (rawValue + " " + plan.keywordQuery).trim();
  }
}

async function resolveSubjectHint(
  db: D1Database,
  hint: QueryHint,
  subject: string,
  plan: SearchPlan,
  rawQuery: string
): Promise<void> {
  if (!SUBJECT_GENED_CONFLICTS.has(subject)) {
    plan.filters.subject = subject;
    return;
  }

  const genedCode = GENED_LOOKUP[subject.toLowerCase()];
  if (!genedCode) {
    plan.filters.subject = subject;
    return;
  }

  const decision = chooseSubjectOrGenedInterpretation({
    subject,
    hint,
    rawQuery,
  });

  if (decision.preferred === 'gened') {
    delete plan.filters.subject;
    plan.filters.requirement = singleRequirementFilter(genedCode);
    await addSubjectGenedAmbiguity(db, plan, {
      term: String(hint.metadata?.raw ?? hint.value),
      chosen: 'gened',
      subject,
      genedCode,
    });
    return;
  }

  plan.filters.subject = subject;
  if (decision.showAlternative) {
    await addSubjectGenedAmbiguity(db, plan, {
      term: String(hint.metadata?.raw ?? hint.value),
      chosen: 'subject',
      subject,
      genedCode,
    });
  }
}

function chooseSubjectOrGenedInterpretation(context: {
  subject: string;
  hint: QueryHint;
  rawQuery: string;
}): { preferred: InterpretationType; showAlternative: boolean } {
  const raw = context.rawQuery;
  const hintRaw = String(context.hint.metadata?.raw ?? context.hint.value);

  if (hasExplicitSubjectField(context.subject, raw)) {
    return { preferred: 'subject', showAlternative: false };
  }

  if (hasExplicitSubjectPhrase(context.subject, hintRaw, raw)) {
    return { preferred: 'subject', showAlternative: false };
  }

  const genedScore = interpretationScore([
    [mentionsGenedCode(context.subject, raw), 5],
    [hasRequirementCue(raw), 3],
    [hasStudentShoppingCue(raw), 2],
  ]);

  const subjectScore = interpretationScore([
    [hasSubjectBrowseCue(raw) && !hasStudentShoppingCue(raw), 3],
    [isBareUppercaseSubjectCode(context.subject, raw), 1],
  ]);

  if (genedScore > subjectScore) {
    return { preferred: 'gened', showAlternative: true };
  }

  return {
    preferred: 'subject',
    showAlternative: genedScore > 0 || isShortAmbiguousCode(hintRaw),
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

function mentionsGenedCode(subject: string, rawQuery: string): boolean {
  return new RegExp(`\\b${escapeRegex(subject)}\\s+gen\\s*-?\\s*ed\\b`, 'i').test(rawQuery)
    || new RegExp(`\\bgen\\s*-?\\s*ed\\s+${escapeRegex(subject)}\\b`, 'i').test(rawQuery);
}

function hasRequirementCue(rawQuery: string): boolean {
  return /\b(?:gened|gen\s*-?\s*ed|requirements?|fulfills?|counts?|category|bucket)\b/i.test(rawQuery);
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

async function addSubjectGenedAmbiguity(
  db: D1Database,
  plan: SearchPlan,
  context: {
    term: string;
    chosen: InterpretationType;
    subject: string;
    genedCode: string;
  }
): Promise<void> {
  const subjectLabel = await getSubjectName(db, context.subject);
  const genedLabel = getGenedLabel(context.genedCode);
  const chosen = context.chosen === 'subject'
    ? { type: 'subject', value: context.subject, label: subjectLabel }
    : { type: 'gened', value: context.genedCode, label: genedLabel };
  const alternative = context.chosen === 'subject'
    ? { type: 'gened', value: context.genedCode, label: genedLabel }
    : { type: 'subject', value: context.subject, label: subjectLabel };

  plan.ambiguities = plan.ambiguities || [];
  plan.ambiguities.push({
    term: context.term,
    chosen,
    alternatives: [alternative],
  });
}

export async function validateSubject(db: D1Database, subject: string): Promise<string | null> {
  const normalized = subject.toLowerCase().trim();
  const upper = subject.toUpperCase();

  // 1. Exact code match in subjects table
  const byCode = await db.prepare('SELECT id FROM subjects WHERE id = ?')
    .bind(upper)
    .first<{ id: string }>();
  if (byCode) return byCode.id;

  // 2. Full name match
  const byName = await db.prepare('SELECT id FROM subjects WHERE LOWER(name) = ?')
    .bind(normalized)
    .first<{ id: string }>();
  if (byName) return byName.id;

  // 3. Alias lookup
  const byAlias = await db.prepare('SELECT subject_id FROM subject_aliases WHERE alias = ?')
    .bind(normalized)
    .first<{ subject_id: string }>();
  if (byAlias) return byAlias.subject_id;

  // 4. Fuzzy match in subjects table. Keep this narrow: full search text can
  // include topic expansions, and D1 rejects overly complex LIKE patterns.
  const fuzzyClauses: string[] = [];
  const fuzzyParams: string[] = [];
  if (isFuzzySubjectNameCandidate(normalized)) {
    fuzzyClauses.push("LOWER(name) LIKE ? ESCAPE '\\'");
    fuzzyParams.push(`%${escapeLikePattern(normalized)}%`);
  }
  if (isFuzzySubjectCodeCandidate(normalized)) {
    fuzzyClauses.push("id LIKE ? ESCAPE '\\'");
    fuzzyParams.push(`%${escapeLikePattern(upper)}%`);
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

  // 5. Fallback: check if subject code exists in courses table
  const byCourse = await db.prepare('SELECT DISTINCT subject FROM courses WHERE subject = ? LIMIT 1')
    .bind(upper)
    .first<{ subject: string }>();
  if (byCourse) return byCourse.subject;

  return null;
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getSubjectName(db: D1Database, code: string): Promise<string> {
  const result = await db.prepare('SELECT name FROM subjects WHERE id = ?')
    .bind(code)
    .first<{ name: string }>();
  return result?.name || code;
}

function getGenedLabel(code: string): string {
  const labels: Record<string, string> = {
    'CS': 'Cultural Studies',
    'PS': 'Physical Sciences',
    'HUM': 'Humanities & Arts',
    'NAT': 'Natural Sciences',
    'SBS': 'Social & Behavioral Sciences',
    'QR': 'Quantitative Reasoning',
  };
  return labels[code] || code;
}

function resolveGened(value: string, plan: SearchPlan): void {
  const normalized = value.toLowerCase().trim();
  const code = GENED_LOOKUP[normalized];

  if (code) {
    plan.filters.requirement = singleRequirementFilter(code);
  } else {
    // Keep raw value as fallback.
    plan.filters.requirement = singleRequirementFilter(value);
  }
}

async function resolveInstructor(db: D1Database, name: string): Promise<InstructorResolution> {
  const query = `
    SELECT id FROM instructors
    WHERE LOWER(last_name) LIKE ? OR LOWER(display_name) LIKE ?
    LIMIT 10
  `;
  const seen = new Set<number>();
  const ids: number[] = [];

  for (const candidate of instructorSearchCandidates(name)) {
    const pattern = `%${candidate.needle}%`;
    const { results } = await db.prepare(query)
      .bind(pattern, pattern)
      .all<{ id: number }>();

    for (const row of results) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        ids.push(row.id);
      }
    }

    if (ids.length > 0) {
      return { ids, residualText: candidate.residualText };
    }
  }

  return { ids };
}

function instructorSearchCandidates(name: string): InstructorResolutionCandidate[] {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const candidates: InstructorResolutionCandidate[] = [{ needle: normalized }];
  const tokens = normalized.split(/[^a-z0-9']+/).filter(token => token.length >= 3);
  const likelyLastName = tokens.at(-1);

  if (tokens.length > 1 && likelyLastName && likelyLastName !== normalized) {
    candidates.push({ needle: likelyLastName });
  }

  if (!/[-']/.test(normalized)) {
    for (let end = tokens.length - 1; end >= 1; end--) {
      const prefix = tokens.slice(0, end).join(' ');
      const dropped = tokens.slice(end).join(' ');
      if (prefix && dropped) {
        candidates.push({ needle: prefix, residualText: dropped });
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.needle}:${candidate.residualText ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type InstructorResolutionCandidate = {
  needle: string;
  residualText?: string;
};

function appendQueryText(query: string, addition: string): string {
  return [query, addition]
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');
}
