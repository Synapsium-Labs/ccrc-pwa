# PR7b (adoption's evidence, hardened): departures and measurements

Run 1612, delegation broker wave 5. PR7 (#2396, S3: adoption, the digest and the reminder) landed after three review rounds;
its third review, 1609, found one important gap and nine minor ones, every one in the safe direction (a wrong 7-day hold, never
a removal). The coordinator's rulings on that review are the whole scope of this PR. Adoption stays shadow: nothing in the tree
writes `$REG/delegation-adopt`, and arming it is the operator's, by hand, after this PR rolls out.

**Ledger.** Defined in the plan's "Deviations found": D-8092 (adoption's liveness is the row's `presence`; the breaker's memory
keeps `status`, F1), D-8093 (rule 3 asks PR6's equality, F8) and D-8094 (the interfaces PR9 and PR10 consume, after F5, F9 and
F10). Amended in place: D-8053 (the corpus PR7 landed on has 21 versions, F10). The block issued to this run is used whole.

**The plan edit.** The plan file was held by another run of this wave (PR10's claim). It was edited under the coordinator's
ruling of 2026-11-07 on that overlap: this PR touches only its own entries in "## Deviations found" (D-8092 to D-8094, after
D-8065) and D-8053's sentence; PR10 adds its own two entries there; whichever PR lands second merges `main` once, keeps both blocks
whole in ascending order, and runs `deviation-refs` and `dtbd` after the merge.

The floor rule holds: no transition-table row, no loosened `assertLease` rule or decision, no changed fold of an existing kind,
and no journal kind, entry field or checkpoint member. Every new fact is fed to the L1 decider (`delegation-adoption.ts`); the
lane step (`delegationAdoptStep.ts`) and `watch.ts` gather and act.

## The rulings, as built

- **F1, liveness from presence (D-8092).** `adoptionParentFacts` decides `ParentFact.alive` from the row's `presence`: `alive`
  is alive, `dead` is dead, and `unknown` (tmux did not answer, D-309), `asleep` (a hibernated parent) and a row with no
  `presence` are unmeasured, so a kept death holds and counts `waiting` (since fix round 1, a row with an identity field unmeasured
  too: F2 below). `deadSince` is the first-dead instant (the first pass whose `status` read dead) gated on this pass's liveness
  reading dead, not two measured-dead passes; rule 5's settle and passes still bind (fix round 1, F3). The
  lane's first-dead memory still reads `status`, because the breaker reads it fail-shut; that is the "legitimately different"
  reason, recorded in `noteSessions`' comment and in `adoptionParentFacts`'. The lane rows send `presence` now: `sessionOf` derives
  it from the fixture's status, and the F1 rows set it.
- **F2, a retraction kept while unbuilt.** `noteSessions` forgets a retracted death (and the F5 memory) only when the registry's
  listing is read and does not name the id. A row the listing names that the registry could not assemble keeps it. The comment
  at `AdoptionParentReads.retracted` and pr7.md's F5/F7 bullet are corrected; D-8058 never carried the phrase "leaves the
  registry" (measured by search), so it needs no edit.
- **F3, answers held at once.** Inside the audit loop, each answer that comes back on an uncut pass and that `adoptionAudits`
  holds (a definite one) is held at once and its ask dropped from `asked`. One it does not hold keeps its ask once: an ask
  answered non-definite on two passes is dropped (fix round 1, F4 (a); fix round 2, F3), and since PR7c so is one cut inside
  its own await on two passes with no answer between (review 1630 F1, `pr7c.md`). That mark is written before the await, and a
  second cut inside the same await removes the ask (PR7c); nothing else is written after a cut.
- **F4, the cut after every awaited read.** The step reads the cut after the registry listing, after each audit and after each
  carrier read. `asked` is cleared and `pass` counted only below the last awaited read. What a cut writes, at each point:
  - inside the listing: nothing; inside the first audit's own await: that ask's mark, or, at a second such cut with no answer
    between, its drop (PR7c, review 1630 F1; review 1640 F3);
  - inside the audits: only the definite answers that came back before the cut, each held and its ask dropped (F3); a
    non-definite one is not held and keeps its ask, dropped when it is answered non-definite on a second pass (fix round 1,
    F4 (a); fix round 2, F3); the ask in whose own await the cut came is marked, and dropped at a second such cut (PR7c, review 1630 F1);
  - inside the carrier reads: nothing more than that (no `asked`, `pass`, `lastRead`, `watch`, `raised` or `health`);
  - inside the effects loop: the decider's memory was written before the effects (`audits`, `lastRead`, `pass`, `watch`, the
    filtered `raised`, the pruned log memories), because the decisions it holds are the ones whose effects run; an effect that
    landed keeps its own memory (an applied adoption's feed row and its audit word, a logged line, a raised key after its
    notice); no further effect runs; and neither `health` nor any notice is written on that pass, so the next uncut pass queues
    the owed notice from durable state.
- **F5, an outlived death ends.** `noteSessions` records, beside the first-dead memory, the last pass it measured each parent
  alive and the incarnation the census read then (`lastAliveAt`). The decider is fed it (`ParentFact.lastAlive`) and drops a
  kept watch entry whose `terminalAt` is before that instant, at the lease's incarnation or at one the census did not read
  (dropping only delays), for an activity that has not ended. A later death then starts its own settle and passes.
