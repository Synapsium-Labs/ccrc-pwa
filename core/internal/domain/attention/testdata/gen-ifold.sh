#!/usr/bin/env bash
# Regenerates ifold.txt: for each piece of the forbidden program's two case-insensitive patterns (`test(…; "i")`: the
# installer's URLs and `npm_config_global=` / `npm_config_location=`), every character, every pair and every triple of
# their literal text, the code points (surrogates excepted) that real jq's Oniguruma matches against that piece alone
# under "i": `<piece as JSON> <code point>` a line. Oniguruma folds case fully, so one code point can match two or three
# letters (U+FB06 matches `st`, U+FB01 `fi`); guard_test.go's TestIFoldMeasured holds attention's fold table to this
# file. Run with the jq to measure on PATH (JQ=…, JQFLAGS=-b for a native Windows jq). Takes minutes.
set -euo pipefail
cd "$(dirname "$0")"
JQ=${JQ:-jq}
JQFLAGS=${JQFLAGS:-}
"$JQ" $JQFLAGS -nr '
  ["claude.ai/install.sh", "claude.ai/install.ps1", "claude.ai/install.cmd", "downloads.claude.ai", "npm_config_global=", "npm_config_location="]
  | [.[] | explode as $e | range(1; 4) as $n | range(0; ($e | length) - $n + 1) as $i | $e[$i:$i + $n] | implode] | unique | .[]
  | . as $t | ($t | gsub("(?<c>[.\\\\/+*?()|\\[\\]{}^$])"; "\\\(.c)")) as $re
  | range(0; 1114112) | select(. < 55296 or . > 57343) | select(([.] | implode) | test("^" + $re + "$"; "i"))
  | "\($t | tojson) \(.)"' > ifold.txt
wc -l ifold.txt
