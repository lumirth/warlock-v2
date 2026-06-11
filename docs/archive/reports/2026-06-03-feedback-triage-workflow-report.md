# Feedback Triage Workflow Report

Date: 2026-06-03

Scope: make the low-friction feedback loop operationally repeatable. The product already accepts feedback; this checkpoint reduces the operator work needed to turn feedback into reviewed corpus/eval candidates.

## Changes

- Added `npm run feedback:export`.
- Added `scripts/export-feedback.ts` to run a read-only Wrangler D1 feedback export and generate triage candidates in one command.
- Candidate reports now group duplicate feedback rows into one review item with `duplicateCount` and `feedbackIds`.
- Updated `docs/feedback-triage-runbook.md` with the preferred export/triage command and duplicate grouping behavior.

## Live Staging Evidence

Command:

```sh
npm run feedback:export -- --database course-search-db-staging --limit 50 --output-dir artifacts/feedback
```

Artifacts:

- `artifacts/feedback/feedback-events-20260603T024135Z.json`
- `artifacts/feedback/feedback-events-20260603T024135Z-candidates.json`

Result:

- Rows exported: 20
- Distinct candidates after grouping: 2
- Candidate mix: 1 high-priority `search_eval`, 1 medium-priority `link_audit`
- Duplicate grouping: 19 repeated `professor fagen algorithms` search reports collapse into one candidate with 19 source `feedbackIds`

## Verification

Passed locally:

```sh
npm run test:scripts -- export-feedback.test.ts feedback-corpus-candidates.test.ts
npm run typecheck:scripts
npm test
npm run typecheck
npm run build
npm run lint
npm run bundle:budget
npm run security:secrets
npm run eval:smoke
```

Coverage added:

- Remote Wrangler command construction defaults to staging D1, `--remote`, JSON output, and a bounded read-only SQL query.
- Local export mode omits `--remote`.
- Unsafe limits are rejected before SQL generation.
- Timestamped export/candidate paths are stable.
- Raw Wrangler JSON exports write both raw feedback and candidate artifacts.
- Duplicate feedback rows group into a single review candidate with source IDs.
