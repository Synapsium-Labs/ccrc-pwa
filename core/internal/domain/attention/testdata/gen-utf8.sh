#!/usr/bin/env bash
# Regenerates utf8.golden: how bash under a UTF-8 LC_CTYPE (glibc's decoder) counts `${#x}` and cuts `${x:0:1}` and
# `${x:0:2}` over byte sequences Go's decoder and glibc's may read differently: every lead byte 0x80..0xff followed by
# 0 to 5 continuation bytes, the first of them at each range boundary (0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf: the
# overlong, surrogate and above-U+10FFFF edges), the rest 0x80, then an ASCII `a`; and the review's named cases.
# locale_test.go's TestUTF8Measured holds Chars and Clip to it.
#
#   bash core/internal/domain/attention/testdata/gen-utf8.sh      (on the Linux bench; seconds)
#
# Row: <input as hex> <${#x}> <${x:0:1} as hex> <${x:0:2} as hex>.
set -euo pipefail
cd "$(dirname "$0")"
in=$(mktemp)
trap 'rm -f "$in"' EXIT
{
  for lead in $(seq 128 255); do
    for k in 0 1 2 3 4 5; do
      for c in 80 8f 90 9f a0 bf; do
        h=$(printf '%02x' "$lead")
        if [ "$k" -gt 0 ]; then h+=$c; for _ in $(seq 2 "$k"); do h+=80; done; fi
        printf '%s61\n' "$h"
        [ "$k" -gt 0 ] || break
      done
    done
  done
  # the review's eleven, and a few more shapes: a combining mark, an emoji, a surrogate, overlongs, U+FFFE, truncations
  printf '%s\n' f490808061 f88880808061 cc8161 f09f988061 eda08061 c08061 c1bf61 efbfbe61 e28261 f09f9861 61e282 \
    fc8480808080 fdbfbfbfbfbf61 feff61 c3 e2 f0 f8 fc
} | sort -u > "$in"
printf '# bash %s\n' "$(bash -c 'printf %s "$BASH_VERSION"')" > utf8.golden
printf '# glibc %s\n' "$(getconf GNU_LIBC_VERSION)" >> utf8.golden
env -i PATH="$PATH" LC_ALL=C.UTF-8 bash -c '
  while IFS= read -r h; do
    x=$(printf "$(sed "s/../\\\\x&/g" <<<"$h")")
    printf "%s %s %s %s\n" "$h" "${#x}" "$(printf %s "${x:0:1}" | od -v -An -tx1 | tr -d " \n")" "$(printf %s "${x:0:2}" | od -v -An -tx1 | tr -d " \n")"
  done' < "$in" >> utf8.golden
wc -l utf8.golden
