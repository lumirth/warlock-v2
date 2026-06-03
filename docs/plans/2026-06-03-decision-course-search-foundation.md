# Decision-Oriented Course Search Foundation

## Purpose

Students are using a search box to make an advising and registration decision. The system should stay search-first: a normal query goes in, a ranked result page comes out, and the backend exposes the assumptions, filters, warnings, and recovery paths that made the result page useful.

This is not a chatbot architecture. AI can assist offline alias generation, query-plan fallback, or failed-query mining, but official facts come from D1 tables and FTS indexes.

## Cloudflare Shape

- Worker: query normalization, SearchPlan compilation, lane orchestration, rank fusion, explanations, and query logging.
- D1: source of truth for courses, sections, requirements, aliases, workload/evidence signals, and search/eval data.
- D1 FTS5: official course text, section text, student aliases, and workload/evidence text.
- KV: normalized query plan/result payload cache for popular searches. The Worker uses the `SEARCH_CACHE` binding when available; keys are prefixed as `search:v1:*` so the namespace can be shared during staging and split later.
- R2: raw catalog or syllabus snapshots when ingestion needs durable object storage.
- Queues/Cron: catalog ingestion, reindexing, offline alias generation, syllabi extraction, and query-log mining.
- Vectorize/AI Search: optional semantic sidecar for topic/vibe recall only. It must not be the source of truth.

## Schema Additions

The greenfield D1 schema now includes:

- `course_aliases`: manual/generated student-language aliases tied to a course with `kind`, `source`, and `confidence`.
- `course_aliases_fts`: FTS5 index over aliases for queries such as "movies class", "easy science gen ed", and "not math".
- `course_signals`: evidence rows for subjective or risk-oriented claims such as `low_workload`, `low_writing`, `low_exams`, `low_math`, `non_major_friendly`, or `no_listed_prereq`.
- `course_signals_fts`: FTS5 index over signal explanations for future evidence-text retrieval.

Subjective claims should always have source and confidence. "Easy" is not a fact; a combination of 100-level, no listed prerequisite, high GPA, low workload signals, and syllabus evidence is evidence.

## KV Cache

`apps/api/src/services/search-cache.ts` provides two short-lived cache families:

- `search:v1:plan:*`: normalized query plus overrides -> compiled SearchPlan and extraction payload, five-minute TTL.
- `search:v1:result:*`: normalized query plus limit/overrides -> full pipeline result, 30-second TTL.

The short result TTL keeps open-seat and term-ranking data from staying stale for long. Cache failures are logged and never block search.

## SearchPlan

`SearchPlan.rescue` is the decision-search layer. It records:

- query types: exact course, requirement, schedule, topic, subjective vibe, avoidance, eligibility, degree progress, comparison, or help/path
- negative terms such as `writing_heavy`, `math_heavy`, or `exam_heavy`
- topic and expanded terms
- assumptions rendered as interpreted chips
- warnings for missing evidence or student-profile needs
- retrieval lanes to run
- relaxation steps for no-result recovery

Rules live in `apps/api/src/services/decision-plan.ts`. Keep them explicit and testable. Avoid scattering regexes across route or ranking code.

## Student-Language Rules

Current mappings include:

- "easy", "chill", "grade booster", "gpa booster" -> low-workload preference with uncertainty warning
- "no essays", "no papers", "writing-light" -> low-writing preference and writing-evidence warning
- "no exams", "no tests" -> low-exam preference and exam-evidence warning
- "not math", "no math", "hate math" -> avoid math-heavy, calculus, statistics, formal logic, and quantitative risk
- "less bio" -> avoid biology-heavy courses
- "no prereq" -> prefer no listed prerequisite with prerequisite-evidence warning
- "movies" -> film, cinema, media, documentary, television, pop culture, visual culture
- "online", "remote", "async" -> delivery/schedule preferences
- "after lunch", "after 2pm", "morning" -> schedule preferences
- "8 week" -> compressed part-of-term preference until exact campus part-of-term mapping is available
- "counts for", "that counts" -> requirement intent plus a student-profile warning when degree progress is needed

## Retrieval Lanes

