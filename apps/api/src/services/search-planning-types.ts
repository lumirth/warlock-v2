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
  fallbackPlans: SearchFallbackPlan[];
  compilerEvents: SearchCompilerEvent[];
}

export type SearchFallbackPlan = {
  plan: SearchPlan;
  /**
   * Human-readable summaries of the broadening step represented by this plan.
   * These travel with the executable fallback so public metadata cannot drift
   * away from the fallback that actually ran.
   */
  constraintsRelaxed: string[];
};

export function compilerEvent(
  stage: SearchCompilerEventStage,
  type: string,
  summary: string,
  data?: Record<string, unknown>,
): SearchCompilerEvent {
  return data ? { stage, type, summary, data } : { stage, type, summary };
}
