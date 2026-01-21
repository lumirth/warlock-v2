import type { ExtractedQuery, QueryHint } from '@uiuc-course-search/query-types';

export function extractQueryLite(query: string): ExtractedQuery {
  const hints: QueryHint[] = [];
  let residual = query;

  // Simple regex heuristics for server-side fallback

  // 1. "by [Instructor]" - Priority 1
  const byMatch = residual.match(/\b(by|with|prof|professor)\s+([a-zA-Z]+)/i);
  if (byMatch) {
    hints.push({ type: 'instructor', value: byMatch[2], confidence: 0.8 });
    residual = residual.replace(byMatch[0], '');
  }

  // 2. "gened [Category]" - Priority 2 (more specific)
  const genedMatchForward = residual.match(/\b(gened|gen ed)\s+([a-zA-Z]+)/i);
  if (genedMatchForward) {
    hints.push({ type: 'gened', value: genedMatchForward[2], confidence: 0.7 });
    residual = residual.replace(genedMatchForward[0], '');
  } else {
    // 3. "[Category] gened" - Fallback
    const genedMatchBackward = residual.match(/\b([a-zA-Z]+)\s+(gened|gen ed)\b/i);
    if (genedMatchBackward) {
      // Avoid matching common words like "easy" if possible, but for lite we keep it simple
      hints.push({ type: 'gened', value: genedMatchBackward[1], confidence: 0.6 });
      residual = residual.replace(genedMatchBackward[0], '');
    }
  }

  return {
    rawQuery: query,
    hints,
    residual: residual.replace(/\s+/g, ' ').trim()
  };
}
