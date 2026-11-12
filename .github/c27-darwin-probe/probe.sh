#!/usr/bin/env bash
# THROWAWAY (Task C27, D-2661): the platform-hazards candidate (b) scenario,
# repeated, with diagnostics that do not depend on the writer subshell still
# being alive. Removed before the wave-done.
#   probe.sh <iterations> <label>
set -u
N="${1:-20}"; LABEL="${2:-plain}"
HELPER="$(cd "$(dirname "$0")/../.." && pwd)/ccd/ccd-account-auth"
red=0; green=0
for i in $(seq 1 "$N"); do
  out=$(
    export CCRC_AUTH_NO_MAIN=1 HOME=$(mktemp -d)
    source "$HELPER"
    D=$(mktemp -d); mkfifo -m 600 "$D/out"
    L="$D/log"; : >"$L"; export L
    # The probe's own child, plus timestamps written to a SEPARATE file.
    { _auth_timeout 2 bash -c 'echo "c $$ $EPOCHREALTIME" >>"$L"; bash -c "echo g \$\$ \$EPOCHREALTIME >>\"\$L\"; sleep 60" & sleep 60' ; echo "w rc=$? $EPOCHREALTIME" >>"$L"; } >"$D/out" 2>&1 &
    W=$!
    exec 8<"$D/out"
    T0=$EPOCHREALTIME
    ( sleep 1; ps -A -o pid=,ppid=,pgid=,stat=,command= > "$D/pre" 2>/dev/null ) &
    t0=$SECONDS; GOT=none
    while :; do
      IFS= read -r -t 0.5 -u 8 line; rc=$?
      if (( rc == 1 )); then GOT=eof; break; fi
      if (( SECONDS - t0 > 15 )); then GOT=never; break; fi
    done
    T1=$EPOCHREALTIME
    echo "RESULT=$GOT t0=$T0 t1=$T1"
    if [ "$GOT" = never ]; then
      echo "--- log"; cat "$L"
      echo "--- pre-tree (pgid of the timeout and its members, at t+1s)"
      awk -v me=$$ -v w=$W '$2==w || $1==w' "$D/pre"
      TPID=$(awk -v w=$W '$2==w && $5 ~ /timeout/ {print $1}' "$D/pre" | head -1)
      echo "timeout pid=$TPID"
      awk -v pg="$TPID" '$3==pg' "$D/pre"
      echo "--- now: anything still in that group, or a sleep 60 anywhere"
      ps -A -o pid=,ppid=,pgid=,stat=,command= | awk -v pg="$TPID" '$3==pg || ($5=="sleep" && $6=="60")'
      echo "--- lsof of my own fds (how Darwin lsof names the FIFO)"
      lsof -n -p $$ 2>&1 | grep -i -E "fifo|pipe|COMMAND" | head -8
      echo "--- lsof by path"
      lsof -n -- "$D/out" 2>&1 | head -5
      echo "--- lsof of every sleep 60"
      for p in $(ps -A -o pid=,command= | awk '$2=="sleep" && $3=="60" {print $1}'); do lsof -n -p "$p" 2>/dev/null | awk 'NR==1 || $4 ~ /^[0-9]+[uwr]/' | head -6; done
    fi
    kill $W 2>/dev/null; pkill -P $BASHPID 2>/dev/null; exec 8<&-
    # ONLY THIS ITERATION'S OWN PROCESSES: the timeout's group, read from the
    # pre-deadline snapshot. A box-wide match on the command would reach other
    # sessions' sleeps on a shared box, so that sweep runs on a CI runner only.
    TPG=$(awk -v w=$W '$2==w && $5 ~ /timeout/ {print $1}' "$D/pre" 2>/dev/null | head -1)
    [ -n "$TPG" ] && kill -9 -- "-$TPG" 2>/dev/null
    if [ "${CI:-}" = true ]; then
      for p in $(ps -A -o pid=,command= | awk '$2=="sleep" && $3=="60" {print $1}'); do kill -9 "$p" 2>/dev/null; done
    fi
    rm -rf "$D"
  )
  r=$(printf '%s\n' "$out" | sed -n 's/^RESULT=\([a-z]*\).*/\1/p')
  if [ "$r" = eof ]; then green=$((green+1)); else red=$((red+1)); printf '=== %s iteration %s RED\n%s\n' "$LABEL" "$i" "$out"; fi
done
echo "SUMMARY $LABEL: green=$green red=$red of $N"
