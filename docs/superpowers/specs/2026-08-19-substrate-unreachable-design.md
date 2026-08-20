# `substrate-unreachable` — surviving a tmux the fleet cannot talk to

**Status:** design, awaiting operator review.
**Motivating deviation:** D-B8-12 (`docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md`).
**Decided out of scope by the operator (2026-08-19):** pinning tmux. Unattended upgrades stay on and
`tmux` stays unheld, so the code carries the whole mitigation rather than the host preventing the event.

## The problem, stated as a sequence

`cmd_supervise`'s loop is `while _alive "$id"; do …; done` followed by `exit 1` (`ccd:8509-8517`).
D-B8-12 gave `_alive` an honest three-valued source (`_session_verdict` → `live|gone|unknown`) and
fixed the two destructive callers, but deliberately left `_alive` collapsing `unknown` into "not
alive" for its eleven other callers — including this loop. So today:

1. Ubuntu ships a tmux update. `unattended-upgrades` is enabled and `tmux` is not held (both verified
   on the fleet host, 2026-08-19). The new binary lands on disk; the *running* server keeps the old one.
2. tmux refuses a client whose protocol version differs from the server's. Every new `tmux` invocation
   on the box now fails — including `has-session`.
3. All seventeen supervisors read `unknown`, `_alive` says "not alive", each loop exits, each prints
   `session <id> ended; exiting for systemd restart` and exits 1.
4. `Restart=always` / `RestartSec=3` / `StartLimitBurst=5` / `StartLimitIntervalSec=120`
   (`ccd/claude-session@.service:18-25`) burns the budget in about fifteen seconds. Every unit ends in
   `failed`.
5. Seventeen claude processes are still running, still holding their worktrees, unattached and
   unaddressable. The PWA reads the fleet as dead. It is not.

The fault is recoverable — a tmux restart or a reboot fixes it — but only if an operator understands
what they are looking at, and step 5 actively misinforms them.

## What makes this hard, and why the obvious fix is wrong

The obvious fix is "don't exit the loop when the verdict is `unknown`". That trades a false *dead* for
a false *alive*: the unit stays `active`, the supervisor keeps stamping its heartbeat, and
`_session_state` reports `running` for a session nobody can see. The operator is then misinformed in
the more dangerous direction, because `running` invites no investigation.

So the requirement is not "keep looping". It is **carry the distinction to the surface**, which means a
state word, which means a change that crosses `ccd` → registry → server → `shared/api.ts` → PWA.

The codebase already contains the precedent and names it precisely. `_session_state`'s own header
(`ccd:8~`) says `unmeasurable` is "the ONE row of the table this side cannot reach: ccd reads `$REG`
off local disk, where a read either works or the file is genuinely absent. That state exists only on
the server's side of the seam, where remote `readFile` collapses missing/forbidden/disconnected into
one null and an unreadable registry must never print `orphan`." That is this problem exactly, one seam
over: a measurement that failed must not be reported as the thing it failed to measure. `unmeasurable`
covers the *registry* seam; nothing covers the *tmux* seam.

## Design

### 1. The supervisor stops treating silence as death

`cmd_supervise`'s loop becomes verdict-driven:

- **`live`** — the tick as it is today: `_sync_uuid`, `_auto_swap_check`, `_auto_compact_check`,
  heartbeat every 30s. On the first `live` after a period of `unknown`, remove `$REG/<id>.substrate`.
- **`gone`** — exit 1, exactly as today. This is the only path that ends a supervisor.
- **`unknown`** — do **not** exit. Write `$REG/<id>.substrate` (below), skip all three per-tick helpers
  (each of them shells out to tmux and would fail anyway), keep stamping the heartbeat, and keep
  looping on a longer interval.

The heartbeat keeps its exact current meaning — *a supervisor is watching this row* — which stays true
throughout, and is why it must not be withheld. Withholding it would age the row into `restarting` and
then `orphan` after 120s, which is the false-dead outcome by a slower route.

The restart budget is untouched because nothing exits, which is the point: a fleet-wide substrate fault
must not consume seventeen units' `StartLimitBurst`.

**Backoff.** The `unknown` branch polls at a longer interval than 5s (proposal: 5s → 30s after three
consecutive `unknown` ticks). Seventeen supervisors each spawning a doomed tmux client every 5s during
an outage is a thundering herd against a component that is already unwell.

**No automatic escalation, ever.** After N minutes of `unknown` the supervisor still does nothing but
report. It does not re-spawn, does not `cmd_ensure`, does not kill. A substrate fault is precisely the
condition under which ccd's model of the world is least reliable, and `ws-reap` being human-only by
contract is the same principle. Recovery is a human action; the system's job is to make the situation
legible and to still be there when it is fixed.

### 2. `$REG/<id>.substrate` — the new registry field

Flat file, ground truth, same as every other registry field. Content: `<epoch> <verdict text>`, e.g.

```
1755620112 protocol version mismatch (client 8, server 7)
```

The epoch answers "since when", which is the first thing an operator asks. The verdict text is the
tmux message that produced `unknown`, verbatim and untruncated — the whole reason `_session_verdict`
captures stderr is that the message is the diagnosis, and narrowing it here would repeat the mistake
D-B8-12 removed one layer down.

