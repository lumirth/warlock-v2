import type { Hint } from '../search-planner-types.js';
import { isSearchTermFilter } from '@uiuc-course-search/query-types';
import { createMetadata, maskMatches, type TextMatch } from './text.js';

export function extractQuestionScaffolding(text: string): string {
  const hasDifficultyQuestion =
    /\b(?:is|are|was|were)\b.+\b(?:hard|easy|difficult|challenging|tough)\b/i.test(text)
    || /\bhow\s+(?:hard|easy|difficult|challenging|tough)\s+(?:is|are|was|were)\b/i.test(text);

  if (!hasDifficultyQuestion) {
    return text;
  }

  return text
    .replace(/\bhow\s+(?:hard|easy|difficult|challenging|tough)\s+(?:is|are|was|were)\b/gi, ' ')
    .replace(/\b(?:is|are|was|were)\b/gi, ' ')
    .replace(/\b(?:hard|easy|difficult|challenging|tough)\b/gi, ' ')
    .replace(/\s+/g, ' ');
}

export function extractTerms(text: string, hints: Hint[]): string {
  let residual = text;
  const termRegex = /\b(spring|fall|summer|winter)\s*(20\d{2})\b/gi;
  const matches: TextMatch[] = [];

  let match;
  while ((match = termRegex.exec(text)) !== null) {
    const term = match[1].toLowerCase();
    if (!isSearchTermFilter(term)) continue;
    hints.push({
      type: 'term',
      value: { term, year: parseInt(match[2]) },
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matches.push({ index: match.index, length: match[0].length });
  }

  residual = maskMatches(residual, matches);

  return residual;
}

export function extractPartOfTerm(text: string, hints: Hint[]): string {
  let residual = text;
  const potRegex = /\b(?:part\s+of\s+term|pot)\s+([A-Z0-9])\b/gi;
  const matches: TextMatch[] = [];

  let match;
  while ((match = potRegex.exec(residual)) !== null) {
    hints.push({
      type: 'partOfTerm',
      value: match[1].toUpperCase(),
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matches.push({ index: match.index, length: match[0].length });
  }

  residual = maskMatches(residual, matches);

  const firstHalfRegex = /\bfirst\s+half\b/gi;
  const firstHalfMatches: TextMatch[] = [];
  while ((match = firstHalfRegex.exec(residual)) !== null) {
    hints.push({
      type: 'partOfTerm',
      value: 'A',
      metadata: createMetadata('alias', match[0], 0.9),
    });
    firstHalfMatches.push({ index: match.index, length: match[0].length });
  }
  residual = maskMatches(residual, firstHalfMatches);

  const secondHalfRegex = /\bsecond\s+half\b/gi;
  const secondHalfMatches: TextMatch[] = [];
  while ((match = secondHalfRegex.exec(residual)) !== null) {
    hints.push({
      type: 'partOfTerm',
      value: 'B',
      metadata: createMetadata('alias', match[0], 0.9),
    });
    secondHalfMatches.push({ index: match.index, length: match[0].length });
  }

  return maskMatches(residual, secondHalfMatches);
}

export function maskCompressedTermPhrases(text: string): string {
  return text.replace(/\b(?:8|eight)\s*-?\s*weeks?\b/gi, match => ' '.repeat(match.length));
}
