**Research** · 2026-11-09 · Status: findings for the operator's review · Related: the ccd file-split plan (docs/superpowers/plans/2026-11-06-ccd-file-split.md) and the Overlord spec draft (its §H2 SessionHost port)

# Session host research: what can leave the screen


This report covers the ccd harness. It asks which of ccd's and the server's screen reads and keystrokes can move to official Claude Code channels, and which must stay on tmux.

- **Repo read:** ccrc-pwa at commit 2e145d2c9.
- **Claude Code read:** 2.1.321, from its saved docs and the binary's strings.
- **Method:** read-only. Each of the 44 facts had a mapping pass and an independent verify pass, and the corrections are applied here. A later review pass found gaps, and the verified amendments are also applied. Claims that still need a live probe are named, not assumed.

## 1. Answer first

| Verdict | Count | Meaning |
|---|---|---|
| replace | 12 | Official Claude Code channels cover the whole fact. No screen read or keystroke is needed. |
| partial | 23 | Most of it moves. A named piece stays on the screen or the keys. |
| keep-tmux | 8 | This is hosting. tmux is the right tool and should stay. |
| no-alternative | 1 | Nothing in Claude Code can answer it (process-table proof, F13). |

The mapping pass said 11 replace and 24 partial. The verify pass moved F32 to replace, because TaskCreate and TaskUpdate calls already reach ccd's PreToolUse and PostToolUse hooks with status and activeForm.

- **Observing can almost all leave the screen.** Hooks, `<configDir>/sessions/<pid>.json`, the statusline JSON and the transcript carry nearly every observe fact, and many are already wired in.
- **Driving mostly cannot leave the keys yet.** Built-in menus have no answer channel. Operator turns and slash commands still need typing unless ccrc ships a mod.
- **Hosting stays on tmux.** `claude --bg` has the same shared fate as one tmux server. It also stops after 1 hour idle and has no CLI way to send a turn.
- **A human and ccd share one pane.** The PWA drawer is a real tmux client (`attachPty` runs `tmux attach`). Hooks and the status file do not change that, because the draft guard exists for the case where a human is typing in the box. So every key fallback keeps three vetoes: a draft in the box, a pane in copy-mode, and a pane too narrow to read.
- **Three screen reads have no replacement:**
  - the human draft in the input box (outside of mods);
  - the open built-in menu's rows and cursor;
  - the "something covers the box" veto for sessions with delegated work running.

The three corrections that matter most:

1. **Child approvals are switched off on 2.1.321.** `APPROVAL_HOOK_VERSIONS` in `shared/api.ts` allows only 2.1.296 to 2.1.302.
2. **The menu may not appear on the fleet.** Every fleet session runs `--remote-control`. (Not so: the fleet runs without it, and Q3 keeps it off; see §6.1.) The docs say those sessions do not start the usage-limit wait on their own, and the menu has to be opened by hand.
3. **"Dialog open" disappears while delegated work runs.** Claude Code writes `busy` with no `waitingFor` instead, which is the usual state of a coordinator.

Section 7 lists every tmux call site by class and maps each class to a fact, so the inventory can be checked for completeness.

## 2. The table

Confidence: H = high, M = medium, L = low. "(c)" means the verify pass corrected the mapping.

