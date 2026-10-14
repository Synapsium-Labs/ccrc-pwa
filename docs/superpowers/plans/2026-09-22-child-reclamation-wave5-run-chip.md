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

Every number below is the coordinator's, issued singly from this programme's block (mails 3629, 3660 and 3696), and each is defined once, here. The wave-done named the first twelve by slug. Review 285's fix round named the next six, and the fix round itself found the last.

- **D-3926** (Task 9b: `no-session-copy-scoped-to-run`) — The abandon sheet's no-session sentence promised more than a run with no session can carry, because abandoning a programme's last open run can release and reclaim an earlier wave's child. It now speaks only of the run itself: "Abandon run ${run.id}? It holds no workspace of its own, so it has none to release or reclaim." The coordinator ruled the wording (mail 3613). The sheet does not name the programme-retire effect.
- **D-3927** (Task 8: `one-reader-pin-code-only`) — Task 8's prescribed one-reader pin, `/\.childReclaim\b/`, missed destructured and bracketed reads, and a doc comment could satisfy it. It is replaced by a count of code-only identifier reads (`server/test/child-reclaim-chip-source.test.ts`). The pre-PR batch then pinned the count by expression, not by line.
- **D-3928** (final PWA lens: `chip-census-tokens-widened`) — The PWA's no-token census now scans the keys of `CHILD_RECLAIM_TOKEN_KIND`, `CHILD_RECLAIM_SKIP` and `LC_REFUSAL_WORD`, minus the chip's own words, where the plan scanned a narrower set. It also bans an `lcRefusalWord` import and names HistoryTab's exclusion. Fix round 1 widened it again, to bare object keys.
- **D-3929** (beyond the plan: `verdict-reader-allowlist-pin`) — A code-only census, `server/test/child-reclaim-verdict-readers.test.ts`, with the shared comment stripper `server/test/sourceScan.ts`. It pins that no decision reads the recorded verdicts, the attention list, `feedQuiet` or the published frame's attention. Fix round 1 widened its call pin to method references.
- **D-3930** (final SAFETY lens: `fence-canonical-stamp`) — The coordination fence's two store reads used `Number()`, so a hand-written TEXT stamp such as `closedAt = '0x10'` read as 16, and the fence failed open. They now parse with `parseCanonicalPositiveSafeInteger`, and a stamp that stays TEXT or REAL reads `unplaced`, which keeps the child. The column's INTEGER affinity already stores any spelling SQLite reads as an integer (`'1e3'`, `' 5'`, `'+5'`, `'05'`, `'5.0'`) as an INTEGER on write. So beyond refusing an integer outside 1..2^53−1 (such as `'-5'`, `'0'` and `'1e18'`), the parse guards only the values that stay TEXT or REAL (`'0x10'`, `'0b1'`, `''`, `5.5`, `1e20`, ±Infinity), which read `unplaced`. This narrows the store comments' earlier "a hex, binary or exponent spelling" (review 285, F5). No writer in the tree produces either kind.
- **D-3931** (Task 0b: `prose4-stamp-sentence-corrected`) — A0b Prose 4's prescribed "Every other stamp is `ask.at.monoMs`" was false at the tip. It is corrected in `childReclaimNextEntry`'s docstring and in the two clock docstrings in `server/src/watch.ts`: `firstDeferredAt` and `lastPresenceWallAt` are wall-clock, and the gap reads the larger of the two clocks' differences. Fix round 1 corrected the wave-4 plan's copy of the same sentence (D-3943).
- **D-3932** (Task 9c: `spec-wip-parents-reworded`) — A[S4-2]'s prescribed §5.5 step 2 said the WIP commit's parents are "the ones `git commit` would give it". That list included the staged-index parent, which `git commit` never adds. The step now names the parents plainly, in the same number of lines.
- **D-3933** (Task 0b: `wall-step-rows-mint-early`) — The L5, L13 and S2 back-hole rows mint their children an hour before the first pass. A backward wall step then cannot cross the children's own `create`, which the prescribed fixtures did not prevent.
- **D-3934** (Task 0c: `open-arm-mutation-fails-shut-at-runtime`) — The plan's mutation "drop the `'open'` arm" reds K1.11 and `tsc`, not K1.2 or K4c as prescribed. The variant `'open' → false` reds those. Review 285 reproduced both.
- **D-3935** (Task 0b: `0b-mutation-table-corrected`) — A0b's mutation table is corrected to what measures. "Continues from `ask.at`" reds P7, P5, S1 and L16, not L11. P9's literal mutation leaves P9 green, and P7 reds. Review 285 reproduced both.
- **D-3936** (Task 4d: `a-s3-14-literals-beyond-the-list`) — Every full-entry `toEqual` or request literal gained `lastDeferWhy`/`feedQuiet`, beyond the lines A-S3-14 hinted at, as A-S3-14 itself anticipated. Fix round 1's sweep-entry field (D-3940) touched the same literals.
- **D-3937** (Tasks 0c, 2, 3 and 6: `prescribed-citations-dropped`) — Prescribed text carried two older deviation numbers (Tasks 2 and 6), "the plan's table", "R-5d's birth", "entry condition (h)" and "the operator's third ruling". Each was removed under the brief's D-token rule and the rule that code cites the spec.
- **D-3938** (review 285, F1: `chip-arms-gated-on-standing-child`) — A-S3-4's binding code answered three of `childReclaimStatus`'s step-4 arms before the `marked` gate: the failure line, the `paused` token and the retry token. So a closed run whose child no longer stood still showed a chip promising a retry. That covered a row that was absent, a marker naming another run, and a session handed to an open run. The three arms now answer only for a marked child, and otherwise fall through to the row rule's silence, as spec §5.9 reads ("a child that still stands"). A-S3-4's binding text was wrong here. The gate is the row rule's own `marked`, so it also fails for a registry not yet listed (the window after a restart), a row with no marker and an unreadable marker: such a child's chip says nothing until the registry lists it standing. The two `refused` answers that promise nothing (no token; a token this build cannot classify) and the settled answers are not gated. `server/test/child-reclaim-status.test.ts` carries 30 cases: five arm shapes (failed, a pre-lock refusal, past the ceiling, `paused`, retry) × three not-standing shapes × the switch off and on. They red when the gate is removed. Another 24 red when the gate widens onto the promise-nothing arms. In the same commit, the chip's past-ceiling failing word comes from the attention list's own derivation, `childReclaimFailingWord`, so an empty refusal reads as the list does (F10).
- **D-3939** (review 285, F2 and F18: `kept-verdicts-keyed-by-run`) — A kept verdict was keyed by session id alone, and a pass that judged nothing kept every kept verdict. So a slug recycled under `reclaim-paused` showed the OLD workspace's kept word on the NEW run's chip and in the attention list's kept arm for as long as the switch stood. Without the switch, it showed for up to one pass. The kept-feed memory was keyed the same way, so an id re-minted within one pass, or across a failed mirror read, got no `child reclaim kept` row. Each kept verdict now carries the run id its `.child` marker named (`ChildReclaimKeptVerdict`). Every kept word is reached only after the marker reads as a child, and the type enforces it. The chip composer (`withChildReclaim`) reads a kept verdict only for the run it composes. The attention list's kept arm (`childReclaimKeptItems`) reads it only while the current marker names that run. The feed memory is keyed by id and marker run, and its prune is unchanged. Display only: no decision reads the run id, and `child-reclaim-verdict-readers` holds unchanged. Red first: the reviewer's scratch D (recycled under the switch) and scratch E (no switch) chip and list shapes, and both F18 re-mints. Left as ruled:
  - The non-kept verdicts (held, doubt, eligible) carry no run. They never outlive a pass that judges nothing, so a recycled slug's new run can show the old one's sentence for at most one pass.
  - The published list shows what the last pass published until the next.
  - The same run re-minting the same slug with no pruning pass between is not told apart; this is D-3940's window.
- **D-3940** (review 285, F4: `generation-reset-keys-marker-run`; SAFETY) — The lane's generation reset (`childReclaimSameGeneration`) compared only the birth. In the window between a recycled slug's new `.child` marker and its `_lc_done create`, an old entry's licence-ripe episode could therefore send a licensed request to the NEW workspace. The entry now records its `.child` marker's run id (`markerRunId`), and a change of that run id is a new generation, as a change of birth is. P15 (L1) and L18 (the lane, through the real watcher, in the review's four-condition window) red without it. A0b's residual 10 is corrected. `minting-run-postdates-child` never backstopped this window: its real condition is `openedAt > oldBirth + 120 s`. What remains is one window only. No window survives across two DIFFERENT runs. One run marking the same slug twice can still pass if no pass in between lists that slug ineligible or lists no row for it. Four things must all hold:
  - On the old workspace's last eligible pass, the run is `planned`, bound to another session, and past the spawn stall. Only `clearSession` unbinds such a run, and the next fresh spawn draws the same slug.
  - The new workspace's birth is not yet placed: ingest lag after a completed `ws-add`, a `ws-add` killed between the marker and `_lc_done create`, a `create` with no clock, or ccd's clock ahead of the server's.
  - At the next pass the run has left that binding: abandoned, or bound to yet another workspace and past `planned`.
  - The old episode is ripe and not yet licensed.
  A rebuilt coordination database reaches no window, because the entries live only in memory and die with the process. ccd's marker check passes in this window, since the run is the same, and the attic pin still applies. Keying on the registry `uuid` would not close it: ccd rewrites the `uuid` on every session rotation, which would restart a live child's presence clock. The window is stated in `childReclaimSameGeneration`'s docstring.
- **D-3941** (review 285, F11 and F12: `birth-unplaced-is-doubt`) — A-S3-6 classed `child-birth-unplaced` as kept, whose sentence ends "ccrc never reclaims it on its own". But the lane re-places the birth on every judging pass, so the word ends with no person acting once a placed `create` reaches the mirror, and the sweep can then reclaim the child. It is now a doubt word, as the coordinator's R40 already listed "an unplaceable birth". It reads `deferred`, which the switch turns to `paused`, with "The lifecycle journal holds no dated creation of this workspace, so nothing proves the run its child marker names made it. The sweep leaves it alone and looks for that creation again on its next pass." It writes no `child reclaim kept` feed row and never reaches the banner. `ChildReclaimKeptWord` and its derived list drop it, so five kept words remain. Every text that said each kept word ends only by a person's act is made true: `shared/api.ts`'s docstring, `CHILD_RECLAIM_SKIP`'s class note, `childReclaimKeptVerdicts`' docstring, a composer comment, and README's clause, which now reads "each the sweep keeps for a person while its reason stands" with no line moved. F12's two base comments now say each class truthfully. Spec §5.9 lists the word among the doubt words, in its own commit, because the code cites §5.9. Red first: the pinned `doubt` class, the five-word kept list, the lane case through the real watcher that writes no kept feed row, and the chip reading `deferred`, then `paused` under the switch, never `refused`. Not changed:
  - The coordinator's contract §11 R41 still lists the word as kept.
  - A child whose birth can never be placed now reads `deferred` for good, with no banner item. Only the once-per-process server log names it. Such children, minted before the mirror existed or carrying a `create` line with no `at`, number about zero.
  - A narrower relative remains, `kept-word-ends-on-late-birth`. It is D-3944, a stated residual ruled by the coordinator (mail 3696). The coordinator's contract §13 R60 records this move and amends R41's class table.
- **D-3942** (review 285, F7 and F21: `abandon-child-sentence-lists-temp-root-and-row`) — Task 9c's prescribed child sentence (this plan's :6097 and :6132) listed only the session, worktree, branch and clips as removed. It left out the per-session temp root and the registry row that spec §4's "Reclaim" destroys. The sentence now reads "…then its session is stopped, its worktree, branch, clips and temp root are removed, and its registry row is purged." Its kept list, the `unknown` sentence and the ruled no-session sentence are unchanged, and AB4's constant moved with it. The plan's two quotations stay as the record of what 9c prescribed. F21: the child, not-child and no-session sentences had been pinned only by equality with a test constant edited together with the source. Each of the four sentences is now rendered and held to the shipped negative pins, to never-words of its own, and to distinctive phrases written as literals in the test, each confirmed present in `abandonConsequence`'s source text. The child sentence's phrases include "pinned in the attic", "temp root", "registry row" and "not ignored or secret-shaped files". Review 285's co-edit ("attic" → "archive" in both the source and the constant) now reds. In the same batch, F19's bare-key arm (three identifier-shaped tokens of the 44 scanned, not 13) and F20's bracketed-read arm red the review's mutations. Their remaining blind spots are named in the test's comments: a shorthand property, an enum member, a class field, a non-null bracket read and an indexed-access type. The plan's mutation-table row 12 (:6285) keeps the case's old title.
- **D-3943** (review 285, F3, F8, F16, F17 and F27: `prescribed-prose-corrected`) — Five prescribed or prescribed-shaped texts were wrong or unledgered. Each is corrected as text only.
  - F3: "the k-th presence-held child … within k × 28 minutes" now says "with nothing else ahead", as A0b's own bound does. It also adds the term review 285 derived: each due child ahead that is not presence-held (a new sighting, or one back from a backoff or a refusal) adds at most the stall bound plus the gap bound, about 10.5 minutes. The general bound is k × (C + 2G + STALL) + j × (STALL + G). This is corrected in `ChildReclaimSweepEntry`'s docstring, in the wave-4 plan's wave-5 bullets for A9 item 1 and lens 1, and in PR #290's body. The spec's §5.7 copy, the contract's and this plan's own A0b copies keep the unqualified wording as the record.
  - F8: the gap constant's docstring said passes were measured 51–80 s apart. The lane's 60 s monotonic throttle makes a closer pass impossible, and the review's probe measured 60–80 s. 51.5 s was the spacing of `ws-reclaim` intents. This is corrected in the docstring and in the wave-4 bullet, which keeps its other figures. The bound is unaffected, because T1 uses S = 80 s.
  - F16: `ChildReclaimRowView`'s "FIVE answers" is the right count, two view kinds plus three `ChildMark` kinds, where this plan prescribed "FOUR" (:1285). It stays FIVE.
  - F17: the wave-4 plan's appended Task 0b bullet said every decision clock is monotonic and `firstDeferredAt` alone stays wall-clock. Both halves were false. It now matches the corrected code docstrings: `lastPresenceWallAt` is wall-clock, `bornAt` is ccd's clock, and the gap reads the larger of the two clocks' differences. The lane's own clock comment in `sweepChildReclaim` and two sweep test titles were corrected to match.
  - F27: `AbandonSheet.tsx`'s header carries the true ", by `abandonChildOf`" beyond Task 9c Step 4's prescribed text, rewrapped near 78 columns.
  The wave-4 plan's wave-5 bullets were edited in place, as the coordinator ruled. They are this wave's own text, not wave 4's record.
- **D-3944** (fix round 1, Task D: `kept-word-ends-on-late-birth`) — A stated residual, ruled by the coordinator (mail 3696; contract §13 R61). The birth (`childReclaimBornAt`) is the last PLACED `create` (`lifecycleCreatesFor`). So until a recycled slug's newer `create` is placed, a judging pass judges the new marker against the OLDER generation's birth. The kept word `minting-run-postdates-child` can then end with no person acting. All of the following must hold:
  - (a) the slug is recycled: an older generation's placed `create` is in the mirror;
  - (b) at a judging pass the new marker is listed but its `create` is not placed, either not yet ingested or dated after the server's now;
  - (c) the marker's run is already past `minting-run-open`;
  - (d) nothing earlier answers;
  - (e) (b) later clears.
  In that window the chip reads `refused` with "ccrc never reclaims it on its own", one `child reclaim kept` feed row is written, and the banner lists the child. That same child turns eligible once its birth is placed, and is reclaimed correctly. In normal operation the window lasts seconds (a 5 s mirror lane against 60 s passes). An ingest stall, a gap filled later, or ccd's clock running ahead of the server's widens it. `coordinating` can end the same way only when the marker's run opened no later than the older birth plus the skew, which is negligible. The residual is display only. No code and no ruled sentence changed. The kept sentences and spec §5.9's ending stand, because they are true everywhere else. The texts this wave owns name the path (`CHILD_RECLAIM_SKIP`'s class note; README's "keeps for a person while its reason stands"). The closure goes to wave 7's pre-flight beside the recycled-slug proof: the last placed `create` counts as unplaced when a placed removal of the same id follows it.

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

---

## Pre-dispatch amendments (coordinator, 2026-10-05) — binding

This section reaches `main` in the coordinator's docs PR, which merges before run 260 is dispatched, as wave 3's and wave 4's amendments did (#179, #188). The brief still names its blob (`homeRepoRoot`, `planRepoPath`, `planSha`; A3). If your copy of this plan has no `## Pre-dispatch amendments (coordinator, 2026-10-05)` section, that copy is stale: stop and read the blob.

This plan was written on 2026-09-22 at `62d9c485`. That was before wave 4 was amended (its plan's R-1 to R-13 and A1 to A17), before wave 4 shipped (#215, `b40f4145`, v0.0.79), before contract R34 to R37, and before the ledger carried wave 4's reviews' items into this wave. On 2026-10-05 the updater moved the fleet box to v0.0.84 at 12:22 UTC and the server box at 12:34, and the sweep has been live since 12:36 (ledger, 2026-10-05 13:06). The same updater has moved the fleet on since: the fleet box's tree read v0.0.88 at 16:56 UTC.

On 2026-10-05 a pre-flight read the plan against `334fb722a` (`origin/main` `c41bf8c5` plus the coordinator's ledger commits), and read the live fleet read-only. It had two parts:
- **Three Opus lenses** (interfaces and anchors; contract and carried items; process, deploy and review) raised 50 findings: 9 blocking, 23 important and 18 minor. By lens, anchors raised 14, contract 20 and process 16.
- **Five design agents** turned the carried items into options:
  - the presence rule's bound and clocks;
  - R36's collector;
  - the sweep's silent states;
  - the gone-branch and gone-directory shapes;
  - the small items (F6, G2 and G5, the abandon copy, the ten close words).

What it found:
- **Entry conditions hold.** Every entry condition (a) to (n) prints at HEAD. Wave 4 shipped every surface the chip reads, under the names and signatures this plan expects.
- **The derivation, dry-run live.** Over the 252 terminal runs it read:
  - 113 `reclaimed`;
  - 1 `failed` (`pin-failed`);
  - 131 decided by the row rule;
  - 7 with no generation.
- **The process sections are stale** against three things:
  - the operator's ruling of 2026-09-30 that nobody moves a box by hand;
  - the release lane's automatic updater;
  - R36.
- **No "Wave 5 inherits" item was placed.** G3's ruled "wave 5 must bound it" had no task, so the chip's own sentence "a wait on someone using it is bounded" was false.
- **Two live children show the gaps:**
  - `ccrc-pwa-brisk-meadow` is skipped as `coordinating` on every pass. R37's reader is not fenced to the workspace's current generation, and this slug coordinated program-leverage runs in August.
  - `expoAI-assistant-calm-mesa` fails `pin-failed` on every attempt, because its registry branch is already gone.
- **Size.** With every item amended in, the wave was estimated at 12k to 18k insertions over 80 to 110 files. That is above waves 3 and 4.

The coordinator ruled R38 to R47 and the open-issue rulings that amend them. They are contract §11, appended to the contract in the same docs PR as this section, and this section is written to them. R38 splits the wave: this plan keeps the chip and the server-side inherits, and a new wave 6 carries R36 and the ccd-side inherits (A1). A design agent's recommendation binds only where a ruling adopts it.

**How to read this section.**
- These amendments are part of the plan.
- Where an amendment contradicts a task's text, the amendment wins, and it says so by task and step.
- Where a pre-flight report and a ruling disagree, the ruling wins.
- Plan citations inside this section (`plan:NNNN`) refer to this file as it stood before this section was appended. Every line above this section is unchanged.
- Code citations are to `334fb722a`, and so are ledger citations (`ledger:NNN`). They are snapshots, so locate code by content.
- Live readings in this section (claims, versions, child markers, caps) were taken read-only on 2026-10-05 at 16:56 UTC. The coordinator re-reads each before dispatch, and the read made then is the one that counts.
- The pre-flight's and the design agents' records are in the coordinator's gitignored evidence archive (`.superpowers/sdd/ccr15-evidence-archive/wave5-preflight/`). They are summarised here.

### A1 — The plan's scope (R38): what wave 5 carries, and what moved to wave 6

**Why.** The process lens estimated the wave with R36 and every "Wave 5 inherits" item amended in: 7.5k to 10k plan lines and 12k to 18k insertions over 80 to 110 files (pre-flight P11). That is at or above waves 3 and 4, and each of those took five to six days and three review runs. Three more facts favoured a split:
- R36's measured backlog is one empty directory (pre-flight P10).
- Its removal helper must come from workspace-lifecycle wave 3's refactor of the same `ccd/ccd` region (run 245, dispatched; pre-flight P9).
- The chip is read-only and should not wait on R36's fix rounds.

R38 splits the wave so that each SAFETY panel reads one destructive subject.

**Wave 5 (run 260, with its block in `## Deviations found`) is server and PWA only.** It contains:
- Tasks 1 to 9, the run chip, as this section amends them;
- R39 (G3, G4 and G1): NEW Task 0b, done first, BLOCKING;
- R40: R37 fenced to the workspace's current generation (NEW Task 0c, after Task 0b, BLOCKING);
- R41: the sweep's verdicts made visible on the chip and the attention list (NEW Tasks 2b, 4b, 4c and 6b);
- R42: the ten close words are not stored, and the chip reads current state;
- R43: the server reads `flock-unavailable` and `lock-unopenable` as failures, never as `refused` (Task 2b);
- R44: feed rows de-duplicated (NEW Task 4d);
- R45: the abandon confirmation's copy (NEW Task 9b);
- R46: G2's and G5's prose, the abandon route's docstring and `AbandonSheet.tsx`'s header, spec §5.5 steps 2 and 3, §1's added line, and README's reclaim-row sentence (NEW Task 9c).

**The hard boundary.** This wave changes no file under `ccd/`, `agent/` or `deploy/`. It needs no capability token and owes no re-stamp. A task that finds it needs one of those STOPS and names the departure by slug in the wave-done mail. It never builds the item, which is wave 6's. Task 10 Step 3 proves the boundary.

**Moved to wave 6, and NOT built here.** This is a pointer, not wave 6's design. Wave 6 gets its own plan, pre-flight and block.
- **R36's collector for orphaned child temp roots**, rewritten per the design's positive-witness rule. "No registry row names it" is never enough: 16 foreign directories (6.5 GB) in `~/.cc-tmp` meet R25 as written. It also needs an in-use refusal, an idle floor, and one removal helper extracted from the tail as workspace-lifecycle wave 3 leaves it.
- **The dot-lock inherit.** `.reap-<id>.lock`, `.<id>.compactions.lock` and `.prstate-<id>.lock` are not rows, and they are never unlinked. The collector's "no entry" test is `_ws_slug_free`.
- **F6.** `_ws_reclaim_contained` drops git's whole `--local-env-vars` list, and the reclaim suites gain a harness strip. Until wave 6 lands, F6 is a stated residual: this wave's SAFETY lens measures that the fleet box's units, the only ones that run ccd's reclaim, carry none of git's local environment variables (A5, R47).
- **ccd journaling** of audit-time `unmeasured`, `probe-unmeasured` and pre-lock dies. The two lock tokens are already journaled, and R43 reads them in this wave.
- **The gone-branch pin.** A proven-absent registry branch pins HEAD and every per-worktree reflog commit, deletes no branch, and the reclaim proceeds.
- **The gone-directory alternate-row recovery.**

**Pre-flight amendments superseded for this wave.** They go to wave 6's plan as inputs:
- pre-flight process P3, P4, P10, P12 and P14;
- contract F1, F9, F11, F12 and F15;
- anchors A-iface-3's AGENT-FIRST, re-stamp, File Structure and Step 7 halves (its review-lens half survives in A5);
- F14's "Step 3 proves a re-stamp WAS made";
- F2's F6, collector and gone-branch lens items.

**Wave 6's frame (R38), stated for the reader of this plan only:**
- a new run, opened before run 260 closes, with its own block allocated at its own open;
- AGENT-FIRST;
- its own pre-flight, which first measures why `~/.cc-tmp/ccrc-pwa-swift-hollow` reappeared after its tail removed it;
- dispatched only after workspace-lifecycle wave 3 (run 245) merges, under an overlap rule agreed with that programme's coordinator, naming `ccd/ccd`'s RECLAIM region and `watch.ts`'s sweep pass;
- SAFETY and SECURITY lenses mandatory.

The path-identity follow-up moves to after wave 6.

**Run 260 keeps `waveOf` 5.** Hold accounting renders each run's own `wave` and `waveOf` (wave 4's R-1). So in a six-wave programme, the fifth run's "5/5" is still accounted correctly. Nothing in this wave edits a run's `waveOf`.

**Non-goals.** The worker neither duplicates nor reaches into:
- pane-scope stragglers that outlive `tmux kill-session`, which belong to session-continuity waves 4 and 9 (ledger, 2026-10-05 13:33);
- the path-identity items: a re-pointed alias, a bind mount, the window before `git worktree remove`, and the two `//` remedy wordings;
- the live residue R38 lists outside the waves (`expoAI-assistant-calm-mesa`'s gone branch, `~/.cc-tmp`'s foreign entries). That residue is offered to the operator and never acted on by a session.

**The spec text this wave's code makes true reaches `main` before the code.** Code comments cite the spec, never the contract and never a ruling's date (contract R23), so the spec has to say what the code does. The coordinator's docs PR (below) carries:
- §5.7: the presence lease, its tenure bound, and R39's three figures (A5); R40's fence, under which "has coordinated" means the workspace's current generation; and the two paragraphs those lean on, a programme's own hold ending with its programme, and R-5d's birth fence;
- §5.9: the chip and the attention item read the sweep's last verdict as well as the mirror, with the kept arm (R41); feed rows as R44 de-duplicates them, in place of "One feed row per outcome"; and the two journal-only lock refusals, `flock-unavailable` and `lock-unopenable`, read as failures (R43).

Until this wave merges, those paragraphs describe this wave's code, not `main`'s. Code comments cite plain "spec §5.7" and "spec §5.9".

**The worker's prose is narrower.** Task 9c carries only G2's and G5's comments; the abandon-adjacent comment fixes (R45), which are the abandon route's docstring in `server/src/coord/routes.ts` and `AbandonSheet.tsx`'s header, describing the copy Task 9b builds in the same PR; R46's line under §1's table; §5.5 steps 2 and 3; and README's "The same row lists the children that need a human's eye" sentence. That sentence gains the children the sweep keeps for a person (R41), and the README citation cases re-measure it.

**The coordinator's docs PR, merged before dispatch.** As for waves 3 and 4 (#179, #188), one docs PR carries the following, and it merges to `main` before run 260 is dispatched:
- this section, appended to this plan;
- contract §11: R38 to R47 with the coordinator's later rulings, and the departures they accept, as ruling text. Its R40 says it amends R37 and R34's fifth condition;
- **the ledger:**
  - The waves table gains a wave-6 row, and wave 5's row reads "server + pwa".
  - "Wave 3 is the only wave that destroys anything" (ledger:27) is corrected.
  - The carried constraint naming three capability tokens stays true for this wave.
  - The temp-root bullet (ledger:969) points at wave 6.
  - The "`mark.mjs --check` is a hollow stamp gate" item (ledger:1127-1129) is marked resolved by wave 4.
- **the spec:**
  - §5.7 and §5.9, as above;
  - §8: its wave table gains wave 6, wave 5's row reads "server + pwa" with this section's contents, and its "only wave that destroys" sentence is corrected; the status line's "five waves" becomes six to match;
  - §1's "One qualification" paragraph and §7 item 2, corrected so that each says the automatic path keeps, for a person, the children the sweep's kept verdicts name (§5.9), a child under a terminal refusal (`branch-elsewhere` included), and, until wave 6, a child that fails past the ceiling for good (such as `pin-failed` with its branch gone);
  - the rest of wave 3's spec debt (ledger:1091-1092, "owed by the coordinator's docs PR"): R30's placement in §5.3, with the qualifier it needs in §4's "Spent" ("dated to it (§5.3)") and in §5.7's "spent by a PR dated to it (§5.3)"; and T1's counts in §6 and Appendix A. Appendix A's other values stay the measured snapshot, with a note that waves 1 to 4 moved other counts and where to measure them. R46 moves only §5.5 steps 2 and 3 and §1's added line into the worker's task.

The docs PR's spec hunks (the status line, §1's "One qualification" paragraph, §4's "Spent", §5.3, §5.7 with its "spent by a PR dated to it" qualifier, §5.9, §6, §7 item 2, §8, Appendix A) are disjoint from Task 9c's (§1's line under the rulings table, §5.5 steps 2 and 3). The "One qualification" hunk sits below the "Rule 4" paragraph and leaves the table and the blank line after it untouched. The child is minted from `main` after the docs PR merges, so its tree already carries them, and nothing is absorbed on their account.

**Tests:** none. This amendment adds no committed guard. Its boundary is checked by Task 10 Step 3's command.

**Deploy class:** this wave is server + pwa (A2). This amendment ships nothing itself.

### A2 — The header, Tech Stack, Global Constraints and File Structure: the process premises corrected

**Why.** Under R38 the plan's "no `ccd/ccd`, no agent change" premise is true again. The contradictions the pre-flight measured against R36 (A-iface-3; contract F1; process P3) leave with R36. Five things are still false:
- the hand rollout (pre-flight P1, F14);
- "nothing waits on a ruling" (F19);
- the safety-lens sentence, false because R39 and R40 change licensing (pre-flight P2, F2);
- the CI arbiter (pre-flight P7);
- the cited-file count, measured below.

**Header and entry conditions.**
- plan:15 (Tech Stack) stands: "No bash, no `ccd/ccd`, no agent change."
- A new line goes after plan:20 (Programme ledger): the Route line, whose text is in A3.
- plan:5-13 (Goal, Architecture) stand. An A-section that adds a task extends them, and where it changes a sentence there, it says which.
- plan:26's preamble is rewritten as the chip section's entry-condition amendment states (A-S3-14: waves 1 to 4 are merged; re-run the checks to prove the checkout). Every condition prints at `334fb722a` (pre-flight P16). The worker still runs (a) to (n), and every check the amendments add, on its own checkout, as a `haiku` preflight that STOPS when any check's answer differs from what that check states (A3).

**Global Constraints.**
- **plan:55**, "Nothing in this wave waits on a coordinator ruling", becomes: "The rulings R38 to R47 (contract §11, with the coordinator's later rulings that amend them) are settled before dispatch, and this plan builds them. Nothing in this wave waits on a ruling that is not in this section." A new bullet follows the R23 bullet (plan:66):
  - this wave's rulings: R39 (G3, G4, G1), R40, R41, R42, R43, R44, R45 and R46 (G2, G5, the abandon-adjacent comments, spec §5.5 steps 2 and 3, §1's added line, and README's reclaim-row sentence);
  - consumed: R35; R34 and R37 as R40 amends them;
    - R34's fifth condition, "the child has never coordinated", reads "has not coordinated in its current generation", and the hold-release job's step 5 reads the one fence (Task 0c);
  - moved to wave 6: R36 and the ccd-side inherits (A1);
  - "measure first" is satisfied: the sweep's first passes and the backlog's drain are in the ledger's 2026-10-05 13:06 and 14:31 entries.
- **plan:58 (R9, the cited set).** "No other file this wave touches is cited by line" was measured for the unamended wave. At `334fb722a` the frozen corpus also cites two more files by line:
  - `server/test/single-definition.test.ts`, up to `:1303`. Its census entry in `session-hook.test.ts` reads `'server/test/single-definition.test.ts': 8`.
  - `server/test/session-hook.test.ts`, up to `:7056`.

  An amended task that inserts into `single-definition.test.ts` at or before line 1303, or into `shared/api.ts` before README's anchors, pays S6-R11 in that same task. Task 10 Step 3 derives the set and never trusts this sentence.
- **plan:68 (deploy class)** is replaced by: "**Deploy class for THIS wave: server + pwa, through ccrc's own updater. Nobody moves a box by hand** (operator ruling, 2026-09-30).
  - The wave touches no `ccd/`, `agent/` or `deploy/` file. It needs no capability token, adds no coord.db migration (R42 rules none for the close words; a task that finds it needs one names that as a departure), and owes no re-stamp.
  - It pays the citation-corpus tax (S6-R11) for every cited file it inserts into.
  - Every merge to `main` becomes a prerelease. `.github/workflows/release-main.yml:19-21` triggers on `push: branches: [main]` with no paths filter.
  - The fleet's updater moves the fleet box first, then the server box. The order is `dispatchRank` (`shared/api.ts:8908`), and a server row waits for the fleet (`waiting-for-fleet`, `server/src/update/dispatch.ts:232`).
  - Nothing this wave changes runs on the fleet box, so the order costs nothing. The wave is live when the server box converges.
  - Task 10 Step 7 says what the coordinator measures before landing and observes after it."

  The quoted `ccrc rollout [--to vX.Y.Z] [--server-first] [--check] [--force]` sentence is struck.
- **plan:70** ("This wave does nothing until waves 1–4 are on the boxes") stands, and it now holds:
  - both boxes have been on v0.0.84 or later since 2026-10-05 12:34 UTC;
  - the live `ccd caps` lists `reclaim-v1` and `reclaim-pause-v1` (re-read at 16:56 UTC). That caps fact is the coordinator's read-only pre-dispatch measurement. It is no longer a deploy step (Task 10).
- **plan:89 (known load flakes)** gains two entries:
  - `tmp-sweep`. Its "FAILS CLOSED" case reds on the fleet box on an untouched `main` and passes in CI (carried constraint).
  - the `ccd-child-reclaim-*` suites, at 181 to 265 s each.

  Its last sentence, "CI on the quiet box is the arbiter", becomes: "Under `CCRC_SELECTION: enforce` (`.github/workflows/ci.yml:94`), a pull request's CI runs only the server tests its change selects. It arbitrates that selection and nothing else. Re-run any other red in isolation and report it. The daily full run and the stable gate catch a selection miss."
- **plan:92 (branch discipline)** gains worker clause 16:
  - absorb `origin/main` only on that clause's three triggers;
  - absorb with `git merge` only: never a rebase, a force-push or `update-branch`;
  - a red that `main` also shows is reported once as `main-red` and left alone.

  This wave edits no stamped file, so no stamp conflict can arise.
- **plan:93**: the line hints inside the plan's tasks are as of `62d9c485`, and the hints inside this section are as of `334fb722a`. Neither is an address. A3's overlaps rule replaces "Two other programmes are live against these files" and names them.
- **plan:47**: "(worker skill)" becomes "(the coordinator skill's description)". The phrase "a worker with a stale plan" is in `ccd/coordinator-skill/SKILL.md`'s description (pre-flight P13).
- **A new bullet: the SAFETY lens is mandatory for this wave** (A5). R39 changes when the sweep licenses its one `--defer-expired` attempt, which skips ccd's presence rungs. R40 changes which marked children the close, the executor, the hold-release job and the sweep may take. plan:3202's "This wave destroys nothing, so the destructive-path safety lens that wave 3 mandates does not apply" is struck.

**File Structure (plan:162-189).** The table is replaced by the one below: one row per file, naming every task that touches it. It merges the plan's rows with every A-section's Files lists: Task 0b's and Task 0c's (A0b, A0c), Tasks 1 to 9 as amended, and the new Tasks 2b, 4b, 4c, 4d, 6b, 9b and 9c. A0b, A0c and the chip section (A-S3-14) point here and keep no table of their own. Each task's own Files list says where in the file it edits; this table says which tasks meet there. Two rules bind every row:
- No row names a path under `ccd/`, `agent/` or `deploy/` (A1). A-iface-3's request to add the R36 collector, its token, its grant and its helper to this table is withdrawn by R38.
- The `server/src/coord/store.ts` row follows the amendment to Task 2 (A-S3-2). The plan's "`lifecycleFor` refactored onto a shared mapper" is wrong at HEAD, because wave 4 shipped `reviveLifecycleRow`.

| File | Created / Modified, by task | Its responsibility |
|---|---|---|
| `shared/api.ts` | Modify: Task 1 only (directly above `export interface RunSummary`, with one field appended to `RunSummary` after `health`; and directly above the docstring that begins `/** One child the fleet-level attention item reports`, with `ChildReclaimAttention` replaced by its four arms) | L0 home of `ChildReclaimWord`, `CHILD_RECLAIM_WORDS`, `isChildReclaimWord`, `ChildReclaimStatus` and `RunSummary.childReclaim`; of `ChildReclaimKeptWord`, `CHILD_RECLAIM_KEPT_WORDS`, `isChildReclaimKeptWord` and `ChildReclaimKeptMember`; and of `ChildReclaimAttention`'s four arms. Task 1 is the only task that inserts here, so S6-R11 is paid once |
| `server/src/childReclaimSweep.ts` | Modify: Tasks 0b, 0c, 1, 2b, 4b, 4c, 4d | The sweep's L1, still importing L0 alone. Task 0b: `ChildReclaimLaneNow`, `ChildReclaimAsk`, the entry's `lastPresenceWallAt`, `presenceHeldSince` and `bornAt`, `childReclaimFirstSighting(monoMs, bornAt)`, `childReclaimSameGeneration`, the bracketed `childReclaimNextEntry`, `childReclaimDeferExpired` on two clocks, and `childReclaimAskOrder`. Task 0c: `ChildReclaimCoordinatorClaim`, `childReclaimCoordinated`, and the verdict input `coordinatorClaim`. Task 1: `ChildReclaimJournalAttention`, and `kind` on the two mirror arms. Task 2b: `CHILD_RECLAIM_SKIP`, `CHILD_RECLAIM_PRE_LOCK_TOKEN` and `childReclaimFailureLine`, which the failing arm reads. Task 4b: `childReclaimKeptVerdicts`. Task 4c: the kept arm, its collapse, and `childReclaimAttentionWithKept`, which withholds a held child's failing item. Task 4d: `lastDeferWhy`, `ChildReclaimFeedQuiet` and `childReclaimFeedQuiet` |
| `server/src/coord/store.ts` | Modify: Tasks 0c, 1, 2 | Task 0c: `childReclaimCoordinatorClaims()` replaces `childReclaimCoordinatorIds()`, with the heir parser `childReclaimDisplacedHeirCandidates` beside `childReclaimDisplacedCandidates`. Task 1: `hydrateRun`'s literal answers `childReclaim: null`. Task 2: `CHILD_RECLAIM_EVENT_ACTS`, `childReclaimEventsSql` and `childReclaimEvents` after `childReclaimSessionIds()`, reviving through the shipped `reviveLifecycleRow`, so the board makes one mirror read; `lifecycleFor` is not touched |
| `server/src/coord/childReclaim.ts` | Modify: Tasks 0c, 3, 4c, 4d, 9c | Task 3: the wave-5 section at the end of the file, closed by `// ── end wave 5 chip ──`: the ONE derivation, `childReclaimStatus`, `childReclaimSessions`, `withChildReclaim` and `CHILD_RECLAIM_STATUS_SENTENCE`, calling wave 4's `childReclaimGeneration` (contract §7 R6), `childReclaimLatest` (contract §8 R21) and `childReclaimTokenKind` (R15) where they stand, and re-spelling none. Every other wave-5 edit here sits above that section's opening banner: Task 0c's `childReclaimBornAt` and `childReclaimHasCoordinated`, read by the executor's step 2a and the hold-release job's step 5; Task 4c's `CHILD_RECLAIM_KEPT_FEED_TITLE` and `recordChildReclaimKeptFeed`; Task 4d's failure `token` (a pre-lock die's included), `ChildReclaimRequest`'s `feedQuiet` with its docstring paragraph above `deferredSinceMs:`, `CHILD_RECLAIM_FEED_QUIET_NONE` and `childReclaimFeedSkips`; and Task 9c's G5 comment |
| `server/src/watch.ts` | Modify: Tasks 0b, 0c, 4, 4b, 4c, 4d, 9c | Task 0b: the sweep lane's two clocks, its `null` throttle sentinel, the ask order, one write-back for the answer and the rejection, and the generation reset at a first sighting. Task 0c: the pass's claims read, and its birth through `childReclaimBornAt`. Task 4: `currentChildMarks()`, in memory, no new I/O. Task 4b: `currentChildReclaimVerdicts()`, its two reductions and its one log arm. Task 4c: the attention list's one publish and the kept feed row. Task 4d: the request's `feedQuiet`. Task 9c: G2's comment. The defers stay wave 4's `currentChildReclaimDefers()` |
| `server/src/server.ts` | Modify: Task 0b | `Deps.monotonicMs`, one optional field beside `childReclaimExec` |
| `server/src/coord/close.ts` | Modify: Tasks 0c, 4d | Task 0c: close's `has-coordinated` decided through `childReclaimHasCoordinated`, and its warn line. Task 4d: the request literal's `feedQuiet` |
| `server/src/coord/routes.ts` | Modify: Tasks 5, 9c | Task 5: `GET /api/runs`'s tail and one closure beside it compose `childReclaim` onto the rows the route already read, with the watcher's marks, defers, verdicts and fleet-wide switch and the composer's clock, and degrade on a failed mirror read. Task 9c: the abandon route's docstring |
| `pwa/src/fleet/runWords.ts` | Modify: Tasks 6, 7, 9, 9b | The wave-5 section: Task 6's `CHILD_RECLAIM_CHIP_GLYPH`, `childReclaimChip` (THE ONE READER), `childReclaimTitle` and `childReclaimGone`; Task 7's `childReclaimRefreshDue`; Task 9's `childOfRunLabel`. Task 9b: `ChildMarkRead` and `childMarkOf`, the one PWA reader of `FleetSession.child`, with `childOfRunLabel` re-expressed through it |
| `pwa/src/screens/RunsScreen.tsx` | Modify: Tasks 6, 7, 9b | Task 6: renders the chip and makes a reclaimed row inert. Task 7: re-reads the archive when a finished child's session vanishes. Task 9b: hands the abandon sheet the workspace's child mark, through `abandonChildOf`, one derived value and one prop |
| `pwa/src/fleet/SessionLine.tsx` | Modify: Task 9 | The `child of run #N` label |
| `pwa/src/fleet/childReclaimWords.ts` | Modify: Tasks 1, 6b | Task 1: `RenderedAttention` picks from the arms that carry a `sessionId`. Task 6b: `RenderedKeptMany`, `isKeptMany`, and `childReclaimAttentionOf` answering `RenderedAttentionItem[]` in the server's order |
| `pwa/src/fleet/ChildReclaimBanner.tsx` | Modify: Task 6b | A collapsed kept line renders the server's sentence and the children behind it |
| `pwa/src/fleet/AbandonSheet.tsx` | Modify: Tasks 9b, 9c | Task 9b: the confirmation's four branches (no session, child, not a child, unknown) through `childMarkOf`: `AbandonChild`, `abandonChildOf`, `abandonConsequence` and the private `workspaceOf`, with the non-child sentence byte-identical. Task 9c: its header |
| `pwa/src/fleet/fleet.css` | Modify: Tasks 6, 9 | Task 6: three `.run-row .run-child-reclaim*` rules after `.run-row .run-resumed`. Task 9: `.sess-child`, in `.sess-substrate`'s shape (contract §7 R7), after the `.sess-substrate` rule, and one line in `.sess-line--active`'s achromatic group. The chip's, sentence line's and label's ink: the run-row rules are grounded by the named-ancestor route, and `.sess-child` by its `INHERITED_GROUNDS` entry |
| `pwa/design/audit.mjs` | Modify: Task 9 (one `INHERITED_GROUNDS` entry, `'fleet.css .sess-child'`, above `'fleet.css .sess-spawn'`) | Grounds the label on the project card, so the contrast gate measures it instead of counting it uncovered |
| `README.md` | Modify: Tasks 1, 0c, 9c, and Task 10 Step 3 if the census moves | Task 1: the four `shared/api.ts` anchors in the purge-refusal sentence, re-anchored by content, so its operator pointers still name the lines their sentence quotes. Task 0c: one line changed in place ("…no hold and no coordination since its workspace was created,"). Task 9c: the "The same row lists…" sentence names the children the sweep keeps, three lines for three |
| `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | Modify: Task 9c | §1's one line under the rulings table, and §5.5 steps 2 and 3 rewritten to what shipped. Every other spec hunk is the coordinator's docs PR (A1) |
| `docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md` | Modify, append-only: Tasks 0b, 9c | Task 0b: the `## Post-merge corrections (wave 5, 2026-10-05)` block, after the file's last line. Task 9c: its A10/G2 bullet under that heading. No wave-4 line is edited |
| `server/test/reconstruction-drill.test.ts` | Modify: Task 1 (`RUN_SUMMARY_KEYS` + its cardinal, 24 → 25) | The compile-time census of `RunSummary` moves with the field |
| `server/test/session-hook.test.ts` | Modify: Task 1, and Task 10 Step 3 if the census moves (the citation-debt census's `shared/api.ts` entry and its sum, re-measured, with the argued comment) | The citation debt Task 1's `shared/api.ts` insert creates is measured, not hidden |
| `pwa/test/{fleet-screen,pr-sheet,project-card,resume-sheet,tap-targets}.test.tsx`, `pwa/test/nestFleet.test.ts`, `pwa/test/runs-health.test.tsx` | Modify: Task 1 (one key in each `RunSummary` builder) | `pwa`'s `tsc` covers `test/`, and a builder missing a required field is TS2741 |
| `pwa/test/runs-screen.test.tsx` | Modify: Tasks 1, 6, 7 | Task 1: one key in its `RunSummary` builder. Tasks 6 and 7 (append describes): the chip reader, the row, the inert row, the vanish re-read |
| `pwa/test/abandon-sheet.test.tsx` | Modify: Tasks 1, 9b | Task 1: one key in its `RunSummary` builder. Task 9b: the four branches, and the shipped pins it changes |
| `server/test/child-reclaim-wire.test.ts` | Create: Task 1 | The word vocabulary; the store ships `childReclaim: null`; the six kept words, derived from one table |
| `server/test/child-reclaim-events-store.test.ts` | Create: Task 2 | Every id answered; only the two acts; one statement; the pinned plan |
| `server/test/child-reclaim-status.test.ts` | Create: Task 3 | The table-driven pin over **every mapping row** (as contract §7 R7 and R16 amend it, contract §8 R16′, R19, R21 and R4′ amend again, and A-S3-4 amends for the verdict, the failure line and the permanent failure), the composer's calls to wave 4's generation fence and latest-event rule, and the composer |
| `server/test/child-reclaim-watch-view.test.ts` | Create: Task 4 | `currentChildMarks()` against real ticks over a fixture registry |
| `server/test/child-reclaim-runs-route.test.ts` | Create: Task 5 | `GET /api/runs` end to end: reclaimed, refused, recycled slug, pending, deferred, the fleet-wide switch's paused, a review child kept, null, the active-only read, the degrade; and A-S3-9's not-judged, kept, sweep-failing, pre-lock, past-ceiling and held cases |
| `server/test/child-reclaim-chip-source.test.ts` | Create: Task 8. Modify: Task 9b (AB6, AB7) | The PWA spells no ws-reclaim token and imports no server sentence, over the six files in `FILES`, each addressed by path; `RunSummary.childReclaim` and `FleetSession.child` each have one PWA reader |
| `server/test/child-reclaim-sweep-policy.test.ts` | Modify: Tasks 0b, 0c, 1, 2b, 4b, 4c, 4d | Task 0b: P0 to P14 and the seeded harness S1. Task 0c: K1 and K2. Task 1: `kind` on the attention literals. Tasks 2b, 4b, 4c and 4d: their policy cases |
| `server/test/child-reclaim-sweep.test.ts` | Modify: Tasks 0b, 0c, 1, 2b, 4b, 4c, 4d | Task 0b: the fixture's three clocks, L1 to L17, S2, and the four shipped cases it rewrites. Task 0c: K4 and the moved references. Task 1: `kind` on the attention items, and the union's property reads. Tasks 2b, 4b, 4c and 4d: their lane cases |
| `server/test/child-reclaim.test.ts` | Modify: Tasks 0c, 2b, 4d | Task 0c: K7 and the moved references. Task 2b: its case in "the fourteen words". Task 4d: the executor's feed cases, and `feedQuiet` in its `req` builder |
| `server/test/child-reclaim-close.test.ts` | Modify: Tasks 0c, 4d | Task 0c: K5 and the moved references. Task 4d: `feedQuiet` in its request expectations |
| `server/test/child-reclaim-paused-at-server.test.ts` | Modify: Tasks 0c, 4d | Task 0c: K6 and the moved references. Task 4d: `feedQuiet` in its request literals |
| `server/test/coord-store.test.ts` | Modify: Task 0c | K3, the claims read, and the moved references |
| `server/test/child-reclaim-generation.test.ts` | Modify: Task 0c | K8: one fence, one store read, one birth placement |
| `pwa/test/session-line.test.tsx` | Modify: Tasks 9, 9b | Task 9 (append a describe): the label's three answers and its tolerance. Task 9b: the label's title assertion, and CM1 |
| `pwa/test/fleet-css.test.ts` | Modify: Tasks 6, 9 (the living-panes list; the achromatic list; one new `it`) | The new rules exist, never glow, and take priced ink |
| `pwa/test/contrast.test.ts` | Modify: Task 9 (append one describe) | `.sess-child` is registered, measured in both themes, and absent from the uncovered census |
| `pwa/test/child-reclaim-banner.test.tsx` | Modify: Tasks 1, 6b | Task 1: the `item` builder's `kind`, and an item with no `kind` still renders. Task 6b: cases (i) to (iv), the collapsed kept line |

**Tests:** none. This amendment adds no committed guard. Task 10's commands check it.

**Deploy class:** server + pwa. This amendment states the class and ships nothing itself.

### A3 — The route, every task's routing floor, delivery and overlaps (R47)

**Why.** Three process gaps:
- **Routing (pre-flight P6).** The plan names no wave route. Five implementation tasks (1, 4, 7, 8 and 9) sit at `sonnet`/`medium`, below the matrix floor: "Implementation work never runs below Sonnet · high" (`ccd/coordinator-skill/references/routing-matrix.md:45`).
- **Delivery (pre-flight P8).** A fresh child is minted from `main`. Unless these amendments are on `main` first, its copy of this plan is the unamended one, and a brief that names only the path would have the worker build from it.
- **Overlaps (pre-flight P9).** Three running waves of other programmes hold claims on files this wave edits, and workspace-lifecycle's planned wave 3b adds a lane to `watch.ts`'s sweep pass (measured below).

**The route: a new header line after plan:20.**

"**Route (named in the brief, coordinator clause 13):** `{class:'opus', effort:'xhigh', subagent:'sonnet', workflow:'on', compact:'40'}`. This is the bulk row (`ccd/coordinator-skill/references/routing-matrix.md:38`), because the amended wave exceeds one context, run in its workflow mode at `xhigh`, not ultracode (R47). The held-out review panel is exempt from every routing field (clause 14)."

Before dispatch, the coordinator records in the ledger the change from wave 4's route (Opus·high, subagent Sonnet, workflows off; ledger:516), and why: the amended wave's size, and wave 4's integration stalls within one context.

**Per-task routing floor.** Every task names its class and effort, and none sits below this table. Where an A-section states a higher routing for its own task, that routing governs.

| Task | Floor | Replaces |
|---|---|---|
| The entry-condition preflight: (a) to (n), plus every check the amendments add | `haiku` (no effort level) | — |
| NEW Task 0b (R39: the bound, the lease's tenure, the clocks, the arrival stamp, the generation reset) | `opus`, `xhigh` | — |
| NEW Task 0c (R40: R37 fenced to the generation) | `opus`, `xhigh` (A0c; R47's floor is `opus`, `high`) | — |
| NEW Task 4b (R41's verdict accessor, `currentChildReclaimVerdicts()`, and its recording in the lane) | `opus`, `high` | — |
| Tasks 1, 4, 7, 8 and 9 | `sonnet`, `high` | `sonnet`, `medium` (plan:195, :1566, :2451, :2623, :2741) |
| Tasks 2, 3, 5, 6 and 10 | `sonnet`, `high` | unchanged |
| NEW Tasks 2b, 4c, 4d, 6b, 9b and 9c (R41's skip table, attention and banner rows; R43; R44; R45; R46) | `sonnet`, `high` | — |

Task 7 is amended by no other A-section, so this table is the only text that raises it.

Rules for the worker's own subagents:
- The worker names the class on every Agent or Workflow call, and the effort on every Workflow `agent()` call (worker clause 14).
- No subagent inherits the main loop's model.
- A per-task reviewer, where the worker runs one, is `opus`, `high`.

**Delivery (R47).** This section, contract §11, the ledger and the coordinator's spec edits reach `main` in the coordinator's docs PR, merged before dispatch (A1; #179 and #188 are the precedent). The child is minted from `main` after that merge, so the worker's checkout carries this section. Both the worker brief and the review brief still carry three values, even though this wave runs in the plan's own repository:
- `homeRepoRoot`: the absolute path of this repository's root on the fleet box. The brief names it; this public plan does not.
- `planRepoPath`: `docs/superpowers/plans/2026-09-22-child-reclamation-wave5-run-chip.md`.
- `planSha`: the full 40-hex sha of the docs PR's squash-merge commit on `main`, which carries this section.

Each brief says, beside `planSha`: "If your copy of the plan has no `## Pre-dispatch amendments (coordinator, 2026-10-05)` section, stop and read the blob." This section's first line repeats that only as a backstop.

The worker reads `git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`, under the worker skill's "The plan the brief names may live in another repository". That blob is the plan text this wave is held to. A checkout's copy is not authoritative for this wave, even where it matches.

The coordinator's duties:
- Merge the docs PR before dispatch, and take `planSha` from its squash-merge commit on `main`.
- Before dispatch, prove the blob resolves and carries this section: `git -C "$homeRepoRoot" cat-file -e "$planSha:$planRepoPath"`, then `git -C "$homeRepoRoot" show "$planSha:$planRepoPath" | grep -c '^## Pre-dispatch amendments (coordinator, 2026-10-05)'`, which prints 1.
- Like any merge to `main`, the docs PR's merge mints a prerelease, and the fleet's updater installs it (A2's deploy class). It changes no code.

The entry conditions still run against the worker's own checkout, because they measure code, not the plan.

**Overlaps (R47; the claims read that coordinator clause 10 names).** Before dispatch, the coordinator reads `GET /api/claims?project=ccrc-pwa`. Measured read-only on 2026-10-05 at 16:56 UTC:
- Run 245 (workspace-lifecycle wave 3, `dispatched`) holds 43 paths over three claims. Among them are `shared/api.ts` (which Task 1 edits) and `server/test/single-definition.test.ts`, as well as `CLAUDE.md` and `server/src/wsaudit.ts`.
- Run 248 (session-continuity wave 3, `awaiting-review`) holds `README.md`, which Task 1 Step 6, Task 0c (one line, in place) and Task 9c edit.
- Run 271 (delegation-broker wave 1, `dispatched`) holds `server/test/session-hook.test.ts`, whose citation census Task 1 Step 6 edits.
- Runs 250 (landing-order wave 3) and 270 (centralised-update wave 11) hold none of this wave's files.

Claims lapse and renew, so the read made just before dispatch is the one that counts. The rule follows wave 4's R-13:
- **Shared paths.** Proceed on paths another programme holds, and keep edits narrow and additive. The worker's own `POST /api/claims` (worker clause 11) may answer 409. The worker then mails the holder and works what is uncontested. The coordinator may rule it to proceed, and tells the holder's coordinator when it does.
- **The sweep pass.** `server/src/watch.ts`'s sweep pass is shared with workspace-lifecycle wave 3b's planned lane. That pass is `sweepChildReclaim`'s per-child loop and the lane's clock, which R39 and R41 change. The coordinator tells that programme's coordinator before dispatch.
- **The second lander.** Whichever PR lands second absorbs `main` when one of worker clause 16's triggers fires, with `git merge` only: never a rebase, a force-push or `update-branch`. After an absorption it:
  - re-runs `child-reclaim-sweep`, `child-reclaim-sweep-policy` and every suite the merge touched;
  - re-pays S6-R11 when the merge moved `shared/api.ts`, `README.md`, `server/test/session-hook.test.ts` or `server/test/single-definition.test.ts`.
- **Session-continuity wave 9.** Its scope stop in every verb, reclaim included, is that programme's work (A1's non-goals).

**Tests:** none. This amendment adds no committed guard.

**Deploy class:** process only. Nothing here ships.

### A0b — NEW Task 0b: the presence lease, the lane's two clocks, the bracketed answer (R39). BLOCKING: done first, before Task 1

**Why.** Review 258's G3, carried by the ledger as "wave 5 must bound it" (2026-10-04), the pre-flight's F3 (blocking), F10 and A-iface-5, and the attack of 2026-10-05.

At HEAD the lane asks at most one child a pass (`const freeSlots = Math.max(0, CHILD_RECLAIM_MAX_IN_FLIGHT - activeInFlight);`, `server/src/watch.ts:3385`), in the fairness order (`due.sort((a, b) => {`, `:3386-3401`: never-asked first, then `lastAskedAt`). A presence answer more than 2.5 pass intervals after the previous one restarts the episode (`const continues = presence && !licensed && entry.firstPresenceDeferredAt !== null`, `server/src/childReclaimSweep.ts:449-450`). So while three or more due children keep deferring, every presence-held child restarts at every answer and is never licensed. `server/test/child-reclaim-sweep.test.ts:1605-1619` pins that as intended. That is spec §5.7's "Unbounded would be worse than absent".

The lane's one clock is `const now = Date.now();` (`watch.ts:3078`).
- A backward wall step freezes the throttle (`:3079`) and then hides the unobserved hole from the gap check (review 258's R258-C).
- A forward step runs a pass early, so the twice-observed rule's "an interval apart" can be about 2 s of real time. It also frees the one slot while a reclaim is still in flight (`:3376`, `:3420`). Review 258 did not list either effect.
- Every answer is dated at its request (`const nextEntry = childReclaimNextEntry(entry, outcome, now, req.deferExpired, CHILD_RECLAIM_SWEEP_MS);`, `:3438`). So observations can be about 300 s apart while the requests stay within the bound (G1's residual, review 258's X2).

Two more holes are in the same lane.
- **A rejected request writes nothing.** That is the `(err: unknown) => { console.warn(… 'left for the next pass') }` arm (`:3442-3444`). After a licensed request rejects, the episode is untouched and still fresh, so the next pass licenses the same child again. And a child whose every attempt rejects never moves its `lastAskedAt`, so it heads the fairness order on every pass.
- **The entry is keyed by session id alone** (`this.childReclaimSweepState.get(r.id)`, `:3350`). It is dropped only on an ineligible verdict, an outcome, a pass-level clear, or a pass on which the row is unlisted (`:3449-3451`). So a slug that is removed and minted again between two passes inherits the previous workspace's sighting and presence episode.

Measured on 2026-10-05 (design presence-bound; the feed re-read that day: of the 500 newest events, 95 are `child reclaimed`, 12 `child reclaim failed`, none `child reclaim deferred`):
- Sweep passes land 51.5–79.6 s apart (median 68.2 s over the 90 consecutive gaps under 100 s among 94 sweep `ws-reclaim` intents). So the 15:52 ruling's 60–62 s premise is false, and 11% of one-skipped-pass gaps already exceed 150 s.
- `ws-reclaim` answers in 6.4 s median, 40.4 s worst. A plain audit answers in 1.3–6.1 s.

Over that spacing the scratch simulation licensed none of 4,000 presence-held children at N = 2–6 under the shipped rule, and all of them with the lease taken every pass. The request-stamped rule licensed 72 times on true observation chains shorter than 900 s with no disturbance at all. R39 adopts G3-A, G4-B and G1-C together, with the attack's tenure bound.

**Routing:** `opus`, effort `xhigh` (R39). It is a SAFETY-lens item (R47), because it changes when `--defer-expired` is licensed on the one automatic destructive path.

**Deploy class:** server-only. It touches `server/src` and `server/test` alone. There is no wire field, no schema, no `ccd/`, no agent and no re-stamp. All new state is in memory, so a server rollback restores the shipped rule. It rides the wave's server + PWA class (R47).

**Overlap:** `watch.ts`'s sweep pass is shared with workspace-lifecycle wave 3b's planned lane (R47). The second lander merges `main` and never rebases.

**Entry conditions added.** Each prints exactly one line. If any does not, STOP and report.
```bash
grep -n "^const CHILD_RECLAIM_PRESENCE_GAP_PASSES = 2.5;" server/src/childReclaimSweep.ts      # (0b-i) the ruled bound this task keeps
grep -n "if (this.lastChildReclaimSweep !== 0 && now - this.lastChildReclaimSweep < CHILD_RECLAIM_SWEEP_MS) return;" server/src/watch.ts   # (0b-ii) the wall-clock throttle it replaces
grep -n "^    due.sort((a, b) => {" server/src/watch.ts                                            # (0b-iii) the L4 fairness sort it moves into L1
grep -n "const nextEntry = childReclaimNextEntry(entry, outcome, now, req.deferExpired, CHILD_RECLAIM_SWEEP_MS);" server/src/watch.ts   # (0b-iv) the request-stamped answer
grep -nF 'sweepChildReclaim: the reclaim of ${r.id} threw' server/src/watch.ts                   # (0b-v) the rejection arm that writes nothing
grep -nF 'this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(now));' server/src/watch.ts   # (0b-vi) the first sighting, keyed by id alone
```

#### The rule (binding)

This wins where it contradicts wave 4's A9 (its "Continuity" item and "Why 2.5"), the clock of the 15:13 and 15:52 rulings, or the episode start ruled in the 2026-10-04 G1 ruling (R39). Two items go beyond R39's letter and are ruled in with it, as contract §11 text rather than departures: item 6 writes EVERY rejected request as a failed attempt, a holder's or not (`reject-written-as-failed`), and item 7 makes one entry describe one workspace generation (`entry-generation-reset`).

1. **Two clocks, read once per pass and once per answer.** L1 gains:
   ```ts
   /** One reading of the sweep lane's two clocks. */
   export interface ChildReclaimLaneNow {
     /** The process's monotonic clock, ms. It never steps, it stops while the box is suspended, and it means nothing outside this process. */
     readonly monoMs: number;
     /** Wall-clock epoch ms. */
     readonly wallMs: number;
   }
   ```
   - **Where it is read.** The lane reads it once per pass (`asked`). It reads it once per settled request, as the FIRST statement of the `.then` success callback AND of the rejection callback (`answered`).
   - **Sources.** `monoMs` is `this.deps.monotonicMs?.() ?? performance.now()`, with `performance` imported from `node:perf_hooks` as `server/src/pools.ts:2` does. `wallMs` is `Date.now()`.
   - **Monotonic: every decision clock.** That is the throttle, the in-flight stall clock, and the entry's `firstEligibleAt`, `lastAskedAt`, `lastFailedAt`, `refusedAt`, `firstPresenceDeferredAt`, `lastPresenceDeferredAt` and `presenceHeldSince`.
   - **Wall: three uses only.**
     - Comparisons with another process's stamps: the generation picks (`watch.ts:3116`, `:3268`), the attention list's `nowMs` (`:3138`), and the verdict's `nowMs` (`:3281`, the spawn-stall window against `dispatchStartedAt`).
     - `firstDeferredAt`, which is display only: `deferredSinceMs` (`:3417`) and this wave's chip `at` (contract §8 R4′; R39).
     - `lastPresenceWallAt`.
   - **ccd's clock: `bornAt` only** (item 7). It is compared for equality and never subtracted.
2. **One gap reading.** It is private, and it replaces `childReclaimPresenceRecent` (`childReclaimSweep.ts:402-404`):
   ```ts
   const childReclaimPresenceWithin = (entry: ChildReclaimSweepEntry, now: ChildReclaimLaneNow, passIntervalMs: number): boolean =>
     entry.lastPresenceDeferredAt !== null && entry.lastPresenceWallAt !== null
     && Math.max(now.monoMs - entry.lastPresenceDeferredAt, now.wallMs - entry.lastPresenceWallAt)
        <= CHILD_RECLAIM_PRESENCE_GAP_PASSES * passIntervalMs;
   ```
   `CHILD_RECLAIM_PRESENCE_GAP_PASSES` stays `2.5` (R39). The two null checks are what let `tsc` accept the subtraction.
3. **The ask, and the bracketed answer.** L1 gains:
   ```ts
   /** What the lane knew when it sent one request. */
   export interface ChildReclaimAsk {
     /** The lane's two clocks at the pass that sent it. */
     readonly at: ChildReclaimLaneNow;
     /** The request's own `deferExpired`. */
     readonly licensed: boolean;
     /** It was sent to the presence lease's holder (`childReclaimAskOrder`'s `holderId`). */
     readonly asHolder: boolean;
   }
   ```
   The signature is `childReclaimNextEntry(entry, outcome, ask, answered, passIntervalMs)`. One object carries both booleans, so a swapped pair cannot type-check.
   - **`reclaimed`, `gone`:** answer `null`, unchanged.
   - **`failed`:** as today. `lastFailedAt` and `lastAskedAt` are `ask.at.monoMs`, and all four presence fields are `null`. A rejection is written through this arm (item 6).
   - **`refused`:** as today. `refusedAt` and `lastAskedAt` are `ask.at.monoMs`, and all four presence fields are `null`.
   - **`deferred`:**
     ```ts
     const presence = (CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).includes(outcome.why);
     // the NEW answer's ARRIVAL against the previous answer's REQUEST
     const continues = presence && !ask.licensed && entry.firstPresenceDeferredAt !== null
       && childReclaimPresenceWithin(entry, answered, passIntervalMs);
     // the lease: an unlicensed presence answer keeps the child in line or puts it at the back,
     // EXCEPT that a holder whose answer does not continue its episode forfeits
     const inLine = presence && !ask.licensed && (continues || !ask.asHolder);
     return {
       ...entry,
       firstDeferredAt: entry.firstDeferredAt ?? ask.at.wallMs,                                                // WALL: display only
       firstPresenceDeferredAt: presence ? (continues ? entry.firstPresenceDeferredAt : answered.monoMs) : null, // the episode starts at an ARRIVAL
       lastPresenceDeferredAt: presence ? ask.at.monoMs : null,                                                // freshness reads the REQUEST
       lastPresenceWallAt: presence ? ask.at.wallMs : null,
       presenceHeldSince: inLine ? (entry.presenceHeldSince ?? answered.monoMs) : null,
       refusedAt: null, consecutiveFailures: 0, lastFailedAt: null, lastAskedAt: ask.at.monoMs,
     };
     ```
4. **The licence.** It keeps its shape. `presenceHeldSince` is never read here.
   ```ts
   export const childReclaimDeferExpired = (entry: ChildReclaimSweepEntry, now: ChildReclaimLaneNow, passIntervalMs: number): boolean =>
     entry.firstPresenceDeferredAt !== null
     && now.monoMs - entry.firstPresenceDeferredAt >= CHILD_RECLAIM_DEFER_CEILING_MS   // the span: the MONOTONIC clock alone
     && childReclaimPresenceWithin(entry, now, passIntervalMs);                         // freshness: the larger of the two clocks
   ```
5. **The lease, and its tenure bound (R39).**
   ```ts
   export function childReclaimAskOrder<T extends { readonly id: string; readonly entry: ChildReclaimSweepEntry }>(
     due: readonly T[],
   ): { readonly order: T[]; readonly holderId: string | null }
   ```
   - **The holder** is the due item with `entry.presenceHeldSince !== null` that is least by (`presenceHeldSince`, `firstEligibleAt`, `id`).
   - **`order`** is `[holder, ...rest]`. `rest` is every other due item in the shipped fairness order: `lastAskedAt` with never-asked first then ascending, then `firstEligibleAt`, then id. It is moved verbatim with its comment from `watch.ts:3386-3401`, reading `x.entry` and `x.id`. With no holder, `order` is the fairness order alone and `holderId` is `null`.
   - **`order` is a permutation of `due`:** the same items and the same length.
   - **Dispatch.** The lane runs `const { order, holderId } = childReclaimAskOrder(due);` and dispatches `order.slice(0, freeSlots)`, each with `asHolder: id === holderId`. `freeSlots` is unchanged (`:3385`).
   - **Tenure.** A holder forfeits the lease (`presenceHeldSince` → `null`) on an unlicensed presence answer that does not continue its episode (item 3's `inLine`), and on a rejection (item 6). It re-joins at the back on its next unlicensed presence answer, which comes only when the fairness order reaches it. A waiting member, asked as a non-holder, keeps its place.
6. **A rejection is a failed attempt.** The rejection callback reads `answered` first, logs, then writes `childReclaimNextEntry(entry, { kind: 'failed' }, ask, answered, CHILD_RECLAIM_SWEEP_MS)`, and only while the entry is still the live one.
   - Both callbacks write through one private method: `childReclaimWriteBack(id: string, entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, ask: ChildReclaimAsk, answered: ChildReclaimLaneNow): void`.
   - That method carries the shipped identity guard (`if (this.childReclaimSweepState.get(id) !== entry) return;`), then deletes the entry on `null` or sets it otherwise.
   - So a rejection ends the episode, forfeits a holder's lease and backs off. It writes no feed row (the executor wrote none) and journals nothing.
   - A stalled request needs no write. From the pass at which its slot frees, the in-flight child is not in `due`, so the order passes over it. When it settles, its answer arrives at least `CHILD_RECLAIM_STALL_MS` (480 s), which is more than G, after its request. So an unlicensed presence answer cannot continue the episode, and a holder forfeits then; any other outcome ends the episode. R39's "a stalled request sent as holder forfeits" is met this way (`stall-forfeit-by-late-answer`, ruling text in contract §11). A write at stall time would replace the entry, and the identity guard would then drop the late answer.
7. **One entry describes one workspace generation.** `ChildReclaimSweepEntry` gains `bornAt: number | null`, which is the birth R-5d places (`childBornAt`, `watch.ts:3268`). It is set by `childReclaimFirstSighting(monoMs: number, bornAt: number | null)`. That is the final signature: two arguments, both required, and no third. L1 gains:
   ```ts
   /** Does this entry describe the workspace generation born at `bornAt` (spec §5.6: slugs recycle)? A null birth never matches. */
   export const childReclaimSameGeneration = (entry: ChildReclaimSweepEntry, bornAt: number | null): boolean =>
     entry.bornAt !== null && entry.bornAt === bornAt;
   ```
   The lane's first-sighting branch (`:3350-3354`) becomes:
   ```ts
   const entry = this.childReclaimSweepState.get(r.id);
   if (entry === undefined || !childReclaimSameGeneration(entry, childBornAt)) {
     this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(mono, childBornAt));
     continue;
   }
   ```
   An eligible verdict always has a non-null `childBornAt`, because `child-birth-unplaced` returns first. A null would re-seed on every pass and never ask, which fails closed. A replaced entry makes the identity guard drop any answer still in flight for the old one.
8. **The throttle's never-run sentinel is `null`:** `private lastChildReclaimSweep: number | null = null` (`:754`). A monotonic source that starts at 0 makes `0` a real stamp, so the `!== 0` idiom the other lanes use cannot serve this one.

#### What the reviewers prove (the SAFETY lens re-derives each; R47)

Notation:
- C = `CHILD_RECLAIM_DEFER_CEILING_MS` = 900 000; G = 2.5 × `CHILD_RECLAIM_SWEEP_MS` = 150 000; STALL = `CHILD_RECLAIM_STALL_MS` = 480 000.
- S is the largest monotonic spacing between consecutive passes. L_p and L_r are the largest latencies of a presence answer and of a licensed reclaim.
- For one request: q is the request instant, a the answer's arrival, and o the instant the box observed presence, with q ≤ o ≤ a.
- P is the set of entries with `presenceHeldSince !== null`.

**(a) Never earlier, and never more often, than the ceiling allows a lone child.**
- **No ask is added.** `childReclaimAskOrder` returns a permutation of `due` (P0). The lane still takes `freeSlots` items from it, at most `CHILD_RECLAIM_MAX_IN_FLIGHT` minus the active count, and every item in `due` passed the same verdict and `childReclaimDue` as before. The forfeit only clears `presenceHeldSince`, which `childReclaimAskOrder` alone reads.
- **No pacing is relaxed.** The throttle, the twice-observed rule, the backoff, the refusal wait and the stall bound are the same comparisons, now on a clock that never runs faster than true time (NTP slew aside). So a forward wall step can no longer run a pass about 2 s after the last, or free the slot while a reclaim is in flight; both are possible at HEAD (`:3079`, `:3376`). A rejection now backs off where HEAD re-asked on the next pass, which is a tightening.
- **No licence comes earlier.** A licence needs `mono(t) − mono(a_1) ≥ C`, where a_1 ≥ q_1 is the episode's first ARRIVAL and the monotonic clock never over-reads. The shipped rule measured from q_1 on the wall clock. So with no clock anomaly, the new licence comes at or after the shipped licence for the same history.
- **One licence per episode.** A licensed request's answer, or its rejection, ends or restarts its episode: `continues` requires `!ask.licensed`, and a rejection is written as `failed`. A licensed request that never settles leaves its child in flight, and it is never asked again. So two licences of one child are at least C apart on the monotonic clock.
- **One workspace per episode.** A birth change replaces the entry with a first sighting (item 7), which needs one more fresh pass before any ask. No observation of an earlier workspace under the same slug reaches a licence.
- **The holder's schedule is a lone child's.** It is asked on every pass it is due.

**(b) No unmeasured time is counted.** For one workspace generation (item 7), each check bounds real instants:
- continuity, `a_{i+1} − q_i ≤ G`, gives `o_{i+1} − o_i ≤ G`;
- freshness, `t − q_last ≤ G`, gives `t − o_last ≤ G`;
- the span, `t − a_1 ≥ C`, gives `t − o_1 ≥ C`.

Each gap is read on the larger of the two clocks. A backward wall step under-reads only wall time. A suspend under-reads only the monotonic clock. A forward step over-reads, which restarts the episode and fails closed. The span is read on the monotonic clock alone, which never over-reads.

**(c) A finite licence time, under four hypotheses:**
- **T1:** S + L_p ≤ G. Live: 80 + about 10 = 90 s, a 60 s margin.
- **T2:** a presence answer settles before the next pass. Live: audits answer in 1.3–6.1 s, and passes are at least 51 s apart.
- **T3:** no wall step or suspend during the lease.
- **T4:** the lane's memory is not cleared, and each member of P stays eligible and answers presence while unlicensed. Memory is cleared by a raised `reclaim-pause`, a missing capability, a pass-level fail-shut or a restart.

The proof:
- **Joining and leaving P.** A child joins P by an unlicensed presence answer to a request it was not sent as holder, at that answer's monotonic arrival. That arrival is later than every member's, so a new member ranks LAST, and a member's rank only improves. A member leaves P in any of these ways:
  - a licensed presence answer;
  - as holder, an unlicensed presence answer that does not continue its episode (it forfeits);
  - any other outcome, or a rejection;
  - an ineligible pass;
  - its row vanishing;
  - its birth changing.
- **Lemma 0 (one holder).** Under T1–T4, at most one member of P is due at any pass, and it is the holder.
  - A non-member is asked only on a pass whose order does not start with a member, that is, a pass with no member due.
  - Under T2 and T4, a member is not due only while a LICENSED request of its own is in flight. That member leaves P when the request settles, whatever the answer is.
  - So a child that joins P while another member's licensed request is in flight never shares the order with that member.
- **Lemma 1 (one lease).** Let q_0 be the ask whose answer put the holder h in P, the lease's first ask, and let a_0 ≤ q_0 + L_p be that answer's arrival.
  - From the next pass on, h is asked on every pass. It is the holder (Lemma 0). By T2 it is not in flight, and by T4 it is eligible. Its last answer was presence, so it has no backoff and no `refusedAt`. It is first in the order, and no other child holds the slot.
  - Each answer continues the episode (T1, T3), so h never forfeits. Each ask is fresh (S ≤ G).
  - The episode started at or before a_0. So h's licensed ask goes out by a_0 + C + S ≤ q_0 + C + S + L_p ≤ q_0 + C + G.
- **Lemma 2 (succession).** The slot frees when the licensed request settles, or STALL after it, whichever is first. The next pass is at most S later. So the next ask of any other child comes by q_0 + C + 2G + STALL.
- **Theorem.** Take a pass p_0 at which the slot is free, and a due child y. Suppose k of the children ahead of y in the ask order answer presence when asked unlicensed, and j do not.
  - Each child ahead is asked at most once before y: once asked, it leaves, or its `lastAskedAt` puts it behind y.
  - Each presence-held child ahead holds one lease. Each of the others holds the slot for at most STALL plus one pass.
  - So while no newly sighted child enters the order ahead of y, y is asked within k × (C + 2G + STALL) + j × (STALL + G) of p_0. If y is presence-held itself, it is licensed within C + G of that ask.
  - With nothing else ahead, the k-th presence-held child in the ask order is licensed within k × (C + 2G + STALL) = k × 28 min. That is the worst case under T1–T4.
- **The three figures (R39), never run together.**
  - From its lease's first ask, a holder is licensed within C + S + L_p = 900 + 80 + 10 s ≈ 16.5 min (Lemma 1, at live spacing).
  - One lease, from its first ask to the next lease's first ask, takes at most C + 2S + L_p + L_r = 900 + 160 + 10 + 45 s ≈ 18.6 min (Lemma 2, with the licensed reclaim answering within L_r, at live spacing).
  - The k-th presence-held child in the ask order is licensed within k × (C + 2G + STALL) = k × 28 min, the worst case under T1–T4 (the Theorem).
  - The first two are live figures at the 2026-10-05 spacing; the third follows from the constants alone. A violation of T1–T4 forfeits the lease and fails closed (below).
- **When T1–T3 fail.** A holder whose answer does not continue its episode forfeits on that answer. A holder whose request rejects forfeits on the rejection, and one whose request stalls forfeits on its late answer (items 5–6). Meanwhile the order passes over it.
  - The forfeiting child's `lastAskedAt` is the most recent, so the fairness order reaches every other due child before it again.
  - So a transient violation costs the forfeiting holder its place, and it re-joins at the back.
  - A persistent violation licenses no presence-held child, exactly as a lone child today. Every other due child is still asked: a presence-held child ahead of it costs at most two asks, the one that puts it in P and the one as holder that forfeits.
  - A waiting member exists only after such a violation (Lemma 0). When it becomes holder, its first answer cannot continue its stale episode, so it forfeits too and re-joins at the back.
- **When T4 fails.** A cleared memory restarts every child's clock and every lease.
- **Arrivals.** While new children keep being sighted, they precede every child already asked (the shipped never-asked-first order). So a child's wait is bounded by the due set plus arrivals, not by a constant.

#### Interfaces
- **Produced by L1** (`server/src/childReclaimSweep.ts`, which still imports L0 only):
  - `ChildReclaimLaneNow`, `ChildReclaimAsk`.
  - `ChildReclaimSweepEntry` gains `lastPresenceWallAt: number | null`, `presenceHeldSince: number | null` and `bornAt: number | null`.
  - `childReclaimFirstSighting(monoMs: number, bornAt: number | null): ChildReclaimSweepEntry`, the final signature: two arguments, both required. A call that models no workspace generation passes `null` as `bornAt`, explicitly, as its idle value: Task 3's `defers` literals and Task 5's case 5 and case C do (A-S3-4, A-S3-9). No field the chip reads depends on it.
  - `childReclaimSameGeneration(entry: ChildReclaimSweepEntry, bornAt: number | null): boolean`.
  - `childReclaimNextEntry(entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, ask: ChildReclaimAsk, answered: ChildReclaimLaneNow, passIntervalMs: number): ChildReclaimSweepEntry | null`.
  - `childReclaimDeferExpired(entry: ChildReclaimSweepEntry, now: ChildReclaimLaneNow, passIntervalMs: number): boolean`.
  - `childReclaimDue(entry: ChildReclaimSweepEntry, monoMs: number, passIntervalMs: number): boolean`, its shape unchanged, with a monotonic argument.
  - `childReclaimAskOrder`, above.
- **Produced by the wiring** (`server/src/server.ts`): `Deps.monotonicMs?: () => number`, placed beside `childReclaimExec`, with the docstring "The process's monotonic clock in ms, read by the child-reclaim sweep lane alone. Unset in production: the lane reads `performance.now()`. A test sets it."
- **Consumed:** L1 consumes only L0. L4 consumes `node:perf_hooks`.
- **No wire change.** `ChildReclaimRequest` is unchanged, and `deferredSinceMs` stays wall-clock epoch ms.

#### Files
- `server/src/childReclaimSweep.ts`
- `server/src/watch.ts`
- `server/src/server.ts` (one optional field)
- `server/test/child-reclaim-sweep-policy.test.ts`
- `server/test/child-reclaim-sweep.test.ts`
- `docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md`, append-only (Prose item 8)

Not `server/src/coord/childReclaim.ts`. G5's sentence belongs to R46's prose task, with the small-items design's text. That text names no clock unit, so it stays true after this task.

#### Steps (TDD, red first; ONE commit on the workspace branch)
1. **Policy rows, red.** In `child-reclaim-sweep-policy.test.ts`, add these helpers:
   - `const BORN = NOW - 3_600_000;`
   - `const at = (mono: number, wall: number = mono): ChildReclaimLaneNow => ({ monoMs: mono, wallMs: wall });`
   - `const ask = (mono: number, licensed: boolean, asHolder = false, wall: number = mono): ChildReclaimAsk => ({ at: at(mono, wall), licensed, asHolder });`

   Add rows P0–P14 and S1 below. Then update the shipped rows mechanically:
   - the 26 `childReclaimNextEntry(e, o, X, L, I)` calls become `(e, o, ask(X, L), at(X), I)`;
   - the 13 `childReclaimDeferExpired(e, X, I)` calls become `(e, at(X), I)`;
   - the 9 `childReclaimDue` calls are unchanged;
   - the one `childReclaimFirstSighting(NOW - 60_000)` becomes `(NOW - 60_000, BORN)`, and its literal (`:354-355`) gains `lastPresenceWallAt: null, presenceHeldSince: null, bornAt: BORN`;
   - every entry literal that sets `lastPresenceDeferredAt` to a number also sets `lastPresenceWallAt` to the same number, spread overrides included (`:519`). The rows at `:406-407`, `:450-451`, `:478` and `:515-519` assert a `true` licence and go red without it;
   - every `toEqual` on a presence answer gains the new fields. `presenceHeldSince` is the arrival, or `null` after a licensed answer. `lastPresenceWallAt` is the request.

   With `ask.at === answered` and `asHolder: false`, every shipped number is unchanged.
2. **Implement L1** (rule items 1–5 and 7). The policy suite goes green.
3. **The lane fixture gains three clocks** (`fixture` in `child-reclaim-sweep.test.ts`):
   - `let mono = opts.mono0 ?? 5_000`, deliberately not `T0`, and `let trueT = 0`;
   - `deps.monotonicMs = () => mono`, unless `opts.monoSource === 'performance'`;
   - `advance(ms)` moves `clock`, `mono` and `trueT`;
   - NEW `wallStep(ms)` moves `clock` alone (negative is a step back, positive a step forward);
   - NEW `suspend(ms)` moves `clock` and `trueT`, but not `mono`;
   - NEW accessors `mono()` and `trueNow()`.

   The four lane assertions on a decision clock, at `:903-904` and `:938-939`, read `f.mono()`. `firstDeferredAt` and `deferredSinceMs` stay `f.now()`. `:1052-1053` asserts nulls and is unchanged; `:1617-1618` sits inside a case this task rewrites. Add L1–L17, red, and rewrite the four shipped cases below.
4. **Implement L4** (`watch.ts`) and `Deps.monotonicMs`:
   - the private reader `childReclaimLaneNow(): ChildReclaimLaneNow`;
   - the pass's first reads: `const asked = this.childReclaimLaneNow(); const now = asked.wallMs; const mono = asked.monoMs;`;
   - the throttle: `if (this.lastChildReclaimSweep !== null && mono - this.lastChildReclaimSweep < CHILD_RECLAIM_SWEEP_MS) return; this.lastChildReclaimSweep = mono;`;
   - the first-sighting branch of rule item 7 (`:3350-3354`), and `childReclaimDue(entry, mono, …)` (`:3359`);
   - the stall loop compares `mono - since` (`:3377`), and `childReclaimInFlightSince.set(r.id, mono)` (`:3420`);
   - the `due` items gain `id: r.id` (`:3178`, `:3360`);
   - `const { order, holderId } = childReclaimAskOrder(due);` and `for (const { r, entry, runId, id } of order.slice(0, freeSlots))` replace the `due.sort` and its slice (`:3386-3402`);
   - per item, `const ask: ChildReclaimAsk = { at: asked, licensed: childReclaimDeferExpired(entry, asked, CHILD_RECLAIM_SWEEP_MS), asHolder: id === holderId };` and the request's `deferExpired: ask.licensed` (`:3409`);
   - the success callback opens with `const answered = this.childReclaimLaneNow();` and calls `this.childReclaimWriteBack(r.id, entry, outcome, ask, answered)`;
   - the rejection callback opens with `const answered = this.childReclaimLaneNow();`. Its warn line ends "— recorded as a failed attempt; the sweep retries after its backoff", and it calls `this.childReclaimWriteBack(r.id, entry, { kind: 'failed' }, ask, answered)`;
   - `now` stays only where rule item 1 lists it;
   - the pass gains no `await`: `childReclaimLaneNow()` is synchronous, and both callbacks stay `.then` arms. Task 9c's G2 text rests on the pass awaiting nothing before its loop.
5. **Seeded rows:** S1 (policy) and S2 (lane).
6. **Prose** (below).
7. **Run each suite alone, in the foreground (timeout ≥ 600000 ms), from `server/`:**
   ```bash
   ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim-generation.test.ts
   ./node_modules/.bin/vitest run test/fleetws.test.ts          # real ticks drive the lane on the performance.now default
   ./node_modules/.bin/vitest run test/single-definition.test.ts
   ./node_modules/.bin/vitest run test/typecheck-tests.test.ts  # a known load flake: re-run alone before calling it a break
   ./node_modules/.bin/tsc --noEmit -p .
   ```
   Measured at HEAD: `CHILD_RECLAIM_SWEEP_MS` is referenced only by the two sweep suites, and no other watcher test with a mocked clock plants a child. Apply each mutation in the table, see its red, and revert it before the next.

   Then, from the workspace root, check the wave-4 plan's appended block (Prose item 8):
   ```bash
   grep -c '^## Post-merge corrections' docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md   # prints 1 (0 at 334fb722a): the heading occurs exactly once
   git diff origin/main...HEAD -- docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md          # additions only, after the file's last line
   ```

#### Tests and their red mutations

Policy rows are in `server/test/child-reclaim-sweep-policy.test.ts`. Lane rows are in `server/test/child-reclaim-sweep.test.ts`.

| # | Case | Mutation → red |
|---|---|---|
| P0 | `childReclaimAskOrder` returns a permutation. For seeded due lists (0–8 items, mixed `presenceHeldSince` and `lastAskedAt`), `order` has the input's length and the same items by reference. | Return `[holder, ...fair]` without removing the holder from `fair`: length + 1. |
| P1 | One presence-held child among never-asked children goes first, although its `lastAskedAt` is the most recent, and `holderId` names it. | Return the fairness order only (drop the hoist). Return `holderId: null` always. |
| P2 | Seniority is `presenceHeldSince`, not the episode start. S {`presenceHeldSince` 0, `firstPresenceDeferredAt` 500 000} holds over J {100 000, 100 000}. | Key the holder on `firstPresenceDeferredAt`: J goes first. |
| P3 | Seniority is not the any-kind clock. J {earlier `firstDeferredAt`, `presenceHeldSince` 100 000} loses to S {`presenceHeldSince` 0}. | Key the holder on `firstDeferredAt`. |
| P4 | A `presenceHeldSince` tie falls to `firstEligibleAt`, then id. With no holder, `holderId` is `null`, and the order is never-asked first, then `lastAskedAt` ascending, then `firstEligibleAt`, then id (the three shapes the shipped lane rows at `:1073-1159` pin). | Drop the `firstEligibleAt` tie-break (red on either arm). Sort `lastAskedAt` descending. |
| P5 | `presenceHeldSince` lifecycle.<br>- A non-holder's first unlicensed presence answer sets it to `answered.monoMs`.<br>- A holder's unlicensed answer that continues keeps it.<br>- A holder's unlicensed answer that restarts across a gap clears it (the forfeit).<br>- A non-holder's unlicensed answer that restarts across a gap keeps an existing one (a waiting member keeps its place).<br>- A licensed presence answer clears it, and the next non-holder unlicensed answer sets it afresh, at the back of the line.<br>- `failed`, `refused` and each non-presence `why` clear it. | Five mutations, five reds: keep it on a holder's gap restart; clear it on a non-holder's gap restart; re-stamp it on a non-holder's gap restart; keep it on a licensed answer; keep it on any other outcome. |
| P6 | `presenceHeldSince` never reaches the licence. An entry whose `presenceHeldSince` is 2C old, whose episode just restarted (`firstPresenceDeferredAt` = now) and which is fresh gives `childReclaimDeferExpired` false. | Measure the span from `presenceHeldSince`: true. |
| P7 | Bracket continuity. The previous answer's request is at 0. A new answer asked at 120 000 and answered at 150 000 continues (inclusive). Answered at 150 001, it starts a new episode at 150 001. | `continues` reads `ask.at` instead of `answered`: the 150 001 case continues. |
| P8 | Bracket start. The first answer is asked at 0 and answered at 30 000, and later answers keep it fresh. `childReclaimDeferExpired` is false at 900 000 and at 929 999, and true at 930 000. | Start the episode at `ask.at.monoMs`: true at 900 000. |
| P9 | Bracket freshness. Build an entry with `childReclaimNextEntry`, asked at X and answered at X + 40 000, its episode 2C old. It is false at X + 150 001 and true at X + 150 000. | Stamp `lastPresenceDeferredAt` from `answered`: true at X + 150 001. |
| P10 | A backward wall step cannot hide a hole. A monotonic gap of 200 000 with a wall gap of 50 000 restarts the episode, and `childReclaimDeferExpired` at the same reading is false. | Read the gap on the wall clock alone: the episode continues and is licensed. |
| P11 | A suspend cannot hide a hole. A monotonic gap of 60 000 with a wall gap of 400 000 restarts the episode. | Read the gap on the monotonic clock alone: the episode continues. |
| P12 | The span is the monotonic clock alone. With distinct origins (`at(m, m + T0)`) and fresh on both clocks, a monotonic span of 899 999 gives false and 900 000 gives true. With the wall stepped back 600 s, 900 000 still gives true. | Measure the span from `now.wallMs` (a clock mix): true at 899 999. |
| P13 | `firstDeferredAt` is wall. A first deferral of any `why` with `ask.at = at(5_000, T0 + 5_000)` stamps `firstDeferredAt: T0 + 5_000` and `lastAskedAt: 5_000`. | Stamp `firstDeferredAt` from `ask.at.monoMs`. |
| P14 | `childReclaimSameGeneration`: (entry `bornAt` B, B) → true; (B, B + 1) → false; (B, null) → false; (null, null) → false. `childReclaimFirstSighting(5_000, B)` carries `bornAt: B`. | `return true`. Drop the `entry.bornAt !== null` conjunct: (null, null) → true. |
| S1 | Seeded policy harness (below). | Below. |
| L1 | The lease at the lane: three presence-held children are licensed in turn. It replaces `:1605-1619`. demo-a, demo-b and demo-c answer presence unless `req.deferExpired`; a licensed request answers `reclaimed`, and its row is unplanted. With `next()` spacing, the requests run a ×16, b ×16, c ×16, licensed exactly at indices 15, 31 and 47. | `watch.ts` keeps its inline `due.sort`: round robin, nothing licensed. |
| L2 | Two presence-held children; the senior's lease runs on every pass. It replaces `:1587-1603`. The stub always answers presence, and the spacing is 62 000. a is licensed at its 16th ask, 930 s after its first. b's first request is overall index 16, and b is licensed at its own 16th. | Drop the hoist: a and b alternate, and a is licensed at its 9th ask (992 s). |
| L3 | R254-P′: a stale single sample never licenses across another child's lease. It replaces R254-P (`:1546-1556`) and its companion (`:1558-1581`).<br>The stub answers presence even when licensed. No real executor does this: the executor skips the server's presence check under `deferExpired` (`if (!req.deferExpired && deps.presence?.isVisible(sessionId) === true)`, `server/src/coord/childReclaim.ts:801`), and ccd skips rungs 5 and 6 under `(( ! defer ))` (`ccd/ccd`, three sites).<br>a is licensed at its 16th ask and loses its seniority. b holds the lease from the next pass for 16 passes. a's 17th ask goes out UNLICENSED: its episode spans the ceiling, but its latest request is 17 passes old, and its answer restarts the episode at the arrival. a's next licence comes at its own 32nd ask, never earlier. | Drop the freshness conjunct: a's 17th ask is licensed. Keep `presenceHeldSince` on a licensed answer: b is never asked. |
| L4 | The lease's stated cost (R39). A reclaimable demo-b, sighted with a presence-held demo-a, is first asked on the pass after a's licensed ask (pass 18; a is licensed at pass 17), and is reclaimed. | Drop the hoist: b is asked at pass 3. |
| L5 | R258-C′: a backward wall step neither freezes the lane nor delays the licence. A lone presence child takes `wallStep(-600_000)` after its 5th answer. It makes one request on every `advance(CHILD_RECLAIM_SWEEP_MS + 1)`, and is licensed at its 16th ask. | Throttle on `Date.now()`: no request for about 660 s, and the licence is late. |
| L6 | A backward wall step cannot hide a real hole. After the 5th answer, `wallStep(-150_000)` then `advance(200_000)`: a 200 s monotonic gap that the wall clock reads as 50 s. The 6th answer restarts the episode, and the licence comes at the 21st ask. | Read the gap on the wall clock alone: licensed at the 14th ask. |
| L7 | A suspend restarts the episode. After the 5th answer, `suspend(400_000)` then `advance(CHILD_RECLAIM_SWEEP_MS + 1)`. The 6th answer restarts the episode, and the licence comes at the 21st ask. | Read the gap on the monotonic clock alone: licensed at the 16th. |
| L8 | A forward wall step does not run a pass early. After a first sighting, `wallStep(120_000)` then `advance(2_000)`: no request. Then `advance(CHILD_RECLAIM_SWEEP_MS)`: one request. | Throttle on wall time: a request 2 s after the sighting. |
| L9 | A forward wall step past `CHILD_RECLAIM_STALL_MS` does not free the slot. demo-a's request never settles. After `wallStep(CHILD_RECLAIM_STALL_MS + 1)` and `advance(CHILD_RECLAIM_SWEEP_MS + 1)`, demo-b is not asked. After `advance(CHILD_RECLAIM_STALL_MS)`, demo-b is asked. | Stall clock on wall time: demo-b is asked while demo-a is in flight. |
| L10 | The throttle's never-run sentinel is `null`. With `fixture({ mono0: 0 })`, a pass at monotonic 0 sights the child, and a call 1 000 ms later runs no pass and makes no request. Then `advance(CHILD_RECLAIM_SWEEP_MS)` gives one request. | Restore the `0` sentinel: the second call runs a pass and asks. |
| L11 | The arrival is read in the `.then`. The stub's promise resolves only after the test calls `advance(30_000)`. Then `firstPresenceDeferredAt` equals `f.mono()` at resolution, and `lastPresenceDeferredAt` equals the monotonic time of the pass. | Pass `ask.at` as `answered`. |
| L12 | The display clock stays wall while the decision clocks are monotonic (A-iface-5). With `MONO0 ≠ T0`, a `state-changed` deferral stamps `firstDeferredAt === f.now()` (an epoch), and the next request's `deferredSinceMs` equals it. `firstEligibleAt` equals `f.mono()` of the sighting pass. | Stamp `firstDeferredAt` from `ask.at.monoMs`. |
| L13 | The production default is `performance.now()`. `fixture({ monoSource: 'performance' })` leaves `deps.monotonicMs` unset and calls `vi.spyOn(performance, 'now').mockImplementation(() => mono)`. `performance` from `node:perf_hooks` is the global object (measured as `===` under Node 24.14.1). After a sighting, `wallStep(-600_000)` then `advance(CHILD_RECLAIM_SWEEP_MS + 1)` still runs a pass that asks, and a `state-changed` answer stamps `firstDeferredAt === f.now()`. | Default to `Date.now()`: no pass. Stamp `firstDeferredAt` from `monoMs`. |
| L14 | The tenure bound, on a persistent slow answer (R39). demo-a answers presence, and its stub first calls `f.advance(2.5 * CHILD_RECLAIM_SWEEP_MS + 1)`, so every answer arrives more than G after its request. demo-b answers `reclaimed`. demo-a joins at pass 2 and forfeits as holder at pass 3, and demo-b's first request is the third request overall (pass 4). No request of demo-a is licensed. | Keep `presenceHeldSince` on a holder's gap restart (no forfeit): demo-b is never asked. Pass `asHolder: false` on every request: the same. |
| L15 | A rejection is a failed attempt. The stub rejects whenever `req.deferExpired` is true, and answers presence otherwise. A lone child is licensed at its 16th ask, and that request rejects. The entry then matches `{ consecutiveFailures: 1, firstPresenceDeferredAt: null, presenceHeldSince: null }`. The next request goes out only after `childReclaimBackoffMs(1, CHILD_RECLAIM_SWEEP_MS)` (two `next()` passes later), with `deferExpired: false`. | Leave the entry untouched on a rejection: the next pass sends a second licensed request. |
| L16 | A stalled holder request forfeits on its late answer. demo-a and demo-b answer presence unless licensed. demo-a joins at pass 2. demo-a's pass-3 request (as holder) is held unsettled (`passDispatched`). After `advance(CHILD_RECLAIM_STALL_MS + 1)` a pass asks demo-b, which joins P, and the next pass asks demo-b as holder. The test then resolves demo-a's held request with presence. On the next pass demo-b is asked, and demo-a is not. | Keep `presenceHeldSince` on a holder's gap restart: demo-a, the senior, is asked. Pass `asHolder: false` on every request: the same. |
| L17 | One entry describes one workspace generation (rule item 7). demo-a answers presence unless licensed (then `reclaimed`). After its 15th ask, `f.next()`, a new minting run is opened and abandoned, and `plant('demo-a', { child: String(r2.id) })` mirrors a new `create`. The next pass sends no request (a fresh first sighting), and the pass after sends one request with `deferExpired: false`. | Drop the generation reset: that pass sends a licensed request. |
| S2 | Seeded rows at the lane (below). | `watch.ts` keeps its inline `due.sort`: no licence for N ≥ 3. Keep `presenceHeldSince` on a holder's gap restart: `slow-persistent` reds. |

**S1, the seeded policy harness** (`child-reclaim-sweep-policy.test.ts`).

The harness:
- uses `mulberry32`, with seeds 1–50 × N = 1–6 × eleven modes;
- composes `childReclaimFirstSighting`, `childReclaimDue`, `childReclaimAskOrder` (its `holderId` read into each ask's `asHolder`), `childReclaimDeferExpired` and `childReclaimNextEntry` with a model of the lane: its one slot, `CHILD_RECLAIM_STALL_MS`, the in-flight rule, the entry-identity write-back guard, and a rejection written as `failed`;
- runs three clocks: true time, monotonic (origin 5 000, frozen during a suspend) and wall (origin `T0`).

Children:
- `p1`…`pN` are presence-held: they answer presence while unlicensed, and `reclaimed` when licensed, except in `breach` and `reject`;
- `r` always answers `reclaimed`; `x` always answers `state-changed`;
- all are sighted on pass 1, and their ids put every `p` before `r` before `x`.

Timing: monotonic spacing U[60 000, 80 000] between passes, presence latency U[0, 10 000], reclaim latency U[5 000, 45 000].

Modes. Each disturbance is applied once at a seeded pass k in [3, 3 + 16N], unless the mode says otherwise:
- `none`;
- `back`: wall −600 000, with no hole;
- `back-hole`: wall −600 000, and pass k's spacing is 200 000. This is a real hole the wall clock under-reads;
- `fwd-small`: wall +60 000;
- `fwd-large`: wall +600 000;
- `suspend`: true time and wall +300 000, monotonic frozen;
- `slow-tick`: pass k's spacing is 200 000;
- `slow-answer`: the answer to pass k's request arrives 120 000 late;
- `breach`: every licensed `p` answers presence;
- `slow-persistent`: every spacing from pass 2 on is 160 000;
- `reject`: p1's first licensed request rejects.

Each run lasts until every `p` is licensed and `r` is reclaimed, or until 6 h of true time. Checks, all in TRUE time:
- **(i) every mode.** Each licensed request of a `p` at T rests on a suffix s_1…s_m of that child's consecutive presence answers, ending at its latest answer before T, with T − a(s_1) ≥ 900 000, a(s_{i+1}) − q(s_i) ≤ 150 000, and T − q(s_m) ≤ 150 000.
- **(ii) every mode.** Two licensed requests of one child, whatever their answers, are at least 900 000 apart.
- **(iii) `none` and `back`.** Licences come in id order, and the k-th lands by t_2 + k × 1 070 000, where t_2 is pass 2. The figure 1 070 000 is C + L_p + 2S at S = 80 000 and L_p = 10 000. L_r is shorter than the least spacing, so the slot is free at the pass after a licence. `r` is reclaimed by t_2 + N × 1 070 000 + 45 000.
- **(iv) `back-hole`, `fwd-small`, `fwd-large`, `suspend`, `slow-tick`, `slow-answer`, `reject`.** Every `p` is licensed and `r` reclaimed by t_2 + (N + 1) × 1 680 000 + 550 000. The 550 000 is the suspend's 300 000, plus one ask each of `r` and `x`, which the order reaches before a forfeiting holder re-joins.
- **(v) `breach`.** `r` is reclaimed within 6 h.
- **(vi) `slow-persistent`.** No `p` is licensed, and `r` is asked at pass 2N + 2 and reclaimed. Each `p` joins at its first ask and forfeits at its second.

Mutations. Each must turn S1 red on at least one (seed, N, mode), and the worker records which in the wave-done mail:
- drop the hoist (iii);
- keep `presenceHeldSince` on a licensed answer (v);
- keep `presenceHeldSince` on a holder's gap restart (no forfeit) (vi); this is R39's required red;
- read the gap on the monotonic clock alone (i, `suspend`);
- read the gap on the wall clock alone (i, `back-hole`);
- `continues` ignoring `licensed` (ii, `breach`);
- measure the span from `now.wallMs` (i, `fwd-large`).

These mutations may not red S1, and each has its red in a deterministic row:
- `continues` from `ask.at` (P7, L11);
- seniority keyed on `firstPresenceDeferredAt` (P2);
- the rejection's write (L15). S1's slot loop is a copy of L4's, so a mutation of `watch.ts` cannot reach it;
- the generation reset (P14, L17);
- the `holderId` wiring (L14, L16).

S1 can drift from `watch.ts`. L1–L17 and S2 cross-check through the real watcher.

**S2, seeded rows at the lane** (`child-reclaim-sweep.test.ts`, through the real watcher). Seeds 1–2 × N = 1–6 × modes `none`, `back-hole`, `suspend` and `slow-persistent`, run as `it.each` with `{ timeout: 120_000 }` per row.
- **Setup.** The children are `demo-p1`…`demo-pN`, `demo-r` and `demo-x`, as in S1. Latency is 0, because the stubs resolve at once; S1 carries latency. `advance` is seeded in [60 001, 80 000], or 160 000 on every pass in `slow-persistent`. The disturbance comes at a seeded pass k through the fixture's `wallStep` and `suspend`. `back-hole` is `wallStep(-600_000)` with that pass's advance at 200 000, and `suspend` is `suspend(300_000)`.
- **Checks**, in the fixture's true time:
  - (i) as in S1;
  - (ii) licences in id order, except that a holder which forfeited is licensed after the others;
  - (iii) in `none`, the first licence comes by pass 2 + 980 000 (C + S), and each later one within 1 060 000 (C + 2S) of the one before. In `back-hole` and `suspend`, every `p` is licensed and `demo-r` reclaimed by pass 2 + (N + 1) × 1 060 000 + 460 000;
  - (iv) `demo-r` and `demo-x` are both asked; in `none`, after the last licence;
  - (v) in `slow-persistent`, no `p` is licensed, and `demo-r` is asked at pass 2N + 2.

#### The shipped cases this rewrites, and to what

The four cases below pinned G3's wedge as the ruled cost of 2026-10-04. Under R39 the wedge is the defect, so they flip to its bound.
- **`:1605-1619`**, "a child that sits out TWO passes … never licensed", becomes **L1**: three presence-held children licensed in turn.
- **`:1587-1603`**, "a child that sits out ONE pass … (124 s between its answers)", becomes **L2**. Its 124 s arithmetic is now a non-holder's, so the lease decides the case.
- **R254-P (`:1546-1556`) and its companion (`:1558-1581`)** become **L3**. Their SAFETY property is that one stale sample followed by unobserved time never licenses, and that the episode runs from the answer after the gap. It is re-expressed in L3, P9 and P10, not dropped. The SAFETY lens confirms that equivalence.
- **The `describe` at `:1583`** is retitled "the presence lease at the lane: the senior presence-held child is asked on every pass it is due".

Unchanged by construction:
- R254-L10 and R254-L12, which have one child. L12's re-plant follows the vanished-row delete, so it is a first sighting either way.
- The fairness, in-flight and stall rows at `:942-975` and `:1073-1159`, which involve no presence-held child, and where `advance` moves the monotonic clock too.
- The recycled-id rows at `:1260` and `:1387`, whose old `create` is mirrored before the first sighting.
- `:882-905` and `:917-940`, whose numbers stay; only the four presence assertions read `f.mono()`.

#### Prose, in the same commit

Committed comments cite the spec, never the contract or a ruling number (contract §8 R23). Spec §5.7's text for the lease and its three figures is the coordinator's, in the docs PR that carries contract §11, merged before dispatch. This task writes no spec text, and its comments cite plain "spec §5.7".

1. **`ChildReclaimSweepEntry`'s header** (`childReclaimSweep.ts:36-66`).
   - A new paragraph goes after its first:
     > THE CLOCKS. Every instant in this entry is the lane's MONOTONIC clock (`ChildReclaimLaneNow.monoMs`: never stepped, stopped while the box is suspended, and meaningless outside this process), with three exceptions. `firstDeferredAt` is wall-clock epoch ms because it is DISPLAYED (each request's `deferredSinceMs`, the run chip's `at`). `lastPresenceWallAt` is the presence gap's second operand. `bornAt` is ccd's clock, compared for equality only. That is safe only because this memory never leaves the process: it is never persisted or sent, and nothing but `firstDeferredAt` is read as an epoch.
   - The third paragraph (`:54-66`) becomes:
     > And the episode is CONTINUOUS in the literal sense (spec §5.7: "15 minutes of continuous deferral"): a child that is not asked writes nothing, so time nobody measured must never count as presence observed. Each presence-class answer brackets its observation between the request that asked (`lastPresenceDeferredAt`) and its own arrival. The next answer extends the episode only while its ARRIVAL is within `CHILD_RECLAIM_PRESENCE_GAP_PASSES` (two and a half) pass intervals of that request. The episode starts at its first answer's ARRIVAL. The ceiling licenses an ask only while the latest answer's REQUEST is that recent. Each gap is the larger of the monotonic and the wall-clock difference, and the ceiling's span is the monotonic clock alone. None of this ever licenses an ask EARLIER, or more OFTEN, than the ceiling would for a lone child.
     >
     > What keeps the ceiling REACHABLE however many children are due is the order (`childReclaimAskOrder`). The senior presence-held due child (`presenceHeldSince`) holds the lease and is asked on every pass it is due, exactly as a lone child is, while every other due child waits. A holder whose answer does not continue its episode, or whose request is rejected, forfeits the lease, so a slow box costs the lease and never stops the lane. Without the lease, three or more due children that kept deferring kept every presence-held child unlicensed for good (spec §5.7: "Unbounded would be worse than absent"). The entry describes ONE workspace generation (`bornAt`): a slug minted again is a new child, sighted afresh.
     >
     > THE BOUND (spec §5.7) is three figures, never run together. From its lease's first ask, the holder is licensed within the ceiling plus one pass spacing plus one presence answer's latency: about 16.5 minutes at the spacing measured on 2026-10-05. One lease, from its first ask to the next lease's first ask, takes at most the ceiling plus two pass spacings plus a presence answer's and a reclaim's latency: about 18.6 minutes there. And the k-th presence-held child in the ask order is licensed within k times (the ceiling + twice the gap bound + the lane's stall bound), k × 28 minutes: the worst case while a pass plus a presence answer stays within the gap bound, an answer settles before the next pass, no wall-clock step or suspend falls in the lease, and this memory is not cleared. A breach of any of those forfeits the lease and fails closed.
2. **The field docstrings.**
   - `firstEligibleAt`: "When this child was first sighted eligible (monotonic)."
   - `firstDeferredAt` gains: "WALL-CLOCK epoch ms, the one field here that is displayed."
   - `firstPresenceDeferredAt`: "The current PRESENCE episode's start: the ARRIVAL (monotonic) of its first presence-class answer, the instant `childReclaimDeferExpired` measures the ceiling from. `null` whenever the last outcome was not a presence-class deferral."
   - `lastPresenceDeferredAt`: "The REQUEST instant (monotonic) of the episode's latest presence-class answer. The next answer extends the episode only if it ARRIVES within `CHILD_RECLAIM_PRESENCE_GAP_PASSES` intervals of it, and the ceiling licenses an ask only within as many. `null` exactly when `firstPresenceDeferredAt` is."
   - `lastPresenceWallAt` (new): "That same request on the WALL clock, read only by the gap reading, whose larger difference neither a backward wall step nor a suspend can shrink. `null` exactly when `lastPresenceDeferredAt` is."
   - `presenceHeldSince` (new): "The lease's seniority: the ARRIVAL (monotonic) of the unlicensed presence-class answer that put this child in line. An unlicensed presence answer keeps it, unless the request went to the lease's HOLDER and the answer does not continue the episode: then the holder forfeits (`null`), and re-joins at the back on its next unlicensed presence answer. A licensed presence answer, any other outcome and a rejection clear it. Read ONLY by `childReclaimAskOrder`, never by the licence."
   - `bornAt` (new): "The birth of the workspace generation this entry describes: the opening `create`'s `at`, on ccd's clock, compared for equality only (`childReclaimSameGeneration`). A different birth is a different workspace under a recycled slug, which starts from a first sighting."
   - `lastFailedAt`, `refusedAt` and `lastAskedAt` each say "(monotonic)". `lastAskedAt`'s "fairness ordering key" becomes "the fairness order's key in `childReclaimAskOrder`".
3. **`CHILD_RECLAIM_PRESENCE_GAP_PASSES`** (`:383-396`) becomes:
   > How far apart two presence-class answers of one CONTINUOUS episode may be (the later answer's ARRIVAL from the earlier one's REQUEST), and how far the episode's latest REQUEST may be from the ask the ceiling would license (spec §5.7, "continuous deferral"): two and a half pass intervals, inclusive, each gap read as the larger of the monotonic and the wall-clock difference. The lease holder (`childReclaimAskOrder`) is asked on every pass it is due, so its gap is one pass spacing plus its answer's latency. Passes were measured 51–80 s apart on 2026-10-05 (median 68 s), and an audit answers in seconds, so the margin is about 60 s. A slow tick, a slow answer, a forward wall-clock step or a suspended box can push a gap past it. The episode then restarts, the licence is withheld and the holder forfeits the lease, which fails closed and costs that child its place in line. A child that does not hold the lease is asked only when the order reaches it, usually later than that, so its episode restarts until it holds the lease. The bound is this multiplier times the interval the caller hands in, never a constant of its own.
4. **`childReclaimNextEntry`'s presence paragraph** (`:416-430`) becomes:
   > The PRESENCE clock is an EPISODE (spec §5.7). Every outcome other than a presence-class deferral ends it, so `failed` (a rejected request among them, which the lane writes as `failed`), `refused` and a non-presence `deferred` clear `firstPresenceDeferredAt`, `lastPresenceDeferredAt`, `lastPresenceWallAt` and `presenceHeldSince`.
   >
   > A presence-class deferral brackets its observation. It stamps the REQUEST (`ask.at`) into `lastPresenceDeferredAt` (monotonic) and `lastPresenceWallAt` (wall). It STARTS a new episode at its ARRIVAL (`answered.monoMs`) in three cases:
   > - none is running;
   > - the request was `licensed` (sent with `deferExpired: true`), so an answer to it restarts the episode rather than letting every later retry keep skipping ccd's presence rungs;
   > - the arrival is more than `CHILD_RECLAIM_PRESENCE_GAP_PASSES` × `passIntervalMs` after the previous request on either clock, so the time between was never observed.
   >
   > Only an UNLICENSED presence answer arriving within that gap (inclusive) extends the episode. An unlicensed presence answer keeps `presenceHeldSince`, or sets it to its arrival, except that a request sent as the lease's holder whose answer does not extend the episode clears it: the holder forfeits. A licensed one clears it. `firstDeferredAt` is stamped once, from `ask.at.wallMs`. Every other stamp is `ask.at.monoMs`.
5. **`childReclaimDeferExpired`'s first sentences** (`:464-470`) become:
   > May this ask go out LICENSED (`deferExpired: true`)? Only when BOTH hold. First, the current PRESENCE episode has spanned the ceiling on the MONOTONIC clock, measured from its first answer's ARRIVAL (at EXACTLY the ceiling, yes). Second, its latest answer's REQUEST is within `CHILD_RECLAIM_PRESENCE_GAP_PASSES` × `passIntervalMs` of `now` on the larger of the two clocks (inclusive). So the licence rests on presence observed continuously up to the ask in real time, never on one sample followed by time nobody measured (spec §5.7: "15 minutes of continuous deferral"). `presenceHeldSince` is never read here: the lease decides who is asked, never what is licensed.

   The rest of the docstring is unchanged.
6. **`childReclaimAskOrder`'s docstring:**
   > THE ORDER THE LANE ASKS IN (spec §5.7: a wait on presence is bounded). The holder of the presence lease comes first: the due child with a `presenceHeldSince`, least by (`presenceHeldSince`, `firstEligibleAt`, id). It is named in `holderId`, so the lane can tell each answer which role its request was sent in. Every other due child follows in the fairness order (`lastAskedAt`, never-asked first, then `firstEligibleAt`, then id), which used to be the lane's own inline sort.
   >
   > Without the holder first, three or more due children that keep deferring ask each presence-held child every third pass or later. That is past the continuity gap, so no episode ever spans the ceiling. With the holder first, it is asked on every pass it is due, exactly as a lone child is. A holder that cannot keep its episode continuous forfeits (`childReclaimNextEntry`), so the lease never outlives the timing it rests on.
   >
   > A PERMUTATION of `due`: it adds no ask and changes no pacing, and the lane still takes its free slots from the front. The cost: while a lease runs, no other due child is asked, so a backlog drain pauses for one lease per presence-held child (`ChildReclaimSweepEntry` states the bound's three figures).
7. **`watch.ts`.**
   - `lastChildReclaimSweep` (`:753`): "The child-reclaim lane's clock (child-reclamation wave 4): the MONOTONIC time of the last pass, `null` before the first. Not the other lanes' `0` never-run idiom, because a monotonic source may start at 0, which would make `0` a real stamp. Monotonic so that a backward wall step cannot freeze the lane, and a forward one cannot run a pass early: the twice-observed rule's interval is real time."
   - `childReclaimSweepState` gains: "Its decision clocks are this process's monotonic clock; only `firstDeferredAt` is an epoch (`ChildReclaimSweepEntry`). An entry describes one workspace generation, and a new birth replaces it with a first sighting."
   - `childReclaimInFlightSince` gains: "MONOTONIC: a forward wall-clock step must never free the one slot while a reclaim is still running."
   - `currentChildReclaimDefers()` gains: "Its `firstDeferredAt` is wall-clock epoch ms, the one field a reader outside the lane may read as a time. Every other clock in the entry is this process's monotonic clock and means nothing outside it."
   - The FOUR comment's last sentences (`:3369-3374`, from "Due children are sorted" to "id order.") become: "Due children are asked in `childReclaimAskOrder`'s order (L1). The presence lease's holder comes first: the senior presence-held child, asked on every pass it is due, so its ceiling is reachable however many children are due (spec §5.7). Then never-asked, `lastAskedAt`, `firstEligibleAt`, id, so a child that defers every pass cannot hog the one slot outside a lease, and a holder that forfeits goes to the back."
   - The first-sighting branch gains: "A birth this entry does not describe is a recycled slug's NEW workspace (spec §5.6): it starts from a first sighting, never from the old workspace's sighting or presence."
   - The request's comment (`:3405-3408`) ends: "…a CONTINUOUS episode whose latest answer's request is recent, measured in this lane's own pass intervals on the larger of its two clocks, its span on the monotonic clock."
   - The success callback gains: "`answered` is read FIRST, at the answer's arrival, never the pass's `asked`. The episode starts at its first answer's arrival, and continuity runs from this arrival back to the previous request (spec §5.7, "continuous deferral")."
   - The rejection callback gains: "A rejection is a defect the executor could not name (`reclaimChild` never throws for a condition it can name). It is written as a FAILED attempt. That ends the presence episode, so a licensed request that rejects is never followed by a second licence on the same episode. It forfeits a holder's lease. And it backs off, so a child whose every attempt rejects cannot hog the one slot. It is written only while the entry is still the live one, like the answer."
8. **The wave-4 plan**, appended after the file's last line (A17's; line 5533 at `334fb722a`) so that no wave-4 line moves, and carrying no `D-` token. Its heading occurs exactly once in that file (Step 7 checks it). Task 9c appends its A10/G2 bullet under this heading and leaves A10's own lines (wave-4 plan `:5293-5295`) untouched:
   > ## Post-merge corrections (wave 5, 2026-10-05)
   > Appended, never edited in place; the lines above stand as the record of what wave 4 ruled. Wave 5's Task 0b writes this section. A later wave-5 task (Task 9c) appends its own bullets below these and edits none of them.
   > - **A9 item 1, Continuity, "So under a backlog of three or more due children, presence-held children wait unlicensed until it drains. That fails closed, and is accepted."** The drain did not bound it: while three or more due children kept deferring, no presence-held child was ever licensed (review 258, G3). Replaced by: "The senior presence-held due child holds the lease and is asked on every pass it is due. The bound is three figures, never run together. From its lease's first ask, the holder is licensed within one ceiling, one pass spacing and one presence answer's latency: about 16.5 minutes at the spacing measured on 2026-10-05. One lease, from its first ask to the next lease's first ask, takes at most one ceiling, two pass spacings, a presence answer's latency and a reclaim's: about 18.6 minutes there. The k-th presence-held child in the ask order is licensed within k × (one ceiling + two gap bounds + the stall bound), k × 28 minutes: the worst case while a pass plus a presence answer stays within the gap bound, an answer settles before the next pass, no wall-clock step or suspend falls in the lease, and the lane's memory is not cleared. A violation of those forfeits the lease and fails closed: a holder whose answer does not continue its episode, or whose request is rejected or stalls, forfeits it, and the lane goes on. A presence-held child that does not hold the lease is asked only when the order reaches it."
   > - **The same item's "Why 2.5"** rested on "a pass lands one interval plus up to one 2 s tick after the last". Measured on 2026-10-05 over 94 sweep `ws-reclaim` intents, consecutive passes land 51.5–79.6 s apart (median 68.2 s). A child that sits out one pass is re-asked 119–161 s later (11% past 150 s), and one that sits out two passes 183 s or more later. Under the lease only non-holders see those gaps. The holder's gap is one pass plus its answer's latency.
   > - **Its lane case "three due children, passes 60 s apart … nothing is licensed"** is replaced by wave 5's L1: three presence-held children licensed in turn.
   > - **Lens 1's "presence can defer but never reset the ceiling"** is replaced by: "presence defers, and the ceiling bounds only a CONTINUOUS presence episode. An answer arriving more than 2.5 pass intervals after the previous answer's request (the larger of the monotonic and wall-clock differences), a licensed presence answer, or any other outcome restarts or ends it. Presence can restart the ceiling, never shorten it. Only a continuous, freshly observed episode spanning the ceiling on the monotonic clock sets `deferExpired`, and only the lease's holder is asked on every pass. The wait is the three figures of the A9 correction above, never run together: about 16.5 minutes from the lease's first ask to the holder's licence and about 18.6 minutes per lease at the 2026-10-05 spacing, and k × 28 minutes at worst for the k-th presence-held child in the ask order."
   > - **The lane's clock.** Wave 4's lane read one `Date.now()` per pass for everything. Wave 5's Task 0b moves every decision clock to the monotonic clock. `firstDeferredAt` alone stays wall-clock epoch ms.
   > - **The rejection arm.** Wave 4's lane left the entry untouched when an attempt rejected ("left for the next pass"). Wave 5's Task 0b writes it as a failed attempt.

#### Other tasks this amends (the amendment wins)
- **Task 3, Step 3, `CHILD_RECLAIM_STATUS_SENTENCE.sweepDeferred`** (plan:1245). Its value becomes: `'Reclamation of this workspace was put off, and the sweep retries it on its own. A wait on someone using it ends once the sweep has watched it continuously for 15 minutes, one such workspace at a time. Any other wait lasts until its cause clears.'`
  - The old "A wait on someone using it is bounded" is false on a slow box (residual 1), and a restart resets it (T4).
  - The new sentence names the condition that ends the wait, never a time by which it ends. So R4′'s prose at plan:65 and plan:869 ("promises no bound") stays true.
  - It is true only because Task 0b lands first (pre-flight F3).
- **Task 5, case 5's mock literal** (plan:1881-1884). Task 5's amendment (A-S3-9) prescribes it, once, and Task 0b carries no copy of it. Whatever the literal's form, its decision clocks must not read as epochs near `T_CLOSE`, so that a chip reading any of them as `at` would red the `at: T_CLOSE + 9_000` expectation; `firstDeferredAt` alone is an epoch.
- **Global Constraints** gains: "The sweep entry's decision clocks are the server's monotonic clock. `firstDeferredAt` alone is wall-clock epoch ms, and it is the only one of the entry's clocks that the chip reads (contract §8 R4′). The lane asks the presence lease's holder first (`childReclaimAskOrder`). A holder that cannot keep its episode continuous forfeits the lease. A rejected attempt is written as a failed one. An entry describes one workspace generation."
- **File Structure:** A2's one merged table (one row per file, naming every task that touches it) names Task 0b on each file under Files above; `server/src/server.ts`'s entry is `Deps.monotonicMs`. This task adds no row of its own.
- **`## Review lenses`, the SAFETY lens (R47).** It reads Task 0b with the corrected lens-1 sentence above, and must:
  - prove that `childReclaimAskOrder` only permutes `due`, adding no ask and relaxing no pacing;
  - prove that `presenceHeldSince` reaches no licence;
  - prove that every decision clock is monotonic, that `firstDeferredAt` alone is an epoch, and that `bornAt` is only compared for equality;
  - re-derive (a)–(c) with T1–T4 stated, including Lemma 0;
  - show that a PERSISTENT breach of T1 or T2, or a holder whose requests reject or stall, cannot hold the lease for ever, and state the bound on every other due child's wait (two asks per presence-held child ahead of it);
  - show that a rejected licensed request cannot be followed by a second licence on the same episode;
  - show that an entry never carries one workspace's observations to a recycled slug's next;
  - confirm that R254-P's SAFETY property survives in L3, P9 and P10.

  The figures the lens holds the bound to are (c)'s three, never run together: a holder is licensed within C + S + L_p (about 16.5 min live) of its lease's first ask; one lease, from its first ask to the next lease's first ask, is at most C + 2S + L_p + L_r (about 18.6 min live); and the k-th presence-held child in the ask order is licensed within k × (C + 2G + STALL) = k × 28 min, the worst case under T1–T4. The reviewer's probe runs A5's eleven modes, built independently of S1: A5's `transient-breach` is a transient breach of T1 or T2, not S1's `breach`, in which every licensed `p` answers presence. The lens's mutation re-checks map to these rows:
  - the shipped fairness order in place of the lease → L1, L2 and S2 (`watch.ts` keeps its inline `due.sort`), and P1;
  - every-other-pass leasing → L2 (a is licensed at its 9th ask, not its 16th);
  - no forfeit → L14, L16, P5, S1 `slow-persistent` and S2 `slow-persistent`;
  - rejection untouched → L15;
  - the wall clock alone in the gap → L6, P10 and S1 `back-hole`;
  - the monotonic clock alone in the gap → L7, P11 and S1 `suspend`;
  - the episode stamped at the request → P8 and L11;
  - `firstDeferredAt` stamped from the monotonic clock → P13, L12 and L13;
  - `presenceHeldSince` read by the licence → P6;
  - the generation reset dropped → P14 and L17.
- **Later tasks that read or extend the entry** build on Task 0b's signatures and never stamp a decision clock from wall time: Task 4b's verdict accessor (R41) reads no entry field, and Task 4d's `lastDeferWhy` (R44) is one more field, cleared by the rejection's `failed` arm like every other non-deferral. R44 keeps the feed shape of presence deferrals, so the holder writes one `child reclaim deferred` row per pass for up to about 15 minutes, as a lone child does today.

#### Residuals (named; R39 accepts them)
1. **Liveness rests on assumptions.** (c) rests on T1 and T2. On a box slow enough that a pass plus an answer exceeds 150 s, no presence-held child is licensed, exactly as a lone child today. Every holder forfeits on its first non-continuing answer, so every other due child is still asked. A transient violation costs the forfeiting holder its place. It fails closed and costs liveness only.
2. **The lease pauses other children.** While a lease runs, every other due child waits: about 18.6 min per presence-held child live, and at worst k × 28 min for the k-th in the ask order. This reshapes R-5a's fairness for one bounded tenure.
3. **A cleared memory restarts everything.** A raised pause, a lost capability, a pass-level fail-shut or a restart drops every lease and every episode, and the bound restarts from the next pass.
4. **Clocks.**
   - A backward wall step AND a suspend inside the same 150 s gap under-read both clocks, and hide that hole. So does a VM pause that stops both clocks and is never corrected on the wall clock.
   - NTP slew on the monotonic clock (at most 500 ppm) can over-read the span by up to about 0.45 s in 900 s.
   - Stamps compared with another process stay on the wall clock by necessity: the spawn-stall window against `dispatchStartedAt`, the generation fences, and the attention list.
5. **The monotonic origin is process-relative.** The entry must never be persisted or sent. Only the docstrings, L12 and L13 guard that; branded number types are not prescribed.
6. **A non-holder's wait can grow.** While new children keep being sighted, a non-holder's wait is bounded by the due set plus arrivals, not by a constant. This is the shipped never-asked-first order, now with one lease per arrival that answers presence.
7. **The breach case.** A licensed ask answering presence is impossible by construction today. If a future executor allowed it, the child would re-join at the back and be licensed at most once per ceiling. It never holds the lease for ever.
8. **A rejection now backs off.** A child whose executor rejects (a defect) is retried after 2, 4, 8 … pass intervals, up to the ceiling, rather than on every pass. It writes no feed row and journals nothing, as today; beside the console line, the chip's sweep-failing sentence shows it while the entry lives (Task 3 reads the entry's `consecutiveFailures`).
9. **A waiting member forfeits on its first holder answer.** This arises only after a T2 breach (Lemma 0). Its stale episode cannot continue, so it re-joins at the back. That costs liveness only, and it is accepted as built (R39): no one-ask grace for a new holder is added.
10. **The generation reset reads ccd's `create` `at`.** A server wall step that changes which `create` is "at or before now" flips the birth and resets the entry, which fails closed and costs two passes. While the mirror has not yet ingested a recycled slug's new `create`, the new minting run postdates the old birth, so R-5d's `minting-run-postdates-child` keeps the child ineligible and deletes the entry. The one exception is an old workspace that lived less than `CHILD_BIRTH_SKEW_MS`.

### A0c — NEW Task 0c: "ever coordinated" fenced to the workspace's current generation (R40). BLOCKING: after Task 0b, before Task 1

**Why.** The pre-flight's F5, design small-items' A-COORD, and design attention-visibility's replay. `ccrc-pwa-brisk-meadow` is skipped as `coordinating` on every pass, silently. It is marker 171, a review of run 148. Both runs are done, and it has no `.hold`. HEAD's `childReclaimSweepVerdict`, replayed with its measured inputs, answers `coordinating`. With that one input false, it answers eligible.

Re-measured read-only on 2026-10-05 (16:59Z, through `ccrc-api runs list`, `runs list --closed 1` and `lifecycle list --session`):
- **The runs list** names it `claimedBy` of program-leverage runs 10, 12, 14, 16, 18, 19, 28 and 30, all `done`. They closed between 2026-08-28T18:09:49Z and 2026-09-04T14:53:47Z; run 30's `closedAt` is 1788533627803. F5's "2026-08-21 to 08-29" is wrong, but its conclusion stands.
- **Its mirror** holds three `create done` rows, at 1787929585788, 1788954795103 and 1790413776948 (2026-09-26T09:09:36.948Z). Between them are a `reap` and a `destroy`.
- **So its current generation** was born three weeks after its id's last claim ended, and 9.8 s after run 171 opened.

The cause is `CoordStore.childReclaimCoordinatorIds()` (`server/src/coord/store.ts:3291-3320`). It is `SELECT DISTINCT claimedBy FROM runs WHERE claimedBy IS NOT NULL` plus every `reclaim:` displacement's `from`, with no time bound. That applies R37 per session id across every incarnation of a recycled slug. Yet R37's own words are "a WORKSPACE that has ever coordinated a run", and R6's premise is that slugs recycle. Of the 20 child markers in the registry at 16:59Z, brisk-meadow is the only id named `claimedBy` of any run. Displacement rows are not readable through the client. R40 rules the fence.

**Routing:** `opus`, effort `xhigh`. It is a SAFETY-lens item (R40), because it is the one change in this wave that widens which marked children may be taken.

**Deploy class:** server-only.
- **No schema or migration.** The read uses columns that already ship: `runs.claimedBy`, `runs.state`, `runs.closedAt` and `run_events.at`.
- **No wire field and no `ccd/`.**
- **Rollback.** A server rollback restores R37's unfenced reading. It does not restore a workspace reclaimed meanwhile; that workspace's commits stay pinned in the attic.
- **Live consequence.** Once the fleet converges, brisk-meadow is reclaimed within two sweep passes, unless a displacement row nobody could read names it after its birth.
- **Before landing (the coordinator, read-only).** Re-measure the population, because it drifts: 16 markers at the pre-flight, 19 at 15:58Z and 20 at 16:59Z. Task 10's Step 7 (A6) cites this re-measure and does not restate it. From the fleet box, invoking each binary by path:
  ```bash
  ls ~/.cc-sessions | sed -n 's/\.child$//p'
  ~/.local/bin/ccrc-api runs list
  ~/.local/bin/ccrc-api runs list --closed 1
  ~/.local/bin/ccrc-api lifecycle list --session <id>
  ```
  - List every marked child that any run, open or closed, names `claimedBy`.
  - Give each its current-generation birth (the latest `create done` row's `at`, placed as R-5d places it), its latest claim instant, and its class under the fence: `open`, `unplaced`, birth unplaced, kept (an instant at or after the birth minus `CHILD_BIRTH_SKEW_MS`), or would move.
  - A marked child is listed "would move" when at least one run names it `claimedBy`, every such run is terminal, and every `closedAt` falls before its current generation's `create` (from `ccrc-api lifecycle list`) minus `CHILD_BIRTH_SKEW_MS`. A marked child that no run names is not listed, because R40 does not change it; the one exception the API cannot see is the residual below.
  - Displacement rows are not on the client, and no read of the server's `coord.db` is made. So a child kept today only by a `reclaim:` displacement row naming it on the `from` side is invisible here. The list names it as its stated residual, "not listed: the API cannot read displacement rows", and does not over-list for it.
  - Record the list in the ledger, saying that its claims come from `claimedBy` only.
  - Tell the operator about any child other than brisk-meadow that would move.

**Entry conditions added:**
```bash
grep -n "  childReclaimCoordinatorIds(): ReadonlySet<string> {" server/src/coord/store.ts      # (0c-i) one line: the unfenced reader this task replaces
grep -c "childReclaimCoordinatorIds()" server/src/watch.ts server/src/coord/close.ts server/src/coord/childReclaim.ts
#   (0c-ii) watch.ts:1, close.ts:2, childReclaim.ts:2, in any order: the pass read; close's read and its warn line; the executor's step 2a and the release job's step 5
grep -n "childBornAt = childReclaimGeneration(coord.lifecycleCreatesFor(r.id), now)\[0\]?.at ?? null;" server/src/watch.ts   # (0c-iii) one line: R-5d's birth placement, which this task shares
```

#### The fence (R40, binding; it amends R37, R34's fifth condition, wave 4's R-1 condition 4 and R-5c, and wave 4's A9 item 3, A10 item 4 and A11)

A marked child has COORDINATED when its session id has a claim on record and any one of these holds. This one question is the sweep's `coordinating`, the close's `has-coordinated`, the executor's step-2a defer, and the release job's step-5 `changed`. That last one is R34's fifth condition, which R40 makes "has not coordinated in its current generation".
1. Some run naming it `claimedBy` is not terminal: `'open'`. "Any open run claiming the id keeps it."
2. Some terminal run naming it `claimedBy`, or some displacement row naming it, carries no readable instant: `'unplaced'`. That covers a NULL `closedAt`, and a `closedAt` or `at` that does not read as a positive safe integer (`unreadable-stamp-folds-unplaced`, ruling text in contract §11). "Anything unplaceable keeps the child."
3. Its current-generation birth cannot be placed (`bornAt === null`), or the comparison cannot be made (a non-number on either side).
4. Its claim's LATEST instant is at or after `bornAt − CHILD_BIRTH_SKEW_MS`, inclusive. A claim within the skew still counts, which is the protective direction.

**A claim's instant, per id,** is the greatest of:
- (a) the `closedAt` of every terminal run that names it `claimedBy` today;
- (b) the `at` of every `reclaim:` displacement row naming it as the `from`. Its claim ended there: the reclaim door rewrote every run of that programme off it, so no run names it any more;
- (c) the `at` of every such row naming it as the `to`. Its claim on a programme's already-terminal runs began there, after their `closedAt`. Without (c), an heir that took the chair of a finished programme after its own birth would read as never having coordinated. `reclaimProgram`'s `UPDATE` (`store.ts:1839`) rewrites terminal runs too, and the door at `server/src/coord/reclaim.ts:375` requires no open run. So (c) is what keeps R37's heir coverage under the fence.

**The birth** is R-5d's: `childReclaimGeneration(coord.lifecycleCreatesFor(id), nowMs)[0]?.at ?? null`, with wall-clock `nowMs`, placed by the one helper `childReclaimBornAt`. A claim that ended before the birth minus the skew belongs to an earlier workspace under the same slug, and keeps nothing. A claim that began in an earlier incarnation and ended after this one's birth counts, which over-protects in the fail-shut direction.

#### Why a recycled slug's later child is not a coordinator's workspace (the SAFETY lens re-derives this)
1. **A `done create` proves the earlier workspace was gone.** ccd journals a `done create` only at the end of `cmd_ws_add` (`_lc_done create "$id" …`, `ccd/ccd:7467`). Before that, `cmd_ws_add` refuses `slug in use` while any registry file for the id exists (`_ws_slug_free`, `ccd/ccd:6526`), or while the slug's git state is taken (`_ws_slug_git_state`). So a `done create` at B proves that no row of the id existed at B. The earlier incarnation's row and worktree were removed by `ws-reap`, `ws-rm` or a reclaim (for brisk-meadow, the reap of 2026-09-04 and the destroy of 2026-09-17).
2. **This incarnation's own coordination always counts.**
   - A run it opens as coordinator has `openedAt` ≥ B, so its `closedAt` ≥ B. On two clocks that agree within the skew, that is ≥ B − skew, so it counts.
   - A chair it takes as heir is dated at the displacement, which is ≥ B on two such clocks (residual 1 names when it is not).
   - Either claim, while open, is `'open'`.
3. **Every doubt keeps the child:** an open claim of any generation; a terminal claim with no readable instant; an unplaceable birth; a non-number on either side of the comparison; and an unreadable store, which keeps each consumer's existing unreadable answer.
4. **Every other conjunct still holds before any act.** That covers siblings, holds, the minting run and R-5d's fence, `review-report-live`, the twice-observed rule, the in-flight bound, the pause, presence, the executor's re-reads, and ccd's in-lock ladder with its WIP commit and attic pins. So uncommitted work is pinned before removal, exactly as for any reclaimed child.
5. **The population is unchanged.** It is still marker-only (rule 4): a coordinator's own workspace that was never minted as a child never enters it.

#### Interfaces (ONE fence, ONE store read, ONE birth placement)
- **L1** (`server/src/childReclaimSweep.ts`):
  ```ts
  /** One session id's coordinator claims, folded to what the generation fence reads. */
  export type ChildReclaimCoordinatorClaim = number | 'open' | 'unplaced';
  /** Has THIS incarnation of the workspace coordinated? (spec §1 rule 4; spec §5.6: slugs recycle.) */
  export const childReclaimCoordinated = (
    claim: ChildReclaimCoordinatorClaim | undefined, bornAt: () => number | null, skewMs: number,
  ): boolean => {
    if (claim === undefined) return false;
    if (claim === 'open' || claim === 'unplaced') return true;
    const born = bornAt();
    // Written so that a NaN on either side keeps the child: doubt keeps.
    return born === null || !(claim < born - skewMs);
  };
  ```
  - `bornAt` is a thunk, called only for a numeric claim. This follows the precedent of `childReclaimHoldRead`'s injected `openOf`. A session that never coordinated, which is the common close, never reads the lifecycle mirror for this question, and no `null` stands for "not read".
  - `ChildReclaimSweepInput.coordinating: boolean` (`:241-245`) becomes `coordinatorClaim: ChildReclaimCoordinatorClaim | undefined`, where `undefined` means no run ever named it and no displacement names it.
  - The verdict's `if (i.coordinating) return { eligible: false, why: 'coordinating' };` (`:367`) becomes `if (childReclaimCoordinated(i.coordinatorClaim, () => i.childBornAt, i.skewMs)) …`, at the same place: after `child-birth-unplaced` and the sibling checks. The fence is decided in L1. L4 hands in the raw claim and does not narrow it.
- **The store** (`server/src/coord/store.ts`):
  - `childReclaimCoordinatorClaims(): ReadonlyMap<string, ChildReclaimCoordinatorClaim>` replaces `childReclaimCoordinatorIds()`. The old method is deleted, so `tsc` names every caller.
  - **The runs read.** `SELECT claimedBy, CASE WHEN state NOT IN ${TERMINAL_RUN_STATES_SQL} THEN 1 ELSE 0 END AS open, CAST(closedAt AS TEXT) AS closedAtText FROM runs WHERE claimedBy IS NOT NULL`. This copies `programOpenRunCount`'s predicate (`store.ts:3606`), so `'unknown'` counts as open.
    - Each row is `'open'` when `open` is 1.
    - Otherwise it is `'unplaced'` when `closedAtText` is null or `persistedInt(closedAtText, 'closedAt')` fails.
    - Otherwise it is that value. This is `lastRunBySession`'s measured idiom (`store.ts:3341-3352`), because the schema is not STRICT and SQLite ranks TEXT above INTEGER.
  - **The displacement read.** `SELECT DISTINCT detail, CAST(at AS TEXT) AS atText FROM run_events WHERE causedBy = 'operator' AND substr(detail, 1, 8) = 'reclaim:'`. The case-sensitive selection is kept. There is no SQL `MAX`.
    - Each row's instant is `persistedInt(atText, 'run_events at')`'s value, or `'unplaced'` when that fails.
    - The instant is noted for every id `childReclaimDisplacedCandidates` returns, and for every id a NEW `childReclaimDisplacedHeirCandidates(detail: string): string[] | null` returns.
  - **The heir parser** sits beside the old one (`:1455`). It returns every suffix after each ` -> ` occurrence, overlapping ones included. It searches from the end, and each suffix is at most `CHILD_RECLAIM_MAX_SESSION_ID_CHARS` long. It answers `null` exactly when the `from` parser does, so over-protection stays the fail-shut direction.
  - **The fold, per id:** `'open'` over everything, then `'unplaced'` over any number, then the greatest number. An unparseable row THROWS, as now.
- **`server/src/coord/childReclaim.ts`:**
  ```ts
  /** R-5d's birth: the opening `create` of the session's CURRENT generation, on ccd's clock; null when unplaceable. The one placement the birth fence and the coordination fence share. */
  export function childReclaimBornAt(coord: Pick<CoordStore, 'lifecycleCreatesFor'>, sessionId: string, nowMs: number): number | null {
    return childReclaimGeneration(coord.lifecycleCreatesFor(sessionId), nowMs)[0]?.at ?? null;
  }
  /** THE reader for one session (spec §1 rule 4). Throws when a store read throws; each caller keeps its own unreadable answer. */
  export function childReclaimHasCoordinated(
    coord: Pick<CoordStore, 'childReclaimCoordinatorClaims' | 'lifecycleCreatesFor'>, sessionId: string, nowMs: number,
  ): boolean {
    return childReclaimCoordinated(coord.childReclaimCoordinatorClaims().get(sessionId),
      () => childReclaimBornAt(coord, sessionId, nowMs), CHILD_BIRTH_SKEW_MS);
  }
  ```
  `CHILD_BIRTH_SKEW_MS` is imported from `./childSpent.js`. `childSpent.ts` imports nothing from this file (its one import of `./store.js` is type-only), so there is no cycle.
- **Every consumer decides through the ONE fence,** `childReclaimCoordinated`, over the ONE store read and the ONE birth placement. The close, step 2a and step 5 call it through `childReclaimHasCoordinated`; the sweep calls it through its verdict.

#### Where it is read today, and what replaces each read

**The sweep pass.**
- HEAD: `coordinating = coord.childReclaimCoordinatorIds();` (`watch.ts:3113`), inside the pass-level try beside the mirror read, then `coordinating: coordinating.has(r.id)` (`:3281`).
- After 0c:
  - `claims = coord.childReclaimCoordinatorClaims();` in the same try;
  - `coordinatorClaim: claims.get(r.id)`;
  - `:3268` becomes `childBornAt = childReclaimBornAt(coord, r.id, now);`, so R-5d's fence, R40's fence and Task 0b's `bornAt` read one birth.
- Unreadable answer, unchanged: a throw fails the whole pass shut.

**The close.**
- HEAD: `hasCoordinated = deps.coord.childReclaimCoordinatorIds().has(sessionId);` (`close.ts:694`), and the warn at `:696`.
- After 0c:
  - `hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now());`. `CloseRunDeps` has no clock, and `closeRun` stamps `closedAt` from `Date.now()` too.
  - The warn reads `` `ccrc-server: the coordination fence (childReclaimHasCoordinated) failed at close ` ``, followed by its shipped tail.
- Unreadable answer, unchanged: `'unreadable'`, which becomes `siblings-unreadable`.

**The executor, step 2a.**
- HEAD: `coordinated = deps.coord.childReclaimCoordinatorIds();` … `if (coordinated.has(sessionId))` (`coord/childReclaim.ts:765-774`).
- After 0c: `if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)()))`, in the same try.
- Unreadable answer, unchanged: `deferred('siblings-unreadable', …)`.

**The release job, step 5 (R34's fifth condition).**
- HEAD: `coordinating = deps.coord.childReclaimCoordinatorIds();` … `if (coordinating.has(sessionId)) return 'changed';` (`coord/childReclaim.ts:1101-1109`).
- After 0c: `if (childReclaimHasCoordinated(deps.coord, sessionId, (deps.now ?? Date.now)())) return 'changed';`, in its try.
- Unreadable answer, unchanged: `'failed'`.

R40 amends R34's fifth condition to "has not coordinated in its current generation" (contract §11), so the hold-release job's step 5 is a consumer of the one fence, beside the close, step 2a and the sweep (`release-job-fourth-consumer`, ruling text in contract §11). Left unfenced, a recycled-slug child under a retired programme hold would be `hold-retired` to the sweep and `changed` to its own job on every pass, for ever: a new silent wedge.

#### Files
- **Source:**
  - `server/src/childReclaimSweep.ts`
  - `server/src/coord/store.ts`
  - `server/src/coord/childReclaim.ts`
  - `server/src/coord/close.ts`
  - `server/src/watch.ts`
  - `README.md`: one line, changed in place
- **Tests:**
  - `server/test/child-reclaim-sweep-policy.test.ts`
  - `server/test/coord-store.test.ts`
  - `server/test/child-reclaim-sweep.test.ts`
  - `server/test/child-reclaim-close.test.ts`
  - `server/test/child-reclaim-paused-at-server.test.ts`
  - `server/test/child-reclaim.test.ts`
  - `server/test/child-reclaim-generation.test.ts`

#### Steps (TDD, red first; ONE commit on the workspace branch, after Task 0b's)
1. **K-rows, red.** Move the 37 shipped references to the deleted method: 22 in `child-reclaim-paused-at-server`, 6 in `coord-store`, 4 in `child-reclaim-sweep`, 3 in `child-reclaim-close` and 2 in `child-reclaim`.
   - Spies and monkeypatches move to `childReclaimCoordinatorClaims`; a throwing replacement still throws. The release job's spy at `child-reclaim.test.ts:1166-1167` still observes step 5, because `childReclaimHasCoordinated` calls the method on the same store object.
   - `.has(x)` assertions stand, because a `Map` answers them.
   - `toContain('x')` on the old `Set` becomes `expect([...claims.keys()]).toContain('x')`.
   - The verdict-input rows move too:
     - `base()`'s `coordinating: false` (`child-reclaim-sweep-policy.test.ts:52`) becomes `coordinatorClaim: undefined`;
     - `coordinating: true` at `:178` and `:252` becomes `coordinatorClaim: 'open'`, with each row's expected `why` unchanged;
     - the policy suite gains `const SKEW_MS = CHILD_BIRTH_SKEW_MS` beside its `SKEW`, and reuses Task 0b's `BORN`.
   - The close, executor and release fixtures mirror no `create` row (measured: none of the three suites ingests a journal line). So their birth is unplaceable, and every shipped "has coordinated" case keeps its answer through fence item 3. K5b re-points the close's "EVER coordinated" case at a placed birth so that it pins item 4; K5c keeps the unplaceable shape as its own case.
   - The shipped lane case at `child-reclaim-sweep.test.ts:810` stays green: its claim closes at its own `create`'s instant, inside the skew. Its title becomes "a child whose CURRENT generation has coordinated a run is never reclaimed automatically". Other sections cite it by line, which does not move.
2. **L1:** the type, `childReclaimCoordinated`, and the verdict input.
3. **The store:** the method, the heir parser, the measured stamps and the fold.
4. **The helpers and the four consumers,** with close.ts's warn text above.
5. **Prose** (below).
6. **Run each suite alone, in the foreground (timeout ≥ 600000 ms), from `server/`:**
   ```bash
   ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts
   ./node_modules/.bin/vitest run test/coord-store.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim-close.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim-paused-at-server.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim.test.ts
   ./node_modules/.bin/vitest run test/child-reclaim-generation.test.ts
   ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
   ./node_modules/.bin/tsc --noEmit -p .
   grep -rn "childReclaimCoordinatorIds" server/ shared/ pwa/src   # prints nothing
   ```
   Then re-run the README citation cases Task 10 Step 3 names. A same-line README edit moves no anchor. Apply each mutation below, see its red, and revert it before the next.

#### Tests and their red mutations

**K1 — the fence, pure** (`child-reclaim-sweep-policy.test.ts`). B = 1790413776948 (brisk-meadow's measured birth) and SKEW = 120 000.

| Row | claim | bornAt | Expected |
|---|---|---|---|
| K1.1 never claimed | `undefined` | B | false |
| K1.2 open, birth placed | `'open'` | B | true |
| K1.3 open, birth unplaceable | `'open'` | null | true |
| K1.4 an unplaced claim | `'unplaced'` | B | true |
| K1.5 the recycled slug: brisk-meadow's measured values | 1788533627803 (run 30's `closedAt`) | B | false |
| K1.6 one ms outside the skew | B − SKEW − 1 | B | false |
| K1.7 the boundary | B − SKEW | B | true |
| K1.8 inside the skew | B − 100 000 | B | true |
| K1.9 this generation | B + 1 | B | true |
| K1.10 an unplaceable birth | B − 10 × SKEW | null | true |
| K1.11 laziness | `undefined`, `'open'`, `'unplaced'`, each with a `bornAt` thunk that throws | — | false, true, true; the thunk is never called |
| K1.12 a non-number | `NaN`; and separately B − 10 × SKEW with `bornAt` `NaN` | B; NaN | true; true |

Mutations:
- **R40's: drop the time bound** (`return born === null;`). K1.7, K1.8 and K1.9 answer false: a recycled slug whose CURRENT generation coordinated is reclaimed. Red.
- **Remove the fence**, which is R37's reading: `return true` after the `undefined` check. K1.5 and K1.6 answer true. Red.
- **Drop the `'open'` arm.** K1.2 answers false, because `!('open' < n)`'s comparison is false and `tsc` rejects it (TS2365). Red.
- **An unplaceable birth answers false.** K1.10 reds.
- **Drop the skew** (`!(claim < born)`). K1.7 and K1.8 red.
- **Make the boundary exclusive** (`!(claim <= born - skewMs)`). K1.7 reds.
- **Read the birth eagerly.** K1.11 throws. Red.
- **Restore the plain comparison** (`claim >= born - skewMs`). K1.12 answers false on both arms. Red.

**K2 — the verdict** (same file). `base()` takes `coordinatorClaim: undefined` in place of `coordinating: false`. Its `childBornAt` is `BORN` (`NOW - 3_600_000`).
- `coordinatorClaim: 'open'` gives `coordinating`;
- `BORN - SKEW` gives `coordinating`;
- `BORN - SKEW - 1` gives eligible.

Mutation: the verdict reads `i.coordinatorClaim !== undefined`. The last row answers `coordinating`. Red.

**K3 — the store** (`coord-store.test.ts`). A new describe, "CoordStore.childReclaimCoordinatorClaims — the latest instant per id". The case-sensitivity describe at `:2920` moves onto the new method: `RECLAIM:x -> y` adds neither `x` nor `y`.

| Row | Shape | Mutation → red |
|---|---|---|
| (a) | A run closed at 1 000 and an open run, both claimed by X: `'open'`. | Fold `'open'` below a number. |
| (b) | Two terminal runs, closed at 1 000 and 5 000: 5 000. | MIN for MAX. |
| (c) | A terminal run whose `closedAt` was set NULL by direct SQL: `'unplaced'`, also beside a run closed at 5 000. | Skip a null `closedAt` row: 5 000. |
| (d) | A row whose state was set to `'unknown'` by direct SQL: `'open'`. | Classify open by enumerating the live states: `'unknown'` reads terminal. |
| (e) | X's run closed at c, then `reclaimProgram(run, 'Y', d, null)` with d > c: X gives d, Y gives d. | Drop the `to` side: Y gives c. Drop the `from` side: X is absent. |
| (f) | An unparseable `reclaim:` row throws, as before. | — |
| (g) | A `closedAt` set to `'x'` by direct SQL: `'unplaced'`, also beside a run closed at 5 000. | Read `closedAt` raw, without the CAST and `persistedInt`: the fold answers a string or 5 000. |
| (h) | A `reclaim:` row whose `at` is set to `'x'` by direct SQL: its `from` and its `to` are both `'unplaced'`. | Read `at` raw: neither is `'unplaced'`. |

**K4 — at the lane** (`child-reclaim-sweep.test.ts`). The shipped `fixture` mirrors a `create` row on each `plant` at the fixture clock, and `journal(id, 'done', null, 'create')` mirrors one more. Task 0b's `advance` moves both clocks.
- **K4a, brisk-meadow's shape.** Open demo-a's minting run r1. A coordinator run claimed by demo-a is abandoned at T0, and an earlier-generation `create` for demo-a is journaled at T0. Then `advance(CHILD_BIRTH_SKEW_MS + 1)`, abandon r1, and `plant('demo-a', { child: String(r1.id) })`, which mirrors the current generation's `create`. Two passes give exactly one request.
  - Mutation: the sweep reads the birth from the EARLIEST create (`lifecycleCreatesFor(id)[0]?.at`). Red.
  - Mutation: `coordinatorClaim` is folded to `'open'` whenever a claim exists. Red.
- **K4b, a recycled slug whose CURRENT generation coordinated.** As K4a, plus a run claimed by demo-a, opened and abandoned after the plant. No request; the verdict is `coordinating`. Mutation: R40's own, drop the time bound. The child is reclaimed: red.
- **K4c, an open claim.** As K4a, plus a run claimed by demo-a left open. No request. Mutation: drop the `'open'` arm. Red.
- **K4d, the skew boundary, both sides.**
  - As K4a with `advance(CHILD_BIRTH_SKEW_MS)`: no request.
  - With `advance(CHILD_BIRTH_SKEW_MS + 1)`: one request.
  - Mutations: drop the skew, or make the boundary exclusive; either way the first fixture reclaims. Red.
- **K4e, an heir after the birth.** A programme whose only run, claimed by demo-old, closed at T0. demo-a's current generation is planted at T0 + SKEW + 1, then `coord.reclaimProgram(run, 'demo-a', f.now(), null)`. No request. Mutation: drop the `to` side. The child is reclaimed: red.
- **K4f, displaced before the birth.** A run claimed by demo-a, then `reclaimProgram(run, 'demo-heir', T0, null)`. demo-a's current generation is planted at T0 + SKEW + 1. One request. Mutation: read the `from` side without its `at`, as an unconditional member (R37's reading). Red.
- **An unplaceable birth** never reaches the fence at the lane, because `child-birth-unplaced` returns first (`childReclaimSweep.ts`, R-5d). K5c and K6 cover it on the per-session path.

**K5 — the close** (`child-reclaim-close.test.ts`). `vi.spyOn(Date, 'now')` drives `closedAt`, the mirrored `create` and the generation pick. A `create` is mirrored with the sweep suite's idiom: `coord.ingestJournal` of one parsed `create done` line.
- **K5a, brisk-meadow's shape.** The claim closes before the birth minus the skew, and a mirrored `create` follows. The final close answers `queued`, not `has-coordinated`. Mutation: close.ts reverts to `childReclaimCoordinatorClaims().has(sessionId)`. Red here, and in K8.
- **K5b.** The shipped "EVER coordinated" case (`:226-241`) gains a mirrored `create` BEFORE the heir run's close, and answers `has-coordinated`. Mutation: drop the time bound. Red.
- **K5c, an unplaceable birth.** The shipped shape: no `create` row and an old claim give `has-coordinated`. Mutation: an unplaceable birth answers false. Red.
- **K5d, a session that never coordinated, with `lifecycleCreatesFor` throwing:** `queued`. Mutation: read the birth eagerly. The close answers `siblings-unreadable`. Red.
- **The two shipped throw cases** (`:244-262`) move to the new method, and their answers stand.

**K6 — the executor** (`child-reclaim-paused-at-server.test.ts`). `deps.now` drives the generation pick, and the claim's real `closedAt` is read back from the store.
- **K6a, brisk-meadow's shape, with the switch raised:** `deferred paused-at-server`. That proves step 2a passed. Mutation: step 2a keeps an unfenced key-set read. The answer is `siblings-open`. Red.
- **K6b, a claim after the birth:** `deferred siblings-open`, `'demo-a has coordinated run(s)'`. Mutation: drop the time bound. Red.

**K7 — the release job** (`child-reclaim.test.ts`, `rrig`). An `RID` claim ends before a mirrored `create`, and the row holds `holdReason('demo', 2, null, null)` against a terminal run. The answer is `released`. Mutation: step 5 keeps an unfenced key-set read. The answer is `changed`. Red. `rrig`'s docstring "the job never reads either" becomes "…reads the mirror only to place the birth of a session that has coordinated".

**K8 — one fence, one read, one placement** (`child-reclaim-generation.test.ts`, its "one implementation each" describe). Scans run over `server/src` unless a bullet says otherwise:
- `childReclaimCoordinated` is defined once, in `server/src/childReclaimSweep.ts`.
- `childReclaimBornAt` and `childReclaimHasCoordinated` are each defined once, in `server/src/coord/childReclaim.ts`.
- `.childReclaimCoordinatorClaims()` is called only in `server/src/coord/childReclaim.ts` and `server/src/watch.ts`.
- The token `childReclaimHasCoordinated(` occurs exactly four times: three in `server/src/coord/childReclaim.ts` (the definition, step 2a, step 5) and one in `server/src/coord/close.ts`. Comments name it without the parenthesis.
- `childReclaimGeneration(coord.lifecycleCreatesFor` occurs exactly once, in `server/src/coord/childReclaim.ts`, inside `childReclaimBornAt`. `watch.ts` places the birth only through `childReclaimBornAt(coord, r.id, now)`.
- No file under `server/` (src or test) names `childReclaimCoordinatorIds`.

Mutations: close.ts calls the store read itself, or watch.ts keeps its own birth spelling. Red.

#### Prose, in the same commit

Committed comments cite the spec, never the contract or a ruling number (contract §8 R23).
- **`store.ts`, the new method's docstring**, replacing `:3221-3290`:
  > Per session id, the LATEST instant it held a coordinator's chair. This is what the coordination fence reads (spec §1 rule 4, with spec §5.6's recycled slugs: "ever coordinated" means this incarnation of the workspace).
  > - `'open'` while any run naming it `claimedBy` is not terminal. This is `programOpenRunCount`'s predicate, copied, so `'unknown'` counts as open.
  > - `'unplaced'` when none is open but a claim carries no readable instant: a terminal run with no `closedAt`, as a reconstructed or legacy row has, or a `closedAt` or displacement `at` that does not read as a positive safe integer (CAST and proven, `lastRunBySession`'s idiom, because the schema is not STRICT).
  > - Otherwise, the greatest of: each terminal run's `closedAt` that names it today; and the `at` of every `reclaim:` displacement row naming it on EITHER side. The `from` side (`childReclaimDisplacedCandidates`) is a claim that ended at that instant, which no run names any more. The `to` side (`childReclaimDisplacedHeirCandidates`) is a claim on already-terminal runs that began then, after their `closedAt`.
  >
  > The parsers' extra readings over-protect, which is the fail-shut direction. An unparseable row THROWS. An id absent from the map has never held a chair. The residual is unchanged: a lost or rebuilt `coord.db` loses this history, and every minting run with it.

  The `:1428` comment's "the one reader, `childReclaimCoordinatorIds`" names `childReclaimCoordinatorClaims`.
- **`ChildReclaimSweepInput.coordinatorClaim`**, replacing `:241-244`: "This session's coordinator claims, folded (`CoordStore.childReclaimCoordinatorClaims`), or `undefined` when it never held a chair. The verdict fences them to this workspace's own generation (`childReclaimCoordinated`, with `childBornAt`), through the SAME function the close, the executor and the hold-release job use, so none can disagree."
- **The verdict's comment** (`:364-366`): "A child whose CURRENT incarnation has coordinated a run (spec §1 rule 4: manual cleanup is reserved for a coordinator's own workspace) is never reclaimed automatically. That covers an open or unplaceable claim, and one that ended at or after this generation's birth less the skew. A claim that ended before this workspace existed belongs to an earlier workspace under the same slug (spec §5.6), destroyed before ws-add could create this one."
- **Elsewhere,** each of these says "has coordinated in its own generation (`childReclaimHasCoordinated`)" in place of "EVER been named `claimedBy`": the close's comment (`close.ts:681-691`), the executor's step 2a (`coord/childReclaim.ts:754-764`), the release job's step 5 (`:1100`), `ChildReclaimDecisionInput.hasCoordinated` (`:388-399`), and the sweep's pass-read comment and its catch (`watch.ts:3099-3107`, `:3123-3126`). In `:388-399`, "the heir side is already covered by being `claimedBy` itself" becomes "the heir side is dated by its displacement, because its claim on already-terminal runs began after their `closedAt`".
- **`README.md:3889`:** "…no hold and no coordination history," becomes "…no hold and no coordination since its workspace was created,". It is the same line, so no README anchor moves.
- **Contract text is the coordinator's.** R40 becomes contract §11, and it names R34's fifth condition and R37 as amended, with the hold-release job's step 5 a consumer of the one fence. R34 and R37 in §10 stay as history.

#### Other tasks this amends (the amendment wins)
- **Task 2b's kept sentence for `coordinating` and Task 4b's log line** (A-S3-3, A-S3-6). R41's verdict accessor (Task 4b) carries the fenced `coordinating`. After Task 0c that word names only an open claim, an unplaceable claim, or a claim that ended at or after this generation's birth less the skew. Neither text may say "ever"; as A-S3-3 and A-S3-6 write them, neither does.
- **R42's "`has-coordinated` becomes the sweep's `coordinating`"** reads the same fence, through this task's one reader.
- **Global Constraints:** A2's bullet carries this task's consumption, in R40's words: "consumed: R35; R34 and R37 as R40 amends them". This task adds no second Global Constraints line.
- **File Structure:** A2's one merged table names Task 0c on each file under Files above, beside Task 0b where both touch a file. This task adds no row of its own.
- **Task 10, before landing:** Step 7 (A6) cites the coordinator's read-only re-measure under "Deploy class" above, and does not restate it.
- **The SAFETY lens (R47)** reads Task 0c and must:
  - re-derive the safety argument above against `cmd_ws_add`'s refusals;
  - confirm the fence's direction: claims within the skew count; an unplaceable birth, an open claim, an unplaced claim and a non-number each keep the child;
  - confirm that the `to` side keeps R37's heir coverage, that the release job reads the same fence, and that no consumer reads the store's claims except through `childReclaimCoordinated`;
  - state residual 1 as worded below.

#### Residuals (named)
1. **Clock offsets.** The fence compares ccd's `create` `at` with the server's `closedAt` and displacement `at`. An offset between the two clocks at those instants beyond `CHILD_BIRTH_SKEW_MS` makes the child reclaimable. Such an offset can be a sustained skew between the boxes, or a step of either box's wall clock: a server stepped back after the birth, or a fleet box stepped forward at the `create`. Under it, a claim this generation ended within that excess after its birth reads as before it.

   The same holds for an heir chosen while its own `ws-add` has not yet journaled `create done`. The reclaim door reads `const now = Date.now();` (`reclaim.ts:298`) before its awaits, and `cmd_ws_add` writes the registry row before its unbounded `.ccrc/workspace.sh` and its `_lc_done create` (`ccd/ccd:7401-7467`).

   Reaching either needs a coordinator claim that ended, or a chair taken, within minutes of the workspace's own creation. It is fail-open, the same direction R-5d's birth fence names.
2. **Mirror lag fails closed.** A new generation's `create` not yet ingested makes the previous generation's `create` read as the birth, so more claims count. With no `create` at all the birth is unplaceable, and the child is kept.
3. **A lost or rebuilt `coord.db`** loses the claim history, as R37's reader already did. Every minting run is then absent too, so the sweep never reaches eligibility (`minting-run-absent`), and the close has no run to close.
4. **The parsers over-protect.** A session whose id equals an extra reading of an ambiguous displacement row is kept, as today. So is a session whose claim began in an earlier incarnation and ended after this one's birth.
5. **A window between reads.** A claim the current generation takes after the executor's step-2a re-read but before ccd's lock is not seen. ccd's ladder knows nothing of coordination. This window is unchanged from R37's.
6. **The reachable population widens.** Measured at 2026-10-05T16:59Z: brisk-meadow alone, of 20 markers, by `claimedBy` (displacement rows unread). Every future child minted on a slug a coordinator once wore joins it. The coordinator re-measures before landing.

### S3 — the chip and what the sweep decides, made visible (R41, R42, R43, R44)

This section amends the plan for the chip and visibility rulings. It covers:
- R41 to R44, as contract §11 states them, with the open-issue rulings that amend them;
- the anchors lens's A-iface-1, -2, -4 and -6, and its minor findings A-iface-7 to -14;
- the contract lens's F4, F6, F7, F8, the server half of F9, and F16.

The A-sections carry the ids `A-S3-1` to `A-S3-14`. They are not renumbered, so other sections' references to them hold. Code citations are to `334fb722a`. They are snapshots: a worker locates code by its content.

**Order.** This section assumes Task 0b (R39) and Task 0c (R40) come first.
1. Task 1, with A-S3-1's L0 and L1 inserts in the same commit, so the S6-R11 repair is paid once.
2. Task 2, amended (A-S3-2).
3. **NEW Task 2b** (A-S3-3): the skip table, the two pre-lock tokens and the failure line (R41's classes, R43). It is L1 and comes before Task 3, which imports all three.
4. Task 3, amended (A-S3-4).
5. Task 4, re-anchored (A-S3-5).
6. **NEW Task 4b** (A-S3-6): `currentChildReclaimVerdicts()`. BLOCKING for Tasks 4c and 5.
7. **NEW Task 4c** (A-S3-7): the attention list's kept arm, its collapse, the kept feed row, and no failing item for a held child.
8. **NEW Task 4d** (A-S3-8): feed rows de-duplicated (R44). It comes after Task 0b, whose entry it extends.
9. Task 5, amended (A-S3-9).
10. Task 6 (the glyph's name), then **NEW Task 6b**, the banner's many-children line (A-S3-10).
11. Task 8, amended (A-S3-11).
12. Task 9: routing only (A-S3-12). Its title text is S4's (R45).

A-S3-13 records R42. A-S3-14 carries:
- this section's rows for the entry conditions, its entries in A2's merged File Structure table, `## Deviations found` and the review lenses;
- the spec §5.9 facts that this section's code comments cite, which the coordinator's docs commit writes.

**Where this section departs from the attention-visibility design, and why.**
- **No phase split.** The design moved the gather and the verdict above the reclaim switch (its option A). R41 instead rules that the verdict accessor "is cleared wherever the defers are cleared", and that a pause "keeps kept verdicts … and clears only the transient ones". So:
  - a verdict is recorded in the per-child loop exactly where it is reached today (`watch.ts:3278-3282`, `const v = childReclaimSweepVerdict({`);
  - nothing moves above the switch;
  - a pass that judged nothing reduces the recorded map to its kept verdicts (A-S3-6).
- **Not in this wave: ccd's journaling of the audit-time `unmeasured`, `probe-unmeasured` and the pre-lock argv and `python3` dies** (the design's A-SV3). R38 and R43 give it to wave 6, and wave 5 touches no `ccd/` file. Until then, the chip's sweep-failing row (A-S3-4) is how those children are seen.
- **Code comments cite the spec, never the contract (R23).** Every docstring below cites plain `spec §5.9`. A-S3-14 lists the §5.9 facts those comments rely on. The coordinator's docs commit writes them, in the same docs PR as contract §11, merged before dispatch. No task in this section edits the spec.

**Contract text this section amends.** Contract §11 carries these amendments, with R41 to R44:
- **Contract R5** ("from the mirror ONLY"). The new text is in A-S3-7.
- **Contract §4's `ChildReclaimAttention`.** It becomes four arms: `terminal`, `failing`, `kept` and `kept-many`. `token` and `at` are carried by the two mirror arms only (A-S3-1).
- **Contract §5's chip inputs.** They gain four inputs:
  - the sweep's last verdict;
  - whether the sweep's in-memory entry is in a run of failed attempts;
  - when this generation's unbroken run of failure lines began, set only once that run has lasted the ceiling;
  - the composer's clock.
- **Contract §5's mapping.**
  - A `kept` verdict reads `refused`.
  - A `doubt` or `held` verdict reads `deferred`.
  - "Not judged yet" has its own sentence and never reads as eligible.
  - The order is: a done reclaim, a gone answer and a terminal refusal first; then the verdict; then every other event.
  - This amends R21's "the latest event decides" for those other events only (A-S3-4).
- **R7's switch row.** A kept answer is never replaced by the switch. Under a pause the kept verdict is retained, so the chip still says it.
- **R16′.** The review rows answer only after a non-ordinary verdict has had its say. A review child whose reviewed run is gone from the database reads `refused`, with `reviewed-run-absent`'s sentence.
- **R20's attention listing.** A failure run is made of `failed` lines plus the two pre-lock refusals (R43). A kept child's failing item is replaced by its kept item. A child whose last judged verdict is `held` has no failing item; with no verdict recorded (a restart, or a pass that judged nothing), the listing stands as wave 4 shipped it. A terminal item always stands (A-S3-7).
- **R43, by name.** Exactly `flock-unavailable` and `lock-unopenable` are failure lines. A token ccd journals under `reclaim` later is never inherited unclassified: wave 6 classifies each new one, in `CHILD_RECLAIM_PRE_LOCK_TOKEN` or in the kind map, `CHILD_RECLAIM_TOKEN_KIND` (A-S3-3).
- **Spec §5.9's "one feed row per outcome"** becomes R44's de-duplicated rule (A-S3-8).
- **The wave-4 pre-flight's R-11.** It is corrected in A-S3-3.
- **Accepted slugs.** Four departures this section records are ruling text in §11 and take no deviation number: `not-a-workspace-removes-the-marker` (A-S3-3), `rebuild-sentence-before-the-ending` (A-S3-3), `verdict-outranks-retry-events` (A-S3-4) and `kept-replaces-failing-on-the-banner` (A-S3-7).

### A-S3-1 — Task 1: the kept vocabulary and the attention list's four arms in L0 (same commit, one S6-R11 repair)

**Why.**
- R41 puts the six kept words on the Runs attention list. That list is a wire type: `CoordStatus.childReclaimAttention` (`shared/api.ts:3817`), whose item is `{ sessionId; runId; token: string; sentence; at: number }` (`shared/api.ts:3793-3799`).
- A kept child has no ccd token and no ccd clock, so the shipped shape cannot carry it.
- R41's lost-database collapse is one line that names many sessions, which the shape cannot carry either.

`shared/api.ts` is a CITED file: `README.md:4586-4587` anchors `shared/api.ts:7684-7686`, `:7726`, `:7734` and `:7747`. Every insert below lands above those anchors. So all of them ride Task 1's commit, and Task 1 Step 6 makes ONE repair for the plan's insert and these together.

The anchors lens's A-iface-9 (Task 1's text and line hints) is folded in here.

**Binding text.**

1. **The kept vocabulary.** In `shared/api.ts`, insert this directly ABOVE the docstring that begins `/** One child the fleet-level attention item reports` (`shared/api.ts:3771`):
   ```ts
   /** The sweep's words for a marked child that automatic reclamation will never
    *  take on its own (child-reclamation spec §5.9). Each ends only by a person's
    *  act, or by restoring the coordination database. Spelled ONCE, as the keys of
    *  a total table, and the runtime list is derived. The SERVER's sweep answers
    *  them and composes their sentences (`server/src/childReclaimSweep.ts`). The
    *  PWA renders sentences and never switches on a word. */
   export type ChildReclaimKeptWord =
     | 'coordinating' | 'minting-run-absent' | 'minting-run-postdates-child'
     | 'child-birth-unplaced' | 'reviewed-run-absent' | 'not-a-workspace';
   const CHILD_RECLAIM_KEPT_WORD_TABLE: Readonly<Record<ChildReclaimKeptWord, true>> = {
     coordinating: true, 'minting-run-absent': true, 'minting-run-postdates-child': true,
     'child-birth-unplaced': true, 'reviewed-run-absent': true, 'not-a-workspace': true,
   };
   export const CHILD_RECLAIM_KEPT_WORDS: readonly ChildReclaimKeptWord[] =
     Object.keys(CHILD_RECLAIM_KEPT_WORD_TABLE) as ChildReclaimKeptWord[];
   /** Use THIS, never `.includes(x as ChildReclaimKeptWord)`: `isRunState`'s rule. */
   export function isChildReclaimKeptWord(v: unknown): v is ChildReclaimKeptWord {
     return typeof v === 'string' && (CHILD_RECLAIM_KEPT_WORDS as readonly string[]).includes(v);
   }
   /** One child inside a collapsed kept line (`kind: 'kept-many'`). */
   export interface ChildReclaimKeptMember { readonly sessionId: string; readonly runId: number }
   ```
2. **The four arms.** Replace `export interface ChildReclaimAttention { … }` (`shared/api.ts:3793-3799`) with:
   ```ts
   export type ChildReclaimAttention =
     | { readonly kind: 'terminal'; readonly sessionId: string; readonly runId: number | null;
         readonly token: string; readonly sentence: string; readonly at: number }
     | { readonly kind: 'failing'; readonly sessionId: string; readonly runId: number | null;
         readonly token: string; readonly sentence: string; readonly at: number }
     | { readonly kind: 'kept'; readonly sessionId: string; readonly runId: number;
         readonly word: ChildReclaimKeptWord; readonly sentence: string }
     | { readonly kind: 'kept-many'; readonly word: ChildReclaimKeptWord;
         readonly members: readonly ChildReclaimKeptMember[]; readonly sentence: string };
   ```
   Rewrite its docstring so it says all of the following. It states the wave's end state; Tasks 2b and 4c build the parts it names. The wording is the worker's; every fact is binding.
   - There are FOUR arms.
   - `terminal` and `failing` are derived from the lifecycle mirror by EVERY sweep pass. A `failing` item's run of failures is made of `failed` lines, plus `refused` lines whose token is one of the two pre-lock tokens (`flock-unavailable`, `lock-unopenable`). Those are pre-lock dies that the server retries.
   - `kept` and `kept-many` come from the sweep's last JUDGING pass over durable state: the registry listing, coord.db and the mirror. They are kept as they are, never erased, across a pass that judged nothing.
   - A child has at most one item. A `kept` item replaces a `failing` item for the same child. A child whose last judged verdict is `held` has no `failing` item; with no verdict recorded, the failing arm lists it as before. A `terminal` item stands, and that child gets no kept item.
   - `at` exists only on the two mirror arms, and it is ccd's clock. A kept item carries no time, because its condition is durable and nothing this read holds dates it. `ingestedAt` is still never an event time.
   - `kind` is ADDITIVE. An older server's items carry no `kind`, and the PWA's one reader reads such an item as it always did.
   - A `kept-many` item has no `sessionId`. An older PWA bundle's reader drops it under its own malformed-member rule. That is the accepted cost.
3. **L1, the minimum to compile.** In `server/src/childReclaimSweep.ts`:
   - directly above `childReclaimAttention`'s docstring, add `export type ChildReclaimJournalAttention = Extract<ChildReclaimAttention, { readonly kind: 'terminal' | 'failing' }>;`;
   - `childReclaimAttention` (`:637-660`) returns `ChildReclaimJournalAttention[]`, and its `out` is typed the same;
   - the terminal push gains `kind: 'terminal'`, and the failing push gains `kind: 'failing'`.

   Nothing else in L1 changes in this task. The narrowed return type is what keeps the policy suite's `.map((a) => [a.token, a.sentence])` (`child-reclaim-sweep-policy.test.ts:715-718`) compiling.
4. **The PWA, the minimum to compile.** In `pwa/src/fleet/childReclaimWords.ts`, change
   `type RenderedAttention = Pick<ChildReclaimAttention, 'sessionId' | 'runId' | 'sentence'>;`
   to
   `type RenderedAttention = Pick<Extract<ChildReclaimAttention, { readonly sessionId: string }>, 'sessionId' | 'runId' | 'sentence'>;`.
   A union member with no `sessionId` makes the old `Pick` a TS2344. `isAttention` is unchanged.
5. **Tests.** Two kinds of edit are owed: `typecheck-tests` names the property reads, and the suites name the expectations.
   - **Runtime expectations, which only a run reds.** Each attention item literal gains its `kind`:
     - `server/test/child-reclaim-sweep-policy.test.ts:645` and `:671` (`'terminal'`), and `:691` (`'failing'`);
     - `server/test/child-reclaim-sweep.test.ts:1205`, `:1233`, `:1251` (the `item` const), `:1277` and `:1414` (`'terminal'`), and `:1341` (`'failing'`).

     Before the edit, those nine `toEqual`s red at runtime (a missing `kind`). An empty `childReclaimAttention: []` needs no edit.
   - **Property reads on the union (TS2339), which `typecheck-tests` names.**
     - `child-reclaim-sweep.test.ts:868`, `:879`, `:1324` and `:1364` (`.map((a) => a.sessionId)`) become `.flatMap((a) => ('sessionId' in a ? [a.sessionId] : []))`.
     - `:1303` (`.map((a) => a.token)`) becomes `.map((a) => (a.kind === 'terminal' || a.kind === 'failing' ? a.token : null))`.
     - `:1365` and `:1384` read `sentence`, which every arm carries, and need no edit.
   - **The PWA banner suite.** In `pwa/test/child-reclaim-banner.test.tsx`, the `item` builder (`:30`) becomes `const item = (over: Partial<Extract<ChildReclaimAttention, { kind: 'terminal' }>> = {}): Extract<ChildReclaimAttention, { kind: 'terminal' }> => ({ kind: 'terminal', sessionId: …, ...over });`, with its other defaults unchanged.
6. **Step 6(a) reads one shift count.** The four README anchors now move by the total number of lines this commit inserts above them: Step 3's insert, this one, and the union's net growth. The "same count for all four" check still holds, because every insert sits above all four. Step 6(d)'s comment names both inserts: the chip vocabulary, and the kept vocabulary with the attention list's arms.
7. **A-iface-9.**
   - Change plan:373's sentence to: "`toRunSummary` needs no edit. It is a spread that strips `prLineage`, `coordProject`, `sessionBornAt` and `sessionBornFor` (`store.ts:155-159`), and the new key rides through it."
   - Refresh these hints as of `334fb722a`, still marked as hints:
     - `export interface RunSummary` is at `shared/api.ts:5736`, and its last member, `health: RunHealth;`, at `:5867`;
     - `hydrateRun`'s `health,` is at `store.ts:3727`, after the comment beginning `// F7. Passed IN rather than measured here`;
     - README's anchors are at `README.md:4586-4587`;
     - the census entry `'shared/api.ts': 1` is at `session-hook.test.ts:8493`, with the sum `.toBe(197)` at `:8641`.
8. **Step 7 runs these too:**
   - `cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts test/child-reclaim-sweep.test.ts`
   - `cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx`
   - the PWA's `tsc`

   `child-reclaim-wire` now reads 4/4.

**Tests (red first).**
- `server/test/child-reclaim-wire.test.ts` gains the case "the kept words are the six the sweep never takes on its own, derived from one table". It asserts:
  - `[...CHILD_RECLAIM_KEPT_WORDS].sort()` equals `['child-birth-unplaced', 'coordinating', 'minting-run-absent', 'minting-run-postdates-child', 'not-a-workspace', 'reviewed-run-absent']`;
  - `isChildReclaimKeptWord('coordinating')` is true;
  - `isChildReclaimKeptWord('held')` is false.

  **Mutation** (added to Step 8's table): delete `'not-a-workspace': true,` from `CHILD_RECLAIM_KEPT_WORD_TABLE`. The case reds with `expected [ 'child-birth-unplaced', …(4) ] to deeply equal [ 'child-birth-unplaced', …(5) ]`, and `tsc` reports TS2741.
- `pwa/test/child-reclaim-banner.test.tsx` gains the case "an item from a server older than the arms (no `kind`) still renders its sentence".

  **Mutation:** make `isAttention` also require `o.kind === 'terminal' || o.kind === 'failing' || o.kind === 'kept'`. The item is dropped, and the case reds.

**Routing.** `sonnet`, effort `high`, raised from `medium` (R47's floor for implementation).

**Deploy class.** L0, so server + pwa. It is additive on the wire, and `FLEET_PROTO` is unchanged.

### A-S3-2 — Task 2: build on the shipped `reviveLifecycleRow`, and place the read after `childReclaimSessionIds()` (A-iface-1, BLOCKING)

**Why.** Task 2 extracts a row mapper (`LcRowDb` plus `private static toMirrored`) and refactors `lifecycleFor` onto it. Wave 4 already shipped exactly that extraction:
- `lifecycleFor` ends `return rows.map((r) => CoordStore.reviveLifecycleRow(r));` (`store.ts:5572`);
- `private static reviveLifecycleRow(r: {…}): MirroredLifecycleEvent` (`store.ts:5607-5639`) is documented as "The reviver `lifecycleFor` and `lifecycleCreatesFor` share".

The plan's Find text `return rows.map((r) => ({ … }));` no longer exists. Read literally, the plan either fails to apply, or adds a second mapper whose docstring falsely claims to be "THE ONE place a mirror row becomes the wire event".

"Directly after `lifecycleFor`" is also ambiguous now: `lifecycleCreatesFor`, `reviveLifecycleRow` and `childReclaimSessionIds()` sit between it and `lifecycleGaps`.

**Binding text.** This supersedes Task 2's Files bullet and Step 3 where they differ.

- **Delete these from the plan:**
  - Step 3's first two code blocks: the module-level `LcRowDb` interface and `private static toMirrored`;
  - the sentences "In `lifecycleFor`, replace the inline row type…" and "Replace the whole `return rows.map…`";
  - the Files bullet's "Add a module-level `LcRowDb`… Add `private static toMirrored`, and refactor `lifecycleFor` onto it."

  `lifecycleFor` is not touched.
- **No new row type.** The new read types its rows by the shipped reviver's parameter. So `childReclaimEvents`' statement reads:
  ```ts
  const rows = this.db.prepare(CoordStore.childReclaimEventsSql(ids.length))
    .all(...ids, ...CoordStore.CHILD_RECLAIM_EVENT_ACTS) as unknown as Parameters<typeof CoordStore.reviveLifecycleRow>[0][];
  for (const r of rows) {
    if (r.sessionId !== null) out.get(r.sessionId)?.push(CoordStore.reviveLifecycleRow(r));
  }
  ```
  - This is legal inside the class, where the private static is in scope.
  - The reviver ignores the `id` column that `LC_COLS` selects first, just as it does for `lifecycleFor`'s rows.
  - The three inline row-type copies (`store.ts:5565-5570`, `:5594-5599`, `:5607-5612`) are left as they stand. Collapsing them is not this wave's.
- **Placement.** Put `CHILD_RECLAIM_EVENT_ACTS`, `childReclaimEventsSql` and `childReclaimEvents`:
  - directly AFTER `childReclaimSessionIds()` (`store.ts:5652-5659`, the method beginning `const act: LifecycleAct = 'reclaim';`);
  - and BEFORE `lifecycleGaps` (`:5661`).
- **The import.** `type LifecycleAct` is already imported (`store.ts:67`). Drop "if it is absent".
- **Case 3.** Rename it "revives each row exactly as lifecycleFor does — reviveLifecycleRow, both reads". Its body is unchanged.
- **Mutation table.**
  - Row 3's replacement loop body reads `CoordStore.reviveLifecycleRow(r)` where it said `CoordStore.toMirrored(r)`.
  - Row 4's text types its accumulator `Parameters<typeof CoordStore.reviveLifecycleRow>[0][]` where it said `LcRowDb[]`.
  - Row 5 becomes "In `childReclaimEvents`' loop, replace `CoordStore.reviveLifecycleRow(r)` with `({ ...CoordStore.reviveLifecycleRow(r), raw: '' })`". It shows the same red: case 3's `toEqual` diff shows `raw` differing on every row.
- **Step 4** also runs `test/child-reclaim-sweep.test.ts`. The sweep reads both shipped readers of the reviver, and it must stay green.
- **The File Structure row for `store.ts`** (plan:167), in A2's merged table, names for Task 2: "Modify (`hydrateRun`'s literal; new `CHILD_RECLAIM_EVENT_ACTS`, `childReclaimEventsSql` + `childReclaimEvents` after `childReclaimSessionIds()`, reviving through the shipped `reviveLifecycleRow`)".
- **The commit message's last sentence** becomes: "It revives through the shipped reviveLifecycleRow, the one mapper lifecycleFor and lifecycleCreatesFor already share."

**Tests.** Task 2's six cases, and the mutation rows above. Every mutation is still red.

**Routing.** `sonnet`, effort `high`, unchanged.

**Deploy class.** Server only.

### A-S3-3 — NEW Task 2b: the sweep's skip table, the two pre-lock tokens, and the failure line (R41's classes, R43), after Task 2, before Task 3

**Why.**

- **F4 and A-iface-2: Task 3's row rule cannot tell why the sweep leaves a child alone.**
  - The row rule ends with plain `pending` ("waiting to be reclaimed") for every marked child it cannot place, and it cannot see why.
  - On every ineligible verdict, the shipped sweep deletes the child's entry and records no reason: `if (!v.eligible) { this.childReclaimSweepState.delete(r.id);` (`watch.ts:3283-3284`).
  - Measured live: `ccrc-pwa-brisk-meadow` is skipped as `coordinating` on every pass, and its chip would read "waiting to be reclaimed" for ever.
- **R41 rules the classes.** A class of skip decides the chip and the banner. There are six kept words, six doubt words, and `held`.
- **F8 and R43: two journal-only tokens are misread as refusals.**
  - `ws-reclaim` journals `flock-unavailable` and `lock-unopenable` as `reclaim refused <token>` (`ccd/ccd:28164-28169`, `_lc_refuse reclaim "$id" flock-unavailable`).
  - The executor reads that die as `failed`/`pre-lock-die` (`childReclaim.ts:664`), and the sweep retries it.
  - Yet the shipped attention list lists neither token, because `childReclaimTokenKind` answers null for both.
  - The planned chip would call both `refused`.

  This task makes those two tokens, BY NAME, failure lines in ONE L1 predicate. The attention list and the chip both read it.

**Binding text.**

**Files.**
- Modify `server/src/childReclaimSweep.ts`. It is L1, and it still imports L0 alone.
- Tests: `server/test/child-reclaim-sweep-policy.test.ts`, `server/test/child-reclaim-sweep.test.ts` and `server/test/child-reclaim.test.ts`.

**Interfaces (Produces).**
```ts
// childReclaimSweep.ts — the six kept literals become the L0 word type (A-S3-1); the set is unchanged.
export type ChildReclaimSweepSkip =
  | ChildReclaimKeptWord
  | 'not-a-child' | 'marker-unreadable' | 'identity-unmeasured'
  | 'held' | 'hold-unmeasured' | 'hold-retired' | 'terminal-refusal'
  | 'minting-run-unreadable' | 'minting-run-open' | 'dispatch-in-flight'
  | 'review-report-live' | 'reviewed-run-unreadable' | 'siblings-unreadable' | 'siblings-open';
export type ChildReclaimSkipRow =
  | { readonly class: 'ordinary' }
  | { readonly class: 'held' | 'kept' | 'doubt'; readonly sentence: string };
/** THE ONE TABLE keyed by the sweep's skip words. `as const satisfies`: total over the union, and
 *  each key keeps its own row type, so `CHILD_RECLAIM_SKIP.coordinating.sentence` and
 *  `CHILD_RECLAIM_SKIP[keptWord].sentence` compile (a plain `Record<…, ChildReclaimSkipRow>`
 *  annotation would make both TS2339). */
export const CHILD_RECLAIM_SKIP = { /* step 3 */ } as const satisfies Readonly<Record<ChildReclaimSweepSkip, ChildReclaimSkipRow>>;
/** The two `reclaim` refusals ccd journals for a PRE-LOCK die, keyed by the die. Spelled here, once:
 *  `coord/` code reads them by property, never as a quoted literal. */
export const CHILD_RECLAIM_PRE_LOCK_TOKEN = {
  flock: 'flock-unavailable', lock: 'lock-unopenable',
} as const satisfies Readonly<Record<'flock' | 'lock', LcRefusalToken>>;
export type ChildReclaimPreLockToken = (typeof CHILD_RECLAIM_PRE_LOCK_TOKEN)[keyof typeof CHILD_RECLAIM_PRE_LOCK_TOKEN];
export function isChildReclaimPreLockToken(v: unknown): v is ChildReclaimPreLockToken;
/** A `reclaim` line that is part of a run of FAILURES. */
export const childReclaimFailureLine: (e: { readonly outcome: string; readonly refusal: string | null }) => boolean;
```

**Steps.**

1. **Red first:** write the cases below.
2. **The skip type.** Change `ChildReclaimSweepSkip` (`childReclaimSweep.ts:259-265`) to the union above. Import `type ChildReclaimKeptWord` and `type LcRefusalToken` from L0. The set of words is unchanged: there are twenty.
3. **The table.** Put it directly below `ChildReclaimSweepVerdict` (`:268`). The sentences are binding and verbatim. Apostrophes are curly (’), as in `LC_REFUSAL_WORD`'s copy.

   **`kept`** (the chip reads `refused`, which the switch never replaces; the banner lists the child). Each sentence but `not-a-workspace`'s ends with R41's phrase. The two minting-run words carry R41's added sentence directly before that phrase, so both of R41's requirements hold (the accepted `rebuild-sentence-before-the-ending`).
   - `coordinating`: "This workspace has held a coordinator’s chair since about when it was created, holds one now, or held one at a time that cannot be placed against its creation, so ccrc treats it as a coordinator’s workspace. ccrc never reclaims it on its own; a person removes it once nothing still needs it."
   - `minting-run-absent`: "The run this workspace’s child marker names is not in the coordination database, so nothing proves the workspace is finished; after a lost or rebuilt database every child reads this way. After a rebuild, workers may still be running in these. ccrc never reclaims it on its own; a person removes it once nothing still needs it."
   - `minting-run-postdates-child`: "The run this workspace’s child marker names opened after the workspace was created, so it cannot be the run that made it: either the coordination database was rebuilt, and then every child of the old database reads this way, or the fleet box’s clock reads behind the server’s. After a rebuild, workers may still be running in these. ccrc never reclaims it on its own; a person removes it once nothing still needs it."
   - `child-birth-unplaced`: "The lifecycle journal holds no dated creation of this workspace, so nothing proves the run its child marker names made it. ccrc never reclaims it on its own; a person removes it once nothing still needs it."
   - `reviewed-run-absent`: "This review’s workspace holds a report the coordinator may still cite, and the run it reviewed is not in the coordination database, so nothing proves that run closed. ccrc never reclaims it on its own; a person removes it once nothing still needs it."
   - `not-a-workspace`: "This is a project’s main checkout carrying a child marker, and automatic reclamation never takes a main checkout. ccrc never reclaims it on its own; a person removes the marker, never the checkout." This is the accepted departure `not-a-workspace-removes-the-marker`: R41's phrase would tell an operator to remove a main checkout, so this one sentence tells a person to remove the marker, never the checkout.

   **`doubt`** (the chip reads `deferred`; the switch turns it to `paused`; it never reaches the banner):
   - `marker-unreadable`: "This workspace’s child marker could not be read, so whose child it is cannot be said. The sweep reads it again on its next pass."
   - `identity-unmeasured`: "The registry could not read this workspace’s identity on the last pass, so the sweep left it alone. It reads it again on its next pass."
   - `hold-unmeasured`: "Whether this workspace’s hold belongs to its own programme could not be read, so the hold is treated as standing. The sweep reads it again on its next pass."
   - `minting-run-unreadable`: "The run this workspace’s child marker names could not be read from the coordination database. The sweep reads it again on its next pass."
   - `reviewed-run-unreadable`: "The run this review’s workspace reviewed could not be read from the coordination database. The sweep reads it again on its next pass."
   - `siblings-unreadable`: "Whether another run still uses this workspace could not be read. The sweep reads it again on its next pass."

   **`held`** (the chip reads `deferred`; the switch turns it to `paused`; it never reaches the banner, and while it stands the failing arm does not list the child, A-S3-7):
   - `held`: "This workspace carries a hold, so the sweep leaves it alone: a person’s hold stands until they release it, and a programme’s until that programme has no open run."

   **`ordinary`** (no sentence; the chip's planned rows answer):
   - `not-a-child`, `hold-retired`, `terminal-refusal`, `minting-run-open`, `dispatch-in-flight`, `review-report-live`, `siblings-open`.

   The table's docstring records why each ordinary word is ordinary:
   - `hold-retired`: the release job is acting.
   - `terminal-refusal`: the mirror's terminal row decides the chip, and the banner's terminal arm lists it.
   - `review-report-live`: the chip's own review rows say it.
   - `minting-run-open`, `dispatch-in-flight` and `siblings-open`: they never reach a closed run's row rule, because the hand-over conjunct answers first.
4. **The pre-lock tokens and the failure line (R43).** Put them beside `RECLAIM_ACT`/`FAILED` (`:546-549`):
   ```ts
   const CHILD_RECLAIM_PRE_LOCK_TOKENS: readonly string[] = Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN);
   export function isChildReclaimPreLockToken(v: unknown): v is ChildReclaimPreLockToken {
     return typeof v === 'string' && CHILD_RECLAIM_PRE_LOCK_TOKENS.includes(v);
   }
   /** A `reclaim` line that is part of a run of FAILURES (spec §5.9): `failed`, or `refused` with one
    *  of the two pre-lock tokens. ccd journals its pre-lock lock dies through `_lc_refuse`; the
    *  executor reads the same call as a `pre-lock-die` failure and the sweep retries it, so the
    *  report reads it as the failure it is, never as a settled refusal. ONLY these two, by name: a
    *  token ccd starts journaling under `reclaim` later is classified when it is added, in this
    *  table or in `CHILD_RECLAIM_TOKEN_KIND`, and is never inherited. NOT read by
    *  `childReclaimTerminalRefusal`: neither token is terminal. */
   export const childReclaimFailureLine = (e: { readonly outcome: string; readonly refusal: string | null }): boolean =>
     e.outcome === FAILED || (e.outcome === REFUSED && isChildReclaimPreLockToken(e.refusal));
   ```
   - `childReclaimJournalRow` (`:563-577`): `if (latest.outcome === FAILED)` becomes `if (childReclaimFailureLine(latest))`, and the walk's `if (e.outcome !== FAILED) break;` becomes `if (!childReclaimFailureLine(e)) break;`.
   - `childReclaimFailingPastCeiling` (`:590-591`): `row.outcome === FAILED` becomes `childReclaimFailureLine(row)`.
   - `childReclaimTerminalRefusal` (`:584-586`) is UNCHANGED, byte for byte. Its docstring gains one sentence: "A pre-lock refusal is a failure line, never terminal (`childReclaimFailureLine`)."
   - `childReclaimAttention`'s docstring: change "a failure is the `_lc_fail` line of an attempt that started" to "a failure is the `_lc_fail` line of an attempt that started, or the `_lc_refuse` line of a pre-lock die (`childReclaimFailureLine`)".

**Where the token classification changes, and where it does not (R43).**
- **It changes in ONE place:** `childReclaimFailureLine` (L1), reading the mirror. Two readers use it:
  - the attention list's failing arm, through `childReclaimJournalRow` and `childReclaimFailingPastCeiling`;
  - the chip's event rows (A-S3-4).
- **`CHILD_RECLAIM_TOKEN_KIND` is UNCHANGED.** It stays the fourteen words ccd's RECLAIM region refuses with.
  - Its census, "the fourteen words" (`child-reclaim.test.ts:113-125`), harvests only `_reap_refuse <word>` and `"refused":"<word>"`, never `_lc_refuse`, so it stays green with no edit.
  - `childReclaimTokenKind` still answers null for both lock tokens.
- **The sweep's terminal exclusion (`childReclaimTerminalRefusal`) is unchanged.** So retry behaviour is identical: a flock child is asked again after its backoff, as today.
- **No quoted `'flock-unavailable'` or `'lock-unopenable'` literal is added under `server/src/coord` in this wave, comments included.** `mail-routes.test.ts`'s kebab scanner (`:571`) reads every quoted kebab literal there and admits neither. `coord/` code reads `CHILD_RECLAIM_PRE_LOCK_TOKEN.flock` and `.lock`, and its comments name the tokens in backticks.
- **The vocabularies are held DISJOINT by a new case** (below). A token is exactly one of these:
  - a ws-reclaim refusal that the kind map classifies;
  - one of the two pre-lock failures;
  - unknown: a newer ccd's word, or another journal-only token, read `refused` through `childReclaimTokenSentence`.
- **Exactly two tokens, and no inheritance (R43).** A token ccd starts journaling under `reclaim` later (wave 6 adds journaling for `probe-unmeasured`, the audit-time `unmeasured` and the pre-lock argv and `python3` dies) is never inherited unclassified. Wave 6 classifies each new one, in `CHILD_RECLAIM_PRE_LOCK_TOKEN` or in the kind map. Until it does, case (iv)'s `bad-session-id` row pins that a journal-only token outside the two is not a failure line, and the chip reads such a token `refused` through the unclassified arm. A journal-only token placed in the kind map reds case (vii), so the wave that classifies it there amends that case in the same act.
- **The wave-4 pre-flight's R-11 is corrected.** It listed these two tokens as never reaching the mirror. In fact, the mirror-invisible failures are `probe-unmeasured`, the audit-time `unmeasured`, and the pre-lock argv and `python3` dies. ccd's journaling of those belongs to wave 6.

**Tests (red first).**

`child-reclaim-sweep-policy.test.ts`:
- **(i) Each class is exactly its words.** Use `classOf = (c: string) => Object.entries(CHILD_RECLAIM_SKIP).filter(([, r]) => r.class === c).map(([w]) => w).sort()`.
  - `classOf('kept')` equals `[...CHILD_RECLAIM_KEPT_WORDS].sort()`.
  - `classOf('doubt')` equals the six doubt words.
  - `classOf('held')` equals `['held']`.
  - `classOf('ordinary')` equals the seven ordinary words.

  **Mutation:** set `coordinating: { class: 'ordinary' }`. The kept row reds with `expected [ 'child-birth-unplaced', …(4) ] to deeply equal [ 'child-birth-unplaced', …(5) ]`.
- **(ii) The sentences.**
  - The five kept sentences other than `not-a-workspace` end with `ccrc never reclaims it on its own; a person removes it once nothing still needs it.`.
  - `not-a-workspace` ends with `ccrc never reclaims it on its own; a person removes the marker, never the checkout.`.
  - Exactly `minting-run-absent` and `minting-run-postdates-child` contain `After a rebuild, workers may still be running in these.`.
  - Every doubt sentence ends with `on its next pass.`.
  - The held sentence is non-empty.

  **Mutations:**
  - (a) delete " ccrc never reclaims it on its own; a person removes it once nothing still needs it." from `coordinating`: red;
  - (b) add the rebuild sentence to `child-birth-unplaced`: red.
- **(iii) Single definition.** Scan `server/src`, recursively, for the text `Record<ChildReclaimSweepSkip`. Exactly one hit is found: the `satisfies` clause in `server/src/childReclaimSweep.ts`.

  **Mutation:** add `const X = {} as Readonly<Record<ChildReclaimSweepSkip, string>>;` to `server/src/coord/childReclaim.ts`. The case reds, naming that file.
- **(iv) `childReclaimFailureLine`, table-driven.**
  - `failed` → true;
  - `refused flock-unavailable` → true;
  - `refused lock-unopenable` → true;
  - `refused held` → false;
  - `refused containment-unproven` → false;
  - `refused bad-session-id` (a journal-only token outside the two) → false;
  - `refused from-a-newer-ccd` → false;
  - `refused` with a null token → false;
  - `done` → false;
  - `intent` → false.

  Also assert `Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN).sort()` equals `['flock-unavailable', 'lock-unopenable']`, and that each one passes `isLcRefusalToken`.

  **Mutations:**
  - (a) delete the `isChildReclaimPreLockToken` arm: the flock row reds;
  - (b) widen it to every `refused`: the `held` row reds;
  - (c) widen it to `isLcRefusalToken(e.refusal)`: the `bad-session-id` row reds.
- **(v) A run of pre-lock refusals is a failure run.**
  - The generation `[create, refused flock-unavailable at A, refused flock-unavailable at A+CEILING]` gives `failingSince === A`.
    - `childReclaimFailingPastCeiling` is true at `A+CEILING`.
    - `childReclaimAttention` lists `{ kind: 'failing', sessionId, runId, token: 'flock-unavailable', sentence: childReclaimFailingSentence(lcRefusalWord('flock-unavailable')), at: A }`.
  - A mixed run `[failed pin-failed at A, refused flock-unavailable at A+60_000]` is ONE run, with `failingSince === A`.
  - A latest `refused held` lists nothing.

  **Mutation:** keep the walk's `if (e.outcome !== FAILED) break;`. The walk then breaks on the latest (refused) line before stamping anything, so the mixed run's `failingSince` reads `null`, and the case reds.
- **(vi) A pre-lock refusal is never terminal.** `childReclaimTerminalRefusal({ …, outcome: 'refused', refusal: 'flock-unavailable' }, childReclaimTokenKind)` is false.

  **Mutation:** append `|| isChildReclaimPreLockToken(row.refusal)` to it. Red.

`child-reclaim.test.ts`, in describe "the fourteen words":
- **(vii) The two vocabularies are disjoint.** The case "no ws-reclaim token is also a journal-only token" asserts that `LC_REFUSAL_TOKENS.filter((t) => Object.keys(CHILD_RECLAIM_TOKEN_KIND).includes(t))` equals `[]`.

  **Mutation:** add `held: 'x',` to `LC_REFUSAL_WORD` (`LC_REFUSAL_TOKENS` is derived from it). The case reds with `expected [ 'held' ] to deeply equal []`.

`child-reclaim-sweep.test.ts`:
- **(viii) A flock-refused child is listed failing and still asked.**
  - Set up: `finishedChild(f)`; `f.journal('demo-a', 'refused', 'flock-unavailable')`; `f.advance(CHILD_RECLAIM_DEFER_CEILING_MS)`; journal it again.
  - The stub answers `{ kind: 'failed', sessionId: req.sessionId, runId: req.runId, resume: 'pre-lock-die', detail: 'flock (util-linux) is unavailable — refusing to run the destructive verb unserialised' }`. It carries no `token`: the outcome gains that field only in Task 4d, which adds it to this stub.
  - After the passes, `await f.watcher.tick()`. `currentCoord()?.childReclaimAttention` then holds one `kind: 'failing'` item for `demo-a`.
  - `f.requests` is non-empty: the child is re-asked after the backoff.

  **Mutations:**
  - (a) as (iv)(a): the list is `[]`, red;
  - (b) as (vi): no re-ask, and the `requests` assertion reds.

**Routing.** `sonnet`, effort `high`. The SAFETY lens reads two things: the unchanged `childReclaimTerminalRefusal`, and the terminal-set line in `watch.ts:3175-3176` (`const terminal = new Set(latest`).

**Deploy class.** Server only.

### A-S3-4 — Task 3: the chip reads the sweep's last verdict, ahead of retryable and failure events; the import fixes; R43's rows; the permanent failure; the closing banner

**Why.**
- **F4, A-iface-2 and R41: the plain `pending` row is false for kept and held children.** The row rule's last line answers plain `pending` for every marked child of a closed run ("This run has closed. Its workspace is waiting to be reclaimed.", plan:1244). That is false for every child the sweep keeps or holds. R41 rules the chip's answer for each class:
  - kept: `refused`, with the kept sentence, which the switch never replaces, a pause included;
  - doubt: `deferred`, with its sentence;
  - `held`: `deferred`, with the hold sentence;
  - "No verdict yet" is its own value, and it never folds into eligible.
- **A retryable or failure event must not outrank the verdict.**
  - The plan reads the latest mirror event first. So a child whose latest event is `failed pin-failed` would read "The sweep tries again on its own" even when a person has since held it, or it has since become a coordinator's workspace.
  - The shipped verdict returns `held` before anything else is read (`childReclaimSweep.ts:288`), and the sweep never asks a held or kept child.
  - So a non-ordinary verdict answers ahead of every retryable and failure event.
  - It does not answer ahead of a done reclaim, or of a TERMINAL refusal. A terminal refusal is ccd's own settled word, and the banner's terminal arm lists that child with that same sentence.
- **F9, server half: a child the sweep keeps failing on.** Some children fail on every attempt with nothing journaled: the audit-time `unmeasured`, `probe-unmeasured`, and the pre-lock argv dies. The chip then reads `pending` while the sweep is backing off.
- **F8 and R43: two tokens the plan's unclassifiable arm gets wrong.** That arm (plan:847) would read `flock-unavailable` and `lock-unopenable` as `refused`.
- **A-iface-13: a failure that never succeeds.** The plan reads every `failed` event as `deferred`, with "The sweep tries again on its own". That disagrees with the attention list once the failure is permanent. Measured: run 139, `pin-failed` with its branch gone. The gone-branch pin is wave 6's (R38).
- **A-iface-6: duplicate imports.** Step 3's import list would declare three names twice (TS2300).
- **A-iface-7: a re-spelled terminal predicate.** The plan's private `isTerminalRunState` re-spells the exported `isChildReclaimTerminalState` (`childReclaim.ts:352-356`).
- **A-iface-11: a source slice that runs to the end of the file.** Any later addition there lands inside the slice.
- **F16: the sweep state's limits are unstated.** `ChildReclaimSources` does not state them.
- **A-iface-14: an overpromising sentence.** `S.fleetPaused` promises "then reclaimed on its own", which is false for the kept classes.

**Binding text.** Where this contradicts Task 3's Interfaces, the mapping table (plan:836-857), the numbered rulings below it, Step 1's test file, Step 3's code or Step 5's mutation table, this wins.

**1. Imports (Step 3; A-iface-6, A-iface-7).**
- Replace plan:1216's list with: "Add `type ChildReclaimStatus, type RunSummary, lcRefusalWord` to the `../../../shared/api.js` import (`childReclaim.ts:13-16`), on its `type MarkerState, type MirroredLifecycleEvent, type RunState,` line, never on the line that names `TERMINAL_RUN_STATES`, which Step 4's added-line grep counts. `ChildMark`, `MirroredLifecycleEvent`, `RunState` and `TERMINAL_RUN_STATES` are already imported there, and `refusalSentence` is already imported at `childReclaim.ts:9`."
- Add these names to the `../childReclaimSweep.js` import Task 0c added for `childReclaimCoordinated` (add the import only if it is absent):
  ```ts
  import {
    CHILD_RECLAIM_SKIP, childReclaimFailingPastCeiling, childReclaimFailingSentence, childReclaimFailureLine,
    childReclaimJournalRow, type ChildReclaimSweepSkip, type ChildReclaimSweepVerdict,
  } from '../childReclaimSweep.js';
  ```
  `childReclaimSweep.ts` imports L0 alone, so there is no cycle.
- Delete the conditional "Add `import { refusalSentence } …` if it is not already present" (plan:800 and plan:1216).
- Delete `const isTerminalRunState = …` (plan:1277-1278). Its three call sites, in `childReclaimStatus`, `childReclaimSessions` and `withChildReclaim`, call `isChildReclaimTerminalState(…)` instead.
- Step 4 gains `git diff -U0 -- server/src/coord/childReclaim.ts | grep '^+' | grep -c 'TERMINAL_RUN_STATES'`, which must print `0`.

**2. The closing banner (A-iface-11).** The wave-5 section ends with the line `// ── end wave 5 chip ──`. Every OTHER wave-5 edit to `childReclaim.ts` lands ABOVE the opening banner: A-S3-7's kept feed writer, and A-S3-8's failure `token`, `feedQuiet` and feed skip. Step 1's source helper becomes:
```ts
const wave5 = (): string => {
  const file = readFileSync(path.join(import.meta.dirname, '..', 'src', 'coord', 'childReclaim.ts'), 'utf8');
  const at = file.indexOf('// ── Wave 5: the closed run');
  const end = file.indexOf('// ── end wave 5 chip ──');
  expect(at, 'the wave-5 banner is missing').toBeGreaterThan(-1);
  expect(end, 'the wave-5 end banner is missing').toBeGreaterThan(at);
  return file.slice(at, end);
};
```

**3. Sentences.** `CHILD_RECLAIM_STATUS_SENTENCE` gains two members and changes one. `sweepDeferred`'s text is Task 0b's amendment and is not changed here. The rest are unchanged.
```ts
  unjudged: 'This run has closed. The sweep has not judged its workspace yet, so whether it will be reclaimed is not known.',
  sweepFailing: 'The sweep’s recent attempts to reclaim this workspace failed, and ccd recorded no outcome for them. It tries again on its own, backing off in between.',
  fleetPaused: 'Reclamation is paused fleet-wide. This workspace is kept while the switch stands.',
```
The Interfaces block's `CHILD_RECLAIM_STATUS_SENTENCE` type gains `readonly unjudged: string; readonly sweepFailing: string;`.

**4. Inputs.**
```ts
/** The sweep's last verdict for this child, as the chip reads it (spec §5.9). `unjudged`: the
 *  watcher holds no verdict for this row. Either no judging pass has run since the server started,
 *  or the last one did not judge this row, or a pass that judged nothing (the switch, a missing
 *  capability, a failed read) dropped it because it was not a kept word. NEVER read as `eligible`. */
export type ChildReclaimChipVerdict =
  | { readonly kind: 'unjudged' }
  | { readonly kind: 'eligible' }
  | { readonly kind: 'skip'; readonly why: ChildReclaimSweepSkip };
```
`ChildReclaimStatusInput` gains:
```ts
  readonly verdict: ChildReclaimChipVerdict;
  /** The sweep's in-memory entry is in a run of failed attempts (`consecutiveFailures > 0`). */
  readonly sweepFailing: boolean;
  /** When THIS generation's unbroken run of failure lines (`childReclaimFailureLine`) began,
   *  ONLY when that run has lasted the ceiling at the composer's clock; else null. */
  readonly journalFailingSince: number | null;
```
`ChildReclaimSources` changes `defers` and gains two fields:
```ts
  readonly defers: ReadonlyMap<string, { readonly firstDeferredAt: number | null; readonly consecutiveFailures: number }>;
  /** `FleetWatcher.currentChildReclaimVerdicts()`: null is "no judging pass since this process
   *  started", never an empty map; an id absent from a map was not judged. */
  readonly verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict> | null;
  /** The composer's wall clock (epoch ms), for the failure ceiling. An argument: this file decides, it reads no clock. */
  readonly nowMs: number;
```
The `defers` docstring gains F16's limits, verbatim in substance:
- the map is in memory, so a restart empties it;
- it is cleared whole when the switch stands, when a capability is missing, and when the mirror read fails;
- an entry exists only after an eligible verdict, and an ineligible verdict deletes it;
- `firstDeferredAt` never resets within an entry's life.

**5. The mapping table.** This supersedes plan:838-855. First match wins.
- "The gate" means: the registry, as last listed, carries a `ChildMark` naming THIS run, and no open run names the session.
- "/ paused" means the switch's `paused` while the fleet is paused (`waiting`).

| Condition | Word | Sentence | `at` |
|---|---|---|---|
| run not terminal, or no `sessionId` | `null` | — | — |
| latest event `done` | `reclaimed` | `S.reclaimed` | event `at` |
| latest event `refused`, kind `gone` | `null` | — | — |
| latest event `refused`, kind `terminal` (`no-worktree-record` among them) | `refused` | `tokenSentence(token)` | event `at` |
| the gate holds and the verdict is a `kept` skip | `refused`, NEVER replaced by the switch | `CHILD_RECLAIM_SKIP[why].sentence` | `null` |
| the gate holds and the verdict is a `doubt` or `held` skip | `deferred` / paused | `CHILD_RECLAIM_SKIP[why].sentence` | `null` |
| latest event a FAILURE LINE (`childReclaimFailureLine`: `failed`, or `refused` with a pre-lock token, R43), and `journalFailingSince` set | `deferred` / paused | `childReclaimFailingSentence(word)`, the attention list's own; `word` is `tokenSentence(token)`, or null with no token | `journalFailingSince` |
| … a failure line, inside the ceiling | `deferred` / paused | `tokenSentence(token)`, or `S.failed` with no token | event `at` |
| … `refused`, no token | `refused` | `S.refusedNoReason` | event `at` |
| … `refused`, token `paused` | `paused` | `tokenSentence('paused')` | event `at` |
| … `refused`, kind `retry` | `deferred` / paused | `tokenSentence(token)` | event `at` |
| … `refused`, a token this build cannot classify (a newer ccd's word, or a journal-only token other than the two) | `refused` | `tokenSentence(token)` | event `at` |
| … `intent` / `unknown` | falls through to the row rule | | |
| ROW RULE (the gate holds): review run, reviewed run open in the list | `pending` | `S.reviewKept` | `null` |
| … review run, reviewed run absent from the list | `pending` | `S.reviewKept` | `null` |
| … `sweepFailing` | `deferred` / paused | `S.sweepFailing` | `null` |
| … the sweep holds a defer | `deferred` / paused | `S.sweepDeferred` | `firstDeferredAt` |
| … verdict `eligible`, or an `ordinary` skip | `pending` / paused | `S.pending` | `null` |
| … verdict `unjudged` | `pending` / paused | `S.unjudged` | `null` |
| anything else | `null` | — | — |

**Three earlier rulings are amended here, and the amendment says so.**
- **R21.** The latest event still decides, except that a current `kept`, `doubt` or `held` verdict outranks every event but a done reclaim, a gone answer and a terminal refusal: a failure line, a retryable refusal, a refusal with no token, the on-box `paused` token and an unclassified token. A done reclaim, a gone answer and a terminal refusal still outrank every verdict. This is the accepted `verdict-outranks-retry-events`.
- **R16′.** The review rows answer only when the verdict is `eligible`, an `ordinary` skip, or `unjudged`.
- **R7.** A kept answer is never replaced by the switch.

This also closes the attention-visibility design's accepted falsehood (its risk 9). A review child whose reviewed run is gone from the database reads `refused`, with `reviewed-run-absent`'s sentence. It never reads "It is reclaimed once that run closes".

**6. `childReclaimStatus`, binding code.** This replaces plan:1351-1393, the whole function body.
```ts
export function childReclaimStatus(input: ChildReclaimStatusInput): ChildReclaimStatus | null {
  const { run, event } = input;
  if (run.sessionId === null || !isChildReclaimTerminalState(run.state)) return null;
  const waiting = (s: ChildReclaimStatus): ChildReclaimStatus => (input.fleetPaused ? CHILD_RECLAIM_SWITCH_PAUSED : s);
  const token = event === null || event.refusal === null || event.refusal === '' ? null : event.refusal;
  const kind = token === null ? null : childReclaimTokenKind(token);
  // SETTLED (spec §5.9): a done reclaim, a row ccd found gone, and a TERMINAL refusal. The last is
  // what the attention list's terminal arm lists for this child, in the same sentence.
  if (event !== null) {
    if (event.outcome === 'done') {
      return { word: 'reclaimed', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reclaimed, at: event.at };
    }
    if (event.outcome === 'refused' && token !== null) {
      if (kind === 'gone') return null;
      if (kind === 'terminal') return { word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at };
    }
  }
  const row = input.row;
  const marked = row.kind === 'row' && row.child.kind === 'child' && row.child.runId === run.id
    && !input.sessionHasOpenRun;
  // THE SWEEP'S LAST VERDICT (spec §5.9), ahead of every retryable or failure event: a measured
  // reason the sweep keeps or waits on outranks an older answer that promises a retry it will not make.
  if (marked && input.verdict.kind === 'skip') {
    const skip = CHILD_RECLAIM_SKIP[input.verdict.why];
    // KEPT: settled until a person acts. The switch never replaces it.
    if (skip.class === 'kept') return { word: 'refused', sentence: skip.sentence, at: null };
    if (skip.class !== 'ordinary') return waiting({ word: 'deferred', sentence: skip.sentence, at: null });
  }
  if (event !== null) {
    // A FAILURE LINE (spec §5.9): `failed`, or a `refused` with one of the two pre-lock tokens, which
    // the executor and the sweep retry. The SAME predicate the attention list's failing arm reads.
    if (childReclaimFailureLine(event)) {
      const word = token === null ? null : childReclaimTokenSentence(token);
      if (input.journalFailingSince !== null) {
        return waiting({ word: 'deferred', sentence: childReclaimFailingSentence(word), at: input.journalFailingSince });
      }
      return waiting({ word: 'deferred', sentence: word ?? CHILD_RECLAIM_STATUS_SENTENCE.failed, at: event.at });
    }
    if (event.outcome === 'refused') {
      if (token === null) {
        return { word: 'refused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.refusedNoReason, at: event.at };
      }
      if (token === PAUSED_TOKEN) return { word: 'paused', sentence: childReclaimTokenSentence(token), at: event.at };
      if (kind === 'retry') return waiting({ word: 'deferred', sentence: childReclaimTokenSentence(token), at: event.at });
      // A token this build was never compiled to know (`kind` null) and not a pre-lock token:
      // refused, through `refusalSentence`'s fallback naming it (spec §5.9).
      return { word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at };
    }
    // `intent` / `unknown`: an act with no recorded end, newer than any outcome in this
    // generation. An older attempt's answer is not this one's: fall through to the row rule.
  }
  if (!marked) return null;
  if (input.reviewedRunNotTerminal) return { word: 'pending', sentence: CHILD_RECLAIM_STATUS_SENTENCE.reviewKept, at: null };
  if (input.sweepFailing) return waiting({ word: 'deferred', sentence: CHILD_RECLAIM_STATUS_SENTENCE.sweepFailing, at: null });
  if (input.deferredSince !== null) {
    return waiting({ word: 'deferred', sentence: CHILD_RECLAIM_STATUS_SENTENCE.sweepDeferred, at: input.deferredSince });
  }
  // `unjudged` is never `eligible`: "waiting to be reclaimed" only after a verdict says so.
  return waiting({ word: 'pending',
    sentence: input.verdict.kind === 'unjudged' ? CHILD_RECLAIM_STATUS_SENTENCE.unjudged : CHILD_RECLAIM_STATUS_SENTENCE.pending,
    at: null });
}
```
The docstring's rule list is rewritten to this order:
1. Not terminal, or no session: nothing.
2. Settled: done → reclaimed; a token of kind `gone` → nothing; a terminal refusal → refused.
3. The sweep's last verdict, where the gate holds: kept → refused, never replaced by the switch; doubt or held → deferred.
4. The remaining events:
   - a FAILURE LINE (`failed`, or `refused` with a pre-lock token) → deferred, in the attention list's own sentence once its run has lasted the ceiling;
   - refused with no token → refused;
   - the `paused` token → paused;
   - retry → deferred;
   - unclassified → refused;
   - `intent`/`unknown` → the row rule.
5. The row rule:
   - a review child → pending, kept for the report;
   - a run of sweep failures → deferred;
   - a sweep defer → deferred;
   - an eligible or ordinary verdict → pending;
   - no verdict yet → pending, with its own sentence and never the eligible one.

**7. `withChildReclaim`, binding code.** The per-row body becomes:
```ts
    const sid = run.sessionId;
    // `?? []` is not a default for a missing key: …(the plan's comment, unchanged)
    const gen = sid === null || run.closedAt === null
      ? [] : childReclaimGeneration(src.events.get(sid) ?? [], run.closedAt);
    const event = childReclaimLatest(gen);
    const journal = childReclaimJournalRow(gen, event);
    const mark = sid === null || src.marks === null ? undefined : src.marks.get(sid);
    const row: ChildReclaimRowView = …(unchanged);
    const judged = sid === null || src.verdicts === null ? undefined : src.verdicts.get(sid);
    const entry = sid === null ? undefined : src.defers.get(sid);
    return { ...run, childReclaim: childReclaimStatus({
      run, event, row,
      sessionHasOpenRun: …(unchanged), reviewedRunNotTerminal: …(unchanged), fleetPaused: src.fleetPaused,
      deferredSince: entry?.firstDeferredAt ?? null,
      verdict: judged === undefined ? { kind: 'unjudged' }
        : judged.eligible ? { kind: 'eligible' } : { kind: 'skip', why: judged.why },
      sweepFailing: (entry?.consecutiveFailures ?? 0) > 0,
      journalFailingSince: journal !== null && childReclaimFailingPastCeiling(journal, src.nowMs)
        ? journal.failingSince : null,
    }) };
```

**8. The plan's mutation rows that quote old code are restated here.** Each keeps its expected red.
- **Row 1:** `if (run.sessionId === null || !isChildReclaimTerminalState(run.state)) return null;` → `if (run.sessionId === null) return null;`.
- **Row 3:** delete `&& !input.sessionHasOpenRun` from `marked`.
- **Row 4:** delete `&& row.child.runId === run.id` from `marked`.
- **Rows 5 and 6** edit the `gen` line: drop the fence; `run.closedAt` → `Date.now()`.
- **Row 7** edits the settled block's `if (kind === 'gone') return null;`.
- **Row 8:** `sid === null || run.closedAt === null ? [] :` → `sid === null ? [] :`, with the same `tsc` red.
- **Row 12:** add `return null;` as the last statement of the SECOND `if (event !== null) { … }` block, after the `intent` / `unknown` comment.
- **Row 15:** wrap the settled block's terminal return in `waiting(…)`.
- **Row 22:** `const event = ([...gen].reverse().find((e) => e.act === 'reclaim') ?? null);`.
- **Row 23:** the same, with `&& e.outcome !== 'intent'`.
- **Rows 10, 24 and 5b** quote `entry?.firstDeferredAt ?? null`.

**9. Step 1's test file.**
- `base()` gains `verdict: { kind: 'eligible' }, sweepFailing: false, journalFailingSince: null`.
- `src()` gains `verdicts: new Map<string, ChildReclaimSweepVerdict>([[SID, { eligible: true, runId: RUN }]])` and `nowMs: AT + 60_000`. The Map is typed, because an untyped literal widens `eligible` to `boolean`.
- Every `defers` literal is built as `{ ...childReclaimFirstSighting(5_000, null), firstDeferredAt: …, firstPresenceDeferredAt: … }`, keeping each literal's own `firstDeferredAt` and `firstPresenceDeferredAt` values, so mutation rows 10 and 24 keep their expected reds.
  - The two arguments are Task 0b's signature, `childReclaimFirstSighting(monoMs, bornAt)`. The decision clock is monotonic-looking (`5_000`), as in A-S3-9's case 5. `bornAt` is passed as `null`, explicitly: it is the idle value Task 0b defines for a spread that models no workspace generation. The chip reads only `firstDeferredAt` and `consecutiveFailures`.
  - Task 0b's fields (`lastPresenceWallAt`, `presenceHeldSince`, `bornAt`) and A-S3-8's `lastDeferWhy` flow through the spread with no edit.
- Every existing row keeps its expectation.
- Import from `../src/childReclaimSweep.js`: `CHILD_RECLAIM_SKIP`, `childReclaimFailingSentence`, `childReclaimFirstSighting` and `type ChildReclaimSweepVerdict`.

**Tests (red first).** These are new `ROWS` entries unless marked as composer cases. `skip(w)` is `{ kind: 'skip', why: w }`.

*Kept:*
- `skip('coordinating')` → `{ word: 'refused', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence, at: null }`, and the same with `fleetPaused: true`.
- **Kept beats review:** `skip('reviewed-run-absent')` with `reviewedRunNotTerminal: true` → `refused` with that word's sentence.
- **Kept beats a retry refusal:** `skip('coordinating')` with `event: ev('refused', 'state-changed')` → `refused` with the kept sentence, at `null`.
- **Kept beats the on-box paused token:** `skip('coordinating')` with `event: ev('refused', 'paused')` → the same.
- **A terminal refusal beats a kept verdict:** `skip('not-a-workspace')` with `event: ev('refused', 'not-a-workspace')` → `{ word: 'refused', sentence: refusalSentence('not-a-workspace'), at: EV_AT }`.

*Doubt and held:*
- **Doubt:** `skip('hold-unmeasured')` → `deferred` with its sentence. With `fleetPaused: true`, `switchPaused`.
- **Held:** `skip('held')` → `deferred` with the hold sentence. With `fleetPaused: true`, `switchPaused`.
- **Held on a review child:** a review child under `skip('held')` with `reviewedRunNotTerminal: true` → `deferred` with the hold sentence.
- **Held beats a failure:** `skip('held')` with `event: ev('failed', 'pin-failed')` → `{ word: 'deferred', sentence: CHILD_RECLAIM_SKIP.held.sentence, at: null }`.

*Gate, ordinary and unjudged:*
- **A verdict on a hand-over says nothing:** `skip('coordinating')` with `sessionHasOpenRun: true` → `null`.
- **Ordinary:** `skip('hold-retired')` → `pending` with `S.pending`. `skip('review-report-live')` with `reviewedRunNotTerminal: true` → `reviewKept`.
- **Unjudged:** `{ kind: 'unjudged' }` → `{ word: 'pending', sentence: S.unjudged, at: null }`. With `fleetPaused: true`, `switchPaused`.

*Sweep failures:*
- **sweepFailing, no event** → `{ word: 'deferred', sentence: S.sweepFailing, at: null }`.
- **sweepFailing beside `deferredSince`** → still `S.sweepFailing`.

*R43 tokens:*
- **`refused flock-unavailable`** → `{ word: 'deferred', sentence: lcRefusalWord('flock-unavailable'), at: EV_AT }`. `refused lock-unopenable` is the same. Each reads `switchPaused` with `fleetPaused: true`.
- **`refused bad-session-id`** (journal-only, not a pre-lock token) → `{ word: 'refused', sentence: lcRefusalWord('bad-session-id'), at: EV_AT }`.

*Past the ceiling:*
- **failed `pin-failed` with `journalFailingSince: AT`** → `{ word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed')), at: AT }`.

*Composer cases:*
- `src({ verdicts: null })` → `S.unjudged`.
- `src({ verdicts: new Map() })` → `S.unjudged` (an absent id is unjudged).
- A coordinating verdict → `refused`.
- An entry `{ ...childReclaimFirstSighting(5_000, null), consecutiveFailures: 2 }` → `S.sweepFailing`.
- Events `[create at AT-50_000, failed pin-failed at AT+1_000, failed pin-failed at AT+1_000+CEILING]`:
  - with `nowMs: AT+1_000+CEILING` → the failing sentence, at `AT+1_000`;
  - with `nowMs: AT+2_000` → `lcRefusalWord('pin-failed')`, at the latest line's `at`.

**Mutations (Step 5's table gains these).**

| # | Exact edit | Expected red |
|---|---|---|
| 26 | `childReclaimFailureLine(event)` → `event.outcome === 'failed'` | rows "refused flock-unavailable" and "…lock-unopenable…": `expected { word: 'refused', … } to deeply equal { word: 'deferred', … }` |
| 27 | delete the `if (input.journalFailingSince !== null) { … }` block | the past-ceiling row: `expected { …sentence: <the pin-failed word>, at: 1758500005000 } to deeply equal { …sentence: 'Every attempt…', at: 1758500000000 }` |
| 28 | wrap the kept return in `waiting(…)` | "kept under a fleet pause": `expected { word: 'paused', … } to deeply equal { word: 'refused', … }` |
| 29 | delete the kept line | kept rows: `expected { word: 'deferred', … } to deeply equal { word: 'refused', … }` |
| 30 | move the `if (marked && input.verdict.kind === 'skip') { … }` block below the `reviewedRunNotTerminal` line | "kept beats review": `expected { word: 'pending', sentence: 'This review’s workspace is kept …' } to deeply equal { word: 'refused', … }` |
| 31 | return the doubt/held answer without `waiting(…)` | the doubt and held `fleetPaused` rows read `deferred`, red |
| 32 | delete the `sweepFailing` line | `expected { word: 'pending', … } to deeply equal { word: 'deferred', sentence: 'The sweep’s recent attempts…' }` |
| 33 | move the `sweepFailing` line below the `deferredSince` block | "sweepFailing beside a defer": reads `S.sweepDeferred`, red |
| 34 | `input.verdict.kind === 'unjudged' ? …unjudged : …pending` → `CHILD_RECLAIM_STATUS_SENTENCE.pending` (no verdict folded into eligible) | the unjudged row: `expected { …sentence: 'This run has closed. Its workspace is waiting…' } to deeply equal { …sentence: 'This run has closed. The sweep has not judged…' }` |
| 35 | in `withChildReclaim`, `judged === undefined ? { kind: 'unjudged' }` → `{ kind: 'eligible' }` | composer `verdicts: null` and empty-map cases, red |
| 36 | in `withChildReclaim`, `src.nowMs` → `0` | composer past-ceiling case: reads the plain token word, red |
| 37 | in `withChildReclaim`, `sweepFailing: …` → `sweepFailing: false` | composer `consecutiveFailures: 2` case, red |
| 38 | delete the `// ── end wave 5 chip ──` line | both source cases: `the wave-5 end banner is missing` |
| 39 | move the `if (marked && input.verdict.kind === 'skip') { … }` block below the second `if (event !== null) { … }` block | "held beats a failure": `expected { …sentence: <the pin-failed word> } to deeply equal { …sentence: 'This workspace carries a hold…' }`; "kept beats a retry refusal" and "kept beats the on-box paused token" read `deferred`/`paused`, red |
| 40 | delete `if (kind === 'terminal') return …;` from the settled block, and insert `if (event !== null && event.outcome === 'refused' && kind === 'terminal' && token !== null) return { word: 'refused', sentence: childReclaimTokenSentence(token), at: event.at };` directly below the verdict block | "a terminal refusal beats a kept verdict": `expected { …sentence: 'This is a project’s main checkout…' } to deeply equal { …sentence: <refusalSentence('not-a-workspace')> }` |

**Routing.** `sonnet`, effort `high`.

**Deploy class.** Server only. The chip is composed by the server, and the PWA renders it unchanged.

### A-S3-5 — Task 4: re-anchored (A-iface-8)

**Why.** Every line hint in Task 4 is stale. Worse, its assignment anchor `const records = registryRead.records;` occurs three times in `watch.ts`: at `:1659` (in `tick()`), at `:2489`, and at `:4580`. Only the first is the listing `tick()` made after its `!registryRead.listed` early return.

**Binding text.**
- **The assignment.** `this.childMarks = new Map(records.map((r) => [r.id, r.child] as const));` goes directly after `watch.ts:1659`.
  - That is the occurrence inside `tick()` that follows the `if (!registryRead.listed) { … return; }` block (`:1633-1658`).
  - It never goes after `:2489` or `:4580`.
  - Wherever Step 3 says "directly after `const records = registryRead.records;`", it now says "the occurrence inside `tick()`, directly after its `!registryRead.listed` early return".
- **The field** goes after `private coord: CoordStatus | null = null;` (`:1014`).
- **The accessor `currentChildMarks()`** goes after `currentCoord()` (`:1514-1516`), ahead of `currentChildReclaimDefers()` (`:1521`). A-S3-6 puts `currentChildReclaimVerdicts()` after the defers accessor.
- **The import.** Add `ChildMark` to the `import type {` block that begins `ChildReclaimAttention, CoordStatus,` (`:31-35`). `ChildMark` is not imported at HEAD.
- **Hints.** Replace Files' `~27`, `~646`, `~855` and `~762` with `:31-35`, `:1014`, `:1659` and `:1514-1521`, as of `334fb722a`, still marked as hints.
- **Routing** is raised to `sonnet`, effort `high`: implementation never runs below Sonnet·high (R47).

**Tests.** Task 4's four cases and its three mutations, unchanged.

**Deploy class.** Server only.

### A-S3-6 — NEW Task 4b: `currentChildReclaimVerdicts()`: L4 records, L1 decides, kept verdicts survive a pass that judged nothing (R41; F4; A-iface-2), after Task 4, BLOCKING for Tasks 4c and 5

**Why.** R41: "The sweep records each marked child's last verdict per pass. A new accessor, `currentChildReclaimVerdicts()`, sits beside `currentChildReclaimDefers()`. It is cleared wherever the defers are cleared. 'No verdict yet' (restart, pause, missing caps) is its own value and never folds into eligible." And: "Under a pause, a kept child's chip still reads its kept sentence, not `paused`, because the banner keeps listing it. The verdict accessor keeps kept verdicts across a pause and clears only the transient ones."

What ships today:
- The lane computes the verdict at `watch.ts:3278-3282` (`const v = childReclaimSweepVerdict({`) and throws it away.
- On `!v.eligible`, it deletes the entry and records nothing (`:3283-3284`).
- `childReclaimLogAbsence` (`:3550-3552`) logs only `minting-run-absent`, `reviewed-run-absent` and `child-birth-unplaced`. So brisk-meadow's `coordinating` left no line anywhere (F4: "The lane also logs `coordinating` once per child, as it logs an absence").

The verdict is L1's: `childReclaimSweepVerdict`, unchanged. Which verdicts survive a pass that judged nothing is also L1's: `childReclaimKeptVerdicts`, new. This task only records the verdicts and applies that reduction.

**Binding text.**

**Files.**
- Modify `server/src/childReclaimSweep.ts`: one function.
- Modify `server/src/watch.ts`: one field, one pass-local map, one assignment, two reductions, one accessor, and one log arm.
- Tests: `server/test/child-reclaim-sweep.test.ts` and `server/test/child-reclaim-sweep-policy.test.ts`.
- The chip and route suites are run unchanged.

**Interfaces (Produces).**
```ts
// childReclaimSweep.ts (L1)
export function childReclaimKeptVerdicts(
  verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>,
): ReadonlyMap<string, ChildReclaimSweepVerdict>;
// watch.ts
currentChildReclaimVerdicts(): ReadonlyMap<string, ChildReclaimSweepVerdict> | null;
```
In `watch.ts`, import `type ChildReclaimSweepVerdict` and `childReclaimKeptVerdicts` into the existing `./childReclaimSweep.js` import (the block ending at `watch.ts:95`).

**Steps.**

1. **Red first:** write the cases below.
2. **L1.** Put this directly after `childReclaimSweepVerdict`:
   ```ts
   /** The verdicts a pass that judged nothing keeps (spec §5.9): the KEPT words only. Each ends only by
    *  a person's act or a restored coordination database, so a raised switch, a missing capability or a
    *  failed read does not make it untrue, and the attention list keeps listing it. Every other verdict
    *  is dropped: after such a pass it reads "no verdict yet", never eligible. */
   export function childReclaimKeptVerdicts(
     verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>,
   ): ReadonlyMap<string, ChildReclaimSweepVerdict> {
     return new Map([...verdicts].filter(([, v]) => !v.eligible && isChildReclaimKeptWord(v.why)));
   }
   ```
3. **The field.** Put it after `private childReclaimReleaseAnswered = new Set<string>();` (`:814`):
   ```ts
   /** The sweep's verdicts (spec §5.9): one per marked row the last JUDGING pass listed, L1's own
    *  `ChildReclaimSweepVerdict`, recorded and never re-decided here. A pass that judged nothing
    *  (`reclaim-paused` raised, a reclaim capability missing, the mirror or coordination read
    *  failed) — the same places the sweep state is cleared — reduces it to its KEPT verdicts
    *  (`childReclaimKeptVerdicts`, L1): the attention list keeps listing those, so the chip keeps
    *  saying them. `null` until this process's first judging pass. IN MEMORY ONLY. Replaced
    *  whole, never mutated. */
   private childReclaimJudged: ReadonlyMap<string, ChildReclaimSweepVerdict> | null = null;
   ```
4. **Record in the per-child loop.**
   - Beside `const seen = new Set<string>();` (`:3177`, inside `sweepChildReclaim`; a second `const seen` sits at `:4661`), declare `const judged = new Map<string, ChildReclaimSweepVerdict>();`.
   - Directly after the `const v = childReclaimSweepVerdict({ … });` statement (`:3278-3282`), and before `if (!v.eligible) {`, add `judged.set(r.id, v);`.
   - Directly after the loop's closing brace, and before the comment `// FOUR — the bound`, add `this.childReclaimJudged = judged;`.
   - Nothing else in the loop moves. No memory write, no executor call and no release call changes order.
5. **Reduce where the defers are cleared.** There are exactly two sites:
   - the mirror/coordination fail-shut `catch` (`:3121-3132`);
   - the switch/caps return (`:3151-3156`).

   At each, as the first statement of the block, add:
   ```ts
   if (this.childReclaimJudged !== null) this.childReclaimJudged = childReclaimKeptVerdicts(this.childReclaimJudged);
   ```
   The three existing `.clear()` calls stay as they are.
6. **The accessor.** Put it directly after `currentChildReclaimDefers()` (`:1521-1523`):
   ```ts
   /** The sweep's last verdict per marked child, for `GET /api/runs`' chip (spec §5.9). TWO answers
    *  that are never folded:
    *  - `null` is "no verdict yet" for every child: no judging pass since this process started.
    *  - A map is the last judging pass's verdicts, or — after a pass that judged nothing (the
    *    switch, a missing capability, a failed read) — that pass's KEPT verdicts alone. An id absent
    *    from it has no verdict yet.
    *  Neither is "eligible". Read-only; replaced whole. */
   currentChildReclaimVerdicts(): ReadonlyMap<string, ChildReclaimSweepVerdict> | null {
     return this.childReclaimJudged;
   }
   ```
7. **The coordinating log line, once.** In `childReclaimLogAbsence` (`:3550`):
   - The filter `if (why !== 'minting-run-absent' && why !== 'reviewed-run-absent' && why !== 'child-birth-unplaced') return;` gains `&& why !== 'coordinating'`.
   - A new arm logs: `` ccrc-server: sweepChildReclaim: ${r.id} is marked as a child of run ${runId}, but it has held a coordinator's chair since about when it was created, holds one now, or held one at a time that cannot be placed — never reclaimed automatically; a person removes it once nothing still needs it ``.
   - It uses the same `childReclaimAbsentLogged` key idiom (`` `${why} ${r.id}` ``), so it logs once per child per process.

   The docstring's "Every other skip … says nothing" becomes "…every other skip says nothing here: the run chip and the attention list carry it".

**Cases (all red first).**

Policy (`child-reclaim-sweep-policy.test.ts`):
- **(p1) `childReclaimKeptVerdicts` keeps exactly the kept words.**
  - Input: `{a: coordinating, b: eligible, c: held, d: hold-unmeasured, e: minting-run-absent, f: hold-retired}`.
  - Expected output: exactly `{a, e}`, with their verdicts.

  **Mutation:** replace `isChildReclaimKeptWord(v.why)` with `CHILD_RECLAIM_SKIP[v.why].class !== 'ordinary'`. Now `c` and `d` survive, red.

Lane (`child-reclaim-sweep.test.ts`, new describe "currentChildReclaimVerdicts — the sweep's verdicts, visible (wave 5)").

"The coordinating case" below is the shipped case at `:810`:
- demo-a's own claim is opened and abandoned at its create's instant;
- so the claim equals the birth and lies inside the skew;
- so it stays `coordinating` under Task 0c's fence.

The cases:
- **(i) It is `null` before any pass.**

  **Mutation:** initialise the field to `new Map()`. Red: `expected Map{} to be null`.
- **(ii) After one pass, in one fixture:**
  - `finishedChild(f, 'demo-b')` reads `{ eligible: true, runId }`;
  - the coordinating case's `demo-a` reads `{ eligible: false, why: 'coordinating' }`;
  - a child planted as `f.plant('demo-c', { child: String(r.id), hold: 'kept by hand' })` (with `r` from `f.openRun()`, abandoned) reads `{ eligible: false, why: 'held' }`.

  **Mutation:** delete `judged.set(r.id, v);`. Red: `expected undefined to deeply equal { eligible: true, … }`.
- **(iii) A pause keeps the kept verdicts, and only them.**
  - Use the same three children. After pass 1, raise `reclaim-paused` and run pass 2.
  - `currentChildReclaimVerdicts()` is a map. `get('demo-a')` is `{ eligible: false, why: 'coordinating' }`. `get('demo-b')` and `get('demo-c')` are `undefined`.
  - Lower the switch and run pass 3: `demo-b` and `demo-c` read their verdicts again.
  - Separately, `fixture({ cap: false })` answers `null` after three passes: no pass there ever judged.

  **Mutations:**
  - (a) delete the reduction at the switch/caps return: `demo-b` stays, red with `expected { eligible: true, … } to be undefined`;
  - (b) replace the reduction with `this.childReclaimJudged = new Map();`: `demo-a` is gone, red.
- **(iv) A failed read reduces the same way.**
  - Use the same three children, judged once. Then run a pass whose `childReclaimSessionIds` throws (`vi.spyOn(f.coord, 'childReclaimSessionIds').mockImplementation(() => { throw new Error('mirror unreadable'); })`, restored after).
  - `demo-a` is kept, and `demo-b` is absent.
  - `childReclaimSessionIds` is the first read in the fail-shut `try`, and Task 0c does not touch it.

  **Mutation:** delete the reduction in the `catch`. `demo-b` stays, red.
- **(v) A row the registry stops listing is absent from the next judging pass's map.** Remove its fields, as at `:1534-1536`.

  **Mutation:** make `judged` a field that is created once and never re-created per pass. The stale id survives, and the case reds.
- **(vi) R42's not-finished family.**
  - Set up:
    - `const r = f.openRun(); f.abandon(r);`
    - plant `demo-a` with `{ child: String(r.id), hold: holdReason(r.program, 2, null, null) }` (the non-final close's re-hold);
    - open a second run in the same programme: `f.coord.openRun({ program: r.program, title: r.program, project: 'demo', wave: 2, waveOf: null, claimedBy: 'demo-coord' })`, the idiom at `:605`.
  - One pass reads `{ eligible: false, why: 'held' }`.
  - Abandon the second run. The next pass reads `toMatchObject({ eligible: false, why: 'hold-retired' })`.

  This case is coverage: it pins that the accessor carries the close's not-finished cases to the chip. Mutation (ii) reds it.
- **(vii) The coordinating log line, once.** Run three passes over the coordinating case with `console.warn` spied. Expect exactly one call whose text contains both `demo-a` and `never reclaimed automatically`.

  **Mutation:** remove `&& why !== 'coordinating'` from the filter. That gives 0 calls, red.

**SAFETY.** The SAFETY lens (mandatory, R47) reads this task. Its properties:
- `childReclaimSweepVerdict` is not edited.
- The only new statement in the loop is a write to a pass-local map.
- The two reduction sites each add one assignment of the verdict field, and remove nothing.
- `git diff` over `sweepChildReclaim` shows no moved line.

**Routing.** `opus`, effort `high` (R47: the verdict accessor).

**Deploy class.** Server only.

### A-S3-7 — NEW Task 4c: the attention list's kept arm, the lost-database collapse, and the kept feed row (R41; amends contract R5; F6), after Task 4b

**Why.** R41 rules four things for the kept words:
- they "reach the Runs attention list from the first pass that answers one, one emit per change (the coord frame's byte-equality guard)";
- each "writes one `child reclaim kept` feed row per child, per word, per process";
- "when more than five children answer the same kept word, the banner shows one line for that word with the count, and the list behind it";
- "Doubt words … do not reach the banner".

Contract R5 (`child-reclamation-contract.md:339-343`) says the list is derived "from the mirror ONLY — no in-memory memo feeds `CoordStatus` or the frame". The shipped list's only write is section ONE's `this.childReclaimAttentionList = childReclaimAttention({ … })` (`watch.ts:3137-3139`). So F6's carried question ("whether R37's and R-5d's skips reach the attention list") cannot be answered yes until R5 is amended. R41 amends it.

**One item per child.** A kept child is never asked, so its mirror failure run can still stand past the ceiling: after a lost database, every re-ingested failure does. The failing arm's sentence ("While automatic reclamation is running, ccrc retries it") is false for such a child. So:
- a kept item REPLACES a failing item for the same child (the accepted `kept-replaces-failing-on-the-banner`);
- a terminal item stands, and that child gets no kept item, because ccd's own terminal word outranks it, as on the chip (A-S3-4);
- the banner's `key={a.sessionId}` therefore stays unique.

**A held child has no failing item** (R41, as contract §11 rules it for a held child on wave 4's failing arm). A child whose last judged verdict is `held` is never asked while the hold stands, so the failing arm's sentence is false for it too, and R41 keeps `held` off the banner. So:
- the failing arm does not list a child whose recorded verdict is `held`;
- with no verdict recorded (after a restart, or after a pass that judged nothing, which drops `held` because it is transient), wave 4's failing arm stands unchanged; under a pause the banner's paused state already governs;
- a terminal item for a held child stands;
- a doubt verdict withholds nothing: only `held` does.

**Contract R5, as it reads from this wave.** Contract §11's R41 carries it. Code comments cite spec §5.9.

> The attention list is derived from durable state (the lifecycle mirror, the registry listing and coord.db) by the sweep's own passes. Its `terminal` and `failing` arms are derived by EVERY pass, from the mirror. Its `kept` arm is derived by every pass that JUDGED: the switch down, both reclaim capabilities advertised, and the mirror and coordination reads succeeded. The kept arm is retained across a pass that judged nothing, and never erased by one. A child has one item: a kept item replaces a failing item for the same child, and a terminal item stands. A child whose last judged verdict is `held` has no failing item; with no verdict recorded, the failing arm stands. No executor answer and no sweep entry (`ChildReclaimSweepEntry`) is ever an input. A restart rebuilds the mirror arms on its first pass, and the kept arm on its first judging pass. Doubt words and `held` never reach the list.

**Binding text.**

**Files.**
- `server/src/childReclaimSweep.ts` (L1)
- `server/src/watch.ts` (L4)
- `server/src/coord/childReclaim.ts`: the kept feed writer, ABOVE the wave-5 banner
- tests: `child-reclaim-sweep-policy.test.ts` and `child-reclaim-sweep.test.ts`

**Interfaces (Produces).**
```ts
// childReclaimSweep.ts (L1). `ChildReclaimJournalAttention` is Task 1's (A-S3-1).
export type ChildReclaimKeptAttention = Extract<ChildReclaimAttention, { readonly kind: 'kept' }>;
/** More children than this answering ONE kept word collapse into one line. */
export const CHILD_RECLAIM_KEPT_MANY_OVER = 5;
export function childReclaimKeptItems(i: {
  readonly verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>;
  readonly live: ReadonlyMap<string, number | null>;   // listed rows → the marker's run id, null when not a child
  readonly mirrorArms: readonly ChildReclaimJournalAttention[];
}): ChildReclaimKeptAttention[];
export function childReclaimKeptList(items: readonly ChildReclaimKeptAttention[]): ChildReclaimAttention[];
export function childReclaimKeptManySentence(word: ChildReclaimKeptWord, n: number): string;
export function childReclaimAttentionWithKept(
  mirrorArms: readonly ChildReclaimJournalAttention[], kept: readonly ChildReclaimKeptAttention[],
  verdicts: ReadonlyMap<string, ChildReclaimSweepVerdict>,
): ChildReclaimAttention[];
// childReclaim.ts
export const CHILD_RECLAIM_KEPT_FEED_TITLE = 'child reclaim kept';
export function recordChildReclaimKeptFeed(
  deps: Pick<ChildReclaimDeps, 'coord' | 'notifyLog'>, a: ChildReclaimKeptAttention): void;
```

**Steps.**

1. **Red first:** write the cases below.
2. **L1.**
   - **`childReclaimKeptItems`** emits one `{ kind: 'kept', sessionId, runId, word, sentence }` per verdict that meets all of these:
     - it is not eligible, and `isChildReclaimKeptWord(v.why)` holds;
     - `live.get(sessionId)` is a number (the row is listed, and is still a child);
     - no `terminal` item in `mirrorArms` names its session.

     The `sentence` is `CHILD_RECLAIM_SKIP[word].sentence`. Items are sorted by `sessionId`.
   - **`childReclaimKeptList`** walks `CHILD_RECLAIM_KEPT_WORDS` in order. A word with MORE than `CHILD_RECLAIM_KEPT_MANY_OVER` items becomes ONE item: `{ kind: 'kept-many', word, members: items.map((a) => ({ sessionId: a.sessionId, runId: a.runId })), sentence: childReclaimKeptManySentence(word, n) }`. Other words' items stay single. The result is the singles (sorted by `sessionId`), followed by the groups (in word order).
   - **`childReclaimKeptManySentence(word, n)`** is `` `${n} child workspaces are kept for the same reason. For each one: ${CHILD_RECLAIM_SKIP[word].sentence}` ``.
   - **`childReclaimAttentionWithKept`** returns `[...mirrorArms.filter((a) => !(a.kind === 'failing' && (keptIds.has(a.sessionId) || heldIds.has(a.sessionId)))), ...childReclaimKeptList(kept)]`, where:
     - `keptIds` is the set of the kept items' sessions;
     - `heldIds` is the set of ids whose verdict in `verdicts` is `{ eligible: false, why: 'held' }`, and no other verdict.

     A `terminal` item is never filtered.

   The result is deterministic, so the byte-equality guard emits once per change.
3. **L4: ONE write site.**
   - Section ONE's assignment becomes `const mirrorArms = childReclaimAttention({ … });`. The derivation is unchanged.
   - Add a field `private childReclaimKeptReported = new Map<string, Set<ChildReclaimKeptWord>>();`. Document it as: "which kept words this process has fed for which child: one feed row per child, per word, per process (spec §5.9); pruned when the registry stops listing the child, so a later workspace under a recycled id is a new child".
   - Directly after `live` is built (`:3133-3134`), prune: `for (const id of [...this.childReclaimKeptReported.keys()]) if (!live.has(id)) this.childReclaimKeptReported.delete(id);`.
   - Add the private method:
     ```ts
     /** THE ONE WRITE of the attention list (spec §5.9): the mirror arms this pass derived, then the kept
      *  arm from the verdicts as they stand (the last judging pass's, or its kept verdicts alone), filtered
      *  to this listing, with no failing item for a child whose recorded verdict is `held`. L1 decides
      *  every item; this method only assigns. */
     private childReclaimPublishAttention(mirrorArms: readonly ChildReclaimJournalAttention[],
       live: ReadonlyMap<string, number | null>): ChildReclaimKeptAttention[] {
       const verdicts = this.childReclaimJudged ?? new Map<string, ChildReclaimSweepVerdict>();
       const kept = childReclaimKeptItems({ verdicts, live, mirrorArms });
       this.childReclaimAttentionList = childReclaimAttentionWithKept(mirrorArms, kept, verdicts);
       return kept;
     }
     ```
   - It is called at TWO places:
     - In the switch/caps branch (`:3151-3156`), directly after A-S3-6's reduction and before the three `.clear()` calls. So a paused or capability-less fleet still reports, as section ONE did before. Its kept items stay listed, and a held child's failing item returns, because the reduction dropped its transient `held` verdict.
     - Directly after A-S3-6's `this.childReclaimJudged = judged;`.
   - The mirror fail-shut `catch` calls neither. It keeps the last list, kept items included, as today.
4. **The feed row, judging passes only.** After the second call:
   ```ts
   for (const a of kept) {
     const words = this.childReclaimKeptReported.get(a.sessionId) ?? new Set<ChildReclaimKeptWord>();
     if (words.has(a.word)) continue;
     words.add(a.word);
     this.childReclaimKeptReported.set(a.sessionId, words);
     recordChildReclaimKeptFeed({ coord, notifyLog: this.deps.notifyLog }, a);
   }
   ```
   One row per CHILD, collapsed or not. Recorded, never pushed.
5. **`recordChildReclaimKeptFeed`** goes beside `recordChildReclaimFeed` (`childReclaim.ts:1232-1248`), in its idiom exactly:
   - `if (!log) return`;
   - `log.record({ kind: 'run', sessionId: a.sessionId, runId: a.runId, title: CHILD_RECLAIM_KEPT_FEED_TITLE, body: `${a.sessionId}, child of run #${a.runId}: ${a.sentence}` })`;
   - then `deps.coord.recordFeedEvent(log.epoch, ev)`;
   - `catch` → `console.warn('ccrc-server: recordFeedEvent failed (…) — child reclaim kept, feed archive degraded')`;
   - `finally { void log.flush(); }`.
6. **Docstrings.**
   - Rewrite the `childReclaimAttentionList` field docstring (`watch.ts:1015-1027`) to the contract R5 text above. It says: one write site (`childReclaimPublishAttention`); the mirror arms on every pass; the kept arm from the verdicts as they stand, kept across a pass that judged nothing; one item per child; no failing item for a child whose recorded verdict is `held`; never an executor answer, never a sweep entry.
   - Section ONE's comment "The ONLY write of the list: the mirror derivation's result" becomes "the mirror arms; the list itself is written once, by `childReclaimPublishAttention`".
   - The `childReclaimJudged` field docstring (A-S3-6) gains: "Read by the run chip, through `currentChildReclaimVerdicts()`, and by the attention list's one write: its kept arm, and the failing items it withholds for a held child."

**Cases (all red first).**

Policy (L1):
- **(i) Selection.** Verdicts `{a: coordinating, b: hold-unmeasured, c: held, d: review-report-live, e: eligible}`, all listed as children of run 7, give exactly `[{ kind: 'kept', sessionId: 'a', runId: 7, word: 'coordinating', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence }]`.

  **Mutation:** replace `isChildReclaimKeptWord(v.why)` with `CHILD_RECLAIM_SKIP[v.why].class !== 'ordinary'`. `b` and `c` appear, red.
- **(ii) Terminal wins.** With `mirrorArms` holding a `terminal` item for `'a'`, the result is `[]`. A `failing` item for `'a'` does not suppress it.

  **Mutation:** filter on any mirror-arm session. The failing row reds.
- **(iii) Listing.** A verdict for an id not in `live`, or one whose `live` value is `null`, lists nothing.

  **Mutation:** drop the `live` check. Red.
- **(iv) The collapse.**
  - Six `minting-run-absent` children and one `coordinating` child give `[single coordinating, { kind: 'kept-many', word: 'minting-run-absent', members: <6, sorted>, sentence: childReclaimKeptManySentence('minting-run-absent', 6) }]`.
  - Five give five singles.

  **Mutations:**
  - `>` → `>=`: the five-children case collapses, red;
  - return the items uncollapsed: the six-children case reds.
- **(v) One item per child.** `childReclaimAttentionWithKept([failing a, terminal b], [kept a], new Map())` equals `[terminal b, kept a]`.

  **Mutation:** return `[...mirrorArms, ...childReclaimKeptList(kept)]`. The failing item for `a` remains, red.
- **(xiii) A held child's failing item is withheld, and nothing else is.** `childReclaimAttentionWithKept([failing a, terminal b, failing c, failing d], [], verdicts)`, where `verdicts` maps `a` and `b` to `{ eligible: false, why: 'held' }` and `d` to `{ eligible: false, why: 'hold-unmeasured' }`, and has no entry for `c`, equals `[terminal b, failing c, failing d]`.

  **Mutations:**
  - (a) drop the held check (`heldIds` always empty): the failing item for `a` remains, red;
  - (b) widen it to every non-ordinary verdict (`CHILD_RECLAIM_SKIP[v.why].class !== 'ordinary'`): the failing item for `d` is withheld, red.

Lane (`child-reclaim-sweep.test.ts`). Each case uses a `NotifyLog` loaded as at `:1500-1503`, with `fixture({ home, notifyLog })`.
- **(vi) The current-generation coordinating case (`:810`).**
  - After ONE pass and `await f.watcher.tick()`, `currentCoord()?.childReclaimAttention` equals `[{ kind: 'kept', sessionId: 'demo-a', runId: r1.id, word: 'coordinating', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence }]`.
  - After three passes, `f.requests` is `[]`.
  - `f.coord.feedEvents(50).filter((e) => e.title === 'child reclaim kept')` has length 1.

  **Mutations:**
  - (a) in the method, `this.childReclaimAttentionList = [...mirrorArms];`: the list is `[]`, red;
  - (b) delete `if (words.has(a.word)) continue;`: 3 rows, red.
- **(vii) Restart.** A second `fixture({ coord: f.coord, home: f.home, notifyLog })` lists the item after its own first pass, and writes exactly one more row (2 in all). Mutation (a) reds it too.
- **(viii) Paused.** After pass 1 lists the item, raise `reclaim-paused` and run pass 2.
  - `currentChildReclaimVerdicts()?.get('demo-a')` is still `{ eligible: false, why: 'coordinating' }`.
  - The kept item is STILL listed.
  - No new feed row is written.

  **Mutation:** in the switch/caps branch, replace A-S3-6's reduction with `this.childReclaimJudged = null;`. The item is gone, red. The shipped cases "…and still REPORTS" (`:861-880`) red if the switch branch's publish call is deleted.
- **(ix) Mirror fail-shut.** After a pass that lists the item, a pass whose `childReclaimSessionIds` throws leaves the list deep-equal to before.

  **Mutation:** call `this.childReclaimPublishAttention([], new Map())` in the `catch`. Red.
- **(x) A recycled id is a new child.**
  - The row vanishes: remove its registry fields, as at `:1534-1536`. The next pass does not list it.
  - Re-plant the same id as a kept child. The next pass writes a SECOND feed row.

  **Mutation:** delete the prune loop. Still one row, red.
- **(xi) A lost database.** Six children whose markers name run `9999`, which the database does not hold, give ONE `kind: 'kept-many'` item with six members, and six feed rows.

  **Mutation:** publish `[...mirrorArms, ...kept]` (no collapse). Six items, red.
- **(xii) A kept child with a standing failure run is listed once, as kept.**
  - Use the coordinating case, plus `f.journal('demo-a', 'failed', 'pin-failed')`, then `f.advance(CHILD_RECLAIM_DEFER_CEILING_MS)`, then intent and failed again (the `:1355-1360` idiom).
  - After a pass and a tick, the list is exactly the one kept item for `demo-a`.

  **Mutation:** as (v). Two items for `demo-a`, red.
- **(xiv) A held child's failure run past the ceiling is not on the banner.**
  - `const r = f.openRun(); f.abandon(r); f.plant('demo-c', { child: String(r.id), hold: 'kept by hand' });`, then `f.journal('demo-c', 'failed', 'pin-failed')` and a pass, then `f.advance(CHILD_RECLAIM_DEFER_CEILING_MS)`, then `intent` and `failed pin-failed` again (the `:1355-1360` idiom), then `f.next()`, a pass and `await f.watcher.tick()`.
  - `currentCoord()?.childReclaimAttention` is `[]`, and `f.requests` is `[]`.
  - Then raise `reclaim-paused`, `f.next()`, run a pass and tick. The list holds exactly one `kind: 'failing'` item, for `demo-c`: with no verdict recorded, wave 4's failing arm stands.

  **Mutation:** as (xiii)(a). The first expectation lists a `failing` item for `demo-c`, red.

Every existing attention `toEqual` keeps passing. They already carry `kind` from A-S3-1, and no shipped attention case has a kept child or a held one (the sweep suite's held plants sit at `:243-776`, before its first attention read at `:1066`).

**SAFETY.** The list's write moved from one site above the switch to one method called on both sides of it. The SAFETY lens confirms these:
- the switch branch still publishes before its `return`;
- the `catch` publishes nothing;
- no sweep-entry write, executor call or release call moved;
- the held filter withholds only `failing` items, and only for a recorded `held` verdict;
- the recorded verdicts reach the attention list and nothing else. The list reaches only the frame and `feedQuiet` (A-S3-8). A child is dispatched only on an eligible verdict in the same pass, so no kept or held filter can change a dispatched child's `feedQuiet`, and no ask reads the verdicts.

**Routing.** `sonnet`, effort `high` (R47's floor). The SAFETY lens reads the publish move and the held filter.

**Deploy class.** Server only. The PWA renders `kept` items with no change. `kept-many` needs A-S3-10's Task 6b.

### A-S3-8 — NEW Task 4d: feed rows de-duplicated (R44), after Task 4c (and after Task 0b, whose entry it extends)

**Why.** R44 rules:
- "A non-presence deferral writes one feed row per episode, not one per pass."
- "A child already on the attention list adds no identical failure rows. A row is written again only when the word changes or the child leaves the list."
- "Presence deferrals keep today's shape."

Measured by the attention-visibility design:
- An executor `deferred` clears the failure pacing (`childReclaimNextEntry`, `childReclaimSweep.ts:447-459`), so `childReclaimDue` re-asks it every pass.
- `reclaimChild` writes one feed row per outcome (`childReclaim.ts:680-684`; `recordChildReclaimFeed` at `:1232-1248`). That is one row a minute for `state-changed`, `reap-in-progress` or `marker-mismatch`.
- `expoAI-assistant-calm-mesa` (`pin-failed`, branch gone) writes a row every 15 minutes, indefinitely.

**Binding text.**

**Files.**
- `server/src/childReclaimSweep.ts` (L1)
- `server/src/watch.ts`: the request literal
- `server/src/coord/childReclaim.ts`: ABOVE the wave-5 banner
- `server/src/coord/close.ts`: the request literal
- tests: `child-reclaim-sweep-policy.test.ts`, `child-reclaim-sweep.test.ts`, `child-reclaim.test.ts` and `child-reclaim-close.test.ts`, plus every request literal `typecheck-tests` names (`child-reclaim-paused-at-server.test.ts`, and `child-reclaim.test.ts`'s `req` builder at `:107-109`)

**Interfaces (Produces).**
```ts
// childReclaimSweep.ts (L1)
// ChildReclaimSweepEntry gains:
/** The `why` of the latest outcome when it was a deferral, or null after any other outcome:
 *  the deferral EPISODE a feed row is written once for (spec §5.9). No pacing reads it. */
readonly lastDeferWhy: string | null;
export interface ChildReclaimFeedQuiet {
  /** The non-presence deferral episode this child is in, or null. */
  readonly deferWhy: string | null;
  /** The token of this child's `failing` attention item, or null when the failing arm does not list
   *  it, or lists it with no token. */
  readonly failureToken: string | null;
}
export function childReclaimFeedQuiet(entry: ChildReclaimSweepEntry,
  listed: readonly ChildReclaimAttention[], sessionId: string): ChildReclaimFeedQuiet;
// childReclaim.ts
// ChildReclaimRequest gains:  readonly feedQuiet: ChildReclaimFeedQuiet;
export const CHILD_RECLAIM_FEED_QUIET_NONE: ChildReclaimFeedQuiet;   // { deferWhy: null, failureToken: null }
// ChildReclaimVerbRead's and ChildReclaimOutcome's `failed` arms gain:  readonly token: string | null;
export function childReclaimFeedSkips(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest): boolean;
```

**Steps.**

1. **Red first:** write the cases below.
2. **The entry.**
   - `childReclaimFirstSighting(monoMs, bornAt)` (Task 0b's signature) gains `lastDeferWhy: null`.
   - In `childReclaimNextEntry` (Task 0b's signature): `deferred` sets `lastDeferWhy: outcome.why`. `failed` and `refused` set `lastDeferWhy: null`, and so does every other arm that builds an entry. A rejection, which Task 0b writes through the `failed` arm, therefore sets it `null` too.
   - Task 0b's first-sighting literal (policy `:354-355` at HEAD, as Task 0b leaves it) gains `lastDeferWhy: null`.
   - Every full-entry `toEqual` on a `deferred` answer in the policy suite gains `lastDeferWhy`. As hints at HEAD: `child-reclaim-sweep-policy.test.ts:397`, `:408`, `:429` and `:436`, wherever Task 0b leaves them. Before this edit, those four cases red at runtime with `lastDeferWhy` differing.
3. **`childReclaimFeedQuiet`.**
   - `deferWhy` is `entry.lastDeferWhy` when it is non-null and NOT in `CHILD_RECLAIM_PRESENCE_DEFERS`; else null. Presence keeps today's shape.
   - `failureToken` is the `token` of the item in `listed` with `kind === 'failing'` and this `sessionId`, when that token is non-empty; else null.
4. **The lane.** The request literal in section FOUR (`watch.ts:3401-3418`) gains `feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id),`, read from the list this pass just published.
5. **Close, and the request's docstring.**
   - The close's request literal (`close.ts:750`) gains `feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE`. Close is always a first attempt.
   - The interface body gains `readonly feedQuiet: ChildReclaimFeedQuiet;` directly after `readonly deferredSinceMs: number | null;`, with no comment of its own.
   - `ChildReclaimRequest`'s docstring gains ONE paragraph, placed directly ABOVE its `deferredSinceMs` paragraph (the one beginning ``*  `deferredSinceMs`: epoch ms of the FIRST deferral the sweep``), with a ` *` line on each side:
     ```
      *  `feedQuiet`: what the feed already says for this child (spec §5.9): the
      *  non-presence deferral episode it is in, and the failure word the
      *  attention list shows for it. The executor decides nothing on it but
      *  whether its own feed row repeats them (`childReclaimFeedSkips`). Close
      *  sends `CHILD_RECLAIM_FEED_QUIET_NONE`.
     ```
   - Nothing from the `deferredSinceMs` paragraph's first line to the docstring's closing `*/` changes. Task 9c's G5 replacement matches that paragraph by content, from its first line through `fingerprint input on the box and this is not.`, so it finds its span intact, with this paragraph above it.
   - The paragraph contains no single-quoted kebab word, because `mail-routes.test.ts`'s scanner reads `server/src/coord` comments too.
6. **The failure's token.**
   - The `failed` arms of `ChildReclaimVerbRead` (`childReclaim.ts:623`) and `ChildReclaimOutcome` (`:255-256`) gain `readonly token: string | null`. This is ccd's own failure word: the mirror line's `refusal` for the same attempt (`_ws_reclaim_fail` writes both from one `$tok`, `ccd/ccd:27505-27507`).
   - Each constructor sets it:
     - the `{failed:<w>}` document (`:659`) → `v.failed`;
     - a pre-lock die (`:664`) → the matcher's token;
     - every other constructor (`:631`, `:645`, `:665`, `:812`, `:903`) → `null`;
     - `:822` passes `act.token` through.
   - `CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS` becomes `readonly { readonly re: RegExp; readonly token: ChildReclaimPreLockToken | null }[]`. The flock pattern's token is `CHILD_RECLAIM_PRE_LOCK_TOKEN.flock`, and every other pattern's is `null`.
   - `matchChildReclaimPreLockDie` returns `{ readonly msg: string; readonly token: ChildReclaimPreLockToken | null } | null`. Its lock-unopenable arm answers `token: CHILD_RECLAIM_PRE_LOCK_TOKEN.lock`. `matchChildReclaimLockUnopenableDie` is unchanged. No regex is spelled twice.
   - Import `CHILD_RECLAIM_PRE_LOCK_TOKEN`, `type ChildReclaimPreLockToken` and `type ChildReclaimFeedQuiet` into the one `../childReclaimSweep.js` import (Task 0c's, extended by A-S3-4).
   - **No quoted `'flock-unavailable'` or `'lock-unopenable'` literal is written under `server/src/coord`, comments included.** `mail-routes.test.ts`'s kebab scanner (`:571`) reads every quoted kebab literal there, and admits neither (`isChildReclaimKebab`, `childReclaim.ts:484-488`). The tokens are read by property, and named in backticks in comments.
7. **The skip.**
   ```ts
   /** Does this outcome repeat what the feed already says (spec §5.9)? A ceiling-expired attempt
    *  always writes: its row states the wait it ended. */
   export function childReclaimFeedSkips(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest): boolean {
     if (req.deferExpired) return false;
     if (o.kind === 'deferred') return req.feedQuiet.deferWhy === o.why;
     if (o.kind === 'failed') return o.token !== null && req.feedQuiet.failureToken === o.token;
     return false;
   }
   ```
   - `reclaimChild` (`:680-684`) becomes `if (outcome.kind !== 'gone' && !childReclaimFeedSkips(outcome, req)) recordChildReclaimFeed(deps, outcome, req);`.
   - Its docstring's "Every outcome but `gone` writes exactly ONE feed row" becomes "…writes one feed row, unless it repeats the deferral episode or the listed failure the request names (`childReclaimFeedSkips`)".
   - Spec §5.9's "one feed row per outcome" is amended by the ruling, in the coordinator's docs commit (A-S3-14's list).
8. **Every exact `toEqual` on a request gains `feedQuiet`.** `CHILD_RECLAIM_FEED_QUIET_NONE` serves both close and sweep, because every listed sweep site is a first ask. The sites:
   - `child-reclaim-sweep.test.ts:260`, `:353`, `:435`, `:470`, `:508`, `:536`, `:682`, `:695`, `:708` and `:1220`;
   - `child-reclaim-close.test.ts:99`, `:277` and `:364`.

   Before this edit those 13 expectations red at runtime: each actual request carries one key more than its literal. `typecheck-tests` cannot name them.
9. **Runs.** Step 4 runs:
   - `test/mail-routes.test.ts` beside the suites above. It must stay green.
   - `test/child-reclaim-paused-at-server.test.ts`.

**Why `deferExpired` is a real conjunct.**
1. A child listed `failing` can begin a server-side `presence` episode.
2. Server-side presence journals nothing, so the mirror's failure run stands.
3. A licensed attempt then fails with the same token.
4. Its row must still say that the ceiling ended the wait.

**Cases (all red first).**

Policy:
- **`lastDeferWhy`.**
  - `deferred state-changed` sets `'state-changed'`.
  - A later `failed` sets `null`.
  - The first sighting reads `null`.

  **Mutation:** leave the `failed` branch's spread without `lastDeferWhy: null`. The stale word survives, red.
- **`childReclaimFeedQuiet`, table-driven.**
  - `lastDeferWhy` `'state-changed'` gives `deferWhy` `'state-changed'`.
  - `'presence'`, `'attached'` and `'tree-busy'` each give `null`.
  - With a `failing` item for this session, `failureToken` is its token.
  - A `failing` item with token `''` gives `null`.
  - A `terminal` item for this session gives `null`, and so does a `failing` item for another session.

  **Mutations:**
  - drop the presence exclusion: the presence row reds;
  - match any `kind`: the terminal row reds.

Executor (`child-reclaim.test.ts`):
- **`childReclaimFeedSkips`, table-driven.**

  | Outcome | `feedQuiet` / request | Answer |
  |---|---|---|
  | deferred `state-changed` | `deferWhy` `state-changed` | true |
  | deferred `held` | `deferWhy` `state-changed` (the word changed) | false |
  | deferred `state-changed` | `deferWhy` null | false |
  | failed, token `pin-failed` | `failureToken` `pin-failed` | true |
  | failed, token `unit-still-active` | `failureToken` `pin-failed` | false |
  | failed, token null | `failureToken` null (not listed) | false |
  | failed, token `pin-failed` | `failureToken` `pin-failed`, `deferExpired: true` | false |
  | `reclaimed` | any | false |
  | `refused` | any | false |

  **Mutations:**
  - drop `if (req.deferExpired) return false;`: the ceiling row reds;
  - drop `o.token !== null &&` and pass a request with `failureToken: null`: the null-token row reads true, red.
- **Wiring through `reclaimChild`.**
  - A ccd answer that the executor reads as `deferred state-changed`, with `feedQuiet.deferWhy: 'state-changed'`, adds no row to `t.feed()`.
  - The same request with `CHILD_RECLAIM_FEED_QUIET_NONE` adds one.

  **Mutation:** call `recordChildReclaimFeed` unconditionally. Red.
- **`parseChildReclaimResult`'s token.**
  - the flock die → `token: 'flock-unavailable'`;
  - the lock die (the `:440` shape) → `'lock-unopenable'`;
  - a usage die → `null`;
  - `{"failed":"pin-failed",…}` → `'pin-failed'`;
  - `probe-unmeasured` → `'probe-unmeasured'`.

  Every existing `toEqual` on a `failed` read gains its `token`: `child-reclaim.test.ts:271`, `:286`, `:290`, `:346` (its table gains each message's token), `:357`, `:362`, `:404`, `:429`, `:436`, `:440` and `:451`.

  **Mutation:** map the flock pattern's token to `null`. Red.
- **The scanner binds.** **Mutation:** write the flock pattern's token as the quoted literal `'flock-unavailable'` instead of `CHILD_RECLAIM_PRE_LOCK_TOKEN.flock`. `mail-routes.test.ts`'s "every quoted kebab token in server/src/coord that looks like a code is declared" reds, naming `flock-unavailable`.

Lane (`child-reclaim-sweep.test.ts`):
- **The deferral episode.** The stub answers `deferredAs('state-changed', req)`. Over enough passes for five asks:
  - `f.requests[0].feedQuiet.deferWhy` is `null`;
  - every later request's is `'state-changed'`.

  **Mutation:** do not set `lastDeferWhy` in the `deferred` branch. All read `null`, red.
- **The listed failure.**
  - The mirror is seeded with `failed pin-failed` lines spanning the ceiling, and the stub answers `failed` with `token: 'pin-failed'`.
  - The child's next request carries `feedQuiet.failureToken: 'pin-failed'`.
  - An unlisted child's request carries `null`.

  **Mutation:** compose `failureToken: null` always. Red.

The sweep stubs at `child-reclaim-sweep.test.ts:982`, `:1001` and `:1061` gain `token: null`. Task 2b's case (viii) stub gains `token: 'flock-unavailable'`. Every request literal `typecheck-tests` names gains `feedQuiet`.

**Routing.** `sonnet`, effort `high`. The SAFETY lens confirms that the skip changes no outcome, no dispatch and no pacing: `lastDeferWhy` is read only by `childReclaimFeedQuiet`.

**Deploy class.** Server only.

### A-S3-9 — Task 5: the sweep-entry mock, the verdict accessor's wiring, and the cases R41 to R43 add (A-iface-4)

**Why.**
- **A-iface-4: the mock does not type-check.**
  - Case 5's sweep-entry literal names four fields, but the shipped `ChildReclaimSweepEntry` has eight (`childReclaimSweep.ts:67-99`), and Tasks 0b and 4d add more.
  - `mockReturnValue` is type-checked by `typecheck-tests`. So the literal is a TS2741 naming several fields, not the single one plan:1960 anticipates.
- **The composer gains two inputs:** the verdict accessor and a clock (A-S3-4).
- **"No verdict yet" reaches the route.** A watcher that has never judged now answers `S.unjudged`. So the cases that expected plain `pending` must say what judged them.

**Binding text.**

**1. The composer.** `composeChildReclaim`'s `withChildReclaim(summaries, { … })` gains these lines:
```ts
      // The sweep's last verdicts (spec §5.9). `null` is "no judging pass", which the chip reads as
      // not judged yet, never as eligible. Never defaulted to a map.
      verdicts: watcher?.currentChildReclaimVerdicts() ?? null,
      nowMs: Date.now(),
```
The docstring's COST paragraph adds "the sweep's verdicts" to the watcher's in-memory copies.

**2. The mock (A-iface-4).** This is the ONE binding copy of case 5's literal. Task 0b's amendment points here, and carries no copy of its own.
- Import `childReclaimFirstSighting` from `'../src/childReclaimSweep.js'`.
- Case 5's entry becomes `{ ...childReclaimFirstSighting(5_000, null), firstDeferredAt: T_CLOSE + 9_000, firstPresenceDeferredAt: 35_000, lastPresenceDeferredAt: 35_000, lastPresenceWallAt: T_CLOSE + 30_000, presenceHeldSince: 35_000, lastAskedAt: 35_000 }`.
  - The two arguments and the field names are Task 0b's, as its amendment fixes them: `childReclaimFirstSighting(monoMs, bornAt)`, and the entry's `lastPresenceWallAt`, `presenceHeldSince`, `lastAskedAt` and `bornAt`. The second argument is `null`, written explicitly: it is `bornAt`'s idle value, which Task 0b's amendment prescribes for a spread that models no workspace generation. No field the chip reads depends on it.
  - The decision clocks are monotonic-looking numbers, so a chip that read any of them as its `at` would red the `at: T_CLOSE + 9_000` expectation. `firstDeferredAt` is epoch, because it is the chip's `at` (R39). `lastPresenceWallAt` is wall, because it is the presence gap's wall operand.
  - `lastDeferWhy` and later fields flow through the spread with no edit.
- The expected answer stays `{ word: 'deferred', sentence: S.sweepDeferred, at: T_CLOSE + 9_000 }`.
- Delete plan:1960's paragraph ("add it with its idle value…"). The deviation bullet at plan:3195 goes with A4's replacement of that list, and A4 lists no Task 5 bullet in its place (A-S3-14): the spread is prescribed here, so it is not a departure.
- Mutation row 5 is unchanged.
- Mutation row 5b's expected red becomes `expected { word: 'deferred', …, at: 35000 } to deeply equal { word: 'deferred', …, at: 1758503609000 }`.

**3. Judged cases.** Add the helper:
```ts
const judgedAs = (w: FleetWatcher, v: ChildReclaimSweepVerdict): void => {
  vi.spyOn(w, 'currentChildReclaimVerdicts').mockReturnValue(new Map([[SID, v]]));
};
```
It needs `type ChildReclaimSweepVerdict` from `'../src/childReclaimSweep.js'`.

The expectations that read plain `S.pending` call `judgedAs(h.watcher, { eligible: true, runId: <that run's id> })` first:
- case 4's first expectation;
- case 6's second expectation (`coordAs('unmeasurable')`);
- case 7's second expectation (with `review.id`).

Every other expectation is unchanged. Case 6's first expectation (`coordAs('set')`) still reads `paused`: with no verdict, the row rule answers `unjudged`, and the switch replaces it.

**4. New cases** (append to the describe). Import `CHILD_RECLAIM_SKIP` and `childReclaimFailingSentence` from `'../src/childReclaimSweep.js'`, and `lcRefusalWord` from shared.
- **A.** "before the sweep has judged anything, a marked child reads not-judged-yet, never plain pending". Call `markedAs(h.watcher, id)` with no verdict spy (the watcher never ticked). Expect `{ word: 'pending', sentence: S.unjudged, at: null }`.
- **B.** "a child the sweep keeps as a coordinator's reads refused with the kept sentence, under the switch too". Call `judgedAs(h.watcher, { eligible: false, why: 'coordinating' })`. Expect `{ word: 'refused', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence, at: null }`. With `coordAs('set')`, the answer is unchanged.

  That second state is the one production reaches: a pass that judged nothing keeps its kept verdicts. A-S3-6's case (iii) proves that half against the real watcher.
- **C.** "the sweep's own run of failures, with nothing in the mirror, reads deferred". The defers spy is `{ ...childReclaimFirstSighting(5_000, null), consecutiveFailures: 2 }`. Expect `{ word: 'deferred', sentence: S.sweepFailing, at: null }`.
- **D.** "a pre-lock refused line reads deferred with its journal word, never refused". Journal `create` at `T_CREATE`, then `{ at: Date.now() - 60_000, act: 'reclaim', outcome: 'refused', refusal: 'flock-unavailable', id: SID }`. Expect `{ word: 'deferred', sentence: lcRefusalWord('flock-unavailable'), at: <that at> }`.
- **E.** "a failure run past the ceiling reads the attention list's own sentence". Journal `create` at `T_CREATE`, then `failed`/`pin-failed` at `T_CLOSE + 5_000`, which is long past the ceiling at the real clock. Expect `{ word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed')), at: T_CLOSE + 5_000 }`.
- **F.** "a not-finished child of an open programme reads deferred with the hold sentence" (R42). Call `judgedAs(h.watcher, { eligible: false, why: 'held' })`. Expect `{ word: 'deferred', sentence: CHILD_RECLAIM_SKIP.held.sentence, at: null }`.

**5. Counts.**
- Step 2's expected result becomes FAIL, 14 of 17:
  - cases 1, 2, 4, 5, 6, 7 and A to F report `expected null to deeply equal { word: … }`;
  - case 3 reports `expected undefined to be 'reclaimed'`;
  - case 11 reports `expected false to be true`;
  - cases 8 to 10 pass.
- Step 4 expects 17/17.

**Mutations (Step 5's table gains these).**

| # | Exact edit | Expected red |
|---|---|---|
| 11 | `verdicts: watcher?.currentChildReclaimVerdicts() ?? null,` → `verdicts: null,` | B and F: `expected { word: 'pending', sentence: 'This run has closed. The sweep has not judged…' } to deeply equal { word: 'refused', … }` (and `deferred` for F); case 4's first expectation too |
| 12 | `nowMs: Date.now(),` → `nowMs: 0,` | E: `expected { …sentence: <the pin-failed word> … } to deeply equal { …sentence: 'Every attempt…' }` |
| 13 | in `childReclaim.ts`'s `withChildReclaim`, `sweepFailing: …` → `sweepFailing: false,` | C: `expected { word: 'pending', … } to deeply equal { word: 'deferred', … }` |

Task 5's row 7, restated for A-S3-4's `marked`: change `row.kind === 'row' && row.child.kind === 'child' && row.child.runId === run.id` to `row.kind === 'row' && (row.child.kind !== 'child' || row.child.runId === run.id)`. Case 9 reds with the same text.

**Routing.** `sonnet`, effort `high`.

**Deploy class.** Server only.

### A-S3-10 — Task 6: the chip glyph's name (A-iface-12); NEW Task 6b: the banner's many-children line (R41)

**Why.**
- **A-iface-12: a near-homonym.** Wave 4 shipped `pwa/src/fleet/childReclaimWords.ts`, whose vocabulary includes `CHILD_RECLAIM_MARKER_GLYPH` (`:31-35`). Task 6's `CHILD_RECLAIM_GLYPH`, in another file, is a near-homonym of it.
- **R41: the collapsed line.** R41 rules: "The banner shows one line for that word with the count, and the list behind it."
  - A-S3-7's server emits that line as a `kind: 'kept-many'` item, which has no `sessionId`.
  - The PWA's one reader, `childReclaimAttentionOf` (`childReclaimWords.ts:68-72`), drops it under its `isAttention` rule.
  - So after a lost database, the banner would show nothing.

**Binding text: Task 6.**
- Rename `CHILD_RECLAIM_GLYPH` to `CHILD_RECLAIM_CHIP_GLYPH` everywhere Task 6 spells it:
  - Interfaces (plan:2093);
  - the test import and assertions (plan:2109, :2127, :2179);
  - the code (plan:2258, :2287, :2300);
  - mutation row 2 (plan:2423);
  - File Structure (plan:171).
- It stays in `runWords.ts`.
- Task 6's routing stays `sonnet`/`high`.

**Binding text: NEW Task 6b.** It comes after Task 6, and touches `pwa/src/fleet/childReclaimWords.ts`, `pwa/src/fleet/ChildReclaimBanner.tsx` and `pwa/test/child-reclaim-banner.test.tsx`.

1. **The reader** (`childReclaimWords.ts`):
   ```ts
   /** A collapsed kept line (spec §5.9): the server's sentence, which already states the count, and
    *  the children behind it. `word` is a React key and nothing else: it is never rendered and never
    *  switched on. */
   export interface RenderedKeptMany {
     readonly kind: 'kept-many'; readonly word: string; readonly sentence: string;
     readonly members: readonly { readonly sessionId: string; readonly runId: number }[];
   }
   export type RenderedAttentionItem = RenderedAttention | RenderedKeptMany;
   ```
   - `isKeptMany(a)` requires `kind === 'kept-many'`, a string `word` and `sentence`, and an array `members`.
     - A member that is not `{ sessionId: string; runId: number }` is dropped on its own.
     - An item left with no member is dropped.
   - `childReclaimAttentionOf` returns `RenderedAttentionItem[]`, keeping the server's order. It keeps each element that `isAttention` or `isKeptMany` accepts.
   - The header comment's "Checks only the fields `ChildReclaimBanner` actually RENDERS" gains the `kept-many` arm.
2. **The banner** (`ChildReclaimBanner.tsx`).
   - The `<ul className="child-reclaim-attention">` maps each item. A `RenderedKeptMany` renders:
     ```tsx
     <li key={`kept-many ${a.word}`} className="child-reclaim-item">
       <span className="child-reclaim-sentence">{a.sentence}</span>
       {a.members.map((m) => (
         <span key={m.sessionId} className="child-reclaim-who">{`run #${m.runId} · ${m.sessionId}`}</span>
       ))}
     </li>
     ```
   - Every other item renders as today, keyed on its `sessionId`. The server lists each child once (A-S3-7), so the keys stay unique.
   - The banner uses only existing classes and adds no control. So no new CSS rule, no tap-target entry and no contrast registration is owed.
   - The header comment gains: "A collapsed line names its children after the server's sentence; the PWA counts nothing itself."

**Cases (red first)** in `pwa/test/child-reclaim-banner.test.tsx`:
- **(i)** A frame whose attention list holds one `kind: 'kept-many'` item with six members renders ONE `li` containing the sentence and six `run #N · id` texts.

  **Mutation:** `childReclaimAttentionOf` filters with `isAttention` alone. The `li` is missing, red.
- **(ii)** A `kind: 'kept'` item renders `run #171 · <id>` and its sentence, like any item. This is the existing reader's path.

  **Mutation:** make `isAttention` require `typeof o.at === 'number'`. Red.
- **(iii)** A `kept-many` item with one malformed member (`runId: 'x'`) renders the other five.

  **Mutation:** drop the member filter. The render shows `run #x`, red.
- **(iv)** Mixed `kept` and `kept-many` items keep the server's order.

  **Mutation:** return the singles before the groups regardless of input order. Red.

**Routing.** `sonnet`, effort `high`.

**Deploy class.** PWA only, carried by the wave's server + pwa release.

### A-S3-11 — Task 8: one merged scan list, covering wave 4's two PWA reclaim files and the abandon sheet (A-iface-12)

**Why.**
- `pwa/src/fleet/childReclaimWords.ts` and `pwa/src/fleet/ChildReclaimBanner.tsx` render server reclaim sentences.
  - The banner is rendered at `RunsScreen.tsx:42` and `:672`, and A-S3-10 adds the kept-many line to it.
  - Yet Task 8's "PWA maps no token" pin scans only `runWords.ts`, `RunsScreen.tsx` and `SessionLine.tsx`.
- S4's R45 work rewrites `pwa/src/fleet/AbandonSheet.tsx` around the child mark, and S4 also amended this same list.
  - Two lists with conflicting indices cannot both bind.
  - So this is the ONE list, and Task 8 carries it whole, with `AbandonSheet.tsx` appended LAST. A[S4-1] carries no list of its own: Task 9b appends nothing to `FILES` and rewrites nothing in this census; it adds only its own cases.
- Measured at HEAD, each of the three files contains:
  - 0 quoted ws-reclaim tokens;
  - 0 matches of `/wsaudit|refusalSentence|SENTENCES/`;
  - 0 matches of `/\.childReclaim\b/`.

  So Task 8 is green on all six as shipped, before Task 9b touches the sheet.

**Binding text.** This supersedes Task 8's Interfaces, the two prose paragraphs above Step 1, Step 1's `FILES`, `TOKEN_FILES` and renders case, and Step 2's expected result, where they differ.
- `FILES` becomes `['pwa/src/fleet/runWords.ts', 'pwa/src/screens/RunsScreen.tsx', 'pwa/src/fleet/SessionLine.tsx', 'pwa/src/fleet/childReclaimWords.ts', 'pwa/src/fleet/ChildReclaimBanner.tsx', 'pwa/src/fleet/AbandonSheet.tsx'] as const`, with `AbandonSheet.tsx` LAST.
- `TOKEN_FILES` becomes `FILES.filter((f) => f !== 'pwa/src/fleet/SessionLine.tsx')`. This keeps SessionLine's argued exclusion, by path. Its docstring becomes: "Every scanned file but SessionLine.tsx: it renders no chip and no reclaim sentence, and it already spells `'held'` as an ASK state, which is not a ws-reclaim refusal. Its child label is read in runWords.ts, which is scanned."
- The case "reads the files that render the chip, and they do render it" addresses every file BY PATH, never by index. Its title is unchanged, because Task 9b's text names it. Its body becomes:
  ```ts
  expect(read('pwa/src/fleet/runWords.ts')).toContain('export const childReclaimChip');
  expect(read('pwa/src/screens/RunsScreen.tsx')).toContain('run-child-reclaim');
  expect(read('pwa/src/fleet/childReclaimWords.ts')).toContain('export function childReclaimAttentionOf');
  expect(read('pwa/src/fleet/ChildReclaimBanner.tsx')).toContain('export function ChildReclaimBanner');
  expect(read('pwa/src/fleet/AbandonSheet.tsx')).toContain('export function AbandonSheet');
  ```
- Interfaces' "the three PWA files Tasks 6, 7 and 9 touch" becomes "the six PWA files in `FILES`: the three Tasks 6, 7 and 9 touch, wave 4's two reclaim files, and the abandon sheet".
- The prose above Step 1 gains: "Wave 4's reclaim row (`childReclaimWords.ts`, `ChildReclaimBanner.tsx`) and the abandon sheet render server sentences too, so each is scanned for both." Its planning measurement gains: "Measured at `334fb722a`, the same grep prints 0 for `childReclaimWords.ts`, `ChildReclaimBanner.tsx` and `AbandonSheet.tsx`." In the `SessionLine.tsx` paragraph, "So the token-literal case runs over `runWords.ts` and `RunsScreen.tsx` only, and the import case still runs over all three" becomes "So the token-literal case runs over every scanned file but `SessionLine.tsx`, and the import case runs over all of them".
- **Step 2's expected result** is PASS. The count is read from the run, reported in the wave-done mail, and never typed. The cases are the vacuity guard, the renders case, one token-literal case per `TOKEN_FILES` entry, one import case per `FILES` entry, and the one-reader case. Task 9b adds its own cases (AB6, AB7) to the same file later, and reads its count from its own run.
- **Step 3's mutation table** gains two rows:
  - row 5: append `const X = { 'not-a-child': 1 };` to `pwa/src/fleet/childReclaimWords.ts`. Its token case reds with `expected [ 'not-a-child' ] to deeply equal []`;
  - row 6: append the same line to `pwa/src/fleet/AbandonSheet.tsx`. Its token case reds the same way.
- Raise Task 8's routing to `sonnet`, effort `high` (R47's floor).

**Deploy class.** Test only.

### A-S3-12 — Task 9: routing only; the label's title is S4's (R45)

**Why.**
- `childOfRunLabel`'s title says "the server reclaims it when its run closes" (plan:2899). That is false for:
  - review children;
  - hand-overs;
  - every kept or held child (R41).
- R45 rebuilds `childOfRunLabel` over `childMarkOf`, and S4's A[S4-1] rewrites that title ("the server reclaims it when nothing keeps it"). That text stays true for kept and held children, and matches the abandon copy.
- Two rewrites of one title, each with its own `toHaveAttribute` assertion, cannot both pass. So this section writes no title.
- `S.fleetPaused`'s "then reclaimed on its own" is the same falsehood on the chip, and A-S3-4 fixes it there.

**Binding text.**
- Raise Task 9's routing to `sonnet`, effort `high` (R47's floor).
- This section changes nothing else in Task 9: no title string, no assertion, and no mutation row.

**Deploy class.** PWA only.

### A-S3-13 — R42 recorded: the ten close words are not stored, and each reaches the chip through current state

**Why.** The ledger carried the question "whether the ten close words are recorded for the chip" (F7).

Those words are `ChildReclaimNotWhy`'s ten (`childReclaim.ts:307-311`):
- `not-a-child`, `marker-unreadable`;
- `siblings-open`, `siblings-unreadable`;
- `has-coordinated`;
- `review-report-live`;
- `not-finished`, `not-finished-undated`, `not-finished-unmeasured` and `not-finished-merge-commit`.

They ride only `CloseOutcome.childReclaimWhy`, which close and abandon return (`routes.ts:225-227`). Nothing stores them.

R42 rules that they are close-time snapshots that go stale, and that the chip reads current state. The small-items design's run-row column option (a `runs.childReclaimClose` column) is rejected.

**Binding text (Global Constraints gains this bullet).** The ten close words are not stored. This wave makes no schema change, no migration, no run-event and no wire change for them. Each reaches the chip through current state:

| Close word | What the chip reads instead |
|---|---|
| `not-a-child` | The watcher's marks (`currentChildMarks()`) read `none`, so the gate fails and the chip answers `null`. |
| `marker-unreadable` | The current marks: `unreadable` answers `null`. A marker read since then decides normally. |
| `siblings-open` | The hand-over conjunct, read from the same list (`sessionHasOpenRun`), answers `null`. Once the sibling closes, the ordinary rows answer. |
| `siblings-unreadable` | Transient. While the SWEEP's own read stays unreadable, its `siblings-unreadable` verdict reads `deferred` with the doubt sentence (A-S3-4), or `paused` under the switch. |
| `has-coordinated` | The sweep's `coordinating` verdict, fenced to the current generation by R40's one reader (Task 0c), reads `refused` with the kept sentence. That holds under a pause too, because the verdict is retained (A-S3-6). |
| `review-report-live` | The R16 and R16′ review rows, from the same list (`S.reviewKept`). A reviewed run gone from the database reaches it as the sweep's `reviewed-run-absent`, read `refused`. |
| `not-finished`, `not-finished-undated`, `not-finished-unmeasured`, `not-finished-merge-commit` | The non-final close re-holds the child with its programme's next-wave claim. While that programme has an open run, the sweep's verdict is `held` (`childReclaimHoldRead`'s `program` arm with `open.count > 0`), read `deferred` with the hold sentence, or `paused` under the switch. That verdict outranks an older failure event (A-S3-4), and while it stands the banner's failing arm does not list the child (A-S3-7). Once the next wave's run binds the child, the hand-over conjunct answers `null`. Once the programme has no open run, `hold-retired` (ordinary) and then `eligible` read `pending`. |

**Tests.** No guard is added, because nothing is added. The cases that pin each path are:
- A-S3-6 (vi): the `held` verdict for a programme hold, then `hold-retired`;
- A-S3-6 (iii): a kept verdict retained across a pause;
- A-S3-7 (xiv): a held child's failure run kept off the banner;
- A-S3-9 B: the coordinator's child read `refused`;
- A-S3-9 F: the held child read `deferred`;
- A-S3-4 "held beats a failure";
- Task 5 cases 7 and 8: review and hand-over.

**Deploy class.** None.

### A-S3-14 — Entry conditions, File Structure, `## Deviations found`, the review lenses, and the spec §5.9 text the code cites (A-iface-10)

**Entry conditions (A-iface-10).** Rewrite the preamble (plan:26):

> "Waves 1–4 are merged (wave 4: PR #215, `b40f4145`, v0.0.79; both boxes converged on v0.0.84 by 2026-10-05). Re-run these to prove the checkout."

Add the checks below, reported as (s3-i) to (s3-viii) in the order printed, beside Task 0b's (0b-i) to (0b-vi) and Task 0c's (0c-i) to (0c-iii). Each prints exactly one line; if any does not, STOP and report. Two of them use `grep -nF`, because a mid-pattern `$` anchors under some shells' `grep`.
```bash
grep -n "private static reviveLifecycleRow" server/src/coord/store.ts                 # Task 2 revives through it
grep -n "^export const childReclaimFirstSighting" server/src/childReclaimSweep.ts      # Task 3's and Task 5's entry literals spread it
grep -n "^export function isChildReclaimTerminalState" server/src/coord/childReclaim.ts # Task 3 calls it
grep -n "^export type ChildReclaimSweepSkip" server/src/childReclaimSweep.ts           # Task 2b's table is keyed by it
grep -n "^export type ChildReclaimSweepVerdict" server/src/childReclaimSweep.ts        # Task 4b records it
grep -n "^export const childReclaimFailingSentence" server/src/childReclaimSweep.ts    # Task 3's past-ceiling row
grep -nF '_lc_refuse reclaim "$id" flock-unavailable' ccd/ccd                          # R43's premise: the pre-lock refusal reaches the mirror
grep -nF '_lc_refuse reclaim "$id" lock-unopenable' ccd/ccd                            # …and its twin
```
The anchors lens's proposed check on `childReclaimCoordinatorIds(): ReadonlySet<string>` is Task 0c's entry condition (0c-i), which prints that reader before Task 0c replaces it.

**File Structure (plan:162-189).** A2 carries the ONE merged File Structure table: one row per file, naming every task that touches it. This section's entries are folded into it, beside Task 0b's and Task 0c's, and this section keeps no table of its own.

**`## Deviations found`.** A4 re-lists the likely departures. This section changes that list as follows.
- **Task 5's sweep-entry literal is not in it.** A-S3-9 prescribes the spread from `childReclaimFirstSighting`, so it is not a departure, and A4 lists no bullet for it. The plan's own bullet "a sweep entry field beyond the contract's four that Task 5's route-case literal had to gain" went with A4's replacement of the list.
- **It gains:**
  - "a request, outcome or entry literal that a run or `typecheck-tests` named for `feedQuiet`, the failure `token` or `lastDeferWhy`, beyond the lines A-S3-8 lists";
  - "Task 0b's entry or `childReclaimFirstSighting`, as built, differs from its amendment's (`childReclaimFirstSighting(monoMs, bornAt)`; `lastPresenceWallAt`, `presenceHeldSince`, `bornAt`), so a spread in A-S3-4, A-S3-8 or A-S3-9 had to follow it";
  - "a skip word R40's reader added or renamed, which `CHILD_RECLAIM_SKIP`'s `satisfies` totality would name".

**Review lenses.** A5's lenses gain these checks. The R16′, R41 and R43 checks join lens 1 (derivation and wire). The R44 checks join lens 3 (cost, degrade, the feed and the citation tax). The attention-list checks join lens 2 (PWA surface), beside its "R41 on the banner" bullets.
- **Its R16, R16′ bullet** reads: "…reads `pending` with `S.reviewKept` unless the sweep's verdict is a kept, doubt or held skip, which answers first."
- **R41:**
  - Every `ChildReclaimSweepSkip` word is classed exactly once, in ONE table.
  - A kept verdict reads `refused`, and is never replaced by the switch. It is retained across a pass that judged nothing.
  - Doubt and held verdicts read `deferred`, and are replaced by the switch.
  - An `unjudged` verdict reads `S.unjudged`, never `S.pending`.
  - A done reclaim, a gone answer and a terminal refusal outrank the verdict. A non-ordinary verdict outranks every other event: a failure line, a retryable refusal, a refusal with no token, the on-box `paused` token and an unclassified token (the accepted `verdict-outranks-retry-events`).
  - The verdict rows precede R16′'s review rows, and the amendment says so.
- **R43:**
  - `childReclaimFailureLine` is the one classification, read by both the chip and the failing arm. It admits exactly the two named tokens.
  - A `reclaim` token ccd journals later is classified when it is added, never inherited.
  - `childReclaimTerminalRefusal` and `CHILD_RECLAIM_TOKEN_KIND` are byte-identical to `main`.
  - The two vocabularies are held disjoint.
  - No quoted pre-lock token appears under `server/src/coord`.
- **R44:**
  - `childReclaimFeedSkips` never skips a ceiling-expired row or a changed word.
  - Presence deferrals still write every row.
- **The attention list:**
  - There is one write site.
  - There is one item per child: kept replaces failing, and terminal stands.
  - A child whose last judged verdict is `held` has no failing item; with no verdict recorded, the failing arm stands.
  - Kept and kept-many items appear from the first judging pass, are kept across a paused pass, and are never fed by an executor answer or a sweep entry.
  - There is one feed row per child, per word, per process.

The SAFETY lens (R47, mandatory) reads these:
- A-S3-6's loop write and its two reductions: no memory write moved, and the verdict is unedited;
- A-S3-7's publish move, and its held filter: it withholds only `failing` items, only for a recorded `held` verdict, and changes no ask;
- A-S3-8's proof that the skip changes no outcome, dispatch or pacing.

**Spec §5.9: the facts the code cites.** Every comment this section prescribes cites plain `spec §5.9`. The coordinator's docs commit writes these facts into §5.9, in the same docs PR as contract §11, merged before dispatch. No task in this wave edits §5.9.
1. **The chip.** It reads the sweep's last verdict:
   - kept → `refused` with its sentence, never replaced by the switch;
   - doubt or held → `deferred`, which the switch turns to `paused`;
   - no verdict yet → `pending` with its own sentence, never the eligible one.

   On order: a done reclaim, a gone answer and a terminal refusal outrank the verdict, and the verdict outranks every other event.
2. **The attention item has four kinds.**
   - Terminal and failing come from the mirror on every pass.
   - Kept comes from the last judging pass, and is kept across a pass that judged nothing. A restart rebuilds it at its first judging pass.
   - There is one item per child: kept replaces failing, and terminal stands.
   - A child whose last judged verdict is `held` has no failing item; with no verdict recorded, the failing listing stands.
   - More than five children with one kept word collapse into one line that names them.
3. **The two pre-lock refusals.** `flock-unavailable` and `lock-unopenable`, journaled under `reclaim`, are failures and are retried. They are never settled refusals. A `reclaim` token ccd journals later is classified when it is added.
4. **Feed rows.**
   - There is one feed row per non-presence deferral episode.
   - A failure the attention list already shows, with the same word, writes no further row, unless a ceiling-expired attempt ended a wait.
   - Presence deferrals write every row.
   - There is one `child reclaim kept` row per child, per word, per process.

README's "The same row lists the children that need a human's eye" sentence (`README.md:3895-3897`) is Task 9c's: it gains the children the sweep keeps for a person (R41), and the README citation cases re-measure it. This section prescribes no README edit beyond Task 1 Step 6's re-anchoring.

### A[S4-1] — NEW Task 9b (after Task 9; extends Task 8's census): the abandon confirmation says what happens to a child (R45; pre-flight F13)

**Why.** The pre-flight's F13 and the small-items design (c) found the ledger's carried item ("the PWA's abandon confirmation says the child's workspace will be reclaimed") unplaced. The shipped copy says the opposite. `pwa/src/fleet/AbandonSheet.tsx:217` renders `Abandon run ${run.id} — ${ws}? A release destroys nothing: the worktree survives, the record stays.` for every run. Its header (`:20-23`) and `server/src/coord/routes.ts:1604-1606` ("a release destroys nothing, so the two-tap confirm in the sheet is the whole ceremony here") say the same.

Since wave 3 that is false for a child:
- `withAbandon` (`routes.ts:516`, `const withAbandon: CoordRoutesHandle['withAbandon'] = …`) runs `closeRun`'s abandon arm with the child-reclaim port.
- That arm calls `childGateAtClose(deps, run, run.sessionId, sibRead, false, 'failed', null)` (`close.ts:267`).
- `childReclaimDecision` counts `state === 'failed'` as finished (`childReclaim.ts:462`, `const finished = input.final || input.state === 'failed' || …`; spec §5.7: "An abandon (`state:'failed'`) counts as finished").

So an eligible child is handed to the reclaim at once, and a kept one is reached later by the sweep.

R45 rules four things:
- four branches: no session, child, not a child, unknown;
- the mark is read through `childMarkOf`, with four answers;
- the non-child sentence stays byte-identical;
- the `routes.ts` comment is corrected with it.

R46, as contract §11 states it, places the abandon-adjacent comment fixes, `routes.ts`'s docstring and this file's header, in Task 9c, the wave's prose task, in the same PR. So 9b changes code and tests only, and Task 9c Step 4 corrects both comments to describe what 9b builds.

The child copy must stay true after waves 4 and 5. Before the tap, the sheet cannot know whether something will keep the child: an open sibling, R40's fenced coordinating rule, a hold, the reclaim-pause switch, presence, an R41 kept or doubt word, or a terminal ccd refusal. So every child sentence says what happens **when nothing keeps it**, and never that it will happen.

**Model routing:** `sonnet`, effort `high`. The SAFETY lens reads the child and unknown sentences against every keep condition (A[S4-3]).

**Deploy class:** pwa, plus two cases in Task 8's server-side test file. No server source file and no `ccd/`, `agent/` or `deploy/` file is touched, so there is no re-stamp. None of the touched files is cited by line in the citation corpus. Measured at 334fb722a: no basename below appears in the corpus with a `:<line>`, and `FILE_RE` admits no `.tsx`. Task 10 Step 3 re-derives this.

**This amends, explicitly:**
- **Task 9 Step 3, rewritten in 9b's commit.**
  - `childOfRunLabel`'s body and docstring change: it becomes a projection of the new `childMarkOf`.
  - Its child arm's `title` changes from `minted by run #${o.runId} for one PR; the server reclaims it when its run closes` to `minted by run #${m.runId} for one PR; the server reclaims it when nothing keeps it`. The old title is false for a held child, a coordinating one and a kept one, which is the defect R45 corrects.
  - **This section is the ONE binding text for Task 9's child title (the title R45 rules, contract §11): its string, its `title` assertion and its mutation row.** A-S3-12 writes none of them and carries only Task 9's routing raise.
  - Task 9 ships its title as Task 9 Step 3 writes it, and 9b changes it.
- **Task 9 Step 1.** In 9b's commit:
  - the case "names the minting run on a child, as inert text" gains one assertion on `title`;
  - Task 9's describe gains CM1 (below).
- **Task 8, as A-S3-11 amends it (R45's token pin, contract §11: each file addressed by path).** Task 8 carries the sheet in its census: A-S3-11 lists `'pwa/src/fleet/AbandonSheet.tsx'` LAST in `FILES`, makes `TOKEN_FILES` `FILES.filter((f) => f !== 'pwa/src/fleet/SessionLine.tsx')`, and adds `expect(read('pwa/src/fleet/AbandonSheet.tsx')).toContain('export function AbandonSheet');` to "reads the files that render the chip, and they do render it", by path. So the shipped sheet is in the token and import scans from Task 8 on, and 9b re-lists none of it and rewrites nothing in that census. In 9b's commit:
  - two cases are appended below the file's existing ones: AB6 and AB7. Each addresses files by path, never by index;
  - **Task 8 Step 2's count:** after 9b the file passes with exactly two more cases than at 9b's start (AB6, AB7). Read the number from the run, and never type it.
- **The shipped `pwa/test/abandon-sheet.test.tsx`** changes at three places: `:91-96`, `:270` and `:284`.

**Files:**
- `pwa/src/fleet/runWords.ts`: add `ChildMarkRead` and `childMarkOf` directly above `export interface ChildOfRunLabel`, and re-express `childOfRunLabel` through them.
- `pwa/src/fleet/AbandonSheet.tsx`:
  - `AbandonSheetProps` at `:120-124`;
  - `const ws = …` at `:175`;
  - the consequence line at `:216-218`;
  - new exports `AbandonChild`, `abandonChildOf` and `abandonConsequence`, and the private `workspaceOf`;
  - imports: `type FleetSession` joins the `../../../shared/api` import, and `childMarkOf` joins the `./runWords` import.

  The header at `:20-23` is Task 9c's (Step 4), not 9b's.
- `pwa/src/screens/RunsScreen.tsx`:
  - the `../fleet/AbandonSheet` import gains `abandonChildOf`;
  - one derived value directly after `const sessionById = new Map(sessions.map((s) => [s.id, s] as const));` (`:509`);
  - one prop on `<AbandonSheet run={abandonTarget} … />` (`:768`).
- Tests:
  - `pwa/test/abandon-sheet.test.tsx`;
  - `pwa/test/session-line.test.tsx` (Task 9's describe);
  - `server/test/child-reclaim-chip-source.test.ts` (Task 8's file).

**Interfaces.**

`pwa/src/fleet/runWords.ts` holds the ONE reader of `FleetSession.child` in `pwa/src`. It gives four answers and never folds them:

```ts
/** What a fleet row's `child` field says — four answers, never folded. `child`: a
 *  marker naming run `runId`. `none`: no marker — or no key at all, which only a
 *  server predating child marks sends, and such a server reclaims nothing.
 *  `unreadable`: the server could not read the marker. `unrecognised`: a shape this
 *  build cannot read (a newer or faulty server). */
export type ChildMarkRead =
  | { readonly kind: 'child'; readonly runId: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unrecognised' };

/** THE ONE READER of `FleetSession.child` in `pwa/src`. Optional here although the
 *  wire type requires it: the live `fleet` frame is cast, never revived. Two
 *  callers: `childOfRunLabel` (the fleet line) and `abandonChildOf` (the abandon
 *  sheet). The label says nothing for `none` OR `unrecognised`; the sheet must
 *  hedge on `unrecognised` and not on `none`. So this answers four ways, and the
 *  label's `null` is never reused as a mark. */
export const childMarkOf = (session: { child?: ChildMark }): ChildMarkRead => {
  const c: unknown = session.child;
  if (c === undefined) return { kind: 'none' };
  if (c === null || typeof c !== 'object') return { kind: 'unrecognised' };
  const o = c as { kind?: unknown; runId?: unknown };
  if (o.kind === 'child' && typeof o.runId === 'number' && Number.isSafeInteger(o.runId)) {
    return { kind: 'child', runId: o.runId };
  }
  if (o.kind === 'none') return { kind: 'none' };
  if (o.kind === 'unreadable') return { kind: 'unreadable' };
  return { kind: 'unrecognised' };
};
```

`childOfRunLabel` keeps Task 9's exact signature, and its label behaviour for every input Task 9's four cases use. Its docstring's first sentence becomes "The fleet line's label, projected from `childMarkOf` (the one reader of `FleetSession.child`)." The rest of the docstring is unchanged. Its body becomes:

```ts
  const m = childMarkOf(session);
  if (m.kind === 'child') {
    return { text: `child of run #${m.runId}`, data: 'child',
             title: `minted by run #${m.runId} for one PR; the server reclaims it when nothing keeps it` };
  }
  if (m.kind === 'unreadable') {
    return { text: 'child marker unreadable', data: 'unreadable',
             title: 'this workspace’s child marker could not be read: it takes no second run, and is not reclaimed until it can be read' };
  }
  return null;
```

`pwa/src/fleet/AbandonSheet.tsx`:

```ts
/** Which consequence the confirm line states: the sheet's own three-way answer about
 *  the run's workspace. A run with no session is decided on `run.sessionId` alone. */
export type AbandonChild = 'child' | 'not-child' | 'unknown';

/** The fleet row -> the confirm line's case. `undefined` means no fleet row for this
 *  session (no frame yet, or the registry does not list it): the board cannot tell,
 *  so the line hedges. Reads the mark ONLY through `childMarkOf`. */
export function abandonChildOf(session: FleetSession | undefined): AbandonChild {
  if (session === undefined) return 'unknown';
  const mark = childMarkOf(session);
  if (mark.kind === 'child') return 'child';
  if (mark.kind === 'none') return 'not-child';
  return 'unknown';
}

const workspaceOf = (run: Pick<RunSummary, 'id' | 'workspace' | 'branch'>): string =>
  run.workspace ?? run.branch ?? String(run.id);

/** The confirm line. Says what happens WHEN nothing keeps a child, never that it
 *  will: the sheet cannot know before the tap what will keep it. */
export function abandonConsequence(
  run: Pick<RunSummary, 'id' | 'sessionId' | 'workspace' | 'branch'>, child: AbandonChild,
): string {
  // Decided on `run.sessionId` alone: a run with no session names no workspace,
  // so it names no child (close.ts's abandon arm does no fleet act for it).
  if (run.sessionId === null) {
    return `Abandon run ${run.id}? It holds no workspace, so nothing is released or reclaimed.`;
  }
  const ws = workspaceOf(run);
  switch (child) {
    case 'not-child':
      return `Abandon run ${run.id} — ${ws}? A release destroys nothing: the worktree survives, the record stays.`;
    case 'child':
      return `Abandon run ${run.id} — ${ws}? ${ws} is a child workspace, so the server reclaims it when nothing keeps it: its commits and uncommitted work (not ignored or secret-shaped files) are pinned in the attic and its transcripts kept, then its session is stopped and its worktree, branch and clips are removed.`;
    case 'unknown':
      return `Abandon run ${run.id} — ${ws}? This board cannot tell whether ${ws} is a child workspace. If it is, the server reclaims it when nothing keeps it, pinning its commits and uncommitted work (not ignored or secret-shaped files) in the attic first; if not, a release destroys nothing.`;
  }
}
```

The values are `'not-child'`, never the design's `'not-a-child'`. That one is a ws-reclaim refusal token (`CHILD_RECLAIM_TOKEN_KIND`'s `'not-a-child': 'terminal'`, `childReclaim.ts:62`), and Task 8's token scan reads this file from Task 8 on (A-S3-11). 9b's code and comments in this file spell no ws-reclaim token in quotes or backticks, and contain none of `wsaudit`, `refusalSentence` or `SENTENCES`.

`AbandonSheetProps` gains:

```ts
  /** The run's workspace's child mark, as `abandonChildOf` reads it off the fleet
   *  row. Absent means the caller did not say, which reads 'unknown'. */
  workspaceChild?: AbandonChild;
```

The component destructures `workspaceChild = 'unknown'`. `const ws = run.workspace ?? run.branch ?? String(run.id);` becomes `const ws = workspaceOf(run);`, which the sibling toast still reads. The consequence `<p className="qc-consequence">` renders `{abandonConsequence(run, workspaceChild)}`.

`pwa/src/screens/RunsScreen.tsx`, directly after `sessionById`:

```ts
  // CCR-15 wave 5 (spec §5.7): the abandon sheet's confirm line branches on the
  // run's workspace's child mark, read off the fleet row this board already looks up.
  const abandonSession = abandonTarget === null || abandonTarget.sessionId === null
    ? undefined : sessionById.get(abandonTarget.sessionId);
```

The mount becomes `<AbandonSheet run={abandonTarget} workspaceChild={abandonChildOf(abandonSession)} onClose={…} onDone={…} />`, with both callbacks unchanged. `AbandonSheet` has no other mount (measured at 334fb722a).

The sheet gives the child copy for ANY child mark, not only one that names the abandoned run. F13 proposed "naming this run". But a child handed over to wave N carries wave 1's run id: see the `close.ts` comment on `request: … runId: mark.runId`, "which differ exactly when the child handed over across waves". Its wave-N abandon is just as finished. AB5 pins this.

**The copy, exactly.** These are the four strings `abandonConsequence` returns. `ws` is `workspaceOf(run)`.
- When `run.sessionId === null`, whatever `child` is: `Abandon run ${run.id}? It holds no workspace, so nothing is released or reclaimed.`
- `'not-child'`: `Abandon run ${run.id} — ${ws}? A release destroys nothing: the worktree survives, the record stays.` This is byte-identical to `AbandonSheet.tsx:217` at 334fb722a.
- `'child'`: `Abandon run ${run.id} — ${ws}? ${ws} is a child workspace, so the server reclaims it when nothing keeps it: its commits and uncommitted work (not ignored or secret-shaped files) are pinned in the attic and its transcripts kept, then its session is stopped and its worktree, branch and clips are removed.`
- `'unknown'`: `Abandon run ${run.id} — ${ws}? This board cannot tell whether ${ws} is a child workspace. If it is, the server reclaims it when nothing keeps it, pinning its commits and uncommitted work (not ignored or secret-shaped files) in the attic first; if not, a release destroys nothing.`

**Why each sentence is true after waves 4 and 5:**
- **"When nothing keeps it" is a condition, never a promise.** Each of the following keeps the child, and none of them makes the sentence false:
  - an open sibling (`siblings-open`; the shipped toast at `AbandonSheet.tsx:199-201` already says "still claimed by another open run");
  - R37 as R40 fences it;
  - an accounted programme hold, or a hand hold;
  - `review-report-live`;
  - the reclaim-pause switch;
  - presence;
  - R41's kept words, and its doubt words (an unreadable marker, identity, hold, minting run, reviewed run or siblings);
  - a terminal ccd refusal;
  - a failure the sweep retries (`pin-failed`, and R43's two lock failures).
- **The sentence does not point at the chip.** While a sibling run is open, Task 3's derivation answers `null` for the abandoned run's row (`if (input.sessionHasOpenRun) return null;`). So "the chip says what keeps it" would be false in exactly that case.
- **What a reclaim keeps and removes** follows the spec's §4 "Reclaim" vocabulary.
  - It destroys "the worktree, the branch, the clips, the per-session temp root, the pane, the unit and the registry row".
  - It keeps "the attic refs, the tombstone, the lifecycle journal and the transcripts".
  - Ignored files die with the tree. Secret-shaped files are never staged (§5.5 pin step 1). So "(not ignored or secret-shaped files)" is owed.
- **"It holds no workspace", not the design's "never got a workspace".** `CoordStore.clearSession` (store.ts; `UPDATE runs SET sessionId = NULL, workspace = NULL, branch = NULL` under `state = 'planned'`) unbinds a spent workspace from a planned run that did hold one. The abandon arm then does no fleet act (`close.ts`: "A run with no session names no workspace, so it names no child.").
- **The unknown branch is conditional both ways.** It covers three cases:
  - no fleet row;
  - an unreadable marker, which close answers with `marker-unreadable` and the sweep defers;
  - an unrecognised shape.

**Checked against the shipped sheet (334fb722a).**
- The consequence `<p>` is the only copy. The title stays `Abandon this run?`.
- The request takes no body, so the copy cannot change what is done.
- No sentence contains `archive` (the negative pin at `:102-108`), `failed` (`:119`'s `getByText(/failed/i)` must still find exactly one element), `still claimed` (`:211`, `:219`, `:240`) or `does not recognise` (`:141`).
- Every session-bearing sentence starts `Abandon run N — `. That is what `:339`, `:375` and `:383` match with `/^Abandon run 7 —/`.
- `:85-89` (no prop, so the unknown sentence) still finds exactly one element for `/run 3/i` and for `/clear-cove/i`: the one `<p>`.

**Steps.**
1. **Census first** (`server/test/child-reclaim-chip-source.test.ts`).
   - Append AB6 and AB7 below the file's existing cases. Nothing else in the file changes: Task 8 already scans `AbandonSheet.tsx` (A-S3-11).
   - Run the file. Every case is green on the shipped `AbandonSheet.tsx`, which spells no token and imports no sentence table. Measured at 334fb722a: zero token literals, and zero matches for `wsaudit|refusalSentence|SENTENCES`. At this point `runWords.ts` holds Task 9's one read of `session.child`.

   ```ts
   /** Code only: a sentence ABOUT a field is not a read of it. */
   const codeOnly = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

   it('has ONE reader of FleetSession.child in pwa/src — childMarkOf, in runWords.ts', () => {
     const reads = Object.fromEntries(pwaSources()
       .map((f) => [path.relative(root, f), (codeOnly(readFileSync(f, 'utf8')).match(/\.child\b/g) ?? []).length] as const)
       .filter(([, n]) => n > 0));
     // archiveReleased.ts reads `releasedFrom.child`, a DIFFERENT field; its own
     // docstring: "never `FleetSession.child`: one decision, one field".
     expect(reads).toEqual({ 'pwa/src/fleet/archiveReleased.ts': 1, 'pwa/src/fleet/runWords.ts': 1 });
   });

   it('no pwa/src file reads the close response’s why-word — the PWA renders no close word', () => {
     const readers = pwaSources()
       .filter((f) => /\bchildReclaimWhy\b/.test(codeOnly(readFileSync(f, 'utf8'))))
       .map((f) => path.relative(root, f));
     expect(readers).toEqual([]);
   });
   ```

   Measured at 334fb722a with this exact `codeOnly` and pattern: `{ 'pwa/src/fleet/archiveReleased.ts': 1 }` and no `childReclaimWhy` reader.

   If AB6 names any other file at your tip, read that file:
   - a read of a DIFFERENT field named `child` (as `archiveReleased.ts`'s `releasedFrom.child` is) joins the expected map, with a comment naming the field, and goes in the wave-done mail;
   - a read of `FleetSession.child` moves into `childMarkOf`.
2. **Red first.** Write the PWA cases below. Run `cd pwa && ./node_modules/.bin/vitest run test/abandon-sheet.test.tsx test/session-line.test.tsx`. Expected:
   - AB1–AB4's pure cases give `TypeError: abandonConsequence is not a function`.
   - CM1 gives `TypeError: childMarkOf is not a function`.
   - AB1's render case gives `Unable to find an element with the text: Abandon run 3 — clear-cove? clear-cove is a child workspace, …`.
   - AB3's and AB4's render cases fail the same way for their sentences.
   - AB5's two child rows and its three unknown rows fail the same way. Its two not-child rows pass, because they render the shipped sentence.
   - The title assertion gives `Expected the element to have attribute: title="minted by run #42 for one PR; the server reclaims it when nothing keeps it"`, received `…when its run closes`.
3. **Implement.**
   - Write `childMarkOf` and re-express `childOfRunLabel`.
   - Make the `AbandonSheet.tsx` code edits listed under **Files**. Leave its header to Task 9c.
   - Add the `RunsScreen.tsx` derived value and prop.
4. **Green.** Run each command from its package:
   - `cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx $(grep -l RunsScreen test/*.tsx)`. The grep lists every PWA suite that mounts the board, `abandon-sheet.test.tsx` among them; at 334fb722a it lists nine files.
   - `cd pwa && ./node_modules/.bin/tsc --noEmit -p .`. It covers `test/`, so AB5's `sess()` builder must be a full `FleetSession` literal.
   - `cd server && ./node_modules/.bin/vitest run test/child-reclaim-chip-source.test.ts`

   Expected:
   - PASS everywhere.
   - Task 9's four cases stay green, unedited apart from the one title line.
   - Task 8's file passes with exactly two more cases than at 9b's start (AB6, AB7), read from the run.
   - `tsc` prints nothing.
5. **Mutation table** (below). Revert each mutation before the next.
6. **Commit** on the workspace branch:

   ```
   feat(pwa): the abandon confirmation says what happens to a child workspace

   Four branches, read through childMarkOf (the one reader of FleetSession.child): no
   session, a child (reclaimed when nothing keeps it, its work pinned in the attic first),
   not a child (byte-identical: a release destroys nothing), and unknown (a hedge both
   ways). The fleet line's child title says the same.
   ```

   End the message with the attribution trailer. The message names no `D-` number.

**Tests.**

In `pwa/test/abandon-sheet.test.tsx`:
- Import `abandonConsequence`, plus `type FleetSession` and `type ChildMark` from `../../shared/api`.
- Copy `runs-screen.test.tsx`'s `sess` builder verbatim, as it stands at your tip (locate `const sess = (over: Partial<FleetSession> = {}): FleetSession => ({`). Its `id` is `ccrc-pwa-clear-cove`, the `sessionId` of this file's `run()`.
- Define `NOT_CHILD`, `CHILD`, `UNKNOWN` and `NO_SESSION` as the four sentences above. Render them for `run()` (id 3, workspace `clear-cove`), and for `NO_SESSION` with id 3.

The cases:
- **AB1, child.** `expect(abandonConsequence(run(), 'child')).toBe(CHILD)`. A render with `workspaceChild="child"` finds `CHILD`, and `queryByText(NOT_CHILD)` is null.
- **AB2, not a child, byte-identical.**
  - `expect(abandonConsequence(run(), 'not-child')).toBe('Abandon run 3 — clear-cove? A release destroys nothing: the worktree survives, the record stays.')`.
  - The existing case at `:91-96` gains `workspaceChild="not-child"` on its render, and keeps its three assertions. Without the prop it reds, because the unknown sentence has no "worktree survives".
- **AB3, unknown.** `abandonConsequence(run(), 'unknown')` is `UNKNOWN`. A render with NO prop finds `UNKNOWN`, and `queryByText(NOT_CHILD)` is null.
- **AB4, no session.** `it.each(['child', 'not-child', 'unknown'] as const)`: for `run({ sessionId: null, workspace: null, state: 'planned' })`, `abandonConsequence` is `'Abandon run 3? It holds no workspace, so nothing is released or reclaimed.'`. One render finds it.
- **AB5, RunsScreen wiring** (in the `the run board’s abandon control` describe).
  - Seed the store with `{ runs: [run()], runsFrameSeen: true, sessions, fleetFrameSeen: true }`.
  - Tap `abandon run 3`.
  - Then `findByText(expected)` for each row of an `it.each`:
    - `[sess({ child: { kind: 'child', runId: 3 } })]` → `CHILD`;
    - `[sess({ child: { kind: 'child', runId: 1 } })]`, a child handed over from an earlier wave → `CHILD`;
    - `[sess({ child: { kind: 'none' } })]` → `NOT_CHILD`;
    - `[legacy]`, an older server: `const legacy = { ...sess() } as Record<string, unknown>; delete legacy['child'];`, cast `as unknown as FleetSession` → `NOT_CHILD`;
    - `[sess({ child: { kind: 'unreadable' } })]` → `UNKNOWN`;
    - `[sess({ child: { kind: 'child', runId: 'x' } as unknown as ChildMark })]` → `UNKNOWN`;
    - `[]` (no fleet row) → `UNKNOWN`.
- **The existing probes** at `:270` (`findByText(/a release destroys nothing/i)`) and `:284` (`queryByText(/a release destroys nothing/i)`) become `/abandon run 3 — clear-cove\?/i`, the clause every session-bearing branch carries.
  - Left unchanged, both would still pass: this board passes no fleet row, so it renders the unknown sentence, which ends "a release destroys nothing".
  - They change so that they probe the clause every branch shares, not the hedge's last words.
  - The second-tap and close-on-success assertions are otherwise unchanged.
- **CM1** (`pwa/test/session-line.test.tsx`, in Task 9's describe). Import `childMarkOf` beside `childOfRunLabel`. `childMarkOf` answers, one row each:
  - `{ child: { kind: 'child', runId: 42 } }` → `{ kind: 'child', runId: 42 }`;
  - `{ child: { kind: 'none' } }` → `{ kind: 'none' }`;
  - `{}` → `{ kind: 'none' }`;
  - `{ child: { kind: 'unreadable' } }` → `{ kind: 'unreadable' }`;
  - `{ child: { kind: 'child', runId: 'x' } }`, `{ child: { kind: 'grandchild' } }` and `{ child: null }` (each cast) → `{ kind: 'unrecognised' }`.
- **Task 9's** "names the minting run on a child, as inert text" gains `expect(cell()).toHaveAttribute('title', 'minted by run #42 for one PR; the server reclaims it when nothing keeps it');`.
- **AB6 and AB7**, as in Step 1.

**Mutation table.** Commands:
- `cd pwa && ./node_modules/.bin/vitest run test/abandon-sheet.test.tsx test/session-line.test.tsx`
- `cd server && ./node_modules/.bin/vitest run test/child-reclaim-chip-source.test.ts`

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | `abandonConsequence`'s `case 'child':` returns the not-child sentence | AB1: `expected 'Abandon run 3 — clear-cove? A release destroys nothing: …' to be 'Abandon run 3 — clear-cove? clear-cove is a child workspace, …'` |
| 2 | Swap the `'child'` and `'not-child'` sentences | AB1 and AB2 red |
| 3 | Default `workspaceChild` to `'not-child'` | AB3's render: `Unable to find an element with the text: Abandon run 3 — clear-cove? This board cannot tell …` |
| 4 | Delete the `run.sessionId === null` branch | AB4 reds for each of the three values; for `'unknown'`: `expected 'Abandon run 3 — ws/clear-cove? This board cannot tell …' to be 'Abandon run 3? It holds no workspace, …'` |
| 5 | `RunsScreen.tsx` drops `workspaceChild={…}` | AB5's two child rows and two not-child rows red (each renders `UNKNOWN`); its three unknown rows stay green |
| 6 | `abandonChildOf` answers `'unknown'` for `none` | AB5's `none` and key-absent rows red |
| 7 | `childMarkOf`'s last line returns `{ kind: 'none' }` | CM1's `runId: 'x'` and `grandchild` rows red (its `null` row is answered by an earlier line and stays green); AB5's `runId: 'x'` row renders `NOT_CHILD` (red) |
| 8 | `childMarkOf`: `c === undefined` returns `{ kind: 'unrecognised' }` | CM1's `{}` row red; AB5's key-absent row renders `UNKNOWN` (red) |
| 9 | `abandonChildOf` gains a second parameter `runId` and answers `'child'` only when `mark.runId === runId`, otherwise falling through to its last line; RunsScreen passes `abandonTarget.id` | AB5's handed-over row red |
| 10 | Insert `if (session.child?.kind === 'child') return 'child';` directly after `if (session === undefined) return 'unknown';` in `abandonChildOf` | AB6: `expected { …, 'pwa/src/fleet/AbandonSheet.tsx': 1, … } to deeply equal { 'pwa/src/fleet/archiveReleased.ts': 1, 'pwa/src/fleet/runWords.ts': 1 }`; AB5's `runId: 'x'` row also renders `CHILD` (red), because the inline read skips `childMarkOf`'s shape check |
| 11 | Replace `childOfRunLabel`'s body with Task 9's own, which reads `session.child` itself, keeping 9b's title | AB6: `'pwa/src/fleet/runWords.ts': 2` |
| 12 | Add the comment line ``// the server answers `not-a-child` `` to `AbandonSheet.tsx` | `pwa/src/fleet/AbandonSheet.tsx spells no ws-reclaim refusal token as a string literal`: `expected [ 'not-a-child' ] to deeply equal []` |
| 13 | In `pwa/src/lib/api.ts`'s `abandonRun`, widen the cast to `as { released?: unknown; childReclaimWhy?: unknown }` and add `void body.childReclaimWhy;` on the next line | AB7: `expected [ 'pwa/src/lib/api.ts' ] to deeply equal []` |
| 14 | Restore Task 9's child title, `…the server reclaims it when its run closes` | Task 9's "names the minting run…": the `title` attribute mismatch |
| 15 | `abandonChildOf` folds every non-child mark: `return mark.kind === 'child' ? 'child' : 'not-child';` | AB5's `unreadable` and `runId: 'x'` rows render `NOT_CHILD` (red) |

### A[S4-2] — NEW Task 9c (after every other code task, directly before Task 10): G2 and G5 told truthfully, and the spec text owed since wave 3 (R46)

**Why.** Review 258 (ledger, "Wave 5 inherits, from wave 4's reviews 254 and 258") left two false sentences in shipped comments.
- **G2.** `server/src/watch.ts:809-813` gives a false reason for keeping the release mark on an ineligible verdict. So does wave 4's A10 (wave-4 plan `:5293-5295`).
- **G5.** `server/src/coord/childReclaim.ts:263-268` says `deferExpired` is the sweep's verdict "on the same clock" as `deferredSinceMs`. It is not. The lane passes `deferredSinceMs: entry.firstDeferredAt` (`watch.ts:3417`), while `childReclaimDeferExpired` reads `firstPresenceDeferredAt` and the presence recency (`childReclaimSweep.ts:477-482`).

Task 9b's Why names two more. `pwa/src/fleet/AbandonSheet.tsx:20-23` and `server/src/coord/routes.ts:1604-1606` say a release destroys nothing and that the two-tap confirm is therefore the whole ceremony, with no word for a child. R45 rules the `routes.ts` comment corrected with the copy, and R46, as contract §11 states it, places these abandon-adjacent comment fixes in this task, in the same PR as 9b's copy.

The ledger has also owed the spec text since wave 3: "§5.5 step 2 needs rewording for `wip-moves-no-ref`". The wave-3 plan's `## Deviations found` records what shipped, as the accepted departure `wip-moves-no-ref` (D-3365):
- the WIP is built with `git commit-tree`;
- it is pinned by sha under `refs/ccrc/attic/<id>/`;
- it moves no branch and no HEAD;
- the tombstone's `tip` is the branch's own tip.

And R41 puts each child the sweep keeps on the Runs attention list, while README's sentence about that row (`README.md:3895-3897` at 334fb722a, "The same row lists the children that need a human's eye: …") names only terminal refusals and failures. R46 (contract §11) places that sentence in this task, re-measured by the README citation cases.

**Scope (R46, as contract §11 states it).** Task 9c carries exactly these edits:
- G2, in `watch.ts` and as a correction appended to the wave-4 plan;
- G5, in `childReclaim.ts`;
- the abandon-adjacent comment fixes, in `routes.ts` and `AbandonSheet.tsx`;
- spec §5.5 steps 2 and 3, rewritten to what shipped;
- spec §1's one line under the rulings table;
- README's "The same row lists…" sentence.

Every other spec edit is the coordinator's docs commit, merged before dispatch (contract §11, R46): the spec text for R39 to R44 (§5.7's lease and its three figures; §5.9's verdict visibility, kept arm, R44's feed rows and R43's two lock tokens read as failures), the rest of wave 3's spec debt (R30's placement in §5.3; T1's counts in §6 and Appendix A), §8's wave table and the paragraph under it, the status line, the "dated to it (§5.3)" qualifiers in §4's "Spent" and in §5.7's close conjunct, and the corrections to §1's "One qualification" paragraph and §7 item 2. This task writes none of it. If that text is missing at your tip, report it in the wave-done mail; never write it here. Code comments cite plain "spec §5.7" or "spec §5.9".

Within that scope, R46 fixes what three of the texts say, and none carries a content pin (wave 1's ruling):
- the small-items design's G2 and G5 texts;
- §5.5 steps 2 and 3 rewritten to what shipped;
- in §1, the operator's ruled row kept verbatim, with one line added under the table.

Two choices below were the composer's, and the coordinator accepted both; contract §11's R46 names them as ruling text: Step 3's entry-lifetime clause (`g5-names-the-entry-lifetime`), and Step 5's appended correction in place of an in-place edit of wave 4's A10 (`g2-a10-corrected-by-append`). Both are prescribed here, so neither is a departure the worker reports.

This task runs after Tasks 0b and 0c, after the R41–R44 tasks, and after Task 9b. Those tasks edit the sweep pass, the presence clocks, the `ChildReclaimRequest` docstring (Task 4d's `feedQuiet`), the wave-4 plan (Task 0b's appended block), README's same paragraph (Task 0c, a different line) and the abandon sheet (9b's `abandonConsequence` and `childMarkOf`, which Step 4's header names). Every sentence below must describe the code at 9c's own tip.

**Model routing:** `sonnet`, effort `high` (R47's implementation floor; the work is prose only).

**Deploy class:** server and PWA comments plus three documents: the spec, the wave-4 plan and README. There is no runtime change, no `ccd/` file and no re-stamp. `watch.ts`, `childReclaim.ts`, `routes.ts` and `AbandonSheet.tsx` are not cited by line in the citation corpus, and no corpus document cites `README.md` by line (all measured at 334fb722a). `FILE_RE` admits no `.md` and no `.tsx`.

**This amends, explicitly:**
- Wave 4's A10 "The answer's mark" is corrected by a bullet APPENDED to Task 0b's post-merge corrections block in the wave-4 plan (Step 5). A10's own lines (`:5293-5295` at 334fb722a) are never edited, because Task 0b's block declares the lines above it unedited (`g2-a10-corrected-by-append`, contract §11).
- R45's "corrected with it" is met by this task's commit, in the same PR as Task 9b's copy (R46, contract §11).

**Steps.**
1. **Measure first. Each sentence below is true only if all of these hold at your tip.**
   - `sed -n '/^  async sweepChildReclaim(/,/^  }$/p' server/src/watch.ts | grep -nE '\bawait\b'` prints exactly one line, `await Promise.all(acts);`. Reading the method shows that line after the per-child loop closes. At 334fb722a it is the only `await` in the 388-line method, on its second-last line.
   - `grep -n "if (this.ticking) return;" server/src/watch.ts` prints one line, inside `async tick()`.
   - `grep -n "deferredSinceMs:" server/src/watch.ts` prints one line, in the sweep's request, and that line reads the sweep entry's `firstDeferredAt`. At 334fb722a it is `deferredSinceMs: entry.firstDeferredAt,`.
   - In `server/src/childReclaimSweep.ts`, a first sighting starts `firstDeferredAt` at `null`, and a deferred answer sets it only while it is `null` (at 334fb722a, `firstDeferredAt: entry.firstDeferredAt ?? nowMs`). Step 3's entry-lifetime clause rests on this.
   - The function that decides `deferExpired` reads the presence episode's clocks and never `firstDeferredAt`. It is named `childReclaimDeferExpired` at 334fb722a. Task 0b may rename or re-sign it, so find it from `deferExpired`'s assignment in the lane.
   - `grep -nF '## Post-merge corrections (wave 5, 2026-10-05)' docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md` prints exactly one line: the block Task 0b appended.
   - `grep -n '^export function abandonConsequence' pwa/src/fleet/AbandonSheet.tsx` and `grep -n '^export const childMarkOf' pwa/src/fleet/runWords.ts` each print one line. Step 4's header names both.
   - `grep -n 'The same row lists the children that need a' README.md` prints one line, and that line and the two after it read as Step 7 quotes them.
   - In `ccd/ccd`, re-read four headers: `_ws_wip_commit` ("THE COMMIT MOVES NO REF AND NO HEAD", the parents, "A STAGED INTERMEDIATE VERSION IS KEPT TOO", the scratch index, its step 3 on skip-worktree and assume-unchanged entries), `_ws_reclaim_commit_tree` ("THE ONE COMMIT WRITER, and the ONE IDENTITY"), `_ws_reclaim_pin` ("the SETTLE") and `_ws_reclaim_pin_contained` (steps 0 to 4, "THE BRANCH TIP IS A REQUIRED PIN", "A HEAD THAT HAS DRIFTED ONTO ANOTHER BRANCH KEEPS IT"). `grep -nE 'commit-tree' ccd/ccd ccd/ccrc` names one call, inside `_ws_reclaim_commit_tree`. Wave 5 edits no ccd file, so these should match 334fb722a.

   If any of these fails:
   - If an `await` now sits before the sweep's loop, G2's argument is false, and the mark's role is a SAFETY question, not prose. **STOP** and report it to the coordinator.
   - If Task 0b's heading is absent, renamed or present more than once, Step 5 has nowhere to append. **STOP** and report it.
   - If 9b's `abandonConsequence` or `childMarkOf` is absent, Step 4's header would name code that does not exist. **STOP** and report it.
   - If Task 0b renamed the deciding function, use the name it left in Step 3's text, and say so in the wave-done mail.
   - If README's sentence reads differently, add Step 7's clause to the sentence as it stands, keep its line count, and say so in the wave-done mail.
2. **G2 in `server/src/watch.ts`** (`childReclaimReleaseAnswered`'s docstring). Locate it by content. Replace

   ```
      *  outlives its child. An INELIGIBLE verdict deletes the entry but KEEPS
      *  the mark, deliberately: the listing that matters most is the stale HELD
      *  one, read before ccd unlinked the hold, and spending the mark there
      *  would reopen the window it exists to close. Keeping it costs at most one
      *  pass, once. IN MEMORY ONLY, the `childReclaimSweepState` idiom. */
   ```

   with

   ```
      *  outlives its child. An INELIGIBLE verdict deletes the entry but KEEPS
      *  the mark — a choice, not a safety need: ticks are serialised (`tick()`'s
      *  `ticking` guard) and this lane awaits nothing before its loop, so only
      *  one pass's listing can predate a release answer; that pass's held row
      *  seeds nothing anyway, and the next listing postdates the answer, so
      *  spending the mark there would still leave two fresh unheld passes.
      *  Keeping it costs at most one pass, once. IN MEMORY ONLY, the
      *  `childReclaimSweepState` idiom. */
   ```

   If an earlier task edited this docstring around these lines, replace only the two sentences from `An INELIGIBLE verdict` through `Keeping it costs at most one pass, once.`, and keep everything else.
3. **G5 in `server/src/coord/childReclaim.ts`** (`ChildReclaimRequest`'s docstring). Locate it by content.
   - The span to replace starts at ``*  `deferredSinceMs`: epoch ms of the FIRST deferral the sweep`` and ends at `fingerprint input on the box and this is not.`. That is the full stop, NOT the `*/` after it.
   - Everything outside the span stays as it is: the docstring's opening, the `feedQuiet` paragraph Task 4d places above the span (A-S3-8 Step 5), or a docstring on the `feedQuiet` field itself in the interface body, and the docstring's closing `*/`.

   Replace the span with:

   ```
    *  `deferredSinceMs`: epoch ms of the FIRST deferral of ANY kind
    *  (`firstDeferredAt`) since the sweep's in-memory entry for this child was
    *  last created — every reset of that entry, a restart included, starts it
    *  again — or `null`: close's value, always a first attempt. It exists so
    *  the feed row can say how long the child waited and why (spec §5.7,
    *  §5.9); the executor decides nothing on it. `deferExpired` is the sweep's
    *  verdict on a DIFFERENT clock — the current presence episode, which
    *  `childReclaimDeferExpired` reads — so a long wait here never implies a
    *  licence. It is carried separately because it is a fingerprint input on
    *  the box and this is not.
   ```

   - It names no unit for the presence clock, so it stays true whatever R39 does to those clocks. R39 keeps `firstDeferredAt` a wall-clock epoch.
   - The entry-lifetime clause is owed. A first sighting starts `firstDeferredAt` at `null`. The entry is deleted on an ineligible verdict, on a vanished row, at the pass-level resets and on a restart, and Task 0b re-seeds it as a first sighting when the child's birth changes (a recycled slug). So the design's "the FIRST deferral … the sweep saw for this child" is false after any of those.
   - The text contains no single-quoted kebab word, because `mail-routes.test.ts`'s scanner reads `server/src/coord` comments too.
4. **The abandon comments (R45; R46, contract §11).** Both are comments only, and both describe what Task 9b built.
   - **`server/src/coord/routes.ts`, the abandon route's docstring** (`:1604-1606` at 334fb722a). Locate it by content. Replace

     ```
        * a validation a later edit can loosen. Destruction keeps its existing
        * ceremony (audit → reap, typed `expect`); a release destroys nothing, so
        * the two-tap confirm in the sheet is the whole ceremony here.
     ```

     with

     ```
        * a validation a later edit can loosen. A human's destruction keeps its
        * existing ceremony (audit → reap, typed `expect`), and a release destroys
        * nothing. A CHILD's abandon is a finished close all the same
        * (child-reclamation spec §5.7): the close, or the sweep once nothing keeps
        * the child, hands it to the server's reclaim, which pins its work in the
        * attic and then removes it behind a token re-proved on the box. The
        * sheet's two-tap confirm says which applies (`abandonConsequence`,
        * `AbandonSheet.tsx`) and is the whole ceremony on this door: a door
        * ungated against the box token (below) reaching a destructive act is
        * inside the single-user trust model, recorded, not changed.
     ```

     The text has no single-quoted kebab word, because `mail-routes.test.ts`'s scanner (`/'([a-z]+(?:-[a-z]+)+)'/g`) reads every `server/src/coord` source, comments included. It adds no `D-` token: the UNGATED paragraph directly below it already names its ruling. It contains no `app.post('`, so the route scanners in `coord-pause-route.test.ts` and `box-token-census.test.ts` read the same routes.
   - **`pwa/src/fleet/AbandonSheet.tsx`, the header at `:20-23`.** Locate it by content. Replace

     ```
     // "A release destroys nothing" (spec §4.3): unlike the reap flow's audit ->
     // confirmed-destroy ceremony (`ReapSheet.tsx`), a release destroys no data —
     // the worktree survives, the record stays — so the two-tap confirm naming
     // the run and its workspace IS the whole ceremony here, not a truncated one.
     ```

     with

     ```
     // "A release destroys nothing" (spec §4.3) — for a workspace that is not a
     // child: the worktree survives, the record stays, so the two-tap confirm
     // naming the run and its workspace IS the whole ceremony here, not a
     // truncated one (unlike the reap flow's audit -> confirmed-destroy ceremony,
     // `ReapSheet.tsx`). A CHILD's abandon is a finished close (child-reclamation
     // spec §5.7): the close, or the server's sweep once nothing keeps the child,
     // hands it to the reclaim, which pins its work in the attic and then removes
     // it. The sheet cannot know before the tap what will keep it, so
     // `abandonConsequence` says what happens WHEN nothing does and never that it
     // will; it branches on the workspace's child mark, read only through
     // `childMarkOf` (`runWords.ts`). The abandon door is ungated against the box
     // token (D-282; the route's UNGATED note, `server/src/coord/routes.ts`); its
     // reaching that destructive act is inside the single-user trust model:
     // recorded, not changed.
     ```

     This file is in Task 8's token scan (A-S3-11). The header spells no ws-reclaim token in quotes or backticks, and contains none of `wsaudit`, `refusalSentence` or `SENTENCES` (checked). `D-282` is the one `D-` token it adds, defined on `origin/main` and prescribed here (contract §11, R47).
   - **`close.ts`'s abandon-arm header is not edited.** Its "`wsArchive` (step 3): a release destroys nothing and this arm has no archive branch to reach" is about the release itself and the skipped archive. Both are still true.
   - Neither comment carries a content pin, by wave 1's ruling: "a prose pin against prose is green while both lie". They have no mutation row.
5. **G2 in the wave-4 plan** (`docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md`). Do NOT edit A10's lines (`:5293-5295` at 334fb722a). Append one bullet as the LAST item of Task 0b's block, the section headed `## Post-merge corrections (wave 5, 2026-10-05)`, whose own opening lines admit this task's bullets:

   ```
   - **A10, "The answer's mark", its fourth bullet (review 258, G2; wave 5's Task 9c).** It reads "An ineligible
     verdict deletes the entry but keeps the mark, deliberately. The listing that matters most is the stale held one,
     read before ccd unlinked the hold. Spending the mark there would reopen the window it exists to close. Keeping
     it costs at most one pass, once." Read instead: "An ineligible verdict deletes the entry but keeps the mark. That
     is a choice, not a safety need (review 258, G2): ticks are serialised and the sweep awaits nothing before its
     loop, so only one pass's listing can predate the answer, that pass's held row seeds nothing anyway, and the
     next listing postdates it. Keeping it costs at most one pass, once."
   ```

   It takes no number and carries no `D-` token.
6. **The spec** (`docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`). Make three edits, located by content. Line numbers below are at 334fb722a. The coordinator's docs commit, merged before dispatch, edits §5.3 above §5.5, so §5.5's lines will have moved. It also corrects §1's "One qualification" paragraph, below the "Rule 4" paragraph that follows the table; it does not edit the table. Keep the file's existing line wrap (about 110 columns) and step-continuation indent (three spaces).
   - **§1, under the rulings table** (R46). The row "A child the reap ladder cannot prove safe" (line 34) stays VERBATIM: it records an operator ruling. Directly after the table's last row (`| How much of the 2026-08-11 Tier B ceremony to keep | …`), insert one blank line and then this line:

     ```
     As built (§5.5 step 2; wave 3's `wip-moves-no-ref`), the WIP commit is pinned in the attic and moves no branch.
     ```

     The blank line is required. In GitHub-flavoured Markdown a plain line directly after a table row is read as one more row. The existing blank line before "**Rule 4 is the load-bearing one**" stays.
   - **§5.5 pin phase, step 2** (lines 350-352). Replace from `2. Everything else uncommitted — tracked modifications and non-secret untracked files — becomes one WIP` through `which is reason enough for it to be one function with one caller.` with:

     ```
     2. Everything else uncommitted — tracked modifications (an edit git was told not to look at, under
        skip-worktree or assume-unchanged, included), a staged version that differs from both HEAD and the disk,
        and non-secret untracked files — becomes one WIP commit. It is built with `git commit-tree` in a scratch
        copy of the tree's own index, so the user's index file is never written, and its parents are the ones
        `git commit` would give it: HEAD, then each `MERGE_HEAD` line while a merge is in progress, and last,
        only when the staged version differs from both HEAD's tree and the WIP's, a commit of that staged index.
        **It moves no branch and no HEAD** (wave 3's `wip-moves-no-ref`, D-3365): it is kept by its id in the
        attic (step 3), so whichever branch the tree has checked out is never written, and the tombstone's `tip`
        is the branch's own tip, never the WIP. Each same-repository nested checkout gets its own WIP commit the
        same way, innermost first. ccd had no commit helper before this verb; every commit a reclaim writes —
        these, and step 3's reflog keep — goes through one writer (`_ws_reclaim_commit_tree`) with one fixed
        identity, under the reclaim's git containment, and it is still the only place in ccd that writes a commit.
     ```
   - **§5.5 pin phase, step 3** (lines 353-355). Replace from `3. Attic pins are taken: the branch tip including that WIP commit,` through `` (`REBASE_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `ORIG_HEAD`) where present. `` with:

     ```
     3. Attic pins are taken under `refs/ccrc/attic/<id>/`, and none is optional: the in-progress operation heads
        (`REBASE_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `ORIG_HEAD`) where present; HEAD; the WIP commit, by its
        id; each nested same-repository checkout's operation heads, HEAD and WIP commit; the branch tip, which is
        required because it is the commit the tail deletes the branch at and, on a detached or drifted tree,
        nothing else pins it; and every stash attributed to the branch. Then every commit the child's own reflogs
        name (its HEAD's, its branch's, and each nested checkout's and nested branch's), and everything the
        child's and each nested checkout's own git directory names, is kept reachable from
        `refs/ccrc/attic/<id>/reflogs`. A pin that cannot be taken fails the reclaim as `pin-failed` while nothing
        is destroyed, and a branch that does not resolve is one, because it leaves the tail no tip to delete at. A
        nested checkout of a different repository cannot be pinned here, so each run of this phase proves it again
        by rung 9's predicate, and a failure there is a pin that cannot be taken. A HEAD that has drifted onto
        another branch keeps that branch: it is recorded, and the tail deletes only the child's own. The tail runs
        this whole phase again as its settle once the pane is dead; every pin is idempotent.
     ```

   Every clause was measured in `ccd/ccd` at 334fb722a, against the headers Step 1 re-reads. Re-read them at your tip.
   - Wave 6's gone-branch pin (R38) rewrites the branch-tip clause again ("the branch tip when the branch exists"). This text is what wave 5's tip ships.
   - `_ws_wip_commit`'s header still quotes the old step 2 wording, as the departure it names. Wave 5 edits no ccd file, so it stays.
   - The step 2 text carries `D-3365`, defined on `origin/main` in the wave-3 plan and prescribed here (contract §11, R47). The §1 line and step 3 carry no `D-` token. The spec already cites `D-` numbers elsewhere.
7. **README's reclaim row** (`README.md`, in the paragraph that opens `**The reclaim sweep, and how to stop it.**`; R46). Locate it by content. Replace these three lines

   ```
   refuses `paused` on the box. The same row lists the children that need a
   human's eye: each standing under a terminal refusal, and each whose reclaim
   has kept failing for 15 minutes.
   ```

   with these three:

   ```
   refuses `paused` on the box. The same row lists the children that need a
   human's eye: each under a terminal refusal, each whose reclaim has kept failing
   for 15 minutes, and each the sweep keeps and never reclaims on its own.
   ```

   - Three lines become three, so no README line moves. No corpus document cites `README.md` by line (measured at 334fb722a), so this keeps the edit inert rather than paying a tax.
   - The added clause is R41's kept sentence in short ("ccrc never reclaims it on its own"). It says nothing about who removes what, so it stays true for `not-a-workspace`, whose sentence tells a person to remove the marker, never the checkout (`not-a-workspace-removes-the-marker`, contract §11).
   - Task 0c edits the same paragraph's "…no hold and no coordination history," line (`README.md:3889` at 334fb722a). That is a different line: leave it as Task 0c left it.
   - The sentence carries no line citation, so the README citation cases must stay green unchanged. Step 8 runs them to prove it.
   - No test pins the old sentence (measured at 334fb722a: `grep -rn "same row lists" server/test pwa/test` prints nothing).
8. **Verify.** Run each line from the workspace root:

   ```bash
   cd server && ./node_modules/.bin/tsc --noEmit -p .
   cd pwa && ./node_modules/.bin/tsc --noEmit -p .
   cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/single-definition.test.ts \
     test/coord-pause-route.test.ts test/box-token-census.test.ts test/coord-abandon.test.ts \
     test/child-reclaim-chip-source.test.ts test/child-reclaim-prose.test.ts
   cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
     -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS ENTRY|THE RANGE BOUND'
   git fetch origin main
   cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
   git diff -U0 -- README.md | grep '^@@'
   git diff origin/main...HEAD -- docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md
   ```

   Expected:
   - Both `tsc` runs print nothing. Every edit here is a comment or a document, and a stray `*/` would show.
   - Every vitest file passes: the kebab scan (`mail-routes`), the routes census (`coord-pause-route`, `box-token-census`), the abandon route's own suite (`coord-abandon`), Task 8's token scan over `AbandonSheet.tsx` (`child-reclaim-chip-source`), README's other pins (`child-reclaim-prose`) and the README citation cases.
   - The README diff, taken before the commit, prints one hunk that replaces three lines with three (`-N,3 +N,3`).
   - The wave-4 plan's diff shows additions only, inside the post-merge corrections block (Task 0b's and this task's).
   - This task writes exactly two `D-` tokens, each defined on `origin/main` and prescribed here (contract §11, R47): `D-282` in `AbandonSheet.tsx`'s header (Step 4) and `D-3365` in spec §5.5 step 2 (Step 6). It writes no other, in any file or in its commit message.
9. **Commit** on the workspace branch:

   ```
   docs(reclaim): G2, G5 and the abandon comments told truthfully; the spec says where the WIP commit lands
   ```

   The body names review 258's G2 and G5, R45's abandon comments, `wip-moves-no-ref` and README's reclaim-row sentence, and no `D-` number. End it with the attribution trailer.

**Tests.** None. This task adds no guard, so it has no mutation table. By wave 1's ruling it carries no content pin: a prose pin against prose is green while both lie. Step 1's measurements are its precondition, Step 8 re-runs the scanners these files are already under, and the review's prose check re-derives each sentence from the code (A[S4-3]).

### A[S4-3] — Task 10 (with A6) and A5's review lenses: what Tasks 9b and 9c add

Everything here is additive to A6 (Task 10) and A5 (the lenses), and replaces nothing they say.

**Task 10:**
- **Step 3.** Neither 9b nor 9c touches a `ccd/`, `agent/` or `deploy/` file. The derived cited set gains nothing from them:
  - at 334fb722a, no basename of `routes.ts`, `watch.ts`, `childReclaim.ts`, `runWords.ts`, `AbandonSheet.tsx` or `RunsScreen.tsx` is cited with a `:<line>` in the corpus;
  - `FILE_RE` admits no `.tsx` and no `.md`;
  - no corpus document cites `README.md` by line, and 9c's README edit replaces three lines with three.

  Re-derive it at the tip, as Step 3 already says.
- **Step 2.** `deviation-refs` and `dtbd` stay green:
  - 9b writes no `D-` token;
  - 9c writes exactly two, each defined on `origin/main` and prescribed by this section (contract §11, R47): `D-282` in `AbandonSheet.tsx`'s header, and `D-3365` in spec §5.5 step 2;
  - from these two tasks, Step 2's added-token loop prints at most `pwa/src/fleet/AbandonSheet.tsx: D-282` and `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md: D-3365`, and nothing for `routes.ts`, `watch.ts`, `childReclaim.ts`, `README.md` or the wave-4 plan;
  - neither commit message carries a `D-` token.
- **Step 4.** A6's two commands already carry every suite 9b and 9c need: `test/abandon-sheet.test.tsx` and `test/session-line.test.tsx` (pwa), and `test/child-reclaim-chip-source.test.ts`, `test/mail-routes.test.ts`, `test/child-reclaim-prose.test.ts`, `test/coord-pause-route.test.ts`, `test/box-token-census.test.ts` and `test/coord-abandon.test.ts` (server). This section adds none. The last three are there because:
  - `coord-pause-route` and `box-token-census` read `routes.ts`, whose docstring 9c edits;
  - `coord-abandon` is the abandon route's own suite.
- **The PR body.** A6's item 5 ("Abandon copy and prose") is the one item for 9b and 9c. This section adds none.

**A5's review lenses gain:**
- **SAFETY (mandatory under R47).** Read the child and unknown sentences, and Task 9's new child title, against every condition that keeps a child after an abandon:
  - an open sibling;
  - R37 as R40 fences it;
  - an accounted programme hold, or a hand hold;
  - `review-report-live`;
  - the reclaim-pause switch;
  - presence;
  - R41's kept words, and its doubt words;
  - a terminal ccd refusal;
  - a failure the sweep retries (`pin-failed`, and R43's two lock failures).

  No branch may promise that a reclaim will happen. The list of what is kept and removed must match the spec's §4 "Reclaim" vocabulary and §5.5 step 1.
- **PWA surface.**
  - `childMarkOf` gives four answers, and neither caller folds `unrecognised` into `none`.
  - AB6 holds `FleetSession.child` to one read, in `runWords.ts`.
  - Task 8's token scan covers `AbandonSheet.tsx` from Task 8 on: A-S3-11 lists it last in `FILES` and reads it by path, and AB6 and AB7 address files by path.
  - AB7 holds the close response's why-word unread.
  - The non-child sentence is byte-identical to the shipped one.
  - The no-session branch is decided on `run.sessionId` alone.
  - A child handed over from an earlier wave gets the child copy (AB5).
  - The shipped negative pins (`archive`, `failed`, `still claimed`, `does not recognise`) still bind.
- **Prose (the lens that reads 9c; the whole-branch pass if A5 names none).** Re-derive each sentence from the code at the tip, never from this plan:
  - the sweep's one `await` sits after its loop;
  - the `ticking` guard exists;
  - `deferredSinceMs` is `firstDeferredAt`, which a first sighting resets to `null`, including Task 0b's re-seed on a new birth;
  - `deferExpired` reads the presence episode;
  - the abandon route's docstring and the sheet's header describe `abandonConsequence` and `childMarkOf` as 9b built them, and promise no reclaim;
  - the WIP's parents, `commit-tree`, the hidden-edit rule, the attic pins, the nested checkouts and the settle all match `ccd/ccd`.

  Also check the documents:
  - spec §1's ruled row is unchanged, and the line under the table is R46's, verbatim, after a blank line;
  - the wave-4 plan's A10 lines are unedited, and the G2 correction is a bullet in Task 0b's block;
  - README's added clause names only the children R41's kept words keep, and its edit moved no line;
  - this branch's only spec hunks are §1's line under the table and §5.5 steps 2 and 3; §5.7, §5.9 and every other spec text at the tip are the coordinator's docs commit's, and this branch adds none of them (R46, contract §11).
- **The reviewer's suites** (A5) already carry `server/test/coord-pause-route.test.ts`, `server/test/box-token-census.test.ts` and `server/test/coord-abandon.test.ts`, which read the file 9c's docstring edit touches. This section adds none.
- **Whole-branch pass.** Neither 9b's nor 9c's commit message carries a `D-` token, and the only `D-` tokens they add to tracked files are 9c's `D-282` and `D-3365`, both defined on `origin/main` (contract §11, R47).

**`## Deviations found`, likely places, gains:**
- an abandon sentence that had to change to stay true at the tip;
- a file other than `archiveReleased.ts` and `runWords.ts` that AB6 had to admit, and the field it reads;
- an `await` added before the sweep's loop by an earlier task, which falsifies G2's replacement (stop);
- Task 0b renaming the function G5's replacement names;
- Task 0b's post-merge corrections heading absent, renamed or not exactly once, so 9c Step 5 has nowhere to append (stop);
- README's sentence found changed, or the edit not kept to three lines;
- spec §5.7 or §5.9 text the code cites found missing at the tip (the coordinator's docs commit's; reported, never written by 9c).

### A4 — `## Deviations found`: the preamble replaced, the likely departures re-listed

**Why.** plan:3182 says the programme's single block was allocated at run-open, and it lets a worker write a placeholder in place of a number (pre-flight P5, F17). Both are out of date:
- Each wave now gets its own block.
- R47 bars a `D-` token for a number nobody defined, and departures are named by slug in the wave-done mail (as wave 4's R-12 had it).

Of the likely departures, six cite entry conditions that now print ((f), (g), (i), (l), (m) and (n) all print at `334fb722a`), while none names an amended task. plan:3041's "This wave defines none" sits inside Task 10, which A6 replaces; A6's Step 2 says "The worker defines no deviation number" in its place.

**plan:3182-3186 are replaced by:**

"Numbers are ISSUED, never chosen. Wave 5's block was allocated at run 260's open (2026-10-04): 3926, 3927, 3928, 3929, 3930, 3931, 3932, 3933, 3934, 3935, 3936, 3937, 3938, 3939, 3940, 3941, 3942, 3943, 3944 and 3945. That is twenty single numbers. None is written as a range. None appears as a `D-` token anywhere until the coordinator defines it in this section.

The block is kept whole for departures the worker finds while executing. The departures these amendments accept are ruling text in contract §11, and none of them takes a number.

A worker never calls the allocator (worker clause 11; coordinator clause 10).
- A departure from this plan is named by a short kebab-case slug in the wave-done mail.
- The worker writes no `D-` token for a number that `origin/main` does not define.
- The only defined ones the worker adds to a file are D-282 and D-3365, and only where Task 9b's or Task 9c's binding text prescribes them verbatim. Both are defined on `origin/main`. The plan's own Task 5 and Task 6 comments cite two more numbers defined on `origin/main`, D-2545 and D-287, each already carried by the file it is written into (`server/src/coord/routes.ts`, `pwa/src/screens/RunsScreen.tsx`), so they add no token. No other `D-` token is added by this wave.
- No commit message carries a `D-` token.
- The coordinator assigns each departure a number from this block and defines it here, number and definition in one act.
- A session that cannot reach the coordinator names the slug in its report and says why.

This section keeps no headroom count. Wave 6's block is allocated at wave 6's own open and is never drawn from this one."

**plan:3187-3196 (the likely departures) are replaced by this list.** None is pre-numbered. It tells the coordinator where to look.
- **Task 0b:**
  - the lane's two clocks need a deps seam (a monotonic clock source) that the watcher's deps lack;
  - a seeded harness copies the lane's one-slot and STALL loop, and drifts from `watch.ts`;
  - the case pinning "never licensed" for three due children (`server/test/child-reclaim-sweep.test.ts:1605-1619` at HEAD) flips. That is the ruled direction, but a pinned case changes;
  - an entry clock ruled monotonic is shown somewhere as a time. Only `firstDeferredAt` is ruled an epoch that is displayed;
  - the lease's forfeit, or the reject and stall arms, need a lane input that the L1 next-state function cannot take as an argument.
- **Task 0c:**
  - the one fence needs an input that one of the four consumers lacks. At HEAD those are `close.ts:694`, `coord/childReclaim.ts:767` and `:1103`, and `watch.ts:3113`;
  - or a reclaim-displacement claim cannot be placed by the fence.
- **R41:** a `ChildReclaimSweepSkip` word that Task 2b's one table cannot class (kept, doubt, held or ordinary), or a verdict that cannot be recorded without a field on the coord frame.
- **R43:** a path on which `flock-unavailable` or `lock-unopenable` still reaches the chip through the unclassified-token arm (`refused`).
- **R44:** the de-duplication needs memory that a restart clears, so a row is re-written once per process.
- **R45:** a pinned sentence in `pwa/test/abandon-sheet.test.tsx` beyond the ones R45 changes.
- **R46 (Task 9c):** an anchor that another document cites into README or the spec moves with Task 9c's text.
- **Task 2:** wave 4's `reviveLifecycleRow` is read in place of the mapper the plan prescribes.
- **Task 1 Step 5:** a `RunSummary` builder that a later programme added.
- **Task 10 Step 3:** a cited file inserted into beyond those expected (`shared/api.ts`, `server/test/session-hook.test.ts`, and `server/test/single-definition.test.ts` when touched at or before its corpus anchor).
- **A3's overlaps:** a merge of `origin/main` that moved a cited file or the sweep pass.
- **A1's boundary:** any edit under `ccd/`, `agent/` or `deploy/`. That is a STOP: named, never built.

Task 5's sweep-entry literal is not listed: its spread form is prescribed (A-S3-9, with Task 0b's field names), so it is no departure. The chip section (A-S3-14) and the abandon and prose section (A[S4-3]) add their own entries to this list, and they are read as part of it.

**Tests:** none here. `deviation-refs` and `dtbd` (Task 10 Step 2) red on a stray definition or placeholder, and Step 2's added-token check lists every `D-` number the branch adds.

**Deploy class:** process only.

### A5 — `## Review lenses`: replaced in full; SAFETY mandatory

**Why.** plan:3202 says "This wave destroys nothing, so the destructive-path safety lens that wave 3 mandates does not apply." Two rulings make that false, and each change is a SAFETY item (pre-flight P2, F2, A-iface-3; R47):
- R39 changes when the sweep licenses its single `--defer-expired` attempt, which skips ccd's presence rungs.
- R40 changes which marked children the close, the executor, the hold-release job and the sweep may take.

R47 adds one measurement: F6 waits for wave 6, so this lens measures that git's local environment is absent from the units on the fleet box, the one box that runs ccd's reclaim. That turns F6's deferral into a stated residual. The section also lacks wave 4's framing (wave 4's A15): the plan's lenses run in addition to the held-out panel. F2's collector, F6 and gone-branch items go to wave 6's SAFETY lens (A1).

**The body of `## Review lenses` (plan:3202-3216, under its heading at plan:3200) is replaced by the text below.** A worker and a reviewer read it as that section.

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written (coordinator clause 14).
- Every finding from these lenses gets the panel's three Sonnet·high refuters, and the majority decides.
- A lens that dies or returns nothing is unverified, never approval.
- Each reviewer reads in its own worktree, at one measured tip (reviewer clauses 3 and 4).
- The plan text the branch is held to is the blob at `planSha` (A3).
- Each lens below also carries the SAFETY-lens bullets Task 0b's and Task 0c's amendments (A0b, A0c) add, and the checks the chip section (A-S3-14) and the abandon and prose section (A[S4-3]) add. They are read as part of this text.

0. **SAFETY: when a deletion is licensed, and which children may be taken (opus, xhigh, MANDATORY).** Read these together, at the tip, against `origin/main`: `childReclaimSweepVerdict`, `childReclaimAskOrder` and the entry's next-state function, the generation reset (`childReclaimSameGeneration`), the lane in `watch.ts` (its answer, reject and stall arms), the executor's re-reads, the hold-release job, and close's decision.

   **R39, the bound.**
   - Re-derive it from the constants at the tip. At HEAD: C = `CHILD_RECLAIM_DEFER_CEILING_MS` (900 000 ms); S, the largest spacing between passes, from `CHILD_RECLAIM_SWEEP_MS` (60 000 ms; 51 to 80 s live); G, the gap, `CHILD_RECLAIM_PRESENCE_GAP_PASSES` (2.5) passes, 150 000 ms; STALL = `CHILD_RECLAIM_STALL_MS` (480 000 ms); L_p and L_r, the presence-answer and reclaim latencies.
   - Name the four hypotheses the bound rests on (Task 0b's (c)):
     - T1: S + L_p ≤ G;
     - T2: a presence answer settles before the next pass;
     - T3: no wall step or suspend during the lease;
     - T4: the lane's memory is not cleared, and each presence-held child stays eligible and answers presence while unlicensed.
   - State three figures separately, and never run them together:
     - from the lease's first ASK, a holder is licensed within C + S + L_p, about 16.5 minutes at the 2026-10-05 spacing;
     - one lease cycle, from its first ask to the next lease's first ask, is at most C + 2S + L_p + L_r, about 18.6 minutes;
     - the worst case under T1 to T4 is k × (C + 2G + STALL), about k × 28 minutes, where k is the child's position among presence-held children in the ask order.
   - A violation of T1 to T4 forfeits the lease and fails closed. Show it for each: a transient breach restarts one episode, and a cleared memory (T4) restarts every clock and every lease.
   - The lease takes EVERY pass while it is held, never every other pass.
   - The holder is the least by (`presenceHeldSince`, `firstEligibleAt`, id). `presenceHeldSince` is read by the order alone, never by the licence.

   **R39, the lease's tenure.**
   - It is decided in L1: `childReclaimAskOrder` names the holder.
   - A holder whose presence answer fails to continue its episode forfeits the lease (`presenceHeldSince` → null) and re-joins at the back. A waiting member, asked as a non-holder, keeps its place.
   - Every rejected request, a holder's or not, is written as a failed attempt: it ends the episode, forfeits a holder's lease and backs off.
   - A stalled request sent as holder forfeits on its late answer, which arrives at least `CHILD_RECLAIM_STALL_MS` (more than G) after its request. Nothing is written at stall time.
   - A waiting member that becomes holder after a breach may forfeit on its first holder answer, because its stale episode cannot continue. That costs liveness only, and it is accepted as built: no grace is added.
   - Show that a PERSISTENT breach of T1 or T2, or a holder whose requests keep rejecting or stalling, cannot hold the lease for ever: every other due child, a reclaimable one included, is asked within a bound the reviewer derives and states (Task 0b's (c): a presence-held child ahead of it costs at most two asks).

   **R39, one entry per workspace generation.**
   - The entry carries `bornAt`, the birth R-5d places, and a birth change re-seeds the entry as a first sighting (Task 0b's rule item 7). Show that no observation of an earlier workspace under a recycled slug reaches a licence.
   - A replaced entry makes the identity guard drop any answer still in flight for the old one.
   - `bornAt` is ccd's clock, compared for equality only and never subtracted.

   **R39, never earlier and never more often.**
   - Only the order of the due list, and the lease's forfeit, change. Nothing asks a child earlier or more often than on `main`: asks per pass, `CHILD_RECLAIM_MAX_IN_FLIGHT`, the backoff and every pacing rule are unchanged or only slower.
   - A licensed request's answer, its rejection or its stall ends or restarts its episode, so the rule of one licence per episode stands. Read the reject and stall arms, not only the answer arm: a licensed request whose promise rejects must not leave an episode that licenses again on the next pass.
   - No ask is licensed that a lone child would not get.

   **R39, the clocks (G4-B).**
   - Every in-memory decision clock of the entry and the lane's pacing is monotonic.
   - Comparisons with another process's stamps stay on wall time: the verdict's `nowMs`, the generation fence, the attention list and the birth fence.
   - `firstDeferredAt` stays a wall-clock epoch, because it is the chip's `at` and the feed's `deferredSinceMs`. A test pins that. `lastPresenceWallAt` is the gap's wall operand and is never displayed.
   - The gap and freshness predicates read the LARGER of the monotonic and wall-clock differences, inclusive at 2.5 passes. `CHILD_RECLAIM_PRESENCE_GAP_PASSES` is still 2.5.
   - The ceiling's span reads the monotonic clock alone.
   - So a suspend (the monotonic clock stops) and a backward wall step across a hole each read as a hole, and a forward step over-reads and restarts the episode. Neither the twice-observed rule nor the in-flight stall clock can be satisfied by a forward wall step.

   **R39, the arrival stamp (G1-C).**
   - The episode starts at the first presence answer's ARRIVAL.
   - Continuity runs from the new answer's arrival back to the previous answer's request.
   - Freshness at the ask stays on the request.
   - The arrival is read in the answer's own `.then`, never taken from the pass that sent the request.

   **R39, seeded interleavings, run by the reviewer.**
   - Build the probe independently of the worker's harness, in scratch, never committed.
   - Compose the exported L1 functions with the lane's one-slot and STALL model, over true, monotonic and wall clocks.
   - Run at least seeds 1 to 300 (review 258's scale), for N = 3, 4, 5 and 6 presence-held children, plus one reclaimable child and one that defers for ever.
   - Run these modes: `none`; `back`, a backward wall step with no hole; `back-hole`, a backward wall step across a real hole (a true gap over 150 s); `fwd-small` and `fwd-large`, forward wall steps below and past `CHILD_RECLAIM_STALL_MS`; `suspend`; `slow-tick`; `slow-answer`, a slow first answer; `transient-breach`, a transient breach of T1 or T2; `slow-persistent`, every pass spaced 160 s; and `reject`, each licensed request of one child rejecting once.
   - Report, per mode, with the seeds:
     - (i) licensed asks whose TRUE observation chain is broken (a gap over 150 s, the last observation more than 150 s before the ask, or the first observation less than 900 s before it). This must be 0 in every mode, the breaches included.
     - (ii) two licences of one child less than 900 s apart. This must be 0 in every mode, `reject` included.
     - (iii) presence-held children not licensed within the stated bound. This must be 0 in `none` and `back`. In the other modes, except `transient-breach` and `slow-persistent`, report the worst licence time per N, and whether every presence-held child is licensed within (N + 1) × (C + 2G + STALL) plus the disturbance.
     - (iv) in `slow-persistent` and `reject`: the longest wait of any non-presence due child, against the bound the reviewer stated, and whether the reclaimable child is reclaimed within 6 hours.
   - Run at least one N through the real watcher, not only through the probe.

   **R39, mutation re-checks.** Each of these must red its named cases in Task 0b's suites (case ids as Task 0b's table numbers them):
   - the shipped fairness order in place of the lease (`watch.ts` keeps its inline `due.sort`): three or more presence-held children are never licensed. L1, L2, P1 and S2;
   - every-other-pass leasing: L2, in which `a` is then licensed at its 9th ask, not its 16th;
   - no forfeit (a holder keeps `presenceHeldSince` when its episode restarts): L14, L16, P5, S1 `slow-persistent` and S2 `slow-persistent`, the cases in which one breaching holder starves a reclaimable child (and the probe's `slow-persistent` mode);
   - a rejected licensed request leaves its entry untouched: L15, whose next request then goes out licensed (and the probe's `reject` mode);
   - the wall clock alone in the gap: L6, P10 and S1 `back-hole` (the probe's `back-hole`). A backward step with no hole does not red it, so a case without a hole proves nothing here;
   - the monotonic clock alone in the gap: L7, P11 and S1 `suspend`;
   - the episode stamped at the request: P8 and L11, the slow-first-answer cases;
   - `firstDeferredAt` stamped from the monotonic clock: P13, L12 and L13, the epoch cases for the chip's `at`;
   - `presenceHeldSince` read by the licence: P6;
   - the generation reset dropped: P14 and L17.

   **R39, nothing that guards deletion moved.**
   - Diff `childReclaimSweepVerdict` against `origin/main`. No conjunct may be removed or relaxed.
   - The executor's presence skip under `deferExpired` is unchanged, and so are ccd's rungs 5 and 6. `--defer-expired` still skips only those.
   - These corrected texts are true of the code: wave 4's A9 backlog sentence, the `ChildReclaimSweepEntry` and gap-constant docstrings, and wave 4's lens-1 sentence.

   **R40, one fence.**
   - At HEAD the coordinating read, `childReclaimCoordinatorIds()`, has four consumers: close's decision (`close.ts:694`, `has-coordinated`), the executor's step 2a (`coord/childReclaim.ts:767`), the hold-release job's step 5 (`coord/childReclaim.ts:1103`, R34's fifth condition) and the sweep (`watch.ts:3113`).
   - At the tip each decides through the ONE fence, `childReclaimCoordinated` (L1), over the ONE store read `childReclaimCoordinatorClaims` and the ONE birth placement `childReclaimBornAt` (Task 0c's names). Close, step 2a and step 5 call it through `childReclaimHasCoordinated`; the sweep reaches it through its verdict. That is one decision with two call shapes, not a second reader. No unfenced read decides anything, and no second birth placement exists.
   - The fence keeps the child when any of these holds (Task 0c's items 1 to 4):
     1. a run claiming the id is not terminal (`open`);
     2. a terminal claiming run, or a displacement row naming the id, carries no readable instant (`unplaced`): a NULL `closedAt`, or a `closedAt` or `at` that does not read as a positive safe integer;
     3. the current generation's birth cannot be placed (`bornAt` null), or the comparison cannot be made (a non-number on either side);
     4. the claim's instant is at or after the birth minus `CHILD_BIRTH_SKEW_MS`. The instant is the greatest of (a) each terminal claiming run's `closedAt`, (b) the `at` of each `reclaim:` displacement row naming the id as the displaced side, and (c) the `at` of each such row naming it as the heir.
   - The birth is placed as R-5d places it: `lifecycleCreatesFor` plus `childReclaimGeneration`, on ccd's `at` alone, never `ingestedAt`.
   - Doubt keeps the child. Check that a `closedAt` or displacement `at` stored as REAL or TEXT (SQLite's INTEGER affinity admits both), and a NaN birth, each keep it. A comparison that answers false on NaN fails open.
   - A claimant known only through a displacement row is placed by that row's `at`, or it keeps the child. It is never dropped.

   **R40, R34 amended.** The hold-release job's step 5 reads the same fence, so R34's fifth condition becomes "has not coordinated in its current generation". A retired programme's hold on a child whose slug coordinated only in an earlier generation can now be released. Check that the job's other four conditions are unchanged.

   **R40, why the fence is safe.**
   - Re-derive from `cmd_ws_add` at the tip that ccd journals `create` only there, and that it refuses a slug with a registry row or an existing branch. So a newer `create` proves that the earlier workspace (the coordinator's) was removed, and that no session can be inside it.
   - A nested coordinator that is itself a child coordinates after its own birth, so its claim counts.
   - Unmarked workspaces never enter the population (rule 4).

   **R40, residuals to state.** State Task 0c's residual 1 as worded there, and say whether the tip narrows any of it:
   - The fence compares ccd's `create` `at` with the server's `closedAt` and displacement `at`. An offset between the two clocks at those instants beyond `CHILD_BIRTH_SKEW_MS` makes the child reclaimable. Such an offset can be a sustained skew between the boxes, or a step of either box's wall clock: a server stepped back after the birth, or a fleet box stepped forward at the `create`. Under it, a claim this generation ended within that excess after its birth reads as before it.
   - The same holds for an heir chosen while its own `ws-add` has not yet journaled `create done`. The reclaim door reads its `now` before its awaits, and `cmd_ws_add` writes the registry row before its unbounded `.ccrc/workspace.sh` and its `_lc_done create`.
   - Reaching either needs a coordinator claim that ended, or a chair taken, within minutes of the workspace's own creation. It is fail-open, the same direction R-5d's birth fence names.

   **R40, mutation re-checks.** Each must red its named cases in Task 0c's suites:
   - Drop the time bound: a recycled-slug case reclaims a child whose CURRENT generation coordinated, which is red (K1.7, K1.8, K1.9, K4b, K5b and K6b).
   - Drop the open-run arm (K1.2, K4c), fold an unplaceable birth into "not coordinating" (K1.10, K5c), or drop the skew (K1.7, K1.8, K4d): each reds its case.

   **R40, the live case.** Measured read-only on 2026-10-05 at 16:59 UTC (A0c's re-measure): of 20 marked children, only `ccrc-pwa-brisk-meadow` is any run's `claimedBy`. It claimed eight program-leverage runs between 10 and 30, all `done`, the last closed 2026-09-04 14:53 UTC; its current generation was born 2026-09-26 09:09 UTC. State whether the tip makes it eligible. Re-run that classification over the live markers at the tip (Task 0c's "Before landing" re-measure, A0c, has the commands), and state that nothing else changes class, or name what does. The coordinator's pre-landing list covers claimants only. A child kept today only by a `reclaim:` displacement row naming it on the `from` side has no API read, and nobody reads the server's `coord.db` for it, so the list names it as its stated residual, "not listed: the API cannot read displacement rows" (A0c).

   **R41, read-only.** `currentChildReclaimVerdicts()` and its two reductions (Task 4b) are written after the verdict and are read by no decision: not by `childReclaimSweepVerdict`'s inputs, the due set, the lease or the executor. They do feed the attention list, through its kept arm and its held filter (Task 4c), and the list feeds each request's `feedQuiet` (Task 4d), which only spares a feed row. A child is dispatched only on an eligible verdict in the same pass, so no kept or held filter can change a dispatched child's `feedQuiet`, and no ask reads the verdicts (A-S3-7). "No verdict yet" is its own value and never reads as eligible.

   **The SAFETY lens also reads** what Tasks 2b, 4b, 4c, 4d and 9b add to it (A-S3-14, A[S4-3]): the unchanged terminal refusal, the verdict's loop write and its reductions, the attention list's publish move and its held filter, the feed skip's proof that it changes no outcome, dispatch or pacing, and the abandon copy against every condition that keeps a child.

   **F6's residual, measured (R47).** Only the fleet box runs ccd's reclaim: in remote mode the server box runs no ccd. So measure the fleet box alone, read-only, printing only the NAMES of git's local environment variables present in the running units' environments and in the user manager's:

   ```bash
   vars=$(git rev-parse --local-env-vars)
   for u in ccrc-agent.service ccrc.service; do
     pid=$(systemctl --user show -p MainPID --value "$u" 2>/dev/null)
     [ -n "$pid" ] && [ "$pid" != 0 ] && tr '\0' '\n' < "/proc/$pid/environ" | cut -d= -f1 | grep -xF -e "$vars" | sed "s#^#$u: #"
   done
   systemctl --user show-environment | cut -d= -f1 | grep -xF -e "$vars" | sed 's#^#user manager: #'
   ```

   Expected: nothing. The list includes R47's two, `GIT_CONFIG` and `GIT_CONFIG_PARAMETERS`. The commands print names only, never a value, and a unit the box does not run prints nothing. The server box is out of scope, not UNMEASURED. A fleet box the reviewer cannot read is reported UNMEASURED, never assumed clean. A non-empty answer is a SAFETY finding: F6 is then live, not a residual.

1. **Derivation and wire (opus, high).** plan:3204-3214 stand, re-derived from the code, with these additions.
   - **R41.** On the chip:
     - the kept words read `refused`, with a kept sentence that names why. Five of them end "ccrc never reclaims it on its own; a person removes it once nothing still needs it." `not-a-workspace` ends "ccrc never reclaims it on its own; a person removes the marker, never the checkout." The two minting-run words carry "After a rebuild, workers may still be running in these." directly before that ending. The kept words are `coordinating` (after R40), `minting-run-absent`, `minting-run-postdates-child`, `child-birth-unplaced`, `reviewed-run-absent` and `not-a-workspace`;
     - the fleet-wide switch never replaces a kept answer, a pause included: a kept verdict survives the pause and the chip keeps its kept sentence, because the banner keeps listing the child. Check this through the real watcher (a judging pass, then `reclaim-paused` raised and a pass run), never through a spied verdict map;
     - the doubt words read `deferred`, with a doubt sentence, and the switch turns them to `paused`. They are `marker-unreadable`, `identity-unmeasured`, `hold-unmeasured`, `minting-run-unreadable`, `reviewed-run-unreadable` and `siblings-unreadable`;
     - `held` reads `deferred` with the hold sentence, and the switch turns it to `paused`;
     - there is no sixth word: `CHILD_RECLAIM_WORDS` keeps the contract's five;
     - plain `S.pending` appears only when the last verdict was eligible or an ordinary skip. "No verdict yet" reads `pending` with its own sentence (`S.unjudged`), never the eligible one.
   - **Precedence (Task 3's mapping, as A-S3-4 amends it).** A done reclaim, a gone answer and a terminal refusal outrank the verdict; a non-ordinary verdict (kept, doubt or held) outranks every other event: a failure line, a retryable refusal, a refusal with no token, the on-box `paused` token and an unclassified token. That amends R21 for those events alone. No row promises a retry that a hold or a kept word prevents: a held or kept child whose latest event is a failure or a retryable refusal must not read "The sweep tries again on its own".
   - **R42.** No close word is stored. `git diff origin/main...HEAD -- server/src/coord/schema.ts` shows no new migration, and no run-event kind or wire field carries a close word. The chip reads current state.
   - **R43.** Exactly two tokens, `flock-unavailable` and `lock-unopenable`, read as retryable failures on every surface: `deferred` on the chip, and the attention list's failure arm after 15 minutes of unbroken failure. Never `refused`. One L1 predicate classifies them for both readers, and the terminal-refusal predicate and the token-kind map are byte-identical to `main`. A token ccd journals later (wave 6) is classified when it is added, never inherited.
   - **R4′ with R39.** plan:3210's R4′ bullet is read with Task 0b's amendment of `S.sweepDeferred`. That text is true of the lane at the tip, on a slow box and across a restart (a restart starts every episode again), and promises no bound the lane does not keep. The chip's `at` is `firstDeferredAt`, an epoch.
   - **The wire stays additive.** `FLEET_PROTO` is unchanged, and every new field is optional, through one reader.

2. **PWA surface (opus, high).** plan:3215 stands, with these additions.
   - **R45.**
     - `childMarkOf` is the one PWA reader of `FleetSession.child`. It gives four answers: child, none, unreadable and unrecognised. `childOfRunLabel` and the abandon copy both project it, so no null is overloaded.
     - The abandon confirmation has four branches: no session, child, not a child, and unknown.
     - The non-child sentence is byte-identical to `main`'s.
     - The ungated abandon door and its no-archive-control pin are unchanged.
     - The comment above the abandon route in `server/src/coord/routes.ts` ("a release destroys nothing") and `AbandonSheet.tsx`'s header are corrected in Task 9c, in the same PR as the copy.
   - **R41 on the banner.**
     - Kept words reach the Runs attention list from the first pass that answers one, with one emit per change (the coord frame's byte-equality guard).
     - Doubt words and `held` never reach the attention list.
     - One item per child: a kept item replaces that child's failing item, and a terminal item stands.
     - A child whose last measured verdict is `held` is not listed by the failing arm. With no verdict recorded (a restart, a pause), wave 4's failing arm stands unchanged, and under a pause the banner's paused state governs. A held child with a mirror failure run past the ceiling is absent from the banner, and dropping the held check reds that case. Only `held` withholds: a child whose last verdict is a doubt word keeps wave 4's failing item.
     - After a lost or rebuilt coordination database, more than five children answering the same kept word render as one line with the count, and the list behind it.
   - **The PWA maps no token.** Task 8's pin, addressed by path and never by index, covers `pwa/src/fleet/runWords.ts`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/SessionLine.tsx`, wave 4's `pwa/src/fleet/childReclaimWords.ts` and `pwa/src/fleet/ChildReclaimBanner.tsx`, and `pwa/src/fleet/AbandonSheet.tsx`, appended last.

3. **Cost, degrade, the feed and the citation tax (opus, high).** plan:3216 stands, with these additions; its "exactly `shared/api.ts` and `server/test/session-hook.test.ts`" is replaced by the cited-set bullet below.
   - **R44.**
     - A non-presence deferral writes one feed row per episode, not one per pass.
     - A child already on the attention list adds no identical failure row. A row is written again only when its word changes or the child leaves the list.
     - Presence deferrals keep today's shape.
     - Each kept word writes one `child reclaim kept` row per child, per word, per process.
     - Count the rows that a seeded run of passes writes, against `main`.
   - **The verdict accessor costs no I/O.** It is in memory and written in the per-child loop. Transient verdicts are cleared wherever the defers are cleared; kept verdicts survive a pause (R41).
   - **The cited set** is the one Task 10 Step 3 derives: `shared/api.ts` and `server/test/session-hook.test.ts`, plus `server/test/single-definition.test.ts` if a task inserted into it at or before its corpus anchor (`:1303` at HEAD). Each has S6-R11 paid in the task that inserted into it.
   - **The boundary holds:** no file under `ccd/`, `agent/` or `deploy/` changed (R38).

**The suites the reviewer runs** (reviewer clause 5). Run them in the reviewer's own worktree at the measured tip, after `git fetch origin main`. Run each line from the worktree root, in the foreground with a 600000 ms timeout, one after another:

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts test/child-reclaim-sweep-policy.test.ts \
  test/child-reclaim-close.test.ts test/child-reclaim.test.ts test/child-reclaim-generation.test.ts \
  test/child-reclaim-paused-at-server.test.ts test/child-reclaim-prose.test.ts test/coord-store.test.ts \
  test/mail-routes.test.ts test/fleetws.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim-wire.test.ts test/child-reclaim-events-store.test.ts \
  test/child-reclaim-status.test.ts test/child-reclaim-watch-view.test.ts test/child-reclaim-runs-route.test.ts \
  test/child-reclaim-chip-source.test.ts test/reconstruction-drill.test.ts test/lifecycle-store.test.ts test/auth-gate.test.ts \
  test/coord-pause-route.test.ts test/box-token-census.test.ts test/coord-abandon.test.ts
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/single-definition.test.ts \
  test/topology-clean.test.ts test/ownership.test.ts test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS ENTRY|THE RANGE BOUND'
cd pwa && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/vitest run test/runs-screen.test.tsx \
  test/session-line.test.tsx test/abandon-sheet.test.tsx test/child-reclaim-banner.test.tsx test/coord-banner.test.tsx \
  test/fleet-css.test.ts test/contrast.test.ts test/tap-targets.test.tsx test/api.test.ts test/runs-health.test.tsx
git diff --name-only origin/main...HEAD -- ccd agent deploy
```

The reviewer also runs every test file an amended task creates or modifies (each A-section names its own), the seeded probe above, and the F6 measurement.

Expected:
- The last command prints nothing.
- `ownership` is green and unedited, because no stamped file moved.
- The `ccd-child-reclaim-*` suites are not required, since there is no ccd edit. A reviewer who doubts the boundary runs them.
- A red is measured against `origin/main` before it is called the wave's. `tmp-sweep`'s "FAILS CLOSED" case is a known fleet-box red.

**Whole-branch pass.** Hold the branch, read as one change, to seven things:
- no `ccd/`, `agent/` or `deploy/` path;
- no `D-` token in any commit message, and every `D-` number the branch adds to a tracked file (Task 10 Step 2's added-token check) is D-282 or D-3365, written where Task 9b's or Task 9c's binding text prescribes it verbatim. Both are defined on `origin/main`. No other `D-` token is added: the plan's Task 5 and Task 6 comments repeat D-2545 and D-287, which their files already carry, and the check does not print them;
- no hostname, IP, tailnet name or docserver URL;
- every new guard carries a mutation row that reds;
- every code comment cites the spec, never the contract or a ruling's date, and the spec at the tip says what the code does: §5.7 and §5.9 as the docs PR merged them, and §1's line and §5.5 as Task 9c writes them (A1);
- Tasks 9b's and 9c's prose, re-derived from the code at the tip by the prose checks A[S4-3] lists, since no lens of its own reads them;
- the PR body names `ccrc-pwa-brisk-meadow` and `reclaim-pause`, and asks for no hand rollout.

**Tests:** the lenses' mutation re-checks above. This amendment commits no guard.

**Deploy class:** process only.

### A6 — Task 10: replaced in full (whole-branch verification, the PR, landing, and the deploy the updater does)

**Why.**
- **The hand rollout (pre-flight P1, F14; R47).** Task 10 Step 7 has whoever merges run `ccrc rollout --check --to "$TAG"` and then `ccrc rollout --to "$TAG"`. plan:68 and plan:3129-3130 repeat it. The operator ruled on 2026-09-30 that nobody moves a box by hand. Instead:
  - every merge to `main` becomes a prerelease;
  - the fleet's own updater moves the fleet box, then the server box;
  - a failed row halts every move until the operator acks it (`halted`, `server/src/update/dispatch.ts:167`);
  - the ledger records this programme as one that "neither acks nor rolls out".
- **The operator is told before landing (R47).** R39 and R40 widen what reaches the destructive path the moment the server box converges, with no capability gate, while F6 waits for wave 6. The plan has no step that measures which children that moves, or that tells the operator.
- **CI and signal lines (pre-flight P7).** Under `CCRC_SELECTION: enforce` the PR's CI no longer arbitrates flakes outside its selection. Step 1 is not marked as the run whose verdict is the wave-done's `suite:` line, and no suite list is named for the reviewer.
- **Landing (pre-flight P15).** Landing is the coordinator's, and it is measured, not remembered.
- **Step 3 (A1).** Its empty-diff check is right again under R38, but its fallback is a hand re-stamp that this wave can never owe.
- **Deviation tokens (R47).** Step 2 checks only that the definitions cross-check; it never lists the `D-` numbers the branch adds.

**plan:3013-3176 are replaced by the task below.**

#### Task 10 (as replaced): Whole-branch verification, the PR, landing, and the deploy the updater does

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, with one exception. If Step 3's re-measurement moves the citation census, `server/test/session-hook.test.ts` and `README.md` change in their own `docs(census)` commit on this branch.

**Interfaces:**
- **Consumes:** everything Tasks 0b, 0c and 1 to 9, and the new Tasks 2b, 4b, 4c, 4d, 6b, 9b and 9c, produced.
- **Produces:** the wave-5 branch, pushed, with its PR open against `main`. The coordinator lands it, and once the updater converges the server box:
  - the operator can read what became of a child (spec §8's measure for wave 5);
  - a presence-held child is licensed within R39's bound;
  - a child whose slug once coordinated is reclaimed unless its CURRENT generation did, or the fence cannot place it (R40).

  Wave 6 consumes only what its own plan names.

- [ ] **Step 1: The FIRST full run after implementation, in the worktree, in the foreground**

This run's verdict is the wave-done's `suite:` line (worker clause 15). Record it before any fix. A red here stays `red` however many fix rounds follow.

```bash
cd server && npm ci && find test -name '*.test.ts' | wc -l
cd server && ./node_modules/.bin/vitest run --shard=1/6
cd server && ./node_modules/.bin/vitest run --shard=2/6
cd server && ./node_modules/.bin/vitest run --shard=3/6
cd server && ./node_modules/.bin/vitest run --shard=4/6
cd server && ./node_modules/.bin/vitest run --shard=5/6
cd server && ./node_modules/.bin/vitest run --shard=6/6
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

How to run them:
- Run each line from the workspace root, in the FOREGROUND with a timeout of 600000 ms, one after another, never as parallel calls.
- Use ONE denominator for the whole set: 495 server test files at `334fb722a`, and more after this wave. If a shard overruns 600 s, re-run the WHOLE set as `--shard=k/12`. Never split one shard alone.
- Record each shard's `Test Files` line, and check that their sum equals the `find` count.
- `agent` is untouched by this wave and must be green unchanged.

Before calling a red a break, re-run it IN ISOLATION if it is one of these:
- `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`;
- `tmp-sweep`, whose "FAILS CLOSED" case reds on the fleet box on an untouched `main`;
- the `ccd-child-reclaim-*` suites, at 181 to 265 s each.

A red that `origin/main` also shows, measured on a clean checkout of it in scratch, is reported once as `main-red` and left alone (worker clause 16).

- [ ] **Step 2: Type-check, build, and the deviation and census cross-checks**

Each line from the workspace root:

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa    && npm run build
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts \
  test/single-definition.test.ts test/topology-clean.test.ts
git log origin/main..HEAD --format=%B | grep -c 'D-[0-9]'
for f in $(git diff --name-only origin/main...HEAD); do
  comm -13 <(git show "origin/main:$f" 2>/dev/null | grep -oE 'D-[0-9]+' | sort -u) \
           <(grep -oE 'D-[0-9]+' "$f" 2>/dev/null | sort -u) | sed "s#^#$f: #"
done
```

Expected:
- The server `tsc` prints nothing.
- `pwa`'s build (`tsc --noEmit && vite build`, what CI's `build-pwa` runs) exits 0.
- The four vitest files PASS. The worker defines no deviation number (`## Deviations found`, as amended), so `deviation-refs` is green without anyone reasoning about numbers.
- The `grep -c` prints 0: no commit message carries a `D-` token.
- The loop prints every `D-` number a changed file carries at the tip that `origin/main`'s copy of it does not. Expected: nothing, or only D-282 or D-3365 in a file Task 9b or Task 9c edits, where that task's binding text prescribes it verbatim. Anything else is removed before the push and named in the wave-done mail.

- [ ] **Step 3: Prove the wave touched no ccd, agent or deploy file, and that every cited file it touched paid its tax**

```bash
git diff --name-only origin/main...HEAD -- ccd agent deploy
```

Expected: nothing. If anything prints, STOP. That file is wave 6's territory (R38). Revert the edit, and name the departure by slug in the wave-done mail. This wave has no re-stamp step: plan:3069's `markGenerated` contingency is struck.

Next, derive the CITED set this wave touched. Run plan:3054-3059's `comm` command, unchanged, from the workspace root. Expected: `api.ts`, plus `session-hook.test.ts` unless Task 1 Step 6 found the census already green, plus `single-definition.test.ts` if any task edited that file.

For each name it prints, measure the corpus's highest anchor into that file and this branch's hunks there:

```bash
for f in session-hook.test.ts single-definition.test.ts; do
  printf '%s highest anchor: ' "$f"
  grep -ohE "([A-Za-z0-9_.-]+/)?${f//./\\.}:[0-9]+(-[0-9]+)?" \
    docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
    docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md \
    | sed -E 's/.*://; s/.*-//' | sort -n | tail -1
  git diff -U0 origin/main...HEAD -- "server/test/$f" | grep '^@@'
done
git diff --name-only origin/main...HEAD -- shared/api.ts README.md server/test/session-hook.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected:
- In each test file, one of two things holds:
  - every `@@` hunk's `+<start>` is greater than that file's highest anchor (at `334fb722a`, 7056 for `session-hook.test.ts` and 1303 for `single-definition.test.ts`);
  - or the task that inserted at or before the anchor paid S6-R11 by Task 1 Step 6's procedure, and says so.
- Any OTHER name in the `comm` output is a cited file this wave inserted into without paying. Stop, repair it by Task 1 Step 6's procedure, and name it in the wave-done mail.
- The `--name-only` line prints `README.md` and `shared/api.ts`, and `server/test/session-hook.test.ts` too unless Task 1 Step 6 found the census already green.
- `session-hook.test.ts` PASSES. It is a known load flake, so first re-run in isolation any red that names no anchor this wave moved.

- [ ] **Step 4: The wave's own surface, in one run**

Each line from the workspace root:

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-wire.test.ts test/child-reclaim-events-store.test.ts \
  test/child-reclaim-status.test.ts test/child-reclaim-watch-view.test.ts test/child-reclaim-runs-route.test.ts \
  test/child-reclaim-chip-source.test.ts test/reconstruction-drill.test.ts test/lifecycle-store.test.ts \
  test/auth-gate.test.ts test/single-definition.test.ts test/child-reclaim-sweep.test.ts \
  test/child-reclaim-sweep-policy.test.ts test/child-reclaim-close.test.ts test/child-reclaim.test.ts \
  test/child-reclaim-generation.test.ts test/child-reclaim-paused-at-server.test.ts test/coord-store.test.ts \
  test/child-reclaim-prose.test.ts test/mail-routes.test.ts test/fleetws.test.ts test/coord-pause-route.test.ts \
  test/box-token-census.test.ts test/coord-abandon.test.ts
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/session-line.test.tsx test/fleet-css.test.ts \
  test/contrast.test.ts test/tap-targets.test.tsx test/abandon-sheet.test.tsx test/child-reclaim-banner.test.tsx \
  test/coord-banner.test.tsx test/api.test.ts test/runs-health.test.tsx
```

Add to these two commands every test file an amended task creates or modifies; each A-section names its own.

Expected: PASS.
- `auth-gate`'s route counts are unchanged from `origin/main`, unless an amended task registers a route. Re-read them with `grep -n 'toBe([0-9]' server/test/auth-gate.test.ts` and compare with `git show origin/main:server/test/auth-gate.test.ts | grep -n 'toBe([0-9]'`. Never type them.
- Record the counts from the seeded cases that the Task 0b amendment names: the licences, the broken chains, and the worst licence time per N.

- [ ] **Step 5: Check the commit author before pushing**

plan:3084-3091, unchanged.

- [ ] **Step 6: Push and open the PR, on this workspace's own branch**

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 5: the closed run's reclaim chip, a bounded presence rule, a fenced coordinating rule" --body-file - <<'EOF'
Wave 5 of the child-reclamation programme (CCR-15; spec §5.7, §5.9, §8), **server + pwa**.

1. **The run chip** (Tasks 1 to 9). `RunSummary.childReclaim` is one of `reclaimed | pending | deferred | paused | refused`
   with a server-composed sentence, or `null`. It is additive; `FLEET_PROTO` is unchanged. There is one pure derivation,
   one statement per board load, and one tolerant PWA reader that maps no token. A reclaimed row is inert, and
   `SessionLine` shows `child of run #N`.
2. **The presence rule is bounded** (spec §5.7). The first presence-held child in the ask order holds a lease and is
   asked on every pass it is due. A holder is licensed within about 16.5 minutes of its lease's first ask at the
   2026-10-05 spacing, and the k-th in the ask order within k × 28 minutes at worst, while the timing assumptions hold.
   A holder whose episode breaks, or whose request rejects or stalls, forfeits the lease, so no one child can hold it
   for ever. Gaps read the larger of a monotonic clock and a wall clock, so neither a suspend nor a backward step
   hides a hole. An episode starts at its first answer's arrival. No verdict conjunct moved.
3. **"Has coordinated" means this workspace generation.** A recycled slug's past coordinator claim no longer keeps a
   later child; anything unplaceable still keeps it. One fence serves the close, the executor, the hold release and
   the sweep.
4. **The sweep's verdicts are visible.** Kept answers reach the chip as `refused` and appear on the Runs attention
   list; doubts and holds show on the chip as `deferred`. The ten close words are not stored. `flock-unavailable`
   and `lock-unopenable` read as retryable failures. Feed rows are de-duplicated.
5. **Abandon copy and prose.** The abandon confirmation branches on the workspace's child mark (no session / child /
   not a child / unknown); the non-child sentence is byte-identical, and a child's says it is reclaimed when nothing
   keeps it, its work pinned in the attic first. G2's, G5's and the abandon route's comments are corrected, the spec
   says where the WIP commit lands (`wip-moves-no-ref`), and README's reclaim-row sentence names the children the
   sweep keeps. Spec §5.7 and §5.9 already describe this wave: they merged ahead of it, with the coordinator's docs
   PR.

**What widens when the server box converges.** Items 2 and 3 let more children reach the destructive path, with no
capability gate, the moment the server box runs this build. At dispatch the one live child this moves is
`ccrc-pwa-brisk-meadow`, which becomes eligible under item 3; the coordinator re-measures the list before landing.
F6 (git's local environment inside the reclaim's containment) waits for wave 6, a residual the review's SAFETY lens
measures on the fleet box, the one box that runs ccd's reclaim. The operator's stop is `reclaim-pause`, the reclaim
row's toggle on the Runs screen.

No `ccd/`, `agent/` or `deploy/` file changes, so there is no re-stamp, no capability token and no coord.db
migration. Every cited file this wave touched paid the citation tax (S6-R11). R36's collector and the ccd-side items
are wave 6's.

**Deploy:** merge, then the prerelease `release-main.yml` publishes, then the fleet's own updater (fleet box first,
then the server box). Nobody runs `ccrc rollout` or `ccrc update` by hand.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Do not merge. Landing is the coordinator's, at the measured head (Step 7). Whether `main` requires the merge queue is measured at landing (`ccd/coordinator-skill/references/wave-lifecycle.md` §5), never assumed. On 2026-10-05, `main`'s rules measured `["pull_request"]`, with no `merge_queue`.

Under `CCRC_SELECTION: enforce`, the PR's CI runs only the server tests the change selects, plus `agent`, `pwa` and `build-pwa` in full. It arbitrates that selection and nothing else.
- Re-run any other red in isolation and report it. The daily full run and the stable gate catch a selection miss.
- Never end a turn waiting on CI (worker clause 17).
- macOS legs (`test-macos`, `probe-macos`) gate nothing (operator, 2026-09-28). Report their job ids as found, or UNMEASURED, and never wait on one.

- [ ] **Step 7: Landing and deploy: the coordinator's, never the worker's**

The worker's part ends at Step 6. No session runs `ccrc rollout`, `ccrc update` without `--check`, or an update ack, before or after the merge. `~/.local/bin` is not on a fleet unit's PATH, so the coordinator invokes `~/.local/bin/ccrc`, `~/.local/bin/ccd` and `~/.local/bin/ccrc-api` by path.

**Before the merge (the coordinator, read-only; R47).**
1. Re-measure which marked children R40 moves, from the fleet box, read-only: Task 0c's "Before landing" re-measure (A0c, under its deploy class), done once, here. A0c carries the commands, the open-runs read among them, the classes, and the test by which a child is listed "would move". This step keeps no list of its own.
2. Read the review report's F6 measurement (A5). It is taken on the fleet box, the one box that runs ccd's reclaim; in remote mode the server box runs no ccd, so its half is out of scope, not UNMEASURED. A non-empty or UNMEASURED fleet-box answer stops the landing until the coordinator rules.
3. Write one ledger line before landing: the list from item 1; that R39 and R40 widen the destructive path when the server box converges, with no capability gate; F6's residual as measured; and the operator's stop, `reclaim-pause` on the Runs screen. Tell the operator, before landing, about every child the list marks "would move" other than `ccrc-pwa-brisk-meadow`.
4. Land at the measured head, per `wave-lifecycle.md` §5.

**After the merge (the coordinator observes, read-only).**
1. `release-main.yml` (`on: push: branches: [main]`, no paths filter) publishes the prerelease within about a minute.
2. The fleet's updater (channel dev, auto) moves the fleet box, then the server box. Nothing this wave changes runs on the fleet box, so the order costs nothing. The wave is live when the SERVER box converges.
3. The coordinator observes these, read-only, and records them in the ledger:
   - both boxes' versions, from `~/.local/bin/ccrc rollout --check --to <tag>`, which measures and touches nothing (`ccd/ccrc`'s `rollout` option parsing says so);
   - the fleet box's `~/.ccrc/update.json` phase, `GET /api/updates`, `/health`'s `version`, and the PWA's `BuildLine`;
   - that `~/.local/bin/ccd caps` on the fleet box still lists `reclaim-v1` and `reclaim-pause-v1`, since the lane needs both;
   - the first board load that carries chips;
   - the first sweep passes under R39 and R40. `ccrc-pwa-brisk-meadow` should leave the `coordinating` skip and be reclaimed through the ordinary path, which shows as a `child reclaimed` feed row. `expoAI-assistant-calm-mesa` still fails `pin-failed` until wave 6 lands or the operator acts (R38's residue).
4. A failed or reverted update row halts every move until the operator acks it from the Updates screen. The coordinator records it and never acks it. The operator's kill switch for the sweep stays `reclaim-pause`, on the Runs screen.

Promotion to `stable` is a separate operator act, not this wave's.

- [ ] **Step 8: Report**

Send the wave-done mail to the coordinator, per the `ccrc-worker` skill.

It opens with the two signal lines (clause 15):
- `suite:`, from Step 1's FIRST full run;
- `failure:`, only when a check failed.

Then comes the fingerprint, measured once and sent once (clause 9). Then:
- Step 1's shard lines, their sum against the `find` count, and the `agent` and `pwa` results;
- Step 2's `tsc`, build and cross-check results, the commit-message `D-` count of 0, and the added-token loop's output;
- Step 3's empty `ccd agent deploy` diff, the derived cited set, each file's highest anchor against this wave's hunks there, and the green `session-hook`;
- Task 1 Step 6's re-measured census numbers, or that the census was already green;
- the entry-condition outputs: (a) to (n), and every check the amendments add;
- the seeded counts and the stated bound from Task 0b's cases, with N and the seeds, and the (seed, N, mode) on which each of Task 0b's seeded-harness mutations went red;
- the PR URL, its required checks, and the macOS job ids as found, or UNMEASURED;
- the claims this wave took, every 409 and how it ended, and every merge of `origin/main` with the clause-16 trigger that licensed it;
- every departure from this plan, named by slug: never a number, never a `D-` token.

After the wave-done, stop pushing (clause 9). End the turn on the wave-done mail, which asks for the coordinator's answer (clause 17).

**Tests:** none committed by this task. Its checks are the commands above, each with its expected output.

**Deploy class:** server + pwa, through ccrc's own updater. This task ships nothing on its own.
