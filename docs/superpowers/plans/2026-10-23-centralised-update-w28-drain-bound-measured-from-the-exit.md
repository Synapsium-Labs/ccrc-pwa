# Centralised update management, wave 28: the drain-bound rows measure from the parent's own exit: Implementation Plan

On 2026-10-23 a docs-only pull request was ejected from the merge queue by one of this programme's rows, in the
merge group's `test (agent)` job. The coordinator cut wave 28 the same day as run 856 and issued a block of six
numbers starting at D-6607. The last four are the worker's reserve. Every citation below is `path:line` at `main`
`531797d62`, read with `git show 531797d62:<path>`. The worker re-reads each one in the landed text before editing it.

**What was measured.**
- **The red.** The case "a grandchild that left the group and holds the pipes does not stop the answer: a parent
  that exits 0 answers within the drain bound, stdout null" failed with `expected 1883 to be greater than or equal to
  1900`. It is at `agent/test/update-spawn.test.ts:131-148`, and the server role's twin is
  `server/test/update-spawn.test.ts:132-149`.
- **How it measures.** `took = answeredAt - parentGone` (agent `:143`). `parentGone` is `deadAt(parent)`
  (`:49-52`), a poll every 5 ms on `kill(pid, 0)`. The floor is `UPDATE_SPAWN_DRAIN_MS - 100` (`:145`), with
  `UPDATE_SPAWN_DRAIN_MS` at 2000 (`shared/agent-protocol.ts:507`).
- **Why it can red with nothing wrong.** The parent is the test process's own child, so `kill(pid, 0)` keeps
  answering until the test process reaps it. The reap is what fires the child's `exit` handler
  (`agent/src/server.ts:469-476`), and that handler arms the drain (`armDrain`, `:436-439`). `deadAt` sees the
  death only at its next poll, in a later timers phase. On a loaded runner that poll can run late by more than
  100 ms, so `parentGone` lands after the drain was armed, and `took` reads short of the drain that really ran. The
  spawner did nothing wrong. Every other bound in the file is an upper bound, and a late poll only makes an upper
  bound easier.

**What this wave does.** The exit-0 case's launcher writes its own exit time, in milliseconds, just before `exit 0`.
The floor is measured from that stamp: the drain cannot be armed before the parent has exited, and the stamp is
written before it exits, so `answeredAt - stamp` is at least the drain under any load. The two upper bounds stay
measured from `deadAt`, where a late poll errs in the safe direction. Both twins change the same way. No source file
changes.

## Not in this wave

- **The spawner itself.** `makeUpdateSpawn` and `boundedUpdateSpawn` are unchanged. Their shared body is held equal
  by a test, and nothing here touches it.
- **The kill-path cases** (the agent twin's `:112-129` and `:150-166`, and the server twin's `:113-130` and
  `:151-167`). They assert upper bounds only, which a late poll cannot red.
- **Other load-sensitive rows** in either file. None has been seen red. If the worker finds one that reds the same
  way, it reports it in the wave-done rather than widening this wave.

## Global Constraints

- **Files:** `agent/test/update-spawn.test.ts`, `server/test/update-spawn.test.ts`, and this plan. Nothing under
  `agent/src`, `server/src`, `shared/`, `ccd/`, `deploy/`, `.github/` or README.
- **The stamp's tool** is the test's own node, by `process.execPath`, exactly as the escapee already spawns it
  (D-6608). Not `date +%s%3N` (macOS's `date` has no `%N`) and not `$EPOCHREALTIME` (the launcher is `#!/bin/bash`,
  which is bash 3.2 on macOS).
- **Fixtures only.** Every launcher is a script the case wrote into its own temp dir. Every process a case starts is
  killed by its recorded pid in `afterEach`. Never `ccrc`, never `ccd`.
- **Mutation runs** on a scratch copy only. Around each vitest call, in a subshell, take the user's task count
  `n=$(ps -L -u "$(id -u)" --no-headers | wc -l)`, then run under `ulimit -u $((n + 1500))` and
  `timeout -k 10 600`. Restore byte-identical (`cmp`) after each.

