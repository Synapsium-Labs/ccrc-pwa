# program-leverage wave 6 — F6+F7a: the coordinator quiet window and the caps route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a coordinator idling AT a wave boundary a mail lane sized for that idling, put the two
coordination caps behind an operator dial instead of a sqlite editor, and replace three (measured: five)
prose claims about the box-token surface with a mechanism that derives the surface from its own call
sites.

**Architecture:** Three independent pieces on one branch. (1) `sweepMail` learns one new fact — is this
recipient the `claimedBy` of a non-terminal run — from one new synchronous `CoordStore` query, read once
per sweep, and selects between two named thresholds with it; workers and every other session are
untouched. (2) `POST /api/coord/caps` is an ordinary PWA-surface write (session-gated armed, open dark,
NOT box-token, NOT a D-282 release valve) over a new L1 policy module; its read half `GET
/api/coord/caps` exists because `capsUsage` reaches the PWA nowhere today. (3) A new scanner derives the
box-token surface from the `requireMailToken`/`checkMailToken` call sites across BOTH files that hold
them and asserts that no prose site under-claims it — and every prose site is corrected in the same
commit, because the scanner reds the build until they are.

**Tech Stack:** TypeScript (Node >= 22.13.0, `node:sqlite`), Fastify, vitest 4.1.10, React 19 + plain
global CSS. Four packages, run cd'd in: `server/` `agent/` `pwa/` `shared/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §8, on the ref
`origin/ws/brisk-meadow` (NOT on `main`). Program ledger:
`docs/superpowers/programs/program-leverage.md` on that same ref — its "Next-wave brief" section is this
wave's brief, and its wave-5 close record carries the two rulings folded in as item 3. Run 19, wave 6 of 8.

---

## Global Constraints

- **Branch discipline.** Commit on `ws/quiet-meadow`, this workspace's own branch, NEVER a feature
  branch. The done-fingerprint re-measures this branch's tip; work parked elsewhere wedges every close
  `stale-tip` forever.
- **NOT AGENT-FIRST.** Server + PWA + shared + root docs only. No `ccd/`, no `session-hook.sh`, no skill
  corpus. A finding that pushes into `ccd/coordinator-skill/` is MAILED to the coordinator before
  implementing — it changes the coordinator's deploy lane. (One such finding is already reported: D-1168.)
- **Wire discipline.** Additive-only fields; a single reader per field; an older peer omitting a field is
  tolerated; NO `FLEET_PROTO` bump (it stays 1); no new ccd verbs; `EXEC_COMMANDS` stays `['tmux','ccd']`.
- **No overloaded null at any new seam.** Two conditions a caller handles differently must not collapse
  to one value. Specifically: "no coordination database" ≠ "caps unreadable" ≠ "cap is zero"; "the write
  landed" ≠ "the answer was unreadable" ≠ "the request never happened".
- **TDD red-first, mutation-table discipline.** Every step that adds a guard is preceded by a step that
  measures it RED, with the **exact first failing assertion recorded verbatim** in that task's mutation
  table. Write the row THE MOMENT you measure it — wave 5 lost its whole record to a compaction between
  measuring and writing back, and the review, not the record, is what found the gap.
- **Every "behaviour unchanged" claim gets a fixture that could witness the change.** An absence
  assertion whose fixture cannot produce the presence is this program's recurring defect class; so is a
  pin whose premise (a hydrated store, a populated set) is never established. Wave 5 shipped one of each,
  and a third that was pinned by a green test whose title described a different situation.
- **Deviations.** This wave's block is `D-1157..1172`, allocated from `POST /api/ledger/deviations` at
  planning time (floor was 1157, is now 1173). Never invent, predict or reuse a number. Every number
  cited in the diff must be DEFINED in this plan's `## Deviations found` section in the same commit as
  (or before) the source comment citing it — `server/test/deviation-refs.test.ts:137-152` reds otherwise,
  and its `DEFINED` regex is `/^(?:#{2,4} |- \*\*)D-(\d+)\b/`, so an entry must be an H3/H4 heading or a
  `- **D-N**` bullet. Spell an unconsumed range with ONE prefix and a bare upper bound (`D-1157..1172`), never with a second `D-` on the upper bound: `floorFromScan` reads every tracked `D-<n>` as a REF, so writing the top of an unspent range as a ref seeds the fleet's floor there for ever.
- **Suites run in the FOREGROUND, `timeout 600000`, cd'd into the package**, tails READ not grepped.
  `./node_modules/.bin/vitest run` — NEVER bare `npx vitest` (it resolves a global copy with no jsdom and
  falsely reports "no tests"). All three packages are already installed; do not `npm ci`.
- **Node floor `>=22.13.0`** identical across the three engines. If `node-floor.test.ts`'s assertion 3 is
  red while 1-2 are green, RAISE engines — never lower them.
- No account-name list in any shipped source file. No secret file CONTENTS printed, ever.

---

## Execution order, and why it is not the task numbering's accident

| after | before | the edge |
|---|---|---|
| 1 | 2 | Task 2's sweep reads `openCoordinatorIds()`; the method must exist and be pinned first. |
| 3 | 5 | The route calls `decideCaps`; the pure decision is testable without a server and is measured first. |
| 4 | 5 | The route writes a `'coord'` feed event; the kind must exist in `shared/api.ts` and in the PWA's two total maps or task 5 does not typecheck. |
| 4 | 7 | The PWA's caps client reads `CoordCapsUsage`, minted in task 4. |
| 5 | 7 | The control cannot be written against a route that does not answer yet. |
| 8 | 9 | Both touch `coord/routes.ts`; task 8's census scanner reads that file's source, and task 9 changes two of its handlers. Landing 9 first would make 8's first red ambiguous. |
| — | 10 | Task 10 measures the whole branch and is last by construction. |

Tasks 2, 5+7, and 8+9 are three independent lanes. Within task 5 the route and the pins its EXISTENCE
moves are **one task on purpose**: `auth-gate.test.ts`'s five hand-pinned integers and
`coord-pause-route.test.ts`'s two-direction scan go red the instant the route is registered, and a
reviewer cannot approve the route while rejecting the count update. Splitting them would leave the branch
red between two commits.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `server/src/coord/store.ts` | Modify (~`:1234`, beside `openRunsForSession`) | Gains `openCoordinatorIds(): string[]` — the session ids that are the `claimedBy` of at least one non-terminal run. Synchronous, one statement, no hydration. |
| `server/src/watch.ts` | Modify (`:207` constants, `:2296+` cache, `:2325` + `:2597` gates) | Gains `COORD_QUIET_MS` / `COORD_COOLDOWN_MS` and one per-sweep coordinator set; the two existing gates select a threshold. |
| `server/src/coord/caps.ts` | **Create** | L1 pure policy: `CAP_MIN`, `CAP_MAX`, `decideCaps(current, body)` returning a typed union. No `fs`, no fastify, no `reply`. |
| `shared/api.ts` | Modify (`:2828`, `:2841`, `:3896`) | `NotifyEvent['kind']` gains `'coord'`; `NOTIFY_KINDS` follows; new `CoordCapsUsage` and `CoordCapsView` wire types beside `CoordCaps`. |
| `server/src/coord/routes.ts` | Modify (new routes after `:1281`; `:461-469` and `:1694-1702`) | Gains `GET`/`POST /api/coord/caps`; the two remaining `runId` body readers gain the lower bound. |
| `server/src/auth/gate.ts` | Modify (`:75-91`, `:663-664`) | Three stale count paragraphs corrected. EXEMPT is **not** touched — the caps routes are deliberately not exempt. |
| `pwa/src/lib/api.ts` | Modify (after `:649`) | Gains `coordCaps()` and `setCoordCaps(partial)`. |
| `pwa/src/fleet/CapsControl.tsx` | **Create** | The operator dial: reads caps+usage, renders usage vs cap, writes, settles on the response body. No timers. |
| `pwa/src/screens/RunsScreen.tsx` | Modify (`:594`) | Mounts `<CapsControl/>` immediately after `<CoordBanner/>`. |
| `pwa/src/fleet/fleet.css` | Modify (after `:2079`) | `.caps-control` and its parts, self-grounded, `var(--tap-min)` floors. |
| `pwa/src/screens/MailScreen.tsx` | Modify (`:43`, `:46`) | Two total `Record<NotifyEvent['kind'], …>` maps gain the `coord` entry. |
| `README.md` | Modify (`:529-531`, `:1405-1425`) | The two count/class claims corrected to the derived truth. |
| `CLAUDE.md` | Modify (`:10` only if the line count demands it) | The box-token bullet is **not reworded** — its opening anchor and the `D-282 (was D-B4-9)` token are both load-bearing. It gains a pin instead. |
| `server/test/coord-store.test.ts` | Modify | Pins `openCoordinatorIds` including the terminal-run and reclaim traps. |
| `server/test/mail-sweep.test.ts` | Modify | Pins both thresholds in BOTH directions. |
| `server/test/coord-caps-policy.test.ts` | **Create** | The L1 mutation table for `decideCaps`. |
| `server/test/coord-caps-route.test.ts` | **Create** | Route shape, posture, feed event, notConfigured, mutex, and the `setCaps`-has-exactly-one-caller pin. |
| `server/test/box-token-census.test.ts` | **Create** | Derives the surface from its call sites; asserts no prose site under-claims it. |
| `server/test/auth-gate.test.ts` | Modify (`:195-204`, `:401-441`, `:476`) | Five integers moved; the EIGHTEEN title corrected. |
| `server/test/coord-pause-route.test.ts` | Modify (`:160-235`) | Gains `SESSION_ONLY`, asserted disjoint from `UNGATED` in both directions. `UNGATED.size` stays 4, so no prose cardinal moves. |
| `server/test/run-routes.test.ts` | Modify | Two `runId` lower-bound cases. |
| `pwa/test/caps-control.test.tsx` | **Create** | The control's own unit tests. |
| `pwa/test/runs-screen.test.tsx` | Modify (`:469-501`) | DOM-order mount pin extended to the caps control. |
| `pwa/test/api.test.ts` | Modify | Fetch-level pins for both new client methods. |
| `pwa/test/tap-targets.test.tsx` | Modify (`:236-249`) | The new control joins the floored-rule loop. |
| `docs/superpowers/plans/2026-08-31-program-leverage-wave6-f6-f7a.md` | **Create** (this file) | The wave's plan, ledger and execution record. |

---

## Verified facts this plan is built on

Every premise below was measured in this worktree at `origin/main` = `6458a14d`. Anchors drift; step 1 of
each task re-confirms the ones it depends on and STOPS if one has moved.

| fact | anchor/command |
|---|---|
| `MAIL_QUIET_MS = 60_000`, one read site in all of `server/src` | `server/src/watch.ts:202`, read at `:2597` |
| `MAIL_COOLDOWN_MS = 120_000`, one read site in all of `server/src` | `server/src/watch.ts:207`, read at `:2325` |
| The cooldown gate is the FIRST statement inside the try/finally that holds `mailInFlight` | `server/src/watch.ts:2323-2325` |
| The not-quiet gate is the LAST rung before `seen.add` and `sendPrompt` | `server/src/watch.ts:2595-2597`, `:2603`, `:2649` |
| No `CoordStore` method answers "is X the `claimedBy` of a non-terminal run" | `openRunsForSession` keys on `sessionId` (`store.ts:1232`); `runs()` returns hydrated rows (`store.ts:1183`) |
| The tree's canonical non-terminal predicate is `state NOT IN ('done','failed')` | `store.ts:1187`, `:1195`, `:1232`, `:1285` |
| `reclaimProgram` rewrites `claimedBy` on EVERY run of a programme, terminal rows included | `store.ts:620-660`; `RunSummary.claimedBy` docstring, `shared/api.ts:3679-3691` |
| `MailGate` is a closed 13-member union with a total map and a total PWA phrase table | `shared/api.ts:3551-3568`; `pwa/src/session/MailStrip.tsx:93` |
| Four text-scanning guards police any new rung in `sweepMail` | `mail-sweep.test.ts:2243`, `:2265`, `:2305`; `lifecycle-sweep.test.ts:124` |
| `setCaps` has ZERO production callers; four test callers, all in one file | `store.ts:1357`; `run-routes.test.ts:251,281,312,1656`; `coord-store.test.ts:174` |
| `setCaps` does NO validation and returns `void`; `caps()` THROWS on the same missing row | `store.ts:1350-1361` |
| Migration 1 is FROZEN; `COORD_SCHEMA_VERSION` derives from `MIGRATIONS.length` | `coord/schema.ts:148-156`, `:686` |
| `capsUsage()` is an inline structural type with no name and no presence in `shared/api.ts` | `store.ts:1372` |
| `capsUsage` / `CoordCaps` / `maxConcurrentWorkers` appear ZERO times in `pwa/src` | `grep -rn 'capsUsage\|CoordCaps\|maxConcurrentWorkers' pwa/src` |
| `CoordStatus` carries exactly `{pause, mail}`; `emitCoord` touches no `node:sqlite` BY DESIGN | `shared/api.ts:2633`; `server/src/watch.ts:1024-1046` |
| The feed lane is a STORE WRITE; its one production caller is the PRIVATE `pushOne` | `store.ts:2161-2169`; `watch.ts:1225-1228` |
| `notifyLog.record()` mints `{seq, at}` and appends to the ring; it does NOT push | `server/src/notifylog.ts:54-59` |
| `NotifyEvent['kind']` is a closed six-token union with two total maps in the PWA | `shared/api.ts:2828`, `:2841`; `pwa/src/screens/MailScreen.tsx:43`, `:46` |
| The pause route has NO `notConfigured` arm, deliberately, because a pause is a file | `coord/routes.ts:1265-1269` |
| There is no `ccd coord-caps` verb, so the pause route's 501/502 spine has no analogue | `ccd/ccd:13453`; `server/src/ccdargv.ts:313` |
| `coord-pause-route.test.ts` direction-one: every `app.post` with no gate ahead of its first `await` must be in `UNGATED` | `coord-pause-route.test.ts:199-224` |
| `UNGATED` is a hand-written 4-element Set; what wave 5 derived is the COUNT and the ENUMERATIONS | `coord-pause-route.test.ts:177-180`; the derived count shipped in `ca711141`, NOT `5ff7c33c` (D-1157) |
| The derived-count scanner reads five prose passages and `CARD_RE` matches only CAPS `TWO..SEVEN` | `coord-pause-route.test.ts:325-336`, `:375-394` |
| `passage()` fails loudly on a missing anchor and on a slice under 300 chars | `coord-pause-route.test.ts:343-357` |
| Five hand-pinned integers move when a route is added: 46 / 23 / 69 / 66 / 42 | `auth-gate.test.ts:195`, `:200`, `:201`, `:204`, `:476` |
| The gate posture loop compares DARK against AUTHENTICATED, not dark against armed-anonymous | `auth-gate.test.ts` clause 3; `FLAG_AWARE` is declared and size-pinned to 8 |
| `auth-gate.test.ts:401` already derives the gated set from source, from `coord/routes.ts` ALONE | `auth-gate.test.ts:401-441` — an 18-name exact `toEqual`, plus `/api/notify` asserted separately |
| The derived truth: 18 token-consulting handlers in `coord/routes.ts` + `POST /api/notify` = 19 lanes | `coord/routes.ts` 11 × `requireMailToken` + 7 × inline `checkMailToken`; `server.ts:1280` |
| `POST /api/sessions/:id/kickoff` is a coordination WRITE with ZERO token checks, registered in `server.ts` | `server.ts:1487`, no `requireMailToken`/`checkMailToken` in `:1487-1600` |
| README's two stale sites | `README.md:529-531` ("the ten machine lanes … nine box-token-gated"), `README.md:1405-1425` ("the run routes", "None of these six routes") |
| A FOURTH stale site the ticket never named | `auth/gate.ts:75`, `:77`, `:80`, `:90`, `:663` — "SEVENTEEN"/"All eighteen" (D-1161) |
| `oss-metadata.test.ts` pins `CLAUDE.md:10`'s stated README size within 10% of the real count | `oss-metadata.test.ts:89-100`; README is 2033 lines, CLAUDE.md claims ~1931, upper edge ~2124 |
| README is already text-scanned by section slice; so is CLAUDE.md, by three suites | `readme-holds.test.ts:22-34`; `oss-metadata.test.ts`; `topology-clean.test.ts:459-469` |
| Only the kickoff `runId` reader carries `>= 1`; the two in `coord/routes.ts` accept 0 and negatives | `server.ts:1540-1543` (D-1151) vs `coord/routes.ts:461-469`, `:1694-1702` |
| Out-of-range `runId` is caught downstream as 404 `unknown-run`, not 400 | `coord/routes.ts:590-593`, `:1719-1721` |
| The pause control is a separate component mounted by ONE line, with a DOM-order mount pin | `pwa/src/fleet/CoordBanner.tsx`; `RunsScreen.tsx:594`; `runs-screen.test.tsx:469-501` |
| `post` resolves to `void`; `postJsonOr` (D-1150) keeps "answer unreadable" distinct from "request never happened" | `pwa/src/lib/api.ts:273-284`, `:288-326` |
| A component with its own `setInterval` breaks the screen's cadence pin | `runs-screen.test.tsx:801-829` |
| A new floored control must join the eighteen-rule loop and use `var(--tap-min)`, never `44px` | `tap-targets.test.tsx:236-249` |
| Live frames are CAST, not validated per-member; each new field needs its own tolerant reader | `pwa/src/stores/fleet.ts:150-179`; `shared/api.ts:206-230` |
| Suites: server 244 files, agent 18, pwa 76; all `node_modules` present; node v24.14.1 | `server/vitest.config.ts:84-93`; `node --version` |

