# Contributing to ccrc

Thanks for looking. A few things about this codebase are unusual enough that knowing them
before you start will save you an afternoon.

## The layout: four packages, no root runner

There is **no root `package.json`**. Four packages, each `"type": "module"`, each run from
inside its own directory:

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

Node floor is `>=22.13.0`, identical across all three engines, and pinned by a test. The
server imports `node:sqlite` unconditionally — below that floor it does not degrade, it
fails to boot. If that test goes red, raise the floor; never lower it to make it green.

## How changes are expected to look

**A guard ships with a test that goes red when the guard is removed.** Not a comment
saying it matters — a test you have actually watched fail. The doctrine here is "a comment
is a request; a red suite is a mechanism", and PRs routinely include the measured mutation
table (delete the guard → N tests red). Please include yours.

**Tests should measure behaviour, not the spelling of an implementation.** A test that
asserts a config file *contains a particular string* breaks when the rule is strengthened;
one that asks whether the tool would actually do the thing does not.

**Every file opens with a comment explaining its reasoning** — why this shape, what was
tried, what would break. That is deliberate, and it is why there are no per-file licence
headers: boilerplate on top would compete with the thing the reader came for. Match the
density of the file you are editing.

**`D-N` markers in comments are the deviation ledger** — a global, monotonic record of
decisions and the measurements behind them. Read them as history; don't delete them. If
you add one, take the next free number (check `main` first — two branches allocating in
parallel has caused a renumber before).

**Don't collapse two conditions a caller handles differently into one value.** "Absent"
and "unreadable" are not the same answer; a function that returns `null` for both has
thrown away the distinction its caller needed. This is treated as a defect, not a style
preference.

## What to expect from review

Small, focused PRs get read quickly. Large mechanical sweeps are fine but say so in the
description, and keep the mechanical part separate from the judgement part.

CI runs the three suites plus a PWA build on every pull request. Fork PRs run with a
read-only token and no repository secrets.

## Licence

By contributing you agree that your contributions are licensed under the **AGPL-3.0**, the
same licence as the project. See [`LICENSE`](LICENSE).
