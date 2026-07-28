import type { Hint } from '../search-planner-types.js';
import {
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTimeFilter,
} from '@uiuc-course-search/query-types';
import { createDefaultRegistry } from '../alias-registry.js';
import {
  LEVEL_KEYWORDS_HARD,
  LEVEL_KEYWORDS_SOFT,
} from '../student-language-lexicon.js';
import { createMetadata, maskMatches, type TextMatch } from './text.js';

const ALIAS_REGISTRY = createDefaultRegistry();

export function extractAttributesAndAliases(text: string, hints: Hint[]): string {
  let residual = text;

  const creditsRegex = /\b(\d{1,2})\s*-?\s*(?:credit|credits|cr|hour|hours)s?\b/gi;
  const creditMatches: TextMatch[] = [];
  let match;
  while ((match = creditsRegex.exec(residual)) !== null) {
    hints.push({
      type: 'credits',
      value: parseInt(match[1]),
      metadata: createMetadata('regex', match[0], 0.9),
    });
    creditMatches.push({ index: match.index, length: match[0].length });
  }
  residual = maskMatches(residual, creditMatches);

  const levelNumRegex = /\b([1-5])00\s*-?\s*level\b/gi;
  const levelMatches: TextMatch[] = [];
  while ((match = levelNumRegex.exec(residual)) !== null) {
    const level = parseInt(match[1]) * 100;
    if (isSearchLevelFilter(level)) {
      hints.push({
        type: 'level',
        value: level,
        metadata: createMetadata('regex', match[0], 0.9),
      });
    }
    levelMatches.push({ index: match.index, length: match[0].length });
  }
  residual = maskMatches(residual, levelMatches);

  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS_HARD)) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const keywordMatches: TextMatch[] = [];
    let keywordMatch;
    while ((keywordMatch = keywordRegex.exec(residual)) !== null) {
      hints.push({
        type: 'level',
        value: level,
        metadata: createMetadata('regex', keywordMatch[0], 0.7),
      });
      keywordMatches.push({ index: keywordMatch.index, length: keywordMatch[0].length });
    }
    residual = maskMatches(residual, keywordMatches);
  }

  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS_SOFT)) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    let keywordMatch;
    while ((keywordMatch = keywordRegex.exec(residual)) !== null) {
      hints.push({
        type: 'levelBoost',
        value: level,
        metadata: createMetadata('regex', keywordMatch[0], 0.5),
      });
    }
  }

  return extractAliases(residual, hints);
}

function extractAliases(text: string, hints: Hint[]): string {
  const matches = ALIAS_REGISTRY.match(text);
  let residual = text;

  const sortedMatches = [...matches].sort((a, b) => b.span[0] - a.span[0]);

  for (const match of sortedMatches) {
    const metadata = {
      source: 'alias' as const,
      span: match.span,
      confidence: match.confidence,
      raw: match.raw,
    };

    switch (match.kind) {
      case 'time':
        if (isSearchTimeFilter(match.canonical)) {
          hints.push({ type: 'time', value: match.canonical, metadata });
        }
        break;
      case 'status':
        if (isSearchStatusFilter(match.canonical)) {
          hints.push({ type: 'status', value: match.canonical, metadata });
        }
        break;
      case 'delivery':
        hints.push({ type: 'online', value: match.canonical === 'true', metadata });
        break;
      case 'days':
        hints.push({ type: 'days', value: match.canonical, metadata });
        break;
      case 'subject':
        hints.push({ type: 'subject', value: match.canonical, metadata });
        break;
      case 'requirement':
        hints.push({ type: 'requirement', value: match.canonical, metadata });
        break;
      default: continue;
    }

    residual =
      residual.slice(0, match.span[0]) +
      ' '.repeat(match.span[1] - match.span[0]) +
      residual.slice(match.span[1]);
  }

  return residual;
}
