# The authority-and-restore model: results (Overlord W1, authority journal Task 1)

The model is W0's explicit-state explorer (`server/test/model/overlord/model.py` and `check.py`), extended behind one
switch, `AUTH_W1`. It is off by default. With it on, W0's coarse authority tuple (`auth_events`, `boot_coherence`, I7,
I7t and the W0 Confirm) is bypassed and a new tuple, `AW`, models this plan's journal, witnesses, guard and Confirm.
The rest of the machine is quiet in every W1 scenario (`N_Q=0`, no questions), so the state space is the authority
subsystem. Every run below went through the fleet test slice.

## With `AUTH_W1=False` nothing changes

`--json` for each FAST scenario before and after the edit, identical byte for byte (states, transitions, violated,
reachable):

| Scenario | States | Transitions |
|---|---|---|
| push | 8746 | 29492 |
| pause | 7465 | 25271 |
| race | 1888 | 6831 |
| asks | 4304 | 14394 |
| value | 264 | 709 |
| lineage | 424 | 977 |
| deadpush | 812 | 2287 |
| restore | 4563 | 13002 |
| rebind | 40745 | 119611 |
| genback | 2374 | 5869 |

The test file pins `restore`'s 4563 / 13002 as well.

## Scenarios (every invariant holds in each)

| Scenario | States | Transitions | Seconds | Violated |
|---|---|---|---|---|
| restore-w1 (a snapshot, either restore, two changes, a crash, a Confirm, two exchanges) | 83,292 | 201,223 | 2.3 | none |
| witness (one change, one privacy record, a restore, three exchanges in every order, a Confirm) | 220,003 | 587,020 | 6.4 | none |
| writer-failure (a failure after the append, a failed append, a narrowing, a Confirm) | 40,006 | 86,574 | 1.0 | none |
| malformed (damage past the heal, a narrowing, a Confirm) | 14,898 | 32,662 | 0.5 | none |
| confirm (a restore, two Confirms, two exchanges, a change; full list only) | 486,684 | 1,131,875 | 12.9 | none |

All four of the first rows are in the default (FAST) suite. `confirm` runs under `CCRC_MODEL=full`. The scenarios'
sanity facts are reachable: a witness refuses a restored volume, boot coherence finds a restore, a failure after the
append leaves a trailing record under a rolled-back guard, Confirm makes a rolled-back journal coherent, the boot finds
a malformed journal, the operator is told a narrowing took effect, and `no-witness-since-boot` lifts.

## What `AW` holds, and the events

Fields: the authority journal file as a tuple of records (rung, latch and Confirm records, each with a fork id); the
privacy journal as a tuple of fork ids; the head row `(sequence, fork)` and whether an Overlord row exists; the
continuation for "record appended, row not yet committed"; `malformed`; the guard (`coherent`, `rolled-back` with its
cause, or `unmeasured`); the boot nonce, reduced to "this boot" on each witness's tuple; the three witnesses (console,
same-host agent, other-host agent), each holding `(epoch, base, authority head, privacy head, restore generation,
this-boot)` or nothing; which witnesses answered since boot; which had answered at the last Confirm; the narrowings
appended and not yet held off the volume, and the narrowings the operator was told took effect; a snapshot slot; the
lineage counter (a restore followed by an append makes a new fork, which is how two histories of equal length differ);
the remaining budgets. The operator rung and the latch cap are the rows (`s.rung`, `s.latch`).

