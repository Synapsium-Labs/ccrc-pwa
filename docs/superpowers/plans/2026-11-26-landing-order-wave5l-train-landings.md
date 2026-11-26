# Landing order, wave 5l — a train landing must not hold the landing line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan dispatches nothing itself: the wave is built by a worker the coordinator dispatches.

**Status:** drafted on 2026-11-26 for run 3930 (programme `landing-order`, the run's wave 31) from the brief's six decisions and the coordinator's answer of the same day (D-9115 issued for the ready mark; the clear line; the one early sentence); **revised the same day in fix round 1, after review run 3935, with the coordinator's rulings of call 1453**, and **again in fix round 2, after review run 3936, with the rulings of call 1459** (section 11 maps both rounds: each finding and ruling and where it went). **Corrected by the coordinator on 2026-11-26 after review run 3939 (round 3, the last): section 12 lists each correction, and where it and another section or a task disagree, section 12 wins.** One build wave; section 2 says why it is not split and where the seam would be.

**Goal:** A pull request that a merge train landed and closed never holds its project's landing line: the prover reads the record the train tool really writes, the landed reader takes a CLOSED, labelled, unproven entry out of the line, and a coordinator keeps its pull request a draft while it waits its turn.

**Architecture:** Three independent repairs, one per defect of issue #3422. (1) The train record's one parser (`_pr_train_py`'s `train-check`, in `ccd/lib/train-proof.sh`, C4) learns the train tool's `train-members` block beside the documented `ccrc-train v1` block (D-9111). (2) The landed reader's pure decider (`server/src/coord/landed.ts#landedAnswerOf`, L1, C4) answers `close` for the one-PR form's `unmeasured` with reason `train-unproven`, and the land arm's pure decider (`server/src/coord/landingEntry.ts#decideLandingLand`, L1, C4) records that reason in the entry's `detail`; the entry takes the existing terminal word `closed`, and the binding moves to the next entry through the existing order (D-9112). (3) The coordinator's landing references say, early and in one sentence, what to read and what to land on, and keep the pull request a draft while it waits (D-9115). No new entry state, journal record, route, migration, `ccd` verb, capability word or wire field.

**Tech Stack:** bash with embedded python3 (`ccd/lib/train-proof.sh`), TypeScript ESM (server, L1 only), Vitest, Markdown (the coordinator references and the README). Node >=22.16.0.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.5 (the landing line; "Columns re-measured from ccd's files — `pinnedSha` and landed state — are recomputable"). The case: issue #3422. Ledger: `docs/superpowers/programs/landing-order.md`. Model plan: `docs/superpowers/plans/2026-11-26-landing-order-wave5k-console.md`.

**Source baseline:** `origin/main` at `f45fce5aee2ee86f3e931a99d035e4882273f6f5`. Every present-tense claim about the code below was read there by this plan's author. A builder whose dispatch base is newer re-reads each cited owner before changing it and says what moved in the task note.

## What was measured

Each fact with the command that measured it. Commands that read GitHub ran on 2026-11-26 against this repository.

- **Every train pull request of this repository writes one `train-members` block and nothing else machine-readable.** `gh pr list --state all --search 'train: in:title' --limit 200 --json number,title,state,mergedAt,baseRefName,isCrossRepository,body`, filtered to titles beginning `train:`, answers 14: nine MERGED (#1992, #2000, #2021, #2039, #2048, #2141, #2219, #2226, #3415) and five CLOSED unmerged (#3291, #3292, #3293, #3294, #3413), every one with base `main` and `isCrossRepository: false`. A python pass over the bodies (split on lines; a line equal to ```` ```train-members ````; the lines to the next line equal to ```` ``` ````; `json.loads`) finds in every body: exactly one such opening line, at column 0; exactly one content line; the closing fence on the next line; content that is one JSON array of 1 to 6 objects, each with exactly the keys `pr` (a JSON integer), `headSha` (40 lowercase hex) and `blast` (a JSON integer); serialised as python's `json.dumps` default (`{"pr": 3400, "headSha": "…", "blast": 6}`, objects joined by `, `); no carriage return. The regular expression `\[(\{"pr": [1-9][0-9]*, "headSha": "[0-9a-f]{40}", "blast": [0-9]+\}(, )?)+\]` matches each content line whole.
- **Only #3415 carries the documented block, and it was added by hand.** The same pass counts lines equal to `<!-- ccrc-train v1`: one in #3415, none in the other 13. #3415's body says the block was added by hand on 2026-11-26, copied from its `train-members` block, after a tree check; its one member line equals its `train-members` member. The coordinator reports that after that edit the entry read `landed` and its run closed (mail of 2026-11-26), so a hand-added documented block proved on the fleet box, and this wave keeps that true.
- **The tool closes each member with the label and a comment the prover already reads.** `gh pr list --state closed --label landed-in-train --limit 100 --json number` answers 21, the sum of the nine merged trains' members (2+2+2+2+2+6+2+2+1). `gh pr view 3400 --json state,labels,comments` answers `CLOSED`, `["landed-in-train"]` and the comment `Landed in train #3415 (head `255d38e8ae1f`).`, which `train-refs`' pattern `(?i)\btrain\s+#(N)\b` matches.
- **Nothing in the tree reads `train-members`.** `git grep -n 'train-members' f45fce5aee -- .` answers nothing. The train record's parser is `train_block(body)` inside `_pr_train_py`'s `train-check` mode (`ccd/lib/train-proof.sh#_pr_train_py`): it looks for a line equal to `<!-- ccrc-train v1` and nothing else, and answers `carries no ccrc-train v1 block` for every tool-written body.
- **The search fallback already finds a tool-written train.** `_ws_train_record` asks `gh pr list --state merged --search "$head in:body"` when no comment names a proving train; a `train-members` block holds the member's full head sha, so that search can return the train, and `train-check` then reads its body. The parser is the only gap.
- **The one-PR form reads a labelled, closed, unproven pull request as `unmeasured`.** `ccd/ccd`, `_pr_py`'s `by-pr` mode: a view that reads CLOSED with the train label and whose `_ws_train_record` answered 1 (read, refused) prints `state: 'unmeasured'`, `reason: 'train-unproven'`, `trainUnproven: true`, with the view's `headRefOid`, `baseRefName`, `isCrossRepository`, `mergedAt` and `mergeCommit` echoed. An answer 2 (unread) prints `train-unread`, `trainUnread: true`. A member no comment names and no search finds is answered 1 (`no merged train PR names #n or lists it at <head>`), so it reads `train-unproven` too (`server/test/ccd-pr-state.test.ts`, "no train names it: unmeasured train-unproven").
- **The server's parser keeps the distinction and drops the facts.** `server/src/prstate.ts#readPrStatePrLine` answers that line as `{ state: 'unmeasured', pr, by: 'ccd', reason: 'train-unproven', train: 'unproven' }`; a line whose reason is `train-unproven` but whose `trainUnproven` is false answers `train: null`.
- **The landed reader retries it for ever.** `server/src/coord/landed.ts#landedAnswerOf` answers every `unmeasured` read `{ act: 'retry', missingField }`; `landedNext` doubles the wait from `PR_SWEEP_MS` (120 000 ms) to `PR_BACKOFF_MAX_MS` (900 000 ms) and never marks the entry.
- **A pinned entry holds the head and the binding never looks past it.** `server/src/coord/landingLine.ts#landingOrder` puts only `pinned` entries in the line and counts `pinned`, `ejected`, `unknown` and `withdrawn` targets as outstanding; `landed` and `closed` are neither in the line nor outstanding. `landingBindingOf` takes the flag-free walk's head and answers `held` `head-mismatch` when the probe does not list that PR at its pinned sha.
- **The probe lists open pull requests, drafts included, and never a closed one.** `ccd/ccd-land-probe` lists with `gh pr list --repo <slug> --state open --base <base> --limit 100 --json number,headRefName,headRefOid,isCrossRepository`. `--state open` includes drafts and the field list carries no draft flag, so a draft entry still binds, and a closed one is never listed.
- **The land arm writes one row and no journal record.** `CoordStore.advanceLanding`'s land arm (`server/src/coord/store.ts`) runs `UPDATE landing_entries SET state = ?, detail = ? WHERE id = ?` and appends nothing to `~/.ccrc/landing.log`: landed state is re-measured, never journalled (spec §5.5). `decideLandingLand` writes the detail `{"v":1,"by":…,"at":…,"word":"closed"}` for a closed outcome and `{"v":1,…,"word":"absent"}` for an absent one (`server/test/landing-land-words.test.ts`, "closed and absent mark closed and carry only v, by, at and word").
- **The closed outcome is built in nine places.** `git grep -n "word: 'closed'\|{ word }" f45fce5aee -- server` finds one in `server/src/coord/landed.ts` (`landedAnswerOf`'s `closed` arm) and, in tests: four literal inputs in `server/test/landing-land-store.test.ts` (the cases "closed and absent mark closed", the second-pin case, and two terminal-repair cases), one parametric `it.each([['closed'], ['absent']] as const)` in the same file ("a %s answer retires it closed"), one parametric `for (const word of ['closed', 'absent'] as const)` in `server/test/landing-land-words.test.ts`, one `as const` input in `server/test/landing-journal-store.test.ts`, and one `toEqual` expectation in `server/test/landed-decide.test.ts`. The first eight fail the typecheck once `closed` requires a `reason`; the expectation fails only when it runs.
- **Ticket-done evidence accepts only `landed`.** `server/src/coord/planPolicy.ts#landedFactOf` answers `landed` when any entry for the PR is `landed`, else `unlanded` with the newest entry's state; `planPolicy.ts#ticketDoneVerdict` refuses `{ pr }` evidence on `unlanded` ("pull request N of P is closed, not landed") and verifies `{ runId }` evidence from a `done` work run whatever the line says; `server/src/coord/workMap.ts#doneEvidenceVerdict` re-reads stored `{ pr }` evidence on every read and holds it only while the entry is `landed`. A `landed` entry never becomes `closed`, so stored evidence that held never flips. The run's close (`server/src/coord/close.ts`) raises its merged notice only when its own mark answers `landed`.
- **The spec says a refused train claim is unmeasured.** Spec §5.5 ("Entries and pins") makes a PR CLOSED with its train's proof `landed` and one CLOSED with no train claim `closed`, and its wave 5c amendment says "a train claim the proof refused or could not read is `unmeasured` (D-7596)" (the amendment itself ends a clause later, "gated by the `pr-state-pr-v1` capability.)"). D-9112 departs from that for the refused case only (section 1, decision 2); the coordinator amends the spec on the ledger pull request, with the line the D-9112 entry gives.
- **A `closed` entry is final until its run pins again.** `landingEntry.ts#isLandable` admits only `pinned` and `ejected`, so the reader never reads a `closed` entry again and the close's mark (`landed.ts#closeLandingOf`, `expect: null`) answers `kept` over it. `landingEntry.ts#decideLandingWrite` re-pins a `closed` row at the run's next verified pin when its projection reads with no marker. The terminal repair (`landingEntry.ts#terminalRepairOf`) answers `null` for a row whose stored word is terminal, so it never touches a `closed` row. `landingLine.ts#landingViewOf` lists only non-terminal entries in the line's read, so the console (wave 5k) shows a `closed` entry and a `landed` one alike: neither.
- **The bounded terminal repair reads the same answer.** `landed.ts#landedCandidatesOf` also hands the reader a row that is not landable but whose terminal-repair verdict is eligible (a damaged pinned row, its candidate carrying `repairToken`), and `landingEntry.ts#decideLandingLand` retires such a row with the reader's outcome when the token still matches. Spec amendment B (D-8626) allows that retirement only on "a fresh PR-keyed merged/closed/absent observation", and `train-unproven` is the PR-keyed form's `unmeasured`, so the reader's new `close` must not reach a repair candidate (section 4.3).
- **The operator's withdrawal refuses a terminal entry.** `landingWrites.ts#decideWithdraw` refuses an entry whose stored word is terminal (`landing-entry-terminal`) and skips terminal dependants, and the withdraw statement in `landingDoorsTx.ts` guards with `state NOT IN (<terminal words>)`; `CoordStore.landingReadProjects` drops a project whose rows are all terminal from the landed reader's walk. Each treats `landed` and `closed` alike.
- **The entry's `detail` has no reader.** `git grep -n 'detail' f45fce5aee -- server/src/coord/landing*.ts server/src/coord/landed*.ts shared/landingLine.ts` finds the writer and no parser; `LandingEntry` carries no `detail` field, and the terminal repair's token columns (`RETAINED_COLUMNS`) do not include it.
- **The ready mark comes before the advance, by D-8999.** `ccd/coordinator-skill/references/wave-lifecycle-4-advance.md` ("Ready, then `merging`") and `wave-lifecycle-5-boundary.md` (the native-queue paragraph) mark the PR ready and then advance to `merging`, because the checks lane decides its mode once, at that advance, from the measured phase (`server/src/coord/landing.ts#checksModeAt`); a draft read later in the episode leaves the lane (`landing.ts#landingLineAct`, `left` with phase `draft`), which the boundary paragraph already calls the coordinator's own act. So the entry exists only after the PR was marked ready, and the take-back must come after the advance.
- **Coordinator clause 15 points the ready mark at §4.** `ccd/coordinator-skill/SKILL.md` clause 15 ends "its PR stays a draft until its review passes, marked ready and turned back only as `references/wave-lifecycle.md` §4 says (D-8997)". So the take-back is written into §4's paragraph too, and no clause changes.
- **The paragraphs this wave edits are pinned whole.** `server/test/coordinator-skill.test.ts` pins, as arrays of sentences joined by one space over the `flat` text: §5b's opening ("the intro pin"), the native-queue landing paragraph ("the queue action pin"), the landing-line paragraph ("the line pin") and the stop paragraph ("the stop pin", plus a `toContain` of its first sentences in "says what a stop does"). The §4 and §2 sentences this wave edits are not pinned.
- **The growth check holds the prover's library.** `server/test/growthCheck.ts#growthFiles` measures every `ccd/lib/*.sh` file at `GROWTH_LIMIT` (40 net code lines a pull request), and counts a heredoc's body lines, python comments included, as code; the `ccd (program)` row sums `ccd/ccd` and those libraries under the same limit.
- **Some files are claimed by wave 5k's build (run 3914).** `ccrc-api claims list --project ccrc-pwa` (2026-11-26): claim 7303 holds `README.md`, `shared/landingLine.ts`, `server/src/coord/landingWrites.ts` and four landing test files (`landing-subtractive`, `landing-doors-route`, `landing-writes-act`, `landing-writes`); claim 7291 holds `ccd/ccd`. This plan edits neither `ccd/ccd`, `shared/landingLine.ts`, `landingWrites.ts` nor those tests. It does edit `README.md` (section 8), so the builder packets that file.
- **`CLAUDE.md` says nothing about the train record.** `grep -n -i 'train' CLAUDE.md` finds only CI's `train/` head branches. It gains no line.

## 1. Decisions

Each of the brief's six decisions, as this plan keeps it.

1. **The tree changes, not the tool (D-9111).** The one parser reads two grammars: the documented `ccrc-train v1` block, unchanged, and the tool's `train-members` block, in the strict grammar of section 4.1. A body with both proves only when both read and list the same members at the same heads; any difference, or either one failing to read, proves nothing (the coordinator's ruling). A hand-added `ccrc-train v1` block on a body with no `train-members` block still proves, and so does #3415's body, where the two agree.
   - **Why a second grammar is legitimately different** (root `CLAUDE.md`, *Consolidate, don't duplicate*): it is another process's output. The train tool is the operator's, outside the tree, and its format is not ours to change; the documented block is what a hand-built record or a future tool writes. Both are read by the ONE parser, `train_members(body)`, and judged by the ONE judge after it, `train-check`'s candidate loop, so there is still one reader of a train body and one rule for what proves.
   - **No `ccd caps` word.** No reader branches on whether the prover knows the tool's block: the server's new answer (decision 2) is right under either prover, the coordinator's rule (decision 4) reads the line, not the prover, and a word would land in `ccd/ccd` (`cmd_caps`), which another wave holds. A `ccd` with the grammar is told apart by `ccrc version`, as every build is.
2. **A CLOSED pull request never holds the head (D-9112).** On the one-PR form's `unmeasured` with reason `train-unproven` AND `trainUnproven: true` (both, read through `readPrStatePrLine`'s `train: 'unproven'`), `landedAnswerOf` answers `{ act: 'close', outcome: { word: 'closed', reason: 'train-unproven' } }`, and the mark records `"reason":"train-unproven"` in the entry's `detail`. `train-unread`, a `train-unproven` reason without the flag, and every other `unmeasured` stay a retry, and so does `train-unproven` itself for a terminal-repair candidate (ruled, call 1459: spec amendment B retires a damaged row only on a fresh PR-keyed `merged`, `closed` or `absent` observation, this claim's word on that form is `unmeasured`, and the operator approved the amendment as written). This is the smallest change: the reader's existing `close` act, the land arm's existing `closed` word and the order's existing rule that a `closed` entry is neither in the line nor outstanding do the rest; no new state, journal record or binding rule. Section 5 answers what reads `closed` and `landed` differently afterwards, and what happens when the proof holds later. The run's own close is not touched.
   - **`closed` is final (ruled, call 1453).** No re-mark to `landed` is built, in this wave or planned for a later one: `closed` is the right word for a landing nobody proved, and a ticket whose pull request rode such a train is closed by naming its run (`{ runId }` evidence), which still verifies.
   - **It departs from the spec for the refused case only.** Spec §5.5 says "a train claim the proof refused or could not read is `unmeasured` (D-7596)". The PR-keyed form still prints `unmeasured` for both; the reader now acts on the refused one as GitHub's CLOSED, and `could not read` stays a retry. The pull request stays one added file: the coordinator adds the amendment line given in the D-9112 entry to §5.5 on the ledger pull request.
3. **Both orders of rollout are safe** (section 6). The fleet box moves first, which is `ccrc rollout`'s default.
4. **The ready mark waits for the line (D-9115).** One sentence, the last of §5b's opening, says what to read and what to land on, so a coordinator who reads only that sentence lands right (the coordinator's request). The landing-line paragraph says when the mark is taken back and given again, and what to do on a held binding whose head (`order.head` of the same answer, or, while the line is paused and `order.head` is absent, the entry whose `id` is `binding.entryId`; ruled, call 1459) is another run's entry whose pull request is closed with the train label: land nothing past it, write no train record, read the line once more after 20 minutes, the landed reader's longest back-off for this answer plus one beat of its lane (this wave's reader clears such an entry by itself; ruled, call 1459), and only if the same head still holds, mail the coordinator of that entry's run (`toId: 'coordinator'` with its run id; ruled, call 1453), or, for an entry with no run, put it to the operator as an item. §4, §5's native-queue paragraph, §5b's stop paragraph and §2's ready sentence say the same in their own place. No `SKILL.md` clause changes (section 7).
5. **The README's two paragraphs, and one more sentence** (section 8). "One PR by number" and "The train record" change word for word, with a check that each old text occurs once. A third, one-sentence change is in the line's own README paragraph, which says when an entry leaves `closed`: the old sentence stays literally true, and the new one says the cause, which a reader of that paragraph needs (beyond the brief's two; kept, ruled, call 1453). `CLAUDE.md` gains no line.
6. **Nothing here boards, lands or orders a train.** The wave reads a train's record better and keeps the line moving; it does not teach the tool about the line, and it writes no train record anywhere.

## 2. One wave, and the seam if it is split

One build wave, one pull request, one context: the prover's change is one python function and its call (Task 1), the reader's is two pure functions and their type (Task 2), and the rest is text with its pins (Tasks 3 and 4). If it must split, the seam is between Task 1 (`ccd/lib/train-proof.sh`, its helper and its test file; deploy class `ccd`, fleet box) and Tasks 2 to 4 (server L1, skills and README; deploy classes `server` and `skills`). Each half lands green alone: no test of one reads the other's code (Task 1's cases drive `ccd` in a fixture HOME; Task 2's feed hand-written `pr-state --pr` lines and facts), and section 6 shows each half is safe on a fleet that has only it. Task 4's README text documents both halves, so it splits with them: section 8.2 (the train record's two forms, D-9111) goes with the prover half, and sections 8.1 and 8.3 (the landed reader's `closed` mark, D-9112) with the server half.

## 3. File responsibilities

| File | Ring, context | Change | Task |
|---|---|---|---|
| `ccd/lib/train-proof.sh` | ccd library, C4 (`_pr_train_py` in `ccd/contexts.tsv`) | `train-check`'s parser reads both grammars (`train_members`); the file header, the `train-check` comment and `_ws_train_record`'s header comment say so | 1 |
| `server/test/ccdPrHelpers.ts` | test helper | `rawTrainMembers`, `trainMembers` and `toolTrainRow`, the tool's exact body (section 9) | 1 |
| `server/test/ccd-train-members.test.ts` (new) | test | prover cases P1 to P38 and P9b | 1 |
| `server/src/prstate.ts` | C4 (its ring is untouched: a comment) | comment only: the `landedInTrain` field's comment names both forms of the train record (it says the `ccrc-train v1` block today) | 1 |
| `server/src/coord/landingEntry.ts` | L1, C4 | `LandingOutcome`'s `closed` arm carries `reason`; `decideLandingLand` writes it into `detail` | 2 |
| `server/src/coord/landed.ts` | L1, C4 | `landedAnswerOf` takes the candidate beside the read; its `unmeasured` arm; its `closed` arm passes `reason: null` | 2 |
| `server/src/coord/landedLane.ts` | L4, C4 | one argument: `landedPass` passes the candidate it already holds to `landedAnswerOf` (no decision moves into it) | 2 |
| `server/test/landed-decide.test.ts` | test | answer cases R-A to R-G; the existing calls pass a normal candidate; the existing `closed` expectation gains `reason: null` | 2 |
| `server/test/landing-land-store.test.ts` | test | the store case; its four literal `{ word: 'closed' }` inputs gain `reason: null`, and its parametric `closed`/`absent` case builds each outcome whole | 2 |
| `server/test/landing-land-words.test.ts` | test | its parametric `closed`/`absent` case builds each outcome whole; a case of its own beside it pins the `train-unproven` detail (section 12, C8) | 2 |
| `server/test/landing-journal-store.test.ts` | test | one existing `{ word: 'closed' }` input gains `reason: null` | 2 |
| `server/test/mail-routes.test.ts` | test | `NOT_CODES` gains `'train-unproven'` beside `'missing-field'`, with a comment that names `coord/landed.ts#landedAnswerOf` and `coord/landingEntry.ts#LandingOutcome`: ccd's `pr-state` reason, kept in a closed mark's detail (D-9112), a reader-internal discriminant, not a refusal code (section 12, C1) | 2 |
| `server/test/landed-lane.test.ts` | test | three lane cases (the third is the repair candidate; section 12, C2) | 2 |
| `server/test/landing-control.test.ts` | test | two binding cases | 2 |
| `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | skill text | §5b's opening, the landing-line paragraph, the stop paragraph | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-5-boundary.md` | skill text | the native-queue paragraph gains one sentence | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-4-advance.md` | skill text | "Ready, then `merging`" gains one sentence | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-2-dispatch.md` | skill text | the ready sentence widens | 3 |
| `server/test/coordinator-skill.test.ts` | test | the four pins take the new sentences | 3 |
| `README.md` (held by claim 7303) | docs | three changes, section 8 | 4 |
| `docs/superpowers/programs/landing-order/wave5l-task-<n>.md` (new) | task notes | one per task | 1 to 5 |

No file in `shared/`, no `server/src/coord/store.ts`, `landingLine.ts` or `ccd/ccd` changes; `landedLane.ts` changes in one argument and `prstate.ts` in one comment only. `store.ts` and `ccd/ccd` are growth-checked and stay untouched.

## 4. Interfaces

### 4.1 The `train-members` grammar (Task 1)

The body is split as `train_block` splits it today: `[l.strip() for l in body.splitlines()]`.

- **Opening:** a line equal to ```` ```train-members ````. Exactly one in the body; none is "no tool block"; two or more prove nothing.
- **Closing:** the first later line equal to ```` ``` ````. None proves nothing.
- **Content:** the lines strictly between, joined with `\n`, parsed by `json.loads(text, object_pairs_hook=…, parse_constant=…)`: the hook refuses a key given twice in one object, and `parse_constant` refuses `NaN`, `Infinity` and `-Infinity`. A parse error proves nothing. The parse catches `(ValueError, RecursionError)`: `json.JSONDecodeError` and the two refusals are `ValueError`s, but a body of many nested `[` raises `RecursionError`, which is not one, and uncaught it would end the python with no output, which `_ws_train_record`'s search-fallback arm reads as no candidate and its comment arm as unread (A10; P31 pins it).
- **Shape:** one JSON array with at least one element; each element an object whose `pr` has `type(pr) is int` (so `true` is refused) and whose decimal text matches `PR_NUM` (`[1-9][0-9]{0,9}`, the program's one spelling), and whose `headSha` is a `str` matching `[0-9a-f]{40}` whole. Any other key, the tool's `blast` among them, is never read. A `pr` listed twice proves nothing.
- **The map's key:** the member's decimal text (`str(pr)`), as `train_block`'s map is keyed by the text its pattern matched, so the two maps compare equal and the loop's `member in listed`, which tests the text of its argument, reads both (section 12, C7).

As a schema (the python is the authority; this is its reading):

```json
{ "type": "array", "minItems": 1,
  "items": { "type": "object", "required": ["pr", "headSha"],
    "properties": { "pr": { "type": "integer", "minimum": 1, "maximum": 9999999999 },
                    "headSha": { "type": "string", "pattern": "^[0-9a-f]{40}$" } } } }
```

with three rules no schema states: no boolean `pr`, no duplicate key in an object, no `pr` in two members.

**What else it accepts, by decision (Q4 and F11, ruled call 1453).** Strict on `pr` and `headSha`, lenient elsewhere. Because every line is stripped, as the v1 block's lines are, and only `pr` and `headSha` are read, these prove like the measured shape, and each has a case: a fence line indented by spaces (P21) or by a tab (P36); CRLF line ends (P22); JSON spread over several lines (P23); a stray ```` ``` ```` line after the block, which is outside it (P24); a member with no `blast` (P32); a member with an extra key the grammar does not know (P33); a `blast` that is not an integer (P34); compact separators and reordered keys (P35). A fence quoted with `> ` is not a fence line, so such a body carries no block (P25). Trailing text after the array is a parse error (P29).

### 4.2 The one parser (Task 1)

Inside `_pr_train_py`, `train-check` mode. `train_block(body)` keeps its grammar and its sentences byte for byte, and gains one answer for absence so the combiner can tell "absent" from "bad":

```python
def train_block(body):   # -> ('absent', None) | ('ok', {pr: head}) | ('bad', why)   (the v1 block, unchanged rules)
def members_block(body): # -> ('absent', None) | ('ok', {pr: head}) | ('bad', why)   (section 4.1)
def train_members(body): # -> ({pr: head}, None, form) | (None, why, None)           (the ONE parser the loop calls)
```

`form` names what was read, for the loop's two sentences after the parse: `'ccrc-train v1 block'` when the v1 block alone proved the map, `'train-members block'` when the tool's block alone did, and `'ccrc-train v1 block, like its train-members block,'` when both did and agreed. The third form keeps a singular subject, so both loop sentences stay grammatical with it (A6): `train #50's ccrc-train v1 block, like its train-members block, does not list #42` (P37) and `train #50's ccrc-train v1 block, like its train-members block, lists #42 at <S>, not its head <H>` (P38). It is reached for real by a search-fallback candidate that carries both blocks and does not list this member at its head.

`train_members` decides:

| v1 block | `train-members` block | answer |
|---|---|---|
| absent | absent | `(None, 'carries no train record: no ccrc-train v1 block and no train-members block', None)` |
| bad | any | `(None, <v1's why, unchanged>, None)` |
| any | bad | `(None, <the members block's why>, None)` |
| ok | absent | `(v1's map, None, 'ccrc-train v1 block')` |
| absent | ok | `(the members map, None, 'train-members block')` |
| ok | ok, equal maps | `(that map, None, 'ccrc-train v1 block, like its train-members block,')` |
| ok | ok, maps differ | `(None, 'has a ccrc-train v1 block and a train-members block that list different members or heads', None)` |

The candidate loop calls `train_members(body)` where it calls `train_block(body)` today. Its state, merge commit, base and cross-repository tests do not change. Its two sentences after the parse name the form that was read (F7): `train #%d's %s does not list #%s` and `train #%d's %s lists #%s at %s, not its head %s`, with `form` in the `%s` after the train number. With the v1 block alone, `form` is `'ccrc-train v1 block'`, so both sentences are byte for byte today's (P9b pins it); with the tool's block alone they name `train-members block` (P9, P10 pin it); with both, the third form (P37, P38). The members block's own refusals say `train-members` where v1's say `ccrc-train v1`: `carries 2 train-members blocks, not one`, `has a train-members block that never closes`, `has a train-members block that is not one JSON array of members` (a parse error, a non-array, an empty array), `has a train-members block with a member that is not a pr and a full head sha` and `has a train-members block listing #42 twice`. The absent sentence, `carries no train record: no ccrc-train v1 block and no train-members block`, keeps the substring `ccrc-train` that `ccd-ws-audit.test.ts`' two no-block cases assert. Every why stays a fixed sentence with only digits and these fixed words interpolated, as today.

**Budget:** the change adds at most 40 net lines to `ccd/lib/train-proof.sh`, heredoc lines and python comments included (section "What was measured"). The review's own draft of the two functions measured exactly 40 lines with no new comment, so Step 4 makes room first (F6, ruled: no waiver number up front): the `train-check` mode's opening comment may shrink its description of the v1 block's format and refusals (from "A train proves the member landed when it is MERGED" to "or a member listed twice proves nothing.") to one line that points at the README's "The train record", keeping its output-contract sentences (`<train>\t<merge oid>`, `?<sentence>`, `!<sentence>`, nothing, `?unreadable`) and its D-numbers. Add no new python comment beyond one line naming D-9111. If it still cannot fit, stop and mail the coordinator for a waiver number: never write a waiver file with a number you were not issued.

### 4.3 The reader's answer (Task 2, `server/src/coord/landed.ts`)

`LandedReadAnswer` does not change. `landedAnswerOf` takes the candidate beside the read, because the answer now depends on the candidate's kind, and that kind is known only from the candidate (a repair candidate carries `repairToken`, D-8626). The parameter is required, never optional, so no caller can forget it (root `CLAUDE.md`, *No overloaded null at a seam*):

```ts
export function landedAnswerOf(read: PrStatePrRead | { state: 'call-failed' },
  cand: Pick<LandedCandidate, 'repairToken'>): LandedReadAnswer {
// …
case 'closed': return { act: 'close', outcome: { word: 'closed', reason: null } };
// …
case 'unmeasured':
  // D-9112: GitHub reads the PR CLOSED with the train label and the train record was read and did not prove it. A
  // closed PR can never be the next to land, so the entry leaves the line; `train-unread` is still asked again. A
  // terminal-repair candidate is retired only on a fresh PR-keyed `merged`, `closed` or `absent` observation (spec
  // amendment B); this claim's word on that form is `unmeasured`, so for it the claim stays a retry.
  if (cand.repairToken === undefined && read.by === 'ccd' && read.reason === 'train-unproven' && read.train === 'unproven') {
    return { act: 'close', outcome: { word: 'closed', reason: 'train-unproven' } };
  }
  return { act: 'retry', missingField: read.by === 'ccd' && read.reason === 'missing-field' };
```

`landedPass` (`landedLane.ts`, L4) changes in one argument: it calls `landedAnswerOf(read, cand)` with the candidate it already holds; the decision stays in L1. Otherwise it is unchanged: a `close` answer is marked through `advanceLanding` with the candidate's compare-and-set, counted in `result.closed`, its memory dropped, and no `merged` record raised.

### 4.4 The outcome and the detail (Task 2, `server/src/coord/landingEntry.ts`)

```ts
import type { PrReason } from '../../../shared/api.js';   // type-only, L0
/** What GitHub said of one PR: merged (with the facts the mark records), closed without merging (`reason` names the one
 *  closed case that is not GitHub's bare word: CLOSED with the train label and an unproven train record, D-9112), or no
 *  such PR. */
export type LandingOutcome =
  | { word: 'merged'; head: string; base: string; mergedAt: string | null; mergeCommit: string | null;
    train: { number: number; mergeCommit: string } | null }
  | { word: 'closed'; reason: Extract<PrReason, 'train-unproven'> | null }
  | { word: 'absent' };
```

`reason` is required, not optional: two conditions a caller handles differently never collapse into one absent value (root `CLAUDE.md`, *No overloaded null at a seam*), and every constructor must say which it is. `decideLandingLand` writes:

- closed, `reason: null`: `{"v":1,"by":<by>,"at":<at>,"word":"closed"}`, byte for byte as today;
- closed, `reason: 'train-unproven'`: `{"v":1,"by":<by>,"at":<at>,"word":"closed","reason":"train-unproven"}`;
- absent and merged: as today.

Only the reader builds `reason: 'train-unproven'`; `closeLandingOf` builds only `merged`, as today. The nine existing builders of the closed outcome (section "What was measured") change with it: the seven literal ones take `reason: null` (`landed.ts`, the four in `landing-land-store.test.ts`, the one in `landing-journal-store.test.ts`, and the `landed-decide.test.ts` expectation); the two parametric cases (`landing-land-store.test.ts`'s `it.each` and `landing-land-words.test.ts`'s loop) build each outcome whole, `{ word: 'closed', reason: null }` and `{ word: 'absent' }`, instead of `{ word }`, and keep their detail expectations. The test typecheck names every parametric or literal site missed; only the expectation is caught by its run alone.

### 4.5 What does not change

`readPrStatePrLine` and `PrStatePrRead` (the reader already keeps `train: 'unproven'`), `landedCandidatesOf`, `landingOrder`, `landingBindingOf`, `landingViewOf`, `isLandable`, `decideLandingWrite`, `terminalRepairOf`, the store, the journal and its parser, every route and wire type, `FLEET_PROTO`, and `ccd`'s `by-pr` line.

## 5. What reads `closed` and `landed` differently afterwards

An entry this wave marks `closed` with reason `train-unproven` may in fact have landed. Every reader of an entry's terminal word, measured at the baseline (the first review's list, F4, completed by the second's, F1): alike for both words are `landingOrder`, `landingBindingOf`, `landingViewOf`, `isLandable`, `terminalRepairOf`, the operator's withdrawal (`landingWrites.ts#decideWithdraw` and the withdraw statement's terminal guard in `landingDoorsTx.ts`) and the landed reader's project walk (`CoordStore.landingReadProjects`); the rest read them differently, and each is a row below, beside the alike readers whose effect a reader of this plan needs. The pwa reads no entry state.

| Reader | `landed` | `closed` (this wave) | Consequence |
|---|---|---|---|
| The order (`landingOrder`) | not in the line, not outstanding | the same | The binding moves to the next entry at once; direct dependants are freed at the mark, exactly as for a landing. |
| The binding (`landingBindingOf`) | — | — | Takes the next head of the flag-free walk; nothing in it changes. |
| The `merged` feed record | raised by the landed lane on the mark | not raised by the lane | `sweepMerged` raises it when the session form reads the PR `merged` from a proof (a new `ccd`, decision 1), under the same once-only key (`mergedKey`), so the record still comes, once, for a train the prover can read, when the PR's session row has a workspace and is not archived (`sweepMerged` skips a row with no workspace or an archived one, A11). Under an old `ccd`, neither raises it, as today. |
| The console (wave 5k) | the line's read lists non-terminal entries only | the same | The entry leaves the card either way; `ccrc-api landing show --pr <n>` shows `closed`. |
| The run's close | the coordinator proves MERGED, or CLOSED with `landedInTrain: true`, itself | the same | Untouched: the close re-measures the PR. Its own mark (`closeLandingOf`, `expect: null`) answers `kept` over a `closed` entry, so the entry stays `closed` after a done close. |
| The run's re-entry | a `landed` row stays landed | a `closed` row re-pins at the run's next verified pin (`decideLandingWrite`) | Unchanged rule; a train-closed PR is never pinned again in practice, since its run closes. |
| The terminal repair (`terminalRepairOf`, its candidates in `landedCandidatesOf`) | a row already `landed` is never a candidate | a row already `closed` is never a candidate | It owns only rows whose stored word is not terminal. A repair candidate (a damaged pinned row) is retired by the reader on a merged, a bare closed or an absent reading, as spec amendment B allows; on `train-unproven` it is read again, as today (section 4.3, R-G; ruled, call 1459). |
| The operator's withdrawal (`decideWithdraw`, the withdraw statement) | refused: `landing-entry-terminal` | refused: `landing-entry-terminal` | The operator cannot withdraw a train-closed entry: the door refuses a terminal one. Nothing needs it to: the entry is already out of the line, and a terminal dependant is skipped. |
| The landed reader's walk (`CoordStore.landingReadProjects`) | a project whose rows are all terminal is dropped | the same | A project whose last entry leaves as `closed` costs the reader no more reads. |
| The close's notice (`close.ts`) | raised when the close's own mark answers `landed` | not raised: the close's mark answers `kept` over a `closed` entry | No merged record from the close; `sweepMerged`'s, above, still comes when the session form proves the train. |
| Ticket-done `{ pr }` evidence (`planPolicy.ts#landedFactOf`, `#ticketDoneVerdict`) | verifies | refused: "pull request N of P is closed, not landed" | The ticket is closed by naming the run that carried the PR (`{ runId }`, a `done` work run), which still verifies (ruled, call 1453). |
| Stored `{ pr }` evidence on the work map (`workMap.ts#doneEvidenceVerdict`, on every read) | holds | does not hold | Nothing flips: an entry marked `closed` here never held it, and a `landed` entry never becomes `closed`. |
| The entry's `detail` | `word: merged` and the train | `word: closed`, `reason: train-unproven` | Write-only today; it keeps the cause for whoever reads the database. |

**When the proof holds later** (the record is repaired by hand, or a new `ccd` reads it), nothing re-marks the entry, and nothing will: `closed` is final (ruled, call 1453). `isLandable` keeps the reader away from a `closed` row, and the close's mark keeps it. No reader above is blocked by it: the order and the binding treat the two words alike, the merged record comes from `sweepMerged`, the run closes on its own re-measurement, and the ticket is closed by naming the run. No `closed → landed` re-mark is built in this wave or planned for a later one.

## 6. Rollout: both orders

| Pair | What this case reads | Result |
|---|---|---|
| new `ccd`, old server | the one-PR form proves a tool-written train: `merged`, `landedInTrain: true` | the old reader marks `landed`; the line moves. A labelled closed PR whose record still does not prove (no train names it, or the tool's block is malformed) stays `unmeasured` and still holds the head under the old reader, as today. |
| old `ccd`, new server | the old prover cannot read the tool's block: `unmeasured`, `train-unproven` | the new reader marks `closed` (reason `train-unproven`); the line moves. Every train landing in that window reads `closed`, not `landed`, and the landed lane raises no `merged` record for it; the run's close still needs `landedInTrain: true`, which waits for the new `ccd` or a hand-added block, as today. |
| both new | the tool's block proves | `landed`, with the train in `detail`; only a genuinely unproven one is marked `closed`. |

**Fleet box first** (`ccrc rollout`'s default order), for this reason: it repairs the common case, every tool-written train, at once, and leaves only the rare unproven one to the server half. **What a server-first window costs:** every train landing whose entry the new reader reads in that window is recorded `closed` for good, since `closed` is final (section 5): no merged record from the landed lane, no `{ pr }` ticket-done evidence for it (its ticket is closed by naming its run), and a history that says `closed` for code that landed.

After the `ccd` move, a member whose record was refused less than `PR_TRAIN_TRIED_TTL` (30 minutes) ago reads `train-unproven` on the project sweep until that tried line goes stale. `pr-train-prove` does not end the window: it answers `unproven` with no gh call while a member's `failed` line is fresh (`cmd_pr_train_prove`, step 2). Only a read with a budget of its own asks GitHub again inside it: the session form, the one-PR form (the landed reader's, which therefore sees the new prover at once), the landing read and the audit.

## 7. The coordinator references (Task 3)

Old and new text, each as the flat sentences the pins hold (`server/test/coordinator-skill.test.ts`'s `flat` joins a paragraph's lines with single spaces). Wrap the new text in each file as its neighbours are wrapped. Each change updates its pin in the same commit; §4 and §2 are not pinned. No `SKILL.md` clause changes: clause 15 already says the PR is "marked ready and turned back only as `references/wave-lifecycle.md` §4 says", and §4 now says the take-back.

### 7.1 §5b's opening (`wave-lifecycle-5b-landing.md`; the intro pin)

Old (the opening's last sentence, the one the new sentence follows; it occurs once in the flattened text):

> It makes GETs only, prints exactly one line, and never merges, enqueues or writes a setting.

New (that sentence unchanged, then one; the coordinator's "one sentence, early". It stands last in the opening and not second, so that "The reads run fresh each time" and "They are the block below" still speak of the verdict's reads alone; section 12, C6):

> It makes GETs only, prints exactly one line, and never merges, enqueues or writes a setting. Besides the verdict, on a project positively opted in to the binding head, this session reads the landing line with the PR's number, `ccrc-api landing show --project <project> --pr <pr>`, and lands only when that read's `binding` is `ready` for this run's own entry at the head it binds: any other answer lands nothing (**The landing line**, below).

The intro pin takes the new sentence as its last element, after the heading and the four sentences it holds today.

### 7.2 The landing-line paragraph (`wave-lifecycle-5b-landing.md`; the line pin)

Old (the sentence the new ones follow):

> On a project that is positively opted in, a `held` binding, a `binding` naming a PR that is not this run's, an answer you cannot read, or no entry for this PR means stop and report what you read to the operator; never choose a successor.

New (that sentence unchanged, then six sentences; the line pin holds all six):

> On a project that is positively opted in, a `held` binding, a `binding` naming a PR that is not this run's, an answer you cannot read, or no entry for this PR means stop and report what you read to the operator; never choose a successor. On such a project the PR is a draft while it waits its turn, because a merge train boards any ready PR: read the line as soon as the advance to `merging` answers `ok`, and unless that read's `binding` is `ready` for this run's own entry at the head you bind, turn the PR back into a draft with `gh pr ready <pr> --undo` before your turn ends (D-9115). When that first read's `binding` is already `ready`, go on to land in the same sitting. Otherwise mark it ready again with `gh pr ready <pr>` only on a later read whose `binding` is, and run the verdict, the checks gate, this read and the landing in that same sitting. A `held` binding whose head, `order.head` of the same answer with its `pr` and `runId`, is another run's entry whose PR GitHub reads CLOSED with the train label (`landed-in-train` by default; `gh pr view <pr> --json state,labels`) is a train landing the landed reader has not marked yet: land nothing past it, write no train record and edit no train's body. While the line is paused its answer carries no `order.head`, so read the line without `--pr` and take the held entry from its `entries` as the one whose `id` is `binding.entryId`. The reader takes such an entry out of the line by itself, so read the line again after 20 minutes, the reader's longest back-off for this answer and one beat of its lane, with a timer as the wake; only if the same head still holds, mail the coordinator of that entry's run (`toId: 'coordinator'` with its `runId`) what you read, or, for an entry with no run, put it to the operator as an item.

(The 20 minutes, ruled in call 1459: the reader's retry step doubles up to `PR_BACKOFF_MAX_MS`, 15 minutes, and a due entry is read only at its lane's next beat, `PR_SWEEP_MS`, 2 minutes, so 17 minutes covers the reader's next read and 20 rounds it up. It stays one timed re-read, never a poll.)

### 7.3 The stop paragraph (`wave-lifecycle-5b-landing.md`; the stop pin and "says what a stop does")

Old:

> It leaves the run where it is (at `merging` or `awaiting-review`) and changes nothing, with one exception, the new-head route below.

> Say in your turn's text which stop fired and what it read, for the operator: every stop goes to the operator, and only that exception goes on to the new-head route as well.

New:

> It leaves the run where it is (at `merging` or `awaiting-review`) and changes nothing, with two exceptions: the new-head route below, and the draft that **The landing line** turns a waiting PR back into.

> Say in your turn's text which stop fired and what it read, for the operator: every stop goes to the operator, and only the first exception goes on to the new-head route as well.

### 7.4 The native-queue paragraph (`wave-lifecycle-5-boundary.md`; the queue action pin)

Old (the sentence the new one follows):

> A refused advance turns the PR back into a draft at once (`gh pr ready <pr> --undo`, §4), and a head other than `handoffCommit` is never marked ready.

New (that sentence unchanged, then one):

> A refused advance turns the PR back into a draft at once (`gh pr ready <pr> --undo`, §4), and a head other than `handoffCommit` is never marked ready. On a project positively opted in to the binding head, read the landing line as soon as the advance answers `ok` (§5b, **The landing line**): when its `binding` is `ready` for this run's own entry, the gate below, the enqueue and the read-back run in this sitting; otherwise turn the PR back into a draft, and they run only in the later sitting that marks it ready again (D-9115).

### 7.5 "Ready, then `merging`" (`wave-lifecycle-4-advance.md`; not pinned)

Old (the sentence the new one follows):

> On every send-back to `working`, from `merging` or from `awaiting-review`, turn it back into a draft first (`gh pr ready <pr> --undo`; on a PR already a draft it changes nothing).

New (that sentence unchanged, then one):

> On every send-back to `working`, from `merging` or from `awaiting-review`, turn it back into a draft first (`gh pr ready <pr> --undo`; on a PR already a draft it changes nothing). On a project positively opted in to the binding head, also turn it back into a draft once the advance to `merging` answers `ok` while the landing line's `binding` is not `ready` for this run's own entry, and mark it ready again only on a read whose `binding` is, as §5b's **The landing line** says (D-9115); a `checks:` mail whose `left` names `draft` for that run is this act and needs nothing.

### 7.6 The ready sentence of a brief (`wave-lifecycle-2-dispatch.md`; not pinned)

Old:

> This session marks the PR ready (`gh pr ready <pr>`) only once its review passes, immediately before the advance to `merging` (§4); the session hook refuses a worker `gh pr ready` and a `gh pr create` without `--draft` (D-8998).

New:

> This session marks the PR ready (`gh pr ready <pr>`) only once its review passes, immediately before the advance to `merging`, and on a project positively opted in to the binding head turns it back into a draft while it waits its turn on the landing line (§4, D-9115); the session hook refuses a worker `gh pr ready` and a `gh pr create` without `--draft` (D-8998).

## 8. The README (Task 4)

`README.md` is held by wave 5k's claim 7303: send its holder the diff first (Global Constraints), and leave the file untouched until the answer. Three changes; Task 4's script checks that each old text occurs exactly once and each new text exactly once after.

### 8.1 "One PR by number" (README, the paragraph that opens `**One PR by number (landing order wave 5c).**`)

Old (one paragraph, exactly as on the baseline):

````text
**One PR by number (landing order wave 5c).** `ccd pr-state --project <p> --pr <n>` reads one
pull request of the project's repository by number, with no workspace: one `gh pr view` under its
own timeout (`PR_GH_VIEW_TIMEOUT`, 6 s) and one JSON line out. Its `state` is one of five words:
`open`, `merged`, `closed`, `absent` (GitHub answered "Could not resolve to a PullRequest") or
`unmeasured`, with a `reason`: `no-remote`, `timeout`, `unreadable`, `missing-field`,
`train-unproven`, `train-unread`, or, for any other failed gh call, the word `pr-state --session` gives
the same failure (`unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error`). The line echoes `headRefOid`, `baseRefName`,
`isCrossRepository`, `mergedAt` and `mergeCommit` (the oid), so a reader can bind the answer to
the head, base and repository it expected. A PR CLOSED with the train label is never a bare
`closed`: the form runs the same train proof, inside `PR_STATE_TRAIN_TIMEOUT`, and keeps a proof it
makes. A proved one reads `merged` with `landedInTrain: true`, `train` and `trainMergeCommit`; one
whose record was read and did not prove it, or could not be read, reads `unmeasured`
(`train-unproven`, `train-unread`); a labelled PR from a fork is never proved and reads `unmeasured` (`train-unread`). The workspace form reads a claim whose record was read and did not prove it as `closed` (`train-unproven`); this form reads the same fact as `unmeasured`, so the two forms' words are not interchangeable. `ccd caps` lists `pr-state-pr-v1` for a ccd that has the form.
````

New (the same paragraph, one sentence added before its last):

````text
**One PR by number (landing order wave 5c).** `ccd pr-state --project <p> --pr <n>` reads one
pull request of the project's repository by number, with no workspace: one `gh pr view` under its
own timeout (`PR_GH_VIEW_TIMEOUT`, 6 s) and one JSON line out. Its `state` is one of five words:
`open`, `merged`, `closed`, `absent` (GitHub answered "Could not resolve to a PullRequest") or
`unmeasured`, with a `reason`: `no-remote`, `timeout`, `unreadable`, `missing-field`,
`train-unproven`, `train-unread`, or, for any other failed gh call, the word `pr-state --session` gives
the same failure (`unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error`). The line echoes `headRefOid`, `baseRefName`,
`isCrossRepository`, `mergedAt` and `mergeCommit` (the oid), so a reader can bind the answer to
the head, base and repository it expected. A PR CLOSED with the train label is never a bare
`closed`: the form runs the same train proof, inside `PR_STATE_TRAIN_TIMEOUT`, and keeps a proof it
makes. A proved one reads `merged` with `landedInTrain: true`, `train` and `trainMergeCommit`; one
whose record was read and did not prove it, or could not be read, reads `unmeasured`
(`train-unproven`, `train-unread`); a labelled PR from a fork is never proved and reads `unmeasured` (`train-unread`). The workspace form reads a claim whose record was read and did not prove it as `closed` (`train-unproven`); this form reads the same fact as `unmeasured`, so the two forms' words are not interchangeable.
The landed reader reads this form's `unmeasured` line with reason `train-unproven` and `trainUnproven: true` as
GitHub's CLOSED: it marks the entry `closed`, its detail naming `train-unproven`, so the entry leaves the
landing line (D-9112), except a damaged row the bounded terminal repair hands it, which it asks again (spec
amendment B); a `train-unread` line, and every other `unmeasured` one, it asks again at its back-off.
`ccd caps` lists `pr-state-pr-v1` for a ccd that has the form.
````

### 8.2 "The train record" (README, from `**The train record (D-7335)**` to `than its head.`)

Old (exactly as on the baseline):

````text
**The train record (D-7335)** is the one machine-readable block in a train PR's
body, and a train tool writes exactly one: an HTML comment on lines of its own,
opened by `<!-- ccrc-train v1`, one `member #<n> <40-hex head sha>` line per
member, closed by `-->`:

```
<!-- ccrc-train v1
member #1797 0123456789abcdef0123456789abcdef01234567
member #1800 89abcdef0123456789abcdef0123456789abcdef
-->
```

A member line is exactly `member`, one space, `#` and the PR number, one space,
and the full 40-character head sha in lowercase hex: no tabs, no second space,
no short or uppercase sha. Leading and trailing spaces on a line are ignored;
nothing else is. Tables,
lists and prose beside the block are for people and are never parsed, so a
body with only a table proves nothing. No block, two blocks, a block that never
closes, a line inside it that is not a member line, or a member listed twice
proves nothing for any member, and neither does a member listed at a sha other
than its head.
````

New (in a five-backtick block here, because it holds a four-backtick one):

`````text
**The train record (D-7335, D-9111)** is the machine-readable part of a train PR's
body, in either of two forms; every other part is for people. The documented form
is an HTML comment on lines of its own, opened by `<!-- ccrc-train v1`, one
`member #<n> <40-hex head sha>` line per member, closed by `-->`:

```
<!-- ccrc-train v1
member #1797 0123456789abcdef0123456789abcdef01234567
member #1800 89abcdef0123456789abcdef0123456789abcdef
-->
```

A member line is exactly `member`, one space, `#` and the PR number, one space,
and the full 40-character head sha in lowercase hex: no tabs, no second space,
no short or uppercase sha. Leading and trailing spaces on a line are ignored;
nothing else is. No block, two blocks, a block that never closes, a line inside
it that is not a member line, or a member listed twice proves nothing for any
member.

The other form is the one the merge train tool in use writes (D-9111): a fenced
block opened by a line that is exactly ```` ```train-members ```` and closed by the
next line that is exactly ```` ``` ````, holding one JSON array with one object per
member:

````
```train-members
[{"pr": 1797, "headSha": "0123456789abcdef0123456789abcdef01234567", "blast": 3}]
```
````

A member is an object whose `pr` is a JSON integer of one to ten digits with no
leading zero (never `true` or a string) and whose `headSha` is the full
40-character head sha in lowercase hex; any other key, the tool's `blast` among
them, is never read. Leading and trailing spaces on the two fence lines are
ignored. No such block, two of them, a block that never closes, content that is
not one JSON array of at least one member, a member of another shape, a key given
twice in one member, or a member listed twice proves nothing for any member.

A body with one form is read by that form alone, so a `ccrc-train v1` block added
by hand to a body with no `train-members` block proves. A body with both proves
only when both read and list the same members at the same heads; any difference
proves nothing. Tables, lists and prose beside the blocks are never parsed, so a
body with only a table proves nothing, and in either form neither does a member
listed at a sha other than its head.
`````

(The fence inside the new text is four backticks so that the three-backtick example shows; the builder checks the rendered README on GitHub's preview of the pull request.)

### 8.3 The line's own README paragraph (one sentence; beyond the brief's two)

Old (it occurs once):

> or `closed` when GitHub reads it closed unmerged or says no such PR exists.

New:

> or `closed` when GitHub reads it closed unmerged, reads it closed with the train label while its train record was read and did not prove the landing (`train-unproven`, D-9112), or says no such PR exists.

## 9. Tests by layer

- **Prover (Task 1), `server/test/ccd-train-members.test.ts`:** a fixture HOME from `makePrHarness` (`server/test/ccdPrHelpers.ts`), no network. Most cases pipe a train PR's JSON straight into `_pr_py train-check <member> <head> main` through `h.sh`, make no gh call, and compare the one line it prints (`<train>\t<oid>`, `!<why>`, `?<why>`). Two, P19 and P20, run the one-PR form end to end: each calls `h.makeGhRepo('demo')` and runs `${GH_STUB} cmd_pr_state --project demo --pr 42`, as `ccd-pr-state-pr-words.test.ts` does, with the member planted through `ghView(42, …)` and the train through `ghView(50, …)` (P19) or `ghSearch([…])` (P20); without the repository they read `no-remote` and fail for the wrong reason. `GH_STUB` is a shell function a snippet must include (it answers from the fixture files the helpers plant); a gh call a snippet makes without it meets the base harness's poisoned `gh` (section 12, C9). Bodies come from three new helpers (A9), beside `trainBlock` and `trainRow`:
  - `rawTrainMembers(content: string): string` writes the opening fence line, `content` exactly as given, and the closing fence line, each ended by `\n`. It is the one writer of a raw block, for every grammar case: P4's odd `pr` values, P7's contents, P28, P29, P31 to P35 write their content text by hand, and a case that changes the fence lines or the line ends (P6 drops the closing fence, P21 and P36 indent the fences, P22 turns every `\n` of the body into `\r\n`, P25 quotes every line) does it with a plain string operation on the helper's output, written in the case.
  - `trainMembers(members: Array<[number, string]>): string` is `rawTrainMembers` of the measured line: the members as `{"pr": n, "headSha": "…", "blast": 1}`, `json.dumps`' default separators, objects joined by `, `.
  - `toolTrainRow(number, mergeOid, block: string, over: Record<string, unknown> = {})` is a MERGED train whose body is the tool's header text, a fixed table (never parsed), `block` and the trailer (as #3415's was before the hand edit, with neutral numbers); `over` replaces any field, as `trainRow`'s does, so P16 and P17 set the state and a case that changes the whole body passes `body`.
- **Pure (Task 2):** `landed-decide.test.ts` (the answer), `landing-control.test.ts` beside its binding cases, with that file's own facts and control fixtures (the binding).
- **Lane (Task 2):** `landed-lane.test.ts`, with its fake `runCcd` answering a hand-written `pr-state --pr` line.
- **Store (Task 2):** `landing-land-store.test.ts`, on its `boot` fixture: the mark is one row change and writes the journal exactly as today's `closed` does, which is not at all.
- **Text (Task 3):** the four pins in `coordinator-skill.test.ts`.
- **README (Task 4):** the check script.
- **Load-sensitive files** to run alone when one goes red (root `CLAUDE.md`'s list): `pr-sweep`, `typecheck-tests`; and run `ccd-pr-state`, `ccd-ws-audit` and `ccd-pr-landing` one file per process, as they shell `ccd` hundreds of times.

### 9.1 The prover cases (Task 1)

Member `#42` at head `H = 'a'.repeat(40)`, train `#50` MERGED as `M = 'e'.repeat(40)`, base `main`, unless the case says otherwise. `S = 'b'.repeat(40)` is another sha. **Every case asserts the whole line** `train-check` prints, never a fragment or a bare `!`, so a refusal with the wrong sentence reds (F2, F7). A malformed member always sits BESIDE a valid `#42` at `H` in the same block, so a mutant that stops refusing it proves `#42` and the case reds (F2). `!W` below abbreviates `!train #50 ` followed by the sentence.

| id | Body or train | Expected line | Baseline (F3) |
|---|---|---|---|
| P1 | tool block alone, `#42` at `H` | `50\t<M>` | red |
| P2 | tool block: `#42` at `H`, and `#43` at `S.slice(0, 12)` | `!W has a train-members block with a member that is not a pr and a full head sha` | red |
| P3 | tool block: `#42` at `H`, and `#43` at `'B'.repeat(40)` (uppercase) | as P2 | red |
| P4 | tool block: `#42` at `H`, and a second member whose `pr` is `"43"`; then `true`; then `43.0`; then `12345678901` (one body each) | as P2, each | red |
| P5 | two tool blocks, both listing `#42` at `H` | `!W carries 2 train-members blocks, not one` | red |
| P6 | tool block that never closes | `!W has a train-members block that never closes` | red |
| P7 | content `[]`; then `{"pr": 42, "headSha": H}` (an object, not an array); then `[{"pr": 42, "headSha": H, "blast": NaN}]` (`NaN` in the never-read key); then `[{"pr": 42, "pr": 42, "headSha": H}]` (a duplicate key, inside an array) | `!W has a train-members block that is not one JSON array of members`, each | red |
| P8 | tool block listing `#42` twice at `H` | `!W has a train-members block listing #42 twice` | red |
| P9 | tool block listing `#42` at `S` | `!train #50's train-members block lists #42 at <S>, not its head <H>` | red |
| P9b | v1 block alone listing `#42` at `S` | `!train #50's ccrc-train v1 block lists #42 at <S>, not its head <H>` (today's sentence, byte for byte) | green |
| P10 | tool block listing only `#43` at `H` | `!train #50's train-members block does not list #42` | red |
| P11 | both blocks, equal maps (#3415's shape) | `50\t<M>` | green (v1 proves today) |
| P12 | both blocks: v1 lists `#42` at `H`, the tool's lists `#42` at `S` | `!W has a ccrc-train v1 block and a train-members block that list different members or heads` | red (v1 proves today) |
| P13 | both blocks: v1 lists `#42` at `H` and `#43` at `S`, the tool's lists `#42` at `H` only | as P12 | red (v1 proves today) |
| P14 | both blocks: v1 lists `#42` at `H`, the tool's never closes | `!W has a train-members block that never closes` | red (v1 proves today) |
| P15 | v1 block alone (hand-added), `#42` at `H` | `50\t<M>` (the existing rule, kept) | green |
| P16 | an OPEN train with a valid tool block, carrying `mergedAt: '2026-07-21T08:59:00Z'` and `mergeCommit: { oid: M }` (so only the state test refuses it) | `?train #50 is still open` | green |
| P17 | a CLOSED unmerged train with a valid tool block | `!train #50 is closed, not merged` | green |
| P18 | the tool's table and trailer alone, no block | `!W carries no train record: no ccrc-train v1 block and no train-members block` | red |
| P19 | end to end: `pr-state --project <p> --pr 42`, `#42` CLOSED with the label and the comment ``Landed in train #50 (head `aaaaaaaaaaaa`).``, train `#50` a `toolTrainRow` | `merged`, `landedInTrain: true`, `train: 50`, `trainMergeCommit: M`; the proof kept in `.train-proofs` | red |
| P20 | end to end: the same with no comment, and `ghSearch` answering `[toolTrainRow(50, …)]` | the same proof (the search fallback) | red |
| P21 | tool block whose two fence lines are indented by two spaces | `50\t<M>` (proves, by decision) | red |
| P22 | tool block with CRLF line ends throughout the body | `50\t<M>` (proves, by decision) | red |
| P23 | tool block whose JSON array spans three lines | `50\t<M>` (proves, by decision) | red |
| P24 | tool block followed later by a stray line `` ``` `` | `50\t<M>` (proves, by decision) | red |
| P25 | tool block whose every line is quoted with a leading `> ` | as P18 (no block) | red (today's sentence differs) |
| P26 | tool block: `#42` at `H`, and `#43` at a 41-character sha | as P2 | red |
| P27 | tool block: `#42` at `H`, and `#43` with `pr` `0` | as P2 | red |
| P28 | tool block whose content holds `"pr": 042` (a leading zero) | as P7 | red |
| P29 | tool block whose content line is the valid array followed by ` x` | as P7 | red |
| P30 | the v1 block alone with no member at all (`<!-- ccrc-train v1` then `-->`, the body written by hand: `trainBlock([])` leaves an empty line inside the block, which is refused as a line that is not a member line) | `!train #50's ccrc-train v1 block does not list #42` (today's) | green |
| P31 | tool block whose content is 100 000 `[` characters (python's `json.loads` raises `RecursionError`, measured) | as P7 (the parse catches it; the prover prints its line, never nothing) | red |
| P32 | tool block: `[{"pr": 42, "headSha": H}]` (no `blast`) | `50\t<M>` (proves, by decision) | red |
| P33 | tool block: `[{"pr": 42, "headSha": H, "blast": 1, "note": "x"}]` (a key the grammar does not know) | `50\t<M>` (proves, by decision) | red |
| P34 | tool block: `#42` at `H` with `"blast": "x"`; then with `"blast": 1.5` (one body each) | `50\t<M>`, each (proves, by decision) | red |
| P35 | tool block: `[{"headSha":"<H>","pr":42}]` (compact separators, keys reordered) | `50\t<M>` (proves, by decision) | red |
| P36 | tool block whose two fence lines are indented by one tab | `50\t<M>` (proves, by decision) | red |
| P37 | both blocks, equal maps, listing only `#43` at `H` | `!train #50's ccrc-train v1 block, like its train-members block, does not list #42` | red (today's sentence names the v1 block alone) |
| P38 | both blocks, equal maps, listing `#42` at `S` | `!train #50's ccrc-train v1 block, like its train-members block, lists #42 at <S>, not its head <H>` | red (as P37) |

A builder records the baseline column as measured in the task note: run the new file once before Step 4, and say which rows differ from this table and why.

### 9.2 The reader cases (Task 2)

| id | Input to `landedAnswerOf` | Expected |
|---|---|---|
| R-A | `{ state: 'unmeasured', pr: 7, by: 'ccd', reason: 'train-unproven', train: 'unproven' }` | `{ act: 'close', outcome: { word: 'closed', reason: 'train-unproven' } }` |
| R-B | the same with `reason: 'train-unread', train: 'unread'` | `{ act: 'retry', missingField: false }` |
| R-C | `reason: 'train-unproven', train: null` (the flag absent) | `{ act: 'retry', missingField: false }` |
| R-D | `{ state: 'unmeasured', pr: 7, by: 'reader', reason: 'train-flags', train: null }` | `retry` |
| R-E | a `merged` read with `train: { number: 50, mergeCommit: M }` | `land`, `word: 'merged'`, the train carried (existing case, kept) |
| R-F | an `open` read | `{ act: 'wait' }` (existing case, kept) |
| R-G | R-A's read, with a repair candidate `{ repairToken: T }` (`T` a 64-hex token) | `{ act: 'retry', missingField: false }` (spec amendment B; ruled, call 1459) |

R-A to R-F, and every existing call of `landedAnswerOf` in `landed-decide.test.ts`, pass a normal candidate (`{}`, no `repairToken` key). Each row is asserted with `toEqual`, so a changed act, word or reason reds.

### 9.3 The lane, store and binding cases (Task 2)

- **Lane, the mark:** one pinned entry; `runCcd` answers the `by-pr` line of a labelled, closed, unproven PR (as `ccd` prints it, `trainUnproven: true`, the facts echoed). After one `landedPass`: the entry reads `closed`, `result.closed === 1`, `result.landed === 0`, the entry's memory is gone, and no `merged` notice was raised.
- **Lane, the retry:** the same with `trainUnread: true`, `reason: 'train-unread'`: the entry stays `pinned`, the memory's `nextAt` is `at + 2 * PR_SWEEP_MS`, nothing is marked.
- **Lane, the repair candidate (section 12, C2):** one pinned entry damaged with that file's own `damage` helper (an unreadable handoff commit), so `landedCandidatesOf` hands it to the lane with a `repairToken`. The case stands inside the file's amendment-B `describe` block, where `damage` is defined. It asserts first that the entry is a repair candidate, by a means that works when nothing is marked: `landedProjectStep(r.coord.readLanding(<project>))` answers one candidate whose `repairToken` is 64 hex characters. `runCcd` answers the same labelled, closed, unproven line as the mark case. After one `landedPass`: a spy on `advanceLanding` was not called, the row's stored state and `detail` are what they were before the pass, `result.closed === 0`, and the memory's `nextAt` is `at + 2 * PR_SWEEP_MS`.
- **Store:** two pinned entries in one project. Read the journal's bytes and `landing_journal_cursor`; mark the first with `{ word: 'closed', reason: null }` and the second with `{ word: 'closed', reason: 'train-unproven' }`. Both read `closed`; the first's `detail` is exactly `{ v: 1, by: 'reader', at: 5000, word: 'closed' }` and the second's exactly `{ v: 1, by: 'reader', at: 5000, word: 'closed', reason: 'train-unproven' }`; the journal's bytes and the cursor equal what they were before both marks.
- **Binding, before the mark (the defect, pinned):** entries A (`pr` 41, pinned first) and B (`pr` 42, pinned later), every control document fresh and green, the probe listing only B at its pinned sha: `landingBindingOf` answers `{ mode: 'held', reason: 'head-mismatch', entryId: A.id }`.
- **Binding, after the mark:** the same with A's display state and stored word `closed`: `{ mode: 'ready', entryId: B.id, pr: 42, … }`.

## Global Constraints

- **The prover is one parser and one judge.** `train_members` is the only function that reads a train body; `train-check`'s loop is the only place that decides a proof; no second reader of `train-members` anywhere in the tree (D-9111's recorded reason is the tool, not a new mechanism).
- **Decide in L1, act in L4.** In `server/src`, `landed.ts` and `landingEntry.ts` change; besides them only `landedLane.ts` (L4) changes, in one argument that passes the candidate it holds, and `prstate.ts`, in one comment. The store (L3) does not change.
- **No new state, journal record, route, migration, `ccd` verb, capability word or wire field.** `FLEET_PROTO` stays 1. `closed` is the existing terminal word.
- **Growth:** `ccd/lib/train-proof.sh` grows at most 40 net code lines (heredoc lines count); `ccd/ccd` and `server/src/coord/store.ts` are untouched.
- **Fixture HOMEs only.** Every `ccd` call in a test runs through `makePrHarness`'s HOME and its poisoned `gh`; no test runs `ccd` against the live home, and no test reads GitHub.
- **Neutral names only** in fixtures, notes, commits and the pull request: `project-a`, `lane-a`, `the fleet box`; train and member numbers are small fixture numbers, never the measured ones. Cite code as `file#symbol` or `file#@anchor`.
- **Every test and typecheck runs through `ccrc test -- <command>`,** in the foreground, tool timeout at least 600000 ms, `--maxWorkers=2`, cd'd in `server/`.
- **Claims and packets.** Read `ccrc-api claims list --project ccrc-pwa` before each task and claim every path it edits. `README.md` is held by claim 7303 (wave 5k's build): send its holder a unified diff against a named `main` commit, inline, with its size and sha256, and leave the file untouched until the answer. Keep off `ccd/ccd`, `shared/landingLine.ts`, `server/src/coord/landingWrites.ts` and wave 5k's landing test files.
- **Commits** on the workspace's own branch; push once, when the wave is complete; the pull request stays a draft. Task notes go under `docs/superpowers/programs/landing-order/` as `wave5l-task-<n>.md`; never edit an existing plan or the programme ledger.
- **Deviation numbers are issued, never chosen.** This plan defines D-9111, D-9112 and D-9115. A departure found while building is named by slug (`D-TBD-<slug>`) in the wave-done mail, never in a tracked file.

## Review Focus

1. **A body that proves what it should not:** a short, long, uppercase, string or zero member beside a valid one, two tool blocks, a duplicate key or member, `NaN`, an empty array, a deeply nested array, an OPEN train with merge facts, or two blocks that differ (P2 to P8, P12 to P14, P16, P26 to P29, P31; rows M1 to M8, M19, M20, M24, M26).
2. **A body that stops proving what it did:** a hand-added `ccrc-train v1` block alone, both blocks agreeing, the shapes accepted by decision, and every v1 refusal sentence unchanged (P9b, P11, P15, P21 to P24, P30, P32 to P38, the existing `ccd-pr-state` and `ccd-ws-audit` train cases; rows M9, M21 to M23).
3. **An entry marked on an answer that says nothing definitive:** `train-unread`, a `train-unproven` reason without its flag, a reader refusal, an `open` or a `merged` read, and a repair candidate on `train-unproven`, at the decider and at the lane's hand-off (R-B to R-G, the lane's repair-candidate case; rows M11 to M14, M25, M27).
4. **The line still held:** a closed, labelled, unproven entry left `pinned`, or the binding still naming it (R-A, the lane mark, the two binding cases; rows M10, M15, M16).
5. **The procedure:** the early sentence of §5b, the take-back after the advance and its re-mark in one sitting, the held-on-a-train-closed-PR stop, and the stop paragraph's second exception, each pinned (Task 3; row M18).

## What this does not claim

- **An entry marked `closed` may have landed.** A train whose record the prover cannot read (an old `ccd`, a malformed block, a member no comment names and no search has indexed yet) is marked `closed` with reason `train-unproven`. Dependants are freed either way; the history says `closed`.
- **An entry closed as train-unproven stays closed if a proof appears later** (a record repaired by hand, say): `closed` is final, and no re-mark is built or planned (ruled, call 1453). Its ticket is closed by naming its run (`{ runId }` evidence), since `{ pr }` evidence accepts only `landed`.
- **A labelled, closed PR whose train record is never READ still holds the head** (F12). `train-unread` stays a retry, so an entry whose PR comes from a fork (the prover never proves a fork's PR) or whose every read runs out of budget is read again for ever, the same shape as #3422. A coordinator's workspace PRs are branches of the repository itself, so this is a stated edge, not a live case; the operator's withdrawal of the entry is its release (such an entry is still `pinned`, so the door takes it; the same door refuses an entry already `closed`, section 5).
- **A server-first window records train landings `closed` for good.** In a window where the server runs this wave beside an older `ccd`, every train landing the landed reader reads is recorded `closed`, and stays `closed` (section 6; ruled, call 1459).
- **A damaged entry whose PR a train closed unproven is not retired by this wave.** A terminal-repair candidate is retired only on a fresh PR-keyed `merged`, `closed` or `absent` observation, and this claim's word on that form is `unmeasured` (spec amendment B, approved as written), so on `train-unproven` it is read again and holds the line as it does today (section 4.3, R-G; ruled, call 1459).
- **A PR turned back into a draft after the advance loses the checks lane for that episode.** The lane decides its mode once, at the advance, and a draft read later ends it (`left`, `draft`), so the coordinator runs the checks gate itself in the landing sitting, as section 7.2's sentence says (ruled, call 1459).
- **No notice is raised when an entry leaves as `closed`.** The lane counts it; the operator sees it in `ccrc-api landing show --pr <n>`, not in the feed.
- **The run's close is unchanged.** It still needs MERGED, or CLOSED with `landedInTrain: true`, so a run whose train record never proves still waits at `merging` for the operator, as today.
- **The ready mark is a convention.** The take-back is the coordinator's act in the references; nothing in the server or the hook enforces it, and a train can still board a PR in the minutes between the advance and the take-back.
- **The procedure applies to projects positively opted in to the binding head.** On any other project the coordinator lands in the sitting that marks the PR ready, as today.
- **The tool is not taught anything.** It still boards any ready PR, and this wave does not change what it writes.

---

## Wave 5l — train landings (Tasks 1 to 5, one pull request)

### Task 1: the prover reads the tool's block (D-9111)

**Files:** `ccd/lib/train-proof.sh`, `server/src/prstate.ts` (one comment), `server/test/ccdPrHelpers.ts`, `server/test/ccd-train-members.test.ts` (new), `docs/superpowers/programs/landing-order/wave5l-task-1.md` (new).

- [ ] **Step 1: claim** the four code files and the note.
- [ ] **Step 2: the helpers.** Add `rawTrainMembers`, `trainMembers` and `toolTrainRow` (section 9) to `ccdPrHelpers.ts`, beside `trainBlock` and `trainRow`; `trainMembers` writes exactly the measured shape (section "What was measured").
- [ ] **Step 3: red first.** Write P1 to P38 and P9b (section 9.1), each asserting its whole line. Run `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-train-members.test.ts` and record the split in the task note against section 9.1's baseline column (F3): green on the baseline are P9b, P11, P15, P16, P17 and P30 (today's parser reads the v1 block alone and ignores the tool's, so P11 already proves); every other case is red, P12 to P14 because today they PROVE through the v1 block, and the tool-only refusals because today's sentence is `carries no ccrc-train v1 block`.
- [ ] **Step 4: the parser.** In `_pr_train_py`'s `train-check` mode: `train_block` answers `('absent', None)` where it answered `(None, 'carries no ccrc-train v1 block')`, `('bad', why)` for every other refusal with its sentence unchanged, and `('ok', map)`; add `members_block` (section 4.1, its parse catching `(ValueError, RecursionError)`) and `train_members` (section 4.2); the loop calls `train_members`. The loop's two sentences after the parse name `form` (section 4.2). Two header comments go false and are corrected (bash comments, outside the growth count): the file's header ("It is a MOVE and nothing else" now names D-9111's change), and `_ws_train_record`'s, whose proof is a train whose "one `ccrc-train v1` block lists this member" (make it "whose train record, the `ccrc-train v1` block or the train tool's `train-members` block (D-9111), lists this member"). Shorten the `train-check` comment as section 4.2's budget paragraph allows, before adding a line. Stay inside the 40-line budget (section 4.2). In `server/src/prstate.ts`, the `landedInTrain` field's comment says the train record is "its `ccrc-train v1` block": make it "its train record (the `ccrc-train v1` block or the train tool's `train-members` block, D-9111)".
- [ ] **Step 5: green.** The new file; then each alone: `ccd-pr-state.test.ts`, `ccd-pr-landing.test.ts`, `ccd-ws-audit.test.ts`, `ccd-ws-reap.test.ts`, `pr-sweep.test.ts`, `pr-timeout-budget.test.ts`, `ccd-lib-load.test.ts`, `ccd-ws-add-child.test.ts` (it counts `PR_NUM` spellings: add none), `ccd-harness-integrity.test.ts`, and the growth check (`growth-check.test.ts`).
- [ ] **Step 6: mutation rows** M1 to M9, M19 to M24 and M26 (section 10), each measured red, then restored; record them in the task note.
- [ ] **Step 7: commit** `fix(train-proof): read the train tool's train-members block beside the documented record (D-9111)`.

### Task 2: the reader takes a train-closed, unproven entry out of the line (D-9112)

**Files:** `server/src/coord/landingEntry.ts`, `server/src/coord/landed.ts`, `server/src/coord/landedLane.ts` (one argument), `server/test/landed-decide.test.ts`, `server/test/landing-land-store.test.ts`, `server/test/landing-land-words.test.ts`, `server/test/landing-journal-store.test.ts`, `server/test/landed-lane.test.ts`, `server/test/landing-control.test.ts`, `server/test/mail-routes.test.ts` (one `NOT_CODES` row; section 12, C1), `docs/superpowers/programs/landing-order/wave5l-task-2.md` (new).

- [ ] **Step 1: claim** the files.
- [ ] **Step 2: red first.** Write R-A to R-G (section 9.2) and the six cases of section 9.3. Keep `landing-land-words.test.ts`' case "closed and absent mark closed and carry only v, by, at and word" as section 4.4 rebuilds it, and add beside it a case of its own, `a train-unproven close records its reason in the detail (D-9112)`, which asserts `{ v: 1, by: 'close', at: 5000, word: 'closed', reason: 'train-unproven' }`. Add the `NOT_CODES` row to `mail-routes.test.ts` (section 3); its census case is red from Step 3 until that row stands, so add it with Step 3. These are written against the new type, so the typecheck is their first red. After Step 3 (the type and the detail): the store case's second detail and the new `landing-land-words` case are green, because `decideLandingLand` builds the detail; the lane's repair-candidate case is green from Step 2 on, at the typecheck too (it calls the lane and uses no new type, and today's code retries every `unmeasured`), and row M27 proves it guards; R-A and the lane mark case are still red, and turn green at Step 4 (`landedAnswerOf`); R-G passes at run time on the baseline (today's code retries every `unmeasured`; only the typecheck reds it, until Step 4 adds the parameter) and stays green, which row M25 proves it guards. Both binding cases are green on the baseline and stay green: the before case pins the defect's mechanism, and the after case pins the existing order rule this wave relies on (a `closed` entry is neither in the line nor outstanding), which row M15 proves it guards.
- [ ] **Step 3: the type and the detail.** `LandingOutcome` as section 4.4; `decideLandingLand` spreads `reason` into `detail` only when it is not null.
- [ ] **Step 4: the answer.** `landedAnswerOf` as section 4.3, with its comment and its candidate parameter; `landedPass` passes `cand`.
- [ ] **Step 5: the constructors.** The nine existing builders of the closed outcome (section 4.4): the seven literal `{ word: 'closed' }` sites take `reason: null`, and the two parametric cases are rebuilt whole; `ccrc test -- npx tsc --noEmit -p tsconfig.json` and `ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json` name any missed.
- [ ] **Step 6: green.** The seven test files above, `mail-routes.test.ts` among them and each run alone; then `landing-terminal-damage.test.ts`, `landing-next-mail.test.ts`, `landing-line-order.test.ts`, `prstate-pr-line.test.ts`, `brief-landed.test.ts`, and the single-definition suite (`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/single-definition`).
- [ ] **Step 7: mutation rows** M10 to M17, M17b, M25 and M27.
- [ ] **Step 8: commit** `fix(landing): a train-closed pull request whose record does not prove it leaves the landing line as closed (D-9112)`.

### Task 3: the references (D-9115)

**Files:** the four references of section 7, `server/test/coordinator-skill.test.ts`, `docs/superpowers/programs/landing-order/wave5l-task-3.md` (new).

- [ ] **Step 1: claim** the files.
- [ ] **Step 2: red first.** Change the four pins (the intro pin, the queue action pin, the line pin, the stop pin and its `toContain` neighbour) to the new sentences of section 7; run `coordinator-skill.test.ts`: those cases are red.
- [ ] **Step 3: the text.** Apply sections 7.1 to 7.6, wrapped as the files are wrapped.
- [ ] **Step 4: green.** `coordinator-skill.test.ts`, `coordinator-landing-verdict.test.ts`, `coordinator-skill-autonomy.test.ts`, `coordinator-approval-prompts.test.ts`, and `ccrc-api-closed.test.ts` (run only: another wave holds it).
- [ ] **Step 5: mutation row** M18.
- [ ] **Step 6: commit** `docs(coordinator): the landing line before the ready mark, and the stop on a train-closed head (D-9115)`.

### Task 4: the README

**Files:** `README.md` (held by claim 7303), `docs/superpowers/programs/landing-order/wave5l-task-4.md` (new).

- [ ] **Step 1: the packet.** Send the holder of claim 7303 the unified diff of section 8 against the `main` commit you build on, inline, with its size and sha256. Wait for the answer; touch nothing before it.
- [ ] **Step 2: the check and the change.** Save sections 8.1 and 8.2's old and new blocks and 8.3's two sentences to six files in `$TMPDIR` (never in the work tree), then run, from the work tree:

```bash
python3 - "$TMPDIR"/5l-readme <<'PY'
import pathlib, sys
d = pathlib.Path(sys.argv[1]); readme = pathlib.Path('README.md'); text = readme.read_text()
for k in ('1', '2', '3'):
    old = (d / f'old{k}.txt').read_text().rstrip('\n'); new = (d / f'new{k}.txt').read_text().rstrip('\n')
    assert text.count(old) == 1, f'old text {k} occurs {text.count(old)} times'
    text = text.replace(old, new)
    assert text.count(new) == 1, f'new text {k} occurs {text.count(new)} times'
readme.write_text(text)
print('README: three changes applied')
PY
```

- [ ] **Step 3: check** the rendered README in the pull request's GitHub preview at the two changed sections (the four-backtick fence of 8.2).
- [ ] **Step 4: commit** `docs(readme): the train record's two forms, and the landed reader's closed mark (D-9111, D-9112)`.

### Task 5: the gate and the notes

**Files:** `docs/superpowers/programs/landing-order/wave5l-task-5.md` (new).

- [ ] **Step 1:** the server typecheck and the test typecheck through `ccrc test`; the full server suite once through `ccrc test` (foreground, `--maxWorkers=2`), re-running any red file alone before calling it a break.
- [ ] **Step 2:** each task note lists its mutation rows as measured (red case named, restored), the files claimed, and what moved since the baseline.
- [ ] **Step 3:** the wave-done mail lists anything here the builder could not keep.

## 10. Mutation table

Each row is one change to the built code, measured red by the named case, then restored.

| id | Mutation | Predicted red |
|---|---|---|
| M1 | `members_block`'s sha check is `[0-9a-fA-F]{7,40}` | P2, P3 |
| M2 | `members_block`'s `type(pr) is int` test is dropped (the decimal check on `str(pr)` kept) | P4's string `"43"`. Its boolean and float bodies are refused by the decimal check too (`True`, `43.0`), so no single mutant reaches them: they are characterization pins |
| M3 | `members_block` takes the first opening line and ignores a second | P5 |
| M4 | `train_members` answers v1's map when both read, ignoring the tool's | P12, P13 (not P14: its tool block reads `bad`, which the table's `any \| bad` row answers before this arm; M24 guards that row) |
| M5 | `train_members` answers the union of both maps when both read (v1's entries over the tool's) | P12, P13 |
| M6 | `train-check`'s loop drops the `state != 'MERGED'` test | P16 (its OPEN train carries a merge time and a merge commit, so nothing else refuses it) |
| M7 | `members_block` lets a later member overwrite an earlier one (no duplicate check) | P8 |
| M8 | `json.loads` without the `object_pairs_hook` (a key given twice passes) | P7's duplicate key |
| M9 | `train_members` answers no map when v1 reads and the tool's block is absent | P15 |
| M10 | `landedAnswerOf`'s new arm is removed (today's code: `train-unproven` retries) | R-A; the lane mark case |
| M11 | the new arm's test becomes `(reason === 'train-unproven' \|\| reason === 'train-unread') && (train === 'unproven' \|\| train === 'unread')` | R-B; the lane retry case |
| M12 | the new arm drops `read.train === 'unproven'` | R-C |
| M13 | `landedAnswerOf`'s `merged` arm answers `close` with `word: 'closed'` | R-E |
| M14 | `landedAnswerOf`'s `open` arm answers `close` | R-F |
| M15 | `landingOrder`'s line filter is `x.state === 'pinned' \|\| x.state === 'closed'` | the binding-after case |
| M16 | `decideLandingLand` maps a `closed` outcome to state `pinned` (the entry kept) | the lane mark case; the store case |
| M17 | `decideLandingLand` always writes `reason` (as `null` for a plain closed) | the store case's first detail; `landing-land-words`' closed-and-absent case |
| M17b | `decideLandingLand` never writes `reason` | the store case's second detail; `landing-land-words`' `train-unproven` case |
| M18 | any one new sentence of section 7 removed from its reference | its pin in `coordinator-skill.test.ts` |
| M19 | `json.loads` without `parse_constant` (`NaN` passes) | P7's `NaN` in the never-read `blast` |
| M20 | `members_block` accepts an empty array | P7's `[]` (its whole-line sentence; the mutant prints `does not list #42`) |
| M21 | the loop's two sentences always say `ccrc-train v1 block` | P9, P10, P37, P38 |
| M22 | `members_block` compares its fence lines without stripping them | P21 |
| M23 | the absent sentence drops the words `ccrc-train v1` | P18; `ccd-ws-audit.test.ts`' two no-block cases |
| M24 | `train_members` treats a bad members block as absent when the v1 block reads | P14 |
| M25 | `landedAnswerOf`'s new arm drops `cand.repairToken === undefined` | R-G |
| M26 | `members_block`'s parse catches `ValueError` alone | P31 (the prover prints nothing, so the whole-line check reds) |
| M27 | `landedPass` calls `landedAnswerOf(read, {})` in place of `landedAnswerOf(read, cand)` | the lane's repair-candidate case (the damaged row is retired `closed`) |

The store case's journal check (the bytes and the cursor unchanged) is a characterization pin with no natural mutation; the builder measures it red by adding a `landing.log` append to the land arm in a scratch copy, then discards the copy.

## 11. Fix rounds: findings and rulings

### 11.1 Fix round 1

Review run 3935 read the tip `67a964b6f0`; the coordinator ruled in call 1453. Each item and where it went:

| Item | What changed | Where |
|---|---|---|
| F1 | nine builders of the closed outcome, not six; `landing-land-words.test.ts` added to the files and claims, with a `train-unproven` detail row; the citation of the closed-detail case moved to that file | "What was measured", sections 3 and 4.4, Task 2 |
| F2 | malformed members sit beside a valid `#42`; P16's OPEN train carries merge facts; M11 widens both tests; M5 and P7's duplicate key corrected | section 9.1, section 10 |
| F3 | the baseline split recomputed against today's parser, as a column of section 9.1; Task 2's Step 3 and Step 4 split corrected | section 9.1, Task 1 Step 3, Task 2 Step 2 |
| F4, Q3 | `closed` is final; no re-mark in this wave or later; the ticket-done, work-map and close-notice readers added | section 1 (decision 2), section 5, section 6, "What this does not claim", D-9112 |
| F5 | the departure from spec §5.5 stated; the amendment line given word for word for the coordinator's ledger pull request; this pull request edits no spec | "What was measured", section 1, D-9112 |
| F6 | no waiver number up front; the comment lines Step 4 may shorten are named | section 4.2 |
| F7 | the loop's two sentences name the form read; the members block's sentences listed; `prstate.ts`' comment added | section 4.2, section 3, Task 1, P9, P9b, P10, M21 |
| F8 | §7.4's and §7.2's new sentences cover a first read that is already `ready` | sections 7.2 and 7.4 |
| F9 | when the prover asks again inside the tried window, corrected | section 6 |
| F10, Q1 | the held entry is read from `order.head`; the mail goes to its run's coordinator only after a re-read past the reader's longest back-off; an entry with no run goes to the operator as an item | sections 1 and 7.2, D-9115 |
| F11, Q4 | strict on `pr` and `headSha`, lenient on other keys; each accepted shape and each new refusal has a case; rows for `parse_constant` and the one-member minimum | sections 4.1, 9.1 and 10 |
| F12 | the fork and no-budget edge stated, with the operator's withdrawal as its release | "What this does not claim" |
| Q2 | the third README sentence kept | sections 1 and 8.3 |

### 11.2 Fix round 2

Review run 3936 read the tip `ec647ba1f4`; the coordinator ruled in call 1459. Each item and where it went:

| Item | What changed | Where |
|---|---|---|
| F1 | the withdrawal (`decideWithdraw`, the withdraw statement) and the reader's project walk (`landingReadProjects`) added as readers that treat both words alike; the operator cannot withdraw a train-closed entry; the fork-edge remark says the door takes a still-pinned entry | "What was measured", section 5, "What this does not claim" |
| F2 | the bounded repair is not widened (ruled): `landedAnswerOf` takes the candidate and answers `retry` on `train-unproven` for a repair candidate; `landedLane.ts` passes it, one argument; case R-G, row M25; section 5's repair row corrected; the spec line says it | "What was measured", sections 1, 3, 4.3, 5, 9.2 and 10, Global Constraints, "What this does not claim", Task 2, D-9112 |
| F3 | Task 2 Step 5 says nine: seven literal sites, two parametric cases rebuilt whole | Task 2 |
| F4 | cases for the lenient shapes: no `blast` (P32), an unknown key (P33), a `blast` that is not an integer (P34), compact separators and reordered keys (P35), a tab-indented fence (P36) | sections 4.1 and 9.1 |
| F5 | row M24 for the `any \| bad` row (red: P14); P14 out of M4 | section 10 |
| F6 | one sentence: a server-first window records every train landing `closed` for good (ruled) | "What this does not claim" |
| A1 | while the line is paused, the held entry is the one whose `id` is `binding.entryId`, read without `--pr` (ruled) | sections 1 and 7.2, D-9115 |
| A2 | the checks lane lost for the episode, and the coordinator's own checks gate, stated as a cost (ruled) | "What this does not claim" |
| A3 | 7.2 says six new sentences, and the line pin holds them all | section 7.2 |
| A4 | the Global Constraint names `landedLane.ts`' one argument and `prstate.ts`' one comment | Global Constraints, section 3 |
| A5 | the wave 5c amendment's words quoted as words it says, and where it ends | "What was measured" |
| A6 | the both-blocks form is `ccrc-train v1 block, like its train-members block,`, singular; P37 and P38 pin its two sentences; M21 covers them | sections 4.2, 9.1 and 10 |
| A7 | `_ws_train_record`'s header comment named in Step 4 | section 3, Task 1 |
| A8 | how Task 4 splits if the wave is split | section 2 |
| A9 | `rawTrainMembers` defined as the one writer of a raw block; `extra` dropped; `toolTrainRow` takes the block | sections 3 and 9, Task 1 |
| A10 | the parse catches `(ValueError, RecursionError)`; case P31, row M26 | sections 4.1, 9.1 and 10, Task 1 |
| A11 | the merged feed record's row says `sweepMerged` skips a row with no workspace or an archived one | section 5 |
| A12 | the spec line covers D-9112 alone (ruled); the README owns the grammar | D-9112 |
| A13 | Task 5 names its note file | Task 5 |
| A14 | one re-read after 20 minutes, the longest back-off plus one beat, with the reason (ruled) | sections 1 and 7.2, D-9115 |

## 12. Corrections after review run 3939

Review run 3939 (round 3, the last) read this plan at `8935fd2736d8c886b2becf26c693d07db8c2d9a3`, the commit that merged as #3423. It found nothing critical and said a builder can start once one test file is named; it left four important points and seven minor ones, each with the right text. There is no fourth round: the coordinator corrected them here, on the ledger's pull request, after reading the cited code on `main` at `aac570d3d1e470066abd8c056c33752bd6398375`. Each correction is also made in place in the section it names, so a text a pin or a script quotes has one copy. **Where this section and another section or a task disagree, this section wins.**

- **C1, the census of quoted tokens (the review's F1).** `server/test/mail-routes.test.ts` has a case that reads every `server/src/coord/*.ts` file as text and requires each quoted kebab token to be declared. No coord file quotes `train-unproven` today; Task 2 puts it in `landed.ts` and `landingEntry.ts`, so that case would go red in a file the task did not claim. The reader's other reason word, `missing-field`, has its own `NOT_CODES` row there for the same cause.
  - Added: the file's row in section 3, the file in Task 2's files (so Step 1 claims it), the row's addition in Step 2, and the file among those Step 6 runs alone.
- **C2, the repair guard at the lane's hand-off (F2).** `landedAnswerOf` takes `Pick<LandedCandidate, 'repairToken'>`, which an empty object satisfies. A lane that passed a literal without the token would still compile, a repair candidate's `train-unproven` reading would answer `close`, and the land arm, whose compare-and-set still carries the token, would retire the damaged row `closed`: the widening call 1459 ruled out. Case R-G guards the decider alone.
  - Added: a third lane case in section 9.3 (a damaged entry, built with `landed-lane.test.ts`' own `damage` helper, left untouched by the pass), row M27, and their mention in Step 2, Step 7 and Review Focus 3. The repair-candidate case asserts first that the entry is a repair candidate, from the project's own candidates, since nothing is marked in it: without that it would pass for the wrong reason.
- **C3, the README's sentence on the reader (F3).** Section 8.1's new text said the reader marks "the pinned entry" `closed` with no exception. The land arm also marks an `ejected` entry, and a damaged row the bounded repair hands the reader is asked again, not marked. Edited in place: "the entry", and the exception.
- **C4, the README's sentence on the line (F4).** Section 8.3's new text said "its train record does not prove the landing", which is also true of a record that could not be read, and that case stays a retry. Edited in place: "was read and did not prove".
- **C5, the spec's amended line (A-1).** Its last sentence argued in a circle: the reader "reads it as GitHub's CLOSED", yet a repair candidate is excluded "since amendment B retires a row only on a merged, closed or absent reading". Amendment B names the PR-keyed form's own word, and that word for this claim is `unmeasured`. Edited in place in the D-9112 entry, in section 4.3's comment (which ships as source) and in decision 2, and the spec carries the corrected line.
- **C6, where the early sentence stands, and one term (A-2, A-3).**
  - Section 7.1's sentence stood second in §5b's opening, ahead of "The reads run fresh each time" and "They are the block below", so "the reads" could be taken to include the landing-line read. It now stands last in the opening, after "It makes GETs only…", and begins "Besides the verdict". The intro pin takes it as its last element. Edited in place; the old text of 7.1 is now that last sentence, and decision 4 says where the sentence stands.
  - The paragraph these sentences defer to says a project is "positively opted in to the binding head". Sections 7.1, 7.4, 7.5, 7.6, "What this does not claim" and the D-9115 entry said "opted in"; each now says "positively opted in", and the pins take the sentences as written here.
- **C7, the parser's table (A-6).** Section 4.2's table wrote refusals as pairs and named no form on its proving rows, against the three-part answer its signature gives. Each row is now a triple. Section 4.1 says the map is keyed by the member's decimal text, as `train_block`'s is: a map keyed by the integer would refuse every proving case, because the loop tests the text of its argument.
- **C8, a case of its own for the reason (A-7).** Task 2 Step 2 added the `train-unproven` row to the case titled "closed and absent mark closed and carry only v, by, at and word", whose title and rebuilt loop it contradicts. That case stays as section 4.4 rebuilds it, and a case of its own beside it pins the detail that carries the reason. Row M17 names the first; a new row, M17b, names the second.
- **C9, smaller points.**
  - Task 2 Step 6 said "the five test files above" (A-4); with the two added since the first draft it is seven.
  - Section 9's harness facts for P19 and P20 (A-5): the repository fixture and the command they run, and what `GH_STUB` is.
  - The reviewer's note on P30: its body is written by hand (the opening line, then the closing line). `trainBlock([])` leaves an empty line inside the block, which is refused as a line that is not a member line, so the helper cannot build it. The baseline's green holds for the hand-written body only. Row P30 says so.
  - The Deviations section said three numbers were issued for this plan. Two of them were issued with wave 5k's block and given to this plan; the sentence now says which.
- **Not changed.** The review listed a recovery hold as a second case with no `order.head`: with no head, the rule for a held head that is a train-closed pull request does not fire, and the paragraph's ordinary stop applies. Mutation rows are the builder's to measure.

## Deviations found

Four numbers are defined below. D-9111 and D-9112 were issued on 2026-11-26 with wave 5k's block, left unused there, and given to this plan by the coordinator; D-9115 was issued for this plan the same day; D-9134 was issued on 2026-11-26 for a departure found while building.

- **D-9111 (2026-11-26)** — `train-members-second-grammar`: the train record's one parser (`_pr_train_py`'s `train-check`, `ccd/lib/train-proof.sh`) reads the merge train tool's `train-members` block beside the documented `ccrc-train v1` block.
  - The grammar: exactly one block; one JSON array of at least one member; every member an integer `pr` of the PR grammar (never a boolean) and a full lowercase 40-hex `headSha`; no key given twice; no member listed twice; other keys never read. Anything else proves nothing.
  - Both blocks in one body prove only when both read and list the same members at the same heads; any difference proves nothing. One form alone is read alone, so a hand-added documented block still proves.
  - Legitimately different: the tool is another process, the operator's, outside the tree; both grammars feed the one judge after the one parser.
  - Measured: all 14 train pull requests of this repository write that block and no other; only one carries the documented block, added by hand.
- **D-9112 (2026-11-26)** — `closed-train-unproven-leaves-the-line`: the landed reader answers `close` for the one-PR form's `unmeasured` with reason `train-unproven` and `trainUnproven: true`, and the mark records `"reason":"train-unproven"` in the entry's `detail`; the entry takes the existing word `closed`.
  - Why: GitHub's CLOSED is definitive, so the entry can never be the next to land, and as `pinned` it held the binding's head for good.
  - `train-unread` and every other `unmeasured` answer stay a retry, and so does `train-unproven` for a terminal-repair candidate: spec amendment B retires a damaged row only on a fresh PR-keyed `merged`, `closed` or `absent` observation, this claim's word on that form is `unmeasured`, and this wave does not widen it (ruled, call 1459). No new state, journal record or binding rule; the run's close is untouched.
  - `closed` is final (ruled, call 1453): an entry so marked may have landed and stays `closed` when its proof holds later; no re-mark is built or planned, and its ticket is closed by naming its run.
  - It departs from spec §5.5 for the refused case only. The spec's wave 5c amendment says "a train claim the proof refused or could not read is `unmeasured` (D-7596)": the PR-keyed form still prints that, and the reader now acts on the refused claim as GitHub's CLOSED; `could not read` stays `unmeasured` and is read again. This pull request changes no spec. The coordinator adds this line to §5.5 on the ledger pull request, after the wave 5c amendment's closing "gated by the `pr-state-pr-v1` capability.)", word for word:

    > (Amended 2026-11-26, wave 5l, D-9112: a train claim the proof refused is still `unmeasured` on the PR-keyed form, but the landed reader reads it as GitHub's CLOSED, so the entry is `closed`, its `detail` naming `train-unproven`, and it stays `closed` if a proof appears later; a claim the proof could not read stays `unmeasured` and is read again. A terminal-repair candidate is not retired on such a claim: it is read again, since amendment B retires a row only on a fresh PR-keyed `merged`, `closed` or `absent` observation, and the PR-keyed form's word for this claim is `unmeasured`.)

    The line covers D-9112 alone (ruled, call 1459): §5.5 does not specify the train record's grammar, which the README owns.

- **D-9115 (2026-11-26)** — `ready-mark-waits-for-the-line`: on a project positively opted in to the binding head, the coordinator reads the landing line with the PR's number, lands only on a `ready` binding for its own run's entry at its head, keeps the PR a draft while it waits (taken back right after the advance to `merging`, marked ready again only on a read whose binding is ready, then the verdict, the checks gate and the landing in one sitting), and on a held binding whose head (`order.head`, or while the line is paused the entry whose `id` is `binding.entryId`) is another run's entry whose PR is closed with the train label lands nothing past it, writes no train record, reads the line once more after 20 minutes (the landed reader's longest back-off for that answer, 15 minutes, plus one beat of its lane, rounded up), and only if the same head still holds mails the coordinator of that entry's run, or, for an entry with no run, puts it to the operator as an item.
  - Why: a merge train boards any ready PR, so a PR left ready while it waits its turn is exposed for as long as it waits (issue #3422's third defect); and a coordinator that read only the line's flags landed past a held head.
  - The ready mark still precedes the advance (D-8999); the probe lists drafts, so a drafted entry still binds. No `SKILL.md` clause changes: clause 15 already defers the ready mark to §4, which now says it.
- **D-9134 (2026-11-26)** — `store-case-journal-seed`: the store case of section 9.3 first journals one no-run creation in another project, then reads the journal's bytes and the cursor.
  - Why: on the `boot` fixture a run's pin writes no journal record, so no journal file existed to compare, and the plan's case as written could not read one.
  - What it still proves: both marks leave the journal's bytes and the cursor exactly as they were.
