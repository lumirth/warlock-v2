# Pre-Alpha Remediation Master Plan

Date: 2026-06-01

This document turns the project audit into an implementation-ready remediation plan. It is written for a follow-up agent whose goal is to proceed until every item here is wholly addressed.

The project is pre-alpha, pre-production, and greenfield. Prefer simple, direct, high-quality fixes over compatibility layers, shims, flags, or incremental half-measures. If old data, old migrations, or old APIs make the system harder to reason about, remove or replace them after confirming they are not needed for the current product surface.

## Operating Principles

1. Keep the current product small and coherent.
   The intended product is a UIUC course search app with a web UI, a Cloudflare Worker API, D1 storage, and search/enrichment jobs. Anything outside that path should be deleted, gated, or moved to explicit development tooling.

2. Prefer one canonical source of truth.
   One schema baseline, one migration location, one API DTO package, one test command, one build path. Do not keep parallel definitions unless they are mechanically generated from the same source.

3. Prefer breaking cleanup over compatibility.
   Since this is greenfield, do not preserve old migration shapes, deprecated endpoints, legacy parser paths, or unused scripts just because they exist. Delete or rewrite them when a clean replacement is better.

4. Prove issues before fixing where the proof is cheap.
   Each item below includes a "How to verify" section. Run those checks first. If verification contradicts the audit, document the finding in the final remediation notes and either close the item or replace it with the real issue.

5. Escape hatches are allowed only when they reduce risk.
   An escape hatch is acceptable when an external service is unavailable, a platform limit blocks local validation, or the project owner must make a product decision. It is not acceptable when the work is merely tedious.

6. Every completed item must leave a test or automated check behind.
   For security/config items this can be route tests or script checks. For search behavior this should be unit plus integration coverage. For schema, it should include a clean local database bootstrapped from the canonical schema.

## Search Contract Reference

Use `docs/plans/2026-06-01-search-contract-v1.md` as the provisional organizing contract for the search product while working through this plan. It encodes the current best understanding of what the app is trying to be: a low-friction UIUC course search engine that answers ordinary student search intent across natural language, structured constraints, soft preferences, and UIUC-specific course concepts.

That contract is extrapolated from established project patterns, not handed down as an infallible spec. An implementation agent should question, refine, or replace parts of it when user evidence, source data, UI behavior, or platform constraints show that the contract is wrong. The expected behavior is deliberate revision with notes and tests, not quiet drift.

## Final Definition Of Done

The remediation effort is complete only when all of the following are true:

- Root `npm run typecheck` succeeds.
- Root `npm test` succeeds in a normal local unauthenticated development environment.
- Root `npm run build` succeeds without rewriting tracked generated files unexpectedly.
- There is a CI workflow that runs typecheck, tests, build, and a bounded eval or smoke test.
- The app can be bootstrapped from a clean local database using one canonical schema or migration flow.
- Public HTTP routes are intentionally classified as public, admin, internal, or dev-only.
- Admin/internal/dev-only routes are not publicly callable without authorization.
- The frontend and backend share explicit DTOs for current API responses.
- Search query features exposed to users are either implemented end to end or removed from parser/UI/docs.
- The provisional search contract in `docs/plans/2026-06-01-search-contract-v1.md` has either been implemented and covered by evals, or deliberately revised with evidence and matching tests.
- A short final remediation report lists any deferred items, and each deferred item has owner approval.

## Suggested Work Order

1. Secure or remove unsafe routes.
2. Establish canonical schema and clean local bootstrapping.
3. Fix sync/storage identity and atomicity risks.
4. Simplify and complete the search contract.
5. Stabilize frontend/API DTOs.
6. Make tooling, tests, CI, and eval trustworthy.
7. Remove large generated artifacts and stale docs.

Do not start broad UI polish before the security, schema, and tooling foundations are addressed.

---

# 1. Public Admin, Internal, And Debug Routes

## Problem

The Worker mounts admin and internal mutation endpoints without an authorization boundary:

- `app.route('/', syncRoutes)` in `apps/api/src/index.ts`
- `app.route('/', adminRoutes)` in `apps/api/src/index.ts`
- `app.route('/admin/debug', debugRoutes)` in `apps/api/src/index.ts`
- `/admin/*` routes in `apps/api/src/routes/sync.ts` and `apps/api/src/routes/debug.ts`
- `/internal/*` routes in `apps/api/src/routes/sync.ts`

These routes can trigger expensive external fetches, D1 writes, Vectorize writes, GPA resets, RMP sync, enrichment batches, rate-limiter resets, and internal fan-out.

## Why This Matters

Even pre-production apps often get deployed for demos. If these routes are public, any caller can spend compute, mutate data, reset sync state, or make the service unstable. This is the highest priority blocker before any public deployment.

## How To Verify

1. Run the Worker locally.
2. Try unauthenticated requests:
   - `curl -i -X POST http://localhost:8787/admin/sync-gpa`
   - `curl -i -X POST http://localhost:8787/admin/reset-rate-limiter`
   - `curl -i -X POST http://localhost:8787/internal/enrich-batch -H 'content-type: application/json' -d '{"tasks":[...]}'`
3. If these return anything other than `401`, `403`, or `404`, the issue is real.
4. Also inspect production, if deployed:
   - `curl -i https://<worker-host>/admin/terms`
   - Do not trigger destructive routes against remote without user approval.

## Preferred Fix

Create explicit route groups and an auth middleware:

- Public:
  - `/`
  - `/health`
  - `/api/search`
  - `/api/course/:subject/:number`
- Admin:
  - `/admin/*`
- Internal service-binding only:
  - `/internal/*`
- Dev-only:
  - `/debug/*` or remove entirely

Implementation shape:

1. Add `ADMIN_TOKEN` as a Worker secret/binding.
2. Add middleware such as `requireAdminAuth`:
   - Reads `Authorization: Bearer <token>`.
   - Uses a timing-safe comparison if available.
   - Returns `401` or `403` without running route logic.
3. Apply it to all `/admin/*`.
4. Add `requireInternalAuth` for `/internal/*`.
   - Preferred: pass an internal shared secret from coordinator to service-binding request, using an env secret such as `INTERNAL_TOKEN`.
   - Also accept Cloudflare service binding context only if there is a reliable platform signal. If not, use the token.
5. In production, remove or protect debug routes. For greenfield, deletion is better than leaving a public debug tool.

## Alternative Fixes

- If the app is not deployed and the owner wants zero admin surface, delete all HTTP admin/debug endpoints and trigger jobs only from scheduled handlers or local scripts.
- If local development needs easy access, allow a development bypass only when `ENVIRONMENT === "development"` or `c.env.ADMIN_TOKEN` is absent in local mode. This must never apply in production.

## Escape Hatch

