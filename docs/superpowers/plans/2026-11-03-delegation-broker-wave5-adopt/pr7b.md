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
  `presence` are unmeasured, so a kept death holds and counts `waiting`. `deadSince` is read only while `presence` is `dead`. The
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
the reason named; every one is green at this PR's tip. The F6 (a), (b) and (d) rows and the effects-loop F4 row pin behaviour the
base already had (they are the coverage review 1609 found missing), so they are green on the base and red only under their
mutants.

| Ruling | Row | On the base |
|---|---|---|
| F1 | `delegation-adoption.test.ts` F1 (presence); A7/F1 (the fact's new shape) | red: no `lastAlive`; `alive` from `status` |
| F1 | `delegation-adoption-lane.test.ts` F1, presence `unknown` and `asleep` (and `dead`, the control) | red: adopted |
| F2 | lane F2 (a late stop stamp, a pass without the step, unbuilt, then built) | red: the retraction erased |
| F3 | lane F3 (four asks, a cut after two answers) | red: nothing held |
| F4 | lane F4 (a cut inside the carrier read) | red: the memory moved |
| F4 | lane F4 (a cut inside the effects loop) | green (coverage) |
| F5 | L1 F5; lane F5 (alive on a pass without the step, then dead again) | red: adopted on the old death |
| F6 | lane F6 (a); lane F2, F6 (b); lane F6 (d) | green (coverage) |
| F8 | L1 F8 (four foreign bodies; an equal control) | red: adopted |
| F9 | L1 F9; lane F9 (`changed: true`, `changed: 'unmeasured'`, no `lease-audit-v1`) | red: "left changed" for all |
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

- **Presence, not `rowStanding`.** The ruling names `presence`, and the decider reads it as the ruling says. `rowStanding` differs
  at two edges, both in the safe direction here: a row `alive` with lifecycle `restarting` is alive for adoption (it drops a kept
  death: a delay), and `unknown` with lifecycle `unmeasurable` is unmeasured for adoption where `rowStanding` reads `gone`.
- **A third wording for the digest (F9).** The checkpoint does not record what the adoption's audit showed (the floor rule), so a
  digest derived after a restart says neither "left changed" nor "could not be checked": "A worktree of delegated work by <parent>
  is kept: <path>". The ruling's two wordings stand wherever the lane remembers the audit, which is every notice queued without a
  restart in between.
- **An unread incarnation drops (F5).** A last-alive pass whose incarnation the census did not read counts as the lease's
  incarnation, so a kept entry it postdates is dropped: a delay only, never a permission.
- **The F6 (b) row's control.** "Nothing counted before the reading pass" proves the window; "every carrier read within the two
  passes" (`lastRead` holds ten) differs under the rotation mutant.

## Suites and growth

Run alone at this PR's tip through `ccrc test`, each file one run, all green: `delegation-adoption` 45, `delegation-adoption-lane` 49,
`delegation-adoption-corpus` 23 (W5-D12 over 21 versions), `delegation-carrier` 25, `delegation-carrier-lane` 27,
`delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311, `fleet-health` 54, `lease-routes` 24,
`delegation-lease-acts` 19, `refusal-status` 27, `coord-store` 270, `run-session-census` 18, `mail-hardening` 19, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, all 24 `single-definition/*` files, all 11 `rings/*` files,
`typecheck-tests` 12 (red on its first run only because the agent package's modules were not installed in this worktree; green
after `npm ci` there), `GROWTH_CHECK=1` growth-check 54, and `deviation-refs` 31 and `dtbd` 1 after `git fetch origin main`.
The pwa package's own typecheck exits 0. Growth
against the base (`67121c031`): `watch.ts` +15 / -7 (+8 net, within the brief's +20); `store.ts` +0.
`delegation-adoption.ts` is 469 lines and `delegationAdoptStep.ts` 237.
