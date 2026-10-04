# Stall watch wave 6: the wave-2 shadow review's fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute, `superpowers:executing-plans`
> (or `superpowers:subagent-driven-development`) with `superpowers:test-driven-development` for every code step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch`, **wave 6 of 6** (ledger `docs/superpowers/programs/stall-watch.md`, ruling R18). Deploy class:
server. One PR from a fresh child workspace.

**Goal:** Fix the four defects the wave-2 shadow review found (ledger "The wave-2 review", G1 to G4), each re-verified
against the tree before this plan was written: the quiet arm sees mail sent to the role `worker`; mail-stuck and
coordinator-deaf stop reporting mail the default mail gate is holding by design; the dialog cap is pushed once per
dialog instead of once per mail episode; a run-less shadow line carries its key, and README stops promising that a
restart repeats a run-less push only "once more".

**Architecture:** Three of the four fixes are L1 changes in `server/src/coord/stall.ts`. G1 adds one predicate,
`stallToWorker`, used by `stallFacts` and r3's text. G2 makes mail-stuck's idle clock follow the gate mode in force,
times coordinator-deaf from the first delivery (or, once a replay has re-stamped `deliveredAt`, from the mail's queue
time), and bounds the gate's hold on a still-queued ball-passing mail at `DELEGATE_CAP_MS + COORD_DEAF_MS`. G3 keys the
dialog cap on its own live stamp and counts any standing dialog-cap row written since that stamp as its push. G2 also
needs the mail gate's mode, which the stall lane already holds in its registry listing, so `watch.ts` (L4) passes it
through `StallArming`, read by `turnidle.ts`'s existing L1 reader; and it needs the delivery row's existing
`replayCount` column, which `store.ts`'s `stallMailFor` (L3) now carries into `StallDeliveryRow`. G4 is one L4 log line
in `watch.ts` plus a README correction. No store method, migration, wire field or marker is added.

**Tech Stack:** TypeScript on Node `>=22.13.0`, Vitest (server package), `node:sqlite` through `CoordStore` (the lane tests'
fixture databases only).

**Spec:** `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` — §4.2 (the ball, the quiet clock, hold 2b and
its dialog cap), §5.2 (the coordinator-deaf and mail-stuck rows, the run-less latches), §6's key list, §10 (evaluation
order). This plan departs from §4.2's dialog-cap key, §5.2's mail-stuck idle clause and coordinator-deaf clock, and the
run-less shadow accounting; see "Deviations found".

**Base:** wave 3's tip `c8555f818a33a131f967d338f6ce658e2d27ef59` (`origin/main` plus PR #228's `stall.ts` changes), with
**wave 5** (`docs/superpowers/plans/2026-10-02-stall-watch-w5-follow-ups.md`) **landed on top**. Wave 6 branches from
`origin/main` after wave 5 merges and never runs in parallel with it: both edit `stall.ts`, its tests and README's
stall-watch section.

**Measured at:** `c8555f818`, 2026-10-03, read-only (`git show c8555f818:<path>`). Every `file:line` below is at that
commit and is a HINT only. Wave 5 (and wave 4, PR #232, which edits README's stall-watch section) move lines, so **every
task's Step 0 re-anchors by content**: each edit quotes the exact text it replaces, and each quoted text must occur
exactly once in its file. Where wave 5 rewrites a line this plan also edits, the quoted text is wave 5's.

**Planner's limit, stated once.** This plan was written read-only. Every red count, green count and mutation result
below is DERIVED by reading the code, not measured. The worker measures each one at execution and reports the measured
numbers in the wave-done mail. A measured number that differs from a derived one is a finding to report. Never edit an
assertion until it passes.

## Preconditions (check before the baseline; stop and report if one fails)

1. **Waves 3 and 5 are on `origin/main`.** Run `git fetch origin main`, then:
   - `git grep -n "export function stallReactivation" origin/main -- server/src/coord/stall.ts` prints one line (wave 3).
   - `git grep -n "function stallCoordBallFrom" origin/main -- server/src/coord/stall.ts` prints one line (wave 5, Task 9).
   - `git grep -n "STALL_EPOCH_MAX" origin/main -- server/src/coord/stall.ts` prints at least one line (wave 5, Task 5).
2. **This plan is on `origin/main`.** `git ls-tree origin/main docs/superpowers/plans/2026-10-03-stall-watch-w6-review-fixes.md`
   prints one line. This plan alone defines D-3797, D-3798, D-3799 and D-3800, and the tasks write each of them into
   tracked code comments. Without the plan on `main`, `deviation-refs`' floor row reds ("a tracked file names a global
   D-ref above the ledger high-water"). The coordinator lands the plan before dispatch.
3. **No migration.** No task changes `coord.db`'s schema, so no `user_version` slot is taken. If a task seems to need
   one, stop and report. Do not add a migration.
4. Merge `origin/main` into this workspace's branch first, then re-anchor (each task's Step 0).

## Global Constraints

- Rings (CLAUDE.md "Rings / bounded contexts"):
  - `stall.ts` stays L1. It has no clock, fs, store or node builtin, and `stall-vocabulary.test.ts` pins that. Its one
    VALUE import stays `../../../shared/api.js`. Task 2 adds a TYPE-only import, `import type { MailTurnMode } from
    '../turnidle.js';`, which `stall-vocabulary`'s "anything else is a type import" row admits.
  - `watch.ts` is L4. It measures and passes, and decides nothing new. Task 2 passes the mode from `mailTurnModeOf`,
    the L1 reader `sweepMail` already uses. Task 4 changes the text of one log line.
  - `store.ts` is L3. Task 2 adds one existing column to `stallMailFor`'s delivery statement and proves it, and narrows
    nothing it received.
- The mail gate's marker names stay spelled in `turnidle.ts` alone (D-3607). `stall.ts` spells none of them, and a test
  that needs one imports the constant (`mail-sweep.test.ts`'s precedent). No marker gains a writer in the tree.
- Mutation-table discipline: every guard ships with a row that is measured red when the guard is deleted or mutated.
  The runner below restores each file byte for byte and asserts the restore. A prose or comment fix needs no row.
- No overloaded null at a seam. `stallDeafMail` answers the time deafness is measured from (`deafSince`) beside the
  mail, so the verdict never re-derives it. `stallMailFor` decides `replayCount`'s zero at the call site, as it decides
  SQL NULL for the nullable columns, so `persistedInt` never answers two conditions with one value.
- Tests run from `server/` (every block that runs a suite or uses `server/`-relative paths starts with `cd "$(git rev-parse --show-toplevel)/server"`, which is idempotent and does not depend on where the previous commit step left the shell), in the FOREGROUND, timeout at least 600000 ms, ONE FILE PER COMMAND:
  `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. A red in a known load flake
  (`session-hook`, `typecheck-tests`, `pr-sweep`, `ccd-ws-gc`, `ccd-session-state`, `ccd-bounded-reads`) is re-run in
  isolation before it is called a break.
