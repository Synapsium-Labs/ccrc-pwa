# Landing order, waves 5m and 5n — the corrections carried from the reviews of waves 5k and 5l Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan dispatches nothing itself: each wave is built by a worker the coordinator dispatches.

**Status:** written by the programme's coordinator on 2026-11-27 for run 4011 (programme `landing-order`, the run's wave 33), which builds wave 5m, and for run 4014 (the run's wave 34), which builds wave 5n. Every item is a ruling already made: issue #3466 (the second review of wave 5l, run 3995, and the read of that wave's plan corrections) and the two hardenings the last review of wave 5k (run 3983) left for the next change. One independent read checked this text against the code before it merged; there was no plan review run. **Both waves are built and merged on 2026-11-27: wave 5m as #3477 after two review rounds (runs 4030 and 4038) and one fix round, wave 5n as #3480 after one review round (run 4035). Section 6 says what the builds and their reviews added to this text, and where it and another section or a task disagree, section 6 wins.**

**Goal:** The coordinator's landing reference says exactly what the landed reader does on a train-closed head, and five checks that today pass under a wrong program each gain a case that fails.

**Architecture:** Two waves, two pull requests, no product behaviour changed. Wave 5m adds test cases only: three to the train prover's file and two hardenings to the console's landing-line file. Wave 5n rewords one sentence of one coordinator reference and gives its pin the same sentence. They are apart because the reference and its pin are rules files, and a pull request that changes rules files changes nothing else (the review judge's `rules-mixed`); nothing couples the sentence to the cases.

**Tech Stack:** TypeScript ESM tests (Vitest; jsdom for the console file), bash with embedded python3 as the code under test (`ccd/lib/train-proof.sh`, not edited), Markdown (one coordinator reference). Node >=22.16.0.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.5. The plans these waves correct: `docs/superpowers/plans/2026-11-26-landing-order-wave5l-train-landings.md` (section 13) and `docs/superpowers/plans/2026-11-26-landing-order-wave5k-console.md` (section 12, "Carried, not built"). The case: issue #3466.

**Source baseline:** `origin/main` at `fabd9d399d5fa2efea38de580c0719a6afdedea8`. Every present-tense claim about the code below was read there. A builder whose dispatch base is newer re-reads each cited owner before changing it and says what moved in its note.

## Global Constraints

- **No product code changes in wave 5m.** It edits two test files and adds one note. A mutant is applied in place to the code under test, the named file is run once, and the original bytes are written back and compared by sha256.
- **Wave 5n's pull request holds exactly two files:** the reference and `server/test/coordinator-skill.test.ts`. It adds no note file, because a third file would make the pull request a mixed one. Its mutation rows go in the pull request's body and in the wave-done mail; the coordinator records them in the ledger.
- **Fixture homes only.** The prover cases run in `makePrHarness`'s fixture HOME and read no GitHub.
- **Every test and typecheck runs through `ccrc test -- <command>`,** foreground, one file per process, `--maxWorkers=2`.
- **One push per round,** on the workspace's own branch. Before each push the worker reads its own claims and takes a lapsed one again: a claim has a hard expiry.
- **Deviation numbers are issued, never chosen.** This plan defines none. A departure found while building is named by slug in the wave-done mail, never in a tracked file; the coordinator issues its number.
- **Nothing private** in any file, commit message or pull request text.

## Review Focus

What the cases below still do not exercise, most likely first. Each is left out on purpose and said here so that a reviewer does not take silence for coverage.

1. A key given twice two or more objects deep inside a value that is never read. P43 pins one level; the hook runs at every depth by the JSON reader's own contract.
2. Both blocks bad where the tool block's fault is another one than P41's (a block that never closes, a member twice). The row under test prints the v1 sentence before it looks at which fault the tool block has.
3. `-Infinity` and `Infinity` as a `pr` or a `headSha`. P42 puts them in a key that is never read, which is the case the prose did not promise; as a `pr` they fail the member check as well.
4. The console's focus effect when the removed control was the pause button itself. The control run of Task 2 removes a row's Withdraw button, as the case it sits beside does.
5. The reference sentence as a coordinator would act on it. No test can read prose for truth: the pin holds its words, and the review reads them against `server/src/coord/landed.ts`.

## 1. What is corrected, and where it was ruled

| Item | Ruled in | Wave |
|---|---|---|
| The prover's first row prints the v1 block's sentence when both blocks are bad; no case has both bad | review run 3995, F3; issue #3466, point 2 | 5m |
| `Infinity` in a train-members block refuses the block; no case feeds it | the 5l plan's section 13, B5; issue #3466, point 3 | 5m |
| A key given twice inside the value of a key that is never read refuses the block; no case feeds it | the same | 5m |
| The unmount cases' door is a bare function; the cases never assert that it was called | review run 3983, F2a | 5m |
| The focus case passes when the block never recorded the control | review run 3983, F2b | 5m |
| Two loose phrases in the landing-line paragraph's sentence on the re-read | review run 3995, F1 and F2; issue #3466, point 1 | 5n |

## 2. File responsibilities

| File | Wave | Change |
|---|---|---|
| `server/test/ccd-train-members.test.ts` | 5m | three cases, P41 to P43 |
| `pwa/test/landing-line.test.tsx` | 5m | the two unmount cases' door becomes a spy; one control case beside the focus case |
| `docs/superpowers/programs/landing-order/wave5m-carried-corrections.md` | 5m | the note: the cases, the mutation rows, the commands, the hashes |
| `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | 5n | one sentence |
| `server/test/coordinator-skill.test.ts` | 5n | the same sentence in the line pin |

No other file changes. `ccd/lib/train-proof.sh`, `pwa/src/fleet/LandingLine.tsx` and `pwa/src/fleet/LandingWithdrawSheet.tsx` are read and mutated in place, never committed changed.

## 3. The sentence (wave 5n)

In `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`, the landing-line paragraph has a sentence that begins "The reader takes such an entry out of the line by itself". It is replaced, to its full stop, with this text, wrapped as the file wraps its prose, and the line pin (`LINE` in `server/test/coordinator-skill.test.ts`) takes the same sentence in the old one's place:

> The reader marks such an entry by itself once it reads the train's record, landed when the record proves and, unless the entry is damaged, closed when it does not, so set a timer and read the line again after 20 minutes, which covers the reader's longest retry step plus one beat of its lane; if the same head still holds (a record the reader cannot read is asked again, and so is a damaged entry whose record does not prove; both stay in the line until a later read settles them), mail the coordinator of that entry's run (`toId: 'coordinator'` with its `runId`) what you read, or, for an entry with no run, put it to the operator as an item.

Why each clause, read in `server/src/coord/landed.ts#landedAnswerOf` and `server/src/coord/landed.ts#landedNext`:

- **"marks such an entry by itself once it reads the train's record, landed when the record proves and, unless the entry is damaged, closed when it does not".** A `merged` read answers `land`, for a repair candidate too; an `unmeasured` read with reason `train-unproven` and the train flag `unproven` answers `close` only for an entry that is not a repair candidate, which the paragraph calls a damaged entry. The shipped sentence named only the close.
- **"so set a timer and read the line again after 20 minutes".** The shipped "with a timer as the wake" stood after the 20 minutes; behind the new relative clause it would read as part of it, so the timer comes first.
- **"20 minutes, which covers the reader's longest retry step plus one beat of its lane".** The retry step doubles from the lane's beat to `PR_BACKOFF_MAX_MS`, and a due entry is read at the lane's next beat, `PR_SWEEP_MS` (`server/src/laneSchedule.ts`). Today that is 15 minutes plus 2. The sentence names no number but the 20 a coordinator acts on, so a changed constant does not make it false while the sum stays under 20. Two longer waits are not this paragraph's answer and the 20 minutes do not cover them: a second `missing-field` answer in a row waits 60 minutes (`LANDED_STANDING_BACKOFF_MS`), and a pass reads at most ten entries (`LANDED_READS_PER_SWEEP`), so a longer line can put a read a beat later.
- **"a record the reader cannot read is asked again, and so is a damaged entry whose record does not prove".** `train-unread`, every other `unmeasured` answer and a failed call answer `retry`. A repair candidate (`repairToken` set) answers `retry` on `train-unproven`; on a `merged` read it lands like any other entry, which is why the clause says "whose record does not prove".
- **"both stay in the line until a later read settles them".** Replaces "never taken out": a later read that proves lands the entry, one that reads and does not prove closes an entry that is not a repair candidate, and a repair candidate is retired on a fresh `merged`, `closed` or `absent` reading.

No other sentence of any reference changes, and no `SKILL.md` clause changes.

## 4. The cases (wave 5m)

### 4.1 The prover (`server/test/ccd-train-members.test.ts`)

Each case asserts the whole line `train-check` prints, with the file's own helpers (`check`, `toolTrainRow`, `rawTrainMembers`, `trainMembers`, `trainBlock`, `W`, `NOT_ARRAY`, `PROVED`). Member `#42` at head `H`, train `#50`, as in the file.

| id | Body | Expected line |
|---|---|---|
| P41 | a doubled v1 block (`trainBlock([[42, H]])` twice) beside a tool block whose content is `[]` | `W('carries 2 ccrc-train v1 blocks, not one')`: both blocks are bad, and the v1 block's sentence is the one printed |
| P42 | a tool block `[{"pr": 42, "headSha": "<H>", "blast": Infinity}]`; then the same with `-Infinity` (one body each) | `NOT_ARRAY`, each |
| P43 | a tool block `[{"pr": 42, "headSha": "<H>", "blast": {"a": 1, "a": 2}}]` | `NOT_ARRAY` |

Beside P43, in the same case or the one before it, the control that makes it mean something: the same body with `"blast": {"a": 1, "b": 2}` answers `PROVED`, so the refusal is the doubled key's and not the nested object's.

Fix round 1 gave P43 a third body, `"blast": {"a": 1, "a": 1}`, a key given twice with equal values, with the same `NOT_ARRAY` (section 6, C2).

### 4.2 The console (`pwa/test/landing-line.test.tsx`)

- **The unmount cases (review 3983, F2a).** In the `it.each` titled "the line unmounted before the door's %s lands: no re-read", the door `() => d.promise` becomes `vi.fn<LandingWithdrawer>(() => d.promise)`, and the case asserts `toHaveBeenCalledTimes(1)` on it after `confirm104()` and before `unmount()`. Nothing else in the case changes.
- **The focus case's control (review 3983, F2b).** Beside the case titled "focus on another element while the block still holds its record", one new case runs the same steps up to the focus event on `#104`'s Withdraw button, then puts the page's focus on the body (`elsewhere.blur()`), asserts that `document.activeElement` is `document.body`, re-renders without row `#104`, flushes, and expects the pause button to hold focus. It shows that the block took its record from that focus event: with no record the effect returns early and focus stays on the body.
- **The control's other half (fix round 1; section 6, C1).** One more case beside the control, titled "the page's focus on the body and no control recorded: a read that removes a row moves no focus". It puts the page's focus on the body with no focus event on any control of the block, asserts that `document.activeElement` is `document.body`, re-renders without row `#104`, flushes, and expects focus still on the body. The control shows that the block's record is enough to move focus; this case shows that it is needed.

## 5. Mutation table

Each row is one change to the code under test, measured red by the named case, then restored. The builder records the red assertion and the restored file's sha256 in the note (5m) or in the pull request's body (5n).

| id | Mutation | File mutated | Predicted red |
|---|---|---|---|
| X-bothbad | `train_members`'s first row prints `(tm if tk == 'bad' else v)` | `ccd/lib/train-proof.sh` | P41 alone (in P39, P40 and P14 only one block is bad, and both programs print the same sentence) |
| X-infinity | `members_block` passes `parse_constant=lambda c: refuse(c) if c == 'NaN' else float(c)`; `refuse` itself is not edited, since the pairs hook calls it too | `ccd/lib/train-proof.sh` | P42, both bodies; P7's `NaN` stays green |
| X-nestedkey | the pairs hook refuses a doubled key only in an object that has a `pr` key | `ccd/lib/train-proof.sh` | P43; P7's doubled `pr` stays green |
| X-door | the sheet's confirm returns before it calls its door | `pwa/src/fleet/LandingWithdrawSheet.tsx` | both unmount cases, on the new call-count line, and every other case that confirms a withdrawal; the note lists them |
| FR8 | (wave 5k's row, measured again) the wrapper's generation check removed | `pwa/src/fleet/LandingLine.tsx` | both unmount cases, on `onReload` |
| NOREC | the section's `onFocus` record removed | `pwa/src/fleet/LandingLine.tsx` | the new control case (review 3983 measured the case beside it green under this mutant); measured: four cases (section 6, C3) |
| M-noheld | (fix round 1) the focus effect no longer returns early when no control is recorded: its guard reads `sheet !== null \|\| (held !== null && held.isConnected)`, which does not throw | `pwa/src/fleet/LandingLine.tsx` | the fix round's case alone |
| M-samevalue | (fix round 1) the pairs hook accepts an object in which a key and its value repeat exactly | `ccd/lib/train-proof.sh` | P43, on its equal-values line, and P7's doubled `pr`, whose two values are equal |
| S-1 | (5n) the new sentence loses "landed when the record proves and, unless the entry is damaged, closed when it does not" | the reference | the line pin |
| S-2 | (5n) ", which covers the reader's longest retry step plus one beat of its lane" becomes ", the reader's longest retry step and one beat of its lane" | the reference | the line pin |
| S-3 | (5n) the parenthesis back to the shipped one ("are asked again and never taken out") | the reference | the line pin |

A row that comes out redder or greener than predicted is reported as measured, with the reason, never adjusted to fit.

## Wave 5m — the cases (Tasks 1 to 3, one pull request, run 4011)

### Task 1: the three prover cases

**Files:** Test: `server/test/ccd-train-members.test.ts`.

- [ ] **Step 1:** claim the file. Add P41, P42 and P43 with P43's control, as section 4.1, after P40, and extend the file's header comment to say where they come from (this plan).
- [ ] **Step 2:** run the file alone. Expected: every case green, since the prover already behaves so (these are characterization cases). A red here is a finding about the prover: stop and mail the coordinator what the case printed.
- [ ] **Step 3:** measure rows X-bothbad, X-infinity and X-nestedkey, one at a time, restoring by sha256.
- [ ] **Step 4:** commit.

### Task 2: the two console hardenings

**Files:** Test: `pwa/test/landing-line.test.tsx`.

- [ ] **Step 1:** claim the file. Make the two changes of section 4.2.
- [ ] **Step 2:** run the file alone. Expected: green.
- [ ] **Step 3:** measure rows X-door, FR8 and NOREC, one at a time, restoring by sha256. Under NOREC, say which other cases go red too.
- [ ] **Step 4:** commit.

### Task 3: the note and the gate

**Files:** Create: `docs/superpowers/programs/landing-order/wave5m-carried-corrections.md`.

- [ ] **Step 1:** write the note: each case, each row with its command, red assertion and restored sha256, the suites run and their counts.
- [ ] **Step 2:** run alone: the two test files; the pwa typecheck once (it has been killed for memory in the local slice: say what happened); `anchors`, `citations` and `deviation-refs` from `server/`.
- [ ] **Step 3:** check mail, probe the merge against `main`, push once, wait for the pull request's run on that exact head, and send the wave-done.

## Wave 5n — the sentence (Tasks 4 and 5, one pull request, run 4014)

### Task 4: the reference and its pin

**Files:** Modify: `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`. Test: `server/test/coordinator-skill.test.ts`.

- [ ] **Step 1:** claim both files. Give the line pin the sentence of section 3 in the old one's place, and run `coordinator-skill` alone. Expected: red on the line pin only.
- [ ] **Step 2:** replace the sentence in the reference, wrapped as the file wraps its prose. Run the file again. Expected: green, 290 cases.
- [ ] **Step 3:** measure rows S-1 to S-3, restoring by sha256.
- [ ] **Step 4:** commit. The pull request holds these two files and nothing else.

### Task 5: the gate

- [ ] **Step 1:** run alone from `server/`, one file per process: `coordinator-skill`, `coordinator-landing-verdict`, `coordinator-skill-autonomy`, `coordinator-approval-prompts` and `ccrc-api-closed`, which all read this reference's text, then `anchors` and `citations`.
- [ ] **Step 2:** check mail, probe the merge against `main`, push once, write the pull request's body with the three rows as measured, wait for its run on that exact head, and send the wave-done with the rows in the mail.

## 6. As built (runs 4011 and 4014)

Both waves are merged. This section says what the builds and their reviews added to the text above. **Where it and another section or a task disagree, this section wins.** Each point that changes this plan's text is also edited in place.

### 6.1 Wave 5m

Run 4011 (the run's wave 33), pull request #3477, merged on 2026-11-27 as `d417f0859f94dc129820f92050d587ab0e1b9dd4` at head `29b5aec92ac6d4e42dd9028d2acec2325d7980a5`: three files, the two test files and the builder's note, `docs/superpowers/programs/landing-order/wave5m-carried-corrections.md`. Two review rounds and one fix round. Review run 4030 read `13021c23ae84c8771f87b4de1f45b4f7393c30ac` and found nothing critical or important and four minor points (ruled in call 1670). Review run 4038 read the head that merged and found no wrong assertion, no change outside the rulings, and two loose phrases in the note (ruled in call 1678).

- **C1, the control's other half (review 4030, F3).** The control case of section 4.2 shows that the block's record is enough for the focus move. Nothing showed that it is needed: with the focus effect's early return for "no control recorded" taken away, all 28 cases stayed green, and in the product that change would move focus onto the pause button, or onto the card, on a read while no sheet is open and the page's focus is on the body. Fix round 1 added the case of section 4.2's third point and row M-noheld. Measured: that case alone is red (expected the body, received the pause button), 1 failed and 28 passed.
- **C2, P43's third body (review 4030, F4).** P43 pinned a key given twice with two different values, so a hook that refused only differing values passed P43. Fix round 1 added the body `{"a": 1, "a": 1}` with the same refusal, and row M-samevalue. The builder wrote its own mutant, which differs from the reviewer's: the pairs hook accepts an object in which a key and its value repeat exactly. Measured: P43 is red on the new line, and P7 is red too, because P7's doubled `pr` has two equal values; 2 failed and 50 passed. That mutant accepts every object in which at least one key-and-value pair repeats exactly, whatever else the object holds; no case feeds an object that has both a repeated pair and a key given twice with different values.
- **C3, NOREC is redder than section 5 said.** Section 5 named one red case, the control. Measured: four. The three others (Cancel in flight, Resume on a line with no entries then an empty read, and a blur to nowhere) each expect focus to move from a removed control to the pause button or the card, and that needs the block's record. The focus case beside the control stays green, as review 3983 measured. 4 failed and 24 passed, before the fix round's case.
- **C4, X-door's other cases.** Besides the two unmount cases, nine cases confirm a withdrawal and go red under X-door; the builder's note lists them. 11 failed and 17 passed, before the fix round's case.
- **C5, counts.** The prover's test file has 52 cases (48 before the wave). The console's landing-line file has 29 (27 before the wave: the control, then the fix round's case).
- **C6, two phrases of the builder's note are loose (review 4038).** The first sentence of the note's fix-round section says "Two cases, two rows, two sentences": the round added one case (C1) and one body in an existing case (C2). That phrase was the coordinator's, in the fix-round mail. The note's row M-samevalue begins "the pairs hook refuses a doubled key only when its values differ"; C2 says what the mutant does. Both are loose, neither is a wrong assertion, and the note stays as it merged.

### 6.2 Wave 5n

Run 4014 (the run's wave 34), pull request #3480, merged on 2026-11-27 as `97dd3d303b446588fb5cece4846b70d1473c85eb` at head `d0a5923c8df9b1a399201699a606ddcdc0f0e412`: one commit, the two files of section 2. One review round and no fix round. Review run 4035 found the sentence equal to section 3's word for word, in the reference and in the pin, each clause true of the reader as it stands, and one advisory point (ruled in call 1680).

- **C7, the rows, as measured.** The wave has no note file, so its rows are recorded here, from the pull request's body and the wave-done mail; review 4035 measured each again. The Global Constraints say the coordinator records them in the ledger: they are here, and the ledger's entry points at this section. Rows S-1 to S-3 were each applied in place to the reference, the pin's file run once, and the reference written back; after every restore its sha256 was `a9f4f84493eb517a3c0477bde65ef69462a424bcf62060ea92ac87f242eea43e`, the committed one.

  | Row | Measured |
  |---|---|
  | red first (the pin changed, the reference not yet) | the line pin alone: 1 failed, 289 passed |
  | S-1 | the line pin alone: 1 failed, 289 passed |
  | S-2 | the line pin alone: 1 failed, 289 passed |
  | S-3 | the line pin alone: 1 failed, 289 passed |

- **C8, what the pin catches (review 4035).** The pin compares the whole paragraph, so a changed word anywhere in it turns the pin red. The review measured three such changes of its own: the number 20 changed to 25, a word changed in a neighbouring sentence, and "an item" changed to "a question" in the last clause. The pin is blind to a pure re-wrap: the same words broken across lines elsewhere pass, because the suite compares prose with its white space flattened. So the wrap is checked by review and not by the pin.
- **C9, the gate's files.** The seven files of Task 5 passed: `coordinator-skill` 290, `coordinator-landing-verdict` 762, `coordinator-skill-autonomy` 32, `coordinator-approval-prompts` 10, `ccrc-api-closed` 52, `anchors` 9 and `citations` 4. The pull request's fast run did not run `coordinator-approval-prompts`; the builder's and the reviewer's local runs measured it, and the merge queue runs the whole suite. Review 4035 found ten more test files that read this reference and ran them green; no test quotes the old sentence.
- **C10, the 20 minutes, measured against the constants.** The retry step doubles from 2 minutes to 4, to 8, and is then capped at 15 (`PR_BACKOFF_MAX_MS`); a due entry is read at the lane's next beat, at most 2 minutes later (`PR_SWEEP_MS`). That is 17 minutes, under the 20 the sentence names. The two longer waits that section 3 names stay outside the sentence: when the same head still holds at 20 minutes, the instruction is a mail or an item, which is a true report of a held head.
- **C11, carried: the word "damaged" (review 4035, F1; issue #3552).** The sentence uses "damaged" twice as the word a decision turns on, and no file of the coordinator skill says what a damaged entry is. In the code it is a terminal-repair candidate (`repairToken` set; `server/src/coord/landed.ts#landedAnswerOf`). The word was in the shipped sentence before this wave, and a coordinator acts the same for both kinds of entry, so no wrong action follows. A gloss on first use is a later wording change, with its pin, in a pull request of its own. No wave is planned for it.

## What this does not claim

- It does not change what the prover refuses, what the reader marks or what the console does. A case that cannot be made green without a product change is a finding to mail, not a change to make.
- It does not itself correct the 5l plan's section 7.2, which quoted the sentence as it shipped with wave 5l; the coordinator recorded the new sentence there, on the ledger's pull request, after wave 5n merged.
- It does not pin the reference's sentence to the constants it describes. The pin holds words.

## Deviations found

None is defined by this plan. A departure found while building takes a number the coordinator issues. In wave 5m its definition here is the one edit allowed outside section 2's files, on the builder's branch, with a `Ledger-Edit:` trailer on the head commit. In wave 5n the coordinator defines it on the ledger's pull request, so that wave's pull request keeps its two files.
