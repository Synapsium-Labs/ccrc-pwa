#!/usr/bin/env bash
# THROWAWAY (Task C31, D-8391): run a vitest selection N times with the signal
# log and the release scripts' xtrace on, count green runs, and on a red print
# what killed what. Run from server/.
#   repeat.sh <iterations> <label> <workers> [--list <file> | <test file>...]
set -u
N="$1"; LABEL="$2"; W="$3"; shift 3
P="$GITHUB_WORKSPACE/.github/c31-darwin-probe"
VT=./node_modules/.bin/vitest
green=0; red=0
for i in $(seq 1 "$N"); do
  R="$RUNNER_TEMP/c31/$LABEL.$i"; mkdir -p "$R/trace"; : > "$R/kills"
  if [ "${1-}" = --list ]; then
    cmd=(env CCRC_TEST_LIST="$2" "$VT" run --config vitest.select.config.ts --maxWorkers="$W")
  else
    cmd=("$VT" run --maxWorkers="$W" "$@")
  fi
  if env C31_KILL_LOG="$R/kills" C31_TRACE_DIR="$R/trace" BASH_ENV="$P/bash-env.sh" \
       NODE_OPTIONS="--require $P/killlog.cjs" PATH="$P/shims:$PATH" "${cmd[@]}" > "$R/out" 2>&1; then
    green=$((green+1))
  else
    red=$((red+1)); echo "=== $LABEL repeat $i RED"
    sed 's/\x1b\[[0-9;]*m//g' "$R/out" | grep -v '^ *✓' | grep -A60 'FAIL ' | head -400
    for pid in $(sed 's/\x1b\[[0-9;]*m//g' "$R/out" | grep -oE 'pid [0-9]+, status' | grep -oE '[0-9]+' | sort -u); do
      echo "--- kills naming $pid"; grep -E "(^|[^0-9])-?$pid([^0-9]|$)" "$R/kills" | grep -v "sender=$pid " || echo "(none)"
      if [ -f "$R/trace/$pid.trace" ]; then echo "--- trace $pid (tail)"; tail -25 "$R/trace/$pid.trace"; fi
    done
    echo "--- build-release traces that never wrote SHA256SUMS"
    for t in "$R"/trace/*.trace; do
      grep -q 'build-release.sh' "$t" || continue
      grep -q 'wrote .*SHA256SUMS' "$t" && continue
      grep -q 'refusing\|carries no\|GNU tar is required' "$t" && continue
      pid=$(basename "$t" .trace); echo "trace $pid:"; tail -15 "$t"
      echo "kills naming $pid:"; grep -E "(^|[^0-9])-?$pid([^0-9]|$)" "$R/kills" | grep -v "sender=$pid " || echo "(none)"
    done
  fi
  echo "  [$LABEL $i] signal-sending calls: $(wc -l < "$R/kills")"
  sed 's/\x1b\[[0-9;]*m//g' "$R/out" | grep -E 'Test Files  |Tests  |Duration' | sed "s/^/  [$LABEL $i] /"
done
echo "REPEAT $LABEL: green=$green red=$red of $N"
