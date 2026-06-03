# Search Quality & Benchmark Audit — 2026-06-03

> Audience: the engineer (human or agent) who will fix search relevance and rebuild the
> evaluation corpus. This is a read-only diagnosis. **No code was changed to produce it.**
> It captures the full reasoning, the raw evidence from live staging, and where to aim.

> Implementation status: this report is a historical pre-fix audit, not a live status page.
> The follow-up implementation in this branch addresses broad query understanding, result-coherence
> evals, level-aware workload ranking, full gen-ed display, part-of-term filters, and visible
> section/meeting details. Treat the tables below as the original diagnosis unless a newer report
> says otherwise.

---

## 0. TL;DR

Alpha users report incoherent results. They're right, and it's systematic, not anecdotal.
Across **78 realistic, clumsy student queries run against live staging**:

- **~22% returned zero results** on entirely reasonable queries.
- **~19% leaked junk tokens** ("no", "is", "without", "which") into keyword search.
- A normal query with an apostrophe — **"what's an easy gen ed" — 500-crashes** (the
  apostrophe-free "whats an easy gen ed" works).
- The flagship failure: **"easy science but no math" returns *Real Analysis* and *Linear
  Algebra*.**

The system passes **only** the narrow query shapes it was engineered and benchmarked for
(multi-constraint decision strings, schedule language, gen-ed *with* an explicit cue word) and
**falls off a cliff on the long tail of how real students actually type.** Read that as the
diagnosis, not as comfort: the green benchmark is **overfit** to those shapes, which is exactly how
it ships green while ~a quarter of real traffic breaks. **Nothing here is "mostly done."**

There are **four distinct root problems wearing one costume**, and they need different fixes:

1. **Query understanding** (most failures): negation, cue-less gen-eds, superlatives,
   question phrasing, slang, shorthand, residual hygiene.
