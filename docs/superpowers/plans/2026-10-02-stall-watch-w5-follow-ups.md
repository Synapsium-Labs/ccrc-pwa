# Stall watch wave 5: follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute, `superpowers:executing-plans`
> (or `superpowers:subagent-driven-development`) with `superpowers:test-driven-development` for every code step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the stall watch's per-candidate mail read off full-table scans with one `user_version` migration, fix the
behavioural and guard-level minors wave 2 parked (re-verified against the tree; the fixed ones are dropped), and close
the three follow-ups wave 3 reported (ledger R9) and its review's two missing pins and stale docstring (ledger R11).

**Architecture:** Part 1 is a migration in `server/src/coord/schema.ts` (three indexes) plus two meaning-preserving
reshapes of `CoordStore.stallMailFor`'s SQL that let the planner use them; every plan is pinned by an `EXPLAIN QUERY PLAN`
row against the store's own prepared SQL, and four other mail reads are pinned to keep their current index. Part 2 is
seven small tasks, each a measured red-first fix or a guard row with its mutation. Part 3 (Task 9) is wave 3's three
follow-ups (the re-activation keyed on the dispatch edge, the coordinator-ball push naming the clock it runs from, and
README's sentence for that push) and wave 3 review's two unpinned text sites (r2's subject span and `stallCitedCheck`,
both after a send-back); the review's stale `stallSilence` docstring is in Task 8.

**Tech Stack:** TypeScript on Node `>=22.13.0`, `node:sqlite` through `CoordStore` (SQLite 3.51 on the measuring box;
`MATERIALIZED` CTEs need 3.35+, which every supported Node bundles), Vitest (server).

**Spec:** `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` — §4.2 (r1's body, the proof-bound line),
§5.1 (the marker reader and the mail gate's busy modes), §10 (evaluation order). Part 1's source is the
wave-2 final review's finding OPS-4 (coordinator notes, not tracked); its text is restated under "The measurements".

**Programme:** `stall-watch`, wave 5 (ledger `docs/superpowers/programs/stall-watch.md`). Deploy class: server. One
PR from a fresh child workspace.

**Measured at:** first `a4bbddbcd` (its code tree is `origin/main` `0db987074`), 2026-10-02, on a `git archive` copy
with Tasks 1–8 applied in order; then REPLAYED on wave 3's tip `c8555f818` (PR #228) merged with `origin/main`
`cf9e4cc85` (which carries #222) and with #227's programme documents, where Task 9 was written red-first and every
count and mutation below was re-measured. Every `file:line` is a hint only: **find each anchor by its quoted text**. The
replay's one textual conflict was Task 8's two step comments beside the line wave 3 added (`const capKey = f.capKeyMs;`);
the find-and-replace texts below still occur once each on that tree.

## Preconditions (check before Task 1; stop and report if one fails)

1. **The tree contains BOTH #227 and #228, merged.** #227 is the programme's documents (the ledger and the wave 3 and 4
   plans, which define the deviation numbers wave 3's code cites); #228 is wave 3 (plan
   `docs/superpowers/plans/2026-10-02-stall-watch-reactivation-quiet.md`). Measure:
   `gh pr view 227 --json state --jq .state` and `gh pr view 228 --json state --jq .state` both print `MERGED`; then
   `git fetch origin main`, and `git grep -n "export function stallReactivation" origin/main -- server/src/coord/stall.ts`,
   `git ls-tree origin/main docs/superpowers/programs/stall-watch.md` and
   `git ls-tree origin/main docs/superpowers/plans/2026-10-02-stall-watch-w5-follow-ups.md` each print one line. The
   last is THIS plan: it alone defines D-3796, which Task 9 writes into tracked code, so without it on `main`
   `deviation-refs`' floor row reds after Task 9 (measured: "a tracked file names a global D-ref above the ledger
   high-water D-3795 (server/src/coord/stall.ts names D-3796)"); the coordinator lands it before dispatch. If either
   PR is not merged, or this plan is not on `main`, do not start.
   Task 8 renumbers comments wave 3 does not touch, but re-greps after it.
2. **Line numbers are re-measured** after merging `origin/main` into this workspace's branch. Every edit below quotes
   the text it replaces; an `assert`-style "exactly once" check (the runner's) is how a moved anchor is found.
3. **The migration slot is measured, not assumed** (Task 1, Step 1). At planning time `origin/main` carries 14 entries,
   so this one is written as slot 15; the open PR #215 (child reclamation wave 4) carries its own
   `user_version 14 -> 15`. Whichever merges second moves up.

## Out of scope

The spec's optional `RunHealth.stallNoticedAt` and run warning (§10 'Optional') are not taken: coordinator ruling R8 in the programme ledger (about half a day; the escalation's operator push already reports a stall).

## Global Constraints

- Rings (CLAUDE.md "Rings / bounded contexts"): `stall.ts` stays L1 (no clock, fs, store or node builtin; its one value
  import stays `../../../shared/api.js`, which `stall-vocabulary.test.ts` pins; Task 9 adds `RunState` to its existing
  type-only import). `watch.ts` is L4: it measures and
  passes, and decides nothing new (Task 2's prune applies L0's `TERMINAL_DELIVERY_STATES`, it does not define it).
  `store.ts` is L3.
- `coord.db` migrations are forward-only, each in its own transaction, and **refuse to start rather than open empty**
  (`server/src/coord/db.ts`, rules 1–3). `MIGRATIONS[0..13]` are frozen. Keep `CREATE INDEX IF NOT EXISTS`.
- Mutation-table discipline: every guard ships with a row measured red when it is deleted or mutated; the runner below
  restores each file byte for byte and asserts it. A pure comment fix needs no row.
- Tests run from `server/`, in the FOREGROUND, timeout at least 600000 ms:
  `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. A red in a known load flake
  (`session-hook`, `typecheck-tests`, `pr-sweep`, `ccd-ws-gc`, `ccd-session-state`, `ccd-bounded-reads`) is re-run in
  isolation before it is called a break.
- The README citation instrument stays `7 passed | 328 skipped`:
  `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.
  Measured: of the files this wave edits, the corpus (README and the two compaction-card documents) cites only
  `server/test/single-definition.test.ts` (`:32`, `:1274`, `:1303`); Tasks 5 and 6 edit it only below line 4050
  ("APPENDED after the last describe … nothing above this point may move"). Task 9 edits one README line in place
  (the line count does not move); measured on the replay: `7 passed | 328 skipped`.
- `single-definition`, `topology-clean`, `deviation-refs` (after `git fetch origin main`) and `dtbd` stay green.
- Deviation numbers: two, issued by the coordinator and written in under "Deviations found" (D-3794, Task 7's
  departure; D-3796, Task 9's). Never write a number that was not issued and never commit a placeholder (`dtbd.test.ts` reds one); name
  any further departure in the wave-done mail by slug, and the coordinator assigns its number.
- Fixture HOMEs and fixture `coord.db` files only. Nothing reads or writes a live registry or a live `coord.db`.
- Public repo: fixtures use `demo-*` ids; no account label, host name, session id or docserver URL anywhere.
- Commit on this workspace's own branch only. Merge `origin/main` before handoff; never rebase.
- Out of scope: arming any marker, deploying, the skills (wave 4), the spec's text.

## Review Focus

1. **A rollback onto the previous build after this migration ran** (`user_version` 15 against a build that knows 14).
   `db.ts` rule 3 reads it as-is; the new indexes then re-plan the OLD build's queries. Measured with today's SQL against
   the migrated schema: today's `stallMailFor` statement 2 moves from scans to index searches, statement 1 is unchanged,
   and the four delivery reads pinned in Task 1 keep `mail_deliveries_due` (they are the same SQL in both builds). No
   test executes the old build; this is a measured claim, recorded so the reviewer can re-measure it.
2. **A mail exactly at the horizon that reaches the session only through its delivery row** (addressed to the
   coordinator role). The bounded subquery must keep it, and drop its twin a millisecond older. Pinned by Task 1's
   reference row, whose fixture writes both out explicitly (the 80 drawn mails cover the rest) and asserts each, and
   which is red under `at >= ?` → `at > ?` in the bound (T1-M8).
3. **Two branches holding one migration slot.** Task 1 Step 1 and the handoff gate re-measure against `origin/main` and
   the open PRs; `coord-db.test.ts`'s banner-sequence row reds a textual double slot left in this tree.
4. **A shadow-logged delivery acked while backed off past a sweep.** It must be forgotten, not kept forever. Pinned by
   the existing row "the once-only memory forgets a delivery that left the outstanding set", measured red when Task 2's
   terminal check is removed (T2-M2).

---

## The measurements this plan rests on

### OPS-4, restated

`CoordStore.stallMailFor` (`server/src/coord/store.ts`) runs once per stall candidate per sweep (a worker with its runs;
a coordinator, and an orphan-D registry row, with none), and `hasMailWithSubject` once per queued run-less notice. Both
run on the server's one synchronous `DatabaseSync`. `mail` is never pruned and `mail_deliveries` stores each envelope
inline. The review measured 3.66 ms per candidate at 5 000 mails and 21.69 ms at 20 000, and proposed indexes on
`mail_deliveries(mailId)` and `mail_deliveries(toId)`, plus `mail(at)` "if the horizon becomes selective".

### EXPLAIN QUERY PLAN, before and after (fresh fixture database, no ANALYZE: the server never runs one)

| Statement | Before (`a4bbddbcd`) | After (this plan) |
|---|---|---|
| `stallMailFor` stmt 1, worker (runs bound) | `SCAN mail \| LIST SUBQUERY 1 \| SCAN mail_deliveries` | `MATERIALIZE sel \| MULTI-INDEX OR \| SEARCH mail USING INDEX mail_by_run (runId=?) \| … SEARCH mail_deliveries USING INDEX mail_deliveries_by_mail (mailId=?) \| SEARCH mail USING COVERING INDEX mail_by_at (at>?) \| SEARCH mail USING INDEX mail_by_at (at>?) \| SCAN sel \| USE TEMP B-TREE FOR ORDER BY` |
| `stallMailFor` stmt 2, worker | `SCAN mail_deliveries \| LIST SUBQUERY 2 \| SCAN mail \| LIST SUBQUERY 1 \| SCAN mail_deliveries` | `SEARCH mail_deliveries USING INDEX mail_deliveries_by_mail (mailId=?) \| … MULTI-INDEX OR (mail_by_run, mail_by_at) …` |
| `stallMailFor` stmt 1, no runs (coordinator, registry row) | `SCAN mail \| LIST SUBQUERY 1 \| SCAN mail_deliveries` | `MATERIALIZE sel \| SEARCH mail USING INDEX mail_by_at (at>?) \| … SEARCH mail_deliveries USING INDEX mail_deliveries_by_mail (mailId=?) …` |
| `stallMailFor` stmt 2, no runs | `SCAN mail_deliveries \| … SCAN mail \| … SCAN mail_deliveries` | `SEARCH mail_deliveries USING INDEX mail_deliveries_by_mail (mailId=?) \| … SEARCH mail USING INDEX mail_by_at (at>?) …` |
| `hasMailWithSubject` | `SCAN mail` | `SEARCH mail USING INDEX mail_by_run (runId=?)` |

Measured cost on a 20 000-mail fixture (2 KiB body and envelope, one delivery each, load average 25–110, minimum of 20–30
runs): before, 45–100 ms per statement (two statements per candidate); after, 4–8 ms per statement. `hasMailWithSubject`:
21–31 ms before, about 11 ms after. Building the three indexes over that fixture inside the migration's transaction: 149 ms.

### Why not the review's index set (the decisions this plan makes against its brief)

The brief asked for `mail_deliveries(mailId)` and `mail_deliveries(toId)`, and `mail(at)` if EXPLAIN shows it selective.
Every statement the store prepares on `mail`/`mail_deliveries` was captured from eight store-level suites (93 distinct
statements) and EXPLAINed under each candidate index set:

- **`mail_deliveries(toId)` re-plans eighteen of the 93 captured statements onto itself, three reads measurably
  worse.** Without ANALYZE the planner rates `toId = ?` above `state IN ('queued','delivered')`, so
  `hasOutstandingPeerDuplicate`, `outstandingPeerCount`, `outstandingMailFor`, `mailForRecipient`, the repoint, reclaim
  and rebind updates and the kickoff and park reads leave `mail_deliveries_due` (or a scan) for it. On
  the fixture with the busiest recipient holding half the deliveries: the peer-duplicate and peer-quota probes went from
  0.01 ms to 14 ms, `outstandingMailFor` from 0.7 ms to 33 ms. A composite `(toId, state)` fixed the probes but not
  `outstandingMailFor`, and re-planned `mailForRecipient` onto a sort. So **no index led by `toId`**; the read's
  delivered-to subquery is bounded through the horizon instead (below), and Task 1 pins the four reads to
  `mail_deliveries_due` (red when a `toId` index is added, T1-M4).
- **`mail(at)` alone is chosen in one of four statement shapes** (statement 2 with no runs): the planner keeps a rowid
  scan for statement 1's `ORDER BY id`, and statement 1's `runId IN (…) OR …` has no index for its run arm. So this plan
  adds `mail(at)` WITH `mail(runId)`, and materialises statement 1 before its sort, which together put every shape on
  indexes.
- **The re-plans the chosen set (`mail(runId)`, `mail(at)`, `mail_deliveries(mailId)`) causes elsewhere**, from the same
  census: 25 of 93 statements change plan. Every one moves a scan to a search or a search to a narrower search, except
  two. `mailForProgram(…, { all: true })`: on a programme holding 95% of the 20 000 mails it goes from 0.12 ms (a
  backwards rowid scan that stops at its LIMIT) to 4.2 ms (all the programme's rows, then a sort); it is an
  operator-opened list, not a lane. `unreadMailCount` (per hydrated run) goes from 0.01 ms to 0.04 ms. Both are
  accepted. `dueDeliveries` (the 10 s mail lane) is unchanged.

### The two reshapes of `stallMailFor`, and why neither changes an answer

1. **The delivered-to arm is bounded by the horizon.** `id IN (SELECT mailId FROM mail_deliveries WHERE toId = ?)` becomes
   `id IN (SELECT mailId FROM mail_deliveries WHERE toId = ? AND mailId IN (SELECT id FROM mail WHERE at >= ?))`. The arm
   is already ANDed with the outer row's `at >= sinceAt`, and the outer row IS the mail the delivery names, so a delivery
   whose mail is older than the horizon could never select its row. Same rows, a bounded walk.
2. **Statement 1 is `WITH sel AS MATERIALIZED (…) SELECT … FROM sel ORDER BY id`.** Without the fence the planner
   prefers a full rowid-order scan of `mail` to an index read plus a sort (the `lifecycle_by_at` precedent, schema.ts,
   measured the same planner habit). The output order is unchanged (`ORDER BY id`), so ALL-OR-FAILURE's first failing
   row is the same row.

Task 1's reference row compares the read with a JavaScript reference over the raw tables on a fixed 80-mail fixture
that draws every sender and recipient, plus the horizon edge written out (a coordinator-role mail at, and a
millisecond before, `sinceAt`), for three sessions and three run sets.

## The minors: what this wave fixes, and what it drops

Sources: the wave-2 coordinator notes (`final-ledger-items.md`, its 46 lines tagged "minor (", and the final-fix
rulings' "Deferred" section; both untracked). Each item was re-verified against `a4bbddbcd`.

### Kept (each is a task below)

| # | Item | Why it is kept | Task |
|---|---|---|---|
| K1 | `busyShadowLogged`'s prune evicts a held-but-outstanding delivery (backed off past a sweep), so it is logged a second time on return; its docstring says "outstanding" | Behaviour: a duplicate line in the operator's 48 h busy-shadow check. Measured red-first | 2 |
| K2 | `foldHookStateRead`'s ternary would fold a future fourth raw reason to `NO_STATE` with no word at the fold | Guard: the decision becomes a total `Record`, so the fold's own line is the compile error (measured: today the only error is `watch.ts`'s `stallHookFactOf`, whose fix would widen the union and leave the fold silent) | 4 |
| K3 | `stallMailFor` answers `mail-unreadable` for a `mail_deliveries` column failure, though `STALL_READ_FAILURES` has `delivery-unreadable` | Guard/behaviour: an adapter narrowing a distinction it received (CLAUDE.md); the lane's warn line names the wrong table | 3 |
| K4 | The D-2545 `it.each` pins 4 of the read's proven columns; `mail id`, `delivery id` and `delivery ackedAt` have no row | Guard rows: each guard measured red on deletion (T3-M1..M3). `delivery mailId` is argued unreachable in Task 3 | 3 |
| K5 | `8.64e15` spelled twice (`turnmark.ts`, `stall.ts`'s `stallIso`) | Single source of truth: the reader's bound is the formatter's guarantee only while they are one number; pinned by a single-definition row | 5 |
| K6 | The busy modes' `live !== null` conjunct on the marker read has no row | Guard: a read budget with no pin; counting-io row, red on removal | 6 |
| K7 | The orphan pass's `ident === null` return has no row (review T15-TL-13 "M") | Guard: without it the pass throws on the row (caught, warned) instead of returning; red on removal | 6 |
| K8 | `single-definition`'s wave-2 marker CONTROL asserts `'stall-watch-w2-live'.includes('stall-watch-live')` — a literal against a literal, which can never fail | Guard: re-derived from the shipped marker names, so a renamed marker that holds another reds it | 6 |
| K9 | r1's proof-bound line ("told when your next turn ends without one") is looser than `stallProofDue` (a turn that ends with a subagent or workflow still running is not proof (a)) | Behaviour: worker-facing text that states a trigger that does not fire. The spec's own example sentence, so a departure (D-3794) | 7 |
| K10 | Step numbers in `stall.ts`'s comments and four test titles run one ahead of spec §10 from the ask holds on (the code splits the live read into its own step), and `stallLimited` cites "§10 step (6)" | Comments that state something false about the spec | 8 |
| K11 | `stallMailClass`'s comment says self-wake is "tested after check and report, so a report naming a failure stays a report", and a test title repeats it | A comment naming a mechanism that does not exist (no class prefix starts another; order decides nothing). The comment is corrected and the real mechanism gets a derived row | 8 |

### Dropped (35 ledger lines, by reason)

- **Verified fixed by the wave-2 final fix wave or its amendments (11):** `session-hook.sh:2` header; `ccd/ccd`'s
  `livestate.ts` anchor; the `MALFORMED` docstring; `hookstate.test.ts`'s plan-step narration (removed in `3d9c23b20`);
  the stale gate comments above the mail gate; `stallCheckMail`'s slug-only citation; the failed-repeat "told to retry"
  sentence (TRI-6, NB3); `stall-store.test.ts`'s `deliveryTimesFor` comment; `rundefs.ts`'s notice comments; README's
  four runbook claims; the turnmark test header (Part A landed, so it is true now). Also the review's T15-TL-13 "D/E"
  (latch and warn-once prunes): pinned since by two `stall-sweep` rows, measured red when either prune is removed.
- **Style or prose with no false claim (8):** duplicated hook fixture (moving it would move cited lines); the reducer's
  123-character line; the two loose prose clauses in `session-hook`'s ratio row (two lines); line-neutral long lines;
  revive helpers running for foreign files (output identical); "eleven describes" (brief prose, not in the tree);
  mid-file `stall.js` imports.
- **By design, or already ruled (5):** the hook-capture 200-file cap's overshoot (no lock, by contract; scratch lane);
  the payload parse's tolerance of trailing garbage (superseded by OPS-2's regex-free parse; one well-formed object);
  the streak counting a working reply on a sibling run (the operator's I2 ruling); wave-1 report titles through
  `stallSafe` (recorded departure `w2-planned-changes-ship-live`); the run-less failed arm windowing on the self-mail's send time
  while the run-bound arm keys on the failure (documented in `stallPriorFailure`'s docstring; the only exact key is the
  minute inside the subject, and parsing it is new fragility for a skew of one send delay, at least `FAILED_IDLE_MS`).
- **Unreachable or harmless (5):** `failed` rung 2 (and six other sites) reading a blank `claimedBy` as a claimant
  (both writers of `runs.claimedBy`, the open-run and reclaim routes, refuse a blank; only `stallCoordinatorSubjects`
  guards it, harmlessly); `stallBackoff`'s `!isWatchNotice` conjunct (unreachable: `own` is the worker's mail);
  `stallDeadWords`' unreachable `no-hook-event` arms and "the run has no coordinator" for a worker with no run (the
  lane always passes the run); `turnidle.test.ts`'s runtime tautology (`typecheck-tests` is its pin); the reducer's
  unbounded `ERROR_KEY` (letters only, never an identifier).
- **Coverage with no unpinned guard (6):** `install-session-hooks`' derivation floor `>= 10` (the equality row beside it
  is the guard); no opposite-order refusal row (one shared loop); no hook→reader round trip for the restart and failed
  arms (reader bounds are pinned); shadow accounting pinned through orphan D only (one shared helper); the lane's push
  `kind` (decided and pinned in L1's `stallPushRoute`; the lane passes it through); the shuffled-order back-off row
  (the sort is pinned: removing it reds two other rows, measured).
- **Partially kept (3 lines):** of the T15-TL-13 list, "M" is K7; "L/L2" (the coordinator's and orphan's warn-line
  wording) is log text with the hold itself pinned; "H" is the push kind above. Of Task 10's list, the ordering claim
  is K11; the rest (a vacuous runtime assertion with a `typecheck-tests` pin, a dead `?? {}`, plan task numbers in
  docstrings, a second import) is style. Of Task 18's line, the literal control is K8; the duplicate `esc`/`spelling`
  helpers are style.
- **Not a ledger line, recorded for completeness:** the failed window counting only rung-1 notices (Minor 4a, ruled
  and recorded as `failed-repeat-counts-rung-one-notices`).

---

## File Structure

- `server/src/coord/schema.ts` — one new `MIGRATIONS` entry (three indexes) and its comment.
- `server/src/coord/store.ts` — `stallMailFor`'s two reshapes and its failure kinds (Tasks 1, 3); two comments the
  new indexes make false (Task 1).
- `server/src/watch.ts` — the busy-shadow prune (Task 2).
- `server/src/hookstate.ts` — `RAW_FAILURE_FOLD` (Task 4).
- `server/src/coord/stall.ts` — `STALL_EPOCH_MAX` (Task 5), the proof-bound line (Task 7), comment numbering and one
  comment and `stallSilence`'s docstring (Task 8), `stallReactivation`'s edge rule, `stallCoordBallFrom` and the
  coord-ball push text (Task 9).
- `README.md` — the coordinator-ball push sentence, one line in place (Task 9).
- `server/src/turnmark.ts` — imports `STALL_EPOCH_MAX` (Task 5).
- Tests: `server/test/coord-db.test.ts`, `asks-store.test.ts`, `stall-store.test.ts`, `coord-store.test.ts` (a comment),
  `mail-sweep.test.ts`, `stall-sweep.test.ts`, `single-definition.test.ts`, `stall-bodies.test.ts`,
  `stall-verdict.test.ts`, `stall-backoff.test.ts`, `stall-vocabulary.test.ts`, `readme-holds.test.ts`.
- `.superpowers/sdd/2026-10-02-stall-watch-w5-follow-ups/mutate.py` — the mutation runner (gitignored; never committed).

## Baseline (wave 3's tip `c8555f818`, from its wave-done report and re-run where wave 5 touches the suite)

| Suite | Before wave 5 | After wave 5 (measured on the replay) |
|---|---|---|
| `server` `coord-db` | 58 passed | 63 (+5, Task 1) |
| `server` `asks-store` | 28 passed | 28 |
| `server` `stall-store` | 53 passed | 65 (+9 Task 1, +3 Task 3) |
| `server` `mail-sweep` | 102 passed | 104 (+1 Task 2, +1 Task 6) |
| `server` `stall-sweep` | 101 passed | 103 (+1 Task 6, +1 Task 9) |
| `server` `single-definition` | 259 passed | 261 (+2 Task 5) |
| `server` `stall-vocabulary` | 178 passed | 179 (+1 Task 8) |
| `server` `stall-verdict` | 277 passed | 279 (+2 Task 9) |
| `server` `stall-bodies` | 155 passed | 159 (+4 Task 9) |
| `server` `readme-holds` | 16 passed | 17 (+1 Task 9) |
| `server` `stall-session`, `stall-backoff` | 89, 17 passed | 89, 17 |
| `server` `hookstate`, `turnmark` | 54, 32 passed | 54, 32 |
| `server` `coord-store`, `coord-health` | 170, 23 passed | 170, 23 |
| citation instrument | 7 passed, 328 skipped | unchanged |

Every red, green and mutation count below was measured by applying this plan's exact text to the replay tree described under "Measured at".

---

### Task 1: The stall mail read plans on indexes (migration and read)

**Files:**
- Modify: `server/src/coord/schema.ts` (append one entry to `MIGRATIONS`, after the update-control-plane entry's
  closing `` `, ``; `COORD_SCHEMA_VERSION` derives itself)
- Modify: `server/src/coord/store.ts` (`stallMailFor`'s `where`, `binds` and statement 1; its docstring; the
  `parkSupersededDeliveries`-area docstring that says "the one index is `mail_deliveries_due`")
- Modify: `server/test/coord-db.test.ts` (the index-set pin, two version pins and their comments; one appended describe)
- Modify: `server/test/asks-store.test.ts` (one version pin and its comment)
- Modify: `server/test/coord-store.test.ts` (one comment)
- Test: `server/test/stall-store.test.ts` (one appended describe)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: indexes `mail_by_run ON mail(runId)`, `mail_by_at ON mail(at)`, `mail_deliveries_by_mail ON
  mail_deliveries(mailId)`; `stallMailFor`'s signature unchanged (Task 3 widens its failure kind).

- [ ] **Step 1: Measure the migration slot.**

```bash
git fetch origin main
git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
for b in $(gh pr list --state open --json headRefName --jq '.[].headRefName'); do
  git fetch -q origin "$b" 2>/dev/null || continue
  n=$(git show "origin/$b:server/src/coord/schema.ts" 2>/dev/null | grep -c '^  // ── [0-9]*: user_version')
  echo "$b $n"
done
```

Let `N` be the first number. This entry is slot `S = N + 1` (`user_version N -> S`). At planning time `N = 14`, so
`S = 15`, and the branch of PR #215 printed 15. Everything below is written for `S = 15`; if you measure another
`S`, change every slot-dependent spelling below, and record the measurement in your wave-done mail. The new tests find
the entry by its DDL and never hard-code the slot, so they need no change.

| File | Spelling at `S = 15` | At slot `S` |
|---|---|---|
| `schema.ts`, the entry's banner | `15: user_version 14 -> 15` | `S: user_version S-1 -> S` |
| `schema.ts`, the entry's comment | `MIGRATIONS[0..13] are frozen` | `MIGRATIONS[0..S-2] are frozen` |
| `schema.ts`, the entry's comment | `THIS ENTRY IS SLOT 15 AS WRITTEN` | `THIS ENTRY IS SLOT S AS WRITTEN` |
| `schema.ts`, the entry's comment | ``an open branch held `user_version 14 -> 15` too`` | name the branch that took slot `S-1` first, as entry 12's comment does |
| `coord-db.test.ts`, the version row | title `derives to 15`; `toBe(15)` twice; comment `and MIGRATIONS[14] (the stall mail read's indexes …)` | `derives to S`; `toBe(S)`; `MIGRATIONS[S-1]` |
| `coord-db.test.ts`, the migration-11 row | `toBe(15)`; comment `15 since MIGRATIONS[14] (the stall read's indexes)` | `toBe(S)`; `S since MIGRATIONS[S-1]` |
| `asks-store.test.ts` | `toBe(15)`; comment `FIVE migrations`, `any of the five`, `MIGRATIONS[14] (the stall mail read's indexes)` | `toBe(S)`; the count word for `S-10`; `MIGRATIONS[S-1]` |

If #215 merged first (`S = 16`), it has already rewritten the three test comments and pins to 15: its version row reads
`Bumped to 15 by five migrations` and ends `and MIGRATIONS[14] (runs.sessionBornAt / runs.sessionBornFor —
child-reclamation spec §5.1, §5.3).`, its migration-11 comment reads `15 since MIGRATIONS[13] (…) and MIGRATIONS[14]
(runs.sessionBornAt/ sessionBornFor, …)`, and asks-store reads `FIVE migrations` / `any of the five`. Step 6's find
texts are then those: `derives to 15` → `derives to 16`, `Bumped to 15 by five` → `Bumped to 16 by six`, every
`toBe(15)` → `toBe(16)`, `FIVE` → `SIX`, `any of the five` → `any of the six`, and each comment gains
`MIGRATIONS[15] (the stall mail read's indexes, worker stall watch wave 5)` after #215's `MIGRATIONS[14]` clause.

- [ ] **Step 2: Write the failing rows.** Append to the END of `server/test/coord-db.test.ts`:

```ts

describe('coord.db: the stall mail read\'s indexes (worker stall watch wave 5)', () => {
  // `CoordStore.stallMailFor` runs once per stall candidate per sweep, synchronously on the server's one handle.
  // Before this entry both of its statements, and `hasMailWithSubject`, planned `SCAN mail`, and both statements
  // `SCAN mail_deliveries`; `stall-store.test.ts`'s plan rows pin what the read plans now.
  const INDEXES = ['mail_by_at', 'mail_by_run', 'mail_deliveries_by_mail'];
  /** This entry's slot, found by its DDL and never hard-coded: schema.ts's rule is that whichever of two branches
   *  holding one slot merges second moves up, and that renumber must not have to edit a line here. */
  const SLOT = MIGRATIONS.findIndex((m) => m.includes('mail_deliveries_by_mail')) + 1;
  const indexNames = (db: DatabaseSync): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as
      { name: string }[]).map((r) => r.name);
  /** A database at exactly the version before this entry, carrying one mail and its delivery. */
  const plantedBefore = (prefix: string, extra = ''): string => {
    const p = dbPathIn(mkTmp(prefix));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) " +
               "VALUES (5, 'demo-a', 'u', 'demo-b', NULL, 'status', 's', 'x')");
      raw.exec("INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (1, 'demo-b', 'acked', 'e')");
      if (extra !== '') raw.exec(extra);
    });
    raw.close();
    return p;
  };

  it('is its own entry, after every entry main carried when it was written', () => {
    expect(SLOT, 'no MIGRATIONS entry creates mail_deliveries_by_mail').toBeGreaterThanOrEqual(15);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => INDEXES.some((n) => m.includes(n))),
      'an index of this entry was amended into a frozen one').toBe(false);
  });

  it('reaches a database ALREADY at the version before it, keeps its rows, and adds exactly its three indexes', () => {
    const p = plantedBefore('ccrc-mig-stallidx-');
    const before = new DatabaseSync(p);
    const had = indexNames(before);
    before.close();
    expect(had.filter((n) => INDEXES.includes(n)), 'the plant already has one').toEqual([]);
    const db = openCoordDb(p);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(indexNames(db).filter((n) => !had.includes(n)).sort()).toEqual(INDEXES);
    expect(db.prepare('SELECT count(*) AS c FROM mail').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT count(*) AS c FROM mail_deliveries').get()).toEqual({ c: 1 });
    db.close();
  });

  it('a FRESH database reaches the same three', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-stallidx-fresh-')));
    expect(indexNames(db)).toEqual(expect.arrayContaining(INDEXES));
    db.close();
  });

  it('IF NOT EXISTS: an index already made under one of its names does not refuse the start', () => {
    const p = plantedBefore('ccrc-mig-stallidx-pre-', 'CREATE INDEX mail_by_at ON mail(at)');
    expect(() => openCoordDb(p).close()).not.toThrow();
  });

  it('indexes the columns the read filters on, and no other (mail_deliveries.toId is deliberately absent)', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-stallidx-cols-')));
    const cols = (name: string): string[] =>
      (db.prepare(`PRAGMA index_info(${name})`).all() as { name: string }[]).map((r) => r.name);
    expect(INDEXES.map((n) => [n, cols(n)])).toEqual([
      ['mail_by_at', ['at']], ['mail_by_run', ['runId']], ['mail_deliveries_by_mail', ['mailId']],
    ]);
    db.close();
  });
});
```

Append to the END of `server/test/stall-store.test.ts`:

```ts

describe('stallMailFor: planned on indexes, and no other mail read re-planned (wave 5)', () => {
  /** Every statement `fn` prepares, in order, as it prepared it. */
  const preparedBy = (s: CoordStore, fn: () => unknown): string[] => {
    const spy = vi.spyOn(s.db, 'prepare');
    try { fn(); return spy.mock.calls.map((c) => String(c[0])); } finally { spy.mockRestore(); }
  };
  /** EXPLAIN QUERY PLAN's detail lines, joined. The server never runs ANALYZE, so this is the plan it runs. */
  const planOf = (s: CoordStore, sql: string): string =>
    (s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
  const SCAN = /\bSCAN (mail|mail_deliveries)\b/;

  it('CONTROL: the scan pattern sees a table scan and a covering-index scan, and not a SEARCH or a CTE scan', () => {
    expect(SCAN.test('SCAN mail | LIST SUBQUERY 1')).toBe(true);
    expect(SCAN.test('SCAN mail_deliveries USING COVERING INDEX mail_deliveries_due')).toBe(true);
    expect(SCAN.test('SEARCH mail USING INDEX mail_by_at (at>?)')).toBe(false);
    expect(SCAN.test('SCAN sel')).toBe(false);
  });

  it.each([
    ['a run worker (its runs bound)', true],
    ['a coordinator or a registry row (no runs)', false],
  ] as const)('%s: both statements SEARCH, and neither scans mail or mail_deliveries', (_name, withRun) => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    // One selected mail, so the delivery statement is prepared too.
    s.queueDelivery(mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status',
      subject: 'progress', at: S4_STATUS_AT }), 'demo-coordinator', '');
    const sql = preparedBy(s, () => s.stallMailFor('demo-worker', withRun ? [run] : [], W2_SINCE_AT));
    expect(sql).toHaveLength(2);
    for (const q of sql) expect(planOf(s, q), q).not.toMatch(SCAN);
  });

  it('hasMailWithSubject reads mail through an index', () => {
    const s = store();
    const [q] = preparedBy(s, () => s.hasMailWithSubject('operator', null, 'demo-worker', 'x'));
    expect(planOf(s, q!)).not.toMatch(SCAN);
  });

  it.each([
    ['hasOutstandingPeerDuplicate', (s: CoordStore) => s.hasOutstandingPeerDuplicate('demo-a', 'demo-b', 'x')],
    ['outstandingPeerCount', (s: CoordStore) => s.outstandingPeerCount('demo-a', 'demo-b')],
    ['outstandingMailFor', (s: CoordStore) => s.outstandingMailFor('demo-b')],
    ['dueDeliveries', (s: CoordStore) => s.dueDeliveries(1, 1)],
  ] as const)('%s still reads its deliveries through mail_deliveries_due (an index led by toId would take it)', (_name, fn) => {
    const s = store();
    const sql = preparedBy(s, () => fn(s));
    expect(sql.length).toBeGreaterThan(0);
    for (const q of sql) expect(planOf(s, q), q).toContain('mail_deliveries_due');
  });

  it('selects exactly the rows its predicate names, against a reference over the raw tables', () => {
    const s = store();
    const runA = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const runB = seedRun(s, { sessionId: 'demo-other', wave: 6, reach: 'working', at: DISPATCHED_AT });
    const who = ['demo-worker', 'demo-other', 'demo-peer', 'operator', 'coordinator'] as const;
    const ats = [W2_SINCE_AT - W2_HOUR, W2_SINCE_AT - 1, W2_SINCE_AT, W2_SINCE_AT + 1, S4_STATUS_AT] as const;
    // A fixed 32-bit LCG, so the fixture is the same on every run and every box. `Math.imul` and `>>> 0` keep every
    // step exact (a plain `*` passes 2^53 and loses the low bits), and `% n` reads the high bits, never the low ones.
    let seed = 7;
    const pick = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % n; };
    for (let i = 0; i < 80; i++) {
      const id = mailAt(s, { fromId: who[pick(4)]!, toId: who[1 + pick(4)]!, runId: [runA, runB, null][pick(3)]!,
        kind: 'status', subject: `m${i}`, at: ats[pick(ats.length)]! });
      for (let k = pick(3); k > 0; k--) s.queueDelivery(id, who[pick(3)]!, '');
    }
    // The bounded subquery's edge, written out rather than left to the draws: mail to the coordinator ROLE that
    // reaches demo-peer only through its delivery row, once exactly AT the horizon (selected) and once a
    // millisecond before it (not selected).
    for (const at of [W2_SINCE_AT, W2_SINCE_AT - 1]) {
      s.queueDelivery(mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: null, kind: 'question',
        subject: `role mail at ${at}`, at }), 'demo-peer', '');
    }
    const mail = s.db.prepare('SELECT id, at, runId, fromId, toId FROM mail ORDER BY id').all() as
      { id: number; at: number; runId: number | null; fromId: string; toId: string }[];
    const dels = s.db.prepare('SELECT id, mailId, toId FROM mail_deliveries ORDER BY id').all() as
      { id: number; mailId: number; toId: string }[];
    let compared = 0;
    for (const sid of ['demo-worker', 'demo-other', 'demo-peer']) {
      for (const runIds of [[], [runA], [runA, runB]]) {
        const want = mail.filter((m) => (m.runId !== null && runIds.includes(m.runId))
          || ((m.fromId === sid || m.toId === sid || dels.some((d) => d.mailId === m.id && d.toId === sid))
              && m.at >= W2_SINCE_AT)).map((m) => m.id);
        const got = s.stallMailFor(sid, runIds, W2_SINCE_AT);
        expect(got.ok && got.mail.map((m) => m.id), `${sid} on [${runIds.join(',')}]`).toEqual(want);
        expect(got.ok && got.deliveries.map((d) => d.id), `${sid} on [${runIds.join(',')}]`)
          .toEqual(dels.filter((d) => want.includes(d.mailId)).map((d) => d.id));
        compared += want.length;
      }
    }
    // Non-vacuity: the draws spread over every sender and recipient, and the reference compared well over 100 rows.
    expect(new Set(mail.map((m) => m.fromId)).size).toBe(4);
    expect(new Set(mail.map((m) => m.toId)).size).toBe(4);
    expect(compared).toBeGreaterThan(100);
    // The horizon edge: a coordinator-role mail at exactly `sinceAt` reaches demo-peer through its delivery row alone,
    // and is selected; its twin a millisecond older is not.
    const roleAt = (at: number): number => mail.find((m) => m.toId === 'coordinator' && m.fromId === 'demo-other'
      && m.at === at && dels.some((d) => d.mailId === m.id && d.toId === 'demo-peer'))!.id;
    const peer = s.stallMailFor('demo-peer', [], W2_SINCE_AT);
    expect(peer.ok && peer.mail.map((m) => m.id)).toContain(roleAt(W2_SINCE_AT));
    expect(peer.ok && peer.mail.map((m) => m.id)).not.toContain(roleAt(W2_SINCE_AT - 1));
  });
});
```

- [ ] **Step 3: Run them; confirm the right reds.**

Run (from `server/`): `./node_modules/.bin/vitest run test/coord-db.test.ts test/stall-store.test.ts`
Expected: 8 failed. The five `coord.db: the stall mail read's indexes` rows, the two `both statements SEARCH` rows and
`hasMailWithSubject reads mail through an index`. Green before and after, by design: the CONTROL, the four
`mail_deliveries_due` rows (they pin that nothing re-plans them) and the reference row (it pins that the reshape changes
no answer).

- [ ] **Step 4: Add the migration.** In `server/src/coord/schema.ts`, the `MIGRATIONS` array ends with the update control
plane entry, whose last lines are:

```ts
  INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);
  `,
];
```

Replace them with:

```ts
  INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);
  `,

  // ── 15: user_version 14 -> 15 ───────────────────────────────────────────
  // Indexes for the stall watch's per-candidate mail read, `CoordStore.stallMailFor` (worker stall watch wave 5).
  // That read runs once per stall candidate per sweep on the server's one synchronous handle, and before this entry
  // both of its statements planned `SCAN mail` and `SCAN mail_deliveries` (EXPLAIN QUERY PLAN, measured), so every
  // sweep's cost grew with the whole mail history, which is never pruned.
  //
  // THREE INDEXES, AND `mail_deliveries(toId)` IS NOT ONE OF THEM. The review that found the scan proposed
  // `mail_deliveries(mailId)` and `mail_deliveries(toId)`. Measured: an index led by `toId` takes over every
  // delivery read that filters `toId = ? AND state IN ('queued','delivered')`, because this server never runs
  // ANALYZE and the planner rates one equality above a two-value IN. On a 20 000-mail fixture whose busiest
  // recipient held half the deliveries, the peer-duplicate and peer-quota probes went from about 0.01 ms to about
  // 14 ms and `outstandingMailFor` from about 0.7 ms to about 33 ms. The read's delivered-to arm is bounded through
  // `mail_by_at` instead (`store.ts`, `stallMailFor`), so it needs no `toId` index. `stall-store.test.ts`'s plan rows
  // pin that those reads still use `mail_deliveries_due`.
  //
  // `mail_by_run` serves the read's run clause (and `hasMailWithSubject`, every per-run mail statement, and the
  // health read's join); `mail_by_at` its horizon; `mail_deliveries_by_mail` its delivery statement. `mail` is
  // append-only and `mail_deliveries.mailId` is never rewritten, so the write cost is one b-tree insert per row.
  // `IF NOT EXISTS`, so a database where an operator made one of these by hand still starts.
  //
  // MIGRATIONS[0..13] are frozen: `db.ts` iterates from the live `user_version`, so an edit to an applied entry
  // never runs. THIS ENTRY IS SLOT 15 AS WRITTEN, measured against origin/main at the wave's first step; an open
  // branch held `user_version 14 -> 15` too, and whichever merges second moves up (entry 12 records the last branch
  // that lost this race). RE-MEASURE immediately before the PR and before merge:
  //     git fetch origin main
  //     git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
  `
  CREATE INDEX IF NOT EXISTS mail_by_run ON mail(runId);
  CREATE INDEX IF NOT EXISTS mail_by_at ON mail(at);
  CREATE INDEX IF NOT EXISTS mail_deliveries_by_mail ON mail_deliveries(mailId);
  `,
];
```

- [ ] **Step 5: Reshape the read.** In `server/src/coord/store.ts`, `stallMailFor`, replace:

```ts
    const where = `${onRuns}((fromId = ? OR toId = ? OR id IN (SELECT mailId FROM mail_deliveries WHERE toId = ?)) AND at >= ?)`;
    const binds = [...runIds, sessionId, sessionId, sessionId, sinceAt];
    const rows = this.db.prepare(
      'SELECT CAST(id AS TEXT) AS idText, CAST(at AS TEXT) AS atText, CAST(runId AS TEXT) AS runIdText, ' +
      `fromId, toId, kind, subject FROM mail WHERE ${where} ORDER BY id`,
    ).all(...binds) as unknown as
```

with:

```ts
    const where = `${onRuns}((fromId = ? OR toId = ? OR id IN (SELECT mailId FROM mail_deliveries WHERE toId = ? ` +
      'AND mailId IN (SELECT id FROM mail WHERE at >= ?))) AND at >= ?)';
    const binds = [...runIds, sessionId, sessionId, sessionId, sinceAt, sinceAt];
    const rows = this.db.prepare(
      'WITH sel AS MATERIALIZED (SELECT id, CAST(id AS TEXT) AS idText, CAST(at AS TEXT) AS atText, ' +
      `CAST(runId AS TEXT) AS runIdText, fromId, toId, kind, subject FROM mail WHERE ${where}) ` +
      'SELECT idText, atText, runIdText, fromId, toId, kind, subject FROM sel ORDER BY id',
    ).all(...binds) as unknown as
```

Statement 2 (`FROM mail_deliveries WHERE mailId IN (SELECT id FROM mail WHERE ${where}) ORDER BY id`) is unchanged: it
reuses `where` and `binds`.

In the same method's docstring the sentences from "It bounds the rows LOADED" to "until a migration indexes them." now
state something false. Replace these five lines:

```ts
   * is `at >= sinceAt` (`stall-mail-read-time-bounded` (D-3651)), and the lane passes `now - BACKLOG_HORIZON_MS`. It
   * bounds the rows LOADED, not the scan: `mail` has no index but its key, and adding one is a migration. The
   * same holds for the two `mail_deliveries` scans, statement 1's delivered-to subquery and statement 2's (that
   * table's one index is `mail_deliveries_due`): each candidate's read grows with the whole mail history, on the
   * synchronous handle, until a migration indexes them. An empty `runIds` drops the run clause rather than binding an empty list.
```

with:

```ts
   * is `at >= sinceAt` (`stall-mail-read-time-bounded` (D-3651)), and the lane passes `now - BACKLOG_HORIZON_MS`.
   * PLANNED ON INDEXES, NEVER A TABLE SCAN (schema.ts's stall-read entry; `stall-store.test.ts` pins each plan): the
   * run clause reads `mail_by_run`, the horizon `mail_by_at`, and both delivery reads `mail_deliveries_by_mail`. Two
   * shapes here exist for the planner, and neither changes an answer. The delivered-to subquery is bounded by the
   * horizon too: the outer row it selects must pass `at >= sinceAt` anyway, so the bound only lets the subquery walk
   * `mail_by_at` instead of every delivery (there is deliberately no index led by `toId`; schema.ts says why).
   * Statement 1 is MATERIALIZED before its ORDER BY, because this server never runs ANALYZE and the planner
   * otherwise prefers a rowid-order scan of all of `mail` to an index read and a sort. An empty `runIds` drops the
   * run clause rather than binding an empty list.
```

In the docstring above the repoint-and-park method, replace the two lines

```ts
   * `(mailId, toId)` to fall back on (`schema.ts`: the one index is
   * `mail_deliveries_due`). So:
```

with

```ts
   * `(mailId, toId)` to fall back on (`schema.ts`: neither of its indexes,
   * `mail_deliveries_due` and `mail_deliveries_by_mail`, is unique). So:
```

In `server/test/coord-store.test.ts` (search "constraint on (mailId, toId) — the only index is"), replace
"— the only index is `mail_deliveries_due`" with "— neither of its two indexes is unique".

- [ ] **Step 6: Move the pins the new entry changes.**

`server/test/coord-db.test.ts`, the row "mail_deliveries carries exactly the index dueDeliveries can use":
`expect(indexNames).toEqual(['mail_deliveries_due']);` → `expect(indexNames).toEqual(['mail_deliveries_by_mail', 'mail_deliveries_due']);`
and add to the end of its comment: "Since the stall-read entry the set is two: `mail_deliveries_by_mail` serves the stall
read's delivery statement, and the plan rows in `stall-store.test.ts` pin that `dueDeliveries` still reads
`mail_deliveries_due`."

`coord-db.test.ts`, row "COORD_SCHEMA_VERSION derives to 14": title "derives to 15", both `toBe(14)` → `toBe(15)`, and
its comment gains "and MIGRATIONS[14] (the stall mail read's indexes, worker stall watch wave 5)". The migration-11 row's
`expect(COORD_SCHEMA_VERSION).toBe(14);` → `toBe(15)` and its comment "14 since MIGRATIONS[13]" → "15 since
MIGRATIONS[14] (the stall read's indexes)". `server/test/asks-store.test.ts`: `toBe(14)` → `toBe(15)`, and its comment's
"FOUR migrations" / "any of the four" → "FIVE" / "any of the five", naming MIGRATIONS[14].

- [ ] **Step 7: Run green.**

Run: `./node_modules/.bin/vitest run test/coord-db.test.ts test/stall-store.test.ts test/asks-store.test.ts`
Expected: 153 passed (63, 62, 28).
Run: `./node_modules/.bin/vitest run test/coord-store.test.ts test/mail-sweep.test.ts test/mail-routes.test.ts test/mail-hardening.test.ts test/mail-peer-quota.test.ts test/coord-health.test.ts test/child-reclaim-mail-store.test.ts test/stall-sweep.test.ts`
Expected: 485 passed (170, 102, 59, 18, 7, 23, 5, 101: the per-suite counts on the replay before Tasks 2 and 6).
Run: `./node_modules/.bin/vitest run test/update-writer-groups.test.ts test/lifecycle-store.test.ts test/run-routes.test.ts`
Expected: green. Run `./node_modules/.bin/tsc --noEmit -p .` and `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`: clean.

- [ ] **Step 8: Mutations.** Run `python3 .superpowers/sdd/2026-10-02-stall-watch-w5-follow-ups/mutate.py . T1-M1 T1-M2 T1-M3 T1-M4 T1-M5 T1-M6 T1-M7 T1-M8`
from the repo root (the runner is in "Mutation table"). Every row must go red as tabled; `git diff --exit-code` after.

- [ ] **Step 9: Commit.**

```bash
git add server/src/coord/schema.ts server/src/coord/store.ts server/test/coord-db.test.ts server/test/asks-store.test.ts server/test/coord-store.test.ts server/test/stall-store.test.ts
git commit -m "perf(stall): the stall mail read plans on indexes (migration: mail_by_run, mail_by_at, mail_deliveries_by_mail)"
```

---

### Task 2: The busy-shadow log keeps a held delivery until it is finished

**Files:**
- Modify: `server/src/watch.ts` (the shared-api import line; `busyShadowLogged`'s docstring; the prune in `sweepMail`)
- Test: `server/test/mail-sweep.test.ts` (one row in describe `sweepMail: the turn marker and the busy modes`)

**Interfaces:**
- Consumes: `CoordStore.delivery(id): { id; mailId; toId; state: MailDeliveryState } | null` (exists);
  `TERMINAL_DELIVERY_STATES` from `shared/api.ts` (exists).
- Produces: nothing new.

- [ ] **Step 1: Write the failing row.** In `server/test/mail-sweep.test.ts`, immediately before the row titled
`busy modes: a live shell with a working marker at least as new as statusUpdatedAt refuses not-idle; an older one does not`, insert:

```ts
  it('mail-gate-busy-shadow: a logged delivery backed off past a sweep is still outstanding, so it is said once, not again on its return', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedAll(h, { status: 'busy', statusUpdatedAt: NOW - 1_000 });
    seedTurnMark(h.home);
    arm(h, MAIL_GATE_BUSY_SHADOW_MARKER);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await w.sweepMail();
      expect(shadowWarns(warn), 'premise: logged once').toEqual([wouldDeliver(id)]);
      // Held past the next sweep by another lane's back-off: still `queued`, so still outstanding, but not due.
      coord.backOff(id, 'held by a test', Date.now() + 3 * PAST_SWEEP_MS, false);
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
      expect(logged(w).has(id), 'a queued delivery is outstanding whether or not it is due this sweep').toBe(true);
      advance(3 * PAST_SWEEP_MS);
      await w.sweepMail();
      expect(deliveryRow(coord, id).lastGate, 'premise: the return reached the busy gate again').toBe('not-idle');
      expect(shadowWarns(warn), 'one line per delivery, not one per return').toEqual([wouldDeliver(id)]);
    } finally {
      warn.mockRestore();
    }
  });

```

- [ ] **Step 2: Run it red.** Run: `./node_modules/.bin/vitest run test/mail-sweep.test.ts -t "busy-shadow"`
Expected: 1 failed — `a queued delivery is outstanding whether or not it is due this sweep: expected false to be true`.

- [ ] **Step 3: Fix the prune.** In `server/src/watch.ts`, add `TERMINAL_DELIVERY_STATES` to the ONE-LINE shared-api
import (keep it on one line: `single-definition.test.ts` scans that line for `UNCHECKED_PR`):

```ts
import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

In `sweepMail`, replace:

```ts
    // The busy-shadow log's memory keeps only deliveries still outstanding.
    // It is pruned BEFORE the empty-queue return, so an idle box empties it.
    const outstandingIds = new Set([...unacked, ...dueBefore].map((r) => r.id));
    for (const loggedId of this.busyShadowLogged) if (!outstandingIds.has(loggedId)) this.busyShadowLogged.delete(loggedId);
```

with:

```ts
    // The busy-shadow log's memory keeps only deliveries still outstanding.
    // It is pruned BEFORE the empty-queue return, so an idle box empties it.
    // Due or delivered this sweep is outstanding; a row in neither is looked up,
    // because a queued row another lane backed off past this sweep is still
    // outstanding and must not be said a second time when it returns.
    const outstandingIds = new Set([...unacked, ...dueBefore].map((r) => r.id));
    for (const loggedId of this.busyShadowLogged) {
      if (outstandingIds.has(loggedId)) continue;
      const row = store.delivery(loggedId);
      if (row === null || (TERMINAL_DELIVERY_STATES as readonly string[]).includes(row.state)) this.busyShadowLogged.delete(loggedId);
    }
```

In `busyShadowLogged`'s docstring, replace the two lines

```ts
   *  there is one line per delivery, not one per sweep. `sweepMail` prunes it
   *  at its head to the deliveries still outstanding. IN MEMORY BY DESIGN, as
```

with

```ts
   *  there is one line per delivery, not one per sweep. `sweepMail` prunes it
   *  at its head to the deliveries still outstanding, due or not (a row backed
   *  off past a sweep is kept). IN MEMORY BY DESIGN, as
```

An `unknown`-state row is kept (it is not terminal, the stance `TERMINAL_DELIVERY_STATES`' docstring takes);
the set holds one id per delivery ever logged, so that is bounded.

- [ ] **Step 4: Run green.** Run: `./node_modules/.bin/vitest run test/mail-sweep.test.ts` — Expected: 103 passed.
`tsc --noEmit -p .` clean.

- [ ] **Step 5: Mutations** `T2-M1 T2-M2` (table). **Step 6: Commit.**

```bash
git add server/src/watch.ts server/test/mail-sweep.test.ts
git commit -m "fix(stall): the busy-shadow log keeps a delivery backed off past a sweep, so it is said once"
```

---

### Task 3: The stall read's failure names its table, and every proven column has its row

**Files:**
- Modify: `server/src/coord/store.ts` (`stallMailFor`'s return type, its five delivery-column returns, one docstring sentence)
- Test: `server/test/stall-store.test.ts` (the D-2545 `it.each` in describe `stallMailFor: one mail read per candidate`)

**Interfaces:**
- Consumes: Task 1's `stallMailFor` (same method; apply after it).
- Produces: `stallMailFor(...)`'s failure arm becomes
  `{ ok: false; kind: Extract<StallReadFailure, 'mail-unreadable' | 'delivery-unreadable'>; detail: string }`. Its one
  consumer, `watch.ts`'s three call sites, prints `read.kind` in a warn line and branches on nothing, so no consumer
  changes (measured: `tsc` clean).

- [ ] **Step 1: Write the failing rows.** Replace the whole `it.each([...])('refuses the WHOLE read on one unrepresentable %s, …')`
block (four rows, ending `expect(detail).not.toMatch(/[0-9]/);\n  });`) with:

```ts
  it.each([
    ['mail id', 'mail-unreadable', 'mail id is not a positive safe integer'],
    ['mail at', 'mail-unreadable', 'mail at is not a positive safe integer'],
    ['mail runId', 'mail-unreadable', 'mail runId is not a positive safe integer'],
    ['delivery id', 'delivery-unreadable', 'delivery id is not a positive safe integer'],
    ['delivery deliveredAt', 'delivery-unreadable', 'delivery deliveredAt is not a positive safe integer'],
    ['delivery ackedAt', 'delivery-unreadable', 'delivery ackedAt is not a positive safe integer'],
    ['delivery gateSince', 'delivery-unreadable', 'delivery gateSince is not a positive safe integer'],
  ] as const)('refuses the WHOLE read on one unrepresentable %s, naming its table\'s kind and the column, and no value (D-2545)', (column, kind, detail) => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const plain = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    const bad = mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: null, kind: 'status',
      subject: W2_ORPHANED_SUBJECT, at: S4_STATUS_AT });
    const d = s.queueDelivery(bad, 'demo-worker', '');
    // `plain` has no delivery row, so its id moves with the foreign key still on.
    if (column === 'mail id') s.db.prepare('UPDATE mail SET id = ? WHERE id = ?').run(UNSAFE, plain);
    if (column === 'mail at') s.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(UNSAFE, bad);
    if (column === 'mail runId') {
      // A run id this process cannot represent has no runs row to reference, so the fixture lifts the FK first.
      s.db.exec('PRAGMA foreign_keys = OFF');
      s.db.prepare('UPDATE mail SET runId = ? WHERE id = ?').run(UNSAFE, bad);
    }
    if (column === 'delivery id') s.db.prepare('UPDATE mail_deliveries SET id = ? WHERE id = ?').run(UNSAFE, d.id);
    if (column === 'delivery deliveredAt') s.db.prepare('UPDATE mail_deliveries SET deliveredAt = ? WHERE id = ?').run(UNSAFE, d.id);
    if (column === 'delivery ackedAt') s.db.prepare('UPDATE mail_deliveries SET ackedAt = ? WHERE id = ?').run(UNSAFE, d.id);
    if (column === 'delivery gateSince') s.db.prepare('UPDATE mail_deliveries SET gateSince = ? WHERE id = ?').run(UNSAFE, d.id);
    expect(s.stallMailFor('demo-worker', [run], W2_SINCE_AT)).toEqual({ ok: false, kind, detail });
    expect(detail).not.toMatch(/[0-9]/);
  });
```

`delivery mailId` gets no row, and that is measured, not skipped: a delivery is read only when its `mailId` equals the id
of a mail statement 1 selected, which passed its own `mail id` proof first, so an unrepresentable `mailId` cannot reach
the check on its own. The check stays (it costs nothing and says what it is).

- [ ] **Step 2: Run red.** Run: `./node_modules/.bin/vitest run test/stall-store.test.ts -t "unrepresentable"`
Expected: 4 failed — the four `delivery` rows (`kind: 'mail-unreadable'` received). The three `mail` rows pass: they pin
guards that exist.

- [ ] **Step 3: Implement.** In `stallMailFor`'s signature, `Extract<StallReadFailure, 'mail-unreadable'>` →
`Extract<StallReadFailure, 'mail-unreadable' | 'delivery-unreadable'>`. In the delivery loop (`for (const d of drows)`),
each of the five `return { ok: false, kind: 'mail-unreadable', detail: … }` (`id`, `mailId`, `deliveredAt`, `ackedAt`,
`gateSince`) becomes `kind: 'delivery-unreadable'`. The mail loop's three stay `mail-unreadable`. In the docstring,
replace the two lines

```ts
   * site, never inside `persistedInt`. ALL-OR-FAILURE: one unrepresentable value refuses the whole read, and
   * the detail names the column and no value. `kind`, `state` and `lastGate` are the raw columns: L1 compares
```

with

```ts
   * site, never inside `persistedInt`. ALL-OR-FAILURE: one unrepresentable value refuses the whole read, the
   * kind names its table (`mail-unreadable` or `delivery-unreadable`), and the detail names the column and no value.
   * `kind`, `state` and `lastGate` are the raw columns: L1 compares
```

- [ ] **Step 4: Run green.** `./node_modules/.bin/vitest run test/stall-store.test.ts test/stall-sweep.test.ts` —
Expected: 65 and 101 passed (102 once Task 6 lands). Both `tsc` runs clean.

- [ ] **Step 5: Mutations** `T3-M1 T3-M2 T3-M3 T3-M4`. **Step 6: Commit.**

```bash
git add server/src/coord/store.ts server/test/stall-store.test.ts
git commit -m "fix(stall): the stall read's failure names the table that failed, and every proven column has its row"
```

---

### Task 4: The hookstate fold is total over the raw reasons

**Files:**
- Modify: `server/src/hookstate.ts` (`foldHookStateRead` and a new constant above it)
- Test: none new (behaviour is unchanged and already pinned; the guard is the compiler, measured below)

**Interfaces:** Consumes and produces nothing; `readHookStateMeasured`'s answers are unchanged.

- [ ] **Step 1: Measure the gap.** Add `| 'stale'` to `HookStateRawRead`'s failure reasons
(`reason: 'absent' | 'unmeasured' | 'malformed'` → `… | 'malformed' | 'stale'`) and run `./node_modules/.bin/tsc --noEmit -p .`.
Measured: ONE error, at `watch.ts`'s `stallHookFactOf` (`TS2322 … "stale" is not assignable`), and none at the fold. The
author who fixes that error widens `HookRawFact`'s reasons, and the fold then folds `stale` to `NO_STATE` with nothing
said. Revert (`git checkout server/src/hookstate.ts`).

- [ ] **Step 2: Implement.** Replace:

```ts
/** The aged door's ONE decision over the raw read (`readHookStateMeasured`): the identity cut, the age cut, and the
 *  fold of `absent`/`malformed` into `no-state`. `unmeasured` stays `unmeasured` (D-115). The unaged door that once
 *  shared it is gone (worker stall watch wave 2): the lane reads the raw read and makes its own cut. */
function foldHookStateRead(raw: HookStateRawRead, now: number): HookStateRead {
  if (!raw.ok) return raw.reason === 'unmeasured' ? { ok: false, reason: 'unmeasured' } : NO_STATE;
```

with:

```ts
/** The aged fold's answer for each raw failure, TOTAL over the reasons: a reason added to `HookStateRawRead` without
 *  its row here is a compile error, never a silent `NO_STATE`. `unmeasured` stays `unmeasured` (D-115). */
const RAW_FAILURE_FOLD: Record<Extract<HookStateRawRead, { ok: false }>['reason'], HookStateRead> = {
  absent: NO_STATE,
  unmeasured: { ok: false, reason: 'unmeasured' },
  malformed: NO_STATE,
};

/** The aged door's ONE decision over the raw read (`readHookStateMeasured`): the identity cut, the age cut, and the
 *  fold of `absent`/`malformed` into `no-state` (`RAW_FAILURE_FOLD`). The unaged door that once
 *  shared it is gone (worker stall watch wave 2): the lane reads the raw read and makes its own cut. */
function foldHookStateRead(raw: HookStateRawRead, now: number): HookStateRead {
  if (!raw.ok) return RAW_FAILURE_FOLD[raw.reason];
```

- [ ] **Step 3: Run green, then re-measure the mutation.** `./node_modules/.bin/vitest run test/hookstate.test.ts` — 54
passed (its `absent → no-state`, `unreadable → unmeasured` and malformed `→ no-state` rows pin the three values).
`tsc --noEmit -p .` clean. Repeat Step 1's mutation: measured, tsc now ALSO reports
`hookstate.ts … TS2741: Property 'stale' is missing in type …` at `RAW_FAILURE_FOLD`. Revert; `git diff --exit-code -- server/src/hookstate.ts`
shows only Step 2's change.

- [ ] **Step 4: Commit.**

```bash
git add server/src/hookstate.ts
git commit -m "refactor(stall): the hookstate fold is a total map over the raw read's reasons"
```

---

### Task 5: The largest Date epoch is spelled once

**Files:**
- Modify: `server/src/coord/stall.ts` (`stallIso` and a new export above it), `server/src/turnmark.ts` (import; `TURN_MARK_EPOCH_MAX`)
- Test: `server/test/single-definition.test.ts` (one describe appended at the END of the file)

**Interfaces:**
- Produces: `export const STALL_EPOCH_MAX = 8.64e15;` in `server/src/coord/stall.ts`.

- [ ] **Step 1: Write the failing row.** Append to the END of `server/test/single-definition.test.ts` (never above line
~4050: the citation corpus cites this file by line):

```ts

describe('worker stall watch wave 5: the largest epoch a Date holds is spelled once', () => {
  // The turn marker's reader bounds every epoch by it (`marker-epochs-bounded` (D-3662)) and the watch's formatter
  // refuses a value past it (`stallIso`). Two literals are two bounds that can drift apart; the reader's bound is
  // only a guarantee for the formatter while they are the same number. Code lines only, so a sentence about it is
  // not a second spelling.
  const SPELLING = /\b8\.64e15\b|\b8_?640_?000_?000_?000_?000\b/;

  it('CONTROL: the pattern sees both spellings of the number, and not a neighbour', () => {
    expect(SPELLING.test('export const STALL_EPOCH_MAX = 8.64e15;')).toBe(true);
    expect(SPELLING.test('const M = 8_640_000_000_000_000;')).toBe(true);
    expect(SPELLING.test('const M = 8.64e14;')).toBe(false);
  });

  it('is spelled on a code line in server/src/coord/stall.ts alone', () => {
    expect(ALL.filter((f) => SPELLING.test(stallCode(f))).map(rel).sort(), 'a second spelling').toEqual(['server/src/coord/stall.ts']);
  });
});
```

- [ ] **Step 2: Run red.** `./node_modules/.bin/vitest run test/single-definition.test.ts -t "largest epoch"` —
Expected: 1 failed (`expected [ 'server/src/coord/stall.ts', …(1) ]`, the second holder being `server/src/turnmark.ts`).

- [ ] **Step 3: Implement.** In `server/src/coord/stall.ts`, replace:

```ts
/** The ONE Date use in this module, and the only shape `stall-vocabulary.test.ts` admits: formatting a measured
 *  epoch, never reading the clock. It returns null for a value `toISOString` would throw on. */
function stallIso(ms: number): string | null {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}
```

with:

```ts
/** The largest epoch, in ms, a JavaScript `Date` holds. ONE spelling (`single-definition.test.ts`): the turn
 *  marker's reader bounds every epoch by it (`marker-epochs-bounded` (D-3662)), and `stallIso` refuses past it. */
export const STALL_EPOCH_MAX = 8.64e15;

/** The ONE Date use in this module, and the only shape `stall-vocabulary.test.ts` admits: formatting a measured
 *  epoch, never reading the clock. It returns null for a value `toISOString` would throw on. */
function stallIso(ms: number): string | null {
  return Number.isFinite(ms) && Math.abs(ms) <= STALL_EPOCH_MAX ? new Date(ms).toISOString() : null;
}
```

In `server/src/turnmark.ts`, add `STALL_EPOCH_MAX` to the existing import from `./coord/stall.js`
(`import {\n  STALL_EPOCH_MAX, TURN_MARK_STATES, turnMarkGraceUntil, …`) and replace:

```ts
/** The largest epoch a JS `Date` holds. */
const TURN_MARK_EPOCH_MAX = 8.64e15;
```

with:

```ts
/** The largest epoch a JS `Date` holds: the watch's one spelling, so this bound and `stallIso`'s cannot drift. */
const TURN_MARK_EPOCH_MAX = STALL_EPOCH_MAX;
```

`turnMarkGraceUntil` can still answer up to `RESTART_GRACE_MS` past the bound for a `restartAt` at it; that value is only
compared (`now < graceUntil`) and `stallIso` refuses to format it, so nothing throws. No change.

- [ ] **Step 4: Run green.** `./node_modules/.bin/vitest run test/single-definition.test.ts test/turnmark.test.ts test/stall-vocabulary.test.ts test/stall-bodies.test.ts`
— Expected: 261, 32, 178, 155 passed (626 together). `tsc` clean.

- [ ] **Step 5: Mutation** `T5-M1`. **Step 6: Commit.**

```bash
git add server/src/coord/stall.ts server/src/turnmark.ts server/test/single-definition.test.ts
git commit -m "refactor(stall): the largest Date epoch is spelled once, in stall.ts"
```

---

### Task 6: Three unpinned guards get their rows

**Files (tests only):**
- Test: `server/test/mail-sweep.test.ts` (one row, same describe as Task 2's)
- Test: `server/test/stall-sweep.test.ts` (one row, describe `sweepStalls: wave 2 (spec §5)`)
- Test: `server/test/single-definition.test.ts` (the wave-2 marker describe's CONTROL row, edited in place)

**Interfaces:** none. Each row pins a guard that exists; each is green on the tree and red under its mutation
(`T6-M1`..`T6-M3`), which is this task's red step.

- [ ] **Step 1: The busy modes read no marker without a live file.** In `mail-sweep.test.ts`, immediately before the row
titled `mail-gate-strict reads no marker at all, even beside a touched busy marker (a counting io, with its control)`,
insert:

```ts
  it('the busy modes read no marker for a recipient with no live file: that row is not-idle already (a counting io, with its control)', async () => {
    // `sweepMail`'s `live !== null` conjunct: the marker reader needs the live `startedAt` to call a marker stale,
    // and a null live read answers not-idle whatever the marker says, so the read would buy nothing. The control
    // seeds the live file on the same fixture and reads the marker once.
    for (const [withLive, readCount] of [[false, 0], [true, 1]] as const) {
      const { io, reads } = turnReadsIO();
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord, { io });
      seedRegistry(h.home, ID); seedHookState(h.home, ID); seedRegistry(h.home, FROM_ID, FROM_UUID);
      if (withLive) seedLiveState(h.home, { startedAt: STARTED, status: 'busy', statusUpdatedAt: NOW - 1_000 });
      seedTurnMark(h.home);
      arm(h, MAIL_GATE_BUSY_SHADOW_MARKER);
      const { id } = queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      const label = withLive ? 'with a live file (control)' : 'no live file';
      expect(reads, label).toHaveLength(readCount);
      expect(literalSends(h.calls), label).toEqual([]);
      expect(deliveryRow(coord, id).lastGate, label).toBe('not-idle');
    }
  });

```

- [ ] **Step 2: The orphan pass returns on an unmeasured identity.** In `stall-sweep.test.ts`, immediately before the
comment `// A read-budget skip: orphan D answers none without an idle live word, and a row with no live pane has none, so`,
insert:

```ts
  // A read-budget skip, and the line the marker read stands on: a registry row whose identity the tick could not
  // measure has no uuid to judge a marker against (`coordinator-marker-unreadable` (D-3654)), so the orphan pass
  // returns before any read. The control is the same row measured.
  it('a registry row whose identity is unmeasured costs NO read and draws nothing; measured, it reads its marker', async () => {
    const reads: string[] = [];
    const { h, coord, w } = await rig({ io: countingIO(reads) });
    seedOrphan(h.home);
    const orphanReads = (): string[] => reads.filter((p) => p.includes(ORPHAN)).map((p) => path.basename(p));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(D_AT);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, tickOf(PID, [regRow(ORPHAN, ORPHAN_UUID, { unmeasured: ['uuid'] })]));
    expect(orphanReads()).toEqual([]);
    expect(operatorMail(coord)).toEqual([]);
    // Returned, never thrown: a throw is caught per row and said as `… failed (…)`, which would also read nothing.
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`session ${ORPHAN} failed`))).toEqual([]);
    warn.mockRestore();
    at(D_AT + STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());                     // the control
    expect(orphanReads()).toContain(`${ORPHAN}.turn.json`);
  });

```

The warn assertion is what makes the row red under the mutation: without the `return`, the pass throws at `ident.uuid`
before any read, so a reads-only row would stay green (measured).

- [ ] **Step 3: The marker CONTROL derives from the shipped names.** In `single-definition.test.ts` (below line ~4050),
describe `worker stall watch wave 2: the three new operator-switch markers have no writer in the tree (spec §5)`, replace
the row:

```ts
  it('CONTROL: the match is a substring — a line spelling mail-gate-busy-shadow also holds mail-gate-busy, never the reverse', () => {
    expect(stallCodeText("export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';").includes('mail-gate-busy')).toBe(true);
    expect(stallCodeText("export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';").includes('mail-gate-busy-shadow')).toBe(false);
    expect('stall-watch-w2-live'.includes('stall-watch-live')).toBe(false);
  });
```

with:

```ts
  it('CONTROL: the match is a substring — a line spelling mail-gate-busy-shadow also holds mail-gate-busy, never the reverse', async () => {
    expect(stallCodeText("export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';").includes('mail-gate-busy')).toBe(true);
    expect(stallCodeText("export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';").includes('mail-gate-busy-shadow')).toBe(false);
    // From the SHIPPED names, never two literals (a literal against a literal can never fail): of every operator-switch
    // marker the two describes pin, the one pair where a name holds another is the busy pair the caveat names. Imported
    // here, not at the head of the file, because this file is cited by line.
    const { STALL_MARKERS } = await import('../src/coord/stall.js');
    const gate = await import('../src/turnidle.js');
    const names: string[] = [...STALL_MARKERS, gate.MAIL_GATE_STRICT_MARKER, gate.MAIL_GATE_BUSY_MARKER, gate.MAIL_GATE_BUSY_SHADOW_MARKER];
    expect(names.flatMap((a) => names.filter((b) => a !== b && a.includes(b)).map((b) => `${a} holds ${b}`)))
      .toEqual([`${gate.MAIL_GATE_BUSY_SHADOW_MARKER} holds ${gate.MAIL_GATE_BUSY_MARKER}`]);
  });
```

- [ ] **Step 4: Run green.** `./node_modules/.bin/vitest run test/mail-sweep.test.ts test/stall-sweep.test.ts test/single-definition.test.ts`
— Expected: 104, 102, 261 passed.

- [ ] **Step 5: Mutations** `T6-M1 T6-M2 T6-M3` (each must red exactly the row this task added or edited).
**Step 6: Commit.**

```bash
git add server/test/mail-sweep.test.ts server/test/stall-sweep.test.ts server/test/single-definition.test.ts
git commit -m "test(stall): rows for the busy modes' live-file conjunct, the orphan pass's identity skip, and a derived marker control"
```

---

### Task 7: r1's proof-bound line says what the proof waits for

**Files:**
- Modify: `server/src/coord/stall.ts` (`stallCheckMail`, the `proofBound` line)
- Test: `server/test/stall-bodies.test.ts` (three goldens)

**Interfaces:** Consumes `STALL_RESUMING_KINDS` (exists, `['subagent', 'workflow']`, derived from `STALL_BG_KIND_MAP`).

The line promises the coordinator is told "when your next turn ends without one". `stallProofDue`'s proof (a) needs that
Stop to be a `done` mark with a measured `bg` and no resuming kind still running; a turn that ends while a subagent or
workflow runs is a legitimate wait and is not proof, so the promise is false exactly there. The bound clause ("and by …
at the latest") is unchanged. This departs from spec §4.2's example sentence: `r1-proof-line-names-running-subagents` (D-3794).

- [ ] **Step 1: Red the goldens.** In `server/test/stall-bodies.test.ts`, in all three goldens containing
`is told when your next turn ends without one, and by 02:57Z at the latest` (the describe `r1: the proof-bound line`,
its operator row, and `an interrupted turn is a turn end for the marker ladder`), replace that phrase with
`is told when your next turn ends without one and no subagent or workflow of yours is still running, and by 02:57Z at the latest`.

Run: `./node_modules/.bin/vitest run test/stall-bodies.test.ts` — Expected: 3 failed.

- [ ] **Step 2: Implement.** In `stallCheckMail`, replace
`is told when your next turn ends without one, and by ${stallDeadline(now + STALL_BOUND_MS)} at the latest`
with
`is told when your next turn ends without one and no ${STALL_RESUMING_KINDS.join(' or ')} of yours is still running, and by ${stallDeadline(now + STALL_BOUND_MS)} at the latest`.
The phrase `when your next turn ends` survives, which `stall-sweep.test.ts`'s two `toContain` rows read.

- [ ] **Step 3: Run green.** `./node_modules/.bin/vitest run test/stall-bodies.test.ts test/stall-sweep.test.ts test/stall-vocabulary.test.ts`
— Expected: 155, 102, 178 passed (435 together). `tsc` clean.

- [ ] **Step 4: Commit** (the goldens are the pin; reverting the sentence reds three rows, measured in Step 1).

```bash
git add server/src/coord/stall.ts server/test/stall-bodies.test.ts
git commit -m "fix(stall): r1's proof-bound line names the running subagent or workflow that keeps a turn end from counting"
```

---

### Task 8: Comments that state something false

**Files:**
- Modify: `server/src/coord/stall.ts` (comments only, `stallSilence`'s docstring among them)
- Modify: `server/test/stall-verdict.test.ts`, `server/test/stall-backoff.test.ts`, `server/test/stall-sweep.test.ts`
  (titles and a comment)
- Test: `server/test/stall-vocabulary.test.ts` (one row added, one title corrected)

**Interfaces:** none.

- [ ] **Step 1: Re-grep after wave 3.** Run `grep -n "^  // ([0-9]*[a-z]*) \|step (\?[0-9][0-9]*[a-z]\?)\?" server/src/coord/stall.ts`.
Spec §10 numbers ten steps; the code splits its step-2 unmeasured hold for the live read out after lifecycle
(`dead-lifecycle-precedes-live-stamp`), so from that read on its comments run one ahead. Wave 3 adds a `(2c)` label for
the re-activation hold; leave every `(2a)`, `(2b)`, `(2c)` and `(1)`, `(3)` as they are.

- [ ] **Step 2: Renumber to the spec's own numbers** (each replacement is exact text; each must occur once):

| Find | Replace |
|---|---|
| ` * I2: how long the marker branch (step 11, under` | ` * I2: how long the marker branch (§10 step 10, under` |
| `/** §10 step 11 without the w2 marker,` | `/** §10 step 10 without the w2 marker,` |
| `/** The limit-hold condition (§10 step (6)), the ONE definition:` | `/** The limit-hold condition (§10 step (5)), the ONE definition:` |
| `/** §10 after wave 2. The first match wins:` | `/** §10 after wave 2, in the spec's own numbers. The first match wins:` |
| ` *  (4) the live read, and under the w2 marker an unmeasured turn marker;` | ` *  (3b) the live read, and under the w2 marker an unmeasured turn marker (step 2's hold, after (3) by D-3630);` |
| ` *  (5) hold 2a, then 2b;` … ` *  (11) the worker's ball:` (seven docstring lines) | the same lines numbered `(4)` … `(10)` |
| `` `frozen` (step 8, ahead of the coord-ball `` | `` `frozen` (step 7, ahead of the coord-ball `` |
| `  // (4) the live read. ` | `  // (3b) the live read. ` |
| `  // (5) hold 2a (a question, uncapped)` | `  // (4) hold 2a (a question, uncapped)` |
| `  // (6) the limit hold, capped once per episode` | `  // (5) the limit hold, capped once per episode` |
| `  // (7) restart grace:` | `  // (6) restart grace:` |
| `  // (8) frozen:` | `  // (7) frozen:` |
| `  // (9) delegates:` | `  // (8) delegates:` |
| `  // (10) the coordinator's ball:` | `  // (9) the coordinator's ball:` |
| `  // (11) the worker's ball.` | `  // (10) the worker's ball.` |
| `when §10 step 11's marker ladder is the one that decides r1` | `when §10 step 10's marker ladder is the one that decides r1` |

Tests: `stall-verdict.test.ts` describe titles `(§5.2, §10 step 8)` → `(§5.2, §10 step 7)`, `(§5.1, §10 step 9)` →
`(§5.1, §10 step 8)`, `(§5.2, §10 step 10)` → `(§5.2, §10 step 9)`, `(§5.1, §10 step 11)` → `(§5.1, §10 step 10)`;
`stall-backoff.test.ts` `the marker branch (Task 11, step 11) decides r1` → `the marker branch (§10 step 10) decides r1`;
`stall-sweep.test.ts` `// Frozen (§5.1, step 8):` → `// Frozen (§5.1, §10 step 7):`; `stall-verdict.test.ts`
`(§10 steps 8 and 9)` (frozen and delegates) → `(§10 steps 7 and 8)`. If wave 3 added any other
`§10 step` citation at or past the live read, renumber it the same way and list it in the wave-done mail.

**`stallSilence`'s docstring (ledger R11, wave 3 review F2).** Since D-3788 the episode key is the later of `capKeyMs`
and the re-activation, and the dialog and limit caps key on `capKeyMs`, so "the same clock the caps use" is false.
Replace the line

```ts
 *  measured from the episode key (the same clock the caps use), so a restamp by r1's own delivery cannot shorten
```

with the two lines

```ts
 *  measured from the episode key (the coord-ball cap's key too; the dialog and limit caps keep `capKeyMs`, which a
 *  re-activation does not move), so a restamp by r1's own delivery cannot shorten
```

Task 9 pins the clock this docstring describes (its r2 rows, T9-M6 and T9-M8).

- [ ] **Step 3: The prefix comment, and the mechanism it should have named.** In `stallMailClass`, replace
`  // 'self-wake' is tested after check and report, so a report naming a failure stays a report.` with
`` // No class prefix starts another (`stall-vocabulary.test.ts` pins it), so the order of these tests decides nothing. ``
In `stall-vocabulary.test.ts`, replace the line
`  it('check and report are tested first: a report naming a failure stays a report', () => {` with:

```ts
  it('no class prefix starts another, so the order of stallMailClass\'s tests decides nothing', () => {
    const P = [STALL_CHECK_PREFIX, STALL_REPORT_PREFIX, STALL_ORPHANED_PREFIX, STALL_FAILED_PREFIX, STALL_REPLY_PREFIX];
    expect(P.flatMap((a) => P.filter((b) => a !== b && a.startsWith(b)).map((b) => `${a} starts with ${b}`))).toEqual([]);
  });
  it('a report naming a failure stays a report, and a check a check', () => {
```

(The row above generalises the wave-1 row "no watch prefix is a prefix of another class", which checks three pairs, to
all five class prefixes, the two self-wake ones included.)

- [ ] **Step 4: Run green.** `./node_modules/.bin/vitest run test/stall-vocabulary.test.ts test/stall-verdict.test.ts test/stall-backoff.test.ts test/stall-sweep.test.ts`
— Expected: green; `stall-vocabulary` +1. `tsc` clean.

- [ ] **Step 5: Mutation** `T8-M1`. **Step 6: Commit.**

```bash
git add server/src/coord/stall.ts server/test/stall-verdict.test.ts server/test/stall-backoff.test.ts server/test/stall-sweep.test.ts server/test/stall-vocabulary.test.ts
git commit -m "docs(stall): step numbers follow spec §10, and the prefix-order comment names the real mechanism"
```

---

### Task 9: Wave 3's follow-ups (ledger R9) and its review's two pins (ledger R11)

Items 1–3 were reported by wave 3's worker (run 221, PR #228) and left out of that wave by its final-review rulings
(ledger R9). Items 4–5 are wave 3 review's finding F3 (run 224, ledger R11): two text sites that read the moved key and
have no pin of their own after a send-back.

**Files:**
- Modify: `server/src/coord/stall.ts` (its type-only import; `stallReactivation` and its docstring; a new
  `stallCoordBallFrom`; the coordinator-ball cap's age; `stallPushText`'s `coord-ball` case)
- Modify: `README.md` (one line of the stall-watch paragraph, in place)
- Test: `server/test/stall-verdict.test.ts`, `server/test/stall-bodies.test.ts`, `server/test/readme-holds.test.ts`,
  `server/test/stall-sweep.test.ts`

**Interfaces:**
- Consumes: wave 3's `stallReactivation(events: readonly StallEventRow[]): StallActivation`, `stallReactivatedAt`,
  `StallFacts.lastExchangeAt`; `RunState` (type, `shared/api.ts`).
- Produces: `stallReactivation` keyed on the dispatch EDGE; `stallCoordBallFrom(input: StallInput, f: StallFacts): number | null`
  (module-private), the one definition of the coordinator-ball clock.

The three items:
1. **`reactivation-first-entry-by-edge` (D-3796).** `stallReactivation` skips the run's FIRST entry into the active
   states by position, as the dispatch. `CoordStore.reconstruct()` rebuilds a run with no `run_events`, so that run's
   first send-back is its first entry, is skipped, and reads `none`: the false r1 wave 3 removed comes back for exactly
   the runs a lost `coord.db` rebuilt. `RUN_TRANSITIONS` has one edge into `dispatched` (`planned -> dispatched`), and
   `dispatchedAt` measures it, so the exact rule is "an entry into `dispatched` is the dispatch", wherever it sits.
2. **The coordinator-ball push names its own clock.** Since D-3789 the cap's 30 h runs from the later of the run's last
   mail and its re-activation, but the push still says only "no mail on the run since <last mail> (61h 0m)": true, and
   silent about the send-back 30 h ago that the cap actually ran from. The clock gets one definition
   (`stallCoordBallFrom`), the verdict times the cap from it, and the text names the send-back when it is the later.
3. **README's push sentence.** "pushes `⚠ waiting` once after 30 h with no mail on the run" is unqualified; the
   paragraph after it says the 30 h restarts on a send-back. The sentence says so too.
4. **r2's subject span after a send-back (R11, F3).** `stallReportMail`'s subject reads `now - facts.episodeKeyMs`,
   and its silence line reads `stallSilence`'s key; both follow the moved key, and nothing pins either after a
   send-back (measured: T9-M6 and T9-M8 are green on the tree before this task's rows).
5. **`stallCitedCheck` after a send-back (R11, F3).** The lane's r2 cites `stallCitedCheck(input, n.key)`. After a
   send-back, a row recorded under the pre-advance key can sit beside the new episode's r1; citing it would tell the
   coordinator a shadow row's story. Nothing pins the lane's key there (measured: T9-M7 is green before this task's
   row).

- [ ] **Step 1: Write the failing rows.** In `server/test/stall-verdict.test.ts`, in describe
`stallReactivation: the newest entry into ACTIVE_RUN_STATES after the first (quiet-restarts-on-reactivation)`, immediately
before `it('an unprovable time on an OLDER entry does not touch the newest one', () => {`, insert:

```ts
  it('keyed on the edge, never the position: a run with no dispatch row (rebuilt by reconstruct()) re-activates at its first send-back (reactivation-first-entry-by-edge (D-3796))', () => {
    expect(stallReactivation([ev(D + 9 * H, 'awaiting-review', 'working')])).toEqual(reactivated(D + 9 * H));
    expect(stallReactivation([ev(D + 9 * H, 'merging', 'working')])).toEqual(reactivated(D + 9 * H));
    // A planned -> dispatched row is the dispatch wherever it sits, so it is never the newest re-activation.
    expect(stallReactivation([ev(D + 9 * H, 'awaiting-review', 'working'), ev(D + 10 * H, 'planned', 'dispatched')])).toEqual(reactivated(D + 9 * H));
  });

```

and immediately before `describe('quiet-restarts-on-reactivation: the first dispatch changes nothing', () => {`, insert:

```ts
describe('reactivation-first-entry-by-edge (D-3796): a reconstructed run\'s first send-back restarts its clocks', () => {
  it('a run whose events begin at its send-back (CoordStore.reconstruct() writes none) keys the episode on it and holds r1', () => {
    const back = NOW - MIN;
    const input = stallInput({ activation: stallReactivation([ev(back, 'awaiting-review', 'working')]) });
    expect(stallFacts(input).episodeKeyMs).toBe(back);
    expect(stallVerdict(input, NOW)).toEqual(NONE);
    expect(stallVerdict(stallInput(), NOW), 'the control: the same run without the send-back draws r1').toEqual(r1(RUN67_DISPATCHED));
  });
});

```

Append to the END of `server/test/stall-bodies.test.ts`:

```ts

// `coord-ball-restarts-on-reactivation` (D-3789): the coordinator's 30 h runs from the later of the run's last mail and its
// return to work, so the push names that clock, and still names the last mail, which stays true.
describe('coord-ball after a send-back names the clock the cap runs from', () => {
  const q = mail(2600, EPISODE, WORKER, 'coordinator', 'question', 'which base branch');
  const H = 3_600_000;
  const REACT = EPISODE + 31 * H;   // 2026-09-30T04:17:43Z: the question sat 31 h, then the run went back to work

  it('the later send-back is named with its span, and the last mail with its own', () => {
    const input = s4({ mail: [q], arming: escalated, activation: { kind: 'reactivated', at: REACT } });
    const at = REACT + 30 * H;
    const n = stallVerdict(input, at);
    expect(n).toEqual({ act: 'notify', arm: 'coord-ball', rung: 1, key: REACT, to: 'operator' });
    expect(stallPushText(input, stallFacts(input), n as StallNotify, at).body).toBe('run 67 — demo-program wave 9/9: the run is waiting on its coordinator demo-coordinator (worker demo-worker); the run went back to work at 2026-09-30T04:17Z (30h 0m) and no mail has crossed it since; the last mail on the run was at 2026-09-28T21:17Z (61h 0m).');
  });

  it('a mail after the send-back is the clock again, and the text names only that mail', () => {
    const q2 = mail(2601, REACT + H, WORKER, 'coordinator', 'question', 'and the release note?');
    const input = s4({ mail: [q, q2], arming: escalated, activation: { kind: 'reactivated', at: REACT } });
    const at = REACT + 31 * H;
    const n = stallVerdict(input, at);
    expect(n).toEqual({ act: 'notify', arm: 'coord-ball', rung: 1, key: REACT + H, to: 'operator' });
    expect(stallPushText(input, stallFacts(input), n as StallNotify, at).body).toBe('run 67 — demo-program wave 9/9: the run is waiting on its coordinator demo-coordinator (worker demo-worker); no mail on the run since 2026-09-30T05:17Z (30h 0m).');
  });
});
```

Append to the END of `server/test/readme-holds.test.ts`:

```ts

describe('README: the coordinator-ball push (stall watch wave 5)', () => {
  // `coord-ball-restarts-on-reactivation` (D-3789): the 30 h runs from the later of the last mail on the run and the
  // run's return to work. The sentence that announces the push says so, not only the paragraph after it.
  it('the sentence that names the `⚠ waiting` push says its 30 h restarts on a send-back', () => {
    const sentence = readme.replace(/\s+/g, ' ').split(/(?<=\.)\s+/).find((s) => s.includes('pushes `⚠ waiting`'));
    expect(sentence, 'no README sentence names the push').toBeDefined();
    expect(sentence).toMatch(/30 h/);
    expect(sentence).toMatch(/send-back/);
  });
});
```

- [ ] **Step 2: Run them red.** Run: `./node_modules/.bin/vitest run test/stall-verdict.test.ts test/stall-bodies.test.ts test/readme-holds.test.ts`
Expected: 4 failed — the edge row (`expected { kind: 'none' } to deeply equal { kind: 'reactivated', … }`), the
reconstructed-run verdict row (the episode key is still `RUN67_DISPATCHED`), "the later send-back is named …", and the
README row (`… to match /send-back/`). "a mail after the send-back …" is green before and after: it pins that the
unchanged case keeps today's text.

- [ ] **Step 3: The re-activation keyed on the edge.** In `server/src/coord/stall.ts`:
`import type { MailGate } from '../../../shared/api.js';` → `import type { MailGate, RunState } from '../../../shared/api.js';`.
Replace the head of `stallReactivation`'s docstring:

```ts
/** The time of the newest transition INTO `ACTIVE_RUN_STATES` (L0, never a second list) from a state outside them,
 *  other than the run's FIRST such entry, in the store's `ORDER BY id`. The first entry is the dispatch, the run's one
 *  way in, and `dispatchedAt` already measures it: `markDispatched` and `advanceInner` stamp the two with separate
 *  `Date.now()` calls, so counting the dispatch's own row would move a never-mailed episode's key off `dispatchedAt`.
```

with:

```ts
/** The state a run enters at its dispatch: `RUN_TRANSITIONS`' one edge into it is `planned -> dispatched`. */
const STALL_DISPATCH_STATE = 'dispatched' satisfies RunState;

/** The time of the newest transition INTO `ACTIVE_RUN_STATES` (L0, never a second list) from a state outside them,
 *  other than an entry into `dispatched`. That entry is the dispatch, the run's one way in, and `dispatchedAt` already
 *  measures it: `markDispatched` and `advanceInner` stamp the two with separate `Date.now()` calls, so counting the
 *  dispatch's own row would move a never-mailed episode's key off `dispatchedAt`. Keyed on the EDGE, never the
 *  position (`reactivation-first-entry-by-edge` (D-3796)).
```

its tail:

```ts
 *  would hold the run until its next transition. A run rebuilt by `CoordStore.reconstruct()` has no events, so its first
 *  send-back is its only entry and reads `none`: it keeps today's clock, never an invented restart. */
```

with:

```ts
 *  would hold the run until its next transition. A run rebuilt by `CoordStore.reconstruct()` has no events, and its
 *  first send-back restarts the clocks as any send-back does: it is an entry, and no dispatch row precedes it. */
```

and its body's first two statements:

```ts
  const entries = events.filter((e) => active.includes(e.toState) && !active.includes(e.fromState));
  if (entries.length < 2) return { kind: 'none' };
```

with:

```ts
  const entries = events.filter((e) => active.includes(e.toState) && !active.includes(e.fromState) && e.toState !== STALL_DISPATCH_STATE);
  if (entries.length === 0) return { kind: 'none' };
```

In `stall-verdict.test.ts`, the describe title `… ACTIVE_RUN_STATES after the first (quiet-restarts-on-reactivation)` →
`… ACTIVE_RUN_STATES other than the dispatch (quiet-restarts-on-reactivation)`, and in its row "the dispatch row is never
a re-activation …" the comment `It is the run's first entry, and dispatchedAt already measures it.` →
`It is the dispatch, and dispatchedAt already measures it.` Every existing `stallReactivation` row stays green: each one's
first entry is a `planned -> dispatched` row.

- [ ] **Step 4: One clock for the coordinator-ball cap, and the push names it.** After `stallReactivatedAt`, add:

```ts

/** When the coordinator-ball cap's 30 h starts: the run's newest relevant mail, or its re-activation when that is later
 *  (`coord-ball-restarts-on-reactivation` (D-3789)). ONE definition: the verdict times the cap from it, and the push
 *  names it. Null when no relevant mail exists, and then the cap never fires. */
function stallCoordBallFrom(input: StallInput, f: StallFacts): number | null {
  return f.lastExchangeAt === null ? null : Math.max(f.lastExchangeAt, stallReactivatedAt(input));
}
```

In `stallVerdictInner`'s coordinator's-ball step, replace
`    const ballAge = f.lastExchangeAt === null ? 0 : now - Math.max(f.lastExchangeAt, stallReactivatedAt(input));` with:

```ts
    const ballFrom = stallCoordBallFrom(input, f);
    const ballAge = ballFrom === null ? 0 : now - ballFrom;
```

In `stallPushText`, `case 'coord-ball'`, replace:

```ts
      const last = facts.lastExchangeAt ?? n.key;
      const claimant = run.claimedBy === null ? '' : ` ${coordinator}`;
      return {
        title: `⚠ waiting › ${ws}`,
        body: `${label}: the run is waiting on its coordinator${claimant} (worker ${worker}); no mail on the run since ${stallUtc(last)} (${stallSpan(now - last)}).`,
      };
```

with:

```ts
      const last = facts.lastExchangeAt ?? n.key;
      const claimant = run.claimedBy === null ? '' : ` ${coordinator}`;
      // The cap's clock (`stallCoordBallFrom`). After a send-back with no mail since, that is the send-back; the last
      // mail is named too, because it is still true.
      const from = stallCoordBallFrom(input, facts) ?? last;
      const since = from > last
        ? `the run went back to work at ${stallUtc(from)} (${stallSpan(now - from)}) and no mail has crossed it since; the last mail on the run was at ${stallUtc(last)} (${stallSpan(now - last)})`
        : `no mail on the run since ${stallUtc(last)} (${stallSpan(now - last)})`;
      return {
        title: `⚠ waiting › ${ws}`,
        body: `${label}: the run is waiting on its coordinator${claimant} (worker ${worker}); ${since}.`,
      };
```

"Went back to work" says what the clock measured, a re-entry into the active states, and names no actor:
`StallActivation` carries the time only.

- [ ] **Step 5: README.** In the stall-watch paragraph, the line
`once after 30 h with no mail on the run. Every rung is written as a` becomes
`once after 30 h with no mail on the run and no send-back. Every rung is written as a` (in place; the line count does not
move).

- [ ] **Step 6: The R11 pins (items 4 and 5).** These pin behaviour wave 3 shipped, so they are green on arrival; what
makes them red-first is their mutations, each measured GREEN on the tree before the row lands and red after it
(T9-M6, T9-M7, T9-M8). Append to the END of `server/test/stall-bodies.test.ts`:

```ts

// `quiet-restarts-on-reactivation` (D-3788) on r2: its subject span and its silence line read the episode key, which a
// send-back moves, so both count from the send-back (R11's F3).
describe('r2 after a send-back reports the silence from the send-back', () => {
  const H = 3_600_000;
  const REACT = T('2026-09-29T08:00:00Z');   // 10 h after S4's Stop, as the r1 rows above
  const r1: StallNotice = { mode: 'live', arm: 'quiet', rung: 1, key: REACT, at: REACT + 2 * H };
  const back = s4({ activation: { kind: 'reactivated', at: REACT }, arming: escalated, coordinator: 'alive', notices: [r1] });

  it('the verdict sends r2 an hour after the new r1, keyed on the send-back', () => {
    expect(stallVerdict(back, REACT + 3 * H)).toEqual({ act: 'notify', arm: 'quiet', rung: 2, key: REACT, to: 'coordinator', coordinatorId: COORD });
  });

  it('its subject spans the silence since the send-back, and its silence line names the send-back', () => {
    const text = stallReportMail(back, stallFacts(back), r1, null, REACT + 3 * H);
    expect(text.subject).toBe('stall: run 67 — worker silent 3h 0m, stall-check unanswered');
    expect(text.body.split('\n')[1]).toContain('no mail from the worker since 2026-09-29T08:00:00Z (3h 0m).');
  });
});
```

In `server/test/stall-sweep.test.ts`, in wave 3's describe `sweepStalls: a send-back starts the clocks again
(quiet-restarts-on-reactivation)`, immediately before
`  it('a run never sent back keys as before, even when its planned -> dispatched row trails dispatchedAt', async () => {`,
insert:

```ts
  it('after a send-back, r2 cites the new episode\'s r1, never a row recorded under the pre-advance key (R11 F3: stallCitedCheck)', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);          // an alive coordinator, so r2 is sent
    const runId = seedE4(h, coord);
    advanceAt(coord, runId, E4.react, 'working');
    const old = stallDetail('shadow', 'quiet', 1, E4.w2811);   // the census row, under the pre-advance key
    expect(coord.recordStallObservation(runId, old, E4.fire)).toMatchObject({ recorded: true });
    const r1At = E4.react + STALL_QUIET_MS;
    await sweepAt(w, r1At, ARMED);
    await sweepAt(w, r1At + STALL_ESCALATE_MS, ARMED);
    expect(stallRows(coord, runId)).toEqual([old, stallDetail('live', 'quiet', 1, E4.react), stallDetail('live', 'quiet', 2, E4.react)]);
    const r2 = operatorMail(coord).find((m) => m.subject.startsWith(STALL_REPORT_PREFIX));
    expect(r2, 'premise: r2 was sent').toBeDefined();
    const body = (coord.db.prepare('SELECT body FROM mail WHERE id = ?').get(r2!.id) as { body: string }).body;
    expect(body).toContain('Stall check #');           // the live r1 this episode sent
    expect(body).not.toContain('recorded in shadow');   // never the pre-advance shadow row
  });

```

- [ ] **Step 7: Run green.** `./node_modules/.bin/vitest run test/stall-verdict.test.ts test/stall-bodies.test.ts test/readme-holds.test.ts test/stall-vocabulary.test.ts test/stall-sweep.test.ts test/pools-prose.test.ts`
— Expected: 279, 159, 17, 179, 103, 27 passed. Both `tsc` runs clean. The citation instrument: `7 passed | 328 skipped`.

- [ ] **Step 8: Mutations** `T9-M1` … `T9-M8`. **Step 9: Commit.**

```bash
git add server/src/coord/stall.ts README.md server/test/stall-verdict.test.ts server/test/stall-bodies.test.ts server/test/readme-holds.test.ts server/test/stall-sweep.test.ts
git commit -m "fix(stall): re-activation keyed on the dispatch edge; the coordinator-ball push names its clock; r2 pins after a send-back (D-3796)"
```

---

## Handoff gate (after the last task)

- [ ] `git fetch origin main`, merge `origin/main` (never rebase), and re-measure the migration slot (Task 1 Step 1's
  commands, and the open-PR loop). If another branch landed slot `S` first, renumber this entry to the next free slot
  in the same commit as the pins (Task 1 Step 1's list), then re-run Task 1 Steps 7–8.
- [ ] From `server/`, in the foreground, one file per command where the box is loaded: `coord-db`, `asks-store`,
  `stall-store`, `coord-store`, `mail-sweep`, `mail-routes`, `mail-hardening`, `mail-peer-quota`,
  `child-reclaim-mail-store`, `stall-sweep`, `stall-verdict`, `stall-session`, `stall-bodies`, `stall-backoff`,
  `stall-vocabulary`, `hookstate`, `turnmark`, `single-definition`, `topology-clean`, `deviation-refs`, `dtbd`,
  `typecheck-tests`, `update-writer-groups`, `lifecycle-store`, `run-routes`, `coord-health`, `readme-holds`,
  `pools-prose`.
- [ ] The citation instrument: `7 passed | 328 skipped`.
- [ ] `./node_modules/.bin/tsc --noEmit -p .` and `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`: clean.
- [ ] The whole mutation table, in chunks of at most eight rows per command; every row red; `git diff --exit-code` after.
- [ ] Wave-done mail: the measured slot `S`, the suite counts, the mutation results, and any departure by slug.

## Mutation table

Each row edits one site (T6-M3 three, one rename), runs the suites named, restores every file byte for byte and asserts
it. Reds are measured on the replay tree with every task applied. Run in chunks of at most eight rows
(measured 2–60 s a row at load average 30–110).

| Row | Site | Mutation | Measured reds |
|---|---|---|---|
| T1-M1 | migration | drop `mail_by_run` | 5: the coord-db rows "reaches … three indexes", "FRESH", "indexes the columns"; stall-store "a run worker … SEARCH", "hasMailWithSubject" |
| T1-M2 | migration | drop `mail_by_at` | 5: the three coord-db rows; both "both statements SEARCH" rows |
| T1-M3 | migration | drop `mail_deliveries_by_mail` | 8: all five new coord-db rows (`SLOT` is not found), the index-set pin, both "SEARCH" rows |
| T1-M4 | migration | ADD `mail_deliveries_by_to ON mail_deliveries(toId)` | 5: "reaches … exactly its three", the index-set pin, the `hasOutstandingPeerDuplicate`, `outstandingPeerCount`, `outstandingMailFor` rows |
| T1-M5 | migration | `CREATE INDEX IF NOT EXISTS mail_by_at` → `CREATE INDEX mail_by_at` | 1: "IF NOT EXISTS …" |
| T1-M6 | `stallMailFor` | the delivered-to subquery unbounded (today's `where` and `binds`) | 2: both "both statements SEARCH" rows |
| T1-M7 | `stallMailFor` | `WITH sel AS MATERIALIZED` → `WITH sel AS` | 2: both "both statements SEARCH" rows |
| T1-M8 | `stallMailFor` | the bound `at >= ?` → `at > ?` | 1: "selects exactly the rows its predicate names" |
| T2-M1 | `sweepMail` prune | today's one-line prune | 1: "a logged delivery backed off past a sweep …" |
| T2-M2 | `sweepMail` prune | drop the terminal check (`row === null` only) | 1: "the once-only memory forgets a delivery that left the outstanding set" |
| T3-M1 | `stallMailFor` | delete the `mail id` proof's return | 1: "… unrepresentable mail id …" |
| T3-M2 | `stallMailFor` | delete the `delivery id` proof's return | 1: "… unrepresentable delivery id …" |
| T3-M3 | `stallMailFor` | delete the `delivery ackedAt` proof's return | 1: "… unrepresentable delivery ackedAt …" |
| T3-M4 | `stallMailFor` | `deliveredAt`'s kind back to `mail-unreadable` | 1: "… unrepresentable delivery deliveredAt …" |
| T4 | `HookStateRawRead` | add `\| 'stale'` (a `tsc` run, not the runner) | before Task 4: `tsc` errors at `watch.ts` only; after: also `hookstate.ts` TS2741 at `RAW_FAILURE_FOLD` |
| T5-M1 | `turnmark.ts` | `TURN_MARK_EPOCH_MAX = 8.64e15` again | 1: "is spelled on a code line in server/src/coord/stall.ts alone" |
| T6-M1 | `sweepMail` | drop `&& live !== null` | 1: "the busy modes read no marker for a recipient with no live file" |
| T6-M2 | `judgeStallOrphan` | `if (ident === null) return;` → `{ }` | 1: "a registry row whose identity is unmeasured …" |
| T6-M3 | `stall.ts` + test literal | rename `stall-watch-w2-live` → `stall-watch-live-w2` in the marker map, `stallArmingOf` and the MARKERS literal | 1: the wave-2 CONTROL row |
| T8-M1 | `stall.ts` | `STALL_REPORT_PREFIX = 'stall'` | 3: the new prefix row, and two wave-1 spelling rows |
| T9-M1 | `stallReactivation` | today's positional rule (no edge filter, `entries.length < 2`) | 2: the edge row and the reconstructed-run verdict row |
| T9-M2 | `stallReactivation` | drop the edge filter only (`entries.length === 0` kept) | 7: five of wave 3's `stallReactivation` rows ("no events, the dispatch alone …", "the dispatch row is never a re-activation …", "an exit after the re-activation …", "observation rows …", "a fromState this build cannot name …"), Task 9's edge row, and "the first dispatch changes nothing" |
| T9-M3 | `stallCoordBallFrom` | drop the re-activation term | 2: "the later send-back is named …", and wave 3's coord-ball "with it" row |
| T9-M4 | `stallPushText` | `const since = false` (never name the send-back) | 1: "the later send-back is named …" |
| T9-M5 | `README.md` | the line without "and no send-back" | 1: the README coordinator-ball row |
| T9-M6 | `stallReportMail` | r2's subject span from `facts.capKeyMs` | 1: "its subject spans the silence since the send-back …" (green before Task 9's rows) |
| T9-M7 | `watch.ts`, r2's citation | `stallCitedCheck(input, facts.capKeyMs)` | 1: "after a send-back, r2 cites the new episode's r1 …" (green before Task 9's rows) |
| T9-M8 | `stallSilence` | the span from `facts.capKeyMs` | 1: "its subject spans the silence since the send-back …" (green before Task 9's rows) |

The runner, `.superpowers/sdd/2026-10-02-stall-watch-w5-follow-ups/mutate.py` (gitignored, never committed), run from the
repo root as `python3 .superpowers/sdd/2026-10-02-stall-watch-w5-follow-ups/mutate.py . ROW …`:

```python
"""Wave 5's mutation runner. Usage: python3 mutate.py <repo root> [ROW ...]. Each row edits its sites, runs its suites,
restores every file byte for byte, and asserts the restore. A row that stays green is a FAILURE."""
import hashlib, re, subprocess, sys, pathlib, time
ROOT = pathlib.Path(sys.argv[1]).resolve()
ONLY = sys.argv[2:] or None
SC, ST, SL = 'server/src/coord/schema.ts', 'server/src/coord/store.ts', 'server/src/coord/stall.ts'
W, TM = 'server/src/watch.ts', 'server/src/turnmark.ts'
SDT = 'server/test/single-definition.test.ts'
RM = 'README.md'
T1 = ('server', ['test/coord-db.test.ts', 'test/stall-store.test.ts'])
D_IDX = '  CREATE INDEX IF NOT EXISTS mail_deliveries_by_mail ON mail_deliveries(mailId);\n'
WHERE_NEW = ("    const where = `${onRuns}((fromId = ? OR toId = ? OR id IN (SELECT mailId FROM mail_deliveries WHERE toId = ? ` +\n"
             "      'AND mailId IN (SELECT id FROM mail WHERE at >= ?))) AND at >= ?)';\n"
             "    const binds = [...runIds, sessionId, sessionId, sessionId, sinceAt, sinceAt];")
WHERE_OLD = ("    const where = `${onRuns}((fromId = ? OR toId = ? OR id IN (SELECT mailId FROM mail_deliveries WHERE toId = ?)) AND at >= ?)`;\n"
             "    const binds = [...runIds, sessionId, sessionId, sessionId, sinceAt];")
PRUNE_NEW = ("    for (const loggedId of this.busyShadowLogged) {\n      if (outstandingIds.has(loggedId)) continue;\n"
             "      const row = store.delivery(loggedId);\n"
             "      if (row === null || (TERMINAL_DELIVERY_STATES as readonly string[]).includes(row.state)) this.busyShadowLogged.delete(loggedId);\n    }")
PRUNE_OLD = "    for (const loggedId of this.busyShadowLogged) if (!outstandingIds.has(loggedId)) this.busyShadowLogged.delete(loggedId);"
SM = ('server', ['test/stall-store.test.ts'])
MS = ('server', ['test/mail-sweep.test.ts'])
SW = ('server', ['test/stall-sweep.test.ts'])
SD = ('server', ['test/single-definition.test.ts'])
SV = ('server', ['test/stall-vocabulary.test.ts'])
VB = ('server', ['test/stall-verdict.test.ts', 'test/stall-bodies.test.ts'])
RH = ('server', ['test/readme-holds.test.ts'])
BS = ('server', ['test/stall-bodies.test.ts', 'test/stall-sweep.test.ts'])
# (row, [(file, old, new), ...], (package, suites), anchor): `anchor` starts the search after that text
M = [
  ('T1-M1', [(SC, '  CREATE INDEX IF NOT EXISTS mail_by_run ON mail(runId);\n', '')], T1, None),
  ('T1-M2', [(SC, '  CREATE INDEX IF NOT EXISTS mail_by_at ON mail(at);\n', '')], T1, None),
  ('T1-M3', [(SC, D_IDX, '')], T1, None),
  ('T1-M4', [(SC, D_IDX, D_IDX + '  CREATE INDEX IF NOT EXISTS mail_deliveries_by_to ON mail_deliveries(toId);\n')], T1, None),
  ('T1-M5', [(SC, '  CREATE INDEX IF NOT EXISTS mail_by_at ON mail(at);\n', '  CREATE INDEX mail_by_at ON mail(at);\n')], T1, None),
  ('T1-M6', [(ST, WHERE_NEW, WHERE_OLD)], T1, None),
  ('T1-M7', [(ST, "      'WITH sel AS MATERIALIZED (SELECT id,", "      'WITH sel AS (SELECT id,")], T1, None),
  ('T1-M8', [(ST, "      'AND mailId IN (SELECT id FROM mail WHERE at >= ?))) AND at >= ?)';", "      'AND mailId IN (SELECT id FROM mail WHERE at > ?))) AND at >= ?)';")], T1, None),
  ('T2-M1', [(W, PRUNE_NEW, PRUNE_OLD)], MS, None),
  ('T2-M2', [(W, "      if (row === null || (TERMINAL_DELIVERY_STATES as readonly string[]).includes(row.state)) this.busyShadowLogged.delete(loggedId);",
                 "      if (row === null) this.busyShadowLogged.delete(loggedId);")], MS, None),
  ('T3-M1', [(ST, "      if (!id.ok) return { ok: false, kind: 'mail-unreadable', detail: id.detail };\n", '')], SM, '  stallMailFor(sessionId'),
  ('T3-M2', [(ST, "      if (!id.ok) return { ok: false, kind: 'delivery-unreadable', detail: id.detail };\n", '')], SM, '  stallMailFor(sessionId'),
  ('T3-M3', [(ST, "      if (!ackedAt.ok) return { ok: false, kind: 'delivery-unreadable', detail: ackedAt.detail };\n", '')], SM, '  stallMailFor(sessionId'),
  ('T3-M4', [(ST, "      if (!deliveredAt.ok) return { ok: false, kind: 'delivery-unreadable', detail: deliveredAt.detail };\n",
                  "      if (!deliveredAt.ok) return { ok: false, kind: 'mail-unreadable', detail: deliveredAt.detail };\n")], SM, '  stallMailFor(sessionId'),
  ('T5-M1', [(TM, 'const TURN_MARK_EPOCH_MAX = STALL_EPOCH_MAX;', 'const TURN_MARK_EPOCH_MAX = 8.64e15;')], SD, None),
  ('T6-M1', [(W, '        const mark = mailTurnReadsMark(mode) && live !== null\n', '        const mark = mailTurnReadsMark(mode)\n')], MS, None),
  ('T6-M2', [(W, '    if (ident === null) return;\n', '    if (ident === null) { /* T6-M2 */ }\n')], SW, '  private async judgeStallOrphan('),
  ('T6-M3', [(SL, "  'stall-watch-w2-live': 'the wave-2 arms", "  'stall-watch-live-w2': 'the wave-2 arms"),
             (SL, "w2Live: has('stall-watch-w2-live')", "w2Live: has('stall-watch-live-w2')"),
             (SDT, "    ['stall-watch-w2-live', 'server/src/coord/stall.ts'],", "    ['stall-watch-live-w2', 'server/src/coord/stall.ts'],")], SD, None),
  ('T8-M1', [(SL, "export const STALL_REPORT_PREFIX = 'stall:';", "export const STALL_REPORT_PREFIX = 'stall';")], SV, None),
  ('T9-M1', [(SL, "&& e.toState !== STALL_DISPATCH_STATE);\n  if (entries.length === 0) return { kind: 'none' };",
              ");\n  if (entries.length < 2) return { kind: 'none' };")], VB, None),
  ('T9-M2', [(SL, " && e.toState !== STALL_DISPATCH_STATE);", ");")], VB, None),
  ('T9-M3', [(SL, "  return f.lastExchangeAt === null ? null : Math.max(f.lastExchangeAt, stallReactivatedAt(input));",
              "  return f.lastExchangeAt === null ? null : f.lastExchangeAt;")], VB, None),
  ('T9-M4', [(SL, "      const since = from > last", "      const since = false")], VB, None),
  ('T9-M5', [(RM, "once after 30 h with no mail on the run and no send-back. Every rung is written as a",
              "once after 30 h with no mail on the run. Every rung is written as a")], RH, None),
  ('T9-M6', [(SL, "worker silent ${stallSpan(now - facts.episodeKeyMs)}", "worker silent ${stallSpan(now - facts.capKeyMs)}")], BS, None),
  ('T9-M7', [(W, "      const r1 = stallCitedCheck(input, n.key);", "      const r1 = stallCitedCheck(input, facts.capKeyMs);")], BS, None),
  ('T9-M8', [(SL, "  return `since ${since} (${stallSpan(now - facts.episodeKeyMs)})`;", "  return `since ${since} (${stallSpan(now - facts.capKeyMs)})`;")], BS, None),
]
for name, edits, (pkg, files), anchor in M:
    if ONLY and name not in ONLY:
        continue
    saved = {}
    try:
        for f, old, new in edits:
            p = ROOT / f
            if p not in saved:
                saved[p] = p.read_bytes()
            text = p.read_text()
            start = text.index(anchor) if anchor else 0
            assert text.count(old, start) >= 1 and (anchor or text.count(old) == 1), f'{name}: the site is not exactly once in {f}'
            i = text.index(old, start)
            p.write_text(text[:i] + new + text[i + len(old):])
        t0 = time.time()
        r = subprocess.run(['./node_modules/.bin/vitest', 'run', *files], cwd=ROOT / pkg, capture_output=True, text=True, timeout=580)
    finally:
        for p, b in saved.items():
            p.write_bytes(b)
    for p, b in saved.items():
        assert hashlib.sha256(p.read_bytes()).hexdigest() == hashlib.sha256(b).hexdigest(), f'{name}: restore failed'
    out = r.stdout + r.stderr
    summary = re.findall(r'^\s+Tests\s+(.*)$', out, re.M)
    reds = sorted(set(re.findall(r'FAIL\s+(test/[\w.-]+ > .+)', out)))
    print(name, '|', summary[-1] if summary else '?', f'| {time.time() - t0:.0f} s', flush=True)
    for x in reds:
        print('    ', x[:200], flush=True)
    assert reds, f'{name}: GREEN under mutation -- the site has no pin'
```

## Deviations found

Four numbers, issued by the coordinator from the programme's block (the last two at wave-done):

- **D-3794** — `r1-proof-line-names-running-subagents` (Task 7): spec §4.2's example last line of r1's body reads "the
  coordinator is told when your next turn ends without one, and by 02:57Z at the latest; the operator 1 h after that."
  The shipped line adds "and no subagent or workflow of yours is still running" after "without one". Argument: §5.1's
  proof (a), as `stallProofDue` implements it, counts a turn end only when no resuming background kind is still running,
  so the spec's sentence promises an escalation on exactly the legitimate wait the proof was built to exclude. The kinds
  are derived from `STALL_RESUMING_KINDS`, never spelled.
- **D-3796** — `reactivation-first-entry-by-edge` (Task 9): D-3788 (`quiet-restarts-on-reactivation`, wave 3's plan)
  defines the re-activation as the run's newest transition into `ACTIVE_RUN_STATES` from outside them "other than its
  first (the dispatch, which `dispatchedAt` already measures …)". This plan keys the exclusion on the dispatch's EDGE,
  an entry into `dispatched`, not on the first entry's position. Argument: `RUN_TRANSITIONS` has one edge into
  `dispatched` (`planned -> dispatched`), so the edge is exactly the dispatch D-3788 meant to exclude; the position is
  the same thing only when the run's history begins with its dispatch row, and `CoordStore.reconstruct()` rebuilds a
  run with none, whose first send-back the positional rule skipped (keeping the false r1 D-3788 removes). Every run
  with a full history answers exactly as before (every existing row stays green).

- **D-3801** — `w8-it-titles-renumbered` (Task 8, recorded at wave-done): the plan's Task 8 table names `describe`
  titles only. Its execution also renumbered 28 step-prefixed `it` titles in `stall-verdict.test.ts`'s wave-2 §10-order
  describes, so that each names spec §10's step. Titles only; no assertion moved. The wave-1-subset describe's six
  titles kept wave 1's compressed numbers, and its review found the same step number naming two spec steps in one
  file. Wave 6's brief carries those six, titles only, under this number.
- **D-3802** — `d3796-premise-pinned` (final review, recorded at wave-done): one `stall-verdict` row beyond the plan pins
  D-3796's premise. In `RUN_TRANSITIONS` and `REVIEW_RUN_TRANSITIONS`, `planned` is the only state with `dispatched`
  among its targets. It was measured red under an added `awaiting-review -> dispatched` edge in either table.

Two decisions this plan takes against its brief, not against the spec, so they carry no number unless the coordinator
rules otherwise: no index led by `mail_deliveries.toId` (it re-plans eighteen of the 93 captured mail statements, three reads measurably worse),
with `mail(runId)` added beside `mail(at)` and the read reshaped instead; and the blank-claimant minor dropped as
unreachable. Both are argued above with their measurements.

## Self-review (record)

- Brief coverage: Part 1 — a `user_version` migration in `schema.ts` with `CREATE INDEX IF NOT EXISTS`; the slot
  re-measured first against `origin/main` and the open PRs; `EXPLAIN QUERY PLAN` before and after recorded; rows for a
  fresh database, a database at the previous version, each index's existence and columns, and the plans; the coord
  schema suites found and moved (`coord-db`, `asks-store`, the index-set pin; `update-writer-groups`, `lifecycle-store`
  and `run-routes` measured green). `mail(at)` is included because, WITH `mail(runId)` and the materialised statement,
  EXPLAIN shows it chosen in every shape; alone it was chosen in one of four. Part 2 — every candidate the brief named
  re-verified: kept K1, K2, K5, K9, K10 and the MALFORMED/gate comments (verified fixed); dropped the `m.at` window and
  the blank claimant with reasons. The spec's optional `RunHealth.stallNoticedAt` — out of scope by ruling R8.
  Wave 3's three follow-ups (R9) — Task 9, each red-first with its mutation rows; wave 3 review's R11 items — F2 in
  Task 8, F3's two unpinned sites as Task 9's pins (their mutations measured green before the rows and red after); all
  measured on wave 3's tip merged with `origin/main`.
- Spec coverage: §4.2's r1 body (Task 7) and coordinator-ball push (Task 9); §5.1's mail gate (Tasks 2, 6) and marker
  reader (Task 5); §10's evaluation order (Task 8).
- Placeholders: none. D-3794 and D-3796 were issued by the coordinator and are written in.
- Types: `STALL_EPOCH_MAX`, `RAW_FAILURE_FOLD`, `STALL_DISPATCH_STATE`, `stallCoordBallFrom` and the index names
  `mail_by_run`, `mail_by_at`, `mail_deliveries_by_mail` are spelled the same in the tasks, the tests and the runner.
- Rings: no new value import into `stall.ts` (Task 9 adds `RunState` to its type-only import); `store.ts` gains no import; `watch.ts` uses an L0 constant; `shared/` is not
  edited.
