# Seams left by four follow-ups to the Overlord spec

This report lists 29 seams in the edition of `docs/superpowers/specs/2026-11-09-overlord-design.md` that #2539 merged, read against the edition #2513 merged. #2542 closes them. It lists 3 major and 26 minor. By kind: 16 rules stated two ways, 9 table rows, lists or captions left behind, 2 words or word lists used against their definition and 2 figures that disagree with the text. None is a wrong cross-reference, a broken sentence, a table row of the wrong shape, a prose line over 120 characters or a pair of edits that pull one rule two ways: those checks came back clean, apart from one bold lead that no longer fits its bullet (in F3). Every finding traces to a line that the diff between those two editions added or changed. In most, the diff changed a rule in its own section and a restatement elsewhere kept the old wording. In F2 and F5 the diff wrote the rule in full in one place and short in another. In F3, F16, F22 and F23 a sentence the diff added disagrees with a rule it did not touch, and there the fix is to the new sentence. The findings are in order of harm. A major finding would change what gets built if a builder read the stale passage alone. OLD and NEW are verbatim, with no fence around them. For a table row they give only the part of the row that changes, and that part occurs exactly once in the document. A script checked that every QUOTE and every OLD occurs exactly once, that each QUOTE lies inside its OLD, that no two findings edit the same lines, and that the document with every finding applied has no new long line and no table row of a new shape.

## seams:F1 [major]
QUOTE: Unarmed, the check is skipped:

PROBLEM: §7.2 says the `grant.inside` check is skipped whenever it is unarmed. §3.7 ("A gate sent back to shadow stays shut") and Table 3.7b now say a gate is skipped only when the operator has not armed it, and that a gate the server sent back to shadow answers as no clear yes. The diff wrote §3.7 and the table. Built from §7.2, a drifted gate would fail open.

OLD:
  Anything short of a clear yes answers `defer`, and the matter goes to the operator. Unarmed, the check is skipped:
  the code checks and the veto window stand, and the act row records that it did not run. The commit of a staged act
  reads that record and asks nothing again: if the check is armed at the commit and the row holds no clear yes, the
  act is `voided`. Why blind: a monitor that cannot read the agent's reasoning cannot be talked round by it, and
  Anthropic built its own action classifier that way (2026-03-25).

NEW:
  Anything short of a clear yes answers `defer`, and the matter goes to the operator. Where the operator has not
  armed it, the check is skipped: the code checks and the veto window stand, and the act row records that it did
  not run. A check the server sent back to shadow is not skipped: it answers `defer` (§3.7). The commit of a
  staged act reads that record and asks nothing again: if the check is armed at the commit and the row holds no
  clear yes, the act is `voided`. Why blind: a monitor that cannot read the agent's reasoning cannot be talked
  round by it, and Anthropic built its own action classifier that way (2026-03-25).

## seams:F2 [major]
QUOTE: rests on an operator message, and has the item's subject (§6.7)

PROBLEM: §7.1 lists what makes an entry the cover of `state-a-fact`: `active`, `stated`, resting on an operator message, with the item's subject. Table 6.7b and §9.2 ("So an entry covers `state-a-fact` only once") now add that the operator confirmed it or its quote is a whole message. The diff wrote all three, and the table and §9.2 carry the fuller rule. §7.1 is where `overlordMayAct` is defined, so the missing condition widens the cover.

OLD:
  that is `active` and `stated`, rests on an operator message, and has the item's subject (§6.7). It answers with the
  quoted span as the server renders it, never with the entry's statement (§9.2). The act row then records the
  authority `entry:<id>` (§10.1).

NEW:
  that is `active` and `stated`, rests on an operator message, was confirmed by the operator or quotes a whole
  message, and has the item's subject (§6.7). It answers with the quoted span as the server renders it, never with
  the entry's statement (§9.2). The act row then records the authority `entry:<id>` (§10.1).

## seams:F3 [major]
QUOTE: Two more refusals at the answer doors.

PROBLEM: The new bullet says every Overlord door answers `renewing` after a boot. §3.3.3 says the card, probe and note doors skip `renewing` "so a generation can always finish starting", an earlier bullet of §11.2 says the same, and Table 11.6 gives `renewing` to every door but those three. The bullet's lead also says "at the answer doors", and its second refusal is at every door. The diff wrote the bullet. The older three passages state the standing rule.

