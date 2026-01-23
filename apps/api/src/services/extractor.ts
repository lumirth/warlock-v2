import type { Hint, HintType, HintMetadata } from '@uiuc-course-search/query-types';
import { createDefaultRegistry } from './alias-registry.js';
import { VALID_SUBJECTS, UNSAFE_LOWERCASE_SUBJECTS } from './data/valid-subjects.js';

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
  'graduate': 500,
  'grad': 500,
};

// Cache the registry for performance
const ALIAS_REGISTRY = createDefaultRegistry();

/**
 * Extract structured hints from natural language text.
 * Multi-pass extraction to ensure order independence.
 */
export function extract(text: string): ExtractionResult {
  const hints: Hint[] = [];
  let residual = text;

  // Pass 1: Negations & Strict Entities (Course Codes, CRNs)
  // We extract negations early so they can capture terms before they are removed by aliases
  residual = extractNegations(residual, hints);
  residual = extractCourseCodesAndCrns(residual, hints);

  // Pass 1.5: Term extraction
  residual = extractTerms(residual, hints);

  // Pass 2: Attributes and Aliases (Level, Credits, Days, Time, etc.)
  residual = extractAttributesAndAliases(residual, hints);

  // Pass 3: NLP Patterns (Instructors)
  // We do this BEFORE standalone subjects so names like "Fagen" or words like "with" 
  // in instructor patterns aren't caught as subjects.
  residual = extractInstructors(residual, hints);

  // Pass 4: Standalone Subjects & Numbers
  // We do this after aliases and instructors to avoid matching "MWF" or names as subjects
  residual = extractStandaloneEntities(residual, hints);

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  // Remove stop-phrases
  residual = removeStopPhrases(residual);

  return { hints, residual };
}

// Stop-phrase removal - high-frequency generic tokens
const STOP_PHRASES = [
  'gen ed', 'gened', 'gen-ed',
  'section', 'sections',
  'class', 'classes',
  'course', 'courses',
  'only', 'booster'
];

