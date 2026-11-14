# CI: a dispatched full run skips the macOS legs by default, and a docs-only follow-up push skips the heavy PR jobs

- **D-8396 (2026-11-12)** — two CI savings the operator approved on 2026-11-12: a `workflow_dispatch` full run of
  `ci.yml` skips the macOS legs unless dispatched with `macos=true`, and `full-suite` reads that deliberate skip as not
  red; and a pull-request push whose every file changed since the PR's newest passing head is documentation skips the
  heavy pull-request jobs while every required check name still reports success.

## Why

- A dispatched full run is how a builder gets the whole Linux suite's answer for a branch (CLAUDE.md, "Dispatch it ONCE
  per accepted tip"). Each one also called the macOS legs, which hold the organisation's few macOS slots, are advisory
  and off the merge path, and made `full-suite` red whenever they were (the dispatcher was told to read only the Linux
  legs). The daily run and the stable gate are where the macOS answer matters.
- A review round often ends with a push that edits only a plan, a ledger note or a README. The pull request's previous
  head already passed every PR check, so the fast run's twelve server shards, three pwa shards, the static pwa checks
  and Storybook spent their minutes re-proving code nobody touched.

## What changed

### (1) A dispatch skips the macOS legs unless asked

- `ci.yml` `on.workflow_dispatch.inputs.macos`: a boolean, default `false`. `workflow_call` declares no such input, so a
  call (release-stable's gate) always runs the macOS legs.
- `select`'s Select step answers `macos_off=true` only for a dispatch of `ci.yml` itself whose input is exactly `false`
  (`INPUT_MACOS` is `toJSON(inputs.macos)` there and empty for every other trigger; a called run's event is its caller's,
  so `github.workflow == 'ci'` is checked too), and writes a line to the step summary saying how to ask for them.
- The `macos` call's `if:` adds `needs.select.outputs.macos_off != 'true'`. The daily run, a call and a dispatch with
  `macos=true` run it as before; `macos-probe` (daily only) is unchanged; macos.yml's own dispatch is unchanged.
- `full-suite`: the first script-free guard refuses a skipped leg only when `macos_off` is not `true`; a second guard,
  for `macos_off`, refuses a skip of every need but the macOS call (named one by one; the pipeline test derives the
  list from `needs:`). `verdict.mjs full` reads `SKIPPED_ON_PURPOSE=macos` and excuses a `skipped` macOS result alone
  (`DELIBERATE_SKIPS`: a failure or a cancellation is still red, a name off the list is red, and a verdict whose every
  leg was a deliberate skip is red).
- The job is NAMED `full-suite (macOS skipped)` on such a run. main-artifact.mjs `isGreenFullSuiteJob` takes only
  `full-suite` or `<caller> / full-suite`, so a macOS-less dispatch on `main` can neither make the daily run skip its
  macOS legs ("already green") nor promote to stable. Post-merge and scheduled macOS runs are unchanged.

### (2) A docs-only follow-up push skips the heavy pull-request jobs

- `.github/ci/docs-followup.mjs`, with its suite `server/test/ci-docs-followup.test.ts` (pure rows plus the CLI
  against a local fake of the REST API and a real git repository). `FOLLOWUP_DOCS_PATTERNS` is the one list:
  `docs/**` and a root `*.md` (a `*` never crosses a `/`), less any `infraTrigger` file. The baseline is the newest
  `ci.yml` `pull_request` run of this PR (branch, head repository, and its number when the run lists one) that completed
  `success`, other than this run, whose head is an ancestor of this head. The change from it (`git diff --name-only
  --no-renames`) must be non-empty and all on the list. One REST call, one page of 30, with `GITHUB_TOKEN`; every
  doubt, and any failure, answers `docs_followup=false`, and the CLI always exits 0.
- `select` asks it in its own step (`Is this push a docs-only follow-up?`), on a pull request whose plain-bash pipeline
  step answered `changed=false` only, so the token never reaches select.mjs and a change to the module is never judged
  by itself; a failure of the step warns and answers nothing. The Select step republishes `docs_followup`, `true` only
  for exactly `true`.
- On `docs_followup == 'true'`: `fast-plan`, `server-shard`, `server-typecheck`, `server-perf`, `mask-perf` and
  `storybook-a11y` skip by job-level `if:` (none of them is a required name); `node-floor`'s leg switch skips its steps;
  `pwa-shard` and `pwa-static` (now `needs: [deps, select]`, still `!cancelled()`) skip every step after the checkout
  and the reach ask, so they report success. `test (server)`'s guard no longer demands a successful fast plan for a
  follow-up, and `verdict.mjs server` passes `FOLLOWUP=true` only on a `pull_request` with the typecheck and the shards
  both skipped. `test (pwa)` reads the shards' and static checks' success. `test (agent)` and `build-pwa` are unchanged.
- The merge queue never asks (the step is `pull_request`-only, and the verdict refuses the answer on any other event).

## Departures

1. **`test (agent)`, `build-pwa` and `browser-pwa` keep running.** They carry no `needs:` by rule (a failed `needs:`
   would skip a required name; pinned in ci-pipeline.test.ts), so they cannot read select's answer, and a lookup of
   their own would cost one REST call each. They are light (about a minute each), and for a follow-up whose pull
   request is docs/-only they already skip by their own per-path ask (D-7868). `browser-pwa` runs on a pull request
   only in the full mode: a follow-up on a pull request that changed infrastructure other than `.github/` (a lockfile,
   a manifest, a tsconfig: `infraTrigger`) still runs its three shards, while its server jobs skip.
2. **The list is wider than `docsOnly` (D-7868).** A root `*.md` counts here although about 40 server suites read the
   root Markdown files (the reason `docsOnly` refuses it). The head before passed every PR check, and the merge queue
   runs every suite before the merge, so a follow-up that breaks one (a D-number cited and not defined, say) is caught
   at the queue entry rather than on the pull request. The guard suites that read docs (deviation-refs, the censuses)
   are among what the follow-up skips; the ledger guard is its own job and still runs.
3. **A pipeline change never takes the follow-up path,** even when the follow-up itself touches only docs: the
   plain-bash `pipeline` step compares the whole pull request with its base, so a pull request that edits `.github/`
   runs everything on every push. That is the price of never letting a change to the decision judge itself.
4. **The base may have moved.** The baseline run tested the merge of its head with the base of that day; the skip does
   not re-test the merge with today's base. The merge queue does, on every entry.
5. **`deps` still runs** on a follow-up: it has no `needs:` and starts before select answers; with a warm cache it
   restores and saves nothing. The pwa shards and static checks now also wait for `select`, which finishes before
   `deps` on a warm cache.
6. **A same-head run (a reopen) runs everything.** Its change is empty, and an empty change is never docs-only.

## Verification

- `server/test/ci-docs-followup.test.ts` (new), `ci-verdict.test.ts` (the follow-up and deliberate-skip rows and CLI
  rows), `ci-main-artifact.test.ts` (a `full-suite (macOS skipped)` job is no evidence), `ci-pipeline.test.ts` (two new
  describes that evaluate the workflow's own expressions for both savings, plus the moved pins), `ci-merge-queue.test.ts`
  (the node floor's leg line). Mutation check: dropping `macos_off` from the `macos` call's `if:`, or one leg from the
  second full-suite guard, reds the new rows.
