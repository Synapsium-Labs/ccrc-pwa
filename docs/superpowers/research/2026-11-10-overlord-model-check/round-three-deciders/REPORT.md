# Deciders and closed vocabularies of the Overlord design: a check by enumeration

Run against the edition of `docs/superpowers/specs/2026-11-09-overlord-design.md` that #2538 merged. #2539 writes the findings into
the spec, with four replaced by rules of the editor's (F21 and F22 here). Rounds one and two checked the state machines. This round encodes each decider as the
text gives it, enumerates its whole input domain, and reads each closed list against every use.

## 1. Summary

- 50 findings: 2 major, 48 minor, no blocker. Each one is a line a script prints.
- By kind:
  - 16 `total`: an input with no answer;
  - 4 `order`: rows whose order decides the answer, with no order given or an unsafe one;
  - 5 `monotonic`: a worse input moves the answer towards acting or holding;
  - 11 `restated`: two passages give two answers for one input;
  - 14 `vocabulary`: a closed list against its uses.
- The two major findings: a gate row the server disarms stops gating; `renewalDue`, in its table's own order, reads
  a hard trigger as soft.
- What held: `effectiveRung` over 32,768 inputs, the class sets (a class member never turns a refusal into an allow),
  `askOrAct` over 1,296 inputs, Table 3.4c, every bound the text quotes but one example, the 26 moves of Figure 3
  against Table 5.1b, and the refusal words both ways.
- With the proposed rules encoded (`FIX=1`) every script prints no counterexample.

| Script | What it encodes | Domain | Counterexample lines | With the edits |
|---|---|---|---|---|
| `d03_roleof.py` | `roleOf`, its undecided answers, the role columns (§3.3.9) | 864 inputs; 2 undecided answers x 4 readers; 7 roles x the compaction column | 4 | 0 |
| `d02_generation.py` | the generation machine and `renewalDue` (§3.3.11) | 4 failure cases; 20 trigger rows x 7 roles, every set of fired triggers (2^19 - 1 for the Overlord, 255 for a coordinator) | 5 | 0 |
| `d04_reservation.py` | the serviceability answer on a reserved account, the reservation arithmetic, the load lines (§3.4, §6.8) | 3456 guest inputs; 54 Overlord inputs; 4 rows of Table 3.4c | 3 | 0 |
| `d05_readiness.py` | `overlordReadiness`, the retention decider, the breaker (§6.4, §6.7) | 92160 readiness inputs; 11 retention events; 28 trial outcomes | 10 | 0 |
| `d06_askoract.py` | `askOrAct`, its weights, the bounds the text quotes (§6.3, §7.2, §9.5, Table 11.5b) | 1296 inputs | 3 | 0 |
| `d07_class.py` | `itemClassFloor`, the class sets, the settling act of `mayHold` (§6.7) | 720 inputs | 4 | 0 |
| `d08_push.py` | `pushAdmission` (§4.2) | 80 inputs | 2 | 0 |
| `d09_followup.py` | `followUpDue` (§5.4) | 144 inputs; 15 pairs of reasons | 5 | 0 |
| `d10_rank.py` | `decisionRank`, Pause, `effectiveRung` (§6.6, §5.6, §7.5) | 435 pairs of queue rows; 4 rungs x Pause; 32768 ladder inputs | 2 | 0 |
| `d11_mayact.py` | `overlordMayAct`, Table 7.1a, Figure 6, the gate order for the note door (§7.1, §11.2) | 2816 inputs; 33 act kinds and the reads row x 3 rungs; the note door x 4 rungs | 18 | 0 |
| `d13_brief.py` | `answerExamined`, `briefRevealMode` (§6.6) | 259 and 192 inputs | 4 | 0 |
| `d14_states.py` | request, act, proposal and playbook states, boot coherence (§5.1, §10.1, §3.8, §9.7, §7.6) | 10 request states x 4 actors; 60 group inputs; 10 act states; 6 + 6 states; 12 boot inputs | 4 | 0 |
| `v_vocab.py` | the closed vocabularies (Part 2) | 57 refusal words; 10 outcome values and 7 causes; 33 act kinds; 14 readiness words; 13 capability words; 18 paths; 32 measures | 11 | 0 |

*75 counterexample lines in all. Several lines can stand behind one finding, and one line behind a pair of findings.*

Severity. **Major**: a stated rule fails under the text as written, or under its one natural reading, with harm to the
operator or to a rule that guards authority. **Minor**: an input with no answer, an order left open, or two passages
that disagree, with small or bounded harm. A companion edit is minor.

## 2. How to re-run

```
cd model3a
./run_all.sh                 # every check, as written and with FIX=1; output in out/
python3 d05_readiness.py     # one check; a line that starts "CE <tag>:" is a counterexample
FIX=1 python3 d05_readiness.py   # the same check with the proposed rule encoded
```

Python 3, standard library only. The scripts read the spec and write only under `model3a/`. Each rule a script
encodes is tied to its sentence by an `anchor(...)` call, which stops the script if the sentence is not in the spec.
`FIX=1` encodes the proposed rule. It does not re-read an edited spec. The scripts read the edition named in
`common.py`, through `git show`, so they need a checkout that holds that commit.

## 3. What the encodings assume

Where the text left a choice, the script takes the one below. A finding that rests on one says so.

- **An order on the readiness words.** The text gives none. The scripts order the words by what Table 6.7c does to
  holds: takes holds, keeps standing holds, keeps them until the boot re-seed, keeps those that outlast the bound,
  releases all. "Raises the word" means a move up that list.
- **Every `degraded` generation has an unread card or unpassed probes.** Figure 2 draws three edges into `degraded`,
  and each is one of the two.
- **"Within its measured restart time" is a fact of its own,** which can be true of a session that does not measure
  dead. Only the three `restart:` lines of `d05_readiness.py` rest on it.
- **A row let go alone as `deaf` is not "a release"** as §6.4 words it ("the word became"). So `released:deaf` is
  among the trial outcomes with no rule.
- **At a line means past it.** "Refuses Fable when that part reaches 40" is read as at or above.
- **The five-hour line of a guest** is 98 less the whole reserve ("the whole reserve is set aside in it").
- **A command covers every class member** of the question its proposal names, but for the O5 of `state-a-fact`.
- **A grant or a command stands behind a grantable effect only,** and only a question carries a class beyond its
  effect's. Other combinations are left out of `overlordMayAct`'s domain.
- **A console that does not report its events reports none of them.**
- **The monotonic direction of each decider.** Readiness: towards releasing holds. `overlordMayAct`, `askOrAct`,
  `mayHold`: towards refusing, asking, not holding. `followUpDue`: towards the operator being told. A guest's
  placement: towards keeping the reserve. `renewalDue` has no such direction: a fault is what makes a renewal due.

## 4. Findings

Most severe first. No two findings edit the same lines, so they apply in any order. A WHERE line is given whole.
Where an edit touches a table row, OLD and NEW are the whole row. A finding whose PROBLEM starts "Companion" keeps a
second passage in step with the finding before it.

