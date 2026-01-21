import type { D1Database } from '@cloudflare/workers-types';
import type { ExtractedQuery, SearchPlan, QueryHint, Ambiguity } from '@uiuc-course-search/query-types';

const GENED_SYNONYMS: Record<string, string[]> = {
  // Composition
  'CMP': ['comp 1', 'composition', 'writing', 'rhet 105', 'freshman comp', 'comp1'],
  'ACP': ['adv comp', 'advanced composition', 'advanced comp', 'writing intensive', 'cll'],

  // Humanities & Arts
  'HUM': ['humanities', 'humanities and the arts', 'arts'],
  'HP': ['historical', 'philosophical', 'history', 'philosophy', 'historical perspectives'],
  'LA': ['literature', 'lit', 'literature and the arts'],

  // Natural Sciences
  'NAT': ['nat sci', 'natural sciences', 'science', 'natural sciences and technology'],
  'PS': ['physical sciences', 'physical'],
  'LS': ['life sciences', 'life sci', 'bio', 'biology'],

  // Social & Behavioral Sciences
  'SBS': ['social science', 'behavioral science', 'social and behavioral', 'social', 'behavioral'],
  'SS': ['soc sci'],
  'BSC': ['psych', 'psychology'],

  // Cultural Studies
  'CS': ['cultural studies', 'cultural'],
  'NW': ['non-western', 'non western', 'nonwestern'],
  'US': ['us minority', 'minority cultures', 'us minority cultures'],
  'WCC': ['western', 'comparative', 'western comparative'],

  // Quantitative Reasoning
  'QR': ['quantitative', 'quant', 'quantitative reasoning'],
  'QR1': ['qr1', 'qr 1', 'quant 1', 'quantitative reasoning 1', 'qri'],
  'QR2': ['qr2', 'qr 2', 'quant 2', 'quantitative reasoning 2', 'qrii'],
};

// Build reverse lookup
const GENED_LOOKUP: Record<string, string> = {};
for (const [code, synonyms] of Object.entries(GENED_SYNONYMS)) {
  GENED_LOOKUP[code.toLowerCase()] = code;
  for (const syn of synonyms) {
    GENED_LOOKUP[syn.toLowerCase()] = code;
  }
}

// Subject codes that conflict with GenEd codes
const SUBJECT_GENED_CONFLICTS = new Set(['CS', 'PS']);

export async function resolveQuery(db: D1Database, extracted: ExtractedQuery): Promise<SearchPlan> {
  const plan: SearchPlan = {
    filters: {},
    semanticQuery: extracted.residual,
    keywordQuery: extracted.residual,
    ambiguities: []
  };

  for (const hint of extracted.hints) {
    switch (hint.type) {
      case 'course_code':
        await resolveCourseCode(db, hint, plan, extracted.rawQuery);
        break;

      case 'instructor':
        const instructorIds = await resolveInstructor(db, hint.value);
        if (instructorIds.length > 0) {
          plan.filters.instructor_ids = instructorIds;
        }
        break;

      case 'gened':
        resolveGened(hint.value, plan);
        break;

      case 'subject':
        const validSubject = await validateSubject(db, hint.value);
        if (validSubject) {
          plan.filters.subject = validSubject;
        }
        break;

      case 'crn':
        // CRN is a direct lookup - handled specially in search
        plan.filters.crn = hint.value;
        break;
    }
  }

  // Clean up empty ambiguities array
  if (plan.ambiguities?.length === 0) {
    delete plan.ambiguities;
  }

  return plan;
}

async function resolveCourseCode(
  db: D1Database,
  hint: QueryHint,
  plan: SearchPlan,
  rawQuery: string
): Promise<void> {
  const subject = hint.metadata?.subject;
  const number = hint.metadata?.number;

  if (!subject || !number) return;

  // Validate subject exists
  const validSubject = await validateSubject(db, subject);

  if (validSubject) {
    plan.filters.subject = validSubject;
    plan.filters.number = number;

    // Check for subject/gened conflict
    if (SUBJECT_GENED_CONFLICTS.has(validSubject)) {
      // Check context for disambiguation
      const genedKeywords = /gened|gen ed|requirement|fulfill/i;
      if (!genedKeywords.test(rawQuery)) {
        // Subject wins, but note the ambiguity
        const genedCode = GENED_LOOKUP[validSubject.toLowerCase()];
        if (genedCode) {
          plan.ambiguities = plan.ambiguities || [];
          plan.ambiguities.push({
            term: validSubject,
            chosen: { type: 'subject', value: validSubject, label: await getSubjectName(db, validSubject) },
            alternatives: [{ type: 'gened', value: genedCode, label: getGenedLabel(genedCode) }]
          });
        }
      }
    }

    // Clear residual since we've fully resolved this
    plan.semanticQuery = plan.semanticQuery.replace(hint.value, '').trim();
    plan.keywordQuery = plan.keywordQuery.replace(hint.value, '').trim();
  } else {
    // Subject not found - keep in semantic query for fuzzy matching
    plan.semanticQuery = (hint.value + ' ' + plan.semanticQuery).trim();
  }
}

async function validateSubject(db: D1Database, subject: string): Promise<string | null> {
  const upperSubject = subject.toUpperCase();

  // Check exact code match
  const result = await db.prepare('SELECT id FROM subjects WHERE id = ?')
    .bind(upperSubject)
    .first<{ id: string }>();

  if (result) return result.id;

  // Check by name (case-insensitive)
  const byName = await db.prepare('SELECT id FROM subjects WHERE LOWER(name) = LOWER(?)')
    .bind(subject)
    .first<{ id: string }>();

  if (byName) return byName.id;

  // TODO: Add alias lookup and fuzzy matching in Phase 5

  return null;
}

async function getSubjectName(db: D1Database, code: string): Promise<string> {
  const result = await db.prepare('SELECT name FROM subjects WHERE id = ?')
    .bind(code)
    .first<{ name: string }>();
  return result?.name || code;
}

function getGenedLabel(code: string): string {
  const labels: Record<string, string> = {
    'CS': 'Cultural Studies',
    'PS': 'Physical Sciences',
    'HUM': 'Humanities & Arts',
    'NAT': 'Natural Sciences',
    'SBS': 'Social & Behavioral Sciences',
    'QR': 'Quantitative Reasoning',
  };
  return labels[code] || code;
}

function resolveGened(value: string, plan: SearchPlan): void {
  const normalized = value.toLowerCase().trim();
  const code = GENED_LOOKUP[normalized];

  if (code) {
    plan.filters.gened_code = code;
  } else {
    // Keep raw value as fallback
    plan.filters.gened_code = value.toUpperCase();
  }
}

async function resolveInstructor(db: D1Database, name: string): Promise<number[]> {
  const query = `
    SELECT id FROM instructors
    WHERE last_name LIKE ? OR display_name LIKE ?
    LIMIT 10
  `;
  const { results } = await db.prepare(query)
    .bind(`%${name}%`, `%${name}%`)
    .all<{ id: number }>();

  return results.map(r => r.id);
}