OLD:
- **Two more refusals at the answer doors.** An answer to a hold whose deadline has passed is refused
  `operator-has-it`. After a boot, every Overlord door answers `renewing` until the boot pass has re-seeded the holds
  (§11.5).

NEW:
- **Two more refusals.** At the answer doors, an answer to a hold whose deadline has passed is refused
  `operator-has-it`. After a boot, every Overlord door but card, probe and note answers `renewing` until the boot
  pass has re-seeded the holds (§11.5).

## seams:F4 [minor]
QUOTE: or the designation is `pending` while generation 1 starts. At the W1a prompt route

PROBLEM: §11.2 ("Two more refusals") now answers `renewing` after a boot, until the boot pass has re-seeded the holds. The refusal-word list is generated from Table 11.6, and its `renewing` row gives two meanings only. The diff wrote §11.2.

OLD:
The generation is between `draining` and `probing`, or the designation is `pending` while generation 1 starts.

NEW:
The generation is between `draining` and `probing`, the designation is `pending` while generation 1 starts, or the boot pass has not yet re-seeded the holds.

## seams:F5 [minor]
QUOTE: rest on an operator message, and have the item's subject.

PROBLEM: §9.3 (C30) lists the same conditions as §7.1 and leaves out the same one. Table 6.7b and §9.2 require that the operator confirmed the entry or that its quote is a whole message. The diff wrote this sentence, the table row and §9.2. The table and §9.2 carry the fuller rule.

OLD:
    `active` and `stated`, rest on an operator message, and have the item's subject. A retired or superseded entry
    covers nothing. Neither does one the operator edited: its quote is of the words the Edit replaced. It is the
    cover for `state-a-fact` and for nothing else, and no grant covers that act. The act answers with the entry's
    quoted span as the server renders it, never with its statement (§9.2). The act row records `entry:<id>` as its
    authority (§10.1).

NEW:
    `active` and `stated`, rest on an operator message, be confirmed by the operator or quote a whole message, and
    have the item's subject (§9.2). A retired or superseded entry covers nothing. Neither does one the operator
    edited: its quote is of the words the Edit replaced. It is the cover for `state-a-fact` and for nothing else,
    and no grant covers that act. The act answers with the entry's quoted span as the server renders it, never with
    its statement (§9.2). The act row records `entry:<id>` as its authority (§10.1).

## seams:F6 [minor]
QUOTE: BC -- "yes, or unarmed"

PROBLEM: Figure 6's edge out of the blind check reads "yes, or unarmed". §3.7 and Table 3.7b now skip the gate only when the operator has not armed it. A gate the server sent back to shadow answers as no clear yes, which is the figure's "no" edge. The diff wrote §3.7 and the table.

OLD:
  BC -- "yes, or unarmed" --> O3{"An O3 effect<br/>under attribution?"}

NEW:
  BC -- "yes, or the operator<br/>has not armed it" --> O3{"An O3 effect<br/>under attribution?"}

## seams:F7 [minor]
QUOTE: Unarmed, the row is

PROBLEM: §5.3 says the `scope.widens` row is skipped when unarmed. §3.7 and Table 3.7b now say it is skipped only when the operator has not armed it, and that a gate sent back to shadow stays shut. The diff wrote §3.7 and the table.

OLD:
    the code rule. Anything short of a clear yes sends the widening to the operator (§3.7). Unarmed, the row is
    skipped and the code rule stands alone.

NEW:
    the code rule. Anything short of a clear yes sends the widening to the operator (§3.7). Where the operator has
    not armed it, the row is skipped and the code rule stands alone. A row the server sent back to shadow stays
    shut.

## seams:F8 [minor]
QUOTE: skipped when unarmed.

PROBLEM: Table 3.7a's row for widening says the flag is "skipped when unarmed". The diff changed the same words in Table 3.7b and in §3.7 to "skipped when the operator has not armed it", because a gate sent back to shadow stays shut.

OLD:
`scope.widens` is a flag beside it, skipped when unarmed.