- F1 [major] A gate row the server sends back to shadow stops gating
- F2 [major] `renewalDue` has no stated order, and the table's own order reads a hard trigger as soft
- F3 [minor] The readiness word never reads `degraded`
- F4 [minor] A crash loop reads `renewing`, and a third restart can read `ready`
- F5 [minor] `answerExamined` gives the plain accept no word, and no order between its words
- F6 [minor] A half-open breaker has no rule for most ways its trial hold can end
- F7 [minor] Figure 6 checks the classes of the effect, not the effective class
- F8 [minor] Figure 6 sends every act of class none through the evidence floor and `askOrAct`
- F9 [minor] The prose applies the evidence floor and `askOrAct` to a commanded answer
- F10 [minor] The worked example for `askOrAct` uses a cell no answer has
- F11 [minor] The note door refuses `rung-below` at the `off` rung
- F12 [minor] A triage hold is taken on a row that already carries a member of O1 to O6
- F13 [minor] A `value` item is held when a member of its class has no cover
- F14 [minor] "A missing field is `unknown`" against the `cannot-decide` ask that is held
- F15 [minor] The retention table has no row for the breaker
- F16 [minor] The retention table has no row for the operator speaking to a programme
- F17 [minor] At `off`, a silent request the owner acknowledged is never moved to the operator
- F18 [minor] A `hands-off` programme: no nudge, and nothing said of the move to the operator
- F19 [minor] `followUpDue` names a reason and gives its reasons no order
- F20 [minor] A `blocking-now` the server cannot verify has no answer
- F21 [minor] A `batchable` push with no briefing time meets a spent budget
- F22 [minor] M25's target follows the overdraft rule
- F23 [minor] Pause at `off` raises the rung with no step-up
- F24 [minor] Table 5.6a and `decisionRank` give slack to a fixed date two places
- F25 [minor] `briefRevealMode` gives no order between `blind-sample` and `on-tap`
- F26 [minor] `roleOf` has no answer for a child mark it could not measure, and an undecided role has one reader
- F27 [minor] The compaction column has no text for `auditor` and `replay`
- F28 [minor] A failed `draining` goes back to `active` in the table, to the state it left in the receipt
- F29 [minor] C50 leaves out one of the coordinator's trigger rows
- F30 [minor] A stale context sample: no row says whether a trigger fires
- F31 [minor] An unmeasured five-hour figure admits a guest that a measured one refuses
- F32 [minor] An account with no billing fact has no answer for the Overlord's Fable
- F33 [minor] An unmeasured load has no answer for `mayHold`
- F34 [minor] The operator has no move on a `declined` request, and cannot withdraw a `blocked` one
- F35 [minor] Figure 3 follows the operator's withdraw
- F36 [minor] `drop-request` is called reversible, and no move leaves `dropped`
- F37 [minor] The compensators follow `drop-request`
- F38 [minor] `open-request` has cells only for a request that cites a message
- F39 [minor] The catalogue has no act for an item the Overlord raises
- F40 [minor] The door table follows `raise-item`
- F41 [minor] Table 11.1a names no writer for `voided`
- F42 [minor] Table 11.6 leaves `deaf` out of the causes of `released:<cause>`
- F43 [minor] Table 11.5 leaves two values out of `overlordOutcome`
- F44 [minor] `practice-contradicts` is the practice lane's word, not the door's
- F45 [minor] The witness carries the act journal's head a wave before that journal ships
- F46 [minor] A revoke reads as behind the step-up in §7.2 and not in Table 11.2
- F47 [minor] The tap on a refit that eases a gate is not in the step-up list
- F48 [minor] "M1 shows prompts" cites a measure that does not count prompts
- F49 [minor] M29 leaves out the decision-model calls §6.8 counts in it
- F50 [minor] M32 leaves out the reads with no turn behind them

## model3a:F1 [major]
QUOTE: of each band are watched. Drift sends the row back to shadow.

PROBLEM: `grant.inside` and `scope.widens` fail closed while armed (Table 3.7b). Three rules let the server disarm a row by itself: drift on the anchor set, a changed line key, and the injection canary ("armed only while"). An unarmed row is skipped. So a grant-backed answer that the armed blind check would `defer` is `staged` once drift is detected: a fault moves `overlordMayAct` towards acting, which §11.7 says never happens, and it eases a gate with no tap, which §3.7 calls an authority change. `d11_mayact.py`: `CE DM-drift`.

NEW:
  - **A gate sent back to shadow stays shut.** `scope.widens` and `grant.inside` fail closed while armed. When drift,
    a changed key or the canary sends one back to shadow, it answers as no clear yes until the operator arms it
    again or switches it off. Only the operator's own switch makes a gate skipped.

WHERE:     of each band are watched. Drift sends the row back to shadow.

## model3a:F2 [major]
QUOTE: thresholds are starting values (Table 11.5b).*

PROBLEM: Table 11.7b lists `renewalDue` as a first-match decider. Table 3.3.11b gives its rows and no order. Of the Overlord's 524,287 sets of fired triggers, 259,101 hold a hard row and are answered `soft` in the table's own order. So are 90 of a coordinator's 255. A soft answer waits up to 30 minutes for the preconditions, and for the soft budget, the least age and the hold-off, and `degraded` blocks it. So "an entry it was served was wiped" or "the operator confirmed a restore" waits behind "more than 40 operator messages". `d02_generation.py`: the two `CE RNW-order` lines.

OLD:
*Table 3.3.11b. The renewal triggers. Each row is a row of `renewalDue`'s table for the roles it names. Its
thresholds are starting values (Table 11.5b).*

NEW:
*Table 3.3.11b. The renewal triggers. Each row is a row of `renewalDue`'s table for the roles it names.
`renewalDue` tests the hard rows first, so a renewal is soft only when no hard row fired. Its thresholds are
starting values (Table 11.5b).*

## model3a:F3 [minor]
QUOTE: or has not read its card or passed its probes. A pending designation

PROBLEM: Table 6.4a tests `renewing` before `degraded`, and its second clause matches every `degraded` generation: each way into `degraded` (Figure 2) is a card not read or probes not passed. So the word `degraded` is never answered, and `not-ready:degraded` and Table 6.7c's `degraded` cause are dead words. The holds are still released, because a degraded generation caps the rung at `chat` (Table 7.5a) and Table 6.7c releases them as `released:rung`. What is lost: the place shows "renewing" for a state that only Renew now or a hard trigger ends, and M16 counts no minute of `degraded`. `d05_readiness.py`: `CE RDY-unreachable`, the two `CE RDY-degraded` lines.

OLD:
| `renewing` | Its generation is in `draining`, `checkpointed`, `clearing`, `carded` or `probing` (§3.3.11), or has not read its card or passed its probes. A pending designation reads `renewing`, through generation 1's state |

NEW:
| `renewing` | Its generation is in `draining`, `checkpointed`, `clearing`, `carded` or `probing` (§3.3.11), or is not `degraded` and has not read its card or passed its probes. A pending designation reads `renewing`, through generation 1's state |

## model3a:F4 [minor]
QUOTE: It measures dead, and neither `restarting` nor `renewing` (below) matches.

PROBLEM: Every start mints a generation at `carded`, a crash restart included. `dead` yields to `renewing`, so a session that crashes again before it reads its card reads `renewing`, and its long holds are kept. §3.4 says "A crash loop therefore cannot keep holds standing." Also, `restarting` needs "at most twice in the last hour": if the restart time can be read for a session that does not measure dead, a third restart un-matches the row and the word can fall through to `ready`. `d05_readiness.py`: `CE RDY-crashloop`, and the three `CE RDY-monotonic` lines that start `restart:` (they rest on that one assumption).

OLD:
| `dead` | It measures dead, and neither `restarting` nor `renewing` (below) matches. So a swap landing or a crash restart within its bounds reads `restarting`, and a renewal reads `renewing`, never `dead` |

NEW:
| `dead` | It measures dead, or it is within its measured restart time after a third restart in the last hour; and neither `restarting` nor a renewal the lane started (`renewing`, below) matches. So a swap landing or a crash restart within its bounds reads `restarting`, and a renewal reads `renewing`, never `dead`. A third restart in the hour reads `dead`, whatever state its last generation reached |

## model3a:F5 [minor]
QUOTE: - `glanced`: a tap from a push, or a bulk Seen.

PROBLEM: The decider "answers one word". Seven of 259 inputs get none: the operator opens the item in the console, reads the brief and taps the recommended option, with no edit and no other option's downsides opened. That is the common case. In 178 inputs two or three bullets match and no order is given. A tap from a push that picks another option is a disagreement: read as `glanced` it leaves every count. The gates of §9.5 count these words, so the default must be the one that counts for nothing. `d13_brief.py`: `CE EXM-none` (two lines), `CE EXM-order`.

OLD:
  - `glanced`: a tap from a push, or a bulk Seen.
  - `blind`: answered before the reveal in `blind-sample` mode.
  - `unmeasured`: an older console that does not report the events.

