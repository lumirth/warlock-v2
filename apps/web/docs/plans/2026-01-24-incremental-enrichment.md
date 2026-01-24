# Incremental Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch the enrichment process from a "Full Re-Sync" (which hits rate limits) to a "Randomized Incremental" approach that processes ~10 missing links per run, guaranteed to stay within Cloudflare Free Tier limits.

**Architecture:**
1.  **Coordinator:** Fetches *all* active courses and *all* existing links (2 reads). Computes `Missing = All - Existing`. Picks 10 random missing items.
2.  **Dispatch:** Dispatches a *single* batch of 10 items to the worker.
3.  **Worker:** Processes the 10 items. Crucially, records "No Match" results as `match_method='failed'` to prevent infinite re-processing of unmatchable instructors.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), TypeScript.

---

### Task 1: Implement Incremental Coordinator

**Files:**
- Modify: `apps/api/src/services/enrichment.ts`

**Step 1: Verify current state (Failing test concept)**
*Mental Check:* Currently `coordinateEnrichment` fetches ALL courses and dispatches ALL of them.
For 1000 courses with batch size 100 -> 10 batches.
Worker with 100 items -> 300 subrequests -> FAIL (Limit 50).
Coordinator with 10 batches -> 10 subrequests -> OK.
But we need to fix the Worker. Reducing Worker batch to 10 -> 100 batches from Coordinator -> FAIL (Limit 50).

**Step 2: Modify `coordinateEnrichment`**
Update the function to:
1.  Fetch `existingLinks` (Set of strings: `${subject}|${number}|${instructor}`).
2.  Filter `linkTasks` to only those NOT in `existingLinks`.
3.  Shuffle `linkTasks`.
4.  Take top 10.
5.  Dispatch ONE batch.

**Step 3: Modify `processEnrichmentBatch` for "No Match"**
Update the loop:
- If `match` is null, INSERT a record with `match_method = 'failed'` (and null IDs).
- This ensures we don't retry this instructor forever.

**Step 4: Commit**
```bash
git add apps/api/src/services/enrichment.ts
git commit -m "fix(api): switch enrichment to incremental strategy with failed match persistence"
```

---

### Task 2: Verify Fix

**Files:**
- Test: Manual verification via Debug Endpoint.

**Step 1: Reset Links (Optional/Partial)**
Delete a few links for a specific course (e.g., "CS 128") to force it to be "missing".
`DELETE FROM instructor_course_links WHERE subject='CS' AND number='128';`

**Step 2: Run Trigger**
Call `POST /admin/sync/enrich`.

**Step 3: Verify Logs**
Check that it says "Dispatched 1 batches".
Check that `CS 128` links reappear.

**Step 4: Verify "Failed" Persistence**
Insert a fake course with fake instructor "Ghost, Casper".
Run enrichment.
Verify `instructor_course_links` has a record for "Ghost, Casper" with `match_method='failed'`.

**Step 5: Commit**
(No code changes, just verification).