2. **A data / ingestion gap**: the `US`, `NW`, `WCC` gen-ed filters return zero. `search.ts`
   already filters the rich `course_gened` table correctly — matching `category_id` *or*
   `attribute_code` (verified) — so this is a genuine **ingestion gap** (those sub-attribute rows
   aren't being written), not a query bug. (Separate, narrower read-path issue: the DTO/display
   still flatten every course to one `courses.gened`, so multiple gen-eds per course aren't shown.)
3. **A broken ranking primitive**: `difficulty=easy` is implemented as "highest average GPA,"
   which surfaces tiny **graduate seminars**. This fails *even when the query is shaped
   perfectly*, so understanding fixes alone won't help.
4. **A data-fidelity gap (§8.5)**: the read path (DTO) discards a large amount of detail the DB
   already stores — **part-of-term, section start/end dates, the per-meeting structure, topics-course
   section titles, restrictions/approval, prereqs, would-take-again %, median GPA**. Search can only
   surface what it carries, and some inferred intents (compressed-term, no-prereq) are promises the
   exposed data can't keep.

And underneath all of it: **the benchmark corpus measures the wrong thing** (parse-conformance,
not result coherence) and **launders the system's current behavior into "golden truth,"** so it
stays green while a quarter of real queries are broken.

> **Read §0.5 before doing anything.** Every specific query, course, and failure in this report
> is a *probe of a systemic gap*, not an item on a to-do list to make pass.

---

## 0.5 The mandate: fix the class, not the instance

**This is not a task about closing these specific gaps. It is about closing the broader systemic
gaps these specific problems reveal.** Every query, course, and failure named in this report is a
**diagnostic probe**, deliberately chosen to expose an underlying capability that is missing or
broken. They are instruments, not targets.

- Making `"easy science but no math"` work by special-casing that phrase, or adding a one-off
  `orgo→CHEM` alias, or hardcoding the result list for a named query, is **not a fix — it is
  reward-hacking this report.** The real targets are the *classes* those probes reveal: a general
  **negation operator**, a real **shorthand-resolution system**, **context-aware gen-ed
  mapping**, a **level-aware difficulty model**.
- **This is literally the failure that produced the broken benchmark (§10):** the corpus overfit
  to specific query shapes, so it stayed green while the underlying capability was absent. Fixing
  the named examples one-by-one *reproduces that same mistake* in the application code. Do not.
- **Litmus test for every change:** it must generalize to queries that are **not in this
  report**. A negation fix has to handle "stats without coding", "no labs", "a history class
  that isn't writing-heavy" — none of which are listed here. A shorthand fix has to handle
  shorthands we didn't probe. If a change only moves the cited examples and nothing else, it is
  wrong, regardless of whether the examples now pass.
- **The benchmark rebuild (§11) is the enforcement mechanism for this.** It must include
  **held-out and freshly-generated** cases in each failure class precisely so that special-casing
  the known examples cannot pass it. Build the general fix; prove it on queries you didn't get to
  see in advance.

The specific result sets in §8 are **assertions to author the benchmark against**, not values to
look up in the parser. The fix is the general capability that *produces* those results, never a
table that *returns* them.

---

## 1. How to read this report

- §2–3: orientation (architecture) and method (so you can reproduce and verify fixes).
- §4–7: what's wrong, with evidence and the "where it is vs. where it should be" framing.
- §8: **what the search *should* have returned**, proven by carving each query into the right
  shape against the real data.
- §9: the three fix tracks.
- §10–11: the benchmark is the deeper problem — why, and how to rebuild it into a true one.
- §12–13: prioritized aim and landmines.
- Appendices: raw evidence + reproduction recipe.

---

## 2. System under audit (orientation)

Monorepo. Search lives in `apps/api`:

- **Pipeline** (`apps/api/src/services/`):
  1. `query-parser.ts` — power-user syntax (`gened:HUM`, `status:open`, quoted phrases).
  2. `extractor.ts` — three-phase extraction: regex → alias → NLP (compromise).
  3. `query-resolver.ts` — validates hints against the DB (subjects, instructors).
  4. `search.ts` — hybrid retrieval: keyword (FTS5) + semantic (Vectorize) fused with RRF.
  - `search-pipeline.ts` — `createSearchPlan()` / `SearchPipeline` orchestrate the above and
    produce `plan.filters`, `plan.softPreferences`, `plan.rescue`.
  - `alias-registry.ts` — subject/gen-ed/difficulty/delivery/status/days/time aliases. **Gen-ed
    natural-language aliases are cue-gated** (see §4).
  - `topic-registry.ts` — topic expansions (ai→artificial intelligence, etc.).
  - `decision-plan.ts` — the "rescue" layer (query types, negative terms, assumptions).
- **API**: `GET /api/search?q=<text>` plus structured override params:
  `subject, number, instructor, term, year, gened, credits, days, time, online, status,
  difficulty`. (Note: **there is no `level` param** — relevant later.) Response carries
  `meta.plan.filters`, `meta.query.residual`, `meta.plan.softPreferences`, `meta.plan.rescue`,
  `meta.ui.chips`, and `results[]`.
- **Eval** (`apps/api/src/eval/` + `scripts/eval-smoke.ts`): ~114 golden queries, an offline
  smoke runner (mock D1), coverage requirements. `npm run eval:smoke` **runs and passes today** —
  but note it only checks the **parse layer** against a mock DB, never result coherence. That gap
  is the core benchmark weakness (§10), not a broken script.

Staging API: `https://uiuc-course-search-staging.lumirth.workers.dev/api/search`.

---

## 3. Methodology

1. **Source reading** to confirm mechanisms (extractor, alias-registry, topic-registry, eval).
2. **Live diagnostic batch**: 78 realistic clumsy queries across 10 categories (negation,
   cue-less gen-eds, diversity language, vibe/slang, superlatives, non-major framing,
   shorthand/typos, question-form, schedule, instructor/registration). For each we captured the
   interpretation (`filters`, `residual`, `softPreferences`, `rescue`, `chips`) and the top
   results. Auto-flagged zero-results, junk-residual, errors.
3. **Oracle / carve pass**: for each broken query, we forced the *correct* interpretation using
   the structured override params (e.g. `gened=NAT&difficulty=easy`) to discover what the data
   can actually return. This cleanly separates **understanding** failures (data is there, wrong
   shape) from **data** failures (right shape, still empty) and **ranking** failures (right
   shape, wrong order).

Reproduction recipe in Appendix C.

---

## 4. Root cause: the system understands, then overrides itself

The single most important finding. The pipeline computes a genuinely smart interpretation
(`rescue` plan, `negativeTerms`, `softPreferences`) and then a **greedy hard filter extracted
from the same words overrides it.** The dumb layer wins.

```
Q: "easy science but no math"
  filters : {"subject": "MATH", "difficulty": "easy"}      <-- filtered TO math
  residual: "science no"                                    <-- junk to FTS5
  soft    : {"lowMath": 0.86, "lowWorkload": 0.84}          <-- understood "avoid math"
  rescue  : negatives [math_heavy, calculus, statistics], assume [low_math]
  results : MATH 540 Real Analysis, MATH 227 Linear Algebra, MATH 466 Applied Random Processes
```

It correctly understood "avoid math," then filtered **to** math and returned the hardest math
courses in the catalog. The `softPreferences` / `rescue` layers are largely **decorative**: they
don't gate retrieval or re-rank strongly enough to overcome a wrong hard filter.

More inversions:
- `"bio no chem"` → `{subject: CHEM}` — kept the **negated** term as the filter, dropped the
  positive one (bio), returned Organic Chem.
- `"cs but no math"` → `{subject: CS}` + soft `lowMath` + residual `"no"` → **0 results**.

**Why it happens (mechanism, confirmed from source):**
- "math" matches the `MATH` subject alias; "no/but no" is never applied to subject hints.
  Negation in the codebase only exists for a hardcoded set of **schedule** fields ("no friday",
  "no morning") and a few workload-avoidance phrases. There is no general negation operator.
- "science" → NAT exists in `alias-registry.ts` but is **cue-gated** (`requiresCue: true`); the
  cue list is only `gen ed / gened / gen-ed / requirement / category`. No cue in the query → no
  NAT mapping → "science" survives into residual.
- Residual cleanup doesn't strip connectives, so "science no" reaches FTS5.

---

## 5. Failure taxonomy (with evidence)

Each mode below is backed by live staging output (full rows in Appendix A).

1. **Negation is unimplemented for subjects/topics.** Works only for hardcoded schedule
   ("no friday"→`not:{days}`). Subject/topic negation inverts ("no math"→MATH) or zeroes out
   ("psych no stats"→PSYC+STAT→0; "econ without calculus"→ECON+residual→0).

2. **Cue-gated gen-eds fail the most common phrasings, and the fuzzy matcher mis-routes.**
   `"science gen ed"`→NAT ✓, but `"easy science class"`→**`subject: ACES`**(!),
   `"social science class"`→residual, `"natural science"`→residual, `"writing requirement"`→
   residual (ACP missed). The cue requirement blocks the natural phrasings; the fuzzy subject
   matcher then mis-fires "science"→ACES.

3. **Diversity / identity language maps to nothing.** `"diversity"`, `"race and ethnicity
   class"`, `"gender studies"`, `"class about other cultures"` → no gen-ed filter. Students
   universally call US/NW/CS the "diversity" requirement.

4. **Superlatives are dropped to residual → 0 results or noise.** `"easiest math class"`→0,
   `"hardest cs class"`→0, `"highest gpa classes"`→noise, `"best professors"`→noise. These are
   **sort intents** (there is planned sort work — they should route to it).

5. **Residual pollution (~19%).** Connectives and interrogatives reach FTS5: "no", "is",
   "without", "which is", "what should i take", "for", "how is" → 0 results or noise.

6. **Question-form queries are inverted or crash.** `"is cs 225 hard"`→`difficulty: hard`
   filter→0 (the student is *asking*, not requesting hard courses). `"how hard is orgo"`→`hard`
   +0. `"what's an easy gen ed"`→**500 crash** (apostrophe). `"what should i take after cs
   225"`→filters *to* 225→0.

7. **Shorthand/typo gaps and mis-resolution.** `"comp sci"`→CS ✓ but `"compsci"`→nonsense;
   `"orgo"`→nonsense (should be CHEM), `"ochem"`→**BIOC** (wrong subject; should be CHEM),
   `"diffeq"`→nonsense (should be MATH), `"macroecon"`→nothing structured (lucky semantic ECON).

8. **Soft preferences are detected but not enforced in ranking.** `"physics for non majors"`→
   `nonMajorFriendly: 0.72` detected, but returns PHYS 403 *Modern Experimental Physics* and grad
   seminars; PHYS 100/101 never surface.

9. **"Easy" is mis-defined as "high average GPA" → graduate seminars.** `"gpa booster"`,
   `"chill class"`, `"easy a"` all surface tiny grad courses (ABE 199, ACCY 518, CLE 799, IS
   505) a sophomore can't take. (See §8 for the proof this persists even when the query is
   shaped perfectly.)

