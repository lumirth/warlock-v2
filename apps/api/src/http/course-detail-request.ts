import type { CourseDetailRequest } from '../services/course-detail-types.js';
import {
  parseBoundedIntParam,
  parseCourseNumberParam,
  parseEnumParam,
  parseSubjectParam,
} from './params.js';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;

export type CourseDetailHttpRequestInput = {
  rawSubject: string;
  rawNumber: string;
  requestedYear?: string;
  requestedTerm?: string;
  cacheControl?: string | null;
  fresh?: string;
  maxYear?: number;
};

export type ParsedCourseDetailHttpRequest =
  | { ok: true; request: CourseDetailRequest }
  | { ok: false; status: 400; body: { error: string } };

export function parseCourseDetailHttpRequest(
  input: CourseDetailHttpRequestInput
): ParsedCourseDetailHttpRequest {
  const parsedSubject = parseSubjectParam(input.rawSubject);
  if (!parsedSubject.ok) return badRequest(parsedSubject.error);

  const parsedNumber = parseCourseNumberParam(input.rawNumber);
  if (!parsedNumber.ok) return badRequest(parsedNumber.error);

  if ((input.requestedYear && !input.requestedTerm) || (!input.requestedYear && input.requestedTerm)) {
    return badRequest('year and term must be provided together');
  }

  if (input.requestedYear) {
    const parsedYear = parseBoundedIntParam(input.requestedYear, 'year', {
      min: 2004,
      max: input.maxYear ?? new Date().getFullYear() + 2,
    });
    if (!parsedYear.ok) return badRequest(parsedYear.error);
  }

  if (input.requestedTerm) {
    const parsedTerm = parseEnumParam(input.requestedTerm, 'term', TERMS);
    if (!parsedTerm.ok) return badRequest(parsedTerm.error);
  }

  return {
    ok: true,
    request: {
      subject: parsedSubject.value,
      number: parsedNumber.value,
      requestedYear: input.requestedYear,
      requestedTerm: input.requestedTerm,
      bypassCache: Boolean(input.cacheControl?.includes('no-cache') || input.fresh === 'true'),
    },
  };
}

function badRequest(error: string): ParsedCourseDetailHttpRequest {
  return { ok: false, status: 400, body: { error } };
}
