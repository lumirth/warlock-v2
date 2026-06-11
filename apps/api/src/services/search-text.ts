const SPECIAL_TOKENS: Record<string, string> = {
  "c/c++": "c cplusplus",
  "c++": "cplusplus",
  "c#": "csharp",
  ".net": "dotnet",
  "f#": "fsharp",
};

const SPECIAL_TOKEN_REGEX = new RegExp(
  Object.keys(SPECIAL_TOKENS)
    .sort((a, b) => b.length - a.length)
    .map(token => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`;
    })
    .join("|"),
  "gi",
);

const TITLE_LANE_BLOCK_WORDS = new Set([
  "after",
  "avoid",
  "before",
  "booster",
  "campus",
  "chill",
  "class",
  "classes",
  "count",
  "counts",
  "course",
  "courses",
  "does",
  "easy",
  "easiest",
  "evening",
  "friday",
  "gen",
  "gened",
  "gpa",
  "hard",
  "hardest",
  "how",
  "is",
  "less",
  "monday",
  "morning",
  "no",
  "not",
  "online",
  "prof",
  "professor",
  "requirement",
  "should",
  "tuesday",
  "urbana",
  "wednesday",
  "what",
  "whats",
  "with",
  "without",
]);

export function sanitizeFtsQuery(query: string): string {
  if (!query) return "";

  let sanitized = query.replace(SPECIAL_TOKEN_REGEX, (match) => {
    return SPECIAL_TOKENS[match.toLowerCase()] || match;
  });

  sanitized = sanitized.replace(/&/g, " and ");

  const quoteCount = (sanitized.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    sanitized = sanitized.replace(/"/g, " ");
  }

  sanitized = sanitized.replace(/['’]/g, " ");
  sanitized = sanitized.replace(/[^\w\s"]/g, " ");

  return sanitized.replace(/\s+/g, " ").trim();
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function titleLaneQuery(
  cleanKeywordQuery: string,
): string {
  const candidate = cleanKeywordQuery.replace(/"/g, "").toLowerCase().trim();
  if (!candidate || candidate.length > 80) return "";

  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return "";
  if (tokens.some(token => TITLE_LANE_BLOCK_WORDS.has(token))) return "";

  return candidate;
}