| # | Fact | Today | Replacement channel | Verdict | Conf | Stays on screen / keys |
|---|---|---|---|---|---|---|
| F01 | Pane alive | `tmux has-session`, 8 s deadline | None. Optional extra fact: pid + procStart. The server never reads `procStart`; only ccd's child-record check uses it, so the server has no guard against pid reuse | keep-tmux | H | Nothing (tmux metadata) |
| F02 | Which process is the session | pane_pid, session_created, /proc, cgroup | `agents --json` or `sessions/<pid>.json` by sessionId; startedAt | partial | H | cgroup, tmux server pid, live-pane set |
| F03 | Addressing and self-id | `display-message '#S'` on every hook | `CCRC_SESSION_ID` env on both spawn lines, checked against the hook's session_id | partial | H (c) | id-to-target naming; teammates don't inherit the env |
| F04 | Create and place the tmux server | One shared server | Per-session or per-project servers | keep-tmux | H (c) | All (hosting) |
| F05 | Start or resume | new-session + 2 s settle guess | `remain-on-exit failed` for an exit code; SessionStart as a hint | keep-tmux | H (c) | Hosting; never drop `exec` |
| F06 | Launch config | env + `--settings` | Already official. Pin `tui` (or `CLAUDE_CODE_NO_FLICKER=0`) in the spawn `--settings`/env so a saved account setting cannot change the renderer; trust at repo root; `--effort`. See §2a for the env, file and settings ties; not all of them are official | replace | M (c) | Nothing |
| F07 | Supervision | unit, probe, stamps | None needed | keep-tmux | H (c) | Hosting; drop the "status=shell means claude gone" idea (it is wrong) |
| F08 | Stop / kill / hibernate | kill-session; hibernate reads the pane | Turn marker + status file | partial | M (c) | Draft and no-box checks; watchdog banner/menu reads |
| F09 | Account move | pane tail-8 verdict, file carry | StopFailure + quotaLimits rejected; carry unchanged | partial | M (c) | Draft guard; menu fallback |
| F10 | Terminal, drawer, geometry | tmux attach, node-pty, 220x50 | None for interactive sessions | keep-tmux | H (c) | All. The 220x50 pin must stay while any pane read or key fallback remains. Below `READER_MIN_COLS`, `_pane_measurable` makes every typing site stand down (stale Enter, swap, compactor, keystroke gate), so a narrow window makes ccd stop acting rather than act wrongly. The drawer pins before it attaches, but a race and other clients (ssh attach, `sizer.unpin` smallest) can still narrow the window |
| F11 | Auth pane | `tmux -L ccrc-auth-<id>` | None needed | keep-tmux | H | Hosting only |
| F12 | Hook plumbing | settings hooks, generation, flock | Already official; register Notification (not in `EVENTS_JSON` today; see §3a) | replace | H | Nothing |
| F13 | Process using the workspace | /proc, lsof | None | no-alternative | H | Nothing (kernel proof) |
| F14 | Why it ended | journalctl, tmux probe | Keep; add SessionEnd reason and version as hints | keep-tmux | H (c) | Nothing. SessionEnd is a hint: it is lost on SIGKILL, OOM, tmux death, or past 1.5 s |
| F15 | Idle / busy / shell | status file AND pane greps | Status file alone, read only while its pid and procStart are alive; idle age from stamps | replace | M (c) | Nothing, once a "compacting" refusal is added. A stale `busy` file after a crash reads as gone, not busy |
| F16 | Background work live | Stop background_tasks | Already hooks | replace | H (c) | Nothing. Crons are already read: `HIBERNATE_HOLD_MAP` holds `scheduled` from the Stop marker's `crons` count |
| F17 | Which conversation | files + continued-in chain | SessionStart push; `agents --json` for bg follow | partial | M (c) | Fork chain stays on the transcript |
| F18 | Transcript path | munge rebuild | Hook transcript_path latch keyed by session_id | replace | H (c) | Nothing |
| F19 | Content, pending ask | JSONL + spool; pane enrichment | Hook envelope bounded by the status file | partial | M (c) | Menu layout for key answers; a dismissed ask fires no hook |
| F20 | Limit / 429 / auth block | pane regex + transcript | StopFailure + quotaLimits + statusline; Notification `auth_success` / `auth_storage_failure` (2.1.288+) as a sign-in hint | partial | L (c) | 401 outside a turn; menu vs wait; draft veto |
| F21 | Rate-limit menu open | pane regex | status `waiting` + `needs` naming a limit dialog (if written), else "dialog open" + limit evidence | partial | M (c) | Fallback while delegated work runs; whether fleet sessions write `needs` |
| F22 | Auto-continue armed | pane footer | Transcript arm/cancel/fired/stale lines; Notification quota_* | partial | M (c) | Second veto at typing sites. Every DRIVE route (inbox, mod, swap, restart) must check the armed state first, because each one cancels the wait |
| F23 | Account usage, credential health | statusline file, authdead marker | Already statusline | replace | H (c) | Nothing; the at-limit sign is F20 |
| F24 | ctx %, model, effort, pills | sidecar + row scrape | Sidecar; transcript /effort acks | partial | M (c) | Live ultracode after restart |
| F25 | Model/effort running, switch ack | picker scrape, sidecar, transcript | Sidecar; PostModelSwitch; per-turn `effort` in the transcript | partial | M (c) | Picker rows, cursor, dialogs |
| F26 | Operator's /model, /effort | transcript + key journal | Same + PostModelSwitch spool | partial | M (c) | Key journal while ccd types |
| F27 | Input box contents | SGR capture | Mod `prompt.read`; `fill` refuses under a dialog | partial | M | Stash indicator; dialog veto |
| F28 | Dialog over the prompt | parseDialog scrape | Hooks for asks/permissions; status file. Notification `permission_prompt` for sandboxed network prompts (no PermissionRequest fires for these); `elicitation_dialog` / `elicitation_url_dialog` for MCP forms. Both are late hints (about 6 s) | partial | M (c) | Built-in menus, cursor |
| F29 | Prompt or ask waiting | hook + pane pairing | Raise from the hook, gated on status=waiting | partial | M (c) | Hookless dialogs; option order |
| F30 | Undriven turn after --resume | transcript pair + pane fallback | Native resume env already set; transcript alarm | partial | M (c) | Draft check; past-cap resumes land idle silently |
| F31 | Compaction lifecycle | hooks + transcript | Already screen-free; the transcript is the authority | replace | M (c) | Nothing; hook stamps are polluted by subagents |
| F32 | Task list, stall evidence | task files, status, transcript | TaskCreate/TaskUpdate via Pre/PostToolUse | replace (c) | M | Nothing; the nudge itself is F35 |
| F33 | cwd, version, commands | pane pid -> session file | Hook cwd; CLAUDE_CODE_EXECPATH | replace | H (c) | Nothing |
| F34 | Human attached | list-clients | None | keep-tmux (c) | H | Nothing to read. But an attached human can put the pane into copy-mode. Then `send-keys -l` hangs and the text never reaches Claude Code (measured; see the copy-mode note in `buildServer`). Nothing in the repo checks `#{pane_in_mode}` today |
| F35 | Type a turn | send-keys + stash | Inbox socket (Claude Code's `[uds-messaging]` cross-session channel: `CLAUDE_CODE_MESSAGING_SOCKET`, `cc-socks/<pid>.sock`, plus `CLAUDE_CODE_MESSAGING_TOKEN`) for nudges; resume env | partial | M (c) | Operator/coordinator/dispatch turns, slash commands, clip. `--remote-control` is a second input path, and turns sent through it never pass ccd's inject gate or its journal |
| F36 | Answer dialog by keys | cursor walks, digits | `updatedInput.answers` (documented, unmeasured) | partial | M (c) | Built-in menus; expired hook windows |
| F37 | Child permission ruling | PermissionRequest hook | Already official | replace | H (c) | Nothing; dormant on 2.1.321 |
| F38 | Escape | send-keys Escape | Mod `turn.abort` (not the same as Escape) | partial | M (c) | Picker back-out; fallback |
| F39 | Set model/effort | picker and slider by keys | Flags at spawn; mod `turn.step`; PreModelSwitch allow | partial | M (c) | `/effort ultracode`; fallback |
| F40 | Run /compact | send-keys | Native idle compaction (limited); mod `session.compact` | partial | H (c) | Keystroke for small thresholds, near-limit sessions, fast compaction |
| F41 | Enter after a slept reset | pane regex + Enter | Notification quota_auto_resume_stale | partial | H (c) | Enter + empty-box gate |
| F42 | Startup gates | pane poll + Enter; ready = one of five pane markers, including `/rc active` (`_accept_first_run_prompts`) | Pre-accept in settings/config; status for readiness | partial | M (c) | Resume-summary choice; defensive arm; the ready-marker regex (it must handle panes with and without RC) |
| F43 | PreToolUse policy | hook deny/nudge | Already official | replace | H (c) | Nothing |
| F44 | SessionStart context | hook additionalContext | Already official | replace | H (c) | Nothing |

### Shared-settings risk

One session can change settings for its whole account.

- **The renderer.** `/tui fullscreen` saves `tui` to the account's user settings. So does accepting the "Try the new fullscreen renderer?" startup dialog. Either can come from the session itself, from the operator in the drawer, or from a gate answer that goes wrong. Every later session on that account then starts fullscreen.
- **What ccd does today.** ccd declines that dialog with Down+Enter in `_accept_first_run_prompts`, but it never pins the renderer. Nothing in ccd or the server sets `tui`, `CLAUDE_CODE_NO_FLICKER` or `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`. Only the drawer test rig sets them.
- **Why it matters.** In fullscreen the conversation draws on the alternate screen. tmux keeps the old history, but new output no longer goes into it. So parsers that read with `capture-pane -S` (`captureHistory` in `exec.ts`) would see stale text. This part is not measured yet.
- **Effort and model have the same problem.** `/effort <level>` typed plain writes `modelSettings.<model>.effortLevel` for the account. ccd already knows this (D-2808, D-2810), and its picker routes use only the session-only forms. An operator or a session typing the plain form still pins it. `/model ...` with Enter (saved as default) and `fastMode` persist in the same way. One ccd path still types the plain form; see §9.
- **Fix.** Set every key that must be fleet-wide in the spawn `--settings`. Those settings take precedence over user settings, so a pin written by one session cannot spread.

## 2a. Other ties to Claude Code (not screen, not tmux)

These do not read the pane or send keys, so they are not among the 44 facts. They still break when Claude Code changes, so each roll should check them.

- **Spawn flags.** `--settings`, `--resume`, `--session-id`, `--model`, `--effort`, `--name`, `--remote-control`, `--dangerously-skip-permissions`. All are documented. Both spawn sites build them, and so does the resume retry.
- **Spawn env.** `_resume_env` sets `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`, `CLAUDE_CODE_RESUME_PROMPT` and `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP`. Spawns also use `CLAUDE_CODE_SHELL_PREFIX`, `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_OAUTH_TOKEN`. The 2.1.321 env-vars page documents all six.
- **Env the hook reads.** `CLAUDE_CODE_CHILD_SESSION` is documented. `CLAUDE_CODE_SESSION_KIND` is not documented. 2.1.296 also strips it from hook env, so `session-hook.sh` keys forks on `CLAUDE_JOB_DIR` instead (D-4953). Both are version-sensitive.
- **Claude Code's own files.** These are `.claude.json` (`projects[]`, `hasCompletedOnboarding`, `skipDangerousModePermissionPrompt`, `theme`), `.credentials.json` and the `tasks/` directory under `<configDir>`. The swap carry also copies transcripts between config dirs (`_carry_py`, `cmd_carry_dedupe`). None of these is a public contract.
- **Managed settings.** `ccd/history/sweep.mjs` reads `/etc/claude-code/managed-settings.json` and the `.d` drop-in dir. That path was taken from the 2.1.289 bundle.
- **Per-child deny settings.** Children get a deny file through `--settings`. ccd stores its sha256 in `$REG/<id>.deny-settings` (`_child_spawn_compose`) and checks it (CF16).

**Action.** Add a roll check that greps the new binary and the env-vars page for each name above. Treat a missing name as a roll blocker, the same way as the approvals version gate (§3).

## 3. Incident-causing facts

### Rate-limit menu read as a draft

- **Measured:** opening the menu by hand writes `waiting` / "dialog open" to the status file.
- **Not measured:** the auto-open path should write the same, but that comes from reading the binary.
- **Hole:** while delegated work runs, the status file says `busy` with no `waitingFor`.
- **A sharper sign may exist, but it is not proven on the fleet.**
  - Claude Code 2.1.321 gives both limit dialogs their own text in a `needs` field: "choose: continue on usage credits or switch models" and "choose: retry on fallback model or edit prompt". Both are titled "Session paused".
  - Their `waitingFor` is still the generic "dialog open", the same value about ten other dialogs write. So `waitingFor` alone cannot tell the limit menu from any other dialog.
- **Where `needs` lands.**
  - The status file schema now has `state`, `detail`, `tempo` and `needs`.
  - The dialog's own `needs` text is pushed only on the Remote Control / background-takeover path.
  - In a plain session, `needs` is written by Claude Code's own state classifier, and only while a watcher heartbeat is fresh.
  - Nobody has looked at a fleet status file with the menu open.
- **ccrc reads none of it.** `readLiveStateMeasured` in `server/src/livestate.ts` keeps only `status`, `statusUpdatedAt`, `startedAt`, `version` and `waitingFor`. It drops `needs`, `tempo`, `state` and `detail`.
- **Fleet twist:** `--remote-control` stops the automatic wait and the auto-open (see "Claude Code's own limit wait" below).
- **StopFailure(rate_limit) is too broad.** It also fires on plain 429 throttles. Pair it with `quotaLimits` rejected.
- **The armed wait is fully in the transcript.** The cancel line has not been seen on disk yet.

What it becomes:

- **Limit sign** = StopFailure + quotaLimits, dated after the process's birth.
- **Menu sign** = status `waiting` + `needs` naming a limit dialog, when that field is present. Otherwise use the status plus limit evidence. If the status is busy with limit evidence, the pane rung is required.
- **Armed-wait state** comes from the transcript, plus Notification (quota_* matcher).

### 3a. Notification hook (not registered today)

- `EVENTS_JSON` in `ccd/install-session-hooks.sh` lists 11 events. Notification is not one of them.
- 2.1.321 has the types. The binary contains the strings.
- **quota_auto_resume_fired, _stale and _disabled** (2.1.234+) report how the armed wait ended. _stale replaces `_pane_limit_stale` as the main signal, and the pane read stays as the fallback.
- **permission_prompt** is the only signal for a sandboxed command's network prompt, because PermissionRequest does not fire for it. This matters only if a fleet session runs with the sandbox on.
- **elicitation_dialog and elicitation_url_dialog** cover MCP dialogs that no other hook shows.
- **auth_success and auth_storage_failure** cover sign-in.
- **Caveat: some types are late.** permission_prompt, elicitation_* and idle_prompt are timed like desktop notifications. They fire only after about 6 s with no keystrokes (idle_prompt after about 60 s). Each keystroke resets the timer, including ccd's own send-keys. So they are late hints, never gates.
- **idle_prompt is not an idle signal.** It does not fire during a usage-limit wait, or while a background subagent runs. F15 stays on the status file.
- The quota_* types are not on that timer.

### Claude Code's own limit wait (autoContinueAtUsageLimit)

- **What it is.** Since 2.1.234, an interactive subscription session waits out a usage limit and then continues by itself. It is on by default. Neither ccd nor the server sets or reads the setting.
- **Not automatic on the fleet.** The docs say Remote Control sessions do not start the wait on their own, and a person must pick it from `/rate-limit-options`. Every fleet session runs `--remote-control`. The docs add that in a Remote Control session, workflow agents that hit a limit fail instead of pausing.
- **Today's coexistence is a pane read.**
  - `_pane_auto_continue_armed` (D-2229) vetoes every keystroke path.
  - The mail sweep holds nudges while the wait is armed (`auto-continue-armed`, D-2369, `server/src/coord/delivery.ts`).
  - The rescue waits for an armed wait near a reset (`_rescue_armed`).
  - The stale-Enter path `_auto_stale_check` covers the slept-reset case (D-2360).
- **What ends the wait without continuing:**
  - Any prompt sent to the session. That includes ccd's typed turns, mail inject, the idle nudge and the proposed inbox-socket nudge (F35, step 9).
  - An exit. The wait does not come back on resume. Every ccd swap, hibernate and `_watchdog_resume_here` restart is an exit.
  - `/clear`, `/login`, `/resume`, `/tui` and `/restart`.
  - Esc at an empty prompt, or Ctrl+C. ccd's `_route_escape` must not fire into an armed wait.
  - A UserPromptSubmit hook that blocks the continuation prompt. ccd's `session-hook.sh` registers UserPromptSubmit, so it must never block.
- **Cap.** After three automatic continuations the wait stops. The user is pointed to `/rate-limit-options`, which is the F21 menu.
- **Rule for the move off the screen.**
  - The "armed" signal from the transcript and Notification(quota_*) must replace the pane read at every place that reads it today: the keystroke gate, the mail hold, the rescue near-wait and the stale Enter. Feeding a new veto alone is not enough.
  - The inbox socket and mod turn calls count as prompts, so they need the same hold.
  - A D-8123 "Wait until reset" choice (`ccd limit-wait`, `cmd_limit_wait`) ends in a restart in place. That restart drops any native wait, which is fine only because it runs after the reset.

### Idle compaction read as a stall

- **When it fires:** at 0.9 × the cache TTL (54 minutes), with at least 200k tokens and a warm cache, and never near a limit.
- **Prediction:** `prompt_cache.expires_at` in the statusline predicts it.
- **Hook pollution:** subagents pollute PreCompact/PostCompact, so the transcript's `compact_boundary` stays the authority.
- **Option:** `idleCompaction:false` turns it off.

### Child permissions never reached coordinators

- **The channel is right, but the gate keeps it off.** The version allowlist stops at 2.1.302.
- **Fix:** a policy, either a minimum version plus a rig capture per roll, or pinned child builds.
- **New gaps:**
  - Monitor-tool PermissionRequests, where an allow has no effect.
  - ExitPlanMode, which needs `updatedInput`.
- **AskUserQuestion** can be answered by a hook through `updatedInput.answers` (documented, unmeasured).

### tmux OOM stopped 62 panes

- **Keep tmux, with several servers,** each in its own scope.
- **What still shares one fate:** the D-5241 drop-ins already stop OOM from spreading, so the remaining risk is a server crash or wedge.
- **Traps:**
  - about 128 code lines and 16 server files call the default socket;
  - a `tmux` shell function bypasses the wedge deadline;
  - the drop-in is keyed on one unit name, so it needs a `ccrc-tmux-.scope.d/` prefix;
  - **a wrong socket reads as "gone"**, which passes reclaim's attached check and the `_acct_live` count.
- **One resolver for all probes.** Every probe must go through it.
- **`claude --bg` is rejected.**

### Version skew is live now

- **The approvals gate.** `APPROVAL_HOOK_VERSIONS` and `APPROVAL_CWD_TRUSTED` in `shared/api.ts` stop at 2.1.302. `createQuestions` in `server/src/coord/questions.ts` refuses every newer child with `version-unverified`.
- **Workflow controls are dormant.** `WORKFLOW_CONTROLS` in `server/src/workflows/controls.ts` is `{}` by design (D-5939). No version gets any control until captures exist.
- **The pane parsers have no version gate.** `server/src/pane/dialog.ts` and `server/src/inject/send.ts` were measured on 2.1.220 to 2.1.303, as their comments say. They run on every version. A changed layout fails silently instead of being refused.
- **The fleet runs mixed versions.** Under the coordinators-only roll policy, idle workers are never rolled to a new build. One deployed `~/.cc-sessions/session-hook.sh` serves every version at once.
- **What it means.** Every event-based replacement in section 2 must hold on every live version, not only 2.1.321. A probe on one version is not enough.
- **Requirement.**
  - Add a contract test per hook event and per version. It replays recorded hook payloads, status files and statusline JSON for each version the fleet runs.
  - A version without captures is "unverified", and its readers fail closed.
  - The pane parsers get the same version gate.

## 4. Role split

### HOST

Owns F01, F04, F05, F06, F07, F10, F11, F13, F14, F34, and the act halves of F08 and F09.

- One socket resolver, `host_target`, with a TypeScript twin in `shared/tmux-target.ts`.
- One server per session or per project.
- HOST never reads the pane and never sends keys.

### OBSERVE

- **Inputs:** hooks, the status file, the statusline sidecar, the transcript.
- **Outputs:** `hookstate.json`, `turn.json`, the sidecar, plus new files: the transcript latch, the limit marker, the compaction-expected time and the model-switch spool.
- **Pane fallbacks are named and logged, and there are only four:** limit menu, box draft, dialog layout, auth banner.
- **Fail closed:** unknown never means idle, gone or "not blocked".
- **A repo can switch observing off.**
  - `disableAllHooks: true` turns off hooks, the custom status line and the file suggestion command together.
  - Claude Code reads the value that wins under settings precedence. So a worked repo's `.claude/settings.json` or `.claude/settings.local.json` beats the user-scope hooks and statusLine that `install-session-hooks.sh` writes into each wrapper home. A session can write the local file itself.
  - Only managed hooks are immune, and ccrc uses none.
  - ccrc never checks for this today. The setting appears only in `deploy/history-replay.mjs`, where it is set on purpose. A session in such a repo would quietly fall back to pane reads only.
- **Fix:** ccd already passes one `--settings` file to every fleet spawn (`~/.cc-sessions/account-deny.settings.json`, `ACCOUNT_DENY_RULES`, D-6202). Add `"disableAllHooks": false` to that file. The docs say `--settings` beats project and local settings. The bash copy in `install-session-hooks.sh` and the TypeScript side must change together.
- **Detect as well:** register ConfigChange (a probe saw it fire) and log any change that sets `disableAllHooks` or `statusLine`. Treat a session whose hooks go quiet while its transcript grows as "observe unknown", never as idle.
- **End events can go missing, so treat every end event as a hint.**
  - SessionEnd has a 1.5 s budget. A configured `timeout` raises it to at most 60 s. It never runs on SIGKILL, an OOM kill or a tmux server death.
  - SessionEnd runs without the messaging env (`CLAUDE_CODE_MESSAGING_SOCKET` and `_TOKEN` are empty, as measured in a probe). It cannot use the inbox socket.
  - Stop does not fire on an Esc interrupt or an API error. StopFailure covers API errors only. Nothing fires for Esc.
  - PostToolUseFailure does not fire for a cancelled tool.
  - Before 2.1.319, PostToolUse hooks did not start after an interrupt-by-message, so older children differ here too.
- **What reconciles a missing end, in order:**
  1. HOST liveness: the pane and its pid (F01).
  2. The status file `sessions/<pid>.json`. It is trusted only while that pid is alive and its `procStart` matches. A file for a dead pid is left over from a crash, and a `busy` in it means "gone", not "busy".
  3. The census backstop, which ccd already uses for a lost SessionEnd hint.
- **Never close a turn, a session or a delegation from a hook alone.**

### DRIVE

- **Official routes:** launch flags, hook decisions, inbox socket, resume env, and later a mod.
- **Inbox socket caveats.**
  - Each session gets its own socket and token in its env (`/tmp/cc-socks/<pid>.sock` on the probe machine; `/run/user/<uid>/cc-socks/` on Linux).
  - Unless the receiver sets `crossSessionInbound` to `accept`, an inbound message is held and shows the dialog "A message from another session needs your approval". A held message that nobody approves expires.
  - A repo or managed setting of `hold` overrides the user's `accept`.
  - A sender whose permission mode class differs from the receiver's also gets a review prompt.
  - So without `accept`, this channel adds a dialog instead of removing keystrokes.
  - The socket and token env are empty inside SessionEnd hooks, so an end hook cannot use the channel.
  - ccrc has no code for this channel yet.
- **Named key fallbacks:** operator turn, slash command, menu answer, escape, stale Enter, startup gate.
- **One shared gate** for every fallback. It refuses and logs when `#{pane_in_mode}` is 1 (a new check), when the pane is under `READER_MIN_COLS` (today's `_pane_measurable`), or when the box holds a draft.

### Interfaces

- `host_verdict`: verdict, pane pid, birth time, attach count.
- `host_send_keys` / `host_capture`: the only two functions that touch the pane.
- `observe_gate`: replaces `_pane_for_keystroke`, `_idle_for_keystroke` and `_swap_idle_gate`.
- "Safe to stop" facts flow from OBSERVE to HOST.
- DRIVE journals its own actions.

### Where the server sits

- The server consumes OBSERVE's files and calls ccd verbs. This matches the file-split rule "ccd's decisions stay in ccd".
- The server's own pane reads and typing (`sessionFeed.ts`, `inject/send.ts`) become DRIVE fallbacks behind the same gate.
- A future HTTP PermissionRequest hook fits here.
- **The fleet agent is whitelisted.**
  - It reads only `.cc-sessions`, `.cc-limits`, `.cc-clips`, the `<configDir>` trees, the projects root and the named `~/.ccrc` node files.
  - It runs only `tmux` (has-session, list-panes, capture-pane, send-keys, resize-window) and `ccd` (`checkPath` and `EXEC_WHITELIST` in `agent/src/whitelist.ts`).
  - `cc-socks` is outside those roots. Any server-side send over the inbox socket needs either a new ccd verb that runs on the box, or new agent whitelist work. ccd's own on-box sends do not need the agent.

### Relation to the file-split plan

The role split sits on top of the slices. It does not replace them.

- **Different kinds of change.** The slices are pure, byte-identical moves by DDD context. The role split changes behaviour.
- **The roles cut across contexts:**
  - HOST code is in C2/C1 (slices 7, 8, 13);
  - screen code is in C3 (slices 6, 9);
  - limit code is in C1 (slices 12, 13).
- **Some of those slices have not moved yet:** slice 6 (`conversation-transcript`: `_pane_tail`, `_compact`, `_auto_compact`), slice 9 (`conversation`: the `_route_*` code), slice 12 (`accounts-swap`: `_auto_swap`, `_limit`, `_tick`, `_strand`, `_rescue`) and slice 13 (`accounts`: `cmd_account_pane`). Today `ccd/lib` holds only six older files. Role PRs that touch these functions must be ordered against those slices.
- **Suggested way to combine them:**
  1. Land the slices as planned.
  2. Add a role column to `ccd/contexts.tsv`.
  3. Decide where the shared harness code lives. Neither option in the plan is open today.
     - The plan's home rule (Task 7) says a new function must sit in a library of its own context. Only C1, C2, C3, C4, C5, C7 and C9 get a home, so a "harness" library that serves several contexts has none.
     - Kernel (K) code has no home and stays in `ccd/ccd`. But Task 8 (ruled Q8) caps `ccd/ccd` at 10 new lines per PR, with no waivers. `host_send_keys`, `host_capture`, `observe_gate` and their version and hook-event tables will not fit in 10 lines.
     - So the shared gates need one of two things. Either an operator ruling adds a harness context (a new row value in `ccd/contexts.tsv` and a home in Task 7). Or each piece lives in one owning context (for example `observe_gate` in C3 `conversation`), and the other contexts call across it, which the cross-context count in `ccd-contexts.test.ts` must then allow. This is operator question 13. Ruled: a Session host context (§6.1 Q13).
- **Lane:** role PRs count as "features" under the lane rule, so moves yield to them.
- **Work that can start without the lane:** `session-hook.sh`, the hook installer, the server readers and `shared/api.ts`.

## 5. Migration order

| Step | Change | Value | Risk | Measure first |
|---|---|---|---|---|
| 0 | Version policy: approvals allowlist, plus per-event per-version contract captures for every channel used in steps 1-9. Ruled: every idle session rolls and each session's build is tracked (§6.1 Q1) | High | Low | Fleet version spread (workers are not rolled); hook calls vs request rows; one rig capture per live version |
| 0b | Pin `disableAllHooks:false` in the account-deny `--settings` file; register ConfigChange | High | Low | Grep fleet repos' `.claude/settings*.json` for `disableAllHooks` and `statusLine`; one rig run with a repo that sets it to true |
| 1 | Register Notification; capture StopFailure. The `--remote-control` question is dropped (§6.1 Q3) | High | Low | Does StopFailure fire at a real limit? Wait or menu with `--remote-control`? Which Notification types fire in a tmux pane where ccd sends keys, and how late? |
| 2 | Shadow logging of pane vs event verdicts | High | None | A week of disagreements, coordinator vs worker; how often a pane is in copy-mode when ccd or the server types |
| 3 | ctx %, model, effort from the sidecar; `refreshInterval` converge | Medium | Low | Sidecar age; CPU per render |
| 4 | Pre-accept startup gates, official settings only (§6.1 Q2) | Medium | Medium | Gate hits per type; which resume dialog appears; does a saved `tui` reach fleet sessions, and what does `capture-pane -S` return from a fullscreen pane? |
| 5 | `CCRC_SESSION_ID`, transcript latch, EXECPATH version | Low | Low | Hook latency; uuid mismatch rate |
| 6 | Drop pane greps from idle gates; add a compacting refusal | Medium | Medium | Zero true-busy misses in step 2; stale status files after crashes (pid dead, file present) |
| 7 | Event-based limit and menu sign. The native wait is pinned off, so ccd always swaps (§6.1 Q4) | High | Medium | Step 1 captures; coordinator limit hits with delegated work; does the three-continuation stop open the menu or write `waiting`? |
| 8 | Hook-raised asks, gated on status=waiting | Medium | Medium | PermissionRequest for AskUserQuestion on the current build |
| 9 | Inbox socket for nudges. Ruled: refuse now; later a password-gated fast path beside ccrc mail, after the probe (§6.1 Q5) | Medium | Medium | Wire format and token use; that `accept` delivers with no dialog; behaviour when the permission mode class differs; how reliably nudges are acted on; does an inbox message or mod turn end an armed wait? Prerequisite: operator question 5, and a ccd verb (not agent whitelist growth) as the sending path. Run as one probe with the Overlord's W0 item (§8 A3) |
| 10 | tmux servers per session or project. Ruled: one server, one lookup function and a CI guard now (§6.1 Q8) | High | High | Server RSS; wedge/crash counts; default-socket grep guard |
| 11 | Mod spike. Parked (§6.1 Q7) | Medium | High | Each call's behaviour on a private socket |

Live probes still owed:

- StopFailure at a real limit;
- what a `--remote-control` pane shows at a limit (dropped, §6.1 Q3);
- the status file during the menu with delegated work running;
- the status file's `needs`/`tempo` fields during the limit menu on a `--remote-control` fleet session (dropped, §6.1 Q3);
- the Esc cancel line on disk;
- `updatedInput.answers` closing an ask;
- the idle-compaction trigger value;
- whether `agents --json` starts a supervisor on Linux;
- inbox message framing;
- that the `--settings` pin beats a project-local `disableAllHooks: true` on 2.1.321, for both hooks and the status line;
- capture-pane history growth under fullscreen;
- a capture of every hook event used, on each Claude Code version the fleet runs (not only 2.1.321).

## 6. Operator questions

1. Version policy for approvals and every event channel: a minimum version with a capture per roll, or pinned builds? Should idle workers be rolled, so the fleet does not stay mixed?
2. May ccrc write Claude Code's `.claude.json` (trust at the repo root, imports approval)? This would reverse the 2026-09-19 ruling.
3. Keep `--remote-control` on every session, given that it changes limit behaviour? It is also a ready marker at start-up, and an input path that skips ccd's inject gate.
4. Pin `autoContinueAtUsageLimit` off (always swap) or on (wait), or leave the default? Turning it off removes the D-2229/D-2369 holds and the rescue near-wait. Turning it on keeps every new DRIVE route under the armed-state hold.
5. `crossSessionInbound=accept` on every fleet session, so inbox mail lands without the "A message from another session needs your approval" dialog? Without it, held messages expire. For the Overlord the answer is already "no": its spec's H4 counts an open peer channel as a failure (§8 A3).
6. Native idle compaction, or `idleCompaction:false` with ccd's compactor?
7. Ship a ccrc mod into every session (spike first)?
8. tmux servers per session or per project?
9. Keep the screen draft guard, or a "never type while a human may be typing" policy?
10. Add a busy gate to `ws-rm` (it would refuse where it kills today)?
11. Billing and headless hosting. The draft cited a note that `-p` and the SDK still bill to the subscription "for now". The saved 2.1.321 docs do not say that, and do not say how `-p` or Agent SDK use is billed at all. They say only that an `ANTHROPIC_API_KEY` is always used in `-p` when present, and that `-p` runs, Agent SDK runs and background sessions never get the usage-limit wait. Check the current billing terms before reopening headless hosting. Until then, interactive stays the rule.
12. Approve a probe budget on a test box?
13. Does the harness layer get its own context in the file-split plan, or does each piece live in one owning context?

### 6.1 Rulings (operator, 2026-11-10)

- **Q1, versions: a minimum version with an automatic capture, and every idle session rolls.** A build is trusted once a test-box capture of its hook and status-file output passes the replay tests, and each new build gets that capture automatically. Every idle session, not only coordinators, rolls onto the newest installed build as soon as it is idle. This reverses the 2026-10-29 coordinators-only roll rule. The console shows each session's running build next to the latest expected build.
- **Q2, `.claude.json`: keep the ruling.** ccrc never writes Claude Code's account file. The start-up keystroke answers stay, and step 4 covers official settings only.
- **Q3, Remote Control: off on the fleet, as a recorded rule.** The report's Remote Control branches are dropped: the `/rc active` ready marker and the Remote Control-only limit-menu path. The fleet already runs without the flag, so the "every fleet session runs `--remote-control`" premise in §1 and §9 does not hold. ccrc's own app stays the only remote way in.
- **Q4, the limit wait: pinned off, always swap.** `autoContinueAtUsageLimit` is pinned off in the `--settings` file ccd passes to every spawn. ccd always swaps the session to an account with room. The operator gets the options, such as waiting until the reset, only when no account has room. Once that has been seen working, the four screen-read holds are deleted: D-2229, D-2369, the rescue near-wait and the stale-Enter check.
- **Q5, the inbox: refuse now, keep typed nudges.** `crossSessionInbound` is set to refuse in the spawn settings, and nudges stay typed behind the idle check. Later, after one test-box probe shared with the Overlord's W0 item, the inbox becomes an extra fast path for Claude Code sessions only. It is password-gated, so only ccrc can deliver through it and never any same-user process. ccrc mail stays the record and the channel every lane uses, other lanes included, and the typed nudge stays the fallback. A failure on either path loses nothing, because the mail is already stored.
- **Q6, idle compaction: keep both.** ccd pins idle compaction on in its start-up settings and reads the statusline's cache expiry time instead of assuming 55 minutes.
- **Q7, a ccrc mod: parked** until the architecture refactor and steps 0-9 are done. The refactor was measured on 2026-11-10: every wave is done and two small items remain, both waiting on another programme's ack.
- **Q8, tmux servers: keep one server.** Every tmux call goes through one lookup function now, with a CI guard against new raw calls, so a later split is a config change.
- **Q9, the draft guard: keep it.** The copy-mode and width checks join the draft check in one shared check that logs each refusal.
- **Q10, `ws-rm`: no busy gate.** It stays as it is: only a person at a terminal runs it, and the UI and server already use the guarded archive path.
- **Q11, headless hosting: stays closed.** Interactive Claude Code stays the rule.
- **Q12, live probes: on the test box only,** with a scratch account, its own config folder and tmux socket, one test at a time, owned by the harness programme. They wait for the test box rebuild and the scratch account.
- **Q13, file split: a Session host context.** One new context in `ccd/contexts.tsv` with a home library (for example `ccd/lib/sessionhost.sh`) owns hosting, observing and driving behind the one interface of §8 A4. Its PRs are ordered against slices 6, 9, 12 and 13.

The recommendation in §8 now reads under these rulings.

## 7. Touchpoint census

Counted at commit 2e145d2c9 by grep, so the numbers are approximate. Every class below maps to a fact in the table, and no class is left without one.

ccd/ccd raw tmux calls: capture-pane 31, send-keys 24, kill-session 19, new-session 17, list-panes 12, has-session 11, display-message 7, list-sessions 6, set-option 5, resize-window 3, list-clients 2, start-server 1. The `_tmux_t` target helper appears about 53 times. Some of these are comments, not calls.

| Class | ccd functions | Facts | Role |
|---|---|---|---|
| Dialogs | `_accept_first_run_prompts`, `_answer_two_option_dialog`, `_pane_box_dialog`, `_pane_login_screen` | F28, F36, F42, F20 (login) | OBSERVE fallback + DRIVE fallback |
| Limit and stand-down | `_pane_limit_capture_to`, `_session_hard_blocked`, `_standdown_probe`, `_standdown_outside_tail`, `_tick_strand_undecidable`, `_swap_rescue_act_gate`, `_auto_stale_check` | F20, F21, F22, F41 | OBSERVE |
| Swap and redrive | `_auto_swap_check`, `_swap_idle_gate`, `_redrive_after_spawn`, `_inject_spawn_effort` | F09, F30, F39 | OBSERVE gate + DRIVE |
| Model and effort routes | `_route_type_model`, `_route_model_ack_wait`, `_route_model_close`, `_route_type_effort`, `_route_effort_ack_wait`, `_route_escape`, `_route_apply_check` | F25, F38, F39 | DRIVE |
| Compact and clear | `_auto_compact_check`, `_compact_no_turns`, `_route_compact_settling`, `_route_note_clear` | F31, F40 | OBSERVE + DRIVE |
| Keystroke gating | `_idle_for_keystroke`, `_pane_for_keystroke`, `_pane_measurable` | F15, F27 | becomes `observe_gate` |
| Watchdog banner | `_watchdog_sign_to` | F08 | OBSERVE fallback |
| Auth pane | `cmd_account_pane` (own `-L ccrc-auth-<id>` socket) | F11 | HOST |
| Clip | `cmd_clip` (list-clients, then send-keys) | F34, F35 | DRIVE fallback |
| Hosting | new-session, kill-session, has-session, list-panes, list-sessions, set-option, resize-window, start-server | F01, F04, F05, F07, F08, F10 | HOST |
| Self-id | display-message '#S' | F03 | HOST, then env |

**Server side.**

- **capture-pane / send-keys by file:** exec.ts (9), server.ts (4), inject/send.ts (4), pane/statusline.ts (2), and one each in inject/ask.ts, workflows/controls.ts, coord/dispatch.ts, coord/dispatchDecide.ts, coord/envelope.ts and coord/store.ts. Several of the single hits are comments.
- `pty.ts` runs `tmux attach` for the drawer (F10).
- `exec.ts` and `sessionws.ts` run has-session and list-panes (F01).
- `pane/dialog.ts` and `pane/askPairing.ts` parse captured text (F19, F28, F29).
- `pane/statusline.ts` scrapes the row pills (F24).
- `inject/send.ts` and `inject/ask.ts` type turns and answers (F35, F36).
- About 50 server files mention tmux in all. Most of them only consume ccd's verdicts or mention tmux in comments.

Some names that came up in review are not tmux users. `ledger.ts` has no `tmux wait-for`; the only match is the phrase "wait-for-the-sweep" in a comment. `_launchd_class` and `cmd_delegation_adopt` do not call tmux.

Before the role split lands, redo the census with a guard that fails CI on any new raw `tmux` call outside `host_target`, `host_send_keys` and `host_capture`.

## 8. Alignment with the Overlord's SessionHost port

**Sources.** The Overlord spec draft (docs/superpowers/specs/2026-11-09-overlord-design.md, in review), this report, the repo at 2e145d2c9, and Claude Code 2.1.321's docs and binary strings. Nothing was probed live.

**Repo check.** No `SessionHost` or `CallerIdentity` exists in the tree yet. One host-side port already exists: `DispatchRunDeps.sendClear` (`server/src/coord/dispatch.ts`, used by `ActPlan` in `dispatchDecide.ts`). That makes three possible port definitions today, not two.

### A1. Each port operation and identity strength, mapped to this report's roles and facts

**`SessionHost`** (spec §3.6 H2; Table 11.1c; §3.3.1 C36; §3.3.11 H12/H13)

| Spec operation | Where the spec defines it | Report role | Facts that carry it | Fit |
|---|---|---|---|---|
| `renew(session, n)`: end the conversation, start a fresh one with the same id and the role's profile. Idempotent on n | H13. Today's adapter is `ccd hibernate --roll --fresh`, capability word `hibernate-fresh` (Tables 11.1c/11.1d) | HOST (act), fed by OBSERVE's "safe to stop" facts (§4, Interfaces) | **Act:** F05 start/resume (keep-tmux), F06 launch config (replace; it carries the profile and the door process's launch nonce), the act halves of F08 and F09.<br>**Preconditions (§3.3.11, from `hibernate.ts`):** turn finished = F15; no background task = F16; no scheduled task = the Stop marker's `crons` (`HIBERNATE_HOLD_MAP.scheduled`); no menu or dialog = F21/F28; no running reader = SubagentStart/Stop (F12); draft = F27; attached terminal = F34; recent swap = F09 | Good. Two of the preconditions (draft, menu) are the report's "stays on screen" residue |
| `receipt`, first half: the old conversation ended | H12, receipt | HOST verdict | F01 pane alive, F02 pid plus procStart from `sessions/<pid>.json`, F14 SessionEnd reason as a hint only | **Must come from the HOST verdict, not an event.** SessionEnd has a 1.5 s budget, does not fire on SIGKILL, OOM or tmux death, and runs with the messaging env stripped (§4 OBSERVE) |
| `receipt`, second half: the new conversation started (the card-hash half is a server door, not the host) | H12 | OBSERVE | F44 and F17 SessionStart push (`source=startup`, new uuid), F03 `CCRC_SESSION_ID` checked against the hook's `session_id`, F18 transcript latch | Good. All are replace or partial, at H/M confidence |
| `compact` | §3.3.4 C39, §3.3.9 C51: `/compact <role instructions>`; the PreCompact arm refuses a proactive compaction | DRIVE (act); OBSERVE (confirmation) | **Act:** F40 (partial; the keystroke stays for small thresholds and near-limit sessions; a mod `session.compact` comes later).<br>**Lifecycle:** F31 (the transcript's `compact_boundary` is the authority; subagents pollute the PreCompact and PostCompact hooks) | Partial. See A2 |
| `deliver` | §3.8 H7 (a one-line nudge; the body is read as tool output); §6.8 H19 (one coalesced wake); C24 | DRIVE | F35 (partial; inbox socket for nudges, keys as the fallback); F29 ask or prompt waiting; pickup through UserPromptSubmit (F12) | Partial. See A2 and A3 |
| `contextUsage` | Table 3.3.11b hard cap and soft ceiling; Table 3.6a statusline sidecar ("unmeasured" when stale) | OBSERVE | F24 (partial; the sidecar; live ultracode stays on screen), F23, §5 step 3 | Good once readers switch to the sidecar. Today `parseStatusline` in `server/src/pane/statusline.ts` reads `ctxPct` off the pane |

**`CallerIdentity`** (spec §7.4 C27/H28; §11.2 gate step 1; §3.3.11 fence)

| Strength | What the spec says it is | Report facts | Fit |
|---|---|---|---|
| `attributed` | The box token, the designated id, the current `.uuid`, plus the fence (term, generation, act key bound to the launch nonce) | **id:** F03.<br>**uuid currency:** F17, F18, and the SessionStart uuid rotation.<br>**Nonce delivery:** F06 (env at spawn, HOST).<br>**"Unwitnessed" check (§7.4):** F43 and F12 PreToolUse | Good. One risk: a repo-level `disableAllHooks` silently drops the witness (§4 OBSERVE). That fails closed (`unwitnessed`), which is the right direction, but it should be counted |
| `workload` | A credential that only that session can read | None. F03 notes teammates do not inherit the env | **No channel.** The inbox token (`CLAUDE_CODE_MESSAGING_TOKEN`) is not one: the env-vars page says it is exported to hooks and Bash of the same UNIX user. On macOS and Linux, auth on the socket is optional; the binary says "peers will send unauthenticated (accepted: auth is optional on this platform)" |
| `operator` | The console cookie only | F26 key journal, F27 box contents, F34 human attached, F35 "operator turn" key fallback | These are the pane paths that spec §3.8 says never count as the operator. DRIVE's typed strings must be listed in `INJECTED_PROMPTS` (§3.8), and nothing OBSERVE reads from a pane may be promoted to `operator` |

### A2. What each side has that the other lacks

**(a) Facts the server needs that the port does not have.** H2 lists five operations and no observe surface. Yet the readiness word (§6.4 Table 6.4a), the renewal triggers (Table 3.3.11b) and the drain preconditions (§3.3.11) all read live session facts. "Every input is something the server already measures" means today's pane scrapers (`pane/dialog.ts`, `askPairing.ts`, `statusline.ts`). These are the facts this report moves behind OBSERVE:

| Server need (spec) | Report fact | Gap or caveat |
|---|---|---|
| Idle or busy: drain at turn end; idle trigger at 45 min; `wedged` | F15 (replace, M), F12 | Needs a "compacting" refusal (§5 step 6) |
| `stranded`: last turn failed on its account; limit sign | F20 (partial, **L**), F09 | StopFailure(rate_limit) also fires on plain 429s. Pair it with `quotaLimits` rejected (§3) |
| `dialog-open`: 30 s; precondition "no menu or dialog" | F21, F28, F29 | **Hole:** while delegated work runs, the status file says `busy` with no `waitingFor` (§1, correction 3). The Overlord delegates to readers, so this is its usual state too. Built-in menus have no channel at all |
| Ask pending, `deaf` pickup | F19, F29; UserPromptSubmit | A dismissed ask fires no hook (F19). Child approvals are dormant on 2.1.321 (F37) |
| `contextUsage` while idle | F24; §5 step 3 `refreshInterval` | An idle session's sidecar ages. Table 3.3.11b then reads it as "unmeasured", so the idle and wave-boundary triggers, which need "context above a quarter of the hard cap", never fire. The launch profile should pin the statusline `refreshInterval` |
| Model drift | F25 PostModelSwitch, sidecar model id | Matches the model-switch journal in Table 3.6a |
| Compactions journal | F31 | Must filter subagent PreCompact (by agent_id), or "two compactions" over-counts |
| Resumed versus fresh start | F17, F30 | Past-cap resumes land idle silently (F30) |
| Idle-compaction prediction | Statusline `prompt_cache.expires_at` (§3) | Not used by the spec. Its "45 min before about 55" is a fixed guess |

**Table 3.6a needs this report's new files.** H2 allows a fleet-host file only as a cache or measurement with one writer, a lease and a stated stale answer. The new OBSERVE outputs (§4) are not listed there: the transcript latch, the limit marker, the compaction-expected time and the model-switch spool. Either they join Table 3.6a, or they stay inside ccd behind a typed observe read.

**(b) What the port asks for that this report found no channel for.**

- **`deliver` while a turn runs, with the peer channel closed.** No measured channel exists.
  - Typed text queued during tool calls does reach Claude within the same turn (interactive-mode page). But ccd's keystroke gates refuse to type while busy (F35; `_idle_for_keystroke`).
  - The inbox socket's mid-turn timing is unmeasured. The binary has "Queued events … stay queued until the next prompt", and `send_now`/`cancel_queued` fields exist in the input schema, but whether the socket honours them is unknown.
  - The port should return `delivered | queued-behind-turn | refused(reason)`. §3.8 already names the "queued behind a turn" state. C24's "a fault to fix" then becomes the `wedged` word, not a delivery path.
- **`compact` confirmation.** The ccd adapter can confirm only after the fact, from a transcript `compact_boundary` dated after the act (F31). Nothing acknowledges the act itself.
  - A typed `/compact` while busy is held until the turn ends (commands wait for the turn to end).
  - Whether a PreCompact refusal "leaves the turn intact" (C39, dark until W0) is not on this report's probe list.
  - Only the SDK-host second adapter (H2) confirms natively.
- **`receipt` first half as an event.** No reliable event exists (see A1). It must come from the HOST verdict.
- **The "no menu or dialog" precondition while delegated work runs.** No event channel exists. The pane fallback rung is mandatory there (§3, "Menu sign").
- **`workload` identity.** No channel (see A1).
- **Fresh start's effect on queued input and running readers.** This is a W0 item (§14). F16 covers background tasks, but nothing covers queued input. The binary has a `[carried-prompts]` path, which nobody has examined.

### A3. Inbox socket: this report's finding versus the spec's W0 spike

**What the spec says.**

- H2 (§3.6): the socket could deliver mid-turn, but the Overlord's launch profile closes the inbound peer channel. W0 measures whether the door process alone can use it.
- §14, W0 row: "whether the inbox socket can be used with the peer channel closed".
- "Later": the trigger is that W0 shows it works.
- H1 and H4: `SendMessage` and `ListAgents` are denied, inbound is refused and Remote Control is off. An open peer channel counts as a sandbox-check failure.

**What this report says.** F35 proposes "inbox socket for nudges" (partial). §5 step 9 rates it medium value and medium risk. §6 Q5 asks for `crossSessionInbound=accept`, and inbox message framing is still an owed probe.

**What 2.1.321 says, before any probe:**

1. **The socket is per session.** It lives at `/tmp/cc-socks/<pid>.sock` on the probe machine and is also published as `messagingSocketPath` in `sessions/<pid>.json`. Its path and token are exported to hooks and Bash only (env-vars page). The Overlord has no Bash, and the door process is started by ccd, not by Claude, so it inherits neither. It would have to find the path in the pid file.
2. **The policy is per session, not per sender.** `crossSessionInbound` is `accept`, `hold` or `refuse` (settings reference).
   - `refuse` drops a message before even a mod's `session.receive` sees it (mods API page).
   - With no value set, a message from a sender that does not attest a permission mode is **held** when the session bypasses permissions (binary: `no-mode-asserted`). A held message raises "A message from another session needs your approval". In an unattended pane that is a dialog, so `dialog-open` follows.
   - So the spec's own profile (refuse) blocks the door process too. The only possible escape is the "own-child" token rule (env-vars page; binary: "or is one this session spawned"). Whether it overrides `refuse` or `hold` is the single question W0 must answer.
3. **The socket may not be bound at all.** The binary has:
   - `[uds-messaging] Skipped: restricted session`. If the spec's "restricted launch" (§3.5) means Claude Code's `--restricted` flag (CLI reference), no socket exists, and W0's answer is no without a probe.
   - `Skipped: cross-session messaging gate off`. A server-side feature flag gates the socket, so its presence must be measured at every start. That can be done from `messagingSocketPath` in the pid files.
4. **Delivery shape.** Socket messages are user turns. They fire UserPromptSubmit, which is good for the §3.8 "picked up" tick. But they also land in history as user rows. So only the one-line nudge may use the socket. It must be in `INJECTED_PROMPTS`, and history's `provenanceOf` must tag it by origin (subkind `session-inbox`), not as `operator`.
5. **The agent cannot reach it.** `/tmp/cc-socks` is outside the agent's read roots, and the agent cannot connect to sockets (`checkPath` in `agent/src/whitelist.ts`). Any use needs a new verb, so it is a HOST/DRIVE capability word, not a fleet file.
6. **Q5 conflicts with H4.** This report's Q5 (`accept`) would open the peer channel that H4 counts as a failure for the Overlord. For coordinators, `accept` also lets in any same-user session's `SendMessage`.

**Verdict.** The W0 item and §5 step 9 are the same probe and should be run once, by one owner. The probe matrix:

- policy: `refuse`, `hold`, unset under bypass, `accept`;
- sender: with token, without token, and as an own child;
- outcome: delivered, held or dropped; UserPromptSubmit fired or not; origin kind; mid-turn timing; `send_now`;
- launch: whether `--restricted` binds a socket;
- fleet: the rate of bound sockets across accounts.

Until it passes, `deliver` in the ccd adapter is today's typed one-line nudge behind the idle gate. That is exactly what H2 already says.

### A4. Recommendation: one interface

- **Name.** Keep **`SessionHost`**. It is already cited in H2, C36, H13, Table 11.1c and Table 13 (C36), and renaming costs more than it buys. Declare it once, in the server, at C3 L2, as H2 requires ("declared by its consumer, with a failure contract").
- **Shape: three facets that mirror this report's roles.**
  - **`SessionHost.lifecycle` (HOST):** `start`, `renew`, `stop`, `verdict`, and `receipt` (first half from the verdict, second half from SessionStart).
  - **`SessionHost.observe` (OBSERVE):** typed `LiveFacts`. Each fact is `{value | unmeasured | stale | absent, measuredAt, source: event | pane-fallback}`. The facts: busy/idle/waiting, `waitingFor` or dialog, limit sign, ask pending, `contextUsage`, model, compaction events, pickup, background tasks and crons, readers. This meets H2's "absent, unreadable and stale apart" and this report's "fail closed".
  - **`SessionHost.drive` (DRIVE):** `deliver`, `clear`, `compact`, `answer`, `escape`. Each returns `done | queued-behind-turn | refused(reason)` and, where it applies, a confirmation the server reads through `observe`.
- **Fold `DispatchRunDeps.sendClear`** into `drive.clear`. H13's coordinator `/clear` fast path then uses the same port.
- **Inside ccd.** The adapter's internals are `host_verdict`, `host_send_keys`/`host_capture` and `observe_gate` (§4). The server's own pane readers and typists (`sessionFeed.ts`, `inject/send.ts`, `pane/*`) become DRIVE and OBSERVE fallbacks behind that same gate. That is the only way H2's "ccd alone names tmux" becomes true.
- **Capabilities.** Advertise each facet and operation through `ccd caps`, with `hibernate-fresh` staying the first word.
- **Owner: the ccd harness programme.** It owns the interface file, the ccd adapter, the fact contracts and the merged W0/step-9 probe. Why:
  - The facts are fleet-wide.
  - The existing consumers are not Overlord code: the dispatch lane, the hibernate lane, the mail gate in `watch.ts`, `fleet.ts` live state and the pane readers.
  - The role column already sits on the ccd file-split slices (§4, "Relation to the file-split plan").
- **The Overlord programme is a consumer, not a co-owner.** It contributes its five operations and the readiness, trigger and precondition inputs as contract tests against `observe` and `drive`. Its W1a lands `lifecycle.renew` and `receipt` in the harness-owned file, claimed under the peer protocol ("each fix extends its owner", §3.3.9). It does not wait for the harness migration.
- **Sequence.**
  1. W1a: `renew`, `receipt`.
  2. Harness steps 1-3 and 5-7 (§5) fill `observe`: limit sign, sidecar `contextUsage`, `CCRC_SESSION_ID` and the latch, idle without pane greps.
  3. Harness step 2's shadow log becomes the evidence that lets the readiness word read `observe` instead of the pane.
  4. `deliver` over the socket ships only after the merged probe passes.
- **Spec edits this implies.**
  - H2 and Table 11.1c gain the `observe` facet.
  - Table 3.6a gains the new OBSERVE files, or states that they stay ccd-internal.
  - §14's W0 row cites the merged probe matrix above.
  - This report's §6 Q5 is answered "not for the Overlord" by H4, and ruled "refuse now" for the fleet (§6.1 Q5).

## 9. Found along the way

### ccd's settle-time effort keystroke saves an account-wide default

- **What the routes do.** ccd's live routes are safe. `_route_type_model` and `_route_type_effort` open the picker or slider and press `s`. The 2.1.321 docs say `s` applies the choice "to this session only" and leaves the saved default alone. ccd's ack waits require the `(this session only)` / `for this session only` text. `/effort ultracode` and `max` are session-only by construction.
- **The exception.** `_inject_spawn_effort` types `/effort $SPAWN_EFFORT` plain, then Enter. `SPAWN_EFFORT` is `high`. It runs at settle on every session with no routing record on an Anthropic backend.
  - The docs say a level typed after `/effort` saves "as your default and apply it in later sessions", under `modelSettings` in user settings.
  - The 2.1.321 effort setter answers that form with `Set effort level to high (saved as your default for new sessions)`.
  - It saves to the user settings of that session's `<configDir>`, which is the account's.
  - It does not save when `CLAUDE_CODE_EFFORT_LEVEL` is set, when the level was capped, or when the TUI is a client of a remote session.
- **Effect.** Each no-record spawn re-pins `high` for its current model on that account. Every later session on the account that starts the same model without `--effort` then starts at `high`. This contradicts ccd's own "only the session-only forms" note above `_route_note`. It is a likely source of the per-model pins D-2810 found on the fleet. It is not confirmed live.
- **Fix.**
  - Pass `--effort high` on the spawn argv for no-record sessions too. That is D-2808's lever, and the record path already uses it. Drop the keystroke.
  - If a keystroke must stay, use the slider and `s`, as `_route_type_effort` does.
  - Do not use a top-level `effortLevel` in `--settings`. The docs say that one applies to every model.
  - Add a test that fails if any ccd or server path types `/effort <level>` or `/model <name>` in the plain form.
- **Related, unmeasured.** In 2.1.321 the picker footer offers `s` ("use this session only") only in some states. In the others, Enter reads "confirm" and `s` is not shown. If a fleet session ever opens the picker in such a state, ccd's `s` press would not apply. The ack wait would then report it unconfirmed and press Escape, so it fails safe. Add it to the probe list.

### Other notes

- **Remote Control changes limit behaviour twice.** The docs say Remote Control sessions do not start the usage-limit wait on their own, and that their workflow agents fail at a limit instead of pausing. Both would apply to every fleet session that ran it; Q3 keeps it off (§6.1).
- **The billing note was stale.** The saved 2.1.321 docs say nothing about `-p` or Agent SDK use billing to the subscription "for now". They say only three things. An `ANTHROPIC_API_KEY` always wins in `-p` when present. `-p` runs, Agent SDK runs and background sessions get no usage-limit wait. API-key and usage-based billing is metered per request. Operator question 11 is reworded to match.
- **The server has no pid-reuse guard.** `procStart` is used only by ccd's child-record check, never by the server (F01). This matters once OBSERVE reads `sessions/<pid>.json` without a pane to anchor it (§4, end events).
