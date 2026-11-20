# Linear hierarchy, wave 6 follow-up: the coordinator's plan clause, clause 22 (D-8185, D-8739) — task note

This note is run 2878's record for the programme ledger; the coordinator folds it into the ledger on its own pull request.
The run lands what D-8739 held out of wave 6 (#3040): the coordinator contract's plan clause, its count words and its cap,
with the words wave 6's review round 3 and #3088's last review (review 2885) left. It defines no departure: D-8742, issued to
this run, is unused. No code, no migration.

## In short

- **Clause 22** in `ccd/coordinator-skill/SKILL.md`, pinned verbatim. The Overlord's autonomy clause (D-8126, #3100) took 21.
- **The coordinator skill grows by 490 bytes for a 635-byte clause line:** the console-only sentence that D-8739 parked in
  the skill's Linear section moves into the clause, so the clause pays for 145 of its bytes inside the file. The cap is the
  file's measured size, 24829.
- **One home for each rule:** api.md points at `references/plan.md` for `plan triage` and `plan take`; the Linear skill says
  plan sync writes the plan's objects in any linked team and puts back an edit only in a managed team.
- **#3088's leftovers:** the run refusal precedence and the live-epic condition said once in api.md, plan.md and the plan's
  Task 2; the unreachable dropped-epic clause trimmed; `unreachable`'s third case (a refused key); three new pins and one
  new test.

## What was built

| Brief item | What changed | Pin (seen red) |
|---|---|---|
| 1, clause 22 | `SKILL.md`: clause 22 after clause 21, the count word "twenty-two" above the contract. README.md's and CLAUDE.md's count words move with it. The clause is Task 6.1's text as amended ("each with its waves when it runs in waves"), with the console rule review 2580 F1 ruled into it, as the wave 6 note's follow-up package carried it. | `coordinator-skill.test.ts`: the CONTRACT literal, the count word list, clause 17's length and a clause 22 case (verbs with client rows, the six item words, the console rule). Red against main's SKILL.md: the numbering and verbatim cases. |
| 2, round 3 F1 | The cap is the measured size, 24829. Growth against main is 490 bytes, inside the 635-byte clause allowance (R5), and the cap rises by the same 490 (R4). The contract ends 15639 bytes in, inside the 16750-byte restore budget (R6). | `skill-size-ratchet.test.ts`, green against `origin/main`. |
| 3, round 3 F2 | `ccd/linear-skill/SKILL.md`: "ccrc creates, moves and closes each plan's initiatives, projects, milestones and issues in any linked team, and in a managed team (a team whose migration is applied) puts back an edit a person makes". The file shrinks from 11181 to 11176 bytes (R5 gives it no allowance). | `worker-skill.test.ts`, the Linear hierarchy case: red on main's wording (`expected '--- name: ccrc-linear …' to contain 'closes each plan\'s initiatives, proj…'`), green on the new. |
| 4, round 3 F3 | `references/api.md`: the inbound path's two verbs are one paragraph that points at `references/plan.md`, which owns their bodies and refusals. Nothing api.md said there is missing from plan.md. | `coordinator-plan-reference.test.ts`: api.md points at plan.md and carries neither body. |
| 5a | `coordinator-skill.test.ts`'s run refusal list: five codes to six (`ticket-required`). | The same case. |
| 5b, F1 | Test only. | plan.md's "of a live epic that lists no waves (it opens at any wave)": red with "a live epic" there made "an epic" (review 2885's M2). |
| 5c, 5d, F2, F3 | One sentence in api.md's and plan.md's `wave-epic-mismatch` bullet: "Both cases need a live epic (with none, `plan-missing`, `ticket-unavailable` or an open with no ticket answers first), and at a wave a live epic lists, a named ticket that is unavailable (below) answers `ticket-unavailable` first." The plan's Task 2 says the same in its own words. Checked against `planGate` (`server/src/coord/openRun.ts`) and `epicForOpen`. | `coordinator-plan-reference.test.ts`, both references. |
| 5e, F4 | The plan's Task 2: the dropped-waveless-epic clause is gone (dropping an epic drops its open tickets). | None (plan text). |
| 5f, F5 | plan.md's `plan triage` and `plan take`: "when Linear refused the key, held as unauthorised or answered 403, no retry helps until the operator replaces it". api.md no longer carries the list (item 4). | The two plan.md regexes. |
| 5g, F6 | `plan-inbound.test.ts`: a refused-text close in a team no project claims. The fallback and the cancel go on and no mail is sent. | Red with `mailOwnerOnce`'s `owner === null` half removed (`expected [ 'issueComment' ] to deeply equal [ 'issueComment', 'issueUpdate' ]`); review 2874's F3 case stays green under that mutation. Restored from a saved copy, sha256 equal. |
| 5h, F8 | The run refusal count is derived from the bullets of api.md's list. | `coordinator-plan-reference.test.ts`: red with a seventh bullet added and "six" kept (`… to contain '\`runs open\` also answers seven refusa…'`). |

Every new or moved pin above was seen red against main's text of the files it reads (the clause, the count words, the Linear
section, the precedence sentence, the third `unreachable` case and the api.md pointer: eight cases in
`coordinator-skill.test.ts` and `coordinator-plan-reference.test.ts`), then green with this change applied.

## Sizes, measured

| File | main (6c8f52199c) | This PR | Cap |
|---|---|---|---|
| `ccd/coordinator-skill/SKILL.md` | 24339 | 24829 | 24339 to 24829 |
| `ccd/linear-skill/SKILL.md` | 11181 | 11176 | 11354, unchanged |
| clause 22's line, number and newline included | | 635 | |
| the coordinator contract's end | 15004 | 15639 | 16750 budget |

## Consents

- Run 1850 (`coordinator-skill.test.ts`, claim 5838; README.md, claim 5864): one packet of five pin-file hunks and one README
  hunk, sent to its coordinator under the additive terms the Overlord's clause 21 packet used (mail 27729). Answer: not
  yet (mail 27742), because those terms cover Overlord runs only until the operator answers that programme's item 496.
  Its coordinator checked the packet read-only: it applies cleanly at main 6c8f52199c, and a three-way merge with run 1850's
  frozen tip is clean in both files; the five count words are within its terms, and the two lines of the run refusal list
  carried from #3088 it would accept on the reading it uses for Overlord packets. When the operator answers, it mails; a yes
  covers this exact packet if neither file has moved on main since 6c8f52199c, else a rebuilt packet is sent.

The packet, recorded here so that it lands as written (against main 6c8f52199c):

- `server/test/coordinator-skill.test.ts`: the comment "The twenty clauses" becomes "The twenty-two clauses"; clause 22's
  literal is appended to `CONTRACT` after clause 21's, as it reads in SKILL.md, with a two-line comment (D-8185, Task 6.1 as
  amended, the console rule of review 2580); "carries all twenty clauses" becomes "carries all twenty-two clauses";
  `'twenty-two'` joins `WORDS`; clause 17's `toHaveLength(21)` becomes 22; the plan reference's run refusal case names six
  codes, adding `'ticket-required'`, its title "five" becoming "six"; and a `clause 22, the plan (D-8185)` describe block
  before the landing order wave 5h block checks that SKILL.md numbers the clause 22, that `plan.put`, `plan.met`,
  `plan.close` and `linear.create` have client rows, and that the clause names the six item words, "in the console" and
  "never asks for those approvals in its turn text".
- `README.md`: the coordinator skill's "its twenty-one" clauses becomes "its twenty-two".

Until it lands, this branch's head reds `coordinator-skill.test.ts` (SKILL.md numbers 22 clauses where the pin holds 21) and
the count word check (README says twenty-one); the PR is not ready to land before the packet is in it.
- Run 2846, wave 7 (`references/plan.md`, claim 5788; `coordinator-plan-reference.test.ts`, claim 5791): three plan.md hunks
  and four test hunks (mail 27730); yes (mail 27761: wave 7 edits only plan.md's `plan map-propose` section and the test's
  map-propose case; whichever lands second merges the other).
- Run 2862, wave 8 (the plan, claim 5802): one hunk in Task 2 (mail 27731); yes (mail 27735: its own plan edits are the Deviations found section and the Wave 8 heading only).
- api.md: run 2810's claim ended when #3088 merged; claimed by this run.