NEW:
  - `glanced`: any other answer, a tap from a push and a bulk Seen included.
  - `blind`: answered before the reveal in `blind-sample` mode.
  - `unmeasured`: an older console that does not report the events.
  - The first match wins: `unmeasured`, `blind`, `examined`, then `glanced`. So a plain accept of the recommendation
    is `glanced`, and a tap from a push that picks another option is `examined`: a disagreement always counts.

## model3a:F6 [minor]
QUOTE: (the operator answered early, or the row was withdrawn) gives the trial back.

PROBLEM: §6.4 gives the trial four ends: served, a lapse, a release (the word became `wedged`, `dialog-open` or `deaf`), void. `overlordOutcome` has 28 values once its words and causes are written out, and 19 match none of the four: `staged`, `server-gap`, `not-ready:` with ten other words, and every `released:` cause. After one of them the breaker neither closes, opens nor gets its trial back, so no hold is ever taken again. `d05_readiness.py`: `CE BRK-trial`.

OLD:
  - **Half-open admits one trial hold.** Served closes it: the Overlord answered, escalated or returned the row before
    its deadline. A lapse or a release opens it again with the next wait: 10, 20, then 40 minutes, capped at 40. Void
    (the operator answered early, or the row was withdrawn) gives the trial back.

NEW:
  - **Half-open admits one trial hold.** Served closes it: the Overlord answered, staged, escalated or returned the
    row before its deadline. A lapse or a release opens it again with the next wait: 10, 20, then 40 minutes, capped
    at 40. A row let go alone as `deaf` is a release too. Void gives the trial back: the hold ended any other way,
    as when the operator answered early, the row was withdrawn, the server was down, or a cause the Overlord did
    not make released it.

## model3a:F7 [minor]
QUOTE: D{"Is every class member<br/>of the effect covered?"}

PROBLEM: §6.7: "An act needs every member covered", where the members are the effective class, a union of five sets. Figure 6 asks only about the class of the effect. A question whose effective class has a member the effect lacks (a stated O2 beside an `approve-spec` effect, an `unknown`, a lineage member) is `operator-only` by the prose and `staged`, `defer` or `allow` by the figure. `d11_mayact.py`: the `CE ACT-fig6` lines that start "the prose answers `operator-only`".

OLD:
  C -- "allow" --> D{"Is every class member<br/>of the effect covered?"}

NEW:
  C -- "allow" --> D{"Is every member of the<br/>effective class covered?"}

## model3a:F8 [minor]
QUOTE: D -- "class none" --> E{"Evidence strong enough<br/>for this act?"}

PROBLEM: Table 11.6 gives `ask-is-cheaper` and `evidence-too-weak` to the answer doors, and §6.5 says relays and follow-up run on day one, when "every cell asks". Figure 6 draws every class-none act through both checks, so a relay or a note with no record is refused `ask-is-cheaper`. The same edges skip the identity check: §7.1 refuses `identity-too-weak` "when the caller is weaker than the effect or the grant needs", and the figure asks it only under a grant or a command. `d11_mayact.py`: the `CE ACT-fig6` lines that start "the prose answers `allow`" and "the prose answers `identity-too-weak`", and the `note` on day one.

OLD:
  D -- "class none" --> E{"Evidence strong enough<br/>for this act?"}
  D -- "state-a-fact: a cited stated entry<br/>resting on an operator message" --> E

NEW:
  D -- "class none, or state-a-fact by a cited stated entry<br/>resting on an operator message" --> H{"Identity strong enough<br/>for the effect?"}
  H -- "no" --> IW
  H -- "yes, and not an answer" --> AL
  H -- "yes, an answer" --> E{"Evidence strong enough<br/>for this answer?"}

## model3a:F9 [minor]
QUOTE: - `ask-is-cheaper`, from `askOrAct` (§6.3);

PROBLEM: Figure 6 lets a command through after the identity check: "allow, the command is spent". The list in §7.1 states `ask-is-cheaper` and `evidence-too-weak` with no exception, so a commanded answer with no record in its cell, or with inferred evidence, is refused and the Overlord escalates a matter the operator has just ruled. `d11_mayact.py`: `CE ACT-fig6` "the prose answers `ask-is-cheaper`, Figure 6 answers `allow`" and "the prose answers `evidence-too-weak`, Figure 6 answers `allow`".

OLD:
  - `ask-is-cheaper`, from `askOrAct` (§6.3);
  - `evidence-too-weak`, when a big answer, or any answer whose effect carries a class, rests only on inferred
    evidence or none (§6.3);

NEW:
  - `ask-is-cheaper`, from `askOrAct` (§6.3), for an answer with no command behind it;
  - `evidence-too-weak`, when a big answer, or any answer whose effect carries a class, rests only on inferred
    evidence or none (§6.3), and no command stands behind it;

## model3a:F10 [minor]
QUOTE: a routine, reversible answer on a batchable row needs a disagreement bound of at

PROBLEM: `askOrAct` gates answers only (Table 11.6), and every answer is "compensable at least" (Table 7.1a, §6.7). So no answer reads the `reversible` weights 7 and 20, and "a routine, reversible answer" needing "about twenty" blind answers does not exist. A routine answer weighs 20: a bound of 0.05, 59 blind answers with none overturned on a batchable row, 39 on a `blocking-by` row, 29 when it blocks now. The other figures of the paragraph check out. `d06_askoract.py`: `CE ASK-example`, the two `CE ASK-unreachable` lines.

OLD:
With these weights and `lambda` at 1, a routine, reversible answer on a batchable row needs a disagreement bound of at
most 0.14, about twenty blind answers with none overturned. A big, compensable answer needs at most 0.017 on a
batchable row, about 180 such answers, and 0.033 when the row blocks now, about ninety.

NEW:
With these weights and `lambda` at 1, a routine answer on a batchable row needs a disagreement bound of at most 0.05,
about sixty blind answers with none overturned: every answer is compensable at least (§7.1). A big answer needs at
most 0.017 on a batchable row, about 180 such answers, and 0.033 when the row blocks now, about ninety. No answer is
reversible, so no act reads the two `reversible` weights in version 1.

## model3a:F11 [minor]
QUOTE: so a generation can finish starting. From `draining` to

PROBLEM: §3.2 and §7.5: at `off` every door refuses "except the card, probe and note doors". Those doors skip steps 3, 4, 6, 8 and 9. They do not skip step 10, "the rung, by act kind", and Table 7.1a has no cell for `off`: `write-note` needs `chat`. So the note door answers `rung-below` at `off`. `d11_mayact.py`: `CE ACT-off`.

OLD:
- **The card, probe and note doors skip** steps 3, 4, 6, 8 and 9 (`authority-rolled-back`, `overlord-off`,
  `launch-profile-unmet`, `card-unread` and `renewing`), so a generation can finish starting. From `draining` to

NEW:
- **The card, probe and note doors skip** steps 3, 4, 6, 8 and 9 (`authority-rolled-back`, `overlord-off`,
  `launch-profile-unmet`, `card-unread` and `renewing`), so a generation can finish starting. At the `off` rung
  they skip the rung of step 10 too, because Table 7.1a has no cell for `off`. From `draining` to

## model3a:F12 [minor]
QUOTE: | a `decide` item with class `unknown` | yes, a triage hold of 5 minutes |

PROBLEM: A `decide` item with no class in a lineage that reached O3, or with a class the decision model raised, has the class `unknown` and that member. Table 6.7b's second row holds it for 5 minutes and its last row sends it to the operator at once; the table gives no order. Under the second row, adding `unknown` to a classed item turns "not held" into "held", and the hold delays a question that is already the operator's. `d07_class.py`: `CE CLS-triage`, `CE CLS-add`.

OLD:
| a `decide` item with class `unknown` | yes, a triage hold of 5 minutes | escalate with a brief, or return as over-asked |

NEW:
| a `decide` item whose whole class is `unknown` | yes, a triage hold of 5 minutes | escalate with a brief, or return as over-asked |

## model3a:F13 [minor]
QUOTE: | a `value` item with a cited entry that is `stated`, rests on an operator message, is not retired, and has the item's subject | yes |

