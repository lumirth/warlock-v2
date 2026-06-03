# Search UX Hardening Report

Date: 2026-06-03

Scope: tighten result-card clarity and advanced search state after live QA found two product rough edges: historical courses looked too much like active offerings, and advanced filter edits could leave stale structured words in the search box.

## Changes

- Historical result cards are now visually de-emphasized with a grey, lower-prominence treatment.
- The `Historical term` badge now appears next to the term label, before credits and instructor text, so users see status before reading the card as an active offering.
- Advanced search now treats the main search box as free-text/topic input and advanced controls as structured filters.
- Additive advanced filters preserve free text. Example: `algorithms` plus `Subject CS` keeps `algorithms` visible and searches within CS.
- Contradictory advanced edits clear stale structured text. Example: changing parsed `Subject CS` to `PHIL` clears `intro to CS` from the search box and searches `subject:PHIL`.
- Subject typo matching now treats common adjacent-letter swaps as one edit, so `philospohy` resolves to `PHIL` without loosening the fuzzy subject threshold.

Follow-up frontend-skill pass:

- Replaced the over-rounded theme draft with restrained radius tokens: compact controls, medium product surfaces, and `xl` capped at 16px instead of 24px.
- Removed default `xl` shadows/radii from `Paper` and `Card`; interactive results use subtle `xs` shadows and explicit hover affordance.
- Converted the advanced-search content from a nested card into an expanded refinement section with a divider, so the panel reads as one control surface.
- Removed the adjacent Search button; the search box submits through the form with Enter.
- Added `autocomplete="off"` to the search and advanced text fields after Chrome QA showed stale advanced values being autofilled.
- Reduced badge color noise: orange now marks hard filters/actions, green/yellow/red mark evaluative state, and neutral metadata uses stone.
- Kept the course sections table framed but less pill-like, with a subtle right-edge scroll cue for horizontal overflow.
- Switched frontend component tests to the same Mantine theme provider used by the app.

## Browser Evidence

Local frontend was first run against the staging API:

```sh
VITE_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run dev --workspace apps/web -- --host 127.0.0.1 --port 5173
```

Artifacts:

- `artifacts/browser-qa/2026-06-03-local-search-ux/01-historical-cards-faded.png`
- `artifacts/browser-qa/2026-06-03-local-search-ux/02-advanced-conflict-clears-query.png`
- `artifacts/browser-qa/2026-06-03-local-search-ux/03-advanced-additive-preserves-query.png`
- `artifacts/browser-qa/2026-06-03-local-search-ux/historical-card-results.json`
- `artifacts/browser-qa/2026-06-03-local-search-ux/advanced-conflict-results.json`
- `artifacts/browser-qa/2026-06-03-local-search-ux/advanced-additive-results.json`

Observed results:

- Historical card flow: 20 historical cards, 20 visible `Historical term` badges, 0 console warnings/errors.
- Advanced contradiction flow: search box value cleared to `""`, 20 PHIL result links, 0 console warnings/errors.
- Advanced additive flow: search box value remained `algorithms`, 20 CS result links, 0 console warnings/errors.

The same UX was then deployed to staging:

- API staging version: `f218e1a8-0cab-4d23-834e-dc43e5d78944`
- Web staging alias: `https://staging.uiuc-course-search-web.pages.dev`
- Pages deployment URL: `https://86e7ad02.uiuc-course-search-web.pages.dev`

Deployed staging artifacts:

- `artifacts/browser-qa/2026-06-03-staging-search-ux-after-22cf105/01-staging-historical-cards.png`
- `artifacts/browser-qa/2026-06-03-staging-search-ux-after-22cf105/02-staging-advanced-conflict-clears-query.png`
- `artifacts/browser-qa/2026-06-03-staging-search-ux-after-22cf105/staging-ux-results.json`

Deployed staging observed results:

- Historical CS 225 Spring 2022 flow: 10 historical cards, 10 visible `Historical term` badges, Spring 2022 card style included grey background, grey border, no box shadow, `opacity: 0.72`, and `filter: grayscale(0.25)`.
- Advanced contradiction flow: search box value cleared to `""`, 20 PHIL result links, 0 console warnings/errors.
- Console errors: 0.

## Verification

Passed locally:

```sh
npm test --workspace apps/web -- SearchPage CoursePage FeedbackButton accessibility
npm run typecheck --workspace apps/web
npm run build --workspace apps/web
npm run bundle:budget
npm run typecheck
npm test --workspace apps/web -- SearchPage.test.tsx
npm run typecheck
npm test
npm run build
npm run lint
npm run db:verify
npm run bundle:budget
npm run eval:smoke
npm run security:secrets
if rg "\.skip\(" apps packages scripts; then exit 1; fi
```

Passed against staging after deploy:

```sh
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev STAGING_ADMIN_TOKEN=... STAGING_INTERNAL_TOKEN=... npm run test:staging
EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run eval:staging
```

Focused API/unit coverage:

- `apps/api/src/services/__tests__/alias-registry.test.ts`
- `apps/api/src/services/__tests__/extractor-subjects.test.ts`
- `apps/api/src/eval/golden-queries.ts`

Focused frontend coverage:

- Historical cards expose `data-historical`, faded styling, and a visible `Historical term` status near the term.
- Advanced additive filters preserve free text in the search box.
- Advanced contradictory filters clear stale structured query text.
- Search submits through the form with no standalone Search button.
- Search/course/feedback/accessibility tests render through the production Mantine theme provider.
- Browser QA covered desktop search, result refinement, advanced panel expansion, and the course sections table scroll cue against the local mock API.
