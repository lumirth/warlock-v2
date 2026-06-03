# Pagination And Enrichment Hotfix Report

Date: 2026-06-03

Scope: fix the staged search pagination failure, remove stale Spring 2026 fallback configuration, clarify that full 2004 history is no longer required, and restore ratings/rich metadata coverage for currently registrable terms.

## Search Pagination

Issue reproduced on staging:

```text
GET /api/search?q=CS&limit=20&offset=240
Error: D1_ERROR: too many SQL variables at offset 240: SQLITE_ERROR
```

Root cause: deeper search pages request a wider candidate window so the API can slice later pages. The search service then fetched large course-id sets with one `WHERE id IN (...)` query, exceeding D1's SQL bind-variable ceiling.

Fix:

- `apps/api/src/services/search.ts` now chunks internal course metadata, quality-score, and semantic post-filter id lookups with a safe D1 batch size.
- `apps/api/src/services/__tests__/search-ranking.test.ts` adds a regression that returns 120 candidates and fails if any metadata query binds more than 50 variables.

Staging evidence after deploy `fc0fb81d-2847-4712-9372-cbfd0f5603ed`:

- `GET /api/search?q=CS&limit=20&offset=240`: 20 results, `hasMore=true`, `nextOffset=260`.
- `GET /api/search?q=computer%20science&limit=20&offset=240`: 20 results, `hasMore=true`, `nextOffset=260`.
- `GET /api/search?q=CS&limit=20&offset=1000`: 20 results, `hasMore=true`, `nextOffset=1020`.

## Current Term Fallback

`apps/api/wrangler.toml` now uses `CURRENT_TERM = "fall"` for both default and staging Worker vars. Runtime freshness still uses `term_state` as source of truth, but the fallback no longer advertises stale Spring 2026 state.

Live staging status after deploy:

- `freshness.currentTermId`: `2026-fall`
- `freshness.configuredCurrentTermId`: `2026-fall`
- `freshness.registrableTermIds`: `2026-fall`, `2026-summer`
- `freshness.staleTermIds`: none
- `freshness.staleSyncStateIds`: none

## Active-Term Enrichment

Before this pass, staging had fresh GPA/RMP source sync states but zero rich metadata on both registrable terms:

- `2026-fall`: 0 courses with GPA, 0 with quality/workload scores, 0 enriched instructor links.
- `2026-summer`: 0 courses with GPA, 0 with quality/workload scores, 0 enriched instructor links.

Fix:

- `coordinateEnrichment` now rebuilds instructor links for every `registrable` or `active` term, not only the single highest-priority term.
- `docs/data-refresh-runbook.md` now tells operators to run `/admin/enrich-gpa` and then `/admin/enrich-scoring` after broad backfills or GPA/RMP updates.

Staging enrichment commands run:

```bash
POST /admin/enrich-gpa
POST /admin/enrich-scoring
```

Results:

- `/admin/enrich-gpa`: `scoreUpdateCount=27807`
- `/admin/enrich-scoring`: `taskCount=7902`, `batchCount=2`, `linkCount=7902`, `scoreUpdateCount=28949`

Post-enrichment coverage:

| Term | Courses | Sections | Courses With GPA | Courses With Quality | Courses With Workload | Enriched Links |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `2026-fall` | 4,500 | 12,913 | 2,278 | 3,210 | 3,210 | 4,022 |
| `2026-summer` | 1,060 | 1,693 | 434 | 644 | 644 | 692 |

Not every active course has ratings because GPA/RMP sources only cover matched historical course and instructor records. The bug was zero active-term application, not the absence of universal source data.

## Freshness Tests

`apps/api/src/services/__tests__/freshness.test.ts` now includes:

- A regression where `CURRENT_YEAR/CURRENT_TERM` fallback is stale but a newer registrable Fall term correctly becomes current.
- A synthetic-year threshold test that checks active, historical, GPA, and RMP freshness based on `last_synced` age, so the test does not become stale as real semesters change.

## Enrichment Observability

Follow-up hardening added an `enrichmentCoverage` array to `/admin/sync/status` for every active or registrable term. The data freshness audit now fails when any current, active, or registrable term is missing enrichment coverage or has zero GPA/score/link coverage.

Live staging status after deploy `06c05425-c0ec-4d25-8a08-e71aaf512706` includes:

- `2026-fall`: 2,278 courses with GPA, 3,210 with quality/workload scores, 4,022 enriched links.
- `2026-summer`: 434 courses with GPA, 644 with quality/workload scores, 692 enriched links.

Retention-scoped audit artifact `artifacts/retention/staging-freshness-audit-with-enrichment-20260603T022000Z.json` passes 15/15 checks, including `active/registrable enrichment coverage`.

## Requirement Update

The active product requirements now state that full D1 history back through 2004 is no longer expected:

- `docs/plans/2026-06-02-search-product-corpus-feedback-master-plan.md`
- `docs/data-refresh-runbook.md`

The current requirement is a rolling full-detail retained corpus: every retained term must be complete; currently registrable terms are pinned and prioritized; dropped terms are intentionally absent.

## Verification

Local:

- `npx vitest run apps/api/src/services/__tests__/search-ranking.test.ts apps/api/src/services/__tests__/freshness.test.ts apps/api/src/services/__tests__/enrichment.test.ts apps/api/src/routes/__tests__/sync-status.test.ts apps/api/src/services/__tests__/term-state.test.ts`
- `npm run typecheck -w @uiuc-course-search/api`
- API deploy precheck: 39 test files, 347 tests passed.

Staging:

- API deploy version: `fc0fb81d-2847-4712-9372-cbfd0f5603ed`
- Enrichment coverage status deploy version: `06c05425-c0ec-4d25-8a08-e71aaf512706`
- Deep search pagination succeeds at offsets 240 and 1000.
- Retention-scoped freshness audit artifact: `artifacts/retention/staging-freshness-audit-post-enrichment-20260603T021200Z.json`
- Audit result: 14 passing checks, 0 failed.
- Retention-scoped audit with enrichment coverage artifact: `artifacts/retention/staging-freshness-audit-with-enrichment-20260603T022000Z.json`
- Audit with enrichment coverage result: 15 passing checks, 0 failed.
- D1 size after enrichment: 461,303,808 bytes.
