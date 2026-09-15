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
| 1 | Server + shared: `project-mismatch` at open and at dispatch resume, `home-mismatch`, the one migration (`programs.homeProject`, `feed_events.runId`), `homeProject` at open with the legacy generation, `RunSummary.homeProject`, the `worker` mail role, `bindSession` and the heir re-issue, the programme filters on mail and feed, `ccrc-api` rows, both refusal codes named in the coordinator skill. AGENT-FIRST (the skill sentence ships via the install lane). | #75, #86 | **MERGED AND DEPLOYED 2026-09-11.** Squashed to main as `cbeb682d` at 22:56 UTC by the operator (PR #86, head `e1311026`, all five CI legs green on that exact sha). Deployed AGENT-FIRST: the agent lane reports `ccd cbeb682d (HEAD, built 22:58:32Z)` with every `claude-session@*` supervisor verified active, then the server lane, whose own final gate `/health` answers `{"sha":"cbeb682d...","dirty":false}` at 23:03:09Z. The full correction history — PR #75's premature merge, D-2505..D-2508, the D-2518 slug budget and the acceptance review that closed it — is in this ledger's git history at `d745d11f` and earlier. The D-2545 and D-2546 carries that review assigned to wave 2 are now implemented there, not still open here. |
| 2 | Skills + PWA: the coordinator skill's project-specific succession and mandatory-plan/conditional-producer contract, the worker skill's immutable plan read and conditional producer-root read, bounded ask list/answer/release with held-list semantics, safe no-default-id examples and fenced/indented executable-corpus parity, exact generated ask IDs, canonical route IDs, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, and the mail screen's programme grouping and chip; acceptance corrections D-2545, D-2546, D-2653–D-2660, D-2680–D-2687, D-2715–D-2720 and D-2724–D-2731, plus D-2732 taken from account-pools by offer and record-only D-2733. AGENT-FIRST. | #92 | **MERGED 2026-09-14, DEPLOYED BOTH LANES THE SAME DAY** (agent 11:51:42Z, server 11:58:46Z, as part of `main` at `bb8cc111`, which contains `5480fea8`; run 44's deploy item 238 settled). Squashed to `main` as `5480fea8` at 06:15 UTC by the operator (PR #92, head `daceb52e`; `test (server)`, `test (pwa)`, `test (agent)` and `build-pwa` green on that exact sha; `test-macos` red there AND on main's own `ecd953b0` — D-2733, record-only, not this wave's defect). `main`'s tree at `5480fea8` is byte-identical to `daceb52e`'s (`54404ced`), so every gate measured on the branch measured the merged tree. Run 44 advanced `working → awaiting-review → merging` on the server's own re-measurement of `{daceb52e, #92, merged}` and closed `done` with `final:false` (hold handed to run 45, `released:false`); items 11/11 — item 238, Task 9's agent-first deploy, was deliberately left open for most of wave 3 because the deploy had not run (measured then: the installed client answered `unknown-query` to `runs list --closed 1`; both installed `SKILL.md` files differed from `5480fea8`'s), and it is settled now: the agent lane shipped 11:51:42Z and the server lane 11:58:46Z on 2026-09-14, both at `bb8cc111`, on the operator's word — not from this coordinator unasked. Re-measured from the fleet host by wave 3's worker: `ccd version` answers `bb8cc111…` built `2026-09-14T11:51:42Z`, `ccd` and `ccrc-api` both stamped 11:51, and the installed client carries wave 2's `asks list` and `runs list --closed` verbs. |
| 3 | Docs + the legacy flip: current README sections, byte-preservation proof for the historical Aug 11 spec, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` as its own commit ONLY when the operator's read of `run_events` and `runs` on the server box shows zero `legacy-home-project` events AND at least one run opened over seven consecutive days (D-2066, D-2067) — else deferred with both numbers recorded. NOT agent-first (D-2069). | — | worker branch `ws/bright-meadow`; flip deferred — legacy_7d = 1, opens_7d = 11 on 2026-09-14; PR number and merged sha are recorded by the boundary commit of the wave that carries the flip |

## Dogfood exit criteria

The dogfood programme runs as its **own** programme once wave 2 is live: home `custom-tools`, wave 1
there, wave 2 in `data-internal` on real work the operator names, **opened without `sessionId`** — the
path that spawns fresh in the target repo, which is the only path a crossing may take. Its exit
criteria are the current build spec's §9 acceptance list with D-2684/D-2687 and D-2715/D-2716's
provenance corrections, and this ledger is where they are measured:

- the wave-2 brief carries `homeRepoRoot`, `planRepoPath`, and `planSha`, and the worker reads that exact plan blob as the requirements authority
- because this consumer depends on wave 1's producer interface, the same brief also carries `producerRepoRoot`, `producerSourceRepoPath`, the exact full merged `producerSha`, and the inline excerpt; the worker reads that immutable producer source blob with exactly `git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`, so the producer source blob proves provenance while the inline excerpt remains the dispatched interface-shape authority; a foreign-plan wave with no producer-interface dependency carries no producer tuple and no invented excerpt
- before consumer dispatch, the coordinator verifies the exact closed producer row is `done`, independently proves the producer PR merged, and proves the selected PR head equals that same `producerSha`; `done` alone is not merge proof
- the board shows the crossing on the wave-2 row and the abroad line on the home card
- the ledger's wave table records both PRs across two repos
- no content moved by copy-paste
- `project-mismatch` never fires in anger — its proof is a test, not an incident

The last one is a claim about an ABSENCE and is therefore only as strong as the traffic behind it: it
is satisfied by a dogfood that actually dispatched both waves, and by nothing else. Record the run ids
beside it when the programme closes.

## Decisions & deviations

- **Opened without waiting for account-pools (2026-09-09, operator):** the run board's Start door refuses a
  project with an open run, and its copy names the single-active-programme fallback as the reason. Measured
  before opening: that fallback is fleet-wide and was already ambiguous with two live programmes, so the
  refusal guarded nothing here. D-2686 later corrected this entry's cap claim: concurrency counts dispatched
  non-terminal runs, not held workspaces; a planned undispatched run takes no running-worker slot, while each
  actual dispatch still consumes daily budget.
- **Order (2026-09-08, operator):** of the three genuinely open roadmap items (Build 5 remnants, the
  review-notes → prompt loop, cross-repo programmes) this one is built first — the spec and rulings
  existed, and the four seams re-measured today were open exactly as the Aug draft described them.
- **Mail addressing (2026-09-08, operator):** the Aug 11 proposal adopted IN FULL — role addressing for
  both roles, a replacement occupant inherits its predecessor's outstanding mail (corrected, D-2747 — not
  "undelivered": a delivered-but-unacked row is outstanding too), a programme filter on
  mail, feed and the mail screen. The mechanism is the one the tree already has: resolution at send time,
  and at occupant change the D-1425 act (a fresh delivery row to the heir, the predecessor's row parked)
  generalised by role and funnelled through `bindSession`, the one writer that RE-binds `runs.sessionId`
  (corrected, D-2753 — and corrected again in fix round 6: the second writer is `reconstruct`'s fresh-row
  `INSERT INTO runs (… sessionId …)`, NOT the open's insert, whose column list carries no `sessionId` at all;
  the open route binds through `setSession` → `bindSession`'s UPDATE, so `bindSession`'s uniqueness claim is
  about RE-binding, exactly as its own docstring says). The spec's "no route re-binds a live run today" is
  superseded by that same docstring ("MEASURED, NOT ASSUMED: a route DOES re-bind a live run today"): the open
  route re-binds through `setSession` whenever the request names a `sessionId` and its hold succeeded, so the
  worker arm is reached by a live path and not only by the store test — the funnel exists so that the day a
  recovery re-binds a run, the promise holds.
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

- **Wave 2 → 3 boundary (2026-09-14, coordinator):** run 45 opened at 06:29:10 UTC with `sessionId:"ccrc-pwa-bright-meadow"`
  and `homeProject:"ccrc-pwa"`; run 44 closed `final:false` at 06:29:13 UTC, three seconds later, on the MERGED tip
  `daceb52e`, hold handed over (`released:false`). The open-before-close rule was honoured. What was reversed is the
  reference's narrative order — ledger commit, THEN open, THEN close — so that the run's recorded handoff is the content
  that merged rather than an unmerged docs commit. That reversal opened a window, accepted and closed by this commit: a
  fresh coordinator resuming from `GET /api/runs` while the committed ledger still read "Wave 3 remains unopened" would
  have re-opened and re-reviewed. The closed-row proof (`runs list --closed 1`, run 44 `state:"done"`) was taken through
  the merged client at `origin/main:ccd/ccrc-api` copied to scratch, because the installed wave-1 client has no
  `--closed` key — the first thing the undeployed agent lane cost; the coordinator drove `asks list`/`asks release`
  through that same copy until the lane shipped at 11:51:42Z.
- **Wave 2 merged, then deployed the same day (2026-09-14, coordinator) — the decision below is why it was asked for rather than assumed, and it was discharged at 11:51:42Z (agent) and 11:58:46Z (server):** the deploy is an outward act on the live fleet — the agent lane
  restarts the agent and `try-restart`s every supervisor — and is not covered by the standing authorisation to raise the PR;
  it is requested from the operator, not assumed. Until the agent lane shipped, the installed skills and client were wave 1's;
  wave 3's worker reads its contracts from the repository at `5480fea8`, and its work (docs, one constant) exercises none of
  wave 2's new client rows.
- **D-2070 (the flip as its own PR) — ruling deferred, deliberately (2026-09-14, coordinator):** decided by the
  coordinator, as the plan's D-2070 entry assigns it, when and only if Task 6 lands — which itself waits on Task 5's
  operator-measured gate. The two arms: cherry-pick the flip commit onto the coordinator's own branch for a separate
  server-lane PR, or let it ride inside the docs PR. The second arm waives spec §3 F2's separation, a scope decision no
  coordinator may make alone, so choosing it means requesting the operator's sign-off at that moment. The choice and its
  reason are recorded here when made. The worker names the flip commit as a distinct handoff item and opens no second PR
  (house rule). **Update (2026-09-14, Task 7):** Task 5's gate closed (`legacy_7d = 1`, `opens_7d = 11`)
  and Task 6 was skipped whole, so this ruling is deferred WITH the flip — nobody hunts here for a
  decision this wave did not need to make.
- **Wave 2's two execution-time findings outside its plan's scope:** D-2732, taken from account-pools by offer and FIXED
  in wave 2 — both scanners' ledger-base chain fell through to a fossil local `main`, silently; fixed by dropping the
  `'main'` candidate from BOTH chains and correcting both refusal messages, and `deviation-refs` additionally prints
  the resolved base and asserts `origin/main` is an ancestor of it (the `is-ancestor <base> HEAD` direction was
  considered and rejected as inert and hostile). D-2733, RECORD-ONLY and not fixed —
  `test-macos` red on main, two defects separated by their durations; and `server/vitest.config.ts`'s "failing a genuinely
  hung child in well under a minute" is false for every synchronous spawn, where `testTimeout` is a post-hoc label
  (measured three ways). The config sentence is flagged to the operator for whoever owns the suite.

## Measurements

**The legacy-generation flip criterion (spec §3 F2), taken 2026-09-14 on the server box.**
`legacy_7d = 1` — `run_events` rows whose `detail` begins `legacy-home-project`, in the rolling
seven-day window. `opens_7d = 11` — runs opened in the same window, independently confirmed by
the coordinator from the runs route.

The read is an **operator act**: `run_events` is exposed by no HTTP route. Measured line by
line in `server/src/coord/routes.ts`: three mentions, all comments — `:261` inside the JSDoc
block documenting the `HOME_PROJECT_LEGACY_ACCEPTED` constant (`:269`); `:1240` inside the
runs-open handler body; `:1788` inside the `app.post('/api/coord/caps')` handler body, whose
registration opens at `:1744` and closes at `:1832`, the next registration being `/api/runs`
at `:1883`. `runEvents` appears nowhere in the file, and `CoordStore.runEvents`
(`server/src/coord/store.ts:2066`) has no caller outside `server/test`. Eleven
`app.get('/api…')` registrations exist, the eleventh being `/api/asks`, none reading the
trail. `sqlite3` is not installed on the server box, so the legacy count was taken through
`node:sqlite`'s `DatabaseSync(..., { readOnly: true })` — the same engine the server itself
uses — against `~/.ccrc/coord.db`, and from nowhere else. It prints two integers and no rows.

The single counted event **at the time of this read** is run 43 (programme `account-pools`, wave 5/6),
`causedBy=coordinator`, at `2026-09-11T12:02:33.805Z` — the only `legacy-home-project` event this read
counted (count = 1, first = last, at read time), so this read projected the rolling window clearing
`2026-09-18T12:02:33Z` absent a further legacy open before then. **That projection is now stale**: a
second legacy-shaped open landed at `2026-09-14T11:34:24Z` (run 47, `account-pools` wave 6/6, opened by
the peer coordinator with no `homeProject` in the body — the same shape as run 43), measured from the
runs list (`homeProject` null on run 47, read 11:39 UTC) rather than from `run_events`, which no route
serves; that second open moved the clock — see Carried constraints for the corrected clearing rule.

**The gate this wave applies:** flip only when `legacy_7d` is zero **and** `opens_7d` is
above zero — the spec's own criterion (§3 F2), which already states both numbers and cites
D-2067 for the second; this block adds the **measurement** against that criterion, with its
date and its instrument, not the requirement itself (D-2751, D-2752). Seven days in which
nothing was opened also reports zero legacy events, and that is an absence of traffic, not
evidence that the legacy branch went unused. Measured this wave: the count above is nonzero,
so **the gate is closed** and **the flip defers** — `HOME_PROJECT_LEGACY_ACCEPTED` stays
`true`; the `HOME_PROJECT_LEGACY_ACCEPTED → false` commit does not ship this wave.

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
- **The coordinator skill's eleven clauses and the worker skill's thirteen stay VERBATIM** — every addition is
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
- **Wave 2 is merged before wave 3 is dispatched, and its agent lane shipped while wave 3 was closing** (2026-09-14,
  agent 11:51:42Z, server 11:58:46Z, both at `bb8cc111`): for most of wave 3 the fleet host's installed `ccrc-worker`,
  `ccrc-coordinator` and `ccrc-api` were wave 1's, so wave 3 read the wave-2 contracts from the repository at
  `5480fea8` and needed no wave-2 client row. The deploy was the operator's act on the operator's word; item 238 on
  run 44 is settled.
- **E1. The flip's gate could not clear until wave 2's agent lane was deployed — a dependency that was never a
  prediction, because it bit twice in three days, and that was DISCHARGED on 2026-09-14 at 11:51:42Z (fleet host)
  and 11:58:46Z (server box), both at `bb8cc111`:** while the fleet ran wave 1's coordinator skill and client, every RUN
  opened with no `homeProject` in the body writes another `legacy-home-project` event and resets the seven-day
  clock, regardless of whether the programme itself is new (`homeProjectVerdict` decides an absent body by
  `legacyAccepted` alone, not by whether the programme already has a stored home) — run 43
  (`2026-09-11T12:02:33Z`) and run 47 (`2026-09-14T11:34:24Z`, `account-pools` wave 6/6, measured from the runs
  list, not `run_events`) are both that shape. The rule is therefore not "clears on the 18th" but **clears seven
  days after the LAST open that omitted `homeProject`** — and the deploy is what makes that date knowable at all.
  Measured now: the installed coordinator skill reached the fleet host at 11:51:42Z, seventeen minutes AFTER the
  last wave-1-client open (run 47, 11:34:24Z), **so the window clears at `2026-09-21T11:34:24Z` provided no open
  after 11:51Z omits `homeProject`.** The installed skill now sends it; a coordinator session that loaded the old
  skill before 11:51Z must still add it by hand, and the `account-pools` coordinator has committed to that — a
  commitment, not a mechanism, which is why the date is a floor and not a guarantee. Then re-take the read — on
  the SERVER box, via the node fallback, never on the fleet box's stub.
- **OPEN ITEM (no deviation number) — terminal-programme home backfill:** `setProgramHome`'s fill-only `UPDATE programs
  SET homeProject = ? WHERE slug = ? AND homeProject IS NULL` runs only from the open route's backfill branch, so the
  ACTIVE legacy programmes self-heal on their next open and need nothing, while the TERMINAL ones — **five today (the
  four `done` plus the one `abandoned`), with `account-pools` → `ccrc-pwa` joining as the sixth when its wave 6 closes**,
  because run 47 is its LAST run and the self-healing arm therefore never fires for it — will never open again and stay
  `NULL` forever: `build4` → `ccrc-pwa`, `program-leverage` → `ccrc-pwa`, `registry-durability` →
  `ccrc-pwa`, `promise-backfill` → `expoAI-assistant`, `claude-tooling-consolidation` → `custom-tools`. Measured
  2026-09-14: 10 programmes, 1 with a home, 9 `NULL`, and every one of the nine has run in exactly one project — zero
  ambiguous cases. Backfilling them needs a new write surface or a direct server-box write, a scope decision for a
  later wave. The per-run remedy was offered and declined on 2026-09-14: abandoning run 47 and re-opening it with a
  `homeProject` would heal `account-pools` alone at the cost of a `failed` row for a run that did nothing, and the
  legacy event of 11:34:24Z stays written either way — so the write surface is the only fix for all six.
- **OPEN ITEM (no deviation number) — README states the programme-mail facts twice.** The pair the number
  measures is the heir sentence "When a run's session is replaced" and the "Programme mail at scale." heading:
  **287 lines apart at `4172d55a`**, and README is unchanged between them since. Other anchor pairs in these two
  regions give other numbers (294, 281), so the pair has to be named or the number means nothing; D-2747 carries
  the measured chain:
  `README.md`'s cross-repo subsection ("Mail finds a role, not a session." / "Finding a programme's traffic.") and
  its "Programme mail at scale." paragraph restate the same heir-inheritance and outstanding-read facts, and this
  fix round's D-2753 (MAJOR 1, MAJOR 3) each had to correct both copies separately — the duplication is why two of
  this wave's false claims each cost two edits instead of one. Consolidating the two into one canonical passage
  with a cross-reference belongs to whoever next edits that section, not this fix round.

## Next-wave brief

None — the programme's three waves are closed. What remains is a programme of its own, not a wave of
this one: the **dogfood**, homed in `custom-tools` with its wave 2 in `data-internal`, measured against
the dogfood exit-criteria section above. Whoever opens it opens a NEW programme with its own ledger, its
own slug and its own coordinator; this ledger is closed and is read, not written.

If the flip was deferred, the one carried item is the flip itself: re-take the measurements read, and
when `legacy_7d = 0` with `opens_7d > 0`, change `HOME_PROJECT_LEGACY_ACCEPTED` to `false` in
`server/src/coord/routes.ts` and ship it as its own server-lane PR. The suite that will hold it shut,
`server/test/home-project-required.test.ts`, does not exist yet — it ships written red-first inside
the flip's own PR and goes green in that same PR when the constant moves, then holds the constant
shut thereafter; it does not make the deferral visible on `main`. The deferral's visibility comes
from this ledger's `## Measurements` block and the wave-3 row, not from a red suite.

Two test forms are pre-approved (coordinator ruling, mail 1111) so the flip wave does not re-derive
them: the run-count assertion is `okRuns(w.coord.runs({ includeClosed: true })).length` (D-2743), and
the required-`homeProject` refusal body assertion is the `toEqual` carrying
`detail: 'homeProject is required'` (D-2744). D-2070 — whether the flip commit rides this wave's own
PR or gets cherry-picked onto its own — is decided then, not here.

The wave-2 agent-lane deploy the flip's gate depended on landed 2026-09-14; the window it restarted clears no earlier than 2026-09-21T11:34:24Z — see Carried constraints (E1).
