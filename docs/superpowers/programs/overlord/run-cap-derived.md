# The run cap is derived from the machine: task note

This note records what the derived run cap built, the formula and its constants with their reasoning, what happens on
upgrade, what a review changed, and what was not verified. It answers the operator's ruling of 2026-11-22: the fleet's
run cap is derived automatically from the machine the fleet runs on, and after set-up nobody sets a number. A machine
fact is measured, never typed.

It defines no D-number. Every place a deviation number would go carries the placeholder `D-8920`, which
`server/test/dtbd.test.ts` refuses until the coordinator mints the number and replaces it.

## In short

| Before | After |
|---|---|
| The cap is one stored number, `coordinator_state.maxConcurrentWorkers`, set by hand at the foot of Runs > Advanced. | The cap is derived from the fleet host's memory, its sessions' memory limit and its cores. The stored number is the operator's override when one stands, and otherwise only the number used while the host is unmeasured. |
| The dispatch door, the send-back door, the admission wake and the caps view each read the stored number. | All four ask one reader, `capNow` (`server/src/coord/dispatch.ts`), which hands the stored number, its mode and the host's size to one decision, `capNowOf` (`server/src/coord/caps.ts`). |
| The fleet host's size is measured nowhere. | The agent's `pressure` op answers it beside the pressure reading, as the additive field `machine`. In local mode the server measures its own box. |
| The control shows a number box and `save`. | The same control says `Automatic: 16 (from 64 GB and 16 cores)`. The box and `save` are the override, and `use automatic` clears it. No new card. |
| A cap moves only when the operator writes one. | An automatic cap can move with no operator act, so the move is recorded in the feed once. |

## The formula

It is stated once, in `server/src/coord/caps.ts`, above `deriveCap`:

    cap = clamp( min( floor((memTotalBytes - HOST_RESERVE_BYTES) / RUN_MEMORY_BUDGET_BYTES),
                      floor(sessionMemLimit / RUN_MEMORY_BUDGET_BYTES),      (only when the sessions have a limit)
                      cores * RUNS_PER_CORE ),
                 CAP_MIN, CAP_MAX )

The cap is the smallest of what the box's memory allows, what the sessions' own memory limit allows and what the cores
allow. It is never below one run and never above the ceiling that the operator's own number is held to. The answer
also names the term that set it (`bound`: `memory`, `session-limit`, `cores`, `floor` or `ceiling`) and the figures it
was derived from. A tie names the memory first, then the limit, then the cores.

| Constant | Value | Why |
|---|---|---|
| `RUN_MEMORY_BUDGET_BYTES` | 3 GiB | A run is more than one idle process. It is a worker session (a few hundred MiB resident when idle, more with a long conversation), the tools it starts, and its typecheck and test runs, each of which is several processes of a few hundred MiB to more than 1 GiB while it runs. 3 GiB is several times the idle size. A host run full at about one and a half times the cap this derives for it showed memory pressure at times. |
| `HOST_RESERVE_BYTES` | 8 GiB | Kept back from the box's memory for everything on it that is not a run: sessions that no run counts (coordinators, the operator's own sessions, workers that wait), the ccrc server or agent, the operating system and the page cache. A busy fleet holds about as many sessions outside any counted run as inside one, and at the idle size those alone come to several GiB. |
| `RUNS_PER_CORE` | 1 | A run mostly waits for its model, but its typecheck and test phases each take at least a whole core, and the suites are sensitive to load. |
| `CAP_MIN` | 1 (unchanged) | A cap of 0 refuses every dispatch. |
| `CAP_MAX` | 64 (unchanged) | The ceiling for the operator's own number, and now for the derived cap too. |

Two worked examples, with round figures:

- A host with 64 GiB of memory and 16 cores, and no limit on its sessions, derives
  `min(floor(56 / 3), 16) = min(18, 16) = 16`, set by the cores.
- The same host with its sessions limited to 24 GiB derives `min(18, floor(24 / 3), 16) = min(18, 8, 16) = 8`, set by
  the limit.

The formula is conservative about memory on purpose. A fleet that runs out of memory stalls every session on the box
at once. A fleet with a spare slot only waits.

### The sessions' memory limit

The session slice ships with a memory limit (`MemoryMax`, 24 GiB by default, set per box by
`CCRC_SESSION_SLICE_MEMORY_MAX`). The kernel enforces it whatever the box has, so a cap derived from the box alone could
promise memory the sessions may not use. The limit is therefore a term of the formula.

