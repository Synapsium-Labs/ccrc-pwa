# Landing order, wave 5h — the landed reader Implementation Plan

> **COORDINATOR notes: where a design call rested on a code fact the draft found false or incomplete.** The plan
> follows the code as described, and each note names what it did instead. The coordinator accepted all six on
> 2026-11-11; the operator's approval of the plan covers them.
>
> 1. **Decision 10 (exit status).** `CcdResult` carries no exit status: `lifecycle.ts#ccd` folds the runner's `code`
>    into `ok: r.code === 0` and drops it, so `failureDetail` has no exit code to log. The plan adds ONE optional field,
>    `exitCode`, to the `ran: true` arm of `CcdResult` (`coord/ports.ts#CcdResult`), set by `lifecycle.ts#ccd` from the
>    runner's measured code and never on the `ran: false` arm (its code is forged). Optional, not required, because
>    about 30 test files build `CcdResult` literals by hand; a literal with no `exitCode` logs the ending kind alone.
>    `failureDetail` reads the ending through `ccdEnding` (the single reader of `killed` and `signal`). The field moves
>    one pin the ruling did not name: `ran-arm.test.ts`'s "a ran answer (%s) reaches CcdResult as ran:true and nothing
>    else new" lists the ran arm's keys whole, so Task 6 widens it. And `lifecycle.ts#ccd` builds the not-ran arm by
>    spreading the ran `answer`, so `exitCode` is added on the `r.ran !== false` branch only, never on `answer`.
>    D-8308.
> 2. **Decision 5 (scoping `landingFactsInner`).** The all-projects scan is load-bearing, not incidental:
>    `landingEntry.ts#landingFactsOf` takes its id allocator (`nextId` = the highest id of every project's rows and every
>    recovered subject, plus one), its `foreignIds` and the recovery fold's identity-conflict search
>    (`landingRecoveryOf`'s "the same id under another project/pr") from every project's rows. A plain `WHERE project = ?`
>    would let two projects mint the same entry id and hide a cross-project identity conflict. The plan scopes the
>    WHOLE-ROW read to the project and keeps a narrow identity read (`id, project, pr`) of every other project's rows,
>    used exactly where other projects' rows are used today, behind a characterization test committed first.
>    D-8300.
> 3. **Decision 1 (one store function).** `CoordStore.advanceLanding` today is a run's advance: it reads the run row
>    first (`unknown-run`), checks the run's edge (`bad-transition`) and moves the run (`advanceInner`), and the census
>    pins one caller (`landing-entry-census.test.ts`, "advanceLanding has one caller, advanceAct"). A landing moves no
>    run (a no-run entry has none; a hand merge's or an older server's run is already `done`). The plan gives
>    `advanceLanding` a second input arm, `{ kind: 'land', … }`, inside the same `tx(this.db, …)` callback, which moves
>    no run, and moves that census pin to three named callers. The two arms share ONE signature (a generic input with a
>    conditional result type), never overloads: the census's `scan/symbols.ts#symbolOf` refuses a symbol declared more
>    than once, and an overload signature is a declaration. The close's call runs AFTER the close commits, in its
>    own transaction, because `coord/tx.ts#tx` does not nest and `CoordStore.closeRun` already holds one.
> 4. **Decision 1a and decision 4 (the close's facts).** The close does re-measure from a fresh read
>    (`fingerprint.ts#verifyDone` runs `ccd pr-state --session` inside the close), so decision 1a stands. But a
>    `--session` line carries no train number and no train merge commit for a PR a merge train landed (only
>    `landedInTrain`; `train` and `trainMergeCommit` are printed by the PR-keyed form alone, `_pr_py by-pr`). So the close
>    lands only a bound row GitHub reads MERGED (`mergeCommit` present), and a train-landed entry is left to the reader,
>    which carries the train facts. The ruling's "final close" is read as any `state: 'done'` work close: `verifyDone`
>    runs on every one, and the body's `final` says what happens to the workspace, not to the PR. D-8294.
> 5. **Decision 9 (the feed record "for that PR").** `CoordStore.hasNotice` and the `merged` record are keyed per
>    (kind, session, key), the key being `mergedKey(sessionId, pr)`, and `NotifyEvent.sessionId` is a required string
>    that the record deep-links to. A no-run entry writes no record BY CHOICE, not because the sink cannot take one
>    (the feed already archives project-level `coord` records with `sessionId: ''`, `orphanTreeBeat.ts`): it has no
>    session to deep-link to and, with no session, no `hasNotice` key to say the record once. Three consequences the
>    ruling did not weigh, decided here and open to your override: the 99-entry backlog would push 99 times, so the
>    record is pushed only for a merge within `LANDED_FRESH_MS` (one hour), in `record-always` mode (it is archived
>    even while the operator is viewing that session, where `push` would record nothing, `notice.ts#raise`), and is
>    `record-only` otherwise; those 99 rows take 99 of the feed's `FEED_RETENTION` (2000) rows; and the record carries
>    `runId: null`, as `watch.ts#announceMerged`'s does, so it stays out of `GET /api/feed?program=`
>    (`CoordStore.feedEventsForProgram`: a `merged` event belongs to no programme). D-8307.
> 6. **Consequence of decision 5, not a contradiction.** With the default read bounded, the coordinator skill's two
>    reads of "this PR's entry" (`wave-lifecycle-5b-landing.md`'s landing-line paragraph and `wave-steps.md`'s
>    ejection sentence) would read a `landed` or `closed` entry as "no entry", and the first of them lands a PR with no
>    entry. The plan moves both to `?pr=<pr>` and adds `pr` to `ccd/ccrc-api`'s `landing.show` row, so 5h's deploy
>    class gains `ccd` (fleet box first) for `ccrc-api` and the comment-only `ccd/ccd` edits. A THIRD skill read of
>    the line is left as it is: `wave-lifecycle-5-boundary.md`'s "Read `GET /api/landing?project=<project>` first"
>    before `POST /api/landing/order` (and `references/api.md`'s pointer to it). It reads the line to choose
>    `afterIds` and keep an existing entry's values, and the default read is enough there: an order matters only for
>    an entry still in the line (a `landed` or `closed` entry is never head, and an `after` edge to it releases its
>    follower), and a coordinator that reads a terminal entry as absent and turns to the creation door is refused
>    `landing-entry-exists` (`landingWrites.ts#decideLandingMutation`), so nothing is written wrongly.
>    D-8301.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status:** Drafted 2026-11-11 against `origin/main` at `520b11c0d`, from the coordinator's design calls of
> that day (twelve, each a numbered entry under Deviations found). Run 1661 (the run's wave 20) is `planned`.

**Goal:** The landing line learns that an entry landed from GitHub itself, never from a notice. Two callers of one
store function mark it:
- **the landed reader**, a lane of its own, apart from `sweepMerged`'s per-workspace loop, which asks
  `ccd pr-state --project <p> --pr <n>` (wave 5c's form) about each entry still in the line, at most ten a sweep,
  oldest first; and
- **the work run's `done` close**, which already re-measures the PR through `ccd pr-state --session` and now marks
  the entry `landed` when GitHub reads the PR MERGED; a merge train's landing is left to the landed reader, which
  carries the train facts.

A PR GitHub reads closed without merging, or says does not exist, becomes a new terminal state, `closed`. A merged PR
whose head moved is still `landed`, with the head kept. `GET /api/landing` answers the entries still in the line by
default, and one PR's entry in any state with `?pr=<n>`. A failed project sweep logs how ccd ended and its last stderr
line.

**Why:**
- **Nothing writes `landed` on `main`.** The live line of this repository's project, measured on 2026-11-11, holds
  99 entries, every one `pinned` and every PR already MERGED on GitHub; its head is #2061, merged 2026-11-01. Wave 5i
  cannot make the order binding while its head is a merged PR (Carried constraints, from wave 5e's reviews, "To 5h").
- **The cause of the silent merge notices is measured** (the ledger's gate on planning 5h; Carried constraints, from
  wave 5d's landing). Two mechanisms:
  1. **A close-before-sweep race, dominant.** The notice lanes level-read the PR sweep every 120 s. `sweepLanding`
     mails only while an open run waits at `merging` (`coord/landing.ts#landingVerdict` latches on no run, or on a
     run not at `merging`); `sweepMerged` writes its feed record only for an unarchived workspace row. A coordinator
     proves the merge and closes the run 20 to 150 s after it, so the close often lands first and both lanes latch
     silently. About 45 merged PRs of this repository between 2026-10-28 and 2026-11-11 got no `merged:#N` mail,
     most in stretches where the project's sweep was healthy; #2594 (feed record 17 s after its run closed, no mail)
     and #2648 (no record at all: the workspace was archived first) were measured live.
  2. **A failing project sweep.** When `ccd pr-state --project` is not ok, `watch.ts#prPass` sends it to `backoffPr`,
     which marks every workspace of the project `unknown` and backs off up to 900 s. It explains #2029, whose run
     stayed open about 2.5 hours after its merge: the server journal logs the project's sweep failing from 2026-11-02
     13:42Z to 2026-11-05 07:51Z (read once; the refuters could not re-read it). Why ccd failed is unmeasured,
     because `failureDetail` logs only the first stderr line, which was a warning.

  A reader that keys on the PR number and reads GitHub needs neither an open run, nor a live workspace row, nor a
  healthy project sweep (`_pr_state_by_pr` reads no registry).
- **The read is unbounded.** Every entry of every state is answered, and the masker replaces `order`'s shas past
  about 2048 entries (Carried constraints, from wave 5e's reviews, "To 5h").

**Architecture:**
- **Task 1** (`server/src/prstate.ts`): the PR-keyed reader carries a train landing's number and merge commit,
  refuses an `open` or `closed` line with merge facts under a reason of its own, and reads ccd's reason words through
  a closed vocabulary.
- **Task 2** (`shared/landingLine.ts`, `server/src/coord/landingEntry.ts`, `server/src/coord/store.ts`): the `closed`
  word and the terminal map (L0); the land decision and the land arm of the recovery gate (L1); the land arm of
  `CoordStore.advanceLanding` (L3), the one writer of `state = 'landed' | 'closed'` and of `detail` (which its re-pin
  clears).
- **Task 3** (`store.ts`, `landingEntry.ts`, `landingLine.ts`, `landingWrites.ts`, `routes.ts`, `ccd/ccrc-api`): the
  bounded read, and the scoped scan behind it.
- **Task 4** (`server/src/coord/landed.ts` L1, `server/src/coord/landedLane.ts` L4, `laneSchedule.ts`, `watch.ts`,
  `coord/ports.ts`): the landed reader's lane, its per-entry memory and its feed record.
- **Task 5** (`server/src/coord/close.ts`, `routes.ts`, `prstate.ts`, `landed.ts`): the close marks the entry.
- **Task 6** (`lifecycle.ts`, `coord/ports.ts`, `watch.ts`): the sweep failure names its ending and its last line.
- **Task 7** (`ccd/ccd` comments, `pr-timeout-budget.test.ts`): the gh-call budget counts the reader.
- **Task 8** (skills, README, two tests): the coordinator reads its own entry by PR, and review 1660's A1 and A2.
- **Task 9:** the gate, the PR and the wave-done.

**Tech Stack:** TypeScript (Node ≥ 22.16) and `node:sqlite` in the server; bash comments in `ccd/ccd` and one route
row in `ccd/ccrc-api`; Markdown skills; vitest with a temporary coord.db and the fixture HOMEs of `ccdPrHelpers.ts`.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`: §5.5 above all ("Landed state is
PR-keyed", "Entries and pins", "Data"), §5.2 (wave 5c's restatement), §6 (Surfaces touched), §7 (the coord.db
invariant) and §10.
`docs/superpowers/specs/2026-10-24-pr-landing-in-ccrc-design.md` describes `sweepLanding`'s `merged:#<pr>` and
`dequeued:` notices and their durable latches, which 5h reads beside and does not replace.

**Other sources:**
- the ledger, `docs/superpowers/programs/landing-order.md`: row 5h; the Carried constraints from wave 5c's reviews
  (1304, 1306), from wave 5e's reviews ("To 5h"), from wave 5g's reviews ("To 5h's plan"), from wave 5d's landing
  ("To 5h"), wave 3d's F4, review 1216's train item and wave 5a's three stage-5 items; Decisions 2026-11-01 18:39 (A2);
- the 5c plan and departures note (`docs/superpowers/plans/2026-10-30-landing-order-wave5c-pr-keyed-pr-state.md`,
  `…-wave5c-departures.md`; read 5c's shipped text, not its plan's superseded texts), and the 5e, 5f and 5g plans.

**Prerequisite:** waves 5c, 5e, 5f and 5g are on `main`. The fleet box runs 5c's `pr-state-pr-v1` (v0.0.926 on
2026-11-03, the ledger's measurement); the reader asks nothing of a box that does not (`ccdCan(…, 'prStatePr')`).
**Deploy order:** fleet box first (`ccd/ccrc-api`'s new query key, the skills, the comment-only `ccd/ccd` edits),
then the server: a new coordinator text calling an old `ccrc-api` with `--pr` is refused `unknown-query`, which the
skill reads as a failed read and lands nothing.

## Spec amendments on this plan's PR

The coordinator makes these on the plan's own PR, each dated 2026-11-11 and naming wave 5h:
1. **§5.5, Entries and pins:** "`--match-head-commit` and the landed check both read `pinnedSha`" becomes:
   `--match-head-commit` reads `pinnedSha`. The landed check reads the PR by number: a PR GitHub reads MERGED, or
   CLOSED with its train's proof, is `landed` whatever its head, and a head other than `pinnedSha` is kept in the
   entry's `detail`; a PR GitHub reads CLOSED with no train claim, or answers that no pull request has the number, is
   `closed`, a terminal state that leaves the line and that a verified pin re-pins (decisions 3 and 4).
2. **§5.5, Landed state is PR-keyed:** "the pr-state header's gh-call budget counts one call per open landing entry
   per sweep" gains: at most `LANDED_READS_PER_SWEEP` (ten) a sweep across every project, oldest first (decision 2).
   "The coordinator's own merge step also reports the result" becomes: the work run's `done` close, which re-measures
   the PR through `ccd pr-state --session`, marks the entry `landed` when GitHub reads the PR MERGED; a merge train's
   landing is left to the landed reader, which carries the train facts; no route reports a merge (decision 8). After that paragraph, one sentence: `GET /api/landing` answers the entries still in the line,
   and `?pr=<n>` one PR's entry in any state (decision 5).
3. **§5.5, wave 5c's amendment:** "so the form is one `gh pr view` unless a CLOSED PR carries the train label" becomes
   "so the form makes at most one `gh pr view` of its own, and more only when a CLOSED PR carries the train label"
   (5c's text item: an upper bound, not a count).
4. **§5.2, wave 5c's restatement:** "In the second before it is recorded the PR reads MERGED …" becomes "When the
   removal is recorded after the merge, in the second before it is recorded the PR reads MERGED …" (5c's text item:
   true for a removal recorded after the merge only).
5. **§6, Surfaces touched:** the row that puts the "PR-keyed landed reader" in
   `server/src/coord/{schema,store,routes,landing}.ts` and `server/src/watch.ts` names where 5h builds it: the reader in
   `server/src/coord/landed.ts` (L1) and `server/src/coord/landedLane.ts` (L4), its land arm in `store.ts`, the
   close's mark in `close.ts`, the train facts in `prstate.ts`, the sweep's ending in `lifecycle.ts`, and the read's
   `pr` key in `ccd/ccrc-api`.

## What this does not claim
- **No mail.** The `merged:#N` mail lane (`sweepLanding`) is unchanged (decision 9). When the coordinator closes
  before a sweep reads the merge, the mail stays silent: known and harmless, because that coordinator has already
  proved the merge. A coordinator WAITING at `merging` while its project's sweep is blind is still not woken: the
  reader marks the entry and writes the feed record, and sends no mail.
- **No `dequeued:` mail in a blind stretch.** A dequeue while the project's sweep is failing still sends no
  `dequeued:#N` mail (mechanism 2; #2246's 09:11Z dequeue fell inside such a stretch): the landed reader reads a PR's
  state, never a queue removal.
- **No route, no box-token door, no census change** (decision 8). `GET /api/landing` gains a query key, not a route.
- **No migration.** `landing_entries.state` carries no CHECK, and `detail TEXT` has existed, unwritten, since slot 35.
  `COORD_SCHEMA_VERSION` stays 59. `CLAUDE.md` does not change: its sentence on "an uncertain authoritative append
  or landing database commit, including a pin or retreat with no append" already covers a landing's mark, which is a
  landing database commit with no append; README names it.
- **Not mechanism 2's ccd-level cause.** Task 6 makes the next blind stretch name how ccd ended. `prPass` still throws
  away the per-session lines of a non-ok call, and nothing tells a coordinator at `merging` that its project's sweep
  is backing off; each is a later wave's (the research's open options).
- **No `unknown` entry is read or written by the reader**, a quarantined one included, nor an entry whose projection
  is unreadable: their repair is 5i's (Carried constraints, from wave 5f's review, "To 5i"). So a merged PR whose
  entry is `unknown` stays outstanding in `landingLine.ts#landingOrder`, and an entry with an `after` edge to it stays
  held behind it until 5i (D-8298).
- **A closed-then-reopened PR leaves the line until a retreat and a fresh pin.** A PR closed (to re-run CI, say) and
  reopened while its run waits at `merging` can be read `closed` by a reader pass in between; the reopen is not seen,
  because nothing reads a terminal entry again. A coordinator on 5h's text reads the entry `closed` through `--pr`,
  lands nothing and reports to the operator; recovery is a retreat from `merging` and a fresh verified pin, which
  re-pins the `closed` row (D-8297). A coordinator still holding the pre-5h reference text (a
  long-lived session that read it before the deploy) reads the default line, finds no entry, and lands as the
  verdict says: a stale-context residual this wave does not close.
- **A refused train proof is read every fifteen minutes.** A CLOSED PR whose train claim the record refuses reads
  `unmeasured`/`train-unproven` for good; the reader backs it off to `PR_BACKOFF_MAX_MS` like any retry, so the entry
  stays `pinned` (possibly the line's head for 5i) and costs one `gh pr view` every fifteen minutes. Only a standing
  `missing-field` gets the hourly backoff (decision 6).
- **The reader's re-reads repeat the train-record write.** For a CLOSED train-labelled PR, `ccd/ccd#_pr_state_by_pr`
  calls `_ws_train_record … 1` before `_pr_py by-pr` decides the line, so every re-read of a PR whose proof is
  refused or unread replaces that member's line in the fleet registry's tried file (`.train-tried`, best effort, one
  line per member, dropped after a day) and a proof is kept once found. That is acceptable: each write replaces the
  member's own line, a fresh `failed` line (`PR_TRAIN_TRIED_TTL`, 30 minutes) spares the gh calls, and a proved PR is
  marked `landed` on that read and never read again (5c's carried item, answered).
- **A missing or dotted project reads `no-remote`,** the same word as an origin that is not GitHub (5c's carried
  item). The reader retries it like any `unmeasured` answer; Task 1 says so in `no-remote`'s gloss, and splitting the
  word is a later ccd wave's.
- **An entry whose PR stays open after its run ended stays `pinned`.** Taking it out is 5j's withdraw door; nothing in
  5h writes `withdrawn`.
- **`detail` is written and not read.** No wire field carries it; a later view may. It describes the last mark: the
  land UPDATE writes it, and a verified re-pin of a `closed` row clears it (`detail = NULL`), so a re-pinned entry
  never carries a stale `{"word":"closed",…}`.
- **No feed record for a no-run entry**, by choice (COORDINATOR note 5).
- **No PWA change.** `closed` and `entriesScope` reach no screen until 5k.
- **No binding order or next-to-land mail** (5i), **no doors** (5j, 5k).
- **The three stage-5 leftovers, answered** (decision 12):
  - wave 3d's F4 (an open PR whose last queue act is a `merged` removal and which never reads MERGED) is NOT served:
    the PR-keyed form reads the same OPEN state, so the entry stays `pinned`. Its run-side bound stays a later wave's;
  - review 1216's train-landed spent producer is NOT served by the reader: the proof is the coordinator's own read at
    its close. What would serve it is the coordinator reading 5c's form itself (`ccd pr-state --project <p> --pr <n>`,
    whose `merged` with a train needs no workspace row), in the next wave that edits the merge-train proof text;
  - wave 2's closed-unmerged PR reading `unmeasured` per workspace is unchanged; its line side is served by `closed`.
- **5d's A2 is an evidence limit, stated:** the cross-suite semantics of GitHub's default check-run filter were not
  verified, and nothing here reads check attempts. The latest-attempt rule (D-7546) and the verdict fence stand.
- **A rolled-back server** reads a `closed` row as `unknown` (outstanding for an `after` edge, so its follower waits,
  and never re-pinned by that build) and ignores `detail`.
- **The reader's memory is in-process.** A restart re-reads every due entry from scratch, within the same cap.

## Global Constraints
- **Modules first.** Run `npm ci` in `server/` before Task 1.
- **A temporary coord.db and fixture HOMEs only.** Never run `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
- **Tests.**
  - Every file runs as `cd server && "$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>.test.ts`,
    in the foreground, with a Bash timeout of at least 600000 ms.
  - `typecheck-tests` runs alone. `tsc --noEmit` runs for the server.
  - `pr-sweep` and `session-hook` are known load flakes: re-run a red one alone before calling it a break.
- **The architecture rules.**
  - `coord.db` stays synchronous; the land arm is one synchronous call with no await between its facts, its decision
    and its write.
  - Decide in L1 (`landingEntry.ts`, `landed.ts`, `landingLine.ts`, `landingWrites.ts`), act in L4 (`landedLane.ts`,
    `close.ts`, `routes.ts`, `watch.ts`). The store runs SQL only.
  - L0 `shared/landingLine.ts` imports nothing. `landed.ts` imports values only from `shared/`,
    `server/src/laneSchedule.ts` and `server/src/coord/landingEntry.ts` (its `isLandable` predicate, L1), and types
    only (`import type`) from `prstate.ts`, `coord/landingEntry.ts`, `coord/landingWrites.ts` and `notice.ts`
    (`LandingLand`, `LandingOutcome`, `LandingMutationFacts`, `NoticeRecord`, `NoticeMode`); `coord-policy-rings.test.ts`'s
    runtime walk checks the value half. `landingEntry.ts` keeps its one value import, `shared/landingLine.js`
    (`landing-entry-census.test.ts` pins it).
  - No overloaded null at a seam: `exitCode` absent means "the producer did not measure it" and is never read as 0;
    `expect: null` means "no compare-and-set" (the close), never "the entry was not read".
- **No migration.** Re-measure on `origin/main` before the PR:
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` prints 59 today, and
  this wave adds none; `coord-db.test.ts` is not edited.
- **The verdict fence is byte-identical.** On `origin/main` at `520b11c0d` the 256 body lines of
  `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`'s `bash` block hash to
  `910acd8e24f088d599a9ce9babfef4a13f72deed446c4f375b878c13a8b2d620`, measured with:

  ```bash
  awk '/^```bash$/{f=1;next} f&&/^```$/{exit} f' ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md | sha256sum
  ```
- **`ccd/ccd` edits are comment-only and line-neutral:** each changed comment keeps its line count, so the citation
  census in `session-hook.test.ts` does not move. If a rewrap cannot stay line-neutral, stop and report it; do not
  re-measure the census on your own.
- **The verb gate.** The lane's `CCD_ARGV.prStatePr(` call and its `ccdCan(deps.fleetState, 'prStatePr')` sit in one
  function whose whole signature is on one line (`verb-gate.test.ts`'s scanner reads it so) and whose return type
  holds no `{` (a named type, `LandedPassResult`), because `verb-gate.test.ts#isHandlerHead`'s head pattern stops at
  the first brace after the parameter list; and the call's result is
  narrowed on `ran === false` within twelve code lines (`consolidationCensus.ts#RAN_NARROW_WINDOW`), so
  `consolidation-census.test.ts` classifies the site `explicit`.
- **Growth.** Run `growth-check` with `GROWTH_CHECK=1` after `git fetch origin main`. Growth of `store.ts`,
  `watch.ts`, `close.ts`, `routes.ts` and `prstate.ts` is waived by the new files under `server/src/coord/`
  (`growthCheck.ts#L1_L2_NEW_FILE_DIRS`), so no waiver is written. Report each net delta.
- **One state at push.** Commit each task on the workspace's own branch. Two windows are red BY DESIGN:
  - between Task 2 and Task 5, `landing-entry-census.test.ts`'s three-callers case: Task 2 writes it for the end
    state, Task 4 adds the lane's call and Task 5 the close's (every other census case stays green, because
    `advanceLanding` keeps one declaration);
  - between Task 3 and Task 8, `coordinator-skill.test.ts`'s client-verb pin: Task 3 adds `pr` to `ccrc-api`'s
    `landing.show` row, and Task 8 names it in the skills.

  Push nothing until Task 9's gate is green.
- **`CLAUDE.md` does not change.**
- **Skill text.** No clause is added or removed (`CONTRACT` stays twenty in `coordinator-skill.test.ts`). No new skill
  sentence holds a double quote. Every paragraph written in a `references/` file wraps at 80 columns.
- **Words.** "The landed reader" in prose; the lane's row is `landed`; "mark" for the land arm's write. `closed` is
  the entry's word; GitHub's is CLOSED.
- **Cite code by symbol or `@anchor`,** never by file and line.
- **Mutations.** Run them sequentially in the worktree, bounded with `timeout -k` and a measured `ulimit -u`. Restore
  each mutated file from a saved copy with its sha256 checked, never with `git checkout`, and keep each row's log under
  `.superpowers/sdd/`.
- **Neutral names only.** The repository is public (`project-a`, `project-b`, `prog-a`, `lane-a`).
- **Deviation numbers are issued, never chosen.** This plan's entries, D-8294 to D-8314, were issued by
  the allocator to the coordinator on 2026-11-11. A departure found during execution is named by slug in the wave-done.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **Landed never rests on a notice** (decision 1). The reader reads every `pinned` or `ejected` entry with a readable
   projection by its PR number, whether or not it has a run, whether or not its run is open, and whether or not the
   project's per-workspace sweep is failing. The close marks the entry from the measurement it already makes.
2. **One writer** (D-7611, D-7614). Every write of `landing_entries` is still inside `CoordStore.advanceLanding` but
   for 5f's no-run creation INSERT; `detail` is written by two statements, both inside `advanceLanding`: the land
   UPDATE sets it and the re-pin UPDATE clears it; the land UPDATE touches `state` and `detail` and nothing else;
   `advanceLanding` has one declaration (no overloads) and exactly three callers, each named.
3. **Fail closed.** An `unmeasured` read, a reader refusal, a failed call, a compare-and-set miss, the landing fence,
   a recovery hold on the entry's own subject and an identity conflict in its project each write nothing. An
   `unknown` row is never read or written. Only `merged` marks `landed`, and only `closed` or `absent` marks `closed`.
   **The blast radius of the reader's own failure:** the landed reader is the first UNATTENDED writer that can set
   the landing fence. A throw in its UPDATE or COMMIT sets the one global `landingFence`, which refuses every
   project's pin, so every coordinator's advance to `merging` is refused, and it clears only on a restart. The lane
   says so once per process (`ccrc-server: landed reader: …`), when its mark fences the line and when a pass stops on
   a store refusal; nothing else logs a fence being set.
4. **Bounded cost** (decisions 2 and 6). At most `LANDED_READS_PER_SWEEP` calls a pass, oldest first, the least
   recently read before the rest; a standing `missing-field` is read at most once an hour; a call that did not run
   ends the pass; a pass's worst case is under its row's `staleAfterMs`. A refused train proof (`train-unproven`) is
   NOT backed off past `PR_BACKOFF_MAX_MS`: it is read every fifteen minutes for good (What this does not claim).
5. **The bounded read** (decision 5). The default answers no terminal entry; `?pr=` answers its entry in any state;
   the allocator, `foreignIds` and the recovery fold read what they read before (the characterization test).
6. **The feed record is said once** (decision 9): built by ONE builder (`landed.ts#mergedNoticeOf`, which
   `watch.ts#announceMerged` now calls too), read through `hasNotice` on `sweepMerged`'s own key, so neither lane
   repeats the other; `record-always` within the hour after the merge (archived even while the session is on screen)
   and `record-only` after it; `runId: null`, so it stays out of every programme's feed; none for a no-run entry.
7. **The close** marks only a bound row GitHub reads MERGED, only on a `done` close, only after the close committed,
   and never changes the close's answer.
8. **A PR closed and reopened while its run waits at `merging`.** A reader pass in between marks the entry `closed`
   and it leaves the default read. A coordinator on 5h's text reads `closed` through `--pr` and stops for the
   operator (recovery: retreat, then a fresh verified pin); one on the pre-5h text reads no entry and lands as the
   verdict says (What this does not claim).

**Task order:** 1, 2, 3, 4, 5, 6, 7, 8, 9. A test that needs an earlier task's code says so, and its red-first is
measured after that task is on the branch.

---
### Task 1: the PR-keyed reader's train facts, its merge-facts refusal and its reason words

**Files:**
- Modify: `server/src/prstate.ts` (`PrStatePrRead`, `readPrStatePrLine`, a new `PR_STATE_PR_REASON_MAP`)
- Modify (test): `server/test/prstate-pr-line.test.ts`, `server/test/ccd-pr-state-pr-words.test.ts`

**Interfaces:**
- Produces, in `prstate.ts`:
  - `type PrStatePrReason = Extract<PrReason, 'no-remote' | 'timeout' | 'unauthenticated' | 'rate-limit' | 'offline' |
    'unavailable' | 'truncated' | 'error' | 'train-unproven' | 'train-unread'> | 'unreadable' | 'missing-field'`, with
    `PrReason` from `shared/api.ts`, so renaming a shared word is a compile error here; and
    `PR_STATE_PR_REASON_MAP: Record<PrStatePrReason, string>` (each word with a gloss) and
    `PR_STATE_PR_REASONS = Object.keys(…)`. The twelve words `_pr_state_by_pr` and `_pr_py by-pr` print: `no-remote`,
    `timeout`, `unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error` (the last six are
    `_gh_fail_reason`'s), `unreadable`, `missing-field`, `train-unproven`, `train-unread`. It is a subset map, and
    legitimately different from `PR_REASON_MAP`: it is the PR-keyed form's CLOSED set, which holds two words the
    session form never prints and leaves out the five it cannot (`unsupported`, `agent-down`, `merge-unproven`,
    `branch-drift`, `cut-short`). `prstate.ts` then holds thirteen of `PR_REASONS`' fifteen tokens; the
    `single-definition/core-vocab.test.ts` scan reds a file holding all fifteen (quoted, or as an object key), so
    neither `unsupported` nor `branch-drift` is written there in either form.
    `no-remote`'s gloss names both of its causes: no project directory or a dotted name, and an origin that is not
    GitHub (5c's carried item).
  - `PrStatePrRead`'s arms become:
    - `{ state: 'merged'; pr; facts; train: { number: number; mergeCommit: string } | null }` (was `'proved' | null`);
    - `{ state: 'unmeasured'; pr; by: 'ccd'; reason: PrStatePrReason | 'unrecognised' | 'unstated'; train }`, where a
      string outside the map reads `unrecognised` and a missing, empty or non-string reason reads `unstated`;
    - `{ state: 'unmeasured'; pr; by: 'reader'; reason: 'line-count' | 'not-json' | 'pr-mismatch' | 'word' |
      'train-flags' | 'fields' | 'merge-facts'; train: null }`.
- The rules `readPrStatePrLine` adds, in its existing order:
  - a `merged` line with `landedInTrain: true` must carry `train`, a positive safe integer, and `trainMergeCommit`, a
    40-hex sha; otherwise it is refused `fields`. Every other line must carry both as `null` (or omit them); otherwise
    `train-flags`.
  - **One rule for the merge-facts split** (decision 7): an `open` or `closed` line that carries `mergedAt` or
    `mergeCommit` is refused `merge-facts`. ccd prints such a line as it reads GitHub, so the reader, not ccd, is the
    one place this contradiction is judged, and it never reads as `open`, `closed` or `merged`. ccd's grammar is not
    narrowed.

- [ ] **Step 1: Write the failing tests.**
  - `prstate-pr-line.test.ts`, two existing cases rewritten first, because the new rules turn them red:
    - "merged by GitHub carries mergedAt and mergeCommit; merged by the train says proved" becomes "… merged by the
      train carries its train": its train-landed line carries `train: 50` and `trainMergeCommit: 'e'×40` and is
      expected as `train: { number: 50, mergeCommit: 'e'×40 }` (a `landedInTrain: true` line without them is now
      refused `fields`);
    - the it.each rows "open with a mergedAt" and "closed with a mergeCommit" now expect `merge-facts`, not `fields`
      (the first is the existing guard behind 5H-READ-2);
  - and new cases:
    - `a train-landed line with no train number, a train of 0 or a short merge commit is refused fields`;
    - `a line without the train flag that carries a train is refused train-flags`;
    - `an open or a closed line carrying mergedAt or mergeCommit is refused merge-facts, never fields` (four rows);
    - `a reason in ccd's vocabulary passes through; bogus reads unrecognised; 42 and '' read unstated`.
  - `ccd-pr-state-pr-words.test.ts`:
    - the train-proved case expects `train: { number: 50, mergeCommit: <the train row's merge commit> }`;
    - `every reason word the PR-keyed form prints is the server's, and no other`: a fixture table with one row per
      `PR_STATE_PR_REASONS` word, driving ccd through `makePrHarness` (no GitHub repo for `no-remote`; `ghViewFail(41, 124)`
      for `timeout`; `ghViewFail(41, 1, <stderr>)` with `HTTP 401`, `rate limit`, `dial tcp`, `HTTP 503`,
      `unexpected EOF` and an unknown text for the six gh words; a view whose `number` is 42 for `unreadable`; a view
      whose `baseRefName` is `main+x` for `missing-field`; the existing train helpers for `train-unproven` and
      `train-unread`). Each row asserts the printed `reason` and `readPrStatePrLine(…).reason`, and a first case
      asserts the table's words equal `PR_STATE_PR_REASONS`.
    - `one line, byte for byte` (5c's carried item, D-7600: `h.sh` trims stdout, so no pin sees the trailing
      newline): the `open` fixture's `cmd_pr_state --project demo --pr 41` with its stdout redirected to a file in the
      fixture HOME (`> "$HOME/line.out"`), read back with `readFileSync`, ends in exactly one `\n` and holds no other
      newline. It is green on `main`'s ccd (a characterization, not a red-first case).
- [ ] **Step 2: Run them and see them fail.**
  ```bash
  cd server && "$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/prstate-pr-line.test.ts test/ccd-pr-state-pr-words.test.ts
  ```
  Expected: the new cases FAIL (the reason reads `fields`, `bogus` passes through, the train facts are absent), and
  so do the two rewritten existing cases: the train case (`train` is `'proved'`, not `{ number, mergeCommit }`) and
  the "open with a mergedAt" and "closed with a mergeCommit" rows (they read `fields`, not `merge-facts`). The
  byte-level case passes.
- [ ] **Step 3: Implement** the map, the arm types and the three rules.
- [ ] **Step 4: Run the two files, `single-definition/*` and `prstate.test.ts`, and see them pass.**
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-READ-1 | the merged train arm answers `train: null` | prstate-pr-line: the train facts are absent |
| 5H-READ-2 | the `merge-facts` check is removed (the line falls to `fields`) | prstate-pr-line: the "open with a mergedAt" row reads `fields` |
| 5H-READ-3 | the reason is passed through unchecked | prstate-pr-line: `bogus` passes through |
| 5H-READ-4 | `missing-field` is removed from the map | words: the table no longer equals the map, and the row reads `unrecognised` |

```bash
git add server/src/prstate.ts server/test/prstate-pr-line.test.ts server/test/ccd-pr-state-pr-words.test.ts
git commit -m "feat(landing): the PR-keyed reader carries a train's facts, refuses merge facts on open or closed, and reads ccd's reasons through a closed vocabulary (landing-order 5h)"
```

---
### Task 2: the `closed` word, the land decision and the one writer's land arm

**Files:**
- Modify: `shared/landingLine.ts` (`LANDING_ENTRY_STATE`, a new `LANDING_ENTRY_TERMINAL`)
- Modify: `server/src/coord/landingEntry.ts` (`decideLandingWrite`, `landingHoldGate`, new `decideLandingLand`)
- Modify: `server/src/coord/store.ts` (`CoordStore.advanceLanding`, new `CoordStore.landingReadProjects`)
- Create (test): `server/test/landing-land-words.test.ts`, `server/test/landing-land-store.test.ts`
- Modify (test): `server/test/landing-entry-store.test.ts`, `server/test/landing-line-order.test.ts`,
  `server/test/landing-entry-census.test.ts`

**Interfaces:**
- Produces, in `shared/landingLine.ts` (L0):
  - `LANDING_ENTRY_STATE.closed`: 'GitHub reads the PR closed without merging, or answers that no pull request has its
    number'. `landingOrder` needs no change: a `closed` entry is not `pinned`, so it is never in the line, and not
    outstanding, so an `after` edge to it releases its follower.
  - `LANDING_ENTRY_TERMINAL: Record<LandingEntryState, boolean>` (`pinned`, `ejected` and `unknown` false; `landed`,
    `withdrawn` and `closed` true) and `LANDING_TERMINAL_STATES`, derived from it. A new state is a compile error until
    it is classified.
- Produces, in `landingEntry.ts` (L1):
  - `LANDING_LANDABLE_STATES = ['pinned', 'ejected'] as const`.
  - `isLandable(state: LandingEntryState, projection: LandingProjectionRead | null): boolean`: the state is in
    `LANDING_LANDABLE_STATES` and the projection is `readable` with no quarantine marker. The ONE copy of that rule:
    `decideLandingLand` and Task 4's `landed.ts#landedCandidatesOf` both call it.
  - `type LandingOutcome = { word: 'merged'; head: string; base: string; mergedAt: string | null; mergeCommit: string |
    null; train: { number: number; mergeCommit: string } | null } | { word: 'closed' | 'absent' }`.
  - `interface LandingLand { kind: 'land'; project: string; pr: number; by: 'close' | 'reader'; at: number; outcome:
    LandingOutcome; expect: { id: number; pinnedAt: number } | null }`. `expect` is the reader's compare-and-set: the
    entry it read before the GitHub call. `null` is the close's: a merge is final, so no later pin can make it untrue.
  - `type LandingLandWrite = { kind: 'landed' | 'closed'; entry: LandingEntry } | { kind: 'kept'; state:
    LandingEntryState } | { kind: 'no-entry' } | { kind: 'moved' }`.
  - `decideLandingLand(f: { land: LandingLand; current: LandingEntry | null; projection: LandingProjectionRead | null }):
    { act: 'land'; id: number; state: 'landed' | 'closed'; detail: string } | { act: 'none'; write: LandingLandWrite }`.
    In order: no row is `no-entry`; an `expect` whose id or `pinnedAt` differs is `moved`; `!isLandable(…)` is `kept`; else
    `merged` marks `landed` and `closed` or `absent` marks `closed`. `detail` is one JSON object:
    `{"v":1,"by":…,"at":…,"word":…}` plus, for `merged`, `base`, `mergedAt`, `mergeCommit`, `train` and
    `trainMergeCommit` (both `null` when no train), and `head` ONLY when it differs from `pinnedSha` (decision 4).
  - `landingHoldGate`'s `kind` gains `'land'`: an identity conflict anywhere in the project answers
    `landing-identity-conflict`; the entry's own `(project, pr)` among the recovery's subjects answers
    `landing-recovery-unresolved`; anything else passes, because a mark only takes an entry out of the line and never
    chooses a head.
  - `decideLandingWrite`'s pin re-pins a `closed` row as it re-pins an `ejected` one: GitHub lets a closed PR reopen,
    and only a verified pin can bring it back. `landed` and `withdrawn` stay `kept`. The re-pin UPDATE in
    `advanceLanding` gains `detail = NULL` beside `baseSha`, `ejectionKind` and `quarantineKind`, so a re-pinned row
    never carries the old mark's `detail`.
- Produces, in `CoordStore`:
  - ONE signature, no overloads (`scan/symbols.ts#symbolOf` throws "declared 3 times" on an overloaded method, and
    every census case that reads `symbolOf(STORE, 'CoordStore.advanceLanding')` would go red):
    `advanceLanding<I extends LandingRunAdvance | LandingLand>(input: I): AdvanceLandingResultOf<I>`, where
    `LandingRunAdvance = { runId: number; to: RunState; causedBy: string; landing: LandingAdvance }` (today's input,
    named) and `AdvanceLandingResultOf<I> = I extends LandingLand ? LandingLandResult : LandingAdvanceResult`; each
    arm's `return` casts once to that type. The land UPDATE stays inside that one symbol's span. The land arm is a
    branch of the SAME `tx(this.db, …)` callback, written after the run arm: `landingGuard`, `landingFactsInner(project)`, the
    current row by `pr` and its projection, `landingHoldGate(…, 'land', …)`, `decideLandingLand`, then one
    `UPDATE landing_entries SET state = ?, detail = ? WHERE id = ?`, and the row read back. It reads no run, calls no
    `advanceInner` and writes no run event. Its effects phases and its catch are the pin's: a throw once the line was
    reached answers `landing-db-apply` or `landing-db-commit` with `mayApply: true` and fences the line.
    `LandingLandResult = { ok: true; landing: LandingLandWrite } | ({ ok: false } & LandingInfrastructureFailure) |
    { ok: false; error: 'landing-recovery-unresolved' | 'landing-identity-conflict' }`.
  - `landingReadProjects(): { ok: true; projects: string[] } | ({ ok: false } & LandingInfrastructureFailure)`: behind
    `landingGuard`, the distinct projects with a row whose `state` is in `LANDING_LANDABLE_STATES` (the SQL list
    joined from that constant), sorted.

- [ ] **Step 1: Write the failing tests.**
  - `landing-land-words.test.ts` (pure): the terminal map and its derived list (`['closed', 'landed', 'withdrawn']`
    sorted); `decideLandingLand`'s five answers, one case each, and its `detail` parsed back with `JSON.parse` and
    compared whole (merged at the pinned head has no `head` key; merged at another head has it; a train outcome
    carries `train` and `trainMergeCommit`; `closed` and `absent` carry only `v`, `by`, `at` and `word`);
    `landingHoldGate(…, 'land', …)`'s three answers (another subject held in the project passes).
  - `landing-land-store.test.ts`, with real runs and pins in a temporary coord.db (`landingFixture.ts#landingStoreOver`,
    pins in the shape `landing-entry-store.test.ts` makes them):
    - a pinned entry, and an ejected one, mark `landed`; `closed` and `absent` mark `closed`;
    - the mark moves no run: the run's row and its `run_events` are byte-identical before and after;
    - a `landed`, `withdrawn`, `closed`, raw-`unknown` and quarantined row is `kept` and unchanged;
    - no row is `no-entry`; a re-pin between the read and the mark (`expect.pinnedAt` older) is `moved` and writes
      nothing;
    - the entry's own recovered subject is refused `landing-recovery-unresolved`; another project-held subject does
      not stop it; a cross-project identity conflict is refused `landing-identity-conflict`;
    - a fenced store answers `landing-fenced`; a store with no journal port answers `landing-journal-unavailable`;
    - a throw in the UPDATE (a `BEFORE UPDATE` trigger, the shape of `landing-entry-store.test.ts`'s "a throw in the
      entry write") answers `landing-db-apply` with `mayApply: true`, and the next `readLanding` answers
      `landing-fenced`;
    - `landingReadProjects` lists a project with a pinned or ejected row once, and not a project whose rows are all
      terminal.
  - `landing-entry-store.test.ts`: `a verified pin re-pins a closed row` (state `pinned`, new head, new `pinnedAt`,
    `detail` null after a mark had set it); the existing `it.each(['landed', 'withdrawn'])` kept case stays.
  - `landing-line-order.test.ts`: `a closed entry is never head and releases the entry after it`.
  - `landing-entry-census.test.ts`:
    - "advanceLanding owns pin, repin, ejection and quarantine …" expects `['INSERT', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE']`;
    - new: `detail has two statements, both inside advanceLanding: the land UPDATE writes state and detail and nothing
      else, and the re-pin UPDATE clears it` (as `quarantineKind` already has a writer and a clearer);
    - new: `advanceLanding is declared once` (`symbolOf` answers, no overload signature);
    - new: `decideLandingLand has one call, inside advanceLanding`;
    - "advanceLanding has one caller, advanceAct" becomes `advanceLanding has three callers: advanceAct, the close's
      land step and the landed lane's pass, and only advanceAct passes a run arm` (the other two calls' text holds
      `kind: 'land'`). Until Tasks 4 and 5 add the two callers, this case is written for the end state and left red,
      named in the commit message.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the L0 word and map, the L1 decision and gate arm, and the two store members.
- [ ] **Step 4: Run** the five files, `landing-journal-store.test.ts`, `landing-advance-route.test.ts`,
  `landing-writes.test.ts`, `rings/shared-imports.test.ts` and `coordinator-skill.test.ts` (its L0 import of
  `LANDING_ENTRY_STATES`), **and see them pass**, the three-callers census case excepted.
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-LAND-1 | `decideLandingLand` drops its landable-state check | store: a `landed` row is rewritten |
| 5H-LAND-2 | the `expect` compare-and-set is removed | store: the re-pinned case writes |
| 5H-LAND-3 | a head other than `pinnedSha` answers `kept` | words and store: the head-moved case |
| 5H-LAND-4 | `absent` marks `landed` | store: the absent case |
| 5H-LAND-5 | the land arm of `landingHoldGate` ignores the entry's own subject | store: the held subject marks |
| 5H-LAND-6 | a second `UPDATE landing_entries SET state` is added in a new store method | census: a write outside `advanceLanding` |
| 5H-LAND-7 | `decideLandingWrite` stops re-pinning `closed` | entry-store: the closed re-pin |
| 5H-LAND-8 | `landingOrder` counts `closed` as outstanding | order: the follower is held |
| 5H-LAND-9 | the land arm does not call `landingGuard` | store: the fenced case writes (`landingFactsInner` is unguarded) |
| 5H-LAND-10 | the land arm of `landingHoldGate` ignores an identity conflict | store: the cross-project conflict case marks |
| 5H-LAND-11 | `isLandable` ignores the projection | store: the quarantined row is rewritten |
| 5H-LAND-12 | the re-pin UPDATE stops clearing `detail` | entry-store: the closed re-pin keeps its `detail`; census: the clearer is missing |
| 5H-LAND-13 | `advanceLanding` is split into two overload signatures | census: `symbolOf` throws, every writer case reds |

```bash
git add shared/landingLine.ts server/src/coord/landingEntry.ts server/src/coord/store.ts server/test/landing-land-words.test.ts server/test/landing-land-store.test.ts server/test/landing-entry-store.test.ts server/test/landing-line-order.test.ts server/test/landing-entry-census.test.ts
git commit -m "feat(landing): the closed word and the land arm of the one writer (landing-order 5h); the three-callers census case is red until Tasks 4 and 5"
```

---
### Task 3: the bounded read and the scoped scan behind it

**Files:**
- Create (test, FIRST): `server/test/landing-facts-scope.test.ts`
- Modify: `server/src/coord/store.ts` (`landingFactsInner`), `server/src/coord/landingEntry.ts` (`LandingStoreRows`,
  `landingFactsOf`)
- Modify: `server/src/coord/landingWrites.ts` (new `parseLandingReadQuery`), `server/src/coord/landingLine.ts` (new
  `landingViewOf`; its header's "Two deciders" becomes three), `server/src/coord/routes.ts` (the `GET /api/landing`
  handler), `shared/landingLine.ts` (`LandingLineView.entriesScope`)
- Modify: `ccd/ccrc-api` (`[landing.show]` accepts `project,pr`)
- Modify (test): `server/test/landing-read-route.test.ts`, `server/test/ccrc-api.test.ts`,
  `server/test/landing-entry-census.test.ts`

**Interfaces:**
- `LandingStoreRows` gains `foreign: Record<string, unknown>[]`: every OTHER project's rows, `id, project, pr` only.
  `entries` holds this project's rows whole. `landingFactsOf` uses `foreign` exactly where it used other projects'
  rows: the allocator's ids, `foreignIds`, and the recovery fold's conflict and exact-identity search. An invalid id
  or pr in a foreign row still refuses the whole snapshot.
- `parseLandingReadQuery(q: unknown): { ok: true; project: string; pr: number | null } | { ok: false; detail: string }`:
  `project` required and trimmed, with today's detail; `pr` absent, or a decimal positive safe integer with no
  leading zero, else `bad-request` with the detail `the landing read takes ?pr= as a PR number: a positive integer with no leading zero`.
- `landingViewOf(entries: readonly LandingEntry[], flags: LandingLineFlags, recovery: LandingRecovery, pr: number | null):
  { entries: LandingEntry[]; order: LandingOrder; entriesScope: 'open' | 'pr' }`: `order` is `landingOrder` over
  every entry, as today; `entries` is the non-terminal ones (`LANDING_ENTRY_TERMINAL`) when `pr` is null, else that
  PR's entry in any state, or none.
- `LandingLineView.entriesScope?: 'open' | 'pr'`. Absent from an older server, whose `entries` are every entry.
- The route answers `{ ok: true, project, operatorPaused, mainRedHold, entries, order, recovery, entriesScope }`.

- [ ] **Step 1: The characterization test, green on the old scan.** `landing-facts-scope.test.ts`, on two projects
  with entries in each, a recovered subject in each, an identity conflict across them (the same id under another
  project), and an entry of each state: `readLanding('project-a')`'s whole `facts` (entries, `nextId`, `foreignIds`,
  `recovery`, projections, dependencies, coordinators) `toEqual` a literal; and a foreign row with an invalid `pr`
  answers `landing-projection-unreadable`. Run it on the branch before Step 3 and see it pass; commit it alone.
- [ ] **Step 2: Write the failing tests.**
  - `landing-read-route.test.ts`:
    - `the default read answers only the entries still in the line, and says so`: pinned, ejected and unknown listed;
      landed, withdrawn and closed absent; `entriesScope: 'open'`; `order` unchanged;
    - `?pr= answers that PR's entry in any state, beside the same flags and order`: a `landed` entry, `entriesScope: 'pr'`;
    - `?pr= naming no entry answers no entries and the line's order`;
    - `?pr=0, ?pr=07, ?pr=x, ?pr=-1 and a pr past the safe range answer 400 bad-request with the pr detail`;
    - the existing "answers every entry of the project …" case is renamed to "every entry still in the line".
  - `ccrc-api.test.ts`: `the landing read carries its pr`: `landing show --project project-a --pr 41` requests
    `/api/landing?project=project-a&pr=41`.
  - `landing-entry-census.test.ts`: `landingFactsInner reads its own project's rows whole and every other project's
    rows as id, project and pr only` (its two `landing_entries` SELECTs, by the statement scanner).
- [ ] **Step 3: Implement** the scoped scan, the parse, the view and the route; then the `ccrc-api` row.
- [ ] **Step 4: Run** `landing-facts-scope.test.ts`, `landing-read-route.test.ts`, `ccrc-api.test.ts`,
  `landing-entry-census.test.ts`, `landing-journal-store.test.ts`, `landing-writes-route.test.ts`,
  `box-token-census.test.ts`, `auth-gate.test.ts` and `secret-mask.test.ts` (no count moves: no route is added),
  **and see them pass**, but for the two red-by-design cases (Global Constraints, One state at push).
- [ ] **Step 5: Measure the mutation rows, then commit** (the characterization commit first, then this one).

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-VIEW-1 | the default read stops filtering terminal entries | read-route: a landed entry is listed |
| 5H-VIEW-2 | `?pr=` filters terminal entries too | read-route: the landed PR answers none |
| 5H-VIEW-3 | the pr grammar accepts a leading zero | read-route: `07` answers 200 |
| 5H-VIEW-4 | the foreign identity read is dropped | facts-scope: `nextId` and the conflict differ |
| 5H-VIEW-5 | `landing.show` drops `pr` | ccrc-api: `unknown-query` |

```bash
git add server/test/landing-facts-scope.test.ts
git commit -m "test(landing): characterize one project's landing facts across two projects before the scan is scoped (landing-order 5h)"
git add server/src/coord/store.ts server/src/coord/landingEntry.ts server/src/coord/landingWrites.ts server/src/coord/landingLine.ts server/src/coord/routes.ts shared/landingLine.ts ccd/ccrc-api server/test/landing-read-route.test.ts server/test/ccrc-api.test.ts server/test/landing-entry-census.test.ts
git commit -m "feat(landing): GET /api/landing answers the entries still in the line, and ?pr= one PR's entry in any state; the scan reads other projects by identity only (landing-order 5h)"
```

---
### Task 4: the landed reader's lane

**Files:**
- Create: `server/src/coord/landed.ts` (L1, context C4), `server/src/coord/landedLane.ts` (L4, context C4; its header
  declares L4, as `close.ts`'s does)
- Modify: `server/src/laneSchedule.ts` (`LaneName`, `LANE_SCHEDULE`), `server/src/watch.ts` (`sweepLanded`, the tick's
  dispatch, the lane's memory; `mergedKey` and `mergedBody` move out; `announceMerged` builds its record through
  `mergedNoticeOf`), `server/src/coord/ports.ts`
  (`WatcherCoordMember` gains `advanceLanding`, `landingReadProjects` and `readLanding`, each in its sorted place)
- Modify: `server/src/prstate.ts` (comment only: the PR-keyed form's section header, "nothing in the server calls it
  yet", now names its caller, `coord/landedLane.ts#landedPass`)
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the C4 row of the context table names
  `coord/landed.ts` and `coord/landedLane.ts`, beside the other landing files)
- Create (test): `server/test/landed-decide.test.ts`, `server/test/landed-lane.test.ts`
- Modify (test): `server/test/coord-policy-rings.test.ts` (`POLICY` gains `landed.ts`)

**Interfaces:**
- Produces, in `landed.ts` (L1, pure; imports as Global Constraints, The architecture rules, say):
  - `LANDED_READS_PER_SWEEP = 10`; `LANDED_STANDING_BACKOFF_MS = 60 * 60_000`; `LANDED_FRESH_MS = 60 * 60_000`.
  - `mergedKey(id, number)` and `mergedBody(number, reason)`, MOVED from `watch.ts` unchanged; `watch.ts` imports them.
  - `interface LandedCandidate { project: string; id: number; pr: number; pinnedAt: number; pinnedSha: string; runId: number | null }`.
  - `landedCandidatesOf(facts: LandingMutationFacts): LandedCandidate[]`: the entries for which
    `landingEntry.ts#isLandable(entry.state, projection)` holds, the same predicate `decideLandingLand` calls, so the
    L4 lane decides nothing about which entries are landable.
  - `interface LandedMemory { pinnedAt: number; lastReadAt: number; nextAt: number; step: number; missingStreak: number }`.
  - `pickLandedReads(cands: readonly LandedCandidate[], memory: ReadonlyMap<number, LandedMemory>, now: number, cap = LANDED_READS_PER_SWEEP): LandedCandidate[]`:
    due candidates only (no memory, a memory for another `pinnedAt`, or `nextAt <= now`), never-read first, then the
    least recently read, then the earlier `pinnedAt`, then the lower id; at most `cap`.
  - `landedAnswerOf(read: PrStatePrRead | { state: 'call-failed' }): { act: 'land'; outcome } | { act: 'close'; outcome } | { act: 'wait' } | { act: 'retry'; missingField: boolean }`:
    `merged` lands with its facts (train included); `closed` and `absent` close; `open` waits; `unmeasured` (ccd's
    or the reader's) and a failed call retry, `missingField` true only for ccd's `missing-field`.
  - `landedNext(prev: LandedMemory | undefined, cand: LandedCandidate, answer, now: number): LandedMemory`: `wait`
    is due one `PR_SWEEP_MS` later and resets the step; `retry` doubles the step from `PR_SWEEP_MS` up to
    `PR_BACKOFF_MAX_MS`; the second `missing-field` in a row (decision 6) is due `LANDED_STANDING_BACKOFF_MS` later,
    and any other answer resets the streak.
  - `mergedNoticeOf(f: { pr: number | null; reason: string | null; sessionId: string; workspace: string; key: string })`:
    the ONE builder of a `merged` feed record: `{ kind: 'merged', sessionId, title: '✓ merged › <workspace>', body:
    mergedBody(pr, reason), runId: null, dedupeKey: key, tag: 'merged-<key>' }`. `watch.ts#announceMerged` calls it
    with `r.workspace` and its own key (its record and push are byte-identical to today's, which `pr-sweep.test.ts`
    holds); the landed reader calls it with `mergedKey(sessionId, pr)` and a workspace it derives (the run's branch's
    last segment, or the session id). `runId` is `null` on both, so a `merged` record stays out of
    `CoordStore.feedEventsForProgram` (a `merged` event belongs to no programme).
  - `landedNoticeModeOf(mergedAt: string | null, now: number): NoticeMode`: `record-always` when `mergedAt` is within
    `LANDED_FRESH_MS` of `now` (archived even while the operator is viewing that session, where `push` would record
    nothing, `notice.ts#raise`; still pushed when nobody is viewing), `record-only` otherwise or with no `mergedAt`
    (decision 9; COORDINATOR note 5).
- Produces, in `landedLane.ts` (L4):
  - `interface LandedLaneDeps { coord: Pick<WatcherCoordPort, 'advanceLanding' | 'hasNotice' | 'landingReadProjects' | 'readLanding' | 'run'>; runCcd: RunCcd; fleetState?: FleetState; notice: NoticeSink; now: () => number; memory: Map<number, LandedMemory>; warn: (line: string) => void }`.
  - `export type LandedPassResult = { read: number; landed: number; closed: number; stopped: null | 'unsupported' | 'store' | 'link' }`,
    a NAMED type, so the signature below holds no `{` before its body (Global Constraints, The verb gate).
  - `landedPass(deps: LandedLaneDeps): Promise<LandedPassResult>`:
    1. no `prStatePr` capability: `unsupported`, no call;
    2. `landingReadProjects`, then `readLanding` per project; a refused read stops the pass (`store`) or skips that
       project (a project-level refusal);
    3. `landedCandidatesOf(facts)` gives the candidates (the lane re-states no landable rule); `pickLandedReads`
       chooses;
    4. per pick, `runCcd(CCD_ARGV.prStatePr(project, pr))`: `ran: false` records a retry and ends the pass (`link`);
       a ran-but-failed call is `call-failed`; else `readPrStatePrLine`;
    5. `land` or `close` calls `advanceLanding({ kind: 'land', …, by: 'reader', expect: { id, pinnedAt } })`; a
       written mark drops the entry's memory and, for `landed`, calls `raiseLandedNotice`; `moved`, `kept` and
       `no-entry` drop the memory; an infrastructure failure ends the pass (`store`); a recovery refusal is due next
       sweep.
    6. The second `missing-field` in a row warns once per entry per process:
       `ccrc-server: landed reader: <project> #<pr> reads missing-field twice; reading it hourly`.
    7. The reader's own fence and its stops warn once per process each (Review Focus 3): a mark answered
       `landing-db-apply` or `landing-db-commit` warns
       `ccrc-server: landed reader: the mark of <project> #<pr> answered <error>; the landing line is fenced until the server restarts`,
       and a pass stopped on `landing-fenced`, `landing-journal-unavailable` or `landing-db-unavailable` warns
       `ccrc-server: landed reader: stopped (<error>); no entry is read until it clears`, once per error word.
  - `raiseLandedNotice(f: { coord: Pick<WatcherCoordPort, 'hasNotice' | 'run'>; notice: NoticeSink; entry: LandingEntry; mergedAt: string | null; now: number }): 'raised' | 'already' | 'no-session'`:
    no `runId`, an unreadable run or a run with no session is `no-session`; `hasNotice('merged', sessionId, key,
    mergedBody(pr, null))` true is `already`; else one `notice(mergedNoticeOf(…), landedNoticeModeOf(mergedAt, now))`.
    A throw from `hasNotice` raises, as `sweepMerged` does.
- `LANE_SCHEDULE` row: `{ name: 'landed', cadenceMs: PR_SWEEP_MS, clock: 'mono', flight: 'skip', staleAfterMs:
  PR_SWEEP_STUCK_MS, warnKey: 'ccrc-server: the landed reader lane failed', derivedFrom: { name: 'PR_SWEEP_MS',
  reason: 'the reader reads what the PR lane reads, at its beat' } }`.
- `FleetWatcher.sweepLanded()`: returns at once in remote mode with the agent disconnected (`sweepPr`'s guard); else
  `runLane('landed', () => landedPass({ …, notice: noticeSink(this.deps), memory: this.landedMemory }))`. The tick
  dispatches it beside `sweepPr`, never awaited, with `?.catch(() => {})`.

- [ ] **Step 1: Write the failing tests.**
  - `landed-decide.test.ts`: the pick order and cap (twelve never-read candidates pick the ten earliest `pinnedAt`;
    a re-pinned entry is due at once); `every candidate read before: the least recently read comes first, though its
    pinnedAt is later` (two due candidates, both with memories, the one with the older `lastReadAt` having the LATER
    `pinnedAt`, and a cap of 1: the pick is that one); each read's answer; the backoff's steps to the cap; the
    standing streak (one `missing-field` is an ordinary retry, the second is due an hour later, an `open` between them
    resets it); `landedCandidatesOf` (a pinned and an ejected entry with a readable projection are candidates; a
    terminal, an `unknown`, a quarantined and an unreadable-projection entry are not); `mergedNoticeOf`'s record
    whole (`runId: null`, title, tag, key, body) for the reader's inputs and for `announceMerged`'s; the mode on both
    sides of `LANDED_FRESH_MS` (`record-always`, then `record-only`) and with no `mergedAt`; `mergedBody`'s two
    sentences byte for byte.
  - `landed-lane.test.ts`, with a temporary coord.db, real runs and pins, and a fake `runCcd` that answers each
    `pr-state --project <p> --pr <n>` with a line built for that PR and records each call:
    - `the backlog: twelve merged entries mark ten on the first pass, oldest first, and the last two on the second`;
      each run's session has one `merged` record with `runId: null`, `record-only` for a merge older than an hour;
    - `a fresh merge whose session the operator is viewing is still archived` (a viewer stub reporting the session
      visible: one row in the feed, no push);
    - `a session that already has its merged record gets no second one`;
    - `an open entry stays pinned, and eleven open entries are all read within two passes`;
    - `closed and absent mark closed`; `a merged PR at another head marks landed with the head in its detail`;
      `a train landing marks landed with its train`;
    - `a second missing-field in a row is not read again within the hour`;
    - `a timeout backs off by doubling to fifteen minutes`;
    - `a call that did not run ends the pass: no further call`;
    - `no pr-state-pr-v1 capability: no call`; `a fenced store: no call, and one stopped warning across two passes`;
    - `a mark that throws in its UPDATE fences the line, ends the pass, and warns once` (a `BEFORE UPDATE` trigger, as
      in `landing-land-store.test.ts`; the next pass makes no call and adds no second fence warning);
    - `a no-run entry marks landed and raises no record`;
    - `a pin between the read and the mark answers moved and writes nothing; the next pass reads it again` (the fake
      runner pins the entry while it answers). The test controls the clock, because the compare-and-set is
      `{ id, pinnedAt }` and the store's re-pin writes `pinnedAt = Date.now()`: with `vi.useFakeTimers({ toFake:
      ['Date'] })`, the runner calls `vi.setSystemTime(Date.now() + 1000)` before it re-pins, so the re-pin's
      `pinnedAt` always differs from the one the pass read.
  - `coord-policy-rings.test.ts`: `coord/landed.ts` has no runtime path to `node:sqlite`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the L1 file, the lane, the row, the watcher's wiring and the port's members; move the two
  helpers and route `announceMerged`'s record through `mergedNoticeOf`; reword `prstate.ts`'s PR-keyed section header
  to name its caller; add the two files to the context table's C4 row.
- [ ] **Step 4: Run** the three files, `citations.test.ts` (the header's new citation), `pr-sweep.test.ts` (the moved
  helpers' and `announceMerged`'s characterization: unchanged and green),
  `lane-schedule.test.ts`, `rings/*` (`watcher-store-port`, `totality`), `verb-gate.test.ts`,
  `consolidation-census.test.ts`, `landing-entry-census.test.ts` (still red on the close caller only) **and see them
  pass.**
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-LANE-1 | the cap is not applied | lane: twelve read in one pass |
| 5H-LANE-2 | the pick sorts by id, newest first | decide and lane: the oldest are not first |
| 5H-LANE-3 | `lastReadAt` is ignored in the pick | decide: "every candidate read before" picks the earlier `pinnedAt` |
| 5H-LANE-4 | the standing backoff is removed | lane: a third call within the hour |
| 5H-LANE-5 | the `ran: false` stop is removed | lane: calls continue after the link fails |
| 5H-LANE-6 | `raiseLandedNotice` skips `hasNotice` | lane: a second `merged` record |
| 5H-LANE-7 | the mode is always `push` | decide: an old merge pushes; lane: the viewed fresh merge has no row |
| 5H-LANE-8 | the capability check is removed | lane: a call with no capability (and `verb-gate`) |
| 5H-LANE-9 | the pass continues past a store refusal | lane: a call after a fenced read |
| 5H-LANE-10 | the fence warning is removed | lane: the throwing mark logs no warning |
| 5H-LANE-11 | `mergedNoticeOf` writes the record's `runId` | decide: the record's `runId` is not null |
| 5H-LANE-12 | `landedCandidatesOf` drops the `isLandable` call | decide: the `unknown` and quarantined entries are candidates |

```bash
git add server/src/coord/landed.ts server/src/coord/landedLane.ts server/src/laneSchedule.ts server/src/watch.ts server/src/coord/ports.ts server/src/prstate.ts docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md server/test/landed-decide.test.ts server/test/landed-lane.test.ts server/test/coord-policy-rings.test.ts
git commit -m "feat(landing): the landed reader reads each entry still in the line by PR number, ten a sweep, oldest first, and marks it landed or closed (landing-order 5h)"
```

---
### Task 5: the close marks the entry

**Files:**
- Modify: `server/src/prstate.ts` (new `mergedFactsOf`, `type PrMergedFacts`)
- Modify: `server/src/coord/landed.ts` (new `closeLandingOf`; it lands here, with the type it reads, so no commit
  holds a function whose parameter type a later task creates)
- Modify: `server/src/coord/close.ts` (`CloseRunDeps.notice`, `closeWorkRun`, a new `landOnClose`)
- Modify: `server/src/coord/routes.ts` (the close route's `closeDeps` passes `notice`)
- Modify (test): `server/test/run-routes.test.ts` (the `POST /api/runs/:id/close` describe, whose runner already fakes
  `pr-state --session` through `makeRunner`'s `prState` and `prRow`), `server/test/prstate.test.ts`,
  `server/test/landed-decide.test.ts`

**Interfaces:**
- `closeLandingOf(f: { state: 'done' | 'failed'; facts: PrMergedFacts | null; project: string; at: number }): LandingLand | null`
  in `landed.ts` (`PrMergedFacts` a type-only import from `prstate.ts`): a `done` close with merged facts lands
  `by: 'close'`, `expect: null`; anything else is null.
- `mergedFactsOf(line: CcdPrLine): PrMergedFacts | null`, `PrMergedFacts = { pr: number; head: string; base: string;
  mergedAt: string; mergeCommit: string }`: the bound row (`boundRow`) when `isMergedRow` holds AND GitHub reads it
  MERGED with a merge commit; null for a train-landed row (a `--session` line carries no train number) and for every
  other phase (COORDINATOR note 4).
- `CloseRunDeps.notice?: NoticeSink`.
- `landOnClose(deps, run: RunRow, line: CcdPrLine, at: number): void`: after `coord.closeRun` committed a `done` work
  close, `closeLandingOf({ state, facts: mergedFactsOf(line), project: run.project, at })`; a non-null land calls
  `deps.coord.advanceLanding(…)`, and a `landed` mark calls `raiseLandedNotice` when `deps.notice` is present. It
  never changes the close's answer: a refusal or a throw prints one line,
  `ccrc-server: close of run <id> could not mark <project> #<pr> landed (<error>)`, and the close answers as before.
  The abandon and review arms never call it.

- [ ] **Step 1: Write the failing tests.**
  - `prstate.test.ts`: `mergedFactsOf` answers a MERGED bound row's facts, and null for a train-landed row, an open
    row, a merge-unproven row and a line with no bound row.
  - `landed-decide.test.ts`: `closeLandingOf`'s three answers (a `done` close with facts lands by the close with
    `expect: null`; a `done` close with no facts and a `failed` close are null).
  - `run-routes.test.ts`, each run driven to `merging` with a pin through the store first:
    - `a done close that re-measures the PR merged marks its entry landed, by the close, and raises one merged record`;
    - `a claim of open that measures merged still marks it` (forward motion);
    - `a done close that measures the PR open leaves the entry pinned`;
    - `an abandon of the claim (state failed) asks no pr-state and leaves the entry pinned`;
    - `a train-landed row leaves the entry to the reader`;
    - `a fenced landing store still answers 200 done and leaves the entry pinned, with one warning line`;
    - `a session whose merged record sweepMerged already wrote gets no second one`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the facts reader, `closeLandingOf`, the dep, the land step and the route's wiring.
- [ ] **Step 4: Run** the three files, `landing-entry-census.test.ts` (now green whole: three callers),
  `close-decide.test.ts`, `close-gate-order.test.ts`, `child-reclaim-close.test.ts` and `sweep-close.test.ts`
  **and see them pass.**
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-CLOSE-1 | the land step is not called | run-routes: the entry stays pinned |
| 5H-CLOSE-2 | the close marks on any measured phase | run-routes: the open case marks |
| 5H-CLOSE-3 | `mergedFactsOf` answers a train-landed row | prstate and run-routes: the train case marks |
| 5H-CLOSE-5 | `closeLandingOf` lands a `failed` close with facts | decide: the failed case is not null |
| 5H-CLOSE-4 | a refused mark throws out of the close | run-routes: the fenced case is not 200 |

```bash
git add server/src/prstate.ts server/src/coord/landed.ts server/src/coord/close.ts server/src/coord/routes.ts server/test/run-routes.test.ts server/test/prstate.test.ts server/test/landed-decide.test.ts
git commit -m "feat(landing): a work run's done close that re-measures its PR merged marks the entry landed (landing-order 5h)"
```

---
### Task 6: a failed project sweep names how ccd ended and its last line

**Files:**
- Modify: `server/src/coord/ports.ts` (`CcdResult`'s ran arm gains `exitCode?: number`), `server/src/lifecycle.ts`
  (`ccd`), `server/src/watch.ts` (`failureDetail`)
- Modify (test): `server/test/pr-sweep.test.ts`, `server/test/lifecycle.test.ts`, `server/test/ran-arm.test.ts`

**Interfaces:**
- `lifecycle.ts#ccd` sets `exitCode: r.code` on the `ran: true` arm only: it is added on the `r.ran !== false`
  branch (`{ ...answer, exitCode: r.code }`), never on the `answer` object, because the not-ran arm is built as
  `{ ...answer, ok: false, ran: false, … }` and would copy it.
- `failureDetail(res: CcdResult): string`:
  - the not-ran arm: `res.detail`, as today;
  - the ran arm: the ending, through `ccdEnding`: `exit <n>` (exited, `exitCode` present), `exited` (no `exitCode`),
    `signal <NAME>`, `deadline` or `ending unmeasured`; then `; first: <the first stderr line>`; then, when the last
    non-empty stderr line differs from the first, `; last: <that line>`. Each line is cut at 160 characters.
  - The log line keeps its shape: `ccrc-server: PR sweep of <p> failed (<reason>: <detail>); retrying in <n>s`.

- [ ] **Step 1: Write the failing tests.**
  - `pr-sweep.test.ts`: `a failed sweep logs exit 3, the first and the last stderr line` (a three-line stderr);
    `a one-line stderr logs no last`; `a deadline kill logs deadline under cut-short`; `a signal logs its name`;
    `a call that did not run logs the runner's detail`.
  - `lifecycle.test.ts`: `ccd carries the exit code on the ran arm, 0 and 2 alike, and never on the not-ran arm`; its
    whole-object `toEqual`s of `ccd()`'s answer gain `exitCode`.
  - `ran-arm.test.ts`, describe "ccd() carries the arm, and nothing else moves": the it.each "a ran answer (%s)
    reaches CcdResult as ran:true and nothing else new" expects the keys `['exitCode', 'killed', 'ok', 'ran',
    'signal', 'stderr', 'stdout']` and `res.exitCode` equal to the answer's code; the three not-ran cases each also
    assert `'exitCode' in res` is false (the first's whole `toEqual` already holds it).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement**, `exitCode` on the `r.ran !== false` branch only.
- [ ] **Step 4: Run** the three files and `consolidation-census.test.ts` (`failureDetail` still reads `ran` first)
  **and see them pass.**
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-DETAIL-1 | the last line is dropped | pr-sweep: no `last:` |
| 5H-DETAIL-2 | `ccd` drops `exitCode` | lifecycle and pr-sweep: `exited`, not `exit 3` |
| 5H-DETAIL-3 | `ccd` sets `exitCode` on `answer` (so the not-ran arm copies it) | lifecycle and ran-arm: present on the not-ran arm |

```bash
git add server/src/coord/ports.ts server/src/lifecycle.ts server/src/watch.ts server/test/pr-sweep.test.ts server/test/lifecycle.test.ts server/test/ran-arm.test.ts
git commit -m "fix(pr): a failed project sweep logs how ccd ended and its last stderr line beside the first (landing-order 5h)"
```

---
### Task 7: the gh-call budget counts the reader, and `_gh_fail_reason`'s past tense

**Files:**
- Modify: `ccd/ccd` (comments only, line-neutral: `cmd_pr_state`'s header, `_gh_fail_reason`'s 504 paragraph)
- Modify (test): `server/test/pr-timeout-budget.test.ts`

**Interfaces:**
- `cmd_pr_state`'s header keeps "and one for `--project <p> --pr <n>`" and `PR_GH_VIEW_TIMEOUT`, and says that this
  form is the one count that grows with the line: the server's landed reader asks it once per open landing entry it
  reads in a sweep, at most `LANDED_READS_PER_SWEEP` (`server/src/coord/landed.ts`) a sweep across every project, about
  300 an hour at the cap, 6 % of the GraphQL allowance beside the PR lane's 5 % (decision 2).
- `_gh_fail_reason`'s paragraph says the window `_gh_pr_list` USED to send answered `HTTP 504 …` (5c's text item).

- [ ] **Step 1: Write the failing tests** in `pr-timeout-budget.test.ts`'s 5c describe:
  - `the header counts the PR-keyed form once per open landing entry per sweep and names the reader's cap`: the header
    contains `once per open landing entry` and `LANDED_READS_PER_SWEEP`, and `server/src/coord/landed.ts` exports that
    name as a positive integer;
  - `the reader's worst hour stays under a tenth of the 5000-an-hour allowance`:
    `LANDED_READS_PER_SWEEP * 3_600_000 / PR_SWEEP_MS <= 500`;
  - `a pass at the cap fits inside its row's staleAfterMs`: `LANDED_READS_PER_SWEEP` × the `pr-state` outer bound
    (`CCD_VERB_TIMEOUT_MS['pr-state']`) is under `laneRow('landed').staleAfterMs`.
- [ ] **Step 2: Run it and see the first case fail.**
- [ ] **Step 3: Edit the two comments,** keeping each comment's line count.
- [ ] **Step 4: Run** `pr-timeout-budget.test.ts`, `session-hook.test.ts` (the citation census does not move),
  `docs-parity.test.ts` and `ccd-pr-state-pr-words.test.ts` **and see them pass.**
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-BUDGET-1 | the header's per-entry sentence is removed | budget: the header case |
| 5H-BUDGET-2 | `LANDED_READS_PER_SWEEP` reads 40 | budget: the hour and the pass cases |

```bash
git add ccd/ccd server/test/pr-timeout-budget.test.ts
git commit -m "docs(ccd): the pr-state budget counts the landed reader per open entry, and _gh_fail_reason's 504 window is past (landing-order 5h)"
```

---
### Task 8: the coordinator reads its own entry by PR, README, and review 1660's A1 and A2

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` (the landing-line paragraph, outside the
  verdict fence), `ccd/coordinator-skill/references/wave-steps.md` (the ejection sentence)
- Modify: `README.md` (the landing-line paragraph; Run lifecycle item 2 is read, not edited)
- Modify (test): `server/test/coordinator-skill.test.ts`, `server/test/landing-intents-dispatch.test.ts`

**Interfaces:**
- Consumes: Task 3's `?pr=` and `ccrc-api`'s `--pr`.

- [ ] **Step 1: The two reads of this PR's entry.**
  - `wave-lifecycle-5b-landing.md`: the read becomes `GET /api/landing?project=<project>&pr=<pr>` (`ccrc-api landing
    show --project <project> --pr <pr>`), and one sentence follows it: the read answers this PR's entry in any state
    beside the line's flags and order; the line's own read, without `--pr`, lists only the entries still in it; and a
    server older than wave 5h ignores `pr` and answers every entry, which this paragraph reads the same way. The other
    sentences of the paragraph are unchanged.
  - `wave-steps.md`: the ejection sentence's read becomes the same `--pr <pr>` form.
  - `coordinator-skill.test.ts`: the pins of both sentences change to the new text. The ejection sentence has THREE
    verbatim copies: the `toContain` of "sends a fix round with no report from merging in one of two forms…",
    `REPORT_LESS` (compared whole with `toBe(REPORT_LESS)`), and the whole-paragraph pin "pins step 6's whole
    report-less paragraph with the entry's base … (the 5f report-less pin)". Then the landing-line paragraph's
    `LINE`, and the client-verb pin ("names a client verb the closed client really has"), whose `toContain` takes the
    new `--pr` form (its title too) and whose `row?.query` is expected to equal `['project', 'pr']`. Before running,
    check that no copy of the old form is left: on `main`,
    `grep -cF 'ccrc-api landing show --project <project>`)' server/test/coordinator-skill.test.ts` prints 5 (the three
    ejection copies, `LINE` and the client-verb `toContain`); after the edit it prints 0.
  - `wave-lifecycle-5-boundary.md`'s "Read `GET /api/landing?project=<project>` first" before an order write is NOT
    changed (COORDINATOR note 6: the default read is enough there), so its pins stay.
- [ ] **Step 2: A1** (review 1660). `coordinator-skill.test.ts`, two cases: the `intent-held` row of
  `references/wave-lifecycle-2-dispatch.md` contains `except that on the \`worker-starting\` re-run the first pass may
  already have started or woken the bound worker's pane`; README's Run lifecycle item 2, flattened, contains
  `except on the \`worker-starting\` re-run, where the first pass may already have started or woken the bound
  worker's pane`.
- [ ] **Step 3: A2** (review 1660). `landing-intents-dispatch.test.ts`: the fixture's `io` is wrapped so every
  `readdir` and `readdirMeasured` of the registry directory is recorded; the grammar case asserts it recorded none,
  and a CONTROL dispatch that succeeds records at least one.
- [ ] **Step 4: README.** In the landing-line paragraph: the read answers the entries still in the line (`pinned`,
  `ejected`, `unknown`), and `&pr=<n>` (`--pr <n>`) that PR's entry in any state, `entriesScope` saying which; an
  entry leaves the line `landed` when GitHub reads its PR merged (a train's proved landing included), with a head
  other than the pinned one kept in its `detail`, or `closed` when GitHub reads it closed unmerged or says no such PR
  exists; the landed reader (at most ten a sweep, oldest first) marks it, and a work run's `done` close marks it
  `landed` when GitHub reads the PR MERGED (a merge train's landing is left to the landed reader, which carries the
  train facts); a verified pin re-pins a `closed` entry. In the fence sentence, "an advance's pin and its retreat
  from `merging` included" gains "and a landing's mark". The same paragraph takes 5f's carried item (review 1425,
  "To the next wave that edits README's landing section"), because 5h's land arm answers the same words: it names an
  uncertain apply beside the append and the COMMIT (`landing-db-apply`, as `landing-db-commit`, with `mayApply:
  true`), and "every later one answers `landing-fenced` with that word" names the closed-handle case: after a
  `restart` fence the database handle is closed, so a later call that reads the database before the landing guard
  (the advance route reads the run first) fails on the closed handle instead of answering `landing-fenced`.
  D-8310.
- [ ] **Step 5: Run** `coordinator-skill.test.ts`, `worker-skill.test.ts`, `landing-intents-dispatch.test.ts`,
  `ccrc-api.test.ts`, `docs-parity.test.ts`, `citations.test.ts`, `anchors.test.ts` and `readme-holds.test.ts` **and
  see them pass.** Check the verdict fence's hash is unchanged.
- [ ] **Step 6: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5H-SKILL-1 | the `intent-held` row's worker-starting clause is removed | coordinator-skill: A1's row case |
| 5H-SKILL-2 | README item 2's clause is removed | coordinator-skill: A1's README case |
| 5H-SKILL-3 | the landing-line read loses `&pr=<pr>` | coordinator-skill: the `LINE` pin |
| 5H-SKILL-4 | `parseLandingIntents` moves after `admit`'s listing | intents-dispatch: the grammar case records a listing |

```bash
git add ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md ccd/coordinator-skill/references/wave-steps.md README.md server/test/coordinator-skill.test.ts server/test/landing-intents-dispatch.test.ts
git commit -m "docs(skills): the coordinator reads its own landing entry by PR, README names the landed reader, and the worker-starting clause and the grammar refusal's listing are pinned (landing-order 5h)"
```

---
### Task 9: the gate, the PR and the wave-done

- [ ] **Step 1: The fence and the slot.** The verdict fence hash as in Global Constraints; the migration count still
  59 on `origin/main`.
- [ ] **Step 2: The suites,** each in its own foreground `ccrc test` process: every file this plan creates or names;
  `single-definition/*`, `rings/*`, `census-w8/*`, `coord-policy-rings`, `box-token-census` (no count moves),
  `consolidation-census`, `lane-schedule`, `verb-gate`, `citations`, `anchors`, `docs-parity`, `topology-clean`,
  `session-hook` and `dtbd`; then `git fetch origin main` and `deviation-refs`; `growth-check` with
  `GROWTH_CHECK=1`; `typecheck-tests` alone; the server's `tsc --noEmit`.
- [ ] **Step 3: The mutation table,** every row of Tasks 1 to 8 measured red when mutated and green when restored from
  its saved copy.
- [ ] **Step 4: `git diff origin/main -- CLAUDE.md` is empty.**
- [ ] **Step 5: The private-name scan before every push.** Push, and open one PR from the workspace's branch to
  `main`, ready for review. Its body names the plan by its durable link, the deviation block, the mutation table, the
  suites and the deploy order (fleet box first).
- [ ] **Step 6: The wave-done.** Wait for the PR's fast run on the exact tip to finish, read its selection, and run any
  selected server file your list missed. Then send one wave-done at that tip, with its `suite:` and `failure:` lines,
  the mutation table, the commits and the PR number.

---
## Deviations found

This plan's entries are written by slug; the coordinator substitutes the allocated numbers.

- **D-8294 (2026-11-11)** — landed-one-writer: `landed` and `closed` are written by ONE store
  function, the new land arm of `CoordStore.advanceLanding` (D-7611's one-writer census kept), from two callers: the
  landed reader, and a work run's `done` close. The land arm moves no run (a no-run entry has none, and a hand
  merge's or an older server's run is already `done`), so it is a second input arm of the same function under ONE
  signature (no overloads, which the census's `symbolOf` refuses), and the census pin moves from one caller to three
  named callers. The close's call runs after the close commits, in its own transaction, because `tx` does not nest.
  This departs from decision 1(a)'s "the work run's final close": ANY `state: 'done'` work close marks, because
  `fingerprint.ts#verifyDone` re-measures the PR through `ccd pr-state --session` on every one
  (`closeDecide.ts` sets `verify: state !== 'failed'`), and the body's `final` decides what happens to the workspace,
  not to the PR. The close marks only a bound row GitHub reads MERGED with a merge commit; a train-landed entry is
  the reader's, because a `--session` line carries `landedInTrain` but no train number and no train merge commit
  (only the PR-keyed form prints them). So landed never rests on a notice (decision 1).
- **D-8295 (2026-11-11)** — landed-backlog-catch-up: the live line's 99 `pinned` entries, every
  PR already MERGED, are marked by the reader over about ten sweeps, at most `LANDED_READS_PER_SWEEP` (10) calls a
  sweep across every project, never-read first and then oldest `pinnedAt`, with no hand database edit. The
  `cmd_pr_state` header and `pr-timeout-budget.test.ts` count the PR-keyed form once per open entry per sweep
  (decision 2).
- **D-8296 (2026-11-11)** — landing-entry-closed: a PR GitHub reads CLOSED with no train claim,
  or answers that no pull request has the number, makes its entry `closed`, a new terminal word in
  `shared/landingLine.ts#LANDING_ENTRY_STATE`. It leaves the line and is never head; an edge to it releases its
  follower. Not `withdrawn`, which is the operator's (5j). Spec §5.5 is amended on the plan's PR (decision 3).
- **D-8297 (2026-11-11)** — closed-entry-re-pins: a verified pin re-pins a `closed` entry as it
  re-pins an `ejected` one, because GitHub lets a closed PR reopen and only a pin can bring it back; `landed` and
  `withdrawn` stay kept. The re-pin UPDATE clears `detail`, so `detail` describes the last mark and a re-pinned entry
  never carries the old one. A PR closed and reopened while its run waits at `merging` therefore leaves the line
  until the coordinator retreats and pins again (consequence of decision 3).
- **D-8298 (2026-11-11)** — landed-reads-landable-only: decision 1(b) says the reader
  "walks non-terminal entries"; it walks only `pinned` and `ejected` entries whose projection is readable with no
  quarantine marker (`landingEntry.ts#isLandable`, one copy, called by the decider and by the lane's candidate list).
  It leaves out `unknown`, which `LANDING_ENTRY_TERMINAL` classifies as non-terminal, and an unreadable projection,
  because their repair is 5i's (Carried constraints, from wave 5f's review, "To 5i"): a mark must not choose an
  entry's state over a quarantine or an unreadable row. The consequence: a merged PR whose entry is `unknown` stays
  outstanding in `landingLine.ts#landingOrder`, and an entry with an `after` edge to it stays held behind it until 5i.
- **D-8299 (2026-11-11)** — landed-merged-head-moved: a MERGED PR whose `headRefOid` differs
  from `pinnedSha` is still `landed`, its head kept in the entry's `detail`, which also carries the base, the merge
  time and commit, and, for a train landing, the train's number and merge commit, read through `readPrStatePrLine`'s
  extended merged arm (5c's carried item), never parsed again. Spec §5.5's "the landed check reads `pinnedSha`" is
  amended to say what it decides (decision 4).
- **D-8300 (2026-11-11)** — landing-read-bounded: `GET /api/landing` answers the entries still in
  the line by default and one PR's entry in any state with `?pr=<n>`, with an additive `entriesScope`. The store's
  scan reads its own project's rows whole and every other project's rows as `id, project, pr` only. Not a plain
  `WHERE project = ?`, because the all-projects scan is load-bearing: `landingEntry.ts#landingFactsOf` takes its id
  allocator (`nextId`, over every project's rows and every recovered subject), its `foreignIds` and the recovery
  fold's identity-conflict search (the same id under another project or PR) from every project's rows, so a plain
  scope would let two projects mint the same entry id and hide a cross-project identity conflict. A
  characterization test, committed first, holds those three unchanged. No route is added and no census moves
  (decision 5).
- **D-8301 (2026-11-11)** — coordinator-reads-its-entry-by-pr: with the default read
  bounded, the coordinator skill's two reads of its own PR's entry (`wave-lifecycle-5b-landing.md`'s landing-line
  paragraph and `wave-steps.md`'s ejection sentence) would read a `landed` or `closed` entry as no entry, and the
  first lands a PR with no entry. Both move to `?pr=<pr>`, and `ccrc-api`'s `landing.show` row accepts `pr`, so 5h's
  deploy class gains `ccd`, fleet box first. A third skill read, `wave-lifecycle-5-boundary.md`'s "Read `GET
  /api/landing?project=<project>` first" before an order write, stays the default read: an order matters only for
  an entry still in the line, and a coordinator that reads a terminal entry as absent and turns to the creation
  door is refused `landing-entry-exists`, so nothing is written wrongly.
- **D-8302 (2026-11-11)** — land-held-by-own-subject: a mark is refused while the entry's own
  `(project, pr)` is a recovery subject, or while an identity conflict stands in its project; another subject's hold
  does not stop it, because a mark only takes an entry out of the line and never chooses a head.
- **D-8303 (2026-11-11)** — landed-standing-missing-field: a second `missing-field` in a
  row (a base holding `+` or `@`) is a reader state with its own backoff, `LANDED_STANDING_BACKOFF_MS` (an hour), per
  entry, and warns once; ccd's grammar is not narrowed (decision 6). A refused train proof (`train-unproven`) is not
  given this backoff: it is read at `PR_BACKOFF_MAX_MS`, every fifteen minutes.
- **D-8304 (2026-11-11)** — pr-keyed-merge-facts-refused: one rule for the split, read from
  the code: ccd prints an OPEN or CLOSED row's merge facts as GitHub gives them, and the server's reader refuses such
  a line as `{by: 'reader', reason: 'merge-facts'}`, a word of its own, so this contradiction is never mistaken for
  build skew (`fields`); the landed reader retries it (decision 7).
- **D-8305 (2026-11-11)** — pr-keyed-reason-vocabulary: `prstate.ts#PR_STATE_PR_REASON_MAP`
  holds ccd's twelve reason words for the PR-keyed form; a word outside it reads `unrecognised`, never passed
  through, and a missing or non-string reason still reads `unstated`. Its type takes ten of the words from
  `shared/api.ts#PrReason` through `Extract`, so a renamed shared word is a compile error, and adds the form's own two
  (`unreadable`, `missing-field`): a subset map, legitimately different from `PR_REASON_MAP`, because it is the
  PR-keyed form's closed set. A fixture per word holds ccd and the server equal, and `no-remote`'s gloss names a
  missing or dotted project beside an origin that is not GitHub (decision 7; 5c's carried items).
- **D-8306 (2026-11-11)** — no-merge-report-route: no route lets a merge step report its result;
  the work run's close is that report. No box-token door and no census change; spec §5.5 is amended on the plan's PR
  (decision 8).
- **D-8307 (2026-11-11)** — landed-feed-record: when the reader or the close marks an entry
  `landed` and no `merged` record exists for its run's session and PR (`hasNotice` on `sweepMerged`'s own key), it
  writes one, so the race no longer leaves the feed silent. One builder, `landed.ts#mergedNoticeOf`, makes the record
  for both lanes (`watch.ts#announceMerged` calls it too), with `runId: null`, so a `merged` record stays out of every
  programme's feed as before. A merge within `LANDED_FRESH_MS` (an hour) is `record-always`, so it is archived even
  while the operator is viewing that session (where `push` records nothing) and pushed when nobody is; an older one
  is `record-only`, so the 99-entry backlog pushes nothing (it takes 99 of `FEED_RETENTION`'s 2000 rows). A no-run
  entry writes none BY CHOICE: the sink could take a session-less record (`orphanTreeBeat.ts` archives one), but it
  has no session to deep-link to and no `hasNotice` key to say the record once. The `merged:#N` mail lane is
  unchanged: its silence after a coordinator's own close is known and harmless (decision 9).
- **D-8308 (2026-11-11)** — sweep-failure-detail: a failed project sweep logs how ccd ended
  (`exit <n>`, `signal <NAME>`, `deadline` or `ending unmeasured`, through `ccdEnding`) and the last stderr line
  beside the first. `CcdResult` carried no exit status (`lifecycle.ts#ccd` folded the runner's code into `ok`), so
  its ran arm gains `exitCode`, set by `lifecycle.ts#ccd` only and never on the not-ran arm, whose code is forged.
  It is OPTIONAL, not required as decision 10 implies, because about 30 test files build `CcdResult` literals by
  hand; an absent `exitCode` means "not measured", logs the ending kind alone, and is never read as 0. `ran-arm.test.ts`'s
  key list moves with it (decision 10).
- **D-8309 (2026-11-11)** — landed-reader-fence-warns: the landed reader is the first
  unattended writer that can set the global landing fence, which refuses every project's pin until a restart, and
  nothing logged a fence being set. The lane warns once per process when its mark answers `landing-db-apply` or
  `landing-db-commit`, and once per error word when a pass stops on `landing-fenced`,
  `landing-journal-unavailable` or `landing-db-unavailable`.
- **D-8310 (2026-11-11)** — readme-fence-paragraph: 5f's carried item (review 1425, "To the next
  wave that edits README's landing section") is taken, because 5h edits that sentence and its land arm answers the
  same words: README names an uncertain apply (`landing-db-apply`, `mayApply: true`) beside the append and the COMMIT,
  and names the closed-handle case after a `restart` fence instead of saying every later call answers
  `landing-fenced`.
- **D-8311 (2026-11-11)** — carried-5g-review-pins: review 1660's A1 (the worker-starting
  clause, in `wave-lifecycle-2-dispatch.md`'s `intent-held` row and README's Run lifecycle item 2, each pinned by a
  `toContain`) and A2 (the grammar refusal lists no registry, pinned by a spy over the fixture's registry listings)
  (decision 11).
- **D-8312 (2026-11-11)** — carried-5c-text-items: `_gh_fail_reason`'s 504 window is in the past
  tense (Task 7); §5.5's "one `gh pr view`" reads as an upper bound, and §5.2's restated sentence names a removal
  recorded after the merge (the plan's PR) (decision 11).
- **D-8313 (2026-11-11)** — carried-5c-reader-items: the three 5c items carried to 5h that no
  decision named, each answered: one line's bytes are pinned through a file, so the trailing newline `h.sh` trims is
  seen (D-7600); a missing or dotted project still reads `no-remote`, its gloss saying so, and splitting the word is a
  later ccd wave's; and the train record a `by-pr` read writes before it rejects is repeated on each re-read of a
  refused or unread train claim, which is acceptable because each write replaces that member's own tried line, a
  fresh `failed` line spares the gh calls, and a proved PR is marked `landed` and never read again.
- **D-8314 (2026-11-11)** — stage-5-leftovers-answered: wave 3d's F4 is not served (the
  PR-keyed form reads the same OPEN state), review 1216's spent train producer is not served by the reader (its proof
  is the coordinator's own read; 5c's form would serve it in the next wave that edits the merge-train proof text), and
  5d's A2 check-attempt ambiguity is an evidence limit, stated; each stays carried (decision 12).

## Where things stand

**Agreed:** the measured cause of the silent notices, two mechanisms (the close-before-sweep race, dominant, and a
failing project sweep); the coordinator's twelve design calls of 2026-11-11, each above as a numbered entry under Deviations found.

**Waiting on you:**
- The plan's approval.
- The COORDINATOR notes at the top (the coordinator accepted them): the optional `exitCode` field (1), the identity-only foreign read (2), the land
  arm, its one signature and the three-callers census (3), the close leaving train landings to the reader (4), the
  push window, the feed rows the backlog takes and the no-run choice (5), and `ccrc-api`'s `pr` key with its
  fleet-first deploy and the order-write read left as it is (6).
- The departures the entries above carry: any `done` close marks, not only the final one (D-8294);
  the reader leaves `unknown` and unreadable entries to 5i (D-8298).

**Later:** 5i (the binding order, the next-to-land mail, and the repair of `unknown` rows, which also releases an
entry held behind a merged `unknown` one), 5j and 5k (the doors); wave 3d F4's run-side bound; the spent train
producer's proof through 5c's form; mechanism 2's ccd-level cause, once the next blind stretch logs it; a `dequeued:`
notice for a dequeue in a blind sweep; splitting `no-remote` for a missing or dotted project (a later ccd wave); a
backoff for a standing `train-unproven`; the stale-context residual of a coordinator holding pre-5h text.
