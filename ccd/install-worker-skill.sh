#!/usr/bin/env bash
# install-worker-skill.sh — put the ccrc worker skill in every wrapper home's
# skills dir. Byte-for-byte the same shape as install-coordinator-skill.sh —
# same roster-derived homes, same fail-closed preflight, same diff -r -q
# convergence check, same backup + staged mv + rollback, same per-home
# isolation — because the reason for all of it is identical: skills resolve
# per CLAUDE_CONFIG_DIR, and a session's ACCOUNT drifts on swap while its id
# does not. A worker session, like the coordinator, is placed with no pinned
# account, so a swap must never land it on a home without its skill.
#
# The one real difference from the coordinator installer: REQUIRED_FILES below
# is (SKILL.md) alone, not SKILL.md-plus-references/. This skill carries no
# references of its own — it points at the coordinator's installed tree
# (../ccrc-coordinator/references/{wave-lifecycle,mail-envelope}.md, both
# skills sitting side by side under <config dir>/skills/) rather than shipping
# a second copy of pinned content. Cloning the coordinator's REQUIRED_REFS
# guard with an empty array would be a LIE about why it's empty — a reader
# would have no way to tell "nothing required" from "forgot to require
# anything" — so this is a differently-shaped guard, not an emptied one.
#
# Deploy-time only (not a hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED source — deploy.sh rsyncs ccd/worker-skill/ to
# ~/.cc-sessions/worker-skill/ on the fleet host. Overridable so the test
# harness can point it at the repo copy without a deploy.
SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/worker-skill}"
NAME=ccrc-worker
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
    || { echo "install-worker-skill: no account roster at $HOME/.ccrc/accounts.sh — generate it from ~/.ccrc/accounts.json first" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

# Refuse rather than degrade — ccd's own rule for a missing tool
# (`ccd:2135-2139`: "refusing to run the destructive verb unserialised"). A
# half-installed skill is worse than none: the model would follow whatever
# fragment landed.
REQUIRED_FILES=(SKILL.md)
for f in "${REQUIRED_FILES[@]}"; do
  [[ -f "$SRC/$f" ]] \
    || { echo "install-worker-skill: no $f under $SRC — refusing" >&2; exit 1; }
done
command -v diff >/dev/null 2>&1 \
  || { echo "install-worker-skill: diff (diffutils) is unavailable — refusing rather than rewriting blind" >&2; exit 1; }

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
    || { rm -rf "$tmp"; echo "install-worker-skill: could not stage into $dir" >&2; rc=1; continue; }

  if [[ -e "$dest" ]]; then
    mkdir -p "$BACKUPS"
    cp -a "$dest" "$BACKUPS/$(basename "$dir").skills.$NAME" \
      || { rm -rf "$tmp"; echo "install-worker-skill: backup failed for $dest" >&2; rc=1; continue; }
    mv "$dest" "$old" || { rm -rf "$tmp"; rc=1; continue; }
  fi

  # The swap, and its rollback: a failed `mv` must leave the home with the
  # skill it had, never with nothing.
  if ! mv "$tmp" "$dest"; then
    rm -rf "$tmp"
    [[ -e "$old" ]] && mv "$old" "$dest"
    echo "install-worker-skill: install failed for $dir" >&2
    rc=1
    continue
  fi
  rm -rf "$old"
done
exit "$rc"
