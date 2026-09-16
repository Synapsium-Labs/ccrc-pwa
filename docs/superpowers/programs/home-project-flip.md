# Program: home-project-flip
Spec: `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md` §3 F2 (the legacy generation and the
flip as its own PR)   Plan: `docs/superpowers/plans/2026-09-08-crossrepo-wave3-docs-flip.md` Task 6, read at
`d6494f1c` (origin/main's parent at open — `dba672ac`, #109, touches none of the files this wave edits), with
the substitutions in the brief below   Workspace: assigned by wave 1's dispatch (fresh)
Home: `ccrc-pwa`. One wave. Coordinator: `claude-ccrc-pwa`. Run: 65.

This programme is the one item the closed `crossrepo-programmes` ledger carried forward: its wave 3 measured
the flip's gate closed on 2026-09-14 and deferred the flip; this ledger is where the flip is decided, measured
and shipped. That ledger is read, not written — one pointer sentence in its `## Next-wave brief` is the only
edit it gets.

## Waves
| # | scope | PRs | state |
|---|-------|-----|-------|
| 1 | `HOME_PROJECT_LEGACY_ACCEPTED → false`; `server/test/home-project-required.test.ts` red-first then green; the four fixtures Task 6 names plus the census beyond them; the coordinator skill's prose that would otherwise say the omission is still accepted; this ledger's row and one pointer sentence in the crossrepo ledger | #133 | flip commit `8362148e` on the coordinator's branch `coord/home-project-flip-ledger`; flipped 2026-09-16 on operator ruling D-2867 — legacy_since_deploy = 8, opens_since_deploy = 15, last omission 2026-09-15T07:38:57Z |

## Measurements

**Taken 2026-09-16 10:19 UTC on the server box, read-only, with python's `sqlite3` against `~/.ccrc/coord.db`
— `run_events.detail LIKE 'legacy-home-project%'` joined to `runs`, and `runs.openedAt` — since the wave-2
agent-lane deploy at 2026-09-14T11:51:42Z (the moment the installed coordinator skill started sending the
field; crossrepo ledger, Carried constraints E1).**

`legacy_since_deploy = 8`, `opens_since_deploy = 15`. The eight are all from two coordinators: seven opens of
`qdrant-consolidation` (waves 4, 5, 6, 7, 9, 8, 10 — runs 50, 52, 53, 54, 56, 57, 58 — by
`intake-platform-keen-meadow`, 2026-09-14T12:59:03Z through 2026-09-15T07:38:57Z) and one of `bug-fix-waves`
(wave 1, run 55, by `expoAI-assistant-still-river`, 2026-09-14T17:21:29Z; its six later opens, runs 59–64, all
carried the field). The six opens after 2026-09-15T07:38:57Z (runs 59–64, two programmes) were all
well-formed: `legacy_24h = 0`, `opens_24h = 6` at read time. All-time the event count is 10 (runs 43 and 47,
`account-pools`, are the two before the deploy).

The spec's own criterion (§3 F2, D-2066/D-2067: zero events AND at least one open over seven consecutive days)
is therefore NOT met today; it clears no earlier than 2026-09-22T07:38:57Z if no further open omits the field.
The flip proceeds on the operator's ruling (D-2867 below), not on the criterion.

**A read this coordinator gave the operator earlier the same morning — "fifteen opens, every one named its
home, zero legacy-shaped" — was wrong.** It took `homeProject` off the runs list, which carries the
PROGRAMME's stored home, not the body's; a legacy-shaped open of a programme whose home is already stored
shows the stored value there and is visible only in `run_events`. This block replaces that read, and the
operator was told so before anything merged.

## Decisions & deviations
Ledger block: **D-2867–D-2869**, three numbers minted in one allocator call at run-open (coordinator clause 10),
each defined in the same act. Their DEFINITION lines live in the wave-3 plan's `## Deviations found`
(`docs/superpowers/plans/2026-09-08-crossrepo-wave3-docs-flip.md`, beside D-2740–D-2755), because
`server/test/deviation-refs.test.ts` seeds its high-water from `docs/superpowers/plans/` alone and reds on any
tracked file naming a number above it (measured at this ledger's first draft: "names D-2869 … expected 2919 to
be 2891"); this ledger restates them. Numbers cited from the crossrepo programme — D-2070, D-2743, D-2744 — are
cited, never re-minted.

- **D-2867 — the seven-day window waived by operator ruling.** Spec §3 F2 dates the flip by seven consecutive
  clean days; the trail above shows the last omission 27 hours before the ruling. The operator ruled on
  2026-09-16 ("backfill and flip today", then "let's do it now") that the flip ships now: the refusal it
  produces is loud (`400 bad-request`, detail `homeProject is required`), its remedy is one field in the
  caller's body, and the installed skill has sent that field since 2026-09-14. The two coordinators whose
  opens omitted it were named above; the one whose latest opens still omit it (`intake-platform-keen-meadow`)
  was mailed on 2026-09-16 (mail 1398) with the refusal and the remedy. The merge and both deploys stay gated
  on the operator's word with the corrected trail in front of them.
- **D-2868 — the PR is wider than "one constant and one suite", and that makes it agent-first.** With the
  constant `false`, `ccd/coordinator-skill/SKILL.md:384-386` ("An open with no `homeProject` at all is still
  accepted for one deploy generation …") and `ccd/coordinator-skill/references/wave-lifecycle.md:45` would
  state something false to every coordinator that installs the skill. Both sentences change in this PR to say
  the open is refused and what the refusal reads. A change under `ccd/coordinator-skill/` ships to the fleet
  host before the server (CLAUDE.md, AGENT-FIRST), so the deploy order for this PR is agent lane, then server
  lane. The rewrite is scoped to the parenthetical at `SKILL.md:384-386` and to the one sentence at
  `wave-lifecycle.md:44-45`; `coordinator-skill.test.ts` pins neighbours in the same section verbatim —
  `SKILL.md:375-376` ("Every `POST /api/runs` for this programme carries `homeProject`"), `:383`
  (`home-mismatch`), `:388` ("Reuse `sessionId` ONLY when …") and `wave-lifecycle.md:41` ("`ledgerAbsPath` is
  ONLY that home's programme ledger") — so those lines do not move a byte, and none of the twelve contract
  clauses change.
- **D-2869 — the fixture census beyond Task 6's list.** Task 6 names four test files and, inside
  `run-routes.test.ts`, two cases. A THIRD case in that file also opens legacy-shaped — `rolls home back when
  its event cannot be inserted, then writes both facts exactly once on retry` (`:625-653`, the bare
  `postOpen(app)` at `:629` with `programHome … toBeNull()` at `:630`) — and is re-seeded on the store exactly
  as the `:611` case is; the census records it as the case Task 6 did not name. The worker also measures every
  other suite that posts to `/api/runs` (`git grep -n "url: '/api/runs'" server/test`) and records here which,
  if any, sent a legacy-shaped open and had to change. At d6494f1c the two outside the four —
  `auth-gate.test.ts:714` and `auth-passkey.test.ts:2196` — assert the auth gate's verdict, not a `200` open,
  so the expected census is "none"; the worker writes the measured value, not this expectation.
  **MEASURED (wave 1).** The third `run-routes.test.ts` case is the one named above — `rolls home back when
  its event cannot be inserted, then writes both facts exactly once on retry` — and it was re-seeded on the
  store exactly as the backfill case was; its `programHome(...) toBeNull()` precondition and the whole
  rollback-then-retry branch below it still hold, and the file is green. The two outside the four needed NO
  change, measured rather than assumed by reading both: `auth-gate.test.ts:714` posts to `/api/runs` with no
  body at all and asserts only that the GATE does not refuse it — the body-shape guard answers it `400`
  before the home check is reached, at this base and after the flip alike — and `auth-passkey.test.ts:2196`
  is a `GET`. Both suites were run after the flip and are green. Beyond those two, the prescribed grep
  `git grep -n "url: '/api/runs'" server/test` matches no further file (five in all: `auth-gate`,
  `auth-passkey`, `coord-caps-route`, `home-project-required`, `run-routes`). Measured at the wave's tip,
  `git grep -ln '/api/runs' server/test` names twenty-three further files. Eleven open runs on the STORE
  (`openRun(`), whose `openRun` keeps `homeProject` optional — `coord-abandon`, `coord-health`,
  `coord-items`, `coord-kickoff`, `coord-store`, `fleetws`, `mail-routes`, `name-sweep`, `reclaim-route`,
  `routes`, `run-signals` — and twelve never open a run at all — `box-token-census`, `ccrc-api`,
  `coord-pause-route`, `coord-routes-single-file`, `coordinator-skill`, `crossrepo-prose`, `home-project`,
  `kickoff-route`, `lifecycle-route`, `resume-reclaim-l0`, `reviewer-skill`, `single-definition`. All
  twenty-three were run for this wave and none changed; all are green except `crossrepo-prose`, red at the
  tip and on `origin/main` alike on its cap-predicate scan of the untouched `store.ts` (Carried constraints).
  **The census found a FOURTH edit in `run-routes.test.ts` that neither Task 6 nor this entry predicted, and
  the URL grep both prescribe could not have found it.** Task 6 states that file has "not one second body
  literal"; it has one — `REVIEW(workId, over)` at `:3544` at `d6494f1c`, the review-open body factory, which builds its
  own object rather than spreading `OPEN_BODY` and so did not inherit the `homeProject` added there. A review
  open is an open like any other: `homeProjectVerdict` decides an absent home by the constant ALONE, never by
  whether the programme is already known and homed, so with the constant `false` twenty review cases were
  refused `400` and failed downstream in `markDispatched` on an undefined run id. `homeProject: PROJECT` was
  added to that factory and the file is green at 211 passed. The product is NOT exposed: the installed skill
  already sends the field on a review open (`ccd/coordinator-skill/SKILL.md:304`), so this was a fixture gap
  only. The lesson for the next census: the unit is the BODY, not the injection URL — `git grep "url:
  '/api/runs'"` finds call sites, and a body factory several hundred lines from one is invisible to it.
- **D-2070 — decided: this programme's PR IS the flip's own PR.** Nothing rides with it but the suite that
  holds the constant shut, the fixtures the flip forces, the prose the flip falsifies, and the two ledger
  edits. The docs the flip depended on merged as `98236c81` (#100) on 2026-09-15, so the "not before the
  docs" ordering is already satisfied.
- **D-2743 / D-2744 — applied as pre-approved** (crossrepo ledger, coordinator ruling, mail 1111): the run-count
  assertion is `okRuns(w.coord.runs({ includeClosed: true })).length`; the refusal assertion is the `toEqual`
  carrying `detail: 'homeProject is required'` — the shipped route sends that detail
  (`server/src/coord/routes.ts:1265` and `home-project.test.ts:50-60`, both at `d6494f1c`, the base the brief measures against), so Task 6 Step 1's "NO
  `detail` HERE" comment is false at this base and is replaced.
- **The eight NULL homes were backfilled on 2026-09-16 at 10:19:07 UTC by a direct server-box write** — the
  crossrepo ledger's open item, resolved on the operator's ruling in favour of the direct write over a new
  write surface. Python's `sqlite3` on the server box, `UPDATE programs SET homeProject = ? WHERE slug = ? AND
  homeProject IS NULL`, one row per programme inside one `BEGIN IMMEDIATE` transaction, each value re-measured
  in that same transaction as the ONE project every run of that programme names (`SELECT DISTINCT project FROM
  runs WHERE program = ?` — exactly one row for all eight); an online `.backup()` copy was taken first
  (`~/.ccrc/coord.db.bak-20260916T101907Z`, beside the database, not in any repo). Written: `account-pools`,
  `build4`, `ccd-queue`, `program-leverage`, `registry-durability` → `ccrc-pwa`; `battlescape-operational` →
  `MekWarLive`; `claude-tooling-consolidation` → `custom-tools`; `promise-backfill` → `expoAI-assistant`.
  Eight rows updated, zero NULL after. No run event records it — there is no run to hang one on — so this
  entry is the record. A box-token-gated route plus a client verb for the same write stays undone: it would be
  a product feature, and nothing today needs it.
- **Wave 1 was executed by the coordinator session in its own worktree, on operator ruling 2026-09-16 11:59 UTC** — the fleet's concurrency cap (7/7 on the deployed build, which still counts `awaiting-review`) refused run 65's dispatch twice, and the operator asked for the work to be done in place. Run 65 therefore never dispatched: it is left `planned` for the operator to abandon from the console, and the done-fingerprint below is measured on this branch by the coordinator, not by a dispatched worker. The PR is reviewed exactly as a worker's would be.

## Carried constraints
- **`reconstruct` rebuilds every programme with `homeProject` NULL** (crossrepo ledger, wave 1's drill census).
  The backfill above is exactly as durable as `coord.db`; the backup file is the artifact that would restore
  it. Carrying homes through a rebuild still needs an artifact that proves them — not this programme's work.
- **Three live coordinators are exposed to the refusal, and each was mailed on 2026-09-16.** After the flip
  lands on the server lane, an open that omits the field is refused before any row is written.
  `intake-platform-keen-meadow` (seven omissions, last 2026-09-15T07:38:57Z, programme `done`; mail 1398);
  `ccrc-pwa-amber-summit` (runs 43 and 47, the two before the deploy; still holds `ccd-queue` run 42);
  `claude2-MekWarLive` (`battlescape-operational`, run 31 working — every run of that programme predates the
  field, so its next open is that coordinator's FIRST under the feature: a point raised by the crossrepo
  wave-3 worker's finding, mail 1401, which independently re-measured the trail and agrees with it).
  `expoAI-assistant-still-river` has sent the field on every open since 2026-09-15T16:27:56Z and was not
  mailed.
- **Deploy order for this PR: fleet host first, then the server box** (D-2868). Both lanes ran main `98236c81`
  on 2026-09-16 (agent built 10:03:05Z, server 10:09:45Z); re-read `ccd version` and `/health` before either
  deploy — never deploy main over a lane that is running another programme's unmerged branch build.
- **The crossrepo ledger's `## Measurements` block is pinned** (`crossrepo-prose.test.ts`, "the legacy-flip
  measurement is recorded"): it is not edited. The one sentence this programme adds goes in that ledger's
  `## Next-wave brief`.
- **`main` was RED before this programme opened, on three failures none of which is in a file this wave
  touches** (CI run for `d6494f1c`, 2026-09-16 10:10Z, and the two merges before it): `test/contrast.test.ts
  › the uncovered census › contains no identities beyond the grandfathered blind spots` (pwa, after #89);
  `test/crossrepo-prose.test.ts › states the measured cap predicates, not a workspace-to-slot equivalence`
  (the literal `dispatchedAt IS NOT NULL AND state NOT IN ('done','failed')` that PR #100's own pin expects
  became `${INACTIVE_RUN_STATES_SQL}` in `store.ts:2706` when #108 took the idle states out of the running
  cap — so the README sentence that pin defends, "concurrency counts dispatched non-terminal runs", is stale
  too; the remedy belongs to the review-runs change, not to the flip); and `test/ccd-plat-timeout.test.ts ›
  D-2764` (two cases). The flip's PR will show the same reds until `main` is fixed; the worker reports them
  as pre-existing and does not touch them (brief, GATES). Merging over them is the operator's call.
- **The block's tail is empty by construction** — three numbers, three entries. A fourth deviation, if the
  wave finds one, is written `D-TBD-<slug>` and reported (worker clause 11); this coordinator mints it at the
  next round, never the worker mid-wave.

## Next-wave brief

Programme `home-project-flip`, wave 1 of 1, run 65, home project `ccrc-pwa`, coordinator `claude-ccrc-pwa`.
Execution skill: `superpowers:executing-plans`, over ONE task — `docs/superpowers/plans/2026-09-08-crossrepo-wave3-docs-flip.md`
Task 6 ("The legacy flip — `HOME_PROJECT_LEGACY_ACCEPTED → false`"), read at `d6494f1c` (origin/main's parent
at open; `dba672ac`, #109, touches none of the files below), with the five substitutions below. Task 6's
"execute only if Task 5's gate opened" clause is overridden by the operator's ruling of 2026-09-16 (D-2867).
Deviation block for this wave: **D-2867–D-2869**, already defined in the wave-3 plan's `## Deviations found`
and restated in this ledger; cite them, do not re-mint, and write `D-TBD-<slug>` for anything beyond them.

Commit on this workspace's own branch (`ws/<workspace>`), never a separate feature branch — the
done-fingerprint re-measures the workspace branch.

FIRST ACTS, in order: `git fetch origin`; `git merge --no-edit origin/main` (the workspace was cut from a base
that may lag); `git merge --no-edit origin/coord/home-project-flip-ledger` — that branch's one commit adds
this ledger, `docs/superpowers/programs/home-project-flip.md`, and the three definition lines at the end of the
wave-3 plan's `## Deviations found`. You edit this ledger's wave-1 row and its D-2869 entry at the end; you
edit `docs/superpowers/programs/crossrepo-programmes.md` for ONE sentence only (item 5). Then
`cd server && npm ci` if `server/node_modules` is absent — every gate below runs from there.

SUBSTITUTIONS to Task 6, each measured at `d6494f1c` — re-measure before editing, anchors rot:
1. Step 1's refusal assertion. The shipped route already sends a detail: `server/src/coord/routes.ts:1265`
   `reply.code(400).send({ ok: false, error: 'bad-request', detail: 'homeProject is required' })`, pinned by
   `server/test/home-project.test.ts:50-60`. The new suite asserts
   `expect(body).toEqual({ ok: false, error: 'bad-request', detail: 'homeProject is required' })` (D-2744),
   and Step 1's "NO `detail` HERE, DELIBERATELY" comment is replaced by one sentence citing D-2349 and D-2744.
   The run-count assertion is `expect(okRuns(w.coord.runs({ includeClosed: true })).length, '…').toBe(0)`
   with `import { okRuns } from './coordReadHelpers.js'` (D-2743) — `coord.runs()` returns a measured result,
   not an array. `w.coord.programs()` is an array of `{ slug, … }`; Step 1's `.some(...)` over it stands.
2. The constant is `export const HOME_PROJECT_LEGACY_ACCEPTED = true;` at `routes.ts:269`, imported by
   `home-project.test.ts:10` — KEEP `export`; Step 6's snippet dropped it. Step 6's prescribed JSDoc
   (plan `:1677-1682`) carries two falsehoods at this base — strike both: "the route's bare `bad-request` …
   no `detail` — wave 1's deliberate shape" becomes "refuses the open `400 bad-request` with
   `detail: 'homeProject is required'` (D-2349, D-2744)"; and "FLIPPED TO `false` on the measurement, not on
   the calendar: zero `legacy-home-project` events in a rolling seven-day window …" becomes "FLIPPED TO
   `false` on operator ruling D-2867, the spec's seven-day criterion waived: 8 of the 15 opens since the
   2026-09-14 deploy omitted the field, the last at 2026-09-15T07:38:57Z — the trail is in
   `docs/superpowers/programs/home-project-flip.md`'s `## Measurements`". Keep "Both branches stay in the
   tree and both stay tested — this is a value change, never a deletion."
3. Anchors at `d6494f1c`: `run-routes.test.ts` `OPEN_BODY` :59-60; the case to DELETE at :670 (`accepts an
   absent homeProject during the legacy generation…`); the backfill case to re-seed on the store at :611; a
   THIRD case Task 6 does not name, `rolls home back when its event cannot be inserted, then writes both facts
   exactly once on retry` (:625-653), whose bare `postOpen(app)` at :629 is replaced by the same
   `w.coord.openRun({ program: 'build4', title: 'Transcript surface', project: PROJECT, wave: 1, waveOf: 3,
   claimedBy: CLAIMED_BY })` seeding as the :611 case (its :630 `toBeNull()` and the backfill branch it relies
   on then still hold) — so Task 6's "two cases" is three, all in that one file (D-2869);
   `coord-caps-route.test.ts` inline open :356-359, the payload literal to edit at :358-359;
   `home-project.test.ts` shipped-value assertion :62-64, and the pure `required` case goes beside the flip
   case at :35-48. `auth-gate.test.ts:714` and
   `auth-passkey.test.ts:2196` also hit `/api/runs`: read both; each asserts the auth gate's verdict, not a
   `200` open — leave them unless a run reds, and record the census as D-2869's measured value either way.
4. Prose that becomes false once the constant is `false` — fixed in the same PR (D-2868):
   `ccd/coordinator-skill/SKILL.md:384-386`, the parenthetical "An open with no `homeProject` at all is still
   accepted for one deploy generation and recorded as a `legacy-home-project` run event, with the column left
   NULL rather than guessed." becomes a sentence saying an open with no `homeProject` is refused
   `400 bad-request` with detail `homeProject is required` — the legacy generation ended 2026-09-16 — and keep
   "You never omit it." `ccd/coordinator-skill/references/wave-lifecycle.md:44-45` — the one sentence "The
   server tolerates an absent `homeProject` for one deploy generation and records that it did; send it on
   every open anyway." — is rewritten the same way. Rewrite ONLY that parenthetical and ONLY that sentence:
   `coordinator-skill.test.ts` pins their neighbours verbatim (`SKILL.md:375-376`, `:383`, `:388`;
   `wave-lifecycle.md:41`), so nothing else in either paragraph moves a byte, and none of the twelve contract
   clauses change — run `test/coordinator-skill.test.ts`. README: `git grep
   -n "one deploy generation" README.md` finds :543 and :1843, both the box TOKEN's generation, not the home's
   — leave them; report the census in the wave-done.
5. Commits and ledgers — the wave is TWO commits of yours on top of the two merges. (1) The FLIP commit,
   `git add` exactly these seven paths: `server/src/coord/routes.ts`, `server/test/home-project-required.test.ts`,
   `server/test/home-project.test.ts`, `server/test/run-routes.test.ts`, `server/test/coord-caps-route.test.ts`,
   `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`; message
   `feat(runs): homeProject is required at open — the legacy generation ends on operator ruling D-2867`, NOT
   Step 10's "…ends on the measurement", which this ledger's `## Measurements` refutes. (2) The LEDGER commit,
   after it, naming the flip commit: this ledger's wave-1 row becomes `worker branch <flip short sha>; flipped
   2026-09-16 on operator ruling D-2867 — legacy_since_deploy = 8, opens_since_deploy = 15, last omission
   2026-09-15T07:38:57Z` (`<flip short sha>` = `git rev-parse --short HEAD` taken after commit (1) — a row
   cannot name the commit that carries it), D-2869's entry gets the measured census, and ONE sentence is
   appended to the LAST paragraph of `crossrepo-programmes.md`'s `## Next-wave brief`: "The flip shipped as
   programme `home-project-flip` (ledger `docs/superpowers/programs/home-project-flip.md`) on 2026-09-16, on an
   operator ruling recorded there (D-2867)." Do not touch that ledger's `## Measurements` block (pinned).
   Then `git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` —
   green, because the three numbers are defined in a `docs/superpowers/plans/` file (the guard reads only
   that directory for definitions).

GATES — foreground, `./node_modules/.bin/vitest run …` from inside `server/`, never bare `npx vitest`, never
backgrounded: Task 6 Step 2 red-first (quote the two reds in the wave-done); Step 5 green BEFORE the flip;
Step 7's list plus `test/home-project.test.ts test/crossrepo-prose.test.ts test/coordinator-skill.test.ts
test/mail-routes.test.ts test/single-definition.test.ts test/deviation-refs.test.ts
test/box-token-census.test.ts`; Step 9's mutation measured both ways (quote both reds, then the restored
green); then the whole server suite in shards — `--shard=1/3`, `2/3`, `5/6`, `6/6`, sequential, each under a
600000 ms timeout (`3/3` and the unsharded suite were both measured killed at 590 s on this box on 2026-09-15;
`5/6 ∪ 6/6 = 3/3` exactly, since vitest slices the sorted file list) — with the known load flakes (`ccd-ws-gc`,
`pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) re-run in isolation before being called a
break; report each shard's wall time. THREE FAILURES ARE PRE-EXISTING ON `main` AT `d6494f1c` AND ARE NOT
YOURS (Carried constraints): `crossrepo-prose.test.ts › states the measured cap predicates…`,
`ccd-plat-timeout.test.ts › D-2764` (two cases), and the pwa suite's `contrast.test.ts › the uncovered census
› contains no identities beyond the grandfathered blind spots`. Confirm each reds identically on a pristine
`origin/main` checkout of the same file before you call it pre-existing, list them in the wave-done as such,
and change nothing to make them green — the flip's PR is red on exactly those until `main` is fixed, and
that is the operator's call, not a reason to widen this PR.

PR: `git push -u origin ws/<workspace>` first (a non-TTY `gh pr create` cannot answer its push prompt), then
`gh pr create` against `main`; title `feat(runs): homeProject is required at open — the legacy generation
ends on operator ruling D-2867`; body: the numbers above, D-2867–D-2869, the line "AGENT-FIRST: fleet host
before server (ccd/coordinator-skill changed)", the two mutation reds, and the footer
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then WAIT INSIDE YOUR TURN for CI:
`timeout 590 gh pr checks <N> --required --watch --interval 30`, repeated while it exits 124 (timeout while
still watching) or 8 (pending); exit 0 is green, exit 1 is a failure to read — read it: if the only failing
tests are the three pre-existing ones above, CI is as green as `main` is, and you proceed to the wave-done
saying exactly that; any other failure is yours. Never end a turn waiting on CI — nothing wakes a session on
a green check.

WAVE-DONE mail to `coordinator` on run 65 (kind `status`, subject `wave-done home-project-flip wave 1`): the
FOUR fingerprint fields measured once, after your final push, then no further pushes — `branchTip` and
`handoffCommit` (the same full 40-hex sha, your last commit), `prNumber`, `prPhase` (expected `open`) — plus
the D-2869 census, the two red-first reds, the two mutation reds, and the shard results with wall times. Do
NOT merge (the ruleset; the operator merges), do NOT deploy, run no `ccd` verb, touch no other workspace.