- README is in the citation corpus. Every README edit is in place with the same line count. A line may run longer than
  its neighbours, but no line is added or removed. The citation instrument stays `7 passed | 328 skipped`:
  `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.
- `watch.ts` edits are line-neutral (Task 2's arming literal and Task 4's log line change one line each; Task 4's
  docstring bullet is rewritten in place). `server/src/coord/store.ts` cites a `watch.ts` line in a comment, so no line
  is inserted above it.
- New test rows go at the END of their file, or at the end of a named describe where they need its scoped helpers
  (Task 4). They are never inserted between existing rows, so wave 5's anchors in the same files do not move.
- Deviation numbers: exactly four, issued by the coordinator and written in under "Deviations found". Code comments
  cite each by slug and number. Never write a number that was not issued, and never commit a placeholder number
  (`dtbd.test.ts` reds one). Name any further departure in the wave-done mail by slug, and the coordinator assigns its
  number.
- Fixture HOMEs and fixture `coord.db` files only. Nothing reads or writes a live registry or a live `coord.db`.
- Public repo: fixtures use `demo-*` ids; no account label, host name, live session id or docserver URL anywhere.
- Commit on this workspace's own branch only. Merge `origin/main` before handoff; never rebase.
- Out of scope: arming any marker, deploying, the spec's text, the skills, a durable run-less push latch (see "Not in
  this wave").

## Review Focus

1. **The role `worker` on a run that is not this worker's, or with no run at all.** A coordinator's mail to a sibling
   programme's worker, or a run-less mail to the role (the route refuses one, but `StallInput` does not promise it),
   must not move this worker's ball or its quiet clock. Pinned by Task 1's row "the role worker on a run that is not
   the subject's is not the worker's" (mutation T1-M2).
2. **`mail-gate-busy-shadow` armed.** Ledger R18 recommends arming it now. Under it the gate decides `busy` but delivers
   nothing, so mail-stuck must keep holding mail behind a live `busy`. Pinned by Task 2's row "the hold releases under
   exactly the modes whose gate delivers busy" (mutation T2-M3), which derives each mode's answer from `mailTurnIdle`
   itself.
3. **A coordinator wedged at `busy` over a hung subagent, with mail queued to it.** No quiet arm watches a
   coordinator, and the coord-ball cap waits 30 h, so the busy hold must end. Pinned by Task 2's row "the busy hold is
   bounded" (mutation T2-M4).
4. **A coordinator held in a RUNNING turn while the worker's ball-passing mail is still queued behind the gate.** A running
   turn is marker `working` under a live `busy`: a hung foreground call, a blocking wait loop, a long foreground run.
   The coordinator's own mail-stuck never fires on it (`stallIdleStart` answers null), and no frozen arm watches a
   coordinator. So the gate's hold on that mail is bounded: it counts as deaf once `DELEGATE_CAP_MS + COORD_DEAF_MS`
   (about 5 h) has passed since it was queued, not at the 30 h coord-ball cap. The bound applies to a QUEUED (gate-held)
   row only: a row parked before any delivery (`enter-ignored`, the attempt ceiling, a dead recipient) is no gate hold,
   and is timed from its queue as before. Pinned by Task 2's row "an undelivered
   ball-passing mail is deaf from DELEGATE_CAP_MS + COORD_DEAF_MS after it was queued" (mutation T2-M7 reds the push at
   the bound, T2-M9 the hold under it, T2-M13 the parked row's clock). The cap past 30 h is pinned by "past 30 h the coord-ball cap still fires".
5. **A dialog already pushed by the build before this one when wave 6 deploys.** That row sits on the episode key, and
   the new key is the dialog's live stamp. The dialog must not be pushed a second time (run 67 stood exactly so on
   2026-10-03), and neither must a dialog whose key a coordinator `wait:` moved while it stood. Pinned by Task 3's rows
   "a row on the episode key written after the live stamp reported this dialog" and "a coordinator wait: to the role
   worker while the dialog stands …" (mutation T3-M2).
6. **A coordinator idle with the mail typed into its pane, never acking it, while the sweep replays it.** Every replay
   re-stamps `deliveredAt` (every `MAIL_REPLAY_MS`, 10 min), so a clock on that column would not run out until the
   replay ceiling parks the row. Coordinator-deaf must still be recorded an hour after the mail was queued. Pinned by
   Task 2's lane row "is recorded an hour after the question was queued, while the newest deliveredAt is under ten
   minutes old" (mutations T2-M10 and T2-M11).

---

## The defects, re-verified (at `c8555f818`, from the verifiers' reports and the code)

None of the four was refuted, so no issued number is dropped.

- **G1 — mail to the role `worker` is invisible to the ball.** `stallFacts` matches mail to the worker by
  `m.toId === workerId` (`stall.ts:632`, `:634`). The mail route stores the `toId` the sender wrote (`routes.ts:921-924`),
  and only the delivery row gets the resolved session. The coordinator skill tells every coordinator to address the
  worker as `toId: 'worker'` with the run's id (`ccd/coordinator-skill/SKILL.md:474`). So after a worker's wave-done or
  question, a fix round or an answer sent to the role leaves the ball with the coordinator. Step (10) then answers
  `none` for 30 h, and the quiet arm never runs. The same literal hides an alias `wait:` (`waitLast` comes from
  `relevant`), leaves `inboundLast` stale in r1's and r2's bodies and in `stallOwed`, and makes r3's text say "No mail
  from its coordinator to the worker since the report" (`:1255`). The `coordinator` alias is honoured (`stallCoordinatorIds`,
  `:614-618`), and the `worker` alias is not. Measured (live `coord.db`, read-only, 2026-10-03T12:19Z): 23 mails to
  the role since 2026-09-25, from 3 coordinators, 12 of which landed on a coordinator ball (6 fix rounds, 1 resume, 5
  answers to a question). Run 238 sat 8.7 h after its fix round with no quiet row.
- **G2 — gate-held mail reported as stuck or deaf.** `stallIdleStart` (`:1638-1643`) falls back to the current marker's
  `stopAt` under any live word, `busy` included. Under the default `shell` gate, `mailTurnIdle` refuses `busy` by
  design, and only `mail-gate-busy` delivers on `busy` over a done marker. `stallDeafMail` (`:826-834`) counts an
  UNDELIVERED delivery as unacked, and step (10) times it from the mail's queue time (`:996-998`). Measured: all 5
  wave-2 shadow fires of either arm on 2026-10-02 (4 mail-stuck, 1 coord-deaf) were mail held by the default gate while
  the recipient idled over a progressing subagent or workflow. Replayed under this plan's rules, none fires.
- **G3 — the dialog cap fires once per mail episode, not per dialog.** Hold 2b dedupes and keys on `f.capKeyMs`
  (`:968`, `:973`), which moves only on the worker's own mail, a coordinator `wait:` or the dispatch. The 2 h threshold
  does restart per dialog (`capQuietSince` includes the live stamp, `:686-688`), but the dedupe then finds the first
  dialog's row, so a second dialog in one episode is never pushed. Measured: run 174's second permission prompt has
  stood since 2026-10-02T19:38:19Z with no row possible. The push text (`:1305-1308`) prints the episode's age, not the
  dialog's. The live stamp is the dialog's onset: `watch.ts:3235` passes `statusUpdatedAt`, which Claude Code rewrites
  only when the word changes. The hookstate `updatedAt` is NOT the onset. Any later hook event restamps it while the
  prompt stands (measured +15 s and +20 s on runs 174 and 67).
- **G4 — run-less latches are in memory, and the shadow line omits its key.** The run-less shadow line
  (`watch.ts:3407`) is deduped by an in-memory warn-once set and leaves `v.key` out of its text. Every restart re-logs
  the same episode, and nothing in the line tells a census the repeat from a new episode (S1: 3 lines for 1 episode
  across two restarts on 10-02). The live run-less operator pushes latch in memory too (`watch.ts:3436-3437`; D-3751).
  README (`:2677-2681`) says "A restart may push each once more. The tag collapses the two on the phone". The push in
  fact repeats on EVERY restart while the condition stands, and `push-sw.js` re-alerts on a same-tag push
  (`renotify`). Live exposure today is zero, because every one of those rungs needs `stall-watch-w2-live` plus
  escalate, and neither is armed.

## File Structure

- `server/src/coord/stall.ts`
  - Task 1: `STALL_WORKER_ROLE` and `stallToWorker`, used in `stallFacts` and `stallStillSilent`.
  - Task 2: the type import, `StallArming.mailMode`, `StallDeliveryRow.replayCount`, `stallIdleStart`, `stallDeafMail`
    and the coord-deaf step, and two arm glosses.
  - Task 3: `dialogKey`, `stallDialogCapDone`, the dialog-cap push text, one arm gloss, and four docstrings.
- `server/src/coord/store.ts`
  - Task 2: `stallMailFor`'s delivery statement carries `replayCount`.
- `server/src/watch.ts`
  - Task 2: the stall lane's `arming` literal.
  - Task 4: the run-less shadow line, and one docstring bullet.
- `README.md`, the stall-watch sections, all in place:
  - Task 2: the coordinator-deaf and mail-stuck bullets.
  - Task 3: the dialog clause.
  - Task 4: the latch bullet and the runbook sentence.
- Tests:
  - `server/test/stall-verdict.test.ts` (Tasks 1–3)
  - `server/test/stall-bodies.test.ts` (Tasks 1–3; Task 2 only its `deliveryOf` helper)
  - `server/test/stall-session.test.ts` (Task 2)
  - `server/test/stall-sweep.test.ts` (Tasks 1–4)
  - `server/test/stall-store.test.ts` (Task 2)
- `.superpowers/sdd/2026-10-03-stall-watch-w6-review-fixes/mutate.py` — the mutation runner (gitignored; never
  committed).

**Citations this moves.** `stall.ts` gains lines in Tasks 1–3, and `store.ts` gains four in Task 2. README and the two
compaction-card documents (the citation instrument's whole corpus) cite no `stall.ts` or `store.ts` line (measured at
`c8555f818`). Wave 6 re-measures it with
`git grep -nE '(stall|store)\.ts:[0-9]' -- README.md docs/superpowers/specs/*compaction* docs/superpowers/plans/*compaction*`,
which must print nothing from the corpus. `watch.ts` edits are line-neutral. README edits keep its line count.

## Baseline (the step before Task 1)

- [ ] **Baseline: measure every suite this plan touches, on the merged tree, before any edit.** From `server/`, one file
  per command, foreground:

```bash
cd "$(git rev-parse --show-toplevel)/server" && npm ci
for f in stall-verdict stall-bodies stall-session stall-sweep stall-backoff stall-vocabulary stall-store \
         single-definition mail-routes mail-sweep mail-hardening turnidle readme-holds topology-clean dtbd typecheck-tests pools-prose; do
  ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^\s+Tests\s' | sed "s/^/$f: /"
done
git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts 2>&1 | grep -E '^\s+Tests\s'
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' 2>&1 | grep -E '^\s+Tests\s'
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-clean
```

Record each count. For reference, wave 5's plan measured these after wave 5 on its replay tree: `stall-verdict` 279,
`stall-bodies` 159, `stall-session` 89, `stall-sweep` 103, `stall-vocabulary` 179, `readme-holds` 17,
`single-definition` 261, `stall-backoff` 17, `stall-store` 65, and the citation instrument `7 passed | 328 skipped`. Every count below is
a DELTA from the number recorded here. Any red at baseline is reported before Task 1 starts.

---

### Task 1: Mail to the role `worker` on the run is the worker's (G1, D-3797)

**Files:**
- Modify: `server/src/coord/stall.ts`
  - new helper after `stallCoordinatorIds` (`:612-618`)
  - `stallFacts`'s mail lines (`:632-634`)
  - `stallStillSilent` (`:1255`)
- Test: `server/test/stall-verdict.test.ts`, `server/test/stall-bodies.test.ts`, `server/test/stall-sweep.test.ts`
  (each appended at the end)

**Interfaces:**
- Consumes: `StallMailRow`, `StallRunRow`, `stallCoordinatorIds`, `newestMail`, `isWatchNotice` (all in `stall.ts`).
- Produces (module-private in `stall.ts`; Task 3 relies on `stallFacts`' unchanged signature):
  - `const STALL_WORKER_ROLE = 'worker'`
  - `function stallToWorker(m: StallMailRow, workerId: string, runs: readonly StallRunRow[]): boolean`
  - `stallFacts(input: StallInput): StallFacts`, signature unchanged. `inboundLast`, `ball`, `lastExchangeAt` and (through
    an alias `wait:`) `capKeyMs`/`episodeKeyMs` now count role mail.

- [ ] **Step 0: Re-anchor.** From the repo root, each command prints exactly one line:

```bash
grep -nF "function stallCoordinatorIds(runs: readonly StallRunRow[]): ReadonlySet<string> {" server/src/coord/stall.ts
grep -nF "  const relevant = input.mail.filter((m) => !isWatchNotice(m) && (m.fromId === workerId || m.toId === workerId));" server/src/coord/stall.ts
grep -nF "  const inboundLast = newestMail(relevant, (m) => m.toId === workerId);" server/src/coord/stall.ts
grep -nF "  const coordinatorMail = newestMail(input.mail, (m) => m.toId === run.sessionId && coordinatorIds.has(m.fromId) && m.id > report.id);" server/src/coord/stall.ts
```

- [ ] **Step 1: Write the failing tests.**

1a. Append to the END of `server/test/stall-verdict.test.ts`. It uses this file's module-level `t`, `H`, `MIN`,
`WORKER`, `COORD`, `mailRow`, `stallInput`, `workerAt`, `liveWord`, `r1`, `NONE`, `W2_LIVE`, `w2` and `markOf`.

```ts

// ── fix-round-alias-reaches-the-ball (D-3797): mail to the role `worker` on the subject's run is mail to the worker ──
// The mail route stores the toId the sender wrote, and the coordinator skill addresses the worker as `toId: 'worker'`
// with the run's id; `resolveWorker(runId)` resolved it to this session. Measured (live coord.db, 2026-10-03): 12 of the
// 23 role mails since 2026-09-25 landed on a coordinator ball, fix rounds and answers alike.
describe('fix-round-alias-reaches-the-ball (D-3797): the role worker on the subject\'s run is mail to the worker', () => {
  const D = t('2026-09-10T08:00:00Z');
  const primary: Partial<StallRunRow> = { id: 31, dispatchedAt: D };
  const facts = (mail: StallMailRow[]) => stallFacts(stallInput({ primary, mail, worker: workerAt({ live: liveWord('idle', D + 5 * H) }) }));
  const own = mailRow(3001, D + H, WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT, 31);

  it('CONTROL: after the worker\'s wave-done the ball is the coordinator\'s', () => {
    expect(facts([own])).toMatchObject({ ball: 'coordinator', inboundLast: null, lastExchangeAt: D + H });
  });

  it('a fix-round addressed to the role worker on the run hands the ball back, and is the newest mail to it', () => {
    const fix = mailRow(3007, D + 3 * H, COORD, 'worker', 'status', 'fix-round', 31);
    expect(facts([own, fix])).toMatchObject({
      ball: 'worker', inboundLast: fix, workerLast: own, episodeKeyMs: D + H, capKeyMs: D + H, lastExchangeAt: D + 3 * H,
    });
  });

  it('an answer to the role worker after the worker\'s question hands the ball back', () => {
    const q = mailRow(3001, D + H, WORKER, 'coordinator', 'question', 'which base?', 31);
    const ans = mailRow(3002, D + 2 * H, COORD, 'worker', 'answer', 'use base B', 31);
    expect(facts([q])).toMatchObject({ ball: 'coordinator' });
    expect(facts([q, ans])).toMatchObject({ ball: 'worker', inboundLast: ans, lastExchangeAt: D + 2 * H });
  });

  it('the role worker on a run that is not the subject\'s is not the worker\'s, and neither is run-less mail to the role', () => {
    const foreign = mailRow(3008, D + 3 * H, COORD, 'worker', 'status', 'fix-round', 99);
    const runless: StallMailRow = { ...mailRow(3009, D + 3 * H, COORD, 'worker', 'status', 'fix-round', 31), runId: null };
    expect(facts([own, foreign])).toMatchObject({ ball: 'coordinator', inboundLast: null, lastExchangeAt: D + H });
    expect(facts([own, runless])).toMatchObject({ ball: 'coordinator', inboundLast: null, lastExchangeAt: D + H });
  });

  it('a coordinator wait: addressed to the role worker keeps the ball with the coordinator and moves the key', () => {
    const status = mailRow(3001, D + H, WORKER, 'coordinator', 'status', 'Task 2 pushed', 31);
    const wait = mailRow(3006, D + 3 * H, COORD, 'worker', 'status', `${STALL_WAIT_PREFIX} CI on #201`, 31);
    expect(facts([status, wait])).toMatchObject({ ball: 'coordinator', episodeKeyMs: D + 3 * H, capKeyMs: D + 3 * H });
  });

  it('run 238\'s shape: a fix round to the role worker after a wave-done and a send-back draws r1 two hours after the brief', () => {
    const react = D + 9 * H;
    const fix = mailRow(3010, react + 30_000, COORD, 'worker', 'status', 'fix-round', 31);
    const input = (mail: StallMailRow[]): StallInput => stallInput({
      primary, mail, worker: workerAt({ live: liveWord('idle', D + H + 5 * MIN) }), activation: { kind: 'reactivated', at: react },
    });
    expect(stallVerdict(input([own, fix]), react + 30_000 + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(input([own, fix]), react + 30_000 + STALL_QUIET_MS)).toEqual(r1(react));
    expect(stallVerdict(input([own]), react + 30_000 + STALL_QUIET_MS), 'CONTROL: with no brief the ball stays the coordinator\'s').toEqual(NONE);
    // The marker ladder reads the same facts: under the w2 marker, from the worker's Stop, r1 falls due at the same time.
    const marked: StallInput = { ...input([own, fix]), arming: W2_LIVE, w2: w2({ mark: markOf({ at: D + H + 5 * MIN, turnAt: D + H, stopAt: D + H + 5 * MIN }) }) };
    expect(stallVerdict(marked, react + 30_000 + STALL_QUIET_MS)).toEqual(r1(react));
  });
});
```

1b. Append to the END of `server/test/stall-bodies.test.ts`. It uses this file's module-level `T`, `mail`, `m2509`,
`m2510`, `s4`, `R1_AT`, `R2_AT`, `R3_AT`, `EPISODE`, `restamped`, `check2531`, `r1`, `r2In`, `escalated`, `COORD` and
`WORKER`.

```ts

// `fix-round-alias-reaches-the-ball` (D-3797): mail to the role `worker` on the run is the worker's, in every text that reads it.
describe('mail to the role worker is mail to the worker, in r1\'s body and r3\'s text', () => {
  it('r1 names an answer sent to the role worker as the newest mail to the worker, and owes the reply to it', () => {
    const q = mail(2511, T('2026-09-28T21:20:00Z'), WORKER, 'coordinator', 'question', 'which base');
    const ans = mail(2512, T('2026-09-28T21:30:00Z'), COORD, 'worker', 'answer', 'base B');
    const input = s4({ mail: [m2509, m2510, q, ans] });
    const text = stallCheckMail(input, stallFacts(input), R1_AT);
    expect(text.body).toContain('Newest mail to you on this run: #2512 answer at 21:30:00Z.');
    expect(text.subject).toBe('stall-check: run 67 — quiet 2h 0m, owed: reply to #2512');
  });

  it('r3 still-silent counts the coordinator\'s mail to the role worker after the report', () => {
    const r2Text = stallReportMail(r2In, stallFacts(r2In), r1, null, R2_AT);
    const report = mail(2540, R2_AT, 'operator', COORD, 'status', r2Text.subject);
    const r2: StallNotice = { mode: 'live', arm: 'quiet', rung: 2, key: EPISODE, at: R2_AT };
    const resume = mail(2541, T('2026-09-29T01:10:20Z'), COORD, 'worker', 'answer', 'resume');
    const input = s4({ worker: restamped, mail: [m2509, m2510, check2531, report, resume], notices: [r1, r2], arming: escalated, coordinator: 'alive' });
    const n: StallNotify = { act: 'notify', arm: 'quiet', rung: 3, key: EPISODE, to: 'operator', because: 'still-silent' };
    const { body } = stallPushText(input, stallFacts(input), n, R3_AT);
    expect(body).toContain('Its coordinator last mailed the worker at 01:10Z.');
    expect(body).not.toContain('No mail from its coordinator');
  });
});
```

1c. Append to the END of `server/test/stall-sweep.test.ts`. It uses this file's `rig`, `seedLiveState`, `at`, `fleetRow`,
`tickOf`, `operatorMail`, `stallRows`, `stallDetail`, `LIVE`, `WORKER`, `COORD`, `UUID` and `COORD_UUID`.

```ts

// ── fix-round-alias-reaches-the-ball (D-3797): the lane carries a mail to the role `worker` to the verdict ─────────────
// Run 238's measured shape (2026-10-02/03, the times as recorded): the worker's wave-done, the run sent back, and the
// fix-round brief to the role `worker` 29 s after the advance. The real store read (`stallMailFor`'s run arm) must
// carry the role mail end to end.
describe('sweepStalls: a fix round addressed to the role worker after a wave-done (run 238)', () => {
  it('draws r1 two hours after the brief, keyed on the send-back', async () => {
    const { h, coord, w } = await rig();
    const D0 = Date.parse('2026-10-02T20:00:00Z');        // chosen: the dispatch
    const WD = Date.parse('2026-10-02T23:56:31Z');        // the worker's wave-done
    const STOP = WD + 120_000;                             // chosen: the worker's Stop two minutes later
    const REACT = Date.parse('2026-10-03T03:16:47Z');     // awaiting-review -> working
    const BRIEF = Date.parse('2026-10-03T03:17:16Z');     // the fix-round brief, to the role worker
    seedLiveState(h.home, { statusUpdatedAt: STOP });
    at(D0);
    const opened = coord.openRun({ program: 'demo-program', title: 'demo-program', project: 'demo', wave: 1, waveOf: 2, claimedBy: COORD });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    const runId = opened.id;
    coord.markDispatched(runId, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, D0);
    const adv = (ms: number, to: Parameters<CoordStore['advance']>[1]): void => {
      at(ms);
      const r = coord.advance(runId, to, 'coordinator');
      if (!r.ok) throw new Error(`advance refused: ${JSON.stringify(r)}`);
    };
    adv(D0, 'dispatched');
    adv(D0 + 60_000, 'working');
    at(WD);
    coord.insertMail({ fromId: WORKER, fromUuid: UUID, toId: 'coordinator', runId, kind: 'status', subject: WAVE_DONE_SUBJECT, body: 'b', artifacts: [] });
    adv(WD + 60_000, 'awaiting-review');
    adv(REACT, 'working');
    at(BRIEF);
    coord.insertMail({ fromId: COORD, fromUuid: COORD_UUID, toId: 'worker', runId, kind: 'status', subject: 'fix-round', body: 'b', artifacts: [] });
    at(BRIEF + STALL_QUIET_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);
    at(BRIEF + STALL_QUIET_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([WORKER]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, REACT)]);
  });
});
```

- [ ] **Step 2: Run them red, one file per command.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-verdict.test.ts
./node_modules/.bin/vitest run test/stall-bodies.test.ts
./node_modules/.bin/vitest run test/stall-sweep.test.ts
```

Expected (derived):
- `stall-verdict`: 4 failed. They are "a fix-round …" (`ball` reads `coordinator`), "an answer …", "a coordinator wait:
  …" (`ball` `worker`, key `D + H`) and "run 238's shape …" (`NONE` where r1 is due).
- The CONTROL and "… not the subject's …" rows are green before and after. They pin the guard, and T1-M2 reds them.
- `stall-bodies`: 2 failed. r1's newest mail reads `#2510`, and r3 reads "No mail from its coordinator …".
- `stall-sweep`: 1 failed (no stall-check, ball the coordinator's).

- [ ] **Step 3: Implement in `server/src/coord/stall.ts`.**

3a. Immediately after `stallCoordinatorIds`'s closing brace (the function that ends `  return ids;\n}`), insert:

```ts

/** The role id the mail route resolves to a run's own worker (`routes.ts` check 7, `resolveWorker(runId)`), as
 *  `stallCoordinatorIds`' `coordinator` is the coordinator's. */
const STALL_WORKER_ROLE = 'worker';

/** Mail addressed to the subject's worker: its session id, or the `worker` role on one of the subject's runs, which
 *  the mail route resolved to this very session (`fix-round-alias-reaches-the-ball` (D-3797)). Every subject run
 *  carries the worker's `sessionId` (`stallSubjects` groups by it), and a re-bind re-issues the role's mail to the
 *  heir. Run-less mail to the role names no run, so it is no one's. One definition, for `stallFacts` and r3's text. */
function stallToWorker(m: StallMailRow, workerId: string, runs: readonly StallRunRow[]): boolean {
  return m.toId === workerId || (m.toId === STALL_WORKER_ROLE && m.runId !== null && runs.some((r) => r.id === m.runId));
}
```

3b. In `stallFacts`, replace:

```ts
  const relevant = input.mail.filter((m) => !isWatchNotice(m) && (m.fromId === workerId || m.toId === workerId));
  const workerLast = newestMail(relevant, (m) => m.fromId === workerId);
  const inboundLast = newestMail(relevant, (m) => m.toId === workerId);
```

with:

```ts
  const toWorker = (m: StallMailRow): boolean => stallToWorker(m, workerId, runs);
  const relevant = input.mail.filter((m) => !isWatchNotice(m) && (m.fromId === workerId || toWorker(m)));
  const workerLast = newestMail(relevant, (m) => m.fromId === workerId);
  const inboundLast = newestMail(relevant, toWorker);
```

`waitLast`, `last`, `lastExchangeAt`, `ball`, `capKeyMs` and `episodeKeyMs` follow with no further edit.
`ballToCoordinator` is unchanged: mail TO the worker gives the coordinator the ball only as a coordinator `wait:`.

3c. In `stallStillSilent`, replace:

```ts
  const coordinatorMail = newestMail(input.mail, (m) => m.toId === run.sessionId && coordinatorIds.has(m.fromId) && m.id > report.id);
```

with:

```ts
  const coordinatorMail = newestMail(input.mail, (m) => stallToWorker(m, run.sessionId, input.subject.runs) && coordinatorIds.has(m.fromId) && m.id > report.id);
```

Left alone, deliberately: `stallLastCheck` and `stallBackoff`'s check lookup match the watch's OWN `stall-check:` mail,
which `queueStallNotice` always addresses to the session id. A role arm there would be a branch no input reaches.

- [ ] **Step 4: Run green.** The three commands of Step 2. Expected deltas from the baseline: `stall-verdict` +6,
`stall-bodies` +2, `stall-sweep` +1, all green. Then `stall-vocabulary`, `single-definition` and `mail-routes` (the
coord kebab scan; `'worker'` is not kebab) each green at baseline. Both `tsc` runs clean.

- [ ] **Step 5: README.** No edit. "the newest mail between the worker and anyone but itself" and "ANY mail to the
worker on the run" already describe the fixed behaviour.

- [ ] **Step 6: Mutations** T1-M1 to T1-M5 (the table below). Every row red.

- [ ] **Step 7: Commit.**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/stall.ts server/test/stall-verdict.test.ts server/test/stall-bodies.test.ts server/test/stall-sweep.test.ts
git commit -m "fix(stall): mail to the role worker on the run is the worker's, for the ball, the clocks and r3 (D-3797)"
```

---

### Task 2: Mail the gate holds by design is neither stuck nor deaf (G2, D-3798)

**Files:**
- Modify: `server/src/coord/stall.ts`
  - the import block (`:1-2`), the `coord-deaf` and `mail-stuck` glosses (`:61-62`), `StallArming` and its docstring
    (`:120-123`), `StallDeliveryRow` and its docstring (`:186-188`)
  - `stallDeafMail` (`:822-834`) and the coord-deaf step in `stallVerdictInner` (`:996-999`)
  - `stallIdleStart` (`:1636-1643`)
- Modify: `server/src/coord/store.ts` — `stallMailFor`'s delivery statement (`:3909-3916`) and its delivery loop
  (`:3920-3933`): three lines edited in place, four inserted. Written against wave 5's text (its Task 3 turns the
  delivery loop's failure kind into `delivery-unreadable`; its Task 1 leaves the delivery statement as it is).
- Modify: `server/src/watch.ts` — the stall lane's `arming` literal (`:3029`), one line in place.
- Modify: `README.md` — the coordinator-deaf and mail-stuck bullets (`:2622-2627`), in place, six lines for six.
- Test: `server/test/stall-session.test.ts`
  - its `delivery` helper (`:75`) gains `replayCount: 0`
  - two existing rows (`:634`, `:636`) re-scoped
  - one import line extended, and one import line added
  - a describe appended
- Test: `server/test/stall-verdict.test.ts` — its `delivery` helper (`:827`) gains `replayCount: 0`; four existing rows
  (`:1017-1019`, `:1417`) re-timed; a describe appended.
- Test: `server/test/stall-bodies.test.ts` — its `deliveryOf` helper (`:564`) gains `replayCount: 0`. No row changes.
- Test: `server/test/stall-store.test.ts` — four `stallMailFor` output pins (`:640-641`, `:659-662`) gain
  `replayCount: 0`; a describe appended.
- Test: `server/test/stall-sweep.test.ts` — one import line extended, one import line added; two describes appended.

