import {
  SUBJECT_ALIASES,
  SUBJECT_NAMES,
  UNSAFE_LOWERCASE_SUBJECTS,
  VALID_SUBJECTS,
} from './data/valid-subjects.js';

export type SubjectAliasEntry = {
  subject: string;
  aliases: string[];
};

export function isKnownSubjectCode(value: string): boolean {
  return VALID_SUBJECTS.has(value.toUpperCase());
}

export function isSafeStandaloneSubjectToken(raw: string): boolean {
  const upper = raw.toUpperCase();
  if (!isKnownSubjectCode(upper)) return false;
  return raw === upper || !UNSAFE_LOWERCASE_SUBJECTS.has(upper);
}

export function subjectName(code: string): string | null {
  return SUBJECT_NAMES[code.toUpperCase()] ?? null;
}

export function subjectNames(): Readonly<Record<string, string>> {
  return SUBJECT_NAMES;
}

export function generatedSubjectAliases(): SubjectAliasEntry[] {
  return SUBJECT_ALIASES;
}