---

## Task 1: the store learns who is coordinating something live

**Files:**
- Modify: `server/src/coord/store.ts` (beside `openRunsForSession`, `:1228-1240`)
- Test: `server/test/coord-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `openCoordinatorIds(): string[]` on `CoordStore` — every distinct non-null `claimedBy` of a
  run whose `state NOT IN ('done','failed')`. Synchronous. Order unspecified; the caller builds a `Set`.

`openRunsForSession` looks like the answer and is not: it selects on `sessionId`, the WORKER column
(`store.ts:1232`). The coordinator lives in `claimedBy`. `runs()` would work but hydrates every open run
— a `programs` JOIN and a `prLineage` JSON parse per row — which is exactly the cost `OpenSibling`'s own
docstring (`store.ts:53-57`) says this tree does not pay to answer a question that turns on a few
columns. One statement, no hydration (D-1160).

Two traps this method must not fall into, both measured: `reclaimProgram` rewrites `claimedBy` across
EVERY run of a programme including terminal ones (`store.ts:620-660`), so "this id appears in some
`claimedBy`" is NOT the fact wanted; and `resolveCoordinator` has no state predicate at all
(`store.ts:1545`), so it is not a model to copy here. Mirror `programOpenRunCount`'s predicate
(`store.ts:1285`) verbatim — the shipped SQL spelling, not a re-derivation from `RUN_TRANSITIONS`, which
disagrees about `'unknown'`.

- [ ] **1.1 — Re-confirm the anchors, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '1228,1240p' server/src/coord/store.ts     # openRunsForSession — the sibling to sit beside
sed -n '1282,1290p' server/src/coord/store.ts     # programOpenRunCount — the predicate to mirror
grep -n "state NOT IN ('done','failed')" server/src/coord/store.ts
```

Expected: `openRunsForSession` at :1228, `programOpenRunCount` at :1282, and four `NOT IN` sites.

- [ ] **1.2 — Write the failing tests.** Append to `server/test/coord-store.test.ts`, inside the existing
top-level describe. Use the file's own store-building helper (read the top of the file and copy the
idiom; do not invent a second one).

```ts
  describe('openCoordinatorIds', () => {
    it('names a session that is the claimedBy of a non-terminal run', () => {
      const s = freshStore();
      s.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8, project: 'proj',
        claimedBy: 'the-coordinator', now: 1 });
      expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
    });

    it('does NOT name a session whose only claimed run is terminal', () => {
      // The reclaim trap: `reclaimProgram` rewrites `claimedBy` on terminal rows
      // too, so "appears in some claimedBy" is not the fact this answers.
      const s = freshStore();
      const id = s.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8, project: 'proj',
        claimedBy: 'the-corpse', now: 1 });
      closeRunDone(s, id);                       // drive it to 'done' by the file's own helper
      expect(s.openCoordinatorIds()).toEqual([]);
    });

    it('does NOT name the WORKER — sessionId is not claimedBy', () => {
      // The direction openRunsForSession would have got wrong.
      const s = freshStore();
      const id = s.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8, project: 'proj',
        claimedBy: 'the-coordinator', now: 1 });
      s.markDispatched(id, 'the-worker', 'ws-1', 'ws/ws-1', 2);
      expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
    });

    it('names one coordinator once, however many open runs it holds', () => {
      const s = freshStore();
      for (const wave of [1, 2]) {
        s.openRun({ program: `p${wave}`, programTitle: 'P', wave, waveOf: 8, project: 'proj',
          claimedBy: 'the-coordinator', now: wave });
      }
      expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
    });

    it('is empty on a store with no runs at all', () => {
      expect(freshStore().openCoordinatorIds()).toEqual([]);
    });
  });
```

Adjust `freshStore()`/`closeRunDone()`/`openRun`'s exact argument shape to whatever
`server/test/coord-store.test.ts` already uses — read it first. The four assertions must survive that
adaptation unchanged in MEANING: present, terminal-excluded, worker-excluded, de-duplicated.

- [ ] **1.3 — Run them and record the red.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-store.test.ts`
Expected: FAIL — `s.openCoordinatorIds is not a function`. Record the first failing assertion verbatim in
this task's mutation table.

- [ ] **1.4 — Implement.** Insert immediately after `openRunsForSession`'s closing brace:

```ts
  /** The sessions COORDINATING something live: every distinct `claimedBy` of a
   *  run this build calls non-terminal. Not `openRunsForSession`'s question —
   *  that one keys on `sessionId`, the WORKER column, which is the opposite
   *  fact (D-1160).
   *
   *  Two columns, no JOIN and no `hydrateRun`, for `OpenSibling`'s stated
   *  reason (`:53-57`): dragging `prLineage` JSON and a `programs` join through
   *  a question that turns on one column is a cost this tree does not pay.
   *
   *  The predicate is `programOpenRunCount`'s (`:1285`), copied rather than
   *  re-derived. `RUN_TRANSITIONS` would answer differently — it gives `unknown`
   *  an empty target list, so a table-derived predicate would call an `unknown`
   *  row terminal while every shipped query calls it open. The SQL spelling is
   *  the one the rest of this file agrees with.
   *
   *  A row whose `claimedBy` was rewritten by `reclaimProgram` (`:620-660`) onto
   *  a TERMINAL run does not appear here, and must not: that rewrite touches
   *  every run of a programme, so appearing in some `claimedBy` is not evidence
   *  of coordinating anything live. */
  openCoordinatorIds(): string[] {
    return (this.db.prepare(
      'SELECT DISTINCT claimedBy FROM runs ' +
      "WHERE claimedBy IS NOT NULL AND state NOT IN ('done','failed')",
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }
```

- [ ] **1.5 — Run them and record the green.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-store.test.ts`
Expected: PASS, with the file's prior count plus 5.

- [ ] **1.6 — Measure the mutation table.** For each row: apply the mutation, run the command above,
record the **first failing assertion verbatim**, then revert from a working-tree snapshot and confirm
`git diff --stat` is clean before the next one.

  | mutation | first-fail assertion |
  |---|---|
  | drop `AND state NOT IN ('done','failed')` from the query | `AssertionError: expected [ 'the-corpse' ] to deeply equal []` ❯ the terminal-run test |
  | change `claimedBy` to `sessionId` in both the SELECT and the WHERE | `AssertionError: expected [] to deeply equal [ 'the-coordinator' ]` |
  | drop `DISTINCT` | `AssertionError: expected [ Array(2) ] to deeply equal [ 'the-coordinator' ]` |
  | drop `claimedBy IS NOT NULL` | **GREEN as written — hole. Closed, then:** `AssertionError: expected [ null ] to deeply equal []` ❯ `test/coord-store.test.ts:1875:36` |

  **The hole, named.** Every fixture in the first draft went through `openRun`, whose signature requires a
  `claimedBy: string` — so no row in the suite could ever carry a null and the guard could not be
  witnessed. A null `claimedBy` IS reachable: `reconstruct`'s disaster-recovery INSERT binds it (
  `store.ts:2406`) and rebuilds a NON-terminal wave, which is precisely the row the guard exists for.
  Closed with a fixture that establishes its own premise — the rebuilt run is asserted `working` and its
  `claimedBy` asserted null BEFORE the method is called — and re-measured red. Without it the method
  answers `[null]` typed `string[]`, a null wearing a session id's type, into a `Set` the mail lane then
  asks about.

- [ ] **1.7 — Commit.**

```bash
git add server/src/coord/store.ts server/test/coord-store.test.ts
git commit -m "feat(coord): the store can name the sessions coordinating something live (D-1160)"
```

---

## Task 2: the coordinator quiet window

**Files:**
- Modify: `server/src/watch.ts` (`:207` constants; `:2296+` the per-sweep set; `:2325` and `:2597` gates)
- Test: `server/test/mail-sweep.test.ts`

**Interfaces:**
- Consumes: `CoordStore.openCoordinatorIds(): string[]` from task 1.
- Produces: nothing importable — both constants are module-private, exactly like the pair they sit beside.

The lane's composed wake floor is ~60-74 s per event and at most one machine wake per ~2 minutes. That
is right for a worker mid-thought and wrong for a coordinator idling AT a wave boundary BY DESIGN,
because its own contract clause 7 mandates it end its turn and wait. The fix is one fact and two
thresholds; nothing else about the ladder changes.

**No new `MailGate` member, deliberately (D-1167).** `MailGate`'s docstring says one member per
CONDITION, not per `continue` — `no-pane` and `no-config-dir` were split because an operator acts on them
differently. Here the condition is identical (`this session has not been quiet long enough`) and the
operator's act is identical (wait). The union is also explicitly NOT a scheduling input: it exists so a
human can tell "waiting" from "wedged", and both thresholds are waiting. Adding `coord-not-quiet` would
cost a member, a total-map entry in `shared/api.ts` and a phrase in `MailStrip.tsx` to record a
distinction nobody acts on.

**Four text-scanning guards police this function** and each fails differently — re-read them before
editing: `mail-sweep.test.ts:2243` (every `MailGate` member has a literal `gated(d,'…')` call site and
vice versa, both directions), `:2265` (every pre-send `continue;` has a `gated(` in its OWN enclosing
block), `:2305` (no gate column in any WHERE/ORDER BY/GROUP BY/HAVING) and `lifecycle-sweep.test.ts:124`
(only three `/[Ll]ifecycle/` identifiers permitted inside `sweepMail`). This change adds no `continue`
and no gate token, so it should disturb none of them — which is a claim task 10 re-measures, not an
assumption.

- [ ] **2.1 — Re-confirm the anchors, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '196,208p'   server/src/watch.ts    # the two constants and their docstrings
sed -n '2294,2298p' server/src/watch.ts    # `const due = …` and the `due.length === 0` return
sed -n '2322,2326p' server/src/watch.ts    # the try + the cooldown gate
sed -n '2594,2598p' server/src/watch.ts    # readLiveState + not-idle + not-quiet
grep -c 'MAIL_QUIET_MS\|MAIL_COOLDOWN_MS' server/src/watch.ts
```

- [ ] **2.2 — Write the failing tests.** Append to `server/test/mail-sweep.test.ts`. The file redeclares
the lane constants locally at `:46-51` because no import path reaches them; add the two new ones the same
way, in the same block, and note in a comment that the mirror is a mirror.

```ts
const COORD_QUIET_MS = 15_000;      // mirrors watch.ts's own; see the note at :46
const COORD_COOLDOWN_MS = 30_000;
```

Then, in a new describe:

```ts
  describe('the coordinator quiet window', () => {
    /** Make ID the claimedBy of a NON-TERMINAL run — the one fact the sweep reads. */
    const seedCoordinatorRun = (coord: CoordStore): void => {
      coord.openRun({ program: 'program-leverage', programTitle: 'P', wave: 6, waveOf: 8,
        project: 'demo', claimedBy: ID, now: NOW });
    };

    it('delivers to a COORDINATOR inside MAIL_QUIET_MS, once COORD_QUIET_MS has passed', async () => {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      // Quiet for longer than COORD_QUIET_MS and SHORTER than MAIL_QUIET_MS —
      // the whole window this wave opens. A fixture that used a value outside
      // both would prove nothing about either.
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS + 1_000) });
      expect(NOW - (NOW - (COORD_QUIET_MS + 1_000))).toBeLessThan(MAIL_QUIET_MS);   // the fixture IS in the window
      seedCoordinatorRun(coord);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([NUDGE]);
    });

    it('does NOT deliver to a WORKER in that same window — the mutation direction', async () => {
      // Byte-identical to the test above except for the ONE fact: this session
      // is the run's `sessionId`, not its `claimedBy`. Without this half, a
      // guard that made the narrow window universal would pass.
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS + 1_000) });
      const runId = coord.openRun({ program: 'program-leverage', programTitle: 'P', wave: 6, waveOf: 8,
        project: 'demo', claimedBy: 'some-other-coordinator', now: NOW });
      coord.markDispatched(runId, ID, 'demo', 'ws/demo', NOW);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([]);
      expect(deliveryRow(coord, 1).lastGate).toBe('not-quiet');
    });

    it('still holds a COORDINATOR below COORD_QUIET_MS', async () => {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS - 5_000) });
      seedCoordinatorRun(coord);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([]);
      expect(deliveryRow(coord, 1).lastGate).toBe('not-quiet');
    });

    it('does NOT give the narrow window to a session whose only claimed run is TERMINAL', async () => {
      // The reclaim trap, at the lane. Task 1 pins it at the store; this pins
      // that the sweep actually reads the store's answer rather than a looser one.
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS + 1_000) });
      const runId = coord.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8,
        project: 'demo', claimedBy: ID, now: NOW });
      closeRunDone(coord, runId);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([]);
    });

    it('puts a COORDINATOR back on the lane after COORD_COOLDOWN_MS, and a worker not', async () => {
      // Two sessions, one sweep pair, one difference. The cooldown half of the
      // change, in both directions, in one fixture.
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000 });
      seedCoordinatorRun(coord);
      queueTestDelivery(coord, ID, ENVELOPE);
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([NUDGE]);

      // Past the coordinator cooldown, short of the worker one.
      advance(COORD_COOLDOWN_MS + 1_000);
      expect(COORD_COOLDOWN_MS + 1_000).toBeLessThan(MAIL_COOLDOWN_MS);
      seedLiveState(h.home, { statusUpdatedAt: Date.now() - MAIL_QUIET_MS - 1_000 });
      queueTestDelivery(coord, ID, ENVELOPE);
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]);
    });
  });