10. **Result hygiene.** Duplicate courses across terms and cross-listings (MATH 540 ×2, ACES 298
    ×3, "Constructing Race in America" as both AAS 281 and AFRO 281); grad-course domination of
    casual queries; null-GPA courses ranked highly despite GPA-oriented intent.

11. **The overfit, stated plainly (this is not a "what works" lap).** The *only* shapes that
    behave are the exact ones the corpus drilled — hand-built decision strings, schedule language,
    gen-ed *with* an explicit cue. That is the diagnosis, not reassurance: the system is sharp
    precisely and only where the benchmark is dense (§10), which is how it ships green while the
    long tail breaks. Any "this part already works, leave it" instinct is the trap.

---

## 6. Quantitative results (78 queries)

| Metric | Result |
|---|---|
| Zero-result rate (reasonable queries) | **~22%** |
| Junk-residual rate | **~19%** |
| 500 crash | Yes — any apostrophe (`'`) in the query |
| Subject filter mis-extracted from a topical/negated word | pervasive (negation cases, "science"→ACES) |
| Grad courses dominating "easy/booster/chill" | pervasive |

A health gate of "zero-result rate < 5%" would fail today at ~22%.

---

## 7. Capability map: where it is vs. where it should be

| Capability | Now | Should be |
|---|---|---|
| Negation | Hardcoded schedule only; subject/topic inverts or zeroes | "no/without/not/avoid X" removes X as positive, adds it as negative, across subjects/topics/gen-eds/workload |
| Cue-less gen-eds | Cue required; cue-less science→ACES, social science→residual | "science/social science/writing/lab science" → NAT/SBS/ACP, using context to exclude "computer/political/data science" |
| Diversity language | Unmapped | "diversity/race/cultural/other cultures" → US/NW/CS |
| Superlatives | Dropped → 0/noise | Route to sort over honest difficulty/GPA/level signals |
| Question phrasing | Inverted ("is X hard"→hard); apostrophe→500 | Strip interrogatives; "is X hard" = look up X; never 500 on punctuation |
| Soft-pref enforcement | Detected, not enforced | A detected preference must move ranking (non-major→100-level; low_math→exclude math) |
| "Easy" semantics | High avg GPA → grad seminars | Level-appropriate + low-workload evidence, not raw GPA |
| Shorthand/typo | Partial; misses orgo/ochem/diffeq/compsci/macroecon; ochem→BIOC | Validated student-shorthand lexicon |
| Result hygiene | Cross-listing/multi-term dupes; grad domination; null-GPA ranked high | Dedup by course; level-appropriate defaults; ranking uses the implied signals |
| Residual | Leaks connectives/interrogatives | Aggressive cleanup; stopwords/question words never reach FTS5 |

