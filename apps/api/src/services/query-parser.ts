import type { ParsedQuery, ParsedClause, FieldFilter } from './search-planner-types.js';

const SUPPORTED_FIELD_FILTERS = new Set([
  'subject',
  'gened',
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
  'difficulty',
]);

/**
 * Parse power-user syntax from a query string.
 * Extracts: field:value, gened:any(...), gened:all(...), -negations, "phrases"
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
  let genedMode: ParsedClause['genedMode'] = undefined;
  let residual = text;

  // 1. Extract gened:any(...) and gened:all(...)
  const genedAnyRegex = /gened:any\(([^)]+)\)/gi;
  const genedAllRegex = /gened:all\(([^)]+)\)/gi;

  const anyMatch = genedAnyRegex.exec(residual);
  if (anyMatch) {
    genedMode = genedMode || {};
    genedMode.any = anyMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(anyMatch[0], ' ');
  }

  const allMatch = genedAllRegex.exec(residual);
  if (allMatch) {
    genedMode = genedMode || {};
    genedMode.all = allMatch[1].split(',').map(s => s.trim().toUpperCase());
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
    genedMode,
    residual,
  };
}

function normalizeFieldName(field: string): string {
  return field.toLowerCase().replace(/-/g, '_');
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
