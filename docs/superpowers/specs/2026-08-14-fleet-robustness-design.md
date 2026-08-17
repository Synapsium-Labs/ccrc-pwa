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

**The operator's directive of 2026-08-15 sets the priority explicitly** — *"the main thing is to build
the system that prevents reoccurrences of similar class of issues"*, with `swift-harbor` itself accepted
as unrepaired and a one-time fix available if wanted. So this build is judged on the class, not the
instance. The class, stated so it can be designed against:

> **A fleet mutation is interrupted partway and leaves durable state that no read-only verb can name,
> while every existing surface reports the fleet healthy.**

F8 is one member. The grounding pass found **six more on the live box** — three sessions with no systemd
unit at all, three units running but not boot-persistent, three registry rows whose pane is gone, eight
worktrees with no registry row, two live workspaces whose registry `.branch` disagrees with git HEAD, and
zero holds against a coordination database that believes it owns claims. Not one of those is visible to
`ls`, `ws-audit`, `ws-gc` or `ensure`. Fixing F8 alone would leave the class untouched.

The doctrine this build adds, which future mutations inherit:

> **Every fleet mutation that creates durable state must write its claim before it blocks, and must
> leave a residue that a read-only verb can NAME.** A mutation whose interruption produces a state no
> verb can name is a defect, not an edge case.

§1.1–§1.5 and §1.7 are the first half (write the claim before you block). **§1.6 is the second half and
is the mechanism that makes the doctrine enforceable rather than aspirational** — a divergence census
that new classes are added *to*, so the next bug of this shape becomes a row in a table instead of a
bespoke chip nobody generalises from.

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

**The baseline is FROZEN at `d7137c2`, and every `ccd:N` below is stale.** `main` moved three times
under this document: `21fef2a` (7523 lines) → PR #49 `5f1e666` (7544) → PR #50 `d7137c2` (**8612**).
Two of those flips I chased by hand and one by an arithmetic offset map, and each time the map was
dead within a day. So this document stops carrying line numbers as if they were facts.

**The rule, from here to the end of this build:** every anchor is *derived by content* against the
frozen ref — `git grep -n <identifier> d7137c2 -- <path>` — never copied forward from this document
and never taken from `origin/main`, which is a moving target. A `ccd:N` printed anywhere below is a
**historical note recording where a thing was when it was found**, not an address to open. The
identifier is the address. Where a section's argument depends on the surrounding code rather than
on the identifier alone, the section quotes the code verbatim so the quote can be grepped.

**The waiver is not about `ccd` alone — it covers every SERVER-side anchor in this document too.**
Those were measured before PR #50, and #50 rewrote three of the files they point into: `+40` lines in
`server/src/watch.ts`, `+268` in `shared/api.ts`, `+199` in `README.md`. A `watch.ts:N`, an
`api.ts:N` or a `README.md:N` below is the same kind of historical note as a `ccd:N`, and must be
re-derived by content at `d7137c2` before anything is opened. The five that were re-derived by hand,
recorded so nobody chases the old ones:

| Anchor as measured | At `d7137c2` |
|---|---|
| `archiveMerged` at `watch.ts:1900-1963` | `:1920-1999` |
| the "consult the fresh answer, not the snapshot" comment this build cites as *already fixed once*, `watch.ts:1931-1935` | `:1951-1955` |
| `composePrompt` at `shared/api.ts:2275-2277` | `:2556-2558` |
| `README.md:202-205`, cited by §2.3 as blessing a by-hand archive of a held workspace | **BROKEN** — those lines are now the lifecycle-field table's header. The premise survives intact at **`README.md:277`**: *"manual archive/restore — a merged-but-held workspace can still be archived by hand from the PR sheet"*. §2.3's argument is unaffected; only its address was. |
| C5's `README.md:191` | `:265` — *"A hold has exactly two consumers."* |

`sweepNames`' own narrowing rungs moved the same way (`:1267`/`:1269` → `:1273`/`:1275`), and
`archiveMerged`'s (`:1911`/`:1912` → `:1931`/`:1932`); both are corrected in place below, because one
of them was a directive an implementer would have followed.

`d7137c2` is the merge of PR #50 (`ws/fix-swap-transcript-defect-family`), which landed **while this
spec's implementation plan was being written** and shipped a substantial part of Wave 1 — see
"What PR #50 already shipped" below. Wave 1's remaining scope is stated against that fact, not
against the pre-#50 tree this document was originally measured on.

Two live facts that follow, and that the pack could not have seen:

- **The fleet host was running unmerged ccd — RESOLVED, and the resolution is why the baseline moved.**
  When measured, installed = `5bdc6dd` (`fix/ccd-swap-jitter`, pushed but not merged) against `main` =
  `871215b`: the box was *ahead* of `main`. `ccd version` also reported a stale provenance marker
  (`c8fd87f`, built 2026-08-12), which by `baf8e5b`'s own account would make ccd "report `ccrc-edited`
  on every box forever, the verdict that tells the stage-2b installer NOT to replace it." Both are now
  closed: PR #49 merged that branch and PR #50 merged a much larger one on top. **The standing
  obligation survives the specific incident** — Wave 1 must not ship ccd while the box is ahead of the
  merge target, and every commit touching `ccd/ccd` re-stamps the marker in *that* commit, or the
  agent-first deploy lands under a marker that refuses it.
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

## What PR #50 already shipped

PR #50 (`ws/fix-swap-transcript-defect-family`) merged as `d7137c2` **while this spec's implementation
plan was being written** — 18,125 insertions across 85 files, `ccd/ccd` 7544 → 8612 lines. It is a
different build closing a different incident, and it lands on the same code Wave 1 designs against.
Read this section before any wave; it is the difference between the tree this spec was measured on and
the tree it will be implemented on.

**Everything in this section was re-verified by hand at `d7137c2`**, including thirteen absence greps.

**Shipped, so struck from this build:**

- **The settle loop's silent-success lie is fixed — with a wider verdict table than §1.2 asked for.**
  `_accept_first_run_prompts` now returns `0` ready, `2` login, **`3` the tmux session vanished
  mid-poll** (with a one-shot `has-session` debounce so a flaky read on a loaded box does not
  manufacture a false failure), **`4` the window expired**. Its docstring carries the whole table and
  names M6. §1.2's "it will return 3 on exhaust" is **superseded**: exhaust is `4`, and `3` is a
  genuinely different condition the spec never distinguished.
- **The verdict is already a durable registry fact.** `_spawn` writes `_reg_set "$id" spawn
  "$(date +%s) $prompt_rc"` — field `spawn`, encoding `<epoch-seconds> <rc>` — under a comment making
  §1.2's own argument: "The verdict becomes a FACT before it becomes a return code … an exit code is on
  nothing's wire at all." **§1.2's proposed `spawnstate` field must not be minted.** Build on `spawn`;
  its timestamp is load-bearing, because `_supervised_start` compares `at >= since` to tell *this*
  attempt's failure from the previous one's — a bare word field cannot.
- **`_inject_spawn_effort` is gated on `prompt_rc == 0`**, exactly §1.2's requirement, and strictly
  stronger than the `!= 2` it replaced.
- **Every session-creating verb reports a failed spawn.** All four capture `rc=$?` and print to stderr
  naming the fact file — `ccd: ws-add spawn failed for <id> (spawn rc <rc>) — see $REG/<id>.spawn`.
- **`cmd_ws_add` already exits NON-ZERO on rc 3/4**, deliberately. **This contradicts §1.2's stated
  polarity** ("`ws-add` still exits 0 on a non-`ready` settle") in the present tense — see §1.2, where
  the contradiction is now resolved rather than restated.
- **A per-row lifecycle chip already ships in the PWA** (`sess-lifecycle`, with a `data-lifecycle`
  attribute and an actions-sheet repair gate), fed by a shipped vocabulary. §1.6's "the PWA surface
  stays modest" is satisfied by construction: the chip exists.
- **`cmd_enable` has no `systemctl` call to move.** It is an arity check, `_id`, `cmd_start "$@"`, and
  an echo. §1.1's instruction to move its `enable --now` earlier is **struck** — followed literally it
  would mint a *second* `enable --now` for the same unit, racing `_supervised_start`'s own, and without
  the `reset-failed` that one is paired with.
- **`CCD_VERB_TIMEOUT_MS` already carries `'ws-add': 300_000` and `ensure: 300_000`**, under a comment
  naming F8 and stating the unclosed ccd-side half verbatim. Only `start` and `enable` still lack rows.
- **A crash-looping session now becomes a FAILED unit rather than an invisible restart loop.**
  `claude-session@.service` gained `StartLimitIntervalSec=120` / `StartLimitBurst=5` **in `[Unit]`** —
  with a measured note that putting them in `[Service]` silently honours the burst against systemd's
  default 10 s interval. This makes `orphan` mean something real. It does **not** touch `KillMode` or
  the substrate-parenting question, so §1.7 stands.

**The largest overlap: a `SessionLifecycle` vocabulary, which is most of §1.6's mechanism.**

`shared/api.ts` now carries `SessionLifecycle = running | unsupervised | stopped | restarting | orphan
| never-started | unmeasurable`, with the derived-enumeration discipline (`Record<SessionLifecycle,
true>` → `SESSION_LIFECYCLES`, docstring naming TS2739/TS2353), an `isSessionLifecycle` narrower, a
clock-free pure ladder `sessionLifecycle(input)`, a `LifecycleInput` carrying an explicit `unmeasured`
field-name list, and `SUPERVISED_FRESH_MS`. `FleetSession.lifecycle` rides the wire through
`reviveFleetSession`. ccd carries the **bash twin** `_session_state`, and
`server/test/sessionLifecycleFixture.ts` drives both from one table.

It is good work, it follows the same doctrine §1.6 argues from, and **§1.6 must extend it rather than
mint a second vocabulary beside it.** §1.6 is rewritten accordingly.

**But the bug that started this build is still invisible, and the proof is one line.**

    if (input.alive) return supervised ? 'running' : 'unsupervised';

`input.started` is read on **exactly one line** of the ladder, reachable only after that branch has not
returned — i.e. only when `alive === false`. So the F8 shape — registered row, **live pane**, fresh
heartbeat, **no `started` stamp** — returns `'running'`, bit-identical to a healthy session. The bash
twin has the identical structure. Downstream it is equally invisible: `FleetSession` carries no
`started` field, so the bit never reaches the wire; the chip is `null` for `running` by design. The bit
has exactly one consumer in the tree — `fleet.ts`'s `started: r.started` into `LifecycleInput` — which
discards it one branch later. The shipped suite corroborates by omission: **no fixture row combines
`alive:true` with `started:false`**, so the 24-combination cross-language sweep still yields only six
tokens.

**This sharpens §1.6's finding rather than weakening it.** The spec said `started` was "consumed by
nothing"; the truth is that it *is* consumed, and thrown away on the branch where it matters. And it
makes the remaining fix small: **one rung on a ladder that already exists**, flowing to a chip, a
`data-` attribute and a repair gate that already exist.

### The live specimen

`ccrc-pwa-swift-harbor` has been sitting on the box since 2026-08-12 18:10:03 in exactly the F8 state:
ten registry rows, **no `.started`**, **no systemd wants-symlink**, **no `.hold`**, a **live tmux pane**
at an idle prompt, zero transcript, `$0.0000` spent, on the `claude-dev0` lane. Every verb reports it
healthy: `ls` → `ALIVE yes`; `ws-audit` → `not-archived` (and carries **no liveness field at all** —
`_alive` appears nowhere in `cmd_ws_audit`); `ws-gc` → `tracked`, the one state the prune arm prints
nothing for (`ccd:6214-6219`, `:6679-6680`); `ensure` → `alive: <id>`, exit 0, repairs nothing.

It is also no longer invisible in one respect: `sweepPr` stamped `.prphase=no-commits` onto it at 06:59
on 2026-08-14, so it does flow into `this.prStates`. `archiveMerged` skips anything whose phase is not
`merged` (`archiveMerged`'s phase skip, `watch.ts:1930-1932` at the frozen ref) and — having never taken a turn — it will never have a merged PR, so
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

This is the single highest-yield change in the build, and **PR #50 closed part of it — but not the
root cause.** Read this section against `d7137c2`, not against the pre-#50 tree the original draft
measured.

**What is still broken.** `cmd_ws_add` holds, in this order:

    local rc; _spawn "$id" new; rc=$?
    _reg_set "$id" started 1
    _ws_supervise "$id"

`_spawn` blocks for 900–1350 s inside `_accept_first_run_prompts`, and the agent kills it at 300 s.
Every kill lands in that window, and both the claim and the supervision are on the far side of it.
`cmd_ws_restore` has the identical shape. **That is F8's root cause, untouched.**

**What #50 already fixed, so this section no longer claims it.** The out-of-unit `ccd start` path —
the one the app actually uses — no longer calls `_spawn` at all. It calls `_supervised_start`, which
runs `systemctl --user reset-failed` and `systemctl --user enable --now` **before** any spawn, polls
for a bounded `SUPERVISED_START_WAIT` (30 s), and returns; `started` is written after that bounded
call, not after a 900 s settle. `cmd_ensure` out-of-unit is identical. **The original claim that
`cmd_start` "carries the identical F8 ordering" is false at this baseline — strike it.** Likewise
strike the instruction to move `cmd_enable`'s `systemctl --user enable --now` earlier: `cmd_enable`
contains no `systemctl` call at all (it is an arity check, `_id`, `cmd_start "$@"`, an echo), and
following that instruction literally would mint a **second** `enable --now` for the same unit, racing
`_supervised_start`'s own — and without the `reset-failed` that one is deliberately paired with.

`_spawn` splits into two:

- **`_spawn_start <id> <mode>`** — resolve the registry, build the wrapper argv, `tmux new-session -d`.
  Returns in milliseconds.
- **`_spawn_settle <id> <fromswap> [bound]`** — the blocking gate loop and `_inject_spawn_effort`.
  Writes the `spawn` verdict fact (§1.2). Never writes `started`.

`_spawn` remains as the composition of the two, so `swap` is unchanged.

**Pick ONE `started` writer, explicitly.** There are already four unconditional `started` writers among
the verbs, plus writes inside `_supervised_start`. Moving the write into `_spawn_start` while leaving
the existing ones gives `started` six writers across two processes — a fact with six authors is a fact
nobody owns, and it is the same defect class as two vocabularies for one state. **Either `_spawn_start`
becomes the sole writer and every caller's line is deleted, or the callers stay authoritative and
`_spawn_start` writes nothing.** The plan states which, once, and the test pins the count.

**Enumerate the `_spawn` call sites by grep at the frozen ref, not from this document.** The
measurement pass found **six**, not the three or four earlier drafts claimed — the four verb paths plus
fallback sites inside `_supervised_start`, which are reached when systemd is unavailable. Those
fallbacks are new scope this spec did not originally cover and the plan must convert them too;
a fallback that still spawns-first re-opens the hole on exactly the boxes least able to recover.

Per call site:

- `cmd_ws_add` and `cmd_ws_restore` keep `_ws_supervise "$id"` **between** the halves.
- The **in-unit** branches of `cmd_start` and `cmd_ensure` still spawn-first and convert to the split
  form, writing `started` between the halves. Neither supervises, and that must stay: `cmd_supervise`
  **is** the unit's `ExecStart` and reaches `cmd_ensure` with `CCD_IN_UNIT=1`, so supervising there
  would have the unit `enable --now` itself on every restart. ccd records that as an explicit decision
  — *"`ccd ensure` does NOT re-supervise … boot persistence would be silently lost"* — and this build
  does not overturn it.
- The `_supervised_start` fallback sites convert to the split form with the same ordering rule.

`CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`) already carries **`'ws-add': 300_000` and
`ensure: 300_000`**, added by #50 under a comment naming F8 and stating the unclosed ccd-side half
verbatim. **`start` and `enable` still have no row**, so both inherit the flat `CCD_TIMEOUT_MS =
90_000`. They no longer end in a 900 s `_spawn` — `_supervised_start` bounds itself at 30 s — so this
is now a smaller correctness fix rather than a latent F8, but it is still wrong: a verb whose worst
case exceeds its budget should say so in the table. Add both rows.

The invariant, scoped to match: **every path that creates a session writes `started` before it blocks,
and every path that supervises at all does so before it blocks.** A kill after `_spawn_start` therefore
leaves an ordinary, restartable session — F8's residue class ceases to exist.

It also fixes the wrong-mode resurrection. `cmd_ensure` picks `mode=new` when `started` is empty, which
hands `--session-id '<uuid>'` to a wrapper for a uuid whose `session-env` directory already exists
(measured on the live orphan). With `started` written at session-creation time, `ensure` picks `resume`.

**One caveat, stated rather than glossed:** `started` becomes monotone at session-creation time and
nothing ever clears it — there is no `_reg_del`/`_reg_unset` anywhere in ccd (grepped: zero hits). So a
session killed *before any transcript was persisted* now gets `mode=resume` forever, i.e. `--resume
'<uuid>'` against a zero-transcript uuid. That direction was **not** measured. Wave 1 therefore ships an
explicit fallback: if `_spawn_start`'s `--resume` fails, retry once with `--session-id`. #50's own
stderr text names the same trap from the other side — it tells the operator to clear
`$REG/<id>.started` by hand when a session never really started — which is corroboration that the
monotone-`started` hazard is real, and an argument for the automatic fallback rather than a manual one.

**Test-harness obligation this change creates.** #50's `_supervised_start` reaches
`systemctl --user enable --now` from paths the ccd harness closes only per-file today. Wave 1 extends
the shared harness (`server/test/ccdWsHelpers.ts`) so the protection is structural rather than
per-test. Note that stubbing the systemd probe **alone is insufficient**: making it report "no systemd"
sends `_supervised_start` down its fallback into a **real** `_spawn`. The stub set must cover
`_spawn`, `_ws_supervise`, and `_supervised_start` together, and `_ws_supervise` must be a **recording**
stub so the ordering this section specifies is asserted rather than assumed.


