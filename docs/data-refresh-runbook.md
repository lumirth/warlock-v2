# Data Refresh Runbook

Date: 2026-06-02

This project is pre-alpha, has no users, and has no compatibility obligations. Data freshness should be explicit and observable rather than inferred from scattered cron jobs.

## Sources

- Course Explorer/CISAPI: course, section, meeting, instructor, and term data.
- GPA source cache: historical GPA rows and derived course/instructor GPA summaries.
- Rate My Professors cache: instructor rating/difficulty metadata when a valid sync token is configured.
- Enrichment jobs: course-level GPA, quality, difficulty, and instructor link calculations.

## Automated Cadence

- Term discovery: twice daily through the Worker scheduled handler.
- Active/current/upcoming course sync: every scheduled course-sync pass for terms classified as active.
- GPA resume: every 5 minutes while a GPA sync is incomplete.
- GPA reset: weekly.
- RMP sync: weekly when `RMP_AUTH_TOKEN` is configured.
- Course score and instructor-link enrichment: automatically after GPA completion, after weekly RMP completion, and after explicit admin source/enrichment triggers.

## Freshness Evidence

Use the admin sync status endpoint:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync/status"
```

The response includes:

- `freshness.currentTermId`
- `freshness.currentTermPresent`
- `freshness.activeTermIds`
- `freshness.upcomingTermIds`
- `freshness.historicalTermCount`
- `freshness.staleTermIds`
- `freshness.staleSyncStateIds`
- `freshness.thresholds`

Write that response to an artifact and run the non-destructive audit before deciding whether any data mutation is needed:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync/status" > artifacts/sync-status.json
npm run data:freshness:audit -- --input artifacts/sync-status.json --output artifacts/data-freshness-audit.json --min-historical-terms 1
```

The main searchable corpus is rolling and full-detail. Full searchable history back through 2004 is no longer a requirement for D1. Do not keep old course-only shells in D1. If a term is retained, it must have courses, sections, meetings, instructors, and searchable index state. If storage pressure requires a tradeoff, drop the oldest terms completely and keep the retained terms trustworthy.

The `--from-year 2004` examples below are discovery horizons for databases that may already contain old terms. They let the retention planner identify old candidates to drop cleanly. They are not a requirement to backfill or preserve every term since 2004. The retained term IDs in the generated retention plan are the source of truth for what must remain searchable and fully detailed. When `--status-input` is provided, retention and coverage planning use `freshness.currentTermId` from that status artifact as the default current-term reference; explicit `--current-year` and `--current-term` flags are only for controlled what-if plans.

Generate a retention plan before broad backfill or prune work:

```bash
npm run data:term-retention -- \
  --from-year 2004 \
  --to-year 2027 \
  --status-input artifacts/sync-status.json \
  --target-size-mb 250 \
  --output artifacts/term-retention-plan.json
```

The retention planner pins active and registrable terms, then walks backward from the newest terms. Within the same year, fall and spring outrank winter and summer when the budget is tight; across years, newer winter/summer terms still outrank older fall/spring terms. The sibling SQL artifact deletes dropped terms completely from term-local course tables and includes verification queries. Before executing that SQL remotely, create and restore-verify a D1 Time Travel backup.

After pruning, run the freshness audit against the retention plan:

```bash
npm run data:freshness:audit -- \
  --input artifacts/sync-status.json \
  --retention-input artifacts/term-retention-plan.json \
  --output artifacts/data-freshness-audit.json
```

The audit fails on stale terms, stale GPA/RMP sync state, missing current-term coverage, missing course/section counts, retained terms without full-detail counts, or dropped terms that still appear in `term_state`.

Generate the expected term coverage and concrete backfill command list from Course Explorer term discovery:

```bash
npm run data:term-coverage -- \
  --from-year 2004 \
  --to-year 2027 \
  --status-input artifacts/sync-status.json \
  --retention-input artifacts/term-retention-plan.json \
  --output artifacts/term-coverage-plan.json
```

The coverage plan exits non-zero while retained terms are missing, stale, missing counts, or while an upstream term-list year fails. That is intentional: the plan is an operator gate, not a best-effort report. Dropped terms are out of scope for backfill and should not appear in search after pruning.
When `--retention-input` is provided, the coverage plan only emits backfill commands for retained terms. A wide `--from-year` still scans old terms so the dropped-term accounting stays explicit, but it must not be interpreted as a full-history backfill target.

Run the plan through the backup-gated multi-term orchestrator when multiple terms need work:

```bash
npm run data:backfill:coverage -- \
  --coverage-plan artifacts/term-coverage-plan.json \
  --page-size 5 \
  --backup-ref "$BACKUP_REF" \
  --evidence-file artifacts/d1-backups/$BACKUP_REF-term-coverage/evidence.md \
  --restore-verified \
  --output artifacts/backfill/coverage-$BACKUP_REF.json
```

Use `--max-terms 1 --max-pages-per-term 1` for a bounded staging smoke after backup verification. Remove those limits for a full coverage backfill; the command exits non-zero if an unbounded run leaves incomplete terms or failed subjects.

Default thresholds:

- Active term data is stale after 36 hours without a sync.
- Historical term data is stale if absent or older than 120 days.
- GPA data is stale after 7 days.
- RMP data is stale after 14 days.

## Operator Response

1. If `currentTermPresent` is false, run term discovery:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/discover-terms"
```

2. If an active or upcoming term is stale, trigger the bounded active-term sync:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync-active"
```

3. If a retained current, upcoming, or historical term needs a complete subject-by-subject backfill, use the paginated backfill runner after creating and restore-verifying a D1 Time Travel backup:

```bash
npm run data:backfill:term -- \
  --year 2025 \
  --term fall \
  --status historical \
  --page-size 5 \
  --backup-ref "$BACKUP_REF" \
  --evidence-file artifacts/d1-backups/$BACKUP_REF-pre-backfill/evidence.md \
  --restore-verified \
  --output artifacts/backfill/2025-fall-$BACKUP_REF.json
```

Use `--max-pages 1` for a bounded smoke page or `--start-offset <n>` to resume from the report's `Next offset`. The runner refuses non-dry-run remote writes unless the backup evidence contains `D1 Backup Ref`, `D1 Backup Location`, `D1 Restore Database`, and `D1 Restore Verified: yes`.

4. If GPA is stale, reset or resume GPA sync:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync-gpa"
```

5. If RMP is stale and `RMP_AUTH_TOKEN` is configured, dispatch RMP sync. The admin RMP sync waits for RMP batches to write to D1 and then rebuilds active/registrable instructor links and public quality/workload scores:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync-rmp"
```

6. After manual GPA updates or broad term backfills, run enrichment:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/enrich-gpa"
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/enrich-scoring"
```

`enrich-gpa` propagates course-level GPA aggregates across every retained term, and `enrich-scoring` rebuilds instructor GPA/RMP links for every active or registrable term before recomputing public quality/workload scores.

## Backup Rule

Before destructive remote D1 actions, create and verify a restorable D1 Time Travel backup. Follow `docs/rollback-checklist.md` and record the backup reference, bookmark, restore target, and restore verification evidence in the stabilization report.

## Promotion To Final Evidence

The final stabilization report must include:

- The `/admin/sync/status` JSON summary for staging.
- Evidence that current and upcoming terms are present.
- Retained historical term count and dropped-term absence evidence from the retention-scoped audit.
- GPA/RMP freshness status.
- D1 backup/restore evidence before destructive data changes.
