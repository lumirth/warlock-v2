import type { Hint } from '../search-planner-types.js';
import {
  isKnownSubjectCode,
  isSafeStandaloneSubjectToken,
} from '../subject-taxonomy.js';
import { createMetadata, maskMatches, type TextMatch } from './text.js';

export function extractCourseCodesAndCrns(text: string, hints: Hint[]): string {
  let residual = text;
  const matchesToMask: TextMatch[] = [];

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

  const crnPrefixRegex = /\bCRN\s*(\d{5})\b/gi;
  while ((match = crnPrefixRegex.exec(text)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matchesToMask.push({ index: match.index, length: match[0].length });
  }

  residual = maskMatches(residual, matchesToMask);

  const crnRegex = /\b(\d{5})\b/g;
  const crnMatches: TextMatch[] = [];
  while ((match = crnRegex.exec(residual)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.7),
    });
    crnMatches.push({ index: match.index, length: match[0].length });
  }

  return maskMatches(residual, crnMatches);
}

export function extractStandaloneEntities(text: string, hints: Hint[]): string {
  let residual = text;
  const subjectRegex = /\b([a-zA-Z]{2,4})\b/g;
  const subjectMatches: TextMatch[] = [];

  let match;
  while ((match = subjectRegex.exec(residual)) !== null) {
    const raw = match[1];
    const upper = raw.toUpperCase();

    if (!isSafeStandaloneSubjectToken(raw)) {
      continue;
    }

    hints.push({
      type: 'subject',
      value: upper,
      metadata: createMetadata('regex', match[0], 0.6),
    });
    subjectMatches.push({ index: match.index, length: match[0].length });
  }

  residual = maskMatches(residual, subjectMatches);

  const numberRegex = /\b(\d{3})\b(?!\s*-?\s*level)/g;
  const numberMatches: TextMatch[] = [];
  while ((match = numberRegex.exec(residual)) !== null) {
    hints.push({
      type: 'courseCode',
      value: { subject: '', number: match[1] },
      metadata: createMetadata('regex', match[0], 0.5),
    });
    numberMatches.push({ index: match.index, length: match[0].length });
  }

  return maskMatches(residual, numberMatches);
}

export function extractInstructors(text: string, hints: Hint[]): string {
  let residual = text;
  const nameToken = String.raw`[A-Za-z][A-Za-z.'-]*`;
  const nameSequence = String.raw`(${nameToken}(?:\s+${nameToken}){0,1})`;
  const instructorPatterns = [
    new RegExp(String.raw`\b(?:with|by|taught\s+by|instructor|professor|prof\.?|dr\.?)\s+${nameSequence}\b`, 'gi'),
  ];

  for (const pattern of instructorPatterns) {
    const matches: TextMatch[] = [];
    const patternCopy = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = patternCopy.exec(residual)) !== null) {
      const rawInstructorName = match[1].trim();
      const instructorName = trimTrailingInstructorStopWords(
        trimTrailingSubjectCode(rawInstructorName),
      );
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
    residual = maskMatches(residual, matches);
  }
  return residual;
}

function trimTrailingSubjectCode(value: string): string {
  const tokens = value.trim().split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  if (tokens.length > 1 && isKnownSubjectCode(lastToken) && lastToken === lastToken.toUpperCase()) {
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

function trimTrailingInstructorStopWords(value: string): string {
  const tokens = value.trim().split(/\s+/);
  while (
    tokens.length > 1
    && INSTRUCTOR_STOP_WORDS.has(
      tokens[tokens.length - 1].toLowerCase().replace(/[^a-z'-]/g, ''),
    )
  ) {
    tokens.pop();
  }
  return tokens.join(' ');
}

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