function removeStopPhrases(text: string): string {
  let result = text;
  for (const phrase of STOP_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    result = result.replace(regex, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Alias for extract to match the requested interface.
 */
export const extractQuery = extract;

/**
 * Helper to mask out matched ranges in a string to avoid fragile string.replace()
 */
function maskRange(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

function extractNegations(text: string, hints: Hint[]): string {
  let residual = text;
  const negationPatterns = [
    /\bno\s+(\w+)\b/gi,
    /\bnot\s+(\w+)\b/gi,
    /\bavoid\s+(\w+)\b/gi,
  ];

  for (const pattern of negationPatterns) {
    let match;
    const matches: { index: number; length: number }[] = [];
    const patternCopy = new RegExp(pattern.source, pattern.flags);
    
    while ((match = patternCopy.exec(residual)) !== null) {
      const target = match[1].toLowerCase();
      hints.push({
        type: 'negation',
        value: { target: guessNegationType(target), value: target },
        metadata: createMetadata('nlp', match[0], 0.75),
      });
      matches.push({ index: match.index, length: match[0].length });
    }
    
    // Apply matches in reverse order to keep indices valid
    for (let i = matches.length - 1; i >= 0; i--) {
      residual = maskRange(residual, matches[i].index, matches[i].length);
    }
  }
  return residual;
}

function extractTerms(text: string, hints: Hint[]): string {
  let residual = text;
  const termRegex = /\b(spring|fall|summer|winter)\s*(20\d{2})\b/gi;

  let match;
  const matches: { index: number; length: number }[] = [];

  while ((match = termRegex.exec(text)) !== null) {
    hints.push({
      type: 'term',
      value: { term: match[1].toLowerCase(), year: parseInt(match[2]) },
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matches.push({ index: match.index, length: match[0].length });
  }

  // Mask matches in reverse order
  for (let i = matches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, matches[i].index, matches[i].length);
  }

  return residual;
}

function extractCourseCodesAndCrns(text: string, hints: Hint[]): string {
  let residual = text;
  const matchesToMask: { index: number; length: number }[] = [];

  // 1. Course codes: CS 225, MATH 241
  const courseCodeRegex = /\b([A-Za-z]{2,4})\s*(\d{3})\b(?!\s*-?\s*level)/gi;
  let match;
  while ((match = courseCodeRegex.exec(text)) !== null) {
    hints.push({
      type: 'courseCode',
      value: { subject: match[1].toUpperCase(), number: match[2] },
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matchesToMask.push({ index: match.index, length: match[0].length });
  }

  // 2. CRN with prefix
  const crnPrefixRegex = /\bCRN\s*(\d{5})\b/gi;
  while ((match = crnPrefixRegex.exec(text)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matchesToMask.push({ index: match.index, length: match[0].length });
  }

  // Mask after collecting from original text
  matchesToMask.sort((a, b) => b.index - a.index);
  for (const m of matchesToMask) {
    residual = maskRange(residual, m.index, m.length);
  }

  // 3. Standalone 5-digit CRN (search in residual)
  const crnRegex = /\b(\d{5})\b/g;
  const crnMatches: { index: number; length: number }[] = [];
  while ((match = crnRegex.exec(residual)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.7),
    });
    crnMatches.push({ index: match.index, length: match[0].length });
  }
  
  for (let i = crnMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, crnMatches[i].index, crnMatches[i].length);
  }

  return residual;
}

function extractAttributesAndAliases(text: string, hints: Hint[]): string {
  let residual = text;

  // 1. Credits
  const creditsRegex = /\b(\d{1,2})\s*-?\s*(?:credit|credits|cr|hour|hours)s?\b/gi;
  let match;
  const creditMatches: { index: number; length: number }[] = [];
  while ((match = creditsRegex.exec(residual)) !== null) {
    hints.push({
      type: 'credits',
      value: parseInt(match[1]),
      metadata: createMetadata('regex', match[0], 0.9),
    });
    creditMatches.push({ index: match.index, length: match[0].length });
  }
  for (let i = creditMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, creditMatches[i].index, creditMatches[i].length);
  }

  // 2. Level
  const levelNumRegex = /\b([1-5])00\s*-?\s*level\b/gi;
  const levelMatches: { index: number; length: number }[] = [];
  while ((match = levelNumRegex.exec(residual)) !== null) {
    hints.push({
      type: 'level',
      value: parseInt(match[1]) * 100,
      metadata: createMetadata('regex', match[0], 0.9),
    });
    levelMatches.push({ index: match.index, length: match[0].length });
  }
  for (let i = levelMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, levelMatches[i].index, levelMatches[i].length);
  }

  // 3. Level keywords
  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS)) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    let kMatch;
    const kMatches: { index: number; length: number }[] = [];
    while ((kMatch = keywordRegex.exec(residual)) !== null) {
      hints.push({
        type: 'level',
        value: level,
        metadata: createMetadata('regex', kMatch[0], 0.7),
      });
      kMatches.push({ index: kMatch.index, length: kMatch[0].length });
    }
    for (let i = kMatches.length - 1; i >= 0; i--) {
      residual = maskRange(residual, kMatches[i].index, kMatches[i].length);
    }
  }

  // 4. Aliases
  residual = extractAliases(residual, hints);

  return residual;
}

