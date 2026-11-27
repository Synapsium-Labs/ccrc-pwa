#!/usr/bin/env bash
# Regenerates turnmark.golden: what real jq prints for TURN_MARK_PROGRAM (cut from ccd/session-hook.sh, as
# `_hook_turn_mark` runs it) over each line of turnmark-cases.jsonl, and "-" for a case the program prints nothing for
# or errors on. turnmark_test.go holds attention.TurnMark to it, so a change of the Go program's shape is red there,
# the Go side of ccd-swap-guards.test.ts's cut of the same program. Run it from anywhere, with the jq to measure on PATH
# (made on the Linux bench, jq 1.7).
set -euo pipefail
cd "$(dirname "$0")"
prog=$(awk '/^TURN_MARK_PROGRAM=/{on=1} on{print} on&&/'"'"'$/&&!/^TURN_MARK_PROGRAM=/{exit}' ../../../../../ccd/session-hook.sh)
prog=${prog#TURN_MARK_PROGRAM=\'}
prog=${prog%\'}
arg() { jq -r --arg k "$2" '.[$k] | tostring' <<<"$1"; }
int() { local v; v=$(arg "$1" "$2"); [[ "$v" =~ ^-?[0-9]+$ ]] && printf '%s' "$v" || printf '%s' -1; }
while IFS= read -r c; do
  out=$(jq -cn --arg prev "$(arg "$c" prev)" --arg kind "$(arg "$c" kind)" --arg sid "$(arg "$c" sid)" \
    --arg ev "$(arg "$c" ev)" --argjson at "$(arg "$c" at)" --argjson bg "$(int "$c" bg)" \
    --argjson crons "$(int "$c" crons)" --arg bgk "$(arg "$c" bgk)" --arg bgi "$(arg "$c" bgi)" \
    --arg err "$(arg "$c" err)" "$prog" 2>/dev/null) || out=""
  printf '%s\n' "${out:--}"
done < turnmark-cases.jsonl > turnmark.golden
# The program these goldens were measured from: TestTurnMarkProgramPinned reds when the bash's program text changes.
printf '%s' "$prog" | sha256sum | cut -d' ' -f1 > turnmark-program.sha256
