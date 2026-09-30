# Course Warlock v2 Beta

Find University of Illinois Urbana-Champaign courses by code, topic, instructor,
GenEd requirement, or meeting time. Search in your own words, refine the results,
and open a course to compare its sections and follow the official listing.

[Open Course Warlock v2 Beta](https://warlock-v2.pages.dev/)

Try `CS 225`, `400 level CS`, `humanities gen ed`, or `data structures with fagen`.
Recognized constraints appear as removable filters. Advanced search lets you
set those filters directly while keeping your search text. Switch between cards
and a sortable table, or share the URL to reopen the same search.

Search covers current offerings by default. Past offerings remain searchable
when the database has retained them. Course pages show historical GPA and linked
Rate My Professors ratings where data is available. These are comparison signals,
not predictions of your grade or workload.

This is an unofficial planning tool. Section availability is a stored snapshot;
confirm registration details in [Course Explorer](https://courses.illinois.edu/).
Use "Results not right?" or "Report a signal issue" to send feedback from the page
where you found the problem.

## Run locally

Use Node 22.13+ or Node 24+, with npm 10 or later. The lockfile fixes dependency versions.
From a clone of this repository:

```bash
npm ci
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local -w @warlock-v2/api
npm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`.
The API runs at `http://localhost:8787`. A fresh local database has no courses;
follow [local development](docs/development.md#load-the-catalog) to load the
catalog through the Worker before searching. Local development uses local D1
and KV storage.

The development guide also covers working on the web client against the hosted
API, adding GPA data, and changing ports. If `.dev.vars` already exists, update
it instead of replacing your credentials.

## Verify changes

```bash
npm run build
npm test
npm run lint
npm run bundle:budget
npm run security:secrets
npm audit --audit-level=high
```

The build typechecks every workspace and the operational scripts, then produces
the web bundle in `apps/web/dist`. Tests cover query interpretation, migrated D1
behavior, HTTP policy, and browser workflows. CI runs this same gate on pushes
to `main` and on pull requests.

## Maintain and deploy

The React/Vite client calls a Hono API on Cloudflare Workers. D1 stores the
catalog, search indexes, refresh progress, ratings, and feedback. GPA imports
use KV to cache their source dataset. Query interpretation runs in the Worker
without an external language-model service.

- [Local development](docs/development.md) explains setup and first use.
- [Operations](docs/operations.md) covers resources, secrets, staging,
  production, refreshes, verification, and rollback.
- [Architecture and data](docs/architecture.md) explains search, publication,
  comparison signals, and source attribution.
- [Product](PRODUCT.md) and [design](DESIGN.md) record the intended experience.
- [Release notes](docs/release-notes.md) describe the current candidate.

The canonical database migration initializes a fresh database. The beta has no
historical schema upgrade path; schema changes require a new D1 binding.

Original code is available under the [MIT license](LICENSE). Dependency licenses
and external data sources have their own terms. The web build includes
`THIRD_PARTY_NOTICES.md` and `GEIST_LICENSE.txt` alongside the assets.