- **It is decided in the decider, not in the agent.** The agent sends the box's total memory and the limit as two
  facts. `deriveCap` takes the smaller term, so the answer can say which one set the cap, and the console shows both
  figures.
- **It takes no reserve.** The reserve is for the rest of the box, and the operating system and the control plane
  already sit outside the limit. The sessions that no run counts sit inside it and come out of the runs' budgets, which
  are several times an idle session.
- **A default-configured box is bounded by the default limit.** A 64 GiB box with the shipped 24 GiB limit derives 8,
  not 16. The control says `Automatic: 8 (from 64 GB, of which sessions may use 24 GB, and 16 cores)`. Raising the
  limit raises the cap. The limit is itself a typed setting with a fixed default; deriving it from the box as well is
  a follow-up this change does not make.

## The cap now

`capNowOf(stored, mode, host)` answers one of three things, and its answer says which:

1. `mode` is `override`: the cap is the operator's number. The derived cap is still reported, so the control can say
   what automatic would be.
2. `mode` is `automatic` and the host is measured: the cap is the derived cap.
3. `mode` is `automatic` and the host is unmeasured: the cap is the stored number, and `derived.kind` is `unmeasured`
   with its reason.

The host being unmeasured is never `null` and never a size of zero. It carries one of three reasons, because the
remedies differ:

| `why` | What happened | Remedy | What the control says |
|---|---|---|---|
| `no-reading` | Nothing has answered yet: the first seconds after a boot, a link that is down, an ask that was rejected. | It clears by itself. | "the fleet host has not been measured yet" |
| `agent-older` | The agent answered, and it has no `pressure` op or its reply carries no size. | Update the fleet agent. | "the fleet agent is too old to measure its host" |
| `read-failed` | The agent tried and could not measure, or a limit file could not be parsed. | Look at the box. | "the fleet host's size could not be read" |

`deriveCap` trusts no caller to have validated the figures. A memory or core count that is not a positive finite
number derives nothing (`read-failed`), so the stored number is used. Without that, a NaN would come out as a cap of
NaN, and `running >= NaN` is false, so the cap would refuse nothing.

## The measurement

- `agent/src/pressure.ts#measureMachine` measures three facts and decides nothing: the box's total memory
  (`os.totalmem`), the cores the agent may run on (`os.availableParallelism`), and the sessions' memory limit.
- The sessions' memory limit is the smallest `memory.max` or `memory.high` on the session slice and on every cgroup
  above it, up to the root. A limit on the user's slice, the user manager or a container's root cgroup holds the
  sessions as surely as the slice's own. With no slice (no systemd, a box where no session ever started, a container),
  the cgroups above the agent's own process are read, never its own leaf: a limit on the agent's service is not a limit
  on the sessions. No limit anywhere is `none`. A limit file that was read and could not be parsed is `unreadable`.
- `process.constrainedMemory()` is not read: it is the agent's own leaf. A cgroup CPU quota (`cpu.max`) is not read.
- The headroom and the size share one walk of the cgroup tree (`measureSessions`) and one parser of a limit file
  (`limitFile`).
- The `pressure` op's reply gains `machine?: { memTotalBytes, cores, sessionMemLimit } | null`. It is additive: there
  is no `FLEET_PROTO` bump, and an older agent sends no field. `shared/pressure.ts#readHostMachine` is its one reader,
  and the agent's own measurement goes through it too.
- A box with no PSI answers the size alone. Before, it answered an error, so its size never arrived. A reply with no
  PSI is no reading to every server, exactly as the error was, so the box is never read as calm.
- `MeasuredPressure` carries `machine` on both members, as the reader's answer: measured, or unmeasured with its
  reason. The remote adapter keeps the reasons apart: no ready frame yet and a rejected request are `no-reading`; an
  ops list without the op and a reply without the key are `agent-older`; a `null` or malformed size is `read-failed`.
- The pressure lane holds the size apart from the PSI reading (`PressureState.machine`, `machineAfter`). A size is not
  evidence that ages: an unanswered ask, a stale PSI reading and an answer with no size all keep it. With no size
  held, an answered reason replaces the held one, and a link blip never erases it.
