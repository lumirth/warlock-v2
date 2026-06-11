# Security Route Matrix

The project is pre-alpha and has no compatibility obligations. Routes should stay sharply classified: public read routes stay read-only, admin routes require `ADMIN_TOKEN`, internal service-binding routes require `INTERNAL_TOKEN`, and diagnostics stay fixed-scope.

| Route | Class | Auth | Mutates Data | Notes | Automated Evidence |
| --- | --- | --- | --- | --- | --- |
| `GET /` | Public | None | No | Health/root route only. | `apps/api/src/routes/__tests__/debug.test.ts` indirectly loads Worker. |
| `GET /health` | Public | None | No | Staging smoke target. | `scripts/staging-smoke.ts` |
| `GET /api/search` | Public | None | No | Bounded params; returns shared `SearchResponseDto` with result evidence; Cloudflare `SEARCH_RATE_LIMITER` enforces 120 requests/min/IP before handler. | `apps/api/src/routes/__tests__/search.test.ts`, `apps/api/src/services/__tests__/search.integration.test.ts` |
| `GET /api/course/:subject/:number` | Public | None | No | Bounded subject/course/term/year params; cached detail path is read-only; Cloudflare `COURSE_RATE_LIMITER` enforces 240 requests/min/IP before handler. | `apps/api/src/routes/__tests__/course.test.ts`, `apps/api/src/services/__tests__/search.integration.test.ts` |
| `GET /api/terms` | Public | None | No | Returns term and year options backed by the searchable corpus. | `apps/api/src/routes/__tests__/sync-status.test.ts` |
| `POST /api/feedback` | Public | None | Yes | Accepts bounded anonymous product feedback; protected by the public search limiter class. | `apps/api/src/routes/__tests__/feedback.test.ts` |
| `POST /admin/sync-rmp` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Runs RMP sync and then rebuilds active/registrable scoring enrichment. | `apps/api/src/middleware/__tests__/auth.test.ts`, `apps/api/src/routes/__tests__/rmp-batch.test.ts` |
| `POST /admin/enrich-scoring` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Dispatches score enrichment. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/enrich-gpa` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Aggregates GPA data into course/instructor stats. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/reset-gpa-sync` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Resets GPA cursor after upstream data change. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/sync-gpa` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Processes next GPA chunk. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/embeddings/backfill` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Rebuilds a bounded batch of semantic-search embeddings. | `apps/api/src/routes/__tests__/embedding-backfill.test.ts` |
| `GET /admin/sync/status` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | No | Reports global workflow, per-subject, and term state plus failed and running runs. | `apps/api/src/routes/__tests__/sync-status.test.ts` |
| `POST /admin/discover-terms` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Discovers active/historical terms. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `GET /admin/terms` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | No | Operational term state. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/sync/:year/:term` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Bounded params; manual term sync. | `apps/api/src/routes/__tests__/sync-validation.test.ts` |
| `POST /admin/sync-active` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Bounded active-term sync fan-out. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `GET /admin/upstream-backoff-status` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | No | Fixed upstream backoff state only. | `apps/api/src/routes/__tests__/debug.test.ts` |
| `POST /admin/reset-upstream-backoff` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Resets in-memory upstream backoff state only. | `apps/api/src/routes/__tests__/debug.test.ts` |
| `GET /admin/debug/search-plan` | Admin diagnostics | `Authorization: Bearer $ADMIN_TOKEN` | No | Returns a fixed-scope search planning diagnostic. | `apps/api/src/routes/__tests__/debug.test.ts` |
| `POST /internal/sync-rmp-batch` | Internal | `Authorization: Bearer $INTERNAL_TOKEN` | Yes | Service-binding RMP batch worker; writes D1 before returning success. | `apps/api/src/middleware/__tests__/auth.test.ts`, `apps/api/src/routes/__tests__/rmp-batch.test.ts` |
| `POST /internal/sync-batch` | Internal | `Authorization: Bearer $INTERNAL_TOKEN` | Yes | Service-binding course sync worker. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `GET /admin/debug/subjects/:year/:term` | Admin diagnostics | `Authorization: Bearer $ADMIN_TOKEN` | No | Fixed CISAPI subject-list diagnostic only; no arbitrary fetch or raw course/GPA dump tools. | `apps/api/src/routes/__tests__/debug.test.ts` |

## Required Checks

```bash
npm run security:secrets
npm run security:audit
npm test -w @uiuc-course-search/api -- src/middleware/__tests__/auth.test.ts src/routes/__tests__/debug.test.ts src/routes/__tests__/sync-validation.test.ts
```

## CORS Boundary

CORS is applied only to `/api/*` routes. Admin and internal routes are not part of the public browser API surface and remain token-protected regardless of platform WAF/rate-limit settings.
