# Model check of the Overlord design, round three: accounts, privacy and the joint cases

Run against the edition of `docs/superpowers/specs/2026-11-09-overlord-design.md` that #2538 merged. #2539 writes the findings into
the spec, with two replaced by a rule of the editor's (F3 and F16 here: the Overlord's load on a reserved account reads
its reserve). Round one (the parent directory) covered holds, readiness, generations and the push outbox.
Round two (`../model2/`) covered authority, restore, requests, commands, the push budget and playbook entries, each
machine on its own. This round covers the machines neither touched: accounts and reservations, the operator's
messages, the operator model and the privacy rules. It also covers the joint cases round two took from separate
machines.

## 1. Summary

- **What was modelled.** Eight small machines on round two's explorer (`explore.py`, copied unchanged), and one
  exhaustive sweep of the reservation arithmetic (`arith.py`). Each rule cites its section in a comment. Where the
  text is silent or two passages disagree, the rule reads a named switch, and both readings are run.
- **Result.** Under one consistent set of readings (the "safe" readings) every check holds within the bounds:
  425,554 states over 38 scenarios. The text does not settle those readings.
  Of the 49 other readings in Table 3, 47 break a stated rule, a stated invariant or a check this
  model adds. 34 of the 49 are the text as written. The arithmetic sweep breaks six of its nine checks
  under the text, and none under the fix.
- **Findings.** 30: 0 blocker, 15 major, 15 minor. Four of the minor ones are
  companions: a second passage that restates a rule a larger finding changes (F16, F21,
  F24, F25).
- **Mutations.** 28 planted faults, 0 missed. Only 3 are caught by I1 to I12 as worded. The
  other 25 are caught only by checks this model added, so they are gaps in the invariants (Table 4).
- **Total explored.** 1,684,368 states: 487,304 over the matrix (87 runs, about 6 seconds) and
  1,197,064 over the mutation runs. The sweep adds about 930,000 answers of the reservation rule.

### What each machine holds, and its bounds

Time moves in ticks of 30 minutes where a machine has time. A server lane runs before the clock moves on, but a door
call or a tap can still fall before it. Every fault and every tap has a budget, named in each file's `DEFAULT`. A
run stops at 600,000 states and reports `BOUND`. No run reaches it.

| Machine (file) | What it holds | Faults injected |
|---|---|---|
| arithmetic (`arith.py`) | One reserved account at one percentage point: the reserve, what is left of it, a guest's ceiling in both windows, the second line, the Overlord's Fable arm, the reason words. Table 3.4c is reproduced first | A stale share reading, an unmeasured seven-day figure |
| swap (`m_swap.py`) | Two reserved accounts and one other, each with a load level (under 70, past 70, past 85, at its limit) and a Fable share (room or spent). The Overlord's account and class, ccd's pick, the settle, the degraded stamp and its hold-down, the triggers of Table 3.3.11b that read accounts, the soft budget and the least age, the hard-block rescue, `stranded` | A stale share reading, stale limit samples, a session crash, a clock on the fleet host that steps back, a limit that hits in the middle of a turn |
| guest (`m_guest.py`) | One guest (Fable, Opus or no class), one reserved account in tens of points, one other account. Placement, the stay gate, the second line, the manual move and its pin, the reason word, the operator item after two sweeps | A stale share reading, an unmeasured seven-day figure, the other account filling |
| served (`m_served.py`) | The ids a reservation serves, on the server and in the document ccd reads. One designation, one rebind, one replay run | A period in which the document cannot be refreshed |
| evaldue (`m_evaldue.py`) | The "evaluation due" trigger, the digest a generation was minted with, the replay gate, the replay lane's wait on a due renewal, the soft budget | A release, a spent soft budget |
| privacy (`m_privacy.py`) | One entry (stated from a message, or inferred from history) with a statement version. Confirm, Edit, Retire, supersede, wipe, pause, exclude. The carriers of its words: the context, the notes and the checkpoint, a staged act. `state-a-fact`. The feed cursor, the distillation, the privacy journal, one snapshot | A restore of the private store, a restore of the whole volume |
| message (`m_message.py`) | One message row and the root request that cites it, in two files. Ids, `settled`, `spent`, the 24 hours, the boot pass, relays under the root, a wipe | A server crash between the two files, a restore of `coord.db` alone, of the private store alone, of the whole volume |
| joint (`m_joint.py`) | One grant with `max-per-day:1`, two items, a staged act on each, a held row, a request, the veto clock and a Veto that can arrive late, the act journal, the reconciliation pass, request ids | A restore of `coord.db` alone and of the whole volume, the mint of a later generation |
| parent (`m_parent.py`) | A parent, two children and one replacement through the moves of Table 5.1b, with their follow-up times | A server crash, a decline, a failure, a withdraw, a follow-up lapse |

*Table 1. The machines.*

| Machine | Scenario | Bounds | States | Transitions |
|---|---|---|---|---|
| swap | guests | two reserved accounts and one other; 3 uses by guests; 2 ticks | 124 | 321 |
| swap | load | two reserved accounts; 5 uses by the Overlord, 1 window reset; 2 ticks | 2,067 | 5,075 |
| swap | hover | two reserved accounts, one share spent; 2 spends, 2 ageings; 5 ticks | 7,674 | 20,608 |
| swap | return | two reserved accounts; 1 spend, 1 ageing, 1 use; 4 ticks | 995 | 2,557 |
| swap | rescue | three accounts; 3 own uses, 2 guest uses, 1 spend, 1 reset, 1 crash; 3 ticks | 313,542 | 1,154,064 |
| swap | stale | two reserved accounts; each reading goes stale and fresh once; 1 crash; 3 ticks | 81,053 | 344,352 |
| swap | skew | a fallback stands; 1 clock step of 3 ticks; 5 ticks | 673 | 1,355 |
| swap | blocked | one account past 85, one at its limit; stale limit samples; 1 reset | 824 | 2,224 |
| guest | opus | figures in tens; 4 uses, 2 Fable steps of 20, 1 stale, 1 unmeasured, 1 manual move | 2,454 | 8,295 |
| guest | opus-nowhere | the same, the other account full | 624 | 1,916 |
| guest | default | a guest with no class | 465 | 1,302 |
| guest | fable | a guest on Fable; another account with room | 414 | 1,383 |
| guest | fable-nowhere | a guest on Fable; no other account | 72 | 186 |
| guest | stale | reserve spent, 90 of the window used; the reading goes stale and fresh | 102 | 247 |
| served | ids | 1 designate, 1 rebind, 1 replay run, 1 period with no refresh | 132 | 242 |
| evaldue | release | 1 release; 4 ticks; soft budget 3, 1 refill | 24 | 34 |
| evaldue | release-budget-spent | the same, the soft budget spent at the release | 34 | 57 |
| privacy | withdraw | one stated entry; 1 Retire, 1 Edit, 1 wipe; 2 reads, 1 note, 1 answer | 207 | 333 |
| privacy | fact | one stated entry; 2 `state-a-fact` calls, 1 Edit, 1 supersede, 1 Confirm | 132 | 282 |
| privacy | fact-inferred | one inferred entry; 1 `state-a-fact` call, 1 Confirm | 10 | 12 |
| privacy | staged | one entry cited by one staged act; 1 Retire, 1 Edit | 41 | 52 |
| privacy | restore | one history source, not yet learned; 1 snapshot, 1 restore of the store; 3 distillations | 403 | 647 |
| privacy | restore-learned | the same, the entry learned before the snapshot | 233 | 401 |
| privacy | restore-volume | the same, the whole volume restored | 113 | 154 |
| privacy | controls | pause twice, exclude once, 1 snapshot, 1 restore | 174 | 221 |
| message | crash | one message; 2 open calls, 1 crash, 24 hours | 87 | 144 |
| message | restore-volume | two messages at most; 1 snapshot, 1 restore of the whole volume | 297 | 430 |
| message | restore-db | 1 snapshot, 1 restore of `coord.db` alone | 222 | 348 |
| message | restore-store | 1 snapshot, 1 restore of the private store alone | 279 | 431 |
| message | wipe | 1 wipe; 2 relays, 1 `goals modify` by the owner | 87 | 102 |
| message | wipe-volume | 1 wipe, 1 snapshot, 1 restore of the whole volume | 72 | 98 |
| joint | veto | one staged act; 1 Veto tap that can arrive late | 9 | 8 |
| joint | cap | `max-per-day:1`; two items, 1 Veto, 1 mint of a later generation | 38 | 49 |
| joint | restore-db | a held item, a staged act, a request; 1 snapshot, 1 restore of `coord.db`; 2 opens | 5,798 | 9,671 |
| joint | restore-volume | the same, the whole volume restored | 5,148 | 7,929 |
| parent | split | a parent, two children, one replacement; 1 decline, 1 failure, 1 crash | 728 | 1,368 |
| parent | split-unnamed | the second child waits for the operator's tap; 1 follow-up lapse | 126 | 222 |
| parent | withdraw | 1 withdraw of the parent, 1 of a child | 77 | 183 |
| | Total, safe readings | | 425,554 | 1,567,303 |

