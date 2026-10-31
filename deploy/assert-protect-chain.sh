#!/usr/bin/env bash
# assert-protect-chain.sh — the agent lane's post-restart protection gate (#1170).
# Under the kernel's memory_recursiveprot a cgroup's effective memory.min is
# capped by its parent's. With user.slice, user-<uid>.slice and app.slice at 0,
# the agent's MemoryMin protected nothing: under a thrash (memory PSI full over
# 50%) its main thread refaulted its own node text in D-state, its accept
# queue backed up and every registry-dependent verb failed fleet-wide. This
# gate reads what the kernel ENFORCES (memory.min along the agent's cgroup
# chain, never a drop-in file, the slice-policy gate's rule from #84) and fails
# loudly when any ancestor's protection is below the agent's own.
#
# It reads the agent's enforced io.weight the same way. No io.weight file means
# the io controller is not delegated to the user manager (stock user@.service
# delegates pids memory cpu only), so IOWeight=1000 is dropped: that is part of
# the root step. A weight only acts on a device running io.cost or BFQ, so the
# green line says "enforced (io.cost|bfq)" or "set but inert", never more.
#
# Exit 0: every ancestor protects at least the agent's memory.min.
# Exit 1: the agent's own protection or io.weight, or a user-manager-owned
#         ancestor (app.slice), is short or unreadable. deploy.sh installs those, so
#         this is a broken deploy and it fails.
# Exit 2: only root-owned ancestors (user@<uid>.service and above) are short,
#         or io is not delegated to user@<uid>.service.
#         The exact root step is printed; this gate never runs sudo itself, and
#         it keeps reporting until the step is done.
#
# CCRC_CGROUP_ROOT (default /sys/fs/cgroup) and CCRC_AGENT_CGROUP (default: the
# unit's ControlGroup as systemd reports it) let a test run it on a fixture
# tree. Nothing here writes anything.
set -euo pipefail
root="${CCRC_CGROUP_ROOT:-/sys/fs/cgroup}"
cg="${CCRC_AGENT_CGROUP:-}"
if [ -z "$cg" ]; then
  cg="$(systemctl --user show ccrc-agent.service -p ControlGroup --value 2>/dev/null || true)"
fi
if [ -z "$cg" ] || [ ! -r "$root$cg/memory.min" ]; then
  echo "deploy: protect-chain: cannot read ccrc-agent.service's memory.min (cgroup '${cg:-<none>}' under $root)" >&2
  exit 1
fi

# memory.min holds bytes, or `max`.
bytes() {
  local v
  v="$(cat -- "$1" 2>/dev/null || true)"
  case "$v" in
    max) echo 9223372036854775807 ;;
    ''|*[!0-9]*) echo -1 ;;
    *) echo "$v" ;;
  esac
}

want="$(bytes "$root$cg/memory.min")"
if [ "$want" -le 0 ]; then
  echo "deploy: protect-chain: ccrc-agent.service enforces memory.min=${want} — check ~/.config/systemd/user/ccrc-agent.service.d/protect.conf" >&2
  exit 1
fi

user_short="" root_short="" uid=""
p="$cg"
while :; do
  p="${p%/*}"
  [ -n "$p" ] || break
  have="$(bytes "$root$p/memory.min")"
  [ "$have" -ge "$want" ] && continue
  case "$p" in
    */user@*.service/*) user_short="$user_short ${p##*/}=${have}" ;;
    *) root_short="$root_short ${p##*/}=${have}" ;;
  esac
done
case "$cg" in */user-[0-9]*.slice/*) uid="${cg#*/user-}"; uid="${uid%%.slice/*}" ;; esac
uid="${uid:-$(id -u)}"

# io.weight reads `default <n>` plus per-device lines; its absence is the
# missing delegation, not a broken deploy.
io_pending="" io_bad=""
if [ -r "$root$cg/io.weight" ]; then
  w="$(awk '$1 == "default" { print $2; exit }' "$root$cg/io.weight" 2>/dev/null || true)"
  [ "$w" = 1000 ] || io_bad="${w:-<none>}"
else
  io_pending="IOWeight not enforced: the io controller is not delegated to user@${uid}.service (ccrc-agent.service has no io.weight)."
fi

# The agent's own counters: `low` counts reclaims below memory.low, `oom_kill`
# the kills. The kernel keeps no counter for a memory.min breach.
events="$(grep -E '^(low|oom|oom_kill) ' "$root$cg/memory.events" 2>/dev/null | tr '\n' ' ' || true)"
echo "deploy: protect-chain: ccrc-agent.service memory.min=${want} memory.events: ${events:-<unreadable>}"

if [ -n "$user_short" ]; then
  echo "deploy: protect-chain: FAILED — user-manager ancestors below the agent's memory.min (${want}):${user_short}. Check ~/.config/systemd/user/app.slice.d/50-ccrc-agent-protect.conf and run systemctl --user daemon-reload." >&2
  exit 1
fi
if [ -n "$io_bad" ]; then
  echo "deploy: protect-chain: FAILED — ccrc-agent.service enforces io.weight default=${io_bad}, not 1000. Check ~/.config/systemd/user/ccrc-agent.service.d/protect.conf and run systemctl --user daemon-reload." >&2
  exit 1
fi
if [ -n "$root_short" ] || [ -n "$io_pending" ]; then
  src="$HOME/ccrc/deploy/systemd-root"
  {
    if [ -n "$root_short" ]; then
      echo "deploy: protect-chain: PENDING ROOT STEP — root-owned ancestors below the agent's memory.min (${want}):${root_short}."
      echo "  Until it is done the agent's memory protection is 0 under a thrash (#1170)."
    fi
    [ -z "$io_pending" ] || echo "deploy: protect-chain: PENDING ROOT STEP — ${io_pending}"
    echo "  As root on this box:"
    echo "    sudo install -D -m 644 $src/user.slice.d/50-ccrc-agent-protect.conf /etc/systemd/system/user.slice.d/50-ccrc-agent-protect.conf"
    echo "    sudo install -D -m 644 $src/user-UID.slice.d/50-ccrc-agent-protect.conf /etc/systemd/system/user-${uid}.slice.d/50-ccrc-agent-protect.conf"
    echo "    sudo install -D -m 644 $src/user@UID.service.d/50-ccrc-agent-protect.conf /etc/systemd/system/user@${uid}.service.d/50-ccrc-agent-protect.conf"
    echo "    sudo systemctl daemon-reload"
    [ -z "$io_pending" ] || echo "  The next agent deploy re-reads IOWeight; while io.weight is still missing the gate keeps saying so (a running user manager may need restarting to pick up Delegate=, which stops every session)."
  } >&2
  exit 2
fi
echo "deploy: protect-chain: every ancestor protects at least ${want} (enforced values verified)"
# io.cost.qos lives on the root cgroup only; io.bfq.weight appears when BFQ is
# the scheduler of a device the io controller covers.
if grep -qs 'enable=1' "$root/io.cost.qos"; then
  echo "deploy: protect-chain: io.weight=1000 enforced (io.cost)"
elif [ -e "$root$cg/io.bfq.weight" ]; then
  echo "deploy: protect-chain: io.weight=1000 enforced (bfq)"
else
  echo "deploy: protect-chain: io.weight=1000 is set but inert: no device runs io.cost and the agent has no io.bfq.weight (mq-deadline or none), so its I/O is not prioritised"
fi
