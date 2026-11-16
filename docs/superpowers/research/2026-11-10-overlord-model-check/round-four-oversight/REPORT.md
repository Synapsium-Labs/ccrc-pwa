# Model check of the Overlord design, round four: what judges the Overlord and sets its trust

Run against the edition of `docs/superpowers/specs/2026-11-09-overlord-design.md` that #2542 merged. #2543 writes the findings into
the spec, with one changed by the editor (F7: a cell for an answer of class none is the fleet's). Round one (the parent
directory) covered holds, readiness, generations and the push outbox.
Round two (`../model2/`) covered authority, restore, requests, commands, the push budget and playbook entries. Round
three (`../model3a/`, `../model3b/`) covered every decider table, accounts, the operator's messages and the privacy
rules. This round covers the one cluster none of them touched: the evidence that arms a kind of answer or supports a
grant, the decision model as a component, and the judges (the replay, the auditor, drills, the weekly check).

## 1. Summary

- **What was modelled.** Five small machines on the earlier rounds' explorer (`explore.py`, copied unchanged), and
  one exhaustive arithmetic sweep (`arith.py`) over the spec's own starting values. Each rule cites its section in a
  comment. Where the text is silent or two passages disagree, the rule reads a named switch, and both readings are
  run.
- **Result.** Under one consistent set of readings (the "safe" readings) every check holds within the bounds:
  12,113 states over 25 scenarios. The text does not settle those readings. Of the 29 other
  readings in Table 3, 27 break a stated rule or a check this model adds, and 16 of the 29 are
  the text as written. The arithmetic sweep prints 14 counterexamples under the text, and 1 under the
  edits: the one that stays is the lean of the first gate, which F25 keeps and states.
- **Findings.** 32: 0 blocker, 16 major, 16 minor. Two minors are companions
  (F23, F30).
- **Safety.** No reading lets authority widen without the operator's step-up: I11 holds in every run. What breaks is
  the evidence the operator's step-up rests on. Under the text an answer changed after the reveal can count as blind
  (F2), a prediction can be replaced (F3), the Overlord can choose which rows are counted
  (F1, F4), one tap can count several times (F9), the bar a change must clear can sink 0.05 at
  every change (F5), and the divisor of every bound can sit low by chance (F8).
- **Liveness.** No gate is circular: each can be fed by events the design produces. Three come close. A weekly
  spot-check cannot start a cell, because it draws from answers the Overlord already gave (F7). The grant gate
  asks for 152 questions of one effect in one programme (F14). `grant.inside` can never be armed
  (F21). And one latch-like state has no door: a failed replay (F6).
- **Mutations.** 23 planted faults, 0 missed. 2 are caught by I1 to I13 as worded. The other
  21 are caught only by checks this model added, so they are gaps in the invariants (Table 4,
  F16).
- **Total explored.** 60,895 states: 45,234 over the matrix (54 runs, under a second) and 15,661
  over the mutation runs. The sweep is exact: every bound is a binomial sum, and nothing is sampled.

### What each machine holds, and its bounds

Every fault, tap and tick has a budget, named in each file's `DEFAULT`. A run stops at 600,000 states and reports
`BOUND`. No run reaches it. The machines are small on purpose: each holds one question, one answer, one row or one
kind, and the faults that can reach it.

| Machine (file) | What it holds | Faults injected |
|---|---|---|
| arithmetic (`arith.py`) | The bounds the text quotes; the first gate under every share of examined accepts; the third gate's noise and its moving reference; every `askOrAct` cell; the grant gate; the label queue under four ways of sharing ten cards; the consistency divisor; the auditor's model; the operator's week; the trust table | A thin sample, a change with no change in judgement, a quiet programme |
| evidence (`m_evidence.py`) | One question that reached the operator: the brief, the sealed prediction, the reveal mode, the Overlord's chat text, a hint by the operator, the pick, the reveal, keep or switch, `answerExamined`, and the cases added to the first gate and to the grant evidence | A console that reports no events, a second prediction, chat text on screen, a row left unpredicted |
| spot (`m_spot.py`) | One answer the Overlord gave, routine or staged under a grant: the weekly spot-check, the Overturn, the renewal sheet, the seeded wrong call, the cell's record, the grant's evidence and its 30 days | A period with fewer than three acts |
| arming (`m_arming.py`) | A kind's arming, the missed-drill latch and the `advise` latch, the release's digest, the generation's digest and class, each replay's pass or failure with its bound, the third gate's reference, one grant | A release, a renewal, a model fallback and its return, a failed replay, a missed drill, three overturns, a restore |
| decision (`m_decision.py`) | One gate row (`grant.inside`): the operator's switch, server shadow, the key, the line and its admissions, the recorded answer, and one act through gather, transaction, staging and commit | A drift behind the same model id, a change of model id, an outage, a retry |
| judges (`m_judges.py`) | One drill and one real row with deadlines and one service slot, the breaker's count, the invariant monitor, the audit day by day under a judge that is good, wrong or not yet labelled, the weekly check week by week, one grant | A day with no audit, a score under its floor, missed weeks |

*Table 1. The machines.*

| Machine | Scenario | Bounds | States | Transitions |
|---|---|---|---|---|
| evidence | item | one coordinator's item; 1 chat text, 1 hint by the operator, 1 second prediction | 720 | 1,168 |
| evidence | bundle | two rows answered by one tap; no chat, no hint | 186 | 255 |
| evidence | own-item | an item the Overlord raised itself; 1 chat text | 360 | 533 |
| evidence | old-console | a console that reports no events; 1 chat text | 360 | 533 |
| spot | routine | one routine answer the operator would disagree with; 1 weekly check, 1 overturn | 10 | 13 |
| spot | routine-agree | the same, the operator would agree | 7 | 8 |
| spot | grant | one staged answer under a grant with 3 acts in its period; 1 renewal sheet; 30 days | 8 | 7 |
| spot | grant-quiet | the same, 1 act in the period | 4 | 3 |
| spot | seeded | one routine answer and the seeded wrong call | 25 | 47 |
| arming | releases | an armed kind; 2 releases, 1 re-run of a failed replay; bound levels 0 to 4 | 4,895 | 7,549 |
| arming | fallback | an armed kind and a live grant; 1 release, 1 fallback and its return | 604 | 1,100 |
| arming | latches | a kind not yet armed; 1 missed drill, 1 burst of three overturns | 90 | 237 |
| arming | restore | an armed kind; 1 missed drill, 1 snapshot, 1 restore | 95 | 181 |
| decision | drift | one gate row, one act; 1 drift behind the same id, 1 outage, 2 operator switches, 1 retry | 2,489 | 4,864 |
| decision | key | the same, 1 change of model id in place of the drift | 965 | 1,934 |
| decision | key-old-yes | the same, the old model said yes and the new one says no | 1,001 | 1,952 |
| decision | down | one gate row, one act, 1 outage | 141 | 257 |
| decision | off | one gate row, one act, 2 operator switches | 35 | 41 |
| judges | drill-burst | one held drill and one real row, both due at tick 1; one row served a tick | 21 | 21 |
| judges | drill-day-one | the same while `mayHold` is false | 22 | 25 |
| judges | drill-brief | a drill seated as a row that waits for a brief | 22 | 25 |
| judges | audit | 3 days; on each the audit runs or cannot, and its score may fall under its floor once | 16 | 24 |
| judges | audit-unlabelled | 2 days; a judge with no labels yet | 9 | 11 |
| judges | audit-low-judge | 2 days; a judge the operator's labels showed wrong | 9 | 11 |
| judges | weekly | 3 weeks; each week the check is done or missed; one grant | 19 | 26 |
| | Total, safe readings | | 12,113 | 20,825 |

*Table 2. States under the safe readings. `matrix.out` has every run.*

- **A server crash between transactions** changes nothing in these machines. Each count is read as derived from
  rows, and each decider runs in one transaction. The text does not state that for the evidence counts (see the
  end).

