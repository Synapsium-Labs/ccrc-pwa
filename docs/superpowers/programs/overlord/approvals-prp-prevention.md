# Approvals PR P, prevention: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (pull request #3036), section 3.8 and Task P.1.
Departures are listed by slug. The coordinator mints the numbers.

## What shipped

- The reviewer skill's clause 9, which already forbade deleting through a variable, is widened in place to the
  literal-path rule, word for word. The count stays ten, so `README.md` and `CLAUDE.md` need no edit.
- A new reference, `ccd/coordinator-skill/references/approval-prompts.md`, carries the rule, the prose-names line
  and Table 3d.
- `review-panel.md` puts both sentences into the lens and refuter prompts, and `review-brief.md` tells the reviewer
  to carry them into its own briefs.
- No coordinator clause changed, the worker skill is untouched, and the reviewer skill gains no `references/`
  directory (its clause points nowhere new; the briefs point at the coordinator skill's reference).

## Departures

- `clause-9-not-11`: the plan's first reading added a pinned clause. The plan's own review changed it: clause 9
  is widened in place, so the clause count, `README.md` and `CLAUDE.md` are unchanged.
- `reviewer-skill-trim`: a widened clause is growth the size ratchet counts (it allows only new numbered lines), so
  two non-pinned sentences in the skill's notes are shorter and the file is one byte under its old size. The cap
  moves from 15025 to 15024.
- `panel-rule-constant`: the review panel script is a JavaScript template literal, so the rule sentence (which has
  backticks) is held in a plain string constant and spliced in. The file still contains the sentence word for word.
- `brief-text-home`: the plan says "the coordinator skill's lens and subagent brief text". The lens and refuter text
  lives in `review-panel.md`, and the reviewer's brief in `review-brief.md`. The worker brief text
  (`wave-lifecycle-2-dispatch.md`) was left alone: it deliberately carries no standing protocol, and the worker
  skill's clause 5 already carries the rule.
- `coordinator-pins-new-file`: the coordinator skill's pin file is claimed by another run, which has not consented
  to an append. The coordinator-side pins live in the new `server/test/coordinator-approval-prompts.test.ts`
  instead. Folding them back into the existing pin file is a ledger carry, not this branch's work.
