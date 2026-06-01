# Stabilization And Hardening Master Plan

Date: 2026-06-01

This plan is the next pass after the pre-alpha remediation checkpoint. The project is pre-alpha, has no users, has no compatibility commitments, and should be treated as greenfield. That means this pass should favor sharp, opinionated cutovers over shims: delete stale paths, replace weak contracts, make warnings fail, and choose one high-quality way to do each thing.

This document has no deferral bucket. If a task needs credentials, a staging target, a Cloudflare setting, a browser session, or a restorable backup, creating that prerequisite is part of the task. An item is done only when the evidence listed under its definition of done exists.

## Operating Principles

1. Commit early on `main` and preserve rollback paths.
   Work directly on `main` as requested. Commit coherent checkpoints frequently. Before risky local or remote actions, create a restorable whole-project or service-specific backup and verify it before proceeding.

2. Prefer real verification over proxy signals.
   Passing unit tests is not enough when the risk is deployment, browser behavior, data restore, auth, or external service integration. Use the narrowest real test that proves the claim.

3. Keep Browser and Computer Use in the loop where they add coverage.
   Use Browser for local and staging web QA, responsive screenshots, console inspection, and user-flow verification. Use Computer Use only for host/native UI actions that cannot be done more reliably through terminal, Browser, or APIs.

4. No hidden warning debt.
   Warnings, skipped tests, stale docs, and TODOs are treated as inventory that must either be fixed or converted into executable tracked work in this plan before the plan can be complete.

5. Cut over aggressively while there are no users.
   Do not keep compatibility layers, legacy endpoint aliases, duplicate schemas, parallel DTOs, optional old behavior, or dead docs for imagined future users. If the clean version is known, cut over and remove the old path in the same change.

6. Harden the product path first.
   The critical path is: install, schema bootstrap, API auth, search, course detail, frontend state, staging deployment, data safety, observability, and release docs.

## Final Definition Of Done

The stabilization pass is complete only when all of these are true:

- The current remediation checkpoint is committed on `main`.
- CI passes on GitHub for `main` with no required check skipped.
- Root `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`, `npm run db:verify`, and `npm run eval:smoke` all pass locally.
- `npm run lint` has zero warnings, not merely zero errors.
- No active test suite uses `.skip`, except tests explicitly moved to a manual QA script or a separate integration command that is run in CI or staging.
- A hermetic local API integration test proves `/api/search` and `/api/course/:subject/:number` through the Worker app without remote auth.
- A staging deployment exists and has passing authenticated admin/internal smoke tests.
- Public read endpoints have documented and verified Cloudflare rate limiting or WAF rules.
- A remote D1 backup/export is created, restore-tested against a non-production target, and documented.
- Browser QA passes on desktop and mobile viewport sizes for search, empty/error states, course detail, and sections overflow.
- Browser console/network inspection shows no unhandled errors during the critical flows.
- Search evals assert filters, residual text, top result expectations, hard-constraint preservation, and no silent relaxation.
- Frontend and backend API DTO compatibility is validated by shared types and at least one browser/API contract smoke.
- Bundle size and runtime performance have an explicit budget and passing check.
- Production and staging secrets are documented by name, not value, and no secret values are committed.
- README, deployment checklist, CLAUDE, and active plans reflect the actual current state.
- The final report includes every command, environment, staging URL, backup location, Browser QA evidence, and residual risk.

## Work Order

1. Commit checkpoint and create review surface.
2. Remove local warning and skip debt.
3. Add hermetic API integration coverage.
4. Harden evals and search explainability.
5. Run local Browser QA and fix visible issues.
6. Prove staging deployment, secrets, auth, WAF/rate limits, and D1 restore.
7. Add performance budgets and observability checks.
8. Complete docs, release notes, and final audit.

---

# 1. Checkpoint, Review, And Git Hygiene

## Problem

The remediation pass touched many files across schema, API, web, tooling, docs, and data artifacts. Without a commit checkpoint on `main`, the project has no stable rollback or review boundary.

