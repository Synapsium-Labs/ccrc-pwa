# Model check of the Overlord design, round two: the machines round one left out

Run against the edition of `docs/superpowers/specs/2026-11-09-overlord-design.md` that #2533 merged. #2538 writes each
finding below into the spec. Round one (the parent directory) covered holds, readiness, generations and the push outbox
without a budget. This round covers authority, designation and restore, requests, proposals and commands, the push
outbox under the attention budget, and playbook entries.

## 1. Summary

- **What was modelled.** Six small machines, each its own file, on one explorer (`explore.py`). Each rule cites its
  section in a comment. Where the text is silent or two passages disagree, the rule reads a named switch, and both
  readings are run.
- **Result.** Under one consistent set of readings (the "safe" readings) every check holds within the bounds:
  484,645 states over 28 scenarios. The text does not settle those readings. Of the 42 other readings in Table 3,
  40 break a stated invariant, a stated rule or a liveness check. The other two break nothing (F2, F22). Eighteen
  of the 42 are the text as written: the sentence gives that behaviour, and no reading avoids it.
- **Findings.** 38: 1 blocker, 14 major, 23 minor. Six of the minor ones are companions: a second passage that
  restates a rule a larger finding changes (F16 to F21).
- **Mutations.** 40 planted bugs, all caught. Only 9 are caught by I1 to I10 as worded. The other 31 are caught only
  by checks this model added, so they are gaps in the invariants (below).
- **Total explored.** 2,067,697 states over the whole matrix (73 runs, about 15 seconds).

### What each machine holds, and its bounds

Time moves in ticks. A server lane (an expiry, a commit, a sweep) runs before the clock moves on, but a door call or
a tap can still fall before it. A server crash can fall between any two transitions. Work the text puts in two
transactions is two transitions. Every fault and every tap has a budget, named in each file's `DEFAULT`. A run stops
at 600,000 states and reports `BOUND`. No run reaches it.

| Machine (file) | What it holds | Faults injected |
|---|---|---|
| grant (`m_grant.py`) | One grant with its five states, latches and conditions. The ladder: the operator's rung, latches, conditions, per-kind arming. One O3 item, held, staged and committed. The veto clock on observed time, the eight-hour fallback, the commit's re-checks, the blind check | Server crash, clock skew, a renewal, a rebind, a stale tap on the `live` door, a door process of an ended generation |
| restore (`m_restore.py`) | Designate (`pending`, `live`), rebind, retire, the term. The authority journal, the act journal, the epoch and one witness. Boot coherence, Confirm the restore, the reconciliation pass. One request that can be relayed once | Server crash, a crash between a journal record and its row, a restore of `coord.db` alone, a restore of the whole volume, a witness that is away, a body that dies |
| request (`m_request.py`) | One request through every move of Table 5.1b. The follow-up clock, nudges, counters, news. Take and hand back. One dependency. The rung under it | Server crash, a dead coordinator, a re-kick, a programme that ends, an Overlord that is not ready, Pause, `off`, a `chat` cap the server sets |
| command (`m_command.py`) | One target, proposals one after another, one command, the two-step act it authorises | Server crash between the `pending` write and the effect, a far host that refuses, an effect that cannot be measured, a target row that moves, a retry |
| outbox (`m_outbox.py`) | One row of each level under a live budget: briefing times, quiet hours, a spent budget, an open console, the repeat | Server crash, a push service that is down |
| practice (`m_practice.py`) | One playbook entry through Table 9.7b, with its holdout and its two clocks | A guard breach, a full live budget, a replay that contradicts |

*Table 1. The machines. The practice machine is light and was made last.*

| Machine | Scenario | Bounds | States | Transitions |
|---|---|---|---|---|
| grant | grant | 4 ticks, a grant lives 3; one of each tap and fault | 23,448 | 73,698 |
| grant | ladder | two latches of different caps, each tap once | 2,187 | 7,533 |
| grant | staging | 4 ticks, veto window 2 observed ticks, "eight hours" 3 | 20,064 | 53,348 |
| grant | staging-ladder | the same item, the ladder moving under it | 17,130 | 67,086 |
| grant | staging-body | the same item, one renewal, one rebind | 12,612 | 28,829 |
| grant | expiry | 5 ticks, a grant lives 3, one skew, the blind check armed part-way | 80,619 | 221,458 |
| restore | restore-db | 2 operator taps, 1 latch, 2 relays, 1 snapshot, 1 restore, 2 crashes | 136,661 | 204,041 |
| restore | restore-volume | the same, the journals restored too | 19,552 | 27,526 |
| restore | restore-body | 1 rebind, 1 retire, 1 designate, 1 snapshot, 1 restore | 3,380 | 4,212 |
| restore | designate | 2 designates, 1 rebind, 1 retire, 3 crashes, no restore | 24,501 | 42,472 |
| request | life | follow-up every 2 ticks, 1 crash, 1 death, 1 re-kick | 76,836 | 243,927 |
| request | operator | take, hand back, answer, withdraw, 1 dependency | 17,378 | 59,574 |
| request | ladder | 2 rung taps, 1 cap by the server, 1 death | 29,228 | 121,636 |
| request | gap | follow-up every 3 ticks, 2 crashes, nobody acts | 9,920 | 30,500 |
| request | ends | the owner's programme ends | 2,906 | 9,532 |
| command | command | a proposal lives 3 ticks, a command 1; 2 proposals, 2 taps | 2,083 | 4,788 |
| command | retry | 3 proposals, 3 taps, 1 refusal by the far host | 1,787 | 3,615 |
| outbox | by, by-quiet, now, batch, batch-nobrief, block, faults | 4 to 6 ticks, one row, a budget of 1 | 3,356 | 7,509 |
| practice | narrow, narrow-full, widen, operator | 45 days is 2 ticks, 90 days 4, 2 holdout exposures | 997 | 2,927 |
| | Total, safe readings | | 484,645 | 1,214,211 |

*Table 2. States under the safe readings. `matrix.out` has every run.*

### The checks, and which readings break them

I1 to I10 are checked where they apply. The other names are this model's, each a rule the text states:

- **grant.** A1: authority widens only by an operator step-up or a condition ending (§7 intro, §7.5). A2: an act
  commits only under a live grant, the rung and the term (§7.2; this is I4 at the commit). A2b: the blind check at
  the commit. A3: only the operator lifts a latch (Table 7.2a). A4: a grant leaves shadow only by its report. A7: the
  veto window is observed time. A9: an expiry fires. A10: `revoked` is final. A11: a hold ends with its grant (Table
  6.7c). I5 at the commit. V2: no act stays staged once its authority is gone. L1: a staged act has an exit the
  operator need not provide. V1: a row whose push said "the Overlord will answer" does not become the operator's in
  silence.