If Cloudflare local testing makes secret binding awkward, implement the middleware and unit-test it with Hono route tests first. Do not skip the middleware. The only acceptable deferral is remote deployment verification, and only if credentials are unavailable.

## Definition Of Done

- Unauthenticated `/admin/*` returns `401` or `403`.
- Unauthenticated `/internal/*` returns `401`, `403`, or `404`.
- Debug fetch route is deleted or admin-protected.
- Route tests cover authorized and unauthorized access.
- README or API docs list the route classes.

---

# 2. User-Controlled Debug Fetch And SSRF Risk

## Problem

`apps/api/src/routes/debug.ts` exposes `/admin/debug/fetch?url=...`, fetches the provided URL, and returns headers plus a body snippet.

## Why This Matters

This is a classic server-side request forgery risk. It can probe internal networks, fetch metadata endpoints, or expose private responses. Even if Cloudflare Workers have a constrained network model, it is still dangerous and unnecessary for the product.

## How To Verify

1. Look for `debugRoutes.get('/fetch'`.
2. Run locally and call:
   - `curl 'http://localhost:8787/admin/debug/fetch?url=https://example.com'`
3. If the Worker fetches arbitrary URLs from a client-controlled param, the issue is real.

## Preferred Fix

Delete this route.

If a fetch diagnostic is still needed, replace it with a local-only script under `scripts/` that developers run from their own machine, not through the deployed Worker.

## Alternative Fix

If the route must remain temporarily:

- Require admin auth.
- Allowlist exact hosts, for example `courses.illinois.edu`.
- Reject private IPs, localhost, non-HTTPS URLs, redirects to disallowed hosts, and overly large bodies.
- Return only metadata needed for debugging.

## Escape Hatch

Do not leave the route public. If allowlisting proves tricky, delete the route and create a CLI script.

## Definition Of Done

- No public route accepts arbitrary URLs for server-side fetches.
- Tests confirm `/admin/debug/fetch` is gone or protected and allowlisted.

---

# 3. CORS, Public Input Bounds, And Workload Controls

## Problem

The API uses broad CORS on `/api/*` and accepts search/sync params with little validation:

- `origin: '*'` in `apps/api/src/index.ts`
- `/api/search` parses `limit` and `credits` without bounds or `NaN` handling
- admin sync routes parse `offset`, `limit`, `year`, and `term` without strict validation

## Why This Matters

CORS alone is not an auth boundary, but open CORS plus unbounded params makes abuse easier from browsers. Bad inputs can cause runtime errors, unexpectedly large queries, or expensive work.

## How To Verify

1. Try malformed search requests:
   - `/api/search?q=cs&limit=-1`
   - `/api/search?q=cs&limit=999999`
   - `/api/search?q=cs&credits=abc`
2. Inspect route behavior and logs.
3. Try admin sync params after admin auth is implemented:
   - `/admin/sync/abc/nope?limit=999999`

## Preferred Fix

Add small validation helpers. Keep them boring and explicit:

- `parseBoundedInt(value, { min, max, defaultValue })`
- `parseEnum(value, allowedValues)`
- `parseSubject(value)` with uppercase and subject-code format
- `parseCourseNumber(value)` with catalog number rules

Apply:

- Search limit: default `20`, min `1`, max `50` or `100`.
- Search credits: integer `0` to `8` or a UIUC-appropriate bound.
- Sync batch limit: low hard cap, for example `1` to `40`.
- Offset: non-negative integer.
- Term: one of `winter`, `spring`, `summer`, `fall`.
- Year: reasonable bounded range, for example `2004` to current year plus 2.

CORS:

- Keep public CORS only for public `/api/*` read routes.
- Do not apply CORS broadly to admin/internal routes.
- If the frontend has a known production origin, prefer allowlisting that origin in production.

## Alternative Fix

Use a schema validation library if the project already has one. Do not add a heavy dependency just for a few simple params unless it will also validate DTOs across the API.

## Escape Hatch

If exact UIUC credit/year bounds are unclear, use conservative broad bounds and leave a comment explaining the choice. Do not leave params unbounded.

## Definition Of Done

- Malformed public params return `400` with a useful error.
- Expensive params are capped.
- Admin/internal routes do not receive browser-open CORS by default.
- Tests cover invalid and boundary inputs.

---

# 4. Global Rate Limiter Is Not A Real Public Rate Limit

## Problem

`apps/api/src/services/rate-limiter.ts` implements a process-local singleton backoff. It is used primarily to avoid hammering upstream data sources, not to limit public callers.

## Why This Matters

One isolate-level global limiter can cause one caller or one upstream error to affect all users. It also does not protect the public API from request floods.

## How To Verify

1. Inspect `globalRateLimiter` in `rate-limiter.ts`.
2. Confirm it is not keyed per IP, user, route, or API token.
3. Confirm public `/api/search` has no request throttle.

## Preferred Fix

Split two concerns:

1. Upstream backoff:
   - Rename existing limiter to `UpstreamBackoff`.
   - Scope it to the upstream it protects, for example CISAPI or RMP.
   - Do not present it as public abuse protection.

2. Public request limiting:
   - Use Cloudflare WAF/rate limiting if available for deployment.
   - Or implement a lightweight KV/Durable Object keyed by IP or a coarse client key for public read endpoints.
   - Admin endpoints should rely primarily on auth, with optional rate limits as defense in depth.

## Alternative Fix

For pre-alpha local-only development, document that public rate limiting is provided by deployment config and add a production checklist item. This is acceptable only if routes are auth-protected and deployment docs include exact Cloudflare settings.

## Escape Hatch

Do not build a complex in-app distributed rate limiter if the app will use Cloudflare's native controls. But do rename and document the existing limiter so future readers do not mistake it for public protection.

## Definition Of Done

- Existing limiter is named and documented as upstream backoff.
- Public abuse protection strategy is implemented or explicitly configured in deployment docs.
- Admin/internal routes are auth-protected regardless of rate limiting.

---

# 5. Canonical Schema Drift

## Problem

The app has multiple schema/migration locations and the base schema does not match runtime code:

- `sync_state` code expects `cursor` and `etag`; base `schema.sql` does not include them.
- `instructor_course_links` is queried and written but not in base `schema.sql`.
- `search_logs` is written by the logger but not in base `schema.sql`.
- Some migrations live under root `migrations/`; others under `apps/api/migrations/`.

## Why This Matters

A clean database cannot be reliably created from the repo. Runtime behavior depends on which migrations happened to be applied. This is a foundational issue for every other backend fix.

## How To Verify

1. Create a clean local D1 database from the current documented schema/migration flow.
2. Run:
   - `SELECT * FROM sync_state LIMIT 1`
   - `PRAGMA table_info(sync_state)`
   - `SELECT name FROM sqlite_master WHERE name='instructor_course_links'`
   - `SELECT name FROM sqlite_master WHERE name='search_logs'`
