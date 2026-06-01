# Stabilization Report

Date: 2026-06-01

Scope: harden `main` according to `docs/plans/2026-06-01-stabilization-hardening-master-plan.md`, treating the project as pre-alpha/no-users/greenfield software.

## Key Git Checkpoints

- `26c9dcc` - Complete pre-alpha remediation checkpoint
- `418d23a` - Harden local integration and remove dead chart
- `b14c129` - Enforce zero-warning lint gate
- `d2d8752` - Harden query eval gates
- `15b04f1` - Harden Browser QA flows
- `553aa58` - Add search result evidence DTOs
- `c69d2da` - Enforce budgets security and structured logs
- `7eb6ffc` - Document stabilization operations and blockers
- `f1045b3` - Record external CI blocker
- `1048c67` - Harden scheduler reliability coverage
- `789c413` - Verify fresh clone bootstrap
- `fbd1ff2` - Update stabilization checklist evidence
- `88b1fe8` - Cover D1 backup preflight
- `574543e` - Record GitHub CI remote setup
- `f6e95da` - Opt CI actions into Node 24
- `1558d72` - Update CI actions for Node 24
- `e35da43` - Record passing GitHub CI evidence
- `195afb4` - Add Cloudflare staging preflight gate
- `2eacee9` - Tighten Cloudflare preflight resource checks
- `de30d20` - Record latest stabilization evidence
- `6bc3ac4` - Audit stabilization completion state
- `6fa22e4` - Tighten Cloudflare evidence gate
- `a15db81` - Expand staging smoke observability proof
- `30be492` - Cover staging smoke runner
- `44eefb3` - Require abuse control evidence
- `2ddae41` - Require concrete D1 restore evidence
- `e0560e0` - Require Pages staging evidence
- `91a0d9d` - Refresh stabilization audit evidence
- `9d4d9f0` - Cut over staging deploy and debug routes
- `e1d290f` - Reduce public health and stale doc surface
- `1b5bfbb` - Remove stale sync timing config
- `9bd7238` - Harden Cloudflare staging sync and search

The history was rewritten on 2026-06-01 after a private GitHub push was rejected for old generated data artifacts over GitHub's file-size limit. A verified local recovery bundle exists at `artifacts/backups/uiuc-course-search-main-20260601T171900Z.bundle`, and the rewritten history has no reachable `history_chunks/`, `historical-data.sql`, or `full_history.sql` objects.

A stale local side worktree on `feature/smart-hybrid-search` was found during the completion audit with staged generated `historical-data.sql`. Before removing it, recovery artifacts were created and verified at `artifacts/backups/feature-smart-hybrid-search-20260601T175844Z.bundle` and `artifacts/backups/side-worktree-smart-search-20260601T175844Z.tgz`. The branch/worktree were then removed; `git worktree list --porcelain` now shows only `/Users/lu/uiuc-course-search` on `main`.

## Local Verification Evidence

All commands below passed locally on 2026-06-01:

```bash
npm run typecheck
npm test
npm run build
npm run bundle:budget
npm run lint
npm run db:verify
npm run eval:smoke
npm run security:secrets
npm run security:audit
npm run bootstrap:fresh-check
```

Additional gate evidence:

