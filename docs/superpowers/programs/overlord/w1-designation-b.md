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
  `gone` only, and refuses `overlord-attempt-pending` while an attempt is pending on the slot. On accept: the body adapter's
  new `ensure` (the ensure route's own asked-wake record first, then `CCD_ARGV.ensure`), keep-awake on, and the first prompt.
  Both are exported for readiness, which asks the same decider.
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
| `attempt-fact-and-action-in-l0` | (none) | `SettleFact` and `AttemptAction` are L0 types in `shared/overlord-designation.ts`, so the decider, the settle step's file and the generations lane share one vocabulary. The lane still imports the L1 decider `pendingDeadlineOf` as a value, as the plan prescribes; its import allowlist admits it. |
| `attempt-port-shape-follows-the-action` | The attempt port's sketch. | `OverlordAttemptPort` is `facts()`, `resettle(sessionId, startId)`, `expire(sessionId, outcome)` and `drain(ids)`: each act takes what its `AttemptAction` arm carries, and `facts()` gathers the decider's input before the synchronous pass. Its home (`renewalActs.ts`) and Task 10's `beforeRenew` binding in `watch.ts` are the plan's. |
| `rebind-ends-the-old-generation-retired` | `restampOverlordGeneration` ends the old body's live generation for a rebind. | `goLiveRebind` calls the existing `endOverlordGeneration(old)` (outcome `retired`) before `restampOverlordGeneration(new)`; `continuityStore.ts`'s restamp is unchanged. |
| `failed-rebind-body-generation-ends` (found while testing) | (none) | A pending rebind's body mints under its own id until it goes live (`identityOf`), and `endOverlordGeneration` matched `identity = 'overlord'` only, so a failed or cancelled rebind left that generation live. It now ends `identity IN ('overlord', <the id>)`. Pinned by two cases in `overlord-rebind.test.ts`. |
| `body-down-since-is-the-lane's` | `{ kind: 'down'; since: number \| null }`. | `overlordBodyOf` has no clock, so `since` is always `null`; readiness keeps its own first sighting, as its plan says. |
| `gone-cause-orphan-when-unnamed` | `gone` with its cause. | A present row read `gone` names its lifecycle when that is a dead cause (`stopped`, `orphan`, `never-started`), and `orphan` otherwise; an unlisted id is `absent`. |
| `restart-is-attributed` | Restart changes no authority and has no step-up. | It still mints the gate's actor through the identity port and logs who asked, as gates B's census requires of every admin operator door. It writes no row. |
| `rebind-refuses-while-the-journal-is-not-coherent` | (none) | As designate does (review 2349 F9): a rolled-back or unmeasured authority journal refuses before any stop or create, since the go-live record is a widening. |
| `renewal-writes-the-class-too` (designation C, carried) | Task 10 names `poolset` and `acctorder`. | The write-set step writes the class as well (`writeClass` after `writeSet`), so a Settings route write that failed heals at the next renewal. |
| `restart-refuses-while-an-attempt-is-pending` (the coordinator's ruling, call 1021, review 3695 F1) | Restart's refusals are no binding and a body that is not asleep or gone; the plan is silent on a pending attempt. | `restartVerdict` refuses `overlord-attempt-pending` while an attempt is pending on the slot, whatever the bound body reads, before the body steps. Two Overlord bodies are never started side by side, even for the length of the deadline, and a forced rebind's stop is not undone by one tap. Readiness asks the same decider, so it follows. No new word, no wire change. Pinned by a route case and by mutants S6 and S7 of the decider's set. |
| `forced-rebind-may-leave-the-bound-body-stopped` | A failed attempt leaves the old binding untouched. | It does, and after a forced rebind that binding names a body the rebind stopped: a pending write, a create or an attempt that fails after the stop leaves it stopped, with nothing owing it a start. Once the attempt has ended, Restart accepts it (`gone`) and brings it back. A verdict refusal or a failed stop never leaves it stopped. |
| `sandbox-settle-extension-moved` | Extend `sandbox-settle.test.ts` for the rebind arm. | The rebind arm is pinned in `continuity-start-loads-route.test.ts` (`sandboxSettle` on a pending rebind, and the settle end to end) and by the sandbox mutant set's T2 and T7, rewritten for it; `sandbox-settle.test.ts` is unchanged. |
| `restart-generation-end-to-end-not-paired` | A test of Restart finding its own live generation end to end. | The generation a start mints is pinned in `continuity-generations-lane.test.ts`, and Restart's ensure of the bound id in `overlord-rebind-route.test.ts`; no one case pairs the door with the lane's mint. |
| `deadline-read-again-after-a-restart-by-construction` | A test of the deadline read again after a server restart. | The sweep keeps no state: each pass reads the row and the stored report again. The start-loads cases build a fresh port per step over the same store, and the wiring cases (`overlord-lane-wiring.test.ts`) read it through the watcher's own pass; no case restarts a server. |
| `rebind-go-live-old-stop-failure-cased-on-the-fail-path` | A test of the settle's drain when the old body's stop fails after a rebind's go-live. | The drain is the one `drainOwedStops`; a stop that fails or throws staying owed is pinned on the fail-pending path, not on the rebind arm. |
| `tests-after-the-code` | Red first. | The production code was written before its tests, so red was measured by removing each guard from the finished code (under Measured). Commit `bb14555f62` is typed `test(` and carries production lines (the generation fix, two door rows, Restart's attribution, four refusal kebabs, the CLAUDE.md sentence), and `f38c5d038c` puts an in-file extraction (`askedWake`, `createBody`, `createSteps`, `readAccountFacts`) in the same commit as new behaviour. The PR is squash-merged. |
| `rebind-stamps-its-designation-lines` (the merge with sequence A) | Sequence A's writer bullet: designation B's rebind arms stamp the one sequence inside their own transactions. | `rebindPending` stamps the new body `pending`; a rebind's go-live, now inside sequence A's `txWithAuthorityStamp`, checks its two lines before the append and stamps them after the row write: the new body `live`, then the old body `retired`, both with the attempt's actor. A failed or cancelled rebind stamps `failed` through `failPending` and `retire` as they stand. Both writers are stampers in `sequence-stamp-census.test.ts`. |
| `restamp-stays-identity-only` (the merge with sequence A) | Sequence A's census: the rebind moves `restampOverlordGeneration` to the stampers. | The rebind ends the old body's generation through `endOverlordGeneration`, which stamps it `ended` (with sequence A's `at`, and this PR's widening to the body's own identity), and `restampOverlordGeneration` still moves only the identity and term, so it stays a non-stamper; its census reason says so. |
| `restart-first-prompt-may-race-the-ensure` | Restart sends the first prompt after the ensure. | It does, as designate does after its create; a prompt the new pane is not ready for answers `prompted: false`, and nothing retries it. |

## The carry pointer the sweep leans on (sandbox B's relied-on contract)

The sweep reads stored reports through `startLoadsOfNewestStart`, the same read the loads door's settle makes, so it leans on
the same order: the session hook names a carried start (`carriedFrom`) only after the carried start's report was answered.
For one window only it does not depend on that order to make progress: a settle that answered `stale` because the carried
start's report landed during its workspace read is re-run by the next live pass, which reads the stored reports again and
settles from the evidence that stands then, so the known limit sandbox B named (F6, an attempt left pending behind a stale
settle) ends at the next live pass, and at worst at the deadline. No case drives that stale-then-sweep step. If the order is
inverted (a resume start's report stored before its carried start's), the carried start has no report, the sandbox check is
not engaged, and the first settle FAILS the attempt (`overlord-sandbox-unmet`); the sweep then has nothing to resettle. What is
pinned: the resettle of a stored report after a lost settle, of a refused go-live, and of a stored failed report (the cases
above). What is not: nothing here checks the hook's order itself; it is relied on, not checked, for the door's first settle
(`settleOnce`, `settleFactOf`, and the carry join `continuityStore.ts#startLoadsOfNewestStart`).

## What a merge arms, and what Live arms

At merge, with no switch (behind sign-in for the doors):
- the two doors, Rebind and Restart;
- the settle step acting on a pending rebind, and its drain of the old body at a rebind's go-live: not gated by any lane;
- a failed or cancelled rebind body ending its own generation.

Only while the `continuity` lane is live (seeded shadow; in shadow each pass records what it would do and nothing acts):
- the first start's deadline: a pending attempt past its deadline fails `deadline-passed` or `authority-unrecorded`;
- the settle retry: a lost, stale or journal-refused settle is settled again from the stored report;
- the owed-stop retry: a stop still owed (a drain that failed at go-live included) is tried again;
- the write-set before each Overlord renewal (renewals themselves act only live).

The continuity row's card says so in one sentence (`shared/lane-arm.ts`).

A known limit: with the lane in shadow, an attempt that never settles stays pending past its deadline, and every later
Rebind answers `overlord-attempt-pending` until Retire (which for a pending rebind also unbinds the live binding) or Live. The
Rebind door reads no lane, measured by reading `overlordRoutes.ts#rebind`: it reads the authority journal, the designation
row, the pool answer, the old body and the account facts, and refuses on the pending slot alone. Designate reads no lane
either. No gate is built for it (the coordinator's ruling).

## Not changed here

- No migration, no ccd verb, no capability word, no new refusal word (`overlord-attempt-pending` was already in
  `OVERLORD_REFUSALS`), no change to `shared/api.ts`.
- The gate counts in `auth/gate.ts` and its census and the id-taking argv census (56 calls) were applied on each holder's yes
  to the exact diff, and re-derived in fix round 1's one merge with main `9ae84dca5b20fc75a188757666308839591e7e1c`. That main
  carries #3286's draft-review door (305 scanned, 302 HTTP, 112 exempt); with this PR's two doors the gate counts are 307
  scanned, 304 HTTP, 192 gated and 112 exempt, applied on the holder's yes to the exact merge packet. The id-taking census
  needed no change. The flag-aware test's title still says thirty-five (its holder's note; nothing asserts it).

## Measured

Each file through `ccrc test`, one at a time, fixture stores and fake ports only, on this branch's commits. No whole-suite
run; CI and the merge queue are the arbiters for everything else.

- New and touched suites, each green: `overlord-rebind` (29), `overlord-restart-deadline` (33), `overlord-rebind-route` (32),
  `overlord-lane-port` (15), `overlord-lane-wiring` (3), `overlord-body` (45), `overlord-designate-route` (51), `overlord-settings-doors` (60),
  `continuity-start-loads-route` (60), `continuity-renewal-acts` (36), `continuity-generations-lane` (112, with main's cases), `sandbox-settle` (12).
- Censuses, each green: `auth-gate` (394), `box-token-census` (80), `overlord-doors-census` (32), `overlord-gate-census` (33),
  `overlord-gate-doors` (42), `id-argv-census` (11), `verb-gate` (25), `mail-routes` (61), `single-definition/writers-map` (49), `sequence-stamp-census` (6);
  every `rings/*` and `single-definition/*` file (56 files), each alone.
- Mutation, scoped to BASELINE, the floors check, `sandboxCheck.ts#sandboxSettle` (T2 and T7 rewritten for the rebind arm) and
  the three new sets `rebindVerdict` (10 mutants), `restartVerdict` (7) and `pendingDeadlineOf` (12), each at floor 1: 6 of 6
  tests, every mutant killed. The whole mutation-floors file was not run.
- By hand, each guard removed in place, its suite run, the file restored byte for byte. M16 to M24 are fix round 1's: the five
  wiring seams review 3695 F2 found unpinned (each killed by `overlord-lane-wiring.test.ts`, which builds the production server
  with a real watcher), Restart while pending (F1), the gate before the body's parse (A1), and the rebind's two sequence stamps
  the merge with main added.

| Guard removed | Suite | Red cases |
|---|---|---|
| M1 the repoint moves parked mail too | `overlord-rebind` | 1 |
| M2 the forced stop before the verdict | `overlord-rebind-route` | 5 |
| M3 the pass drops its action | `continuity-generations-lane` | 4 |
| M4 the action acts in shadow | `continuity-generations-lane` | 3 |
| M5 a refused write-set goes on to renew | `continuity-renewal-acts` | 1 |
| M6 the write-set after the claim | `continuity-renewal-acts` | 2 |
| M7 a failed rebind body keeps its generation | `overlord-rebind` | 2 |
| M8 the settle does not drain the old body | `continuity-start-loads-route` | 3 |
| M9 `rebindPending` without its re-read | `overlord-rebind` | 1 |
| M10 the write-set skips the class | `overlord-lane-port` | 2 |
| M11 expire off the serialiser | `overlord-lane-port` | 3 |
| M12 the old generation not ended at go-live | `overlord-rebind` | 1 |
| M13 the settle ignores a rebind | `continuity-start-loads-route` | 5 |
| M14 the sweep never resettles | `continuity-start-loads-route` | 4 |
| M15 Restart not attributed | `overlord-doors-census` | 1 |
| M16 `server.ts` does not install the lane (`useOverlordLane`) | `overlord-lane-wiring` | 2 |
| M17 the watcher does not hand the attempt to the pass | `overlord-lane-wiring` | 1 |
| M18 the watcher does not run the pass's attempt | `overlord-lane-wiring` | 1 |
| M19 the watcher hands the renewal acts no before-renew step | `overlord-lane-wiring` | 1 |
| M20 the production go-live adapter drops `previous` | `overlord-lane-wiring` | 2 |
| M21 Restart ignores a pending attempt | `overlord-rebind-route` | 1 |
| M22 Rebind parses its body before the gate | `overlord-rebind-route` | 1 |
| M23 `rebindPending` stamps no line | `overlord-rebind` | 1 |
| M24 a rebind's go-live stamps no lines | `overlord-rebind` | 1 |

  The before-renew case keeps the step the watcher hands the production `renewalActsOf` (a pass-through wrapper over the
  module, which still builds the real acts) and asks it as a renewal would; no case drives a whole Overlord renewal through the
  watcher.
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
