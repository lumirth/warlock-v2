import type { Course } from "../../db/types.js";

export function titleMatchScore(
  title: string | null | undefined,
  query: string,
): number {
  const queryLower = normalizedPhrase(query);
  if (!queryLower || !title) return 0;

  const titleLower = normalizedPhrase(title);
  if (titleLower === queryLower) return 2.5;
  if (titleLower.includes(queryLower)) return 1.2;
  if (queryLower.includes(titleLower)) return 0.45;
  return 0;
}

export function normalizedTitle(title: string | null | undefined): string {
  return title?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

export function courseText(
  course: Course,
  fields: Array<"subject" | "title" | "description" | "course_info">,
): string {
  return fields
    .map(field => course[field] ?? "")
    .join(" ")
    .toLowerCase();
}

export function catalogLevel(number: string | null | undefined): number | null {
  const match = /^([1-5])/.exec(number ?? "");
  return match ? Number.parseInt(match[1], 10) * 100 : null;
}

export function parseCourseNumberForSort(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return null;

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedPhrase(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}
