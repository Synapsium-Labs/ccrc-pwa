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
    # AND THE SUBAGENT SET IS DROPPED HERE, which is the only place it can be.
    # Nothing else clears it: the set is read back and written forward on every
    # event, so a subagent whose `SubagentStop` never landed — a killed pane, a
    # box reboot, a crashed turn — is carried indefinitely. Measured on a live
    # box: rows aged 4037 and 3814 MINUTES riding a SessionStart write.
    #
    # A compacting session is mid-turn, its subagents are still running, and
    # clearing there would blank a live roster in the middle of the work it
    # describes. What protects that case is the `exit 0` one line above — the
    # compact arm writes NOTHING at all — not this line's position, which was
    # measured: hoisting it above the guard changes no behaviour, because the
    # process is already gone. Deleting the `exit 0` is what breaks it, and
    # `session-hook.test.ts` goes red for exactly that.
    #
    # `startup`, `resume` and `clear` are all real boundaries where no subagent
    # can have survived.
    clear_subs=1
    state="done" ;;
  Stop)
    state="done"
    [[ $(jq -r '.is_interrupt // false' <<<"$payload" 2>/dev/null) == true ]] && interrupted="true" ;;
  SubagentStart|SubagentStop) state="" ;;   # subagent-set update only
  *) exit 0 ;;
esac

f="$REG/$id.hookstate.json"
# Prior subagent set survives state transitions; a corrupt file reads as [].
# The one exception is a real SessionStart boundary — see `clear_subs` above.
subs=$(jq -c '.subagents // []' "$f" 2>/dev/null) || subs="[]"
(( ${clear_subs:-0} )) && subs="[]"
prev_state=$(jq -r '.state // empty' "$f" 2>/dev/null) || prev_state=""

if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then
  # NAME AND ID IN ONE jq CALL. The fork count on this path is a measured
  # budget (`session-hook.test.ts` pins p95 < 150ms across ~20 live sessions),
  # so reading a second field must not cost a second process.
  #
  # `agent_id` is a REQUIRED field on both SubagentStart and SubagentStop in
  # Claude Code's own schema, and the hook has always been receiving it and
  # throwing it away. Keeping it fixes a real defect: `del` by NAME removes the
  # FIRST match, i.e. the OLDEST — and `name` resolves to the agent TYPE (the
  # first two keys in the ladder are not in the schema), so concurrent
  # same-typed subagents are the ORDINARY case, not an edge one. Measured on a
  # live box: one session carrying five rows all reading `workflow-subagent`.
  # Stopping any one of them retired the oldest row, leaving a survivor whose
  # `startedAt` belonged to the subagent that had just finished.
  #
  # It is also the join key the server needs: Claude Code writes
  # `subagents/agent-<agent_id>.meta.json` beside the transcript, carrying the
  # human `description` that turns five identical rows into five sentences.
  IFS=$'\t' read -r name aid < <(jq -r '[(.agent_name // .subagent_name // .agent_type // "subagent"),
                                          (.agent_id // "")] | @tsv' <<<"$payload" 2>/dev/null) \
    || { name="subagent"; aid=""; }
  [[ -n "$name" ]] || name="subagent"
  now=$(_hook_epoch_ms)
  if [[ "$event" == SubagentStart ]]; then
    # `id` is omitted rather than written empty when the harness sends none —
    # absence-permits, and the server's reviver reads a missing `id` as null
    # (no identity) rather than as an identity that is the empty string.
    subs=$(jq -c --arg n "$name" --arg i "$aid" --argjson t "$now" \
      '(. + [{name:$n, startedAt:$t} + (if $i == "" then {} else {id:$i} end)]) | .[-32:]' \
      <<<"$subs" 2>/dev/null) || subs="[]"
  else
    # BY ID when there is one, falling back to the old name match when there is
    # not — an older harness, or a row written before this shipped, must still
    # be retirable.
    subs=$(jq -c --arg n "$name" --arg i "$aid" \
      'if $i != "" and (map(.id // "") | index($i)) != null
       then del(.[ (map(.id // "") | index($i)) ])
       else del(.[ (map(.name) | index($n)) // empty ]) end' <<<"$subs" 2>/dev/null) || subs="[]"
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

tmp="$REG/.$id.$$.hookstate.tmp"
printf '%s\n' "$out" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }
mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
exit 0
