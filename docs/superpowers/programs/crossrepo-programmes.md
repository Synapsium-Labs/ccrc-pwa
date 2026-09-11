# Program: crossrepo-programmes

Spec: `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md` (design approved in dialogue by the
operator 2026-09-08; inherits every 2026-08-11 ruling from `2026-08-11-crossrepo-programmes-design.md`)
Plan: three wave plans, written before the program opened —
`docs/superpowers/plans/2026-09-08-crossrepo-wave{1-server,2-skills-pwa,3-docs-flip}.md`
Workspace: `ccrc-pwa-bright-meadow` — spawned fresh by wave 1's dispatch (run 36, 2026-09-09 13:5x UTC); held
`program:crossrepo-programmes wave:1/3`; waves 2 and 3 reclaim it by `sessionId`.
Coordinator: `claude-ccrc-pwa`, the live main checkout of ccrc-pwa — designated by the operator's "start
program" at 13:34 UTC 2026-09-09. This line earlier said a FRESH main checkout opened only after
account-pools had closed; the operator chose not to wait, and this session is what the run board's Start
door would have spawned. Measured at open: account-pools (run 35, wave 4/6, this project) and a second
programme in another project (run 31) were BOTH active, so `resolveCoordinator(null)` — fleet-wide,
`SELECT slug FROM programs WHERE state = 'active'`, `active.length !== 1 → null` (`server/src/coord/store.ts`)
— already answered `unknown-recipient` to every runId-less coordinator mail before this programme opened.
Opening a third changes nothing; every mail in this programme names its `runId`. The coordinator carries no
hold (`ccd ws-hold` refuses a main checkout); `GET /api/runs` is the resume point, and the id survives an
account swap. NOT the account-pools coordinator, which owns a live programme of its own.

The spec, the three plans and this ledger merge to `main` BEFORE wave 1 is dispatched, so every worker
workspace is cut with its requirements in the tree. This ledger moves on the coordinator's branch (pushed
after every wave) and lands on `main` with the final wave.

Execution shape, every wave: the worker invokes `superpowers:subagent-driven-development` on its own
workspace branch — fresh implementer subagent per task, task review after each, whole-branch review at the
end — then pushes, opens the PR and mails `wave-done`. The coordinator re-measures, reviews the PR with an
independent lens, merges (a hand-written squash body), deploys AGENT-FIRST where the wave says so, and
briefs the next wave — opening wave N+1's run BEFORE closing wave N's.