3. Run the API tests or hit `/api/course/...` paths that read `instructor_course_links`.
4. If a clean database lacks columns/tables the code uses, the issue is real.

## Preferred Fix

Because this is greenfield, create one clean canonical database story:

1. Pick one migration directory. Prefer `apps/api/migrations` because it sits next to `wrangler.toml`, unless Wrangler config or team convention clearly favors root `migrations/`.
2. Replace fragmented migrations with a fresh baseline migration, for example `0001_initial_schema.sql`.
3. Make `apps/api/src/db/schema.sql` either:
   - the exact same SQL as the baseline, or
   - a generated artifact from migrations, or
   - deleted if unused.
4. Include all currently required objects:
   - courses
   - subjects
   - subject_aliases
   - instructors with correct uniqueness/indexes
   - sections with corrected identity
   - meetings
   - meeting_instructors
   - course_gened
   - gpa_stats
   - rmp_cache
   - instructor_course_links
   - sync_state with `cursor` and `etag` if still used
   - term_state
   - search_logs if logging remains
   - FTS virtual tables and triggers
5. Add a `schema_version` or `app_meta` table.
6. Add a startup/admin health check that reports missing schema version or missing tables.

## Alternative Fix

If the team wants migration history preserved, keep old migrations but squash them into a new baseline for local bootstrap. Since this is pre-alpha, prefer the simpler squash unless the user explicitly asks to preserve remote D1 migration history.

## Escape Hatch

Remote D1 reset or destructive migration requires user approval if there is any chance the remote has data the user wants. Local schema cleanup does not need an escape hatch.

## Definition Of Done

- One documented command creates a clean local DB with all required objects.
- Runtime code no longer references missing tables/columns.
- Migrations and `schema.sql` cannot drift silently.
- Tests or a script verify required schema objects.

---

# 6. Instructor Uniqueness And Upsert Contract

## Problem

`prepareUpsertInstructor` uses `ON CONFLICT(last_name, first_name)`, but the base schema creates only a non-unique index for `(last_name, first_name)`.

## Why This Matters

SQLite requires a unique or primary-key constraint for that conflict target. Without it, batch sync can fail.

## How To Verify

1. Create a clean DB from schema.
2. Run an insert using the same `ON CONFLICT(last_name, first_name)` statement.
3. Or run the sync path with a subject that has instructors.
4. If SQLite reports a conflict-clause error, the issue is real.

## Preferred Fix

Choose the actual domain model:

- If instructor identity is "name within UIUC source data", make `(last_name, first_name)` unique.
- If duplicate names must be allowed, do not upsert by name. Use a canonical key such as a source instructor ID if available, or store name-only rows without `ON CONFLICT` and resolve duplicates at the context-link layer.

Given the current code and greenfield status, the simplest likely fix is:

1. Make instructor names unique in the canonical schema.
2. Normalize null/empty first names consistently.
3. Update comments in `db/index.ts` to match reality.
4. Add tests proving duplicate upserts update one row.

## Alternative Fix

If investigation shows UIUC has frequent duplicate instructor names and no stable source ID, keep duplicates allowed and remove the name-conflict upsert. In that case, context-specific linking via `instructor_course_links` becomes the authoritative join.

## Escape Hatch

Do not keep contradictory schema and code. Pick one model. If uncertain, run a duplicate-name analysis against the current data dump before deciding.

## Definition Of Done

- Schema and upsert SQL agree.
- Comments no longer contradict the schema.
- Sync path can insert/update instructors on a clean DB.
- Unit/integration test covers duplicate instructor upsert behavior.

---

# 7. Section Identity Is Globally Keyed By CRN

## Problem

`sections.crn` is the primary key, and meetings reference `section_crn`. CRNs may repeat across terms. If they do, sections from different terms can overwrite or merge.

## Why This Matters

The app stores historical and active data. A globally keyed CRN is too weak for a multi-term course database.

## How To Verify

1. Query the current historical data for repeated CRNs across terms:
   - Count distinct `(year, term, crn)` versus distinct `crn`.
2. Inspect source files or generated CSVs if available.
3. If any CRN appears in more than one term, the issue is confirmed.
4. Even if current data has no duplicates, the model is fragile unless the source guarantees global uniqueness forever.

## Preferred Fix

Use a term-scoped section ID.

Recommended greenfield shape:

- `sections.id TEXT PRIMARY KEY`
- `sections.crn TEXT NOT NULL`
- `sections.course_id TEXT NOT NULL`
- `sections.term_id TEXT NOT NULL`
- `UNIQUE(term_id, crn)`

Possible `id` format:

- `${term_id}-${crn}`
- or `${course_id}-${crn}` if CRN uniqueness is only meaningful within course and term

Then update:

- `meetings.section_id` instead of `section_crn`
- `meeting_instructors` joins
- `prepareUpsertSection`
- `prepareUpsertMeeting`
- course detail queries
- FTS trigger content

## Alternative Fix

Use composite primary keys if D1/SQLite ergonomics are acceptable. A text surrogate `section.id` is usually simpler for TypeScript and foreign keys.

## Escape Hatch

If a quick data analysis proves CRNs are globally unique across all UIUC terms and official docs confirm it, document that proof and keep the current model. Without official or data proof, fix the model.

## Definition Of Done

- Section identity includes term context.
- No child table references bare CRN as the primary section identity.
- Clean DB sync works.
- Query for duplicate CRNs across terms cannot corrupt rows.

---

# 8. Live Sync Is Not Atomic And Does Not Prune Ghost Data

## Problem

Subject sync deletes GenEd rows before later batched writes. If any later batch fails, data can be partially updated. Also, courses/sections removed from source are never pruned.

## Why This Matters

Search quality depends on data correctness. Partial syncs and ghost sections make status, time, instructor, and availability filters unreliable.

## How To Verify

1. Read `saveSubjectData` in `parallel-sync.ts`.
2. Force a failure after `deleteCourseGeneds` and before `genedStatements` execute.
3. Check whether previous GenEds are lost.
4. Compare a source subject snapshot with DB rows after a course/section is removed from source.

## Preferred Fix

Use a staging and diff-apply model:

1. Fetch and parse one subject-term snapshot.
2. Write parsed data into staging tables or in-memory sets.
3. In one transaction-equivalent unit:
   - Upsert current courses/sections/meetings/geneds/instructors.
   - Delete rows for that subject-term that are absent from the latest source snapshot.
   - Update a sync batch status row.
4. If D1 transaction support is limited for the full unit, make operations idempotent and order them so destructive deletes happen last.

For greenfield simplicity, prefer:

