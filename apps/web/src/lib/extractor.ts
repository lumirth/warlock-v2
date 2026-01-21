import nlp from 'compromise';
import type { ExtractedQuery, QueryHint } from '@uiuc-course-search/query-types';

export function extractQuery(text: string): ExtractedQuery {
  const doc = nlp(text);
  const hints: QueryHint[] = [];
  
  // 1. Extract potential instructors (Proper Nouns following "by", "with", "prof")
  const instructorMatch = doc.match('(by|with|prof|professor) [#ProperNoun+]');
  if (instructorMatch.found) {
    const value = instructorMatch.not('(by|with|prof|professor)').text().trim();
    hints.push({ type: 'instructor', value, confidence: 0.9 });
  }

  // 2. Extract GenEd categories
  const genedKeywords = ['humanities', 'arts', 'social', 'behavioral', 'natural', 'science', 'quantitative', 'reasoning', 'composition', 'western'];
  genedKeywords.forEach(keyword => {
    if (doc.has(keyword)) {
      hints.push({ type: 'gened', value: keyword, confidence: 0.8 });
    }
  });

  // 3. Extract Subjects (Upper case 2-4 letters, e.g., CS, ECE, ADV)
  const subjectMatch = doc.match('/^[A-Z]{2,4}$/');
  if (subjectMatch.found) {
    hints.push({ type: 'subject', value: subjectMatch.text().trim(), confidence: 0.95 });
  }

  // Calculate residual (everything not matched as a specific hint)
  // For a reference implementation, we'll just keep it simple
  let residual = text;
  hints.forEach(hint => {
    residual = residual.replace(new RegExp(hint.value, 'gi'), '');
  });
  // Also remove the trigger words
  residual = residual.replace(/\b(by|with|prof|professor|gened|gen ed)\b/gi, '');

  return {
    rawQuery: text,
    hints,
    residual: residual.replace(/\s+/g, ' ').trim()
  };
}