Ledger block: **D-2054–D-2070** — seventeen numbers minted in ONE allocator call on 2026-09-08 at plan time
(floor 2071) and FULLY DEFINED across the three plans' `## Deviations found` sections (wave 1: D-2054–D-2061;
wave 2: D-2062–D-2065; wave 3: D-2066–D-2070), each ratified by the orchestrator and folded into the spec's
sentences the same day. It is not a reserve. Wave 1 added two execution-time numbers outside the block, both defined in its plan's
`## Deviations found`: **D-2338** (Task 6, `parkSupersededDeliveries` extracted so mail-hardening's writer
census keeps its single-line-signature premise — minted by a fix-round subagent under the title "probe - do
not use", ratified by the coordinator 2026-09-09 23:1x UTC rather than re-pointed, because the number was
issued, spent and defined; the title stays as the row's history) and **D-2342** (Task 2's dispatch rung reads
`.project` through `fieldMeasured` — unreadable refuses `registry-unmeasurable`, absent permits, `by` names
what was read; minted by the coordinator on the worker's `deviation-request`, COUNT 1). Review round 1 added
**D-2349–D-2353**, minted in one call on the worker's COUNT 5 (2026-09-10 02:1x UTC), one per ruled fix whose
shipped form departs from the plan's text: D-2349 the home shaped at the door (trim, single path segment, 400
with detail); D-2350 the open route binds AFTER the hold; D-2351 `setSession` returns `bindSession`'s answer and
a `session-rebound` run event records an occupant change; D-2352 `homeProject` joins the reconstruction drill's
UNRECOVERABLE census; D-2353 the dispatch `project-mismatch` row says abandon first, never a blind retry. Same-
bytes derivations, test-only pins and prose fixes carry no number. **D-2410** (minted 2026-09-10 12:2x UTC):
main took migration 9 mid-wave (PR #74, the ask pre-emption lane), so this wave's one migration ships as
migration 10 and `COORD_SCHEMA_VERSION` derives to 10; the wave-1 plan's seventeen "migration 9" mentions stay as
anchored snapshots, and the wave-2 and wave-3 plans, the spec and this ledger cite no number (measured zero).
Acceptance after PR #75 had already merged added **D-2505–D-2508**, allocated by the coordinator in one call and
fully defined in the wave-1 plan: D-2505 makes the successful post-hold worker bind, mail transfer/park and rebound
event one SQLite transaction; D-2506 makes programme-home backfill and its audit event one transaction; D-2507
makes the armed feed read exempt-but-authenticated for either a PWA session or the cookieless box-token client; and
D-2508 shapes programme slugs before either HTTP ingress can turn one into a ledger path. Correction review then
allocated **D-2518**: the shared shape needs a conservative character bound before the PWA creates a coordinator,
because an arbitrarily long safe-character slug can pass shape, start the session, and make the composed kickoff exceed
the mail cap forever; the PWA also needs the actual composed kickoff byte verdict so an unbounded/multibyte title cannot
do the same. The complete hold gets an independent serialized-reason verdict because its 127-character hook limit
includes the dynamic wave, denominator and run-id widths rather than applying to the raw slug. Run ingress must also
bound wave/denominator to positive decimal-safe integers: an unbounded integer can render exponent punctuation that
the hook grammar rejects even while the hold fits by length. An execution-time deviation gets its own allocator
call: the worker writes `D-TBD-<slug>` with a full entry and mails a `deviation-request` naming the count; the
coordinator mints exactly that many, defines them in the same act, and mails the numbers back.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Server + shared: `project-mismatch` at open and at dispatch resume, `home-mismatch`, the one migration (`programs.homeProject`, `feed_events.runId`), `homeProject` at open with the legacy generation, `RunSummary.homeProject`, the `worker` mail role, `bindSession` and the heir re-issue, the programme filters on mail and feed, `ccrc-api` rows, both refusal codes named in the coordinator skill. AGENT-FIRST (the skill sentence ships via the install lane). | #75, #86 | **correction in progress** — PR #75 was merged externally as main `ec11030d` before acceptance closed. Four defects measured on that merged tree became D-2505–D-2508; run 36 returned to `working`. Correction PR #86 opened at `41daae5f`, with its first full local gates and five CI legs green. Main then advanced through #85 and #81; the worker integrated `b879510f` locally as `33c769c5`. During D-2518 work the coordinator refuted the first uncommitted fix: composite kickoff preflight still allowed a hold-oversize slug to create a coordinator, so mail 585 requires a conservative shared raw-slug cap plus the actual kickoff and serialized-hold verdicts; mails 587/589 add the numeric grammar/width budget the cap relies on. The worker acknowledged all four correction mails and began the shared guard, but the next measured edit still reserved only three JavaScript-safe 16-digit numerals, deriving 59 rather than deliberately reserving a 19-digit SQLite run-id slot: the complete empty-slug model is 71 characters and leaves 56. Mail 615 records that correction; exact kickoff coverage must use an in-cap slug and title sizing for 8,192 accepted / 8,194 refused. That mail ALSO claimed the plan and the PWA/kickoff cases still carried 4,021/4,022 and 59/60 literals, and the worker refuted both premises by measurement: no 4,021/4,022 literal existed in any of the five named artifacts, and the slug cases derive their fixtures from `PROGRAM_SLUG_MAX_CHARS` rather than naming 59 — what was actually stale was three test TITLES, one `toBe(59)` assertion and the plan's own derivation. The coordinator accepted both corrections; the overstatement is recorded here rather than left standing, because a finding is a claim and is measured like any other. Main also advanced again to `79d6d045` through #88, overlapping `ccd/ccd`, `shared/api.ts`, `server/src/server.ts` and other account-pool files; mail 584 requires that exact integration and final provenance re-stamp before full combined-tree gates, push, fresh five-leg CI and a new fingerprint. The worker then landed the cap at 56 (`76c8f136`), derived mechanically through the real serializer with `RUN_ID_MAX_DECIMAL` held as TEXT and a test pinning that `String(Number(...))` differs from it, moved the over-cap body fixture to a genuine two-byte proof on BOTH composers, put grammar and numeric domain BEFORE length so `hold-oversize` only ever describes an otherwise-valid hold whose SKILL.md remedy can repair it, and added the ordinary-close SURVIVOR refusals the next-wave and abandon cases did not cover. Exact current main `79d6d045` was merged at `161e56ee` and pushed; the coordinator re-measured local tip, `origin/ws/bright-meadow` and the PR head as one sha, confirmed `ccd/ccd` is byte-identical to main's so its `f70dacff` marker needs no re-stamp, and confirmed `fiveWindowMinutes`, `_is_anthropic_backend`'s four call sites beside the untouched `_is_home_able` placement calls, and the `LC_ALL=C` readers all survived the merge. **D-2545 was allocated and ruled OUT of this wave**: `openRunsForSession` coerces persisted `id`/`wave`/`waveOf` without proving them representable, so an out-of-domain row throws `RangeError` before close can answer `hold-invalid` — but `openRun` is the only reachable `INSERT INTO runs` and validates both ends, `reconstruct` has no production caller, so no shipped build can write the row, and the same coercion is store-wide; repairing one seam would correct the instance and leave the claim, so wave 2 hardens the whole persisted-integer read surface in one fail-shut pass. Still open before acceptance: the PWA ledger-preview fix (`ledgerPath` must never see raw input, which D-2508 names explicitly), the D-2545 record, a fresh push, and five green CI legs on that exact head. No correction deploy or merge. |
| 2 | Skills + PWA: the coordinator skill's boundary sentences, the worker skill's foreign-plan sentence, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, the mail screen's programme grouping and chip. AGENT-FIRST. | — | not opened |
| 3 | Docs + the legacy flip: README sections, the Aug 11 spec's status line, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` as its own commit ONLY when the operator's read of `run_events` and `runs` on the server box shows zero `legacy-home-project` events AND at least one run opened over seven consecutive days (D-2066, D-2067) — else deferred with both numbers recorded. NOT agent-first (D-2069). | — | not opened |

Dogfood follows as its own program after wave 2 is live: home `custom-tools`, wave 1 there, wave 2 in
`data-internal`, on real work the operator names, opened without `sessionId`. Exit criteria = spec §9's
acceptance list, verbatim.

## Decisions & deviations

- **Opened without waiting for account-pools (2026-09-09, operator):** the run board's Start door refuses a
  project with an open run, and its copy names the single-active-programme fallback as the reason. Measured
  before opening: that fallback is fleet-wide and was already ambiguous with two live programmes, so the
  refusal guarded nothing here. The one cost that is real — two live workspaces, two concurrency slots, two
  of the daily budget — is the caps', and the dispatch route measures it.
- **Order (2026-09-08, operator):** of the three genuinely open roadmap items (Build 5 remnants, the
  review-notes → prompt loop, cross-repo programmes) this one is built first — the spec and rulings
  existed, and the four seams re-measured today were open exactly as the Aug draft described them.
- **Mail addressing (2026-09-08, operator):** the Aug 11 proposal adopted IN FULL — role addressing for
  both roles, a replacement occupant inherits its predecessor's undelivered mail, a programme filter on
  mail, feed and the mail screen. The mechanism is the one the tree already has: resolution at send time,
  and at occupant change the D-1425 act (a fresh delivery row to the heir, the predecessor's row parked)
  generalised by role and funnelled through `bindSession`, the one writer of `runs.sessionId`. Stated
  honestly in the spec: no route re-binds a live run today, so the worker arm is reached only by the
  store test that drives it — the funnel exists so that the day a recovery re-binds a run, the promise
  holds.
- **Dogfood pair (2026-09-08, operator):** custom-tools ↔ data-internal, the pair that was live traffic
  in August; not intake ↔ data-internal, whose dependency is still future.
- **Two corrections from the plan's pre-read, folded into the spec before the plans were written:**
  `NotifyEvent` and `feed_events` carry no `runId`, so the one migration also adds `feed_events.runId`;
  and `coordinator-skill.test.ts` requires every `RunRefuseCode` to be named in the skill corpus the
  moment it exists, so the refusal-list sentence and its wave-lifecycle rows belong to wave 1 — which is
  therefore agent-first as well.
- **The legacy home stays NULL** in the column while the generation lasts (the reviewer's catch): a
  default written into the column would make the later explicit home collide with a guess. The RESPONSE
  defaults; the column tells the truth.
- **`worker` requires a `runId`; `coordinator` keeps its single-active-programme fallback** — two roles,
  two conditions, not folded.

## Carried constraints

- **Wave 2 owns two mechanisms wave 1's review measured and did not build:** (a) a `project-mismatch` at
  dispatch WEDGES the run — re-opening the planned wave without `sessionId` hits `openRun`'s dup arm (keyed
  on program/wave/waveOf/claimedBy/planned, never sessionId), returns the same run still bound, and the hold
  the open placed on the foreign workspace stands; wave 1 fixes the skill's remedy prose (abandon first) and
  wave 2 decides whether a session-less retry clears the binding and releases the hold (a fleet act, so a
  design, not a patch). (b) `reconstruct` rebuilds programmes with `homeProject` NULL, so a lost coord.db
  forgets every home and the next open backfills whatever it is told — wave 1 records it in the drill's
  UNRECOVERABLE census; carrying the home through a rebuild needs an artifact that proves it.
- **`SessionRecord.project` is not on the measured ladder** (found by wave 1, D-2342): `registry.ts`'s
  `project ?? id` over `field()` folds absent and unreadable to one null, so every consumer that DECIDES on
  `record.project` decides on a fold. Wave 1 fixed the one decision it added (the dispatch rung reads the
  field measured at the decision point). The fuller remedy — `project` inside `readRegistryMeasured`, the
  `unmeasured` shape carrying it, every consumer in fleet.ts, watch.ts, lifecycle.ts, divergence.ts,
  routes.ts and store.ts re-read — is its own task under its own ruling, not a later wave of this programme.
- **Main kept moving while correction PR #86 was being revalidated.** Account-pools wave 3 merged as
  `b879510f` (#81) on 2026-09-11, overlapping auth, server composition, shared API and tests; the worker resolved
  its measured conflicts locally in `server/src/server.ts` and `server/test/auth-gate.test.ts` as `33c769c5`.
  Before D-2518 completed, pool-tag parity merged as `79d6d045` (#88), overlapping `ccd/ccd`, `shared/api.ts`,
  `server/src/server.ts` and other account-pool files. Wave 1's worker must integrate exact current main
  semantically, re-stamp ccd's provenance marker over the final combined body, and rerun every full gate before
  a fingerprint can be accepted.
- **The coordinator skill's ten clauses and the worker skill's twelve stay VERBATIM** — every addition is
  an additive paragraph with its own harvest pin (`coordinator-skill.test.ts:92-118`,
  `worker-skill.test.ts:34-71`).
- **`nestFleet.ts` and its five rules do not change.** The marker is computed in the card from the run it
  already has; the home card's abroad line rides an additive prop.
- **`FLEET_PROTO` stays 1.** `RunSummary.homeProject` and `NotifyEvent.runId` are additive with one
  tolerant reader each — `runHomeProject` (`runWords.ts`) and `reviveNotifyEvent` (`shared/api.ts`); the
  offline snapshot persists neither runs nor feed, so `offline.test.ts` pins its key set instead (D-2062).
- **Exactly one migration across the three waves**, in wave 1, both columns.
- **The legacy flip is dated by evidence**, not by the calendar: zero `legacy-home-project` events AND at
  least one run opened over seven consecutive days, both read by the operator on the server box because no
  route exposes `run_events` (D-2066, D-2067). Wave 3 records both numbers either way.
- **Wave 1 is live before wave 2 ships** — the guard exists before the skill tells coordinators to cross.

## Next-wave brief

Wave 1. Plan: `docs/superpowers/plans/2026-09-08-crossrepo-wave1-server.md`, Tasks 1–9, in order — each
refusal code is declared, first emitted and named in the skill in ONE commit (`project-mismatch` in Task 1,
`home-mismatch` in Task 4, D-2054), so no suite is red between commits except `dtbd`, which is red by
design until the numbers are substituted. Execution skill: `superpowers:subagent-driven-development`. Commit on this workspace's own
branch, never a separate feature branch. Interfaces the later waves consume are the spec's cross-wave
names, verbatim: `sessionProject`, `programHome`, `setProgramHome`, `bindSession`, `resolveWorker`,
`requeueAbandonedMail`, `mailForProgram`, `feedEventsForProgram`, `RunSummary.homeProject`,
`NotifyEvent.runId`, `HOME_PROJECT_LEGACY_ACCEPTED` and `homeProjectVerdict`, `MAIL_REBIND_SUPERSEDED_ERROR`,
the run events `legacy-home-project` and
`home-project-backfilled`, the refusals `project-mismatch` and `home-mismatch` with `by`. Deviations
found during execution: `D-TBD-<slug>` with a full entry, then a `deviation-request` mail with the count.
Before `wave-done`: the whole-suite gate in all three packages, `git fetch origin main` then
`deviation-refs`, and the rebase over account-pools wave 3. The wave is AGENT-FIRST.
