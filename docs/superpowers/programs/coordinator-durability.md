# Program: coordinator-durability

Epic: #752 (coordinator↔worker durability: messages land, rosters survive compaction, parents follow identity)
Spec (the tail): `docs/superpowers/specs/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md`
Plan (the tail): `docs/superpowers/plans/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon.md`
Home project: `ccrc-pwa`   Workspace: **a fresh child per task**
**Status: planning.** D1 to D5 are designed by their own specs; D7 and D8 by the tail spec above; D6 and D8 are inputs
to the consolidation wave's W6.

**What this program is.** The investigation behind #752 found that restarts and account swaps do **not** lose the
coordinator↔worker link (12 coordinators, 108 spawns, 48 swaps, 0 lost claims). What does lose it, ranked: mail parked
for good when typing into the box fails; mail that reaches only idle sessions; worker restarts that kill in-flight
background work; a coordinator's roster that lives only in its context; parents derived by matching a string; and
claims and held-ask timers that are not durable across a revive or a server restart. Eight items, D1 to D8, each one
GitHub issue.

## Items and build order

Order: **D1 → D3 → D2 → D4 → D5**, then **D7**. **D6 and D8 are inputs to the consolidation's W6** (`RunBinding`,
cluster K10), not standalone builds (decision D-5920).

| # | item | issue | gate | state |
|---|---|---|---|---|
| 1 | D1 mail: never park a message as undeliverable while its recipient is alive; tell the sender | #754 | none | in review, PR #821 |
| 2 | D3 dispatch: confirm the wave brief was taken within 5 min, retry, then tell the coordinator | #755 | D1 (its retry rides D1's parked path) | to spec |
| 3 | D2 mail: surface pending mail inside a running turn (hook); the `busy` gate | #756 | D1; arming is OA-D2 | to spec |
| 4 | D4 coordinator: re-inject its run roster on compaction, resume, clear and wake | #757 | none (ordered after D2) | to spec |
| 5 | D5 worker restart: re-attach notice and a coordinator heads-up | #759 | none (ordered after D4) | to spec |
| 6 | D7 drift reconciler, digest section, held questions across a restart | #760 | #821 for DT1; the consolidation's W1a C1c and W1b for DT2; skins P4a and P7 for DT4; DT5 none | specced and planned (tail spec rev 1, Tasks DT1 to DT5) |
| W6 input | D6 parent derivation checks the worker's birth; runs released when their coordinator is archived | #758 | the consolidation's W6 | input to W6's `bindingOf`; its listing half is D7's `claimant-gone` |
| W6 input | D8 the coordinator's uuid on the claim; an attributed reclaim offered after an id-changing revive | #761 | the consolidation's W6 | specced and planned (Tasks DT6, DT7); DT7 conditional on the 30-day rule |

## Operator acts (later, never assumed by a task)

- **OA-D2: arm the `busy` mail gate**, after D2's hook ships and the operator has reviewed the `mail-gate-busy-shadow`
  log. The operator creates `$REG/mail-gate-busy` by hand; the gate markers have no writer in the tree (CLAUDE.md).
- **OA-D6: arm the dead-coordinator lane**, after its shadow record has been reviewed against D7's `claimant-gone`
  findings. The operator creates `$REG/dead-coordinator-lane-live` by hand.

## Decisions & deviations

- **R1 (2026-10-20)**, the tail is specced and planned under the operator's autonomous-backlog mandate of 2026-10-19;
  the operator may overrule any decision. The plan defines D-5920 to D-5927; 5928 and 5929 are issued and unused.
- **R2**, D6 and D8 feed W6 rather than racing it: the consolidation's K10 makes `RunBinding` the one
  coordinator↔worker link with four writers, and says W6 waits for this investigation. A standalone patch to
  `parentOfSession` or `openRun` first would be a second rule W6 must merge (D-5920).

## Carried constraints

- Account switching and the auto-swap are never blocked; no herd restarts; hibernation's contract; coordinator-first
  routing; the ccrc SAFETY rules.
- Where a task here and a consolidation series both edit `server/src/watch.ts`, the consolidation series rebases
  (consolidation spec §5.1 rule 6).
- No new arming marker (the consolidation's K12 would have to absorb it).

## Next-wave brief

Land D1 (#754, PR #821): D3 depends on it, and so does the tail's DT1 (its mail kinds read #821's park columns). Task DT5
(held questions and approvals across a restart) has no gate and may run now, rule 6 against #821 on `watch.ts`. DT1
follows #821; DT2 waits for W1a's C1c and W1b.
