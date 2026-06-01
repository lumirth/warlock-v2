# Search Contract V1

Date: 2026-06-01

Status: provisional architecture contract

This document makes explicit the search contract that is already strongly implied by the current project: the shared query types, golden queries, extractor/parser code, previous query-system plans, and the product's stated desire to be the lowest-friction UIUC course search engine.

This is not immune from revision. It is an extrapolation from established project patterns, not an infallible specification. Implementation agents should question it when evidence from users, data, UI behavior, or platform constraints shows it is wrong. But until it is revised deliberately, it should be used as the organizing contract for schema, sync, indexing, API response shape, UI behavior, and evals.

## Product Promise

UIUC Course Search V1 accepts natural-language or explicit course intent, compiles it into hard filters, soft preferences, and residual topical text, retrieves course options across course/offering/section/instructor/requirement entities, enforces hard constraints across all retrieval channels, ranks by textual relevance plus preference fit, and returns explainable exact results with separately labeled relaxations when necessary.

The user-facing goal:

> A student should be able to type ordinary UIUC course intent and quickly get current, trustworthy, ranked course options, with enough explanation to understand why each result matched.

Examples of ordinary intent:

- `easy advanced comp open not Friday with a decent professor`
- `CS 400 level machine learning`
- `3 credit humanities gen ed online`
- `CS 225 with Fagen`
- `open second half semester course`
- `beginner coding class not for CS majors`

These are search queries. The goal is not to route the user into a separate "assistant" mode; it is to make search rich enough to understand structured constraints, fuzzy preferences, topical text, and UIUC-specific language.

## Core Contract Questions

### 1. What User Intents Are Supported?

V1 supports seven intent families.

#### Navigational Intent

The user knows the course, subject, or CRN.

Examples:

- `CS 225`
- `cs225`
- `CRN 12345`
- `RHET 105`
- `econ`

Contract:

- Course codes are exact hard constraints.
- CRNs are exact hard constraints.
- Subject-only queries return that subject's course options.
- Navigational matches outrank semantic/topic matches.

#### Topical Discovery Intent

The user describes subject matter.

Examples:

- `data structures`
- `machine learning`
- `organic chemistry`
- `linear algebra`
- `climate policy`
- `ethics and technology`

Contract:

- Topical text remains residual search text.
- Residual text feeds keyword and semantic retrieval.
- Exact title and close title matches receive strong boosts.
- No structured filter should be inferred unless the phrase is clearly a constraint or known UIUC alias.

#### Requirement Intent

The user wants to satisfy a requirement.

Examples:

- `advanced comp`
- `writing intensive`
- `humanities gen ed`
- `quantitative reasoning 1`
- `natural sciences`
- `cultural studies gened`

Contract:

- Clear UIUC requirement phrases map to hard requirement filters.
- `advanced comp`, `adv comp`, and `writing intensive` map to ACP.
- `QR1`, `QR2`, `quantitative reasoning 1`, and `quantitative reasoning 2` should preserve the specific category.
- Ambiguous requirement-like words may default to the likely student intent, but the response must expose an interpretation chip that can be corrected.

This refines older cue-only logic. Cue words like `gen ed`, `requirement`, and `category` increase confidence, but requiring them everywhere creates too much friction for average users.

#### Schedule And Availability Intent

The user expresses life constraints.

Examples:

- `MWF morning`
- `TR afternoon`
- `open sections`
- `online`
- `in person`
- `no Friday`
- `not morning`
- `second half`
- `part of term A`

Contract:

- These are structured constraints.
- They are enforced at the section/meeting grain.
- Course cards returned for section/meeting constraints must include matching sections, not just the parent course.

#### Instructor Intent

The user names or evaluates instructors.

Examples:

- `with Fagen`
- `Professor Fleck`
- `Dr. Smith CHEM`
- `CS 225 with Fagen`
- `decent professor`
- `good instructor`

Contract:

- Named instructors introduced by `with`, `professor`, `prof.`, or `dr.` are instructor constraints.
- Instructor constraints should be resolved in course/section/term context when possible.
- Qualitative instructor phrases such as `decent professor` are soft preferences by default.

#### Difficulty And Quality Intent

The user wants easier, harder, better, or GPA-friendly courses.

Examples:

- `easy humanities`
- `gpa booster`
- `hard CS class`
- `decent professor`
- `not too hard`

Contract:

- Difficulty and quality language is usually a soft preference, not a hard eligibility filter.
- Soft difficulty preferences affect ranking and explanation.
- Explicit syntax or UI controls can harden difficulty into a filter.
- Missing GPA/RMP data should not automatically exclude results unless the user explicitly asks for only results with that data.

#### Power User Intent

The user writes explicit syntax.

Examples:

- `subject:CS`
- `gened:HUM`
- `gened:any(HUM,US)`
- `credits:3`
- `status:open`
- `online:true`
- `term:spring-2026`

Contract:

- Supported power syntax is always hard unless the syntax explicitly says otherwise.
- If a parser recognizes a field, execution must apply it or return an explicit unsupported-field warning.
- Unsupported power syntax must not silently disappear.

### 2. Which Query Parts Are Hard Constraints?

Hard constraints define primary result eligibility.

V1 hard constraints:

- exact course code
- CRN
- explicit power syntax fields
- subject code/name when clearly intended
- requirement/GenEd when clearly intended
- credits when phrased numerically
- term/year
- status/open when stated
- online/in-person when stated
- days/time when stated
- part of term
- named instructor when phrased as instructor intent
- negations such as `no morning`, `avoid Friday`, `not online`

Rule:

> Hard constraints must be enforced across every retrieval channel before primary results are returned.

Semantic retrieval may generate candidates, but semantic candidates must be post-filtered before entering primary results.

### 3. Which Query Parts Are Soft Preferences?

Soft preferences affect ranking, not primary eligibility.

V1 soft preferences:

- `easy`
- `gpa booster`
- `hard` when browsing for challenge
- `decent professor`
- `good instructor`
- `interesting`
- `beginner`
- `intro` unless expressed as `100 level`
- `advanced` unless it means `advanced composition` or explicit `400 level`

Examples:

`easy advanced comp open not Friday`

- hard: ACP
- hard: open
- hard: not Friday
- soft: easy

`difficulty:easy advanced comp`

- hard: easy
- hard: ACP

This gives average users forgiving search while preserving precise control for power users.

### 4. Which Entities Can Satisfy A Match?

The UI can display course cards, but the engine must search across multiple internal grains.

#### Course

Matches title, description, subject, number, catalog-level facts, and broad topics.

Examples:

- `data structures`
- `CS 225`
- `machine learning`

#### Offering

Matches a course in a term.

Examples:

- `spring 2026 CS`
- `current open CS courses`

#### Section

Matches CRN, status, meeting pattern, part of term, location, online/in-person, and section title/notes.

Examples:

- `open MWF morning`
- `CRN 12345`
- `second half online`

#### Meeting

Matches days and times.

Examples:

- `no Friday`
- `after 5`
- `TR afternoon`

#### Instructor-Course Context

Matches instructor names and instructor quality signals as attached to a course, section, term, or offering.

Examples:

- `with Fagen`
- `decent professor`
- `CS 225 with Fleck`

#### Requirement

Matches GenEd and campus requirement language.

Examples:

- `advanced comp`
- `humanities`
- `QR2`
- `cultural studies`

#### Topic Or Alias

Matches natural-language topic aliases and common student phrasing.

Examples:

- `comp sci`
- `AI`
- `coding`
- `climate`

Rule:

> A course result may be included because any of these entities matched, but the response must expose which grain caused the match.

### 5. What Makes A Result Rank Higher?

Ranking proceeds after primary eligibility is established.

Eligibility first:

1. Satisfy all hard constraints.
2. Match the selected/default term unless historical search was requested.
3. Have at least one matching section when section constraints exist.

Then rank by layered signals:

#### Relevance

- exact CRN
- exact course code
- exact title match
- close title match
- subject/number match
- FTS match
- semantic match
- topic alias match

#### Constraint Specificity

- Results matching more stated intent rank higher.
- Section-level matches beat course-only approximations for section queries.
- Instructor-context matches beat global instructor approximations for instructor queries.

#### Term Priority

- selected term first
- active/registrable term next
- recent historical terms after
- old historical results only when relevant or requested

#### Availability

- Open sections rank above restricted/closed sections when the user asks for availability.
- Availability should be shown even when it does not dominate ranking.

#### Preference Fit

- easier/higher-GPA options for `easy` and `gpa booster`
- better instructor-quality evidence for `decent professor`
- lower difficulty when relevant
- sufficient sample size/confidence where applicable

#### Freshness And Confidence

- Fresher current-term data ranks above stale current-term data.
- Exact source-backed facts rank above fuzzy inferred matches.

Scores should support explanation. The UI should be able to say why the result won.

### 6. What Evidence Explains A Match?

Every response should expose both interpreted query evidence and per-result evidence.

Interpreted query shape:

```ts
interface InterpretedQuery {
  raw: string;
  hardFilters: InterpretedTerm[];
  preferences: InterpretedTerm[];
  residualText: string[];
  ambiguities: Ambiguity[];
  warnings: QueryWarning[];
}
```

Per-result evidence shape:

```ts
interface MatchEvidence {
  type:
    | 'course'
    | 'offering'
    | 'section'
    | 'meeting'
    | 'instructor'
    | 'requirement'
    | 'topic'
    | 'difficulty'
    | 'freshness';
  label: string;
  source?: string;
  confidence?: 'exact' | 'high' | 'medium' | 'low';
  ageSeconds?: number;
}
```

Evidence should answer:

- why this result matched
- which hard constraints it satisfied
- which soft preferences it ranked well for
- which sections actually matched
- which source backs each important fact
- how fresh current-term information is
- what was fuzzy, missing, or ambiguous

### 7. What Happens When No Exact Result Exists?

Primary results must not silently violate hard constraints.

If exact results are sparse or empty:

1. Return exact results first, even if zero.
2. Return suggested relaxations.
3. Optionally return relaxed results separately.

Example:

`graduate algorithms`

If only one graduate algorithms course exists:

- Show that one exact result.
- Explain `Only 1 exact match`.
- Suggest relaxations:
  - include 400-level courses
  - include all levels
  - search for `algorithms` broadly
- Do not mix undergraduate courses into the primary list as if they satisfy `graduate`.

Soft preferences behave differently. If `easy` cannot be strongly satisfied, a result can still appear in primary results, but evidence should say difficulty data is missing, weak, or only partially favorable.

### 8. What Ambiguities Should The Engine Handle?

#### CS

- `CS 225` means Computer Science subject.
- `CS courses` means Computer Science subject.
- `CS gen ed` or `cultural studies` means Cultural Studies GenEd.

#### Humanities / Natural Sciences / Social Sciences

- Bare `humanities` may default to GenEd intent because that is a common student query.
- `humanities department` should mean subject/department/topic.
- The response should show an interpretation chip either way.

#### Intro

- `100 level` means hard level filter.
- `intro spanish` may mean beginner/100-level preference.
- `intro to compilers` should stay topical; do not force 100-level.

#### Advanced

- `advanced comp`, `adv comp`, and `writing intensive` mean ACP.
- `advanced CS` can be upper-level preference or 400-level depending on wording.
- `400 level` is hard.

#### Easy

- `easy` defaults to a soft preference.
- `difficulty:easy`, `only easy`, or an explicit UI filter makes it hard.

#### Professor Quality

- `with Fagen` is named instructor intent.
- `decent professor` is a soft instructor-quality preference.

## Result Shape

The primary result should be a course option, not a raw course row.

```ts
interface CourseOption {
  course: CourseSummary;
  offering: TermOfferingSummary;
  matchingSections: SectionSummary[];
  matchedInstructors: InstructorContextSummary[];
  scores: {
    relevance: number;
    preferenceFit: number;
    freshness: number;
    final: number;
  };
  matchEvidence: MatchEvidence[];
  warnings?: ResultWarning[];
}
```

The exact names may change during implementation, but the shape must preserve these ideas:

- course identity
- term/offering context
- matching sections
- matched instructors
- score breakdown
- evidence
- warnings

## Query Language V1

### Natural Language

Supported natural-language features:

- course codes
- CRNs
- subject names/codes/common aliases
- GenEd/requirement language
- credits
- level
- days
- time buckets
- part of term
- online/in-person
- open/closed/available
- named instructors
- basic negation
- difficulty/quality preferences
- residual topical search

### Power Syntax

Supported power syntax:

- `subject:CS`
- `gened:HUM`
- `gened:any(HUM,US)`
- `gened:all(NW,US)`
- `credits:3`
- `level:400`
- `crn:12345`
- `status:open`
- `online:true`
- `days:MWF`
- `time:morning`
- `term:spring-2026`
- quoted phrases if implemented end to end
- dash negation only if implemented end to end

If quoted phrases or dash negation are not implemented end to end, they should be removed from the documented V1 until they are.

## Out Of Scope For V1

- full schedule conflict detection
- personalized degree audit
- nested boolean syntax
- arbitrary natural-language time ranges unless implementation is straightforward
- prerequisite eligibility
- chat assistant mode
- user accounts or saved schedules
- perfect professor-quality inference
- exact workload prediction

These may be future features, but they are not required for the first robust search contract.

## Evals Required By This Contract

Task-based evals should cover:

- `CS 225`
- `CRN 12345`
- `easy advanced comp open not Friday`
- `CS 400 level machine learning`
- `3 credit humanities gen ed online`
- `data science class with good professor`
- `open second half semester course`
- `courses about sustainability that fulfill social science`
- `beginner coding class not CS major`
- `MATH class with no morning sections`
- `intro to compilers`
- `CS gen ed`
- `cultural studies gened`
- `humanities department`

Each eval should assert:

- interpreted hard filters
- interpreted soft preferences
- residual topical text
- primary results do not violate hard constraints
- relaxed results, if any, are separated
- match evidence explains the result
- freshness or term status is represented where relevant

## Revision Rules

This contract should be revised when:

- user testing shows common intent is misclassified
- data availability makes a promised feature impossible or misleading
- UI design needs a different result grain
- search evals prove a hard/soft classification is wrong
- platform constraints make a proposed execution model too costly

Revisions should update:

- this document
- query DTO types
- golden/task evals
- parser/extractor/resolver tests
- user-facing docs or UI chips

Do not quietly change behavior without updating the contract.

