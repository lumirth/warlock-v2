# Search Interpretation Chip Model

The search page chip row is a student-facing contract, not a debug trace of the
planner. A chip should appear only when removing it changes what the student
reasonably believes the search is asking for.

## Public Chip Classes

### Constraint Chips

Concrete filters extracted from the query or advanced controls.

Examples:

- `Subject CS`
- `Course CS 225`
- `Online`
- `3 credits`
- `GenEd HUM`
- `Any GenEd`

These chips are removable because they constrain the result set.
When space is tight, cards and chips may use concise public codes such as `US`,
`HUM`, or `COMP1`, but controls should lead with readable names such as
`US Minority Cultures`, `Humanities & the Arts`, or `Composition I`.

### Preference Chips

Student language that changes ranking or soft filtering, but is still a direct
user request.

Examples:

- `Easy workload`
- `Low writing preferred`
- `Low exam load preferred`
- `No listed prerequisite preferred`
- `Avoid math-heavy courses`

Show only one chip for one user request. If `easy` already produced `Easy
workload`, do not also show `Low workload preferred`.

### Topic Chips

Residual topic text after structured constraints have been extracted.

Examples:

- `Topic: movies`
- `Topic: algorithms`

Topic chips are removable because removing them broadens the search.

## Internal Assumptions

Planner assumptions explain ranking mechanics or uncertainty. They should not
be shown as public chips when they are not directly removable user constraints.

Examples:

- `GenEd match matters`
- `Schedule or delivery fit matters`
- `Online preferred` when `Online` is already a chip
- `Low workload preferred` when `Easy workload` is already a chip

These may still appear in result explanations, confidence reasons, warnings, or
debug/eval output.

## Action Authoring

Chip actions are executable continuations, not display annotations. Build them
from the executable `meta.nextRequest`, while using `meta.interpretedRequest`
only for display copy and advanced-form interpretation. A removable chip must
either remove an exact public filter from the executable request or remove raw
text from the original executable query. Removing text from the already-stripped
display query is a no-op trap.

Chip `source` should preserve provenance:

- `manual_override` for explicit request or advanced-control filters.
- `advanced_control` for UI controls when they are distinct from raw URL/manual
  request overrides.
- `natural_language` for parser/resolver/extractor hints.

Every removable chip should have a test proving its `action.nextRequest` changes
the represented intent.

## Generic GenEd Intent

When the query literally says `gened`, `gen ed`, or `gen-ed` and no specific
category is extracted, the planner applies an explicit `Any GenEd` constraint.
This means the result must have a structured GenEd mapping. The UI shows one
`Any GenEd` chip instead of hiding the requirement intent in ranking.

Queries like `counts for something` remain ambiguous. They create requirement
and degree-progress intent, but they do not become `Any GenEd` unless the user
actually asks for GenEd. Personal degree progress requires student-profile or
degree-audit context.

## Context-Aware Ambiguity Routing

Some campus terms have two legitimate meanings. The chip row should show the
meaning the resolver chose, not the first raw extraction hint.

The resolver uses this priority order:

- Exact structured course codes are unambiguous: `CS 225` means the Computer
  Science course.
- Explicit field syntax or full department names are user control:
  `subject:CS` and `computer science` mean the Computer Science subject.
- Explicit requirement phrases win the requirement bucket: `cs gened`,
  `gened cs`, and `cultural studies` mean the Cultural Studies GenEd bucket.
- Broad requirement-shopping language such as `easy`, `chill`,
  `grade booster`, or `low workload` biases overloaded short codes toward
  requirement shopping. `easy cs` therefore defaults to Cultural Studies, with
  Computer Science offered as a correction.
- Avoidance constraints alone do not flip an overloaded code. `no exams CS`
  still means the Computer Science subject because exam avoidance can apply to
  a department search.
- Plain department browsing language such as `CS courses`, `CS classes`, or
  `CS department` stays on the subject meaning, with Cultural Studies available
  as a correction when useful.

The same model applies to other overloaded codes, for example `PS` as Political
Science subject versus Physical Sciences GenEd.

## Result Evidence

Result evidence must describe facts, not planner mechanics.

Do:

- `Any GenEd: QR`
- `GenEd HUM`
- `Online delivery`
- `Easier workload fit`

Do not:

- `Requirement lane match` on a course with no requirement mapping
- duplicate `Easy workload` and `Low workload preferred`
- show hidden ranking assumptions as removable filters