The search service fuses several lanes instead of treating courses as plain documents:

- `exact`: course codes and CRNs
- `official_text`: `courses_fts` title/description/official text
- `requirement`: structured GenEd/requirement filters and mappings
- `structured_section`: section availability, delivery, time, days, status, and part of term
- `student_language_alias`: `course_aliases_fts`
- `workload_evidence`: `course_signals`
- `topic_semantic`: optional Vectorize/AI semantic sidecar, post-filtered by D1 truth
- `help_path`: currently planned for FAQ/path content and degree-audit help queries

Lane weights favor structured truth. Exact, requirement, section, alias, and evidence lanes should beat a result that only sounds semantically related.

## Ranking And Explanations

Ranking now adds usefulness signals after lane fusion:

- hard constraint satisfaction and exact course matches
- requirement match or clear requirement uncertainty
- section/schedule lane support
- student-language alias support
- workload/evidence support
- course quality, difficulty, GPA, and level signals where available
- penalties for unsupported subjective claims, math/writing/biology risk, and no-prereq conflicts

Each result DTO includes `explanation`:

- `whyMatched`: deterministic facts and lane evidence
- `watchOut`: warnings for historical data, missing workload evidence, profile requirements, or unsupported subjective claims
- `matchedChips`: visible interpreted assumptions
- `confidence`: score, label, and reasons

## No-Result Recovery

Over-constrained decision queries should not dead-end. When strict results are empty, `meta.fallback.recoveryGroups` exposes relaxation paths from `SearchPlan.rescue.relaxationPlan`, such as:

- keep useful course matches while relaxing exact writing/exam evidence
- keep requirement/topic while allowing any delivery mode
- show adjacent requirement buckets with clear labels

Future work should attach preview result IDs to each group after running relaxed searches against small candidate sets.

## Extending The System

Add a student phrase:

1. Add or update a rule in `apps/api/src/services/decision-plan.ts`.
2. Add aliases in `apps/api/src/services/alias-registry.ts` only when the phrase should create a structured hint or advanced-state control.
3. Add topic expansions in `apps/api/src/services/topic-registry.ts` when the phrase is topical vocabulary.
4. Add golden query coverage in `apps/api/src/eval/golden-queries.ts`.
5. Add or update corpus coverage in `apps/api/src/eval/corpus-coverage.ts` if it is a new failure class.

Add a course alias:

1. Insert into `course_aliases` with `kind`, `source`, and `confidence`.
2. Let FTS triggers populate `course_aliases_fts`.
3. Add eval cases that prove the alias retrieves a useful course without overclaiming official facts.

Add a workload signal:

1. Insert into `course_signals` with `signal_type`, `value`, `source`, `confidence`, and `explanation`.
2. Extend `workloadSignalTypes()` in `apps/api/src/services/search.ts` if the signal is a new preference family.
3. Add a ranking test when the signal should change order.

## Validation

Focused checks:

```bash
npm run eval:smoke
npm run typecheck --workspace apps/api
npm test --workspace apps/api -- src/services/__tests__/search-ranking.test.ts src/services/__tests__/search-pipeline.test.ts src/dto/__tests__/course.test.ts src/dto/__tests__/search-ui.test.ts src/eval/__tests__/corpus-coverage.test.ts
```

Full gates:

```bash
npm run db:verify
npm test
npm run typecheck
npm run build
npm run lint
```

Eval failures usually mean the compiler changed what the result page can explain. Treat those failures as product regressions unless the expected interpretation was intentionally updated.

## Future Work

- Run relaxed searches for each recovery group and return preview course IDs.
- Mine query logs for zero-result searches, immediate reformulations, deep clicks, saves, and filter-chip usage.
- Add syllabi ingestion and assignment extraction into `course_signals`.
- Add grade distributions and drop-rate signals where legally and ethically available.
- Add an AI Search or Vectorize sidecar for topic/vibe recall only, with D1 post-filtering.
- Add personalized degree-audit integration so "does this count" can distinguish institutional GenEd truth from a student's actual remaining requirements.
- Add FAQ/help lane content for "what do I need" and "how do gen eds work" queries.
