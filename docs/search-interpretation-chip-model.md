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

- `Requirement match matters`
- `Schedule or delivery fit matters`
- `Online preferred` when `Online` is already a chip
- `Low workload preferred` when `Easy workload` is already a chip

These may still appear in result explanations, confidence reasons, warnings, or
debug/eval output.

## Generic GenEd Intent

When the query literally says `gened`, `gen ed`, or `gen-ed` and no specific
bucket is extracted, the planner applies an explicit `Any GenEd` constraint.
This means the result must have a structured GenEd mapping. The UI shows one
`Any GenEd` chip instead of hiding the requirement intent in ranking.

Queries like `counts for something` remain ambiguous. They create requirement
and degree-progress intent, but they do not become `Any GenEd` unless the user
actually asks for GenEd. Personal degree progress requires student-profile or
degree-audit context.

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
