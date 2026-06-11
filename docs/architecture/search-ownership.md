# Search Ownership

Search follows one direction:

```text
public request
-> query interpretation
-> SearchPlan
-> RetrievalPlan
-> candidates
-> ranked results
-> public response
```

Each concept has one owner. Other layers may translate or consume it, but must
not redefine it.

## Owners

| Concern | Owner | Does not own |
| --- | --- | --- |
| Public request, response, actions, query codec, shared display policy | `packages/query-types` | Planner, retrieval, D1, HTTP |
| URL/header/path translation | `apps/api/src/http` | Search semantics or DTO assembly |
| HTTP endpoints | `apps/api/src/routes` | SQL, parsing source XML, retrieval, ranking |
| Search sequencing, cache, and timings | `SearchPipeline` | Extraction rules, lane SQL, ranking weights, public DTO shape |
| Student-language extraction and resolution | `extractor.ts`, `extraction/*`, `query-resolver.ts` | Retrieval or presentation |
| Interpreted intent | `SearchPlan` and `search-plan-compiler.ts` | Executable lane configuration |
| Executable candidate recall | `RetrievalPlan` and retrieval lane modules | Public presentation or ranking policy |
| Ordering and rationale | `ranking/*` | HTTP parsing or UI state |
| Internal-to-public translation | Search response presenters and DTO mappers | Data access |
| Search draft/session rendering | `apps/web/src/pages/search` | Backend intent interpretation |
| Source parsing and snapshots | `cisapi/*` and transforms | Public UI vocabulary |

## Contract Rules

- Public HTTP decoding is strict. Missing optional values receive defaults;
  malformed supplied values produce a clear error.
- Internal callers use the same public request normalizer. It throws on invalid
  typed values instead of silently dropping programmer errors.
- `meta.nextRequest` is the lossless executable continuation for sort,
  pagination, refresh, and server-authored actions.
- `meta.interpretedRequest` is display/form interpretation only.
- Public search responses never expose `SearchPlan`, `RetrievalPlan`, compiler
  events, budgets, or extraction internals.
- Routes parse, call an application service, call a presenter, and return.
- DTO mappers map already-loaded data. They do not query repositories.

## Search Model Rules

- Extraction produces one canonical `Hint` model. Course codes remain structured
  as `{ subject, number }`.
- Planning is a direct, fixed sequence of readable functions. A fake dynamic
  pass/plugin system is not useful for a fixed workflow.
- `SearchPlan` describes interpreted user intent: filters, residual query,
  preferences, ambiguity, and warnings.
- `RetrievalPlan` contains only executable lanes, inputs, and budgets. A lane
  that cannot execute is not a retrieval lane.
- Retrieval execution records successful and failed lanes separately. Degraded
  execution may return useful results, but internal/debug metadata must not
  pretend every planned lane ran successfully, and degraded results are not
  written to the normal result cache.
- Exact course and CRN recall still obey all hard filters.
- Search ranks one stable, bounded browse window before pagination and counts
  the complete executable candidate union separately. `pagination.totalResults`
  is the exact match count; `pagination.browseableResults` states how many
  top-ranked matches can be paged through. Semantic recall respects
  Vectorize's supported top-k limit.
- Requirement evidence is loaded once per result set. Ranking and DTO
  presentation derive from the same structured requirement rows.
- Ranking policy lives under `ranking/*`. Tests assert ordering and public
  rationale rather than incidental component arithmetic.

## Vocabulary

- The public contract concept is `requirement`; student-facing UIUC copy says
  `GenEd`. Storage/source code may retain `course_gened`.
- Requirement filters preserve mode and all codes:
  `{ mode: "single" | "any" | "all", codes: string[] }`.
- The public product concept is `workload`; source/storage fields such as
  `difficulty_score` may retain source vocabulary.
- Query aliases such as `gened`, `difficulty`, and `pot` terminate at parser or
  codec ingress.
- Course entities, search result wrappers, and detail response envelopes are
  separate DTOs.
- Course-data vocabulary boundaries are documented in
  `docs/architecture/course-data-vocabulary.md`.

## Frontend Rules

- Search draft state is what the user is editing. Search session state is the
  request/results currently displayed. Do not make server responses overwrite a
  dirty draft implicitly.
- Sort, pagination, chip removal, and ambiguity actions execute a
  complete `SearchRequestDto`; they do not merge partial planner-like patches.
- Applied filter chips are removable and their action must change the represented
  constraint. Explanations and warnings are not filter chips.
- Advanced-search enum values and GenEd options come from
  `packages/query-types`. Available years come from `/api/terms`.

## Automated Boundaries

Repository lint enforces dependency direction with file-scoped
`no-restricted-imports` rules in `eslint.config.mjs`. Behavior tests enforce
semantics such as request validation, continuation requests, chip actions,
exact-filter recall, ranking order, and public response shape. Boundary checks
must not freeze helper names, exact file decomposition, or source strings.
