# Semester Maintenance Preflight Report

Date: 2026-06-03

Scope: add and verify a one-command, read-only semester maintenance preflight that gathers sync status, rolling retention, retained-term coverage, retention-scoped freshness, and feedback triage evidence before backup-gated D1 prune or backfill work.

## Implementation

- Added `npm run data:semester:plan`.
- Added `scripts/semester-maintenance-plan.ts`.
- Added `scripts/__tests__/semester-maintenance-plan.test.ts`.
- Updated the data refresh runbook, feedback triage runbook, and search product master plan to make the planner the recurring semester preflight.

The command is read-only. It does not prune, backfill, or mutate D1. It writes an artifact bundle and exits non-zero when the bundle proves operator work is still required.

## Local Verification

- `npm run test:scripts`: 12 files, 81 tests passing.
- `npm run typecheck:scripts`: passing.

## Staging Evidence

Command:

```bash
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev \
STAGING_ADMIN_TOKEN=<local token file> \
npm run data:semester:plan -- \
  --from-year 2004 \
  --to-year 2027 \
  --target-size-mb 250 \
  --max-retained-terms 18 \
  --feedback-database course-search-db-staging \
  --output-dir artifacts/semester-maintenance/20260603T-live-policy-check
```

Current result: exited zero with `Overall: ready`.

Artifact bundle:

- `artifacts/semester-maintenance/20260603T-live-policy-check/sync-status.json`
- `artifacts/semester-maintenance/20260603T-live-policy-check/term-retention-plan.json`
- `artifacts/semester-maintenance/20260603T-live-policy-check/term-retention-prune.sql`
- `artifacts/semester-maintenance/20260603T-live-policy-check/term-coverage-plan.json`
- `artifacts/semester-maintenance/20260603T-live-policy-check/data-freshness-audit.json`
- `artifacts/semester-maintenance/20260603T-live-policy-check/feedback-events.json`
- `artifacts/semester-maintenance/20260603T-live-policy-check/feedback-candidates.json`
- `artifacts/semester-maintenance/20260603T-live-policy-check/semester-maintenance-plan.md`

Summary:

- Retained terms: 18.
- Dropped terms: 61.
- Coverage terms needing backfill: 0.
- Freshness failed checks: 0.
- Feedback rows exported: 21.
- Feedback candidates generated: 2.
- Backup required before prune: no.

Current term evidence from `sync-status.json`:

- `freshness.currentTermId`: `2026-fall`.
- `freshness.configuredCurrentTermId`: `2026-fall`.
- `freshness.registrableTermIds`: `2026-fall`, `2026-summer`.
- `freshness.activeTermIds`: none.
- `freshness.historicalTermCount`: 16.
- `freshness.staleTermIds`: none.
- `freshness.staleSyncStateIds`: none.

Retained terms are complete through the configured rolling window:

- `2026-fall`, `2026-summer`, `2026-spring`, `2026-winter`.
- `2025-fall`, `2025-spring`, `2025-summer`, `2025-winter`.
- `2024-fall`, `2024-spring`, `2024-summer`, `2024-winter`.
- `2023-fall`, `2023-spring`, `2023-summer`, `2023-winter`.
- `2022-fall`, `2022-spring`.

Feedback candidates:

- `professor fagen algorithms`: `search_eval`, high priority, 19 duplicate reports.
- `CS 225`: `link_audit`, medium priority, 1 report.

Feedback review outcome:

- `professor fagen algorithms` is already promoted in `apps/api/src/eval/golden-queries.ts` as golden query `id: 71`, with `expected_filter_keys: ["instructor_ids"]` and `expected_residual: "algorithms"`. Staging eval passed 101/101 after this coverage.
- `CS 225` link audit was promoted into `apps/web/src/pages/CoursePage.test.tsx`, which now verifies the visible `Course Explorer` link, section `CRN` official link, and direct public numeric Rate My Professors instructor link.
- `docs/feedback-triage-resolutions.json` records both decisions, so recurring maintenance preflights do not keep reopening already-covered feedback.

Ledger verification command:

```bash
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev \
STAGING_ADMIN_TOKEN=<local token file> \
npm run data:semester:plan -- \
  --from-year 2004 \
  --to-year 2027 \
  --target-size-mb 250 \
  --max-retained-terms 18 \
  --feedback-database course-search-db-staging \
  --output-dir artifacts/semester-maintenance/20260603T-feedback-ledger-check
```

Ledger verification result:

- Overall: ready.
- Retained terms: 18.
- Dropped terms: 61.
- Coverage terms needing backfill: 0.
- Freshness failed checks: 0.
- Feedback rows exported: 22.
- Feedback candidates needing review: 0.
- Artifact bundle: `artifacts/semester-maintenance/20260603T-feedback-ledger-check`.

Earlier preflight artifact `artifacts/semester-maintenance/20260603T030000Z-staging` exited non-zero before the backup-gated backfill/prune data phase. It found 24 retained terms, 55 dropped terms, six missing retained terms, and two freshness failures. That artifact is historical evidence for the work that was needed, not the current operator state.

## Decision

The 2004-to-present range is a discovery horizon, not a full-history requirement. The live preflight confirms the rolling full-detail policy is now in force: current/registrable terms are pinned, retained historical terms are complete, and old terms outside the budget are intentionally absent after backup-gated prune work.

Current next action:

- No operator action is required by this read-only maintenance plan.