- No pre-delete per course.
- Upsert current geneds with a snapshot marker.
- After successful current writes, delete geneds for the course not in the current set.

## Alternative Fix

If staging tables are too much for the first pass, at minimum:

- Move destructive deletes to after successful inserts.
- Add `source_seen_at` or `sync_run_id`.
- Prune old rows after a full subject-term sync succeeds.

## Escape Hatch

Do not attempt a perfect distributed transaction if Cloudflare D1 makes it awkward. But do eliminate destructive-before-constructive writes and add a deterministic cleanup path.

## Definition Of Done

- A failed sync cannot erase previously good GenEd data.
- Removed sections/courses can be pruned after successful sync.
- Sync state records success/failure per subject-term.
- Tests simulate mid-sync failure and stale-row cleanup.

---

# 9. Course Detail Parser Contract And Silent Field Loss

## Problem

The `/api/course/:subject/:number` fresh path parses CISAPI XML and writes the parsed result into DB. The parser has default/stub fields for important details such as degree attributes, date ranges, and notes.

## Why This Matters

Fetching a course detail page can overwrite richer DB fields with null or incomplete data. Since this endpoint is user-facing, browsing can mutate storage in a lossy way.

## How To Verify

1. Fetch known CISAPI XML manually for a course with notes, date ranges, degree attributes, or special sections.
2. Parse it with the current parser.
3. Compare parsed output to source XML.
4. Hit `/api/course/...` and inspect DB before and after.
5. If fields are dropped or nulled, the issue is real.

## Preferred Fix

Choose one parser for course detail and subject cascade. Avoid a legacy regex parser if a streaming XML parser is already used elsewhere.

Recommended path:

1. Replace the course detail parser with the same structured parser used for subject cascade, or create a shared parser adapter.
2. Add fixture XML tests for:
   - multiple instructors
   - multiple meetings
   - section notes
   - part of term
   - date ranges
   - degree attributes
   - GenEd attributes
3. Do not write fields to DB when parser confidence/completeness is below threshold.

## Alternative Fix

If live course detail should not mutate DB, make the endpoint read-only:

- Return live parsed data to the user.
- Do not upsert into canonical tables from this path.
- Let scheduled sync be the only writer.

This is often simpler and safer.

## Escape Hatch

If parser completeness cannot be solved quickly, disable DB writes from the fresh course endpoint and document that scheduled sync owns persistence.

## Definition Of Done

- Course detail fetch no longer loses fields.
- Parser tests cover rich XML fixtures.
- The endpoint's write behavior is explicit: either safe upsert or read-only live fetch.

---

# 10. Freshness, Current Term, And Sync State Policy

## Problem

Freshness is a mix of a 30-second course cache, static `CURRENT_YEAR`/`CURRENT_TERM`, term discovery, and partial term-state updates. There is no clear policy for "how fresh is this result" or which term is current/registrable.

## Why This Matters

Students care about current sections and statuses. Search and course pages should make stale or historical data explicit.

## How To Verify

1. Inspect `wrangler.toml` static `CURRENT_YEAR` and `CURRENT_TERM`.
2. Inspect `term_state` after cron/fan-out sync.
3. Hit `/api/search` and `/api/course` and see whether responses include source age, term status, or data version.
4. Check what happens when no active term exists.

## Preferred Fix

Make term and freshness state data-driven:

1. Add a small term-selection service:
   - `getDefaultTerm(db)` returns active/registrable term from `term_state`.
   - Static env vars are fallback only for local/dev bootstrap.
2. Add sync metadata:
   - `sync_run_id`
   - `source_fetched_at`
   - `last_successful_sync_at`
   - `row_counts`
   - `status`
3. Include freshness metadata in API responses:
   - course detail: `_source_age_seconds`, `_term_status`
   - search meta: active term used, fallback/historical state
4. Define stale windows:
   - Course schedule status: short window
   - Historical catalog data: long window
   - GPA/RMP: longer cache acceptable

## Alternative Fix

For pre-alpha, at least centralize default term resolution and return `_cached`, `_age_seconds`, and term status consistently.

## Escape Hatch

Do not build a complex freshness system before the schema is stable. A simple term service plus visible metadata is enough for the first pass.

## Definition Of Done

- Course/search defaults come from term state when available.
- Static env term is not the hidden primary source of truth.
- API response metadata tells clients whether data is cached, stale, active, or historical.

---

# 11. RMP Sync Credentials And Checkpointing

## Problem

RMP sync uses a hardcoded public-looking Basic token and stores pagination cursor only in memory.

## Why This Matters

Hardcoded credentials are hard to rotate and inappropriate for source control. In-memory cursor means sync cannot resume safely after failure.

## How To Verify

1. Inspect `apps/api/src/services/rmp-sync.ts`.
2. Confirm `RMP_AUTH_TOKEN` is hardcoded.
3. Interrupt a sync and check whether the next run resumes or restarts.

## Preferred Fix

1. Move credentials to Worker secret or env binding.
2. Add `rmp_sync_state` or use generalized `sync_state` with:
   - cursor
   - page count
   - last successful page
   - status
   - updated_at
3. Make each page/batch idempotent.
4. Add retry/backoff and stop conditions.

## Alternative Fix

If RMP integration is not essential for pre-alpha, remove RMP sync from scheduled/admin flows and keep only a disabled local script. Simpler is acceptable if product does not need RMP yet.

## Escape Hatch

If RMP access terms or auth are unclear, pause production RMP integration and document the blocker. Do not keep hardcoded token-based production sync.

## Definition Of Done

- No RMP auth token in source.
- RMP sync can resume or is explicitly disabled.
- Tests cover token missing/error behavior.

---

# 12. Contextual Enrichment Processes Only Random Tiny Slices

## Problem

`coordinateEnrichment` shuffles missing tasks and processes only a slice of 10. Coverage depends on repeated runs and can starve some contexts.

## Why This Matters

Instructor GPA/RMP matching will be incomplete and non-deterministic. A user may see inconsistent enrichment quality.

## How To Verify

1. Count missing enrichment tasks.
2. Run coordinator once.
3. Confirm only 10 are dispatched.
4. Run repeatedly and observe random order.

## Preferred Fix

Use deterministic cursor batching:

1. Store enrichment progress in D1 or `sync_state`.
2. Order tasks deterministically, for example by `term_id, subject, number, instructor_name`.
3. Dispatch as many batches as the platform can safely handle.
4. Persist progress after each successful batch.
5. Retry failed tasks with status and error fields.

## Alternative Fix

If enrichment volume is small, process all missing tasks synchronously in admin/local mode with a strict cap and progress logging.

## Escape Hatch

If Worker limits block full processing, use a local script or Cloudflare Queues. Do not keep random starvation as the steady state.

