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
# The default `homes` fallback below is install-session-hooks.sh's, byte for
# byte, and it now READS the roster rather than restating it: `~/.ccrc/
# accounts.sh` — generated from `~/.ccrc/accounts.json`, and the same file ccd
# itself sources — hands both installers every account's config dir. Until
# 2026-08-12 both carried a literal five-element array instead, kept honest
# against the TypeScript roster by a cross-language fixture test, because "bash
# cannot import that roster at runtime" was taken as a given. It can; this is
# what that looks like, and the fixture test that policed the copies has one
# less copy to police.
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

# EVERY account's config dir, not a hooks-able subset: there is no such concept.
# The loop below already `continue`s past a home whose directory is absent, which
# is the ordinary state of a box that does not run the whole roster.
homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else
  # shellcheck source=/dev/null
  source "$HOME/.ccrc/accounts.sh" \
    || { echo "install-coordinator-skill: no account roster at $HOME/.ccrc/accounts.sh — generate it from ~/.ccrc/accounts.json first" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

# Refuse rather than degrade — ccd's own rule for a missing tool
# (`ccd:2135-2139`: "refusing to run the destructive verb unserialised"). A
# half-installed skill is worse than none: the model would follow whatever
# fragment landed.
#
# SKILL.md is not enough on its own (fix, review finding 14): the guard used
# to check only that file, and the convergence check three lines below
# (`diff -r -q "$SRC" "$dest"`) treats a partial SRC as "differs" from a
# previously-good install — so a source that lost its references/ mid-rsync
# (`deploy/deploy.sh`'s `rsync -az --delete`, interrupted; SKILL.md sorts
# before `references/`) does not fail closed, it REPLACES a good install with
# the fragment, exit 0, no stderr. SKILL.md's own text points a live
# coordinator at the first three of these by name ("Read it before the first
# dispatch of a program"), and the WORKER skill points across at the fourth
# (`../ccrc-coordinator/references/peer-protocol.md` — Build 9 wave 8, D-214:
# it ships here because a skill's references install as one unit and the
# worker ships none of its own) — every one of them missing is exactly the
# half-installed shape the comment above already says is worse than none.
REQUIRED_REFS=(ledger-template.md mail-envelope.md peer-protocol.md wave-lifecycle.md)
[[ -f "$SRC/SKILL.md" ]] || { echo "install-coordinator-skill: no SKILL.md under $SRC — refusing" >&2; exit 1; }
for ref in "${REQUIRED_REFS[@]}"; do
  [[ -f "$SRC/references/$ref" ]] \
    || { echo "install-coordinator-skill: no references/$ref under $SRC — refusing (partial source)" >&2; exit 1; }
done
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
