# Contributing to ccrc

Thanks for looking. A few things about this codebase are unusual enough that knowing them
before you start will save you an afternoon.

Read `README.md` for what ccrc is, `CLAUDE.md` for the operational rules that are not
obvious from the code, and `docs/superpowers/specs/` for why a subsystem has the shape it
has — before changing it.

## The layout: five directories, three runnable, no root runner

There is **no root `package.json`**. Three packages, each `"type": "module"`, each run
from inside its own directory:

    cd server && npm ci && npm test
    cd agent  && npm ci && npm test
    cd ui     && npm ci                # before pwa, always
    cd pwa    && npm ci && npm test

`ui/` is `@ccrc/ui`, the design system, and pwa builds it from source (`file:../ui`). Its
imports resolve from `ui/node_modules` alone, so install `ui` before anything typechecks,
tests or bundles `pwa`; without it every pwa suite fails at import.

`shared/` is not a real package — it carries a bare `"type": "module"` marker, and that
marker is load-bearing: without it `tsc` emits CommonJS into `dist/shared/` and the server
dies at startup.

**Run one suite with `./node_modules/.bin/vitest run test/foo.test.ts` from inside the
package.** Never bare `npx vitest` — it resolves a global copy with no jsdom and reports
"no tests" while looking like it passed.

Run suites in the **foreground**. They are load-sensitive, and backgrounding one hides a
hang. A handful are known to flake under parallel load; re-run in isolation before
concluding a break is real. CI on a quiet runner is the arbiter.

**Tests are hermetic: fixture HOMEs only**, never the machine's own `$HOME` and never a
live service. `ccd`'s suites in particular drive real workspace operations, and `HOME` is
the one isolation boundary they rely on — pointed at your own, they delete your work. Copy
the harness idioms from a neighbouring test (`makeCcdHarness`, `ghContainedEnv`) rather
than assembling one. Each server run also keeps every temp write under one
`$TMPDIR/ccrc-testrun-XXXXXX` parent of its own, removed at teardown or on a signal, and after
a SIGKILL by a later run under the same `TMPDIR` once quiet; a `TMPDIR` too long for a unix
socket prints `ccrc-test: per-run temp dir refused (<code>)` and falls back to loose fixtures.

Node floor is `>=22.16.0`, identical across all three engines, and pinned by a test. Below
22.13 the server fails to boot (it imports `node:sqlite` unconditionally); below 22.16 that
`node:sqlite` has no FTS5, which ccrc history needs. If that test goes red, raise the floor; never lower it.

## How changes are expected to look

**A guard ships with a test that goes red when the guard is removed.** Not a comment
saying it matters — a test you have actually watched fail. The doctrine here is "a comment
is a request; a red suite is a mechanism", and PRs routinely include the measured mutation
table (delete the guard → N tests red). Please include yours.

**Write the test first and watch it fail for the reason you expect.** A test written after
the fact passes for whatever the code happens to do; one that has never been red has not
been shown to measure anything.

**A value with one meaning is spelled once.** Runtime lists derive from the type that
defines them rather than being re-typed beside it, and `server/test/single-definition/*.test.ts`
text-scans four roots and fails the build when a second copy appears. If you find yourself
keeping two lists in agreement by hand, that is the defect.

**Tests should measure behaviour, not the spelling of an implementation.** A test that
asserts a config file *contains a particular string* breaks when the rule is strengthened;
one that asks whether the tool would actually do the thing does not.

**Every file opens with a comment explaining its reasoning** — why this shape, what was
tried, what would break. That is deliberate, and it is why there are no per-file licence
headers: boilerplate on top would compete with the thing the reader came for. Match the
density of the file you are editing.

**Do not edit the shared ledgers in a feature pull request.** Existing files under
`docs/superpowers/programs/` and `docs/superpowers/plans/` belong to the coordinator's `ledger/<programme>`
pull request. Add a new note, `docs/superpowers/programs/<programme>/<task-or-pr>.md`, and the coordinator folds it
in. `.github/ci/ledger-guard.mjs` checks it; a `Ledger-Edit: <reason>` trailer on the head commit is the escape
(a trailer on an earlier commit does not count). A new file under `docs/superpowers/specs/` or `docs/superpowers/plans/`
takes the repo's review judge's layout, a dated spec (`YYYY-MM-DD-<slug>-design.md`, or its `-design.promise-ids.json`)
or plan (`YYYY-MM-DD-<slug>.md`) directly in that directory; the guard's layout arm refuses anything else, with no
escape (D-8719). A spec's images, mockup pages and other non-spec files go under
`docs/design/<spec file name less its extension>/` (for example `docs/design/2026-11-16-programme-work-map/`), and
the spec links to them by relative path; files already on `main` stay where they are.