- `npm run bundle:budget`: largest JS gzip 112.8 KiB / 140.0 KiB, largest CSS gzip 28.7 KiB / 40.0 KiB, total JS/CSS gzip 141.5 KiB / 190.0 KiB.
- `npm run security:secrets`: no committed secret-looking values found.
- `npm run security:audit`: 0 vulnerabilities after upgrading Vite/Vitest/Wrangler transitive lockfile.
- `npm run d1:preflight` has script-level tests for passing concrete restore evidence, missing backup ref, missing backup location, missing restore database, missing `D1 Restore Verified: yes`, invalid backup-ref shape, and missing `--restore-verified`; a direct run against this report with a fake backup ref correctly refused to pass because no real remote restore evidence exists yet.
- `npm run cloudflare:preflight` is now the executable final gate for Cloudflare staging evidence. It currently fails as expected because Wrangler auth, explicit staging bindings, staging smoke artifacts, WAF/rate-limit rule IDs, and D1 restore markers are not present yet.
- After adding the Cloudflare preflight gate, `npm run typecheck:scripts`, `npm run test:scripts`, and `npm run lint` passed. The gate now rejects example-like staging URLs, toy WAF/rate-limit rule IDs, missing backup-location markers, and placeholder resource IDs.
- After tightening Cloudflare report-evidence validation, `npm run typecheck:scripts` and `npm run test:scripts` passed; `npm run cloudflare:preflight` reports 24 checks, 0 passing, and 24 failing because no real Cloudflare staging evidence exists in this checkout.
- Staging smoke now requires `/admin/sync/status` to accept the staging admin token and return sync/term health arrays, so live staging must prove operator visibility as well as admin/internal auth.
- Staging smoke runner now has script tests for the full expected check list, malformed sync-status bodies, and missing staging env; direct CLI missing-env failures print a concise error instead of a stack trace.
- Cloudflare preflight now requires abuse-control route, action, and threshold evidence in addition to a real-looking WAF or rate-limit rule ID, so a standalone opaque rule ID is not enough to satisfy the public abuse-control requirement.
- Cloudflare preflight now requires separate API and web staging URL evidence plus `Pages Project: uiuc-course-search-web` and `Pages Branch: staging`, so the Pages deployment cannot be skipped while the API worker is green.
- Cloudflare preflight now requires `D1 Restore Verified: yes` as a concrete report label; prose or checklist text mentioning that label does not count.
- Completion audit refresh on 2026-06-01T18:56:59Z reran `npm run typecheck`, the affected hermetic search integration test, `npm run lint`, and `npm run security:secrets`; all passed. GitHub CI passed on `1b5bfbb`. `npm run test:staging`, `npm run eval:staging`, and `npm run cloudflare:preflight` remain auth/evidence-gated because Cloudflare staging/auth evidence is absent.
- Staging deployment commands are now explicit: `npm run deploy:api:staging`, `npm run deploy:web:staging`, and `npm run deploy:staging`. Ambiguous default deploy scripts were removed so a pre-alpha deploy does not accidentally target the wrong Worker or Pages branch.
- Legacy admin sync aliases `/admin/sync/rmp` and `/admin/sync/enrich` and the raw `/admin/debug/link-instructor` diagnostic were removed. Active stale `apps/web/docs/plans` files that pointed at those paths were deleted, and `docs/security-route-matrix.md` now lists the remaining admin/debug surface explicitly.
- Undocumented public DB-count diagnostics `/stats` and `/health/data` were removed; `/` and `/health` are the only public health endpoints. Stale active app-local prompt/plan files were deleted so current guidance lives in README, `docs/plans`, and the release/runbook docs.
- Dead sync timing env vars `SYNC_INTERVAL_MS` and `TERM_CHECK_INTERVAL_MS` were removed from `wrangler.toml` and Worker bindings; active docs now describe the actual `*/5 * * * *` fan-out cron instead of a stale 3-minute rotation.
- The old upstream CISAPI WAF research note was moved from active docs to `docs/archive/analysis/2026-01-cisapi-waf-rules.md`; current public abuse-control guidance now lives only in the Cloudflare hardening runbook, deployment checklist, release checklist, and security matrix.
- Wrangler OAuth is now authenticated, real staging Worker/Pages/D1/KV/Vectorize/AI/service/rate-limit bindings are configured, and the staging Worker is deployed at version `253a0efa-ba4b-40b5-93a2-22e0547a4a6d`.
- `npm run test:staging` passed 8/8 against `https://uiuc-course-search-staging.lumirth.workers.dev`.
- `npm run eval:staging` passed 58/58 against the populated staging D1, with 0 violations and 0 missing expected top results.
- Staging D1 contains 187 subjects, 4,494 current spring 2026 courses, 11,960 sections, 187 complete course sync states, and 0 running course sync locks after a restore-tested Time Travel rollback.
- Public Worker rate limiting is configured for `/api/search*` and `/api/course/*` with route-specific bindings, verified by deploy binding output and hermetic 429 tests.
- `npm run bootstrap:fresh-check`: clones committed `main` into a temp directory, verifies `history_chunks/` and `full_history.sql` are absent/untracked, runs `npm ci`, `npm run db:verify`, and `npm run typecheck`. This caught the ignored baseline migration gap; `apps/api/migrations/0001_initial_schema.sql` is now tracked and byte-identical to `apps/api/src/db/schema.sql`.
- `rg "\.(skip|only)\(|describe\.skip|it\.skip|test\.skip|describe\.only|it\.only|test\.only" ...` found no active skips/only markers outside plan prose.