*Table 2. States under the safe readings. `matrix.out` has every run.*

### The checks, and which readings break them

I1, I3, I7 and I12 are checked where they apply. The other names are this model's. Each is a rule the text states,
except GW, GSTALE, PV5 and A2 to A6, which this model adds and the findings argue for:

- **arithmetic.** A1: guests spend at most half of what is left of the reserve. A2: with reserve left, guests' use
  alone leaves the account under the Overlord's soft and harder lines. A3: a stale reading never raises a guest's
  ceiling. A4: a stale reading moves no guest in the middle of its turn. A5: a refusal the reservation causes says
  `reserved`. A6: a spent reserve refuses no guest. A7: guests' use never refuses the Overlord Fable under its
  ceiling.
- **swap.** STORM: no three renewals in a row with nothing between them. OWN: guests' use alone neither moves the
  Overlord off a reserved account whose reserve has room, nor puts it on Opus (C46). STRAND: `stranded` only when no
  account can serve (Table 6.4a). FLIP: the hold-down holds the first soft renewal after a fallback (§3.4). STALE:
  unmeasured keeps the current class. C45: a conversation carried onto another class has a renewal due. RES: Fable
  only on a reserved account. MOVE: between renewals only the rescue moves it (C57). SOFT: the pick passes over an
  account past the soft line. BUD: the soft budget and the least age. HD: the hold-down lasts its minutes, no less
  and no more. NOSERVE: a stranded Overlord gets out by itself once an account can serve. RETURN: it goes home.
- **guest.** GF: no guest runs Fable on a reserved account. GW: a guest the reservation turns away is told
  `reserved`. GRES: A1 in motion. GU: an unmeasured figure admits no guest and moves none. GMAN: a manual move is
  never refused. GSTALE: A4 in motion. GL: a guest past its line leaves, or the operator has an item.
- **served.** SV1, SV2: the Overlord's own start, and a replay body's, are never answered `reserved`. SVL: a
  `pending` row never stands for ever.
- **evaldue.** EV1: after a release the replay can pass. EV2: a renewal clears its own trigger. EV3: the replay
  runs only while no renewal is due. EV4: answers stay in shadow until the replay passes.
- **privacy.** PV1: no generation keeps a withdrawn entry's text in context once the renewal has landed (§3.3.5).
  PV2: no act uses a withdrawn entry. PV3: the store never serves again what the operator retired, replaced or
  wiped (§9.4 rule 12). PV4: `state-a-fact` needs a stated entry resting on an operator message. PV5: and one whose
  span the operator saw. PV6: nothing is learned while learning is paused or a project is excluded. PV7: no entry id
  is issued twice. PV8: the Overlord does not retire a stated entry.
- **message.** MS1: one message founds one root request. MS2: no message id is issued twice. MS3: a wiped message
  authorises nothing. MS4: a message that reads `settled` is cited by a row or was acknowledged. MS5: the 24 hours.
  MS6: a restore brings back no wiped message.
- **joint.** J1: a Veto has an effect. I3. J3: `max-per-day`. J5: no act under a withdrawn request. I7. I1. J8: no
  request id is issued twice.
- **parent.** I12. PA1: a parent whose children are done closes by the server alone. PA2: a parent the operator
  answered can still reach `done`. PA3: no relay under a withdrawn root. PA4: a parent is done only when its
  children are. PA5: no move leaves a terminal state. PA6: a child that ended other than done is told.

| Machine | Scenario | Reading (switch=value) | Is it the text? | Breaks | Finding |
|---|---|---|---|---|---|
| swap | guests | `GUEST_REACH=2` | the text | OWN | F3 |
| swap | guests | `GUEST_REACH=1` | the text | OWN | F3 |
| swap | load | `HARD85_TARGET=False` | the text | STORM | F1 |
| swap | load | `HARD85_TARGET=False PICK_ALL_PAST=stranded` | one reading | NOSERVE STRAND | F2 |
| swap | load | `PICK_ALL_PAST=stranded` | one reading | STRAND | F2 |
| swap | return | `PICK_ORDER=listed` | one reading | OWN RETURN | F2 |
| swap | hover | `HOLD_MIN=30` | the text | FLIP | F20, F21 |
| swap | skew | `STAMP_CLAMP=False` | the text | HD OWN | F20 |
| guest | opus | `REASON_ALL=False` | the text | GW | F18 |
| guest | default | `REASON_ALL=False` | the text | GW | F18 |
| guest | opus-nowhere | `REASON_ALL=False` | the text | GW | F18 |
| guest | stale | `STALE_SECOND=True BASE=text` | the text | GSTALE | F19 |
| guest | stale | `STALE_SECOND=True` | the text | GSTALE | F19 |
| guest | opus | `BASE=text` | the text | nothing | F3 |
| served | ids | `START=at-once` | one reading | SV1 SV2 | F4 |
| served | ids | `START=at-once SERVE_PENDING=False` | one reading | SV1 SV2 | F4 |
| evaldue | release | `EVAL_DUE=gate` | the text | EV1 EV2 | F5 |
| privacy | withdraw | `CARD_CARRIES=rendered` | the text | PV1 PV2 | F8 |
| privacy | withdraw | `WIPE_RULES=False` | the text | PV2 | F23 |
| privacy | fact | `EDIT_SOURCES=kept` | one reading | PV2 | F9, F25 |
| privacy | fact | `ACTIVE_ONLY=False` | the text | PV2 | F9, F24 |
| privacy | fact | `FACT_SEEN=False` | the text | PV5 | F10 |
| privacy | staged | `COMMIT_RECHECK=False` | one reading | PV2 | F26 |
| privacy | restore | `TOMBSTONE=False` | the text | PV1 PV3 | F7 |
| privacy | restore | `WIPE_CURSORS=rewind` | the text | PV1 PV3 | F7 |
| privacy | restore-learned | `WIPE_CURSORS=wiped` | one reading | PV1 PV3 | F7 |
| privacy | restore-learned | `EDIT_JOURNAL=False` | the text | PV1 PV3 | F7 |
| privacy | restore | `ENTRY_IDS=store` | the text | PV7 | F22 |
| privacy | restore-volume | `WITNESS=False` | the text | PV1 PV3 | F6 |
| message | crash | `SPENT_READ=state BOOT_SPENT=False` | the text | MS1 | F11 |
| message | restore-volume | `RESTORE_SPENDS=False` | the text | MS1 | F11 |
| message | restore-store | `RESTORE_SPENDS=False SPENT_READ=state` | the text | MS1 | F11 |
| message | restore-db | `REDERIVE=adds-only` | one reading | MS4 | F27 |
| message | wipe | `WIPE_REQUESTS=stay` | the text | MS3 | F28 |
| message | restore-volume | `WITNESS_IDS=False` | the text | MS2 | F6 |
| message | wipe-volume | `WITNESS_IDS=False` | the text | MS6 | F6 |
| joint | veto | `LATE_VETO=superseded` | one reading | J1 | F12 |
| joint | veto | `LATE_VETO=ignored` | one reading | J1 | F12 |
| joint | cap | `COUNTS=effects` | one reading | nothing | F29 |
| joint | cap | `COUNTS=effects COMMIT_RECOUNT=False` | one reading | J3 | F29 |
| joint | restore-db | `RECONCILE=lacks` | the text | I3 | F13 |
| joint | restore-db | `REQ_JOURNAL=False` | the text | J5 | F14 |
| joint | restore-volume | `REQ_JOURNAL=False` | the text | J5 | F14 |
| joint | restore-db | `REQ_IDS=table` | the text | J8 | F22 |
| joint | restore-volume | `REQ_IDS=table` | the text | J8 | F22 |
| parent | split | `PARENT_CLOSE=after` | one reading | I12 PA1 PA4 | F15 |
| parent | split | `PARENT_ANSWER=stays` | the text | PA2 | F15 |
| parent | withdraw | `WITHDRAW_CASCADE=False` | one reading | PA3 | F15 |
| parent | split-unnamed | `I12_READ=literal` | the text | I12 | F30 |

