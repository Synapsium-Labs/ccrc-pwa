# Fleet robustness — spawn, claims, placement, and the input box

**Status:** spec, awaiting operator review. Nothing here is built.
**Program:** `robustness` (Build 8). Four waves, ordered by blast radius, per the operator's ruling of 2026-08-14.
**Supersedes as scope:** tasks #34, #35, #36.

## Goal

Close the production failures that Build 4 surfaced *outside* the coordination core — F8 (spawn
orphans), F9 (the hold's identity), F11 (auto-rename under a claim), F13/F14 (the input box) — plus
the four failure modes the measurement pass found that no one had named: **false-success spawn**,
**double-spawn**, **vacuous submit proof**, and **the invisible blank-marker wedge**.

**F10 (billing-blind placement) is deliberately NOT in this build.** The operator's answer to Q1 —
no lane bills usage credits today — removed the condition it guards against. What survives from that
surface is F10c, which was never about money: a claimed, mid-wave worker can be relocated between
accounts by a 5-second poll that never looks at the hold (§3.3).

One sentence for the whole build: **the fleet must never end up in a state that only a human at a
terminal can recognise or repair.**

## Evidence base

Every claim below comes from a five-agent measurement pass run on 2026-08-14 against the live fleet host
(four surface agents + a synthesizer that re-verified citations and flagged inter-report disagreements).
The full pack is not committed; its verified conclusions are reproduced inline with `file:line` citations.

**Every `ccd/ccd` citation here was re-derived by grep against `main` (`21fef2a`, ccd `871215b`,
sha256 `44de6cd4…`), not copied from the pack** — and then re-derived a second time, because the first
pass was wrong. The sequence is worth recording, because it is the same failure this whole document is
about:

The pack asserted the repo and installed ccd were byte-identical, with a sha. True when it ran. Hours
later `5bdc6dd` and `baf8e5b` were briefly committed to `main`, shifting everything below
`_pane_hard_blocked` by 21 lines; I re-derived every citation against that tree and "corrected" the
pack. Then the session that made those commits **reset `main` and moved the work to
`origin/fix/ccd-swap-jitter`** — correct hygiene — which silently un-corrected all of them. The numbers
here are now verified against the merge target. **A line number is a claim with a shelf life. Trust
shipped source's own comments over any document, including this one.**

Two live facts that follow, and that the pack could not have seen:

- **The fleet host is running unmerged ccd.** Installed = `5bdc6dd` (`fix/ccd-swap-jitter`, pushed but
  not merged); `main` = `871215b`. So the box is *ahead* of `main`, not behind, and every ccd line
  number in this document is off by +21 below `_pane_hard_blocked` **relative to what is actually
  executing**. `ccd version` also still reports `c8fd87f (built 2026-08-12T20:04:29Z)` — a stale
  provenance marker, which by `baf8e5b`'s own account makes ccd "report `ccrc-edited` on every box
  forever, the verdict that tells the stage-2b installer NOT to replace it." **Wave 1 must not ship ccd
  until `fix/ccd-swap-jitter` merges and the marker is re-stamped**, or the agent-first deploy lands
  under a marker that refuses it.
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
| C1 | F8 leaves "a fully-registered workspace with **no session**" | `server/src/remote/runner.ts:54-56`, `docs/…/programs/build4.md:150,161-162` | The pane **survives** the kill — `tmux new-session -d` (`ccd:7153`) completes before the blocking wait and the tmux server is not ccd's child. `ccd ls` prints the live orphan `ALIVE yes`. |
| C2 | "a killed child writes nothing" | `runner.ts:56` | `execFile` delivers whatever was buffered (`agent/src/server.ts:158-162`). stderr is empty because **no stderr-writing statement was reached** — a different fact, permitting a fix the stated reason forbids. |
| C3 | "clear startup gates, then **CONFIRM** the main TUI is up" | `ccd:7075` (docstring) | On the exhaust path the last statement is `sleep 2` (`ccd:7132`) and nothing sits between `done` (`:7133`) and `}` (`:7134`) — the function **returns 0, indistinguishable from success**. *(An earlier draft cited `:7153-7155` — those are the `fix/ccd-swap-jitter` numbers; on `main` `:7153` is `tmux new-session`, which C1 above cites. One line, two different things: exactly the hazard this table documents.)* |
| C4 | An account with no limits file "reads as maximum headroom and is placed **first**, not skipped" | `README.md:509-513` | `_ws_least_loaded` does `[[ -z "$sc" ]] && continue` — it **skips** (`ccd:1138`); `_swap_target` does `: "${sc:=100}"` — it ranks **last** (`ccd:6946`). ccd's own comments record the `0` behaviour as removed. *(Half of the sentence survives: a **stale** sample really is rewritten to 0 and really does win — `ccd:6811-6821`. The README conflates absent with stale.)* |
| C5 | "A hold has **exactly two** consumers" | `README.md:191` | Four ccd rungs (`ws-rm :1353`, `ws-release :1866`, `ws-reap :5061`, `forget :7391`) plus `archiveMerged` plus every PWA display. README then names three in the following paragraph. `forget` appears nowhere in README. |
| C6 | `archivedreason` is decided by `_ws_gc_merged` (an ancestor check) | `docs/…/2026-08-04-worktree-ownership-design.md:158-161` | Decided by `prphase` + numeric `prnumber` (`ccd:2024-2026`). ccd states the deviation and its reason at `:1992-2006` — ancestor checks cannot see a squash merge. **The code is right and the spec is stale.** |
| C7 | `draft-present` "is a back-off, and the mail is **still there in two minutes**" | `server/src/watch.ts:1389-1394` | `rejectDelivery(id,'undeliverable',…)` parks the row permanently at attempt 6 for any never-delivered delivery (`watch.ts:1704-1717`). |
| C8 | "A failed send must not stand a bare clip path in the live box" | `server/src/inject/send.ts:489-497` | Implemented on the **attachment path only**. Ordinary prose returns at `send.ts:529` with no `clearBox`, no `draft`. |
| C9 | "the branch is `ws/<slug>`; §4's done-fingerprint re-measures THAT branch" | `ccd/coordinator-skill/references/wave-lifecycle.md:99-111` | The naming sweep renames it 28–82 s after creation (measured from three git reflogs). The skill has zero hits for `rename`/`ai-title`. |
| C10 | "Don't clobber a half-typed message in the input box" | guards at `ccd:7062` and `:7180` (comments at `:7060`, `:7178-7179`) | `grep -m1` takes the **FIRST** `❯` line, so whenever any past turn is on screen the guard reads a scrollback row and never the box **regardless of separator** — that is the certain mechanism. A second, weaker reason applies to the **empty** box, whose marker row is `❯` + U+00A0 (`send.ts:69-70`); whether a *typed* draft uses NBSP or a plain space is **unsettled** (`send.test.ts` pins a plain space), and §4.6's fix is correct either way. |
| C11 | `_ws_least_loaded` picks "by session-count + disk only" | `build4.md:153-154` | `_account_ok` + `_limit_score` only (`ccd:1134-1142`). No session count, no disk. `build4.md:305-306` self-corrects 150 lines later. |
| C12 | F8 signature: "`.started` absent, unit `inactive(dead)` with ZERO journal entries" | `build4.md:161-162` | True but **uninformative**: `_ws_supervise` never ran, so the unit was never enabled. Two liveness signals disagreed and the ledger believed the one that cannot see a pane. |

Plus four stale source anchors:

- `naming.ts` (**two hits, `:18` and `:27`**) and `watch.ts:85` cite `_ws_branch_valid` at `ccd:1337-1347`;
  it is at **`:1480-1490`**.
- `watch.ts:1270-1271` quotes a ccd comment — "144 per project, recycled" — and anchors it at
  `ccd:950-951`. That comment is at **`ccd:1039-1040`** (in `_ws_slug_free`'s docstring). It is *not* at
  `:1013-1014`, which an earlier draft of this spec gave: those are the `WS_ADJ`/`WS_NOUN` arrays — the
  twelve-by-twelve arithmetic *behind* 144, containing neither the string "144" nor any mention of
  ws-reap. **Cite both, with distinct roles**; replacing a stale pointer with a differently wrong one is
  not a correction.
- `watch.ts:1398` cites `send.test.ts:642`; the const is at **`:19-20`**, the pinned assertion at **`:880`**.
- `ccd-workspaces.test.ts` (**`:225`**) anchors `_spawn`'s guard at `ccd:497-503`; it is at **`:7142`**.

### The live specimen

`ccrc-pwa-swift-harbor` has been sitting on the box since 2026-08-12 18:10:03 in exactly the F8 state:
ten registry rows, **no `.started`**, **no systemd wants-symlink**, **no `.hold`**, a **live tmux pane**
at an idle prompt, zero transcript, `$0.0000` spent, on the `claude-dev0` lane. Every verb reports it
healthy: `ls` → `ALIVE yes`; `ws-audit` → `not-archived` (and carries **no liveness field at all** —
`_alive` appears nowhere in `cmd_ws_audit`); `ws-gc` → `tracked`, the one state the prune arm prints
nothing for (`ccd:6214-6219`, `:6679-6680`); `ensure` → `alive: <id>`, exit 0, repairs nothing.

It is also no longer invisible in one respect: `sweepPr` stamped `.prphase=no-commits` onto it at 06:59
on 2026-08-14, so it does flow into `this.prStates`. `archiveMerged` skips anything whose phase is not
`merged` (`watch.ts:1910-1912`) and — having never taken a turn — it will never have a merged PR, so
**there is no level-triggered exit**. *(Framing corrected from an earlier draft: the stamp is not what
pins it — `this.prStates.get(r.id)` returning `undefined` skips identically, so the sweep would ignore
this workspace with or without the `prphase` row. The conclusion stands; the causal story does not.)* Per the operator's standing ruling
("Leave it, I'll clean up later") this build does not delete it; Wave 1's detection is expected to
surface it, and Wave 1's adoption path is what would have prevented it.

## The rulings this design is built on

Given to the operator as the four questions the code cannot answer, 2026-08-14:

1. **Spawn residue → adopt it.** Detect on the next verb, write `started`, enable the unit; the
   workspace becomes ordinary. Not "detect and report only", not "roll back".
2. **A failed send leaves the operator's text in the box**, and the PWA gains a `Send it` rescue for it.
3. **All four surfaces, in blast-radius order** — one program, four waves, Build 4's shape.
4. **Which accounts bill credits: none today** (answered after the first draft). Rather than ship a
   roster field and ranking logic with no condition to act on, the billing half of F10 is **cut** —
   see §3.3 for what survives and why. This is a scope reduction, so it is called out rather than
   quietly absorbed.

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

`_spawn` remains as the composition of the two, so `swap` is unchanged. **There are FOUR `_spawn` call
sites, not three** — `grep -n '_spawn "\$id"' ccd/ccd` returns `:1257` (`cmd_ws_add`), `:2353`
(`cmd_ws_restore`), `:7208` (**`cmd_start`**) and `:7217` (`cmd_ensure`). All four convert to the split
form:

- `cmd_ws_add` and `cmd_ws_restore` keep `_ws_supervise "$id"` **between** the halves (they already call
  it, at `:1258` and `:2355` — the only two `_ws_supervise` call sites in the file).
- **`cmd_start` carries the identical F8 ordering and was missed by the measurement pass.** `ccd:7208`
  is the same one-line `_spawn "$id" "$mode"; _reg_set "$id" started 1`, and `cmd_start` **never
  supervises** — that is `ccd start`'s contract. It writes `started` between the halves; `cmd_enable`
  (`ccd:7336-7340`) moves its `systemctl --user enable --now` from **after** `cmd_start` to before the
  settle. This path is not obscure: `POST /api/sessions` picks `CCD_ARGV.start` only when
  `body.enable === false`, and the PWA never sends that field, so **every session the app creates goes
  through `cmd_enable` → `cmd_start`**.
- `cmd_ensure` writes `started` between the halves and **does not** supervise. This is deliberate and
  must stay: `cmd_supervise` (`ccd:7221-7227`) **is** the unit's `ExecStart` and calls `cmd_ensure` at
  `:7223`, so supervising there would have the unit `systemctl --user enable --now` itself on every
  restart. Not a deadlock (`Type=simple` + `Restart=always`), but `ccd:2301-2302` records ensure's
  non-supervising behaviour as an explicit decision — *"`ccd ensure` does NOT re-supervise … boot
  persistence would be silently lost"* — and this build does not overturn it. *(That comment's own
  anchor, `ccd:1427-1434`, is itself stale; correct it in passing.)*

`CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`) gains **`start: 300_000` and `enable: 300_000`**.
Today neither has a row, so both inherit the flat `CCD_TIMEOUT_MS = 90_000` while ending in the same
blocking `_spawn` — a budget **3.3× tighter** than the one whose expiry caused F8, on the app's default
session-creation path. That omission is its own latent F8 and this build closes it.

