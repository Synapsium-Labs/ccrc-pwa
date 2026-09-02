#!/usr/bin/env bash
# session-hook.sh — Claude Code hook → ~/.cc-sessions/<id>.hookstate.json
#
# Runs on the HOT PATH of every tool call in every fleet session, so the
# contract is absolute: exit 0 on every path, write atomically or not at
# all, no network, no locks, no waiting. A hook that can slow or break a
# session is worse than no hook. Consumed read-only by the ccrc server via
# the agent (whitelist: .cc-sessions is readable; nothing here needs a
# grant). Non-fleet sessions (no tmux, foreign session name) exit silently.
set -uo pipefail

# ── epoch milliseconds, on two userlands ────────────────────────────────
# `date +%s%3N` is GNU. BSD's date has no `%N`: it prints the literal letter,
# so the format answers `17876553263N` — not a number, which the `--argjson
# updatedAt` below rejects. `jq` then fails, the `|| exit 0` swallows it, and
# THE HOOK WRITES NOTHING. That is the worst shape this file can fail in: the
# server reads a session's state from this file, so every session on the box
# would read as unsupervised while looking perfectly healthy from the inside.
#
# `EPOCHREALTIME` is a bash builtin — no fork, no coreutils, same answer on
# both platforms (measured against `date +%s%3N` on Linux, to the
# millisecond). The separator is taken as either `.` or `,` because that field
# is formatted with the locale's decimal point. BUT the builtin is bash 5.0+
# and the declared floor is 4.4 — a 4.4 box takes the fallback, and on
# BSD the bare fallback answers the exact non-number described above. So the
# fallback VALIDATES, and degrades to whole seconds ×1000: millisecond
# precision lost, THE WRITE KEPT — the one trade this file's contract allows.
#
# This is a LOCAL copy of ccd's `_plat_epoch_ms`, and deliberately so: this
# file is installed on its own into ~/.cc-sessions and runs as Claude Code's
# hook, with no ccd around to source. A test pins the two bodies identical.
_hook_epoch_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local s="${EPOCHREALTIME%%[.,]*}" f="${EPOCHREALTIME#*[.,]}"
    f="${f}000"; printf '%s%s' "$s" "${f:0:3}"
    return 0
  fi
  local t; t=$(date +%s%3N 2>/dev/null)
  if [[ "$t" =~ ^[0-9]{13,}$ ]]; then printf '%s' "$t"; else printf '%s000' "$(date +%s)"; fi
}

[[ -n "${HOME:-}" ]] || exit 0
REG="$HOME/.cc-sessions"

# ── R4: what counts as READING the graph ────────────────────────────────
# `query`, `path` and `explain` only. `graphify update` and every build are
# WRITES, and the sweep owns the write side — counting them here would make
# the number say the opposite of what it is for. The leading class is what
# stops `mygraphify query` and prose mentioning the command from counting;
# the trailing one stops `graphify querying-something-else`.
GRAPH_QUERY_RE='(^|[;&|[:space:]])graphify[[:space:]]+(query|path|explain)([[:space:]]|$)'

