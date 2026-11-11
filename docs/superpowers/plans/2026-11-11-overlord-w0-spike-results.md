# Overlord W0, the spike: results

> The measured answers of the Overlord's W0 spike (plan `docs/superpowers/plans/2026-11-10-overlord/w0-spike.md`,
> spec `docs/superpowers/specs/2026-11-09-overlord-design.md`). W0a (run 1774) measured rows W0-00 to W0-19 and
> W0-27, and answered W0-25 from the tree. Rows W0-20 to W0-24, W0-26 and W0-28 wait for W0b and the operator's setup
> item; where W0a read a half of one, the read half is here and the rest is marked as waiting.
>
> Every row says which kind of result it is: **doc** (read in Claude Code's documentation), **tree** (read in this
> repository), **binary** (read from an installed build's strings), **rig** (what Claude Code sent to the mock API,
> on a named build; never whether a real model heeded it), **box** (a box-token read of the live server), **model**
> (the research model), or **emulated** (the mock sent a shape the documentation names). A rig result holds for the
> build it ran on.

## In short

- **Measured (W0a):** W0-00 to W0-19 and W0-27 on Claude Code 2.1.312 and 2.1.322, in the rig against a mock API,
  plus box-token and tree reads, and W0-25 from the tree. Every scenario is in
  `server/test/delegation-rig/scenarios-overlord/`; nothing from a run is committed.
- **The design stands on:** the hook cap (10,000 characters per hook command, so the anchor slot stands); each start
  source measured at the request (`startup`, `compact`, `fork`) delivers its context, and a fork reports `fork`; the
  workspace memory file survives `/clear` and compaction; a manual compaction keeps the session id (a real automatic
  one is unmeasured), `/clear` mints one; auto memory, forks with agent view (set together) and the subagent model each
  have a per-session switch that holds (the model only with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`); the door process
  serves typed tools under the restricted launch with no prompt, readers are scoped by `agent_type`, and pinned sources
  load nothing from the account config; a PreCompact refusal is honoured once a turn; and the first model holds every
  invariant on this edition.
- **What the outcomes change (proposals, last section):** D-6798's no-model arm refuses every Agent call under FORCE
  (measured with ccrc's hook loaded); crons survive `/clear` (the profile denies them); the profile must carry ccrc's
  hook and the bypass acceptance; an automatic compaction is read by PreCompact `auto`; the sidecar gains the token
  count and window size.
- **Inconclusive, so the conservative branch:** the idle-compaction switch (the 45-minute trigger is load-bearing),
  Claude Code's own switch on a flagged request (the statusline journals model changes too), and the typed `/clear`'s
  reliability (unmeasured: no run in the store's window took that path, so fresh start only).
- **Waiting for W0b:** W0-20 to W0-24, W0-26's restart figures, W0-28, and the fleet halves of W0-06, W0-09, W0-12 and
  W0-19.

## The builds

Installed on the box on 2026-11-11 (`rig.sh versions`): 2.1.312, 2.1.314, 2.1.316, 2.1.318, 2.1.319, 2.1.321 and
2.1.322. **Oldest 2.1.312, newest 2.1.322.** Every rig scenario ran on both. The changelog's newest entry is 2.1.322.
The fleet lanes' own builds are W0b's read (plan Task 8 Step 1b); a lane on a build outside this pair is unmeasured by
the rig.

## The documentation (W0-00), read 2026-11-11

Pages are under `https://code.claude.com/docs/en/`; the API pages are on the platform documentation. Each line is the
page, then what it says. A fact that changed from the spec's edition is marked **changed**.

| Spec fact (Table 1.2a, §3.3) | Page | What the page says on 2026-11-11 | Changed? |
|---|---|---|---|
| Hook context is capped at 10,000 characters; above it the text becomes a file and a 2,000-character preview | hooks | `additionalContext`, `systemMessage`, `initialUserMessage` and plain stdout are each capped at 10,000 characters, measured "on its own, even when several hooks run for the same event"; over the cap a preview of about 2,000 characters is shown and the whole text saved to a file. PreCompact stdout is cut at the cap | No; and the cap is **per string**, so per hook command, not per event (W0-01 measures it) |
| Auto memory is on by default; ccd does not turn it off | memory, settings | On by default. Setting `autoMemoryEnabled`; env `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (`1` off, `0` forces on), which "takes precedence over this key for one session, in either direction" | No; a per-session switch exists (W0-09) |
| Forks are on by default and inherit the main model and every tool | sub-agents | Fork mode "is on by default"; a fork receives "the main conversation's exact tool pool" and runs on its model. Switch: env `CLAUDE_CODE_FORK_SUBAGENT=0`; no settings key named | No (W0-10) |
| Transcripts are deleted after 30 days | claude-directory | `cleanupPeriodDays`, default 30, minimum 1 | No |
| A PreCompact hook can refuse a proactive compaction | hooks | Exit code 2, or JSON `"decision": "block"`; matchers `manual` and `auto`, and `auto` covers idle compaction too. A blocked proactive compaction is skipped and the conversation continues uncompacted | No (W0-13) |
| A flagged Fable request re-runs on another model and stays there | model-config, settings | Setting `switchModelsOnFlag` (true: switch and continue; false: ask when interactive, error in print mode); env `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1` turns the switch off. Whether the session stays on the other model is not stated | Partly: a documented pin exists (W0-12) |
| Fable billed to usage credits raises a consent prompt | model-config | Asks in an interactive session; bills without asking in print mode or an SDK app with no prompt | No (W0-23 is W0b's) |
| After a compaction, skills are restored within 5k tokens each and 25k in all, oldest dropped first | context-window | "Invoked skill bodies: Re-injected, capped at 5,000 tokens per skill and 25,000 tokens total; oldest dropped first" | No |
| On a 1M window, auto-compact fires near 967k tokens | model-config | As written. Controls: env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (100k to 1M), setting `autoCompactWindow` (per model under `modelSettings`), flag `--autocompact`, env `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (lowers only), setting `idleCompaction`, env `DISABLE_AUTO_COMPACT`; `DISABLE_COMPACT` turns off every compaction | No (W0-14) |

**The exact names Task 2's lists and Tasks 4 to 6 use** (all from the pages above, read 2026-11-11):

| What | Name | Page |
|---|---|---|
| Auto-memory switch | setting `autoMemoryEnabled`; env `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | memory |
| Fork switch | env `CLAUDE_CODE_FORK_SUBAGENT` (`0` off) | sub-agents |
| Agent view switch | setting `disableAgentView`; env `CLAUDE_CODE_DISABLE_AGENT_VIEW` | agent view |
| Agent teams switch | env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (off by default); setting `teammateMode` | agent-teams |
| Subagent model | env `CLAUDE_CODE_SUBAGENT_MODEL`; force variant `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`. Order: a per-call `model` beats the definition, which beats the env, unless FORCE is set | sub-agents |
| Auto-compact window, idle compaction | see the table above; idle compaction has no env of its own, only the `idleCompaction` setting (or `DISABLE_AUTO_COMPACT`) | model-config |
| PreCompact block form | exit code 2, or JSON `"decision": "block"` | hooks |
| Inbound peer messages | setting `crossSessionInbound`: `accept`, `hold` or `refuse` (the strictest project or local value wins); tools `SendMessage`, `ListAgents` | cross-session messaging |
| Remote Control | flag `--remote-control` (`--rc`); setting `remoteControlAtStartup` | cli-reference |
| Cron tools | `CronCreate`, `CronList`, `CronDelete`; env `CLAUDE_CODE_DISABLE_CRON=1`. **None is durable:** tasks fire only while the process runs and is idle; they are restored on `--resume` or `--continue`; recurring ones expire after 7 days | scheduled tasks |
| Background tasks | env `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` | env-vars |
| Statusline payload | `context_window.total_input_tokens`, `.total_output_tokens`, `.context_window_size`, `.used_percentage`; `rate_limits.five_hour` and `.seven_day`, each with `used_percentage` and `resets_at`. Refreshes on events (300 ms debounce), and every `refreshInterval` seconds if set | statusline |
| Flagged-request refusal (API) | HTTP 200, `stop_reason: "refusal"` with a `stop_details` object | API: handling stop reasons |
| Context-limit stop (API) | `stop_reason: "model_context_window_exceeded"` | API: handling stop reasons |
| SessionStart `source` | `startup`, `resume`, `clear`, `compact`, `fork`; a fork reports `fork` | hooks |
| Model switch hooks | `PreModelSwitch` and `PostModelSwitch` events are listed | hooks |
| Hook timeout | default 600 s for a command hook; a hook past its timeout is cancelled and its output discarded | hooks |

**The CLI flags Task 2's `RIG_LAUNCH_FLAGS` holds**, each in the CLI reference, with its arity: `--setting-sources`
(a comma-separated value: `user`, `project`, `local`), `--settings` (a file or inline JSON), `--mcp-config` (one or
more values), `--strict-mcp-config` (no value), `--agents` (JSON), `--allowedTools` and `--disallowedTools` (a value),
`--permission-mode` (a value), `--dangerously-skip-permissions` (no value), `--model` (a value), and the switches
Task 1 found: `--tools` (a value), `--autocompact` (a number or `auto`), `--append-system-prompt` (a value) and
`--disable-slash-commands` (no value). `--fork-session` (no value) is not on the list because `relaunch
{"mode":"fork"}` adds it. Left out on purpose: `--remote-control` (it would reach for a real service, never the mock)
and `--bare` (it skips hooks, and so ccrc's own). No CLI flag switches forks, auto memory or peer messages: those are
env names and settings, which `RIG_LAUNCH_ENV` and `launch.settings` carry.

## The binary (W0-18, W0-01), read 2026-11-11

`strings` on 2.1.312 and 2.1.322, read-only. **The rate-limit headers both builds read:**
`anthropic-ratelimit-unified-{status,reset,fallback,representative-claim,upgrade-paths}`, the `5h` and `7d` families
(`-utilization`, `-reset`, `-status`, `-surpassed-threshold`), `grace-5h-utilization`, `grace-7d-utilization`, the
`overage-*` family and the `slow-*` family; 2.1.322 adds `overage-daily-cap-paused`. **No per-model weekly header**
(no Fable, Opus or Sonnet name in any of them). The hook spill constant is not a named literal that a string search
can tie to hook output on these builds (the hook-output merge keeps one `additionalContext` entry per hook command), so
W0-01 measures the threshold in the rig rather than reading it.

## The tree (W0-05, W0-25, W0-26), read at `3339c4c65`

**The uuid dispute (W0-05, read half).** The three comments, quoted:
- `ccd/ccd#_sync_uuid`: "Claude Code rotates the active session uuid during normal operation (/clear; compaction keeps
  its transcript), so a uuid pinned at start goes stale".
