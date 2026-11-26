# Landing order, wave 5l — a train landing must not hold the landing line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan dispatches nothing itself: the wave is built by a worker the coordinator dispatches.

**Status:** drafted on 2026-11-26 for run 3930 (programme `landing-order`, the run's wave 31) from the brief's six decisions and the coordinator's answer of the same day (D-9115 issued for the ready mark; the clear line; the one early sentence). One build wave; section 2 says why it is not split and where the seam would be.

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
- **The land arm writes one row and no journal record.** `CoordStore.advanceLanding`'s land arm (`server/src/coord/store.ts`) runs `UPDATE landing_entries SET state = ?, detail = ? WHERE id = ?` and appends nothing to `~/.ccrc/landing.log`: landed state is re-measured, never journalled (spec §5.5). `decideLandingLand` writes the detail `{"v":1,"by":…,"at":…,"word":"closed"}` for a closed outcome and `{"v":1,…,"word":"absent"}` for an absent one (`server/test/landing-land-store.test.ts`, "closed and absent mark closed").
- **A `closed` entry is final until its run pins again.** `landingEntry.ts#isLandable` admits only `pinned` and `ejected`, so the reader never reads a `closed` entry again and the close's mark (`landed.ts#closeLandingOf`, `expect: null`) answers `kept` over it. `landingEntry.ts#decideLandingWrite` re-pins a `closed` row at the run's next verified pin when its projection reads with no marker. The terminal repair (`landingEntry.ts#terminalRepairOf`) answers `null` for a row whose stored word is terminal, so it never touches a `closed` row. `landingLine.ts#landingViewOf` lists only non-terminal entries in the line's read, so the console (wave 5k) shows a `closed` entry and a `landed` one alike: neither.
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
2. **A CLOSED pull request never holds the head (D-9112).** On the one-PR form's `unmeasured` with reason `train-unproven` AND `trainUnproven: true` (both, read through `readPrStatePrLine`'s `train: 'unproven'`), `landedAnswerOf` answers `{ act: 'close', outcome: { word: 'closed', reason: 'train-unproven' } }`, and the mark records `"reason":"train-unproven"` in the entry's `detail`. `train-unread`, a `train-unproven` reason without the flag, and every other `unmeasured` stay a retry. This is the smallest change: the reader's existing `close` act, the land arm's existing `closed` word and the order's existing rule that a `closed` entry is neither in the line nor outstanding do the rest; no new state, journal record or binding rule. Section 5 answers what reads `closed` and `landed` differently afterwards, and what happens when the proof holds later. The run's own close is not touched.
3. **Both orders of rollout are safe** (section 6). The fleet box moves first, which is `ccrc rollout`'s default.
4. **The ready mark waits for the line (D-9115).** One sentence opens §5b and says what to read and what to land on, so a coordinator who reads only that sentence lands right (the coordinator's request). The landing-line paragraph says when the mark is taken back and given again, and what to do on a held binding that names an entry whose pull request is closed with the train label: land nothing past it, write no train record, and mail that entry's run's coordinator. §4, §5's native-queue paragraph, §5b's stop paragraph and §2's ready sentence say the same in their own place. No `SKILL.md` clause changes (section 7).
5. **The README's two paragraphs, and one more sentence** (section 8). "One PR by number" and "The train record" change word for word, with a check that each old text occurs once. A third, one-sentence change is in the line's own README paragraph, which today says when an entry leaves `closed` and would be wrong after this wave; it is beyond the brief's two and is listed for the coordinator's ruling. `CLAUDE.md` gains no line.
6. **Nothing here boards, lands or orders a train.** The wave reads a train's record better and keeps the line moving; it does not teach the tool about the line, and it writes no train record anywhere.

## 2. One wave, and the seam if it is split

One build wave, one pull request, one context: the prover's change is one python function and its call (Task 1), the reader's is two pure functions and their type (Task 2), and the rest is text with its pins (Tasks 3 and 4). If it must split, the seam is between Task 1 (`ccd/lib/train-proof.sh`, its helper and its test file; deploy class `ccd`, fleet box) and Tasks 2 to 4 (server L1, skills and README; deploy classes `server` and `skills`). Each half lands green alone: no test of one reads the other's code (Task 1's cases drive `ccd` in a fixture HOME; Task 2's feed hand-written `pr-state --pr` lines and facts), and section 6 shows each half is safe on a fleet that has only it.

## 3. File responsibilities

| File | Ring, context | Change | Task |
|---|---|---|---|
| `ccd/lib/train-proof.sh` | ccd library, C4 (`_pr_train_py` in `ccd/contexts.tsv`) | `train-check`'s parser reads both grammars (`train_members`); the file header and the `train-check` comment say so | 1 |
| `server/test/ccdPrHelpers.ts` | test helper | `trainMembers` and `toolTrainRow`, the tool's exact body | 1 |
| `server/test/ccd-train-members.test.ts` (new) | test | prover cases P1 to P20 | 1 |
| `server/src/coord/landingEntry.ts` | L1, C4 | `LandingOutcome`'s `closed` arm carries `reason`; `decideLandingLand` writes it into `detail` | 2 |
| `server/src/coord/landed.ts` | L1, C4 | `landedAnswerOf`'s `unmeasured` arm; its `closed` arm passes `reason: null` | 2 |
| `server/test/landed-decide.test.ts` | test | answer cases R-A to R-F; the existing `closed` expectation gains `reason: null` | 2 |
| `server/test/landing-land-store.test.ts` | test | the store case; three existing `{ word: 'closed' }` inputs gain `reason: null` | 2 |
| `server/test/landing-journal-store.test.ts` | test | one existing `{ word: 'closed' }` input gains `reason: null` | 2 |
| `server/test/landed-lane.test.ts` | test | two lane cases | 2 |
| `server/test/landing-control.test.ts` | test | two binding cases | 2 |
| `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | skill text | §5b's opening, the landing-line paragraph, the stop paragraph | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-5-boundary.md` | skill text | the native-queue paragraph gains one sentence | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-4-advance.md` | skill text | "Ready, then `merging`" gains one sentence | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-2-dispatch.md` | skill text | the ready sentence widens | 3 |
| `server/test/coordinator-skill.test.ts` | test | the four pins take the new sentences | 3 |
| `README.md` (held by claim 7303) | docs | three changes, section 8 | 4 |
| `docs/superpowers/programs/landing-order/wave5l-task-<n>.md` (new) | task notes | one per task | 1 to 5 |

No file in `shared/`, no `server/src/coord/store.ts`, `landingLine.ts`, `landedLane.ts`, `prstate.ts` or `ccd/ccd` change. `store.ts` and `ccd/ccd` are growth-checked and stay untouched.

## 4. Interfaces

### 4.1 The `train-members` grammar (Task 1)

The body is split as `train_block` splits it today: `[l.strip() for l in body.splitlines()]`.

- **Opening:** a line equal to ```` ```train-members ````. Exactly one in the body; none is "no tool block"; two or more prove nothing.
- **Closing:** the first later line equal to ```` ``` ````. None proves nothing.
- **Content:** the lines strictly between, joined with `\n`, parsed by `json.loads(text, object_pairs_hook=…, parse_constant=…)`: the hook refuses a key given twice in one object, and `parse_constant` refuses `NaN`, `Infinity` and `-Infinity`. A parse error proves nothing.
- **Shape:** one JSON array with at least one element; each element an object whose `pr` has `type(pr) is int` (so `true` is refused) and whose decimal text matches `PR_NUM` (`[1-9][0-9]{0,9}`, the program's one spelling), and whose `headSha` is a `str` matching `[0-9a-f]{40}` whole. Any other key, the tool's `blast` among them, is never read. A `pr` listed twice proves nothing.

As a schema (the python is the authority; this is its reading):

```json
{ "type": "array", "minItems": 1,
  "items": { "type": "object", "required": ["pr", "headSha"],
    "properties": { "pr": { "type": "integer", "minimum": 1, "maximum": 9999999999 },
                    "headSha": { "type": "string", "pattern": "^[0-9a-f]{40}$" } } } }
```

with three rules no schema states: no boolean `pr`, no duplicate key in an object, no `pr` in two members.

### 4.2 The one parser (Task 1)

Inside `_pr_train_py`, `train-check` mode. `train_block(body)` keeps its grammar and its sentences byte for byte, and gains one answer for absence so the combiner can tell "absent" from "bad":

```python
def train_block(body):   # -> ('absent', None) | ('ok', {pr: head}) | ('bad', why)   (the v1 block, unchanged rules)
def members_block(body): # -> ('absent', None) | ('ok', {pr: head}) | ('bad', why)   (section 4.1)
def train_members(body): # -> ({pr: head}, None) | (None, why)                       (the ONE parser the loop calls)
```

`train_members` decides:

| v1 block | `train-members` block | answer |
|---|---|---|
| absent | absent | `(None, 'carries no train record: no ccrc-train v1 block and no train-members block')` |
| bad | any | `(None, <v1's why, unchanged>)` |
| any | bad | `(None, <the members block's why>)` |
| ok | absent | v1's map |
| absent | ok | the members map |
| ok | ok, equal maps | that map |
| ok | ok, maps differ | `(None, 'has a ccrc-train v1 block and a train-members block that list different members or heads')` |

The candidate loop calls `train_members(body)` where it calls `train_block(body)` today; nothing else in the loop changes (state, merge commit, base, cross-repository, "does not list", "lists #n at <sha>"). The members block's sentences say `train-members` where v1's say `ccrc-train v1` (for example `carries 2 train-members blocks, not one`, `has a train-members block that never closes`, `has a train-members block that is not one JSON array of members`, `has a train-members block listing #42 twice`). Every why stays a fixed sentence with only digits interpolated, as today.

**Budget:** the change adds at most 40 net lines to `ccd/lib/train-proof.sh`, heredoc lines and python comments included (section "What was measured"). Keep the python's comments short; the grammar's prose lives in the README. If it cannot fit, stop and mail the coordinator for a waiver number: never write a waiver file with a number you were not issued.

### 4.3 The reader's answer (Task 2, `server/src/coord/landed.ts`)

`LandedReadAnswer` does not change. `landedAnswerOf`:

```ts
case 'closed': return { act: 'close', outcome: { word: 'closed', reason: null } };
// …
case 'unmeasured':
  // D-9112: GitHub reads the PR CLOSED with the train label and the train record was read and did not prove it. A
  // closed PR can never be the next to land, so the entry leaves the line; `train-unread` is still asked again.
  if (read.by === 'ccd' && read.reason === 'train-unproven' && read.train === 'unproven') {
    return { act: 'close', outcome: { word: 'closed', reason: 'train-unproven' } };
  }
  return { act: 'retry', missingField: read.by === 'ccd' && read.reason === 'missing-field' };
```

`landedPass` is unchanged: a `close` answer is marked through `advanceLanding` with the candidate's compare-and-set, counted in `result.closed`, its memory dropped, and no `merged` record raised.

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

Only the reader builds `reason: 'train-unproven'`; `closeLandingOf` builds only `merged`, as today. The six existing constructors of `{ word: 'closed' }` (one in `landed.ts`, five in tests: `landed-decide.test.ts` one, `landing-land-store.test.ts` three, `landing-journal-store.test.ts` one) take `reason: null`; the server typecheck names any one missed.

### 4.5 What does not change

`readPrStatePrLine` and `PrStatePrRead` (the reader already keeps `train: 'unproven'`), `landingOrder`, `landingBindingOf`, `landingViewOf`, `isLandable`, `decideLandingWrite`, `terminalRepairOf`, the store, the journal and its parser, every route and wire type, `FLEET_PROTO`, and `ccd`'s `by-pr` line.

## 5. What reads `closed` and `landed` differently afterwards

An entry this wave marks `closed` with reason `train-unproven` may in fact have landed. Every reader of the difference, measured at the baseline:

| Reader | `landed` | `closed` (this wave) | Consequence |
|---|---|---|---|
| The order (`landingOrder`) | not in the line, not outstanding | the same | The binding moves to the next entry at once; direct dependants are freed at the mark, exactly as for a landing. |
| The binding (`landingBindingOf`) | — | — | Takes the next head of the flag-free walk; nothing in it changes. |
| The `merged` feed record | raised by the landed lane on the mark | not raised by the lane | `sweepMerged` raises it when the session form reads the PR `merged` from a proof (a new `ccd`, decision 1), under the same once-only key (`mergedKey`), so the record still comes, once, for every train the prover can read. Under an old `ccd`, neither raises it, as today. |
| The console (wave 5k) | the line's read lists non-terminal entries only | the same | The entry leaves the card either way; `ccrc-api landing show --pr <n>` shows `closed`. |
| The run's close | the coordinator proves MERGED, or CLOSED with `landedInTrain: true`, itself | the same | Untouched: the close re-measures the PR. Its own mark (`closeLandingOf`, `expect: null`) answers `kept` over a `closed` entry, so the entry stays `closed` after a done close. |
| The run's re-entry | a `landed` row stays landed | a `closed` row re-pins at the run's next verified pin (`decideLandingWrite`) | Unchanged rule; a train-closed PR is never pinned again in practice, since its run closes. |
| The terminal repair (`terminalRepairOf`) | never a candidate | never a candidate | It owns only rows whose stored word is not terminal. |
| The entry's `detail` | `word: merged` and the train | `word: closed`, `reason: train-unproven` | Write-only today; it keeps the cause for whoever reads the database. |

**When the proof holds later** (the record is fixed by hand, or a new `ccd` reads it), nothing re-marks the entry: `isLandable` keeps the reader away from a `closed` row, and the close's mark keeps it. Nothing needs to own that change: no reader above treats `closed` and `landed` differently in a way that blocks anyone, the merged record comes from `sweepMerged`, and the run closes on its own re-measurement. A later wave may add a `closed → landed` re-mark if the operator wants the history to say `landed`; this plan does not (question 2 of the wave-done).

## 6. Rollout: both orders

| Pair | What this case reads | Result |
|---|---|---|
| new `ccd`, old server | the one-PR form proves a tool-written train: `merged`, `landedInTrain: true` | the old reader marks `landed`; the line moves. A labelled closed PR whose record still does not prove (no train names it, or the tool's block is malformed) stays `unmeasured` and still holds the head under the old reader, as today. |
| old `ccd`, new server | the old prover cannot read the tool's block: `unmeasured`, `train-unproven` | the new reader marks `closed` (reason `train-unproven`); the line moves. Every train landing in that window reads `closed`, not `landed`, and the landed lane raises no `merged` record for it; the run's close still needs `landedInTrain: true`, which waits for the new `ccd` or a hand-added block, as today. |
| both new | the tool's block proves | `landed`, with the train in `detail`; only a genuinely unproven one is marked `closed`. |

**Fleet box first** (`ccrc rollout`'s default order): it repairs the common case, every tool-written train, at once, and leaves only the rare unproven one to the server half. A server first would record every train landing of the window as `closed`. After the `ccd` move, a member whose record was refused in the last `PR_TRAIN_TRIED_TTL` (30 minutes) reads `train-unproven` on the project sweep until its tried line goes stale or `pr-train-prove` asks again; the one-PR form asks GitHub on every read and is not held by that line.

## 7. The coordinator references (Task 3)

Old and new text, each as the flat sentences the pins hold (`server/test/coordinator-skill.test.ts`'s `flat` joins a paragraph's lines with single spaces). Wrap the new text in each file as its neighbours are wrapped. Each change updates its pin in the same commit; §4 and §2 are not pinned. No `SKILL.md` clause changes: clause 15 already says the PR is "marked ready and turned back only as `references/wave-lifecycle.md` §4 says", and §4 now says the take-back.

### 7.1 §5b's opening (`wave-lifecycle-5b-landing.md`; the intro pin)

Old:

> Before every landing, on every project, this session reads the PR's repository and lands only by the route its rules give (spec 2026-09-23 §5.7).

New (one sentence added after it; the coordinator's "one sentence, early"):

> Before every landing, on every project, this session reads the PR's repository and lands only by the route its rules give (spec 2026-09-23 §5.7). On a project opted in to the binding head, it also reads the landing line with the PR's number, `ccrc-api landing show --project <project> --pr <pr>`, and lands only when that read's `binding` is `ready` for this run's own entry at the head it binds: any other answer lands nothing (**The landing line**, below).

### 7.2 The landing-line paragraph (`wave-lifecycle-5b-landing.md`; the line pin)

Old (the sentence the new ones follow):

> On a project that is positively opted in, a `held` binding, a `binding` naming a PR that is not this run's, an answer you cannot read, or no entry for this PR means stop and report what you read to the operator; never choose a successor.

New (that sentence unchanged, then three sentences):

> On a project that is positively opted in, a `held` binding, a `binding` naming a PR that is not this run's, an answer you cannot read, or no entry for this PR means stop and report what you read to the operator; never choose a successor. On such a project the PR is a draft while it waits its turn, because a merge train boards any ready PR: read the line as soon as the advance to `merging` answers `ok`, and unless that read's `binding` is `ready` for this run's own entry at the head you bind, turn the PR back into a draft with `gh pr ready <pr> --undo` before your turn ends (D-9115). Mark it ready again with `gh pr ready <pr>` only on a later read whose `binding` is, and run the verdict, the checks gate, this read and the landing in that same sitting. A `held` binding whose `entryId` names another run's entry whose PR GitHub reads CLOSED with the `landed-in-train` label (`gh pr view <n> --json state,labels`) is a train landing the landed reader has not marked yet: land nothing past it, write no train record and edit no train's body, and mail that entry's run's coordinator (`toId: 'coordinator'` with that entry's `runId`) what you read, or, for an entry with no run, report it to the operator.

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

> A refused advance turns the PR back into a draft at once (`gh pr ready <pr> --undo`, §4), and a head other than `handoffCommit` is never marked ready. On a project opted in to the binding head, read the landing line as soon as the advance answers `ok` and turn the PR back into a draft unless its `binding` is `ready` for this run's own entry (§5b, **The landing line**); the gate below, the enqueue and the read-back then run only in the sitting that marks it ready again (D-9115).

### 7.5 "Ready, then `merging`" (`wave-lifecycle-4-advance.md`; not pinned)

Old (the sentence the new one follows):

> On every send-back to `working`, from `merging` or from `awaiting-review`, turn it back into a draft first (`gh pr ready <pr> --undo`; on a PR already a draft it changes nothing).

New (that sentence unchanged, then one):

> On every send-back to `working`, from `merging` or from `awaiting-review`, turn it back into a draft first (`gh pr ready <pr> --undo`; on a PR already a draft it changes nothing). On a project opted in to the binding head, also turn it back into a draft once the advance to `merging` answers `ok` while the landing line's `binding` is not `ready` for this run's own entry, and mark it ready again only on a read whose `binding` is, as §5b's **The landing line** says (D-9115); a `checks:` mail whose `left` names `draft` for that run is this act and needs nothing.

### 7.6 The ready sentence of a brief (`wave-lifecycle-2-dispatch.md`; not pinned)

Old:

> This session marks the PR ready (`gh pr ready <pr>`) only once its review passes, immediately before the advance to `merging` (§4); the session hook refuses a worker `gh pr ready` and a `gh pr create` without `--draft` (D-8998).

New:

> This session marks the PR ready (`gh pr ready <pr>`) only once its review passes, immediately before the advance to `merging`, and on a project opted in to the binding head turns it back into a draft while it waits its turn on the landing line (§4, D-9115); the session hook refuses a worker `gh pr ready` and a `gh pr create` without `--draft` (D-8998).

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
GitHub's CLOSED: it marks the pinned entry `closed`, its detail naming `train-unproven`, so the entry leaves the
landing line (D-9112); a `train-unread` line, and every other `unmeasured` one, it asks again at its back-off.
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

> or `closed` when GitHub reads it closed unmerged, reads it closed with the train label while its train record does not prove the landing (`train-unproven`, D-9112), or says no such PR exists.

## 9. Tests by layer

- **Prover (Task 1), `server/test/ccd-train-members.test.ts`:** a fixture HOME from `makePrHarness` (`server/test/ccdPrHelpers.ts`), the harness's poisoned `gh` stub (`GH_STUB`, which answers only from the fixture files `ghView`, `ghViewFail` and `ghSearch` plant), no network. Most cases pipe a train PR's JSON straight into `_pr_py train-check <member> <head> main` through `h.sh` and compare the one line it prints (`<train>\t<oid>`, `!<why>`, `?<why>`); two run the one-PR form end to end. Bodies come from two new helpers that write the tool's exact shape: `trainMembers(members, over?)` (the fence, one `json.dumps`-default line, the fence) and `toolTrainRow(number, mergeOid, members, over?)` (a MERGED train whose body is the tool's header text, its table, the block and the trailer, as #3415's was before the hand edit, with neutral numbers).
- **Pure (Task 2):** `landed-decide.test.ts` (the answer), `landing-control.test.ts` beside its binding cases, with that file's own facts and control fixtures (the binding).
- **Lane (Task 2):** `landed-lane.test.ts`, with its fake `runCcd` answering a hand-written `pr-state --pr` line.
- **Store (Task 2):** `landing-land-store.test.ts`, on its `boot` fixture: the mark is one row change and writes the journal exactly as today's `closed` does, which is not at all.
- **Text (Task 3):** the four pins in `coordinator-skill.test.ts`.
- **README (Task 4):** the check script.
- **Load-sensitive files** to run alone when one goes red (root `CLAUDE.md`'s list): `pr-sweep`, `typecheck-tests`; and run `ccd-pr-state`, `ccd-ws-audit` and `ccd-pr-landing` one file per process, as they shell `ccd` hundreds of times.

### 9.1 The prover cases (Task 1)

Member `#42` at head `H = 'a'.repeat(40)`, train `#50` MERGED as `M = 'e'.repeat(40)`, base `main`, unless the case says otherwise.

| id | Body or train | Expected line |
|---|---|---|
| P1 | tool block alone, `#42` at `H` | `50\t<M>` |
| P2 | tool block, `#42` at `H.slice(0, 12)` | `!` (does not prove) |
| P3 | tool block, `#42` at `H.toUpperCase()` (use `'A'.repeat(40)` with a member head of `'a'.repeat(40)`) | `!` |
| P4 | tool block, `pr` as `"42"`; then `true`; then `42.0`; then `12345678901` | `!` each |
| P5 | two tool blocks, both listing `#42` at `H` | `!` (`carries 2 train-members blocks, not one`) |
| P6 | tool block that never closes | `!` |
| P7 | content `[]`; then `{"pr": 42, …}` (an object, not an array); then `NaN` in a member; then `{"pr": 42, "pr": 42, "headSha": …}` | `!` each |
| P8 | tool block listing `#42` twice at `H` | `!` |
| P9 | tool block listing `#42` at another sha | `!` (`lists #42 at …, not its head …`) |
| P10 | tool block listing only `#43` | `!` (`does not list #42`) |
| P11 | both blocks, equal maps (#3415's shape) | `50\t<M>` |
| P12 | both blocks, `#42` at another sha in the tool's | `!` (`… list different members or heads`) |
| P13 | both blocks, an extra member `#43` in the v1 block only | `!` |
| P14 | both blocks, the tool's malformed (P6's) | `!` |
| P15 | v1 block alone (hand-added) | `50\t<M>` (the existing rule, kept) |
| P16 | an OPEN train (`state: 'OPEN'`, `mergedAt: null`, `mergeCommit: null`) with a valid tool block | `?train #50 is still open` |
| P17 | a CLOSED unmerged train with a valid tool block | `!train #50 is closed, not merged` |
| P18 | the table and the trailer alone, no block | `!` (`carries no train record: …`) |
| P19 | end to end: `pr-state --project <p> --pr 42`, `#42` CLOSED with the label and the comment `Landed in train #50 (head `aaaaaaaaaaaa`).`, train `#50` a `toolTrainRow` | `merged`, `landedInTrain: true`, `train: 50`, `trainMergeCommit: M`; the proof kept in `.train-proofs` |
| P20 | end to end: the same with no comment, and `ghSearch` answering `[toolTrainRow(50, …)]` | the same proof (the search fallback) |

### 9.2 The reader cases (Task 2)

| id | Input to `landedAnswerOf` | Expected |
|---|---|---|
| R-A | `{ state: 'unmeasured', pr: 7, by: 'ccd', reason: 'train-unproven', train: 'unproven' }` | `{ act: 'close', outcome: { word: 'closed', reason: 'train-unproven' } }` |
| R-B | the same with `reason: 'train-unread', train: 'unread'` | `{ act: 'retry', missingField: false }` |
| R-C | `reason: 'train-unproven', train: null` (the flag absent) | `{ act: 'retry', missingField: false }` |
| R-D | `{ state: 'unmeasured', pr: 7, by: 'reader', reason: 'train-flags', train: null }` | `retry` |
| R-E | a `merged` read with `train: { number: 50, mergeCommit: M }` | `land`, `word: 'merged'`, the train carried (existing case, kept) |
| R-F | an `open` read | `{ act: 'wait' }` (existing case, kept) |

Each row is asserted with `toEqual`, so a changed act, word or reason reds.

### 9.3 The lane, store and binding cases (Task 2)

- **Lane, the mark:** one pinned entry; `runCcd` answers the `by-pr` line of a labelled, closed, unproven PR (as `ccd` prints it, `trainUnproven: true`, the facts echoed). After one `landedPass`: the entry reads `closed`, `result.closed === 1`, `result.landed === 0`, the entry's memory is gone, and no `merged` notice was raised.
- **Lane, the retry:** the same with `trainUnread: true`, `reason: 'train-unread'`: the entry stays `pinned`, the memory's `nextAt` is `at + 2 * PR_SWEEP_MS`, nothing is marked.
- **Store:** two pinned entries in one project. Read the journal's bytes and `landing_journal_cursor`; mark the first with `{ word: 'closed', reason: null }` and the second with `{ word: 'closed', reason: 'train-unproven' }`. Both read `closed`; the first's `detail` is exactly `{ v: 1, by: 'reader', at: 5000, word: 'closed' }` and the second's exactly `{ v: 1, by: 'reader', at: 5000, word: 'closed', reason: 'train-unproven' }`; the journal's bytes and the cursor equal what they were before both marks.
- **Binding, before the mark (the defect, pinned):** entries A (`pr` 41, pinned first) and B (`pr` 42, pinned later), every control document fresh and green, the probe listing only B at its pinned sha: `landingBindingOf` answers `{ mode: 'held', reason: 'head-mismatch', entryId: A.id }`.
- **Binding, after the mark:** the same with A's display state and stored word `closed`: `{ mode: 'ready', entryId: B.id, pr: 42, … }`.

## Global Constraints

- **The prover is one parser and one judge.** `train_members` is the only function that reads a train body; `train-check`'s loop is the only place that decides a proof; no second reader of `train-members` anywhere in the tree (D-9111's recorded reason is the tool, not a new mechanism).
- **Decide in L1, act in L4.** Only `landed.ts` and `landingEntry.ts` change in `server/src`; `landedLane.ts` (L4) and the store (L3) do not.
- **No new state, journal record, route, migration, `ccd` verb, capability word or wire field.** `FLEET_PROTO` stays 1. `closed` is the existing terminal word.
- **Growth:** `ccd/lib/train-proof.sh` grows at most 40 net code lines (heredoc lines count); `ccd/ccd` and `server/src/coord/store.ts` are untouched.
- **Fixture HOMEs only.** Every `ccd` call in a test runs through `makePrHarness`'s HOME and its poisoned `gh`; no test runs `ccd` against the live home, and no test reads GitHub.
- **Neutral names only** in fixtures, notes, commits and the pull request: `project-a`, `lane-a`, `the fleet box`; train and member numbers are small fixture numbers, never the measured ones. Cite code as `file#symbol` or `file#@anchor`.
- **Every test and typecheck runs through `ccrc test -- <command>`,** in the foreground, tool timeout at least 600000 ms, `--maxWorkers=2`, cd'd in `server/`.
- **Claims and packets.** Read `ccrc-api claims list --project ccrc-pwa` before each task and claim every path it edits. `README.md` is held by claim 7303 (wave 5k's build): send its holder a unified diff against a named `main` commit, inline, with its size and sha256, and leave the file untouched until the answer. Keep off `ccd/ccd`, `shared/landingLine.ts`, `server/src/coord/landingWrites.ts` and wave 5k's landing test files.
- **Commits** on the workspace's own branch; push once, when the wave is complete; the pull request stays a draft. Task notes go under `docs/superpowers/programs/landing-order/` as `wave5l-task-<n>.md`; never edit an existing plan or the programme ledger.
- **Deviation numbers are issued, never chosen.** This plan defines D-9111, D-9112 and D-9115. A departure found while building is named by slug (`D-TBD-<slug>`) in the wave-done mail, never in a tracked file.

## Review Focus

1. **A body that proves what it should not:** a short, uppercase or boolean member, two tool blocks, a duplicate key or member, an OPEN train, or two blocks that differ (P2 to P8, P12 to P14, P16; rows M1 to M8).
2. **A body that stops proving what it did:** a hand-added `ccrc-train v1` block alone, both blocks agreeing, and every v1 refusal sentence unchanged (P11, P15, the existing `ccd-pr-state` and `ccd-ws-audit` train cases; row M9).
3. **An entry marked on an answer that says nothing definitive:** `train-unread`, a `train-unproven` reason without its flag, a reader refusal, an `open` or a `merged` read (R-B to R-F; rows M11 to M14).
4. **The line still held:** a closed, labelled, unproven entry left `pinned`, or the binding still naming it (R-A, the lane mark, the two binding cases; rows M10, M15, M16).
5. **The procedure:** the early sentence of §5b, the take-back after the advance and its re-mark in one sitting, the held-on-a-train-closed-PR stop, and the stop paragraph's second exception, each pinned (Task 3; row M18).

## What this does not claim

- **An entry marked `closed` may have landed.** A train whose record the prover cannot read (an old `ccd`, a malformed block, a member no comment names and no search has indexed yet) is marked `closed` with reason `train-unproven`, and stays `closed` when the proof holds later (section 5). Dependants are freed either way; the history says `closed`.
- **No notice is raised when an entry leaves as `closed`.** The lane counts it; the operator sees it in `ccrc-api landing show --pr <n>`, not in the feed.
- **The run's close is unchanged.** It still needs MERGED, or CLOSED with `landedInTrain: true`, so a run whose train record never proves still waits at `merging` for the operator, as today.
- **The ready mark is a convention.** The take-back is the coordinator's act in the references; nothing in the server or the hook enforces it, and a train can still board a PR in the minutes between the advance and the take-back.
- **The procedure applies to projects opted in to the binding head.** On any other project the coordinator lands in the sitting that marks the PR ready, as today.
- **The tool is not taught anything.** It still boards any ready PR, and this wave does not change what it writes.

---

## Wave 5l — train landings (Tasks 1 to 5, one pull request)

### Task 1: the prover reads the tool's block (D-9111)

**Files:** `ccd/lib/train-proof.sh`, `server/test/ccdPrHelpers.ts`, `server/test/ccd-train-members.test.ts` (new), `docs/superpowers/programs/landing-order/wave5l-task-1.md` (new).

- [ ] **Step 1: claim** the three code files and the note.
- [ ] **Step 2: the helpers.** Add `trainMembers(members: Array<[number, string]>, over?: { extra?: string }): string` and `toolTrainRow(number, mergeOid, members, over?)` to `ccdPrHelpers.ts`, beside `trainBlock` and `trainRow`, writing exactly the measured shape (section "What was measured").
- [ ] **Step 3: red first.** Write P1 to P20 (section 9.1). Run `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-train-members.test.ts`; record in the task note which cases are red on the baseline (expected: P1, P11, P19, P20, and P18's sentence) and which are green already (the refusals, P15, P16, P17).
- [ ] **Step 4: the parser.** In `_pr_train_py`'s `train-check` mode: `train_block` answers `('absent', None)` where it answered `(None, 'carries no ccrc-train v1 block')`, `('bad', why)` for every other refusal with its sentence unchanged, and `('ok', map)`; add `members_block` (section 4.1) and `train_members` (section 4.2); the loop calls `train_members`. Update the file's header ("It is a MOVE and nothing else" now names D-9111's change) and the `THE TRAIN RECORD` comment (both grammars, in at most a few lines; the README holds the prose). Stay inside the 40-line budget (section 4.2).
- [ ] **Step 5: green.** The new file; then each alone: `ccd-pr-state.test.ts`, `ccd-pr-landing.test.ts`, `ccd-ws-audit.test.ts`, `ccd-ws-reap.test.ts`, `pr-sweep.test.ts`, `pr-timeout-budget.test.ts`, `ccd-lib-load.test.ts`, `ccd-ws-add-child.test.ts` (it counts `PR_NUM` spellings: add none), `ccd-harness-integrity.test.ts`, and the growth check (`growth-check.test.ts`).
- [ ] **Step 6: mutation rows** M1 to M9 (section 10), each measured red, then restored; record them in the task note.
- [ ] **Step 7: commit** `fix(train-proof): read the train tool's train-members block beside the documented record (D-9111)`.

### Task 2: the reader takes a train-closed, unproven entry out of the line (D-9112)

**Files:** `server/src/coord/landingEntry.ts`, `server/src/coord/landed.ts`, `server/test/landed-decide.test.ts`, `server/test/landing-land-store.test.ts`, `server/test/landing-journal-store.test.ts`, `server/test/landed-lane.test.ts`, `server/test/landing-control.test.ts`, `docs/superpowers/programs/landing-order/wave5l-task-2.md` (new).

- [ ] **Step 1: claim** the files.
- [ ] **Step 2: red first.** Write R-A to R-F (section 9.2) and the five cases of section 9.3. They are written against the new type, so the typecheck is their first red. After Step 3 alone, R-A, the lane mark case and the store's second detail are red, and green after Step 4. Both binding cases are green on the baseline and stay green: the before case pins the defect's mechanism, and the after case pins the existing order rule this wave relies on (a `closed` entry is neither in the line nor outstanding), which row M15 proves it guards.
- [ ] **Step 3: the type and the detail.** `LandingOutcome` as section 4.4; `decideLandingLand` spreads `reason` into `detail` only when it is not null.
- [ ] **Step 4: the answer.** `landedAnswerOf` as section 4.3, with its comment.
- [ ] **Step 5: the constructors.** The six existing `{ word: 'closed' }` sites take `reason: null`; `ccrc test -- npx tsc --noEmit -p tsconfig.json` and `ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json` name any missed.
- [ ] **Step 6: green.** The five test files above; then `landing-terminal-damage.test.ts`, `landing-next-mail.test.ts`, `landing-line-order.test.ts`, `prstate-pr-line.test.ts`, `brief-landed.test.ts`, and the single-definition suite (`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/single-definition`).
- [ ] **Step 7: mutation rows** M10 to M17.
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

- [ ] **Step 1:** the server typecheck and the test typecheck through `ccrc test`; the full server suite once through `ccrc test` (foreground, `--maxWorkers=2`), re-running any red file alone before calling it a break.
- [ ] **Step 2:** each task note lists its mutation rows as measured (red case named, restored), the files claimed, and what moved since the baseline.
- [ ] **Step 3:** the wave-done mail lists anything here the builder could not keep.

## 10. Mutation table

Each row is one change to the built code, measured red by the named case, then restored.

| id | Mutation | Predicted red |
|---|---|---|
| M1 | `members_block`'s sha check is `[0-9a-fA-F]{7,40}` | P2, P3 |
| M2 | `members_block`'s `pr` check is `isinstance(pr, int)` (a boolean passes) | P4's `true` |
| M3 | `members_block` takes the first opening line and ignores a second | P5 |
| M4 | `train_members` answers v1's map when both read, ignoring the tool's | P12 |
| M5 | `train_members` answers when either block lists the member at its head | P12, P13 |
| M6 | `train-check`'s loop drops the `state != 'MERGED'` test | P16 |
| M7 | `members_block` overwrites a member listed twice (no duplicate check) | P8 |
| M8 | `json.loads` without the `object_pairs_hook` (a key given twice passes) | P7's duplicate key |
| M9 | `train_members` answers `(None, …)` when v1 reads and the tool block is absent | P15 |
| M10 | `landedAnswerOf`'s new arm is removed (today's code: `train-unproven` retries) | R-A; the lane mark case |
| M11 | the new arm tests `read.reason === 'train-unread'` too | R-B; the lane retry case |
| M12 | the new arm drops `read.train === 'unproven'` | R-C |
| M13 | `landedAnswerOf`'s `merged` arm answers `close` with `word: 'closed'` | R-E |
| M14 | `landedAnswerOf`'s `open` arm answers `close` | R-F |
| M15 | `landingOrder`'s line filter is `x.state === 'pinned' \|\| x.state === 'closed'` | the binding-after case |
| M16 | `decideLandingLand` maps a `closed` outcome to state `pinned` (the entry kept) | the lane mark case; the store case |
| M17 | `decideLandingLand` always writes `reason` (as `null` for a plain closed) | the store case's first detail |
| M18 | any one new sentence of section 7 removed from its reference | its pin in `coordinator-skill.test.ts` |

The store case's journal check (the bytes and the cursor unchanged) is a characterization pin with no natural mutation; the builder measures it red by adding a `landing.log` append to the land arm in a scratch copy, then discards the copy.

## Deviations found

Three numbers were issued for this plan on 2026-11-26, and all three are defined below.

- **D-9111 (2026-11-26)** — `train-members-second-grammar`: the train record's one parser (`_pr_train_py`'s `train-check`, `ccd/lib/train-proof.sh`) reads the merge train tool's `train-members` block beside the documented `ccrc-train v1` block.
  - The grammar: exactly one block; one JSON array of at least one member; every member an integer `pr` of the PR grammar (never a boolean) and a full lowercase 40-hex `headSha`; no key given twice; no member listed twice; other keys never read. Anything else proves nothing.
  - Both blocks in one body prove only when both read and list the same members at the same heads; any difference proves nothing. One form alone is read alone, so a hand-added documented block still proves.
  - Legitimately different: the tool is another process, the operator's, outside the tree; both grammars feed the one judge after the one parser.
  - Measured: all 14 train pull requests of this repository write that block and no other; only one carries the documented block, added by hand.
- **D-9112 (2026-11-26)** — `closed-train-unproven-leaves-the-line`: the landed reader answers `close` for the one-PR form's `unmeasured` with reason `train-unproven` and `trainUnproven: true`, and the mark records `"reason":"train-unproven"` in the entry's `detail`; the entry takes the existing word `closed`.
  - Why: GitHub's CLOSED is definitive, so the entry can never be the next to land, and as `pinned` it held the binding's head for good.
  - `train-unread` and every other `unmeasured` answer stay a retry. No new state, journal record or binding rule; the run's close is untouched.
  - Not claimed: an entry so marked may have landed, and stays `closed` when its proof holds later.
- **D-9115 (2026-11-26)** — `ready-mark-waits-for-the-line`: on a project opted in to the binding head, the coordinator reads the landing line with the PR's number, lands only on a `ready` binding for its own run's entry at its head, keeps the PR a draft while it waits (taken back right after the advance to `merging`, marked ready again only on a read whose binding is ready, then the verdict, the checks gate and the landing in one sitting), and on a held binding naming another run's entry whose PR is closed with the train label lands nothing past it, writes no train record and mails that entry's run's coordinator.
  - Why: a merge train boards any ready PR, so a PR left ready while it waits its turn is exposed for as long as it waits (issue #3422's third defect); and a coordinator that read only the line's flags landed past a held head.
  - The ready mark still precedes the advance (D-8999); the probe lists drafts, so a drafted entry still binds. No `SKILL.md` clause changes: clause 15 already defers the ready mark to §4, which now says it.
