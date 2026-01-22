export type QueryHintType = 'instructor' | 'gened' | 'subject' | 'credits' | 'term' | 'level' | 'course_code' | 'crn' | 'days' | 'time' | 'difficulty' | 'online' | 'status' | 'negation';

export interface QueryHint {
  type: QueryHintType;
  value: string;
  confidence: number;
  isExplicit?: boolean;
  metadata?: Record<string, string>; // For course_code: { subject: 'CS', number: '225' }
}

export interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];
  residual: string;
}

export interface SearchFilters {
  // Entity filters
  instructor_ids?: number[];
  subject?: string;
  number?: string;
  crn?: string;
  gened_code?: string;
  gened_any?: string[];       // Course has ANY of these geneds
  gened_all?: string[];       // Course has ALL of these geneds

  // Schedule filters
  days?: string;
  time?: string;              // morning, afternoon, evening, early, midday

  // Attribute filters
  level?: number;
  credits?: number;
  online?: boolean;
  status?: string;
  difficulty?: 'easy' | 'hard';

  // Negations
  not?: {
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
  };

  // Legacy (keep for compatibility)
  term?: string;
  year?: number;
}

export interface Ambiguity {
  term: string;
  chosen: { type: string; value: string; label: string };
  alternatives: { type: string; value: string; label: string }[];
}

export interface SearchPlan {
  filters: SearchFilters;
  semanticQuery: string;
  keywordQuery: string;
  ambiguities?: Ambiguity[];
}

// === NEW TYPES FOR UNIFIED QUERY SYSTEM ===

// Hint metadata with source tracking
export interface HintMetadata {
  source: 'regex' | 'alias' | 'nlp';
  span?: [number, number];
  confidence: number;
  raw: string;
}

// Rich hint structure
export interface Hint {
  type: HintType;
  value: string | number | boolean | NegationValue | CourseCodeValue;
  metadata: HintMetadata;
}

export type HintType =
  | 'courseCode'
  | 'crn'
  | 'subject'
  | 'instructor'
  | 'days'
  | 'time'
  | 'level'
  | 'credits'
  | 'online'
  | 'status'
  | 'difficulty'
  | 'gened'
  | 'semester'
  | 'negation';

export interface NegationValue {
  target: HintType;
  value: string;
}

export interface CourseCodeValue {
  subject: string;
  number: string;
}

// Suggestion for ambiguous terms
export interface Suggestion {
  text: string;
  action: 'add_filter' | 'remove_filter' | 'change_filter';
  filter?: Partial<SearchFilters>;
}

// Parsed query from power-user syntax
export interface ParsedQuery {
  raw: string;
  clauses: ParsedClause[];
}

export interface ParsedClause {
  filters: FieldFilter[];
  negations: string[];
  phrases: string[];
  genedMode?: {
    any?: string[];
    all?: string[];
  };
  residual: string;
}

export interface FieldFilter {
  field: string;
  value: string;
  negated?: boolean;
}
