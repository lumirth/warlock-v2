export interface GoldQuery {
  id: number;
  query: string;
  expected_filters: Record<string, unknown>;
  expected_filter_keys?: string[];
  expected_soft_preferences?: Record<string, unknown>;
  expected_residual: string;
  expected_top1?: string;
  expected_top1_title?: string;
  require_term_metadata?: boolean;
  allow_fallback_relaxation?: boolean;
  invariants?: {
    subject?: string;
    level_gte?: number;
    level_lte?: number;
    gened_code?: string;
    no_subject?: string;
  };
  category:
    | 'navigational'
    | 'structured'
    | 'semantic'
    | 'power_syntax'
    | 'edge_case_punctuation'
    | 'edge_case_range'
    | 'disambiguation'
    | 'instructor'
    | 'score'
    | 'schedule';
  notes?: string;
}

export interface EvalResult {
  query: GoldQuery;
  actualFilters: Record<string, unknown>;
  actualResidual: string;
  results: Array<{ id: string; title: string; subject: string; number: string; gened?: string | null; avg_gpa?: number }>;
  reciprocalRank: number | null;  // null if no expected_top1
  violations: string[];  // list of violated invariants
  tierReached: number | null;
}

export interface EvalMetrics {
  totalQueries: number;
  passingQueries: number;
  failedQueries: number;
  violationCount: number;
  missingExpectedTopCount: number;
  mrr10: number;
  top1Accuracy: number;
  constraintViolationRate: number;
  zeroResultRate: number;
  byCategory: Record<string, { count: number; mrr: number; violations: number }>;
}
