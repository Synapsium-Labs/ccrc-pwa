# Overlord W0, the spike: what the design depends on, measured. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to carry out this plan task by task.
> Steps use checkbox (`- [ ]`) syntax for tracking. This wave measures. It changes no code that runs: it adds test
> tooling, scenarios, one model, a results note and the spec's as-measured lines.

> **Execution status:** Draft, written from the hardened spec edition (rev 8 plus H1 to H39) at the branch point of
> the spec's own branch. It waits for the operator's approval. Tasks 1 to 7 need no operator setup and may run as one
> worker run (W0a). Tasks 8 to 11 wait for the operator's setup item (W0b). Task 12 closes both.

**Goal:** Measure, on the installed Claude Code builds and on the fleet, every platform fact and every starting number
the Overlord design rests on, so that W1a and W1 build on measured behaviour. Re-run the first model of holds,
readiness, generations and restarts on the merged edition (§11.7, Table 11.7b). Take or schedule the replay quiz's
baseline.

**Why:** The design leans on many facts about Claude Code and the fleet that nobody has measured on today's builds: how
much hook text reaches the context, whether a compaction changes the session's id, what a `/clear` or a fresh start
does to running subagents and scheduled tasks, whether the launch switches the Overlord needs exist and hold, whether a
door process can serve typed tools under a restricted launch, how the account proxies compare with Claude Code's own
figures. Several of the spec's starting numbers (the renewal deadlines, the restart bound, the soft budget) are guesses
until measured. W0 measures each one, records the build it held on, and names the design choice each outcome selects.
It reuses the delegation broker's capture rig rather than writing a second harness, because that rig already drives
the real binary against a mock with ccrc's own hook installed.

**Architecture:** Three instruments, all of which exist today or extend one that does:
- **The rig.** `server/test/delegation-rig/` already runs an installed Claude Code binary against a scripted mock of
  the Messages API, in a private tmux server and a fixture HOME, with ccrc's own hook in a `-hookcap` session. It sees
  every request Claude Code sends, so it answers "did this text reach the context" exactly, with no account and no
  spend. W0 teaches it a launch profile (Task 2) and a few stubs (Task 3), and runs new scenarios (Tasks 4 to 6).
- **Read-only fleet reads**, under the operator's consent: the existing instruments and the box-token reads (Task 8).
- **A subject**: one scratch session on scratch accounts, driven by mail, for what only a real model or a real swap
  can show (Task 9). The operator supplies the setup, the account facts and a few console acts (Tasks 9 to 11).