NEW:
`scope.widens` is a flag beside it, skipped when the operator has not armed it.

## seams:F9 [minor]
QUOTE: I1: a held row reaches the operator by its deadline

PROBLEM: §6.7 restates I1 as "a held row reaches the operator by its deadline" and I9 as "pushes and row states". Table 11.7a now says a held row is settled by the Overlord or reaches the operator, and that I9 compares the pushes and states of question rows. The diff wrote the table. Under the old I1 every hold the Overlord answers is a violation.

OLD:
- **The invariants this section serves** (§11.7). I1: a held row reaches the operator by its deadline, or within one
  sweep of the first boot after it. I10: every open row is on the operator's list at all times. I9: while `mayHold` is
  false, pushes and row states equal those of a build without the Overlord.

NEW:
- **The invariants this section serves** (§11.7). I1: a held row is settled by the Overlord by its deadline, or
  reaches the operator by its deadline, or within one sweep of the first boot after it. I10: every open row is on
  the operator's list at all times. I9: while `mayHold` is false, the pushes and states of question rows equal
  those of a build without the Overlord.

## seams:F10 [minor]
QUOTE: only the follow-up arm re-sets it, after a nudge or a gap

PROBLEM: §11.5 says only the follow-up arm re-sets `followUpAt`. §5.4 (C15) now sets it when the request is opened, again at each relay, counter and decline, and at the read-back, so that I12 holds. The diff wrote §5.4 and I12.

OLD:
  process. `followUpAt` is not a deadline: only the follow-up arm re-sets it, after a nudge or a gap.

NEW:
  process. `followUpAt` is not a deadline: the server sets it again at the moves §5.4 names, at a nudge and
  after a gap.

## seams:F11 [minor]
QUOTE: a blind check armed since the staging with no clear yes on the row, or eight hours

PROBLEM: §7.2 ("The commit re-checks") and Table 11.6 now void a staged act at its commit when it cites an entry that is no longer `active`. Table 10.1b lists the causes of `voided` and does not name that one. The diff wrote both, and the gate at the commit came with the last of the four edits.

