import type { ExtractedQuery, QueryHint } from '@uiuc-course-search/query-types';

export function extractQueryLite(query: string): ExtractedQuery {
  const hints: QueryHint[] = [];
  let residual = query;

  // 1. Course code pattern: "CS 225", "cs225", "MATH241"
  // Matches 2-4 letter subject + optional space + 3-digit number
  const courseCodeRegex = /\b([A-Za-z]{2,4})\s*(\d{3})\b/g;
  let courseMatch;
  while ((courseMatch = courseCodeRegex.exec(residual)) !== null) {
    hints.push({
      type: 'course_code',
      value: `${courseMatch[1].toUpperCase()} ${courseMatch[2]}`,
      confidence: 0.95,
      metadata: {
        subject: courseMatch[1].toUpperCase(),
        number: courseMatch[2]
      }
    });
  }
  // Remove matched course codes from residual
  residual = residual.replace(courseCodeRegex, ' ');

  // 2. CRN pattern: standalone 5-digit number or "CRN 12345"
  const crnWithPrefixRegex = /\bCRN\s*(\d{5})\b/gi;
  let crnPrefixMatch;
  while ((crnPrefixMatch = crnWithPrefixRegex.exec(residual)) !== null) {
    hints.push({
      type: 'crn',
      value: crnPrefixMatch[1],
      confidence: 0.95
    });
  }
  residual = residual.replace(crnWithPrefixRegex, ' ');

  // Standalone 5-digit number (only if no other context suggests it's something else)
  const standaloneCrnRegex = /\b(\d{5})\b/g;
  let standaloneCrnMatch;
  while ((standaloneCrnMatch = standaloneCrnRegex.exec(residual)) !== null) {
    // Only treat as CRN if it's the primary content or clearly a CRN
    hints.push({
      type: 'crn',
      value: standaloneCrnMatch[1],
      confidence: 0.7  // Lower confidence for standalone numbers
    });
  }
  residual = residual.replace(standaloneCrnRegex, ' ');

  // 3. Instructor pattern: "by [Name]", "with [Name]", "prof [Name]", "professor [Name]"
  const instructorRegex = /\b(by|with|prof|professor)\s+([a-zA-Z][\w-]*)/gi;
  let instructorMatch;
  while ((instructorMatch = instructorRegex.exec(residual)) !== null) {
    hints.push({
      type: 'instructor',
      value: instructorMatch[2].toLowerCase(),
      confidence: 0.8
    });
  }
  residual = residual.replace(instructorRegex, ' ');

  // 4. Difficulty: "easy", "hard", "difficult" - extract BEFORE gened to avoid conflicts
  const easyRegex = /\b(easy|simple|gpa booster)\b/gi;
  if (easyRegex.test(residual)) {
    hints.push({ type: 'difficulty', value: 'easy', confidence: 0.7 });
  }
  residual = residual.replace(easyRegex, ' ');

  const hardRegex = /\b(hard|difficult|challenging)\b/gi;
  if (hardRegex.test(residual)) {
    hints.push({ type: 'difficulty', value: 'hard', confidence: 0.7 });
  }
  residual = residual.replace(hardRegex, ' ');

  // 5. GenEd pattern: "gened [Category]" or "[Category] gened"
  const genedForwardRegex = /\b(gened|gen ed|gen-ed)\s+([a-zA-Z]+)/gi;
  let genedMatch;
  while ((genedMatch = genedForwardRegex.exec(residual)) !== null) {
    hints.push({
      type: 'gened',
      value: genedMatch[2].toLowerCase(),
      confidence: 0.7
    });
  }
  residual = residual.replace(genedForwardRegex, ' ');

  const genedBackwardRegex = /\b([a-zA-Z]+)\s+(gened|gen ed|gen-ed)\b/gi;
  while ((genedMatch = genedBackwardRegex.exec(residual)) !== null) {
    hints.push({
      type: 'gened',
      value: genedMatch[1].toLowerCase(),
      confidence: 0.6
    });
  }
  residual = residual.replace(genedBackwardRegex, ' ');

  // 6. Time of day
  const timeKeywords: Record<string, string> = {
    'morning': 'morning',
    'afternoon': 'afternoon',
    'evening': 'evening',
    'night': 'evening',
  };
  for (const [keyword, value] of Object.entries(timeKeywords)) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    if (regex.test(residual)) {
      hints.push({ type: 'time', value, confidence: 0.7 });
      residual = residual.replace(regex, ' ');
    }
  }

  // 7. Days pattern
  const daysPatterns: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bMWF\b/gi, value: 'MWF' },
    { pattern: /\bTR\b/gi, value: 'TR' },
    { pattern: /\bMW\b/gi, value: 'MW' },
    { pattern: /\b(tuesday|tue)\s*(thursday|thu|and\s*thursday)\b/gi, value: 'TR' },
    { pattern: /\b(monday|mon)\s*(wednesday|wed)\s*(friday|fri)\b/gi, value: 'MWF' },
  ];
  for (const { pattern, value } of daysPatterns) {
    if (pattern.test(residual)) {
      hints.push({ type: 'days', value, confidence: 0.8 });
      residual = residual.replace(pattern, ' ');
    }
  }

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  return {
    rawQuery: query,
    hints,
    residual
  };
}