*Table 3. Every reading that is not the safe one. "The text" means the sentence gives that behaviour. "One reading"
means the text is silent, or two passages disagree, and this is a reading a builder could take.*

### The planted faults

| Machine | Planted fault | Caught by | By a stated invariant? |
|---|---|---|---|
| swap | `no_holddown` | FLIP HD | no |
| swap | `stale_reads_unservable` | STALE | no |
| swap | `no_resumed_trigger` | C45 | no |
| swap | `affinity_not_stood_down` | MOVE | no |
| swap | `pick_ignores_soft` | SOFT STORM | no |
| swap | `fable_off_reserve` | RES | no |
| swap | `soft_ignores_budget` | BUD | no |
| swap | `rescue_never_retries` | NOSERVE | no |
| guest | `fable_guest_served` | GF GU | no |
| guest | `unmeasured_admits` | GU | no |
| guest | `manual_refused` | GMAN | no |
| guest | `pin_holds_past_line` | GL | no |
| served | `start_before_sync` | SV1 | no |
| evaldue | `replay_ignores_due` | EV3 | no |
| evaldue | `answers_before_replay` | EV4 | no |
| privacy | `no_hard_renewal` | PV1 PV2 | no |
| privacy | `fact_from_inferred` | PV4 PV5 | no |
| privacy | `learns_while_paused` | PV6 | no |
| privacy | `overlord_retires_stated` | PV8 | no |
| message | `id_from_store` | MS2 | no |
| message | `spent_ignored` | MS1 MS5 | no |
| message | `wiped_still_cited` | MS3 | no |
| joint | `cap_ignored` | J3 | no |
| joint | `restore_keeps_grants` | I7 | I7 |
| joint | `restore_keeps_holds` | I1 | I1 |
| parent | `parent_done_early` | PA4 | no |
| parent | `child_fail_silent` | I12 PA6 | I12 |
| parent | `terminal_moves` | PA4 PA5 | no |

*Table 4. The planted faults. Each run differs from a safe run by one fault.*

Three of the 28 are caught by an invariant of Table 11.7a: a restore that keeps a grant live (I7), a restore
that keeps a hold (I1), and a failed child the parent is not told of (I12). Table 11.7a has no invariant for the
accounts, the reservation, the operator's messages or the privacy rules, so none of the faults in the swap, guest,
served, evaldue, privacy and message machines can break one. F30 adds an invariant for the privacy rules. For
the accounts the nearest stated thing is a measure, M32, with a target of zero.

### The design choices in a NEW

Most findings settle a reading. These NEW texts choose between two designs, and each PROBLEM names the other one:

- F3: a guest's ceiling counts from the soft line, not from 98.
- F4: a session starts only once the reservations document names it.
- F7: a wipe moves every feed's cursor to its end.
- F8: after an entry changes, the next card withholds the checkpoint and that generation's notes.
- F10: `state-a-fact` needs an entry the operator confirmed, or a quote that is the whole message.
- F12: a Veto that arrives after the commit is `overturned`, and latches the grant.
- F15: once the operator has answered a parent, a child that ended other than done no longer counts.
- F19: a stale share reading moves no guest in the middle of its turn.
- F20: the hold-down is one hour.
- F28: a wipe moves the open requests that cite only wiped messages to `needs-you`.
- F29: every act row under a grant counts towards `max-per-day`, but a `refused` one.

### The findings at a glance

| # | Severity | Title |
|---|---|---|
| F1 | major | The 85% trigger renews without end when no account is under the soft line |
| F2 | major | ccd's pick does not say what it takes when every account is past the soft line, or where the class comes in |
| F3 | major | Guests may fill a reserved account past the Overlord's own lines while its reserve has room |
| F4 | major | The Overlord's own first start, and a replay body's, are answered `reserved` |
| F5 | major | "Evaluation due" stays true after its own renewal, and the replay then never runs |
| F6 | major | A restore of the whole volume un-wipes: no witness holds the privacy journal |
| F7 | major | A restore brings back an entry the operator retired, replaced or wiped |
| F8 | major | The card after the renewal hands the withdrawn text to the next generation |
| F9 | major | `state-a-fact` is covered by a superseded entry, and after an Edit it answers with the old words |
| F10 | major | An entry the operator never saw can answer an O5 item with a span the Overlord cut |
| F11 | major | One message can found two root requests: after a crash, and after a restore |
| F12 | major | A Veto that arrives after the commit has no stated effect |
| F13 | major | The reconciliation pass leaves an act row that is behind its settle record |
| F14 | major | A restore hands back a request the operator withdrew, and may not be detected |
| F15 | major | A parent request can wedge: it never closes, it cannot leave `needs-you`, and its children outlive it |
| F16 | minor | Table 3.4c still counts the guest's ceiling from 98 (companion of the guest-ceiling finding) |
| F17 | minor | The five-hour line still sets the whole reserve aside once the reserve is spent |
| F18 | minor | A guest the lowered ceiling turns away is not told why |
| F19 | minor | A share reading that goes stale moves guests in the middle of their turns |
| F20 | minor | The hold-down is no longer than a generation's least age, and has no rule for a clock that steps back |
| F21 | minor | Table 11.5b gives the hold-down as 30 minutes (companion of the hold-down finding) |
| F22 | minor | Request ids and entry ids are issued twice across a restore |
| F23 | minor | A wipe does not raise the rules version, so doors stay open until the turn ends |
| F24 | minor | `entry-retired` names retired entries only (companion of the `state-a-fact` finding) |
| F25 | minor | The text does not say what an Edit does to an entry's sources (companion of the `state-a-fact` finding) |
| F26 | minor | The commit of a staged act does not look at the entries it cites |
| F27 | minor | The boot pass does not say it un-settles a message whose request is gone |
| F28 | minor | After a wipe, a request that cites only wiped messages stays open with its owner |
| F29 | minor | `max-per-day` does not say whether a staged, vetoed, voided or preempted act counts |
| F30 | minor | I12 read to the letter fails on a correct state, and no invariant covers the privacy rules |

## 2. How to re-run

Python 3, standard library only. From this directory:

```
python3 arith.py                                  the arithmetic sweep, under the text and under the fix
python3 check.py --list                           machines, scenarios, readings, mutations
python3 check.py --matrix > matrix.out            every scenario under the safe readings, then every other reading
python3 check.py --mutations > mutations.out      the planted faults
python3 check.py --traces                         writes traces/<name>.txt for the machines
python3 arith.py --traces                         writes traces/arith-*.txt
python3 check.py swap load HARD85_TARGET=False    one run; prints each violated check with its shortest trace
```

A trace is the shortest path the explorer found. A liveness check (NOSERVE, RETURN, GL, SVL, EV1, PA1, PA2) says a
path exists on the bounded graph. It is not a fairness guarantee.

## 3. Findings

Most severe first. QUOTE locates the passage, and occurs once in the spec. OLD is copied from the spec by line
range, and occurs once. Where a finding inserts text, WHERE gives the line it goes after. No two findings edit the
same lines.

## model3b:F1 [major]
QUOTE: It comes before ccd's hard-block swap in the middle of a turn.

PROBLEM: The 85% trigger is hard, so it ignores the soft budget and a generation's least age (§3.3.11). It reads the current account only. When no other listed account is under the soft line, the renewal lands on the same account or a fuller one, and the trigger is true again at once. An idle Overlord then renews without end, and each renewal spends more of the window: `traces/swap-renewal-storm.txt`. The trigger's row in Table 3.3.11b and the 85% row of Table 3.4b need the same condition.

OLD:
  - **A pre-emptive move at idle.** Between renewals, when the current account passes the harder line (85% by default)
    and the Overlord is idle, the renewal lane renews it onto another account at once. That is a hard trigger of
    `renewalDue` (Table 3.3.11b). It comes before ccd's hard-block swap in the middle of a turn.

