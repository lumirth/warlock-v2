export type QueryHintType = 'instructor' | 'gened' | 'subject' | 'credits' | 'term' | 'level' | 'course_code' | 'crn' | 'days' | 'time' | 'difficulty' | 'online' | 'status';

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
  instructor_ids?: number[];
  gened_code?: string;
  subject?: string;
  number?: string;           // NEW: course number
  level?: number;
  credits?: number;
  term?: string;
  year?: number;             // NEW
  days?: string;             // NEW: "MWF", "TR"
  time_start?: string;       // NEW: "09:00"
  time_end?: string;         // NEW
  difficulty?: 'easy' | 'hard'; // NEW
  online?: boolean;          // NEW
  status?: 'open' | 'closed'; // NEW
  crn?: string;              // NEW: direct CRN lookup
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
  ambiguities?: Ambiguity[];  // NEW: for disambiguation hints
}
