# Model check of the Overlord design: invariants I1 to I10

Run against an earlier draft of `docs/superpowers/specs/2026-11-09-overlord-design.md`, before the hardened edition
merged. Later drafts fixed several findings. #2529 applies the rest to the spec: each sentence proposed below is
either in the merged edition already or in that pull request.

## Summary

- Every invariant holds within the bounds under one consistent set of readings (the "safe" readings).
- The text did not settle those readings. 24 places carry a switch. 14 of them break an invariant or a stated rule
  under at least one reading. Four are contradictions inside the text.
- One finding is a design fault, not a reading (A15): a renewal that starts in `degraded` and fails goes back to
  `active`. That generation never read its card or ran its probes, and a hold can be taken for it.
- Mutations: all 12 planted bugs that an invariant should catch were caught. The 2 that none should catch were not.

## How to re-run

    cd <this directory>
    python3 check.py --list                                    # scenarios, switches, mutations
    python3 check.py core                                      # one scenario, safe readings, prints traces
    python3 check.py genmachine FAILED_RENEWAL_RETURNS=active  # one reading flipped
    python3 check.py --matrix                                  # 47 runs, about 4.5 minutes
    python3 check.py --mutations                               # about 3.5 minutes
    ./make_traces.sh                                           # writes traces/<name>.txt

Time moves in ticks. Asks hold 1 or 2 ticks, items 2 or 3, triage 1. A server crash can fall between any two
transitions; work the text puts in two transactions is two transitions joined by a continuation a crash clears.

| Scenario | States | Transitions |
|---|---|---|
| core (a class-none item and a `cannot-decide` ask, one server crash, rung to `off`) | 94,966 | 345,638 |
| push | 8,746 | 29,492 |
| pause | 7,465 | 25,271 |
| race (stale revisions, stale operator taps) | 1,888 | 6,831 |
| renewal | 508,800 | 1,778,920 |
| asks | 4,304 | 14,394 |
| grants (an O3 item staged under a grant) | 134,691 | 462,582 |
| value (`state-a-fact`) | 264 | 709 |
| lineage | 424 | 977 |
| nohold | 35,684 | 148,271 |
| deadpush | 812 | 2,287 |
| restore | 4,563 | 13,002 |
| genmachine (three renewals, every timeout) | 674,982 | 2,214,248 |
| rebind | 40,745 | 119,611 |
| readiness | 336,549 | 1,292,292 |
| Total, safe readings | 1,855,883 | 6,454,525 |

## Each invariant

- **I1** holds. Read literally it fails on every Overlord answer, because its wording says nothing about settled rows
  (A23). Real gap: an answer whose act settles `refused` after a crash leaves the row open, not held, not reached, and
  nothing pushes it (A5). Also broken by: the outcome written before the reach stamp (A2); Pause read as "brief only"
  (A9); staging that does not stamp the row (A10); a late answer after a gap (A11).
- **I2** holds. "Sent" cannot hold while the push service is down, so it was checked as liveness. The literal text
  ("sends every unsent row again at boot") means a refused push is retried only after a crash (A13).
- **I3** holds. Broken when a stale operator tap "stands" as a second effect on the same row revision (A6).
- **I4** holds. Broken by `state-a-fact` on a stated entry, which is none of I4's three authorities (A19).
- **I5** holds. Broken when a start report is lost while the server is down: the new conversation's door process uses
  the old generation's key from the fallback file, and `card-unread` never applies to it (A14).
- **I6** holds only if nothing may remove a class. Then "a re-raised item is answered by the Overlord" is unreachable.
  Four sentences could not all hold (A18).
- **I7** holds if "the journal" means the file as it stands after the restore. It fails for what the operator was told
  had committed, when the whole volume is restored before any witness holds the new epoch (A22).
- **I8** holds. The literal card list omits open holds, and trimming by rank can drop them (A8).
- **I9** holds. The literal text pushes a non-blocking item that today's build would not push (A12), and counts the
  dead-Overlord push (A21).
- **I10** holds by construction.
- **Extra.** A15 (the design fault). With `card-unread` standing, Table 6.4a has no row for an unread card and an idle
  turn counts as proof, so the word reads `ready` and a hold is taken. D2: with the card door skipping only three
  gates no generation can finish starting (A7). A readiness cascade: admission reads `saturated` whenever a hold is
  within one service time of its deadline; with no fresh proof afterwards the word falls to `unmeasured`, which
  releases every other hold (A17). `server-gap` is unreachable under the literal tables, because `unmeasured` at boot
  releases everything before the re-seed runs (A20).

## The ambiguities, with the sentence proposed for each

