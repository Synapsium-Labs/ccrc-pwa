#!/usr/bin/env bash
# #1170's synthetic thrash run. ON A THROWAWAY VM ONLY — never the fleet box, never a box with live sessions.
#
# The VM carries a deployed agent (deploy.sh agent against it). This script drives memory PSI full above 50% with
# stress-ng (anonymous pressure plus a page-cache flood) for the run's length, while probe.mjs opens a fresh agent
# connection every second and lists the registry. A probe without an answer in its timeout is a miss.
#
# THE LAYOUT IT REPRODUCES. File pages are charged to the cgroup that first faulted them in. On the fleet box
# sessions run node all the time and a deploy restarts the agent under them, so node's text and the shared libraries
# are charged to a session cgroup, not to ccrc-agent.service, and the agent's memory.min does not reach them. A fresh
# VM, where the agent is the only node, charges them to the agent and would green for the wrong reason. So before
# the window opens this script stops the agent, drops the page cache, starts node in the session slice (one holder
# that keeps node and the agent's libraries mapped, one short import workload), and only then starts the agent, so
# it maps pages already charged to the sibling. text-charge.sh records which cgroup holds them, before and after.
#
# TWO PASSES, both required for the record:
#   THRASH_VM_PASS=red    the root step NOT applied (the protect-chain gate exits 2): the baseline, probes miss.
#   THRASH_VM_PASS=green  the root step applied (the gate exits 0): the fix, 0 misses with PSI full over 50%.
# A pass whose gate does not match it is refused, so a record cannot name the wrong layout. If the green pass misses
# while text-charge says verdict=elsewhere, the chain alone does not fix #1170: the text has to be locked.
#
# Usage: CCRC_THRASH_VM=yes THRASH_VM_PASS=red|green CCRC_AGENT_TOKEN=… bash deploy/thrash-vm/run.sh [seconds=600]
# Needs passwordless sudo for the one root write (dropping the page cache). Tunables: THRASH_VM_WORKERS (default:
# nproc), THRASH_VM_BYTES (default 110%: past RAM, so swap and reclaim run), THRASH_CACHE_WORKERS (default 2, the
# page-cache flood).
set -euo pipefail
if [ "${CCRC_THRASH_VM:-}" != yes ]; then
  echo "thrash-vm: refusing: set CCRC_THRASH_VM=yes to confirm this is a throwaway VM" >&2; exit 64
fi
pass="${THRASH_VM_PASS:-}"
case "$pass" in
  red) want=2 ;;
  green) want=0 ;;
  *) echo "thrash-vm: refusing: name the pass, THRASH_VM_PASS=red|green (red: the root step not applied; green: applied)" >&2; exit 64 ;;
esac
# A box whose fleet registry holds anything is not a throwaway VM.
if [ -d "$HOME/.cc-sessions" ] && find "$HOME/.cc-sessions" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  echo "thrash-vm: refusing: $HOME/.cc-sessions is not empty — this looks like a fleet box" >&2; exit 64
fi
command -v stress-ng >/dev/null || { echo "thrash-vm: stress-ng is not installed (apt install stress-ng)" >&2; exit 69; }
[ -r /proc/pressure/memory ] || { echo "thrash-vm: this kernel exposes no PSI (/proc/pressure)" >&2; exit 69; }
sudo -n true 2>/dev/null || { echo "thrash-vm: needs passwordless sudo to drop the page cache" >&2; exit 69; }
secs="${1:-600}"
here="$(cd "$(dirname "$0")" && pwd)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
libs="$HOME/ccrc/agent/node_modules"

charge() { bash "$here/text-charge.sh" || echo "thrash-vm: text-charge exit $?"; }

# The fleet box's layout: the session slice faults node and the agent's libraries in before the agent does.
systemctl --user stop ccrc-agent.service
sync
sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches'
load_libs="for (const m of ['ws', 'node-pty']) { try { require('$libs/' + m); } catch (e) { console.error('thrash-vm: sibling could not load ' + m + ': ' + e.message); } }"
systemd-run --user --scope --quiet --slice='app-claude\x2dsession.slice' \
  node -e "$load_libs; setInterval(() => {}, 1e9)" &
holder=$!
trap 'kill "$holder" 2>/dev/null || true' EXIT
# The short workload: what a test run does to the same pages (imports, crypto, zlib, JSON), then exits.
systemd-run --user --scope --quiet --slice='app-claude\x2dsession.slice' \
  node -e "$load_libs; const c = require('node:crypto'), z = require('node:zlib'); for (let i = 0; i < 200; i++) z.gunzipSync(z.gzipSync(JSON.stringify(c.randomBytes(4096))));"
sleep 2
systemctl --user start ccrc-agent.service
sleep 3

echo "thrash-vm: pass=${pass}"
echo "thrash-vm: before:"
gate=0; bash "$here/../assert-protect-chain.sh" || gate=$?
if [ "$gate" != "$want" ]; then
  echo "thrash-vm: refusing: pass=${pass} needs the protect-chain gate to exit ${want}, it exited ${gate}" >&2; exit 65
fi
charge

# Ramp: start the load, wait for PSI full to cross 50 before the timed window opens.
stress-ng --vm "${THRASH_VM_WORKERS:-$(nproc)}" --vm-bytes "${THRASH_VM_BYTES:-110%}" --vm-keep \
  --hdd "${THRASH_CACHE_WORKERS:-2}" --hdd-bytes 4G --timeout "$((secs + 120))s" --quiet &
load=$!
trap 'kill "$load" "$holder" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  full="$(sed -n 's/^full avg10=\([0-9.]*\).*/\1/p' /proc/pressure/memory)"
  awk -v f="$full" 'BEGIN { exit !(f > 50) }' && break
  sleep 1
done
echo "thrash-vm: memory PSI full avg10=${full:-?} at window open"

rc=0
node "$here/probe.mjs" "$secs" || rc=$?
echo "thrash-vm: after:"
bash "$here/../assert-protect-chain.sh" || echo "thrash-vm: protect-chain exit $?"
charge
echo "thrash-vm: pass=${pass} probe exit ${rc}"
exit "$rc"