**Interfaces:**
- Consumes: `MailTurnMode` (type) and `mailTurnModeOf(listing: readonly string[]): MailTurnMode` from
  `server/src/turnidle.ts`; `DELEGATE_CAP_MS`, `COORD_DEAF_MS` and `MAIL_STUCK_MS` (`stall.ts`); the
  `mail_deliveries.replayCount` column (`schema.ts:151`, `INTEGER NOT NULL DEFAULT 0`), written only by
  `CoordStore.bumpReplayCount`, which `sweepMail` calls after `markDelivered` on a REPLAY only (`watch.ts:4299-4311`;
  the first delivery, `d.deliveredAt === null`, never counts).
- Produces:
  - `StallArming.mailMode?: MailTurnMode` (exported interface). Absent reads `shell`.
  - `StallDeliveryRow.replayCount: number` (exported interface, REQUIRED, so every literal is a compile error until it
    carries one). `stallMailFor` fills it; the three test helpers default it to `0`.
  - module-private `stallDeafMail(input: StallInput, deliveries: readonly StallDeliveryRow[]): { readonly mail: StallMailRow; readonly deafSince: number } | null`.
    `deafSince` is the time coord-deaf's `COORD_DEAF_MS` runs from: the delivery while `replayCount === 0`, the mail's
    queue time once replayed, and the queue time plus `DELEGATE_CAP_MS` while queued and undelivered (a row parked before any delivery is timed from its queue).

- [ ] **Step 0: Re-anchor.** Each prints exactly one line:

```bash
grep -nF "export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean; readonly w2Live?: boolean; readonly mailDisabled?: boolean }" server/src/coord/stall.ts
grep -nF "  return m !== null && (m.state === 'done' || m.state === 'failed') ? m.stopAt : null;" server/src/coord/stall.ts
grep -nF "function stallDeafMail(input: StallInput, deliveries: readonly StallDeliveryRow[]): StallMailRow | null {" server/src/coord/stall.ts
grep -nF "    if (deaf !== null && now - deaf.at >= COORD_DEAF_MS && rungDoneAt(input, 'coord-deaf', 1, deaf.id) === null) {" server/src/coord/stall.ts
grep -nF "const arming: StallArming = { ...stallArmingOf(names), mailDisabled: names.includes(MAIL_DISABLED_MARKER) };" server/src/watch.ts
grep -nF "  its coordinator is unacked for 1 h. One \`⚠ coordinator deaf\` push." README.md
grep -nF "readonly lastGate: string | null; readonly gateSince: number | null }" server/src/coord/stall.ts
grep -nF "      'CAST(gateSince AS TEXT) AS gateSinceText ' +" server/src/coord/store.ts
grep -nF "        ackedAtText: string | null; lastGate: string | null; gateSinceText: string | null }[];" server/src/coord/store.ts
grep -nF "      if (!gateSince.ok) return { ok: false, kind: 'delivery-unreadable', detail: gateSince.detail };" server/src/coord/store.ts
grep -nF "        ackedAt: ackedAt.value, lastGate: d.lastGate, gateSince: gateSince.value });" server/src/coord/store.ts
grep -nF "  parseStallDetail, stallDetail," server/test/stall-sweep.test.ts
grep -cF "lastGate: null, gateSince: null }," server/test/stall-store.test.ts      # a count: prints 3
```

The fourth `store.ts` line is wave 5's (its Task 3). If it prints nothing, wave 5 has not landed: stop (Precondition 1).
Measure before editing, once, so the clock argument below is the tree's and not this plan's. From the repo root:

```bash
git grep -n -i -e replaycount -e 'deliveredAt = ?' -e 'markDelivered(' -- server/src
```

Expected hits (comments that mention a name count too):
- `schema.ts`: the `replayCount` column;
- `store.ts`: the health read's `MAX(d.replayCount)`; `bumpReplayCount`'s docstring, signature, `UPDATE … SET replayCount =
  replayCount + 1` and read-back; `markDelivered`'s definition and its `UPDATE … deliveredAt = ?`; two other docstrings
  that cite `bumpReplayCount` by name (`MarkAckedResult`'s, and `markAcked`'s result note);
- `watch.ts`: `sweepMail`'s single `markDelivered` call, then `bumpReplayCount` behind `if (d.deliveredAt !== null)`, then
  the ceiling check on `bumped.replayCount`.

Stop and report only if an `UPDATE` or `INSERT` that writes `replayCount` or `deliveredAt` appears outside
`bumpReplayCount` and `markDelivered`, or a second caller of either appears. The `replayCount === 0` reading below
assumes zero means "never replayed", and that `markDelivered` is the only writer of `deliveredAt`.

- [ ] **Step 1: Write the failing tests.**

1a. `server/test/stall-session.test.ts`, in its value import from `../src/coord/stall.js`, replace the line
`  STOP_FAILURE_ERRORS, stallVerdict,` with `  STOP_FAILURE_ERRORS, stallVerdict, DELEGATE_CAP_MS,`. Immediately after the
closing `} from '../src/coord/stall.js';` of the TYPE import block (the second import from that module), add:

```ts
import { mailTurnIdle, type MailTurnMode } from '../src/turnidle.js';
```

In its `delivery` helper, replace `lastGate: null, gateSince: null, ...over };` (once in the file) with
`lastGate: null, gateSince: null, replayCount: 0, ...over };`. Do the same in `server/test/stall-verdict.test.ts`'s
`delivery` helper (the same text, once there), and in `server/test/stall-bodies.test.ts`'s `deliveryOf` replace
`lastGate: null, gateSince: null, ...over,` (once) with `lastGate: null, gateSince: null, replayCount: 0, ...over,`.
Every existing row keeps its meaning: none of them was replayed.

1b. In the same file, describe `mail-stuck (§5.2): per queued delivery to a run worker or a coordinator`, replace the two
lines:

```ts
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy }), NOW), 'busy with a current done mark').toEqual([stuck()]);
```

```ts
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, mark: failedMark }), NOW), 'busy with a current failed mark').toEqual([stuck()]);
```

with, respectively:

```ts
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, arming: { ...W2, mailMode: 'busy' } }), NOW), 'busy with a current done mark, under mail-gate-busy (D-3798)').toEqual([stuck()]);
```

```ts
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, mark: failedMark, arming: { ...W2, mailMode: 'busy' } }), NOW), 'busy with a current failed mark, under mail-gate-busy (D-3798)').toEqual([stuck()]);
```

(Each now pins the release arm. Under the default gate the same inputs hold, which the describe below pins.)

1c. Append to the END of `server/test/stall-session.test.ts`:

```ts

// ── gate-held-mail-is-not-stuck (D-3798): mail-stuck's idle clock follows the mail gate in force ─────────────────────
// Only `mail-gate-busy` delivers on a live `busy` over a finished turn (`turnidle.ts`'s `mailTurnIdle`). Under every other
// mode the gate holds that mail by design while background work runs, so the clock starts DELEGATE_CAP_MS after the Stop.
describe('mail-stuck under the mail gate in force (gate-held-mail-is-not-stuck (D-3798))', () => {
  const STOP = NOW - 2 * H;
  const doneAt = (stopAt: number): TurnMarkRead => mark({ at: stopAt, turnAt: stopAt - 10 * MIN, stopAt });
  /** A worker whose turn ended at `stopAt` and whose live word has read busy since five minutes later: a main loop
   *  idling over a background subagent. One brief, queued at `mailAt`, still queued. */
  const busyOver = (stopAt: number, mailAt: number, arming: StallArming = W2): StallSessionInput => sessionInput({
    worker: workerAt('busy', stopAt + 5 * MIN), mark: doneAt(stopAt), arming,
    mail: [mailRow(501, mailAt, COORD, WORKER, 'brief', 67)], deliveries: [delivery(901, 501)],
  });
  const stuck = (key = 901): StallVerdict => ({ act: 'notify', arm: 'mail-stuck', rung: 1, key, to: 'operator' });

  it('under the default gate (no mode given reads shell) a live busy over a current done marker holds: no push at 1.2 h', () => {
    expect(stallMailStuckVerdicts(busyOver(STOP, NOW - 3 * H), NOW)).toEqual([NONE]);
  });

  it('the hold releases under exactly the modes whose gate delivers busy over a done marker (turnidle.ts owns that rule)', () => {
    const delivers = (mode: MailTurnMode): boolean =>
      mailTurnIdle({ status: 'busy', statusUpdatedAt: STOP + 5 * MIN }, { ok: true, state: 'done', at: STOP, stopAt: STOP, graceUntil: null }, NOW, 0, mode).deliver;
    for (const mode of ['strict', 'shell', 'busy-shadow', 'busy'] as const) {
      expect(stallMailStuckVerdicts(busyOver(STOP, NOW - 3 * H, { ...W2, mailMode: mode }), NOW), mode).toEqual(delivers(mode) ? [stuck()] : [NONE]);
    }
    // CONTROLS, so the loop is never vacuous: the gate delivers busy under `busy`, and not under `busy-shadow`.
    expect(delivers('busy')).toBe(true);
    expect(delivers('busy-shadow')).toBe(false);
  });

  it('the busy hold is bounded: from DELEGATE_CAP_MS after the Stop the clock runs, so a recipient wedged at busy is still reported', () => {
    const old = NOW - DELEGATE_CAP_MS - MAIL_STUCK_MS;
    expect(stallMailStuckVerdicts(busyOver(old, old - H), NOW), 'at the bound').toEqual([stuck()]);
    expect(stallMailStuckVerdicts(busyOver(old + MIN, old - H), NOW), 'a minute short of it').toEqual([NONE]);
  });

  it('S2: three mails queued to a worker idling over a progressing subagent push nothing before the bound, then once per delivery', () => {
    const T = NOW - 4 * H;   // the worker's Stop; its subagent ran on for about 4 h (the review's S2: deliveries 3148, 3156, 3177)
    const input = sessionInput({
      worker: workerAt('busy', T + 5 * MIN), mark: doneAt(T),
      mail: [mailRow(3148, T - 79 * MIN, COORD, WORKER, 'resume', 67), mailRow(3156, T + 7 * MIN, COORD, WORKER, 'resume', 67), mailRow(3177, T + 145 * MIN, COORD, WORKER, 'resume', 67)],
      deliveries: [delivery(3148, 3148), delivery(3156, 3156), delivery(3177, 3177)],
    });
    expect(stallMailStuckVerdicts(input, T + 3 * H + 38 * MIN)).toEqual([NONE, NONE, NONE]);
    expect(stallMailStuckVerdicts(input, T + DELEGATE_CAP_MS + MAIL_STUCK_MS)).toEqual([stuck(3148), stuck(3156), stuck(3177)]);
  });
});
```

1d. `server/test/stall-verdict.test.ts`. In describe `wave 2: coord-deaf …` (its title says §10 step 9 after wave 5's
Task 8), replace these three lines:

```ts
    expect(cv([Q], [QD], {}, Q_AT + COORD_DEAF_MS)).toEqual(w2Push('coord-deaf', 4001));
    expect(cv([Q], [QD], {}, Q_AT + COORD_DEAF_MS - 1)).toEqual(NONE);
    expect(cv([{ ...Q, at: NOW - 59 * MIN }], [QD])).toEqual(NONE);
```

with:

```ts
    expect(cv([Q], [QD], {}, Q_AT + MIN + COORD_DEAF_MS)).toEqual(w2Push('coord-deaf', 4001));   // an hour from its first delivery (`gate-held-mail-is-not-stuck` (D-3798))
    expect(cv([Q], [QD], {}, Q_AT + MIN + COORD_DEAF_MS - 1)).toEqual(NONE);
    expect(cv([Q], [{ ...QD, deliveredAt: NOW - 59 * MIN }])).toEqual(NONE);
```

In describe `wave 2: coord-deaf reads the worker's own ball-passing mail, by its newest delivery row`, row "… older acked,
newer unacked past the limit is deaf", replace:

```ts
    const rows = [older({ state: 'acked', ackedAt: Q_AT + 2 * MIN }), newer({ state: 'delivered' })];
```

with:

```ts
    const rows = [older({ state: 'acked', ackedAt: Q_AT + 2 * MIN }), newer({ state: 'delivered', deliveredAt: NOW - COORD_DEAF_MS })];
```

