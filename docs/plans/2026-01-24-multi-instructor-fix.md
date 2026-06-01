# Multi-Instructor Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable support for multiple instructors per course/section to fix search regressions ("Fleck"), improve data accuracy, and enable correct quality scoring.

**Architecture:**
1.  **Database:** Clean up duplicate instructors and enforce uniqueness to ensure reliable linking.
2.  **Sync/Transform:** Update transformation logic to aggregate *all* instructors into the `primary_instructor` field (for search/embeddings) and properly link them in the relational tables.
3.  **API:** Expose full instructor lists per section in the API response.
4.  **Frontend:** Render multiple instructors in the sections table.

**Tech Stack:** Cloudflare D1 (SQLite), TypeScript, React, Cloudflare Workers.

---

### Task 1: Database Integrity & cleanup

**Files:**
- Create: `apps/api/migrations/0004_dedup_instructors.sql`

**Step 1: Create Migration**

Create a migration that:
1.  Drops `meeting_instructors` data (safe to rebuild from sync).
2.  Drops `instructors` data (safe to rebuild from sync).
3.  Creates a `UNIQUE INDEX` on `instructors(last_name, first_name)`.

```sql
-- apps/api/migrations/0004_dedup_instructors.sql
DELETE FROM meeting_instructors;
DELETE FROM instructors;
DROP INDEX IF EXISTS idx_instructors_search;
CREATE UNIQUE INDEX idx_instructors_name ON instructors(last_name, first_name);
```

**Step 2: Apply Migration**
Run: `npx wrangler d1 execute course-search-db --local --file=apps/api/migrations/0004_dedup_instructors.sql`
(And remote if we were deploying, but we focus on local first).

### Task 2: Update Transforms for Multi-Instructor Search

**Files:**
- Modify: `apps/api/src/transforms/course.ts`

**Step 1: Update `fromSubjectCascade`**

Update the logic that populates `course.primary_instructor` and `section.instructor`.
Instead of taking `instructors[0]`, collect *all* unique instructors for the course/section and join them with `; ` (semicolon + space).

```typescript
// apps/api/src/transforms/course.ts

// Helper to format multiple instructors
function formatInstructors(instructors: any[]): string | null {
  if (!instructors || instructors.length === 0) return null;
  const names = instructors.map(i => formatInstructorName(i)).filter(Boolean);
  return [...new Set(names)].join('; ');
}

// In fromSubjectCascade:
// For course.primary_instructor: Collect all instructors from all meetings of all sections
// For section.instructor: Collect all instructors from all meetings of this section
```

**Step 2: Test Transform**
Create a test case with a multi-instructor course (e.g., matching the XML structure of a co-taught course) and verify `primary_instructor` contains both names.

### Task 3: API Response Update

**Files:**
- Modify: `apps/api/src/routes/course.ts`

**Step 1: Fetch Instructors in `getCourse`**

In the `GET /api/course/:subject/:number` handler:
When fetching from DB (`else` block for cache hit):
1.  Fetch sections as before.
2.  Fetch all `meeting_instructors` + `instructors` for these sections.
    ```sql
    SELECT mi.meeting_id, i.first_name, i.last_name, i.rmp_rating
    FROM meeting_instructors mi
    JOIN instructors i ON mi.instructor_id = i.id
    WHERE mi.meeting_id IN (SELECT id FROM meetings WHERE section_crn IN (...))
    ```
    *Wait, `meetings` table needs to be queried too to link section -> meeting -> instructor.*

    Actually, simpler approach for now:
    The `sections` table has `instructor` column. Since we updated Transform in Task 2, `sections.instructor` will now contain "Fleck, M; Evans, G".
    This is sufficient for the *Table View* if we just want to show names.

    BUT if we want individual RMP links, we need structured data.

    *Decision:* For this iteration, let's rely on the updated `sections.instructor` text field which will now be multi-value string. This solves the "Fleck" search issue immediately because FTS indexes this column.

    If we need structured data for the frontend (to render individual badges), we should parse this string or do the join.
    Let's stick to the text field update first. It's high impact, low complexity.

### Task 4: Frontend Display

**Files:**
- Modify: `apps/web/src/components/SectionsTable.tsx`

**Step 1: Update Rendering**

The frontend currently renders `{section.instructor}`.
If `section.instructor` is "Fleck, M; Evans, G", it will render that string.
We might want to split it by `;` and render them on separate lines or as badges.

```tsx
// apps/web/src/components/SectionsTable.tsx
const names = section.instructor?.split('; ') || [];
// Render map of names
```

### Task 5: Re-Sync and Verification

**Step 1: Trigger Sync**
Run the sync process (or manually trigger via `curl` to local worker) to re-populate the truncated tables.

**Step 2: Verify Data**
Check D1:
`SELECT * FROM instructors` (Should have no duplicates)
`SELECT primary_instructor FROM courses WHERE subject='CS' AND number='173'` (Should show multiple names)

**Step 3: Verify Search**
Search for "Evans" (secondary instructor) and verify CS 173 appears.

