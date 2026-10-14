# Stall watch settings wave 3: a subagent never erases the main thread's question, and a dialog's clock ignores mail it cannot receive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:subagent-driven-development` with `superpowers:test-driven-development` for every test step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch-settings`, **wave 3 of 3** (ledger `docs/superpowers/programs/stall-watch-settings.md`,
R38). The operator kept both fixes of finding 4063 in this programme on 2026-10-12. Deploy class: **both** — the hook
reaches the fleet box through `ccrc update`'s install spine, `stall.ts` runs on the server; the server's
reader (`hookstate.ts`) must not trail the hook, and the default moves are fleet-first, so they open a skew window
(`ccrc rollout`, the PWA's apply and the automatic moves; D-4041's Cost if wrong). One PR from a fresh child workspace. This plan file rides in that PR: its
first commit adds it, unchanged, from the coordinator's branch.

**Goal:** Fix the two defects finding 4063 measured on 2026-10-08 (ledger R32):
1. A background subagent's PreToolUse or PostToolUse writes `state: working, ask: null` over the session's
   `hookstate.json`, so a question the main thread asked while a subagent ran is erased within seconds (3.1 s measured)
   and no ask row is ever minted.
2. The stall watch's dialog cap (hold 2b) times its 2 h from the newest mail on the run, inbound included, so each
   coordinator nudge to a worker parked on a dialog — mail that cannot land on a `waiting` pane — restarts the clock.

**Architecture:** Fix 1 is a shell change in `ccd/session-hook.sh`'s tail, beside the existing SubagentStart/SubagentStop
carry-forward: a subagent's tool event (`$paid` set) that finds the hookstate `waiting` keeps `waiting`, its ask and its
`interrupted` flag. Only `waiting` is carried; every other state keeps today's write. Fix 2 is a pure L1 change in
`server/src/coord/stall.ts`: the dialog cap gets its own clock, the shared one less the inbound-mail term; the limit cap
keeps the shared clock unchanged.

**Tech Stack:** bash + jq (the hook), TypeScript (L1), vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` — §3.3 (the hook file is shared with
subagents: the measured overwrite this wave ends), §10 step 2 (hold 2a, a question, uncapped; hold 2b, a dialog with no
ask, capped "since neither [mail] can land on `waiting`"), §11 item 8 (the dialog cap's ruling). The forensic record is
the ledger's R32 and `.superpowers/sdd/stall-watch-settings/finding-4063-forensics.json` on the coordinator's box.

## Global Constraints

- **Nothing new above `ccd/session-hook.sh:2900`.** README anchors that line, and the turn marker's departure
  `marker-logic-in-the-tail` (D-3615) put all new logic below it. The change in Task 1 sits directly after the
  SubagentStart/SubagentStop block (≈:3754-3770 at `da1373cf6`) and before the "Transitions to working/done clear the
  ask" line.
- **Do not edit `server/test/session-hook.test.ts`** (claim 1188, run 354, held to 22:22Z on 2026-10-12 and rotated
  serially). Task 1's tests go in a new file, `server/test/session-hook-subagent-ask.test.ts`, with the harness copied
  from `session-hook-turnmark.test.ts`, which documents the same reason. Running `session-hook.test.ts` read-only is
  fine and required.
- **Do not edit `README.md`, `server/src/watch.ts` or `server/src/coord/store.ts`** (claim 1172, run 358). Neither fix
  needs them. If a README sentence becomes false, name it in the wave-done; the coordinator routes it.
- `stall.ts` stays L1: pure, imports unchanged, and it spells no marker name (`single-definition.test.ts`).
- The hook's hot path: `session-hook.test.ts` pins PostToolUse p95 under 150 ms. Task 1 adds one `jq` fork, and only
  on a subagent tool event that finds `waiting`; every other event pays a string compare. (After D-4041,
  SubagentStart/SubagentStop pay one fork fewer than at the base, and a subagent tool event over `waiting` pays +1.)
- The README citation instrument agrees with `main`'s own count, measured on this wave's base before any edit:
  `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.
  The highest line any cited corpus names in `ccd/session-hook.sh` is below :3754, so the edit should move nothing;
  measure it, do not assume it.
- Mutation-table discipline: each guard ships with a row measured red when it is removed, before and after.
- Deviation numbers: this plan defines **D-4039** and **D-4040**. D-4041 was assigned from the
  block's reserve, and one reserve number remains: it is the coordinator's to assign to a fix round's departure, by
  ruling; until then a new departure is named by slug. Never
  call the allocator, never write another number, a range or `D-TBD`.
- Suites in the foreground, one file per command, timeout at least 600000 ms. macOS CI legs gate nothing.
- Commit on the workspace's own branch; never a separate feature branch.

## Review Focus

1. **A subagent's own dialog while the main thread waits.** A background subagent's PermissionRequest still writes its
   `{approval}` ask over a main-thread question (the PermissionRequest arm sets `waiting` for any sender). Out of scope
   here: it is a real dialog on the pane, and under `bypassPermissions` it never fires. The wave-done names it.
2. **A carried `waiting` keeps its stamp and gains `aliveAt` (D-4041).** The carry keeps the wait's own `updatedAt`
   and `event` and writes the additive `aliveAt` = now; a main-thread write carries none. The first version of this
   wave moved the stamp, for "the `delegates` hold and the frozen arm"; review showed neither can see a carried
   `waiting` (a `waiting` hookstate sets `dialogPending`, and the verdict returns at its dialog step before either arm).
   The reader that needs liveness is the aged door (`hookstate.ts`, 30 min), and it now ages on `max(updatedAt,
   aliveAt)`. The attention bucket, the ask row's `askAt` and the answer's CAS read the wait's start, which no longer
   moves. The carry is decided from one fresh read, so a main-thread answer landing after the prefilter is not
   overwritten. Task 1's cases pin the kept stamp, the absent `aliveAt` after a main write, and that race.
3. **Background work after the main thread's Stop.** A subagent's tool event over `done` still writes `working`, as
   today: the card keeps reading `working` while background work runs. Task 1 pins this, so the carry cannot widen to
   every state unnoticed.