---

## 8. What the search SHOULD have returned (carve-verified)

The oracle pass forced the correct interpretation via override params. For almost every broken
query, **the ideal answers exist in the data and are one correctly-shaped request away.** Use
these as the **target result sets** when authoring the new benchmark (§11) — as *assertions* the
general fix must satisfy, **not** as a lookup table to hardcode in the parser (see §0.5). The fix
is the capability that produces these results; the query in each row is just one probe of it.

| Query | Got | Should return (real courses, carve-verified) | Gap |
|---|---|---|---|
| "easy science but no math" | MATH 540 Real Analysis | `gened=NAT,difficulty=easy` → **ASTR 150 Killer Skies, ATMS 120 Severe Weather, ANSC 207 Science of Pets, ANTH 246 Forensic Science, ESE 143 History of Life** (41+, 100–200 lvl) | understanding |
| "social science class" | residual noise | `gened=SBS` → **HK 111 Intro Public Health, GGIS 101, ANTH 210, CI 210** (41+) | understanding |
| "diversity" | `{}` | `gened=CS` → **AAS 100 Intro Asian American Studies, AFRO 132 African American Music, AAS 281 Constructing Race in America** (41+) | understanding |
| "orgo" / "ochem" | nonsense / BIOC | `subject=CHEM, organic` → **CHEM 236 Fundamental Organic Chem I, CHEM 232/233** | understanding |
| "intro to compsci" | MUS 172, BCS 202 | `subject=CS, introduction` → **CS 124 Introduction to Computer Science I** (gpa 3.67) | understanding |
| "physics for non majors" | PHYS 403 (grad) | `subject=PHYS, conceptual` → **PHYS 100 Thinking About Physics** | understanding + ranking |
| "is cs 225 hard" | 0 results | `subject=CS,number=225` → **CS 225 Data Structures** (11 sections) | understanding |

### Exception 1 — a genuine DATA GAP (ingestion, not parsing)

```
gened=US  -> 0 results
gened=NW  -> 0 results
gened=CS  -> 41+ results   (AAS, AFRO, ...)
gened=ACP -> 41+ results
```

`US` (US Minority Cultures) and `NW` (Non-Western Cultures) — and almost certainly `WCC`
(Western/Comparative) — are **completely unpopulated.** Cultural Studies courses are all tagged
`CS`; the subcategories are being flattened during ingestion. CLAUDE.md lists US/NW/WCC as valid
gen-ed codes, but they are dead in staging. **No parser fix can help here** — until ingestion
populates these codes, an entire class of requirement searches is impossible. **Verify WCC; fix
the ingestion mapping of Cultural Studies subcategories.**

### Exception 2 — the ranking primitive is broken even when carved correctly

```
Q carved correctly: subject=MATH, difficulty=easy   ("easiest math class")
  -> MATH 199 Seminar, MATH 595 Advanced Topics (GRAD), MATH 580 Combinatorial (GRAD),
     MATH 542 Complex Variables (GRAD), MATH 424 Honors Real Analysis
```

The accessible easy math a student wants — MATH 124 Finite Math, MATH 125, STAT 100 — never
appears. **`difficulty=easy` is implemented as "highest average GPA," and small graduate
seminars have the highest GPAs.** So the easy-seeker is shown unreachable grad courses, and *no
understanding fix changes this*, because the ranking definition of "easy" is wrong. `"hardest cs
class"` carved to `subject=CS` returns CS 100 Orientation (gpa 3.84) next to CS 507 Crypto,
because "hardest" isn't a difficulty sort at all. The data supports doing this right
(`difficulty_score`, `avg_gpa`, course level all exist); the primitive squanders it.

---

## 8.5 Data-fidelity gap: what the system stores but never surfaces

Part-of-term and section date ranges *are* missing — and they're the visible edge of a broad
pattern. **The DB schema (and the Course Explorer source) capture far more than the read path
exposes.** Search can only filter, rank, or display what the DTO carries, and
`apps/api/src/dto/course.ts` drops a large fraction of what's stored. Worse, several soft
preferences the system *already infers* are **unsatisfiable** because their backing data is in the
DB but never surfaced.

### Section fields stored but absent from `CourseSectionDto`

