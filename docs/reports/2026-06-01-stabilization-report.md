# Stabilization Report

Date: 2026-06-01

Scope: harden `main` according to `docs/plans/2026-06-01-stabilization-hardening-master-plan.md`, treating the project as pre-alpha/no-users/greenfield software.

## Current Git Checkpoints

- `428de48` - Complete pre-alpha remediation checkpoint
- `627c133` - Harden local integration and remove dead chart
- `da0b135` - Enforce zero-warning lint gate
- `5cafd55` - Harden query eval gates
- `b1d94d0` - Harden Browser QA flows
- `ae28d72` - Add search result evidence DTOs
- `4a00fc8` - Enforce budgets security and structured logs
- `fb12fe4` - Document stabilization operations and blockers
- `2b2a0da` - Record external CI blocker
- `dfa828e` - Harden scheduler reliability coverage
- `6b597aa` - Verify fresh clone bootstrap

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
- `npm run d1:preflight` has script-level tests for passing restore evidence, missing backup markers, and missing `--restore-verified`; a direct run against this report with a fake backup ref correctly refused to pass because no real remote restore evidence exists yet.
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
| Git checkpoint and hygiene | Complete locally | Multiple coherent commits on `main`; clean status required before final. |
| CI/lint/warning debt | Complete locally; GitHub run blocked by missing remote | `npm run lint` zero output; CI runs lint, bundle budget, secret scan, audit, eval. `git remote -v` produced no remote, and `gh repo view` returned no repo context. |
| Skipped/manual tests | Complete locally | Hermetic Worker search/course integration tests; no active `.skip`. |
| Search contract/evals | Complete locally | `npm run eval:smoke` passes 58/58; staging eval command requires explicit URL. |
| Search explainability/result shape | Complete locally | Shared `MatchEvidence`, `ResultWarning`, `SectionMatchDto`; API attaches evidence; web renders chips; tests cover categories. |
| Browser QA | Complete locally | Browser desktop/mobile screenshots and console checks listed above. |
| Accessibility | Complete locally | `axe-core` web tests for search and course detail pass. |
| Staging deployment | Blocked by auth | `npx wrangler whoami` failed: not logged in; `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_ID` unset. |
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

No secret values were exposed or committed.

## GitHub CI Blocker

GitHub Actions is configured in `.github/workflows/ci.yml` to run the core checks, bundle budget, secret scan, dependency audit, and eval artifact upload. Passing CI on `main` could not be proven from this checkout because no Git remote is configured:

```bash
git remote -v
# no output

gh repo view --json nameWithOwner,url
# no repository context
```

No push or PR could be made without a repository remote.

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
