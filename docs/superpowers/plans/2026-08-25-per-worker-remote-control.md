# Per-worker `--remote-control` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The standing ruling of 2026-08-13 (orchestrator task #37) lands: dispatched
program workers spawn WITHOUT `--remote-control` regardless of the box's own
`~/.ccrc/remote-control` setting — a per-session decision keyed to "is this pane a
dispatched worker", never to "is this box in RC mode".

**Architecture:** One new per-session registry field (`rc`, values: absent = follow
the box; `off` = never RC), written once by `ccd ws-add --no-rc` at workspace
creation and consulted at the single choke point every spawn path already funnels
through (`_spawn_start`'s `rcflag` line). The server's dispatch path — the one
place that knows a spawn is a dispatched worker — composes the flag through a new
`CCD_ARGV.wsAddWorker` brand; the PWA's ordinary add keeps `wsAdd` and the box
default. The worker skill's clause 10 stops saying the per-session form does not
exist, because it now does.

**Tech Stack:** bash (`ccd/ccd`), TypeScript ESM (server), vitest.

**Spec:** No standalone spec — the decision record is §Design below, argued from
the ruling and from `docs/superpowers/plans/2026-08-19-stage2e-remote-control.md:229-243`
(which named the two candidate mechanisms and deferred both).

## Design (the decision record)

- **The ruling (2026-08-13, orchestrator task #37):** dispatched program workers
  spawn without `--remote-control`. First recorded at
  `docs/superpowers/specs/2026-08-14-fleet-robustness-design.md:1526` (a live
  worker measured WITH the flag); fullest statement at the stage2e plan `:229-241`.
- **Storage is a registry field, not caller argv,** because the respawn paths have
  no caller: `claude-session@<id>`'s ExecStart is `ccd supervise %i` (no argv),
  `cmd_ensure` takes exactly one positional as a stated security boundary, and
  `cmd_swap`'s restart re-enters the same funnel. A field survives swap (swap
  rewrites only `wrapper`/`lastswap`/`supervised`), survives every Restart=always
  cycle, and dies with the row at reap via `_reg_purge`'s shape-based match.
- **The field rides no wire.** The "25th field" cost argument (`ccd/ccd:4585-4588`)
  applies only when the SERVER must read a field; `rc` is read by ccd alone, at
  spawn time. No `SessionRecord` change, no `reviveFleetSession` change, no new
  agent round-trip. If RC state ever needs to surface in the PWA, that is a new
  slice with its own wire-discipline argument.
- **Absence permits:** absent (or garbled) `rc` follows the box — the writer is
  ccd itself, and the fail-safe direction for an unknown value is "behave as
  before", not "strip RC from a session nobody marked". Only the exact string
  `off` suppresses.
- **Not inferred from `hold`:** the hold field is written after spawn and released
  dynamically mid-program — worker-ness must be declared at creation, where the
  dispatch path already stands.
- **Doctor untouched:** the `rc` doctor check reports the BOX flag and stays
  truthful about exactly that; a per-session census is not this slice.
- **Skew:** an old ccd receiving `--no-rc` dies on the unknown token; the standing
  AGENT-FIRST deploy rule (this plan touches `ccd/`) is the guard — the agent/ccd
  lane ships before the server lane, so no deployed server composes the flag
  before the fleet's ccd parses it. A new ccd with no marker behaves exactly as
  today (absence permits), so the reverse order of operations inside one box is
  safe.

## Global Constraints

- `FLEET_PROTO` stays 1; no new wire field, no new registry field READ BY THE
  SERVER, no new agent grants/frames/code, no new ccd VERB (a flag on a
  whitelisted verb crosses the existing bare-prefix grant, `agent/src/whitelist.ts:323`).
- Suites: `./node_modules/.bin/vitest run <file>` from inside the package,
  FOREGROUND, never bare `npx vitest`; fixture HOMEs only (`makeCcdHarness`,
  `ghContainedEnv`); run from the canonical `/mnt` cwd (D-224).
- `ccd/ccd` edits re-stamp provenance (`shared/mark.mjs` `markGenerated`) and the
  whole change is **AGENT-FIRST** at deploy.
- Every guard ships with a mutation-measured red, count stated in the commit body.
- Deviations found during execution are nominated prose-only in commit bodies;
  the orchestrator mints numbers through `POST /api/ledger/deviations` (the
  allocator is live; floor is past 360 — never hand-sweep).
- The worker-skill literal edited in Task 3 keeps STRAIGHT apostrophes and no `"`
  character (its pin suite double-quotes); nothing else in either corpus moves.

## Wave order

Three tasks, strictly sequential: Task 1 (ccd) defines the field and flag; Task 2
(server) composes the flag at the one call site that means it; Task 3 (corpus +
docs) tells the truth about what now exists. Tasks 2 and 3 both consume Task 1's
landed spellings — tree wins for anchors, this plan's SEMANTICS win for behavior.

---

### Task 1: ccd — the `rc` field, the `--no-rc` flag, and the consult

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_add` arg parse (~:2534), the registry-write site
  just before its `_spawn_start` call (~:2694), and the `rcflag` line in
  `_spawn_start` (~:10418)
- Test: `server/test/ccd-rc-flag.test.ts` (extend), `server/test/ccd-spawn-split.test.ts` (extend)

**Interfaces:**
- Produces: registry field `rc` (absent | `off`); `ccd ws-add [--no-rc] <project> [slug]`
  (leading flag, exact-string match); the consult
  `_rc_enabled && [[ "$(_reg_get "$id" rc)" != "off" ]]`.
- Consumes: `_reg_set`/`_reg_get` (existing), `_rc_enabled` (`ccd/ccd:222`).

- [x] **Step 1: red-first — the suppression truth table.** Append to
  `server/test/ccd-rc-flag.test.ts` (inside its existing harness idiom — read the
  file's existing `on`-flag fixtures and reuse their helpers):

```ts
describe('the per-session rc field (the 2026-08-13 ruling, task #37)', () => {
  it('rc=off suppresses the flag even when the box says on — BOTH spawn lines', async () => {
    // box flag on, registry field off -> neither the primary nor the retry
    // carries --remote-control. Asserted through the same composed-command
    // capture ccd-spawn-split uses; anchor to this file's existing spawn
    // harness rather than inventing a new one.
  });
  it('an absent rc field follows the box — on stays on', async () => {});
  it('a garbled rc field follows the box — only the exact string off suppresses', async () => {
    // write "OFF\n" and "off extra" into the field; both spawn WITH the flag
    // under a box-on fixture. Absence permits; the writer is ccd itself.
  });
});
```

  Fill the bodies against the file's real helpers (the truth-table tests at the
  top of the file show the fixture shape). Run:
  `cd server && ./node_modules/.bin/vitest run test/ccd-rc-flag.test.ts` —
  expect the new tests RED (the field does not exist).

- [x] **Step 2: red-first — ws-add writes the field.** In the same suite or
  `ccd-spawn-split.test.ts` (whichever already exercises `cmd_ws_add` end-to-end
  in a fixture HOME — read both and pick the one with the cheaper harness):

```ts
it('ws-add --no-rc stamps rc=off before the first spawn, and a plain ws-add stamps nothing', async () => {
  // run `ccd ws-add --no-rc demo`; assert $REG/<id>.rc reads "off" AND the
  // captured spawn command carries no --remote-control despite box-on;
  // run `ccd ws-add demo2`; assert no .rc file exists and the flag IS present.
});
```

  Expect RED (unknown flag `--no-rc` dies in cmd_ws_add's positional parse).

- [x] **Step 3: implement.** Three edits to `ccd/ccd`:

  (a) `cmd_ws_add` head — parse the leading flag before the positionals:

```bash
cmd_ws_add() {   # [--no-rc] project [slug] — new worktree + session for an existing project
  # PER-WORKER RC (task #37, ruling 2026-08-13): the dispatch path declares a
  # spawn a dispatched worker AT CREATION — the only moment the fact is known
  # (hold is written later and released mid-program). Exact-string match, no
  # value parsing: nothing user-controlled reaches the flag.
  local norc=0
  [[ "${1:-}" == "--no-rc" ]] && { norc=1; shift; }
  local project="${1:?usage: ccd ws-add [--no-rc] <project> [slug]}" slug="${2:-}"
```

  (b) immediately after the last registry seed and BEFORE the `_spawn_start`
  call at ~:2694 (read the surrounding F8-ordering comment and keep it intact):

```bash
  # PER-WORKER RC: stamped before the first spawn so _spawn_start's consult
  # already sees it; survives swap and every Restart=always respawn; dies at
  # reap via _reg_purge's shape match. Absent = follow the box (D-99's
  # fail-safe direction, per session).
  (( norc )) && _reg_set "$id" rc off
```

  (c) the consult at ~:10418 — extend the existing comment block's last
  paragraph rather than replacing it, then:

```bash
  rcflag=""
  _rc_enabled && [[ "$(_reg_get "$id" rc)" != "off" ]] && rcflag="--remote-control '$id'"
```

  Keep the read-once property: one `rcflag` computation, both spawn lines
  (primary ~:10426, retry ~:10467) untouched consumers of it.

  Then re-stamp provenance: `node -e "import('./shared/mark.mjs').then(m => m.markGenerated('ccd/ccd'))"`
  (read `shared/mark.mjs` for the exact call if this spelling drifted).

- [x] **Step 4: green.** Re-run both suites plus the neighbours:
  `cd server && ./node_modules/.bin/vitest run test/ccd-rc-flag.test.ts test/ccd-spawn-split.test.ts test/ccd-workspaces.test.ts test/single-definition.test.ts` — all green.

- [x] **Step 5: persistence across respawn.** One more test (same harness):
  after `ws-add --no-rc`, kill the captured spawn state and re-drive the spawn
  path (`ccd ensure <id>` in the fixture, or the harness's respawn idiom) —
  the recomposed command STILL omits the flag. This is the test that makes the
  registry-field choice load-bearing (a caller-argv design cannot pass it).

- [x] **Step 6: mutation ceremonies, each planted alone, measured, reverted:**
  1. Delete the `[[ ... != "off" ]]` clause from the consult → the suppression
     test reds (expect exactly its reds, state the count).
  2. Delete the `(( norc )) && _reg_set` line → the ws-add stamping test reds.
  3. Flip the consult to `== "off"` → the absent-follows-box and garbled tests red.

- [x] **Step 7: commit** with the measured counts in the body.

### Task 2: server — the dispatch path declares its workers

**Files:**
- Modify: `server/src/ccdargv.ts:224` (add a sibling builder), `server/src/coord/dispatch.ts:237`
- Test: `server/test/run-routes.test.ts` (or the suite that already captures
  dispatch's composed ccd argv — grep for `wsAddCreates` and follow the fixture)

**Interfaces:**
- Consumes: Task 1's landed `--no-rc` (leading-flag position).
- Produces: `CCD_ARGV.wsAddWorker: (p: string) => CcdArgv` = `['ws-add', '--no-rc', p]`.

- [x] **Step 1: red-first.** In the dispatch suite, pin the composed argv:

```ts
it('a wave-1 fresh spawn declares the worker: ws-add carries --no-rc, in the leading position ccd parses', async () => {
  // drive dispatchRun on a fresh run (the wsAddCreates fixture path) and
  // assert the recorded ccd call is ['ws-add', '--no-rc', '<project>'].
});
it("the PWA's ordinary workspace-add stays box-default — no --no-rc anywhere in its argv", async () => {
  // POST the server.ts:1539 route in its existing test harness; assert
  // ['ws-add', '<project>'] exactly.
});
```

  Expect the first RED (dispatch still composes plain `wsAdd`).

- [x] **Step 2: implement.** In `ccdargv.ts`, beside `wsAdd`:

```ts
  /** The dispatch path's ws-add: a dispatched program worker spawns WITHOUT
   *  --remote-control (the 2026-08-13 ruling, task #37) — declared at
   *  creation, the only moment worker-ness is known. Leading-flag position is
   *  ccd's parse contract. The PWA's ordinary add stays `wsAdd`. */
  wsAddWorker: (p: string) => argv(['ws-add', '--no-rc', p]),
```

  In `dispatch.ts:237`: `const argv = CCD_ARGV.wsAddWorker(run.project);`

- [x] **Step 3: green + mutation.** Run the dispatch suite and
  `test/typecheck-tests.test.ts`. Mutation: revert the dispatch call site to
  `wsAdd` → exactly the wave-1 pin reds; restore, state the count.

- [x] **Step 4: commit.**

### Task 3: the corpus and the docs stop describing the old world

**Files:**
- Modify: `ccd/worker-skill/SKILL.md` (clause 10's sentence), `server/test/worker-skill.test.ts:59`
  (the pin moves with it), `README.md:531-563` (the per-box section gains the
  per-worker paragraph), `CLAUDE.md` (the header parenthetical)

- [x] **Step 1: read the pinned sentence.** `ccd/worker-skill/SKILL.md:67` and its
  verbatim pin at `worker-skill.test.ts:59` — the sentence the worker-skill plan
  (`2026-08-20-worker-skill.md:171`) designated for revision when #37 lands.

- [x] **Step 2: revise BOTH together** (test first — update the pin's literal, watch
  it red against the unedited corpus, then edit the corpus to match). New sentence,
  straight apostrophes, no `"` character, same clause position and surrounding
  prose untouched:

  The clause stops saying "there is no per-session form of this flag to reach
  for" and instead states: dispatched workers spawn without remote control (the
  2026-08-13 ruling, landed) — the dispatch path declares it at creation via
  ws-add, it is not the worker's to change, and the box flag still governs every
  non-dispatched session. Keep the sentence in the skill's own register; the
  exact words are the implementer's, the pin makes them permanent.

- [x] **Step 3: README + CLAUDE.md.** In README's "The box decides
  `--remote-control`" section: add one paragraph — the box decides for ordinary
  sessions; a dispatched program worker is declared `--no-rc` at `ws-add` by the
  dispatch path (registry field `rc`, absent = follow the box), per the
  2026-08-13 ruling. In `CLAUDE.md`'s header line, extend the parenthetical:
  `(--remote-control or not — per box, ~/.ccrc/remote-control; dispatched
  workers per session, ruling 2026-08-13)`.

- [x] **Step 4: suites.** `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts test/coordinator-skill.test.ts test/topology-clean.test.ts test/single-definition.test.ts` — green; the skill installers re-run at deploy (no installer edit here — no references/ change).

- [x] **Step 5: mutation.** Restore the old sentence in SKILL.md only → the pin
  reds. Revert, state the count.

- [x] **Step 6: commit.**

## Deviations found

(minted through `POST /api/ledger/deviations` at close — the allocator is the
namespace's only writer now; executors nominate prose-only in commit bodies)
