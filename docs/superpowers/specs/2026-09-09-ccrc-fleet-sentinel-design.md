# ccrc fleet sentinel — design

**Date:** 2026-09-09 · **Status:** approved in review, pre-plan · **Repo:** ccrc-pwa
**Replaces:** `ccd/ccd-cap-scopes` + `deploy/systemd/ccd-cap-scopes.{service,timer}`
**Companion change already merged-in-flight:** PR #72 (slice `MemoryHigh=infinity`)

## 1. Problem

The fleet box (openclaw, 16 vCPU / 30 GiB) has frozen three times in five weeks
with the same signature and three different triggers:

| Date | Trigger | Why nothing caught it |
|---|---|---|
| 2026-08-10 | one `ugrep` at 14.8 GiB | per-scope cap enforcer was silently capping nothing (wrong cgroup path) |
| 2026-08-14 | 19 simultaneous ~1 GiB usage scans | caps are per-scope; the exhaustion was aggregate |
| 2026-09-09 | ~8 GiB of **orphaned** vitest workers | orphans belong to no run; aggregate `MemoryHigh` throttled instead of killing |

Each time: **99 % system time, load 100+, memory PSI `full` ≈ 99 %,
`memory.events oom_kill 0`, nothing in dmesg or the journal.** The guardrails
were present, enabled, exiting 0, and reporting to a journal nobody reads.
Every guard on the box is per-process or per-scope, reports only to
journal/`wall`, and the agent/server have **zero** cgroup or PSI awareness —
the PWA is blind to all of it.

## 2. Goals

1. Detect and remove **ownerless** processes (orphans) before they matter.
2. Detect **runaway** work — CPU spin, memory growth, duration overrun,
   fan-out — and the **aggregate** condition no per-scope rule can see.
3. Respond in tiers so the fleet recovers *now* and a human decides *later*,
   without destroying in-flight work by default.
4. Be **provably alive**: a sentinel that sees nothing must look different
   from one that is blind.
5. Put every guard's verdict in the PWA, in one place.

## 3. Non-goals (separate specs)

- A fleet-wide heavy-job semaphore (positive concurrency control). The
  aggregate-PSI rule is the backstop, not the prevention.
- Fixing the teardown that *creates* orphans (tool-runner / vitest pool
  process-group kill). Partly outside this repo.
- Migrating the root-level `fleet-disk-guard` / `fleet-tmp-reap` units out of
  OpenClawHetzner. The sentinel **reads** disk-guard's status; it does not own it.
- Enabling `systemd-oomd`. Considered and rejected: it kills whole pane scopes
  (a whole session), root-level, invisible to the PWA.
  `ManagedOOMMemoryPressure=auto` is already set, so it is one command later
  if ever wanted as a blunt backstop.

## 4. Principles

1. **Measure cgroups, not PIDs.** Every pane is a `tmux-spawn-<uuid>.scope`
   under `app-claude\x2dsession.slice`. cgroup v2 provides `cpu.stat`,
   `memory.current`, `memory.peak`, `pids.current`, `memory.events`,
   `memory.pressure`, `cpu.pressure` per scope, atomically. `ps` sampling is
   racy and was taking seconds under load on 2026-09-09.
2. **Ownership, not lineage.** An orphan is not a fault; an orphan *nobody
   owns* is a leak. Ownership = a live parent, or an own systemd unit, or a
   PID namespace. Anything meant to outlive its tool call is promoted via
   `systemd-run --user --scope --slice=app-claude-session.slice …`; the
   sentinel never touches a process in a non-pane unit. `code-usage-hook-guard`
   is the exemplar.
3. **PSI is the "is this hurting anyone" metric.** Per scope: who. Per slice:
   is the fleet in danger.
4. **Hot ≠ runaway.** Runaway = hot **and** (no progress ∨ budget exceeded ∨
   neighbours stalling).
5. **Enforcement stays in systemd.** The sentinel declares, asserts and acts
   through `systemctl --user` (set-property / freeze / thaw / stop) and
   `kill(2)`; it does not reimplement the kernel.
6. **Assert enforced values, never unit exit status** (2026-08-10 lesson).
7. **Never fight the kernel, never act twice.** One writer of caps; one
   freeze per tick; back off after a kernel OOM event.

## 5. Architecture

