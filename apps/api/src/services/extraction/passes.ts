import { extractAttributesAndAliases } from './attributes.js';
import {
  extractCourseCodesAndCrns,
  extractInstructors,
  extractStandaloneEntities,
} from './entities.js';
import {
  extractNegations,
  extractPositiveNoNotAliases,
} from './negation.js';
import { cleanResidual } from './residual.js';
import {
  extractContextualGeneds,
  extractStudentShorthand,
} from './requirements.js';
import {
  extractPartOfTerm,
  extractQuestionScaffolding,
  extractTerms,
  maskCompressedTermPhrases,
} from './term.js';
import type { ExtractionPass } from './types.js';

export const EXTRACTION_PASSES: readonly ExtractionPass[] = [
  {
    id: 'positive_no_not_aliases',
    reads: ['normalized_text'],
    writes: ['attributes'],
    run(context) {
      context.residual = extractPositiveNoNotAliases(context.residual, context.hints);
    },
  },
  {
    id: 'general_negations',
    reads: ['normalized_text'],
    writes: ['negations'],
    run(context) {
      context.residual = extractNegations(context.residual, context.hints);
    },
  },
  {
    id: 'course_codes_and_crns',
    reads: ['normalized_text', 'negations'],
    writes: ['strict_entities'],
    run(context) {
      context.residual = extractCourseCodesAndCrns(context.residual, context.hints);
    },
  },
  {
    id: 'question_scaffolding',
    reads: ['normalized_text', 'strict_entities'],
    writes: ['question_scaffolding'],
    run(context) {
      context.residual = extractQuestionScaffolding(context.residual);
    },
  },
  {
    id: 'student_shorthand',
    reads: ['question_scaffolding'],
    writes: ['student_shorthand'],
    run(context) {
      context.residual = extractStudentShorthand(context.residual, context.hints);
    },
  },
  {
    id: 'term_and_part_of_term',
    reads: ['student_shorthand'],
    writes: ['term_filters'],
    run(context) {
      context.residual = extractTerms(context.residual, context.hints);
      context.residual = extractPartOfTerm(context.residual, context.hints);
      context.residual = maskCompressedTermPhrases(context.residual);
    },
  },
  {
    id: 'contextual_requirements',
    reads: ['term_filters'],
    writes: ['requirement_context'],
    run(context) {
      context.residual = extractContextualGeneds(context.residual, context.hints);
    },
  },
  {
    id: 'attributes_and_aliases',
    reads: ['requirement_context'],
    writes: ['attributes'],
    run(context) {
      context.residual = extractAttributesAndAliases(context.residual, context.hints);
    },
  },
  {
    id: 'instructors',
    reads: ['attributes'],
    writes: ['instructors'],
    run(context) {
      context.residual = extractInstructors(context.residual, context.hints);
    },
  },
  {
    id: 'standalone_entities',
    reads: ['instructors'],
    writes: ['standalone_entities'],
    run(context) {
      context.residual = extractStandaloneEntities(context.residual, context.hints);
    },
  },
  {
    id: 'clean_residual',
    reads: ['standalone_entities'],
    writes: ['clean_residual'],
    run(context) {
      context.residual = cleanResidual(context.residual);
    },
  },
];
