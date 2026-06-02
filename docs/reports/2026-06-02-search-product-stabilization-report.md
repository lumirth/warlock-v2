# Search Product Stabilization Report

Date: 2026-06-02

Scope: complete the active pre-alpha/no-users/greenfield hardening goal for `main`, with sharp cutovers over aliases, stale paths, skipped tests, warning-tolerant tooling, or compatibility shims.

## Git Checkpoints

- `68df18a` - Plan search product hardening
- `c19b51f` - Add search feedback and public link foundations
- `cb4a1ed` - Add editable search plan UI
- `94a8ac0` - Expand search corpus for instructor queries
- `02d37bf` - Add data freshness status evidence
- `359e531` - Polish public search result copy
- `275cc8a` - Add feedback corpus triage workflow
- `18f06e1` - Fix browser QA mock API CORS
- `5a79402` - Expand browser QA mock coverage
- `4d9ae08` - Resolve natural instructor name fallbacks
- `7d4f2ff` - Add official links to fresh section DTOs
- `0a318e1` - Expand staging smoke product checks
- `530b4ea` - Preserve professor query topic residuals
- `5a9cce0` - Align instructor chips with resolved query

## Local Verification

All commands below passed on 2026-06-02 from `/Users/lu/uiuc-course-search`:

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
npm run bootstrap:fresh-check
```

Evidence:

- `npm test`: API 37 files / 286 tests, web 5 files / 16 tests, query-types 1 file / 4 tests, scripts 5 files / 28 tests.
- `npm run eval:smoke`: 71/71 passing, 0 violations; includes `professor fagen algorithms`.
- `npm run bundle:budget`: largest JS gzip 128.4 KiB / 140.0 KiB; largest CSS gzip 28.7 KiB / 40.0 KiB; total JS/CSS gzip 157.2 KiB / 190.0 KiB.
- Source skip scan excluding build output found no active `.skip` or `.only` markers.
- Secret scan found no committed secret-looking values; audit found 0 vulnerabilities.
- Fresh clone bootstrap verified `npm ci`, schema bootstrap, and typecheck.

## GitHub CI

Latest passing CI on `main`:

- Run: https://github.com/lumirth/uiuc-course-search/actions/runs/26804529571
- Head: `5a9cce098c5e9e741602003a9e59dd61860d154a`
- Result: success
- CI steps include install, typecheck, schema verification, tests, build, bundle budget, lint, secret scan, dependency audit, and search smoke eval artifact upload.

## Follow-Up Corpus Checkpoint

New issue covered on 2026-06-02: broad subject-name queries such as `Philosophy` were not systematically resolving to their official subjects. The subject alias corpus now uses the generated public Course Explorer subject names plus conservative student shorthand instead of a tiny hand-written subset.

Evidence:

- Generated current public subject list has 190 subject codes and includes official names such as `PHIL: Philosophy`, `IS: Information Sciences`, `ARTH: Art--History`, and `ECE: Electrical and Computer Engineering`.
- Unsafe lowercase subject codes such as `is`, `me`, `up`, `law`, `art`, and `eng` are not promoted as hard aliases merely because they are common one-word text.
- `npm test -w @uiuc-course-search/api -- src/services/__tests__/alias-registry.test.ts src/services/__tests__/extractor-subjects.test.ts`: 46/46 passing.
- `npm run eval:smoke`: 83/83 passing, 0 violations; subject-alias coverage now has 14 cases and includes `philosophy`, `intro to philosophy`, `political science`, `information sciences`, `art history`, `electrical computer engineering`, `stats`, and `psych`.
- Root `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` passed after the corpus expansion.

## Staging Evidence

Staging API URL: https://uiuc-course-search-staging.lumirth.workers.dev
Staging Web URL: https://staging.uiuc-course-search-web.pages.dev
Pages Project: uiuc-course-search-web
Pages Branch: staging

Latest explicit staging Worker deploy:

- Worker: `uiuc-course-search-staging`
- Worker Version ID: `46be72cf-cf91-4fcf-a724-b246d31af98e`
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

Result: 10/10 passing. Checks cover health, public search, professor search, fresh course links, feedback POST, admin auth reject/accept, admin sync visibility, internal auth reject/accept.

Cloudflare staging preflight:

```bash
npm run cloudflare:preflight -- --report docs/reports/2026-06-02-search-product-stabilization-report.md
```

Result: 32/32 passing.

Live staging eval:

```bash
EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run eval:staging
```

Result: 71/71 passing, 0 violations, 0 missing expected top results, MRR@10 100.0%, top-1 accuracy 100.0%.

Direct professor-query smoke:

- Query: `professor fagen algorithms`
- Plan filters: `instructor_ids: [3365]`
- Canonical residual: `algorithms`
- Public chips: `Instructor fagen`, `Topic: algorithms`
- Advanced search state: `instructor: fagen`

Computer Use visual smoke on live staging web confirmed the same chips and a visible result card.

## Cloudflare Abuse Controls

Rate-Limit Namespace IDs: SEARCH_RATE_LIMITER=26060111, COURSE_RATE_LIMITER=26060112
Abuse Control Routes: /api/search, /api/course, /api/feedback
Abuse Control Action: Cloudflare Workers Rate Limiting returns 429 block responses before expensive public route handlers
Abuse Control Thresholds: /api/search and /api/feedback share SEARCH_RATE_LIMITER at 120 requests/min/IP; /api/course uses COURSE_RATE_LIMITER at 240 requests/min/IP

The staging deploy output exposes both rate-limit bindings as `SEARCH_RATE_LIMITER (120 requests/60s)` and `COURSE_RATE_LIMITER (240 requests/60s)`.

## D1 Backup And Restore

D1 Backup Ref: 20260602T065525Z
D1 Backup Mechanism: Cloudflare D1 Time Travel
D1 Backup Location: Cloudflare D1 Time Travel bookmark 0000001d-0000000a-0000507e-ed44f5c926c0d0031d2684f28de272e7 for ref 20260602T065525Z
D1 Restore Database: course-search-db-staging
D1 Restore Verified: yes

Notes:

- `wrangler d1 export` is not usable for this database because Cloudflare rejects export for FTS5 virtual tables.
- Time Travel restore was tested by inserting marker `restore-test-20260602T065525Z`, restoring `course-search-db-staging` to the recorded bookmark, and verifying the marker count returned to 0 while `feedback_events` remained present.
- Staging D1 read-only snapshot after final deploy: 1 active term, 187 subjects, 4,494 courses, 11,960 sections, sync states `complete=189` and `completed=1`.

## Browser And UI QA

Browser QA evidence:

- Desktop professor search, advanced search, clickable ambiguity, search feedback, course feedback, Course Explorer links, and RMP fallback behavior passed with no console warning/error entries.
- Mobile search and course detail passed at 390x844.
- Screenshots:
  - `artifacts/browser-qa/2026-06-02-desktop-search.png`
  - `artifacts/browser-qa/2026-06-02-mobile-course.png`

Computer Use evidence:

- Helium live staging web visual smoke loaded `https://staging.uiuc-course-search-web.pages.dev`.
- Query `professor fagen algorithms` showed `Instructor fagen`, `Topic: algorithms`, `Results not right?`, and a visible course result card.

