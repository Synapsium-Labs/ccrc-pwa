#!/usr/bin/env bash
# Regenerates sweep-program.txt and sweep.golden: the census read's jq program, cut from `_hook_graph_card` in
# ccd/session-hook.sh (the lines between `row=$(jq -r --arg s "$src"` and `graph-sweep.json`), and real jq's answer over
# each case of sweep-cases.jsonl: `<exit status> <stdout as hex, or ->`, one line a case after jq's version. Run on the
# Linux bench (bash gen-sweep-golden.sh); cards_test.go holds attention.SweepRow to it and the program to the hook's text.
set -euo pipefail
cd "$(dirname "$0")"
HOOK=../../../../../ccd/session-hook.sh
awk '/row=\$\(jq -r --arg s "\$src"/ { on = 1; next } on && /graph-sweep\.json/ { exit } on { print }' "$HOOK" \
  | sed -e "s/^ *'//" -e "s/' *\\\\\$//" -e "s/'\$//" > sweep-program.txt
prog=$(cat sweep-program.txt)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
jq --version > sweep.golden
while IFS= read -r c; do
  jq -j '.file' <<<"$c" > "$tmp/f.json"
  src=$(jq -j '.src' <<<"$c")
  set +e
  jq -r --arg s "$src" "$prog" "$tmp/f.json" > "$tmp/out" 2>/dev/null
  rc=$?
  set -e
  hex=$(od -v -An -tx1 < "$tmp/out" | tr -d ' \n')
  printf '%s %s\n' "$rc" "${hex:--}" >> sweep.golden
done < sweep-cases.jsonl
wc -l sweep.golden