PROBLEM: Table 6.7b holds a `value` item whenever the entry exists. Its class can hold more than O5: a stated O2, a raise, a lineage member, or `unknown` when the field was left out. `state-a-fact` then answers `operator-only`, so the hold can only end in an escalation, which H18 says it must not. `d07_class.py`: `CE CLS-held` (38 of 720 inputs).

OLD:
| a `value` item with a cited entry that is `stated`, rests on an operator message, is not retired, and has the item's subject | yes | `state-a-fact`, escalate. No grant covers `state-a-fact`: that entry is its one cover |

NEW:
| a `value` item whose whole class is O5, with a cited entry that is `stated`, rests on an operator message, is not retired, and has the item's subject | yes | `state-a-fact`, escalate. No grant covers `state-a-fact`: that entry is its one cover |

## model3a:F14 [minor]
QUOTE: item or an ask is `none`, or a set of O1 to O6. A missing field is `unknown`.

PROBLEM: The sentence covers items and asks. Table 6.7a and Table 6.1a give an ask released `cannot-decide` the class none and hold it, and clause 22 asks a coordinator for the reason on a release, not for a class. Read by the sentence, such an ask with no `operatorClass` has the class `unknown` and is never held. The release reason is the coordinator's own statement that the matter is not operator-only. `d07_class.py`: `CE CLS-missing`.

OLD:
    item or an ask is `none`, or a set of O1 to O6. A missing field is `unknown`.

NEW:
    item or an ask is `none`, or a set of O1 to O6. A missing field is `unknown`. One exception: an ask released
    `cannot-decide` with no class named states none by its release reason (Table 6.7a).

## model3a:F15 [minor]
QUOTE: | the 85% load line is crossed (Table 6.8a) | no item hold | kept to their deadlines |

PROBLEM: The Retention sentence asks the table "on every event that can change a part of `mayHold`" and names the breaker. Table 6.7c has no row for it, so what an opening breaker does to standing holds is not stated. Kept is the reading that needs no new cause word, and each kept row still reaches the operator by its deadline (I1). Releasing them is the other reading: it needs a cause `breaker` in §6.1 and Table 11.6. `d05_readiness.py`: the first `CE RET-norow`.

NEW:
| the breaker opens (§6.4) | none | kept to their deadlines |

WHERE: | the 85% load line is crossed (Table 6.8a) | no item hold | kept to their deadlines |

## model3a:F16 [minor]
QUOTE: engagement leaves `full` (`engagement`) | none of that scope | those released |

PROBLEM: `mayHold` needs "the operator is not at that programme", and §7.5 says the programme's holds "pause" for 30 minutes. Neither Table 6.7c nor the Retention sentence says what the mark does to holds already standing. The operator is at that coordinator, so releasing them is the reading towards the operator. `d05_readiness.py`: the second `CE RET-norow`.

OLD:
| the rung leaves `full` (`rung`), a kind is disarmed (`disarmed`), engagement leaves `full` (`engagement`) | none of that scope | those released |

NEW:
| the rung leaves `full` (`rung`), a kind is disarmed (`disarmed`), engagement leaves `full` or the operator speaks to that programme (`engagement`) | none of that scope | those released |

## model3a:F17 [minor]
QUOTE: - **The `off` rung stops every nudge,**

PROBLEM: At `chat` a follow-up that comes due moves its request to `needs-you`. At `off` the nudges stop and only requests the owner has not acknowledged move. An `in-progress` request whose clock comes due at `off` gets no nudge and no move: a lower rung tells the operator less than a higher one. `d09_followup.py`: `CE FUP-silent` "the `off` rung", `CE FUP-monotonic`.

OLD:
  - **The `off` rung stops every nudge,** and moves each open request whose owner has not acknowledged to `needs-you`,
    in one transaction (§7.5).

NEW:
  - **The `off` rung stops every nudge,** and moves each open request whose owner has not acknowledged to `needs-you`,
    in one transaction (§7.5). A follow-up that comes due at `off` moves its request to `needs-you` too, as at
    `chat`.

## model3a:F18 [minor]
QUOTE: `hands-off` programme gets no follow-up nudges. From W3

PROBLEM: A `hands-off` programme still takes a relay that cites an operator message. "After two nudges with no measured movement" the server moves a request to `needs-you`; if the arm sends no nudge for such a programme, that count never comes and a silent request stays `routed` for good. The text does not say the clock still runs. `d09_followup.py`: the two `CE FUP-silent` lines for a `hands-off` programme.

OLD:
    `hands-off` programme gets no follow-up nudges. From W3, when the operator speaks to a programme's coordinator from

NEW:
    `hands-off` programme gets no follow-up nudges: a follow-up that comes due there moves its request to
    `needs-you`, as at `chat`. From W3, when the operator speaks to a programme's coordinator from

## model3a:F19 [minor]
QUOTE: run, a dead coordinator, a stall rung repeated, and the nudges so far. The nudge names its reason.

PROBLEM: Table 11.7b lists `followUpDue` as a first-match decider. §5.4 lists six reasons, and any two can hold together. In the order listed, "no acknowledgement" names the nudge of a request whose coordinator is dead, and the Overlord nudges a dead owner instead of re-kicking or routing elsewhere. `d09_followup.py`: `CE FUP-order`.

OLD:
  - **One L1 decider, `followUpDue`, decides a nudge.** Its inputs: no acknowledgement, no news, no linked work, a quiet
    run, a dead coordinator, a stall rung repeated, and the nudges so far. The nudge names its reason.

NEW:
  - **One L1 decider, `followUpDue`, decides a nudge.** Its inputs: no acknowledgement, no news, no linked work, a quiet
    run, a dead coordinator, a stall rung repeated, and the nudges so far. The nudge names its reason: the first
    that holds, in this order: a dead coordinator, a stall rung repeated, no acknowledgement, a quiet run, no
    linked work, no news.

## model3a:F20 [minor]
QUOTE: | `blocking-now` | None: it pushes at once | The server measures a run or a hold waiting behind the item |

PROBLEM: Table 4.2a says when each urgency is accepted. For a `blocking-now` with no run or hold measured behind the item it does not say what the escalate door does: no refusal word exists for it and no other urgency is named. `d08_push.py`: `CE PUSH-none` (16 of 80 inputs).

OLD:
| `blocking-now` | None: it pushes at once | The server measures a run or a hold waiting behind the item |

NEW:
| `blocking-now` | None: it pushes at once | The server measures a run or a hold waiting behind the item. Otherwise the escalation is recorded as `batchable`, and the coordinator's own level stands |

## model3a:F21 [minor]
QUOTE: - **A spent budget lets through a verified `blocking-now`, and a `blocking-by` at its deferral limit.**

PROBLEM: With no briefing time set a `batchable` push "is not deferred", and "nothing defers a push past its limit" (I2 says the same). A spent budget lets through two other kinds only. The two rules give two answers. `d08_push.py`: `CE PUSH-clash`. Its `note` shows what the first rule already costs: with no briefing time set, the least urgent push goes out in quiet hours while a `blocking-by` push waits for its limit.

OLD:
- **A spent budget lets through a verified `blocking-now`, and a `blocking-by` at its deferral limit.** Each such
  push is logged as an overdraft, with its cause.

NEW:
- **A spent budget lets through a verified `blocking-now`, a `blocking-by` at its deferral limit, and a `batchable`
  push with no briefing time to wait for.** Each such push is logged as an overdraft, with its cause.

## model3a:F22 [minor]
QUOTE: Within the budget; every overdraft a verified `blocking-now` or a `blocking-by` at its deferral limit

PROBLEM: Companion to the finding before it: M25's target names the two overdrafts §4.2 allowed. `d08_push.py`: `CE PUSH-clash`.

OLD:
| M25 | Attention: interrupting pushes per active day against the budget, overdrafts and their causes, minutes deferred | Within the budget; every overdraft a verified `blocking-now` or a `blocking-by` at its deferral limit | `pushAdmission`'s records |