payload=$(cat 2>/dev/null) || exit 0
[[ -n "${TMUX_PANE:-}" ]] || exit 0
tname=$(tmux display-message -p '#S' 2>/dev/null) || exit 0
[[ "$tname" == cc-?* ]] || exit 0
id="${tname#cc-}"
[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || exit 0
[[ -d "$REG" ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

event=$(jq -r '.hook_event_name // empty' <<<"$payload" 2>/dev/null) || exit 0
[[ -n "$event" ]] || exit 0

state="" ask_json="null" interrupted="false" src="" gcmd=""
case "$event" in
  UserPromptSubmit) state="working" ;;
  PostToolUse)
    state="working"
    # ONE payload read for the counter, on the one event that can carry a
    # command, and only for Bash: a tool_input.command on any other tool is
    # not a shell line this box ran.
    #
    # THE PREFILTER IS A BUDGET, NOT A STYLE CHOICE. This arm is the HOT PATH —
    # `session-hook.test.ts` pins p95 of 20 PostToolUse runs under 150 ms, and
    # a bare `jq` fork on this box measures ~5 ms against a ~46 ms run. A shell
    # line that runs `graphify` CANNOT fail to put the eight characters
    # `graphify` somewhere in the payload (JSON escaping never touches them),
    # so a payload without them needs no jq at all and the common tool call
    # pays nothing. `$gcmd` stays "" there, which the increment below already
    # treats as "no command".
    if [[ "$payload" == *graphify* ]]; then
      gcmd=$(jq -r 'if .tool_name == "Bash" then (.tool_input.command // "") else "" end' \
        <<<"$payload" 2>/dev/null) || gcmd=""
    fi ;;
  PreCompact) state="working" ;;
  PostCompact)
    trig=$(jq -r '.trigger // "auto"' <<<"$payload" 2>/dev/null) || exit 0
    [[ "$trig" == manual ]] && state="done" || state="working" ;;
  PreToolUse)
    tool=$(jq -r '.tool_name // empty' <<<"$payload" 2>/dev/null) || exit 0
    if [[ "$tool" == AskUserQuestion ]]; then
      state="waiting"
      ask_json=$(jq -c '{questions: (.tool_input.questions // [])}' <<<"$payload" 2>/dev/null) || ask_json="null"
    else
      state="working"
    fi ;;
  PermissionRequest)
    state="waiting"
    tool=$(jq -r '.tool_name // empty' <<<"$payload" 2>/dev/null) || exit 0
    if [[ "$tool" == AskUserQuestion ]]; then
      # MEASURED 2026-08-05, live fleet probe against Claude Code 2.1.222:
      # this harness version delivers AskUserQuestion as PermissionRequest,
      # NOT PreToolUse — the PreToolUse arm above is Orca's mapping, written
      # against a different harness version, and is kept rather than
      # replaced because which arm actually fires is a harness detail this
      # script cannot control or predict for the next upgrade. Without this
      # check the branch below wrote {approval:{tool:"AskUserQuestion",
      # summary:""}} — an empty, useless envelope — silently losing the real
      # questions/options while the pane showed an actual 3-option menu. Both
      # paths must keep producing the same {questions:…} envelope shape.
      ask_json=$(jq -c '{questions: (.tool_input.questions // [])}' <<<"$payload" 2>/dev/null) || ask_json="null"
    else
      ask_json=$(jq -c '{approval: {tool: (.tool_name // "unknown"),
        summary: ((.tool_input.command // .tool_input.file_path // .tool_input.path
                   // .tool_input.url // .tool_input.pattern // "") | tostring | .[0:200])}}' \
        <<<"$payload" 2>/dev/null) || ask_json="null"
    fi ;;
  SessionStart)
    # F1 (build4 dogfood, docs/superpowers/programs/build4.md): a freshly
    # spawned session has never taken a turn, so it has no hookstate file at
    # all — the mail delivery gate's `hs === null` conjunct correctly
    # fails SHUT on that (never inject mid-thought), but with NOTHING ever
    # writing this id's first hookstate, that worker's very FIRST
    # coordination brief sat queued forever (measured live: ~40min, until a
    # human-forced first turn). A just-started session is definitionally at
    # an idle boundary — sitting there waiting for input, exactly like a
    # session that just finished a `Stop` — so SessionStart writes `done`
    # too, the same idle the delivery gate already knows how to read.
    #
    # D-306 (was D-B8-10): this arm shipped UNWIRED — install-session-hooks.sh's event list
    # omitted SessionStart — so F1 was never actually fixed on the fleet, and
    # nothing re-stamped state when a supervisor resumed a session. Measured on
    # the 2026-08-19 reboot: 12 of 17 live sessions still carried hookstate
    # written before the boot that restarted them, two of them `working` —
    # stamped by a process that no longer existed. Only `Stop` clears `working`,
    # and a killed turn never reaches its `Stop`.
    #
    # Wiring it exposes the case the unconditional `done` above gets wrong:
    # `source` is compact when the harness fires SessionStart in the MIDDLE of a
    # turn to re-inject context after compaction. Stamping `done` there would
    # tell the mail gate an actively-thinking session is idle — the precise
    # mid-thought injection the gate exists to prevent. PreCompact/PostCompact
    # already own that transition, so compact is inert here: write nothing at
    # all and leave whatever PreCompact wrote standing. Every other source —
    # startup, resume, clear, or ABSENT on an older harness — is a real idle
    # boundary (absence-permits: the pre-`source` payload was the F1 startup).
    src=$(jq -r '.source // empty' <<<"$payload" 2>/dev/null) || src=""
    [[ "$src" == compact ]] && exit 0
    state="done" ;;
  Stop)
    state="done"
    [[ $(jq -r '.is_interrupt // false' <<<"$payload" 2>/dev/null) == true ]] && interrupted="true" ;;
  SubagentStart|SubagentStop) state="" ;;   # subagent-set update only
  *) exit 0 ;;
esac

