import { SUBJECT_ALIASES } from './data/valid-subjects.js';
import {
  GENED_CUES,
  STUDENT_LANGUAGE_ALIAS_ENTRIES,
} from './student-language-lexicon.js';

export type AliasKind = 'subject' | 'requirement' | 'delivery' | 'status' | 'workload' | 'days' | 'time';

export interface AliasEntry {
  kind: AliasKind;
  canonical: string;
  aliases: string[];
  requiresCue?: boolean;
}

export interface AliasMatch {
  kind: AliasKind;
  canonical: string;
  span: [number, number];
  confidence: number;
  raw: string;
}

const FUZZY_SUBJECT_CONFIDENCE = 0.72;

interface TokenSpan {
  text: string;
  start: number;
  end: number;
}

type AliasCandidate = AliasMatch & {
  length: number;
};

export class AliasRegistry {
  private entries: AliasEntry[] = [];

  add(entry: AliasEntry): void {
    this.entries.push(entry);
  }

  addAll(entries: AliasEntry[]): void {
    this.entries.push(...entries);
  }

  match(text: string): AliasMatch[] {
    const normalized = text.toLowerCase();
    const matches: AliasMatch[] = [];
    const consumed = new Set<number>(); // Track consumed character positions

    // Check for cues in the text
    const hasCue = GENED_CUES.some(cue => normalized.includes(cue));

    const candidates = this.findAliasCandidates(text, normalized, hasCue);

    for (const candidate of candidates) {
      if (isConsumed(candidate.span[0], candidate.span[1], consumed)) {
        continue;
      }

      matches.push({
        kind: candidate.kind,
        canonical: candidate.canonical,
        span: candidate.span,
        confidence: candidate.confidence,
        raw: candidate.raw,
      });

      for (let i = candidate.span[0]; i < candidate.span[1]; i++) {
        consumed.add(i);
      }
    }

    const sortedEntries = this.sortedEntries();
    const fuzzySubjectMatches = this.matchFuzzySubjects(text, sortedEntries, consumed);
    matches.push(...fuzzySubjectMatches);

    return matches;
  }

  private findAliasCandidates(text: string, normalized: string, hasCue: boolean): AliasCandidate[] {
    const candidates: AliasCandidate[] = [];

    for (const entry of this.sortedEntries()) {
      if (entry.requiresCue && !hasCue) {
        continue;
      }

      for (const alias of [...entry.aliases].sort((a, b) => b.length - a.length)) {
        const aliasLower = alias.toLowerCase();
        let searchStart = 0;

        while (true) {
          const index = normalized.indexOf(aliasLower, searchStart);
          if (index === -1) break;

          const end = index + aliasLower.length;
          if (hasWordBoundary(normalized, index, end)) {
            candidates.push({
              kind: entry.kind,
              canonical: entry.canonical,
              span: [index, end],
              confidence: 0.9,
              raw: text.slice(index, end),
              length: aliasLower.length,
            });
          }

          searchStart = index + 1;
        }
      }
    }

    return candidates.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      if (a.span[0] !== b.span[0]) return a.span[0] - b.span[0];
      return kindPriority(b.kind) - kindPriority(a.kind);
    });
  }

  private sortedEntries(): AliasEntry[] {
    return [...this.entries].sort((a, b) => {
      const aMax = Math.max(...a.aliases.map(al => al.length));
      const bMax = Math.max(...b.aliases.map(al => al.length));
      return bMax - aMax;
    });
  }

  private matchFuzzySubjects(text: string, sortedEntries: AliasEntry[], consumed: Set<number>): AliasMatch[] {
    const tokens = tokenize(text);
    if (tokens.length === 0) return [];

    const matches: AliasMatch[] = [];

    for (const entry of sortedEntries) {
      if (entry.kind !== 'subject') continue;

      for (const alias of entry.aliases.sort((a, b) => b.length - a.length)) {
        if (!shouldFuzzyMatchSubjectAlias(alias)) continue;

        const aliasLower = alias.toLowerCase();
        const aliasWords = aliasLower.split(/\s+/).filter(Boolean);
        if (aliasWords.length === 0 || aliasWords.length > tokens.length) continue;

        const maxDistance = maxFuzzySubjectDistance(aliasLower);
        for (let start = 0; start <= tokens.length - aliasWords.length; start++) {
          const spanTokens = tokens.slice(start, start + aliasWords.length);
          const spanStart = spanTokens[0].start;
          const spanEnd = spanTokens[spanTokens.length - 1].end;
          if (isConsumed(spanStart, spanEnd, consumed)) continue;

          const candidate = spanTokens.map(token => token.text).join(' ');
          const distance = boundedEditDistance(aliasLower, candidate, maxDistance);
          if (distance > maxDistance) continue;

          matches.push({
            kind: entry.kind,
            canonical: entry.canonical,
            span: [spanStart, spanEnd],
            confidence: distance === 0 ? 0.86 : FUZZY_SUBJECT_CONFIDENCE,
            raw: text.slice(spanStart, spanEnd),
          });

          for (let i = spanStart; i < spanEnd; i++) {
            consumed.add(i);
          }
        }
      }
    }

    return matches;
  }
}

function hasWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 || isBoundaryCharacter(text[start - 1]);
  const after = end === text.length || isBoundaryCharacter(text[end]);

  return before && after;
}

function isBoundaryCharacter(character: string): boolean {
  return !/[a-z0-9]/i.test(character);
}

function kindPriority(kind: AliasKind): number {
  if (kind === 'requirement') return 3;
  if (kind === 'subject') return 2;
  return 1;
}

function tokenize(text: string): TokenSpan[] {
  const tokens: TokenSpan[] = [];
  const regex = /[a-z0-9]+/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

function isConsumed(start: number, end: number, consumed: Set<number>): boolean {
  for (let i = start; i < end; i++) {
    if (consumed.has(i)) return true;
  }

  return false;
}

function shouldFuzzyMatchSubjectAlias(alias: string): boolean {
  const words = alias.split(/\s+/).filter(Boolean);
  const compactLength = words.join('').length;
  if (compactLength < 8) return false;

  return words.length > 1 || compactLength >= 8;
}

function maxFuzzySubjectDistance(alias: string): number {
  const compactLength = alias.replace(/\s+/g, '').length;
  return compactLength >= 18 ? 2 : 1;
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  const distances = Array.from(
    { length: left.length + 1 },
    () => new Array<number>(right.length + 1).fill(0)
  );

  for (let i = 0; i <= left.length; i += 1) {
    distances[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    distances[0][j] = j;
  }

  for (let i = 1; i <= left.length; i++) {
    let rowMin = distances[i][0];

    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        distances[i][j] = Math.min(distances[i][j], distances[i - 2][j - 2] + 1);
      }

      rowMin = Math.min(rowMin, distances[i][j]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
  }

  return distances[left.length][right.length];
}

export function createDefaultRegistry(): AliasRegistry {
  const registry = new AliasRegistry();

  registry.addAll(STUDENT_LANGUAGE_ALIAS_ENTRIES);

  // Official Course Explorer subject names plus conservative student shorthand.
  // This is generated with the subject list so broad queries like "Philosophy"
  // resolve as PHIL without maintaining a tiny hand-picked subset.
  registry.addAll(
    SUBJECT_ALIASES
      .filter(entry => entry.aliases.length > 0)
      .map(entry => ({
        kind: 'subject',
        canonical: entry.subject,
        aliases: entry.aliases,
      }))
  );

  return registry;
}