NEW:
| M25 | Attention: interrupting pushes per active day against the budget, overdrafts and their causes, minutes deferred | Within the budget; every overdraft a verified `blocking-now`, a `blocking-by` at its deferral limit, or a `batchable` with no briefing time set | `pushAdmission`'s records |

## model3a:F23 [minor]
QUOTE: `operatorRung` becomes `chat`. Every hold is released as

PROBLEM: Pause needs no step-up "because it only lowers autonomy". As written it sets `operatorRung` to `chat`, which from `off` is a rung up, and §7.5 says a rung up keeps the step-up. `d10_rank.py`: `CE LADDER-pause`.

OLD:
- **Pause.** One tap on the Overlord place, with no step-up. `operatorRung` becomes `chat`. Every hold is released as

NEW:
- **Pause.** One tap on the Overlord place, with no step-up. `operatorRung` becomes `chat`, and stays `off` where it
  is `off`: Pause never raises a rung. Every hold is released as

## model3a:F24 [minor]
QUOTE: The decision queue ranks it by its slack to that date.

PROBLEM: §6.6 ranks by `expedite` and blocking-now, then rank weight times blocked hours, then slack. Table 5.6a says a `fixed-date` programme's rows are ranked by slack. In 12 of 435 pairs a `fixed-date` row ranks under a `standard` or `background` row however close its date, and Table 5.6a gives no scale to set slack against blocked hours. In 45 pairs two `fixed-date` rows come out in the other order than their slack gives. `d10_rank.py`: `CE RANK-fixed`.

OLD:
| `fixed-date` | Carries a fixed date. The decision queue ranks it by its slack to that date. Counts against `portfolioFocus` |

NEW:
| `fixed-date` | Carries a fixed date. Its slack to that date is the decision queue's third sort key, after rank weight times blocked hours (§6.6). Counts against `portfolioFocus` |

## model3a:F25 [minor]
QUOTE: One L1 decider, `briefRevealMode`, picks one of three modes.

PROBLEM: The server samples about one brief in eight for `blind-sample`. In 95 of 192 inputs the sampled row is also O3, a start, thin, disputed or under the fatigue rule, which is `on-tap`. `on-tap` shows the recommendation after a tap, before the answer, so the answer would not be blind. `d13_brief.py`: `CE BRF-order`.

OLD:
- **How much of the brief is shown first.** One L1 decider, `briefRevealMode`, picks one of three modes.

NEW:
- **How much of the brief is shown first.** One L1 decider, `briefRevealMode`, picks one of three modes. The first
  match wins: `blind-sample`, then `on-tap`, then `shown`.

## model3a:F26 [minor]
QUOTE: undecided between `worker` and `reviewer`. A claim or an intent that could not be measured, with no measured yes

PROBLEM: §3.3.9 types an unreadable mark. The tree tells unreadable from unmeasured (§3.6), and a mark the agent did not answer for gets no answer: 18 of 864 inputs. And only the `SessionRole` view is given for an undecided answer. `coordinator` is long-lived and `plain` is not, so `renewalDue`, `MAIL_PACE` and the card have no row to read. Read as `coordinator`, a renewal ends the conversation of a session that may be `plain`. `d03_roleof.py`: `CE ROLE-none`, `CE ROLE-undecided`.

OLD:
  - **An undecided answer is typed.** An unreadable child mark, or a child of a run whose kind is unknown, reads as
    undecided between `worker` and `reviewer`. A claim or an intent that could not be measured, with no measured yes
    beside it, reads as undecided between `coordinator` and `plain`. The members of each undecided answer share one
    `SessionRole` view, so the roll lane and the hook still get one answer.

NEW:
  - **An undecided answer is typed.** An unreadable child mark, a child mark that could not be measured, or a child
    of a run whose kind is unknown, reads as undecided between `worker` and `reviewer`. A claim or an intent that
    could not be measured, with no measured yes beside it, reads as undecided between `coordinator` and `plain`.
    The members of each undecided answer share one `SessionRole` view, so the roll lane and the hook still get one
    answer. Every other reader takes the member that does less: no renewal starts on an undecided answer, it takes
    the slower mail pace, and its card says which fact could not be measured.

## model3a:F27 [minor]
QUOTE: `coordinator`, `worker`, `reviewer` and `plain`. The auto-compact lane types `/compact` followed by them.

PROBLEM: The compaction instructions are a column of `FLEET_ROLES`, which has seven roles, and C51 gives "every session" instructions. The text names five. `d03_roleof.py`: the two `CE ROLE-compact` lines.

OLD:
    `coordinator`, `worker`, `reviewer` and `plain`. The auto-compact lane types `/compact` followed by them. The same

NEW:
    `coordinator`, `worker`, `reviewer` and `plain`. `auditor` and `replay` take the `plain` text. The auto-compact
    lane types `/compact` followed by them. The same

## model3a:F28 [minor]
QUOTE: | 120, then back to `active` with a hold-off. Outside the budget |

PROBLEM: A renewal can begin in `degraded` (a hard trigger, or Renew now). The receipt says a failure before the first half returns the generation "to the state it left: `active` with a hold-off, or `degraded` if the renewal began there". Table 3.3.11a sends a timed-out `draining` to `active`, which is the fault round one found: a generation `active` with no card read. Figure 2 draws both failure edges to `active` too. `d02_generation.py`: `CE GEN-back` and the `note` under it.

OLD:
| `draining` | No new hold is taken (the readiness word reads `renewing`). Standing holds are kept or released by the retention table (§6.7). The mail gate holds deliveries, and delivered but unacknowledged ones are queued again. The lane waits until no reader is running | 120, then back to `active` with a hold-off. Outside the budget |

NEW:
| `draining` | No new hold is taken (the readiness word reads `renewing`). Standing holds are kept or released by the retention table (§6.7). The mail gate holds deliveries, and delivered but unacknowledged ones are queued again. The lane waits until no reader is running | 120, then back to the state it left: `active` with a hold-off, or `degraded`. Outside the budget |

## model3a:F29 [minor]
QUOTE: a resumed long conversation, and a wave boundary above a quarter of the hard cap.

PROBLEM: Table 3.3.11b gives a coordinator eight rows. C50 in Table 13a lists seven: "a proactive compaction the PreCompact arm refused" (soft) is missing. `d02_generation.py`: `CE RNW-c50`.

OLD:
| C50 | Coordinator renewal | none, the Overlord's triggers, their own | Their own rows of the trigger table: the hard cap, two compactions, a failed probe, a new install, not local, a resumed long conversation, and a wave boundary above a quarter of the hard cap. No coordinator renewal starts while the Overlord's generation is outside `active`. Their doors carry no fence | Proposed | H12, H13 |

NEW:
| C50 | Coordinator renewal | none, the Overlord's triggers, their own | Their own rows of the trigger table: the hard cap, two compactions, a failed probe, a new install, not local, a resumed long conversation, a refused proactive compaction, and a wave boundary above a quarter of the hard cap. No coordinator renewal starts while the Overlord's generation is outside `active`. Their doors carry no fence | Proposed | H12, H13 |

## model3a:F30 [minor]
QUOTE: | the statusline sidecar | the statusline script | context tokens, window, model id | unmeasured |

PROBLEM: Five trigger rows read the context sample. For a stale one Table 3.3.11b says "unmeasured, never below" and Table 3.6a says "unmeasured". Neither says whether the row fires. The two journals in the next rows say "that trigger is blind". A hard row cannot fire on it: hard ignores the budget, so every new generation would renew again. The daily backstop and the two-compactions row bound the wait. `d02_generation.py`: `CE RNW-stale`.

OLD:
| the statusline sidecar | the statusline script | context tokens, window, model id | unmeasured |

NEW:
| the statusline sidecar | the statusline script | context tokens, window, model id | unmeasured: the triggers that read the context are blind |

## model3a:F31 [minor]
QUOTE: - An unmeasured seven-day figure admits no new guest there:

PROBLEM: The reservation sets the whole reserve aside in the five-hour window. An unmeasured seven-day figure refuses a new guest, "a stated exception to unmeasured never refuses, in the safe direction for the reserve". The five-hour figure has no such sentence, so by the tree's rule a guest refused at a measured five-hour figure of 58 is admitted when the figure is unmeasured. `d04_reservation.py`: `CE RSV-monotonic` (294 input pairs).

