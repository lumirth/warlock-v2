# Design: Fan-Out RMP Sync Architecture

## Problem
Synchronizing ~5,000 professor records from RateMyProfessor (RMP) to Cloudflare D1 presents challenges:
1.  **Execution Time**: Processing 5,000 records (hashing, upserting) in a single worker can exceed CPU limits.
2.  **Memory**: Holding 5,000 objects in memory is risky on 128MB workers.
3.  **Latency**: RMP cursors are opaque; we cannot fetch Page 2 without Page 1's cursor, preventing true parallel fetching.

## Solution: Serial Fetch, Fan-Out Write
We will implement a hybrid approach where a "Coordinator" fetches data page-by-page (serially) but dispatches the *writing* of that data to parallel workers.

### Architecture

1.  **Coordinator (Cron Trigger)**
    *   Runs on schedule (e.g., Weekly).
    *   **Loop**:
        1.  Fetches 1,000 records from RMP GraphQL (takes ~200ms).
        2.  Dispatches a **Batch Worker** (via Service Binding `SELF`) with the payload of 1,000 records.
        3.  Gets the `endCursor` for the next page.
        4.  Repeats until `hasNextPage` is false.
    *   **Benefit**: The coordinator is lightweight. It spends most of its time waiting for network (cheap), not burning CPU.

2.  **Batch Worker (`/internal/sync-rmp-batch`)**
    *   Receives 1,000 raw teacher objects.
    *   **Chunking**: Splits the 1,000 records into chunks of 10 (due to D1's 100-parameter binding limit).
    *   **Upsert**: Performs `INSERT OR REPLACE` into `rmp_cache`.
    *   **Propagation**: Updates `instructors` and `courses` tables for these specific professors.
    *   **Async Processing (Critical)**: Uses `ctx.waitUntil` to handle the database operations in the background, returning a 202 response immediately. This prevents the Coordinator from waiting.
    *   **Benefit**: Heavy database I/O is distributed across ~5 parallel worker invocations (1 per page).

### Schema Changes
No new schema changes needed. We utilize the existing `rmp_cache` table.

### Implementation Plan

#### 1. Refactor `services/rmp-sync.ts`
Break the monolithic `syncRateMyProfessorData` into:
*   `fetchRmpPage(cursor: string | null): Promise<RmpPageResult>`
*   `processRmpBatch(db: D1Database, teachers: RmpTeacherNode[]): Promise<void>`

#### 2. Create Internal Endpoint
*   `POST /internal/sync-rmp-batch`: Accepts JSON `{ teachers: [] }`. Calls `processRmpBatch`.

#### 3. Update Cron Handler (`index.ts`)
*   Add a new schedule or hook into an existing one to run the Coordinator logic.

## Benchmarks & Constraints
*   **RMP API**: ~200ms for 1,000 records. Total fetch time for 5,000 records: ~1 second.
*   **D1 Limits**: Max 100 parameters per query.
    *   A single row insert needs ~8 params (`name`, `id`, `rating`, etc.).
    *   Batch size: 10 rows per `INSERT`.
    *   1,000 records = 100 SQL statements.
    *   D1 supports `.batch()` to execute array of statements efficiently.

## Resiliency
*   **Failures**: If a Batch Worker fails, only that page is lost. The Coordinator logs the error but continues to the next page.
*   **Retries**: The Coordinator can optionally retry a failed dispatch.
