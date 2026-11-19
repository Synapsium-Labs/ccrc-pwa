#!/usr/bin/env bash
# mailhold-plant.sh — a SessionStart hook for `scenarios-overlord/ov-pretool-notice.json` (mid-turn mail PR 5, the
# asserting rig case PR 0's review asked for). It plants what the mail hold needs in the rig's FIXTURE HOME, never the
# real one: the hook's jq module beside the hook (the rig copies only `session-hook.sh` into `.cc-sessions/`), and a live
# `mailhold` marker for the rig's session, `until` 300 s from now, which no static file could carry. The arming marker
# `mailhold-notice-live` is the scenario's own `launch.files` entry. Exit 0 on every path, as a hook must.
set -u
cat >/dev/null 2>&1   # the payload, unread
reg="$HOME/.cc-sessions"
mkdir -p "$reg/lib" 2>/dev/null && cp -- "${BASH_SOURCE[0]%/*}/../../../../ccd/lib/mail-hold.jq" "$reg/lib/mail-hold.jq" 2>/dev/null
printf '%s:coordinator.42' "$(( $(date +%s) + 300 ))" > "$reg/rig-hookcap.mailhold" 2>/dev/null
exit 0
