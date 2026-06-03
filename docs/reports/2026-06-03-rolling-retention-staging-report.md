# Rolling Retention Staging Report

Date: 2026-06-03

Scope: replace the pre-alpha full-history storage assumption with a rolling, full-detail staging corpus. The project is still no-users, greenfield software, so the implementation favors sharp cutovers over compatibility shims: keep complete recent terms with sections, meetings, and instructors; drop old terms entirely when they fall outside the budget.

## Product Decision

The average user does not need direct search coverage for 2004-era catalog data, while missing sections for current and recent terms is actively harmful. The staging data policy is now:

- Keep all retained terms complete: courses, sections, meetings, meeting instructors, instructor links, gen-ed links, and sync state.
- Pin all currently registrable or active terms before historical terms.
- Prefer fall and spring history over winter and summer when deciding the rolling window, while still retaining winter and summer terms that fit.
- Stop at the oldest term that fits the contiguous rolling window instead of using leftover space for tiny older terms.
- Treat dropped terms as intentionally absent, not stale or partially synced.

## Code Checkpoints

Committed on `main`:

- `828e658` - Add rolling term retention planner
- `7bdc1f6` - Preserve contiguous term retention window
- `3d84b00` - Generate D1-compatible retention prune SQL
- `535e9f2` - Prioritize pinned terms in retention coverage

The tooling added or updated:

- `npm run data:term-retention`
- `scripts/term-retention-plan.ts`
- `scripts/term-coverage-plan.ts`
- `scripts/data-freshness-audit.ts`
- `docs/data-refresh-runbook.md`

Focused local verification passed before staging execution:

- `npm run typecheck:scripts`
- `npx vitest run scripts/__tests__/term-retention-plan.test.ts`
- `npx vitest run scripts/__tests__/term-retention-plan.test.ts scripts/__tests__/term-coverage-plan.test.ts`

## Backup Evidence

Before destructive staging D1 pruning, Cloudflare D1 Time Travel was captured and restore-tested:

- Database: `course-search-db-staging`
- Backup ref: `20260603T002001Z`
- Bookmark: `00000053-0000000c-0000507f-4280b9000abfda2a945d5d5b4cc31cc6`
- Evidence: `artifacts/d1-backups/20260603T002001Z-pre-retention-prune/evidence.md`
- Preflight: `npm run d1:preflight -- --database course-search-db-staging --backup-ref 20260603T002001Z --evidence-file artifacts/d1-backups/20260603T002001Z-pre-retention-prune/evidence.md --restore-verified`

The same-state restore verified that the database could be rolled back before pruning. No secret values were written to the backup evidence.

## Retention Plan

Plan artifact: `artifacts/retention/staging-term-retention-plan-20260603T001425Z.json`

Input state:

- Available terms discovered: 79
- Pre-prune D1 size: 500,002,816 bytes
- Pre-prune courses: 103,718
- Pre-prune sections: 266,621
- Pre-prune meetings: 284,236
- Pre-prune meeting instructors: 336,931

Retention output:

- Retained terms: 18
- Dropped terms: 61
- Pinned registrable terms: 2
- Historical terms retained: 16

Retained terms, in execution priority:

1. `2026-fall` registrable
2. `2026-summer` registrable
3. `2026-spring`
4. `2025-fall`
5. `2025-spring`
6. `2024-fall`
7. `2026-winter`
8. `2024-spring`
9. `2025-summer`
10. `2023-fall`
11. `2025-winter`
12. `2023-spring`
13. `2024-summer`
14. `2022-fall`
15. `2024-winter`
16. `2022-spring`
17. `2023-summer`
18. `2021-fall`

## Prune Evidence

Prune artifact: `artifacts/retention/staging-retention-prune-20260603T002001Z.json`

The generated SQL file was D1-compatible after removing explicit transaction wrappers, but Cloudflare repeatedly returned `D1_RESET_DO` for uploaded-file execution after the restore test. The prune was then executed as bounded direct `wrangler d1 execute --command` chunks against the same generated dropped-term set.

Post-prune verification:

- Dropped term states: 0
- Dropped courses: 0
- Dropped sections: 0
- Dropped instructor links: 0
- Dropped sync states: 0
- Orphan meetings: 0
- Orphan meeting instructors: 0
- Retained terms: 18
- All terms: 18

Post-prune state:

- D1 size: 100,687,872 bytes
- Courses: 15,696
- Sections: 39,924
- Meetings: 42,387
- Meeting instructors: 51,633
- Sync states: 894

## Backfill Evidence

The retained corpus was then backfilled in priority order, with 2026 Fall and 2026 Summer first because both were registrable.

Backfill artifacts:

- Initial retained coverage run: `artifacts/backfill/retained-coverage-20260603T002001Z.json`
- `2024-spring` resume run: `artifacts/backfill/2024-spring-resume-20260603T002001Z.json`
- Remaining retained coverage run: `artifacts/backfill/retained-coverage-remaining-20260603T004452Z.json`

Execution notes:

- `2026-fall`, `2026-summer`, `2026-spring`, `2025-fall`, `2025-spring`, `2024-fall`, and `2026-winter` completed in the first run.
- `2024-spring` was resumed from offset 80 with page size 1 and completed all remaining subjects.
- The remaining ten retained terms completed in a second coverage run.
- Final retained-term backfill had zero failed pages and zero skipped pages.

## Final Staging State

Final coverage artifact: `artifacts/retention/staging-term-coverage-post-backfill-20260603T010000Z.json`

Final freshness artifact: `artifacts/retention/staging-freshness-audit-post-backfill-20260603T010000Z.json`

Final coverage result:

- Available terms: 79
- Retained terms: 18
- Dropped terms: 61
- Present retained terms: 18
- Missing retained terms: 0
- Stale retained terms: 0
- Terms needing backfill: 0

Final freshness result:

- Checks: 14 passing, 0 failing
- Current term resolved by API: `2026-fall`
- Registrable terms: `2026-fall`, `2026-summer`
- Active terms: none
- Historical retained terms: 16
- Dropped-term absence: 61 dropped terms absent
- GPA sync state: completed
- RMP sync state: complete

Final D1 counts:

- D1 size: 373,202,944 bytes
- Terms: 18
- Courses: 53,987
- Sections: 138,634
- Meetings: 146,938
- Meeting instructors: 194,770
- Sync states: 2,778
- Registrable terms: 2
- Historical terms: 16

## Auth Note

Cloudflare Worker secrets are write-only. A generated `ADMIN_TOKEN` can be set and used for smoke tests, but Wrangler cannot read it back later. During this run, staging `ADMIN_TOKEN` was rotated from `apps/api`, held only in the local operator environment for the active backfill session, and never printed or committed. Future semester runs should rotate once, keep the value in a chmod-restricted local temp file for the active run, run staging smoke immediately, then delete or rotate again at the end of the operator session.

## Remaining Follow-Up

This report closes the rolling retention and staging backfill cutover evidence. It does not close the larger pre-alpha product goal. Serious next work remains in search intelligence, pagination reliability, feedback UX, advanced filter editing, browser QA across more query classes, production deployment policy, and recurring automation for term discovery, pruning, backfill, audit, and smoke checks.