- **restore.** I7, read against the journal as it stood when the restore was made, or, for a whole-volume restore,
  against what the operator was told was done. I7b: every grant stays latched after Confirm. I7w: the same before a
  witness answers. R1: an act that happened keeps a row, or the restore is flagged (§7.6's first paragraph). I3. T1:
  a term is issued once. G1: a grant id is issued once. W1: boot coherence never widens. D2: only the bound session
  is accepted. LP: a pending row has a deadline (§3.2).
- **request.** L1: from every open state outside the home's "Needs you" group, the server alone can bring the
  request to the operator or to an end (§5.4). S1: `in-progress` has an owner that acknowledged. S3: no move leaves
  a terminal state. S4: nothing acts on a taken request. S5: two nudges, two news resets. S6: `off` moves the
  unacknowledged. S8: the Overlord does not take a request off the operator's list. FU1: a gap does not push a
  follow-up out.
- **command.** I3. S2: an act is written only under a live command on a `commanded` proposal with an unmoved target.
  S5: terminal proposal states. S8: an open proposal's target has not moved. S9: one live command. L1 to L4: a
  failed commanded act is told, proposals and commands end, pending acts settle, a refused start can be retried.
- **outbox.** P1: a push goes out by its deferral limit (Table 4.2a). I2. I9. B1: a batch goes out at a briefing
  time. M25: every overdraft is one the text allows. L5: a deferred push goes out with no act of the operator's.
- **practice.** PR1 to PR6 and PL1, PL2: the moves of Table 9.7b.

| Reading (switch=value) | Is it the text? | Breaks | Finding |
|---|---|---|---|
| `ACT_COHERENCE=none` | the text | R1, I3 | F1 |
| `TRAILING=literal` | the text | I7, G1 | F2 |
| `TRAILING=mark` | another fix | nothing | F2 |
| `EPOCH_COMPARE=number` | the text | I7, R1, I3 | F3 |
| `EPOCH_COUNTS_ACTS=False` | the text | R1, I3 | F3 |
| `RECONCILE=mark-only` | one reading | I3, R1 | F4 |
| `VOLUME_RECONCILE=journal-only` | the text | I3 | F4 |
| `CONFIRM_BODY=row` | the text | I7 | F5, F16 |
| `TERM_AT_CONFIRM=row+1` | one reading | T1 | F5 |
| `VOID_NOTIFY=none` | the text | V1 | F6 |
| `VOID_WHEN=lazy` | one reading | V2 | F6 |
| `COMMIT_FENCE=term` | one reading | I5 | F7 |
| `UNSEEN=never-shown` | one reading | L1 | F8 |
| `FIRST_CLOCK=readback` | the text | L1 | F9, F17 |
| `ARM_BELOW=stops` | the text | L1 | F10 |
| `GAP_RETIME=all` | the text | FU1 | F11, F18 |
| `ANSWER_UNACKED=in-progress` | the text | S1 | F12, F19 |
| `SPENT_BY=defer` | the text | P1 | F13, F20, F21 |
| `QUIET_RULE=defers` | one reading | P1 | F14 |
| `CONSOLE_SETTLES=all-deferred` | one reading | P1 | F14 |
| `COND_SUSPEND=stored-nokind` | one reading | A3 | F15 |
| `SHADOW_LATCH=suspended` | one reading | A4 | F15 |
| `LATCH_STORE=single-overwrite` | one reading | A1 | F22 |
| `LATCH_STORE=single-min` | one reading | nothing; one clear lifts every cause | F22 |
| `EXPIRY_GATE=state` | one reading | A2 | F23 |
| `COMMIT_BLIND=skip` | one reading | A2b | F24 |
| `WITNESS_CAP=advise` | the text | I7w, I3 | F25 |
| `ID_FLOOR=db` | the text | G1 | F26 |
| `PENDING_DEADLINE=door` | one reading | LP | F27 |
| `DROP_NEEDS_YOU=table` | the text | S8 | F28 |
| `UNBLOCK=edge` | one reading | L1 | F29 |
| `NATKEY=blocks` | one reading | L3 | F30 |
| `REFUSED_TOLD=none` | the text | L1 | F31 |
| `STALE_DETECT=open-only` | the text | S8 | F32 |
| `NOBRIEF=never` | the text | L5 | F33 |
| `BOOT_SENDS=deferred-too` | one reading | B1 | F34 |
| `REPEAT_SCOPE=all-blocking` | one reading | I9 | F35 |
| `REPEAT_ROW=new-row` | one reading | I2 | F35 |
| `LIVE_HOLDOUT=none` with `NO_MEASURE=renew` | one reading | PR1 | F36 |
| `CONTRADICT=stays-proposed` | one reading | PL1 | F37 |
| `AGE_FROM=live` | one reading | PL2 | F38 |
| `OPERATOR_BREACH=retire` | one reading | PR2 | F38 |

*Table 3. Every reading run beside the safe one. "The text" means the sentence as written gives this behaviour. The
safe reading of `COMMIT_FENCE` is `term+gen`: it breaks nothing, and under it a renewal voids every staged act (F7).*

### Each invariant

- **I1, I8, I10** are round one's. This round adds one case to I1: a staged act that is `voided` (F6). Staging wrote
  the reach stamp, so I1 holds, but the operator's only push said the Overlord would answer.
- **I2** holds under the safe readings. As worded it accepts a deferral to any stated time (F21), and a repeat
  written as a second outbox row breaks it (F35).
- **I3** fails under the text after a restore: the same request is relayed twice at one revision (F1, F3, F4, F25).
- **I4** holds at the staged commit only if the gate reads `expiresAt` (F23) and a suspension's kind is kept (F15).
- **I5** holds at the staged commit only under the reading that lets every renewal void the act (F7).
- **I6** was not modelled here.
- **I7** fails under the text for the designation (F2, F5), and for a whole-volume restore when later records catch
  the epoch up (F3).
- **I9** holds unless the two-hour repeat reaches a row the tier never held (F35).

### Mutations

40 planted, 40 caught (`mutations.out`).

Caught by I1 to I10 as worded (9): the commit skips the grant re-check (I4); the commit skips the fence, and the
fence is off at the door (I5); an unguarded clock skew (I4); boot coherence skipped, the witness ignored, Confirm
takes the laxer side (I7, I3); a retry that acts again (I3); a reach with no outbox row (I2).

Caught only by a check this model added (31). Each group is a gap in the invariants:

- **Nothing in I1 to I10 says that only the operator widens.** The server clears a latch; the Overlord raises its
  own rung; a rebind that latches no grant; a stale tap that revives a revoked grant; Confirm that leaves a grant
  live; a boot that rolls a widening record forward. Caught by A1, A3, A10, I7b, W1. A candidate: "The effective
  rung, a grant and a kind's arming widen only in the transaction of an operator's step-up door, or when a
  condition measurably ends."
- **The staged commit.** It skips the rung re-check; the veto clock counts time nobody watched. Caught by A2, A7.
- **Timers that must fire.** A grant's expiry, the eight-hour fallback, a command's 15 minutes, a deferral lost at
  boot, a stuck sender. Caught by A9 and by liveness checks. I1 covers a hold's deadline only.
- **Retention.** A hold kept after its grant ended. Caught by A11.
- **The bound session.** A relay accepted from a session the row does not bind. Caught by D2. I5 names the term,
  the generation and the key, not the session.
- **Requests.** All six request mutations. No invariant names a request. A candidate: "Every open request has a
  follow-up time, or is `needs-you`, `done-unverified` or `blocked` on a request that has one."
- **Commands.** An act written after the command's 15 minutes, on a moved target, or on a proposal that is no
  longer open. Caught by S2, S5. I4 says "a consumed command for its proposal", not that it was live.
- **Push deadlines.** A deferral that ignores the limit; a spent budget that blocks a `blocking-now`. Caught by P1.
  F21 amends I2.
- **The playbook.** All four. No invariant names an entry.

### Assumptions

This is one reading of a long text. Where the text is silent and no switch stands, the model assumes:

- A designate or a rebind is journalled when the row goes `live`, not at `pending`.
- The operator's authority doors refuse while `authority-rolled-back` stands, Confirm the restore excepted.
- The authority epoch counts journal records, and Confirm sets it above the witness's.
- A commit's void for a condition (a model off its class, no witness yet) is decided at the commit, not before.
- The follow-up arm counts its own firings as "nudges", not the Overlord's `nudge-owner` mails (§5.4: "It does not
  wait for the Overlord").
- A `blocked` request has no follow-up of its own (Figure 3 draws none).
- A batch whose briefing time passed while the server was down goes out at boot, at no cost.
- The budget is live. Its shadow period (§4.2) was not modelled.

## 2. How to re-run

    cd <this directory>
    python3 check.py --list                              # machines, scenarios, checks, readings, mutations
    python3 check.py grant staging                       # one scenario under the safe readings
    python3 check.py restore restore-db ACT_COHERENCE=none   # one reading flipped; prints each trace
    python3 check.py request gap GAP_RETIME=all FU=4     # a bound changed
    python3 check.py --matrix > matrix.out               # 73 runs, about 15 seconds
    python3 check.py --mutations > mutations.out         # 40 planted bugs, about 10 seconds
    python3 check.py --traces                            # writes traces/<name>.txt, one per reading cited below

Python 3, standard library only.

## 3. Findings

Severity: **blocker** is a stated invariant that fails under the text as written, on a path the section itself
names, with no reading that avoids it. **Major** is a stated rule or a liveness check that fails under the text or
under one natural reading, with harm to the operator or a coordinator. **Minor** is a reading left open with small
harm, or a companion edit. Most severe first.

No two findings edit the same lines, so they apply in any order. A WHERE line is given whole after `WHERE: `, its
leading spaces included. Each QUOTE, OLD and WHERE was checked to occur
exactly once in that edition.
Passages that restate an edited rule and are not edited here are listed after the findings.

- F1 [blocker] A restore that loses acts and no authority record reads `coherent`
- F2 [major] A restore one authority record behind reads as a crash
- F3 [major] Records written after a whole-volume restore catch the epoch up, and acts never move it
- F4 [major] The reconciliation pass has no row to mark, skips requests, and has no journal after a volume restore
- F5 [major] Confirm the restore brings an earlier body back, and can issue a term twice
- F6 [major] A voided staged act goes back to the operator in silence
- F7 [major] The fence at the staged commit: either every renewal voids the act, or I5 fails
- F8 [major] A staged act the operator half watched has no exit of its own
- F9 [major] A request has no follow-up clock before its first read-back
- F10 [major] At `chat` the follow-up arm stops and nothing moves a silent request to the operator
- F11 [major] Every server restart pushes every follow-up out
- F12 [major] The operator's answer puts an unacknowledged request `in-progress` with nobody working on it
- F13 [major] A spent budget defers a `blocking-by` push past the time it is needed by
- F14 [major] Quiet hours, "away until" and an open console have no stated bound against a deferral limit
- F15 [major] A grant row has no place for a suspension's kind, and a latch on a shadow grant skips its report
- F16 [minor] §3.1 follows the designation rule of Confirm the restore
- F17 [minor] Table 11.5b needs the ceiling a request waits for its next move
- F18 [minor] §11.5 repeats the gap rule for follow-up clocks
- F19 [minor] Table 5.1b follows the rule for the operator's answer
- F20 [minor] M25's target follows the overdraft rule
- F21 [minor] I2 accepts a deferral to any stated time
- F22 [minor] `latchedCap` is one value, and several latches can stand
- F23 [minor] A grant past its expiry authorises until the lane writes `expired`
- F24 [minor] The staged commit and the blind check
- F25 [minor] Before the first witness answers, a whole-volume restore acts at `advise`
- F26 [minor] Ids of grants and acts are used twice after a restore
- F27 [minor] A pending designation loses its deadline in a server crash
- F28 [minor] The Overlord may drop a request that waits on the operator
- F29 [minor] A request handed back to `blocked` after its dependency ended stays blocked
- F30 [minor] A start that settles `refused` keeps the request's natural key
- F31 [minor] A commanded act that fails spends the command and tells nobody
- F32 [minor] A target row that moves under a `commanded` proposal leaves it open and stale
- F33 [minor] With no briefing time set, a `batchable` push has no time to go out
- F34 [minor] The boot pass sends pushes the budget deferred
- F35 [minor] The two-hour repeat against I9 and I2
- F36 [minor] A live playbook entry has nothing to measure at 45 days
- F37 [minor] A proposed entry whose replay contradicts has no state to go to
- F38 [minor] A waiting canary has no clock, and a guard breach retires an operator's entry

## model2:F1 [blocker]
QUOTE: At boot the server compares the journal with the Overlord's rows

PROBLEM: Not a reading: no reading of the text avoids it. Boot coherence compares only the authority journal with the rows (§7.6, Table 7.6a). A `coord.db` that comes back from a snapshot after which no authority record was written reads `coherent`. The act journal then holds acts whose rows are gone, the reconciliation pass never runs, and the Overlord relays the same request again at the same revision (I3). This is the common restore: an authority record is rare and an act is not. Trace: `traces/restore-acts-only-coherent.txt`.

OLD:
- **Boot coherence.** At boot the server compares the journal with the Overlord's rows, following the collector
  switch's table.

NEW:
- **Boot coherence.** At boot the server compares the authority journal with the Overlord's rows, following the
  collector switch's table. It also compares the act journal with the act rows: a settle record whose act has no
  row means the database went back, and the server refuses `authority-rolled-back`. An authority record is rare
  and an act is not, so most restores lose acts and no authority record.

## model2:F2 [major]
QUOTE: one trailing record with no row

PROBLEM: Table 7.6a's last row cannot tell a crash from a restore to a snapshot one authority record old. A rebind, then a restore: the rebind's record is "dropped", the row binds the stopped old body again, and Confirm the restore has no record left to compare (I7, for the designation). Trace: `traces/restore-trailing-record-revives-body.txt`. A dropped "grant created" record also frees its id for the next grant: `traces/restore-trailing-record-id-reuse.txt`. The tree's own collector table, which this one follows, stops on a journal one record ahead. The price of the NEW text: a real crash between a record and its row needs Confirm the restore (`traces/crash-flagged-as-restore.txt`). The other way out is a commit mark appended after the transaction, so that a trailing record with a mark is a restore and one without is a crash; the model passes under that reading too (`TRAILING=mark`).

OLD:
| one trailing record with no row | a crash, not a restore: rolled forward if it narrows, dropped if it widens |

NEW:
| one trailing record with no row | refuse `authority-rolled-back`: a crash between a record and its row and a restore one record behind look the same. Confirm the restore applies the record if it narrows, and leaves it unapplied if it widens |

## model2:F3 [major]
QUOTE: A server whose epoch is lower than a witness's refuses

PROBLEM: Two holes in one rule (§7.6). First, the witness compares a number. After a whole-volume restore the server's epoch is behind the witness's, but any narrowing the server journals by itself before the first witness answers (a latch, an expiry) raises it again. The restore is then never flagged, and the rung the operator had lowered stays revived (I7, read as what the operator was told was done). Trace: `traces/restore-volume-epoch-catches-up.txt`. Second, the epoch counts authority records only. A whole-volume restore that loses only acts is invisible to every detector: `traces/restore-volume-acts-only.txt`.

OLD:
- **A witness outside the volume.** A volume snapshot restores the database and the journal together, so the journal
  alone cannot see it. The server sends its authority epoch to every agent and every signed-in console. Each keeps the
  highest it has seen. A server whose epoch is lower than a witness's refuses `authority-rolled-back`.

NEW:
- **A witness outside the volume.** A volume snapshot restores the database and the journal together, so the journal
  alone cannot see it. The server's authority epoch rises with every authority record and every settle record of
  the act journal. The server sends it, with the head hashes of those two journals, to every agent and every
  signed-in console. Each keeps the highest it has seen. A server whose epoch is lower than a witness's, or whose
  journals do not hold the witness's heads, refuses `authority-rolled-back`. So records written after a restore
  cannot catch the epoch up.

## model2:F4 [major]
QUOTE: It sets `divergedAt` on each act the act journal holds after the snapshot

PROBLEM: The acts the act journal holds after the snapshot have no rows in the restored table. There is nothing to set `divergedAt` on, their natural keys are free, and after Confirm the Overlord relays the same request again (I3). Trace: `traces/restore-reconcile-marks-nothing.txt`. The pass names asks and items only: a request whose relay diverged goes back to `received` while its coordinator works on it. After a whole-volume restore the act journal went back too, so the pass reads nothing and every act since the snapshot can repeat: `traces/restore-volume-acts-repeat.txt`.

OLD:
- **The reconciliation pass.** It sets `divergedAt` on each act the act journal holds after the snapshot, and reaches
  the asks and items those acts touched through their act rows' targets. Those rows go to the operator and are never
  held. `diverged` is never an act state: the act states stay closed (Table 10.1b), and nothing an older build reads
  changes.

NEW:
- **The reconciliation pass.** For each act the act journal holds and the table lacks, it writes the act's row with
  `divergedAt` set, so the act's natural key stays taken. It reaches the asks, items and requests those acts
  touched through their targets. Those asks and items go to the operator and are never held, and those requests
  move to `needs-you`. Where the act journal is no further on than the database (the whole volume came back), no
  record says which rows were acted on, so every open ask, item and request goes to the operator.
  `diverged` is never an act state: the act states stay closed (Table 10.1b), and nothing an older build reads
  changes.

## model2:F5 [major]
QUOTE: each authority field takes the stricter of the database and the journal

PROBLEM: "The stricter" is not defined for the designation's bound session, and §3.1 says Confirm "keeps the same body". A retire, then a restore: the row binds the retired body again and Confirm keeps it. A forced rebind, then a restore: the stopped old body is the Overlord again, and the body the journal names runs undesignated (I7). Trace: `traces/restore-revives-earlier-body.txt`. And "the term rises" from the restored row can issue a term the journal already holds: `traces/restore-term-issued-twice.txt`.

OLD:
  - the term rises (§3.1);
  - each authority field takes the stricter of the database and the journal;

NEW:
  - the term rises above the higher of the row's and the journal's (§3.1);
  - each authority field takes the stricter of the database and the journal. For the designation: when the
    journal's last designate, rebind or retire names another session than the row binds, or none, the row binds
    no session, both ids join the past session ids, and the operator starts the Overlord again;

## model2:F6 [major]
QUOTE: A window that ran out unseen adds no evidence

PROBLEM: A staged row's one push says "The Overlord will answer B". When the act is `voided` (a change of authority, or eight hours unseen), the row is the operator's again and nothing pushes: `pushDue` is asked on a reach, a change of level and a batch flush only (§6.7), and I2 allows one outbox row. A coordinator then waits on an item the operator believes is handled (R3). No reading avoids it. Trace: `traces/voided-act-silent.txt`. The text also does not say when a change of authority voids the act. If only the commit does, a revoked grant leaves "The Overlord will answer B" on screen until the operator has watched the window out: `traces/staged-act-stands-after-revoke.txt`.

NEW:
  - **A voided act goes back to the operator, and says so.** A latch, a revocation, an expiry, a lower rung or a
    raised term voids a staged act in the transaction that makes the change. A condition does not: the commit
    decides. A voided act is an event for `pushDue` (§6.7): the row's one outbox row is sent again under the
    row's tag, as a repeat is, and says the Overlord did not answer.

WHERE:   - **A window that ran out unseen adds no evidence.** It is never agreement.

## model2:F7 [major]
QUOTE: The transaction that makes it `effective` runs `overlordMayAct`, the fence

PROBLEM: The commit is the server's, so "the fence" has no caller to check. Read as the act row's stamps (term and generation), every renewal voids every staged act: `traces/commit-fence-renewal-voids.txt`. The daily backstop and the idle trigger renew at least once a day, and the veto clock runs only while the operator watches, so an act staged overnight rarely commits. Read as the term alone, an act commits under a generation that did not stage it, which I5 forbids as worded: `traces/commit-fence-term-only.txt`. The NEW text keeps the stricter reading and states its price. If a staged answer should outlive a renewal, write "the fence is the act row's term alone" here, and add to I5 "or the commit of an act that a generation of the current term staged".

OLD:
  - **The commit re-checks.** The transaction that makes it `effective` runs `overlordMayAct`, the fence, the rung and
    the row's state again.

NEW:
  - **The commit re-checks.** The transaction that makes it `effective` runs `overlordMayAct`, the rung and the
    row's state again. The fence is read from the act row's own stamps: its term and its generation must still
    be the current ones. So the mint of a later generation voids a staged act, as a rebind and a restore do, and
    its item is the operator's.

## model2:F8 [major]
QUOTE: After eight hours unseen

PROBLEM: "Unseen" is not defined. Read as "no console ever showed it", an act the operator watched for less than the window, and never again, has no exit: the veto clock waits, the fallback never fires, and only Veto, Answer now or the end of its authority ends it. Trace: `traces/staged-act-no-exit.txt`. The eight hours are also missing from Table 11.5b. They fail towards the operator, so by §11.5 they are wall time.

OLD:
  - **After eight hours unseen**, the answer falls back to an ordinary item for the operator.

NEW:
  - **After eight hours with the window not run out**, seen or not, the answer falls back to an ordinary item for
    the operator. The eight hours are wall time, counted from the staging.

## model2:F9 [major]
QUOTE: It is first set from the read-back's "first news due"

PROBLEM: `followUpAt` is first set by the read-back (§5.4). A request that is `received` (the Overlord stopped before it routed), or `routed` to an owner that never answers (a dead coordinator, an ended programme), has no clock. No nudge fires, so "two silent nudges" never moves it to `needs-you`, though Figure 3 draws that move from `routed`. Nobody owns it and nobody is told. The mail lane's notice that a relay parked goes to the Overlord, not to the operator. No reading avoids it. Trace: `traces/request-no-clock-before-readback.txt`.

OLD:
  - **`followUpAt` is stamped by the server.** It is first set from the read-back's "first news due", within a
    ceiling from an L0 table (Table 11.5b). Each later nudge re-times it.

NEW:
  - **`followUpAt` is stamped by the server.** It is set when the request is opened, and again at each move that
    leaves the next step to a session (a relay, a counter, a decline), to a ceiling from an L0 table (Table
    11.5b). The read-back then sets it from its "first news due", within that table's ceiling. Each later nudge
    re-times it. So every open request outside `needs-you`, `done-unverified` and `blocked` has a clock. A parent
    takes none of its own: its children carry theirs.

## model2:F10 [major]
QUOTE: effective rung instead, at `advise` and `full` (§7.5)

PROBLEM: The arm runs at `advise` and `full`. `off` moves every unacknowledged request to `needs-you`, and `chat` does not. `chat` is reached by Pause and by the server alone: a `degraded` generation, the 95% load line, failed probes, a detected restore. There the Overlord may not relay or nudge, the arm is stopped, and the server's own move to `needs-you` needs two nudges. A request with a silent owner stays where it is. Trace: `traces/request-arm-stops-at-chat.txt`.

OLD:
    switch about workers. So the follow-up arm runs on the Overlord's
    effective rung instead, at `advise` and `full` (§7.5). It is keyed on its subject, as run-less notices are, so a
    restart never sends a nudge twice.

NEW:
    switch about workers. So the follow-up arm runs on the Overlord's
    effective rung instead, at `advise` and `full` (§7.5). At `chat` it sends no nudge: a follow-up that comes due
    there moves its request to `needs-you`, so a rung the server lowered leaves no request unfollowed. It is keyed
    on its subject, as run-less notices are, so a restart never sends a nudge twice.

## model2:F11 [major]
QUOTE: the follow-up clocks are dropped and timed again from the boot

PROBLEM: Every boot times every clock again from the boot. A follow-up due in two hours is pushed out by a restart one hour in, and again by the next. The server restarts at every update, so a request whose owner promised first news in days may never get a nudge and never reach `needs-you`. Trace: `traces/request-gap-pushes-followup-out.txt`.

OLD:
  - **After a server gap** the follow-up clocks are dropped and timed again from the boot. A gap never fires a burst
    of nudges.

NEW:
  - **After a server gap** only a follow-up that came due while the server was down is timed again, spread after
    the boot. One that is not yet due keeps its time. A gap never fires a burst of nudges, and never pushes one
    out.

## model2:F12 [major]
QUOTE: The operator's answer keeps its meaning for a request that reached `needs-you` any other

PROBLEM: Table 5.1b sends every answered request from `needs-you` to `in-progress`. A request also reaches `needs-you` from `received` (no owner yet), from `routed` after two counters (no accepted done test), and at `off` before an ack. Answered, it is `in-progress` with no owner or no accepted done test: nobody reports on it and the done-test lane has nothing to pass. Figure 3 has a second edge for the same event ("routed after the operator's answer") and nothing says which applies. Trace: `traces/request-answer-without-ack.txt`.

OLD:
  the follow-up arm sends no nudge and the Overlord relays nothing on it. The operator's hand back returns it to
  `takenFrom`, and clears it. The operator's answer keeps its meaning for a request that reached `needs-you` any other
  way.

NEW:
  the follow-up arm sends no nudge and the Overlord relays nothing on it. The operator's hand back returns it to
  `takenFrom`, and clears it. The operator's answer keeps its meaning for a request that reached `needs-you` any other
  way: it moves the request to `in-progress` only when its owner has acknowledged it. Otherwise the answer is
  recorded, the request stays `needs-you`, and the Overlord routes it ("routed after the operator's answer",
  Figure 3).

## model2:F13 [major]
QUOTE: A spent budget lets only a verified `blocking-now` through.

PROBLEM: Table 4.2a gives `blocking-by` a deferral limit: its time less the lead. This sentence lets nothing but a verified `blocking-now` through a spent budget. A `blocking-by` row that comes due after the day's pushes are spent waits for the next briefing time, which can lie after the time it is needed by, and I2 accepts any "stated time". No reading avoids it. Trace: `traces/push-blocking-by-deferred-past-limit.txt`.

OLD:
- **A spent budget lets only a verified `blocking-now` through.** That push is logged as an overdraft, with its cause.

NEW:
- **A spent budget lets through a verified `blocking-now`, and a `blocking-by` at its deferral limit.** Each such
  push is logged as an overdraft, with its cause.

## model2:F14 [major]
QUOTE: Each urgency has a deferral limit.

PROBLEM: Quiet hours and "away until" are Settings with no stated effect on a push. Read as "no push inside them", a `blocking-by` whose limit falls inside quiet hours goes out after the time it is needed by: `traces/push-quiet-hours-past-limit.txt`. The console rule has the same gap. I2 says a push may be "settled with no push because the operator opened the console". Read for every deferred push, a `blocking-by` row is never pushed once the operator has opened the console for anything: `traces/push-console-settles-blocking-by.txt`.

OLD:
- **Each urgency has a deferral limit.** The escalate door takes one of three urgencies, in Table 4.2a.

NEW:
- **Each urgency has a deferral limit.** The escalate door takes one of three urgencies, in Table 4.2a. Nothing
  defers a push past its limit. Quiet hours and "away until" hold a push only up to it, and an open console
  settles a pending batch and nothing else.

## model2:F15 [major]
QUOTE: A latched suspension returns to

PROBLEM: C26's row has one `state` and no place for a suspension's kind or cause. If a condition is stored as `suspended`, the lane that lifts it when the condition ends also lifts a latch that fell meanwhile: an overturned grant is live again with no tap (Table 7.2a: "the operator only"). Trace: `traces/grant-condition-lifts-latch.txt`. And "latches every grant" (§3.1) meets a grant still in `shadow`. Read as `suspended`, the operator's tap on the `live` door makes it live with no shadow report, against "It leaves shadow only on the operator's tap on its shadow report": `traces/grant-shadow-latch-skips-report.txt`.

OLD:
- **The states.** `shadow`, then `live`, then `suspended`, `revoked` or `expired`. A latched suspension returns to
  `live` only by the operator's tap.

NEW:
- **The states.** `shadow`, then `live`, then `suspended`, `revoked` or `expired`. `suspended` is the latch alone,
  stored with its cause, and it returns to `live` only by the operator's tap. A condition is never stored: it is
  read at each call, as the ladder's conditions are, so a condition that ends lifts no latch. A latch leaves a
  grant in `shadow` where it is: it leaves shadow only by its shadow report.

## model2:F16 [minor]
QUOTE: Confirm the restore keeps the same body

PROBLEM: Companion to the finding on "each authority field takes the stricter": once Confirm can leave the row with no session bound, this sentence is wrong for that case. Same trace: `traces/restore-revives-earlier-body.txt`.

OLD:
  §3.3.11). A raise of the term at designate or rebind binds the body that the same transaction makes `live`, so
  that body's current generation carries the new term. Confirm the restore keeps the same body, so it makes a renewal
  due at once (hard, Table 3.3.11b), and the next generation carries the raised term.

