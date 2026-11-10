#!/usr/bin/env bash
# The fake `ssh` and `ip` of the test box admin verb's connect tests (D-8166, TC7). One file, run under two names. It never
# reaches a network.
#   ssh: every call is appended to FAKE_LOG (a `-- ssh` line, then one line per argument, then `<stdin N>`); the call's
#        stdin is kept whole as $FAKE_STDIN_DIR/N (N counts the calls from 1). The remote command is the LAST argument.
#        FAKE_RULES names a file of rules, one per line, tab separated: <extended regex on the command> <exit code>
#        <stdout, printf %b>. The first rule that matches answers; a command no rule matches exits 127.
#        FAKE_HOOK_RE and FAKE_HOOK: when the command matches the first, the second (a shell snippet) runs before the answer.
#   ip:  prints FAKE_IP_OUT.
tool=$(basename "$0")
{
  printf -- '-- %s\n' "$tool"
  for a in "$@"; do printf '%s\n' "$a"; done
} >> "${FAKE_LOG:-/dev/null}"
if [ "$tool" = ip ]; then
  [ -z "${FAKE_IP_OUT:-}" ] || printf '%s\n' "$FAKE_IP_OUT"
  exit "${FAKE_IP_RC:-0}"
fi
cmd="${*: -1}"
n=1
if [ -n "${FAKE_STDIN_DIR:-}" ]; then
  mkdir -p "$FAKE_STDIN_DIR"
  while [ -e "$FAKE_STDIN_DIR/$n" ]; do n=$((n + 1)); done
  cat >"$FAKE_STDIN_DIR/$n"
  printf '<stdin %s>\n' "$n" >> "${FAKE_LOG:-/dev/null}"
fi
if [ -n "${FAKE_HOOK_RE:-}" ] && [[ "$cmd" =~ $FAKE_HOOK_RE ]]; then eval "$FAKE_HOOK"; fi
while IFS=$'\t' read -r re rc out; do
  [ -n "$re" ] || continue
  if [[ "$cmd" =~ $re ]]; then
    # shellcheck disable=SC2059  # the rule's stdout is a printf %b template by design
    [ -z "$out" ] || printf '%b' "$out"
    exit "$rc"
  fi
done < "${FAKE_RULES:-/dev/null}"
exit 127
