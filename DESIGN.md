# Design

## Visual System

UIUC Course Search uses a restrained product UI language: Geist typography, stone neutrals, a single orange primary accent, simple borders, compact radii, and low-shadow surfaces. The interface should read closer to a clear student utility than to a dashboard, landing page, or command center.

## Color

- Background: `stone.0` / white.
- Text: `stone.9`.
- Muted text and borders: stone ramp only.
- Primary accent: orange, reserved for primary actions, active filters, and hard search interpretations.
- Semantic colors: green, amber, and red only for meaningful state.
- Avoid blue-forward accents, decorative gradients, glows, or multi-accent badge palettes.

## Typography

- Use Geist across headings, body, controls, and data.
- Keep product headings modest and sentence case.
- Avoid ornamental eyebrow labels, all-caps section scaffolding, and marketing copy.
- Prefer small, dense metadata rows over large display text inside app surfaces.

## Shape And Elevation

- Controls: 4px radius.
- Product surfaces: 6px radius.
- Larger shells: 8-10px maximum, only when the container truly needs it.
- Shadows should be rare and no stronger than `0 2px 8px rgba(28, 25, 23, 0.1)`.
- Do not use floating glass panels, hover lift, or large soft drop shadows.

## Components

- Search is a standard form. Enter submits; no adjacent Search button.
- Advanced search is a structured refinement surface, not a rewrite of the visible search text.
- Result cards are functional links with plain metadata and minimal state.
- Badges are reserved for functional tokens such as removable filters and historical status.
- Scores should appear as readable metrics, not decorative charts.
- Section tables should remain table-like: text-first, horizontally scrollable, and linked to official sources.

## Layout

- App header carries the product identity.
- Search pages should not repeat a hero headline beneath the header.
- Use normal containers, compact vertical rhythm, and predictable left-aligned task flow.
- Avoid nested cards and decorative explanatory panels.

## Motion

- Use 140-200ms color or border transitions for state changes.
- Do not use transform hover, bouncy transitions, page-load choreography, or decorative animation.
- Respect `prefers-reduced-motion`.