```

Two fixture rules this file enforces and these tests obey: `primedWatcher` runs BEFORE every `seed*`
call, and two `sweepMail()` calls in one test are separated by `advance(...)` past `MAIL_SWEEP_MS` — the
last test's `advance(COORD_COOLDOWN_MS + 1_000)` is 31 s, comfortably past the 10 s re-sweep gate.
Confirm `deliveryRow`, `closeRunDone`, `NUDGE` and `advance` exist with those names before relying on
them; adapt to the file's own spellings if not.

- [ ] **2.3 — Run them and record the red.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/mail-sweep.test.ts`
Expected: the coordinator tests FAIL (no delivery — the session is held at 60 s), the worker and
below-threshold tests PASS for the wrong reason. Record the first failing assertion verbatim.

- [ ] **2.4 — Add the two constants**, immediately after `MAIL_COOLDOWN_MS` at `:207`, in the same
docstring style as the pair above them (what it measures, where the number comes from, why it is not
re-derived):

```ts
/** The same two questions as `MAIL_QUIET_MS`/`MAIL_COOLDOWN_MS` above, asked of
 *  a COORDINATOR — a session whose id is the `claimedBy` of a non-terminal run.
 *
 *  The pair above is sized for a worker mid-thought: sixty seconds of measured
 *  idle before the lane may interrupt, and no second injection inside two
 *  minutes. A coordinator at a wave boundary is not mid-anything. Its own
 *  contract (clause 7, `ccd/coordinator-skill/SKILL.md`) MANDATES that it end
 *  its turn and wait, so the state the worker floor exists to protect is the
 *  state the coordinator is required to be in, and the floor becomes a delay
 *  with nothing behind it — measured at a minute-plus per wave event, on the
 *  session every other session is waiting for.
 *
 *  Fifteen seconds is still an idle floor, not an absence of one: it is read
 *  from the same `statusUpdatedAt` and answers the same question, so a
 *  coordinator genuinely mid-turn is still not interrupted. Thirty seconds of
 *  cooldown keeps `MAIL_COOLDOWN_MS`'s own promise — no fan-out arriving as a
 *  burst of prompts — at a boundary where two messages are a handoff, not a
 *  denial of service.
 *
 *  Workers and every other session read the pair above, untouched. */
const COORD_QUIET_MS = 15_000;
const COORD_COOLDOWN_MS = 30_000;
```

- [ ] **2.5 — Read the coordinator set once per sweep.** Immediately after `if (due.length === 0) return;`
(`:2297`):

```ts
    // ONE read per sweep, for every row in it — the same bargain `hsCache`
    // strikes one field over (`:2246`), and legitimate for the same reason: a
    // second read would carry this same `now`, so a cached answer is exactly as
    // fresh. Placed AFTER the `due.length === 0` return, so an idle box pays
    // nothing: no mail, no query.
    //
    // A `Set` built here rather than in the store, matching how `uuidByToId` and
    // `sessionProjects` are built from `records` — the store returns rows, the
    // sweep shapes them into what it will ask.
    const coordinators = new Set(store.openCoordinatorIds());
```

- [ ] **2.6 — Select the thresholds.** As the first statement inside the `try` at `:2323`, above
`const last`:

```ts
        // The one fact this rung adds. Read once per ROW from the per-sweep set
        // above, and consumed by exactly two gates below — the same two
        // conditions as before, at a threshold sized for the recipient.
        const isCoordinator = coordinators.has(d.toId);
```

Then change the cooldown gate at `:2325` and the not-quiet gate at `:2597` to select:

```ts
        if (now - last < (isCoordinator ? COORD_COOLDOWN_MS : MAIL_COOLDOWN_MS)) { gated(d, 'cooldown'); continue; }
```

```ts
        if (live.statusUpdatedAt === null ||
            now - live.statusUpdatedAt < (isCoordinator ? COORD_QUIET_MS : MAIL_QUIET_MS)) { gated(d, 'not-quiet'); continue; }
```

Each of the four constants keeps exactly ONE read site. Add a short comment above the not-quiet gate
recording why the gate TOKEN does not fork (D-1167): the condition and the operator's act are the same;
`MailGate` is not a scheduling input.

- [ ] **2.7 — Run and record the green.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/mail-sweep.test.ts`
Expected: PASS, prior count plus 5.

- [ ] **2.8 — Run the four guards that police this function.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/mail-sweep.test.ts test/lifecycle-sweep.test.ts test/deliverability-parity.test.ts
```
Expected: PASS. `deliverability-parity` is in the list because `peerDeliverable` mirrors only the
STRUCTURAL rungs and this change touches only TRANSIENT ones — a green run here is the fixture that
witnesses the claim "the peer surface is unaffected", not a comment asserting it.

- [ ] **2.9 — Measure the mutation table.** Command:
`cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/mail-sweep.test.ts`

  | mutation | first-fail assertion |
  |---|---|
  | revert the not-quiet gate to bare `MAIL_QUIET_MS` | `AssertionError: expected [] to deeply equal [ Array(1) ]` ❯ `:2433:35` (1 failed) |
  | invert the not-quiet ternary (`isCoordinator ? MAIL_QUIET_MS : COORD_QUIET_MS`) | `AssertionError: expected [ Array(1) ] to deeply equal []` ❯ `:434:35` (4 failed) |
  | make the narrow window universal (`COORD_QUIET_MS` with no ternary) | `AssertionError: expected [ Array(1) ] to deeply equal []` ❯ `:434:35` (3 failed) |
  | revert the cooldown gate to bare `MAIL_COOLDOWN_MS` | `AssertionError: expected [ Array(1) ] to deeply equal [ …(2) ]` ❯ `:2513:35` (1 failed) |
  | `coordinators` built from `records.map(r => r.id)` instead of the store | `AssertionError: expected [ Array(1) ] to deeply equal []` ❯ `:434:35` (4 failed) |
  | `COORD_QUIET_MS` raised to `60_000` (equal to the worker floor) | `AssertionError: expected [] to deeply equal [ Array(1) ]` ❯ `:2433:35` (1 failed) |

  6/6 red, no holes. Worth naming: three of the six first-fail at `:434`, which is NOT one of this
  wave's tests — it is the file's own pre-existing "does NOT deliver until the session has been quiet for
  `MAIL_QUIET_MS`". Every mutation that widens the window for everybody is caught by the worker pin that
  was already there, which is the strongest form this direction could take: the guard is held by a test
  written before the guard existed and with no knowledge of it.

- [ ] **2.10 — Commit.**

```bash
git add server/src/watch.ts server/test/mail-sweep.test.ts
git commit -m "feat(mail): a coordinator idling at a wave boundary gets a lane sized for it (D-1167)"
```

---

## Task 3: the caps decision, as a pure function

**Files:**
- Create: `server/src/coord/caps.ts`
- Test: `server/test/coord-caps-policy.test.ts`

**Interfaces:**
- Consumes: `CoordCaps` from `shared/api.ts`.
- Produces:
  - `export const CAP_MIN = 1;`
  - `export const CAP_MAX = 64;`
  - `export type CapsDecision = { ok: true; next: CoordCaps } | { ok: false; detail: string };`
  - `export function decideCaps(current: CoordCaps, body: unknown): CapsDecision;`

L1: a pure decision, no `fs`, no fastify, no `reply`. This follows `coord/ledger.ts`'s form (a named
ceiling plus a policy function that REFUSES, `ledger.ts:15`, `:45-47`) rather than a clamp — a clamp
would silently write a number the operator did not ask for, and `store.ts:397`'s clamp idiom is for LIMIT
arguments only, never for policy values.

`setCaps` itself validates NOTHING and returns `void` (D-1164): `0`, `-5`, `1.5` and `1e9` all persist
today. `maxConcurrentWorkers: 0` is a real wedge — `dispatch.ts:238` compares with `>=`, so zero refuses
EVERY dispatch, and unlike the pause marker there is no ungated door to undo it. Hence `CAP_MIN = 1`.

`CAP_MAX = 64` is a fat-finger ceiling, not a statement about fleet size: the box runs ~20 live sessions,
so 64 is far above any real setting and far below the range where `640` or `6400` could read as
deliberate. One ceiling serves both fields on `MAIL_QUIET_MS`'s own stated principle — two numbers for
one policy is two numbers to get out of step.

- [ ] **3.1 — Write the failing tests.** Create `server/test/coord-caps-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CAP_MAX, CAP_MIN, decideCaps } from '../src/coord/caps.js';
import type { CoordCaps } from '../../shared/api.js';

const CURRENT: CoordCaps = { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 };

describe('decideCaps', () => {
  it('takes a partial: an omitted field keeps its current value', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 5 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 } });
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 20 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 3, maxSessionsPerDay: 20 } });
  });

  it('takes both at once', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 } });
  });

  it('refuses a body that asks for nothing — a no-op write is a caller bug, not a write', () => {
    // Not an overloaded success: answering ok to a request that changes nothing
    // would make "the caps are now what you sent" and "you sent nothing" the
    // same 200.
    const r = decideCaps(CURRENT, {});
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ detail: expect.stringContaining('at least one of') });
  });

  it.each([
    ['zero workers — the wedge dispatch cannot undo', { maxConcurrentWorkers: 0 }],
    ['negative', { maxConcurrentWorkers: -1 }],
    ['fractional', { maxConcurrentWorkers: 1.5 }],
    ['above the ceiling', { maxConcurrentWorkers: CAP_MAX + 1 }],
    ['a numeric string', { maxConcurrentWorkers: '4' }],
    ['null', { maxConcurrentWorkers: null }],
    ['NaN', { maxConcurrentWorkers: Number.NaN }],
    ['Infinity', { maxConcurrentWorkers: Number.POSITIVE_INFINITY }],
    ['zero per day', { maxSessionsPerDay: 0 }],
    ['per day above the ceiling', { maxSessionsPerDay: CAP_MAX + 1 }],
    ['per day fractional', { maxSessionsPerDay: 2.5 }],
  ])('refuses %s', (_label, body) => {
    expect(decideCaps(CURRENT, body).ok).toBe(false);
  });

  it('accepts exactly the boundary values', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MIN, maxSessionsPerDay: CAP_MAX }).ok).toBe(true);
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MAX, maxSessionsPerDay: CAP_MIN }).ok).toBe(true);
  });

  it('refuses a non-object body without throwing', () => {
    for (const body of [null, undefined, 4, 'caps', []]) {
      expect(decideCaps(CURRENT, body).ok).toBe(false);
    }
  });

  it('ignores an unknown extra key rather than refusing over it', () => {
    // Additive tolerance: a newer client sending a third field must not be
    // refused by an older server, per the wire rule.
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSomethingElse: 9 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4, maxSessionsPerDay: 12 } });
  });

  it('names the offending field in the detail', () => {
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 0 }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('maxSessionsPerDay') });
  });
});
```

- [ ] **3.2 — Run and record the red.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-caps-policy.test.ts`
Expected: FAIL — cannot resolve `../src/coord/caps.js`. Record verbatim.

- [ ] **3.3 — Implement.** Create `server/src/coord/caps.ts`:

```ts
import type { CoordCaps } from '../../../shared/api.js';

/** L1. A pure decision about a caps write — no `fs`, no fastify, no `reply`.
 *
 *  `CoordStore.setCaps` validates NOTHING and returns `void` (`store.ts:1357`,
 *  D-1164): 0, -5, 1.5 and 1e9 all persist today, and nothing in the tree ever
 *  called it, so the absence never showed. This module is the check that has to
 *  exist before a route does.
 *
 *  It REFUSES rather than clamps, following `ledger.ts:45-47`. A clamp would
 *  write a number the operator did not ask for and answer 200, which is the
 *  same lie as a silent truncation. */

/** One is the floor, and the reason is a wedge rather than tidiness:
 *  `dispatch.ts:238` refuses on `usage.running >= caps.maxConcurrentWorkers`,
 *  so `0` refuses EVERY dispatch for ever — and unlike the pause marker, which
 *  has a deliberately ungated door precisely so a wedge keeps a release valve,
 *  a zeroed cap has none. */
