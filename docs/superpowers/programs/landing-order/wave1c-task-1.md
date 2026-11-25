# Landing order wave 1c, Task 1: worker clause 16's fourth trigger

Run 3698. Plan: `docs/superpowers/plans/2026-11-24-landing-order-wave1c-conflict-sync.md`, Task 1.
Implements D-9011 and D-9012.

## What changed

- `ccd/worker-skill/SKILL.md`, clause 16: its first two sentences are replaced by the plan's text, word
  for word. Every later sentence of the clause is unchanged. No clause is added or removed; `CONTRACT`
  keeps twenty entries.
- `server/test/worker-skill.test.ts`: `CONTRACT[15]` carries the same two sentences, and one new case,
  `clause 16 has a fourth trigger, the coordinator conflict-sync mail, bounded to one named commit per
  mail (D-9011, D-9012)`, beside `clause 16 names the probe …`.

## Measured

- Red first: with the pin changed and the skill not, `carries all twenty clauses verbatim` and the new
  case were red (2 of 84); every other case was green.
- Green after the skill change: 84 of 84, `names update-branch ONLY inside clause 16` among them with the
  same count (clause 16 still names `update-branch` once).
- `clause 16 names the probe …` holds no occurrence count of the probe or of `exits 1`; it only checks
  that each phrase is present. Its expected values needed no change, so Step 4's count clause had nothing
  to move.

## A departure from the plan's snippet (for the coordinator to number or not)

`D-TBD-c16-case-reads-skill-line`: the plan's new case reads `CONTRACT[15]` only. Measured, that makes it
green as soon as the pin changes, before the skill does, so a mutation of the skill text alone (1C-01,
1C-02, 1C-03) would never red it, which the mutation table predicts it does. The case now checks every
assertion against both `CONTRACT[15]` and SKILL.md's own `16. ` line, the way the clause 9 case reads
its line. The assertions are the plan's, unchanged.

## Left as it is

The fix-round paragraph's sentence `It licenses no absorb: clause 16's first two triggers still apply to
it, and its third does not.` stays true with a fourth trigger (a `red:` fix-round mail is not a
`conflict-sync:` mail), so it is not reworded, and its pin does not move.