**Tech Stack:** bash and jq (`rig.sh`), Node with no new dependency (stubs), `python3` for the model (standard library
only), vitest for the tests, `python3 -I` importing `deploy/measure-working-state.py`'s readers, `ccrc-api` reads,
`ccrc history` read verbs.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`, hardened edition: §14 and Table 14's W0 row; §1.2
(the platform rows); §3.2 C2; §3.3 (Claude Code facts); §3.3.3 C38; §3.3.4 C39; §3.3.7 C44 and H14; §3.3.9 C52;
§3.3.10 C55; §3.3.11 H12 and H13; §3.4 H16, C46, C56 and C57; §3.5; §3.6 H1, H2 and H4; §3.8 (delivery); §6.4
(the starting numbers); Table 11.5b; §11.7 (H33).

## What exists today

| Piece | Today | Where |
|---|---|---|
| The capture rig | Runs one installed binary against `mockapi.mjs` in a private `dlg*` tmux server and a fixture HOME; Linux only (`claude_pid` and `procs_under` read `/proc`); verbs `waitReady type keys waitLabels probeLabels answerDialog sleep kill9 swapConfig relaunch snapshot` in `VERBS`, a single-quoted string; `check_scenario` needs `steps` and `entries` arrays, refuses an unknown verb and ignores every other top-level key; `relaunch` always passes `--resume <sid>`, the sid read from the newest main-thread capture (`current_sid`); launch flags and env are fixed in `launch_cmd`, whose `timeout` wraps each launch at `RUN_CAP_S=1200`; settings fixed in `cmd_setup`; tools granted by `permissions.allow`, never a permission bypass; the usage text is the header, printed by `sed -n '2,23p'`. `MOCK_REQDIR` exists in the mock (it dumps each request as `NNNN-<main\|sub\|side>.json` holding `{n, url, kind, picked, body}`, and never makes the directory) but the rig never sets it | `server/test/delegation-rig/rig.sh` (`launch_cmd`, `check_scenario`, `run_steps`, `collect`, `cmd_run`), `mockapi.mjs`; tests in `server/test/delegation-rig.test.ts`, whose helpers (`rigsh`, `versionsHome`) are not exported |
| The rig's corpus | Sanitised captures per build, 2.1.280 to 2.1.319 (21 builds); `clear-compact-resume.json` and `swap-resume.json` hold SessionStart `startup`, `clear` and `resume`, and no `compact` (the capture arm leaves it out) | `server/test/delegation-rig/scenarios/`, `server/test/fixtures/delegation/` |
| The hook's capture arm | A session whose ccd id ends `-hookcap` writes every hook payload to `~/.ccrc/hook-capture/<id>/<event>-<epoch ms>-<pid>.cap`, except SessionStart `compact`, and stops at 200 files; the reducer prints key paths and types only | `ccd/session-hook.sh` (the capture arm), `deploy/hook-capture-reduce.mjs` |
| The hook's emitter | One JSON line; slots 2,400 + 1 + 4,000 + 1 + 2,048 = 8,450 characters | `ccd/session-hook.sh#_hook_emit_context`, `CARD_MAX_CHARS`, `COMPACT_CARD_MAX_CHARS`, `CARD_TOTAL_MAX_CHARS`, `ROSTER_CARD_MAX_CHARS`; pinned by `server/test/session-hook.test.ts` ("the two clip ceilings stay under the harness context-spill budget (I2b, spec:189)": 10,000, read from 2.1.266's binary) |
| The role card | Tells every session that is not a child it is a coordinator | `ccd/session-hook.sh#_hook_role_card` |
| The uuid dispute | `_sync_uuid`'s header says a compaction keeps its transcript; the attribution comment in `server/src/coord/routes.ts` and the rotation comments in `server/src/sessionws.ts` say a compaction rotates | `ccd/ccd#_sync_uuid` |
| The roll | `ccd hibernate --roll <id>`: stop, then wake by resume; capability word `hibernate-roll`. A fresh-start flag does not exist today | `ccd/ccd#cmd_hibernate`, `ccd/ccd#cmd_caps` |
| The `/clear` fast path | The dispatch lane types `/clear` through the `sendClear` port; each run records `resumed`, `clearedAt` and `health.clearError` | `server/src/coord/dispatch.ts` (`ClearResult`, `DispatchRunDeps.sendClear`); `RunSummary` and `RunHealth` in `shared/api.ts`; read by `ccrc-api runs list --closed 1` |
| Sleep holds | `background`, `scheduled` and `menu` hold a hibernation | `server/src/coord/hibernate.ts` |
| The statusline sidecar | Writes `ts, uuid, account, model, effort, ctxPct, cost, agent`. No token count, no window size | `ccd/statusline-command.sh` |
| The Fable share | `_share_pct` reads `perAccount.<id>.fableShare.estimate` (a fraction of priced weekly usage) beside `sevenPct`; `_serviceable` refuses Fable at `FABLE_SHARE_CEILING_PCT=40` | `ccd/ccd#_share_pct`, `#_serviceable`, `ccd/ccd-usage-sweep.py` |
| The account pick | Home first (`cmd_prefer`), then load (`_limit_score`, `_ws_least_loaded`); no ordered list; `ROUTE_FIELDS=(class effort subagent workflow compact browser degraded inert)` | `ccd/ccd#_swap_target`, `#_ws_least_loaded`, `#_spawn_start`, `#cmd_prefer`; pins in `ccd-swap.test.ts`, `ccd-swap-target-class.test.ts`, `projected-home.test.ts` |
| The subagent env | `CLAUDE_CODE_SUBAGENT_MODEL` from the route's `subagent` field, Anthropic lanes only | `ccd/ccd#_spawn_start` |
| The mail pace | 60 s and 120 s for a session with no open run; 15 s and 30 s for a claimant | `server/src/watch.ts` (`MAIL_QUIET_MS`, `MAIL_COOLDOWN_MS`, `COORD_QUIET_MS`, `COORD_COOLDOWN_MS`) |
| Sweep cadences | Every lane and its cadence in one table, `LANE_SCHEDULE`; `ASK_SWEEP_MS` 10 s, `MAIL_SWEEP_MS` 10 s | `server/src/laneSchedule.ts` |
| Fleet instruments | `measure-working-state.py`: sections `deaths` (session ends per day, fleet-wide), `spawn` (unit start to the turn marker's `restartAt`), `swaps`; `--since YYYY-MM-DD`. Its `journal` reads the systemd user journal (`journalctl --user`), and `journal_facts` derives session ends and `claude-session@<id>` starts from it. `hibernate_acts` only counts `hibernate` acts in ccd's lifecycle journal, `$REG/.lifecycle/journal-*.ndjson`; a roll is such an act with its reason defaulted to `roll` (`cmd_hibernate --roll`). Read-only, run by hand on the fleet box | `deploy/measure-working-state.py` (`journal`, `journal_facts`, `hibernate_acts`, `reg_dir`, `read_lines`) |
| The replay quiz | `history-replay.mjs` is an operator script, refused inside a pane (`in-pane`); its quiz needs part 1, a pilot, `quiz-source` and `freeze`. The history ledger's ruling of 2026-11-02 skips the full W2 study and says a later check must name "the minimum relevant evidence" | `deploy/history-replay.mjs`, `docs/superpowers/plans/2026-10-26-ccrc-history-w2-live-runbook.md`, `docs/superpowers/programs/ccrc-history.md` (Carried constraints) |
| Model checking | No model checker, property-test or mutation library in any package | `server/package.json` devDependencies |

**Measured before, so not measured again** (each is re-read in Task 1, and re-run only where the build moved):
- Subagent model, 2.1.270: with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, a per-call `model: opus` did not run on Sonnet
  (`docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md`, its measurement table).
- A typed `/effort` writes a per-model key into the account's settings (D-2808, same table). This is why no slash
  command that writes settings is typed.
- The hook's spill threshold, 10,000, read from 2.1.266's binary (`session-hook.test.ts`, I2b).
- Idle compaction after about 55 minutes, with no turn after it (D-5373).
- A draft in the input box is stashed and restored around a slash command (D-5912, `server/src/coord/dispatch.ts`).
- Fable on the Max plan: up to 50% of weekly usage at no extra cost, credits past it; the operator's statement of
  2026-09-14 that the fleet's accounts do not use credits
  (`docs/superpowers/specs/2026-09-14-effort-model-routing-design.md`).

## Global Constraints

- **Test-first.** Every guard and every stub lands with a test that was red before it, and each task names the mutation
  that turns its test red again.
- **One commit per task**, on the workspace's own branch. Never rebase, update-branch or force-push.
- **Touch only the files a task names.** Nothing that runs changes: no change under `server/src`, `agent/src`,
  `pwa/src`, `ui/`, `shared/`, `ccd/` or `deploy/`. Commits are the results note, the spec's as-measured lines and
  test-only files (the rig's extension, its stubs and scenarios). A test-only commit still changes the
  release tarball (`git archive`), so a merge cuts a prerelease, as the spec's W0 row says (§14). Nothing in it runs.
- **Suites run from inside the package, in the foreground,** with a timeout of at least 600,000 ms, one file at a time:
  `cd server && ./node_modules/.bin/vitest run test/<file>`. Never bare `npx vitest`.
- **Cite code by symbol** (`file#symbol`) or by anchor (`file#@name`), never by line number.
- **No private names.** Neutral stand-ins only (`scratch-a`, `lane-a`, `pool-s`, `project-w0`, `<root>`, `s1`), no
  home paths, no hosts. Before each commit: `git add` the files, run `topology-clean.test.ts`, and where the
  operator's local list is on the box, `node server/test/private-names.mjs scan --list <list>` from the clone must
  print no line naming a changed file.
- **No D-numbers invented.** This plan uses `D-TBD-<slug>`; the programme mints the numbers. `dtbd.test.ts` reds on
  any concrete `D-TBD-` slug in a tracked file, so no commit of this wave carries one: the results note names a
  departure by its minted number, or by a plain-words slug without the `D-TBD-` prefix until one is minted.
- **The rig only, for Claude Code itself.** A private `dlg*` socket, a fixture HOME, the mock API and `env -i`, on a
  Linux box. Never the default tmux server, never the live HOME, never an account. No session launches Claude Code
  outside the rig: `history-replay.mjs` refuses inside a pane for the same reason.
- **ccd.** In tests, through fixture HOMEs only (`makeCcdHarness`). On the live box, the conductor runs only the read
  verbs `ccd ls` and `ccd caps` and the consented swap forms of setup lines 4 and 6, and only once the setup item is
  answered.
- **Fleet reads.** Before the setup item is answered: `rig.sh versions` and the box-token read `ccrc-api runs list`
  only. After it: the named reads of setup line 4. The conductor never types into a pane, creates or archives a
  session, or touches an account or a pool.
- **Long rig arms run detached.** The two idle arms take over an hour each: run them with output in the run root and
  wait for the process to exit. Never poll in a loop.
- **Record each build.** Every rig bundle names its version; the subject's lanes are read from `version_to`. A result
  holds for the build it ran on.
- **Mock answers are labelled.** A result that depends on what the real API would send (the flagged refusal, the
  context-limit error) says "emulated" and names the documentation page its shape came from.

## Review Focus

1. **A launch block that silently did not apply.** A run whose flag, env or setting never reached the binary measures
   the default launch, and reads as a pass. Task 2's `print-launch` case pins that every checked value reaches the
   command line; Tasks 4 to 6 each check, before recording a row, that the run's first main request shows its launch
   took effect, and re-run a run that does not.
2. **A spilled hook text read as delivered.** Above the cap Claude Code puts a preview in the context, and the head
   canary survives in it. Only the tail canary proves the whole text arrived. Task 3's emitter case pins both canaries
   around exactly N characters; Task 4 Step 4 reads both.
3. **A rig result read as a model fact.** The rig shows what Claude Code sent, never whether a real model heeded it;
   that comes only from the subject (W0-20 to W0-22). "Inconclusive" is an outcome too, and it selects the
   conservative branch. Each row of the results note says which kind it is (Tasks 4 to 6, Step "Record").
4. **A model that proves nothing.** An exploration that stops at its bound, or a planted mutation that no invariant
   catches, passes vacuously. Task 7 records that every scenario ended under the bound, and that each of the 12
   mutations broke its own invariant. A violation is a finding, never cured by weakening an invariant.
5. **A permission bypass leaking into the delegation corpus.** The bypass exception is for `scenarios-overlord/`
   only. Task 2 pins it twice: a bypass in a `scenarios/` file is refused, and no committed corpus file names one.

## The measurements

Class: **a** read from the tree or Claude Code's documentation; **b** measurable by a session with fixture HOMEs and
the rig, or by a box-token read, with no operator setup; **c** needs the operator's setup, consent or reading.

| # | What is measured | Why the design needs it | How | Class | Outcomes, and the design choice each selects |
|---|---|---|---|---|---|
| W0-00 | Every platform row of Table 1.2a and §3.3's "Claude Code facts", re-read for the installed builds | §1.2 says W0 re-measures them | Documentation pages (hooks, settings, statusline, subagents, memory, CLI reference, model configuration, changelog), each fact with its page, date and build | a | A fact that changed is a row of the results note and a spec gap; the rows below re-test the load-bearing ones |
| W0-01 | The hook's cap: threshold, unit (characters, UTF-16 units or bytes), per hook command or per event | The anchor slot `ANCHOR_CARD_MAX_CHARS` = 1,500 and the pinned sum 9,951 (§3.3.3, H11) | Rig `ov-hook-cap-*`: a sized SessionStart emitter at 9,951, 10,000, 10,001 and 12,000 ASCII characters, and at 6,000 characters of a two-byte filler (about 12,000 bytes); two emitters of 6,000 characters each on the same event; the next main request read for the head and tail canaries | b | Whole up to 10,000 JS characters, per command: the slot stands. Lower, or in bytes: anchor = cap − 8,451 − 49; below 600, the roster card's 2,048 is cut first (W1a). Counted across commands: the anchor rides ccrc's one hook only, and W1a pins that no second SessionStart hook adds context |
| W0-02 | Which `source` each start reports (startup, resume, clear, compact, fresh, fork) and whether its context reaches the next request | Anchor on every start but a fork; every non-compact start mints a generation (§3.3.3, H12) | Corpus fixtures first (Q5) for `startup`, `clear` and `resume`; rig `ov-sources` for `compact` and the fresh and fork relaunches, read from the emitter's log (the capture arm leaves out `compact`) and the requests | a, b | Fork reports a word of its own: the refusal line keys on it. Fork reports `resume`: the refusal keys on the transcript's continued-in pointer (W1a). A source whose context is dropped: the card is read on the nudge for that source |
| W0-03 | The workspace memory file after `/clear` and after `/compact` | The constitution's carrier (§3.3.3) | Rig: a `CLAUDE.md` canary in the fixture repo; requests after each | b | Present after both: as designed. Absent after either: the constitution moves to the card's first page (C38 amended) |
| W0-04 | A `UserPromptSubmit` hook's context, and a hook past its timeout | The per-prompt delta (§3.3.3) | Rig: a 600-character prompt hook, and one that sleeps past its timeout | b | Delivered, and the late one drops its output: as designed. Not delivered: the delta leaves W1a |
| W0-05 | Whether a compaction changes the session id | C2 binds the session id; the tree's comments disagree | Rig `ov-compact`: `sessions/<pid>.json` and the transcript name before and after `/compact` and an automatic compaction | b | Either answer keeps the binding to the session id. The losing comments get a follow-up issue (not W0) |
| W0-06 | A fresh start's time, and the roll's overhead today | `clearing` 90 s, `carded` 45 s, the 360 s budget, the soft budget (Table 3.3.11a, Table 11.5b) | Rig `ov-renew-time-*`: fresh and resume relaunches after transcripts of about 0.1, 1 and 5 MB, ten each, timed to SessionStart and to the ready prompt. Fleet: ccd's lifecycle journal's `hibernate` acts with reason `roll`, each to the same session's next `claude-session@` start in the user journal, 30 days | b, c | p95 of overhead plus fresh start ≤ 60 s: deadlines stand. 60 to 90 s: `clearing` stands with one try. Above 90 s: `clearing` = p95 × 1.5 and the budget re-derived |
| W0-07 | The typed `/clear`'s reliability | Coordinators keep it "where W0 measures it reliable" (H13) | `ccrc-api runs list --closed 1`: runs with `resumed` true, `clearedAt` set against `health.clearError`, by error word | b | At least 99% cleared: the fast path stays for coordinators. Otherwise coordinators renew by a fresh start too |
| W0-08 | What `/clear` and a fresh start do to a background subagent, a background shell, queued input, a session cron and a durable cron | The drain waits for readers; the "no scheduled task" precondition; the fence's stale reader (§3.3.11, I5) | Rig `ov-clear-effects`: each started, then input typed mid-turn, then `/clear`; again with a fresh relaunch; SubagentStop times, where the reader's result lands, later cron fires | b | A reader that survives a clear and reports into the new conversation: the drain wait and the fence are load-bearing (as designed). Crons that survive a clear or a fresh start: the Overlord's profile denies the cron tools (H1 amended). Queued input carried into the new conversation: the delivery lane holds during `clearing` (as designed) |
| W0-09 | Auto memory: the per-session switch, and what a swap loads | H14: off for every role; the doctor check | Rig: a memory canary in the fixture config's project memory; switch on and off at launch; `swapConfig` to a second config with another canary. Fleet: counts of non-empty memory directories per account config directory | b, c | Off by a launch setting: the profile column. Only by account settings: the doctor check is the guard (H14 amended). A count above zero: an operator item at W1a |
| W0-10 | The switches for forks, the agent view and agent teams | H14; one body (R7) | Rig: a fork relaunch under each switch; the first request's tool list | b | A switch holds: the profile column. None: the fork refusal line and the sandbox check are the only guards |
| W0-11 | Whether the subagent model holds against a call that names another model | Readers run `sonnet`, never Fable (C55) | Rig: the env, any force variant the documentation names, and an `--agents` reader with `model: sonnet`; mock-scripted Agent calls naming `opus`; each sub request's `model` | b | A pin holds: the profile uses it. None holds (as on 2.1.270): W1 adds a PreToolUse arm that refuses an Agent call naming another model (C55 amended) |
| W0-12 | Which hook, payload field or transcript row reports a typed `/model` and Claude Code's own switch on a flagged request; whether a dialog appears with the switch pinned on | The model-drift trigger and its journal (H16, Table 3.6a) | Rig: a typed `/model`; the mock answers the Fable-class request with the refusal shape the documentation names (emulated); all hook payloads, the statusline capture, the transcript, the pane. Fleet: a count of real fallback notices in `ccrc history` | b, c | A hook payload names the model: the hook arm journals it. None: the statusline writer journals a model change (Table 3.6a amended). A dialog despite the pin: readiness's `dialog-open` covers it, and W1 records it |
| W0-13 | A PreCompact refusal of a proactive compaction | The arm ships dark until a refusal is shown to leave the turn intact (C39) | Rig `ov-precompact`: a lowered auto-compact window, mock usage past it, a hook that blocks `trigger: auto`; continued to the window's end; a manual `/compact` under the same hook | b | Honoured, turn intact, no retry each turn: armed at W1a. A retry each turn: the arm refuses once and lets the next through (soft budget). A broken turn or a stuck session at the limit: the arm stays dark |
| W0-14 | Per-session switches for the auto-compact window and idle compaction | C39: set by the launch profile, never by `/autocompact` | Rig: the setting at launch; two 65-minute idle arms, switch on and off | b | Both per session: as designed. No idle switch: the 45-minute idle trigger becomes load-bearing and W1a pins it |
| W0-15 | The door process under a restricted launch: hooks, skills, tools offered, the permission mode, the nonce | H1, H4, H9, and the §3.6 fallback | Rig `ov-door`: pinned setting sources, a `--settings` profile, `--strict-mcp-config` with the door stub, a narrowed tool list, readers in `--agents`, bypass mode, one skill | b | All hold: as designed. Hooks or skills lost under pinned sources: the profile carries them the way that worked (H1 amended). Door tools refused or prompting: the fallback, a shell for `ccrc-api` only, a 0600 key file and `OVERLORD_DENY_RULES` |
| W0-16 | Reader types with no shell | C55, the subagent-scope arm | Within `ov-door`: the reader resolves; its offered tools are its list; a deny rule fires inside it; SubagentStart and SubagentStop fields | b | As designed, or the scope arm keys on the field that exists |
| W0-17 | Peer messaging closed, and the inbox socket | H1 closes the channel; H2 keeps today's delivery unless W0 proves the socket | Documentation for the settings and any documented interface a local process may use; rig: tools offered with and without the profile. No reverse engineering | a, b | A documented interface works with inbound closed: the Later item's trigger is met (recorded, not built). Otherwise today's delivery stays. Peer tools still offered under the profile: W1's sandbox check must refuse, and this blocks W1 |
| W0-18 | The statusline's token and window fields, its idle cadence, any per-model weekly figure | The hard-cap trigger (Table 3.3.11b); the reservation proxy | Rig: a statusline capture under mock usage and rate-limit headers; ten idle minutes. The binary's strings for the rate-limit header names it reads | a, b | Present: the sidecar gains them in W1a. Absent: the cap reads the last main assistant row's usage (Table 3.6a amended). No idle renders: a stale sample is unmeasured, as designed. A per-model figure: W0-24 uses it |
| W0-19 | What an account's shared config directory loads: settings, the user memory file, mods, tool servers, skills | H1 pins sources; §3.5 no mods; H14 | Rig: a fixture config with each kind, launched with and without the pinned sources. Fleet: per account that may serve the Overlord, counts by kind and settings key names only | b, c | Pinning excludes all: as designed. A kind leaks through: the loaded-file report names it and refuses `launch-profile-unmet`. Mods present on the fleet: doctor's no-mods check is required before designation |
| W0-20 | Nudge-and-read against typed text | §3.8 delivery | Subject: ten pairs, the operator's typed words and the same words as mail read by tool; latency to first tool call and to reply, net of the mail gate; whether it acts on both alike; the operator's 1 to 5 rating | c | Net latency ≤ 10 s, equal fidelity, rating ≥ 4: as designed. Worse fidelity: wording of the `messages` result and the skill clause (W1). The gate dominates: the Overlord's `MAIL_PACE` row (C24) |
| W0-21 | A swap at idle and one mid-turn, each followed by a stand-in renewal and probes | §3.4, C57: "W0 measures it" | Subject: `ccd swap` at idle and `ccd swap --interrupt` mid-turn; then the operator's `/clear`, a card file re-read, three closed-form questions on facts mailed before | c | Both pass: as designed. More than the turn lost: recorded against the resumed-long trigger. Probes fail: the restart bound is taken from this run |
| W0-22 | A continuity record for each lane | H16: no record, no Overlord on that lane | Client side from W0-01, W0-02, W0-15 and W0-16 for each installed build. Model side on the subject (or a second scratch session) per named lane: the anchor canary, a deny rule, a reader, a closed-form probe after `/clear`; synthetic text only | b, c | Four passes: the operator may set the record (W1). Any fail: no record |
| W0-23 | Whether each account bills Fable to usage credits | The billing fact (H16, O2) | Prior statement (a); the operator's reading of each account's plan and credits setting | a, c | Credits off: billing fact `none`. On: Fable unservable for the Overlord there, as designed |
| W0-24 | How closely the seven-day figure times the Fable share tracks Claude Code's own Fable figure | The reservation's Fable arm (C46, Table 3.4c) | Per account running Fable: three readings over at least three days; the operator's `/usage` Fable line and the sweep's `estimate`, `sevenPct`, `finishedAt` at the same minute; or W0-18's field | c | Error ≤ 5 points of the window: the proxy, labelled. 5 to 15: the ceiling lowered by the largest error, Table 3.4c recomputed. Above 15 or no truth: W1's reservation rule stays shadow until a direct reading |
| W0-25 | Today's account pick, and any hidden order | C56: "listed order before load" is new | The code and its pins; a fixture-HOME run through `makeCcdHarness` with `lane-a` to `lane-d` at equal scores only if a tie-break is unpinned | a, b | Home, then load: W1 adds the list as specified. A roster-order tie-break: W1 extends it rather than adding a second order |
| W0-26 | Restarts per session per hour, the restart time, the sweep after boot | Readiness `restarting` (two in an hour); "one sweep" (Table 11.5b) | A scratch reader over `journal_facts`'s `claude-session@` starts, per session per clock hour, 30 days; `measure-working-state.py --section spawn`, 30 days; `LANE_SCHEDULE` | a, c | p99 restarts per session-hour ≤ 2: two stands, else the p99. Restart p95 (`spawn`): `restarting`'s bound. One sweep: no lane computes readiness today, so W0 records `LANE_SCHEDULE`'s cadences and W1 names the lane whose cadence it is |
| W0-27 | The first model of holds, readiness, generations and restarts | §11.7, H33: "written before the code" | Task 7 | b | No violation: the machines compose as specified. A violation: a spec contradiction, recorded and ruled before W1a |
| W0-28 | The replay quiz's baseline | C52, M13: "above its W0 baseline" | Task 11, after the history programme's coordinator answers | c | The operator rules between a reduced run now and the first run of W1a's weekly lane, taken before any W1a arm is armed |

## The operator's setup (raised as one item; none of it is a session's)

Each line is the operator's act or answer, before Task 8. No line needs anything done by hand to tmux, a
`claude-session@` unit or a process.
1. **Accounts.** Two scratch accounts, `scratch-a` and `scratch-b`, carrying no real work, Fable-entitled, in pool
   `pool-s`, contained as the session-continuity wave 5 plan's setup lines 2 and 3 say. Its loan may be reused once
   its Task 4 has ended, never beside it.
2. **The scratch project.** An empty project, `project-w0`, tagged `pool-s`.
3. **The subject.** One session on `scratch-a` in `project-w0`, created from the console.
4. **Consent.** For the length of the loan, the conductor may:
   - mail the subject;
   - run `ccd ls` and `ccd caps`;
   - run `ccd swap <subject> <lane>` and `ccd swap --interrupt <subject> <lane>` between the scratch lanes only, and
     onto the lanes of line 6 and back;
   - run `deploy/measure-working-state.py` with `--section deaths`, `--section spawn` and `--section swaps`, and import
     its `journal`, `journal_facts`, `reg_dir` and `read_lines` under `python3 -I` to read the user journal and ccd's
     lifecycle journal;
   - run `ccrc history` read verbs to count the fallback notice's text, reporting counts only;
   - read `perAccount.<id>.fableShare` and `finishedAt` from the sweep's `$REG/usage/sweep/latest.json`, for the
     accounts in line 8 only;
   - read `version_to` from each account config directory's `.last-update-result.json`;
   - list, per account config directory, the non-empty `projects/*/memory/` directories, the entries of `skills/` and
     `plugins/`, the presence and sha256 of `CLAUDE.md`, the key names of `settings.json`, and the count of
     `mcpServers` in `.claude.json` by `jq 'try (.mcpServers|length) catch 0'`. Never `.credentials.json`, never a
     whole `.claude.json`, never a value.
5. **Console acts at the conductor's mail.** Type `/clear` into the subject when asked (Tasks 9, W0-21 and W0-22).
   Send the ten W0-20 messages from the console, and rate each pair 1 to 5.
6. **Lanes to record (W0-22).** Name the lanes to test, and consent to swapping the subject onto each and back.
   Another provider's lane only after the spec's Waiting on you ruling 6.
7. **Account facts (W0-23).** For each account that may be reserved: its plan, and whether usage credits are on.
8. **`/usage` readings (W0-24).** For each account running Fable this week, read its Fable line three times over at
   least three days, at the conductor's mail, from your own shell.
9. **The replay quiz (W0-28).** Rule between the two options in Task 11.
10. **The names.** Real account, lane and project names reach the conductor only in the item's answer.

---

### Task 1: The read pass

**Files:**
- Create: `docs/superpowers/plans/<date>-overlord-w0-spike-results.md`

**Interfaces:** Produces the results note's rows W0-00, and the read halves of W0-02, W0-05, W0-07, W0-17, W0-18,
W0-23, W0-25 and W0-26.

- [ ] **Step 1: Installed builds.** `bash server/test/delegation-rig/rig.sh versions`. Record the newest and the
  oldest installed build. Every rig scenario in Tasks 4 to 6 runs on both. (The lanes' own builds are read in Task 8,
  under consent; a lane on a build outside that pair is recorded there as unmeasured by the rig.)
- [ ] **Step 2: The documentation.** For each row of Table 1.2a marked "Claude Code's documentation" and each bullet of
  §3.3's "Claude Code facts", record the page, the date read and the text in one line. Also record the exact names of:
  the auto-memory switch; the fork, agent-view and agent-teams switches; the subagent model env and any force variant;
  the auto-compact window and idle-compaction switches; the PreCompact hook's block form (an exit code or a JSON
  decision); the inbound peer-message and Remote Control switches; the cron tools and whether any is durable; the
  statusline payload's context and rate-limit fields; the refusal shape of a flagged request and of a context-limit
  error. Confirm in the CLI reference each flag Task 2's `RIG_LAUNCH_FLAGS` starts with, and
  record its arity. Task 2's lists are taken from this step.
- [ ] **Step 3: The binary.** `strings` on each build for the rate-limit header names it reads and the hook spill
  constant, as 2.1.266 was read. Read-only; never a write under the versions directory.
- [ ] **Step 4: The tree.** Quote the three uuid comments (W0-05). Read `ccd/ccd#_swap_target`,
  `#_ws_least_loaded`, `#_spawn_start` and `#cmd_prefer`, and say which of `ccd-swap.test.ts`,
  `ccd-swap-target-class.test.ts` and `projected-home.test.ts` pins a tie-break (W0-25). If none does, run a scratch
  vitest file outside the tree's commit (deleted after) that builds `makeCcdHarness('w0-tie-')` with `lane-a` to
  `lane-d` at equal scores and records which `_ws_least_loaded` picks. Record `LANE_SCHEDULE`'s
  cadences in `server/src/laneSchedule.ts` (W0-26).
- [ ] **Step 5: The corpus.** From `server/test/fixtures/delegation/<version>/clear-compact-resume.json` and
  `swap-resume.json`, the SessionStart `source` values per build (W0-02). `compact` is absent by design (the capture
  arm leaves it out); Task 4 measures it.
- [ ] **Step 6: The `/clear` count (W0-07).** `~/.local/bin/ccrc-api runs list --closed 1`; for runs with `resumed`
  true, count `clearedAt` set and each `health.clearError` word. If no run is resumed, record W0-07 as unmeasured,
  which selects "fresh start only".
- [ ] **Step 7: Commit.**

```bash
git add docs/superpowers/plans/<date>-overlord-w0-spike-results.md
git commit -m "docs(overlord): W0 Task 1, the read pass: platform rows, prior measurements and today's account pick"
```

### Task 2: A rig scenario may carry a launch profile

**Files:**
- Modify: `server/test/delegation-rig/rig.sh` (`check_scenario`, `cmd_setup`, `launch_cmd`, `run_steps`, `collect`,
  `cmd_run`, the case dispatch and the header, whose usage range `sed -n '2,23p'` widens by the lines added)
- Modify: `server/test/delegation-rig/README.md` (the new keys)
- Test: `server/test/delegation-rig-w0.test.ts` (new; the existing file's helpers are not exported, so it carries its
  own, below)

**Interfaces:**
- Produces, in a scenario's top level (all optional; a scenario without them runs exactly as today):
  - `launch.args`: string array. An element that starts with `-` is a flag and must be in `RIG_LAUNCH_FLAGS`; any
    other element is a value and must follow a flag.
  - `launch.env`: object of string values; each name in `RIG_LAUNCH_ENV`; `PATH`, `HOME`, `TMPDIR`,
    `CLAUDE_CONFIG_DIR` and every `ANTHROPIC_*` name refused.
  - `launch.settings`: object, merged over the fixture's `settings.json` after `install-session-hooks.sh` has run,
    with jq's `*`, except that each `hooks.<event>` array is appended to the fixture's, so ccrc's own hook stays.
  - `launch.files`: `[{in: "cfg"|"repo", path, text, exec?}]`, written to `$RUN_H/cfg/<path>` or `$RUN_R/repo/<path>`
    in `cmd_setup`, mode 0755 when `exec` is true; `path` matches `^[A-Za-z0-9._/-]{1,200}$`, is relative and has no
    `..` segment.
  - Placeholders `@RIG_ROOT@` (`$RUN_R`), `@RIG_HOME@` (`$RUN_H`), `@RIG_CFG@` (`$RUN_H/cfg`), `@RIG_REPO@`
    (`$RUN_R/repo`), `@RIG_STUBS@` (`$HERE/stubs`), replaced literally in args, env values, settings strings and file
    texts. No other expansion.
  - `capS`: integer 60 to 5400, replacing `RUN_CAP_S` for this run.
  - `timing: true`: each step's start and `waitReady`'s elapsed milliseconds go to `notes`.
  - `requests: true`: `cmd_run` makes `$RUN_R/reqs` and starts the mock with `MOCK_REQDIR=$RUN_R/reqs`; `collect`
    copies it as `reqs/`. Off by default, so the delegation corpus is unchanged.
  - `collect` copies `$RUN_R/logs/` as `logs/` when it exists (the stubs' logs; Task 3).
- Produces, as steps: `relaunch` takes `true` (today's `--resume <sid>`), `{"mode":"fresh"}` (no `--resume`) or
  `{"mode":"fork"}` (`--resume <sid> --fork-session`); any other value is refused. A new verb, `sessionsSnap: <name>`
  (`^[a-z0-9-]{1,40}$`), copies `$CFG/sessions/*.json` into `snapshots/<name>/sessions/` and writes the names of
  `$CFG/projects/*/*.jsonl` to `snapshots/<name>/transcripts`.
- Produces a read-only verb, `rig.sh print-launch <version> <scenario.json> <root>`: `need_version`, then
  `check_scenario`, then `cmd_setup "$root" "$version"` (so files and settings are applied as a run applies them),
  then prints `launch_cmd`'s line with `PORT=0`. One header line names it.
- `RIG_LAUNCH_FLAGS` and `RIG_LAUNCH_ENV` are defined once, in `rig.sh`, as single-quoted space-separated strings in
  the shape of `VERBS`. `RIG_LAUNCH_FLAGS` starts with `--setting-sources --settings --mcp-config --strict-mcp-config
  --agents --allowedTools --disallowedTools --permission-mode --dangerously-skip-permissions --model`, plus the
  switches Task 1 Step 2 recorded; a flag Task 1 found absent from the CLI reference is left out and noted.
  `RIG_LAUNCH_ENV` starts with `RIG_EMIT_LOG RIG_STATUS_LOG DOOR_LOG DOOR_NONCE`, plus the env names Task 1 recorded.
  The test reads both from the source and never restates them.
- A bypass (`--dangerously-skip-permissions`; `--permission-mode` followed by `bypassPermissions`; or
  `launch.settings.permissions.defaultMode` set to `bypassPermissions`) is accepted only when the basename of the
  scenario file's directory is `scenarios-overlord` (D-8203).

- [ ] **Step 1: Write the failing tests.**

```ts
it('check-scenario accepts a launch block whose flags and env names are on the lists', () => {
  const f = scen('scenarios-overlord', 'ok', [{ waitReady: 60 }],
    { launch: { args: ['--setting-sources', 'project'], env: { [firstEnvName()]: 'x' } }, capS: 600, requests: true });
  expect(rigsh(['check-scenario', f]).status).toBe(0);
});
it.each([
  ['a flag off the list', { launch: { args: ['--no-such-flag'] } }],
  ['a reserved env name', { launch: { env: { HOME: '/x' } } }],
  ['an ANTHROPIC_ name', { launch: { env: { ANTHROPIC_BASE_URL: 'http://x' } } }],
  ['an absolute file path', { launch: { files: [{ in: 'repo', path: '/etc/x', text: '' }] } }],
  ['a .. segment', { launch: { files: [{ in: 'cfg', path: 'a/../../x', text: '' }] } }],
  ['a capS over 5400', { capS: 5401 }],
  ['a relaunch mode that is not fresh or fork', { steps: [{ relaunch: { mode: 'other' } }] }],
])('check-scenario refuses %s, exit 2', (_w, top) => {
  expect(rigsh(['check-scenario', scen('scenarios-overlord', 'bad', [{ waitReady: 60 }], top)]).status).toBe(2);
});
it.each([
  ['the flag', { launch: { args: ['--dangerously-skip-permissions'] } }],
  ['the settings mode', { launch: { settings: { permissions: { defaultMode: 'bypassPermissions' } } } }],
])('a bypass by %s passes in scenarios-overlord and is refused in scenarios', (_w, top) => {
  expect(rigsh(['check-scenario', scen('scenarios-overlord', 'b', [{ waitReady: 60 }], top)]).status).toBe(0);
  expect(rigsh(['check-scenario', scen('scenarios', 'b', [{ waitReady: 60 }], top)]).status).toBe(2);
});
it('no file in the delegation corpus names a bypass flag', () => {
  for (const f of fs.readdirSync(path.join(RIG, 'scenarios')))
    expect(fs.readFileSync(path.join(RIG, 'scenarios', f), 'utf8')).not.toMatch(/skip-permissions|bypassPermissions/);
});
it('launch_cmd quotes a launch value and substitutes only the five placeholders', () => {
  const line = launchLine({ args: ['--settings', '@RIG_CFG@/p.json; touch x'], env: {} });
  expect(line).toContain(`${cfg}/p.json\\;\\ touch\\ x`);
  expect(line).not.toMatch(/@RIG_[A-Z]+@/);
});
```

  The file's own helpers, as `delegation-rig.test.ts` writes its: `rigsh(args, env?)` is `spawnSync('bash', [RIGSH,
  ...args])` returning `{status, stdout, stderr}`; `scen(dir, name, steps, top)` writes
  `JSON.stringify({ steps, entries: [], ...top })` to `<mkTmp('ccrc-dlg-w0-')>/<dir>/<name>.json` and returns the
  path; `firstEnvName()` reads the `RIG_LAUNCH_ENV='…'` line from `rig.sh` and returns its first word;
  `launchLine(launch)` writes a `scenarios-overlord` scenario with that block, makes `root =
  <mkTmp('ccrc-dlg-pl-')>/ccrc-dlg-rig.t`, runs `print-launch 2.1.290 <scenario> <root>` with `HOME` set to a fixture
  HOME holding an executable `.local/share/claude/versions/2.1.290` (as `versionsHome` does), and returns stdout;
  `cfg` is `<root>/fixhome/cfg`.
- [ ] **Step 2: Run them.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig-w0.test.ts`. Today
  `check_scenario` ignores top-level keys it does not know and never reads `relaunch`'s value, so every refusal case
  and each bypass case's second assertion fail (exit 0, not 2); the accept case fails because `firstEnvName()` finds
  no `RIG_LAUNCH_ENV`; the quoting case fails because `print-launch` is an unknown verb. Only the corpus case passes:
  it pins today's corpus.
- [ ] **Step 3: Implement** in `rig.sh`, beside the code each key belongs to: the lists beside `VERBS`; the checks in
  `check_scenario`; the settings merge and files in `cmd_setup`; `launch_cmd` appending the checked args and env with
  `%q`; `relaunch`'s three forms and `sessionsSnap` in `run_steps` (and `sessionsSnap` in `VERBS`); `capS`, `timing`
  and `requests` in `cmd_run`; `reqs/` and `logs/` in `collect`; `print-launch` in the case dispatch and the header,
  with the usage range widened so the existing usage case still sees the header's last line. Keep every existing
  scenario's behaviour byte-identical.
- [ ] **Step 4: Run** the new file and the existing `test/delegation-rig.test.ts` and
  `test/delegation-fixtures.test.ts`. Expect all green.
- [ ] **Step 5: The guards and their mutants.** Delete the flag check: the "flag off the list" case goes red. Delete
  the `..` refusal: the ".. segment" case goes red. Delete the directory test on bypass: the second assertion of both
  bypass cases goes red. Drop the settings arm of the bypass test: the settings-mode case goes red. Drop `%q` on a
  launch value: the quoting case goes red. Record each in the PR body.
- [ ] **Step 6: Commit.**

```bash
git commit -m "test(rig): a scenario may carry a launch profile; flags and env from one list; bypass only in scenarios-overlord"
```

### Task 3: The rig's W0 stubs

**Files:**
- Create: `server/test/delegation-rig/stubs/door-stub.mjs`, `emit-context.mjs`, `precompact-refuse.mjs`,
  `statusline-capture.mjs` (each dependency-free Node, test tooling outside the ring census)
- Test: `server/test/delegation-rig-w0.test.ts`

**Interfaces:**
- `door-stub.mjs`: a stdio MCP server, newline-delimited JSON-RPC 2.0. Answers `initialize`, `tools/list` with
  `card`, `read` and `act`, and `tools/call`. `card` returns text holding `W0-CARD-CANARY`; `read` returns
  `{"kind":"record","id":"r-1"}` as text; `act` returns `ok`. Appends one line per call to `$DOOR_LOG`:
  `{"t":<ms>,"method":…,"tool":…,"nonce":"present"|"absent"}`, reading `DOOR_NONCE`'s presence only.
- `emit-context.mjs --event <E> --chars <N> [--fill ascii|wide]`: prints
  `{"hookSpecificOutput":{"hookEventName":E,"additionalContext":T}}` where `T` has exactly N characters (JS length),
  starts `W0-HEAD-<N>-` and ends `-W0-TAIL-<N>`; the filler is `x`, or `é` (U+00E9, two UTF-8 bytes) for `wide`;
  appends `{event, source}` from its stdin payload to `$RIG_EMIT_LOG`.
- `precompact-refuse.mjs`: blocks when the payload's `trigger` is `auto`, by the block form Task 1 Step 2 recorded;
  passes `manual` with exit 0 and no output; appends `{trigger, decision}` to `$RIG_EMIT_LOG`.
- `statusline-capture.mjs`: reads one JSON payload on stdin; appends to `$RIG_STATUS_LOG` one object of key path to
  value for number and boolean leaves, key path to `"<string>"` for string leaves except `model.id`; prints one line.
- Scenarios set each log in `launch.env` under `@RIG_ROOT@/logs/`, so `collect` keeps it. A stub whose log variable
  is unset logs nothing.

- [ ] **Step 1: Write the failing tests.**

```ts
it('the door stub lists card, read and act, and logs the nonce as present, never its value', async () => {
  const { replies, log } = await door(['initialize', 'tools/list', ['tools/call', { name: 'card', arguments: {} }]],
    { DOOR_NONCE: 'n-7f3a' });
  expect(replies[1].result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['act', 'card', 'read']);
  expect(JSON.stringify(replies[2])).toContain('W0-CARD-CANARY');
  expect(log).toContain('"nonce":"present"');
  expect(log).not.toContain('n-7f3a');
});
it.each([9951, 10000, 10001, 12000])('emit-context prints exactly %i characters between its canaries', (n) => {
  const t = JSON.parse(run('emit-context.mjs', ['--event', 'SessionStart', '--chars', String(n)], '{"source":"startup"}'))
    .hookSpecificOutput.additionalContext as string;
  expect(t.length).toBe(n);
  expect(t.startsWith(`W0-HEAD-${n}-`) && t.endsWith(`-W0-TAIL-${n}`)).toBe(true);
});
it('precompact-refuse blocks auto and passes manual', () => {
  expect(runRc('precompact-refuse.mjs', '{"trigger":"auto"}')).not.toBe(0);
  expect(runRc('precompact-refuse.mjs', '{"trigger":"manual"}')).toBe(0);
});
it('statusline capture keeps numbers and key paths, never a string value but the model id', () => {
  const o = capture({ model: { id: 'm-1', display_name: 'private-x' }, cwd: '/w0/cwd/p',
    context_window: { total_input_tokens: 1200, context_window_size: 200000 } });
  expect(o['context_window.total_input_tokens']).toBe(1200);
  expect(o['model.id']).toBe('m-1');
  expect(JSON.stringify(o)).not.toMatch(/private-x|\/w0\/cwd/);
});
```

  If Task 1 recorded an exit-code block, the auto assertion is `toBe(<that code>)`; if a JSON decision, it parses
  stdout and asserts its decision field equals the documented block value. The helpers: `door(calls, env)` spawns
  `node stubs/door-stub.mjs` with `DOOR_LOG` set to a temp file, writes each call as one JSON-RPC 2.0 request line
  (id = its index, `params` from the pair's second element), ends stdin, and returns the parsed reply lines in order
  and the log's text; `run(stub, args, stdin)` and `runRc(stub, stdin)` are `spawnSync(process.execPath, …)`
  returning stdout and the exit status; `capture(payload)` runs `statusline-capture.mjs` with `RIG_STATUS_LOG` set to
  a temp file and returns that file's last line, parsed.
- [ ] **Step 2: Run.** Expect each to fail: the files do not exist.
- [ ] **Step 3: Implement** the four stubs to those interfaces.
- [ ] **Step 4: Run.** Expect green.
- [ ] **Step 5: Mutants.** Log `DOOR_NONCE`'s value: the door case goes red. Write a string value in the capture: the
  capture case goes red. Pad the emitter's text one character short: the emitter case goes red.
- [ ] **Step 6: Commit.**

```bash
git commit -m "test(rig): the W0 stubs: a door, a sized hook emitter, a PreCompact refuser and a statusline capture"
```

### Task 4: Scenarios: the anchor and its carriers (W0-01 to W0-04)

**Files:**
- Create, in the new directory `server/test/delegation-rig/scenarios-overlord/`: `ov-hook-cap-9951.json`,
  `ov-hook-cap-10000.json`, `ov-hook-cap-10001.json`, `ov-hook-cap-12000.json`, `ov-hook-cap-wide-6000.json`,
  `ov-hook-cap-pair.json`, `ov-sources.json`, `ov-carriers.json`
- Modify: the results note

**Interfaces:** Consumes Task 2's keys and Task 3's stubs. Produces rows W0-01 to W0-04.

- [ ] **Step 1: Write each scenario** with `requests: true` and `timing: true`. A run has one settings file, so each
  size is a scenario of its own: the emitter added by `launch.settings.hooks.SessionStart` at that size, and in
  `ov-hook-cap-pair` two emitter commands of 6,000 characters each. `ov-sources`: startup, `/compact`,
  `relaunch {"mode":"fresh"}`, `relaunch {"mode":"fork"}`, each followed by one typed prompt, with the emitter at 200
  characters logging each `source`. `ov-carriers`: a `CLAUDE.md` with `W0-CONST-CANARY` in `launch.files`, a prompt
  hook of 600 characters, a second prompt hook that sleeps past its timeout, then `/clear` and `/compact`, each
  followed by a prompt.
- [ ] **Step 2: Check them.** `bash server/test/delegation-rig/rig.sh check-scenario <file>` for each. Expect exit 0.
- [ ] **Step 3: Run them** on both builds: `bash server/test/delegation-rig/rig.sh run <version> <file> <out>`, out
  under `${TMPDIR:-/tmp}`, never in the tree.
- [ ] **Step 4: Read them.** First, for each run, that the launch applied: the emitter's log has a line for each
  start, and the first main request carries the emitter's head canary. A run where it did not is fixed and re-run,
  never recorded. Then, for each main request after a start, whether both canaries are in it (a request file holds
  the request under `.body`), for example:

```bash
jq -r '[.body.system[]?.text, (.body.messages[]?.content | if type=="array" then .[]?.text else . end)]
  | map(select(.)) | join("\n")' "$out/reqs/0003-main.json" | grep -o 'W0-\(HEAD\|TAIL\)-[0-9]*' | sort -u
```

  and whether a spilled text left a file reference and a preview, with the preview's length. The `source` values come
  from the emitter's log (`logs/`), and for the starts the capture arm keeps, from
  `node deploy/hook-capture-reduce.mjs` on the captures.
- [ ] **Step 5: Record** each row's measured answer, build and the outcome it selects. Commit the scenarios and the
  note.

```bash
git commit -m "test(rig): W0 scenarios for the hook's cap, the start sources and the anchor's carriers; results noted"
```

### Task 5: Scenarios: compaction, clear and the renewal stand-in (W0-05, W0-06, W0-08, W0-13, W0-14)

**Files:**
- Create, in `server/test/delegation-rig/scenarios-overlord/`: `ov-compact.json`, `ov-renew-time-0.1mb.json`,
  `ov-renew-time-1mb.json`, `ov-renew-time-5mb.json`, `ov-clear-effects.json`, `ov-clear-effects-fresh.json`,
  `ov-precompact.json`, `ov-idle-on.json`, `ov-idle-off.json`
- Modify: the results note

**Interfaces:** Consumes the rig verbs, `sessionsSnap`, `relaunch` forms and `precompact-refuse.mjs`. Produces those
rows.

The capture arm stops at 200 files, and `relaunch true` resumes the session named by the newest capture. A run past
200 captures resumes a stale session, so each scenario here stays well under it, which is why the renewal timing is
one scenario per size.

- [ ] **Step 1: Write the scenarios.**
  - `ov-compact`: `sessionsSnap` before and after `/compact`, and before and after an automatic compaction driven by
    mock `usage` past a lowered window.
  - `ov-renew-time-<size>`: mock replies sized to grow the transcript to about 0.1, 1 or 5 MB; then ten
    `relaunch {"mode":"fresh"}` and ten `relaunch true`, alternating, each followed by `waitReady`.
  - `ov-clear-effects`: a mock-scripted background Agent whose sub request hangs (`hang_ms`), a background Bash, a
    session cron and a durable cron (Task 1's tool names), text typed while the main turn runs; then `/clear`.
    `ov-clear-effects-fresh` is the same with `relaunch {"mode":"fresh"}` in place of `/clear`.
  - `ov-precompact`: the refuser on PreCompact, a lowered window, usage past it for five turns, then the context-limit
    error at the window's end (emulated); then a manual `/compact`.
  - `ov-idle-on` and `ov-idle-off`: `capS` 5400, one prompt, then 65 minutes idle.
- [ ] **Step 2: Check, then run** each on both builds. Run the two idle scenarios detached, and wait for exit.
- [ ] **Step 3: Read.** First, as in Task 4, that each run's launch applied (the lowered window and idle switch show
  in the first request or the run's settings; the refuser's log has lines). For W0-05, the `sessionId` in each
  snapshot and the transcript file names. For W0-06, the `timing` notes' `waitReady` elapsed times, and each
  SessionStart's time from its capture file name (`<event>-<epoch ms>-<pid>.cap`); p50 and p95 per size and form.
  For W0-08, SubagentStop times from the captures, whether the hung reader's later result appears in a request after
  `/clear`, where the typed text went, and any cron fire after the clear or the fresh start. For W0-13, compaction
  requests per turn, whether each turn ended with a reply, and what happened at the limit. For W0-14, whether a
  compaction request arrived and when.
- [ ] **Step 4: Record and commit.**

```bash
git commit -m "test(rig): W0 scenarios for compaction, clear and the fresh start; results noted"
```

### Task 6: Scenarios: the launch profile (W0-09 to W0-12, W0-15 to W0-19)

**Files:**
- Create: `scenarios-overlord/ov-memory.json`, `ov-forks.json`, `ov-subagent-model.json`, `ov-model-switch.json`,
  `ov-door.json`, `ov-peer.json`, `ov-statusline.json`, `ov-config-load.json`
- Modify: the results note

**Interfaces:** Consumes the stubs and the launch block. Produces those rows.

- [ ] **Step 1: Write the scenarios.**
  - `ov-memory`: a memory canary in the fixture config's project memory directory; switch on, then off; then
    `swapConfig` to a copy holding another canary, and `relaunch`.
  - `ov-forks`: `relaunch {"mode":"fork"}` with each switch Task 1 named; the first request's tools.
  - `ov-subagent-model`: the env, any force variant, and `--agents` with a `sonnet` reader; mock tool calls to Agent
    naming `opus` per call; each sub request's `model`.
  - `ov-model-switch`: a typed `/model <class>` (it writes the fixture config's settings, which is why it is typed
    nowhere but the rig); then the Fable-class request answered with the flagged refusal shape
    (emulated); the pane's text captured for any dialog.
  - `ov-door`: the profile as H1 states it, in bypass mode, with the door stub in an `--mcp-config` file under
    `launch.files` and `DOOR_NONCE` in `launch.env`; mock calls to `card` and `read` from the main thread, `read` from
    a reader, a denied Bash from both, and an `act` from the reader.
  - `ov-peer`: the first request's tools with and without the profile's peer switches.
  - `ov-statusline`: `statusline-capture.mjs` as the status line, mock `usage` and rate-limit headers; ten idle
    minutes.
  - `ov-config-load`: a fixture config holding a user `CLAUDE.md`, a skill, an MCP server entry, a plugin and a
    settings key; launched with and without pinned sources.
- [ ] **Step 2: Check, then run** each on both builds.
- [ ] **Step 3: Read** the requests (system text and offered tools), the captures, the door log and the status log.
  First, as in Task 4, that each run's launch applied (the first main request's tool list matches the flags given); a
  run where it did not is re-run, never recorded. For `ov-door`, record each H4 property as measured: tools offered,
  hooks fired, skills listed, door calls served with no prompt, the deny rule in main and reader, the nonce present.
  If the door's tools are refused or prompt, W0-15 selects the §3.6 fallback, and the note says so plainly.
- [ ] **Step 4: Record and commit.**

```bash
git commit -m "test(rig): W0 scenarios for the launch profile, the door and its readers; results noted"
```

### Task 7: The first model of holds, readiness, generations and restarts (W0-27)

The model exists. It was written while the spec was reviewed, before any code, and it is in the tree as research:
`docs/superpowers/research/2026-11-10-overlord-model-check/` (`model.py`, `check.py` and `REPORT.md`; Python standard
library only). It is an explicit-state breadth-first search over holds, readiness, generations, grants and restore,
with 15 scenarios, 24 switches for readings the text had left open, and 14 planted mutations, 12 of which an invariant
must catch. A second round, in `round-two/` beside it, covers authority, restore, requests, commands, the push budget
and playbook entries with six small machines. A third round, in `round-three-deciders/` and
`round-three-accounts-privacy/`, enumerates every decider table over its whole domain and models the reservation
arithmetic, the operator's messages and the privacy rules. A fourth, in `round-four-oversight/`, models the evidence
behind each gate, the decision model and the judges, and computes what each kind of trust takes to earn. The spec's
later editions wrote each round's findings in.
This task writes no new model. It re-runs them against the merged edition and records W0-27.

**Files:**
- Read: `docs/superpowers/research/2026-11-10-overlord-model-check/` (this task changes nothing in it)
- Modify: the results note (row W0-27)

**Interfaces:** Produces W0-27. The simulator piece (`w1a-simulator.md`, its model task) moves the two files under
`server/test/model/overlord/` and runs the fast scenarios on every CI run. This task moves nothing.

- [ ] **Step 1: The switches against the merged edition.** `python3 check.py --list` prints the 24 switches and their
  defaults. For each one, find the sentence in the merged spec that settles it: `REPORT.md`'s table names the sentence
  proposed, and the spec's follow-up wrote each in. Record the section, and whether the default equals the spec's
  reading. A default that disagrees is a finding, and Step 2 runs it both ways. Never change a default to make a run
  pass.
- [ ] **Step 2: Run,** from the model's directory: `python3 check.py --matrix` (about 4.5 minutes) and
  `python3 check.py --mutations` (about 3.5 minutes). Expected: at the defaults every scenario holds every invariant
  and ends under the bound of 3,000,000 states. The 12 mutations an invariant should catch are caught, and the 2
  marked "none expected" are not. Then, from `round-two/`: `python3 check.py --matrix` and
  `python3 check.py --mutations` (about 15 and 10 seconds). Expected: every check holds under the safe readings, and
  all 40 mutations are caught. Round three's deciders read one named edition of the spec through `git show`
  (`common.py`); to run them on the merged edition, set `OVERLORD_SPEC` to the spec file and run `./run_all.sh`. A
  sentence a check is anchored to may have changed: record each anchor that stops, and whether its rule still holds.
- [ ] **Step 3: A violation at the defaults is a finding against the spec.** Stop, and mail the coordinator the trace
  that `python3 check.py SCENARIO` prints. Never weaken an invariant to pass. The coordinator rules whether the spec
  or the abstraction moves, and the ruling is a deviation entry. If a scenario hits the bound, cut the scenario down
  (fewer questions or ticks, never fewer invariants), and say what was cut in the results note.
- [ ] **Step 4: Record** in the results note: each scenario's state count and the invariants it checked; the mutation
  table; each switch's section and verdict from Step 1; and what the model leaves out (the last section of
  `REPORT.md`). Commit.

