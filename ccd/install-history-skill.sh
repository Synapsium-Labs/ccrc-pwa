#!/usr/bin/env bash
# install-history-skill.sh — put the ccrc history skill in every wrapper home's
# skills dir. The fourth near-clone of install-coordinator-skill.sh (ccrc
# history spec 2026-10-05 §8.5 records the clone as debt): the same
# roster-derived homes, the same fail-closed preflight, the same diff -r -q
# convergence check, the same backup + staged mv + rollback and the same
# per-home isolation, for the same reason: skills resolve per
# CLAUDE_CONFIG_DIR, and a session's ACCOUNT drifts on swap while its id does
# not, so every rostered home (a gateway lane's included, spec §6.10) must
# carry the skill a session recalls with.
#
# The one real difference from the worker installer: REQUIRED_FILES below is
# (SKILL.md LICENSE.lossless-claw). The skill's recall-policy sentences are
# adapted from lossless-claw, whose MIT notice must travel with every copy
# (spec §12), and `cp -a "$SRC/."` is what carries the sidecar into each
# home. A source holding SKILL.md without it would install the material with
# its notice stripped, so that is a refusal, not a degraded install. The skill
# points into no other skill's tree, so unlike the worker's and the
# reviewer's it has no ordering dependency on the coordinator's.
#
# Deploy-time only (not a hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED source — deploy.sh rsyncs ccd/history-skill/ to
# ~/.cc-sessions/history-skill/ on the fleet host, and `ccrc install`'s
# _inst_skills places the same tree at the same path. Overridable so the test
# harness can point it at the repo copy without a deploy.
SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/history-skill}"
NAME=ccrc-history
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
    || { echo "install-history-skill: no account roster at $HOME/.ccrc/accounts.sh — generate it from ~/.ccrc/accounts.json first" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

# Refuse rather than degrade, as the three sibling installers do: a
# half-installed skill is worse than none, and this one's second file is its
# licence notice.
REQUIRED_FILES=(SKILL.md LICENSE.lossless-claw)
for f in "${REQUIRED_FILES[@]}"; do
  [[ -f "$SRC/$f" ]] \
    || { echo "install-history-skill: no $f under $SRC — refusing" >&2; exit 1; }
done
command -v diff >/dev/null 2>&1 \
  || { echo "install-history-skill: diff (diffutils) is unavailable — refusing rather than rewriting blind" >&2; exit 1; }

rc=0
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue           # a box missing some of the roster's wrappers is ordinary
  dest="$dir/skills/$NAME"

  # Converged already? Do not touch it. Idempotence is observable: the test
  # asserts the inode and mtime of BOTH files survive a second run.
  if [[ -d "$dest" ]] && diff -r -q "$SRC" "$dest" >/dev/null 2>&1; then continue; fi

  tmp="$dest.tmp.$$"
  old="$dest.old.$$"
  rm -rf "$tmp"
  mkdir -p "$dir/skills" && mkdir -p "$tmp" && cp -a "$SRC/." "$tmp/" \
    || { rm -rf "$tmp"; echo "install-history-skill: could not stage into $dir" >&2; rc=1; continue; }

  if [[ -e "$dest" ]]; then
    mkdir -p "$BACKUPS"
    cp -a "$dest" "$BACKUPS/$(basename "$dir").skills.$NAME" \
      || { rm -rf "$tmp"; echo "install-history-skill: backup failed for $dest" >&2; rc=1; continue; }
    mv "$dest" "$old" || { rm -rf "$tmp"; rc=1; continue; }
  fi

  # The swap, and its rollback: a failed `mv` must leave the home with the
  # skill it had, never with nothing.
  if ! mv "$tmp" "$dest"; then
    rm -rf "$tmp"
    [[ -e "$old" ]] && mv "$old" "$dest"
    echo "install-history-skill: install failed for $dir" >&2
    rc=1
    continue
  fi
  rm -rf "$old"
done
exit "$rc"
