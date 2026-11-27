#!/usr/bin/env bash
# Regenerates the goldens jqjson_test.go holds the kernel's jq encoder and reader to, from real jq:
#   jq-c.golden, jq-cS.golden, jq-cSa.golden  what `jq -c`, `-cS` and `-cSa` print for each line of jq-cases.json
#                                            (UTF-8 JSON, one value a line) and of jq-cases-bytes.json (strings holding
#                                            bytes that are not UTF-8, written here by printf because no editor keeps them)
#   jq-refused.json                           checked, not written: jq must refuse every line (a high surrogate escape
#                                            with no low one after it), or this script fails
#   jq-version.txt                            the jq that measured them
# Run it from anywhere, with the jq to measure on PATH. Made on the Linux bench (jq 1.7); MSYS2's jq 1.8.2 printed the
# same bytes.
set -euo pipefail
cd "$(dirname "$0")"
printf '"\xff\xfe a \xc3"\n"\xe2\x82 truncated"\n"\xc0\xaf overlong"\n"\xed\xa0\x80 an encoded surrogate"\n{"\xff":"key"}\n"\xe2A"\n"x\xf0\x9fZ"\n"\xe2\\u0041"\n' > jq-cases-bytes.json
jq --version > jq-version.txt
for mode in c cS cSa; do
  cat jq-cases.json jq-cases-bytes.json | jq "-$mode" . > "jq-$mode.golden"
done
while IFS= read -r line; do
  if printf '%s\n' "$line" | jq -c . >/dev/null 2>&1; then echo "jq accepted a line of jq-refused.json: $line" >&2; exit 1; fi
done < jq-refused.json
# jq-double.golden: what jq prints for each number of jq-double-cases.txt once it has computed it (`. * 1` turns the
# literal into a double, -0 kept), the printer JQDouble stands in for.
jq -c '. * 1' < jq-double-cases.txt > jq-double.golden
