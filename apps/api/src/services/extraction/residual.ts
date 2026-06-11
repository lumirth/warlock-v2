import { STOP_PHRASES } from '../student-language-lexicon.js';

const STOP_PHRASES_REGEX = new RegExp(`\\b(${STOP_PHRASES.join('|')})\\b`, 'gi');
const GENERIC_RESULT_NOUNS = /\b(?:sections?|class(?:es)?|courses?)\b/gi;

export function cleanResidual(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(STOP_PHRASES_REGEX, ' ')
    .replace(/^(?:sections?|classes?|courses?)\s+(?=(?:about|for|on)\b)/i, ' ')
    .replace(new RegExp(`${GENERIC_RESULT_NOUNS.source}\\s*$`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