## Work

- Stage the full coherent remediation snapshot.
- Commit with a message that names the remediation and artifact cleanup.
- Generate a review summary organized by risk area.
- Confirm `git status --short` is clean after commit.

## Definition Of Done

- `git branch --show-current` returns `main`.
- `git log -1 --stat` shows the full checkpoint commit.
- `git status --short` is empty after commit.
- The final response includes the commit hash.

---

# 2. CI, Lint, And Warning Debt

## Problem

`npm run lint` exits successfully but currently reports `no-explicit-any` warnings. Warnings make it harder to notice real regressions.

## Work

- Replace avoidable `any` types with concrete interfaces, generics, or narrow `unknown` parsing.
- For test mocks, create small typed fake D1, KV, AI, Vectorize, and fetch helpers instead of repeating `as any`.
- Promote `@typescript-eslint/no-explicit-any` from `warn` to `error`.
- Keep generated or third-party interop exceptions as explicit one-line disables with a reason.
- Make CI fail on warnings.

## Definition Of Done

- `npm run lint` exits `0` and reports zero warnings.
- `eslint.config.mjs` treats `no-explicit-any` as an error.
- No blanket file-level disables are present.
- CI runs lint after tests and fails on lint errors.

---

# 3. Skipped And Manual Tests

## Problem

The API still contains a skipped search integration suite that expects a manually running server.

## Work

- Replace `describe.skip` in `apps/api/src/services/__tests__/search.integration.test.ts` with a hermetic integration test that instantiates the Hono app or Worker-compatible handler.
- Seed an in-memory/local test DB with minimal courses, sections, meetings, GenEd, and instructor rows.
- Assert `/api/search?q=CS%20225` returns CS 225 as top result.
- Assert `/api/search` preserves hard filters and rejects bad params through the HTTP route.
- Assert `/api/course/CS/225?term=spring&year=2026` returns the shared `CourseDto` shape.
- Move any truly live-server tests to a separate `npm run test:staging` command.

## Definition Of Done

- `rg "\.skip\(" apps packages scripts` returns no active test skips.
- `npm test` includes API integration coverage without needing Wrangler auth or a live dev server.
- A separate staging test command exists for live deployment checks.

---

# 4. Search Contract And Eval Hardening

## Problem

The Query Language v1 contract is now realistic, but eval coverage is still too shallow for product confidence. The eval runner also records placeholder metadata for tier reached.

## Work

- Add eval assertions for:
  - interpreted hard filters
  - interpreted soft preferences
  - residual topical text
  - top result or reciprocal-rank expectations
  - hard-constraint preservation for semantic and keyword candidates
  - no silent relaxation in primary results
  - term metadata presence
- Expose actual tier/fallback behavior in `SearchResponseDto.meta` instead of `tierReached: 0`.
- Add golden cases for unsupported fields, unsupported dash negation, quoted phrases, term syntax, `gened:any`, `gened:all`, `not online`, and `no exams`.
- Add a staging eval command that runs against a deployed URL and fails on invariant violations.
- Save a concise eval report artifact in CI.

## Definition Of Done

- `npm run eval:smoke` checks more than the golden unit file.
- `npm run eval:staging` exists and requires an explicit base URL.
- Eval output includes pass/fail counts, reciprocal-rank summary, invariant violations, and query IDs.
- No placeholder `TODO` metadata remains in the eval runner.

---

# 5. Search Explainability And Result Shape

## Problem

The current API exposes query-level evidence, but rich per-result `MatchEvidence` and section-grain result details are still future work. Users need to know why a result matched.

## Work

- Define `MatchEvidence`, `ResultWarning`, and section-grain result types in `packages/query-types`.
- Add result evidence for:
  - course code/title match
  - subject/number/CRN match
  - GenEd match
  - schedule and delivery match
  - instructor match
  - topic/alias/semantic match
  - difficulty/quality preference fit
