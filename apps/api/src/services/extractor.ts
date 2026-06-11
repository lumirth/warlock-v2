import { extractAttributesAndAliases } from './extraction/attributes.js';
import {
  extractCourseCodesAndCrns,
  extractInstructors,
  extractStandaloneEntities,
} from './extraction/entities.js';
import {
  extractNegations,
  extractPositiveNoNotAliases,
} from './extraction/negation.js';
import { cleanResidual } from './extraction/residual.js';
import {
  extractContextualRequirements,
  extractStudentShorthand,
} from './extraction/requirements.js';
import {
  extractPartOfTerm,
  extractQuestionScaffolding,
  extractTerms,
  maskCompressedTermPhrases,
} from './extraction/term.js';
import type { Hint } from './search-planner-types.js';

export interface ExtractionResult {
  hints: Hint[];
  residual: string;
}

export function extract(text: string): ExtractionResult {
  const hints: Hint[] = [];
  let residual = text.replace(/\u2019/g, "'");

  residual = extractPositiveNoNotAliases(residual, hints);
  residual = extractNegations(residual, hints);
  residual = extractCourseCodesAndCrns(residual, hints);
  residual = extractQuestionScaffolding(residual);
  residual = extractStudentShorthand(residual, hints);
  residual = extractTerms(residual, hints);
  residual = extractPartOfTerm(residual, hints);
  residual = maskCompressedTermPhrases(residual);
  residual = extractContextualRequirements(residual, hints);
  residual = extractAttributesAndAliases(residual, hints);
  residual = extractInstructors(residual, hints);
  residual = extractStandaloneEntities(residual, hints);
  residual = cleanResidual(residual);

  return { hints, residual };
}
