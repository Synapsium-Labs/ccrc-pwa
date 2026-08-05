#!/usr/bin/env bash
# install-session-hooks.sh — register session-hook.sh in each wrapper home's
# settings.json. Idempotent and provably non-destructive: existing entries
# survive byte-identical, managed entries are recognized by their command
# containing /session-hook.sh (so re-runs sweep stale paths and converge),
# jq validates before every swap, and each rewritten file is backed up first.
# A settings.json this script broke would break every future session of that
# home — hence the paranoia.
#
# Deploy-time only (not the hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED path — deploy.sh ships session-hook.sh to ~/.cc-sessions on
# the fleet host; $HOME is left unexpanded (single-quoted) so it resolves
# per-session at hook-run time, not to this installer's own $HOME.
HOOK_CMD='bash "$HOME/.cc-sessions/session-hook.sh"'
# Events that get a matcher-less managed entry. PreToolUse is handled
# separately below because it alone carries matcher "*".
EVENTS_JSON='["UserPromptSubmit","PostToolUse","PermissionRequest","Stop","SubagentStart","SubagentStop","PreCompact","PostCompact"]'
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else homes=("$HOME/.claude" "$HOME/.claude-personal" "$HOME/.claude-corp" "$HOME/.claude-gpt"); fi

# Sweep every managed entry (filename match, so stale paths get replaced
# too), then insert exactly one managed entry per event — PreToolUse with
# matcher "*", the rest matcher-less — and drop any event array left empty
# by the sweep. Built with --argjson over a fixed events array rather than
# shell string interpolation into the jq program: same behavior, no
# quoting-through-quoting to get wrong.
JQ_PROGRAM='
def unmanaged: map(select((.hooks // []) | any(.command | tostring | contains("/session-hook.sh")) | not));
.hooks = ((.hooks // {})
  | with_entries(.value |= unmanaged)
  | reduce $events[] as $ev (.; .[$ev] = ((.[$ev] // []) + [{hooks:[{type:"command", command:$cmd}]}]))
  | .PreToolUse = ((.PreToolUse // []) + [{matcher:"*", hooks:[{type:"command", command:$cmd}]}])
  | with_entries(select(.value != [])))
'

rc=0
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue
  f="$dir/settings.json"
  if [[ -f "$f" ]]; then
    jq empty "$f" 2>/dev/null || { echo "install-session-hooks: $f is not valid JSON — refusing" >&2; rc=1; continue; }
    cur=$(cat "$f")
  else
    cur='{}'
  fi

  next=$(jq --arg cmd "$HOOK_CMD" --argjson events "$EVENTS_JSON" "$JQ_PROGRAM" <<<"$cur") \
    || { echo "install-session-hooks: merge failed for $f" >&2; rc=1; continue; }

  # Converged already? Do not touch the file (idempotence is byte-level: the
  # next run's re-derived JSON compares equal under key-sorted normalization,
  # so we skip the write and the file's bytes stay exactly what they were).
  if [[ -f "$f" ]] && [[ "$(jq -S . <<<"$next")" == "$(jq -S . "$f")" ]]; then continue; fi

  jq empty <<<"$next" || { rc=1; continue; }
  if [[ -f "$f" ]]; then mkdir -p "$BACKUPS"; cp -a "$f" "$BACKUPS/$(basename "$dir").settings.json"; fi
  tmp="$f.tmp.$$"
  jq . <<<"$next" > "$tmp" && mv -f "$tmp" "$f" || { rm -f "$tmp"; rc=1; }
done
exit "$rc"