### The checks, and which readings break them

I11 is checked as A1. The other names are this model's. Each is a rule the text states, except A3, D5, J6 and the
first half of J9, which this model adds and the findings argue for:

- **evidence.** E1: an answer scored `blind` was picked with no recommendation and no chat text of the Overlord's in
  view. E2: one tap is one case. E3: a question the Overlord raised adds no case. E4: the scored prediction is the
  first on the row, sealed before the first pick. E5: an `unmeasured` answer adds none. E6: a "You decide", a plain
  accept and an answer with no brief add none. E7: a row left unpredicted past its brief deadline counts against the
  record.
- **spot.** S1: an answer whose pick the operator saw is never blind. S2: one answer of the Overlord's is at most one
  case in its cell and in its grant's evidence. S3: the seeded call adds no case and no pair. S4: an Overturn tapped
  on it feeds no tripwire. S5: a renewal rests on three answered spot-checks.
- **arming.** A1: answers and a grant go live only in an operator's step-up door, or when a condition measurably
  ends (I11). A2: answers are live only on a digest and class the replay passed. A3: answers are live no more than
  0.05 under the bound the operator armed the kind on. A4: after a failed replay an armed kind can answer again
  without waiting for a release. A5: every latch has a door that clears it. A6: a grant is used only on the class it
  names. A7: a missed drill returns answers to shadow while drills latch. A8: the fallback class can be replayed
  before it is needed. A9: a fallback generation whose replay has not passed runs under the operator's rung.
- **decision.** D1: a gate in server shadow stays shut. D2: a yes lets an act through only if it was gathered under
  the row's current key and line. D3: a drifted model is found by the server alone. D4: an armed row's line was
  measured on the model as it answers now. D5: a gate is eased only in a journalled step-up door. D6: a failed call
  never stages an act. D7: a state answered before a line was admitted again can be asked again.
- **judges.** J1: a drill delivers nothing. J2: a drill never makes a real hold lapse. J3: the monitor never latches
  on a drill. J4: no Overlord read tells a drill from a real row before grading. J5: the breaker never counts a
  drill's lapse. J6: two days with no audit verdict narrow the ladder. J7: two missed weekly checks pause renewals.
  J8: no grant renews while renewals are paused. J9: an audit under its floor latches the ladder, unless the
  operator's labels showed the judge wrong.

| Machine | Scenario | Reading (switch=value) | Is it the text? | Breaks | Finding |
|---|---|---|---|---|---|
| evidence | item | `SCORE_AGAINST=final` | one reading | E1 | F2 |
| evidence | item | `PRED_REFILE=last` | the text is silent | E4 | F3 |
| evidence | item | `PRED_LATE=final` | one reading | E4 | F3 |
| evidence | bundle | `BUNDLE_COUNTS=each` | the text is silent | E2 | F9 |
| evidence | own-item | `SELF_COUNTS=True` | the text | E3 | F4 |
| evidence | item | `MISSING=left-out` | the text | E7 | F1 |
| spot | routine | `SPOT_OVERTURN=both` | the text | S2 | F26, F7 |
| spot | grant | `RENEWAL_WORD=blind` | the text | S1 | F10 |
| spot | grant-quiet | `RENEW_FEWER=shown` | one reading | S5 | F10 |
| arming | releases | `GATE3_REF=last` | the text | A3 | F5 |
| arming | releases | `FAIL_EXIT=none` | the text | A4 | F6 |
| arming | releases | `FAIL_EXIT=rerun` | one reading | nothing | none |
| arming | fallback | `GRANT_MODEL=replay` | the text | A6 | F11 |
| arming | fallback | `FB_AHEAD=False` | the text | A8 | F31 |
| arming | latches | `DRILL_MODE=advisory` | the text | nothing | none |
| decision | drift | `ANCHOR=cached` | one reading | D3 | F13 |
| decision | drift | `COMMIT_SHADOW=letter` | the text | D1 D2 | F12 |
| decision | key-old-yes | `COMMIT_KEY=reuse` | the text | D2 | F12 |
| decision | drift | `REARM=tap` | the text | D4 | F18 |
| decision | drift | `RECORDS=kept` | the text | D7 | F13 |
| decision | drift | `RECORDS=kept GATHERED=used` | the text | D2 D7 | F13, F17 |
| decision | drift | `GATHERED=used` | the text is silent | D2 | F17 |
| decision | off | `OFF_DOOR=plain` | the text | D5 | F19 |
| judges | drill-burst | `ADMISSION=ignored` | the text is silent | J2 | F15 |
| judges | drill-burst | `SEQUENCE=stamped` | one reading | J3 | F15 |
| judges | drill-burst | `SEQUENCE=absent` | one reading | J4 | F15 |
| judges | drill-day-one | `SEAT=any` | the text is silent | J4 | F15 |
| judges | audit | `AUDIT_GAP=nothing` | the text | J6 | F29 |
| judges | audit-unlabelled | `UNMEASURED=advisory` | one reading | J9 | F24 |

*Table 3. Every reading that is not the safe one. "The text" is the text as written. "One reading" is one of two
the text allows. "The text is silent" is what a build does when it adds nothing.*

| Machine | Planted fault | What it does | Caught by this model | Caught by I1 to I13 as worded | Caught once the edits are in |
|---|---|---|---|---|---|
| evidence | `chat_ignored` | an answer is scored blind with the Overlord's chat text on screen | E1 | none | I15 |
| evidence | `unmeasured_counts` | an answer from a console that reports no events counts | E5 | none | I15 |
| evidence | `delegated_counts` | a "You decide" counts as an examined agreement | E6 | none | I15 |
| spot | `seeded_is_a_case` | the seeded wrong call adds a case to a cell | S2 S3 | none | I15 |
| spot | `seeded_is_a_pair` | the seeded wrong call adds a consistency pair | S3 | none | I15 |
| spot | `seeded_overturn_acts` | an Overturn on the seeded call counts towards the latch | S4 | none | §9.6 as edited (F27) |
| arming | `answers_before_replay` | answers stay live across a release, before the replay | A2 | none | I14 |
| arming | `gate3_always_passes` | the third gate passes whatever the bound | A3 | none | the third gate's own test (F5) |
| arming | `fallback_no_cap` | a fallback generation keeps the operator's rung | A9 | none | I14 |
| arming | `drill_ignored` | a missed drill latches nothing while drills latch | A7 | none | I14 |
| arming | `server_clears_latch` | the server clears the missed-drill latch by itself | A1 | I11 | I11 |
| arming | `restore_undetected` | a restore brings back a cleared latch's rows, undetected | A1 | I7, I11 | I7, I11 |
| decision | `fail_open_gate` | an armed gate stages an act on a failed call | D6 | none | I16 |
| decision | `shadow_is_skipped` | a gate in server shadow is treated as skipped | D1 D2 D6 | none | I16 |
| decision | `key_change_ignored` | a change of model id leaves the row armed | D4 | none | I16 |
| decision | `record_any_key` | a record from another model id is reused | D2 D7 | none | I16 |
| decision | `refit_eases_alone` | the server eases a gate's line with no tap | D5 | none | I11 as edited (F19) |
| judges | `drill_delivers` | the Overlord's answer to a drill is delivered | J1 | none | I16 |
| judges | `drill_lapse_pushes` | a lapsed drill pushes | J1 | none | I16 |
| judges | `drill_lapse_counts` | the breaker counts a drill's lapse | J5 | none | §7.5 as edited (F15) |
| judges | `missed_weeks_ignored` | two missed weekly checks pause nothing | J7 | none | I14 |
| judges | `paused_grant_renews` | a grant renews while renewals are paused | J8 | none | I14 |
| judges | `low_judge_latches` | a judge the labels showed wrong latches the ladder | J9 | none | §9.5 as it stands |

*Table 4. The planted faults. Each is caught by a check of this model. The fifth column says whether I1 to I13, as
worded, would catch it. The last says what catches it once this report's edits are in.*

