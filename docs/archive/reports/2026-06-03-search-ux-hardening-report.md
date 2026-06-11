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

Uncodexify / product-design pass:

- Added root `PRODUCT.md` and `DESIGN.md` so future UI work has a durable student-utility contract.
- Added `.impeccable/live/config.json` for future in-browser variant work against the Vite shell without first-run setup.
- Removed the pseudo-hero headline and supporting marketing copy from the search page; the app header now carries identity and the page starts with the actual search task.
- Tightened radius and shadow tokens again: product surfaces cap at compact radii and all theme shadows are limited to small, non-dramatic elevation.
- Removed the glassy header blur, hover lift transform, and gradient scroll cue.
- Replaced result-card score and evidence pill clusters with plain metadata rows while keeping removable interpreted-query chips functional.
- Replaced the course score donut and score badges with a compact text metric list.
- Replaced section-table status and rating badges with text-first table values.
- Added a favicon using the existing course-search logo, eliminating the browser-visible missing-favicon console error.
- Tightened the mobile app header so `UIUC Course Search` stays on one line, and removed separator glyphs that could wrap as orphaned punctuation on mobile result cards.

Uncodexify browser QA artifacts:

- `artifacts/browser-qa/2026-06-03-uncodexify-ui/01-desktop-empty-search.png`
- `artifacts/browser-qa/2026-06-03-uncodexify-ui/02-desktop-intro-results.png`
- `artifacts/browser-qa/2026-06-03-uncodexify-ui/03-desktop-load-more.png`
- `artifacts/browser-qa/2026-06-03-uncodexify-ui/04-desktop-course-page.png`
- `artifacts/browser-qa/2026-06-03-uncodexify-ui/05-mobile-search-results.png`
- `artifacts/browser-qa/2026-06-03-uncodexify-ui/06-mobile-course-page.png`
- `artifacts/browser-qa/2026-06-03-uncodexify-ui/qa-results.json`

Uncodexify browser QA observed results:

- Desktop and mobile QA used the local mock API at `http://127.0.0.1:8787` and Vite at `http://127.0.0.1:5173`.
- Desktop empty search, desktop intro search results, desktop load-more, desktop course detail, mobile search results, and mobile course detail were screenshot-tested in headless Chrome through the DevTools protocol.
- Console issues: 0.
- Network issues: 0.
- Search input colors: white background with `rgb(12, 10, 9)` text, avoiding the previous black-on-orange concern.
- Pseudo-hero text present: false.
- Ring progress / donut score UI present: false.
- Header title lines on mobile search: 1.
- Orphaned metadata separators on mobile search: false.
- Mobile course page exposed course scores, Course Explorer, and sections; page-level horizontal overflow: false.

Second design-review pass after concept-image rejection:

- Discarded the generated-image direction after review. The redesign work now follows the product contract in `PRODUCT.md` / `DESIGN.md` and live UI inspection rather than image-derived styling.
- Changed the search app container and header from the old cramped custom `lg` width to the app's `xl` product width while keeping search results constrained to a readable 60rem measure.
- Reworked advanced search into grouped fieldsets: Course, Term and meeting, and Preferences.
- Replaced the flat 12-field advanced grid with responsive controls: one column on mobile, two on tablet, four per group on desktop.
- Changed advanced controls to safer inputs where appropriate: selects for term, time, delivery, status, and workload; uppercase normalization for subject, GenEd, and meeting days; numeric input modes for course number, year, and credits.
- Added explicit `aria-expanded` / `aria-controls` wiring to the Advanced search trigger.
- Added an advanced-form action row with `Reset fields` and `Apply filters`; on mobile the actions become full-width paired controls.
- Disabled advanced Apply until controls differ from the interpreted query, so parsed filters are reset through the form and removed through their chips.
- Reworked result-card score display from inline muted phrases into a compact metric definition list for Quality, Workload, Instructor, and Avg GPA.
- Reworked result-card heading layout so relevance sits beside the title on desktop and stacks beneath it on mobile.
- Kept historical cards as subdued functional links with a visible `Historical term` status near the term label.
- Added card skeletons that match result shape instead of a lone centered spinner.
- Made course-page score feedback a real full-width sidebar action with a bordered secondary-button treatment.

Second design-review live QA:

- Desktop search results: result cards scanned as course records; metric strip was readable without badge noise; feedback stayed secondary.
- Desktop advanced search: grouped fields fit above first results with action row visible in a common browser viewport.
- Mobile advanced search: fields stacked cleanly, labels stayed readable, and action buttons were fully visible with no horizontal squeeze.
- Mobile result cards: long course title wrapped cleanly, relevance moved under the title, metadata wrapped without orphaned separators, and metrics stayed readable in a two-column flow.
- Mobile course page: score panel, full-width score feedback action, description, and sections heading stacked cleanly with no page-level horizontal overflow observed.
- Course detail error state for a mock-only result (`CS 124`) remained direct and readable.

Fixed-viewport redesign audit artifacts:

- `artifacts/browser-qa/2026-06-03-redesign/cdp-desktop-search-advanced.png`
- `artifacts/browser-qa/2026-06-03-redesign/cdp-mobile-search-advanced-top.png`
- `artifacts/browser-qa/2026-06-03-redesign/cdp-mobile-search-advanced-actions.png`
- `artifacts/browser-qa/2026-06-03-redesign/cdp-mobile-result-card.png`
- `artifacts/browser-qa/2026-06-03-redesign/cdp-desktop-course-detail.png`
- `artifacts/browser-qa/2026-06-03-redesign/cdp-mobile-course-detail.png`

Fixed-viewport redesign audit notes:

- Headless Chrome CDP exercised the real Vite app against the local mock API, not static screenshots.
- Desktop advanced search kept the search task, interpreted chips, grouped filters, disabled reset/apply row, and first result card visible in one 1280 x 900 viewport.
- Mobile advanced action row stayed within a 390 x 844 viewport with full-width paired controls and readable helper text.
- Mobile result cards used course title, relevance, term/credits/instructor/GenEd, metrics, description, and match evidence in that order with no visible horizontal overflow.
- Desktop and mobile course detail preserved the intended decision order: identity, scores, feedback, description, and sections.

Final staging deployment verification:

- Web staging alias: `https://staging.uiuc-course-search-web.pages.dev`
- Pages deployment URL: `https://e057dbba.uiuc-course-search-web.pages.dev`
- Verification date: 2026-06-03

Final staging artifacts:

- `artifacts/browser-qa/2026-06-03-staging-redesign-final/01-staging-home-desktop.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/02-staging-desktop-search-advanced.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/03-staging-mobile-search-advanced-top.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/04-staging-mobile-search-actions.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/05-staging-mobile-result-card.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/06-staging-desktop-course-detail.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/07-staging-mobile-course-detail.png`
- `artifacts/browser-qa/2026-06-03-staging-redesign-final/staging-redesign-results.json`

Final staging observed results:

- Deployed search for `intro to CS` returned 20 visible result cards out of 21 total.
- Deployed advanced search panel was visible; unchanged `Reset fields` and `Apply filters` controls were disabled.
- Deployed mobile search and course detail reported no page-level horizontal overflow.
- Deployed course detail for `CS 225` exposed `Course scores`, `Score feedback`, and `Sections`.
- Captured console/log issues: 0.
