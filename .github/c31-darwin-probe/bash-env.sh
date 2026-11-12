# THROWAWAY (Task C31, D-8391): sourced by every non-interactive bash through
# BASH_ENV. Logs every `kill` builtin call that sends a signal (not -0), with
# the sender, to $C31_KILL_LOG; traces release-main.sh and build-release.sh to
# a per-pid file under $C31_TRACE_DIR. Changes no behaviour otherwise.
if [ -n "${C31_KILL_LOG:-}" ]; then
  kill() {
    case "${1-}" in -0|-s0|'-s 0') ;; *)
      printf '%s bash sender=%s ppid=%s src=%s kill %s\n' "${EPOCHREALTIME:-$SECONDS}" "${BASHPID:-$$}" "$PPID" "$0" "$*" >> "$C31_KILL_LOG" 2>/dev/null ;;
    esac
    builtin kill "$@"
  }
fi
if [ -n "${C31_TRACE_DIR:-}" ]; then
  case "$0" in
    */build-release.sh|*/release-main.sh)
      exec 197>>"$C31_TRACE_DIR/${BASHPID:-$$}.trace"
      BASH_XTRACEFD=197
      PS4='+ ${EPOCHREALTIME:-} ${BASH_SOURCE##*/}:${LINENO}: '
      set -x ;;
  esac
fi
