# Context-Aware Instructor Linking Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a "Cascading Match" system to accurately link ambiguous Course API instructors (e.g., "Zhang, J") to rich GPA and RMP data using the course context (e.g., "CS 101") as a blocking key.

**Architecture:**
1.  **Schema:** Create `instructor_course_links` to store pre-computed matches.
2.  **Matching Engine:** A lightweight cascading matcher (Bridge -> Target -> Store) running in the enrichment worker.
3.  **Runtime:** Update API routes to join against this link table for accurate stats.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), TypeScript.

---

### Task 1: Schema Migration

**Files:**
- Create: `apps/api/migrations/0005_instructor_links.sql`

**Step 1: Create Migration**

Create the link table schema. We use a composite primary key of the context fields to ensure one link per instructor-in-context.

```sql
-- apps/api/migrations/0005_instructor_links.sql
CREATE TABLE IF NOT EXISTS instructor_course_links (
    -- The Context (The "Key")
    term_id TEXT NOT NULL,          -- "2026-spring"
    subject TEXT NOT NULL,          -- "CS"
    number TEXT NOT NULL,           -- "173"
    instructor_name TEXT NOT NULL,  -- "Fleck, M" (From Course API)

    -- The Resolved Links (The "Value")
    gpa_id INTEGER,                 -- FK to gpa_stats.id
    rmp_id TEXT,                    -- FK to rmp_cache.rmp_id (which is TEXT)

    -- Metadata
    confidence_score REAL,          -- 0.0 to 1.0
    match_method TEXT,              -- "gpa_bridge", "direct_fuzzy", "manual"
    created_at INTEGER DEFAULT (unixepoch()),

    PRIMARY KEY (term_id, subject, number, instructor_name),
    FOREIGN KEY (gpa_id) REFERENCES gpa_stats(id),
    FOREIGN KEY (rmp_id) REFERENCES rmp_cache(rmp_id)
);

CREATE INDEX IF NOT EXISTS idx_links_context ON instructor_course_links(subject, number);
CREATE INDEX IF NOT EXISTS idx_links_rmp ON instructor_course_links(rmp_id);
```

**Step 2: Apply Migration**
Run: `npx wrangler d1 execute course-search-db --local --file=apps/api/migrations/0005_instructor_links.sql`

**Step 3: Verification**
Run: `npx wrangler d1 execute course-search-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='instructor_course_links'"`

### Task 2: Implement Matching Logic (The "Brain")

**Files:**
- Create: `apps/api/src/services/matcher.ts`
- Test: `apps/api/src/services/__tests__/matcher.test.ts`

**Step 1: Define Interfaces**

```typescript
// apps/api/src/services/matcher.ts
export interface MatchContext {
  termId: string;
  subject: string;
  number: string;
  instructorName: string; // "Zhang, J"
}

export interface MatchResult {
  gpaId: number | null;
  rmpId: string | null;
  confidence: number;
  method: 'gpa_bridge' | 'direct_fuzzy' | 'none';
}
```

**Step 2: Implement The Bridge (Step A)**

Write `matchUsingGpaBridge` function:
1.  Query `gpa_stats` for `subject`, `number`.
2.  Filter results where `gpa.instructor` matches `context.instructorName` (using simple "starts with" or parsed "Last, First").
3.  If unique match found, return the `gpa_stats` record (which has the Full Name).

**Step 3: Implement The Target Match (Step B)**

Write `matchRmpUsingFullName` function:
1.  Take the Full Name from GPA (e.g., "Zhang, Jing").
2.  Normalize to "First Last" (e.g., "Jing Zhang").
3.  Query `rmp_cache` for exact name match (or high-confidence fuzzy match if we add Jaro-Winkler later, but stick to exact/SQL-like for MVP).
4.  Optional: Verify department (fuzzy check).

**Step 4: Create the Main Resolve Function**

Export `resolveInstructor(db, context)` that orchestrates the cascade.

**Step 5: Test**
Create a test that mocks D1 and verifies the flow:
- Case 1: Perfect Bridge (Course API "Zhang, J" -> GPA "Zhang, Jing" -> RMP "Jing Zhang").
- Case 2: No Bridge (GPA missing).
- Case 3: Ambiguous Bridge (Multiple "Zhang"s in GPA for same course - should return safe fallback/none).

### Task 3: Integrate into Enrichment Process

**Files:**
- Modify: `apps/api/src/services/enrichment.ts`

**Step 1: Modify Enrichment Loop**

Instead of the current massive SQL update, refactor `enrichCoursesWithScoring`:
1.  Fetch active courses.
2.  Extract unique `(term, subject, number, instructor)` tuples.
3.  Iterate (in batches) and call `resolveInstructor` for each.
4.  Upsert results into `instructor_course_links`.

*Note: This replaces the old logic that tried to update `courses` table directly with scores. We will calculate scores at runtime or in a second pass.*

**Step 2: Verify**
Run the enrichment endpoint locally and check `instructor_course_links` population.

### Task 4: Update Runtime API (The "Read")

**Files:**
- Modify: `apps/api/src/routes/course.ts`

**Step 1: Update SQL Query**

In `GET /api/course/:subject/:number`, modify the SQL to JOIN with `instructor_course_links`.

```sql
SELECT
  s.instructor,
  l.rmp_id,
  r.rating as rmp_rating,
  l.gpa_id,
  g.avg_gpa
FROM sections s
LEFT JOIN instructor_course_links l
  ON l.term_id = ?
  AND l.subject = ?
  AND l.number = ?
  -- We need to handle the "; " separated string here or do this logic in code
  -- Easier: Fetch links for the course, then map them in TS
```

*Refinement:* Since `sections.instructor` is now a semi-colon list ("A; B"), SQL joining is hard.
**Better Approach:**
1.  Fetch course & sections.
2.  Fetch all links for this course: `SELECT * FROM instructor_course_links WHERE term_id=? AND subject=? AND number=?`.
3.  In TypeScript, for each section instructor name, look up the corresponding link stats.
4.  Return enriched section objects.

**Step 2: Update Response Shape**
Ensure the API response for `sections` includes the structured instructor data (Name + RMP Link + GPA Link) so the frontend can render it.

### Task 5: Frontend Updates (Verification)

**Files:**
- Modify: `apps/web/src/components/SectionsTable.tsx`

**Step 1: Update Display**
Use the new structured data to render RMP badges/links *per instructor* in the stacked display.