function extractAliases(text: string, hints: Hint[]): string {
  const matches = ALIAS_REGISTRY.match(text);
  let residual = text;

  const sortedMatches = [...matches].sort((a, b) => b.span[0] - a.span[0]);

  for (const match of sortedMatches) {
    let hintType: HintType;
    let value: string | number | boolean;

    switch (match.kind) {
      case 'time': hintType = 'time'; value = match.canonical; break;
      case 'difficulty': hintType = 'difficulty'; value = match.canonical; break;
      case 'status': hintType = 'status'; value = match.canonical; break;
      case 'delivery': hintType = 'online'; value = match.canonical === 'true'; break;
      case 'days': hintType = 'days'; value = match.canonical; break;
      case 'gened': hintType = 'gened'; value = match.canonical; break;
      default: continue;
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

    residual = residual.slice(0, match.span[0]) + ' '.repeat(match.span[1] - match.span[0]) + residual.slice(match.span[1]);
  }

  return residual;
}

function extractStandaloneEntities(text: string, hints: Hint[]): string {
  let residual = text;

  // Standalone Subject Codes (2-4 letters)
  // We scan for any 2-4 letter word that matches a valid subject code.
  // If the word is fully uppercase, we accept it (e.g. "THE" -> Theatre).
  // If the word is lowercase/mixed, we only accept it if it's NOT in the unsafe list (e.g. "phil" -> accepted, "the" -> ignored).
  const subjectRegex = /\b([a-zA-Z]{2,4})\b/g;

  let match;
  const subjectMatches: { index: number; length: number }[] = [];

  while ((match = subjectRegex.exec(residual)) !== null) {
    const raw = match[1];
    const upper = raw.toUpperCase();

    // 1. Must be a recognized subject code
    if (!VALID_SUBJECTS.has(upper)) {
      continue;
    }

    // 2. If not uppercase, must be "safe" (not a common English word)
    const isUppercase = raw === upper;
    if (!isUppercase && UNSAFE_LOWERCASE_SUBJECTS.has(upper)) {
      continue;
    }

    hints.push({
      type: 'subject',
      value: upper,
      metadata: createMetadata('regex', match[0], 0.6),
    });
    subjectMatches.push({ index: match.index, length: match[0].length });
  }

  for (let i = subjectMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, subjectMatches[i].index, subjectMatches[i].length);
  }

  // Standalone Course Numbers
  const numberRegex = /\b(\d{3})\b(?!\s*-?\s*level)/g;
  const numberMatches: { index: number; length: number }[] = [];
  while ((match = numberRegex.exec(residual)) !== null) {
    hints.push({
      type: 'courseCode',
      value: { subject: '', number: match[1] },
      metadata: createMetadata('regex', match[0], 0.5),
    });
    numberMatches.push({ index: match.index, length: match[0].length });
  }
  for (let i = numberMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, numberMatches[i].index, numberMatches[i].length);
  }

  return residual;
}

function extractInstructors(text: string, hints: Hint[]): string {
  let residual = text;
  // Improved regex to handle apostrophes and hyphens in names
  const instructorPatterns = [
    /\bwith\s+([A-Z][a-z']+(?:-[A-Z][a-z']+)?(?:\s+[A-Z][a-z']+(?:-[A-Z][a-z']+)?)*)\b/g,
    /\bby\s+([A-Z][a-z']+(?:-[A-Z][a-z']+)?(?:\s+[A-Z][a-z']+(?:-[A-Z][a-z']+)?)*)\b/g,
    /\bprofessor\s+([A-Z][a-z']+(?:-[A-Z][a-z']+)?(?:\s+[A-Z][a-z']+(?:-[A-Z][a-z']+)?)*)\b/gi,
    /\bprof\.?\s+([A-Z][a-z']+(?:-[A-Z][a-z']+)?(?:\s+[A-Z][a-z']+(?:-[A-Z][a-z']+)?)*)\b/gi,
    /\bdr\.?\s+([A-Z][a-z']+(?:-[A-Z][a-z']+)?(?:\s+[A-Z][a-z']+(?:-[A-Z][a-z']+)?)*)\b/gi,
  ];

  for (const pattern of instructorPatterns) {
    let match;
    const matches: { index: number; length: number }[] = [];
    const patternCopy = new RegExp(pattern.source, pattern.flags);
    while ((match = patternCopy.exec(residual)) !== null) {
      hints.push({
        type: 'instructor',
        value: match[1], // Do NOT uppercase name
        metadata: createMetadata('nlp', match[0], 0.8),
      });
      matches.push({ index: match.index, length: match[0].length });
    }
    for (let i = matches.length - 1; i >= 0; i--) {
      residual = maskRange(residual, matches[i].index, matches[i].length);
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