| Field (in `sections`) | What it is | Surfaced? | Why it matters |
|---|---|---|---|
| `part_of_term` ("1","A","B") | full-term vs first/second half | **No** | The "8-week"/`compressedTerm` intent (golden 111/112) can't be satisfied or shown. |
| `start_date` / `end_date` | actual section date range | **No** | Compressed/late-start sections invisible; "8 week" unfilterable. |
| `date_range_text` | human-readable date range | **No** | same |
| `section_title` | per-section title for **topics** courses | **No** (but FTS-indexed) | CS 498 "Deep Learning" shows as generic "Special Topics"; the real topic is hidden even though search indexes it. |
| `section_notes` | major/level restrictions | **No** (FTS-indexed) | A student can pick a section they're barred from. |
| `capp_area` | James Scholars / honors | **No** | Honors/scholar sections unmarked. |
| `section_text` | detailed section info | **No** (FTS-indexed) | searchable but never shown. |
| `credit_hours` (section override) | variable-credit per section | **No** | variable-credit courses misreported. |
| `status_code` / `section_status_code` | granular status | **No** | only coarse Open/Closed text surfaces. |

### The `meetings` table is essentially dead in the read path

The schema models **multiple meetings per section** (`meetings`: type, days, time, `building_name`,
`room_number`, date range; plus `meeting_instructors` M2M). The DTO ignores it and uses the
**flattened** `sections.days/start_time/end_time/location/instructor`. So a lecture+lab/discussion
structure collapses to one row; building/room becomes a single free-text `location` (often "TBA")
instead of structured building+room; multiple meeting patterns and per-meeting instructors are lost.

### The multi-gen-ed table: filtering uses it; display and ingestion don't

**Correction to an earlier hypothesis, verified in `search.ts`.** The gen-ed *filter* already
JOINs the rich `course_gened` table and matches `(cg.category_id = ? OR cg.attribute_code = ?)` —
so it *does* look at the US/NW/WCC `attribute_code`. The filter path is **not** the bug. Therefore
`gened=US`/`NW` returning zero means `course_gened` genuinely **has no US/NW/WCC rows** — a real
**ingestion gap** (the sub-attributes aren't being written), consistent with Exception 1 (§8).
What *is* a read-path gap is narrower and about **display**: the DTO (`course.gened`) and
`courses_fts` use the single flattened column, so a course's *multiple* gen-eds are never shown or
keyword-searchable even though the filter can match them. Two fixes, different layers: (1)
ingestion must populate `course_gened` with US/NW/WCC; (2) the DTO/display should expose a course's
full gen-ed set, not one.

### Course fields stored but dropped

`course_info` (prereqs, cross-listings), `degree_attributes`, `class_schedule_info`,
`date_range_text`, `registration_notes`, `approval_code` — all on `courses`, **none in
`CourseDto`.** So **prerequisites and cross-listings exist in the data but are never parsed or
shown**, which is why "no prereq" (golden 109) can't be honored and a student can't see "needs
department approval."

### Instructor / quality signals stored but dropped

- `rmp_cache.would_take_again_pct`, `rmp_cache.top_tags`, `rmp_cache.department` — would-take-again
  %, "tough grader" tags: **not in `InstructorLinkDto` at all.**
- `instructors.rmp_difficulty` — plumbed to the DTO but **not shown in the UI** (only overall rating).
- `gpa_stats.median_gpa` — stored, **not exposed** (only the more-skewable mean).
- `course_signals` (exam/writing workload evidence with explanations) backs subjective claims in
  retrieval, but the **structured signals aren't surfaced** as course attributes ("3 exams, 2 papers").

### Data-quality subtleties (not just missing — wrong or unrepresentable)

- **Descriptions look polluted.** `CS 225`'s `description` returns as `"Quantitative Reasoning"` (the
  gen-ed label, not catalog text). Since `courses_fts` indexes `description`, bad descriptions
  directly degrade keyword *and* semantic relevance — a plausible contributor to the poor topical
  results in §5. **Spot-check description quality corpus-wide.**
- **Variable credit can't be represented.** `courses.credit_hours` is a single `INTEGER`; "1 TO 4"
  courses are flattened, and the section-level override that would fix it isn't exposed.
- **No seats/capacity anywhere.** The schema has no enrolled/capacity/waitlist columns; "how many
  seats are left" — a top student question — isn't modeled at all (source limitation to confirm).
- **Two diverging gen-ed vocabularies.** The DB seeds `gened_aliases` with finer codes (`CMP`, `HP`,
  `LA`, `LS`, `PS` — real UIUC sub-areas), while the code-level `alias-registry.ts` knows a
  different, coarser set. Two sources of gen-ed truth that disagree.

### Why this is a structural finding, not a field list

The read path is a **fourth axis**, alongside understanding, data/ingestion, and ranking:

- It **caps what the benchmark can assert** — you can't write a result-coherence check for "is
  registrable / right part-of-term / not honors-restricted" if those never reach the response.
- It **starves the sort/compare feature** you're already building, which wants exactly these
  columns (part-of-term, dates, section type, would-take-again, median GPA, restrictions).
- It **sharpens the US/NW gap**: filtering already uses `course_gened` correctly (verified in
  `search.ts`), so the zero is a genuine ingestion gap — while display still flattens every course
  to a single gen-ed.
- It makes some inferred intents **promises the system can't keep** (compressed-term, no-prereq).

**Audit rule for the fix:** for every signal the query layer can infer, confirm the backing datum
is exposed end-to-end (schema → DTO → API → UI) — or stop inferring it. An intent the data can't
satisfy is worse than no intent.

