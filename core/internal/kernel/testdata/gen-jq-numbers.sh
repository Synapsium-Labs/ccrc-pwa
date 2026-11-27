#!/usr/bin/env bash
# Regenerates jq-numbers.golden, the lexicon of number-like tokens jq reads, from real jq:
#   each line of jq-numbers.txt is one spelling X; the golden line is  X <TAB> out(X) <TAB> out([X]) <TAB> out({"a":X})
#   where out is what `jq -c .` prints for that text, or REFUSED when jq fails (jq's lexer takes the run of characters up
#   to a blank or one of []{},:" as one literal and judges it whole: `nan`, `Infinity`, `01`, `+1`, `.5`, `1.` are read,
#   `truex`, `1-1`, `0x1`, `1e` are not).
# Run it from anywhere with the jq to measure on PATH (JQFLAGS=-b for MSYS2's jq). Measured on jq 1.7 (the Linux bench)
# and jq 1.8.1 (Windows): the two answered every spelling alike, which this script checks by being run on each and the
# results cmp-equal; a spelling they ever answer differently is read as the union by the kernel (jqNumber).
set -euo pipefail
cd "$(dirname "$0")"
out() { local r; r=$(printf '%s\n' "$1" | jq ${JQFLAGS:-} -c . 2>/dev/null) && printf '%s' "$r" || printf 'REFUSED'; }
while IFS= read -r s; do
  printf '%s\t%s\t%s\t%s\n' "$s" "$(out "$s")" "$(out "[$s]")" "$(out "{\"a\":$s}")"
done < jq-numbers.txt > "${1:-jq-numbers.golden}"
