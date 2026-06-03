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

- `npm run test:scripts`: 12 files, 78 tests passing.
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
  --feedback-database course-search-db-staging \
  --output-dir artifacts/semester-maintenance/20260603T030000Z-staging
```

Result: exited non-zero because the preflight found real retained-corpus work.

Artifact bundle:

- `artifacts/semester-maintenance/20260603T030000Z-staging/sync-status.json`
- `artifacts/semester-maintenance/20260603T030000Z-staging/term-retention-plan.json`
- `artifacts/semester-maintenance/20260603T030000Z-staging/term-retention-prune.sql`
- `artifacts/semester-maintenance/20260603T030000Z-staging/term-coverage-plan.json`
- `artifacts/semester-maintenance/20260603T030000Z-staging/data-freshness-audit.json`
- `artifacts/semester-maintenance/20260603T030000Z-staging/feedback-events.json`
- `artifacts/semester-maintenance/20260603T030000Z-staging/feedback-candidates.json`
- `artifacts/semester-maintenance/20260603T030000Z-staging/semester-maintenance-plan.md`

Summary:

- Retained terms: 24.
- Dropped terms: 55.
- Estimated retained bytes: 253,132,404.
- Retention warnings: none.
- Coverage terms needing backfill: 6.
- Freshness failed checks: 2.
- Feedback rows exported: 20.
- Feedback candidates generated: 2.
- Backup required before prune: yes.

Retained terms needing backfill:

- `2023-winter`: missing from `term_state`.
- `2022-summer`: missing from `term_state`.
- `2022-winter`: missing from `term_state`.
- `2021-spring`: missing from `term_state`.
- `2021-summer`: missing from `term_state`.
- `2021-winter`: missing from `term_state`.

Freshness failures:

- `retained corpus term coverage`: the six retained terms above are missing.
- `retained corpus full-detail counts`: the six retained terms above have no course/section counts because they are absent.

Feedback candidates:

- `professor fagen algorithms`: `search_eval`, high priority, 19 duplicate reports.
- `CS 225`: `link_audit`, medium priority, 1 report.

## Decision

The 2004-to-present range is a discovery horizon, not a full-history requirement. The preflight confirms the rolling full-detail policy is the right next operational frame: current/registrable terms are pinned, retained historical terms must be complete, and old terms outside the budget should be pruned after backup evidence.

Next work should be backup-gated:

- Create and restore-verify a D1 Time Travel backup.
- Backfill the six missing retained terms from the coverage plan.
- Execute and verify the generated prune SQL for dropped terms only after backup evidence exists.
- Re-run `npm run data:semester:plan` and require zero retained-term coverage/freshness failures.
