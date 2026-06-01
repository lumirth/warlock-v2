# UIUC Course Search

Pre-alpha UIUC course search app with a React/Vite frontend, Cloudflare Worker API, D1 storage, Vectorize-backed semantic search, and scheduled sync/enrichment jobs.

## Current Commands

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

Default `npm run build` is deterministic and does not regenerate subject data or fetch network data. Use `npm run generate:subjects` only when intentionally refreshing the committed subject list.

## Route Classes

- Public: `/`, `/health`, `/api/search`, `/api/course/:subject/:number`
- Admin: `/admin/*`, protected by `Authorization: Bearer $ADMIN_TOKEN`
- Internal service fan-out: `/internal/*`, protected by `Authorization: Bearer $INTERNAL_TOKEN`
- Admin diagnostics: `/admin/debug/subjects/:year/:term`, admin-protected and limited to a fixed CISAPI subject-list diagnostic

## Database

The canonical greenfield schema is `apps/api/migrations/0001_initial_schema.sql`. It must remain byte-for-byte identical to `apps/api/src/db/schema.sql`.

Verify clean local bootstrap with:

```bash
npm run db:verify
```

Remote destructive D1 work should first create and verify a restorable backup/export of the target database.

Run the preflight before destructive D1 operations:

```bash
npm run d1:preflight -- --database <db-name> --backup-ref <YYYYMMDDTHHMMSSZ> --evidence-file <report-path> --restore-verified
```

The evidence file must include `D1 Backup Ref`, `D1 Backup Location`, `D1 Restore Database`, and `D1 Restore Verified: yes` markers.

Cloudflare staging readiness is intentionally executable. After staging resources, smoke output, real-looking WAF/rate-limit rule evidence with route/action/threshold proof, and D1 backup/restore evidence exist, run:

```bash
npm run cloudflare:preflight
```

This command is expected to fail until real Cloudflare auth and staging evidence are present. The final report must use concrete evidence labels such as `Staging API URL`, `Staging Web URL`, `Pages Project`, `Pages Branch`, `WAF Rule ID` or `Rate-Limit Rule ID`, `Abuse Control Routes`, `Abuse Control Action`, `Abuse Control Thresholds`, `D1 Backup Ref`, `D1 Backup Location`, `D1 Restore Database`, and `D1 Restore Verified`.

## Data Artifacts

Normal clone/build/test should not depend on large generated historical SQL artifacts. Generated historical chunks are ignored and local-only; a verified whole-project backup was created before removing them from git tracking.

## Active Docs

- `docs/plans/2026-06-01-pre-alpha-remediation-master-plan.md`
- `docs/plans/2026-06-01-stabilization-hardening-master-plan.md`
- `docs/plans/2026-06-01-search-contract-v1.md`
- `docs/deployment-checklist.md`
- `docs/cloudflare-hardening-runbook.md`
- `docs/security-route-matrix.md`
- `docs/release-checklist.md`
- `docs/rollback-checklist.md`

Older plans and analysis notes live under `docs/archive/` as historical context, not current implementation instructions.
