# Child-reclamation wave 5 — the closed run's reclaim chip (server read + pwa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator read what became of a child workspace once its run has closed. Each finished run row on `/runs` carries a chip: `reclaimed`, `pending`, `deferred`, `paused` or `refused`, with a sentence the server wrote. A reclaimed row stops offering to open a session that no longer exists. Each fleet line whose workspace is a child also says which run minted it.

**Architecture:** One wire field, one pure derivation, one composer, one reader.
1. **L0 (`shared/api.ts`):** the `ChildReclaimWord` / `ChildReclaimStatus` vocabulary from the contract, and `RunSummary.childReclaim: ChildReclaimStatus | null`. The field is additive. The store answers `null` for every row because it cannot see the registry or the sweep.
2. **Store (`server/src/coord/store.ts`):** `childReclaimEvents(sessionIds)` makes one read of the lifecycle mirror in **one statement** for the whole board, whatever the row count, using `INDEXED BY lifecycle_by_session`. It returns only `reclaim` and `create` rows.
3. **L1 (`server/src/coord/childReclaim.ts`):** the ONE pure function `childReclaimStatus(input)`, and `withChildReclaim`, which composes a whole board. The composer scopes the mirror to *this run's* workspace generation, because slugs are recycled, by calling wave 4's `childReclaimGeneration(events, run.closedAt)`: the programme's ONE fence, which this wave imports and never re-implements (contract §7 R6). Within that generation the deciding event is wave 4's `childReclaimLatest`, the programme's ONE "latest event" rule, which counts an `intent` too (contract §8 R21); this wave carries no latest-pick of its own. Every token sentence comes from the server's own two maps in their documented order, `lcRefusalWord(t) ?? refusalSentence(t)`. The mapping is contract §5's as the rulings of 2026-09-23 amend it (contract §7 R7, R16) and the second set amends again (contract §8 R16′, R19, R21, R4′): a fleet-wide pause reads `paused`; a review child answers the review-kept sentence while the run it reviewed is not terminal in the run list, absent included, and never the plain `pending` sentence; an `intent` newer than any outcome falls through to the row rule; every refusal the journal records reads `refused` with a server sentence, `no-worktree-record` among the terminal ones; and a sweep defer reads `deferred` from the sweep's first deferral of ANY kind, never the presence clock.
4. **Watcher (`server/src/watch.ts`):** one new read-only accessor, `currentChildMarks()`, taken from the registry listing the tick already made. It does no new I/O. The sweep's defers are read through wave 4's own `currentChildReclaimDefers()`, whose `firstDeferredAt` (the first deferral of any kind) is the one field the chip reads, never `firstPresenceDeferredAt`, the presence-only clock that drives the ceiling (contract §8 R4′). The fleet-wide switch through the existing `currentCoord()`'s wave-4 `reclaim` field; neither is redefined here. The token-kind lookup is wave 4's one export beside `CHILD_RECLAIM_TOKEN_KIND`, `childReclaimTokenKind`, imported as it stands (contract §7 R15): nothing moves.
5. **Route (`GET /api/runs`):** composes `childReclaim` over the rows it already read. It adds zero registry reads, zero ccd calls and at most one SQL statement. If the mirror read fails, the board still ships without the chip.
6. **PWA:** `childReclaimChip` in `runWords.ts` is the ONE tolerant reader. It renders the word and the server's sentence and maps no token. A `reclaimed` row renders inert. A socket-carried **vanish** re-reads the archive, which keeps the rule against polling. `SessionLine` gets a `child of run #N` label from `FleetSession.child`.

**Tech Stack:** TypeScript 7.0.2 (server) / ~6.0.2 (pwa), vitest 4, `node:sqlite` `DatabaseSync`, React 19, Fastify 5. No bash, no `ccd/ccd`, no agent change.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`: §5.9 ("A chip on the closed run's row…"), §8's wave-5 row, §4 (the naming rule), §5.1 (three answers, never two), §5.5 (the `no-worktree-record` rung), §5.6 (slugs recycle), §5.7 (presence and the bounded defer; the review child), §5.8 (the switch), §6 (the wire is additive).
**Contract:** `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings)
Every "contract §N" in this plan means that file: §5 (wave 5), §6 (rules every plan obeys), and §7–§8 (the rulings of 2026-09-23, which amend §1–§6). Every name below that crosses a wave boundary is the contract's, spelled exactly. The contract is a planning document: every CODE comment, test name and CSS comment this plan prescribes for a committed file cites the spec, never the contract (contract §8 R23).
**Programme ledger:** `docs/superpowers/programs/child-reclamation.md`.

---

## Entry conditions — measured BEFORE Task 1, on this workspace's own checkout

This wave reads what waves 1–4 ship and nothing else from them. It is planned against a tree where none of them exists yet (the tip at planning is `62d9c485`), so the first act is to prove they landed. Run each command from the workspace root:

```bash
grep -n "^export type ChildMark" shared/api.ts                                  # (a) wave 2: the three-way marker
grep -n "child: ChildMark" shared/api.ts server/src/registry.ts                 # (b) wave 2: FleetSession.child + SessionRecord.child
grep -n "| 'reclaim'" shared/api.ts                                             # (c) wave 3: LifecycleAct gained 'reclaim'
grep -n "export const CHILD_RECLAIM_TOKEN_KIND" server/src/coord/childReclaim.ts # (d) wave 3: the token classification
grep -n "'not-a-child'\|'containment-unproven'\|'tree-busy'" server/src/wsaudit.ts # (e) wave 3: sentences for the NEW tokens
grep -n "currentChildReclaimDefers(): ReadonlyMap<string, ChildReclaimSweepEntry>" server/src/watch.ts  # (f) wave 4: the sweep state, read-only
grep -n "^export const childReclaimTokenKind" server/src/coord/childReclaim.ts  # (g) wave 4: the ONE token-kind lookup, exported beside the table
grep -n "| 'pin-failed'\|| 'unit-still-active'" shared/api.ts                    # (h) wave 3: the two journal-only post-start failure tokens, with LC_REFUSAL_WORD words
grep -nE "^export (function|const) childReclaimGeneration\b" server/src/coord/childReclaim.ts  # (i) wave 4: the ONE generation fence (contract §7 R6)
grep -n "'review-report-live'" server/src/coord/childReclaim.ts                   # (j) wave 3: a review child is kept while its reviewed run is open (R16)
grep -n "reclaim: MarkerState" shared/api.ts                                      # (k) wave 4: CoordStatus.reclaim, the fleet-wide switch (R7)
grep -nE "^export (function|const) childReclaimLatest\b" server/src/coord/childReclaim.ts  # (l) wave 4: the ONE "latest event" rule, beside the fence (contract §8 R21)
grep -nE "'no-worktree-record': +'terminal'" server/src/coord/childReclaim.ts    # (m) wave 3: R19's token in CHILD_RECLAIM_TOKEN_KIND, terminal (contract §8 R19)
grep -rn "readonly firstPresenceDeferredAt" server/src                            # (n) wave 4: the sweep entry's SECOND clock, the one the chip must NOT read (contract §8 R4′)
```

Expected: every command prints at least one line. (f) is the accessor wave 4's plan produces *"for wave 5's `childReclaimStatus`"*. This wave consumes it and never redefines it. (g) is the lookup wave 4 exports beside wave 3's `CHILD_RECLAIM_TOKEN_KIND` (contract §7 R15: one token-kind reader; `watch.ts` imports it too). This wave imports it as it stands, moves nothing, and never re-spells it. (h) is where a `failed` reclaim's token gets its sentence: `LC_REFUSAL_WORD`, read through `lcRefusalWord` ahead of `refusalSentence` (Task 3). (i) is the fence Task 3's composer calls at each run's `closedAt`; wave 4's attention list calls the same function at now, and this wave carries no second one. (j) is wave 3's `childReclaimDecision` answer for a review child whose reviewed run is not terminal; the chip's `S.reviewKept` row says what that decision does, so it must exist before the chip says it. (k) is the field Task 5 reads through `currentCoord()` for the switch's `paused`. (l) is the helper Task 3's composer calls on the generation (i) answers: *"Within a generation, the latest `reclaim`-act event of ANY outcome decides, INCLUDING `intent`… ONE exported helper, `childReclaimLatest(events: readonly MirroredLifecycleEvent[]): MirroredLifecycleEvent | null`, beside `childReclaimGeneration` in `childReclaim.ts`, created by wave 4, imported by wave 5."* It lives in the same file this wave appends to, so "imported" means called where it stands; the wave-5 section picks no reclaim row itself. (m) proves the token table Task 3's rows are DERIVED from carries R19's fourteenth token; nothing in this wave counts the tokens. (n) proves wave 4 keeps the two clocks R4′ names, so Task 3's composer case that sets them apart measures the right field.

If any of (a)–(n) prints nothing, **STOP**. Do not create the missing piece here. Report which one and the command's output to the coordinator. A wave that fills in another wave's surface is a worker with a stale plan (worker skill).

---

## Global Constraints

These are copied from `CLAUDE.md`, the spec and the contract, verbatim wherever the value matters. Every task's requirements implicitly include this section.

- **The rulings of 2026-09-23 (contract §7, and the second set in contract §8, which amends §7 where they overlap) are settled, and this plan builds them.** Nothing in this wave waits on a coordinator ruling. The ones that bear here:
  - **R6, one generation fence.** *"ONE exported function in `server/src/coord/childReclaim.ts`, `childReclaimGeneration(events: readonly MirroredLifecycleEvent[], at: number): readonly MirroredLifecycleEvent[]`, created by WAVE 4 (the attention list reads it with `at` = now) and imported by WAVE 5 (the chip reads it with `at` = the run's `closedAt`). No second implementation."* Task 3 calls it; its source case and the step-4 `grep` hold that no create-row fence lives in the wave-5 section; the recycled-slug route case (Task 5, case 3) stays.
  - **R7, the chip's mapping.** Both readings accepted (the R6 fence; the pending row also requires that no open run names the session, else `null`). All four proposals accepted: *"a fleet-wide pause (`CoordStatus.reclaim === 'set'`) answers `paused`; a `refused` event with no token answers `refused` with a sentence saying ccd recorded no reason; a token this build cannot classify answers `refused` through `tokenSentence`'s fallback; an `intent`/`unknown` event falls through to the row rule. The `.sess-child` label takes the drafter's proposed shape (`color: var(--ink-tertiary); flex: none`, no truncation)."* Task 3 and Task 9 build them.
  - **R9, the citation tax is owed by every CITED file.** *"any insertion into a file the README or the frozen compaction-card corpus cites by line — `ccd/ccd` and `shared/api.ts` today; the census names the set — pays S6-R11 in the same task."* Measured at planning, the cited files this wave touches are `shared/api.ts` (paid in Task 1 Step 6) and `server/test/session-hook.test.ts`, whose Task 1 Step 6 edit lands in the census's own comment, below the corpus's highest anchor into that file (`server/test/session-hook.test.ts:7043-7056`, measured at planning; re-measured in Task 10 Step 3). No other file this wave touches is cited by line; Task 10 Step 3 derives the set rather than trusting this sentence.
  - **R14.** `isChildReclaimWord` is this wave's, in `shared/api.ts` only (Task 1). Wave 3's kebab scanner guard is `isChildReclaimKebab`, a different function this wave neither reads nor touches.
  - **R15, one token-kind reader.** *"Wave 4 EXPORTS `childReclaimTokenKind` from `server/src/coord/childReclaim.ts`… `watch.ts` imports it; no module-private copy exists at any wave; wave 5 imports it and moves nothing."*
  - **R16, a review child lives until the run it reviewed is terminal.** *"Wave 5's row for such a child answers `pending` with a sentence saying it is kept while the run it reviewed is open."* Task 3 builds the row, Task 5 proves it end to end.
  - **R16′, review-child edges (amends R16).** *"wave 5's chip answers the review-kept sentence (never `pending`) for any review child whose reviewed run is not terminal in the list, absent included."* So the composer asks "is the reviewed run TERMINAL in this list", never "is it open in this list": a reviewed run the list does not carry keeps the child, the same doubt-waits direction wave 4's sweep takes for a reviewed run absent from the database. The word stays R16's `pending`; "never `pending`" is read as never the plain `S.pending` answer, because no other word of the five says "kept on purpose" and R16′ names no new one. Task 3 carries a row for an OPEN reviewed run and a row for an ABSENT one.
  - **R19, a fourteenth token.** *"A child whose directory EXISTS but git has no worktree record answers the existing TERMINAL token `no-worktree-record`… which joins the vocabulary and `CHILD_RECLAIM_TOKEN_KIND` as `terminal`."* Task 3's token rows and Task 8's scan are DERIVED from `CHILD_RECLAIM_TOKEN_KIND`, so they pick it up with no edit; nothing in this wave hard-codes a token count (Task 3 Step 4 and Task 8 Step 2 say so where a count appears). Its sentence is the audit's existing one (`server/src/wsaudit.ts`'s `SENTENCES`), reached through `refusalSentence`.
  - **R21, one "latest event" rule.** *"Within a generation, the latest `reclaim`-act event of ANY outcome decides, INCLUDING `intent`: an `intent` newer than any outcome means an attempt is in flight or died mid-way, so… the chip falls through to the row rule."* Task 3's composer calls wave 4's `childReclaimLatest` on `childReclaimGeneration`'s answer, and carries no latest-pick of its own; an `intent`/`unknown` latest falls through to the row rule exactly as R7 has it.
  - **R4′, two clocks.** *"The sweep's in-memory entry keeps `firstDeferredAt` (the first deferral of ANY kind…) and a separate `firstPresenceDeferredAt` (presence-class deferrals only…— this alone drives the 15-minute ceiling)."* The chip's `deferred` row reads `firstDeferredAt` for its `at`, and `S.sweepDeferred` is true of any deferral: it names no presence cause and promises no bound, because only a presence-class wait is bounded.
  - **R23, the contract is committed.** Every "contract §N" here means `docs/superpowers/programs/child-reclamation-contract.md`; every code comment, test name and CSS comment this plan prescribes cites the spec, never the contract.

- **Deploy class for THIS wave: server + pwa, release lane.** The wave touches no `ccd/`, no `agent/`, no `deploy/` file, so it pays **no re-stamp** (`shared/mark.mjs`), which only a `ccd/ccd` edit owes; Task 10 Step 3 proves none was made. It **does** pay the citation-corpus tax once (`server/test/session-hook.test.ts`, procedure S6-R11), and not because of `ccd/ccd`: see the next bullet. It ships the way every build ships now: *"Every merge to `main` becomes a GitHub **prerelease** within about a minute… Moving the fleet is ONE act from a machine with ssh to both boxes: `ccrc rollout [--to vX.Y.Z] [--server-first] [--check] [--force]`"*. Task 10 Step 7 has the order.
- **`shared/api.ts` is a CITED file.** `README.md` anchors four operator pointers into it by line number: the purge-refusal sentence cites the three `LcRefusalToken` union arms `purge-refused`/`purge-incomplete`/`purge-mechanism-absent` as one range, and each one's `LC_REFUSAL_WORD` key. `server/test/session-hook.test.ts` audits that corpus. Its *README HAS ITS OWN CENSUS ENTRY, and it is EMPTY* case holds README's anchors to zero stale, and its *the citation debt moved* census counts the stale `shared/api.ts` anchors in the frozen spec/plan corpus. Task 1 inserts the chip vocabulary directly above `export interface RunSummary`, which is above every one of those anchors. So README's case goes red at Task 1's first run, and the census case goes red wherever a corpus document's anchor sits below the insertion. Task 1 Step 6 repairs them in the same commit (S6-R11): README is re-anchored BY CONTENT, and the census is re-measured. Never re-anchor by adding a delta to a number. Task 1 is the only task that inserts into `shared/api.ts`, so the repair is paid once.
- **This wave does nothing until waves 1–4 are on the boxes.** No marker means no child. No `reclaim` journal act means only `pending`, and only where wave 4's sweep state and wave 2's marker exist. Every chip is `null` on a box that has none of it, which is the no-regression baseline. There is no fallback path.
- **Naming (contract §0).** *"Every TypeScript identifier, file, CSS class and test file says `childReclaim` / `ChildReclaim` / `child-reclaim`. Never a bare `Reclaim*`/`reclaim*`: `server/src/coord/reclaim.ts`, `ReclaimRefuseCode`, `RECLAIM_REFUSE_CODES`, `RECLAIM_COPY` and `POST /api/runs/:id/reclaim` already mean *reassigning a dead coordinator's claim*."* The `SessionLine` label is about child-ness, not reclamation. Its class is `.sess-child` and its reader is `childOfRunLabel`.
- **The PWA maps no token (spec §5.9).** *"Refusal sentences come from a lookup keyed by the refusal token, never respelled at the surface — **and the lookup is the server's**. The PWA-reachable refusal words and the server's audit sentences are held disjoint by a test today, and several of this verb's tokens share names with the audit's. So the server composes the sentence and ships it with the status; the PWA renders what it is given and maps no token itself."* Task 8 turns this sentence into a red suite.
- **A reclaimed row is inert (spec §5.9).** *"A reclaimed child's row stops offering to open its session, which no longer exists."*
- **No polling on `/runs`.** `RunsScreen.tsx`'s own header: *"Polling would be a fourth cadence for data that changes on human timescales; this reads it once and lets the socket carry updates."* Task 7's re-read is a **diff against the previous fleet frame**, the same idiom as the existing run-id vanish diff. It is not a timer.
- **`ingestedAt` is never an event time (D8, `server/src/coord/schema.ts`):** *"`ingestedAt INTEGER NOT NULL,  -- THE SERVER'S clock. Never read as an event time (D8)"*. Generation scoping compares a `create` row's own `at` (ccd's clock) with `closedAt` (the server's clock). That is the cross-box window `CoordStore.runSignals` already reads lifecycle rows through: *"two NTP-disciplined boxes; the skew is bounded, not zero — a signal, not an invoice"*.
- **No overloaded null at a seam.** *"Two conditions a caller handles differently must not collapse to the same value; that's a defect, not style."* The registry view is three-way plus "never listed" (`ChildReclaimRowView`). A mirror read answers every requested id, so no caller has to supply a default for a missing key. The store's `childReclaim: null` equals the derivation's own answer on every path that carries it, and `RunSummary.childReclaim`'s docstring states that.
- **Wire discipline — additive-only, absence-permits.** *"frames are ADDITIVE; do NOT bump `FLEET_PROTO` (=1…) for a new field. A newer peer must tolerate an older peer omitting a field, through a SINGLE reader per field."* `RunSummary` is **cast, never revived**, both on the live frame and in `api.runs()`. So the PWA's one reader treats the field as optional, in the idiom of `runKindChip`, `runHomeProject` and `runWarnings`.
- **Rings / bounded contexts:** *"ring membership is a property of a file's IMPORTS, not its path… L0 `shared/*.ts` imports NOTHING… L4 delivery owns fastify/sockets/timers but is NOT allowed to DECIDE."* The route wires and degrades. `childReclaimStatus` decides.
- **Single-source-of-truth values are enumerated once and derived.** `CHILD_RECLAIM_WORDS` is `Object.keys` of a total table, following the precedent of `PR_REASONS = Object.keys(PR_REASON_MAP)`.
- **Mutation-table discipline:** *"a new guard ships WITH a test that goes RED when the guard is deleted/mutated (measured before/after, not a comment). Doctrine: 'A comment is a request; a red suite is a mechanism.' TDD red-first."* Every task ends in a mutation table: the exact edit, the command and the expected red. Revert each mutation before the next one.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, each run from inside its own directory:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`**, which resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang, and the suites are load-sensitive.
- **Known load flakes** (real suites; re-run each IN ISOLATION before calling it a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. CI on the quiet box is the arbiter.
- **In tests, use FIXTURE HOMEs only. Never run `ccd` against the live `$HOME`.** Every server test below builds its home with `mkTmp(...)` (`server/test/tmpHelpers.ts`) and its deps with `testDeps(home)` (`server/test/helpers.ts`). `testDeps` wraps the runner in `guardRunner`, and no test in this wave runs a real ccd verb.
- **NEVER run destructive `ccd` verbs against the live host** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`, and now `ws-reclaim`). **Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly**, and never print secret file CONTENTS.
- **Branch discipline:** *"A worker commits on its workspace branch, **never a separate feature branch** (a feature branch wedges every close with `stale-tip`)."* That means one commit per task, on this workspace's own branch.
- **Locate code by CONTENT.** Line numbers below are hints *as of `62d9c485`*, never addresses. Two other programmes are live against these files.
- **Topology-clean:** no hostnames, IPs, tailnet names or docserver URLs anywhere in a committed file, this plan included.
- **`## Deviations found` numbers are ISSUED, never chosen.** See that section at the foot of this plan.

---

## Measured at planning: the chip's read is ONE statement, and why

The brief warned about N+1. The board read already pays for itself: `runs({includeClosed:true})` returns every open run plus up to 500 closed ones. `CoordStore.runHealth`'s docstring prices a per-row read at *"~3,000 [statements] for one board load"*, which is why health is batched *"in FOUR statements TOTAL"* (D-1299). The chip must not re-open that.

Three shapes were measured on node 24.14.1's `node:sqlite`, in memory. The table was the real `lifecycle_events` DDL with its three indexes and 500,000 rows over 2,000 sessions, about 250 events each, which is pessimistic for a short-lived child. The read was for 500 closed runs over 500 distinct sessions, and the script was run twice:

| Shape | 500k rows (run 1 / run 2) | 100k rows |
|---|---|---|
| one batched statement, per-run correlated subqueries doing the generation scoping in SQL (three index walks per run) | 751 / 210 ms | 126 / 42 ms |
| a per-run loop, 500 prepared `.get()`s | 294 / 203 ms | 48 ms |
| **ONE `WHERE sessionId IN (…) AND act IN ('reclaim','create')` statement, generation scoping in TS** | **129 / 114 ms** | **22 / 21 ms** |

The same script moved from 751 to 210 ms between two runs, so only the **order** is claimed, not the numbers. The chosen shape walks each session's history once. The correlated shape walks it three times per run. Scoping in TS also lets the chip use the ONE generation fence the programme has, wave 4's pure `childReclaimGeneration` (contract §7 R6), rather than a SQL copy of it; Task 3 calls it at each run's `closedAt`.

`EXPLAIN QUERY PLAN` for the chosen text is `SEARCH lifecycle_events USING INDEX lifecycle_by_session (sessionId=?)`. With `NOT INDEXED` in place of the hint it is `SCAN lifecycle_events | USE TEMP B-TREE FOR ORDER BY`, and that is Task 2's mutation row. The hint mirrors `recentProvenance`'s `INDEXED BY lifecycle_by_at`. Today's planner picks the index without the hint. The hint keeps that choice independent of `ANALYZE` statistics.

The registry answer costs **nothing**: the route reads the watcher's in-memory copy of the listing the 2 s tick already made, never `readRegistry`. That call is *"721 agent-WS operations"* on a 24-session fleet in remote mode (`registry.ts`). There are no ccd calls.

The measurement script, re-runnable from the scratchpad with `node measure.mjs 500000`. It is not committed:

```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, gen TEXT NOT NULL, at INTEGER, ingestedAt INTEGER NOT NULL,
  act TEXT NOT NULL, badact TEXT, outcome TEXT NOT NULL, badoutcome TEXT, verb TEXT, sessionId TEXT, tx TEXT,
  refusal TEXT, detail TEXT, truncated INTEGER NOT NULL DEFAULT 0, obsJson TEXT, decJson TEXT, measJson TEXT, raw TEXT NOT NULL);
CREATE INDEX lifecycle_by_session ON lifecycle_events(sessionId, id);
CREATE INDEX lifecycle_by_tx ON lifecycle_events(tx);
CREATE INDEX lifecycle_by_at ON lifecycle_events(at);`);
const ROWS = Number(process.argv[2] ?? 500000), SESS = 2000;
const acts = ['ensure', 'start', 'swap', 'hold', 'release', 'spawn', 'supervise', 'route'];
const ins = db.prepare('INSERT INTO lifecycle_events (gen, at, ingestedAt, act, outcome, sessionId, raw) VALUES (?,?,?,?,?,?,?)');
db.exec('BEGIN');
let t = 1_755_000_000_000;
for (let i = 0; i < ROWS; i++) {
  t += 60;
  const act = i < SESS ? 'create' : (i % 97 === 0 ? 'reclaim' : acts[i % acts.length]);
  ins.run('g', t, t, act, act === 'reclaim' ? 'refused' : 'done', `demo-s${i % SESS}`, '{}');
}
db.exec('COMMIT');
const runs = Array.from({ length: 500 }, (_, k) => ({ runId: k + 1, sid: `demo-s${k * 3}`, closedAt: 1_755_000_000_000 + 60 * ROWS * 0.6 }));
const COLS = 'e.id, e.act, e.outcome, e.refusal, e.at, e.ingestedAt';
const HINT = 'INDEXED BY lifecycle_by_session';
const sub = (h) => `(SELECT x.id FROM lifecycle_events x ${h} WHERE x.sessionId = q.sid AND x.act = 'reclaim' `
  + `AND x.id > COALESCE((SELECT MAX(c.id) FROM lifecycle_events c ${h} WHERE c.sessionId = q.sid AND c.act = 'create' AND c.at IS NOT NULL AND c.at <= q.closedAt), 0) `
  + `AND x.id < COALESCE((SELECT MIN(c.id) FROM lifecycle_events c ${h} WHERE c.sessionId = q.sid AND c.act = 'create' AND c.at IS NOT NULL AND c.at > q.closedAt), 9223372036854775807) `
  + 'ORDER BY x.id DESC LIMIT 1)';
const batched = (n) => `WITH q(runId, sid, closedAt) AS (VALUES ${Array.from({ length: n }, () => '(?,?,?)').join(',')}) `
  + `SELECT q.runId AS runId, ${COLS} FROM q JOIN lifecycle_events e ON e.id = ${sub(HINT)}`;
const time = (label, fn) => { const t0 = performance.now(); for (let k = 0; k < 5; k++) fn(); console.log(label, ((performance.now() - t0) / 5).toFixed(2), 'ms/load'); };
time('correlated batch', () => db.prepare(batched(runs.length)).all(...runs.flatMap((r) => [r.runId, r.sid, r.closedAt])));
const one = db.prepare(`SELECT ${COLS} FROM (SELECT 1 AS runId, ? AS sid, ? AS closedAt) q JOIN lifecycle_events e ON e.id = ${sub(HINT)}`);
time('per-run loop', () => { for (const r of runs) one.get(r.sid, r.closedAt); });
const sids = [...new Set(runs.map((r) => r.sid))];
const inSql = `SELECT id, act, outcome, refusal, at, ingestedAt, sessionId FROM lifecycle_events ${HINT} `
  + `WHERE sessionId IN (${sids.map(() => '?').join(',')}) AND act IN ('reclaim','create') ORDER BY sessionId, id`;
