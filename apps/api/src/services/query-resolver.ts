import type { D1Database } from '@cloudflare/workers-types';
import type { ExtractedQuery, SearchPlan, QueryHint } from '@uiuc-course-search/query-types';

const GENED_MAP: Record<string, string> = {
  'humanities': 'HUM',
  'arts': 'HUM',
  'social': 'SBS',
  'behavioral': 'SBS',
  'natural': 'NAT',
  'science': 'NAT',
  'technology': 'NAT',
  'quantitative': 'QR',
  'reasoning': 'QR',
  'composition': 'ACP',
  'advanced': 'ACP',
  'cultural': 'CUL',
  'western': 'Western',
  'non-western': 'Non-Western',
};

export async function resolveQuery(db: D1Database, extracted: ExtractedQuery): Promise<SearchPlan> {
  const plan: SearchPlan = {
    filters: {},
    semanticQuery: extracted.residual,
    keywordQuery: extracted.residual
  };

  for (const hint of extracted.hints) {
    switch (hint.type) {
      case 'instructor':
        const instructorIds = await resolveInstructor(db, hint.value);
        if (instructorIds.length > 0) {
          plan.filters.instructor_ids = instructorIds;
        }
        break;
      case 'gened':
        const code = GENED_MAP[hint.value.toLowerCase()];
        if (code) {
          plan.filters.gened_code = code;
        } else {
          // Fallback to raw value if not in map
          plan.filters.gened_code = hint.value;
        }
        break;
      case 'subject':
        plan.filters.subject = hint.value.toUpperCase();
        break;
      // Add more cases as needed
    }
  }

  return plan;
}

async function resolveInstructor(db: D1Database, name: string): Promise<number[]> {
  // Simple search by last name or display name
  // In a real app, we might use the trigram index if available
  const query = `
    SELECT id FROM instructors 
    WHERE last_name LIKE ? OR display_name LIKE ? 
    LIMIT 5
  `;
  const { results } = await db.prepare(query)
    .bind(`%${name}%`, `%${name}%`)
    .all<{ id: number }>();

  return results.map(r => r.id);
}