```bash
git commit -m "docs(overlord): W0 Task 7, the first model re-run on the merged edition: every invariant, every planted mutation"
```

### Task 8: Fleet reads, under consent (W0-06, W0-09, W0-12, W0-19, W0-26)

**Files:** Modify: the results note.

- [ ] **Step 1: Restarts and roll times.** `python3 deploy/measure-working-state.py --section deaths --section spawn
  --since <YYYY-MM-DD, 30 days ago> --json`. Then a scratch reader outside the tree, run under `python3 -I`,
  importing the instrument's `journal`, `journal_facts`, `reg_dir` and `read_lines`: (a) from `journal_facts`'s
  `claude-session@<id>` starts, the starts per session per clock hour (W0-26); (b) from ccd's lifecycle journal,
  `$REG/.lifecycle/journal-*.ndjson`, each `hibernate` act whose reason is `roll`, to the same session's next start
  in (a) (W0-06). Report counts, p50, p95 and p99 only, never a session id.
- [ ] **Step 1b: The lanes' builds.** Each account config directory's `.last-update-result.json` `version_to`, by
  stand-in name. A lane on a build outside Task 1's pair is noted against every rig row.
- [ ] **Step 2: The memory and config census.** Setup line 4's listing, per account config directory, as counts by
  kind and settings key names. No value leaves the box.
