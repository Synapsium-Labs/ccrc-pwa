# Approvals PR P, prevention: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (pull request #3036), section 3.8 and Task P.1.
Departures are listed by slug. The coordinator mints the numbers.

## What shipped

- The reviewer skill's contract gains clause 11: the literal-path rule and the prose-names line, word for word.
- A new reference, `ccd/coordinator-skill/references/approval-prompts.md`, carries the same two sentences and Table 3d.
- `review-panel.md` puts both sentences into the lens and refuter prompts, and `review-brief.md` tells the reviewer to
  carry them into its own briefs.
- No coordinator clause changed, and the worker skill's clause 5 is unchanged.

## Departures

- `reviewer-clause-count`: a new clause makes the reviewer contract eleven clauses, so the count word in the skill's
  own prose, in `CLAUDE.md` and in `README.md` moves from "ten" to "eleven". The reviewer pin test reads those two
  files and reds on a stale count. Both files are claimed by other runs, so this branch carries the skill's own two
  words and leaves the one word in each of the two files to a hunk applied at landing, or after a release.
- `reviewer-skill-trim`: the two count words add six bytes outside the clause, which the size ratchet does not allow
  for, so one sentence in the skill's notes is shorter by fourteen bytes.
- `coordinator-pins-new-file`: the coordinator skill's pin file is claimed by another run, which has not consented to
  an append. The coordinator-side pins live in the new `server/test/coordinator-approval-prompts.test.ts` instead. Folding them back into the existing pin file is a ledger carry, not this
  branch's work.

## Known red at this tip

The reviewer skill's pin reds on one case: `README.md` and `CLAUDE.md` still say "ten clauses" for the reviewer skill,
which now has eleven. Both files are claimed by other runs. The two words go in when their holders consent, or at the
landing merge, whichever is first; the landing waits for that pin to be green.
- `reviewer-skill-cap`: the skill-size cap for the reviewer skill rises by the bytes of the clause line, from 15025 to
  15779, as the ratchet allows for an appended clause.
- `panel-rule-constant`: the review panel script is a JavaScript template literal, so the rule sentence (which has
  backticks) is held in a plain string constant and spliced in. The file still contains the sentence word for word.
- `brief-text-home`: the plan says "the coordinator skill's lens and subagent brief text". The lens and refuter text
  lives in `review-panel.md`, and the reviewer's brief in `review-brief.md`. The worker brief text
  (`wave-lifecycle-2-dispatch.md`) was left alone: it deliberately carries no standing protocol, and the worker skill's
  clause 5 already carries the rule.