(The other coord-deaf rows hold their verdict unchanged. Each one's delivery is an hour or more old at its `at`, and
none is replayed: the helper's `replayCount` is `0`.)

1e. Append to the END of `server/test/stall-verdict.test.ts`. It uses the module-level `vw`, `W2_LIVE`, `Q`, `QD`,
`delivery`, `notice`, `w2Push`, `capOf`, `mailRow`, `NONE`, `H`, `MIN`, `DELEGATE_CAP_MS`, `COORD_DEAF_MS` and
`COORD_BALL_CAP_MS`.

```ts

// ── gate-held-mail-is-not-stuck (D-3798): coord-deaf runs from the delivery the coordinator could hear ─────────────────
// `sweepMail` re-stamps `deliveredAt` on every replay (`markDelivered`, then `bumpReplayCount`), every MAIL_REPLAY_MS
// while the row stays unacked, so only a first delivery (`replayCount` 0) dates the hearing. A replayed row was first
// delivered at least MAIL_REPLAY_MS before its newest stamp, and never before its queue time, so it is timed from the
// queue, which no replay moves. A mail still queued behind the gate is bounded at DELEGATE_CAP_MS + COORD_DEAF_MS from its queue time (a row parked before delivery is no gate hold, and is timed from its queue): a
// coordinator held in a running turn has no other arm (its mail-stuck needs a finished turn; no frozen arm watches it).
describe('coord-deaf is timed from the delivery the coordinator could hear (gate-held-mail-is-not-stuck (D-3798))', () => {
  const cvd = (mail: StallMailRow[], deliveries: StallDeliveryRow[], at = NOW): StallVerdict => vw({ arming: W2_LIVE, mail }, { deliveries }, at);
  const held: StallDeliveryRow = { ...QD, state: 'queued', deliveredAt: null };
  const BOUND = DELEGATE_CAP_MS + COORD_DEAF_MS;

  it('deaf is timed from the first delivery: queued 62 min ago and delivered 30 s ago is not deaf (the review\'s S4)', () => {
    const q62 = { ...Q, at: NOW - 62 * MIN };
    expect(cvd([q62], [{ ...QD, deliveredAt: NOW - 30_000 }])).toEqual(NONE);
    expect(cvd([q62], [{ ...QD, deliveredAt: NOW - COORD_DEAF_MS + 1 }])).toEqual(NONE);
    expect(cvd([q62], [{ ...QD, deliveredAt: NOW - COORD_DEAF_MS }])).toEqual(w2Push('coord-deaf', 4001));
  });

  it('a replayed delivery is timed from the mail\'s queue time, not from its newest deliveredAt, which every replay re-stamps', () => {
    const replayed: StallDeliveryRow = { ...QD, deliveredAt: NOW - 5 * MIN, replayCount: 5 };
    expect(cvd([Q], [replayed]), 'queued 61 min ago, re-stamped 5 min ago').toEqual(w2Push('coord-deaf', 4001));
    expect(cvd([{ ...Q, at: NOW - COORD_DEAF_MS + 1 }], [replayed])).toEqual(NONE);
    expect(cvd([Q], [{ ...replayed, replayCount: 0 }]), 'CONTROL: a first delivery 5 min ago is not yet deaf').toEqual(NONE);
  });

  it('an undelivered ball-passing mail is deaf from DELEGATE_CAP_MS + COORD_DEAF_MS after it was queued: the bound for a coordinator held in a running turn', () => {
    expect(cvd([{ ...Q, at: NOW - 2 * H }], [held]), 'the S4 shape: held two hours behind the gate').toEqual(NONE);
    expect(cvd([{ ...Q, at: NOW - BOUND + 1 }], [held])).toEqual(NONE);
    expect(cvd([{ ...Q, at: NOW - BOUND }], [held])).toEqual(w2Push('coord-deaf', 4001));
    expect(cvd([Q], [{ ...held, state: 'rejected' }]), 'a row parked before delivery (enter-ignored, the attempt ceiling) is no gate hold: timed from its queue').toEqual(w2Push('coord-deaf', 4001));
  });

  it('past 30 h the coord-ball cap still fires: on a mail with no delivery row, and after coord-deaf on one the gate still holds', () => {
    const old = mailRow(4001, NOW - COORD_BALL_CAP_MS, WORKER, 'coordinator', 'question', 'which base?');
    const oldHeld = delivery(9101, 4001, COORD);   // queued, never delivered
    expect(cvd([old], [])).toEqual(capOf('coord-ball', old.at));
    expect(cvd([old], [oldHeld])).toEqual(w2Push('coord-deaf', 4001));
    const deaf = notice('live', 'coord-deaf', 1, 4001, old.at + BOUND);
    expect(vw({ arming: W2_LIVE, mail: [old], notices: [deaf] }, { deliveries: [oldHeld] })).toEqual(capOf('coord-ball', old.at));
  });
});
```

1f. `server/test/stall-sweep.test.ts`: after the line `import { degradedReadIO } from './ioDoubles.js';`, add
`import { MAIL_GATE_BUSY_MARKER } from '../src/turnidle.js';`. In its value import from `../src/coord/stall.js`, replace
the line `  parseStallDetail, stallDetail,` with `  parseStallDetail, stallDetail, COORD_DEAF_MS,`. Append to the END of
the file:

```ts

// ── gate-held-mail-is-not-stuck (D-3798): the lane reads the gate's mode from the listing it already holds ────────────
describe('sweepStalls: mail-stuck reads the mail gate\'s mode from the tick\'s listing (gate-held-mail-is-not-stuck (D-3798))', () => {
  it('a delivery queued to a worker that reads busy over a done marker is mail-stuck under mail-gate-busy only', async () => {
    const stuckRows = async (names: readonly string[]): Promise<string[]> => {
      const { h, coord, w } = await rig();
      const runId = seedRun(coord, { program: 'demo-program' });
      seedLiveState(h.home, { status: 'busy', statusUpdatedAt: IDLE_AT + 300_000, startedAt: STARTED_AT });
      seedTurnMark(h.home, WORKER);                   // done, its Stop at IDLE_AT
      // Queued at 21:19:17Z (seedRun leaves the clock there) and never delivered.
      const m = coord.insertMail({ fromId: 'demo-boss', fromUuid: 'u', toId: WORKER, runId: null, kind: 'finding', subject: 'hi', body: 'b', artifacts: [] });
      coord.queueDelivery(m.id, WORKER, 'envelope');
      at(IDLE_AT + MAIL_STUCK_MS);
      await w.sweepStalls([fleetRow(WORKER, { status: 'busy' })], names, tickOf());
      return stallRows(coord, runId).filter((d) => d.includes('mail-stuck'));
    };
    expect(await stuckRows([...LIVE, MAIL_GATE_BUSY_MARKER])).toHaveLength(1);
    expect(await stuckRows(LIVE), 'the default gate holds busy mail by design').toEqual([]);
  });
});

// ── gate-held-mail-is-not-stuck (D-3798): a replay re-stamps deliveredAt, so the real store must say it was a replay ─────
// The coordinator coord-deaf exists for: idle, the mail typed into its pane, never acked. `sweepMail` replays such a row
// every MAIL_REPLAY_MS (`markDelivered`, then `bumpReplayCount`), so its newest `deliveredAt` is never 10 min old. The
// store's `replayCount`, carried by `stallMailFor`, is what lets L1 time it from the queue.
describe('sweepStalls: coord-deaf on a delivery the mail sweep keeps replaying (gate-held-mail-is-not-stuck (D-3798))', () => {
  it('is recorded an hour after the question was queued, while the newest deliveredAt is under ten minutes old', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program', workerMail: null, inbound: null });
    const Q_AT = IDLE_AT - 60_000;                       // chosen: the worker asks, and its turn ends a minute later
    const REPLAY_MS = 10 * 60_000;                       // watch.ts's MAIL_REPLAY_MS, module-local there
    at(Q_AT);
    const q = coord.insertMail({ fromId: WORKER, fromUuid: UUID, toId: 'coordinator', runId, kind: 'question', subject: 'which base?', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(q.id, COORD, 'envelope');
    coord.markDelivered(d.id, Q_AT + 60_000);           // the first delivery
    for (let k = 1; k <= 5; k++) {                       // five replays, as sweepMail writes them
      coord.markDelivered(d.id, Q_AT + 60_000 + k * REPLAY_MS);
      expect(coord.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: k });
    }
    const deafRows = (): string[] => stallRows(coord, runId).filter((x) => x.includes('coord-deaf'));
    at(Q_AT + COORD_DEAF_MS - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    expect(deafRows()).toEqual([]);
    at(Q_AT + COORD_DEAF_MS);
    await w.sweepStalls([fleetRow(WORKER)], W2, tickOf());
    // The newest deliveredAt (Q_AT + 51 min) is 9 min old here: timed from it, nothing would be deaf for 51 min more.
    expect(deafRows()).toEqual([stallDetail('live', 'coord-deaf', 1, q.id)]);
    expect(sent.map((p) => p.tag)).toContain(`stall-${runId}-coord-deaf-1-${q.id}`);
  });
});
```

1g. `server/test/stall-store.test.ts`. The `stallMailFor` output pins gain the new field. Replace every occurrence of
`lastGate: null, gateSince: null },` (three) with `lastGate: null, gateSince: null, replayCount: 0 },`, and the one
`lastGate: 'registry-unmeasurable', gateSince: S4_R1_AT + 120_000 },` with
`lastGate: 'registry-unmeasurable', gateSince: S4_R1_AT + 120_000, replayCount: 0 },`. Check:

```bash
cd "$(git rev-parse --show-toplevel)/server"
grep -cF 'gateSince: null },' test/stall-store.test.ts      # prints 0
```

Then append to the END of the file (it uses the module-level `store`, `seedRun`,
`mailAt`, `UNSAFE`, `DISPATCHED_AT`, `S4_STATUS_AT` and `W2_SINCE_AT`):

```ts

// ── gate-held-mail-is-not-stuck (D-3798): the stall read carries replayCount, so coord-deaf can tell a replay ────────────
// `sweepMail` re-stamps `deliveredAt` on every replay, so the column alone cannot date the first delivery. The count of
// replays (`bumpReplayCount`, called only after a send onto an already-delivered row) can say whether it does.
describe('stallMailFor carries each delivery\'s replayCount (gate-held-mail-is-not-stuck (D-3798))', () => {
  const seeded = (): { s: CoordStore; run: number; d: { id: number } } => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const q = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'question', subject: 'which base?', at: S4_STATUS_AT });
    return { s, run, d: s.queueDelivery(q, 'demo-coordinator', '') };
  };

  it('zero on a fresh row and after a first delivery, then the count of replays beside the re-stamped deliveredAt', () => {
    const { s, run, d } = seeded();
    const row = () => {
      const r = s.stallMailFor('demo-worker', [run], W2_SINCE_AT);
      if (!r.ok) throw new Error(r.detail);
      return r.deliveries;
    };
    expect(row()).toMatchObject([{ id: d.id, deliveredAt: null, replayCount: 0 }]);
    s.markDelivered(d.id, S4_STATUS_AT + 60_000);
    expect(row()).toMatchObject([{ deliveredAt: S4_STATUS_AT + 60_000, replayCount: 0 }]);
    s.markDelivered(d.id, S4_STATUS_AT + 660_000);
    expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 1 });
    expect(row()).toMatchObject([{ deliveredAt: S4_STATUS_AT + 660_000, replayCount: 1 }]);
  });

  it.each([['an unsafe count', UNSAFE], ['a negative count', -1n]] as const)('refuses the WHOLE read on %s, naming the column and no value', (_label, value) => {
    const { s, run, d } = seeded();
    s.db.prepare('UPDATE mail_deliveries SET replayCount = ? WHERE id = ?').run(value, d.id);
    expect(s.stallMailFor('demo-worker', [run], W2_SINCE_AT))
      .toEqual({ ok: false, kind: 'delivery-unreadable', detail: 'delivery replayCount is not a positive safe integer' });
  });
});
```

(`delivery-unreadable` is wave 5 Task 3's kind for a delivery column. A zero is decided before `persistedInt`, so the
detail's "positive" names what the helper proves, as it does for every other column.)

- [ ] **Step 2: Run them red.** One file per command, from `server/`:

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-session stall-verdict stall-sweep stall-store; do
  ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^\s+Tests\s' | sed "s/^/$f: /"
done
```

Expected (derived):
- `stall-session`: 4 failed. They are "under the default gate …", "the hold releases …" (its `strict`, `shell` and
  `busy-shadow` iterations), "S2 …", and "the busy hold is bounded" on its second expectation (today's clock reads the
  old Stop).
- The two re-scoped rows stay green.
- `stall-verdict`: 4 failed. They are the existing `it` "10: a question to the coordinator unacked COORD_DEAF_MS …" (at
  its re-timed `Q_AT + MIN + COORD_DEAF_MS - 1` line: today it times from the queue, more than an hour old; its
  `deliveredAt: NOW - 59 * MIN` line is in the same `it`), "deaf is timed from the first delivery …", "a replayed
  delivery …" (its CONTROL), and "an undelivered ball-passing mail is deaf from …" (its S4-shape line).
- "past 30 h the coord-ball cap still fires …" is green before and after: today an undelivered mail is deaf from its
  queue. T2-M7 reds it.
- `stall-sweep`: 1 failed, the without-marker case. The replay lane row is green before and after (today's clock is the
  queue's); T2-M10 and T2-M11 red it.
- `stall-store`: 5 failed. They are the two existing `it`s whose pins now carry `replayCount: 0` ("reads the run's whole
  history, …" and "hands EVERY delivery row of a selected mail, …"), "zero on a fresh row …", and both `it.each` rows
  (today the column is not read).
- `stall-bodies`: green (a helper default only).
- The test `tsc` run reports `mailMode` unknown on `StallArming` and `replayCount` unknown on `StallDeliveryRow` until
  Step 3. Vitest does not typecheck.

- [ ] **Step 3: Implement.**

3a. `server/src/coord/stall.ts`, the import block. Directly after the line that imports types from
`'../../../shared/api.js'` (after wave 5 it reads `import type { MailGate, RunState } from '../../../shared/api.js';`),
add:

```ts
import type { MailTurnMode } from '../turnidle.js';
```

3b. The arm glosses in `STALL_ARM_MAP`. Replace:

```ts
  'coord-deaf': 'the worker passed the ball to its coordinator and that mail sat unacked for COORD_DEAF_MS: one operator push',
  'mail-stuck': 'a delivery to the session stayed queued MAIL_STUCK_MS after its main loop went idle, or behind a registry gate: one operator push per delivery',
```

with:

```ts
  'coord-deaf': 'the worker passed the ball to its coordinator and that mail sat unacked COORD_DEAF_MS from its first delivery, or DELEGATE_CAP_MS + COORD_DEAF_MS from its queue while it stays queued behind the gate: one operator push',
  'mail-stuck': 'a delivery to the session stayed queued MAIL_STUCK_MS after its main loop went idle as the mail gate in force reads it, or behind a registry gate: one operator push per delivery',
```

3b′. `StallDeliveryRow` and its docstring. Replace:

```ts
/** One delivery row as the watch reads it (§5.2 mail-stuck and coord-deaf). The gate columns are selected as plain
 *  columns and judged here, in L1, never filtered on by the store (D-792's pins); the sticky error text is never read. */
export interface StallDeliveryRow { readonly id: number; readonly mailId: number; readonly toId: string; readonly state: string; readonly deliveredAt: number | null; readonly ackedAt: number | null; readonly lastGate: string | null; readonly gateSince: number | null }
```

with:

```ts
/** One delivery row as the watch reads it (§5.2 mail-stuck and coord-deaf). The gate columns are selected as plain
 *  columns and judged here, in L1, never filtered on by the store (D-792's pins); the sticky error text is never read.
 *  `replayCount` is the store's count of REPLAYS: `deliveredAt` is re-stamped by each one, so only a row whose count is
 *  0 still carries its first delivery's time (`gate-held-mail-is-not-stuck` (D-3798)). */
export interface StallDeliveryRow { readonly id: number; readonly mailId: number; readonly toId: string; readonly state: string; readonly deliveredAt: number | null; readonly ackedAt: number | null; readonly lastGate: string | null; readonly gateSince: number | null; readonly replayCount: number }
```

3c. Replace `StallArming` and its docstring:

```ts
/** `w2Live` and `mailDisabled` are optional, so wave 1's literals stay valid; absent reads as false
 *  (`w2-arming-optional` (D-3628)). `stallArmingOf` always sets `w2Live`. The lane sets `mailDisabled` from `watch.ts`'s own
 *  module-local marker constant, and the verdict filter (Task 11) reads it. */
export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean; readonly w2Live?: boolean; readonly mailDisabled?: boolean }
```

with:

```ts
/** `w2Live`, `mailDisabled` and `mailMode` are optional, so wave 1's literals stay valid. An absent `w2Live` or
 *  `mailDisabled` reads as false (`w2-arming-optional` (D-3628)); an absent `mailMode` reads as `shell`, the mail gate's
 *  shipped default (`gate-held-mail-is-not-stuck` (D-3798)). `stallArmingOf` always sets `w2Live`. The lane sets
 *  `mailDisabled` from `watch.ts`'s own module-local marker constant, which the verdict filter (Task 11) reads, and
 *  `mailMode` from `turnidle.ts`'s `mailTurnModeOf` over the same listing, which mail-stuck's idle clock reads. */
export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean; readonly w2Live?: boolean; readonly mailDisabled?: boolean; readonly mailMode?: MailTurnMode }
```

3d. Replace `stallIdleStart` with its docstring:

```ts
/** When the recipient's main loop went idle: the live stamp under idle or shell, else the CURRENT marker's stop when
 *  it reads done or failed, else null (§5.2). */
function stallIdleStart(input: StallSessionInput): number | null {
  const live = stallSessionLive(input);
  if (live !== null && isIdleWord(live.word)) return live.since;
  const m = stallCurrentMark(input);
  return m !== null && (m.state === 'done' || m.state === 'failed') ? m.stopAt : null;
}
```

with:

```ts
/** When the recipient's main loop went idle, as the mail gate in force can deliver to it (§5.2;
 *  `gate-held-mail-is-not-stuck` (D-3798)): the live stamp under idle or shell; else the CURRENT marker's stop when it
 *  reads done or failed. A live `busy` over that finished turn is a main loop idling over background work. The gate
 *  delivers on it only in the `busy` mode (`turnidle.ts`'s `mailTurnIdle`, armed by its marker), and under every other
 *  mode it holds that mail by design. So under those modes the clock starts DELEGATE_CAP_MS after the stop: that is the cap on
 *  subagent-covered main silence, past which a delivery still queued cannot reach its recipient. Else null. */
function stallIdleStart(input: StallSessionInput): number | null {
  const live = stallSessionLive(input);
  if (live !== null && isIdleWord(live.word)) return live.since;
  const m = stallCurrentMark(input);
  if (m === null || (m.state !== 'done' && m.state !== 'failed') || m.stopAt === null) return null;
  if (live !== null && live.word === 'busy' && (input.arming.mailMode ?? 'shell') !== 'busy') return m.stopAt + DELEGATE_CAP_MS;
  return m.stopAt;
}
```

The dialog path is unchanged. Under a live `waiting` the stop still starts the clock, because §5.2 reports past a
dialog, and `stallSessionHolds` keeps `holdDialog` false for mail-stuck.

3e. Replace `stallDeafMail` and its docstring:

```ts
/** coord-deaf's mail (§5.2). It is the worker's newest ball-passing mail to a coordinator id: a question, or a status
 *  whose subject EQUALS wave-done or review-done. It counts only while its newest delivery row is unacked. A mail
 *  with NO delivery row is not deaf: nothing measured it unacked, so coord-deaf does not fire on it, and the
 *  coord-ball cap still does. */
function stallDeafMail(input: StallInput, deliveries: readonly StallDeliveryRow[]): StallMailRow | null {
```

with:

```ts
/** coord-deaf's mail (§5.2). It is the worker's newest ball-passing mail to a coordinator id: a question, or a status
 *  whose subject EQUALS wave-done or review-done. It counts only while its newest delivery row is unacked, and it
 *  answers `deafSince`, the time COORD_DEAF_MS runs from (`gate-held-mail-is-not-stuck` (D-3798)):
 *  - a first delivery (`replayCount` 0): its `deliveredAt`, so a mail the gate held is not deaf the moment it lands;
 *  - a replayed one: the mail's queue time. Every replay re-stamps `deliveredAt`, every MAIL_REPLAY_MS while the row
 *    stays unacked, so that column would hold the clock back until the replay ceiling parks the row. The first delivery
 *    came at least MAIL_REPLAY_MS before the newest stamp, and never before the queue;
 *  - a mail still QUEUED behind the gate, undelivered: its queue time plus DELEGATE_CAP_MS. A coordinator in a RUNNING turn (marker
 *    `working` under a live `busy`: a hung foreground call, a blocking wait) has no other arm. Its own mail-stuck needs
 *    a finished turn, and no frozen arm watches a coordinator. So the hold is bounded like mail-stuck's busy hold, and
 *    the mail is deaf about 5 h after it was queued rather than at the 30 h coord-ball cap;
 *  - a row parked before any delivery (`rejected`: `enter-ignored`, the attempt ceiling, a dead recipient; or a state
 *    token this code does not name): its queue time, as before. The gate holds nothing there, and the coordinator's own
 *    mail-stuck reads only a `queued` row, so no bound applies.
 *  A mail with NO delivery row is not deaf: nothing measured it unacked, and the coord-ball cap still fires on it. */
function stallDeafMail(input: StallInput, deliveries: readonly StallDeliveryRow[]): { readonly mail: StallMailRow; readonly deafSince: number } | null {
```

and its last line:

```ts
  return d !== null && d.ackedAt === null ? passed : null;
```

with:

```ts
  if (d === null || d.ackedAt !== null) return null;
  // Only a row the gate can still deliver is bounded; a parked or unnamed state is timed from its queue.
  if (d.deliveredAt === null) return { mail: passed, deafSince: d.state === 'queued' ? passed.at + DELEGATE_CAP_MS : passed.at };
  return { mail: passed, deafSince: d.replayCount === 0 ? d.deliveredAt : passed.at };
```

A delivery the replay ceiling parked (`rejected`, `deliveredAt` set, `replayCount` at the ceiling) is unacked and
replayed, so it counts from its queue time, as it counted (from the queue) before this wave.

A delivery parked BEFORE any delivery (`rejected` with `deliveredAt` null: `enter-ignored`, the attempt ceiling, a dead or
registry-absent recipient) is no gate hold. The check is positive on `queued`, so that row, and any state token this
code does not name, is timed from its queue, as at base. The gate-hold bound applies to a QUEUED row only.

3f. In `stallVerdictInner`'s coordinator's-ball step, replace:

```ts
    if (deaf !== null && now - deaf.at >= COORD_DEAF_MS && rungDoneAt(input, 'coord-deaf', 1, deaf.id) === null) {
      return { act: 'notify', arm: 'coord-deaf', rung: 1, key: deaf.id, to: 'operator' };
    }
```

with:

```ts
    if (deaf !== null && now - deaf.deafSince >= COORD_DEAF_MS && rungDoneAt(input, 'coord-deaf', 1, deaf.mail.id) === null) {
      return { act: 'notify', arm: 'coord-deaf', rung: 1, key: deaf.mail.id, to: 'operator' };
    }
```

The key is unchanged (the mail id), so recorded rows still dedupe. `stallDeafBody` is not edited. Its "is not
delivered" branch is reached again only past the bound, or for a row parked before delivery, and its "has no delivery row" branch cannot be reached from a
fresh verdict; both stay as total text over the body's inputs, and its existing rows keep them pinned. For a replayed
row its "was delivered at" names the newest send, which is true of that send. It is not the clock the arm ran on, and
the body says nothing about that clock.

3f′. `server/src/coord/store.ts`, `stallMailFor`'s delivery statement (statement 2) and loop. Replace
`      'CAST(gateSince AS TEXT) AS gateSinceText ' +` with
`      'CAST(gateSince AS TEXT) AS gateSinceText, CAST(replayCount AS TEXT) AS replayCountText ' +`, and
`        ackedAtText: string | null; lastGate: string | null; gateSinceText: string | null }[];` with
`        ackedAtText: string | null; lastGate: string | null; gateSinceText: string | null; replayCountText: string }[];`.
Directly after wave 5's line

```ts
      if (!gateSince.ok) return { ok: false, kind: 'delivery-unreadable', detail: gateSince.detail };