The invariant, scoped to match: **every `_spawn` caller that creates a session writes `started` before
it blocks, and every caller that supervises at all does so before it blocks.** A kill after
`_spawn_start` therefore leaves an ordinary, restartable session — F8's residue class ceases to exist.

It also fixes the wrong-mode resurrection. `cmd_ensure:7216` picks `mode=new` when `started` is empty,
which hands `--session-id '<uuid>'` to a wrapper for a uuid whose `session-env` directory already exists
(measured on the live orphan). With `started` written at session-creation time, `ensure` picks `resume`.

**One caveat, stated rather than glossed:** `started` becomes monotone at session-creation time and
nothing ever clears it — there is no `_reg_del`/`_reg_unset` anywhere in ccd (grepped: zero hits). So a
session killed *before any transcript was persisted* now gets `mode=resume` forever, i.e. `--resume
'<uuid>'` against a zero-transcript uuid. That direction was **not** measured. Wave 1 therefore ships an
explicit fallback: if `_spawn_start`'s `--resume` fails, retry once with `--session-id`. (The *other*
direction — `--session-id` for a consumed uuid — is the one this change removes, and is listed as a
non-goal precisely because it stops being reachable.)

### 1.2 The settle loop stops lying, and stops running past the agent's ceiling

`_accept_first_run_prompts` gains three things:

