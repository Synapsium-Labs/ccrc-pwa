#!/usr/bin/env bash
# install-session-hooks.sh — converges each wrapper home's settings.json on
# two things: session-hook.sh registered under every handled event, and the
# statusLine pointer seeded if absent. Idempotent and provably
# non-destructive: existing entries survive byte-identical, managed hook
# entries are recognized by their command containing /session-hook.sh (so
# re-runs sweep stale paths and converge), jq validates before every swap,
# and each rewritten file is backed up first. A settings.json this script
# broke would break every future session of that home — hence the paranoia.
#
# statusLine is load-bearing, not cosmetic: statusline-command.sh writes the
# ~/.cc-limits telemetry ccd's auto-swap and server placement decisions
# consume, and ccd parses its ctx segment to drive auto-compact — but
# nothing else in this repo has ever WRITTEN this settings.json key; the
# reference fleet's entries are hand-made history. Seeding is set-if-absent
# ONLY: an operator's customized statusLine is user-owned and must survive
# every re-run untouched — converge, don't damage.
#
# Deploy-time only (not the hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED path — deploy.sh ships session-hook.sh to ~/.cc-sessions on
# the fleet host; $HOME is left unexpanded (single-quoted) so it resolves
# per-session at hook-run time, not to this installer's own $HOME.
HOOK_CMD='bash "$HOME/.cc-sessions/session-hook.sh"'
# Same discipline as HOOK_CMD: $HOME left unexpanded, resolved per-session.
STATUSLINE_CMD='bash "$HOME/.claude/statusline-command.sh"'
# Events that get a matcher-less managed entry. PreToolUse is handled
# separately below because it alone carries matcher "*".
#
# This list and session-hook.sh's `case "$event"` arms are the same set written
# twice, and they DRIFTED: the hook grew a SessionStart arm (F1) that was never
# added here, so it was dead code on the fleet for months (D-306 (was D-B8-10); found
# independently as this branch's Task 5). The pairing is now a mechanism, not a
# convention — install-session-hooks.test.ts derives the expected set from the
# hook's own case block and fails on any divergence.
EVENTS_JSON='["UserPromptSubmit","PostToolUse","PermissionRequest","Stop","SubagentStart","SubagentStop","PreCompact","PostCompact","SessionStart"]'
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

# The default home list is the ROSTER's config dirs, read at run time from the
# same generated file ccd sources — not a literal array kept in step with it by
# hand and pinned by a fixture test. `_ccrc_cfg_dir` resolves $HOME per process,
# so this installer's own $HOME is what the paths land under, which is what lets
# the test harness point the whole run at a fixture home.
#
# EVERY account, not a hooks-able subset: there is no such concept. A box that
# does not have some of the roster's wrappers is ordinary, and the loop below
# already `continue`s past a directory that is not there.
#
# `--remove` (stage 4, Task 8 — `ccrc uninstall`) runs the SWEEP half of the
# converge and never the insert half: managed entries go, unmanaged entries
# survive byte-identically, and the statusLine is not touched in either
# direction (seed-if-absent on install, operator-owned always — removal has
# no more business inspecting it than installation does). It lives HERE, not
# in `ccrc`, because the `unmanaged` predicate below is the ONE definition of
# "which settings.json entries are ccrc's" and a second spelling in the
# uninstaller is exactly how the two would come to disagree about whose entry
# a file holds. Parsed BEFORE --homes, which consumes the rest of argv.
MODE=install
if [[ "${1:-}" == --remove ]]; then MODE=remove; shift; fi
homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else
  # shellcheck source=/dev/null
  source "$HOME/.ccrc/accounts.sh" \
    || { echo "install-session-hooks: no account roster at $HOME/.ccrc/accounts.sh — generate it from ~/.ccrc/accounts.json first" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

# Sweep every managed entry (filename match, so stale paths get replaced
# too), then insert exactly one managed entry per event — PreToolUse with
# matcher "*", the rest matcher-less — and drop any event array left empty
# by the sweep. Built with --argjson over a fixed events array rather than
# shell string interpolation into the jq program: same behavior, no
# quoting-through-quoting to get wrong.
#
# One write cycle, two convergers: after the .hooks assignment, seed
# statusLine only when the key is entirely absent — has("statusLine") is
# true for ANY existing value, custom or not, so an operator's own statusLine
# is never inspected let alone replaced. This keeps the byte-level converge
# check below intact (a single "next" computed per run, compared once).
# The predicate is spelled ONCE and shared by both modes — `ccrc uninstall`
# rides `--remove` precisely so that this line stays the single definition of
# a managed entry.
JQ_UNMANAGED='def unmanaged: map(select((.hooks // []) | any(.command | tostring | contains("/session-hook.sh")) | not));'
JQ_PROGRAM="$JQ_UNMANAGED"'
.hooks = ((.hooks // {})
  | with_entries(.value |= unmanaged)
  | reduce $events[] as $ev (.; .[$ev] = ((.[$ev] // []) + [{hooks:[{type:"command", command:$cmd}]}]))
  | .PreToolUse = ((.PreToolUse // []) + [{matcher:"*", hooks:[{type:"command", command:$cmd}]}])
  | with_entries(select(.value != [])))
| if has("statusLine") then . else .statusLine = {type:"command", command:$sl} end
'
# The sweep alone. An empty `.hooks` left behind is DELETED rather than kept
# as `{}` — a file that never had the key must not gain one from a removal,
# or the byte-level converge check below would rewrite a file this mode has
# no changes for.
JQ_REMOVE="$JQ_UNMANAGED"'
.hooks = ((.hooks // {}) | with_entries(.value |= unmanaged) | with_entries(select(.value != [])))
| if .hooks == {} then del(.hooks) else . end
'

rc=0
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue
  f="$dir/settings.json"
  if [[ -f "$f" ]]; then
    jq empty "$f" 2>/dev/null || { echo "install-session-hooks: $f is not valid JSON — refusing" >&2; rc=1; continue; }
    cur=$(cat "$f")
  else
    # Nothing to remove FROM: a home with no settings.json must not gain one
    # from an uninstall.
    [[ "$MODE" == remove ]] && continue
    cur='{}'
  fi

  prog="$JQ_PROGRAM"
  [[ "$MODE" == remove ]] && prog="$JQ_REMOVE"
  next=$(jq --arg cmd "$HOOK_CMD" --argjson events "$EVENTS_JSON" --arg sl "$STATUSLINE_CMD" "$prog" <<<"$cur") \
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
