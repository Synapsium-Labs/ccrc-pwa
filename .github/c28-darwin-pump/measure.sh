#!/usr/bin/env bash
# THROWAWAY (Task C28, D-8345): drives the account sign-in helper's real spawn,
# pump and wait on this box, against a mint that prints two lines and exits 0 at
# once, and counts the runs whose pump did not see the end of the stream before
# its own backstop (CCRC_AUTH_TIMEOUT + CCRC_AUTH_PUMP_GRACE = 10 s). Every tick
# read's exit code is logged, so a red shows whether the pump ever saw rc 1.
# usage: measure.sh <helper> <iterations> <label> [linux|darwin]
set -u
H=$1 n=$2 label=$3 arm=${4:-}
red=0
for i in $(seq 1 "$n"); do
  home=$(mktemp -d "${RUNNER_TEMP:-/tmp}/c28.XXXXXX")
  out="$home/r.txt"
  HOME="$home" CCRC_AUTH_NO_MAIN=1 CCRC_AUTH_TICK=1 CCRC_AUTH_TIMEOUT=6 CCRC_AUTH_PUMP_GRACE=4 ARM="$arm" \
    timeout 40 bash -c '
    source "$1"; AUTH_ID=claude-a
    [ -z "$ARM" ] || CCD_OS=$ARM
    log="$2.rcs"
    eval "$(declare -f _auth_read | sed "1s/_auth_read/_auth_read_orig/")"
    _auth_read() { local r=0; _auth_read_orig "$@" || r=$?; printf "%s " "$r" >> "$log"; return "$r"; }
    _auth_open_pipes || exit 9
    _auth_spawn_pty_child bash -c "echo line-one; echo line-two; exit 0"
    child=$AUTH_CHILD; exec 8<"$AUTH_RUN/out"
    t0=$EPOCHREALTIME
    _auth_pump > "$2.pump"
    t1=$EPOCHREALTIME
    wait "$child"; rc=$?
    _auth_close_pipes
    printf "ms=%s rc=%s expired=%s os=%s\n" "$(( (${t1/./} - ${t0/./}) / 1000 ))" "$rc" "$AUTH_EXPIRED" "$CCD_OS" > "$2"
  ' _ "$H" "$out" </dev/null >/dev/null 2>&1
  r=$(cat "$out" 2>/dev/null || echo hung)
  lines=$(( $(grep -c line- "$out.pump" 2>/dev/null) + 0 ))
  case "$r" in
    *expired=0*) [ "$lines" = 2 ] || { red=$((red+1)); echo "RED(lines) $label #$i: $r lines=$lines"; } ;;
    *) red=$((red+1)); echo "RED $label #$i: $r lines=$lines tick-rcs: $(cat "$out.rcs" 2>/dev/null | tr ' ' '\n' | sort | uniq -c | tr '\n' ' ')" ;;
  esac
done
echo "SUMMARY $label: $red of $n red"