- Render concise evidence chips or rows in search results.
- Add tests that evidence is present for representative queries.
- Ensure evidence never exposes raw internal SQL or secret data.

## Definition Of Done

- Shared DTOs include evidence types used by both API and web.
- Search route responses include evidence for every returned result.
- Web renders evidence without crowding mobile results.
- Tests cover at least five evidence categories.

---

# 6. Browser QA For Local Web App

## Problem

Unit tests cover state changes, but they do not prove the app feels right or works in real browser layouts.

## Work

- Start local API and web dev servers with known ports.
- Use Browser to run the critical flows:
  - home/search initial load
  - query success
  - query with invalid params or API error
  - empty results
  - course detail load
  - term/year navigation
  - sections table horizontal overflow
  - mobile viewport search and course detail
- Capture screenshots for desktop and mobile.
- Inspect browser console and network logs for unhandled errors.
- Fix text overflow, clipped content, unstable loading states, and console errors.

## Definition Of Done

- Browser screenshots are saved or attached in the final report.
- Desktop and mobile critical flows pass.
- Browser console has no unhandled application errors during those flows.
- Any browser-only bugs found are fixed and covered by tests where practical.

---

# 7. Accessibility And Keyboard UX

## Problem

The current web tests do not prove keyboard navigation, focus handling, labels, or screen-reader affordances.

## Work

- Add accessible labels and stable test IDs where needed.
- Verify search form can be used by keyboard only.
- Verify course links, buttons, badges, alerts, and loading states are semantically clear.
- Run automated accessibility checks in browser-based tests.
- Add regression tests for focus and aria-visible error states.

## Definition Of Done

- Search and course detail pass automated accessibility checks.
- Keyboard-only navigation reaches all primary controls.
- Loading and error states are announced or semantically represented.

---

# 8. Staging Deployment

## Problem

Local verification is green, but Cloudflare deployment behavior is unproven after auth, schema, and routing changes.

## Work

- Create or identify staging Worker and Pages targets.
- Configure staging bindings for D1, KV, Vectorize, AI, service binding, and required token secrets.
- Deploy API and web from `main`.
- Verify staging `/health`, `/api/search`, and `/api/course/:subject/:number`.
- Verify unauthenticated `/admin/*` and `/internal/*` reject requests.
- Verify authenticated admin status endpoints work with staging tokens.
- Run `npm run eval:staging` against staging.

## Definition Of Done

- Staging URLs are documented.
- Staging deploy commands are reproducible.
- Staging smoke tests pass and are recorded.
- No production secret values are exposed in logs, docs, or commits.

---

# 9. Public Abuse Controls

## Problem

The in-app upstream backoff protects external sources, not public caller floods. Public abuse controls still need platform proof.

## Work

- Configure Cloudflare WAF or route-level rate limiting for public read endpoints.
- Add explicit policy for `/api/search` and `/api/course/*`.
- Confirm `/admin/*` and `/internal/*` remain token-protected regardless of WAF.
- Document thresholds and expected user impact.
- Add a non-destructive smoke check for rate-limit headers or WAF behavior where possible.

## Definition Of Done

- Deployment checklist names the actual configured rules.
- Staging or production dashboard evidence exists.
- Public endpoints have bounded abuse protection outside app-local upstream backoff.

---

# 10. D1 Backup, Restore, And Migration Safety

## Problem

Local schema bootstrap is verified, but remote D1 backup/restore has not been exercised.

## Work

- Create a remote D1 backup/export for staging.
- Restore it to a separate non-production D1 database.
- Run schema/version checks against the restored database.
- Document exact commands and backup location.
- Add a preflight script for destructive D1 operations that refuses to proceed without a verified backup reference.

## Definition Of Done

- A restore-tested D1 backup exists.
- Restore verification output is in the final report.
- Destructive D1 commands have a documented backup preflight.

---

# 11. Sync, Enrichment, And Scheduler Reliability

## Problem

Sync and enrichment are safer now, but scheduled behavior and overlap prevention need staging proof.