- [ ] **Step 3: Fallback notices.** `ccrc history` read verbs for the notice text Task 1 recorded: a count per week.
- [ ] **Step 4: Record and commit.**

```bash
git commit -m "docs(overlord): W0 Task 8, fleet reads: restarts, rolls, the config census and fallback notices"
```

### Task 9: The subject (W0-20, W0-21, W0-22)

**Files:** Modify: the results note.

- [ ] **Step 1: Preconditions.** `ccd ls` shows the subject on `scratch-a` in `project-w0`; `ccd caps` advertises
  `swap-busy-v1`. Any miss is a stop, reported to the coordinator.
- [ ] **Step 2: W0-20.** Mail the operator (through the coordinator) ten texts, each a small closed task. Each text
  reaches the subject twice: once sent by the operator from the console's prompt, once mailed by the conductor.
  Odd-numbered texts go typed first, even-numbered ones mailed first. From the subject's transcript, the time from
  send to first tool call and to reply, and the mail gate's wait from the mail rows. Whether each was done as asked.
  The operator's ratings.
- [ ] **Step 3: W0-21.** Mail the subject three facts, and ask it to write them to `<cwd>/w0-card.md` and acknowledge.
  Then `ccd swap <subject> <scratch-b lane>` at idle; ask the operator for `/clear`; mail the subject to read
  `<cwd>/w0-card.md`; ask three closed-form questions about the facts. Then the same with `ccd swap --interrupt`
  while it runs a long task. Record each answer against the facts.
