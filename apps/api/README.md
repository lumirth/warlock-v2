# UIUC Course Search API

This is the backend for the UIUC Course Search engine, built as a Cloudflare Worker using Hono.

## Data Sync Architecture

The API implements a sophisticated synchronization system to ingest course data from the UIUC CISAPI.

### Fan-Out Sync Architecture
To stay within Cloudflare Worker resource limits (subrequests, memory, and CPU time), the sync process uses a fan-out pattern:

1.  **Coordinator (Cron Triggers):** A scheduled task runs every 3 minutes.
2.  **Subject Discovery:** The coordinator fetches the master list of subjects for all active terms.
3.  **Batch Dispatch:** Subjects are divided into batches of **40 subjects** each.
4.  **Parallel Execution:** The coordinator dispatches these batches via **Service Bindings** (`env.SELF.fetch`) to internal worker endpoints.
5.  **Subject Cascade:** Each batch worker fetches and parses the "cascade" XML for its assigned subjects, performing upserts into the D1 database and generating embeddings for Vectorize.

### Auto-Discovery Mechanism
The system automatically discovers new academic terms to sync:

*   **Twice-Daily Discovery:** A cron job runs daily at 4:00 AM & 4:00 PM CST (10:00 & 22:00 UTC).
*   **Term Classification:** New terms are probed for "enrollmentStatus". If sections have real statuses (not "UNKNOWN"), the term is marked as `active` and added to the 3-minute sync rotation.
*   **Historical Archive:** Terms with no active enrollment are marked as `historical` and kept in the database for reference but synced less frequently.

## Key Services

*   `services/parallel-sync.ts`: Core logic for fetching and parsing CISAPI data.
*   `services/term-discovery.ts`: Logic for finding and classifying new terms.
*   `services/embeddings.ts`: Manages vector embedding generation and storage.

## Configuration

Settings are managed in `wrangler.toml`:
*   `SYNC_INTERVAL_MS`: Duration between sync attempts.
*   `SYNC_CONCURRENCY`: Number of subjects to process in parallel within a single batch worker.
*   `TERM_CHECK_INTERVAL_MS`: Frequency of term status re-classification.
