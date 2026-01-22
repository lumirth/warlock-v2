import type { ParsedQuery, ParsedClause, FieldFilter } from '@uiuc-course-search/query-types';

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

  let anyMatch = genedAnyRegex.exec(residual);
  if (anyMatch) {
    genedMode = genedMode || {};
    genedMode.any = anyMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(anyMatch[0], ' ');
  }

  let allMatch = genedAllRegex.exec(residual);
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

  // 3. Extract -negations (must be preceded by space or start of string)
  const negationRegex = /(?:^|\s)-(\w+)/g;
  let negMatch;
  while ((negMatch = negationRegex.exec(residual)) !== null) {
    negations.push(negMatch[1]);
  }
  residual = residual.replace(negationRegex, ' ');

  // 4. Extract field:value pairs
  const fieldValueRegex = /(\w+):(\w+)/g;
  let fieldMatch;
  while ((fieldMatch = fieldValueRegex.exec(residual)) !== null) {
    filters.push({
      field: fieldMatch[1].toLowerCase(),
      value: fieldMatch[2],
    });
  }
  residual = residual.replace(fieldValueRegex, ' ');

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