## Work

- Add tests for subject sync stale pruning after successful sync.
- Add tests for enrichment max batch behavior across multiple runs.
- Add tests for RMP running-lock expiry and failed-run resume.
- Run scheduled-handler smoke locally or in staging for:
  - term discovery
  - active-term sync fan-out
  - GPA chunk resume
  - enrichment coordination
  - RMP sync with staging token
- Add structured status endpoint or admin report for last sync health.

## Definition Of Done

- Scheduler paths have automated coverage or staging smoke evidence.
- Overlap prevention is observable through `sync_state`.
- Failed and resumed runs are covered by tests.

---

# 12. Logging And Observability

## Problem

Raw search logging was removed, but normal operational logging is still unstructured and noisy in scheduled paths.

## Work

- Replace ad hoc production `console.log` calls with a small structured logger helper.
- Redact tokens, raw auth headers, and sensitive query-like payloads.
- Add request IDs or run IDs for admin and scheduled workflows.
- Add concise success/failure metrics to sync, enrichment, RMP, and search eval paths.
- Keep CLI scripts allowed to print human-readable progress.

## Definition Of Done

- Runtime logs are structured and redact sensitive fields.
- Search execution does not log raw user query details in normal production paths.
- Scheduler logs include run IDs and terminal statuses.

---

# 13. Frontend Product Rough Edges

## Problem

The UI is usable but still has product-level gaps and unfinished context features.

## Work

- Implement department-context data for the course quadrant chart or remove the empty comparison state.
- Add clear empty states for no sections, no scores, no instructor links, and no results.
- Add result evidence display once API evidence exists.
- Add loading skeletons that do not shift layout.
- Verify mobile spacing and table overflow with Browser screenshots.
- Keep the UI operational rather than turning it into a landing page.

## Definition Of Done

- No TODO remains in active frontend code.
- Browser QA confirms mobile and desktop layouts.
- Course detail does not show misleading empty comparison visuals.

---

# 14. Performance And Bundle Budgets

## Problem

The web build succeeds but emits a large-chunk warning.

## Work

- Inspect Vite bundle output.
- Split heavy routes or chart dependencies if needed.
- Set a bundle budget that fails CI when exceeded.
- Measure search page and course page initial load in Browser.
- Confirm API search performance on seeded local data and staging data.

## Definition Of Done

- `npm run build` emits no chunk-size warning, or an explicit budget is configured and passing.
- CI enforces bundle or asset budgets.
- Browser performance smoke is recorded for primary flows.

---

# 15. Documentation And Release Readiness

## Problem

Docs were cleaned up, but the next release needs exact operational steps, not just architecture notes.

## Work

- Update README with current artifact, staging, and command state.
- Update deployment checklist with actual staging URLs, token names, WAF rules, backup commands, and smoke commands.
- Add a release checklist for pre-alpha demo readiness.
- Add a rollback checklist for API, web, D1, and generated artifacts.
- Keep archived docs clearly out of the active path.

## Definition Of Done

- A new final stabilization report exists.
- Active docs are accurate after staging proof.
- A new developer can run install, test, local dev, staging smoke, and rollback from docs alone.

---

# 16. Security Review

## Problem

Auth boundaries now exist, but they need a focused security review before any public demo.

## Work

- Review all routes and classify them in a table.
- Confirm CORS applies only to intended public routes.
- Confirm admin/internal middleware wraps every mutation route.
- Confirm service-binding internal requests always include the internal token.
- Confirm no committed secret values exist.
- Confirm debug routes cannot perform arbitrary fetches or mutations beyond documented diagnostics.
- Add a script or test that enumerates route classes where practical.

## Definition Of Done

- Security route matrix exists in docs.
- Automated route auth tests cover representative admin/internal/debug paths.
- Secret scan command passes.

---

# 17. Data Artifact And Bootstrap Hygiene

## Problem

Generated historical files are now local-only, but bootstrap and regeneration workflows must remain clear.

