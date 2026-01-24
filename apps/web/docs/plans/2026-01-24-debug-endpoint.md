# Instructor Matching Debug Endpoint Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a "Dry Run" endpoint to diagnose why the instructor linking logic is failing silently in production.

**Architecture:**
1.  **New Route:** `GET /admin/debug/link-instructor` in `apps/api/src/routes/debug.ts`.
2.  **Logic:** Manually fetch a course (`ALEC 115`), call `resolveInstructor`, and return the full trace (SQL params, raw D1 results) as JSON.
3.  **No Writes:** This endpoint will be read-only to be safe.

**Tech Stack:** Cloudflare Workers, TypeScript.

---

### Task 1: Create Debug Route

**Files:**
- Create: `apps/api/src/routes/debug.ts`
- Modify: `apps/api/src/index.ts` (to mount the route)

**Step 1: Implement Route**

```typescript
// apps/api/src/routes/debug.ts
import { Hono } from 'hono';
import { resolveInstructor } from '../services/matcher';

const debug = new Hono<{ Bindings: Env }>();

debug.get('/link-instructor', async (c) => {
  const subject = c.req.query('subject') || 'ALEC';
  const number = c.req.query('number') || '115';
  const term = c.req.query('term') || 'spring';
  const year = parseInt(c.req.query('year') || '2026');

  // 1. Fetch Course
  const course = await c.env.DB.prepare(`
    SELECT * FROM courses
    WHERE subject = ? AND number = ? AND year = ? AND term = ?
  `).bind(subject, number, year, term).first();

  if (!course) {
    return c.json({ error: 'Course not found', params: { subject, number, year, term } });
  }

  // 2. Fetch Raw Candidates (Debug View)
  const instructorPattern = `${course.primary_instructor.split(';')[0].trim()}%`;
  const rawCandidates = await c.env.DB.prepare(`
    SELECT * FROM gpa_stats
    WHERE subject = ? AND number = ? AND instructor LIKE ?
  `).bind(subject, number, instructorPattern).all();

  // 3. Run Logic
  const match = await resolveInstructor(c.env.DB, {
    subject,
    number,
    instructorName: course.primary_instructor.split(';')[0].trim()
  });

  return c.json({
    course,
    instructorPattern,
    rawCandidates: rawCandidates.results,
    matchResult: match
  });
});

export default debug;
```

**Step 2: Mount Route**
In `apps/api/src/index.ts`, add `app.route('/admin/debug', debug)`.

**Step 3: Deploy**
Run `npm run deploy`.

### Task 2: Verify and Fix (Iterative)

**Step 1: Test**
Curl the endpoint: `curl https://uiuc-course-search.lumirth.workers.dev/admin/debug/link-instructor?subject=ALEC&number=115`

**Step 2: Analyze**
If `rawCandidates` is empty, it's a data/query issue.
If `rawCandidates` has data but `matchResult` is null, it's logic.

