import type { ExtractionResult } from './extractor.js';
import type {
  ExtractedQuery,
  ParsedQuery,
  SearchPlan,
} from './search-planner-types.js';

export type SearchCompilerEventStage =
  | 'parse'
  | 'extract'
  | 'resolve'
  | 'compile'
  | 'rescue'
  | 'finalize';

export type SearchCompilerEvent = {
  stage: SearchCompilerEventStage;
  type: string;
  summary: string;
  data?: Record<string, unknown>;
};

export interface SearchPlanningInput {
  parsed: ParsedQuery;
  extraction: ExtractionResult;
  extracted: ExtractedQuery;
}

export interface SearchPlanningResult {
  extraction: ExtractionResult;
  queryResidual: string;
  plan: SearchPlan;
  fallbackPlans: SearchPlan[];
  compilerEvents: SearchCompilerEvent[];
}

export function compilerEvent(
  stage: SearchCompilerEventStage,
  type: string,
  summary: string,
  data?: Record<string, unknown>,
): SearchCompilerEvent {
  return data ? { stage, type, summary, data } : { stage, type, summary };
}
