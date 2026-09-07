# Swap verb timeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the agent from SIGTERM-ing a `ccd swap` after it has stopped the unit and killed the
pane but before it has flipped `wrapper`, which leaves a dead session on the old account with no
refusal marker and no journal row.

**Architecture:** One row in `CCD_VERB_TIMEOUT_MS` raising `swap` from the flat 90 s default to
300 000 ms — the agent's own `MAX_EXEC_TIMEOUT_MS` ceiling — plus a cross-language budget test in the
house style of `pr-timeout-budget.test.ts`, which reads both numbers from their real sources rather
than restating them.

**Tech Stack:** TypeScript, vitest. Server package only.

**Spec:** `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md` §E

## Global Constraints

- Node floor `>=22.13.0`, identical across all three engines. Never lower engines to make a test green.
- Run suites in the FOREGROUND from inside the package, timeout ≥600000ms:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. **Never bare `npx vitest`.**
- Wire discipline: additive only. This plan adds no wire field and does not touch `FLEET_PROTO`.
- Mutation-table discipline: the guard ships WITH a test measured RED when the guard is deleted.
- **Server lane only.** This plan touches no `ccd/`, no `session-hook.sh`, no `ccd/coordinator-skill/`,
  so the AGENT-FIRST rule does not apply and it deploys with `bash deploy/deploy.sh`.
- No account name appears in any shipped source file.

---

## Background the implementer needs

`cmd_swap` in `ccd/ccd` performs this sequence:

| line | action |
|---|---|
| `13722` | `_svc_stop "claude-session@$id"` — stops the supervisor unit |
| `13723` | `tmux kill-session` — destroys the pane |
| `13770` | `_swap_carry_jsonl` — copies the transcript between config dirs |
| `13801` | `_swap_carry_sidecars` |
| `13817` | `_reg_set "$id" wrapper "$target"` — **the flip** |
| `13818` | `_reg_set "$id" lastswap` |
| `13825` | `rm -f "$REG/$id.swapblocked"` |

**Lines 13723 → 13817 are the unprotected window.** The unit is stopped and the pane is gone, but the
registry still names the old account. A process killed inside that window leaves: a session that is
not running, `wrapper` unchanged, no `swapblocked` stamp, no `lastswap`, no success line in
`swap.log`. Nothing in the tree can tell that state from "a session that was never swapped".

What kills it is one process and one box away: `timeoutMsFor` (`server/src/remote/runner.ts:96`)
looks the verb up in `CCD_VERB_TIMEOUT_MS`; `swap` has no key, so it inherits the flat
`CCD_TIMEOUT_MS` (90 s). The agent applies that as `execFile(..., { timeout })`
(`agent/src/server.ts:255`) and clamps it at `MAX_EXEC_TIMEOUT_MS = 300_000` (`agent/src/server.ts:72`,
clamp at `:221`).

The transcript carry has **no bash-side bound below the agent's ceiling** — `SWAP_BEAT_MAX` bounds only
the heartbeat re-stamping (240 beats × 30 s = 2 h), not the copy. So 300 000 narrows the window to the
agent's maximum but does not close it; that residue is stated in the code comment, not hidden.