```
ccd-sentinel.timer (30 s) ──▶ node agent/dist/agent/src/sentinel/main.js
                                   │  reads  /sys/fs/cgroup/…/tmux-spawn-*.scope/*
                                   │         /proc/<pid>/{stat,cgroup,cmdline}
                                   │         tmux list-panes (scope ⇄ session id)
                                   │         ~/.cc-sessions/<id>.hookstate.json (progress)
                                   │         /run/fleet-disk-guard.status (disk)
                                   │  writes ~/.ccrc/sentinel/state.json     (inter-tick)
                                   │         ~/.ccrc/sentinel/latest.json    (current verdicts)
                                   │         ~/.ccrc/sentinel/findings.jsonl (append-only)
                                   │         ~/.ccrc/sentinel/heartbeat      (mtime + tick)
                                   │  acts   systemctl --user {set-property,freeze,thaw}
                                   │         kill -TERM / -KILL
                                   ▼
ccrc-agent ── serves latest.json + heartbeat over its existing read surface
           ── whitelisted verbs: sentinel-thaw, sentinel-kill --expect <token>,
                                 sentinel-allow --shape <token>
ccrc server ── polls agent, pushes on new contain/kill findings (existing push path)
PWA ── "Guardrails" panel: status light, findings, one-tap thaw / kill / allowlist
```

**Why a separate process on a timer, not a loop inside the agent:** it must run
when the agent is starved or down (2026-07-28 and 2026-08-14 both starved the
agent). It shares the agent's TypeScript and test harness, nothing else.

**Why TypeScript, not a bash sibling:** the rules carry state across ticks
(slopes, sustained windows), emit structured JSON, and must be unit-tested
against fixture cgroup trees. The bash siblings (`cap-scopes`, `account-health`)
are stateless one-shots; this is not.

## 6. Detection model

### 6.1 Subject

The unit of judgement is the **pane scope**. For each `tmux-spawn-*.scope`
under the session slice the sentinel builds:

```
scope     unit name, cgroup path, session id (via tmux pane pid ⇄ cgroup)
mem       memory.current, memory.peak, memory.max, memory.high, memory.swap.current
cpu       cpu.stat usage_usec (delta vs previous tick)
pids      pids.current, pids.max
psi       memory.pressure {some,full} avg10, cpu.pressure some avg10
events    memory.events {high, max, oom, oom_kill} (delta vs previous tick)
procs[]   pid, ppid, comm, argv[0..3], rss, utime+stime, starttime, shape
leader    the pane's shell/claude pid (from tmux) and whether it is alive
progress  mtime of ~/.cc-sessions/<id>.hookstate.json
```

Slice-level: `memory.current`, `memory.max`, `memory.pressure`, `memory.events`.

### 6.2 The orphan discriminator (verified 2026-09-09)

A process is an **orphan** iff its cgroup is a `tmux-spawn-*.scope` **and**
its PPID is 1 or the user `systemd --user` PID. A legitimate service (e.g.
`ccrc-agent`, whose PPID is also `systemd --user`) lives in its own
`*.service` cgroup and can never satisfy both. PPID alone is **not** a test.

Two orphan shapes exist and both are handled:

- **Dead coordinator in a live pane** (2026-09-09): leader alive, workers
  reparented. → process-level action.
- **Abandoned pane**: leader dead, scope still has tasks. → scope-level
  action (`systemctl --user stop <scope>` takes the whole cgroup, no PID races).

### 6.3 Shapes

A **shape** is a matcher over `comm`/argv. Two classes:

- **Disposable** (may be auto-killed when orphaned or over budget):
  `node (vitest N)` / tinypool workers, `jest-worker`, `esbuild`, `tsc`,
  `chrome --type=gpu-process`. Extendable at runtime via `sentinel-allow`.
- **Expected-hot** (never flagged for spin/overrun): `ccd-graph-sweep`'s
  engine, `restic`, `claude` itself. The list is short and explicit.

Anything not disposable can reach *freeze* but never *kill* automatically.

### 6.4 Progress

A scope has **progress** in a window if its session's `hookstate.json` mtime
moved. Absent hookstate (non-ccd pane) ⇒ treat as *unknown*, which only ever
downgrades a verdict (spin cannot promote to freeze on unknown progress).

## 7. Rules

Thresholds are defaults, each overridable by `CCRC_SENTINEL_<RULE>_<KNOB>` env
in the unit's `Environment=`, following the sibling scripts' convention.