NEW:
  §3.3.11). A raise of the term at designate or rebind binds the body that the same transaction makes `live`, so
  that body's current generation carries the new term. Confirm the restore keeps the same body unless the
  journal names another (§7.6). Where it keeps it, it makes a renewal due at once (hard, Table 3.3.11b), and the
  next generation carries the raised term.

## model2:F17 [minor]
QUOTE: The longest "first news due" a read-back may promise

PROBLEM: Companion to the finding on `followUpAt`: the clock set at the open, the relay, a counter and a decline needs a starting value. M5's target is a read-back under one hour. Same trace: `traces/request-no-clock-before-readback.txt`.

NEW:
| One hour | How long a request may wait for its next move (a route, a read-back, a re-relay) before a follow-up comes due | W2 | wall |

WHERE: | Seven days | The longest "first news due" a read-back may promise | W2 | wall |

## model2:F18 [minor]
QUOTE: Follow-up clocks drop and re-time.

PROBLEM: Companion to the finding on "After a server gap": this sentence states the same rule. Same trace: `traces/request-gap-pushes-followup-out.txt`.

OLD:
  in one grouped push, `server-gap`. Follow-up clocks drop and re-time. A clean shutdown seals state locally and

NEW:
  in one grouped push, `server-gap`. A follow-up that came due meanwhile is timed again (§5.4).
  A clean shutdown seals state locally and

