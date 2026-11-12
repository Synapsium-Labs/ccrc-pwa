#!/usr/bin/env bash
# THROWAWAY (Task C27, D-8344): run the fixed platform-hazards file alone,
# N times, and count how often candidate (b) is green. Removed before the
# wave-done. Run from server/.   repeat.sh <iterations> <label>
set -u
N="${1:-10}"; LABEL="${2:-plain}"; green=0; red=0
for i in $(seq 1 "$N"); do
  if ./node_modules/.bin/vitest run test/platform-hazards.test.ts -t 'candidate \(b\)|D-8344 control' > "$RUNNER_TEMP/rep.$i" 2>&1; then
    green=$((green+1))
  else
    red=$((red+1)); echo "=== $LABEL repeat $i RED"; tail -60 "$RUNNER_TEMP/rep.$i"
  fi
done
echo "REPEAT $LABEL: green=$green red=$red of $N"
