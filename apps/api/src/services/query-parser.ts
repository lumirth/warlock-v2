import type { ParsedQuery, ParsedClause, FieldFilter } from './search-planner-types.js';

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
  'part_of_term',
  'pot',
  'workload',
]);

/**
 * Parse power-user syntax from a query string.
 * Extracts: field:value, requirement:any(...), requirement:all(...), -negations, "phrases"
 */
export function parseQuery(query: string): ParsedQuery {
  // For now, we don't support top-level OR, so single clause
  const clause = parseClause(query);

  return {
    raw: query,
    clauses: [clause],
  };
}

function parseClause(text: string): ParsedClause {
  const filters: FieldFilter[] = [];
  const negations: string[] = [];
  const phrases: string[] = [];
  let requirementMode: ParsedClause['requirementMode'] = undefined;
  let residual = text;

  // 1. Extract requirement:any(...) and requirement:all(...).
  const requirementAnyRegex = /(?:requirement|gened):any\(([^)]+)\)/gi;
  const requirementAllRegex = /(?:requirement|gened):all\(([^)]+)\)/gi;

  const anyMatch = requirementAnyRegex.exec(residual);
  if (anyMatch) {
    requirementMode = requirementMode || {};
    requirementMode.any = anyMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(anyMatch[0], ' ');
  }

  const allMatch = requirementAllRegex.exec(residual);
  if (allMatch) {
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

function normalizeFieldName(field: string): string {
  const normalized = field.toLowerCase().replace(/-/g, '_');
  if (normalized === 'gened') return 'requirement';
  if (normalized === 'difficulty') return 'workload';
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
