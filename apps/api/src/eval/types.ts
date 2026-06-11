import type { SearchIntentKind, SearchPlanWarningKind } from '../services/search-planner-types.js';

export type { QueryFailureClass } from '@uiuc-course-search/query-types';

interface ExpectedSearchIntent {
  queryTypes?: SearchIntentKind[];
  negativeTerms?: string[];
  warnings?: SearchPlanWarningKind[];
}

export interface ResultSelector {
  id?: string;
  subject?: string;
  number?: string;
  titleIncludes?: string;
  requirement?: string;
  level_gte?: number;
  level_lte?: number;
}

interface ResultCoherenceExpectation {
  non_empty?: boolean;
  top_k?: number;
  must_include?: ResultSelector[];
  must_exclude?: ResultSelector[];
  all_top_k?: {
    subjects?: string[];
    no_subjects?: string[];
    requirement?: string;
    level_gte?: number;
    level_lte?: number;
  };
  max_graduate_top_k?: number;
}

export interface GoldQuery {
  id: number;
  query: string;
  expected_filters: Record<string, unknown>;
  expected_filter_keys?: string[];
  expected_soft_preferences?: Record<string, unknown>;
  expected_intent?: ExpectedSearchIntent;
  expected_top1?: string;
  expected_top1_title?: string;
  expected_results?: ResultCoherenceExpectation;
  invariants?: {
    subject?: string;
    level_gte?: number;
    level_lte?: number;
    requirement?: string;
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
    | 'schedule'
    | 'decision'
    | 'unsupported_language';
  notes?: string;
}

export interface EvalResult {
  query: GoldQuery;
  actualFilters: Record<string, unknown>;
  results: Array<{
    id: string;
    title: string;
    subject: string;
    number: string;
    requirements?: Array<{
      categoryId?: string;
      category_id?: string;
      attributeCode?: string | null;
      attribute_code?: string | null;
    }>;
    avg_gpa?: number;
  }>;
  reciprocalRank: number | null;  // null if no expected_top1
  violations: string[];  // list of violated invariants
  parseViolations: string[];
  resultViolations: string[];
}

export interface EvalMetrics {
  totalQueries: number;
  passingQueries: number;
  failedQueries: number;
  violationCount: number;
  parseViolationCount: number;
  resultViolationCount: number;
  parseFailedQueries: number;
  resultFailedQueries: number;
  missingExpectedTopCount: number;
  mrr10: number;
  top1Accuracy: number;
  constraintViolationRate: number;
  zeroResultRate: number;
  byCategory: Record<string, { count: number; mrr: number; violations: number }>;
}