4. **A dialog under an idle word (`dialogPending`).** The gate may deliver there; mail that lands re-stamps the live
   word, so dropping the inbound term loses nothing. Task 2's cases use `waiting`; one case covers `dialogPending`.
5. **The limit cap.** It shares the old clock and must keep the inbound term (a limited pane is idle and receives
   mail). Task 2 pins it with a control row.

## File Structure

| File | Change |
|---|---|
| `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md` | this plan, committed first, unchanged; its Deviations section is the only part a worker edits |
| `ccd/session-hook.sh` | Task 1: one block after the SubagentStart/SubagentStop block |
| `server/test/session-hook-subagent-ask.test.ts` | Task 1: new |
| `server/src/coord/stall.ts` | Task 2: `dialogQuietSince`, the dialog cap's use of it, `capQuietSince`'s docstring |
| `server/test/stall-verdict.test.ts` | Task 2: one new `describe` |

---

### Task 1: a subagent's tool event keeps the main thread's `waiting` and its ask

> **D-4041 supersedes this task's snippet wherever it handles the stamp:** a carried `waiting` keeps the file's `updatedAt`
> and `event` and writes `aliveAt` (D-4041 below). The snippet and the steps below are the first round's text, kept as written.

**Files:**
- Modify: `ccd/session-hook.sh` (tail, after the `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]` block)
- Create: `server/test/session-hook-subagent-ask.test.ts`

**Interfaces:**
- Consumes: the payload parse's `paid` (non-empty when the payload carries an `agent_id`, ≈:2767), `prev_state` (read
  for every event, ≈:3127), `$f` (this session's `hookstate.json`).
- Produces: `hookstate.json` keeps `state: "waiting"`, the same `ask` and the same `interrupted` across a subagent's
  PreToolUse or PostToolUse; `updatedAt` and `event` are written as today.

- [ ] **Step 1: Write the failing tests**

Create `server/test/session-hook-subagent-ask.test.ts`. Copy the fixture, `hookEnv`, `run`, `stateFile` and `readState`
from `server/test/session-hook-turnmark.test.ts` (:18-55 at `da1373cf6`) verbatim, then:

```ts
// Stall watch settings wave 3, Task 1: `subagent-tool-event-keeps-the-waiting-ask` (D-4039).
// Finding 4063: a background subagent's tool events wrote `working` and a null ask over the main thread's question.

const Q = { questions: [{ question: 'Which base?', header: 'Base', multiSelect: false,
  options: [{ label: 'main', description: 'current main' }, { label: 'stable', description: 'the stable branch' }] }] };
const SUB = { agent_id: 'a882033f84d7f43d3', agent_type: 'general-purpose' };
const askViaPermission = (): void => { run({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: Q }); };

describe('a subagent tool event keeps the main thread waiting (D-4039)', () => {
  it('a subagent PreToolUse after a PermissionRequest question leaves waiting and the questions', () => {
    askViaPermission();
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('a subagent PostToolUse does too, and so do many in a row', () => {
    askViaPermission();
    for (let i = 0; i < 3; i++) run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('the PreToolUse question arm is kept the same way', () => {
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: Q });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('an approval dialog is kept the same way', () => {
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
    run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'rm -rf build' } } });
  });

  it('the stamp and the event still move, for the delegates hold and the frozen arm', () => {
    askViaPermission();
    const before = readState()['updatedAt'] as number;
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    const after = readState();
    expect(after['event']).toBe('PostToolUse');
    expect(after['updatedAt'] as number).toBeGreaterThanOrEqual(before);
  });

  it('control: the main thread answering (its own PostToolUse) ends the wait and clears the ask', () => {
    askViaPermission();
    run({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: Q });
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });

  it('scope: a subagent tool event over done still writes working, as before', () => {
    run({ hook_event_name: 'Stop' });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });
});
```

If a fixture value above does not survive the hook's parse (the `summary` of an approval is cut at 200 characters;
`agent_id` only needs to be non-empty), adjust the fixture, never the assertion's meaning, and say so in the report.

- [ ] **Step 2: Run them to verify they fail**

