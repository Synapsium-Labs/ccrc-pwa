# `substrate-unreachable` — surviving a tmux the fleet cannot talk to

**Status:** design **v2**, awaiting operator review.
**Motivating deviations:** D-308 (was D-B8-12), D-309 (was D-B8-13) (`docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md`).
**Decided out of scope by the operator (2026-08-19):** pinning tmux. Unattended upgrades stay on and
`tmux` stays unheld, so the code carries the whole mitigation rather than the host preventing the event.

**What changed since v1:** all three of v1's open questions were answered — two of them *against* v1's
own proposals — by an adversarial review plus live measurement (2026-08-19/20), and the review's
dominant finding was not in the spec at all: the server's `Tmux.hasSession` carried the identical
collapse. That half has since **shipped** (D-309, PR #66): `classifyHasSession` →
`live|gone|unknown` with the message table in a shared fixture driving both the bash and TS twins,
`archiveSafety` failing shut, the mail sweep distinguishing gone from unknown. This spec is the
remaining half: the supervise loop, the registry marker, the wire axis, and the PWA.

## The problem, stated as a sequence

`cmd_supervise`'s loop is `while _alive "$id"; do …; done` followed by `exit 1` (`ccd:8613-8622`).
D-308 gave `_alive` an honest three-valued source (`_session_verdict`, `ccd:328` → `live|gone|unknown`)
and fixed the destructive callers, but deliberately left `_alive` collapsing `unknown` into "not
alive" for its other callers — including this loop. So today:

1. Ubuntu ships a tmux update. `unattended-upgrades` is enabled and `tmux` is not held (both verified
   on the fleet host, 2026-08-19). The new binary lands on disk; the *running* server keeps the old one.
2. tmux refuses a client whose protocol version differs from the server's. Every new `tmux` invocation
   on the box now fails — including `has-session`.
3. All seventeen supervisors read `unknown`, `_alive` says "not alive", each loop exits, each prints
   `session <id> ended; exiting for systemd restart` and exits 1.
4. `Restart=always` / `RestartSec=3` / `StartLimitBurst=5` / `StartLimitIntervalSec=120`
   (`ccd/claude-session@.service`) burns the budget in about fifteen seconds. Every unit ends in
   `failed`.
5. Seventeen claude processes are still running, still holding their worktrees, unattached and
   unaddressable. The PWA reads the fleet as dead. It is not.

The fault is recoverable — a tmux restart or a reboot fixes it — but only if an operator understands
what they are looking at, and step 5 actively misinforms them.

There is a second, slower shape of the same fault, and it is the one this box has already produced:
a *wedged* server rather than a refusing one. `ccd-cap-scopes`' own header records 2026-08-10 —
reclaim throttling, load 57, every session stalled, no OOM kill. **Measured 2026-08-19:** against a
healthy server `has-session` answers in ~8 ms; against a SIGSTOPped server the client **blocks
indefinitely** (killed externally at 8 s). A wedge does not even return `unknown` — it never returns.
Any design that only classifies error messages has not addressed it.

## What makes this hard, and why the obvious fix is wrong

The obvious fix is "don't exit the loop when the verdict is `unknown`". That trades a false *dead* for
a false *alive*: the unit stays `active`, the supervisor keeps stamping its heartbeat, and
`_session_state` reports `running` for a session nobody can see. The operator is then misinformed in
the more dangerous direction, because `running` invites no investigation.

So the requirement is not "keep looping". It is **carry the distinction to the surface** — but *not*,
as v1 proposed, as a lifecycle state (§3 below reverses that).

## Design

### 1. The supervisor stops treating silence as death — and its probe stops being unbounded

`cmd_supervise`'s loop becomes verdict-driven:

- **`live`** — the tick as it is today: `_sync_uuid`, `_auto_swap_check`, `_auto_compact_check`,
  heartbeat every 30 s. On the first `live` after a period of `unknown`, remove `$REG/<id>.substrate`.
- **`gone`** — exit 1, exactly as today. This is the only path that ends a supervisor.
- **`unknown`** — do **not** exit. Write `$REG/<id>.substrate` (§2), skip all three per-tick helpers
  (each shells out to tmux and would fail anyway), keep the heartbeat fresh, and keep looping on the
  backed-off cadence below.

**The timeout and the backoff are a matched pair, not alternatives** (v1's open question 1, answered
by measurement). Without a deadline on the probe, the wedge shape blocks each supervisor *once,
forever* — no verdict, no marker, no loop iteration, a hang wearing an `active` unit. So the probe
must carry a deadline. But the deadline is precisely what *creates* the thundering herd: seventeen
supervisors each spawning a doomed client per tick against a component that is already unwell. Adding
the timeout makes the backoff mandatory; adopting the backoff without the timeout leaves the wedge
unhandled. They ship together or the design does not work.

- **Deadline:** 8 s on the `has-session` probe (measured healthy answer: 8 ms; three orders of
  magnitude of headroom). A probe killed by its deadline is verdict `unknown` with a **synthesized**
  reason — `tmux did not answer within 8s` — because `timeout` kills the child before tmux prints
  anything, and an empty marker reason is the one shape a maintainer can do nothing with (the same
  rule D-309's classifier already enforces server-side: `detail` is never empty).
- **Backoff:** on consecutive `unknown`, the tick interval rises 5 s → 30 s (after three consecutive
  `unknown` ticks) and holds at 30 s until the first `live`/`gone`.
- **The heartbeat arithmetic is part of the contract, not an implementation detail.** The loop stamps
  `supervised` from `beat`, a counter of *assumed* seconds (`beat=$((beat + 5))` at `ccd:8616` —
  nothing reads a clock), against `SUPERVISED_FRESH_MS = 120_000` (`shared/api.ts:1117`; bash twin
  literal `120`). v1's backoff proposal, implemented naively — sleep 30 but still `beat += 5` — stamps
  every **180 real seconds** against a **120-second window**: every row on the box cycles into
  `restarting`/`orphan` for ~60 s of every 180 s, which is the false-dead outcome by a slower route,
  seventeen times over. The rule: **on an `unknown` tick, stamp the heartbeat every tick.** One extra
  registry write per 30 s per session during an outage is nothing; a fabricated staleness cascade is
  the failure this design exists to prevent. The heartbeat keeps its exact meaning — *a supervisor is
  watching this row* — which stays true throughout.
- **The test trap, named so the implementation does not walk into it:** `timeout` execs its argument
  as an external binary. The ccd suites stub tmux as a *bash function* in dozens of files
  (`case "$1" in has-session) …`), and functions are invisible to `timeout`. The deadline therefore
  cannot be spelled `timeout 8 tmux …` inline in `_session_verdict`'s callers; it lives behind one
  seam (a probe helper that applies the deadline only when `tmux` resolves to an executable, or an
  overridable `_tmux_probe` the stubs replace), so the existing stub idiom keeps working and the
  deadline is still mutation-testable (delete it → a SIGSTOP-shaped fixture must go red).

The restart budget is untouched because nothing exits, which is the point: a fleet-wide substrate
fault must not consume seventeen units' `StartLimitBurst`.

**No automatic escalation, ever.** After N minutes of `unknown` the supervisor still does nothing but
report. It does not re-spawn, does not `cmd_ensure`, does not kill. A substrate fault is precisely the
condition under which ccd's model of the world is least reliable, and `ws-reap` being human-only by
contract is the same principle. Recovery is a human action; the system's job is to make the situation
legible and to still be there when it is fixed.

### 2. `$REG/<id>.substrate` — this supervisor's decision record

Flat file, ground truth, same as every other registry field. Content: `<epoch> <verdict text>`, e.g.

```
1755620112 protocol version mismatch (client 8, server 7)
```

**What the file means** (v1's open question 2, answered — and the answer is a reframing, not a
mechanism change): `.substrate` is not "the substrate is down". It is **"the supervisor of THIS row
could not reach tmux, since `<epoch>`, and this is what it saw"** — a per-writer decision record with
exactly one writer, this row's supervisor, which is also the only remover. The fleet-wide statement is
*derived* by a reader that sees every live row carrying the same fault; it is never itself written.
That is why per-session is right and a single box-level `$REG/.substrate` is wrong three separate
ways, each verified against the shipped code:

- A box-level file needs a writer with a box-level view. The agent has **no periodic timer**
  (`watch.ts` states it plainly: the sweep cadence is the server's, "not the agent's, which has
  none"), and `ccd` must stay runtime-independent of `ccrc-agent` — there is no natural single prober,
  and inventing one adds a new component to the exact path being hardened.
- A single marker is a quorum of one: its *absence* reads healthy, so one wedged prober fails open for
  the whole box. Seventeen supervisors already exist, already probe, and already fail independently —
  their agreement IS the box-level signal.
- Per-session degrades correctly to the partial fault (one wedged pane, the rarer-but-real case);
  box-level cannot express it at all.

The verdict text is the tmux message that produced `unknown`, verbatim and untruncated — the message
is the diagnosis. When the probe was killed by its deadline the text is the synthesized
`tmux did not answer within 8s`, never empty (§1).

**`field()`'s null collapse is a live blocker for this field** (already on the carried ticket list,
and stated precisely: `field()` collapses *absent* and *listed-but-the-read-failed* into one `null` on
the server seam — `registry.ts`). For `.substrate` that pair must not read alike: "no fault recorded"
and "the fault marker exists but could not be read" are opposite answers. This field's reader
therefore proves presence from `RegistryRead.names` (the directory listing), never from a non-null
read — the same listed-vs-readable distinction the registry ladder already draws. Do not add the
field on top of the collapse.

### 3. An axis, not a rung — `SessionLifecycle` is untouched

**This reverses v1 §3**, which proposed `substrate-unreachable` as a new first rung of
`SessionLifecycle`. The fixture walk v1's open question 3 asked for was done, and it kills the rung:

- **A rung masks every rung below it.** Under a substrate fault, `started`, `stopped`, `supervised`
  and the hold are all still readable off local disk — only `alive` is unmeasurable. A first rung
  swallows the whole ladder for the duration, and the masking is not costless: `_resupervise_live`
  (`ccd:8282`) gates on `state ∈ {unsupervised, unclaimed}`, so a session that was `unclaimed` when
  the fault began would stop being adoptable *the moment the fault clears* if the ladder had spent the
  outage reporting a masking state — the revive path reads the same word everything else does.
- **The two failures co-occur and must stay tellable-apart.** v1's own premise here was wrong (and is
  corrected in place): `unmeasurable` does not mean "the registry could not be read" — an unlistable
  registry answers `{listed:false}` and the rows vanish entirely; `unmeasurable` is the narrower
  "listed but this field would not read" case, server-side only. A substrate fault and a degraded row
  are independent axes already in the codebase's own vocabulary; adding the substrate as a *rung*
  would force an ordering between facts that do not order.
- **The ladder is a cross-language contract** (`sessionLifecycleFixture.ts` drives the bash and TS
  twins; "THE ORDERING IS THE CONTRACT"). Not touching it is worth real weight: the axis ships as an
  additive field with a single reader, no fixture surgery, no re-derivation of every rung's meaning
  under a new first row.

**The wire shape:** `FleetSession.substrate: { at: number; text: string } | null` — additive,
`FLEET_PROTO` stays 1, absence-permits (an older peer omitting it means no substrate fault, correct
for every older build). One reader tolerates absence (the `unmeasured` field beside it is the
worked example, down to the cast-not-revived live-frame caveat its PWA reader documents);
`reviveFleetSession` returns a literal, so the new field is a compile error until every path computes
it — the mechanism, not a convention. The server computes it from the registry listing + a read of
`.substrate` (bypassing `field()` per §2).

`SessionStatus` is also untouched. During a fleet-wide fault the server's own probes read `unknown`
too, so `status` still lands `'dead'` on the wire — and that is acceptable *because the axis rides
beside it*: the PWA branches on `substrate`, not on a new status word (§4). No new
`SessionStatus`, no render-seam sweep, no wire bump.

### 4. The PWA — the axis has a surface, and it gates the destructive affordances

Three requirements, in priority order:

**Destructive affordances are disabled while the axis is set.** Restart, stop, swap, archive on a row
whose `substrate` is non-null are offers to act on a session nobody can see — the same fail-shut
polarity D-308 (was D-B8-12) and D-309 (was D-B8-13) applied at every seam below, carried to the surface the operator actually touches.
This is also what retires the standing "false dead + ungated Restart button" hazard without a new
status word: the row may still say dead; the *button* is what must not fire.

**It must not look like `dead`.** A row with `substrate` set renders the substrate treatment — the
`sess-unmeasured` chip idiom is the pattern to follow (`SessionLine.tsx`: grey + generic word,
verbatim reason in `title`, heals on its own the moment the axis clears), not a variant of the dead
styling and never a parsed message.

**One fault, one banner.** When *every* live row carries the same substrate fault inside one snapshot,
that is one event, not seventeen — `fleet-host-banner` (`pwa/test/fleet-host-banner.test.tsx`) states
it once, names the remedy (restart tmux / reboot), and the per-row chips remain for the partial case.
The banner is *derived* from the rows (§2's per-writer design is what makes this derivation sound);
it is never its own wire fact.

### 5. Detection, since the host mitigation was declined

A protocol skew is detectable *before* it is fatal, and cheaply: `tmux -V` reports the client's
version; `tmux display-message -p '#{version}'` asks the running **server** for its own. Disagreement
means a new binary is on disk and the running server predates it — the loaded gun, seen before it
fires.

- **In `ccrc-doctor`** (`ccd/ccrc-doctor-checks` currently checks only that the binary exists) — a
  skew check for manual use. Necessary but not sufficient: nothing on the box runs `ccrc-doctor`
  unattended.
- **In the `unknown` branch of the supervise loop** — when a supervisor first writes `.substrate`, it
  records the skew comparison alongside the verdict text. This is the moment the answer is wanted,
  and it costs one extra (deadline-bounded) tmux call per fault, not per tick.

A version *floor* is the wrong instrument: the dangerous direction is client/server skew, which is
instant and total, not slow parser drift.

## Testing discipline this spec inherits

- The verdict vocabulary is already pinned by the **shared fixture**
  (`server/test/sessionVerdictFixture.ts`) driving both twins, including the near-miss trap rows that
  kill a loosened matcher. The supervise-loop change consumes `_session_verdict`; it must not grow a
  second classifier.
- Every new guard ships with a mutation measured red: the deadline (SIGSTOP-shaped fixture), the
  every-tick heartbeat stamp under `unknown` (clock-driven fixture walking the 120 s boundary), the
  marker's remove-on-first-live, the never-empty reason, the PWA's affordance gate.
- The `timeout`-vs-function-stub trap (§1) is a harness constraint, stated there so it is designed
  around rather than discovered by 200 red tests.

## What this does not do

It does not prevent the outage. With tmux unheld and unattended upgrades on, the event will happen;
this design makes the fleet survive it, report it accurately, and still be there afterwards. If the
calculus on pinning ever changes, `apt-mark hold tmux` remains a one-line reduction in how often the
path is exercised — but not a substitute for the path existing.

It does not touch `_alive`'s remaining callers beyond the supervise loop, and it does not touch the
server's three deliberate collapses (`fleet.ts` ×2, `sessionws.ts`) except by giving the PWA the axis
they were deferred *for* — each carries a D-309 deferral comment (the `fleet.ts` pair names this
spec; `sessionws.ts` defers through "see fleet.ts"), and §3/§4 are the discharge of that debt.

## Remaining operator decisions

1. **Confirm the axis-over-rung reversal** (§3) — v1 proposed a lifecycle rung; v2 withdraws it with
   the evidence above. This is the one structural choice worth a human yes.
2. **The constants:** probe deadline 8 s; backoff 5 s → 30 s after three consecutive `unknown` ticks;
   heartbeat stamped every `unknown` tick. All three are stated so they can be vetoed, not because
   any measurement argues for different values.
