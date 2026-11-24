# Coordinator advisor: Opus coordinators with a capped Fable advisor (design)

Date: 2026-11-23. Plan: `docs/superpowers/plans/2026-11-23-coordinator-advisor.md` (D-8967..D-8972).

## 1. The operator's request

For day-to-day work, coordinators run on Opus with a Fable advisor. Every account has Fable on its plan, so no usage
credits are involved, but the advisor's calls count against the plan's limits, which run near their weekly ceiling.
So the advisor is capped per coordinator per day. It is off until the operator turns it on, and it can be limited to a
named list of coordinators, so a two-coordinator trial needs no code.

## 2. Claude Code's advisor, as the installed build has it (measured, not assumed)

Read from the strings of the installed build (2.1.331) and the documentation (D-8968, D-8969):

- The advisor is a server-side tool. The main model calls `advisor()` with no parameters. A stronger model reads the
  whole transcript (uncached) and returns guidance.
- `--advisor <model>` turns it on at launch, and it overrides the settings key `advisorModel`. `/advisor <model>|off`
  changes it inside a running session. ccrc never types into a pane, so a change applies at the next spawn.
- The whole block runs only when the feature gate is on. That needs a first-party provider, no
  `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`, no disabled non-essential traffic or feature flags, and the remote flag on.
  When the gate is off, `--advisor` is skipped without a word.
- When the gate is on, an interactive launch **exits** in two cases: the main model has no advisor rank, or the
  advisor is a model that would bill to usage credits on that account and was never enabled there. A ccd pane is an
  interactive launch, so either case kills the pane. Five deaths in 120 s leave the unit FAILED (`cmd_supervise`'s
  start limit).
- A pairing where the advisor is weaker than the main model is accepted with a warning, and the advisor is then not
  used for the main model.
- In the transcript, an advisor call is two content blocks in the assistant message:
  `{"type":"server_tool_use","id":…,"name":"advisor","input":{}}` and
  `{"type":"advisor_tool_result","tool_use_id":…,"content":{…}}`. The result's `content.type` is `advisor_result`
  (with `text` and `stop_reason`), `advisor_redacted_result`, or `advisor_tool_result_error` (with `error_code`).
- The advisor's tokens are in `message.usage.iterations[]`, in entries of `"type":"advisor_message"` that carry
  `model`, `input_tokens`, `output_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`. A local
  transcript shows that `usage.iterations` is saved, with `type:"message"` entries.
- When the advisor becomes available or unavailable, Claude Code adds an attachment line:
  `{"type":"attachment","attachment":{"type":"advisor_tool","available":true|false,"model":…,"toolChange":"add"|"remove"}}`.
- No transcript on the measuring machine holds an advisor call. So the saved line, as the fleet's coordinators will
  write it, is the **first thing the trial confirms** (plan, Trial step 1). The reader is written against the shape
  above, and it counts a line it cannot parse, so it never drops a line in silence.

## 3. Design: extend the existing owners

| Part | Owner, extended | What is new |
|---|---|---|
| Settings row | The `plain-auto-memory` shape: one `coord.db` row, `CoordStore` read/set, `GET`/`POST /api/coord/coordinator-advisor`, a row in `shared/switches.ts`, a section under Settings › Automation | `shared/coordinatorAdvisor.ts` (L0): choice `off`/`opus`/`fable`, the daily cap (default 12), scope `all` or a list of session ids |
| Who gets it | `server/src/roleOf.ts#roleOf` (the one role decider) and the launch-profile lane, which already writes a route for each session from the role | `advisorFor` (`continuity/advisorPolicy.ts`) decides the advisor. The lane writes one new lane-only route field, `advisor`. ccd learns a session is a coordinator only from what the route says, as it does for `profile` today |
| The spawn argv | `ccd/ccd#_spawn_start`, beside `_profile_spawn_compose` | `_advisor_spawn_compose` adds `--advisor <fable\|opus>` when the route carries `advisor`. ccd records what the spawn applied in `$REG/<id>.advisorspawn`, as `browsermcp` does. No field means the argv is byte for byte today's |
| Counting calls | The transcript context (`server/src/transcript/`): `parse.ts` is the one line parser, and `resolve.ts` finds the file | `parse.ts#advisorFactsOf` and a forward reader that keeps an offset for each advised coordinator. Calls and tokens go to `coord.db` |
| The cap | The same decider, and the roll lane (`server/src/rollLane.ts`, `coord/rollTarget.ts#autoRollVerdict`) | When the cap is reached, the lane clears `advisor`. A new roll reason, `advisor-stale`, restarts the idle session in place, so it drops the advisor without anything being typed |
| Readout | `FleetSession` (additive field), the session header's facts (`pwa/src/session/SessionDetails.tsx`), the Settings row | `advisorWords.ts` (L1, the one reader) |

**Why not the Models sheet** (D-8967): the lane-model classes are a per-account registry that maps a class to a model
id. ccd owns it (`ccrc models <lane>`), and every session on that lane reads it. The advisor is per role and per
session, has a cap, and has a trial scope. Putting it in the class registry would make the advisor a fact of an
account, so every session of that account would get it.