## Definition Of Done

- Enrichment eventually processes every missing task deterministically.
- Failed tasks are visible and retryable.
- Progress is persisted.

---

# 13. Historical Sync Script Is Broken And Untyped

## Problem

`scripts/historical-sync.ts` calls `parseSubjectCascadeXml` with a string, while the parser expects a stream with `.getReader()`. Scripts are excluded from the API TypeScript project, so this can pass unnoticed.

## Why This Matters

Historical data is a major part of this app's value. Broken sync scripts undermine reproducibility and make schema changes risky.

## How To Verify

1. Run script typechecking or execute a small dry run.
2. Confirm parser input type mismatch.
3. Add scripts to a TypeScript check and observe failures.

## Preferred Fix

1. Add a parser adapter:
   - `parseSubjectCascadeXmlFromString(xml: string)`
   - internally converts to `ReadableStream`
2. Update script to use the adapter.
3. Add `tsconfig.scripts.json` or include scripts in root typecheck.
4. Add a dry-run script mode that processes one subject/term fixture.

## Alternative Fix

If historical sync is no longer needed, delete the script and remove historical data generation docs. Since the repo has large historical artifacts, deletion should include a replacement data bootstrap story.

## Escape Hatch

Do not leave the script broken and documented as usable. Either fix it or remove it from the active workflow.

## Definition Of Done

- Script typechecks.
- Script has a dry-run mode.
- Parser input type is correct.
- Docs reflect the real workflow.

---

# 14. Search Query Language Has Inert Features

## Problem

`parseQuery` extracts phrases, dash-negations, and arbitrary `field:value` filters, but `SearchPipeline` only applies a subset: `subject`, `gened`, `credits`, `level`, and `crn`. Extracted `term` and `levelBoost` hints are also not meaningfully applied.

## Why This Matters

Users and tests can believe a query feature works when it is silently ignored. This is worse than not supporting the feature.

## How To Verify

1. Run full pipeline tests for:
   - `status:open CS`
   - `online:true CS`
   - `days:MWF`
   - `time:morning`
   - `-morning`
   - `"data structures"`
   - `spring 2026`
   - `intro spanish`
2. Compare `meta.plan.filters` and final SQL behavior.
3. If parsed fields do not affect results, the issue is real.

## Preferred Fix

Use `docs/plans/2026-06-01-search-contract-v1.md` as the starting definition of the search contract and Query Language v1, then implement only the parts that remain after deliberate refinement.

The contract is provisional. If implementation reveals that a proposed intent, filter, ranking behavior, or result-shape requirement is wrong for the product, revise the contract directly, explain the evidence, and update tests/evals to match. Do not silently implement a different contract in code.

Recommended v1:

- Natural language:
  - course code
  - subject
  - instructor
  - GenEd
  - credits
  - level
  - days
  - time
  - online/in-person
  - status
  - difficulty
  - part of term
- Power syntax:
  - `subject:CS`
  - `gened:HUM`
  - `credits:3`
  - `level:400`
  - `crn:12345`
  - `status:open`
  - `online:true`
  - `days:MWF`
  - `time:morning`
  - `term:2026-spring` or `term:spring-2026`

For each supported feature:

1. Parser extracts it.
2. Resolver validates it.
3. `SearchFilters` represents it.
4. `buildFilterClauses` implements it.
5. Search meta returns it.
6. Tests cover it.

Remove or stop parsing unsupported features.

## Alternative Fix

If power syntax is not needed yet, delete most of it and support natural language only. Simpler is better than fake syntax.

## Escape Hatch

Phrase search can be deferred if FTS phrase semantics are tricky, but then quoted phrases must remain in residual text and docs/tests must not claim phrase filtering.

## Definition Of Done

- No parser feature is silently dropped.
- Query Language v1 is documented.
- Tests cover each supported field from input through final plan.

---

# 15. Negation Semantics Are Row-Level Instead Of Course-Level

## Problem

Negated time/day filters join `meetings` and add row predicates like `m.days != ?`. A course with multiple meetings can pass because one meeting does not match the forbidden condition even if another meeting does.

## Why This Matters

Queries like "no morning" or "not Friday" should exclude courses/sections with forbidden meetings. Current logic can return false positives.

## How To Verify

1. Build a test fixture:
   - Course A has one morning meeting and one afternoon meeting.
   - Query `no morning`.
2. If Course A appears, the issue is confirmed.

## Preferred Fix

Use anti-joins or `NOT EXISTS` at the course level:

```sql
NOT EXISTS (
  SELECT 1
  FROM sections s2
  JOIN meetings m2 ON m2.section_id = s2.id
  WHERE s2.course_id = c.id
    AND m2.start_time < ?
)
```

For section-specific search, decide whether results are course-level or section-level:

- If returning courses, exclude any course that has violating sections.
- If returning sections later, filter at section level and show only matching sections.

## Alternative Fix

If negation is not needed for v1, remove negation parsing and docs until it can be implemented correctly.

## Escape Hatch

Do not leave known-wrong negation behavior active. Either correct it or remove it from supported query features.

## Definition Of Done

- Multi-meeting fixture proves negation excludes correctly.
- `-morning` and `no morning` semantics are consistent if both are supported.

---

# 16. Search Fallback Can Relax Hard Constraints Too Quietly

## Problem

Tier 4 fallback removes constraints such as level or GenEd when strict search has few results. This can return results that violate what the user may consider hard filters.

## Why This Matters

For "graduate algorithms", returning 200-level courses may be surprising unless clearly labeled as relaxed suggestions.

## How To Verify

1. Run queries with hard constraints:
   - `graduate algorithms`
   - `gened:HUM quantum`
   - `subject:CS gened:HUM`
2. Inspect whether results violate filters and how the UI presents them.

## Preferred Fix

Separate exact matches from relaxed suggestions:

Response shape:

- `results`: only results satisfying hard constraints.
- `suggestions` or `relaxedResults`: results from relaxed constraints.
- `meta.fallback.constraintsRelaxed`: explicit.

Frontend:

- Show exact matches first.
- Show relaxed suggestions under a separate heading.
- Never mix relaxed results into the same list without visible labeling.

## Alternative Fix

Disable hard-constraint relaxation entirely for v1. This is simpler and often preferable.

## Escape Hatch

If product owner prefers broad discovery, keep relaxation only for soft hints like topic expansion, not explicit field filters.

## Definition Of Done

- Explicit filters are not silently violated in primary results.
- Relaxed results, if present, are separately represented and tested.

---

# 17. Search Ranking N+1 Query

## Problem

Hybrid scoring fetches `quality_score` one course at a time inside a loop.

## Why This Matters

This creates avoidable D1 queries and latency. It is not the highest risk, but it is easy cleanup once search behavior is stable.

