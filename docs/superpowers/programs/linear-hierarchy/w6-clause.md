# Linear hierarchy, wave 6 follow-up: the coordinator declares and keeps its plan, clause 22 (D-8185, D-8739) — task note

This note is run 2878's record for the programme ledger; the coordinator folds it into the ledger on its own pull request.
The run lands what D-8739 held out of wave 6 (#3040): the coordinator contract's plan clause, now clause 22, with its count
words and cap. It also lands the words wave 6's review round 3 and #3088's last review (review 2885) left, and the findings of
its own reviews 2920 and 2929. The clause was carried for a time: run 1850's coordinator answered "not yet" for the pin file
and README.md until the operator ruled its item 496 (mail 27742), and #3119 first went to review without it (mail 27768).
The operator's answer let run 1850 consent (mail 27932), and the coordinator ruled that fix round 2 lands it (mail 27937). The
run defines no departure: D-8742, issued to it, is unused. No code, no migration.

## In short

- **Clause 22** in `ccd/coordinator-skill/SKILL.md`, pinned verbatim. The Overlord's autonomy clause (D-8126, #3100) took 21.
  The console-only sentence that D-8739 parked in the skill's Linear section moves into the clause, so the file grows by 490
  bytes for a 635-byte clause line. The cap is the file's size measured in this round, 24829.
- **One home for each rule:** api.md points at `references/plan.md` for `plan triage` and `plan take` (round 3 F3). The Linear
  skill says plan sync writes the plan's objects in any linked team and puts back an edit only in a managed team (round 3 F2).
- **The words #3088 and this run's reviews left:**
  - the run refusal precedence and the no-live-epic answers, said once in api.md, plan.md and the plan's Task 2, as `planGate`
    decides them;
  - `unreachable`'s limit and five cases, said in plan.md as the doors decide them;
  - two ledger entries brought into line (D-8739, D-8735).
- **Tests:** every new or moved pin seen red first. One new inbound test.

## What was built

| Brief item | What changed | Pin (seen red) |
|---|---|---|
| 1, clause 22 | `SKILL.md`: clause 22 after clause 21, the count word "twenty-two" above the contract, the Linear section's console sentence moved into the clause. README.md's and CLAUDE.md's count words move with it. The clause is Task 6.1's text as amended ("each with its waves when it runs in waves"), with the console rule review 2580 F1 ruled into it. | `coordinator-skill.test.ts`: the CONTRACT literal, the count word list, clause 17's length check, and a clause 22 case (verbs with client rows, the six item words, the console rule). Red with SKILL.md as on main: the verbatim, numbering, count word and clause 22 cases, and the plan reference's console case (five reds). Red with README.md, and with CLAUDE.md, as on main: the count word case (`README.md says twenty-one clauses where the CONTRACT pins 22`). |
| 2, round 3 F1 | The cap is the measured size, 24829. Growth against main is 490 bytes, inside the 635-byte clause allowance (R5), and the cap rises by the same 490 (R4). The contract ends 15639 bytes in, inside the 16750-byte restore budget (R6). | `skill-size-ratchet.test.ts`, green against `origin/main`. |
| 3, round 3 F2 | `ccd/linear-skill/SKILL.md`: "ccrc creates, moves and closes each plan's initiatives, projects, milestones and issues in any linked team, and in a managed team (a team whose migration is applied) puts back an edit a person makes". The file shrinks from 11181 to 11176 bytes (R5 gives it no allowance). | `worker-skill.test.ts`, the Linear hierarchy case: red on main's wording (`… to contain 'closes each plan\'s initiatives, proj…'`). |
| 4, round 3 F3 | `references/api.md`: the inbound path's two verbs are one paragraph that points at `references/plan.md`, which owns their bodies and refusals. Nothing api.md said there is missing from plan.md, and nothing its pins held is pinned less: both clauses and the word "only" are pinned in plan.md (review 2920 F1, review 2929 F1 and F2). | `coordinator-plan-reference.test.ts`: api.md points at plan.md and carries neither body (red on main's api.md). |
| 5a | `coordinator-skill.test.ts`'s run refusal list: five codes to six (`ticket-required`). | The same case. |
| 5b, F1 | Test only. | plan.md's "of a live epic that lists no waves (it opens at any wave)": red with "a live epic" there made "an epic". |
| 5c, 5d, F2, F3 | api.md and plan.md, in the `wave-epic-mismatch` bullet, as shipped after review 2920 F6: "Both cases need a live epic: with none, the run is refused `plan-missing` when the programme needs a plan, else `ticket-unavailable` when it names a ticket, else it opens with no ticket; and at a wave a live epic lists, a named ticket that is unavailable (below) answers `ticket-unavailable` first." The plan's Task 2 said it differently until fix round 2. Its `plan-missing` read "no epic", and its `ticket-unavailable` list left out a named ticket when no live epic exists. Both now follow `planGate` (review 2929 F5). | `coordinator-plan-reference.test.ts`, both references (red on main's text, and with the pre-F6 wording put back). |
| 5e, F4 | The plan's Task 2: the dropped-waveless-epic clause is gone (dropping an epic drops its open tickets). | None (plan text). |
| 5f, F5 | plan.md's `plan triage` and `plan take`: a key Linear refused with a 401 (review 2920 F2), then the fourth and fifth cases (review 2920 F3, review 2929 F3). | The plan.md regexes. |
| 5g, F6 | `plan-inbound.test.ts`: a refused-text close in a team no project claims. The fallback and the cancel go on and no mail is sent. | Red with `mailOwnerOnce`'s `owner === null` half removed (`expected [ 'issueComment' ] to deeply equal [ 'issueComment', 'issueUpdate' ]`); review 2874's F3 case stays green under that mutation. |
| 5h, F8 | The run refusal count is derived from the bullets of api.md's list. | Red with a seventh bullet added and "six" kept. |

Every mutation ran in a scratch clone through `ccrc test --`, and each file was restored from a saved copy (sha256 equal).

## Fix round 1 (review 2920)

The coordinator's rulings of mail 27858. Words and pins only.

| Item | Ruling | Done | Pin (seen red) |
|---|---|---|---|
| F1 | The move of the `unreachable` pin from api.md to plan.md lost two clauses' pins; nothing may be pinned less than on main. | Each plan.md section's regex gains its own clause: triage's "for a decision that binds it", take's "for an Upkeep ticket's take or close, the programme's home workspace could not be resolved". The word "only" that main's api.md pin also held came back in fix round 2 (review 2929 F1). | Red with each clause cut (two mutations, one per section). |
| F2 | Only a 401 is a verdict on the key: `client.ts` maps a 401 to `unauthorised` and a 403 to `forbidden`, which no caller may treat as one; `inboundPolicy.ts`'s key words are `not-configured` and `linear-unauthorised`, and a `linear-forbidden` answer is a row word, about that one issue. | The third case names the 401 hold only: "when Linear refused the key with a 401, held as unauthorised, no retry helps until the operator replaces it". No 403 clause. | Red with the 403 wording put back. |
| F3 | Add the fourth case the doors produce. | Checked against `InboundLane#readById` (no managed team in the workspace: Linear is not asked, `inboundRecheckOf` answers unmeasured with no word), `inboundDoorVerdict` (an unmeasured answer refuses a binding decision `unreachable`) and `planRoutes.ts`'s `recheckRefusal`. Both sections: "and when the issue's workspace has no managed team, nothing is re-read and no retry helps until one of its teams is managed again". | Red with the case cut. |
| F4 | Amend both stale ledgered statements here. | D-8739: the cap is the size measured when the clause lands, never a carried figure; the clause lands as 22, the carried packet measured 24829 against main's 24339, and it waits on plan ticket `w6-clause-22`. D-8735: a retry helps only when Linear or ccrc's Linear store could not be read; a missing key or slot, a 401, and a workspace with no managed team each say what they need. The head commit carries the Ledger-Edit trailer. | None (plan text). |
| F5 | Accepted: the PR lands squashed; history is not rewritten. | Nothing. | |
| F6 | With no live epic, say which answers are refusals and which is the open. | api.md and plan.md: "with none, the run is refused `plan-missing` when the programme needs a plan, else `ticket-unavailable` when it names a ticket, else it opens with no ticket; and at a wave a live epic lists, a named ticket that is unavailable (below) answers `ticket-unavailable` first." Checked against `planGate`. | Red with the old wording put back in api.md. |

Consents for the round: wave 7 for plan.md and the pin file (mail 27867), wave 8 for the two ledger entries (mail 27868: its
branch adds D-8808 and D-8809 after D-8736 and edits neither entry).

Every mutation ran in a scratch clone of this branch with the round applied, through `ccrc test --`, and each file was restored
from a saved copy (`sha256sum -c` OK). Suites green with the round applied: coordinator-plan-reference, coordinator-skill,
worker-skill, skill-size-ratchet, ccrc-api-closed, public-text, reviewer-skill, plan-inbound, plan-inbound-policy and
deviation-refs (after `git fetch origin main`), 713 tests.

## Fix round 2 (review 2929, and clause 22)

The coordinator's rulings of mail 27952 (review 2929) and mail 27937 (clause 22, option a).

| Item | Ruling | Done | Pin (seen red) |
|---|---|---|---|
| F1 | Put "only" back. | Both plan.md sections: "refused only for a decision that binds it". Triage's list: "a hand, an Upkeep placement or a take into an epic, while a close, a raise or a return goes on". Take's: "a take into an epic, while a close or a return goes on". This is what `inboundDoorVerdict` decides. | Red with "only" cut, in each section. |
| F2 | Row 4 of this note is true once F1 is fixed. | Row 4 says so. | |
| F3 | The fifth case: an answer about one issue. | Checked against `InboundLane#readById` (any refusal but `not-found` is unmeasured with its word) and `inboundRecheckOf` (`malformed`). The refusal words that are about one issue are `inboundPolicy.ts`'s `ROW_WORDS` (`linear-forbidden`, `linear-invalid`, `malformed`), and `inboundDoorVerdict` refuses a binding decision `unreachable` on them. Both sections: "and when Linear answered about that one issue, refusing it as forbidden or invalid or answering outside its grammar, a retry gets the same answer until that issue changes in Linear". D-8735's retry sentence names it, in place. | Red with the case cut, in each section. |
| F4 | D-8739's opening, and this clause's other mentions in the plan. | D-8739 opens "Task 6.1's clause (21 when planned, 22 when it lands)". Its mentions in What was read first (the `references/plan.md` bullet), Task 2.4's `plan put` route and Task 2.5's `references/plan.md` note, and Task 6.1's file list, cap, "Produces", count word, wording note and Step 1, say 22, with one sentence saying the task said 21 when planned. D-8739's last sentence says the clause lands in this round. Task 6.1's five steps are ticked. No mention of the Overlord's clause 21 changed. | None (plan text). |
| F5 | Row 5c/5d quotes the shipped sentence, and Task 2 follows `planGate`. | Row 5c/5d above. Task 2: `plan-missing` is "no live epic and `planRequired` 1". `ticket-unavailable` adds an unknown ticket, and a named ticket when the plan has no live epic and requires none. With neither, and no named ticket, the run opens with none. | None (plan text). |
| F6 | Record wave 8's branch as measured before the push. | See Consents. | |
| Clause 22 | Land it with everything the note carried. | Run 1850's packet re-measured against main 42612467b8 before this round: neither file had moved since 6c8f52199c, and the packet was byte-identical (sha256 cf8ece6b…), so run 1850's yes of mail 27932 stands. Its coordinator was mailed this run id before the push. | Row 1 above. |

## Sizes, measured

| File | main (6c8f52199c) | This PR | Cap |
|---|---|---|---|
| `ccd/coordinator-skill/SKILL.md` | 24339 | 24829 | 24339 to 24829 |
| `ccd/linear-skill/SKILL.md` | 11181 | 11176 | 11354, unchanged |
| clause 22's line, number and newline included | | 635 | |
| the coordinator contract's end | 15004 | 15639 | 16750 budget |

## Consents

- **Run 1850** (`coordinator-skill.test.ts`, claim 5838; README.md, claim 5864): one packet of five pin-file hunks and one
  README hunk (mail 27729).
  - First answer: not yet (mail 27742), because its additive terms covered Overlord runs only until the operator answered
    that programme's item 496. Withdrawn for a time (mail 27782).
  - The operator answered: yes, to the exact packet (mail 27932). Its coordinator re-checked the packet read-only: clean at
    main 42612467b8, and clean in a three-way merge with run 1850's frozen tip.
- **Run 2846, wave 7** (`references/plan.md`, claim 5788; `coordinator-plan-reference.test.ts`, claim 5791):
  - first build: yes (mail 27761);
  - fix round 1: yes (mail 27867);
  - fix round 2: asked in mail 27961, which supersedes mail 27951: yes (mail 28019). Wave 7's own fix round adds
    one clause inside `plan map-propose`, away from these hunks; its claims on the two files are now 5967.
- **Run 2862, wave 8** (the plan, claim 5802):
  - first build: yes (mail 27735);
  - fix round 1: yes (mail 27868);
  - fix round 2: two hunks, yes (mail 27956); the full nine-hunk round, asked in mail 27962: yes (mail 27966). Its own plan edits (D-8808 and D-8809 after
    D-8736, and the Wave 8 heading) are not on its branch yet and do not meet these.
  - Review 2929 F6, measured just before the push: wave 8's local branch tip is 3cfa0da5ca, not pushed. Against its merge
    base 42612467b8 it adds 22 lines at the end of `references/plan.md`, after `plan take`. In the plan, it adds 34 lines
    in Deviations found, after D-8736 (D-8808 and D-8809), and changes one line, the Wave 8 heading. A three-way merge of
    each file with this round is clean. (Line numbers once given here, and in row F4 above, were wrong at the tip; review
    2960 A4 measured them, and section names replace them.)
- **api.md:** run 2810's claim ended when #3088 merged; claimed by this run.

## Words after the pilot's last fixes (run 3102, ticket `w6-words`)

Reviews 2960, 2998 and 3096 left wording that was no longer true of the code. A rules file is kept out of a code pull
request, so these words were carried to this run. Words and pins only: no server or pwa code changed, and no new number.
The plan's changes amend D-8735, D-8739, D-8808 and Task 2.5 in place; the rest are `references/plan.md`, its pins and
these notes.

| Item | What the code says | Done | Pin (seen red) |
|---|---|---|---|
| Review 2960 F1, as review 3106 F1 and F2 corrected it | A door's by-id read (`issueOwned`, shaped by `hierarchyOps.ts`'s `issueRecord`) shapes the whole issue: any field of that one issue outside Linear's grammar answers `malformed`, and it repeats until the issue changes in Linear. A body that could not be read (`client.ts`), a transport fault, also answers `malformed`, and may clear on a retry; so may a readable response with no `data` or no issue, which the shaper reads `malformed` too. For a decision that binds the issue, a door refuses `unreachable` on any unmeasured answer, with one detail (`inboundDoorVerdict`, no retry table; a close, a raise or a return goes on); `RETRY_WORDS` sorts the close lane's refusals, from its write or its own by-id re-read. | Fix round 1 wrote the per-cause account into plan.md's `plan triage` and `plan take`; fix round 2 moved it to D-8735 alone, worded as Linear's answer as ccrc reads it. plan.md now says only what a coordinator can act on: try once more, then tell the operator. D-8735 names the close lane where it cites `RETRY_WORDS`. | The shared retry regex, red in each section with the old tail put back, and red against round 1's narrower text. |
| Review 2960 A1 | Triage binds on `upkeep \|\| hand` (`planRoutes.ts`). A triage hand to the caller's own programme is taken at once into an epic (D-8706), and binds as the hand it is; `plan take`'s own decisions are a take into an epic, a close and a return. | Triage's sentence: "a hand or an Upkeep placement, while a close or a raise goes on". The take section already names its own decisions. | Triage's regex, red with the old list. |
| Review 2960 A2 | Clause 22 carries the console-only rule. | D-8739 says, in the past tense, that the follow-up moved the sentence into clause 22. plan.md points at clause 22 rather than restating the rule. | plan.md's pointer sentence, and no "never answers one for them" there: red on the old text. |
| Review 2960 A3 | `planGate` refuses through `ticketIsHeld`: `started`, or `open` with a run. | Task 2.5 and plan.md: "held by another run (started, or open with a run attached, a planned run included)". | plan.md's phrase, red on the old text. |
| Review 2960 A4 | | Row F4 and the Consents entry above name sections, not line numbers. | None (note text). |
| Review 2960 F2's residue | Clause 22 says "never files or edits a hierarchy object"; Task 6.1's text has no "or edits". | D-8739 records that the words came with wave 6's carried packet, and that the clause stands as landed. | None (plan text). |
| Review 2998's nit | The follow-up map test (`migration-apply.test.ts`) expects `plan-bad-body` once the tick has shed the only skipped issue. | plan.md: `map-incomplete` while the follow-up map is still awaited, `plan-bad-body` once none is. | plan.md's sentence, red on the old text. |
| Review 3096 F1 | `hierarchyStateOfRow` has no top-row condition. | D-8808 and the w8 note say "a pinned row". | None (plan and note text). |