| Rule | Condition | surface | contain | kill |
|---|---|---|---|---|
| **orphan** | §6.2 | always | — | disposable ∧ age ≥ 5 min |
| **abandoned-pane** | leader dead ∧ `pids.current` > 0 for ≥ 2 ticks | always | — | `systemctl --user stop <scope>` |
| **spin** | cpu ≥ 90 % of one core sustained ∧ no progress | ≥ 10 min | ≥ 20 min | — |
| **growth** | `memory.current / memory.max` | ≥ 75 % | ≥ 90 % | (kernel at 100 %) |
| **overrun** | disposable shape alive | ≥ 45 min | — | ≥ 120 min |
| **fan-out** | `pids.current` | ≥ 512 | ≥ 2048 | (`TasksMax` 4096) |
| **aggregate** | slice `memory.pressure full avg10` | ≥ 25 | ≥ 60 on 2 ticks → freeze the largest scope by `memory.current` | ≥ 85 → kill disposable orphans, largest first; if none, freeze largest scope |
| **chrome-gpu** | `chrome --type=gpu-process` with ≥ 30 min CPU time | — | — | always (documented busy-loop, 2026-06-29) |
| **cap-assert** | pane scope with `MemoryMax=infinity` | count | `set-property --runtime MemoryHigh=8G MemoryMax=12G MemorySwapMax=2G TasksMax=4096` | — |
| **disk** | `/run/fleet-disk-guard.status` says WARN/CRIT, or stale > 45 min | always | — | — |

Notes:
- `aggregate` is evaluated **first** each tick; if it acts, no other rule
  acts that tick (one intervention per tick, §8).
- `growth` uses the scope's *own* `memory.max` (12 GiB by cap-assert), so the
  thresholds are 9 GiB / 10.8 GiB per pane.
- `overrun` age is process start time, not orphan time (orphan time is not
  observable); this is why the orphan kill threshold is short (5 min) and the
  overrun kill threshold long (2 h).

## 8. Response ladder

| Tier | Mechanism | Reversible | Who decides |
|---|---|---|---|
| **surface** | finding → `latest.json` → PWA amber | n/a | nobody yet |
| **contain** | `systemctl --user freeze <scope>` (systemd 255 on the box; ≥ 246 required) | yes — `thaw` | human, via PWA |
| **kill** | `kill -TERM` → 10 s → `kill -KILL`; or `systemctl --user stop <scope>` for abandoned panes | no | policy (disposable only) or human |

Rules of engagement:
- **One intervention per tick.** Freeze at most one scope; kill at most one
  process group. The next tick re-evaluates with fresh evidence.
- **No auto-thaw.** A frozen scope stays frozen until a human thaws or kills
  it. The PWA offers *thaw*, *kill*, *allowlist this shape* on every finding.
- **Push on contain/kill only.** Surface findings render; they do not notify.
- **Back off after the kernel.** If a scope's `memory.events oom_kill` moved in
  the last 60 s, the sentinel does not act on that scope this tick.
- Every action is recorded with its full evidence block (§10) *before* it is
  taken, so a sentinel that dies mid-action leaves a trail.

## 9. Precedence and exemptions

- Acts only inside `tmux-spawn-*.scope` under `app-claude\x2dsession.slice`.
  Own-unit processes are exempt by construction.
- The sentinel is the **only** writer of per-scope caps. `deploy.sh` masks
  `ccd-cap-scopes.timer` and `deploy-verify.test.ts` asserts both that the
  mask exists and that the new timer is enabled. Both running is a test failure.
- Never kills a non-disposable shape automatically; never freezes more than
  one scope per tick; never acts on the canary (§11) beyond classifying it.
- `sentinel-kill` over the wire is gated exactly like `ws-reap`: pinned to
  carry `--expect <token>` where the token is the finding id, so an
  unconfirmed kill cannot cross the wire.

## 10. Data model

```jsonc
// one Finding — appended to findings.jsonl; latest.json holds the current set
{
  "id": "f_2026-09-09T17:20:31Z_orphan_662363",
  "tick": 48211, "at": "2026-09-09T17:20:31Z",
  "rule": "orphan",                         // §7
  "verdict": "kill",                        // surface | contain | kill
  "mode_applied": "kill",                   // after rollout-mode downgrade (§13)
  "subject": { "scope": "tmux-spawn-cac0….scope", "session": "ccrc-pwa-brisk-cove",
               "pid": 662363, "shape": "vitest-worker" },
  "evidence": { "ppid": 703683, "rss_mib": 1905, "age_s": 7774,
                "scope_mem_mib": 20949, "slice_psi_full_avg10": 99.0 },
  "action": { "kind": "kill", "signal": "TERM", "ok": true, "at": "…" },
  "canary": false
}
```

