import {
  isKnownRequirementCode,
  isSearchInstructorDifficultyFilter,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
} from '@uiuc-course-search/query-types';
import type { ParsedQuery, FieldFilter } from './search-planner-types.js';

const SUPPORTED_FIELD_FILTERS = new Set([
  'subject',
  'requirement',
  'credits',
  'level',
  'crn',
  'status',
  'online',
  'days',
  'time',
  'term',
  'partofterm',
  'instructor_difficulty',
]);

/**
 * Parse power-user syntax from a query string.
 * Extracts: field:value, requirement:any(...), requirement:all(...), -negations, "phrases"
 */
export function parseQuery(query: string): ParsedQuery {
  const filters: FieldFilter[] = [];
  const negations: string[] = [];
  const phrases: string[] = [];
  let requirementMode: ParsedQuery['requirementMode'] = undefined;
  let residual = query;

  // 1. Extract requirement:any(...) and requirement:all(...).
  const requirementAnyRegex = /(?:requirement|gened):any\(([^)]+)\)/gi;
  const requirementAllRegex = /(?:requirement|gened):all\(([^)]+)\)/gi;

  const anyMatch = requirementAnyRegex.exec(residual);
  if (anyMatch && validRequirementCodes(anyMatch[1])) {
    requirementMode = requirementMode || {};
    requirementMode.any = anyMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(anyMatch[0], ' ');
  }

  const allMatch = requirementAllRegex.exec(residual);
  if (allMatch && validRequirementCodes(allMatch[1])) {
    requirementMode = requirementMode || {};
    requirementMode.all = allMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(allMatch[0], ' ');
  }

  // 2. Extract "quoted phrases"
  const phraseRegex = /"([^"]+)"/g;
  let phraseMatch;
  while ((phraseMatch = phraseRegex.exec(residual)) !== null) {
    phrases.push(phraseMatch[1]);
  }
  residual = residual.replace(phraseRegex, ' ');

  // 3. Extract supported -negations (must be preceded by space or start of string).
  // Unsupported dash terms stay in residual text rather than disappearing.
  const negationRegex = /(?:^|\s)-(\w+)/g;
  let negMatch;
  const negationsToRemove: string[] = [];
  while ((negMatch = negationRegex.exec(residual)) !== null) {
    if (isSupportedNegationToken(negMatch[1])) {
      negations.push(negMatch[1]);
      negationsToRemove.push(negMatch[0]);
    }
  }
  for (const negationText of negationsToRemove) {
    residual = residual.replace(negationText, ' ');
  }

  // 4. Extract supported field:value pairs. Unknown fields stay in residual text
  // so power syntax never disappears silently.
  const fieldValueRegex = /([a-zA-Z_][\w-]*):([^\s]+)/g;
  let fieldMatch;
  const fieldMatchesToRemove: string[] = [];
  while ((fieldMatch = fieldValueRegex.exec(residual)) !== null) {
    const normalizedField = normalizeFieldName(fieldMatch[1]);
    if (!SUPPORTED_FIELD_FILTERS.has(normalizedField)) {
      continue;
    }
    if (!isValidFieldFilter(normalizedField, fieldMatch[2])) {
      continue;
    }
    filters.push({
      field: normalizedField,
      value: fieldMatch[2],
    });
    fieldMatchesToRemove.push(fieldMatch[0]);
  }
  for (const fieldText of fieldMatchesToRemove) {
    residual = residual.replace(fieldText, ' ');
  }

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  return {
    filters,
    negations,
    phrases,
    requirementMode,
    residual,
  };
}

function validRequirementCodes(value: string): boolean {
  const codes = value
    .split(',')
    .map(code => code.trim().toUpperCase())
    .filter(Boolean);
  return codes.length > 0 && codes.every(isKnownRequirementCode);
}

function isValidFieldFilter(field: string, rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) return false;

  switch (field) {
    case 'subject':
      return /^[A-Z]{2,4}$/i.test(value);
    case 'requirement':
      return isKnownRequirementCode(value.toUpperCase());
    case 'credits': {
      const credits = Number(value);
      return Number.isInteger(credits) && credits >= 0 && credits <= 8;
    }
    case 'level':
      return isSearchLevelFilter(Number(value));
    case 'crn':
      return /^\d{5,6}$/.test(value);
    case 'status':
      return isSearchStatusFilter(value.toLowerCase());
    case 'online':
      return [
        'true',
        'yes',
        '1',
        'online',
        'remote',
        'false',
        'no',
        '0',
        'in-person',
        'in_person',
        'inperson',
      ].includes(value.toLowerCase());
    case 'days':
      return /^[MTWRFSU]{1,7}$/i.test(value);
    case 'time':
      return isSearchTimeFilter(value.toLowerCase());
    case 'term': {
      const match = /^(?:(spring|summer|fall|winter)[-_ ]?(20\d{2})|(20\d{2})[-_ ]?(spring|summer|fall|winter))$/i.exec(value);
      const term = match?.[1] ?? match?.[4];
      return Boolean(term && isSearchTermFilter(term.toLowerCase()));
    }
    case 'partofterm':
      return /^[A-Z0-9]$/i.test(value);
    case 'instructor_difficulty':
      return isSearchInstructorDifficultyFilter(value.toLowerCase());
    default:
      return false;
  }
}

function normalizeFieldName(field: string): string {
  const normalized = field.toLowerCase().replace(/-/g, '_');
  if (normalized === 'gened') return 'requirement';
  if (normalized === 'part_of_term' || normalized === 'pot') return 'partofterm';
  return normalized;
}

function isSupportedNegationToken(token: string): boolean {
  const normalized = token.toLowerCase();
  return [
    'early',
    'morning',
    'midday',
    'afternoon',
    'evening',
    'night',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'mwf',
    'tr',
    'mw',
    'wf',
    'online',
    'remote',
    'virtual',
  ].includes(normalized);
}
