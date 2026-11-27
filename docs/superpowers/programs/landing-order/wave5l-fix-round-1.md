# Wave 5l, fix round 1: review 3963's seven findings

Run 3942, programme `landing-order`, wave 32. Review run 3963 read the tip `715da8ee9d`. It reported no critical or
important finding and seven minor ones. The coordinator ruled on them in call 1600, and this round keeps every ruling.

## Claims

Claim 7333 reached its hard cap during the review. Claim 7426 (run 3942) now holds this round's files: the prover's
test file, `landed-lane.test.ts`, `wave-lifecycle-5b-landing.md`, `coordinator-skill.test.ts`, the Task 1 and Task 2
notes and this note. Claim 7348 still holds the plan, which this round does not edit.

## What changed, by finding

- **F1, the v1 half of `train_members`'s first row.** Two new cases in `server/test/ccd-train-members.test.ts` each
  assert their whole line:
  - P39: a doubled v1 block beside a proving tool block answers `!train #50 carries 2 ccrc-train v1 blocks, not one`.
  - P40: a v1 block with a line that is not a member line, and no tool block, answers `!train #50 has a ccrc-train v1
    block with a line that is not a member line`.

  Before this round, nothing in the tree pinned a v1 refusal sentence. Row X-v1bad is below.
- **F2, the lane's mark case.** The case in `server/test/landed-lane.test.ts` now runs a first pass that answers
  `train-unread` (a retry). It asserts that this pass wrote the entry's memory, moves the clock one doubled step, and
  only then marks the entry. "The memory is gone" can now fail. Row X-memory is below.
- **F3, the journal bytes check.** I ran the reviewer's mutant once (row X-journal) and recorded it beside MJ in the
  Task 2 note, whose prose no longer calls the bytes check a characterization pin only. The stand-in MJ stays as it was.
- **F4, one reference sentence.** In `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`, the sentence
  beginning "The reader takes such an entry out of the line by itself" is replaced, to its full stop, by the
  coordinator's text. The paragraph is wrapped as the file wraps it, at 80 columns or less. The line pin in
  `server/test/coordinator-skill.test.ts` takes the same sentence. The plan's section 7.2 still carries the old
  sentence, and correcting it is the coordinator's job on the ledger pull request, so the plan is not edited here.
  Rows M18-F4a to M18-F4c below re-measure row M18's part for this sentence.
- **F5, two counts.**
  - The Task 1 note now says that two python comment lines name D-9111: the edited opening of the train-record comment
    and `train_members`'s header. Two bash comment lines name it too: the file header and `_ws_train_record`'s header.
  - The pull request's body and the Task 1 note now say what the growth check counts. `growthCheck.ts#codeLines`
    counts bash code lines plus every non-blank heredoc line. It measures +32 net against `ad52d25f4b`, 343 to 375,
    under the limit of 40. The diff itself is +62 and -25 lines with blank and comment lines included, which is the
    count the reviewer read.
- **F6 and F7: accepted as they are,** with no change.
- **The judge's `rules-mixed`:** no split, as ruled.

## Mutation rows

Each row ran through `ccrc test` with the in-place driver: the mutant applied, the named file run once (vitest,
`--maxWorkers=2`), the original bytes written back, and their sha256 checked against the committed file. The test box
ran the driver locally (`ccrc test` answered `python3 runs locally`). No mutant survived.

| id | Mutation | File | Run | Red cases (measured) | Restored sha256 |
|---|---|---|---|---|---|
| X-v1bad | (F1; the reviewer's mutant) `train_members`'s first row reduced to the tool block's half: `if tk == 'bad': return None, tm, None` | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P39: a doubled v1 block beside a proving tool block proves nothing, with the v1 sentence; P40: a v1 block with a line that is not a member line, and no tool block, proves nothing, with the v1 sentence | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| X-memory | (F2; the reviewer's mutant) `landedPass` drops `deps.memory.delete(cand.id)` after a mark | `server/src/coord/landedLane.ts` | landed-lane.test.ts | train-unproven marks the entry closed, counts it, drops its memory and raises no merged record | `6296a0a2221254bc5105a517063d334a2e02ebfd22f84e72cb45da43bd962f2f` |
| X-journal | (F3; the reviewer's mutant) the land arm appends one raw line to `landing.log` right after its `UPDATE` | `server/src/coord/store.ts` | landing-land-store.test.ts | a plain closed and a train-unproven closed both mark closed; only the second detail names the reason | `d09b81c2d68d18f560114a00b928850586c7dd36e4fe0b987ed023ba20c7b2f6` |
| M18-F4a | (F4) the new sentence loses "once it reads the train's record and the record does not prove" | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | coordinator-skill.test.ts | pins the whole landing-line paragraph, between the boundary paragraph and the admin-merge door paragraph (the line pin) | `55a4bc617b5ba7764e62be1889c2fdb11410839f51bee08659d600b901b5c547` |
| M18-F4b | (F4) the new sentence loses its parenthesis about a record the reader cannot read and a damaged entry | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | coordinator-skill.test.ts | the line pin, as above | `55a4bc617b5ba7764e62be1889c2fdb11410839f51bee08659d600b901b5c547` |
| M18-F4c | (F4) "the reader's longest retry step" back to "the reader's longest back-off" | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | coordinator-skill.test.ts | the line pin, as above | `55a4bc617b5ba7764e62be1889c2fdb11410839f51bee08659d600b901b5c547` |

Each mutant failed only the case or cases named in its row: X-v1bad 2 of 48, X-memory 1 of 47, X-journal 1 of 65, and
each M18-F4 row 1 of 290.

## Suites run (each file alone, through `ccrc test`, after the edits)

| File | Result |
|---|---|
| `ccd-train-members` | 48 passed (46 plus P39 and P40) |
| `landed-lane` | 47 passed |
| `coordinator-skill` | 290 passed |
| `landing-land-store` | 65 passed |

These ran on the same bytes as this round's commit: the mutants touched only the source and reference files, and each
one was restored to its committed sha256.
