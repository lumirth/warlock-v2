export const COURSE_EXPLORER_BASE_URL = "https://courses.illinois.edu";
export const RATE_MY_PROFESSORS_BASE_URL = "https://www.ratemyprofessors.com";
export const UIUC_RMP_SCHOOL_ID = "1112";

export type CourseExplorerUrlInput = {
  year: number;
  term: string;
  subject: string;
  number: string;
};

export function buildCourseExplorerCourseUrl(
  input: CourseExplorerUrlInput,
): string {
  const year = String(input.year);
  const term = input.term.toLowerCase();
  const subject = input.subject.toUpperCase();
  const number = input.number;

  return `${COURSE_EXPLORER_BASE_URL}/schedule/${encodeURIComponent(year)}/${encodeURIComponent(term)}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`;
}

export function buildCourseExplorerSectionUrl(
  input: CourseExplorerUrlInput & { crn: string },
): string {
  return buildCourseExplorerCourseUrl(input);
}

export function buildRmpProfessorUrl(
  rmpId: string | null | undefined,
): string | null {
  if (!rmpId || !/^[0-9]+$/.test(rmpId)) {
    return null;
  }

  return `${RATE_MY_PROFESSORS_BASE_URL}/professor/${encodeURIComponent(rmpId)}`;
}

export function buildRmpSearchUrl(
  instructorName: string | null | undefined,
): string | null {
  const normalized = instructorName?.trim();
  if (!normalized) {
    return null;
  }

  return `${RATE_MY_PROFESSORS_BASE_URL}/search/professors/${UIUC_RMP_SCHOOL_ID}?q=${encodeURIComponent(normalized)}`;
}
