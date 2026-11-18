# Approvals PR P, prevention: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (pull request #3036), section 3.8 and Task P.1.
Departures are listed by slug. The coordinator mints the numbers.

## What shipped

- The reviewer skill's clause 9 and the worker skill's clause 5, which already forbade deleting through a variable,
  are widened in place to the literal-path rule, word for word. Both clause counts stay as they were (ten and
  twenty), so `README.md` and `CLAUDE.md` need no edit. Each clause also says which sentences a subagent brief
  carries: the rule and the prose-names line.
- A new reference, `ccd/coordinator-skill/references/approval-prompts.md`, carries the rule, the prose-names line
  and Table 3d, with a Source column that says, row by row, what was observed, what is a string present in the
  build, what the documentation says and what is unmeasured.
- `review-panel.md` puts both sentences into the lens and refuter prompts, and `review-brief.md` tells the reviewer
  to carry them into its own briefs. `routing-matrix.md`, `wave-lifecycle-2-dispatch.md`,
  `wave-lifecycle-5-boundary.md` and `wave-steps.md` each point a coordinator's own briefs at the reference with one
  pinned sentence. No coordinator clause changed, and the reviewer skill gains no `references/` directory.

## Departures

- `clause-9-not-11`: the plan's first reading added a pinned clause. The plan's own review changed it: clause 9
  is widened in place, so the reviewer clause count, `README.md` and `CLAUDE.md` are unchanged.
- `worker-clause-5`: the plan said the worker skill's clause 5 already carried the rule. It carried only the old
  variable-only sentence, so it is widened in place too (review fix round 1, F1). The reference and this note said
  the opposite until then.
- `rule-comma`: the plan's sentence reads "Remove only literal paths you have written out: never a path…". Every
  shipped copy uses a comma instead of the colon, because the sentence now follows a full stop in the clauses. The
  copies agree with each other, and the pins hold the comma form.
- `reviewer-skill-trim`: a widened clause is growth the size ratchet counts (it allows only new numbered lines),
  so text elsewhere in the reviewer skill's notes went. Removed outright: the sentence "The worker stays resident
  and idle through your read; on a send-back the coordinator re-dispatches that same worker with your report as its
  brief.", and "A green suite is one fact; a claim in a comment is not." Shortened: the "You hold no unique
  state" paragraph and the "Then end your turn" line. "Detaching onto the sha is the whole of what you do to git." stays, because
  it reinforces clause 4. The cap is 15019.
- `worker-skill-trim`: the same cost in the worker skill, paid by two unpinned note paragraphs: the clause 5 note is
  shorter, and the "last fact" paragraph under "What you are" is shorter and no longer opens with that phrase. The
  worker skill is 22 bytes smaller and its cap is 35559. The run that holds the worker skill's Linear section
  consented to these three hunks and to the two pin literals.
- `panel-rule-constant`: the review panel script is a JavaScript template literal, so the rule sentence (which has
  backticks) is held in a plain string constant and spliced in. The file still contains the sentence word for word.
- `brief-text-home`: the plan says "the coordinator skill's lens and subagent brief text". The lens and refuter text
  lives in `review-panel.md`, and the reviewer's brief in `review-brief.md`; the ordinary-brief pointers are the four
  references named above.
- `coordinator-pins-new-file`: the coordinator skill's pin file is claimed by another run, which has not consented
  to an append. The coordinator-side pins live in the new `server/test/coordinator-approval-prompts.test.ts`
  instead. Folding them back into the existing pin file is a ledger carry, not this branch's work.
- `installer-required-refs`: a new file under the coordinator skill's references must also be named in the installer's
  required-references list (`REQUIRED_REFS` in `ccd/install-coordinator-skill.sh`), which a test compares with the
  directory. The plan did not name that file; one word is added to the list, so the new reference reaches every home.
- `table-3d-sources`: row 1's quoted message was not found as a string in the build, so it is marked as the message
  the trigger prompt showed. The lead-in no longer says the table was "measured", and says which rows are observed,
  present in the build, documented or unmeasured.
