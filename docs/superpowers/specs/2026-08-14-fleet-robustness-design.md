# Fleet robustness — spawn, claims, placement, and the input box

**Status:** spec, awaiting operator review. Nothing here is built.
**Program:** `robustness` (Build 8). Four waves, ordered by blast radius, per the operator's ruling of 2026-08-14.
**Supersedes as scope:** tasks #34, #35, #36.

## Goal

Close the six production failures that Build 4 surfaced *outside* the coordination core — F8 (spawn
orphans), F9 (the hold's identity), F10 (billing-blind placement), F11 (auto-rename under a claim),
F13/F14 (the input box) — plus the four failure modes the measurement pass found that no one had
named: **false-success spawn**, **double-spawn**, **vacuous submit proof**, and **the invisible
blank-marker wedge**.

One sentence for the whole build: **the fleet must never end up in a state that only a human at a
terminal can recognise or repair.**

## Evidence base

Every claim below comes from a five-agent measurement pass run on 2026-08-14 against the live fleet host
(four surface agents + a synthesizer that re-verified citations and flagged inter-report disagreements).
The full pack is not committed; its verified conclusions are reproduced inline with `file:line` citations.

**Every `ccd/ccd` citation here was re-derived by grep against `baf8e5b`, not copied from the pack.**
The pack measured at `871215b` and asserted the repo and installed copies were byte-identical — true
when it ran, false forty minutes later: `5bdc6dd` and `baf8e5b` landed on `main` at 07:23 and 07:32
while the synthesis was being read, shifting everything below `_pane_hard_blocked` by 21 lines and
everything below `cmd_ws_add` by 11. Any line number in this document that disagrees with the pack is
deliberate. **Trust shipped source's own comments over any document, including this one.**

Two live facts that follow from the same check, and that the pack could not have seen:

- **The fleet host is one commit behind `main` on ccd.** Installed = `5bdc6dd`; `main` = `baf8e5b`.
  `ccd version` still reports `c8fd87f (built 2026-08-12T20:04:29Z)`, i.e. a stale provenance marker —
  exactly what `baf8e5b` was written to re-stamp, and exactly the state its own commit message says
  makes ccd "report `ccrc-edited` on every box forever, which is the verdict that tells the stage-2b
  installer NOT to replace it." This build's Wave 1 must not ship ccd until that is reconciled.
- **A fifth robustness surface exists and is already half-fixed by someone else.** `5bdc6dd` records
  that on 2026-08-13 a fleet-wide limit rollover dispatched six swaps in the same second; each
  SessionEnd/SessionStart hook pair launched a ~2 GB telemetry scan, and the box stalled for **9.7
  hours at load 179** with swap full and every process in D state. `_dispatch_swap` now jitters
  0..`SWAP_JITTER` (default 120 s). That is the *thundering-herd* class — synchronised fleet-wide
  reaction to a fleet-wide event — and it is **not** in this build's four waves. See "Open decisions".

**Read this first, because it changes how the older documents must be read:** the measurement pass
found **twelve shipped claims that are false against the code**, including four in `build4.md` — the
incident ledger merged the day before. Two of them describe F8's residue. Do not design against the
prose; the citations below are against the code.

| # | The claim | Where it is written | What the code does |
|---|---|---|---|
| C1 | F8 leaves "a fully-registered workspace with **no session**" | `server/src/remote/runner.ts:54-56`, `docs/…/programs/build4.md:150,161-162` | The pane **survives** the kill — `tmux new-session -d` (`ccd:7174`) completes before the blocking wait and the tmux server is not ccd's child. `ccd ls` prints the live orphan `ALIVE yes`. |
| C2 | "a killed child writes nothing" | `runner.ts:56` | `execFile` delivers whatever was buffered (`agent/src/server.ts:158-162`). stderr is empty because **no stderr-writing statement was reached** — a different fact, permitting a fix the stated reason forbids. |
| C3 | "clear startup gates, then **CONFIRM** the main TUI is up" | `ccd:7096` (docstring) | On the exhaust path the last statement is `sleep 2` (`ccd:7153`) and nothing sits between `done` (`:7154`) and `}` (`:7155`) — the function **returns 0, indistinguishable from success**. |
| C4 | An account with no limits file "reads as maximum headroom and is placed **first**, not skipped" | `README.md:509-513` | `_ws_least_loaded` does `[[ -z "$sc" ]] && continue` — it **skips** (`ccd:1149`); `_swap_target` does `: "${sc:=100}"` — it ranks **last** (`ccd:6967`). ccd's own comments record the `0` behaviour as removed. *(Half of the sentence survives: a **stale** sample really is rewritten to 0 and really does win — `ccd:6832-6842`. The README conflates absent with stale.)* |
| C5 | "A hold has **exactly two** consumers" | `README.md:191` | Four ccd rungs (`ws-rm :1364`, `ws-release :1877`, `ws-reap :5072`, `forget :7412`) plus `archiveMerged` plus every PWA display. README then names three in the following paragraph. `forget` appears nowhere in README. |
| C6 | `archivedreason` is decided by `_ws_gc_merged` (an ancestor check) | `docs/…/2026-08-04-worktree-ownership-design.md:158-161` | Decided by `prphase` + numeric `prnumber` (`ccd:2035-2037`). ccd states the deviation and its reason at `:2003-2017` — ancestor checks cannot see a squash merge. **The code is right and the spec is stale.** |
| C7 | `draft-present` "is a back-off, and the mail is **still there in two minutes**" | `server/src/watch.ts:1389-1394` | `rejectDelivery(id,'undeliverable',…)` parks the row permanently at attempt 6 for any never-delivered delivery (`watch.ts:1704-1717`). |
| C8 | "A failed send must not stand a bare clip path in the live box" | `server/src/inject/send.ts:489-497` | Implemented on the **attachment path only**. Ordinary prose returns at `send.ts:529` with no `clearBox`, no `draft`. |
| C9 | "the branch is `ws/<slug>`; §4's done-fingerprint re-measures THAT branch" | `ccd/coordinator-skill/references/wave-lifecycle.md:99-111` | The naming sweep renames it 28–82 s after creation (measured from three git reflogs). The skill has zero hits for `rename`/`ai-title`. |
| C10 | "Don't clobber a half-typed message in the input box" | `ccd:7081`, `:7199-7200` | `grep -m1 "^❯ "` matches the **first** `❯` line with a **plain space** — a scrollback turn. It cannot match a live box row, which is `❯` + U+00A0. |
| C11 | `_ws_least_loaded` picks "by session-count + disk only" | `build4.md:153-154` | `_account_ok` + `_limit_score` only (`ccd:1145-1153`). No session count, no disk. `build4.md:305-306` self-corrects 150 lines later. |
| C12 | F8 signature: "`.started` absent, unit `inactive(dead)` with ZERO journal entries" | `build4.md:161-162` | True but **uninformative**: `_ws_supervise` never ran, so the unit was never enabled. Two liveness signals disagreed and the ledger believed the one that cannot see a pane. |

Plus four stale source anchors: `naming.ts:28` and `watch.ts:85` cite `_ws_branch_valid` at `ccd:1337-1347`
(it is at `:1491-1501`); `watch.ts:1271` cites the 144-slug pool at `ccd:950-951` (it is at `:1024-1025`);
`watch.ts:1398` cites `send.test.ts:642` (it is `:19-20` / `:880`); `ccd-workspaces.test.ts:226` anchors
`_spawn`'s guard at `ccd:497-503` (it is at `:7163`).

### The live specimen

`ccrc-pwa-swift-harbor` has been sitting on the box since 2026-08-12 18:10:03 in exactly the F8 state:
ten registry rows, **no `.started`**, **no systemd wants-symlink**, **no `.hold`**, a **live tmux pane**
at an idle prompt, zero transcript, `$0.0000` spent, on the `claude-dev0` lane. Every verb reports it
healthy: `ls` → `ALIVE yes`; `ws-audit` → `not-archived` (and carries **no liveness field at all** —
`_alive` appears nowhere in `cmd_ws_audit`); `ws-gc` → `tracked`, the one state the prune arm prints
nothing for (`ccd:6225-6230`, `:6690-6691`); `ensure` → `alive: <id>`, exit 0, repairs nothing.

It is also no longer invisible in one respect that makes it worse: `sweepPr` stamped `.prphase=no-commits`
onto it at 06:59 on 2026-08-14. `archiveMerged` skips anything whose phase is not `merged` (`watch.ts:1912`),
so **the ladder that would clean it up is the same ladder pinning it**, and — having never taken a turn —
it will never have a merged PR. There is no level-triggered exit. Per the operator's standing ruling
("Leave it, I'll clean up later") this build does not delete it; Wave 1's detection is expected to
surface it, and Wave 1's adoption path is what would have prevented it.

## The rulings this design is built on

Given to the operator as the four questions the code cannot answer, 2026-08-14:

1. **Spawn residue → adopt it.** Detect on the next verb, write `started`, enable the unit; the
   workspace becomes ordinary. Not "detect and report only", not "roll back".
2. **A failed send leaves the operator's text in the box**, and the PWA gains a `Send it` rescue for it.
3. **All four surfaces, in blast-radius order** — one program, four waves, Build 4's shape.
4. **Which accounts bill credits: unanswered.** This design therefore builds the *mechanism* (a roster
   field and a placement constraint) and leaves the *values* as configuration. See "Open decisions".

## Wave 1 — a spawn is atomic, or it is honest

**Bounded context:** Fleet Mutation (`ccd/`), plus the agent's exec result and the dispatch adapter.
**Closes:** F8 proper, false-success spawn, double-spawn, wrong-mode resurrection, and the
`started`-is-dropped seam.

### 1.1 `started` and supervision move ahead of the blocking wait

This is the single highest-yield change in the build. Today `cmd_ws_add:1257` is one line holding two
statements — `_spawn "$id" new; _reg_set "$id" started 1` — with `_ws_supervise "$id"` on `:1258`.
`_spawn` blocks for 900–1350 s inside `_accept_first_run_prompts`, and the agent kills it at 300 s. Every
kill lands in that window.

`_spawn` splits into two:

- **`_spawn_start <id> <mode>`** — resolve the registry, build the wrapper argv, `tmux new-session -d`,
  and then, **immediately, before returning**, `_reg_set "$id" started 1`. Returns in milliseconds.
- **`_spawn_settle <id> <fromswap>`** — the blocking gate loop and `_inject_spawn_effort`. Writes
  `spawnstate`. Never writes `started`.

`_spawn` remains as the composition of the two, so `swap` and every other caller is unchanged. The
three callers that create a *workspace* — `cmd_ws_add:1257`, `cmd_ensure:7217`, `cmd_ws_restore` — call
the split form with `_ws_supervise "$id"` **between** them.

The invariant, which is what the tests pin: **no path may block on anything after creating a tmux
session until `started` is written and the unit is enabled.** A kill after `_spawn_start` therefore
leaves an ordinary, supervised, restartable workspace — F8's residue class ceases to exist.

It also fixes the wrong-mode resurrection for free. `cmd_ensure:7216` picks `mode=new` when `started`
is empty, which hands `--session-id '<uuid>'` to a wrapper for a uuid whose `session-env` directory
already exists (measured on the live orphan). With `started` written at session-creation time, `ensure`
picks `resume`, which is correct.

### 1.2 The settle loop stops lying, and stops running past the agent's ceiling

`_accept_first_run_prompts` gains three things:

- **A distinct exhaust verdict.** Today it returns 0 on a ready marker, 2 on a login screen, and **0 on
  exhaust**. It will return `3` on exhaust. Its docstring stops claiming it confirms the TUI on a path
  where it does not.
- **A hard-block branch.** `_pane_hard_blocked` (`ccd:6973-6980`) already matches
  `limit reached|reached your .*limit|out of (usage|credits)|monthly spend limit|API Error: 429|rate limit|Please run /login`.
  Its only caller today is `_auto_swap_check`. The settle loop calls it and returns `4`. This is the
  recognizer `build4.md:172-173` asked for; it already exists one call away, which two measurement
  agents found separately and neither connected.
- **A wall-clock bound, not an iteration count.** `CCD_SPAWN_SETTLE_S`, default **240**. Today the bound
  is 450 iterations, which is 900 s on the plain path and ~1350 s when gate branches fire (`sleep 1` +
  `sleep 2` each) — 3× to 4.5× the agent's hard 300 s ceiling (`agent/src/server.ts:56`), so a session
  slower than 300 s **cannot be spawned through the dispatch path at all; it can only be killed**. 240 s
  leaves room for the rest of `ws-add` under the ceiling. This is only safe *because* of §1.1: exceeding
  the bound is now a report, not an orphan.

`_spawn_settle` branches on the verdict and records it in a new registry field `spawnstate`:
`ready | login | unconfirmed | blocked`. On anything but `ready` it **must not** run
`_inject_spawn_effort` — today a `/effort ultracode` gets typed into an unknown screen after a silent
exhaust.

`ws-add` still **exits 0** on a non-`ready` settle and still prints the workspace. This is deliberate
and is the "never remove work" polarity ccd already states at `:1257-1258`: a non-zero exit here would
make `dispatchRun` return `fleetFailed` and re-create the very orphan we are closing. **The distinction
lives in `spawnstate`, not in the exit code** — an adapter may not narrow a distinction it received.

### 1.3 `ws-add` takes a per-project lock

`flock -n "$REG/.ws-add-<project>.lock"` spans from slug selection through `_spawn_start`, and is
released before the settle. ccd already uses `flock -n` twice (`:2355`, `:5139`), so the idiom and the
non-blocking polarity are established. The loser refuses with
`busy: another ws-add for <project> is in flight`.

This closes the concurrent case — an operator double-tap, a second tab, a second device, the coordinator's
own HTTP call — which is documented verbatim in the PWA as a known unfixed property
(`FleetScreen.tsx:120-125`) and guarded today only by React state that does not survive a reload.
Because the lock releases before the settle, it does **not** close the *retry-after-502* case; §1.5 does.

### 1.4 The agent stops erasing the kill

`agent/src/server.ts:158-162` reads `error.code ?? 1` and discards `error.killed` and `error.signal`
entirely, so `{code:1}` from "ccd exited 1" is byte-identical to `{code:1}` from "we SIGTERM'd ccd at
the deadline". That is an overloaded value at a seam, and it is the reason the dispatch layer cannot
tell a real failure from a timeout.

`ExecRes` gains `killed?: boolean` and `signal?: string`; `CcdResult` (`server/src/lifecycle.ts:8`)
gains `killed: boolean`. Additive, absence-permits, **no `FLEET_PROTO` bump** — an older agent omitting
the field reads as `killed: false`, which is the safe direction.

### 1.5 Dispatch adopts what a killed `ws-add` left behind

`dispatch.ts:183` returns `fleetFailed` the instant `res.ok` is false — **before** the BEFORE/AFTER
registry diff that would have discovered the new workspace, before `coord.setSession`, before the hold.
That single early return is what turns a slow spawn into an unclaimed workspace and a run stuck in
`planned` with no `run_events` row at all.

New behaviour on `!res.ok`: **run the AFTER diff anyway.**

- **0 new candidates** → `fleetFailed` exactly as today (a genuine refusal: disk floor, no account).
- **exactly 1 new candidate** → **adopt it.** Bind the run, place the hold, and record
  `spawn-adopted:<spawnstate>` on the `run_events` row. If `res.killed` is true the detail says so.
  The dispatch response carries `spawnState` so the coordinator knows the pane may not be ready.
- **≥2** → `ambiguous-dispatch`, as today, claiming nothing on a guess.

This is the operator's "adopt it" ruling applied where it does the most good, and it makes the
retry-after-502 case harmless: the retry finds the run already bound.

The AFTER read keeps its existing asymmetry — BEFORE tolerates degradation, AFTER never does
(`dispatch.ts:172-194`) — untouched. That comment is load-bearing and correct.

### 1.6 `started` and `spawnState` reach the wire

`SessionRecord.started` is parsed (`registry.ts:18,282,317`) and consumed by **nothing** — it is absent
from `FleetSession`, so the one bit that distinguishes an orphan is measured every snapshot and thrown
away. `FleetSession` gains `started: boolean` and `spawnState: SpawnState | null`, revived through
`reviveFleetSession` (which returns a literal, so a new field is a compile error until every path
computes it — the wire rule doing its job).

`SPAWN_STATES` is derived from the map, not hand-listed, and lands in `shared/api.ts` so
`single-definition.test.ts` catches a second copy.

The PWA renders one chip on a workspace whose `spawnState` is not `ready`. That is the detection the
operator currently does not have; `swift-harbor` would have shown it for two days.

## Wave 2 — a claim knows whose it is

**Bounded context:** Coordination (server-side only — no ccd change, no new verb).
**Closes:** F9 proper, the by-hand archive variant, release-then-crash, the wrong-wave hold overwrite,
and most of the sweep-blindness window.

The root cause is stated exactly by the code: the hold is one file keyed on the **session id** with a
reason string that is **display-only, never parsed back anywhere in this tree**
(`rundefs.ts:54-61`). It cannot answer "whose claim is this?", and the coordinator protocol
*deliberately* creates two open runs naming one session — `SKILL.md:204-215` mandates opening wave N+1
**before** closing wave N. That is correct protocol, not a mistake. So one run's abandon calling
`wsRelease` unconditionally (`close.ts:125-130`) removes a claim that is still live, and within ≤120 s
`archiveMerged` sees merged + unheld and archives the workspace out from under an open run. That is
what happened at 20:10:36 on 2026-08-13 (`build4.md:250-262`).

**The fix is not a refcount in ccd.** `coord.db` lives on the server (`config.ts:165`); the fleet host's
copy is 0 bytes, and the agent's file-**write** whitelist is `~/.cc-clips` only. Run-awareness
*cannot* be a rung inside ccd; it must be a server-side decision expressed as an argv choice. The three
places that hold both halves in one process are exactly `closeRun`, `dispatchRun`, and
`FleetWatcher.archiveMerged`.

### 2.1 One query, one pure policy

- `CoordStore.openRunsForSession(sessionId, excludeRunId?)` →
  `SELECT id, program, wave, waveOf FROM runs WHERE sessionId = ? AND state NOT IN ('done','failed') AND id != ?`.
  Synchronous, like the rest of `CoordStore` — **do not wrap it async** (a stated concurrency invariant).
- `releaseIsSafe(openSiblings)` in L1 — pure, no `fs`, no reply. Trivial today; it exists so the decision
  has one home and one test.

### 2.2 `closeRun` stops releasing a live claim

Both arms of the fleet act change:

- **Abandon arm** (`close.ts:122-130`): if a sibling open run names this session, **re-hold with the
  sibling's reason** instead of releasing. The abandoned run still transitions; the workspace stays claimed.
- **Final arm** (`close.ts:216-219`): `final:true` releases only when no sibling open run names the
  session. Otherwise it re-holds with the sibling's reason.
- **Non-final arm** (`close.ts:220-226`): today it re-holds with **its own** row's
  `holdReason(program, wave+1, waveOf)`, which silently rewrites the live run's claim whenever the two
  rows disagree. It will re-hold with the **surviving** run's reason.

D-48's ordering is preserved exactly — the fleet act stays **ahead** of the transition commit, so a
failed act leaves the run retryable rather than wedged terminal. The close response gains `released:
boolean` so the outcome is never silent.

### 2.3 The sweep stops archiving under an open run

`archiveMerged` (`watch.ts:1900-1963`) gains a third rung after `archiveSafety`: skip when
`openRunsForSession(r.id)` is non-empty, and push the same shape of notification `notifyHeldMerged`
already sends. Today `deps.coord` is in scope in that class and used four times elsewhere in the file,
and the archive path never touches it.

This rung is what makes the whole surface safe rather than merely safer: it means an *absent* hold is no
longer sufficient to archive. Release-then-crash (the hold gone, the run still open, D-48 protecting the
run but not the workspace) and the archive-vs-hold race both stop mattering, because the sweep now asks
the authoritative question.

`POST /api/sessions/:id/archive` — the by-hand route, one tap in the PWA's PR sheet — refuses `409
run-open` naming the run ids, and accepts `{force:true}` to proceed. A hard refusal would be a policy
reversal: `README.md:202-205` explicitly blesses archiving a held workspace by hand, and the PWA
advertises it. The operator's own hands stay able to do it; they just have to mean it.

### 2.4 The hold reason names its run

`holdReason` becomes `program:<P> wave:<N>/<M> run:<R>`. It stays **display-only** — the run-awareness
above comes from `coord.db`, never from parsing this string — and a test pins that nothing parses it.
The point is that a human reading `~/.cc-sessions` can now answer "whose claim is this?" from the box
alone, which they could not during the F9 incident.

## Wave 3 — placement and naming respect a claim

**Bounded context:** Fleet Mutation + the naming sweep. **AGENT-FIRST deploy.**
**Closes:** F10, F10b, F10c, F11, F11b, F11c.

### 3.1 The naming sweep will not rename a claimed workspace

`sweepNames` applies eleven conditions (`watch.ts:1262-1309`) and **none** of them is the hold — even
though `SessionRecord.held` is a field on the very array it iterates, carrying the run's own reason.
Measured consequence: three ccrc-pwa workspaces renamed 82 s, 31 s and 28 s after creation, from git's
own reflogs. `ccd ws-rename` has no hold rung either, unlike `ws-rm`, `ws-reap` and `forget`, and
deliberately no busy guard (`ccd:1741-1744` — the naming moment is by definition a busy moment).

Twelfth condition: **skip when `r.held !== null` or an open run names the session.** Both halves are
needed — `held` covers the ordinary dispatch, `openRunsForSession` covers a hand-created workspace
adopted into a run via `POST /api/runs` with a `sessionId`.

The hold is placed at `dispatch.ts:302`, *after* `ws-add` but *before* the brief is mailed at `:344`,
and the sweep needs an `ai-title` that only exists once the worker answers the brief — so for the
ordinary path the claim is in place before a rename can fire. The window is real but closed in the
right order.

`ccd ws-rename` also grows a hold rung, matching `ws-rm`/`ws-reap`/`forget`, using `-e` not `-f` so an
unreadable hold still refuses. Defence in depth: the sweep is not the only caller.

With the freeze in place, `wave-lifecycle.md:99-111`'s claim that the branch is `ws/<slug>` **becomes
true**, and the coordinator skill's nine verbatim-pinned clauses are untouched. The reference file gains
one sentence saying the name is frozen for the life of the claim.

### 3.2 The done-fingerprint stops guessing at a renamed branch

`fingerprint.ts:162` is `record?.branch ?? run.branch`. The live registry wins, which is right. The
fallback is the problem: `runs.branch` is written once by `markDispatched` and **never updated**, so
after a rename it names a ref `git branch -m` deleted, and a transient registry read failure becomes a
permanent `tip-unmeasurable` on a branch that will never exist.

Two cases the code currently collapses into one:

- **record absent** (reaped, dropped) → fall back to `run.branch`, and say so in the refusal detail:
  "from the run row, which predates any rename".
- **record present, `branch` null** → refuse `branch-unmeasurable`. Do not guess with a value we know
  the record itself declined to give.

No overloaded null at a seam. §3.1 makes the rename-mid-run case unreachable anyway; this is the
belt to that braces.

### 3.3 Placement learns that a lane can cost money

There is no billing, credit, cost or spend concept anywhere in `shared/`, `server/src`, `agent/src`,
`pwa/src` or `ccd/` — a repo-wide grep returns only `SWAP_CEILING`'s overage comment,
`_pane_hard_blocked`'s banner regex, and an aside in `naming.ts`. `_ws_least_loaded`'s entire ranking
body is ten lines taking three inputs: home-ability, `_account_ok` (an executable bit and a kill-switch
marker), and `_limit_score` (max of the 5h/7d percentages). Nothing on disk distinguishes
`claude-dev0` from `claude2`: same `exec.kind`, same `*-oauth.env` shape, same `telemetry:"anthropic"`,
both exporting exactly `CLAUDE_CODE_OAUTH_TOKEN`.

**This is an external fact the roster must record, not derive.**

`AccountDef` gains one optional field: **`placement?: 'auto' | 'lastResort'`**, defaulting to `'auto'`.
`ACCOUNT_KEYS` gains it (an unknown roster field warns and is ignored today, so this is
forward-compatible in both directions). `accounts.sh` gains `CCRC_LAST_RESORT=(...)`, since bash cannot
read the JSON.

- `_ws_least_loaded` ranks `auto` accounts. Only if **none** is available does it consider `lastResort`,
  and when it does it writes one line to stderr:
  `ccd: placing <id> on <acct> — last-resort lane, no ordinary account available`.
- `_swap_target` applies the same ordering, so an auto-swap rescue does not quietly undo the policy.
- `_ws_seed_home` already receives the pick, so `.home` — the durable field — follows automatically.

**Why "place anyway and say so" rather than "refuse":** refusing when every ordinary lane is over
ceiling would wedge the whole fleet, and a bill the operator can see is recoverable where a stalled
fleet at 3am is not. This is an assumption, not a ruling — see "Open decisions".

### 3.4 A correction can be made durable

`ccd swap` writes `.wrapper` and never `.home` (`ccd:7328-7329`), and `_auto_swap_check` polls every 5 s
and returns the session home the moment home is usable (`ccd:6935`). So **every "move this worker off
that lane" control reachable from the PWA today is cosmetic** — measured live in `swap.log`, in both
directions. `ccd prefer` is the only `.home` writer, and it has no `CCD_ARGV` entry and no whitelist grant.

This wave adds both: `CCD_ARGV.prefer(id, wrapper)` and one exec-whitelist entry.

**This is a new grant on the surface CLAUDE.md guards, so it is called out rather than slipped in.** The
contrast with the entries that are deliberately absent: `gh` carries a repo-WRITE token with no cwd
sandbox; `ws-rm` and `ws-gc` are on `UNGRANTABLE_VERBS` because they delete workspaces and branches.
`prefer` writes exactly one registry field, deletes nothing, moves nothing, and its argv is pinned to
`['prefer', <id>, <wrapper>]` with both operands validated by ccd. It is the smallest verb in the
vocabulary. It still needs the operator's yes.

## Wave 4 — the input box tells the truth

**Bounded context:** Session Injection (server + PWA), plus ccd's two out-of-process injectors.
**Closes:** F13, F14, vacuous submit, the invisible blank-marker wedge, and the false-echo pass.

### 4.1 A failed send hands the text back — the operator's ruling

`verify-failed` on the ordinary text path returns with no `clearBox`, no C-u and **no `draft` field**
(`send.ts:523-532`), while the attachment path clears and returns one (`:487-521`) — and `send.ts:489-497`
states the clearing rule as universal. The PWA offers its `Send it` rescue only for `enter-ignored`
**with** a non-blank draft (`ChatList.tsx:331-332`), so the wedge-creating refusal gets no button at all,
only "The session never showed the text — open the terminal to check."

Per the ruling: the text stays in the box, and `verify-failed` returns the `draft` so the rescue renders.
`ChatList`'s condition widens to `enter-ignored | verify-failed`. The docstring at `:489-497` is corrected
to describe what the two paths actually do.

The draft-conflict sheet also stops destroying work: it shows `draftOf`'s **single marker row** as though
it were the whole draft, and "Append anyway" C-u's the box and retypes only that row plus the new text,
**silently destroying rows 2..N** (`Composer.tsx:296-315`). It will carry every row it is going to
replace, and say how many.

### 4.2 The box guard sees the whole box, not one row

`sendPrompt`'s clobber guard is `if (draftOf(pane))` — the marker row only (`send.ts:386-387`). A wedge
whose marker row is blank is **invisible**: measured, a send into such a box issues zero C-u and types
onto the end of the existing content, so the session receives the concatenation as one turn. That
includes dispatch's `/clear`, which would submit `…brief text/clear` as a single line.

The guard becomes "the box holds anything": `draftOf(pane) || hasContentBelowMarker(pane)`.
`hasContentBelowMarker` already exists in the same file (`send.ts:604-606`) and is used only by
`submitEnter` today.

### 4.3 A leading blank line stops manufacturing that wedge

`composePrompt` filters empty **array members** but does not touch a leading `\n` inside `text`
(`shared/api.ts:2275-2277`), so any prompt starting with a newline types an empty literal, then
`M-Enter`, then the real text — leaving the marker row blank. `submitted()` proves the send with
`!draftOf(pane).startsWith(needle)` where `needle` is the first **non-blank** line — so on a blank marker
row it returns true on its first poll **whether or not Enter did anything**. Measured: a pane
byte-identical before and after Enter returns `{ok:true}`, the route answers 200, and the PWA's optimistic
bubble is deleted with no message after 5 s. The operator watches the message vanish as if delivered.

Leading blank lines are stripped before composing. The box cannot hold them; typing them only breaks the
proof. This is unreachable from the app's own Composer (which trims) and reachable from any script or
curl caller — including a coordinator.

### 4.4 The echo check stops passing off scrollback

The ordinary path tests `after.includes(needle)` — the **whole pane**. Measured: a pane whose scrollback
contains the identical text passes the echo check with an empty box, presses Enter, and returns `{ok:true}`
having proven nothing. The attachment path already uses the box-scoped check and states why
(`send.ts:472-486`). The ordinary path adopts it.

This will convert some silent false-successes into `verify-failed` refusals — which is the point, and is
safe only because §4.1 makes that refusal recoverable.

### 4.5 A blocked delivery is visible before it is lost

`draft-present` lands in `mail_deliveries.lastError`, a SQLite column with **no wire type, no route and
no PWA reader**. `MailSummary` carries only `state`, so a delivery blocked for 15 minutes is
byte-identical to one merely waiting. The only operator-visible signal arrives **after** the park, on the
recipient's screen. The coordinator skill has zero hits for `undeliverable|rejected|blocked`.

- `MailSummary` gains `attempts` and `lastError` (additive wire, no proto bump).
- `MailStrip` renders a distinct row for a queued delivery with `lastError === 'draft-present'`:
  *blocked — the recipient's input box has unsent text*.
- The **first** `draft-present` back-off emits one notification to the sender, not only the park.
- The park writes a `run_events` row and a push. A wave brief that becomes permanently undeliverable is
  the coordinator's business, and coordinator↔worker mail is the only channel Build 7 has: **one dirty
  box silences a wave.**

Parking is kept (Q19). A message that can never land should not retry forever — but it must not park
silently, which is the actual defect.

### 4.6 ccd's own injectors stop reading the wrong row

`_auto_compact_check` and `_inject_spawn_effort` both guard with `grep -m1 "^❯ "` — the **first** `❯` line
with a **plain space**. Measured on this box: on one pane that returns a scrollback turn (`❯ /compact`)
while the real box is empty — failing shut, skipping a legitimate compact; on another it returns nothing
while the box row is `❯` + U+00A0 + text.

Both guards adopt `draftOf`'s rule: the **last** `❯` line, accepting either separator.

The measurement pass left one question open — whether a *genuinely typed* draft renders with NBSP or a
plain space — and could not settle it read-only (it needs a keystroke into a live session). **This fix is
correct under both readings**: reading the last row with either separator is strictly more accurate than
reading the first row with one, so the build does not wait on the answer.

**Not doing (Q21):** unifying every box writer behind one serialiser. The server's `KeyedQueue` is an
in-process map; ccd's injectors run on a 5 s supervise tick on the other box, across a boundary the
server deliberately never crosses at runtime. A correct guard on an idle-and-quiet pane closes the
realistic window; a cross-box lock is a much larger design and is not justified by anything measured.

## Documentation corrections

Each of C1–C12 and the four stale anchors is corrected **in the wave that touches its file**, so no
correction ships without a test run over the code it describes. Two exceptions:

- **`build4.md`'s four false claims (C11, C12, and the two F8 residue sentences)** ship as a
  **correction appended to the ledger**, not a rewrite. `D-N` entries are authoritative history; the
  correction records that the ledger believed a liveness signal that cannot see a pane, and why. Deleting
  the original would destroy the more useful record.
- **The word "orphan" means three incompatible things** in this tree: `ws-gc`'s orphan is a *worktree
  with no registry row* — the exact inverse of F8 (and there is a live instance, `robust-mail`); an
  "orphaned branch" is a `ws-rm` failing to delete a ref; F8's orphan is registered + live + unclaimed.
  Worse, the historical branch-class orphan documented in-tree is *also* called `ws/swift-harbor`, so any
  grep conflates two bugs two weeks apart. This build names F8's class **`unclaimed session`** and uses
  that term in every comment it touches. It does not rename the other two.

## Assumptions I made

The measurement pass produced twenty-one questions the code cannot answer. Four went to the operator —
Q1 (which lanes bill credits, **still unanswered**), Q6 (roll back or keep — settled by the adopt ruling),
Q17 (a failed send's text — ruled: leave it), and the scope question. These are the other eighteen,
stated so any of them can be overturned in one sentence:

| # | Question | Decision |
|---|---|---|
| Q2 | Is a restricted lane excluded from auto-swap rescue too? | Yes — `_swap_target` uses the same ordering, else the reconciler undoes the policy. |
| Q3 | When every permitted lane is over ceiling: refuse, or place anyway? | **Place anyway and say so.** A visible bill beats a stalled fleet. |
| Q4 | May a caller name the account on `ws-add`? | No. Placement stays a policy ccd owns; the roster constrains it. |
| Q5 | Max time `ws-add` may block? | 240 s, under the agent's 300 s ceiling. Safe only because §1.1 makes the timeout non-fatal. |
| Q7 | Unrecognised gate: failure or wait? | Failure — stop, record `spawnstate`, report. Today it is neither. |
| Q8 | Auto-clear an unbound, never-started workspace? | **Never.** Detect and surface; every clearance stays a human act. |
| Q9 | Keep or kill a pane that survived a killed `ws-add`? | Keep — the operator's ruling, applied at both the ccd and dispatch layers. |
| Q10 | May a branch be renamed while a program claims the workspace? | Never, for the life of the claim. |
| Q11 | Is `runs.branch` frozen or followed? | Frozen — and §3.1 makes it accurate rather than merely stale. |
| Q12 | Does a hold forbid relocation and renaming, or only deletion? | Renaming: yes (§3.1). Deletion: unchanged. Archive: unchanged, because README blesses the by-hand case — §2.3 gates it on **open runs** instead, which is the honest question. |
| Q13 | Hold per-session or per-run? | Per-session key, **run-aware server-side**. A refcount in ccd cannot work: the fleet host has no coord.db. |
| Q14 | May the sweep archive under an open run? | Never. The by-hand route may, with `{force:true}`. |
| Q15 | Should the abandon route stay ungated? | **Yes.** Its stated reason — a wedge caused *by* the coordinator must not be gated behind the coordinator's key — is untouched by F9, and §2.2 removes the harm. |
| Q16 | May the server archive autonomously beyond merged-and-unheld? | No. D-5 stays absolute. |
| Q18 | Does a human draft outrank a wave brief? | Yes, as today — but the brief stops being discarded silently (§4.5). |
| Q19 | Permanently undeliverable, or back off forever? | Keep the park; make it loud before and at the park. |
| Q20 | Must a blocked delivery be visible **before** the park? | Yes. `attempts` and `lastError` go on the wire (§4.5); today `lastError` exists only as a SQLite column. |
| Q21 | One serialiser for every box write? | No — see §4.6. |

## Open decisions for the operator

1. **Which accounts carry `placement: 'lastResort'`?** Unanswered on 2026-08-14. The build ships the
   mechanism with **every account defaulting to `'auto'`**, i.e. behaviour identical to today until the
   roster says otherwise. Labels suggest `claude-dev0` (`lab·dev0`) is the credit lane — it is the one
   that billed $2.38 — while `team·max`, `alt·max` and `team·shared` read as subscriptions, and `gpt` is
   already `homeAble:false`. **I will not guess this into a config file.**
2. **The `prefer` exec grant (§3.4).** One new whitelist entry, on the surface CLAUDE.md guards. Without
   it every lane correction the PWA offers is undone by the reconciler within 15 minutes.
3. **Q3's polarity** — placing on a last-resort lane rather than refusing, when nothing else is available.
4. **Q6, implicitly settled by the ruling:** "roll back" is off the table; `ws-add` never deletes its own
   fresh work.
5. **Does the thundering-herd surface join this build, or stay separate?** `5bdc6dd` jittered
   `_dispatch_swap`, which is the *dispatch* half. The half it does not address is that the
   SessionEnd/SessionStart hooks behind each swap each launch a ~2 GB telemetry scan with no
   concurrency bound — jitter spreads the herd but does not cap it, so a wide enough event still
   converges. A cap belongs to whoever owns that lane. It is **not** in Waves 1–4 as written, and I
   would rather it be a deliberate addition than an assumed one.
6. **Reconciling the ccd deploy gap before Wave 1 ships.** `main` is one ccd commit ahead of the fleet
   host and the installed copy's provenance marker is stale. That is another session's lane and I have
   not touched it; Wave 1's agent-first deploy has to land on top of a clean marker, not underneath one.

## Testing

Mutation-table discipline throughout: every guard ships with a test that goes **RED when the guard is
deleted or mutated**, measured before and after, not asserted in a comment. For guards whose only failure
mode is *firing wrongly*, the mutant makes them fire.

**The one structural obstacle, and the fix:** every `ws-add` test today sources ccd with
`_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };` (`ccdWsHelpers.ts:50`), so the ordering at
`ccd:1268`, the pane-survives-the-kill property and the missing-`started` residue are **all outside the
mutation table** — which is precisely why F8 shipped. Wave 1 adds a harness variant that stubs only
`tmux` and `_accept_first_run_prompts`, leaving `_spawn_start`/`_spawn_settle` real, so the invariant in
§1.1 is mechanically pinned. Without that variant Wave 1 is untestable and must not ship.

Pins the build must produce, at minimum:

- `started` is on disk before anything blocks; killing the settle leaves a supervised workspace.
- `_accept_first_run_prompts` returns 3 on exhaust and 4 on a hard block, and `_inject_spawn_effort` does
  not run for either.
- Two concurrent `ws-add`s for one project: one wins, one refuses `busy`.
- A `fleetFailed` ws-add that created exactly one workspace adopts it; zero → still fails; two → still
  `ambiguous-dispatch`.
- Abandoning one of two runs on a session does **not** release the hold; the sweep does **not** archive
  a workspace an open run names. (There is no such test today in either direction —
  `hold-gate.test.ts` pins only the hold-based gate.)
- `sweepNames` skips a held row and a row an open run names.
- `verify-failed` returns a `draft`; the rescue renders; the conflict sheet carries every row it replaces.
- A leading-blank prompt cannot return `ok:true` without the box changing.
- An echo that exists only in scrollback does not pass.
- A `draft-present` back-off is visible on the wire before the park.

Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`) re-run in isolation before
being called a break; CI on the quiet box is the arbiter.

