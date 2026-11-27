# Wave 2 inventory: the session hook (`ccd/session-hook.sh`) for its Go port

This is a read-only survey for planning wave 2 of spec `docs/superpowers/specs/2026-11-24-ccrc-go-core-design.md`, the
vocabulary generator and its first consumer. Citations use `file#function`, `#@anchor` or quoted names. "The hook"
means `ccd/session-hook.sh`, which is installed as `~/.cc-sessions/session-hook.sh`.

## 0. Shape at a glance

- **Size.** 7,039 lines. Of these, 2,926 are not comments, and the code is about 209 KB. The spec's 6,726 is out of date.
- **Not a dispatcher.** There is one classification `case "$event"` (the line after `_hook_typed_model`'s definition)
  followed by a **linear tail**. Each tail stage tests `$event` itself. So the port is a pipeline of stages gated by
  event, not one function per event.
- **Contract (its header).** Every path exits 0. Writes are atomic or nothing. The hot path takes no lock and does no
  waiting. Six exceptions are declared, all off the hot path except the door witness. Outside one declared exception
  (below), stdout carries only the event's own envelope, at most one line.
- **External engines.** It depends on `jq` hard (`command -v jq || exit 0`): about 103 jq call sites, including two
  large programs that need Oniguruma (section 4). `node` runs the compaction helper, the approval verifier and a
  sha256 fallback. `git`, `flock`, `link`, `mktemp`, `find`, `timeout`/`gtimeout`, `tmux` and `~/.local/bin/ccrc-api`
  are also called.

## 1. Entry and dispatch

### Invocation
- **Registration.** `ccd/install-session-hooks.sh` registers `HOOK_CMD='bash "$HOME/.cc-sessions/session-hook.sh"'`
  with **no argv**. It does so once per event in `EVENTS_JSON` (UserPromptSubmit, PostToolUse, PermissionRequest,
  Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, SessionStart, SessionEnd, PreModelSwitch,
  PostModelSwitch) and once more for PreToolUse with matcher `"*"`. Every entry but SessionEnd's has
  `timeout: HOOK_TIMEOUT_S` (600). SessionEnd runs under Claude Code's own 1.5 s budget, so a Go SessionEnd must fit
  in it too.
- **Mismatch with the spec.** The spec's example is `ccrc-core hook PreToolUse`, but the event comes from stdin
  (`.hook_event_name`). Recommendation: register **`ccrc-core hook`** as one command with no event argv, as bash does
  today. An event argv would need the installer to write 14 different commands.
- **Stdin.** The hook reads the whole payload, `payload=$(cat)`. It reads these fields: `hook_event_name`,
  `session_id`, `agent_id`, `agent_type`, `agent_name`/`subagent_name`, `tool_name`, `tool_input`, `tool_use_id`,
  `tool_response`, `cwd`, `transcript_path`, `agent_transcript_path`, `source`, `reason`, `trigger`,
  `compact_summary`, `prompt`, `model`, `from_model`/`to_model`, `background_tasks`, `session_crons` and `error`.
  The owner of "what is read" is `shared/claudeBuildCapture.ts` (`HOOK_COMMON_RULES`, `HOOK_EVENT_RULES`).
- **Environment.**
  - Always: `HOME`, `TMUX_PANE`, `TMUX` (MSYS only), `OSTYPE`, `EPOCHREALTIME`, `BASH_VERSINFO`.
  - Identity: `CLAUDE_JOB_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`.
  - Incarnation: `CCRC_SESSION_GENERATION`.
  - Build version: `CLAUDE_CODE_EXECPATH` (its basename).
  - Door: `CCRC_DOOR_NONCE_SHA256`.
  - Start loads: `CCRC_LAUNCH_PROFILE`, `CCRC_LAUNCH_RC`.
  - Subagent model pin: `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`.
  - Test knobs: `CCRC_APPROVAL_TICK_S`, `CCRC_APPROVAL_POLL_TICKS`, `CCRC_APPROVAL_CEILING_S`.
  - jq reads `$ENV.HOME` in `APPROVAL_FORBIDDEN_JQ`'s `pnorm`.

### Preamble, in file order (every event)
1. **At load,** `_tmx_argv`, inside the "D-8270 tmux socket lookup" block. It is copied byte for byte from ccd, and
   `tmux-socket-census.test.ts` holds the copy; its twin is `shared/tmux-target.ts`. It reads `~/.ccrc/tmux-socket`
   with builtins. On `msys*|cygwin*` it adds `-S "${TMUX%%,*}"`.
2. **The generated helpers region.** `_hook_epoch_ms`, `CCRC_PROJ_CLASS`, `CCRC_PROJ_MAX` and `CCRC_ID_MAX`, from
   `shared/hook-helpers.mjs`. After it come `_hook_timeout` (`timeout`, else `gtimeout`, else rc 127) and
   `_hook_net_bound` (one 8 s network budget per invocation, `HOOK_NET_BUDGET_MS`).
3. **Guards.** `[[ -n $HOME ]] || exit 0`, then `REG=$HOME/.cc-sessions`, then `payload=$(cat) || exit 0`.
4. **Which session this is:**
   - With a pane: `timeout 2 tmux display-message -p -t "$TMUX_PANE" '#S'`. A name `cc-<id>` gives `id`. With no
     `timeout` binary, the lookup is skipped and the hook exits 0.
   - With no pane but `CLAUDE_JOB_DIR` and `CLAUDE_CODE_SESSION_ID` set (D-4953): loop over `$REG/*.uuid` with a
     builtin `read -n CCRC_ID_MAX` and match the uuid.
   - Then: `id` must match `^[A-Za-z0-9._-]+$`, `$REG` must be a directory and `jq` must exist, or the hook exits 0.
5. **The delegation spool's gate (builtins only).** It reads `$REG/<id>.generation` (37 chars) and checks
   `$REG/delegation/spool/<id>`, `$REG/<id>.deleg` and `$REG/<id>.wrapper`. Only when the payload carries a quoted
   delegation tool or event name does it add `DSP_DEFS`, with `def spool` and `def lrec`, to the parse.
6. **The ONE parse jq.** It emits 10 lines: event (letters only), psid, any-agent flag `paid`, `aid` (id grammar, at
   most 64), `ap_call` (`{t,s}` built from `APR_SUMMARY_JQ`), `dsp_bucket`, `dsp_cut`, `dsp_cwd`, `dsp_line` and
   `lrc_line`. An empty event exits 0.

### Classification `case "$event"` (sets state, ask, src, gcmd, bg…)

| Event | What it sets | Early exit |
|---|---|---|
| UserPromptSubmit | `state=working` | `_hook_typed_model`: in a door session, `/model` → block answer, report `typed-refused`, `exit 0` before every writer |
| PostToolUse | `working`. When the payload names graphify / `peers list` / `claims take`: `gcmd` (jq) | — |
| PreCompact | `working` | — |
| PostCompact | `trig` (jq). `manual` → `done`, else `working` | jq fail → exit 0 |
| PreToolUse | `tool` (jq). AskUserQuestion → `waiting` + `ask_json={questions}`, else `working` | jq fail → exit 0 |
| PermissionRequest | `waiting`, `tool`. AskUserQuestion → questions ask. Else `apr=1` plus `ask_json={approval:{tool,summary}}` | jq fail → exit 0 |
| SessionStart | `src`. Runs the **card pipeline** (section 2F) and prints the SessionStart envelope. `compact` → `sessend=1` (no hookstate write). Else `state=done` | — |
| Stop | `done`. One jq over `background_tasks`/`session_crons` → `bg`, `bgk`, `bgi`, `bgd`, `bgdk`, `crons` | — |
| StopFailure | `stopfail=1`, `err` (jq, `[a-z_]`, 64) | exits after the start report (tail step 9) |
| SessionEnd | `sessend=1` | same |
| SubagentStart/Stop | `state=""` (subagent set only) | — |
| PreModelSwitch | — | `exit 0` |
| PostModelSwitch | `_hook_model_report switched` (a network send) | `exit 0` |
| `*` | — | `exit 0` |

### Tail, in file order (the event × stage matrix)

| # | Stage (function or quoted block) | Events | Notes |
|---|---|---|---|
| 1 | Truncate history scope `$HOME/.ccrc/history/scope/<id>` | PreCompact, main thread | — |
| 2 | `-hookcap` capture, `~/.ccrc/hook-capture/<id>/<event>-<ms>-<pid>.cap` (umask 077, tmp+mv, cap 200) | every event when `id` ends `-hookcap` (not SessionStart compact) | — |
| 3 | `_hook_join_record` → `$REG/<id>.joined` (rotation to `.joinedprev` under `flock -n`) | SubagentStart | — |
| 4 | `tmsub` = this agent is listed in `.joined`/`.joinedprev` | events with `paid`+`aid` | — |
| 5 | `_hook_turn_mark` → `$REG/<id>.turn.json` (`TURN_MARK_PROGRAM`, `_hook_write_atomic`) | UserPromptSubmit, Pre/PostToolUse (unless already working), Stop, StopFailure, SessionStart (restart/clear; compact inert) | needs `.generation`, `!tmsub` |
| 6 | `_hook_history_spool_append` → `~/.ccrc/history/spool/<id>.jsonl` (fenced `\n{…}\n`, fd 9 append) | Stop, PostCompact, SessionStart (startup/resume/clear/fork) | main thread |
| 7 | `_hook_spool_append` → `$REG/delegation/spool/<id>/<YYYYMMDDHH>.spool` (+`_hook_spool_listing`, `_hook_spool_prune`) | any event with a `dsp_line` | — |
| 8 | `_hook_launch_record_append` → `$REG/<id>.deleg` (1 MiB budget) | PostToolUse of Workflow/Agent/Task/SendMessage | `!tmsub` |
| 9 | `_hook_start_report` (send, resend) → `$REG/<id>.startpending` | UserPromptSubmit, SessionStart | **then `exit 0` for StopFailure/SessionEnd** |
| 10 | Read hookstate (jq) → prev_state, counters, approvals, subagents. Reset rules for SessionStart. Stop prunes subagents by `bgi` | all remaining | — |
| 11 | Counters: `GRAPH_QUERY_RE`+`GRAPH_ANSWER_RE` → graphQueries. `CCRC_PEERS_RE`, `CCRC_CLAIMS_RE` | PostToolUse | — |
| 12 | **The PreToolUse arms** (section 2D), in order: graph gate/nudge, landing advisory, merge deny, role-skill deny, account/child deny, Fable, test route, reader arms, fan-out pin | PreToolUse | each skips once a deny stands |
| 13 | `_hook_mail_hold` | PreToolUse, Stop (no prior deny) | — |
| 14 | `waitby`. `_hook_server_cap hook-main-state-v1` → `hms` | subagent events | — |
| 15 | The subagent set update, then `_hook_fresh_read` carries (keep stamp, waitPrev, bgDelegated) | SubagentStart/Stop, subagent Pre/PostToolUse | — |
| 16 | `_hook_approval_gate` | PermissionRequest (non-ask) | — |
| 17 | `_hook_door_arms` (one jq, then the reports) | door sessions, not a child | — |
| 18 | Ask/bg clearing. `hs_skip` on Pre/PostCompact when the server advertises `dispatch-live-gate-v1` | — | — |
| 19 | **The hookstate write**, `$REG/<id>.hookstate.json` (jq, 64 KiB cap with ask dropped, tmp `$REG/.<id>.<pid>.hookstate.tmp` + `mv -f`) | all remaining unless `hs_skip` | **jq or write failure → `exit 0` before step 20** |
| 20 | `printf "$pre_json"`: the PreToolUse deny/nudge (on Stop `_hook_mail_hold` only logs, so nothing prints) | PreToolUse | — |
| 21 | `_hook_door_delta`, `_hook_roster_wake`, `_hook_anchor_owed`, then the delta print (at most one UserPromptSubmit envelope) | UserPromptSubmit | — |
| 22 | `_hook_approval_wait` (blocks up to 540 s) | PermissionRequest | — |
| 23 | `_hook_start_loads` | Stop | — |
| 24 | `_hook_compact_refuse`, `_hook_compact_pre`, `_hook_history_scope`, `_hook_history_pre`, `_hook_compact_pre_line` | PreCompact | — |
| 25 | `_hook_compact_post` | PostCompact | then `exit 0` |

## 2. Per arm: decisions, files, processes, output

### 2A. Stdout and exit-code contract with Claude Code (exit is always 0)

| Event | Printed (one JSON line unless noted) | Builder |
|---|---|---|
| SessionStart | `{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext}}`: anchor first, then the standing card, compact card and roster card, each clipped | `_hook_emit_context` (`#@emit-context-print`, `#@emit-context-compact-ceiling`) |
| PreToolUse | deny `{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason}}` **or** nudge `{…additionalContext}` | `_hook_deny_json`, `_hook_nudge_json`, printed at tail step 20 |
| UserPromptSubmit | `{decision:"block",reason}` (typed `/model`), **or** one `{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext}}` (roster wake, owed anchor, or door delta) | `_hook_prompt_block_json`, `_hook_roster_wake`, `_hook_anchor_owed` |
| PermissionRequest | `{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}`, or `deny` with a `message` (a ruling, or the park text) | `_hook_approval_wait`, `_apr_park_print` |
| PreCompact | `{"decision":"block","reason":"ccrc: this automatic compaction is refused…"}` **or** the steer print, **plain text** (`ccrc-role-compaction:` line and the steer text) | `_hook_compact_refuse`, `_hook_history_pre` |
| others | nothing | — |

A quirk the port must keep: a failed hookstate build or write exits before the deny is printed, so a deny is lost
when the state file cannot be written. On Stop, `_hook_mail_hold` writes only its shadow log line (`stop`), never an
envelope.

### 2B. The JSON bytes the server reads
- **`hookstate.json`.** Written by `jq -cn` with these keys in order: `v`, `state`, `event`, `sessionId`, `pid`,
  `updatedAt`, `ask`, `subagents`, `graphQueries`, `graphGateDenials`, `ccrcPeerReads`, `ccrcClaims`. The optional
  keys follow: `interrupted`, `waitBy`, `aliveAt`, `bgDelegated`/`bgDelegatedKinds`, `waitPrev`, `approvals` (at most
  16).
- **`turn.json`.** `TURN_MARK_PROGRAM`, `v:1`, written for working, done, failed, restart and clear.
- **Approval digest.** `APPROVAL_DIGEST_JQ` is run as `jq -cSa`: sorted keys, ASCII escapes, integer-only numbers.
  The server recomputes the same bytes in `shared/api.ts#approvalDigestBytes`, so they must be **byte-identical**.
- **Door witness.** `printf tool\n$(jq -cS .tool_input) | sha256`.
- **Matching jq's output in Go.** Go's `encoding/json` escapes `<>&` (it needs `SetEscapeHTML(false)`) and U+2028/9.
  It also sorts map keys and formats numbers differently. A **jq-faithful encoder in `kernel/`** is a prerequisite
  for every writer.

### 2C. Files: read (R) and written (W), relative to `$REG=~/.cc-sessions` and `~/.ccrc`

| Path | R/W | Who | Format / write discipline |
|---|---|---|---|
| `$REG/<id>.hookstate.json` | RW | tail 10/19, `_hook_fresh_read`, `_hook_approval_route_patch`, `_hook_approvals_drop` | JSON line; tmp `.<id>.<pid>.hookstate.tmp` + `mv -f` |
| `$REG/<id>.turn.json` | RW | `_hook_turn_mark`, `_hook_compact_refuse` | JSON line; `_hook_write_atomic` (`.<id>.<base>.<pid>.<nonce>.hook-write.tmp`) |
| `$REG/<id>.generation`, `.uuid`, `.workdir`, `.project`, `.hold`, `.child`, `.archived`, `.wrapper`, `.profile`, `.compactwindow`, `.deny-settings`, `.supervised` (peers) | R | many | builtin bounded reads (`_ct_read`: `-N CCRC_ID_MAX`, trims `[:space:]`; rc 0/1 absent/2 unreadable) |
| `$REG/*.uuid` | R | identity fallback, `_ct_probe` | one-line uuid |
| `$REG/<id>.joined`, `.joinedprev` | RW | `_hook_join_record` | agent id per line; append; rotate at 128 lines under `flock -n` |
| `$REG/delegation/spool/<id>/<10 digits>.spool` | W | `_hook_spool_append` | JSON line per event (`DelegationSpoolLineV1`); append; prune older buckets |
| `$REG/<id>.deleg` | W | `_hook_launch_record_append` | JSONL (`lrec` rows, `drop` rows), 1 MiB cap |
| `$REG/<id>.startpending` | RW | `_hook_start_report` | `after\tdrop` + `tries\tjson` lines; tmp `$f$$` + mv |
| `$REG/<id>.loadpending`, `.loadlast` | RW | `_hook_loads_pend`, `_hook_start_loads` | TSV |
| `$REG/<id>.anchor-owed` | RW | `_hook_compact_pre_line`, `_hook_anchor_owed`, SessionStart arm | one digit |
| `$REG/<id>.mailhold` | R | `_hook_mail_hold` | `MAILHOLD_RE_BODY` grammar, 256 B |
| `~/.ccrc/mail-hold-shadow.d/<id>`, `~/.ccrc/mail-hold-shadow.log` | W | `_hook_mail_hold` | tmp+mv; log append, rotates at 1 MiB → `.1` |
| `$REG/mail-disabled`, `mailhold-notice-live`, `mailhold-refuse-live`, `approvals-disabled` | R | switches | existence only |
| `$REG/child-deny.settings.json`, `child-deny.digests`, `approval-verify.mjs`, `~/.ccrc/approval-signing.pub` | R | account/child deny, approval gate | ≤64 KiB to NUL; `<sha> <n>` lines |
| `$REG/admin-merge-allowed/<project>` | R | merge deny | existence |
| `$REG/<id>.precompact` | R | `_hook_compact_refuse` | word `refuse` |
| `$REG/<id>.compactevents`, `.compacteventsprev` | RW | `_hook_compact_pre_line`, `_hook_compact_refuse` | JSONL, 32 lines then rotate, **under the lock** |
| `$REG/<id>.compactset`, `.compactcard`, `.compactions` (journal) and the `$REG/.<id>.*` families (`compactions.lock`, `lock-open.*`, `lock-init.*`, `compactset.*.stage`, `compactcard.*.stage`, `compactpost.*.claim`, `compactserved.*`, `compactions-stage/snapshot.*.tmp`, `generation-read.*`) | RW | `_hook_compact_pre/post/card*`, `_hook_lock_*`, `_hook_family_sweepable` | JSON; link+rename protocol; aged sweep |
| `~/.ccrc/server-caps` | R | `_hook_server_cap` | 3 lines `at N` / `caps …` / `end`, lease 180 s |
| `~/.ccrc/history/{spool,scope,card,steer,steer-on,recall-off}/…`, `history-off`, `history-steer-off` | RW | history arms | see the functions |
| `~/.ccrc/memory/<slug>` + `<projects>/<slug>/memory` symlink | W | `_hook_memory_converge` | mkdir + `ln -sn` |
| `~/.ccrc/graph-gate-off`, `ccrc-card-off`, `compact-card-off`, `graphify.pin`, `graph-sweep.json`; `<cwd>/graphify-out/*`; `<store>/settings.json` | R | graph and card arms | — |
| `~/.ccrc/roster-card-shadow.log` | W | `_hook_roster_card` (unarmed) | append, capped at 256 KiB |
| `$REG/.door/<id>/delta` | R | `_hook_door_delta` | `v=1 at= until=` + one line, ≤1 KiB |
| `~/.ccrc/hook-capture/<id>/*.cap` | W | capture arm | `{"envSid"}`+payload |
| transcripts (`transcript_path`, `subagents/agent-<aid>.jsonl`) | R | compact scope, roster wake, start loads, approval scan | tail/head bounded |

**Locks.** The only lock is the row's permanent `$REG/.<id>.compactions.lock`:
- It is taken by `_hook_lock_acquire`: an `mktemp`+`link` mint, a `link` to a private open name, `exec {fd}<>`, then
  `flock -w COMPACT_LOCK_WAIT` (5 s, or 2 s on a compact SessionStart serve).
- `_hook_lock_same` re-proves the inode through `/proc/self/fd` or `/dev/fd`, falling back to `ls -i`.
- `_hook_lock_vanished` scans `/proc/*/fd` with `find`.
- `_hook_generation_ok` re-proves `.generation` by `link`.
- The join rotation uses a separate `flock -n` on `.joined`.
- The wave-1 lock adapter is `core/internal/adapter/lock`, which uses flock(2), or an MSYS `flock` child on Windows.

### 2D. The PreToolUse arms (in order; each is skipped once `pre_json` holds a deny)

| Arm | Trigger | Decision | Extra processes |
|---|---|---|---|
| Graph gate / nudge | `gq==0`, hookstate readable, no `graph-gate-off`. Gate: Grep/Glob, or Bash matching `GRAPH_SEARCH_RE`. Nudge: Read of a file matching `GRAPH_NUDGE_READ_RE` outside `graphify-out/` | deny "graphify gate…" (counts `graphGateDenials` up to `GM_MAX_DENIALS`), or nudge. Freshness from `_hook_graph_measure`/`_hook_gate_tree` | jq, `tail\|grep`, `head\|grep`, `head\|tr`, `git rev-parse`/`rev-list`/`diff`/`merge-base` |
| Landing advisory | Bash. Payload names main/origin and merge/pull/rebase, or update-branch | nudge when `LANDING_SYNC_RE` or `LANDING_UB_RE` matches | jq |
| Merge deny | Bash. Payload names `merge`/`Merge`/`enqueuePullRequest` | `MERGE_STRIP_JQ` strips quotes and heredocs and returns flags or an over-cap word. Then `GH_MERGE_RE`, `CCD_DOOR_RE`, `GH_API_RE`. A wave hold (`CCRC_HOLD_WAVE_RE`) or the child marker → deny a merge. `--admin`/`gh api` merge → deny unless `ALLOW_ADMIN_RE` + `admin-merge-allowed/<project>` | jq (Oniguruma) |
| Role-skill deny | Skill from a subagent (`paid`) | deny loading `ROLE_SKILLS` (`ccrc-worker ccrc-reviewer ccrc-coordinator ccrc-overlord`) | jq |
| Account / child deny | Builtin prefilter `apf`. Child (`.child`): mode `deny`, wide word list. Else mode `account` | `APPROVAL_FORBIDDEN_JQ` → `verb`/`surface`/`account`/`quiz`/`prune`/`build` + reason. A child gets `--arg deny <child-deny.settings.json>` (upstream ids for the build arm) | jq (Oniguruma) |
| Fable | Agent/Task/Workflow whose payload names `fable` | deny when the model names Fable (`FABLE_RE`) | jq |
| Test route | Bash; `systemd-run`, or a test or build word on a Linux fleet row | `ccrc test --classify-shell` → `wrapped` or `heavy` → deny | jq, `timeout 5 ccrc` (a bash script) |
| Reader arms | `mcp__door__*` other than `read` from a subagent. Agent/Task with 3 readers. A forced subagent model mismatch | deny | jq |
| Fan-out pin | Agent/Task with no model. A Workflow script (inline or `scriptPath` ≤256 KiB) with an `agent()` call missing model or effort | deny (D-6798). A JS-ish scanner written in jq | jq, `wc`, `cat` |
| Mail hold (Stop: shadow log only) | A `$REG/<id>.mailhold` marker, or a joined subagent's ack | `mail-hold.jq` `mail_hold` → deny/notice; shadow log | jq (+`MERGE_STRIP_JQ`), `find` |

**Child vs top-level:**
- A child (`$REG/<id>.child`) gets the forbidden program's `deny` mode, the merge deny for its marker, and the
  approval gate at PermissionRequest.
- A top-level session gets the `account` mode only.
- A subagent (`paid`) gets the role-skill deny, the reader arms and `hms` carries.
- A door session (`CCRC_DOOR_NONCE_SHA256` = 64 hex) gets door reports, the delta and typed `/model` refusal.

### 2E. PermissionRequest: the approval gate and wait
- **`_hook_approval_gate` is a ladder.** It needs:
  - the `.child` marker, and no `approvals-disabled`;
  - `.deny-settings` sha equal to sha256 of `child-deny.settings.json` (or listed in `child-deny.digests`);
  - `node`, `approval-verify.mjs`, the signing key, the `ccrc-api` client and the uuid.
- **Classifier and request.** Forbidden mode `class` must answer empty. Then `APPROVAL_DIGEST_JQ` → sha256 → a
  16-byte nonce (`od /dev/urandom`) → the body.
- **Route words.** Each refusal sets `apr_route=<word>`, held equal to `APPROVAL_ROUTE_SKIP_WORDS`.
- **`_hook_approval_wait`** (`trap 'exit 0' TERM INT HUP`):
  - `ccrc-api approvals request` → 201, `id`, `waitS`.
  - It polls `approvals ruling <id> --nonce` every `apr_poll` ticks of 0.5 s, up to `min(540, waitS)`.
  - It scans the transcript for the tool_use's result (`_apr_scan`).
  - It verifies a ruling with `node approval-verify.mjs` and prints allow or deny.
  - A `parked` state prints the park deny, also once the deadline passes on a live park.
  - It patches the route into hookstate (`_hook_approval_route_patch`) and drops the list entry
    (`_hook_approvals_drop`).

### 2F. SessionStart card pipeline (in the classification case)
1. `_hook_memory_converge` (git `rev-parse --git-common-dir`, `cd && pwd -P`, `ln -sn`).
2. `_hook_anchor_fetch start|fork` (`ccrc-api card --anchor`, 4 s).
3. Then the cards: `_hook_graph_card`, `_hook_hold_card`, the role card (`_hook_role_card`, defined inside the arm;
   only when there is no anchor), `_hook_ccrc_card` (`_ct_probe` walks every `$REG/*.uuid` + `.project` +
   `.supervised`), `_hook_roster_card` (resume, clear, compact: `ccrc-api runs list` + `roster-card.jq`), and, on
   compact, `_hook_compact_card` (lock, `compactcard`) and `_hook_history_card` (builtins only).
4. Emit through `_hook_emit_context` (`#@compact-arm-emit-call`), then `_hook_compact_mark_served` and
   `_hook_compact_serve_end`.

### 2G. Compaction (the only lock users; off the hot path)
- **`_hook_compact_refuse`.** `.precompact` = refuse, trigger auto, scope main, and no refusal yet this turn → it
  records a `refused` line, then prints the block (Overlord C39).
- **`_hook_compact_pre`.**
  1. Scope via `_hook_compact_scope`: `find -mmin` over `subagents/agent-*.jsonl`, giving main, subagent or
     ambiguous. Then `_hook_graph_measure`.
  2. Under the lock: the overlap `find` (`#@compact-pre-overlap-find`), the aged sweep (`#@compact-sweep-rm`), and
     the `compactset` document written atomically.
  3. Unlocked: `timeout 8 node compact-card.mjs card` with stage files.
  4. Relock: nonce re-check, then rename the stages.
- **`_hook_compact_post`.**
  1. Claim the set by `link`, then snapshot it.
  2. Run `node compact-card.mjs measure` over `compact_summary`.
  3. Validate with `COMPACT_SHAPE_PRED` and `JOURNAL_RECORD_PRED_DEFS`.
  4. Append one record to the `.compactions` journal by stage + `mv` (`#@compact-post-norm`).
- **History.**
  - `_hook_history_scope` writes `scope/<id>`.
  - `_hook_history_pre` prints the steer text, gated by `steer-on/<id>`, recall-off generation parity
    (`_hook_history_steer_recall_off`) and the role compact text (`COMPACT_TEXT_JQ` over `lib/launch-profiles.json`).
  - `_hook_compact_pre_line` appends the PreCompact line and may write `.anchor-owed`.

### 2H. Network (every call through `$HOME/.local/bin/ccrc-api`, bounded by `_hook_timeout` within the one budget)

| Call | Where | Bound |
|---|---|---|
| `card --anchor --form start\|fork\|prompt` | SessionStart, `_hook_anchor_owed` | 4 s |
| `runs list` | `_hook_roster_card` | 4 s |
| `sessions start` / `sessions loads` | `_hook_start_send` | `START_BUDGET_MS` 4 s / `LOADS_BUDGET_MS` 3 s |
| `sessions report <id> --json -` | `_hook_door_report` (door arms, model reports) | `REPORT_TIMEOUT_S` 3 s |
| `approvals request`, `approvals ruling` | approval wait | `HOOK_TIMEOUT_S` (600) is the outer bound |
| `ccrc test --classify-shell` | test route | 5 s |

## 3. The vocabulary it mirrors (the generator's export list)

This list is derived from what the tests hold equal (the `shared/` imports of hook-reading tests) plus the hook's own
cross-references.

### 3a. Owner in `shared/*.ts`: the generator's first export list

| Export (module) | The hook's spelling | Held equal by |
|---|---|---|
| `HOOK_EVENTS` (hook-events) | the case arms and `EVENTS_JSON` | install-session-hooks |
| `HOOK_COMMON_RULES`, `HOOK_EVENT_RULES`, `CAPTURE_EVENTS` (claudeBuildCapture) | the payload fields read | claude-build-capture |
| `CHILD_DENY_RULES`, `childDenyRules`, `CHILD_DENY_SETTINGS_FILE`, `CHILD_DENY_PATH_QUALIFIED` (api) | `child-deny.settings.json`; the build arm's `$ups` from its `install:*` / `update:*` rules | install-session-hooks, ccd-keep-awake, approval-deny |
| `ACCOUNT_DENY_RULES`, `ACCOUNT_DENY_SUBS`, `ACCOUNT_SUBS`, `ACCOUNT_OP_RUNS`, `ACCOUNT_SECRET_PATHS`, `ACCOUNT_WRITE_DIRS`, `ACCOUNT_ROSTER_FILES`, `ACCOUNT_READ_SUBS`, `ACCOUNT_CLI_ONLY_VERBS`, `LINEAR_MCP_DENY` (api); `ACCOUNT_SUB_ARGV` (account-argv); `OPERATOR_SECRETS_DIR` (ledgers) | jq `ACCTV`, `APSEC`, `APWD`, `APRF`, `ASEC`, `AOPRUN`, `AAUTH` | account-deny, session-hook-account-deny |
| `NON_DELEGATING_TASK_KINDS`, `TERMINAL_TASK_STATUSES` (api) | the Stop jq's `IN("shell",…)`, `IN("completed","failed","killed")` | session-hook-background |
| `APPROVAL_HOOK_WAIT_S`, `APPROVAL_HOOK_STOP_STATES` (api) | same names | session-hook-approval-wait |
| `approvalDigestBytes` (api; a function, not a value) | `APPROVAL_DIGEST_JQ` | session-hook-approval-wait |
| `approvalParkDenyText` (approval-park) | `APPROVAL_PARK_DENY_TAIL` | session-hook-approval-park |
| `APPROVAL_ROUTE_SKIP_WORDS` (approval-census) | every `apr_route=` word | session-hook-approval-route |
| `SERVER_CAPS`, `SERVER_CAPS_FILE`, `SERVER_CAPS_LEASE_S` (api) | `hook-main-state-v1`, `dispatch-live-gate-v1`, `server-caps`, 180 | agent-events, compact-carry, role-skill-deny, bucket |
| `SUPERVISED_FRESH_MS` (api) | `CCRC_FRESH_S=120` | (comment) |
| `REG_GENERATION_SHAPE` (api) | the uuid regex, spelled about 8 times | (comment) |
| `DELEGATION_SPOOL_BOUNDS` (api) | jq `idmax 64`, `maxlabel 128`, `maxpath 512`, `DSP_LIST_NAMES`, `DSP_NAME_BYTES` | delegation-spool |
| `IDLE_COMPACT_NOTICE_PREFIXES`, `IDLE_COMPACT_NUDGE_PROMPT` (api) | `ROSTER_WAKE_MAIL`, `ROSTER_WAKE_IDLE` | roster-card, door-delta |
| the hold grammar behind `holdReason` (api; `run-routes` derives 127 from the program-slug, wave and run bounds) | `CCRC_HOLD_MAX=127` (read back as a literal), `CCRC_HOLD_WAVE_RE` | run-routes |
| `MAILHOLD_RE_BODY`, `MAILHOLD_REACH_S`, `MAILHOLD_ROLES` (mailHold) | `_hook_mail_hold`'s grammar, `360`, `coordinator\|overlord` | mailhold-parity |
| `REPORT_TIMEOUT_S`, `DOOR_TOOL_PREFIX`, `AGENT_ID_RE`, `MODEL_SWITCH_HOWS`, `REPORT_MODEL_MAX` (continuity-reports) | `REPORT_TIMEOUT_S`, `mcp__door__`, `MODEL_REPORT_JQ`'s 128 | door-reports, reader-arms, model-events |
| `ANCHOR_CARD_MAX_CHARS` (continuity-card) | same | anchor |
| `DELTA_MAX_BYTES` (continuity-door) | `DOOR_DELTA_MAX_BYTES` | door-tools |
| `RUNS_ROSTER_CARD_FIELD`, `ROSTER_CARD_SHADOW_LOG` (lane-arm) | `.rosterCard == "live"`, the log path | roster-card |
| `GRAPH_GATE_OFF_FILE`, `CCRC_CARD_OFF_FILE`, `COMPACT_CARD_OFF_FILE`, `SWITCHES` (switches) | `GRAPH_GATE_OFF`, `CCRC_CARD_OFF`, `COMPACT_CARD_OFF` | switches-history |
| `HISTORY_STEER_ON_DIR` (agent-protocol) | `history/steer-on` | switches-history |
| `TMUX_SOCKET_FILE`, `TMUX_SOCKET_NAME_RE`, `TMUX_REFUSE_SH` (tmux-target) | the D-8270 block | tmux-socket-census |
| `ROLE_SKILLS`: no single export found; `shared/fleetRoles.ts` holds role skill names | `ROLE_SKILLS` | role-skill-deny (text) |

### 3b. Owner outside `shared/*.ts`: the generator as specified cannot reach these
- **`shared/hook-helpers.mjs#HOOK_CONSTANTS`** (`CCRC_PROJ_CLASS`, `CCRC_PROJ_MAX`, `CCRC_ID_MAX`). It is `.mjs`, not
  `.ts`, so the generator must take it too or the list moves.
- **`server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS`** for the `fmatch` and `xmatch` verb lists.
- **`ccd/install-session-hooks.sh`'s `HOOK_TIMEOUT_S`** (600) and `HOOK_CMD`.
- **`ccd/history/lib.mjs`:** `CARD_LINE_MAX`, `CARD_LINE_PATTERN`, `SCOPE_DIR`, `CARD_DIR`, `STEER_DIR`,
  `STEER_FIRST_LINE`/`STEER_GENERIC_TEXT`, `STEER_FILE_MAX`. The hook spells `HISTORY_CARD_MAX`, `HISTORY_CARD_RE`,
  `HISTORY_*_DIR`, `HISTORY_STEER_FIRST_LINE`/`GENERIC` and the 8193 read.
- **`ccd/lib/launch-profiles.json`** (`compactText`).
- **ccd's `_reg_generation_valid` and `_sync_uuid`** (the registry's writers).