export const CAP_MIN = 1;

/** A fat-finger ceiling, not a claim about fleet size. The box these caps
 *  govern runs about twenty live sessions, so sixty-four is far above any real
 *  setting and far below the range where `640` could read as deliberate. ONE
 *  ceiling for both fields, on `MAIL_QUIET_MS`'s own stated principle: two
 *  numbers for one policy is two numbers to get out of step. */
export const CAP_MAX = 64;

export type CapsDecision =
  | { ok: true; next: CoordCaps }
  | { ok: false; detail: string };

/** The full conjunction, and the lower bound is not optional — D-1151 is the
 *  recorded case of borrowing this shape one term short. */
const wellFormed = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= CAP_MIN && v <= CAP_MAX;

/** `body` is a PARTIAL: an omitted field keeps its current value. An unknown
 *  extra key is ignored, not refused — a newer client's third field must not be
 *  a 400 from an older server. */
export function decideCaps(current: CoordCaps, body: unknown): CapsDecision {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, detail: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const asked = (['maxConcurrentWorkers', 'maxSessionsPerDay'] as const)
    .filter((k) => b[k] !== undefined);
  if (asked.length === 0) {
    return { ok: false,
      detail: 'at least one of maxConcurrentWorkers or maxSessionsPerDay must be given' };
  }
  for (const k of asked) {
    if (!wellFormed(b[k])) {
      return { ok: false,
        detail: `${k} must be an integer between ${CAP_MIN} and ${CAP_MAX}` };
    }
  }
  return { ok: true, next: {
    maxConcurrentWorkers: asked.includes('maxConcurrentWorkers')
      ? b.maxConcurrentWorkers as number : current.maxConcurrentWorkers,
    maxSessionsPerDay: asked.includes('maxSessionsPerDay')
      ? b.maxSessionsPerDay as number : current.maxSessionsPerDay,
  } };
}
```

Confirm the relative import depth against a sibling (`coord/ledger.ts`'s own import of `shared/api.js`)
and match it — do not guess the number of `../`.

- [ ] **3.4 — Run and record the green.** Expected: PASS, 8 tests (the `it.each` counts 11).

- [ ] **3.5 — Measure the mutation table.** Command:
`cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-caps-policy.test.ts`

  | mutation | first-fail assertion |
  |---|---|
  | drop `&& v >= CAP_MIN` from `wellFormed` | `AssertionError: expected true to be false // Object.is equality` (5 failed) |
  | drop `&& v <= CAP_MAX` | `AssertionError: expected true to be false // Object.is equality` (2 failed) |
  | drop `Number.isInteger(v)` | `AssertionError: expected true to be false // Object.is equality` (2 failed) |
  | drop the `asked.length === 0` refusal | `AssertionError: expected true to be false // Object.is equality` (1 failed) |
  | refuse on an unknown extra key instead of ignoring it | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, next: { …(2) } }` |
  | `CAP_MIN` lowered to 0 | `AssertionError: expected true to be false // Object.is equality` (4 failed) |
  | drop the `Array.isArray(body)` arm | **GREEN as written — hole. Closed, then:** `AssertionError: body []: expected { ok: false, …(1) } to deeply equal { ok: false, …(1) }` (2 failed) |
  | drop the `typeof body !== 'object'` arm | *(added while closing the row above)* `TypeError: Cannot read properties of undefined (reading 'maxConcurrentWorkers')` ❯ `:64:14` |
  | drop the `body === null` arm | *(added while closing the row above)* `TypeError: Cannot read properties of null (reading 'maxConcurrentWorkers')` ❯ `:64:14` |

  **The second hole, named.** The shape guard has three arms and the first draft's test asserted only
  `ok === false`. Every non-object body ALSO has no settable field, so all three arms' cases fall through
  to the asks-for-nothing refusal and still answer `ok:false` — the guard was unwitnessed, the same
  absence-assertion-whose-fixture-cannot-produce-the-presence class this program has now hit twice in two
  tasks. What the arms actually decide is the DETAIL: a caller who posted `4` should be told the body is
  not an object, not that it is missing a field — true and useless. Closed by asserting the whole refusal
  object rather than its `ok` flag, which also made the two neighbouring arms witnessable; both were then
  measured and are recorded above. Note that dropping the null arm does not merely mis-word a refusal, it
  THROWS — a 500 on a body a client can trivially send.

- [ ] **3.6 — Commit.**

```bash
git add server/src/coord/caps.ts server/test/coord-caps-policy.test.ts
git commit -m "feat(coord): a pure decision for a caps write, refusing where setCaps never did (D-1164)"
```

---

## Task 4: the wire learns a coordination-config event and a usage shape

**Files:**
- Modify: `shared/api.ts` (`:2828`, `:2841`, beside `:3896`), `server/src/coord/schema.ts:210` (the DDL
  comment naming the vocabulary), `pwa/src/screens/MailScreen.tsx:43,46`
- Test: `server/test/coord-store.test.ts` (feed round-trip), `pwa/test/` (whichever file already pins
  `KIND_WORD`/`KIND_GLYPH`; find it before writing)

**Interfaces:**
- Produces:
  - `NotifyEvent['kind']` gains `'coord'`.
  - `export interface CoordCapsUsage { running: number; dispatchedIn24h: number }`
  - `export interface CoordCapsView { caps: CoordCaps; usage: CoordCapsUsage }`

A caps change is not a run event (`recordRunEvent` writes `fromState === toState` and `pushNewRuns`
explicitly SKIPS those, `watch.ts:1125` — the row would land and be seen by nobody), and it is not any of
`ask|done|merged|mail|run` (D-1163). `'run'` would be the closest and would be a lie: there is no run.
The seventh member is additive and an older PWA already degrades an unrecognised kind to `'unknown'`
through `isNotifyKind` — the designed degradation, not a new one. `'unknown'` stays what it always was:
the client-side member the server never writes.

`capsUsage()`'s return is an inline structural type today with no name anywhere; the PWA needs it, so it
gets one.

- [ ] **4.1 — Find the PWA's kind pins before editing.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '38,50p' pwa/src/screens/MailScreen.tsx
grep -rn "KIND_WORD\|KIND_GLYPH\|isNotifyKind\|NOTIFY_KINDS" pwa/src pwa/test server/test shared | grep -v node_modules
```

- [ ] **4.2 — Write the failing tests.** Two, in the files the grep above names.

Server side, appended to `server/test/coord-store.test.ts`:

```ts
  it('round-trips a coord feed event through the durable table', () => {
    // The absence half matters: before this member existed, `feedEvents` read a
    // 'coord' row back as 'unknown' — so a fixture that only asserted the row
    // lands would have passed against the defect.
    const s = freshStore();
    s.recordFeedEvent('epoch-1', { seq: 1, at: 10, kind: 'coord', sessionId: '',
      title: 'caps', body: 'workers 3 → 5' });
    const [ev] = s.feedEvents(10);
    expect(ev).toMatchObject({ kind: 'coord', title: 'caps' });
  });
```

PWA side, in the file that pins the kind tables (add one if none exists, named for that file's
convention):

```ts
  it('has a word and a glyph for every NotifyEvent kind, coord included', () => {
    for (const k of ['ask', 'done', 'merged', 'mail', 'run', 'coord', 'unknown'] as const) {
      expect(KIND_WORD[k], `no word for ${k}`).toBeTruthy();
      expect(KIND_GLYPH[k], `no glyph for ${k}`).toBeTruthy();
    }
  });
```

- [ ] **4.3 — Run both and record the reds.**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/<the file>
```
Expected: a TS error on `kind: 'coord'` and a failing lookup. Record verbatim.

- [ ] **4.4 — Implement.** In `shared/api.ts`:

```ts
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'coord' | 'unknown';
```

```ts
const NOTIFY_KINDS: readonly NotifyEvent['kind'][] = ['ask', 'done', 'merged', 'mail', 'run', 'coord', 'unknown'];
```

with a docstring line on the union recording why `'coord'` is not `'run'` (D-1163). Update the DDL
comment at `server/src/coord/schema.ts:210` to name the vocabulary as it now stands — the comment, not
the frozen migration body. Then, beside `CoordCaps` at `shared/api.ts:3896`:

```ts
/** The two counts `CoordStore.capsUsage` derives from `runs` — never stored
 *  beside the limits, for the reason its own docstring gives. Named here
 *  because the operator dial ships them to the PWA (D-1158); before that they
 *  had no consumer outside `dispatchRun` and so no name. */
export interface CoordCapsUsage { running: number; dispatchedIn24h: number }

/** What `GET`/`POST /api/coord/caps` answer. Limits and usage travel TOGETHER:
 *  a cap without its count is a number the operator cannot act on. */
export interface CoordCapsView { caps: CoordCaps; usage: CoordCapsUsage }
```

Add the `coord` entries to `MailScreen.tsx`'s two total maps.

- [ ] **4.5 — Run both and record the green.**

- [ ] **4.6 — Measure the mutation table.**

  | mutation | first-fail assertion |
  |---|---|
  | remove `'coord'` from `NOTIFY_KINDS` but leave it in the union | `AssertionError: expected [ { seq: 1, at: 10, …(4) } ] to deeply equal [ { seq: 1, at: 10, …(4) } ]` (the row reads back `unknown`) |
  | remove the `coord` entry from `KIND_GLYPH` | `AssertionError: no glyph for coord: expected '' to be '⚙'` ❯ `mail-screen.test.tsx:235:88` |
  | remove the `coord` entry from `KIND_WORD` | `AssertionError: no word for coord: expected '⚙' to contain 'config'` |

  **A third hole, named — and it is the same class as the other two.** The PWA test's first draft
  asserted `container.textContent).not.toContain('undefined')`, on the reasoning that a total map with a
  missing entry yields `undefined`. It does at the TYPE level; at RUNTIME React renders `undefined` as
  NOTHING, never as the string. The test passed against the unimplemented feature. Closed by asserting
  the rendered glyph and word themselves, and by giving the fixture a title that carries no glyph of its
  own so the glyph assertion cannot be satisfied by the title. Three for three: every hole this wave has
  found so far is an absence assertion whose fixture could not produce the presence.

  **The frozen migration was NOT edited.** `coord/schema.ts:210`'s column comment enumerates the
  vocabulary as it stood at `user_version` 1, and migration 1 is frozen — its bytes are history, and
  sqlite stores the original `CREATE TABLE` text, so editing it would make a fresh database's
  `sqlite_master` disagree with every existing one for a comment. The file HEADER, which that comment
  already defers to ("see this file's header"), now says the enumeration is a v1 snapshot and names
  `shared/api.ts` as the live list.

- [ ] **4.7 — Commit.**

```bash
git add shared/api.ts server/src/coord/schema.ts pwa/src/screens/MailScreen.tsx server/test/coord-store.test.ts pwa/test
git commit -m "feat(wire): a feed kind for a coordination-config change, and a name for capsUsage (D-1163, D-1158)"
```

---

## Task 5: the caps door, and every pin its existence moves

**Files:**
- Modify: `server/src/coord/routes.ts` (new routes after `:1281`)
- Modify: `server/test/auth-gate.test.ts` (`:195-204`, `:476`)
- Modify: `server/test/coord-pause-route.test.ts` (`:160-235`)
- Test: `server/test/coord-caps-route.test.ts` (**create**)

**Interfaces:**
- Consumes: `decideCaps`, `CAP_MIN`, `CAP_MAX` (task 3); `CoordCapsView` (task 4); `CoordStore.caps()`,
  `setCaps()`, `capsUsage()`, `recordFeedEvent()`; `NotifyLog.record()` / `.epoch`.
- Produces: `GET /api/coord/caps` → `200 {ok:true, caps, usage}`; `POST /api/coord/caps` → `200 {ok:true,
  caps, usage}` on success, `400 {ok:false, error:'bad-request', detail}` on a refused body, `501
  {ok:false, error:'not-configured'}` with no coordination database.

**This task cannot be split, and that is a measured fact rather than a preference.** The instant
`app.post('/api/coord/caps')` is registered, `coord-pause-route.test.ts`'s direction-one goes red (a POST
with no box-token gate that is not in `UNGATED`) and four hand-pinned integers in `auth-gate.test.ts` go
stale. A reviewer cannot approve the route while rejecting those edits; landing them apart leaves the
branch red between two commits.

**Posture, stated before it is built.** NOT box-token: this is an operator dial, not a machine lane — the
fleet host never posts to it and has no reason to. NOT `UNGATED`: `UNGATED` is the D-282 family, whose
whole argument is that the party locked out is the party holding the key, so a wedge's release valve must
not sit behind it. Raising a cap releases no wedge. Session-gated when armed (so NOT in `EXEMPT`), open
dark — the same posture as every other same-origin PWA write.

Those two facts cannot both be asserted with the vocabulary the tree has (D-1159): direction-one equates
"no box-token gate" with "member of `UNGATED`", which held only because the four D-282 doors were the
only ungated POSTs in the file. The fix is a SECOND named set with its own argument, asserted disjoint
from `UNGATED` in both directions. `UNGATED.size` stays 4, so no prose cardinal anywhere moves.

**Why a GET (D-1158).** The brief's "capsUsage is already computed" is true server-side and irrelevant to
the PWA: `capsUsage`, `CoordCaps` and `maxConcurrentWorkers` occur zero times in `pwa/src`, `CoordStatus`
carries only `{pause, mail}`, and no route reads either. Caps must NOT be bolted onto the `{type:'coord'}`
frame: `emitCoord`'s docstring says it needs no try/catch precisely because it touches no `node:sqlite`,
and `dispatchedIn24h` drifts with the clock, so the byte-equality guard would let it re-emit on nearly
every 2 s tick.

**Why the route needs a `notConfigured` arm the pause route omits (D-1166).** Pause is a marker FILE on
the fleet host, so a box with no coordination database can still be paused and answering 501 would be a
lie about what the act needs. Caps live in `coord.db`. Copying pause's opening lines verbatim ships a
route that throws on such a box, because `caps()` casts an undefined row rather than returning null.

