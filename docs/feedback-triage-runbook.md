# Feedback Triage Runbook

This project is pre-alpha and greenfield. User feedback is not a parking lot; it is a low-friction intake for concrete search, score, link, data freshness, and copy failures that should become tests, evals, or code fixes.

## Intake

Feedback is stored in `feedback_events` through `POST /api/feedback`. The table intentionally keeps anonymous context only: query, course identifiers, score field, expected outcome, free-text note, page, issue, and metadata.

Export recent feedback from staging or production with a restorable D1 backup already verified if the same session will make destructive database changes:

```sh
wrangler d1 execute course-search-db-staging --remote --json --command "SELECT * FROM feedback_events ORDER BY created_at DESC LIMIT 200" > artifacts/feedback-events.json
```

Generate review candidates:

```sh
npm run feedback:triage -- --input artifacts/feedback-events.json --output artifacts/feedback-candidates.json
```

The input can be a JSON array, Wrangler D1 JSON with `results`, or NDJSON rows.

The report includes `suggestedFailureClasses` for search-related candidates. These are review hints tied to the eval corpus coverage gate, not automatic promotions.

## Promotion Standard

Every candidate starts as `needs_review`. Do not paste candidates blindly into `GOLDEN_QUERIES`.

For `search_eval` candidates:

- Reproduce the reported query locally or on staging.
- Confirm the expected result or expected filter against Course Explorer data.
- Confirm or correct `suggestedFailureClasses` so the case strengthens the right corpus class.
- Add the case to `apps/api/src/eval/golden-queries.ts` or the extractor golden fixture.
- Run `npm run eval:smoke` and the relevant extractor/search tests.

For `score_audit` candidates:

- Inspect GPA, RMP, quality, workload, and sample-size inputs.
- Confirm whether the displayed score copy is wrong or just under-explained.
- Add DTO/UI tests for valid score-report classes.

For `link_audit`, `data_freshness_audit`, and `copy_audit` candidates, fix the product surface and add a test or Browser QA evidence when the report describes a stable workflow.