## Browser QA Evidence

Local QA used:

```bash
npm run qa:mock-api
npm run dev -w @uiuc-course-search/web -- --host 127.0.0.1 --port 5173
```

Browser flows passed with no warning/error console entries reported by Browser dev logs:

- Desktop search success with result evidence: `artifacts/browser-qa/desktop-search-success.png`
- Desktop course detail and sections table: `artifacts/browser-qa/desktop-course-detail.png`
- Desktop empty state: `artifacts/browser-qa/desktop-empty-state.png`
- Desktop API error state: `artifacts/browser-qa/desktop-error-state.png`
- Mobile search success with result evidence: `artifacts/browser-qa/mobile-search-success.png`
- Mobile course detail and horizontal sections overflow: `artifacts/browser-qa/mobile-course-detail.png`

Browser-found fixes completed:

- Removed expected API failure `console.error` noise.
- Added semantic alert/loading states and search input label.
- Removed dead mobile hamburger navigation.
- Fixed clipped match/status badges.
- Added result evidence chips and corrected QA mock evidence.

## Checklist Mapping

| Plan Area | Status | Evidence |
| --- | --- | --- |
| Git checkpoint and hygiene | Complete locally | Multiple coherent commits on `main`; stale side worktree/branch removed after verified backups; latest checked status was clean against `origin/main`. |
| CI/lint/warning debt | Complete | `npm run lint` zero output; private GitHub CI passes on `main` for `1b5bfbb`; CI runs typecheck, schema verification, tests, build, bundle budget, lint, secret scan, audit, eval, and eval artifact upload. |
| Skipped/manual tests | Complete locally | Hermetic Worker search/course integration tests; no active `.skip`. |
| Search contract/evals | Complete locally | `npm run eval:smoke` passes 58/58; staging eval command requires explicit URL. |
| Search explainability/result shape | Complete locally | Shared `MatchEvidence`, `ResultWarning`, `SectionMatchDto`; API attaches evidence; web renders chips; tests cover categories. |
| Browser QA | Complete locally | Browser desktop/mobile screenshots and console checks listed above. |
| Accessibility | Complete locally | `axe-core` web tests for search and course detail pass. |
| Staging deployment | Complete live | Staging API URL: https://uiuc-course-search-staging.lumirth.workers.dev; Staging Web URL: https://staging.uiuc-course-search-web.pages.dev; Pages Project: uiuc-course-search-web; Pages Branch: staging; latest Worker version `253a0efa-ba4b-40b5-93a2-22e0547a4a6d`. |
| Public WAF/rate limits | Complete live | Rate-Limit Namespace IDs: SEARCH_RATE_LIMITER=26060111, COURSE_RATE_LIMITER=26060112; Abuse Control Routes: /api/search*, /api/course/*; Abuse Control Action: Worker Rate Limiting returns 429 JSON block response before public route handlers; Abuse Control Thresholds: /api/search*=120 requests/min/IP, /api/course/*=240 requests/min/IP. |
| D1 backup/restore | Complete live | D1 Backup Ref: 20260601T193901Z; D1 Backup Mechanism: Cloudflare D1 Time Travel; D1 Backup Location: Cloudflare D1 Time Travel bookmark 00000007-00000000-0000507d-803e9baeab336cc69be070cd8a1df251 for ref 20260601T193901Z; D1 Restore Database: course-search-db-staging; D1 Restore Previous Bookmark: 00000007-ffffffff-0000507d-9bc04e5f6e943679bad865737812b752; D1 Restore Verified: yes. |
| Scheduler reliability | Complete locally and live | Structured run IDs/logs added for scheduled paths; tests cover subject stale pruning, enrichment max-batch partial runs, RMP failed/expired-running resume, fresh running-lock rejection, and `/admin/sync/status` health visibility. Live staging smoke verifies authenticated `/admin/sync/status`. |
| Logging/observability | Complete locally | Runtime API logs replaced by structured redacted logger; logger redaction test passes. |
| Frontend rough edges | Complete locally | Empty/error/loading states improved; dead chart already removed; Browser confirms desktop/mobile. |
| Performance/bundle budgets | Complete locally | Vite 8 build has no chunk warning; `bundle:budget` enforced in CI. |
| Docs/release readiness | Complete locally | README, deployment checklist, Cloudflare runbook, security matrix, release checklist, rollback checklist updated. |
| Security review | Complete locally | Route matrix added; auth tests pass; secret scan/audit pass. |
| Data artifact/bootstrap hygiene | Complete locally | `.gitignore` protects generated artifacts while explicitly tracking the canonical baseline migration; `npm run bootstrap:fresh-check` verifies fresh clone bootstrap without `history_chunks/` or `full_history.sql`; remediation report records whole-project backup. |
| Computer Use QA | Not needed | No native Mac UI task was required; Browser/terminal were stronger signals. |
| Completion audit | Complete, not achieved | `docs/reports/2026-06-01-completion-audit.md` maps the active goal requirement-by-requirement and records the remaining auth-dependent gaps. |
| Cloudflare final preflight | Ready for final rerun | `npm run cloudflare:preflight` verifies Wrangler auth, explicit staging bindings, real-looking non-placeholder D1/KV IDs, required staging env vars, staging smoke artifact, real HTTPS API/web staging URL evidence, Pages project/branch evidence, Workers rate-limit namespace/route/action/threshold evidence, backup ref/location evidence, and D1 restore evidence. |

## Cloudflare Live Evidence

Wrangler OAuth is authenticated locally for Cloudflare operations. No Cloudflare API tokens, staging admin tokens, internal tokens, or RMP tokens are committed or printed in this report.

Staging API URL: https://uiuc-course-search-staging.lumirth.workers.dev
Staging Web URL: https://staging.uiuc-course-search-web.pages.dev
Pages Project: uiuc-course-search-web
Pages Branch: staging

Cloudflare staging resources:

- Worker: `uiuc-course-search-staging`
- Worker Version ID: `253a0efa-ba4b-40b5-93a2-22e0547a4a6d`
- D1: `course-search-db-staging` / `76913703-61a0-4b9e-b703-a697135beaf1`
- KV: `GPA_CACHE` / `ad02afba85fb40aa9c7d2abceb15d896`
- Vectorize: `course-embeddings-staging`
- AI binding: `AI`
- SELF service binding: `uiuc-course-search-staging`

Live staging verification:

```bash
npm run deploy:api:staging
# API tests: 34 files / 261 tests
# Deployed uiuc-course-search-staging
# Current Version ID: 253a0efa-ba4b-40b5-93a2-22e0547a4a6d

npm run test:staging
# 8 checks, 8 passing, 0 failed

EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run eval:staging
# 58 queries, 58 passing, 0 violations, 0 missing expected top results
```

Public abuse controls:

Rate-Limit Namespace IDs: SEARCH_RATE_LIMITER=26060111, COURSE_RATE_LIMITER=26060112
Abuse Control Routes: /api/search*, /api/course/*
Abuse Control Action: Worker Rate Limiting returns 429 JSON block response before public route handlers
Abuse Control Thresholds: /api/search*=120 requests/min/IP, /api/course/*=240 requests/min/IP

The rate-limit bindings are visible in the staging deploy output as `SEARCH_RATE_LIMITER (120 requests/60s)` and `COURSE_RATE_LIMITER (240 requests/60s)`. Hermetic Worker tests verify that public search and course requests return 429 before expensive route handlers when Cloudflare's limiter denies the request.

D1 backup and restore evidence:

D1 Backup Ref: 20260601T193901Z
D1 Backup Mechanism: Cloudflare D1 Time Travel
D1 Backup Location: Cloudflare D1 Time Travel bookmark 00000007-00000000-0000507d-803e9baeab336cc69be070cd8a1df251 for ref 20260601T193901Z
D1 Restore Database: course-search-db-staging
D1 Restore Previous Bookmark: 00000007-ffffffff-0000507d-9bc04e5f6e943679bad865737812b752
D1 Restore Verified: yes

The restore test inserted `restore-test-20260601T193901Z` into `app_meta`, restored `course-search-db-staging` to the pre-marker Time Travel bookmark, and verified the marker was gone while the staging dataset remained intact:

```text
subjects=187
courses=4494
sections=11960
complete_syncs=187
marker_count=0
```

## GitHub CI Evidence

GitHub Actions is configured in `.github/workflows/ci.yml` to run the core checks, bundle budget, secret scan, dependency audit, and eval artifact upload. The repository is private:

```bash
gh repo view --json nameWithOwner,url,visibility,defaultBranchRef
# lumirth/uiuc-course-search, PRIVATE, default branch main
```

The first push to the new remote was rejected because old generated artifacts were still reachable in history. After verifying the local backup bundle, history was rewritten to purge those generated payloads and `main` was pushed successfully.

Observed passing runs:

```bash
gh run view 26772167161 --json conclusion,status,url,headSha,createdAt,updatedAt,workflowName,jobs
# conclusion: success
# headSha: de30d2044eb97aaf8dd6b347c56c0185ff9b1ac2
# url: https://github.com/lumirth/uiuc-course-search/actions/runs/26772167161
```

The run completed every configured step successfully: install, typecheck, schema verification, tests, build, bundle budget, lint, secret scan, dependency audit, search smoke eval, and eval report artifact upload.

Latest observed passing run:

```bash
gh run view 26775309432 --json conclusion,status,url,headSha,workflowName,jobs
# conclusion: success
# headSha: 1b5bfbb69d777ca068b2eaf727a548c716ff96f2
# url: https://github.com/lumirth/uiuc-course-search/actions/runs/26775309432
```

This latest run completed the same configured CI gate successfully, including typecheck, schema verification, tests, build, bundle budget, lint, secret scan, dependency audit, search smoke eval, and eval report artifact upload.

## Final Cloudflare Commands

With valid Cloudflare auth present:

```bash
npm run deploy:api:staging
VITE_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run deploy:web:staging
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev STAGING_ADMIN_TOKEN=<redacted> STAGING_INTERNAL_TOKEN=<redacted> npm run test:staging
EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run eval:staging
npm run d1:preflight -- --database course-search-db-staging --backup-ref 20260601T193901Z --evidence-file docs/reports/2026-06-01-stabilization-report.md --restore-verified
npm run cloudflare:preflight
```

## Scheduler Reliability Evidence

Added local coverage after the initial report:

```bash
npm test -w @uiuc-course-search/api -- src/services/__tests__/parallel-sync.test.ts src/services/__tests__/enrichment.test.ts src/services/__tests__/rmp-sync.test.ts src/routes/__tests__/sync-status.test.ts
```

Covered behavior:

- Subject sync stale pruning deletes stale meeting instructors, meetings, sections, GenEd rows, and courses after a successful subject refresh.
- Course GenEd pruning preserves current category/attribute keys and deletes stale keys.
- Enrichment dispatch is capped at 40 batches / 400 tasks per coordinator run and records `partial` progress when more work remains.
- RMP sync rejects a fresh running lock, resumes an expired running lock from its cursor, and resumes failed runs.
- `/admin/sync/status` reports all `sync_state`/`term_state` rows, failed sync states, and currently running sync states for operators.
