import type { ExtractionResult } from './extractor.js';
import type { SearchPlan } from './search-planner-types.js';

type SearchCompilerEventStage =
  | 'parse'
  | 'extract'
  | 'resolve'
  | 'compile'
  | 'interpret'
  | 'finalize';

export type SearchCompilerEvent = {
  stage: SearchCompilerEventStage;
  type: string;
  summary: string;
  data?: Record<string, unknown>;
};

export interface SearchPlanningResult {
  extraction: ExtractionResult;
  queryResidual: string;
  plan: SearchPlan;
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
