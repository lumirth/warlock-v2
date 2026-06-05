import { EXTRACTION_PASSES } from './extraction/passes.js';
import {
  createExtractionContext,
  runExtractionPasses,
  type ExtractionPass,
  type ExtractionResult,
} from './extraction/types.js';

export type { ExtractionPass, ExtractionResult };
export { EXTRACTION_PASSES };

/**
 * Extract structured hints from natural language text.
 * The facade stays small; extraction ownership lives in focused pass modules.
 */
export function extract(text: string): ExtractionResult {
  return runExtractionPasses(
    createExtractionContext(text),
    EXTRACTION_PASSES,
  );
}

/**
 * Alias for extract to match the requested interface.
 */
export const extractQuery = extract;
