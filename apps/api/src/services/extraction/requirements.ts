import type { Hint } from '../search-planner-types.js';
import {
  CONTEXTUAL_REQUIREMENT_RULES,
  STUDENT_SHORTHAND_RULES,
} from '../student-language-lexicon.js';
import {
  createMetadata,
  maskMatches,
  type TextMatch,
} from './text.js';

export function extractStudentShorthand(text: string, hints: Hint[]): string {
  let residual = text;

  for (const rule of STUDENT_SHORTHAND_RULES) {
    const matches: Array<TextMatch & { raw: string }> = [];
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = pattern.exec(residual)) !== null) {
      hints.push({
        type: 'subject',
        value: rule.subject,
        metadata: createMetadata('alias', match[0], rule.confidence),
      });
      matches.push({ index: match.index, length: match[0].length, raw: match[0] });
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      const item = matches[i];
      residual =
        residual.slice(0, item.index) +
        rule.expansion.padEnd(item.length, ' ') +
        residual.slice(item.index + item.length);
    }
  }

  return residual;
}

export function extractContextualRequirements(text: string, hints: Hint[]): string {
  let residual = text;

  for (const rule of CONTEXTUAL_REQUIREMENT_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const matches: TextMatch[] = [];
    let match;
    while ((match = pattern.exec(residual)) !== null) {
      if (rule.code === 'NAT' && isProtectedScienceSubjectPhrase(residual, match.index, match[0].length)) {
        continue;
      }

      hints.push({
        type: 'requirement',
        value: rule.code,
        metadata: createMetadata('nlp', match[0], rule.confidence),
      });
      matches.push({ index: match.index, length: match[0].length });
    }

    residual = maskMatches(residual, matches);
  }

  return residual;
}

function isProtectedScienceSubjectPhrase(text: string, start: number, length: number): boolean {
  const window = text
    .slice(Math.max(0, start - 16), Math.min(text.length, start + length + 16))
    .toLowerCase();

  return /\b(?:computer|political|data|information|materials?|library|crop|animal|food)\s+science\b/.test(window);
}