### 3c. The hook's own spellings, with no other owner (they become Go constants in `domain/…`)
- Card caps: `CARD_MAX_CHARS`, `COMPACT_CARD_MAX_CHARS`, `ROSTER_CARD_MAX_CHARS`, `ANCHOR_PROMPT_MAX_CHARS`.
- `COMPACT_*` timings, `PRECOMPACT_KEEP`, `JOIN_*`, `LRC_*`, `START_*`, `LOADS_*`, `GRAPH_GATE_*`.
- Regexes: `GRAPH_*_RE`, `LANDING_*_RE`, `GH_*_RE`, `CCD_DOOR_RE`, `ALLOW_ADMIN_RE`, `FABLE_RE`, `APF_ENV_RE`.
- All reason texts.
- **Units differ.** Bash `${#x}` and `${x:0:n}` count locale characters at top level, since `LC_ALL=C` is set only
  inside the spool and launch functions. jq `.[0:n]` counts code points, and `utf8bytelength` counts bytes. A Go
  port must record which unit each cap uses. For example, the 64 KiB hookstate cap counts characters under a UTF-8
  locale.

## 4. Libraries and helpers

### jq programs held in variables

The "Onig" column marks programs that need Oniguruma-only regex features. Go's `regexp`, standard library only,
supports none of them.

