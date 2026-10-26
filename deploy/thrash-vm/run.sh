#!/usr/bin/env bash
# #1170's synthetic thrash run. ON A THROWAWAY VM ONLY — never the fleet box, never a box with live sessions.
#
# The VM carries a deployed agent (deploy.sh agent against it, the protection chain applied, root step included).
# This script drives memory PSI full above 50% with stress-ng (anonymous pressure plus a page-cache flood) for the
# run's length, while probe.mjs opens a fresh agent connection every second and lists the registry.
#   RED  (the chain unprotected): probes miss their request timeout once PSI full climbs.
#   GREEN (the fix): 0 misses over the whole run, with PSI full held above 50%.
# Before and after, it prints the agent's memory.min chain and memory.events, so the record says which layout ran.
#
# Usage: CCRC_THRASH_VM=yes CCRC_AGENT_TOKEN=… bash deploy/thrash-vm/run.sh [seconds=600]
# Tunables: THRASH_VM_WORKERS (default: nproc), THRASH_VM_BYTES (default 110%: past RAM, so swap and reclaim run),
# THRASH_CACHE_WORKERS (default 2, the page-cache flood).
set -euo pipefail
if [ "${CCRC_THRASH_VM:-}" != yes ]; then
  echo "thrash-vm: refusing: set CCRC_THRASH_VM=yes to confirm this is a throwaway VM" >&2; exit 64
fi
# A box whose fleet registry holds anything is not a throwaway VM.
if [ -d "$HOME/.cc-sessions" ] && find "$HOME/.cc-sessions" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  echo "thrash-vm: refusing: $HOME/.cc-sessions is not empty — this looks like a fleet box" >&2; exit 64
fi
command -v stress-ng >/dev/null || { echo "thrash-vm: stress-ng is not installed (apt install stress-ng)" >&2; exit 69; }
[ -r /proc/pressure/memory ] || { echo "thrash-vm: this kernel exposes no PSI (/proc/pressure)" >&2; exit 69; }
secs="${1:-600}"
here="$(cd "$(dirname "$0")" && pwd)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

chain() { bash "$here/../assert-protect-chain.sh" || echo "thrash-vm: protect-chain exit $?"; }
echo "thrash-vm: before:"; chain

# Ramp: start the load, wait for PSI full to cross 50 before the timed window opens.
stress-ng --vm "${THRASH_VM_WORKERS:-$(nproc)}" --vm-bytes "${THRASH_VM_BYTES:-110%}" --vm-keep \
  --hdd "${THRASH_CACHE_WORKERS:-2}" --hdd-bytes 4G --timeout "$((secs + 120))s" --quiet &
load=$!
trap 'kill "$load" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  full="$(sed -n 's/^full avg10=\([0-9.]*\).*/\1/p' /proc/pressure/memory)"
  awk -v f="$full" 'BEGIN { exit !(f > 50) }' && break
  sleep 1
done
echo "thrash-vm: memory PSI full avg10=${full:-?} at window open"

rc=0
node "$here/probe.mjs" "$secs" || rc=$?
echo "thrash-vm: after:"; chain
exit "$rc"
