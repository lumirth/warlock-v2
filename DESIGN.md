# Design

## Identity

UIUC Course Search is a calm, precise, **UIUC-adjacent** course search tool with _wise warmth_. It is a tool for students at the University of Illinois, not an official University web property: it nods to Illinois color without imitating the official `.edu` chrome.

**Governing principle: warm at the edges, precise at the core.**

Finding courses is a serious, stressful task. Students come to get information and make a registration decision, not to be entertained. So warmth lives only in the _connective tissue_, the first-run guidance, empty states, error recovery, the moments before and after the task. The _data itself_, scores, GPA, ratings, results, and the sections table, stays clinical and unembellished. Be warm when orienting a stressed student; be cold and concrete when handing them the facts they will decide on.

Warmth here means **clarity and reassurance, never jokes**. No "Oops!", no exclamation-point enthusiasm, no emoji, no cute wordplay about a student's stress.

> These are decisions, not defaults. The earlier stone+generic-orange+Geist look emerged from agent/tooling defaults; this document supersedes it with chosen values and the reasons behind them.

## Color

The palette is built from UIUC's real brand colors, split to encode the identity principle: **navy is the precise core, orange is the warmth.**

| Role               | Value                                        | Use                                                                                                                |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Ink / foreground   | **Illinois Navy `#13294B`**                  | Light-mode body text and data. ~14:1 on white. The cold, concrete core.                                            |
| Primary / accent   | **Illinois Orange `#FF5F05`**                | Primary buttons, active filters, focus rings, the live "how we read your query" highlights. The warmth and energy. |
| Primary foreground | **Illinois Navy `#13294B`**                  | Text/icons _on_ orange. See contrast note below.                                                                   |
| Canvas             | white / near-white                           | Background.                                                                                                        |
| Neutrals           | stone ramp, nudged a hair cooler toward navy | Borders, muted text, secondary surfaces.                                                                           |
| Semantic           | green / amber / red                          | Meaningful state only (open/closed, success/warning/error, workload, ratings).                                     |

**Contrast rule (load-bearing, do not violate):** white text on Illinois Orange is ~3.0:1 and **fails WCAG AA**. Never put white text or white icons on an orange fill. Orange fills carry **navy** text (`#13294B` on `#FF5F05` ≈ 4.7:1, passes AA), which is also more recognizably Illinois. This is why `--primary-foreground` is navy, not white.

- Dark mode is first-class. In dark mode, the canvas and cards move into deep navy while text flips to a cool light neutral. Orange remains the focus and primary action color, still with navy foreground text.
- Muted text must still meet AA against its background; verify the muted-foreground token at the small sizes it is used at.
- No decorative gradients, glows, or multi-accent badge palettes. Orange and navy are the only brand colors; everything else is neutral or semantic.

## Typography

- One clean sans across headings, body, controls, and data. (Geist is acceptable; a humanist-leaning sans is allowed for slightly more warmth. One family.)
- In light mode, ink is Illinois Navy, not pure black. In dark mode, foreground text is a cool light neutral on deep navy.
- **Tabular numbers on all data** (GPA, ratings, counts, credits).
- Headings are modest and sentence case. No ornamental eyebrows, no all-caps section scaffolding, no marketing copy.
- Every page has exactly one `<h1>`. On the search page the brand or the results heading carries it; the header brand text must be a heading, not a bare span.

## Shape and elevation

- Radius: **6px** as the standard (controls and surfaces alike). Soft enough to feel human, sharp enough to feel precise. Larger shells 8px max, only when the container needs it.
- One radius system; do not mix pill controls with sharp cards.
- Shadows are rare and no stronger than `0 2px 8px rgba(19, 41, 75, 0.10)` (tinted toward navy ink, not warm).
- **No glassmorphism.** No translucent/backdrop-blur panels, including the header. No floating glass, no hover lift, no large soft drop shadows.

## Motion

- 140-200ms color/border transitions for state changes.
- Motion conveys **state, not delight.** One allowance: a gentle entrance on results as they arrive. No transform hover on cards, no bouncy or elastic easing, no page-load choreography.
- Respect `prefers-reduced-motion`: reveals collapse to instant.

## Copy

This is where the warmth is rationed, per the governing principle.

- **Data surfaces stay cold:** scorecard, result cards, sections table read as plain facts. "Quality: Good. Avg GPA 3.42." No voice.
- **Edges are warm and human, never cute:**
  - First-run: orient and invite. e.g. "Search UIUC courses the way you'd describe them."
  - Empty results: reassure and give a way forward. e.g. "Nothing matched that. Try removing a filter to widen the search."
  - Errors: calm, no blame, no codes. e.g. "That search didn't go through. Give it another moment."
- Button labels are verb + object. No marketing buzzwords. No em dashes anywhere.

## Components

- Search is a standard form. Enter submits; no adjacent Search button.
- **First-run state:** when no search has run, the search box is followed by a quiet helper, a short orienting line plus 4-6 clickable example queries that each demonstrate a different query type (course code, professor, gen-ed, natural-language constraint). This is a helper, not a hero headline.
- Advanced search is a structured refinement surface that sends structured filter constraints, **not** a rewrite of the visible search text.
- Result cards are functional links with plain metadata and minimal state. One way of explaining a match per card, not two.
- Badges are reserved for functional tokens (removable filters, historical status).
- Scores appear as readable word-label metrics with semantic tone, never decorative charts or borrowed letter grades. Quality is rendered identically on cards and the scorecard.
- Section tables stay table-like: text-first, horizontally scrollable, linked to official sources.

## Layout

- App header carries the product identity (brand as the page `<h1>` on search).
- Search pages get a first-run helper (above), but **no marketing hero headline** beneath the header.
- Normal containers, compact vertical rhythm, predictable left-aligned task flow.
- No nested cards, no decorative explanatory panels.
