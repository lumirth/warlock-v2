# Security Route Matrix

Date: 2026-06-01

The project is pre-alpha and has no compatibility obligations. Routes should stay sharply classified: public read routes stay read-only, admin routes require `ADMIN_TOKEN`, internal service-binding routes require `INTERNAL_TOKEN`, and diagnostics stay fixed-scope.

| Route | Class | Auth | Mutates Data | Notes | Automated Evidence |
| --- | --- | --- | --- | --- | --- |
| `GET /` | Public | None | No | Health/root route only. | `apps/api/src/routes/__tests__/debug.test.ts` indirectly loads Worker. |
| `GET /health` | Public | None | No | Staging smoke target. | `scripts/staging-smoke.ts` |
| `GET /api/search` | Public | None | No | Bounded params; returns shared `SearchResponseDto` with result evidence. | `apps/api/src/routes/__tests__/search.test.ts`, `apps/api/src/services/__tests__/search.integration.test.ts` |
| `GET /api/course/:subject/:number` | Public | None | No | Bounded subject/course/term/year params; cached detail path is read-only. | `apps/api/src/routes/__tests__/course.test.ts`, `apps/api/src/services/__tests__/search.integration.test.ts` |
| `POST /admin/sync-rmp` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Dispatches RMP sync work. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/enrich-scoring` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Dispatches score enrichment. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/enrich-gpa` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Aggregates GPA data into course/instructor stats. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/reset-gpa-sync` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Resets GPA cursor after upstream data change. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/sync-gpa` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Processes next GPA chunk. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/discover-terms` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Discovers active/historical terms. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `GET /admin/terms` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | No | Operational term state. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /admin/sync/:year/:term` | Admin | `Authorization: Bearer $ADMIN_TOKEN` | Yes | Bounded params; manual term sync. | `apps/api/src/routes/__tests__/sync-validation.test.ts` |
| `POST /internal/sync-rmp-batch` | Internal | `Authorization: Bearer $INTERNAL_TOKEN` | Yes | Service-binding batch worker. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /internal/enrich-batch` | Internal | `Authorization: Bearer $INTERNAL_TOKEN` | Yes | Service-binding enrichment worker. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `POST /internal/sync-batch` | Internal | `Authorization: Bearer $INTERNAL_TOKEN` | Yes | Service-binding course sync worker. | `apps/api/src/middleware/__tests__/auth.test.ts` |
| `/admin/debug/*` | Admin diagnostics | `Authorization: Bearer $ADMIN_TOKEN` | No | Fixed diagnostics only; no arbitrary fetch tool. | `apps/api/src/routes/__tests__/debug.test.ts` |

## Required Checks

```bash
npm run security:secrets
npm run security:audit
npm test -w @uiuc-course-search/api -- src/middleware/__tests__/auth.test.ts src/routes/__tests__/debug.test.ts src/routes/__tests__/sync-validation.test.ts
```

## CORS Boundary

CORS is applied only to `/api/*` routes. Admin and internal routes are not part of the public browser API surface and remain token-protected regardless of platform WAF/rate-limit settings.
