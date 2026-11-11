#!/usr/bin/env bash
# A fake test box that keeps an authorized_keys file, for the access key Rotate and Revoke tests (D-8337). One file, run under
# four names. It never reaches a network.
#   ssh:    every call is appended to FAKE_LOG (a `-- ssh` line, then one line per argument, then `as <key base64>` naming the
#           key it was let in with). The key is the `-i` file's public half (`ssh-keygen -y`); the box lets it in only when
#           that key is on a line of $FAKE_BOX_HOME/.ssh/authorized_keys and, with FAKE_BOX_TRUST set, also in that file (a
#           box whose sshd refuses a listed key, as a `from=` it does not match does). A key it does not let in is
#           `Permission denied`, exit 255. FAKE_BOX_DOWN_FROM=<n>: from the n-th ssh call on, the box does not answer (exit
#           255, a timeout). FAKE_BOX_FAIL_RE: a command that matches it exits 1 on the box and changes nothing. Any other
#           command runs, as the box's shell would read it, with `getent` and `sudo` below first on PATH.
#   getent: `getent passwd <user>` names FAKE_BOX_HOME as the user's home.
#   sudo:   drops `-n` and `--`, then runs the rest.
#   ip:     prints FAKE_IP_OUT.
tool=$(basename "$0")
case "$tool" in
  getent)
    [ "${1-}" = passwd ] || exit 2
    printf '%s:x:0:0::%s:/bin/sh\n' "${2-}" "$FAKE_BOX_HOME"
    exit 0 ;;
  sudo)
    while [ $# -gt 0 ]; do case "$1" in -n) shift ;; --) shift; break ;; *) break ;; esac; done
    exec "$@" ;;
  ip)
    [ -z "${FAKE_IP_OUT:-}" ] || printf '%s\n' "$FAKE_IP_OUT"
    exit 0 ;;
esac
{
  printf -- '-- %s\n' "$tool"
  for a in "$@"; do printf '%s\n' "$a"; done
} >> "${FAKE_LOG:-/dev/null}"
idf="" prev=""
for a in "$@"; do [ "$prev" != -i ] || idf="$a"; prev="$a"; done
cmd="${*: -1}"
count="$FAKE_BOX_HOME/.ssh-calls"
n=$(( $(cat "$count" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$count"
if [ -n "${FAKE_BOX_DOWN_FROM:-}" ] && [ "$n" -ge "$FAKE_BOX_DOWN_FROM" ]; then
  echo "ssh: connect to host box port 22: Connection timed out" >&2
  exit 255
fi
pub="$(ssh-keygen -y -f "$idf" 2>/dev/null | awk '{print $2}')"
listed() { awk -v k="$1" '{ for (i = 1; i <= NF; i++) if ($i == k) f = 1 } END { exit !f }' "$2" 2>/dev/null; }
if [ -z "$pub" ] || ! listed "$pub" "$FAKE_BOX_HOME/.ssh/authorized_keys" \
   || { [ -n "${FAKE_BOX_TRUST:-}" ] && ! listed "$pub" "$FAKE_BOX_TRUST"; }; then
  echo "root@box: Permission denied (publickey)." >&2
  exit 255
fi
printf 'as %s\n' "$pub" >> "${FAKE_LOG:-/dev/null}"
if [ -n "${FAKE_BOX_FAIL_RE:-}" ] && [[ "$cmd" =~ $FAKE_BOX_FAIL_RE ]]; then exit 1; fi
PATH="$FAKE_BOX_BIN:$PATH" exec bash -c "$cmd"
