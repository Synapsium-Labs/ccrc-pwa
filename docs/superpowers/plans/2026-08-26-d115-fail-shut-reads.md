# D-115's three consumers learn the distinction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three consumers D-115 named stop reading "I could not measure this" as
"I measured, and the answer is benign" — starting with the one that ends in a keystroke:
`dispatch.ts`'s busy gate, which today `/clear`s a session whose hookstate it simply
could not read.

**Architecture:** `readFileMeasured`/`MeasuredRead` (shipped by the fleetio-measured-read
wave, `server/src/io.ts:22-44`) already draws the absent-vs-unreadable line at the fs
seam. D-115's finding was that the line dies one level up, because each reader's own
return type has no arm to carry it. So each of the three readers gains a `*Measured`
sibling that carries the distinction and a derived legacy form that folds it — the exact
shape `readFile` already derives from `readFileMeasured` — and only the consumers that
genuinely branch differently are migrated. Consumers that are indifferent keep the folded
form: a distinction with no consumer is not a fix, it is a wider type.

**Tech Stack:** TypeScript ESM (server), vitest.

**Spec:** No standalone spec. **D-115**
(`docs/superpowers/plans/2026-08-20-fleetio-measured-read.md:349`) is the decision record;
this plan is its named remedy, and it CORRECTS that entry where measurement disagrees with
it (see "What re-measuring D-115 found", below).

## Global Constraints

- **Rings.** `hookstate.ts`, `livestate.ts`, `tasks/read.ts` are L3 adapters. The
  highest-yield rule applies directly: **an adapter may not narrow a distinction it
  received.** That is the whole defect.
- **No overloaded null at a seam** — but its converse binds too: two conditions **no**
  caller handles differently must NOT be split into separate arms. `limits.ts:126` and
  `commands.ts:73` are the tree's own precedent for leaving an indifferent fold alone.
- **Wire discipline: additive-only.** `FLEET_PROTO` stays 1. A new refusal code is an
  additive vocabulary entry; a newer server must tolerate an older peer never sending it.
- **Mutation-table discipline.** Every guard ships with a test measured RED when the guard
  is deleted — before/after, recorded in the task, not asserted in a comment.
- **AGENT-FIRST if the skill corpora change.** Task 2 touches
  `ccd/coordinator-skill/` if a refusal code reaches its prose. Any such change ships to
  the fleet host before the server.
- **Deviation numbers come from `POST /api/ledger/deviations`.** Never a hand sweep, never
  a number read off a plan.

## What re-measuring D-115 found (read this before Task 3)

D-115 names three consumers. Two of the three survive re-measurement as stated. The
live-state clause does not, and a worker who implements it as written will make the fleet
LESS safe:

1. **`dispatch.ts`'s `worker-busy` gate — CONFIRMED, and it is the only one that ends in a
   keystroke.** `readHookState` folds "no hookstate file" (ordinary for a fresh workspace)
   into the same `null` as "the file is there and could not be read". The gate treats
   `null` as not-busy and proceeds to `sendPrompt(id, '/clear')`. A session mid-turn whose
   hookstate happened to be unreadable is cleared. Task 1–2.
