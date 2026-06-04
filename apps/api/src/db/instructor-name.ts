export function normalizeInstructorFirstName(firstName: string | null | undefined): string {
  return firstName?.trim() ?? '';
}