### Addendum: "a filter touches it" does NOT mean it's exposed or used

Do not mark any field in this section as resolved, or as "already used," because some code path
technically references it. A field counting as *used* requires that the **student** can actually
act on it; internal references are not that. Three traps to refuse:

- **FTS indexing is not exposure.** `section_title`, `section_notes`, and `section_text` are in
  `sections_fts`, so a keyword query can incidentally match on them. That is *not* surfacing them —
  the student never sees the topics-course title, can't filter by restriction, can't read the
  section text. **Indexed ≠ visible, filterable, or sortable.**
- **One narrow consumer is not "used."** If `part_of_term`, a `meetings` row, `start_date`, or
  `course_gened` is read by a single obscure filter or a power-syntax branch, the field is still
  effectively **unused**: it isn't in the DTO, isn't a structured filter/sort the UI offers, and
  isn't shown. "Some feature references it" is the weakest possible bar and **does not count.** The
  `meetings` table being touched anywhere does not make its per-meeting structure (type, building,
  room, multiple patterns) exposed; today the DTO flattens it away regardless.
- **Partial plumbing is not done.** `rmp_difficulty` reaches the DTO but isn't shown; `course_gened`
  exists but search reads `courses.gened`; `meetings` exists but the DTO flattens it. Reaching one
  layer is not reaching the student.

**The bar for "exposed/used":** the datum travels **end-to-end** (schema → DTO → API → UI) *and* is
available to the student as the kind of signal it should be — a **visible attribute**, a
**structured filter**, and/or a **sort key**, as appropriate to that field. Until a student can
see it, filter on it, or sort by it, the gap is **open**, no matter how many internal code paths
mention the column. Closing a §8.5 item by pointing at an existing reference to the field is
laundering (cf. §0.5), not a fix.

---

## 9. The three fix tracks (different owners, different work)

1. **Query understanding** — the bulk. General negation operator; de-cue and contextualize
   gen-ed mapping; diversity→US/NW/CS; superlatives→sort; strip interrogative scaffolding and
   never 500 on punctuation; expand the shorthand lexicon (orgo/ochem→CHEM, diffeq→MATH,
   compsci→CS, macroecon→ECON) and fix mis-resolution (ochem→BIOC); aggressive residual hygiene.
   **For each, §8 gives the target result set to assert against.**

2. **Data / ingestion + read-path fidelity** — `gened=US`/`NW`/`WCC` return zero, and this is a
   genuine **ingestion gap**: `search.ts` already filters `course_gened` correctly (matching
   `category_id` *or* `attribute_code`, verified), so the sub-attribute rows simply aren't being
   written — fix ingestion. Separately, this track owns the **data-fidelity gap (§8.5)**: surface
   part-of-term, section dates, the `meetings` table, topics-course section titles,
   restrictions/approval, prereqs, would-take-again %, median GPA, and a course's *full* gen-ed set
   (the DTO/display still flatten to one) — and stop inferring intents the exposed data can't satisfy.

3. **Ranking primitives** — redefine "easy"/"hard" as **level-aware + workload-evidence**, not
   raw GPA; make superlatives sortable over honest signals; **dedup** cross-listed and multi-term
   courses; stop letting null-GPA grad courses dominate casual queries. **Critical sequencing:
   understanding fixes will still fail the carve test until this is done** (e.g. "easiest math"
   will route correctly and still return grad seminars).

---

## 10. The benchmark is the deeper problem

The corpus (`apps/api/src/eval/`) is **overfit and measures the wrong thing.** Four structural
flaws:

1. **It tests parse-conformance, not result coherence.** `evaluateSearchResponse` checks
   `expected_filters`, `expected_residual`, `expected_rescue`, and a few invariants; only ~3 of
   114 queries assert anything about the actual **results** (`expected_top1_title`). So "easy
   science but no math" → Real Analysis triggers **no failure**, because nothing asserts on the
   result list. The suite is green while users get nonsense.

2. **It launders current behavior into golden truth.** The same author wrote the handler and the
   expectation, so green is self-fulfilling. Concretely, golden query **id 105 "not math but
   counts for science"** *expects* `residual: "science"` and **no NAT mapping** — it blesses the
   exact failure users are reporting. Several expectations encode "what the code does," not "what
   the student means."

