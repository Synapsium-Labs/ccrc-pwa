#!/usr/bin/env bash
# Regenerates locale.golden: how bash counts a string's length and cuts `${x:0:n}` under every combination of LC_ALL,
# LC_CTYPE, LANG and one other category (LC_MESSAGES) over a set of values (unset, empty, C, POSIX, two spellings of
# C.UTF-8, a UTF-8 locale this box may not have installed, a name no box has, a name with no codeset). Each row runs a
# fresh `env -i` bash, as Claude Code starts the hook, so the locale is the one bash took at startup. The header records
# the box: bash and glibc versions and `locale -a`, the installed list locale_test.go's TestLocaleMeasured feeds the
# decision.
#
#   bash core/internal/domain/attention/testdata/gen-locale.sh          (on the Linux bench; about a minute)
#   bash core/internal/domain/attention/testdata/gen-locale.sh locpath  (locale-locpath.golden: the same rows with LOCPATH
#     naming a directory localedef fills with en_US.UTF-8 and en_US (ISO-8859-1), so an installed UTF-8 locale other than
#     C.UTF-8, and an installed name with no codeset, are measured without root)
#
# Row: <LC_ALL> <LC_CTYPE> <LANG> <LC_MESSAGES>, then per probe string `${#x}`, `${x:0:1}` and `${x:0:2}` (as hex). A
# variable's column is `-` when unset and `''` when set empty.
set -euo pipefail
cd "$(dirname "$0")"
VALS=(- "''" C POSIX C.UTF-8 C.utf8 en_US.UTF-8 xx_YY.UTF-8 en_US)
# A category beside LC_CTYPE: glibc sets every category at once at startup, so a missing one can fail them all.
OTHER=(- C.UTF-8 xx_YY.UTF-8)
# The probes: valid UTF-8 (é … a), a lone 0xff then 0xc3 before an ASCII letter, and a sequence cut short at the end.
OUT=locale.golden
ENVX=()
INSTALLED=$(locale -a | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')
if [ "${1:-}" = locpath ]; then
  LP=$(mktemp -d); trap 'rm -rf "$LP"' EXIT
  localedef -i en_US -f UTF-8 "$LP/en_US.UTF-8" 2>/dev/null || [ -e "$LP/en_US.UTF-8/LC_CTYPE" ] || { echo "localedef cannot build en_US.UTF-8" >&2; exit 2; }
  localedef -i en_US -f ISO-8859-1 "$LP/en_US" 2>/dev/null || [ -e "$LP/en_US/LC_CTYPE" ] || { echo "localedef cannot build en_US" >&2; exit 2; }
  OUT=locale-locpath.golden ENVX=(LOCPATH="$LP")
  INSTALLED="C C.utf8 POSIX en_US en_US.UTF-8"   # LOCPATH's two, and the three glibc has built in
fi
PROBES=($'\xc3\xa9\xe2\x80\xa6a' $'\xff\xc3a' $'a\xe2\x80')
{
  printf '# bash %s\n' "$(bash -c 'printf %s "$BASH_VERSION"')"
  printf '# glibc %s\n' "$(getconf GNU_LIBC_VERSION)"
  printf '# installed %s\n' "$INSTALLED"
  for a in "${VALS[@]}"; do for c in "${VALS[@]}"; do for l in "${VALS[@]}"; do for m in "${OTHER[@]}"; do
    args=(env -i PATH="$PATH" "${ENVX[@]}")
    for kv in "LC_ALL=$a" "LC_CTYPE=$c" "LANG=$l" "LC_MESSAGES=$m"; do
      v=${kv#*=}
      case "$v" in -) ;; "''") args+=("${kv%%=*}=") ;; *) args+=("$kv") ;; esac
    done
    row=$("${args[@]}" bash -c '
      for x in "$@"; do
        printf " %s %s %s" "${#x}" "$(printf %s "${x:0:1}" | od -v -An -tx1 | tr -d " \n")" "$(printf %s "${x:0:2}" | od -v -An -tx1 | tr -d " \n")"
      done' _ "${PROBES[@]}" 2>/dev/null)
    printf '%s %s %s %s%s\n' "$a" "$c" "$l" "$m" "$row"
  done; done; done; done
} > "$OUT"
wc -l "$OUT"
