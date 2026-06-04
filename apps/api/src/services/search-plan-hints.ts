import type { SearchRequestFiltersDto } from '@uiuc-course-search/query-types';
import { extractQuery, type ExtractionResult } from './extractor.js';
import { parseQuery } from './query-parser.js';
import type {
  Hint,
  QueryHint,
  QueryHintType,
} from './search-planner-types.js';
import type { SearchPlanningInput } from './search-planning-types.js';

function mapHintType(type: string): QueryHintType {
  const mapping: Record<string, QueryHintType> = {
    courseCode: 'course_code',
    crn: 'crn',
    subject: 'subject',
    instructor: 'instructor',
    days: 'days',
    time: 'time',
    level: 'level',
    levelBoost: 'levelBoost',
    credits: 'credits',
    online: 'online',
    status: 'status',
    difficulty: 'difficulty',
    gened: 'gened',
    term: 'term',
    partOfTerm: 'partOfTerm',
    negation: 'negation',
  };
  return (mapping[type] || type) as QueryHintType;
}

export function toQueryHint(hint: Hint): QueryHint {
  const queryHint: QueryHint = {
    type: mapHintType(hint.type),
    value:
      typeof hint.value === 'object' &&
      hint.value !== null &&
      'subject' in hint.value
        ? `${hint.value.subject} ${hint.value.number}`
        : hint.value,
    confidence: hint.metadata.confidence,
    isExplicit:
      hint.metadata.source === 'regex' || hint.metadata.source === 'manual',
    metadata: {
      raw: hint.metadata.raw,
      source: hint.metadata.source,
    },
  };

  if (
    hint.type === 'courseCode' &&
    typeof hint.value === 'object' &&
    hint.value !== null &&
    'subject' in hint.value
  ) {
    queryHint.metadata = {
      ...queryHint.metadata,
      subject: hint.value.subject,
      number: hint.value.number,
    };
  }

  return queryHint;
}

export function extractSearchPlanningInput(query: string): SearchPlanningInput {
  const parsed = parseQuery(query);
  const extraction = extractQuery(parsed.clauses[0].residual);

  return {
    parsed,
    extraction,
    extracted: {
      rawQuery: query,
      hints: extraction.hints.map(toQueryHint),
      residual: extraction.residual,
    },
  };
}

function manualHint(
  type: Hint['type'],
  value: Hint['value'],
  raw: string,
): Hint {
  return {
    type,
    value,
    metadata: {
      source: 'manual',
      confidence: 1,
      raw,
    },
  };
}

function addManualHint(hints: Hint[], hint: Hint): void {
  const signature = `${hint.type}:${JSON.stringify(hint.value)}`;
  const exists = hints.some(
    (existing) =>
      `${existing.type}:${JSON.stringify(existing.value)}` === signature,
  );
  if (!exists) {
    hints.push(hint);
  }
}

function manualHintsFromRequestFilters(filters?: SearchRequestFiltersDto): Hint[] {
  if (!filters) return [];

  const hints: Hint[] = [];
  if (filters.subject && filters.number) {
    addManualHint(
      hints,
      manualHint(
        'courseCode',
        { subject: filters.subject, number: filters.number },
        `${filters.subject} ${filters.number}`,
      ),
    );
  } else if (filters.subject) {
    addManualHint(
      hints,
      manualHint('subject', filters.subject, filters.subject),
    );
  }
  if (filters.instructor) {
    addManualHint(
      hints,
      manualHint(
        'instructor',
        filters.instructor,
        filters.instructor,
      ),
    );
  }
  if (filters.term && filters.year) {
    addManualHint(
      hints,
      manualHint(
        'term',
        { term: filters.term, year: filters.year },
        `${filters.term} ${filters.year}`,
      ),
    );
  }
  if (filters.gened) {
    addManualHint(
      hints,
      manualHint('gened', filters.gened, filters.gened),
    );
  }
  if (filters.credits !== undefined) {
    addManualHint(
      hints,
      manualHint('credits', filters.credits, String(filters.credits)),
    );
  }
  if (filters.level !== undefined) {
    addManualHint(
      hints,
      manualHint('level', filters.level, `${filters.level} level`),
    );
  }
  if (filters.days) {
    addManualHint(hints, manualHint('days', filters.days, filters.days));
  }
  if (filters.time) {
    addManualHint(hints, manualHint('time', filters.time, filters.time));
  }
  if (filters.online !== undefined) {
    addManualHint(
      hints,
      manualHint('online', filters.online, String(filters.online)),
    );
  }
  if (filters.status) {
    addManualHint(
      hints,
      manualHint('status', filters.status, filters.status),
    );
  }
  if (filters.difficulty) {
    addManualHint(
      hints,
      manualHint('difficulty', filters.difficulty, filters.difficulty),
    );
  }

  return hints;
}

export function withManualRequestFilterHints(
  input: SearchPlanningInput,
  filters?: SearchRequestFiltersDto,
): SearchPlanningInput {
  const manualHints = manualHintsFromRequestFilters(filters);
  if (manualHints.length === 0) {
    return input;
  }

  const extractionHints = [...input.extraction.hints];
  for (const hint of manualHints) {
    addManualHint(extractionHints, hint);
  }

  const extraction: ExtractionResult = {
    ...input.extraction,
    hints: extractionHints,
  };

  return {
    ...input,
    extraction,
    extracted: {
      ...input.extracted,
      hints: extractionHints.map(toQueryHint),
    },
  };
}
