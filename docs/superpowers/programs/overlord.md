# Program: overlord

Spec: `docs/superpowers/specs/2026-11-09-overlord-design.md` (approved by the operator on 2026-11-10: H1 to H45, R1 to R17; on `main` since #2605. R18, the operator's ruling of 2026-11-12, since #2705)
Plans: `docs/superpowers/plans/2026-11-10-overlord/`, one file per piece, listed under Waves
Research: `docs/superpowers/research/2026-11-10-overlord-model-check/` (two model checks of the spec's machines)
Workspace: the Overlord programme's coordinator (slug `overlord`); issue #2491

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| spec | The hardened edition of the spec, on top of rev 8 | #2513 | merged |
| spec | The model check's fixes: 24 unsettled readings and one design fault | #2529 | merged |
| spec | The builders' gaps closed, and the ratchet's scope put to the operator | #2533 | merged |
| spec | The second model check's fixes: 38 findings in authority, restore, requests and pushes; I11 and I12 | #2538 | merged |
| spec | The third round's fixes: 80 findings from an audit of every decider table and a model of accounts, privacy and joint faults; I13 | #2539 | merged |
| spec | The seams of the four follow-ups closed: 29 restatements brought into line, the door gate order completed | #2542 | merged |
| spec | The fourth round's fixes: 32 findings in the evidence behind trust, the decision model and the judges; I14 to I16; what each kind of trust takes to earn | #2543 | merged |
| spec | The operator's approval, the rulings on the review's fifteen questions, R16 and R17 (H40 to H45) | #2605 | merged |
| W0a | The spike, Tasks 1 to 7: the rig's scenarios and stand-ins, and the first model re-run on the approved edition. Changes nothing that runs | #2632; plan `w0-spike.md` | merged |
| W0b | The spike, Tasks 8 to 11 (fleet reads, the subject, account facts, the quiz baseline), then Task 12 for both halves | #2711; plan `w0-spike.md` | merged (ed8a3b318) |
| W1a, foundations | The mail-pace table | #2528; plan `w1a-mail-pace.md` | merged |
| W1a, foundations | Each role skill's contract moved first, behind a notice that tells a session how to see a cut | #2555 (supersedes #2530) | merged |
| spec | The operator's ruling on the ratchet's scope | #2556 | merged |
| W1a, foundations | The coordinator skill made lean: its procedures in reference files, the wave lifecycle one file per step | #2557, #2558 and #2560 (the tests, first); #2559 | merged |
| W1a, foundations | The cap on each `SKILL.md`, and each contract held inside what a compaction keeps | #2565; plan `w1a-skill-ratchet.md` | merged |
| W1a, foundations | Ports for time and chance | #2623; plan `w1a-time-ports.md` | merged |
| W1a, foundations | One role vocabulary: `FLEET_ROLES` and `roleOf` | #2624; plan `w1a-roles.md` | merged |
| W1a, foundations | The trigger table and the case lane, in shadow | #2644; plan `w1a-triggers-cases.md` | merged (962f88b64) |
| W1a, foundations | The simulator's skeleton and the first model | #2649; plan `w1a-simulator.md` | merged (c8c7a116f) |
| spec | R18: the account pools the operator names replace reserved accounts | #2705 | merged (4489396ce) |
| W1a, the machine | Generations, the receipt and renewal for every long-lived role; the anchor and the card; notes; probes; launch profiles | not planned yet | W0's measurements are in (#2632, #2711); not yet planned |
| W1 | Designate and talk | not planned yet | waits for W1a (D-8126's build, #2606, merged 2026-11-11) |
| W2 | Route and follow up | not planned yet | follows W1 |
| W3 | Brief first, then answer first (two steps) | not planned yet | follows W2 |
| W4 | Learn | not planned yet | follows W3 |
| W4b | The fleet playbook | not planned yet | follows W3 |
| W5 | Start and re-kick | not planned yet | follows W3 |
| W6 | Propose and report | not planned yet | follows W4 and W5 |

## Decisions & deviations

- **The operator approved the spec on 2026-11-10** (#2605): the calls C1 to C60 and H1 to H39, the rulings on the
  review's fifteen questions, and two new rulings, R16 and R17, which add H40 to H45 (§6.9). They change nothing in
  the W0 or W1a plans; they bite from W1 and W3.
- **The operator handed the first wave to this coordinator on 2026-11-11** (W0 and the four W1a foundations left),
  approved the order below the same day, and gave the coordinator autonomy for 24 hours. The split install is parked
  (Later in the spec). W1 onward is out of scope until D-8126's build lands.
- **The order (2026-11-11).** W0a, the role table and the time ports run first, in parallel, on three workers: they
  share no file. The trigger table and case lane follows the role table, because both edit `stall.ts`'s import block
  and two of this programme's claims must not overlap, and it follows #2606, because both add a `coord.db` migration
  and the slot is measured again before merge. The simulator follows the time ports (it imports their fake), and its
  Task 6 follows W0a's Task 7 (it moves W0's model under the test tree). W0b waits for the operator's setup item.
- **Routing (2026-11-11).** Every piece is the matrix's "worker executing a spec'd plan" row: Opus · high, Sonnet ·
  high subagents, workflows off, `compact 40`. Each piece's PR gets a review run on the held-out panel.
- **W0's open questions (2026-11-11).** Questions 3, 4, 6, 7 and 8 take the plan's recommendation as this
  coordinator's call: two runs (W0a, W0b), reuse the continuity spike's scratch accounts now that its loan has ended,
  the model stays as it is, captures are not committed as fixtures, and the `scenarios-overlord/` set is the
  re-measurement on a class advance. Questions 1 (the rig's bypass exception) and 2 (the replay baseline) are the
  operator's, raised as items; question 5 (lanes) is in the setup item, and ruling 6 now allows another provider's
  lane as a fallback, so the operator may name one.
- **A plan's gap is closed in the spec, not recorded as a deviation.** Each plan was reviewed by reading the spec as
  its builder would. Where the spec left a choice open, #2533 settles it in the text, and the plan's placeholder
  entry was removed. That took the plans from 47 placeholder deviations to 31. What remains is a decision of the
  plan's own, or a real departure from the spec.
- **W0 does not write a second model.** The model that checked the spec is the first model. W0's Task 7 re-runs it
  on the merged edition, and the simulator piece moves it under the test tree.
- **W1a is planned in two parts.** The foundations need no W0 measurement and no prerequisite spec, and each is
  useful to coordinators today. So they are planned and built first, one pull request each. The generation machine
  waits for W0, because its renewal act, its anchor slot and its preconditions rest on what W0 measures.
- **The skill-size ratchet needs a ruling of its own.** It binds every programme, not only this one. Measured on
  `main` over 14 days, the coordinator skill's `SKILL.md` grew in 17 of 18 commits, and its largest reference file in
  17 of 17. Once the ratchet merges, a pull request that grows a skill file fails in the merge queue, unless it adds a
  pinned clause or puts the new text in a new reference file. So #2530 is a draft until the operator rules on its
  scope: every skill file, or `SKILL.md` only. It is ruling 16. The other foundations need no ruling.
- **Ruling 16 is made (2026-11-10).** Cap each `SKILL.md`, hold each contract inside what a compaction keeps, and
  optimise the skills. Reference files are not capped. #2555 builds it: each role skill's contract is now the first
  section of its file, behind a notice that tells a session how to see a cut, and a test holds the contract inside
  16,000 bytes. No sentence of a contract changed. The coordinator's contract has about 2,300 bytes left.
- **The coordinator skill is lean (2026-11-10).** Its `SKILL.md` went from 55,886 bytes to 23,583: the contract, a map
  of where each procedure lives, and the sections a coordinator needs at every step. The steps of a wave, the API
  calls and the cross-project wave moved to `references/wave-steps.md`, `api.md` and `cross-project.md`. The wave
  lifecycle, one file of 155,109 bytes, is now a short index and ten parts, one per step. No rule was added, removed
  or reworded: every moved section is the original text. A coordinator reads the part for the step it is on, and reads
  it again after a compaction. The tests went first (#2557, #2558, #2560) and pass on both layouts, so the move itself
  (#2559) needed no test edit. The worker skill keeps its sections: a worker needs them every wave, and it ships no
  references of its own.
- **A clause shorter is not a clause better.** The long clauses of the coordinator contract carry rules, and the
  sentences that read like rationale are pinned by tests on purpose. They were left as they are.
- **The deviation block (minted 2026-11-11 at run 1774's open) is fifty numbers from D-8202.** D-8202 to D-8231 are
  the plans' 30 recorded decisions. They are defined in the index plan, `docs/superpowers/plans/2026-11-10-overlord.md`,
  because the deviation guard reads definitions from the top level of `docs/superpowers/plans/` only; each piece's plan
  gives the whole entry with its old slug in brackets. D-8225 (one-mulberry32) belongs to the time-ports plan, and the
  simulator plan cites it. The numbers after those stay unwritten until a departure needs one: a worker names a
  departure it finds by a plain-words slug in its wave-done, and this coordinator issues the next free number and
  defines it in the index plan on a ledger PR before the worker's PR merges. D-8232 to D-8234 are the first three so
  issued (2026-11-11), for the time ports: the SQL clock pattern also catches SQLite's date functions called with no
  time value, the ambient scan also sees `AbortSignal.timeout` and the timers modules, and the fake refuses re-entry.
  D-8235 and D-8236 are the role table's two (the table's runtime guard, and the stall pin's one more import). Its
  third departure, deviations-in-a-note, is the process rule in the next bullet and takes no number. D-8237 to D-8239
  are W0a's three, all of method: the rig tooling beyond the files Task 2 named, the scenario arms split one
  environment to a run, and the force arm pinning its setting sources. D-8240 is the simulator's: the reach
  invariant's clock stops while the server is down. D-8241 is the trigger table's: the case read looks back two
  windows, so a consumed episode does not count again unless its rows span more than 14 days. D-8242 is the simulator's second: its world bounds the scheduled
  calls, so a zero-delay re-arm fails instead of hanging. D-8243 is W0b's: it runs on the fleet's own accounts.
  D-8244 to D-8250 are W0b's departures, issued on 2026-11-12 and defined in the index plan: W0-23 deferred to the
  pool design and W0-24 deferred under R18 (scope); a synthetic deny rule in the subject's project and the
  background-shell arm of W0-21 (method); the fleet reads' scope, this project's history and 14- and 9-day windows
  (scope); W0-22's canary taken from the session-start hook, and its lanes chosen by headroom (shape). One number of
  the block remains unwritten, D-8251.
- **Review 1780 on the time ports (2026-11-11), at 65415597a.** Panel verdict: no critical finding. One important
  finding was kept by two of three refuters: the ambient scan missed the `globalThis.`, `?.` and `node:process` forms.
  Six minor findings and five observations; one raised-important finding (a zero-delay re-arm hangs the fake's
  `advance`) was refuted by majority as the plan's own semantics. Lenses: correctness, 1 important and 5 minor; spec
  and rings, 1 minor; does-it-reproduce, nothing (every suite reproduced, and 33 mutants of the scan each went red but
  one). Ruled: fix the important finding and four minors (a refused draw consumes no draw, `'subsec'`, a red row for
  the alias map, an L1 pin for the rules file); record two minors as known gaps; drop the deferred item on the system
  adapter's header, which states the spec's own classification. The additions fall under D-8232 and D-8233.
- **Review 1781 on the role table (2026-11-11), at 16efd101a.** Panel verdict: nothing confirmed at any lens (34
  agents, 9 advisory survivors, 13 refuted); thirteen mutations each turned their test red, and the characterization
  pins are green at the move and view commits. Ruled: key the Task 5 pin on the symbol, as the carried constraint
  says, rather than number a departure for reading the whole file; narrow one pin's title; add a line to the note.
- **Review 1782 on the time ports' fix round (2026-11-11), at b4a8fb9c9.** The first round's five fixed findings are
  closed, each measured by mutation. One important regression came with the round: the import-alias map took in any
  helper named like a clock or chance member, so an aliased import of one read as ambient (latent, no hit in the
  tree). Five minors: two unpinned guards, `'subsec'` with modifiers, the note's wording, and more recorded gaps.
  Ruled: fix all six in a second, last round. The index's wording of D-8232 and D-8233 is corrected here to match.
- **Review 1783 on W0a (2026-11-11), at 3465cf67c.** No critical finding; 12 important and 5 minor, most of them
  rows or spec paragraphs that claim more than their committed scenario shows (the D-6798 conflict rested on an
  uncommitted run), plus four rig holes: the bypass scope was a spelling check, a positional argument could ride a
  launch, a `cd` leaked out of a snapshot, and the mock's main-request marker lived outside the tree. The refute pass
  was reduced: the reviewer verified six findings itself and left the rest unrefuted. Ruled: one fix round. Re-measure
  the D-6798 row from a committed scenario, close the rig holes with tests, word every row as what the tree reproduces,
  and keep design consequences out of the spec's "As measured" paragraphs.
- **Review 1784 on the role table's fix round (2026-11-11), at 26aa56730.** Nothing confirmed; five advisory
  findings. The pin is keyed on the symbol and red under its mutations. Ruled: accept. A branch-only commit id in the
  piece's note and the pin's move to the symbol (the carried constraint's own form) need no change. A member-call
  width and a missing positive control on one pin are recorded here as known widths. #2624 merged at 26aa56730.
- **Review 1786 on the time ports' second fix round (2026-11-11), at 3d4c2b2b6.** Four minor findings and nothing
  blocking: four SQL rows unpinned (named and numbered parameters after `'subsec'`), and three forms unrecorded (a
  cast, a global reached through another global, a non-literal modifier). This round's reviewer measured the
  three-file range by mutation itself instead of running the panel; the first two rounds ran it. Ruled: accept, and
  carry the four rows and three gaps to the simulator piece's brief. #2623 merged at 3d4c2b2b6.
- **Review 1787 on W0a's fix round (2026-11-11), at c12025181.** Every first-round item closed or mostly closed;
  nothing blocking. Three important: a bypass nested one JSON level deeper still passed the rig's check from outside
  `scenarios-overlord/`, and two spec sentences still claimed more than was measured. Eight minors. The refute pass
  was partial and the spec lens stopped unfinished; the report says so. Ruled: one last fix round, which closes the
  nested route with a recursive scan and a raw-text backstop, and takes five of the minors.
- **Neither the role table nor the time ports added the role table's files to `TIME_PORT_FILES`,** because each
  landed without the other. The trigger table's piece adds them, beside its own files.
- **Reviews 1793, 1802, 1814 and 1817 on the trigger table (2026-11-11).** Round one (1793, at e5983d990) found five
  important items. F1, an occurrence is one run, arm and key, is the spec's §10.5 definition and stays; a test pins the
  known width (three queued deliveries behind one gate are three occurrences of `mail-stuck`). The rest were fixed: a
  case never opens below its evidence (`casesDue` skips an episode later than `now`), four missing reds, and a failed
  run read is warned and answered as `unread: 'runs'`. Round two (1802) found that the rewritten test no longer pinned
  "a failed read lowers the count"; fixed with a test only. Round three (1814) found four minors and nothing blocking.
  Ruled: accept. The merge queue then put #2644 out: #2444 had landed a `coord.db` migration 57 first. The cap was
  lifted by one round, the worker took `main` and moved its migration to 58 with its body unchanged, and round four
  (1817) found nothing. Recorded, not fixed: the read-bound sentence is broad for an episode wholly older than 28
  days (no count goes wrong); the note's line 3 still speaks of a fold; the D-8241 residual has no test (shadow, so a
  wrong count, never a wrong act); the tick test sees only the dispatch, and no oracle grid input is later than now.
- **Open for W4b (2026-11-11, review 1793 F1).** A per-delivery arm (`mail-stuck`, `coord-deaf`, the quiet ladder's
  moving key) counts one stall more than once, because an occurrence is one run, arm and key. The lane runs in shadow,
  so this changes no act. Whether the spec's definition should change is the question for the cases going live in
  W4b, where the shadow counts show how often it happens.
- **Reviews 1796, 1813 and 1816 on the simulator (2026-11-11).** Round one (1796, at e6ad26dd9) judged D-8240 sound
  against spec I1 and D-8242 sound with a false premise, and found five important items: `simulate` could not see an
  async rejection; four more decider mutants (M5 to M8) survived all 32 seeds; the runner's failing-baseline arm had no
  red row; the model had two homes; D-8242's premise. Ruled: make `simulate` async and fix M5 and M6 in the scenario,
  so both join the mutant set; M7 and M8 stay known survivors; the research copy stays as W0's record with one header
  line pointing at the test copy. Round two (1813) found five minors; one, a pending promise passing silently, was
  fixed with the rest in a short last round: `settle()` throws on a pending call, two runs at once are refused, the
  redundant microtask turn is gone, and the boot phase and the three resets are pinned. Round three (1816) found four
  minors and nothing blocking. Ruled: accept. Recorded, not fixed: `settle()`'s throw names no scenario or seed; two
  `sawTwo = false` resets are equivalent mutants; a crash leaves a cancelled server call's promise pending, which
  would trip the throw (no async lane does this yet); the advisories of round one, in the note's known limits.
- **Open for the spec (2026-11-11, review 1796 F2).** Both coordinator-blocked invariants fail only towards the
  operator: a push that comes late or not at all. Nothing checks a push that comes early or too often, so mutants M7
  (rung 1 on first sight of held mail) and M8 (rung 2 at minute 0) survive. Spec Table 11.7b names no such invariant.
  Whether it needs a "no push before its cause" invariant is the spec's question, for the wave that turns the push
  lane on.
- **Owed by the time-ports owner (2026-11-11).** Three local `mulberry32` copies that D-8225's nine missed;
  `fakeTime.ts`'s "one of nine local copies" comment; `time-ports-contract.test.ts`'s title after docs-grammar's copy;
  and the scan gaps the simulator's note adds (`(process as any).hrtime()`, `global.globalThis.Math.random()`, and
  `date('subsec', col)`). None is the simulator's to fix.
- **Open for the stall code's owner (2026-11-11, the simulator plan's question 2).** After a restart, a re-opened
  coord-blocked episode can push rung 1 after a rung 2, because the run-less push latch is in memory (D-3751).
  `stall.ts` documents "pushes it once more", not a lower push. The simulator's worked example states the rung never
  falls between boots, and counts the re-opened edge. Whether a lower push is intended is not this programme's to
  decide; a fix, if any, is a change of its own.
- **Reviews 1789 to 1791 on W0a (2026-11-11).** Round three (1789, full panel) closed the nested-JSON route and found
  two more at the rig's bypass boundary: a `mainMarker` starting with `-` read as a node option, so scenario data ran
  code, and escaped YAML or loose-JSON spellings of the mode. The review-round cap was extended by one for them, the
  only extension in the programme so far, because the boundary is a safety one and the rounds were converging. Round
  four (1790) found a two-document scenario file whose first document was never checked, and line terminators the
  continuation join missed, and no route from data to code. Round five (1791) read the one commit that closed them and
  found four minors only: the CRLF alternative is unpinned, a byte-order mark passes, and two wording points. Ruled:
  accept, and record the minors here. #2632 merged at 6e2341647.
- **W0b runs on the fleet's own accounts (the operator's ruling, 2026-11-11).** "Use accounts from any pool": no
  scratch accounts and no pool-tagged project. Item 155 is withdrawn and replaced by item 163, which asks for one test
  session on any account, consent, a few console acts and the account readings. What the scratch accounts guarded is
  kept by rule: the subject is never asked to type `/model` or `/effort` with a value (W0a measured a typed `/model`
  saving the account's default, and D-8149 the plain `/effort` form), it is the only session swapped, and no reading
  touches a credential or a value. W0b's plan records this as a departure from its setup lines 1 to 3 when it runs.
- **R18: account pools replace reserved accounts (the operator, 2026-11-12).** "I don't think I want to reserve any
  accounts specifically for overlord, what I'd like to do instead, is identify which account pools overlord may use
  accounts from. That provides the right balance." Item 156 (reserve accounts in W1) was withdrawn. Run 1856 wrote it
  into the spec: the set lives on the designation, written only by the operator's doors and a Settings row; the pool
  rule's session side widens to a set, so placement keeps one decider; an untagged account serves only by an explicit
  yes; an empty set never designates; and a read-only `ccd pool-answer` tells the renewal lane whether the Overlord
  must move back inside the set. Reviews 1858 (nine findings), 1860 (seven) and 1862 (six minors, carried to W1)
  closed it. Two calls are the coordinator's, marked in "Where things stand": a deliberate `--cross-pool` move holds
  until the next renewal of any kind, and widening the set takes a step-up. The operator approved both (item 178), and
  #2705 merged at 4489396ce.
- **W0b's answers (run 1820, #2711, 2026-11-11 and 2026-11-12).** On the fleet's own accounts, with the operator's
  console acts:
  - the deadlines stand (W0-06, W0-26);
  - every account carries project memory, skills and plugins, so W1a raises an operator item on auto memory, and the
    no-mods check stays required (W0-09, W0-19);
  - real fallback notices are unmeasured, so the conservative branch stands (W0-12);
  - typed and mailed texts were done alike, rated 5 on all ten pairs, and the gate dominates, so the Overlord gets its
    own `MAIL_PACE` row (W0-20); two invited replies were held by `peer-quota` and never delivered;
  - an idle swap and an interrupting swap each passed 3 of 3, and a background shell is lost across a swap (W0-21);
  - two of the fleet's own lanes passed every check, so the operator may set those records in W1 (W0-22);
  - W0-23 and W0-24 are deferred under R18; the sweep showed no Fable use that week;
  - the replay baseline is B (W0-28, item 168).

  Reviews 1868 (four findings and eleven advisories), 1870 (four) and 1871 (none) closed it. Ruled: W0-24's use in the
  shared Fable test is W1's call (C46); the `sevenPct` read that chose the lanes was within consent (D-8250).
- **Open for the coordinator (2026-11-12), W0b's proposals.** Proposal 11: an invited reply is never refused by the
  peer bound (exempt replies from the pair bound, hold rather than refuse, give a retry hint); W0-20 measured the
  failure on today's sessions, so it is a follow-up issue outside this programme, for the operator to decide on.
  Proposal 12: the renewal lane nudges a resumed session that lost a background task (W1a's machine).
- **A work branch cannot edit an existing plan file** (2026-11-11, measured on #2623) unless its commit carries a
  Ledger-Edit trailer, as W0a's did: the ledger-guard CI step refuses it. So a worker writes its departures, its rulings within the plan and its deferred minors in a new note
  beside its plan (the time ports' is `2026-11-10-overlord/w1a-time-ports/departures.md`), and this coordinator folds
  the departures into the plan and the index on a ledger PR. Later briefs say so.
- **The spec was verified in four rounds.** The first model covers the hold, readiness, generation and push machines:
  1.86 million states over 15 scenarios, 24 readings the text had left unsettled, and one design fault. #2529 writes
  each settled reading into the spec. The second covers authority, restore, requests, commands, the push budget and
  playbook entries: 2.07 million states over 73 runs and 38 findings, one a blocker (a restore that lost acts read
  as coherent). #2538 writes those in, and adds two invariants, because 31 of 40 planted faults broke none of I1 to
  I10. The first model is the simulator's first model, which the simulator plan moves under the test tree. The
  second is W1's authority and restore model, done early. The third round is two pieces. One enumerates every
  decider table over its whole domain: total, ordered safely, monotonic, and agreeing with its restatements. The
  other models the reservation arithmetic, the operator's messages, the privacy rules and the joint cases of a
  restore. Together they made 80 findings, and #2539 writes them in. A last reader went through every line the
  follow-ups changed and found 29 passages that still stated an old rule. #2542 closes them. The fourth round models
  what judges the Overlord and how trust is earned: 32 findings, written in by #2543.
- **Trust is slow to earn at the starting values, and the spec now says how slow.** The fourth round computed what
  each gate takes (the spec's Table 9.5b). A kind of answer leaves shadow after 30 answers if the operator examines
  every accept, and about 300 if two in five. A routine answer given alone needs 59 clean blind answers in its cell
  at a `lambda` of 1. So the Overlord mostly briefs and recommends for its first months. The dials are the
  operator's, in rulings 8 and 15.
- **A cell for an answer of class none is the fleet's.** The model's fix scoped a cell to one programme, which put
  about 470 questions between a programme and its first routine answer. #2543 scopes it to the fleet, and keeps a
  grant's scope for an answer under a grant. This is the operator's to overturn.
- **On a reserved account the Overlord's load reads its reserve.** The third round found that guests at their
  ceiling held a reserved account near the Overlord's soft line, so it left with most of its reserve unspent. The
  model's fix lowered the guests' ceiling from 58% of the account to 30%. The operator had ruled that a fenced
  account is waste, so #2539 keeps the guests' ceiling and changes what the Overlord's lines read instead.
  Superseded by R18 (#2705): no account is reserved, so there is no guest and no reserve.
- **The ask-or-act example was wrong by three.** At the starting weights a routine answer needs about sixty blind
  answers with none overturned, not about twenty. Ruling 15 now carries the figure, and the figure at a setting
  of 3.
- **Calls in #2538 and #2539 are the operator's to overturn.** #2539's description lists eleven more, and #2543's
  eight. In #2538: A renewal voids a staged act. After a boot the rung is capped at `advise`, not `chat`, until a
  witness answers. The Overlord cannot drop a request that waits on the operator.
- **The operator's directions to the hardening review** are recorded in the spec's §2: built to run in containers; a
  decision model for the yes-or-no questions code cannot decide; accounts reserved for the Overlord and never
  fenced off, with auto memory off for every role. R18 (#2705) replaced the reservation with the account pools the
  operator names; nothing is fenced off, and the auto-memory direction stands.
- **The spec supersedes rev 8.** The coordinator's workspace branch takes `main`'s copy of the spec file whole.

## Carried constraints

- **Characterization first.** Every foundation that moves code pins today's behaviour first, green on the old code.
  The move commit changes only what the plan names.
- **Every guard has its mutation.** Each plan names, for each new guard, the mutation that turns its test red.
- **Additive wire, absent permits.** Nothing in W0 or W1a bumps `FLEET_PROTO`. A new field is read by one reader, and
  an older peer may omit it.
- **Keying the mail pace by role changes behaviour for one case.** A session with declared coordinator intent and no
  open run reads the worker's pace today. Moving the pace onto `roleOf` gives it the coordinator's. That change is a
  commit of its own, with its own test, in the role-table work, never in the mail-pace plan.
- **`FLEET_ROLES` holds data only.** It is an L0 table and imports nothing. What a role does lives in L1 records
  keyed by role (`MAIL_PACE`, the renewal triggers), each total over the roles.
- **The skill-size ratchet lands before the recall clause.** That clause's pull request is then the first to use the
  one allowed raise.
- **A source pin is keyed on a symbol.** A test that pins what a function reads takes the function's text through
  `server/test/scan/symbols.ts#sourceOfSymbol`, never the whole file as text. The literal-pin ratchet fails the
  other form.
- **Public repository.** Plans, commits, branch names and issues carry no private names, hosts, accounts or people.
- **A kept `Cancel` is a scheduler** (review 1780, O1). A file that keeps the `Cancel` from `scheduler.after(…)` on an
  object field or at module scope schedules, so it is L4, but the ring rule's timer reader sees only `setTimeout` and
  `setInterval`. The first piece that keeps one (the renewal lane) teaches the reader `.after(` first. The simulator
  bounds the scheduled calls per world instead (D-8242), so a zero-delay re-arm fails rather than hanging.
- **A simulator predicate that reads sweep times assumes the simulator's beat** (review 1816 F1). CB-reach's
  threshold arm is exact only where sweeps fire at the boot's phase plus whole sweeps, as in the simulator. D-8214 runs
  a simulator predicate unchanged in the W1 monitor, where sweeps drift, so the monitor carries the real sweep phase or
  keeps the plan's looser bound, `max(m + COORD_BLOCKED_HELD_MS, steadySince) + STALL_SWEEP_MS`. The same holds for
  D-8240's down rule, which a monitor that sees only boots cannot apply.
- **An async lane in the simulator runs after the timers** (the simulator's known limit). A continuation after an
  `await` runs after the whole `runUntil`, so an async lane is not interleaved with the timers, and only microtasks
  are drained. A W1 piece that tests an async lane in the simulator says so, or extends the world.
- **R18's minors, for the W1 plan** (review 1862). The tick path's verdict site (`stuck=pool`) as well as the rc-4
  arm; the agent whitelist row and argument form for `ccd pool-answer`, and its exit codes and grammar; the
  `projection` word applies fleet-wide; a rescue can land on a `prefer --cross-pool` home until the next renewal; and
  what follows a pool-set rollback.
- **The sweep's per-session account can differ from its per-account attribution** for a session that moved between
  lanes (review 1871). A W1 reader of `perSession` says which one it means.

## Next-wave brief

- **Where to start.** Read the spec's "In short", §14 (the build order) and "Where things stand". Then read the plan
  of the piece you take. Each plan is self-contained.
- **Running now (2026-11-12).** Nothing. W0 is complete: W0a (#2632) and W0b (#2711). The four W1a foundations have
  merged: the role table (#2624), the time ports (#2623), the trigger table and case lane (#2644) and the simulator
  (#2649). R18 is in the spec (#2705).
- **Next.** W1a's machine pieces, planned from W0's measurements (the results note,
  `docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md`) and R18. Planning them waits for the operator's
  word.
- **What was built before the programme's run opened.** The mail-pace table (#2528), each role skill's contract moved
  first (#2555), and the lean coordinator skill (#2557, #2558, #2560, #2559), with the cap on each `SKILL.md` behind
  it.
- **What must not start.** W1 and later. They wait for W1a (D-8126's build, #2606, has merged).
- **What the operator owes.** Nothing for W0. The Overlord's account pools are named in Settings once W1's set row is
  live (R18), and the auto-memory item comes with W1a (W0-09).
- **What to report.** Each piece ends with its pull request merged through the queue, its plan's "Deviations found"
  filled in, and this ledger's row updated on a `ledger/overlord` branch.