### 1.2 The settle loop stops lying, and stops running past the agent's ceiling

**Half of this section shipped in PR #50. What remains is the ceiling and the hard-block recognizer.**

**Shipped, and struck from this build:**

- **The silent-success lie is gone, in a wider form than this section asked for.**
  `_accept_first_run_prompts` returns `0` ready, `2` login, **`3` the tmux session vanished mid-poll**,
  **`4` the window expired**. This section originally asked for "return 3 on exhaust"; the shipped code
  distinguishes *two* failure modes where this spec saw one, and numbers exhaust `4`.
  **Do not renumber.** Four call sites plus `_supervised_start` already branch on `[[ "$rc" -eq 3 || "$rc"
  -eq 4 ]]`, and renumbering would silently retarget every one of them.
- **The docstring stops claiming it confirms the TUI on a path where it does not** — it now carries the
  whole verdict table and names M6 explicitly.
- **`_inject_spawn_effort` is gated on `prompt_rc == 0`**, which is exactly this section's requirement
  and strictly stronger than the `!= 2` it replaced.
- **The verdict is already a durable registry fact** in field `spawn` (§1.6b). **`spawnstate` must not
  be minted.**

**Still needed, and both are real:**

- **A hard-block branch — returning `5`, not `4`.** `_pane_hard_blocked` already matches a
  limit/spend/auth banner, and the shipped regex is wider than an earlier draft quoted: it also carries
  `hit your .*spend`, `Too Many Requests`, `rate limit(ed| exceeded| reached)?` and `Invalid API key`.
  **Its only caller is still `_auto_swap_check`** — verified at the frozen ref, three references
  total: one comment, the definition, and that one call. The settle loop calls it and returns a new
  code. `4` is taken by exhaust, so the recognizer gets **`5`**; the codes `_accept_first_run_prompts`
  can produce today are 0, 2, 3 and 4, so `5` is free. The distinction is worth a code of its own: an
  expired window means *we do not know*, a hard block means *we know exactly what is wrong and waiting
  longer cannot fix it*. Collapsing them would be an adapter narrowing a distinction it received. This
  is the recognizer `build4.md` asked for; it already exists one call away, which two measurement
  agents found separately and neither connected.
- **A wall-clock bound, not an iteration count.** The bound is still purely iterative:
  `SPAWN_GATE_TRIES=450`, consumed as `for i in $(seq 1 "$SPAWN_GATE_TRIES")`, with **no epoch read
  anywhere inside the function**. That is 900 s on the plain path and ~1350 s when gate branches fire
  (`sleep 1` + `sleep 2` each) — 3× to 4.5× the agent's hard 300 s ceiling. #50 made the variable named
  and overridable, which is an improvement, but a session slower than 300 s still **cannot be spawned
  through the dispatch path at all; it can only be killed**. `CCD_SPAWN_SETTLE_S`, default **240**, on
  the agent-reachable path: it leaves room for the rest of `ws-add` under the ceiling, and is safe only
  *because* of §1.1 — exceeding it is now a report, not an orphan.

  **The bound must be per-caller, and an earlier draft had the discriminator exactly backwards.** The
  loop is also reached from `cmd_supervise` (systemd `ExecStart`, no ceiling) and from `ccd swap`. That
  draft keyed the two bounds off `fromswap`, believing swap takes the slow branch. **Measured false:**
  `cmd_swap` writes `lastswap` two lines before the restart, and `_spawn` sets `fromswap=1` within
  300 s of `lastswap`. So **swap takes the FAST branch and a fresh `ws-add` is `fromswap=0`** —
  implemented literally, `ws-add` would have got ~900 s and this whole bound would have evaporated.

  So **`_spawn_settle` takes its own bound parameter, defaulting to 240 s**, and the no-ceiling callers
  raise it. Not `fromswap`. The distinction being drawn is "is there an agent ceiling above me", which
  no existing flag encodes — note `_accept_first_run_prompts` takes only `(tmuxname, fromswap)` today,
  and that `cmd_supervise` reaches the loop *through* `cmd_ensure`, so the bound has to thread through
  that call rather than being read from the environment at the bottom. A global 240 s is also wrong: it
  would make every systemd restart of a large session settle unconfirmed — the "700k+-token resumes
  take minutes between gates" case the docstring cites for its ~15 min window — which **suppresses
  `_inject_spawn_effort`** and, under §1.6, would light a warning on a healthy session.

**The exit-code question is RESOLVED, not restated.** An earlier draft of this section ruled that
`ws-add` "still exits 0 on a non-`ready` settle", arguing that a non-zero exit "would make `dispatchRun`
return `fleetFailed` and re-create the very orphan we are closing". **The baseline now contradicts that
in the present tense:** `cmd_ws_add` already exits non-zero on rc 3/4, deliberately and loudly, and #50
states the reason — a failure that is not reported is the defect it was closing.

The resolution is that **§1.1 makes the loud polarity safe, and it was not safe before.** Once the
claim and the supervision are written before the blocking wait, a non-zero `ws-add` no longer means "an
orphan was created"; it means "the session exists, is claimed, is supervised, and did not confirm its
TUI". That is a report about a *restartable* session, and §1.5's adoption path is what reads it.

So: **keep #50's non-zero exit, and make dispatch read the fact rather than the code.** The distinction
that matters lives in `spawn` and in the session's own existence, not in the exit status — an adapter
may not narrow a distinction it received, and the exit code is the narrowest channel available. The
plan must verify the `dispatchRun` path end-to-end against this polarity, because that path is live at
the frozen ref and the earlier draft's premise about it is the one thing here that was never measured.


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

**There is no type called `ExecRes`** (grounding, §1.4 correction). The real seam is three hops, and the
middle one is the problem: `ExecResult` (`server/src/exec.ts:3`), then `asExecResult`
(`server/src/remote/runner.ts:83-90`) which **rebuilds the object field-by-field and therefore discards
anything the agent sends beyond `code`/`stdout`/`stderr`** — the L3 "an adapter may not narrow a
distinction it received" rule failing in exactly the place §1.4 depends on — then `ccd()`
(`lifecycle.ts:14`), which would drop it one hop later.

`ExecResult.killed` is **optional**; `CcdResult.killed` may be required. Optional is not a style choice:
249 bare `{code, stdout, stderr}` literals across 32 test files make a required field a suite-wide break.
Additive, absence-permits, **no `FLEET_PROTO` bump** — an older agent omitting it reads as `killed: false`,
the safe direction.

**And `killed` is structurally false in `local` mode:** `realRunner` (`exec.ts:6-12`) passes no `timeout`,
so nothing ever kills ccd there and §1.5's adoption path is unreachable. Every test of it must inject a
runner.

### 1.5 Dispatch adopts what a killed `ws-add` left behind

`dispatch.ts:183` returns `fleetFailed` the instant `res.ok` is false — **before** the BEFORE/AFTER
registry diff that would have discovered the new workspace, before `coord.setSession`, before the hold.
That single early return is what turns a slow spawn into an unclaimed workspace and a run stuck in
`planned` with no `run_events` row at all.

New behaviour on `!res.ok`: **run the AFTER diff anyway.**

- **exactly 1 new candidate, AND `res.killed === true`, AND `winner.held === null`** → **adopt it.**
  Bind the run, place the hold, record `spawn-adopted:<spawnstate>` on the `run_events` row, and return
  `spawnState` so the coordinator knows the pane may not be ready.
- **any other `!res.ok`** — `killed:false`, 0 candidates, ≥2 candidates, or a candidate that already
  carries a hold → `fleetFailed` / `ambiguous-dispatch` exactly as today, claiming nothing on a guess.

**`killed:false` does not mean "a clean refusal".** `runner.ts:110-112` returns `{code:1, stderr:
e.message}` for any transport failure — dropped socket, client-side wait expiry — with no `killed`, and
`runner.ts:7-9` documents that collapse. **Three facts sit on `code:1`, not two:** ccd refused, we killed
ccd, and *we do not know because the link failed*. Not-adopting is the safe outcome for all three, so the
gate is right — but the prose must not imply a two-way split, and a test must pin that a `killed:false`
from the catch path does not adopt.

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

### 1.6 The alive branch learns to read `started`, and the census keeps only what a row cannot say

**This section was a chip. The operator's 2026-08-15 directive made it the mechanism the build is
judged on. PR #50 then shipped most of that mechanism under a different name — so this section is now
an EXTENSION of a shipped vocabulary plus a much smaller census.** Minting a second vocabulary beside
`SessionLifecycle` would be the very defect this build exists to prevent: two names for one fact, and
a reader who cannot tell which is authoritative.

#### The one-line fix that closes F8

`sessionLifecycle`'s ladder reads `started` on exactly one line, reachable only when `alive === false`.
So the F8 shape — live pane, fresh heartbeat, no `started` stamp — classifies as `running`. **The
entire detection is one new rung on the alive branch, and one new member of the union.**

    if (input.alive) {
      if (!input.started) return 'unclaimed';        // NEW: a pane nobody wrote a claim for
      return supervised ? 'running' : 'unsupervised';
    }

The rung goes **before** the supervised split, not after: `swift-harbor` was alive *and* supervised
*and* unclaimed, so an `unclaimed` checked after `running` can never fire on the specimen that
motivated it. `unmeasurable` still precedes everything — `started` is a `LIFECYCLE_FIELD`, so an
unreadable stamp already returns `unmeasurable` and cannot be mistaken for an absent one. That
ordering is the whole design; state it as the contract, because both implementations must agree on it.

**Why a new member and not a new census kind:** the fact is a property of one row, derived from inputs
the ladder already takes, and it flows for free to surfaces that already exist — the `sess-lifecycle`
chip, its `data-lifecycle` attribute, and the actions-sheet repair gate. A census kind would need all
three built again.

**Price it honestly.** "One line" is the ladder. The change also touches: ccd's bash twin
`_session_state` (the same rung, same position); `sessionLifecycleFixture.ts`, which today has **no row
combining `alive:true` with `started:false`** — that omission is why the shipped 24-combination sweep
yields only six tokens, and the new fixture row is what makes the sweep yield seven;
`session-lifecycle.test.ts`; `ccd-session-lifecycle.test.ts`'s set-equality assertion; and
`lifecycleWords.ts`'s `QUALIFIER`, which is `Record<Exclude<SessionLifecycle,'stopped'>, …>` and will
therefore **fail to compile** until the new member gets a sentence. That compile error is the
mechanism working, not an obstacle. This lands on the **agent-first** deploy lane, because ccd ships
first.

**The repair `unclaimed` names is `ccd ensure`, and it is the OPPOSITE of `orphan`'s.** `orphan` says
nothing is bringing this back — the repair is a process. `unclaimed` says a process is running that no
registry row claims — the repair is a claim. A single-class fix would have applied one to the other;
that distinction is the reason this section exists.

#### The census: three kinds, not seven

Four of the seven proposed kinds die on contact with the shipped vocabulary:

| proposed kind | ruling |
|---|---|
| `dead-row` (registered, `started=1`, no pane) | **DELETE.** This is `lifecycle === 'orphan'`, and as written it is strictly *broader* — the shipped ladder splits that same population three ways (a stop stamp makes it `stopped`, a fresh heartbeat makes it `restarting`). Derive it; do not re-classify it. |
| `unsupervised` (pane alive, no unit loaded) | **DELETE, and note why loudly.** One token, two evidence bases: the shipped `unsupervised` is a **heartbeat** verdict, chosen deliberately over unit introspection so the agent's read whitelist stayed unwidened. The systemd half is unreachable while `EXEC_COMMANDS = ['tmux','ccd']`, and re-using the word for it is the sharpest collision in this document. |
| `not-boot-persistent` (unit active, not enabled) | **DELETE.** Same reason: the server cannot see systemd and must not learn to. |
| `unclaimed-session` | **PROMOTE** to the `SessionLifecycle` member above. |

Three survive, because each is a disagreement *between sources* rather than a state *of a row* — which
is precisely what a per-row ladder structurally cannot express:

| kind | condition | repair |
|---|---|---|
| `unregistered-worktree` | worktree with no registry row | ws-gc's own verb; human-only |
| `branch-drift` | registry `.branch` ≠ git HEAD in the worktree | reconcile before a done-fingerprint trusts it |
| `claim-divergence` | hold without an open run, or open run whose session has no hold | Wave 2 supplies the inputs |

**Keep the name `unregistered-worktree` even though ccd's `_ws_gc_row` calls the same thing `orphan`.**
That is not a collision this spec creates; it is one that already exists, and in the worst form:
`orphan` currently means a *registry row with no pane* in one half of the repo and a *worktree with no
registry row* — the exact opposite — in the other. Naming this kind explicitly defuses the overload.
The mapping from ccd's word to the census's must be written down where the translation happens.

**And price these three honestly, because §1.6's earlier draft priced them at zero.** That draft
claimed the watcher "already reads git refs through `readBranchTip`". **That is false** — `fleet.ts`
imports no gitref module. So `branch-drift` means wiring `readBranchTip` into the watcher *and* undoing
the place where the statusline's branch already silently overrides the registry's, which is a real
decision, not plumbing. `claim-divergence` means giving fleet assembly open-run knowledge it does not
have, which crosses the coord.db containment that `single-definition.test.ts` pins. **If either price
is judged too high for this wave, cut the kind — do not cut the honesty about its cost.**

#### Where the census lives, and its single producer

`sessionLifecycle` co-locates its map and its classifier in L0, for a stated reason: two producers must
not be able to disagree. Splitting `DIVERGENCE_KINDS` (L0) from `divergences()` (L1) is defensible
**only if the census has exactly one producer**, and the plan must name it. In particular
`reviveFleetSession` must not become a second producer — the existing precedent in `fleet.ts` exists
specifically to prevent that shape.

#### What ccd owes the census

`ws-audit` gains `alive`, `started`, and `unit: 'enabled'|'loaded'|'absent'` — three fields it
structurally lacks today, which is why the artifact whose *job* is answering "what is the state of this
workspace" could not see F8. **They must be computed before `_ws_reap_eval`'s early refusal**, which
returns `not-archived` and leaves every downstream field null — that refusal is exactly the shape that
made the orphan invisible. The verb stays read-only and `['ws-audit','--session']` is already
whitelisted, so this adds **no exec surface**.

#### One deferral that expires

`fleet.ts` carries a deliberate deferral of the asymmetric-skew fix, justified on the grounds that
`lifecycle` is "a display-only qualifier that nothing server-side reads yet", and it names its own
expiry. **If the census makes lifecycle or any heartbeat-derived divergence drive an adopt/respawn
DECISION rather than a chip, that bound expires** and the deferred fix comes in scope. Wave 1 keeps it
a chip; the plan must say so explicitly so the deferral stays valid.

#### The enforcement clause

A new fleet mutation is not done until its interrupted state is either impossible or named — by a
`SessionLifecycle` member or a `DivergenceKind`. The single-definition describes make a second copy of
either enum a red suite; the per-class tests make a deleted class a red suite. That is the doctrine
from the Goal, given teeth.

### 1.6b The enum discipline, and the spawn verdict that already has a field

**`spawnstate` must not be minted. Extend the shipped `spawn` field.** `_spawn` already writes
`<epoch-seconds> <rc>` to `$REG/<id>.spawn`, and the server already parses it into
`SessionRecord.spawn: { at, rc } | null`. Nothing puts it on the wire, and that is the gap — not the
absence of a field. **The timestamp is load-bearing and a word-only field would destroy it:**
`_supervised_start` compares `at >= since` to tell *this* attempt's failure from the previous one's.

So the wire gains a **typed projection of the shipped rc table**, derived once in L0 from ccd's own
verdicts — `0` ready, `2` login, `3` vanished, `4` expired — rather than a parallel vocabulary of
words. A rc this build has never heard of must revive as "unrecognised", not as a throw and not as
`ready`.

**Neither new vocabulary gets single-definition protection for free.** `single-definition.test.ts` has
no generic scanner — it is hand-written per concept, each with its own literal regex and its own `it`.
Wave 1 adds a describe **per vocabulary**, in the established idiom, each scoped to `shared/api.ts`
with a derivation assertion and a member-enumeration scan. **And it adds one for the EXISTING
`SESSION_LIFECYCLES`, which shipped without one** — a gap worth closing in the same pass, by the same
rule this build is trying to establish.

**The chip needs no new component.** `lifecycleWords.ts`'s `QUALIFIER` is total over the union and the
`sess-lifecycle` span already renders it; `unclaimed` gets a sentence there and appears. The spawn
verdict is a second, orthogonal qualifier — it says how the *last spawn attempt* ended, not what the
row *is* — and must not be collapsed into the lifecycle word. A row can be `running` today after a
failed spawn yesterday; showing one as the other would be an adapter narrowing a distinction it
received.

**The `null` trap the earlier draft caught, restated against the shipped field:** `spawn` is written by
every spawn from #50 onward, so a row that has not spawned since carries none. `null` means *not
recorded*, explicitly — never *ready*, and never a warning. Pin it with a fixture row that has no
`spawn` file. `swift-harbor` has no `spawn` stamp at all, which is exactly why F8's detection keys on
`unclaimed` and not on the spawn verdict: **the class is the absent claim, not the failed attempt.**


### 1.7 The tmux substrate stops being defended by a comment

**#50 moved every anchor in this section, and added a sibling mechanism.** The unit file gained
`StartLimitIntervalSec=120` / `StartLimitBurst=5` in `[Unit]` (so a crash-looping session becomes a
FAILED unit rather than an invisible restart loop), and `SWEEP_CMD` gained a warning that names any
unit `try-restart` skipped because it was FAILED. Neither touches `KillMode`, so this section stands
unchanged in substance — but re-derive its anchors by content, and consider asserting the two new
`[Unit]` keys in the same test that pins `KillMode`, since they now share a failure story.

