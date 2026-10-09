#!/usr/bin/env bash
# recapture.sh — the delegation corpus's ONE re-capture script (spec 2026-10-04 §8.2; review 304 F12). It is the README's
# recipe, run as one ordered list of steps: capture, sanitise into the committed corpus, rebuild matrix.json, scan the corpus.
# Foreground; a capture takes hours.
#
#   bash server/test/delegation-rig/recapture.sh [--dry-run] [--missing | <version>...]
#
#   (no version)  every installed version               --missing   every installed version the corpus has no directory for
#   <version>...  exactly those (each must be installed)  --dry-run   print the steps and the versions, make and run nothing
#
# The versions are resolved ONCE, before anything is made: a version installed while the capture runs waits for the next
# one (the programme's rule), and "installed" is rig.sh's own answer (`rig.sh versions`), so this and `rig.sh all` agree.
# Every path is resolved from this file's own location, never from the caller's directory.
#
# The raw root it makes (ccrc-dlg-raw.* in ${TMPDIR:-/tmp}) holds UNSANITISED bundles. This script never deletes it, on
# success or on failure, and says where it is; the operator removes it by hand once nothing needs it.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TREE=$(cd "$HERE/../../.." && pwd)
FIX=$TREE/server/test/fixtures/delegation
SCEN=$HERE/scenarios
RIG=$HERE/rig.sh
RAW="" CUR=0

die() { printf 'recapture: %s\n' "$*" >&2; exit 2; }
DRY=0 MISSING=0 NAMED=()
while (( $# )); do
  case $1 in
    --dry-run) DRY=1 ;;
    --missing) MISSING=1 ;;
    -*)        die "unknown option '$1' (usage: recapture.sh [--dry-run] [--missing | <version>...])" ;;
    *)         NAMED+=("$1") ;;
  esac
  shift
done
if (( MISSING && ${#NAMED[@]} )); then die "--missing and named versions do not mix: --missing picks the versions itself"; fi

# `$( )`, not `< <( )`: a refusal from rig.sh (a version not installed, not x.y.z) must stop THIS script with its exit 2.
sel=$(bash "$RIG" versions ${NAMED[@]+"${NAMED[@]}"})
VERS=()
while IFS= read -r v; do
  if [[ -n $v ]]; then VERS+=("$v"); fi
done <<<"$sel"
(( ${#VERS[@]} )) || die "no Claude Code version is installed to capture (rig.sh versions lists none)"
if (( MISSING )); then
  all=${VERS[*]}; VERS=()
  for v in $all; do
    if [[ ! -d $FIX/$v ]]; then VERS+=("$v"); fi
  done
  if (( ${#VERS[@]} == 0 )); then
    printf 'recapture: the corpus already covers every installed version (%s); nothing to capture\n' "$all"
    exit 0
  fi
fi
vs=${VERS[*]}   # digits and dots only (rig.sh checked each one): safe to splice in unquoted

# The steps: the SAME list is printed (--dry-run) and run, by the one loop below, so a dry run shows what a real one does.
# `<raw>` stands for the raw root, which a real run only learns in step 1 (its text then reads "$RAW").
STEP=() WHY=()
add() { WHY+=("$1"); STEP+=("$2"); }
add 'make the raw root and record the versions and the start time' \
  'RAW=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX") && { printf "# started %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; printf "%s\n" '"$vs"'; } > <raw>/versions-at-start'
add 'capture every version against every scenario (rig.sh all; its .done must exist)' \
  "bash $(printf '%q' "$RIG") all <raw> $vs 2>&1 | tee <raw>/all.log && [[ -e <raw>/.done ]]"
add 'sanitise the raw bundles into the corpus (fails closed on any residue)' \
  "node $(printf '%q' "$HERE/sanitize.mjs") <raw> $(printf '%q' "$FIX")"
add 'rebuild matrix.json from the corpus' \
  "node $(printf '%q' "$HERE/build-matrix.mjs") $(printf '%q' "$FIX") $(printf '%q' "$SCEN") --write"
add 'scan the committed corpus for residue' \
  "node $(printf '%q' "$HERE/sanitize.mjs") --scan $(printf '%q' "$FIX")"

KEPT='holds UNSANITISED bundles: never commit it, never copy it off the box, remove it by hand once nothing needs it'
on_exit() {
  local rc=$?
  if (( rc != 0 && CUR > 0 )); then printf 'recapture: step %d failed (exit %d): %s\n' "$CUR" "$rc" "${WHY[CUR-1]}" >&2; fi
  if (( rc != 0 )) && [[ -n $RAW ]]; then printf 'recapture: the raw root %s is kept; it %s\n' "$RAW" "$KEPT" >&2; fi
}
trap on_exit EXIT

if (( DRY )); then printf 'recapture: dry run: nothing is made and nothing is run\n'; fi
printf 'recapture: %d version(s), as installed now: %s\n' "${#VERS[@]}" "$vs"
printf 'recapture: fixtures dir:  %s\n' "$FIX"
printf 'recapture: scenarios dir: %s\n' "$SCEN"
rawref='"$RAW"'
for i in "${!STEP[@]}"; do
  CUR=$((i + 1))
  printf '  %d. %s\n' "$CUR" "${STEP[i]}"
  if (( ! DRY )); then
    eval "${STEP[i]//'<raw>'/$rawref}"
    if (( CUR == 1 )); then printf 'recapture: raw root: %s\n' "$RAW"; fi
  fi
done
printf 'recapture: raw root: %s\n' "${RAW:-<raw>}"
printf 'recapture: it %s: rm -rf %s\n' "$KEPT" "${RAW:-<raw>}"
