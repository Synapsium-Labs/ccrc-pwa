#!/usr/bin/env bash
# THROWAWAY (Task C30, D-8381): run test files together, N times, and count the
# green runs. Removed before the wave-done. Run from server/.
#   repeat.sh <iterations> <label> <file>...
set -u
N="$1"; LABEL="$2"; shift 2; green=0; red=0
for i in $(seq 1 "$N"); do
  if ./node_modules/.bin/vitest run --maxWorkers=2 "$@" > "$RUNNER_TEMP/rep.$LABEL.$i" 2>&1; then
    green=$((green+1))
  else
    red=$((red+1)); echo "=== $LABEL repeat $i RED"; sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/rep.$LABEL.$i" | grep -v '^ *✓' | tail -120
  fi
  sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/rep.$LABEL.$i" | grep -E 'Test Files  |Tests  |Duration' | sed "s/^/  [$LABEL $i] /"
done
echo "REPEAT $LABEL: green=$green red=$red of $N"
