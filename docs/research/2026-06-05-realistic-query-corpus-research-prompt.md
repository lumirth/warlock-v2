# Research & build a realistic, evidence-grounded query corpus for UIUC Course Search

> Status: research prompt / brief, handed to a high-capability research agent.
> It is self-contained. The search engine's internals are deliberately **out of scope** —
> the researcher treats them as a black box (see §0 and §3). If the agent can read the repo,
> the *data shape* is in `apps/api/src/db/schema.sql`, the prior corpus is under
> `apps/api/src/eval/`, and the motivating audit is
> `docs/reports/2026-06-03-search-quality-and-benchmark-audit.md`.

## 0. Your mission, in one paragraph

You are doing original research into **how real people actually type search queries** — specifically how University of Illinois Urbana-Champaign (UIUC) students search for courses, and more generally how humans formulate search queries — and turning that research into a **high-quality, robust, comprehensive corpus of test queries with expected outputs** for benchmarking a course-search engine. The corpus is only valuable if it reflects *genuine* human behavior: the terse, misspelled, slangy, inconsistent, question-shaped, half-formed way people really search — not an idealized, regex-clean fiction. Both the **content** of the queries (what students ask about) and the **shape** of them (how they phrase, abbreviate, and mangle their asks) must be derived from real evidence, not invented.

