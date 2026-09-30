# Design

Course Warlock v2 Beta uses Illinois navy and orange to identify a tool for Illinois
students. It is an unofficial application and does not imitate university page
headers. Search controls and course data lead the page.

## Color and type

| Role | Color or treatment |
| --- | --- |
| Light-mode text | Illinois navy, `#13294B` |
| Brand accent and focus | Illinois orange, `#FF5F05` |
| Filled actions | Deep orange, `#C2410C`, with white text |
| Light canvas | Near-white with white cards |
| Dark canvas and cards | Deep navy with light text |
| Availability and metric states | Green, amber, and red with text labels |

The CSS tokens in `apps/web/src/index.css` own the implemented palette. Orange
brand color does not provide enough contrast for white normal-size button text;
filled actions use deep orange. Check muted text against its actual background
when changing tokens or text sizes.

Use Geist for headings, controls, and data, with tabular numbers on metrics and
counts. Headings use sentence case. Each page has one `h1`; the search page's
header brand supplies it, and course pages use the course title.

## Layout and interaction

- Use compact, left-aligned page content with predictable spacing.
- Keep controls at a 6px corner radius and larger containers at most 8px.
- Use borders for grouping. Avoid glass panels, decorative gradients, hover
  lift, and large shadows.
- Make search a native form. Enter submits, and the embedded submit control
  supports pointer and touch use.
- In the initial state, show clickable examples of supported query types below
  the input. Avoid adding a promotional headline above the task.
- Advanced search edits structured constraints. Applying filters preserves the
  query text.
- Cards link to course details. The table supports comparison and sorting.
- Use badges for actionable filters or meaningful metadata. Give each result
  one explanation of its match.
- Present metrics as readable labels. Quality uses Excellent, Good, Fair, and
  Low everywhere, as defined by the shared query types.
- Use text-first section tables on desktop and expandable section rows on narrow
  screens.

## Copy and accessibility

Labels name the action or value. Keep units, unfamiliar formats, source facts,
and consequences readers need; remove hints that repeat the control label.
Empty states explain the next useful action. Errors identify recovery without
blame or jokes.

Data labels remain factual. Explain the source of GPA and ratings beside those
metrics. Put snapshot limitations beside section availability and official links.

Target WCAG AA contrast, visible focus, labeled controls, and keyboard navigation.
Text must carry status as well as color. Preserve reduced-motion support and
check both themes at narrow widths. Theme selection follows the system on first
use and saves a user's explicit choice when local storage is available.
