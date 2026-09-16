#!/usr/bin/env bash
# assert-slice-policy.sh — the agent lane's post-daemon-reload gate.
# On 2026-09-09 and three times on 2026-09-10 a stale-branch deploy reinstated
# MemoryHigh=20G on the aggregate slice, and an aggregate MemoryHigh throttles
# EVERY allocation in the slice (99% sys, load 177, memory.events oom_kill 0) —
# the whole fleet froze with nothing killed and nothing logged. This gate reads
# the value systemd ENFORCES after daemon-reload, not any one drop-in file,
# because systemd applies drop-ins in filename order and a later-sorting one
# wins — trusting limits.conf alone would miss a runtime set-property override.
set -euo pipefail
unit='app-claude\x2dsession.slice'
v="$(systemctl --user show "$unit" -p MemoryHigh --value 2>/dev/null || true)"
if [ "$v" != "infinity" ]; then
  echo "deploy: $unit enforces MemoryHigh=${v:-<unreadable>} — it must be infinity (an aggregate MemoryHigh freezes the fleet). Check ~/.config/systemd/user/app-claude\x2dsession.slice.d/ and /run/user/$UID/systemd/user.control/." >&2
  exit 1
fi
echo "deploy: $unit MemoryHigh=infinity (enforced value verified)"