- [ ] **5.1 — Re-confirm the anchors, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '1233,1282p' server/src/coord/routes.ts   # the pause docstring + handler
sed -n '249,275p'   server/src/coord/routes.ts   # registration signature, notConfigured, coordMutex
sed -n '176,224p'   server/test/coord-pause-route.test.ts
sed -n '193,205p'   server/test/auth-gate.test.ts
grep -n 'notifyLog' server/src/server.ts | head
```

- [ ] **5.2 — Write the failing route tests.** Create `server/test/coord-caps-route.test.ts`. Build the
app with whatever helper `run-routes.test.ts` uses (read its top and copy it; do not invent a second
harness).

```ts
describe('GET /api/coord/caps', () => {
  it('answers the stored limits and the derived usage', async () => {
    const { app, coord } = await appWithCoord();
    coord.setCaps({ maxConcurrentWorkers: 4, maxSessionsPerDay: 16 });
    const res = await app.inject({ method: 'GET', url: '/api/coord/caps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true,
      caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 },
      usage: { running: 0, dispatchedIn24h: 0 } });
  });

  it('answers 501 not-configured on a box with no coordination database', async () => {
    const { app } = await appWithoutCoord();
    const res = await app.inject({ method: 'GET', url: '/api/coord/caps' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('reports usage that a dispatched run actually moved', async () => {
    // The fixture that could witness the change: without it, `running: 0` above
    // is satisfied by a query that always answers zero.
    const { app, coord } = await appWithCoord();
    const id = coord.openRun({ /* …the file's own shape… */ });
    coord.markDispatched(id, 'w', 'ws', 'ws/ws', Date.now());
    const res = await app.inject({ method: 'GET', url: '/api/coord/caps' });
    expect(res.json().usage).toMatchObject({ running: 1, dispatchedIn24h: 1 });
  });
});

describe('POST /api/coord/caps', () => {
  it('writes a partial and answers the stored result', async () => {
    const { app, coord } = await appWithCoord();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxConcurrentWorkers: 5 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().caps).toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 12 });
    // …and it really landed in the store, not merely in the reply.
    expect(coord.caps()).toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 12 });
  });

  it('refuses a bad body with the policy detail, and writes NOTHING', async () => {
    const { app, coord } = await appWithCoord();
    const before = coord.caps();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxConcurrentWorkers: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request',
      detail: expect.stringContaining('maxConcurrentWorkers') });
    expect(coord.caps()).toEqual(before);
  });

  it('answers 501 not-configured on a box with no coordination database', async () => {
    const { app } = await appWithoutCoord();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxConcurrentWorkers: 5 } });
    expect(res.statusCode).toBe(501);
  });

  it('records a coord feed event naming both the old and the new value', async () => {
    const { app, coord } = await appWithCoord();
    await app.inject({ method: 'POST', url: '/api/coord/caps', payload: { maxConcurrentWorkers: 5 } });
    const ev = coord.feedEvents(10).at(-1);
    expect(ev).toMatchObject({ kind: 'coord' });
    expect(ev!.body).toContain('3');
    expect(ev!.body).toContain('5');
  });

  it('records NO feed event when the body is refused', async () => {
    const { app, coord } = await appWithCoord();
    const before = coord.feedEvents(10).length;
    await app.inject({ method: 'POST', url: '/api/coord/caps', payload: { maxConcurrentWorkers: 0 } });
    expect(coord.feedEvents(10).length).toBe(before);
  });

  it('still writes the caps when there is no notify log to record into', async () => {
    // The seam: a missing NotifyLog degrades the RECORD, never the write. The
    // opposite collapse — refusing the operator's write because the feed is
    // unavailable — is the one this asserts against.
    const { app, coord } = await appWithCoord({ notifyLog: undefined });
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxSessionsPerDay: 20 } });
    expect(res.statusCode).toBe(200);
    expect(coord.caps().maxSessionsPerDay).toBe(20);
  });
});