**Measured 2026-08-15.** The tmux server is pid 1569, `comm="tmux: server"`, up since 2026-08-05
22:52:29, and its cgroup is
`…/app-claude\x2dsession.slice/claude-session@claude-ccrc-pwa.service`. It owns the single socket
`/tmp/tmux-1000/default`, so **all 21 fleet sessions live on it**. Nothing chose that unit: whichever
`tmux new-session` ran first after boot created the server, and the server inherited the caller's cgroup.
Reparenting to `systemd --user` (PPID 1197) did not move it — cgroup membership does not follow
reparenting.

To size it honestly: the **panes** are not in that cgroup. Ubuntu's tmux is built with systemd support
and puts each pane in its own transient `tmux-spawn-<uuid>.scope` under the slice, which
`deploy/systemd/claude-session@.service.d/limits.conf` documents. The exposure is exactly one process —
but it is the substrate, and every pane dies with it, so the blast radius is the whole fleet.

`KillMode=process` (`ccd/claude-session@.service`, at `:29` since PR #50 added the
`StartLimitIntervalSec`/`StartLimitBurst` keys above it) is what makes this safe today, and it genuinely
works: on stop/restart systemd signals only `MainPID`, the `ccd supervise` bash. The hazard is what
happens if that line goes — **systemd's default is `control-group`**, so *deleting one line* turns
the deploy's `try-restart "claude-session@*"` (in `SWEEP_CMD`) into a fleet kill. And `grep -rn KillMode` over the
repo returns the unit file plus **two comments** and nothing else. By this repo's own doctrine that is a
request, not a mechanism.

Two mechanisms, both cheap, and deliberately at different layers:

- **Pin the line.** `agent/test/deploy-verify.test.ts` already reads `ccd/claude-session@.service`
  (twice), and its sweep test's own comment states the dependency verbatim — *"The unit is
  BUILT for this sweep: KillMode=process, with a comment that the tmux substrate must survive a
  supervisor restart"* — while asserting everything except that. Add the assertion there, with the
  failure message naming the consequence. Mutation: delete `KillMode=process` from the unit file, the
  test reds.
- **Make the deploy refuse to sweep into a bad configuration.** This matters more, because the sweep is
  the trigger. Before `try-restart`, assert the unit file about to be active carries `KillMode=process`,
  and print which unit currently hosts the tmux server (`cat /proc/$(pgrep -x -f 'tmux: server')/cgroup`).
  Abort the deploy rather than restarting 18 units into it. The ordering precedent already exists in the
  same block — the sweep is deliberately placed after the agent chain "so a broken agent fails the deploy
  before any supervisor is touched"; this is the same principle one step earlier.

**Third mechanism — the structural repair, which the operator's 2026-08-15 ruling ("reboot is fine once
fixes are in") brings into this build rather than deferring it.** The bug is that the server's cgroup is
decided by accident: whoever calls `tmux` first wins. So create it deliberately. `_spawn` gains an
idempotent `_tmux_server_ensure` ahead of its `tmux new-session`:

    _tmux_server_ensure() {   # place the SERVER in a known scope, not the caller's cgroup
      tmux list-sessions >/dev/null 2>&1 && return 0    # already up; nothing to place
      systemd-run --user --scope --quiet --collect --unit=ccrc-tmux-server \
        tmux start-server 2>/dev/null || tmux start-server
    }

This needs **no new unit file** — nothing extra to deploy or keep in sync across boxes — and it
self-heals: whenever the server is next created it lands in `ccrc-tmux-server.scope`. The `||` fallback
keeps ccd working where `systemd-run` is absent, which the single-box OSS story requires. It is the same
pattern tmux already uses for its per-pane `tmux-spawn-<uuid>.scope`.

**It only takes effect when the server is next created, which means a reboot** — cgroup membership
cannot be changed for a live process without a D-Bus `StartTransientUnit` adoption, and that is not
something to attempt against a process holding 21 live sessions. The reboot is therefore a **planned,
ordered step of Wave 1's deploy, and it must come after the ccd install**, or it recreates the same
problem.

**What a reboot actually costs, measured 2026-08-15 — this is the part to read before scheduling it.**
The box currently runs **21 tmux sessions, 18 active units, and 15 enabled units.** A reboot kills the
tmux server, so *every* pane dies; what returns is whatever systemd starts, which is the **15 enabled
units only**. Each of those resumes cleanly (`started=1` → `cmd_ensure` picks `mode=resume` → the wrapper
resumes from its transcript). **Six sessions do not come back on their own:**

| Session | Why not |
|---|---|
| `ccrc-pwa-calm-mesa` | unit active, **not enabled** — no `default.target.wants` symlink |
| `data-internal-plain-harbor` | same |
| `data-internal-still-prairie` | same |
| `ccrc-pwa-swift-harbor` | **no unit at all** — the F8 orphan; `_ws_supervise` never ran |
| `custom-tools-brisk-ridge` | no unit at all |
| `expoAI-assistant-warm-mesa` | no unit at all |

Two of those are archived rows and one is the orphan the operator has said to leave, so the real
decision is small — but it is a decision, not a surprise, and it must be made **before** the reboot, not
discovered after it. Pre-flight: for each of the six, either `systemctl --user enable
claude-session@<id>` (making it boot-persistent) or accept that its pane is gone and it needs a hand
`ccd ensure` afterwards. Scrollback and any in-flight turn are lost either way; transcripts are not.

Wave 1 therefore closes all three layers: the **regression** path (an edit that removes the guard), the
**trigger** (a deploy that sweeps into a bad config), and — after the reboot — the **design** flaw
itself.

## Wave 2 — a claim knows whose it is

**Bounded context:** Coordination. **Not server-only** — §2.3 falsifies a shipped `cmd_ws_release`
comment, so Wave 2 edits `ccd/ccd`, is **agent-first**, and hits the provenance-marker gate like every
other wave. No new verb.
**Closes:** F9 proper, the by-hand archive variant, release-then-crash, the wrong-wave hold overwrite,
and most of the sweep-blindness window.

The root cause is stated exactly by the code: the hold is one file keyed on the **session id** with a
reason string that is **display-only, never parsed back anywhere in this tree**
(`rundefs.ts:54-61`). It cannot answer "whose claim is this?", and the coordinator protocol
*deliberately* creates two open runs naming one session — `SKILL.md:207-215` mandates opening wave N+1
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
- **A new index, and it must be `MIGRATIONS[1]`.** `runs` has exactly two indexes (`schema.ts:87-88`),
  neither usable here: `sessionId` is unindexed and `state NOT IN (…)` is not seekable. Measured against
  the v1 DDL in an in-memory `node:sqlite`, the plan is `SCAN runs`; with
  `CREATE INDEX runs_by_session ON runs(sessionId)` it becomes `SEARCH … USING INDEX`. It **cannot** be
  an amendment to `MIGRATIONS[0]`: `db.ts` runs `for (v = current; v < VERSION; v++)`, so an edit to
  migration 0 never executes against a database already at `user_version 1` — and the server's copy is
  live, having driven five runs through build4. `schema.ts:149-153` and `:199-201` both justify amending
  v1 in place on the grounds that "coord.db has shipped to no box yet"; **that premise has expired** and
  those two comments must be corrected in the same task.

**No cache.** Measured N is not the record count: `sweepNames` narrows to **3** rows before the query
(the workspace/archived rung `if (r.workspace === null || r.archivedAt !== null) continue;`, then the
born-name rung — `watch.ts:1273` and `:1275` at the frozen ref) and `archiveMerged` to **0**; the live
`runs` table is **5 rows**. A
per-tick cache is also *slower* than the index (both defeat the same predicate; benchmarked at 10k rows,
indexed 0.27 ms vs cached 1.16 ms) and — decisively — a cached snapshot consulted at a destructive
decision point is the shape `watch.ts:1931-1935` already fixed once. Put the twelfth condition
**immediately after the born-name rung — `if (r.branch !== born) continue;`** — as
`if (r.held !== null || coord.openRunsForSession(r.id).length > 0) continue;` so the free in-memory
`held` short-circuits the query away for every claimed row. **Cite that rung by its code, never by its
number:** an earlier draft of this section said "immediately after `:1269`", and at `d7137c2` `:1269`
is `if (identity === null) continue;` — the degraded-row skip, three rungs and six lines too early,
ahead of both the workspace/archived test and the born-name test the narrowing argument below depends
on. The born-name rung is `watch.ts:1275` at the frozen ref; grep the line, do not open the number.
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
(`SKILL.md:207-215`). Nothing in §1.5 or §2.2 may read as though a constraint existed.

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

`archiveMerged` (`server/src/watch.ts`; `:1920-1999` at the frozen ref — find it by its signature,
not by the number) gains a third rung after `archiveSafety`: skip when
`openRunsForSession(r.id)` is non-empty, and push the same shape of notification `notifyHeldMerged`
already sends. Today `deps.coord` is in scope in that class and used **eight times** elsewhere in the
file, on eight distinct lines — one `else if` guard, two max-id reads, four `const` bindings and one
optional-chained `recordFeedEvent` — and the archive path never touches it.

This rung is what makes the whole surface safe rather than merely safer: it means an *absent* hold is no
longer sufficient to archive. Release-then-crash (the hold gone, the run still open, D-48 protecting the
run but not the workspace) and the archive-vs-hold race both stop mattering, because the sweep now asks
the authoritative question.

**The fourth fleet act is ungated, and it is in the function §2.2 rewrites.** `close.ts:210-214` —
`state === 'failed' && archive` → `CCD_ARGV.wsArchive`, which its own comment at `:206-209` calls "the ONE
explicit `wsArchive` call in the whole coordination lane" — takes neither the release nor the re-hold
branch and is untouched by the design above. `ws-archive` has no hold rung in ccd. So closing run A as
failed-with-archive while sibling run B is open **archives B's workspace and leaves B's `.hold` standing
over it**: F9's harm through a different door. The sibling check must gate this arm too, or the wave
closes three doors and leaves the fourth open in the same function.

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
**Depends on Wave 2** — §3.1 and §3.2 both consume `openRunsForSession`, which §2.1 introduces. The stated
order satisfies this, but a plan that parallelises the waves, or lands Wave 3 first because "it is just
ccd", breaks. **The `fix/ccd-swap-jitter` merge gate belongs to this wave at least as much as Wave 1:**
§3.3 edits `_auto_swap_check`, the caller of the machinery that branch changed, running on a 5 s tick
across 18 processes.

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

