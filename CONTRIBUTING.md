# Contributing to ccrc

Thanks for looking. A few things about this codebase are unusual enough that knowing them
before you start will save you an afternoon.

Read `README.md` for what ccrc is, `CLAUDE.md` for the operational rules that are not
obvious from the code, and `docs/superpowers/specs/` for why a subsystem has the shape it
has — before changing it.

## The layout: four directories, three runnable, no root runner

There is **no root `package.json`**. Three packages, each `"type": "module"`, each run
from inside its own directory:

    cd server && npm ci && npm test
    cd agent  && npm ci && npm test
    cd pwa    && npm ci && npm test

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
than assembling one.

Node floor is `>=22.13.0`, identical across all three engines, and pinned by a test. The
server imports `node:sqlite` unconditionally — below that floor it does not degrade, it
fails to boot. If that test goes red, raise the floor; never lower it to make it green.

## How changes are expected to look

**A guard ships with a test that goes red when the guard is removed.** Not a comment
saying it matters — a test you have actually watched fail. The doctrine here is "a comment
is a request; a red suite is a mechanism", and PRs routinely include the measured mutation
table (delete the guard → N tests red). Please include yours.

**Write the test first and watch it fail for the reason you expect.** A test written after
the fact passes for whatever the code happens to do; one that has never been red has not
been shown to measure anything.

**A value with one meaning is spelled once.** Runtime lists derive from the type that
defines them rather than being re-typed beside it, and `server/test/single-definition.test.ts`
text-scans four roots and fails the build when a second copy appears. If you find yourself
keeping two lists in agreement by hand, that is the defect.

**Tests should measure behaviour, not the spelling of an implementation.** A test that
asserts a config file *contains a particular string* breaks when the rule is strengthened;
one that asks whether the tool would actually do the thing does not.

**Every file opens with a comment explaining its reasoning** — why this shape, what was
tried, what would break. That is deliberate, and it is why there are no per-file licence
headers: boilerplate on top would compete with the thing the reader came for. Match the
density of the file you are editing.

**`D-N` markers in comments are the deviation ledger** — a global, monotonic record of
decisions and the measurements behind them. Read them as history; don't delete them. If
you add one, take the next free number from the allocator (`POST /api/ledger/deviations`),
and **allocate and define in the same act** — the gap between asking for a number and
writing it down is where two branches come to hold the same one.

Two branches allocating in parallel has caused a renumber three times, so it is checked
rather than remembered:

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

That suite compares this branch's ledger entries against `origin/main`'s **without merging
either into the other**, and reds if any allocator-era number is defined in two different
plans. It measures whatever `origin/main` your checkout has fetched — hence the `git fetch`
first — and it goes red on a base it cannot resolve rather than quietly passing, so a
shallow clone reports a problem instead of a clean bill. CI runs it on every PR.

**Don't collapse two conditions a caller handles differently into one value.** "Absent"
and "unreadable" are not the same answer; a function that returns `null` for both has
thrown away the distinction its caller needed. This is treated as a defect, not a style
preference.

## What to expect from review

Small, focused PRs get read quickly. Large mechanical sweeps are fine but say so in the
description, and keep the mechanical part separate from the judgement part.

`main` is protected: every change lands by pull request, and there are no direct pushes —
including by the maintainer.

CI runs the three suites plus a PWA build on every pull request. Fork PRs run with a
read-only token and no repository secrets.

Found a security problem? Do not open an issue — see [`SECURITY.md`](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the **AGPL-3.0-only**, the
same licence as the project. See [`LICENSE`](LICENSE).
