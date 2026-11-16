#!/usr/bin/env bash
# text-charge.sh — which cgroup is the agent's mapped text charged to? (#1170). READ-ONLY: it writes nothing.
# A file page is charged to the cgroup that first faulted it into the page cache. The agent's memory.min (and the
# ancestor chain) protects what is charged to ccrc-agent.service. If node's text and the shared libraries the agent
# maps were faulted in first by a session's node, they are charged to that session's cgroup, and the protection chain
# does not cover the pages the incident's main thread refaulted in D-state.
#
# It compares the agent cgroup's memory.stat file_mapped with the file-backed Rss (Rss - Anonymous) in the agent's
# /proc/<pid>/smaps_rollup. Run it on a box after a deploy, or let run.sh run it around the thrash window.
#
# Exit 0: verdict=own — at least half of the file-backed Rss is charged to the agent's cgroup.
# Exit 3: verdict=elsewhere — most of it is charged to another cgroup; memory.min cannot hold it, and locking the
#         text (mlockall, or MLOCK of the text mapping) is needed, not optional.
# Exit 1: either side cannot be read.
#
# CCRC_CGROUP_ROOT (default /sys/fs/cgroup), CCRC_AGENT_CGROUP (default: the unit's ControlGroup) and
# CCRC_AGENT_SMAPS (default: /proc/<the unit's MainPID>/smaps_rollup) let a test run it on fixtures.
set -euo pipefail
root="${CCRC_CGROUP_ROOT:-/sys/fs/cgroup}"
cg="${CCRC_AGENT_CGROUP:-}"
[ -n "$cg" ] || cg="$(systemctl --user show ccrc-agent.service -p ControlGroup --value 2>/dev/null || true)"
smaps="${CCRC_AGENT_SMAPS:-}"
if [ -z "$smaps" ]; then
  pid="$(systemctl --user show ccrc-agent.service -p MainPID --value 2>/dev/null || true)"
  [ -n "$pid" ] && [ "$pid" != 0 ] && smaps="/proc/$pid/smaps_rollup"
fi
stat="$root$cg/memory.stat"
if [ -z "$cg" ] || [ ! -r "$stat" ]; then
  echo "text-charge: cannot read the agent cgroup's memory.stat ('${stat}')" >&2; exit 1
fi
if [ -z "$smaps" ] || [ ! -r "$smaps" ]; then
  echo "text-charge: cannot read the agent's smaps_rollup ('${smaps:-<no MainPID>}')" >&2; exit 1
fi
mapped="$(awk '$1 == "file_mapped" { print $2 }' "$stat")"
file="$(awk '$1 == "file" { print $2 }' "$stat")"
rss_kb="$(awk '$1 == "Rss:" { print $2 }' "$smaps")"
anon_kb="$(awk '$1 == "Anonymous:" { print $2 }' "$smaps")"
if [ -z "$mapped" ] || [ -z "$rss_kb" ] || [ -z "$anon_kb" ]; then
  echo "text-charge: memory.stat or smaps_rollup is missing a field (file_mapped, Rss, Anonymous)" >&2; exit 1
fi
frss=$(( (rss_kb - anon_kb) * 1024 ))
if [ $(( mapped * 2 )) -ge "$frss" ]; then verdict=own; rc=0; else verdict=elsewhere; rc=3; fi
echo "text-charge: file_mapped=${mapped} file=${file:-?} smaps_file_rss=${frss} verdict=${verdict}"
if [ "$rc" = 3 ]; then
  echo "text-charge: most of the agent's mapped text is charged to another cgroup; memory.min does not cover it — the text must be locked (mlockall, or MLOCK of the text mapping)"
fi
exit "$rc"
