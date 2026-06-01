# Pre-Alpha Remediation Report

Date: 2026-06-01

## Verification

Completed local verification:

```bash
npm run typecheck
npm test
npm run build
npm run lint
npm run db:verify
npm run eval:smoke
```

Notes:

- `npm run lint` exits successfully with warnings for existing `no-explicit-any` usage.
- `npm test` exits successfully; `SearchPage.test.tsx` intentionally exercises an error path and prints the mocked error to stderr.
- `npm run build` exits successfully and does not run subject generation or fetch network data.

Latest verification run after data-artifact cleanup and final checklist updates:

- `npm run typecheck`: passed.
- `npm test`: passed. API: 239 passed, 2 skipped. Web/scripts: passed.
- `npm run build`: passed, with the existing Vite chunk-size warning.
- `npm run lint`: passed, with existing `no-explicit-any` warnings.
- `npm run db:verify`: passed with `Schema bootstrap verified: 0001_initial_schema`.
- `npm run eval:smoke`: passed.

## Prompt-To-Artifact Checklist

| Requirement | Evidence |
| --- | --- |
| Treat project as greenfield/pre-alpha and prefer cleanup over shims | Old migrations were squashed into one baseline, obsolete root migrations were removed, stale active docs moved to `docs/archive/`, debug/test routes and search logging were removed instead of shimmed. |
| Implement code/schema/tooling/test/CI/docs/data-artifact changes | Code, schema, tooling, tests, CI, docs, and data-artifact tracking are updated. `history_chunks/` was removed from git tracking after creating and verifying a whole-project backup at `/Users/lu/uiuc-course-search-backups/pre-history-chunks-cleanup-20260601-102109`. |
| Root `npm run typecheck` | Passed. |
| Root `npm test` | Passed. |
| Root `npm run build` | Passed; build does not run `generate:subjects`. |
| Root `npm run lint` | Passed with warnings only. |
| Clean local DB bootstrap | `npm run db:verify` creates a temporary SQLite DB from `apps/api/migrations/0001_initial_schema.sql`, checks required tables/columns, and confirms `schema_version`. |
| Admin/internal auth smoke tests | `apps/api/src/middleware/__tests__/auth.test.ts`, `apps/api/src/routes/__tests__/debug.test.ts`, and `apps/api/src/routes/__tests__/sync-validation.test.ts` pass. |
| Query Language v1 behavior tests | `query-parser.test.ts`, `extractor.test.ts`, `query-resolver.test.ts`, `search-filters.test.ts`, `search-pipeline.test.ts`, `search-tiers.integration.test.ts`, and `golden.test.ts` pass. Unsupported field/dash syntax is preserved in residual text. |
| Frontend DTO/state tests | `api-client.test.ts`, `SearchPage.test.tsx`, and `CoursePage.test.tsx` pass. Frontend imports shared DTOs from `packages/query-types`. |
| CI configured for same core checks | `.github/workflows/ci.yml` runs install, typecheck, schema verification, tests, build, lint, and eval smoke. |
| D1 destructive backup rule | Documented in `docs/deployment-checklist.md`; no destructive remote D1 work was performed in this pass. |
| Stop before production secret changes | No production secrets were changed. RMP token handling was moved to a binding as hygiene only; no remote secret was set. |
| Stop before git history rewrites | No history rewrite was performed. |
| Stop before deleting large tracked data artifacts | A whole-project backup was created and verified before removing `history_chunks/` from git tracking. The local artifact files were preserved in the working tree. |

## Completed Remediation Areas

- Admin and internal route boundaries now require bearer auth.
- Arbitrary user-controlled debug fetch was removed.
- Public input bounds were added for search, course detail, and admin sync routes.
- Upstream backoff was renamed and documented as upstream protection, not public abuse protection.
- Canonical schema is squashed into `apps/api/migrations/0001_initial_schema.sql` and verified byte-for-byte against `apps/api/src/db/schema.sql`.
- Instructor upserts and section identity now match the schema.
- Sync no longer performs destructive GenEd deletion before constructive writes, and stale subject rows are pruned after successful sync.
- Course detail fresh fetch is read-only and no longer mutates canonical tables from the live parser path.
- Default course term resolution now uses `term_state` first and env values only as fallback.
- RMP sync uses an explicit binding and persisted `sync_state` checkpoints.
- Contextual enrichment is deterministic, bounded, and checkpointed.
- Historical sync scripts typecheck and use the parser string adapter.
- Query Language v1 power fields are either applied end to end or left in residual text when unsupported.
- The search contract was revised in `docs/plans/2026-06-01-search-contract-v1.md` to match implemented V1 instead of carrying aspirational per-result evidence requirements.
- Search negation uses course-level anti-join semantics.
- Unsupported dash and natural-language negations are kept in residual text instead of being silently dropped.
- Hard search constraints are no longer silently relaxed into primary results.
- Search ranking batches quality-score lookup.
- Frontend/backend DTOs are shared through `packages/query-types`.
- Search and course page async state have regression tests.
- Course sections table has horizontal scrolling instead of clipped overflow.
- Root typecheck, test, build, lint, schema verification, and eval smoke commands exist and run from the repo root.
- CI workflow exists under `.github/workflows/ci.yml`.
- Default build is deterministic and separate from `generate:subjects`.
- `history_chunks/` was removed from git tracking after a verified whole-project backup; `.gitignore` keeps the generated files local-only going forward.
- Old implementation plans and analysis notes, including the stray plan under `apps/api/src/plans/`, were moved under `docs/archive/`.

## Data-Artifact Cleanup

Before changing data-artifact tracking, a whole-project backup was created at:

```text
/Users/lu/uiuc-course-search-backups/pre-history-chunks-cleanup-20260601-102109
```

The backup was verified as a git worktree and confirmed to contain the 35 previously tracked `history_chunks/` files, the local `history_chunks/` directory, and `full_history.sql`.

The generated chunks were then removed from git tracking with `git rm --cached -r history_chunks`. The local files remain in the working tree, and `.gitignore` now ignores `history_chunks/`, so the files will remain local-only going forward.

`full_history.sql` is also large locally, but it is already ignored and not tracked.