| # | What | Breaks | Proposed sentence |
|---|---|---|---|
| A1 | Which transaction raises a row | D1, I9 | "The row, its hold or its reach stamp, and its outbox row are written in the transaction that raises or releases it." |
| A2 | Outcome before reach | I1, I9, D1 | "The hold's outcome, the reach stamp and one outbox row are written in one transaction. A row is stamped at most once." |
| A3 | When the answer door ends the hold | X2 | "The answer door ends the hold in the transaction that writes the act `pending`." |
| A4 | When the revision moves | X1 | "The `pending` write moves the row's revision, so a tap made before it is stale." |
| A5 | A `refused` answer | I1, D1 | "A `refused` answer also sends its question to the operator, unless the row has already closed." |
| A6 | A stale operator tap | I3, X1 | Either "A stale tap changes nothing, the operator's included", or the tap is applied as a correction at the row's current revision, never as a second effect on the old one. |
| A7 | Which gates the card door skips | D2 | "The card, probe and note doors skip steps 3, 4, 6, 8 and 9." |
| A8 | The card and open holds | I8 | List "every open hold, with its deadline" on the card. "Open holds and unsettled operator messages are never trimmed. If they do not fit, the card lists their ids and says how many it left out." |
| A9 | Pause | I1, D1 | "Pause releases every hold as `off` does: each row reaches the operator in one grouped push, and the handover brief lists them." |
| A10 | Staging | I1, D1 | "Staging writes the row's reach stamp, and the staging push is its outbox row." |
| A11 | A late answer after a gap | I1 | A gate: "the target hold's deadline has passed (`operator-has-it`)". And: "Overlord doors refuse until the boot pass has re-seeded the holds." |
| A12 | Non-blocking rows and pushes | I9 or I2 | "A row whose level makes no push today still gets its outbox row, marked silent. The sender marks it sent at once and shows nothing." Figure 5: "pushes at most once, as today's build would". |
| A13 | Push retry | D3 | "The sender retries an unsent row, with backoff, while it runs, and sends every unsent row again at boot." |
| A14 | A start while the server is down | I5 | "A start the server did not receive is reported again when the server is back, and mints its generation then. ccd removes the key file at every start, so a door process holds no key until its generation is minted." |
| A15 | A failed renewal that began in `degraded` | X4, X5 | "A failure before the first half returns the generation to the state it left: `active` with a hold-off, or `degraded` if the renewal began there." And in Table 6.4a's `renewing` row: "or its generation has not read its card or passed its probes". |
| A16 | `checkpointed` timeout | none | "60, then `clearing` without the note". |
| A17 | No proof yet | cascade | A word `unproved`: none of the above, but no proof since the word last left `ready`. No new holds; standing holds kept. |
| A18 | Removing a class | I6 | Only `unknown` is removed, by a coordinator's re-raise with a stated class. No session removes a member of O1 to O6. |
| A19 | `state-a-fact` | I4 | I4 names a stated entry resting on an operator message as its authority. |
| A20 | `unmeasured` at boot | `server-gap` unreachable | "`unmeasured` because the server has only just started: standing holds are kept until the boot re-seed decides them." |
| A21 | The scope of I9 | I9 | "While `mayHold` is false, the pushes and states of question rows equal those of a build without the Overlord." |
| A22 | The witness lags | I7 | "A change that narrows authority is reported done only once at least one witness holds its epoch." |
| A23 | The wording of I1 and I2 | n/a | I1: "A held row is settled by the Overlord by its deadline, or reaches the operator by its deadline, or within one sweep of the first boot after it." I2: "exactly one reach stamp and one outbox row, which the sender marks sent once the push service accepts it." |
| A24 | Minor | n/a | A `degraded` generation is "chat only" but the gate refused every door. Retention gave no rule for standing holds once the word is `deaf` for all. |

## Planted mutations

Caught: a deadline extended at boot (I1); a reach stamp with no outbox row (I2, I9); no guard against a second stamp
(I2); a sweep reading a wall clock that went back (I1); an answer with no act row (I3); the stale-generation gate
removed (I5); the staged commit skipping the fence re-check (I5); the staged commit skipping the grant re-check (I4);
`mayHold` ignoring readiness (I9); the answer door ignoring the reach stamp; boot coherence skipped (I7); held rows
dropped from Waiting on you (I10). Not caught, as expected: retention keeping every hold while renewing; the natural
unique key on acts removed (a dialog takes one press).

## What the model does not cover

One or two questions, two to four ticks, at most one server crash where holds stand, one session crash. The breaker
never reaches its half-open trial with two questions. Admission is earliest deadline first only. The ladder is the
operator's rung and two latches. One grant, with no shadow, expiry or blind check. Commands and requests are not
modelled, nor mail delivery, `unwitnessed`, egress, the policy port, the privacy journal or `diverged` rows. Liveness
checks say a path exists on the bounded graph; they are not fairness guarantees. It is one reading of a long text: a
rule misread without noticing would not show up.