### Fix round 1 (review 3106)

The coordinator's rulings of mail 29311. Words and pins only.

| Item | Done | Pin (seen red) |
|---|---|---|
| F1 | The repeating `malformed` case widened from "missing its team or state" to any field of that one issue outside Linear's grammar, in both plan.md sections, D-8735 and the F1 row above. The attribution to `inboundRecheckOf`'s branch is dropped: the shaper refuses first. | The shared retry regex, red against round 1's text. |
| F2 | D-8735 names the close lane where it cites `RETRY_WORDS`, and says a door re-reads the issue on every call and, for a decision that binds the issue, refuses `unreachable` on any unmeasured answer (the binds qualifier added in fix round 2, review 3110 F2). | None (plan text). |
| F3 | The "not restated" guard also refuses clause 22's own words in plan.md, read from SKILL.md's clause 22 line. | Red with clause 22's console sentence appended to plan.md. |
| F4 | The A1 row says a triage hand to the caller's own programme is a take into an epic, and binds as a hand. | None (note text). |
| F5 | Task 2.5's rewrite is tagged "amended by review 2960 A3"; this section's intro no longer says every change amends a D-entry. | None (plan and note text). |
| F6 | The F4 row of fix round 2 is one line again, so the table renders. | None (note text). |

### Fix round 2 (review 3110)

