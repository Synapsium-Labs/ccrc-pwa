#!/bin/sh
# The fake `ssh`, `ssh-keyscan` and `ssh-keygen` the test box admin verb's tests put first on PATH (D-8166, TC3).
# One file, run under three names (the tests link it as each): it never reaches a network or a key.
#   FAKE_LOG                    every call appended: a `-- <tool>` line, then one line per argument; with
#                               FAKE_CAPTURE_STDIN=1 also a `<stdin>` line and the stdin text.
#   FAKE_<TOOL>_OUT / _RC       what the tool prints on stdout and exits with (TOOL is SSH, SSH_KEYSCAN or SSH_KEYGEN).
#   FAKE_<TOOL>_ERR_FILE        a file whose text the tool prints on stderr.
tool=$(basename "$0")
up=$(printf '%s' "$tool" | tr 'a-z-' 'A-Z_')
{
  printf -- '-- %s\n' "$tool"
  for a in "$@"; do printf '%s\n' "$a"; done
} >> "${FAKE_LOG:-/dev/null}"
if [ "${FAKE_CAPTURE_STDIN:-}" = 1 ]; then
  { printf '<stdin>\n'; cat; } >> "${FAKE_LOG:-/dev/null}"
fi
eval "out=\${FAKE_${up}_OUT:-}; rc=\${FAKE_${up}_RC:-0}; errf=\${FAKE_${up}_ERR_FILE:-}"
[ -z "$out" ] || printf '%s\n' "$out"
[ -z "$errf" ] || cat "$errf" >&2
exit "$rc"
