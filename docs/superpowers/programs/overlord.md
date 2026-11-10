# Program: overlord

Spec: `docs/superpowers/specs/2026-11-09-overlord-design.md` (the hardened edition, H1 to H39)
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
| spec | The third round's fixes: 80 findings from an audit of every decider table and a model of accounts, privacy and joint faults; I13 | #2539 | in review |
| W0 | The spike: measure what the design depends on. Changes nothing that runs | plan `w0-spike.md` | planned. Tasks 1 to 7 need no setup. Tasks 8 to 11 wait for the operator's setup item |
| W1a, foundations | The mail-pace table | #2528; plan `w1a-mail-pace.md` | merged |
| W1a, foundations | The skill-size ratchet | #2530 (draft); plan `w1a-skill-ratchet.md` | built. Waits for the operator's ruling on its scope |
| W1a, foundations | Ports for time and chance | plan `w1a-time-ports.md` | planned |
| W1a, foundations | One role vocabulary: `FLEET_ROLES` and `roleOf` | plan `w1a-roles.md` | planned |
| W1a, foundations | The trigger table and the case lane, in shadow | plan `w1a-triggers-cases.md` | planned |
| W1a, foundations | The simulator's skeleton and the first model | plan `w1a-simulator.md` | planned |
| W1a, the machine | Generations, the receipt and renewal for every long-lived role; the anchor and the card; notes; probes; launch profiles | not planned yet | waits for W0's measurements |
| W1 | Designate and talk | not planned yet | waits for W1a, for D-8126, and for the operator's rulings |
| W2 | Route and follow up | not planned yet | follows W1 |
| W3 | Brief first, then answer first (two steps) | not planned yet | follows W2 |
| W4 | Learn | not planned yet | follows W3 |
| W4b | The fleet playbook | not planned yet | follows W3 |
| W5 | Start and re-kick | not planned yet | follows W3 |
| W6 | Propose and report | not planned yet | follows W4 and W5 |

## Decisions & deviations

- **The spec stays a draft until the operator rules.** Sixteen rulings wait on the operator. They are listed in the
  spec under "Waiting on you" and tracked in #2514. The spec is written as if each proposed answer holds. W0 needs
  none of them.
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
- **No D-numbers are defined yet.** The spec defines none, and the plans name each recorded decision
  `D-TBD-<slug>`. The programme mints real numbers through the ledger door when its run opens, and replaces each
  slug in the same act. Until then the plans cannot merge: `server/test/dtbd.test.ts` fails on a concrete slug.
- **The spec was verified in three rounds.** The first model covers the hold, readiness, generation and push machines:
  1.86 million states over 15 scenarios, 24 readings the text had left unsettled, and one design fault. #2529 writes
  each settled reading into the spec. The second covers authority, restore, requests, commands, the push budget and
  playbook entries: 2.07 million states over 73 runs and 38 findings, one a blocker (a restore that lost acts read
  as coherent). #2538 writes those in, and adds two invariants, because 31 of 40 planted faults broke none of I1 to
  I10. The first model is the simulator's first model, which the simulator plan moves under the test tree. The
  second is W1's authority and restore model, done early. The third round is two pieces. One enumerates every
  decider table over its whole domain: total, ordered safely, monotonic, and agreeing with its restatements. The
  other models the reservation arithmetic, the operator's messages, the privacy rules and the joint cases of a
  restore. Together they made 80 findings, and #2539 writes them in.
- **On a reserved account the Overlord's load reads its reserve.** The third round found that guests at their
  ceiling held a reserved account near the Overlord's soft line, so it left with most of its reserve unspent. The
  model's fix lowered the guests' ceiling from 58% of the account to 30%. The operator had ruled that a fenced
  account is waste, so #2539 keeps the guests' ceiling and changes what the Overlord's lines read instead.
- **The ask-or-act example was wrong by three.** At the starting weights a routine answer needs about sixty blind
  answers with none overturned, not about twenty. Ruling 15 now carries the figure, and the figure at a setting
  of 3.
- **Calls in #2538 and #2539 are the operator's to overturn.** #2539's description lists eleven more. In #2538: A
  renewal voids a staged act. After a boot the rung is capped at `advise`, not `chat`, until a witness answers. The
  Overlord cannot drop a request that waits on the operator.
- **The operator's directions to the hardening review** are recorded in the spec's §2: built to run in containers; a
  decision model for the yes-or-no questions code cannot decide; accounts reserved for the Overlord and never
  fenced off, with auto memory off for every role.
- **The spec supersedes rev 8.** The programme's workspace branch still holds rev 8. When it next takes `main`, it
  takes `main`'s copy of the spec file.

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

## Next-wave brief

- **Where to start.** Read the spec's "In short", §14 (the build order) and "Where things stand". Then read the plan
  of the piece you take. Each plan is self-contained.
- **What can start now.** W0's Tasks 1 to 7, and every W1a foundation. They do not depend on each other, except
  that the role table follows the mail-pace table (it widens `MAIL_PACE`'s key), and the simulator follows the ports
  for time and chance.
- **What was built before the programme's run opened.** The mail-pace table (#2528) and the skill-size ratchet
  (#2530). Each touches only its own files and changes nothing that runs, so each went up as a pull request of its
  own.
- **What waits for the run.** The role table, the ports for time and chance, the simulator and the case lane touch
  files that other programmes edit (`shared/api.ts`, `server/src/fleet.ts`, `server/src/coord/stall.ts`, the test
  tree's shared helpers, a `coord.db` migration slot). The spec has the wave claim those files through the peer
  protocol first (§3.3.9). So they start when the programme's run is open, its claims are placed, and its deviation
  block is minted.
- **What must not start.** W1 and later. They wait for D-8126 and for the operator's rulings.
- **What the operator owes.** The sixteen rulings (#2514), of which the ratchet's scope gates #2530, and W0's setup
  item for Tasks 8 to 11: scratch accounts, a scratch project, a subject session and the consent list, as the W0 plan
  sets out.
- **What to report.** Each piece ends with its pull request merged through the queue, its plan's "Deviations found"
  filled in, and this ledger's row updated on a `ledger/overlord` branch.
