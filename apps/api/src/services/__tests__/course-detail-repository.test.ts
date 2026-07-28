import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { CourseDetailRepository } from "../course-detail-repository.js";
import type { CourseDetailContext } from "../course-detail-types.js";

const context = {
  subject: "CS",
  number: "225",
  courseId: "CS-225-2026-spring",
  resolvedTerm: {
    termId: "2026-spring",
  },
} as CourseDetailContext;

describe("CourseDetailRepository", () => {
  it("does not expose expired RMP cache rows", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
      })),
      sql,
    }));
    const repository = new CourseDetailRepository(
      { prepare } as unknown as D1Database,
    );

    await repository.loadInstructorLinkRows(context);

    expect(prepare.mock.calls[0]?.[0]).toContain(
      "AND r.expires_at > unixepoch()",
    );
  });

  it("chunks meeting lookups below the D1 binding ceiling", async () => {
    const sections = Array.from({ length: 161 }, (_, index) => ({
      id: `section-${index}`,
      section_number: String(index).padStart(3, "0"),
      crn: String(10_000 + index),
    }));
    const meetingBindCounts: number[] = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        all: vi.fn(async () => {
          if (sql.includes("SELECT * FROM sections")) {
            return { results: sections };
          }
          meetingBindCounts.push(params.length);
          return { results: [] };
        }),
      })),
    }));
    const repository = new CourseDetailRepository(
      { prepare } as unknown as D1Database,
    );

    const result = await repository.loadSectionsWithDetails(context.courseId);

    expect(result).toHaveLength(161);
    expect(meetingBindCounts).toEqual([80, 80, 1]);
    expect(Math.max(...meetingBindCounts)).toBeLessThan(100);
  });
});
