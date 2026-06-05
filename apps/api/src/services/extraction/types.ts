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
  artifactRevisions: Map<ExtractionArtifact, number>;
};

export type ExtractionPass = {
  id: string;
  reads: readonly ExtractionArtifact[];
  writes: readonly ExtractionArtifact[];
  run: (context: ExtractionContext) => void;
};

export function createExtractionContext(text: string): ExtractionContext {
  const initialArtifacts: ExtractionArtifact[] = ['raw_text', 'normalized_text'];
  return {
    hints: [],
    residual: text.replace(/\u2019/g, "'"),
    artifacts: new Set(initialArtifacts),
    artifactRevisions: new Map(initialArtifacts.map(artifact => [artifact, 1])),
  };
}

export function runExtractionPasses(
  context: ExtractionContext,
  passes: readonly ExtractionPass[],
): ExtractionResult {
  for (const pass of passes) {
    assertReadableArtifacts(context, pass);
    const revisionsBefore = new Map(context.artifactRevisions);
    pass.run(context);
    assertWritableArtifacts(context, pass, revisionsBefore);
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
  revisionsBefore: Map<ExtractionArtifact, number>,
): void {
  const missing = pass.writes.filter((artifact) => {
    const before = revisionsBefore.get(artifact) ?? 0;
    const after = context.artifactRevisions.get(artifact) ?? 0;
    return after <= before;
  });
  if (missing.length === 0) return;
  throw new Error(
    `Extraction pass "${pass.id}" declared missing writes: ${missing.join(', ')}`,
  );
}

export function recordExtractionArtifacts(
  context: ExtractionContext,
  ...artifacts: ExtractionArtifact[]
): void {
  for (const artifact of artifacts) {
    context.artifacts.add(artifact);
    context.artifactRevisions.set(
      artifact,
      (context.artifactRevisions.get(artifact) ?? 0) + 1,
    );
  }
}