2. **`tasks/read.ts:61` — CONFIRMED.** `parseTask(null)` returns null and the task is
   pushed nowhere, so an unreadable task file leaves BOTH numerator and denominator, which
   over-reports progress against the rule stated eight lines above it ("An unknown status
   counts as outstanding rather than done — over-reporting progress is the one wrong answer
   here"). Task 4.
3. **`fleet.ts:221`/`sessionws.ts:498` — PARTLY WRONG AS WRITTEN.** Two corrections:
   - The **actionable** live-state consumers already fail shut, and did before this plan.
     Mail delivery requires an affirmative idle (`watch.ts:2324`,
     `if (!live || liveSessionStatus(live.status) !== 'idle') continue`), and archive
     states the rule outright (`watch.ts:2596-2599`, "MUST NOT collapse `unknown` to idle
     … Archive needs an AFFIRMATIVE idle"). Neither can be reached by an unreadable file
     answering `idle`.
   - At `fleet.ts:138` (`liveStatus`), `'idle'` is the **protective** answer, not the
     dangerous one: its sole consumer is the interrupt route
     (`server.ts:1485`, `… === 'busy'`), so `idle` REFUSES the interrupt. The function's
     own comment already argues this for the unmeasured-wrapper case ("fails TOWARD
     refusing an interrupt rather than granting one on a guess"). "Fail toward busy" here
     would GRANT interrupts on a read that measured nothing — the inversion of D-115's
     own intent.

   What is left of clause 3 is real but display-only: `assembleFleet` and the chat header
   paint a card `idle · 1m ago` for a session whose live file could not be read. Task 3
   fixes exactly that, and leaves `liveStatus` alone **deliberately**, with a pin.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `server/src/hookstate.ts` | Gains `readHookStateMeasured` (3-arm result); `readHookState` derives from it and keeps its signature for the four indifferent callers. |
| `server/src/coord/dispatch.ts` | Busy gate refuses on an unmeasurable hookstate instead of proceeding to `/clear`. |
| `shared/api.ts` | One additive refusal code. |
| `server/src/livestate.ts` | Gains `readLiveStateMeasured`; `readLiveState` derives. |
| `server/src/fleet.ts` | `assembleFleet` paints an unmeasured live file as `busy`. `liveStatus` UNCHANGED, and newly pinned as unchanged. |
| `server/src/sessionws.ts` | Chat header matches `assembleFleet`. |
| `server/src/tasks/read.ts` | `readTasks` carries an `unmeasured` count; `taskProgress` puts it in the denominator. |
| Tests | One suite per arm, each with its measured red recorded. |

---

### Task 1: `readHookStateMeasured` — the reader learns the difference

**Files:**
- Modify: `server/src/hookstate.ts`
- Test: `server/test/hookstate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HookStateRead =
    | { ok: true; state: HookState }
    | { ok: false; reason: 'no-state' }     // absent, OR present and says nothing about THIS session
    | { ok: false; reason: 'unmeasured' };  // the file exists and could not be read
  export async function readHookStateMeasured(
    io: FleetIO, registryDir: string, id: string, currentUuid: string | null, now: number,
  ): Promise<HookStateRead>;
  export async function readHookState(…same args…): Promise<HookState | null>; // unchanged signature
  ```
- Consumes: `io.readFileMeasured` (`server/src/io.ts:44`), `ReadFailure`.

**Why only three arms, and why the gates fold into `no-state`.** `readHookState` returns
null for nine distinct conditions. Eight of them are MEASUREMENTS — oversize, malformed,
version skew, unknown state word, stale, `currentUuid === null`, sessionId mismatch,
absent — and every one means the same actionable thing: *this file does not describe the
current session's turn.* One is not a measurement at all: the read failed. Splitting the
eight would add arms no consumer branches on, which the Global Constraints forbid as
loudly as the fold this task removes.

- [ ] **Step 1: Write the failing test**

Add to `server/test/hookstate.test.ts`:

```ts
import { readHookStateMeasured } from '../src/hookstate.js';

describe('readHookStateMeasured — the distinction readHookState folds', () => {
  it('an ABSENT hookstate is no-state, not unmeasured', async () => {
    const r = await readHookStateMeasured(localIO, reg, ID, UUID, NOW);
    expect(r).toEqual({ ok: false, reason: 'no-state' });
  });

  it('an UNREADABLE hookstate is unmeasured — the arm the null had nowhere to put', async () => {
    writeFileSync(path.join(reg, `${ID}.hookstate.json`),
      JSON.stringify({ v: 1, state: 'working', sessionId: UUID, updatedAt: NOW }));
    chmodSync(path.join(reg, `${ID}.hookstate.json`), 0o000);
    const r = await readHookStateMeasured(localIO, reg, ID, UUID, NOW);
    expect(r).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a STALE hookstate is no-state — a measurement, not a failure to measure', async () => {
    writeFileSync(path.join(reg, `${ID}.hookstate.json`),
      JSON.stringify({ v: 1, state: 'working', sessionId: UUID, updatedAt: NOW - HOOKSTATE_FRESH_MS - 1 }));
    const r = await readHookStateMeasured(localIO, reg, ID, UUID, NOW);
    expect(r).toEqual({ ok: false, reason: 'no-state' });
  });

  it('readHookState still folds all three, so its four callers are untouched', async () => {
    // Same three fixtures, through the legacy form: null every time.
  });
});
```

**The chmod case MUST carry `it.skipIf(process.getuid?.() === 0)`** — `chmod 000` does not
deny root, so an unguarded case silently asserts the wrong thing under a root runner. This
is D-116, recorded in the same ledger as D-115 and naming this exact hazard.

- [ ] **Step 2: Run it and watch it fail**

`cd server && ./node_modules/.bin/vitest run test/hookstate.test.ts`
Expected: FAIL — `readHookStateMeasured` is not exported.

- [ ] **Step 3: Implement**

Split `readHookState`'s body: the `io.readFile` call becomes `io.readFileMeasured`, whose
`reason: 'unreadable'` returns `{ ok: false, reason: 'unmeasured' }` and whose
`reason: 'absent'` returns `{ ok: false, reason: 'no-state' }`. Every existing `return
null` below it becomes `return { ok: false, reason: 'no-state' }`. Then:

```ts
export async function readHookState(io, registryDir, id, currentUuid, now) {
  const r = await readHookStateMeasured(io, registryDir, id, currentUuid, now);
  return r.ok ? r.state : null;
}
```

Update the docstring: it currently promises "null when the file is missing, oversized, …",
which stays true of the derived form. Say where the distinction now lives, the same way
`io.ts:45` does on `readFile`.

- [ ] **Step 4: Run the suite green, and the four legacy callers with it**

`./node_modules/.bin/vitest run test/hookstate.test.ts test/watch*.test.ts test/sessionws.test.ts`

- [ ] **Step 5: Measure the red**

Delete the `'unmeasured'` arm (make the unreadable branch return `no-state`) and re-run.
Record the failing count in the Deviations section if it is anything but the one case.

- [ ] **Step 6: Commit** — `feat(hookstate): the read that could not happen stops looking like a measurement`

---

### Task 2: the busy gate stops clearing what it could not measure

**Files:**
- Modify: `server/src/coord/dispatch.ts` (the gate at `:449-461`)
- Modify: `shared/api.ts` (one additive refusal code)
- Modify: `ccd/coordinator-skill/SKILL.md` + `ccd/coordinator-skill/references/wave-lifecycle.md` **only if** the code reaches their refusal lists
- Test: `server/test/coord-dispatch*.test.ts` (whichever suite owns the busy gate)

**Interfaces:**
- Consumes: `readHookStateMeasured` (Task 1).
- Produces: the refusal code, spelled once in `shared/api.ts` and derived everywhere else.

**The code.** Do NOT reuse `worker-busy`: that asserts a measurement ("this worker is
mid-turn") the server did not make, and a coordinator reading it would wait for a turn
that may not exist. Do NOT reuse `registry-unmeasurable` either — its documented recovery
rule is specific and dangerous to generalise ("a retry after `registry-unmeasurable` can
ORPHAN a workspace `ccd ws-add` already spawned", wave-lifecycle §2), and this refusal
happens AFTER the workspace was resumed rather than spawned, so a retry is a different
act. Add `hookstate-unmeasurable`, surfaced exactly the way `registry-unmeasurable`
already is (find its mapping in `server/src/routes.ts` and follow it; do not invent a
second shape).

**Check before you write prose:** `server/test/coordinator-skill.test.ts` pins ten clauses
VERBATIM. Adding a code to a LIST is not editing a clause — but read the test first and
report if it disagrees. **Do not soften a clause to make room.**

- [ ] **Step 1: Write the failing test** — the gate refuses, and does NOT send `/clear`

```ts
it('an unmeasurable hookstate refuses the dispatch instead of clearing a maybe-mid-turn session', async () => {
  // seed a run at wave 2 with a resumable session, then make ONLY the
  // hookstate file unreadable (chmod 000, skipIf root).
  const res = await dispatchWave(deps, { runId, brief: 'x' });
  expect(res).toMatchObject({ ok: false, code: 'hookstate-unmeasurable' });
  // The point of the guard, not just its return value:
  expect(sentPrompts).toEqual([]);            // no '/clear' left the server
  expect(coord.getRun(runId).clearedAt).toBeNull();
});

it('an ABSENT hookstate still proceeds — the ordinary shape for a fresh workspace', async () => {
  const res = await dispatchWave(deps, { runId, brief: 'x' });
  expect(res.ok).toBe(true);
  expect(sentPrompts).toEqual(['/clear']);
});
```

The second case is not decoration: it is the positive control that separates this fix from
"the gate now refuses everything", and it pins the behaviour Task 1's `no-state` arm
exists to preserve.

- [ ] **Step 2: Run it — expect FAIL** (today the unreadable case proceeds and clears).
- [ ] **Step 3: Implement** — swap the gate to `readHookStateMeasured`:

```ts
const hs = recordIdentity
  ? await readHookStateMeasured(deps.io, deps.cfg.registryDir, sessionId, recordIdentity.uuid, Date.now())
  : null;
if (hs !== null && !hs.ok && hs.reason === 'unmeasured') {
  return { ok: false, kind: 'refused', code: 'hookstate-unmeasurable' };
}
if (hs !== null && hs.ok && hs.state.state !== 'done') {
  return { ok: false, kind: 'refused', code: 'worker-busy' };
}
```

Then REWRITE the comment at `:449-461`. Its last sentence currently reads "An
UNREADABLE/absent hookstate … is not, by itself, proof of busy-ness and is left to proceed,
same as it always has." That sentence is the defect, stated as intent. Replace it with the
two-case rule and keep the rest — the `sendPrompt`-can-only-mean-"the text left the box"
argument is still exactly right and is why this gate exists.

- [ ] **Step 4: Run green** — the dispatch suites and `run-routes.test.ts`.
- [ ] **Step 5: Measure the red** — revert the gate to `readHookState`, count the failures,
      record the number. Then restore.
- [ ] **Step 6: Commit** — `fix(dispatch): a hookstate that could not be read is not a worker at rest`

---

### Task 3: the fleet card stops painting a guess as rest

**Files:**
- Modify: `server/src/livestate.ts`, `server/src/fleet.ts` (`assembleFleet` only),
  `server/src/sessionws.ts:504`
- Test: `server/test/livestate.test.ts`, `server/test/fleet.test.ts`

**Read "What re-measuring D-115 found" first.** `liveStatus` (`fleet.ts:111-139`) is NOT
in scope and must not change: `'idle'` there refuses an interrupt, which is the safe
direction, and its three existing pins in `fleet.test.ts:119-163` must stay green
**without being edited**. If one needs editing to pass, STOP and report — that is the
signal that this task has reached the function it was told to leave alone.

**Interfaces:**
- Produces: `readLiveStateMeasured(io, configDir, pid): Promise<{ ok: true; state: LiveState } | { ok: false; reason: 'no-state' | 'unmeasured' }>`, with
  `readLiveState` derived from it, signature unchanged.

- [ ] **Step 1: Write the failing tests** — the reader, then the surface

```ts
it('an unreadable live status file is unmeasured, not absent', async () => { … });

it('assembleFleet paints an unreadable live file busy, not idle', async () => {
  // chmod 000 the sessions/<pid>.json of one alive session (skipIf root)
  const fleet = await assembleFleet(…);
  expect(fleet.find((s) => s.id === ID)!.status).toBe('busy');
});

it('… and an ABSENT live file still paints idle — the ordinary pre-publish shape', async () => {
  expect(fleet.find((s) => s.id === ID)!.status).toBe('idle');
});

it('liveStatus is NOT changed by this: an unreadable live file still answers idle, so the interrupt route still refuses', async () => {
  // The deliberate asymmetry. Named here so a later reader finds the reason
  // beside the pin rather than in a plan.
  expect(await liveStatus(unreadableLive, cfg, tmux, ID)).toBe('idle');
});
```

- [ ] **Step 2: Run — expect the two `assembleFleet` cases to fail** (both answer idle today).
- [ ] **Step 3: Implement.** In `assembleFleet`'s block at `fleet.ts:222-243`, take the
      measured read; on `unmeasured` set `status = 'busy'` and leave `name`,
      `statusUpdatedAt`, `version`, `liveWaiting`, `liveWaitingFor` at their defaults —
      an unmeasured read has no fields to report, and inventing them is the same defect one
      field over. Mirror it in `sessionws.ts:504`. **Do not touch `liveStatus`.**
- [ ] **Step 4: Run green** — `fleet.test.ts`, `livestate.test.ts`, `sessionws.test.ts`,
      `pr-sweep.test.ts` (`:249` comments on `liveStatus`'s unreadable answer — if it goes
      red, the task reached out of scope).
- [ ] **Step 5: Measure the red**, restore, record.
- [ ] **Step 6: Commit** — `fix(fleet): an unreadable status file is not a session at rest`

---

### Task 4: progress counts the task it could not read

**Files:**
- Modify: `server/src/tasks/read.ts`; call sites `server/src/sessionws.ts`,
  `server/src/watch.ts`, `server/src/server.ts`
- Test: `server/test/tasks*.test.ts`

**Interfaces:**
- Produces: `readTasks(io, configDir, uuid): Promise<{ tasks: TaskItem[]; unmeasured: number }>`
  and `taskProgress(read: { tasks: TaskItem[]; unmeasured: number }): TaskProgress | null`.
- The return type CHANGES. That is deliberate and is the point of D-115's "needs its OWN
  return type widened": a compile error at every call site is the mechanism that stops one
  being missed. Do not add an overload to soften it.

**Why a count and not a placeholder task.** Synthesising a `TaskItem` with a fabricated
subject would put invented text on a screen. The denominator is what was wrong; only the
denominator gets fixed.

- [ ] **Step 1: Write the failing test**

```ts
it('an unreadable task file stays in the denominator', async () => {
  // three task files; chmod 000 the third (skipIf root); two are 'completed'
  const read = await readTasks(localIO, cfgDir, UUID);
  expect(read.unmeasured).toBe(1);
  expect(taskProgress(read)).toMatchObject({ done: 2, total: 3 });   // NOT 2/2
});

it('an ABSENT task directory is still an empty list, not a progress row', async () => {
  expect(taskProgress(await readTasks(localIO, cfgDir, 'no-such-uuid'))).toBeNull();
});
```

Match `TaskProgress`'s real field names — read the type before writing the assertion.

- [ ] **Step 2: Run — expect FAIL** (`2/2` today, and `unmeasured` does not exist).
- [ ] **Step 3: Implement** — `readFileMeasured` per file; `unreadable` increments the
      count, `absent` (a raced deletion) does not; `taskProgress` adds `unmeasured` to the
      total only. Update the three call sites.
- [ ] **Step 4: Run green** — the task suites plus `sessionws`, `watch`, `server`.
- [ ] **Step 5: Measure the red**, restore, record.
- [ ] **Step 6: Commit** — `fix(tasks): a task that could not be read is not a task that is done`

---

### Task 5: full suites, ledger, PR

- [ ] **Step 1:** `cd server && npm run test` and `cd agent && npm run test` and
      `cd pwa && npm run test`, FOREGROUND, timeout ≥600000. Re-run any of the five known
      load flakes IN ISOLATION before calling it a break.
- [ ] **Step 2:** Mint every deviation number from `POST /api/ledger/deviations`. Never a
      hand sweep.
- [ ] **Step 3:** Write the `## Deviations found` section below — including the correction
      to D-115's own clause 3, which is the finding this plan was built on.
- [ ] **Step 4:** Token-scan, push, open the PR. Note in the body whether the skill corpora
      changed: if they did, **the deploy is AGENT-FIRST.**

## Deviations found

_(allocated from `POST /api/ledger/deviations` during execution — never hand-swept)_