- **F6, tests.** (a) A lane row with an `unreadable` census record. (b) The ten-lease rotation row is rewritten: no lease is past
  rule 4 until one pass (the parent is measured absent then), so the count starts there, its control is that nothing counts
  before it, and every carrier is read within two passes. (c) The decider's `|| parent.deathRetracted` has a mutant of its own,
  PR7b-F6c. (d) An end-to-end row: a parent-death lease with a definite `changed: false` is asked again after the hour.
- **F7, text.** `deathDisproved`'s comment says what it does: a retraction drops the kept death whatever the incarnation, a delay
  only.
- **F8, PR6's equality (D-8093).** Rule 3 asks `carrierReadBackVersus` for `equal`.
- **F9, the audit's words (D-8094).** "left changed" only when the audit answered `changed: true`; "kept because its changes
  could not be checked" when rule 7 counted an answer that was not definite as changed. The feed row's text moved into L1
  (`buildAdoptionFeedRow`), and the step remembers each applied adoption's audit word (`AdoptLaneMemory.adopted`, pruned with
  the lease) for the digest.
- **F10, text and one consolidation.** pr7.md's two "14-version" lines and D-8053's sentence say 21; `shared/api.ts`'s `waiting`
  comment names every wait it counts; pr7.md's line count is 429 (PR7's merged tip); W5-DM12's count is measured below; and
  `delegation-carrier.ts#leastRecentlyRead` is the one comparator `carrierReadsOf` and `adoptionCarrierReads` share.
- **The one-`try` advisory.** The adoption step has its own `try` in `watch.ts`, so its throw never skips PR6's carrier step.

## Rows, red then green

Every behaviour row below was run on PR7's merged tip (`67121c031`, this PR's base) with this PR's tests, and was red there for
the reason named, except the cases marked as controls; every one is green at this PR's tip. The F6 (a), (b) and (d) rows and the
effects-loop F4 row pin behaviour the base already had (they are the coverage review 1609 found missing), so they are green on the
base and red only under their mutants. Two cases inside red rows are controls that pass on the base as they should: the lane F1
row's `dead` case (it adopts there too) and the lane F9 row's `changed: true` case (the base always said "left changed").

