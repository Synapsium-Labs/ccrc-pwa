# Cross-repo programmes — the build spec: a programme has a home, its waves work anywhere, its mail finds its role

**Status:** design approved in dialogue 2026-09-08 (operator: cross-repo first of the three open
roadmap items; the Aug 11 mail proposal adopted in full; dogfood pair custom-tools ↔ data-internal).
Written for the plan; every file:line below was measured against `main` at `d0064e6e` on
2026-09-08 by three read-only scouts, not carried over from the earlier draft. Plan-time deviations
D-2054–D-2070 (the three wave plans' `## Deviations found`) were ratified the same day and are folded
in below where they change a sentence.

**Supersedes for building purposes, inherits for rulings:**
`docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md` — the Aug 11 design, whose
operator rulings stand verbatim (§1 below) and whose seam analysis was measured against a `main` that
is a month and nine programmes behind. Where that draft and this one disagree on a line number, this
one is right; where they disagree on a rule, the ruling in the older file wins and this file says so.

**Inherits, unchanged:** Build 7's fleet-coordination design
(`docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md`) — nouns, storage rules,
non-goals — and Build 2.5's programme/ledger discipline
(`docs/superpowers/specs/2026-08-06-workspace-hold-programs-design.md`).

---

## 1. The rulings this build implements (2026-08-11, verbatim in effect)

1. **Home-project programmes with cross-repo waves — NO new cross-repo-project noun.** A programme
   is initiated in one project; its ledger, spec, plan and coordinator live there. Its waves may
   dispatch runs into any project.
2. **Enable the two fully:** (1) waves dispatching runs into any project, with every single-project
   seam verified and closed; (2) cross-repo mail made easily discoverable.
3. **Foreign-repo workers read the home repo's plan by ABSOLUTE PATH** — one box, one user, an
   assumption this spec records rather than hides (§3 F3, §6).
4. **Q1 — cross-run dependency edge: DISCIPLINE, not schema.** The coordinator skill gains the rule
   "before dispatching a consumer wave, read the producer run's state; not `done` → do not
   dispatch". No `dependsOn` column until a measured incident of the phased-cutover class justifies
   one.
5. **Q2 — `homeProject`: EXPLICIT AND REQUIRED, soon.** Not inferred from wave 1. Accepted-and-logged
   as legacy when absent for one deploy generation, then required on the first wave's open and stored
   on the programme row.
6. **Mail addressing at programme scale — adopted in full on 2026-09-08** (it was a proposal in the
   Aug draft): role addressing for both roles, a replacement occupant inherits its predecessor's
   undelivered mail, a programme filter on the mail list, the feed and the mail screen, and the
   `runId` discipline stated in the skills.

---

## 2. What already works, measured on today's `main`

The run row already carries its own project (`runs.project TEXT NOT NULL`,
`server/src/coord/schema.ts:79`), and most of the machinery reads it:

| seam | reads the RUN's project? | where |
|---|---|---|
| fresh spawn at dispatch (`ccd ws-add`) | yes | `server/src/coord/dispatch.ts:326` — `CCD_ARGV.wsAddWorker(run.project, …)` |
| done-fingerprint re-measure (advance) | yes | `server/src/coord/fingerprint.ts:209` — `readBranchTip(io, projectsRoot, run.project, branch)` |
| close re-measure | yes | `server/src/coord/close.ts:240` |
| archive-after-merge sweep | yes, per workspace | `server/src/watch.ts:3075` (`archiveMerged`); the project list is derived at `:2920` and PR state is read per project at `:2924` |
| fleet board grouping | yes | `pwa/src/screens/FleetScreen.tsx:491` — `activeRuns.filter((r) => r.project === g.project)` |
| caps | global by design, one row | `server/src/coord/store.ts:1882`; `POST /api/coord/caps` takes no project (`routes.ts:1383-1469`) |
| hold reason | names programme, wave and run id, no project, display-only | `server/src/coord/rundefs.ts:92-93`; `ccdargv.ts:297` |

None of these change. The seams that do are the four the Aug draft named, plus the mail lane.

---

## 3. The seams to close

### F1 — the session-reuse path never checks the project. Fix: one typed refusal, two sites.

**Measured.** `POST /api/runs` validates `project` as a non-empty string
(`server/src/coord/routes.ts:936-945`) and, when `sessionId` is given, stamps it onto the new row
(`routes.ts:964`, `coord.setSession`) without ever asking which project that session's workspace was
created in. The dispatch resume arm finds the registry record for the reused session
(`server/src/coord/dispatch.ts:486`) and reads its workspace, branch and wrapper (`:490-495`) — never
`record.project`. A coordinator following the skill's own "same `sessionId`, same workspace" idiom
(`ccd/coordinator-skill/SKILL.md:284`) while moving a wave to another project is refused by nothing;
the brief is queued onto a workspace bound to the wrong repo, and the mismatch surfaces one advance
later as a `tip-unmeasurable` naming a branch and a project the coordinator did not expect
(`fingerprint.ts:211-212`).

**Design.**

- **New refusal code `project-mismatch`** in `RunRefuseCode` and `RUN_REFUSE_CODE_MAP`
  (`shared/api.ts:3787-3798` — the map at `:3792` is what makes a missing member a compile error), in
  `DispatchOutcome`'s `Extract<…>` list (`server/src/coord/dispatch.ts:112`), and in
  `sendDispatchOutcome`'s status map (`routes.ts:106`, the switch at `:126-160`) as **409**. The body
  is `{ok:false, refused:'project-mismatch', by:'<the project the session belongs to>'}`: the open
  route's `openRun` refusal already carries a string `by` (`routes.ts:955`), but the dispatch
  adapter's `refused` arm spreads only numeric fields (`routes.ts:141-147`), so `DispatchOutcome`'s
  refused member gains `by?: string` and the arm passes it through — pinned, since an adapter may not
  narrow a distinction it received. `by` names the measured project so the coordinator's report can
  say which repo the session is bound to. Each code is declared beside its FIRST emitter —
  `project-mismatch` with the open check, `home-mismatch` with the home decision (F2) — because
  `mail-routes.test.ts:421-431`'s forward scan reds a declared code that nothing emits (D-2054).
- **At open**, immediately after body validation and BEFORE `coord.openRun` (so a refusal leaves no
  `planned` orphan): when `sessionId` is present, `coord.sessionProject(sessionId)` — one new
  read-only store method, `SELECT project FROM runs WHERE sessionId = ? ORDER BY id LIMIT 1` — and if
  it answers a project other than the body's, refuse. A null answer — a session never named by any
  run, which is every wave-1 open that adopts an operator-made workspace — refuses nothing: absence
  permits, and the registry backstop below is the only other rung. This is the coordinator's own idiom
  caught by the coordinator's own history; no I/O beyond the database.
- **At dispatch resume**, immediately after `record` is found and its identity measured
  (`dispatch.ts:486-489`) and BEFORE the hold, the `/clear` and `markDispatched`: if
  `record !== undefined && record.project !== run.project`, refuse. `SessionRecord.project` already
  exists on the registry read. An undefined record on a listable registry stays tolerated exactly as
  today (the honest-stale case); an unmeasurable registry still answers `registry-unmeasurable`.
  Refusing on a fact not measured would be the same error in the other direction.

**Pinned by:** the refusal table tests that already enumerate `RUN_REFUSE_CODES` in both directions
(`server/test/mail-routes.test.ts:421-431`, forward and reverse; `server/test/coordinator-skill.test.ts:305,342-345`;
`server/test/resume-reclaim-l0.test.ts:101` for non-membership), extended with the new member; one route test per site measured red when the check is deleted; a `DispatchOutcome`
exhaustiveness compile error if the union forgets it.

### F2 — the ledger path cannot say which repo. Fix: the home project, explicit, on the programme row.

**Measured.** `programs` has `slug, title, createdAt, state` and nothing else
(`schema.ts:66-72`). The open route's response carries a relative `ledgerPath` only, and the
coordinator is placed by account, never by project, so "the project's own repo" is true by accident
whenever every wave shares one project.

**Design.**

- **Migration N+1**, forward-only, its own entry in `MIGRATIONS` (`schema.ts:63`; the version is
  `MIGRATIONS.length`, `:794`): `ALTER TABLE programs ADD COLUMN homeProject TEXT` — nullable,
  because an older row lacked it, the exact shape Build 7 §2 sanctions. Proven by `coord-db.test.ts`'s
  existing idiom: open a database at version N, boot, read the column.
- **`POST /api/runs` accepts `homeProject`** (a non-empty string when present). `openRun` writes it on
  the programme row's first insert. On a later open of the same programme: a NULL stored home is
  backfilled from the body (first writer wins, recorded as a run event `home-project-backfilled`); a
  stored home that differs from the body's is refused **`home-mismatch`** (409, `by:` the stored
  value) — a second code, not `project-mismatch`, because the two conditions are handled differently
  by the caller and a seam may not collapse them.
