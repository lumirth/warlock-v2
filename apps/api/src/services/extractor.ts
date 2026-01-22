import type { Hint, HintType, HintMetadata } from '@uiuc-course-search/query-types';
import { createDefaultRegistry } from './alias-registry.js';

export interface ExtractionResult {
  hints: Hint[];
  residual: string;
}

const LEVEL_KEYWORDS: Record<string, number> = {
  'intro': 100,
  'introductory': 100,
  'beginner': 100,
  'advanced': 400,
  'upper': 400,
  'upper level': 400,
  'graduate': 500,
  'grad': 500,
};

/**
 * Extract structured hints from natural language text.
 * Three-phase extraction: regex → alias → NLP
 */
export function extract(text: string): ExtractionResult {
  const hints: Hint[] = [];
  let residual = text;

  // Phase 1: Regex patterns (structured data)
  residual = extractRegexPatterns(residual, hints);

  // Phase 2: Alias matching (known entities)
  residual = extractAliases(residual, hints);

  // Phase 3: NLP patterns (linguistic)
  residual = extractNlpPatterns(residual, hints);

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  return { hints, residual };
}

function extractRegexPatterns(text: string, hints: Hint[]): string {
  let residual = text;

  // Course codes: CS 225, cs225, MATH241
  const courseCodeRegex = /\b([A-Za-z]{2,4})\s*(\d{3})\b/g;
  let match;
  while ((match = courseCodeRegex.exec(text)) !== null) {
    hints.push({
      type: 'courseCode',
      value: { subject: match[1].toUpperCase(), number: match[2] },
      metadata: createMetadata('regex', match[0], 0.95),
    });
  }
  residual = residual.replace(courseCodeRegex, ' ');

  // CRN with prefix
  const crnPrefixRegex = /\bCRN\s*(\d{5})\b/gi;
  while ((match = crnPrefixRegex.exec(text)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.95),
    });
  }
  residual = residual.replace(crnPrefixRegex, ' ');

  // Standalone 5-digit CRN
  const crnRegex = /\b(\d{5})\b/g;
  while ((match = crnRegex.exec(residual)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.7),
    });
  }
  residual = residual.replace(crnRegex, ' ');

  // Credits: 3 credits, 4 credit hours, 3-credit
  const creditsRegex = /\b(\d)\s*-?\s*(?:credit|credits|cr|hour|hours)s?\b/gi;
  while ((match = creditsRegex.exec(text)) !== null) {
    hints.push({
      type: 'credits',
      value: parseInt(match[1]),
      metadata: createMetadata('regex', match[0], 0.9),
    });
  }
  residual = residual.replace(creditsRegex, ' ');

  // Level: 400 level, 400-level
  const levelNumRegex = /\b([1-5])00\s*-?\s*level\b/gi;
  while ((match = levelNumRegex.exec(text)) !== null) {
    hints.push({
      type: 'level',
      value: parseInt(match[1]) * 100,
      metadata: createMetadata('regex', match[0], 0.9),
    });
  }
  residual = residual.replace(levelNumRegex, ' ');

  // Level keywords: intro, advanced, graduate
  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS)) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    if (keywordRegex.test(text)) {
      hints.push({
        type: 'level',
        value: level,
        metadata: createMetadata('regex', keyword, 0.7),
      });
      residual = residual.replace(keywordRegex, ' ');
    }
  }

  // Days: MWF, TR, MW
  const daysPatterns = [
    { pattern: /\bMWF\b/gi, value: 'MWF' },
    { pattern: /\bTR\b/gi, value: 'TR' },
    { pattern: /\bMW\b/gi, value: 'MW' },
    { pattern: /\bWF\b/gi, value: 'WF' },
  ];
  for (const { pattern, value } of daysPatterns) {
    if (pattern.test(text)) {
      hints.push({
        type: 'days',
        value,
        metadata: createMetadata('regex', value, 0.9),
      });
      residual = residual.replace(pattern, ' ');
    }
  }

  return residual;
}

function extractAliases(text: string, hints: Hint[]): string {
  const registry = createDefaultRegistry();
  const matches = registry.match(text);
  let residual = text;

  for (const match of matches) {
    let hintType: HintType;
    let value: string | number | boolean;

    switch (match.kind) {
      case 'time':
        hintType = 'time';
        value = match.canonical;
        break;
      case 'difficulty':
        hintType = 'difficulty';
        value = match.canonical;
        break;
      case 'status':
        hintType = 'status';
        value = match.canonical;
        break;
      case 'delivery':
        hintType = 'online';
        value = match.canonical === 'true';
        break;
      case 'days':
        hintType = 'days';
        value = match.canonical;
        break;
      case 'gened':
        hintType = 'gened';
        value = match.canonical;
        break;
      default:
        continue;
    }

    hints.push({
      type: hintType,
      value,
      metadata: {
        source: 'alias',
        span: match.span,
        confidence: match.confidence,
        raw: match.raw,
      },
    });

    // Remove matched text from residual
    residual = residual.slice(0, match.span[0]) + ' '.repeat(match.span[1] - match.span[0]) + residual.slice(match.span[1]);
  }

  return residual;
}

function extractNlpPatterns(text: string, hints: Hint[]): string {
  let residual = text;

  // Instructor patterns: with X, by X, professor X, prof X, dr X
  const instructorPatterns = [
    /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    /\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    /\bprofessor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
    /\bprof\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
    /\bdr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
  ];

  for (const pattern of instructorPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      hints.push({
        type: 'instructor',
        value: match[1],
        metadata: createMetadata('nlp', match[0], 0.8),
      });
      residual = residual.replace(match[0], ' ');
    }
  }

  // Negation patterns: no mornings, not early, avoid X
  // (Simplified - full NLP would use Compromise)
  const negationPatterns = [
    /\bno\s+(\w+)\b/gi,
    /\bnot\s+(\w+)\b/gi,
    /\bavoid\s+(\w+)\b/gi,
  ];

  for (const pattern of negationPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const target = match[1].toLowerCase();
      // Map to negation hint type
      hints.push({
        type: 'negation',
        value: { target: guessNegationType(target), value: target },
        metadata: createMetadata('nlp', match[0], 0.75),
      });
      residual = residual.replace(match[0], ' ');
    }
  }

  return residual;
}

function guessNegationType(word: string): HintType {
  const timeWords = ['morning', 'afternoon', 'evening', 'early', 'night'];
  const daysWords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'mwf', 'tr'];

  if (timeWords.includes(word)) return 'time';
  if (daysWords.includes(word)) return 'days';
  return 'time'; // Default
}

function createMetadata(source: 'regex' | 'alias' | 'nlp', raw: string, confidence: number): HintMetadata {
  return { source, confidence, raw };
}
