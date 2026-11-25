# W1 coordinator clause (the Overlord clause): measurements and departures

Task notes for `docs/superpowers/plans/2026-11-25-overlord-w1-coordinator-clause.md`, Tasks 1 and 2. The
coordinator folds them into the programme ledger.

## Measured

All bytes are UTF-8, measured with `skill-size-ratchet.test.ts`'s own formula: the contract ends at the newline before
the next `## ` heading.

- **The clause line.** Spec §11.4's block quote, joined into one line, as `24. …` with its newline: 904 bytes. The
  build copied it from the spec's text, not by hand, and the pin's literal is the same bytes.
- **The room at the base** (`main` `7e1f9752fe`). The contract ended at 15,997 bytes of the 16,750-byte budget, 753
  bytes of room, so the clause alone would have ended it at 16,900, 150 bytes past. The contract's end per merge on
  the skill: 13,668 before #3100, 15,004 after it (the autonomy clause and its rewrites), 15,639 after #3119 (the plan
  clause), 15,842 after #2919 (the recall clause) and 15,997 after #3340 (a sentence added to clause 15). Without that
  last sentence the clause would have fitted with 5 bytes to spare.
- **Where the room came from** (programme call 997). The compaction note between the title and `## The contract` was
  241 bytes over three sentences and is 81 now: "**A compaction keeps only the start of this file**, so the contract
  comes first." The sentence after it, which names `## When something is wrong` and says to load the skill again, is
  unchanged, so R6's cut notice still stands. 160 bytes freed. No test pins the dropped words (a search of
  `server/test`, `shared`, `agent`, `pwa/test`, `ccd` and `.github` for its phrases finds only other skills and
  unrelated comments).
- **The count word.** "twenty-three" to "twenty-four", minus 1 byte inside `SKILL.md`; one word each in `README.md`
  and `CLAUDE.md`.
- **The result.** The file grew 24,879 → 25,622 bytes (+743 = 904 − 160 − 1). The contract ends at 16,740: 10 bytes
  to spare, the floor the ruling set. The cap in `server/test/skill-size-caps.json` went 25,030 → 25,622: +592, under
  the clause's 904-byte allowance, and equal to the file's size. `CONTRACT_BUDGET_BYTES` (16,750) and every ratchet
  rule are unchanged.
- **The next clause.** The autonomy clause (W3, spec §11.4's working number 25) is 347 bytes with its line prefix,
  against the 10 bytes left. It will not fit without the operator's shortening of existing clauses or a budget
  decision. The text before the contract has nothing left to give that does not touch the cut notice or the
  description. That question is on the record now so it is not met at W3's build.

## Guards and their red-on-removal

- **The pin** (`server/test/coordinator-skill.test.ts`). Before the pin moved, with clause 24 in `SKILL.md`: red, 2 of
  290 (1..N, and the count word). With the packet applied on a scratch copy: 290/290 green. With clause 24 then taken
  out of `SKILL.md`: red, 2 (the verbatim pin and 1..N).
- **The ratchet** (`server/test/skill-size-ratchet.test.ts`, 32 tests). Green at 16,740 and cap 25,622. Its own
  red-on-removal cases run against the real file: one byte past the cap, the cut notice taken out, and the last clause
  (now 24) earning exactly its own bytes.
- **Applied in the branch:** the pin 290/290 and the ratchet 32/32 green. Every other suite that reads the
  coordinator's skill text ran once, one file at a time, all green: `coordinator-skill-autonomy`,
  `coordinator-approval-prompts`, `dead-coordinator-prose`, `child-reclaim-prose`, `ws-expire-prose`,
  `ws-collect-prose`, `ws-shed-deps-prose`, `expiry-lane-prose`, `coordinator-plan-examples`,
  `coordinator-plan-reference`, `coordinator-landing-verdict`, `routing-references`, `mail-inbox-skills`,
  `workflow-control-census`, `update-branch-absent`, `worker-skill`, `reviewer-skill`, `overlord-skill`,
  `skill-rollout` and `install-coordinator-skill`; and the 44 files of `server/test/single-definition/` and
  `box-token-census`, all green.

## Departures

- **coord-clause-room-from-compaction-note** — §11.4 says a clause past the room needs existing clauses shortened first,
  in a pull request of its own. The room came instead from the prose before the contract (call 997). No clause, the
  description or the budget changed.
- **coord-clause-index-shortening-not-needed** — the index's row says this piece lands "after the shortening
  (question 2)". Operator item 326 raised the budget instead, and this piece took its last bytes from the note.
- **coord-clause-condition-held-by-the-build** — "acts only while the server advertises `overlord-v1`" is held by the
  build, as §7.5 and §11.5 say, and the skill carries no text for it (ruled with call 997). The residual: the clause's
  last sentence, waves left as a range at the plan and at every wave boundary, needs no door, so it binds from the
  release whatever the word says. It is harmless.
- **coord-clause-revision-word-unchanged** — `COORDINATOR_SKILL_REVISION` (`server/src/coord/skillRollout.ts`) stays
  `clause-21`, though its comment says a contract change bumps it and every running coordinator is mailed once. The
  plan clause and the recall clause left it too. The coordinator rules whether a bump to `clause-24` follows.
- **held-files-by-packet** — `server/test/coordinator-skill.test.ts` and `README.md` are held by the landing
  programme's run 1850 and `CLAUDE.md` by this programme's run 3299. Each got a unified-diff packet against `main`
  `7e1f9752fe`, and each file stayed untouched until its holder's yes: run 1850's coordinator said yes to packet v2
  (4,228 bytes, sha256 `571430bb…`) and run 3299's worker to the `CLAUDE.md` word (806 bytes, sha256 `282528b6…`); each
  yes covers that exact hunk and base, and the claims stand with their holders. The first packet for the pin missed
  clause 17's length and was replaced before any yes. The pin's packet carries the literal (no
  comment), `'twenty-four'` in `WORDS`, the count in the comment above `CONTRACT` and in the verbatim test's title, and
  clause 17's `toHaveLength(24)`.
- **coord-clause-plan-dated-path** — the index names the plan `2026-11-14-overlord-w1/w1-coordinator-clause.md`. A new
  plan inside that folder fails the layout rule (the ledger guard and the review judge, `spec-misplaced`), so it is
  `docs/superpowers/plans/2026-11-25-overlord-w1-coordinator-clause.md`.
