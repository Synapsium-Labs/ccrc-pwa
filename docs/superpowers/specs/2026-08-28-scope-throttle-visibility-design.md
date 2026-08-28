# A throttled pane scope stops being invisible — design

**Goal:** a session strangled by its own memory cap is detectable in seconds,
by a check, instead of in eighteen hours, by a human reading `wchan`.

**Non-goal — and this is the load-bearing one:** changing the caps. §3 shows
the throttle is doing its job correctly on the very same box, the same day.
A design that "fixes" this by raising `MemoryHigh` or removing it would have
killed a healthy test run this morning.

## 1. What happened, twice, and what the tree already knew

`ccd/ccd-cap-scopes` caps every uncapped `tmux-spawn-*.scope` at
`MemoryHigh=8G MemoryMax=12G MemorySwapMax=2G TasksMax=4096`. It exists for a
good reason, recorded in its own header: on 2026-07-28 "a MekWarLive jest run
(15 workers) drove one pane scope to a 24G peak, exhausting 30G RAM + 8G swap
and stalling the whole fleet for ~25 min."

That header already describes this defect, in the entry for a DIFFERENT
incident — the 13 days the enforcer silently capped nothing:

> a runaway `ugrep` in an uncapped pane reached 14.8G RSS, pushed user@1000
> past its MemoryHigh, and put the whole fleet into reclaim throttling
> (load 57, every session stalled, **no OOM kill and no reboot to signal it**).

"No OOM kill and no reboot to signal it" is the whole finding. The cap that
followed moved the blast radius from the fleet to one scope. **It did not change
the failure mode.** A scope between `MemoryHigh` and `MemoryMax` is throttled,
never killed — so `memory.events` reads `oom_kill 0`, no unit fails, nothing is
logged, and the failure has no signal at any layer.

**Measured, 2026-08-27/28** — MekWarLive wave 2, run 9, frozen **18h51m**:

- scope `memory.current` **9.07 GiB** against `memory.high` **8 GiB**;
  `memory.events: high=20807511, oom_kill=0`.
- Held by work the session launched inside its own workspace: 4 jest workers
  (4.45 GiB) + `tsc -b --noEmit` (1.44) + DynamoDB Local (2.42) + claude (0.60).
- **The claude binary was itself throttled into `D`** (`wchan =
  mem_cgroup_handle_over_high`). No turn ran. A review subagent died with
  `API Error: Connection lost while your computer was asleep`. The coordinator's
  ruling could not deliver, because the mail gate requires an IDLE recipient and
  a throttled session never becomes idle.
- Every ccrc surface reported health throughout: `ccd ls` `running`, hookstate
  `working`, the run board `dispatched`, `unreadMail: 1`.

Recovery was one command — SIGKILL the two workloads, scope 9.07 → 2.87 GiB,
claude `D` → `S`, next turn within seconds. **The cost was entirely in the
detection, not the fix.**

## 2. Why doctor did not catch it

`_check_services` asks whether `ccd-cap-scopes.timer` is active, and WARNs when
it is not, because "panes spawned while it is stopped run without their memory
cap". That is a presence check on the guardrail. Nothing anywhere asks whether a
cap is currently strangling a session — the guardrail is verified for
installation, never for effect. (The same shape the tree already names:
a green mechanism that guards nothing is not a working mechanism.)

## 3. Why the caps must not move

The morning after the freeze, the same worker re-ran the same suite. Measured
over 10 seconds:

```
memory.current  8.005 -> 5.127 GiB    (high 8.00, max 12.00)
throttle events +8048 in 10s          oom_kill 0
```

It crossed the line at suite startup, the kernel reclaimed, and it fell back
with 3 GiB to spare. The claude process never left `S`. That is `MemoryHigh`
behaving exactly as designed — a soft brake, not a wall — and the run completed.

So the two states are NOT distinguished by "is it over `memory.high`". Both were.
They are distinguished by **how long**:

| | over the line | throttle events | outcome |
|---|---|---|---|
| healthy spike (08-28) | seconds | 8k, then 0 | reclaimed, run finished |
| the freeze (08-27) | 18h51m | 20.8M, sustained | every process in `D` |

A detector keyed on the instantaneous comparison would have fired on a healthy
run this morning. **Sustained-ness is the whole signal.**

## 4. The design

One reading, two surfaces, no policy change.