## 2. What it takes to earn each kind of trust

Every figure is derived from the spec's own starting values (Table 9.5a, Table 11.5b, §3.7, §6.6, §9.6), by exact
binomial bounds: `arith.py`, sections T1 to T10.

| Gate | The events it needs | Least count | Operator answers | Days at 1 a day | at 5 | at 20 | Practical? |
|---|---|---|---|---|---|---|---|
| A kind of answer leaves shadow (Table 9.5a, row 1): every accept examined | answers of that kind, `blind` or `examined`, a prediction sealed before each | 30, at most 1 miss | 30 | 30 | 6.0 | 1.5 | yes |
| the same, true agreement 0.95, three accepts in five examined | as above; every disagreement counts, a plain accept does not | 76 | 114 | 114 | 23 | 5.7 | yes |
| the same, true agreement 0.95, two accepts in five examined | as above; every disagreement counts, a plain accept does not | 150 | 299 | 299 | 60 | 15 | slow |
| the same, no accept examined | only the blind answers and the disagreements count | never: the measured agreement is 0.70 | - | - | - | - | no |
| A grant proposal (row 2) | `blind` answers on one effect in one programme, on five days | 19 of 19 | 152 | 152 | 30 | 7.6 | no: 152 O3 questions of one effect in one programme |
| the same, one miss | as above | 29 of 30 | 240 | 240 | 48 | 12 | no |
| A grant leaves shadow (§7.2) | the operator's tap on its shadow report | no least count | - | - | - | - | yes: the operator's call |
| A grant renews (§7.2) | three acts under the grant in its 30 days, answered as spot-checks | 3 acts every 30 days | - | - | - | - | only for a busy effect |
| A change of model, skill or card (row 3) | a replay of the replay set, and the scenario suite | no least count; no operator answer | - | - | - | - | fails by chance 25% of the time at 30 cases |
| An `askOrAct` cell acts: routine, batchable, `lambda` 1 | clean `blind` answers in that cell | 59 | 472 | 472 | 94 | 24 | no |
| An `askOrAct` cell acts: routine, blocking-now, `lambda` 1 | clean `blind` answers in that cell | 29 | 232 | 232 | 46 | 12 | slow |
| An `askOrAct` cell acts: big, batchable, `lambda` 1 | clean `blind` answers in that cell | 179 | 1432 | 1432 | 286 | 72 | no |
| An `askOrAct` cell acts: big, blocking-now, `lambda` 1 | clean `blind` answers in that cell | 89 | 712 | 712 | 142 | 36 | no |
| An `askOrAct` cell acts: routine, batchable, `lambda` 3 | clean `blind` answers in that cell | 19 | 152 | 152 | 30 | 7.6 | slow |
| An `askOrAct` cell acts: big, batchable, `lambda` 3 | clean `blind` answers in that cell | 59 | 472 | 472 | 94 | 24 | no |
| A decision-model line, 10% target | label cards beyond the line, none wrong | 29 | - | - | - | - | 3 weeks alone; weeks 13 to 39 at equal shares of ten cards |
| A decision-model line, 5% target (`scope.widens`) | as above | 59 | - | - | - | - | 6 weeks alone; week 27 at equal shares, week 6 gate first |
| `grant.inside`, 5% target | labels from `overturn` only | 59 yes answers labelled right | - | - | - | - | no: an overturn labels a yes only as wrong |

*Table 5. The gates, in the events and days each takes.*

- **The first gate is the only one in easy reach.** 30 answers arm a kind when the operator examines every accept
  and the Overlord misses at most once. It leans against the Overlord: every disagreement counts, and an accept
  counts only when examined. At a true agreement of 0.95 it takes 114 answers with three accepts in five examined,
  299 with two in five, and never passes with under one in five (F25).
- **A cell is slow.** At `lambda` 1 a routine cell needs 59 clean blind answers on a batchable row: 472 questions in
  that cell at one in eight, which is 94 days at five a day. A big one needs 179: 1,432 questions. One disagreement
  raises 59 to 93. At `lambda` 3 the routine cell needs 19: 152 questions. A cell is one kind, one evidence class
  and one programme (F7), so the operator's answers are split across many.
- **A cell that acts stops learning.** Once it acts, its rows are answered and no longer escalated, so the blind
  sample stops. Its record then grows by the weekly check's three spot-checks, shared by every cell.
- **The grant gate is out of reach.** 19 blind answers of one effect in one programme, all agreeing: 152 O3
  questions of that effect there, or 240 with one miss (F14). Its window has no length: inside 90 days that
  is 1.7 such questions a day (F22). A grant will start at the operator's own door.
- **The third gate fails by chance.** With 30 replayed cases and no change in judgement, it fails one change in
  four. One changed answer moves the bound by 0.043 at 30 cases and by 0.069 at 19 (F6).
- **A decision-model line takes months.** Twelve rows need 378 labels beyond their lines, at ten cards a week:
  38 weeks if every card counts (F20). `grant.inside` never gets one (F21).
- **The blind share is one in eight at best.** An answer is blind only if no chat text the Overlord wrote since the
  filing was on screen before the pick (§6.6), and the console opens on the chat (§4). Every figure above that
  counts blind answers grows by that share.
- **The operator's week.** Table 4.1a budgets about 24 minutes. With every mechanism asking, it is about 33: the
  label cards, the judge's labels and the renewal spot-checks sit in no cadence with a time (F32).

## 3. How to re-run

```
cd model4
python3 check.py --list                       # machines, scenarios, readings, mutations
python3 check.py --matrix > matrix.out        # every scenario, safe readings, then every other reading
python3 check.py --mutations > mutations.out  # the planted faults
python3 check.py --traces > traces.out        # writes traces/<name>.txt, one per cited trace
python3 check.py arming releases GATE3_REF=last   # one run, with its shortest trace
python3 arith.py > arith.out                  # the arithmetic under the text
FIX=1 python3 arith.py > arith.fix.out        # the same under the proposed edits
```

Python 3, standard library only. Everything runs in about fifteen seconds. Nothing reads the network or writes outside
this directory.

## 4. Findings

Most severe first. Each OLD is copied from the spec by line. A finding that is a design choice says so, and names
the other choice. The choices made in a NEW text are:

- F5. The reference of the third gate is the bound on the arming item, not the last generation's.
- F6. After a failed replay the operator may arm the kind on that digest, behind the step-up; the lane does not re-run it.
- F7. A cell's scope is one programme's row and incarnation, as a grant's is, not the fleet.
- F8. The divisor is the upper bound of the consistency rate, not the rate.
- F10. A grant with fewer than three acts in its period is not renewed: it expires and starts again in shadow.
- F11. A grant holds only on the class it names; a passed replay of another class does not lift it.
- F14. The grant gate stays per effect and scope; the cap goes, and "distinct subjects" becomes five subjects.
- F19. Switching an armed gate row off is journalled and keeps the step-up.
- F20. The ten label cards go to a gate row first, then to the row nearest its line.
- F22. The grant evidence's window is rolling, with a length the plan sets; the other choice is no window.
- F24. A judge with no labels yet is binding, not advisory.
- F26. A spot-check is blind unless chat text that names its row was on screen; the strict test would be any chat text.
- F28. The auditor runs `sonnet` when the Overlord runs `opus`.
- F29. A missing audit is a live condition that caps the ladder at `advise`.

## model4:F1 [major]
QUOTE: The denominator is every escalated item in the cell.

PROBLEM: The denominator is "every escalated item", and a missing prediction is a miss "where the Overlord had its triage window". Before the hold tier the Overlord escalates nothing and holds nothing: every row reaches the operator at once and waits for a brief (§6.5). Read by its words, no denominator binds in W3's first step, where the first gate's evidence is gathered. And the first gate counts only answers "each with ... a sealed prediction filed before it", so a miss is not in its bound. An Overlord right on 70% of rows that seals predictions only on the half it is surest of shows 0.95 and passes at 40 cases: `arith.out`, `CE G1-pick`; `traces/evidence-unpredicted-left-out.txt`. The edit names the denominator in words that hold before the hold tier, gives a row its brief deadline (§6.8) with the Overlord `ready` as the time it had, and puts a miss in the bound.

