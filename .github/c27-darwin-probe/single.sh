#!/usr/bin/env bash
# THROWAWAY (Task C27, D-8344): the fixed probe's own reader (one blocking
# reader, the shell only polls a file), repeated. Removed before the wave-done.
#   single.sh <iterations> <label>
set -u
N="${1:-20}"; LABEL="${2:-plain}"
HELPER="$(cd "$(dirname "$0")/../.." && pwd)/ccd/ccd-account-auth"
red=0; green=0
for i in $(seq 1 "$N"); do
  out=$(
    export CCRC_AUTH_NO_MAIN=1 HOME=$(mktemp -d)
    source "$HELPER"
    D=$(mktemp -d); mkfifo -m 600 "$D/out"
    _auth_timeout 2 bash -c 'bash -c "sleep 60" & sleep 60' >"$D/out" 2>&1 &
    W=$!
    exec 8<"$D/out"
    ( sleep 1; ps -A -o pid=,ppid=,command= 2>/dev/null \
        | awk -v w=$W '$2 == w && $3 ~ /timeout$/ {print $1; exit}' > "$D/tpg" ) &
    ( while IFS= read -r -u 8 line; do :; done; echo eof > "$D/eof" ) &
    R=$!
    t0=$SECONDS; GOT=never
    while (( SECONDS - t0 <= 15 )); do
      if [ -s "$D/eof" ]; then GOT=eof; break; fi
      sleep 0.2
    done
    echo "RESULT=$GOT after=$((SECONDS-t0)) tpg=$(cat "$D/tpg" 2>/dev/null)"
    if [ "$GOT" = never ]; then
      PG=$(cat "$D/tpg" 2>/dev/null)
      [ -n "$PG" ] && ps -A -o pid=,ppid=,pgid=,stat=,command= | awk -v pg="$PG" '$3==pg'
      gtimeout -k 1 3 python3 -I -c 'import os
print("fresh read bytes=%d" % len(os.read(8,100)))' 2>&1
    fi
    kill $W $R 2>/dev/null; pkill -P $BASHPID 2>/dev/null; exec 8<&-
    PG=$(cat "$D/tpg" 2>/dev/null); [ -n "$PG" ] && kill -9 -- "-$PG" 2>/dev/null
    rm -rf "$D"
  )
  case "$out" in
    *RESULT=eof*) green=$((green+1)) ;;
    *) red=$((red+1)); printf '=== %s iteration %s RED\n%s\n' "$LABEL" "$i" "$out" ;;
  esac
done
echo "SINGLE $LABEL: green=$green red=$red of $N"