f="$REG/$id.hookstate.json"
# Prior subagent set survives state transitions; a corrupt file reads as [].
# ONE fork for all three fields (was two, and the counter would have made
# three). Same hot-path budget as the arm above: `$f` is read on every event,
# and `subs`/`prev_state` were already two forks over one file. Three values on
# three LINES, not `@tsv` — `@tsv` escapes a tab or newline inside a subagent
# name as a backslash sequence, which would hand `--argjson subagents` a string
# that is no longer JSON. `tostring` of a compact array contains no newline, so
# line-splitting is safe where tab-splitting is not.
#
# The read counter survives state transitions exactly as `subs` does, and a
# file that never carried the field reads as 0 — this is the WRITER, where 0
# is the honest start; `hookstate.ts` is the reader, and there absent stays
# `null` rather than folding to 0. A jq that fails (no file, corrupt file)
# prints nothing, all three `read`s come up empty, and each falls back to the
# degrade it already had. This file runs under `set -uo pipefail` and NOT
# `set -e`, so a `read` hitting EOF is inert.
subs=""; prev_state=""; gq=""
{ read -r subs; read -r prev_state; read -r gq; } < <(jq -r \
  '(.subagents // [] | tostring), (.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end)' \
  "$f" 2>/dev/null)
[[ "$subs" == \[* ]] || subs="[]"
[[ "$gq" =~ ^[0-9]+$ ]] || gq=0
# `startup` and `clear` are new sessions; `resume` and `compact` are the SAME
# session still going, and a counter that reset on compaction would erase the
# evidence at precisely the moment the session most needed the card (R1).
# `compact` never reaches this line at all — the SessionStart arm exits at its
# compact guard (D-306) — so its carry is STRUCTURAL, protected by that exit
# and not by this condition. `resume` is the source this condition protects.
#
# D-1248: written as "everything except resume", NOT "startup or clear", so a
# SessionStart carrying NO `source` reads the same way here as it does in the
# arm above — where absence-permits makes it the F1 startup (:146-147) and
# `session-hook.test.ts` pins it as `done`. Spelled as an allow-list, a
# source-less SessionStart would be a NEW session for `state` and the SAME
# session for `graphQueries`, one file collapsing a distinction it drew two
# lines earlier: the counter would never reset on an older harness and would
# accumulate forever across restarts of one tmux session name (the hookstate
# file is keyed `cc-<id>`, which survives them), so the card would report
# previous sessions' reads as this one's. A future `source` this build has
# never heard of lands on the same side as absence — a new boundary resets,
# which is the degrade that costs a count rather than inventing one.
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; fi
if [[ -n "$gcmd" && "$gcmd" =~ $GRAPH_QUERY_RE ]]; then gq=$((gq + 1)); fi

if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then
  name=$(jq -r '.agent_name // .subagent_name // .agent_type // "subagent"' <<<"$payload" 2>/dev/null) || name="subagent"
  now=$(_hook_epoch_ms)
  if [[ "$event" == SubagentStart ]]; then
    subs=$(jq -c --arg n "$name" --argjson t "$now" \
      '(. + [{name:$n, startedAt:$t}]) | .[-32:]' <<<"$subs" 2>/dev/null) || subs="[]"
  else
    subs=$(jq -c --arg n "$name" 'del(.[ (map(.name) | index($n)) // empty ])' <<<"$subs" 2>/dev/null) || subs="[]"
  fi
  # Session state untouched: keep the previous state (or skip entirely when
  # no state was ever written — a subagent event before any turn is inert).
  [[ -n "$prev_state" ]] || exit 0
  state="$prev_state"
  ask_json=$(jq -c '.ask // null' "$f" 2>/dev/null) || ask_json="null"
  interrupted=$(jq -r 'if .interrupted == true then "true" else "false" end' "$f" 2>/dev/null) || interrupted="false"
fi

# Transitions to working/done clear the ask: an answered question must not
# stay sticky on the sheet.
[[ "$state" == working || "$state" == done ]] && { [[ "$event" == SubagentStart || "$event" == SubagentStop ]] || ask_json="null"; }

out=$(jq -cn \
  --argjson v 1 --arg state "$state" --arg event "$event" \
  --arg sessionId "${CLAUDE_CODE_SESSION_ID:-}" --argjson pid "${CLAUDE_PID:-0}" \
  --argjson updatedAt "$(_hook_epoch_ms)" --argjson interrupted "$interrupted" \
  --argjson ask "$ask_json" --argjson subagents "$subs" --argjson graphQueries "$gq" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents, graphQueries:$graphQueries}
   + (if $interrupted then {interrupted:true} else {} end)') || exit 0

# 64KB cap: drop the questions envelope before anything else — a truncated
# envelope is worse than none.
if (( ${#out} > 65536 )); then
  out=$(jq -c '.ask = null' <<<"$out" 2>/dev/null) || exit 0
  (( ${#out} <= 65536 )) || exit 0
fi

tmp="$REG/.$id.$$.hookstate.tmp"
printf '%s\n' "$out" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }
mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
exit 0