- `server/src/coord/routes.ts` (the attribution comment): "a session that was `/clear`ed or compacted since it read its
  own uuid, which `_sync_uuid` rotates every 5s".
- `server/src/sessionws.ts` (the socket's header): "follows uuid rotation (clear/compact/swap)".

The corpus answers the `/clear` half already: on every build from 2.1.280 to 2.1.319, `clear-compact-resume`'s
SessionStart `clear` carries a new `session_id`, and the manual `/compact` that follows (PreCompact and PostCompact
`manual`) and the `--resume` after it keep that id. Task 5 measures the automatic compaction.

**Today's account pick (W0-25, read).** `ccd/ccd#_ws_least_loaded` walks `CCRC_HOME_ABLE` in roster order and keeps the
lowest `_limit_score` with a strict `<`, so on equal scores the first account in roster order wins.
`server/test/projected-home.test.ts` pins it ("ties go to the earlier account in roster order"), and
`server/test/ccd-swap-target-class.test.ts` relies on it (two scoreless lanes tie and roster order takes the first).
Home comes first (`ccd/ccd#cmd_prefer`), then load. So a roster-order tie-break exists and is pinned; no scratch run
was needed. **Outcome:** W1 extends this order (C56) rather than adding a second one.

**Lane cadences (W0-26, read half).** `LANE_SCHEDULE` in `server/src/laneSchedule.ts`: 5 s `lifecycle`; 10 s `tasks`,
`names`, `idleNudge`, `mail`, `asks`; 30 s `landingChecks`, `pr` while active; 60 s `caps`, `inventory`,
`landingRadar`, `serverCaps`, `usage`, `divergences`, `claimRenew`, `claimLapse`, `stalls`, `digestBeat`,
`childReclaim`, `collect`, `archivedExpiry`, `deadCoordinator`, `orphanTrees`, `delegation`, `sleepRunDone`,
`diskAlarm`, `runStuck`, `runUntold`, `runClose`; 120 s `pr`; 5 minutes `sleepIdleHours`, `rollIdle`, `tmpCensus`;
10 minutes `readiness`; 15 minutes `drift`, `ledgerReconcile`; 30 minutes `catalogue`; an hour `ledgerFloor`,
`staleArchive`; a day `approvalPrune`. **A lane named `readiness` exists** (`READINESS_SWEEP_MS`, 600 s), but it is the
programme-start readiness (skills installed, token present), not a session's readiness: no lane computes the
Overlord's readiness today, as the plan says, and W1 names its own lane. The restart counts are W0b's (Task 8).

## The corpus (W0-02, read half)

`server/test/fixtures/delegation/<version>/clear-compact-resume.json` and `swap-resume.json`, every build 2.1.280 to
2.1.319 (21 builds): SessionStart `source` is `startup`, `clear` and `resume`, and nothing else. `compact` is absent by
design (the capture arm leaves it out) and `fork` was never captured. Task 4 measures both.

## The `/clear` count (W0-07), read 2026-11-11

`ccrc-api runs list --closed 1`: 541 runs, **none with `resumed` true**, none with `clearedAt` set, none with a
`health.clearError`. The list is the store's window, its active runs and its newest 500 closed ones (the store's `runs`
read, `closedLimit` 500 by default, in `server/src/coord/store.ts`), not the server's whole history: run ids pass
1,700. Within that window every wave opened as a fresh dispatch (one run per wave), so the typed `/clear` fast path did
not run there; older runs were not read. **Outcome: unmeasured, which selects "fresh start only"** (H13): coordinators
renew by a fresh start too, until a measurement exists.