```

insert:

```ts
      // NOT NULL DEFAULT 0, and zero is decided here as NULL is for the nullable columns, because `persistedInt` proves a
      // positive count (`gate-held-mail-is-not-stuck` (D-3798): coord-deaf tells a first delivery from a replay by it).
      const replayCount = d.replayCountText === '0' ? { ok: true as const, value: 0 } : persistedInt(d.replayCountText, 'delivery replayCount');
      if (!replayCount.ok) return { ok: false, kind: 'delivery-unreadable', detail: replayCount.detail };
```

and replace `        ackedAt: ackedAt.value, lastGate: d.lastGate, gateSince: gateSince.value });` with
`        ackedAt: ackedAt.value, lastGate: d.lastGate, gateSince: gateSince.value, replayCount: replayCount.value });`.
Statement 1, the `where` clause and wave 5's index plan are untouched: the column is read from rows statement 2 already
selects, so its EXPLAIN plan (wave 5 Task 1's pins) does not move. The docstring's "`kind`, `state` and `lastGate` are
the raw columns" sentence stays true.

3g. `server/src/watch.ts`, `sweepStalls`, one line in place. Replace:

```ts
      const arming: StallArming = { ...stallArmingOf(names), mailDisabled: names.includes(MAIL_DISABLED_MARKER) };
```

with:

```ts
      const arming: StallArming = { ...stallArmingOf(names), mailDisabled: names.includes(MAIL_DISABLED_MARKER), mailMode: mailTurnModeOf(names) };
```

`mailTurnModeOf` is already imported (`import { mailTurnIdle, mailTurnModeOf, mailTurnReadsMark } from './turnidle.js';`).

- [ ] **Step 4: Run green.** One file per command, from `server/`:

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-session stall-verdict stall-sweep stall-store stall-vocabulary single-definition turnidle mail-sweep mail-hardening stall-bodies; do
  ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^\s+Tests\s' | sed "s/^/$f: /"
done
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-clean
```

Expected: `stall-session` +4, `stall-verdict` +4, `stall-sweep` +2, `stall-store` +3 over Task 1's
counts (`stall-store` over the baseline). Then `stall-vocabulary` (the type import), `single-definition` (no marker name
spelled in `stall.ts`), `turnidle`, `mail-sweep`, `mail-hardening` (its writer census reads `store.ts`; this edit adds a
read, no `UPDATE`) and `stall-bodies`, each green at its previous count. Both `tsc` runs clean: every
`StallDeliveryRow` literal in the tree is one of the three helpers or a store pin, all of which now carry the field.

- [ ] **Step 5: README, in place (six lines for six).** Replace:

```
- **coordinator deaf**: the worker's `question`, `wave-done` or `review-done` to
  its coordinator is unacked for 1 h. One `⚠ coordinator deaf` push.
- **mail stuck**: a delivery still queued 1.2 h after its recipient went idle
  (a live word of `idle` or `shell`, or a current marker reading `done` or
  `failed`), or refused `registry-unmeasurable` for 1.2 h. One `⚠ mail stuck`
  push per delivery.
```

with:

```
- **coordinator deaf**: the worker's `question`, `wave-done` or `review-done` to
  its coordinator is still unacked 1 h after its first delivery (1 h after it was queued once the mail sweep has replayed it), or 5 h after it was queued while it is still queued behind the gate (a row parked before delivery counts from its queue). One `⚠ coordinator deaf` push.
- **mail stuck**: a delivery still queued 1.2 h after its recipient went idle
  (a live word of `idle` or `shell`, or a current marker reading `done` or `failed`; under a live `busy`
  the gate holds mail by design unless `mail-gate-busy` is armed, so that clock then starts 4 h after the Stop),
  or refused `registry-unmeasurable` for 1.2 h. One `⚠ mail stuck` push per delivery.
```

Then the citation instrument (`7 passed | 328 skipped`) and `readme-holds` (green, at its count).

- [ ] **Step 6: Mutations** T2-M1 to T2-M13. Every row red.

- [ ] **Step 7: Commit.**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/stall.ts server/src/coord/store.ts server/src/watch.ts README.md server/test/stall-session.test.ts server/test/stall-verdict.test.ts server/test/stall-bodies.test.ts server/test/stall-store.test.ts server/test/stall-sweep.test.ts
git commit -m "fix(stall): mail-stuck follows the gate mode in force; coord-deaf runs from the first delivery and bounds the gate's hold (D-3798)"
```

---

### Task 3: The dialog cap is pushed once per dialog (G3, D-3799)

**Files:**
- Modify: `server/src/coord/stall.ts`
  - the `dialog-cap` gloss (`:54`)
  - the `StallActivation` docstring (`:478-479`)
  - the `StallFacts` docstring (`:561-563`)
  - the `capQuietSince` docstring (`:684`)
  - a new helper after `rungDoneAt` (`:726-734`)
  - hold 2b in `stallVerdictInner` (`:968-973`)
  - the `dialog-cap` case of `stallPushText` (`:1305-1309`)
  - `stallSilence`'s docstring, in wave 5's wording
- Modify: `README.md` — the dialog clause (`:2553`), one line in place.
- Test: `server/test/stall-verdict.test.ts` — six existing rows re-keyed (`:268`, `:706`, `:1236`, `:1320`, `:1573`, `:1589`);
  a describe appended.
- Test: `server/test/stall-bodies.test.ts` — two existing rows re-keyed (`:439-446`, `:1360-1373`); a describe appended.
- Test: `server/test/stall-sweep.test.ts` — one constant added; ten existing assertions re-keyed; a describe appended.

**Interfaces:**
- Consumes: `StallFacts.capKeyMs`, `rungDoneAt`, `capVerdict` (`stall.ts`), and Task 1's `stallFacts` (an alias `wait:`
  now moves `capKeyMs`, and with it a dialog's floor).
- Produces: module-private `function stallDialogCapDone(input: Pick<StallInput, 'notices' | 'arming'>, since: number): boolean`
  (`since` is the live stamp). The dialog-cap notify's `key` becomes `Math.max(capKeyMs, live.since)`. The limit cap
  keeps `capKeyMs`.

- [ ] **Step 0: Re-anchor.** Each prints exactly one line:

```bash
grep -nF "  const capKey = f.capKeyMs; // the caps keep the spec's clock and key (\`quiet-restarts-on-reactivation\` (D-3788))" server/src/coord/stall.ts
grep -nF "  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && rungDoneAt(input, 'dialog-cap', 1, capKey) === null ? capVerdict('dialog-cap', capKey) : holdVerdict('dialog');" server/src/coord/stall.ts
grep -nF "then 2b (a dialog with no ask, capped once per episode)" server/src/coord/stall.ts
grep -nF "body: \`\${label}: worker \${worker} shows a dialog with no question behind it; this quiet episode opened" server/src/coord/stall.ts
grep -nF "the dialog and limit caps keep \`capKeyMs\`, which a" server/src/coord/stall.ts
grep -nF "worker, an open question, a harness dialog (one \`⚠ stalled … (dialog)\` push" README.md
```

The fifth is wave 5's `stallSilence` docstring (its Task 8). If it prints nothing, wave 5 worded it otherwise: apply the
same meaning to whatever wave 5 wrote, and say so in the wave-done mail.

- [ ] **Step 1: Write the failing tests.**

1a. `server/test/stall-verdict.test.ts`, the existing rows that change key (each line occurs once):

| Find | Replace |
|---|---|
| `    expect(v(worker, A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', K));` | `    expect(v(worker, A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', A));   // keyed on the dialog's live stamp (\`dialog-cap-keyed-on-the-dialog\` (D-3799))` |
| `    expect(stallVerdict(stallInput({ worker }), since + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', K));` | `    expect(stallVerdict(stallInput({ worker }), since + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', since));` |
| `      .toEqual(capOf('dialog-cap', RUN67_DISPATCHED));` | `      .toEqual(capOf('dialog-cap', NOW - 3 * H));` |
| `    expect(stallVerdict(stallInput({ primary, worker }), A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', A - 5 * H));` | `    expect(stallVerdict(stallInput({ primary, worker }), A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', A));` |
| `  it('the dialog cap (2b) keeps today\'s clock and key: a dialog up through the review is pushed on the first sweep after the advance', () => {` | `  it('the dialog cap (2b) keeps today\'s clock, keyed on the dialog\'s own stamp: a dialog up through the review is pushed on the first sweep after the advance', () => {` |
| `    // the pane through the review still blocks the fix-round brief. Keyed on #2811, so its text's span stays true.` | `    // the pane through the review still blocks the fix-round brief. Keyed on its live stamp (\`dialog-cap-keyed-on-the-dialog\` (D-3799)), which no send-back moves.` |
| `    expect(stallVerdict(menu(reactivated(E4.react)), E4.fire)).toEqual(capOf('dialog-cap', E4.w2811));` | `    expect(stallVerdict(menu(reactivated(E4.react)), E4.fire)).toEqual(capOf('dialog-cap', E4.stop));` |
| `    expect(stallVerdict(menu, E4.fire)).toEqual(capOf('dialog-cap', E4.w2811));   // CONTROL: no push recorded` | `    expect(stallVerdict(menu, E4.fire)).toEqual(capOf('dialog-cap', E4.stop));   // CONTROL: no push recorded` |
| `    // (D-3788) The caps dedupe on \`capKeyMs\`, the pre-advance key; keying the dedupe on the episode key would re-push.` | `    // \`dialog-cap-keyed-on-the-dialog\` (D-3799): any push written since the dialog's stamp is this dialog's, whatever its key.` |

Each of these rows' live stamp is later than its `capKeyMs`, so the key becomes the stamp. The rows beside them that
assert `hold('dialog')` after a push recorded on the old key (`:269`, `:707-708`, `:1590`) stay green unchanged. Each of
those rows was written after the stamp, so `stallDialogCapDone` counts it, whatever its key.

1b. Append to the END of `server/test/stall-verdict.test.ts`:

```ts

// ── dialog-cap-keyed-on-the-dialog (D-3799): one dialog-cap push per dialog, keyed on its live stamp ─────────────────
// Run 174 (live coord.db, 2026-10-03): one dialog-cap row on the episode key (#2837), written 2026-10-02T18:50:16Z, and a
// second permission prompt standing since 19:38:19Z with no row possible. Run 67: a row on its episode key written
// 03:15:12Z, after its 01:14:44Z stamp.
describe('dialog-cap-keyed-on-the-dialog (D-3799): the dialog cap is pushed once per dialog, not once per mail episode', () => {
  const K = t('2026-09-30T22:48:29.848Z');   // run 174's episode key: the worker's last run mail
  const D1 = t('2026-10-02T16:40:00Z');      // chosen: the first dialog's live stamp
  const D2 = t('2026-10-02T19:38:19.419Z');  // run 174's second dialog: the stamp its live file carries
  const own = mailRow(2837, K, WORKER, 'coordinator', 'status', 'Task 5 pushed', 174);
  const first = notice('live', 'dialog-cap', 1, K, t('2026-10-02T18:50:16.434Z'));   // the one row run 174 has
  const menu = (since: number, notices: StallNotice[] = [], over: Partial<PresentWorker> = {}): StallInput => stallInput({
    primary: { id: 174, dispatchedAt: K - 48 * H }, mail: [own], notices,
    worker: workerAt({ live: liveWord('waiting', since), ...over }),
  });

  it('the first dialog is pushed on its own live stamp at 2 h', () => {
    expect(stallVerdict(menu(D1), D1 + STALL_QUIET_MS - 1)).toEqual(hold('dialog'));
    expect(stallVerdict(menu(D1), D1 + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', D1));
  });

  it('a second dialog in the same mail episode gets its own push, once (run 174)', () => {
    expect(stallVerdict(menu(D2, [first]), D2 + STALL_QUIET_MS - 1)).toEqual(hold('dialog'));
    expect(stallVerdict(menu(D2, [first]), D2 + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', D2));
    const second = notice('live', 'dialog-cap', 1, D2, D2 + STALL_QUIET_MS + 20_000);
    expect(stallVerdict(menu(D2, [first, second]), D2 + 16 * H)).toEqual(hold('dialog'));
  });

  it('a row on the episode key written after the live stamp reported this dialog: no second push at the re-key (run 67 at deploy)', () => {
    const K67 = t('2026-10-03T01:00:24.353Z');   // run 67's episode key: mail 3299
    const S67 = t('2026-10-03T01:14:44.433Z');   // its live stamp: waiting since
    const row = notice('shadow', 'dialog-cap', 1, K67, t('2026-10-03T03:15:12.508Z'));   // written by the build before this one
    const input = (notices: StallNotice[]): StallInput => stallInput({
      primary: { dispatchedAt: K67 - 5 * H }, mail: [mailRow(3299, K67, WORKER, 'coordinator', 'status', 'Task 3 pushed')],
      notices, arming: SHADOW, worker: workerAt({ live: liveWord('waiting', S67) }),
    });
    expect(stallVerdict(input([row]), S67 + 11 * H)).toEqual(hold('dialog'));
    expect(stallVerdict(input([]), S67 + 11 * H), 'CONTROL: with no row the dialog is pushed on its stamp').toEqual(capOf('dialog-cap', S67));
    // rungDoneAt's standing rule, per row: armed since, the shadow row no longer stands, so the dialog is pushed live once.
    expect(stallVerdict({ ...input([row]), arming: ARMED }, S67 + 11 * H), 'armed since the shadow row').toEqual(capOf('dialog-cap', S67));
  });

  it('the same-stretch boundary: an episode-key row written AT the stamp holds, one a millisecond before it does not', () => {
    const rowAt = (at: number): StallInput => menu(D2, [notice('live', 'dialog-cap', 1, K, at)]);
    expect(stallVerdict(rowAt(D2), D2 + STALL_QUIET_MS)).toEqual(hold('dialog'));
    expect(stallVerdict(rowAt(D2 - 1), D2 + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', D2));
  });

  it('a send-back and an inbound brief move neither key: the dialog standing through them keeps its one push (R7, D-3788)', () => {
    const pushed = notice('live', 'dialog-cap', 1, D2, D2 + STALL_QUIET_MS + 20_000);
    const brief = mailRow(2900, D2 + 3 * H, COORD, WORKER, 'status', 'fix-round', 174);
    const back = stallInput({
      primary: { id: 174, dispatchedAt: K - 48 * H }, mail: [own, brief], notices: [pushed],
      worker: workerAt({ live: liveWord('waiting', D2) }), activation: { kind: 'reactivated', at: D2 + 3 * H - 30_000 },
    });
    expect(stallVerdict(back, D2 + 6 * H)).toEqual(hold('dialog'));
  });

  it('the key never reads the hookstate time, which every later hook event restamps while the prompt stands', () => {
    expect(stallVerdict(menu(D2, [first], { hookAsk: { kind: 'approval', at: D2 + 15_000 } }), D2 + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', D2));
    const pushed = notice('live', 'dialog-cap', 1, D2, D2 + STALL_QUIET_MS + 20_000);
    expect(stallVerdict(menu(D2, [first, pushed], { hookAsk: { kind: 'approval', at: D2 + 75_000 } }), D2 + 5 * H)).toEqual(hold('dialog'));
  });

  it('a coordinator wait: to the role worker while the dialog stands moves the key, and the dialog keeps its one push', () => {
    // Task 1 lets an alias `wait:` move capKeyMs past the live stamp, and the wait is inbound mail, so it restarts the cap's
    // quiet too. Two hours on, a per-key check finds no row on the new key and pushes the same dialog again.
    const pushed = notice('live', 'dialog-cap', 1, D2, D2 + STALL_QUIET_MS + 20_000);
    const wait = mailRow(2901, D2 + 3 * H, COORD, 'worker', 'status', `${STALL_WAIT_PREFIX} CI`, 174);
    const input = stallInput({
      primary: { id: 174, dispatchedAt: K - 48 * H }, mail: [own, wait], notices: [pushed],
      worker: workerAt({ live: liveWord('waiting', D2) }),
    });
    expect(stallFacts(input).capKeyMs, 'CONTROL: the wait moved the cap key past the stamp').toBe(D2 + 3 * H);
    expect(stallVerdict(input, D2 + 6 * H)).toEqual(hold('dialog'));
  });
});
```

1c. `server/test/stall-bodies.test.ts`. Replace the whole existing row:

```ts
  it('dialog-cap: a dialog with no question behind it, past 2 h of quiet', () => {
    const input = s4({ worker: worker({ live: { ok: true, word: 'waiting', since: IDLE_SINCE }, dialogPending: true }), arming: escalated });
    const n = stallVerdict(input, R1_AT);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: EPISODE, to: 'operator' });
    expect(stallPushText(input, stallFacts(input), n as StallNotify, R1_AT)).toEqual({
      title: '⚠ stalled › demo-ws (dialog)',
      body: `${LABEL}: worker demo-worker shows a dialog with no question behind it; this quiet episode opened 2026-09-28T21:17Z (2h 39m). Mail to the worker, its coordinator's included, cannot land while the dialog shows: answer or dismiss it on the pane.`,
    });
  });
```

with:

```ts
  it('dialog-cap: a dialog with no question behind it, past 2 h of quiet, keyed and timed on its live stamp (D-3799)', () => {
    const input = s4({ worker: worker({ live: { ok: true, word: 'waiting', since: IDLE_SINCE }, dialogPending: true }), arming: escalated });
    const n = stallVerdict(input, R1_AT);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: IDLE_SINCE, to: 'operator' });
    expect(stallPushText(input, stallFacts(input), n as StallNotify, R1_AT)).toEqual({
      title: '⚠ stalled › demo-ws (dialog)',
      body: `${LABEL}: worker demo-worker shows a dialog with no question behind it; its live status has read waiting since 2026-09-28T21:56Z (2h 0m). Mail to the worker, its coordinator's included, cannot land while the dialog shows: answer or dismiss it on the pane.`,
    });
  });
