# Product

UIUC students use this tool while choosing classes, checking alternatives,
and comparing sections. The main task is course discovery for registration.

A student should be able to describe a course, recognize useful results,
adjust constraints, inspect an offering, and reach the official university
listing. Search should accept familiar course codes and student language.
Recognized filters should remain visible and removable.

## Product decisions

- Prioritize current offerings. Label retained historical offerings so students
  can distinguish them when they include past terms.
- Keep advanced filters separate from the visible search text.
- Present GPA and instructor ratings with their source and coverage limits.
  Avoid implying that they predict a student's experience.
- Show section details and provide official links beside registration decisions.
- Let students report a search or course issue from the relevant page, with its
  context attached.
- Keep the tool usable on narrow screens and with a keyboard or screen reader.

The interface is an academic utility. Compact controls and readable course data
take priority over promotional headings, decorative charts, and animated cards.
Use shared UI components and native form behavior where they fit the task.

The product is unofficial. Course Explorer remains the place to confirm
registration details. [Design](DESIGN.md) records interface choices;
[architecture](docs/architecture.md) describes current behavior and data limits.