Events: the operator's four doors (rung down, rung up, latch raise, latch clear) as append-then-commit in two
transitions; a failure after the append in a running server (F1); an operator narrowing over an incoherent journal, row
only (Q9, X3); a narrowing whose append fails on a coherent journal, row only, guard off coherent (X3b); the door's
re-measure of an `unmeasured` guard; the file damaged past the heal while the server is down (Q17); a privacy record;
one exchange per witness (Task 5's table, first match); a crash; a boot that runs Table 7.6a; a snapshot; a restore of
`coord.db` alone and of the whole volume (the same-host agent's tuple comes back with the volume); and Confirm the restore
(stricter-of; a new chain over a malformed journal; epoch and generation each above the journal's and every answered
witness's; the head row moves to the Confirm record; the latch stands, F4).

Invariants: I7w as the coordinator's ruling amends it (below), I11a, RG, WH and NL as the plan states them; liveness as L1 (from any state whose journal is not
coherent, a Confirm reaches `coherent` along edges that are not restores) and L2 (the "stays" half: after a Confirm and no
restore, a witness that had answered before it never refuses again).

**I7w, amended** (the coordinator's ruling, `told-narrowings-survive-confirm`): after any restore, no authority field
the server acts on is wider than every narrowing the operator was told took effect, and a told narrowing is not dropped
at Confirm; and, while the guard is coherent, each row is at least as narrow as the journal's fold, never wider.
Equality is no longer required, because Confirm may take a witness's narrower state.

## Planted mutations

Each runs against its scenario with and without the mutation. "Caught by" is the new violations.

| Mutation | Scenario | The plan names | Caught by | Seconds |
|---|---|---|---|---|
| same_host_agent_counts | restore-w1 | WH, I7w | WH, I7w | 1.8 |
| epoch_in_db | confirm | I7w | **L2** (see finding 1) | 10.7 |
| heads_not_checked | witness | I7w | I7w | 5.2 |
| confirm_no_epoch_raise | confirm with `W1_CHANGES=1 RESTORES=2 W1_EXCHANGES=5` | liveness | L2 | 32 |
| trailing_widening_applied | writer-failure | I11a | I11a | 0.7 |
| append_over_incoherent | writer-failure | I11a | I11a | 0.7 |
| narrowing_refused_while_incoherent | writer-failure | NL | NL | 0.7 |
| narrowing_refused_on_append_failure | writer-failure | NL | NL | 0.5 |
| writer_failure_unfenced | writer-failure | liveness | L1, and I7w's inequality | 0.7 |
| no_confirm_over_malformed | malformed | liveness | L1 | 0.2 |
| restore_generation_in_db | confirm | RG | RG | 9.6 |
| generation_ignores_witnesses | confirm | RG | RG | 11.0 |
| confirm_ignores_told | restore-w1 | I7w (the ruling) | I7w | 4 |
| this_boot_witness_counts | restore-w1 | none expected | not caught, as expected | 1.7 |

The ten rows without a long scenario run in the default suite (about 35 s with the scenarios; the whole test file
takes about 38 s). `epoch_in_db`, `confirm_no_epoch_raise`, `restore_generation_in_db` and `generation_ignores_witnesses`
run under `CCRC_MODEL=full`.

## Findings: where the model differs from, or sharpens, the plan

1. **`epoch_in_db` is caught by L2, not I7w.** A restore of `coord.db` alone lowers a stored epoch, but boot coherence
   already refuses that restore by the heads, so the server acts at the `chat` latch either way and I7w holds. The harm
   is in the Confirm that follows: it sets the epoch from the stored (lowered) value, which can sit at or below a
   witness that answered, so that witness refuses again with no restore in between. The plan's row should name L2
   (the liveness rule's "stays" half), not I7w. No rule of the plan changes.
2. **I7w has three stated limits, and the plan's sentence does not say them.**
   - Before every off-volume witness that holds a tuple has answered since boot, the server is in Q8's first window
     (the ladder capped at `advise`, which is wider than a told `chat`). I7w is checked only once those witnesses have
     answered. This is the accepted residual of Q8 (F7b), now stated for I7w.
   - A told narrowing must survive Confirm (`told-narrowings-survive-confirm`, the coordinator's ruling). A
     whole-volume restore takes the narrowing's record and its row together, so after a Confirm that reads only the
     journal and the rows nothing can recover it, and the restore-detected latch (which stands, F4) is the only cap. If
     the operator then clears that latch, the rung row the restore brought back is what the server acts on. The first
     run of this model dropped `told` at Confirm to hide that path. Now the model keeps `told` across Confirm, and
     Confirm takes the narrowest of the restored rows, the journal and the told narrowings held by a counting witness
     that answered since boot (PR B's witness carries them, PR C's Confirm reads them). Every scenario holds, and the
     mutation `confirm_ignores_told` (the plan's first reading) is caught by I7w in `restore-w1`.
   - `off` is not a rung target in the scenarios. A rolled-back guard acts at the `chat` latch, wider than a told `off`.
     The gates' step 3 refuses the Overlord's own doors in that state, so the practical effect is nil, but I7w as worded
     would fail on it.
3. **"Stays coherent" needs an exception for witnesses that had not answered.** Q13 already says this for the
   generation; it holds for the epoch too, and L2 is therefore stated over witnesses that answered before the Confirm.
4. **`confirm_no_epoch_raise` needs two restores and five exchanges to show.** A witness whose base is below the new
   Confirm's reads `stale` and takes the tuple, so a Confirm that fails to raise the epoch matters only when a witness
   holds a Confirm base at or above the new one: a Confirm, a restore past it, a second Confirm. The shortest scenario
   measured is about a million states.
5. **What the model leaves out, on purpose.** The torn-tail heal (the file is `malformed` or sound); damage while the
   server is running (damage happens while it is down and boot finds it, so `writerFailed('malformed')` is not
   exercised); the two `unmeasured` decider rows (an unreadable file or head row), the guard's `unmeasured` state being
   reached only through X3b's failed append; the account set, model class and binding fields (the same stricter-of and
   door rules apply, and they add interleavings, not rules); the act journal's term (W2). Q17's bound for a malformed
   file is the line count, as the plan states; no run found it too low, but a Confirm's earlier base is not recoverable
   from a file that cannot be read, and only the witnesses that answered cover it (the residual of finding 3).
