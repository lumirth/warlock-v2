# Rollback Checklist

Date: 2026-06-01

Rollback paths should be concrete because this is pre-alpha software and sharp cutovers are allowed.

## API Worker

1. Identify the last known-good deployment:

```bash
cd apps/api
npx wrangler deployments list --name uiuc-course-search --json
```

2. Roll forward from git when possible:

```bash
git log --oneline -10
git revert <bad-commit>
npm run typecheck && npm test && npm run build && npm run lint
npm run deploy:api:staging
```

3. For production rollback, use Cloudflare deployment rollback only after confirming the target deployment ID and recording it in the incident notes.

## Web Pages

1. Rebuild from the known-good git commit with the intended API base URL.
2. Deploy to a staging branch first.
3. Promote only after Browser smoke passes.

```bash
VITE_API_BASE_URL=https://<staging-worker-host> npm run deploy:web:staging
```

## D1

Never run destructive D1 commands without a verified backup reference:

```bash
npm run d1:preflight -- --database <db-name> --backup-ref <YYYYMMDDTHHMMSSZ> --evidence-file <report-path> --restore-verified
```

For schema/data rollback, use the current Cloudflare-supported D1 backup mechanism. This FTS-backed schema uses D1 Time Travel because SQL export refuses databases with virtual tables. The evidence file must name `D1 Backup Ref`, `D1 Backup Mechanism`, `D1 Backup Location`, `D1 Restore Database`, and `D1 Restore Verified: yes`.

## Generated Artifacts

Large generated history artifacts are local-only. If needed, restore them from the verified whole-project backup recorded in `docs/remediation-report.md`, or regenerate them using the documented historical sync scripts. Do not recommit generated payloads.