- **A distinct exhaust verdict.** Today it returns 0 on a ready marker, 2 on a login screen, and **0 on
  exhaust**. It will return `3` on exhaust. Its docstring stops claiming it confirms the TUI on a path
  where it does not.
- **A hard-block branch.** `_pane_hard_blocked` (`ccd:6952-6959`) already matches a limit/spend/auth
  banner. The shipped regex at `ccd:6958` is wider than the abridged form an earlier draft quoted here
  as if verbatim — it also carries `hit your .*spend`, `Too Many Requests`,
  `rate limit(ed| exceeded| reached)?` and `Invalid API key`.
  Its only caller today is `_auto_swap_check`. The settle loop calls it and returns `4`. This is the
  recognizer `build4.md:172-173` asked for; it already exists one call away, which two measurement
  agents found separately and neither connected.
- **A wall-clock bound, not an iteration count.** `CCD_SPAWN_SETTLE_S`, default **240 — but only on the
  agent-reachable path**. Today the bound is 450 iterations: 900 s on the plain path, ~1350 s when gate
  branches fire (`sleep 1` + `sleep 2` each) — 3× to 4.5× the agent's hard 300 s ceiling
  (`agent/src/server.ts:56`), so a session slower than 300 s **cannot be spawned through the dispatch
  path at all; it can only be killed**. 240 s leaves room for the rest of `ws-add` under the ceiling,
  and is safe only *because* of §1.1: exceeding it is now a report, not an orphan.

  **The bound must be per-caller, not global.** `_accept_first_run_prompts` is also reached from
  `cmd_supervise` (systemd `ExecStart`, no ceiling) and from `ccd swap`, which detaches into a transient
  unit (`ccd:7266`) and ends in `systemctl --user start … || cmd_ensure` (`ccd:7310`). Both take the
  `fromswap=0` full-resume branch — exactly the "700k+-token resumes take minutes between gates" case
  the docstring cites for its ~15 min window (`ccd:7088-7089`). A global 240 s would make every systemd
  restart of a large session settle `unconfirmed`, which **suppresses `_inject_spawn_effort`** (so
  `SPAWN_EFFORT` silently stops applying on the crash-restart path) and, under §1.6, lights a warning
  chip on a healthy session. So: 240 s for the agent-reachable path, the existing ~900 s for
  `fromswap=0` resumes.