## How To Verify

1. Instrument D1 prepare calls during search.
2. Search a query returning many candidates.
3. Confirm one `SELECT quality_score` per candidate.

## Preferred Fix

Fetch quality scores in one query:

1. Collect candidate IDs.
2. `SELECT id, quality_score FROM courses WHERE id IN (...)`
3. Build a map.
4. Score in memory.

## Alternative Fix

If candidate count is always tiny after caps, lower priority. Still leave a test or note.

## Escape Hatch

Can be deferred until after correctness and security. Do not optimize before fixing query semantics.

## Definition Of Done

- Search scoring uses one batched query for quality scores.
- Test or instrumentation verifies no per-candidate DB query loop.

---

# 18. Frontend Search Async Race And Stale Results

## Problem

`SearchPage` stores the active `AbortController` in a shared ref. Starting a new search overwrites the ref; an older request's `finally` can affect loading state. New searches also clear `meta` but not old `results`, so errors can leave stale results on screen.

## Why This Matters

Search UI can mislead users by showing results for the wrong query or hiding active loading.

## How To Verify

1. Add artificial delay to `/api/search` or mock `api.search`.
2. Start query A, then query B quickly.
3. Make A resolve/reject after B starts.
4. Observe loading/results/error state.

## Preferred Fix

Use a request token or capture-local controller:

1. Increment `requestIdRef.current`.
2. Capture `requestId` in `handleSearch`.
3. Clear `results`, `meta`, and `error` at start.
4. Only set results/error/loading if captured ID is still latest.
5. Abort previous request on new request.

## Alternative Fix

Use a query library such as TanStack Query only if the project wants that dependency. For this app, a small local request token is simpler.

## Escape Hatch

No escape hatch needed. This is a small direct fix.

## Definition Of Done

- Stale requests cannot update visible state.
- New failed searches do not show old results as current.
- Component test covers out-of-order responses.

---

# 19. CoursePage Does Not Refetch On Term Or Year Change

## Problem

`CoursePage` reads `term` and `year` from query params but the `useEffect` dependency array only includes `subject` and `number`.

## Why This Matters

Navigating between terms for the same course can show stale course details.

## How To Verify

1. Open `/course/CS/225?term=fall&year=2026`.
2. Navigate to `/course/CS/225?term=spring&year=2026`.
3. Check whether a new API request fires.

## Preferred Fix

Add `term` and `year` to dependencies. Also guard against stale async updates using the same request-token pattern as search.

## Alternative Fix

Use route loader/query library if the app adopts one. Current app does not need it.

## Escape Hatch

No escape hatch needed.

## Definition Of Done

- Course page fetches again when subject, number, term, or year changes.
- Test covers query-param-only navigation.

---

# 20. API DTO Drift Between Backend And Frontend

## Problem

Frontend defines API types separately from backend DB and response shapes. Fresh course responses omit fields like `quality_score` and `difficulty_score` even though frontend normalizes them.

## Why This Matters

Silent response drift creates UI bugs and makes refactors risky.

## How To Verify

1. Compare `apps/web/src/lib/api-types.ts` to actual JSON from:
   - `/api/search`
   - `/api/course/:subject/:number` cached path
   - `/api/course/:subject/:number` fresh path
2. Check for fields present in one path but missing in another.

## Preferred Fix

Create shared API DTOs in `packages/query-types` or rename the package to `packages/shared` if it now owns more than query types.

Define:

- `CourseSummaryDto`
- `CourseDetailDto`
- `SectionDto`
- `InstructorLinkDto`
- `SearchResponseDto`
- `SearchMetaDto`
- `ApiErrorDto`

Backend route handlers should construct DTOs explicitly. Frontend should import DTOs from the shared package.

Fresh and cached course paths must return the same DTO shape, with explicit `null` for unavailable values.

## Alternative Fix

If sharing package types causes bundling friction, generate frontend types from backend DTO source. Do not maintain independent hand-written shapes.

## Escape Hatch

Do not wait for a full OpenAPI setup. Shared TypeScript DTOs are enough for pre-alpha.

## Definition Of Done

- Frontend no longer defines independent API response types.
- Fresh and cached course detail paths return the same shape.
- Typecheck catches DTO drift.
- Tests assert representative response JSON shapes.

---

# 21. Course Table UI Clips On Small Screens

## Problem

The sections table is inside a Paper with `overflow: hidden`. Wide rows can clip on small screens.

## Why This Matters

Course detail is a core workflow. Section tables need to be readable on mobile.

## How To Verify

1. Run web app.
2. Open course page at mobile viewport width.
3. Inspect section table columns and long instructor names.

## Preferred Fix

Wrap the table in Mantine `ScrollArea` or a simple horizontal overflow container:

- Keep table semantics.
- Allow horizontal scroll.
- Avoid nested decorative cards.
- Remove temporary debug text from the bottom unless behind dev mode.

## Alternative Fix

Create responsive section cards for mobile only. This is more work but can be better UX later.

## Escape Hatch

For pre-alpha, horizontal scroll is acceptable. Do not leave clipped content.

## Definition Of Done

- Mobile viewport shows all table content via scroll or responsive layout.
- Visual check or Playwright screenshot confirms no clipping.

---

# 22. Root Typecheck And Build Scripts Are Broken

## Problem

Root `npm run typecheck` and `npm run build` run across all workspaces. `packages/query-types` has no `typecheck` or `build` script.

## Why This Matters

The root commands should be the source of truth for verification and CI.

## How To Verify

Run:

- `npm run typecheck`
- `npm run build`

If either fails because a workspace lacks scripts, the issue is real.

## Preferred Fix

Make every workspace satisfy the root contract:

In `packages/query-types/package.json`:

- Add `typecheck`: likely `tsc --noEmit` with a package tsconfig.
- Add `build`: either `tsc --emitDeclarationOnly` or a no-output check if package ships source intentionally.

Better:

- Give `query-types` its own `tsconfig.json`.
- Decide whether it emits JS/d.ts or is source-imported by workspaces.

## Alternative Fix

Change root scripts to target only workspaces with matching scripts. This hides drift. Prefer adding scripts.

## Escape Hatch

No escape hatch needed.

## Definition Of Done

- Root typecheck passes.
- Root build passes.
- Shared package has explicit scripts.

---

# 23. API Tests Require Remote Wrangler Auth

## Problem

Vitest uses Cloudflare Workers pool and attempts to start a remote proxy session, failing without Wrangler login.

## Why This Matters

Tests must run in a normal local development and CI environment. Requiring remote auth makes the test suite brittle and discourages frequent testing.

## How To Verify

Run `npm test` without Wrangler auth. If it fails before collecting tests, the issue is real.

## Preferred Fix

Split tests into layers:

