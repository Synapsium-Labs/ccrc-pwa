#!/usr/bin/env bash
# Regenerates fable-cases.jsonl and fable.golden: what real jq answers (`test($re)`, Oniguruma) for FABLE_RE, cut from
# ccd/session-hook.sh as the hook defines it, over each string of fable-cases.jsonl. fable_test.go holds attention.FableRE to
# it and fable-re.sha256 pins the pattern's text. Run from anywhere, with the jq to measure on PATH.
set -euo pipefail
cd "$(dirname "$0")"
hook=../../../../../ccd/session-hook.sh
# FABLE_RE is one double-quoted assignment: evaluate just that line in a shell, as the hook's own shell does
line=$(grep -m1 '^FABLE_RE=' "$hook")
eval "$line"
node gen-fable-cases.mjs > fable-cases.jsonl
jq -r -n --arg re "$FABLE_RE" 'inputs | test($re)' fable-cases.jsonl > fable.golden
printf '%s' "$FABLE_RE" | sha256sum | cut -d' ' -f1 > fable-re.sha256
wc -l fable-cases.jsonl fable.golden
