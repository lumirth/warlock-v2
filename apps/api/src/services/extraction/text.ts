import type { HintMetadata } from '../search-planner-types.js';

export type TextMatch = {
  index: number;
  length: number;
};

export function maskRange(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

export function maskMatches(text: string, matches: readonly TextMatch[]): string {
  let residual = text;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    residual = maskRange(residual, matches[index].index, matches[index].length);
  }
  return residual;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMetadata(
  source: 'regex' | 'alias' | 'nlp',
  raw: string,
  confidence: number,
): HintMetadata {
  return { source, confidence, raw };
}