The coordinator skill's nine verbatim-pinned clauses are untouched; the reference file gains one sentence
saying the name is frozen for the life of the claim. **But `wave-lifecycle.md:99-111` is not wrong today
and the freeze repairs no falsehood** — it says `ws-add` creates the workspace on `ws/<slug>` (true) and
that the done-fingerprint re-measures `record.branch`, "the live registry's own field" (also true; that
field follows a rename). Measured live, 8 of 14 workspaces sit off their born name and the instruction
"commit on this workspace's own branch" holds under all of them. The freeze **adds a fact the file has
never stated**. Say it that way, or a reviewer goes looking for a lie that is not there. *(C9 is
correspondingly downgraded from "false" to "silent".)*

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
`swap.log`, in both directions). `ccd prefer` is the only writer that expresses a *deliberate* choice —
it is not the only writer of `.home` at all. `_ws_seed_home` writes it too, seed-once and never
clobbering (`[[ -f "$REG/$1.home" ]] || _reg_set "$1" home "$2"`), from two call sites; it is what puts a
lane on a brand-new row, and it steps aside for anything already there. `cmd_prefer`'s `_reg_set "$id"
home "$w"` is the only unconditional one, and it is unreachable from the server: no `CCD_ARGV` entry, no
exec-whitelist grant. **The seed writer does not change this section's conclusion** — a seed-once write
cannot make a lane choice durable against `_auto_swap_check`, because it never fires on a row that
already has a `.home`. The deferral stands exactly as stated below.

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
**with** a non-blank draft (`pwa/src/session/ChatList.tsx:331-332` — `session/`, not `fleet/`), so the
wedge-creating refusal gets no button at all,
only "The session never showed the text — open the terminal to check."

Per the ruling: the text stays in the box, and `verify-failed` returns the `draft` so the rescue renders.

**Widening `ChatList`'s condition on `code` alone would ship a button that sends TRUNCATED prompts** —
the sharpest defect the grounding pass found. The attachment path's `verify-failed`
(`send.ts:512-521`) returns `...(cleared.state === 'residue' ? { draft: cleared.draft } : {})`, so its
`draft` is **what a failed `clearBox` left behind — a fragment of the message, not the message**.
`submitEnter` cannot catch it: its correspondence gate compares the box's marker row against `expect`,
and the residue *is* what the box reads, so it matches, presses Enter, and submits the fragment. Two
conditions a caller handles oppositely would ride one field — the overloaded-value-at-a-seam defect the
ring rules name outright.

So the gate widens on a **new additive field**, not on `code`: `submittable?: boolean`, set by the new
ordinary-path `verify-failed` arm and by `enter-ignored`, and **not** set by the attachment path (which
keeps `draft` for display only). The condition becomes
`(code === 'enter-ignored' || code === 'verify-failed') && send.submittable === true && …`. An older
server never sends the flag, so no button — today's behaviour, the safe direction.

`pwa/test/send-it.test.tsx:34-40` is an intentional tripwire for exactly this: its comment says those
cases "are kept because they are what fails if the `code` branch is ever widened", and `verify-failed` is
in its list. It firing is the design working.

`SEND_ERROR_TEXT['verify-failed']` — *"The session never showed the text — open the terminal to check."*
(`pwa/src/lib/api.ts:35`) — becomes false twice over (the text IS in the box, and §4.4 makes this fire
more often), so Wave 4 **mints a new sentence** for it: *"Typed it, but the session never echoed it
back."* That string does not exist in the tree — do not grep for it, and do not go looking for a
register to copy it from. Its neighbour `enter-ignored` reads *"Typed it, but the session didn't take
it."* (`:34`) and is left exactly as it is; the two refusals become adjacent sentences in one register,
which is the point, not the same string reused.

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
recipient's screen. **`SKILL.md` itself has zero hits for `undeliverable|rejected|blocked`** — but the
skill's `references/` pages carry six matching lines — three in `mail-envelope.md`, three in
`wave-lifecycle.md`; `undeliverable` **3**, `rejected` **4**, `blocked` **0** — including *"the lane
gives up and marks the delivery undeliverable"* and three `state:"rejected"` mentions. An earlier
draft said "the coordinator skill has zero hits", full stop, which is false of the
reference corpus and would send an implementer to write text that already exists. **The argument
survives the correction, narrowed:** every one of those six passages is **recipient**-side — what
becomes of mail addressed to *you* — and there is no sender-side procedure anywhere in the skill. The
sender is who this section makes whole, and the sender is who is told nothing.

- `MailSummary` gains `attempts` and `lastError` (additive wire, no proto bump).
- `MailStrip` grows a distinct row for a queued delivery with `lastError === 'draft-present'`:
  *blocked — the recipient's input box has unsent text*. **The pattern exists; this row does not.**
  Today the component renders exactly one distinct status row, `.mail-strip-abandoned`, keyed on
  `item.state === 'rejected'`, and **nothing in `pwa/src` reads `lastError` at all** — grepped at the
  frozen ref, zero hits. So this is an extension of a shipped shape, not a variant of a shipped row.
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
Q1 (which lanes bill credits — **answered 2026-08-14: none today**), Q6 (roll back or keep — settled by the adopt ruling),
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
4. ~~This build does not repair `swift-harbor`~~ — **ruled 2026-08-15: accepted.** *"swift-harbor
   unrepaired is OK, main thing is to build the system that prevents reoccurrences of similar class of
   issues. We can do a one-time fix for swift-harbor if we need to."* That directive is now the Goal's
   framing and §1.6's mandate. The one-time fix, if wanted, is a human at a terminal running
   `ccd ws-hold`-free `ccd ensure ccrc-pwa-swift-harbor` — which repairs nothing today (both verbs
   early-return on `_alive`) — so in practice it is `tmux kill-session -t cc-ccrc-pwa-swift-harbor`
   followed by `ccd ensure`, or `ws-reap` under the human-only contract. **Not scheduled**; the census
   will name it as `unclaimed-session` and the operator decides.
5. ~~The tmux substrate is defended only by a comment~~ — **ruled 2026-08-15: pin it, and fix it here.**
   §1.7 now carries all three layers — a red-on-delete test, a deploy pre-flight that refuses to sweep
   into a bad config, and the structural repair (`_tmux_server_ensure`) — with a **planned reboot** at
   the end of Wave 1's deploy as the migration, since the operator has approved one once the fixes are
   in. The only thing still needing a human decision is §1.7's six-session pre-flight list.
6. **When the widened guard (§4.2) finds a blank-marker wedge, may the system CLEAR it, or only
   refuse?** The spec as written only refuses. If refusal is the only outcome, a blank-marker wedge can
   be unstuck by nothing but a human at a terminal — and since the mail lane bounces off it
   (`draft-present`), that means one such wedge silences a wave until you intervene. If clearing is
   permitted, the system can recover on its own but may destroy text you typed. **This is the one place
   in the build where the two review lenses genuinely disagreed**, and it is a judgement about your own
   input box, so it is yours. My lean: refuse-only, because §4.1 now hands the text back and the PWA
   rescue makes recovery one tap.
7. **Does the thundering-herd surface join this build, or stay separate?** `5bdc6dd` jittered
   `_dispatch_swap`, which is the *dispatch* half. The half it does not address is that the
   SessionEnd/SessionStart hooks behind each swap each launch a ~2 GB telemetry scan with no
   concurrency bound — jitter spreads the herd but does not cap it, so a wide enough event still
   converges. A cap belongs to whoever owns that lane. It is **not** in Waves 1–4 as written, and I
   would rather it be a deliberate addition than an assumed one.
8. **Merging `fix/ccd-swap-jitter` before Waves 1 and 3 ship ccd — a gate, not a note.** The fleet host is running that branch
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
- **One test per divergence class**, each red when its class is deleted from `DIVERGENCE_KINDS` — the
  enforcement clause of §1.6 is only real if the classes are individually pinned. Plus: a fixture with a
  row in each class produces exactly that census and no more; a healthy fleet produces an empty census
  (the false-positive direction, which is what would make the surface ignorable).
- `ws-audit` reports `alive`/`started`/`unit` **even when `_ws_reap_eval` refuses `not-archived`** —
  mutation: move the three fields back after the refusal, the test reds.
- Deleting `KillMode=process` from `claude-session@.service` reds a named test; the deploy's pre-flight
  refuses to sweep when the unit about to be active lacks it (§1.7).
- `_tmux_server_ensure` is a no-op when a server is already running, and places a newly created server
  outside any `claude-session@*` cgroup — pinned under a fixture HOME, never against the live box.
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

**All four waves touch `ccd/` and all four are AGENT-FIRST** (Wave 2 included — §2.3 edits a
`cmd_ws_release` comment). The full procedure, with its pre-flight census and post-deploy verification,
is in Part II, "What shipping ccd does to a live fleet". Three facts from it belong here because they
change the plan's shape:

1. **Wave 1 is a THREE-lane deploy, not two.** §1.4 lives in `agent/`, its own package with its own unit
   and its own `deploy.sh agent` invocation, and restarting it drops the single authenticated WebSocket
   the whole PWA runs over. `shared/` compiles into both lanes. The order is **ccd → agent → server**,
   with a link outage in the middle.
2. **The install is a `rename(2)` and running supervisors are safe — but they keep the OLD ccd.**
   Measured: 15 of 18 `ccd supervise` processes hold a deleted inode byte-identical to repo `main`, and
   `/proc/<pid>/fdinfo/255` shows `pos == size`, so bash has already read the script to EOF and has zero
   bytes left to read. Natural turnover is **3 supervisors per 12 hours**. So **the deploy's restart
   sweep is mandatory**: skip it and Wave 1's spawn invariant is false on most of the fleet for days,
   because `cmd_ensure` inside a live supervisor *is* an unattended spawn path.
3. **Wave 1 ends in a planned reboot** (operator ruling, 2026-08-15), ordered **after** the ccd install
   and its sweep, so the tmux server is recreated by a ccd that places it in `ccrc-tmux-server.scope`
   (§1.7). Rebooting first would recreate the flaw. Run §1.7's six-session pre-flight before it, and
   verify afterwards that `/proc/$(pgrep -x -f 'tmux: server')/cgroup` no longer names a
   `claude-session@*` unit — that check is the whole point of the exercise and is the one thing that
   proves it worked.
4. **The `fix/ccd-swap-jitter` merge gate is a hard blocker for Waves 1 and 3.** Deploying either from a
   main-based ref installs a ccd with no `SWAP_JITTER` — silently reverting the fix for the 2026-08-13
   nine-hour outage — and the sweep then **arms the reverted binary on all 18 supervisors at once**,
   converting a hazard currently dormant on 15 into one armed on 18. Merge at the branch **tip**
   (`baf8e5b`), not `5bdc6dd`; gate on `git show <ref>:ccd/ccd | grep -c SWAP_JITTER` being non-zero.

Within Wave 1 the ccd half (§1.1–1.3) is safe alone — it strictly reduces orphaning — and the server half
(§1.4–1.6) is inert until it sees a `spawnstate` field, which absence-permits handles.

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
- Settling the consumed-uuid question (§1.1) by experiment; the fix is correct under every reading.
  *(The NBSP question is no longer a non-goal — it was **settled read-only, in-tree**: `send.test.ts:87`'s
  `LIVE_CU_FRAMES` is a verbatim `capture-pane -e` of a real **typed** three-line draft whose box row is
  `'\x1b[39m❯\xa0AAA first line'` — NBSP followed directly by text — and the live empty box measures
  `❯` + U+00A0 by `od -c`. Only the test **double** at `send.test.ts:146` says otherwise, contradicting
  the capture sixty lines above it; §4.6 corrects the double in the same wave and stops hedging.)*

---

# Part II — grounding

Part I is the design. Part II is what the design is measured against: a six-lens research pass run
read-only against this repo and the live fleet host on 2026-08-14 18:33–19:05 UTC, with the three most
consequential lenses independently crosschecked. **All three crosschecks overturned their own lens, every
one of them in the dangerous direction** (an undercount) — so where Part II contradicts a lens, the
crosscheck won and the corrected figure is what appears here.

The design in Part I has been corrected against these findings; the audit trail at the end of Part II
records every correction and is kept rather than deleted, because the pattern of what a design gets wrong
is worth more to the next spec than a clean document is.

## Live fleet, verified 2026-08-14

Measured first-hand, read-only, on the fleet host (`openclaw`, `198.51.100.7`), 18:33–19:05 UTC. The repo is at `21fef2a`, `ccd/ccd` sha256 `44de6cd4…`, 7523 lines. The box runs a **different** ccd — 7544 lines, sha256 `d71024dc…`, mtime 2026-08-14 07:02:45 — so no repo line number below is taken from the installed file, and where I read the installed file I say so.

### F8 is a one-off, not a standing condition

**Exactly one of 24 registered ids is missing `.started`: `ccrc-pwa-swift-harbor`.** Every other row has it. `started` is only ever written, never removed (four writers in the repo ccd: `ccd:1257` `cmd_ws_add`, `:2353` `cmd_ws_restore`, `:7208` `cmd_start`, `:7217` `cmd_ensure` — verified by `grep -n '_spawn "' ccd/ccd`), so absence is unambiguous. There is no partially-registered row either: every session-shaped prefix in `~/.cc-sessions` has a `.uuid`.

So the answer to the highest-value question is: **the F8 residue class has one member, and this build's detection surface should be sized for a rarity, not a population.** That does not weaken the prevention case — one orphan cost two days of a live pane doing nothing — but it does mean §1.6's chip and any `ccd doctor` census will spend almost all of their time reporting nothing.

### Four divergence classes, of which the spec names one

| Class | Count | Members |
|---|---|---|
| **F8 proper** — registered, alive, no `started` | **1** | `ccrc-pwa-swift-harbor` |
| **Alive, never supervised** — no unit loaded at all | **3** | `swift-harbor`, `custom-tools-brisk-ridge`, `expoAI-assistant-warm-mesa` |
| **Running but not boot-persistent** — unit `active/running`, no `default.target.wants` symlink | **3** | `ccrc-pwa-calm-mesa`, `data-internal-plain-harbor`, `data-internal-still-prairie` |
| **Registered, `started=1`, no pane** | **3** | `ccrc-pwa-brisk-harbor`, `expoAI-assistant-clear-cove`, `expoAI-assistant-swift-delta` |

Totals: 24 registry rows, 21 tmux sessions, **18** active units, **15** enabled symlinks. `systemctl --user list-units 'claude-session@*' --all` returns exactly 18 rows; the six ids absent from that list have no unit loaded in the manager, so `try-restart 'claude-session@*'` cannot touch them and `Restart=always` cannot resurrect them. (Note: `systemctl show` on an uninstantiated template *does* report `LoadState=loaded`, which is why a naive check misreads this — use `list-units`.)

The fourth class matters most for Wave 1's design. C1 argues F8 cannot leave "a fully-registered workspace with no session" because the pane survives — correct for F8, and the class exists anyway from some other cause. **Adoption is the wrong repair for it:** those three already have `started`; what they lack is a process. Detection must separate *unclaimed pane* from *claimed row with no pane*, and the two repairs are opposite.

### The specimen, re-measured

Ten registry rows, `.started` absent, `.hold` absent, no unit, live pane (pid 1155964, `ps` elapsed 2d 00:27, started Wed Aug 12 18:10:02), zero transcript, `$0.0000`, wrapper `claude-dev0`. But three details change how it should be described:

1. **Only eight of the ten are frozen at spawn** (all mtime `2026-08-12 18:10:03.286368465`). `.prphase` and `.prcheckedat` are sweep-written and rewrite themselves every few minutes — I watched the mtime move 18:33:14 → 18:37:14 → 18:57:15. "Ten frozen rows" is not a usable detection signature.
2. **The splash is still painted.** Not "idle at an empty prompt" — never advanced past first paint. `tmux capture-pane` shows `Claude Code v2.1.228` / `Fable 5 with xhigh effort · Claude API` / `~/worktrees/ccrc-pwa/swift-harbor` / `⚠ 2 MCP servers need authentication · run /mcp` after two days.
3. **The statusline is missing three segments every healthy session carries.** swift-harbor: `👤 lab·dev0 │ 🤖 Fable 5 · xhigh │ ⎇ ws/swift-harbor │ 🎯 ccrc-pwa │ 💲 $0.0000`. Sibling `claude-ccrc-pwa`: `… │ ▓ ctx ███░░░░░ 35% │ 💲 $307.5516 │ +948 -67 │ ⏳ limits 5h ░░░░░ 1% · 7d ████░ 80%`. No `ctx`, no diff counts, no `limits` — a never-turned session is identifiable from one `capture-pane`, cheaper and earlier than any registry read.

The empty box's marker row is **measured** as `❯` + U+00A0: `od -c` on the captured row gives `342 235 257 302 240`. §4.6's premise about the empty box needs no experiment.

`~/.claude-dev0/projects/-home-you-worktrees-ccrc-pwa-swift-harbor/` does not exist (never took a turn). `~/.claude-dev0/session-env/7f0a923c-f98d-4601-b617-058c2c55fd95` **does**, confirming §1.1's parenthetical first-hand. The full argv from `/proc/1155964/cmdline`:

```
/home/you/.local/bin/claude --remote-control ccrc-pwa-swift-harbor \
  --session-id 7f0a923c-f98d-4601-b617-058c2c55fd95 --dangerously-skip-permissions
```

`--remote-control` is present, which the standing ruling of 2026-08-13 (dispatched workers spawn without it) says it should not be. Wave 1 rewrites this exact argv construction; the plan should state whether the ruling is unimplemented on this path or the spawn predates it.

`ws/swift-harbor`'s reflog is a **single 192-byte line** — `branch: Created from origin/main`, never renamed, never committed. That is a first-class F8 tell: the naming sweep never fired because there was no turn to title from.

### Where the spec's second-hand account differs

**The `prphase` date is wrong, and the framing implies a change that did not happen.** The spec says `sweepPr` stamped `.prphase=no-commits` at 06:59 on 2026-08-14. The inode's **birth is 2026-08-12 18:11:26.771231033 UTC — 83 seconds after the workspace was created** — and the same inode has been rewritten in place ever since (birth 08-12, mtime today; no inode replacement, so `_reg_set` truncates rather than temp+rename). This workspace has been in `this.prStates` since minute two of its life. The conclusion is unaffected — `archiveMerged` reads `this.prStates.get(r.id)` at `watch.ts:1910` and skips at `:1912` on `pr?.phase !== 'merged'`, which `undefined` fails identically — but "It is also no longer invisible in one respect" implies a recent change and should be struck.

**"No `.hold`" understates it: there are zero holds fleet-wide,** across all 24 rows. No program currently claims any workspace. Absence of a hold on swift-harbor is not discriminating, and every "held" branch in this build is currently unexercised in production.

**`claude-dev0` is right, but the operator never sees that string.** `~/.ccrc/accounts.json` maps it to the label **`lab·dev0`**, which is what the pane prints. Use the label wherever the spec describes what an operator will recognise. Separately, **the id prefix no longer implies the wrapper**: `claude2-expoAI-assistant` and `claude2-OpenClawHetzner` run on `claude`; `claude-corp-custom-tools` runs on `claude-dev0`. Any code or prose inferring an account from a session id is wrong on 3 of 24 rows today.

### Registry `.branch` is stale — but less dangerously than one lens reported

Comparing each workspace row's `.branch` against `git -C <workdir> symbolic-ref --short HEAD`, **8 of 14 diverge**. That figure is correct, and it is the one the research reported. But **six of the eight are archived rows**, and only **two of the six live workspace rows** are stale:

| ID | registry `.branch` | actual HEAD | state |
|---|---|---|---|
| `custom-tools-calm-river` | `ws/calm-river` | **`main`** | live |
| `data-internal-quiet-summit` | `ws/review-data-room-sources-followup-spec` | `feat/cube-per-service-authorisation` | live |
| `ccrc-pwa-calm-mesa` | `ws/fix-workspace-cleanup-issue` | `fix/roster-half-delivery` | archived |
| `custom-tools-brisk-ridge` | `ws/remove-git-dependency-from-plugin` | `fix/dist-publisher-hardening` | archived |
| `data-internal-plain-harbor` | `ws/plain-harbor` | `feat/claude-usage-dashboard-asks` | archived |
| `data-internal-still-prairie` | `ws/still-prairie` | `ws/salary-per-unit` | archived |
| `expoAI-assistant-swift-delta` | `ws/fix-guardrail-content-filtering-in` | `fix/kb-prefetch-degenerate-chunks` | archived |
| `expoAI-assistant-warm-mesa` | `ws/evaluate-lightpanda-as-playwright` | **`main`** | archived |

The done-fingerprint only ever runs against a live claimed workspace, so the live exposure is 2 rows, not 8 — and one of those two reads `main` on disk. That is still a real hazard for `handoffCommit === branchTip`, but it is a two-row hazard, not a third-of-the-fleet hazard, and the spec should say so at the honest size. Which source the fingerprint resolves the branch from I did not trace (see *Still ungrounded*).

### Eight orphan worktrees, not seven

Worktrees under `~/worktrees/` with no registry row pointing at them: `ccrc-pwa/robust-mail` (`fix/robust-mail-delivery`), `claude-skills/plugin-dist`, `custom-tools-alertwire`, `data-internal/bright-ledger`, `data-internal/dated-grain`, **`data-internal/host-alias`**, `data-internal/session-identity`, `expoAI-assistant/egress-cost`. The research missed `host-alias`. Note `custom-tools-alertwire` sits **flat** at `~/worktrees/`, not nested under a project dir — a detector globbing `~/worktrees/*/*/` misses it. There are no tmux sessions without a registry row; all 21 are `cc-<id>` for a registered id.

### The naming-sweep timings are exact

From `.git/logs/refs/heads/`, creation entry to `Branch: renamed`: `brisk-harbor` **82 s**, `calm-mesa` **31 s**, `quiet-mesa` **28 s**. C9's "28–82 s" is confirmed to the second. `calm-mesa` was renamed *twice* — to `ws/fix-workspace-cleanup-issue` on 08-10, and its worktree now sits on `fix/roster-half-delivery` — so a workspace's branch is not stable even after the sweep, which is the point §3.1 needs to make.

### One more divergence the spec does not track

`GET http://203.0.113.7:7788/health` reports `{"sha":"90523c4b…","ref":"main","builtAt":"2026-08-13T20:44:40Z"}`. `90523c4` is two commits behind `main` (`21fef2a`). So **all three artifacts are out of step with `main` in different directions**: the fleet ccd runs an unmerged branch's body, the fleet `build.json` says `c8fd87f` @ 2026-08-12, and the server says `90523c4` @ 2026-08-13. Wave 1's deploy is the first thing that will reconcile them, and the pre-flight census should record all three.

---

## What shipping ccd does to a live fleet

### The install is a rename(2), and production proves it

`install_atomic` (`deploy/deploy.sh:50-58`) is `scp` to `$dest.incoming-$TS`, `chmod`, then `mv -f` — same directory, so `rename(2)`: the directory entry is repointed and the old inode survives while any process holds it open.

Measured right now: of 18 running `ccd supervise` processes, **15 hold `/home/you/.local/bin/ccd (deleted)` on fd 255** (inode `6943298`, 461245 bytes) and 3 hold the current inode `6924051` (462995 bytes). The deleted inode's sha256, read back out of `/proc/<pid>/fd/255`, is `44de6cd4…` — **byte-identical to `ccd/ccd` at repo `main`**. Fifteen live bash processes are executing an inode that no longer has a name, safely.