```

Replace the comment and the describe opening (four lines):

```ts
// The dialog and limit caps keep today's clock and key (coordinator ruling on `quiet-restarts-on-reactivation`, D-3788):
// pushed on the first sweep after a send-back, their text still names the episode the worker's last mail opened, so
// the span it prints is at least the cap's own threshold, as before.
describe('the dialog cap after a send-back keeps today\'s key, so the span it prints stays true', () => {
```

with:

```ts
// The dialog and limit caps keep today's clock (coordinator ruling on `quiet-restarts-on-reactivation` (D-3788)), and the
// dialog cap is keyed on its own live stamp (`dialog-cap-keyed-on-the-dialog` (D-3799)): pushed on the first sweep after
// a send-back, its text names how long the live status has read so, which no send-back moves.
describe('the dialog cap after a send-back keeps its clock and its key, so the span it prints stays true', () => {
```

and in it, replace:

```ts
  it('pushes on the first sweep after the advance, keyed on the worker\'s last mail, with the episode\'s true span', () => {
    const at = REACT + 4_000;
    const n = stallVerdict(menu, at);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: EPISODE, to: 'operator' });
    expect(stallPushText(menu, stallFacts(menu), n as StallNotify, at).body).toContain('this quiet episode opened 2026-09-28T21:17Z (10h 42m).');
```

with:

```ts
  it('pushes on the first sweep after the advance, keyed on the dialog\'s live stamp, with the dialog\'s true span', () => {
    const at = REACT + 4_000;
    const n = stallVerdict(menu, at);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: IDLE_SINCE, to: 'operator' });
    expect(stallPushText(menu, stallFacts(menu), n as StallNotify, at).body).toContain('its live status has read waiting since 2026-09-28T21:56Z (10h 3m).');
```

Append to the END of `server/test/stall-bodies.test.ts`:

```ts

// `dialog-cap-keyed-on-the-dialog` (D-3799): the push names the dialog's own stretch, from the live stamp its key comes from.
describe('the dialog-cap push prints the dialog\'s own stretch, never the episode\'s age', () => {
  it('names the live status and how long it has read so, and not the episode key (run 174\'s shape)', () => {
    const SINCE = T('2026-10-02T19:38:19Z');
    const input = s4({ worker: worker({ live: { ok: true, word: 'waiting', since: SINCE } }), arming: escalated });
    const at = SINCE + 16 * 3_600_000 + 39 * 60_000;
    const n = stallVerdict(input, at);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: SINCE, to: 'operator' });
    const { body } = stallPushText(input, stallFacts(input), n as StallNotify, at);
    expect(body).toBe('run 67 — demo-program wave 9/9: worker demo-worker shows a dialog with no question behind it; its live status has read waiting since 2026-10-02T19:38Z (16h 39m). Mail to the worker, its coordinator\'s included, cannot land while the dialog shows: answer or dismiss it on the pane.');
    expect(body).not.toContain(stallUtc(EPISODE));
  });

  it('a dialog older than the worker\'s last mail is keyed on that mail, and the text still names the live stamp', () => {
    const own = mail(2520, T('2026-09-28T22:30:00Z'), WORKER, 'coordinator', 'status', 'still at the prompt');
    const input = s4({ worker: worker({ live: { ok: true, word: 'waiting', since: IDLE_SINCE } }), mail: [m2509, m2510, own], arming: escalated });
    const at = T('2026-09-29T00:30:00Z');
    const n = stallVerdict(input, at);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: own.at, to: 'operator' });
    expect(stallPushText(input, stallFacts(input), n as StallNotify, at).body).toContain('its live status has read waiting since 2026-09-28T21:56Z (2h 33m).');
  });

  it('a worker with no measured live stamp is said to be unmeasured, never given a guessed span', () => {
    const n: StallNotify = { act: 'notify', arm: 'dialog-cap', rung: 1, key: EPISODE, to: 'operator' };
    const gone = s4({ worker: { present: false } });
    expect(stallPushText(gone, stallFacts(gone), n, R1_AT).body).toContain('shows a dialog with no question behind it; its live status was not measured.');
  });

  it('the live word is printed only through stallSafe', () => {
    const odd = s4({ worker: worker({ live: { ok: true, word: 'evil word', since: IDLE_SINCE }, dialogPending: true }) });
    const n: StallNotify = { act: 'notify', arm: 'dialog-cap', rung: 1, key: IDLE_SINCE, to: 'operator' };
    const { body } = stallPushText(odd, stallFacts(odd), n, R1_AT);
    expect(body).toContain('its live status has read (unprintable) since 2026-09-28T21:56Z');
    expect(body).not.toContain('evil word');
  });
});
```

1d. `server/test/stall-sweep.test.ts`. Directly after the line
`const KEY = WORKER_MAIL_AT;                                  // episodeKeyMs: the worker's newest mail`, add:

```ts
/** The dialog cap's key on a pane that reads waiting since the S4 idle stamp: the stamp, later than KEY
 *  (`dialog-cap-keyed-on-the-dialog` (D-3799)). */
const DIALOG_KEY = IDLE_AT;
```

Then replace EVERY occurrence of `dialog-cap-1-${KEY}` with `dialog-cap-1-${DIALOG_KEY}` (six), and of
`stallDetail('live', 'dialog-cap', 1, KEY)` with `stallDetail('live', 'dialog-cap', 1, DIALOG_KEY)` (four). Check:

```bash
cd "$(git rev-parse --show-toplevel)/server"
grep -cF 'dialog-cap-1-${KEY}' test/stall-sweep.test.ts       # prints 0
grep -cF "'dialog-cap', 1, KEY)" test/stall-sweep.test.ts     # prints 0
```

Every one of those rows
seeds `status: 'waiting'` with the default `statusUpdatedAt` (`IDLE_AT`), and its run carries S4's mails (`KEY`).

Append to the END of `server/test/stall-sweep.test.ts`:

```ts

// ── dialog-cap-keyed-on-the-dialog (D-3799): one dialog-cap push per dialog, through a restart ──────────────────────────
describe('sweepStalls: one dialog-cap push per dialog (dialog-cap-keyed-on-the-dialog (D-3799))', () => {
  it('one push per dialog across sweeps and a fresh watcher; a second dialog in the same episode pushes again', async () => {
    const { h, coord, w, sent } = await rig();
    seedLiveState(h.home, { status: 'waiting' });            // the first dialog, since IDLE_AT
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(sent.map((p) => p.tag)).toEqual([`stall-${runId}-dialog-cap-1-${IDLE_AT}`]);
    const spy2 = pushSpy();
    const again = await primedWatcher(h, coord, { push: spy2.push as never });   // a server restart
    at(R1_AT + STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(spy2.sent).toEqual([]);                           // the row on the dialog's key holds it
    const S2 = R1_AT + 2 * STALL_SWEEP_MS;                   // the word turned and a second prompt shows: a new stamp
    seedLiveState(h.home, { status: 'waiting', statusUpdatedAt: S2 });
    at(S2 + STALL_QUIET_MS);
    await again.sweepStalls([fleetRow(WORKER)], ARMED, tickOf());
    expect(spy2.sent.map((p) => p.tag)).toEqual([`stall-${runId}-dialog-cap-1-${S2}`]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'dialog-cap', 1, IDLE_AT), stallDetail('live', 'dialog-cap', 1, S2)]);
  });
});
```

- [ ] **Step 2: Run them red.** One file per command, from `server/`:

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-verdict stall-bodies stall-sweep; do
  ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^\s+Tests\s' | sed "s/^/$f: /"
done
```

Expected (derived):
- `stall-verdict` fails these `it`s:
  - the six re-keyed rows (`:268`, `:706`, `:1236`, `:1320`, `:1573`, `:1589`), which still answer the old key;
  - "the first dialog …";
  - "a second dialog …", which answers `hold('dialog')`;
  - "a row on the episode key …", at its CONTROL (and its armed expectation, which answers a push on `K67`);
  - "the same-stretch boundary …", at its second expectation;
  - "a send-back and an inbound brief …", which answers a push on `K`;
  - "the key never reads the hookstate time …", on its first expectation;
  - "a coordinator wait: to the role worker …", which answers a push on `D2 + 3 h` (its CONTROL is green: Task 1 moved
    the key).
- The run-67 hold and the boundary's first expectation are green before and after. T3-M2, T3-M3 and T3-M9 red them.
- `stall-bodies`: the two re-keyed rows and all four new rows (the unmeasured row too: today's text never says "was not
  measured").
- `stall-sweep`: the ten re-keyed assertions (nine rows) and the new row.

- [ ] **Step 3: Implement in `server/src/coord/stall.ts`.**

3a. The `dialog-cap` gloss. Replace
`  'dialog-cap': 'a dialog with no question behind it, past the quiet threshold: one operator push per episode',` with
`  'dialog-cap': 'a dialog with no question behind it, past the quiet threshold: one operator push per dialog, keyed on its live stamp',`.

3b. After `rungDoneAt`'s closing brace (the function whose last statement is
`  return timed.reduce((earliest, n) => Math.min(earliest, n.at), Number.POSITIVE_INFINITY);`), insert:

```ts

/** Is the dialog standing now already pushed (`dialog-cap-keyed-on-the-dialog` (D-3799))? Yes when any dialog-cap row
 *  that still stands was written at or after `since`, the live stamp the pane has read waiting from, WHATEVER ITS KEY.
 *  The pane has shown this one dialog since that stamp, so every push written since reported it: a row the build
 *  before this one keyed on the episode, and a row on a key a coordinator `wait:` has since moved. A row written
 *  before the stamp reported an earlier dialog, so the one standing now gets its own push. A row stands by
 *  `rungDoneAt`'s rule, applied per row: a live row, or a shadow row while the rung's delivery is still shadow. */
function stallDialogCapDone(input: Pick<StallInput, 'notices' | 'arming'>, since: number): boolean {
  const shadowStands = stallNotifyDelivery('dialog-cap', rungRecipient('dialog-cap', 1), input.arming) === 'shadow';
  return input.notices.some((n) => n.arm === 'dialog-cap' && n.rung === 1 && n.at >= since && (n.mode === 'live' || shadowStands));
}
```

3c. Hold 2b in `stallVerdictInner`. Replace:

```ts
  const capKey = f.capKeyMs; // the caps keep the spec's clock and key (`quiet-restarts-on-reactivation` (D-3788))
```

with:

```ts
  const capKey = f.capKeyMs; // the caps keep the spec's clock, the limit cap its key (`quiet-restarts-on-reactivation` (D-3788))
  // The dialog cap's key is its own dialog's live stamp, or the episode's when that is later (`dialog-cap-keyed-on-the-dialog` (D-3799)).
  const dialogKey = Math.max(capKey, live.since);
```

In the next comment line, replace `then 2b (a dialog with no ask, capped once per episode)` with
`then 2b (a dialog with no ask, capped once per dialog)`. Replace:

```ts
  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && rungDoneAt(input, 'dialog-cap', 1, capKey) === null ? capVerdict('dialog-cap', capKey) : holdVerdict('dialog');
```

with:

```ts
  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && !stallDialogCapDone(input, live.since) ? capVerdict('dialog-cap', dialogKey) : holdVerdict('dialog');
```

`live.since` is a measured number here. The live read holds a null stamp before this line (`if (live.since === null)
return holdVerdict('unmeasured')`), and `capQuietSince(input, f, live.since)` on the line above already relies on that
narrowing. The dedupe reads the stamp and the key reads `dialogKey`: the key names the push, and the stamp decides
whether this dialog already had one.

3d. `stallPushText`, `case 'dialog-cap'`. Replace:

```ts
    case 'dialog-cap':
      return {
        title: `⚠ stalled › ${ws} (dialog)`,
        body: `${label}: worker ${worker} shows a dialog with no question behind it; this quiet episode opened ${stallUtc(n.key)} (${stallSpan(now - n.key)}). Mail to the worker, its coordinator's included, cannot land while the dialog shows: answer or dismiss it on the pane.`,
      };
```

with:

```ts
    case 'dialog-cap': {
      // `dialog-cap-keyed-on-the-dialog` (D-3799): the dialog's own stretch, read from the live stamp its key comes from.
      // `n.key` is the episode key whenever the dialog predates the worker's last mail, so it is never printed as the age.
      const w = input.worker;
      const live = w.present && w.live.ok && w.live.since !== null ? { word: w.live.word, since: w.live.since } : null;
      const stretch = live === null
        ? 'its live status was not measured'
        : `its live status has read ${stallSafe(live.word)} since ${stallUtc(live.since)} (${stallSpan(now - live.since)})`;
      return {
        title: `⚠ stalled › ${ws} (dialog)`,
        body: `${label}: worker ${worker} shows a dialog with no question behind it; ${stretch}. Mail to the worker, its coordinator's included, cannot land while the dialog shows: answer or dismiss it on the pane.`,
      };
    }
```

3e. Docstrings, comments only:

| Find (each once) | Replace |
|---|---|
| `` keep `capKeyMs` and `capQuietSince`); `` | `` keep `capQuietSince` and keys no re-activation moves); `` |
| `` /** Exported for tests and for the bodies (Task 6): the derived facts the verdict used. `capKeyMs` is the dialog and `` | `` /** Exported for tests and for the bodies (Task 6): the derived facts the verdict used. `capKeyMs` is the limit cap's key and `` |
| `` *  limit caps' episode: the key without the re-activation term (coordinator ruling on `quiet-restarts-on-reactivation` `` | `` *  the dialog cap's floor (it keys on the later of this and its live stamp, `dialog-cap-keyed-on-the-dialog` (D-3799)): the key without the re-activation term (`quiet-restarts-on-reactivation` `` |
| `` re-activation term, and the caps key on `capKeyMs` (coordinator ruling on `quiet-restarts-on-reactivation` `` | `` re-activation term, and neither cap's key moves with one (coordinator ruling on `quiet-restarts-on-reactivation` `` |
| `` the dialog and limit caps keep `capKeyMs`, which a `` | `` the limit cap keeps `capKeyMs` and the dialog cap keys off it, neither of which a `` |
| `` re-activation does not move), so a restamp by r1's own delivery cannot shorten `` | `` re-activation moves), so a restamp by r1's own delivery cannot shorten `` |

The last two rows are wave 5's `stallSilence` docstring. If either is absent, apply the same meaning to wave 5's words
and report it. Every row is comment text, so no row is needed. Wave 5's T9-M6 and T9-M8 strings are code lines, and they
stay untouched.

- [ ] **Step 4: Run green.** One file per command, from `server/`:

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-verdict stall-bodies stall-sweep stall-session stall-vocabulary; do
  ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^\s+Tests\s' | sed "s/^/$f: /"
done
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-clean
```

Expected: `stall-verdict` +7, `stall-bodies` +4, `stall-sweep` +1 over Task 2's counts. `stall-session` (its dialog row
asserts no key) and `stall-vocabulary`, both green. Both `tsc` runs clean.

