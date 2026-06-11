import type { D1Database } from '@cloudflare/workers-types';
import {
  isSearchTermFilter,
  type SearchTermFilter,
} from '@uiuc-course-search/query-types';
import type { ExtractionResult } from './extractor.js';
import type { Hint, SearchPlan } from './search-planner-types.js';
import { applyStructuredNegation } from './search-intent-policy.js';
import { appendQueryText } from './search-plan-query-language.js';
import {
  resolveRequirement,
  resolveSubjectHint,
  validateSubject,
} from './subject-resolution.js';

type InstructorResolution = {
  ids: number[];
  residualText?: string;
};

export async function resolveQuery(
  db: D1Database,
  rawQuery: string,
  extraction: ExtractionResult,
): Promise<SearchPlan> {
  const plan: SearchPlan = {
    filters: {},
    semanticQuery: extraction.residual,
    keywordQuery: extraction.residual,
    ambiguities: []
  };

  for (const hint of extraction.hints) {
    switch (hint.type) {
      case 'courseCode':
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

      case 'requirement':
        resolveRequirement(String(hint.value), plan);
        break;

      case 'subject': {
        const subjectValue = String(hint.value);
        const validSubj = await validateSubject(db, subjectValue);
        if (validSubj) {
          await resolveSubjectHint(db, hint, validSubj, plan, rawQuery);
        } else {
          plan.keywordQuery = appendQueryText(plan.keywordQuery, subjectValue);
          plan.semanticQuery = appendQueryText(plan.semanticQuery, subjectValue);
        }
        break;
      }

      case 'crn':
        plan.filters.crn = String(hint.value);
        break;

      case 'days':
        plan.filters.days = hint.value;
        break;

      case 'time':
        plan.filters.time = hint.value;
        break;

      case 'partOfTerm':
        plan.filters.partOfTerm = hint.value;
        break;

      case 'term': {
        plan.filters.term = hint.value.term;
        plan.filters.year = hint.value.year;
        break;
      }

      case 'level': {
        plan.filters.level = hint.value;
        break;
      }

      case 'levelBoost': {
        plan.softPreferences = {
          ...plan.softPreferences,
          levelBoost: hint.value,
        };
        break;
      }

      case 'credits': {
        plan.filters.credits = hint.value;
        break;
      }

      case 'online':
        plan.filters.online = hint.value;
        break;

      case 'status':
        plan.filters.status = hint.value;
        break;

      case 'workload':
        plan.filters.workload = hint.value;
        break;

      case 'negation': {
        const negValue = hint.value;
        plan.filters.not = plan.filters.not || {};
        if (negValue.target === 'time') {
          plan.filters.not.time = plan.filters.not.time || [];
          plan.filters.not.time.push(negValue.value);
        } else if (negValue.target === 'days') {
          plan.filters.not.days = plan.filters.not.days || [];
          plan.filters.not.days.push(negValue.value);
        } else if (negValue.target === 'subject') {
          applyStructuredNegation('subject', negValue.value, plan);
        } else if (negValue.target === 'requirement') {
          applyStructuredNegation('requirement', negValue.value, plan);
        } else if (negValue.target === 'keyword' || negValue.target === 'workload') {
          applyStructuredNegation(negValue.target, negValue.value, plan);
        }
        break;
      }
    }
  }

  if (plan.ambiguities?.length === 0) {
    delete plan.ambiguities;
  }

  return plan;
}

export function parseTermValue(value: string): { term: SearchTermFilter; year: number } | null {
  const normalized = value.trim().toLowerCase();
  const match = /^(spring|fall|summer|winter)[-_ ]?(20\d{2})$/.exec(normalized)
    ?? /^(20\d{2})[-_ ]?(spring|fall|summer|winter)$/.exec(normalized);

  if (!match) {
    return null;
  }

  const term = match[1].startsWith('20') ? match[2] : match[1];
  if (!isSearchTermFilter(term)) return null;
  const year = match[1].startsWith('20') ? match[1] : match[2];
  return { term, year: parseInt(year, 10) };
}

async function resolveCourseCode(
  db: D1Database,
  hint: Extract<Hint, { type: 'courseCode' }>,
  plan: SearchPlan
): Promise<void> {
  const { subject, number } = hint.value;
  if (!subject) {
    plan.filters.number = number;
    return;
  }

  const validSubject = await validateSubject(db, subject);

  if (validSubject) {
    plan.filters.subject = validSubject;
    plan.filters.number = number;

    const rawValue = hint.metadata.raw;
    plan.semanticQuery = plan.semanticQuery.replace(rawValue, '').trim();
    plan.keywordQuery = plan.keywordQuery.replace(rawValue, '').trim();
  } else {
    const rawValue = hint.metadata.raw;
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

export async function resolveInstructorIds(
  db: D1Database,
  name: string,
): Promise<number[]> {
  return (await resolveInstructor(db, name)).ids;
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
