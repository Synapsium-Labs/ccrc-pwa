#!/usr/bin/env bash
# install-linear-skill.sh — put the ccrc Linear skill in every wrapper home's
# skills dir. The fifth near-clone of install-coordinator-skill.sh (#1444,
# spec 2026-10-31 §11; the clone debt the history skill's spec records grows by
# one): the same roster-derived homes, the same fail-closed preflight, the same
# diff -r -q convergence check, the same backup + staged mv + rollback and the
# same per-home isolation, for the same reason: skills resolve per
# CLAUDE_CONFIG_DIR, and a session's ACCOUNT drifts on swap while its id does
# not, so every rostered home must carry the skill a session reaches Linear
# with. Every session's, whatever its role, as the history skill is: an
# ordinary session the operator asks to file a ticket loads it by its
# description, so no home is a program-only home here.
#
# REQUIRED_FILES below is (SKILL.md) alone: the skill carries no references
# and no sidecar, and it points into no other skill's tree, so like the
# history skill's it has no ordering dependency on the coordinator's.
#
# Deploy-time only (not a hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED source — deploy.sh rsyncs ccd/linear-skill/ to
# ~/.cc-sessions/linear-skill/ on the fleet host, and `ccrc install`'s
# _inst_skills places the same tree at the same path. Overridable so the test
# harness can point it at the repo copy without a deploy.
SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/linear-skill}"
NAME=ccrc-linear
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
    || { echo "install-linear-skill: no account roster at $HOME/.ccrc/accounts.sh — generate it from ~/.ccrc/accounts.json first" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

# Refuse rather than degrade, as the four sibling installers do: a
# half-installed skill is worse than none.
REQUIRED_FILES=(SKILL.md)
for f in "${REQUIRED_FILES[@]}"; do
  [[ -f "$SRC/$f" ]] \
    || { echo "install-linear-skill: no $f under $SRC — refusing" >&2; exit 1; }
done
command -v diff >/dev/null 2>&1 \
  || { echo "install-linear-skill: diff (diffutils) is unavailable — refusing rather than rewriting blind" >&2; exit 1; }

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
    || { rm -rf "$tmp"; echo "install-linear-skill: could not stage into $dir" >&2; rc=1; continue; }

  if [[ -e "$dest" ]]; then
    mkdir -p "$BACKUPS"
    cp -a "$dest" "$BACKUPS/$(basename "$dir").skills.$NAME" \
      || { rm -rf "$tmp"; echo "install-linear-skill: backup failed for $dest" >&2; rc=1; continue; }
    mv "$dest" "$old" || { rm -rf "$tmp"; rc=1; continue; }
  fi

  # The swap, and its rollback: a failed `mv` must leave the home with the
  # skill it had, never with nothing.
  if ! mv "$tmp" "$dest"; then
    rm -rf "$tmp"
    [[ -e "$old" ]] && mv "$old" "$dest"
    echo "install-linear-skill: install failed for $dir" >&2
    rc=1
    continue
  fi
  rm -rf "$old"
done
exit "$rc"
