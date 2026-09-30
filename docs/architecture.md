# Architecture and data

The browser sends public requests to a Hono application on Cloudflare Workers.
D1 holds course and section snapshots, full-text indexes, term classifications,
refresh progress, comparison data, and feedback. The Worker also handles
scheduled refreshes. KV caches the GPA dataset during imports.

## Code ownership

| Location | Responsibility |
| --- | --- |
| `apps/web/src` | React pages, controls, navigation, and search URL state |
| `packages/query-types` | Shared request/response types and search vocabulary |
| `apps/api/src/http` | Request decoding and limits |
| `apps/api/src/services/search-plan-compiler.ts` | Interpret queries and structured constraints |
| `apps/api/src/services/search-engine.ts` | Retrieve and rank eligible courses |
| `apps/api/src/services/search-response-presenter.ts` | Present results, filters, and follow-up requests |
| `apps/api/src/services` | Catalog publication, refresh, enrichment, and course details |
| `apps/api/src/routes` | Adapt HTTP requests to those services |
| `apps/api/migrations/0001_schema.sql` | Canonical D1 schema |
| `apps/api/src/eval` | Public behavior checks against a deployed API |
| `scripts` | Release, smoke, bundle, and secret checks |

## Search

Query interpretation recognizes course codes, subject names and aliases,
requirements, instructors, meeting constraints, and supported power syntax.
Structured filters override interpreted values. The plan retains residual topic
text for retrieval and preferences for ranking.

Retrieval constrains eligible courses before ranking. Exact course navigation,
official course text, section text, and structured browsing provide candidate
paths. D1 full-text search handles topic text. The request stays immutable as
interpretation, retrieval, ranking, and presentation proceed.

The response contains course results, applied filters, ambiguity choices,
pagination, and normalized next requests. The client uses those next requests
when removing filters or resolving an interpretation. Search URL state supports
sharing, reloads, and browser history.

Current offerings are the default pool. Historical scope searches retained
course snapshots; discovering a past term does not download its entire catalog.
Terms classify registration availability from sampled university section
statuses. That classification does not establish that every course has an
available seat.

## Catalog publication

Term discovery reads Course Explorer schedules. A sync call processes at most
20 subjects in one current term. Subject rows in `subject_sync_state` hold
progress, leases, and publication ownership. Within a batch, the Worker limits
concurrency to keep fetch and D1 fan-out bounded.

Only a complete authoritative subject snapshot can publish freshness or remove
vanished courses and sections. Snapshot writes and publication fences use D1
transactions through batched statements. A complete subject manifest permits
term publication. Failed or interrupted work remains eligible for retry after
the owning lease expires.

The root API response reports a populated published current term. `/health`
checks that the Worker responds; it does not query D1 or establish catalog
readiness. Deployment and smoke use catalog checks in addition to liveness.

## GPA and instructor ratings

GPA imports use a staged generation of source rows and a cached CSV. Each call
imports a bounded chunk and checkpoints progress. A reset retains existing
published statistics while replacing staging rows. Completion rebuilds
statistics, instructor links, and course scores.

GPA values aggregate historical letter-grade counts. Rate My Professors data
supplies instructor ratings and difficulty. Name matching connects those
sources to instructors, so missing or ambiguous names can reduce coverage.

The quality signal uses 60% normalized instructor rating and 40% normalized GPA.
It requires at least 30 GPA records and five ratings. Missing sources do not
receive extra weight; the quality signal stays unavailable. Instructor difficulty
also needs five ratings. These thresholds and weights live in
`course-score-policy.ts`. The UI uses the shared quality labels Excellent, Good,
Fair, and Low. Difficulty describes instructor ratings, not measured assignments
or time spent on the course.

## HTTP policy and feedback

Public search and course reads have separate rate limits. `/admin/*` requires
the configured bearer token. Feedback requires a configured browser origin,
a bounded request body, valid fields, and its own rate limit. It stores submitted
text and page/search context in D1 for operator inspection.

The public API types live in `packages/query-types`; HTTP decoding validates
requests at the owning boundary. Unit tests cover parsing algorithms,
migrated-D1 integration tests cover persistence and publication, and actual-app
tests cover authentication and route policy. Public eval scenarios test deployed
search promises without duplicating the parser suite.

## Data sources

- [University Course Explorer](https://courses.illinois.edu/) supplies catalog,
  requirement, section, and instructor information through its XML explorer
  endpoints. Course pages link back to the official offering.
- [Wade Fagen-Ulmschneider's UIUC GPA dataset](https://github.com/wadefagen/datasets/tree/main/gpa)
  contains university grade distributions. Its documentation explains the
  collection history, coverage, omitted data, and instructor-name truncation.
  The Worker fetches the CSV through jsDelivr at import time.
- [Rate My Professors](https://www.ratemyprofessors.com/) supplies student ratings
  through its GraphQL endpoint when an operator configures an authentication
  token. Ratings are external opinions and may not cover every instructor.

External data is fetched at runtime rather than bundled in the web assets.
Those sources are distinct from the project's original code and dependency
licenses. The web bundle includes Geist font files from `@fontsource-variable/geist`
under the SIL Open Font License, plus dependency code under its package licenses.
Release packaging must retain the applicable third-party notices.