Run (from `server/`): `./node_modules/.bin/vitest run test/session-hook-subagent-ask.test.ts`
Expected: the first four cases FAIL (`state: 'working'`, `ask: null`); the stamp case, the control and the scope case
PASS (the stamp case pins that the fix keeps today's stamp and event).

- [ ] **Step 3: Write the block**

In `ccd/session-hook.sh`, directly after the `fi` that closes the SubagentStart/SubagentStop block and before the
`# Transitions to working/done clear the ask` comment:

```bash
# `subagent-tool-event-keeps-the-waiting-ask` (D-4039, finding 4063): a subagent's tool event never ends the main
# thread's wait. Its PreToolUse/PostToolUse reaches the case above as `working` with a null ask, and written as is it
# erased a question the main thread asked 3.1 s earlier, before any pane tick could mint the ask row. Only `waiting`
# is carried, with its ask and `interrupted`; the stamp and the event move as for any event (the delegates hold and
# the frozen arm read them), and every other state keeps today's write.
if [[ -n "$paid" && "$prev_state" == waiting && ( "$event" == PreToolUse || "$event" == PostToolUse ) ]]; then
  state="waiting"
  ask_json=$(jq -c '.ask // null' "$f" 2>/dev/null) || ask_json="null"
  interrupted=$(jq -r 'if .interrupted == true then "true" else "false" end' "$f" 2>/dev/null) || interrupted="false"
fi
```

Read the surrounding code before pasting: if `prev_state`, `$f` or `interrupted` are spelled or scoped differently at the
base, follow the code and report the difference. The `jq` pair may be folded into one fork if the file's existing idiom
does so; keep the two failure fallbacks.

- [ ] **Step 4: Run them to verify they pass**

Run: `./node_modules/.bin/vitest run test/session-hook-subagent-ask.test.ts` — Expected: all PASS.
Then, read-only: `./node_modules/.bin/vitest run test/session-hook.test.ts`, `test/session-hook-turnmark.test.ts`,
`test/hookstate.test.ts`, `test/install-session-hooks.test.ts` — Expected: green, the PostToolUse p95 case included
(it is a known load flake: re-run it alone before calling it a break). `bash -n ccd/session-hook.sh` clean.

- [ ] **Step 5: Measure the mutation rows**

Out of tree (`git archive` of the tip into scratch), one mutation at a time, restored and checked with `cmp`:
- M1: delete the block → cases 1-4 FAIL.
- M2: drop `"$prev_state" == waiting &&` → the scope case FAILS.
- M3: drop `-n "$paid" &&` → the control case FAILS.
Record each as `<mutation> → <n> failed (<titles>)` in the plan's Deviations entry for D-4039.

- [ ] **Step 6: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook-subagent-ask.test.ts
git commit -m "fix(hook): a subagent's tool event keeps the main thread's waiting and its ask (D-4039)"
```

### Task 2: the dialog cap's clock ignores mail the dialog cannot receive

**Files:**
- Modify: `server/src/coord/stall.ts` (`capQuietSince` ≈:733 and its docstring; the hold 2b line ≈:1067)
- Test: `server/test/stall-verdict.test.ts` (one new `describe` at the end of the file)

**Interfaces:**
- Consumes: `StallFacts.workerLast`, `StallFacts.inboundLast`, `input.subject.primary.dispatchedAt`, `live.since`.
- Produces: `dialogQuietSince(input, f, liveSince): number` (module-private). `capQuietSince` keeps its signature and is
  now the limit cap's clock only.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/stall-verdict.test.ts`, using the file's own `stallInput`, `workerAt`, `liveWord`, `mailRow`,
`capOf`, `hold`, `COORD`, `WORKER`, `NOW`, `H` and `MIN`:

```ts
describe('dialog-cap-clock-ignores-inbound-mail (D-4040)', () => {
  const A = NOW - 3 * H;                                   // the dialog's live stamp
  const parked = workerAt({ live: liveWord('waiting', A) });
  const nudge = (id: number, at: number) => mailRow(id, at, COORD, WORKER, 'status', 'fix-round');

  it('a coordinator nudge sent while the dialog shows does not restart the 2 h', () => {
    expect(stallVerdict(stallInput({ worker: parked, mail: [nudge(5101, A + 30 * MIN)] }), A + STALL_QUIET_MS))
      .toEqual(capOf('dialog-cap', A));
  });

  it('nor do two (finding 4063: each restarted it)', () => {
    const mail = [nudge(5101, A + 30 * MIN), nudge(5102, A + 90 * MIN)];
    expect(stallVerdict(stallInput({ worker: parked, mail }), A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', A));
  });

  it('nor does mail to the worker role on the run', () => {
    const mail = [mailRow(5103, A + 30 * MIN, COORD, 'worker', 'status', 'fix-round')];
    expect(stallVerdict(stallInput({ worker: parked, mail }), A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', A));
  });

  it('a pending harness menu under an idle word is timed the same way', () => {
    const menu = workerAt({ dialogPending: true, live: liveWord('idle', A) });
    expect(stallVerdict(stallInput({ worker: menu, mail: [nudge(5104, A + 30 * MIN)] }), A + STALL_QUIET_MS))
      .toEqual(capOf('dialog-cap', A));
  });

  it("the worker's own mail still restarts it: the worker acted", () => {
    const mail = [mailRow(5105, A + 30 * MIN, WORKER, 'coordinator')];
    expect(stallVerdict(stallInput({ worker: parked, mail }), A + STALL_QUIET_MS)).toEqual(hold('dialog'));
    expect(stallVerdict(stallInput({ worker: parked, mail }), A + 30 * MIN + STALL_QUIET_MS))
      .toEqual(capOf('dialog-cap', A + 30 * MIN));
  });

  it('control: the limit cap keeps the inbound term', () => {
    // the limited worker of the `limit-cap: once at LIMIT_HOLD_CAP_MS of quiet` case (≈:689), stamped at A
    const limitedAtA = workerAt({ live: liveWord('idle', A), limits: { five: 100, seven: 55 } });
    const mail = [nudge(5106, A + 30 * MIN)];
    expect(stallVerdict(stallInput({ worker: limitedAtA, mail }), A + LIMIT_HOLD_CAP_MS)).toEqual(hold('limit'));
    expect(stallVerdict(stallInput({ worker: limitedAtA, mail }), A + 30 * MIN + LIMIT_HOLD_CAP_MS))
      .toEqual(capOf('limit-cap', RUN67_DISPATCHED));
  });
});
```

The dialog key is `A` in the first four cases because the fixture's dispatch (`RUN67_DISPATCHED`, 2026-09-15) is
earlier than the dialog, and a `fix-round` subject is not a coordinator `wait:`.

- [ ] **Step 2: Run them to verify they fail**

Run: `./node_modules/.bin/vitest run test/stall-verdict.test.ts -t 'D-4040'`
Expected: the first four cases FAIL (`hold('dialog')`); the worker-mail case and the control PASS.

- [ ] **Step 3: Write the clock**

In `server/src/coord/stall.ts`, narrow `capQuietSince`'s docstring from "The dialog and limit caps' clock" to the limit
cap's, and add beside it:

```ts
/** `dialog-cap-clock-ignores-inbound-mail` (D-4040, finding 4063): the dialog cap's clock, `capQuietSince` less the
 *  inbound term. Mail cannot land on a pane a dialog holds (spec §10 step 2b: "neither can land on `waiting`"), and mail
 *  that did land re-stamps the live word, so a coordinator's nudge to a parked worker never restarts the 2 h. The
 *  worker's own mail still counts: it is the worker acting. No re-activation term, as `capQuietSince` (D-3788). */
function dialogQuietSince(input: StallInput, f: StallFacts, liveSince: number): number {
  return Math.max(liveSince, f.workerLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0);
}
```

and in the verdict's hold 2b line, time the dialog cap from it:

```ts
  if (dialogShaped) return now - dialogQuietSince(input, f, live.since) >= stallQuietMs(input) && !stallDialogCapDone(input, live.since) ? capVerdict('dialog-cap', dialogKey) : holdVerdict('dialog');
```

`capQuiet` stays for the limit hold. `dialogKey` is unchanged: it keys the push once per dialog, it is not the clock.
Check that nothing else times the dialog cap (`grep -n "'dialog-cap'" server/src/coord/stall.ts`); the push body
(≈:1407) reads the live stamp and needs no change.

- [ ] **Step 4: Run them to verify they pass**

Run: `./node_modules/.bin/vitest run test/stall-verdict.test.ts` — Expected: all PASS, the existing dialog-cap and
limit-cap cases included. Then `test/stall-sweep.test.ts`, `test/stall-bodies.test.ts`, `test/single-definition.test.ts`,
`test/topology-clean.test.ts`, and `npx tsc --noEmit -p .` plus `npx tsc --noEmit -p test/tsconfig.tests.json` — green.

- [ ] **Step 5: Measure the mutation rows**

- M4: time hold 2b from `capQuietSince` again → the first four D-4040 cases FAIL.
- M5: add `f.inboundLast?.at ?? 0` to `dialogQuietSince` → the same four FAIL.
- M6: drop the inbound term from `capQuietSince` → the limit-cap control FAILS.
Record each in the plan's D-4040 entry.

- [ ] **Step 6: Commit**

```bash
git add server/src/coord/stall.ts server/test/stall-verdict.test.ts
git commit -m "fix(stall): the dialog cap's clock ignores mail the dialog cannot receive (D-4040)"
```

### Whole-wave checks (before wave-done)

From `server/`, one file per command, foreground:
- the citation instrument (Global Constraints) — equal to `main`'s own count at this wave's base;
- `test/deviation-refs.test.ts` after `git fetch origin main`, `test/dtbd.test.ts`, `test/topology-clean.test.ts`;
- `test/single-definition.test.ts`, `test/typecheck-tests.test.ts`;
- `git merge-tree --write-tree HEAD origin/main` clean.

## Deviations found

Both numbers were issued to this programme in its 2026-10-05 17:47 block ("stall-watch-settings: W1 server, W2 PWA"),
held in reserve, and assigned to this wave by the coordinator's ruling R38. A third, D-4041, was assigned from the same block by the
coordinator's ruling R40 (the fix round after review). One number of the block remains in reserve.

### D-4039 `subagent-tool-event-keeps-the-waiting-ask`

- **Departs from:** the hook's own rule that a transition to `working` clears the ask (`ccd/session-hook.sh`, the
  comment "Transitions to working/done clear the ask" and the code under it), as applied to a subagent's tool events — the overwrite spec §3.3
  measured and finding 4063 traced to an erased question (ledger R32).