**Refuted premise, recorded so it is not reintroduced:** an earlier account of this item claimed a
retry loop manufactures concurrent swaps. Nothing in the PWA (`SwapSheet.tsx`), the server
(`runCcdOr502`) or the agent client retries. The defect is the single-shot kill, not a retry.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/remote/runner.ts` (modify) | Add the `swap` row to `CCD_VERB_TIMEOUT_MS` with its argument |
| `server/test/swap-timeout-budget.test.ts` (create) | Pin the row against the agent's ceiling, read from both real sources |

Why a new test file rather than extending `pr-timeout-budget.test.ts`: that file's subject is the
`pr-state` budget and its whole docstring argues that one relationship. A second, unrelated budget
inside it would make its title a lie.

**Checked:** `single-definition.test.ts` scans for named vocabularies (`UNCHECKED_PR`, the reason
vocabulary, auth verdicts, the ccd script path, `KeyedQueue`, `sessionLabel`, Build 7 nouns). A local
`verbTimeoutMs` helper is not one of them, so duplicating that shape in a new file is safe. This test
does **not** spell the ccd script path, which is the one scan that would otherwise apply.

---

### Task 1: Pin the swap budget against the agent's ceiling

**Files:**
- Create: `server/test/swap-timeout-budget.test.ts`
- Modify: `server/src/remote/runner.ts` (the `CCD_VERB_TIMEOUT_MS` object literal, after the
  `enable: 300_000,` entry)

**Interfaces:**
- Consumes: nothing from earlier tasks — this plan has one task.
- Produces: `CCD_VERB_TIMEOUT_MS['swap'] === 300_000`, resolved by the existing
  `timeoutMsFor(cmd, args)` with no signature change.

- [ ] **Step 1: Write the failing test**

Create `server/test/swap-timeout-budget.test.ts`:

```typescript
/**
 * The `swap` time budget, pinned across the two files that own its halves.
 *
 * `cmd_swap` stops the supervisor unit and kills the tmux pane BEFORE it flips
 * the registry's `wrapper` field. Between those two points the session is not
 * running and the registry still names the old account, and nothing in the tree
 * can tell that state from "never swapped": no `swapblocked`, no `lastswap`, no
 * success line in `swap.log`.
 *
 * What kills the verb inside that window lives in TypeScript, one process and
 * one box away — `CCD_VERB_TIMEOUT_MS['swap']` applied by `timeoutMsFor` — and
 * what CAPS that number lives in a third file, the agent's own
 * `MAX_EXEC_TIMEOUT_MS`. Neither file can import the other's constant, so this
 * reads both from their real sources and asserts the relationship.
 *
 * It is deliberately an EQUALITY against the agent ceiling rather than a bare
 * literal: the carry has no bash-side bound below that ceiling, so the correct
 * budget is "as much as the agent will ever allow", and if the ceiling moves
 * this row should move with it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

/** `CCD_VERB_TIMEOUT_MS['<verb>']` in ms, read from the TS source. Keys are
 *  written unquoted when the verb is a valid identifier (`ensure`, `start`,
 *  `enable`) and quoted when it is not (`'ws-add'`), so accept both. */
function verbTimeoutMs(verb: string): number | null {
  const src = readFileSync(path.join(ROOT, 'server', 'src', 'remote', 'runner.ts'), 'utf8');
  const m = new RegExp(`^\\s*'?${verb}'?:\\s*([\\d_]+),`, 'm').exec(src);
  return m ? Number(m[1].replace(/_/g, '')) : null;
}

