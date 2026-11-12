#!/usr/bin/env bash
# THROWAWAY (Task C28, D-8345): does `_auth_forward_code`'s shape — a `read -t 0`
# peek then a `read -r -t <tick>` on a FIFO this shell holds open read-write —
# lose or split a code on this box? A writer sends <n> codes the way
# `ccrc account auth-code` does (open read-write, one printf of the line, close),
# and the reader counts what arrives whole.
# usage: code-channel.sh <n> <label>
set -u
n=$1 label=$2
d=$(mktemp -d "${RUNNER_TEMP:-/tmp}/c28c.XXXXXX")
mkfifo -m 600 "$d/in"
exec 7<>"$d/in"
( for i in $(seq 1 "$n"); do
    exec {fd}<>"$d/in"; printf 'CODE-%s\n' "$i" >&"$fd"; exec {fd}>&-
    sleep "0.0$(( RANDOM % 5 ))"
  done ) &
got=0 bad=0 peekmiss=0 t_end=$(( SECONDS + 120 ))
while (( got + bad < n && SECONDS < t_end )); do
  if ! IFS= read -t 0 -u 7 2>/dev/null; then sleep 0.01; continue; fi
  code=''
  if IFS= read -r -t 1 -u 7 code; then
    [[ "$code" == CODE-* ]] && got=$((got+1)) || { bad=$((bad+1)); echo "BAD $label: [$code]"; }
  else
    peekmiss=$((peekmiss+1)); [ -z "$code" ] || { bad=$((bad+1)); echo "PARTIAL LOST $label: [$code]"; }
  fi
done
wait
echo "SUMMARY $label code-channel: $got of $n whole, $bad lost or split, $peekmiss peeks that read nothing"
