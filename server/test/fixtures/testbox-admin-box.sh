#!/usr/bin/env bash
# The fake `ssh` of the test box admin verb's access and preflight tests (D-8166, TC4), and the fake `ip` beside it. One
# file, run under two names. It never reaches a network.
#   ssh: every call is appended to FAKE_LOG (a `-- ssh` line, then one line per argument, as testbox-admin-ssh.sh does).
#        The remote command is the LAST argument. FAKE_RULES names a file of rules, one per line, tab separated:
#        <extended regex on the command> <exit code> <stdout, printf %b>. The first rule that matches answers; a command
#        no rule matches exits 127 and prints nothing.
#   ip:  prints FAKE_IP_OUT (what `ip -o route get <address>` prints).
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
[ -z "${FAKE_SSH_ERR_FILE:-}" ] || cat "$FAKE_SSH_ERR_FILE" >&2
[ -z "${FAKE_SSH_RC:-}" ] || exit "$FAKE_SSH_RC"
while IFS=$'\t' read -r re rc out; do
  [ -n "$re" ] || continue
  if [[ "$cmd" =~ $re ]]; then
    # shellcheck disable=SC2059  # the rule's stdout is a printf %b template by design
    [ -z "$out" ] || printf '%b' "$out"
    exit "$rc"
  fi
done < "${FAKE_RULES:-/dev/null}"
exit 127
