#!/usr/bin/env bash
# THROWAWAY (Task C29, D-8354): run one test file alone, N times, and count the
# green runs. Removed before the wave-done. Run from server/.
#   repeat.sh <iterations> <label> <file> [<-t pattern>]
set -u
N="$1"; LABEL="$2"; FILE="$3"; PAT="${4:-}"; green=0; red=0
for i in $(seq 1 "$N"); do
  if ./node_modules/.bin/vitest run "$FILE" ${PAT:+-t "$PAT"} > "$RUNNER_TEMP/rep.$LABEL.$i" 2>&1; then
    green=$((green+1))
  else
    red=$((red+1)); echo "=== $LABEL repeat $i RED"; sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/rep.$LABEL.$i" | grep -v '^ *✓' | tail -80
  fi
  sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/rep.$LABEL.$i" | grep -E 'dqsub/deny|Tests  ' | sed "s/^/  [$LABEL $i] /"
done
echo "REPEAT $LABEL $FILE: green=$green red=$red of $N"