| Program | Used by | Onig | Notes |
|---|---|---|---|
| The parse (inline) + `DSP_DEFS` (`spool`, `lrec`, `note`) | preamble | no | `strftime`, `now` |
| `APR_SUMMARY_JQ` | parse, PermissionRequest | no | — |
| `TURN_MARK_PROGRAM` | `_hook_turn_mark` | no | CUT by ccd-swap-guards |
| `MODEL_REPORT_JQ` | model reports, typed `/model` | no | — |
| `JOURNAL_RECORD_PRED_DEFS`, `JOURNAL_STAGE_PRED`, `COMPACT_SHAPE_PRED` | compact post | no | — |
| `MERGE_STRIP_JQ` | merge deny, mail hold | **yes** | atomic `(?>`, possessive `++`, backrefs `\k<w>`, conditionals `(?(<q>)`, recursion `\g<pe>`, lookbehind |
| `APPROVAL_FORBIDDEN_JQ` (modes `deny`, `account`, `class`) | account/child deny, approval gate | **yes** | lookbehind `(?<!`, lookahead, `$ARGS.named.deny`, `$ENV.HOME`. About 300 lines of `def`s: `fmatch`, `xmatch`, `pmatch`, `apmatch`, `qzmatch`, `bmatch`, `acctpath`, `pathwhy`, `norm` |
| `APPROVAL_DIGEST_JQ` | approval gate | no | must match `jq -cSa` bytes |
| `DOOR_NUDGE_JQ` | door arms | no | CUT by door-reports |
| `COMPACT_TEXT_JQ` | history pre | no | — |
| Inline: role-skill trim, Fable, fan-out scanner, Stop background, `_hook_fresh_read`, hookstate write | the arms | no | the fan-out scanner is a hand parser of JS in jq |