The crosscheck sharpened this usefully: `/proc/<pid>/fdinfo/255` shows `pos` == file size for every supervisor sampled. Bash has already read ccd to EOF before the loop starts, because the dispatcher is a single `if…fi` compound near the end of the file that cannot be parsed without reading through EOF. So a running supervisor is not merely "not re-reading" — it has zero bytes left to read. That also relocates the failure mode `deploy.sh:37-49` records: the "correct result then exit 2 on a syntax error" class hits **short-lived verbs** (`ccd swap`, `ccd caps`, the agent's exec path), whose final read at top level would land in the tail of a larger in-place-overwritten file. `cmd_supervise` ends in `exit 1` and never issues that read.

### Four re-exec triggers, and natural turnover is measured in days

`cmd_supervise` (`ccd:7221-7227`) is `cmd_ensure "$id"` then a `while _alive` loop of `_sync_uuid` / `_auto_swap_check` / `_auto_compact_check` / `sleep 5`, then `exit 1`. Nothing re-reads the script, and the roster is `source`d once at top level. There is no mtime check and no self-re-exec anywhere in ccd; `daemon-reload` does not restart running units.

It re-execs only on: (1) the deploy's own sweep (`deploy.sh:388-392`); (2) a swap of that session (`cmd_swap` stops at `ccd:7275`, starts at `:7310`); (3) session death (`exit 1` + `Restart=always`/`RestartSec=3`); (4) reboot — and only the 15 enabled units return from that.

Measured turnover: the on-disk ccd landed 2026-08-14 07:02:45; **3 of 18** supervisors have picked it up in the ~12 h since (started 13:22:30, 18:40:49, 18:43:35 — all three via swaps). Eleven have been on the same inode since 2026-08-12 20:04:41. **Skipping the sweep leaves Wave 1's spawn invariant false on most of the fleet for days.**

One genuinely mixed-version path: `_dispatch_swap` runs `systemd-run … exec '$HOME/.local/bin/ccd' swap` — a *path*, resolved fresh. An old supervisor's swap **decision** uses old in-memory logic while the swap it dispatches executes **new** code.

### The deploy restarts supervisors, not sessions, and it verifies

`SWEEP_CMD` (`deploy/deploy.sh:388-392`) runs `try-restart "claude-session@*"` then `verify-service.sh` per active unit, serially, aborting on the first failure. `verify-service.sh:60-61` sets `CCRC_VERIFY_SETTLE=3` and `CCRC_VERIFY_WINDOW=5`, so **8 s per unit × 18 = ~2.4 minutes** of verification on top of the restarts.

Sessions survive: `KillMode=process` (`ccd/claude-session@.service:14`) plus `cmd_ensure`'s `_alive` early return (`ccd:7212-7219`) means the restarted supervisor attaches rather than respawns, and fires no SessionStart hooks. Evidence: tmux session `cc-claude-corp-orchard-api` was created 2026-08-09 19:28:04 and its supervisor's `ExecMainStartTimestamp` is 2026-08-12 20:04:41. Sharper still — the **tmux server itself** (pid 1569, started 2026-08-05 22:52:29, 12 s after boot) lives in `claude-session@claude-ccrc-pwa.service`'s cgroup and survived that unit's restart on 2026-08-14 13:22:30.

That last fact is the least-defended thing on the box. All 21 sessions are children of pid 1569, and 1569 sits in one session unit's cgroup. `KillMode=process` is the only thing between `try-restart 'claude-session@*'` and the death of the whole fleet's substrate — and **nothing pins it**: `grep -rn KillMode` returns the unit file, a comment in `deploy/deploy.sh:375`, and `agent/test/deploy-verify.test.ts:393`, which only *mentions* it in a comment. Meanwhile `deploy.sh:313` copies that unit file and `:364` `daemon-reload`s in the same run that sweeps, so a bad edit goes live and is exercised against 18 units with no window to notice. By this repo's own doctrine — "a comment is a request; a red suite is a mechanism" — that is not a guard.

### The provenance marker refuses nothing, and the real risk runs the other way

`verifyMarker` (`shared/mark.mjs:132-140`) has exactly one caller in the tree: `server/test/ownership.test.ts:3`. `shared/mark.mjs:1-8` says so itself. `deploy.sh` never inspects it; `install_atomic` overwrites unconditionally. The *write* half `markGenerated` does have a deploy-path caller (`deploy/gen-accounts.mjs`), which is why `~/.ccrc/accounts.sh` verifies clean.

The one enforced consequence is a repo gate: `ownership.test.ts:142-146` pins shebang-on-1 / marker-on-2, and `:148-152` asserts `verifyMarker(ccd) === 'ccrc-unmodified'` with the message "ccd/ccd was edited without re-stamping its provenance marker". **One byte changed in `ccd/ccd` reds this**, including a one-line comment edit — so all four waves hit it, and the re-stamp must ride in the same commit or every intermediate commit on the branch has a red suite.

Verdicts measured today: `ccd/ccd` @ `main` → `ccrc-unmodified`; `~/.local/bin/ccd` → **`ccrc-edited`**. The cause is sharper than "someone forgot". `diff` against `git show fix/ccd-swap-jitter:ccd/ccd` yields exactly one changed line — the marker — and the live file is **byte-identical to `5bdc6dd:ccd/ccd`**, that branch's first commit. The branch has a second commit, `baf8e5b` (`chore(ccd): re-stamp the provenance marker after the jitter edit`), which is its tip and has never shipped. So the box does not need a hand-repaired marker; **it needs the branch tip.** And it did not come through `deploy.sh`: the newest `~/ccrc-backups` dir is `20260812-200414`, `build.json` is untouched at 2026-08-12T20:04, and every other shipped artifact still carries the Aug 12 20:04 mtime. Only `ccd` moved. Hand install.

**The gating risk stands: `fix/ccd-swap-jitter` is unmerged** (`git merge-base --is-ancestor` → false; `grep -c SWAP_JITTER` on repo `main`'s ccd → **0**, on the live file → line 53 plus the jittered `_dispatch_swap` body). Deploying Wave 1 from any main-based ref installs a ccd with no jitter — silently reverting the fix for the 2026-08-13 nine-hour thundering-herd outage — and the sweep then **arms the reverted binary on all 18 supervisors at once**, converting a hazard currently dormant on 15 into one armed on 18.

**One correction to the research, which the crosscheck caught and I re-verified:** the claim that the hotfix "has never once executed on this box" is now false. `grep -n dispatch ~/.cc-sessions/swap.log` returns two lines — `2026-08-14 18:40:25 dispatch claude-corp-custom-tools -> claude-corp (in 24s)` and `18:42:16 dispatch data-internal-quiet-summit -> claude-corp (in 79s)` — and both delays are observable downstream in the supervisor start times. The research's census ran seconds before the first of these appeared. The 2026-08-13 herd is still verbatim in the log (six `auto-home` lines across 21:00:03–21:00:05), and jitter is computed inside the **supervisor's own** process, so the 15 supervisors on the old inode still cannot jitter regardless of what is on disk.

### Deploy procedure for Wave 1

Wave 1 changes `_spawn`, `cmd_ensure`'s ordering, adds `spawnstate` and a `ws-add` lock. Those guarantees hold only in processes running the new ccd, and the unattended spawn path lives in an 18-process cohort that turns over ~3 per 12 hours on its own. **The sweep is mandatory.**

**Pre-flight (blocking):**

1. **Merge `fix/ccd-swap-jitter` at its tip `baf8e5b`** (not `5bdc6dd`), or rebase Wave 1 onto it. Gate: `git show <ref>:ccd/ccd | grep -c SWAP_JITTER` must be non-zero. Shipping without it is a silent revert of a live outage fix.
2. Re-stamp `ccd/ccd` after Wave 1's edits (command in `server/test/ownership.test.ts:131-134`) and confirm the gate is green.
3. Record the "before" census, read-only: `for p in $(pgrep -f "ccd supervise"); do stat -L -c %i /proc/$p/fd/255; done | sort | uniq -c`; `systemctl --user list-units 'claude-session@*' --all --plain --no-legend | wc -l`; `tmux list-sessions | wc -l`; `sha256sum ~/.local/bin/ccd`; `curl -s http://203.0.113.7:7788/health`.
4. Pick a quiet moment. Confirm no swap is in flight (`tail ~/.cc-sessions/swap.log` — a swap inside its settle window is the H6 window below). Check the box: the deploy runs `npm ci && npm run build` here and then restarts 18 supervisors. Do not deploy onto a thrashing box.

**Deploy (agent-first, human-run — every command mutates the live fleet):**

5. `CCRC_SSH_KEY=$HOME/.ssh/your-key-b bash deploy/deploy.sh agent you@198.51.100.7`. **The host argument is not optional** — `deploy.sh:8,21` defaults `$BOX` to the *server* box, so a bare `deploy.sh agent` ships fleet artifacts to the wrong machine.
6. Let the sweep run to completion: ~2.4 min of serial verification plus the restarts. A half-swept fleet is the mixed-version state this whole section is about.

**Post-deploy verification (read-only, and required — the built-in gate cannot see any of it):**

7. Distinct inodes across `/proc/<pid>/fd/255` must be **1**, equal to `stat -c %i ~/.local/bin/ccd`. Any `(deleted)` entry is a supervisor the sweep missed.
8. `sha256sum ~/.local/bin/ccd` must equal `git show <ref>:ccd/ccd | sha256sum`. `ccd version` reads `~/.ccrc/build.json` (written by `stamp_build` in the same run) and **never hashes ccd** — it proves a stamp landed, nothing more, which is exactly how today's divergence went unnoticed for 11 hours.
9. `verifyMarker(~/.local/bin/ccd)` must be `ccrc-unmodified` — the first time it will be, and thereafter it is a cheap standing "is this box running unmerged ccd" probe.
10. Unit and session counts must match the pre-flight census, and `tmux list-sessions` creation timestamps must be unchanged.
11. Only then deploy the server lane (`bash deploy/deploy.sh`), whose `/health` sha gate is the documented final check.

**Rollback:** `~/ccrc-backups/<TS>/ccd` is written before the install (`deploy.sh:230`); restoring it means temp+`mv`, never `cp` over the live path, followed by the same sweep — or the 18 supervisors keep running the version being rolled back.

### Mixed-version hazards to state rather than discover

- **H3 — `cmd_ensure` inside a live supervisor IS a spawn path.** `cmd_supervise` calls it, it calls `_spawn` then writes `started`, and `_spawn` has no lock. Until a supervisor restarts, its unattended respawn path keeps the **old** ordering, writes **no** `spawnstate`, and takes **no** lock. A new-ccd `ws-add` holding the new per-project lock and an old-ccd `cmd_ensure` are not mutually excluded; they are strangers.
- **H4 — registry writes are truncate-and-write** (`_reg_set` is `printf '%s' … > "$REG/$1.$2"`). Any new field must be read absence-permitting, because a stale supervisor will never write it.
- **H6 — the sweep's own window.** A supervisor SIGTERM'd mid-`_spawn` dies between `tmux new-session` and `_accept_first_run_prompts`/`_inject_spawn_effort`; the replacement's `cmd_ensure` sees `_alive` true and returns without finishing setup, leaving a session at an unaccepted trust prompt with no `/effort`. That is F8's residue class **reachable from the deploy itself**, and the deploy that ships Wave 1 is the last one that can still create it. The `_spawn_start`/`_spawn_settle` split should make the sweep safe at any moment, and the plan should assert that.
- **H7 — a bounded window even on a clean deploy.** From `install_atomic ccd/ccd` to the sweep, the run does the agent build, `stamp_build`, two installers and the agent restart+verify. Minutes, during which fresh ccd invocations run the **new** ccd while all supervisors run the **old** one. Anything Wave 1 makes mutually exclusive across those callers is not mutually exclusive in that window.

---

## PWA surface

Three of four waves reach the screen. Nothing below adds a colour token, and nothing adds an interactive element to a fleet row: the row's one interactive meta cell needed a 44×24 invisible overlay and 25 lines of CSS to be tappable (`pwa/src/fleet/fleet.css:999-1034`), and that is not worth a status chip. Every new control lives in a sheet.

### Wave 1 — the §1.6 `spawnState` chip

**There is no chip precedence mechanism.** `.sess-meta` (`fleet.css:935-942`) is `display: flex; align-items: center; font-size: var(--text-xs); color: var(--ink-secondary); overflow: clip; overflow-clip-margin: 12px` — **no `flex-wrap`, no `order`**. DOM order is visual order. Eight cells can render, in source order: `.sess-state`, `.sess-unmeasured`, `.sess-held`, `.sess-cleanup-fact` ×0–2, `.sess-tally`, `.sess-subagents` (the one `<button>`), `.sess-warn`, `.sess-acct`. Only `.sess-held` and `.sess-acct` are shrinkable; everything else is `flex: none`. So **adding a cell silently truncates the hold reason first** — and §2.4 lengthens that reason in the same build. The two changes compound and must be planned together.

**Where it goes: position 2, immediately after `.sess-state`, `flex: none`.** It is a claim about whether this row is a working session at all, so it outranks "which fields we could not read" and "who claims it"; ahead of both shrinkable cells, it can never be the thing clipped away.

**The condition must read `started`, not just `spawnState`.** One chip, never two, never on a dead row (the same exemption `critical` and `subagentList` already take):

```
spawnChip =
  dead                                         ? null
: spawnState !== null && spawnState !== 'ready' ? SPAWN_WORD[spawnState]
: started === false                             ? 'unstarted'
: null
```

The `started === false` arm is not optional. **`swift-harbor` — the live specimen this build exists for — has no `spawnstate` at all**, because the field did not exist when it was created. `spawnState: null` correctly renders nothing, and `started` is the only signal that shape ever emits. §1.6 opens by complaining that `SessionRecord.started` is measured every snapshot and thrown away; putting it on `FleetSession` with no reader repeats that defect one ring out.

**This also fixes a false-positive that would otherwise light the whole fleet.** `spawnstate` is a new registry field, so every one of the 18 live sessions revives `spawnState: null` — and "not `ready`" is true of `null`. Writing the rule as "chip on anything not `ready`" ships a warning on every healthy row until each session is respawned. Treat `null` as *not recorded*, explicitly, and pin it with a fixture row that has no `spawnstate` file.

Copy — one lowercase word in the `unreadable` register, sentence in `title`, `data-spawn="<state>"` for tests (the idiom `data-held`/`data-unmeasured` already use):

| state | word | ink | `title` |
|---|---|---|---|
| `blocked` | `blocked` | `--status-dead-text` | a limit, spend or auth banner was up when this session started — swap accounts or open the terminal |
| `login` | `login` | `--status-dead-text` | this session stopped at a login screen — open the terminal and sign in |
| `unconfirmed` | `unconfirmed` | `--ink-tertiary` | ccrc could not confirm the prompt came up inside the spawn budget — a large resume can take longer; Restart session re-checks |
| (`started === false`) | `unstarted` | `--status-dead-text` | no session was ever started in this workspace — Restart session adopts it |

`unconfirmed` takes the quiet `--ink-tertiary` deliberately: a systemd restart of a large session legitimately settles `unconfirmed`, and painting a healthy session dead-red trains the operator to ignore the chip. Both tokens already exist; the contrast gate needs no new measurement.

**Two mechanical obligations, and a pre-existing bug next door.** The new rule must join the selected-row achromatic override at `fleet.css:724-733` **and** the membership list at `pwa/test/fleet-css.test.ts:294-296`, whose comment says it exists "to catch a STRANDED cell when someone adds a new coloured element to `.sess-meta`". I opened both: the group lists `.sess-meta`, `.sess-state`, `.sess-tally`, `.sess-subagents`, `.sess-warn`, `.sess-acct`, `.sess-acct-away`, `.sess-ask`, `.sess-subagent-row` — and **not `.sess-held` or `.sess-unmeasured`**, which both set `--ink-tertiary`. On the desktop selected row that is tertiary ink on `--ink-primary`: roughly 2.7:1 dark / 2.9:1 light against a 4.5 floor, reachable exactly during a program. The gate cannot see it because both rules sit in the auditor's uncovered census. Fix them in the same wave, and give the new rule an `INHERITED_GROUNDS` entry so it is measured rather than joining that census.

**No new control is needed.** `SessionActionsSheet`'s "Restart session" (`api.ensure`) *is* the adoption path §1.1 builds — `cmd_ensure` writes `started` between the two halves and therefore picks `resume`. Add a `.sess-sheet-note` per state in the idiom the `⚠` note already uses; for `blocked`/`login` point at "Swap account" and the terminal. Keep `SPAWN_WORD` private to `SessionLine.tsx` — a third presentational table over one field is the existing convention, and both existing tables carry a comment on why they are separate.

**Also in Wave 1:** `NewSessionSheet` awaits `api.createSession` behind a "Starting…" button with no progress and no cancel. §1.1 raises `enable`/`start` to 300 s from a flat 90 s — today the sheet fails at 90 s; after this it can sit for five minutes. Minimum: after ~20 s the label should say what is happening. And `FleetScreen.tsx:118-125`'s comment ("ccd does not dedupe… guarded today only by React state that does not survive a reload") becomes false in Wave 1 and must be edited with it.

### Wave 2 — the §2.3 `409 run-open` refusal

**If nothing is designed, the operator sees the toast "Archiving failed — run-open".** I verified the whole path: `api.archive(id)` posts **no body** (`pwa/src/lib/api.ts:243`); `apiErrorText` (`:175-186`) is stderr-first, then `API_ERROR_TEXT`, then `err.message`; `API_ERROR_TEXT` has exactly one key, `unsupported` (`:165-167`); a 409 has no `stderr`, so it falls to `err.message`, which `ApiError`'s constructor sets from `body.error`. A bare slug in a toast is the precise defect `API_ERROR_TEXT`'s own docstring was written to close.

**The route also does not know about coordination yet.** `server/src/server.ts:784-798` reads no body, holds no `deps.coord` reference, and runs outside `coordMutex`. Wave 2 must give it a coord read and decide whether a forced archive needs the mutex — a forced archive today can race an in-flight dispatch or close.

**Use the `AbandonSheet` idiom, not a toast.** Three 409 idioms exist in the PWA; this is the second. `AbandonSheet.abandonErrorText` dispatches on status, reads a *second* body field so the sentence is a measurement rather than a guess, and **keeps the sheet open on refusal** — its own header records why `QuickConfirm` cannot host this: `QuickConfirm`'s confirm runs `onConfirm(); onClose();` unconditionally, so it closes on every tap, win or lose.

So: refusal body `409 { error: 'run-open', runs: [{ id, program, wave, waveOf }] }`; a new `ArchiveConflictSheet` modelled line-for-line on `AbandonSheet`, wired into both doors (`PrSheet`'s "Archive now" and `SessionActionsSheet`'s "Archive workspace", replacing their `act()`/`archiveNow` toasts); title *This workspace is claimed*; body naming the run, degrading to *A run is still open on this workspace* if `runs` is absent — never invent an id. Buttons: **Archive anyway** · **Open the run** · **Cancel**. `api.archive` widens to `post(sid(id)+'/archive', opts?.force === true ? { force: true } : undefined)`, leaving the unforced call byte-identical on the wire. Any further refusal renders **inside** the sheet.

Where `{force:true}` explicitly does not live, each with its reason: not a checkbox (a pre-commitment made before the operator has seen the refusal, and the refusal is the whole information); not a long-press (both `SessionActionsSheet` and `SessionLine` record removing exactly that gesture — "a hidden gesture is the wrong home for recovery"); not `QuickConfirm` (it closes on confirm). A second tap in a sheet that survives the refusal is the only shape that satisfies "the operator's own hands stay able to do it; they just have to mean it".

**PrSheet's post-merge note now has three reasons, not two,** and the third needs **zero wire change**: the fleet store already carries the active run list, so filter it by `sessionId` with `isRunClosed` — gated on `runsFrameSeen`, degrading to today's two-reason sentence rather than asserting. **`released: boolean` needs a reader:** `AbandonSheet` currently discards the resolution, so an abandon that does *not* release because a sibling wave is open closes saying nothing. Toast on `released === false`.

**§2.4's longer reason lands in five prose sites**, one of which is the most-clipped cell on the row: `SessionLine`'s `.sess-held`, `SessionActionsSheet`'s hold line and its `RELEASE_CONSEQUENCE`, and two long `PrSheet` sentences that interpolate it verbatim. Also stale: the hold composer's placeholder `program:name wave:2/4` now shows a format the server writes differently — decide whether a **hand** hold (which has no run) gets a `run:` suffix, and say so in the placeholder.

### Wave 3 — naming, and the honest swap label

**§3.1 changes what the whole fleet is called for the life of a claim, and the spec does not mention it.** `pwa/src/fleet/sessionLabel.ts:14-16` is `name ?? branch ?? workspace ?? id`, and its docstring justifies branch-over-slug precisely because "a workspace's branch gets renamed to something descriptive while `workspace` keeps the slug it was born with". Freeze the rename and every claimed worker row reads `ws/<random-slug>` for a whole wave instead of an ai-title. That is the widest-reaching visual change in the build, and the docstring becomes half-false in the same wave. Open question for the operator: should a claimed row fall back to its run's `program`/`wave` for a label? `RunSummary` carries both and the fleet store already has the runs.

**§3.4's honest label has a blocker.** `SwapSheetProps.session` is `Pick<FleetSession, 'id' | 'wrapper' | 'project'>` — **`home` is not in the Pick** — so "moves back to {home} when {home} has room" requires widening it. (The file is `pwa/src/fleet/SwapSheet.tsx`, not `pwa/src/session/`.) Every caller already passes a full `FleetSession`, so the widening is free; it is just easy to miss.

**§3.2's `branch-unmeasurable` needs no PWA copy, and this should be stated positively so nobody adds any.** No client surface reads `MailRejectCode`: `MailSummary` carries no `rejectCode`, `MailStrip` branches only on `state === 'rejected'`, and `ABANDON_COPY` is keyed on run-refusal codes, deliberately not on the mail set.

### Wave 4 — the input box

**§4.1's widening as written ships a button that sends truncated prompts.** This is the sharpest defect the research found and I verified both halves. The gate is `ChatList.tsx:331`:

```
send.code === 'enter-ignored' && send.draft !== undefined && send.draft.trim() !== ''
```

The attachment path's `verify-failed` (`server/src/inject/send.ts:512-521`) returns `...(cleared.state === 'residue' ? { draft: cleared.draft } : {})` — i.e. `draft` is **what a failed `clearBox` left behind**, a fragment of the message, not the message. `submitEnter` cannot catch it: its correspondence gate compares the box's marker row against `expect`, and the residue *is* what the box reads, so it matches, presses Enter, and submits a truncated prompt. Widening on `code` alone would put two conditions a caller handles oppositely onto one field — the overloaded-value-at-a-seam defect the ring rules name outright.

**Fix: one additive field, absence-permits.** `submittable?: boolean`, set by the new ordinary-path `verify-failed` arm and by `enter-ignored`, **not** set by the attachment path (which keeps `draft` for display). Client: `PendingSend` gains it, `failureOf` reads it off the body beside `draft`, `retry`/`resolve` clear it alongside `code`/`draft`, and the gate becomes `(code === 'enter-ignored' || code === 'verify-failed') && send.submittable === true && …`. An older server never sends the flag, so no button — today's behaviour, the safe direction.

Note that `pwa/test/send-it.test.tsx:34-40` is an intentional tripwire for exactly this: its comment says the cases "are kept because they are what fails if the `code` branch is ever widened", and `verify-failed` is in its list.

**Copy.** `SEND_ERROR_TEXT['verify-failed']` is *"The session never showed the text — open the terminal to check."* That is false twice after this build: the text is in the box, and §4.4 makes the refusal fire more often. Replace with a **new** sentence — *"Typed it, but the session never echoed it back."* — and let the button's presence or absence carry the rest. That string is not in the tree and never has been (grepped across every revision touching `api.ts`); `enter-ignored`'s own shipped copy is the neighbouring *"Typed it, but the session didn't take it."*, and it is not moving. Also worth stating rather than discovering: §4.4 raises the rate of red bubbles and `ChatList` has no grouping or cap, so each failed send is a permanent bubble until dismissed.

**§4.2's blank-marker case does not reach `ChatList.tsx:331`.** The widened guard refuses as `draft-present`, and `PendingBubble` suppresses the error line and renders no rescue for `draft-present`. The consumers are the conflict sheet: `Composer.tsx:101` (`c.draft ?? ''`), `:300` (the well) and `:312` ("Append anyway", which builds `${conflict.draft}\n${conflict.text}`). The rule "never send `''`" stands; the cited surface does not. The fix needs three things together: the server sends every row it will replace, the well renders them, and `.draft-copy` says how many.

**§4.5's MailStrip row: the pattern already exists twice.** I read the component — `.mail-strip-abandoned` (rendered on `state === 'rejected'`, text *"undeliverable — act on it directly"*) and `.mail-strip-artifacts` are both `flex-basis: 100%` spans inside the same `<li>`. The blocked line is a third of the same kind: one class, one existing token (`--status-attention-text`, already measured by the gate), **not** a new `<li>`. Place it between `.mail-strip-subject` and `.mail-strip-abandoned`, written as an explicit ternary against the rejected arm so two status lines can never render on one row.

**Correction to the copy.** The spec's *"blocked — the recipient's input box has unsent text"* is written from the sender's viewpoint, but this strip renders mail addressed **to** the session whose screen you are on. The recipient *is* this session, and its Composer is twenty pixels below. Use:

> `blocked · attempt 3 of 6 — this session's input box has unsent text`

Naming the ceiling is what makes §4.5's title ("visible **before** it is lost") true. **The collapsed head must carry the flag too**, or §4.5 is invisible in its default state — `MailStrip` opens closed.

**The widening is additive-safe by construction, and cheap.** I confirmed `MailSummary` (`shared/api.ts:2230-2253`) carries no `attempts`/`lastError` today. Nothing revives it on the client: the session socket casts, the store replaces `mail` wholesale, and `MailStrip` reads six fields by name. Server side it is three lines in one file (`MAIL_ROW_COLUMNS`, `MailRowDb`, `hydrateMail`) with **no migration** — both columns already exist on `mail_deliveries` — and `outstandingMailFor` needs no predicate change, since a `draft-present` back-off leaves the delivery `queued`. Type `lastError` as a raw `string | null` and branch on `=== 'draft-present'`; never a total `Record` lookup, which would be a fresh way for a new server value to break an old client. One consequence to state: `checkMail`'s dedupe is `JSON.stringify(outstanding)`, so carrying `attempts` makes the frame re-emit on every back-off tick — which is what makes the row live. Do not "optimise" it back.

**The sender-side and park signals land in the feed** (`MailScreen`), not the strip, because the strip is recipient-side. Reuse an existing `NotifyEvent['kind']` — `KIND_WORD`/`KIND_GLYPH` are total maps, so a new kind means touching both plus `NOTIFY_KINDS`. Note `MailBadge` counts unseen feed events, so a blocked-mail record now bumps the fleet screen's badge — correct, and worth writing down.

### Cross-cutting

`reviveFleetSession` has **no `optBool`** — only `reqBool`, which on an absent `started` would reject the whole cached snapshot. Wave 1 needs a new helper and a documented degrade. And `stores/fleet.ts`'s `asFleetMsg` validates frames, not members: a live `fleet` frame is cast, never revived, so `SessionLine` must read `spawnState`/`started` defensively for a row from an older server — the same reason `unmeasuredFields` exists.

---

## Test blast radius, by wave

Verdicts are read from assertions I opened, not from execution (read-only ground rules). Classes: **pin** = update it, the change is intended; **policy** = the test asserts the opposite in prose as well as code, so rewriting it is a decision; **regression** = if this reds, something is wrong; **compile** = invisible to `npm run test`; **vacuum** = stays green and stops testing the new thing.

### Two gates every wave hits

**Gate 1 — the provenance marker, on every commit that touches `ccd/ccd`.** `ownership.test.ts:148-152`. One byte reds it, including a comment edit. **All four waves** hit it, Wave 2 included (§2.3 edits `cmd_ws_release`'s comment). Put the re-stamp in the wave's definition of done, not a final cleanup task.

**Gate 2 — `_spawn` is stubbed by name in EIGHT places, not four.** This is the largest mechanical hazard in the build, and the research undercounted it in the dangerous direction. `grep -rn "_spawn() *{" server/test agent/test pwa/test` returns:

| File:line | Shape |
|---|---|
| `ccdWsHelpers.ts:50` | `WS_ADD` — `_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };` (13 files hold the token) |
| `ccd-hold.test.ts:67` | no-op |
| `ccd-ws-reap.test.ts:13` | no-op |
| `ccd-archive.test.ts:25` | **recording** — `echo "spawn $1 $2" >> "$HOME/ccd-calls"` |
| `ccd-ws-audit.test.ts:12` | `ARCH`, no-op |
| `ccd-ws-gc.test.ts:1087` | `ARCH`, no-op |
| `ccd-ws-gc.test.ts:1274` | `ARCH`, no-op |
| `ccd-prhistory.test.ts:60` | `ARCH_STUBS`, no-op |

The first four cover the **ws-add** path; the last four shadow the **archive/restore** path and bite iff the split also touches `ccd:2353` (`cmd_ws_restore`), `:7208` (`cmd_start`) or `:7217` (`cmd_ensure`) — three of the four `_spawn` call sites. Once a call site names `_spawn_start`/`_spawn_settle`, its stub shadows a function nobody calls, the real `_spawn_settle` runs `_accept_first_run_prompts`, and `WS_ADD` stubs `tmux` but **not `sleep`** — so the loop's 450 iterations of `sleep 2` run against an empty pane. **The failure mode is a ~900 s hang, not an assertion.** `single-definition.test.ts` has no describe covering this stub, so nothing will tell you the copies exist.

### Wave 1

| Suite | What breaks | Class |
|---|---|---|
| `ccd-archive.test.ts:1149` | `expect(h.calls()).toContain('spawn demo-quiet-basin resume')` — the recording stub stops firing. Fix by recording the two new names. | regression |
| `ccd-login-screen.test.ts:150-179` | **The ordering constraint the spec does not state.** The fixture is a live Bypass-Permissions gate whose pane *also* quotes `"Please run /login"` in restored scrollback, asserting `rc=0` and a `Down`-then-`Enter`. `_pane_hard_blocked` (`ccd:6952-6959`, regex on `:6958`) matches that string — pinned at `ccd-login-screen.test.ts:90-92`. If §1.2's new hard-block branch goes anywhere ahead of the gate branches, this pane returns 4, no keys are sent, and the session is parked one stray Enter from `1. No, exit` — verbatim the regression the test's comment at `:139-149` says the last ordering fix exists to prevent. `_pane_login_screen` is called LAST today, at `ccd:7126`. **The hard-block branch must go beside it.** | regression |
| `lifecycle.test.ts:306-316` | Two whole-object `toEqual`s on `CcdResult`; a required `killed` reds both and nothing else (no test builds a `CcdResult` literal). | pin |
| every `_spawn` stub consumer | Gate 2. | regression |

*(Note on a citation the two lenses disagreed about: one read `:90-92` as a `ccd/ccd` anchor and corrected it to `ccd:6952`. Both are right about different files — `ccd-login-screen.test.ts:86-92` is where the two matches are pinned; `ccd:6952-6959` is the function. Cite both.)*

**Green today, must not stay so (vacuum):** `remote-runner.test.ts`'s `it.each` timeout table is a subset check, so new `start`/`enable` rows red nothing — but the table's own comment states the discipline ("Without this row, deleting or changing the entry cannot fail a single test"). `ccd-workspaces.test.ts:117-119`'s `FIELDS` array wants `spawnstate`; it does **not** red without it, because `_reg_purge` filters on the single-dot suffix rather than a field allowlist (its comment says so: "future-proof against a field this file adds tomorrow"), so the terminal `${FIELDS.length + 2}:FREE` assertion still holds. Add the field so the fixture stays a full entry, and fix the stale anchor at `:225` (`ccd:497-503` → the guard is at `ccd:7142`) while you are there.

**Compile lane.** `ExecResult` is at `server/src/exec.ts:3`; there is **no type called `ExecRes` anywhere** in the tree. The seam the spec omits is `asExecResult` (`server/src/remote/runner.ts:83-90`), which rebuilds the object field-by-field and therefore **discards** anything the agent sends beyond `code`/`stdout`/`stderr` — the L3 "an adapter may not narrow a distinction it received" rule failing in the exact place §1.4 depends on. A third narrowing follows at `lifecycle.ts:14`, where `ccd()` builds `CcdResult` from `ExecResult` and would drop the field one hop later. **Make `ExecResult.killed` optional** — 249 bare `{code, stdout, stderr}` literals across 32 test files make a required field a suite-wide break. Separately, `realRunner` (`exec.ts:6-12`) passes **no `timeout`**, so in `local` mode nothing ever kills ccd, `killed` is structurally always false, and §1.5's adoption path is unreachable there; every test of it must inject a runner.

`FleetSession` gaining `started` + `spawnState` is a compile error until every path computes it (`reviveFleetSession` returns a literal). Runtime suites survive — the `Object.keys` assertions I checked use `arrayContaining` — but **~20 base `FleetSession` factories across 20 pwa test files spell every field**, not six. `pwa/test/seen.test.ts` uses an `as FleetSession` cast and is immune, which makes it the one place a missing field will not announce itself.

**`SPAWN_STATES` gets no protection for free.** `single-definition.test.ts` is hand-written per concept — `ROOTS` at `:30-35`, a literal regex per describe, no generic scanner. Wave 1 must add a describe in the `Build 7 nouns` idiom, or the guard §1.6 leans on does not exist.

### Wave 2

| Suite | What breaks | Class |
|---|---|---|
| `run-routes.test.ts:190`, `:523`, `:733` | The **only three** assertions on `holdReason`'s output: exact ws-hold argv with `program:build4 wave:N/3`. | pin |
| `ownership.test.ts:148` | Gate 1. | pin |

Everything else that mentions `program:… wave:…` is a hand-written fixture — 63 occurrences across 20 files — and stays green. The agent whitelist grants `['ws-hold','--session']` as a **prefix**, and ccd's only constraint is non-whitespace-emptiness plus an arity check, so §2.4's longer format passes end to end unmodified.

**`deps.coord` is optional, and that is load-bearing.** `hold-gate.test.ts` builds every watcher from `testDeps`, which supplies no `coord`; `watch.ts` already treats it as optional. §2.3's rung **must** be `this.deps.coord?.openRunsForSession(...)` — a non-optional call TypeErrors all fourteen `hold-gate` tests plus `pr-sweep`'s archive tests. Class: **regression if written wrong.** Pin the optional path with its own test so a future non-optional call reds one named test instead of fourteen unrelated ones.

`coord-abandon.test.ts` and `run-routes.test.ts` assert `ws-release` *is* run on abandon/final-close; their fixtures carry one open run per session, so §2.2's sibling check finds nothing and they stay green. The two-open-run case has no test in either direction — and it is unreachable from live state (measured: **zero holds fleet-wide**, and all 7 merged workspaces already archived), so it needs a constructed fixture. Budget it explicitly; nobody will trip over this case by accident.

**Prose pinned by a suite:** `readme-holds.test.ts` greps the `### Workspace holds & programs` section. §2.3 changes what the archive gate is, so that section will be rewritten — and the rewrite must keep `ws-rm`, `ws-reap`, `` `held === null` ``, `merged **and unheld**`, `bad-request`, `whitespace-only`. The failure message will point at the README, not at your diff.

### Wave 3 — the two policy reversals

| Suite | What breaks | Class |
|---|---|---|
| `name-sweep.test.ts:528-541` | `it('is indifferent to a hold, and touches no PR lineage')` — seeds a hold and asserts the rename still happens. Comment `:523-527` states the old ruling. | **policy** |
| `ccd-ws-rename.test.ts:300-307` | `it('renames a HELD workspace, and leaves the hold and the prhistory alone')`, preceded by `:291-299`: *"A rename is not a destructive act and has no hold rung"*. §3.1 adds that rung. | **policy** |
| `coord-fingerprint.test.ts:619-631` | Asserts `{ ok: true }` for exactly the record-present / `.branch`-absent case §3.2 makes refuse. | **policy** |
| `coordinator-skill.test.ts:245-249` | Iterates `MAIL_REJECT_CODES` and requires each in `allSkillText`. | pin |
| `mail-routes.test.ts:373-377` | Every declared code must appear as a quoted literal under `server/src/coord` — **RED on any commit that adds the code before the emitter lands.** Sequence them in one task. | pin / sequencing |

`whitelist-subset.test.ts`, `agent/test/whitelist*.test.ts`, `caps.test.ts` and `verb-gate.test.ts` all stay green — §3.4 defers the `prefer` grant, no wave adds a verb, and `start`/`enable`/`ensure`/`ws-add` are already in `UNGATED_BY_DECISION`. `_auto_swap_check`'s hold rung (§3.3) is a **vacuum**: the only suite that drives that function tests the rescue arm, so the affinity-only defer reds nothing and ships untested unless a test is written. Put the rung on the affinity arm only — ahead of the rescue branch it would strand a wedged wave in production.

### Wave 4

| Suite | What breaks | Class |
|---|---|---|
| `pwa/test/send-it.test.tsx:34-40` | Iterates `['dialog-open','verify-failed','not-alive','draft-clear-failed']` asserting no `Send it` button. An intentional tripwire — its comment says so. Firing as designed. | pin |
| `single-definition.test.ts:678-684` | The `ccrc-mail` fence holder list must equal exactly `['server/src/inject/send.ts','shared/api.ts']`. The comment at `:653-659` **invites** the very `inject/send.ts` edit Wave 4 makes; taking the invitation without shortening the array reds it as a mystery failure. | pin |
| `ownership.test.ts:148` | Gate 1. | pin |

**The NBSP question is already settled in-tree** — no keystroke needed. `send.test.ts:87`'s `LIVE_CU_FRAMES` is a verbatim `capture-pane -e` of a real three-line **typed** draft, and its first box row is `'\x1b[39m❯\xa0AAA first line'` — NBSP followed directly by text. The plain-space reading survives only in the test **double** at `:146` (`` `❯${lines[0] === '' ? NBSP : ' ' + lines[0]}` ``), which contradicts the capture sixty lines above it. I also measured the *empty* box on the live orphan: `❯` + U+00A0. So `grep -m1 "^❯ "` can never match a real typed draft's box row on any pane — it can only match a scrollback turn. The fix stays correct; the justification should stop hedging, the non-goal should be struck, and the double should be corrected in the same wave.

**Vacuums to build, not reds to fix:** §4.2's widened guard (every `fakeTmux` fixture puts the marker last with nothing after it, so `continuationRows` returns `[]` and the widened guard changes no existing outcome — the blank-marker-with-content-below case has no fixture at all); §4.2's `clearBox` terminator (no fixture starts with a blank first row); §4.3's `composePrompt` strip (no test composes text with a leading newline — but say in the docstring that a strip on one side makes the `splitClipPaths` round-trip lossy); and the entire conflict sheet, which nothing in `pwa/test` renders.

**Index-sensitive fixtures to re-derive** when §4.4 switches the ordinary echo path from `capture` to `captureAnsi` + `draftOf`: the poll-count comments and the `Array(14).fill(NONMATCH)` budget in `send.test.ts`. Class: regression if the count is wrong.

### Suites listed as candidates that do NOT go red

`node-floor.test.ts` (reads only `engines.node` and `node:sqlite`), `verb-gate.test.ts`, `whitelist-subset.test.ts`, `hold-gate.test.ts` (given the optional-coord call), `registry.test.ts` (its exact-equality assertions are on the result envelope, not the full field set), and `adopt.test.ts` — which is a **name collision only**: it tests `ccd/ccrc-adopt`, the roster bootstrapper, not §1.5's dispatch adoption. Do not schedule work against it.

### The lane that is not a lane

`server/test/typecheck-tests.test.ts` spawns `tsc` for **server/test and agent/test only**. `pwa/test` is typechecked by nothing in `cd pwa && npm run test` — only by `cd pwa && npm run build` (`tsc --noEmit && vite build`, with `"test"` in `pwa/tsconfig.json`'s `include`). **Every `FleetSession` and `MailSummary` widening therefore leaves the PWA suite green and breaks the PWA build.** Any wave touching `shared/api.ts`'s exported interfaces must run the pwa build, not just the pwa suite.

---

## Query load, measured

**The index does not exist.** `runs` carries exactly two indexes (`server/src/coord/schema.ts:87-88`): `runs_by_state ON runs(state)` and `runs_by_program ON runs(program, wave)`. `sessionId` is a plain nullable column with no index, and `runs_by_state` cannot serve the query — `state NOT IN ('done','failed')` is negated set membership, not a seekable constraint. Measured against the exact v1 DDL rebuilt in an in-memory `node:sqlite` database: as shipped the plan is **`SCAN runs`**; with `CREATE INDEX runs_by_session ON runs(sessionId)` it becomes **`SEARCH runs USING INDEX runs_by_session (sessionId=?)`**. Dropping the optional `AND id != ?` arm does not change it, so the excludeRunId parameter is not what defeats the index.

`openRunsForSession` does not exist yet anywhere in the tree — confirmed by grep across `server/`, `shared/` and `pwa/`.

**The real number, and it is not 11.** Measured on the live registry: 24 records, 14 with a workspace, 8 archived, **0 holds**. `sweepNames` narrows before anything expensive — the workspace/archived rung drops no-workspace/archived, the born-name rung `if (r.branch !== born) continue;` drops any row whose branch has moved off its born name (`watch.ts:1273` and `:1275` at the frozen ref; an earlier draft said `:1267`/`:1269`, which are the pre-#50 numbers). Six survive the first; **three survive the born-name rung**. So **N = 3** for `sweepNames`, every 10 s (`NAME_SWEEP_MS`). `archiveMerged` narrows harder: seven records carry `prphase=merged` and **all seven are already archived**, so all seven exit at the workspace/archived rung (`:1931`) before the merged test (`:1932`). **N = 0**, every 30–120 s — and the spec puts the new rung *after* `archiveSafety`, by which point the code is already committed to a cross-box `ccd ws-archive` round trip, so the sqlite query is free by orders of magnitude.

**The live table is five rows.** Read read-only over the tailnet with `curl -s 'http://203.0.113.7:7788/api/runs?closed=1'` (an ungated GET): ids 1–5, all `program:'build4'`, all closed, zero open. That is the project's complete program history. So the table-growth premise is real — `runs` has **no retention and no pruning**, and `store.ts:1306`'s `feed_events` prune is the only `DELETE` in the whole server — but the base is 5, and the extrapolated rate from one program over three days is order 10²/year, not 10⁴.

**Verdict: no cache. Add the index.** Three reasons in ascending order of force.

1. *A cache is slower than the alternative.* "One query returning all claimed sessionIds" is still a full scan, defeated by the same predicate. Benchmarked at 10 000 rows with a hypothetical N=11: unindexed 8.09 ms/tick, one cache query 1.16 ms, **indexed 0.27 ms** — the index beats the cache ~4×. At 100 000 rows: cache 11.67 ms vs indexed 3.28 ms, ~3.6×. (One research report labelled this "30×", which contradicts the numbers printed beside it; do not carry that figure into the plan.)
2. *At the measured N the question is moot.* Three queries every ten seconds against five rows is below the noise floor of the timer.
3. *Decisively: a snapshot at a destructive decision point is the shape this code already fixed once.* `watch.ts:1931-1935` reads verbatim — "The FRESH answer, at the decision point: verdict and hold from one registry read taken now, not from the snapshot above (findings 1/5)". A per-tick cache of open runs is a snapshot consulted at a decision point, for a decision whose whole purpose is to prevent a destructive act. The analogy is not literal — that comment governs *registry* freshness, not coord.db — but the staleness it introduces is the same class of window as F9.

**The synchrony invariant is not threatened, and it is worth being precise about why.** `db.ts:229-241`'s docstring is about *atomicity through non-yielding*: "a whole transaction runs without yielding the event loop, so no route, sweep or socket can interleave inside one. `fn` must therefore never await." `openRunsForSession` is a single read **outside** any transaction. It does not lengthen a transaction and does not introduce an await inside one. What it introduces is a small event-loop stall N times per sweep — a latency question, unobservable at N=3. The invariant would only be threatened by the opposite move: wrapping the query async, which `CoordStore` explicitly rejects.

**One migration hazard the research did not name, and it is now load-bearing.** `schema.ts:149-153` and `:199-201` both justify amending v1 in place on the grounds that "coord.db has shipped to no box yet". That premise **expired** — build4 drove five runs through the coordination routes and the server's copy is live. `db.ts` migrates with `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, so an edit to `MIGRATIONS[0]` would never run against a database already at `user_version 1`. **The index must land as `MIGRATIONS[1]`**, and those two comments must be corrected in the same task.

**Also worth stating rather than implying:** where the twelfth condition goes in `sweepNames` changes the query count. Put it immediately after the born-name check — `if (r.branch !== born) continue;`, `watch.ts:1275` at the frozen ref — written as `if (r.held !== null || coord.openRunsForSession(r.id).length > 0) continue;`. `held` is a free in-memory field that short-circuits the query away for every claimed workspace, and the born-name rung is the cheapest large narrowing in the chain. Do not place it earlier: `:1269` (which an earlier draft named here and in §2.1) is `if (identity === null) continue;`, the degraded-row skip, three rungs above the one meant.

---

## What the coordinator must be told

The nine clauses pinned verbatim at `coordinator-skill.test.ts:68-78` say nothing about spawn state, hold release, branch naming, or mail delivery outcomes. **No wave in this build requires editing a pinned clause.** Every change below is additive text.

Two other assertions in that suite do bind, and are easy to trip: the **destructive-verb census** (`ws-reap`/`ws-rm`/`ws-gc` may appear only as many times as clause 3 names them, counted across SKILL.md plus both references — so no new sentence may mention any of the three, not even to forbid them again), and the **route-completeness scan**, scoped to `server/src/coord/routes.ts`. Wave 2's `409` is on `POST /api/sessions/:id/archive` in `server.ts`, outside that scan — confirm when the route lands.

**Wave 1 — a spawn may be adopted but unconfirmed.** The corpus has zero hits for `spawnState` and `started`, and `wave-lifecycle.md:50` presents `ambiguous-dispatch` as the only outcome of a spawn that did not cleanly succeed. §1.5 changes that: a killed `ws-add` that left exactly one unheld candidate is now adopted, dispatch answers `ok`, and the response carries `spawnState`. The coordinator must be told that an `ok` dispatch is no longer proof the pane is ready — what the values mean, whether the brief it just queued can be trusted to land, and when this is a report-to-operator rather than a proceed. Placement: `wave-lifecycle.md` §2's dispatch table and response shape. Nothing pinned.

**Wave 2 — a final close may not release.** Two sentences become conditionally false, and I read both verbatim. `SKILL.md:216-218`: *"`POST /api/runs/:id/close` with `final:true` releases the hold and lets the ordinary sweep archive the workspace."* `wave-lifecycle.md:337-339`: closing the last wave's run *"closes this run `done`, and **releases** the hold (`ws-release`) instead of re-holding for a next wave."* Under §2.2's final arm, `final:true` releases *only* when no sibling open run names the session — and the protocol at `SKILL.md:207-215` deliberately manufactures exactly that sibling by requiring wave N+1's run be opened before wave N's is closed. Both must read the new `released: boolean` and say what `released:false` means (the program is not done; another run still owns the workspace). Neither string is asserted by any suite — verified by grep across `server/test` and `agent/test`.

**Wave 3 — one table row, and a correction to the spec's premise.** `branch-unmeasurable` joins `MAIL_REJECT_CODES` and widens two `Extract<>` unions, which reds `coordinator-skill.test.ts:245-249`. **The fix is one row in `wave-lifecycle.md`'s refusal table, not an edit to SKILL.md's pinned refusal sentence.** The precedent is exact: `tip-unmeasurable` and `pr-unmeasurable` are members of the same list, are real refusals, and appear only in `wave-lifecycle.md` — never in SKILL.md's harvested sentence. That leaves both the sentence and the `codes.length >= 14` floor untouched.

The premise correction: §3.1 says the freeze makes `wave-lifecycle.md:99-111`'s claim "become true". **That file is not wrong today.** It says `ws-add` creates the workspace on `ws/<slug>` (true) and that the done-fingerprint re-measures `record.branch`, "the live registry's own field" (also true — that field follows a rename). Measured live, 8 of 14 workspaces have branches off their born name and the instruction "commit on this workspace's own branch" stays correct under all of them. The freeze is not repairing a falsehood; it is adding a fact the file has never stated. Say it that way, or a reviewer will look for a lie that is not there.

**Also settle the code's name before minting it.** §3.2's arm is reachable — `IdentityField` is `'uuid'|'wrapper'|'workdir'` only, so `measuredIdentity` stays non-null on a null branch — but the null it refuses on is itself **overloaded**: `branch` is read by plain `field(...)`, which returns null for "absent" and "listed but unreadable" alike, unlike the identity triple, which distinguishes them with `names.includes(...)`. A code named `-unmeasurable` asserts a distinction the record provably cannot make, against this tree's own "no overloaded null at a seam" rule. Either give `branch` the `names.includes` treatment, or choose a name that does not overclaim.

**Wave 4 — the largest gap, and the one with no existing text to amend.** The spec says the corpus has zero hits for `undeliverable|rejected|blocked`. Measured: `undeliverable` **3**, `rejected` **4**, `blocked` **0** — and `MailStrip` already renders *"undeliverable — act on it directly"* for `state === 'rejected'`. Two of the three evidence sentences are wrong, and one would send an implementer to write skill text that already exists.

The real gap is narrower and sharper: every existing passage is **recipient-side** (what becomes of mail addressed to *you*), and there is no sender-side procedure at all. That composes badly with clause 7. The wave brief is queued as a delivery (`rundefs.ts` → `queueDelivery`, `dispatch.ts` → `queueSystemMail`), so a recipient with a dirty input box blocks it with `draft-present` while dispatch still answers `ok` with `briefQueued` — and clause 7 then instructs the coordinator to end its turn and wait for mail that a never-delivered brief will never produce. `dispatch.ts:333-339` spells the mechanism out in its own words: on `enter-ignored` the literal `/clear` is left in the box, the lane hits `draft-present` "immediately and keep hitting it — parking the brief `rejected('undeliverable')` after `MAIL_MAX_ATTEMPTS`, with nothing surfacing WHY."

Wave 4 must give the coordinator: `MailSummary.attempts`/`lastError` on `GET /api/mail`, what `lastError === 'draft-present'` means, what the first back-off and the park notifications each oblige it to do, and the explicit statement that a `briefQueued` dispatch is not a delivered brief.

**A second silent path to the same wait-forever, which nothing has named:** `briefQueued = !resumed || clearedAt !== null`, so on a **resumed** wave with a refused `/clear` the brief is never queued at all. `briefQueued` appears exactly once in the corpus (the response-shape line) with no prose telling a coordinator what a `false` means, and `clearError` — a real field of that response — has **zero** corpus hits and is missing from the documented shape entirely. The skill's own response shape is already stale before Wave 4 touches it.

---

## Residual risk and what this build does not close

**Ruling 1's own text is not implemented by any wave.** "Detect on the next verb, write `started`, enable the unit; the workspace becomes ordinary." But `cmd_start` (`ccd:7202`) and `cmd_ensure` (`ccd:7215`) both return early on `_alive` — and F8's residue *has* a live pane, which is C1's whole point. So no ccd verb in Wave 1 ever reaches `_spawn_start` for an existing orphan. Wave 1 delivers prevention (§1.1), adoption of the workspace *this dispatch* created (§1.5), and a chip (§1.6). **`swift-harbor`-class residue stays unrepaired**, which contradicts the ruling the build says it is built on. If that is acceptable — and with N=1 it may be — say so; do not leave the ruling standing as though the build satisfies it.

**`cmd_enable` has no seam to reorder into.** §1.1 says it moves its `systemctl --user enable --now` from after `cmd_start` to before the settle. But `cmd_enable` calls `cmd_start` as a whole verb and the enable sits outside `cmd_start`'s body entirely. Reordering requires restructuring — a flag, an env, or a third function — which the spec does not design.

**`ws-restore` is a fifth F8-class path with a tighter budget.** `cmd_ws_restore` (`ccd:2353`) is the identical `_spawn` → `_reg_set started 1` → `_ws_supervise` ordering, against an agent budget of **60 s** — five times tighter than the `ws-add` budget whose expiry caused F8. §1.1 converts restore to the split form but the timeout paragraph adds rows only for `start` and `enable`.

**`killed: false` is not "a clean refusal".** `runner.ts:110-112` returns `{code:1, stderr: e.message}` for any transport failure — dropped socket, client-side wait expiry — with no `killed`, and `runner.ts:7-9` documents that collapse. Three facts sit on `code:1`, not two: ccd refused, we killed ccd, and *we do not know because the link failed*. Today's outcome is the safe one, but the prose is the kind a later change trusts. Pin that a `killed:false` from the catch path does not adopt.

**§1.2's two new verdicts collide with the existing one.** `_pane_hard_blocked`'s regex (`ccd:6958`) and `_pane_login_screen`'s both carry `Invalid API key` and `Please run /login`, and `_spawn` keys the operator warning and the effort injection off `prompt_rc == 2`. Which verdict an auth-loss pane should carry is a policy call, and it must be decided and pinned rather than discovered.

**The fourth fleet act is ungated.** `close.ts:210-214` — `state === 'failed' && archive` → `CCD_ARGV.wsArchive`, which its own comment at `:206-209` calls "the ONE explicit `wsArchive` call in the whole coordination lane" — is untouched by Wave 2, takes neither the release nor the re-hold branch, and `ws-archive` has no hold rung in ccd. Closing run A as failed-with-archive while sibling run B is open archives B's workspace **and leaves B's `.hold` file standing over it**. That is F9's harm through a different door, in the exact function §2.2 rewrites.

**Wave 3 depends on Wave 2 and the document never says so.** `openRunsForSession` is introduced in §2.1; §3.1's twelfth condition and §3.2 both consume it. The stated order happens to satisfy the dependency, but a plan that parallelises waves — or lands Wave 3 first because it is "just ccd" — breaks. And Open decision 6's merge gate is written for Wave 1 only: §3.3 edits `_auto_swap_check`, the *caller* of the machinery `fix/ccd-swap-jitter` changed, running on every 5 s supervise tick across 18 processes. **The merge gate belongs to Wave 3 at least as much as Wave 1.**

**Wave 1 is a three-lane deploy described as two.** §1.4 is `agent/src/server.ts` — its own package, its own systemd unit, its own `deploy.sh agent` invocation, and a restart that drops the single authenticated WebSocket the whole PWA runs over. `shared/` compiles into both lanes. The real order is ccd → agent → server, with a link outage in the middle.

**F7 is open, is in Wave 4's surface, and §4.4 makes it worse.** `build4.md` records that echo-verify is flaky on a large multi-line paste and is "NOT addressed by submit-proof; a distinct robustness gap". §4.4 replaces the ordinary path's whole-pane check with the strictly narrower box-scoped one — correct in principle, and it will refuse **more often** on exactly the payload shape already documented as flaky. Each refusal leaves the mangled partial in the box, which `sweepMail` then bounces off as `draft-present` — F14's compounding, which the operator has already had to clear by hand twice. §4.5 makes it visible; nothing in this build reduces it.

**§4.1 widens `ChatList`'s gate against that file's own stated reason.** `ChatList.tsx:318-330` explains why the gate is `enter-ignored`-only: "a button that submits an unproven box is the hazard this whole route is gated against — so the operator gets the sentence and the terminal, not a tap that might send someone else's text." `verify-failed` is by construction the case where the box content was never proven. The `submittable` discriminator answers it, but the spec should engage the argument it is overturning rather than step around it.

**`CLAUDE.md`'s three "Open on `main`" items are untouched** though Waves 2–4 sit on all three: `MailDeliveryState` terminality is incomplete (Wave 4 adds a writer to the mail lane), `FleetIO.readFile`'s `// null = missing` docstring is false (Waves 1–3 read the registry ladder constantly), and "account = wrapper" still has no single type (§3.3 and §3.4 are entirely about accounts).

**Accepted and stated elsewhere:** the thundering-herd surface, the `prefer` grant, the cross-box input-box serialiser, the dormant `pool` registry field, and deleting `swift-harbor`.

---

## Grounding audit trail — corrections found, and where they landed

| Where | What it says now | What it should say |
|---|---|---|
| Live specimen | "`sweepPr` stamped `.prphase=no-commits` onto it at 06:59 on 2026-08-14… no longer invisible in one respect" | The `.prphase` inode's **birth is 2026-08-12 18:11:26 UTC — 83 s after workspace creation**, rewritten in place every sweep. It has been in `prStates` since minute two. Strike the "no longer" framing; the conclusion is unaffected. |
| Live specimen | "ten registry rows" as a static signature | Ten, but only **eight** are frozen at spawn. `.prphase`/`.prcheckedat` mutate every few minutes, so "ten frozen rows" is not a detection signature. |
| Live specimen | "a live tmux pane at an idle prompt" | Never advanced past first paint: the v2.1.228 splash and the MCP warning are still on screen after two days, and the statusline is missing `ctx`, diff counts and `limits`. Those absences detect it in one `capture-pane`. |
| Live specimen | "on the `claude-dev0` lane" | Correct, but the operator sees the label **`lab·dev0`**. Also: the id prefix no longer implies the wrapper (3 of 24 rows). |
| Live specimen | "no `.hold`" | **Zero holds fleet-wide** across all 24 rows. Absence of a hold on swift-harbor is not discriminating. |
| C1 | implies "fully-registered workspace with no session" does not exist | It exists today from another cause — 3 rows are `started=1`, tmux dead, no unit. Adopt-and-enable is the **wrong** repair for them. |
| §1.4 | "`ExecRes` gains `killed?`/`signal?`" | **No type called `ExecRes` exists.** The sites are `ExecResult` (`server/src/exec.ts:3`), `asExecResult` (`server/src/remote/runner.ts:83-90`, which discards unknown fields), and `ccd()` (`lifecycle.ts:14`). Make `ExecResult.killed` **optional**; `CcdResult.killed` may be required. Also note `realRunner` passes no `timeout`, so `killed` is structurally false in `local` mode. |
| §1.5 | "`killed:false` (a clean refusal…)" | `runner.ts:110-112` also produces `killed:false` for a transport failure, and `runner.ts:7-9` documents that collapse. Three meanings on `code:1`, not two. |
| §1.2 | "Both take the `fromswap=0` full-resume branch… 240 s for the agent-reachable path, the existing ~900 s for `fromswap=0` resumes" | **Measured false.** `cmd_swap` writes `lastswap` at `ccd:7308`, two lines before the restart at `:7310`, and `_spawn` sets `fromswap=1` within 300 s of `lastswap` (`ccd:7146-7148`). Swap takes the **fast** branch; a fresh `ws-add` is `fromswap=0`. Implemented literally, `ws-add` gets ~900 s and §1.2's bound evaporates. Give `_spawn_settle` its own bound parameter (default 240 s) and have `cmd_supervise` raise it. |
| §1.3 | lock "spans slug selection through the last registry write (`:1242`)" | The last registry writes are `branch` at `ccd:1243` and `_ws_seed_home` at `:1244` — the two fields a racing second `ws-add` would most visibly corrupt. |
| §1.6 | registry field needs `_reg_purge`'s list extended | `_reg_purge` filters on the single-dot **suffix**, not a field allowlist, and says so ("future-proof against a field this file adds tomorrow"). `spawnstate` is purged automatically; the FIELDS fixture is a vacuum to close, not a red to fix. |
| §1.6 | chip on "anything not `ready`" | `spawnState: null` (every pre-existing row) satisfies that. Treat `null` as *not recorded* and add the `started === false → unstarted` arm, or the chip lights all 18 live sessions. |
| §2.3 | reads as though the archive route knows about coordination | `server/src/server.ts:784-798` reads no body, holds no `deps.coord`, and runs outside `coordMutex`. Wave 2 must add the coord read and decide the mutex question. And the rung in `archiveMerged` **must** be `this.deps.coord?.` — `testDeps` supplies no `coord`. |
| Wave 2 header / Deployment | "server-side only — no ccd change" / "Wave 2 is server-only" | §2.3 already concedes the `cmd_ws_release` comment edit. Wave 2 is **agent-first** and hits the provenance gate like every other wave. Reconcile all three statements. |
| §2.1 | "N synchronous queries per tick… at ~11 rows almost certainly negligible" | N is not the record count: **3** for `sweepNames`, **0** for `archiveMerged`, measured. The live `runs` table is **5 rows**. But the query is a `SCAN` today, and the index must land as `MIGRATIONS[1]` — `schema.ts:149-153`'s "shipped to no box yet" premise has expired. |
| §3.1 | `wave-lifecycle.md:99-111`'s claim "**becomes true**" | That file is not wrong today — it already says the fingerprint re-measures `record.branch`, "the live registry's own field", which follows a rename. The freeze adds a fact the file has never stated; it repairs nothing. |
| §3.2 | "record present, `branch` null → refuse `branch-unmeasurable`" | The arm is reachable, but that null is itself overloaded — `field(...)` cannot distinguish absent from listed-but-unreadable. Either give `branch` the `names.includes` treatment or rename the code. |
| §3.4 | the honest swap label | `SwapSheetProps.session` is `Pick<FleetSession,'id'|'wrapper'|'project'>` — **`home` is not in the Pick**. The file is `pwa/src/fleet/SwapSheet.tsx`. |
| §4.1 | "`ChatList`'s condition widens to `enter-ignored \| verify-failed`" | Widening on `code` alone ships a button that submits **truncated** prompts: the attachment path's `verify-failed` carries `draft` = `clearBox` residue (`send.ts:512-521`), and `submitEnter`'s gate matches the residue and presses Enter. Add an additive `submittable?: boolean`; absence = no button. |
| §4.2 | blank-marker `''` "would silently disarm `ChatList.tsx:331`" | It never reaches that gate — the widened guard refuses as `draft-present`, for which `PendingBubble` renders no rescue. The consumers are the conflict sheet (`Composer.tsx:101`, `:300`, `:312`). Rule stands; surface does not. |
| §4.5 | "The coordinator skill has zero hits for `undeliverable\|rejected\|blocked`" | `undeliverable` **3**, `rejected` **4**, `blocked` **0** — and `MailStrip` already renders "undeliverable — act on it directly". The real gap is that all existing text is **recipient**-side; there is no sender-side procedure. |
| §4.5 | MailStrip copy "the recipient's input box" | The strip renders mail addressed **to** this session. Use `blocked · attempt N of 6 — this session's input box has unsent text`, and add the flag to the collapsed head. |
| §4.5 | `MailSummary` widening as a change of unstated cost | Three lines in one server file, **no migration** (both columns already exist on `mail_deliveries`), no `outstandingMailFor` predicate change, and **no client revivers exist** — the widening is additive-safe by construction. |
| §4.6 / non-goals | typed-draft NBSP "unsettled… needs a keystroke"; "Settling the NBSP question by experiment" listed as a non-goal | Settled in-tree, read-only: `send.test.ts:87`'s verbatim live capture of a **typed** draft is `'\x1b[39m❯\xa0AAA first line'`. Only the test double at `:146` says otherwise. Strike the non-goal; correct the double. |
| C8 | `send.ts:489-497` "states the clearing rule as universal" | That comment is inside the `attachments.length > 0` branch and says "a bare **clip path**" — correctly scoped. The real gap is the opposite: §4.1's "a failed send leaves the text in the box" contradicts the attachment path's blind clear floor, and the spec never says whether that path changes. |
| C9 | `wave-lifecycle.md:99-111` listed as a false shipped claim | Overstated — the rename breaks only the `run.branch` fallback, which is §3.2's own finding. Downgrade from "false" to "silent". |
| Documentation corrections | C1/C2's false sentences located in `runner.ts:54-56` and `build4.md` | They also live verbatim in a **test**: `remote-runner.test.ts:88-96`. Wave 1 edits that file anyway for the timeout rows. |
| Assumptions preamble | "Q1 (which lanes bill credits, **still unanswered**)" | Four other places state it was answered on 2026-08-14. Leftover from the pre-cut draft. |
| Goal / Wave 3 "Closes:" | names four failure modes; Wave 3 cites F10b, F11b, F11c | The waves claim ~ten between them, and Wave 2's "**most of** the sweep-blindness window" is the only partial closure in the document — what remains outside it is never described. F10b/F11b/F11c are defined nowhere; `build4.md` names F6–F14 with no such entries. |
| Testing | eight candidate suites | Four of them red for no wave (`node-floor`, `verb-gate`, `whitelist-subset`, `hold-gate`). Missing and red: `ccd-archive:1149`, `ccd-login-screen:150`, `lifecycle:306-316`, `name-sweep:528`, `ccd-ws-rename:300`, `coord-fingerprint:619`, `run-routes:190/523/733`, `send-it.test.tsx:34`, `mail-routes:373`, and `ownership:148` four times over. Add `mail-routes.test.ts` to the list — it pins `MAIL_REJECT_CODES` in both directions. |
| Minor drift | — | `archiveMerged` is `watch.ts:1900-1969`, not `:1900-1963`. `deps.coord` appears on eight lines of `watch.ts`, not four. `single-definition.test.ts`'s `Build 7 nouns` describe contains a **nested** coord-ring scanner that fires if any wave adds a coord file holding the DB handle. |

---

## Still ungrounded

Everything below could not be settled read-only from this box. Each entry names the exact command and what it blocks.

**1. Whether the ccd suite HANGS (rather than fails) once `_spawn` splits.** I read the eight stubs, the 450-iteration loop and the `tmux` stub, but did not execute. *Settle:* `cd server && timeout 120 ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts` on a branch where `cmd_ws_add` calls `_spawn_start`. **Blocks:** knowing whether Wave 1's first task fails loudly or silently eats a CI run.

**2. Whether §1.2's wall-clock settle bound is testable under the existing harness at all.** `SPAWN_STUB` in `ccd-login-screen.test.ts` defines `sleep() { :; }`, so a bound read from `date +%s` never advances and can never fire. A `SECONDS`-based bound or an injectable clock may be required. *Settle:* write the pin first (TDD red) and run `cd server && ./node_modules/.bin/vitest run test/ccd-login-screen.test.ts -t 'settle'`. **Blocks:** whether §1.2 ships with a mechanism or a comment.

**3. `_accept_first_run_prompts`'s full if/elif chain.** I read the tail (`ccd:7126-7134`) and the two classifiers, but not every branch between `:7075` and `:7126`. *Settle:* `sed -n '7075,7135p' /srv/projects/ccrc-pwa/ccd/ccd`. **Blocks:** confirming that "put the hard-block branch last" has no other collision.

**4. Which source the done-fingerprint resolves the workspace branch from.** This decides whether the two stale live `.branch` rows are a live defect or cosmetic. *Settle:* `grep -rn '\.branch\|branchTip\|handoffCommit' server/src/coord/ server/src/watch.ts`. **Blocks:** sizing the branch-staleness risk, and whether §3.1's freeze needs a reconciliation rung.

**5. Whether `mail-sweep.test.ts` asserts the ABSENCE of push/notify calls on a `draft-present` back-off.** §4.5 adds a notification on the first back-off, which would red such an assertion. *Settle:* `grep -n "notify\|push\|pushOne\|toHaveBeenCalledTimes" server/test/mail-sweep.test.ts`. **Blocks:** knowing whether §4.5's notification is additive or a pin update.

**6. The exact capture-count change when §4.4 switches the ordinary echo read.** Several `send.test.ts` fixtures are index-sensitive (the twelve-pane script, the `Array(14).fill(NONMATCH)` budget). *Settle:* make the change and run `cd server && ./node_modules/.bin/vitest run test/send.test.ts`. **Blocks:** a regression that looks like a flake.

**7. Whether any pwa test asserts an EXACT `FleetSession` key set.** I checked three `Object.keys` sites; there are 28 `FleetSession` annotations across pwa/test. *Settle:* `grep -rn "Object.keys\|toStrictEqual" pwa/test/*.ts pwa/test/*.tsx | grep -i sess`. **Blocks:** the true size of Wave 1's compile break.

**8. Whether any coord fixture creates TWO open runs naming one session.** That would flip §2.2's sibling check and turn a green `ws-release` assertion red. *Settle:* `grep -n "POST /api/runs\|openRun\|app.inject" server/test/coord-abandon.test.ts`. **Blocks:** whether §2.2 is a pure addition or a pin update.

**9. Whether a new `.sess-spawn` rule lands as a contrast FAIL or merely in the uncovered census.** Depends on the exact selector. *Settle, after the rule is written:* `cd pwa && node design/contrast-check.mjs --uncovered | grep sess-spawn`. **Blocks:** whether Wave 1's CSS task needs an `INHERITED_GROUNDS` entry to go green or only to be honest.

**10. The exact contrast figures for `.sess-held`/`.sess-unmeasured` on the selected slab.** My ~2.7:1 / ~2.9:1 are computed by hand from `tokens.css` with the WCAG formula, **not** emitted by the auditor — both rules are in its uncovered census. *Settle:* add an `INHERITED_GROUNDS` entry for `fleet.css .sess-line--active .sess-held` and re-run `node design/contrast-check.mjs`. **Blocks:** whether the adjacent fix is a measured bug or a suspected one.

**11. Whether `try-restart` really leaves tmux sessions alive.** Inferred from `KillMode=process` plus strong historical evidence (a session created 2026-08-09 whose supervisor restarted 2026-08-12; the tmux server itself surviving its own unit's restart today), **not** from an observed restart. *Settle (MUTATING, human-only, one unit):* `systemctl --user restart claude-session@data-internal-still-prairie.service && sleep 10 && tmux has-session -t cc-data-internal-still-prairie && echo SURVIVED`. **Blocks:** signing off the deploy procedure's step 6 as safe rather than believed-safe.

**12. Whether the jittered `_dispatch_swap` behaves correctly under a real herd.** It has now fired twice (18:40:25, 18:42:16), so the code path executes — but never against a simultaneous multi-session rollover. *Settle, in a FIXTURE HOME only, never the live `$HOME`:* drive `_dispatch_swap` under `makeCcdHarness` with `SWAP_JITTER=5` and several ids. **Blocks:** Open decision 5's confidence that the herd surface is closed.

**13. Whether a supervisor SIGTERM'd mid-`_spawn` really leaves a half-initialised session (H6).** Reasoned from `ccd:7153-7173` plus `cmd_ensure`'s `_alive` shortcut, not reproduced. *Settle, in a fixture HOME:* start `ccd supervise <id>` against a fixture registry, SIGTERM during `_accept_first_run_prompts`, restart, and assert the trust prompt is still unaccepted and `/effort` was never injected. **Blocks:** whether the `_spawn_start`/`_spawn_settle` split can be asserted to make the sweep safe at any moment.

**14. Why the three dead-but-registered rows lost their panes.** No unit exists for any of them, so there is no journal. *Settle:* `journalctl --user -S -7d | grep -E 'brisk-harbor|clear-cove|swift-delta'` and `ls -la --time-style=full-iso ~/.cc-sessions/ccrc-pwa-brisk-harbor.*`. **Blocks:** designing the right repair for the fourth divergence class.

**15. Why 3 units are active-but-not-enabled and 3 tmux sessions have no unit.** Deliberate (a manual `ccd start`, which does not supervise) or drift — unknown. *Settle:* `journalctl --user -u 'claude-session@*' --since '2026-08-05' | grep -i enable`. **Blocks:** whether the boot-persistence repair is a bug fix or a policy change.

**16. Whether the splash's "· Claude API" means credit-billed.** `CLAUDE_CODE_OAUTH_TOKEN` is present in the orphan's environ (names only, no values read) and a sibling on the same wrapper shows subscription limit bars — which points at OAuth and makes "Claude API" a render artifact — but that is inference. *Settle:* `tmux capture-pane -t cc-claude-synapsium-platform -p -S - | grep -n 'with .* effort ·'` (a `-S -8000` attempt found the splash already scrolled out of retained history on all three `claude-dev0` siblings). **Blocks:** finalising ruling 4 and the F10 scope cut.

**17. The `ls` / `ws-audit` verb outputs the live-specimen section quotes.** Not re-verified — I did not first confirm those verbs are write-free, and `ws-gc`/`ensure` are forbidden outright. *Settle:* read `cmd_ls` and `cmd_ws_audit` for any `_reg_set` or redirect, then run them. **Blocks:** nothing structural; the quotes are illustrative.

**18. Which process rewrites `.prphase`/`.prcheckedat`.** I watched the mtime advance three times but did not trace the writer. *Settle:* `journalctl --user -u ccrc-agent -S -10m | grep -i prphase`, or `fuser -v ~/.cc-sessions/ccrc-pwa-swift-harbor.prphase` during a sweep. **Blocks:** nothing; noted so the "83 seconds" correction is not over-read as a claim about the writer.

**19. Every ccd line number's applicability to the box.** All ccd anchors above are from the repo at `21fef2a` (sha256 `44de6cd4…`, 7523 lines). The installed file is `d71024dc…`, 7544 lines, and I read it only to compare hashes, count lines and grep for `SWAP_JITTER`. Offsets are not uniform — they run 0 near the top, ~+11 through the middle, ~+21 below `_dispatch_swap`. *Settle before applying any anchor to the box:* `sha256sum ~/.local/bin/ccd` against `git show <ref>:ccd/ccd | sha256sum`, and re-derive offsets with `diff`.