- While nothing has answered about the size (`no-reading`), the lane asks again on the next tick, not ten seconds
  later (`pressureAskDue`). After a restart the first ask goes out before the agent link is ready; waiting out the
  interval would enforce the stored number that long. An answered reason waits the full interval.
- `FleetWatcher.hostMachine()` is the one reading. The dispatch door, the send-back door and the caps view take it
  through `CapPorts.hostMachine`; the admission wake takes it through `AdmissionWakeDeps.hostMachine`.

## The wire

`GET /api/coord/caps` and `POST /api/coord/caps` answer one additive field on `CoordCapsView`:

    capNow: { mode: 'automatic' | 'override', cap, derived }
    derived: { kind: 'measured', cap, bound, memTotalBytes, cores, sessionMemLimitBytes? }
           | { kind: 'unmeasured', why }

`sessionMemLimitBytes` is present only when the sessions have a limit. `caps.maxConcurrentWorkers` stays the stored
number, so an older console still works. `shared/runCap.ts#readCapNow` is the field's one reader. The vocabulary lives in `shared/runCap.ts`, because `shared/api.ts` is capped.

`POST /api/coord/caps` takes the body it always took, `{ "maxConcurrentWorkers": n }`, which is now the override. It
also takes `{ "mode": "automatic" }`, which clears the override and keeps the stored number. It refuses `automatic`
together with a number, `override` with no number, and a mode it does not know. The door's posture is unchanged: it is
session-gated when armed and takes no box token, so no census sentence in `CLAUDE.md` changes and no route was added.

## The feed record

- The operator's write is recorded as before, naming the cap in force on each side: `workers automatic (16) → 12`,
  `workers 12 → automatic (16)`.
- An automatic cap that differs from the stored number is recorded once by the pressure beat, which is what lands the
  size: `workers 3 → automatic (16)` (`caps.ts#capAutomaticNotice`, `PressureLane.noteAutomaticCap`). The key carries
  the stored number's `updatedAt` and the derived cap. So a restart repeats nothing, a host that derives a new cap is
  recorded again, and the operator's own move to automatic, which the route records under the same key, is not
  recorded twice.

## Upgrade behaviour

Migration 121 adds `coordinator_state.capMode TEXT NOT NULL DEFAULT 'automatic'`, with a CHECK that holds it to the two
words, and one `UPDATE` that sets `override` on a row somebody had set.

- **The upgrade moves no cap somebody set.** A row written through the caps route (`updatedAt > 0`), or edited by hand
  to a number other than the seed, becomes an `override`. Its number stays the cap. The control says "Set by hand: N.
  Automatic would be M" and offers `use automatic`: one tap, and it is recorded.
- **A box still on the untouched seed (3) becomes automatic.** Nobody chose that number. Its cap moves to the derived
  one when the first reading lands, and the feed records it.
- **Why not make every box automatic.** The stored number bounded things the formula does not measure, such as other
  tenants of the box, disk per worktree and account usage, and it may have been lowered on purpose. Making it automatic
  would raise a lowered cap, or drop a raised one, with no operator act. On a box with the default session limit the
  drop would be large. This choice is one statement in the migration; removing it restores "every box is automatic".
- **A new server with an older agent** reads the host as unmeasured (`agent-older`) and enforces the stored number
  until the agent is updated. The control says so. `ccrc rollout` moves the fleet box first by default.
- **A rollback is safe.** An older server ignores the column and enforces the stored number.
- **Still open.** A number that an older server writes during a rollback leaves the mode as it was. After the roll
  forward, a number set that way under `automatic` is not an override, so the derived cap replaces it. The feed
  records it when it happens; nothing prevents it.

## Departures and choices, by slug