OLD:
  - The denominator is every escalated item in the cell. A missing prediction, where the Overlord had its triage
    window, is a miss.
  - An item the operator answered sooner than that is counted apart. Coverage is shown beside the score.

NEW:
  - The denominator is every item and ask of the kind that reached the operator, escalated or marked "brief
    pending". A missing prediction is a miss where the row stood on the operator's list, with the Overlord `ready`,
    past its brief deadline (§6.8) before the operator answered. A miss counts as a disagreement in every bound of
    Table 9.5a, and not towards the first gate's 30 cases.
  - A row the operator answered sooner than that is counted apart. Coverage is shown beside the score.

## model4:F2 [major]
QUOTE: It is two-step: the operator picks, the recommendation is revealed, and the operator keeps or switches.

PROBLEM: The blind sample has two answers: the pick before the reveal, and the row's answer after "keeps or switches". §6.5 scores a prediction "against the operator's own answer", which is the row's. Read so, an operator who picks A, sees B recommended and switches to B gives a `blind` agreement, and it is grant evidence: `traces/evidence-switch-scored-blind.txt`. §6.6's `blind` is "answered before the reveal", so the pick is meant. The edit says so once, for every score that reads a blind answer.

OLD:
  - It is two-step: the operator picks, the recommendation is revealed, and the operator keeps or switches.

NEW:
  - It is two-step: the operator picks, the recommendation is revealed, and the operator keeps or switches. The blind
    answer is the first pick, and every score of a blind answer reads it. A switch after the reveal changes the row's
    answer and counts in the switch rate. It is never agreement.

## model4:F3 [major]
QUOTE: The server refuses a prediction filed after the operator answered

PROBLEM: Nothing makes a prediction final. An act's natural key is its target row and that row's revision (§10.1), and the text does not say that a brief or a change of urgency leaves the revision alone. A second `seal-prediction` then has a new key and can replace the first, after the operator gave a lean away in the chat: `traces/evidence-prediction-replaced.txt`. And "after the operator answered" leaves open the time between the blind pick and "keeps or switches": `traces/evidence-prediction-after-pick.txt`. What is left after the edit: a first prediction filed after the operator's hint. The miss rule bounds how long the Overlord can wait for one.

OLD:
  - The server refuses a prediction filed after the operator answered (`prediction-late`), and scores each one.

NEW:
  - A row takes one prediction. A second call returns the first and changes nothing. The server refuses one filed
    after the operator's first pick or answer (`prediction-late`), and scores each one.

## model4:F4 [major]
QUOTE: This measures judgement going forward

PROBLEM: `raise-item` lets the Overlord raise an operator item of its own, with its own wording and options (Table 7.1a). Nothing keeps that row out of the first gate, a cell, the grant evidence or the consistency pairs. It can then raise questions it can predict, or the same question a week apart to move the divisor. §9.5 opens with "every gate reads evidence the Overlord cannot reach or shape": `traces/evidence-own-item-counts.txt`.

NEW:
  - A question the Overlord raised itself (`raise-item`) is scored and reported apart. It counts for no gate, no
    cell, no grant evidence and no consistency pair: the Overlord chose its wording and its options.

WHERE:   - This measures judgement going forward, and nothing the Overlord can read holds the answer.

## model4:F5 [major]
QUOTE: the bound is no lower than the last generation's less 0.05

PROBLEM: The third gate compares with "the last generation's" bound. Each change may then cost 0.05: a kind armed at 0.90 answers at 0.85, 0.80 and 0.75 after three changes, and no gate is red (`arith.out`, `CE G3-ratchet`). The fallback class's replay moves the reference too, so one release can cost 0.10: `traces/arming-ratchet.txt`. Before any replay has passed there is no last generation to compare with. This is a design choice. The edit fixes the reference at the bound on the kind's arming item, which a pass never moves. The other choice keeps the moving reference and adds a floor of 0.85 under it.

OLD:
| the bound is no lower than the last generation's less 0.05, and the scenario suite passes |

NEW:
| for each armed kind, the bound over its replayed cases is no lower than the bound the operator armed it on, less 0.05; and the scenario suite passes |

## model4:F6 [major]
QUOTE: Each change swaps the operator's proxy for an untested one.

PROBLEM: Nothing says what follows a failed replay. The lane runs "on a gate; at each release" (Table 11.1c), so a failed digest is not run again, no item is raised, and no operator door arms past it. An armed kind stays in shadow until some later release passes: `traces/arming-failed-replay-no-exit.txt`. The gate is also noisy at the sizes the design starts with. At 30 replayed cases and no change in judgement it fails about one change in four (`arith.out`, T3). Against a fixed reference it still fails 19% of changes at 30 cases and 3% at 60 (`arith.fix.out`). The first gate's evidence also pools predictions sealed under earlier digests, so a kind can be armed on a digest the replay has never seen. This is a design choice. The other choice lets the lane run a failed digest again by itself, which lets chance pass a worse proxy.

OLD:
- **A change must pass the replay before it answers.** The model class advances, and the skill and the card template
  change with releases. Each change swaps the operator's proxy for an untested one. So the renewal trigger "evaluation
  due" (Table 3.3.11b) asks for one renewal, and the third gate holds answers in shadow until the replay passes. The
  fallback class is replayed at each release, ahead of need (§3.4).

NEW:
- **A change must pass the replay before it answers.** The model class advances, and the skill and the card template
  change with releases. Each change swaps the operator's proxy for an untested one. So the renewal trigger "evaluation
  due" (Table 3.3.11b) asks for one renewal, and the third gate holds answers in shadow until the replay passes. The
  fallback class is replayed at each release, ahead of need (§3.4).
  - **A replay that fails is the operator's.** It raises one item with the count, the bound and every answer that
    changed. The lane does not run that digest again by itself. The kind stays in shadow on that digest until a later
    digest passes, or the operator arms it from that item, behind the step-up (§7.5). That arming is the digest's
    pass for that kind, and sets the gate's reference.
  - **A kind armed on a digest the replay has not passed** stays in shadow until that replay passes.

## model4:F7 [major]
QUOTE: evidence class and the scope. Its record comes from blind answers, weekly spot-checks (§9.6) and overturns.

PROBLEM: "The scope" has no definition: an entry has one vocabulary of scope (§9.1) and a grant another (§7.2). The text also does not say which cell a blind answer on a row the Overlord did not answer joins. That is the only source a cell has before it acts, because a weekly spot-check draws from answers the Overlord gave (`arith.out`, T4). The edit takes the grant's meaning, the narrow one. Its cost: 59 clean blind answers in one programme, for one kind and one evidence class, are about 472 questions there, so at `lambda` 1 few cells ever act. The other choice is a cell across the fleet, which acts sooner, on answers from other programmes. This is a design choice.

OLD:
  - **`U`** is the one-sided 95% upper bound on the operator disagreeing in this cell. A cell is the act kind, the
    evidence class and the scope. Its record comes from blind answers, weekly spot-checks (§9.6) and overturns.

NEW:
  - **`U`** is the one-sided 95% upper bound on the operator disagreeing in this cell. A cell is the act kind, the
    evidence class and the scope. The scope is a programme's row and its incarnation, as a grant's is (§7.2). Its
    record comes from blind answers, weekly spot-checks (§9.6) and overturns, and one answer is one case. A blind
    answer joins the cell of the evidence class the server derives from the ids its sealed prediction cites.

## model4:F8 [major]
QUOTE: Below 20 such pairs the divisor is 1.

