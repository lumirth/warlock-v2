import type { Hint, HintType, HintMetadata } from './search-planner-types.js';
import { createDefaultRegistry } from './alias-registry.js';
import { VALID_SUBJECTS, UNSAFE_LOWERCASE_SUBJECTS } from './data/valid-subjects.js';
import {
  CONTEXTUAL_GENED_RULES,
  LEVEL_KEYWORDS_HARD,
  LEVEL_KEYWORDS_SOFT,
  NEGATED_SUBJECT_ALIASES,
  NEGATION_TARGET_STOP_WORDS,
  POSITIVE_NO_NOT_ALIASES,
  STOP_PHRASES,
  STUDENT_SHORTHAND_RULES,
  WORKLOAD_NEGATION_TERMS,
} from './student-language-lexicon.js';

export interface ExtractionResult {
  hints: Hint[];
  residual: string;
}

type ExtractionArtifact =
  | 'raw_text'
  | 'normalized_text'
  | 'negations'
  | 'strict_entities'
  | 'question_scaffolding'
  | 'student_shorthand'
  | 'term_filters'
  | 'requirement_context'
  | 'attributes'
  | 'instructors'
  | 'standalone_entities'
  | 'clean_residual';

type ExtractionContext = {
  hints: Hint[];
  residual: string;
};

type ExtractionPass = {
  id: string;
  reads: readonly ExtractionArtifact[];
  writes: readonly ExtractionArtifact[];
  run: (context: ExtractionContext) => void;
};

const STOP_PHRASES_REGEX = new RegExp(`\\b(${STOP_PHRASES.join('|')})\\b`, 'gi');

