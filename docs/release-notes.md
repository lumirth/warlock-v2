# Release notes

## 2.0.0-beta.1 · 2026-09-30

Open [Course Warlock v2 Beta](https://warlock-v2.pages.dev/).
This release retains the current schema and Cloudflare hosting.

- Renamed the application and repository to Course Warlock v2 Beta and
  `warlock-v2`. The production API is `warlock.lumirth.workers.dev`;
  staging uses `warlock-staging.lumirth.workers.dev` and
  `staging.warlock-v2.pages.dev`.

- Licensed original code under MIT. Web builds include dependency notices and
  the Geist font license alongside their assets.
- Documented the student search experience, local database setup, catalog
  loading, deployment resources and secrets, and environment-specific rollback.
- Updated product and design guidance to match native search submission and
  the implemented UI.
- Removed repeated hints from advanced search and feedback. Course metrics now
  use a descriptive heading and one explanation of their sources.
- Applying advanced filters now preserves an interpreted course query. Adding
  a level filter to `CS 225` keeps that course instead of broadening the search to
  every course at that level.
- Repaired clean-install dependency resolution and updated affected dependencies.
  The Cloudflare test runtime requires compatible `sharp` and `undici` overrides
  while its pinned dependencies lag those fixes.
- API releases now reject missing operator credentials before migrations or
  deployment. Interrupted GPA imports resume their stored generation.
- Renamed the API release script to `scripts/release-api.ts` because it handles
  staging and production. npm deployment commands retain their names.
- Smoke verification now supports both environments, checks catalog readiness
  and a nonempty course search, and selects a published term instead of assuming
  Fall 2026.

There is no schema migration or data reset in this release. Follow the
[local gate](../README.md#verify-changes) and [deployment verification](operations.md#release-staging)
for subsequent releases. The existing databases and cache namespaces are
retained across the rename.
