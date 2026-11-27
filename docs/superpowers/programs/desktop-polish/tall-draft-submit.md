# Wave 185: a tall draft whose box marker is out of view, and the resume Enter

Task note for desktop-polish wave 185 (Goal 90: long and multiline text reaches the transcript intact, as one prompt,
once, with no false confirmation). The operator reported a long paste sent from the console that sat in the session's
input box with no Enter, on Claude Code 2.1.332: about 180 rows, complete in the box, the session idle. Claims are
labelled **measured** (run here), **read** (from the code) or **inferred**. Nothing here is measured on that build: no
capture of its box exists yet (section 6).

## 1. In short

- **What this PR is: a stated partial repair, not the proof the report asked for.** Reading the readers for the new form
  found a worse fault than the stuck send. The mail lane could press Enter on a person's own unfinished draft and call
  the mail delivered. Two guards close it in the shapes they read and not in others (section 8, "What this does not
  close", all five on issue #3482). In no pane the two reviews built does the head submit a draft that `main` does not
  submit, so none is a regression. The keys do differ: where guard 1 refuses a resume `main` made, the lane goes on to
  its stash arm and presses the stash key, in some forms the typed nudge and a second Enter too, where `main` pressed
  Enter. On the review's pane (a past nudge, a reply, a plain top rule, a tall draft, static captures) the head presses
  `C-s` and answers `stash-failed`, and `main` presses Enter twice.
- **Guard 1: the resume's Enter is pressed only where the rows from the last glyph row down to the first plain rule are
  our text.** The prefix-mode resume (`resumeIfOwn: true`, the generic mail nudge's) now also needs those rows to equal
  the composed text up to whitespace, with that rule there. This is the reading the whole-box resume
  (`resumeIfOwn: 'whole'`, D-6367) already uses: `renderedAsTyped`. Where the box's marker row is in view, that rule is
  the box's closing rule, unless a row of the person's below our text is itself eight or more rule characters, at any
  indent: that row reads as the closing rule, and the read passes ((e) in section 8). Where the marker row is out of view
  and only blank rows lie between a past turn of our text and a plain top rule, that top rule is the first plain rule,
  and the read passes: (a) in section 8.
- **Guard 2 (shape only, grammar unconfirmed): a labelled rule below the last glyph row means the box's marker is out of
  view.** A labelled rule is a row that starts at the first column with three or more rule characters and is not a plain
  rule. When one lies between the last glyph row and the first plain rule below it, the box reads absent. Every reader
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
| `stashHeld` | false (no rule directly above the past turn) | the stash path stashes the box whole and types and submits our text; its restore check cannot match the restored draft, so it presses a second Enter, which can submit that draft (section 8, (b); measured by the review on a model that follows the keys) |
| `submitEnter`'s gate | compares against the past turn's row | reachable only from a refusal that carried that row |
| **the prefix-mode resume** | **the past turn is an earlier generic nudge, so it starts with the nudge's needle, and the one-line nudge has no second row to compare: one Enter, `{"ok":true}`, the nudge never typed** | **the person's unfinished draft is submitted as a turn, and the mail is marked delivered** |

The last row is the hazard. A generic nudge is the commonest past user turn in a fleet session, and mail is delivered
on idle. A person drafting in the box is idle.

The prefix-mode resume carried the same fault in the old form, with the glyph in view: a LONGER draft that starts with
our text was resumed. The send suite pinned that as intended (case 6 in section 5).

## 4. The two guards

**Guard 1** (`sendPrompt`'s `resumeIfOwn === true` arm). It keeps the prefix, the per-delivery second row and the
operator-message marker, and it adds `renderedAsTyped(pane, parts, 'whole') !== null`. That read takes the rows from the
last glyph row down to the first plain rule below it, and passes only when they equal our text up to whitespace and that
rule is there. It closes the resume Enter where a non-blank row that is not our text lies below the last glyph row (a
reply, a longer draft, a second row of the person's), and where no rule follows, except where that row of the person's
is itself eight or more rule characters, at any indent (`isRuleRow` trims): the read stops at it as at the closing rule,
sees only our text, and passes ((e) in section 8). It does not close it either where the last glyph row is a past turn
of our text and only blank rows lie between it and a plain top rule: (a) in section 8. A box that
fails it goes on to the next arm, as for any box the call did not prove. For the mail lane that is the stash arm: the box
is stashed whole, the nudge typed and submitted, and the build restores the draft at submit. In a box whose marker row is
out of view that arm can press a second Enter, which submits the restored draft, depending on the row drawn after our
turn: (b) in section 8.

**Guard 2** (`boxMarkerIndex`, the one answer to "which row is the box's marker row" for `draftOfMeasured`, `boxRows`
and `continuationRows`). A labelled rule between the last glyph row and the first plain rule below it makes it answer -1,
so the box reads absent. That first plain rule is the box's closing rule in every recorded pane, but not necessarily in
every pane: (d) in section 8.

- **The first column.** It tells the box's own rule from a row of a draft, ours included. That matters for a message that
  carries "─── notes ───" or a table's crossing line, which types, echoes and submits today and must keep doing so.
  Measured on the recorded panes under `server/test/fixtures/panes` (160 files: 158 pane files, `.txt` and `.ansi`, Claude
  Code 2.1.220 to 2.1.332, and two verdict lists), reading each row with its SGR sequences removed:
  - a plain rule is a row that is, trimmed, at least 8 characters, all of them rule characters or spaces (`isRuleRow`).
    There are 280, and every one starts at the first column;
  - a labelled rule is a row that starts at the first column with three or more rule characters and is not a plain rule.
    There are none;
  - an input box is a row that starts at the first column with the glyph, whose row directly above is a plain rule, and
    below which a plain rule comes before any other glyph row; its draft rows are the rows strictly between. There are
    61 boxes holding 124 draft rows, and none of those rows starts at the first column or holds a run of rule characters.
    (Round 1 of this note gave 59 boxes and 149 rows from a scan whose rule it did not state; the review could not
    reproduce them, and these replace them. The review's own counts by this rule are the same: 61 and 124. The
    sender's comment beside guard 2 carried the old figures too, and fix round 2 corrected that comment alone.)
- **Width.** A rule's width does not separate the two: recorded rules are shorter than their pane too (the review counts
  17 of the 280).
- **The condition, and why the guard stays (the coordinator's ruling, mail 38899).** The condition was that the guard
  tell the box's rule from a row of a draft or of our own message, by where the row starts and how wide it is, on
  recorded panes, with green cases for our own messages that hold a rule-like line. It is not met to the letter: only
  the first column is used, width is not; the two own-message cases run on a hand-built box (`followingBox`), not a
  recorded pane; and no recorded pane holds the guard's positive case, which rests on the operator's picture and a
  synthetic pane. It stays because it fires on none of the 160 recorded files, it fails toward "unreadable" with no key
  pressed, it is the only guard for the shape in the operator's picture, and in that shape it also keeps the stash arm
  from pressing anything.
- **The grammar is unconfirmed.** If the real top rule starts with its words, or is indented, the guard does not fire,
  the readers again describe the past turn as the draft, and what is left is guard 1, which does not cover (a) to (c) or
  (e) in section 8.
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

That search missed one place, because it looked for the sweep's helpers by name. The wave brief suite
(`server/test/brief-landed.test.ts`) carries its own copy of the sweep's `liveHarness` (its comment says it is copied,
not imported), and its capture answered the same bare marker row. The exact head's first fast run found it red (shard
`server 4/12`), and so did a run of the file alone on the repair; it passes whole on `main`'s `send.ts`. Its capture now
draws the closed box through `boxPane([st.box])` too (the coordinator's yes, mail 38742): one use, and no claim, expected
answer or key in the file moved. The case that had gone red:

16. "an enter-ignored brief on a fresh worker is retried at 5 minutes through the park and lands, our nudge never
    re-typed": the delivery stayed `queued` where `delivered` is pinned.
Only that case is red under the repair. In the same run here a second case, "a restart over the same coord.db repeats
neither the retry nor the notice", timed out at 20 s: that was load, not the repair. It seeds a person's line in the box
and never reaches the resume, and the review ran the file against the repair's sender twice with only case 16 red (11 of
12).

A wider search after it, by text, for every capture in the test tree that answers a bare marker row, found five suites,
one of them already among the six above. Each passes whole on the repair, alone, and none is touched: clip-any-file (36
cases), run-work-started (9), idle-compact-nudge-lane (46), feed-writers-pin (61) and send-echo-clock (17, the echo-clock
suite of the six). Two text searches do not make a census, so no total is claimed. The suites known to draw the old
bare shape still (files under `server/test/`, each green on the repair):
- the first search's six: `deliverability-parity`, `lane-draft-never-blocks`, `mail-delivery-characterization`,
  `overlord-prompt-record`, `overlord-timer-line-lane` and `send-echo-clock`;
- the wider search's four more: `clip-any-file`, `run-work-started`, `idle-compact-nudge-lane` and `feed-writers-pin`;
- the review's (round 2): `routes` (through the prompt route to the sender), `submit-route` (through `submitEnter`) and
  the send suite's own bare literals;
- a third search in fix round 2, for a capture answered with a bare marker row in any spelling: `ccd-route-apply` (123
  cases, run alone here), `push-outbox-characterization`, `roll-sweep-handoff`, `stall-sweep` and `worker-seen` (each
  green in the exact head's fast run, as were `routes` and `submit-route`).

Red on `main`'s `send.ts` too, under the same load, and so not the repair's: "the fallback warns once while it stands",
the two warn-latch cases and the boot trace. "puts `parkedAt` on the wire for the mail strip" timed out on both send
modules, so it is unmeasured locally; the exact head's CI decides it.

The bare shape keeps one lane case of its own, new: "wave 185: a nudge on a bare marker row with no closing rule is never
resumed: no Enter, stashed". It pins the keys (C-s only), no literal send, and the word (`stash-failed`).

### The prompt-glyph guard, red in the merge queue (the coordinator's ruling, mail 39342)

The merge queue ran this PR on `main` cced5ae878 and one case went red: `pane-prompt-glyph.test.ts`, "reads the prompt
glyph through the pane export at each of its four sites" (`draftOfMeasured: expected [ 'split', 'boxMarkerIndex', … ] to
include 'startsWithPromptGlyph'`). The guard (ARCH-24, on `main` since #1283) asserted that four functions of the sender
call the one prompt-glyph export, `startsWithPromptGlyph`, directly. This PR's marker-row helper, `boxMarkerIndex`, now
makes that call for three of them (`draftOfMeasured`, `boxRows`, `continuationRows`), and `stashHeld` still makes it
itself. I changed which functions call that export and never searched the test tree for tests that read the sender's
source as text or through the symbol scanner, so the guard that pins those call sites first ran in the merge queue.

The sender does not change. The guard now says what is true, and holds more than before:

- "reads the prompt glyph through the pane export at exactly two direct sites: the marker-row helper and the stash
  reader": every call of the export in the sender, by its enclosing function, is `boxMarkerIndex` or `stashHeld`, once
  each;
- "finds the marker row through the helper in each of the three box readers, which never test the glyph themselves":
  `draftOfMeasured`, `boxRows` and `continuationRows` each call `boxMarkerIndex`, and none calls the export or any
  `startsWith`;
- the two inline cases stay as they were (no inline `startsWith` of the glyph; the glyph in no code, only in comments).

Its header says the count of direct sites is two, and why. Mutants (measured, `send.ts` restored and compared byte for
byte after each), red by case name:

| Mutant | Red |
|---|---|
| G1: the helper tests the glyph inline (`startsWith` of the glyph in `boxMarkerIndex`) | "exactly two direct sites", "no inline startsWith", "the glyph in no code" |
| M4: `draftOfMeasured` finds the marker row its own way (its own loop over the export) | "exactly two direct sites", "through the helper in each of the three box readers" |
| G3: a fifth site (a new function calling the export) | "exactly two direct sites" |

Every test under `server/test/` that reads the sender's source as text or through the symbol scanner, found by a search
for the sender's path as a string (`inject/send.ts`, `'send.ts'`, the `inject` directory), run alone on this head
merged with `main` cced5ae878, each green:

| Test | Cases |
|---|---|
| `answer` | 35 |
| `ccd-pane-box-draft` | 68 |
| `injected-prompts-characterization` | 11 |
| `lane-draft-never-blocks` | 10 |
| `ledgerseed` | 16 |
| `mail-routes` | 62 |
| `pane-prompt-glyph` (the guard, as changed) | 6 |
| `pane-sgr-guard-characterization` | 128 |
| `question-doors-pin` | 162 (its first run here was stopped at 79 passed by the test slice's memory cap, a worker killed with none failed; run again alone with one worker, whole) |
| `single-definition/advance-switches` | 53 |
| `single-definition/ask-digest` | 186 |
| `single-definition/injected-prompts` | 55 |
| `single-definition/vocabularies` | 169 |

`askPairingStream.ts`, the search's one other hit, is a helper module with no cases of its own. The tests that walk the
whole source tree read the sender too; they are the whole-tree guards of section 9.

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
- **The top-rule anchor**, not in this PR (issue #3482, the coordinator's ruling, mail 38899), for the
  wave that follows wave 187's recorded frames: "the box's marker row sits directly under a rule". It is truer than
  guard 2 and the recorded panes show it, and it would close (a) and (d) in section 8. But it changes how every send
  reads the box, no recorded pane holds a real tall box yet, and dozens of hand-written panes across the send and lane
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
- **Residual of guard 1: an older-worded stranded nudge.** A stranded nudge whose text differs from today's (another
  build's wording) is no longer resumed. Each delivery stashes it, types today's nudge once and submits it, and the build
  restores the old one, so it stays in the box for good (the review measured `ok`, `restored`, no loop). Nothing ever
  clears it (read): `clearMailResidue` matches a paste chip or a mail fence only, and `ownStrandedClear` a `/clear` only.
  A person clears it by hand. That is a line for the coordinator's ledger, not a change here. Where the person had typed
  after the old nudge, `main` submitted their text with one Enter; the repair keeps it.
- **Residuals of guard 2.** It fires only on a rule that starts at the first column with three or more rule
  characters, and only before the first plain rule below the last glyph row. A top rule drawn otherwise leaves only
  guard 1, and the readers again describe the past turn as the draft, as before this PR: section 8.

## 8. What this does not close

Review runs 4018 and 4033 built these panes and measured them on the head. In none does the head submit a draft that
`main` does not submit, so none is a regression, and none is closed here. The keys are not always the same: in (a) with
a reply row, and in (b), the head presses the stash arm's keys where `main` pressed Enter (the head `C-s` and
`stash-failed` on a static pane, `main` Enter twice). All five go on one issue, **#3482**, for the wave that follows wave
187's recorded frames (the coordinator's ruling, mail 38899): they change how every send reads the box, and no recorded
pane holds a real tall box yet. Each pane is SYNTHETIC, 220 columns by 50 rows, sent with the mail lane's options
(`onDraft: 'stash'`, `resumeIfOwn: true`, `clearMailResidue: true`, `holdIfAutoContinueArmed: true`) unless stated.

- **(a) A past turn of our text, then only blank rows, then a plain top rule.** The pane: our past nudge, wrapped over
  three rows; one blank row (or none), then blank rows; a plain rule 220 wide; 20 indented rows of the person's draft;
  the plain closing rule; a footer. Guard 1 reads from the past nudge down to the first plain rule, which is the tall
  box's top rule, so the rows read are our text and blank rows, and the read passes. Keys: `Enter, Enter`, word
  `enter-ignored` on a static pane. On a model that follows the keys, the first Enter submits the person's draft (40
  rows), and the send answers `ok`: the mail reads delivered and the nudge was never typed. The same, head and `main`, in
  whole mode (`resumeIfOwn: 'whole'`) over a past operator line, and with 0, 1 or 5 blank rows. `submitEnter` with our
  nudge expected refuses on this pane with a mismatch and presses nothing, on both senders (its gate compares the marker
  row exactly, and the nudge wraps); given the refusal's own draft (the nudge's first row), it presses a third Enter.
  Pinned as it is today, both modes, by the two cases "wave 185, residual (a), not closed here (#3482)" in
  `send-tall-box.test.ts`, so the follow-up wave turns them red first. A reply row between the turn and the box (`⏺ ok`)
  is not our text and makes the read refuse: then the head presses `C-s` and answers `stash-failed`, where `main` pressed
  Enter twice. A labelled count top rule: no keys, `box-unreadable`.
- **(b) Where guard 1 refuses the resume, the stash arm's second Enter can submit the person's draft.** The pane: a past
  turn, a reply, a top rule that is plain, words first (`↑ 20 more ───…`) or indented, 20 rows of the person's draft, the
  closing rule. The reviews followed the keys with a model of the build: `C-s` empties the box, the typed nudge echoes,
  the first Enter makes it a past turn and the build restores the draft, with no glyph in view again. What follows
  depends on the row drawn after our just-submitted turn, with a plain top rule:
  - nothing drawn after it: `C-s`, the nudge typed, `Enter`; word `enter-ignored`; the draft is kept;
  - the same reply as before (`⏺ ok`): `C-s`, the nudge typed, `Enter`; word `ok`, restored; the draft is kept;
  - a different reply: `C-s`, the nudge typed, `Enter`, `Enter`; word `ok` with `draftRestore: 'restore-unverified'`.
    The second Enter (the stash arm's check reads the just-submitted nudge as the marker row, so it presses again)
    submits the person's 20 or 40 rows.

  With a words-first or an indented top rule, both Enters are pressed in every variant the reviews ran. `main`, with a
  past nudge, presses one Enter on that pane and no nudge, which submits the draft alone; for a past turn that is not a
  nudge the two press alike. So the harm is the same draft submitted, with our own nudge as an extra turn on the head.
  Under a first-column count rule it is safe: no keys, `box-unreadable` (guard 2). Not pinned by a case here. Three
  runners in the tree follow keys through a stash and its restore: the stash suite's fake terminal (`fakeCc`,
  `send-stash.test.ts`), the never-blocks lane's `paneRunner` (`lane-draft-never-blocks.test.ts`) and the inline
  runner in `idle-compact-nudge-lane.test.ts`. Each draws the box's first row with the glyph in view, so none can draw
  this form without a new harness, which the ruling does not ask for.
- **(c) Older than this PR: the residue clear in a tall draft.** The pane: a past paste-chip user turn
  (`❯ [Pasted text #1 +40 lines]`) above a person's tall draft under a plain top rule. `clearMailResidue` reads the past
  turn as machine residue and sends 24 `C-u` into the draft; word `draft-clear-failed`. The same on `main`. Guard 1 sits
  on the resume branch only, and guard 2 closes the labelled form only (no keys, `box-unreadable`).
- **(d) A plain first-column rule in the transcript disarms guard 2.** Guard 2 looks for the labelled rule only between
  the last glyph row and the first plain rule below it. The pane: a past nudge, a blank row, a full-width plain rule at
  the first column, then a labelled top rule and 20 rows of the person's draft. Guard 2 stops at the plain rule and never
  reaches the labelled one, and guard 1 reads our text down to that plain rule. Keys: `Enter, Enter`, word
  `enter-ignored` on a static pane, head and `main`. On a model that follows the keys, the first Enter submits the
  person's draft and the send answers `ok`, as in (a). It needs a plain rule at the first column in the transcript,
  which no reply in the recorded panes draws (every plain rule there is the input box's or a dialog's).
- **(e) A row of the person's made of rule characters reads as the closing rule** (review run 4033, older than this PR).
  The marker row is in view and the box is closed. The pane: our stranded nudge on the marker row and its continuation
  rows, then the person's row `  ────────────` (12 rule characters, indented; 8 do too), then their
  `  and here is what I actually want to say next`, then the box's real closing rule. `isRuleRow` trims and needs only
  eight rule characters, so the whole-box read stops at the person's row, sees only our text, and the resume presses
  Enter. Keys: `Enter, Enter`, word `enter-ignored`, head and `main` alike. On a model that follows the keys, that Enter
  submits every row: our nudge and the person's two. With a plain second row instead of the rule row, the head presses
  `C-s` (`stash-failed`) where `main` pressed Enter twice, so guard 1 does close that case. No recorded draft row holds a
  run of rule characters (0 of 124). Pinned as it is today by the case "wave 185, residual (e), not closed here (#3482)"
  in `send-tall-box.test.ts`.

## 9. Evidence

- New cases: `server/test/send-tall-box.test.ts`. Its panes named `SYNTHETIC_*` are built in the file and labelled
  synthetic there, and so is the shared builder `server/test/inputBoxPane.ts`. The stranded nudge's case uses a recorded
  2.1.300 EMPTY box (`cc300-paste-empty-box.txt`) with the nudge spliced in by hand: no recorded pane of any build holds
  our nudge stranded.
- Red first (measured): against `main`'s `send.ts`, in round 1, 9 of the file's 12 cases at the time failed by name, and
  the three that passed are those that must hold on `main` too (the spliced stranded nudge resumes, a row not at the
  first column does not fire, no recorded pane's reading moves). The two cases of our own rule-like lines, added after,
  are green on `main` by design. In fix round 1 the file had 18 cases; against `main` a45831a795's `send.ts`, 11 failed
  (the nine, the case whose only defect is the missing closing rule, and the case of a first-column labelled row inside
  the box), and 7 passed: those five, and the two residual (a) cases, which pin keys `main` presses too. In fix round 2
  the file has 19; against `main` 3fda0fc9b1's `send.ts`, the same 11 fail and 8 pass, the residual (e) case among them.
- The test tree's compile check could not finish in this workspace (the test slice's memory cap stopped it twice), so
  the first fast run was the first to run it (shard `server 10/12`). It found one line of the new file calling an array
  method the test tree's library setting lacks, now a plain loop.
- Mutants (measured): each mutant was applied to `send.ts` in place, the file's suite was run alone through the test
  slice, and `send.ts` was restored and compared byte for byte. Round 1 ran `send-tall-box.test.ts` and `send.test.ts`;
  fix round 1 ran `send-tall-box.test.ts` (18 cases) for every row below, and the counts are that file's. Fix round 2
  changed one comment of `send.ts` (the corpus counts beside guard 2) and re-ran every row against the file's 19 cases:
  the same counts, and the residual (e) case passes under every mutant, as a residual that pins `main`'s keys does. The
  send suite's only kill is M1's, its reversed case 6.

| Mutant | Result | Killed by (in `send-tall-box.test.ts`) |
|---|---|---|
| M1: guard 1 removed (the resume's whole-box read) | killed, 4 | the past nudge on one row and wrapped, the longer draft, our whole nudge with no closing rule; and the send suite's reversed case 6 |
| M2: guard 2's refusal removed (`boxMarkerIndex` never answers -1 for a labelled rule) | killed, 7 | the box reads absent, the lane presses nothing, Replace's presses, the refusal's draft, the park probe and rescue, the count near the left, the first-column labelled row inside the box |
| M3: guard 2 in the first draft's form (trimmed, rule characters at either end) | killed, 3 | a row not at the first column, and both cases of our own message holding a rule-like line |
| M4: the marker read without `boxMarkerIndex` | killed, 7 | as M2 |
| M5: `continuationRows` without `boxMarkerIndex` | survived | none: equivalent at every reachable call. Every caller of `continuationRows` reads `draftOfMeasured` on the same pane first and stops on absent, so the two scans answer alike wherever they are reached |
| M6: `boxRows` without `boxMarkerIndex` | killed, 1 | the first-column labelled row inside the box. Round 1 of this note called it unreachable, which was wrong (the review's finding): the whole-box proof (D-5088, `ownRenderedBox`) reads the echo wait's last capture even when that capture read absent, so `boxRows` is reached on a pane `draftOfMeasured` refused. The case is the review's kill pane |
| Ma: the closing-rule requirement dropped (`boxRows` answers its rows when no plain rule follows; the review's mutant) | killed, 1 | our whole nudge on the marker row with nothing under it. Before fix round 1 it survived this file and the send suite; the older paste-chip suite's "THE BOX MUST CLOSE" case killed it (the review's refuter) |

The review's other mutants (Mb1 and Mb2, the whole-mode compare loosened to a prefix in one place or both; Mc, guard 2
skipped) are in its report: Mb1 equivalent, Mb2 and Mc killed.
