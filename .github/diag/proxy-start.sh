#!/usr/bin/env bash
# DIAGNOSTIC ONLY: start ccgpt-proxy by hand the way the test harness does (cwd + HOME = a fixture, minimal env)
# and with the runner's full env, timing spawn -> /ccgpt/lane answered -> exit after SIGKILL.
set -u
ROOT=$PWD; PY=$(command -v python3); mkdir -p /tmp/ccgpt-diag
now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }
sub() { perl -e "printf '%.3f', $1 - $2"; }
for mode in full minimal; do
  for i in 1 2 3; do
    H=$(mktemp -d); t0=$(now)
    if [ "$mode" = full ]; then
      (cd "$H" && PYTHONPATH="$ROOT/server/test/fixtures/pystub" CCGPT_ACCOUNT_ID="lane-$mode-$i" CCGPT_PROXY_PORT=45910 CCGPT_LITELLM_PORT=45911 exec "$PY" "$ROOT/ccd/ccgpt-proxy.py") 2>"/tmp/ccgpt-diag/proxy-$mode-$i.err" &
    else
      (cd "$H" && exec env -i PATH="$PATH" HOME="$H" PYTHONPATH="$ROOT/server/test/fixtures/pystub" CCGPT_ACCOUNT_ID="lane-$mode-$i" CCGPT_PROXY_PORT=45910 CCGPT_LITELLM_PORT=45911 "$PY" "$ROOT/ccd/ccgpt-proxy.py") 2>"/tmp/ccgpt-diag/proxy-$mode-$i.err" &
    fi
    pid=$!; ok=no; n=0
    while :; do
      n=$((n+1))
      if curl -s -m 5 "http://127.0.0.1:45910/ccgpt/lane" 2>/dev/null | grep -q "lane-$mode-$i"; then ok=yes; break; fi
      [ "$(perl -e "print(($(now) - $t0) > 90 ? 1 : 0)")" = 1 ] && break
      sleep 0.05
    done
    t1=$(now); echo "$mode #$i: answered=$ok after $(sub "$t1" "$t0")s ($n polls)"
    kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; t2=$(now); echo "   exit after SIGKILL: $(sub "$t2" "$t1")s"
    t3=$(now); curl -s -m 5 -o /dev/null "http://127.0.0.1:45910/ccgpt/lane"; echo "   a connect to the freed port took $(sub "$(now)" "$t3")s (rc $?)"
  done
done
