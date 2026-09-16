# Ask Pre-emption Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a child session raises an `AskUserQuestion`, hold the operator's push for a grace window and give that child's parent session a chance to answer it first — so the parent absorbs the routine questions and the operator is only interrupted by the ones it could not rule on.

**Architecture:** The child does nothing new and `answerAsk` is not modified. `detectDialogs` already scrapes every dialog every tick and already computes `askActions`; the new code mints an ask row there, records the event immediately, and defers only the push. A new `POST /api/asks/:id/answer` lets the derived parent answer through the existing `answerAsk` primitive; a release sweep fires the deferred push when the parent declines or the window lapses. The deferred push lives in watcher memory so a lost `coord.db` degrades to today's behaviour rather than swallowing a notification.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Fastify, `node:sqlite` `DatabaseSync` (synchronous, WAL), vitest. Four packages run cd'd in: `server/`, `agent/`, `pwa/`, `shared/`.

**Spec:** `docs/superpowers/specs/2026-09-09-ask-preemption-lane-design.md` (committed `bf4808a8`). Read it before Task 1 — this plan argues from it and does not restate its reasoning.

## Global Constraints

- **Node floor `>=22.13.0`**, identical across all three engines. If `node-floor.test.ts`'s absolute assertion is red while the others are green, RAISE engines — never lower them.
- **Run suites in the FOREGROUND with timeout ≥600000ms.** Backgrounding hides a hang.
- **`cd server && npm ci` before the first test run** — vitest is not currently installed in this worktree.
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Known load flakes** (re-run in isolation before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- **`SELECT *` is banned in `server/src/coord/`.** Name every column.
- **`DatabaseSync` exposes `.changes`, NOT `.rowsAffected`.** Every CAS casts `Number(res.changes)`.
- **CoordStore is synchronous by design.** Never wrap it async; never add a repository interface over it.
- **A CAS guard belongs in the `WHERE` clause**, never read-then-check-then-write.
- **Enumerate once, derive the rest.** A second hand-written copy of any vocabulary fails `single-definition.test.ts`.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value.
- **Wire discipline is additive-only.** Do NOT bump `FLEET_PROTO` for a new field.
- **Every new guard ships with a test that goes RED when the guard is deleted**, measured before and after — not asserted in a comment.
- **This plan touches no `ccd/` executable code.** Only the two `ccd/*-skill/` corpora (Tasks 14–17), which ship AGENT-FIRST. That ordering is safe here: a parent only learns of an ask because the new server minted one, so no parent can act on the new clause before the routes exist.

---

## Deviations found

Numbers **D-2168 … D-2177**, issued as one contiguous block by `POST /api/ledger/deviations` on 2026-09-09 (floor moved to 2178). Each is defined here, in the act that allocated it.

- **D-2168** — `box-token-census.test.ts`'s `SCAN_RE` is a leftmost-first alternation over `WORDS.slice(2)` in ascending numeric order, so `twenty-one` in prose is read as just `twenty`, and `twenty-two` as `{twenty, two}`. The file records the limit as dated and silent (`:138-144`). Adding three coordination lanes takes the surface from 18/19 to 21/22, crossing the boundary, at which point the scanner reds against prose that is word-for-word correct. Fixed by matching the hyphenated forms first — the file's own prescription — landed as a measurably-no-op commit before any count changes. *(Task 1)*
- **D-2169** — The D8 ruling for the `asks` table: it is a RECORD and an answer mutex, authoritative for neither the question (the live pane is) nor the deferred push (the watcher's memory is). Its loss is free — every held ask degrades to an immediate push. Written where the table is born, in the `claims`/`ledger_alloc` style. An earlier draft put the deferred push in the table itself, which would have made a lost `coord.db` delete the notification permanently, because `dialogIds` is stamped on first sighting regardless and no later tick re-raises. *(Task 4, Task 6)*
- **D-2170** — `askKey` is a content hash and therefore identifies a QUESTION, not an ask INSTANCE: a child looping over N items regenerates it byte-for-byte, and nothing in the tree can tell instance 1 from instance 2. A grace window is exactly a delay in which that substitution happens, so the parent can answer a question it never read. Closed by snapshotting `HookState.updatedAt` as the row's `askAt` and refusing in the new route unless a fresh read still matches — in the new route ONLY, so `answerAsk`'s operator-lane semantics stay byte-identical. *(Task 5, Task 9)*
- **D-2171** — `answerAsk`'s loser-refusal (`not-waiting`, `no-menu`) covers one principal answering twice, which its own comment says; it does not cover two principals answering DIFFERENTLY within one tick, because it returns when `tmux send-keys` exits rather than when the TUI has repainted. The ask row becomes the mutex: a `held → answering` CAS runs before `answerAsk`, and the operator's own route closes the row the same way. *(Task 5, Task 9, Task 12)*
- **D-2172** — `pushOne` records and pushes in one act — the presence gate returns before `notifyLog.record` — so suppressing `raise()` to hold a push also deletes the operator's only durable trace of the question. The record is minted at hold time with `recordAlways: true, recordOnly: true`, and again on a parent answer. *(Task 6, Task 9)*
- **D-2173** — Eligibility is `askActions(hs) !== null`, not a hand-maintained carve-out. A list naming approvals alone leaves multi-question, multi-select, free-text and blank-label asks held for a window that can never resolve to an answer, and the multi-select case commits an irrevocable one-of-N. `askActions`' stated contract is already "offer an action only where `answerAsk` would accept it". *(Task 6)*
- **D-2174** — `AskResult`'s ten-member error union was spelled once, inline, in `server/src/inject/ask.ts`, with no runtime list. Re-homed to `shared/api.ts` as `ASK_REFUSE_CODES` / `AskRefuseCode` / `isAskRefuseCode` so both sides declare the vocabulary once (the D-1438 `ReadFailure` precedent), and admitted to `mail-routes.test.ts`'s kebab scanner by its own guard — never by `NOT_CODES`, which is reserved for store-internal spellings no wire carries. *(Task 3)*
- **D-2175** — `coordinator-skill.test.ts` has no clause-count guard: its `CONTRACT` loop is a `toContain` subset check, so an added eleventh clause goes unnoticed. Confirmed by grep — no `CONTRACT.length`, no numbering scan. The guard is authored net-new, copied from `worker-skill.test.ts`, and ships with the clause it would otherwise miss. *(Task 16)*
- **D-2176** — The ask routes are NAMED in the coordinator corpus, not EXEMPTed. This corrects the design doc's §8.2, which recommended a fifth EXEMPT class: `coordinator-skill.test.ts`'s EXEMPT set is a blocklist of routes the coordinator must never be *taught about*, and every existing member is an operator-only door. A coordinator IS a parent and does call these routes, so naming them is the truthful entry and no EXEMPT change is needed. *(Task 17)*
- **D-2177** — `cmd_swap` is the one live-pane-destroying operation not serialized against `answerAsk`'s capture-then-send window, and `answerAsk` does not check `sendKey`'s return, so a swap landing mid-answer reports `ok: true` for a keystroke that never arrived. Pre-existing, surfaced by this design because the lane makes a second principal press keys. *(Task 20)*

Numbers **D-2403 … D-2408**, issued as one contiguous block by `POST /api/ledger/deviations` on 2026-09-10 (floor moved to 2409) — the POST-MERGE round, after the lane shipped as PR #74 and a four-lane adversarial sweep measured what it shipped. Each is defined here, in the act that allocated it.

- **D-2403** — **D-2170's guard was write-once, and that made it a wedge.** `askAt` is snapshotted at mint and never re-stamped (no `UPDATE asks SET askAt` existed anywhere), while `ccd/session-hook.sh` stamps `updatedAt` on EVERY write. So ANY hookstate write under a live dialog — not a repaint, not a new question — permanently refused every parent answer with `ask-moved`, and the lane degraded silently to the pre-feature behaviour it was built to replace, with the whole suite green. The live writer is the `SubagentStart`/`SubagentStop` arm, which restores `prev_state` and re-reads `.ask` back off the file, so a subagent event rewrites the identical envelope under a fresh number. Closed by `CoordStore.restampAsk` — `askAt` advanced, CAS'd on BOTH witnesses the guard actually cares about (`dialogId`, the pane's own sha1, which no hook event can move; and `askKey`, the content the parent would answer) — called from `detectDialogs`' `last === dialog.id` arm, i.e. only where this tick re-scraped the very menu the row was minted against. Not a weakening: repaint the dialog, change the question, or lose the pane and zero rows change. Residual, stated: the scrape is a 2 s poll, so a bump between the last re-stamp and the route's own read still refuses once — a refusal a retry wins, which is what `wave-lifecycle.md` already tells a coordinator `ask-moved` means.
- **D-2404** — The mechanism's attribution, corrected before it reached a fix. Two independent reviewers named `session-hook.sh:1233`'s ask-clear exemption as what preserves the envelope across a subagent event. It is not: with an ask set the state is `waiting`, `SubagentStop` restores `prev_state` = `waiting`, so the clear's `state == working || done` condition is false regardless and the exemption never applies on this path. What preserves the ask is the `ask_json=$(jq -c '.ask // null' "$f")` re-read at `:1227`. Same conclusion, different line — and a fix aimed at `:1233` would have changed nothing.
- **D-2405** — `asks-routes.test.ts:72` seeded `event: 'Notification'`, an event `session-hook.sh` can never write (`*) exit 0` at `:1009`) and that `install-session-hooks.sh:37` registers nowhere — confirmed against all six live wrapper HOMEs, whose `settings.json` hook keys are identical and carry no `Notification`. It changes no assertion (the reader ignores `event`), which is exactly why it survived: a fixture teaching the next reader that an event exists when it does not. Corrected to `'PermissionRequest'`.
- **D-2406** — `asks-mint.test.ts` carried **zero** `askAt` assertions (`grep -c askAt` → 0), so no test anywhere drove mint → answer end to end. D-2170's tests pinned the CAS's SHAPE against a fabricated `now + 5000` mismatch and never its premise — that a moved number means a moved instance. That is why an inert lane would have stayed green. Closed by `ask-instance-guard.test.ts` (the real hook writing, the real CAS refusing, with a control isolating the bump) plus three watcher-level tests here that measure the re-stamp firing on an ordinary tick, mutation-measured: deleting the call reds the positive test and leaves both negative controls green.
- **D-2407** — `ASK_GRACE_MS = 120_000`'s coverage argument does not survive measurement, though the number does. Measured against the closest live proxy (`toId:'coordinator'` mail, the identical `COORD_QUIET_MS` gate the nudge rides): the "~92% inside 120 s" figure is survivorship-conditioned — 84/91 of rows that were EVENTUALLY delivered, against a true population of 110 (94 delivered, 11 `acked` with null `deliveredAt`, 5 `rejected`), i.e. **79.1%**. And it measured the wrong endpoint: `releaseAsk` at grace flips the row to `released` and `takeAskForAnswer` then hard-refuses `not-held`, so a late answer is REJECTED, not delayed — the window must cover the parent's completed ruling, not delivery. End-to-end (`mail.at → ackedAt`): p50 31.9 s, p75 72.0 s, **76.2%** inside 120 s, and that is a lower bound since the worker skill mandates acking BEFORE acting. KEEP 120 s — but on the ceiling argument (every second is operator latency on a declined ask), never on a coverage claim this data does not support. The number stays formally unmeasured until `asks` has rows to query as `answeredAt - at`.
- **D-2408** — `session-hook.sh`'s `PermissionRequest` arm was MEASURED on Claude Code 2.1.222 and its own comment warns the mapping may flip; the fleet now runs 2.1.263–2.1.267 across nine lanes. Re-measured live on 2026-09-10 against a 2.1.267 session: the ask's hookstate write recorded `"event":"PermissionRequest"`. The arm still fires, 45 patch versions on. Recorded so the next reader knows the comment was re-checked rather than merely inherited — and it remains a third-party default, so it is a claim with an expiry, not a fact.


Two more, minted 2026-09-09 during Task 19's coordinator review ("fix round 1"), non-contiguous with the block above — other work minted numbers between D-2177 and these in the interim:

- **D-2310** — The chip (Task 19) is computed server-side in `assembleFleet`, reading `CoordStore` directly, NOT by consuming `GET /api/asks`. Every other `FleetSession` field is computed there, and routing the fleet frame through an HTTP call to the server's own route would be a new pattern for no gain. This corrects both this plan (Task 11's and Task 19's own "Interfaces" lines) and the tracked design doc (§2.8), which both said the opposite at the time Task 19 shipped — the routing sentence was written before ruling F5 was decided and never updated to match. `GET /api/asks` keeps the parent's cross-sibling read and any later PWA list view; as of this ruling it has zero PWA consumers. *(Task 19)*
- **D-2311** — `reviveFleetSessions` discards the WHOLE snapshot array on the first unrevivable session, so a strict field reader is not a local decision: a malformed `ask.parentId` on one session would have cost the operator their entire `state-cache.json` and the whole PWA offline cache — the two surfaces an operator falls back to when things are already bad. `reviveAsk`'s original form rejected the session on a malformed shape, the `reviveSwapBlocked`/`reviveSubstrate` stance, but that stance exists for fields that flag a FAULT an operator must not have silently laundered into "nothing wrong" — the ask chip gates no action at all, so a bad chip and no chip are the same outcome, and there is no direction a degrade could get backwards. Fixed: `reviveAsk` degrades a malformed `ask` (non-object, or a missing/wrong-type/empty `parentId`) to `null` — never a rejection of the whole session. `state` still degrades onto `AskState`'s `unknown` member when unrecognised, unchanged. *(Task 19)*

One more, minted 2026-09-09 as a residual correction after the whole-branch review's SHIP verdict — non-contiguous with both blocks above:

- **D-2327** — The `held` chip had no time ceiling, on the premise that a held ask is live by definition. That premise holds only within one process lifetime and only while `staleAsk` can still reach the row — so a row stranded in `answering` (the dialog cleared mid-answer), or one left `held` across a server restart, showed a permanent claim that a live question was waiting on a parent. `heldAsks` is deliberately never rehydrated from the table (D-2169: the hold lives in memory, so an ask's loss is free), and `dialogIds` is stamped on the priming tick before the `notify` gate, so no later re-mint ever clears such a row. Fixed by `ASK_HELD_CHIP_MAX_MS = ASK_GRACE_MS + ASK_ANSWERING_MAX_MS` in the new `server/src/askwindow.ts` — a row older than the grace window plus the answering ceiling is stale by construction, so the bound needed no third invented number — plus widening `staleAsk`'s CAS to `state IN ('held','answering')` so a vanished dialog settles the row whichever principal was mid-answer. The new module exists because `fleet.ts` cannot import `watch.ts` (the arrow runs the other way: `watch.ts` imports `assembleFleet` from `fleet.ts`), and re-spelling either constant in `fleet.ts` would have been the second copy this repo's single-definition discipline forbids. *(Task 19, whole-branch review F2(b))*

---

## File Structure

**Created**
- `server/test/asks-store.test.ts` — store-level tests for the ask table and its CAS.
- `server/test/asks-mint.test.ts` — the `detectDialogs` mint point and the hold.
- `server/test/asks-routes.test.ts` — the three routes, their gates and their refusals.
- `server/test/asks-sweep.test.ts` — the release sweep and the kill switch.

**Modified**
- `shared/api.ts` — `AskState` family, `AskRefuseCode` family, `FleetSession.ask`.
- `server/src/coord/schema.ts` — `MIGRATIONS[8]`: the `asks` table.
- `server/src/coord/store.ts` — the ask read/write methods and `parentOfSession`.
- `server/src/coord/routes.ts` — three routes.
- `server/src/watch.ts` — the mint point, the hold map, the release sweep, staleness.
- `server/src/inject/ask.ts` — `AskResult['error']` aliases `AskRefuseCode`.
- `server/src/server.ts` — the operator's answer route closes the row.
- `server/test/{single-definition,mail-routes,box-token-census,coordinator-skill,worker-skill,reconstruction-drill}.test.ts` — guards.
- `README.md`, `CLAUDE.md`, `server/src/auth/gate.ts`, `server/test/auth-gate.test.ts` — census prose.
- `ccd/worker-skill/SKILL.md`, `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md` — the contracts.
- `pwa/src/**` — the chip.

---

## Task 1: Fix the census scanner's hyphen blindness (D-2168)

Land this FIRST and alone. At today's 18/19 it is provably a no-op, which is what makes it reviewable; after Task 13 it is load-bearing.

**Files:**
- Modify: `server/test/box-token-census.test.ts` (the `SCAN_RE` construction, ~line 131)

**Interfaces:**
- Consumes: nothing.
- Produces: a `SCAN_RE` that tokenises `twenty-one` as `twenty-one`. Task 13 depends on this.

- [ ] **Step 1: Install deps so the suite can run at all**

```bash
cd server && npm ci
```

- [ ] **Step 2: Write the failing test**

Add this to `server/test/box-token-census.test.ts`, immediately after the `numeralsIn` definition. It asserts the property the fix delivers, and it is RED today.

```typescript
  // D-2168: leftmost-first alternation in ascending order made `twenty-one`
  // scan as `twenty`, so a correct sentence about a 21-lane surface read as a
  // sentence about a 20-lane one. Landed while the surface was still 18/19,
  // where it is provably a no-op — this test is the whole evidence of the fix.
  it('reads a hyphenated number word as one token', () => {
    expect(numeralsIn('the twenty-one box-token machine lanes')).toEqual(['twenty-one']);
    expect(numeralsIn('all twenty-two of them')).toEqual(['twenty-two']);
    expect(numeralsIn('the nineteen lanes')).toEqual(['nineteen']);
    expect(numeralsIn('twenty lanes, then twenty-five')).toEqual(['twenty', 'twenty-five']);
  });
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts -t 'hyphenated number word'
```

Expected: FAIL — received `['twenty']` where `['twenty-one']` was expected.

- [ ] **Step 4: Fix `SCAN_RE` by ordering the alternation longest-first**

Replace the `SCAN_RE` line. Do NOT widen `word()` — the file's own note at `:143-144` prescribes this exact fix.

```typescript
// D-2168: LONGEST FIRST, not numeric order. A JS alternation is leftmost-first,
// so with `twenty` ahead of `twenty-one` the shorter branch wins and `\b` ends
// the match at the hyphen — `twenty-one` scanned as `twenty`, and `twenty-two`
// as two tokens. Sorting by descending length makes every hyphenated form try
// before the bare word it starts with. `word()` is untouched, deliberately:
// widening it would change what a count MEANS rather than how it is read.
const SCAN_RE = new RegExp(
  `\\b(${[...WORDS.slice(2)].sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi');
```

- [ ] **Step 5: Verify green, and verify the no-op**

```bash
cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts
```

Expected: PASS, every test in the file. The whole-file pass is the proof that the change is a no-op at the current 18/19 counts — no prose site moved.

- [ ] **Step 6: Commit**

```bash
git add server/test/box-token-census.test.ts
git commit -m "test(census): D-2168 — read a hyphenated number word as one token

Leftmost-first alternation in ascending numeric order made 'twenty-one' scan
as 'twenty'. Harmless while the surface is nineteen lanes; the ask lane takes
it to twenty-two, at which point the scanner reds on correct prose. Ordered
longest-first, per the file's own prescription. No-op at today's counts — the
rest of the suite passing unchanged is the evidence."
```

---

## Task 2: The `AskState` vocabulary (shared/api.ts)

**Files:**
- Modify: `shared/api.ts`
- Test: `server/test/single-definition.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type AskState = 'held' | 'answering' | 'answered' | 'released' | 'stale' | 'unknown'`; `ASK_STATE_MAP: Record<AskState, true>`; `ASK_STATES: readonly AskState[]`; `isAskState(v: unknown): v is AskState`. Tasks 4, 5, 6, 9, 10, 11 consume these.

- [ ] **Step 1: Write the failing test**

Add to `server/test/single-definition.test.ts`, inside the Build 8 vocabularies describe (which its own comment declares an open family):

```typescript
  describe('AskState', () => {
    it('is spelled once, in shared/api.ts', () => {
      expect(oneDefinition('ASK_STATE_MAP')).toEqual(['shared/api.ts']);
      expect(oneDefinition('ASK_STATES')).toEqual(['shared/api.ts']);
    });

    it('derives its runtime list from the map, never a second array', () => {
      const src = read('shared/api.ts');
      expect(src).not.toMatch(/ASK_STATES[^=]*=\s*\[/);
    });

    it('round-trips every member and refuses non-members', () => {
      expect(ASK_STATES.length).toBe(6);
      expect(new Set(ASK_STATES).size).toBe(ASK_STATES.length);
      for (const s of ASK_STATES) expect(isAskState(s)).toBe(true);
      expect(isAskState('nope')).toBe(false);
      expect(isAskState(null)).toBe(false);
      expect(isAskState(7)).toBe(false);
    });
  });
```

Add `ASK_STATES, isAskState` to this file's import from `'../../shared/api.js'`.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t AskState
```

Expected: FAIL — `ASK_STATES` is not exported from `shared/api.ts`.

- [ ] **Step 3: Declare the vocabulary**

Add to `shared/api.ts`, beside the other Build 8 state vocabularies. Use the MAP idiom (the `SkillState`/`ProgramState` family), not the array-first one: the map makes an added or removed member a compile error, which is what a state machine wants.

```typescript
/** The life of one ask — a child's live `AskUserQuestion` that its parent may
 *  pre-empt before the operator is notified.
 *
 *  `held`      the push is deferred; the parent may answer.
 *  `answering` a principal has taken the row and is pressing a key (D-2171).
 *  `answered`  a digit landed. `answeredBy` says which principal.
 *  `released`  the parent declined, or the window lapsed. The push has fired.
 *  `stale`     the dialog went away unanswered — interrupted, cleared, swapped.
 *  `unknown`   a token this build does not know, read off disk after a deploy
 *              rollback. Never accepted at ingress; a writer claiming it is
 *              refused `bad-state`. */
export type AskState = 'held' | 'answering' | 'answered' | 'released' | 'stale' | 'unknown';

export const ASK_STATE_MAP: Record<AskState, true> = {
  held: true, answering: true, answered: true, released: true, stale: true, unknown: true,
};

export const ASK_STATES: readonly AskState[] = Object.keys(ASK_STATE_MAP) as AskState[];

export function isAskState(v: unknown): v is AskState {
  return typeof v === 'string' && (ASK_STATES as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add shared/api.ts server/test/single-definition.test.ts
git commit -m "feat(shared): AskState — the six states of a pre-emptible ask

Map idiom, so an added or removed member is a compile error. 'unknown' is a
real member for a rollback read, never accepted at ingress."
```

---

## Task 3: Re-home the ask refusal vocabulary (D-2174)

**Files:**
- Modify: `shared/api.ts`, `server/src/inject/ask.ts`
- Test: `server/test/single-definition.test.ts`, `server/test/mail-routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ASK_REFUSE_CODES`, `type AskRefuseCode`, `isAskRefuseCode`. `AskResult['error']` becomes `AskRefuseCode`. Task 9 returns these codes on the wire.

- [ ] **Step 1: Write the failing tests**

In `server/test/single-definition.test.ts`:

```typescript
  describe('AskRefuseCode', () => {
    it('is spelled once, in shared/api.ts', () => {
      expect(oneDefinition('ASK_REFUSE_CODE_MAP')).toEqual(['shared/api.ts']);
    });

    it('leaves no second copy of the literal set in inject/ask.ts', () => {
      // D-2174: the union used to live here, inline, with no runtime list.
      expect(read('server/src/inject/ask.ts')).not.toMatch(/'menu-mismatch'\s*;/);
    });

    it('round-trips every member', () => {
      expect(ASK_REFUSE_CODES.length).toBe(10);
      for (const c of ASK_REFUSE_CODES) expect(isAskRefuseCode(c)).toBe(true);
      expect(isAskRefuseCode('nope')).toBe(false);
      expect(isAskRefuseCode(null)).toBe(false);
    });
  });
```

In `server/test/mail-routes.test.ts`, extend the kebab scanner's OR chain and its failure message. Find the chain that reads `isMailRejectCode(tok) || isRunRefuseCode(tok)` and add a third arm — never merge the unions, the file's own comment says three vocabularies sharing one scanner stay three:

```typescript
      || isAskRefuseCode(tok)
```

and append `or AskRefuseCode` to that assertion's message string.

- [ ] **Step 2: Run and watch both fail**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t AskRefuseCode test/mail-routes.test.ts
```

Expected: FAIL — `ASK_REFUSE_CODES` is not exported.

- [ ] **Step 3: Declare it in `shared/api.ts`**

```typescript
/** `answerAsk`'s typed refusals, declared HERE so both sides spell them once —
 *  the route that returns them and the primitive that produces them (D-2174,
 *  the `ReadFailure` precedent of D-1438). Map idiom: a code that leaves
 *  `AskResult` and is not removed here is a compile error. */
export const ASK_REFUSE_CODE_MAP: Record<string, true> = {
  'not-alive': true, 'not-waiting': true, 'stale-ask': true, 'ask-mismatch': true,
  'multi-question': true, range: true, multiselect: true, 'duplicate-index': true,
  'no-menu': true, 'menu-mismatch': true,
};

export const ASK_REFUSE_CODES = Object.keys(ASK_REFUSE_CODE_MAP) as readonly AskRefuseCode[];

export type AskRefuseCode =
  | 'not-alive' | 'not-waiting' | 'stale-ask' | 'ask-mismatch' | 'multi-question'
  | 'range' | 'multiselect' | 'duplicate-index' | 'no-menu' | 'menu-mismatch';

export function isAskRefuseCode(v: unknown): v is AskRefuseCode {
  return typeof v === 'string' && (ASK_REFUSE_CODES as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Point `AskResult` at it**

In `server/src/inject/ask.ts`, replace the inline union:

```typescript
export type AskResult = { ok: true } | { ok: false; error: AskRefuseCode };
```

and add `AskRefuseCode` to that file's type import from `'../../../shared/api.js'`.

- [ ] **Step 5: Verify green, including the typecheck**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/mail-routes.test.ts test/typecheck-tests.test.ts
```

Expected: PASS. `typecheck-tests` proves `AskResult` still satisfies every existing caller.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/inject/ask.ts server/test/single-definition.test.ts server/test/mail-routes.test.ts
git commit -m "refactor(shared): D-2174 — AskRefuseCode gets one home

answerAsk's ten refusals lived inline in inject/ask.ts with no runtime list, so
a route returning one had to re-spell it. Declared once in shared/api.ts and
admitted to the kebab scanner by its own guard, never by NOT_CODES."
```

---

## Task 4: The `asks` table (D-2169)

**Files:**
- Modify: `server/src/coord/schema.ts` (append `MIGRATIONS[8]`)
- Test: `server/test/asks-store.test.ts` (create)

**Interfaces:**
- Consumes: `AskState` (Task 2).
- Produces: table `asks`; `COORD_SCHEMA_VERSION` becomes 9. Task 5 reads and writes it.

- [ ] **Step 1: Write the failing test**

Create `server/test/asks-store.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { openCoordDb, COORD_SCHEMA_VERSION } from '../src/coord/schema.js';
import { mkTmp, cleanupTmp } from './tmpHelpers.js';

afterEach(cleanupTmp);

describe('the asks table', () => {
  it('is created at schema version 9 with the columns the lane needs', () => {
    const dir = mkTmp('asks-schema');
    const db = openCoordDb(`${dir}/coord.db`);
    expect(COORD_SCHEMA_VERSION).toBe(9);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('asks')").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(cols).toEqual([
      'answer', 'answeredAt', 'answeredBy', 'askAt', 'askKey', 'at', 'childId',
      'dialogId', 'id', 'options', 'parentId', 'question', 'releasedAt', 'runId', 'state',
    ]);
  });
});
```

Adjust the `openCoordDb` import and the tmp helper call to match this repo's actual helper names — read `server/test/tmpHelpers.ts` and one existing schema test first and copy their exact idiom.

- [ ] **Step 2: Run and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-store.test.ts
```

Expected: FAIL — `COORD_SCHEMA_VERSION` is 8 and `pragma_table_info('asks')` returns nothing.

- [ ] **Step 3: Append the migration**

Append ONE entry to `MIGRATIONS` in `server/src/coord/schema.ts`. Do not touch `MIGRATIONS[0..7]` — `db.ts` runs `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, so an edit to an applied entry never runs again. Do not edit `COORD_SCHEMA_VERSION`; it is `MIGRATIONS.length`.

```typescript
  // ── 9: user_version 8 -> 9 ──────────────────────────────────────────────
  //
  // The ask pre-emption lane. A child's live AskUserQuestion, held from the
  // operator's notification for a grace window so the child's parent can
  // answer it from the artifacts first.
  //
  // D-2169'S RULING ON `asks`: this table is a RECORD and an answer mutex. It
  // is authoritative for NEITHER of the two facts the lane turns on — the
  // question is authoritative on the child's live PANE, and the deferred push
  // is authoritative in the watcher's own memory. Its loss is therefore FREE:
  // with no rows, no parent is told and no parent can answer, so every ask
  // pushes immediately, which is the behaviour that shipped before this lane.
  // Putting the deferred push HERE instead would have inverted that — a lost
  // db would delete the notification outright, because `dialogIds` is stamped
  // on first sighting whether or not the push was raised, so no later tick
  // re-raises it.
  //
  // `state` is read back through `isAskState`, never a cast — the same
  // we-do-not-know rule as every enum column in this file. `askAt` is the
  // instance guard (D-2170): a snapshot of the hookstate's `updatedAt` at mint
  // time, because `askKey` hashes CONTENT and a child asking the same question
  // twice regenerates it byte-for-byte.
  `
    CREATE TABLE asks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         INTEGER NOT NULL,
      childId    TEXT    NOT NULL,
      parentId   TEXT    NOT NULL,
      runId      INTEGER,              -- provenance only; an ask outlives its wave
      askKey     TEXT    NOT NULL,     -- askKey(hs.ask) at mint time
      askAt      INTEGER NOT NULL,     -- hookstate updatedAt at mint time (D-2170)
      dialogId   TEXT    NOT NULL,     -- the pane-scrape identity, for staleness
      question   TEXT    NOT NULL,
      options    TEXT    NOT NULL,     -- JSON array of option labels, in order
      state      TEXT    NOT NULL,     -- AskState; isAskState on read, never a cast
      answeredBy TEXT,                 -- a session id, or 'operator'
      answer     TEXT,                 -- the option label that was pressed
      answeredAt INTEGER,
      releasedAt INTEGER
    );
    CREATE INDEX asks_by_state ON asks(state);
    CREATE INDEX asks_by_child ON asks(childId);
    CREATE INDEX asks_by_parent ON asks(parentId, state);
  `,
```

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-store.test.ts test/coord-schema.test.ts
```

Expected: PASS. If a schema test hard-asserts version 8, bump it — that is the intended edit, not a workaround.

- [ ] **Step 5: Commit**

```bash
git add server/src/coord/schema.ts server/test/asks-store.test.ts
git commit -m "feat(coord): D-2169 — the asks table, and the ruling on losing it

A record and an answer mutex, authoritative for neither the question nor the
deferred push, so its loss degrades the lane to today's behaviour."
```

---

## Task 5: Store methods (D-2170, D-2171)

**Files:**
- Modify: `server/src/coord/store.ts`
- Test: `server/test/asks-store.test.ts`

**Interfaces:**
- Consumes: `AskState`, `isAskState` (Task 2); the `asks` table (Task 4).
- Produces, all synchronous methods on `CoordStore`:
  - `parentOfSession(childId: string): string | null`
  - `insertAsk(a: {childId, parentId, runId: number|null, askKey, askAt, dialogId, question, options: string[], now: number}): number`
  - `askById(id: number): AskRow | null`
  - `asksForParent(parentId: string, state?: AskState): AskRow[]`
  - `takeAskForAnswer(id: number, askAt: number): AskTakeResult`
  - `settleAsk(id: number, by: string, answer: string, now: number): void`
  - `releaseAsk(id: number, now: number): boolean`
  - `staleAsk(dialogId: string, childId: string, now: number): boolean`
  - `heldAskFor(childId: string): AskRow | null` — Task 12's lookup when the operator answers.
  - the two types both later tasks name:

```typescript
export interface AskRow {
  id: number; at: number; childId: string; parentId: string; runId: number | null;
  askKey: string; askAt: number; dialogId: string;
  question: string; options: string[];          // JSON-decoded on read
  state: AskState;                              // via isAskState, never a cast
  answeredBy: string | null; answer: string | null;
  answeredAt: number | null; releasedAt: number | null;
}

export type AskTakeResult =
  | { ok: true; row: AskRow }
  | { ok: false; why: 'unknown-ask' | 'not-held' | 'ask-moved' };
```

`askById` is the public read; a private `readAsk` may back it, but every caller in this plan names `askById`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/asks-store.test.ts`. The load-bearing ones are the last two — they are D-2170 and D-2171 respectively.

```typescript
describe('ask store methods', () => {
  const mk = () => { /* open a fixture CoordStore — copy the idiom from an
                        existing store test's setup verbatim */ };

  it('derives a program worker parent from the run that dispatched it', () => {
    const s = mk();
    const run = s.openRun({ project: 'p', program: 'prog', wave: 1, claimedBy: 'coord-1' });
    s.setSession(run.id, 'child-1');
    expect(s.parentOfSession('child-1')).toBe('coord-1');
    expect(s.parentOfSession('nobody')).toBeNull();
  });

  it('follows a reclaim, because the parent is derived and not stored', () => {
    const s = mk();
    const run = s.openRun({ project: 'p', program: 'prog', wave: 1, claimedBy: 'coord-1' });
    s.setSession(run.id, 'child-1');
    s.reclaimProgram('prog', 'coord-2', Date.now());
    expect(s.parentOfSession('child-1')).toBe('coord-2');
  });

  it('refuses a second taker — the row is the mutex (D-2171)', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    expect(s.takeAskForAnswer(id, 1000).ok).toBe(true);
    const second = s.takeAskForAnswer(id, 1000);
    expect(second).toEqual({ ok: false, why: 'not-held' });
  });

  it('refuses an answer aimed at a different instance of the same question (D-2170)', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    // The child answered instance 1 and repainted an identical menu: same
    // askKey, same labels, new hookstate write.
    expect(s.takeAskForAnswer(id, 2000)).toEqual({ ok: false, why: 'ask-moved' });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-store.test.ts
```

Expected: FAIL — `parentOfSession` is not a function.

- [ ] **Step 3: Implement, in a new section of `store.ts`**

```typescript
/* ── asks (ask pre-emption lane, D-2169..D-2171) ───────────────────────── */

/** The parent of a dispatched program worker: the coordinator of the run that
 *  dispatched it. DERIVED, never stored — `reclaimProgram` rewrites
 *  `runs.claimedBy` for every run of a program in one transaction, so a derived
 *  answer follows a handover for free while a stored id would name a corpse.
 *
 *  ORDER BY id DESC is a CONVENTION, not a guarantee: nothing in the schema
 *  forbids two open runs naming one sessionId, and the coordinator protocol
 *  DELIBERATELY creates that state by opening wave N+1 before closing wave N.
 *  The newest run's claimant is the right answer there, and `close.ts`'s
 *  `survivorOf` documents the same protocol-not-DB-enforced caveat. */
parentOfSession(childId: string): string | null {
  const row = this.db.prepare(
    `SELECT claimedBy FROM runs WHERE sessionId = ? AND state NOT IN ${TERMINAL_SQL}
       ORDER BY id DESC LIMIT 1`,
  ).get(childId) as { claimedBy: string | null } | undefined;
  return row?.claimedBy ?? null;
}

/** THE GUARD IS IN THE `WHERE` (the `endClaim` shape). Two predicates, and they
 *  are DIFFERENT refusals a caller acts on differently: `not-held` means another
 *  principal already took this row (D-2171); `ask-moved` means the child has
 *  written its hookstate again since the mint, so the menu on screen may be a
 *  DIFFERENT INSTANCE of an identical question (D-2170). Collapsing them would
 *  be an overloaded value at a seam — one is a lost race, the other is a
 *  near-miss wrong answer. */
takeAskForAnswer(id: number, askAt: number): AskTakeResult {
  return tx(this.db, () => {
    const row = this.readAsk(id);
    if (row === null) return { ok: false as const, why: 'unknown-ask' as const };
    if (row.askAt !== askAt) return { ok: false as const, why: 'ask-moved' as const };
    const res = this.db.prepare(
      "UPDATE asks SET state = 'answering' WHERE id = ? AND state = 'held' AND askAt = ?",
    ).run(id, askAt);
    if (Number(res.changes) === 0) return { ok: false as const, why: 'not-held' as const };
    return { ok: true as const, row };
  });
}
```

Write `insertAsk`, `readAsk`/`askById`, `asksForParent`, `settleAsk`, `releaseAsk` and `staleAsk` in the same style: named columns, `isAskState` on every read of `state`, `Number(res.changes)` on every conditional update, `tx()` around anything multi-statement. `releaseAsk` and `staleAsk` both CAS from `'held'` and return whether they applied, so the sweep can tell "I released it" from "someone beat me".

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-store.test.ts
```

Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add server/src/coord/store.ts server/test/asks-store.test.ts
git commit -m "feat(coord): D-2170/D-2171 — ask store, the row as mutex, the instance guard

parentOfSession derives the coordinator from the run that dispatched the child,
so it follows a reclaim. takeAskForAnswer CASes held->answering and tells a lost
race from an ask that moved to a new instance of an identical question."
```

---

## Task 6: The mint point (D-2172, D-2173)

**Files:**
- Modify: `server/src/watch.ts` (`detectDialogs`, plus a new map beside `dialogIds`)
- Test: `server/test/asks-mint.test.ts` (create)

**Interfaces:**
- Consumes: `parentOfSession`, `insertAsk` (Task 5); `askActions` (already imported at `watch.ts:14`).
- Produces: `private heldAsks = new Map<string, { until: number; askId: number; payload: {...} }>()`. Task 7 reads it.

- [ ] **Step 1: Write the failing tests**

Create `server/test/asks-mint.test.ts` with three cases. Copy the watcher harness setup from an existing `watch`-driven suite verbatim.

```typescript
it('holds the push and records the event when a child has a parent', async () => {
  // child-1 is the sessionId of an open run claimed by coord-1; its pane shows a
  // single-select menu and its hookstate is waiting with a matching envelope.
  await w.tick();
  expect(pushes.filter((p) => p.kind === 'ask')).toEqual([]);   // deferred
  expect(notifyLog.records.filter((r) => r.kind === 'ask')).toHaveLength(1);  // D-2172
  expect(store.asksForParent('coord-1', 'held')).toHaveLength(1);
});

it('pushes immediately when no parent is derivable', async () => {
  // orphan-1 is in no run.
  await w.tick();
  expect(pushes.filter((p) => p.kind === 'ask')).toHaveLength(1);
  expect(store.asksForParent('coord-1', 'held')).toEqual([]);
});

it('pushes immediately for an ask askActions refuses (D-2173)', async () => {
  // child-1's envelope carries TWO questions — answerAsk would refuse
  // multi-question no matter who answered, so holding it is pure latency.
  await w.tick();
  expect(pushes.filter((p) => p.kind === 'ask')).toHaveLength(1);
  expect(store.asksForParent('coord-1', 'held')).toEqual([]);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-mint.test.ts
```

Expected: FAIL — the push fires in case 1 and no ask row exists.

- [ ] **Step 3: Add the hold map beside the existing latches**

In `server/src/watch.ts`, next to `dialogIds` and `actionlessAsks`:

```typescript
  /** Asks whose operator push is DEFERRED, keyed by session id. IN MEMORY BY
   *  DESIGN and not in coord.db (D-2169): this map is the only carrier of the
   *  deferred push, so a lost database must not be able to swallow it. A server
   *  restart drops the hold and the push is lost — which is PRE-EXISTING, not a
   *  regression: `this.primed` is false on the first tick after boot and
   *  `dialogIds` suppresses the second, so a restart during any live dialog
   *  re-pushes nothing today either.
   *
   *  Cleared in the same `else if (last !== undefined)` branch that clears
   *  `dialogIds` — the dialog going away is the end of the hold. */
  private heldAsks = new Map<string, { until: number; askId: number;
    ev: Parameters<FleetWatcher['pushOne']>[0] }>();
```

- [ ] **Step 4: Mint at the raise site**

Inside `detectDialogs`, the branch that today reads `if (last !== dialog.id) { …; if (notify) raise(); }`. Replace the `if (notify) raise();` call with the eligibility fork. `actions` and `this.hookStates.get(r.id)` are already in scope.

```typescript
          if (notify) {
            const hs = this.hookStates.get(r.id) ?? null;
            const parent = actions !== null && hs !== null
              ? (this.deps.coord?.parentOfSession(r.id) ?? null) : null;
            // D-2173: ELIGIBILITY IS `askActions`, and nothing else. Its own
            // contract is "offer an action only where `answerAsk` would accept
            // it", so every ask it refuses — an approval, a multi-question
            // envelope, a multi-select, a free-text ask, a blank label — is one
            // no principal could answer through this lane. Holding those would
            // be a grace window that can never resolve to an answer.
            if (parent !== null && parent !== r.id && !this.asksDisabled) {
              const ask = this.hold(r, dialog, actions, hs, parent);
              // D-2172: the RECORD is minted now, not at release. `pushOne`
              // returns before `notifyLog.record` when the operator is looking,
              // so suppressing the raise would delete the operator's only trace
              // of a question their parent went on to answer in their name.
              this.pushOne({ ...ask.ev, recordAlways: true, recordOnly: true },
                            this.activeProjects);
              this.heldAsks.set(r.id, ask);
            } else {
              raise();
            }
          }
```

Write the private `hold(...)` helper next to `detectDialogs`: it calls `this.deps.coord!.insertAsk(...)` with `askKey(hs.ask)`, `hs.updatedAt` as `askAt`, `dialog.id` as `dialogId`, the question text and the option labels, and returns `{ until: now + ASK_GRACE_MS, askId, ev }` where `ev` is exactly the object `raise()` would have passed to `pushOne` — snapshotted, because nothing persists a tick-local closure past its tick.

- [ ] **Step 4b: Tell the parent — without this, nobody can win the race**

Minting, recording and holding are invisible to the parent: it is asleep, and no existing lane wakes it. `hold(...)` must also queue ordinary mail so the delivery sweep nudges it.

```typescript
    // The parent is asleep and nothing else will wake it. Ordinary mail, so the
    // existing idle gating applies unchanged — and the latency does not gate the
    // operator, because the operator's own push is racing this on its own clock.
    // The subject is unique BY CONSTRUCTION: `hasOutstandingPeerDuplicate` is
    // subject-keyed, so a fixed subject would 409 the second ask of the day as a
    // restatement of the first.
    this.deps.coord!.queueSystemMail({
      fromId: 'operator', toId: parent, runId: null, kind: 'question',
      subject: `ask:${askId}`, body: renderAskBrief(askId, r.id, question, options),
    });
```

`renderAskBrief` states four things and nothing else: the child's id, the question and its options in order, the two routes (`POST /api/asks/:id/answer` with `optionIndexes`, `POST /api/asks/:id/release` to decline), and the sentence that carries §4's **lazy role invocation** — this session is that child's parent, and `ccrc-coordinator` is the skill for the job. That sentence is why nothing has to happen at session creation: the role arrives with its first duty.

Add a test to Task 6's file asserting the mail is queued to the derived parent with subject `ask:<id>`, and that two asks from two children produce two distinct subjects.

Add the constant to the constants block, beside `MAIL_QUIET_MS`:

```typescript
/** How long an eligible ask is withheld from the operator's phone so its parent
 *  can rule first. FLOOR: a parent that has just gone idle is not mailable for
 *  MAIL_QUIET_MS (60s) — measured from its live-status `statusUpdatedAt` — so a
 *  window under ~70s gives that parent no turn at all and the hold is pure
 *  latency. CEILING: every second here is latency the operator pays on the asks
 *  the parent declines, which is why `POST /api/asks/:id/release` exists — a
 *  parent that answers "not mine" fires the push at once, so only a parent that
 *  has genuinely gone quiet ever costs the full window. */
const ASK_GRACE_MS = 120_000;
```

- [ ] **Step 5: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-mint.test.ts test/watch.test.ts
```

Expected: PASS. `watch.test.ts` proves the no-parent path is unchanged.

- [ ] **Step 6: Commit**

```bash
git add server/src/watch.ts server/test/asks-mint.test.ts
git commit -m "feat(watch): D-2172/D-2173 — mint the ask, record it, hold the push

Eligibility is askActions and nothing else. The record is minted at hold time
with recordAlways+recordOnly, because pushOne records and pushes in one act."
```

---

## Task 7: The release sweep and the kill switch

**Files:**
- Modify: `server/src/watch.ts`
- Test: `server/test/asks-sweep.test.ts` (create)

**Interfaces:**
- Consumes: `heldAsks` (Task 6), `releaseAsk` (Task 5).
- Produces: `async sweepAsks(): Promise<void>`, `private lastAskSweep = 0`, `private asksDisabled = false`.

- [ ] **Step 1: Write the failing tests**

```typescript
it('fires the held payload verbatim once the window lapses', async () => {
  await w.tick();                                   // mints and holds
  expect(pushes.filter((p) => p.kind === 'ask')).toEqual([]);
  clock.advance(ASK_GRACE_MS + 1);
  await w.sweepAsks();
  const fired = pushes.filter((p) => p.kind === 'ask');
  expect(fired).toHaveLength(1);
  expect(fired[0]!.actions).toEqual(heldActions);   // the buttons survive the delay
  expect(store.askById(1)!.state).toBe('released');
});

it('never holds while $REG/asks-disabled is present', async () => {
  await io.writeFile(`${reg}/asks-disabled`, '');
  await w.tick();
  expect(pushes.filter((p) => p.kind === 'ask')).toHaveLength(1);
});

it('reads an unlistable registry as disabled, not as enabled', async () => {
  io.readdir = async () => null;
  await w.tick();
  expect(pushes.filter((p) => p.kind === 'ask')).toHaveLength(1);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-sweep.test.ts
```

Expected: FAIL — `sweepAsks` is not a function.

- [ ] **Step 3: Implement the sweep**

```typescript
  /** Fire every held ask whose grace window has lapsed. The payload is the one
   *  snapshotted at hold time and is pushed VERBATIM — `detectDialogs`'s two
   *  triggers are one-shot edges (`dialogIds` is stamped on first sighting
   *  regardless of whether the push was raised), so re-deriving it here would
   *  find nothing to re-raise. */
  async sweepAsks(): Promise<void> {
    if (!this.primed) return;
    const now = this.now();
    if (this.lastAskSweep !== 0 && now - this.lastAskSweep < ASK_SWEEP_MS) return;
    this.lastAskSweep = now;
    for (const [id, held] of [...this.heldAsks]) {
      if (held.until > now) continue;
      this.heldAsks.delete(id);
      if (this.deps.coord?.releaseAsk(held.askId, now) === false) continue;  // beaten
      this.pushOne(held.ev, this.activeProjects);
    }
  }
```

Register it in `tick()` beside the other sweeps, void-dispatched:

```typescript
    void this.sweepAsks().catch(() => { /* one bad sweep must not kill the poll */ });
```

Set `this.asksDisabled` from the SAME registry listing `sweepMail` already performs — `listing === null` (cannot tell) reads as **disabled**, the fail-shut rule the `mail-disabled` marker already follows.

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-sweep.test.ts test/watch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/watch.ts server/test/asks-sweep.test.ts
git commit -m "feat(watch): the release sweep and \$REG/asks-disabled

The window is a ceiling: a lapsed hold pushes the snapshotted payload verbatim,
buttons and all. An unlistable registry reads as disabled, never as enabled."
```

---

## Task 8: Staleness off `dialog_cleared`

**Files:**
- Modify: `server/src/watch.ts`
- Test: `server/test/asks-sweep.test.ts`

**Interfaces:**
- Consumes: `staleAsk` (Task 5), `heldAsks` (Task 6).
- Produces: nothing new; extends the existing clear branch.

- [ ] **Step 1: Write the failing test**

```typescript
it('marks a held ask stale when its dialog goes away unanswered', async () => {
  await w.tick();                       // mints and holds
  pane.clear();                         // operator hit escape at the terminal
  await w.tick();
  expect(store.askById(1)!.state).toBe('stale');
  expect(pushes.filter((p) => p.kind === 'ask')).toEqual([]);  // nothing to notify about
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-sweep.test.ts -t 'stale'
```

Expected: FAIL — state is still `held`.

- [ ] **Step 3: Extend the clear branch**

In `detectDialogs`'s `else if (last !== undefined)` arm — the one that already deletes `dialogIds`/`actionlessAsks` and emits `dialog_cleared` — drop the hold and settle the row:

```typescript
        // The pane is ground truth for whether a dialog is still live, and it
        // is the ONLY thing that is: `cmd_swap` does not rotate the uuid, so
        // hookstate's identity gate is blind to a swap and the file still reads
        // `waiting` behind a pane that is gone. This branch reads only what is
        // painted, which is why staleness rides it and not the hookstate.
        const held = this.heldAsks.get(r.id);
        if (held !== undefined) {
          this.heldAsks.delete(r.id);
          this.deps.coord?.staleAsk(last, r.id, now);
        }
```

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-sweep.test.ts test/asks-mint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/watch.ts server/test/asks-sweep.test.ts
git commit -m "feat(watch): a vanished dialog makes its held ask stale

Rides the existing dialog_cleared edge, which reads only what is painted — the
one signal a swap cannot lie to."
```

---

## Task 9: `POST /api/asks/:id/answer`

**Files:**
- Modify: `server/src/coord/routes.ts`
- Test: `server/test/asks-routes.test.ts` (create)

**Interfaces:**
- Consumes: `takeAskForAnswer`, `settleAsk` (Task 5); `answerAsk`, `AskRefuseCode` (Task 3).
- Produces: the route. Task 13 counts it as a lane; Task 17 names it in the skill corpus.

- [ ] **Step 1: Write the failing tests**

```typescript
it('401s without the box token', async () => { /* no x-ccrc-mail-token */ });
it('403s a caller that is not this ask\'s derived parent', async () => { /* fromId: 'someone-else' */ });
it('409s ask-moved when the child has repainted an identical question (D-2170)', async () => { /* … */ });
it('409s not-held when a second principal is already answering (D-2171)', async () => { /* … */ });
it('presses the digit and records a second event on success', async () => { /* … */ });
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-routes.test.ts
```

Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Implement the route**

`requireMailToken(req, …)` must appear literally inside this handler body — the census derives lanes by regex-slicing between route registrations, so a call routed through a wrapper is invisible to it.

```typescript
  app.post('/api/asks/:id/answer', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    if (!requireMailToken(req, reply, 'POST /api/asks/:id/answer')) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { fromId, fromUuid, optionIndexes } = body;
    // `optionIndexes`, never a singular `optionIndex`: under `askActions`
    // eligibility only single-select asks are ever held, so this array carries
    // one element today — and that is the point. A singular field is what
    // re-opens the multi-select commit hazard, silently, on the day someone
    // widens eligibility. The wire shape must not be the thing to remember.
    if (typeof fromId !== 'string' || typeof fromUuid !== 'string' ||
        !Array.isArray(optionIndexes) || !optionIndexes.every((n) => typeof n === 'number')) {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'fromId/fromUuid strings, optionIndexes an array of numbers' });
    }
    // The box token proves "a process on this box", one shared secret identical
    // for every session on the fleet host — it cannot prove "this ask's parent".
    // The registry pair is what attributes the specific session, exactly as the
    // mail ingress does.
    if (!(await requireAttribution(req, reply, fromId, fromUuid))) return;

    const id = Number((req.params as { id: string }).id);
    const ask = coord.askById(id);
    if (ask === null) return reply.code(404).send({ ok: false, error: 'unknown-ask' });
    if (ask.parentId !== fromId) {
      return reply.code(403).send({ ok: false, error: 'not-parent',
        detail: 'only this child\'s derived parent may pre-empt its question' });
    }

    // D-2170: re-read the child's hookstate and prove the menu on screen is the
    // INSTANCE this row was minted for. `askKey` hashes content, so a child
    // looping over N items regenerates it byte-for-byte; `updatedAt` is what
    // moves. Fails shut — a spurious refusal costs one push, a false pass
    // presses a digit into a question nobody read.
    const taken = coord.takeAskForAnswer(id, await freshAskAt(ask.childId));
    if (!taken.ok) return reply.code(409).send({ ok: false, error: taken.why });

    const res = await answerAsk(askDeps, ask.childId, ask.askKey, optionIndexes);
    if (!res.ok) { coord.releaseAsk(id, Date.now()); return reply.code(409).send(res); }
    coord.settleAsk(id, fromId, ask.options[optionIndexes[0]!] ?? '', Date.now());
    notifyAskAnswered(ask, fromId);       // D-2172's second record
    return { ok: true };
  });
```

`askDeps` currently lives in `server.ts`; thread it into `registerCoordRoutes`'s `deps` rather than rebuilding it, so both routes keep sharing the ONE per-session queue — `answerAsk`, `sendPrompt` and `answerDialog` must serialize through one lock per session, not independent ones.

`freshAskAt` reads the child's current hookstate and returns its `updatedAt`, or `-1` when the hookstate is unreadable. `-1` can never equal a stored `askAt`, so an unmeasurable hookstate refuses `ask-moved` rather than proceeding — the fail-shut direction, and the same "an unmeasurable answer is not a permissive one" posture the reclaim guard takes:

```typescript
    const freshAskAt = async (childId: string): Promise<number> => {
      const read = await readSessionRecord(deps.io, deps.cfg, childId);
      if (!read.found) return -1;
      const identity = measuredIdentity(read.record);
      if (identity === null) return -1;
      const hs = await readHookState(deps.io, deps.cfg.registryDir, childId, identity.uuid, Date.now());
      return hs === null ? -1 : hs.updatedAt;
    };
```

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/asks-routes.test.ts test/coord-pause-route.test.ts
```

Expected: PASS. `coord-pause-route` proves the new route joined neither `UNGATED` nor `SESSION_ONLY`.

- [ ] **Step 5: Commit**

```bash
git add server/src/coord/routes.ts server/test/asks-routes.test.ts
git commit -m "feat(coord): POST /api/asks/:id/answer — the parent presses the digit

Box token plus registry attribution, because one shared box secret cannot prove
which session is calling. Instance guard (D-2170) and row CAS (D-2171) both run
before answerAsk, which is unmodified."
```

---

## Task 10: `POST /api/asks/:id/release`

**Files:** Modify `server/src/coord/routes.ts`; test in `server/test/asks-routes.test.ts`.

**Interfaces:** Consumes `releaseAsk` (Task 5). Produces the decline verb that makes the grace window a ceiling rather than a tax.

- [ ] **Step 1: Write the failing test**

```typescript
it('fires the operator push immediately when the parent declines', async () => {
  await w.tick();
  await post(`/api/asks/1/release`, { fromId: 'coord-1', fromUuid: uuid });
  expect(pushes.filter((p) => p.kind === 'ask')).toHaveLength(1);
  expect(store.askById(1)!.state).toBe('released');
});
```

- [ ] **Step 2: Run it and watch it fail** — `cd server && ./node_modules/.bin/vitest run test/asks-routes.test.ts -t decline`. Expected: 404.

- [ ] **Step 3: Implement**

```typescript
  app.post('/api/asks/:id/release', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    // Literally inline, not through a wrapper: the census derives lanes by
    // regex-slicing this file between route registrations, so a gate call it
    // cannot see is a lane it will not count.
    if (!requireMailToken(req, reply, 'POST /api/asks/:id/release')) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { fromId, fromUuid } = body;
    if (typeof fromId !== 'string' || typeof fromUuid !== 'string') {
      return reply.code(400).send({ ok: false, error: 'bad-request',
        detail: 'fromId/fromUuid strings' });
    }
    if (!(await requireAttribution(req, reply, fromId, fromUuid))) return;

    const id = Number((req.params as { id: string }).id);
    const ask = coord.askById(id);
    if (ask === null) return reply.code(404).send({ ok: false, error: 'unknown-ask' });
    if (ask.parentId !== fromId) {
      return reply.code(403).send({ ok: false, error: 'not-parent',
        detail: 'only this child\'s derived parent may decline its question' });
    }
    // A decline is not a failure — it is the parent saying "the operator should
    // see this", and it is what makes the grace window a CEILING rather than a
    // tax on every ask the parent cannot rule on.
    if (!coord.releaseAsk(id, Date.now())) {
      return reply.code(409).send({ ok: false, error: 'not-held' });
    }
    deps.watcher?.releaseHeldAsk(ask.childId);
    return { ok: true };
  });
```

Add `releaseHeldAsk(childId: string): void` to `FleetWatcher`: it deletes the entry from `heldAsks` and calls `pushOne` with the snapshotted payload. Expose that method rather than letting a route reach into the map — the map is watcher-private state and the route has no business knowing its shape.

- [ ] **Step 4: Verify green** — `cd server && ./node_modules/.bin/vitest run test/asks-routes.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat(coord): POST /api/asks/:id/release — a decline fires the push now"`.

---

## Task 11: `GET /api/asks`

**Files:** Modify `server/src/coord/routes.ts`; test in `server/test/asks-routes.test.ts`.

**Interfaces:** Consumes `asksForParent` (Task 5). Produces the parent's cross-sibling read. **Corrected by
D-2310 (fix round 1):** Task 19's PWA chip does NOT consume this route — it reads `CoordStore` directly
inside `assembleFleet`. Post-D-2310 this route has zero PWA consumers; it remains available for any
later PWA list view.

- [ ] **Step 1: Write the failing test** — assert BOTH credentials work and that neither being present 401s:

```typescript
it('answers a fleet parent with the box token and the PWA with a cookie', async () => {
  expect((await get('/api/asks?parent=coord-1', { boxToken: true })).statusCode).toBe(200);
  expect((await get('/api/asks?parent=coord-1', { cookie: true })).statusCode).toBe(200);
  expect((await get('/api/asks?parent=coord-1', {})).statusCode).toBe(401);
});
```

- [ ] **Step 2: Run and watch it fail** — Expected: 404.

- [ ] **Step 3: Implement using the D-149 either-credential shape** — copy `GET /api/claims`'s block verbatim: `sessionAuth(req)` first, `checkMailToken` as the fallback, and a 401 body carrying `verdict` and a detail naming both options. Five shipped GETs already do this.

- [ ] **Step 4: Verify green** — `cd server && ./node_modules/.bin/vitest run test/asks-routes.test.ts test/auth-gate.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat(coord): GET /api/asks — either credential, never neither"`.

---

## Task 12: The operator's own answer closes the row (D-2171)

**Files:** Modify `server/src/server.ts` (`POST /api/sessions/:id/ask`); test in `server/test/asks-routes.test.ts`.

**Interfaces:** Consumes `takeAskForAnswer`, `settleAsk` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
it('records the operator as the answerer and locks the parent out', async () => {
  await w.tick();
  await post('/api/sessions/child-1/ask', { askKey: 'k', optionIndexes: [0] });
  expect(store.askById(1)!.answeredBy).toBe('operator');
  const parent = await post('/api/asks/1/answer', { fromId: 'coord-1', fromUuid: uuid, optionIndexes: [1] });
  expect(parent.statusCode).toBe(409);
});
```

- [ ] **Step 2: Run and watch it fail** — `answeredBy` is null; the parent's call succeeds and a SECOND digit is pressed.

- [ ] **Step 3: Implement** — before calling `answerAsk`, look up any `held` ask for this session and CAS it; on success, `settleAsk(..., 'operator', ...)` after the press. Do it in that order — the CAS is the mutex, so it must precede the keystroke. When there is no row (the parentless path, the overwhelming majority), behave exactly as today.

- [ ] **Step 4: Verify green** — `cd server && ./node_modules/.bin/vitest run test/asks-routes.test.ts test/ask-route.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "fix(server): the operator's answer takes the ask row too (D-2171)"`.

---

## Task 13: The census prose (D-2168)

**Files:** Modify `README.md`, `server/src/auth/gate.ts` (two passages), `server/test/auth-gate.test.ts`, `CLAUDE.md`.

**Interfaces:** Consumes Task 1's `SCAN_RE`. Depends on Tasks 9–11 having landed all three lanes.

- [ ] **Step 1: Measure the new counts rather than assuming them**

```bash
cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts
```

Expected: FAIL, naming the counts it derived. They should be **21** coord lanes and **22** all lanes. Use the numbers the failure prints, not the numbers in this plan.

- [ ] **Step 2: Rewrite each order-pinned passage, preserving its own order**

Each site states its two numbers in its own order; `expectNumerals` pins the sequence as well as the set. Keep every anchor phrase byte-identical — `passage()` slices on them and fails loudly if one moves.

| file | today | becomes |
|---|---|---|
| `README.md:535-539` | "the nineteen machine lanes … eighteen box-token-consulting coordination routes" | "the twenty-two machine lanes … twenty-one box-token-consulting coordination routes" |
| `server/src/auth/gate.ts:75-77` | "The eighteen box-token machine lanes … All nineteen CHECK" | "The twenty-one box-token machine lanes … All twenty-two CHECK" |
| `server/src/auth/gate.ts:675-676` | "the eighteen box-token machine lanes plus `/api/notify` — nineteen in all" | "the twenty-one box-token machine lanes plus `/api/notify` — twenty-two in all" |
| `server/test/auth-gate.test.ts:428` | "the eighteen box-token lanes in EXEMPT … and nineteen with notify" | "the twenty-one box-token lanes in EXEMPT … and twenty-two with notify" |

- [ ] **Step 3: Name the three routes in the CLAUDE.md bullet**

The bullet is checked by a DERIVED NAME check, not a numeral: every `requireMailToken` route outside `/api/mail*` and `/api/runs*` must appear as a backticked `VERB /path` span. Add to the existing list beside `POST /api/claims` and `GET /api/ledger`:

```
`POST /api/asks/:id/answer`, `POST /api/asks/:id/release` and `GET /api/asks`
```

- [ ] **Step 4: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts test/auth-gate.test.ts
```

Expected: PASS. A failure naming the right numbers in the wrong order means a sequence expectation needs reordering with the sentence, not the sentence rewriting.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md server/src/auth/gate.ts server/test/auth-gate.test.ts
git commit -m "docs: the box-token surface is twenty-one coordination lanes, twenty-two in all"
```

---

## Task 14: Rewrite worker clause 5

**Files:** Modify `ccd/worker-skill/SKILL.md`, `server/test/worker-skill.test.ts`.

The clause count does NOT move here — this is a rewrite in place, so `CONTRACT.length` stays 12 and the count-word and cross-corpus scans need no edit. Task 15 is what moves the count.

- [ ] **Step 1: Read the current text and the pin together**

```bash
sed -n '61,72p;82,86p;194,197p' ccd/worker-skill/SKILL.md
grep -n "AskUserQuestion" server/test/worker-skill.test.ts
```

Today clause 5 reads, verbatim at `ccd/worker-skill/SKILL.md:65`:

> Every question for the operator rides the AskUserQuestion tool — the structured ask the session hook captures and the PWA surfaces — never free text in your pane.

- [ ] **Step 2: Rewrite the clause in `SKILL.md`**

Straight apostrophes only — a curly one is a different byte and reds the pin without looking like an edit. No `"` character anywhere in a clause (D-104).

```
5. Every question rides the AskUserQuestion tool — the structured ask the session hook captures — never free text in your pane. If this session has a parent, that parent may answer it before the operator is notified; ask as if a colleague who has read the plan will answer, because one may.
```

- [ ] **Step 3: Update the elaboration and the recovery passage**

`SKILL.md:82-86` and `:194-197` both promise the ask "reaches a human who can act on it". Rewrite both to say what is now true: the ask reaches whoever can act on it first — a parent that can rule from the artifacts, or the operator — and free text still reaches nobody.

- [ ] **Step 4: Update `CONTRACT[4]` in `server/test/worker-skill.test.ts` to the new byte-for-byte string, then run**

```bash
cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts
```

Expected: PASS. A truncated 48-char preview in the failure means SKILL.md and the CONTRACT literal disagree byte-for-byte.

- [ ] **Step 5: Commit**

```bash
git add ccd/worker-skill/SKILL.md server/test/worker-skill.test.ts
git commit -m "docs(worker-skill): clause 5 says what is now true

An AskUserQuestion may be answered by this session's parent before the operator
sees it. Leaving the old bytes would have shipped a test-pinned falsehood at the
moment a worker relies on it."
```

---

## Task 15: The parent clause, in both skills

**Files:** Modify `ccd/worker-skill/SKILL.md`, `ccd/coordinator-skill/SKILL.md`, `server/test/worker-skill.test.ts`, `server/test/coordinator-skill.test.ts`, `README.md`, `CLAUDE.md`.

This is the clause that moves both counts: worker 12 → 13, coordinator 10 → 11. Said in BOTH deliberately — the precedent is the branch-discipline sentence, and R3 makes an ordinary worker the common parent, so a coordinator-only clause leaves the common case unwritten.

- [ ] **Step 1: Fix the index trap FIRST — nothing will flag it**

`server/test/worker-skill.test.ts:385` reads `const clause = CONTRACT[CONTRACT.length - 1]!;`, inside the describe that checks **clause 12**'s graphify freshness branching. Appending a thirteenth entry silently repoints it at the new clause, and its three tests then assert clause 12's properties against clause 13's unrelated text. Nothing else in the suite notices. Pin it to a fixed index before touching `CONTRACT`:

```typescript
  const clause = CONTRACT[11]!;   // clause 12, by index — NOT the last entry
```

- [ ] **Step 2: The exact count sites, all seven**

| file | line | today | becomes |
|---|---|---|---|
| `ccd/worker-skill/SKILL.md` | 52 | "These twelve clauses are the boundary" | thirteen |
| `ccd/worker-skill/SKILL.md` | 55 | "these twelve lines are pinned verbatim" | thirteen |
| `README.md` | 1171 | "twelve clauses pinned by" | thirteen |
| `README.md` | 1355 | "twelve clauses," | thirteen |
| `README.md` | 1596 | "now carries twelve clauses" | thirteen |
| `CLAUDE.md` | 199 | "twelve clauses pinned by" | thirteen |
| `server/test/worker-skill.test.ts` | 71 | `it('carries all twelve clauses verbatim'` | thirteen (cosmetic, not pinned) |

Coordinator side, ten → eleven: `ccd/coordinator-skill/SKILL.md:67` — note it says "These ten **sentences**", not "clauses" — plus `README.md:1352-1353` and `CLAUDE.md:193-194`.

The worker guard harvests `\b([a-z]+) (?:clauses|lines)\b`, so it enforces the SKILL.md pair and, via the `ccd/worker-skill/SKILL.md` marker scan, every README/CLAUDE mention. It cannot see the coordinator's "sentences" — Task 16's new guard must match that word too.

- [ ] **Step 3: Write the clause into both SKILL.md files — with DIFFERENT apostrophes**

The two corpora use different quoting and both are byte-pinned: **the worker skill uses straight `'`, the coordinator skill uses curly `’`.** The clause below contains two apostrophes (`child's`, `operator's`); getting them wrong reds the pin while looking like no edit at all. No `"` character anywhere in a clause (D-104).

Worker, numbered 13, straight apostrophes:

```
13. When a child of yours asks a question, you may answer it — POST /api/asks/:id/answer is the one route that does, and this session never types into another session's pane by any other means. Rule only from what you can read: the spec, the plan, the ledger, the branch, and your own prior rulings. You cannot see the child's reasoning, only its question. Anything that would be a NEW decision — product intent, scope, a tradeoff nobody ruled on, anything irreversible — is the operator's; decline it with POST /api/asks/:id/release so their notification fires at once rather than waiting out the window.
```

Coordinator, numbered 11, identical text with `’` for both apostrophes.

- [ ] **Step 4: Append each variant to its own `CONTRACT` array, then run both suites**

```bash
cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts test/coordinator-skill.test.ts
```

Expected: the worker suite RED on the count word and the numbering scan until Step 2's sites are all moved; the coordinator suite green (it has no count guard — that is Task 16, and this silence is exactly D-2175).

- [ ] **Step 5: Move every count site, re-run until green**

- [ ] **Step 6: Commit**

```bash
git add ccd/worker-skill/SKILL.md ccd/coordinator-skill/SKILL.md server/test README.md CLAUDE.md
git commit -m "docs(skills): the parent clause, said in both contracts

R3 makes an ordinary worker the common parent, so a coordinator-only clause
would leave the common case unwritten. Worker goes to thirteen, coordinator to
eleven."
```

---

## Task 16: The missing coordinator clause-count guard (D-2175)

**Files:** Modify `server/test/coordinator-skill.test.ts`.

**Measure it red before and after.** The guard's whole value is that it fires on an added clause, and the only proof is watching it.

- [ ] **Step 1: Copy `worker-skill.test.ts`'s numbering guard**

```bash
sed -n '88,135p' server/test/worker-skill.test.ts
```

Port it to the coordinator suite: harvest every `^\d+\. ` line from `SKILL.md`, assert the numbers equal `CONTRACT.map((_, i) => i + 1)`, and assert the count word in the skill's own prose matches `WORDS[CONTRACT.length]`.

**One deliberate difference from the worker's version.** The coordinator states its count as "These ten **sentences**" (`SKILL.md:67`), where the worker says "clauses"/"lines". Widen the harvest accordingly, and assert at least one hit so a reworded sentence reds as a wrong word rather than silently scanning nothing:

```typescript
    const stated = [...skill.matchAll(/\b([a-z]+) (?:clauses|lines|sentences)\b/g)]
      .map((m) => m[1]!).filter((w) => WORDS.includes(w));
    expect(stated.length, 'SKILL.md no longer states its own clause count in prose')
      .toBeGreaterThanOrEqual(1);
```

Also mirror the marker scan over `README.md` and `CLAUDE.md` for `ccd/coordinator-skill/SKILL.md` — the count sites are `README.md:1352-1353` and `CLAUDE.md:193-194`, and deriving them from the path rather than the line number is what makes a moved paragraph stay checked.

- [ ] **Step 2: Prove it reds — append a fake twelfth clause to `SKILL.md`, run, see it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected: FAIL on the numbering scan. **Before this task, that same edit was green** — that is D-2175.

- [ ] **Step 3: Remove the fake clause, run again**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/test/coordinator-skill.test.ts
git commit -m "test(coordinator-skill): D-2175 — a count guard, measured red

The CONTRACT loop is a toContain subset check, so an eleventh clause was
invisible. Verified by adding one and watching this red, then removing it."
```

---

## Task 17: Route parity in the coordinator corpus (D-2176)

**Files:** Modify `ccd/coordinator-skill/references/wave-lifecycle.md`.

Do NOT add these routes to `coordinator-skill.test.ts`'s EXEMPT set. That set is a blocklist of routes the coordinator must never be *taught about*, and every existing member is an operator-only door. A coordinator IS a parent and does call these — naming them is the truthful entry.

- [ ] **Step 1: Run the parity scan and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected: FAIL — the three `/api/asks` routes are registered in `coord/routes.ts` and named nowhere in the corpus.

- [ ] **Step 2: Write the ask-lane section into `wave-lifecycle.md`**

Name all three routes in `VERB /path` form (the harvest regex picks them up automatically), and state the three things a parent needs and cannot infer: the ask row is its entire evidentiary surface; a decline is not a failure and fires the operator's push at once; and an answer may be refused `ask-moved` because the child repainted an identical question, which is a reason to re-read rather than retry.

- [ ] **Step 3: Verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add ccd/coordinator-skill/references/wave-lifecycle.md
git commit -m "docs(coordinator-skill): D-2176 — name the ask routes, do not exempt them

EXEMPT is a blocklist of doors the coordinator must never be taught. It is a
parent and calls these, so naming them is the truthful entry."
```

---

## Task 18: The reconstruction drill

**Files:** Modify `server/test/reconstruction-drill.test.ts`.

- [ ] **Step 1: Add the `asks` entry to `UNRECOVERABLE` with its own justification and bump the count assertion (15 → 16)**

```typescript
  // asks: LOST, AND THE LOSS IS FREE (D-2169). There is no flat file behind this
  // table and deliberately so — the live pane carries the question and the
  // watcher's memory carries the deferred push, so a rebuilt db simply pushes
  // every ask immediately, which is the behaviour that shipped before the lane.
  // What is genuinely gone is the RECORD of which parent ruled what, and that is
  // why the record is also written to the feed at hold time.
  'asks',
```

- [ ] **Step 2: Run** — `cd server && ./node_modules/.bin/vitest run test/reconstruction-drill.test.ts`. Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -m "test(drill): asks is unrecoverable, and that loss is free (D-2169)"`.

---

## Task 19: The PWA chip

**Files:** Modify `shared/api.ts` (`FleetSession`, `reviveFleetSession`), `server/src/fleet.ts`, `pwa/src/**`, `pwa/test/**`.

**Interfaces:** ~~Consumes `GET /api/asks` (Task 11).~~ **Corrected by D-2310 (fix round 1):** the chip
is computed SERVER-SIDE in `assembleFleet`, reading `CoordStore` directly — never `GET /api/asks`. Every
other `FleetSession` field is computed in `assembleFleet`, and routing this one through an HTTP call to
the server's own route would be a new pattern for no gain. Additive field only — do NOT bump `FLEET_PROTO`.

- [ ] **Step 1: Write the failing PWA test** — a session carrying `ask: { state: 'held', parentId: 'coord-1' }` renders "held — coord-1 may answer"; one carrying `answered` by a parent renders "ruled by coord-1"; a session with no `ask` renders neither.

- [ ] **Step 2: Run and watch it fail** — `cd pwa && ./node_modules/.bin/vitest run test/<file>.test.tsx`.

- [ ] **Step 3: Add the field, revive it, render it** — add `ask?: { state: AskState; parentId: string }` to `FleetSession`, compute it in `assembleFleet`, and return it from `reviveFleetSession`'s literal so a new field is a compile error until every path computes it. The child's bucket is UNCHANGED — a held ask stays visible in the fleet view; only the notification was deferred. **Corrected — this branch falsified the declared shape:** the shipped field is `ask: { state: AskState; parentId: string; answeredBy: string | null } | null` (whole-branch review F1) — `answeredBy` was added because, without it, the chip attributed an answer the OPERATOR gave from their own phone to `parentId` instead, a false attribution on the one surface this lane exists to make honest (see `shared/api.ts`'s own `FleetSession.ask` docstring). The same field's `held` state is now also time-bounded — see D-2327.

- [ ] **Step 4: Verify green** — `cd pwa && ./node_modules/.bin/vitest run` and `cd server && ./node_modules/.bin/vitest run test/fleet-protocol.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat(pwa): a chip for a held or parent-ruled ask"`.

---

## Task 20: Serialize `cmd_swap` against the answer window (D-2177)

**Files:** Modify `server/src/server.ts` (the swap route), `server/src/inject/ask.ts`.

Pre-existing, surfaced by this lane. Land it last so it is reviewable on its own.

- [ ] **Step 1: Write the failing test** — a swap landing between `answerAsk`'s pane capture and its keystroke currently returns `ok: true` for a digit that never arrived.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Route the swap through the same per-session `KeyedQueue`** `answerAsk`/`sendPrompt`/`answerDialog` already share, and make `answerAsk` check `sendKey`'s return, downgrading a `false` to a typed refusal rather than reporting success.

- [ ] **Step 4: Verify green** — `cd server && ./node_modules/.bin/vitest run test/ask-route.test.ts test/send.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "fix(inject): D-2177 — a swap mid-answer is a refusal, not an ok:true"`.

---

## Final verification

- [ ] **All three suites, foreground, in full**

```bash
cd server && npm run test
cd agent  && npm run test
cd pwa    && npm run test
```

Re-run any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` in isolation before calling a failure real.

- [ ] **Confirm the ledger block landed** — `~/.local/bin/ccrc-api ledger list --project ccrc-pwa | grep -o '"n":21[6-7][0-9]' | sort -u` should show D-2168…D-2177 against this plan's path.

- [ ] **Deploy AGENT-FIRST** — `bash deploy/deploy.sh agent <host>` before `bash deploy/deploy.sh`, because Tasks 14–17 touch `ccd/*-skill/`. The server lane's final gate is `/health` reporting the shipped sha.

## Out of scope

**Case B — ad-hoc parenthood.** `parentOfSession` covers a dispatched program worker only. Nothing in the tree spawns a session from a session except dispatch, no code parses a `session:` actor, and `--actor` is unvalidated free text — so ad-hoc parenthood is three new things plus a new unauthenticated trust surface, and it gets its own spec section and its own plan.