**The measurement — revised during implementation, see the note below.** For
each `tmux-spawn-*.scope`, ask systemd where it lives
(`systemctl --user show <scope> -p ControlGroup --value` — NEVER build the path,
that is D-307's whole lesson), read its `cgroup.procs`, and collect the pids
whose `/proc/<pid>/wchan` reads `mem_cgroup_handle_over_high`. Sample again
`SETTLE_MS` later and intersect. A pid throttled in BOTH samples is
persistently throttled; `D` is normally a sub-millisecond state, so surviving
two samples a second apart is already pathological.

Report `memory.current` against `memory.high` alongside it, because the
throttled pids are the symptom and the ratio is the cause.

> **Why not the counter.** The first draft of this section sampled
> `memory.events`' `high` counter over `THROTTLE_SUSTAINED_MS`. §3 kills that:
> the HEALTHY spike advanced the same counter by 8,048 in ten seconds, so
> separating the two cases needs a window measured in minutes — which means
> either a 60-second sleep inside `ccrc doctor`, or persistent state written by
> something that runs periodically. The only thing that already runs
> periodically is `ccd-cap-scopes`, and giving it a reporting job is what this
> section's last paragraph forbids.
>
> Process state needs neither. It is also the STRICTLY BETTER question: a jest
> worker being reclaimed is the throttle working, and yesterday's freeze is
> distinguished from this morning's spike by exactly one fact — whether the
> session's own agent process was among the throttled. `SETTLE_MS` is ~1s and
> exists only to reject a scheduling blip, not to measure duration.

**Surface 1 — `ccrc doctor`, a new `scopes` check.** Reads every
`tmux-spawn-*.scope`. PASS when none is throttling. WARN naming the session when
one is over `memory.high` but its counter is flat or falling (the healthy spike).
FAIL naming the session, its `memory.current`, and how long it has been
throttling when the counter has advanced across the whole window. The remedy
names the actual fix — find the workload inside the scope and kill it — not a
limit change.

**Surface 2 — the fleet view.** A session whose scope is sustainedly throttled
must not render as `running` with nothing else said. This is the same rule
D-792's spec draws for a delivery blocked at a transient gate, and it should be
drawn the same way: the lifecycle word is not wrong, so it is not replaced —
a separate fact is attached beside it.

**Where it must NOT go:** `ccd-cap-scopes` itself. That script's whole virtue is
that it is addressed by unit name and has survived two cgroup-layout moves
untouched (2026-08-10, D-307). It sets caps; it does not report on them.

## 5. What must not change

1. `MemoryHigh=8G MemoryMax=12G` stay exactly as they are. §3 is the evidence.
2. `ccd-cap-scopes` is not edited.
3. Nothing in this design kills, restarts, or unblocks anything. It REPORTS.
   The remedy is a human's or an operator tool's.
4. No new `ccd` verb — reading `memory.events` is a file read.

## 6. The mutation table

- A scope OVER `memory.high` whose pids are all schedulable → must PASS. This is
  the assertion that fails a naive over-the-line detector, and it is this
  morning's healthy spike written as a fixture.
- A scope with a pid parked on `mem_cgroup_handle_over_high` in BOTH samples →
  must WARN, and must name the scope and its `memory.current`/`memory.high`.
- A pid throttled in only the FIRST sample → must PASS. Delete the second sample
  from the implementation and this goes red; that is the whole reason the second
  sample exists.
- Path-building instead of `-p ControlGroup` → red. A fixture places the scope
  somewhere the old string-built path would miss, which is D-307 happening
  again on purpose.
- A scope whose `ControlGroup` names a directory that does not exist → neither
  WARN nor FAIL, and no error text. A scope can die between the listing and the
  read, and a check that shouts about a race is a check nobody reads.

## 7. Open, for the operator

- **`SETTLE_MS`** (was `THROTTLE_SUSTAINED_MS`, before the measurement changed).
  Its only job is to reject a scheduling blip, so it wants to be small enough
  that `ccrc doctor` stays fast. Recommendation: **1000ms**. Nothing about
  correctness rides on the exact value — a genuinely frozen scope stays frozen
  for hours.
- **Should the FAIL be a `doctor` FAIL at all?** `cmd_install` ends with
  `cmd_doctor` and returns its code (D-894), so a FAIL here would make
  `ccrc install` exit non-zero on a box that merely has a busy session. That
  argues for WARN-only in doctor, with the FAIL living on the fleet view.