**`field()`'s `''` collapse is a live hazard for this field** (already on the carried ticket list):
an empty-but-present `.substrate` and an absent one must not read alike, because "the substrate marker
exists but says nothing" is a corrupt-registry signal, not a healthy one. Either fix `field()` first or
have this field's reader bypass it. Do not add the field on top of the collapse.

### 3. The state word

`substrate-unreachable`, added to `SessionLifecycle` in `shared/api.ts:939-940`.

Not a reuse of `unmeasurable`: that word means "the *registry* could not be read", and CLAUDE.md's rule
against a second name for a different thing cuts both ways — reusing one name for two different
failures is the same defect. The two can co-occur and an operator needs to tell them apart, because the
repairs are unrelated.

**Ladder position: first, above `unmeasurable`.** When tmux cannot be reached, `input.alive` is not
false — it is *unknown*, and every rung below consumes `alive` as a boolean. Placing the rung anywhere
lower means some path reads a fabricated `alive`.

`_session_state` (`ccd`) and `sessionLifecycle` (`shared/api.ts:1195-1222`) are driven from **one
fixture** (`server/test/sessionLifecycleFixture.ts`), and their header states that "THE ORDERING IS THE
CONTRACT". The new rung lands in the fixture first, both implementations follow, and the fixture is
what makes them agree. This is a three-language change (bash, TS, and the fixture's own table) of
exactly the kind `single-definition.test.ts` exists to police — verify against it.

### 4. Wire discipline

Additive-only, `FLEET_PROTO` stays 1. An older peer omitting `.substrate` must be tolerated by a single
reader, and `reviveFleetSession` returns a literal, so the new field is a compile error until every
path computes it — which is the mechanism, not a convention. Absence permits: no marker means no
substrate fault, which is correct for every older build.

### 5. The PWA

Two requirements, and the second matters more than the first.

**It must not look like `dead`.** The sessions are alive; the console cannot see them. A distinct
treatment, not a variant of the dead styling.

**Destructive affordances are disabled in this state.** This is the same fail-shut polarity D-B8-12
applied to `ws-archive`, `ws-reap` and `forget`, carried to the surface the operator actually touches.
A row whose state is unknown is not a row to offer a stop, a reap, or a swap on.

**One fault, one banner.** Seventeen rows going `substrate-unreachable` inside the same tick is one
event, not seventeen, and rendering seventeen badges buries the diagnosis. `fleet-host-banner` already
exists (`pwa/test/fleet-host-banner.test.tsx`) and is the right home: when *every* live row reports the
same substrate fault, the banner states it once and names the remedy. Per-row badges remain for the
partial case, which is a genuinely different situation.

### 6. Detection, since the host mitigation was declined

A protocol skew is detectable *before* it is fatal, and cheaply: `tmux -V` reports the client's version;
`tmux display-message -p '#{version}'` asks the running **server** for its own. Disagreement means a new
binary is on disk and the running server predates it — the loaded gun, seen before it fires.

- **In `ccrc-doctor`** (`ccd/ccrc-doctor-checks:373-375` currently checks only that the binary exists) —
  a skew check for manual use. Necessary but not sufficient: nothing on the box runs `ccrc-doctor`, so
  this alone detects nothing unattended.
- **In the `unknown` branch of the supervise loop** — when a supervisor first writes `.substrate`, it
  records the skew comparison alongside the verdict text. This is the moment the answer is wanted, and
  it costs one extra tmux call per fault, not per tick.

A version *floor* is the wrong instrument here, as the adversarial pass established: the dangerous
direction is client/server skew, which is instant and total, not slow parser drift.

## What this does not do

It does not prevent the outage. With tmux unheld and unattended upgrades on, the event will happen; this
design makes the fleet survive it, report it accurately, and still be there afterwards. If the calculus
on pinning ever changes, `apt-mark hold tmux` remains a one-line reduction in how often this path is
exercised — but it is not a substitute for the path existing, because a manual `apt upgrade`, a
reinstall, or a package fix would reach the same state.

It does not touch the eleven other `_alive` callers. Each would need its own argument about what
`unknown` should mean there, and D-B8-12's containment — change only the seams where the collapse was
destructive — is worth preserving until a specific caller earns the change.

## Open questions for review

1. **Backoff shape.** 5s → 30s after three `unknown` ticks is a proposal, not a measurement. Is there a
   reason to prefer a bound tied to the 120s freshness window instead?
2. **Should `.substrate` be per-session at all?** The fault is almost always fleet-wide. A single
   `$REG/.substrate` box-level marker would be one file instead of seventeen and would make the
   "one fault, one banner" case trivial — at the cost of not expressing a *partial* fault, which is
   rarer but real (a single wedged pane). Per-session is proposed because it degrades correctly to the
   partial case; the box-level file can be derived.
3. **Does `unclaimed`'s rung interact?** F8's specimen was alive AND supervised AND unclaimed. Under a
   substrate fault, `started` is still readable off disk while `alive` is not — worth walking the
   fixture table explicitly rather than reasoning about it.