Shell regexes (`=~`) are POSIX ERE. `GH_MERGE_RE`, `LANDING_SYNC_RE` and the others use bracket classes, which RE2
accepts. Where a capture is read (`BASH_REMATCH`), use `regexp.CompilePOSIX` for leftmost-longest. `GH_API_RE` and
`CCD_DOOR_RE` are **derived by string surgery** on `GH_MERGE_RE`.

### Sourced and external files (nothing is `source`d; all are reached as processes or jq modules)

| File | Calls | Other users | Wave 2 |
|---|---|---|---|
| `ccd/lib/mail-hold.jq` | `mh_prep`, `mail_hold` | ccrc, deploy (and the TS twin `shared/mailHold.ts`) | keep as a jq process, or port with mailhold-parity as the gate |
| `ccd/lib/roster-card.jq` | `roster_card` | ccrc, deploy | keep jq; port later |
| `ccd/lib/transcript.jq` | `idle_compaction_open`, `start_loads`, `loads_body` | ccd, ccrc, doctor | keep jq |
| `ccd/lib/launch-profiles.json` | `compactText` | ccd | read in Go |
| `~/.cc-sessions/compact-card.mjs` (`card`, `measure`) | compaction | — | **stays an external node process** |
| `$REG/approval-verify.mjs` | approval wait | — | **stays node**: it is the signing boundary |
| `ccrc-api` | network | — | stays a process (an L3 adapter) |
| `ccrc test --classify-shell` | test route | — | stays a process |