NEW:
  - **A pre-emptive move at idle.** Between renewals, when the current account passes the harder line (85% by
    default), the Overlord is idle and another listed account that can serve it is under the soft line, the renewal
    lane renews it onto that account at once. That is a hard trigger of `renewalDue` (Table 3.3.11b). With no such
    account the trigger is not due: a renewal would land on the same account or a fuller one, and be due again at
    once. It comes before ccd's hard-block swap in the middle of a turn.

## model3b:F2 [major]
QUOTE: Both are new in ccd's pick, which today ranks by load alone.

PROBLEM: The pick names listed order and the soft line only. It does not say what ccd takes when every listed account is past the soft line. Read as "none", a routine renewal with every account past 70% ends in `stranded` while each account can still serve: `traces/swap-stranded-with-room.txt`. It does not say where the class comes in either. Read as listed order first, with the class asked at the settle, it composes Opus on the first account whose share is spent while the next reserved account has room, against §3.4's "the next generation runs on the next one": `traces/swap-listed-pick-skips-the-next-account.txt`.

OLD:
  - **An ordered list, picked by ccd (C56, H16).** The server writes the Overlord's ordered account list on its registry
    row, through the route verb, as a route field this design adds (today `cmd_route` refuses any field outside
    `ROUTE_FIELDS`). At the renewal's fresh start ccd picks from the list in listed order before load, and passes over
    an account past the soft line. Both are new in ccd's pick, which today ranks by load alone. Table 3.4a gives the
    order. The server leaves out an account where a start loaded something the profile does not list, until the
    operator clears the item (§3.6).

NEW:
  - **An ordered list, picked by ccd (C56, H16).** The server writes the Overlord's ordered account list on its registry
    row, through the route verb, as a route field this design adds (today `cmd_route` refuses any field outside
    `ROUTE_FIELDS`). At the renewal's fresh start ccd picks from the list in three steps. First, the first listed
    account under the soft line that can serve the designated class, once the hold-down allows that class. Next, the
    first listed account under the soft line, on the fallback class. Last, when every listed account is past the
    soft line, the least loaded one that can serve it at all, the designated class first. Only when no account can
    serve it does readiness read `stranded`. Listed order and the soft line are new in ccd's pick, which today ranks
    by load alone. Table 3.4a gives the order. The server leaves out an account where a start loaded something the
    profile does not list, until the operator clears the item (§3.6).

## model3b:F3 [major]
QUOTE: Every other class meets a lower ceiling: the seven-day ceiling (98) minus what is left of the reserve.

PROBLEM: The guest's ceiling counts from 98. The Overlord's own lines count the whole figure: its pick passes over an account at 70, the 85% line makes a renewal due, and the load lines stop background work and holds (§6.8). With a reserve of 40 and guests at their ceiling, the Overlord passes the soft line after 12 points of Fable and the harder line after 27. A guest in a long turn can take the figure to 78 before ccd moves it, past the soft line with the reserve untouched. So guests' use alone moves the Overlord off its own account, or onto Opus on another, while its reserve has room: `traces/arith-reserve-under-the-lines.txt`, `traces/swap-guests-move-the-overlord.txt`, `traces/swap-guests-push-it-to-opus.txt`. This is a design choice. The NEW counts the guest's ceiling from the soft line. The other choice keeps 98 and sets the default reserve to 68, the Fable ceiling plus the 28 points between the soft line and 98: guests then stay capped at 70 after the Overlord's Fable is spent.

OLD:
    - Every other class meets a lower ceiling: the seven-day ceiling (98) minus what is left of the reserve. What is
      left is the reserve minus the Fable the account has used in the window, never below zero. An unmeasured or
      stale reading counts as nothing used, so the whole reserve is kept.

NEW:
    - Every other class meets a lower ceiling while anything is left of the reserve: the soft line (70, C57) minus what
      is left. What is left is the reserve minus the Fable the account has used in the window, never below zero. An
      unmeasured or stale reading counts as nothing used, so the whole reserve is kept. Counted from the seven-day
      ceiling instead, guests at their ceiling would hold the account past the soft line, and the Overlord's own pick
      would pass over its own account with its reserve unspent. Once nothing is left, the ceiling is today's, 98.

## model3b:F4 [major]
QUOTE: The served ids come from server rows, so no session can name itself.

PROBLEM: The served ids reach ccd in a document that a fleet-host timer renders (Table 11.1c). Nothing orders that sync and a session's first start. The designate and rebind doors create the session in the door (§3.2), so its first start reads a document that does not name it. ccd answers the Overlord's own first start `reserved`, it begins on Opus, and the hold-down keeps it there until a later renewal. A replay body starts the same way and replays on the wrong class: `traces/served-first-start-is-a-guest.txt`. "The designated session" also leaves open whether a `pending` binding is served. Waiting for the sync is a design choice. The other choice starts at once, and makes a renewal due, outside the hold-down, when a start report shows the session ran as a guest.

NEW:
  - **An id is served before its session starts.** The served ids include the session of a `pending` binding, and
    the replay body from the moment the lane asks for a run. The designate and rebind doors and the replay lane
    start a session only once every agent that can place sessions holds a reservations document that names it.
    Started sooner, the Overlord's own first start would be answered `reserved`, and it would begin on the fallback
    class under the hold-down. If no such document arrives by the `pending` row's deadline, the start fails as a
    start that never reports does (§3.2).

WHERE:     local tag could not do this: it is a flat file any session can write with `ccd project-pool`.

## model3b:F5 [major]
QUOTE: Evaluation due: the model, the skill or the card template changed since the last generation that passed

PROBLEM: "The last generation that passed" reads as the last one that passed the replay gate: §9.5 says this trigger "holds answers in shadow until the third gate passes". The trigger then stays true after its own renewal. The replay body runs "only while no renewal is due" (§3.4, §9.5). So after a release the replay never runs, the gate never passes, answers stay in shadow, and soft renewals repeat at the budget's rate: `traces/evaldue-replay-never-runs.txt`.

OLD:
| Evaluation due: the model, the skill or the card template changed since the last generation that passed | soft | overlord | A digest of the skill, the card template version and the model id. Until the replay passes, answers are in shadow (§9.5) |

NEW:
| Evaluation due: the skill, the card template or the model id is not the one this generation was minted with | soft | overlord | A digest of the three, stored on the generation row at its mint. One renewal clears the trigger. Answers stay in shadow until the replay passes that digest (§9.5). The replay lane waits while a renewal is due, so it runs once this one has landed |

## model3b:F6 [major]
QUOTE: The server sends it, with the head hashes of those two journals, to every agent and every

PROBLEM: The privacy journal is "a file outside every snapshot" (§9.4 rule 12), but a snapshot of the whole volume carries it, as this paragraph says of the authority journal. The witness holds the epoch and the heads of the authority and act journals only, and the epoch does not rise on a privacy record. So a whole-volume restore after a wipe is not detected when nothing else was journalled since. The wipe's record is gone with the journal, and the store comes back: `traces/privacy-volume-restore-unwipes.txt`, `traces/message-volume-restore-unwipes.txt`. The journal's highest message id goes back too, so a message id is issued twice: `traces/message-volume-restore-reuses-an-id.txt`.

OLD:
- **A witness outside the volume.** A volume snapshot restores the database and the journal together, so the journal
  alone cannot see it. The server's authority epoch rises with every authority record and every settle record of
  the act journal. The server sends it, with the head hashes of those two journals, to every agent and every
  signed-in console. Each keeps the highest it has seen. A server whose epoch is lower than a witness's, or whose
  journals do not hold the witness's heads, refuses `authority-rolled-back`. So records written after a restore
  cannot catch the epoch up.

NEW:
- **A witness outside the volume.** A volume snapshot restores the database and the journals together, so no journal
  alone can see it. The server's authority epoch rises with every authority record, every settle record of the act
  journal and every record of the privacy journal. The server sends it, with the head hashes of the three journals
  and the highest id issued of each kind, to every agent and every signed-in console. Each keeps the highest it has
  seen. A server whose epoch is lower than a witness's, or whose journals do not hold the witness's heads, refuses
  `authority-rolled-back`. So records written after a restore cannot catch the epoch up.

## model3b:F7 [major]
QUOTE: replayed after a restore, so a restore never un-wipes.

