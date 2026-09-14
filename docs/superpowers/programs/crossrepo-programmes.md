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
| 2 | Skills + PWA: the coordinator skill's project-specific succession and mandatory-plan/conditional-producer contract, the worker skill's immutable plan read and conditional producer-root read, bounded ask list/answer/release with held-list semantics, safe no-default-id examples and fenced/indented executable-corpus parity, exact generated ask IDs, canonical route IDs, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, and the mail screen's programme grouping and chip; acceptance corrections D-2545, D-2546, D-2653–D-2660, D-2680–D-2687, D-2715–D-2720 and D-2724–D-2731, plus D-2732 taken from account-pools by offer and record-only D-2733. AGENT-FIRST. | #92 | **MERGED 2026-09-14, NOT YET DEPLOYED.** Squashed to `main` as `5480fea8` at 06:15 UTC by the operator (PR #92, head `daceb52e`; `test (server)`, `test (pwa)`, `test (agent)` and `build-pwa` green on that exact sha; `test-macos` red there AND on main's own `ecd953b0` — D-2733, record-only, not this wave's defect). `main`'s tree at `5480fea8` is byte-identical to `daceb52e`'s (`54404ced`), so every gate measured on the branch measured the merged tree. Run 44 advanced `working → awaiting-review → merging` on the server's own re-measurement of `{daceb52e, #92, merged}` and closed `done` with `final:false` (hold handed to run 45, `released:false`); items 10/11 — item 238, Task 9's agent-first deploy, is deliberately left open because the deploy has not run. The fleet host still runs wave 1's `ccrc-api`, `ccrc-worker` and `ccrc-coordinator` (measured: the installed client answers `unknown-query` to `runs list --closed 1`; both installed `SKILL.md` files differ from `5480fea8`'s). The agent lane, then the server lane, ship on the operator's word — not from this coordinator unasked. |
| 3 | Docs + the legacy flip: current README sections, byte-preservation proof for the historical Aug 11 spec, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` as its own commit ONLY when the operator's read of `run_events` and `runs` on the server box shows zero `legacy-home-project` events AND at least one run opened over seven consecutive days (D-2066, D-2067) — else deferred with both numbers recorded. NOT agent-first (D-2069). | — | **OPEN.** Run 45 (`planned`) opened 2026-09-14 06:29:10 UTC on `ccrc-pwa-bright-meadow`; dispatch follows the commit that records this. |

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

- **Wave 2 → 3 boundary (2026-09-14, coordinator):** run 45 opened at 06:29:10 UTC with `sessionId:"ccrc-pwa-bright-meadow"`
  and `homeProject:"ccrc-pwa"`; run 44 closed `final:false` at 06:29:13 UTC, three seconds later, on the MERGED tip
  `daceb52e`, hold handed over (`released:false`). The open-before-close rule was honoured. What was reversed is the
  reference's narrative order — ledger commit, THEN open, THEN close — so that the run's recorded handoff is the content
  that merged rather than an unmerged docs commit. That reversal opened a window, accepted and closed by this commit: a
  fresh coordinator resuming from `GET /api/runs` while the committed ledger still read "Wave 3 remains unopened" would
  have re-opened and re-reviewed. The closed-row proof (`runs list --closed 1`, run 44 `state:"done"`) was taken through
  the merged client at `origin/main:ccd/ccrc-api` copied to scratch, because the installed wave-1 client has no
  `--closed` key — the first thing the undeployed agent lane cost; the coordinator drives `asks list`/`asks release`
  through that same copy until the lane ships.
- **Wave 2 merged, not deployed (2026-09-14, coordinator):** the deploy is an outward act on the live fleet — the agent lane
  restarts the agent and `try-restart`s every supervisor — and is not covered by the standing authorisation to raise the PR;
  it is requested from the operator, not assumed. Until the agent lane ships, the installed skills and client are wave 1's;
  wave 3's worker reads its contracts from the repository at `5480fea8`, and its work (docs, one constant) exercises none of
  wave 2's new client rows.
- **D-2070 (the flip as its own PR) — ruling deferred, deliberately (2026-09-14, coordinator):** decided by the
  coordinator, as the plan's D-2070 entry assigns it, when and only if Task 6 lands — which itself waits on Task 5's
  operator-measured gate. The two arms: cherry-pick the flip commit onto the coordinator's own branch for a separate
  server-lane PR, or let it ride inside the docs PR. The second arm waives spec §3 F2's separation, a scope decision no
  coordinator may make alone, so choosing it means requesting the operator's sign-off at that moment. The choice and its
  reason are recorded here when made. The worker names the flip commit as a distinct handoff item and opens no second PR
  (house rule).
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

The read is an **operator act**: `run_events` is exposed by no HTTP route (measured — every
mention of `run_events` in `server/src/coord/routes.ts` sits inside a code comment, none inside
a route registration or handler body, and `CoordStore.runEvents` has no caller outside
`server/test`). `sqlite3` is not installed on the server box, so the count was taken through
`node:sqlite`'s `DatabaseSync(..., { readOnly: true })` — the same engine the server itself
uses — against `~/.ccrc/coord.db`, and from nowhere else. It prints two integers and no rows.

The single counted event is run 43 (programme `account-pools`, wave 5/6), `causedBy=coordinator`,
at `2026-09-11T12:02:33.805Z` — the **only** `legacy-home-project` event ever recorded (count = 1,
first = last), so the rolling window clears `2026-09-18T12:02:33Z` absent a further legacy open
before then.

**The gate this wave applies:** flip only when `legacy_7d = 0` **and** `opens_7d > 0`. The second
number is not in the spec's sentence and is the reason this block exists: seven days in which
nothing was opened also reports zero legacy events, and that is an absence of traffic, not
evidence that the legacy branch went unused. Measured this wave: `legacy_7d = 1`, so **the gate is
closed** and **the flip defers** — `HOME_PROJECT_LEGACY_ACCEPTED` stays `true`. Task 6 does not
run this wave.

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
- **Wave 2 is merged before wave 3 is dispatched, but its agent lane has NOT shipped** (2026-09-14): the fleet host's
  installed `ccrc-worker`, `ccrc-coordinator` and `ccrc-api` are wave 1's. Wave 3 reads the wave-2 contracts from the
  repository at `5480fea8`; nothing in wave 3 needs a wave-2 client row. The deploy is the operator's or the coordinator's
  act on the operator's word, and item 238 on run 44 stays open until it runs.

## Next-wave brief

Run 45 is OPEN (`planned`, opened 2026-09-14 06:29:10 UTC on `ccrc-pwa-bright-meadow` with `homeProject:"ccrc-pwa"`); run 44
closed `done` at 06:29:13 UTC. Plan: `docs/superpowers/plans/2026-09-08-crossrepo-wave3-docs-flip.md`, Tasks 1–7, in order. Execution skill:
`superpowers:subagent-driven-development`. **Execution base: `5480fea88145bc22439fe01f76dc1e54bc12b4c8`** — `main`'s commit
containing wave 2's merge. The workspace branch already carries it as merge commit `6ed74c8a` (tree-identical to `main`;
merge-base with `origin/main` is `5480fea8`, so the wave-3 PR diffs only wave 3). Fetch `origin/main` and record that sha
before Task 1, as the plan's header says; do not rebase. Commit on this workspace's own branch, never a separate feature
branch. If `origin/main` moves before Task 7, merge it into the branch the way `6ed74c8a` did (`git merge origin/main`),
resolve any conflict semantically, re-run the whole-tree scanners and the three package suites, and name the merged
`main` sha in the wave-done mail. (Coordinator's note: the dispatch is `POST /api/runs/45/dispatch` with this brief and seven
items, one per task.)

**Task 4 is already half done by the commit that records this.** Rows 1 and 2 of `## Waves` are closed here (#75/#86 and
#92); what remains of Task 4 is the `## Dogfood exit criteria` section and its test. Task 4 Step 2's prescribed red cannot
fire as written — "wave 1 names no PR" has been false since wave 1 closed, and row 2 now reads MERGED — so the red to expect
is the exit-criteria anchor failures only; do NOT revert the wave table to manufacture the prescribed count, and do NOT
apply Step 4's row-2 template cell, whose "deployed agent-first" is FALSE: wave 2 is merged and not deployed. The
branch's history still carries wave 2's pre-squash commits (`daceb52e` is a parent of `6ed74c8a` but not an ancestor of
`main`), so the wave-3 PR will LIST them while its diff shows only wave 3 — expected, say so in the PR body; the squash
body is the coordinator's to hand-write. The CI gate before wave-done is the four REQUIRED legs (`test (server)`,
`test (pwa)`, `test (agent)`, `build-pwa`); `test-macos` is non-gating and red on main (D-2733).

