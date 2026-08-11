#!/usr/bin/env bash
# install-coordinator-skill.sh — put the ccrc coordinator skill in every wrapper
# home's skills dir. Same roster-derived (five homes today), idempotent,
# backed-up shape as install-session-hooks.sh, and for a sharper reason: skills resolve per
# CLAUDE_CONFIG_DIR, and a session's ACCOUNT drifts on swap while its id does
# not. The coordinator is placed like any other session (`_ws_least_loaded`,
# no pinned account — Build 7 operator ruling 2), and this lane is the only
# thing that makes that safe: a swap must never land the coordinator on a home
# without its skill.
#
# The default `homes` fallback below is install-session-hooks.sh's own default
# list (architecture doc increment 2: both installers' home lists are the
# `ACCOUNTS` roster's `hooksAble` config dirs, `shared/api.ts`). Bash cannot
# import that roster at runtime (out of scope by design — see
# server/test/wrapper-roster-fixture.test.ts's own header), so the two literal
# arrays are what the roster projects to, and a cross-language fixture test
# keeps this one honest against `ACCOUNTS.hooksAble` the same way it already
# does for install-session-hooks.sh's — not a comment asking a future author
# to keep them in sync by hand.
#
# Deploy-time only (not a hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED source — deploy.sh rsyncs ccd/coordinator-skill/ to
# ~/.cc-sessions/coordinator-skill/ on the fleet host. Overridable so the test
# harness can point it at the repo copy without a deploy.
SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/coordinator-skill}"
NAME=ccrc-coordinator
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else homes=("$HOME/.claude" "$HOME/.claude-personal" "$HOME/.claude-corp" "$HOME/.claude-gpt" "$HOME/.claude-dev0"); fi

# Refuse rather than degrade — ccd's own rule for a missing tool
# (`ccd:2135-2139`: "refusing to run the destructive verb unserialised"). A
# half-installed skill is worse than none: the model would follow whatever
# fragment landed.
[[ -f "$SRC/SKILL.md" ]] || { echo "install-coordinator-skill: no SKILL.md under $SRC — refusing" >&2; exit 1; }
command -v diff >/dev/null 2>&1 \
  || { echo "install-coordinator-skill: diff (diffutils) is unavailable — refusing rather than rewriting blind" >&2; exit 1; }

rc=0
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue           # a box missing some of the roster's wrappers is ordinary
  dest="$dir/skills/$NAME"

  # Converged already? Do not touch it. Idempotence is observable: the test
  # asserts the inode and mtime survive a second run.
  if [[ -d "$dest" ]] && diff -r -q "$SRC" "$dest" >/dev/null 2>&1; then continue; fi

  tmp="$dest.tmp.$$"
  old="$dest.old.$$"
  rm -rf "$tmp"
  mkdir -p "$dir/skills" && mkdir -p "$tmp" && cp -a "$SRC/." "$tmp/" \
    || { rm -rf "$tmp"; echo "install-coordinator-skill: could not stage into $dir" >&2; rc=1; continue; }

  if [[ -e "$dest" ]]; then
    mkdir -p "$BACKUPS"
    cp -a "$dest" "$BACKUPS/$(basename "$dir").skills.$NAME" \
      || { rm -rf "$tmp"; echo "install-coordinator-skill: backup failed for $dest" >&2; rc=1; continue; }
    mv "$dest" "$old" || { rm -rf "$tmp"; rc=1; continue; }
  fi

  # The swap, and its rollback: a failed `mv` must leave the home with the
  # skill it had, never with nothing.
  if ! mv "$tmp" "$dest"; then
    rm -rf "$tmp"
    [[ -e "$old" ]] && mv "$old" "$dest"
    echo "install-coordinator-skill: install failed for $dir" >&2
    rc=1
    continue
  fi
  rm -rf "$old"
done
exit "$rc"