- **What W3 does:** a PreToolUse or PostToolUse carrying `agent_id`, arriving while the hookstate reads `waiting` and
  that wait does not carry `waitBy: "subagent"` (it was raised by the main thread), keeps `waiting`, the ask and
  `interrupted`. (As first shipped, the stamp and the event moved as for any event; D-4041 keeps them, below.) A wait a
  subagent raised itself is not carried.
- **Why:** the server mints an ask row only on the first pane tick that sees the dialog (`detectDialogs`), and the
  stall watch's hold 2a reads the hookstate ask. An erased ask leaves the question invisible to both, and to the mail
  gate's sender, for as long as the dialog stands (3 h measured).
- **Not done:** carrying every state. Background work after the main Stop keeps writing `working`, which the card,
  the dispatch busy check and the operator's reading of a session rely on; the operator has not ruled that away.
- **Pinned by:** `server/test/session-hook-subagent-ask.test.ts` (28 cases after D-4041). Its first describe holds 20:
  13 of D-4039's original fourteen (the fourteenth, the stamp-moves case, is retired) and 7 that D-4041 added; the
  second describe, "the carry is decided from one fresh read", holds 8, all D-4041's. Every row below was re-measured
  at commit `ed7537045`, out of tree, one mutation at a time, each restored and `cmp`-checked; the unmutated hook passes
  28 of 28. (M1 and M13 below quote one failing title as fix round 3 renamed it after this measurement, R45 item 7; their counts are unchanged.) The carry now reads the file once, fresh (D-4041), so the conditions below are the ones the code holds today,
  and `$fr_by`, `$fr_state` and `$fr_ask` are that read's values:
  M1 (delete the carry block) → 14 failed (a carried write keeps updatedAt and event and writes aliveAt; a main-thread wait survives a SubagentStop and a SubagentStart, and is not flipped to subagent-raised; a main-thread write after a carried one carries no aliveAt; a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned; a subagent PostToolUse does too, and so do many in a row; a subagent PreToolUse after a PermissionRequest question leaves waiting and the questions; a subagent PreToolUse keeps the stamp and writes aliveAt too, and a second carry keeps the FIRST stamp; an approval dialog is kept the same way; an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); control: with no interleaving the shim is a pass-through and the wait is carried; the PreToolUse question arm is kept the same way; the interrupted flag is carried with the wait; the kept event is cut to letters: a stored event with other characters is written without them; the prefilter keeps the fresh read off every other event: one read over working or done, and for a main-thread event over a wait);
  M2 (drop `"$prev_state" == waiting &&`, now the no-fork prefilter only: the fresh read still decides, so only the read-count pin sees it) → 1 failed (the prefilter keeps the fresh read off every other event: one read over working or done, and for a main-thread event over a wait);
  M3 (drop `-n "$paid" &&` from the carry condition) → 3 failed (a main-thread write after a carried one carries no aliveAt; control: the main thread answering (its own PostToolUse) ends the wait and clears the ask; the prefilter keeps the fresh read off every other event: one read over working or done, and for a main-thread event over a wait);
  M7 (drop the event-type conjunct) → 2 failed (Review Focus 1 scope pin: a subagent PermissionRequest over a main-thread question writes its own approval; SubagentStart and SubagentStop read the hookstate file with two jq forks: the prefilter and the shared fresh read);
  M8 (drop the `interrupted` carry in the block) → 1 failed (the interrupted flag is carried with the wait);
  M9 (drop the provenance condition, `"$fr_by" != subagent`) → 2 failed (a subagent's own approved dialog ends at its next tool event (working, no ask); the same holds after a Stop, and across a SubagentStop that carries the provenance);
  M10 (stop preserving `waitBy` in the SubagentStart/SubagentStop block) → 2 failed (control: SubagentStart over working and over a subagent-raised wait write no aliveAt; the same holds after a Stop, and across a SubagentStop that carries the provenance);
  M11 (never record `waitBy` on a fresh subagent wait) → 4 failed (Review Focus 1 scope pin: a subagent PermissionRequest over a main-thread question writes its own approval; a subagent's own approved dialog ends at its next tool event (working, no ask); control: SubagentStart over working and over a subagent-raised wait write no aliveAt; the same holds after a Stop, and across a SubagentStop that carries the provenance);
  M12 (delete the `waitby=""` reset in the carry) → 1 failed (a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned);
  M13 (delete `ask_json="${fr_ask:-null}"` in the carry, so the subagent's own question is kept instead of the main thread's) → 9 failed (a main-thread wait survives a SubagentStop and a SubagentStart, and is not flipped to subagent-raised; a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned; a subagent PostToolUse does too, and so do many in a row; a subagent PreToolUse after a PermissionRequest question leaves waiting and the questions; an approval dialog is kept the same way; an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); control: with no interleaving the shim is a pass-through and the wait is carried; the PreToolUse question arm is kept the same way; the interrupted flag is carried with the wait).
- **Departure `carry-only-a-main-thread-wait` (task review, Important 1):** the carry now applies only to a wait the
  main thread raised. The hook records an additive hookstate key `waitBy: "subagent"` when a subagent's own event freshly
  sets `waiting`, preserves it across the SubagentStart/SubagentStop carry, and the D-4039 block skips a stored
  subagent-raised wait, so a subagent's approved dialog ends at its next tool event as it did before. It took no number.
  It added one `jq` fork to every SubagentStart/SubagentStop (review 397 F2); D-4041 folds the block's three reads into
  one shared fresh read, so that block now pays two forks fewer than at the tip of the first round and one fewer than at
  the base (table under D-4041).
- **Cost if wrong:**
  - A main wait that ends with no main hook event (Esc on a dialog fires no Stop; a denial fires nothing this hook maps)
    stays `waiting` while subagents write, until the next main-thread event. While it stands:
    - fleet `dialogPending` is true (`fleet.ts` ORs a `waiting` hookstate into it);
    - the stall verdict holds `dialog` and can push `dialog-cap`, more than once if the live word re-stamps, and it
      pre-empts the limit, frozen, delegates and coordinator-ball arms; the D, E and failed session verdicts hold
      `dialog` the same way (`stall.ts:1566`);
    - the PWA's `turnStall` wedge chip is suppressed (`pwa/src/fleet/SessionLine.tsx:272` requires `!dialogPending`);
    - the mail gate refuses `pending-ask`;
    - the PWA shows a stale question and an attention row;
    - a later hookless dialog (sandbox, elicitation) is minted as an ask from the STALE question and mailed to the
      parent with stale buttons, and its operator push waits out the hold's grace. `answerAsk`'s menu check refuses any
      press, so no wrong keystroke is possible.
  - After D-4041 that last dialog takes the capped dialog hold instead of the uncapped `ask` one, once that row's hold
    has lapsed (while the ask row minted from the stale question is `held` or `answering`, `askRowOpen` still returns
    the uncapped `ask` hold), because the stale `hookAsk.at` no longer moves with every subagent call. At the first round's tip the carry re-stamped it, so the cap
    never ran down.
  - Not done: an age bound on the carry, because it would bring finding 4063 back for a long real wait.
  - Two residual races remain, one each way (the file is last-writer-wins by design):
    - **Erase direction, untouched by D-4041.** The carry runs only when the prefilter read `waiting`. A main question
      that lands after a subagent hook's prefilter read `working` is overwritten by that hook's `working` write, which
      leaves a null ask: finding 4063's own shape, within one hook run, as at the base. Measured with the forced
      interleaving (below): the file ends `working`, ask null, at the first round's tip and now alike. Closing it would
      cost a fork on every subagent tool event.
    - **Resurrect direction, narrow.** D-4041 closes the part of the answer-direction window that lay between the
      prefilter read and the fresh read (variant 1, measured: `waiting` before, `working` now). What stays is a
      main-thread answer landing between the fresh read and the `mv`, a few milliseconds inside one hook run: it is
      overwritten by the carried `waiting`, which the next main-thread event heals (variant 2, measured, under D-4041).
  - A carried `waiting` no longer moves `updatedAt` (D-4041), so the two costs the first round named, the badge re-firing
    after an ack and `ask-moved` refusing more often, are gone.
  - A subagent tool event never ends the main thread's wait only for PreToolUse/PostToolUse. A subagent PermissionRequest
    still replaces a main question with its own approval, as at the base (Review Focus 1; the scope pin).
  - `waitBy` rests on a subagent's PermissionRequest payload carrying `agent_id`. No live capture shows that: the capture
    files hold no PermissionRequest at all (0 of 437; the capture sessions ran under bypass). The evidence is static,
    the bundle builds that input with the same base builder as PreToolUse, whose captures do carry `agent_id` (spec §11
    risk 3). If a build omitted it, `waitBy` would never be recorded and the regression the departure fixes would
    return for sessions that are not under `bypassPermissions`.

### D-4040 `dialog-cap-clock-ignores-inbound-mail`

- **Departs from:** `capQuietSince`'s shared clock for both caps ("the same mail terms, from the live stamp whatever the
  word", `stall.ts` ≈:733), for the dialog cap only.
- **What W3 does:** the dialog cap times its quiet from the latest of the dialog's live stamp, the worker's own last
  mail and the dispatch; inbound mail is not a term.
- **Why:** spec §10 step 2b already says neither worker nor coordinator mail can land on `waiting`. Counting it let
  each nudge push the cap back 2 h (finding 4063: two nudges, two restarts), so the more a coordinator tried, the later
  the operator heard.
- **Pinned by:** the `dialog-cap-clock-ignores-inbound-mail (D-4040)` describe in `stall-verdict.test.ts` (6 cases).
  Every row below was measured at commit `11e1efb8e`, out of tree, one mutation at a time, each restored and
  `cmp`-checked; the unmutated file passes 315 of 315:
  M4 (time hold 2b from `capQuietSince` again) → 4 failed (a coordinator nudge sent while the dialog shows does not restart the 2 h; nor do two (finding 4063: each restarted it); nor does mail to the worker role on the run; a pending harness menu under an idle word is timed the same way);
  M5 (add `f.inboundLast?.at ?? 0` to `dialogQuietSince`) → 4 failed (the same four);
  M6 (drop the inbound term from `capQuietSince`) → 1 failed (control: the limit cap keeps the inbound term).
- **Cost if wrong:** if some inbound mail does reach a pane under a dialog without re-stamping its word, the cap fires
  up to 2 h earlier than today for that dialog: one operator push, never mail.

### D-4041 `a-carried-wait-keeps-its-stamp`

Assigned from the programme's reserve by the coordinator's ruling R40. It resolves review 397's F3 and its race finding.

- **Departs from:** D-4039's "the stamp and the event move as for any event" for a carried `waiting`, as first shipped and
  as Review Focus 2 first read; and the hook's rule that every write stamps `updatedAt` now.
- **What W3 does:**
  - On every subagent-originated write over a MAIN-thread `waiting`, the hook keeps the file's prior `updatedAt` and
    `event`, as well as the state, ask and `interrupted`, and writes an additive `aliveAt` = now. That covers a subagent
    PreToolUse/PostToolUse and SubagentStart/SubagentStop. A main-thread write rewrites the file with no `aliveAt`, and
    so does every other write.
  - The carry is decided from ONE fresh `jq` read of the file at the carry point (state, `waitBy`, ask, `interrupted`,
    `updatedAt`, `event`), not from `prev_state`, which the prefilter read much earlier. `prev_state` stays as the
    no-fork prefilter. The SubagentStart/SubagentStop block takes its state, ask, `interrupted` and `waitBy` from the
    same read, so its three forks become one.
  - The fresh read prints `state` only when it is one of the three words the hook writes (`working`, `waiting`,
    `done`), and nothing otherwise, so a corrupt stored state is never healed into `waiting` and carried: a
    SubagentStart/SubagentStop leaves such a file alone, and a tool event falls through to today's write. `event` is cut
    to letters, and `updatedAt` prints its floor when it is a number. What makes a stamp keepable is the `^[0-9]+$`
    test in `_hook_keep_stamp` alone; the `type == "number"` in the read is positional (see the N rows).
  - The write names `event` as `${w_ev:-$event}`: when the stored event is null, empty, not a string or has no letters,
    the kept `updatedAt` is paired with the CURRENT event's name. Harmless to every reader (`event` is read only for
    plumbing words and `UserPromptSubmit`); a fallback, not a pin.
  - `hookstate.ts` ages a file on `max(updatedAt, aliveAt)` when `aliveAt` is a finite number. An absent or malformed one
    is ignored: never `malformed`, never `no-state` by itself. `HookState` is unchanged; `aliveAt` rides on the raw
    read's ok variant as an optional field.
  - A file whose `updatedAt` is negative, is not a number, or is a value jq prints in exponent form (such as 1e16 or
    1e300: which values print that way follows jq's number formatting, not a size cut) keeps no stamp: the write is as before, with a fresh one. A non-negative fractional value keeps its floor (the hook writes integer
    milliseconds only, so one is a foreign or corrupt file, and the floor moves the stamp by under 1 ms); a negative one, such as -0.5, floors to -1 and is refused.