| Ruling | Row | On the base |
|---|---|---|
| F1 | `delegation-adoption.test.ts` F1 (presence); A7/F1 (the fact's new shape) | red: no `lastAlive`; `alive` from `status` |
| F1 | `delegation-adoption-lane.test.ts` F1, presence `unknown` and `asleep` | red: adopted |
| F1 | lane F1, presence `dead` | green (control) |
| F2 | lane F2 (a late stop stamp, a pass without the step, unbuilt, then built) | red: the retraction erased |
| F3 | lane F3 (four asks, a cut after two answers) | red: nothing held |
| F4 | lane F4 (a cut inside the carrier read) | red: the memory moved |
| F4 | lane F4 (a cut inside the effects loop) | green (coverage) |
| F5 | L1 F5; lane F5 (alive on a pass without the step, then dead again) | red: adopted on the old death |
| F6 | lane F6 (a); lane F2, F6 (b); lane F6 (d) | green (coverage) |
| F8 | L1 F8 (four foreign bodies; an equal control) | red: adopted |
| F9 | L1 F9; lane F9 (`changed: 'unmeasured'`, no `lease-audit-v1`) | red: "left changed" for all |
| F9 | lane F9 (`changed: true`) | green (control) |
| F10 | L1 F10 (one comparator) | red: no shared function |
| one `try` | lane, a throw out of the step and the carrier step still runs | red: no carrier minted |

Rows re-fixtured by the rulings: the L1 test's `carrier()` and the corpus row's read-backs are equal bodies (F8), so the
fix-round-1 F7 row reads each lease's own carrier; the lane's `sessionOf` sends `presence` (F1); the A7/F1 row's facts carry
`lastAlive` and read `presence`; and review 1604 F2's ten-lease lane row is replaced by the F6 (b) row.

## The mutation table

Each mutant was applied alone to the committed tree, its rows run through `ccrc test` one file at a time, bounded by
`timeout -k 10 900` and `ulimit -u` at the measured thread count plus 1500, then restored from a saved copy with its sha256
checked (every one "sha ok"). Every mutant is killed.

| Mutant | File | The mutation | Red rows |
|---|---|---|---|
| PR7b-F1 | `delegation-adoption.ts` | liveness from `status` again | L1 "A7, F1: adoptionParentFacts", "F1: liveness is the row's presence"; lane "F1: a parent with a kept death whose row then reads presence" `unknown`, `asleep` |
| PR7b-F2 | `watch.ts` | forget a retraction on the assembled rows again | lane "F2: a late stop stamp" |
| PR7b-F3 | `delegationAdoptStep.ts` | hold only after the loop | lane "F3: four asks, a cut after two answers" |
| PR7b-F4-read (review's X-cut132) | `delegationAdoptStep.ts` | no cut check after a carrier read | lane "F4: a pass cut inside its carrier read" |
| PR7b-F4-early | `delegationAdoptStep.ts` | clear `asked` and count `pass` before the carrier reads | lane "F4: a pass cut inside its carrier read" |
| PR7b-F4-effects (review's X-cut169) | `delegationAdoptStep.ts` | no cut check after the effects | lane "F4: a pass cut inside the effects loop" |
| PR7b-F4-break | `delegationAdoptStep.ts` | no cut check inside the effects loop | lane "F4: a pass cut inside the effects loop", "F4: a pass cut while the adopt transition is awaited" (fix round 1's F4) |
| PR7b-F5 | `delegation-adoption.ts` | ignore `lastAlive` | L1 "F5: a parent measured alive after the kept death"; lane "F5: alive on a pass where the step does not run" |
| PR7b-F6a (review's X-treeunread) | `delegationAdoptStep.ts` | `treeUnread: new Set()` | lane "F6 (a)" |
| PR7b-F6b (PR7-FR2-F2) | `delegation-adoption.ts` | no rotation: the first 8 every pass | L1 "F2: ten candidates", "F10: PR6's re-reads and adoption's reads share one comparator"; lane "F2, F6 (b)" |
| PR7b-F6c | `delegation-adoption.ts` | drop `\|\| parent.deathRetracted` | L1 "F7: a kept death that the lane retracts"; lane "F7: a death the lane kept, then retracted", "F2: a late stop stamp" |
| PR7b-F6d (PR7-FR2-F6-unchanged) | `delegation-adoption.ts` | `changed: false` drops the entry | L1 "W5-D10", "F6: a tree whose census record reads unreadable"; lane "F6 (d)" |
| PR7b-F8 | `delegation-adoption.ts` | generation only | L1 "F8 (D-8093)" |
| PR7b-F9 | `delegation-adoption.ts` | every audit word is `changed` | L1 "F9: the feed row and the digest"; lane "F9: an audit that answered changed: unmeasured", "F9: an audit that answered no lease-audit-v1" |
| PR7b-F10 | `delegation-carrier.ts` | the comparator reversed | L1 "F2: ten candidates", "F10: PR6's re-reads and adoption's reads share one comparator"; lane "F2, F6 (b)"; `delegation-carrier` "D-8034 (review 1546 F1)"; `delegation-carrier-lane` "one listing, every carrier behind that is listed" |
| PR7b-try | `watch.ts` | the step's `catch` rethrows (the shared `try`) | lane "the one-try advisory" |

**PR7's mutants re-measured** on this PR's tip, those whose code this PR changed or whose rows it touches. Each is killed:

| Mutant | Red rows at this tip |
|---|---|
| PR7-FR1-F1 | L1 "A7, F1: adoptionParentFacts", "F1: a parent listed but not built"; lane "F1: a parent the listing names but the registry could not assemble", "F6, A2" |
| PR7-FR1-F2-keep | L1 "F2: a death the lane saw is kept", "F5: alive again at its incarnation while waiting at rule 2", "F7: a kept death that the lane retracts"; lane "F2: a dead parent whose dead-since memory has aged out", "F6 (d)" |
| PR7-FR1-F2-counter | L1 "W5-D3", "W5-D4", "F2: a death the lane saw is kept", "F7: adoptionCarrierReads reads no lease without terminal evidence", "F7: a kept death that the lane retracts"; lane "F7: a death the lane kept, then retracted", "F2: a late stop stamp" |
| PR7-FR1-F3-unmeasured | restated as "every answer is definite" (`definite` answers true): L1 "F3, A8: adoptionAudits"; lane "F3: an unmeasured audit answer is never held". Spelled as only the hold line, it survived the lane row, since the feed still asks `definite` |
| PR7-FR1-F7-bound | L1 "F7: adoptionCarrierReads reads no lease without terminal evidence", "F2: ten candidates", "F10: PR6's re-reads and adoption's reads share one comparator"; lane "F2, F6 (b)" |
| PR7-FR2-F1 | L1 "W5-D5", "W5-D6", "F2: a death the lane saw is kept", "F1: one measured absent pass", "F1: liveness is the row's presence"; lane "F1: a parent with a kept death whose row then reads presence" `unknown`, `asleep` |
| PR7-FR2-F4 | lane "F4: a pass cut inside an awaited audit", "F3: four asks, a cut after two answers" |
| PR7-FR2-F5 | L1 "F5: alive again at its incarnation while waiting at rule 2" |
| PR7-FR2-F7 | L1 "A7, F1: adoptionParentFacts"; lane "F7: a death the lane kept, then retracted", "F2: a late stop stamp" |
| REVIEW-X-deadalone | L1 "F2: a death the lane saw is kept", "F5: alive again at its incarnation while waiting at rule 2", "F7: a kept death that the lane retracts"; lane "F2: a restart (a new lane, fresh memory)", "F7: a death the lane kept, then retracted", "F2: a late stop stamp", "F5: alive on a pass where the step does not run" |
| W5-DM10 | lane "W5-Q4: mail-disabled standing …", "F5: an adoption made while mail-disabled stood", "F6, A2" |
| W5-DM12 | the decider reads the clock. 2026-11-07, before the fixture's T0: 24 of 40 rows on PR7's merged tip (W5-D17 among them), 28 of 45 at this tip |

Rows are named by the opening words of their titles, quoted (L1: `delegation-adoption.test.ts`; lane:
`delegation-adoption-lane.test.ts`); fix round 2 (review 1627 F5) replaced the short names this table first carried, from the
same runs' logs.

## Measured, not departures

- **Presence, not `rowStanding`.** The ruling names `presence`, and the decider reads it as the ruling says (`adoptionAlive`).
  Since fix round 1 (review 1622 F2) a row with an identity field unmeasured reads unmeasured, as `rowStanding` reads it doubt, so
  the two now differ at two edges only, both in the safe direction here: a row `alive` with lifecycle `restarting` is alive for
  adoption (it drops a kept death: a delay), and `unknown` with lifecycle `unmeasurable` is unmeasured for adoption where
  `rowStanding` reads `gone` (it holds).
- **A third wording for the digest (F9).** The checkpoint does not record what the adoption's audit showed (the floor rule), so a
  digest derived after a restart says neither "left changed" nor "could not be checked": "A worktree of delegated work by <parent>
  is kept: <path>". The ruling's two wordings stand wherever the lane remembers the audit, which is every notice queued without a
  restart in between.
- **A restarting parent is alive evidence (fix round 1, F1 (a)).** The last-alive memory records a pass by `adoptionAlive`, so a
  row whose `presence` is `alive` while its `status` is `dead` (lifecycle `restarting`) is recorded, and a kept death it postdates
  is dropped: a delay. Fixed in one line as ruled ("record from presence if it is one line"), not left as a departure; its row is
  fix round 2's restarting sequence and its mutant REVIEW-F1a-status.
- **An unread incarnation drops (F5; fix round 1, F1 (b)).** A last-alive pass whose incarnation the census did not read counts as
  the lease's incarnation, so a kept entry it postdates is dropped: a delay only, never a permission.
- **The last census's incarnation (fix round 1, F1 (c)).** On a pass with no newer census, `noteSessions` stamps a last-alive pass
  with the incarnation the last census read, which can be one the parent has since left: the slot then matches only that
  incarnation's leases, so it drops a kept entry more often, never less. Accepted as a delay, as ruled.
- **New evidence settles from the step's first read of it (fix round 1, F1).** The ruling's wording starts the new evidence's
  settle "where that evidence begins"; the decider starts it at the step's first read (`terminalOf`'s `input.now`), which is at or
  after that: a measured absence, a changed incarnation or a later death first seen on a pass that does not run the step starts
  its watch at the next pass that does. A hold placed late, never early.
- **The read gate is wall clock (fix round 2, F1, accepted).** `adoptDecidedAt`, the instants the lane stamps on a retraction and a
  last-alive pass, and the decider's `after` test all compare the pass's wall clock (`pass.now`), as the census gate does
  (`measuredAt > reconciledAt`). A backward step can stamp evidence at or before what it is compared with, so it reads as already
  read. How large a step that takes differs by sequence (review 1630 F4): in sequence (1) the slot is compared with the watch
  entry's `terminalAt`, so the threshold is the gap to `terminalAt`; in sequences (2) to (4) the read gate compares the stamp with
  `adoptDecidedAt`, the last decider pass (at or after `terminalAt`), so a step of about one decider-pass interval is enough.
  In the four F1 sequences: (1) alive at the lease's
  incarnation, then a new one: the slot is kept (no absence prunes it), but one stamped at or before `terminalAt` no longer
  disproves the entry, which adopts on the old count; (2) alive, then measured absent: the absence forgets the slot unread, and the
  entry adopts on the old count; (3) a retraction, then measured absent, and (4) a retraction, then alive at a new incarnation,
  then dead: the absence, the living pass or the death forgets the retraction unread, and one that survives but is stamped at or
  before `terminalAt` fails `after`, so the entry adopts on the old count. A forward jump later corrected leaves `adoptDecidedAt`
  ahead of the clock, with the same effect until the clock passes it. The census gate skips the step for about the size of a
  backward step, which widens the window. Each is an early 7-day hold on stale evidence, never a removal, and adoption stays
  shadow. Keying the read gate and the retraction by the pass ordinal (`pass.seq`) is carried to the Rider.
- **What bounds the evidence memory (fix round 2, F4; corrected by review 1630 F3).** `lastAliveAt` holds a slot for every
  session a pass reads alive, one per incarnation, and `retractedDeaths` one per retraction. A `lastAliveAt` slot is pruned only
  by a measured absence the step has read (`forgetAdoptEvidence`'s `absent`); a living pass or a later death forgets only a
  retraction, once read, and a stopped session that stays listed keeps its retraction. So a session that stays listed keeps one
  slot per incarnation seen alive for the life of the process, decider or not, and the true bound is the session ids times the
  incarnations seen alive or retracted in this process. A restart empties it, which only delays.
- **What the keep-once rule counts (review 1630 F2).** It counts passes, not cuts: an ask answered non-definite on two passes,
  or cut inside its own await on two passes (PR7c, review 1630 F1), is dropped. A kept-once ask that a later cut reaches first
  (a cut in the listing, or in an earlier ask's await) is not answered on that pass, so it survives that cut and is dropped on the
  next pass that answers it non-definite again: a delay, never a permission.
- **The F6 (b) row's controls.** Fix round 1 (review 1622 F5) replaced "nothing counted before the reading pass", which the loop's
  own condition made true, with "no carrier is read before the reading pass" (`lastRead` empty until then), which reds if any lease
  passes rule 4 early; "every carrier read within the two passes" (`lastRead` holds ten) differs under the rotation mutant.

## Fix round 1 (review 1622)

The coordinator's rulings on review 1622 (round 1 of at most 3, at `258f036a0`), taken whole: nothing critical, every finding in
the safe direction, fixed because this PR exists to make adoption's evidence whole before the operator arms it. Departures: D-8092
amended in place (F1, F2, F3), and D-8094 amended in place too (the coordinator's confirmation in run 1612), because F1 changes the
`ParentFact` shapes it records (`lastAlive` a list, `retractedAt` for `deathRetracted`) and F5 the notice builders' arguments; no new
number.

- **F1, evidence kept until the step reads it.** `watch.ts`'s `lastAliveAt` is keyed by the parent and by the incarnation the
  census read on the pass (`Map<parent, Map<incarnation | null, at>>`), recorded by `adoptionAlive` (so a `restarting` parent whose
  `presence` is `alive` is recorded too: item (a) is fixed, in one line, not accepted). `retractedDeaths` keeps the pass each
  retraction was made at. The lane notes `adoptDecidedAt`, the last pass whose adopt step reached the decider (its watch replaced),
  and `forgetAdoptEvidence` forgets a retraction, and on a measured absence a last-alive instant, only at or before that pass. The
  ruling names a measured absence; a retraction is kept the same way past a living pass and a later death, because each of those
  erased it too (a retraction, then alive at a new incarnation, then dead, would otherwise adopt on the old count). The coordinator
  confirmed that as F1's own rule, not a new one: a retraction is kept until the adopt step has run on a pass after it, whatever
  erased it first; its row is the fourth F1 sequence and its mutant FR1-F1-alive (the living pass erases it). The decider asks
  one disproof (`disproved`) before any rule reads a watch entry: the parent alive now at the lease's incarnation, a retraction
  after the entry's `terminalAt`, or a last-alive pass after it at the lease's incarnation or an unread one; the evidence that
  stands then (a measured absence, a changed incarnation, a later death) starts a watch of its own at the step's first read of it,
  which is at or after its own instant. Accepted as delays, as ruled: (b) an unread incarnation counts as the lease's, so a kept
  entry it postdates is dropped; (c) on a pass with no newer census the last census's incarnation is stamped. (a), (b), (c) and the
  settle's start are recorded under "Measured, not departures".
- **F2, an unmeasured identity holds.** `adoptionAlive` reads a row with any unmeasured identity field as unmeasured; the step
  passes `sessions` whole (`unmeasured` among their fields) and decides nothing.
- **F3, text.** The `ParentFact` and `adoptionParentFacts` comments and D-8092 say what `deadSince` is.
- **F4.** (a) In the audit loop an answer drops its ask only when `adoptionAudits` holds it; one that is not definite keeps its ask
  on a cut pass, so the next pass asks it again within the budget, and on an uncut pass it is fed as PR7 ruled. Since fix round 2
  (review 1627 F3) an ask answered non-definite on two passes is dropped (`asked`'s `keptOnce`), as
  the first round did, so a slow audit that answers non-definite can no longer cut every pass ahead of the carrier read. (b) The splice is
  guarded against `-1`, with the reason it cannot miss today. (c) The four PR7 mutants the review re-ran are re-measured here.
- **F5.** The audit's words are matched to the notice in L1: `AdoptLaneMemory.adopted` holds the answer rule 7 was fed
  (`AdoptedAudit`), `owedLeaseNotices` takes it and words the item at a matching generation, and `buildAdoptionFeedRow` takes the
  answer; the step calls neither `adoptAuditWord` nor a generation match. The effects-loop cut row asserts the digest's first line
  carried across the cut pass; the lane F5 row and the three F1 rows assert the quiet pass did not run the step (`pass` unmoved);
  the F6 (b) control is replaced (above). `hibernate-census`'s pass carries a census and `noteSessions` reads
  `pass.census.incarnations` unguarded. The stale text is corrected: `old-dead-reads.test.ts`'s accepted `noteSessions, alive` read,
  `watch.ts`'s comments, `shared/api.ts`'s `waiting` (every unmeasured-liveness case), and `pr7.md`'s two rows naming the replaced
  lane row and its PR7-FR1-F3-unmeasured row.
- **A crash between the journal and the feed row (F5, recorded).** An applied adoption whose process dies after the journal append
  and before the feed row gets neither its record-only row nor its F9 wording: the next pass finds the lease no longer `ephemeral`,
  and the digest mail is re-derived from the checkpoint with the neutral wording. This predates PR7b.
- **Fixtures corrected.** `delegation-adoption.test.ts` W5-D6's "dead for two passes" fact said `alive: true` beside a `deadSince`,
  which `adoptionParentFacts` never builds; with the disproof asked first it read as alive again, so it now says `alive: false`.
  `adoptionAlive` spells its comparison as the first round did (`word === 'dead'`), so the hibernation census's reader table is
  unchanged. `watch.ts` imports `adoptionAlive` through `delegationAdoptStep.ts`, which re-exports it, because the closed scope
  census (`delegation-wave3.integration`, W5-SC1) keeps the wave-5 word in that module's path out of `watch.ts`; and `before` sits on
  its own line, because the same file pins every line of the lane that names the store.

### Rows, red then green (fix round 1)

Run on the round's base (`258f036a0`'s three source files) with this round's tests, red there; green at this tip.

| Ruling | Row (`delegation-adoption-lane.test.ts` unless named) | On the base |
|---|---|---|
| F1 | "review 1622 F1: alive at the lease's incarnation, then alive at a new one" | red: adopted on the old count |
| F1 | "review 1622 F1: alive at the lease's incarnation, then measured absent" | red: adopted on the old count |
| F1 | "review 1622 F1: a retraction, then measured absent" | red: adopted on the old count |
| F1 | "review 1622 F1: a retraction, then alive at a new incarnation on a pass whose step never decides, then dead" | red: adopted on the old count |
| F2 | "review 1622 F2: a row with an unmeasured identity field reads unmeasured" (and the L1 F1 row's identity case) | red: adopted |
| F4 (a) | "review 1622 F4 (a): a cut after answers that are not definite keeps their asks" | red: two asks dropped |
| F5 | L1 "owedLeaseNotices: every adopted lease at its generation" (with `adopted`) | red: the base's function takes three arguments, so the item carries no `audit` |
| F5 | the effects-loop cut row's digest line ("F4: a pass cut inside the effects loop") | green on the base (the step matched the word); red under FR1-F5-adopted |

### The mutation table (fix round 1)

Every mutant below was run alone on this round's committed tree, bounded and restored as above (each "sha ok"); every one is
killed. The first round's sixteen and REVIEW-X-deadalone are respelled where this round changed their line (PR7b-F1 in
`adoptionAlive`, PR7b-F2 forgetting on the assembled rows whether read or not, PR7b-F3 without the in-loop hold, PR7b-F5 and
PR7b-F6c as the `lastAlive` and retraction arms of `disproved`). The five `watch.ts` mutants were run again after the import and
the `before` line moved (marked `@2`); their rows are the same, with the fourth F1 sequence added. Rows are named by their title's
opening words.

| Mutant | The mutation | Red rows |
|---|---|---|
| FR1-F1-slot | one last-alive slot per parent again | lane "alive at the lease's incarnation, then alive at a new one" |
| FR1-F1-read | forget whether or not the step read it | lane "alive …, then measured absent", "a retraction, then measured absent", "a retraction, then alive at a new incarnation …" |
| FR1-F1-alive | a living pass erases the retraction | lane "a retraction, then alive at a new incarnation …" |
| FR1-F2 | `adoptionAlive` ignores `unmeasured` | L1 "F1: liveness is the row's presence"; lane "review 1622 F2" |
| FR1-F4a | every answered ask dropped | lane "review 1622 F4 (a)" |
| FR1-F5-adopted | a cut in the effects loop forgets the adopted audit | lane "F4: a pass cut inside the effects loop" |
| FR1-F5-match | the audit word at any generation | L1 "owedLeaseNotices: every adopted lease at its generation" |
| PR7b-F1 | liveness from `status` | L1 "A7, F1", "F1: liveness is the row's presence"; lane "F1: … presence unknown", "… asleep" |
| PR7b-F2 | forget on the assembled rows, read or not | lane "F2: a late stop stamp …", "review 1622 F1: alive …, then measured absent", "… a retraction, then measured absent" |
| PR7b-F3 | no hold inside the audit loop | lane "F3: four asks, a cut after two answers" |
| PR7b-F4-read (X-cut132) | no cut check after a carrier read | lane "F4: a pass cut inside its carrier read" |
| PR7b-F4-early | `asked` cleared and `pass` counted before the carrier reads | lane "F4: a pass cut inside its carrier read" |
| PR7b-F4-effects (X-cut169) | no cut check after the effects | lane "F4: a pass cut inside the effects loop" |
| PR7b-F4-break | no cut check inside the effects loop | lane "F4: a pass cut while the adopt transition is awaited", "F4: a pass cut inside the effects loop" |
| PR7b-F5 | the `lastAlive` arm of `disproved` dropped | L1 "F5: a parent measured alive after the kept death"; lane "F5: alive on a pass where the step does not run", "review 1622 F1: alive … then alive at a new one", "… then measured absent" |
| PR7b-F6a (X-treeunread) | `treeUnread: new Set()` | lane "F6 (a)" |
| PR7b-F6b | no rotation | L1 "F2: ten candidates", "F10: PR6's re-reads and adoption's reads share one comparator"; lane "F2, F6 (b)" |
| PR7b-F6c | the retraction arm of `disproved` dropped | L1 "F7: a kept death that the lane retracts"; lane "F7: a death the lane kept, then retracted", "F2: a late stop stamp …", "review 1622 F1: a retraction, then measured absent", and (measured in fix round 2) "review 1622 F1: a retraction, then alive at a new incarnation …" |
| PR7b-F6d | `changed: false` drops the entry | L1 "W5-D10", "F6: a tree whose census record reads unreadable"; lane "F6 (d)" |
| PR7b-F8 | generation only | L1 "F8 (D-8093)" |
| PR7b-F9 | every audit word is `changed` | L1 "F9: the feed row and the digest"; lane "F9: … changed: unmeasured", "F9: … no lease-audit-v1" |
| PR7b-F10 | the comparator reversed | L1 "F2: ten candidates", "F10: PR6's re-reads and adoption's reads share one comparator"; lane "F2, F6 (b)"; `delegation-carrier` "D-8034"; `delegation-carrier-lane` "one listing, every carrier behind …" |
| PR7b-try | the step's `catch` rethrows | lane "the one-try advisory" |
| REVIEW-X-deadalone | a present parent not alive is evidence on its own | L1 "F2: a death the lane saw is kept …", "F5: alive again at its incarnation while waiting at rule 2", "F7: a kept death that the lane retracts"; lane "F2: a restart …", "F7: a death the lane kept, then retracted", "F2: a late stop stamp …", "F5: alive on a pass where the step does not run", "review 1622 F1: alive … then alive at a new one", "… then measured absent", "… a retraction, then measured absent", "review 1622 F2" (run before the fourth F1 row existed) |
| PR7-W5-DM9b | owed notices from this pass's decisions | lane "W5-Q3b", "W5-Q4: mail-disabled standing …", "F6, A2", "F4: a pass cut inside the effects loop" |
| PR7-FR1-F3-age | the hour dropped | L1 "F3, A8"; lane "F3: a held audit answer older than an hour", "A8", "F6 (d)" |
| PR7-FR1-F6 | a held notice counted without asking for mail | lane "F6: a digest already sent is not owed while mail-disabled stands" |
| PR7-FR1-F7-past46 | every lease past rules 1 to 3 read | L1 "F7: adoptionCarrierReads reads no lease without terminal evidence"; lane "F2, F6 (b)" |

## Fix round 2 (review 1627)

The coordinator's rulings on review 1627 (round 2, at `b15b99837`), taken whole: nothing critical or important, five minor
findings, every one in the safe direction. Departures: D-8092 amended in place again (F1, F5); no new number, the block is spent.

- **F1, the wall clock (accepted, recorded).** The read gate, the evidence's instants and the retraction's `after` test compare
  wall-clock instants; what a clock step does to each F1 sequence is under "Measured, not departures" and in D-8092. Nothing is
  re-keyed in this round; the pass ordinal is carried to the Rider.
- **F2, a row for fix round 1's F1 (a).** A fourth case of the F1 sequence table: a quiet pass reads the parent with `presence`
  `alive` while its `status` is `dead` (`restarting`), then a pass that runs the step reads it dead; the kept death is dropped
  and the new death starts its own settle (`terminalEvidenceAt` at the step's first read). Mutant REVIEW-F1a-status (record by
  `status !== 'dead'` again) reds it.
- **F3, kept once.** A non-definite answer keeps its ask once (`keptOnce`); the next pass that answers it non-definite again
  drops it, as the first round did (the rule counts answered passes, not cut ones: review 1630 F2, under "Measured, not
  departures"). Row: two consecutive cut passes with the same non-definite answers, then a pass that, since PR7c, asks one ask
  (the fourth, which the cuts never reached; the third, cut inside its own audit twice, is dropped too, review 1630 F1), is still
  armed to cut at a third audit, and reaches the decider. Mutant FR2-F3-everycut (keep through every cut).
- **F4, the memory's bound (text).** The comment above `watch.ts`'s evidence memory and "Measured, not departures" say what
  bounds it.
- **F5, text and labels.** Fix round 1's F1 (a) and (c) and the settle's start sit under "Measured, not departures" beside (b);
  round 0's "as built" bullets say only a definite answer is held at once and drops its ask; every mutation table names its rows
  by quoted title; fix round 1's rows table says the L1 `owedLeaseNotices`-with-`adopted` case is red on the base; PR7b-F6c's row
  lists the fourth F1 sequence and FR2-F5-death covers a later death erasing the retraction; the F1 rows' decisive assertion is
  no longer labelled CONTROL; `old-dead-reads.test.ts`'s death-loop entry names `forgetAdoptEvidence`.

### Rows, red then green (fix round 2)

Run on this round's base (`b15b99837`'s `delegationAdoptStep.ts`) with this round's tests; green at this tip.

| Ruling | Row (`delegation-adoption-lane.test.ts` unless named) | On the base |
|---|---|---|
| F3 | "review 1627 F3: a non-definite answer keeps its ask once" | red: after the second cut all four asks are kept |
| F2 | "review 1622 F1: presence alive while its status is dead (restarting), then dead (review 1627 F2)" | green: the code was already as ruled, and the row is its missing guard; red under REVIEW-F1a-status |
| F5 | L1 "owedLeaseNotices: every adopted lease at its generation", on fix round 1's base (`258f036a0`'s `delegation-adoption.ts`) | red, measured this round: `expected undefined to be 'changed'` |

### The mutation table (fix round 2)

Every mutant below was run alone on this round's committed tree (`36cc5ec9f`), bounded and restored as above (each "sha ok");
every one is killed. The lane suite has 57 tests here and the L1 suite 45. FR1-F4a is respelled on the line F3 changed (every
answered ask dropped). Rows are named by quoted title (lane unless named; "R1F1:" stands for "review 1622 F1:").

| Mutant | The mutation | Red rows |
|---|---|---|
| REVIEW-F1a-status | record a last-alive pass by `status !== 'dead'` again | "R1F1: presence alive while its status is dead (restarting), then dead" |
| FR2-F3-everycut | a non-definite answer keeps its ask through every cut | "review 1627 F3: a non-definite answer keeps its ask once" |
| FR2-F5-death | a later death erases the retraction, read or not | "R1F1: a retraction, then alive at a new incarnation on a pass whose step never decides, then dead" |
| FR1-F1-slot | one last-alive slot per parent again | "R1F1: alive at the lease's incarnation, then alive at a new one" |
| FR1-F1-read | forget whether or not the step read it | "R1F1: alive at the lease's incarnation, then measured absent", "R1F1: a retraction, then measured absent", "R1F1: a retraction, then alive at a new incarnation …" |
| FR1-F1-alive | a living pass erases the retraction | "R1F1: a retraction, then alive at a new incarnation …" |
| FR1-F2 | `adoptionAlive` ignores `unmeasured` | L1 "F1: liveness is the row's presence"; "review 1622 F2: a row with an unmeasured identity field" |
| FR1-F4a | every answered ask dropped | "review 1622 F4 (a): a cut after answers that are not definite", "review 1627 F3: a non-definite answer keeps its ask once" |
| FR1-F5-adopted | a cut in the effects loop forgets the adopted audit | "F4: a pass cut inside the effects loop" |
| FR1-F5-match | the audit word at any generation | L1 "owedLeaseNotices: every adopted lease at its generation" |
| PR7b-F4-read (X-cut132) | no cut check after a carrier read | "F4: a pass cut inside its carrier read" |
| PR7b-F4-effects (X-cut169) | no cut check after the effects | "F4: a pass cut inside the effects loop" |
| PR7b-F6c | the retraction arm of `disproved` dropped | L1 "F7: a kept death that the lane retracts"; "F7: a death the lane kept, then retracted", "F2: a late stop stamp", "R1F1: a retraction, then measured absent", "R1F1: a retraction, then alive at a new incarnation …" |
| REVIEW-X-deadalone | a present parent not alive is evidence on its own | L1 "F2: a death the lane saw is kept", "F5: alive again at its incarnation while waiting at rule 2", "F7: a kept death that the lane retracts"; "F2: a restart (a new lane, fresh memory)", "F7: a death the lane kept, then retracted", "F2: a late stop stamp", "F5: alive on a pass where the step does not run", the five "R1F1:" sequences, "review 1622 F2: a row with an unmeasured identity field" |

## Suites and growth

**Fix round 2.** Run alone at this round's tip through `ccrc test`, each file one run, all green: `delegation-adoption` 45,
`delegation-adoption-lane` 57, `delegation-adoption-corpus` 23, `delegation-carrier` 25, `delegation-carrier-lane` 27,
`delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311, `fleet-health` 54, `lease-routes` 24,
`delegation-lease-acts` 19, `refusal-status` 27, `coord-store` 270, `run-session-census` 18, `mail-hardening` 19, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, `hibernate-census` 13, `delegation-pass-timing` 90,
`typecheck-tests` 12, every `single-definition/*` file (24, `old-dead-reads` 8 among them) and every `rings/*` file (11),
`GROWTH_CHECK=1` growth-check 54, and `deviation-refs` 31 and `dtbd` 1 after `git fetch origin`. Growth against `main`
(`43155a25d`): `watch.ts` 12015 to 12035 lines (+20 net, the cap; this round's one changed line is net 0); `store.ts` +0.

**Fix round 1.** Run alone at this round's tip through `ccrc test`, each file one run, all green: `delegation-adoption` 45,
`delegation-adoption-lane` 55, `delegation-adoption-corpus` 23, `delegation-carrier` 25, `delegation-carrier-lane` 27,
`delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311, `fleet-health` 54, `lease-routes` 24,
`delegation-lease-acts` 19, `refusal-status` 27, `coord-store` 270, `run-session-census` 18, `mail-hardening` 19, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, `hibernate-census` 13, `delegation-pass-timing` 90, every
`single-definition/*` file (24, `old-dead-reads` 8 among them) and every `rings/*` file (11), `typecheck-tests` 12,
`GROWTH_CHECK=1` growth-check 54. `delegation-wave3.integration` was red first (two closed-scope rows, the import path and a pinned
line, above) and green after. Growth against the base (`67121c031`): `watch.ts` +31 / -11 (+20 net, the brief's cap); `store.ts` +0.

**The first round:**

Run alone at this PR's tip through `ccrc test`, each file one run, all green: `delegation-adoption` 45, `delegation-adoption-lane` 49,
`delegation-adoption-corpus` 23 (W5-D12 over 21 versions), `delegation-carrier` 25, `delegation-carrier-lane` 27,
`delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311, `fleet-health` 54, `lease-routes` 24,
`delegation-lease-acts` 19, `refusal-status` 27, `coord-store` 270, `run-session-census` 18, `mail-hardening` 19, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, all 24 `single-definition/*` files, all 11 `rings/*` files,
`typecheck-tests` 12 (red on its first run only because the agent package's modules were not installed in this worktree; green
after `npm ci` there), `GROWTH_CHECK=1` growth-check 54, and `deviation-refs` 31 and `dtbd` 1 after `git fetch origin main`.
The pwa package's own typecheck exits 0. The PR's first full CI run was red in one row, `hibernate-census`'s "a parent seen alive
and then hibernated", which drives `noteSessions` with a pass that carries no census: the F5 memory read `pass.census.incarnations`
there. It now reads an absent census as an unread incarnation; `hibernate-census` 13, `delegation-pass-timing` 90 and the lane
suite 49 are green alone after the fix. Growth
against the base (`67121c031`): `watch.ts` +15 / -7 (+8 net, within the brief's +20); `store.ts` +0.
`delegation-adoption.ts` is 469 lines and `delegationAdoptStep.ts` 237.