- [ ] **Step 4: W0-22.** For each lane the operator named under setup line 6, swap the subject there, then: the
  canary question, a denied command, a reader started, a closed-form probe after `/clear`. Swap it back after each.
- [ ] **Step 5: Record and commit.**
  `docs(overlord): W0 Task 9, nudge-and-read, swaps with a stand-in renewal, lane records`

### Task 10: Account facts (W0-23, W0-24)

**Files:** Modify: the results note.

- [ ] **Step 1:** Record the operator's per-account billing answers by stand-in name.
- [ ] **Step 2:** At each `/usage` reading's minute, read the sweep's `$REG/usage/sweep/latest.json` for that account:
  `perAccount.<id>.fableShare.estimate` and `.sevenPct`, and the top-level `finishedAt`. Compute
  `sevenPct × estimate` against the Fable share of the window that `/usage` shows. If W0-18 found a per-model field,
  compare with it too.
- [ ] **Step 3: Record and commit.** `docs(overlord): W0 Task 10, billing per account and the Fable proxy's error`

### Task 11: The replay quiz's baseline (W0-28)

**Files:** Modify: the results note.

- [ ] **Step 1:** Mail the history programme's coordinator (§3.3.9: each fix extends its owner, and this programme
  asks the owner's coordinator first): W0 needs a baseline for M13.
  Name the minimum evidence, as that ledger's Carried constraints require: one quiz over live coordinator families,
  recall on, no A/B window.
