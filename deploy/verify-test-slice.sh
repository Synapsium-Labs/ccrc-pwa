#!/usr/bin/env bash
# verify-test-slice.sh — the on-box proof of `ccrc test`'s containment (D-7298), for the operator or
# the deploy lane to run on a Linux box with a real systemd user manager. CI has none, and the wrapper's suite
# (server/test/ccrc-test-wrapper.test.ts) drives stubs of systemctl and systemd-run that exec the command directly, so
# four facts are measured only here:
#
#   1. slice   ccrctests.slice is top-level (its parent is the manager's root, so its weights compete with app.slice);
#   2. lock    a real `systemd-run --user --scope` keeps the heavy slot's flock descriptor open into the command, so a
#              wrapper killed by SIGKILL leaves its run's slot held until the run's scope is stopped;
#   3. memory  a run past the slice's MemoryMax is OOM-killed inside the slice (its `oom_kill` rises, the run exits 137),
#              and the session slice's memory pressure does not rise with it;
#   4. cpu     the slice's CPUQuota throttles a busy run (`nr_throttled` rises in its cpu.stat).
#
#   bash deploy/verify-test-slice.sh [<ccrc-test path>]   # default: ccd/ccrc-test beside this file's tree
#
# SAFE ON A LIVE BOX, BY REFUSAL. Checks 3 and 4 set the SHARED slice's limits low for a few seconds, which would kill or
# throttle a real run beside them, so the script refuses (exit 1, nothing changed) unless the slice is idle: no
# `ccrc-test-*` scope in it and no heavy slot held. It then holds every heavy slot of the box's queue for its whole run,
# so no heavy run starts beside it, and on every exit it runs one light `ccrc test -- true` as the box's own user, which
# applies the box's own limits again. The fixtures run with a throwaway HOME, whose ccrc.env holds the low limits and
# whose slot directory is its own; the user manager is the box's, as it must be. Run it at a quiet moment all the same:
# a LIGHT run started in those seconds shares the low limits.
#
# EXIT 0 when all four hold, 1 when one does not or the script refused, each line `verify-test-slice: PASS|FAIL|…`.
set -uo pipefail

PROG=verify-test-slice
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="${1:-$HERE/../ccd/ccrc-test}"
SLICE=ccrctests.slice
SESSIONS='app-claude\x2dsession.slice'
CGROOT="${CCRC_CGROUP_ROOT:-/sys/fs/cgroup}"
fails=0

say() { echo "$PROG: $*"; }
pass() { say "PASS $*"; }
fail() { say "FAIL $*"; fails=$((fails + 1)); }
refuse() { say "refused, nothing changed: $*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || refuse "this is not Linux, so there is no systemd user manager to verify"
command -v systemctl >/dev/null 2>&1 && command -v systemd-run >/dev/null 2>&1 && command -v flock >/dev/null 2>&1 \
  || refuse "systemctl, systemd-run and flock must all be on PATH"
[ -f "$WRAPPER" ] || refuse "no ccrc-test at $WRAPPER"
[ "$(systemctl --user show "$SLICE" -p LoadState --value 2>/dev/null)" = loaded ] \
  || refuse "$SLICE is not loaded by the user manager (ccrc update places it, then systemctl --user daemon-reload)"

cg_of() { systemctl --user show "$1" -p ControlGroup --value 2>/dev/null; }
field() { awk -v k="$2" '$1 == k { print $2; exit }' "$1" 2>/dev/null; }                   # <file> <key>
some_total() { awk '$1 == "some" { for (i = 2; i <= NF; i++) if ($i ~ /^total=/) { sub(/^total=/, "", $i); print $i } }' "$1" 2>/dev/null; }

# ── idle, or refuse ─────────────────────────────────────────────────────────────────────────────────────────────────
slots="$HOME/.cc-sessions/test-slots"
live=$(systemctl --user list-units --type=scope --state=active --no-legend --plain 'ccrc-test-*' 2>/dev/null | awk 'NF { print $1 }')
[ -z "$live" ] || refuse "a ccrc test run is live in the slice ($(echo "$live" | tr '\n' ' ')); run this at a quiet moment"
mkdir -p -- "$slots" || refuse "cannot create $slots"
declare -a held=()
for f in "$slots"/slot-*; do
  case "$f" in *.who|*'*') continue ;; esac
  flock -n "$f" true 2>/dev/null || refuse "heavy slot ${f##*/} is held; run this at a quiet moment"
done
n=$(bash "$WRAPPER" --status 2>/dev/null | sed -n 's/.*heavy slots [0-9]* of \([0-9]*\) held.*/\1/p')
for ((i = 0; i < ${n:-2}; i++)); do
  exec {fd}>>"$slots/slot-$i" && flock -n "$fd" || refuse "heavy slot slot-$i was taken while this started"
  held+=("$fd"); echo "pid $$: $PROG holds every slot while it measures" > "$slots/slot-$i.who"
done