`_spawn_settle` branches on the verdict and records it in a new registry field `spawnstate`:
`ready | login | unconfirmed | blocked`. On anything but `ready` it **must not** run
`_inject_spawn_effort` — today a `/effort ultracode` gets typed into an unknown screen after a silent
exhaust.

`ws-add` still **exits 0** on a non-`ready` settle and still prints the workspace. This is deliberate
and is the "never remove work" polarity ccd already states at `ccd:1246-1247`: a non-zero exit here would
make `dispatchRun` return `fleetFailed` and re-create the very orphan we are closing. **The distinction
lives in `spawnstate`, not in the exit code** — an adapter may not narrow a distinction it received.

### 1.3 `ws-add` takes a per-project lock

`flock -n "$REG/.ws-add-<project>.lock"` spans **slug selection (`ccd:1199-1203`) through the last
registry write (`:1242`)**, and is released before the setup hook and the spawn. It deliberately does
**not** cover `"$main/.ccrc/workspace.sh"` (`ccd:1248-1249`) — an arbitrary user script with no bound —
nor the settle; serialising either is not something the lock is for. Copy the `exec {lfd}>&-` fd
hygiene from `ccd:2343-2362`: ccd is *sourced* by its own tests, and flock treats two `open()`s in one
process as strangers. ccd already uses `flock -n` twice (`:2344`, `:5128`), so the idiom and the
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

- **exactly 1 new candidate, AND `res.killed === true`, AND `winner.held === null`** → **adopt it.**
  Bind the run, place the hold, record `spawn-adopted:<spawnstate>` on the `run_events` row, and return
  `spawnState` so the coordinator knows the pane may not be ready.
