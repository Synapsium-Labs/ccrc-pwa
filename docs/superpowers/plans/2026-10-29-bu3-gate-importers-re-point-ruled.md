# BU3: the gate-importers row moves with the registry's import

- **D-7462 (2026-10-29)** — base-url BU3: `shared/models.mjs`'s one import of the endpoint gate is an eleventh `gateImporters()` caller site, so that characterization row is re-pointed in the move commit.

**D-7462.** Task BU3 of `docs/superpowers/plans/2026-10-29-consolidation-ts-mjs-kernel-base-url.md` (D-7308) gives `shared/models.mjs` the import `import { BASE_URL_OK, LOOPBACK_HOSTS } from './base-url.mjs';` and lists two census characterization rows that its commits move: `loopbackSets()` (the move commit) and `inlineGates()` (the behaviour commit). It does not list `gateImporters()`. That query counts every import declaration whose specifier resolves to one of the gate's three files, in any file other than those three, and `shared/models.mjs` is not a gate file. So the import the task requires is, by the query's own definition, a new caller site: the REAL row goes from the ten sites of the plan's item 2 to eleven, in ten files, and goes red on the move commit.

The import is the task, so the row moves with it. It is re-pointed in the move commit, under the plan's named exception (a characterization row whose list the commit moves):

- One entry is added, `{ file: 'shared/models.mjs', specifier: './base-url.mjs', resolves: 'shared/base-url.mjs' }`, in its sorted place.
- The other ten entries are byte-identical, specifiers included. No caller's specifier changes.
- The query, its FIXTURE row and every other REAL row do not change. The row keeps its title, which names the plan base's count, as BU2 kept the loopback row's.

No ceiling exists on `gateImporters()`, so none is raised. The mutant that proves the row still guards: a second import line of `./base-url.mjs` in `shared/models.mjs` reds it (twelve sites).

The plan file is not edited, because merged plans are append-only. This note is the record.
