#!/usr/bin/env bash
# extraction-manifest.sh — a canonical, comparable content manifest of the ccrc
# product tree.
#
# It runs in TWO repo layouts and normalises paths so both produce the same key
# for the same file. That is the entire point: the pre-extraction manifest taken
# in OpenClawHetzner and the post-extraction manifest taken in ccrc-pwa are
# diffed against each other, and any difference is a file that changed during
# the move.
#
#   monorepo:   infra/ccrc/server/src/a.ts        -> server/src/a.ts
#               infra/ccrc-portability/ccd   -> ccd/ccd
#   standalone: server/src/a.ts                   -> server/src/a.ts
#
# No `set -e`: this file follows ccd's convention, because `local x=$(cmd)`
# returns local's status and silently swallows failures.
set -uo pipefail

ROOT="."
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT" || { echo "cannot enter $ROOT" >&2; exit 2; }

# The four files that move out of ccrc-portability, and where they land.
# Everything else in that directory is operator tooling that stays behind, so
# this is an allowlist rather than a set of exclusions — a new file appearing
# there must be considered deliberately, not swept along.
PORTABILITY_FILES="ccd claude-session@.service statusline-command.sh tmux.conf"

# Excluded everywhere: build output, dependencies, and the one test that stays
# with the Mac-side tool it exercises.
is_excluded() {
  case "$1" in
    */node_modules/*|*/dist/*|*/dist-pwa/*|*/.git/*) return 0 ;;
    */server/test/ccd-ccclip.test.ts) return 0 ;;
    *) return 1 ;;
  esac
}

emit() {  # emit <file-on-disk> <canonical-path>
  is_excluded "/$2" && return 0
  printf '%s  %s\n' "$2" "$(sha256sum "$1" | cut -d' ' -f1)"
}

MODE=""
[ -d "infra/ccrc" ] && MODE="monorepo"
[ -z "$MODE" ] && [ -d "server" ] && MODE="standalone"

if [ -z "$MODE" ]; then
  # An unrecognised tree must fail loudly. An empty manifest compares equal to
  # another empty manifest, so a silent exit 0 here would report a verified
  # extraction while having examined nothing at all.
  echo "extraction-manifest: no ccrc tree found under $ROOT" >&2
  exit 1
fi

{
  if [ "$MODE" = "monorepo" ]; then
    find infra/ccrc -type f 2>/dev/null | while read -r f; do
      emit "$f" "${f#infra/ccrc/}"
    done
    for n in $PORTABILITY_FILES; do
      [ -f "infra/ccrc-portability/$n" ] || continue
      emit "infra/ccrc-portability/$n" "ccd/$n"
    done
  else
    find server agent pwa shared deploy ccd scripts .github -type f 2>/dev/null \
      | while read -r f; do emit "$f" "$f"; done
    if [ -f README.md ]; then emit README.md README.md; fi
  fi
} | LC_ALL=C sort
