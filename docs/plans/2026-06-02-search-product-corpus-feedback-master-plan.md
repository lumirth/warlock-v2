# Search Product, Corpus, And Feedback Master Plan

Date: 2026-06-02

This project is pre-alpha, has no users, and has no compatibility obligations. Treat it as greenfield software. This pass should make sharp, opinionated cutovers: one public search contract, one canonical query-plan shape, one feedback path, one data freshness story, one high-quality UI language, and one evidence standard. Do not preserve duplicate behavior, warning-tolerant tooling, hidden debug copy, stale docs, or compatibility shims for imagined users.

There is no deferral bucket. If a task needs a backup, staging credential, browser session, Cloudflare check, corpus artifact, or test harness, creating and verifying that prerequisite is part of the task.

## Final Definition Of Done

The pass is complete only when every item below has concrete evidence in the final report:

- The current branch is `main`, the worktree is clean, and all coherent checkpoints are committed and pushed.
- GitHub CI on `main` passes with no required check skipped.
- Root `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`, `npm run db:verify`, and `npm run eval:smoke` pass locally; lint reports zero warnings.
- `rg "\.skip\(" apps packages scripts` finds no active skipped tests.
- Search Product Contract v2 is documented and implemented through shared types used by API and web.
- A typed query/eval corpus covers instructor, course, GenEd, schedule, semester, score, ambiguity, and natural-language failure cases.
- Corpus/eval tests include professor-name searches such as `professor fagen`, `prof fagen`, `with wade`, lowercase instructor names, hyphenated/apostrophe names, and ambiguous instructor queries.
- Hermetic API integration tests cover search, course detail, feedback submission, feedback rejection, and data-refresh status paths without requiring Wrangler auth or a live dev server.
- Frontend DTO/state tests cover editable search chips, clickable disambiguation alternatives, advanced search controls, contradictory filter/query edits, historical-result de-emphasis, feedback submission states, public score labels, Rate My Professors fallback links, and Course Explorer links.
- Browser and Computer QA cover desktop and mobile search, course detail, score surfaces, sections overflow, advanced search, clickable alternatives, feedback, console inspection, and network inspection.
- Staging deploy smoke tests cover auth, search, course detail, feedback, public rate limits/WAF behavior, Rate My Professors link behavior, Course Explorer links, and data-refresh status.
- D1 backup/export and restore paths are verified against a non-production target before destructive D1 actions.
- The searchable course corpus uses a rolling full-detail retention policy. Full history back to 2004 is no longer expected in D1; retained terms must be complete, currently registrable terms must be pinned and prioritized, and dropped terms must be intentionally absent.
- Current, upcoming, and retained historical semester freshness evidence exists, including GPA and rating refresh cadence.
- Bundle and performance budgets are defined and passing.
- README, release checklist, rollback docs, data-refresh docs, active plans, and final stabilization report reflect the real state.
- No secret values are committed or exposed.

## Prompt-To-Artifact Checklist