- **The legacy generation — the column stays honest.** For one deploy generation an absent
  `homeProject` is accepted and recorded as a run event `legacy-home-project`; the programme row's
  home stays **NULL** — nothing is guessed into the column, so a later explicit home backfills it
  rather than colliding with a default. The RESPONSE defaults: `ledgerRepo` and `ledgerAbsPath` are
  null for a NULL home, and the coordinator keeps the relative `ledgerPath` it has today. The DECISION
  is a pure exported function, `homeProjectVerdict`, taking `legacyAccepted` as a parameter beside
  `known` (a programme row exists) and `stored` (its home, NULL or not) — so a test drives both
  branches for real, and "no row" and "NULL home" never meet at one value (D-2055, D-2056); the route
  passes `HOME_PROJECT_LEGACY_ACCEPTED` (`routes.ts`) at its one call site, so the flip to required is
  still a one-constant change. The flip ships as its own COMMIT, named in wave 3's handoff for the
  coordinator to carry or cherry-pick — a worker opens no second PR (D-2070) — when the operator's own
  read of `run_events` and `runs` on the server box (no route exposes the event trail, D-2066) shows
  zero `legacy-home-project` events AND at least one run opened over seven consecutive days: an
  absence is evidence only in proportion to the traffic behind it (D-2067). The idiom is the box
  token's own: accepted-and-warned as `'legacy'` for one generation
  (`server/src/coord/token.ts:207,220-222`, `server/src/server.ts:1296-1298`), then removed.