- **Why:** the moving stamp (D-4039 as first shipped) was meant to serve the `delegates` hold and the frozen arm. Neither
  can see a carried `waiting`: a `waiting` hookstate sets fleet `dialogPending`, and the verdict returns at its dialog
  step before them. What the moving stamp did instead:
  - re-fired the attention badge (`bucketSince` reads the stamp when the hook state is `waiting`);
  - opened an `ask-moved` window on the coordinator's answer (the CAS against `askAt`): modelled at about 45% of answers
    for a session making a tool call every 3 s;
  - lost the feed record when the operator's answer lost its CAS (`server.ts` ≈:2226).
  The one reader that needs the stamp to move is the aged door (30 min), which the dispatch busy check, fleet
  `hookState`/`dialogPending` and the mail gate all read. `aliveAt` serves it without moving the wait's start.
  The fresh read closes the answer-direction race between the prefilter read and the carry (a main-thread answer landing
  there was overwritten by a carried `waiting` decided from the old read). It does not close the other two (see Not done).
- **Not done:**
  - A separate wait-start field on `HookState` and the wire: a 13-file literal census rides on `HookState`, and
    `watch.ts` is claimed by another run. `aliveAt` stays on the raw read.
  - A change to `watch.ts`'s frozen clock (`watch.ts:331` is claimed and unchanged).
  - Drift in two words-only comments under claim 1197 (run 358), left for the coordinator to route: `CoordStore.restampAsk`'s
    docstring (`server/src/coord/store.ts:7046-7052`) and `server/src/watch.ts:7409-7413` still describe the
    SubagentStart/SubagentStop re-stamp as current. After D-4041 it happens only for a wait a subagent raised
    (`waitBy:"subagent"`) and for any other bump; the comment at `asks-mint.test.ts` and the `freshAskAt` docstring are
    scoped already.
  - An age bound on the carry (see D-4039's Cost if wrong).
  - A closure of the narrow window between the fresh read and the `mv`. It needs a lock or a compare-and-swap in a shell
    hook, and the file is last-writer-wins by design.
  - A closure of the erase direction: a main question landing after a subagent hook's prefilter read `working` is
    overwritten by that hook's `working` write, as at the base. The fresh read runs only when the prefilter read `waiting`;
    running it on every subagent tool event would cost a fork on each.
- **Pinned by:**
  - `server/test/session-hook-subagent-ask.test.ts` (28 cases, layout under D-4039, and two fractional-stamp cases added after the merge): the "stamp" cases, the defensive
    cuts of the fresh read (an `updatedAt` that is negative, non-numeric or printed by jq in exponent form keeps no stamp, a non-negative fractional one keeps its floor, and -0.5 is refused; the kept `event` is letters only;
    a corrupt state is never carried), and the "carry is decided from one fresh read" describe (a `jq` shim in the
    fixture's `bin/` rewrites the file after the prefilter read, as a main-thread answer would, and counts reads); and
    `server/test/hookstate.test.ts` (7 cases in the `aliveAt` describe).
  - `server/test/ask-instance-guard.test.ts` (6 cases), inverted to pin this fix (ruling 4414): a SubagentStop over a
    main-thread dialog keeps `updatedAt` and `event`, adds `aliveAt` and keeps the ask; the parent's CAS then succeeds
    across repeated stops, and the number is kept over a subagent tool event (the CAS itself is pinned across the stops
    only); a new main-thread question still moves the stamp and is refused
    `ask-moved`; and a wait a subagent raised (`waitBy:"subagent"`) still moves its stamp, with `waitBy` surviving the
    Stop. This supersedes the bump D-2403 describes, for a main-thread wait only; the `restampAsk` pair stays, because a
    subagent's own dialog and any other bump still need it.
    - S11 (leave `w_upd` unset in `_hook_keep_stamp`, so a carried write takes a moving stamp) → 4 failed in that file:
      SubagentStop leaves updatedAt and event as the wait set them; the parent is NOT refused; repeated SubagentStops
      never move the guarded number; a subagent TOOL event over the dialog keeps the number too. Out of tree, restored
      and `cmp`-checked.
  - `server/test/session-hook-merge-deny.test.ts`'s jq-program floor: 51 at this wave's tip, 52 since wave 4 (R51 (b)).
    The extractor's count at each ref: 52 at the base, 54 after D-4039 (two added), 51 after D-4041 (four removed, the
    shared fresh read added), 52 merged onto #392's skill-name read (D-4934). The `as $` bindings were 33 throughout.
  - Every S and N row of the list below was re-measured in fix round 2 at commit `df7fb0248` (the hook code of the tip), out of tree, one
    mutation at a time, each restored and `cmp`-checked, with identical counts and titles to the `ed7537045` measurement (S3, N2 and N6 quote one title as fix round 3 renamed it after both, R45 item 7: no count moved, and review 404 re-measured N2 red with the new title);
    the unmutated files pass 28 of 28 and 61 of 61. The A rows live in `hookstate.ts` and that round did not touch it:
    they stand as measured at `ed7537045`. N1 still reds 2 cases, and the
    `'waitingx'` iteration of the tool-event case really runs (fix round 2 removes the shim before each iteration's ask, so
    the prefilter sees `waiting`; review 402 F6):
  S1 (never keep the file's `updatedAt` and `event`, `w_upd` and `w_ev` left unset) → 4 failed (SubagentStart and SubagentStop over a main-thread wait keep the stamp and write aliveAt; a carried write keeps updatedAt and event and writes aliveAt; a subagent PreToolUse keeps the stamp and writes aliveAt too, and a second carry keeps the FIRST stamp; the kept event is cut to letters: a stored event with other characters is written without them);
  S2 (never write `aliveAt`) → 4 failed (SubagentStart and SubagentStop over a main-thread wait keep the stamp and write aliveAt; a carried write keeps updatedAt and event and writes aliveAt; a main-thread write after a carried one carries no aliveAt; a subagent PreToolUse keeps the stamp and writes aliveAt too, and a second carry keeps the FIRST stamp);
  S3 (a main-thread write also writes `aliveAt`, `--arg aliveAt "${w_alive:-$(_hook_epoch_ms)}"`) → 5 failed (a main answer landing after the prefilter read is not overwritten by a carried waiting; a main-thread write after a carried one carries no aliveAt; an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); control: SubagentStart over working and over a subagent-raised wait write no aliveAt; nor is it carried by a subagent tool event whose prefilter saw waiting: a corrupt state arriving after it writes working);
  S4 (drop `_hook_keep_stamp` from the SubagentStart/SubagentStop block) → 1 failed (SubagentStart and SubagentStop over a main-thread wait keep the stamp and write aliveAt);
  S5 (drop `_hook_keep_stamp` from the tool-event carry) → 4 failed (a carried write keeps updatedAt and event and writes aliveAt; a main-thread write after a carried one carries no aliveAt; a subagent PreToolUse keeps the stamp and writes aliveAt too, and a second carry keeps the FIRST stamp; the kept event is cut to letters: a stored event with other characters is written without them);
  S6 (decide the tool-event carry from `prev_state` again, not the fresh read) → 2 failed (a main answer landing after the prefilter read is not overwritten by a carried waiting; nor is it carried by a subagent tool event whose prefilter saw waiting: a corrupt state arriving after it writes working);
  S7 (SubagentStart/SubagentStop take `state` from `prev_state`, not the fresh read) → 1 failed (the same holds for a SubagentStop: its state comes from the fresh read, not from the prefilter);
  S8 (a second fresh read in the SubagentStart/SubagentStop block, the fork fold undone) → 1 failed (SubagentStart and SubagentStop read the hookstate file with two jq forks: the prefilter and the shared fresh read);
  S9 (SubagentStart/SubagentStop do not exit on an empty fresh state) → 2 failed (a file that is gone or unreadable at the fresh read leaves SubagentStop inert; a state that is not one of the hook's words is never carried: a SubagentStop leaves the file as it was);
  S10 (SubagentStart/SubagentStop write `ask` null instead of the file's) → 2 failed (SubagentStart and SubagentStop over a main-thread wait keep the stamp and write aliveAt; a main-thread wait survives a SubagentStop and a SubagentStart, and is not flipped to subagent-raised);
  N1 (put the letter cut back on the fresh read's `state`, instead of the exact match on the hook's three words) → 2 failed (a state that is not one of the hook's words is never carried: a SubagentStop leaves the file as it was; nor is it carried by a subagent tool event whose prefilter saw waiting: a corrupt state arriving after it writes working);
  N2 (drop the `^[0-9]+$` check on the kept `updatedAt`) → 1 failed (an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor));
  N4 (drop the `type == "number"` check on `updatedAt`) → survives (28 passed of 28), a named survivor, see below;
  N5 (drop the letter cut on `event`) → 1 failed (the kept event is cut to letters: a stored event with other characters is written without them);
  N6 (print the ask raw instead of `tojson`) → 6 failed (SubagentStart and SubagentStop over a main-thread wait keep the stamp and write aliveAt; a carried write keeps updatedAt and event and writes aliveAt; a main-thread write after a carried one carries no aliveAt; a subagent PreToolUse keeps the stamp and writes aliveAt too, and a second carry keeps the FIRST stamp; an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); the kept event is cut to letters: a stored event with other characters is written without them);
  A1 (the age cut ignores `aliveAt`, `now - raw.state.updatedAt`) → 2 failed (a wait stamped past 30 minutes ago is fresh through a recent aliveAt; the boundary is the same one: exactly 30 minutes from the later stamp is still fresh);
  A2 (a non-finite `aliveAt` is accepted, the `Number.isFinite` check dropped) → 1 failed (a malformed aliveAt is ignored: not malformed, not no-state by itself, and it revives nothing);
  A3 (a malformed `aliveAt` rejects the whole read as `malformed`) → 1 failed (a malformed aliveAt is ignored: not malformed, not no-state by itself, and it revives nothing);
  A4 (`Math.max` dropped: `aliveAt` alone sets the age) → 1 failed (the later of the two wins: an aliveAt OLDER than a fresh updatedAt does not age the file);
  A5 (the raw read drops `aliveAt`) → 3 failed (a wait stamped past 30 minutes ago is fresh through a recent aliveAt; the boundary is the same one: exactly 30 minutes from the later stamp is still fresh; the raw read reports a finite aliveAt beside the unchanged state, and HookState itself does not grow).
  - The two fractional-stamp cases were added after the merge (programme ledger R51, follow-up (a)); every row above was measured on the 28 cases before them. Measured at `a8e769f47`, out of tree, one mutation at a time, each restored and `cmp`-checked:
  FS1 (`floor | tostring` → `tostring` on the fresh read's `updatedAt` line) → 1 failed (a non-negative fractional updatedAt is kept as its floor and writes aliveAt (12.7 is kept as 12, 0.5 as 0));
  FS2 (`floor` → `ceil` on that line) → 1 failed (the same case);
  FS3 (`^[0-9]+$` → `^-?[0-9]+$` in `_hook_keep_stamp`) → 2 failed (an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); a negative fractional updatedAt is refused: -0.5 floors to -1, so the carry keeps no stamp, takes the current event and writes no aliveAt).
  - **N3 is gone and N4 is a named survivor.** The first round's `. >= 0` on the fresh read's `updatedAt` was dead code
    (it survived 28 of 28): `_hook_keep_stamp`'s `^[0-9]+$` is the rule, since a negative prints with its `-` and fails
    it, and N2 pins that. It was removed in fix round 2 (review 402 F7, check 7). N4 (`type == "number"`) stays, and is
    POSITIONAL, not a guard: without it a string, array, object, null or boolean `updatedAt` makes `floor` abort the jq
    program, which blanks every line printed after it. Today that is only `event`, and `event` is unused whenever
    `fr_upd` is empty, because `_hook_keep_stamp` gates on `fr_upd`. If a later edit printed another field after `updatedAt`, the type check would become load-bearing. The hook's
    comment names it so.
- **Measured, forced interleaving** (a `jq` shim on PATH in a fixture HOME; a main-thread write rewrites the file after
  the chosen read; subagent PostToolUse; variants 1 and 2 over a main-thread question, the erase row over a `working` file):

  | variant | at the first round's tip | now |
  |---|---|---|
  | 1: the answer lands after the prefilter read | `waiting`, ask erased (the carry re-read a null ask) | `working`, main's answer kept |
  | 1, SubagentStop | `waiting`, ask erased | `working` |
  | 2: the answer lands after the fresh carry read, before the `mv` | `waiting`, ask kept (answer overwritten) | `waiting`, ask kept (answer overwritten): the residual |
  | 2, SubagentStop | `waiting` | `waiting`: the residual |
  | erase: a main question lands after the prefilter read of a `working` file | `working`, ask null | `working`, ask null: untouched (not closed) |

- **Forks per event class** (every `jq` invocation, a logging shim in a fixture HOME; the base `da1373cf6`, the first
  round's tip `efb4842b7`, now `ed7537045`):

  | event class | base | tip | now |
  |---|---|---|---|
  | main PostToolUse over working / over waiting | 3 / 4 | 3 / 4 | 3 / 4 |
  | main PreToolUse over working | 4 | 4 | 4 |
  | main PermissionRequest (ask), Stop | 5, 5 | 5, 5 | 5, 5 |
  | subagent PostToolUse over working / over done | 3 / 3 | 3 / 3 | 3 / 3 |
  | subagent PostToolUse over a main-thread wait | 3 | 4 | 4 |
  | subagent PreToolUse (Bash) over a main-thread wait | 5 | 6 | 6 |
  | subagent PostToolUse over a subagent's own wait | 3 | 4 | 4 |
  | subagent PermissionRequest | 5 | 5 | 5 |
  | SubagentStart over working / SubagentStop over waiting | 7 / 7 | 8 / 8 | 6 / 6 |

  A subagent tool event over any `waiting` pays the one fresh read, as the plan's hot-path constraint says; main-thread
  events pay nothing new, and the SubagentStart/SubagentStop block ends one fork under the base.
- **Cost if wrong:**
  - Update skew: an older server running this hook ages a carried wait at its start + 30 min, because an old
    `foldHookStateRead` ages on `updatedAt` alone. The reader must not trail the hook, and the DEFAULT moves are
    fleet-first and open the window: `ccrc rollout`, the PWA's one-tap apply and the automatic moves. So every ordinary
    move opens it, bounded by the update lag, and unbounded if the server's move halts (a rollout stop, an exit-4 restore,
    or a failed apply awaiting ack). `--server-first` closes it for a hand rollout.
  - What the window does: a carried wait reads no-state at its start + 30 min for the dispatch busy check (it could
    proceed), fleet `hookState`/`dialogPending` and the mail gate.
  - After the aged read expires, the frozen arm's clock reads the wait start (`watch.ts:331` is claimed and unchanged),
    so frozen can fire up to 30 min earlier. The delegates arm shares the frozen arm's 30-minute window.
  - A carried question correlates with hold 2a only while `live.since` stays within `ASK_DIALOG_SLACK_MS` (60 s) of the
    wait start, the same rule a subagent-free question has; the ask row's `askRowOpen` holds it after the mint. (The
    first round's "always correlates" is gone.)
  - The narrow window between the fresh read and the `mv` stays (above).