PROBLEM: Every bound of Table 9.5a is divided by the operator's consistency, a rate measured on as few as 20 pairs. A low reading eases the gate: at 14 consistent pairs of 20 the "0.85" gate passes at 23 agreeing answers of 30, and at 16 of 20 at 25 (`arith.out`, T7). This is a design choice. With the upper bound of the rate as the divisor, 14 of 20 asks for 27 of 30, and 20 of 20 for 29. The other choice keeps the rate and raises the least count of pairs.

OLD:
  - Below 20 such pairs the divisor is 1.

NEW:
  - Below 20 such pairs the divisor is 1. From 20 pairs it is the one-sided 95% upper bound of the consistency
    rate, so a thin sample cannot ease a gate.

## model4:F9 [major]
QUOTE: Related decisions may be bundled so the operator decides a question once.

PROBLEM: A bundle lets the operator "decide a question once". Each member is a row with its own sealed prediction, so one examined tap adds one case a member to the first gate: `traces/evidence-bundle-counts-twice.txt`. Five rows in a bundle are five of the 30 cases, from one decision.

OLD:
  - **Bundles are the server's.** Related decisions may be bundled so the operator decides a question once. The
    server renders a bundle's members. A bundle never spans classes and never includes O2 or O4. One tap must not
    answer what the operator never read.

NEW:
  - **Bundles are the server's.** Related decisions may be bundled so the operator decides a question once. The
    server renders a bundle's members. A bundle never spans classes and never includes O2 or O4. One tap must not
    answer what the operator never read. A bundle's answer is one case in every record of §9.5, whatever the number
    of its members.

## model4:F10 [major]
QUOTE: The renewal sheet shows three acts

PROBLEM: Every act under a grant is a staged O3 answer in version 1 (§7.2, Table 7.1a). A staged act takes effect only after ten minutes on a console in the foreground, so the operator has seen the pick of every act the sheet can show. §9.6 keeps `blind` for answers "the operator never saw". Scored blind, these answers would be grant evidence: `traces/spot-renewal-scored-blind.txt`. The text is also silent on a period with fewer than three acts, which one effect in one programme will often have. Read as "the sheet shows what there is", a grant renews on one answer or on none: `traces/spot-renewal-under-three-acts.txt`. The edit takes the reading towards the operator. The other choice shows the acts there are and enables Renew behind the step-up alone. This is a design choice.

OLD:
- **Renewal is not one tap.** Its door is `POST /api/overlord/grants/:id/renew`. The renewal sheet shows three acts
  from the grant's last period as blind spot-checks. Renew is enabled after the operator answers them. With no answer
  by the expiry, the grant becomes `expired`. Renewing it later starts it again in `shadow`.

NEW:
- **Renewal is not one tap.** Its door is `POST /api/overlord/grants/:id/renew`. The renewal sheet shows three acts
  from the grant's last period as spot-checks: the question and its options, without the Overlord's pick. The
  operator watched each act's veto window, so these answers are `examined` at most. They check the operator's
  attention, and are never evidence. Renew is enabled after the operator answers them. With fewer than three acts in
  the period there is no renewal. With no renewal by the expiry, the grant becomes `expired`. Renewing it later
  starts it again in `shadow`.

## model4:F11 [major]
QUOTE: a generation is off the model the grant names

PROBLEM: §7.2's conditions say "The grant holds only on the model class it names." This row lifts the suspension once "that model's replay" has passed, so a grant that names `fable` is used by a fallback generation after one replay: `traces/arming-grant-on-fallback.txt`. The edit keeps the condition as the list of conditions states it. The ladder's own row, one rung under until the replay passes, is unchanged. The other choice lets the replay lift it, and rewords the condition.

OLD:
| a generation is off the model the grant names, and that model's replay has not passed | condition | the condition ending |

NEW:
| a generation is off the model class the grant names | condition | a generation on that class |

## model4:F12 [major]
QUOTE: staged act reads that record and asks nothing again

PROBLEM: The commit voids the act "if the check is armed at the commit and the row holds no clear yes". A check the server sent back to shadow is not armed, and the row holds a yes, so the act commits: the model drifted, said yes, and was found out during the veto window: `traces/decision-commit-in-shadow.txt`. §3.7 says such a gate "stays shut". The same holds for a yes recorded under a model id that is no longer the row's: `traces/decision-commit-other-key.txt`.

OLD:
- **The blind check.** When it is armed, the decision model's `grant.inside` row runs after the code checks pass. It
  sees the question, the options, the grant's scope and the answer's option, and never the Overlord's reasons.
  Anything short of a clear yes answers `defer`, and the matter goes to the operator. Where the operator has not
  armed it, the check is skipped: the code checks and the veto window stand, and the act row records that it did
  not run. A check the server sent back to shadow is not skipped: it answers `defer` (§3.7). The commit of a
  staged act reads that record and asks nothing again: if the check is armed at the commit and the row holds no
  clear yes, the act is `voided`. Why blind: a monitor that cannot read the agent's reasoning cannot be talked
  round by it, and Anthropic built its own action classifier that way (2026-03-25).

NEW:
- **The blind check.** When it is armed, the decision model's `grant.inside` row runs after the code checks pass. It
  sees the question, the options, the grant's scope and the answer's option, and never the Overlord's reasons.
  Anything short of a clear yes answers `defer`, and the matter goes to the operator. Where the operator has not
  armed it, the check is skipped: the code checks and the veto window stand, and the act row records that it did
  not run. A check the server sent back to shadow is not skipped: it answers `defer` (§3.7). The commit of a
  staged act reads that record and asks nothing again. The act is `voided` if the check is armed at the commit and
  the row holds no clear yes, if the check stands in shadow at the commit, or if the record was gathered under
  another key or before the row's line was last admitted (§3.7). Why blind: a monitor that cannot read the agent's
  reasoning cannot be talked round by it, and Anthropic built its own action classifier that way (2026-03-25).

## model4:F13 [major]
QUOTE: There is one answer per key: the row's revision, the model id and the state hash.

PROBLEM: Two bullets disagree. The anchor set "is re-asked daily", and there is "one answer per key ... recorded and reused". The anchor states are fixtures, so their key never changes. Served from the record, the bands never move and a drifted model is never found: `traces/decision-anchor-cached.txt`. The record also outlives the drift it was made in. A yes recorded from a drifted model is reused once the row is armed again: `traces/decision-record-reused-after-rearm.txt`. Where the transaction refuses it, the state is deferred for good, because it is never asked again: `traces/decision-record-never-asked-again.txt`.

OLD:
  - **Never asked twice.** There is one answer per key: the row's revision, the model id and the state hash. It is
    recorded and reused. Sessions see a band, never a number. M19 reports calibration for each row.

NEW:
  - **Never asked twice.** There is one answer per key: the row's revision, the model id and the state hash. It is
    recorded and reused, while the line it was gathered under stands. Once a line is admitted again, an earlier
    record is asked again. The anchor set, the canary and a line's admission are asked each time, and never served
    from the record. Sessions see a band, never a number. M19 reports calibration for each row.

## model4:F14 [major]
QUOTE: with a cap on cases from one programme

PROBLEM: The gate is "per effect and scope", and a scope is one programme's row and incarnation (§7.2). Every case then comes from one programme, so "a cap on cases from one programme" cannot be met, or never binds (`arith.out`, `CE G2-cap`). "Distinct subjects" gives no count. The edit drops the cap and asks for five subjects, as it asks for five days: a starting value. The gate is then 19 blind answers of one effect in one programme, all agreeing: 152 O3 questions of that effect there, or 240 with one miss (T5). At five such questions a day that is 30 days. So in practice a grant starts at the operator's own door, which needs no proposal, and W6's server-raised proposals rarely fire. The other choice pools an effect's cases across programmes, keeps the cap, and changes §7.2's "one scope". This is a design choice.

OLD:
| 19 blind, spread over at least five days and distinct subjects, with a cap on cases from one programme |

NEW:
| 19 blind, on at least five days and five subjects |

## model4:F15 [major]
QUOTE: They are rows of a table of their own, `overlord_drills`.