- **The open response** keeps `ledgerPath` unchanged and gains `ledgerRepo: string | null` (the home
  project) and `ledgerAbsPath: string | null`
  (`<projectsRoot>/<home>/docs/superpowers/programs/<slug>.md`, from `cfg.projectsRoot`,
  `server/src/config.ts:20`, server-side only, the same root `fingerprint.ts:209` reads). Both are null while the stored home is null — never derived from the
  registry or the claimant (rejected in the Aug draft, still rejected: a fact the programme carries
  forever must not depend on a live read that can degrade).
- **`RunSummary` gains `homeProject: string | null`** (`shared/api.ts`, additive, one tolerant reader),
  because the board needs to know whether a run is a crossing (§5).
- **`ccrc-api` needs no change for the body** — `runs open` sends the JSON body through `--json`
  (`ccd/ccrc-api:261-263`), so the field rides along.

### F3 — the skills learn the project boundary.

**Measured.** `ccd/coordinator-skill/SKILL.md:226` and `:284` and
`references/wave-lifecycle.md:24-27,468` present "same `sessionId`, same workspace" as the wave ≥ 2
default with no project condition. `ccd/worker-skill/SKILL.md:11,66` say only "the plan file the brief
names"; `:67` (clause 7) states the absolute-path rule for mail artifacts and nothing about plans. Both skills'
clauses are pinned verbatim (`server/test/coordinator-skill.test.ts:92-118`, ten clauses;
`server/test/worker-skill.test.ts:34-71`, twelve), so every sentence below changes in the same commit
as its pin.

**Design — coordinator skill:**

- Reuse `sessionId` ONLY when the next wave stays in the same project. A wave that changes project
  opens WITHOUT `sessionId` and spawns fresh in the target repo — the path that already works
  (`dispatch.ts:326`). Consequence stated in the same paragraph: the programme now holds two live
  workspaces, both counted by the global caps — two concurrency slots and two of the daily budget;
  `cap-concurrency` or `cap-daily` during a cross-repo programme is this, not a bug.
- Every `POST /api/runs` carries `homeProject`. (During the legacy generation the server tolerates its
  absence; the skill never omits it.)
