export function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

export function makeTermId(year: number, term: string): string {
  return `${year}-${term}`;
}

export function makeSectionId(termId: string, crn: string): string {
  return `${termId}-${crn}`;
}