PROBLEM: Three ways a restore of the private store brings back what the operator took away, with the journal standing. (1) An entry learned after the snapshot and then retired: the replay finds no row to retire, the cursors rewind, and the distillation proposes the entry again: `traces/privacy-restore-unretires.txt`. (2) A wipe: the cursors rewind to the snapshot's, so what was learned between the snapshot and the wipe is learned again: `traces/privacy-restore-unwipes.txt`. (3) An Edit or a supersede is no privacy event, so the statement the operator replaced is served again: `traces/privacy-restore-unedits.txt`. The whole-volume case is the finding before this one. The NEW also settles what a wipe does to the cursors with no restore. That part is a design choice: it moves them to the end of each feed. The other choice leaves them, and what was unread before the wipe is still learned after it.

OLD:
  - Its privacy events (a wipe, a retirement, a project excluded, learning paused) go to the privacy journal and are
    replayed after a restore, so a restore never un-wipes.
  - "Wipe everything" also removes the copies under the backups directory, or names the ones it leaves. The wipe
    sheet also names what stays on the fleet host: the Overlord's transcripts and its history family (§9.2).
  - The feeds' cursors carry the restore generation, and rewind.

NEW:
  - Its privacy events go to the privacy journal and are replayed after a restore, so a restore never un-wipes: a
    wipe, a retirement, an Edit, a supersede, a project excluded and learning paused. A record holds no words. For
    an entry it holds the id, the subject, the scope and the source ids. A replayed retirement, Edit or supersede
    retires the row the snapshot holds, and writes a retired row where the snapshot holds none, so the distillation
    does not propose the entry again. The operator is told which edits to enter again.
  - A wipe moves every feed's cursor to the end of its feed, and its record carries those positions. A replayed wipe
    puts them back, so nothing from before a wipe is read again.
  - Where a witness holds a head the privacy journal lacks (the whole volume came back), the records since are lost.
    The store then serves no entry and learns nothing until the operator has wiped it again or ruled that it stands.
  - "Wipe everything" also removes the copies under the backups directory, or names the ones it leaves. The wipe
    sheet also names what stays on the fleet host: the Overlord's transcripts and its history family (§9.2).
  - The feeds' cursors carry the restore generation, and rewind to the snapshot's positions, or to a later wipe's.

## model3b:F8 [major]
QUOTE: So no generation keeps that text in context (§9.2).

PROBLEM: The renewal ends the conversation that held the entry. The next card then renders that generation's notes, and at a renewal the checkpoint with the Overlord's replies to the operator (§3.3.2, §3.3.3). Both are the Overlord's own words and can restate the entry. The new generation holds the withdrawn text again and can answer from it with nothing cited, so no door refuses: `traces/privacy-notes-carry-the-entry.txt`. The model assumes the server knows which entries a generation was served. The read ledger holds a count, not ids (Table 9.1a), so the NEW adds them. This is a design choice. The NEW withholds. The other choice keeps the notes on the card, and names them on the wipe sheet as text that stays.

OLD:
  - An entry the generation was served that is retired, edited or wiped also makes a renewal due at once (hard,
    Table 3.3.11b). So no generation keeps that text in context (§9.2).

NEW:
  - An entry the generation was served that is retired, edited, superseded or wiped also makes a renewal due at once
    (hard, Table 3.3.11b). The card of that renewal carries no checkpoint. That card and every later one list by id,
    and do not render, the notes written by a generation that was served the entry. So the server hands that text to
    no later generation (§9.2). The read ledger's line gains the ids of the entries served, so the server knows which
    generation held which. What is left: act rows' `summary` and `why`, and the Overlord's history family, which the
    wipe sheet names.

## model3b:F9 [major]
QUOTE: One exception: a cited entry may answer a `value` item, through `state-a-fact` (O5, §7.1).

PROBLEM: The cover is an entry that is "not retired". A superseded entry is not retired, so it still covers, and the item is answered with the span the newer message replaced: `traces/privacy-superseded-entry-still-covers.txt`. After the operator's Edit the entry is `stated` and still rests on the first message. The act answers with the quoted span, never with the statement, so the item gets the words the operator rewrote: `traces/privacy-fact-answers-old-words.txt`.

OLD:
  - One exception: a cited entry may answer a `value` item, through `state-a-fact` (O5, §7.1). The entry must be
    `stated`, rest on an operator message, not be retired, and have the item's subject. It is the cover for
    `state-a-fact` and for nothing else, and no grant covers that act. The act answers with the entry's quoted span
    as the server renders it, never with its statement (§9.2). The act row records `entry:<id>` as its authority
    (§10.1).

NEW:
  - One exception: a cited entry may answer a `value` item, through `state-a-fact` (O5, §7.1). The entry must be
    `active` and `stated`, rest on an operator message, and have the item's subject. A retired or superseded entry
    covers nothing. Neither does one the operator edited: its quote is of the words the Edit replaced. It is the
    cover for `state-a-fact` and for nothing else, and no grant covers that act. The act answers with the entry's
    quoted span as the server renders it, never with its statement (§9.2). The act row records `entry:<id>` as its
    authority (§10.1).

## model3b:F10 [major]
QUOTE: **A statement is the writer's wording until the operator has seen it.**

PROBLEM: `state-a-fact` answers an O5 item with a span of an operator message. The Overlord picks the span and the subject, and an entry whose statement is that span is `stated` at once, with no review. §5.1 refuses spans for requests because "a span can drop a negation". So an entry the operator never saw can answer for a fact only the operator holds, in words that say the opposite: `traces/privacy-fact-span-unseen.txt`. This is a design choice. The other choice keeps the exact-quote check as the whole guard, and names the risk in Table 3.8a.

OLD:
  - **A statement is the writer's wording until the operator has seen it.** Unless the statement is itself such a
    span, the entry counts as `inferred` in the evidence class (§6.3) until the operator confirms or edits it on About
    you. `state-a-fact` answers with the quoted span as the server renders it, never with the statement.

NEW:
  - **A statement is the writer's wording until the operator has seen it.** Unless the statement is itself such a
    span, the entry counts as `inferred` in the evidence class (§6.3) until the operator confirms or edits it on About
    you. `state-a-fact` answers with the quoted span as the server renders it, never with the statement. A span is
    the writer's choice too, and a span can drop a negation (§5.1). So an entry covers `state-a-fact` only once the
    operator has confirmed it on About you, or when its quote is the whole message.

## model3b:F11 [major]
QUOTE: **One message founds one root request, within 24 hours**

PROBLEM: `spent` is a state of the message row, moved after the open door's commit in another file (§3.8). The boot pass re-derives `settled` only. A crash between the commit and the move leaves the message unspent, and it founds a second root request: `traces/message-crash-founds-two-roots.txt`. A restore puts the row and the mark back, so the message founds a root again, while the relays and the start under the first root have already happened: `traces/message-restore-founds-two-roots.txt`.

OLD:
- **One message founds one root request, within 24 hours** (H7). After that the message is spent, and the operator
  re-sends it if more is wanted. A spent message cited for a new root request is refused `said-not-operator`.

NEW:
- **One message founds one root request, within 24 hours** (H7). After that the message is spent, and the operator
  re-sends it if more is wanted. A spent message cited for a new root request is refused `said-not-operator`. The
  open door decides this in its own transaction in `coord.db`, where a unique index allows one root request for a
  message id. The `spent` mark on the message row is a copy, and the boot pass re-derives it with `settled`. After a
  confirmed restore every message up to the highest id the privacy journal or a witness holds is spent: a request
  the restore lost is the operator's to send again.

## model3b:F12 [major]
QUOTE: **A staged answer is vetoed, not overturned.**

PROBLEM: The veto clock can commit while the operator's Veto is on its way. §6.7 says an operator's tap is never refused for a stale revision, and gives three outcomes, each for an answer. A Veto carries no answer. Read as `superseded`, no correction goes out and "the operator's answer stands" names nothing, so the vetoed answer stays in effect. Read as a stale tap, it changes nothing: `traces/joint-late-veto-changes-nothing.txt`. This is a design choice. The NEW takes `overturned`, which latches the grant. The other choice is `superseded` with a correction and no latch.

OLD:
- **A staged answer is vetoed, not overturned.** Veto and Answer now settle it before it takes effect (§7.2).