function removeStopPhrases(text: string): string {
  return text
    .replace(STOP_PHRASES_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cache the registry for performance
const ALIAS_REGISTRY = createDefaultRegistry();

/**
 * Extract structured hints from natural language text.
 * Explicit passes keep student-language interpretation separate from later retrieval.
 */
export function extract(text: string): ExtractionResult {
  const context: ExtractionContext = {
    hints: [],
    residual: text.replace(/[’]/g, "'"),
  };

  for (const pass of EXTRACTION_PASSES) {
    pass.run(context);
  }

  return { hints: context.hints, residual: context.residual };
}

/**
 * Alias for extract to match the requested interface.
 */
export const extractQuery = extract;

export const EXTRACTION_PASSES: readonly ExtractionPass[] = [
  {
    id: 'positive_no_not_aliases',
    reads: ['normalized_text'],
    writes: ['attributes'],
    run(context) {
      context.residual = extractPositiveNoNotAliases(context.residual, context.hints);
    },
  },
  {
    id: 'general_negations',
    reads: ['normalized_text'],
    writes: ['negations'],
    run(context) {
      context.residual = extractNegations(context.residual, context.hints);
    },
  },
  {
    id: 'course_codes_and_crns',
    reads: ['normalized_text', 'negations'],
    writes: ['strict_entities'],
    run(context) {
      context.residual = extractCourseCodesAndCrns(context.residual, context.hints);
    },
  },
  {
    id: 'question_scaffolding',
    reads: ['normalized_text', 'strict_entities'],
    writes: ['question_scaffolding'],
    run(context) {
      context.residual = extractQuestionScaffolding(context.residual);
    },
  },
  {
    id: 'student_shorthand',
    reads: ['question_scaffolding'],
    writes: ['student_shorthand'],
    run(context) {
      context.residual = extractStudentShorthand(context.residual, context.hints);
    },
  },
  {
    id: 'term_and_part_of_term',
    reads: ['student_shorthand'],
    writes: ['term_filters'],
    run(context) {
      context.residual = extractTerms(context.residual, context.hints);
      context.residual = extractPartOfTerm(context.residual, context.hints);
      context.residual = maskCompressedTermPhrases(context.residual);
    },
  },
  {
    id: 'contextual_requirements',
    reads: ['term_filters'],
    writes: ['requirement_context'],
    run(context) {
      context.residual = extractContextualGeneds(context.residual, context.hints);
    },
  },
  {
    id: 'attributes_and_aliases',
    reads: ['requirement_context'],
    writes: ['attributes'],
    run(context) {
      context.residual = extractAttributesAndAliases(context.residual, context.hints);
    },
  },
  {
    id: 'instructors',
    reads: ['attributes'],
    writes: ['instructors'],
    run(context) {
      context.residual = extractInstructors(context.residual, context.hints);
    },
  },
  {
    id: 'standalone_entities',
    reads: ['instructors'],
    writes: ['standalone_entities'],
    run(context) {
      context.residual = extractStandaloneEntities(context.residual, context.hints);
    },
  },
  {
    id: 'clean_residual',
    reads: ['standalone_entities'],
    writes: ['clean_residual'],
    run(context) {
      context.residual = removeStopPhrases(context.residual.replace(/\s+/g, ' ').trim());
    },
  },
];

/**
 * Helper to mask out matched ranges in a string to avoid fragile string.replace()
 */
function maskRange(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

function extractPositiveNoNotAliases(text: string, hints: Hint[]): string {
  let residual = text;

  for (const alias of POSITIVE_NO_NOT_ALIASES) {
    const matches: { index: number; length: number }[] = [];
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

    for (let index = matches.length - 1; index >= 0; index -= 1) {
      residual = maskRange(residual, matches[index].index, matches[index].length);
    }
  }

  return residual;
}

function extractNegations(text: string, hints: Hint[]): string {
  let residual = text;
  const negationPatterns = [
    /\b(?:no|not|without|avoid|avoiding|isn['’]?t|arent|aren['’]?t|doesnt|doesn['’]?t)\s+([a-z0-9+#-]+(?:\s+(?!and\b|but\b|or\b|then\b|with\b|for\b|that\b|which\b|who\b|what\b|no\b|not\b|without\b|avoid\b|avoiding\b|\d+\b)[a-z0-9+#-]+){0,3})\b/gi,
  ];

  for (const pattern of negationPatterns) {
    let match;
    const matches: { index: number; length: number }[] = [];
    const patternCopy = new RegExp(pattern.source, pattern.flags);
    
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
    
    // Apply matches in reverse order to keep indices valid
    for (let i = matches.length - 1; i >= 0; i--) {
      residual = maskRange(residual, matches[i].index, matches[i].length);
    }
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
    return {
      negation: {
        target: 'subject',
        value: NEGATED_SUBJECT_ALIASES[normalizeNegationTarget(subjectMatch.value)] ?? normalizeNegationTarget(subjectMatch.value),
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractQuestionScaffolding(text: string): string {
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

function extractStudentShorthand(text: string, hints: Hint[]): string {
  let residual = text;

  for (const rule of STUDENT_SHORTHAND_RULES) {
    const matches: { index: number; length: number; raw: string }[] = [];
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = pattern.exec(residual)) !== null) {
      hints.push({
        type: 'subject',
        value: rule.subject,
        metadata: createMetadata('alias', match[0], rule.confidence),
      });
      matches.push({ index: match.index, length: match[0].length, raw: match[0] });
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      const item = matches[i];
      residual =
        residual.slice(0, item.index) +
        rule.expansion.padEnd(item.length, ' ') +
        residual.slice(item.index + item.length);
    }
  }

  return residual;
}

function extractContextualGeneds(text: string, hints: Hint[]): string {
  let residual = text;

  for (const rule of CONTEXTUAL_GENED_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const matches: { index: number; length: number }[] = [];
    let match;
    while ((match = pattern.exec(residual)) !== null) {
      if (rule.code === 'NAT' && isProtectedScienceSubjectPhrase(residual, match.index, match[0].length)) {
        continue;
      }

      hints.push({
        type: 'requirement',
        value: rule.code,
        metadata: createMetadata('nlp', match[0], rule.confidence),
      });
      if (rule.code === 'NAT' && /\b(?:easy|chill)\b/i.test(match[0])) {
        hints.push({
          type: 'workload',
          value: 'easy',
          metadata: createMetadata('nlp', match[0], 0.82),
        });
      }
      matches.push({ index: match.index, length: match[0].length });
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      residual = maskRange(residual, matches[i].index, matches[i].length);
    }
  }

  return residual;
}

function isProtectedScienceSubjectPhrase(text: string, start: number, length: number): boolean {
  const window = text
    .slice(Math.max(0, start - 16), Math.min(text.length, start + length + 16))
    .toLowerCase();

  return /\b(?:computer|political|data|information|materials?|library|crop|animal|food)\s+science\b/.test(window);
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

function extractPartOfTerm(text: string, hints: Hint[]): string {
  let residual = text;

  // 1. Explicit "Part of Term X" or "POT X"
  const potRegex = /\b(?:part\s+of\s+term|pot)\s+([A-Z0-9])\b/gi;
  let match;
  const matches: { index: number; length: number }[] = [];

  while ((match = potRegex.exec(residual)) !== null) {
    hints.push({
      type: 'partOfTerm',
      value: match[1].toUpperCase(),
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matches.push({ index: match.index, length: match[0].length });
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, matches[i].index, matches[i].length);
  }

  // 2. "First Half" -> POT A
  const firstHalfRegex = /\bfirst\s+half\b/gi;
  const firstHalfMatches: { index: number; length: number }[] = [];
  while ((match = firstHalfRegex.exec(residual)) !== null) {
    hints.push({
      type: 'partOfTerm',
      value: 'A',
      metadata: createMetadata('alias', match[0], 0.9),
    });
    firstHalfMatches.push({ index: match.index, length: match[0].length });
  }
  for (let i = firstHalfMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, firstHalfMatches[i].index, firstHalfMatches[i].length);
  }

  // 3. "Second Half" -> POT B
  const secondHalfRegex = /\bsecond\s+half\b/gi;
  const secondHalfMatches: { index: number; length: number }[] = [];
  while ((match = secondHalfRegex.exec(residual)) !== null) {
    hints.push({
      type: 'partOfTerm',
      value: 'B',
      metadata: createMetadata('alias', match[0], 0.9),
    });
    secondHalfMatches.push({ index: match.index, length: match[0].length });
  }
  for (let i = secondHalfMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, secondHalfMatches[i].index, secondHalfMatches[i].length);
  }

  return residual;
}

function maskCompressedTermPhrases(text: string): string {
  return text.replace(/\b(?:8|eight)\s*-?\s*weeks?\b/gi, match => ' '.repeat(match.length));
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

  // 3. Level keywords (Hard filters)
  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS_HARD)) {
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

  // 4. Soft level keywords (Boost only)
  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS_SOFT)) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    let kMatch;
    // Don't mask these - leave them in residual for semantic matching too
    // Just add the hint
    while ((kMatch = keywordRegex.exec(residual)) !== null) {
      hints.push({
        type: 'levelBoost',
        value: level,
        metadata: createMetadata('regex', kMatch[0], 0.5),
      });
    }
  }

  // 5. Aliases
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
      case 'workload': hintType = 'workload'; value = match.canonical; break;
      case 'status': hintType = 'status'; value = match.canonical; break;
      case 'delivery': hintType = 'online'; value = match.canonical === 'true'; break;
      case 'days': hintType = 'days'; value = match.canonical; break;
      case 'subject': hintType = 'subject'; value = match.canonical; break;
      case 'requirement': hintType = 'requirement'; value = match.canonical; break;
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
  const nameToken = String.raw`[A-Za-z][A-Za-z.'-]*`;
  const nameSequence = String.raw`(${nameToken}(?:\s+${nameToken}){0,1})`;
  const instructorPatterns = [
    new RegExp(String.raw`\b(?:with|by|taught\s+by|instructor|professor|prof\.?|dr\.?)\s+${nameSequence}\b`, 'gi'),
  ];

  for (const pattern of instructorPatterns) {
    let match;
    const matches: { index: number; length: number }[] = [];
    const patternCopy = new RegExp(pattern.source, pattern.flags);
    while ((match = patternCopy.exec(residual)) !== null) {
      const rawInstructorName = match[1].trim();
      const instructorName = trimTrailingSubjectCode(rawInstructorName);
      if (!looksLikeInstructorName(instructorName)) {
        continue;
      }

      const matchedText = match[0].slice(0, match[0].lastIndexOf(instructorName) + instructorName.length);

      hints.push({
        type: 'instructor',
        value: instructorName,
        metadata: createMetadata('nlp', matchedText, 0.8),
      });
      matches.push({ index: match.index, length: matchedText.length });
    }
    for (let i = matches.length - 1; i >= 0; i--) {
      residual = maskRange(residual, matches[i].index, matches[i].length);
    }
  }
  return residual;
}

function trimTrailingSubjectCode(value: string): string {
  const tokens = value.trim().split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  if (tokens.length > 1 && VALID_SUBJECTS.has(lastToken.toUpperCase()) && lastToken === lastToken.toUpperCase()) {
    return tokens.slice(0, -1).join(' ');
  }

  return value;
}

const INSTRUCTOR_STOP_WORDS = new Set([
  'about',
  'afternoon',
  'closed',
  'course',
  'courses',
  'credit',
  'credits',
  'difficulty',
  'workload',
  'easy',
  'evening',
  'friday',
  'gen',
  'gpa',
  'hard',
  'monday',
  'morning',
  'no',
  'online',
  'open',
  'quality',
  'rating',
  'remote',
  'section',
  'sections',
  'thursday',
  'time',
  'tuesday',
  'wednesday',
]);

function looksLikeInstructorName(value: string): boolean {
  const tokens = value
    .split(/\s+/)
    .map(token => token.toLowerCase().replace(/[^a-z'-]/g, ''))
    .filter(Boolean);

  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  return tokens.every(token => token.length > 1 && !INSTRUCTOR_STOP_WORDS.has(token));
}

function createMetadata(source: 'regex' | 'alias' | 'nlp', raw: string, confidence: number): HintMetadata {
  return { source, confidence, raw };
}
