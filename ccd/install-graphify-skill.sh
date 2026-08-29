#!/usr/bin/env bash
# install-graphify-skill.sh — converge the graphify skill into every rostered
# wrapper home. Same swap loop as install-worker-skill.sh (diff -r -q
# convergence, backup + staged mv + rollback, per-home isolation) with one
# structural difference stated by the spec (§B): SRC is ASSEMBLED from the
# INSTALLED PACKAGE, never vendored — <pkg>/skill.md is the body,
# <pkg>/skills/claude/references/ the sidecar, and .graphify_version is written
# from the pin — so the staged tree is byte-identical to $dest and the diff can
# converge. Two writers to <home>/skills/graphify would drift: ccrc's installer
# is the ONLY sanctioned one (graphify's own `claude install` writes the same
# path — never run it on a rostered home).
set -euo pipefail

VENV="${CCRC_GRAPHIFY_VENV:-$HOME/.ccrc/graphify-venv}"
NAME=graphify
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

PIN="${CCRC_GRAPHIFY_PIN:-}"
[ -n "$PIN" ] || PIN="$(cat "$HOME/.ccrc/graphify.pin" 2>/dev/null || true)"
[ -n "$PIN" ] \
  || { echo "install-graphify-skill: no pin — run the engine step first (~/.ccrc/graphify.pin missing)" >&2; exit 1; }

PKG="${CCRC_GRAPHIFY_PKG:-}"
if [ -z "$PKG" ]; then
  PKG="$("$VENV/bin/python" -c 'import graphify, pathlib; print(pathlib.Path(graphify.__file__).parent)')" \
    || { echo "install-graphify-skill: cannot resolve the graphify package from $VENV — refusing" >&2; exit 1; }
fi
[ -f "$PKG/skill.md" ] \
  || { echo "install-graphify-skill: no skill.md under $PKG — refusing (the skill body is <pkg>/skill.md, spec §B)" >&2; exit 1; }
[ -d "$PKG/skills/claude/references" ] \
  || { echo "install-graphify-skill: no skills/claude/references under $PKG — refusing" >&2; exit 1; }
command -v diff >/dev/null 2>&1 \
  || { echo "install-graphify-skill: diff unavailable — refusing rather than rewriting blind" >&2; exit 1; }

# The assembled SRC — what every home must converge to, byte for byte.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/graphify-skill-src.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT INT TERM
mkdir -p "$STAGE/references"
cp -a "$PKG/skill.md" "$STAGE/SKILL.md"
cp -a "$PKG/skills/claude/references/." "$STAGE/references/"
printf '%s' "$PIN" > "$STAGE/.graphify_version"   # graphify's own installer writes no newline
SRC="$STAGE"

homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else
  # shellcheck source=/dev/null
  source "$HOME/.ccrc/accounts.sh" \
    || { echo "install-graphify-skill: no roster at \$HOME/.ccrc/accounts.sh" >&2; exit 1; }
  for _a in "${CCRC_ACCOUNTS[@]}"; do homes+=("$(_ccrc_cfg_dir "$_a")"); done
fi

rc=0
declare -A seen_skills=()
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue
  mkdir -p "$dir/skills" 2>/dev/null || { rc=1; continue; }
  skills_real="$(realpath "$dir/skills" 2>/dev/null)" || { rc=1; continue; }
  # Two rostered homes symlink skills/ into one directory (.claude-gpt/.claude-kimi
  # -> ~/.claude/skills on the reference fleet): write each REAL directory once.
  [[ -n "${seen_skills[$skills_real]:-}" ]] && continue
  seen_skills[$skills_real]=1
  dest="$skills_real/$NAME"

  # Converged already? Do not touch it. Idempotence is observable: the test
  # asserts the inode and mtime survive a second run.
  if [[ -d "$dest" ]] && diff -r -q "$SRC" "$dest" >/dev/null 2>&1; then continue; fi

  tmp="$dest.tmp.$$"
  old="$dest.old.$$"
  rm -rf "$tmp"
  mkdir -p "$dir/skills" && mkdir -p "$tmp" && cp -a "$SRC/." "$tmp/" \
    || { rm -rf "$tmp"; echo "install-graphify-skill: could not stage into $dir" >&2; rc=1; continue; }

  if [[ -e "$dest" ]]; then
    mkdir -p "$BACKUPS"
    cp -a "$dest" "$BACKUPS/$(basename "$dir").skills.$NAME" \
      || { rm -rf "$tmp"; echo "install-graphify-skill: backup failed for $dest" >&2; rc=1; continue; }
    mv "$dest" "$old" || { rm -rf "$tmp"; rc=1; continue; }
  fi

  # The swap, and its rollback: a failed `mv` must leave the home with the
  # skill it had, never with nothing.
  if ! mv "$tmp" "$dest"; then
    rm -rf "$tmp"
    [[ -e "$old" ]] && mv "$old" "$dest"
    echo "install-graphify-skill: install failed for $dir" >&2
    rc=1
    continue
  fi
  rm -rf "$old"
done
exit "$rc"
