#!/usr/bin/env bash
# Regenerates fanout-cases.jsonl and fanout.golden: what real jq prints for the fan-out scanner (the program cut from
# ccd/session-hook.sh, as the hook runs it: `fo=$(jq -r --arg file "$fosrc" '...' <<<"$payload")`) over each case, "" for
# a case it allows or errors on (the hook reads an error as no verdict). All cases go through one jq, the program wrapped
# in a def taking $file. fanout_test.go holds attention.FanOutVerdict to the goldens, so a change of the Go walk's shape
# is red there, the Go side of the text the bash carries. Run from anywhere, with the jq to measure on PATH (made on the
# Linux bench, jq 1.7; identical under 1.8).
set -euo pipefail
cd "$(dirname "$0")"
prog=$(node cut-fanout-program.mjs ../../../../../ccd/session-hook.sh)
node gen-fanout-cases.mjs > fanout-cases.jsonl
jq -r -n "def prog(\$file): $prog; inputs | . as \$c | try (\$c.p | prog(\$c.file)) catch \"\"" fanout-cases.jsonl > fanout.golden
printf '%s' "$prog" | sha256sum | cut -d' ' -f1 > fanout-program.sha256
wc -l fanout-cases.jsonl fanout.golden
