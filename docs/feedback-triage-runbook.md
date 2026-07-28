# Feedback Triage Runbook

This project is pre-alpha and greenfield. User feedback is not a parking lot; it is a low-friction intake for concrete search, score, link, data freshness, and copy failures that should become tests, evals, or code fixes.

## Intake

Feedback is stored in `feedback_events` through `POST /api/feedback`. The table intentionally keeps anonymous context only: query, course identifiers, score field, expected outcome, free-text note, page, issue, and metadata.

Export recent feedback from staging or production with a restorable D1 backup already verified if the same session will make destructive database changes.

Preferred one-step export plus candidate generation:

```sh
npm run feedback:export -- --database course-search-db-staging --limit 200
```

This writes timestamped raw feedback and candidate files under `artifacts/feedback/`. The command is read-only and uses Wrangler `d1 execute --remote --json`; it does not print or require secret values.

Reviewed candidate resolutions live in `docs/feedback-triage-resolutions.json`. `feedback:export` and the semester maintenance preflight apply that ledger by default, so already covered, promoted, or dismissed reports remain visible in candidate JSON but no longer count as unresolved `needs_review` work.

Semester maintenance preflight also includes this export by default:

```sh
npm run data:semester:plan -- --feedback-database course-search-db-staging
```

Use the dedicated `feedback:export` command for ad hoc triage outside the full data freshness/retention check.

For a raw export only:

```sh
npm run feedback:export -- --database course-search-db-staging --limit 200 --no-candidates
```

To inspect unresolved status without applying the reviewed-resolution ledger:

```sh
npm run feedback:export -- --database course-search-db-staging --limit 200 --no-resolutions
```

Manual export remains available when you already have a Wrangler output file:

```sh
wrangler d1 execute course-search-db-staging --remote --json --command "SELECT * FROM feedback_events ORDER BY created_at DESC LIMIT 200" > artifacts/feedback-events.json
```

Generate review candidates:

```sh
npm run feedback:triage -- --input artifacts/feedback-events.json --output artifacts/feedback-candidates.json
```

Apply the reviewed-resolution ledger to a manual triage run:

```sh
npm run feedback:triage -- --input artifacts/feedback-events.json --output artifacts/feedback-candidates.json --resolutions docs/feedback-triage-resolutions.json
```

The input can be a JSON array, Wrangler D1 JSON with `results`, or NDJSON rows.

The report groups duplicate candidate rows by target, issue, query, course fields, instructor, score field, and expected outcome. Use `duplicateCount` to see repeated reports and `feedbackIds` to trace the source rows. `candidate_count` is the total grouped candidate count. `needs_review_count` is the actionable count after the resolution ledger is applied, and this is the count used by semester maintenance next actions. The report also includes `suggestedFailureClasses` for search-related candidates. These are review hints tied to the eval corpus coverage gate, not automatic promotions.

## Promotion Standard

Every candidate starts as `needs_review`. Do not paste candidates blindly into `GOLDEN_QUERIES`.

For `search_eval` candidates:

- Reproduce the reported query locally or on staging.
- Confirm the expected result or expected filter against Course Explorer data.
- Confirm or correct `suggestedFailureClasses` so the case strengthens the right corpus class.
- Add the case to `apps/api/src/eval/golden-queries.ts` or the extractor golden fixture.
- Run `npm run eval:smoke` and the relevant extractor/search tests.

For `score_audit` candidates:

- Inspect GPA, RMP, quality, instructor-difficulty, and sample-size inputs.
- Confirm whether the displayed score copy is wrong or just under-explained.
- Add DTO/UI tests for valid score-report classes.

For `link_audit`, `data_freshness_audit`, and `copy_audit` candidates, fix the product surface and add a test or Browser QA evidence when the report describes a stable workflow.

After a candidate is reviewed, add a ledger row with `status` set to `covered`, `promoted`, or `dismissed`, plus the matching fields needed to identify the candidate and the artifact that proves the decision. Prefer matching on stable fields such as `target`, `kind`, `issue`, `query`, `subject`, `number`, `crn`, `instructorName`, and `scoreField`; avoid matching on free-text `expected` unless that text is intentionally stable.