describe('the caps door is exactly one caller of setCaps', () => {
  it('setCaps has exactly one call site in server/src, and it is the caps route', () => {
    // Wave 5's lesson: a negative assertion needs a positive floor, or a regex
    // that stopped matching satisfies it vacuously.
    const files = walkSource(path.join(__dirname, '..', 'src'));
    expect(files.length, 'the source walk found nothing — this scan is over nothing')
      .toBeGreaterThan(30);
    const callers = files.flatMap(({ file, text }) =>
      [...blankCommentsAndStrings(text).matchAll(/\bsetCaps\s*\(/g)].map(() => file));
    expect(callers).toEqual(['coord/routes.ts']);
  });
});
```

`blankCommentsAndStrings` and `walkSource` already exist in this tree — find them
(`dispatch-mutex-gate.test.ts`, `resume-reclaim-l0.test.ts`) and import or copy the exact helpers rather
than writing a third. A bare `/\bsetCaps\s*\(/` also matches the declaration and every comment; the
declaration lives in `store.ts`, so an unblanked scan would report two callers and the fix would be a
narrowed regex — the failure mode this tree names by name.

- [ ] **5.3 — Run and record the red.** Expected: 404s for both routes (unregistered) and a `setCaps`
caller list of `[]`. Record the first failing assertion verbatim.

- [ ] **5.4 — Implement the routes**, immediately after the pause handler at `:1281`. Docstring first —
it carries the posture argument, and a reviewer reads it before the code:

```ts
  /** `GET`/`POST /api/coord/caps` — the two coordination caps become an OPERATOR
   *  DIAL. Before this, `CoordStore.setCaps` had no caller anywhere in
   *  `server/src`: the only way to change `maxConcurrentWorkers` or
   *  `maxSessionsPerDay` was to edit `coord.db` by hand.
   *
   *  NOT BOX-TOKEN, AND NOT `UNGATED` EITHER — the two are different facts and
   *  this route is the first in the tree to need them apart (D-1159). The box
   *  token gates MACHINE lanes: callers on the fleet host with no cookie jar.
   *  An operator turning a dial in the PWA is not one, and gating this on the
   *  fleet's shared secret would put a phone control behind a secret the phone
   *  does not hold. Nor is it a release valve: `UNGATED`'s whole argument
   *  (D-282) is that the party locked out is the party holding the key, so a
   *  wedge's valve must not sit behind it — and raising a cap releases no
   *  wedge. It is an ordinary same-origin PWA write: session-gated when armed
   *  (deliberately absent from `auth/gate.ts`'s EXEMPT table), open dark, like
   *  every other write the console makes.
   *
   *  THE `notConfigured` ARM THE PAUSE ROUTE ABOVE DELIBERATELY OMITS (D-1166).
   *  A pause is a marker file on the fleet host, so a box with no coordination
   *  database can still be paused. Caps are rows in `coord.db`, and `caps()`
   *  casts an undefined row rather than returning null — copying the pause
   *  handler's opening verbatim would ship a route that throws on such a box.
   *
   *  THE READ HALF EXISTS BECAUSE NOTHING ELSE CARRIES THESE NUMBERS (D-1158).
   *  `capsUsage` is computed server-side and reaches the PWA nowhere;
   *  `CoordStatus` carries `pause` and `mail` and no numbers. Caps are NOT
   *  added to that frame: `emitCoord` states it needs no try/catch because it
   *  touches no `node:sqlite`, and `dispatchedIn24h` moves with the clock, so
   *  the frame's byte-equality guard would let it re-emit on nearly every tick.
   *  Limits and usage travel together — a cap without its count is a number the
   *  operator cannot act on.
   *
   *  THE REPLY IS THE CONFIRMATION, unlike the pause toggle one door up. That
   *  toggle refuses to be optimistic because a `{type:'coord'}` frame exists to
   *  settle it; no frame carries caps, so the honest answer is the stored value
   *  re-read after the write, and the control settles on that. */
  app.get('/api/coord/caps', async (_req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    return reply.code(200).send({ ok: true, caps: coord.caps(), usage: coord.capsUsage() });
  });

  app.post('/api/coord/caps', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    // The DECISION is L1 and runs before the mutex: a malformed body is decided
    // by this request alone, and queueing it behind a live dispatch would make
    // the answer depend on the fleet's weather (the reclaim route's own rule).
    const before = coord.caps();
    const decided = decideCaps(before, req.body ?? {});
    if (!decided.ok) {
      return reply.code(400).send({ ok: false, error: 'bad-request', detail: decided.detail });
    }
    // …and the WRITE is serialised, because `dispatchRun` reads `caps()` and
    // `capsUsage()` across await boundaries (`dispatch.ts:236-237`) — the exact
    // race `CoordMutex` exists for.
    const view = await coordMutex.run(() => {
      coord.setCaps(decided.next);
      return { caps: coord.caps(), usage: coord.capsUsage() };
    });
    // A `run_events` row would be wrong — there is no run, and `recordRunEvent`
    // writes `fromState === toState`, which `pushNewRuns` skips outright. The
    // durable feed is where a change with no run belongs.
    //
    // A missing NotifyLog degrades the RECORD and never the write, and
    // `recordFeedEvent` throws SYNCHRONOUSLY (`node:sqlite`), so it is caught
    // here the same way `watch.ts:1225-1228` catches it.
    const log = deps.notifyLog;
    if (log) {
      try {
        coord.recordFeedEvent(log.epoch, log.record({
          kind: 'coord', sessionId: '',
          title: '⚙ caps',
          body: `workers ${before.maxConcurrentWorkers} → ${view.caps.maxConcurrentWorkers}, ` +
                `per day ${before.maxSessionsPerDay} → ${view.caps.maxSessionsPerDay}`,
        }));
      } catch (err) {
        console.warn(`ccrc-server: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — caps written, feed archive degraded`);
      }
    }
    return reply.code(200).send({ ok: true, ...view });
  });
```

Before writing `sessionId: ''`, MEASURE what the PWA renders for an empty `sessionId` on a feed row and
record the answer. If it renders a dangling link or an empty chip, the row is a lie by omission and the
renderer needs the same degradation `pushOne` applies to an empty project — "never a dangling separator".
Fix it in task 7 and record it as a deviation from the spare block.

- [ ] **5.5 — Move the pins the route's existence moved.** In `server/test/auth-gate.test.ts`:
`scanRoutes('coord/routes.ts')` 23 → 25, `ROUTES.length` 69 → 71, non-websocket 66 → 68, and the armed
sweep's `gated.length` 42 → 44 (both new routes are NOT exempt, so both move it). Add a comment above
each, in the file's own style, naming WHICH route moved it and why — `:196-199` is the model.

- [ ] **5.6 — Add `SESSION_ONLY` to `coord-pause-route.test.ts`,** immediately after `UNGATED`:

```ts
  /** Write routes that carry NO box token and are NOT release valves — the
   *  distinction `UNGATED` alone could not express, and that stayed invisible
   *  while the D-282 doors were the only ungated POSTs in this file (D-1159).
   *
   *  `UNGATED` is an argument about a WEDGE: the locked-out party holds the box
   *  token, so the valve must not sit behind it. A name here makes no such
   *  claim. These are ordinary same-origin PWA writes that no machine lane
   *  calls, so the fleet's shared secret is the wrong key for them — and
   *  nothing may rely on one of them to open a wedge.
   *
   *  Kept disjoint from `UNGATED` in both directions below, so a door cannot
   *  quietly acquire the release-valve argument by being listed twice, and
   *  `UNGATED.size` — which five prose sites are checked against — is untouched
   *  by anything added here.
   *
   *  `/api/coord/caps`: the operator's dial on `maxConcurrentWorkers` and
   *  `maxSessionsPerDay`. Raising a cap releases no wedge. */
  const SESSION_ONLY = new Set(['/api/coord/caps']);
```

Then: (a) direction one skips `UNGATED.has(route) || SESSION_ONLY.has(route)`; (b) a new test asserts the
two sets are disjoint; (c) a new test asserts every `SESSION_ONLY` route really IS ungated (the mirror of
the existing `UNGATED` direction-two, so a name here cannot document an exemption the code does not
take); (d) a new test asserts no `SESSION_ONLY` route appears in `auth/gate.ts`'s `EXEMPT` table — that
is what "session-gated when armed" MEANS, and without it the claim is prose.

```ts
  it('SESSION_ONLY and UNGATED are disjoint — a door gets one argument, not both', () => {
    expect([...SESSION_ONLY].filter((r) => UNGATED.has(r)),
      'a route claims both the release-valve argument and the ordinary-write one').toEqual([]);
    expect(SESSION_ONLY.size, 'the set emptied — this scan is over nothing').toBeGreaterThan(0);
  });

  it('every SESSION_ONLY route really IS ungated', () => {
    const listed = handlers().filter((h) => SESSION_ONLY.has(h.route));
    expect(listed.map((h) => h.route).sort(), 'a SESSION_ONLY name matches no handler')
      .toEqual([...SESSION_ONLY].sort());
    const gated = listed.filter((h) => GATE_PATTERNS.some((re) => re.test(h.body))).map((h) => h.route);
    expect(gated, 'a SESSION_ONLY route checks the box token after all').toEqual([]);
  });

  it('no SESSION_ONLY route is EXEMPT — armed, it sits behind the session gate', () => {
    for (const route of SESSION_ONLY) {
      expect(GATE_SRC.includes(`'POST ${route}'`),
        `${route} is in the EXEMPT table; a PWA-surface write must not be`).toBe(false);
      expect(GATE_SRC.includes(`'GET ${route}'`),
        `${route} is in the EXEMPT table; a PWA-surface write must not be`).toBe(false);
    }
  });
```

- [ ] **5.7 — Run the three suites and record the green.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/coord-caps-route.test.ts test/coord-pause-route.test.ts test/auth-gate.test.ts
```

- [ ] **5.8 — Measure the mutation table.** Command as in 5.7.

  | mutation | first-fail assertion |
  |---|---|
  | drop the `notConfigured` arm from `GET /api/coord/caps` | `AssertionError: expected 500 to be 501` |
  | drop the `notConfigured` arm from the POST | `AssertionError: expected 500 to be 501` |
  | write before validate (`setCaps` moved above the refusal) | **GREEN as written — hole (mutation mis-designed).** Redesigned as the slip that actually happens — the refusal sends its 400 without RETURNING — then: `AssertionError: expected { maxConcurrentWorkers: 99, …(1) } to deeply equal { maxConcurrentWorkers: 3, …(1) }` |
  | record the feed event on the refusal path too | `AssertionError: expected 1 to be +0` |
  | make the feed event's absence fatal (`log!.record(...)`, no guard) | **GREEN as written — hole.** The throw lands in the handler's own try/catch, so every status assertion stays green. Closed by asserting the CONSOLE, then: `AssertionError: a box with no feed warned as though a write had failed: expected 'ccrc-server: recordFeedEvent failed (…' not to contain 'recordFeedEvent'` |
  | remove `'/api/coord/caps'` from `SESSION_ONLY` | `AssertionError: write routes with no box-token gate ahead of their first await: expected [ '/api/coord/caps' ] to deeply equal []` |
  | move `'/api/coord/caps'` from `SESSION_ONLY` into `UNGATED` | `AssertionError: a route claims both the release-valve argument and the ordinary-write one: expected [ '/api/coord/caps' ] to deeply equal []` |
  | add `requireMailToken` to the caps POST handler | `AssertionError: expected [ 'GET /api/claims', …(18) ] to deeply equal [ 'GET /api/claims', …(17) ]` |
  | add `'POST /api/coord/caps'` to `auth/gate.ts`'s EXEMPT table | *(covered by the row above from the other side —* `no SESSION_ONLY route is EXEMPT` *reds; measured together with it)* |
  | revert `scanRoutes('coord/routes.ts')` to 23 | `AssertionError: expected 25 to be 23` |
  | revert the armed-sweep `gated.length` to 42 | `AssertionError: expected 44 to be 42` |
  | drop `coordMutex.run` and write bare | **GREEN as written — hole.** Closed by extending `dispatch-mutex-gate.test.ts`'s `TARGETS` to `coord.setCaps` — the tree's own structural mechanism for exactly this (D-46), needing no scanner change because `head` is the whole dotted identifier chain. Then: `AssertionError: expected [ Array(1) ] to deeply equal []` |
  | reply with `decided.next` instead of the re-read `coord.caps()` | **GREEN, and it STAYS green — reported, not closed.** See below. |

  **Four holes in twelve rows. Three closed; the fourth is reported as a non-guard, which is the honest
  answer.** `decided.next` and the re-read `coord.caps()` cannot be made to differ: the only state that
  would separate them is a missing `coordinator_state` row (D-1164's silent-no-op-versus-throw
  disagreement), and the route reads `caps()` as `before` in its FIRST statement, so that state throws
  there and both spellings answer 500 — measured, after building the state with a raw `DELETE` through a
  db handle the test harness now returns. The re-read is therefore a truthfulness choice with no
  observable consequence, not a guard, and this plan does not claim it as one.

  The test written while chasing that row was KEPT, with its comment corrected to say what it actually
  pins — that a corrupt store reaches the caller as a fault rather than as a confident 200 for a write
  that did not happen. Its first draft claimed to witness the re-read; leaving that in would have been
  precisely the defect wave 5's review found and named, a guard pinned by a green test whose title
  described a different situation.

- [ ] **5.9 — Commit.**

```bash
git add server/src/coord/routes.ts server/test/coord-caps-route.test.ts \
        server/test/coord-pause-route.test.ts server/test/auth-gate.test.ts
git commit -m "feat(coord): caps become an operator dial, and the ungated set learns a second argument (D-1158, D-1159, D-1166)"
```

---

## Task 6: the PWA control

**Files:**
- Modify: `pwa/src/lib/api.ts` (after `:649`), `pwa/src/screens/RunsScreen.tsx` (`:594`),
  `pwa/src/fleet/fleet.css` (after `:2079`)
- Create: `pwa/src/fleet/CapsControl.tsx`, `pwa/test/caps-control.test.tsx`
- Modify: `pwa/test/api.test.ts`, `pwa/test/runs-screen.test.tsx`, `pwa/test/tap-targets.test.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/coord/caps` (task 5), `CoordCapsView` (task 4).
- Produces: `api.coordCaps(): Promise<CoordCapsView>`, `api.setCoordCaps(partial): Promise<CoordCapsView |
  'unreadable'>`, and `<CapsControl store? coordCaps? setCoordCaps? />`.

Five conventions this control obeys, each one measured on the pause control beside it: the write function
is an injectable prop defaulting to the `api` singleton; component tests drive the injected function and
a SEPARATE fetch-level block in `api.test.ts` pins URL/method/headers/body (without it a new client
method has no coverage at all — measured, `api.test.ts:261-267`); a mount pin in `runs-screen.test.tsx`
asserts DOM ORDER, because a control tested only in its own file stops shipping the moment a merge drops
the mount line; CSS is plain global, self-grounded or written as a named-ancestor descendant so the
contrast auditor can measure it; and NO `setInterval` anywhere in the tree, or `runs-screen.test.tsx`'s
cadence pin breaks.

It departs from the pause control in exactly one place, deliberately: the pause toggle refuses to be
optimistic and settles on the next `{type:'coord'}` frame. No frame carries caps, so this control settles
on the response body. `postJsonOr` (D-1150) is the right client helper for that — it keeps "the answer
was unreadable" distinct from "the request never happened", and after a caps write those are genuinely
different states.

- [ ] **6.1 — Write the failing tests.** Create `pwa/test/caps-control.test.tsx`:

```tsx
  it('renders nothing until the first read lands', () => {
    const { container } = render(<CapsControl coordCaps={() => new Promise(() => {})} />);
    expect(container.querySelector('.caps-control')).toBeNull();
  });

  it('shows usage against each cap once the read lands', async () => {
    render(<CapsControl coordCaps={async () => ({
      caps: { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 },
      usage: { running: 1, dispatchedIn24h: 4 } })} />);
    expect(await screen.findByText(/1\s*\/\s*3/)).toBeInTheDocument();
    expect(screen.getByText(/4\s*\/\s*12/)).toBeInTheDocument();
  });

  it('sends only the field the operator changed', async () => {
    const setCoordCaps = vi.fn(async () => ({
      caps: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 },
      usage: { running: 1, dispatchedIn24h: 4 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 5 });
  });

  it('settles on the response body, not on what was typed', async () => {
    // The honesty half: the server is the authority on what was stored.
    const setCoordCaps = vi.fn(async () => ({
      caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 12 },
      usage: { running: 1, dispatchedIn24h: 4 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/1\s*\/\s*4/)).toBeInTheDocument();
  });

  it('says so, inline, when the write is refused', async () => {
    const setCoordCaps = vi.fn(() => Promise.reject(new ApiError(400,
      { ok: false, error: 'bad-request', detail: 'maxConcurrentWorkers must be an integer between 1 and 64' })));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/between 1 and 64/)).toBeInTheDocument();
  });

  it('does NOT claim the write failed when only the ANSWER was unreadable', async () => {
    // The D-1150 distinction, at a new seam: the caps may well have been
    // written. Saying "failed" would be a lie the operator would act on.
    const setCoordCaps = vi.fn(async () => 'unreadable' as const);
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    expect(await screen.findByText(/unconfirmed|could not be read/i)).toBeInTheDocument();
  });

  it('renders nothing on a box with no coordination database', async () => {
    render(<CapsControl coordCaps={() => Promise.reject(new ApiError(501, { ok: false, error: 'not-configured' }))} />);
    await waitFor(() => expect(document.querySelector('.caps-control')).toBeNull());
  });
```

In `pwa/test/api.test.ts`, the fetch-level pins for both methods (URL, method, content-type, body),
modelled verbatim on `:269-283`. In `pwa/test/runs-screen.test.tsx`, extend the DOM-order pin at `:469`
to `[offline, banner, caps]`. In `pwa/test/tap-targets.test.tsx`, add `.caps-save` (and any other floored
control) to the rule loop at `:236-249`.

- [ ] **6.2 — Run and record the reds** (three files).

- [ ] **6.3 — Implement the client**, after `coordPause` at `pwa/src/lib/api.ts:649`:

```ts
    /** `GET /api/coord/caps` — the two limits AND the two derived counts. They
     *  travel together because a cap without its count is a number the operator
     *  cannot act on. 501 `not-configured` on a box with no coordination
     *  database, which the control renders as nothing at all. */
    coordCaps: () => getJson<CoordCapsView>('/api/coord/caps'),

    /** `POST /api/coord/caps` — a PARTIAL; an omitted field keeps its value.
     *  Session-gated when armed, open dark; NOT box-token (an operator dial is
     *  not a machine lane) and NOT one of the D-282 release valves.
     *
     *  `postJsonOr`, not `postJson` (D-1150): after a caps write, "the answer
     *  could not be read" and "the request never happened" are different states
     *  — the first may have stored the value — and the control must not report
     *  one as the other. */
    setCoordCaps: (next: Partial<CoordCaps>) =>
      postJsonOr<CoordCapsView, 'unreadable'>('/api/coord/caps', 'unreadable', next),
```

Match `postJsonOr`'s real signature at `api.ts:288-326` — read it and conform; the shape above is the
intent, not a licence to guess.

- [ ] **6.4 — Implement `CapsControl.tsx`** on `CoordBanner`'s shape: injectable props defaulting to the
`api` singleton, a render gate that returns `null` until the first read lands (and on a 501), two
labelled number inputs, one save button, an inline error paragraph. No timers, no polling. Re-read on
mount only; the response body updates the rendered state.

- [ ] **6.5 — Mount it** in `RunsScreen.tsx`, on the line after `<CoordBanner store={store} />`, with a
comment in that file's own style naming why it lives on `/runs` and nowhere else.

- [ ] **6.6 — Add the CSS** after `.coord-banner .coord-error` at `fleet.css:2079`. Self-grounded (both
`color` and `background`) or named-ancestor descendants; `min-height: var(--tap-min)` on the button and
the inputs; tokens only, never a raw `44px`.

- [ ] **6.7 — Run the three suites and record the green.**

```bash
cd "$(git rev-parse --show-toplevel)/pwa"
./node_modules/.bin/vitest run test/caps-control.test.tsx test/api.test.ts test/runs-screen.test.tsx test/tap-targets.test.tsx
```

- [ ] **6.8 — Measure the mutation table.**

  | mutation | first-fail assertion |
  |---|---|
  | delete the `<CapsControl/>` line from `RunsScreen.tsx` | `AssertionError: expected null not to be null` (the mount pin) |
  | render the typed value instead of the response body | `TestingLibraryElementError: Unable to find an element with the text: 1 / 4` |
  | send both fields always, instead of only the changed one | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
  | treat `'unreadable'` as a failure | `TestingLibraryElementError: Unable to find an element with the text: /unconfirmed/i` |
  | drop the render gate (render before the first read lands) | `AssertionError: expected <div class="caps-control" …(2)>…(3)</div> to be null` (3 failed) |
  | swap `var(--tap-min)` for `44px` in `.caps-save` | `AssertionError: expected 'flex: none; min-height: 44px; padding…' not to contain '44px'` |
  | swap `postJsonOr` for `postJson` | `AssertionError: promise rejected "Error: truncated" instead of resolving` |

  7/7 red, no holes — but three of them LOOKED green on the first pass and were not. The harness grepped
  the run for `AssertionError` alone, and two of these rows fail as `TestingLibraryElementError` while a
  third had been mis-written into a syntax error that never reached an assertion at all. A mutation whose
  output you filter is a mutation you have not measured; all three were re-run with the filter widened and
  the failing text read.

  **A regression this task caused, and how it was fixed.** Mounting `CapsControl` with its own default
  reader made the board issue a request on every render, which broke two PRE-EXISTING tests that stub the
  global `fetch` and assert the board calls nothing else (`runs-screen.test.tsx`'s resume-door two-tap
  test and `abandon-sheet.test.tsx`'s). Those assertions are worth keeping exactly as strict as they
  were, so the fix was NOT to loosen them: the reader was hoisted to a `loadCaps` prop on `RunsScreen`,
  beside the `loadRuns` prop that exists for precisely this reason, and injected at every board render in
  the three affected suites. The screen's own prop docstring records the measurement.

- [ ] **6.9 — Commit.**

```bash
git add pwa/src pwa/test
git commit -m "feat(pwa): the caps dial on the runs board, settling on what the server stored (D-1158)"
```

---

## Task 7: the box-token census, and the five prose sites it corrects

**Files:**
- Create: `server/test/box-token-census.test.ts`
- Modify: `README.md` (`:529-531`, `:1405-1425`), `server/src/auth/gate.ts` (`:75-91`, `:663-664`),
  `server/test/auth-gate.test.ts` (`:401`, `:438` — the title and comment only)
- Modify: `CLAUDE.md` — ONLY if `oss-metadata.test.ts` demands it (see step 7.7). The box-token bullet is
  **not reworded**.

D-1156, in full, plus one site the ticket never named. Three sites state a box-token surface nothing
checks; the CLAUDE.md sentence wave 5 corrected is itself unpinned, and that was MEASURED — the false
sentence was restored and the suite stayed green.

**The three sites do not count the same set, and a mechanism that ignores that is wrong three ways
(D-1162).** `README:530` counts "box-token-gated coordination routes"; `gate.ts:75` counts "machine
lanes", which includes the five dual-credential GETs and `/api/notify`; D-1156's own entry counts
`requireMailToken` call sites alone and arrives at eleven. So the scanner NAMES its set — every route
handler that CONSULTS the box token, by either mechanism, across both files that register such handlers —
and the prose is rewritten to speak that set. `auth-gate.test.ts:401` already derives exactly this set,
from `coord/routes.ts` alone; this scanner widens it to `server.ts` and then checks prose against it.

**The fourth site (D-1161).** `auth/gate.ts:75,77,80,90` and `:663` say "the SEVENTEEN box-token machine
lanes … All eighteen". Measured: `coord/routes.ts` holds eighteen and `/api/notify` makes nineteen —
exactly one generation stale (`auth-gate.test.ts:414-418` records the set going 17 → 18 when `GET
/api/runs/:id/items` joined; this prose was never updated). `:80` is also wrong in KIND, not only number:
five of the eighteen accept a session cookie instead, so they do not "refuse every verdict but 'ok'".
`auth-gate.test.ts:401`'s own title carries the same off-by-one over a CORRECT 18-element assertion.

**Corpus scoping, stated so the scanner cannot creep.** It reads `README.md`, `CLAUDE.md`,
`server/src/auth/gate.ts` and `server/test/auth-gate.test.ts` — repo-root docs and the source that states
a census. It does NOT read `docs/superpowers/{plans,specs,programs,research}` (archived generations say
TWO doors, THREE doors, "all six coordinator write routes" BY DESIGN, and correcting them would falsify
the history the D-N ledger depends on), `graphify-out/` (a generated artefact), or `ccd/` (out of scope
this wave and on the coordinator's agent-first deploy lane — see D-1168).

- [ ] **7.1 — Re-confirm every anchor, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '529,531p'   README.md
sed -n '1405,1425p' README.md
sed -n '73,92p'     server/src/auth/gate.ts
sed -n '662,665p'   server/src/auth/gate.ts
sed -n '401,402p'   server/test/auth-gate.test.ts
grep -n 'Box token gates every coordination WRITE' CLAUDE.md
```

- [ ] **7.2 — Write the scanner and its assertions, RED first.** Create
`server/test/box-token-census.test.ts`. It must carry its own anti-vacuity guards — this tree has been
bitten twice by a slicer that silently sliced nothing, and `''` satisfies every negative assertion.

```ts
  /** THE DERIVED SURFACE. One set, named: every route handler that CONSULTS the
   *  box token, by either mechanism, across both files that register one.
   *
   *  Naming it is the point (D-1162). The three prose sites this file pins were
   *  each counting a DIFFERENT set — hard-require, machine-lanes-including-the
   *  -dual-credential-GETs, and `requireMailToken` call sites alone — and a
   *  scanner that demanded one word from all three would be wrong twice. The
   *  prose is rewritten to speak THIS set; the numbers below are derived from
   *  it and nowhere else. */
  const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];
  const lanesIn = (rel: string): string[] => { /* the auth-gate.test.ts:405-413 walk */ };
  const COORD_LANES = lanesIn('coord/routes.ts');
  const ALL_LANES = [...COORD_LANES, ...lanesIn('server.ts')];

  it('the scan finds what it claims to scan', () => {
    // Anti-vacuity, first, because every assertion below is satisfied by an
    // empty set. A floor AND two named smoke members.
    expect(COORD_LANES.length).toBeGreaterThan(10);
    expect(COORD_LANES).toContain('POST /api/mail');
    expect(ALL_LANES).toContain('POST /api/notify');
    expect(ALL_LANES.length).toBe(COORD_LANES.length + 1);
  });

  it('README states the derived lane counts, not a remembered pair', () => {
    const p = passage('README, the auth paragraph', README,
      'What is gated, and what is not:', 'Enrolling a passkey');
    expect(numeralsIn(p)).toEqual(new Set([word(ALL_LANES.length), word(COORD_LANES.length)]));
  });

  it('README names every gated run route, and names the ungated doors as the exceptions they are', () => {
    const p = passage('README, the mail-bus paragraph', README,
      '`/api/mail` (and its ack route)', 'Minting the token file matters');
    for (const r of COORD_LANES.filter((k) => k.startsWith('POST /api/runs'))) {
      expect(p, `the mail-bus paragraph omits ${r}`).toContain(r.replace('POST ', ''));
    }
    for (const door of UNGATED_DOORS) {
      expect(p, `the mail-bus paragraph does not name ${door} as an exception`).toContain(door);
    }
  });

  it('gate.ts states the derived lane counts', () => {
    const p = passage('gate.ts, EXEMPT reason 2', GATE_SRC,
      '  2. The', 'These callers are');
    expect(numeralsIn(p)).toEqual(new Set([word(COORD_LANES.length)]));
  });

  it("CLAUDE.md's box-token bullet is TRUE, not merely present", () => {
    // THE PIN D-1156 ASKED FOR. Wave 5 corrected this sentence and MEASURED
    // that nothing held it: the false version was restored and the suite stayed
    // green. Each claim is checked against the source it describes.
    const bullet = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **');
    for (const r of ['POST /api/claims', 'POST /api/claims/:id/release',
                     'POST /api/ledger/deviations', 'GET /api/ledger']) {
      expect(bullet, `the bullet no longer names ${r}`).toContain(r);
      expect(COORD_LANES, `the bullet names ${r} as a box-token lane and it is not one`)
        .toContain(r);
    }
    // …and the one it names as carrying NO box token really carries none.
    expect(bullet).toContain('POST /api/sessions/:id/kickoff');
    expect(ALL_LANES, 'the kickoff route acquired a box-token gate — the bullet is now false')
      .not.toContain('POST /api/sessions/:id/kickoff');
  });

  it('no prose site UNDER-claims the surface', () => {
    // The property in one line, over every site at once: a number stated about
    // this surface is either the derived one or absent. Collected as offenders
    // so a failure prints every violating site rather than the first.
    const offenders = SITES.flatMap(({ name, text, expected }) =>
      [...numeralsIn(text)].filter((n) => n !== word(expected)).map((n) => `${name}: ${n}`));
    expect(offenders, 'a prose site states a count this tree does not have').toEqual([]);
    expect(SITES.length, 'a site was dropped instead of corrected').toBe(4);
  });
```

Write `passage()` with the SAME two guards as `coord-pause-route.test.ts:343-357` (both anchors present,
slice over 300 chars); write `numeralsIn()` to match number-words case-insensitively from a list running
at least to twenty-five, anchored to the sliced passage and never to a whole file; write `word(n)` as the
inverse of that list and assert `word()` is defined for every count it is asked for — the guard that
catches a surface outgrowing the word list, exactly as `expect(want).toBeDefined()` does one field over.

- [ ] **7.3 — Run and record the reds.** Expected: four failing sites — README ×2, gate.ts, and whichever
of the CLAUDE.md claims no longer holds. Record every first-fail verbatim; these reds ARE the measurement
that the prose was wrong, and they are the evidence the wave-done mail reports.

- [ ] **7.4 — Correct README's auth paragraph** (`:529-531`). Replace "the ten machine lanes the fleet
host posts to (nine box-token-gated coordination routes plus `/api/notify`" with the derived truth:
nineteen lanes, eighteen coordination routes that consult the box token plus `/api/notify`. Keep the rest
of the sentence, including the legacy-tolerance clause, intact.

- [ ] **7.5 — Correct README's mail-bus paragraph** (`:1405-1425`). Two defects, one edit. "the run
routes (`POST /api/runs`, `/:id/dispatch`, `/:id/close`, `/:id/advance`)" omits `/:id/items` and reads as
a complete class; and "every coordinator write route now fails the same way the mail pair always has …
None of these six routes" has been false since Build 4. Wave 5 already drafted the replacement clause and
it is the right one — enumerate the five gated run routes and name the exceptions:

> …the run routes (`POST /api/runs`, `/:id/dispatch`, `/:id/close`, `/:id/advance`, `/:id/items`) — but
> NOT the operator doors `/:id/abandon` and `/:id/reclaim`, which are ungated by design (D-282), nor
> `POST /api/coord/pause` and `POST /api/claims/:id/break`, the other two of the same family…

and replace "None of these six routes" with a claim about the enumerated lanes rather than a count the
paragraph no longer supports. **Do not write a CAPS cardinal anywhere in these passages** — `CARD_RE`
does not read README today, but the wave that adds it should not have to clean up after this one.

- [ ] **7.6 — Correct `gate.ts`'s three paragraphs and `auth-gate.test.ts`'s title.** `:75-77`
SEVENTEEN → EIGHTEEN and "All eighteen" → all nineteen; `:80-81` and `:90` likewise, and `:80` also loses
the claim that all of them "refuse every verdict but 'ok'" — five take a session cookie instead, so the
sentence must say which do and which do not; `:663-664` the same count. `auth-gate.test.ts:401`'s title
and `:438`'s "the eighteenth" become the derived truth over the same correct assertion. All of `:75-91`
and `:663` sit OUTSIDE the passage `coord-pause-route.test.ts` slices (its anchors are
`' *  - \`POST /api/coord/pause\`'` → `'export const EXEMPT'`), so CAPS is safe there — but verify that
with a run, not by reading.

- [ ] **7.7 — Re-measure the README size coupling.**

```bash
cd "$(git rev-parse --show-toplevel)"
wc -l README.md && grep -n 'README\.md` (~' CLAUDE.md
cd server && ./node_modules/.bin/vitest run test/oss-metadata.test.ts
```
`oss-metadata.test.ts:89-100` asserts CLAUDE.md's stated README size is within 10% of the real count.
README was 2033 lines against a claimed ~1931 (upper edge ~2124) before this task. If the edits push it
past, update CLAUDE.md's line-count figure — and ONLY that figure. Do not reflow the box-token bullet:
its opening anchor is a literal in two suites, and `D-282 (was D-B4-9)` is one unbreakable token sequence
that `deviation-refs.test.ts:168` reds on if a line break lands inside it.

- [ ] **7.8 — Run and record the green.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/box-token-census.test.ts test/auth-gate.test.ts \
  test/coord-pause-route.test.ts test/oss-metadata.test.ts test/readme-holds.test.ts \
  test/topology-clean.test.ts test/deviation-refs.test.ts
```

- [ ] **7.9 — Measure the mutation table.** Command as in 7.8.

  | mutation | first-fail assertion |
  |---|---|
  | restore README's "nine box-token-gated coordination routes" | *(measured at execution)* |
  | restore README's "None of these six routes" | *(measured at execution)* |
  | drop `/:id/items` from README's run-route list | *(measured at execution)* |
  | restore gate.ts's "SEVENTEEN" | *(measured at execution)* |
  | restore CLAUDE.md's "the two prefixes above are the whole box-token surface" wording | *(measured at execution)* |
  | delete `POST /api/ledger/deviations` from CLAUDE.md's bullet | *(measured at execution)* |
  | add `requireMailToken` to the kickoff handler in `server.ts` | *(measured at execution)* |
  | narrow `GATE_PATTERNS` to `requireMailToken` alone | *(measured at execution)* |
  | make `passage()` return `''` on a missing anchor instead of failing | *(measured at execution)* |
  | point `lanesIn` at a file that does not exist | *(measured at execution)* |

The fifth row is THE row: it is the exact measurement wave 5 made and reported as unpinned. It must now
come back RED.

- [ ] **7.10 — Commit.**

```bash
git add server/test/box-token-census.test.ts server/test/auth-gate.test.ts \
        server/src/auth/gate.ts README.md CLAUDE.md
git commit -m "fix: derive the box-token surface from its call sites, and correct all five prose sites that under-claimed it (D-1156, D-1161, D-1162)"
```

---

## Task 8: the runId lower bound, on the two readers that still lack it

**Files:**
- Modify: `server/src/coord/routes.ts` (`:461-469`, `:1694-1702`)
- Test: `server/test/run-routes.test.ts` (or the mail/claims route suites — put each case in the file that
  already owns that route)

Wave 5 fixed one of three (`D-1151`, the kickoff route). The convention is inconsistent across the other
two: both accept `0` and negatives, relying on a downstream `coord.run(runId) === null` to answer 404
`unknown-run`.

**This is not the free win D-1151 was, and the plan says so before the diff does (D-1165).** On the
kickoff route nothing downstream caught the bad pair, so a nonsense brief was actually composed. Here the
value IS caught — as a 404. Adding the bound changes a negative `runId` from 404 `unknown-run` to 400
`bad-request`, and on `POST /api/mail` it additionally changes which `recordRejection` row is written
(`bad-kind` instead of `unknown-run`). That is the correct answer — a shape error is a 400 and a missing
row is a 404, and conflating them is the overloaded seam this tree bans — but it is a behaviour change,
so it ships with tests that pin BOTH statuses and the recorded rejection code.

- [ ] **8.1 — Re-confirm the anchors.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '461,470p'   server/src/coord/routes.ts
sed -n '1694,1703p' server/src/coord/routes.ts
sed -n '588,594p'   server/src/coord/routes.ts     # the downstream 404 on the mail route
sed -n '1717,1723p' server/src/coord/routes.ts     # …and on the claims route
```

- [ ] **8.2 — Write the failing tests**, one pair per route: a negative `runId` and a zero `runId` each
answer 400 `bad-request` with a detail naming `runId`; a well-formed but unknown `runId` still answers
404 `unknown-run` (the fixture that proves the 400 did not swallow the 404's own case); and on the mail
route, the recorded rejection row carries the shape code rather than the unknown-run one.

- [ ] **8.3 — Run and record the red.** Expected: 404 where 400 is asserted. Record verbatim.

- [ ] **8.4 — Implement**, in both readers, changing only the accepting arm:

```ts
    } else if (typeof runIdRaw === 'number' && Number.isInteger(runIdRaw) && runIdRaw >= 1) {
```

and widen each refusal's detail to `'runId must be a positive integer when given'`. Add a comment at the
first site recording D-1151's lesson and this route's difference (the bad value was already caught here,
as a 404; the change is that a shape error now answers as one).

- [ ] **8.5 — Run and record the green.**

- [ ] **8.6 — Measure the mutation table.**

  | mutation | first-fail assertion |
  |---|---|
  | drop `&& runIdRaw >= 1` from the mail reader | *(measured at execution)* |
  | drop `&& runIdRaw >= 1` from the claims reader | *(measured at execution)* |
  | make the bound `> 1` (off-by-one against a legitimate run 1) | *(measured at execution)* |
  | drop `Number.isInteger` from either reader | *(measured at execution)* |

- [ ] **8.7 — Commit.**

```bash
git add server/src/coord/routes.ts server/test
git commit -m "fix(coord): the last two runId readers get the lower bound the third already had (D-1165)"
```

---

## Task 9: whole-branch verification and the handoff

**Files:** none new — this task measures and reports.

- [ ] **9.1 — Full suites, foreground, `timeout 600000`, cd'd in, tails READ not grepped.**

```bash
cd "$(git rev-parse --show-toplevel)/server" && timeout 600000 ./node_modules/.bin/vitest run
cd "$(git rev-parse --show-toplevel)/agent"  && timeout 600000 ./node_modules/.bin/vitest run
cd "$(git rev-parse --show-toplevel)/pwa"    && timeout 600000 ./node_modules/.bin/vitest run
```

  | suite | files | passed | skipped |
  |---|---|---|---|
  | server | *(measured)* | *(measured)* | *(measured)* |
  | agent | *(measured)* | *(measured)* | *(measured)* |
  | pwa | *(measured)* | *(measured)* | *(measured)* |

  Baseline for the deltas: server 244/6131/56, pwa 76/2085/0, agent 18/281/0 at wave 5's close. Confirm
  the baseline on the merge-base BEFORE claiming a delta.

- [ ] **9.2 — Re-run any load flake IN ISOLATION** before calling it a break: `ccd-ws-gc`, `pr-sweep`,
`session-hook`, `typecheck-tests`, `ccd-session-state`. Record which were re-run and the isolated result.
A single green isolated run is not proof it was the load — say which it was, or say it is unresolved.

- [ ] **9.3 — Typecheck all three packages.**

```bash
for p in server agent pwa; do (cd "$(git rev-parse --show-toplevel)/$p" && ./node_modules/.bin/tsc --noEmit) || echo "TSC RED: $p"; done
```

- [ ] **9.4 — The mutation table, counted twice by independent methods.** Count A (structural): total
table lines across tasks 1-8 minus separators. Count B (arithmetic): per-task filled rows summed. State
both, state that they agree, and answer explicitly: **did any guard ship with no row?** If yes, name it
and either add the row or record why not. Name every row that came back GREEN or red-for-the-wrong-reason
in a `| # | task | the prescribed row | what actually happened, and the hole behind it |` table.

- [ ] **9.5 — Run the scanner suites that police this diff**, together:

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/single-definition.test.ts test/deviation-refs.test.ts \
  test/coord-routes-single-file.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts \
  test/topology-clean.test.ts test/oss-metadata.test.ts test/node-floor.test.ts \
  test/coord-db.test.ts test/deliverability-parity.test.ts test/lifecycle-sweep.test.ts
```
`coordinator-skill` and `worker-skill` are in the list to PROVE the corpus was not touched — this wave is
not agent-first, and a green pass on both is the fixture that witnesses it.

- [ ] **9.6 — Self-review against Global Constraints**, one line each: branch, agent-first scope, wire
discipline, no overloaded null, TDD reds recorded, deviations defined before their source refs, suites
foreground.

- [ ] **9.7 — Confirm the branch, then push and open the PR.**

```bash
cd "$(git rev-parse --show-toplevel)"
git branch --show-current            # MUST print ws/quiet-meadow
git log --oneline origin/main..HEAD
git push -u origin ws/quiet-meadow
gh pr create --base main --head ws/quiet-meadow --title '…' --body '…'
```

- [ ] **9.8 — Measure the fingerprint ONCE, after the final push, and send it ONCE.**

```bash
git -C "$(git rev-parse --show-toplevel)" rev-parse HEAD    # branchTip AND handoffCommit — the same sha
gh pr view --json number,state
```
`prPhase` is one of the eight words — `unchecked | none | no-commits | open | draft | merged | closed |
unknown` — read, never invented. Then STOP PUSHING: a lint fix after the mail moves the tip away from the
claimed sha and the coordinator gets `stale-tip` for a wave that was finished.

- [ ] **9.9 — Report what the coordinator must act on**, in the wave-done mail: the two corrected brief
premises (D-1157, D-1158), the out-of-scope `ccd/` finding (D-1168), the new `SESSION_ONLY` vocabulary
(D-1159), and every deviation defined below.

- [ ] **9.10 — Release the claim.**

```bash
~/.local/bin/ccrc-api claims release 15 --json - <<JSON
{"byId":"ccrc-pwa-quiet-meadow","byUuid":"$(cat "$HOME/.cc-sessions/ccrc-pwa-quiet-meadow.uuid")"}
JSON
```

---

## Deviations found

This wave's block is `D-1157..1172`, allocated from `POST /api/ledger/deviations` at planning time (floor
1157 → 1173). The program block `D-999..1046` and `D-1119..D-1156` are all spent. Every number cited
anywhere in this plan or in the diff is defined below; `deviation-refs.test.ts` reds on a source ref to
an allocated-but-unentered number, so an entry lands in the same commit as (or before) the comment
citing it. Three numbers of the block — 1170, 1171 and 1172 — are allocated and UNSPENT as this plan
is written; each is either defined here as its own entry at execution, or reported unspent in the
execution record. An unspent number is never silently dropped and never re-used.

### D-1157 (brief premise corrected by measurement — record-only) — the derived door count shipped in a different commit

The brief and the ledger both attribute the `UNGATED.size` derivation to `5ff7c33c`. That commit does not
touch `server/test/coord-pause-route.test.ts` at all — its four files are `CLAUDE.md`,
`pwa/src/fleet/nestFleet.ts`, `pwa/test/stores.test.ts` and `server/test/resume-reclaim-l0.test.ts`. The
derived count shipped in `ca711141` ("docs(wave5): the ungated operator doors are four, and the count is
now derived"), eleven commits earlier. The five commits the brief names are wave 5's FIX ROUND; the
idioms worth copying live in its feature commits. Planning against the named commit would have looked in
the wrong diff.

### D-1158 (spec/brief premise corrected by measurement — scope) — `capsUsage` reaches the PWA nowhere

The brief's "(capsUsage is already computed)" is true server-side and does not mean what it implies:
`capsUsage`, `CoordCaps` and `maxConcurrentWorkers` occur ZERO times in `pwa/src`, `CoordStatus` carries
only `{pause, mail}`, and no route reads or writes either. "Showing current usage vs cap" is therefore
not a rendering job over data already present — it needs a read route. This wave adds `GET
/api/coord/caps` alongside the POST, and names `CoordCapsUsage`/`CoordCapsView` in `shared/api.ts`. Caps
are deliberately NOT added to the `{type:'coord'}` frame: `emitCoord`'s docstring states it needs no
try/catch because it touches no `node:sqlite`, and `dispatchedIn24h` moves with the clock, so the frame's
byte-equality guard would let it re-emit on nearly every 2 s tick.

### D-1159 (mechanism gap the wave exposes — MAJOR) — "no box token" and "D-282 release valve" were one fact

`coord-pause-route.test.ts` direction-one asserts that every `app.post` with no box-token gate ahead of
its first `await` is a member of `UNGATED`. That held only because the four D-282 doors were the only
ungated POSTs in the file. The brief requires the caps dial to be NEITHER box-token NOR `UNGATED`, and
both facts cannot be asserted with that vocabulary. This wave adds `SESSION_ONLY` — ordinary same-origin
PWA writes that no machine lane calls — asserted disjoint from `UNGATED` in both directions, with its own
argument at the call site, plus a pin that no member is in `EXEMPT` (which is what "session-gated when
armed" MEANS). `UNGATED.size` stays four, so no prose cardinal at any of the five scanned sites moves.

### D-1160 (measured gap) — no store method could answer the coordinator question

`CoordStore` has no method answering "is session X the `claimedBy` of a non-terminal run".
`openRunsForSession` looks like it and keys on `sessionId`, the WORKER column — the opposite fact.
`runs({includeClosed:false})` would answer at the cost of a `programs` JOIN and a `prLineage` JSON parse
per row, the exact cost `OpenSibling`'s own docstring says this tree does not pay for this class of
question. Added `openCoordinatorIds()`, one statement, mirroring `programOpenRunCount`'s shipped
predicate rather than re-deriving one from `RUN_TRANSITIONS` — which would disagree, because the table
gives `'unknown'` an empty target list while every shipped query counts an `'unknown'` row as open.

### D-1161 (measured gap the ticket never named — widens D-1156) — a fourth and fifth stale census site

`server/src/auth/gate.ts:75,77,80,90` and `:663` state "the SEVENTEEN box-token machine lanes plus
`/api/notify` … All eighteen". Measured: `coord/routes.ts` holds eighteen token-consulting handlers, so
the figures are eighteen and nineteen — exactly one generation stale (`auth-gate.test.ts:414-418` records
the set going 17 → 18 when `GET /api/runs/:id/items` joined; this prose was never updated). `:80` is also
wrong in KIND: five of the eighteen accept a session cookie instead, so they do not "refuse every verdict
but 'ok'". `server/test/auth-gate.test.ts:401`'s own title and `:438`'s "the eighteenth" carry the same
off-by-one over a CORRECT 18-element assertion. D-1156's blast radius is five files, not the three the
ticket implies.

### D-1162 (mechanism design, from measurement) — the three prose sites count three different sets

`README:530` counts box-token-GATED coordination routes; `auth/gate.ts:75` counts machine LANES,
including the five dual-credential GETs and `/api/notify`; D-1156's own ledger entry counts
`requireMailToken` call sites alone and arrives at eleven. A scanner demanding one word from all three
would be wrong twice over passages that are legitimately describing different things. The mechanism
therefore NAMES its set — handlers that CONSULT the token, by either mechanism, across both files that
register one — and the prose is rewritten to speak that set rather than the scanner being widened to
tolerate three vocabularies.

### D-1163 (vocabulary gap) — no feed kind fits a coordination-config change

`NotifyEvent['kind']` is a closed six-token union and a caps change is none of them. `'run'` is closest
and would be a lie: there is no run. `recordRunEvent` is not an escape either — it writes `fromState ===
toState`, and `pushNewRuns` skips exactly those rows, so the event would land in `run_events` and be seen
by nobody. Added `'coord'`: additive, and an older PWA already degrades an unrecognised kind to
`'unknown'` through `isNotifyKind`, which is the designed degradation rather than a new one. The two
total `Record<NotifyEvent['kind'], …>` maps in `MailScreen.tsx` turn the addition into a compile error
until the renderer handles it — the forcing function working as intended.

### D-1164 (measured defect in a shipped method) — `setCaps` validates nothing and returns void

`CoordStore.setCaps` binds both fields straight into an UPDATE with no `Number.isInteger`, no bounds and
no NaN guard: `0`, `-5`, `1.5` and `1e9` all persist. `maxConcurrentWorkers: 0` is a genuine wedge —
`dispatch.ts:238` compares with `>=`, so zero refuses every dispatch, and unlike the pause marker there
is no ungated door to undo it. It also returns `void` and silently no-ops if row `id = 1` is absent,
while `caps()` THROWS on that same missing row: the two disagree about one condition. The absence never
showed because nothing in `server/src` had ever called it. This wave adds the validation as an L1
decision rather than widening the store's signature — the narrower change, and the one the ring
discipline asks for. The `void`/throw disagreement is recorded, not fixed: closing it changes a shipped
signature for a condition no route can currently reach (every caller opens with `notConfigured`).

### D-1165 (behaviour change, deliberate) — the runId lower bound moves a 404 to a 400

Adding `>= 1` to the two remaining `runId` body readers changes a negative or zero `runId` from 404
`unknown-run` to 400 `bad-request`, and on `POST /api/mail` changes the recorded rejection code from the
unknown-run one to the shape one. This is the correct answer — a shape error is a 400, a missing row is a
404, and conflating them is the overloaded seam this tree bans — but it is not the free win D-1151 was on
the kickoff route, where nothing downstream caught the bad pair at all. Shipped with tests pinning both
statuses and the recorded rejection code.

### D-1166 (measured trap in the obvious template) — the pause route is the wrong model in one place

`POST /api/coord/pause` deliberately has no `if (!deps.coord) return notConfigured(reply)` arm, and says
why: a pause is a marker file on the fleet host, so a box with no coordination database can still be
paused and answering 501 would be a lie about what the act needs. Caps are rows in `coord.db`, and
`caps()` casts an undefined row rather than returning null. Copying the pause handler's opening verbatim
— the natural move, since it is the only other `/api/coord/*` route — ships a route that throws on such a
box. The caps routes open with the arm the other twenty-two have.

### D-1167 (decision, argued) — the quiet window forks the threshold, not the gate token

`sweepMail`'s `not-quiet` and `cooldown` gate tokens are unchanged for a coordinator. `MailGate`'s own
docstring sets the rule — one member per CONDITION, not per `continue`, and `no-pane`/`no-config-dir`
were split because an operator acts on them differently — and here the condition is identical (this
session has not been quiet long enough) and so is the act (wait). The union is explicitly NOT a
scheduling input: it exists so a human can tell "waiting" from "wedged", and both thresholds are waiting.
A `coord-not-quiet` member would cost a union entry, a total-map entry in `shared/api.ts` and a phrase in
`MailStrip.tsx` to record a distinction nobody acts on.

### D-1168 (measured gap, reported NOT fixed — out of scope, agent-first) — `ccd/ccrc-api` states the ungated set as two

`ccd/ccrc-api:32-38` says "D-282 leaves `coord/pause` and `runs/:id/abandon` ungated on purpose" — stale
against the four in `UNGATED`, two generations behind. It is a shipped bash client under `ccd/`, on the
coordinator's AGENT-FIRST deploy lane, and this wave is explicitly server + PWA + root docs only. Not
touched, not folded into the census corpus, and mailed to the coordinator before implementation began
(mail 128) rather than reported at wave-done. `server/test/ccrc-api.test.ts:138-152` already scans that
file's ROUTES table, but for route keys only, never this prose — so a later agent-first wave has both a
site and a scanner to extend. Its source text, `docs/superpowers/plans/2026-08-26-ccrc-api.md:131`,
carries the same stale pair.

### D-1169 (measured, recorded) — `coordinator_state.updatedAt` is write-only

`setCaps` writes `updatedAt` and nothing in the tree ever reads it: the only two SQL sites touching
`coordinator_state` are `caps()`'s SELECT, which does not list the column, and `setCaps`'s UPDATE. The
caps control would naturally show "last changed", and cannot. Not widened here — `caps()` returns
`CoordCaps`, a shipped wire type, and widening it to carry a timestamp is a change to that type for a
feature nobody asked for. Recorded so the next wave that wants the field knows the column already exists
and only the read is missing. `setCaps` also reads its OWN clock inline rather than taking the caller's
moment, against the surrounding convention (`capsUsage(now = Date.now())`, `recordRunEvent(…, at)`, whose
rule D-1134 states as "the caller owns the moment being recorded") — left alone for the same reason, and
noted because a fixture that needs to pin a caps timestamp cannot.

---

## Execution record

### Baseline, measured BEFORE the first line of implementation (2026-08-31 19:30-19:36 UTC)

Merge-base `6458a14d`, worktree clean but for the plan file. Foreground, `timeout 600000`, cd'd into each
package, tails read. Box load average 6.51 at start (16 cores).

| suite | files | passed | skipped | duration |
|---|---|---|---|---|
| server | 244 | 6131 | 56 | 294.42s |
| agent | 18 | 281 | 0 | 3.37s |
| pwa | 76 | 2085 | 0 (Type Errors: none) | 53.33s |

These are EXACTLY wave 5's close-record figures (server 244/6131/56, agent 18/281, pwa 76/2085), so the
deltas this wave reports are measured against a baseline confirmed on this box, not inherited from a
prior wave's prose. No load flake shed on any of the three runs.


*(Filled AT EXECUTION, row by row, the moment each measurement is taken — never assembled at the end.
Wave 5 lost its whole record to a compaction between measuring and writing back, and the review, not the
record, is what found the gap. Sections: 9.1 full suites; 9.2 load-flake isolation; 9.3 typecheck; 9.4
the mutation table counted twice, plus the repaired-rows table; 9.5 the scanner suites; 9.6 the
self-review; 9.7 branch and PR; 9.8 the fingerprint.)*