## Other platform facts the read pass found (for W0b and Task 12)

- **Inbound peer messages have a documented switch**, `crossSessionInbound` (`refuse`), so H1's closed channel has a
  setting to rest on (W0-17 measures what the tools offered show).
- **Model switches have hook events**, `PreModelSwitch` and `PostModelSwitch`, which bears on W0-12.
- **The flagged-request switch has a documented pin**, `switchModelsOnFlag: false` or
  `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1`.
- **The subagent model has a force variant**, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, which the documentation says beats
  a per-call `model`.
- **The cron tools are session-scoped**, restored on `--resume`; none is durable across the process.

## The anchor and its carriers (Task 4: W0-01 to W0-04), measured 2026-11-11

Every run below applied its launch: the emitter's log has a line for each start, and the first main request after it
carries the emitter's head canary. Requests were read from the mock's dumps (`reqs/`). One rig fact first: 2.1.322's
system prompt no longer opens with the mock's default main-thread marker ("You are an interactive agent"), so the mock
files its main requests as subagent requests unless `MOCK_MAIN_MARKER` names both prompt shapes. Every W0 run set it
(`You are (an interactive agent|an agent working with the user|Claude Code)`); the delegation corpus matches on
`tools` and is not affected.

**W0-01, the hook's cap (rig, 2.1.312 and 2.1.322, identical).** A SessionStart emitter of N characters, the next main
request read for both canaries:

| Scenario | Text | Head canary | Tail canary | Spilled |
|---|---|---|---|---|
| `ov-hook-cap-9951` | 9,951 ASCII | yes | yes | no |
| `ov-hook-cap-10000` | 10,000 ASCII | yes | yes | no |
| `ov-hook-cap-10001` | 10,001 ASCII | yes | **no** | yes: a `<persisted-output>` block, "Output too large", the saved file's path, and a "Preview (first …)" of exactly 2,000 characters |
| `ov-hook-cap-12000` | 12,000 ASCII | yes | no | yes, the same 2,000-character preview |
| `ov-hook-cap-wide-6000` | 6,000 two-byte characters (about 12,000 bytes) | yes | yes | no |
| `ov-hook-cap-pair` | two commands of 6,000 each on one event (12,000 in all) | both | both | no |

**Answer:** whole up to and including 10,000 JavaScript characters; counted in characters, not bytes; counted per hook
command, not per event. **Outcome: the slot stands** (`ANCHOR_CARD_MAX_CHARS` = 1,500 and the pinned sum of 9,951 fit
one command under the cap). Because the cap is per command, a second SessionStart hook does not eat into ccrc's
budget; the per-command cap is what W1a pins. Only the tail canary proves delivery: the head survives in the preview.

**W0-02, the start sources (rig, both builds, identical).** `ov-sources`, an emitter of 200 characters tagging its
text with the payload's `source`:

| Start | `source` the hook saw | Its context in the next main request |
|---|---|---|
| launch | `startup` | yes |
| `/compact` | `compact` | yes, in the first request after the compaction (beside the "This session is being continued" summary) |
| `relaunch {"mode":"fresh"}` (no `--resume`) | `startup` | yes |
| `relaunch {"mode":"fork"}` (`--resume <sid> --fork-session`) | **`fork`** | yes, after the resumed history (which still carries the earlier start's text) |

Delivery at the request is measured here for `startup`, `compact` and `fork`. `clear` and `resume` rest on the
delegation corpus (Task 1), which records the hook's payload, and so its `source`, on builds up to 2.1.319, and not the
request after it: that their context reaches the next request is not measured. **Outcome: a fork reports a word of its
own, `fork`, so the refusal line keys on it** (not on the transcript's continued-in pointer), and no measured source
drops its context, so the card needs no nudge for those three; for `clear` and `resume` delivery at the request is
unmeasured. A fresh start reports `startup`: the anchor
cannot tell a fresh renewal from a first launch by `source` alone, so the generation is minted by the server's own
record of the renewal, as §3.3.11 already has it.

**W0-03, the workspace memory file (rig, both builds, identical).** `ov-carriers`: a `CLAUDE.md` holding
`W0-CONST-CANARY` in the fixture repo. The canary is in the first main request, in the first request after `/clear`,
in both compaction requests, and in the first request after `/compact`. **Outcome: present after both, as designed**
(C38 stands).

**W0-04, the per-prompt hook (rig, both builds, identical).** In `ov-carriers` a UserPromptSubmit emitter of 600
characters arrived whole (both canaries) with each of the three prompts, including the one after `/clear` and the one
after `/compact`. A second UserPromptSubmit hook with `timeout: 3` that sleeps 8 s before emitting never logged a
line, and no text of it reached any request; the prompt went ahead after the timeout. **Outcome: delivered, and the
late one drops its output, as designed** (the per-prompt delta stays in W1a).

## Compaction, clear and the fresh start (Task 5: W0-05, W0-06, W0-08, W0-13, W0-14), measured 2026-11-11

**W0-05, does a compaction change the session id (rig, both builds, identical).** `ov-compact` took `sessionsSnap`
before and after a manual `/compact`, and before and after an automatic compaction past a lowered window
(`CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`, the mock reporting 150,000 input tokens). Claude Code's live-session record
(`sessions/<pid>.json`) named the same `sessionId` in all four snapshots, and one transcript file, under that id, grew
throughout; every hook payload carried that id. With the corpus's `/clear` (a new id) and `--resume` (the same id),
**the answer is: `/clear` mints a new session id; a manual `/compact` keeps it, and so did the rig's automatic
compaction**, which was a PreCompact `auto` followed by a request with the earlier turns trimmed. That a real automatic
compaction, which summarises, keeps the id is not shown (next paragraph). `ccd/ccd#_sync_uuid`'s header ("compaction
keeps its transcript") is the right one for what was measured. The attribution comment in `server/src/coord/routes.ts`
and the socket header in `server/src/sessionws.ts` ("clear/compact") are wrong about a manual compaction; a follow-up
issue, not W0. **Outcome: the binding to the session id stands either way** (C2).

A second fact `ov-compact` showed, and the design needs: **the automatic compaction under the mock sent no summarising
request.** The PreCompact hook fired with `trigger: auto`; then the next request went out with the earlier turns
dropped and no summary in their place, and neither a SessionStart `compact` nor a PostCompact followed. The manual
`/compact` in the same run sent two summarising requests, then fired PostCompact `manual` and SessionStart `compact`,
whose context reached the next request (W0-02). Whether a real automatic compaction, on real usage figures, takes the
same path is not shown here (the mock's usage figures are fixed numbers): it is a rig result. It matters because the
anchor's re-injection keys on SessionStart `compact`. **Proposal (last section):** W1a reads an automatic compaction
by PreCompact `auto`, not by SessionStart `compact`, until a real one is measured.

**W0-06, the fresh start's time (rig half, both builds).** `ov-renew-time-<size>` grew a transcript with padded
mock replies, then relaunched the pane ten times by resume and ten times fresh, each to its ready prompt. Times are
from the relaunch to the ready prompt (the rig polls every 0.25 s, which is the resolution) and to the SessionStart
hook (its capture's file name), on a box at load about 8 of 16 cores:

| Transcript | Build | Resume: ready p50 / p95 | Resume: SessionStart p95 | Fresh: ready p50 / p95 | Fresh: SessionStart p95 |
|---|---|---|---|---|---|
| 0.26 MB | 2.1.312 | 0.26 / 0.51 s | 0.31 s | 0.26 / 0.26 s | 0.26 s |
| 0.26 MB | 2.1.322 | 0.26 / 0.26 s | 0.28 s | 0.26 / 0.26 s | 0.22 s |
| 1.17 MB | 2.1.312 | 0.51 / 0.77 s | 0.56 s | 0.26 / 0.26 s | 0.26 s |
| 1.17 MB | 2.1.322 | 0.76 / 0.77 s | 0.63 s | 0.26 / 0.26 s | 0.27 s |
| 5.25 MB | 2.1.312 | 1.78 / 1.78 s | 1.75 s | 0.26 / 0.26 s | 0.26 s |
| 5.25 MB | 2.1.322 | 1.78 / 1.78 s | 1.76 s | 0.26 / 0.26 s | 0.27 s |

**A fresh start does not grow with the old transcript; a resume grows about linearly, under 2 s at 5 MB.** These are
the binary's own times against a local mock: no network, no tool-server start, no ccd unit start and no stop of the
old process are in them. The roll's overhead on the fleet (a `hibernate` act to the next `claude-session@` start) is
W0b's read (Task 8), and it decides the row: **outcome so far, the fresh start adds well under a second to whatever
the roll costs, so unless W0b measures the roll's overhead above 59 s at p95, the deadlines stand** (`clearing` 90 s,
`carded` 45 s, the 360 s budget).

**W0-08, what `/clear` and a fresh start do to work in flight (rig, both builds, identical).** `ov-clear-effects`
started, in one main turn, a reader (`Agent`, `model: sonnet`, whose request the mock held for 100 s), a background
shell (`sleep 90`), a session cron and a durable cron (`CronCreate` every minute, `durable` false and true), then a
20-second main turn during which `w0 queued` was typed, then `/clear`. `ov-clear-effects-fresh` is the same with a
fresh relaunch in place of `/clear`.

| In flight | After `/clear` | After a fresh start |
|---|---|---|
| The reader | **Survives**: its SubagentStop fired about 100 s after it started, after the clear, and **its result was delivered into the new conversation** | Killed: no SubagentStop, and its result reached no request |
| The background shell | Its completion reached no request, in either conversation | Gone with the process |
| Text typed during the running turn | Ran in the **old** conversation, after that turn and before the clear | Lost: never sent |
| The session cron | **Survives**: fired three times into the new conversation | Gone |
| The durable cron (`durable: true`; the documentation puts it in `.claude/scheduled_tasks.json`, which no snapshot read) | **Survives**: fired three times | **Survives**: fired three times into the fresh session |

**Outcome: the drain wait and the fence are load-bearing, as designed** (a reader that survives a clear reports into
the new conversation). **Crons survive both a clear and a fresh start** (the durable one), so the Overlord's profile
denies the cron tools (`CronCreate`, `CronList`, `CronDelete`; or `CLAUDE_CODE_DISABLE_CRON=1`), H1 amended. Queued
input is not carried across a clear (it runs before it), so the delivery lane's hold during `clearing` stays as
designed, and a fresh start loses it outright.

**W0-13, a PreCompact refusal of a proactive compaction (rig, both builds, identical).** `ov-precompact`: the refuser
(exit code 2 on `trigger: auto`) on PreCompact, the window lowered to 100,000 and the mock reporting 150,000 input
tokens, for seven turns. Each turn from the second on began with one PreCompact `auto`, refused, and then ran
uncompacted to a reply (the conversation grew by one exchange a turn). Seven refusals in all (turns 2 to 7 and one
continuation), one a turn, never two. At the window's end (emulated, from the API's stop-reason page): a reply with
`stop_reason: model_context_window_exceeded` was treated as an output-limit stop and continued once on its own ("Output
token limit hit. Resume directly"); an HTTP 400 `invalid_request_error`, "prompt is too long", ended that turn with
StopFailure `invalid_request`, and no recovery compaction was attempted. The session was not stuck: a manual `/compact`
under the same hook passed (PreCompact `manual`, passed), compacted and answered the next prompt. **Outcome: honoured,
turn intact, asked again at every turn's start, so the arm refuses once and lets the next through (the soft budget),
not armed to refuse forever.**

**W0-14, the auto-compact window and idle compaction per session (rig, both builds, identical).** The window: set per
session by `CLAUDE_CODE_AUTO_COMPACT_WINDOW` at launch, it took effect (W0-05 and W0-13 drove proactive compactions at
100,000). Idle compaction: `ov-idle-on` (`idleCompaction: true`) and `ov-idle-off` (`false`) each answered one prompt
reporting 150,000 input tokens of a 1,000,000 window, then stayed idle 65 minutes (3,900 s, timed). **Neither arm, on
either build, compacted**: no PreCompact, no summarising request, and the next prompt went out with the whole history.
With the switch on, nothing fired either, so the rig cannot show the switch working. The arms kept the 1,000,000-token
window, 15% full; a lowered window, which the rig allows and W0-05 and W0-13 used, was not tried. The idle trigger may
need a fuller window, a longer idle, or real usage figures (D-5373's fleet measurement saw it at about 55 minutes on
real sessions). **Outcome: inconclusive for the idle switch, which selects the conservative branch: the 45-minute idle
renewal trigger is load-bearing, and W1a pins it** (renew before Claude Code's own idle compaction can fire), while the
profile still sets `idleCompaction: false`. (The four idle runs ended `rc=2` after their bundles were written: the rig
script was edited during the run and bash read past its end. The bundles are complete, but they came from a rig script
that changed while it ran.)

## The launch profile (Task 6: W0-09 to W0-12, W0-15 to W0-19), measured 2026-11-11

**W0-09, auto memory (rig, both builds, identical).** `ov-memory` put a canary in the fixture config's project memory
(`projects/<project>/memory/MEMORY.md`), and a different canary in the second config that `swapConfig` makes; the
session was resumed on the second config. With the switch at its default, the first canary reached the first request,
and after the swap the second config's canary was injected anew (as a user-turn reminder, not in the system prompt),
beside the first, which the resumed history still carried. `ov-memory-off`, the same with
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` at launch: **no canary reached any request, before or after the swap.**
**Outcome: off by a launch setting, so it is the profile's column** (H14 stands: one env name per session, no account
setting needed). A swap loads the new account's project memory unless the switch is off, which is why H14 turns it off
for every role. The fleet census (non-empty memory directories per account) is W0b's.

**W0-10, forks, agent view and agent teams (rig, both builds, identical).** `ov-forks` launched with both
`CLAUDE_CODE_FORK_SUBAGENT=0` and `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, in one run, and compared its first request with a
default launch (`ov-sources`). The tool list was the same 13 names, `ListAgents` among them, but the `Agent` tool
changed: its description no longer mentions forks, and its schema regains `run_in_background`, which the default
launch does not offer. One `--resume … --fork-session` relaunch, under both switches, still worked and reported
`fork`: the switches do not govern a resume fork. What the run does not show: which switch moved which part of the
`Agent` tool (they were set together); agent view's own effect (no call exercised it); a fork relaunch under each
switch alone (the plan asked for one under each); and the agent-teams switch, which was never set (no team tool is
offered in either launch, the default). **Outcome: the two switches, set together, hold, so they are the profile's
column**; a resume fork is a separate act, and the fork refusal line (keyed on `fork`, W0-02) is its guard.

**W0-11, the subagent model against a call that names another (rig, both builds, identical).** `ov-subagent-model`:
`CLAUDE_CODE_SUBAGENT_MODEL=sonnet` and an `--agents` reader defined with `model: sonnet`; the mock made four Agent
calls in one turn (a general-purpose and a reader call each naming `opus`, and each naming no model). The two calls
naming `opus` carried `model: opus` in their PreToolUse payload and **ran on Opus** (the sub request's `model`): neither
the env nor the reader's definition held against a per-call model, as the documentation's order says. The two naming no
model never ran: ccrc's own hook refused them (D-6798, "this Agent call names no model"). `ov-subagent-model-force`, the
same with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and the setting sources pinned (`project,local`, its grants in a
`--settings` file, so ccrc's hook is not loaded): **all four calls ran on Sonnet.** `ov-subagent-model-force-hook`, the
same with FORCE and the default sources, so ccrc's hook is loaded: **all four PreToolUse payloads carried no `model`**,
the two that named `opus` included, ccrc's hook refused all four with its D-6798 reason, and no subagent started. The
refusals came back in two shapes: the two calls that named `opus` as the bare reason ("ccrc: this Agent call names no
model…"), the two that named none as "PreToolUse:Agent hook error: ccrc: …", the shape the control's two refused calls
take too; which path in Claude Code makes the difference is not measured. **Outcome: a pin holds,
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, so the profile uses it** (C55 stands; no PreToolUse arm is needed for the model).
**A conflict found:** under FORCE the payload's `tool_input` reaches PreToolUse without `model`, so ccrc's D-6798 arm
refuses every Agent call in such a session (proposal 1, last section).

**W0-12, a typed `/model` and the flagged-request switch (rig, both builds, identical; the refusal emulated).**
`ov-model-switch` registered `PreModelSwitch` and `PostModelSwitch` emitters and a statusline capture, with
`switchModelsOnFlag: true`:
- A typed `/model sonnet` after the first exchange opened a **"Switch model?" dialog** ("This conversation is cached for
  the current model…", options "Yes, switch" and "No, go back"), which the next typed line answered. The switch then
  fired `PreModelSwitch` and `PostModelSwitch`, **both carrying `from_model` and `to_model`**, and printed "saved as
  your default for new sessions": a typed `/model` writes the account's settings, as D-2808 found for `/effort`.
- `/model fable` switched with no dialog and the same two hooks.
- The mock answered the Fable request with `stop_reason: refusal` (emulated from the API's stop-reason page; the mock
  sent no `stop_details` object, which the documented shape carries). Claude Code printed "Fable 5.x's safeguards
  stopped the response above · continuing once with that noted" and **re-ran on the same Fable model**: no model switch,
  no switch hook, no dialog; the statusline's `model.id` stayed Fable, and so did the next turn.

**Outcome:** a hook payload names the model for a typed switch, so the hook arm journals it (Table 3.6a). For Claude
Code's own switch on a flagged request the rig is **inconclusive**: with this emulated shape no switch happened, and the
missing `stop_details` may be why, so which hook or row would report a real one is unmeasured. That selects the
conservative branch, the statusline writer journals a model change too, and the fleet's history counts the real notices
(W0b). The dialog on a typed `/model` mid-conversation is a new fact for everything that types `/model` today (Table
1.2a lists it among ccrc's typed strings), recorded in the last section.

**W0-19, what an account's config directory loads (rig, both builds, identical).** `ov-config-load` gave the fixture
config a user `CLAUDE.md`, a skill (`skills/`), an agent (`agents/`), a user-scope tool server (`mcpServers` in its
`.claude.json`, the door stub) and a settings key, and launched it twice:

| Kind in the account config | Default sources | `--setting-sources project,local` |
|---|---|---|
| User memory file (`CLAUDE.md`) | loaded (canary in the first request) | **not loaded** |
| Skill | listed | **not listed** |
| Agent | listed | **not listed** |
| Tool server (`.claude.json` `mcpServers`) | started (the stub logged its calls) and named in the request | **not started** |
| Settings (`settings.json`: hooks, grants) | loaded (ccrc's hook captured four events) | **not loaded**: ccrc's own hook did not run at all |
| Plugin | not built: a plugin needs a marketplace install the fixture does not have | unmeasured |

**Outcome: pinning excludes every kind measured, as designed** (H1). Plugins (mods) are unmeasured by the rig, so
doctor's no-mods check stays required before designation, and the fleet census of `plugins/` is W0b's. **One
consequence the profile must carry:** pinned sources drop ccrc's own hook with the account settings, so the profile
registers the hook itself, through `--settings` (W0-15 measures that it then fires). Without it a pinned session runs
with no ccrc hook at all.

**W0-17, peer messaging (rig half, both builds, identical; the inbox socket by documentation only, D-8206).**
`ov-peer` set only `crossSessionInbound: refuse`: the first request still offered `ListAgents`, and a ToolSearch for
`SendMessage`, `ListAgents` and `TeamCreate` loaded the first two (no team tool exists with teams off). **The inbound
switch alone does not take the peer tools away**; the deny rules do or do not, which `ov-door` measures under the whole
profile. The documentation names `crossSessionInbound` (`accept`, `hold`, `refuse`) for inbound messages and
`--remote-control`/`remoteControlAtStartup` for Remote Control, and describes no interface a local process may use to
put a message into a session's inbox. **Outcome on the socket: no documented interface, so today's delivery stays**
(H2); the Later item's trigger is not met.

**W0-15, the door process under the restricted launch (rig, both builds, identical).** `ov-door` launched the
profile as H1 states it: `--setting-sources project`; a `--settings` profile file carrying ccrc's own hook on its
twelve events and a SessionStart anchor emitter of 1,500 characters, auto memory and idle compaction off,
`crossSessionInbound: refuse`, `switchModelsOnFlag: true`, workflows off, `defaultMode: bypassPermissions` and deny
rules for `Bash`, `Edit`, `Write`, `WebFetch`, `WebSearch`, `SendMessage`, `ListAgents` and `Workflow`;
`--strict-mcp-config` with the door stub as its one tool server; `--tools Agent,Skill`; a reader in `--agents`;
`--permission-mode bypassPermissions`; the fork, agent-view, auto-memory and subagent-model env names; `DOOR_NONCE`
in the launch env; one project skill, and one account-level skill that must not load.

| H4 property | Measured |
|---|---|
| Tools offered to the main thread | `Agent`, `Skill`, `mcp__door__card`, `mcp__door__read`, `mcp__door__act`: no shell, no editor, no web tool, no workflow, no peer tool |
| Hooks | ccrc's hook fired from the profile file (SessionStart, UserPromptSubmit, PreToolUse and PostToolUse on every call, SubagentStart, SubagentStop, Stop, SessionEnd), though the account settings were not loaded |
| The anchor | the 1,500-character emitter's text arrived whole (both canaries) in the first request |
| Skills | the project skill listed; the account-level skill not |
| Permission mode | `bypassPermissions` in every hook payload; the pane showed "bypass permissions on" |
| Door calls | `card` and `read` from the main thread, `read` and `act` from the reader, every one served with no prompt (the stub logged each) |
| `Bash` refused | a main-thread `Bash` call and a reader `Bash` call both answered "No such tool available: Bash. Bash is disabled for this session, in subagents as well as here". The deny rules and `--tools Agent,Skill` were set in the same launch, so which of the two removed it is not attributed |
| The nonce | `present` on every door call: the door process inherits the launch env |
| First launch on a fresh account config | **a bypass acceptance dialog** ("WARNING: Claude Code running in Bypass Permissions mode", default "No, exit") came first; the run accepted it by key |

**Outcome: all hold, as designed; the door process stands, and the §3.6 fallback is not selected.** Two facts the
profile must carry: it registers ccrc's hook itself (W0-19), and a fresh account config needs the bypass acceptance
recorded before an unattended start, or the start stops at that dialog (the fleet's configs have accepted it already;
a new account would not have).

**W0-16, readers with no shell (rig, both builds, identical).** In `ov-door` the `--agents` reader resolved by its
type, ran on Sonnet, and was offered exactly the tools its definition listed that the profile allows
(`mcp__door__read`, `mcp__door__act`); `Bash`, also in its definition, was not offered (the session's deny rules and
`--tools` were both set, so which removed it is not attributed).
SubagentStart carries `agent_id` and `agent_type`; SubagentStop adds `permission_mode`, `effort`,
`agent_transcript_path`, `last_assistant_message` and `background_tasks`; and **each PreToolUse inside the reader
carries `agent_id` and `agent_type: w0-reader`**, absent on the main thread's. The reader's `act` call was served:
a reader is limited only by its definition's tool list. **Outcome: the scope arm keys on PreToolUse's `agent_type`**,
and refuses any door but the read door from a reader whose type is a reader type, as designed (C55).

**W0-17, completed.** Under the whole profile `ListAgents` and `SendMessage` are not offered, and `ToolSearch`, which
loads deferred tools, is not offered either. Both `--tools Agent,Skill` and the deny rules, which name both peer tools,
were set, so which of the two closed them is not attributed. So **the profile closes the peer tools; W1's sandbox check
verifies that both are present**, and nothing blocks W1. The inbound switch alone (`ov-peer`) does not remove them.

**W0-18, the statusline's fields and its idle cadence (rig, both builds, identical; binary).** `ov-statusline` ran
`statusline-capture.mjs` as the status line, the mock sending usage figures and the unified rate-limit headers
(`5h-utilization` 0.42, `7d-utilization` 0.17, with resets), then ten idle minutes. The payload carries
`context_window.total_input_tokens` (input plus cache read plus cache creation: 50,000 + 20,000 + 1,000 rendered as
71,000), `total_output_tokens`, `context_window_size` (1,000,000 for this model), `used_percentage` and
`remaining_percentage` (7 and 93), `current_usage.*` per kind, `exceeds_200k_tokens`, `model.id`, `cost.*` and
`prompt_cache.*`. **No `rate_limits` field appeared** although the headers were sent. Why is a reading, not a
measurement: the rig bills by API key, and the documentation lists `rate_limits.five_hour` and `.seven_day`, which a
subscription sign-in may fill; the rig cannot sign in. **Four renders in each run, and none in the ten idle
minutes** (a 601 s gap): without `refreshInterval` the status line renders only on events. The builds read no
per-model weekly header (Task 1's binary read). **Outcome:** the token and window fields are present, so **the
sidecar gains `total_input_tokens` and `context_window_size` in W1a** (Table 3.3.11b's hard cap reads them, not a
percentage); no idle renders, so a stale sample is unmeasured, as designed (or the profile sets `refreshInterval`,
proposal below); no per-model figure, so W0-24 compares against `/usage` only.

## The first model, re-run on the merged edition (Task 7: W0-27), 2026-11-11

The research model (`docs/superpowers/research/2026-11-10-overlord-model-check/`) was run as it is, with nothing in it
changed (model). Python 3, standard library only, on the fleet box, load about 8 on 16 cores.

**Round one** (`check.py --matrix`, 243 s; `check.py --mutations`, 136 s). At the defaults (the safe readings, which
are the sentences `REPORT.md` proposed and the spec's later editions wrote in) **every scenario holds every invariant
(I1 to I10, D1 to D3, X1 to X5) and ends under the bound of 3,000,000 states**:

| Scenario | States | Transitions | Violated |
|---|---|---|---|
| core | 94,966 | 345,638 | none |
| push | 8,746 | 29,492 | none |
| pause | 7,465 | 25,271 | none |
| race | 1,888 | 6,831 | none |
| renewal | 508,800 | 1,778,920 | none |
| asks | 4,304 | 14,394 | none |
| grants | 134,691 | 462,582 | none |
| value | 264 | 709 | none |
| lineage | 424 | 977 | none |
| nohold | 35,684 | 148,271 | none |
| deadpush | 812 | 2,287 | none |
| restore | 4,563 | 13,002 | none |
| genmachine | 674,982 | 2,214,248 | none |
| rebind | 40,745 | 119,611 | none |
| readiness | 336,549 | 1,292,292 | none |

The largest, `genmachine`, is about a fifth of the bound, so no scenario was cut. The matrix's other 32 rows, 29 that
flip one switch to the reading the text had left open and 3 combinations, each break what `REPORT.md` says they
break, and the whole matrix matches the committed `matrix.out` line for line. **Mutations:** the 12 an invariant
should catch are each caught by that invariant (`restart_extends_deadline` I1, `reach_without_outbox` I2,
`no_reach_guard` I2, `sweep_raw_clock` I1, `item_answer_no_act_row` I3, `no_fence` I5, `staged_no_fence_recheck` I5,
`staged_no_grant_recheck` I4, `mayhold_ignores_readiness` I9, `no_operator_has_it` X2, `no_restore_detection` I7,
`held_rows_hidden` I10), and the 2 marked "none expected" (`renewing_keeps_all`, `no_natural_key`) are not caught;
identical to the committed `mutations.out`.

**The switches against the merged edition (Step 1).** Each default is the spec's reading; the sentence that settles
each is in the merged edition: A1 and A2 (one transaction for the outcome, the reach stamp and the outbox row; stamped
at most once) §6.7 and I2 in §11.7; A3 and A4 (the `pending` write ends the hold and moves the revision) §6.7's
revisions; A5 (a `refused` answer) §3.7's outcome words; A6 (a stale operator tap) §6.7, which chose the
correction-at-the-current-revision reading the REPORT allowed; A7 (the card door skips steps 3, 4, 6, 8 and 9) §11.2;
A8 (open holds never trimmed from the card) §3.3.3; A9 (pause releases each hold in one grouped push) §3.4's
`stranded` rows and §6.7; A10 (staging writes the reach stamp) §7.2; A11 (`operator-has-it`, doors after the boot
pass) §6.4 and §11.2; A12 (a silent outbox row) and A13 (retry with backoff while running) §6.7; A14 (a start while
the server is down) and A15, A16 (a failed renewal returns to the state it left; `checkpointed` times out to `clearing`
without the note) §3.3.11; A17 (`unproved`) §6.4; A18 (only `unknown` removed, by a re-raise) §6.7; A19
(`state-a-fact` rests on an operator message) §6.7 and §7.1; A20 (`unmeasured` at boot keeps standing holds) §6.7;
A21 (I9's scope) §11.7; A22 (a narrowing is done once a witness holds it) §7.6; A23 (I1 and I2's wording) §11.7; A24
(`degraded` is chat only) §3.3.11 and §6.4. **No default disagrees with the merged edition**, so no switch needed a
second run beyond the matrix, which runs every one both ways.

**Round two** (`round-two/check.py --matrix` and `--mutations`): every check holds under the safe readings, and **all
40 mutations are caught**; identical to the committed outputs. **Round three, accounts and privacy, and round four,
oversight** (each `check.py --matrix` and `--mutations`): identical to their committed outputs.

**Round three, the deciders, on the merged edition** (`OVERLORD_SPEC` set to the spec file, `./run_all.sh`; its
outputs were written to scratch and the committed `out/` left as it was). **Fourteen anchors stop**: each check reads
the spec by quoting a sentence, and the later editions reworded these. For each, the merged edition's sentence keeps
the rule, refined: the grants door (§7.2, "and `DELETE` to revoke" dropped); Pause (§7.5, extended: it "stays `off`
where it was"); the five-hour figure (§3.4, now "while anything is left of the reserve in the seven-day window");
`glanced` (§6.6, now "any other answer, a tap from a push and a bulk Seen included"); the unreadable child mark
(§3.3.9, widened to "a child mark that could not be measured"); Figure 2's timeout edge (now split, "from active:
back, with a hold-off" and "from degraded: back to degraded", which settles the committed `GEN-back` counterexample);
Figure 6's decision node (redrawn: d11's figure-against-prose check did not run on this edition); readiness `dead`
(§6.4, now with the restart time); the blind check's "unarmed" sentence (§7.2, reworded); `hands-off` follow-up
(§5.4, extended); `voided` (§10.1, reworded); the disagreement bound (§11.5's weights changed it from 0.14 to
0.05); `blocking-now` (§4.2, extended); a `decide` item of class `unknown` (§6.7, "whose whole class is
`unknown`"). A stopped check runs none of its later rules, so **the deciders' re-check on the merged edition is
incomplete**: the anchors must be re-pointed before the deciders mean anything for this edition, which the simulator
piece does when it moves the model (proposal, last section). The checks that did run report, on the merged edition:
`ACT-off` (also in the committed output); `REQ-figure`, new with the proposed edits ("Figure 3 draws `needs-you` to
`done`; Table 5.1b gives no actor that move"); and seven `VOC-refusal` words the vocabulary scan reads as refusals
with no row in Table 11.6 (`active`, `direction`, `examined`, `failed`, `lambda`, `opus`, `reversible`), most of them
new text the scan misreads. None is a model violation; they are text-consistency findings, listed for the
coordinator below.

**What the model leaves out** (`REPORT.md`, its last section): one or two questions, two to four ticks, at most one
server crash where holds stand and one session crash; the breaker never reaches its half-open trial; admission is
earliest deadline first only; the ladder is the operator's rung and two latches; one grant, with no shadow, expiry or
blind check; commands, requests, mail delivery, `unwitnessed`, egress, the policy port, the privacy journal and
`diverged` rows are not modelled; liveness is a path on the bounded graph, not fairness; and it is one reading of a
long text.

**Outcome (W0-27): no violation; the machines compose as specified** on the merged edition, within what the model
covers. The deciders' anchors are a maintenance debt, not a contradiction.

## Rows waiting for W0b

W0-20 (nudge-and-read against typed text), W0-21 (a swap with a stand-in renewal), W0-22 (a continuity record per
lane: its client side is W0-01, W0-02, W0-15 and W0-16 above, for 2.1.312 and 2.1.322), W0-23 (billing per account),
W0-24 (the Fable proxy's error), W0-26 (restarts per session-hour and the restart time; its read half is above) and
W0-28 (the replay baseline) wait for the operator's setup item (programme item 155) and W0b. So do the fleet halves of
W0-06 (the roll's overhead), W0-09 and W0-19 (the account config census) and W0-12 (real fallback notices in the
history).

## Departures from the plan (for the coordinator to number)

Each is named by a plain-words slug; the coordinator issues its number and defines it in the index plan.

- **w0a-rig-tooling-beyond-the-named-files, method.** Tasks 5 and 6 needed rig features the plan's Task 2 did not
  list: the mock's `pad` and `chunk_chars` (a measured transcript size without a megabyte scenario file),
  `launch.files`' `cfg2` targets and `@RIG_PROJECT@` path placeholder (project memory per config), a `paneSnap` verb (a
  dialog's text), the emitter's `--tag`, `--tag-source` and `--log-payload`, and `sessionsSnap`'s transcript sizes.
  `timing` lines go to the bundle's own `timing` file, not `notes`, because `notes` is the failure-and-outcome channel
  `build-matrix.mjs` reads (the delegation suite's notes census went red when they shared it). Fix round 1 added a
  scenario's `mainMarker`, `RIG_LAUNCH_BARE_FLAGS` and `run_opts`. **Tests:** the `check-scenario` rules, the stubs,
  the mock's padding, `print-launch`'s line and `cmd_setup`'s files had tests from the first round. The run-time verbs
  (the `timing` file, `paneSnap`, `sessionsSnap`'s sizes, `cfg2` at `swapConfig`, the three `relaunch` forms) and
  `collect`'s copies had none; fix round 1 added them, run from `rig.sh`'s own text with tmux stubbed, so for those the
  test came after the code, and a mutation of each turns its test red. **Untested,** because they act only in a real
  launch: `cmd_run` starting the mock with `MOCK_REQDIR` when `requests: true`, and the `logs/` directory it makes for a
  scenario with a launch block. No delegation scenario's behaviour changed.
- **w0a-scenario-arms-split, method.** A run has one environment and one settings file, so `ov-memory` and
  `ov-config-load` are two files each (an `-off` or `-pinned` arm), and `ov-subagent-model` three (`-force`, and
  `-force-hook`, FORCE with ccrc's hook loaded, W0-11). `ov-forks` goes the other way: one run sets both the fork and
  the agent-view switch, never sets the agent-teams switch, and makes one fork relaunch under both, where the plan asked
  for one under each (W0-10 says what that leaves unmeasured). The renewal timing runs ten resumes and then ten fresh
  starts, not alternating: a fresh start would make the next resume pick the fresh session. The idle arms seed 150,000
  tokens of reported usage so an idle compaction has something to compact. **Commits:** Tasks 5 and 6 share one commit
  (their tooling interleaves in the same three files), and Task 5's long-run results (W0-06, W0-14) landed in Task 7's
  commit, after those runs ended; the pull request is squash-merged.
- **w0a-force-arm-pins-sources, method.** ccrc's own hook (D-6798) refuses every Agent call under
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, so the force arm, `ov-subagent-model-force`, pins its setting sources to
  `project,local` (its grants in a `--settings` file) to measure the model at all. The refusal is a row of its own,
  measured from a committed scenario: `ov-subagent-model-force-hook`, the same arm with the default sources and so with
  ccrc's hook loaded (W0-11; proposal 1).

## Proposals the outcomes select (for the coordinator; the design is not edited)

1. **The D-6798 arm and FORCE (W0-11).** Under `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` the PreToolUse payload carries no
   `model`, even for a call that named one, so ccrc's no-model arm refuses every Agent call
   (`ov-subagent-model-force-hook`, both builds). W1's launch profile sets FORCE, so ccrc's D-6798 arm must not apply
   to such a session: W1 exempts a session whose profile pins FORCE from that arm (by its role), or has the arm read the
   pin; otherwise the Overlord cannot start a reader.
2. **An automatic compaction is read by PreCompact `auto` (W0-05).** Under the rig an automatic compaction sent no
   summarising request and fired no SessionStart `compact`. Until a real one is measured, W1a reads an automatic
   compaction by PreCompact `auto` (and the anchor's re-injection does not wait on SessionStart `compact`).
3. **The profile denies the cron tools (W0-08).** Session crons survive `/clear`, and durable ones a fresh start, so H1
   gains `CronCreate`, `CronList` and `CronDelete` in the deny set (or `CLAUDE_CODE_DISABLE_CRON=1`).
4. **The profile registers ccrc's hook (W0-19, W0-15).** Pinned sources drop the account settings and with them ccrc's
   hook; the profile's `--settings` file carries the hook registration, and the sandbox check verifies the hook fired.
5. **Record the bypass acceptance before an unattended start (W0-15).** A fresh account config stops at the bypass
   acceptance dialog (default "No, exit"). Designation's precondition, or the profile, records the acceptance.
6. **A typed `/model` opens a dialog (W0-12).** Mid-conversation it asks "Switch model?" and saves the model as the
   account's default. The design already sends no `/model` to the Overlord; what types `/model` today (Table 1.2a)
   meets this dialog, which readiness's `dialog-open` covers. A follow-up issue for today's lanes, not W0.
7. **The scope arm keys on `agent_type` (W0-16).** A reader whose definition lists the act door may call it; the arm
   refuses any door but the read door when PreToolUse's `agent_type` is a reader type.
8. **The sidecar gains the token count and the window size (W0-18)**, `total_input_tokens` and `context_window_size`,
   in W1a; the profile may set `refreshInterval` if a fresh sample during long idle matters.
9. **Re-point the deciders' anchors (W0-27)** when the simulator piece moves the model: 14 anchored sentences were
   reworded by later editions, so those checks did not run on this edition. Two text findings from the checks that
   did run: Figure 3 draws `needs-you` to `done` with no actor in Table 5.1b, and the note door at `off` (Table 7.1a
   has no cell for it).
10. **The uuid comments (W0-05).** The attribution comment in `server/src/coord/routes.ts` and the socket header in
    `server/src/sessionws.ts` say a compaction rotates the uuid; a manual compaction does not, and a real automatic one
    is unmeasured (W0-05). A follow-up issue, not W0.
