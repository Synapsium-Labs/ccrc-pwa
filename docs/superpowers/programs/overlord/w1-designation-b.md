# W1 designation, PR B: the builder's notes

What PR B (Tasks 6, 7 and 10 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-designation.md`) found and departed from,
by slug, for the coordinator to fold into the ledger. No D-number is defined here (X9). PR A's notes are
`w1-designation/pr-a.md` beside the plan; PR C's are `w1-designation-pr-c-notes.md` in this folder.

## What it ships

- **Rebind the Overlord**, `POST /api/overlord/rebind` (Task 6): the account gate with a step-up, on the coordination
  serialiser. `rebindVerdict` (L1) refuses in the plan's order: `not-found` with no live binding, `overlord-attempt-pending`,
  `overlord-body-alive` unless the bound body measures dead or absent by the reclaim door's own re-measurement
  (`reclaim.ts#measureClaimant`; `force` lifts this step only), then designate's capability words, builds, set spelling and
  count under the row's class and set. A forced rebind stops the old body only after every verdict refusal, and a stop that
  fails refuses `overlord-body-alive` and creates nothing. `rebindPending` re-reads the slot in its own transaction. The new
  body is created by the same steps as designate's (`overlordRoutes.ts#createBody`, now shared), with its first prompt (X4).
- **Going live on a rebind**: `goLive`'s rebind arm (`overlordDesignationStore.ts#goLiveRebind`) appends `authority-rebind`
  first, binds the new body, raises the term once and keeps `designatedTerm`, puts the old id on `pastIds` and `stopsOwed`,
  ends the old body's live `overlord` generation before it re-stamps the new one (X5), and repoints the old body's
  outstanding `overlord` mail (`CoordStore`'s private `repointOverlordMail`, through the one delivery writer), all in one
  transaction. The settle step now acts on a pending rebind (sandbox B's `settle-acts-on-designate-only-until-rebind`) and,
  after a rebind's go-live, drains the old body on the serialiser (`continuity/routes.ts#settleLoads`).
- **Restart the Overlord**, `POST /api/overlord/restart` (Task 7): the account gate with no step-up. `overlordBodyOf` maps the
  watcher's last listing and fleet to `up`, `down`, `asleep`, `gone` or `unmeasured`; `restartVerdict` accepts `asleep` and
  `gone` only. On accept: the body adapter's new `ensure` (the ensure route's own asked-wake record first, then
  `CCD_ARGV.ensure`), keep-awake on, and the first prompt. Both are exported for readiness, which asks the same decider.
- **The pending deadline and the settle retry** (Task 7): each generations pass decides one `AttemptAction` with
  `pendingDeadlineOf` over facts the watcher gathers through the designation's lane port before the synchronous pass. Live,
  `renewalActs.ts#runOverlordAttempt` runs it through `OverlordAttemptPort`; in shadow it is a `recorded` line and nothing
  acts. The port (`overlordRoutes.ts#overlordLanePortOf`) is installed by the composition root with
  `FleetWatcher.useOverlordLane`, as `useInboxReadGate` installs the read gate.
- **The write-set before each renewal** (Task 10): `RenewalActsDeps.beforeRenew`, asked for an Overlord target before the call
  is claimed; `renewalSetOf` (L1) answers the set's spelling, the ordered list and the class, and the lane port writes them.

## The builder's departures

| Slug | The plan says | Built |
|---|---|---|
| `settle-runs-after-the-answer` (sandbox B, carried) | The deadline sweep re-runs a lost settle. | Inside the deadline, a pending attempt whose newest start has a stored report of its own body and generation is settled again each pass through the one settle path (`settleLoads`, with the loads door's own port), and each retry is logged. That covers a settle lost after the door's answer, a `stale` settle, and a go-live the journal refused (question 10). Proven end to end over a real `CoordStore` and the real `settleLoads` in `continuity-start-loads-route.test.ts`: a lost settle goes live in one sweep step; a refused go-live stays pending, is resettled, and past the deadline fails `authority-unrecorded` and is drained; a pending rebind goes live by the same path and drains the old body. |
| `resettle-reads-a-settle-fact` | `pendingDeadlineOf(read, settleRead, now)`; resettle "for a pending attempt whose newest start holds a recorded held verdict". | No verdict is stored (sandbox B's `verdict-computed-on-read`), so the fact is computed on read: `continuity/routes.ts#settleFactOf` reads the newest start and its stored report with the same reads and `sandboxVerdict` as `settleOnce`, and answers `reported` (its start, its generation, held or not), `no-report` or `unread`. The decider resettles any stored report of its own body and generation, held or failed, so a lost failed settle is also re-run; it expires `authority-unrecorded` only when that report holds. |
| `deadline-sweep-port-installed-on-the-watcher` | The port's adapter in `server.ts`. | The adapter lives in `overlordRoutes.ts` beside the one drain (`overlordLanePortOf`), so `server.ts` grows by its wiring only; the watcher takes it through `useOverlordLane`, and the lane imports only its types and the L1 decider. |
| `attempt-fact-and-action-in-l0` | (none) | `SettleFact` and `AttemptAction` are L0 types in `shared/overlord-designation.ts`, so the decider, the settle step's file and the generations lane share one vocabulary without a cross-context value import. |
| `rebind-ends-the-old-generation-retired` | `restampOverlordGeneration` ends the old body's live generation for a rebind. | `goLiveRebind` calls the existing `endOverlordGeneration(old)` (outcome `retired`) before `restampOverlordGeneration(new)`; `continuityStore.ts`'s restamp is unchanged. |
| `failed-rebind-body-generation-ends` (found while testing) | (none) | A pending rebind's body mints under its own id until it goes live (`identityOf`), and `endOverlordGeneration` matched `identity = 'overlord'` only, so a failed or cancelled rebind left that generation live. It now ends `identity IN ('overlord', <the id>)`. Pinned by two cases in `overlord-rebind.test.ts`. |
| `body-down-since-is-the-lane's` | `{ kind: 'down'; since: number \| null }`. | `overlordBodyOf` has no clock, so `since` is always `null`; readiness keeps its own first sighting, as its plan says. |
| `gone-cause-orphan-when-unnamed` | `gone` with its cause. | A present row read `gone` names its lifecycle when that is a dead cause (`stopped`, `orphan`, `never-started`), and `orphan` otherwise; an unlisted id is `absent`. |
| `restart-is-attributed` | Restart changes no authority and has no step-up. | It still mints the gate's actor through the identity port and logs who asked, as gates B's census requires of every admin operator door. It writes no row. |
| `rebind-refuses-while-the-journal-is-not-coherent` | (none) | As designate does (review 2349 F9): a rolled-back or unmeasured authority journal refuses before any stop or create, since the go-live record is a widening. |
| `renewal-writes-the-class-too` (designation C, carried) | Task 10 names `poolset` and `acctorder`. | The write-set step writes the class as well (`writeClass` after `writeSet`), so a Settings route write that failed heals at the next renewal. |
| `restart-first-prompt-may-race-the-ensure` | Restart sends the first prompt after the ensure. | It does, as designate does after its create; a prompt the new pane is not ready for answers `prompted: false`, and nothing retries it. |

## The carry pointer the sweep leans on (sandbox B's relied-on contract)

The sweep reads stored reports through `startLoadsOfNewestStart`, the same read the loads door's settle makes, so it leans on
the same order: the session hook names a carried start (`carriedFrom`) only after the carried start's report was answered.
It does not depend on that order to make progress, and that is the point of it: if the order broke and a newest start's
settle answered `stale`, the next pass's resettle reads the stored reports again and settles from the evidence that stands
then. So the known limit sandbox B named (F6, an attempt left pending behind a stale settle) now ends at the next pass, and at
worst at the deadline. What is pinned: the resettle of a stored report after a lost settle, of a refused go-live, and of a
stored failed report (the cases above). What is not: nothing here checks the hook's order itself; it is still relied on, not
checked, for the door's first settle.

## Not changed here

- No migration, no ccd verb, no capability word, no new refusal word (`overlord-attempt-pending` was already in
  `OVERLORD_REFUSALS`), no change to `shared/api.ts`.
- The gate counts in `auth/gate.ts` and its census (303 HTTP, 306 scanned, 192 gated) and the id-taking argv census (56 calls)
  are this base's numbers, applied on each holder's yes to the exact diff. They are re-derived once, in the merge on the final
  base the coordinator names. The flag-aware test's title still says thirty-five (its holder's note; nothing asserts it).

## Measured

Each file through `ccrc test`, one at a time, fixture stores and fake ports only, on this branch's commits. No whole-suite
run; CI and the merge queue are the arbiters for everything else.

- New and touched suites, each green: `overlord-rebind` (27), `overlord-restart-deadline` (32), `overlord-rebind-route` (30),
  `overlord-lane-port` (15), `overlord-body` (45), `overlord-designate-route` (51), `overlord-settings-doors` (60),
  `continuity-start-loads-route` (60), `continuity-renewal-acts` (36), `continuity-generations-lane` (109), `sandbox-settle` (12).
- Censuses, each green: `auth-gate` (391), `box-token-census` (70), `overlord-doors-census` (32), `overlord-gate-census` (33),
  `overlord-gate-doors` (42), `id-argv-census` (11), `verb-gate` (25), `mail-routes` (61), `single-definition/writers-map` (49);
  every `rings/*` and `single-definition/*` file (56 files), each alone.
- Mutation, scoped to BASELINE, the floors check, `sandboxCheck.ts#sandboxSettle` (T2 and T7 rewritten for the rebind arm) and
  the three new sets `rebindVerdict` (10 mutants), `restartVerdict` (5) and `pendingDeadlineOf` (12), each at floor 1: 6 of 6
  tests, every mutant killed. The whole mutation-floors file was not run.
- By hand, each guard removed in place, its suite run, the file restored byte for byte (red cases in brackets): the repoint
  moving parked mail (1); the forced stop before the verdict (5); the pass dropping its action (4); the action acting in shadow
  (3); a refused write-set going on to renew (1); the write-set after the claim (2); a failed rebind body keeping its
  generation (2); the settle not draining the old body (3); `rebindPending` without its re-read (1); the write-set skipping the
  class (2); expire off the serialiser (3); the old generation not ended at go-live (1); the settle ignoring a rebind (5); the
  sweep never resettling (4); Restart not attributed (1).
- Red first: the production code was written before its tests in this PR, so "red" was measured by removing each guard from
  the finished code (the list above and the mutant sets), not by running the tests on the code before it.
- The server typecheck, the tests typecheck and the PWA typecheck: clean. The growth check, armed: green.
- CI's first run on the pushed tip was red in four cases this note's list had missed, all fixed in one round:
  `run-session-census` counted two compares in `overlordDesignation.ts` (the settle fact's session against the pending one,
  and the renewing session against the bound one) as binding sites; neither reads a run, so both are named in
  `NOT_BINDING_SITES` with their reasons. `mail-hardening` refused the new repoint for answering nothing: it now answers
  `{changed}`, as `repointCoordinatorMail` does. Mutant D11 of `designateVerdict` no longer matched one place once
  `renewalSetOf` spelled the same text, so its anchor names the create's line. A designation A store case expected `goLive`'s
  answer without the new `previous: null`.