The library directory is `ROSTER_CARD_LIB` (`${BASH_SOURCE%/*}/lib`, else `~/.cc-sessions/lib`). Go needs the same
two-place lookup relative to its executable.

### Functions shared with `ccd/ccd`
- **`_hook_epoch_ms`** is generated from ccd's `_plat_epoch_ms` by `shared/hook-helpers.mjs` (region `hook`).
- **`_hook_server_cap` is a SOURCE (reverse dependency).** `ccd/ccrc-api`'s `_api_server_cap` is generated from its
  body (region `apicap`, D-7321). If bash's copy is removed, the generator needs a new source.
- **The D-8270 tmux block** is a byte copy, pinned by tmux-socket-census.
- **`_ct_read` and `_ct_probe`** are the hook's own, though ccd has twins (`_reg_*`).
- **The lock family** (`_hook_lock_*`) is deliberately not generated. It differs from ccd's on purpose (exit-0
  contract), as `hook-helpers.mjs` says.

## 5. Tests that pin it

**Totals.** The subagent's census is indicative. `grep -l session-hook` over the test directories gives 152 test
files, of which 144 are about the hook (8 match only through `install-session-hooks`). By primary kind:

| Kind | Files | Meaning |
|---|---|---|
| RUN | 52 | spawn the hook as a process |
| CUT | 7 | run pieces of its text |
| TEXT | 29 | scan its text |
| MENTION | 56 | a comment or path only |