`latest.json` = `{ tick, at, mode, heartbeat_ok, canary_ok, slice: {...},
findings: Finding[] }`. `state.json` holds per-scope ring buffers (last 40
ticks of cpu/mem/pids) and last-seen `memory.events` counters.

## 11. Self-proof

1. **Heartbeat.** `~/.ccrc/sentinel/heartbeat` rewritten every tick with
   `{tick, at}`. Agent exposes it; PWA turns the guardrail light **red** if
   stale > 120 s.
2. **Canary.** Once per day (jittered) the sentinel spawns, inside a throwaway
   pane scope it creates via `systemd-run --user --scope --slice=…`, a 50 MiB
   `sleep 600` whose parent exits immediately — a textbook orphan. It must
   appear as an `orphan` finding with `canary: true` within **two ticks**, and
   be *classified only*, never killed. Missing ⇒ `canary_ok: false` ⇒ red.
   The canary proves detection end-to-end (enumeration, cgroup mapping, PPID
   test, shape matching) — precisely the layers that failed silently before.
3. **Assertion.** `cap-assert` reads `memory.max` from the cgroup file, never
   `systemctl show` alone, and never trusts its own previous tick.

## 12. Replacing `ccd-cap-scopes`

- `deploy/systemd/ccd-sentinel.{service,timer}` added; `ccd-cap-scopes.*`
  kept in-tree for one release, **masked** by `deploy.sh`, then deleted.
- `deploy-verify.test.ts` gains: sentinel timer installed + enabled;
  cap-scopes timer masked; never both active.
- `ccd/ccd` comments that name `ccd-cap-scopes` as "the guardrail that
  actually contains a runaway" are updated to name the sentinel.
- The 2026-08-10 / 2026-08-19 history in `ccd-cap-scopes`' header is carried
  into `sentinel/README.md` verbatim; it is the reason §11 exists.

## 13. Rollout

`CCRC_SENTINEL_MODE` ∈ `report` | `contain` | `enforce` (unit `Environment=`).

1. **report** (≥ 48 h): every verdict downgraded to *surface*; `mode_applied`
   records what *would* have happened. Purpose: see false positives before
   anything freezes. Exit criterion: zero would-have-frozen findings on
   non-disposable shapes that a human judges wrong.
2. **contain**: freeze enabled; kill still downgraded to freeze.
3. **enforce**: full ladder.

Each step is one env change + `daemon-reload`; rollback is the same.

## 14. Testing

- **Unit (vitest, `agent/test/sentinel/*.test.ts`):** rules evaluated against
  fixture cgroup trees + fake `/proc` + fake tmux output under a temp root
  (same `tmpHelpers` pattern as `deploy-verify`). One test per row of §7,
  plus: orphan discriminator vs a fake `*.service` cgroup (must not match);
  own-unit exemption; one-intervention-per-tick; OOM back-off; canary
  classified-not-killed; mode downgrades.
- **Deploy:** `deploy-verify` additions from §12.
- **On-box shakedown:** §13 report mode for 48 h, findings reviewed in the PWA.
- **Rule for running vitest on the fleet box:** always inside
  `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -- timeout 300 npx vitest run … --maxWorkers=2`.
  The thing this spec guards against must not be reproduced by its own tests.

## 15. Failure modes of the sentinel itself

| Failure | Consequence | Mitigation |
|---|---|---|
| sentinel crashes every tick | no protection, but **red light** within 120 s | heartbeat; timer `Restart` not needed (oneshot) |
| box thrashing so hard the tick cannot finish | one slow tick; next tick sees larger deltas | `TimeoutStartSec=25s` on the unit so ticks never pile up; `MemoryMax=256M` + `CPUWeight=2000` on the sentinel unit |
| tmux unreachable (scope ⇄ session map fails) | session ids unknown; progress = unknown | verdicts downgrade, never promote, on unknown (§6.4) |
| false positive freeze | one session paused, human notified | no auto-kill of non-disposable; one-tap thaw + allowlist |
| cgroup layout moves again | enumeration returns nothing | canary goes red within a day; enumeration is by unit-name glob, not path |
| `latest.json` half-written | PWA shows stale | write-to-temp + rename |

## 16. Open questions

- Whether `aggregate ≥ 60 → freeze largest scope` should prefer a scope with
  *no progress* over the merely largest. Default: largest; revisit after the
  report-mode data.
- PWA allowlist edits are runtime-only (`~/.ccrc/sentinel/allow.json`) vs
  committed defaults; both, with the file layered over defaults.
