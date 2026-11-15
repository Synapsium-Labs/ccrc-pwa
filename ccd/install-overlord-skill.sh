#!/usr/bin/env bash
# install-overlord-skill.sh — stage the ccrc-overlord skill ONCE on this box, at
# $HOME/.cc-sessions/overlord-skill, outside every account home. It is the one
# writer of that staged copy: `ccrc update`'s install spine (`_inst_skills`),
# doctor's `--fix` (`_fix_skills`) and deploy.sh's fallback all run it.
#
# The reviewer installer's shape with one destination instead of a loop over
# homes (Overlord plan W1, slug overlord-skill-staged-not-per-home): under
# pinned setting sources an account-level skill is not listed, and the
# Overlord's launch profile loads nothing from an account directory but the
# sign-in, so a copy in every home would serve nobody and would list a sixth
# "never use" skill in every other session. The sandbox piece decides how the
# Overlord's launch loads this staged copy as a project skill.
#
# Like the coordinator installer it carries REQUIRED_REFS, because the skill's
# procedures live in its four references and a SKILL.md without them would
# send the Overlord to files that are not there.
#
# Deploy-time only (not a hook hot path): no timing budget here.
set -euo pipefail

SRC="${CCRC_SKILL_SRC:-$HOME/ccrc/ccd/overlord-skill}"
NAME=ccrc-overlord
DEST="$HOME/.cc-sessions/overlord-skill"
if [[ "${1:-}" == --dest ]]; then
  [[ -n "${2:-}" ]] || { echo "install-overlord-skill: --dest needs a directory" >&2; exit 2; }
  DEST="$2"
fi
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

# Refuse rather than degrade: a half-staged skill is worse than none, because
# the Overlord would follow whatever fragment landed.
REQUIRED_FILES=(SKILL.md)
REQUIRED_REFS=(answering.md operator-model.md routing.md starting.md)
for f in "${REQUIRED_FILES[@]}"; do
  [[ -f "$SRC/$f" ]] \
    || { echo "install-overlord-skill: no $f under $SRC — refusing" >&2; exit 1; }
done
for ref in "${REQUIRED_REFS[@]}"; do
  [[ -f "$SRC/references/$ref" ]] \
    || { echo "install-overlord-skill: no references/$ref under $SRC — refusing (partial source)" >&2; exit 1; }
done
command -v diff >/dev/null 2>&1 \
  || { echo "install-overlord-skill: diff (diffutils) is unavailable — refusing rather than rewriting blind" >&2; exit 1; }

# Converged already? Do not touch it: the test asserts the inode and mtime
# survive a second run.
if [[ -d "$DEST" ]] && diff -r -q "$SRC" "$DEST" >/dev/null 2>&1; then exit 0; fi

tmp="$DEST.tmp.$$"
old="$DEST.old.$$"
rm -rf "$tmp"
if ! { mkdir -p "$(dirname "$DEST")" && mkdir -p "$tmp" && cp -a "$SRC/." "$tmp/"; }; then
  rm -rf "$tmp"; echo "install-overlord-skill: could not stage into $(dirname "$DEST")" >&2; exit 1
fi

if [[ -e "$DEST" ]]; then
  mkdir -p "$BACKUPS"
  cp -a "$DEST" "$BACKUPS/staged.$NAME" \
    || { rm -rf "$tmp"; echo "install-overlord-skill: backup failed for $DEST" >&2; exit 1; }
  mv "$DEST" "$old" || { rm -rf "$tmp"; exit 1; }
fi

# The swap, and its rollback: a failed `mv` must leave the box with the copy
# it had, never with nothing.
if ! mv "$tmp" "$DEST"; then
  rm -rf "$tmp"
  [[ -e "$old" ]] && mv "$old" "$DEST"
  echo "install-overlord-skill: install failed for $DEST" >&2
  exit 1
fi
rm -rf "$old"