/** The agent's hard clamp on any exec timeout, read from its real source. */
function agentCeilingMs(): number {
  const src = readFileSync(path.join(ROOT, 'agent', 'src', 'server.ts'), 'utf8');
  const m = /^const MAX_EXEC_TIMEOUT_MS = ([\d_]+);/m.exec(src);
  expect(m, 'agent/src/server.ts no longer defines MAX_EXEC_TIMEOUT_MS as a bare literal — '
    + 'this gate went blind').not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

/** The flat default every keyless verb inherits. */
function flatDefaultMs(): number {
  const src = readFileSync(path.join(ROOT, 'server', 'src', 'remote', 'runner.ts'), 'utf8');
  const m = /^const CCD_TIMEOUT_MS = ([\d_]+);/m.exec(src);
  expect(m, 'runner.ts no longer defines CCD_TIMEOUT_MS as a bare literal').not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

describe('swap is not killed mid-carry', () => {
  it('CCD_VERB_TIMEOUT_MS carries a swap row', () => {
    expect(
      verbTimeoutMs('swap'),
      'swap has no entry, so it inherits the flat CCD_TIMEOUT_MS and can be SIGTERM-ed after the '
      + 'unit is stopped and the pane killed but before `wrapper` flips',
    ).not.toBeNull();
  });

  it('the swap row equals the agent ceiling — the carry has no bash-side bound below it', () => {
    expect(verbTimeoutMs('swap')).toBe(agentCeilingMs());
  });

  it('and that is strictly more than the flat default it would otherwise inherit', () => {
    expect(verbTimeoutMs('swap')!).toBeGreaterThan(flatDefaultMs());
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/swap-timeout-budget.test.ts
```

Expected: the first two cases FAIL. Case 1 fails on `expected null not to be null` with the
"swap has no entry" message; case 2 fails with `expected null to be 300000`; case 3 fails on the
non-null assertion. **Record the actual output** — this is the measured red half of the mutation table.

- [ ] **Step 3: Add the row**

In `server/src/remote/runner.ts`, immediately after `  enable: 300_000,` and before the closing `};`
of `CCD_VERB_TIMEOUT_MS`:

```typescript
  // `cmd_swap` stops the supervisor unit (ccd/ccd:13722) and kills the tmux
  // pane (:13723) BEFORE it flips the registry's `wrapper` (:13817). A kill
  // inside that window leaves a session that is not running, a registry that
  // still names the old account, and NO marker of either: no `swapblocked`, no
  // `lastswap`, no line in `swap.log`. Nothing in the tree can tell that state
  // from "never swapped", which is why this is a correctness fix and not a
  // comfort margin.
  //
  // 300 s is the agent's own `MAX_EXEC_TIMEOUT_MS` ceiling (agent/src/server.ts),
  // not a merely larger number, because the transcript carry has no bash-side
  // bound below it — `SWAP_BEAT_MAX` bounds the heartbeat re-stamping, not the
  // copy. So this NARROWS the window to the agent's maximum; it does not close
  // it, and a carry slower than 300 s is still killed mid-flight. Closing it
  // needs a ccd-side bound and is not this row's job.
  swap: 300_000,
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/swap-timeout-budget.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Verify the guard is real by mutating it**

Delete the `swap: 300_000,` line, re-run, confirm cases 1–3 go red again, then restore it. Record
before/after in the commit message. A comment is a request; a red suite is a mechanism.

- [ ] **Step 6: Run the neighbouring suites that read the same table**

```bash
cd server && ./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts test/remote-runner.test.ts
```

Expected: both pass unchanged, with **no edits needed**. This was checked when the plan was written
rather than left for the implementer to discover: `remote-runner.test.ts` pins no exhaustive key list.
Its own comment at `:85` states the position plainly — *"changing the entry in `CCD_VERB_TIMEOUT_MS`
cannot fail a single test"* — and `:149` records that `CCD_VERB_TIMEOUT_MS` and `timeoutMsFor` are
module-private and therefore unreachable from that suite.

That is worth naming, because it means **this table ships today with no guard of any kind**, and
`swap-timeout-budget.test.ts` is the first. If Step 6 reds, something changed since the plan was
written — stop and re-derive rather than editing the assertion.

- [ ] **Step 7: Commit**

```bash
git add server/src/remote/runner.ts server/test/swap-timeout-budget.test.ts
git commit -m "fix(remote): swap gets the agent's full exec ceiling, not the flat 90s (D-TBD-swap-timeout)

cmd_swap stops the unit and kills the pane before it flips \`wrapper\`. Under the
flat CCD_TIMEOUT_MS the agent SIGTERMs inside that window, leaving a dead session
on the old account with no swapblocked, no lastswap and no swap.log line.

Mutation measured: removing the row reds 3 assertions in swap-timeout-budget."
```

---

## Deviations found

- **D-TBD-swap-timeout** — `CCD_VERB_TIMEOUT_MS` had no `swap` key, so the verb inherited the flat
  90 s default while `cmd_swap`'s stop→flip window is bounded only by the agent's 300 s ceiling. A kill
  inside that window is unrecorded in every channel the tree has. Fixed by this plan.

**The ledger allocator was unreachable when this plan was written** — `POST /api/ledger/deviations`
lives on the server box and this session ran on the fleet box, where the server's loopback port does
not answer. Per the convention, the number above is written `D-TBD-<slug>` and must be MINTED and
DEFINED in the same act before merge. Do not look a number up; do not reuse a number from the
account-pools block `D-1663–D-1688`.

---

## Self-review

**Spec coverage.** §E has one requirement — the `swap: 300_000` row with its argument, shipped
independently and first. Task 1 implements it. No other spec section is in this plan's scope.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Every code step carries
its literal content. The one `TBD` present is the deliberate `D-TBD-<slug>` the convention prescribes
for an unreachable allocator, not an unfinished thought.

**Type consistency.** The plan defines three helpers — `verbTimeoutMs`, `agentCeilingMs`,
`flatDefaultMs` — used under exactly those names in the three `it` blocks. `verbTimeoutMs` returns
`number | null` and every use either asserts non-null first or applies `!` after an assertion that
established it. `timeoutMsFor`'s signature is unchanged.

**One risk the implementer must check at Step 6, not assume:** whether `remote-runner.test.ts` pins an
exhaustive list of `CCD_VERB_TIMEOUT_MS` keys. If it does, a new key reds it, and the fix is to extend
that list — never to relax it.