NEW:
- **A staged answer is vetoed, not overturned.** Veto and Answer now settle it before it takes effect (§7.2). A Veto
  that arrives after the commit is not refused and not dropped. It was made with the Overlord's answer in view, so
  the act is `overturned`: a correction goes to the coordinator, the grant latches, and the item is the operator's
  again. An Answer now that arrives after the commit is the operator's answer on the row, with the three outcomes
  below.

## model3b:F13 [major]
QUOTE: **The reconciliation pass.** For each act the act journal holds and the table lacks

PROBLEM: A snapshot can hold an act as `staged` that took effect afterwards. After a restore of `coord.db` alone the table does not lack the row, so the pass leaves it. The latch then voids it, the row pushes "the Overlord did not answer", and the operator answers: a second answer reaches the coordinator, and no row says the first did (I3): `traces/joint-staged-then-effective-then-restored.txt`.

OLD:
- **The reconciliation pass.** For each act the act journal holds and the table lacks, it writes the act's row with
  `divergedAt` set, so the act's natural key stays taken. It reaches the asks, items and requests those acts touched

NEW:
- **The reconciliation pass.** For each act the act journal holds and the table lacks, or holds in an earlier state
  than the journal's last record for it, it writes the act's row in the journal's state with `divergedAt` set. So
  the act's natural key stays taken, and a staged row that had taken effect is not voided as if it had not. It
  reaches the asks, items and requests those acts touched

## model3b:F14 [major]
QUOTE: commands consumed, practice retirements, and each confirmed restore.

PROBLEM: A request carries `operator-request` authority (I4), and the operator's withdraw ends it. No journal records a request's moves. A restore of `coord.db` to before the withdraw puts the request back open. Where nothing else was journalled since, boot coherence passes and no witness holds a higher epoch, so the restore is not detected, and the Overlord relays under a request the operator withdrew: `traces/joint-withdrawn-request-comes-back.txt`.

OLD:
  - commands consumed, practice retirements, and each confirmed restore.

NEW:
  - commands consumed, practice retirements, and each confirmed restore;
  - the operator's withdraw and take of a request. They take back what a request authorises, and a request's other
    moves are in no journal. After a restore a request takes the stricter of its row and the journal.

## model3b:F15 [major]
QUOTE: **A parent waits on its children.**

PROBLEM: Three gaps. (1) Nothing names when the server measures "every child done". A parent has no news and no clock, so a crash after the last child's close leaves it `in-progress` for ever: `traces/parent-never-closes.txt`. (2) A parent in `needs-you` has no way back. The operator's answer moves a request only when "its owner has acknowledged it" (Table 5.1b), a parent has no owner, and a child that failed is never done. The parent can only be dropped, even when a replacement child finishes the work: `traces/parent-stuck-in-needs-you.txt`. (3) The text does not say what withdrawing a parent does to its children. If nothing, they keep the authority they inherited and are relayed after the operator withdrew the root: `traces/parent-withdrawn-children-go-on.txt`. How the operator's answer moves a parent is a design choice. The NEW lets the parent go on without the child that ended. The other choice says plainly that such a parent can only be dropped, and that the work goes on under a new request.

OLD:
  - **A parent waits on its children.** The parent is done when the server measures every child done. A parent has no
    owner. The server moves it to `in-progress` when its first child is routed. A child that ends other than done
    moves the parent to `needs-you`. This is the tree's own shape: one run row per wave, with the programme's state
    derived from them.

NEW:
  - **A parent waits on its children.** A parent has no owner. The server moves it to `in-progress` when its first
    child is routed. It closes the parent in the transaction that closes its last child, and measures again at boot:
    the parent is done when every child that counts is done. A child that ends other than done moves the parent to
    `needs-you`. Once the operator has answered the parent, that child no longer counts: the parent is `done` if
    every other child is, `in-progress` while a child is open or once the Overlord routes a new one, and stays
    `needs-you` otherwise. Withdrawing a parent drops its open children in the same transaction, and tells their
    owners. This is the tree's own shape: one run row per wave, with the programme's state derived from them.

## model3b:F16 [minor]
QUOTE: Servable: 30 is under 98 less the 30 still reserved, which is 68

PROBLEM: The table's figures follow the ceiling the guest-ceiling finding changes. Under the NEW ceiling the first row reads 40, the second is past it, and the fourth row turns from servable to unservable: with no fresh reading the whole reserve is kept, so the ceiling is 30. `python3 arith.py` reproduces the table as written, and `traces/arith-reserve-under-the-lines.txt` holds the figures under both ceilings.

OLD:
| Seven-day 30, a third of the usage is Fable (10 of the window) | Fable servable: 10 is under the ceiling of 40 | Servable: 30 is under 98 less the 30 still reserved, which is 68 | Unservable, `reserved`. It runs the next class, or lands elsewhere |
| Seven-day 70, a seventh of the usage is Fable (10 of the window) | Fable servable | Unservable: 70 is past 68. It moves at its next idle boundary | Unservable |
| Seven-day 70, four sevenths of the usage is Fable (40 of the window) | Fable at its ceiling: the next reserved account, or Opus | Servable: the reserve is spent, so the ceiling is 98 again | Unservable |
| Seven-day 30, no fresh share reading | Fable unmeasured: it keeps its current class | Servable: 30 is under 98 less the whole reserve, which is 58 | Unservable |

NEW:
| Seven-day 30, a third of the usage is Fable (10 of the window) | Fable servable: 10 is under the ceiling of 40 | Servable: 30 is under 70 less the 30 still reserved, which is 40 | Unservable, `reserved`. It runs the next class, or lands elsewhere |
| Seven-day 70, a seventh of the usage is Fable (10 of the window) | Fable servable | Unservable, `reserved`: 70 is past 40. It moves at its next idle boundary | Unservable |
| Seven-day 70, four sevenths of the usage is Fable (40 of the window) | Fable at its ceiling: the next reserved account, or Opus | Servable: the reserve is spent, so the ceiling is 98 again | Unservable |
| Seven-day 30, no fresh share reading | Fable unmeasured: it keeps its current class | Unservable, `reserved`: 30 is not under 70 less the whole reserve, which is 30. It moves at its next idle boundary | Unservable |

## model3b:F17 [minor]
QUOTE: No Fable reading exists for that window, so the whole reserve is set

PROBLEM: Table 3.4c's third row gives a guest today's ceiling back once the reserve is spent. The five-hour line still sets the whole reserve aside. With nothing left, the second line is the first line, so ccd moves a guest in the middle of its turn at 58 of the five-hour window, for a reserve that is spent: `traces/arith-five-hour-line-after-the-reserve.txt`.

OLD:
    - The five-hour figure meets the same line. No Fable reading exists for that window, so the whole reserve is set
      aside in it.

NEW:
    - The five-hour figure meets the same line while anything is left of the reserve in the seven-day window. No Fable
      reading exists for the five-hour window, so the whole reserve is set aside in it. Once nothing is left, the
      five-hour figure meets today's ceiling too: a spent reserve refuses no guest and moves none.

## model3b:F18 [minor]
QUOTE: The Fable share there is the served sessions' alone.

PROBLEM: The text names a reason for Fable and for an unmeasured figure only. A guest on Opus, or one with no class, that the lowered ceiling passes over, moves or leaves with no account has no word, or today's limit word at a figure far under the limit: `traces/arith-no-reason-word.txt`, `traces/guest-turned-away-with-no-word.txt`.

OLD:
    - Fable is unservable, with the reason `reserved`. The Fable share there is the served sessions' alone.

NEW:
    - Fable is unservable, with the reason `reserved`. The Fable share there is the served sessions' alone.
    - Every refusal the reservation causes carries that reason: the lower ceiling below, for a class and for
      `default`, as well as Fable and the unmeasured figure. Placement, the swap log and the server's forecast show
      it, so a guest passed over, moved or left with no account under today's ceiling is told why.

## model3b:F19 [minor]
QUOTE: so this design adds a second line behind the first

PROBLEM: A stale share reading counts as nothing used, so the guest's ceiling falls by the Fable already used. A guest that was under its ceiling is then past the second line at once, and ccd moves it in the middle of its turn. That is a lost turn for a reading that only went stale. For an unmeasured seven-day figure the text says "no guest is moved": `traces/arith-stale-reading-moves-guests.txt`, `traces/guest-moved-mid-turn-on-a-stale-reading.txt`. This is a design choice. The other choice keeps the text and accepts the lost turns.