1. Pure unit tests:
   - parser
   - extractor
   - resolver with mocked DB
   - filter SQL builders
   - DTO builders
   - route auth middleware
   Run in normal Vitest Node environment.

2. Worker integration tests:
   - Hono app request tests
   - D1 local/miniflare tests
   - optional Vectorize/AI mocks
   Must run local-only by default.

3. Remote smoke tests:
   - Separate script requiring credentials.
   - Not part of default `npm test`.

## Alternative Fix

If Cloudflare pool supports a local mode flag, configure it. Verify it actually works in unauthenticated environments.

## Escape Hatch

Remote tests may remain as an optional script, for example `test:remote`. Default `npm test` must not require auth.

## Definition Of Done

- `npm test` passes without Wrangler login.
- Remote/platform smoke tests are separate and clearly named.
- CI can run default tests.

---

# 24. No CI, No Lint, No Web Tests, Weak Eval Signal

## Problem

There is no `.github/workflows` directory, no lint script, web tests are placeholders, and the eval runner can record all fetch failures while exiting successfully.

## Why This Matters

The project has many moving parts. Without automation, regressions will accumulate quickly.

## How To Verify

Run:

- `find .github -maxdepth 3 -type f`
- `npm run lint`
- `npm test -w @uiuc-course-search/web`
- `npm run eval -w @uiuc-course-search/api`

## Preferred Fix

1. Add linting:
   - ESLint for TypeScript/React.
   - Keep rules practical, not stylistically noisy.
2. Add web tests:
   - Search async behavior.
   - CoursePage term/year refetch.
   - SectionsTable rendering.
3. Fix eval runner:
   - Non-zero exit if endpoint unreachable.
   - Assert expected filters and residuals, not only invariants.
   - Configurable base URL.
   - Output summary JSON or Markdown.
4. Add GitHub Actions:
   - install
   - typecheck
   - lint
   - test
   - build
   - optional eval smoke with local server

## Alternative Fix

If GitHub Actions is not the intended CI, add the equivalent for the chosen CI. Do not leave no CI.

## Escape Hatch

Coverage thresholds can wait until tests are stable. CI cannot wait.

## Definition Of Done

- CI exists and runs on PR/push.
- Lint script exists.
- Web tests do meaningful assertions.
- Eval fails loudly on unreachable API or broken expectations.

---

# 25. Build Rewrites Generated Subject Data And Depends On Network

## Problem

Root `build` runs `generate:subjects`, which first attempts remote D1 via Wrangler and then external CISAPI fallback. This can rewrite `valid-subjects.ts`, require network/auth, and create noisy diffs.

## Why This Matters

Builds should be deterministic. Generated source files should not churn just because a developer built locally.

## How To Verify

1. Run `npm run build`.
2. Check `git diff apps/api/src/services/data/valid-subjects.ts`.
3. Try building offline or without Wrangler auth.

## Preferred Fix

Separate generation from build:

- `npm run generate:subjects` remains manual or CI-scheduled.
- `npm run build` does not fetch network data by default.
- Generated file includes stable sorted data but not a changing timestamp, or timestamp is omitted.
- Add `npm run check:generated` to verify committed generated data is current when needed.

## Alternative Fix

Replace generated subject list with runtime DB/cache lookup if performance allows. Since extractor needs a fast local set, committed generated data is fine.

## Escape Hatch

If build absolutely must regenerate, make it deterministic and offline by using committed fixture data. Do not fetch remote services in default build.

## Definition Of Done

- Build does not require network/auth for subject generation.
- Build does not rewrite tracked files unexpectedly.
- Subject update workflow is explicit.

---

# 26. Large Historical Artifacts And Data Ownership

## Problem

The workspace contains huge historical data artifacts (`full_history.sql`, `history_chunks`) and some appear tracked despite ignore rules. The history folder is multiple gigabytes locally.

## Why This Matters

Large generated data in source control slows clones, makes diffs noisy, and blurs the boundary between source code and data artifacts.

## How To Verify

Run:

- `du -sh full_history.sql history_chunks`
- `git ls-files full_history.sql 'history_chunks/*'`
- `git check-ignore -v full_history.sql history_chunks`

If large artifacts are tracked or required for normal development, the issue is real.

## Preferred Fix

Decide data ownership:

1. Source repo should contain:
   - scripts
   - small fixtures
   - schema
   - sample data enough for tests
2. Large historical data should live in:
   - object storage
   - release artifact
   - separate data repo
   - documented download/bootstrap command

For greenfield, remove tracked large generated artifacts from git history going forward. If history rewrite is acceptable, use a proper history cleanup tool with owner approval.

## Alternative Fix

If data must remain nearby for now, keep it ignored and untracked, and add a script that downloads or regenerates it.

## Escape Hatch

Do not rewrite git history without explicit user approval. But do stop adding new generated dumps.

## Definition Of Done

- Normal clone/build/test does not require multi-GB generated data.
- Large artifacts are untracked or intentionally managed outside the code repo.
- Docs explain how to obtain test/dev data.

---

# 27. Documentation And Roadmap Drift

## Problem

Docs and plans contain implemented ideas, stale implementation snippets, and instructions aimed at earlier agents. Some plans say features should exist that now partially exist or exist differently.

## Why This Matters

The next agent may follow stale docs and add compatibility layers or duplicate systems.

## How To Verify

1. Compare docs under `docs/plans`, `docs/analysis`, `apps/api/README.md`, and `CLAUDE.md` with current code.
2. Identify docs that describe no-longer-current migration directories, route behavior, or architecture.

## Preferred Fix

After remediation:

1. Keep a short `README.md` for setup and commands.
2. Keep one architecture document.
3. Archive old plans under `docs/archive/` or delete them if misleading.
4. Update `CLAUDE.md` with real commands and current architecture.

## Alternative Fix

If old plans are useful context, clearly mark them as historical and not implementation instructions.

## Escape Hatch

Do docs cleanup after code fixes, not before. But do not leave docs contradicting the final system.

## Definition Of Done

- Active docs match current commands, schema, routes, and architecture.
- Old plans are archived or clearly marked historical.

---

# 28. Query Logging, Debug Logs, And Sensitive Data

## Problem

Search logging writes raw queries, hints, filters, residuals, result IDs, and timing to `search_logs`. Separately, search code logs raw queries, cleaned queries, SQL, and params with `console.log`. The schema for `search_logs` may be missing, so logging failures can be swallowed while still adding noise.

## Why This Matters

Student search queries can contain names, schedule preferences, or other personal intent. Logs should be intentional, minimal, and reliable. Debug SQL logs should not be present in normal production paths.

## How To Verify

1. Search for logging statements:
   - `rg -n "console\\.log|console\\.warn|console\\.error|logSearch|search_logs" apps/api/src`
