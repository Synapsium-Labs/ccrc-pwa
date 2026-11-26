# Wave 185: a tall draft whose box marker is out of view, and the resume Enter

Task note for desktop-polish wave 185 (Goal 90: long and multiline text reaches the transcript intact, as one prompt,
once, with no false confirmation). The operator reported a long paste sent from the console that sat in the session's
input box with no Enter, on Claude Code 2.1.332: about 180 rows, complete in the box, the session idle. Claims are
labelled **measured** (run here), **read** (from the code) or **inferred**. Nothing here is measured on that build: no
capture of its box exists yet (section 6).

## 1. In short

- **What this PR is: a safety repair, not the proof the report asked for.** Reading the readers for the new form found
  a worse fault than the stuck send. The mail lane could press Enter on a person's own unfinished draft and call the mail
  delivered. Two guards close it, and neither presses, clears or types anything new.
- **Guard 1 (any form): the resume presses Enter only on a box read whole and closed.** The prefix-mode resume
  (`resumeIfOwn: true`, the generic mail nudge's) now also needs every row from the marker row down to the box's closing
  rule to equal the composed text up to whitespace, with the closing rule there. This is the reading the whole-box resume
  (`resumeIfOwn: 'whole'`, D-6367) already uses: `renderedAsTyped`.
- **Guard 2 (shape only, grammar unconfirmed): a labelled rule below the last glyph row means the box's marker is out of
  view.** A labelled rule is a row that starts at the first column with three or more rule characters and is not a plain
  rule. When one lies between the last glyph row and the plain rule that closes it, the box reads absent. Every reader
  then says box-unreadable, and nothing is typed, cleared or pressed.
- **The proof for our own tall send (step 2 of the brief) is not here.** It waits for real frames of the new form, which a
  recipe of their own will capture on the test box (wave 187). Section 7 keeps what this wave learned for it.

## 2. How the readers find the box (read)

Every box reader takes the box's marker row to be the LAST row of the capture that starts with the prompt glyph:
`draftOfMeasured`, `draftOf`, `continuationRows` (and through it `boxText`, `hasContentBelowMarker`, `readBoxText`),
`boxRows` (and `renderedAsTyped`, `ownRenderedBox`, `stillContains`), and `stashHeld`. Past user turns above the box start
with the glyph too, drawn on a grey background. A recorded 2.1.332 pane shows them so
(`server/test/fixtures/panes/box/placeholder-error-hint-*.ansi`).

On Claude Code 2.1.300 a box taller than its row cap still draws the glyph on its first row in view
(`cc300-paste-tall-*.txt`), so the last glyph row is the box's. The operator's picture of 2.1.332 shows a box whose top
rule carries a count ("↑ 156 more") and whose first row in view has no glyph. If that is what the build draws, the last
glyph row is the newest past user turn ABOVE the box. At 50 rows, about 30 rows of transcript sit above a 20-row box, so
one is usually on screen.

## 3. What each reader answered for a person's tall draft in that form, before this PR

Measured through the real readers and the real `sendPrompt`, on a SYNTHETIC 220x50 pane built from the picture (a past
user turn, a reply, a count rule, 20 box rows with no glyph, a plain closing rule, a footer). No reader called the box
EMPTY. With no past turn on screen, the marker read answered absent (box-unreadable), which is safe. With one on screen:

| Reader | Answer | Harm |
|---|---|---|
| `draftOfMeasured` / `draftOf` | present, the past turn's text | every caller below describes the wrong text |
| `continuationRows`, `boxText`, `readBoxText` (the park probe) | the past turn, the reply, the count rule (not a plain rule, so the scan runs on), the box rows | a wrong text, never empty |
| `boxRows` | anchored on the past turn, so every proof fails (null) | none: the proofs refuse |
| `clearBox` under `onDraft: 'replace'` | never reads cleared; 24 C-u presses, then `draft-clear-failed` | the operator's Replace shreds rows of a draft the conflict sheet showed as the past turn |
| `stashHeld` | false (no rule directly above the past turn) | none: the stash path stashes the box whole, its restore check cannot match, and it ends `restore-unverified` with no key pressed |
| `submitEnter`'s gate | compares against the past turn's row | reachable only from a refusal that carried that row |
| **the prefix-mode resume** | **the past turn is an earlier generic nudge, so it starts with the nudge's needle, and the one-line nudge has no second row to compare: one Enter, `{"ok":true}`, the nudge never typed** | **the person's unfinished draft is submitted as a turn, and the mail is marked delivered** |

The last row is the hazard. A generic nudge is the commonest past user turn in a fleet session, and mail is delivered
on idle. A person drafting in the box is idle.

The prefix-mode resume carried the same fault in the old form, with the glyph in view: a LONGER draft that starts with
our text was resumed. The send suite pinned that as intended (case 6 in section 5).

## 4. The two guards

**Guard 1** (`sendPrompt`'s `resumeIfOwn === true` arm). It keeps the prefix, the per-delivery second row and the
operator-message marker, and it adds `renderedAsTyped(pane, parts, 'whole') !== null`. It is form-independent: it decides
on the rows below the marker row, which are present in every form. A box that fails it goes on to the next arm, as for any
box the call did not prove. For the mail lane that is the stash arm: the box is stashed whole, the nudge typed and
submitted, and the build restores the draft at submit.

**Guard 2** (`boxMarkerIndex`, the one answer to "which row is the box's marker row" for `draftOfMeasured`, `boxRows`
and `continuationRows`). A labelled rule between the last glyph row and the closing plain rule makes it answer -1, so the
box reads absent.

- **The first column.** It tells the box's own rule from a row of a draft, ours included. That matters for a message that
  carries "─── notes ───" or a table's crossing line, which types, echoes and submits today and must keep doing so.
  Measured on every recorded pane under `server/test/fixtures/panes` (158 files, Claude Code 2.1.220 to 2.1.332):
  - each of the 280 rules starts at the first column;
  - none of the 149 draft rows below a marker row in the 59 input boxes does (the marker row starts with the glyph, every
    row below it is indented, wrapped rows too; the two first-column rows the scan met are a question dialog's footer);
  - no pane carries a labelled rule anywhere.
- **Width.** A rule's width does not separate the two: the box corpus records rules shorter than the pane.
- **The grammar is unconfirmed.** If the real top rule starts with its words, or is indented, the guard does not fire and
  nothing changes: guard 1 still stands under it.
- **A false positive refuses.** A person's own draft whose row starts at the first column with rule characters would read
  unreadable, which is the safe direction. No recorded draft row starts there.
- **`stashHeld` keeps its own scan.** It already needs a plain rule directly above the marker row, which no past turn
  has.

## 5. Existing cases changed (the coordinator's yes, mail 38172)

Five hand-written panes were not real boxes: a bare marker row with no closing rule under it. Each now uses the send
suite's shared box builder, `boxPane` (hoisted unchanged from the whole-box resume group to module scope: a rule above,
the marker row, indented rows, a rule below). The claim, the expected answer and the keys did not move:

1. resumeIfOwn F3 group, "finishes submitting a draft that already matches the caller's own text — no retype, one Enter":
   `'❯ hello world'` and `'❯ '` became `boxPane(['hello world'])` and `EMPTY_BOX`.
2. resumeIfOwn F3 group, "reports enter-ignored, not draft-present, when the resumed own draft still will not submit":
   `'❯ hello world'` became `boxPane(['hello world'])`.
3. per-delivery group, "resumes ITS OWN real envelope — no retype, one Enter": `boxOf(envelopeA)` and `'❯ '` became
   `boxPane(envelopeA.split('\n'))` and `EMPTY_BOX`. `boxOf` itself is unchanged, since the different-envelope refusal
   still uses it.
4. per-delivery group, "resumes envelope B once it is actually B sitting in the box": the same, for envelope B.
5. clearMailResidue group, "resumeIfOwn still takes priority: a stale OWN nudge is resumed (Enter only), never cleared":
   `'❯ ' + nudge` and `'❯ '` became `boxPane([nudge])` and `EMPTY_BOX`.

One claim is reversed, because the old claim was the hazard:

6. whole-box resume group, "the prefix mode is still a different mode: `true` resumes a box that merely starts with our
   text" is now "both modes refuse a longer draft that merely starts with our text: draft-present, no key pressed".

The builder now lives in `server/test/inputBoxPane.ts`, so the mail lane suite can import it. Importing it from the send
suite itself would register that whole suite's cases inside the other file. The send suite imports it from there too,
unchanged. That module holds the builder only.

The mail lane's main suite (`server/test/mail-sweep.test.ts`, the coordinator's yes, mail 38417) drew its box with two
helpers of the same bare shape: `emptyBox` (`'❯ '`) and `echoedBox(text)` (`'❯ ' + text`). Both now draw the closed box
through `boxPane`, and nothing else in their cases moved. The change reaches 26 uses: 10 of `echoedBox`, 16 of
`emptyBox`, `HAPPY_PANES` among them. Under the repair, with the bare helpers, these cases went red, and all pass on
`main`'s `send.ts`:

7. "F3 / bug #21: resumes its OWN unsubmitted nudge rather than self-blocking with draft-present": C-s where Enter is
   pinned.
8. "a stale OWN nudge is resumed regardless of WHICH queued delivery this sweep actually attempts": the same.
9. "an enter-ignored park holding OUR OWN nudge resumes it once per retry": the park's word is `stash-failed` where
   `enter-ignored` is pinned.
10. "rejects at the 24 h ceiling with an explicit reason": the reason names `stash-failed`.
11. "the fallback warns once while it stands, and clears when a resolution succeeds": 2 or 3 warning lines where 1 is
    pinned, because the row is no longer delivered on the first sweep.
12. "a REPLAY (a fresh markDelivered) advances the due-clock past a stale ingestedAt": a third literal send at the
    cooldown step, in one run of two. The scripted panes put a sweep on the bare echoed box, and the stash arm typed again.
13. "puts parkedAt on the wire for the mail strip, and counts live parks on the run board": another `parkedAt`, in one
    run of two.

The park group's own capture answer (`liveHarness`, a third helper of the same bare shape) now draws the closed box
through `boxPane([st.box])` too (the coordinator's yes, mail 38531). Nothing else in the group moved. Its two cases had
gone red under the repair with the bare answer, and both pass on `main`:

14. "an enter-ignored park holding OUR OWN nudge resumes it once per retry — a verified Enter, never a retype, and never
    between retries": the park's reason read `stash-failed` where `enter-ignored` is pinned.
15. "rejects at the 24 h ceiling with an explicit reason": the reason named `stash-failed`.

One search for a fourth such place (measured, by text): none in that suite. Six other suites of the selection answer a
capture with a bare marker row: deliverability parity, the never-blocks lane, delivery characterization, operator-prompt
record, the timer-line lane, and echo-clock. Each passed whole on the repair, so none of their cases reaches the resume
Enter, and none is touched.

Red on `main`'s `send.ts` too, under the same load, and so not the repair's: "the fallback warns once while it stands",
the two warn-latch cases and the boot trace. "puts `parkedAt` on the wire for the mail strip" timed out on both send
modules, so it is unmeasured locally; the exact head's CI decides it.

The bare shape keeps one lane case of its own, new: "wave 185: a nudge on a bare marker row with no closing rule is never
resumed: no Enter, stashed". It pins the keys (C-s only), no literal send, and the word (`stash-failed`).

## 6. The capture, and why nothing here is measured on 2.1.332

The coordinator authorised one route only: the test box's capture lane, through its owner, the Overlord coordinator. The
operator's 2026-11-10 ruling says Claude Code live tests run on the test box, never on the fleet. A capture on this box
would need the operator's exception, which the coordinator has asked for (item 721); until that answer is yes, it is no.

The lane keeps no frames today. The delivery recipe records per case its verdict, the send's own word, the lengths, the
first divergence, the side requests and the hook witness, and nothing of the pane (the capture owner's call 1549). Frames
need a third recipe on the one runner: desktop-polish wave 187 (run 3979), with its own conditions (stand-in model only,
the send's own key sequence, a reducer before any frame enters the repository, a cap per frame). It is days away, not
hours. The frame list this wave needs went to that wave's worker (mail 38145) and is in its plan.

Whether the delivery recipe's 45-line case has run on 2.1.332, and the send's word for it, is owed by the capture owner
once the server carries the status read's delivery standing (merged in #3433).

## 7. Open, and what the next wave needs

- **The proof for our own tall send in the new form**, as the brief's step 2 states it. It decides by shape, never by
  version, and the 2.1.300 proof (D-5088) stays as it is. It keeps the same guards: provenance, the box closes, every chip
  in view and bare, the rows in view equal the tail of what we typed, something in view. It adds the hidden head: the
  count on the rule plus the rows in view must equal the rows our text occupies at the pane's width, and a count larger
  than what we typed means the box is not ours. It needs frames 1 to 3 and 6 of the list. Guard 2 must then be narrowed
  to the real rule's bytes, and the proof reads that same row.
- **The top-rule anchor**, a candidate for that wave on real bytes: "the box's marker row sits directly under a rule".
  It is truer than guard 2 and the recorded panes show it, but dozens of hand-written panes across the send and lane
  suites have no top rule, so it would change many existing claims. `ccd`'s own box reader already uses it
  (`_pane_box_draft`, D-8116: "the last `❯` row directly under a `─` border"). So, read and not measured, `ccd` answers
  `absent` for a person's tall draft in the new form: the past turn above the box is under no border, and the row under
  the labelled top rule carries no glyph. The server's readers and `ccd`'s now disagree on that one question, and that
  wave can align them.
- **The console's words for this box (point b, the coordinator's to rule).** Before this PR, our own tall send answered
  one of two ways:
  - with a past turn on screen: `verify-failed`, its draft being the past turn's text. The console offers Retry and
    Discard, Retry's whole-box resume answers `draft-present`, and the conflict sheet shows the past turn and the
    transcript as the person's draft;
  - with none on screen: `box-unreadable`.

  After guard 2 both answer `box-unreadable`, whose sentence ("clear it in the terminal (Ctrl-C once), then send again")
  is the wrong advice for a person's own unsent text: clearing it throws away what they meant to send. In every case
  the person is left with nothing that sends their text. No console change in this wave.
- **Residual of guard 1.** A stranded nudge whose text differs from today's (another build's wording) is no longer
  resumed. The lane stashes it, delivers and restores it, so it stays in the box. Nothing ever clears it (read):
  `clearMailResidue` matches a paste chip or a mail fence only, and `ownStrandedClear` a `/clear` only. A person clears
  it by hand. That is a line for the coordinator's ledger, not a change here.
- **Residuals of guard 2.** It fires only on a rule that starts at the first column with three or more rule
  characters. A top rule drawn otherwise leaves only guard 1, and the readers again describe the past turn as the draft,
  as before this PR.

## 8. Evidence

- New cases: `server/test/send-tall-box.test.ts`. Its panes named `SYNTHETIC_*` are built in the file and labelled
  synthetic there; the true stranded nudge stands on a recorded 2.1.300 box (`cc300-paste-empty-box.txt`).
- Red first (measured): against `main`'s `send.ts`, 10 of the file's 13 cases at the time failed by name, and the three
  that passed are those that must hold on `main` too (the stranded nudge resumes, a rule with no rule characters at its
  ends does not fire, no recorded pane's reading moves). The two cases of our own rule-like lines, added after, are green
  on `main` by design.
- Mutants (measured): each mutant was applied to `send.ts` in place, `send-tall-box.test.ts` and `send.test.ts` were run,
  and the file was restored and compared byte for byte.

| Mutant | Result | Killed by |
|---|---|---|
| M1: guard 1 removed (the resume's whole-box read) | killed, 4 | the past nudge on one row and wrapped, the longer draft, and the send suite's reversed case 6 |
| M2: guard 2's refusal removed (`boxMarkerIndex` never answers -1 for a labelled rule) | killed, 6 | the box reads absent, the lane presses nothing, Replace's presses, the refusal's draft, the park probe and rescue, the count near the left |
| M3: guard 2 in the first draft's form (trimmed, rule characters at either end) | killed, 3 | an indented rule-like row, and both cases of our own message holding a rule-like line |
| M4: the marker read without `boxMarkerIndex` | killed, 6 | as M2 |
| M5: `continuationRows` without `boxMarkerIndex` | survived | none, and none can be written through the send's entry points: every caller reads `draftOfMeasured` first and stops on absent, so the two scans answer alike at every reachable call. The shared index is there for one definition of the marker row, not as a guard of its own |
| M6: `boxRows` without `boxMarkerIndex` | survived | as M5 |