## Work

- Verify fresh clone behavior without local `history_chunks/` or `full_history.sql`.
- Add docs for restoring local data artifacts from the backup if needed.
- Add explicit command for regenerating historical CSV/SQL artifacts.
- Ensure generated artifacts cannot be accidentally committed.
- Consider a manifest file that records artifact provenance without storing artifact payloads.

## Definition Of Done

- Fresh clone test passes without large local artifacts.
- `.gitignore` protects generated SQL and history chunks.
- Artifact provenance is documented without committing payloads.

---

# 18. Computer Use QA Runbook

## Problem

Some verification may require native Mac UI or user-visible application state that terminal and Browser cannot prove.

## Work

- Use Computer Use only when a native UI task is required, such as inspecting browser windows outside the in-app Browser, Finder-visible artifacts, or local app state.
- Prefer terminal and Browser for everything else.
- Before any risky UI action, follow the Computer Use confirmation policy.
- Record screenshots or observations in the final report when Computer Use is used.

## Definition Of Done

- Any Computer Use actions are listed with purpose and result.
- No risky UI action is performed without the required confirmation.

---

# Implementation Checklist

## Git And Review

- [ ] Confirm work is on `main`.
- [ ] Commit remediation checkpoint on `main`.
- [ ] Confirm clean git status after commit.
- [ ] Prepare review summary grouped by risk area.

## Local Quality Gates

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run lint` passes with zero warnings.
- [ ] `npm run db:verify` passes.
- [ ] `npm run eval:smoke` passes.
- [ ] No active `.skip` tests remain.

## Integration And Evals

- [ ] Add hermetic API integration tests.
- [ ] Add staging integration command.
- [ ] Expand Query Language eval assertions.
- [ ] Remove placeholder eval metadata.
- [ ] Save eval report artifact in CI.

## Browser QA

- [ ] Start local API and web servers.
- [ ] Verify desktop search flow with Browser.
- [ ] Verify mobile search flow with Browser.
- [ ] Verify course detail and sections overflow with Browser.
- [ ] Inspect browser console and network logs.
- [ ] Save Browser screenshots or report evidence.

## Staging And Cloudflare

- [ ] Configure staging Worker and Pages targets.
- [ ] Configure staging D1, KV, Vectorize, AI, and service bindings.
- [ ] Configure `ADMIN_TOKEN`, `INTERNAL_TOKEN`, and `RMP_AUTH_TOKEN` for staging.
- [ ] Deploy API and web to staging.
- [ ] Run staging auth smoke tests.
- [ ] Run staging search/course smoke tests.
- [ ] Configure and verify public WAF/rate limits.

## Data Safety

- [ ] Create remote D1 backup/export.
- [ ] Restore backup to non-production D1.
- [ ] Verify restored schema and data.
- [ ] Document backup and restore commands.
- [ ] Add destructive-operation preflight.

## Product And Frontend

- [ ] Implement or remove empty quadrant chart context.
- [ ] Add result match evidence UI.
- [ ] Add polished empty/error/loading states.
- [ ] Pass accessibility checks.
- [ ] Resolve build chunk warning or enforce explicit budget.

## Security And Observability

- [ ] Create route security matrix.
- [ ] Add or update route auth tests.
- [ ] Add secret scan.
- [ ] Replace runtime ad hoc logs with structured redacted logging.
- [ ] Add sync/enrichment/RMP health visibility.

## Docs And Release

- [ ] Update README.
- [ ] Update deployment checklist with real staging evidence.
- [ ] Add pre-alpha release checklist.
- [ ] Add rollback checklist.
- [ ] Add final stabilization report.

---

# Required Final Verification Commands

```bash
npm run typecheck
npm test
npm run build
npm run lint
npm run db:verify
npm run eval:smoke
npm run test:staging
npm run eval:staging
```

Browser verification must also be run and recorded for the final pass. The stabilization effort is not complete until both command-line checks and Browser-observed user flows pass.
