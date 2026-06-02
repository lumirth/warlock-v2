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
- RMP sync dispatch: weekly when `RMP_AUTH_TOKEN` is configured.
- Course score and instructor-link enrichment: after GPA completion and explicit admin enrichment triggers.

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

3. If GPA is stale, reset or resume GPA sync:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync-gpa"
```

4. If RMP is stale and `RMP_AUTH_TOKEN` is configured, dispatch RMP sync:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync-rmp"
```

5. After GPA or rating updates, run enrichment:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/enrich-scoring"
```

## Backup Rule

Before destructive remote D1 actions, create and verify a restorable D1 Time Travel backup. Follow `docs/rollback-checklist.md` and record the backup reference, bookmark, restore target, and restore verification evidence in the stabilization report.

## Promotion To Final Evidence

The final stabilization report must include:

- The `/admin/sync/status` JSON summary for staging.
- Evidence that current and upcoming terms are present.
- Historical term count and any intentional remaining gaps.
- GPA/RMP freshness status.
- D1 backup/restore evidence before destructive data changes.