- [ ] **Step 2:** Put two options to the operator, with that coordinator's answer: (A) a reduced run now, through the
  runbook's quiz acts under the operator's hand, with a spend cap; (B) the baseline is the first run of W1a's weekly
  quiz lane, taken before any W1a arm is armed. Recommended: B (D-8207).
- [ ] **Step 3: Record the ruling** and, for A, the score and spend. Commit.

### Task 12: The as-measured lines, the PR and the wave-done

**Files:** Modify: `docs/superpowers/specs/2026-11-09-overlord-design.md` (one "As measured (W0, <date>)"
paragraph each in §1.2, §3.3, §3.3.3, §3.3.4, §3.3.7, §3.3.11, §3.4, §3.6, §3.8, §6.4, Table 11.5b's notes and
§11.7, each naming the results note).

- [ ] **Step 1:** Write each paragraph: the measured answer, the build, and the design choice it selected. Changes to
  the design that an outcome selected are proposals in the results note's last section, for the coordinator.
- [ ] **Step 2:** The private-name check of Global Constraints, then from `server/`, each alone in the foreground:
  `test/topology-clean.test.ts`, `test/dtbd.test.ts`, `test/anchors.test.ts`, `test/citations.test.ts`,
  `test/docs-parity.test.ts`, `test/delegation-rig.test.ts`, `test/delegation-rig-w0.test.ts`,
  `test/delegation-fixtures.test.ts`, and after
  `git fetch origin main`, `test/deviation-refs.test.ts`. Expect all green.