- **any other `!res.ok`** — `killed:false` (a clean refusal: disk floor, no account with headroom,
  §1.3's `busy`), 0 candidates, ≥2 candidates, or a candidate that already carries a hold →
  `fleetFailed` / `ambiguous-dispatch` exactly as today, claiming nothing on a guess.

**Adoption requires positive evidence that the candidate is the one THIS call created**, and the two
gates are what supply it. `killed` (§1.4) separates "we SIGTERM'd a spawn in flight" from "ccd refused"
— a `die` is `exit 1` (`ccd:68`), byte-identical to a timeout without it. `held` is fail-shut by
construction (`registry.ts:38-56`: a listed-but-unreadable `.hold` reads as HELD), and a workspace a
killed `ws-add` just created never carries one, while a live coordinated worker always does.

**This CHANGES the precondition of `dispatch.ts:172-194`'s asymmetry, and that comment must be extended
to say so.** An earlier draft of this spec claimed the asymmetry was "untouched… load-bearing and
correct"; that was the one sentence in the document that was wrong about the code it was changing.
BEFORE's tolerance of degradation is safe today *because the success path always contributes exactly
one genuinely-new row*, so a false-new makes the count 2 and `:203-206` refuses. On the adoption path
that guarantee is gone: a false-new makes the count **1, and would be adopted**. Two reachable triggers
were measured — a whole-fleet listing failure (`readRegistry` collapses `{listed:false}` to `[]`,
`registry.ts:426-429`, emptying `beforeIds`) and an operator `ws-add` from the PWA racing a refused
dispatch (`server.ts:620-623`, no `coordMutex`, no diff). `killed` + `held` are what replace the lost
precondition, and the comment says so in the same words.

*(Refuted during review, so the plan does not over-build: there is no two-dispatch race.
`routes.ts:796` runs `dispatchRun` inside `coordMutex.run(...)`, which serialises open/dispatch/close/
advance/settle server-wide, so at most one dispatch is ever in flight.)*

### 1.6 `started` and `spawnState` reach the wire

`SessionRecord.started` is parsed (`registry.ts:18,282,317`) and consumed by **nothing** — it is absent
from `FleetSession`, so the one bit that distinguishes an orphan is measured every snapshot and thrown
away. `FleetSession` gains `started: boolean` and `spawnState: SpawnState | null`, revived through
`reviveFleetSession` (which returns a literal, so a new field is a compile error until every path
computes it — the wire rule doing its job).

`SPAWN_STATES` is derived from the map, not hand-listed, and lands in `shared/api.ts`. **It does not
get single-definition protection for free:** `server/test/single-definition.test.ts` has no generic
scanner — it is hand-written per concept, each with its own literal regex and its own `it` (`RunState`
at `:263-267`, `MAIL_REJECT_CODES` at `:268-272`, `WORK_ITEM_*` at `:287-293`). Wave 1 must **add** a
describe in that same Build-7-nouns idiom (`/^\s*export const SPAWN_STATES\b/m` scoped to
`['shared/api.ts']`, plus a derivation assertion, plus a member-enumeration scan — the four state
tokens also appear in ccd's bash). Otherwise the guard this section leans on does not exist.

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

**Do NOT add `AND dispatchedAt IS NOT NULL` to that predicate**, though it looks like the same shape as
D-13 (`store.ts:686-697`). D-13 guards `capsUsage`, a **global, session-less** count whose problem class
is `planned` rows with no session — all already excluded here by `WHERE sessionId = ?`. Importing it
would reintroduce F9: `routes.ts:757-765` places the wave-N+1 hold at **open** time, before any dispatch,
so the live claim legitimately belongs to a run with `dispatchedAt IS NULL`. This sentence exists so a
later reviewer does not "fix" it.

Note also that nothing at the store layer prevents two open runs naming one session — `setSession`
(`store.ts:457-458`) and `markDispatched` (`:484-488`) are bare `UPDATE`s with no uniqueness constraint,
and that is **correct**, because the coordinator protocol deliberately creates exactly that state
(`SKILL.md:204-215`). Nothing in §1.5 or §2.2 may read as though a constraint existed.

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

**One shipped ccd comment becomes false, and Wave 2 must edit it even though Wave 2 is otherwise
server-only.** `cmd_ws_release` (`ccd:1859-1861`) states *"After this, the very next archiveMerged sweep
may archive a merged workspace — the level re-arms itself, no edge to miss."* After this rung an absent
hold is no longer sufficient, so a by-hand `ws-release` does **not** re-arm the sweep while a run is
open. Schedule the comment edit; do not knowingly leave a false comment on the box. *(It is one line,
but it means Wave 2 is not purely server-side and its deploy is agent-first after all.)*

`POST /api/sessions/:id/archive` — the by-hand route, one tap in the PWA's PR sheet — refuses `409
run-open` naming the run ids, and accepts `{force:true}` to proceed. A hard refusal would be a policy
reversal: `README.md:202-205` explicitly blesses archiving a held workspace by hand, and the PWA
advertises it. The operator's own hands stay able to do it; they just have to mean it.

### 2.4 The hold reason names its run

`holdReason` becomes `program:<P> wave:<N>/<M> run:<R>`. It stays **display-only** — the run-awareness
above comes from `coord.db`, never from parsing this string — and a test pins that nothing parses it.
The point is that a human reading `~/.cc-sessions` can now answer "whose claim is this?" from the box
alone, which they could not during the F9 incident.

## Wave 3 — naming and relocation respect a claim

**Bounded context:** Fleet Mutation + the naming sweep. **AGENT-FIRST deploy.**
**Closes:** F11, F11b, F11c, F10c. **Cuts F10/F10b** — see §3.3.

### 3.1 The naming sweep will not rename a claimed workspace

`sweepNames` applies eleven conditions (`watch.ts:1262-1309`) and **none** of them is the hold — even
though `SessionRecord.held` is a field on the very array it iterates, carrying the run's own reason.
Measured consequence: three ccrc-pwa workspaces renamed 82 s, 31 s and 28 s after creation, from git's
own reflogs. `ccd ws-rename` has no hold rung either, unlike `ws-rm`, `ws-reap` and `forget`, and
deliberately no busy guard (`ccd:1730-1733` — the naming moment is by definition a busy moment).

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

**A new refusal code is not a free string.** `fingerprint.ts:31-32` types `DoneVerdict`'s refusals as
`Extract<MailRejectCode, …>`, so `branch-unmeasurable` must join `MAIL_REJECT_CODES` (`shared/api.ts`),
widen `close.ts:31-33`'s `Extract`, **and** be named in the coordinator-skill corpus —
`coordinator-skill.test.ts:245-249` iterates `MAIL_REJECT_CODES` and asserts the skill text contains
each one. Wave 3 therefore edits an **AGENT-FIRST skill artifact**, which §3.1 budgets as "one
sentence". The suite reds immediately so it cannot be missed, but it is a planned task, not a surprise.

### 3.3 A claimed worker is not relocated for cosmetic reasons

**F10's billing half is CUT from this build.** The operator's answer to Q1 on 2026-08-14 was that **no
lane bills usage credits today**. The roster field, the bash `CCRC_LAST_RESORT` array and the
`_ws_least_loaded` / `_swap_target` ranking changes that were drafted here would therefore be
mechanism with no condition to act on — speculative complexity in the most safety-critical file in the
fleet, for a policy nobody is currently expressing. YAGNI. The roster already warns-and-ignores unknown
fields (`shared/roster.ts:222-232`), so adding `placement` later is a small forward-compatible change
with no lock-in cost to deferring; and the `<wrapper>-disabled` kill-switch marker (`ccd:118`, `:122`)
already exists for the blunt case.

What survives the answer is the part of F10 that was never about money. `_auto_swap_check` runs on a
5-second supervise tick and **relocates a session between accounts with no reference to the hold**. Its
two paths are already distinct in the shipped code (`ccd:6961-7010`):

- **Rescue** — `_pane_hard_blocked` matched: a limit/spend banner is up or auth is lost. It swaps
  *immediately*, deliberately bypassing the idle gate, because "the session is stuck anyway".
- **Affinity** — returning home, or leaving because home hit `SWAP_CEILING`. Gated on a clean turn
  boundary, but otherwise unconditional.

The affinity path will **defer while `$REG/<id>.hold` exists**; the rescue path is untouched. A
mid-wave worker must not have its session restarted and its transcript copied to another account
because telemetry drifted — but a *blocked* mid-wave worker must still be rescued, or the hold becomes
a way to strand a wedged wave. This is the honest reading of Q12 ("does a hold forbid relocation?"):
**cosmetic relocation yes, rescue no.**

The rung uses `-e` not `-f`, matching the four existing hold readers, so an unreadable hold defers too.

### 3.4 Deferred: making a lane choice durable

Recorded here because it is measured and real, and **recommended for deferral** rather than inclusion.

`ccd swap` writes `.wrapper` and never `.home` (`ccd:7307-7308`), and `_auto_swap_check` returns the
session home the moment home is usable (`ccd:6914`). So **the swap control the PWA ships today is
cosmetic** — a deliberate lane change is silently reverted within ~15 minutes (measured live in
`swap.log`, in both directions). `ccd prefer` is the only `.home` writer and is unreachable from the
server: no `CCD_ARGV` entry, no exec-whitelist grant.

Fixing it properly costs **one new exec-whitelist entry**, on the surface CLAUDE.md guards. With Q1
answered, the strongest motivation for it — moving a worker off a billing lane — no longer exists, and
what remains (durably pinning a session to an account) is a convenience. Against that: a whitelist
entry is permanent attack surface, and there is a **zero-cost alternative** — label the PWA's swap
sheet honestly ("temporary; this session returns to its home account when home has room"), which
makes a working control out of a lying one without touching the boundary at all.

Recommendation: **ship the honest label, defer the grant.** One word from the operator pulls it back in.

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

**Widening the guard without widening the READ behind it would ship a broken clear path**, so both move
together. `clearBox`'s look-round terminator is `const left = draftOf(ansi); if (left === '') return
{ state: 'cleared' };` (`send.ts:269-270`), and its soundness argument (`send.ts:231-238`) — *"C-u kills
bottom-up while `draftOf` reads the box's FIRST row, so that row is the LAST to empty"* — **is false for
a blank marker row**. Under the widened guard both clear arms (`clearMailResidue` at `:431`,
`replaceDraft` at `:444`) become reachable with `draft === ''`: one blind `C-u` mangles the last row,
the first look round reads `''`, and it reports `cleared` having cleared almost nothing — then the type
loop concatenates onto the wreckage. `replaceDraft` is operator-reachable from the PWA, so that
destroys a human's rows 2..N under a button labelled as though it replaced them.

So: `clearBox`'s terminator becomes `draftOf(ansi) === '' && !hasContentBelowMarker(ansi)`, and the
docstring's "last to empty" argument is corrected to say it holds only when the marker row started
non-blank.

And when the guard fires on a blank marker row, the refusal's `draft` **carries the box's rows 2..N** —
never `''`, which would silently disarm the PWA's rescue gate (`ChatList.tsx:331`, `send.draft.trim()
!== ''`) and render an empty well in the conflict sheet. `submitEnter` already names this pane
`blank-first-row` (`send.ts:661-663`).

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
| Q2–Q4 | Placement policy: restricted lanes, over-ceiling behaviour, caller-named accounts. | **Moot.** Q1's answer (no lane bills credits today) removes the condition all three describe. Placement is unchanged by this build — see §3.3. |
| Q5 | Max time `ws-add` may block? | 240 s, under the agent's 300 s ceiling. Safe only because §1.1 makes the timeout non-fatal. |
| Q7 | Unrecognised gate: failure or wait? | Failure — stop, record `spawnstate`, report. Today it is neither. |
| Q8 | Auto-clear an unbound, never-started workspace? | **Never.** Detect and surface; every clearance stays a human act. |
| Q9 | Keep or kill a pane that survived a killed `ws-add`? | Keep — the operator's ruling, applied at both the ccd and dispatch layers. |
| Q10 | May a branch be renamed while a program claims the workspace? | Never, for the life of the claim. |
| Q11 | Is `runs.branch` frozen or followed? | Frozen — and §3.1 makes it accurate rather than merely stale. |
| Q12 | Does a hold forbid relocation and renaming, or only deletion? | Renaming: **yes** (§3.1). Relocation: **cosmetic yes, rescue no** (§3.3). Deletion: unchanged. Archive: unchanged, because README blesses the by-hand case — §2.3 gates it on **open runs** instead, which is the honest question. |
| Q13 | Hold per-session or per-run? | Per-session key, **run-aware server-side**. A refcount in ccd cannot work: the fleet host has no coord.db. |
| Q14 | May the sweep archive under an open run? | Never. The by-hand route may, with `{force:true}`. |
| Q15 | Should the abandon route stay ungated? | **Yes.** Its stated reason — a wedge caused *by* the coordinator must not be gated behind the coordinator's key — is untouched by F9, and §2.2 removes the harm. |
| Q16 | May the server archive autonomously beyond merged-and-unheld? | No. D-5 stays absolute. |
| Q18 | Does a human draft outrank a wave brief? | Yes, as today — but the brief stops being discarded silently (§4.5). |
| Q19 | Permanently undeliverable, or back off forever? | Keep the park; make it loud before and at the park. |
| Q20 | Must a blocked delivery be visible **before** the park? | Yes. `attempts` and `lastError` go on the wire (§4.5); today `lastError` exists only as a SQLite column. |
| Q21 | One serialiser for every box write? | No — see §4.6. |

## Open decisions for the operator

1. ~~Which accounts bill credits~~ — **answered 2026-08-14: none today.** F10's billing half is cut
   (§3.3). If a metered lane is ever added, the roster field this build declined to write is a small
   forward-compatible change, and the `<wrapper>-disabled` kill-switch covers the blunt case meanwhile.
2. **The `prefer` exec grant (§3.4) — I now recommend AGAINST it.** With Q1 answered its motivation is
   convenience, not correctness, and it costs permanent attack surface on the boundary CLAUDE.md
   guards. The honest-label alternative fixes the lying control for free. One word pulls it back in.
3. **Q6, implicitly settled by the ruling:** "roll back" is off the table; `ws-add` never deletes its own
   fresh work.
4. **When the widened guard (§4.2) finds a blank-marker wedge, may the system CLEAR it, or only
   refuse?** The spec as written only refuses. If refusal is the only outcome, a blank-marker wedge can
   be unstuck by nothing but a human at a terminal — and since the mail lane bounces off it
   (`draft-present`), that means one such wedge silences a wave until you intervene. If clearing is
   permitted, the system can recover on its own but may destroy text you typed. **This is the one place
   in the build where the two review lenses genuinely disagreed**, and it is a judgement about your own
   input box, so it is yours. My lean: refuse-only, because §4.1 now hands the text back and the PWA
   rescue makes recovery one tap.
5. **Does the thundering-herd surface join this build, or stay separate?** `5bdc6dd` jittered
   `_dispatch_swap`, which is the *dispatch* half. The half it does not address is that the
   SessionEnd/SessionStart hooks behind each swap each launch a ~2 GB telemetry scan with no
   concurrency bound — jitter spreads the herd but does not cap it, so a wide enough event still
   converges. A cap belongs to whoever owns that lane. It is **not** in Waves 1–4 as written, and I
   would rather it be a deliberate addition than an assumed one.
6. **Merging `fix/ccd-swap-jitter` before Wave 1 ships ccd — treat this as a gate, not a note.** The fleet host is running that branch
   unmerged, and its provenance marker is stale. Wave 1's agent-first deploy has to land on top of a
   clean marker, not underneath one — and it must not silently revert a fix that is already in
   production. Not my branch, so not my merge: flagging it, not touching it.

## Testing

Mutation-table discipline throughout: every guard ships with a test that goes **RED when the guard is
deleted or mutated**, measured before and after, not asserted in a comment. For guards whose only failure
mode is *firing wrongly*, the mutant makes them fire.

**The one structural obstacle, and the fix:** every `ws-add` test today sources ccd with
`_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };` (`ccdWsHelpers.ts:50`), so the ordering at
`ccd:1257`, the pane-survives-the-kill property and the missing-`started` residue are **all outside the
mutation table** — which is precisely why F8 shipped. Wave 1 adds a harness variant that leaves
`_spawn_start`/`_spawn_settle` real and stubs **three** things: `tmux`, `_accept_first_run_prompts`,
and `_ws_supervise` **as a RECORDING stub** (`_ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; }`
— the idiom `ccd-hold.test.ts:66-67` already uses, readable through `h.calls()`).

**`_ws_supervise` must NOT be left real, and this is a safety rule, not a preference.** ccd states the
hazard itself at `:291-293`: *"sourcing ccd and calling cmd_ws_add under vitest would otherwise enable a
REAL `claude-session@<id>` unit on the host."* The unit template is installed on this box, the harness
spreads `...process.env` into the child so the real user manager is reachable, `[Install]
WantedBy=default.target` writes a **persistent** symlink into the live
`~/.config/systemd/user/default.target.wants/`, and `ExecStart` + `Restart=always` would start a
restart-forever supervise loop against a workspace that exists only in a vitest tmpdir. Worse,
`ccd:294-295` swallows the error, so **the test would pass green while doing it.** An earlier draft of
this spec prescribed stubbing only two things; that draft would have had the safety net breach the
safety boundary.

The recording stub is also the only way §1.1's invariant is *expressible*: a real `systemctl` writes
nothing into the fixture, so "…and the unit is enabled" would have nothing to assert against.

**Wave 1 also plants a poisoned/recording `systemctl` in `makeCcdHarness`**, beside the existing `gh`
poison (`ghContainedEnv`, `ccdWsHelpers.ts:71-84`), making the systemd boundary structural rather than
per-test convention. Wave 1 is the first work to exercise the spawn path for real, so it is the right
moment.

*(One claim from an earlier draft is withdrawn: the harness does NOT need new capability for the
concurrency and kill-mid-flight pins. `sh()` runs an arbitrary bash snippet and the suite already does
both — `ccd-ws-reap.test.ts:253-259` runs a real concurrent `flock` holder, `:299-306` backgrounds a
verb and `kill -9`s it mid-window.)*

Pins the build must produce, at minimum:

- `started` is on disk before anything blocks; killing the settle leaves a supervised workspace.
- `_accept_first_run_prompts` returns 3 on exhaust and 4 on a hard block, and `_inject_spawn_effort` does
  not run for either.
- Two concurrent `ws-add`s for one project: one wins, one refuses `busy`.
- A **killed** ws-add that created exactly one **unheld** workspace adopts it; a clean non-zero exit
  never adopts, whatever the candidate count; zero → still fails; two → still `ambiguous-dispatch`;
  one **held** candidate → refuses.
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

## What this spec has NOT designed

A five-lens adversarial review (2026-08-14) attacked this document against shipped code; four blockers
and eight evidence corrections are folded in above. The review was also asked what it did **not** cover,
and the honest answer matters more than the findings:

- **The PWA surface, end to end.** Three of the four waves ship user-visible changes and none is
  designed past one sentence: where the §1.6 `spawnState` chip goes in an already-crowded fleet row,
  whether `MailStrip` has room for a third row shape (§4.5), what the §2.3 `409 run-open` sheet looks
  like, and whether `MailSummary`'s widening breaks the PWA's mail revivers. **The plan must budget a
  design pass per wave**, or these get invented by whoever implements them last.
- **Test-suite blast radius, enumerated.** `coordinator-skill`, `single-definition`, `whitelist-subset`,
  `verb-gate`, `hold-gate`, `send.test.ts`'s live-capture frames, `ccd-workspaces`, `node-floor` are all
  candidates. Discovering them one at a time will thrash; enumerate them per wave before writing tasks.
- **What Wave 1's ccd install does to ~11 live sessions.** `install_atomic` replaces `ccd` while a dozen
  `ccd supervise` loops are mid-tick, each about to call `_auto_swap_check` from the *new* file. Nobody
  has looked at that, and Wave 1 changes the spawn path those loops use.
- **Added query load.** `openRunsForSession` is called per record inside `sweepNames` and
  `archiveMerged` — N synchronous `node:sqlite` queries per tick on the event loop. At ~11 rows this is
  almost certainly negligible, but `CoordStore`'s synchrony is a stated invariant precisely because
  someone cared, so "almost certainly" should become a measurement.

## Non-goals

- Deleting, reaping or archiving `swift-harbor`, or any other live workspace. Detection only.
- A cross-box input-box serialiser (§4.6).
- New coordination verbs. The exec surface stays `EXEC_COMMANDS = ['tmux','ccd']`, and coordination
  mutations keep riding already-granted `CcdArgv`. `prefer` is a fleet-mutation verb, not a coordination one.
- Any `FLEET_PROTO` bump. Every wire change here is additive and absence-permitting.
- Writing the `pool` registry field (it has a reader and no writer anywhere in ccd). Noted, not fixed.
- Settling the NBSP question (§4.6) or the consumed-uuid question (§1.1) by experiment. Both fixes are
  correct under every reading, so neither blocks.