## model2:F19 [minor]
QUOTE: for a request that reached `needs-you` any other way than a take); take (

PROBLEM: Companion to the finding on "The operator's answer keeps its meaning": the table's row for the operator states the same move. Same trace: `traces/request-answer-without-ack.txt`.

OLD:
| the operator | answer (`needs-you` to `in-progress`, for a request that reached `needs-you` any other way than a take); take (`routed`, `in-progress` or `blocked` to `needs-you`, recording that state in `takenFrom`, with the reason `operator-took-it` on the move's news row); hand back (`needs-you` to the state in `takenFrom`, which it clears); confirm (`done-unverified` to `done`); withdraw (to `dropped` from `received`, `routed`, `in-progress`, `needs-you` or `done-unverified`) |

NEW:
| the operator | answer (`needs-you` to `in-progress`, for a request its owner has acknowledged that reached `needs-you` any other way than a take; for any other such request the answer is recorded and it stays `needs-you` for the Overlord to route); take (`routed`, `in-progress` or `blocked` to `needs-you`, recording that state in `takenFrom`, with the reason `operator-took-it` on the move's news row); hand back (`needs-you` to the state in `takenFrom`, which it clears); confirm (`done-unverified` to `done`); withdraw (to `dropped` from `received`, `routed`, `in-progress`, `needs-you` or `done-unverified`) |

## model2:F20 [minor]
QUOTE: Within the budget; every overdraft a verified `blocking-now`

PROBLEM: Companion to the finding on "A spent budget": M25's target would count the new overdraft as a miss. Same trace: `traces/push-blocking-by-deferred-past-limit.txt`.

OLD:
| M25 | Attention: interrupting pushes per active day against the budget, overdrafts and their causes, minutes deferred | Within the budget; every overdraft a verified `blocking-now` | `pushAdmission`'s records |

NEW:
| M25 | Attention: interrupting pushes per active day against the budget, overdrafts and their causes, minutes deferred | Within the budget; every overdraft a verified `blocking-now` or a `blocking-by` at its deferral limit | `pushAdmission`'s records |

## model2:F21 [minor]
QUOTE: deferred by the attention budget to a stated time

PROBLEM: A gap in the invariants. I2 is met by a push deferred to any time at all, so the planted bug "a deferral ignores the deadline" is caught only by the check this model added (P1), not by I2. Same trace: `traces/push-blocking-by-deferred-past-limit.txt`.

OLD:
| I2 | A row that reached the operator has exactly one reach stamp and one outbox row. That row is sent (the sender marks it once the push service accepts it), silent because today's build pushes nothing for a row of that level, deferred by the attention budget to a stated time, or settled with no push because the operator opened the console (§4.2) |

NEW:
| I2 | A row that reached the operator has exactly one reach stamp and one outbox row. That row is sent (the sender marks it once the push service accepts it), silent because today's build pushes nothing for a row of that level, deferred by the attention budget to a stated time no later than its deferral limit (Table 4.2a), or settled with no push because the operator opened the console (§4.2) |

## model2:F22 [minor]
QUOTE: `latchedCap`, with its cause: set by evidence of bad judgement

PROBLEM: One stored cap with one cause, but Table 7.5a has latches that cap at `advise` and at `chat`, and more than one can stand. If a second latch overwrites the first, a `chat` latch followed by an `advise` latch raises the rung with no operator: `traces/ladder-second-latch-raises-rung.txt`. If the lower is kept, one clear lifts a latch whose cause the operator was never shown.

OLD:
  - `latchedCap`, with its cause: set by evidence of bad judgement or doubtful authority, cleared only by the operator;

NEW:
  - `latchedCap`: the lowest cap of the standing latches. Each latch is a row with its cause and its cap, set by
    evidence of bad judgement or doubtful authority and cleared only by the operator, one cause at a time. A new
    latch never raises the cap;

## model2:F23 [minor]
QUOTE: Every grant expires after 30 days.

PROBLEM: The lane writes `expired`, and a door call or the staged commit can fall between the expiry time and that write. A staged act then commits under a grant past its expiry: `traces/commit-expired-grant.txt`. `overlordMayAct` already takes `now` (§7.1).

OLD:
  Every grant expires after 30 days.

NEW:
  Every grant expires after 30 days. `overlordMayAct` reads `expiresAt` against `now` at each call: the lane's
  write of `expired` is the record, not the gate.

## model2:F24 [minor]
QUOTE: Unarmed, the check is skipped:

PROBLEM: The commit runs `overlordMayAct` again, and decision-model answers are "gathered first and passed in" (§7.1). The text does not say whether the commit asks again or reuses the staging's answer. An act staged with the check unarmed commits after the operator armed it, with no clear yes on record: `traces/commit-blind-check-skipped.txt`.

OLD:
  Anything short of a clear yes answers `defer`, and the matter goes to the operator. Unarmed, the check is skipped:
  the code checks and the veto window stand, and the act row records that it did not run. Why blind: a monitor that

NEW:
  Anything short of a clear yes answers `defer`, and the matter goes to the operator. Unarmed, the check is skipped:
  the code checks and the veto window stand, and the act row records that it did not run. The commit of a staged
  act reads that record and asks nothing again: if the check is armed at the commit and the row holds no clear
  yes, the act is `voided`. Why blind: a monitor that

## model2:F25 [minor]
QUOTE: **After each boot, grants read as suspended and the rung is capped at `advise`**

PROBLEM: Until the first witness answers, the cap is `advise`. After a whole-volume restore that is enough to act: a rung the operator had lowered to `chat` is back at `advise`, and the Overlord relays again what it already relayed (I3), until the witness answers and flags the restore. On one box that is until a console signs in. Trace: `traces/restore-volume-window-before-witness.txt`. A cap of `chat` closes it (the model's safe reading), but on one box it stops relays and follow-up after every restart until the operator signs in. So the NEW text states the residual, and the operator should rule on the cap.

OLD:
  - **After each boot, grants read as suspended and the rung is capped at `advise`** until one witness off the
    server's volume has answered (Table 7.2a, Table 7.5a). On one box that is the first signed-in console.

NEW:
  - **After each boot, grants read as suspended and the rung is capped at `advise`** until one witness off the
    server's volume has answered (Table 7.2a, Table 7.5a). On one box that is the first signed-in console. What
    is left: after a restore of the whole volume, acts of the `advise` rung run, and may repeat, until that
    answer.

## model2:F26 [minor]
QUOTE: The `chat` cap stays as an ordinary latch

PROBLEM: Only message ids are kept from reuse (§5.1). After a restore the database's counters go back: the next grant takes the id of a grant the journal already records, and an act row that cites `grant:<id>` names the wrong grant in the Log. Trace: `traces/restore-grant-id-reused.txt`.

NEW:
- **No id is used twice across a restore.** After Confirm the restore, the ids of grants, acts, proposals and
  commands start above the highest their journals hold, as message ids do (§5.1).

WHERE:   other (§7.5).

## model2:F27 [minor]
QUOTE: A start that never reports fails the check.

PROBLEM: "The door treats the sandbox check as failed" reads as a wait inside the door's process, and Table 11.1a gives the designation row no lane. A server crash while the row is `pending` then leaves no deadline: the row stays `pending`, and "Start the Overlord" refuses `overlord-exists` until the operator retires or forces a rebind. Trace: `traces/pending-designation-no-deadline.txt`.

OLD:
  - **A start that never reports fails the check.** If no start report arrives within the `carded` deadline and its
    one re-nudge (Table 3.3.11a), the door treats the sandbox check as failed, as above. A pending row never stands
    without a deadline, so `overlord-exists` cannot wedge the next "Start the Overlord".

NEW:
  - **A start that never reports fails the check.** The door writes the `carded` deadline and its one re-nudge
    (Table 3.3.11a) on the `pending` row. If no start report arrives by then, the renewal lane treats the sandbox
    check as failed, as above, after a server restart too. A pending row never stands without a deadline, so
    `overlord-exists` cannot wedge the next "Start the Overlord".

## model2:F28 [minor]
QUOTE: drop (`received`, `declined` or `needs-you` to `dropped`, with a reason)

PROBLEM: A gap in the invariants. A `needs-you` request waits on the operator. Table 5.1b lets the Overlord route it only "after the operator's answer", and drop it with only a reason. So it can take a row off the operator's Needs you group by itself. For questions §6.7 refuses that (`operator-has-it`); for requests the refusal covers a taken request only. Trace: `traces/request-overlord-drops-needs-you.txt`.

OLD:
| the Overlord | open (to `received`); route (`received` to `routed`); re-relay (stays `routed`), to answer a counter with the revised done test; route elsewhere (`declined` to `routed`, and `needs-you` to `routed` after the operator's answer); drop (`received`, `declined` or `needs-you` to `dropped`, with a reason) |

NEW:
| the Overlord | open (to `received`); route (`received` to `routed`); re-relay (stays `routed`), to answer a counter with the revised done test; route elsewhere (`declined` to `routed`, and `needs-you` to `routed` after the operator's answer); drop (`received` or `declined` to `dropped`, with a reason; `needs-you` to `dropped` only after the operator's answer, and refused `operator-has-it` before it) |

## model2:F29 [minor]
QUOTE: **Dependencies cannot loop.**

PROBLEM: If the unblock runs only when the awaited work ends, a request the operator took from `blocked` and handed back after that event returns to `blocked` for good: `blocked` has no follow-up (Figure 3). Trace: `traces/request-handback-to-blocked.txt`.

OLD:
  - **Dependencies cannot loop.** The `blocked` door refuses a cycle (`dependency-cycle`). The server unblocks a
    request when what it waits on is done. If that ends any other way, the request moves to `needs-you`.

NEW:
  - **Dependencies cannot loop.** The `blocked` door refuses a cycle (`dependency-cycle`). The server unblocks a
    request whenever it measures that what it waits on is done: at that event, and when a request enters
    `blocked`, a hand back included. If that ends any other way, the request moves to `needs-you`.

## model2:F30 [minor]
QUOTE: so a retry can act once its cause clears

PROBLEM: A start is keyed by its request and its name (§8.2). If the far host refuses it, the row settles `refused` and still holds that key. Read as a plain unique key, every later start for the request finds the refused row and does not act: the request's one start is spent on a start that never happened. Trace: `traces/command-refused-start-blocks-retry.txt`.

OLD:
  dedupe: a repeated key returns the first call's row and outcome, and never acts again. A refusal at
  the gate writes no row and stores no key, so a retry can act once its cause clears. Refusals are counted by word.

NEW:
  dedupe: a repeated key returns the first call's row and outcome, and never acts again. A refusal at
  the gate writes no row and stores no key, so a retry can act once its cause clears. A row settled `refused`
  frees its natural key too: no effect happened, so a later call may act under a new row. Refusals are counted
  by word.

## model2:F31 [minor]
QUOTE: A command that expires unused is told to the operator.

PROBLEM: A command is consumed when its act row is written `pending` (§10.1). If the effect then fails, the proposal is `consumed`, the command is spent, and nothing tells the operator that what they commanded did not happen: only an answer's question goes back to them (Table 10.1b). Trace: `traces/command-refused-act-untold.txt`.

OLD:
  - **Live commands are band 1 of the inbox (§6.8).** A command that expires unused is told to the operator.

NEW:
  - **Live commands are band 1 of the inbox (§6.8).** A command that expires unused is told to the operator. So is
    a commanded act that settles `refused` or `unknown`: the command is spent and the act did not happen.

## model2:F32 [minor]
QUOTE: to `stale` when a target row moves

PROBLEM: Only `open` moves to `stale`. A target row that moves while the proposal is `commanded` leaves it as it is. The act refuses `proposal-stale`, the command runs out, and the proposal returns to `open` with a moved target. Its card is offered again, and it holds the target's one proposal slot until its 24 hours end. Trace: `traces/proposal-open-with-moved-target.txt`.

OLD:
    `expired` after 24 hours. `commanded` moves to `consumed` in the transaction that writes its act row, and back to
    `open` when the command's 15 minutes pass unused. All but `open` and `commanded` are terminal.

NEW:
    `expired` after 24 hours. `commanded` moves to `consumed` in the transaction that writes its act row, to
    `stale` when a target row moves (its command ends with it, and the operator is told), and back to
    `open` when the command's 15 minutes pass unused. All but `open` and `commanded` are terminal.

## model2:F33 [minor]
QUOTE: `batchable` | The next briefing time

PROBLEM: Briefing times are a Setting with no default (§4.2). With none set there is no "next briefing time": a `batchable` push is deferred with no time, and goes out only if the operator opens the console. Trace: `traces/push-batch-no-briefing-time.txt`.

OLD:
| `batchable` | The next briefing time | Always |

NEW:
| `batchable` | The next briefing time. With no briefing time set, it is not deferred | Always |

## model2:F34 [minor]
QUOTE: One sender drains the outbox. It marks a row sent

PROBLEM: The boot pass "sends every unsent row again". A push the budget deferred is unsent too. Read so, every server restart sends the deferred pushes at once, briefing time or not. Trace: `traces/push-boot-sends-deferred.txt`.

OLD:
  - One sender drains the outbox. It marks a row sent when the push service accepts it. It retries an unsent row,
    with backoff, while it runs, and sends every unsent row again at boot.

NEW:
  - One sender drains the outbox. It marks a row sent when the push service accepts it. It retries an unsent row,
    with backoff, while it runs, and sends every unsent row again at boot. A row the attention budget deferred
    to a stated time is not unsent before that time (§4.2).

## model2:F35 [minor]
QUOTE: An unseen blocking item pushes once more after two hours

PROBLEM: Today's build pushes a blocking item once. A repeat for an item the tier never held is a push that a build without the Overlord does not send, which I9 forbids: `traces/push-repeat-never-held-row.txt`. And I2 allows one outbox row: a repeat written as a second row breaks it: `traces/push-repeat-second-outbox-row.txt`.

OLD:
- **An unseen blocking item pushes once more after two hours** (a Setting). That repeat costs 2.

NEW:
- **An unseen blocking item that the tier held or escalated pushes once more after two hours** (a Setting). That
  repeat costs 2. It sends the row's one outbox row again, under the row's tag, and adds no row (I2). A blocking
  item the tier never held pushes once, as today's build does (I9).

## model2:F36 [minor]
QUOTE: live to live, renewed

PROBLEM: The split that gives a holdout is stated for the canary only (§9.7). A live entry served every time has nothing to measure at 45 days. Read as "nothing measured renews", an entry is renewed with no evidence: `traces/practice-renewed-unmeasured.txt`. Read as "nothing measured expires", no entry lives past 45 days.

OLD:
| live to live, renewed | the practice lane, at 45 days, on a non-negative measured effect |

NEW:
| live to live, renewed | the practice lane, at 45 days, on a non-negative effect measured against the holdout. A live entry keeps the canary's holdout. With nothing measured it is not renewed |

## model2:F37 [minor]
QUOTE: proposed to shadow

PROBLEM: The replay runs after the entry is filed, so "refused" cannot be the door's answer. Table 9.7a has no state for a contradicted entry: it stays `proposed`, with no move out. Trace: `traces/practice-proposed-stays.txt`.

OLD:
| proposed to shadow | automatic, after a clean replay of the last 60 days; otherwise refused `practice-contradicts` |

NEW:
| proposed to shadow | automatic, after a clean replay of the last 60 days; otherwise the entry is `retired`, with the reason `practice-contradicts` |

## model2:F38 [minor]
QUOTE: any state to retired

PROBLEM: The 45-day clock starts at live, and "90 days" names no start. A canary that waits on a full live budget has no clock and waits for ever: `traces/practice-canary-waits-for-ever.txt`. An `operator` entry "never expires by itself", but a guard breach retires "any state": the server would withdraw the operator's own ruling: `traces/practice-operator-entry-retired.txt`.

OLD:
| any state to retired | automatic on a guard breach, on expiry, or at 90 days without graduation; or the operator |

NEW:
| any state but `graduated` to retired | automatic on a guard breach, on expiry, or 90 days after its first serving without graduation; or the operator. An `operator` entry is retired only by the operator: a guard breach on one raises an item |

## Passages that restate an edited rule

These say the same thing as a passage a finding changes. No finding edits them, so the editor should bring them
into line by hand:

- **F1, F4.** Table 10.1a's `divergedAt` row, Table 11.1a's `overlord_acts` row and §16's risk row "A restore
  revives authority" each say the pass sets `divergedAt` on "each act the act journal holds after the snapshot" and
  name asks and items only.
- **F2.** The caption of Table 7.6a ("Only narrowing records are ever replayed") stays true.
- **F3.** Table 11.1a's "The witness epoch" row, and Table 11.6's `authority-rolled-back` row ("or a witness holds
  a higher epoch").
- **F5.** Table 11.1a's `overlord_designation` row and Table 11.1e's "Confirm the restore" row.
- **F6.** Table 10.1b's `staged` row, and §6.7's list of the events `pushDue` is asked on.
- **F7.** I5, only if the other sentence (the term alone) is chosen.
- **F8.** Table 11.5b has no row for the eight hours.
- **F9, F10.** §13's C15 row ("armed by the Overlord's rung").
- **F28.** Table 11.6's `operator-has-it` row names a taken request only.

## 4. What this model still does not cover

- **Bounds.** One grant, one item, one staged act, one request, one proposal slot, one outbox row, one playbook
  entry. Four to six ticks where time is bounded. One or two server crashes. Liveness checks say that a path exists
  on the bounded graph. They are not fairness guarantees.
- **Grants.** The conditions of a grant other than its model class and the witness: `operator-started-only`,
  `max-per-day`, `only-when-recommended-by-coordinator`, identity strength. Whether a staged or vetoed act counts
  towards `max-per-day` is not settled by the text and was not modelled. Evidence, the proposal a server raises
  itself, and the renewal sheet's three blind spot-checks are one tap here.
- **A Veto that arrives after the commit.** §6.7 says an operator's tap is never refused for a stale revision. It
  does not say whether a late Veto is `overturned` (it latches the grant) or `superseded` (it does not).
- **The ladder.** Only two latches and two conditions. Supervision debt, missed weekly checks, the breaker's
  condition, the load lines, engagement per programme and `operator-at-programme` are not modelled.
- **The witness.** One witness. A witness that reports an epoch it never saw (any process of the fleet user can
  edit an agent's copy) can force `authority-rolled-back` at will. That narrows, so it is safe, but it is a lever
  the text does not mention.
- **A restore.** What a restore does to rows no journal records: request moves by an owner, holds, proposals,
  the private store. Ids of requests and runs after a restore. The privacy journal. A restore while a designation
  is `pending`. The interplay of a restore with a staged act and a held row is taken from the grant machine (every
  grant is latched, so the act is voided) and from round one (holds are released), not explored jointly.
- **Requests.** Parent and child requests, a split, the done test's predicates, `expectedPaths`, goal conflicts,
  the one-tap next steps, engagement and the 30-minute pause. A request blocked on a programme: the text does not
  say when a programme is "done". The relay's own ceilings and egress checks.
- **Commands.** The proposal limits (one per target, three in all), `replaced`, the hash of what the card showed,
  the performer's mark down the chain, objections, and a command on a `shared-user` box.
- **The budget.** Its shadow period, the count per active day across days, "away until" as a date, bundles, the
  decision queue's rank, and the cost of a repeat against a nearly spent budget.
- **The playbook.** Cases, retros, the 60-day replay itself, the live budget's count, graduation's pull request,
  cross-project entries, and retirements in the authority journal.
- **Not touched at all.** The decision model, the operator model and its privacy rules, the audit, the replay body,
  drills, accounts and reservations, the launch profile and the sandbox check. I6 was not modelled.
- **One reading.** A rule misread without noticing would not show up. Each rule cites its section so that it can be
  checked against the text.
