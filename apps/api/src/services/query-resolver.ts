import type { D1Database } from '@cloudflare/workers-types';
import type { ExtractedQuery, SearchPlan, QueryHint } from './search-planner-types.js';
import { applyStructuredNegation } from './search-intent-policy.js';
import { appendQueryText } from './search-plan-query-language.js';
import {
  resolveGened,
  resolveSubjectHint,
  validateSubject,
} from './subject-resolution.js';

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
          plan.keywordQuery = appendQueryText(plan.keywordQuery, subjectValue);
          plan.semanticQuery = appendQueryText(plan.semanticQuery, subjectValue);
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
    plan.semanticQuery = appendQueryText(rawValue, plan.semanticQuery);
    plan.keywordQuery = appendQueryText(rawValue, plan.keywordQuery);
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
