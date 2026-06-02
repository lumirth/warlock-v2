import type { D1Database } from '@cloudflare/workers-types';
import type { ExtractedQuery, SearchPlan, QueryHint } from '@uiuc-course-search/query-types';

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

type InstructorResolution = {
  ids: number[];
  residualText?: string;
};

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

      case 'instructor': {
        const resolution = await resolveInstructor(db, String(hint.value));
        if (resolution.ids.length > 0) {
          plan.filters.instructor_ids = resolution.ids;
          if (resolution.residualText) {
            plan.semanticQuery = appendQueryText(plan.semanticQuery, resolution.residualText);
            plan.keywordQuery = appendQueryText(plan.keywordQuery, resolution.residualText);
          }
        }
        break;
      }

      case 'gened':
        resolveGened(String(hint.value), plan);
        break;

      case 'subject': {
        const subjectValue = String(hint.value);
        const validSubj = await validateSubject(db, subjectValue);
        if (validSubj) {
          plan.filters.subject = validSubj;
        } else {
          plan.keywordQuery = (plan.keywordQuery + " " + subjectValue).trim();
          plan.semanticQuery = (plan.semanticQuery + " " + subjectValue).trim();
        }
        break;
      }

      case 'crn':
        // CRN is a direct lookup - handled specially in search
        plan.filters.crn = String(hint.value);
        break;

      case 'days':
        plan.filters.days = hint.value as string;
        break;

      case 'time':
        plan.filters.time = hint.value as string;
        break;

      case 'partOfTerm':
        plan.filters.partOfTerm = hint.value as string;
        break;

      case 'term': {
        if (typeof hint.value === 'object' && hint.value !== null && 'term' in hint.value && 'year' in hint.value) {
          plan.filters.term = hint.value.term;
          plan.filters.year = hint.value.year;
        } else if (typeof hint.value === 'string') {
          const parsed = parseTermValue(hint.value);
          if (parsed) {
            plan.filters.term = parsed.term;
            plan.filters.year = parsed.year;
          }
        }
        break;
      }

      case 'level': {
        const levelValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
        plan.filters.level = levelValue;
        break;
      }

      case 'levelBoost': {
        const levelValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
        plan.softPreferences = {
          ...plan.softPreferences,
          levelBoost: levelValue,
        };
        break;
      }

      case 'credits': {
        const creditsValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
        plan.filters.credits = creditsValue;
        break;
      }

      case 'online':
        if (typeof hint.value === 'boolean') {
          plan.filters.online = hint.value;
        } else {
          plan.filters.online = hint.value === 'true';
        }
        break;

      case 'status':
        plan.filters.status = hint.value as string;
        break;

      case 'difficulty':
        plan.filters.difficulty = hint.value as 'easy' | 'hard';
        break;

      case 'negation': {
        // Handle negation hints - they come as { target: HintType, value: string }
        const negValue = hint.value as { target: string; value: string } | string;
        if (typeof negValue === 'object' && 'target' in negValue) {
          plan.filters.not = plan.filters.not || {};
          if (negValue.target === 'time') {
            plan.filters.not.time = plan.filters.not.time || [];
            plan.filters.not.time.push(negValue.value);
          } else if (negValue.target === 'days') {
            plan.filters.not.days = plan.filters.not.days || [];
            plan.filters.not.days.push(negValue.value);
          }
        }
        break;
      }
    }
  }

  // Clean up empty ambiguities array
  if (plan.ambiguities?.length === 0) {
    delete plan.ambiguities;
  }

  return plan;
}