time('one IN statement', () => db.prepare(inSql).all(...sids));
console.log(db.prepare('EXPLAIN QUERY PLAN ' + inSql).all(...sids).map((r) => r.detail).join(' | '));
```

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `shared/api.ts` | Modify (directly above `export interface RunSummary`; one field appended to `RunSummary` after `health`) | L0 home of `ChildReclaimWord`, `CHILD_RECLAIM_WORDS`, `isChildReclaimWord`, `ChildReclaimStatus`, and `RunSummary.childReclaim` |
| `server/src/coord/store.ts` | Modify (`hydrateRun`'s literal; `lifecycleFor` refactored onto a shared mapper; new `childReclaimEventsSql` + `childReclaimEvents` beside `lifecycleFor`) | The store answers `childReclaim: null`, and makes the board's one mirror read |
| `server/src/coord/childReclaim.ts` | Modify (append a wave-5 section at the end of the file, below `childReclaimDecision` and wave 4's exports) | The ONE derivation: `childReclaimStatus`, `childReclaimSessions`, `withChildReclaim`, `CHILD_RECLAIM_STATUS_SENTENCE`. It calls wave 4's exported `childReclaimGeneration` (contract §7 R6), `childReclaimLatest` (contract §8 R21) and `childReclaimTokenKind` (R15) where they stand, and re-spells none |
| `server/src/watch.ts` | Modify (Task 4 only: one field beside `coord`; one assignment after `const records = registryRead.records;`; one accessor beside `currentCoord()`) | `currentChildMarks()`: in-memory, no new I/O. The defers are wave 4's `currentChildReclaimDefers()`, unchanged |
| `server/src/coord/routes.ts` | Modify (`GET /api/runs`'s tail; one closure beside it) | Composes `childReclaim` onto the rows it already read, with the watcher's marks, defers and fleet-wide switch, and degrades on a failed mirror read |
| `pwa/src/fleet/runWords.ts` | Modify (append a wave-5 section) | `CHILD_RECLAIM_GLYPH`, `childReclaimChip` (THE ONE READER), `childReclaimTitle`, `childReclaimGone`, `childReclaimRefreshDue`, `childOfRunLabel` |
| `pwa/src/screens/RunsScreen.tsx` | Modify (the `runWords` import; `RunRow`'s body and return; one effect after the run-id vanish effect) | Renders the chip, makes a reclaimed row inert, re-reads the archive when a finished child's session vanishes |
| `pwa/src/fleet/SessionLine.tsx` | Modify (one import; one derived value beside `qualifier`; one cell after `.sess-held`) | The `child of run #N` label |
| `pwa/src/fleet/fleet.css` | Modify (three `.run-row .run-child-reclaim*` rules after `.run-row .run-resumed`; `.sess-child`, in `.sess-substrate`'s shape (contract §7 R7), after the `.sess-substrate` rule; one line in `.sess-line--active`'s achromatic group) | The chip's, sentence line's and label's ink. The run-row rules are grounded by the named-ancestor route; `.sess-child` is grounded by its `INHERITED_GROUNDS` entry |
| `pwa/design/audit.mjs` | Modify (one `INHERITED_GROUNDS` entry, `'fleet.css .sess-child'`, above `'fleet.css .sess-spawn'`) | Grounds the label on the project card, so the contrast gate measures it instead of counting it uncovered |
| `server/test/reconstruction-drill.test.ts` | Modify (`RUN_SUMMARY_KEYS` + its cardinal, 24 → 25) | The compile-time census of `RunSummary` moves with the field |
| `README.md` | Modify (the four `shared/api.ts` anchors in the purge-refusal sentence, re-anchored by content; Task 1) | Its operator pointers still name the lines their sentence quotes |
| `server/test/session-hook.test.ts` | Modify (the citation-debt census's `shared/api.ts` entry and its sum, re-measured, with the argued comment; Task 1) | The citation debt Task 1's `shared/api.ts` insert creates is measured, not hidden |
| `pwa/test/{abandon-sheet,fleet-screen,pr-sheet,project-card,resume-sheet,runs-screen,tap-targets}.test.tsx`, `pwa/test/nestFleet.test.ts`, `pwa/test/runs-health.test.tsx` | Modify (one key in each `RunSummary` builder) | `pwa`'s `tsc` covers `test/`, and a builder missing a required field is TS2741 |
| `server/test/child-reclaim-wire.test.ts` | Create | The word vocabulary; the store ships `childReclaim: null` |
| `server/test/child-reclaim-events-store.test.ts` | Create | Every id answered; only the two acts; one statement; the pinned plan |
| `server/test/child-reclaim-status.test.ts` | Create | The table-driven pin over **every mapping row** (as contract §7 R7 and R16 amend it, and contract §8 R16′, R19, R21 and R4′ amend again), the composer's calls to wave 4's generation fence and latest-event rule, and the composer |
| `server/test/child-reclaim-watch-view.test.ts` | Create | `currentChildMarks()` against real ticks over a fixture registry |
| `server/test/child-reclaim-runs-route.test.ts` | Create | `GET /api/runs` end to end: reclaimed, refused, recycled slug, pending, deferred, the fleet-wide switch's paused, a review child kept, null, the active-only read, the degrade |
| `server/test/child-reclaim-chip-source.test.ts` | Create | The PWA spells no ws-reclaim token and imports no server sentence; `RunSummary.childReclaim` has one PWA reader |
| `pwa/test/runs-screen.test.tsx` | Modify (append describes) | The chip reader, the row, the inert row, the vanish re-read |
| `pwa/test/session-line.test.tsx` | Modify (append a describe) | The label's three answers and its tolerance |
| `pwa/test/fleet-css.test.ts` | Modify (the living-panes list; the achromatic list; one new `it`) | The new rules exist, never glow, and take priced ink |
| `pwa/test/contrast.test.ts` | Modify (append one describe) | `.sess-child` is registered, measured in both themes, and absent from the uncovered census |

---

### Task 1: The wire vocabulary: `ChildReclaimWord`, `ChildReclaimStatus`, `RunSummary.childReclaim`

**Model routing:** `sonnet`, effort `medium`. The task is transcription-grade except the `hydrateRun` argument, which Step 4 writes out.

**Files:**
- Modify: `shared/api.ts` (directly above `export interface RunSummary`, at ~5540 as of `62d9c485`; plus one field at the end of that interface)
- Modify: `server/src/coord/store.ts` (`hydrateRun`'s returned literal, ~2578)
- Modify: `server/test/reconstruction-drill.test.ts` (`RUN_SUMMARY_KEYS`, ~314)
- Modify: nine PWA test builders (Step 5)
- Modify: `README.md` (the four `shared/api.ts` anchors, re-pointed by content) and `server/test/session-hook.test.ts` (the citation-debt census's `shared/api.ts` entry and its sum, re-measured). Both are Step 6's S6-R11 repair, owed because Step 3 inserts above every anchor README holds into `shared/api.ts`
- Test: `server/test/child-reclaim-wire.test.ts` (new)

**Interfaces:**
- Produces (contract §5, verbatim):
  ```ts
  export type ChildReclaimWord = 'reclaimed' | 'pending' | 'deferred' | 'paused' | 'refused';
  export interface ChildReclaimStatus { readonly word: ChildReclaimWord; readonly sentence: string | null; readonly at: number | null }
  ```
  plus `CHILD_RECLAIM_WORDS: readonly ChildReclaimWord[]`, `isChildReclaimWord(v: unknown): v is ChildReclaimWord`, and `RunSummary.childReclaim: ChildReclaimStatus | null`.
- Consumes: nothing from earlier waves.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-wire.test.ts`:

```ts
// Child-reclamation wave 5, Task 1: the chip's wire vocabulary (spec §5.9).
//
// `ChildReclaimWord` is spelled ONCE, as the keys of a total table in
// shared/api.ts, and the runtime list is DERIVED from it. `RunSummary.childReclaim`
// leaves the STORE as null for every row: the answer needs the registry's marker
// and the sweep's in-memory defer, and the store sees neither. GET /api/runs is
// the one composer (Task 5).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { CHILD_RECLAIM_WORDS, isChildReclaimWord } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { okRuns } from './coordReadHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cr-wire-'), '.ccrc', 'coord.db')));

describe('the child-reclaim word vocabulary (wave 5, spec §5.9)', () => {
  it('is exactly the five words the spec names, derived from one table', () => {
    expect([...CHILD_RECLAIM_WORDS].sort()).toEqual(['deferred', 'paused', 'pending', 'reclaimed', 'refused']);
  });

  it('guards membership through the derived list — a newer word is not one of ours', () => {
    for (const w of CHILD_RECLAIM_WORDS) expect(isChildReclaimWord(w)).toBe(true);
    expect(isChildReclaimWord('evicted')).toBe(false);
    expect(isChildReclaimWord(undefined)).toBe(false);
    expect(isChildReclaimWord(3)).toBe(false);
  });
});

describe('RunSummary.childReclaim leaves the store as null (the store cannot compose it)', () => {
  it('hydrates every row, open and closed, with the key present and null', () => {
    const s = store();
    const a = s.openRun({ program: 'w5-wire', title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 2,
                          claimedBy: 'ccrc-pwa-coordinator' }) as { id: number };
    s.openRun({ program: 'w5-wire', title: 'W5', project: 'ccrc-pwa', wave: 2, waveOf: 2,
                claimedBy: 'ccrc-pwa-coordinator' });
    s.dispatchRun({ runId: a.id, sessionId: 'ccrc-pwa-quiet-mesa', workspace: 'quiet-mesa',
                    branch: 'ws/quiet-mesa', resumed: false, clearedAt: null, items: [] });
    expect(s.closeRun({ runId: a.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                        program: 'w5-wire', viaClosing: true }).ok).toBe(true);
    const wire = okRuns(s.runs({ includeClosed: true })).map((r) => toRunSummary(r));
    expect(wire).toHaveLength(2);
    for (const r of wire) {
      expect(Object.keys(r)).toContain('childReclaim');
      expect(r.childReclaim).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-wire.test.ts`

Expected: FAIL, 3 of 3. vitest resolves a missing named export to `undefined` rather than refusing the import:
- case 1: `TypeError: CHILD_RECLAIM_WORDS is not iterable`
- case 2: `TypeError: CHILD_RECLAIM_WORDS is not iterable`
- case 3: `AssertionError: expected [ 'id', 'program', …(22) ] to include 'childReclaim'`

- [ ] **Step 3: Add the L0 vocabulary and the field**

In `shared/api.ts`, **directly above** `export interface RunSummary {` (find it with `grep -n "^export interface RunSummary" shared/api.ts`), insert:

```ts
/* ── child-workspace reclamation: the closed run's chip (wave 5, spec §5.9) ── */

/**
 * What became of a CHILD workspace once its run closed, in the five words spec
 * §5.9 names. THE SERVER CHOOSES THE WORD AND COMPOSES THE SENTENCE
 * (`childReclaimStatus`, `server/src/coord/childReclaim.ts`). The PWA renders
 * both and maps no ws-reclaim refusal token itself. Several of that verb's
 * tokens share names with the audit's, whose sentences are server-only, and the
 * PWA-reachable journal words (`LC_REFUSAL_WORD`) are held DISJOINT from them by
 * a red suite. So the phone can say the server's sentence only by being
 * handed it.
 *
 * Spelled ONCE, as the keys of a total table. `CHILD_RECLAIM_WORDS` is derived
 * (`single-definition`'s doctrine), so adding a word here is a compile error at
 * every total `Record<ChildReclaimWord, …>` the PWA keeps.
 */
export type ChildReclaimWord = 'reclaimed' | 'pending' | 'deferred' | 'paused' | 'refused';
const CHILD_RECLAIM_WORD_TABLE: Readonly<Record<ChildReclaimWord, true>> = {
  reclaimed: true, pending: true, deferred: true, paused: true, refused: true,
};
export const CHILD_RECLAIM_WORDS: readonly ChildReclaimWord[] =
  Object.keys(CHILD_RECLAIM_WORD_TABLE) as ChildReclaimWord[];
/** Use THIS, never `CHILD_RECLAIM_WORDS.includes(x as ChildReclaimWord)` — `isRunState`'s rule. */
export function isChildReclaimWord(v: unknown): v is ChildReclaimWord {
  return typeof v === 'string' && (CHILD_RECLAIM_WORDS as readonly string[]).includes(v);
}

/**
 * One closed run's chip. `sentence` is the server's, verbatim. It is null only
 * where the server had none to give. `at` is epoch ms, and its source depends
 * on the word:
 *   • a word read off the lifecycle mirror takes the journal event's own `at`
 *     (ccd's clock), and is null when the line carried none;
 *   • a defer the sweep is holding takes the sweep's FIRST deferral of any
 *     kind (the server's clock), never the presence-only clock the defer
 *     ceiling runs on;
 *   • every other word has `at: null`.
 * It is NEVER `ingestedAt`, which is the mirror's own clock and never an event
 * time (D8).
 */
export interface ChildReclaimStatus {
  readonly word: ChildReclaimWord;
  readonly sentence: string | null;
  readonly at: number | null;
}

```

Then, inside `export interface RunSummary`, **after** the `health: RunHealth;` member and before the closing `}`, add:

```ts

  /**
   * Child-reclamation wave 5 (spec §5.9): what became of this run's CHILD
   * workspace. `null` means there is nothing to say: the run is still open, its
   * workspace is not a child, or nothing about it is known yet.
   *
   * COMPOSED BY `GET /api/runs` AND NOWHERE ELSE. The store answers `null` for
   * every row (`hydrateRun`), because the answer needs the registry's child
   * marker and the sweep's in-memory defer, and the store sees neither. Every
   * OTHER emitter of a `RunSummary` carries only runs for which the derivation's
   * own answer is `null` too (`childReclaimStatus`'s first rule: a non-terminal
   * run says nothing). Those emitters are the live `{type:'runs'}` frame and its
   * cold-start copy, both active-only by construction, and the advance route's
   * echo, which never reaches a terminal state (`ADVANCE_TARGETS`). So that
   * `null` is the same answer, not a second meaning.
   *
   * ADDITIVE; `FLEET_PROTO` is not bumped. REQUIRED here for `health`'s reason
   * (`hydrateRun` returns a literal). OPTIONAL at the PWA's one reader,
   * `childReclaimChip` (`pwa/src/fleet/runWords.ts`), because an older server
   * omits it and a `RunSummary` is cast, never revived.
   */
  childReclaim: ChildReclaimStatus | null;
```

- [ ] **Step 4: The store answers null**

In `server/src/coord/store.ts`'s `private hydrateRun(m: MeasuredRunRow, health: RunHealth): RunRow`, find the returned literal's `health,` member (the comment above it begins `// F7. Passed IN rather than measured here`) and add directly after `health,`:

```ts
      // Child-reclamation wave 5: NOT composed here. See `RunSummary.childReclaim`:
      // the answer needs the registry's child marker and the sweep's in-memory
      // defer, and this class sees neither. `GET /api/runs` replaces this for
      // every row it ships; every other emitter carries only non-terminal runs,
      // for which the derivation answers null as well.
      childReclaim: null,
```

`toRunSummary` needs no edit. It is a spread that strips `prLineage` and `coordProject`, and the new key rides through it.

- [ ] **Step 5: Move the census and the fixtures that `tsc` holds to the type**

`server/test/reconstruction-drill.test.ts`: the `RUN_SUMMARY_KEYS: Record<keyof RunSummary, true>` literal gains `childReclaim: true` after `health: true,`, and its cardinal moves. Replace

```ts
      health: true,
    };
    // Bumped 22 -> 24: `kind`/`reviews` (design 2026-09-14 §5.1, task 3).
    expect(Object.keys(RUN_SUMMARY_KEYS).length).toBe(24);
```

with

```ts
      health: true,
      childReclaim: true,
    };
    // Bumped 22 -> 24: `kind`/`reviews` (design 2026-09-14 §5.1, task 3).
    // Bumped 24 -> 25: `childReclaim` (child-reclamation wave 5). It is NOT in
    // UNRECOVERABLE above, and deliberately so. Nothing stores it: GET /api/runs
    // derives it on every read, and a reconstructed run carries
    // `closedAt: null` (UNRECOVERABLE), which `withChildReclaim` looks no event
    // up for. So a rebuilt board shows no chip on those rows. That is
    // silence, not a wrong answer.
    expect(Object.keys(RUN_SUMMARY_KEYS).length).toBe(25);
```

`pwa`'s `tsconfig.json` includes `test/`, so every `RunSummary` builder in `pwa/test` must carry the new key. As of `62d9c485` there are nine. Eight end their `health` literal with `coordKickoffPendingSince: null },` exactly once, and `runs-health.test.tsx` uses `health: HEALTHY`:

```bash
cd pwa
perl -0pi -e 's/coordKickoffPendingSince: null \},/coordKickoffPendingSince: null }, childReclaim: null,/' \
  test/abandon-sheet.test.tsx test/fleet-screen.test.tsx test/nestFleet.test.ts test/pr-sheet.test.tsx \
  test/project-card.test.tsx test/resume-sheet.test.tsx test/runs-screen.test.tsx test/tap-targets.test.tsx
perl -0pi -e 's/health: HEALTHY, \.\.\.over,/health: HEALTHY, childReclaim: null, ...over,/' test/runs-health.test.tsx
grep -c "childReclaim: null" test/*.ts test/*.tsx | grep -v ':0$'
```

Expected: nine lines, each ending `:1`. If a later programme added a builder, Step 7's `tsc` names it as `TS2741: Property 'childReclaim' is missing`. Add the key there the same way.

- [ ] **Step 6: Pay the citation tax on `shared/api.ts` (S6-R11): README by content, the debt census by measurement**

Step 3's insertion lands above every anchor README holds into `shared/api.ts` (Global Constraints), and this wave inserts into that file nowhere else. So the repair is made once, here, by CONTENT, never by adding a line delta to a number. Run it from the workspace root, in one shell.

(a) Measure where README's four anchors stood at the base and where those same bytes stand now, and prove the bytes are identical:

```bash
BASE=$(git merge-base HEAD origin/main)
OLD_U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://')
OLD_M=$(sed -n '/`purge-mechanism-absent` (`shared\/api\.ts:/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
NEW_U=$(grep -nE "^  \| 'purge-(refused|incomplete|mechanism-absent)'" shared/api.ts | cut -d: -f1 | paste -sd' ')
NEW_M=$(grep -nE "^  'purge-(refused|incomplete|mechanism-absent)':$" shared/api.ts | cut -d: -f1 | paste -sd' ')
echo "old union ${OLD_U}  old map ${OLD_M}  |  new union ${NEW_U}  new map ${NEW_M}"
read -r U1 _ U3 <<<"$NEW_U"; read -r M1 M2 M3 <<<"$NEW_M"; read -r OM1 OM2 OM3 <<<"$OLD_M"
diff <(git show "$BASE:shared/api.ts" | sed -n "${OLD_U/-/,}p;${OM1}p;${OM2}p;${OM3}p") \
     <(sed -n "${U1},${U3}p;${M1}p;${M2}p;${M3}p" shared/api.ts) && echo SAME-BYTES
```

Expected: one README union range and three map numbers, which are whatever waves 2 and 3 left them at (read them from this output, never from a plan); three new union lines, consecutive, and three new map lines, every one below its old number by the SAME count (the net lines Step 3 inserted); then `SAME-BYTES`. If the `diff` prints anything, or the four old numbers do not all move by one count, STOP: the anchors' bytes moved or changed in a way this procedure cannot repair by position. Report it in the wave-done mail.

(b) Re-point README to the bytes, in the same shell:

```bash
perl -pi -e "s/shared\/api\.ts:${OLD_U}\`/shared\/api.ts:${U1}-${U3}\`/; s/\`:${OM1}\`/\`:${M1}\`/; s/\`:${OM2}\`/\`:${M2}\`/; s/\`:${OM3}\`/\`:${M3}\`/" README.md
git diff --stat -- README.md
```

Expected: `README.md | 4 ++--`, the two lines of the purge-refusal sentence and nothing else.

(c) Re-measure the census:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: *README HAS ITS OWN CENSUS ENTRY, and it is EMPTY* PASSES. *the citation debt moved — re-measure, and lower the census rather than the rule* may be RED. If it is, its received map differs from the expected one in the `'shared/api.ts'` entry only: the frozen spec/plan corpus cites `shared/api.ts` by line, and Step 3 moved lines under those anchors. *the narrated headline is the sum of the census* is then red by the same difference. No corpus document may be re-pointed, because each is byte-identical to `origin/main`. So this is a RE-MEASUREMENT under the standing rule, not a rule change and not a deviation. If both cases are already green, skip (d) and say so in the wave-done mail.

(d) In `server/test/session-hook.test.ts`, replace the `'shared/api.ts'` entry's value in that `byFile` map with the RECEIVED value, and put this comment directly above it. Fill in the two numbers from the red, never from this plan:

```ts
      // RE-MEASURED at child-reclamation wave 5 (S6-R11, no rule changed, no
      // D-number): `shared/api.ts` <old> -> <new>. This wave inserted the reclaim
      // chip's vocabulary (`ChildReclaimWord`, `CHILD_RECLAIM_WORDS`,
      // `isChildReclaimWord`, `ChildReclaimStatus`) directly above
      // `export interface RunSummary`, and `RunSummary.childReclaim`'s docstring
      // inside it, above anchors the frozen spec/plan corpus cites by line. No
      // corpus document may be re-pointed (byte-identical to `origin/main`).
      // README's four anchors into the same file were RE-ANCHORED BY CONTENT in
      // the same commit (the three `LcRefusalToken` purge arms and their three
      // `LC_REFUSAL_WORD` keys, `diff`-proved byte-identical), so README
      // contributes nothing here.
```

`server/test/session-hook.test.ts` is itself a CITED file (contract §7 R9): the frozen corpus anchors into it by line, and its highest such anchor sits far above the `byFile` census (`server/test/session-hook.test.ts:7043-7056` at planning). This comment and the value edit land inside the census, below every one of those anchors, so they move none; Task 10 Step 3 proves it on the tree that ships. Never put a line of this repair above that anchor.

Set the sum's `.toBe(<n>)` to the received total. Re-run (c). Expected: PASS. Any OTHER red in this file that names a `shared/api.ts` anchor is the same tax: re-measure it the same way and name it in the wave-done mail. Never widen a rule to make it green. `session-hook` is a known load flake, so a red that does NOT name `shared/api.ts` gets an isolated re-run before anything else.

- [ ] **Step 7: Run the test, then both type-checks**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-wire.test.ts test/reconstruction-drill.test.ts \
  test/session-hook.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa    && npm ci && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts test/single-definition.test.ts
```

Expected: every vitest file PASS (`child-reclaim-wire` 3/3; `session-hook` green only with Step 6 applied). Both `tsc` runs print nothing and exit 0. `typecheck-tests` and `session-hook` are known load flakes: re-run each in isolation before calling it red.

- [ ] **Step 8: Mutation check, then commit**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `CHILD_RECLAIM_WORD_TABLE`, delete `paused: true, ` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-wire.test.ts` | case 1: `expected [ 'deferred', 'pending', …(2) ] to deeply equal [ 'deferred', 'paused', …(3) ]` (and `tsc`: TS2741 on the table) |
| 2 | In `hydrateRun`, delete the `childReclaim: null,` line | same | case 3: `expected [ 'id', 'program', …(22) ] to include 'childReclaim'` (and `tsc`: TS2741 on the literal) |
| 3 | In `reconstruction-drill.test.ts`, delete `childReclaim: true,` | `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts` | TS2741 `Property 'childReclaim' is missing` reported against `reconstruction-drill.test.ts` |

Revert each mutation, then:

```bash
git add shared/api.ts server/src/coord/store.ts server/test/child-reclaim-wire.test.ts \
  server/test/reconstruction-drill.test.ts pwa/test/*.test.ts pwa/test/*.test.tsx \
  README.md server/test/session-hook.test.ts
git commit -m "$(cat <<'MSG'
feat(runs): the child-reclaim chip's wire vocabulary

RunSummary gains childReclaim (spec §5.9): one of five server-chosen words
with a server-composed sentence, or null. The words are spelled once, as a
total table's keys, and the runtime list is derived. The store answers null
for every row. It cannot see the registry marker or the sweep's defer, and
GET /api/runs is the one composer. Additive; FLEET_PROTO unchanged.
README's shared/api.ts anchors re-pointed by content; the citation-debt
census re-measured (S6-R11).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `CoordStore.childReclaimEvents`: the board's one mirror read

**Model routing:** `sonnet`, effort `high`. The statement shape and its plan pin are the cost argument above.

**Files:**
- Modify: `server/src/coord/store.ts`. Add a module-level `LcRowDb` interface beside the other `*Db` row types (find them with `grep -n "^interface RunRowDb\|^type RunRowDb\|RunRowDb =" server/src/coord/store.ts`). Add `private static toMirrored`, and refactor `lifecycleFor` onto it. Add `childReclaimEventsSql` + `childReclaimEvents` directly after `lifecycleFor` (~4254). Add `type LifecycleAct` to the `../../../shared/api.js` import if it is absent.
- Test: `server/test/child-reclaim-events-store.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  static childReclaimEventsSql(sessions: number): string;
  childReclaimEvents(sessionIds: readonly string[]): Map<string, MirroredLifecycleEvent[]>;
  ```
  The contract is that EVERY requested id gets an entry (`[]` when the mirror holds nothing), holding only `reclaim` and `create` rows, oldest-first by the mirror's own `id`, in ONE statement.
- Consumes: wave 3's `'reclaim'` member of `LifecycleAct` (entry condition c).

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-events-store.test.ts`:

```ts
// Child-reclamation wave 5, Task 2: the reclaim chip's ONE read of the
// lifecycle mirror. The table is NEVER PRUNED (schema.ts), and the board read
// already spends several statements per row, so this read must cost ONE
// statement for the whole board whatever the row count (D-1299's budget for
// `runHealth`), and must seek rather than scan.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cr-ev-'), '.ccrc', 'coord.db')));

const GEN = '1758500000000000000';
const A = 'ccrc-pwa-quiet-mesa';
const B = 'ccrc-pwa-clear-cove';
const T = 1_758_500_000_000;

let seq = 0;
const line = (sessionId: string, act: string, outcome: string, at: number,
              over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({ uid: `w5ev.1.${++seq}`, at, act, outcome, id: sessionId, ...over }));

/** One ingest per fixture, the shape `lifecycle-store.test.ts` drives the mirror with. */
const seedMirror = (s: CoordStore): void => {
  const rows = [
    line(A, 'create', 'done', T),
    line(A, 'ensure', 'done', T + 1),
    line(A, 'reclaim', 'refused', T + 2, { refusal: 'held' }),
    line(A, 'swap', 'done', T + 3),
    line(A, 'reclaim', 'done', T + 4),
    line(B, 'create', 'done', T + 5),
    line(B, 'hold', 'done', T + 6),
  ];
  s.ingestJournal({ gen: GEN, rows, cursor: 700, size: 700, at: 9 });
};

describe('CoordStore.childReclaimEvents (wave 5)', () => {
  it('answers EVERY requested session, an empty list included — no caller supplies a default', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [line(A, 'reclaim', 'done', T)], cursor: 100, size: 100, at: 9 });
    const got = s.childReclaimEvents([A, B]);
    expect([...got.keys()].sort()).toEqual([B, A].sort());
    expect(got.get(B)).toEqual([]);
    expect(got.get(A)!.map((e) => e.act)).toEqual(['reclaim']);
  });

  it('returns only reclaim and create rows, oldest first, per session', () => {
    const s = store();
    seedMirror(s);
    const got = s.childReclaimEvents([A, B]);
    expect(got.get(A)!.map((e) => `${e.act}:${e.outcome}`)).toEqual(['create:done', 'reclaim:refused', 'reclaim:done']);
    expect(got.get(A)![1]!.refusal).toBe('held');
    expect(got.get(B)!.map((e) => e.act)).toEqual(['create']);
  });

  it('revives each row exactly as lifecycleFor does — one mapper, both reads', () => {
    const s = store();
    seedMirror(s);
    expect(s.childReclaimEvents([A]).get(A)).toEqual(
      s.lifecycleFor({ sessionId: A }).filter((e) => e.act === 'reclaim' || e.act === 'create'));
  });

  it('reads nothing for an empty request', () => {
    const s = store();
    const prepare = vi.spyOn(s.db, 'prepare');
    expect(s.childReclaimEvents([])).toEqual(new Map());
    expect(prepare).not.toHaveBeenCalled();
  });

  it('spends ONE statement whatever the session count', () => {
    const s = store();
    seedMirror(s);
    const prepare = vi.spyOn(s.db, 'prepare');
    s.childReclaimEvents([A, B, 'ccrc-pwa-calm-reef', 'ccrc-pwa-keen-dune', A]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('seeks through lifecycle_by_session and never scans the never-pruned table', () => {
    // The SAME text the method runs (`childReclaimEventsSql`), not a copy, so
    // dropping the hint from the source reds here.
    const s = store();
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${CoordStore.childReclaimEventsSql(2)}`)
      .all(A, B, 'reclaim', 'create') as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toContain('lifecycle_by_session');
    expect(plan).not.toContain('SCAN lifecycle_events');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-events-store.test.ts`

Expected: FAIL, 6 of 6.
- Cases 1–5: `TypeError: s.childReclaimEvents is not a function`. Case 4 throws before its spy assertion is reached.
- Case 6: `TypeError: CoordStore.childReclaimEventsSql is not a function`.

If a case reports `act` as `unknown`, entry condition (c) did not hold: stop.

- [ ] **Step 3: Extract the row mapper, and add the read**

At module scope in `server/src/coord/store.ts`, beside the other `*Db` row shapes, add:

```ts
/** A `lifecycle_events` row as `CoordStore.LC_COLS` selects it. One declaration for
 *  both mirror reads (`lifecycleFor`, `childReclaimEvents`), so a column the
 *  schema gains is one edit, not two that can drift. `id` is selected and
 *  deliberately not typed here: the wire's `id` is the SUBJECT session, and the
 *  mirror's own row id never leaves this file. */
interface LcRowDb {
  uid: string | null; gen: string; at: number | null; ingestedAt: number;
  act: string; badact: string | null; outcome: string; badoutcome: string | null;
  verb: string | null; sessionId: string | null; tx: string | null;
  refusal: string | null; detail: string | null; truncated: number;
  obsJson: string | null; decJson: string | null; measJson: string | null; raw: string;
}
```

In `lifecycleFor`, replace the inline row type (the `as { uid: string | null; … }[]` cast) with `as LcRowDb[]`. Replace the whole `return rows.map((r) => ({ … }));` with `return rows.map((r) => CoordStore.toMirrored(r));`. Then add the extracted body, keeping every comment the inline literal carried:

```ts
  /** `LcRowDb` -> `MirroredLifecycleEvent`. The ONE place a mirror row becomes
   *  the wire event, shared by every read of this table. */
  private static toMirrored(r: LcRowDb): MirroredLifecycleEvent {
    return {
      uid: r.uid, gen: r.gen, at: r.at, ingestedAt: r.ingestedAt,
      // Through the guards, never a cast — the same discipline `feedEvents`
      // gives `kind` and `programs()` gives `state`. A token a NEWER build
      // wrote lands somewhere honest, and `raw` still carries the bytes.
      act: isLifecycleAct(r.act) ? r.act : LC_ACT_UNKNOWN,
      badact: r.badact,
      outcome: isLifecycleOutcome(r.outcome) ? r.outcome : LC_OUTCOME_UNKNOWN,
      // `badact`'s twin. Same shape as `badact` above: a free-text echo of
      // whatever ccd (or this build's own degrade) wrote, never re-narrowed
      // here — narrowing already happened once, on the way in.
      badoutcome: r.badoutcome,
      verb: r.verb,
      // The COLUMN is `sessionId`; the WIRE event is `id`. One rename,
      // declared in `journalparse.ts` and undone here — see `ProvenancePair`.
      id: r.sessionId,
      tx: r.tx, refusal: r.refusal, detail: r.detail,
      truncated: r.truncated !== 0,
      // The SAME revivers the parser used on the way in: one definition, both
      // directions, and each returns a literal so a family gaining a field is
      // a compile error rather than a silently-dropped one.
      obs: reviveObs(jsonOrNull(r.obsJson)),
      dec: reviveDec(jsonOrNull(r.decJson)),
      meas: reviveMeas(jsonOrNull(r.measJson)),
      raw: r.raw,
    };
  }
```

Directly after `lifecycleFor` (before `lifecycleGaps`), add:

```ts
  /** The acts the reclaim chip's read returns (child-reclamation wave 5):
   *  `reclaim`, the act itself, and `create`, which fences one workspace
   *  generation from the next when ws-add hands a recycled slug out again
   *  (wave 4's `childReclaimGeneration`). Typed, so a rename in `LifecycleAct` is a
   *  compile error here rather than a silently empty read. */
  private static readonly CHILD_RECLAIM_EVENT_ACTS: readonly LifecycleAct[] = ['reclaim', 'create'];

  /** THE ONE SPELLING of `childReclaimEvents`' statement. Public so the plan pin
   *  (`child-reclaim-events-store.test.ts`) runs EXPLAIN over the text this
   *  method runs, not over a copy that could keep a hint the source dropped.
   *
   *  `INDEXED BY lifecycle_by_session`, `recentProvenance`'s idiom: the table
   *  is NEVER PRUNED, so this read's cost must be bounded by the requested
   *  sessions' own histories, never by the table's. Today's planner picks the
   *  index unhinted. The hint keeps that independent of `ANALYZE` statistics. */
  static childReclaimEventsSql(sessions: number): string {
    return `SELECT ${CoordStore.LC_COLS} FROM lifecycle_events INDEXED BY lifecycle_by_session ` +
      `WHERE sessionId IN (${placeholders(sessions)}) ` +
      `AND act IN (${placeholders(CoordStore.CHILD_RECLAIM_EVENT_ACTS.length)}) ` +
      'ORDER BY sessionId, id';
  }

  /**
   * Every `reclaim` and `create` row of each requested session, oldest-first by
   * this table's own `id` (never `at`, which is ccd's nullable clock), for the
   * reclaim chip on `GET /api/runs` (child-reclamation wave 5, spec §5.9).
   *
   * ONE STATEMENT, WHATEVER THE ROW COUNT. The board read already spends
   * several statements per row (`runHealth`'s docstring prices a per-row read
   * at ~3,000 for one load), and a per-session loop here would add hundreds
   * more. Measured at planning: one `IN` statement was the cheapest of three
   * shapes at 100k and 500k rows (the plan's table).
   *
   * EVERY requested id gets an entry, `[]` included. A caller forced to supply
   * a default for a missing key is where an overloaded null is born
   * (`runHealth`'s rule). Duplicate ids are asked once.
   *
   * The GENERATION is not decided here. Which of these rows belong to a given
   * run's workspace is wave 4's `childReclaimGeneration`, the ONE fence
   * (spec §5.6: slugs recycle), a pure function with its own pin, because a
   * SQL fence costs three index walks per run where this read costs one per
   * session. Which of them decides is wave 4's `childReclaimLatest`, likewise.
   */
  childReclaimEvents(sessionIds: readonly string[]): Map<string, MirroredLifecycleEvent[]> {
    const ids = [...new Set(sessionIds)];
    const out = new Map<string, MirroredLifecycleEvent[]>(ids.map((id) => [id, []]));
    // `placeholders(0)` is an empty `IN ()`, a SQLite syntax error, and the
    // guard is this method's own.
    if (ids.length === 0) return out;
    const rows = this.db.prepare(CoordStore.childReclaimEventsSql(ids.length))
      .all(...ids, ...CoordStore.CHILD_RECLAIM_EVENT_ACTS) as unknown as LcRowDb[];
    for (const r of rows) {
      if (r.sessionId !== null) out.get(r.sessionId)?.push(CoordStore.toMirrored(r));
    }
    return out;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-events-store.test.ts \
  test/lifecycle-store.test.ts test/lifecycle-replay.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS, with `child-reclaim-events-store` at 6/6. The two lifecycle suites stay green unchanged. They prove the extraction moved no byte of `lifecycleFor`'s answer. `tsc` prints nothing.

- [ ] **Step 5: Mutation check, then commit**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `childReclaimEventsSql`, replace `INDEXED BY lifecycle_by_session` with `NOT INDEXED` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-events-store.test.ts` | case 6: `expected 'SCAN lifecycle_events \| USE TEMP B-TREE FOR ORDER BY' to contain 'lifecycle_by_session'` |
| 2 | Delete the `AND act IN (…)` line from `childReclaimEventsSql`, and `...CoordStore.CHILD_RECLAIM_EVENT_ACTS` from `.all(…)` | same | case 2: `expected [ 'create:done', 'ensure:done', …(3) ] to deeply equal [ 'create:done', 'reclaim:refused', 'reclaim:done' ]` |
| 3 | Replace `new Map<string, MirroredLifecycleEvent[]>(ids.map((id) => [id, []]))` with `new Map<string, MirroredLifecycleEvent[]>()`, and the loop body with `if (r.sessionId !== null) { const l = out.get(r.sessionId) ?? []; l.push(CoordStore.toMirrored(r)); out.set(r.sessionId, l); }` | same | case 1: `expected [ 'ccrc-pwa-quiet-mesa' ] to deeply equal [ 'ccrc-pwa-clear-cove', 'ccrc-pwa-quiet-mesa' ]` |
| 4 | Replace the single `prepare(…).all(…)` with `const rows: LcRowDb[] = []; for (const id of ids) rows.push(...(this.db.prepare(CoordStore.childReclaimEventsSql(1)).all(id, ...CoordStore.CHILD_RECLAIM_EVENT_ACTS) as unknown as LcRowDb[]));` | same | case 5: `expected "prepare" to be called 1 times, but got 4 times` |
| 5 | In `childReclaimEvents`' loop, replace `CoordStore.toMirrored(r)` with `({ ...CoordStore.toMirrored(r), raw: '' })` | same | case 3: the `toEqual` diff shows `raw` differing on every row |

Revert each, then:

```bash
git add server/src/coord/store.ts server/test/child-reclaim-events-store.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): one mirror read for the reclaim chip, in one statement

childReclaimEvents answers every requested session with its reclaim and
create rows, oldest first, in ONE statement through INDEXED BY
lifecycle_by_session. Measured at planning against a per-run loop and a
per-run correlated query, it was the cheapest of the three at 100k and 500k
rows. lifecycleFor and the new read now share one row mapper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The ONE derivation: `childReclaimStatus`, pinned over every mapping row

**Model routing:** `sonnet`, effort `high`. This is the wave's one decision. The generation fence and the latest-event rule it reads through are wave 4's, and the composer's calls to them are where this task can still be wrong.

**Files:**
- Modify: `server/src/coord/childReclaim.ts` (append one section at the end of the file, below `childReclaimDecision` and wave 4's exports; extend the `../../../shared/api.js` import; add `import { refusalSentence } from '../wsaudit.js';` if wave 3 did not already)
- Test: `server/test/child-reclaim-status.test.ts` (new)

No `watch.ts` edit in this task. Wave 4 exports the token-kind lookup beside the table it reads (entry condition g), the generation fence (entry condition i) and the latest-event rule beside it (entry condition l), all in this same file, and this task calls each where it stands (contract §7 R6, R15; contract §8 R21). Because the wave-5 section is appended to that file, "import" is a call with no import line. It moves nothing and re-spells none: the latest-pick this plan once carried (`latestChildReclaimEvent`) is deleted in favour of `childReclaimLatest`.

**Interfaces:**
- Consumes: `CHILD_RECLAIM_TOKEN_KIND`, `ChildReclaimToken` (wave 3, same file); `childReclaimTokenKind: (token: string) => 'gone' | 'terminal' | 'retry' | null` (wave 4's export, same file, entry condition g; contract §7 R15); `childReclaimGeneration(events: readonly MirroredLifecycleEvent[], at: number): readonly MirroredLifecycleEvent[]` (wave 4's export, same file, entry condition i; contract §7 R6: "from the last `create` row (outcome `done`) at or before time T to the first `create` after it"); `childReclaimLatest(events: readonly MirroredLifecycleEvent[]): MirroredLifecycleEvent | null` (wave 4's export, same file, entry condition l; contract §8 R21: the latest `reclaim`-act event of ANY outcome, `intent` included, or null); `refusalSentence(token: string): string` (`server/src/wsaudit.ts`); `lcRefusalWord(token: string): string | null` (L0), whose `LcRefusalToken`s include wave 3's journal-only `pin-failed` and `unit-still-active` (entry condition h); `ChildMark` (wave 2, L0); `ChildReclaimStatus`, `RunSummary` (Task 1); `MirroredLifecycleEvent`, `TERMINAL_RUN_STATES` (L0); the shape of wave 4's `ChildReclaimSweepEntry`, read structurally and ONLY for `firstDeferredAt: number | null`, the first deferral of any kind; the entry's other fields (`firstEligibleAt`, R4′'s presence-only `firstPresenceDeferredAt`, R20's failure count) are wave 4's and the chip reads none of them (contract §8 R4′).
- Produces:
  ```ts
  export const CHILD_RECLAIM_STATUS_SENTENCE: {                 // `as const`: each member is its own string literal type
    readonly reclaimed: string; readonly pending: string; readonly sweepDeferred: string; readonly failed: string;
    readonly refusedNoReason: string; readonly fleetPaused: string; readonly reviewKept: string;
  };
  export type ChildReclaimEvent = Pick<MirroredLifecycleEvent, 'act' | 'outcome' | 'refusal' | 'at'>;
  export type ChildReclaimRowView =
    | { readonly kind: 'unmeasured' } | { readonly kind: 'absent' } | { readonly kind: 'row'; readonly child: ChildMark };
  export interface ChildReclaimStatusInput {
    readonly run: Pick<RunSummary, 'id' | 'state' | 'sessionId'>;
    readonly event: ChildReclaimEvent | null;
    readonly row: ChildReclaimRowView;
    readonly sessionHasOpenRun: boolean;
    readonly reviewedRunNotTerminal: boolean;
    readonly fleetPaused: boolean;
    readonly deferredSince: number | null;
  }
  export function childReclaimStatus(input: ChildReclaimStatusInput): ChildReclaimStatus | null;
  export function childReclaimSessions(runs: readonly RunSummary[]): string[];
  export interface ChildReclaimSources {
    readonly events: ReadonlyMap<string, readonly MirroredLifecycleEvent[]>;
    readonly marks: ReadonlyMap<string, ChildMark> | null;
    readonly defers: ReadonlyMap<string, { readonly firstDeferredAt: number | null }>;
    readonly fleetPaused: boolean;
  }
  export function withChildReclaim(runs: readonly RunSummary[], src: ChildReclaimSources): RunSummary[];
  ```

**The mapping this task pins.** Contract §5's mapping as the rulings of 2026-09-23 amend it (contract §7 R6, R7, R16; contract §8 R16′, R19, R21, R4′). Every row below is settled; none waits on a ruling.

| Condition, first match wins | Word | Sentence | `at` |
|---|---|---|---|
| run not terminal, or no `sessionId` | `null` | — | — |
| the generation's latest `reclaim` event (`childReclaimLatest`, any outcome, R21) is `done` | `reclaimed` | `S.reclaimed` | event `at` |
| … `refused`, no token | `refused` | `S.refusedNoReason` (ccd recorded no reason; R7) | event `at` |
| … `refused`, token kind `gone` | `null` | — | — |
| … `refused`, token `paused` | `paused` | `tokenSentence('paused')` | event `at` |
| … `refused`, token kind `retry` | `deferred`, or the switch's `paused` while the fleet is paused | `tokenSentence(token)` | event `at` |
| … `refused`, token kind `terminal` (R19's `no-worktree-record` among them) | `refused` | `tokenSentence(token)` | event `at` |
| … `refused`, a token this build cannot classify | `refused` | `tokenSentence(token)`, whose `refusalSentence` fallback answers it (R7) | event `at` |
| … `failed` | `deferred`, or the switch's `paused` while the fleet is paused | `tokenSentence(token)`, or `S.failed` with no token | event `at` |
| … any other outcome (`intent`, `unknown`: no recorded end; an `intent` newer than any outcome IS the latest, R21) | falls through to the row rule below (R7) | | |
| row rule: registry listed, row's `ChildMark` is `child` naming **this** run, **no open run on the session**, and this is a review run whose reviewed run is **open** in the list | `pending` | `S.reviewKept` (R16) | `null` |
| … a review run whose reviewed run is **absent** from the list | `pending` | `S.reviewKept`, never `S.pending` (R16′) | `null` |
| … the fleet-wide switch is up (`CoordStatus.reclaim === 'set'`) | `paused` | `S.fleetPaused` (R7) | `null` |
| … the sweep holds a defer | `deferred` | `S.sweepDeferred` | the sweep's first deferral of ANY kind, `firstDeferredAt`, never the presence clock (R4′) |
| … otherwise | `pending` | `S.pending` | `null` |
| anything else (no marker, a marker naming another run, unreadable marker, no row, never listed, a hand-over) | `null` | — | — |

"The switch's `paused`" is `{ word: 'paused', sentence: S.fleetPaused, at: null }`. It replaces exactly the answers that promise the sweep will act on its own (`pending`, and every `deferred`), because nothing acts while the switch stands: wave 4's sweep asks nothing while `reclaim-paused` stands, and wave 4's server-side `paused-at-server` defer journals nothing (contract §7 R7, R8). It replaces no answer that is already settled (`reclaimed`, `refused`), no `paused` token's own answer, and no `null`. It does not replace `S.reviewKept`: that child is kept by the run it reviewed, not by the switch, and lowering the switch would not reclaim it. The two review rows are one input to `childReclaimStatus` (`reviewedRunNotTerminal`); the composer is where "open" and "absent" meet, so the composer case carries both.

`tokenSentence(t)` is `lcRefusalWord(t) ?? refusalSentence(t)`, the lookup order `lcRefusalWord`'s own docstring in `shared/api.ts` prescribes (*"the caller composes `lcRefusalWord(t) ?? refusalSentence(t)`. Two maps, one lookup order, no token with copy in both"*). It matters on the `failed` arm. Wave 3 journals its post-start failures (`pin-failed`, `unit-still-active`, and ws-reap's reused `purge-*` tokens) as `LcRefusalToken`s, whose words live in `LC_REFUSAL_WORD` and never in `SENTENCES` (contract §7 R11). `refusalSentence` alone would answer those with its generic fallback, `` `ccrc declined: ${token}.` ``. On the `refused` arm the order changes nothing, because `lifecycle-refusal-word.test.ts` holds the two maps disjoint, but one helper serves both arms so no arm can forget it. For a token this build cannot classify, that fallback IS the ruled sentence (R7): a stopped reclaim from a newer ccd reads `refused` with its token named, rather than vanishing.

The rulings this table builds, each settled (contract §7):
1. **R6 — one generation fence.** The event is the latest `reclaim` row of THIS run's workspace generation, never the session's latest, because ws-add recycles slugs (`ccd/ccd`: *"a SLUG (144 per project, recycled by ws-reap)"*) and reclaim frees one per child. The generation is wave 4's `childReclaimGeneration(events, run.closedAt)`, the ONE implementation; wave 4's attention list reads the same function with `at` = now. This plan carries no fence of its own, and no test here pins the fence's internals: wave 4's suite owns those. What this task pins is the CALL: the composer passes the session's rows and `run.closedAt`, so a later workspace under a recycled id never repaints this row, and an older one never paints it.
2. **R7 — the hand-over conjunct.** The row rule also requires that no OPEN run names the session. A non-final close that hands an unspent child to wave N+1 leaves a terminal run whose marker still names it, and contract §4's sweep eligibility (*"`openRunsForSession` ok and empty"*) never reclaims such a child, so `pending` would promise an act nothing will take.
3. **R7 — the four rows.** A fleet-wide pause answers `paused`; a `refused` event with no token answers `refused` with a sentence saying ccd recorded no reason; a token this build cannot classify answers `refused` through `tokenSentence`'s fallback; an `intent`/`unknown` event falls through to the row rule, because the registry row still carrying this run's marker is evidence the workspace is still there.
4. **R16 — a review child lives until the run it reviewed is terminal.** Reviewer clause 7 keeps the report in the reviewer's clips and the coordinator cites it by path in fix-round mail, so wave 3's `childReclaimDecision` answers `{ reclaim: false; why: 'review-report-live' }` (entry condition j) and wave 4's sweep eligibility carries the same condition. The chip says why the workspace is still there: `pending`, with a sentence saying it is kept until the run it reviewed is known to have closed.
5. **R16′ — the review child's edges.** The composer asks whether the reviewed run is TERMINAL in the list it composes, never whether it is OPEN there: a reviewed run the list does not carry keeps the child, and the chip answers `S.reviewKept`, never the plain `S.pending`. `GET /api/runs?closed=1` carries every open run uncapped (`CoordStore.runs`' asymmetric clamp) and up to 500 closed ones, so "absent" is a reviewed run capped away as finished, or one the database no longer holds. The second is wave 4's `review-report-live` too (R16′: *"a reviewed run ABSENT from the database keeps the child"*), so the chip and the sweep agree. The first can make the chip say "kept" about a child the sweep then reclaims; the next board read after that reclaim reads `reclaimed` off the mirror, so the error is a stale "kept", never a false "waiting to be reclaimed". The ruling chose that direction, and this plan builds it rather than spending a second statement to tell the two apart.
6. **R21 — one "latest event" rule.** The deciding event is `childReclaimLatest(childReclaimGeneration(events, run.closedAt))`: wave 4's helper, the same one its attention list uses, in the same file. It counts an `intent` as the latest when it is newest, so an attempt in flight, or one that died mid-way, sends the chip to the row rule rather than showing the outcome of an older attempt. The wave-5 section spells no `'reclaim'` act literal of its own: a second pick could skip `intent`s where wave 4's does not, and the chip and the attention list would then disagree about the same child.
7. **R19 — `no-worktree-record` is terminal.** It reaches the chip through the derived token rows like any other terminal token, and reads `refused` with the audit's existing sentence. The composer case spot-checks it by literal.
8. **R4′ — the chip's clock is the any-deferral one.** `deferredSince` is `firstDeferredAt`, set by the first deferral of any kind; `firstPresenceDeferredAt` drives the ceiling and nothing here. So a child deferred because a sibling is open or a marker is unreadable, which the ceiling never overrides, still reads `deferred` since its first deferral, and `S.sweepDeferred` says only what is true of every deferral: the sweep is waiting and retries on its own. It promises no bound.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-status.test.ts`:

```ts
// Child-reclamation wave 5, Task 3: THE ONE derivation of a closed run's
// reclaim chip, pinned table-driven over every mapping row. The ws-reclaim
// token rows are DERIVED from `CHILD_RECLAIM_TOKEN_KIND`, so a token wave 3
// adds is a new case here without anyone writing one. The literal rows below
// them pin the rules that no table could supply: the paused special case, the
// fleet-wide switch, the no-reason and unclassified refusals, the failure
// words, the intent fall-through, the review child, the hand-over and the
// recycled slug. The generation fence and the latest-event rule are wave 4's
// `childReclaimGeneration` and `childReclaimLatest` (spec §5.6: slugs recycle):
// this file pins the composer's CALLS to them, never their bodies.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CHILD_RECLAIM_STATUS_SENTENCE, CHILD_RECLAIM_TOKEN_KIND, childReclaimSessions,
  childReclaimStatus, withChildReclaim, type ChildReclaimSources, type ChildReclaimStatusInput,
} from '../src/coord/childReclaim.js';
import { refusalSentence } from '../src/wsaudit.js';
import {
  RUN_STATES, TERMINAL_RUN_STATES, lcRefusalWord, type ChildMark, type ChildReclaimStatus,
  type MirroredLifecycleEvent, type RunState, type RunSummary,
} from '../../shared/api.js';

const S = CHILD_RECLAIM_STATUS_SENTENCE;
const SID = 'ccrc-pwa-quiet-mesa';
const RUN = 41;
const AT = 1_758_500_000_000;
const EV_AT = AT + 5_000;

type Ev = NonNullable<ChildReclaimStatusInput['event']>;
const ev = (outcome: string, refusal: string | null = null, at: number | null = EV_AT): Ev =>
  ({ act: 'reclaim', outcome, refusal, at }) as Ev;

const marked: ChildReclaimStatusInput['row'] = { kind: 'row', child: { kind: 'child', runId: RUN } };
const base = (over: Partial<ChildReclaimStatusInput> = {}): ChildReclaimStatusInput => ({
  run: { id: RUN, state: 'done', sessionId: SID },
  event: null,
  row: marked,
  sessionHasOpenRun: false,
  reviewedRunNotTerminal: false,
  fleetPaused: false,
  deferredSince: null,
  ...over,
});
const pending: ChildReclaimStatus = { word: 'pending', sentence: S.pending, at: null };
const switchPaused: ChildReclaimStatus = { word: 'paused', sentence: S.fleetPaused, at: null };
const reviewKept: ChildReclaimStatus = { word: 'pending', sentence: S.reviewKept, at: null };

const ROWS: readonly { readonly name: string; readonly input: ChildReclaimStatusInput; readonly want: ChildReclaimStatus | null }[] = [
  { name: 'done → reclaimed, at the event time', input: base({ event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'done with no readable at → reclaimed, at null', input: base({ event: ev('done', null, null) }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: null } },
  { name: 'done, even with the row already gone → reclaimed (the mirror, not the registry)',
    input: base({ event: ev('done'), row: { kind: 'absent' } }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'refused with no token → refused, ccd recorded no reason (spec §5.9)',
    input: base({ event: ev('refused', null) }), want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
  { name: 'refused with an empty token → refused, ccd recorded no reason (spec §5.9)',
    input: base({ event: ev('refused', '') }), want: { word: 'refused', sentence: S.refusedNoReason, at: EV_AT } },
  { name: 'refused with a token this build cannot classify → refused, refusalSentence’s fallback (spec §5.9)',
    input: base({ event: ev('refused', 'from-a-newer-ccd') }),
    want: { word: 'refused', sentence: 'ccrc declined: from-a-newer-ccd.', at: EV_AT } },
  { name: 'failed with an audit token → deferred, that token’s sentence', input: base({ event: ev('failed', 'state-changed') }),
    want: { word: 'deferred', sentence: refusalSentence('state-changed'), at: EV_AT } },
  // Wave 3's post-start failures are journal-only `LcRefusalToken`s: their words
  // live in `LC_REFUSAL_WORD`, and `refusalSentence` alone would answer the
  // generic `ccrc declined: pin-failed.` The non-null assertion below proves
  // these two rows cannot pass on a missing word.
  { name: 'failed pin-failed → deferred, wave 3’s journal word, not the audit fallback',
    input: base({ event: ev('failed', 'pin-failed') }),
    want: { word: 'deferred', sentence: lcRefusalWord('pin-failed'), at: EV_AT } },
  { name: 'failed unit-still-active → deferred, wave 3’s journal word, not the audit fallback',
    input: base({ event: ev('failed', 'unit-still-active') }),
    want: { word: 'deferred', sentence: lcRefusalWord('unit-still-active'), at: EV_AT } },
  { name: 'failed with no token → deferred, the failure sentence', input: base({ event: ev('failed', null) }),
    want: { word: 'deferred', sentence: S.failed, at: EV_AT } },
  { name: 'intent (an act with no recorded end), with the marked row → falls through to pending (spec §5.9)',
    input: base({ event: ev('intent') }), want: pending },
  { name: 'unknown outcome, with the marked row → falls through to pending (spec §5.9)',
    input: base({ event: ev('unknown') }), want: pending },
  { name: 'intent with no registry row → the row rule says nothing',
    input: base({ event: ev('intent'), row: { kind: 'absent' } }), want: null },
  { name: 'intent with the sweep deferring → the row rule’s deferred',
    input: base({ event: ev('intent'), deferredSince: AT + 9_000 }),
    want: { word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 } },
  { name: 'no event, marked row → pending', input: base(), want: pending },
  { name: 'no event, marked row, the sweep deferring → deferred since the sweep began',
    input: base({ deferredSince: AT + 9_000 }), want: { word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 } },
  // The fleet-wide switch (spec §5.8): every answer that promises the sweep will act on
  // its own reads `paused`; nothing settled, and no null, changes.
  { name: 'fleet paused, no event, marked row → paused, the switch’s sentence',
    input: base({ fleetPaused: true }), want: switchPaused },
  { name: 'fleet paused, the sweep deferring → paused (the switch, not the defer, is what holds it)',
    input: base({ fleetPaused: true, deferredSince: AT + 9_000 }), want: switchPaused },
  { name: 'fleet paused, a retry refusal → paused', input: base({ fleetPaused: true, event: ev('refused', 'held') }),
    want: switchPaused },
  { name: 'fleet paused, a failed attempt → paused', input: base({ fleetPaused: true, event: ev('failed', 'pin-failed') }),
    want: switchPaused },
  { name: 'fleet paused, an intent → the row rule, paused', input: base({ fleetPaused: true, event: ev('intent') }),
    want: switchPaused },
  { name: 'fleet paused, a done reclaim → still reclaimed', input: base({ fleetPaused: true, event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'fleet paused, a terminal refusal → still refused',
    input: base({ fleetPaused: true, event: ev('refused', 'containment-unproven') }),
    want: { word: 'refused', sentence: refusalSentence('containment-unproven'), at: EV_AT } },
  { name: 'fleet paused, the on-box paused token → its own sentence and time',
    input: base({ fleetPaused: true, event: ev('refused', 'paused') }),
    want: { word: 'paused', sentence: refusalSentence('paused'), at: EV_AT } },
  { name: 'fleet paused, a hand-over → still nothing', input: base({ fleetPaused: true, sessionHasOpenRun: true }), want: null },
  // A review child (spec §5.7): kept while the run it reviewed is not known to
  // be terminal. Open and absent both arrive here as `reviewedRunNotTerminal`;
  // the composer case below is where the two are told apart.
  { name: 'a review child whose reviewed run is not terminal → pending, kept for the report (spec §5.7)',
    input: base({ reviewedRunNotTerminal: true }), want: reviewKept },
  { name: 'a review child under a fleet pause → still kept for the report, not paused',
    input: base({ reviewedRunNotTerminal: true, fleetPaused: true }), want: reviewKept },
  { name: 'a review child beside a stale sweep defer → still kept for the report',
    input: base({ reviewedRunNotTerminal: true, deferredSince: AT + 9_000 }), want: reviewKept },
  { name: 'a review child already reclaimed → reclaimed', input: base({ reviewedRunNotTerminal: true, event: ev('done') }),
    want: { word: 'reclaimed', sentence: S.reclaimed, at: EV_AT } },
  { name: 'a review child whose session has an open run → nothing',
    input: base({ reviewedRunNotTerminal: true, sessionHasOpenRun: true }), want: null },
  { name: 'no event, another run OPEN on the session (a hand-over) → nothing', input: base({ sessionHasOpenRun: true }), want: null },
  { name: 'no event, marker names ANOTHER run (a recycled slug) → nothing',
    input: base({ row: { kind: 'row', child: { kind: 'child', runId: RUN + 1 } } }), want: null },
  { name: 'no event, the row carries no marker → nothing (not a child)',
    input: base({ row: { kind: 'row', child: { kind: 'none' } } }), want: null },
  { name: 'no event, the marker is unreadable → nothing (whose child it is cannot be said)',
    input: base({ row: { kind: 'row', child: { kind: 'unreadable' } } }), want: null },
  { name: 'no event, no registry row → nothing', input: base({ row: { kind: 'absent' } }), want: null },
  { name: 'no event, the registry never listed → nothing', input: base({ row: { kind: 'unmeasured' } }), want: null },
  { name: 'a run with no session → nothing, even beside a done event',
    input: base({ run: { id: RUN, state: 'done', sessionId: null }, event: ev('done') }), want: null },
  { name: 'a FAILED run is terminal too → pending', input: base({ run: { id: RUN, state: 'failed', sessionId: SID } }), want: pending },
];

describe('childReclaimStatus — every mapping row (wave 5, spec §5.7–§5.9)', () => {
  it.each(ROWS)('$name', ({ input, want }) => {
    expect(childReclaimStatus(input)).toEqual(want);
  });

  it('says nothing for any non-terminal run, whatever the mirror says', () => {
    const open = RUN_STATES.filter((s) => !(TERMINAL_RUN_STATES as readonly RunState[]).includes(s));
    expect(open.length).toBeGreaterThan(0);
    for (const state of open) {
      expect(childReclaimStatus(base({ run: { id: RUN, state, sessionId: SID }, event: ev('done') })), state).toBeNull();
    }
  });

  it('reads a failure token’s journal word ahead of the audit sentences, never the generic fallback', () => {
    for (const token of ['pin-failed', 'unit-still-active']) {
      const word = lcRefusalWord(token);
      expect(word, `${token} has no LC_REFUSAL_WORD entry: entry condition (h) did not hold`).not.toBeNull();
      expect(word).not.toBe(refusalSentence(token));
    }
  });

  it('the unclassified-token row really is refusalSentence’s fallback, not a sentence of this file', () => {
    expect(refusalSentence('from-a-newer-ccd')).toBe('ccrc declined: from-a-newer-ccd.');
    expect(Object.values(S)).not.toContain('ccrc declined: from-a-newer-ccd.');
  });

  it('gives every word it answers a sentence', () => {
    for (const { want } of ROWS) if (want !== null) expect(want.sentence, JSON.stringify(want)).not.toBeNull();
  });
});

describe('childReclaimStatus — every ws-reclaim token, by its classification', () => {
  const tokens = Object.entries(CHILD_RECLAIM_TOKEN_KIND) as [string, 'gone' | 'terminal' | 'retry'][];

  it('has all three kinds to classify, and paused is a retryable one', () => {
    const kinds = new Set(tokens.map(([, k]) => k));
    expect([...kinds].sort()).toEqual(['gone', 'retry', 'terminal']);
    expect(CHILD_RECLAIM_TOKEN_KIND['paused']).toBe('retry');
  });

  it.each(tokens)('refused %s (%s)', (token, kind) => {
    const got = childReclaimStatus(base({ event: ev('refused', token) }));
    if (kind === 'gone') { expect(got).toBeNull(); return; }
    const word = token === 'paused' ? 'paused' : kind === 'retry' ? 'deferred' : 'refused';
    expect(got).toEqual({ word, sentence: refusalSentence(token), at: EV_AT });
  });

  it('spot-checks the rows a reader would look for first, by literal', () => {
    expect(childReclaimStatus(base({ event: ev('refused', 'not-a-child') }))?.word).toBe('refused');
    expect(childReclaimStatus(base({ event: ev('refused', 'containment-unproven') }))?.word).toBe('refused');
    expect(childReclaimStatus(base({ event: ev('refused', 'held') }))?.word).toBe('deferred');
    expect(childReclaimStatus(base({ event: ev('refused', 'paused') }))?.word).toBe('paused');
    expect(childReclaimStatus(base({ event: ev('refused', 'no-such-session') }))).toBeNull();
  });

  it('reads a workdir git has no worktree record of as a terminal refusal, in the audit’s own sentence (spec §5.5)', () => {
    expect(CHILD_RECLAIM_TOKEN_KIND['no-worktree-record']).toBe('terminal');
    expect(childReclaimStatus(base({ event: ev('refused', 'no-worktree-record') }))).toEqual({
      word: 'refused', sentence: refusalSentence('no-worktree-record'), at: EV_AT,
    });
  });
});

describe('the generation fence and the latest pick are wave 4’s, called and never re-implemented (spec §5.6)', () => {
  const wave5 = (): string => {
    const file = readFileSync(path.join(import.meta.dirname, '..', 'src', 'coord', 'childReclaim.ts'), 'utf8');
    const at = file.indexOf('// ── Wave 5: the closed run');
    expect(at, 'the wave-5 banner is missing').toBeGreaterThan(-1);
    return file.slice(at);
  };

  it('the wave-5 section reads no create row itself, and calls childReclaimGeneration', () => {
    expect(wave5()).not.toMatch(/['"]create['"]/);
    expect(wave5()).toMatch(/\bchildReclaimGeneration\(/);
  });

  it('the wave-5 section picks no reclaim row itself, and calls childReclaimLatest', () => {
    // A second pick could skip an `intent` where wave 4's counts it, and the
    // chip and the attention list would disagree about the same child.
    expect(wave5()).not.toMatch(/['"]reclaim['"]/);
    expect(wave5()).toMatch(/\bchildReclaimLatest\(/);
  });
});

const run = (over: Partial<RunSummary>): RunSummary =>
  ({ id: RUN, state: 'done', sessionId: SID, closedAt: AT, childReclaim: null, program: 'w5',
     kind: 'work', reviews: null, ...over }) as RunSummary;
const src = (over: Partial<ChildReclaimSources> = {}): ChildReclaimSources => ({
  events: new Map(), marks: new Map<string, ChildMark>([[SID, { kind: 'child', runId: RUN }]]),
  defers: new Map(), fleetPaused: false, ...over,
});
const mirrored = (act: string, outcome: string, at: number, refusal: string | null = null): MirroredLifecycleEvent =>
  ({ act, outcome, at, refusal, id: SID }) as unknown as MirroredLifecycleEvent;

describe('withChildReclaim — the composer GET /api/runs calls', () => {
  it('keeps every other field and sets childReclaim on each row', () => {
    const r = run({});
    expect(withChildReclaim([r], src())).toEqual([{ ...r, childReclaim: pending }]);
  });

  it('reads THIS run’s generation at its closedAt: a LATER workspace under the recycled id never repaints it', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 50_000), mirrored('reclaim', 'done', AT + 1_000),
      mirrored('create', 'done', AT + 60_000), mirrored('reclaim', 'refused', AT + 70_000, 'held'),
    ]]]);
    expect(withChildReclaim([run({})], src({ events }))[0]!.childReclaim)
      .toEqual({ word: 'reclaimed', sentence: S.reclaimed, at: AT + 1_000 });
  });

  it('an OLDER workspace’s reclaim under the recycled id never paints this run', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 100_000), mirrored('reclaim', 'done', AT - 90_000),
      mirrored('create', 'done', AT - 50_000),
    ]]]);
    expect(withChildReclaim([run({})], src({ events }))[0]!.childReclaim).toEqual(pending);
  });

  it('derives "another run is open on this session" from the SAME list it composes', () => {
    const closed = run({ id: RUN });
    const open = run({ id: RUN + 1, state: 'working', closedAt: null });
    const out = withChildReclaim([closed, open], src());
    expect(out.map((r) => r.childReclaim)).toEqual([null, null]);
  });

  it('keeps a review child until the run it reviewed is TERMINAL in the SAME list, absent included (spec §5.7)', () => {
    const review = run({ id: RUN, kind: 'review', reviews: 40 });
    const reviewed = (state: RunState): RunSummary =>
      run({ id: 40, state, sessionId: 'ccrc-pwa-work-reef', closedAt: state === 'working' ? null : AT });
    // Open in the list: kept.
    expect(withChildReclaim([reviewed('working'), review], src())[1]!.childReclaim).toEqual(reviewKept);
    // Terminal in the list: like any other child.
    expect(withChildReclaim([reviewed('done'), review], src())[1]!.childReclaim).toEqual(pending);
    // ABSENT from the list: not known to be terminal, so kept, never the plain
    // pending answer.
    expect(withChildReclaim([review], src())[0]!.childReclaim).toEqual(reviewKept);
  });

  it('lets an intent newer than an outcome decide: the row rule, not the older attempt’s answer (spec §5.9)', () => {
    const events = new Map([[SID, [
      mirrored('create', 'done', AT - 50_000),
      mirrored('reclaim', 'refused', AT + 1_000, 'containment-unproven'),
      mirrored('reclaim', 'intent', AT + 2_000),
    ]]]);
    expect(withChildReclaim([run({})], src({ events }))[0]!.childReclaim).toEqual(pending);
    // With no marked row left, the row rule says nothing: an attempt in flight
    // is not reported as the older refusal.
    expect(withChildReclaim([run({})], src({ events, marks: new Map() }))[0]!.childReclaim).toBeNull();
  });

  it('reads the fleet-wide switch off its source', () => {
    expect(withChildReclaim([run({})], src({ fleetPaused: true }))[0]!.childReclaim).toEqual(switchPaused);
  });

  it('looks no event up for a terminal run with no closedAt (a reconstructed row)', () => {
    const out = withChildReclaim([run({ closedAt: null })],
      src({ events: new Map([[SID, [mirrored('reclaim', 'done', AT + 1)]]]) }));
    expect(out[0]!.childReclaim).toEqual(pending);
  });

  it('reads the registry view as never-listed when the watcher has not listed it', () => {
    expect(withChildReclaim([run({})], src({ marks: null }))[0]!.childReclaim).toBeNull();
  });

  it('reads the sweep’s entry as a defer only once the sweep has started one', () => {
    const tracked = src({ defers: new Map([[SID, { firstEligibleAt: AT, firstDeferredAt: null, firstPresenceDeferredAt: null }]]) });
    expect(withChildReclaim([run({})], tracked)[0]!.childReclaim).toEqual(pending);
    const deferring = src({ defers: new Map([[SID, { firstEligibleAt: AT, firstDeferredAt: AT + 9_000, firstPresenceDeferredAt: null }]]) });
    expect(withChildReclaim([run({})], deferring)[0]!.childReclaim)
      .toEqual({ word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 });
  });

  it('dates a defer from the first deferral of ANY kind, never the presence clock (spec §5.7)', () => {
    // A sibling-open defer first, a presence defer later: the chip's `at` is
    // the first. (The case above already holds that a non-presence defer
    // alone, `firstPresenceDeferredAt: null`, reads deferred.)
    const both = src({ defers: new Map([[SID, { firstEligibleAt: AT, firstDeferredAt: AT + 9_000, firstPresenceDeferredAt: AT + 20_000 }]]) });
    expect(withChildReclaim([run({})], both)[0]!.childReclaim)
      .toEqual({ word: 'deferred', sentence: S.sweepDeferred, at: AT + 9_000 });
  });

  it('asks the store only for sessions of terminal rows that have a closedAt, each once', () => {
    expect(childReclaimSessions([
      run({ id: 1 }), run({ id: 2 }), run({ id: 3, sessionId: 'ccrc-pwa-open-one', state: 'working', closedAt: null }),
      run({ id: 4, sessionId: 'ccrc-pwa-rebuilt', closedAt: null }), run({ id: 5, sessionId: null }),
    ])).toEqual([SID]);
  });
});
```

The two generation cases lean on nothing wave 4's fence could answer either way: a `create` ending `done` with a readable `at` on each side of `closedAt`, which is the contract's whole definition (R6). The intent case leans on R21's whole definition the same way: an `intent` newer than the generation's only outcome is the latest `reclaim`-act event. A departure in either is wave 4's to report, not this file's to paper over.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-status.test.ts`

Expected: FAIL at collection, with no case run. The file reads `S.pending` at module scope to build `pending`, and `CHILD_RECLAIM_STATUS_SENTENCE` does not exist yet (vitest resolves a missing named export to `undefined`). The error is `TypeError: Cannot read properties of undefined (reading 'pending')`.

If the error names `CHILD_RECLAIM_TOKEN_KIND` rather than `pending`, entry condition (d) did not hold: stop.

This task writes no single-definition guard of its own for the token-kind lookup, the generation fence or the latest-event pick. All three are wave 4's exports, and so are their pins. This file calls them, adds no second reader of `CHILD_RECLAIM_TOKEN_KIND`, reads no `create` row itself and picks no `reclaim` row itself (contract §8 R21). Step 4's `grep`s and the two source cases above prove that.

- [ ] **Step 3: Write the derivation**

In `server/src/coord/childReclaim.ts`, extend the `../../../shared/api.js` import with `type ChildMark, type ChildReclaimStatus, type MirroredLifecycleEvent, type RunSummary, TERMINAL_RUN_STATES, lcRefusalWord`, keeping whatever waves 3 and 4 import there. Add `import { refusalSentence } from '../wsaudit.js';` if it is not already present. Then append, at the END of the file (after `childReclaimDecision` and after everything waves 3 and 4 placed below it, `childReclaimGeneration` and `childReclaimLatest` included). The wave-5 section runs from its banner to end of file, which is what Step 1's source case slices:

```ts
// ── Wave 5: the closed run's chip (spec §5.9) ───────────────────────────────
//
// THE ONE DERIVATION. `GET /api/runs` composes `RunSummary.childReclaim` through
// `withChildReclaim` and nothing else decides a word. Every sentence is the
// server's: a journal token's comes from `childReclaimTokenSentence` (the two
// server maps in their one documented order); the words that have no token
// have theirs below. The generation fence, the latest-event pick and the
// token-kind lookup are wave 4's exports above, each the programme's one copy
// (spec §5.6: slugs recycle, so every read of the mirror is one generation's),
// called here and never re-spelled.

/** The chip's sentences for the answers no ws-reclaim token carries. Each one
 *  is a claim the operator will act on, so each is true of a CHILD
 *  specifically: the pin phase attic-pins before any destructive act (spec
 *  §5.5), the transcripts are kept (the operator's third ruling), a sweep defer
 *  is retried on its own, and only a wait on presence is bounded (spec §5.7:
 *  the ceiling is on "continuous deferral" for presence, so `sweepDeferred`,
 *  which covers every kind of defer, promises no bound), a failure is left to
 *  the sweep (spec §5.7, "Any failure is recorded and left to the sweep"), the
 *  fleet-wide switch stops reclamation and nothing else, and unpausing drains
 *  what queued (spec §5.8), and a review child outlives its own run until the
 *  run it reviewed is terminal (spec §5.7, "A review child is finished later
 *  than its own run"). */
export const CHILD_RECLAIM_STATUS_SENTENCE = {
  reclaimed: 'This workspace was reclaimed after its run closed. Its commits are pinned in the attic and its transcripts are kept.',
  pending: 'This run has closed. Its workspace is waiting to be reclaimed.',
  sweepDeferred: 'Reclamation of this workspace was put off, and the sweep retries it on its own. A wait on someone using it is bounded; any other wait lasts until its cause clears.',
  failed: 'The last reclamation attempt stopped partway. The sweep tries again on its own.',
  refusedNoReason: 'Reclamation was refused, and ccd recorded no reason for it.',
  fleetPaused: 'Reclamation is paused fleet-wide. This workspace is kept until the switch comes down, then reclaimed on its own.',
  reviewKept: 'This review’s workspace is kept until the run it reviewed is known to have closed, because the report the coordinator cites lives in it. It is reclaimed once that run closes.',
} as const;

/** The one ws-reclaim token the chip reads as its own word rather than as a
 *  defer: `paused` is retryable, and saying `deferred` would hide the switch. */
const PAUSED_TOKEN: ChildReclaimToken = 'paused';

/** What every answer that promises the sweep will act on its own becomes while
 *  the fleet-wide switch stands (spec §5.8: pausing stops reclamation
 *  fleet-wide): nothing acts until it comes down. No time: the switch's own is
 *  not a fact this read has. */
const CHILD_RECLAIM_SWITCH_PAUSED: ChildReclaimStatus = {
  word: 'paused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.fleetPaused, at: null,
};

/** A journal token's sentence, in the lookup order `lcRefusalWord`'s own
 *  docstring prescribes: `LC_REFUSAL_WORD` first, then the audit's `SENTENCES`
 *  through `refusalSentence`. Wave 3 journals a post-start failure
 *  (`pin-failed`, `unit-still-active`, ws-reap's reused `purge-*`) as an
 *  `LcRefusalToken`, whose word `SENTENCES` does not hold, so `refusalSentence`
 *  alone answers it `ccrc declined: <token>.`. The maps are disjoint
 *  (`lifecycle-refusal-word.test.ts`), so the order changes no ws-reclaim
 *  refusal's sentence. For a token this build cannot classify, that fallback
 *  is the sentence: the chip reads "refused with the sentence" (spec §5.9)
 *  rather than vanishing. */
const childReclaimTokenSentence = (token: string): string =>
  lcRefusalWord(token) ?? refusalSentence(token);

const isTerminalRunState = (state: string): boolean =>
  (TERMINAL_RUN_STATES as readonly string[]).includes(state);

/** The four fields of a mirror row the chip reads. */
export type ChildReclaimEvent = Pick<MirroredLifecycleEvent, 'act' | 'outcome' | 'refusal' | 'at'>;

/**
 * What the registry says of a run's session, as the watcher last listed it.
 * FOUR answers, because the chip treats "never listed" and "listed, no row"
 * differently from a row, and a row's `ChildMark` is itself three-way (spec
 * §5.1). None of them folds into another.
 */
export type ChildReclaimRowView =
  | { readonly kind: 'unmeasured' }                       // the watcher has not listed the registry yet
  | { readonly kind: 'absent' }                           // listed; no row for this session
  | { readonly kind: 'row'; readonly child: ChildMark };  // listed; the row's own marker

export interface ChildReclaimStatusInput {
  readonly run: Pick<RunSummary, 'id' | 'state' | 'sessionId'>;
  /** The latest `reclaim` row of THIS run's workspace generation, of ANY
   *  outcome and an `intent` included, as wave 4's `childReclaimLatest` picks it
   *  from `childReclaimGeneration` at the run's `closedAt`; or null when that
   *  generation holds none. */
  readonly event: ChildReclaimEvent | null;
  readonly row: ChildReclaimRowView;
  /** A non-terminal run names this session: the child was handed to the next
   *  wave, and is in use rather than waiting. */
  readonly sessionHasOpenRun: boolean;
  /** This is a review run and the work run it reviews (`RunSummary.reviews`)
   *  is NOT KNOWN TO BE TERMINAL: open in the list, or absent from it. The
   *  child holds the report the coordinator cites (spec §5.7, "A review child
   *  is finished later than its own run"), and doubt keeps it. */
  readonly reviewedRunNotTerminal: boolean;
  /** The fleet-wide switch stands (`CoordStatus.reclaim === 'set'`, wave 4). */
  readonly fleetPaused: boolean;
  /** When wave 4's sweep FIRST deferred this session, for any reason
   *  (`firstDeferredAt`), or null when it holds no defer. Never the
   *  presence-only clock that drives the ceiling. */
  readonly deferredSince: number | null;
}

/**
 * THE ONE DERIVATION of a closed run's chip (spec §5.9, with §5.6's recycled
 * slugs, §5.7's review child and deferrals, and §5.8's switch). First match
 * wins:
 *
 * 1. A run that is not terminal, or has no session, says nothing. That rule is
 *    what makes the store's `childReclaim: null` on every other emitter the
 *    same answer rather than a second meaning (`RunSummary.childReclaim`).
 * 2. The generation's latest reclaim event, of any outcome:
 *      done → reclaimed;
 *      refused → with no token, refused ("ccd recorded no reason"); by the
 *        token's kind otherwise: gone → nothing; `paused` → paused; retry →
 *        deferred; terminal (`no-worktree-record` among them), or a token this
 *        build cannot classify → refused, the latter through
 *        `refusalSentence`'s fallback;
 *      failed → deferred (the sweep retries);
 *      any other outcome (`intent`, `unknown`: no recorded end, an attempt in
 *        flight or one that died mid-way) → the row rule below, because a
 *        registry row still carrying this run's marker is evidence the
 *        workspace is still there.
 *    None of the settled answers reads the registry: a reclaimed child's row
 *    is gone by design, and the mirror is the durable record (spec §5.9).
 * 3. The ROW RULE. The registry, as last listed, still carries a `ChildMark`
 *    naming THIS run, and no open run names the session. Then: a review child
 *    whose reviewed run is not known to be terminal is pending, kept for the
 *    report; the fleet-wide switch reads paused; a sweep defer reads deferred;
 *    else pending. Anything short of that says nothing. An unreadable marker,
 *    or one naming another run (a recycled slug, or the hand-over wave's own
 *    row), cannot be said to be this run's.
 *
 * THE SWITCH replaces every answer that promises the sweep will act on its own
 * (pending, and every deferred) with `CHILD_RECLAIM_SWITCH_PAUSED`, and nothing
 * else: a settled answer stays settled, the on-box `paused` token keeps its own
 * sentence and time, and a review child is kept by its reviewed run, not by
 * the switch.
 */
export function childReclaimStatus(input: ChildReclaimStatusInput): ChildReclaimStatus | null {
  const { run, event } = input;
  if (run.sessionId === null || !isTerminalRunState(run.state)) return null;
  const waiting = (s: ChildReclaimStatus): ChildReclaimStatus => (input.fleetPaused ? CHILD_RECLAIM_SWITCH_PAUSED : s);
  if (event !== null) {
    if (event.outcome === 'done') {
      return { word: 'reclaimed', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reclaimed, at: event.at };
    }
    if (event.outcome === 'refused') {
      const token = event.refusal;
      if (token === null || token === '') {
        return { word: 'refused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.refusedNoReason, at: event.at };
      }
      const kind = childReclaimTokenKind(token);
      if (kind === 'gone') return null;
      if (token === PAUSED_TOKEN) return { word: 'paused', sentence: childReclaimTokenSentence(token), at: event.at };
      if (kind === 'retry') return waiting({ word: 'deferred', sentence: childReclaimTokenSentence(token), at: event.at });
      // `terminal`, or a token this build was never compiled to know (`kind`
      // null): refused, and the latter's sentence is `refusalSentence`'s
      // fallback naming the token (spec §5.9: refused with the sentence).
      return { word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at };
    }
    if (event.outcome === 'failed') {
      const token = event.refusal;
      return waiting({
        word: 'deferred',
        sentence: token === null || token === '' ? CHILD_RECLAIM_STATUS_SENTENCE.failed : childReclaimTokenSentence(token),
        at: event.at,
      });
    }
    // `intent` / `unknown`: an act with no recorded end, newer than any
    // outcome in this generation. An older attempt's answer is not this
    // one's: fall through to the row rule.
  }
  const row = input.row;
  if (row.kind !== 'row' || row.child.kind !== 'child' || row.child.runId !== run.id) return null;
  if (input.sessionHasOpenRun) return null;
  if (input.reviewedRunNotTerminal) return { word: 'pending', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reviewKept, at: null };
  if (input.deferredSince !== null) {
    return waiting({ word: 'deferred', sentence: CHILD_RECLAIM_STATUS_SENTENCE.sweepDeferred, at: input.deferredSince });
  }
  return waiting({ word: 'pending', sentence: CHILD_RECLAIM_STATUS_SENTENCE.pending, at: null });
}

/** The sessions whose mirror rows a board needs: terminal rows that carry both a
 *  session and a `closedAt`, each once. A row without `closedAt` (a
 *  reconstructed one) has no generation to fence, so nothing is asked for it. */
export function childReclaimSessions(runs: readonly RunSummary[]): string[] {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.sessionId !== null && r.closedAt !== null && isTerminalRunState(r.state)) out.add(r.sessionId);
  }
  return [...out];
}

/** What `withChildReclaim` composes from. Every piece is already in memory
 *  or already read, so composition does no I/O of its own. */
export interface ChildReclaimSources {
  /** `CoordStore.childReclaimEvents(childReclaimSessions(runs))`, which answers every id it was asked. */
  readonly events: ReadonlyMap<string, readonly MirroredLifecycleEvent[]>;
  /** The watcher's last LISTED registry read, or null when it has listed none. */
  readonly marks: ReadonlyMap<string, ChildMark> | null;
  /** Wave 4's sweep state, read-only (`FleetWatcher.currentChildReclaimDefers()`).
   *  It is read structurally, so this section imports nothing from the sweep.
   *  An entry whose `firstDeferredAt` is null is tracked but NOT deferring.
   *  `firstDeferredAt` is the FIRST deferral of any kind. The entry's
   *  presence-only clock, which drives the defer ceiling (spec §5.7), is
   *  deliberately not declared here: the chip dates a defer from its start,
   *  whatever its cause. */
  readonly defers: ReadonlyMap<string, { readonly firstDeferredAt: number | null }>;
  /** Wave 4's fleet-wide switch as the watcher last measured it
   *  (`currentCoord()?.reclaim === 'set'`). `unmeasurable` and "never
   *  measured" are false: the chip then says what it would say anyway, and
   *  claims no switch it did not see. */
  readonly fleetPaused: boolean;
}

/**
 * `RunSummary[]` → the same rows with `childReclaim` composed. "Another run is
 * open on this session" and "the run this review reviewed is terminal" are
 * both derived from THIS list. `GET /api/runs?closed=1` carries every open run
 * uncapped (`CoordStore.runs`'s asymmetric clamp), so "open on this session" is
 * complete wherever a terminal row can appear. "Terminal" is not: the list
 * caps closed runs, so a reviewed run it does not carry is NOT KNOWN to be
 * terminal, and the review child is kept (spec §5.7: its report outlives its
 * own run). The cost of that direction is a stale "kept" on a child the sweep
 * reclaims, which the next read corrects off the mirror; the other direction
 * would promise a reclaim of a report still being cited. A list without
 * `?closed=1` carries no terminal row, so every answer there is null anyway.
 *
 * THE EVENT is wave 4's `childReclaimLatest` over wave 4's
 * `childReclaimGeneration`, read at the run's own `closedAt` (spec §5.6: slugs
 * recycle): the attention list reads the same two functions at now, and
 * nothing here re-implements either.
 */
export function withChildReclaim(runs: readonly RunSummary[], src: ChildReclaimSources): RunSummary[] {
  const open = new Set<string>();
  const terminalRunIds = new Set<number>();
  for (const r of runs) {
    if (isTerminalRunState(r.state)) { terminalRunIds.add(r.id); continue; }
    if (r.sessionId !== null) open.add(r.sessionId);
  }
  return runs.map((run) => {
    const sid = run.sessionId;
    // `?? []` is not a default for a missing key: `childReclaimEvents` answers
    // every id `childReclaimSessions` names, and a session it was not asked
    // about belongs to a row the derivation answers null for before reading this.
    const event = sid === null || run.closedAt === null
      ? null
      : childReclaimLatest(childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt));
    const mark = sid === null || src.marks === null ? undefined : src.marks.get(sid);
    const row: ChildReclaimRowView = src.marks === null
      ? { kind: 'unmeasured' }
      : mark === undefined ? { kind: 'absent' } : { kind: 'row', child: mark };
    return {
      ...run,
      childReclaim: childReclaimStatus({
        run, event, row,
        sessionHasOpenRun: sid !== null && open.has(sid),
        // `typeof`, not `!== null`: a row from an older server omits `reviews`,
        // and absence means a work run, the only kind it knew. A reviewed run
        // ABSENT from this list is not known terminal, so it keeps the child.
        reviewedRunNotTerminal: typeof run.reviews === 'number' && !terminalRunIds.has(run.reviews),
        fleetPaused: src.fleetPaused,
        deferredSince: sid === null ? null : src.defers.get(sid)?.firstDeferredAt ?? null,
      }),
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-status.test.ts test/lifecycle-refusal-word.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
git diff -U0 -- server/src/coord/childReclaim.ts | grep '^+' | grep -c 'CHILD_RECLAIM_TOKEN_KIND'
git diff -U0 -- server/src/coord/childReclaim.ts | grep '^+' | grep -cE "['\"]create['\"]"
git diff -U0 -- server/src/coord/childReclaim.ts | grep '^+' | grep -cE "['\"]reclaim['\"]"
```

Expected: PASS on every case. The token table contributes one case per key of `CHILD_RECLAIM_TOKEN_KIND`: fourteen as of contract §8 R19 (§3's thirteen plus `no-worktree-record`, `terminal`). Nothing in this file, and nothing in this wave, asserts that count: the rows are derived, the `no-worktree-record` case asserts that one token's kind and sentence, and Task 8's vacuity guard is a floor (`>= 10`), not a total. This plan's test code was read for a hard-coded token count at planning, and holds none. `lifecycle-refusal-word` stays green unchanged: it is what holds `SENTENCES` and `LC_REFUSAL_WORD` disjoint, which is why `childReclaimTokenSentence`'s order changes no refused token's sentence. `tsc` prints nothing. All three `grep -c`s print `0`: this task adds no second reader of the token table (R15), no create-row fence of its own (R6) and no reclaim-row pick of its own (R21).

- [ ] **Step 5: Mutation check, then commit**

Command for every row except row 8: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-status.test.ts`. vitest does not type-check, so a row whose edit `tsc` would refuse still runs.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | In `childReclaimStatus`, change `if (run.sessionId === null \|\| !isTerminalRunState(run.state)) return null;` to `if (run.sessionId === null) return null;` | "says nothing for any non-terminal run": `planned: expected { word: 'reclaimed', … } to be null` |
| 2 | Delete the line `if (token === PAUSED_TOKEN) return { word: 'paused', … };` | token row `refused paused (retry)`: `expected { word: 'deferred', … } to deeply equal { word: 'paused', … }` |
| 3 | Delete `if (input.sessionHasOpenRun) return null;` | row "a hand-over": `expected { word: 'pending', … } to deeply equal null` |
| 4 | Change `\|\| row.child.runId !== run.id` to nothing (delete that conjunct) | row "a recycled slug": `expected { word: 'pending', … } to deeply equal null` |
| 5 | In `withChildReclaim`, replace `childReclaimLatest(childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt))` with `childReclaimLatest(src.events.get(sid) ?? [])` (no fence: the session's latest) | "…a LATER workspace under the recycled id never repaints it": `expected { word: 'deferred', … } to deeply equal { word: 'reclaimed', … }` |
| 6 | In the same call, replace `run.closedAt` with `Date.now()` (the attention list's `at`, not the chip's; R6) | the same case, the same red: `expected { word: 'deferred', … } to deeply equal { word: 'reclaimed', … }` |
| 7 | In `childReclaimStatus`, `if (kind === 'gone') return null;` → `if (kind === null \|\| kind === 'gone') return null;` (an unclassified token hidden again) | row "refused with a token this build cannot classify → refused…": `expected null to deeply equal { word: 'refused', sentence: 'ccrc declined: from-a-newer-ccd.', … }` |
| 8 | In `withChildReclaim`, change `sid === null \|\| run.closedAt === null` to `sid === null` | **Command:** `cd server && ./node_modules/.bin/tsc --noEmit -p .` — `error TS2345: Argument of type 'number \| null' is not assignable to parameter of type 'number'.` The guard's runtime effect is wave 4's fence reading `at = null`, which this plan does not pin (R6), so the type system is the red here; the vitest case "looks no event up for a terminal run with no closedAt" documents the intent |
| 9 | In `withChildReclaim`, delete `if (r.sessionId !== null) open.add(r.sessionId);` | "derives 'another run is open'…": `expected [ { word: 'pending', … }, null ] to deeply equal [ null, null ]` |
| 10 | In `withChildReclaim`, `src.defers.get(sid)?.firstDeferredAt ?? null` → `(src.defers.has(sid) ? 0 : null)` (a defer read off mere tracking) | "reads the sweep's entry as a defer only once…": `expected { word: 'deferred', … } to deeply equal { word: 'pending', … }` |
| 11 | In `childReclaimTokenSentence`, `lcRefusalWord(token) ?? refusalSentence(token)` → `refusalSentence(token)` | rows "failed pin-failed → deferred, wave 3's journal word…" and "failed unit-still-active → …": `expected { word: 'deferred', sentence: 'ccrc declined: pin-failed.', … } to deeply equal { word: 'deferred', sentence: <LC_REFUSAL_WORD's word>, … }` |
| 12 | Add `return null;` as the last statement inside `if (event !== null) { … }`, directly after the comment that begins `` `intent` / `unknown` `` (the pre-ruling contract's null) | rows "intent … falls through to pending (spec §5.9)", "unknown outcome … falls through…", "intent with the sweep deferring…" and "fleet paused, an intent…": `expected null to deeply equal { word: 'pending', … }` (and `{ word: 'deferred', … }`, `{ word: 'paused', … }`) |
| 13 | Replace the no-token arm's `return { word: 'refused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.refusedNoReason, at: event.at };` with `return null;` | rows "refused with no token → refused, ccd recorded no reason (spec §5.9)" and "…an empty token…": `expected null to deeply equal { word: 'refused', … }` |
| 14 | In `waiting`, `(input.fleetPaused ? CHILD_RECLAIM_SWITCH_PAUSED : s)` → `s` | the "fleet paused, …" rows that expect the switch: `expected { word: 'pending', … } to deeply equal { word: 'paused', sentence: …, at: null }` (and the `deferred` ones likewise); composer "reads the fleet-wide switch off its source" too |
| 15 | Wrap the terminal arm's return in the switch: `return waiting({ word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at });` | row "fleet paused, a terminal refusal → still refused": `expected { word: 'paused', … } to deeply equal { word: 'refused', … }` |
| 16 | Delete `if (input.reviewedRunNotTerminal) return { word: 'pending', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reviewKept, at: null };` | row "a review child whose reviewed run is not terminal…": `expected { word: 'pending', sentence: 'This run has closed. …', … } to deeply equal { word: 'pending', sentence: 'This review’s workspace is kept …', … }` |
| 17 | Wrap that same line's answer in the switch: `if (input.reviewedRunNotTerminal) return waiting({ word: 'pending', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reviewKept, at: null });` | row "a review child under a fleet pause → still kept for the report, not paused": `expected { word: 'paused', … } to deeply equal { word: 'pending', sentence: 'This review’s workspace is kept …', … }` |
| 18 | Move that same line below the `if (input.deferredSince !== null) { … }` block (the defer now comes first) | row "a review child beside a stale sweep defer → still kept for the report": `expected { word: 'deferred', … } to deeply equal { word: 'pending', sentence: 'This review’s workspace is kept …', … }` |
| 19 | In `withChildReclaim`, `typeof run.reviews === 'number' && !terminalRunIds.has(run.reviews)` → `typeof run.reviews === 'number'` (any review child kept, whatever its reviewed run's state) | composer "keeps a review child until the run it reviewed is TERMINAL…", its SECOND expectation (reviewed `done`): `expected { …sentence: 'This review’s workspace is kept …' } to deeply equal { …sentence: 'This run has closed. …' }` |
| 20 | In the same expression, `!terminalRunIds.has(run.reviews)` → `runs.some((o) => o.id === run.reviews && !isTerminalRunState(o.state))` (the pre-R16′ reading: kept only while the reviewed run is OPEN in the list) | the same composer case, its THIRD expectation (reviewed run absent): `expected { …sentence: 'This run has closed. …' } to deeply equal { …sentence: 'This review’s workspace is kept …' }` |
| 21 | Add `const createAct = 'create';` as the first line of `withChildReclaim`'s body (a create literal in the wave-5 section) | "the wave-5 section reads no create row itself…": `expected '…' not to match /['"]create['"]/` |
| 22 | Replace `childReclaimLatest(childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt))` with `([...childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt)].reverse().find((e) => e.act === 'reclaim') ?? null)` (a private pick that answers the same today) | "the wave-5 section picks no reclaim row itself…": `expected '…' not to match /['"]reclaim['"]/`. Every behavioural case stays green, which is why the source case exists: a second pick is a place for the rule to drift later |
| 23 | Replace the same call with `([...childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt)].reverse().find((e) => e.act === 'reclaim' && e.outcome !== 'intent') ?? null)` (the pre-R21 pick that skips an `intent`) | composer "lets an intent newer than an outcome decide…": `expected { word: 'refused', … } to deeply equal { word: 'pending', … }`, and its second expectation `expected { word: 'refused', … } to be null`; the row-22 source case reds too |
| 24 | In `withChildReclaim`, `src.defers.get(sid)?.firstDeferredAt ?? null` → `(src.defers.get(sid) as { firstPresenceDeferredAt?: number \| null } \| undefined)?.firstPresenceDeferredAt ?? null` (the ceiling's presence clock read as the chip's) | composer "dates a defer from the first deferral of ANY kind…": `expected { word: 'deferred', …, at: 1758500020000 } to deeply equal { word: 'deferred', …, at: 1758500009000 }`; and "reads the sweep's entry as a defer only once…", second expectation (`firstPresenceDeferredAt: null`): `expected { word: 'pending', … } to deeply equal { word: 'deferred', … }` |
| 25 | Test-side control, in WAVE 3's table (revert it at once): `CHILD_RECLAIM_TOKEN_KIND`'s `'no-worktree-record': 'terminal'` → `'retry'` | "reads a workdir git has no worktree record of as a terminal refusal…": `expected 'retry' to be 'terminal'`. The DERIVED token row for it stays green (it reads the kind it is given), which is why R19's token also has a literal case |

Deleting the no-token arm outright is also red, and for a reason worth recording: at runtime `childReclaimTokenKind(null)` finds no own key `'null'`, answers `null`, and the row then falls to the unclassified arm, answering `ccrc declined: null.` instead of `S.refusedNoReason`. Row 13's replacement is the pre-ruling contract's null, which is the edit the row exists to catch.

Revert each, then:

```bash
git add server/src/coord/childReclaim.ts server/test/child-reclaim-status.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): childReclaimStatus, the one derivation of a run's reclaim chip

A pure mapping from the run, its workspace generation's latest reclaim
event, the registry's child marker, the sweep's defer, the fleet-wide
switch and the reviewed run's state to one of five words with a server
sentence (spec §5.9), row for row contract §5's as the 2026-09-23 rulings
amend it. Ws-reclaim tokens map by their wave-3 classification, through
wave 4's one exported lookup; a token this build cannot classify reads
refused with its name, and a refusal with no token says ccd recorded no
reason. A token's sentence reads LC_REFUSAL_WORD before the audit's
SENTENCES, so a failed reclaim's pin-failed or unit-still-active gets its
own words. The generation is wave 4's childReclaimGeneration at the run's
closedAt, and the deciding event is wave 4's childReclaimLatest over it,
both called and never re-implemented. An intent newer than any outcome
falls through to the row rule; the switch reads paused; a review child is
kept until the run it reviewed is known terminal, absent from the list
included; a sweep defer is dated from its first deferral of any kind; a
hand-over wave's workspace is not "pending".
Pinned table-driven over every row and every token, no-worktree-record
included.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The watcher's view: `currentChildMarks()`

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `server/src/watch.ts`: `type ChildMark` into the `../../shared/api.js` type import block (~27); a field beside `private coord: CoordStatus | null = null;` (~646); one assignment directly after `const records = registryRead.records;` in `tick()` (~855); one accessor directly after `currentCoord()` (~762)
- Test: `server/test/child-reclaim-watch-view.test.ts` (new)

**Interfaces:**
- Consumes: `SessionRecord.child: ChildMark` (wave 2, entry condition b).
- Produces:
  ```ts
  currentChildMarks(): ReadonlyMap<string, ChildMark> | null;   // null = no LISTED tick yet
  ```
- Does NOT produce `currentChildReclaimDefers()`. Wave 4 already ships it (entry condition f) as `ReadonlyMap<string, ChildReclaimSweepEntry>`, *"for wave 5's `childReclaimStatus`"*, and Task 5 consumes it unchanged.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-watch-view.test.ts`:

```ts
// Child-reclamation wave 5, Task 4: the registry answer GET /api/runs reads to
// compose a run's reclaim chip. It is IN MEMORY, off the registry listing the
// 2 s tick already made. A route-time `readRegistry` would cost ~721 agent-WS
// operations per board load in remote mode.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** A full registry row, the field set `run-routes.test.ts`'s `seed` writes, plus
 *  whatever `over` adds (here: the `.child` marker wave 1 writes). */
const seed = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const slug = id.replace(/^demo-/, '');
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: slug, branch: `ws/${slug}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const unseed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  for (const f of readdirSync(reg)) if (f.startsWith(`${id}.`)) rmSync(path.join(reg, f));
};

const watcher = (home: string, io: FleetIO = { ...localIO }): FleetWatcher =>
  new FleetWatcher({ ...testDeps(home), io }, new Bus());

describe('FleetWatcher.currentChildMarks (wave 5)', () => {
  it('is null before any tick has listed the registry — never a fabricated empty map', () => {
    expect(watcher(mkTmp('ccrc-cr-view-')).currentChildMarks()).toBeNull();
  });

  it('records each listed row’s ChildMark, all three answers', async () => {
    const home = mkTmp('ccrc-cr-view-');
    seed(home, 'demo-quiet-mesa', { child: '41' });
    seed(home, 'demo-clear-cove');
    seed(home, 'demo-calm-reef', { child: 'x7' });
    const w = watcher(home);
    await w.tick();
    const marks = w.currentChildMarks();
    expect(marks?.get('demo-quiet-mesa')).toEqual({ kind: 'child', runId: 41 });
    expect(marks?.get('demo-clear-cove')).toEqual({ kind: 'none' });
    expect(marks?.get('demo-calm-reef')).toEqual({ kind: 'unreadable' });
  });

  it('keeps the last LISTED marks through an unlistable tick — retain, don’t erase', async () => {
    const home = mkTmp('ccrc-cr-view-');
    seed(home, 'demo-quiet-mesa', { child: '41' });
    const io: FleetIO = { ...localIO };
    const w = watcher(home, io);
    await w.tick();
    io.readdir = async () => null;          // the whole-fleet listing now fails
    await w.tick();
    expect(w.currentChildMarks()?.get('demo-quiet-mesa')).toEqual({ kind: 'child', runId: 41 });
  });

  it('drops a row the next listing no longer carries', async () => {
    const home = mkTmp('ccrc-cr-view-');
    seed(home, 'demo-quiet-mesa', { child: '41' });
    const w = watcher(home);
    await w.tick();
    unseed(home, 'demo-quiet-mesa');
    await w.tick();
    expect(w.currentChildMarks()?.has('demo-quiet-mesa')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-watch-view.test.ts`

Expected: FAIL, 4 of 4, each with `TypeError: … currentChildMarks is not a function`.

- [ ] **Step 3: Write the field, the assignment and the accessor**

Add `ChildMark` to the `import type { CoordStatus, … } from '../../shared/api.js';` block.

Beside `private coord: CoordStatus | null = null;`, add:

```ts
  /** Child-reclamation wave 5: each LISTED registry row's `ChildMark`, off the
   *  listing `tick()` already made. `null` until the first listed tick, which is
   *  `currentCoord()`'s "never measured" and not "no children". Retained, not
   *  erased, across an unlistable tick, the same retain-don't-erase rule the
   *  fail-shut return in `tick()` applies to every map it guards. */
  private childMarks: ReadonlyMap<string, ChildMark> | null = null;
```

In `tick()`, directly after `const records = registryRead.records;` (which sits after the `if (!registryRead.listed) { … return; }` block, so an unlistable tick never reaches it), add:

```ts
      // Wave 5: the reclaim chip's registry answer, off THIS listing. Never a
      // second read; see `childMarks`.
      this.childMarks = new Map(records.map((r) => [r.id, r.child] as const));
```

Directly after `currentCoord()` (and before wave 4's `currentChildReclaimDefers()`, which stays exactly as wave 4 wrote it), add:

```ts
  /** The child marks off the last LISTED registry read, for `GET /api/runs`'s
   *  reclaim chip (wave 5), or null when no tick has listed one. In memory, and
   *  the reason is cost: a route-time `readRegistry` is ~721 agent-WS operations
   *  per board load in remote mode. */
  currentChildMarks(): ReadonlyMap<string, ChildMark> | null {
    return this.childMarks;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-watch-view.test.ts test/fleetws.test.ts test/child-reclaim-sweep.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS, with `child-reclaim-watch-view` at 4/4. `fleetws`, which drives real ticks, stays green, and so does wave 4's sweep suite, which reads `currentChildReclaimDefers()`. `tsc` prints nothing.

- [ ] **Step 5: Mutation check, then commit**

Command: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-watch-view.test.ts`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | Delete the `this.childMarks = new Map(…)` line | case 2: `expected undefined to deeply equal { kind: 'child', runId: 41 }` |
| 2 | Move that line ABOVE the `if (!registryRead.listed)` block as `this.childMarks = registryRead.listed ? new Map(registryRead.records.map((r) => [r.id, r.child] as const)) : new Map();` | case 3: `expected undefined to deeply equal { kind: 'child', runId: 41 }` |
| 3 | Initialise the field to `new Map()` instead of `null` | case 1: `expected Map{} to be null` |

Revert each, then:

```bash
git add server/src/watch.ts server/test/child-reclaim-watch-view.test.ts
git commit -m "$(cat <<'MSG'
feat(watch): expose each listed registry row's child marker, in memory

currentChildMarks reads the ChildMark of each row off the registry listing
the tick already made. It is null until the first listed tick and retained
across an unlistable one. GET /api/runs' reclaim chip reads it rather than
reading the registry once per board load.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `GET /api/runs` composes `childReclaim`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/routes.ts`: `withChildReclaim, childReclaimSessions` into the `./childReclaim.js` import (wave 3 already imports from it; add the line if not); `type MirroredLifecycleEvent` into the `../../../shared/api.js` import if absent; one closure directly above the `GET /api/runs` docstring (the one beginning `` `GET /api/runs?closed=1` — cold start``); the route's last two lines
- Test: `server/test/child-reclaim-runs-route.test.ts` (new)

**Interfaces:**
- Consumes: `CoordStore.childReclaimEvents` (Task 2); `withChildReclaim`, `childReclaimSessions` (Task 3); `FleetWatcher.currentChildMarks` (Task 4); `FleetWatcher.currentChildReclaimDefers()` (wave 4, entry condition f), of whose entries the chip reads `firstDeferredAt` alone (contract §8 R4′); `FleetWatcher.currentCoord(): CoordStatus | null` with wave 4's `CoordStatus.reclaim: MarkerState` (entry condition k), for the fleet-wide switch (contract §7 R7). `registerCoordRoutes`' existing `watcher?: FleetWatcher` parameter. No `Deps` change.
- Produces: `GET /api/runs` bodies whose rows carry a composed `childReclaim`. The route count is unchanged: `auth-gate.test.ts`' three route cardinals stay where wave 4 left them (contract §4 moves two of them for `POST /api/coord/reclaim-pause`). Never type them: read them with `grep -n 'toBe([0-9]' server/test/auth-gate.test.ts` before Step 3 and again after Step 4, and expect the two outputs to be identical.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-runs-route.test.ts`:

```ts
// Child-reclamation wave 5, Task 5: GET /api/runs composes each run's reclaim
// chip. It uses the mirror (one statement) and the watcher's in-memory registry
// listing, sweep state and fleet-wide switch. There are no registry reads and no
// ccd calls. A failed mirror read costs the chip, never the board.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { CHILD_RECLAIM_STATUS_SENTENCE as S } from '../src/coord/childReclaim.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { refusalSentence } from '../src/wsaudit.js';
import type { ChildMark, CoordStatus, RunSummary } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const COORD = 'ccrc-pwa-coordinator';
const SID = 'ccrc-pwa-quiet-mesa';
const T_CREATE = 1_758_500_000_000;
const T_CLOSE = T_CREATE + 3_600_000;
const GEN = '1758500000000000000';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; vi.restoreAllMocks(); });

const harness = async (): Promise<{ coord: CoordStore; watcher: FleetWatcher; app: FastifyInstance }> => {
  const home = mkTmp('ccrc-cr-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  const watcher = new FleetWatcher(deps, bus);
  app = await buildServer(deps, bus, watcher);
  return { coord, watcher, app };
};

let n = 0;
/** A run opened, dispatched onto `sessionId` and closed `done`, with `closedAt`
 *  pinned so the generation fence can be placed around it. A program per run,
 *  because closing a program's last run retires it. */
const closedRun = (coord: CoordStore, sessionId: string, closedAt = T_CLOSE): number => {
  const program = `w5-route-${++n}`;
  const r = coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
  const slug = sessionId.slice('ccrc-pwa-'.length);
  coord.dispatchRun({ runId: r.id, sessionId, workspace: slug, branch: `ws/${slug}`, resumed: false, clearedAt: null, items: [] });
  expect(coord.closeRun({ runId: r.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                          program, viaClosing: true }).ok).toBe(true);
  coord.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(closedAt, r.id);
  return r.id;
};
const openRunOn = (coord: CoordStore, sessionId: string): number => {
  const program = `w5-route-${++n}`;
  const r = coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
  const slug = sessionId.slice('ccrc-pwa-'.length);
  coord.dispatchRun({ runId: r.id, sessionId, workspace: slug, branch: `ws/${slug}`, resumed: false, clearedAt: null, items: [] });
  return r.id;
};

let seq = 0;
const journal = (coord: CoordStore, lines: Record<string, unknown>[]): void => {
  const rows = lines.map((l) => parseJournalLine(JSON.stringify({ uid: `w5rt.1.${++seq}`, ...l })));
  coord.ingestJournal({ gen: GEN, rows, cursor: seq * 100, size: seq * 100, at: 9 });
};

const getRuns = async (a: FastifyInstance, closed = true): Promise<RunSummary[]> => {
  const res = await a.inject({ method: 'GET', url: closed ? '/api/runs?closed=1' : '/api/runs' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { runs: RunSummary[] }).runs;
};
const chipOf = (runs: RunSummary[], id: number) => runs.find((r) => r.id === id)!.childReclaim;
const markedAs = (w: FleetWatcher, runId: number): void => {
  vi.spyOn(w, 'currentChildMarks').mockReturnValue(new Map<string, ChildMark>([[SID, { kind: 'child', runId }]]));
};

describe('GET /api/runs composes the reclaim chip (wave 5, spec §5.9)', () => {
  it('reads reclaimed off the mirror alone — the registry row is gone by design', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'done', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'reclaimed', sentence: S.reclaimed, at: T_CLOSE + 5_000 });
  });

  it('ships the SERVER’s sentence for a terminal refusal — the phone is handed it, never maps it', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'refused', refusal: 'containment-unproven', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)).toEqual({
      word: 'refused', sentence: refusalSentence('containment-unproven'), at: T_CLOSE + 5_000,
    });
  });

  it('is not repainted by a LATER workspace under the same recycled id', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'done', id: SID },
      { at: T_CLOSE + 600_000, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 700_000, act: 'reclaim', outcome: 'refused', refusal: 'held', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)?.word).toBe('reclaimed');
  });

  it('reads pending exactly while the watcher’s last listing carries THIS run’s marker', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'pending', sentence: S.pending, at: null });
    markedAs(h.watcher, id + 99);
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('carries the sweep’s defer through to the chip, dated from its first deferral of any kind (spec §5.7)', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    // A non-presence defer first (a sibling was open), a presence defer later:
    // the chip reads the first, never the clock the ceiling runs on.
    vi.spyOn(h.watcher, 'currentChildReclaimDefers').mockReturnValue(new Map([[SID, {
      firstEligibleAt: T_CLOSE + 1_000, firstDeferredAt: T_CLOSE + 9_000,
      firstPresenceDeferredAt: T_CLOSE + 30_000, consecutiveFailures: 0,
    }]]));
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'deferred', sentence: S.sweepDeferred, at: T_CLOSE + 9_000 });
  });

  it('reads the fleet-wide switch off the watcher’s last coord measurement, and only a SET one (spec §5.8)', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    const coordAs = (reclaim: CoordStatus['reclaim']): void => {
      vi.spyOn(h.watcher, 'currentCoord').mockReturnValue(
        { pause: 'clear', mail: 'clear', reclaim, childReclaimAttention: [] });
    };
    coordAs('set');
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'paused', sentence: S.fleetPaused, at: null });
    // An unmeasurable switch is not a switch this read saw: the chip claims none.
    coordAs('unmeasurable');
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'pending', sentence: S.pending, at: null });
  });

  it('keeps a review child pending while the run it reviewed is open, then reads it like any child (spec §5.7)', async () => {
    const h = await harness();
    const program = `w5-route-${++n}`;
    const work = h.coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
    h.coord.dispatchRun({ runId: work.id, sessionId: 'ccrc-pwa-busy-reef', workspace: 'busy-reef', branch: 'ws/busy-reef',
                          resumed: false, clearedAt: null, items: [] });
    const review = h.coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD,
                                     kind: 'review', reviews: work.id }) as { id: number };
    h.coord.dispatchRun({ runId: review.id, sessionId: SID, workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
                          resumed: false, clearedAt: null, items: [] });
    // REVIEW_RUN_TRANSITIONS has no `closing`: working → done, as `closeReviewRun` closes it.
    expect(h.coord.advance(review.id, 'working', 'coordinator').ok).toBe(true);
    expect(h.coord.closeRun({ runId: review.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                              program, viaClosing: false }).ok).toBe(true);
    markedAs(h.watcher, review.id);
    expect(chipOf(await getRuns(h.app), review.id)).toEqual({ word: 'pending', sentence: S.reviewKept, at: null });
    expect(h.coord.closeRun({ runId: work.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                              program, viaClosing: true }).ok).toBe(true);
    expect(chipOf(await getRuns(h.app), review.id)).toEqual({ word: 'pending', sentence: S.pending, at: null });
  });

  it('says nothing on a handed-over child while the next wave’s run is open on it', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    openRunOn(h.coord, SID);
    markedAs(h.watcher, id);
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('says nothing on a closed run whose workspace is not a child', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    vi.spyOn(h.watcher, 'currentChildMarks').mockReturnValue(new Map<string, ChildMark>([[SID, { kind: 'none' }]]));
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('reads no mirror row for a board with nothing terminal on it', async () => {
    const h = await harness();
    openRunOn(h.coord, SID);
    const read = vi.spyOn(h.coord, 'childReclaimEvents');
    for (const r of await getRuns(h.app, false)) expect(r.childReclaim).toBeNull();
    for (const r of await getRuns(h.app, true)) expect(r.childReclaim).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('degrades the chip, never the board, when the mirror read fails', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    vi.spyOn(h.coord, 'childReclaimEvents').mockImplementation(() => { throw new Error('disk I/O error'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
    expect(warn.mock.calls.some(([l]) => String(l).includes('reclaim chip'))).toBe(true);
  });
});
```

The sweep entry in case 5 spells the fields contract §4 and §8 name for wave 4's `ChildReclaimSweepEntry` (`firstEligibleAt`, `firstDeferredAt`, R4′'s `firstPresenceDeferredAt`, R20's `consecutiveFailures`), because `mockReturnValue` is type-checked by `typecheck-tests`. If wave 4 shipped the entry with a field beyond these, `tsc` names it (`TS2741: Property '<name>' is missing`): add it with its idle value, the way Task 1 Step 5 handles a `RunSummary` builder, and name it in the wave-done mail. The chip reads none of them but `firstDeferredAt`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-runs-route.test.ts`

Expected: FAIL, 8 of 11.
- Cases 1, 2, 4, 5, 6 and 7 report `expected null to deeply equal { word: … }`: the store's `null` from Task 1 ships unchanged. Case 6 fails on its first expectation (the `set` switch), case 7 on its first (the review child kept).
- Case 3 reports `expected undefined to be 'reclaimed'`.
- Case 11 reports `expected false to be true`: the throwing spy is never called, so no warning is logged.
- Cases 8–10 PASS before the change. They are the no-regression guards. Step 5's row 2 proves case 10 binds, and rows 6 and 7 prove cases 8 and 9 bind: those two guards live in `childReclaim.ts`, not in `routes.ts`, so their rows mutate that file and run against this route suite. Row 10 does the same for case 7's review conjunct.

- [ ] **Step 3: Compose in the route**

Directly above the `GET /api/runs` docstring, add:

```ts
  /**
   * Child-reclamation wave 5 (spec §5.9): each row's `childReclaim`, composed
   * over the rows `GET /api/runs` already read. The DECISION is
   * `childReclaimStatus`'s. This closure wires its inputs and owns one degrade.
   *
   * COST, measured at planning: at most ONE statement (`childReclaimEvents`,
   * skipped when nothing on the board is terminal). The registry answer and the
   * fleet-wide switch are the watcher's in-memory copies of what the 2 s tick
   * already measured, never a `readRegistry` or a marker read here. There are
   * no ccd calls.
   *
   * THE DEGRADE. A failed mirror read ships the board with every chip at the
   * store's `null`, which renders nothing, and logs once per request. It is not
   * D-2545's all-or-failure: that rule protects the run rows themselves, and a
   * chip that could not be read is not a reason to hide the runs.
   */
  const composeChildReclaim = (summaries: RunSummary[]): RunSummary[] => {
    const coord = deps.coord;
    if (!coord) return summaries;
    const sessions = childReclaimSessions(summaries);
    let events: ReadonlyMap<string, readonly MirroredLifecycleEvent[]>;
    try {
      events = sessions.length === 0 ? new Map() : coord.childReclaimEvents(sessions);
    } catch (err) {
      console.warn('ccrc-server: GET /api/runs could not read the lifecycle mirror for the reclaim chip ' +
        `(${err instanceof Error ? err.message : String(err)}) — the board ships without it`);
      return summaries;
    }
    return withChildReclaim(summaries, {
      events,
      marks: watcher?.currentChildMarks() ?? null,
      defers: watcher?.currentChildReclaimDefers() ?? new Map(),
      // Wave 4's switch as the tick last measured it (spec §5.8). Only a
      // SET marker pauses the chip: `unmeasurable` and "never measured" claim
      // no switch this read did not see.
      fleetPaused: watcher?.currentCoord()?.reclaim === 'set',
    });
  };
```

In `app.get('/api/runs', …)`, replace the last two lines

```ts
    const summaries: RunSummary[] = read.runs.map(toRunSummary);
    return { runs: summaries };
```

with

```ts
    const summaries: RunSummary[] = read.runs.map(toRunSummary);
    return { runs: composeChildReclaim(summaries) };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-runs-route.test.ts test/run-routes.test.ts \
  test/auth-gate.test.ts test/ccrc-api.test.ts test/coordinator-skill.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS, with `child-reclaim-runs-route` at 11/11. `auth-gate`'s three route cardinals are unchanged because no route was added. `ccrc-api` and `coordinator-skill` stay green: the coordinator's cookieless read gains an additive key it does not read. `tsc` prints nothing.

- [ ] **Step 5: Mutation check, then commit**

Command: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-runs-route.test.ts`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | `return { runs: composeChildReclaim(summaries) };` → `return { runs: summaries };` | cases 1, 2, 4, 5, 6, 7: `expected null to deeply equal { word: … }` |
| 2 | `sessions.length === 0 ? new Map() : coord.childReclaimEvents(sessions)` → `coord.childReclaimEvents(sessions)` | case 10: `expected "childReclaimEvents" to not be called at all, but actually been called 2 times` |
| 3 | Delete the `try {` / `} catch (err) { … }` wrapper, leaving `events = …` bare | case 11: `expected 500 to be 200` |
| 4 | `marks: watcher?.currentChildMarks() ?? null` → `marks: null` | cases 4–7: `expected null to deeply equal { word: 'pending', … }` (and `deferred`, `paused` likewise) |
| 5 | `defers: watcher?.currentChildReclaimDefers() ?? new Map()` → `defers: new Map()` | case 5: `expected { word: 'pending', … } to deeply equal { word: 'deferred', … }` |
| 5b | In `server/src/coord/childReclaim.ts`'s `withChildReclaim`, `src.defers.get(sid)?.firstDeferredAt ?? null` → `(src.defers.get(sid) as { firstPresenceDeferredAt?: number \| null } \| undefined)?.firstPresenceDeferredAt ?? null` | case 5: `expected { word: 'deferred', …, at: 1758503630000 } to deeply equal { word: 'deferred', …, at: 1758503609000 }` (the presence clock, end to end) |
| 6 | In `server/src/coord/childReclaim.ts`'s `withChildReclaim`, `sessionHasOpenRun: sid !== null && open.has(sid),` → `sessionHasOpenRun: false,` | case 8 ("says nothing on a handed-over child…"): `expected { word: 'pending', sentence: …, at: null } to be null` |
| 7 | In `server/src/coord/childReclaim.ts`'s `childReclaimStatus`, `if (row.kind !== 'row' \|\| row.child.kind !== 'child' \|\| row.child.runId !== run.id) return null;` → `if (row.kind !== 'row' \|\| (row.child.kind === 'child' && row.child.runId !== run.id)) return null;` (a marker-less row read as a match). Deleting only the `row.child.kind !== 'child' \|\|` conjunct is NOT a usable mutation: at runtime `{ kind: 'none' }.runId` is `undefined`, `undefined !== run.id` still returns null, and case 9 stays green | case 9 ("says nothing on a closed run whose workspace is not a child"): `expected { word: 'pending', sentence: …, at: null } to be null` |
| 8 | `fleetPaused: watcher?.currentCoord()?.reclaim === 'set',` → `fleetPaused: false,` | case 6 ("reads the fleet-wide switch…"), first expectation: `expected { word: 'pending', … } to deeply equal { word: 'paused', sentence: …, at: null }` |
| 9 | `watcher?.currentCoord()?.reclaim === 'set'` → `watcher?.currentCoord()?.reclaim !== 'clear'` (an unmeasurable or never-measured switch read as up) | case 6, second expectation: `expected { word: 'paused', … } to deeply equal { word: 'pending', … }`; and case 4, whose watcher has measured nothing (`currentCoord()` is null before a tick): `expected { word: 'paused', … } to deeply equal { word: 'pending', … }` |
| 10 | In `server/src/coord/childReclaim.ts`'s `withChildReclaim`, `reviewedRunNotTerminal: typeof run.reviews === 'number' && !terminalRunIds.has(run.reviews),` → `reviewedRunNotTerminal: false,` | case 7 ("keeps a review child pending…"), first expectation: `expected { …sentence: 'This run has closed. …' } to deeply equal { …sentence: 'This review’s workspace is kept …' }` |

Revert each, then:

```bash
git add server/src/coord/routes.ts server/test/child-reclaim-runs-route.test.ts
git commit -m "$(cat <<'MSG'
feat(runs): GET /api/runs composes each run's reclaim chip

At most one mirror statement per board, and the watcher's in-memory
registry listing, sweep state and fleet-wide switch (only a SET switch
pauses the chip). There are no registry reads and no ccd calls. A failed
mirror read ships the board without the chip rather than failing it. The
route census is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The PWA chip: one reader, the cell, the refusal line, the inert row

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/fleet/runWords.ts`: the `../../../shared/api` import gains `type ChildReclaimStatus, type ChildReclaimWord, isChildReclaimWord`; append a section at the end of the file
- Modify: `pwa/src/screens/RunsScreen.tsx`: the `../fleet/runWords` import; `RunRow`'s derived values, body and return
- Modify: `pwa/src/fleet/fleet.css`: three rules directly after `.run-row .run-resumed { … }`
- Test: `pwa/test/runs-screen.test.tsx` (append), `pwa/test/fleet-css.test.ts` (two edits)

**Interfaces:**
- Consumes: `RunSummary.childReclaim`, `ChildReclaimStatus`, `ChildReclaimWord`, `isChildReclaimWord` (Task 1).
- Produces (`pwa/src/fleet/runWords.ts`):
  ```ts
  export const CHILD_RECLAIM_GLYPH: Record<ChildReclaimWord, string>;
  export interface ChildReclaimChip {
    readonly word: ChildReclaimWord | 'unknown';
    readonly glyph: string;
    readonly label: string;
    readonly sentence: string | null;
    readonly line: string | null;
    readonly at: number | null;
  }
  export const childReclaimChip: (run: { childReclaim?: ChildReclaimStatus | null }) => ChildReclaimChip | null;   // THE ONE READER
  export const childReclaimTitle: (chip: ChildReclaimChip, nowSec: number) => string;
  export const childReclaimGone: (chip: ChildReclaimChip | null) => boolean;
  ```

- [ ] **Step 1: Write the failing tests**

In `pwa/test/runs-screen.test.tsx`, add `type ChildReclaimStatus` to the `../../shared/api` import. Add `CHILD_RECLAIM_GLYPH, childReclaimChip, childReclaimGone, childReclaimTitle` to the `../src/fleet/runWords` import. Then append:

```tsx
// ── child-reclamation wave 5: the closed run's reclaim chip (spec §5.9) ─────
//
// The SERVER chooses the word and writes the sentence; this board renders both
// and maps no token. `childReclaimChip` is the one reader of the field, and it
// is tolerant because `RunSummary` is cast, never revived.
describe('childReclaimChip — the one tolerant reader of RunSummary.childReclaim (wave 5)', () => {
  it('is silent when the server said null, and on a row from a server that never heard of the field', () => {
    expect(childReclaimChip(r({ childReclaim: null }))).toBeNull();
    const older = { ...r() } as Partial<RunSummary>;
    delete older.childReclaim;
    expect(childReclaimChip(older)).toBeNull();
  });

  it('renders the server’s word with a glyph and carries its sentence verbatim', () => {
    expect(childReclaimChip(r({ childReclaim: { word: 'refused', sentence: 'SERVER SENTENCE', at: 5_000 } })))
      .toEqual({ word: 'refused', glyph: CHILD_RECLAIM_GLYPH.refused, label: 'workspace refused',
                 sentence: 'SERVER SENTENCE', line: 'SERVER SENTENCE', at: 5_000 });
  });

  it('puts the sentence on its own line only for a refusal — the other words carry it in the title', () => {
    for (const word of ['reclaimed', 'pending', 'deferred', 'paused'] as const) {
      expect(childReclaimChip(r({ childReclaim: { word, sentence: 'S', at: null } }))!.line, word).toBeNull();
    }
  });

  it('names a word this build was never compiled to know as unknown — never a blank cell, never a guess', () => {
    const newer = r({ childReclaim: { word: 'evicted', sentence: 'S', at: null } as unknown as ChildReclaimStatus });
    expect(childReclaimChip(newer)).toMatchObject({ word: 'unknown', label: 'workspace: unknown state', line: null });
  });

  it('titles the chip with the sentence, and the age of its moment when it has one', () => {
    const chip = childReclaimChip(r({ childReclaim: { word: 'deferred', sentence: 'waiting', at: 1_000_000 } }))!;
    expect(childReclaimTitle(chip, 1_000 + 3 * 3_600)).toBe('waiting · 3h ago');
    const bare = childReclaimChip(r({ childReclaim: { word: 'pending', sentence: null, at: null } }))!;
    expect(childReclaimTitle(bare, 0)).toBe('workspace pending');
  });

  it('calls a row gone only when its workspace was reclaimed', () => {
    expect(childReclaimGone(childReclaimChip(r({ childReclaim: { word: 'reclaimed', sentence: null, at: null } })))).toBe(true);
    for (const word of ['pending', 'deferred', 'paused', 'refused'] as const) {
      expect(childReclaimGone(childReclaimChip(r({ childReclaim: { word, sentence: null, at: null } }))), word).toBe(false);
    }
    expect(childReclaimGone(null)).toBe(false);
  });
});

describe('the finished row carries the reclaim chip, and a reclaimed row is inert (wave 5)', () => {
  const boardWith = async (childReclaim: ChildReclaimStatus | null): Promise<void> => {
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadCaps={NO_CAPS} loadRuns={async () => ({
      runs: [r({ id: 7, state: 'done', closedAt: Date.now() - 60_000, childReclaim })],
    })} />);
    await screen.findByRole('group', { name: /finished/i });
  };
  const chipEl = (): HTMLElement | null => document.querySelector('.run-child-reclaim');

  it('renders nothing for a row the server says nothing about — the no-regression baseline', async () => {
    await boardWith(null);
    expect(chipEl()).toBeNull();
    expect(document.querySelector('.run-open')).not.toBeNull();
  });

  it('renders both cues, and the server’s sentence as the title', async () => {
    await boardWith({ word: 'pending', sentence: 'waiting to be reclaimed', at: null });
    expect(chipEl()).toHaveAttribute('data-child-reclaim', 'pending');
    const glyph = chipEl()!.querySelector('.run-child-reclaim-glyph');
    expect(glyph?.textContent).toBe(CHILD_RECLAIM_GLYPH.pending);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(chipEl()!.textContent).toContain('workspace pending');
    expect(chipEl()).toHaveAttribute('title', 'waiting to be reclaimed');
    expect(document.querySelector('.run-child-reclaim-sentence')).toBeNull();
  });

  it('spells a refusal’s sentence out on its own line, verbatim', async () => {
    await boardWith({ word: 'refused', sentence: 'A SENTENCE THE SERVER COMPOSED', at: null });
    expect(document.querySelector('.run-child-reclaim-sentence')?.textContent).toBe('A SENTENCE THE SERVER COMPOSED');
  });

  it('stops offering to open a session that no longer exists once it is reclaimed', async () => {
    await boardWith({ word: 'reclaimed', sentence: 'gone', at: null });
    expect(document.querySelector('.run-open')).toBeNull();
    const li = chipEl()!.closest('li');
    expect(li).toHaveAttribute('data-inert', 'true');
    expect(li!.querySelector('.run-abandon')).not.toBeNull();
  });

  it.each(['pending', 'deferred', 'paused', 'refused'] as const)('keeps the open door on a %s row', async (word) => {
    await boardWith({ word, sentence: 'S', at: null });
    expect(document.querySelector('.run-open')).not.toBeNull();
  });
});
```

In `pwa/test/fleet-css.test.ts`, in `describe('runs are not living panes', …)`, extend the selector list. Replace

```ts
      '.run-row .run-project', '.run-row .run-crossing', '.run-row .run-crossing-glyph']) {
```

with

```ts
      '.run-row .run-project', '.run-row .run-crossing', '.run-row .run-crossing-glyph',
      // Child-reclamation wave 5's chip and its refusal line join the list: the
      // line carries the attention hue, the shape that tends to acquire a glow next.
      '.run-row .run-child-reclaim', '.run-row .run-child-reclaim-glyph', '.run-row .run-child-reclaim-sentence']) {
```

and add, inside that same `describe`, after the existing `it`:

```ts
  it('inks the reclaim chip from pairs already priced — no new colour pair (wave 5)', () => {
    expect(declValue(ruleFor('.run-row .run-child-reclaim'), 'color')).toBe('var(--ink-secondary)');
    expect(declValue(ruleFor('.run-row .run-child-reclaim-glyph'), 'color')).toBe('var(--ink-tertiary)');
    expect(declValue(ruleFor('.run-row .run-child-reclaim-sentence'), 'color')).toBe('var(--status-attention-text)');
    expect(declValue(ruleFor('.run-row .run-child-reclaim-sentence'), 'flex')).toBe('1 0 100%');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/fleet-css.test.ts
```

Expected: FAIL.
- The reader cases report `TypeError: childReclaimChip is not a function`.
- The board cases other than the baseline report on a missing element, e.g. `expect(element).toHaveAttribute()` with `received value must be an HTMLElement … Received has value: null`. In the reclaimed case, `.run-open` is not null.
- `fleet-css` reports `Error: no rule for .run-row .run-child-reclaim` in both cases.
- The baseline board case PASSES: it is the no-regression guard.

- [ ] **Step 3: The reader**

Append to `pwa/src/fleet/runWords.ts`. Note that no comment in this file may name the server's sentence table or quote a ws-reclaim token; Task 8's pin scans the whole file.

```ts
/* ── child-workspace reclamation (child-reclamation wave 5, spec §5.9) ────── */

/**
 * One glyph per word, TOTAL over `ChildReclaimWord`: a word the server gains is
 * a TS2741 here before it is a blank cell anywhere. The glyph is the SHAPE and
 * the word is the FACT, the board's standing two-cue rule. `⊘` is the
 * journal's own refusal glyph (`OUTCOME_GLYPH.refused`), so one mark means one
 * thing across both surfaces.
 */
export const CHILD_RECLAIM_GLYPH: Record<ChildReclaimWord, string> = {
  reclaimed: '∅', pending: '…', deferred: '⧖', paused: '‖', refused: '⊘',
};

export interface ChildReclaimChip {
  /** The server's word, or `unknown` for one this build was never compiled to know. */
  readonly word: ChildReclaimWord | 'unknown';
  readonly glyph: string;
  /** The visible text. */
  readonly label: string;
  /** The server's sentence, verbatim, or null. Never composed here. */
  readonly sentence: string | null;
  /** The sentence again when the word is a refusal, the one word the operator
   *  may need to read in full, so it gets its own wrapped line. Null otherwise;
   *  the other words carry their sentence in the title. */
  readonly line: string | null;
  /** Epoch ms of the moment the word describes, or null. */
  readonly at: number | null;
}

/**
 * THE ONE READER of `RunSummary.childReclaim` in `pwa/src` (CLAUDE.md "Wire
 * discipline": a newer peer tolerates an older peer omitting a field, through a
 * SINGLE reader per field). The field is optional here although the wire type
 * requires it: `api.runs()` is a bare cast, and a server that predates wave 5
 * omits the key. Every member is checked, not trusted. `null` means render
 * nothing, which is what every non-child row and every open row does.
 *
 * It MAPS NOTHING. The word is the server's, the sentence is the server's, and
 * the only vocabulary here is `CHILD_RECLAIM_GLYPH`, keyed on the word.
 */
export const childReclaimChip = (run: { childReclaim?: ChildReclaimStatus | null }): ChildReclaimChip | null => {
  const s: unknown = run.childReclaim;
  if (s === undefined || s === null || typeof s !== 'object') return null;
  const o = s as { word?: unknown; sentence?: unknown; at?: unknown };
  const sentence = typeof o.sentence === 'string' && o.sentence !== '' ? o.sentence : null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null;
  if (!isChildReclaimWord(o.word)) {
    return { word: 'unknown', glyph: '·', label: 'workspace: unknown state', sentence, line: null, at };
  }
  return {
    word: o.word,
    glyph: CHILD_RECLAIM_GLYPH[o.word],
    label: `workspace ${o.word}`,
    sentence,
    line: o.word === 'refused' ? sentence : null,
    at,
  };
};

/** The chip's `title`: the server's sentence, or the label when it sent none,
 *  and the age of the chip's moment when it has one. */
export const childReclaimTitle = (chip: ChildReclaimChip, nowSec: number): string => {
  const head = chip.sentence ?? chip.label;
  return chip.at === null ? head : `${head} · ${formatAge(nowSec - Math.floor(chip.at / 1000))}`;
};

/** Is the session this row names GONE? Only a reclaimed child's is, and then
 *  the row must stop offering to open it (spec §5.9). Every other word leaves
 *  a workspace behind. */
export const childReclaimGone = (chip: ChildReclaimChip | null): boolean =>
  chip !== null && chip.word === 'reclaimed';
```

Add `type ChildReclaimStatus, type ChildReclaimWord, isChildReclaimWord` to the file's existing `../../../shared/api` import.

- [ ] **Step 4: The row**

In `pwa/src/screens/RunsScreen.tsx`, add `childReclaimChip, childReclaimGone, childReclaimTitle` to the `../fleet/runWords` import. The line starts `import { DISPATCH_GLYPH, RUN_GLYPH, RUN_WORD, anyDispatchPending,`. Insert the three names after `anyDispatchPending,`.

In `RunRow`, directly after `const warnings = runWarnings(run, nowMs);`, add:

```ts
  // Child-reclamation wave 5 (spec §5.9): what became of this run's CHILD
  // workspace. `childReclaimChip` is the one reader. The word and the sentence
  // are the server's, and this component picks neither.
  const reclaim = childReclaimChip(run);
```

In `body`, directly after the `{resume !== null && ( … )}` block and before `{degradedFields.length > 0 && (`, add:

```tsx
      {/* Wave 5: the reclaim chip, `.run-kind`'s shape (glyph + word, the long
          form in `title`). Informational, so it lives inside `body` and
          therefore inside `.run-open`, like `.run-warn`: D-287's sibling rule
          binds controls, and this is prose. */}
      {reclaim !== null && (
        <span className="run-child-reclaim" data-child-reclaim={reclaim.word}
          title={childReclaimTitle(reclaim, nowSec)}>
          <span className="run-child-reclaim-glyph" aria-hidden="true">{reclaim.glyph}</span>
          {reclaim.label}
        </span>
      )}
      {/* A refusal's sentence on its own wrapped line (`flex-basis: 100%`,
          `.run-warn`'s idiom). The chip decides when there is one; this lays
          out what it was handed. */}
      {reclaim !== null && reclaim.line !== null && (
        <span className="run-child-reclaim-sentence">{reclaim.line}</span>
      )}
```

Replace the return's first line

```tsx
  return run.sessionId === null
```

with

```tsx
  // A reclaimed child's session no longer exists (spec §5.9: the row "stops
  // offering to open its session"). It gets the inert row a session-less run
  // already gets, for the reason given above: a button that navigates to a
  // session that does not exist says something false. `resumeButton` and
  // `abandonButton` keep their place. Neither is about the worker's session.
  return run.sessionId === null || childReclaimGone(reclaim)
```

- [ ] **Step 5: The ink**

In `pwa/src/fleet/fleet.css`, directly after the `.run-row .run-resumed { … }` rule, add:

```css
/* Child-reclamation wave 5 (spec §5.9): what became of a finished run's CHILD
   workspace. Scoped under `.run-row`, which is self-grounded (background and
   colour both set), so these inherit the recovered ground `.run-row .run-kind`
   does: no new token pair for design/contrast-check.mjs to price. The chip takes
   `--ink-secondary` like `.run-kind`, and its glyph `--ink-tertiary` like every
   glyph on this row. A refusal is told apart by its WORD and its glyph, never
   by a hue. Its sentence gets its own wrapped line in the amber `.run-warn`
   already prices (`--status-attention-text`), because a terminal refusal is the
   one word here the operator may need to read in full. NO --glow, NO animation,
   NO box-shadow: runs are not living panes (`fleet-css.test.ts`). */
.run-row .run-child-reclaim {
  display: inline-flex; align-items: baseline; gap: var(--sp-1);
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--ink-secondary);
}
.run-row .run-child-reclaim-glyph { color: var(--ink-tertiary); }
.run-row .run-child-reclaim-sentence {
  flex: 1 0 100%;
  min-width: 0;
  padding-bottom: var(--sp-1);
  font-size: var(--text-2xs);
  color: var(--status-attention-text);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/fleet-css.test.ts test/contrast.test.ts test/tap-targets.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS. `contrast` and `tap-targets` stay green unchanged: no new pair, and the chip is a `<span>`, not a control, following `.run-kind`'s precedent. `tsc` prints nothing.

- [ ] **Step 7: Mutation check, then commit**

Command: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/fleet-css.test.ts`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | In `RunsScreen.tsx`, `return run.sessionId === null \|\| childReclaimGone(reclaim)` → `return run.sessionId === null` | "stops offering to open…": `expected <button class="run-open">… to be null` |
| 2 | In `childReclaimChip`, replace the whole body after the first line with `return { word: (s as ChildReclaimStatus).word, glyph: CHILD_RECLAIM_GLYPH[(s as ChildReclaimStatus).word], label: \`workspace ${(s as ChildReclaimStatus).word}\`, sentence: (s as ChildReclaimStatus).sentence, line: null, at: (s as ChildReclaimStatus).at };` (a trusting reader) | "names a word this build was never compiled to know": `expected { word: 'evicted', glyph: undefined, … } to match object { word: 'unknown', … }` |
| 3 | `line: o.word === 'refused' ? sentence : null` → `line: sentence` | "puts the sentence on its own line only for a refusal": `reclaimed: expected 'S' to be null` |
| 4 | In `.run-row .run-child-reclaim-sentence`, `color: var(--status-attention-text);` → `color: var(--status-dead-text);` | `fleet-css` "inks the reclaim chip…": `expected 'var(--status-dead-text)' to be 'var(--status-attention-text)'` |
| 5 | Add `box-shadow: 0 0 2px var(--ink-tertiary);` to `.run-row .run-child-reclaim`. No `--glow` token on purpose: the test asserts `not.toContain('--glow')` BEFORE `not.toContain('box-shadow')`, so a `var(--glow-busy)` value would red on the first assertion and never exercise the box-shadow arm | "no run rule glows…": `.run-row .run-child-reclaim: expected '…box-shadow: 0 0 2px var(--ink-tertiary)…' not to contain 'box-shadow'` |

Revert each, then:

```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css \
  pwa/test/runs-screen.test.tsx pwa/test/fleet-css.test.ts
git commit -m "$(cat <<'MSG'
feat(pwa): the finished run's reclaim chip, and the inert reclaimed row

childReclaimChip is the one tolerant reader of RunSummary.childReclaim. It
renders the server's word with a glyph and the server's sentence, and
spells a refusal's sentence on its own line. It maps no token. A reclaimed
child's row renders inert: its session no longer exists (spec §5.9). All
ink comes from pairs already priced.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The board re-reads the archive when a finished child vanishes

**Model routing:** `sonnet`, effort `medium`.

**Why this task exists.** The chip changes after its run has closed (`pending` → `reclaimed`), and `finished` has one source, the cold read, taken once per mount. The live `runs` frame cannot help: it is active-only by construction. The house rules out polling. What the socket *does* carry is the reclaim itself: `ws-reclaim` purges the registry row, so the session leaves the next `fleet` frame. A diff against the previous fleet frame is the trigger. It uses the same idiom as the existing run-id vanish diff (review finding 22), and it fires only on a real transition. A `pending` chip that becomes `refused` without a vanish updates on the next mount, and so does a `paused` chip when the fleet-wide switch comes down (contract §7 R7): the switch's own banner on `/runs` rides the coord frame and is live. The live surface for a terminal refusal is wave 4's attention item in the banner, which rides the coord frame.

**Files:**
- Modify: `pwa/src/fleet/runWords.ts` (append `childReclaimRefreshDue` to the wave-5 section)
- Modify: `pwa/src/screens/RunsScreen.tsx` (the `runWords` import; one effect directly after the `prevLiveIdsRef` effect)
- Test: `pwa/test/runs-screen.test.tsx` (append)

**Interfaces:**
- Consumes: `childReclaimChip` (Task 6); the fleet store's existing `sessions` / `fleetFrameSeen`.
- Produces: `export function childReclaimRefreshDue(finished: readonly RunSummary[], before: ReadonlySet<string>, after: ReadonlySet<string>): boolean`.

- [ ] **Step 1: Write the failing tests**

Add `childReclaimRefreshDue` to `pwa/test/runs-screen.test.tsx`'s `../src/fleet/runWords` import, then append:

```tsx
describe('childReclaimRefreshDue — a vanish, never a poll (wave 5)', () => {
  const SID = 'ccrc-pwa-clear-cove';
  const row = (word: ChildReclaimStatus['word'] | null, over: Partial<RunSummary> = {}): RunSummary =>
    r({ id: 7, state: 'done', closedAt: 1, childReclaim: word === null ? null : { word, sentence: null, at: null }, ...over });

  it('is due when an unsettled finished row’s session leaves the fleet', () => {
    for (const word of ['pending', 'deferred', 'paused'] as const) {
      expect(childReclaimRefreshDue([row(word)], new Set([SID]), new Set()), word).toBe(true);
    }
  });

  it('is not due for a settled word, a session still listed, a session never listed, or a row with no chip', () => {
    expect(childReclaimRefreshDue([row('reclaimed')], new Set([SID]), new Set())).toBe(false);
    expect(childReclaimRefreshDue([row('refused')], new Set([SID]), new Set())).toBe(false);
    expect(childReclaimRefreshDue([row('pending')], new Set([SID]), new Set([SID]))).toBe(false);
    expect(childReclaimRefreshDue([row('pending')], new Set(), new Set())).toBe(false);
    expect(childReclaimRefreshDue([row(null)], new Set([SID]), new Set())).toBe(false);
  });
});

describe('the board re-reads the archive when a finished child leaves the fleet (wave 5)', () => {
  const pendingRow = (): RunSummary =>
    r({ id: 7, state: 'done', closedAt: Date.now() - 60_000, childReclaim: { word: 'pending', sentence: null, at: null } });

  it('re-reads once when the pending child’s session vanishes from the fleet frame', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [sess()], fleetFrameSeen: true }); });
    const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: [pendingRow()] }));
    render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
    await screen.findByRole('group', { name: /finished/i });
    expect(loadRuns).toHaveBeenCalledTimes(1);
    act(() => { store.setState({ sessions: [] }); });
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  });

  it('does not re-read when an unrelated session vanishes, or when the row already reads reclaimed', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true,
      sessions: [sess(), sess({ id: 'ccrc-pwa-keen-dune' })], fleetFrameSeen: true }); });
    const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: [
      r({ id: 7, state: 'done', closedAt: Date.now() - 60_000, childReclaim: { word: 'reclaimed', sentence: null, at: null } }),
    ] }));
    render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
    await screen.findByRole('group', { name: /finished/i });
    act(() => { store.setState({ sessions: [sess()] }); });          // an unrelated session left
    act(() => { store.setState({ sessions: [] }); });               // this row's left, but it is settled
    await act(async () => { await Promise.resolve(); });
    expect(loadRuns).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`

Expected: FAIL.
- The two decision cases report `TypeError: childReclaimRefreshDue is not a function`.
- "re-reads once…" times out in `waitFor` with `expected "spy" to be called 2 times, but got 1 times`.
- "does not re-read…" PASSES before the change: it is the guard that the trigger is narrow.

- [ ] **Step 3: The decision, then the effect**

Append to `pwa/src/fleet/runWords.ts`'s wave-5 section:

```ts
const CHILD_RECLAIM_UNSETTLED: ReadonlySet<string> = new Set<ChildReclaimWord>(['pending', 'deferred', 'paused']);

/**
 * Should the board re-read its archive? Yes exactly when a FINISHED row whose
 * chip is still unsettled names a session that was in the previous fleet frame
 * and is not in this one. A child's reclaim purges its registry row, so this is
 * the socket carrying the moment the chip goes stale. The board refuses a poll
 * (RunsScreen's header) and needs none.
 *
 * `reclaimed` and `refused` are settled: the first has nothing left to vanish,
 * and the second is wave 4's attention item's to keep live. A session never
 * listed cannot vanish.
 */
export function childReclaimRefreshDue(
  finished: readonly RunSummary[], before: ReadonlySet<string>, after: ReadonlySet<string>,
): boolean {
  for (const run of finished) {
    const sid = run.sessionId;
    if (sid === null || !before.has(sid) || after.has(sid)) continue;
    const chip = childReclaimChip(run);
    if (chip !== null && CHILD_RECLAIM_UNSETTLED.has(chip.word)) return true;
  }
  return false;
}
```

In `pwa/src/screens/RunsScreen.tsx`, add `childReclaimRefreshDue` to the `../fleet/runWords` import. Directly after the effect that ends `prevLiveIdsRef.current = ids;` (the one keyed `[live, runsFrameSeen]`), add:

```tsx
  // Child-reclamation wave 5: a finished row's reclaim chip changes AFTER its run
  // closed (pending → reclaimed), and `finished` has one source, the cold read.
  // A reclaim purges the child's registry row, so its session leaves the next
  // fleet frame. That vanish is the trigger, a diff against the PREVIOUS fleet
  // frame exactly like the run-id diff above. It is not a poll: it fires only on
  // a real transition. The decision is `childReclaimRefreshDue`'s.
  const prevSessionIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!fleetFrameSeen) return;
    const ids = new Set(sessions.map((s) => s.id));
    const prev = prevSessionIdsRef.current;
    prevSessionIdsRef.current = ids;
    if (prev !== null && childReclaimRefreshDue(cold ?? [], prev, ids)) void loadCold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, fleetFrameSeen]);
```

The effect reads `cold` from the render it runs in. Its dependencies are the fleet frame's, deliberately. A cold read landing is not a transition of the fleet, and re-running on it would compare a frame with itself.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/mail-screen.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS. `mail-screen` stays green: it loads runs through its own loader and never renders this effect. `tsc` prints nothing.

- [ ] **Step 5: Mutation check, then commit**

Command: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | Delete the whole new `useEffect(…)` (keep the ref) | "re-reads once…": `expected "spy" to be called 2 times, but got 1 times` |
| 2 | In `childReclaimRefreshDue`, replace `if (chip !== null && CHILD_RECLAIM_UNSETTLED.has(chip.word)) return true;` with `if (chip !== null) return true;` | "is not due for a settled word…" (`reclaimed`: `expected true to be false`) and "does not re-read…" (`expected "spy" to be called 1 times, but got 2 times`) |
| 3 | Delete `!before.has(sid) \|\| ` | "…a session never listed…": `expected true to be false` |

Revert each, then:

```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/test/runs-screen.test.tsx
git commit -m "$(cat <<'MSG'
feat(pwa): re-read the run archive when a finished child's session vanishes

A reclaim purges the child's registry row, so its session leaves the next
fleet frame. A diff against the previous frame re-reads the archive exactly
then, and only for a row whose chip is still pending, deferred or paused.
There is no poll: the board's cadence rule stands.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The PWA maps no token: the rule as a red suite

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Test: `server/test/child-reclaim-chip-source.test.ts` (new). It lives in `server/`, because the token list is `CHILD_RECLAIM_TOKEN_KIND` (`server/src`). `resume-reclaim-l0.test.ts` already pins PWA source from here.

**Interfaces:**
- Consumes: `CHILD_RECLAIM_TOKEN_KIND` (wave 3); `CHILD_RECLAIM_WORDS` (Task 1); the three PWA files Tasks 6, 7 and 9 touch.
- Produces: nothing at runtime.

A token that is also a `ChildReclaimWord` (`paused`, today) is excluded from the scan. The server hands the PWA *words*. The PWA's own glyph table and its unsettled set must be allowed to spell them, and a token that coincides with a word is that word.

The scanned list is DERIVED from `CHILD_RECLAIM_TOKEN_KIND`, so contract §8 R19's `no-worktree-record` is scanned with no edit here, and the vacuity guard is a floor (`>= 10`), not a count, so a fourteenth token moves nothing. Measured at planning: `grep -cE "['\"\`]no-worktree-record['\"\`]"` prints 0 for each of `runWords.ts`, `RunsScreen.tsx` and `SessionLine.tsx`.

**`SessionLine.tsx` is scanned for imports, not for token literals.** It already spells `'held'` four times before this wave touches it (`ask.state === 'held'`, `askRaw.state === 'held'`, and two backticked comment mentions), and those are an ASK's state, not a ws-reclaim refusal. `held` is a ws-reclaim token (kind `retry`) that is not a word, so a whole-file literal scan of `SessionLine.tsx` would be red before any wave-5 code exists. It needs no such scan: it renders no chip and reads no refusal token. Its one wave-5 read is `FleetSession.child`, through `childOfRunLabel` in `runWords.ts`, which IS scanned. So the token-literal case runs over `runWords.ts` and `RunsScreen.tsx` only, and the import case still runs over all three. Measured at planning: `grep -cE "['\"\`]held['\"\`]" pwa/src/fleet/SessionLine.tsx` prints 4, and the same grep for every token over `runWords.ts` and `RunsScreen.tsx` prints 0.

- [ ] **Step 1: Write the test**

Create `server/test/child-reclaim-chip-source.test.ts`:

```ts
// Child-reclamation wave 5, Task 8: spec §5.9's rule as a red suite. "Refusal
// sentences come from a lookup keyed by the refusal token, never respelled at
// the surface — and the lookup is the server's." The PWA renders the server's
// word and sentence, spells no ws-reclaim token, and imports no server sentence
// table. `RunSummary.childReclaim` has ONE reader in pwa/src.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_RECLAIM_TOKEN_KIND } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_WORDS } from '../../shared/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['pwa/src/fleet/runWords.ts', 'pwa/src/screens/RunsScreen.tsx', 'pwa/src/fleet/SessionLine.tsx'] as const;
/** The files that render the chip. SessionLine.tsx is NOT one of them: it
 *  renders no chip, and it already spells `'held'` as an ASK state, which is
 *  not a ws-reclaim refusal. Its child label is read in runWords.ts, which is
 *  scanned. */
const TOKEN_FILES = [FILES[0], FILES[1]] as const;
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');

/** Every `.ts`/`.tsx` under pwa/src, recursively. */
const pwaSources = (dir = path.join(root, 'pwa', 'src')): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return pwaSources(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

describe('the PWA maps no ws-reclaim token — the sentence is the server’s (spec §5.9)', () => {
  const words: readonly string[] = CHILD_RECLAIM_WORDS;
  const tokens = Object.keys(CHILD_RECLAIM_TOKEN_KIND).filter((t) => !words.includes(t));

  it('has a token list to scan — an empty one would pass vacuously', () => {
    expect(tokens.length).toBeGreaterThanOrEqual(10);
  });

  it('reads the files that render the chip, and they do render it', () => {
    expect(read(FILES[0])).toContain('export const childReclaimChip');
    expect(read(FILES[1])).toContain('run-child-reclaim');
  });

  it.each(TOKEN_FILES)('%s spells no ws-reclaim refusal token as a string literal', (f) => {
    const src = read(f);
    const hits = tokens.filter((t) => new RegExp(`['"\`]${t.replace(/-/g, '\\-')}['"\`]`).test(src));
    expect(hits).toEqual([]);
  });

  it.each(FILES)('%s imports no server sentence table', (f) => {
    expect(read(f)).not.toMatch(/wsaudit|refusalSentence|SENTENCES/);
  });

  it('has ONE reader of RunSummary.childReclaim in pwa/src — runWords.ts', () => {
    const readers = pwaSources()
      .filter((f) => /\.childReclaim\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(readers).toEqual(['pwa/src/fleet/runWords.ts']);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-chip-source.test.ts`

Expected: PASS, 8/8 (1 vacuity guard, 1 files-render-the-chip case, 2 token-literal cases, 3 import cases, 1 one-reader case). Tasks 6 and 7 already hold the rule. This suite is the mechanism, and Step 3 proves it binds.

- [ ] **Step 3: Mutation check, then commit**

Command: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-chip-source.test.ts`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | Append to `pwa/src/fleet/runWords.ts`: `export const CHILD_RECLAIM_COPY = { 'not-a-child': 'not a child' };` | `pwa/src/fleet/runWords.ts spells no ws-reclaim refusal token…`: `expected [ 'not-a-child' ] to deeply equal []` |
| 2 | Add to `pwa/src/screens/RunsScreen.tsx`'s `RunRow`: `const gone = run.childReclaim?.word === 'reclaimed';` (unused is fine for the mutation; `tsc` is not run here) | "ONE reader…": `expected [ 'pwa/src/fleet/runWords.ts', 'pwa/src/screens/RunsScreen.tsx' ] to deeply equal [ 'pwa/src/fleet/runWords.ts' ]` |
| 3 | Add a comment line `// see refusalSentence` anywhere in `pwa/src/fleet/runWords.ts` | `…imports no server sentence table`: `expected '…' not to match /wsaudit\|refusalSentence\|SENTENCES/` |
| 4 | Temporarily replace `CHILD_RECLAIM_TOKEN_KIND` in the test's filter with `{}` (test-side control: the vacuity guard) | "has a token list to scan": `expected 0 to be greater than or equal to 10` |

Revert each (row 4 is in the test file itself), then:

```bash
git add server/test/child-reclaim-chip-source.test.ts
git commit -m "$(cat <<'MSG'
test(pwa): the PWA maps no ws-reclaim token and has one chip reader

Spec §5.9's "the lookup is the server's" as a red suite. The files that render
the chip spell no ws-reclaim refusal token and import no server sentence
table, and RunSummary.childReclaim has exactly one reader in pwa/src.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: `SessionLine`'s `child of run #N` label

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `pwa/src/fleet/runWords.ts` (append `childOfRunLabel`; add `type ChildMark` to its `shared/api` import)
- Modify: `pwa/src/fleet/SessionLine.tsx`: `import { childOfRunLabel } from './runWords';`; one derived value after `const qualifier = lifecycleQualifier(session);`; one cell directly after the `{session.held !== null && ( … )}` block
- Modify: `pwa/src/fleet/fleet.css`: `.sess-child` directly after the `.sess-substrate { … }` rule; `.sess-line--active .sess-child,` directly after `.sess-line--active .sess-substrate,` in the achromatic group
- Modify: `pwa/design/audit.mjs`: one `INHERITED_GROUNDS` entry, `'fleet.css .sess-child'`, directly above the `'fleet.css .sess-spawn'` entry
- Test: `pwa/test/session-line.test.tsx` (append), `pwa/test/fleet-css.test.ts` (two edits), `pwa/test/contrast.test.ts` (append one describe)

**Interfaces:**
- Consumes: `FleetSession.child: ChildMark` (wave 2, entry condition b).
- Produces: `export const childOfRunLabel: (session: { child?: ChildMark }) => ChildOfRunLabel | null`, where `export interface ChildOfRunLabel { readonly text: string; readonly data: 'child' | 'unreadable'; readonly title: string }`; and `INHERITED_GROUNDS['fleet.css .sess-child'] = { under: ['var(--bg-surface)'], why: string }`.

**The ruled shape, in a rule of its own (contract §7 R7).** *"The `.sess-child` label takes the drafter's proposed shape (`color: var(--ink-tertiary); flex: none`, no truncation)."* That is `.sess-substrate`'s shape, declaration for declaration: the label's words are fixed (`child of run #42`) and sit beside the hold reason, `.sess-meta`'s one shrinkable cell, so a `flex: none` cell keeps its few words whole and leaves the truncation to the hold reason, the way `.sess-spawn`'s and `.sess-substrate`'s fixed words already do. So `.sess-child` carries exactly two declarations, `color: var(--ink-tertiary)` and `flex: none`, and none of `white-space`, `overflow` or `text-overflow`; a fleet-css case holds both values equal to `.sess-substrate`'s and holds the declaration set to exactly those two. It sits in a rule of its own rather than as a second selector on `.sess-substrate`'s rule, for the contrast census: that rule's key is in `contrast.test.ts`'s `GRANDFATHERED_UNCOVERED` (`'fleet.css .sess-substrate'`), so adding a selector would rename the key, which would read as a NEW uncovered identity and red the census. A rule of its own can be registered and measured instead (below). The ruling names a shape, not a selector group.

**The contrast census owes one registry entry.** A new rule that sets a `color` and supplies no ground, under a selector that names no painted ancestor, lands in `audit().uncovered`. `contrast.test.ts`'s "contains no identities beyond the grandfathered blind spots" then fails with `expected [ 'fleet.css .sess-child' ] to deeply equal []`. `.sess-substrate`, whose shape this rule copies, passes only because its key is grandfathered, and a new rule may not join that list. The answer is the one `.sess-spawn`, `.sess-repo`, `.sess-stranded` and `.sess-offpool` already take: an `INHERITED_GROUNDS` entry on `var(--bg-surface)`, the project card the unselected `.sess-line` sits on. The selected row is answered by the achromatic group. Measured at planning on a scratch copy of `pwa/design` and `pwa/src` with a `.sess-child` rule painting `color: var(--ink-tertiary)`: without the entry, `audit().uncovered` contains `'fleet.css .sess-child'`. With it, the rule is measured at 5.77 (dark) and 5.70 (light), both clearing 4.5. That measurement was taken on this ruled `.sess-substrate` shape. The audit reads the rule's `color` and its ground, but Step 4's `contrast` run is the measurement that counts. Take the ratios from it, never from this paragraph.

- [ ] **Step 1: Write the failing tests**

Append to `pwa/test/session-line.test.tsx`. Add `import { childOfRunLabel } from '../src/fleet/runWords';` with the file's imports.

```tsx
// ── child-reclamation wave 5: the child-of-run label ────────────────────────
//
// `.sess-held`'s ink register: a short fact, no action. Three answers, never two
// (spec §5.1): a child names its minting run; an unreadable marker says so
// rather than reading as "not a child"; no marker says nothing.
describe('a child workspace says which run minted it (wave 5)', () => {
  const cell = (): HTMLElement | null => document.querySelector('.sess-child');

  it('says nothing for a workspace that is not a child — the no-regression baseline', () => {
    render(<SessionLine session={s({ child: { kind: 'none' } })} onOpen={() => {}} onActions={() => {}} />);
    expect(cell()).toBeNull();
  });

  it('names the minting run on a child, as inert text', () => {
    render(<SessionLine session={s({ child: { kind: 'child', runId: 42 } })} onOpen={() => {}} onActions={() => {}} />);
    expect(cell()?.textContent).toBe('child of run #42');
    expect(cell()).toHaveAttribute('data-child', 'child');
    expect(cell()?.tagName).toBe('SPAN');
  });

  it('says the marker could not be read rather than dropping it', () => {
    render(<SessionLine session={s({ child: { kind: 'unreadable' } })} onOpen={() => {}} onActions={() => {}} />);
    expect(cell()?.textContent).toBe('child marker unreadable');
    expect(cell()).toHaveAttribute('data-child', 'unreadable');
  });

  it('reads the field DEFENSIVELY — a live fleet frame is cast, never revived', () => {
    const legacy = { ...s() } as Record<string, unknown>;
    delete legacy['child'];
    expect(() => render(<SessionLine session={legacy as unknown as FleetSession}
                                     onOpen={() => {}} onActions={() => {}} />)).not.toThrow();
    expect(cell()).toBeNull();
    expect(childOfRunLabel({})).toBeNull();
    expect(childOfRunLabel({ child: { kind: 'child', runId: 'x' } as unknown as { kind: 'child'; runId: number } })).toBeNull();
  });
});
```

In `pwa/test/fleet-css.test.ts`, `selectorsOf`, `declValue` and `stripComments` are already in the file's `./cssRule` import (as of `62d9c485`); add any that is not. Then extend the explicit achromatic list in `it('strips every status and account hue from the slab', …)`. Replace

```ts
                        '.sess-ctxpressure']) {
```

with

```ts
                        '.sess-ctxpressure',
                        // Child-reclamation wave 5's label: its own
                        // `color: var(--ink-tertiary)` strands on the slab exactly
                        // like `.sess-substrate`'s would without its entry here.
                        '.sess-child']) {
```

and, directly after `it('gives the spawn chip a flex: none cell so it cannot steal the hold reason\'s room', …)`, add:

```ts
  it('gives the child-of-run label .sess-substrate\'s shape, in a rule of its own (wave 5, spec §5.9)', () => {
    // The ruled shape: `color: var(--ink-tertiary); flex: none`, no truncation. Fixed
    // words beside the hold reason, the row's one shrinkable cell, so the label
    // never truncates and never steals the hold reason's room. Its OWN rule,
    // not a second selector on .sess-substrate's: that rule's key is
    // grandfathered in contrast.test.ts's uncovered census, and renaming it
    // would read as a new blind spot.
    const substrate = ruleFor('.sess-substrate');
    const child = ruleFor('.sess-child');
    for (const prop of ['color', 'flex']) {
      expect(declValue(child, prop), prop).not.toBeNull();
      expect(declValue(child, prop), prop).toBe(declValue(substrate, prop));
    }
    const props = stripComments(child).split(';').map((d) => d.split(':')[0]!.trim()).filter((p) => p !== '');
    expect(props.sort(), 'no truncation, and nothing beyond the ruled shape').toEqual(['color', 'flex']);
    expect(selectorsOf(css, '.sess-child')).toEqual(['.sess-child']);
  });
```

Append to `pwa/test/contrast.test.ts`, after the last `describe`:

```ts
// ── child-reclamation wave 5's child-of-run label ───────────────────────────
describe('the child-of-run label is measured, not left in the blind spot (wave 5)', () => {
  it('grounds .sess-child on the project card and clears both themes', () => {
    // Same shape as .sess-spawn/.sess-repo: a .sess-meta cell whose selector
    // names no painted ancestor, so without its INHERITED_GROUNDS entry it
    // would join the uncovered census, which new rules may not do.
    const key = 'fleet.css .sess-child';
    expect(INHERITED_GROUNDS[key]?.under).toEqual(['var(--bg-surface)']);
    expect(report.uncovered).not.toContain(key);
    const rows = report.measured.filter((m) => m.label.endsWith(key));
    expect(rows, key).toHaveLength(2);           // dark and light
    for (const row of rows) expect(row.ratio, row.label).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/fleet-css.test.ts test/contrast.test.ts
```

Expected: FAIL.
- "names the minting run…" reports `expected undefined to be 'child of run #42'`, and "says the marker…" fails the same way.
- "reads the field DEFENSIVELY" reports `TypeError: childOfRunLabel is not a function`.
- In `fleet-css`, the achromatic case reports `expected [ …(group) ] to include '.sess-line--active .sess-child'`, and the new shape case reports `Error: no rule for .sess-child`.
- In `contrast`, the new case reports `expected undefined to deeply equal [ 'var(--bg-surface)' ]`. Every existing `contrast` case stays green: no `.sess-child` rule exists yet.
- The baseline case PASSES.

- [ ] **Step 3: The reader, the cell, the ink**

Append to `pwa/src/fleet/runWords.ts`'s wave-5 section, and add `type ChildMark` to its `shared/api` import:

```ts
export interface ChildOfRunLabel {
  readonly text: string;
  readonly data: 'child' | 'unreadable';
  readonly title: string;
}

/**
 * THE ONE READER of `FleetSession.child` in `pwa/src`, for the fleet line's
 * label. Optional here although the wire type requires it: the live `fleet`
 * frame is cast, never revived, and a server predating wave 2 omits the key.
 * THREE answers and no boolean (spec §5.1). A child names its minting run. An
 * unreadable marker says so, because the server treats it as neither "a child"
 * nor "not a child": it refuses a second run and defers a reclaim. No marker,
 * or a shape this build cannot read, says nothing.
 */
export const childOfRunLabel = (session: { child?: ChildMark }): ChildOfRunLabel | null => {
  const c: unknown = session.child;
  if (c === undefined || c === null || typeof c !== 'object') return null;
  const o = c as { kind?: unknown; runId?: unknown };
  if (o.kind === 'child' && typeof o.runId === 'number' && Number.isSafeInteger(o.runId)) {
    return {
      text: `child of run #${o.runId}`,
      data: 'child',
      title: `minted by run #${o.runId} for one PR; the server reclaims it when its run closes`,
    };
  }
  if (o.kind === 'unreadable') {
    return {
      text: 'child marker unreadable',
      data: 'unreadable',
      title: 'this workspace’s child marker could not be read: it takes no second run, and is not reclaimed until it can be read',
    };
  }
  return null;
};
```

In `pwa/src/fleet/SessionLine.tsx`, add `import { childOfRunLabel } from './runWords';` beside the other `./…` imports. Directly after `const qualifier = lifecycleQualifier(session);`, add:

```ts
  // Child-reclamation wave 5: which run minted this workspace, when it is a
  // child. `childOfRunLabel` is the one reader of `session.child`.
  const childOf = childOfRunLabel(session);
```

Directly after the closing `)}` of the `{session.held !== null && ( … )}` block, add:

```tsx
          {/* Wave 5: the child-of-run label. Informational only, in
              `.sess-substrate`'s shape: a short, fixed,
              never-truncated ink-tertiary fact about which run this
              workspace belongs to. The full sentence lives in `title`. */}
          {childOf !== null && (
            <span className="sess-child" data-child={childOf.data} title={childOf.title}>
              {childOf.text}
            </span>
          )}
```

In `pwa/src/fleet/fleet.css`, directly after the `.sess-substrate { … }` rule (find it with `grep -n "^\.sess-substrate {$" pwa/src/fleet/fleet.css`), add:

```css
/* Child-reclamation wave 5: which run minted this workspace, on a child's
   fleet line. .sess-substrate's shape: ink-tertiary, fixed
   words, `flex: none`, never truncated, so the hold reason beside it stays
   the row's one shrinkable cell. It is a rule of its OWN, not a second
   selector on the rule above, because that rule's key is grandfathered in
   the contrast gate's uncovered census and renaming it would read as a new
   blind spot. Its own `color` takes it out of .sess-meta's
   inheritance, so it is also named in .sess-line--active's achromatic group,
   which answers the selected row. The unselected row's ground is the project
   card: design/audit.mjs's INHERITED_GROUNDS entry for this rule is what makes
   that pair MEASURED rather than a new entry in the uncovered census. */
.sess-child {
  color: var(--ink-tertiary);
  flex: none;
}
```

and in the achromatic group, directly after the line `.sess-line--active .sess-substrate,`, add `.sess-line--active .sess-child,`.

In `pwa/design/audit.mjs`'s `INHERITED_GROUNDS`, directly above the `'fleet.css .sess-spawn': {` entry (find it with `grep -n "'fleet.css .sess-spawn': {" pwa/design/audit.mjs`), add:

```js
  'fleet.css .sess-child': {
    under: ['var(--bg-surface)'],
    why: "child-reclamation wave 5's child-of-run label is a .sess-meta cell on an unselected .sess-line, whose ground is the project card, in the same ink-tertiary register as .sess-held next door. Its selector names no ancestor, so no route could ground it; without this entry it would join the uncovered census, which new rules may not do. The SELECTED row is answered by the achromatic group (--edge-strong), pinned separately in fleet-css.test.ts",
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/fleet-css.test.ts test/contrast.test.ts test/fleet-screen.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/child-reclaim-chip-source.test.ts
```

Expected: PASS everywhere. The coloured-cell census, "leaves no coloured cell on the row without an answer on the slab", now counts `sess-child` and finds it answered. In `contrast`, the new case measures `.sess-child` in both themes, "contains no identities beyond the grandfathered blind spots" stays green because the rule is registered, and "has no stale inherited registry entry" stays green because the rule exists. Task 8's pin re-runs its import case over `SessionLine.tsx` and stays green; its token-literal case does not scan that file (Task 8's note). `tsc` prints nothing.

- [ ] **Step 5: Mutation check, then commit**

Command: `cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/fleet-css.test.ts test/contrast.test.ts`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | Delete the `{childOf !== null && ( … )}` block from `SessionLine.tsx` | "names the minting run…": `expected undefined to be 'child of run #42'` |
| 2 | In `childOfRunLabel`, delete the `if (o.kind === 'unreadable') { … }` arm | "says the marker could not be read…": `expected undefined to be 'child marker unreadable'` |
| 3 | Delete `.sess-line--active .sess-child,` from the achromatic group | "strips every status…": `expected [ …(group) ] to include '.sess-line--active .sess-child'`, AND "leaves no coloured cell…": `expected [ 'sess-child' ] to deeply equal []` |
| 4 | In `.sess-child`, delete `flex: none;` | "gives the child-of-run label .sess-substrate's shape…": `flex: expected null not to be null` |
| 5 | In `.sess-child`, add `text-overflow: ellipsis;` (a truncating label, the pre-ruling shape) | the same case: `no truncation, and nothing beyond the ruled shape: expected [ 'color', 'flex', 'text-overflow' ] to deeply equal [ 'color', 'flex' ]` |
| 6 | In `pwa/design/audit.mjs`, delete the whole `'fleet.css .sess-child': { … },` entry | `contrast` "grounds .sess-child on the project card…": `expected undefined to deeply equal [ 'var(--bg-surface)' ]`, AND "contains no identities beyond the grandfathered blind spots": `expected [ 'fleet.css .sess-child' ] to deeply equal []` |
| 7 | Delete the whole `.sess-child { … }` rule, and add `.sess-child` to `.sess-substrate`'s rule instead (`.sess-substrate {` → `.sess-substrate, .sess-child {`) | fleet-css "gives the child-of-run label .sess-substrate's shape, in a rule of its own…": `expected [ '.sess-substrate', '.sess-child' ] to deeply equal [ '.sess-child' ]`. Record what `contrast` reports for the renamed key as well; the planning claim is that it reads as a new uncovered identity |

Revert each, then:

```bash
git add pwa/src/fleet/runWords.ts pwa/src/fleet/SessionLine.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs \
  pwa/test/session-line.test.tsx pwa/test/fleet-css.test.ts pwa/test/contrast.test.ts
git commit -m "$(cat <<'MSG'
feat(pwa): a child workspace's fleet line names the run that minted it

childOfRunLabel is the one tolerant reader of FleetSession.child and gives
three answers. A child reads "child of run #N". An unreadable marker says
so rather than passing for "not a child". No marker says nothing. The cell
takes .sess-substrate's shape (contract §7 R7: ink-tertiary, flex: none,
no truncation) in a rule of its own, and an
INHERITED_GROUNDS entry grounds it on the project card, so the contrast
gate measures it rather than leaving it in the uncovered census.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Whole-branch verification, deploy order, PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified. This task runs, proves, opens the PR and reports.

**Interfaces:**
- Consumes: everything Tasks 1–9 produced.
- Produces: the wave-5 branch, pushed, with its PR open against `main`. Once merged and rolled out, the operator can read what became of a child (spec §8's measure for wave 5). No later wave consumes anything from this one.

- [ ] **Step 1: Run all three package suites, in the foreground**

```bash
cd server && npm ci && npm run test
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

Expected: PASS in all three. Each needs a timeout of at least 600000 ms and must run in the foreground. `agent` is untouched by this wave and must be green unchanged. Re-run `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` and `ccd-bounded-reads` IN ISOLATION before calling any of them a real break.

- [ ] **Step 2: Type-check both packages this wave touched, and the deviation cross-check**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa    && ./node_modules/.bin/tsc --noEmit -p .
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
```

Expected: both `tsc` runs print nothing, and both vitest files PASS. `deviation-refs` compares this branch's `D-N` entries against `origin/main`'s without merging. This wave defines none (see `## Deviations found`), so it must be green without anyone having reasoned about numbers.

- [ ] **Step 3: Prove the wave touched no ccd, agent or deploy file (so no re-stamp was owed), that the cited files it touched are exactly the two it paid for, and that the tax is paid**

```bash
git diff --name-only origin/main...HEAD -- ccd agent deploy
git diff --name-only origin/main...HEAD -- shared/api.ts README.md server/test/session-hook.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Then derive the CITED set this wave touched (contract §7 R9: *"the census names the set"*), from the workspace root. The corpus is the three documents `session-hook.test.ts`'s `CORPUS` lists; the pattern is its `FILE_RE` with the `:<line>` it cites by:

```bash
comm -12 \
  <(grep -ohE '([A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(ts|mts|mjs|js|sh):[0-9]+|ccd/(ccd|ccrc):[0-9]+' \
      docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
      docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md \
    | sed -E 's/:[0-9]+$//; s#.*/##' | sort -u) \
  <(git diff --name-only origin/main...HEAD | sed 's#.*/##' | sort -u)
grep -ohE '([A-Za-z0-9_.-]+/)?session-hook\.test\.ts:[0-9]+(-[0-9]+)?' \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md \
  | sed -E 's/.*://; s/.*-//' | sort -n | tail -1
git diff -U0 origin/main...HEAD -- server/test/session-hook.test.ts | grep '^@@'
```

Expected: the `comm` prints exactly `api.ts` and `session-hook.test.ts` (matched by basename; the first is `shared/api.ts`, which Task 1 Step 6 paid). Any THIRD name is a cited file this wave inserted into without paying S6-R11: stop, repair it by Task 1 Step 6's procedure, and name it in the wave-done mail. The `tail -1` prints the corpus's highest anchor into `session-hook.test.ts`, and every `@@` hunk's `+<start>` is greater than it: this wave's edits to that file sit below every line the corpus cites there.

Expected: the first command prints nothing. If anything prints, this plan's "no ccd edit" premise is false. That file needs the re-stamp (`node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"`) and a second pass of the citation-corpus procedure (S6-R11), and the departure goes in the wave-done mail. The second command prints `README.md` and `shared/api.ts`, and `server/test/session-hook.test.ts` too unless Task 1 Step 6(c) found the census already green. The third PASSES: Task 1 Step 6's repair of README's `shared/api.ts` anchors and the citation-debt census still holds at the branch tip. It is a known load flake, so re-run a red that names no `shared/api.ts` anchor in isolation first.

- [ ] **Step 4: Prove the wave end to end on fixtures**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-wire.test.ts test/child-reclaim-events-store.test.ts \
  test/child-reclaim-status.test.ts test/child-reclaim-watch-view.test.ts test/child-reclaim-runs-route.test.ts \
  test/child-reclaim-chip-source.test.ts test/reconstruction-drill.test.ts test/lifecycle-store.test.ts \
  test/auth-gate.test.ts test/single-definition.test.ts
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/session-line.test.tsx test/fleet-css.test.ts \
  test/contrast.test.ts test/tap-targets.test.tsx
```

Expected: PASS. `auth-gate`'s three route cardinals are unchanged from what wave 4 left them at (wave 4 moves two of them for `POST /api/coord/reclaim-pause`, contract §4). Re-read them with `grep -n 'toBe([0-9]' server/test/auth-gate.test.ts` and compare with `git show origin/main:server/test/auth-gate.test.ts | grep -n 'toBe([0-9]'`; never type them. This wave registers no route.

- [ ] **Step 5: Check the commit author before pushing**

```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u
git log -1 --format='%an <%ae>' origin/main
```

Expected: the branch's author is a real identity of the same family as `main`'s recent commits. If it is a worktree placeholder, **stop and report**. The pre-push hook blocks identity residue, and rewriting authorship is not this wave's call.

- [ ] **Step 6: Push and open the PR, on this workspace's own branch**

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 5: the closed run's reclaim chip" --body-file - <<'EOF'
Wave 5 of the child-reclamation programme (CCR-15; spec §5.9, §8), **server + pwa**.

The operator can now read what became of a child workspace once its run closed.

1. **`RunSummary.childReclaim`**: one of `reclaimed | pending | deferred | paused | refused`
   with a server-composed sentence, or `null`. Additive; `FLEET_PROTO` unchanged. The store
   answers `null`; `GET /api/runs` is the one composer.
2. **`childReclaimStatus`**: the ONE pure derivation, pinned table-driven over every mapping
   row and every ws-reclaim token, as the programme's 2026-09-23 rulings amend contract §5.
   It scopes the mirror to *this run's workspace generation* through wave 4's one fence,
   `childReclaimGeneration`, at the run's `closedAt` (ws-add recycles slugs), and takes the
   deciding event from wave 4's `childReclaimLatest`. A hand-over wave's workspace is not
   "pending"; the fleet-wide switch reads `paused`; a review child is kept `pending` with its
   own sentence until the run it reviewed is terminal in the list, absent included; a refusal
   with no token, or one this build cannot classify, reads `refused` with a server sentence,
   and `no-worktree-record` reads `refused`; an intent newer than any outcome falls through
   to the row rule; a sweep defer is dated from its first deferral of any kind.
3. **Cost**: at most ONE statement per board load (`INDEXED BY lifecycle_by_session`,
   measured against a per-run loop and a per-run correlated query). The registry answer is
   the watcher's in-memory listing, so there are no registry reads and no ccd calls. A failed
   mirror read costs the chip, never the board.
4. **PWA**: `childReclaimChip` is the one tolerant reader. It renders the server's word and
   sentence and **maps no token** (a server-side source pin holds that). A `reclaimed` row
   is inert. A finished child's session leaving the fleet frame re-reads the archive; there is
   no poll. `SessionLine` shows `child of run #N`.

No `ccd/`, `agent/` or `deploy/` file changes, so there is no re-stamp. The `shared/api.ts`
insertion moves README's four anchors into that file: they are re-pointed by content, and the
citation-debt census is re-measured (S6-R11, Task 1). No route added; the route census is
unchanged.

**Deploy:** release lane after merge (`ccrc rollout --to <this merge's prerelease tag>`), on
a fleet already carrying waves 1–4.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Do not merge. `main`'s ruleset needs an approval only the operator or coordinator can bypass. The PR's own CI is the arbiter for the load flakes.

- [ ] **Step 7: Deploy order: after the merge, by whoever merged it**

This wave has one lane. It changes no agent-side file, so there is no agent-first constraint. `ccrc rollout`'s default order (fleet box, then server box) is correct, and `--server-first` is not needed. It has one **precondition**: waves 1–4 must be on the fleet box, or every chip is `null`. That is harmless, but it measures nothing.

```bash
# 0. Precondition: the fleet box advertises waves 3 and 4's capabilities. On the
#    fleet box; `ccd caps` is a read-only verb, never a destructive one.
ccd caps | grep -x -e reclaim-v1 -e reclaim-pause-v1

# 1. The prerelease the merge minted (within about a minute of the merge).
git fetch origin main --tags
TAG=$(git tag --points-at origin/main | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$')
echo "$TAG"

# 2. Dry run, then the move. rollout pins the version from SHA256SUMS once,
#    updates the fleet box then the server box, stops at the first failure and
#    re-measures both.
ccrc rollout --check --to "$TAG"
ccrc rollout --to "$TAG"
```

Expected:
- Step 0 prints both tokens. If either is missing, **stop**: an earlier wave is not on the box.
- Step 1 prints one `vX.Y.Z`. If it prints nothing, the release workflow has not finished. Wait for it, never hand-tag.
- Step 2's final re-measure reports both boxes on `$TAG`. The PWA's `BuildLine` shows it too.
- An exit of 3 means a box is on the new build under a failing doctor. Its FAIL lines are that box's health: report them and do not retry blindly.

Promotion to `stable` is a separate operator act (a fast-forward of the `stable` branch), not this wave's.

- [ ] **Step 8: Report**

Send the wave-done report to the coordinator per the `ccrc-worker` skill, with the measured fingerprint (the workspace branch's tip, which is the handoff commit). Include:
- the three suites' results;
- the entry-condition outputs, especially (g), wave 4's exported `childReclaimTokenKind`, (h), wave 3's two failure tokens, (i), wave 4's `childReclaimGeneration`, (j), wave 3's `review-report-live`, (k), wave 4's `CoordStatus.reclaim`, (l), wave 4's `childReclaimLatest`, (m), `no-worktree-record` in the token table, and (n), the sweep entry's `firstPresenceDeferredAt`;
- Step 3's derived cited set (`api.ts`, `session-hook.test.ts`) and the highest corpus anchor into `session-hook.test.ts` against this wave's hunks there (contract §7 R9);
- Step 3's outputs: the empty `ccd agent deploy` diff, and the citation repair's files and green `session-hook`;
- Task 1 Step 6's re-measured census numbers, or that the census was already green;
- the PR URL;
- every departure from this plan, named in prose. A worker defines no `D-N` (clause 11). The coordinator assigns numbers from the programme block and defines them in `## Deviations found`.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's block is allocated once by the coordinator at run-open, and every wave draws from it. **A worker never calls the allocator** (worker clause 11). A departure from this plan is named in the wave-done mail. The coordinator assigns it a number from the block and defines it here, allocating and defining in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` and reports.

No block is written as a range, and this section keeps no headroom accounting. Both rules follow the precedent plans' own measured failures.

This section is empty at planning. The places a worker is most likely to have to name a departure are listed below, so the coordinator knows where to look. None of them is pre-numbered.
- wave 4's token-kind lookup shipped under another name, or not exported from `server/src/coord/childReclaim.ts` (entry condition g). The wave stops there: it never re-spells the lookup;
- wave 4's `currentChildReclaimDefers()` returning a shape other than `ReadonlyMap<string, { firstDeferredAt: number | null; … }>` (entry condition f);
- a `RunSummary` builder a later programme added (Task 1 Step 5);
- a token or sentence wave 3 shipped under a different classification than the contract's table (Task 3's derived token rows would show it);
- wave 4's `childReclaimGeneration` shipped under another name or signature (entry condition i), or answering Task 3's two composer generation cases differently from contract §7 R6's definition. The wave stops there: it never carries a fence of its own;
- wave 4's `childReclaimLatest` shipped under another name or signature, or skipping an `intent` (entry condition l; Task 3's intent composer case would show it). The wave stops there: it never carries a latest-pick of its own (contract §8 R21);
- `CHILD_RECLAIM_TOKEN_KIND` without `no-worktree-record`, or with it under a kind other than `terminal` (entry condition m; contract §8 R19);
- wave 4's sweep entry without a separate presence clock, or with `firstDeferredAt` meaning presence-only deferrals (entry condition n; contract §8 R4′), which would make the chip's `deferred` date and `S.sweepDeferred` describe a different clock;
- a sweep entry field beyond the contract's four that Task 5's route-case literal had to gain (Task 5, after Step 1);
- a cited file this wave inserted into beyond `shared/api.ts` and `server/test/session-hook.test.ts` (Task 10 Step 3's derived set; contract §7 R9).

---

## Review lenses

Three lenses, all `opus`, effort `high`. This wave destroys nothing, so the destructive-path safety lens that wave 3 mandates does not apply. Every lens runs against the branch at one measured tip.

1. **Derivation and wire.** Every row of Task 3's mapping table against spec §5.9, contract §5 and the rulings that amend it (contract §7 R6, R7, R16; contract §8 R16′, R19, R21, R4′, R23), each re-derived from the code rather than taken from this plan:
   - **R6:** the event comes from wave 4's `childReclaimGeneration`, called at the run's `closedAt` (never now, never `ingestedAt`), and the wave-5 section carries no fence of its own and reads no `create` row itself (`ccd/ccd`'s slug-recycling note; `_lc_done create` in `cmd_ws_add`). The recycled-slug route case binds.
   - **R7:** the hand-over conjunct (`closeRun`'s non-final re-hold; contract §4's `openRunsForSession`-empty eligibility); a fleet-wide switch that is SET, and only set, reads `paused`, replacing every answer that promises the sweep will act (pending and every deferred) and nothing settled, no `paused` token's own answer, no null, and not the review child's kept answer; a `refused` event with no token reads `refused` with the no-reason sentence; an unclassifiable token reads `refused` through `refusalSentence`'s fallback; an `intent`/`unknown` event falls through to the row rule. A `gone` token still says nothing.
   - **R16, R16′:** a review child whose reviewed run is not terminal in the SAME list, OPEN or ABSENT, reads `pending` with `S.reviewKept` and never the plain `S.pending`, and reads like any other child once that run is terminal in the list; the composer asks "terminal in the list", never "open in the list". The cap edge (a reviewed run closed but capped out of `?closed=1`) errs toward "kept", and the plan argues that direction; check the argument, and that the sentence is true of what wave 3's `review-report-live` decision and wave 4's eligibility do for an open AND an absent reviewed run.
   - **R21:** the deciding event is wave 4's `childReclaimLatest` over `childReclaimGeneration`'s answer, called where it stands; the wave-5 section spells no `'reclaim'` act literal and carries no latest-pick of its own; an `intent` newer than any outcome sends the chip to the row rule (the composer case binds, and Task 3's rows 22–23 show the source case and the behaviour case each catch a different drift).
   - **R19:** `no-worktree-record` reaches the chip through the derived token rows and its literal case as `refused` with the audit's existing sentence; nothing in the wave counts the tokens.
   - **R4′:** `deferredSince` is `firstDeferredAt`, never `firstPresenceDeferredAt`, pinned by a composer case and a route case that set the two clocks apart; `S.sweepDeferred` is true of EVERY deferral kind (sibling open, marker unreadable, held, state changed, presence) and promises no bound that only presence carries.
   - **R23:** every code comment, test name and CSS comment the plan prescribes cites the spec, never the contract; the plan's header carries the `**Contract:**` line.

   Every token sentence goes through `lcRefusalWord(t) ?? refusalSentence(t)`, so a `failed` reclaim's `pin-failed`/`unit-still-active` renders wave 3's words, never `ccrc declined: …`. The token-kind lookup is wave 4's one export, imported and never re-spelled or moved (R15).
   No overloaded null at any seam. `ChildReclaimRowView`'s four answers are never folded. The store's `null` equals the derivation's answer on every emitter that carries it (the live frame and advance echo are non-terminal). The field is additive, so an older server's row renders nothing.
2. **PWA surface.** The PWA maps no token: Task 8's pin binds, and its exclusion of word-coinciding tokens is argued rather than convenient. A reclaimed row is inert, and its sibling controls keep their place. The vanish re-read is a diff and never a timer, and it cannot loop, because a re-read does not change `sessions`. The run-row CSS ink is from pairs already priced, and nothing glows. `.sess-child` is answered on the slab by the achromatic group, and on the unselected row by its `INHERITED_GROUNDS` entry, measured and not in the uncovered census. It takes the ruled shape (contract §7 R7: `color: var(--ink-tertiary); flex: none`, no truncation), `.sess-substrate`'s declaration for declaration, in a rule of its own, and never takes the hold reason's room.
3. **Cost, degrade and the citation tax.** ONE statement per board load, pinned by a spy, not a comment. The `INDEXED BY` hint is pinned against the text the method runs. The route performs no registry I/O and no ccd call. A failed mirror read ships the board without chips and logs. The planning measurement's method is reproducible from the script in this plan, and it claims only the order of the three shapes, not their numbers. The fleet-wide switch is read off the watcher's last measurement, never a marker read at request time. Every cited file this wave inserted into paid S6-R11 in the same task (contract §7 R9): Task 10 Step 3's derived set is exactly `shared/api.ts` and `server/test/session-hook.test.ts`, and the latter's edits sit below every anchor the corpus holds into it.