PROBLEM: Three gaps, each from a drill beside real work. The list of reads leaves out the sequence read (§10.4), which writes the read ledger as the Overlord's reads do (Table 11.1e). If a drill's hold is stamped as a real row's, the monitor sees a held row on no operator's list (I10) and latches the ladder at `advise`: `traces/judges-drill-trips-monitor.txt`. If it is not stamped, the sequence read shows every real hold and not this one: `traces/judges-drill-told-by-sequence.txt`. A drill seated as a held row while nothing can be held, as on every day before a kind is armed, is told at a glance: `traces/judges-drill-held-on-day-one.txt`. And admission (§6.8) does not say whether a drill is a row. Left out, a real hold lapses while the Overlord serves the drill, and the breaker counts it: `traces/judges-drill-starves-real-row.txt`. Counted, a real row may go straight to the operator instead, which is the cost the edit accepts.

OLD:
  - They are rows of a table of their own, `overlord_drills`. Every Overlord read that would show a real row of that
    kind serves the drill too: the inbox, the packet, the board's counts, and the item, ask and mail reads. No console
    read, no other session and no older build can see one.

NEW:
  - They are rows of a table of their own, `overlord_drills`. Every Overlord read that would show a real row of that
    kind serves the drill too: the inbox, the packet, the board's counts, the item, ask and mail reads, and the
    sequence read. No console read, no other session and no older build can see one.
  - A drill's lines in `overlord_sequence` carry its mark in a column the cursor read does not serve. The invariant
    monitor reads the mark, and holds a drill to none of a real row's invariants.
  - A drill is seated only as a row the tier would make at that moment: as a held row only while `mayHold` would
    hold a real row of that kind, and only when admission can serve it beside every row already held. It counts in
    admission as a row does. It counts in no ceiling, no `max-per-day`, no settle share and no breaker count.

## model4:F16 [major]
QUOTE: After a restore, the store serves no entry and no message that the privacy journal or a witness records

PROBLEM: I11 binds the transitions that widen. A build that never narrows breaks none of I1 to I13: it keeps answers live across a release, ignores a missed drill, or leaves a fallback generation at `full`, and nothing widened. No invariant speaks of the evidence the gates read, of the judges, or of a gate row of the decision model. Of 23 planted faults, 2 are caught by I1 to I13 as worded (`mutations.out`, Table 4).

NEW:
| I14 | No answer is delivered, and no grant is used, renewed or proposed, while a latch or a condition of Table 7.2a or Table 7.5a forbids it, or on a digest and class the replay has not passed. The server narrows in the transaction that records the cause |
| I15 | An agreement joins a gate, a cell or a grant's evidence once, and only from an operator's answer scored `blind`, or for the first gate `examined`, against a prediction sealed before the first pick. A drill, a seeded call, a "You decide", an `unmeasured` answer and a question the Overlord raised add nothing |
| I16 | A drill, the replay body and the auditor cause no effect: no mail, no key press, no push and no act that counts. An armed gate row of the decision model lets an act through only on a clear yes gathered under its current key and line |

WHERE: | I13 | After a restore, the store serves no entry and no message that the privacy journal or a witness records as retired, replaced or wiped, and no id is issued twice |

## model4:F17 [minor]
QUOTE: Decision-model answers are gathered before the act's transaction and passed

PROBLEM: The answers are "gathered before the act's transaction and passed in". The text does not say what the transaction checks of them. Between the two the row can be sent back to shadow, have its line admitted again, and be armed again: a yes gathered against the old line then stages the act: `traces/decision-gathered-then-stale.txt`. The window is short, and one sentence closes it.

OLD:
  - **Answers come first, then the act.** Decision-model answers are gathered before the act's transaction and passed
    in to `overlordMayAct` (§7.1). A model is never called inside a transaction.

NEW:
  - **Answers come first, then the act.** Decision-model answers are gathered before the act's transaction and passed
    in to `overlordMayAct` (§7.1). A model is never called inside a transaction. The transaction reads the row's
    arming, key and line itself, and applies the line as it stands. An answer gathered under another key, or before
    the line was last admitted, is no clear yes.

## model4:F18 [minor]
QUOTE: A line is keyed by the host and model id, the row's revision and its request shape.

PROBLEM: The text does not say what becomes of a row's labels when its key changes, or what the operator arms after a drift. If a new model id drops the labels, each change costs 29 to 59 new label cards, at ten a week across all rows (`arith.out`, T6). If arming again needs only a tap, the row is armed on a line whose bound was measured on the model before it changed: `traces/decision-rearm-old-line.txt`. A label is the operator's verdict on a state, so the same states can be asked again.

OLD:
  - **The line's key.** A line is keyed by the host and model id, the row's revision and its request shape. Any change
    sends the row back to shadow.

NEW:
  - **The line's key.** A line is keyed by the host and model id, the row's revision and its request shape. Any change
    sends the row back to shadow. A change of host or model id keeps the row's labels: they are the operator's
    verdicts on states. The server asks those states again and admits a line by the bound. A change of the row's
    revision or request shape drops them. After a change or a drift, the operator can arm the row again only once
    a line has been admitted again.

## model4:F19 [minor]
QUOTE: A refit that makes a gate easier to pass is journalled in the authority

PROBLEM: §11.2 lists arming a row, and a refit that eases a gate, among the step-up doors. Switching an armed `grant.inside` or `scope.widens` off eases it further than any refit: what the gate deferred now passes. It has no step-up, and nothing names it among the switches that change authority (Table 11.1d), so it may have no journal record. A restore can then bring back an off switch the journal cannot contradict (§7.6): `traces/decision-off-switch.txt`. This is a design choice. The other choice leaves it a plain switch, on the ground that the design is complete without the model.

OLD:
  - **Easing a gate is an authority change.** A refit that makes a gate easier to pass is journalled in the authority
    journal (§7.6), and needs the operator's tap.

NEW:
  - **Easing a gate is an authority change.** A refit that makes a gate easier to pass is journalled in the authority
    journal (§7.6), and needs the operator's tap. So does switching an armed gate off: it lets through what the gate
    deferred. Both keep the step-up (§11.2).

## model4:F20 [minor]
QUOTE: Up to ten one-tap cards a week across all rows

PROBLEM: Twelve rows take their labels from the queue, and their lines need 378 labels in all: 38 weeks at ten a week, if every card lands beyond a line (`arith.out`, T6). The text does not say how the ten are shared. Newest case first leaves five of the twelve rows with no line after 400 weeks. Oldest case first admits `scope.widens`, the one gate among them, in week 26, and the last line in week 152. A gate first, then the row nearest its line, admits `scope.widens` in week 6 and the last line in week 38. The sweep assumes six new cases a row a week and waves eight weeks apart. This is a design choice.

OLD:
  - **The label queue.** Up to ten one-tap cards a week across all rows, with the model's answer hidden, behind the
    operator's own items. They are the operator's own one-tap cards, never rows of the Overlord's inbox. It ships in
    W2, with the first rows, so they gather labels from the start. This waits on the operator (Waiting on you, item
    5).

NEW:
  - **The label queue.** Up to ten one-tap cards a week across all rows, with the model's answer hidden, behind the
    operator's own items. They are the operator's own one-tap cards, never rows of the Overlord's inbox. The server
    shares the ten: a gate row before an advice row, then the row nearest its line, and each row with a case waiting
    gets a card at least every fourth week. It ships in W2, with the first rows, so they gather labels from the
    start. This waits on the operator (Waiting on you, item 5).

## model4:F21 [minor]
QUOTE: Is this answer inside the grant's scope? A strict yes line

PROBLEM: A 5% line needs 59 yes answers labelled right (§3.7). The row's one label source is `overturn`, and an overturn labels a yes only as wrong. A staged act that the operator let pass is no label. So the line is never admitted, and the blind check of §7.2 can never be armed (`arith.out`, `CE LQ-source`).