- [ ] **Step 5: README, one line in place.** Replace
``worker, an open question, a harness dialog (one `⚠ stalled … (dialog)` push`` with
``worker, an open question, a harness dialog (one `⚠ stalled … (dialog)` push per dialog``. The next line,
`after 2 h), …`, is unchanged. Then the citation instrument (`7 passed | 328 skipped`) and `readme-holds`.

- [ ] **Step 6: Mutations** T3-M1 to T3-M9. Every row red.

- [ ] **Step 7: Commit.**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/stall.ts README.md server/test/stall-verdict.test.ts server/test/stall-bodies.test.ts server/test/stall-sweep.test.ts
git commit -m "fix(stall): the dialog cap is keyed on its dialog's live stamp, once per dialog, and its push names the dialog's age (D-3799)"
```

---

### Task 4: A run-less shadow line carries its key; README says how often a restart repeats (G4, D-3800)

**Files:**
- Modify: `server/src/watch.ts`
  - `applyStallSession`'s run-less shadow line (`:3407`)
  - the docstring's Shadow bullet (`:3388`)
  - both edits are line-neutral
- Modify: `README.md`
  - the run-less latch bullet (`:2677-2681`), five lines for five
  - the runbook sentence (`:2693-2696`), four lines for four
- Test: `server/test/stall-sweep.test.ts`
  - two rows appended at the end of describe `sweepStalls: wave 2, the session arms on every subject kind and the lane's own bookkeeping`
  - the existing orphan-D push row (`:1062-1084`) retitled and extended

**Interfaces:**
- Consumes: nothing new.
- Produces: the log line `ccrc-server: stall-watch shadow <arm> r<rung> <sessionId> (run-less) key <key>`. The key is the
  raw integer `stallDetail` would write: a `restartAt` or `stopAt` epoch, a delivery id, or a first-seen time. It is
  never formatted as a time, because mail-stuck's key is a delivery id. Prefix greps keep matching.

**The decision on the durable latch.** This task corrects the shadow accounting and the documentation. It does not make
the run-less push latch durable. D-3751 accepted the in-memory latch for wave 2, and that holds:
- live exposure is zero (no run-less live push or mail has ever gone out, measured 2026-10-03);
- a durable latch fixes three of the four rungs, because marker-unreadable's key is the in-memory first-seen time and
  re-times on any restart;
- it would cost a migration slot beside wave 5's, and a write on the push path;
- the harm is a re-alert of a true condition, never mail and never a storm.

The deferral is gated, not open-ended: see "Not in this wave". The row this task extends is the one a future durable
latch must deliberately flip.

- [ ] **Step 0: Re-anchor.** Each prints exactly one line:

```bash
grep -nF "this.stallWarnOnce(id, \`shadow-\${v.arm}-\${v.rung}-\${v.key}\`, \`ccrc-server: stall-watch shadow \${v.arm} r\${v.rung} \${id} (run-less)\`);" server/src/watch.ts
grep -nF "   *  - Shadow: a worker records a \`stall-shadow:\` row on its run; a run-less session warns once." server/src/watch.ts
grep -nF "  restart may push each once more. The tag collapses the two on the phone for" README.md
grep -nF "lines before touching \`stall-watch-w2-live\`; \`rm\` it to go back to wave 1's" README.md
grep -nF "a new watcher may push once more (the latch is in memory)', async () => {" server/test/stall-sweep.test.ts
```

- [ ] **Step 1: Write the failing tests.** In `server/test/stall-sweep.test.ts`, describe
`sweepStalls: wave 2, the session arms on every subject kind and the lane's own bookkeeping`, find its last row's tail
(the text occurs once):

```ts
      [ORPHAN, [], D_AT - BACKLOG_HORIZON_MS],
    ]);
  });
```

and insert directly after it, before the describe's closing `});`:

```ts

  it('dark, the run-less shadow line names its key, so a restart\'s repeat reads as the same episode (runless-shadow-line-carries-its-key (D-3800))', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, ORPHAN, ORPHAN_UUID);
    seedCaseD(h.home, ORPHAN, ORPHAN_UUID);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = tickOf(PID, [regRow(ORPHAN, ORPHAN_UUID)]);
    at(D_AT);
    await w.sweepStalls([fleetRow(ORPHAN)], ARMED, t);
    const again = await primedWatcher(h, coord);       // a server restart: the warn-once set is in memory
    at(D_AT + STALL_SWEEP_MS);
    await again.sweepStalls([fleetRow(ORPHAN)], ARMED, t);
    const prefix = `ccrc-server: stall-watch shadow orphan-d r1 ${ORPHAN} (run-less)`;
    expect(lines(warn, prefix)).toBe(2);
    expect(lines(warn, `${prefix} key ${RESTART_AT}`)).toBe(2);
  });

  it('dark, a coordinator\'s mail-stuck shadow line is keyed on its delivery id (runless-shadow-line-carries-its-key (D-3800))', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, COORD, COORD_UUID);
    seedRun(coord, { program: 'demo-program' });
    const id = queuedTo(coord, COORD, INBOUND_AT);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(IDLE_AT + MAIL_STUCK_MS);
    await w.sweepStalls([fleetRow(WORKER), fleetRow(COORD)], ARMED, tickOf(PID, [regRow(WORKER), regRow(COORD, COORD_UUID)]));
    expect(lines(warn, `ccrc-server: stall-watch shadow mail-stuck r1 ${COORD} (run-less) key ${id}`)).toBe(1);
  });
```

The coordinator's live word in that rig is `idle` (one shared live file), so Task 2's busy hold does not touch it.

In the existing row, replace its title line:

```ts
  it('orphan D: ⚠ orphaned once, when the self-mail is still undelivered ORPHAN_PUSH_MS on; a new watcher may push once more (the latch is in memory)', async () => {
```

with:

```ts
  it('orphan D: ⚠ orphaned once, when the self-mail is still undelivered ORPHAN_PUSH_MS on; each new watcher (a server restart) pushes it once more, same tag (the latch is in memory)', async () => {
```

and its last assertion line:

```ts
    expect(spy2.sent).toHaveLength(1);                 // documented (spec §5.2): the tag collapses the two on the phone
```

with:

```ts
    expect(spy2.sent).toHaveLength(1);
    // Once PER restart, not once in total (`runless-shadow-line-carries-its-key` (D-3800) corrects README's "once more"):
    // a third watcher pushes it again, same tag. A durable latch would flip this row, deliberately.
    const spy3 = pushSpy();
    const third = await primedWatcher(h, store(h.home), { push: spy3.push as never });
    at(D_AT + ORPHAN_PUSH_MS + 3 * STALL_SWEEP_MS);
    await third.sweepStalls([fleetRow(ORPHAN)], W2, orphanTick());
    expect(spy3.sent.map((p) => p.tag)).toEqual([`orphaned-${ORPHAN}-${RESTART_AT}`]);
```

- [ ] **Step 2: Run red.** From `server/`:

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-sweep.test.ts
```

Expected (derived): 2 failed (the
two new rows, 0 lines with a key). The extended orphan-D row is green before and after: it pins today's behaviour,
which the README corrected in Step 4 describes.

- [ ] **Step 3: Implement in `server/src/watch.ts`, two lines in place.** Replace:

```ts
        this.stallWarnOnce(id, `shadow-${v.arm}-${v.rung}-${v.key}`, `ccrc-server: stall-watch shadow ${v.arm} r${v.rung} ${id} (run-less)`);
```

with:

```ts
        this.stallWarnOnce(id, `shadow-${v.arm}-${v.rung}-${v.key}`, `ccrc-server: stall-watch shadow ${v.arm} r${v.rung} ${id} (run-less) key ${v.key}`);
```

and replace:

```ts
   *  - Shadow: a worker records a `stall-shadow:` row on its run; a run-less session warns once.
```

with:

```ts
   *  - Shadow: a worker records a `stall-shadow:` row on its run; a run-less session warns once per key, the key in the line (`runless-shadow-line-carries-its-key` (D-3800)).
```

The run-bound shadow lines (`applyStall`'s and the session one's `run ${run.id}` line) are not changed. Each is
deduped durably by its `run_events` row.

- [ ] **Step 4: Run green.** One file per command, from `server/`:

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-sweep mail-sweep; do
  ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^\s+Tests\s' | sed "s/^/$f: /"
done
```

Expected: `stall-sweep` +2 over Task 3's count. The existing rows that grep the run-less line without its key
(`lines()` matches by `includes`) stay green. `mail-sweep` must be green at its count.

- [ ] **Step 5: README, in place.** Replace (five lines):

```
- the run-less operator pushes' latch: `⚠ orphaned` from any session but a run
  worker, and a coordinator's `⚠ mail stuck`, `⚠ marker` and `⚠ failed`. A
  restart may push each once more. The tag collapses the two on the phone for
  every one but `⚠ marker`, whose key is its first-seen time, which a restart
  re-times.
```

with (five lines):

```
- the run-less operator pushes' latch: `⚠ orphaned` from any session but a run
  worker, and a coordinator's `⚠ mail stuck`, `⚠ marker` and `⚠ failed`. Every
  server restart, and every time its row leaves the registry and returns, while one still stands pushes it again (`⚠ orphaned` up to 24 h after its restart, `⚠ failed` up to
  22 h, `⚠ mail stuck` while its delivery stays queued, up to 24 h, `⚠ marker` re-keyed each time); the tag keeps one tray
  entry, but the phone alerts again, and each repeat is one more feed row.
```

and replace (four lines):

```
that window, and after a server restart it is not reported again. Runbook:
hand-classify 48 h of wave-2 `stall-shadow:` rows and `stall-watch shadow`
lines before touching `stall-watch-w2-live`; `rm` it to go back to wave 1's
ladder.
```

with (four lines):

```
that window, and after a server restart it is not reported again. Runbook:
hand-classify 48 h of wave-2 `stall-shadow:` rows and `stall-watch shadow`
lines before touching `stall-watch-w2-live` (a run-less line ends `key <n>`, and a restart or a registry flap repeats it, so count one per session, arm, rung and key; `⚠ marker`'s key re-times); `rm` it to go back to wave 1's
ladder.
```

Then the citation instrument (`7 passed | 328 skipped`) and `readme-holds`.

- [ ] **Step 6: Mutations** T4-M1 and T4-M2. Both red.

- [ ] **Step 7: Commit.**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/watch.ts README.md server/test/stall-sweep.test.ts
git commit -m "fix(stall): a run-less shadow line names its key; README says a restart repeats a run-less push each time (D-3800)"
```

---

## Handoff gate (after the last task)

- [ ] `git fetch origin main` and merge `origin/main` (never rebase). If wave 5 or another branch moved a quoted anchor,
  re-run that task's Step 0, reconcile, and re-run its suites.
- [ ] From `server/`, in the foreground, one file per command, the baseline list:
  - `stall-verdict`, `stall-bodies`, `stall-session`, `stall-sweep`
  - `stall-backoff`, `stall-vocabulary`, `stall-store`
  - `single-definition`, `mail-routes`, `mail-sweep`, `mail-hardening`, `turnidle`, `readme-holds`
  - `topology-clean`, `dtbd`, `typecheck-tests`, `pools-prose`
  - and `deviation-refs` (after the fetch).

  Expected: every suite green, at baseline plus these deltas:

  | Suite | Delta |
  |---|---|
  | `stall-verdict` | +17 |
  | `stall-bodies` | +6 |
  | `stall-session` | +4 |
  | `stall-sweep` | +6 |
  | `stall-store` | +3 |
  | every other suite | +0 |
- [ ] The citation instrument: `7 passed | 328 skipped`.
- [ ] `./node_modules/.bin/tsc --noEmit -p .` and `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`: clean.
- [ ] The whole mutation table, in chunks of at most eight rows per command; every row red; `git diff --exit-code` after.
- [ ] Wave-done mail. It carries:
  - the measured counts (beside this plan's derived ones), and every mismatch;
  - the mutation results;
  - any anchor wave 5 moved that needed reconciling;
  - any departure, by slug.

## Mutation table

Each row edits one site, runs the suites named, restores every file byte for byte and asserts the restore. The reds are
DERIVED from the code (see "Planner's limit"). Measure each row and report the measured reds.

| Row | Site | Mutation | Expected reds (derived) |
|---|---|---|---|
| T1-M1 | `stallToWorker` | drop the role arm (`return m.toId === workerId;`) | 7 at Task 1's Step 6, 8 once Task 3 lands (its wait row's CONTROL). Verdict: "a fix-round …", "an answer …", "a coordinator wait: addressed …", "run 238's shape …", and Task 3's "a coordinator wait: to the role worker while the dialog stands …" (its CONTROL: the key no longer moves). Bodies: both new rows. Sweep: "draws r1 two hours after the brief …" |
| T1-M2 | `stallToWorker` | drop the run conjunct (`… \|\| m.toId === STALL_WORKER_ROLE;`) | 1: verdict "the role worker on a run that is not the subject's …" |
| T1-M3 | `stallFacts` `relevant` | back to `m.toId === workerId` | 6 at Task 1's Step 6, 7 once Task 3 lands. Verdict: "a fix-round …", "an answer …", "a coordinator wait: addressed …", "run 238's shape …", and Task 3's "a coordinator wait: to the role worker while the dialog stands …" (its CONTROL). Bodies: the r1 row. Sweep: the run-238 row |
| T1-M4 | `stallFacts` `inboundLast` | back to `(m) => m.toId === workerId` | 4. Verdict: "a fix-round …" and "an answer …" (`inboundLast`), and "run 238's shape …" (r1 is due 30 s early). Bodies: the r1 row |
| T1-M5 | `stallStillSilent` | back to `m.toId === run.sessionId` | 1: bodies "r3 still-silent counts …" |
| T2-M1 | `stallIdleStart` | delete the busy-hold line | 5. Session: "under the default gate …", "the hold releases …", "the busy hold is bounded" (second), "S2 …" (first). Sweep: the without-marker case |
| T2-M2 | `stallIdleStart` | hold under every mode (drop the mode conjunct) | 3. Session: "the hold releases …" (busy) and the re-scoped "idle is live idle or shell …" row. Sweep: the with-marker case |
| T2-M3 | `stallIdleStart` | release under `busy-shadow` too | 1: session "the hold releases …" (busy-shadow) |
| T2-M4 | `stallIdleStart` | an unbounded hold (`return null;`) | 2. Session: "the busy hold is bounded" (first), "S2 …" (second) |
| T2-M5 | `stallIdleStart` | absent mode reads `busy` | 3. Session: "under the default gate …", "the busy hold is bounded" (second), "S2 …" (first) |
| T2-M6 | `watch.ts` arming | drop `mailMode: mailTurnModeOf(names)` | 1: sweep, the with-marker case |
| T2-M7 | `stallDeafMail` | an unbounded hold (`if (d.deliveredAt === null) return null;`) | 2. Verdict: "an undelivered ball-passing mail is deaf from …" (the push at the bound, and its parked-row line), "past 30 h the coord-ball cap still fires …" (its second expectation answers the cap) |
| T2-M8 | coord-deaf step | time from `deaf.mail.at` | 4. Verdict: "10: a question to the coordinator unacked COORD_DEAF_MS …" (one `it`, at its re-timed `- 1` line), "deaf is timed from the first delivery …", "a replayed delivery …" (its CONTROL), "an undelivered ball-passing mail is deaf from …" (its S4-shape line) |
| T2-M9 | `stallDeafMail` | no hold: a queued, undelivered mail timed from its queue (the whole conditional becomes `deafSince: passed.at }`) | 1: verdict "an undelivered ball-passing mail is deaf from …" (its S4-shape and `- 1` lines) |
| T2-M10 | `stallDeafMail` | a replayed row timed from its newest `deliveredAt` (`deafSince: d.deliveredAt }`) | 2. Verdict: "a replayed delivery …" (its first expectation). Sweep: "is recorded an hour after the question was queued …" |
| T2-M11 | `stallMailFor` | carry no count (`replayCount: 0 });`) | 2. Store: "zero on a fresh row …" (its last expectation). Sweep: "is recorded an hour after the question was queued …" |
| T2-M12 | `stallMailFor` | an unproven count (`{ ok: true as const, value: Number(d.replayCountText) }` for `persistedInt(…)`) | 2: store, both `it.each` rows ("an unsafe count", "a negative count") |
| T2-M13 | `stallDeafMail` | drop the state test: bound every undelivered row (`deafSince: passed.at + DELEGATE_CAP_MS }`) | 1: verdict "an undelivered ball-passing mail is deaf from …" (its parked-row line: a `rejected` row would wait 5 h) |
| T3-M1 | hold 2b | today's line (dedupe and key on `capKey`) | 20 or more: verdict, bodies and sweep (every re-keyed row, and the new key rows) |
| T3-M2 | hold 2b | back to a per-key check (`rungDoneAt(input, 'dialog-cap', 1, dialogKey) === null` for `!stallDialogCapDone(input, live.since)`) | 6. Verdict: run 67's hold, the boundary's first expectation, `:269` (Fable menu after its push), `:708` (caps once), `:1590` (E4 dedupe), "a coordinator wait: to the role worker while the dialog stands …" |
| T3-M3 | `stallDialogCapDone` | `n.at >= since` → `n.at > since` | 1: verdict, the boundary's first expectation |
| T3-M4 | `dialogKey` | from `f.episodeKeyMs` | 2 or more in verdict: `:1573`, `:1589` (their `e4` input carries the re-activation, so the push's key moves). The dedupe reads the stamp, not the key, so "a send-back and an inbound brief …" stays green under it |
| T3-M5 | `dialogKey` | from the hookstate approval's `at` | 1: verdict "the key never reads the hookstate time …" |
| T3-M6 | `stallPushText` dialog-cap | back to "this quiet episode opened <key>" | 5. Bodies: the re-keyed `:439` row, the re-keyed send-back row, and the new rows "names the live status …", "a dialog older …" and "the live word …" |
| T3-M7 | `stallPushText` dialog-cap | print `live.word` without `stallSafe` | 1: bodies "the live word is printed only through stallSafe" |
| T3-M8 | `stallDialogCapDone` | every shadow row stands (`(n.mode === 'live' \|\| n.mode === 'shadow')`) | 1: verdict "a row on the episode key …" (its armed expectation) |
| T3-M9 | `stallDialogCapDone` | no shadow row stands (`(n.mode === 'live')`) | 1 or more: verdict "a row on the episode key …" (its hold under SHADOW), and any existing dialog row whose recorded push is a shadow row |
| T4-M1 | `watch.ts` shadow line | drop ` key ${v.key}` | 2: both new sweep rows |
| T4-M2 | `watch.ts` shadow line | `key ${v.key}` → `key ${v.rung}` | 1: the orphan-D row. The mail-stuck row's delivery id is 1 in that rig, equal to the rung, so it stays green under this one mutation. T4-M1 pins it. |

No row for these sites, said rather than claimed:
- The extended orphan-D push row and the README corrections. They pin and describe today's behaviour, and they add no
  guard.
- The `StallActivation`, `StallFacts`, `capQuietSince`, `stallSilence` and `stallDeafBody` comments.

The runner, `.superpowers/sdd/2026-10-03-stall-watch-w6-review-fixes/mutate.py` (gitignored, never committed), run from
the repo root as `python3 .superpowers/sdd/2026-10-03-stall-watch-w6-review-fixes/mutate.py . ROW …`:

```python
"""Wave 6's mutation runner. Usage: python3 mutate.py <repo root> [ROW ...]. Each row edits its sites, runs its suites
one file per vitest command, restores every file byte for byte, and asserts the restore. A row that stays green is a FAILURE."""
import hashlib, re, subprocess, sys, pathlib, time
ROOT = pathlib.Path(sys.argv[1]).resolve()
ONLY = sys.argv[2:] or None
SL, ST_SRC, W = 'server/src/coord/stall.ts', 'server/src/coord/store.ts', 'server/src/watch.ts'
V, B, S, SW = 'test/stall-verdict.test.ts', 'test/stall-bodies.test.ts', 'test/stall-session.test.ts', 'test/stall-sweep.test.ts'
ST = 'test/stall-store.test.ts'
SUITE_TIMEOUT_S = 900   # Global Constraints: at least 600 s per suite
ROLE = "  return m.toId === workerId || (m.toId === STALL_WORKER_ROLE && m.runId !== null && runs.some((r) => r.id === m.runId));"
BUSY = "  if (live !== null && live.word === 'busy' && (input.arming.mailMode ?? 'shell') !== 'busy') return m.stopAt + DELEGATE_CAP_MS;\n"
HELD = "  if (d.deliveredAt === null) return { mail: passed, deafSince: d.state === 'queued' ? passed.at + DELEGATE_CAP_MS : passed.at };"
REPLAYED = "deafSince: d.replayCount === 0 ? d.deliveredAt : passed.at }"
STANDS = "(n.mode === 'live' || shadowStands)"
DK = "const dialogKey = Math.max(capKey, live.since);"
LINE = "(run-less) key ${v.key}`"
M = [
  ('T1-M1', [(SL, ROLE, "  return m.toId === workerId;")], [V, B, SW]),
  ('T1-M2', [(SL, ROLE, "  return m.toId === workerId || m.toId === STALL_WORKER_ROLE;")], [V]),
  ('T1-M3', [(SL, "(m.fromId === workerId || toWorker(m)))", "(m.fromId === workerId || m.toId === workerId))")], [V, B, SW]),
  ('T1-M4', [(SL, "  const inboundLast = newestMail(relevant, toWorker);", "  const inboundLast = newestMail(relevant, (m) => m.toId === workerId);")], [V, B]),
  ('T1-M5', [(SL, "(m) => stallToWorker(m, run.sessionId, input.subject.runs) && coordinatorIds.has(m.fromId)",
                  "(m) => m.toId === run.sessionId && coordinatorIds.has(m.fromId)")], [B]),
  ('T2-M1', [(SL, BUSY, "")], [S, SW]),
  ('T2-M2', [(SL, "live.word === 'busy' && (input.arming.mailMode ?? 'shell') !== 'busy')", "live.word === 'busy')")], [S, SW]),
  ('T2-M3', [(SL, "(input.arming.mailMode ?? 'shell') !== 'busy')",
                  "(input.arming.mailMode ?? 'shell') !== 'busy' && (input.arming.mailMode ?? 'shell') !== 'busy-shadow')")], [S]),
  ('T2-M4', [(SL, "return m.stopAt + DELEGATE_CAP_MS;", "return null;")], [S]),
  ('T2-M5', [(SL, "(input.arming.mailMode ?? 'shell') !== 'busy'", "(input.arming.mailMode ?? 'busy') !== 'busy'")], [S]),
  ('T2-M6', [(W, ", mailMode: mailTurnModeOf(names) };", " };")], [SW]),
  ('T2-M7', [(SL, HELD, "  if (d.deliveredAt === null) return null;")], [V]),
  ('T2-M8', [(SL, "now - deaf.deafSince >= COORD_DEAF_MS", "now - deaf.mail.at >= COORD_DEAF_MS")], [V]),
  ('T2-M9', [(SL, "deafSince: d.state === 'queued' ? passed.at + DELEGATE_CAP_MS : passed.at }", "deafSince: passed.at }")], [V]),
  ('T2-M10', [(SL, REPLAYED, "deafSince: d.deliveredAt }")], [V, SW]),
  ('T2-M11', [(ST_SRC, "gateSince: gateSince.value, replayCount: replayCount.value });", "gateSince: gateSince.value, replayCount: 0 });")], [ST, SW]),
  ('T2-M12', [(ST_SRC, "persistedInt(d.replayCountText, 'delivery replayCount')",
                       "{ ok: true as const, value: Number(d.replayCountText) }")], [ST]),
  ('T2-M13', [(SL, "deafSince: d.state === 'queued' ? passed.at + DELEGATE_CAP_MS : passed.at }", "deafSince: passed.at + DELEGATE_CAP_MS }")], [V]),
  ('T3-M1', [(SL, "!stallDialogCapDone(input, live.since) ? capVerdict('dialog-cap', dialogKey)",
                  "rungDoneAt(input, 'dialog-cap', 1, capKey) === null ? capVerdict('dialog-cap', capKey)")], [V, B, SW]),
  ('T3-M2', [(SL, "!stallDialogCapDone(input, live.since)", "rungDoneAt(input, 'dialog-cap', 1, dialogKey) === null")], [V]),
  ('T3-M3', [(SL, "n.at >= since", "n.at > since")], [V]),
  ('T3-M4', [(SL, DK, "const dialogKey = Math.max(f.episodeKeyMs, live.since);")], [V]),
  ('T3-M5', [(SL, DK, "const dialogKey = Math.max(capKey, w.hookAsk.kind === 'approval' ? w.hookAsk.at : live.since);")], [V]),
  ('T3-M6', [(SL, "`its live status has read ${stallSafe(live.word)} since ${stallUtc(live.since)} (${stallSpan(now - live.since)})`",
                  "`this quiet episode opened ${stallUtc(n.key)} (${stallSpan(now - n.key)})`")], [B]),
  ('T3-M7', [(SL, "${stallSafe(live.word)}", "${live.word}")], [B]),
  ('T3-M8', [(SL, STANDS, "(n.mode === 'live' || n.mode === 'shadow')")], [V]),
  ('T3-M9', [(SL, STANDS, "(n.mode === 'live')")], [V]),
  ('T4-M1', [(W, LINE, "(run-less)`")], [SW]),
  ('T4-M2', [(W, LINE, "(run-less) key ${v.rung}`")], [SW]),
]
for name, edits, files in M:
    if ONLY and name not in ONLY:
        continue
    saved = {}
    outs = []
    timed_out = []
    try:
        for f, old, new in edits:
            p = ROOT / f
            if p not in saved:
                saved[p] = p.read_bytes()
            text = p.read_text()
            assert text.count(old) == 1, f'{name}: the site is not exactly once in {f}'
            p.write_text(text.replace(old, new, 1))
        t0 = time.time()
        for tf in files:   # one file per vitest command (Global Constraints)
            try:
                r = subprocess.run(['./node_modules/.bin/vitest', 'run', tf], cwd=ROOT / 'server', capture_output=True, text=True,
                                   timeout=SUITE_TIMEOUT_S)
                outs.append(r.stdout + r.stderr)
            except subprocess.TimeoutExpired:
                timed_out.append(tf)
    finally:
        for p, b in saved.items():
            p.write_bytes(b)
    for p, b in saved.items():
        assert hashlib.sha256(p.read_bytes()).hexdigest() == hashlib.sha256(b).hexdigest(), f'{name}: restore failed'
    out = '\n'.join(outs)
    summaries = re.findall(r'^\s+Tests\s+(.*)$', out, re.M)
    reds = sorted(set(re.findall(r'FAIL\s+(test/[\w.-]+ > .+)', out)))
    print(name, '|', ' ; '.join(summaries) or '?', f'| {time.time() - t0:.0f} s', flush=True)
    for tf in timed_out:
        print('     TIMED OUT after', SUITE_TIMEOUT_S, 's:', tf, '(neither red nor green: re-run this row alone)', flush=True)
    for x in reds:
        print('    ', x[:200], flush=True)
    assert reds or timed_out, f'{name}: GREEN under mutation -- the site has no pin'