- A brief for a foreign-repo wave cites the home repo's plan by ABSOLUTE PATH at a named sha
  (`ledgerAbsPath`'s directory, the plan beside it) and INLINES the contract excerpt the wave depends
  on, verbatim from the merged file — the worker never reads the home plan to discover its contract,
  only to read its context. Paths, not payloads; 8 KB stands.
- Q1's discipline sentence: before dispatching a consumer wave, `GET /api/runs` and read the producer
  run's state; anything but `done` → do not dispatch, report.
- The refusal-list sentence in the skill names `project-mismatch` and `home-mismatch`, and
  `references/wave-lifecycle.md` explains both — in WAVE 1, not here, because the skill test requires
  every `RunRefuseCode` to be named in the skill corpus the moment it exists
  (`server/test/coordinator-skill.test.ts:336-345`); which is why wave 1's deploy is agent-first
  too (§8, §9).
- Deviations found during a foreign-repo wave are minted against the HOME project
  (`ccrc-api ledger allocate` with the home project name) and defined in the home plan, because that
  is where the plan lives. The allocate route takes `project` from the caller
  (`routes.ts:2130-2131`) and cannot cross-check it; this is discipline, stated.
- Programme mail: address the worker as `toId: 'worker'` with the `runId`; address the coordinator as
  today. A `worker` mail without a `runId` refuses `unknown-recipient`; a `coordinator` mail without
  one keeps today's fallback to the single active programme (`store.ts:2105-2111`) and fails shut the
  moment two are active — so carry the `runId` always, and say so, so a worker never meets the
  refusal.

**Design — worker skill:**

- The plan the brief names may live in ANOTHER repository. Read it by the absolute path the brief
  gives; never write to it; commit only on this workspace's own branch in this repository.
- Address the coordinator as `toId: 'coordinator'` with this run's `runId` — unchanged — and note that a
  reply from the coordinator may arrive addressed to the ROLE `worker`, which resolves to this session.

**Ships via** the four-homes install lane (`ccd/install-coordinator-skill.sh`,
`ccd/install-worker-skill.sh`), AGENT-FIRST like every `ccd/` change; a skill reaches a home only once
its installer has run there, so the F1 guard lands BEFORE the skill starts telling coordinators to
cross repos (§9 ordering).

### F4 — the board says which repo.

**Measured.** `RunSummary.project` is on the wire and never rendered: the runs screen row shows
`run.workspace ?? run.branch ?? String(run.id)` (`pwa/src/screens/RunsScreen.tsx:176`). The fleet
board groups runs by the run's own project (`FleetScreen.tsx:491`) and hands them to `nestFleet`
(`pwa/src/fleet/ProjectCard.tsx:184`), whose rule 3 (`pwa/src/fleet/nestFleet.ts`, "an orphan is never
bracketed") leaves a worker whose coordinator sits on another project's card at depth 0 with no
explanation — correct, and silent.

**Design.**

- **Runs screen:** every row gains a project badge (`run-project`); a row whose `project` differs from
  its programme's `homeProject` gains a crossing marker beside it (glyph plus the word, the board's
  two-cue rule: nothing is read out by colour alone). While `homeProject` is null the marker never
  shows — absence permits. The wave label (`wave n/N`) is spelled once, `waveLabel` in
  `runWords.ts`, for the two new sites and the runs screen (D-2063).
- **Fleet board, the worker's card:** the worker stays on its own project's card, because a card is a
  project's sessions and a session's workspace lives in one repo. Its row — the rule-3 orphan —
  carries the marker text: programme slug and wave of waveOf, with "· home <project>" appended only
  when a home was measured and differs from the card's own project — never `home undefined` during
  the legacy generation (D-2064). `nestFleet` stays pure and its five rules unchanged; the marker is
  computed in the card from the run it already has.
- **Fleet board, the home card:** the programme line gains one sentence per wave abroad
  ("wave 2 in data-internal"). `FleetScreen` already filters runs per card by `run.project`; it passes
  a second, additive list — runs whose `homeProject` is this card's project and whose `project` is
  not — so the home card can say it without the tree changing.
- **Pinned by:** `nestFleet.test.ts` unchanged (the tree does not change), one runs-screen test for the
  badge and one for the marker's null-home silence, one card test for the abroad line.

---

## 4. Mail at programme scale — the full proposal, on the mechanism the tree already has

**Measured.** `mail.toId` is `'coordinator' | a session id` (`schema.ts:126`); the send route
resolves the role AT SEND TIME (`routes.ts:612-620`, `coord.resolveCoordinator(runId)`,
`store.ts:2099-2112`) and mints one delivery to the resolved session (`routes.ts:670`,
`store.ts:2328`). The rendered envelope names its recipient (`server/src/coord/envelope.ts:64`,
`to: ${m.toId}`) and is stored at queue time to be replayed verbatim (`schema.ts:142-145`). When a
coordinator is reclaimed, outstanding coordinator-role deliveries are re-pointed
(`store.ts:847-855`, `repointCoordinatorMail`) and a report the lane had already given up on is
delivered to the heir as a NEW row, freshly rendered (D-1425, `requeueAbandonedCoordinatorMail`,
`store.ts:1013`, called from the reclaim at `:744`; its docstring at `:624-660`) — precisely
because the old envelope names the corpse and a replay may not be re-rendered. `GET /api/mail`
requires `to` (`routes.ts:836-849`); `GET /api/feed` takes `limit` only (`routes.ts:1610-1614`); the
mail screen renders the feed and nothing filters either by programme.

**Design.**

- **`'worker'` joins `'coordinator'` as a role recipient.** The send route's recipient-shape check
  (`routes.ts:589-596`) admits the literal; resolution is `coord.resolveWorker(runId)` = that run's
  `sessionId`, null when the run has no worker yet → the same `unknown-recipient` refusal the
  coordinator role answers today, with a detail that says "run N has no worker". `worker` requires
  `runId` (a worker is per run; there is nothing to fall back to); `coordinator` keeps its
  single-active-programme fallback unchanged. Raw session-id addressing stays for ad-hoc mail.
- **Resolution stays at send time — the promise is kept at occupant change, through one funnel.**
  `runs.sessionId` has two writers today: `setSession` (`store.ts:1304`, an unconditional UPDATE,
  called from `dispatch.ts:429` and `routes.ts:964`) and `markDispatched` (`store.ts:1427`). Both
  funnel into one store method, `bindSession(runId, sessionId)`, which does what they do now and,
  when the run ALREADY names a different session, performs for the `worker` role the act D-1425
  performs for the coordinator's heir: every OUTSTANDING delivery of a `toId:'worker'` mail on this run
  addressed to the predecessor is re-issued to the heir as a new delivery row, freshly rendered, its
  counters zero because they are true of it; the predecessor's row is parked under a third
  deliberate-cancel constant, `MAIL_REBIND_SUPERSEDED_ERROR` (`'recipient rebound'`), joining
  `DELIBERATE_CANCEL_ERRORS_SQL` at its documented extension point, because either existing literal
  would lie about why it parked (D-2058). One method, `requeueAbandonedMail`, parameterised by role,
  never two — and the role varies the source predicate and the park as well as the `toId` literal and
  the scope, four facts in one method (D-2059). **Stated honestly: no route re-binds
  a live run today** — the fresh-spawn arm runs only when `run.sessionId` is null (`dispatch.ts:297`)
  and the resume arm reuses the id it finds — so the coordinator's heir (D-1425) is the one live
  instance, and the worker arm is reached only by the store test that drives it directly. The funnel
  exists so that the day a recovery re-binds a run (a held workspace reaped, a fresh `ws-add` into the
  same run), the promise holds without anyone remembering to add it. This is the Aug draft's
  "delivery-time resolution" as observable behaviour — a replacement inherits its predecessor's
  undelivered mail — at the only instant a replacement can exist, without touching the sweep's hot
  path or the verbatim-replay guarantee.
- **The programme filter.** `GET /api/mail?program=<slug>` (EXACTLY ONE of `to` and `program` — a
  mailbox and a thread are different questions with different joins, so both at once is a 400,
  D-2057; `all` as today) answers every mail whose `runId` joins to a run of that programme, through
  the join `resolveCoordinator` already uses. `GET /api/feed?program=<slug>` answers the events of
  that programme — which needs a `runId` the feed row does not carry today (`NotifyEvent` is
  `seq, at, kind, sessionId, title, body` on the wire, and the ring-capped `feed_events` table
  likewise), so the ONE migration of this build (§8) also adds a nullable `feed_events.runId`, the
  recorders that know a run (mail and run events) populate it, and `NotifyEvent.runId: number | null`
  rides the wire additively with one tolerant reader, `reviveNotifyEvent`. The offline snapshot
  persists sessions and roster only (`pwa/src/lib/offline.ts:23-37`), so there is nothing there to
  revive; `offline.test.ts` pins that key set so a later persisted run row cannot slip past without a
  reviver (D-2062). Events without a `runId` are programless and appear only unfiltered.
  `ccrc-api`'s closed table gains `--program` on `mail list` and a `feed list GET /api/feed
  [--program]` row — the table is the client's own contract and grows by a row, never by a URL
  argument — and its prose row count (`ccd/ccrc-api:24`, pinned by `ccrc-api.test.ts:240`) moves
  with it.
- **The mail screen** groups by programme (header = programme title, from `GET /api/runs`, the read
  the runs screen already makes; the event's new `runId` is the key) with a filter chip. Three group
  kinds, not two: programless mail (no `runId`) under its own header, and a record whose `runId` names
  a run the runs read did not return under `run <n> — programme not measured`, because an unmeasured
  programme is not the same fact as none (D-2065). `MailCard` is unchanged.
- **Pinned by:** the send-route refusal test extended for the `worker` role in both directions; a
  store test that binds a run to a second session through `bindSession` and asserts the heir's fresh row, the
  predecessor's park, and the envelope naming the heir; the filter tests on both routes with a
  programless row that must not appear; the `ccrc-api` table pin (`ccrc-api` and its test already
  harvest the table in both directions, row count included).

---

## 5. Caps and safety — unchanged, restated

- Caps stay global (`store.ts:1882`): one row, whole box, no per-programme or per-project cap.
- A crossing costs two live workspaces, two concurrency slots and two of the daily budget. Three
  corpora say so, each argued: the skill (§3 F3), wave 1's `wave-lifecycle.md` refusal row beside the
  remedy it explains (D-2061), and README's cross-repo subsection — not its caps paragraph, which a
  census test keeps number-free (D-2068).
- `$REG/coordinator-paused` is global and still stops everything.
- The hold reason still names programme, wave and run id, never a project; the run row carries the
  project.
- `project-mismatch` and `home-mismatch` are the two new mechanical guards. Everything else remains
  Build 7's contract: attribution not authentication, reap human-only by convention plus a speed bump,
  one coordinator per programme.
- A foreign-repo worker's workspace is an ordinary ccd worktree in that repo; archive, PR sweep and
  push decoration already handle it per workspace (§2).

---

## 6. Non-goals — the rejected nouns, carried verbatim so nobody relitigates

- No "cross-repo project" noun; no entity that owns several repos.
- No shared programmes home, no replicated ledger, no ledger sync; foreign waves read the home ledger
  by absolute path and never write it.
- No multi-repo workspace; the whitelisted verbs cannot re-point one and will not learn to.
- No cross-box anything; §3 F3's absolute path depends on one box, one user, and says so.
- No cross-run dependency edges or server-side gates (Q1); `blockedBy` stays within a run.
- No server-side contract registry; the contract excerpt is prose in a brief and a file in the
  producing repo.
- No documents in mail bodies; paths, not payloads; 8 KB stands.
- No home-project derivation from the registry or the claimant.
- No true delivery-time re-resolution in the sweep — §4 meets the promise at occupant change; if a
  measured incident shows a role changing hands with no `setSession`, that is the evidence that
  reopens it.
- No new artifact class, so no new lifecycle declaration under the 2026-08-11 policy: the ledger
  stays programme-bound, briefs stay mail rows, the skill additions edit files that exist.

---

## 7. Testing — every guard ships with a row measured red

| guard | red when |
|---|---|
| `project-mismatch` at open | the `sessionProject` check is deleted; the refusal shape or status changes |
| `project-mismatch` at dispatch resume | the `record.project` comparison is deleted, or moved after the hold |
| `home-mismatch` | a differing home on a later open is accepted |
| legacy-generation constant | `homeProjectVerdict` driven with `legacyAccepted` true and false; either branch deleted is red |
| migration N+1 | a v-N database boots without the column readable |
| `RunSummary.homeProject` | the wire literal loses the field (compile error), the reader folds null and non-null |
| `worker` role at send | the literal is refused, or an undispatched run resolves to anything but `unknown-recipient` |
| heir re-issue in `bindSession` | the heir gets no fresh row, the predecessor's row is not parked, the envelope names the corpse, or either old writer bypasses the funnel |
| programme filter | a programless mail or event appears under a filter |
| mail filter selector | `to` and `program` together answer anything but 400 |
| runs-screen badge and marker | the badge is absent; the marker shows while `homeProject` is null |
| home-card abroad line | the second list is dropped |
| skill pins | any clause sentence drifts from the pinned literal |
| `ccrc-api` table | `--program` on `mail list` or the `feed list` row is missing, or the row-count sentence at `ccrc-api:24` is stale |

`typecheck-tests` covers the compile-time rows; the rest are vitest suites run in isolation before
the whole-suite gate, and CI on the quiet box is the arbiter of a load flake.

---

## 8. Migration, deploy and rollback

- One schema migration, forward-only, two additive nullable columns (`programs.homeProject`, F2;
  `feed_events.runId`, §4), `user_version` N → N+1. A higher `user_version` on rollback is not fatal
  (`db.ts:105`), and every reader tolerates the null.
- `FLEET_PROTO` is not bumped: every wire change here is an additive field with a single reader.
- Ordering, two rules at two scopes: ACROSS waves, wave 1 deploys and is live before wave 2 ships,
  so the guard exists before the skill tells coordinators to cross; WITHIN each wave that carries a
  `ccd/` change — wave 1's refusal-list sentence, wave 2's behavioural clauses — the agent lane goes
  first as every `ccd/` change does.
- Rollback of the server lane leaves the column in place and the legacy constant's behaviour
  intact; rollback of the skill lane leaves a coordinator that never crosses, which is today.

---

## 9. Execution — a ccrc programme homed in ccrc-pwa, three waves

- **Wave 1 — server and shared:** F1 (both sites, both codes), F2 (migration, route, response,
  `RunSummary.homeProject`), §4 (worker role, heir re-issue, the two filters, `feed_events.runId`),
  `ccrc-api` table rows, the two codes named in the coordinator skill's refusal list and explained in
  its `wave-lifecycle.md` (the skill test demands it the moment the codes exist), every test in §7
  that lives in `server/test`. Agent-first for that skill edit. Rebases over account-pools wave 3,
  which touches the same server files now.
- **Wave 2 — skills and PWA:** F3 (both skills, both pins, the installers unchanged), F4 (runs screen,
  both card changes), the mail screen's grouping and chip. Deploys agent-first.
- **Wave 3 — docs and the flip:** README "Programs, runs and mail — the operator's view" and "Fleet
  coordination" sections; the Aug 11 spec's status line; the ledger closes; and the legacy flip as its
  own commit when §3 F2's measured criterion holds, else deferred with the measurement recorded. Not
  agent-first — the coordinator references belong to waves 1 and 2, not here (D-2069).

**Dogfood, as its own programme after wave 2 is live:** home `custom-tools`, wave 1 there, wave 2 in
`data-internal` on real work the operator names, opened without `sessionId`. Acceptance, from the Aug
draft and unchanged: the wave-2 brief cites the home plan by absolute path at a sha and inlines the
contract verbatim from the merged file; the board shows the crossing on the wave-2 row and the abroad
line on the home card; the ledger's wave table records both PRs across two repos; no content moved by
copy-paste; `project-mismatch` never fires in anger — its proof is a test, not an incident.

---

## 10. Open questions

None that block the plan. Two the plan records rather than decides:

- The exact wording of the two new skill clauses is the plan's to write against the pins; the rule
  content is §3 F3.
- The legacy flip is dated by evidence, not by this file: zero `legacy-home-project` events and at
  least one run opened over seven consecutive days, read from `run_events` and `runs` by the operator
  on the server box (§3 F2; D-2066, D-2067).
