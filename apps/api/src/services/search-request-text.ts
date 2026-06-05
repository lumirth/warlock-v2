const WEAK_RESIDUAL_TERMS = new Set([
  "a",
  "an",
  "and",
  "by",
  "class",
  "classes",
  "course",
  "courses",
  "find",
  "for",
  "in",
  "intro",
  "introduction",
  "of",
  "search",
  "the",
  "to",
]);

export function meaningfulResidualQuery(residual: string): string {
  const trimmedResidual = residual.trim();
  const meaningfulTokens = trimmedResidual
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token && !WEAK_RESIDUAL_TERMS.has(token));

  return meaningfulTokens.length > 0 ? trimmedResidual : "";
}
