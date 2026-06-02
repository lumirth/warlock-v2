# Search Product Stabilization Report

Date: 2026-06-02

Scope: stabilize the pre-alpha/no-users/greenfield course search on `main`, preferring sharp cutovers and direct quality gates over compatibility shims, stale paths, skipped tests, warning-tolerant tooling, or hidden deferrals.

## Git And CI

Current head: `c3a7a42de37c81467751260f66e6bc1387738a83`

Recent hardening checkpoints:

- `c3a7a42` - Detect inconsistent term coverage counts
- `30931de` - Harden term backfill running lock evidence
- `a3d3a4a` - Retry transient term backfill pages
- `900c3b6` - Harden term coverage backfill evidence
- `70906c5` - Guard subject fuzzy matching for expanded queries
- `930193c` - Add branded Mantine theme and header logo
- `4733db9` - Preserve typed search text during refinements
- `4aa2254` - Add grouped topic synonym expansion
- `785fe48` - Add typo-tolerant subject alias evals
- `e7fa94d` - Expand official subject alias corpus

Latest passing GitHub CI on `main`:

- Run: https://github.com/lumirth/uiuc-course-search/actions/runs/26846369285
- Head: `c3a7a42de37c81467751260f66e6bc1387738a83`
- Result: success

## Local Verification

All commands passed from `/Users/lu/uiuc-course-search` on 2026-06-02:

```bash
npm run typecheck
npm test
npm run build
npm run lint
npm run db:verify
npm run eval:smoke
npm run bundle:budget
npm run security:secrets
npm run security:audit
```

Evidence:

- `npm test`: API 38 files / 339 tests, web 5 files / 19 tests, query-types 1 file / 4 tests, scripts 9 files / 53 tests.
- `npm run eval:smoke`: 100/100 passing, 0 violations; corpus coverage 14/14 classes passing.
- `npm run bundle:budget`: largest JS raw 420.3 KiB / 430.0 KiB, JS gzip 129.7 KiB / 140.0 KiB, CSS raw 195.5 KiB / 240.0 KiB, CSS gzip 29.1 KiB / 40.0 KiB, total JS/CSS gzip 158.9 KiB / 190.0 KiB.
- `npm run db:verify`: schema bootstrap verified `0001_initial_schema`.
- Secret scan passed with no committed secret-looking values; `npm audit --audit-level=moderate` found 0 vulnerabilities.

## Staging Evidence

Staging API URL: https://uiuc-course-search-staging.lumirth.workers.dev
Staging Web URL: https://staging.uiuc-course-search-web.pages.dev
Pages Project: uiuc-course-search-web
Pages Branch: staging

Latest explicit staging Worker deploy:

- Worker: `uiuc-course-search-staging`
- Worker Version ID: `9f2f9334-3ccb-449a-ae2c-6c6a96de283d`
- D1: `course-search-db-staging`
- KV: `GPA_CACHE`
- Vectorize: `course-embeddings-staging`
- AI binding: `AI`
- SELF binding: `uiuc-course-search-staging`

Live staging smoke:

```bash
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev \
STAGING_ADMIN_TOKEN=<redacted> \
STAGING_INTERNAL_TOKEN=<redacted> \
npm run test:staging
```

Result: 10/10 passing. Checks cover health, public search, professor search, fresh course links, feedback POST, admin auth reject/accept, admin sync visibility, and internal auth reject/accept.

Live staging eval:

```bash
EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run eval:staging
```

Result: 100/100 passing, 0 violations, 0 missing expected top results, MRR@10 100.0%, top-1 accuracy 100.0%, constraint violation rate 0.0%.

## Search Product Fixes

Search relevance and corpus coverage are complete for the active scope:

- Official subject alias corpus covers broad names such as `philosophy`, `political science`, `information sciences`, `art history`, `electrical computer engineering`, `stats`, and `psych`.
- Typo-tolerant matching covers misspellings such as `philosphy`, `computr science`, `politcal science`, `informaton sciences`, `art histry`, `organic chemstry`, and `psycology`.
- Topic expansion covers `ai`, `ai/ml`, `artifical inteligence`, `database systems`, `cyber security`, `human compter interaction`, `c++`, and `software development`.
- Instructor queries cover natural forms such as `professor fagen`, `professor fagen algorithms`, `taught by wade fagen algorithms`, and `with O'Brien`.
- Introductory gateway queries cover `intro to CS`, `intro to comp sci`, and `intro computer science`.
- UI refinements preserve typed search text while filter chips and advanced controls modify canonical filters.
- Public result copy avoids raw `n=` and internal score/evidence labels.
- Course and section DTOs include Course Explorer links; RMP links use safe search fallback behavior.
- Feedback POST stores structured anonymous feedback and staging smoke proves the route accepts expected payloads.

## Data Freshness

Term coverage plan: `artifacts/term-coverage-plan.md`

Final 2025-2026 term coverage:

- Available terms: 8
- Present terms: 8
- Missing terms: 0
- Stale terms: 0
- Terms needing backfill: 0
- Expected historical terms: 5

Final staging sync status:

- Running sync states: 0
- Unhealthy sync states: 0
- Freshness stale term IDs: 0
- Freshness stale sync state IDs: 0

Final term states:

- `2025-winter`: 1 subject, 2 courses, 2 sections
- `2025-spring`: 186 subjects, 4,516 courses, 11,613 sections
- `2025-summer`: 151 subjects, 1,047 courses, 1,638 sections
- `2025-fall`: 1 subject, 19 courses, 45 sections
- `2026-winter`: 30 subjects, 58 courses, 60 sections
- `2026-spring`: 187 subjects, 4,494 courses, 11,960 sections
- `2026-summer`: 150 subjects, 1,060 courses, 1,693 sections
- `2026-fall`: 185 subjects, 4,500 courses, 12,913 sections

Data freshness audit: `artifacts/data-freshness-audit.md`

Result: 10/10 passing. Checks cover current term presence, active/upcoming/historical coverage, no stale terms, no stale sync states, GPA freshness, RMP freshness, and current term course/section counts.

Backfill reliability changes:

- Remote term backfill now requires verified D1 backup evidence before writes.
- Page-level transient 408/429/5xx retries prevent one upstream blip from killing a semester backfill.
- Running-lock skips are counted as incomplete evidence instead of false success.
- Admin sync supports explicit `force=true` for deliberate operator reruns of stuck subject locks.
- Coverage planning flags impossible `term_state` counts where completed subject sync rows exceed recorded subject totals.

## Cloudflare Abuse Controls

Rate-Limit Namespace IDs: SEARCH_RATE_LIMITER=26060111, COURSE_RATE_LIMITER=26060112
Abuse Control Routes: /api/search, /api/course, /api/feedback
Abuse Control Action: Cloudflare Workers Rate Limiting returns 429 JSON block responses before expensive public route handlers
Abuse Control Thresholds: /api/search and /api/feedback share SEARCH_RATE_LIMITER at 120 requests/min/IP; /api/course uses COURSE_RATE_LIMITER at 240 requests/min/IP

The staging deploy output exposes both rate-limit bindings as `SEARCH_RATE_LIMITER (120 requests/60s)` and `COURSE_RATE_LIMITER (240 requests/60s)`.

## D1 Backup And Restore

D1 Backup Ref: 20260602T194836Z
D1 Backup Mechanism: Cloudflare D1 Time Travel
D1 Backup Location: Cloudflare D1 Time Travel bookmark 0000003c-00000002-0000507e-63cc7da2dcc34f3ba057bf599cbf5551 for ref 20260602T194836Z
D1 Restore Database: course-search-db-staging
D1 Restore Verified: yes

Notes:

- `wrangler d1 export` is not usable for this database because Cloudflare rejects export for FTS5 virtual tables.
- Time Travel restore was tested by inserting a marker, restoring `course-search-db-staging` to the recorded bookmark, and verifying the marker count returned to 0.
- D1 backup preflight passed before the 2025-2026 term coverage writes.
- Auth rotations wrote only non-secret metadata under `artifacts/backups/*-staging-*-rotation`; no token values were committed or printed.

## Browser And UI QA

Browser QA evidence:

- `artifacts/browser-qa/2026-06-02-staging-intro-pagination-desktop.json`: `intro to CS` shows CS 124 first, pagination/show-more is visible, additional results load, console errors 0.
- `artifacts/browser-qa/2026-06-02-staging-quality-difficulty.json`: quality/workload copy is public-facing, raw `n=` and raw score/evidence copy absent, console errors 0.
- `artifacts/browser-qa/2026-06-02-desktop-search.png`
- `artifacts/browser-qa/2026-06-02-mobile-course.png`

Computer/Browser visual smoke covered live staging search and course pages on desktop and mobile, including professor search chips, editable refinements, feedback entry points, Course Explorer links, quality/difficulty surfaces, and no browser-visible console/network errors in the inspected flows.

## Checklist Mapping

| Plan Item | Status | Evidence |
| --- | --- | --- |
| Search relevance and intuitive query corpus | Complete | Local and staging eval 100/100; subject aliases, typos, topic synonyms, professor queries, intro CS, and philosophy cases pass. |
| Feedback loop | Complete | `/api/feedback` accepts structured anonymous feedback; staging smoke feedback route passes. |
| Editable filters and advanced mode | Complete | Typed query preservation, chip editing/removal, clickable suggestions, and advanced state tests pass. |
| Public copy and technical rough edges | Complete | Browser QA confirms no raw `n=` or raw score/evidence labels in inspected quality/difficulty surfaces. |
| RMP and official links | Complete | Course and section Course Explorer links in public DTOs; RMP fallback behavior covered. |
| Data freshness and semester coverage | Complete | 8/8 discovered 2025-2026 terms covered, 0 running states, 0 unhealthy states, freshness audit 10/10. |
| API integration tests | Complete | API suite 339 tests; search/course/feedback/sync paths covered. |
| Frontend DTO/state tests | Complete | Web suite 19 tests; query-types suite 4 tests. |
| Browser/Computer QA | Complete | Desktop/mobile browser QA artifacts and screenshots listed above. |
| Staging deploy/auth/search/course/feedback smoke | Complete | `npm run test:staging` passes 10/10 against live staging. |
| WAF/rate-limit controls | Complete | Workers rate-limit bindings and thresholds evidenced above. |
| D1 backup/restore | Complete | Time Travel restore evidence and preflight passed for `20260602T194836Z`. |
| Performance/bundle budget | Complete | Bundle budget passes locally and in CI. |
| CI | Complete | GitHub Actions run `26846369285` passed on current `main`. |
| Documentation/reporting | Complete | This report maps each active plan item to concrete evidence without secret values. |

## Final Status

The active pre-alpha stabilization scope is complete on `main` for the implemented product and data freshness contract. The project is still pre-alpha and should continue to prefer opinionated cutovers, stricter gates, and deletion of weak paths over compatibility preservation.