**`D-N` markers in comments are the deviation ledger** — a global, monotonic record of
decisions and the measurements behind them. Read them as history; don't delete them. If
you add one, you take its number yourself, with no server and no token (after `cd server && npm ci`):

```bash
git fetch origin main
cd server && npm run next-deviation -- <count>
```

If `origin` is your fork, measure the project itself, not your fork's `main` (a stale base hands
you a number already taken): add the project as `upstream` once and fetch it, and the helper and
the collision check below then measure `upstream/main` by themselves:

```bash
git remote add upstream https://github.com/Synapsium-Labs/ccrc-pwa   # once
git fetch upstream main
cd server && npm run next-deviation -- <count>
```

Both pick their base the same way (`resolveLedgerBase` in `server/scripts/next-deviation.ts`):
`$CCRC_LEDGER_BASE` when it is set and resolves, else `upstream/main`, else `origin/main`, and
both name the base they measured. The helper's `--ref <ref>` overrides it for one run.

The helper prints `max(highest + 1, 10000)` onward, where the highest is the highest `D-N`
defined on that base and on your branch, in any `.md` file under
`docs/superpowers/plans/`, `programs/` or `specs/`. **Take all the numbers your change needs in
one call:** the helper counts only committed definitions, so a second call before you commit
returns the same numbers.
**Take and define in the same commit**, in a file your pull request adds: your change's own
new dated plan, or a new task note `docs/superpowers/programs/<programme>/<task-or-pr>.md`.
`.github/ci/ledger-guard.mjs` allows both (a pull request may add files under `plans/` and
`programs/`); it refuses a modified, deleted or renamed-away existing file there unless the head
commit carries a `Ledger-Edit: <reason>` trailer. Until then the entry is `D-TBD-<slug>`, which CI
refuses to land. The server allocator (`POST /api/ledger/deviations`) retired on 2026-11-23.

Two pull requests in flight can take the same number, so a collision is checked rather than
prevented:

```bash
git fetch origin main   # or upstream main, on a fork
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

That suite compares this branch's ledger entries against the base's (the helper's base, above) **without merging
either into the other**, and reds if a number of 10000 or more is defined with two different
subjects anywhere across those three directories (one entry mirrored in a spec and its plan, or a
file renamed on your branch, is one deviation; an older, allocator-era number is checked across
plans only). It measures whatever base your checkout has fetched, and names it — hence the
`git fetch` first — and it goes red on a base it cannot resolve rather than quietly passing, so
a shallow clone reports a problem instead of a clean bill. CI runs it on every PR, and the merge
queue runs it on the merged result, so the pair never lands: whoever lands second renumbers the
entry and every reference to it.

**Don't collapse two conditions a caller handles differently into one value.** "Absent"
and "unreadable" are not the same answer; a function that returns `null` for both has
thrown away the distinction its caller needed. This is treated as a defect, not a style
preference.

## What to expect from review

Small, focused PRs get read quickly. Large mechanical sweeps are fine but say so in the
description, and keep the mechanical part separate from the judgement part.

`main` is protected: every change lands by pull request, and there are no direct pushes —
including by the maintainer. A pull request needs one approving review; the maintainers
can merge their own through the ruleset's admin bypass.

CI runs the agent and PWA suites and a PWA build in full on every pull request. The
server suite runs only the tests the change can affect, as chosen from a traced
dependency map, plus a fixed set that always runs. A change to the pipeline, a
manifest or a lockfile runs the whole server suite. The whole suite also runs daily
on `main` and before any promotion to `stable`, so a green pull request proves its
selection, not the whole suite. Fork PRs run with a read-only token and no
repository secrets. A fork PR's workflow runs wait
for a maintainer to approve them the first time you contribute — that is GitHub's gate,
not a judgement about your patch.

Found a security problem? Do not open an issue — see [`SECURITY.md`](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the **AGPL-3.0-only**, the
same licence as the project. See [`LICENSE`](LICENSE).