OLD:
    - An unmeasured seven-day figure admits no new guest there: for a guest's placement the reservation arm answers
      `unservable`, with the reason `reserved`. That is a stated exception to "unmeasured never refuses", in the safe

NEW:
    - An unmeasured seven-day or five-hour figure admits no new guest there: for a guest's placement the reservation
      arm answers `unservable`, with the reason `reserved`. That is a stated exception to "unmeasured never refuses",
      in the safe

## model3a:F32 [minor]
QUOTE: - A billing fact for each account, a roster field:

PROBLEM: The billing fact is a new roster field. "Credits" is unservable, because it is spend (O2). A lane with no continuity record refuses. An account whose roster entry has no billing fact is given no answer, and an older roster has none. `d04_reservation.py`: `CE RSV-billing`.

OLD:
    - A billing fact for each account, a roster field: where an account bills Fable to usage credits, Fable is
      unservable for the Overlord, because that is spend (O2).

NEW:
    - A billing fact for each account, a roster field: where an account bills Fable to usage credits, Fable is
      unservable for the Overlord, because that is spend (O2). An account with no billing fact reads as billing
      Fable to credits.

## model3a:F33 [minor]
QUOTE: on the least-loaded account that can serve the Overlord now, as the higher of its five-hour and weekly figures.

PROBLEM: `mayHold` needs the accounts "under the load line that stops this row". Table 6.8a gives 70, 85 and 95, and nothing says what an unmeasured figure reads as. By the tree's "unmeasured never refuses" an item hold is taken on an account whose load is unknown. Stopping item holds is the reading towards the operator; capping the rung on a missing sample would cost availability for no safety. `d04_reservation.py`: `CE LOAD-unmeasured`.

OLD:
- **The load lines.** They read the limits the fleet already measures, and `poolRunway` (§3.4). A line is measured
  on the least-loaded account that can serve the Overlord now, as the higher of its five-hour and weekly figures.

NEW:
- **The load lines.** They read the limits the fleet already measures, and `poolRunway` (§3.4). A line is measured
  on the least-loaded account that can serve the Overlord now, as the higher of its five-hour and weekly figures.
  An unmeasured load stops item holds, as the 85% line does, and caps no rung.

## model3a:F34 [minor]
QUOTE: withdraw (to `dropped` from `received`, `routed`, `in-progress`, `needs-you` or `done-unverified`)

PROBLEM: Table 4b draws a `declined` request under "Needs you", the group for what the operator must do next. Table 5.1b gives the operator no move from `declined`: answer, take, hand back, confirm and withdraw all start elsewhere. From `blocked` the operator can only take. A withdraw only lowers what is in flight. `d14_states.py`: `CE REQ-operator`, the two `CE REQ-withdraw` lines.