| Slug | What was chosen, and why |
|---|---|
| `older-console-shows-stored` | An older cached console reads `caps.maxConcurrentWorkers`, the stored number, while the server enforces the derived cap. `CoordCaps` is the stored value that `decideCaps` merges and `setCaps` writes, so the cap in force rides the new field. The mismatch ends when the console updates. |
| `session-limit-is-a-term` | The sessions' memory limit bounds the cap as a term of its own, with no reserve, decided in `deriveCap`. The first build folded it into the memory figure in the agent; see "What a review changed". |
| `hand-set-number-stays` | A number somebody set stays the cap across the upgrade, as an override. See "Upgrade behaviour". |
| `setCaps-defaults-to-override` | `setCaps(next, at, mode = 'override')`. The route always passes the mode. The default is what writing a number means, and it keeps every fixture that sets a cap refusing at that cap. |
| `unknown-mode-refused` | A body whose `mode` this build does not know is refused, not ignored. Ignoring it beside a number would store an override the caller may not have meant. |
| `typed-number-under-automatic-is-an-ask` | While the cap is automatic, a number saved from a box the operator typed in is always sent, the number on screen included. That is how the operator fixes the cap at the number they see. An untouched box sends nothing. |
| `test-box-is-not-the-fleet-host` | In local mode the server measures its own box, and well over a hundred server test files build a real watcher over that adapter. Their pressure beat would derive the cap, and record it in the feed, from whatever machine runs the suite. `server/test/host-size.setup.mjs` makes the box's memory unmeasurable in every test worker, so an automatic cap in a rig is the stored number, as before. A test that wants the real measurement asks by name (`withRealHostSize`). Nothing in `src/` changes for it. |
| `constrained-memory-not-read` | `process.constrainedMemory()` reports the agent's own cgroup leaf, which may carry a service limit that is not the sessions'. The cgroup walk reads the root instead, which covers a container. |

## What a review changed

A review of the first build found these, and each is fixed with a test that goes red without the fix:

- The agent folded the session slice's limit into `memTotalBytes`, so a default-configured box derived 5 and the
  control read "from 24 GB". The agent now sends both facts and the decider takes the smaller term.
- A remote box with no PSI never reported its size. It now answers the size alone.
- After a restart the stored number was enforced for about ten seconds with the link up. The lane now asks again on
  the next tick while nothing has answered.
- The upgrade made every box automatic. A number somebody set now stays the cap.
- An automatic cap moved with no record. The pressure beat now records it once.
- Limits above the slice, the slice's `memory.high` and a container's root limit were not read. They are now.
- `deriveCap` passed a NaN through to a cap that refused nothing. It now derives nothing for a figure that is no size.
- Four reasons for an unmeasured host folded into one sentence that said "yet". They are three words now, kept from
  the adapter to the console.
- The control could not fix the cap at the number on screen. It can now.
- `CapsReading` carried the cap in force inside a `CoordCaps`, the stored number's type. It now carries `limit`, a
  number.
- The one writer of `capMode` had no test. `single-definition/writers-map.test.ts` now names
  `coordinator_state`'s writers.
- The headroom and the size each parsed the slice's `memory.max`, over two walks. They share one parser and one walk.
- The example figures were a measured host's. They are round stand-ins now.

Two things the review round found for itself:

- The server's test rigs measured the box they ran on. The cap in force in a rig, and with the new feed record its
  feed, depended on the runner. The suite now pins the test box as unmeasurable (`test-box-is-not-the-fleet-host`).
- `shared/api.ts` is capped, and the wire vocabulary pushed it over its cap. The vocabulary moved to
  `shared/runCap.ts`.

## What was tested

Every new guard was checked by removing or bending it and watching its test go red. The review round measured 45
mutations, 45 red: each term of the formula and the limit's missing reserve, the not-a-size guard, the reasons, the
feed record's conditions and key, the migration's rule, the lane's archive read and its remembered key, the route's
key, the ask rule, the adapters' reasons, both wire readers, each level of the agent's cgroup walk, the no-PSI answer,
the one walk, the writer census, the test box's pin, and the control's save rule, button and sentences. The first build's own table (59
red) covered the terms and clamps, the three answers of `capNowOf`, the body's `mode` rules and the one reader at each
door.

## What was not verified

- No fleet host was touched. The constants rest on one measurement, not on a trial at the derived cap.
- Whether the measured host's session limit is the default was not read. If it is, its automatic cap is 8.
- The agent's reading of a real cgroup tree is covered by fixtures only: a live session slice, a real container and a
  real user manager were not read.
- The local adapter carries the size on both of its answers, but each is exercised only on a box that takes that path:
  the `unsupported` answer on a box with no PSI (where this was built), the `ok` answer on Linux.
- The control was exercised in jsdom. It was not looked at in a browser, so its layout on a phone is unmeasured, and the
  longer sentence with a session limit may wrap.
- The full server, agent and PWA suites were not run, only the files this change touches and the guard suites it trips.
- `README.md` and the coordinator skill's refusal table were updated by hand. Their suites pass, but no test checks
  those sentences.
- The migration slot (121) was measured against this branch's base, not against `origin/main` at merge time.
