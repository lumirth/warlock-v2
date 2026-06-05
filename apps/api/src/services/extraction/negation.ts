import type { Hint, HintType } from '../search-planner-types.js';
import {
  NEGATED_SUBJECT_ALIASES,
  NEGATION_TARGET_STOP_WORDS,
  POSITIVE_NO_NOT_ALIASES,
  WORKLOAD_NEGATION_TERMS,
} from '../student-language-lexicon.js';
import {
  createMetadata,
  escapeRegExp,
  maskMatches,
  type TextMatch,
} from './text.js';

export function extractPositiveNoNotAliases(text: string, hints: Hint[]): string {
  let residual = text;

  for (const alias of POSITIVE_NO_NOT_ALIASES) {
    const matches: TextMatch[] = [];
    const pattern = new RegExp(alias.pattern.source, alias.pattern.flags);
    let match;
    while ((match = pattern.exec(residual)) !== null) {
      hints.push({
        type: alias.type,
        value: alias.value,
        metadata: createMetadata('alias', match[0], 0.88),
      });
      matches.push({ index: match.index, length: match[0].length });
    }

    residual = maskMatches(residual, matches);
  }

  return residual;
}

export function extractNegations(text: string, hints: Hint[]): string {
  let residual = text;
  const negationPatterns = [
    /\b(?:no|not|without|avoid|avoiding|isn['’]?t|arent|aren['’]?t|doesnt|doesn['’]?t)\s+([a-z0-9+#-]+(?:\s+(?!and\b|but\b|or\b|then\b|with\b|for\b|that\b|which\b|who\b|what\b|no\b|not\b|without\b|avoid\b|avoiding\b|\d+\b)[a-z0-9+#-]+){0,3})\b/gi,
  ];

  for (const pattern of negationPatterns) {
    const matches: TextMatch[] = [];
    const patternCopy = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = patternCopy.exec(residual)) !== null) {
      const classified = classifyNegationTarget(match[1]);
      if (!classified) {
        matches.push({ index: match.index, length: match[0].length });
        continue;
      }

      const { negation } = classified;
      const targetStartInMatch = match[0].lastIndexOf(match[1]);
      const consumedMatchLength = targetStartInMatch + classified.consumedLength;
      const rawNegationText = match[0].slice(0, consumedMatchLength).trim();
      if (negation.target === 'online') {
        hints.push({
          type: 'online',
          value: false,
          metadata: createMetadata('nlp', rawNegationText, 0.75),
        });
      } else {
        hints.push({
          type: 'negation',
          value: negation,
          metadata: createMetadata('nlp', rawNegationText, 0.75),
        });
      }
      matches.push({ index: match.index, length: consumedMatchLength });
    }

    residual = maskMatches(residual, matches);
  }
  return residual;
}

function normalizeNegationTarget(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const kept: string[] = [];
  for (const token of tokens) {
    if (NEGATION_TARGET_STOP_WORDS.has(token)) {
      break;
    }
    kept.push(token);
  }

  return kept.join(' ').trim();
}

function classifyNegationTarget(raw: string): {
  negation: { target: HintType | 'keyword' | 'workload'; value: string };
  consumedLength: number;
} | null {
  const timeMatch = matchLeadingRawTarget(raw, ['morning', 'afternoon', 'evening', 'early', 'night']);
  if (timeMatch) {
    return {
      negation: { target: 'time', value: normalizeNegationTarget(timeMatch.value) },
      consumedLength: timeMatch.length,
    };
  }

  const dayMatch = matchLeadingRawTarget(raw, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'mwf', 'tr']);
  if (dayMatch) {
    return {
      negation: { target: 'days', value: normalizeNegationTarget(dayMatch.value) },
      consumedLength: dayMatch.length,
    };
  }

  const onlineMatch = matchLeadingRawTarget(raw, ['online', 'remote', 'virtual', 'asynchronous', 'async']);
  if (onlineMatch) {
    return {
      negation: { target: 'online', value: normalizeNegationTarget(onlineMatch.value) },
      consumedLength: onlineMatch.length,
    };
  }

  const workloadMatch = matchLeadingRawTarget(raw, [...WORKLOAD_NEGATION_TERMS].sort((a, b) => b.length - a.length));
  if (workloadMatch) {
    return {
      negation: { target: 'workload', value: normalizeNegationTarget(workloadMatch.value) },
      consumedLength: workloadMatch.length,
    };
  }

  const subjectTerms = Object.keys(NEGATED_SUBJECT_ALIASES).sort((a, b) => b.length - a.length);
  const subjectMatch = matchLeadingRawTarget(raw, subjectTerms);
  if (subjectMatch) {
    const normalized = normalizeNegationTarget(subjectMatch.value);
    return {
      negation: {
        target: 'subject',
        value: NEGATED_SUBJECT_ALIASES[normalized] ?? normalized,
      },
      consumedLength: subjectMatch.length,
    };
  }

  const target = normalizeNegationTarget(raw);
  if (!target) {
    return null;
  }

  return {
    negation: { target: 'keyword', value: target },
    consumedLength: raw.length,
  };
}

function matchLeadingRawTarget(raw: string, terms: string[]): { value: string; length: number } | null {
  for (const term of terms) {
    const source = escapeRegExp(term).replace(/\\ /g, '\\s+').replace(/\\-/g, '[-\\s]+');
    const pattern = new RegExp(`^\\s*(${source})(?=\\b|\\s|$)`, 'i');
    const match = pattern.exec(raw);
    if (match) {
      return { value: match[1], length: match[0].length };
    }
  }
  return null;
}