## Deployment

Waves 1, 3 and the ccd half of 4 touch `ccd/` and are **AGENT-FIRST** — the fleet host ships before the
server, because the server reads what the hook writes and the agent caches `ccd caps` at boot. Wave 2 is
server-only. Executables land via `install_atomic`; the server lane's final gate is `/health` reporting
the shipped sha.

Wave 1 ships a ccd change and a server change that must land together in behaviour but not in time: the
ccd half (§1.1–1.3) is safe alone — it strictly reduces orphaning — and the server half (§1.4–1.6) is
inert until it sees a `spawnstate` field, which absence-permits handles. Ship ccd first, verify, then the
server.

## Non-goals

- Deleting, reaping or archiving `swift-harbor`, or any other live workspace. Detection only.
- A cross-box input-box serialiser (§4.6).
- New coordination verbs. The exec surface stays `EXEC_COMMANDS = ['tmux','ccd']`, and coordination
  mutations keep riding already-granted `CcdArgv`. `prefer` is a fleet-mutation verb, not a coordination one.
- Any `FLEET_PROTO` bump. Every wire change here is additive and absence-permitting.
- Writing the `pool` registry field (it has a reader and no writer anywhere in ccd). Noted, not fixed.
- Settling the NBSP question (§4.6) or the consumed-uuid question (§1.1) by experiment. Both fixes are
  correct under every reading, so neither blocks.