OLD:
    A guest in a long turn has no idle boundary, so this design adds a second line behind the first. Once either
    window's figure is past the guest's ceiling by half of what is left of the reserve, ccd moves the guest as it does
    on a hard block, in the middle of its turn. Today the tree moves such a session only behind its idle gate

NEW:
    A guest in a long turn has no idle boundary, so this design adds a second line behind the first. Once either
    window's figure is past the guest's ceiling by half of what is left of the reserve, ccd moves the guest as it does
    on a hard block, in the middle of its turn. The second line needs a fresh share reading: on a stale one a guest
    past its ceiling still leaves at its next idle boundary, and none is moved in the middle of a turn, as none is
    on an unmeasured figure. Today the tree moves such a session only behind its idle gate

## model3b:F20 [minor]
QUOTE: therefore does not flip the model at every renewal

PROBLEM: The hold-down is 30 minutes, and a generation lives 30 minutes before a soft trigger may end it (§3.3.11). So the stamp is always older than the hold-down at the first soft renewal after a fallback. The class comes back at that renewal, and the next hard trigger takes it away again: `traces/swap-hover-flips.txt`. The stamp is read on ccd's clock, with no rule for a clock that steps back: the fallback then stands for as long as the step: `traces/swap-clock-step-holds-the-fallback.txt`. The number is a design choice. Any value longer than the least age plus a renewal's six minutes holds.

OLD:
    design adds one rule to `_route_restore` for a long-lived role: it restores only once the degraded stamp is older
    than the hold-down, 30 minutes to start (Table 11.5b), by ccd's own clock. A reading that hovers at the cap
    therefore does not flip the model at every renewal.

NEW:
    design adds one rule to `_route_restore` for a long-lived role: it restores only once the degraded stamp is older
    than the hold-down, one hour to start (Table 11.5b), by ccd's own clock. The hold-down stays longer than a
    generation's least age (§3.3.11): no soft renewal comes sooner than that age, so a hold-down no longer than it
    never holds one. A reading that hovers at the cap therefore does not flip the model at every renewal. A stamp
    that reads later than ccd's clock is written again as now, so a clock that steps back adds one hold-down at most.

## model3b:F21 [minor]
QUOTE: The hold-down before ccd restores the designated class | W1 | ccd's clock

PROBLEM: The row restates the number the hold-down finding changes: `traces/swap-hover-flips.txt`.

OLD:
| 30 minutes | The hold-down before ccd restores the designated class | W1 | ccd's clock |

NEW:
| One hour, and always longer than the least age of a generation | The hold-down before ccd restores the designated class | W1 | ccd's clock |

## model3b:F22 [minor]
QUOTE: After Confirm the restore, the ids of grants, acts, proposals and

PROBLEM: The list leaves out requests and entries. After a restore a request opened since the snapshot has no row, and the next request takes its id. The first owner's ack, reports and runs then bind to the second request, and a start under it derives the first one's session name (§8.2): `traces/joint-request-id-issued-twice.txt`. An entry id is issued twice the same way, so act rows that cite `entry:<id>` point at another entry: `traces/privacy-entry-id-reused.txt`. After a whole-volume restore the journals go back too, so "the highest their journals hold" is the snapshot's: the witness finding gives the witness the highest ids.

OLD:
- **No id is used twice across a restore.** After Confirm the restore, the ids of grants, acts, proposals and
  commands start above the highest their journals hold, as message ids do (§5.1).

NEW:
- **No id is used twice across a restore.** After Confirm the restore, the ids of grants, acts, proposals, commands,
  requests and operator-model entries start above the highest that their journals or any witness hold, as message
  ids do (§5.1). The act journal holds each request's id on its open record, and the privacy journal keeps the
  highest entry id.

## model3b:F23 [minor]
QUOTE: The rules version rises on a rule change, a new or revoked grant, and an operator-model entry that the operator

PROBLEM: A retirement or an Edit raises the rules version, so every door refuses until the card is read again. A wipe does not. The hard renewal a wipe makes due drains only at the next turn end. Inside that turn the generation still answers from what it holds: `traces/privacy-wipe-leaves-doors-open.txt`.

OLD:
  - The rules version rises on a rule change, a new or revoked grant, and an operator-model entry that the operator
    retires or edits. The card hash changes with it, so the generation's doors refuse `card-unread` until it reads the
    card again. A generation therefore never acts on authority it has not read.

NEW:
  - The rules version rises on a rule change, a new or revoked grant, an operator-model entry that the operator
    retires or edits, and a wipe. The card hash changes with it, so the generation's doors refuse `card-unread`
    until it reads the card again. A generation therefore never acts on authority it has not read.

## model3b:F24 [minor]
QUOTE: The act cites a retired operator-model entry

PROBLEM: The door's refusal names a retired entry. A superseded entry passes it: `traces/privacy-superseded-entry-still-covers.txt`. The commit of a staged act is no door call and needs the same gate: `traces/privacy-staged-act-commits.txt`.

OLD:
| `entry-retired` | Every act door | The act cites a retired operator-model entry | C40, H29 |

NEW:
| `entry-retired` | Every act door, and the commit of a staged act | The act cites an operator-model entry that is not `active` | C40, H29 |

## model3b:F25 [minor]
QUOTE: **Edit** rewrites it in the operator's words and makes it `stated`.

PROBLEM: If the sources stay, the entry is served "with the quote of its operator source beside its statement" (§9.2): the words the operator replaced beside the new ones, and `state-a-fact` answers with them: `traces/privacy-fact-answers-old-words.txt`.

OLD:
  - **Edit** rewrites it in the operator's words and makes it `stated`.

NEW:
  - **Edit** rewrites it in the operator's words and makes it `stated`. The edit becomes the entry's source, and the
    quote of the earlier words is no longer served.

## model3b:F26 [minor]
QUOTE: **The commit re-checks.**

PROBLEM: `entry-retired` is a door's gate, and the commit of a staged act is no door call. An entry the act cites can be retired or edited during the veto window. The hard renewal that follows voids the act only once it lands, and the veto clock can run out first. The act then takes effect on an entry the operator withdrew: `traces/privacy-staged-act-commits.txt`.

OLD:
  - **The commit re-checks.** The transaction that makes it `effective` runs `overlordMayAct`, the rung and the
    row's state again. The fence is read from the act row's own stamps: its term and its generation must still

NEW:
  - **The commit re-checks.** The transaction that makes it `effective` runs `overlordMayAct`, the rung, the row's
    state and the door's `entry-retired` gate again: an act that cites an entry that is no longer `active` is
    `voided`. The fence is read from the act row's own stamps: its term and its generation must still

## model3b:F27 [minor]
QUOTE: in `coord.db` and the message's state never share a transaction. The boot pass re-derives `settled` from the

PROBLEM: After a restore of `coord.db` alone the request that cited a message is gone, and the message still reads `settled`. If the boot pass only adds `settled`, the message is on no card and no list, and nothing tells the operator the request is lost: `traces/message-settled-with-no-request.txt`.

OLD:
    in `coord.db` and the message's state never share a transaction. The boot pass re-derives `settled` from the
    citing rows (I8).

NEW:
    in `coord.db` and the message's state never share a transaction. The boot pass re-derives `settled` from the
    citing rows, both ways (I8): a message that reads `settled` while no row cites it and no `acknowledge` settled
    it is unsettled again, so it heads the next card. The pass adds `spent` where a root request cites the message,
    and never takes it away.

## model3b:F28 [minor]
QUOTE: Otherwise the request shows "message no longer on record", and the relay, kickoff

PROBLEM: After a wipe the Overlord's doors refuse on the request, but it stays open with its owner. The owner's `goals modify` still takes "a request this programme owns whose relay carried the widening" as its reference (§6.3), so a scope changes under words the operator wiped: `traces/message-wiped-request-still-acts.txt`. This is a design choice. The other choice lets work relayed before the wipe run on, and says so on the wipe sheet.

OLD:
  stored hash equals the row's. Otherwise the request shows "message no longer on record", and the relay, kickoff
  and start doors refuse `said-not-operator`.

NEW:
  stored hash equals the row's. Otherwise the request shows "message no longer on record", and the relay, kickoff
  and start doors refuse `said-not-operator`. A wipe moves every open request that cites only wiped messages to
  `needs-you` in the same step, and tells its owner: the owner would otherwise carry on, and `goals modify` would
  still take the relayed request as its reference (§6.3).

