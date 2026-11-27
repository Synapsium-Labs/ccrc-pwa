#!/usr/bin/env bash
# Regenerates onig-classes.txt: every code point (surrogates excepted) that real jq's Oniguruma counts in [[:alnum:]] and in
# [[:space:]], as `class first-last` range lines. onig_test.go requires jq's alnum set to be a subset of onigAlnum's (Go's tables
# may only be a superset: D-TBD-go-hook-unicode-tables) and jq's space set to equal onigSpace's. Run with the jq to measure on PATH.
set -euo pipefail
cd "$(dirname "$0")"
for c in alnum space; do
  jq -nr --arg c "$c" '[range(0;1114112) | select(. < 55296 or . > 57343) | select(([.]|implode) | test("[[:" + $c + ":]]"))]
    | reduce .[] as $x ([]; if length > 0 and .[-1][1] == $x - 1 then .[-1][1] = $x else . + [[$x, $x]] end) | .[] | "\($c) \(.[0])-\(.[1])"'
done > onig-classes.txt
wc -l onig-classes.txt