OLD:
| A false yes* | 5%* | `overturn` | No | W3 |

NEW:
| A false yes* | 5%* | `overturn`, `label-queue`* | No | W3 |

## model4:F22 [minor]
QUOTE: the one-sided 95% lower bound, and the window.

PROBLEM: The evidence is "the count, the one-sided 95% lower bound, and the window", and no passage gives the window a length or says whether a case ages out of it. With no window a proposal can rest on answers from before several changes of model and skill. With a window the gate needs its 152 questions inside it: 5.1 a day of one effect in one programme at 30 days, 1.7 at 90, 0.8 at 180 (`arith.out`, `CE G2-window`). The edit takes the reading towards the operator, a rolling window, and leaves its length to the plan, as Table 11.5b does for every number. The other choice is no window: a case never ages out. This is a design choice. The edit also carries the grant gate's five subjects into this sentence.

OLD:
- **Evidence is an interval, for one effect and one scope.** The server computes it from blind answers only: the count,
  the one-sided 95% lower bound, and the window. It needs spread: at least five days and distinct subjects. The floor is
  the gates table's (§9.5): 19 blind cases and a lower bound of 0.85. Why: 12 agreeing cases out of 12 prove no more
  than 78% agreement at 95% confidence. 19 of 19 prove 85%, and 29 of 29 prove 90%.

NEW:
- **Evidence is an interval, for one effect and one scope.** The server computes it from blind answers only: the count,
  the one-sided 95% lower bound, and the window. The window is rolling, and its length is a starting value (Table
  11.5b): a case older than it counts no more. It needs spread: at least five days and five subjects. The floor is
  the gates table's (§9.5): 19 blind cases and a lower bound of 0.85. Why: 12 agreeing cases out of 12 prove no more
  than 78% agreement at 95% confidence. 19 of 19 prove 85%, and 29 of 29 prove 90%.

## model4:F23 [minor]
QUOTE: Each act kind's ceiling per programme and in all

PROBLEM: Companion to the finding before it: the window reads a number, and every number is a row of Table 11.5b.

NEW:
| Set by the plan before W3 | The window of a grant's evidence: the age past which a blind case counts no more | W3 | wall |

WHERE: | Set by the plan before W2 | Each act kind's ceiling per programme and in all | W2 | wall |

## model4:F24 [minor]
QUOTE: The operator labels twenty audit rows a quarter.

PROBLEM: The judge's scores are "advisory while its agreement with those labels is low". Until the operator's first twenty labels, up to a quarter after W3, the agreement is not low: it is unmeasured. The text does not say which way that reads. Read as advisory, an audit that falls under its floor latches nothing for the first months: `traces/judges-audit-unlabelled.txt`. The edit takes the reading towards the operator: the ladder's step down only returns routing to today's. The other choice keeps an unlabelled judge advisory. This is a design choice.

OLD:
  - The operator labels twenty audit rows a quarter. The judge's scores are advisory while its agreement with those
    labels is low.

NEW:
  - The operator labels twenty audit rows a quarter. The judge's scores are advisory while its agreement with those
    labels is low. Until the first labels its agreement is unmeasured, which is not low: its scores latch as Table
    7.5a says.

## model4:F25 [minor]
QUOTE: So an answer in shadow is always a

PROBLEM: Every disagreement is `examined`, and a plain accept is `glanced` (§6.6). So the first gate counts every miss and only the accepts the operator examined. At a true agreement of 0.95 the measured agreement passes 0.85 only while at least one accept in five is examined; at two in five the gate takes about 300 answers; at 0.90 it needs 58% of accepts examined, a glanced share under the fatigue line (`arith.out`, T2). That leans towards the operator, and the edit keeps it. It states the cost, so that a kind that never arms is not read as a bad Overlord.

NEW:
  - The first gate's count leans against the Overlord, on purpose. Every disagreement is `examined`, and an accept
    counts only when the operator examined it. So a kind is armed only while the operator examines what they
    accept. At a true agreement of 0.95 the gate cannot pass while fewer than one accept in five is examined, and
    takes about 300 answers at two in five. The arming item shows the count of `glanced` accepts beside the bound.

WHERE:     sealed prediction, filed with a brief (§6.5).

## model4:F26 [minor]
QUOTE: Overlord wrote about that answer was on screen before the pick

PROBLEM: Two things. `askOrAct`'s record takes "blind answers, weekly spot-checks and overturns" (§6.3), and a spot-check that disagrees opens Overturn, so one answer adds two disagreements: `traces/spot-disagreement-counts-twice.txt`. And the test is called the blind sample's, but it is worded "about that answer", where §6.6 and §9.5 say "after the filing". No code can tell what a chat text is about. The strict wording, any chat text after the answer, would leave almost no spot-check blind: the console opens on the chat (§4), and a spot-check comes days after its answer. The edit names a test code can run. What it gives up: a chat text that hints at the answer and names neither the row's id nor its title. This is a design choice.

OLD:
  - **Three spot-checks** of recent Overlord answers the operator never saw. Each shows the question and options
    without the Overlord's pick, then reveals it. A disagreement opens Overturn (§10.3). Each is a blind answer, and
    counts as evidence (§9.5), under the blind sample's test: the console's events show that no chat text the
    Overlord wrote about that answer was on screen before the pick. Otherwise it is `examined` at most.

NEW:
  - **Three spot-checks** of recent Overlord answers the operator never saw. Each shows the question and options
    without the Overlord's pick, then reveals it. A disagreement opens Overturn (§10.3), and the two are one case,
    not two. Each is a blind answer, and counts as evidence (§9.5), under a test code can run: the console's events
    show that no chat text the Overlord wrote after that answer, naming the row by its id or its title, was on
    screen before the pick. Otherwise it is `examined` at most.

## model4:F27 [minor]
QUOTE: a real past question with a deliberately wrong answer

PROBLEM: "Never acted on" does not say what the operator's answer to it counts as. It is a real past question asked again, so it passes the precedent's code match and would be a consistency pair (§9.5). An Overturn tapped on it would count towards three overturns in 24 hours (Table 7.5a). The planted faults `seeded_is_a_case`, `seeded_is_a_pair` and `seeded_overturn_acts` show the checks bite (`mutations.out`).

OLD:
  - **One seeded wrong call:** a real past question with a deliberately wrong answer. It is marked as a drill,
    revealed at once and never acted on (Waiting on you, item 9).

NEW:
  - **One seeded wrong call:** a real past question with a deliberately wrong answer. It is marked as a drill,
    revealed at once and never acted on (Waiting on you, item 9). It adds no case, no consistency pair, no label and
    no overturn to any record. Its catch feeds M27 alone.

## model4:F28 [minor]
QUOTE: One decider, `auditorModelFor`, takes the generation's model and never

PROBLEM: The designation has two classes, `fable` and `opus` (C45). The auditor is a guest (§3.4), and no guest runs `fable`: it is the operator's choice for the designated session, and a reservation serves named sessions. So for a fallback generation on `opus` the decider has no class to return (`arith.out`, `CE AUD-total`), and no audit runs while the Overlord is off its model. This is a design choice. The other choice runs no audit then, and relies on the condition for a missing audit.

OLD:
  - **The auditor never runs the judged model.** One decider, `auditorModelFor`, takes the generation's model and never
    returns it. A judge on another model shares fewer of the Overlord's blind spots.

NEW:
  - **The auditor never runs the judged model.** One decider, `auditorModelFor`, takes the generation's model and never
    returns it. It answers `opus` for a generation on `fable`, and `sonnet`, the readers' class, for one on `opus`:
    `fable` is the operator's choice for the designated session alone (D-6790). A judge on another model shares
    fewer of the Overlord's blind spots.

## model4:F29 [minor]
QUOTE: the audit under its floor (Table 11.5b), or down ten points

