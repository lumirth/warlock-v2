import type { Hint } from '../search-planner-types.js';

export interface ExtractionResult {
  hints: Hint[];
  residual: string;
}

export type ExtractionArtifact =
  | 'raw_text'
  | 'normalized_text'
  | 'negations'
  | 'strict_entities'
  | 'question_scaffolding'
  | 'student_shorthand'
  | 'term_filters'
  | 'requirement_context'
  | 'attributes'
  | 'instructors'
  | 'standalone_entities'
  | 'clean_residual';

export type ExtractionContext = {
  hints: Hint[];
  residual: string;
  artifacts: Set<ExtractionArtifact>;
};

export type ExtractionPass = {
  id: string;
  reads: readonly ExtractionArtifact[];
  writes: readonly ExtractionArtifact[];
  run: (context: ExtractionContext) => void;
};

export function createExtractionContext(text: string): ExtractionContext {
  return {
    hints: [],
    residual: text.replace(/\u2019/g, "'"),
    artifacts: new Set(['raw_text', 'normalized_text']),
  };
}

export function runExtractionPasses(
  context: ExtractionContext,
  passes: readonly ExtractionPass[],
): ExtractionResult {
  for (const pass of passes) {
    assertReadableArtifacts(context, pass);
    pass.run(context);
    assertWritableArtifacts(context, pass);
    for (const artifact of pass.writes) {
      context.artifacts.add(artifact);
    }
  }

  return { hints: context.hints, residual: context.residual };
}

function assertReadableArtifacts(
  context: ExtractionContext,
  pass: ExtractionPass,
): void {
  const missing = pass.reads.filter((artifact) => !context.artifacts.has(artifact));
  if (missing.length === 0) return;
  throw new Error(
    `Extraction pass "${pass.id}" reads missing artifacts: ${missing.join(', ')}`,
  );
}

function assertWritableArtifacts(
  context: ExtractionContext,
  pass: ExtractionPass,
): void {
  const missing = pass.writes.filter((artifact) => !artifactIsPresent(context, artifact));
  if (missing.length === 0) return;
  throw new Error(
    `Extraction pass "${pass.id}" declared missing writes: ${missing.join(', ')}`,
  );
}

function artifactIsPresent(
  context: ExtractionContext,
  artifact: ExtractionArtifact,
): boolean {
  switch (artifact) {
    case 'raw_text':
    case 'normalized_text':
    case 'negations':
    case 'strict_entities':
    case 'question_scaffolding':
    case 'student_shorthand':
    case 'term_filters':
    case 'requirement_context':
    case 'attributes':
    case 'instructors':
    case 'standalone_entities':
    case 'clean_residual':
      return Array.isArray(context.hints) && typeof context.residual === 'string';
  }
}