The crucial framing: **treat the search engine as a black box.** Your job is to define what the *output should be* for a given input — the answer key — so we can build and tune the box against it. You need to know the **shape of the data** (what's knowable about a course, so your expected outputs reference real things) and the **domain** (what students want and how they talk). You explicitly do **not** need to know how queries are parsed, interpreted, or ranked, and you should not try to. Each expected output must be authored from **student intent and what the catalog data can actually deliver** — never reverse-engineered from what any current system happens to return.

Read the rest of this brief before starting. The reasoning matters as much as the instructions, because you will repeatedly hit judgment calls (Is this query realistic? What should it return? An exact answer or a bound? Head or long tail?), and I want you to resolve them in line with the principles here rather than by following a rigid checklist. I am deliberately *not* over-specifying, because over-specification is part of how the last version of this corpus went wrong (§2).

## 1. What the product is (domain context)

**UIUC Course Search** is a smart search engine for UIUC's course catalog. A student types something into one search box — natural language, a course code, a vibe, a question — and the system returns relevant courses. The product's reason to exist is handling intuitive, messy, natural queries better than the university's official catalog tool does.

**Who the users are:** UIUC undergraduates (mostly) choosing classes. Their real tasks:
- Find a specific known course ("CS 225", "is orgo offered in spring").
- Shop for courses that satisfy a requirement, especially **general education ("gen ed") requirements**, which every student must fulfill and which drive enormous "what's an easy one" behavior.
- Find an *easy* / high-GPA / low-workload class ("GPA booster", "blow-off class", "gut").
- Find or avoid a specific professor; check who's teaching.
- Discover courses on a topic ("machine learning", "classes about film").
- Resolve a vague idea into concrete offerings ("a chill 3-credit class after 2pm that counts for something").
- Compare sections, check schedule fit, check if a class is open.

This is a narrow, high-context population (one university, mostly 18–22-year-olds, in a registration mindset) searching a specialized catalog. General web-search research informs the *shape* of their queries; the *content* is course-domain-specific. Keep both in view.

## 2. Why we're doing this — the reasoning that should govern your judgment

A prior internal audit of this exact system found that it **passes only the clean, well-formed query shapes it was built and tested on**, and **falls apart on the messy long tail of how students actually type.** On ~78 realistic, clumsy queries: ~22% returned **zero results** on perfectly reasonable asks; ~19% treated filler words ("no", "is", "without", "which") as search terms and returned noise or nothing; an apostrophe (`what's an easy gen ed`) caused a **500 crash**; and the flagship failure — **`easy science but no math` returned *Real Analysis* and *Linear Algebra*** (it grasped "avoid math," then returned the hardest math courses in the catalog).

Two lessons from that audit bear directly on your job:

1. **The benchmark measured the wrong thing and was overfit.** It mostly checked whether a query was *interpreted* into an expected internal form, rather than whether the *results a student actually sees* are good. It was dense on tidy structured forms and a dozen curated strings, and **absent** on the messy reality that is ~a quarter of real traffic. So it shipped green while users got nonsense. **Your corpus must assert on the output a student sees** — and it must be drawn from the real distribution, not from whatever shapes are convenient to author.

2. **Expectations were "laundered" from current behavior.** Because the same author wrote both the handler and the expectation, "correct" became self-fulfilling — at least one entry literally *blessed a known bug as the expected output*. **You must not do this.** Author every expected output from (a) what the student *means* and (b) what the catalog can *actually deliver* — independently of what any current system returns. This is the whole reason for the black-box stance: you are writing the answer key *for* the engine, not *from* it.

The failure mode you're guarding against is a neat, comfortable corpus that looks comprehensive while quietly encoding the system's current blind spots. When a choice is between "clean and convenient" and "true to how people actually search / what they actually want," choose true. The symptom examples above (zero-results, junk-word noise, the apostrophe crash, "easy science but no math" → Real Analysis) are exactly the kind of *bad output* the corpus should be able to catch — use them as realism anchors.

## 3. What's knowable about a course (the shape of the data)

A "result" is a course (sometimes a specific section). So your expected outputs can reference any of these **knowable properties** — but nothing about how a query gets turned into them:

- **Identity:** subject (e.g. `CS`), number (`225`), title, description, credit hours.
- **Level:** the number's first digit indicates level — 100/200/300/400 are undergraduate, 500 is graduate. Undergraduates *can* occasionally take a grad course, but a student hunting for an *easy/accessible* class is almost never looking for grad seminars, so an answer list dominated by them is a poor one — especially since small grad classes often have inflated average GPAs (a real trap for naive "easy = high GPA" logic).
- **Gen-ed requirements:** a single course can satisfy several. (See §3.1 — central to student behavior.)
- **Quality & workload signals:** average and median GPA (with sample size), and evidence about workload/difficulty (e.g. exam-heavy, writing-heavy). Note: "easy" means *accessible and low-effort for a typical undergrad*, which is not the same thing as "highest average GPA."
- **Sections & schedule:** each offering has sections with CRN, status (open/closed/restricted), type (lecture/discussion/lab), meeting days and times, location, online-vs-in-person, full-term vs 8-week half-term, and whether it's an honors / James-Scholar section.
- **Instructor:** name(s), plus Rate-My-Professors-style rating / difficulty / would-take-again, and instructor-level GPA where available.
- **Term & recency:** which term it's offered, and whether that term is currently registrable ("active") or past ("historical"). Active/registrable offerings are primary; historical ones are secondary context.
- **Catalog text:** prerequisites and cross-listings exist as text (not always cleanly structured).

You can build any expected output from these (e.g. "top results should be 100–200-level Natural-Sciences courses, none graduate-level, none in Math"). **Ground every expectation in the real catalog** — verify against the official **Course Explorer** (`courses.illinois.edu`), your source of truth for real subjects, numbers, titles, gen-ed attributions, and current instructors. The catalog changes every term; verify currency rather than trusting any specific name/number from memory (including any in this brief).

### 3.1 Gen-eds — central, and full of traps

Gen-eds drive a huge share of real search ("what's an easy gen ed" is practically a genre). The UIUC student-facing categories and the language students use:
- **Composition I** (writing/comp) and **Advanced Composition** (a graduation requirement everyone needs; "writing intensive", "adv comp").
- **Humanities & the Arts** (history, philosophy, literature, the arts).
- **Natural Sciences & Technology** — students say "science", "a science gen ed", "lab science"; includes physical and life sciences.
- **Social & Behavioral Sciences** — students say "social science".
- **Quantitative Reasoning I & II** ("quant", "QR").
- **Cultural Studies** — three sub-requirements: **US Minority Cultures**, **Western/Comparative Cultures**, and **Non-Western Cultures**. Students colloquially call this whole bucket "the diversity requirement" and use language like "race", "gender studies", "other cultures".

One trap worth dedicated probes: **the letters "CS" are ambiguous** — "CS 225" / "CS classes" means the *Computer Science* subject, but "easy cs gened" almost certainly means the *Cultural Studies* gen-ed. "easy cs" alone is genuinely ambiguous — a great contrastive-pair case.

### 3.2 What the data does *not* (yet) contain

Be honest about limits when authoring outputs. Some things students ask for are weak or absent in the data — e.g. live seat counts / availability, and clean prerequisite structure; precise "8-week only" or "no prerequisites" asks may not be fully answerable. Where students genuinely make these asks, **include the queries** — but author the expected output honestly: the right answer may be "stay on-topic, degrade gracefully, don't return nonsense, don't crash," rather than a confident result set. An ask the data can't satisfy is worth representing so the benchmark stops the system from over-promising.

## 4. The prior test corpus — context, not constraint

A previous benchmark exists (~120 hand-authored queries with expected outputs). It is the very artifact the audit found overfit and partly laundered. **Treat it as background, not a template.** You're free to reuse, restructure, extend, or replace its organization and its very notion of an "expected output" if your research warrants something better — decide on the merits, not out of deference. (If you can read the repo, it's under `apps/api/src/eval/`; skim it to see what's been tried, then decide.)

## 5. Research Prong A — How UIUC / college students actually search for courses

Goal: derive the real *content, vocabulary, slang, intents, and frustrations* of course search at UIUC (and comparable schools), from primary evidence.

**Where to look (verify everything; these are starting points, not gospel):**
- **r/UIUC** (the main student subreddit) — recurring genres: "easy gen eds", "GPA boosters", course/prof recommendation threads, "is [course] hard?", "what should I take?", "anyone taken X with Y?", professor reviews, schedule-building help. Extract the *actual phrasings*, the slang, the implicit intents, and the criteria students optimize for.
- **UIUC Course Explorer** (`courses.illinois.edu`) — the official catalog and your ground-truth for real entities and for verifying expected outputs.
- **The UIUC GPA dataset** (the well-known open grade-distribution dataset, the engine behind "easy A" / GPA-booster culture) and RateMyProfessors discourse — for how students reason about difficulty, grading, and instructors.
- **Third-party UIUC tools** students actually use (scheduling/registration helpers, GPA visualizers) — their search/filter UIs reveal what students filter on.
- **Comparable evidence from other universities** — to separate UIUC-specific slang from general college course-search patterns and enrich phrasing variety.

**What to bring back:**
- A catalog of **real intents** and roughly how common each is (head vs tail).
- The **slang/shorthand lexicon** (orgo, diffeq, gen ed, gut, blow-off, GPA booster, "the diversity req", gateway courses, "James Scholar", course/professor nicknames) — with sources.
- The **criteria** students optimize (easy/GPA, schedule fit, good prof, fills a requirement, low workload, no prereqs, online, specific topic).
- The **misconceptions and ambiguities** real students carry (e.g. conflating subject vs requirement, vague topic language).
- The **range of sophistication** — not just the simple average, but how *power users* search: the heavily-constrained, multi-criteria, expert-vocabulary queries sophisticated students actually write (see §6.2).
- Representative real phrasings, preserving their messiness.

## 6. Research Prong B — How humans formulate search queries in general

Goal: derive the *shape and statistical texture* of real queries — length, errors, structure, operator (non-)use, question-forms, reformulation — so your corpus mirrors genuine query construction rather than clean engineered strings.

**Touchpoints to find and verify primary/recent sources for** (named so you know the landscape; confirm, update, and cite — don't rely on my summaries):
- Web query-log studies on **query length** (real queries are short — often 1–3 words) and the heavy **long-tail / Zipfian** distribution.
- **Broder's taxonomy** of search intent (navigational / informational / transactional) and its course-search analogs (known-item, exploratory/topic, "register this section").
- The **vocabulary mismatch problem** (users and systems name the same concept differently) — the core justification for handling slang/synonyms.
- **Misspelling/typo rates** in real queries; how people abbreviate and drop punctuation/casing.
- The split between the **casual majority and the power-user minority**: most users keep it short and never touch quotes/booleans/field filters, but a real minority write long, precise, heavily-constrained queries, and query length has a long upper tail. We care about **both ends** — study the power-user shape too (§6.2), not just the simple average.
- **Query reformulation / session behavior** (people re-query, narrow, broaden, give up) — informs reformulation-pair cases.
- **Exploratory vs known-item search** and **satisficing** (users often accept the first plausible result) — informs how strict "top result" expectations should be.
- **Recent shifts toward natural-language, conversational, voice, and LLM-style querying** — question-form and full-sentence queries are rising; reflect current behavior, not just 2000s keyword-ese.

**Crucial adaptation:** general web-search statistics describe *shape*; this is one university's course-search box, not Google. Use the general findings to calibrate **length, error rate, operator rarity, question-form prevalence, and reformulation** — then fill them with **course-domain content** from Prong A. Tell me explicitly where you adapted a general finding to this domain and why.

### 6.1 Query phenomena to make sure you capture

Real student queries exercise specific phenomena, several of which are exactly where we've seen the worst outputs (§2). Cover each with **multiple distinct, realistic phrasings** (not one token example):
- **Negation / avoidance** ("no math", "without coding", "not writing-heavy", "psych but less bio").
- **Vague / cue-less requirement phrasing** ("a science class", "something social", "diversity class").
- **Superlatives & sort intent** ("easiest gen ed", "hardest CS class", "highest GPA classes", "best professor").
- **Question forms** ("is cs 225 hard", "how hard is orgo", "what should I take after 225").
- **Slang / shorthand / typos** ("orgo", "diffeq", "compsci", "macroecon", "psych", misspelled subject names).
- **Multi-constraint vibe asks** ("chill 3-credit online class after 2pm that counts for something").
- **Complex / power-user compound queries** — many constraints stacked at once ("open 400-level ECE, MWF or online, 3+ credits, not 8am, good prof"), exact code + instructor + term together, precise/expert vocabulary, and comparison asks ("is 233 or 241 easier"). Rarer, but they exercise the most capability.
- **Punctuation & robustness** (apostrophes, emoji, empty, gibberish, very long input) — must never crash.
- **Known-item navigation** (course codes in every casing/spacing, CRNs) — the common head, where exactness matters.

### 6.2 Cover the whole spectrum — both the simple majority and the power user

Research will likely confirm that the *average* query is short and simple. That's genuinely useful, and the common head must be dense and well-tested. But we also explicitly want to serve the **power-user minority**: students who stack many constraints into one query, use precise or expert vocabulary, compare specific courses, or write near-structured syntax. They're a smaller share of traffic but disproportionately important — they exercise the system's hardest capabilities, and they're exactly the sophisticated users most likely to switch to a tool that beats the official catalog.

So tag every query's frequency honestly (don't pretend power-user queries are common), but **deliberately over-sample the complex end relative to raw frequency** so the benchmark actually measures capability there. The corpus should span the full range from one-word asks to dense multi-constraint power queries. Study what sophisticated UIUC students *actually* write (Prong A) — the goal is realistic power-user queries, not a synthetic showcase of invented "advanced" operators.

## 7. What to produce (deliverables)

Use your judgment on packaging; the substance is what matters.

1. **The query corpus.** For each entry, at minimum:
   - The **query string**, preserving real messiness (casing, typos, punctuation, slang as written).
   - **Provenance**: where the pattern came from (a specific source/observation in Prong A or a phenomenon from Prong B), enough that a skeptic could audit it. Group by family where many share a source.
   - **Intent** and **phenomena** tags. (A starter intent taxonomy you can refine: known-item/course-code, gen-ed/requirement, topic, professor, easy/quality-seeking, schedule-fit, avoidance, eligibility/prereq, "does this count" / degree-progress, comparison, help/how-to.)
   - An **expected-output specification** authored per §9 — what results *should* and *shouldn't* look like, plus any clear behavioral requirement (e.g. "'no math' must exclude math").
   - A **frequency tag** (head vs long-tail).
   - A **held-out flag** (see below).
2. **A research report / methodology document.** Findings from both prongs, the query taxonomy you built, design decisions and why, an **annotated bibliography** (links + confidence notes), and an honest account of where evidence was thin and you used judgment.
3. **A coverage map.** Across intent × phenomena × query-complexity, showing the corpus mirrors the **real frequency distribution** (dense head of common simple queries + a rich long tail) and spans the full simple↔complex spectrum, including a well-developed **power-user end** (§6.2) — not just a pile of exotic edge cases. Include a **held-out split**: realistic queries reserved as "the system is never tuned on these," to measure overfit directly — ideally with a recipe for *freshly generating* new held-out cases per phenomenon so special-casing can't beat the benchmark.
4. **A robustness/adversarial set and contrastive disambiguation pairs.** Must-not-crash inputs; must-not-zero-result on reasonable queries; must-not-grad-dominate; and tight contrastive pairs that pin boundaries (e.g. "computer science" vs "cs gen ed" vs "easy science").
5. **Benchmark-design recommendations.** How this corpus should be *run and scored* — e.g. exact-match for known-item queries vs. property-based must-include / must-exclude / ordering checks for fuzzy ones; aggregate health gates (zero-result rate, crash rate, grad-domination rate); how to use the held-out set. You may recommend changing our current evaluation approach — argue for it.

## 8. Principles & judgment guidance (the gray areas)

- **Realism over neatness, always.** If a query is ungrammatical, misspelled, or barely coherent but is how people really search, it belongs — as written. A too-clean corpus is the failure we're fixing.
- **Mirror the real distribution.** Most real queries are short and ordinary (a course code, a subject name, a one-word topic, "easy gen ed"). Make the head dense and well-tested, then cover the long tail richly. Don't let edge cases crowd out common cases, or clean cases crowd out the messy majority.
- **Cover the full complexity spectrum; over-sample the hard end.** Mirroring the real distribution sets how dense the simple head is — it does *not* mean starving the power-user tail. Represent complex, multi-constraint, expert queries richly enough to benchmark capability there, with honest frequency tags (§6.2).
- **Ground every query in real catalog entities, and verify** against Course Explorer. Don't invent a "CS 999" or a professor who doesn't teach the thing. (Catalog details from memory may be stale — verify.)
- **Author expectations from intent + the catalog, never from current system output (see §2).** Decide what the student means, then determine the ideal answer from the real data. The engine is a black box you're writing the answer key *for*, not *from*.
- **Prefer assertions/bounds over brittle exact lists, except where exactness is the point.** "Should be a 100–200-level Natural-Sciences course with reasonable GPA; not a grad seminar; not Math" beats freezing an exact ranked list that term-to-term drift will break. But for **known-item** queries ("CS 225"), an exact expected top result *is* the right assertion. Match the assertion's strictness to the intent's strictness.
- **Be honest about uncertainty.** If you can't confidently say what a query should return, say so and state the weaker guarantee you *are* confident about ("non-empty, on-topic, not grad-dominated, no crash"). A well-scoped weak assertion beats a confident wrong one.
- **Provenance discipline; no fabrication.** Every research claim and statistic needs a real, checkable source. If you can't verify it, mark it as judgment/inference, not fact. Don't invent citations. Distinguish "observed in real student posts," "established IR finding," and "my reasoned extrapolation."
- **Sensible use of sources.** Work from public discussion within normal terms of use. We're after *patterns of how people search*, not individuals — abstract real posts into representative queries rather than cataloguing who said what. Instructor names are a normal part of course results and fine to use where they belong; just don't go out of your way to spotlight a particular private person's identity. Use common sense — I trust your judgment here and don't want this to become a separate compliance chore that distracts from the work.
- **Format is yours; structure is non-binding.** Pick whatever representation best expresses messy queries + intent + result assertions + provenance, and justify it. Optimize for a future engineer being able to *run* this as a benchmark and *trust* it.
- **Use your judgment, and tell me when you did.** Where this brief is silent or ambiguous, decide in line with these principles and **note the decision and your reasoning** so I can review it. A thoughtful, well-explained judgment call beats a literal-minded gap. Don't treat any number here (sizes, counts) as a quota to game — they're calibration, not targets.

## 9. How to author an expected output (the crux)

For each query, work in this spirit:
1. **State the student's intent in plain language** — what they actually want.
2. **Decide the ideal results from the catalog, treating the engine as a black box.** What courses *should* a great course-search return for this intent? Identify them (or their defining properties) from the real catalog data, independent of any current system behavior. Note any clear **behavioral requirement** ("'no math' must exclude math, not return it"; "this is a 'sort by easiest' intent, so accessible low-workload courses should dominate"; "an apostrophe must not break the search").
3. **Express it as assertions:** must-include (by subject / number / title-substring / requirement-present / level-band), must-exclude, non-empty, not-grad-dominated, GPA/level sanity, correct ordering, must-not-crash. Add an exact expected top result only for known-item queries.
4. **Record confidence and provenance.** Done.

## 10. Anti-goals (do not do these)

- Don't build a clean, comfortable corpus that quietly encodes the current system's behavior or blind spots (the laundering/overfit trap).
- Don't special-case: avoid queries so specific they can only be passed by hardcoding. Each phenomenon should have siblings/variants and held-out cousins so a *general* fix is required.
- Don't over-index on exotic edge cases at the expense of the common head — or vice-versa.
- Don't invent fake courses, professors, or catalog facts; don't fabricate research sources.
- Don't impose a rigid output schema that fights the messy reality of real queries — the representation serves the queries, not the other way around.
- Don't reverse-engineer expected outputs from any system's current output, and don't try to model the engine's internals.

## 11. Suggested (not mandatory) shape for a corpus entry

A serviceable, output-centric shape — adapt freely:

```json
{
  "id": "neg-gened-001",
  "query": "easy science but no math",
  "provenance": "r/UIUC 'easy gen ed' threads + general negation phrasing (Prong A + B)",
  "intent": ["gen-ed/requirement", "easy/quality-seeking", "avoidance"],
  "phenomena": ["negation", "vague gen-ed phrasing", "vibe language"],
  "frequency": "head",
  "held_out": false,
  "expected_behavior": "Treat 'no math' as exclude-math, not filter-to-math. 'science' = the Natural Sciences gen-ed, not the Math/CS/PoliSci subjects.",
  "result_expectations": {
    "non_empty": true,
    "top_results_should": "be Natural-Sciences gen-ed courses at the 100-200 level with reasonable GPA",
    "must_exclude": "Math courses; graduate-level courses should not dominate",
    "example_good_answers": "intro astronomy / forensic-science / 'science of everyday life' style gen-eds (verify against Course Explorer)"
  },
  "confidence": "high",
  "notes": "Pair with 'easy science' (no negation) and 'cs but no math' to pin the boundary."
}
```

A known-item contrast, where exactness *is* right:

```json
{
  "id": "nav-001",
  "query": "cs225",
  "provenance": "course-code navigation; ubiquitous",
  "intent": ["known-item/course-code"],
  "phenomena": ["no-space code", "lowercase"],
  "frequency": "head",
  "result_expectations": { "top_result_should_be": "CS 225 (Data Structures)", "non_empty": true },
  "confidence": "high"
}
```

## 12. Scale & posture

Aim for a corpus large and varied enough to be a *real* benchmark of the long tail — on the order of several hundred queries spanning the full intent × phenomena space, with the head densely covered, plus a held-out slice — but **let the research drive the size.** Don't pad to hit a number, and don't stop early if the tail is clearly richer. Bias toward more *distinct realistic phrasings per phenomenon* over more exotic one-offs. When in doubt, add the variant a real student would actually type.

Deliver the research report and the corpus together, with the bibliography and coverage map. Flag every place you made a judgment call or hit thin evidence. I'm trusting you to be rigorous about realism and honest about uncertainty — that's the whole job.