```

## Not in this wave (recorded so nothing is lost)

- **The durable run-less push latch (G4's remainder). This is a coordinator action, not a worker task.** Ledger R18
  step 5 arms `stall-watch-escalate` and `stall-watch-w2-live` after wave 6 is live, with a live review between them.
  Coordinator ruling on this plan's review: the latch stays deferred, and the coordinator records the gate in the
  ledger's R18 step 5. In the review between the two markers, the operator counts repeated run-less operator pushes
  against `ccrc.service` restarts and registry flaps, then either accepts the repeats or funds the latch. The count is
  `feed_events` rows with the same `sessionId` and title within 24 h. The sketch stays here so nothing is lost. A latch,
  if funded, would take:
  - the next free migration slot after wave 5's, measured at that time and never assumed;
  - a `stall_push_latches(tag TEXT PRIMARY KEY, sessionId TEXT NOT NULL, at INTEGER NOT NULL)` table;
  - a writer that answers `{ latched: true } | { latched: false; why: 'duplicate' }` and never `void`;
  - a prune past `BACKLOG_HORIZON_MS`.

  Even then, marker-unreadable would also need a durable key.
- **The limit cap keeps its once-per-mail-episode shape.** A second limit hold in one episode is still not pushed. Its
  condition carries no onset stamp, so G3's key does not carry over. A known sibling residual, recorded and unfixed by
  coordinator ruling.
- **`mail-gate-strict` with a live `shell`.** The strict gate refuses `shell` by design, and mail-stuck still reads
  `shell` as idle there. No episode measured it, and strict is not armed. Recorded and unfixed by coordinator ruling.
- The spec's text: §4.2's "one dialog-cap operator push per episode", §5.2's mail-stuck and coordinator-deaf rows, and
  §5.2/§9.7's "may push once more" stay as the spec wrote them. These numbers record the departures.

## Deviations found

Four numbers, issued by the coordinator, one per behaviour change. No verifier refuted a defect, so none is dropped.

- **D-3797** — `fix-round-alias-reaches-the-ball` (Task 1): spec §4.2 reads the ball from "the newest mail on the run
  between the worker and anyone except the watch", and it names the coordinator's role id explicitly. Wave 1's
  `stallFacts` matched mail to the worker by its session id alone. So mail addressed to the role `worker` never counted:
  that is the form the coordinator skill instructs, and the form the route stores. This plan reads the role `worker` on
  one of the subject's runs as mail to the worker, which is exactly what `resolveWorker(runId)` resolved. It applies to
  the ball, the inbound term of the quiet and cap clocks, the coordinator's `wait:` (and so the episode key) and r3's
  text. Run-less mail to the role, and the role on another run, stay no one's. The watch's own `stall-check:` lookups
  are unchanged. Argument: the `coordinator` alias was already honoured (`stallCoordinatorIds`), so the asymmetry was a
  defect, not a rule. Measured: 12 of the 23 role mails since 2026-09-25 landed on a coordinator ball, and run 238 sat
  8.7 h with no quiet row. Cost, accepted: more shadow r1s, which is the fix's point. Caps start later from a later
  inbound mail and are never brought forward.
- **D-3798** — `gate-held-mail-is-not-stuck` (Task 2): ONE number for both G2 holds, mail-stuck's and coord-deaf's, as
  the coordinator assigned (the verifier had proposed two slugs). Spec §5.2's mail-stuck row counts "a current marker
  done" as idle whatever the live word. Its coordinator-deaf row times "unacked 1 h" from the ball-passing mail. Under
  the default `shell` gate, `mailTurnIdle` refuses a live `busy` by design, and only `mail-gate-busy` delivers on `busy`
  over a done marker. So both arms reported gate-held mail as a delivery fault. This plan:
  - (a) times mail-stuck's idle clock under a live `busy` over a finished turn from the marker's stop only under
    `mail-gate-busy`, and otherwise from `DELEGATE_CAP_MS` after the stop. The mode comes from the lane's listing
    through `mailTurnModeOf`, and an absent one reads `shell`. The bound keeps a coordinator wedged at `busy`
    reportable.
  - (b) times coordinator-deaf from the delivery the coordinator could hear, while the mail's newest delivery row is
    unacked: from its `deliveredAt` when `replayCount` is 0 (the first delivery), and from the mail's queue time once a
    replay has re-sent it. `sweepMail` re-stamps `deliveredAt` on every replay (`markDelivered`, then
    `bumpReplayCount`), every `MAIL_REPLAY_MS` (10 min) while the gate admits the row, so a clock on that column would
    push an idle coordinator that never acks at about 4.5 h (the 20-replay ceiling parks the row near 3 h 20 min, and
    the hour runs from its last stamp) instead of 1 h. A replayed row was first delivered at least `MAIL_REPLAY_MS`
    before its newest stamp, and never before its queue. `stallMailFor` carries the existing `replayCount` column into
    `StallDeliveryRow` for this; no migration, no new writer.
  - (b′) bounds the gate's hold on a QUEUED, undelivered ball-passing mail (one the gate can still deliver): it counts as deaf once `DELEGATE_CAP_MS +
    COORD_DEAF_MS` (5 h) has passed since it was queued, keyed on the mail id as before. A coordinator in a RUNNING
    turn (marker `working` under a live `busy`: a hung foreground call, a blocking wait loop, a long foreground run)
    has no other arm. Its own mail-stuck needs a finished turn (`stallIdleStart` answers null), and no frozen arm
    watches a coordinator. Unbounded, a worker's question or wave-done to it would wait for the coord-ball cap at 30 h. A row parked before any delivery (`rejected`: `enter-ignored`, the attempt
    ceiling, a dead recipient) is no gate hold and is timed from its queue as before: the check is positive on `queued`,
    so an unnamed state token is timed from its queue too.

  Measured: all 5 wave-2 shadow fires of either arm on 2026-10-02 were gate-held mail behind a progressing subagent or
  workflow, and replayed under (a), (b) and (b′) none fires: S4's coord-deaf delivery was still queued at the fire,
  62 min after its queue and inside the 5 h bound, and delivered 92 s later. Cost, accepted:
  - a coordinator held in a running turn while the mail is still queued is reported at about 5 h, not 1 h. The
    coord-ball cap at 30 h remains behind it, and it is pinned;
  - a replayed row is timed from its queue, so a mail the gate held 50 min or more and then delivered can read deaf at
    its first replay, 10 min after delivery, if the coordinator has not acked by then. Early by at most its hold, and
    never before the hour from its queue;
  - arming `mail-gate-busy` turns (a)'s hold off with no code change.
- **D-3799** — `dialog-cap-keyed-on-the-dialog` (Task 3): spec §4.2 hold 2b gives "one `dialog-cap` operator push per
  episode", and §6's key list puts `dialog-cap` on the episode key. Wave 3's ruling (D-3788) kept it on `capKeyMs`,
  which moves only on the worker's mail, a coordinator `wait:` or the dispatch. So a second dialog in one mail episode
  was never pushed (run 174's second prompt, 16 h and standing). This plan keys the dialog cap on the later of
  `capKeyMs` and the worker's live stamp, which Claude Code rewrites only when the word changes, and so is the dialog's
  onset.
  - Any standing dialog-cap row written at or after that stamp counts as this dialog's push, whatever its key (a row
    stands by `rungDoneAt`'s rule, applied per row). That keeps a dialog the build before this one already pushed on
    the episode key (run 67) from a second push at deploy, and keeps a coordinator `wait:` sent while the dialog
    stands, which Task 1 lets move `capKeyMs` (and so the key) past the stamp, from pushing the same dialog again. A row
    written before the stamp reported an earlier dialog.
  - The push text names how long the live status has read so, not the episode's age.
  - A re-activation and an inbound brief move neither term, so wave 3's protected property holds: a dialog standing
    through a review is one push.
  - The hookstate time is never the key. Every later hook event restamps it while the prompt stands (measured +15 s
    and +20 s).
  - The limit cap keeps `capKeyMs` (residual, above).
- **D-3800** — `runless-shadow-line-carries-its-key` (Task 4): spec §5.2 gives a session on no run "one `ccrc-server:
  stall-watch shadow` line" per rung. §5.2 and §9.7 say the in-memory orphan latch "may push once more" after a
  restart, and D-3751 widened that in-memory set to every run-less operator rung. The shadow line carried no key, and
  its warn-once set is in memory, so each restart re-logged the episode with nothing to tell a census the repeat from a
  new episode (S1: 3 lines, 1 episode). README said a restart pushes "once more" and "the tag collapses the two on the
  phone". In fact the push repeats on every restart, and every time the session's row leaves the registry and returns,
  while the condition stands (`⚠ mail stuck` up to the 24 h mail read), and the service worker re-alerts on a same-tag
  push. This plan:
  - makes the run-less shadow line end `key <n>`, the raw key `stallDetail` would write;
  - corrects README's latch bullet and runbook to "once per restart or registry flap, re-alerting";
  - pins once-per-restart with a third-watcher row.

  It keeps D-3751's in-memory latch: the durable latch is deferred again by coordinator ruling, and the coordinator
  records its gate in ledger R18 step 5 ("Not in this wave"). Argument: zero live exposure was measured; a durable latch cannot cure marker-unreadable's re-timed key; and
  it costs a migration slot. So wave 6 makes the repeat countable and honestly documented, and leaves the cure to a
  measured ruling.

## Self-review (record)

Re-run after the coordinator's rulings on the plan review (rulings 1–6), over every changed passage.

- **Brief coverage.**
  - G1 to G4 each have a task, red-first rows with full code, the implementation, the exact commands and mutation rows.
  - G1 uses the verifier's candidate (a). The run's sessionId conjunct was dropped from the helper: every subject run
    carries the worker's id, so that conjunct was an unpinnable branch.
  - G2 uses the verifier's two holds under one issued number, as the brief assigned. The cross-check row derives each
    mode's answer from `mailTurnIdle`, so `turnidle.ts` stays the one owner of the rule. Coord-deaf takes the review's
    option B (ruling 1): `replayCount` is carried through `stallMailFor`, measured first (Task 2 Step 0 repeats the
    measurement: one column, one writer, one caller, one health read). The queued, undelivered hold is bounded at
    `DELEGATE_CAP_MS + COORD_DEAF_MS` (ruling 2). Both behind new rows with mutations (T2-M7, T2-M9 to T2-M13).
  - G3 uses the verifier's key; its done-check is the generalised same-stretch clause (ruling 3): any standing row
    written since the live stamp, whatever its key. The earlier two-key form is gone, so no equal-key short-circuit
    remains to pin. T3-M2 is the per-key check the ruling names; T3-M8 and T3-M9 pin the per-row standing rule.
  - G4 is "key in the shadow line plus documented bounded repeat", so it uses the slug the brief named for that design.
    README names both repeat triggers and the 24 h bound on `⚠ mail stuck` (ruling 4), line-neutral.
  - Executability (ruling 5): stall-verdict's Task 2 red count is 4 `it`s; T2-M8 is re-derived for the new rows; Step
    3d's docstring names the `busy` mode, not the marker; the Step 3e table cites D-3799 with its slug; every commit
    block starts at the repo root; the runner gives each suite 900 s and reports a timeout as its own outcome.
  - Open questions (ruling 6): none left. The durable latch stays deferred with its gate in ledger R18; the limit cap and
    the strict-mode residual are recorded unfixed; D-3798 names both G2 holds.
  - No number is dropped. No migration is taken.
- **Spec coverage.**
  - §4.2's ball (Task 1).
  - §4.2's hold 2b and its cap (Task 3).
  - §5.2's coordinator-deaf and mail-stuck rows (Task 2).
  - §5.2's run-less shadow accounting and latches (Task 4).
  - §10's order is unchanged: every edit stays inside its step.
- **Wave 5.** No task duplicates or contradicts a wave-5 task:
  - Task 1 sits beside wave 5's `stallCoordBallFrom` and does not touch it.
  - Task 2 edits the coord-deaf `if`, not wave 5's `ballFrom` lines below it. In `stallMailFor` it adds one column to
    statement 2 and one proof to the delivery loop, after wave 5's `delivery-unreadable` line (its Task 3), and leaves
    statement 1 and the `where` clause (its Task 1) alone, so wave 5's EXPLAIN pins do not move. Its new stall-store
    rows assert wave 5's `delivery-unreadable` kind; Step 0 stops if that line is absent.
  - Task 3 amends wave 5's `stallSilence` docstring in its own words, and leaves wave 5's T9 mutation strings alone.
  - Task 1's lane row is the proof that the reshaped read still carries role mail.
- **Placeholders.** None. The four numbers were issued and are written in. Every new row is full code; every derived
  count names its `it`s.
- **Types.** These names are spelled the same in the tasks, the tests and the runner:
  - `STALL_WORKER_ROLE`, `stallToWorker`, `stallDialogCapDone(input, since)`, `dialogKey`;
  - `StallArming.mailMode`, `MailTurnMode`;
  - `StallDeliveryRow.replayCount` (required; the three test helpers and the four store pins carry `0`),
    `replayCountText` in `stallMailFor`;
  - `stallDeafMail`'s `{ mail, deafSince }`, read as `deaf.deafSince` and `deaf.mail.id` in the coord-deaf step;
  - `DIALOG_KEY`.
- **Rings.**
  - `stall.ts` gains one type-only import and no value import, and spells no marker name (Step 3d says "the `busy`
    mode").
  - `watch.ts` passes an L1 reader's answer and decides nothing.
  - `store.ts` (L3) carries one existing column and proves it, deciding zero at the call site; it narrows nothing.
  - No `shared/` edit.
- **Review Focus.** Each of the six lines has its row in the owning task (Tasks 1, 2, 2, 2, 3, 2).
