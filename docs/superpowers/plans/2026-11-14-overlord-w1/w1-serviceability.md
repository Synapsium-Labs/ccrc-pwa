# Overlord W1: serviceability and limits (the account facts, the three inputs, `limit_samples` and `poolRunway`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the one serviceability answer learns who is asking. For a session whose pool side is a set (the Overlord, and
later the replay body), it reads two new roster facts the operator sets: each account's **billing fact** (does Fable on
this account bill usage credits) and each lane's **continuity record** (has the operator recorded that this lane keeps
the Overlord's guards and hooks). Fable on an account that bills credits, or whose billing fact nobody set, is unservable
for it, and no class serves it on a lane without a continuity record. Both twins, `shared/serviceability.ts` and ccd's
`_serviceable`, answer the same way over one fixture table. The operator sets both facts from the existing account
`set` door. Then the server keeps a history of each account's limits, `limit_samples`, and one L1 decider,
`poolRunway`, answers when a pool runs out. Three load lines (70%, 85% and 95%) are read off the Overlord's accounts,
and the 95% line becomes the ladder's cause row that caps the rung at `chat`.

**Why:** H16 makes the serviceability answer the one owner of "may this lane run this class now", and the Overlord's
answer differs from every other session's on the same lane: Fable billed to credits is spend (O2), and a lane nobody
has checked may not carry its reads (H16, continued). C57 moves the Overlord before a limit bites, which needs a load
history and a runway, and §6.8's 95% line stops everything but chat (Table 7.5a). Readiness reads `stranded`'s earliest
reset from `poolRunway` (C57), and the renewal readings take two readings from this piece.

**Architecture:** L0: the account facts' vocabulary in a new `shared/rosterFacts.ts`, and the load lines with the
runway's wire words in a new `shared/loadLines.ts`. The roster (`shared/roster.ts`, its bare-Node mirror and the
`accounts.sh` generator) carries the two facts. The serviceability answer widens in L0 and in bash. L1: `poolRunway`
in a new `server/src/poolRunway.ts`, and the load lines' reading with the two renewal readings in a new
`server/src/accountLoad.ts`. L3: `limit_samples` in `coord.db` behind a new `server/src/coord/limitSamplesStore.ts`.
L4: the sampler, `server/src/limitSampler.ts`, on a new `LANE_SCHEDULE` row, fed by the reading the watcher already
takes each tick. The door is today's `POST /api/accounts/:id/set`, widened. Two pull requests.