- [ ] **Step 3:** Commit, push and open one PR. Never merge, enqueue, rebase or update-branch it.

```bash
git commit -m "docs(overlord): W0's as-measured lines in the spec"
```

- [ ] **Step 4:** After the PR's run on the exact tip finishes, send one wave-done with each row's answer in one line.

## Deviations found

The programme's run (1774) minted these numbers on 2026-11-11. They are defined in the programme's index plan,
`docs/superpowers/plans/2026-11-10-overlord.md`; each entry here gives the whole decision, after its number and old slug.

- **D-8202, w0-rig-not-kit, method** — the platform rows are measured with the delegation broker's rig against a mock
  API, not on a lent account. It extends the tree's one harness for driving the binary, costs no spend and is
  deterministic. Only what needs a real model or a real swap uses the subject.
- **D-8203, w0-rig-bypass, safety** — the rig's "never a permission bypass" rule gains one exception, scenarios under
  `scenarios-overlord/`, because the launch being measured is ccd's bypass launch. The delegation corpus stays
  bypass-free, and a test holds it.
- **D-8204, w0-listed-order-is-w1, scope** — "whether the swap honours the listed account order" cannot be measured,
  because no listed order exists. W0 characterises today's pick (W0-25), and the order is W1's (C56).
- **D-8205, w0-flagged-switch-emulated, method** — a flagged request cannot be caused on purpose. The rig emulates its
  documented refusal, and the fleet's history counts the real ones.
