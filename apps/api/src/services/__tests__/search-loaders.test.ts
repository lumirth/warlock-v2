import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { fetchRegistrationSummariesByCourseId } from "../search-loaders.js";

describe("fetchRegistrationSummariesByCourseId", () => {
  it("normalizes raw statuses and A/C codes for hydrated courses only", async () => {
    const all = vi.fn(async () => ({
      results: [
        section("course-1", "Open", null, null, 200),
        section("course-1", null, "A", null, 190),
        section("course-1", null, null, "C", 195),
        section("course-1", "Wait List", null, null, 205),
        section("course-1", "Restricted", null, null, 198),
        section("course-1", "Cancelled", null, null, 201),
        section("course-1", "Mystery", null, null, 202),
      ],
    }));
    const bind = vi.fn((...params: unknown[]) => {
      expect(params).toEqual(["course-1", "course-2"]);
      return { all };
    });
    const db = {
      prepare: vi.fn((sql: string) => {
        expect(sql).toContain("FROM sections");
        expect(sql).toContain("WHERE course_id IN (?,?)");
        return { bind };
      }),
    } as unknown as D1Database;

    const summaries = await fetchRegistrationSummariesByCourseId(
      db,
      ["course-1", "course-2"],
    );

    expect(summaries.get("course-1")).toEqual({
      total: 7,
      open: 2,
      restricted: 1,
      waitlisted: 1,
      closed: 1,
      cancelled: 1,
      unknown: 1,
      lastSynced: 190,
    });
    expect(summaries.get("course-2")).toEqual({
      total: 0,
      open: 0,
      restricted: 0,
      waitlisted: 0,
      closed: 0,
      cancelled: 0,
      unknown: 0,
      lastSynced: null,
    });
  });

  it("reports unknown freshness if any included section lacks a timestamp", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({
            results: [
              section("course-1", "Open", null, null, 200),
              section("course-1", "Closed", null, null, null),
              section("course-1", "Open", null, null, 180),
            ],
          })),
        })),
      })),
    } as unknown as D1Database;

    const summaries = await fetchRegistrationSummariesByCourseId(
      db,
      ["course-1"],
    );

    expect(summaries.get("course-1")?.lastSynced).toBeNull();
  });
});

function section(
  courseId: string,
  status: string | null,
  statusCode: string | null,
  sectionStatusCode: string | null,
  lastSynced: number | null,
) {
  return {
    course_id: courseId,
    status,
    status_code: statusCode,
    section_status_code: sectionStatusCode,
    last_synced: lastSynced,
  };
}
