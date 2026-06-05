import { STOP_PHRASES } from '../student-language-lexicon.js';

const STOP_PHRASES_REGEX = new RegExp(`\\b(${STOP_PHRASES.join('|')})\\b`, 'gi');

export function cleanResidual(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(STOP_PHRASES_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