The overlap is large. About 26 RUN files also pin or cut text (shown as "RUN, TEXT" or "RUN, CUT"). Six RUN files
cut and run a jq program: approval-deny, approval-wait, door-reports, merge-deny, prune-deny and delegation-spool.
Three more read the hook outside that grep: `shellcheck-ratchet` (baseline), `growth-caps` (`GROWTH_FILES`, waivers)
and `anchors`.

### Process-running files (portable to both-mode runs once a seam exists)

- **session-hook\*:** `session-hook` (474 cases), `-account-deny`, `-agent-events`, `-anchor`, `-approval-deny`,
  `-approval-envelope`, `-approval-park`, `-approval-route`, `-approval-wait`, `-background`, `-compact-carry`,
  `-door-delta`, `-door-reports`, `-fable-agents`, `-fan-out-routing`, `-graph-pins`, `-graph-repo`,
  `-launch-record`, `-mail-hold`, `-merge-deny`, `-model-events`, `-precompact-refuse`, `-precompact`,
  `-prune-deny`, `-quiz-deny`, `-reader-arms`, `-role-card`, `-role-skill-deny`, `-roster-card`, `-start-loads`,
  `-start-report`, `-steer`, `-subagent-ask`, `-sync-advisory`, `-test-route`, `-turnmark` (and `-append-race`, which
  also runs the hook but is counted under CUT).
- **Others:** `approval-paths-characterization`, `ask-instance-guard`, `bucket`, `ccd-inflight`,
  `delegation-adoption-corpus`, `delegation-rig`, `delegation-spool`, `delegation-wave3.integration`,
  `dispatch-live-gate`, `fleet`, `history-recall`, `inflight-manifest`, `install-linear-skill`, `mailhold-parity`,
  `measure-working-state`, `stall-verdict`.

### Files that cut or scan text (need Go equivalents before the switch, spec §6)
- **CUT:**
  - `ccd-swap-guards` (`TURN_MARK_PROGRAM`)
  - `ccd-keep-awake` (`APPROVAL_FORBIDDEN_JQ`)
  - `ccd-session-path` (`GRAPH_RUN`)
  - `history-agents-ingest#hookGateLines` (the `_hook_compact_scope` gate)
  - `hook-helpers-characterization#fnBody`
  - `mail-hold-module` (`MERGE_STRIP_JQ`, `ALLOW_ADMIN_RE`, `MERGE_PARSE_CAP`)
  - `session-hook-append-race#historyAppendLine`
  - plus the cutters inside RUN files: `#hookForbiddenJq`, `#jqPrograms`, `#hookAssign`, `#hookFnBody`, `CAP_STMT`,
    and the `prune-deny` timing against `fixtures/prune-deny/forbidden-jq-33e521e07.jq`
- **Bash-copy seam:** `server/test/hookGuardSeam.ts#seamHook` rewrites a **copy of the bash** so one guard line reads
  through `_w4_seam`. `session-hook.test.ts` runs those copies. This has no meaning for Go and needs a Go-side fault
  seam or a Go unit test.
- **TEXT guards:**
  - `install-session-hooks`: case arms = `EVENTS_JSON` = `HOOK_EVENTS`.
  - `hook-helpers-generated`, `ccrc-restamp`, `macos-platform` (GNU-isms, `_hook_epoch_ms` body).
  - `tmux-socket-census`, `ccd-id-cap`, `path-identity-w1b-prose`, `run-routes`, `door-tools`, `coordinator-skill`,
    `worker-skill`, `ccrc-doctor-graphify`, `ccrc-install-graphify`, `compact-card-ship`, `census-w3/claimant`
    (`_hook_server_cap`).
  - The `single-definition/*` scans (`ask-digest`, `mail-hold`, `roster-bash`, `roster-card`, `switches-history`,
    `vocabularies`, `writers-map`), `ccd-lifecycle-sites`, `ccd-ws-lease-mark-argv`, `graph-r2-consumers`,
    `routing-env-census`, `update-branch-absent`, `workflow-control-census`, `claims-advisory`.

### The harness gap
- **No shared runner.** Each RUN file has its own `run`/`fire`/`hook` around `spawnSync`, `spawnSyncGroup`,
  `execFileSync` or `spawn('bash',[HOOK])`, with stdin JSON and a fixture HOME.
- **`server/test/ccdTwin.ts#runImpl` does not fit.** It is ccd-only (prefix `ccd`, body `CCD`, no stdin).
- **A new seam is needed.** Something like `runHook(impl, payload, env)` that starts `bash ccd/session-hook.sh` or
  `ccrc-core hook`. Each file's local runner is then rewritten onto it, which is a test-only change.
