# A docs-only change runs only the checks that can see it (task note)

Programme: desktop polish. One task, run by the operator's direction of 2026-11-03. This note records the rule, the
measurements it rests on and the departures; the coordinator folds it into the ledger.

## Deviations found

- **D-7868** — a docs-only change runs only the checks that can see it (the operator's direction of 2026-11-03). A
  change is docs-only when it is non-empty and every changed file is under `docs/` and is no infrastructure file
  (`select-tests.mjs` `infraTrigger`: a manifest, a lockfile, a vitest or tsconfig, `.npmrc`, `.gitattributes`). A
  root file (`README.md`, `CLAUDE.md`, `CONTRIBUTING.md`) is not under `docs/`, so a change to one is not docs-only:
  about 40 server suites read them. An empty change, or one that cannot be diffed, is never docs-only, so everything
  runs. One predicate decides it: `docsOnly` in `.github/ci/reach.mjs`.
  - **In the merge queue**, a docs-only group (its change from the queue's base sha to its head, every entry counted)
    runs, per `QUEUE_DOCS_ONLY`: the server tests a pull request runs for that change (select answers `selected` and
    `fast`, and the `fast-plan` job plans the fast selection from the queue's base); no node floor tests (its leg
    switch reads select's `fast`); no agent tests (the agent leg's own queue ask); the pwa unit suite whole (it
    renders `docs/`); and the browser shards skip, as #2177 already does. A mixed group is not docs-only and runs
    exactly as before.
  - **On a pull request** without `full-ci` (or a `train/` head), a docs-only change skips the agent tests (`docs/` is
    now in the agent's FOREIGN list) and the pwa checks that are not tests: `pwa-static`'s typechecks, palette check
    and Storybook build, `build-pwa`'s provenance check, install and vite build, and `storybook-a11y`. They share a
    reach package of their own, `pwa-build`, whose FOREIGN list is `docs/` alone.
  - Every skip is by STEP inside its job, never by a job-level `if:`, so `test (server)`, `test (agent)`,
    `test (pwa)` and `build-pwa` still report success on a deliberate skip, and still refuse a red or cancelled leg.

## Step 0, measured

| Question | Answer |
|---|---|
| What decides the server leg's queue mode | `select` job, step `Select`: `select.mjs` `decideMode` (now with `queueDocsOnly`, from `reach.mjs` `queueScope('server', …)`), then `reach.mjs --ask fast` in the same step; the `fast-plan` job plans the fast selection |
| What decides the node floor's | `node-floor`'s job-level `CCRC_LEG` switch, over select's outputs |
| What decides the agent's | `test` matrix, step `Can this merge-queue group reach the agent tests?` (new; the pull request's ask is `Can this change reach the agent tests?`) |
| What decides the browser's | `browser-pwa`, step `Can this merge-queue group reach the browser tests?` (#2177) |
| What decides the pwa suite's | nothing in the queue: it runs whole |
| The required checks | `test (server)`, `test (agent)`, `test (pwa)` and `build-pwa` (main's branch protection, not strict; the `main` ruleset adds a pull request rule and the merge queue, squash, ALLGREEN, and requires no check of its own). Read only |
| agent/test, its vitest config and setup files read `docs/` | no: only comments name plan files; the census now pins it (`ci-reach-census.test.ts`) |
| The pwa vite config, the browser config, ui's Storybook config and every tsconfig of pwa and ui name `docs/` | no: one comment in `pwa/vite.config.ts` names the `/docs` route; nothing a tsconfig includes imports a file under `docs/` (pinned by the census) |
| The server pull-request selection for #2159's two files | re-planned on the newest trusted map's commit with both files changed: select picks 91 files and 73 untraced; the fast plan runs **233 of 1,293** server test files in 12 shards (0 related by vitest, 73 the map selects, 193 guard suites), and leaves 17 tree scanners over 10 s a file to the queue. The `pull_request` and `merge_group` runs of select and fast-plan gave byte-identical plans |

## Departures

1. **The queue cannot see a label or the head branch.** A `merge_group` event carries no pull request labels, so
   `full-ci` and a `train/` head take the full run on their pull request, not in the queue. In the queue, a docs-only
   group takes the docs-only path whatever its pull requests were labelled. The pipeline (`.github/`) and every
   `infraTrigger` file still force the full run there, because neither is docs-only.
2. **What the fast selection leaves to the queue stays unrun before the merge** for a docs-only group: a server test
   whose map record is uncertain (older than a change to what it read) and is not selected by this change. The pull
   request's selection already runs every test the map has no entry for and every test whose trace is unknown, so a
   new test that reads `docs/` still runs. Nor do the heavy tree scanners the fast plan leaves to the queue (17 for
   #2159's change): they list source roots (`server/src`, `shared`, `pwa/src`, `agent/src`, `ccd`), never `docs/`.
   The daily full run and the three-hourly map refresh catch the rest.
3. **The agent's pull-request skip follows the package's FOREIGN list**, as every reach package's does: a pull request
   whose files are all under `pwa/`, `ui/` or `docs/` skips the agent tests, not only a docs-only one.
4. **Rules and tests are one pull request**, by the operator's urgent direction. The series this stacks on
   (#2175, #2177) splits rules from tests for the external review-gate app's lane rule; this one does not.