TMPH=$(mktemp -d) || refuse "mktemp failed"
mkdir -p "$TMPH/.ccrc"
restore() {
  # The box's own limits, applied again by one light run as the box's user; then the queue is released.
  bash "$WRAPPER" --light -- true >/dev/null 2>&1 || say "WARN: restoring the box's limits failed: run \`ccrc test --light -- true\`"
  for ((i = 0; i < ${n:-2}; i++)); do rm -f -- "$slots/slot-$i.who"; done
  for fd in "${held[@]}"; do exec {fd}>&-; done
  rm -rf -- "$TMPH"
}
trap restore EXIT
fixture() { HOME="$TMPH" CCRC_TEST_POLL_S=0.2 bash "$WRAPPER" "$@"; }   # the low limits, a slot directory of its own
settings() { printf '%s\n' "$@" > "$TMPH/.ccrc/ccrc.env"; }

# ── 1. slice: top-level ─────────────────────────────────────────────────────────────────────────────────────────────
parent=$(systemctl --user show "$SLICE" -p Slice --value 2>/dev/null)
if [ "$parent" = -.slice ]; then pass "slice: $SLICE is top-level (its parent is -.slice), a sibling of app.slice"
else fail "slice: $SLICE's parent is ${parent:-unanswered}, not -.slice, so its weights do not compete with app.slice"; fi
# A slice nothing has started yet has no cgroup, and its ControlGroup reads empty: start it (a slice holds no process
# of its own, so this changes nothing) and ask again. Never a built path, and never the root's files in its place.
systemctl --user start "$SLICE" >/dev/null 2>&1
cg=$(cg_of "$SLICE")
[ -n "$cg" ] && [ -f "$CGROOT$cg/memory.events" ] && [ -f "$CGROOT$cg/cpu.stat" ] \
  || refuse "the user manager names no cgroup for $SLICE (ControlGroup=${cg:-empty}) with memory.events and cpu.stat under $CGROOT"

# ── 2. lock: the slot is the run's ──────────────────────────────────────────────────────────────────────────────────
settings
HOME="$TMPH" bash "$WRAPPER" --heavy -- sleep 60 >/dev/null 2>&1 &   # not through `fixture`: $! must be the wrapper
wpid=$!
for _ in $(seq 1 50); do [ -n "$(cg_of "ccrc-test-$wpid.scope")" ] && break; sleep 0.2; done
kill -KILL "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null
if ! flock -n "$TMPH/.cc-sessions/test-slots/slot-0" true 2>/dev/null; then
  pass "lock: the killed wrapper's run still holds its slot through the real scope"
else fail "lock: slot-0 was free once the wrapper was killed, so the scope did not inherit the lock"; fi
systemctl --user stop "ccrc-test-$wpid.scope" >/dev/null 2>&1
sleep 0.5
if flock -n "$TMPH/.cc-sessions/test-slots/slot-0" true 2>/dev/null; then pass "lock: stopping the run's scope frees the slot"
else fail "lock: slot-0 is still held after its run's scope was stopped"; fi

# ── 3. memory: killed inside the slice ──────────────────────────────────────────────────────────────────────────────
settings CCRC_TEST_SLICE_MEMORY_MAX=64M CCRC_TEST_SLICE_SWAP_MAX=0
scg=$(cg_of "$SESSIONS")
oom0=$(field "$CGROOT$cg/memory.events" oom_kill)
p0=""; [ -z "$scg" ] || p0=$(some_total "$CGROOT$scg/memory.pressure")
fixture --light -- awk 'BEGIN { s = "x"; while (1) s = s s }' >/dev/null 2>&1
rc=$?
oom1=$(field "$CGROOT$cg/memory.events" oom_kill)
p1=""; [ -z "$scg" ] || p1=$(some_total "$CGROOT$scg/memory.pressure")
if [ "$rc" = 137 ] && [ "${oom1:-0}" -gt "${oom0:-0}" ]; then
  pass "memory: a run past MemoryMax=64M exited 137 and $SLICE's oom_kill went ${oom0:-0} -> $oom1"
else fail "memory: the run exited $rc and $SLICE's oom_kill went ${oom0:-?} -> ${oom1:-?} (want 137 and a rise)"; fi
if [ -z "$scg" ]; then say "SKIP memory: $SESSIONS is not running, so its pressure cannot be read"
else say "memory: $SESSIONS memory.pressure some total ${p0:-?} -> ${p1:-?} us (read it: near 0 is the slice holding)"; fi

# ── 4. cpu: the quota throttles ─────────────────────────────────────────────────────────────────────────────────────
settings CCRC_TEST_SLICE_CPU_QUOTA=50%
t0=$(field "$CGROOT$cg/cpu.stat" nr_throttled)
fixture --light -- timeout 3 sh -c 'while :; do :; done' >/dev/null 2>&1
t1=$(field "$CGROOT$cg/cpu.stat" nr_throttled)
if [ "${t1:-0}" -gt "${t0:-0}" ]; then pass "cpu: CPUQuota=50% throttled the run (nr_throttled ${t0:-0} -> $t1)"
else fail "cpu: nr_throttled went ${t0:-?} -> ${t1:-?} under CPUQuota=50% (want a rise)"; fi

[ "$fails" -eq 0 ] && { say "all four hold"; exit 0; }
say "$fails check(s) failed"; exit 1