export function parseTermValue(value: string): { term: string; year: number } | null {
  const normalized = value.trim().toLowerCase();
  const match = /^(spring|fall|summer|winter)[-_ ]?(20\d{2})$/.exec(normalized)
    ?? /^(20\d{2})[-_ ]?(spring|fall|summer|winter)$/.exec(normalized);

  if (!match) {
    return null;
  }

  if (match[1].startsWith('20')) {
    return { year: parseInt(match[1], 10), term: match[2] };
  }

  return { term: match[1], year: parseInt(match[2], 10) };
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
    const rawValue = String(hint.value);
    plan.semanticQuery = plan.semanticQuery.replace(rawValue, '').trim();
    plan.keywordQuery = plan.keywordQuery.replace(rawValue, '').trim();
  } else {
    // Subject not found - keep in queries for fuzzy matching
    const rawValue = String(hint.value);
    plan.semanticQuery = (rawValue + " " + plan.semanticQuery).trim();
    plan.keywordQuery = (rawValue + " " + plan.keywordQuery).trim();
  }
}

export async function validateSubject(db: D1Database, subject: string): Promise<string | null> {
  const normalized = subject.toLowerCase().trim();
  const upper = subject.toUpperCase();

  // 1. Exact code match in subjects table
  const byCode = await db.prepare('SELECT id FROM subjects WHERE id = ?')
    .bind(upper)
    .first<{ id: string }>();
  if (byCode) return byCode.id;

  // 2. Full name match
  const byName = await db.prepare('SELECT id FROM subjects WHERE LOWER(name) = ?')
    .bind(normalized)
    .first<{ id: string }>();
  if (byName) return byName.id;

  // 3. Alias lookup
  const byAlias = await db.prepare('SELECT subject_id FROM subject_aliases WHERE alias = ?')
    .bind(normalized)
    .first<{ subject_id: string }>();
  if (byAlias) return byAlias.subject_id;

  // 4. Fuzzy match in subjects table
  if (normalized.length > 3) {
    const fuzzy = await db.prepare(`
      SELECT id FROM subjects
      WHERE name LIKE ? OR id LIKE ?
      LIMIT 1
    `)
      .bind(`%${normalized}%`, `%${upper}%`)
      .first<{ id: string }>();
    if (fuzzy) return fuzzy.id;
  }

  // 5. Fallback: check if subject code exists in courses table
  const byCourse = await db.prepare('SELECT DISTINCT subject FROM courses WHERE subject = ? LIMIT 1')
    .bind(upper)
    .first<{ subject: string }>();
  if (byCourse) return byCourse.subject;

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

async function resolveInstructor(db: D1Database, name: string): Promise<InstructorResolution> {
  const query = `
    SELECT id FROM instructors
    WHERE LOWER(last_name) LIKE ? OR LOWER(display_name) LIKE ?
    LIMIT 10
  `;
  const seen = new Set<number>();
  const ids: number[] = [];

  for (const candidate of instructorSearchCandidates(name)) {
    const pattern = `%${candidate.needle}%`;
    const { results } = await db.prepare(query)
      .bind(pattern, pattern)
      .all<{ id: number }>();

    for (const row of results) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        ids.push(row.id);
      }
    }

    if (ids.length > 0) {
      return { ids, residualText: candidate.residualText };
    }
  }

  return { ids };
}

function instructorSearchCandidates(name: string): InstructorResolutionCandidate[] {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const candidates: InstructorResolutionCandidate[] = [{ needle: normalized }];
  const tokens = normalized.split(/[^a-z0-9']+/).filter(token => token.length >= 3);
  const likelyLastName = tokens.at(-1);

  if (tokens.length > 1 && likelyLastName && likelyLastName !== normalized) {
    candidates.push({ needle: likelyLastName });
  }

  if (!/[-']/.test(normalized)) {
    for (let end = tokens.length - 1; end >= 1; end--) {
      const prefix = tokens.slice(0, end).join(' ');
      const dropped = tokens.slice(end).join(' ');
      if (prefix && dropped) {
        candidates.push({ needle: prefix, residualText: dropped });
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.needle}:${candidate.residualText ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type InstructorResolutionCandidate = {
  needle: string;
  residualText?: string;
};

function appendQueryText(query: string, addition: string): string {
  return [query, addition]
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');
}