| Requirement | Artifact Or Evidence |
| --- | --- |
| Pre-alpha, no users, greenfield cutovers | This plan, implementation commits, deleted duplicate paths, docs stating no compatibility obligations |
| Search Product Contract v2 | `docs/plans/2026-06-02-search-product-corpus-feedback-master-plan.md`, shared DTOs in `packages/query-types`, API/web tests |
| Comprehensive query/eval corpus | Typed corpus files, generated official subject-name aliases, typo-tolerant subject cases, grouped topic synonym/acronym cases, eval runner assertions, CI/local `npm run eval:smoke` output |
| Instructor/professor search | Extractor/resolver tests, corpus cases, API integration tests, Browser QA queries |
| Low-friction feedback | Migration/schema, API route, frontend UI, triage/report docs, feedback tests |
| Feedback-to-eval path | Feedback triage docs/script or admin route, duplicate-grouped export/candidate workflow, corpus promotion workflow, tests |
| Editable badges/search chips | Shared query-plan state, SearchPage controls, frontend state tests, Browser QA |
| Clickable "maybe you meant" alternatives | API ambiguity DTOs, SearchPage buttons, URL/state round-trip tests |
| Advanced search mode | Public controls for term, subject, GenEd, schedule, credits, online/status, instructor, difficulty/quality; typed free text remains separate from structured filters, and contradictory filter edits clear stale structured words from the search box |
| Public-facing copy | Search/course UI copy tests and Browser screenshots without debug timing or `n=` copy |
| Historical result prominence | Historical cards are visually de-emphasized, and the `Historical` badge appears next to the term before credits/instructors |
| Rate My Professors links | Real public URL or safe search fallback generation, tests and Browser QA |
| Course Explorer links | Course and section official links, tests and Browser QA |
| Automated freshness | Scheduled/sync docs, status route or script evidence, tests for current/upcoming/retained-historical paths |
| Rolling retained corpus | Semester maintenance preflight bundle, retention plan, D1 backup/restore proof, prune evidence, retained-term coverage audit, dropped-term absence audit; no requirement to search every term back through 2004 |
| GPA/rating refresh | Sync-state evidence, cadence docs, smoke checks |
| Code quality | Module boundaries, lint zero warnings, typecheck/tests/build pass |
| Backup before risky actions | Backup command output, restore test evidence, rollback docs |
| Staging and Cloudflare proof | Staging smoke output, auth checks, WAF/rate-limit evidence |
| Final completion audit | `docs/reports/*final-stabilization-report.md` with item-by-item evidence |

## Work Order

1. **Contract And Planning Checkpoint**
   - Commit this plan.
   - Define Search Product Contract v2 in shared types.
   - Name the canonical query state that both natural-language search and advanced controls use.

2. **Corpus And Eval Foundation**
   - Move from a small golden list to typed corpus groups.
   - Add expected filters, residual text, top-result hints, ambiguity expectations, user-facing chips, and invariant checks.
   - Include instructor, score, schedule, term, GenEd, course-code, ambiguous, unsupported, and adversarial language.

3. **Instructor Search Cutover**
   - Make instructor extraction case-insensitive after trigger words.
   - Support professor/prof/dr/with/by/taught by, last-name-only, first+last, initials where practical, apostrophes, and hyphens.
   - Resolve ranked instructor candidates and expose ambiguity when multiple candidates are plausible.
   - Preserve hard instructor constraints in search results.

4. **Feedback Foundation**
   - Add feedback DTOs and D1 schema.
   - Add public feedback submit route with validation, spam/rate-limit posture, and no secret exposure.
   - Add frontend feedback controls for search, result, score, and link/data issues.
   - Add a triage workflow that can promote confirmed feedback into corpus fixtures.

5. **Editable Search UI**
   - Replace passive extraction badges with public search chips.
   - Chips can be removed or adjusted through one canonical state.
   - Clickable ambiguity alternatives update the query state and rerun search.
   - Advanced search mode edits the same query state, not a second path.
   - The search box represents free-text/topic terms. Advanced controls own structured filters; additive filters preserve free text, while contradictory edits clear stale structured text.

6. **Public Course Experience**
   - Remove debug timing and internal labels from default UI.
   - Replace `n=` with student-facing sample copy.
   - Replace technical badges with digestible score, workload, GPA, rating, and evidence labels.
   - Make historical results visibly quieter than active/registrable results and place the historical status beside the term label.
   - Add official Course Explorer links for courses and sections.
   - Replace broken Rate My Professors direct links with verified public URLs or safe search fallbacks.

7. **Freshness And Operations**
   - Document and test current/upcoming/historical term coverage.
   - Use `npm run data:semester:plan` as the recurring read-only semester preflight before prune, backfill, or promotion decisions.
   - Prove scheduled term discovery, course sync, GPA refresh, rating refresh, and enrichment paths.
   - Add status evidence and stale-data behavior.
   - Verify D1 backup/export/restore before destructive data work.

8. **Quality Gates And Final Audit**
   - Run all local commands and fix failures.
   - Run Browser/Computer QA for desktop and mobile.
   - Deploy and smoke staging.
   - Push `main`, wait for GitHub CI, and write the final stabilization report mapping every checklist item to evidence.

## Stop Conditions

Continue without user review whenever a reversible decision is available. Stop only when required credentials or external service access remain unavailable after retry, an action would expose secret values, or a legal/ToS constraint prevents implementation or verification.