OLD:
| the operator | answer (`needs-you` to `in-progress`, for a request its owner has acknowledged that reached `needs-you` any other way than a take; for any other such request the answer is recorded and it stays `needs-you` for the Overlord to route); take (`routed`, `in-progress` or `blocked` to `needs-you`, recording that state in `takenFrom`, with the reason `operator-took-it` on the move's news row); hand back (`needs-you` to the state in `takenFrom`, which it clears); confirm (`done-unverified` to `done`); withdraw (to `dropped` from `received`, `routed`, `in-progress`, `needs-you` or `done-unverified`) |

NEW:
| the operator | answer (`needs-you` to `in-progress`, for a request its owner has acknowledged that reached `needs-you` any other way than a take; for any other such request the answer is recorded and it stays `needs-you` for the Overlord to route); take (`routed`, `in-progress` or `blocked` to `needs-you`, recording that state in `takenFrom`, with the reason `operator-took-it` on the move's news row); hand back (`needs-you` to the state in `takenFrom`, which it clears); confirm (`done-unverified` to `done`); withdraw (to `dropped` from any state that is not terminal) |

## model3a:F35 [minor]
QUOTE:   declined --> dropped: dropped

PROBLEM: Companion to the finding before it: Figure 3 draws the withdraw from every state Table 5.1b names. `d14_states.py`: the check "Table 5.1b and Figure 3 draw the same moves" stays green only with both edits.

OLD:
  declined --> dropped: dropped

NEW:
  declined --> dropped: dropped or withdrawn
  blocked --> dropped: withdrawn

## model3a:F36 [minor]
QUOTE: `relay` compensable; `drop-request` reversible, but reopening is a new request; the others reversible

PROBLEM: §10.1: reversible means "an overturn restores the before-state". §5.1: "No move leaves a terminal state", and reopening is a new request. By §10.1's own words a drop is compensable, and a compensable kind must name its compensator. `d11_mayact.py`: `CE ACT-drop`.

OLD:
| `relay`, `close-request`, `drop-request`, `attach-brief`, `escalate`, `return-over-asked`, `object`, `propose-grant`, `propose-command`, `propose-retire`, `propose-practice` | Route, report, brief and propose | none | `relay` compensable; `drop-request` reversible, but reopening is a new request; the others reversible | n/a | refuse | allow | allow |

NEW:
| `relay`, `close-request`, `drop-request`, `attach-brief`, `escalate`, `return-over-asked`, `object`, `propose-grant`, `propose-command`, `propose-retire`, `propose-practice` | Route, report, brief and propose | none | `relay` and `drop-request` compensable: a drop is undone only by a new request that names the old one; the others reversible | n/a | refuse | allow | allow |

## model3a:F37 [minor]
QUOTE: a start. A re-kick's is a correction mail to the same coordinator, as for a relay.

PROBLEM: Companion to the finding before it: "Each compensable kind names its compensator. A test fails if one is missing." `d11_mayact.py`: `CE ACT-drop`.

OLD:
  a start. A re-kick's is a correction mail to the same coordinator, as for a relay. `deploy` is refused at every
  rung in version 1, so it names none, and the test skips a kind refused at every rung.

NEW:
  a start. A re-kick's is a correction mail to the same coordinator, as for a relay. A drop's is a new request that
  names the old one. `deploy` is refused at every rung in version 1, so it names none, and the test skips a kind
  refused at every rung.

## model3a:F38 [minor]
QUOTE: `open-request` (for an operator message)

PROBLEM: §5.1: "A request with no message is the Overlord's own", with `origin: overlord`. Table 7.1a gives `open-request` its cells "for an operator message", so that act has no cell at any rung. It keeps a record and reaches no session until a relay, which `chat` refuses. `d11_mayact.py`: `CE ACT-openreq`.

OLD:
| `write-note`, `acknowledge`, `open-request` (for an operator message), `model-write` (propose or change an entry), `seal-prediction` | Keep its own records | none | reversible | n/a | allow | allow | allow |

NEW:
| `write-note`, `acknowledge`, `open-request` (citing an operator message, or none for a request of its own), `model-write` (propose or change an entry), `seal-prediction` | Keep its own records | none | reversible | n/a | allow | allow | allow |

## model3a:F39 [minor]
QUOTE: | `nudge-owner` | Mail the owner of a routed request a follow-up.

PROBLEM: Three sentences have the Overlord raise an item: with Restart and Reassign controls (§7.1, §8.1), and to suggest retiring a session it did not start (§8.1). Table 7.1a has no kind for it. `escalate` and `attach-brief` act on a row that exists, and §3.8 refuses the designated session on the item-raise lane. "An act missing from the table cannot be performed by any Overlord door." The other way out is to reword the three sentences. `v_vocab.py`: the first `CE VOC-act`.

NEW:
| `raise-item` | Raise an operator item of its own, with a brief, under the item actor `overlord`. The server draws its controls | none | reversible | n/a | refuse | allow | allow |

WHERE: | `nudge-owner` | Mail the owner of a routed request a follow-up. It is served by the relay door, under the relay's egress checks and ceilings. It carries no operator quote and spends no request authority | none | reversible | n/a | refuse | allow | allow |

## model3a:F40 [minor]
QUOTE: the escalate doors; `attach-brief`, `return-over-asked`, `state-a-fact` |

PROBLEM: Companion to the finding before it: every act kind is served by a door of Table 11.1e. `v_vocab.py`: the first `CE VOC-act`.

OLD:
| Answer and escalate: `POST /api/overlord/items/:id/answer`, `POST /api/overlord/questions/:id/answer`, the escalate doors; `attach-brief`, `return-over-asked`, `state-a-fact` | C6, L4 | the question rows, act rows | each its own | n/a | W3 | n/a | No route |

NEW:
| Answer and escalate: `POST /api/overlord/items/:id/answer`, `POST /api/overlord/questions/:id/answer`, the escalate doors; `attach-brief`, `return-over-asked`, `state-a-fact`, `raise-item` | C6, L4 | the question rows, act rows | each its own | n/a | W3 | n/a | No route |

## model3a:F41 [minor]
QUOTE: Staged moves: the veto clock, Veto and Answer now.

PROBLEM: Table 10.1b gives a staged act four exits. Table 11.1a names the writers of three. `voided` is written, by §7.2, "in the transaction that makes the change" (a latch, a revocation, an expiry, a lower rung, a raised term, the mint of a later generation), at the commit when the blind check finds no clear yes, and at eight hours. `preempted` is also written by the operator's ordinary answer. `d14_states.py`: `CE ACTSTATE-writer`.

OLD:
| `overlord_acts` | C5, L3 | `coord.db`, projecting the act journal | The row and the Overlord's fields: its act door. State after `pending`: the settling lane and the boot pass. Staged moves: the veto clock, Veto and Answer now. Outcome: the correction door. `seenAt`: the Seen door. `dependsSince`: the settling lane. `divergedAt`: the restore pass | The boot pass and the settling lane | W2 | yes; the restore pass sets `divergedAt` on each act the act journal holds after the snapshot | Ignores it |

NEW:
| `overlord_acts` | C5, L3 | `coord.db`, projecting the act journal | The row and the Overlord's fields: its act door. State after `pending`: the settling lane and the boot pass. Staged moves: the veto clock (`effective`, or `voided` at the commit), Veto, the operator's answer (Answer now included), the eight-hour fallback, and each transaction that changes authority or mints a later generation (`voided`). Outcome: the correction door. `seenAt`: the Seen door. `dependsSince`: the settling lane. `divergedAt`: the restore pass | The boot pass and the settling lane | W2 | yes; the restore pass sets `divergedAt` on each act the act journal holds after the snapshot | Ignores it |

## model3a:F42 [minor]
QUOTE: let a standing hold go: `rung`, `disarmed`, `engagement`, `class-raised`, `grant-ended` or `bypassed`

PROBLEM: §6.1 lists seven causes and Table 6.7c brackets seven: a row let go alone as `deaf` is `released:deaf`. Table 11.6 lists six, and the L0 list is generated from that table. `v_vocab.py`: the second `CE VOC-outcome`.

OLD:
| `released:<cause>` | A hold's release reason | A cause of Table 6.7c other than a readiness word let a standing hold go: `rung`, `disarmed`, `engagement`, `class-raised`, `grant-ended` or `bypassed` | H18, H39 |

NEW:
| `released:<cause>` | A hold's release reason | A cause of Table 6.7c other than a readiness word let a standing hold go: `rung`, `disarmed`, `engagement`, `class-raised`, `grant-ended`, `bypassed` or `deaf` | H18, H39 |

## model3a:F43 [minor]
QUOTE: | The `overlordOutcome` list (§6.1): `answered`, `escalated`, `lapsed`,

PROBLEM: §6.1 lists ten values. Table 11.5 restates the list as the new words an older build may meet and leaves out `returned` and `withdrawn`. `v_vocab.py`: the first `CE VOC-outcome`.

OLD:
| The `overlordOutcome` list (§6.1): `answered`, `escalated`, `lapsed`, `staged`, `operator-answered`, `not-ready:<word>`, `server-gap`, `released:<cause>` | A hold's outcome, and a released hold's release reason | The plan measures. A held row with no reach stamp is the case to measure first |

NEW:
| The `overlordOutcome` list (§6.1): `answered`, `escalated`, `returned`, `withdrawn`, `lapsed`, `staged`, `operator-answered`, `not-ready:<word>`, `server-gap`, `released:<cause>` | A hold's outcome, and a released hold's release reason | The plan measures. A held row with no reach stamp is the case to measure first |

## model3a:F44 [minor]
QUOTE: | `practice-contradicts` | The practice door |

PROBLEM: Table 9.7b: after the replay the practice lane retires a `proposed` entry "with the reason `practice-contradicts`". The door has already accepted the entry. Table 11.6 gives the word to the door. §9.7's "refuses it" says the same as the table. `v_vocab.py`: `CE VOC-refusal-door`.

OLD:
| `practice-contradicts` | The practice door | The replay found a contradiction with a pinned clause, a goal or a ruling | H37 |

NEW:
| `practice-contradicts` | The practice lane, as the reason on an entry it retires | The replay found a contradiction with a pinned clause, a goal or a ruling | H37 |

## model3a:F45 [minor]
QUOTE: | On each connect | W1 | never: outside the volume.

PROBLEM: Table 11.1a ships "the witness epoch, with the heads of the authority journal and the act journal" in W1. The act journal ships in W2. `v_vocab.py`: `CE VOC-wave`.

OLD:
| The witness epoch, with the heads of the authority journal and the act journal | C8, adapters | each agent and each signed-in console | The server sends them; each keeps the highest epoch and its heads | On each connect | W1 | never: outside the volume. Only a witness off the server's volume counts. An agent on the server's own host is no witness, because the same snapshot restores its copy (§7.6) | An older agent drops the additive field |

NEW:
| The witness epoch, with the heads of the authority journal and the act journal | C8, adapters | each agent and each signed-in console | The server sends them; each keeps the highest epoch and its heads | On each connect | W1 (the act journal's head W2) | never: outside the volume. Only a witness off the server's volume counts. An agent on the server's own host is no witness, because the same snapshot restores its copy (§7.6) | An older agent drops the additive field |

## model3a:F46 [minor]
QUOTE: **Its only widening writer is a session-gated operator door with a step-up:**

PROBLEM: §7.2 names the door with a step-up as "`POST /api/overlord/grants`, and `DELETE` to revoke". Table 11.2's step-up list has a grant, a grant leaving shadow and a renewal, and §11.2 says lowering never needs a step-up. A revoke is the brake on a grant, so it should not wait for a passkey. `v_vocab.py`: the first `CE VOC-stepup`.

OLD:
- **Its only widening writer is a session-gated operator door with a step-up:** `POST /api/overlord/grants`, and
  `DELETE` to revoke. The server writes only the narrowing moves, suspension and expiry (Table 11.1a). A revocation

NEW:
- **Its only widening writer is a session-gated operator door with a step-up:** `POST /api/overlord/grants`.
  `DELETE` revokes, with no step-up, because it only narrows. The server writes only the narrowing moves,
  suspension and expiry (Table 11.1a). A revocation

## model3a:F47 [minor]
QUOTE: arming a decision-model row, the decision model's key

PROBLEM: §3.7: a refit that makes a gate easier to pass "is an authority change" and "needs the operator's tap". Table 11.2 lists every tap that moves authority up and has arming a row, not this one. `v_vocab.py`: the second `CE VOC-stepup`.

OLD:
| The operator's doors | The signed-in console | The cookie. Designate, rebind, retire, selecting `fable` as the designation's model class, grants (a grant, a grant leaving shadow, a renewal), the command tap, a rung up, clearing a latch, arming a kind of answer, re-arming a kind bypassed for a programme, returning a grant from a latched suspension, raising a programme's engagement, arming a decision-model row, the decision model's key (set from Settings into a server-level slot of the operator-secrets store), the isolation opt-in, Confirm the restore, the name list and wipe add the account gate's step-up | `admin` | The session-only set |

NEW:
| The operator's doors | The signed-in console | The cookie. Designate, rebind, retire, selecting `fable` as the designation's model class, grants (a grant, a grant leaving shadow, a renewal), the command tap, a rung up, clearing a latch, arming a kind of answer, re-arming a kind bypassed for a programme, returning a grant from a latched suspension, raising a programme's engagement, arming a decision-model row, a decision-model refit that eases a gate, the decision model's key (set from Settings into a server-level slot of the operator-secrets store), the isolation opt-in, Confirm the restore, the name list and wipe add the account gate's step-up | `admin` | The session-only set |

## model3a:F48 [minor]
QUOTE: Trigger: M1 shows prompts as a large share of what still reaches the operator after W3.

PROBLEM: M1 counts "items and asks that reach the operator". A child's permission prompt is an approval, a third channel that this programme leaves unchanged (Table 6.1a), so M1 cannot show its share. `v_vocab.py`: the first `CE VOC-measure`.

OLD:
  allows beyond `ordinary`. Trigger: M1 shows prompts as a large share of what still reaches the operator after W3.

NEW:
  allows beyond `ordinary`. Trigger: approvals are a large share of what still reaches the operator after W3,
  counted beside M1, which counts items and asks only.

## model3a:F49 [minor]
QUOTE: | M29 | Load by source: holds, acts, tokens and pushes per programme, and sources shed |

PROBLEM: §6.8: "Holds, acts, model tokens, decision-model calls and pushes are counted against the programme that caused them (M29)." `v_vocab.py`: the second `CE VOC-measure`.

OLD:
| M29 | Load by source: holds, acts, tokens and pushes per programme, and sources shed | Watched | Hold rows, act rows, the outbox, the spend read (§5.6) |

NEW:
| M29 | Load by source: holds, acts, tokens, decision-model calls and pushes per programme, and sources shed | Watched | Hold rows, act rows, the outbox, the spend read (§5.6) |

## model3a:F50 [minor]
QUOTE: | M32 | Reads: reads per door per day against the 28-day median;

PROBLEM: §3.8: "A read with no turn behind it is counted (M32)." M32's row counts reads per door per day only. `v_vocab.py`: the third `CE VOC-measure`.

OLD:
| M32 | Reads: reads per door per day against the 28-day median; guests on Fable, or past the line, on a reserved account; acts left in the act state `pending` or `unknown` after the boot pass | Such guests zero; unsettled acts after the boot pass zero; reads watched | The read ledger, reserved-account items, act rows |

NEW:
| M32 | Reads: reads per door per day against the 28-day median, and reads with no turn behind them; guests on Fable, or past the line, on a reserved account; acts left in the act state `pending` or `unknown` after the boot pass | Such guests zero; unsettled acts after the boot pass zero; reads watched | The read ledger, reserved-account items, act rows |

## Passages that restate an edited rule

No finding edits these. Each stays true after the edits unless the line says otherwise.

- **F1.** Table 3.7b's Direction cells for `scope.widens` and `grant.inside` ("Skipped when unarmed"), §7.2 ("Unarmed,
  the check is skipped") and M19 ("a row whose bands drift goes back to shadow") now mean unarmed by the operator.
- **F3.** §3.3.11 ("While an Overlord generation is `degraded`, its ladder is capped at `chat`") stays true.
- **F4.** §3.3.8 and §3.4 (C57) restate the two restarts in an hour. Both stay true.
- **F7, F8.** The caption of Figure 6 stays true. The figure gains a node `H`.
- **F9.** Table 11.6's rows for `ask-is-cheaper` and `evidence-too-weak`, and §6.3's "The floor", state the rule for an
  answer with no command behind it.
- **F12 to F14.** Table 6.7a ("a `decide` item with no class", "a `value` item"), §6.4 ("An item with an `unknown`
  class gets a triage hold") and C21 in Table 13a ("A missing field is the class member `unknown`").
- **F15, F16.** The Retention sentence of §6.7 names the breaker and engagement. §7.5 says the holds "pause".
- **F17, F18.** §3.2 (C7) and §7.5 list what `off` does in one transaction. C15 in Table 13a restates the `chat` rule.
- **F23.** §3.2 (C7) says Pause "lowers the rung to `chat`", which is the fixed rule.
- **F28.** Figure 2 draws "timeout: back, with a hold-off" and "failed before the old one ended" to `active` only.
- **F34, F35.** Table 11.1e's row for the operator's request doors names withdraw with no source states.
- **F39, F40.** §3.8 (H10), §8.1 ("What it does not get") and Table 11.6 still refuse the designated session on the
  item-raise lane. `raise-item` is its own door.
- **F44.** §9.7 says a contradiction "refuses it (`practice-contradicts`)". The lane retires the entry with that
  reason.

## Reproduced, with no edit proposed

Each is a line a script prints. The fix is a design call, or the harm is small enough to leave.

- **A case's review has no door.** §10.5 has the Overlord write the review. `practice_cases` has one writer, the case
  lane. Table 11.1e has no door that takes a review and Table 7.1a no kind. `v_vocab.py`: the second `CE VOC-act`.
- **`stranded` during a renewal.** "No account can serve it" is a hard trigger, so a renewal starts and the word reads
  `renewing`, not `stranded`, until the renewal fails back. Table 3.4b says `stranded` releases all. `d05_readiness.py`:
  the `note` line.
- **A `batchable` push with no briefing time ignores quiet hours.** It "is not deferred", so it goes out at night while
  a `blocking-by` push waits for its limit. `d08_push.py`: the `note` line.
- **Table 4b and a closed request.** A `done`, `failed` or `dropped` request with a linked run that awaits review is
  drawn under "Ready for review", and never ages out of the list. `d14_states.py`: the first `note` line.
- **`tripwireDue` and a predicate that cannot be measured.** No answer is given. `reviewBy` bounds the wait.
  `d13_brief.py`: the first `note` line.
- **`fatigueSignals` reads five signals and names a line for two.** `d13_brief.py`: the second `note` line.
- **Table 3.3.11a gives `clearing`, `carded` and `probing` their seconds, and not what follows a timeout.** Figure 2
  and the receipt do. `d02_generation.py`: three `note` lines.

## 5. What this round did not check

- **Deciders the text only names.** `programmeHealth` (eight words, no conditions), `forecastProgramme`, `poolRunway`,
  `admitByPortfolio`, `overturnableNow`, `homePlace`, `auditorModelFor`, `decideSleep`, `tripwireDue`. The text gives
  them no rows to encode.
- **The decision model.** Table 3.7b was read row by row against Table 3.7a and the sections that use each row, and
  no disagreement was found. Only the two fail-closed rows are encoded, as the blind check. A fail-open row loses a
  narrowing mark when the model fails, by design, so §11.7's property cannot hold for an input that is such a mark.
  That is not counted as a finding.
- **The gate order beyond the note door.** The eleven steps are in one order. `unwitnessed`, `operator-has-it`,
  `class-unstated`, `mail-disabled`, `entry-retired` and the `renewing` after a boot have no place among them, and
  pairs of them were not enumerated. Step 2 names "`overlord-v1` or a later one's" for doors that ship with
  `continuity-v1`.
- **Grants.** Table 7.2a's kinds were read against Table 7.5a and §7.6. The states against every event were not
  enumerated: a renewal of a `suspended` grant, and whether a `refused` or `vetoed` row counts for `max-per-day`.
- **Doors and their groups.** Every `/api/overlord` path has a row. Table 11.1e has no credential column, so the
  group of each row was not checked by script. The sequence read, the performer's mark and the label cards are not
  placed in a group of Table 11.2 by any sentence.
- **Waves.** The capability words and the witness row are checked by script. The prose statements that tie a piece
  to a wave, about seventy, were listed and read against Tables 11.1a to 11.1e and Table 14. No other clash was seen.
- **Command states.** The text gives a command no closed list of states, only "live", "consumed" and an expiry.
- **Numbers.** The weights and the bounds were recomputed. The other starting values of Table 11.5b were not.
- **The state machines** of rounds one and two, and anything a rule misread without noticing would hide. Each encoded
  rule cites its sentence so that it can be checked.
