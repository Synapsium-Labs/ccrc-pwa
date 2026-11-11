# Overlord W0, the spike: results

> The measured answers of the Overlord's W0 spike (plan `docs/superpowers/plans/2026-11-10-overlord/w0-spike.md`,
> spec `docs/superpowers/specs/2026-11-09-overlord-design.md`). W0a (run 1774) measured rows W0-00 to W0-19 and
> W0-27. Rows W0-20 to W0-26 and W0-28 wait for W0b and the operator's setup item; where W0a read a half of one, the
> read half is here and the rest is marked as waiting.
>
> Every row says which kind of result it is: **doc** (read in Claude Code's documentation), **tree** (read in this
> repository), **binary** (read from an installed build's strings), **rig** (what Claude Code sent to the mock API,
> on a named build; never whether a real model heeded it), **box** (a box-token read of the live server), **model**
> (the research model), or **emulated** (the mock sent a shape the documentation names). A rig result holds for the
> build it ran on.

## In short

To be written when the rows are complete (Task 12).

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
`health.clearError`. Every wave of every programme on this server opened as a fresh dispatch (one run per wave), so the
typed `/clear` fast path has never run here. **Outcome: unmeasured, which selects "fresh start only"** (H13):
coordinators renew by a fresh start too, until a measurement exists.

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

With the corpus's `clear` and `resume` (Task 1), every documented source is measured. **Outcome: a fork reports a
word of its own, `fork`, so the refusal line keys on it** (not on the transcript's continued-in pointer), and no
source drops its context, so the card needs no nudge for any source. A fresh start reports `startup`: the anchor
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