## model3b:F29 [minor]
QUOTE: **`max-per-day:<n>`**, over a rolling 24 hours of act rows.

PROBLEM: The text says an overturned act counts, and is silent on the rest. If only rows that took effect count, two answers are staged at once under `max-per-day:1`. Unless the commit counts again, both take effect: `traces/joint-max-per-day-two-staged.txt`. If it does, the operator watches a window whose act is then voided: `traces/joint-max-per-day-effects-reading.txt`. Counting every row is the narrower reading. A vetoed or voided act then uses up the day: `traces/joint-max-per-day-what-counts.txt`. This is a design choice. The other choice counts rows that took effect and rows still staged.

OLD:
- **`max-per-day:<n>`**, over a rolling 24 hours of act rows. An overturned act still counts.

NEW:
- **`max-per-day:<n>`**, over a rolling 24 hours of act rows under the grant. A row counts from the moment it is
  written, whatever becomes of it: staged, effective, overturned, vetoed, voided or preempted. Only a row settled
  `refused` does not count. So no more than n answers are ever staged at once.

## model3b:F30 [minor]
QUOTE: or is a parent whose children have theirs |

PROBLEM: Read to the letter, I12 fails on a parent whose only open child is in `needs-you`, `blocked` or `done-unverified`: that child is exempt, so it has no time. The monitor would then latch the ladder at `advise` on a correct state (§10.4): `traces/parent-i12-read-to-the-letter.txt`. Table 11.7a also has no invariant for the privacy rules. Every fault planted in the privacy and message machines was caught only by this model's checks (§1), so the NEW adds I13.

OLD:
| I12 | Every open request outside `needs-you`, `done-unverified` and `blocked` has a follow-up time, or is a parent whose children have theirs |

NEW:
| I12 | Every open request outside `needs-you`, `done-unverified` and `blocked` has a follow-up time, or is a parent with at least one open child, each of which meets this invariant itself |
| I13 | After a restore, the store serves no entry and no message that the privacy journal or a witness records as retired, replaced or wiped, and no id is issued twice |

## Passages that restate an edited rule

These say the same thing as a passage a finding changes. No finding edits them, so the editor should bring them
into line by hand:

- **F1.** Table 3.3.11b's "Account load" row and Table 3.4b's 85% row name the line and the idle test only.
  §13's C57 row says it "renews pre-emptively at idle past the second".
- **F2.** Table 3.4a's caption ("ccd picks in this order, before load"), Table 3.7a's row "Which model and
  which account serve the next generation?", and §13's C56 row.
- **F3, F16.** Table 3.4c's caption stays true. §13's C46 row and §16's risk row "The reservation
  fails open, or takes too much" describe the reserve without the line it counts from. "Waiting on you", item 7,
  says the default share is the Fable ceiling: that stays true.
- **F4.** Table 11.1a's `account_reservations` row, Table 11.1c's "The reservations sync" row, Table 3.6a's
  row for the reservations document, and §9.5's replay-body bullet name the served sessions as the designated
  session and the running replay body only.
- **F5.** §9.5: "So the renewal trigger "evaluation due" (Table 3.3.11b) holds answers in shadow until the
  third gate passes." The gate holds the answers. The trigger asks for one renewal.
- **F6.** Table 11.1a's "The witness epoch" row, Table 11.6's `authority-rolled-back` row, and §9.4 rule
  12 ("a file outside every snapshot").
- **F7.** §9.4 rule 12 and rule 13 ("The feeds' cursors carry the restore generation, and rewind after a
  restore"), and Table 11.1a's "The privacy journal" row, which lists retirements and the learning controls only.
- **F8.** Table 3.3.11b's row "An entry it was served was retired, edited or wiped", §9.2's sentence "so no
  generation keeps the text in context", Table 9.1a's read ledger row and §3.8's H10 ("the door, the scope, the
  count and the generation").
- **F9, F24, F25.** §7.1's decider paragraph and Table 6.7b's `value` row both say "is
  not retired". §3.3.5 says "A door refuses an act that cites a retired entry".
- **F10.** Table 3.8a's "Memory poisoning" row, and the caption of Table 9.2a.
- **F11, F27.** §3.8's "Requests bind whole messages", Table 9.1a's `operator_messages` row ("The
  boot pass re-derives `settled` from the citing rows"), and Table 3.8a's "Forged or laundered operator words" row.
- **F12.** Table 10.1b's `staged` row and §6.7's "Revisions decide a race" give no outcome for a Veto.
- **F13.** Table 10.1a's `divergedAt` row and Table 11.1a's `overlord_acts` row name an act "the table
  lacks" only.
- **F14.** Table 5.1b's operator row, and Table 11.1a's `overlord_requests` row, which names no journal.
- **F15.** Table 5.1b's server row (it needs the moves `needs-you` to `in-progress` and `needs-you` to `done`
  for a parent) and its operator row (answer, withdraw), and Figure 3.
- **F20, F21.** Table 3.4b's row "The designated class has been servable for the hold-down time"
  counts from when the class became servable. The rule counts from the stamp. §11.5's "The hold-down is ccd's",
  §13's C45 row and §16's risk row "Fable's cap or cost" name the hold-down without its length.
- **F22.** §3.8 and §5.1 ("the privacy journal keeps the highest id"), and §9.4 rule 12.
- **F29.** §10.3 ("An overturned act still counts against its grant's `max-per-day`") and §11.5 ("A day
  is defined").
- **F30.** "In short" says "twelve stated invariants". §10.4 says the monitor checks "I1 to I8 and I10 to I12".
  Table 11.7b says "I1 to I12 under faults". §11.7's "Why" names I11 and I12 as the last two added.

## 4. What this model still does not cover

- **Bounds.** Two reserved accounts and one other. One guest. One entry and one source. One message. One grant, two
  items, one request. One parent with two children and one replacement. Two to five ticks. One snapshot and one
  restore. Liveness checks say that a path exists on the bounded graph.
- **Priority four was not modelled.** The decision model's label queue and its refits, the audit sample, drills,
  and the replay body beyond its wait on a due renewal.
- **Accounts.** Load is four levels in the swap machine, so the lines' exact figures are in `arith.py` only. The
  five-hour window is not in the dynamics. Not modelled: `poolRunway`, the billing fact, the continuity record, a
  pay-per-use lane, three or more reserved accounts, an outside account chooser, the load lines' effect on holds,
  and a rescue that lands on an account the server left out of the list. Read but not modelled: the replay body
  spends the reserve "within limits" that are the soft line and no renewal due, so it can spend the last Fable share
  on every reserved account.
- **The pick.** The safe reading puts the soft line before the class: Opus on an account under the line comes
  before Fable on one past it. The text supports that order (Table 3.4a, Table 3.4b) and does not state it.
- **Privacy.** Not modelled: a message sent off the record, the 90-day retention pass, a narrowed scope, the
  `share` column and the egress checks, the private-name list across a restore, the labelled cases of a
  `private-state` decision-model row, a sealed prediction that cites a withdrawn entry, a practice entry that
  restates one, and the replay "as of the question's date", which serves retired entries by design. Read but not
  modelled: the write door refuses an entry with no operator source (`entry-unsourced`), while a `candidate` is "an
  entry learned only from tool or model text".
- **What the server knows.** The privacy machine assumes the server knows which entries a generation was served.
  The read ledger holds a count. F8 adds the ids.
- **Messages.** Delivery, queueing and `deaf`. The settlement mark of the prompt route. The 24 hours on a clock
  that steps: Table 11.5b has no row for it. The natural key of `open-request`, which decides whether a restore of
  the two files alone can found a second root.
- **Joint cases.** Answer now racing the commit. Two staged acts on one item. The grant's other conditions:
  `operator-started-only`, `only-when-recommended-by-coordinator` and the identity strength. A restore while a
  designation is `pending`. A whole-volume restore repeats acts by the text's own account (§7.6, "What is left"),
  so I3 is checked for a restore of `coord.db` alone.
- **Parents.** A parent under the `off` rung, a child blocked on its sibling, a counter on a child, and the split's
  one-tap confirmation as a proposal (W3).
- **One reading.** A rule misread without noticing would not show up. Each rule cites its section so that it can be
  checked against the text.