3. **It is distributionally unrepresentative.** Dense on clean structured forms ("400 level CS
   MWF morning 3 credits") and a dozen curated decision queries; **absent** on the messy reality
   that's ~22% of real traffic: subject/topic negation, cue-less gen-eds, diversity language,
   superlatives, question phrasing, slang, shorthand, apostrophes, "for non majors", "after X".
   The coverage requirements enumerate failure *classes* but satisfy each with a few *clean*
   examples, not adversarial ones.

4. **No negative or robustness guards.** Nothing asserts "must NOT return math," "must NOT 500,"
   "must NOT be grad-only," "must NOT return zero." A real benchmark guards against failure, not
   just confirms success.

---

## 11. How to rebuild the benchmark into a true one

**Ground rule: author expectations from student intent and from what the data can actually
deliver, independent of what the pipeline currently does. Do not reverse-engineer expectations
from current output.** That is how bugs got laundered in (id 105). The §8 oracle/carve method
*is* your authoring tool: carve a realistic query to its ideal shape, capture the real result
set, freeze it as the assertion.

Concretely:

- **Add a result-coherence assertion layer** to every query, separate from the parse layer:
  top-k **must-contain** / **must-exclude** (subject, gen-ed present, level band, GPA floor,
  not-grad, non-empty). Keep two scorecards — parse-correctness (existing) and result-coherence
  (new) — and **never let parse-green hide result-red.**
- **Re-audit every existing golden entry for laundered bugs.** Start with id 105 (and any entry
  whose `expected_residual` retains a meaningful word, or that maps a clearly-gen-ed phrase to
  `{}`).
- **Rebuild the corpus from the real distribution.** The app already collects feedback in-app —
  mine those submissions and alpha logs for actual clumsy queries, weight by frequency, and add
  the now-missing categories wholesale (negation, cue-less gen-eds, diversity, superlatives,
  questions, slang, shorthand, "for non majors", "after/before X", apostrophes).
- **Add adversarial guards and robustness fuzzing:** must-not-return-X; must-not-500 (apostrophes,
  emoji, empty, gibberish, 500-char input); must-not-grad-dominate; must-not-zero-result on
  reasonable queries.
- **Track aggregate health as gated thresholds**, not just per-query pass/fail: zero-result rate,
  grad-course rate in casual queries, residual-junk rate, crash rate, p95 latency. (Today's run
  fails a "zero-result < 5%" gate at ~22%.)
- **Add contrastive disambiguation pairs:** "computer science"(subject) vs "science gen ed"(NAT)
  vs "easy science"(NAT, not ACES); pin the boundaries that currently mis-fire.
- **Hold out a real-query set the system is never tuned on**, to measure overfit directly.
- **`npm run eval:smoke` already runs**, but it only checks the parse layer against a mock DB. Add
  the missing **result-coherence instrument** that hits a seeded DB or staging and asserts on the
  actual result list — that is the whole point of §10.
- For US/NW/WCC: you **cannot author a positive result-coherence assertion yet** — that absence
  is itself the signal that track 2 (ingestion) is broken. Add a guard that flags these codes as
  zero-coverage so the gap can't silently persist.

---

## 12. Prioritized aim

1. **Stop the bleeding / correctness:** fix the apostrophe 500; add residual hygiene so
   connectives/interrogatives never reach FTS5 (kills a large share of the 22% zero-results
   immediately).
2. **General negation operator** (the #1 user-visible incoherence): "no/without/not/avoid X"
   demotes X instead of filtering to it.
3. **Gen-ed understanding:** de-cue + contextualize science/social-science/writing/diversity →
   NAT/SBS/ACP/US-NW-CS; stop "science"→ACES.
4. **Ranking primitive:** redefine "easy"/"hard" (level-aware + workload), make superlatives
   sortable, dedup. (Unblocks the carve test for the understanding fixes.)
5. **Ingestion:** populate US/NW/WCC.
6. **Shorthand lexicon** + question-phrasing stripping.
7. **In parallel, rebuild the benchmark** per §11 so each fix lands with a result-coherence
   assertion and can't regress.

---

## 13. Landmines / don'ts

- **Don't special-case the cited queries or hardcode their answers (see §0.5).** Every example
  here is a probe of a general capability. A change that only moves the listed strings is
  reward-hacking, not a fix, and it recreates the exact overfit that broke the benchmark (§10).
  Each fix must generalize to queries not in this report, and the benchmark must prove it on
  held-out cases.
- **Don't fix understanding without fixing the ranking primitive.** "easiest math" will route
  correctly and *still* return grad seminars until "easy" stops meaning "high GPA." Verify every
  fix with the §8 carve, not just the parse.
- **Don't launder the corpus.** Author expectations from intent + data, never from current
  output. Re-audit id 105 and friends.
- **Don't relax the gen-ed cue naively** — it exists to stop "computer/political/data science"
  →NAT. The fix is context (standalone "science" vs "X science"), not deleting the gate.
- **Don't treat the soft/rescue layer as sufficient.** It already understands most intents; the
  bug is that hard filters and ranking ignore it. Make the layers agree, with the smart layer
  winning.
- **`difficulty=easy` surfacing grad seminars is a data-semantics trap**, not a query bug — high
  GPA ≠ easy/accessible.

---

## Appendix A — Raw diagnostic evidence (representative)

Live staging, `limit` 3–5. Format: `filters | residual | soft | top results`.

```
"easy science but no math"
  {subject:MATH, difficulty:easy} | "science no" | {lowMath:.86, lowWorkload:.84}
  -> MATH 540 Real Analysis; MATH 227 Linear Algebra; MATH 466 Applied Random Processes

"easy science class"
  {difficulty:easy, subject:ACES} | "science" | {lowWorkload:.84}
  -> ACES 298 International Experience (x3)

"psych no stats"
  {subject:PSYC} | "no" | chips show BOTH "Subject STAT" + "Subject PSYC"
  -> 0 results

"bio no chem"
  {subject:CHEM} | "bio no"
  -> CHEM 236 Fundamental Organic Chem I; CHEM 332 Elementary Organic Chem II

"cs but no math"
  {subject:CS} | "no" | {lowMath:.86}
  -> 0 results

"social science class"      {} | "social science"     -> CI 402; HK 140 (SBS)
"natural science"           {} | "natural science"    -> ESE 118 Natural Disasters
"diversity"                 {} | "diversity"           -> HDFS 208; LER 595
"non western"               {gened_code:NW} | ""       -> 0 results
"us minority"               {gened_code:US} | ""       -> 0 results

"blow off class"            {} | "blow off"            -> ME 510 Advanced Gas Dynamics (grad)
"gut class"                 {} | "gut"                 -> CI 471; MCB 460 (grad)
"easy a" / "chill class"    {difficulty:easy} | ""     -> ABE 199 Undergrad Open Seminar (gpa 3.97)

"easiest math class"        {subject:MATH} | "easiest" -> 0 results
"hardest cs class"          {subject:CS} | "hardest"   -> 0 results
"highest gpa classes"       {} | "highest gpa"         -> GWS 305; GRK 401 (noise)

"physics for non majors"    {subject:PHYS} | "" | {nonMajorFriendly:.72}
  -> PHYS 403 Modern Experimental Physics (grad); PHYS 199 Seminar

"compsci"                   {} | "compsci"             -> DANC 220; MUS 172 (nonsense)
"orgo"                      {} | "orgo"                -> IS 594; GWS 199 (nonsense)
"ochem"                     {subject:BIOC} | "ochem"   -> BIOC 460 (wrong subject)
"diffeq"                    {} | "diffeq"              -> PSYC 432; ESL 510 (nonsense)
"macroecon"                 {} | "macroecon"           -> ECON 422 (lucky); ENVS 420; NUTR 520

"is cs 225 hard"            {subject:CS, number:225, difficulty:hard} | "is"  -> 0 results
"how hard is orgo"          {difficulty:hard} | "how is orgo"                 -> 0 results
"what's an easy gen ed"     *** HTTP 500 ***
"whats an easy gen ed"      {difficulty:easy, gened_any:[...]} | "whats"      -> works
"what should i take after cs 225"  {subject:CS, number:225} | "what should i take after" -> 0

# (Deliberately omitted: the handful of shapes that pass — the corpus-drilled decision strings,
#  schedule language, clean subject aliases. They pass because the benchmark is overfit to them,
#  not because the system is mostly fine. See §5.11. This appendix is a list of what's broken.)
```

## Appendix B — Oracle / carve evidence

```
CARVE gened=NAT,difficulty=easy   -> 41+  ASTR150 KillerSkies; ATMS120 SevereWeather;
                                          ANSC207 SciOfPets; ANTH246 ForensicSci; ESE143
CARVE gened=SBS                   -> 41+  HK111 IntroPublicHealth; GGIS101; ANTH210
CARVE gened=CS                    -> 41+  AAS100 IntroAsianAmStudies; AFRO132; AAS281
CARVE gened=US                    -> 0    *** DATA GAP ***
CARVE gened=NW                    -> 0    *** DATA GAP ***
CARVE gened=ACP                   -> 41+  ENGL109 IntroToFiction-ACP
CARVE subject=MATH,difficulty=easy-> 41+  MATH595(grad); MATH580(grad); MATH542(grad)  *** ranking ***
CARVE subject=CS,"introduction"   -> 41+  CS124 IntroToCS I (gpa 3.67)
CARVE subject=CHEM,"organic"      -> 41+  CHEM236 FundamentalOrganicChem I; CHEM232/233
CARVE subject=PHYS,"conceptual"   -> 16   PHYS100 ThinkingAboutPhysics
CARVE subject=CS,number=225       -> 11   CS225 DataStructures (gpa 3.12)
```

## Appendix C — Reproduction recipe

```bash
# Single query, see interpretation + results:
curl -sG "https://uiuc-course-search-staging.lumirth.workers.dev/api/search" \
  --data-urlencode "q=easy science but no math" --data-urlencode "limit=5" | jq \
  '{filters: .meta.plan.filters, residual: .meta.query.residual,
    soft: .meta.plan.softPreferences, chips: [.meta.ui.chips[].label],
    results: [.results[] | "\(.subject) \(.number): \(.title)"]}'

# Carve the "right shape" via override params (no q):
curl -sG ".../api/search" --data-urlencode "q=" \
  --data-urlencode "gened=NAT" --data-urlencode "difficulty=easy" \
  --data-urlencode "limit=40" | jq '[.results[] | "\(.subject) \(.number): \(.title)"]'
```

Override params accepted: `subject, number, instructor, term, year, gened, credits, days, time,
online, status, difficulty`. Use these to author result-coherence expectations (§11).

---

*End of report. Read-only diagnosis; no application code modified. Verify every search fix with the
§8 carve, not just the parse; and per §11, build the result-coherence instrument that `eval:smoke`
(parse-only) still lacks. Staging is mid-deploy and volatile — treat the §5/§8 interpretation-layer
findings as the stable signal, not exact result payloads.*