OLD:
`voided` (a change of authority, the mint of a later generation, a blind check armed since the staging

NEW:
`voided` (a change of authority, the mint of a later generation, a cited entry that is no longer `active`, a blind check armed since the staging

## seams:F12 [minor]
QUOTE: A retirement, an edit or a wipe of an

PROBLEM: §9.2 says a retirement, an edit or a wipe of a served entry makes a renewal due. C40 (§3.3.5) and Table 3.3.11b now say retired, edited, superseded or wiped. The diff wrote those two.

OLD:
  the store its own output and bring back what the operator retired or wiped. A retirement, an edit or a wipe of an
  entry a generation was served makes a renewal due at once (Table 3.3.11b), so no generation keeps the text in
  context. The wipe sheet names what stays on the fleet host: the Overlord's transcripts and its history family,
  which only the operator's own history verbs remove.

NEW:
  the store its own output and bring back what the operator retired or wiped. A retirement, an edit, a supersede or
  a wipe of an entry a generation was served makes a renewal due at once (Table 3.3.11b), so no generation keeps the
  text in context. The wipe sheet names what stays on the fleet host: the Overlord's transcripts and its history
  family, which only the operator's own history verbs remove.

## seams:F13 [minor]
QUOTE: restore generation, and rewind after a restore.

PROBLEM: §9.4 rule 13 says the feeds' cursors rewind after a restore. §7.6 now says they rewind to the snapshot's positions or to a later wipe's, so nothing from before a wipe is read again. The diff wrote §7.6.

OLD:
    `coord.db`, and list it in the snapshot's manifest. A live file is never copied. The feeds' cursors carry the
    restore generation, and rewind after a restore.

NEW:
    `coord.db`, and list it in the snapshot's manifest. A live file is never copied. The feeds' cursors carry the
    restore generation, and rewind after a restore to the snapshot's positions, or to a later wipe's (§7.6).

## seams:F14 [minor]
QUOTE: moved only when the main thread's next read names the last id it applied (`after=`) |

PROBLEM: Table 9.1a says a cursor is moved only when the main thread's next read names the last id it applied. §7.6 now says a wipe moves every feed's cursor to the end of its feed, and a restore rewinds it. The diff wrote §7.6.

OLD:
moved only when the main thread's next read names the last id it applied (`after=`) |

NEW:
moved only when the main thread's next read names the last id it applied (`after=`); a wipe, which moves each to the end of its feed; a restore, which rewinds each (§7.6) |

## seams:F15 [minor]
QUOTE: for every retirement (About you, `retire-entry`, the retention pass)

PROBLEM: Table 11.1a says the entries' apply function writes the privacy journal for every retirement. §7.6 and §9.4 rule 12 now journal an Edit and a supersede too, and §7.6 says the journal keeps the highest entry id. The diff wrote §7.6 and rule 12.

OLD:
for every retirement (About you, `retire-entry`, the retention pass), and the learning controls

NEW:
for every retirement, Edit and supersede (About you, `retire-entry`, `supersede`, the retention pass) and for the highest entry id issued, and the learning controls

## seams:F16 [minor]
QUOTE: while no row cites it and no `acknowledge` settled

PROBLEM: §3.8 names three things that settle a message: a citing door, `acknowledge`, and the prompt route's settlement mark. The new boot-pass sentence in the same section unsettles a `settled` message that no row cites and no `acknowledge` settled, which takes in one the prompt route marked. The diff wrote the boot-pass sentence. The list of what settles a message is the standing rule.

OLD:
    citing rows, both ways (I8): a message that reads `settled` while no row cites it and no `acknowledge` settled
    it is unsettled again, so it heads the next card. The pass adds `spent` where a root request cites the message,
    and never takes it away.

NEW:
    citing rows, both ways (I8): a message that reads `settled` while no row cites it, no `acknowledge` settled it
    and the prompt route did not mark it is unsettled again, so it heads the next card. The pass adds `spent` where
    a root request cites the message, and never takes it away.

## seams:F17 [minor]
QUOTE: at least one push attempt, at most one notification shown

PROBLEM: §6.7 promises "at least one push attempt" for every row. The bullet above it now gives a row whose level pushes nothing today a silent outbox row, and I2 now lists a silent row, beside the row the open console settled, as a row with no push. The diff wrote the silent row and that part of I2.

OLD:
  - The promise: exactly one reach, at least one push attempt, at most one notification shown (invariant I2).

NEW:
  - The promise: exactly one reach and one outbox row, at least one push attempt unless the row is silent or the
    open console settled it, and at most one notification shown (invariant I2).

## seams:F18 [minor]
QUOTE: A tap from a push and a bulk Seen are `glanced`, not examined.

PROBLEM: §9.6 says a tap from a push is `glanced`, not examined. §6.6 now says the first match wins, so a tap from a push that picks another option than the recommended one is `examined`. The diff wrote §6.6.

OLD:
- **What never counts as agreement.** A default that took effect, a veto window that expired unseen, and a "You
  decide" (§3.8). A tap from a push and a bulk Seen are `glanced`, not examined.

NEW:
- **What never counts as agreement.** A default that took effect, a veto window that expired unseen, and a "You
  decide" (§3.8). A bulk Seen is `glanced`, not examined. So is a tap from a push, unless it picks another option
  than the recommended one (§6.6).

## seams:F19 [minor]
QUOTE: A breach of its guard retires it.

PROBLEM: §9.7 ("Testing before trust") says a breach of its guard retires an entry. Table 9.7b now says an `operator` entry is retired only by the operator, and that a guard breach on one raises an item. The diff wrote the table row.

OLD:
  - Outcomes come only from rows the server measured. A breach of its guard retires it.

NEW:
  - Outcomes come only from rows the server measured. A breach of its guard retires it. On an `operator` entry a
    breach raises an item instead.

## seams:F20 [minor]
QUOTE: At 90 days it graduates into a server guard

PROBLEM: §9.7 says an entry lasts 45 days from live and "at 90 days" graduates or retires, which reads as 90 days from live. Table 9.7b now counts the 90 days from the entry's first serving, which is in its canary. The diff wrote the table row.

OLD:
- **Every entry but an `operator` one expires.** It lasts 45 days from live, and renews only on a non-negative
  measured effect. At 90 days it graduates into a server guard or a skill change, through a coordinator's pull
  request, or it retires. An `operator` entry lasts until it is retired.

NEW:
- **Every entry but an `operator` one expires.** It lasts 45 days from live, and renews only on a non-negative
  measured effect. At 90 days from its first serving it graduates into a server guard or a skill change, through a
  coordinator's pull request, or it retires. An `operator` entry lasts until it is retired.

## seams:F21 [minor]
QUOTE: also releases holds into one.

PROBLEM: §4.1 says Pause releases holds into a handover brief. §7.5 now says Pause releases every hold as `off` does, each row reaching the operator in one grouped push, and that the brief lists them. The diff wrote §7.5.

OLD:
  whenever readiness leaves `ready` for more than ten minutes, and when the operator returns after three days. Pause
  also releases holds into one.

NEW:
  whenever readiness leaves `ready` for more than ten minutes, and when the operator returns after three days. A
  Pause's brief lists the rows it released to the operator (§7.5).

## seams:F22 [minor]
QUOTE: Only when no account can

PROBLEM: The new text of C56 says readiness reads `stranded` only when no account can serve the Overlord. Table 6.4a and H16 ("Falling back never stalls it") also read `stranded` when a swap is blocked or the last turn failed on its account. The diff wrote the C56 sentence, which speaks of the pick only. The table is the standing rule.

OLD:
    soft line, the least loaded one that can serve it at all, the designated class first. Only when no account can
    serve it does readiness read `stranded`. Listed order and the soft line are new in ccd's pick, which today ranks
    by load alone. Table 3.4a gives the order. The server leaves out an account where a start loaded something the
    profile does not list, until the operator clears the item (§3.6).

NEW:
    soft line, the least loaded one that can serve it at all, the designated class first. The pick leaves readiness
    at `stranded` only when no account can serve it. Listed order and the soft line are new in ccd's pick, which
    today ranks by load alone. Table 3.4a gives the order. The server leaves out an account where a start loaded
    something the profile does not list, until the operator clears the item (§3.6).

## seams:F23 [minor]
QUOTE: the command is spent and the act did not happen

PROBLEM: The new sentence in §3.8 says a commanded act that settles `refused` or `unknown` "did not happen". Table 10.1b defines `unknown` as an effect the settle could not measure, which may have happened. The diff wrote the sentence. The table's definition is the standing one.

OLD:
  - **Live commands are band 1 of the inbox (§6.8).** A command that expires unused is told to the operator. So is
    a commanded act that settles `refused` or `unknown`: the command is spent and the act did not happen.

NEW:
  - **Live commands are band 1 of the inbox (§6.8).** A command that expires unused is told to the operator. So is
    a commanded act that settles `refused` or `unknown`: the command is spent, and the act did not happen or
    could not be measured.

## seams:F24 [minor]
QUOTE: active with a hold-off, or degraded

PROBLEM: Figure 2's new labels say a timeout in `draining` and a failure before the old conversation ended go "back to the state it left", `active` or `degraded`. Both edges still end at node A, which is `active`. Table 3.3.11a and the receipt rule say a renewal that began in `degraded` goes back to `degraded`, which is node X. The diff wrote the labels, the table and the receipt rule.

OLD:
  C -- "timeout: back to the state it left,<br/>active with a hold-off, or degraded" --> A
  C --> D["checkpointed, 60 s<br/>the server assembles the checkpoint<br/>and asks for the handover note<br/>skipped on a hard trigger"]
  D --> E["clearing, 90 s<br/>the host ends the conversation<br/>and starts a fresh one, same session id"]
  E -- "failed before the old one ended:<br/>back to the state it left" --> A

NEW:
  C -- "timeout, from active:<br/>back, with a hold-off" --> A
  C -- "timeout, from degraded:<br/>back to degraded" --> X
  C --> D["checkpointed, 60 s<br/>the server assembles the checkpoint<br/>and asks for the handover note<br/>skipped on a hard trigger"]
  D --> E["clearing, 90 s<br/>the host ends the conversation<br/>and starts a fresh one, same session id"]
  E -- "failed before the old one ended,<br/>from active: back, with a hold-off" --> A
  E -- "failed before the old one ended,<br/>from degraded: back to degraded" --> X

## seams:F25 [minor]
QUOTE: listed order before load

PROBLEM: Table 3.7a says ccd picks in listed order before load. C56 now gives three steps, the last of which takes the least loaded account, and the diff took "before load" out of C56 and out of Table 3.4a's caption.

OLD:
The serviceability answer and the ordered account list, listed order before load (H16)

NEW:
The serviceability answer and the ordered account list, picked in the three steps C56 gives (H16)

## seams:F26 [minor]
QUOTE: They are columns of the role table and constants of the card renderer.

PROBLEM: §11.5 says the trigger thresholds are columns of the role table. The C49 row of §13 now says the renewal triggers are an L1 record keyed by role, and lists the table's columns without them, as §3.3.9 does. The diff wrote the C49 row.

OLD:
values too. They are columns of the role table and constants of the card renderer.

NEW:
values too. They are values of the renewal triggers' record, keyed by role, and constants of the card renderer.

## seams:F27 [minor]
QUOTE: Figures are percentages of the weekly window.*

PROBLEM: The diff added a load to each cell of the Overlord's column. A load is the share of the reserve that is no longer room (C57), so "Its load is 25%" is not a percentage of the weekly window. The caption still says every figure is one.

OLD:
*Table 3.4c. The reservation rule on one account, with a reserve of 40. Figures are percentages of the weekly window.*

NEW:
*Table 3.4c. The reservation rule on one account, with a reserve of 40. Figures are percentages of the weekly window,
except a load, which is the share C57 defines.*

## seams:F28 [minor]
QUOTE: | the read ledger | one line per read: door, scope, count, generation |

PROBLEM: C40 (§3.3.5) now says the read ledger's line gains the ids of the entries served, so the server knows which generation held which entry. Table 9.1a lists the line's fields without them. The diff wrote C40.

OLD:
| the read ledger | one line per read: door, scope, count, generation |

NEW:
| the read ledger | one line per read: door, scope, count, generation, and the ids of any entries served |

## seams:F29 [minor]
QUOTE: a consumed command for

PROBLEM: A3 restates I4 as it was: "a consumed command for its proposal". I4 now says a command that was live when the act row was written, and §7.1 says a live command for the proposal. A command already consumed authorises nothing. The diff wrote I4.

OLD:
- **A3. Never take an operator-only act without its authority.** That is a live grant in scope, a consumed command for
  its proposal, a request bound to an operator message, or, for `state-a-fact`, a cited stated entry resting on an

NEW:
- **A3. Never take an operator-only act without its authority.** That is a live grant in scope, a live command for
  its proposal, a request bound to an operator message, or, for `state-a-fact`, a cited stated entry resting on an

## Seen and not reported

These are not findings. Each is outside the diff, or could not be settled from the text alone.

- Table 11.6's `overlord-sandbox-unmet` row is broken over three lines, so the table loses its shape there. The break is in the first merged edition too, and the diff did not touch it.
- §11.7 opens with "Six machines interact here" and names six. The diff's new sentence in the same section speaks of "the privacy and message machines", which are not among the six. The count may still be meant as it stands.
- §3.3.11 (the fence) now says "ccd removes the key file at every start", and draws from it that a door process holds no key. Table 3.6a says the act key file exists in W0's fallback only, where there is no door process, and gives the file one writer, `ccrc-api`. The sentence may need "in W0's fallback".
- Table 11.5b now speaks of "one sweep of the readiness lane" on a `LANE_SCHEDULE` cadence. Table 11.1c's row for the readiness lane gives its timer as "On each input change; the breaker's waits" and names no sweep.
- §7.5 says a programme's holds "pause" while the operator speaks to it. Table 6.7c now says those holds are released, with the cause `engagement`. "Pause" can be read as either.
- §3.4 and Tables 3.6a, 11.1a and 11.1c say a reservation serves the replay body "while the replay lane runs one". The new bullet in C46 serves its id "from the moment the lane asks for a run". The older wording can be read to include that moment.
- Figure 3's edge labels name some causes of a move to `needs-you` and not the new ones: a follow-up that comes due at `chat`, at `off` or for a `hands-off` programme, a wipe, and a confirmed restore. Every such move has its edge, so nothing in the figure is wrong.
- The diff's new bullet in §3.2 cites "(§3.2)" from inside §3.2. Table 11.1a carries the same sentence, where the reference is right.
- Several paragraphs the diff edited now have a short line in mid-paragraph (for example in C49, C51, C24, §6.8's load lines, §7.2, §7.5's Pause, §7.6 and §10.5). They render correctly.
- Claims about the tree that the diff added were not checked against the tree: `LANE_SCHEDULE`, the drift reconciler's cadence, D-8142, the `## The contract` heading, and the 14-day commit counts in ruling 16.

## Checked and found consistent

- Counts in words: thirteen invariants (I1 to I13, in "In short", §10.4 and §11.7), sixteen rulings and the eight listed in §2, six more inputs, three steps of the pick, three journals, seven ports, ten request states, the three observed timers of the renewal lane, eight coordinator triggers in C50.
- Numbers: the hold-down of one hour and the 30-minute least age (§3.4, §11.5, Tables 3.4b and 11.5b, C45, §16); the eight hours of a staged answer; the two-hour repeat; one hour and seven days for the follow-up clock; 24 hours for a message; the `lambda` arithmetic in §11.5 and ruling 15; the loads in Table 3.4c against C57's rule (25, 30, 100 and 30 per cent, and 28 and 34 points).
- Closed lists: the `overlordOutcome` values and release causes in §6.1, Table 6.7c, Table 11.5 and Table 11.6; the readiness words with `unproved` in Tables 6.4a and 6.7c; the proposal states; the act states in Table 10.1b and its caption; `raise-item` in Table 7.1a and Table 11.1e; `entry-retired`, `entry-unsourced`, `practice-contradicts`, `operator-has-it` and `authority-rolled-back` in Table 11.6 against their sections.
- Request moves: Table 5.1b against Figure 3 edge by edge (withdraw from every state that is not terminal, the parent's close and resume, the Overlord's drop from `needs-you`), §5.5's parent rule, I12 against C15.
- The generation machine: Table 3.3.11a, the receipt rule, Table 3.3.11b's rows against C50, C57, §9.5 and Table 3.4b; the readiness words `dead`, `restarting` and `renewing` against C57 and §3.3.8.
- Accounts: C56's three steps against Table 3.4a, its caption and the C56 row of §13; the pre-emptive move in C57, Table 3.3.11b, Table 3.4b and the C57 row; the load lines of §6.8 against Table 6.7c and Table 7.5a.
- Grants and staging: `max-per-day` in §7.2, §10.3 and §11.5; the commit re-check, the voided act and `pushDue`; the Veto after the commit in §10.3, Table 10.1b and Table 11.1a; revocation with no step-up against Table 11.2 and §11.2.
- Restore: Table 7.6a and its caption, the witness in §7.6, Table 11.1a, Table 11.6, I13 and §16; Confirm the restore in §3.1, §7.6, Table 11.1a and Table 11.1e; the reconciliation pass in §7.6, Table 10.1a and §16.
- The role table: C49 against Table 3.3.9a, Table 11.1b and the C49 and C51 rows; `MAIL_PACE` in §6.4, Table 11.1b and W1a's row.
- The attention budget: §4.2 against Table 4.2a, I2, M25 and the Settings row of Table 11.1d.
- The skill-size ratchet: §11.3 against §3.3.3, §9.7, §11.4, Table 11.7b, M31, W1a's row, §2 and ruling 16.
- Waves: every wave the diff states against §14, Table 13.1 and the wave columns of §11.1.
- References the diff added: every §, Table, Figure, C, H, I and M number points at a passage that says what the citing sentence claims.
- Shape: every table row has its header's cell count except the one named above; no prose line is over 120 characters; no doubled word; every paragraph the diff touched ends with its punctuation.
- Figures: every node an edge names in Figures 2, 3 and 6 is defined, and Figure 6's new identity node and its three edges match §7.1's list of answers.