The coordinator's rulings of mail 29334. Words and pins only.

| Item | Done | Pin (seen red) |
|---|---|---|
| F1 | A coordinator never sees `malformed`, `linear-forbidden` or `linear-invalid`: a door's unmeasured re-read reaches it as one refusal, `unreachable`, with one detail (`recheckRefusal`, `planRoutes.ts`). So plan.md's `plan triage` and `plan take` say only what it can act on: ccrc could not read the issue back; try once more later; if refused again, stop and tell the operator (a fix in Linear, or a new Linear key). The per-cause account is D-8735's alone, worded as Linear's answer as ccrc reads it, since Linear never answers `malformed`: ccrc's shaper does. | The new sentence's regex, red against fix round 1's plan.md, and in each section alone; the section names none of the causes it cannot see. |
| F2 | "For a decision that binds the issue" added where D-8735 and this note say a door refuses `unreachable` on an unmeasured answer. | None (plan and note text). |
| F3 | D-8735's may-clear arm includes a readable response with no `data` or no issue. | None (plan text). |
| F4 | D-8735: the close lane gives `malformed` up past its last backoff step whether it came from its write or its own by-id re-read (`InboundLane#refused`). | None (plan text). |
| F5 | The test file's header says clause 22's wording is read there only to keep plan.md from restating it. | None (comment). |

The review judge's `rules-mixed` stands as ruled: the pin test cannot leave the rules file it pins, so the PR stays whole.