- **D-8206, w0-inbox-socket-docs-only, method** — the inbox socket is judged from documentation only. No undocumented
  interface is probed.
- **D-8207, w0-quiz-baseline-deferred, scope, if ruled B** — §3.3.9 C52 says W0 runs the replay quiz once as the
  baseline; under B, M13's baseline is the first run of W1a's quiz lane instead.

**Found by W0a (run 1774), waiting for their numbers.** The coordinator issues each number and defines it in the
index plan; the whole decision is in the results note's "Departures from the plan"
(`docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md`).

- **w0a-rig-tooling-beyond-the-named-files, method** — Tasks 5 and 6 add rig features Task 2 did not list (the mock's
  padded reply, `cfg2` files and an `@RIG_PROJECT@` path, a `paneSnap` verb, the emitter's tag and payload summary,
  transcript sizes), and fix round 1 adds a scenario's `mainMarker`, the bare-flag list and `run_opts`. Each has a test
  where the rig's tests reach it without a real launch (the run-time verbs' came in fix round 1, after the code);
  `cmd_run`'s mock start with `MOCK_REQDIR` and its `logs/` directory are untested, because they act only in a real
  launch. Step timings go to their own file, not `notes`.
- **w0a-scenario-arms-split, method** — one environment per run, so two scenarios are two files each and the subagent
  model three; `ov-forks` sets the fork and agent-view switches in one run, never the agent-teams switch, with one fork
  relaunch under both; the renewal timing runs resumes before fresh starts; the idle arms seed reported usage. Tasks 5
  and 6 share a commit, and Task 5's long-run results landed in Task 7's; the pull request is squash-merged.
- **w0a-force-arm-pins-sources, method** — ccrc's D-6798 arm refuses every Agent call under
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, so the force arm pins its setting sources to measure the model; the refusal is
  measured on its own, with ccrc's hook loaded (`ov-subagent-model-force-hook`, W0-11).

**Settled by the spec's later edition, so no longer deviations:** W0 changes nothing that runs,
and its test-only files ship (§14). W0 measures a swap with a stand-in renewal, and W1a measures the real act
(§3.4). The first model is a dependency-free explorer (§11.7).

## Where things stand

**Before it starts:**
- The operator approves this plan, and the spec lands at `docs/superpowers/specs/2026-11-09-overlord-design.md`
  (Task 12 edits it there).
- W0a (Tasks 1 to 7) needs nothing else, on a Linux box with at least one installed Claude Code build.
- W0b (Tasks 8 to 11) needs the setup item answered, and the scratch accounts free: continuity wave 5's Task 4 ended.

**What depends on it:** W1a (the anchor slot's ceiling, the renewal deadlines and budget, the PreCompact arm's
arming, the idle switch, the per-prompt delta) and W1 (the launch profile, the door process or its fallback, the
model-switch journal, the restart bound and the reservation's Fable arm).

**Open questions for the operator, most important first:**
1. **The bypass exception in the rig.** Recommended: yes, scoped to `scenarios-overlord/`, with the corpus test. The
   alternative measures the profile without bypass, which is not the launch ccd makes.
2. **The replay baseline.** Recommended: option B in Task 11. It avoids reviving the history study the 2026-11-02
   ruling skipped, and it measures the same lane M13 later reads.
3. **Two runs or one.** Recommended: two. W0a (Tasks 1 to 7) needs no setup and can start at once. W0b (Tasks 8 to
   11) starts when the setup item is answered. Task 12 follows both.
4. **Reuse wave 5's scratch accounts?** Recommended: yes, after its Task 4, never beside it.
5. **Which lanes get a record?** Recommended: one client-side record per installed build, which covers every
   Anthropic account. Another provider's lane waits for the spec's Waiting on you ruling 6.
6. **The model's tool.** Settled: the spec recommends a dependency-free explorer for the first model (§11.7), and
   that model exists as research (Task 7).
7. **Commit W0's captures as fixtures?** Recommended: no. The results note holds the facts. W1a captures again when it
   pins a behaviour in a test.
8. **Re-measurement on a model-class advance** (§3.3: "W0 and the probes measure it again"). Recommended: the
   `scenarios-overlord/` set is the re-measurement. W1a adds a line to the rig's README saying when to run it.
