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
- **F3, answers held at once.** Inside the audit loop, each answer that comes back on an uncut pass is held through
  `adoptionAudits` at once and its ask dropped from `asked`. After a cut nothing more is written.
- **F4, the cut after every awaited read.** The step reads the cut after the registry listing, after each audit and after each
  carrier read. `asked` is cleared and `pass` counted only below the last awaited read. What a cut writes, at each point:
  - inside the listing, or before the first audit answers: nothing;
  - inside the audits: only the answers that came back before the cut, each held and its ask dropped (F3);
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
| PR7b-F1 | `delegation-adoption.ts` | liveness from `status` again | L1 A7/F1, F1 (presence); lane F1 `unknown`, `asleep` |
| PR7b-F2 | `watch.ts` | forget a retraction on the assembled rows again | lane F2 |
| PR7b-F3 | `delegationAdoptStep.ts` | hold only after the loop | lane F3 |
| PR7b-F4-read (review's X-cut132) | `delegationAdoptStep.ts` | no cut check after a carrier read | lane F4 (carrier read) |
| PR7b-F4-early | `delegationAdoptStep.ts` | clear `asked` and count `pass` before the carrier reads | lane F4 (carrier read) |
| PR7b-F4-effects (review's X-cut169) | `delegationAdoptStep.ts` | no cut check after the effects | lane F4 (effects loop) |
| PR7b-F4-break | `delegationAdoptStep.ts` | no cut check inside the effects loop | lane F4 (effects loop); fix round 1's F4 |
| PR7b-F5 | `delegation-adoption.ts` | ignore `lastAlive` | L1 F5; lane F5 |
| PR7b-F6a (review's X-treeunread) | `delegationAdoptStep.ts` | `treeUnread: new Set()` | lane F6 (a) |
| PR7b-F6b (PR7-FR2-F2) | `delegation-adoption.ts` | no rotation: the first 8 every pass | L1 F2 (ten), F10; lane F2, F6 (b) |
| PR7b-F6c | `delegation-adoption.ts` | drop `\|\| parent.deathRetracted` | L1 F7; lane F7, F2 (unbuilt) |
| PR7b-F6d (PR7-FR2-F6-unchanged) | `delegation-adoption.ts` | `changed: false` drops the entry | L1 W5-D10, F6; lane F6 (d) |
| PR7b-F8 | `delegation-adoption.ts` | generation only | L1 F8 |
| PR7b-F9 | `delegation-adoption.ts` | every audit word is `changed` | L1 F9; lane F9 (`unmeasured`, no `lease-audit-v1`) |
| PR7b-F10 | `delegation-carrier.ts` | the comparator reversed | L1 F2 (ten), F10; lane F2, F6 (b); `delegation-carrier` D-8034; `delegation-carrier-lane` the read-count row |
| PR7b-try | `watch.ts` | the step's `catch` rethrows (the shared `try`) | lane, the one-`try` row |

**PR7's mutants re-measured** on this PR's tip, those whose code this PR changed or whose rows it touches. Each is killed:

| Mutant | Red rows at this tip |
|---|---|
| PR7-FR1-F1 | L1 A7/F1, F1 (listed not built); lane F1, F6 and A2 |
| PR7-FR1-F2-keep | L1 F2, F5, F7; lane F2 (aged out), F6 (d) |
| PR7-FR1-F2-counter | L1 W5-D3, W5-D4, F2, F7 (reads), F7; lane F7, F2 (unbuilt) |
| PR7-FR1-F3-unmeasured | restated as "every answer is definite" (`definite` answers true): L1 F3 and A8; lane F3 (unmeasured). Spelled as only the hold line, it survived the lane row, since the feed still asks `definite` |
| PR7-FR1-F7-bound | L1 F7 (reads), F2 (ten), F10; lane F2, F6 (b) |
| PR7-FR2-F1 | L1 W5-D5, W5-D6, F2, F1 (one measured pass), F1 (presence); lane F1 `unknown`, `asleep` |
| PR7-FR2-F4 | lane F4 (a cut inside an audit), F3 |
| PR7-FR2-F5 | L1 F5 |
| PR7-FR2-F7 | L1 A7/F1; lane F7, F2 (unbuilt) |
| REVIEW-X-deadalone | L1 F2, F5, F7; lane F2 (restart), F7, F2 (unbuilt), F5 |
| W5-DM10 | lane W5-Q4, F5, F6 and A2 |
| W5-DM12 | the decider reads the clock. 2026-11-07, before the fixture's T0: 24 of 40 rows on PR7's merged tip (W5-D17 among them), 28 of 45 at this tip |

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
- **An unread incarnation drops (F5).** A last-alive pass whose incarnation the census did not read counts as the lease's
  incarnation, so a kept entry it postdates is dropped: a delay only, never a permission.
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
  entry it postdates is dropped; (c) on a pass with no newer census the last census's incarnation is stamped.
- **F2, an unmeasured identity holds.** `adoptionAlive` reads a row with any unmeasured identity field as unmeasured; the step
  passes `sessions` whole (`unmeasured` among their fields) and decides nothing.
- **F3, text.** The `ParentFact` and `adoptionParentFacts` comments and D-8092 say what `deadSince` is.
- **F4.** (a) In the audit loop an answer drops its ask only when `adoptionAudits` holds it; one that is not definite keeps its ask
  on a cut pass, so the next pass asks it again within the budget, and on an uncut pass it is fed as PR7 ruled. (b) The splice is
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
| F5 | the effects-loop cut row's digest line; L1 `owedLeaseNotices` with `adopted` | green on the base (the step matched it); red under FR1-F5-adopted and FR1-F5-match |

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
| PR7b-F6b | no rotation | L1 "F2: ten candidates", "F10"; lane "F2, F6 (b)" |
| PR7b-F6c | the retraction arm of `disproved` dropped | L1 "F7: a kept death that the lane retracts"; lane "F7: a death the lane kept, then retracted", "F2: a late stop stamp …", "review 1622 F1: a retraction, then measured absent" |
| PR7b-F6d | `changed: false` drops the entry | L1 "W5-D10", "F6: a tree whose census record reads unreadable"; lane "F6 (d)" |
| PR7b-F8 | generation only | L1 "F8 (D-8093)" |
| PR7b-F9 | every audit word is `changed` | L1 "F9"; lane "F9: … changed: unmeasured", "F9: … no lease-audit-v1" |
| PR7b-F10 | the comparator reversed | L1 "F2: ten candidates", "F10"; lane "F2, F6 (b)"; `delegation-carrier` "D-8034"; `delegation-carrier-lane` "one listing, every carrier behind …" |
| PR7b-try | the step's `catch` rethrows | lane "the one-try advisory" |
| REVIEW-X-deadalone | a present parent not alive is evidence on its own | L1 "F2: a death the lane saw is kept …", "F5", "F7"; lane "F2: a restart …", "F7", "F2: a late stop stamp …", "F5", "review 1622 F1: alive … then alive at a new one", "… then measured absent", "… a retraction, then measured absent", "review 1622 F2" (run before the fourth F1 row existed) |
| PR7-W5-DM9b | owed notices from this pass's decisions | lane "W5-Q3b", "W5-Q4", "F6, A2", "F4: a pass cut inside the effects loop" |
| PR7-FR1-F3-age | the hour dropped | L1 "F3, A8"; lane "F3: a held audit answer older than an hour", "A8", "F6 (d)" |
| PR7-FR1-F6 | a held notice counted without asking for mail | lane "F6: a digest already sent is not owed while mail-disabled stands" |
| PR7-FR1-F7-past46 | every lease past rules 1 to 3 read | L1 "F7: adoptionCarrierReads reads no lease without terminal evidence"; lane "F2, F6 (b)" |

## Suites and growth

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