- **`server/test/spawnGroupAllowlist.ts`** pins the count of `'bash'` spawns in four hook files.
- **Bash-shaped stubs on PATH.** These need per-mode expectations or Go adapters that honour PATH:
  - `tmux` (about 40 files), so Go must call `tmux` through PATH.
  - `ccrc-api` (about 13).
  - `jq` (about 13, including `session-hook-turnmark`'s jq stand-in). A Go mode that does not exec jq makes these
    vacuous.
  - `flock`, `timeout` and `node` (3–4 each).
- **The table guard** `server/test/ccd-core-table.test.ts#functionText` searches only `ccd/ccd` and `ccd/lib`. A
  `hook` entry's `owns` cannot name `_hook_*` until it also reads `ccd/session-hook.sh`, and the hook's arms and
  hookstate assembly are **top-level statements**, not functions. Options: list the 120-odd `_hook_*` functions plus
  a shape digest of the whole file, or a file-level digest.

## 6. Hot-path cost (a PreToolUse on the common allow path)

**Floor case:** a top-level session, no door, `gq>0` (or `graph-gate-off`), turn line already `working`, no
mailhold marker, nothing matching the prefilters. While `graphQueries` is 0, and in a tree with no graph it stays 0,
the **common** Read of a source file and every Grep/Glob add the graph rows below, so the real median sits above
this floor.

| Step | Process (exec) | Fork |
|---|---|---|
| bash parses and executes the 7k-line file | `bash` | — |
| `timeout 2 tmux display-message` | `timeout`, `tmux` | `$( )` |
| `payload=$(cat)` | `cat` | `$( )` |
| the parse | `jq` | `< <( )` |
| `tool=$(jq …)` | `jq` | `$( )` |
| hookstate read | `jq` | `< <( )` |
| `ap_at=$(_hook_epoch_ms)` | — | `$( )`, no exec |
| hookstate build `out=$(jq -cn …)` | `jq` | `$( )` |
| `mv -f tmp hookstate.json` | `mv` | — |
| **Total** | **≈ 8 execs** plus bash | **≈ 8 forks** |

- **Files read on this path:**
  - `~/.ccrc/tmux-socket` (at load).
  - `$REG/<id>.generation` (37 chars, spool gate), plus existence and type tests of `delegation/spool/<id>`,
    `<id>.deleg` and `<id>.wrapper`.
  - `<id>.turn.json` (builtin), `<id>.hookstate.json` (jq), `~/.ccrc/graph-gate-off`, `<id>.child`, `<id>.mailhold`.
- **Written on every event:** `hookstate.json` (tmp + rename).
- **Measured cost** (spec §1): 31 ms per call on Linux, 3.7 s median on Windows (MSYS fork emulation); target under
  300 ms.

**What adds to it:**

| Situation | Extra |
|---|---|
| First PreToolUse after a non-working turn | `TURN_MARK_PROGRAM` jq + `mv` |
| A Bash call | the parse carries `DSP_DEFS` and a spool append (builtin `>>`, maybe `rm` on a new bucket) |
| Read of a source-extension file while `gq==0` (`GRAPH_NUDGE_PRE_RE` on the payload) | jq `fpath`, then `_hook_graph_measure` (jq `cwd`; with no `graphify-out` it stops there): 2 jq |
| Grep/Glob while `gq==0`, or Bash whose payload holds the unanchored substring `rg\|grep\|ag\|ack\|find\|fd` | Bash: jq `scmd`. Then, when gated, `_hook_graph_measure`: jq `cwd` + up to 10 more (`tail\|grep\|tail`, `head\|grep\|head`, `head\|tr` ×2, `git rev-parse` ×1–4, `git rev-list`) when `graphify-out` exists |
| Bash with test or build words on a Linux fleet row | jq + `timeout 5 ccrc test --classify-shell`: a whole second bash script, the costliest common addition |
| Bash naming merge | jq `MERGE_STRIP_JQ` (big Oniguruma program) |
| The account prefilter (`account`, `.ccrc`, `printenv`, `prune`, the word `env`, …) or, for a child, a much wider list (`ccd`, `ccrc`, `install`, `update`, `.local`, …) | jq `APPROVAL_FORBIDDEN_JQ`, the largest program, compiled per call |
| A door session | one more jq for every PreToolUse (`_hook_door_arms`), plus sha256 and `ccrc-api` for door tools |
| A subagent with `hms` | `_hook_fresh_read` jq |

## 7. Proposed task decomposition

Throughout, `core/entries.json` keeps `hook` at mode `bash` on every platform and the installer keeps `HOOK_CMD`
until the final task. Each task adds Go code, plus tests that run in both modes **for the arms that task ports**.
Test files for arms not yet ported stay bash-only. Each commit is green because nothing installed starts the Go
hook.

| # | Task | Covers | Tests (switched to both modes or added) |
|---|---|---|---|
| T1 | **Foundation** | **Vocabulary generator:** `core/gen/vocab.mjs` → `kernel/vocab/vocab_gen.go` with the §3a list (and a ruling on §3b: take `hook-helpers.mjs` and `FORBIDDEN_CCD_VERBS`, or leave them), plus a server test that regenerates and diffs. **Entry:** the `hook` row in `entries.json`; `ccd-core-table.test.ts#functionText` widened to `ccd/session-hook.sh`; the `ccrc-core hook` entry in `cmd/ccrc-core/main.go` → `app/hook`. **Kernel:** a jq-faithful JSON encoder (`jq -c`, `-cS`, `-cSa` modes) and `_hook_epoch_ms`. **Harness:** `runHook(impl, payload, env)` in a new `server/test/hookTwin.ts` beside `ccdTwin.ts`, stdin-capable, with the build-once binary from `coreBuild.ts` | vocab regen test; table test; encoder golden tests against real `jq -cSa` output (including the `approvalDigestBytes` vectors); a both-mode parity test for "no pane, no job dir → exit 0, no output, no files" |
| T2 | **Spine** | **Identity and parse:** identity (a tmux adapter through PATH with a 2 s bound; the job-dir fallback over `*.uuid`); the parse (event, psid, paid, aid, `ap_call`). **Classification:** every case arm except the SessionStart cards (stubbed to "no card") and the network reports. **State:** hookstate read and write (atomic, 64 KiB rule, the carries, `_hook_fresh_read`, waitPrev, `_hook_server_cap`); `_hook_turn_mark` + `TURN_MARK_PROGRAM`; `_hook_join_record` + `tmsub`; the hookcap capture. **Output:** stdout sequencing (`pre_json` after the write), with the exit quirks | `session-hook.test.ts` state-mapping and fleet-gate describes, `-turnmark`, `-background`, `-agent-events`, `-subagent-ask`, `-compact-carry`, `ask-instance-guard`, `bucket`, `measure-working-state`, `stall-verdict`, `fleet`, `dispatch-live-gate`; Go equivalent of `ccd-swap-guards`' `TURN_MARK_PROGRAM` cut |
| T3 | **Spools and records** | `DSP_DEFS` `spool`/`lrec`, `_hook_spool_append`/`_listing`/`_prune` (LC_ALL=C byte caps, `DSP_LINE_BELOW` 4096 on GNU/Linux, 1008 elsewhere (macOS, MSYS)), `_hook_launch_record_append`, `_hook_history_spool_append` | `delegation-spool` (+ a Go twin of `CAP_STMT`), `-launch-record`, `ccd-inflight`, `inflight-manifest`, `-append-race` (+ a Go twin of its guard cut), `delegation-adoption-corpus`, `delegation-wave3.integration` |
| T4 | **PreToolUse arms on plain regex** | graph gate and nudge with `_hook_graph_measure`, `_hook_graph_diff`, `_hook_gate_tree` (a git adapter); landing advisory; role-skill deny; Fable; test route; reader arms; the fan-out pin (port the jq JS scanner as a Go L1 decider) | `-graph-pins`, `-graph-repo`, `-sync-advisory`, `-role-skill-deny`, `-fable-agents`, `-fan-out-routing`, `-test-route`, `-reader-arms`, `delegation-rig` fan-out describe, `ccd-session-path` (`GRAPH_RUN`) |
| T5 | **The Oniguruma arms** | merge deny (`MERGE_STRIP_JQ` + the derived EREs), account/child/quiz/prune/build deny (`APPROVAL_FORBIDDEN_JQ`, modes `deny`, `account`, `class`, with `--arg deny`), mail hold (`mail-hold.jq`). **Recommended route** (stdlib-only rule): first, a **bash-side move commit** puts the two programs in `ccd/lib/approval-forbidden.jq` and `ccd/lib/merge-strip.jq`. The CUT tests then read the file (an import-only change, characterization green). Go then runs the **same jq text** through a jq adapter (L3), so there is one policy text, not a second compiled copy (spec "Rejected: compiling policy across languages") | `-account-deny`, `account-deny`, `-approval-deny`, `-quiz-deny`, `-prune-deny` (+ the cost bound), `-merge-deny`, `-mail-hold`, `mail-hold-module`, `mailhold-parity`, `ccd-keep-awake` |
| T6 | **Network and door** | `_hook_net_bound`; `_hook_start_report`/`_send`/`_keep`; `_hook_start_loads` + `_hook_loads_pend` (`transcript.jq`); `_hook_door_report`, `_hook_door_arms` (witness sha256 over `jq -cS`), `_hook_model_report`, `_hook_typed_model`; `_hook_door_delta`; `_hook_roster_card` + `_hook_roster_wake` (`roster-card.jq`, `transcript.jq`); `_hook_anchor_fetch` + `_hook_anchor_owed` | `-start-report`, `-start-loads`, `-door-reports` (+ a `DOOR_NUDGE_JQ` twin), `-door-delta`, `-model-events`, `-roster-card`, `-anchor` |
| T7 | **PermissionRequest approvals** | `_hook_approval_gate` (forbidden `class` mode from T5, `APPROVAL_DIGEST_JQ` through the T1 encoder, native sha256, nonce from `crypto/rand`, `child-deny.digests`), `_hook_approval_wait` (ticks, deadline, `_apr_scan`, `ccrc-api` calls, `node approval-verify.mjs`, park), `_hook_approval_route_patch`, `_hook_approvals_drop` | `-approval-wait`, `-approval-route`, `-approval-park`, `-approval-envelope`, `approval-paths-characterization` |
| T8 | **SessionStart cards and compaction** | **Cards:** `_hook_memory_converge`, `_hook_graph_card`, `_hook_hold_card`, `_hook_role_card`, `_hook_ccrc_card`/`_ct_probe`, `_hook_history_card`, `_hook_emit_context`. **Compaction:** the lock family over the wave-1 lock adapter (`link`/inode re-proofs, `_hook_lock_vanished`'s `/proc` scan, `_hook_generation_ok`), `_hook_compact_pre`/`_post`/`_card*`/`_mark_served`/`_serve_end`, `_hook_compact_scope`, `_hook_family_sweepable`, `_hook_compact_refuse`, `_hook_compact_pre_line`, `_hook_history_scope`/`_pre`/steer. `compact-card.mjs` stays node. Split into T8a (cards) and T8b (compaction and locks) if it runs large | `session-hook.test.ts` compaction and lock describes (Go fault seams to replace `hookGuardSeam` copies), `-precompact`, `-precompact-refuse`, `-steer`, `-role-card`, `install-linear-skill`, `history-recall`, `history-agents-ingest` (Go twin of `hookGateLines`), the compact-card suites; one race test of bash against Go on `compactions.lock` |
| T9 | **Text guards and the switch** | **Go twins of the TEXT guards:** event set ↔ `HOOK_EVENTS` ↔ Go dispatch; `single-definition` over `core/`; the `_api_server_cap` generator source (keep it in the bash hook until removal, or move it to a Go-independent source); `tmux-socket-census` (Go reads `TMUX_SOCKET_FILE` from vocab). **Installer:** `HOOK_CMD` follows the mode (`"$HOME/.local/libexec/ccrc/core/ccrc-core" hook`); every recogniser of the managed hook accepts both commands (installer `JQ_UNMANAGED`, `ccrc-doctor-checks`' hooked test and `DR_OWN_HOOK_JQ`, `ccrc` uninstall, `delegation-rig/rig.sh`). **Rollout:** run the whole hook suite in both modes in Linux CI; take timings on Windows; flip `mode.windows: go` | `install-session-hooks`, `ccrc-doctor-*`, `ccrc-uninstall`, `delegation-rig-w0`, `launch-surface-installer`, plus the remaining TEXT suites, each with a Go-side guard that goes red when deleted |

**Dependencies.**
- **T1 → T2 is forced,** because every Go run passes through the spine.
- **Move `_hook_emit_context` and the SessionStart card assembly (with empty cards) into T2.** T6's SessionStart
  tests (`-anchor`, `-roster-card`) print through the emitter.
- **T8 needs T4.** `_hook_graph_card` and `_hook_compact_pre` call `_hook_graph_measure` and `_hook_gate_tree`.
- **T7 needs T5's `class` mode.**
- **T9 is last.**

**CI selection (T1 must settle it).** `.github/ci/fast-plan.mjs` runs every `session-hook*` suite only when
`SESSION_HOOK_TRIGGERS` (`ccd/ccd`, `ccd/session-hook.sh`, `shared/api.ts`) or a `ccd/lib/*.sh` changed. A `core/**`
change runs only `CORE_TESTS` (the caps, table, entry and entry-install suites). So a Go-only hook commit would run
**none** of the hook suites on a fast PR, and "green" would mean "not run". T1 should add the hook suites to the
core rule (or add `core/internal/app/hook/**` as a trigger), and T5's new `ccd/lib/*.jq` files need the
`CCD_LIBRARY` shape widened from `.sh`.

**T5's move is a plan decision, with its own failure mode.** An inline program cannot be missing. A lib file can be
missing, unreadable or stale on a box, as `mail-hold.jq` already shows with its `module-missing` path. The plan must
say what each arm does then: fail open, as the hook does today on a jq failure, or deny.

## 8. Not verified, and the risks to carry into the plan
- **Test classification is approximate.** The RUN/CUT/TEXT counts and the arms per test come from a subagent's
  reading of `describe` titles and grep. The PATH-stub counts are filename greps. Neither was read case by case.
- **Summarised from greps, not read in full:** `_hook_compact_post`, `_hook_compact_card`/`_card_locked`,
  `_hook_compact_mark_served`, `_hook_graph_card`, `_hook_history_card`, the three jq modules, `compact-card.mjs` and
  `approval-verify.mjs`. T8's size comes from these.
- **The test-to-task mapping in §7** was not checked against what each file asserts.
- **The write inventory in §2C** was not cross-checked by a grep of write sites (`>`, `>>`, `mv`, `link`) or against
  `shared/lifecycle.ts`'s `creators`.
- **The export list in §3a may be incomplete.** It comes from test imports plus the hook's comments. A scan of
  `single-definition` for literal values without an import was not done.
- **The Oniguruma claim is from reading the program text**, not from running RE2 against it. It holds clearly for
  `MERGE_STRIP_JQ`; parts of `APPROVAL_FORBIDDEN_JQ` might fit RE2 with rewriting.
- **Byte-identical JSON** (hookstate, turn.json, the approval digest, spool lines) depends on reproducing jq's
  encoder. This is the largest hidden cost in T1 and T2.
- **The deny is lost on a hookstate write failure.** It is kept by "a port reproduces the bash" and fixed later.
- **Locale-dependent `${#x}` caps** at top level make some limits differ between C and UTF-8 locales. The Go port has
  to pick and pin the locale the hook runs under in production.
