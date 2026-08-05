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
REG="$HOME/.cc-sessions"

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

state="" ask_json="null" interrupted="false"
case "$event" in
  UserPromptSubmit|PostToolUse) state="working" ;;
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
    ask_json=$(jq -c '{approval: {tool: (.tool_name // "unknown"),
      summary: ((.tool_input.command // .tool_input.file_path // .tool_input.path
                 // .tool_input.url // .tool_input.pattern // "") | tostring | .[0:200])}}' \
      <<<"$payload" 2>/dev/null) || ask_json="null" ;;
  Stop)
    state="done"
    [[ $(jq -r '.is_interrupt // false' <<<"$payload" 2>/dev/null) == true ]] && interrupted="true" ;;
  SubagentStart|SubagentStop) state="" ;;   # subagent-set update only
  *) exit 0 ;;
esac

f="$REG/$id.hookstate.json"
# Prior subagent set survives state transitions; a corrupt file reads as [].
subs=$(jq -c '.subagents // []' "$f" 2>/dev/null) || subs="[]"
prev_state=$(jq -r '.state // empty' "$f" 2>/dev/null) || prev_state=""

if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then
  name=$(jq -r '.agent_name // .subagent_name // .agent_type // "subagent"' <<<"$payload" 2>/dev/null) || name="subagent"
  now=$(date +%s%3N)
  if [[ "$event" == SubagentStart ]]; then
    subs=$(jq -c --arg n "$name" --argjson t "$now" \
      '(. + [{name:$n, startedAt:$t}]) | .[0:32]' <<<"$subs" 2>/dev/null) || subs="[]"
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
  --argjson updatedAt "$(date +%s%3N)" --argjson interrupted "$interrupted" \
  --argjson ask "$ask_json" --argjson subagents "$subs" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents}
   + (if $interrupted then {interrupted:true} else {} end)') || exit 0

# 64KB cap: drop the questions envelope before anything else — a truncated
# envelope is worse than none.
if (( ${#out} > 65536 )); then
  out=$(jq -c '.ask = null' <<<"$out" 2>/dev/null) || exit 0
  (( ${#out} <= 65536 )) || exit 0
fi

tmp="$REG/.$id.hookstate.tmp"
printf '%s\n' "$out" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }
mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
exit 0