2. Run a search locally and inspect Worker logs.
3. Check whether raw user query text and SQL params are printed.
4. Confirm whether `search_logs` exists in a clean database.

## Preferred Fix

Create a small logging policy:

1. Remove noisy `console.log` statements from normal search execution.
2. Keep structured errors and high-level timing logs only where useful.
3. If search analytics are needed:
   - Ensure `search_logs` is in canonical schema.
   - Keep sampling explicit.
   - Store the minimum useful fields.
   - Consider hashing or truncating raw query text.
   - Never log auth tokens, request headers, or arbitrary debug fetch bodies.
4. Gate verbose debug logs behind an explicit development flag.

## Alternative Fix

For pre-alpha simplicity, remove database query logging entirely and keep only local console diagnostics in development mode.

## Escape Hatch

If product analytics are undecided, remove logging for now. It is easier to add a clean analytics model later than to maintain a leaky half-model.

## Definition Of Done

- Normal production search does not print raw SQL or params.
- Search logging is either removed or backed by canonical schema.
- Logging policy is documented.
- Tests or config checks ensure debug logging is not enabled by default in production.

---

# 29. Scheduler, Fan-Out, And Resource Budgets

## Problem

Cron handlers dispatch many internal batch requests across active terms. Admin endpoints can duplicate this work. Internal batch endpoints accept client-provided payloads. There is no obvious job lock, idempotency key, global budget, or persisted run state that prevents overlapping syncs.

## Why This Matters

Fan-out is useful, but uncontrolled fan-out can create unstable writes, exceed Cloudflare limits, hammer upstream data sources, and make failures hard to reason about.

## How To Verify

1. Inspect scheduled handler in `apps/api/src/index.ts`.
2. Count active terms and expected subject batches.
3. Trigger sync twice locally or in a staging DB and inspect overlapping writes.
4. Confirm whether `sync_state` records a running job, run ID, batch status, and completion.

## Preferred Fix

Use explicit job state:

1. Add a `sync_runs` table or expand `sync_state` cleanly.
2. Give every run a `run_id`.
3. Before dispatching, acquire a job lock for `(job_type, term_id)`.
4. Bound:
   - active runs
   - batches per run
   - subjects per batch
   - retry count
5. Make every batch idempotent with `(run_id, term_id, subject)` state.
6. Release lock only on success, failure, or timeout.
7. Expose status through an authenticated admin route.

Cloudflare Queues may be a good fit if the project wants platform-native job processing. For greenfield, a D1 job table is often simpler to start with.

## Alternative Fix

If production sync is not needed yet, disable cron fan-out and keep one authenticated/manual local sync path. This is acceptable for pre-alpha if clearly documented.

## Escape Hatch

Do not implement a complex distributed scheduler before route auth and schema cleanup. But do not keep unauthenticated or overlapping fan-out in any public deployment.

## Definition Of Done

- Sync jobs cannot overlap accidentally for the same term/job type.
- Batches are bounded and idempotent.
- Job state is visible to admins.
- Internal batch endpoints cannot be abused by public callers.

---

# Implementation Checklist

Use this checklist to track progress.

## Security And Route Boundaries

- [x] Classify routes as public, admin, internal, or dev-only.
- [x] Add admin auth middleware.
- [x] Add internal auth middleware or remove public internal HTTP access.
- [x] Delete or protect arbitrary debug fetch.
- [x] Add route auth tests.
- [x] Restrict CORS to public read routes.
- [x] Remove or gate production debug logging.

## Schema And Data Model

- [x] Choose one migration directory.
- [x] Create canonical greenfield schema baseline.
- [x] Include all tables/columns used by runtime code.
- [x] Add schema version/check.
- [x] Fix instructor uniqueness/upsert mismatch.
- [x] Make section identity term-scoped.
- [x] Verify clean DB bootstrap.

## Sync And Enrichment

- [x] Remove destructive-before-constructive sync writes.
- [x] Add stale row pruning after successful sync.
- [x] Fix or disable course-detail DB mutation.
- [x] Add deterministic enrichment checkpointing.
- [x] Move RMP token to secret or disable RMP sync.
- [x] Add resumable RMP/enrichment state.
- [x] Add sync run state, idempotency, and overlap prevention.
- [x] Fix historical sync script or remove it from active workflow.

## Search

- [x] Define Query Language v1.
- [x] Remove unsupported parser features or implement them end to end.
- [x] Fix course-level negation semantics.
- [x] Validate `/api/search` params.
- [x] Separate relaxed suggestions from exact results or disable relaxation.
- [x] Batch quality-score lookup in ranking.
- [x] Add search integration tests.

## Frontend And DTOs

- [x] Create shared API DTOs.
- [x] Make fresh/cached course responses same shape.
- [x] Fix SearchPage async race and stale results.
- [x] Fix CoursePage term/year refetch.
- [x] Make section table mobile-safe.
- [x] Remove temporary debug UI or gate it to dev.

## Tooling And CI

- [x] Add package scripts for `query-types`.
- [x] Make root `typecheck` pass.
- [x] Make root `test` pass without remote auth.
- [x] Make root `build` deterministic and offline by default.
- [x] Add lint.
- [x] Add web tests.
- [x] Fix eval runner exit behavior and assertions.
- [x] Add CI workflow.

## Data Artifacts And Docs

- [x] Remove or externalize large generated data artifacts.
- [x] Document data bootstrap.
- [x] Update README and `CLAUDE.md`.
- [x] Archive stale plans.

---

# Recommended Final Verification Commands

These commands should work from repo root unless noted:

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

API-specific:

```bash
npm run typecheck -w @uiuc-course-search/api
npm test -w @uiuc-course-search/api
```

Web-specific:

```bash
npm run typecheck -w @uiuc-course-search/web
npm test -w @uiuc-course-search/web
npm run build -w @uiuc-course-search/web
```

Schema:

```bash
# Exact command may change after migration cleanup.
# The final repo should document the canonical clean-DB bootstrap command.
```

Security smoke:

```bash
curl -i http://localhost:8787/admin/terms
curl -i -X POST http://localhost:8787/admin/sync-gpa
curl -i -X POST http://localhost:8787/internal/enrich-batch -H 'content-type: application/json' -d '{"tasks":[]}'
```

Expected result for unauthenticated admin/internal requests: `401`, `403`, or `404`.

Search behavior smoke:

```bash
curl 'http://localhost:8787/api/search?q=CS%20225'
curl 'http://localhost:8787/api/search?q=graduate%20algorithms'
curl 'http://localhost:8787/api/search?q=status:open%20online:true%20CS'
curl 'http://localhost:8787/api/search?q=no%20morning%20CS'
```

The final behavior should match Query Language v1 and should not silently ignore supported constraints.