## Checklist Mapping

| Plan Item | Status | Evidence |
| --- | --- | --- |
| Search Product Contract v2 | Complete | Shared DTOs for search UI, feedback, Course Explorer links, RMP links, evidence chips, and canonical query residuals. |
| Professor-name search | Complete | Resolver preserves trailing topic residuals; eval query `professor fagen algorithms` passes locally and on staging. |
| Comprehensive corpus | Complete for current goal | 71 golden queries covering navigational, structured, semantic, power syntax, disambiguation, instructor, score, and schedule cases. |
| Feedback loop | Complete | `/api/feedback` stores anonymous structured events; staging smoke posts feedback successfully; triage script converts feedback into corpus candidates. |
| Editable filters and advanced mode | Complete | Chips are removable/editable, ambiguity actions are clickable, advanced search state is populated from the canonical plan. |
| Public copy and technical rough edges | Complete | Search/course UI avoids `n=` and raw ranks; match labels are public-facing; instructor chips no longer overstate parsed text. |
| RMP and official links | Complete | RMP professor links or safe school search fallback; course and section Course Explorer URLs in cached and fresh paths. |
| Data freshness | Complete for pre-alpha staging | Term state, sync status route, scheduler coverage, staging counts, and data freshness status evidence are present. |
| Current/upcoming/historical support | Complete for implemented contract | Term state model and explicit year/term route params are tested; current staging active term is populated. |
| API integration tests | Complete | Search/course/feedback/data-refresh paths covered by hermetic tests; full API suite 286 tests. |
| Frontend state/DTO tests | Complete | Web tests cover chip removal, feedback, advanced/disambiguation surfaces; DTO tests cover residual-aware instructor chips. |
| Browser/Computer QA | Complete | Browser desktop/mobile QA plus Computer Use live staging visual smoke. |
| Staging deploy/auth/search/course/feedback/link smoke | Complete | `npm run test:staging` passes 10/10 against live staging. |
| WAF/rate-limit controls | Complete | Workers rate-limit bindings configured and evidenced above. |
| D1 backup/restore | Complete | Time Travel restore tested and documented above. |
| Performance/bundle budget | Complete | Bundle budget passes locally and in CI. |
| CI | Complete | Latest GitHub CI green on `5a9cce0`. |
| Documentation/reporting | Complete | This report maps the active goal to concrete evidence without secret values. |

## Final Status

The active stabilization scope is complete for the current pre-alpha goal. Remaining future product work should move into a new goal, not linger as hidden deferral inside this one.