## 4. Who is eligible (L1, `advisorFor`)

The lane writes `advisor=<model>` only when every one of these holds:

1. The setting is not `off`, and the session is in the scope.
2. `roleOf` reads the session as `coordinator`. The Overlord is excluded: it is its own role with its own profile.
3. The session's lane is an Anthropic lane (the roster's `telemetry: anthropic`).
4. The main model is Opus: the route's `class` is `opus`, or there is no class and the session's measured main-loop
   model is in the opus family; and a measured Opus id is version 5 or later (only those pair with an advisor). An
   unmeasured model is never given one.
5. Today's measured calls are below the cap, and no fast death or `dropped` was recorded today (§6).

Removing it needs no fact that adding it needs: Off, out of scope, another role, the cap, a drop, a non-Anthropic lane
or a measured non-Opus model clears the field even while another fact is unmeasured. Otherwise, if any fact is
unmeasured, the lane writes nothing for this field. A clear is written whatever the lane's mode and the steer marker. An undecided reading takes the member that does
less (C49). ccd checks only the shape of the word (`fable`, `opus`).

## 5. The cap (D-8970)

Calls are counted for each coordinator and each UTC day (the day of the line's `timestamp`). A call is one distinct
`server_tool_use` id named `advisor`. Duplicate lines of a streamed reply, and a transcript a swap carried to another
account, are counted once (the primary key is the session and the call id).

When the count reaches the cap, `advisorFor` answers "clear", and the lane removes `advisor` from the route. A running
session can drop the tool only through `/advisor off`, which would be typed, or through a restart. ccrc does not type
into a pane, and it never kills a working session. So the restart is the roll's own act, `ccd hibernate --roll`. That
act re-checks for idle on the box and refuses a busy session. It takes the session only after the roll's 90-minute
quiet gate. Until then the session can keep calling: those calls count as **overrun** and are shown. At 00:00 UTC
the session is eligible again: the lane writes `advisor` again, and the same roll reason brings the advisor back at
the next idle.

When the continuity lane is live, a long-lived coordinator belongs to the renewal lane, not the roll. Its next
renewal applies the route. When the roll's Settings row is `off`, the change waits for the session's next spawn.
The readout says which path applies. So the cap is enforced at the next idle restart or renewal, not at the call that
reaches it; the overrun is the measure of the lag.

## 6. Measuring the advisor, not assuming it (readout)

These are the states of one coordinator. One decider produces them, and no null is overloaded:

- `off`: nothing is requested.
- `queued`: the route asks for the advisor, but the running pane's spawn did not apply it (it applies at the next
  start).
- `requested`: the spawn applied it, and the transcript has not yet shown any sign.
- `live`: since this spawn, the transcript shows an `advisor_tool` attachment with `available:true`, or an advisor
  call.
- `dropped`: an `advisor_tool` attachment with `available:false` after a spawn that applied it today, or ccd's
  fast-death fallback (§7). Either holds for the rest of its UTC day, across restarts.
- `unseen`: the spawn applied it, and after `ADVISOR_UNSEEN_REQUESTS` (20) main-loop API requests there is no
  attachment and no call. This is a doubt, not a drop.
- `capped`: today's calls reached the cap. The overrun is counted until the session restarts.
- `unmeasured`: ccd's spawn record could not be read, so what the running pane has is unknown.

Each coordinator also shows today's calls, the cap, and today's advisor tokens (input, output, cache read, cache
write, from the `advisor_message` iterations).

## 7. Fail-open at launch (ccd, box-local)

A launch the build refuses kills the pane (§2), and the unit then turns FAILED. To stop that, ccd records each spawn
that applied `--advisor` with its time. If the next spawn of that session comes within `ADVISOR_FAST_DEATH_S` (90 s),
ccd composes that spawn without the flag, records `off fastdeath`, and writes one `advisor-dropped` line in
`swap.log`. The record stands through later spawns without the flag, so the server reads `dropped` and stops asking for
the advisor for the rest of the UTC day; the next day the roll restores it. A deliberate respawn inside the window (a
swap right after a launch) is read the same way and costs the advisor for that day: the guard prefers that to a FAILED
unit. The
operator says no account is in the usage-credits state. The guard stays, because the cost of being wrong is a dead
coordinator.

## 8. Promise delta

```promise-delta
none - a design spec that ships no behaviour; the setting it describes is off by default, and the build pull requests carry any Promise change
```

## 9. Rejected

- `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL=1`: it switches off the build's pairing and rank checks (D-8972).
- Typing `/advisor off` at the cap, and killing a working pane at the cap.
- The usage sweep as the counter: it runs every 4 hours, per account and offline. A daily cap needs minutes.
- A Models-sheet class for the advisor (§3).
- Changing the coordinator skill's pinned clauses. Claude Code's own advisor prompt already says when to consult.
  Guidance specific to ccrc is a follow-up PR (D-8972).