**Tech Stack:** TypeScript (ESM), bash (ccd), `node:sqlite`, Fastify, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.4: H16 ("One answer", "Four more inputs", "Fable
is judged as for any session", "Unmeasured keeps the current class", "The return waits, and ccd owns the hold-down")
and "H16, continued. A lane serves the Overlord only with a continuity record"; C46 ("The asking session's id … by the
route record the server wrote on their rows"); C56 ("Fable on its accounts is shared", Table 3.4a); C57 ("A history
of limits", "When everything is limited", Table 3.4b); §6.8 ("The load lines", Table 6.8a); §7.5, Table 7.5a's row "the
Overlord's accounts past the 95% load line"; Table 11.1a's rows `limit_samples` and "A billing fact per account, and a
continuity record per lane"; Table 11.1b's row "`shared/serviceability.ts` with four more inputs … `poolRunway`";
Table 11.5b's load-line rows; Table 13.1's H16 (`tightening`, W1). The W1 index is
`docs/superpowers/plans/2026-11-14-overlord-w1.md` (row "Serviceability and limits", lane A). This plan builds on the
index's questions 7, 8, 20 and 34, and on the ccd arms plan's question 3 (ruled).

Written against `main` at `4fda398e4` (2026-11-15), on a branch based at `2b082b91f`; no `ccd/`, roster or accounts
file differs between the two. Revised in fix round 1 (review 2160): the coordinator's rulings are marked "(ruled, F<n>)".

## Open questions

The first four are rulings this plan builds on, and fix round 1 ruled several more, each marked. Each other question
is open with a recommendation, which this plan builds unless the coordinator rules otherwise.

1. **Three new inputs, not four (ruled; slug `three-inputs-not-four`).** H16, Table 11.1a, Table 11.1b and Appendix B
   list four: the billing fact, the hold-down, the continuity record and the asking session's id. The hold-down is
   ccd's alone, decided at the settle (the ccd arms plan's question 3, ruled for its PR B). So this piece adds three,
   and neither twin carries a hold-down. The H16 and Appendix B fix goes to the operator through the spec-fixes run.
   This plan depends on that ruling and names it in PR A's body.
2. **The asking session's id is threaded into `_serviceable` and `_class_gate` (ruled).** The ccd arms' fresh pick and
   settle (its PRs C1 and C2) call `_class_gate` with the id. This piece owns that seam: PR A adds the optional third
   argument to both functions and passes it at every caller that holds a session id today. The ccd arms' calls pass
   it when they land.
3. **ccd is the authority for placement (ruled).** The server forecasts and refuses with the TypeScript twin and never
   places. Nothing in this piece writes a route, a marker or a registry file.
4. **The account facts are set from Settings (index question 34, ruled).** Their writer is "the operator, from
   Settings" (Table 11.1a). This piece ships the server door and widens `ACCOUNT_KEYS`. Home PR C ships the PWA row.
   A hand edit of `accounts.json` is no W1 path.
5. **What the asking session's id selects** (slug `set-side-selects-the-overlord-arms`). H16 says the answer "knows
   those two by the route record the server wrote on their rows (C46)". The route record that marks them is the set:
   the designation writes `poolset` on the Overlord's row, and the replay lane writes the Overlord's set on the replay
   body's (Table 11.1c). **Recommendation:** the strict arms apply when the session's side, read by the one reader of a
   session's side, is a set or an undecidable set. In bash that is `ccd/lib/pool-set.sh#_session_pool_side` answering
   `set <spelling>`, `set-unreadable` or `set-malformed`; in TypeScript, `askingOf(side)` over the same
   `SessionPoolSide`. No role list and no new projected column: a list of role names in ccd would be a second
   definition of the roles, and a projected column would read as absent on a box whose `launch-profiles.json` is
   older, which would drop the strict arms from the Overlord. Every project word, `unreadable` included, reads as not a
   set. An unsearchable `$REG` also answers `unreadable`, and there the pool rule already refuses every placement, so
   nothing is placed either way.
   - **No fork without a set (ruled, F7).** `_session_pool_side` is called only when the session's `poolset` entry
     exists (`[[ -e "$REG/$id.poolset" || -L "$REG/$id.poolset" ]]`, the function's own first test). So a session
     with no set pays no fork, `server/test/ccd-tick-budget.test.ts`'s exact ratchet stays as it is for every fixture
     with no set, and a set-side session pays one fork a call.
   - **Whatever its class (ruled, F8).** A set-side asker is held to the continuity record whatever its class, an empty
     or `default` class included: the continuity arm runs before the `default` fold, in both twins, and `_class_gate`
     no longer folds an empty or `default` class to 0 before asking when it holds an id. Fail closed: a route record
     whose set was written before its class still never lands on a lane with no record.
6. **What an unset or unread fact answers** (slug `unread-facts-refuse-with-their-own-words`). The spec says "an account
   with no billing fact reads as billing Fable to credits" (H16), and W0b recorded the same conservative branch ("an
   account whose billing fact is unread is treated as if credits were on"). It says "a lane without one never serves
   the Overlord" for the continuity record. **Recommendation:** for a set-side asker these refuse, the fail-closed
   direction, and each of the five keeps its own word so the remedy stays visible: `credits` (the fact says credits),
   `billing-unset` (the roster has no fact), `billing-unread` (this box's `accounts.sh` predates the fact), and
   `no-continuity` or `continuity-unread`. None of them is `unmeasured`: an absent record is the fact "no record", and
   reading it as unmeasured would keep the Overlord on a lane nobody checked, because an unmeasured lane stays eligible
   at every placement path.
7. **What the settle does on a lane with no continuity record** (slug `continuity-refusal-degrades-nothing`).
   `ccd/ccd#_spawn_start`'s settle answers an unservable class by stamping the class one rung down. With no continuity
   record no rung serves, so a stamp would claim a fallback that does not exist. **Ruled (F4):** on `no-continuity` or
   `continuity-unread` the settle:
   - writes no `degraded` stamp and calls neither `_route_degrade` nor `_route_restore`, so a stamp already standing
     stays on disk, untouched, for the next settle on a recorded lane to judge;
   - sets the local `rdeg` to empty, so the `[[ -n "$rdeg" ]] && rclass="$rdeg"` line after the `case` composes the
     intended class, never a standing stamp's class one rung down;
   - writes one new `swap.log` line, in this one spelling:
     `continuity-unmet <id>: <wrapper> (<word>); composing <class>, a standing degraded stamp left as it is`.

   This is a new write. Today's bottom rung (`haiku`) writes nothing at all. The renewal lane's `classUnservable`
   reading (Task 4) then reads the generation unservable, a hard trigger, and the next fresh start's pick leaves the
   lane. Every planned placement already skips the lane, because `_class_gate` answers 1 there.
8. **Where the server door is** (slug `facts-ride-the-account-set-door`). The index asks for a Settings server door.
   `POST /api/accounts/:id/set` (`server/src/accounts/routes.ts`) is already the operator's door for one account's
   settings, behind the account gate, and `ccrc account set` is already its verb. **Recommendation:** widen that door
   with two body keys, `fableBilling` and `continuity`, and the verb with two flags, rather than open a second door for
   the same account (CLAUDE.md, "Consolidate, don't duplicate"). No route is added, so no door census moves. The
   step-up applies whenever the body names a widening value (`fableBilling: 'included'` or `continuity: 'on'`), whatever
   the stored value, so the door never compares against a roster mirror that may lag the fleet box's file. Narrowing
   needs none (Table 11.1d's rule for settings: "behind the step-up where the change widens authority").
   **Ruled (F10):** this is a third kind of `set` step-up, beside a method change and a raised minted-key commitment.
   Task 3 updates the route's docblock (`server/src/accounts/routes.ts`, the write-routes comment, which says those
   two are "the only `set`s spec §3.2 steps up") and the accounts spec's list of step-ups
   (`docs/superpowers/specs/2026-10-18-accounts-connect-design.md`, the "Step-up for the acts that put, replace or
   delete a credential" bullet) to name the widening facts.
9. **The facts' spellings** (slug `account-fact-spellings`). **Recommendation:** `fableBilling`, `"included"` (Fable
   runs inside the plan's limits) or `"credits"` (Fable bills usage credits), absent when nobody set it; and
   `continuity`, `{"recordedAt": <epoch seconds>}` when the operator recorded the lane, absent otherwise. The record's
   time is written by the verb's clock when the operator sets it, so the console can show how old a record is. An
   explicit `null` in the file is refused, as `pool`'s is. **Ruled (F11):**
   - the op takes the time as a flag, `--recorded-at now|<epoch seconds>`, the shape of `--last-run-at now`
     (`deploy/account-op.mjs`'s `laneTimeOf`): `now` is `Math.floor(Date.now() / 1000)`, the conversion from the
     process's milliseconds to the record's seconds, and the op's tests pass a number;
   - `--continuity on` over a standing record keeps its `recordedAt`, so a second identical `set` changes no byte, and
     refreshing a record is `off` then `on`;
   - a `set` that changes nothing writes no byte of the roster and exits 0. `_acct_set` then regenerates the projection,
     as it does after every placement write, which reproduces the same bytes. The op prints nothing either way:
     `_acct_write_op` refuses `helper-noisy` on output.
10. **Whether this piece lands before pool set B** (slug `serviceability-a-before-pool-set-b`). Table 11.1a says an
    older ccd ignores the fields. A designation needs `pool-set`, which pool set B adds last. **Recommendation:** PR A
    merges before pool set B, so every ccd that advertises `pool-set` also carries the strict arms, and no new
    capability word is needed. If the coordinator prefers to land pool set B first, the gap is a fleet box whose ccd
    places the Overlord without the two facts until its next update, and the designation's own count (which reads the
    TypeScript twin) still refuses a set with fewer than two recorded lanes.
11. **The load lines live in one constants module (index question 7).** **Recommendation:** `shared/loadLines.ts` holds
    70, 85 and 95 as starting values, beside the freshness bound and the runway's bounds. The spec-fixes run adds the
    95% row to Table 11.5b (70% and 85% are there already, from the W1 index's `load-lines-are-starting-values`).
12. **The sampler's cadence, retention and reader (index question 8).** Measured (What exists today): the watcher reads
    every account's limits once a tick, every 2 seconds, and publishes the reading as `currentLimits()`. A reading
    changes whenever a session on that account renders its statusline, and an idle account's reading is refreshed by
    the telemetry keepalive at most every 30 minutes. **Recommendation:** the sampler is a `LANE_SCHEDULE` row,
    `limitSamples`, every 5 minutes, writing the tick's published reading. It adds no read of its own. It writes one
    row per account per new reading time, so an idle account adds no rows, and keeps rows 30 days. That is at most 288
    rows an account a day. It samples `telemetry: 'anthropic'` accounts only (F14, adopted): the codex lanes' files
    have other writers, among them ccd's synthetic exclusion row, and no lane outside Anthropic is an Overlord
    candidate in W1 (question 17).
13. **How old a reading may be** (slug `load-reading-fresh-for-an-hour`). Today a five-hour reading counts until its own
    reset passes, or until it is 18,000 seconds old (`server/src/limits.ts#readLimits`), so a reading nearly five hours
    old still reads as the account's load. ccd's pick keeps that rule (the ccd arms plan, "What the decider reads, and
    how old"). **Recommendation:** the server's load lines and `poolRunway` bound it. A reading older than
    `LOAD_FRESH_S`, one hour, proves nothing "under" for them (a reading at or past a line stays past until its window
    resets, because a load only rises inside a window, so only an "under" claim and a rate need it). One hour is longer
    than the keepalive's default 30-minute window plus its 15-minute timer, so on a box that runs the keepalive with its
    defaults every measured account stays fresh, and a test pins that relation against the defaults. An operator who
    widens `CCRC_KEEPALIVE_FRESH` past it gets unmeasured lines, which apply the ladder's cap (question 14), never a
    stale "under". The bound changes no placement: ccd's readers are untouched, and a maximum age for them stays the ccd
    arms plan's "Later" item.
14. **A load line never folds an unmeasured account into a value** (slug `under-is-proven-past-needs-all`). §6.8
    measures a line "on the least-loaded account that can serve the Overlord now". **Recommendation:** "under the line"
    is proven by any one candidate with a fresh reading under it. "Past the line" needs every candidate's unrolled
    reading at or past it, at any age (question 13), because an unmeasured account might be the least loaded.
    Otherwise the line reads `unmeasured`.
    - **Which accounts are candidates (ruled, F1).** An account that cannot serve because its load is at the ceiling
      stays a candidate with its figure, so it reads past every line, and is never dropped. Only the non-load refusals
      drop an account: disabled, signed out, or both classes refused by `backend`, `credits`, `billing-unset`,
      `billing-unread`, `no-continuity` or `continuity-unread`. An empty candidate set reads `unmeasured`
      (`no-candidate`). So the cap cannot lift as the load rises from 96% past 98%, and Task 4 tests both.
    - **What `unmeasured` does (ruled, F3).** The ladder's rule governs (the ladder plan's question 17,
      `unmeasured-condition-caps`): an `unmeasured` condition input applies its cap. So an unmeasured 95% line caps the
      rung at `chat`, where §6.8 says an unmeasured load "caps no rung". That sentence goes to the spec-fixes run. The
      70% and 85% lines' readers (W2, W3) keep §6.8's own rule for their own effects.
15. **What `poolRunway` answers** (slug `runway-is-a-line-crossing`). C57: "a time, 'not before reset', or
    unmeasured", and "either line may also read 'projected past the line before the next renewal'". **Recommendation:**
    one rule answers both. For a line, the pool crosses it when its last account does, and an account crosses when its
    first window does, projected on a straight line from the window's samples. Running out is crossing the ceiling
    (`SEVEN_DAY_CEILING_PCT`, 98, the figure placement already refuses at). The decider answers a crossing time per
    line and for the ceiling, and the caller compares a line's time with the next renewal it knows. It also answers the
    earliest reset at which an exhausted account regains headroom, which `stranded`'s item names. **Ruled (F2):** that
    answer is tagged, never a bare `null`: `none-exhausted`, `{ at }`, or `unmeasured` with its reason (Task 4).
16. **Where `classUnservable` comes from** (slug `class-unservable-from-the-server-twin`). Table 3.4b says "ccd's
    serviceability answer, asked by the renewal lane on each sweep". **Recommendation:** the renewal lane asks the
    TypeScript twin over the tick's readings, which the shared fixture table holds equal to ccd's answer, and no new
    ccd read is added. `ccd pool-answer` stays the pool set's one read verb.
17. **`fable` judged lane by lane** (slug `fable-lane-by-lane-waits-for-the-listing`). H16 changes "`fable` is
    unservable on every lane that is not an Anthropic backend" to "unservable on a lane whose registry has no `fable`
    slot". In W1 no lane outside Anthropic can serve the Overlord: the operator's listing of another provider's lane
    (C56) does not exist yet, and the fresh pick admits Anthropic lanes only (`_fresh_pick_ok`, the ccd arms plan).
    **Recommendation:** not in this piece. The piece that adds the operator's listing changes the `backend` arm in both
    twins, with its fixture rows. Until then the `backend` word keeps every non-Anthropic lane off Fable, which is the
    narrower answer.
18. **The shared Fable test (C46's open question for W1).** C46 leaves to W1 whether W0-24 still informs the shared
    Fable test. **Recommendation:** no change. `FABLE_SHARE_CEILING_PCT` stays 40 and the test stays the same for every
    session (H16, "Fable is judged as for any session"). The sweep found no priced Fable use on any account (W0b), so
    there is nothing yet to calibrate it against.

## What exists today

Measured on `main` at `4fda398e4`.

- **The serviceability answer.** `shared/serviceability.ts#serviceability(cls, lane, nowS)` answers `skipped`
  (`default`), `servable` with the figure, `unservable` (`ceiling` with the figure, or `backend`) or `unmeasured`
  (`no-figure`, `stale`). `LaneFacts` is `{ anthropic, seven, share }`. It imports only `shared/models.ts`. Its bash
  twin is `ccd/ccd#_serviceable` (`wrapper class`, rc 0 servable, 1 unservable, 2 unmeasured, 3 skipped, and the word
  or figure on stdout), with `ccd/ccd#_class_gate` folding `skipped` into 0 and `ccd/ccd#_share_pct` reading the
  sweep. One fixture table, `server/test/fixtures/serviceability.ts#SERVICEABILITY_CASES`, drives both through
  `server/test/serviceability.test.ts` and `server/test/ccd-serviceable.test.ts`, whose lanes are the fixture roster's
  `claude` (Anthropic) and `gpt` (codex).
- **Its callers.** TypeScript: one, `server/src/limits.ts#projectHome`, which filters out a lane measured
  `unservable`; `projectPlacement` composes it. `server/test/projected-home.test.ts` drives it against
  `_ws_least_loaded` over `server/test/fixtures/leastLoaded.ts`. Bash, by function:
  - with a session id in hand: `_swap_target` (five `_class_gate` calls; `$1` is the id), `_affinity_cur_serves`
    (`$1`), and `_spawn_start`'s settle (`_serviceable "$wrapper" "$rclass"`, with `$id` in scope);
  - with no session: `_ws_least_loaded`, `_ws_lane_why` and `_place_for_class`, which place a workspace by project and
    class. Table 3.4d leaves them unchanged: they are not the Overlord's placer.
- **The settle.** `_spawn_start` reads the standing stamp into `rdeg` before it asks, and its `case "$srv"` restores a
  degraded class on rc 0 and on rc 1 stamps the class one rung down through `_route_degrade`, reading the word
  `_serviceable` printed. After the `case`, `[[ -n "$rdeg" ]] && rclass="$rdeg"` composes the stamp's class. At
  `haiku` the rc 1 arm writes nothing at all, not even a `swap.log` line.
- **The tick's fork budget.** `server/test/ccd-tick-budget.test.ts` is an exact ratchet on the forks one supervise tick
  makes, and its fixtures run `_swap_target` with a named class, so a new fork on that path reds it.
- **The session's side.** `ccd/lib/pool-set.sh#_session_pool_side id [project]` (pool set A2, merged) is the one
  reader of a session's pool side. With a project argument passed, even an empty one, it reads no registry field
  beyond the `poolset` entry. `shared/poolrule.ts#SessionPoolSide` is its TypeScript type.
- **The roster.** `shared/roster.ts#AccountDef` carries `id`, `label`, `configDirSuffix`, `exec`, `homeAble`, `hue`,
  `telemetry`, `hidden` and `pool`. `ACCOUNT_KEYS` (not exported) names them for `warnUnknownKeys`, which warns and
  never fails. `pool` is required on the type, `null` when absent, and a written `null` is refused. The bare-Node
  mirror is `shared/roster-json.mjs`, whose output type is declared in `shared/roster-json.d.mts` (it carries
  `pool: string | null`), held equal by `server/test/roster-exec-parity.test.ts`, and the README's
  roster-mirror table is pinned cell by cell by `server/test/readme-roster-mirror.test.ts` against both files and
  `server/test/gen-accounts.test.ts`'s cases. `shared/generate.mjs` writes `~/.ccrc/accounts.sh`, and emits
  `_ccrc_pool` always, so `declare -F _ccrc_pool` tells ccd whether the box's projection knows pools. The browser's
  copy is `shared/api.ts#RosterWire`, which `extends RosterKindWire`; its builder is `GET /api/accounts`'s roster in
  `server/src/server.ts`.
- **The account set door.** `POST /api/accounts/:id/set` (`server/src/accounts/routes.ts`) takes the account gate with
  `cap` and no step-up, accepts the body keys `stated` and `placement` (`onlyKeys`), writes one account audit row, and
  runs `ccrc account set` through the `AccountOps` port (`server/src/accounts/ops.ts`): on the fleet node through the
  agent's `account` op in remote mode, locally otherwise. `shared/account-argv.ts#buildAccountArgv` bounds each field
  for both arms (`set`'s fields today: `placement`, `limit`, `limitReset`). `ccd/ccrc#_acct_set` parses the flags,
  takes `_acct_lane_lock`, writes through `deploy/account-op.mjs` (`opSetPlacement`, op `set-placement`) and then
  `_acct_projection`, which regenerates `accounts.sh`. `_acct_write_op` refuses `helper-noisy` if the op prints
  anything, so an op answers by its exit code alone. `_acct_set`'s guards know only today's flags: the `--method`
  form's `bad-argument` check names `--stated` and `--placement`, and the `missing-value` sentence says "needs
  --stated - or --placement overflow|full". The op takes time from its own clock (`laneTimeOf`'s `now`, an ISO
  string), and has no seam for it. `ccrc account set` is already one of the subs no session may run
  (`shared/api.ts#ACCOUNT_DENY_RULES`, CLAUDE.md "Account management is never a session's"), pinned by
  `server/test/account-deny.test.ts`. The door's tests are `server/test/account-routes-write.test.ts`, whose `ROUTES`
  table pins `set` at `stepUp: false` with a `placement` body, and whose "set and the revoke tick" describe holds its
  cases. The route's docblock says `stated` and `placement` need no step-up because they are not "the only `set`s spec
  §3.2 steps up" (a method change and a raised minted-key commitment), and the accounts spec lists the same two.
- **Limits.** `server/src/limits.ts#readLimits` reads every `~/.cc-limits/<id>.json`. A window whose reset passed, or
  a reading older than its window (18,000 s and 604,800 s), is rolled over: its figure reads 0 with the flag set.
  `measured()` is the larger of the two windows, `null` unless both are measured and neither rolled (a lane with no
  five-hour window, `fiveWindowMinutes: 0`, ranks on its weekly figure). `FleetWatcher.tick` (`server/src/watch.ts`)
  calls `readLimits` once a tick over the tick's own listing and publishes it as `currentLimits()`. The watcher's
  interval is 2,000 ms (`FleetWatcher`'s constructor).
- **Who writes a limits file, and how old a reading is.** An Anthropic account's reading is written by
  `ccd/statusline-command.sh` at each render of a session on that account. Other writers exist: `ccd/ccgpt-usage.py`
  publishes the codex lanes' files about every 20 minutes; `_auto_swap_check` writes a synthetic exclusion row
  (`{"five":100,"seven":0,"ts":N}`, no reset times) for a non-Anthropic lane, which `readLimits` reads as `five` 100
  for five hours; `_rescue_prev_restore` writes an earlier file's bytes back or removes it; and an account's removal
  deletes its file. An idle account is refreshed by `ccd/ccd-telemetry-keepalive`, which takes one turn on an
  account that has not reported for `CCRC_KEEPALIVE_FRESH` (1,800 s) on a 15-minute timer
  (`deploy/systemd/ccd-telemetry-keepalive.timer`), on a box that installs it. ccd's own pre-emptive freshness is
  `SWAP_FRESH=1800`.
- **The renewal inputs.** `server/src/continuity/renewalDue.ts#RenewalInputs` declares `classUnservable` and
  `accountLoadMove` as `Reading<boolean>`, the type `server/src/continuity/renewalDue.ts#Reading` defines (L1, C3), and
  `server/src/continuity/generationsLane.ts#renewalInputsOf` answers both `W1` ("later") today. The renewal readings
  piece wires them.
- **The ladder (not on `main`; the ladder plan, `w1-ladder.md`, in its own fix round).** A later cause joins by one row
  in `LADDER_CAUSE_MAP` (`shared/overlord-ladder.ts`) and, for a condition, one key in `ladderConditionInputs`
  (`server/src/coord/overlordLadderRead.ts`), whose mapped type makes a condition row with no input a compile error.
  A condition input answers `standing`, `lifted` or `unmeasured`, and an `unmeasured` input applies the row's cap (its
  question 17). Its cross-plan seams table names `load-past-95` (condition, cap `chat`) as this piece's PR B. A
  condition that reads a designated session reads `lifted` with nobody designated (its question 19), and `unmeasured`
  when the designation cannot be read (its `degradedReading`).
- **Migrations.** `server/src/coord/db.ts`'s rules: a database is never opened empty, and a `user_version` higher than
  this build's is not fatal: an older build reads the newer file as it is, and warns. `origin/main`'s migrations end at
  76 (#2842), so this piece's number is taken when it is built and re-measured at landing.
- **No history of limits.** No `limit_samples` table, sampler, `poolRunway` or load line exists in the tree
  (`git grep` for each).
- **Censuses a new table, lane or decider touches.** `MUTANT_SETS` in `server/test/sim/mutation-floors.test.ts` with
  `server/test/sim/mutation-floors.json` (one `*Sets.ts` file per piece, such as `poolSetSets.ts`); `LANE_SCHEDULE`
  and `LaneName` in `server/src/laneSchedule.ts`, pinned by `server/test/lane-schedule.test.ts`, with
  `server/test/laneQuiet.ts` and `server/test/watcher-quiet-census.test.ts`; `TABLES` in
  `server/test/single-definition/writers-map.test.ts`; `TIME_PORT_FILES` in
  `server/test/single-definition/time-ports.test.ts`; `server/src/coord/ports.ts#WatcherCoordMember` with
  `server/test/rings/watcher-store-port.data.ts`; the C1 row of the architecture spec's path table
  (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`), which lists `limits.ts` and `pools.ts` by name;
  and for a migration, `server/test/run-close-switch.test.ts` and `server/test/coord-db.test.ts`.
- **Growth.** `server/test/growthCheck.ts#GROWTH_FILES` holds `ccd/ccd`, `ccd/ccrc`, `deploy/account-op.mjs`,
  `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts`, `server/src/server.ts` and
  `shared/api.ts` among others, at 40 net lines a pull request. `shared/roster.ts`, `shared/generate.mjs`,
  `server/src/accounts/routes.ts` and `server/src/limits.ts` are not listed.

## Global Constraints

- **Architecture (`CLAUDE.md`).** Decide in L1, act in L4. `serviceability`, `askingOf`, `factsChangeWidens`,
  `poolRunway`, `loadLines`, `classUnservableReading` and `accountLoadMoveReading` are pure. The door, the sampler and
  the ladder's assembly gather facts and act on the answer. No L1 module imports an adapter or a lane.
- **One writer per fact.**
  - The billing fact and the continuity record: `deploy/account-op.mjs`'s new `set-facts` op, reached only through
    `ccrc account set`, reached from the console only through the account set door. `accounts.sh`'s two new functions
    are a projection with one writer, the generator.
  - `limit_samples`: the sampler, through `limitSamplesStore.ts`'s insert and prune. `writers-map.test.ts` names both.
  - The hold-down: ccd's settle, untouched here (question 1).
- **ccd places; the server forecasts.** The TypeScript twin answers the forecast, the designation's count and the
  renewal readings. ccd's answer decides every placement. The fixture table holds them equal.
- **No overloaded null at a seam.** An unset fact, an unread fact and a refusing fact are three words. A load line
  answers `under`, `past` or `unmeasured`, `poolRunway` answers a time, "not before reset" or `unmeasured`, and its
  earliest reset answers `none-exhausted`, a time or `unmeasured`, each with the reason (ruled, F2). A stale reading is
  unmeasured, never "under" (question 13).
- **The ladder's rule governs an unmeasured input (ruled, F3).** The 95% row's input maps `past` to `standing`, `under`
  to `lifted` and `unmeasured` to `unmeasured`, which the ladder applies as its cap.
- **Behaviour for every session that is not a set-side asker is unchanged.** Its answer is byte for byte today's: the
  new arms run only for a set side (question 5), and the new facts are not read otherwise. The fixture table carries
  every existing row unchanged with the asker `other`. A session with no `poolset` entry makes no new fork, so
  `ccd-tick-budget.test.ts` stays as it is.
- **No account-name list in shipped source.** Fixtures use neutral lanes (`lane-a`, `lane-b`, `lane-c`) and pools
  (`pool-a`, `pool-b`). The existing fixture rows keep their lanes.
- **Account management stays the operator's.** The new flags ride a sub no session may run. A refused form in
  `account-deny.test.ts` proves the deny matches the new flags too (Task 3).
- **Wire discipline.** `RosterWire` gains two optional fields through a sibling interface. An older server omits them,
  and their one reader (home PR C) reads absence as "not set". `FLEET_PROTO` is not bumped.
- **One concern per file** (the index's `wire-types-in-sibling-modules`). New wire types go in `shared/rosterFacts.ts`
  and `shared/loadLines.ts`. `shared/api.ts` gains one import and one `extends` member.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`. Each task's last run
  adds both `tsc` runs (`ccrc test -- npx tsc --noEmit -p tsconfig.json` and `-p test/tsconfig.tests.json`),
  `test/typecheck-tests.test.ts`, and pwa's `tsc` when `shared/` changed. A task that touches `ccd/ccd` runs
  `test/shellcheck-ratchet.test.ts`, `test/ccd-contexts.test.ts` and `test/ccd-tick-budget.test.ts` too.
- **Mutation floors.** Every new L1 decider joins `MUTANT_SETS` through `server/test/sim/serviceabilitySets.ts`
  (PR A) and `server/test/sim/accountLoadSets.ts` (PR B), with its floor in `mutation-floors.json`, in the pull request
  that creates it. Mutants are built with `mutation-run.py`, never by hand.
- **Growth check.** Each pull request states its estimate (The PR split) and the builder measures it before pushing.
- Cite by symbol or `@anchor`. No private names. No D-number invented: the builder's departures go in
  `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability/departures.md`.

## Review Focus

1. **Parity.** Every row of `SERVICEABILITY_CASES`, old and new, answers the same kind and word in both twins, the new
   asker and fact columns included. A new arm in one twin with no row reds the table's coverage check.
2. **Unchanged for everyone else.** No answer changes for an asker that is not a set side. The existing rows pass
   unedited, and `projected-home.test.ts` passes unedited.
3. **Fail closed, never folded.** An unset or unread billing fact refuses Fable for a set side, and an absent or unread
   continuity record refuses every class, each with its own word. A load reading older than `LOAD_FRESH_S` proves
   nothing "under", and a rolled-over or absent one proves nothing at all. A line reads `past` only when every candidate
   reads at or past it, an account at the ceiling counts as past with its figure, and an empty candidate set reads
   `unmeasured`, which caps (F1, F3). A set-side asker meets the continuity arm whatever its class (F8).
4. **The settle never claims a fallback that does not exist.** On `no-continuity` it stamps nothing, restores nothing,
   composes the intended class and writes its one `continuity-unmet` line (F4).
5. **The door steps up on every widening value.** `included` or `on` in the body takes the step-up, whatever is stored.
   A narrowing never needs one. No new door, so no census moves. The route's docblock and the accounts spec's step-up
   list name the new case (F10).
6. **One writer each.** The facts are written only by `set-facts`, and `limit_samples` only by the sampler.

## Figures

```mermaid
flowchart LR
  OP["Operator, Accounts screen"] -->|"POST /api/accounts/:id/set"| DOOR["account set door: gate, step-up on a widening value"]
  DOOR -->|"ccrc account set --fable-billing / --continuity"| VERB["_acct_set on the fleet node"]
  VERB -->|"set-facts"| ROSTER["accounts.json"]
  VERB -->|"_acct_projection"| SH["accounts.sh: _ccrc_fable_billing, _ccrc_continuity"]
  ROSTER --> TS["serviceability() in shared/serviceability.ts"]
  SH --> BASH["_serviceable in ccd"]
  SIDE["the session's side: _session_pool_side / askingOf"] --> TS
  SIDE --> BASH
  BASH --> PLACE["ccd's placements: _swap_target, the settle, the fresh pick"]
  TS --> FORECAST["the server's forecast, the designation's count, classUnservable"]
```
*Figure 1. PR A: the two facts, their one writer, their two readers, and who reads each twin.*

```mermaid
flowchart LR
  TICK["FleetWatcher.tick: readLimits every 2 s"] -->|"currentLimits()"| SAMPLER["limitSamples lane, every 5 min"]
  SAMPLER -->|"insert, prune after 30 days"| TABLE["limit_samples in coord.db"]
  TABLE --> RUNWAY["poolRunway: crossing times, earliest reset"]
  TICK --> LINES["loadLines: under, past or unmeasured"]
  LINES --> LADDER["the ladder: past 95% caps chat"]
  LINES --> MOVE["accountLoadMoveReading"]
  RUNWAY --> READY["readiness and home B: stranded's reset, the capacity line"]
  MOVE --> RR["the renewal readings piece wires the readings"]
```
*Figure 2. PR B: one read a tick, sampled every five minutes, and the four readers of what it measures.*

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate |
|---|---|---|---|---|
| A, the facts and the three inputs | 1 to 3 | The billing fact and the continuity record in the roster, its mirror, `accounts.sh` and `RosterWire`; the three inputs in both twins, the id threaded to every caller that holds one, and the settle's continuity arm; the widened account set door and verb | pool set A3 merged (`_session_pool_side`, A2, is on `main`). Lands before pool set B (question 10) | `ccd/ccd` about +22 (`_serviceable` +13 with the existence guard, `_class_gate` +3, the settle +6, the seven callers rewritten in place); `ccd/ccrc` about +14 (two flags, the widened guards, the facts write); `deploy/account-op.mjs` about +24; `shared/api.ts` +2; `server/src/server.ts` +1 |
| B, limits, runway and the 95% line | 4 to 7 | `shared/loadLines.ts`; `poolRunway`, `loadLines` and the two renewal readings; `limit_samples` and its store; the sampler lane; the ladder's 95% cause row | PR A and the ladder merged (and so designation A, for `overlordAccounts` and `designationRead()`) | `server/src/coord/schema.ts` about +18 (the number re-measured at landing); `server/src/coord/store.ts` about +3; `server/src/watch.ts` about +6 |

No task needs a waiver. If a measurement at build time shows `ccd/ccd` past 40, the settle's arm moves to its own
helper in the same file, and nothing else moves.

**States the next pieces read.** Home PR C reads `RosterWire.fableBilling` and `RosterWire.continuity` and writes
through the widened door. The designation's count reads `serviceability` with the asker `set-side`. The ccd arms' pick
and settle pass the id to `_class_gate`. Readiness reads `poolRunway`'s earliest reset for `stranded`'s item, and home
B reads its crossings for the capacity line. The renewal readings piece wires `classUnservableReading` and
`accountLoadMoveReading` into `renewalInputsOf`.

---

### Task 1: The two facts in the roster, its mirror, `accounts.sh` and the wire (PR A)

**Files:**
- Create: `shared/rosterFacts.ts` (L0, C1).
- Modify: `shared/roster.ts` (`AccountDef`, `ACCOUNT_KEYS`, `parseAccount`), `shared/roster-json.mjs` (the same gates),
  `shared/roster-json.d.mts` (the mirror's output type gains the two fields), `shared/generate.mjs` (two emitted
  functions), `shared/api.ts` (`RosterWire`), `server/src/server.ts` (the roster
  wire builder), `README.md` (two rows of the roster-mirror table, and the `accounts.sh` function list if it has one).
- Test: `server/test/roster.test.ts`, `server/test/roster-exec-parity.test.ts`, `server/test/gen-accounts.test.ts`,
  `server/test/roster-generate.test.ts`, `server/test/readme-roster-mirror.test.ts`,
  `server/test/accounts-route.test.ts`.

```ts
// shared/rosterFacts.ts — L0: imports nothing.
/** H16: does Fable on this account bill usage credits. Absent in the file means nobody set it. */
export const FABLE_BILLINGS = ['included', 'credits'] as const;
export type FableBilling = (typeof FABLE_BILLINGS)[number];
/** H16, continued: the operator recorded that this lane keeps the Overlord's guards, hooks and reader types. */
export interface ContinuityRecord { readonly recordedAt: number }   // epoch seconds, the verb's clock
/** What `RosterWire` carries, both optional: an older server omits them, and absence reads as "not set". */
export interface RosterFactsWire { readonly fableBilling?: FableBilling; readonly continuity?: ContinuityRecord }
/** The door's body: a change to either fact. */
export interface RosterFactsChange { readonly fableBilling?: FableBilling; readonly continuity?: 'on' | 'off' }
/** True when the change names a widening value, whatever is stored (question 8): the door steps up. */
export function factsChangeWidens(c: RosterFactsChange): boolean;
export function rosterFactsWireOf(a: { fableBilling: FableBilling | null; continuity: ContinuityRecord | null }):
  RosterFactsWire;
```

- `AccountDef` gains `fableBilling: FableBilling | null` and `continuity: ContinuityRecord | null`, required on the type
  with `null` for absent, as `pool` is. `parseAccount` refuses a written `null`, a word outside `FABLE_BILLINGS`, a
  `continuity` that is not an object with one non-negative integer `recordedAt`, and extra keys in it, each with a
  `RosterError` whose remedy names the field. `roster-json.mjs` makes the same refusals, and the parity suite drives
  both over the same bytes.
- `generate.mjs` emits `_ccrc_fable_billing` (`<id>) echo included ;;` or `credits`) and `_ccrc_continuity`
  (`<id>) echo <recordedAt> ;;`) always, even with no arms, so `declare -F` tells ccd whether this box's projection
  knows the facts, as `_ccrc_pool` does. Only a value the parser admitted is emitted.
- `RosterWire` becomes `extends RosterKindWire, RosterFactsWire`. The builder spreads `rosterFactsWireOf(a)`.
- [ ] **Step 1: Failing tests.**
  - `roster.test.ts`: a roster with neither field parses with both `null`; each refusal above; the two keys raise no
    unknown-key warning; `fableBilling: "credits"` and a record parse.
  - `roster-exec-parity.test.ts`: every new refusal is refused by both parsers, every accepted row accepted by both.
  - `gen-accounts.test.ts` and `roster-generate.test.ts`: the two functions are emitted with no arms for a roster with
    no facts, and with one arm per account that has one; `bash -n` passes; sourcing it answers the values.
  - `readme-roster-mirror.test.ts`: the two new table rows resolve in all three files.
  - `accounts-route.test.ts`: `GET /api/accounts`'s roster carries the two fields for an account that has them, and
    omits both for one that has neither.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the suites above, the pwa suite's roster readers
  (`pwa/test/accounts*.test.tsx`), and the `tsc` runs. Green.
- [ ] **Step 5: Mutation.** Let the parser accept a written `null`: the refusal case goes red. Drop the
  always-emitted empty function: the `declare -F` case goes red. Mutants of `factsChangeWidens` join
  `serviceabilitySets.ts` in Task 2.
- [ ] **Step 6: Commit.** `feat(roster): each account's billing fact and continuity record, in the roster, its mirror, accounts.sh and the wire (H16)`

### Task 2: The three inputs, in both twins and at every caller (PR A)

**Files:**
- Modify: `shared/serviceability.ts`, `server/src/limits.ts#projectHome` (one call), `ccd/ccd` (`_serviceable`,
  `_class_gate`, `_swap_target`, `_affinity_cur_serves`, `_spawn_start`).
- Modify: `server/test/fixtures/serviceability.ts` (two columns and the new rows), `server/test/serviceability.test.ts`,
  `server/test/ccd-serviceable.test.ts` (the harness writes the case's `poolset` entry and an `accounts.sh` built from
  the case's facts), `server/test/ccd-route-degrade.test.ts` (the settle's new arm), `server/test/ccd-swap-target-class.test.ts`
  (the id reaches the gate; the builder adds any other suite `git grep _swap_target server/test` names).
- Create: `server/test/sim/serviceabilitySets.ts`; modify `server/test/sim/mutation-floors.test.ts` and
  `mutation-floors.json`.

```ts
// shared/serviceability.ts, the widening. It imports only sibling `shared/` modules, as today.
/** Whose question (question 5): a session whose side is a set, or an undecidable set, gets the Overlord's arms. */
export type Asking = 'set-side' | 'other';
export function askingOf(side: SessionPoolSide): Asking;   // set, set-unreadable, set-malformed -> 'set-side'
export interface LaneFacts {
  anthropic: boolean;
  seven: number | null;
  share: ShareReading | null;
  /** The roster's fact, or `unset` (no fact), or `unread` (a projection that predates the fact: bash only). */
  fableBilling: FableBilling | 'unset' | 'unread';
  continuity: 'recorded' | 'none' | 'unread';
}
export type Serviceability =
  | { kind: 'skipped' }
  | { kind: 'servable'; figurePct: number }
  | { kind: 'unservable'; why: 'ceiling'; figurePct: number; ceilingPct: number }
  | { kind: 'unservable'; why: 'backend' | 'credits' | 'billing-unset' | 'billing-unread'
      | 'no-continuity' | 'continuity-unread' }
  | { kind: 'unmeasured'; why: 'no-figure' | 'stale' };
export function serviceability(cls: ModelClass | 'default', lane: LaneFacts, asking: Asking, nowS: number):
  Serviceability;
```

The order, first match wins (F8: the continuity arm runs before the `default` fold for a `set-side` asker):
1. for a `set-side` asker, a continuity record that is not `recorded` refuses every class, `default` included
   (`no-continuity`, `continuity-unread`);
2. `default` is `skipped` (unchanged);
3. `fable` on a non-Anthropic lane is `backend` (unchanged);
4. for a `set-side` asker, `fable` with a billing fact other than `included` is `credits`, `billing-unset` or
   `billing-unread`;
5. today's share and seven-day tests, unchanged.

`asking` is required, so every TypeScript caller says which it means. Inserting it before `nowS` edits the direct
calls in `serviceability.test.ts` and the `LaneFacts` literal on `ccd-serviceable.test.ts`'s TypeScript side; the
fixture rows stay unedited. `projectHome` passes `'other'` and the lane's facts through one helper beside it, so its
answer does not change. The designation's count passes `'set-side'` (What the index should change).

```bash
_serviceable() {   # wrapper class [id] -> as today; with an id whose side is a set, the Overlord's arms too
  # local w="$1" c="${2:-}" side="" strict=0
  # an id whose poolset entry exists (F7: no fork otherwise):
  #   [[ -n "${3:-}" ]] && [[ -e "$REG/$3.poolset" || -L "$REG/$3.poolset" ]] && side=$(_session_pool_side "$3" "")
  # case "$side" in "set "*|set-unreadable|set-malformed) strict=1 ;; esac      # question 5
  # BEFORE the default/empty fold (F8):
  #   strict: declare -F _ccrc_continuity >/dev/null 2>&1 || { printf 'continuity-unread'; return 1; }   # F6
  #           [[ -n "$(_ccrc_continuity "$w")" ]] || { printf 'no-continuity'; return 1; }
  # then today's fold: [[ -z "$c" || "$c" == default ]] && return 3
  # in the fable arm, after the backend test:
  #   strict: declare -F _ccrc_fable_billing >/dev/null 2>&1 || { printf 'billing-unread'; return 1; }
  #           case "$(_ccrc_fable_billing "$w")" in included) ;; credits) printf 'credits'; return 1 ;;
  #             *) printf 'billing-unset'; return 1 ;; esac
}
_class_gate() {    # wrapper class [id] -> rc 0 | 1 | 2, as today
  # no id: today's body exactly (an empty or default class answers 0 without asking).
  # with an id: always asks `_serviceable "$1" "$2" "$3"`, and folds its rc 3 (skipped) to 0, so a set-side asker
  #   with an empty or default class still meets the continuity arm (F8). A session with no poolset entry pays one
  #   function call and no fork.
}
```

- The seven callers that hold an id pass it: `_swap_target`'s five `_class_gate` calls (`"$1"`),
  `_affinity_cur_serves` (`"$1"`) and the settle (`"$id"`). The three without a session pass none. The settle's call
  stays behind its own class test, as today: a settle with no class composes no `--model`, and the placement paths
  above already hold such a session to the continuity record.
- The settle (question 7, ruled F4): in `_spawn_start`'s rc 1 arm, a word of `no-continuity` or `continuity-unread`
  takes its own branch before the `_class_below` step: `rdeg=""`, no `_route_degrade`, no `_route_restore`, and one
  line, `continuity-unmet <id>: <wrapper> (<word>); composing <class>, a standing degraded stamp left as it is`, to
  `swap.log`. Every other word keeps today's arm.
- `ccd/contexts.tsv` is unchanged: no function is added.
- [ ] **Step 1: Failing tests.** New fixture columns `asking` (`other` by default, so every existing row is unedited)
  and `facts` (`fableBilling`, `continuity`, or `projection: 'old'` for an `accounts.sh` without the two functions).
  The harness writes the case's `poolset` entry for a `set-side` row, and none for an `other` row. New rows, each in
  both twins, every fact spelled out (F5):
  - `set-side`, `fable`, lane `claude`, billing `included`, recorded, share 39: `servable` 39;
  - `set-side`, `fable`, lane `claude`, recorded, share 39, billing `credits`: `credits`; no billing fact:
    `billing-unset`; old projection: `billing-unread`;
  - `set-side`, `opus`, lane `claude`, billing `credits`, recorded, seven 50: `servable` 50 (billing is Fable's alone);
  - `set-side`, `opus` and `fable`, lane `claude`, billing `included`, no record: `no-continuity`; old projection:
    `continuity-unread`;
  - `set-side`, `default` and an empty class, lane `claude`, no record: `no-continuity` (F8); the same with a record:
    `skipped`;
  - `set-side` on `set-malformed` and `set-unreadable` sides, lane `claude`, `fable`, billing `credits`, recorded:
    `credits` (the strict arms, question 5);
  - `other`, `fable`, lane `claude`, billing `credits`, no record, share 39: `servable` 39 (unchanged for everyone
    else);
  - `set-side`, `fable`, lane `gpt` (codex), billing `credits`, recorded: `backend` (backend before billing).
  
  The table's coverage check: every `why` word of `Serviceability` appears in at least one row.
  Callers: `_swap_target` with a set-side session skips a candidate with no continuity record and picks the next;
  `_affinity_cur_serves` answers 1 on a lane that bills credits for a set-side `fable` session; `_class_gate` with an
  id and a `default` class answers 1 on a lane with no record for a set-side session and 0 for a session with no set;
  the settle on a no-continuity lane with a standing `degraded=opus` stamp composes `--model fable`, leaves the stamp's
  bytes as they were, writes no route journal row and exactly one `continuity-unmet` line in the spelling above; the
  settle for a plain session on the same lane composes as today. `ccd-tick-budget.test.ts` passes unedited, and one
  new case there pins one extra fork a call for a session whose `poolset` exists.
- [ ] **Step 2: Run.** Red. **Step 3: Implement**, the TypeScript twin first, then bash, then the callers, then the
  settle, each its own commit. **Step 4: Run** the suites above, `projected-home.test.ts` (unedited),
  `ccd-pool-ok.test.ts`, `ccd-swap*.test.ts`, `ccd-tick-budget.test.ts`, the ratchet and contexts suites, and the
  `tsc` runs. Green.
- [ ] **Step 5: Mutation.** `serviceabilitySets.ts` mutates, and each mutant must red the row named:
  - billing before backend: the `gpt` row answers `credits`;
  - the continuity arm moved after the `default` fold: the `set-side` `default` row answers `skipped`;
  - the continuity arm moved after the `fable` arm: the no-record `fable` row answers `servable`;
  - each new word swapped for its neighbour, and each of `askingOf`'s three set arms dropped;
  - `factsChangeWidens` answering `false` for `on`, or `true` for `credits`.

  In bash: drop the third argument at one `_swap_target` call: the candidate case goes red. Drop the existence guard
  so every id forks: `ccd-tick-budget.test.ts` goes red. Let the settle stamp, or keep `rdeg`, on `no-continuity`: its
  case goes red.
- [ ] **Step 6: Commit.** `feat(serviceability): the billing fact, the continuity record and the asking session's side, in both twins (H16)`,
  then `feat(ccd): thread the asking session's id to every serviceability caller that holds one (H16)`, then
  `feat(ccd): the settle stamps no fallback on a lane with no continuity record (H16)`.

### Task 3: The account set door and verb learn the two facts (PR A)

**Files:**
- Modify: `server/src/accounts/routes.ts` (`POST /api/accounts/:id/set`, and the write-routes docblock),
  `shared/account-argv.ts` (`set`'s fields), `ccd/ccrc#_acct_set`, `deploy/account-op.mjs` (`opSetFacts`, its
  ops-table row `set-facts`), `docs/superpowers/specs/2026-10-18-accounts-connect-design.md` (the step-up bullet, F10).
- Test: `server/test/account-routes-write.test.ts` (the door: its `ROUTES` table and its "set and the revoke tick"
  describe, F9), `server/test/ccrc-account-set.test.ts`, `server/test/account-op-set-facts.test.ts` (new, beside
  `account-op-set-placement.test.ts`), `server/test/account-op-twins.test.ts`, the `buildAccountArgv` suite, and
  `server/test/account-deny.test.ts` (one refused form with the new flags).

The door:
1. Takes the account gate with `cap` and no step-up, as today, and reads the body. `onlyKeys` admits `stated`,
   `placement`, `fableBilling` and `continuity`, and at least one must be present. `fableBilling` must be a word of
   `FABLE_BILLINGS` and `continuity` `on` or `off`, else `bad-request` with one audit row.
2. When `factsChangeWidens(body)`, takes the gate again with `stepUp: true`, as remove does.
3. Passes `fableBilling` and `continuity` as op fields. The verb writes `stated`, then `placement`, then the facts,
   each under the lane lock, and reports what it wrote.
4. Answers `AccountSwitchAnswer` as today, whose roster now carries the facts.

The docblock (F10): its `set` line says the body may carry the two facts, and that a widening value (`included`,
`on`) takes the step-up as a third kind of `set` step-up, beside a method change and a raised commitment. The accounts
spec's step-up bullet gains the same clause, citing the Overlord spec's Table 11.1d rule.

The verb: `ccrc account set --id <id> --fable-billing included|credits --continuity on|off`, either flag alone or
beside `--stated -` and `--placement`. In `_acct_set` (F12):
- two `case` arms each for the two flags, refusing `bad-value` with the words they take;
- the `--method` form's `bad-argument` check also refuses `--fable-billing` and `--continuity` beside it, and its
  sentence names them;
- the `missing-value` condition accepts either new flag alone, and its sentence reads "needs --stated -, --placement
  overflow|full, --fable-billing included|credits or --continuity on|off";
- the usage line and the `unknown-argument` sentence name the two flags;
- after the placement write, under `_acct_marker_lock` as that write is, `_acct_write_op … set-facts --file … --id …
  [--fable-billing …] [--continuity …] --recorded-at now`, then `_acct_projection`.

`set-facts` (F11) reads the roster, writes `fableBilling`, writes `continuity` as `{"recordedAt": <seconds>}` on `on`
only when no record stands (a standing record keeps its time), removes the key on `off`, checks the result with
`rosterAdmits`, and writes once. `--recorded-at now` is `Math.floor(Date.now() / 1000)`, and a number is taken as given
(the op's tests pass one). When nothing changes it writes no byte and exits 0. It prints nothing on any path, since
`_acct_write_op` refuses `helper-noisy`. `_acct_set` regenerates the projection after it either way, which reproduces
the same bytes.

Failure contracts: an older fleet node's `ccrc` refuses the flags `unknown-argument`, and the door relays the refusal
as it relays any verb's, having written nothing. An older agent's `buildAccountArgv` refuses the field before any
spawn, the same way. A timeout answers `outcome-unknown`, as every account act does.

- [ ] **Step 1: Failing tests.**
  - Door (`account-routes-write.test.ts`): the `ROUTES` table's `set` row stays `stepUp: false` for a `placement`
    body, and new rows add `{fableBilling:'credits'}` and `{continuity:'off'}` at `stepUp: false` and
    `{fableBilling:'included'}` and `{continuity:'on'}` at `stepUp: true`, also when the stored value is already that;
    a word outside the vocabulary is `bad-request` with one audit row and no op; the four keys together run one op;
    the answer's roster carries the new values.
  - Op (`account-op-set-facts.test.ts`): each flag writes its field; `off` removes the key; `on --recorded-at
    1794000000` writes that number; `on` over a standing record keeps its time; `off` then `on` writes the new time;
    a bad value refuses `bad-argv` and writes nothing; a second identical call changes no byte and prints nothing.
  - Verb (`ccrc-account-set.test.ts`): each flag alone is accepted; `--method` beside either is `bad-argument`; a
    lone `--id` is `missing-value` with the new sentence; an unknown flag still refuses `unknown-argument`;
    `accounts.sh` is regenerated and answers the new value.
  - The deny: `ccrc account set --id lane-a --continuity on` is refused on a session's prompt.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the suites above, `account-op-set-placement.test.ts`,
  `accounts-route-lanes.test.ts`, `account-ops.test.ts`, `auth-gate.test.ts` (unchanged: no route added) and the `tsc`
  runs. Green.
- [ ] **Step 5: Mutation.** Skip the second gate: the widening cases go red. Compare against the stored value instead
  of the body: the already-included case goes red. Let `off` write `null`: the parser case goes red. Let `on` restamp
  a standing record: the keep-its-time case goes red.
- [ ] **Step 6: Commit.** `feat(accounts): the operator sets an account's billing fact and continuity record from its set door (H16, index question 34)`

**PR A ends here.** Its body says: three inputs, not four (question 1, the ccd arms' ruling); the strict arms reach
only a set-side asker, and no set exists until the designation writes one, so nothing a running session sees changes;
and the settle's new arm. It asks the coordinator to land it before pool set B (question 10).

---

### Task 4: The load lines, `poolRunway` and the load readings (L0, L1; PR B)

**Files:**
- Create: `shared/loadLines.ts` (L0, C1), `server/src/poolRunway.ts` (L1, C1), `server/src/accountLoad.ts` (L1, C1).
- Modify: the architecture spec's C1 row (`poolRunway.ts`, `accountLoad.ts`, `limitSampler.ts`,
  `coord/limitSamples*.ts`).
- Test: `server/test/pool-runway.test.ts`, `server/test/account-load.test.ts` (new); `server/test/sim/accountLoadSets.ts`
  (new), `mutation-floors.test.ts`, `mutation-floors.json`.

```ts
// shared/loadLines.ts — L0: imports nothing. Starting values (index question 7; Table 6.8a, Table 11.5b).
export const LOAD_LINE_PCT = { soft: 70, hard: 85, chat: 95 } as const;
export type LoadLine = keyof typeof LOAD_LINE_PCT;
/** A reading older than this proves nothing "under" for the server's lines and runway (question 13). */
export const LOAD_FRESH_S = 3_600;
/** The sampler's beat and what it keeps (index question 8). */
export const LIMIT_SAMPLE_MS = 5 * 60_000;
export const LIMIT_SAMPLES_KEEP_S = 30 * 86_400;
/** The runway's fit: samples of the current window inside this span, and at least this much time between them. */
export const RUNWAY_FIT_S = { five: 7_200, seven: 86_400 } as const;
export const RUNWAY_MIN_SPAN_S = 900;

export type Crossing =
  | { readonly kind: 'at'; readonly atS: number }                  // atS <= now: already past
  | { readonly kind: 'not-before-reset'; readonly resetS: number }
  | { readonly kind: 'unmeasured'; readonly why: 'no-sample' | 'stale' | 'rolled' | 'thin' | 'no-reset' };
/** When an exhausted account regains headroom (ruled, F2): never a bare null. */
export type EarliestReset =
  | { readonly kind: 'none-exhausted' }
  | { readonly kind: 'at'; readonly atS: number }
  | { readonly kind: 'unmeasured'; readonly why: 'no-sample' | 'stale' | 'no-reset' };
export interface PoolRunwayAnswer {
  readonly out: Crossing;                                   // crossing SEVEN_DAY_CEILING_PCT
  readonly lines: Readonly<Record<LoadLine, Crossing>>;
  readonly earliestReset: EarliestReset;
}
export type LineState =
  | { readonly kind: 'under' }
  | { readonly kind: 'past'; readonly leastPct: number }
  | { readonly kind: 'unmeasured'; readonly why: 'no-candidate' | 'stale' };
```

```ts
// server/src/poolRunway.ts — L1.
export interface WindowSample { readonly ts: number; readonly pct: number; readonly resetAt: number | null; readonly rolled: boolean }
export interface AccountSamples { readonly five: readonly WindowSample[] | 'no-window'; readonly seven: readonly WindowSample[] }
export function windowCrossing(line: number, samples: readonly WindowSample[], fitS: number, nowS: number): Crossing;
export function poolRunway(accounts: readonly AccountSamples[], nowS: number): PoolRunwayAnswer;

// server/src/accountLoad.ts — L1. `Reading` is `server/src/continuity/renewalDue.ts#Reading` (L1, C3), imported as a
// type: an L1-to-L1 import across contexts, named here (F17), so the renewal readings receive the type they declare.
import type { Reading } from './continuity/renewalDue.js';
/** `serves`: `yes` when the designated class or the fallback is servable; `at-ceiling` when one is refused by the
 *  seven-day ceiling (a load refusal) and neither is servable; `unmeasured` otherwise. Never dropped for load (F1). */
export interface Candidate { readonly id: string; readonly limits: AccountLimits | undefined;
  readonly serves: 'yes' | 'at-ceiling' | 'unmeasured' }
export type Candidates =
  | { readonly kind: 'candidates'; readonly list: readonly Candidate[] }
  | { readonly kind: 'not-designated' }
  | { readonly kind: 'unmeasured'; readonly why: 'designation-unreadable' };
export function overlordLoadCandidates(/* designationRead(), overlordAccounts' list, roster, limits, shares, nowS */):
  Candidates;
export function loadLines(list: readonly Candidate[], nowS: number): Readonly<Record<LoadLine, LineState>>;
export function classUnservableReading(s: Serviceability): Reading<boolean>;
export function accountLoadMoveReading(current: Candidate, others: readonly Candidate[], nowS: number): Reading<boolean>;
```

**One fact the rules lean on.** Inside a window a load only rises, until the window resets. So a reading at or past a
line proves "past" until its window resets, at any age. Only a claim of "under" needs a fresh reading (within
`LOAD_FRESH_S`), and only a rate needs fresh samples. A rolled-over window proves nothing.

The rules, each a test row:
- **A window's crossing** (N2: the order is the list's order). No sample of the current window (the newest sample's
  `resetAt`, not rolled over, inside the fit span): `no-sample`; the newest rolled: `rolled`. The newest at or past the
  line: `at` its time, at any age. The newest older than `LOAD_FRESH_S`: `stale`. No `resetAt`: `no-reset`. Fewer
  than two samples, or less than `RUNWAY_MIN_SPAN_S` between the oldest and the newest: `thin`. The rate is the
  endpoint slope, `(newest.pct - oldest.pct) / (newest.ts - oldest.ts)`, in percent a second; at or under zero:
  `not-before-reset`. Otherwise the line is reached at `newest.ts + (line - newest.pct) / rate`; at or after
  `resetAt` that is `not-before-reset`, before it `at`.
- **An account's crossing.** The earlier window's `at`; `not-before-reset` only when every window it has says so (the
  later reset); otherwise `unmeasured` with the first window's reason. `no-window` (a lane with no five-hour window)
  leaves the weekly window alone.
- **A pool's crossing.** `not-before-reset` when any account says so (that account carries the pool to its reset);
  `at` the latest account time when every account is `at`; otherwise `unmeasured`. An empty pool is `unmeasured`
  `no-sample`.
- **The earliest reset** (ruled, F2). An account is exhausted when a window's newest unrolled sample is at or past the
  ceiling, at any age; it regains headroom at the latest `resetAt` among its exhausted windows, and an exhausted window
  with no `resetAt` is `no-reset`. An account is not exhausted when every window's newest sample is fresh and under the
  ceiling. Any other account (a stale sample under the ceiling, or none) is `stale` or `no-sample`. The pool answers
  `unmeasured` with the first such reason when any account is unknown; otherwise `at` the least regain time when any
  account is exhausted, and `none-exhausted` when none is.
- **The candidates.** `overlordAccounts`' list (designation A), each with `serves` from `serviceability(…, 'set-side',
  …)` on the designated class and on the fallback (`opus`). Left out (F1): a disabled or signed-out account, and one
  whose two answers are both refused by a non-load word (`backend`, `credits`, `billing-unset`, `billing-unread`,
  `no-continuity`, `continuity-unread`, or the Fable share's own `ceiling`). An answer `unservable ceiling` on a class
  other than `fable` is the seven-day ceiling, a load refusal: that account stays, `at-ceiling`, with its figure.
  `designationRead()` answering `not-designated` gives `not-designated`, and `unmeasured` gives `unmeasured`
  `designation-unreadable`, never `not-designated` (the designation plan's X7).
- **A line now** (question 14, ruled F1). A candidate's load is `measured()` (the larger window) of its unrolled
  reading. `under` when any candidate whose `serves` is `yes` has a fresh load under the line; `past` with the least
  load when every candidate's load is at or past it, at any age, `at-ceiling` ones included; `unmeasured` `stale` when
  neither holds; `unmeasured` `no-candidate` for an empty list.
- **`classUnservableReading`.** `unservable`: measured `true`; `servable` or `skipped`: measured `false`; `unmeasured`:
  unmeasured with its word.
- **`accountLoadMoveReading`** (C57, Table 3.4b). Only `others` whose `serves` is `yes` are counted (F16): one that
  cannot serve never blocks the answer. Measured `true` when the current account's load is at or past `hard` and a
  counted other has a fresh load under `soft`. Measured `false` when the current account has a fresh load under
  `hard`, or when every counted other's load is at or past `soft` (no counted other is a `false` too). Otherwise
  unmeasured. Idleness is the renewal lane's, not this reading's.
- **The pins.** `LOAD_LINE_PCT.soft` equals ccd's `FRESH_PICK_SOFT_PCT`, harvested from `ccd/lib/long-lived.sh` as
  `SEVEN_DAY_CEILING_PCT` is harvested today. That test lands in whichever of this PR and ccd arms PR C1 merges second.
  `LOAD_FRESH_S` is greater than the keepalive's default window plus its timer's `OnUnitActiveSec`, both harvested from
  the tree, so a later change to either default reds here (N3: an operator's override is not pinned).
- [ ] **Step 1: Failing tests** for every rule above, with a fixture clock, including: a stale newest sample under the
  line (`stale`) and one past it (`at`); a rolled-over window; a window that resets before it would cross; a
  two-account pool where one account lasts to its reset; a lane with no five-hour window; the earliest reset's three
  answers and its `no-reset` and `stale` reasons; a line with one fresh account under and one stale account (`under`);
  every account fresh and past (`past` with the least); one stale-under account and the rest past (`unmeasured`
  `stale`); every candidate at 96% (`past`, 96), and again at 98% and at 99%, where `serviceability` refuses `opus`
  `ceiling` (`past`, 98: the cap cannot lift, F1); every account left out for non-load words (`no-candidate`); no
  designation and an unreadable one; `accountLoadMoveReading` with an under-`soft` account that has no continuity
  record (left out, so `false`, F16).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the two suites, `mutation-floors.test.ts`,
  `test/rings/*` (the cross-context type import) and the `tsc` runs. Green.
- [ ] **Step 5: Mutation.** `accountLoadSets.ts` mutates each comparison (`<` for `<=` at the line and at the reset),
  the freshness test, the any-under and all-past quantifiers, dropping `at-ceiling` candidates (the 98% row goes red),
  the `not-before-reset` carry, the earliest-reset minimum and its `none-exhausted` arm. Floors in
  `mutation-floors.json`.
- [ ] **Step 6: Commit.** `feat(limits): the load lines, poolRunway and the load readings, never folding an unmeasured account (C57, §6.8)`

### Task 5: `limit_samples` and its store (L3; PR B)

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration; its number is taken at build time and re-measured at landing),
  `server/src/coord/store.ts` (three one-line delegates), `server/src/coord/ports.ts#WatcherCoordMember` (the sampler's
  two members).
- Create: `server/src/coord/limitSamplesStore.ts` (L3, C1).
- Test: `server/test/limit-samples-store.test.ts` (new), `server/test/coord-db.test.ts`,
  `server/test/run-close-switch.test.ts` (its undo step and count), `server/test/single-definition/writers-map.test.ts`
  (`TABLES` gains `limit_samples`, writers `insertLimitSamples` and `pruneLimitSamples`),
  `server/test/rings/watcher-store-port.data.ts`.

```sql
CREATE TABLE limit_samples (
  account TEXT NOT NULL, ts INTEGER NOT NULL,        -- the reading's own time, from its limits file
  five REAL, seven REAL, five_reset_at INTEGER, seven_reset_at INTEGER,
  five_rolled INTEGER NOT NULL, seven_rolled INTEGER NOT NULL, five_window_minutes INTEGER,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (account, ts)
) WITHOUT ROWID;
CREATE INDEX limit_samples_ts ON limit_samples(ts);
```

- `insertLimitSamples(rows, sampledAt)`: `INSERT OR IGNORE`, so one reading is one row however many beats see it.
- `limitSamplesSince(accounts, sinceS)`: rows by account, oldest first.
- `pruneLimitSamples(beforeS)`: deletes rows older than the bound, answering the count.
- A restored older `coord.db` has a gap, which reads as `thin` or `no-sample` until samples accrue. An older server
  ignores the table (Table 11.1a). Rows hold percentages and times, nothing private.
- [ ] **Step 1: Failing tests:** a reading inserted twice is one row; rows read back oldest first and only for the asked
  accounts; prune deletes only older rows; `coord-db.test.ts`'s migration rows (F15): a fresh file is migrated and
  never opened empty, the table and its index exist at the new `user_version`, and a database whose `user_version` is
  higher than the build's opens as it is with the build's warning, `server/src/coord/db.ts`'s rule; `writers-map`
  names exactly the two writers.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** in `continuityStore.ts`'s prepared-statement shape. **Step 4: Run**
  the suites above. Before pushing, `git grep` the tree's duration censuses for a new 30-day holder
  (`2_592_000`, `30 * 86_400`) and add `LIMIT_SAMPLES_KEEP_S` to any that lists holders. Green.
- [ ] **Step 5: Mutation.** Drop `OR IGNORE`: the twice case goes red. Prune with `<=` for `<`: the boundary case goes
  red.
- [ ] **Step 6: Commit.** `feat(coord): limit_samples, one row per account reading, kept 30 days (C57)`

### Task 6: The sampler lane (L4; PR B)

**Files:**
- Create: `server/src/limitSampler.ts` (L4, C1).
- Modify: `server/src/laneSchedule.ts` (`LaneName` gains `limitSamples`; one row), `server/src/watch.ts` (one throttled
  call in `tick`, after `readLimits`).
- Test: `server/test/limit-sampler.test.ts` (new), `server/test/lane-schedule.test.ts`,
  `server/test/watcher-quiet-census.test.ts`, `server/test/consolidation-census.test.ts` if it counts lanes.

```ts
// server/src/limitSampler.ts — L4. Reads no clock and no file: the watcher hands it the tick's reading, the roster
// and the time.
export function limitSamplePass(store: LimitSampleStore, limits: Readonly<Record<string, AccountLimits>>,
  roster: Roster, nowS: number): { readonly inserted: number; readonly pruned: number };
// LANE_SCHEDULE row:
// { name: 'limitSamples', cadenceMs: LIMIT_SAMPLE_MS, derivedFrom: null, clock: 'mono', flight: 'skip',
//   warnKey: 'ccrc-server: the limit sampler failed' }
```

- A row is written for each roster account with `telemetry: 'anthropic'` whose reading has a `ts` (F14): the
  statusline is the only writer of such a file that writes a reading, so the codex lanes' publisher and ccd's
  synthetic exclusion row never become samples. An account with no reading, or a `disabled` row with no telemetry,
  writes nothing. A rolled-over window is stored with its flag, so the runway leaves it out.
- An unlistable tick has no reading, and the pass does not run. A store that throws is the row's `warnKey`, and the
  next beat tries again. Nothing retries inside a beat.
- Neither module reads a clock, so `TIME_PORT_FILES` does not change. If the builder makes the sampler read one, it
  joins the list in this task.
- [ ] **Step 1: Failing tests:** a pass writes one row per measured Anthropic account and prunes past the bound; a
  codex lane's file and an exclusion row (`{"five":100,"seven":0,"ts":N}`) write no row; a second pass over the same
  reading writes none; a tick in a harness runs the pass at the lane's cadence and not between; a throwing store warns
  once with the row's sentence; the lane census lists the row, and a test that builds a watcher drains it
  (`laneQuiet.ts`).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the suites above and every suite that builds a
  `FleetWatcher` (`git grep -l "new FleetWatcher" server/test`), since a new row must be quiet at their ends. Green.
- [ ] **Step 5: Mutation.** Run the pass on every tick: the cadence case goes red. Drop the `ts` guard: the no-reading
  case goes red. Drop the telemetry test: the exclusion-row case goes red.
- [ ] **Step 6: Commit.** `feat(limits): the limit sampler, a lane row beside the tick's one read (C57, index question 8)`

### Task 7: The ladder's 95% cause row, and the readings for the next pieces (PR B)

**Files** (the ladder plan's homes, ruled F3; the ladder plan, `w1-ladder.md`, is in its own fix round, so the builder
reads the names its merged PR shipped):
- Modify: `shared/overlord-ladder.ts` (one row in `LADDER_CAUSE_MAP`), `server/src/coord/overlordLadderRead.ts` (one
  key in `ladderConditionInputs`, the `load-past-95` seam its cross-plan seams table names for this PR).
- Test: the ladder's suites as its PR named them, and `server/test/account-load.test.ts`.

The row, from Table 7.5a's "the Overlord's accounts past the 95% load line (§6.8) | condition | cap `chat`":

```ts
'load-past-95': {
  kind: 'condition', effect: { kind: 'cap', cap: 'chat' }, notice: /* the ladder's word for a condition with no push */,
  spec: 'the Overlord\'s accounts past the 95% load line (Table 7.5a, §6.8)',
},
```

Its input, a `() => ConditionReading` in `ladderConditionInputs`:
1. `overlordLoadCandidates(…)` answers `not-designated`: `lifted` (the ladder plan's question 19: a condition that
   reads a designated session reads `lifted` with nobody designated).
2. It answers `unmeasured` `designation-unreadable`: `unmeasured` (never folded into `not-designated`).
3. Otherwise `loadLines(list, nowS).chat`: `past` is `standing`, `under` is `lifted`, and `unmeasured` (`stale`,
   `no-candidate`) is `unmeasured`.

The ladder applies an `unmeasured` input's cap (its question 17, which governs: ruled F3), so an unmeasured 95% line
caps the rung at `chat`. §6.8's "caps no rung" goes to the spec-fixes run. The input reads the watcher's
`currentLimits()`, the shares read, the roster and `designationRead()` through the deps `ladderConditionInputs`
already takes, widened by the one member it needs. A condition lifts by itself, so the row needs no clear.

This task wires no renewal reading. It exports `classUnservableReading` and `accountLoadMoveReading` for the renewal
readings piece, and `poolRunway` with `limitSamplesSince` for readiness and home B.

- [ ] **Step 1: Failing tests:** every candidate fresh at 96%: `effectiveRung` is at most `chat`, the row reads
  `standing`; every candidate at 98% and over, where `serviceability` refuses `opus` `ceiling`: still `standing`
  (F1); one candidate fresh under 95: `lifted`, no cap; one stale-under candidate and the rest past: `unmeasured`, so
  the rung is capped at `chat` and the row is listed `unmeasured`; every account left out for non-load words:
  `unmeasured` `no-candidate`, capped; nobody designated: `lifted`; an unreadable designation: `unmeasured`, capped;
  the input is read once per evaluation; the mapped type does not compile without the input.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the ladder's suites, Task 4's, and the `tsc` runs.
  Green.
- [ ] **Step 5: Mutation.** Map `unmeasured` to `lifted`: the stale case goes red. Map `not-designated` to
  `unmeasured`: the nobody-designated case goes red. Read the `hard` line for the row: a candidate at 90 reads
  `standing` and its case goes red.
- [ ] **Step 6: Commit.** `feat(ladder): past the 95% load line caps the rung at chat (Table 7.5a, §6.8)`

**PR B ends here.** Its body says that the sampler is the only behaviour that runs at merge, that the 95% row changes
nothing until an Overlord exists, and that an unmeasured line caps by the ladder's rule.

## What a merge arms

- **PR A.** No set exists until the designation writes one, so no session's answer changes, and a session with no
  `poolset` entry makes no new fork. The account set door takes two more keys, and an older fleet node refuses them.
  A box's `accounts.sh` gains two functions at its next regeneration (`ccrc update`, or any account act). The settle's
  new arm runs only for a set-side session.
- **PR B.** The sampler writes rows every five minutes, at most one per Anthropic account per reading. Nothing reads
  them until readiness and home B land. The 95% row reads `lifted` until an Overlord exists. Once one does, an
  unmeasured line caps the rung at `chat` by the ladder's rule, which the W1 rung door's own cap (`chat`) already
  matches, so no W1 act changes.
- **Rollback.** Below PR A, an older ccd ignores the facts (Table 11.1a), and an older server ignores the two keys in
  the file (`warnUnknownKeys` warns). Below PR B, an older server ignores `limit_samples`.

## Deviations found

Each entry is a departure from the spec's text that this plan makes, by slug. The coordinator mints numbers.

- **`three-inputs-not-four`** (ruled): H16, Tables 11.1a and 11.1b and Appendix B count four inputs. The hold-down is
  ccd's settle's alone, so serviceability takes three (question 1).
- **`set-side-selects-the-overlord-arms`**: the asking session's id selects the strict arms through the session's pool
  side, not through a role name, and only a session with a `poolset` entry pays the read (question 5, F7 ruled).
- **`set-side-held-to-continuity-whatever-its-class`** (ruled, F8): the continuity arm runs before the `default` fold
  for a set-side asker, so an empty or `default` class never skips it (question 5).
- **`unread-facts-refuse-with-their-own-words`**: unset and unread facts refuse for a set side, each of the five with
  its own word, never `unmeasured` (question 6).
- **`continuity-refusal-degrades-nothing`** (ruled, F4): the settle stamps and restores nothing on a lane with no
  continuity record, composes the intended class, and writes one new `continuity-unmet` line (question 7).
- **`facts-ride-the-account-set-door`**: the facts' Settings door is the existing account set door, widened, not a new
  door (question 8).
- **`set-steps-up-on-a-widening-fact`** (ruled, F10): a third kind of `set` step-up, beside a method change and a
  raised commitment; the accounts spec's list and the route's docblock gain it in Task 3 (question 8).
- **`account-fact-spellings`**: `fableBilling: included|credits` and `continuity: {recordedAt}`, kept on a second `on`
  and stamped through `--recorded-at` (question 9, F11 ruled).
- **`load-reading-fresh-for-an-hour`**: the server's lines and runway need a reading under an hour old to claim
  "under"; a reading past a line stays past until its window resets; ccd's placement readers keep no bound
  (question 13).
- **`under-is-proven-past-needs-all`**: §6.8's "least-loaded account" is read without folding an unmeasured account,
  and an account at the ceiling counts as past with its figure (question 14, F1 ruled).
- **`unmeasured-load-caps-by-the-ladders-rule`** (ruled, F3): §6.8 says an unmeasured load caps no rung; the ladder's
  rule that an `unmeasured` condition input applies its cap governs the 95% row (question 14).
- **`runway-is-a-line-crossing`**: `poolRunway` answers crossing times, and its caller compares them with the next
  renewal; its earliest reset is a tagged answer (question 15, F2 ruled).
- **`class-unservable-from-the-server-twin`**: Table 3.4b's "ccd's serviceability answer, asked by the renewal lane" is
  the TypeScript twin over the tick's readings, held equal to ccd's by the fixture table (question 16).
- **`fable-lane-by-lane-waits-for-the-listing`**: H16's lane-by-lane Fable test is deferred to the piece that adds the
  operator's listing of another provider's lane (question 17).
- **`ninety-five-line-is-a-starting-value`**: Table 11.5b lacks the 95% line. It is a starting value in
  `shared/loadLines.ts` until the spec-fixes run adds the row (question 11).
- **`samples-are-anthropic-readings`**: `limit_samples` holds `telemetry: 'anthropic'` accounts only, since the
  codex lanes' files have other writers and no other lane is an Overlord candidate in W1 (question 12, F14).

## Where things stand

**Agreed:**
- Three inputs, the hold-down being ccd's (question 1).
- The asking session's id threaded into `_serviceable` and `_class_gate` by PR A (question 2), behind an existence
  check on the session's `poolset` (F7).
- ccd places, the server forecasts and refuses (question 3).
- The facts are set from Settings, through a session-gated operator door (question 4).
- Fix round 1's rulings (review 2160): F1 (a ceiling candidate is past; an empty set is `unmeasured`), F2 (the tagged
  earliest reset), F3 (the ladder's homes and its rule for `unmeasured`), F4 (the settle's arm), F7, F8 (continuity
  whatever the class), F9 to F11, and F5, F6, F12 to F17 and the nits as the report says.

**Waiting on you** (the coordinator):
- Questions 5, 6, 8 to 18 where no ruling is marked, each with its recommendation above.
- Question 10's order: PR A before pool set B.

**What the index should change:**
- The serviceability row: "three more inputs" (question 1); A is three tasks and B four; the server door is the
  widened `POST /api/accounts/:id/set` (question 8), so the row and question 34 say so. "Where lanes meet" for lane A
  gains `server/src/accounts/routes.ts` (with its docblock), `shared/account-argv.ts`, `deploy/account-op.mjs`,
  `ccd/ccrc#_acct_set`, `shared/roster-json.d.mts`, the accounts spec's step-up bullet,
  `server/test/account-routes-write.test.ts` and `server/test/ccd-tick-budget.test.ts`. B's needs read "PR A and the
  ladder (so designation A)".
- The 95% row's home (F3): one row in `shared/overlord-ladder.ts`'s `LADDER_CAUSE_MAP` and one input in
  `server/src/coord/overlordLadderRead.ts`'s `ladderConditionInputs`, mapping `past` to `standing`, `under` and
  nobody designated to `lifted`, and an unmeasured line or an unreadable designation to `unmeasured`. The index should
  say the ladder's rule (an `unmeasured` input caps) wins over §6.8's sentence for this row.
- Figure W1: an edge serviceability A → pool set B (question 10), and serviceability A → designation A, because the
  designation's count calls `serviceability` with the asker `set-side`. The designation plan's sentence "the count
  follows with no edit here" becomes one edit, whichever lands second.
- Home PR C reads the facts from `RosterWire` and writes them through the widened door.
- The ccd arms' pick and settle pass the session id to `_class_gate` once PR A has merged.
- C56's "a later drop is told" item, when a narrowing fact leaves fewer than two accounts that can serve the Overlord,
  has no owner in Table W1. This piece's door does not refuse it (C56: told, never refused). Readiness, which already
  measures `stranded`, is the recommended owner.

**Spec fixes for the spec-fixes run:**
- H16's "four more inputs", Table 11.1a's and Table 11.1b's count, and Appendix B's row (with the ccd arms plan).
- H16: the two facts' spellings and the five serviceability refusal words (`credits`, `billing-unset`,
  `billing-unread`, `no-continuity`, `continuity-unread`). They are why-words of the answer, not door refusals, so they
  need no Table 11.6 row.
- Table 11.5b: the 95% line, and `LOAD_FRESH_S` with its reason.
- §6.8's "An unmeasured load … caps no rung", which the ladder's rule overrides for the 95% row.
- Table 3.4b's "asked by the renewal lane on each sweep": the server's twin.

**Later:**
- H16's lane-by-lane Fable test, with the operator's listing of another provider's lane (question 17).
- A maximum age for ccd's placement readers, for every reader at once (the ccd arms plan's "Later").
- The 70% and 85% lines' other readers: background work (W2) and item holds (W3).