Wave 3 consumes the exact wave-2 handoff, including the independently pinned same-project/cross-project
lifecycle; the immutable plan tuple required for every foreign-plan wave; the producer tuple, excerpt and
producer-root read required only for an actual producer-interface dependency; bounded ask operations with
the held-list, no-default-id and fenced/indented corpus guards; current eleven/thirteen skill contracts; the
PWA crossing surfaces; D-2545/D-2546; and acceptance corrections through D-2733. Do not reopen those
decisions. This wave-3 consumer stays in `ccrc-pwa` and has no producer-interface dependency, so
NEITHER conditional tuple applies to it. The immutable-plan tuple (`homeRepoRoot`, `planRepoPath`,
`planSha`) is what a FOREIGN-plan wave carries, and wave 3's plan is in this repository, so its
brief names that plan by its ordinary repository path instead. With no producer interface to
consume, the brief also carries no `producerRepoRoot`, `producerSourceRepoPath`, `producerSha`, or
invented excerpt. The historical 2026-08-11 specification remains
byte-identical to `origin/main`; wave 3 updates current docs that point to it rather than rewriting it.

**Task 5 is an OPERATOR read.** `legacy_7d` and `opens_7d` come from `sqlite3 -readonly ~/.ccrc/coord.db` on the SERVER
box, which the worker cannot reach and must not try to; the worker puts the exact command from Task 5 Step 4 to the operator
as an AskUserQuestion (worker clause 5) and waits for two integers — the command is Task 5 **Step 4**'s `sqlite3 -readonly`
block, or its `node`/`DatabaseSync({ readOnly: true })` fallback if that box has no `sqlite3`. The coordinator will not answer
a measurement it cannot take; it releases the ask through the merged client copy it already holds (the installed wave-1
client has no `asks` group), so the operator's notification fires at once — and if that release does not land, the grace
window fires the operator's own notification on schedule regardless, so the wave is never stuck on it. Both numbers and the date go in `## Measurements` whichever
way the gate goes. Task 6 runs only on `legacy_7d = 0` AND `opens_7d > 0`; otherwise it is deferred with both numbers
recorded rather than inferred from elapsed calendar time (D-2066, D-2067).

**D-2070:** if Task 6 lands, the worker names the flip commit as a distinct handoff item and opens no second PR; the
coordinator decides between its own PR and riding inside the docs PR, the second needing the operator's waiver of spec
§3 F2 (see Decisions).

**The installed skills predate this wave's contracts.** The fleet host runs wave 1's `ccrc-worker`; the contract for this
wave is `ccd/worker-skill/SKILL.md` at `5480fea8` — read it from the repository. Nothing in Tasks 1–7 needs a wave-2 client
row (`asks list`/`answer`/`release`); the installed `~/.local/bin/ccrc-api` is wave 1's: it answers `unknown-query` to a key it
lacks (`--closed` on `runs list`) and `unknown-verb` to a group it lacks (`asks`).

Wave 3 is not agent-first (D-2069): its final diff touches nothing under `ccd/`, `ccd/session-hook.sh` or either skill
directory, verified in Task 7 Step 8 by `git diff --name-only`. The server lane alone ships, only if Task 6 lands; a
deferred flip ships nothing. The worker runs no deploy.
