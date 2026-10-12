# Stall watch settings wave 3: a subagent never erases the main thread's question, and a dialog's clock ignores mail it cannot receive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:subagent-driven-development` with `superpowers:test-driven-development` for every test step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch-settings`, **wave 3 of 3** (ledger `docs/superpowers/programs/stall-watch-settings.md`,
R38). The operator kept both fixes of finding 4063 in this programme on 2026-10-12. Deploy class: **both** — the hook
reaches the fleet box through `ccrc update`'s install spine, `stall.ts` runs on the server; the updater moves the fleet
box first, which is the order this wave needs. One PR from a fresh child workspace. This plan file rides in that PR: its
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
  on a subagent tool event that finds `waiting`; every other event pays a string compare.
- The README citation instrument agrees with `main`'s own count, measured on this wave's base before any edit:
  `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.
  The highest line any cited corpus names in `ccd/session-hook.sh` is below :3754, so the edit should move nothing;
  measure it, do not assume it.
- Mutation-table discipline: each guard ships with a row measured red when it is removed, before and after.
- Deviation numbers: this plan defines **D-4039** and **D-4040**. The block's two remaining reserve numbers are the
  coordinator's to assign to a fix round's departure, by ruling; until then a new departure is named by slug. Never
  call the allocator, never write another number, a range or `D-TBD`.
- Suites in the foreground, one file per command, timeout at least 600000 ms. macOS CI legs gate nothing.
- Commit on the workspace's own branch; never a separate feature branch.

## Review Focus

1. **A subagent's own dialog while the main thread waits.** A background subagent's PermissionRequest still writes its
   `{approval}` ask over a main-thread question (the PermissionRequest arm sets `waiting` for any sender). Out of scope
   here: it is a real dialog on the pane, and under `bypassPermissions` it never fires. The wave-done names it.
2. **`updatedAt` and `event` still move on a carried `waiting`.** The `delegates` hold and the frozen arm read
   subagent activity from them (spec §5's bounded exception), so the carry keeps today's stamp and event. The ask row's
   `askAt` provenance can read a later time; `detectDialogs` mints once per pane dialog id, so no second row is minted.
   Task 1 pins that the stamp still moves.
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
held in reserve, and assigned to this wave by the coordinator's ruling R38. Two numbers of the block remain in reserve.

### D-4039 `subagent-tool-event-keeps-the-waiting-ask`

- **Departs from:** the hook's own rule that a transition to `working` clears the ask (`ccd/session-hook.sh`, the line
  after the SubagentStart/SubagentStop block), as applied to a subagent's tool events — the overwrite spec §3.3
  measured and finding 4063 traced to an erased question (ledger R32).
- **What W3 does:** a PreToolUse or PostToolUse carrying `agent_id`, arriving while the hookstate reads `waiting` and
  that wait does not carry `waitBy: "subagent"` (it was raised by the main thread), keeps `waiting`, the ask and
  `interrupted`; the stamp and the event move as for any event. A wait a subagent raised itself is not carried.
- **Why:** the server mints an ask row only on the first pane tick that sees the dialog (`detectDialogs`), and the
  stall watch's hold 2a reads the hookstate ask. An erased ask leaves the question invisible to both, and to the mail
  gate's sender, for as long as the dialog stands (3 h measured).
- **Not done:** carrying every state. Background work after the main Stop keeps writing `working`, which the card,
  the dispatch busy check and the operator's reading of a session rely on; the operator has not ruled that away.
- **Pinned by:** `server/test/session-hook-subagent-ask.test.ts` (14 cases). Every row below was re-measured at test
  commit `baa51395e`, out of tree, one mutation at a time, each restored and `cmp`-checked; the unmutated hook passes 14 of 14:
  M1 (delete the carry block) → 8 failed (a subagent PreToolUse after a PermissionRequest question leaves waiting and the questions; a subagent PostToolUse does too, and so do many in a row; the PreToolUse question arm is kept the same way; an approval dialog is kept the same way; the stamp and the event still move, for the delegates hold and the frozen arm; a main-thread wait survives a SubagentStop and a SubagentStart, and is not flipped to subagent-raised; a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned; the interrupted flag is carried with the wait);
  M2 (drop `"$prev_state" == waiting &&`) → 1 failed (scope: a subagent tool event over done still writes working, as before);
  M3 (drop `-n "$paid" &&` from the carry condition) → 1 failed (control: the main thread answering (its own PostToolUse) ends the wait and clears the ask);
  M7 (drop the event-type conjunct) → 1 failed (Review Focus 1 scope pin: a subagent PermissionRequest over a main-thread question writes its own approval);
  M8 (drop the `interrupted` carry in the block) → 1 failed (the interrupted flag is carried with the wait);
  M9 (drop the provenance condition, `w_by != subagent`) → 2 failed (a subagent's own approved dialog ends at its next tool event (working, no ask); the same holds after a Stop, and across a SubagentStop that carries the provenance);
  M10 (stop preserving `waitBy` in the SubagentStart/SubagentStop block) → 1 failed (the same holds after a Stop, and across a SubagentStop that carries the provenance);
  M11 (never record `waitBy` on a fresh subagent wait) → 3 failed (a subagent's own approved dialog ends at its next tool event (working, no ask); the same holds after a Stop, and across a SubagentStop that carries the provenance; Review Focus 1 scope pin: a subagent PermissionRequest over a main-thread question writes its own approval);
  M12 (delete the `waitby=""` reset in the carry) → 1 failed (a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned);
  M13 (keep the subagent's own question instead of the main thread's, `ask_json` not restored when the tool is AskUserQuestion) → 1 failed (a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned).
- **Departure `carry-only-a-main-thread-wait` (task review, Important 1):** the carry now applies only to a wait the
  main thread raised. The hook records an additive hookstate key `waitBy: "subagent"` when a subagent's own event freshly
  sets `waiting`, preserves it across the SubagentStart/SubagentStop carry, and the D-4039 block skips a stored
  subagent-raised wait, so a subagent's approved dialog ends at its next tool event as it did before. It took no number.
- **Cost if wrong:** a stale `waiting` survives background work after a dialog was dismissed without a main-thread
  event; the next main-thread event clears it, as it would without subagents. A residual race remains: a subagent hook
  run that reads `prev_state` before the main thread's PermissionRequest renames its file, and renames after it, still
  erases the ask (the window is one hook run; the file is last-writer-wins by design).

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
