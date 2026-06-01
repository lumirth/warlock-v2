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
npm run deploy:api -- --env staging
```

3. For production rollback, use Cloudflare deployment rollback only after confirming the target deployment ID and recording it in the incident notes.

## Web Pages

1. Rebuild from the known-good git commit with the intended API base URL.
2. Deploy to a staging branch first.
3. Promote only after Browser smoke passes.

```bash
VITE_API_BASE_URL=https://<api-host> npm run build -w @uiuc-course-search/web
npx wrangler pages deploy apps/web/dist --project-name uiuc-course-search-web --branch staging
```

## D1

Never run destructive D1 commands without a verified backup reference:

```bash
npm run d1:preflight -- --database <db-name> --backup-ref <YYYYMMDDTHHMMSSZ> --evidence-file <report-path> --restore-verified
```

For schema/data rollback, prefer restoring a verified export into a new non-production D1 database first, then swap bindings only after the restored DB passes schema and smoke checks. The evidence file must name `D1 Backup Ref`, `D1 Backup Location`, `D1 Restore Database`, and `D1 Restore Verified: yes`.

## Generated Artifacts

Large generated history artifacts are local-only. If needed, restore them from the verified whole-project backup recorded in `docs/remediation-report.md`, or regenerate them using the documented historical sync scripts. Do not recommit generated payloads.