PROBLEM: The ladder latches when the audit drops. Nothing follows when no audit runs: the lane is down, no class can serve the auditor, or its account is past its lines. The Overlord then answers at `full` with no judge: `traces/judges-audit-absent.txt`. The new row is a condition, so it lifts with the next verdict. This is a design choice. The other choice prints "unmeasured" on the trust line (§4.1) and changes nothing.

NEW:
| no audit verdict for longer than the audit gap (Table 11.5b) | condition | cap `advise` |

WHERE: | the audit under its floor (Table 11.5b), or down ten points | latch | cap `advise` |

## model4:F30 [minor]
QUOTE: The audit score under which the ladder latches at `advise`

PROBLEM: Companion to the finding before it: the new condition reads a number, and every number is a row of Table 11.5b.

NEW:
| Set by the plan before W3 | The audit gap: the days with no audit verdict that cap the ladder at `advise` | W3 | wall |

WHERE: | Set by the plan before W3 | The audit score under which the ladder latches at `advise` | W3 | n/a |

## model4:F31 [minor]
QUOTE: and only while no renewal is due. When no reserved account is under the soft line, it waits.

PROBLEM: "The fallback class is replayed at each release, ahead of need" (§3.4). The replay body "gets the Overlord's answer for every input of the serviceability answer", and ccd picks the class from that answer. So while the designated class can be served, the body runs it, and nothing lets the lane run the fallback class first: `traces/arming-fallback-not-ahead.txt`. A fallback then costs a rung until a replay that could not have run earlier.

NEW:
  - Each run names the class it replays: the designation's class, or the fallback class under it, and no other.
    The replay lane writes that as the body's route class, as the operator's doors write the designated session's
    (§3.4).

WHERE:     and only while no renewal is due. When no reserved account is under the soft line, it waits.

## model4:F32 [minor]
QUOTE: The "since you were last here" block and the decision queue

PROBLEM: Table 4.1a gives the operator about 24 minutes a week: two a day, and ten on the Week page with the five-minute check inside. Each promise holds by itself. Together the mechanisms ask for about 33 minutes: the label queue's ten cards, the judge's twenty labels a quarter and three spot-checks a grant every 30 days sit in no cadence with a time (`arith.out`, T9, at half a minute a one-tap card and a minute a spot-check or a label, with three grants). The label cards are the largest share with no place. The edit names where they sit. It changes no time: whether "about two minutes" holds with one or two cards a day is the operator's to rule.

OLD:
| Daily | About two minutes | The "since you were last here" block and the decision queue |

NEW:
| Daily | About two minutes | The "since you were last here" block and the decision queue. The label cards sit behind it, ten a week at most (§3.7) |

## Passages that restate an edited rule

Each phrase below occurs exactly once in the spec. None sits on a line a finding edits.

| For | Where | The phrase now | Change it to |
|---|---|---|---|
| F3 | Table 11.6, `prediction-late` | The prediction was filed after the operator answered | The prediction was filed after the operator's first pick or answer |
| F1 | Table 16a, "Agreement is inflated" | A sealed prediction is filed on every escalated item. | A sealed prediction is due on every item and ask that reaches the operator, and a missing one is a miss. |
| F10 | §9.6, "Grant renewal is oversight too" | A grant renews only after the operator answers three blind spot-checks from its | A grant renews only after the operator answers three spot-checks of acts from its |
| F10 | Table 13a, C26 | and renews only after three blind spot-checks | and renews only after three spot-checks of its acts |
| F12 | Table 10.1b, `staged`, the `voided` list | a blind check armed since the staging with no clear yes on the row | a blind check that is armed at the commit with no clear yes on the row, or stands in shadow, or holds a record from another key or line |
| F19 | Table 11.2, the operator's doors | arming a decision-model row, a decision-model refit that eases a gate | arming a decision-model row, switching an armed gate row off, a decision-model refit that eases a gate |
| F19 | §7.6, the authority journal's list | a decision-model refit that eases a gate; | a decision-model refit that eases a gate, and an armed gate row switched off; |
| F19 | Table 11.7a, I11 | The effective rung, a grant's state and a kind's arming widen only | The effective rung, a grant's state, a kind's arming and a gate row of the decision model widen only |
| F14 | §6.5, "An O-class question is settled only under a grant" | over five days and distinct subjects, and starts in shadow (§7.2). | over five days and five subjects, and starts in shadow (§7.2). |
| F15 | §6.8, "Drills arrive the same way" | that kind: the inbox, the packet, the board's counts, and the item, ask and mail reads. So it looks like a real | that kind: the inbox, the packet, the board's counts, the item, ask and mail reads, and the sequence read. So it looks like a real |
| F29 | §3.3.5, C42 | latches the ladder at `advise` (§7.5). | latches the ladder at `advise` (§7.5). A gap with no verdict caps it there too. |
| F16 | "In short" | thirteen stated invariants | sixteen stated invariants |
| F16 | §10.4, the invariant monitor | I1 to I8 and I10 to I13 everywhere | I1 to I8 and I10 to I16 everywhere |
| F16 | Table 11.7b, the simulator | I1 to I13 under faults | I1 to I16 under faults |
| F16 | §11.7, "Why" | machines, for the same reason. | machines, for the same reason. I14 to I16 were added after a model of the evidence, the gates and the judges. |

## What this model assumed

- **Counts are derived from rows.** A gate's count, a cell's record and a grant's evidence are read as views over
  answer rows, so a crash cannot add a case twice. The text never says where a count is stored.
- **The brief recommends one option and the prediction names one.** The two doors are separate, so the machine lets
  them differ.
- **A blind answer on a row the Overlord did not answer joins a cell** by the evidence class of its sealed
  prediction's cited ids. The text gives a cell no other source before it acts (F7).
- **Two replays of one set are independent** in the false-failure figures. They replay the same questions, so the
  real rate is lower. The figure for one changed answer does not depend on it.
- **Operator behaviour** in Table 5 is a parameter: the true agreement, and the share of accepts examined.
- **A cell's record has no window, and is not split by model or lane.** The text gives it neither. A case never
  ages out, and a change of model, skill or card is judged by the third gate alone (F5, F6).
- **The label queue's sweep** assumes six new cases a row a week and waves eight weeks apart.

## What this model still does not cover

- **The replay body's reads.** "Every read door it calls serves as of the question's date" is taken as true for the
  history door, the card and the notes. Whether the history store can serve as of a date is a builder's question.
- **The replay's cost.** The replay set has no cap and the text does not say whether a replay resumes after a
  renewal comes due. Its token cost is not in the spec, so no figure is given.
- **How "the replay body can tell a drill from a real case" is measured.** No door, sample or threshold is stated.
  A drill has no line in its coordinator's history, so a body that looks there can always tell.
- **Fatigue and supervision debt.** `fatigueSignals` was not modelled beyond the glanced share. With the blind
  sample off, the deference gap has no blind side. A bulk Seen clears supervision debt in one tap: the text counts
  it as `glanced`, and M27 reports it.
- **Whether a label can be shaped by the Overlord.** `routed-to` rests on the Overlord's own route and its owner's
  acceptance. A label card shows the operator the Overlord's own text. Neither was modelled.
- **Which rows may run on which host.** The `private-state` column of Table 3.7b was not checked against each row's
  state fields.
- **Whether the feed tells the Overlord, after the answer, which rows were blind.** With a random sampler that
  shows no pattern. With a counter it would.
- **The auditor's sample and its seeded bad rows**, the scenario suite, the flip rate and the echo excess.
- **What the Overlord learns from answers** (§9.1 to §9.3): the evidence classes, corroboration, and the rule that
  an accept of a recommendation is `ratified` and never `stated`. Round three's privacy machine covers the store's
  writes, and not this loop.
- **The other decision-model rows.** Only a gate row was run through a machine. The advice rows fail open by
  Table 3.7b, and round three checked that direction row by row.
- **A first prediction filed after the operator's hint.** F3 closes a second prediction, not a late first.
- **Time.** Observed time, the veto clock and the wall clock are ticks here. Rounds one and two cover the clocks.
