export type QueryHintType = 'instructor' | 'gened' | 'subject' | 'credits' | 'term' | 'level';

export interface QueryHint {
  type: QueryHintType;
  value: string; // "Fagen", "Humanities"
  confidence: number; // 0-1
  isExplicit?: boolean; // true if user clicked a chip or typed "instructor:..."
}

export interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];
  residual: string; // "easy" (parts not covered by hints)
}

export interface SearchPlan {
  filters: {
    instructor_ids?: number[];
    gened_code?: string;
    subject?: string;
    level?: number;
    credits?: number;
    term?: string;
  };
  semanticQuery: string; // The residual to vector search
  keywordQuery: string;  // The residual to keyword search
}
