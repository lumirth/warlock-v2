# Stabilization Report

Date: 2026-06-01

Scope: harden `main` according to `docs/plans/2026-06-01-stabilization-hardening-master-plan.md`, treating the project as pre-alpha/no-users/greenfield software.

## Current Git Checkpoints

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
- Completion audit refresh on 2026-06-01T17:59:16Z reran `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`, `npm run db:verify`, `npm run eval:smoke`, `npm run bundle:budget`, `npm run security:secrets`, and `npm run security:audit`; all passed. `npm run test:staging`, `npm run eval:staging`, and `npm run cloudflare:preflight` failed only because Cloudflare staging/auth evidence is absent.
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
| CI/lint/warning debt | Complete | `npm run lint` zero output; private GitHub CI passes on `main` for `de30d20`; CI runs typecheck, schema verification, tests, build, bundle budget, lint, secret scan, audit, eval, and eval artifact upload. |
| Skipped/manual tests | Complete locally | Hermetic Worker search/course integration tests; no active `.skip`. |
| Search contract/evals | Complete locally | `npm run eval:smoke` passes 58/58; staging eval command requires explicit URL. |
| Search explainability/result shape | Complete locally | Shared `MatchEvidence`, `ResultWarning`, `SectionMatchDto`; API attaches evidence; web renders chips; tests cover categories. |
| Browser QA | Complete locally | Browser desktop/mobile screenshots and console checks listed above. |
| Accessibility | Complete locally | `axe-core` web tests for search and course detail pass. |
| Staging deployment | Blocked by auth | `npx wrangler whoami` failed: not logged in; `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_ID` unset. Final preflight requires both API and Pages evidence. |
| Public WAF/rate limits | Blocked by auth | Runbook and deployment checklist specify rules/thresholds; dashboard/API verification requires Cloudflare auth. |
| D1 backup/restore | Blocked by auth for remote proof | `d1:preflight` added and covered by script tests; exact export/restore commands documented. Remote export/restore requires Cloudflare auth. |
| Scheduler reliability | Complete locally; live staging smoke blocked by auth | Structured run IDs/logs added for scheduled paths; tests cover subject stale pruning, enrichment max-batch partial runs, RMP failed/expired-running resume, fresh running-lock rejection, and `/admin/sync/status` health visibility. Live staging scheduler smoke requires Cloudflare auth. |
| Logging/observability | Complete locally | Runtime API logs replaced by structured redacted logger; logger redaction test passes. |
| Frontend rough edges | Complete locally | Empty/error/loading states improved; dead chart already removed; Browser confirms desktop/mobile. |
| Performance/bundle budgets | Complete locally | Vite 8 build has no chunk warning; `bundle:budget` enforced in CI. |
| Docs/release readiness | Complete locally | README, deployment checklist, Cloudflare runbook, security matrix, release checklist, rollback checklist updated. |
| Security review | Complete locally | Route matrix added; auth tests pass; secret scan/audit pass. |
| Data artifact/bootstrap hygiene | Complete locally | `.gitignore` protects generated artifacts while explicitly tracking the canonical baseline migration; `npm run bootstrap:fresh-check` verifies fresh clone bootstrap without `history_chunks/` or `full_history.sql`; remediation report records whole-project backup. |
| Computer Use QA | Not needed | No native Mac UI task was required; Browser/terminal were stronger signals. |
| Completion audit | Complete, not achieved | `docs/reports/2026-06-01-completion-audit.md` maps the active goal requirement-by-requirement and records the remaining auth-dependent gaps. |
| Cloudflare final preflight | Added, currently red by design | `npm run cloudflare:preflight` verifies Wrangler auth, explicit staging bindings, real-looking non-placeholder D1/KV IDs, required staging env vars, staging smoke artifact, real HTTPS API/web staging URL evidence, Pages project/branch evidence, real-looking WAF/rate-limit ID plus route/action/threshold evidence, backup ref/location evidence, and D1 restore evidence. |

## Cloudflare Auth Blocker

Remote staging, WAF/rate-limit verification, and remote D1 restore testing are not complete because the local Cloudflare auth path is unavailable:

```bash
cd apps/api
npx wrangler whoami
# Failed to fetch auth token: 400 Bad Request
# Not logged in.
```

Non-printing env check:

```bash
CLOUDFLARE_API_TOKEN=unset
CF_API_TOKEN=unset
CLOUDFLARE_ACCOUNT_ID=unset
CF_ACCOUNT_ID=unset
```

GitHub repository secret and variable name checks also returned no configured entries:

```bash
gh secret list --repo lumirth/uiuc-course-search
gh variable list --repo lumirth/uiuc-course-search
# no output
```

No secret values were exposed or committed.

Wrangler OAuth was attempted with `npx wrangler login --browser=false`. The flow reached a GitHub permission grant asking to authorize Cloudflare to read the `lumirth` account's email address and redirect to `https://oidc.iam.cfapi.net`. That account-permission grant requires user action, so the local OAuth listener was stopped and no Cloudflare token was created or committed.

Current Cloudflare evidence gate:

```bash
npm run cloudflare:preflight
# 30 checks, 0 passing, 30 failing
# Missing: Wrangler auth, env.staging bindings, staging env vars, staging smoke artifact,
# API/web staging URL evidence, Pages project/branch evidence, WAF/rate-limit rule ID/route/action/threshold evidence, D1 backup location, and D1 restore evidence.
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

## Next Auth-Dependent Commands

After valid Cloudflare auth is present:

```bash
npx wrangler whoami
npm run deploy:api -- --env staging
VITE_API_BASE_URL=https://<staging-worker-host> npm run build -w @uiuc-course-search/web
npx wrangler pages deploy apps/web/dist --project-name uiuc-course-search-web --branch staging
STAGING_API_BASE_URL=https://<staging-worker-host> STAGING_ADMIN_TOKEN=<redacted> STAGING_INTERNAL_TOKEN=<redacted> npm run test:staging
EVAL_BASE_URL=https://<staging-worker-host> npm run eval:staging
```

Then create and restore-test the staging D1 backup using `docs/cloudflare-hardening-runbook.md`, configure public WAF/rate-limit rules, and append the rule IDs/backup path/restore output to this report.

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