## Review Focus

- The floor cannot red under load: it is measured from a stamp the parent writes before it exits.
- The floor still reds when the drain is skipped: M1 below.
- The upper bounds are unchanged, still measured from the observed death.
- Both twins carry the same change, and the shared spawner body is untouched.

## Mutation table

| # | Mutation (scratch copy only) | Red rows expected |
|---|---|---|
| M1 | In the spawner's `exit` handler, call `finish` at once with the parent's code, skipping the drain (each twin's own source) | the exit-0 case in that twin, on the floor |
| M2 | Stamp the exit time AFTER `exit 0` would run, by moving the stamp line below it, so no stamp is written | the exit-0 case, on its missing-stamp assertion |
| D1 | Not shipped, a demonstration: make `deadAt` return `Date.now() + 300` | the OLD form of the floor red, the NEW form green |

D1 is measured once per twin, before and after, and recorded in the As built note. It shows that a late observation
of the parent's death is enough to red the old floor, and that the new floor does not depend on it.

## Deviations found

A block of six numbers starting at D-6607 is issued to this wave. This plan defines the first two. The last four are
the worker's reserve.

- **D-6607** — The floor and the ceilings measure from different moments, on purpose. The floor reads
  `answeredAt - stamp`, where the stamp is the parent's own time before `exit 0`. The ceilings keep reading
  `answeredAt - parentGone`. A stamp can only be early and an observed death can only be late, so each bound is
  measured from the moment that errs in its own safe direction. One shared moment would make one of the two bounds
  sensitive to load again.
- **D-6608** — The stamp is written by the test's own node through `process.execPath`, the same absolute path the
  escapee uses, as `'<execPath>' -e 'process.stdout.write(String(Date.now()))' > "$DIR/exit.ms"`. The case reads
  it with a bounded poll (`pidFrom`'s shape) and fails with a clear message if it is absent. `date +%s%3N` is
  GNU-only, and `$EPOCHREALTIME` needs bash 5, while the launcher runs under bash 3.2 on macOS. The node start-up
  happens before the exit, so it only makes the stamp earlier, which is the floor's safe direction.
- **D-6609** — `unused` (run 856): issued to this wave; no departure took it.
- **D-6610** — `unused` (run 856): issued to this wave; no departure took it.
- **D-6611** — `unused` (run 856): issued to this wave; no departure took it.
- **D-6612** — `unused` (run 856): issued to this wave; no departure took it.

## File structure

- `agent/test/update-spawn.test.ts`: the exit-0 case's script gains the stamp line; the case reads the stamp and
  measures the floor from it; the `deadAt` doc comment says it serves the ceilings only. Task 1.
- `server/test/update-spawn.test.ts`: the same, in the twin. Task 2.

## Tasks

### Task 1: the agent twin's floor measures from the parent's stamp (D-6607, D-6608)

**Files:** `agent/test/update-spawn.test.ts`.

- [ ] **Step 1: measure the old form under D1.** On a scratch copy, make `deadAt` return `Date.now() + 300`, run
  the case alone three times, and record that the floor reds. Restore and `cmp`.
- [ ] **Step 2: write the stamp.** In the exit-0 case's script, write the stamp line just before `exit 0`, after
  `echo parent-done`, exactly as D-6608 spells it.
- [ ] **Step 3: read it and measure the floor from it.** After `await running`, read `$DIR/exit.ms` with a bounded
  poll, and assert it is a finite number. Then assert `answeredAt - stamp >= UPDATE_SPAWN_DRAIN_MS - 100`. Keep both
  ceilings on `answeredAt - parentGone` exactly as they are.
- [ ] **Step 4: say what `deadAt` is for.** Its doc comment says it serves the ceilings, and why a floor must not use
  it: the poll sees a death late under load.
- [ ] **Step 5: measure.** The case green alone three times, and the whole file three times. D1 on the new form: green
  three of three. M1 and M2 each red the case, by assertion. Restore and `cmp` after each.
- [ ] **Step 6: commit** on the workspace branch.

### Task 2: the server twin, the same way (D-6607, D-6608)

**Files:** `server/test/update-spawn.test.ts`.

- [ ] **Steps 1 to 6** as Task 1, in the twin, with M1 applied to `server/src/update/spawn.ts`'s copy of the body.
  The test that holds the two bodies equal must stay green with the source restored.

### Task 3: the gate and the PR

- [ ] **Step 1: suites, one file at a time.** From `agent/`: `test/update-spawn.test.ts` three times. From `server/`:
  `test/update-spawn.test.ts` three times, then `test/single-definition.test.ts`, `test/topology-clean.test.ts`,
  `test/private-names.test.ts`, `test/dtbd.test.ts`, `test/deviation-refs.test.ts` (after `git fetch origin main`),
  and `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts`.
- [ ] **Step 2: the As built note.** Add it at the end of this plan: the commits, D1's before and after per twin,
  M1 and M2's reds, the suites, and any reserve number spent.
- [ ] **Step 3: the PR.** Open it from the workspace branch, its body naming the red that caused this wave and the
  merge-group run, with no host, path or session name. CI's selection is the arbiter for the rest of each file.
- [ ] **Step 4: wave-done** in the same turn as the push.

## Brief-facing parts

- **Execution skill:** `superpowers:executing-plans`. The wave is two small, parallel test edits.
- **Routing:** class opus, effort high, subagent sonnet at high, workflow off. The shape is a mechanical fix with a
  measured mechanism, under a strict mutation discipline.
- **Items:** Task 1, the agent twin; Task 2, the server twin; Task 3, the gate and the PR.
- **Claims:** take a claim on both test files before editing. No other wave holds one at the base. Landing is
  first-ready against the programme's other open PRs. Measure `git merge-tree` against main and each open head
  before the push.

## As built

Run 856, on the workspace branch from `main` `531797d62`.

- **Commits.** The plan, then the agent twin (Task 1), then the server twin (Task 2), then this note. The two test
  diffs are line-for-line identical. No source file changed; `update-spawn-twin-bodies.test.ts` stayed green (4/4).
- **The stamp's reader.** `stampFrom` is `pidFrom`'s own bounded poll with its failure renamed ("the parent wrote no
  exit stamp in …"), not a second copy of the poll. The case then asserts the stamp is a finite number.
- **D1, the demonstration** (`deadAt` returning `Date.now() + 300`, scratch copy, the case alone, three runs each).
  Old form: red 3 of 3 on the floor in both twins (agent 1698, 1681, 1700; server 1710, 1696, 1698, each against
  1900). New form: green 3 of 3 in both twins. Restored byte-identical (`cmp`) after each.
- **M1** (the spawner's `exit` handler answers at once, skipping the drain; `agent/src/server.ts` and
  `server/src/update/spawn.ts` on the scratch copy): red in each twin on the floor (agent `expected 35`, server
  `expected 9`, each against 1900). Restored, `cmp` clean.
- **M2** (the stamp line moved below `exit 0`): red in each twin on the missing-stamp failure. Restored, `cmp` clean.
- **Suites, one file at a time, foreground.** The case alone three times and the whole file three times per twin, all
  green: agent `test/update-spawn.test.ts` 12/12 x3, server `test/update-spawn.test.ts` 15/15 x3. Then from `server/`:
  `single-definition` 848/848, `topology-clean` 60/60, `private-names` 47/47, `dtbd` 1/1, `deviation-refs` 31/31
  (after `git fetch origin main`), and `GROWTH_CHECK=1` `growth-check` 45/45.
- **Reserve.** D-6609 to D-6612 unspent, each recorded above as `unused`.
- **Other load-sensitive rows.** None was seen red in either file across these runs.
