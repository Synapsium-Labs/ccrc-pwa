#!/usr/bin/env bash
# Post-restart verification for a ccrc systemd --user unit.
#
# WHY THIS EXISTS (final review round 2, gates finding 5).
# `deploy.sh agent` ended at `systemctl --user restart ccrc-agent.service`,
# which returns SUCCESS the moment systemd forks — it says nothing about whether
# the process that was forked stayed up. `deploy.sh server` had the same gap
# behind a `sleep 1 && curl -fsS "$HEALTH_URL"` that only checked Fastify, never
# the restart itself; build7-core Task 1 gave the server chain a call to THIS
# script too, ahead of that curl — see deploy.sh's own comments on each chain
# for the current shape, this file no longer being agent-only.
#
# That gap lands exactly where the agent's own security design puts its last
# line of defence. `auditExecWhitelist()` runs at MODULE LOAD and `refuseToBoot`
# THROWS, deliberately, to stop a mis-configured agent from running at all.
# Every over-permission a TYPE can see is already caught earlier — `npm run
# build` is `tsc` and runs before the restart — so the only states that reach
# `refuseToBoot` on a host are the ones no type can see: a hand-edited
# `dist/whitelist.js`, a non-array prefix, a symbol key. With `Restart=always`
# and `RestartSec=3`, the result was an agent crash-looping every three seconds
# behind a deploy that exited 0, discoverable only by someone who thought to run
# `journalctl -u ccrc-agent`. The one residual class the throw exists for was
# the one class the deploy would not notice.
#
# WHY THE AGENT CHAIN HAS NO HEALTH CURL, unlike the server. The agent has no
# HTTP routes: its `createServer()` exists to carry a WebSocket upgrade, and it
# binds `CCRC_AGENT_HOST` (127.0.0.1) behind a bearer token. There is nothing
# to GET, so this script is the agent's only post-restart check; the server
# chain runs it too and keeps its curl after it, because the two checks answer
# different questions (process survived vs. Fastify is listening).
#
# WHY MainPID STABILITY AND NOT JUST `is-active`. A unit that is crash-looping
# spends most of a 3-second cycle in `activating (auto-restart)`, which
# `is-active` already rejects — but not all of it. A single sample can land in
# the up window and report `active` for a process that is about to die again.
# Two samples either side of an observation window LONGER than `RestartSec`
# cannot: a loop changes MainPID within it. This deliberately does not read
# `NRestarts`, whose reset semantics across a manual `systemctl restart` are a
# detail of the systemd version on the box; a PID that did not change is a PID
# that did not change on every version.
#
# Read-only throughout: `is-active`, `show`, `status`, `journalctl` — and, for a
# claude-session@<id> unit that fails a check, a read of ccd's registry (below;
# ccd is its only writer). It never starts, stops, restarts or resets anything,
# and writes nothing. Pinned by agent/test/deploy-verify.test.ts against a stubbed
# `systemctl`: healthy, crash-looping, inactive, never-started, and the
# deliberate-stop classifier's cases.
set -uo pipefail

UNIT="${1:-}"
if [ -z "$UNIT" ]; then
  echo "usage: verify-service.sh <systemd --user unit>" >&2
  exit 2
fi

# Overridable so the test does not have to wait 8 seconds per case. The
# DEFAULTS are what a deploy uses, and `CCRC_VERIFY_WINDOW` must stay strictly
# greater than the unit's `RestartSec` (3) or the crash-loop check stops being
# able to observe a restart.
SETTLE="${CCRC_VERIFY_SETTLE:-3}"
WINDOW="${CCRC_VERIFY_WINDOW:-5}"
LOG_LINES="${CCRC_VERIFY_LOG_LINES:-60}"

# The deliberate-stop re-poll's bound (wave 10, R12): at most STOP_POLLS more
# `is-active` reads, STOP_INTERVAL seconds apart, while a claude-session@ unit
# reads `deactivating`. Overridable for the reason SETTLE and WINDOW are; the
# DEFAULTS bound the extra wait at ~10s, and only a FAILING session unit pays it.
STOP_POLLS="${CCRC_VERIFY_STOP_POLLS:-10}"
STOP_INTERVAL="${CCRC_VERIFY_STOP_INTERVAL:-1}"

# ── A DELIBERATE SUPERVISOR STOP IS NOT A CRASH (wave 10, R12) ─────────────
# `ccrc update`'s sweep and deploy.sh's SWEEP_CMD list the active supervisors
# ONCE, then run this script per unit, serially, ~8s each, and the first
# non-zero exit fails the run. A session stopped on purpose while that loop is
# still walking — an archive, `ccd stop`, ws-rm, forget, reap, a child reclaim —
# read as a crash: R12, a hand archive inside v0.0.78's fleet sweep, which
# failed a healthy update and halted every move until an operator acked it.
#
# Every one of those verbs goes through ccd's one stop function,
# `_ws_unsupervise`, which stamps `<id>.stopped` BEFORE it runs `systemctl
# --user disable --now`; ws-rm, forget, reap and reclaim then purge the row
# (`_reg_purge` takes `.stopped` and `.uuid`). And under the unit's
# Restart=always a crash never reads `inactive`: systemd restarts the unit
# after every exit except an explicit stop, and a burst past StartLimitBurst
# ends `failed` (systemd.service(5); measured on systemd 255). A crash
# reads `activating`, then `failed` once the start limit is spent, or `active`
# behind a new MainPID. So a session unit that SETTLES `inactive` with the stamp
# present, or with its row gone, was stopped on purpose: it gets its own line
# and exit 0 (D-3947: not only "stayed up"). Everything else fails exactly as before.
#
# ONLY A STOP-SHAPED FAILURE IS CLASSIFIED. `fail` is told the word its check
# observed: `inactive`, `deactivating`, or `nopid` (active, then no MainPID — a
# stop that finished between the two reads). A check that SAW a crash —
# `activating`, `failed`, or a MainPID that changed — never reaches the
# classifier, so one pane death that a check observes, followed by a stop, still fails.
#
# Deliberately NOT here (coordinator rulings, wave 10): an unstamped `inactive`
# unit (a hand stop, a swap caught mid-carry — the swap writes no stamp) still
# fails; no freshness test on the stamp (`inactive` under Restart=always is
# always somebody's stop, so a stale stamp can only pass a deliberate stop;
# ActiveEnterTimestamp is empty once a stopped unit is unloaded, systemd 255);
# no cap on how many units may be stopped (this script asks whether the NEW
# supervisor stays up); one pane death that a check observes still fails.
#
# REG is ccd's own root, derived from HOME with no env override exactly as
# ccd/ccd's `REG=` is (D-3948; pinned by deploy-verify.test.ts). It is only READ,
# and only here (D-3946). An ABSENT registry, or no HOME, is not a purged row —
# nothing was measured — so it fails. The scope is the unit's NAME: ccrc.service
# and ccrc-agent.service never reach the registry, and never cost a query.
stopped_on_purpose() {   # -> 0, and one stdout line, iff $UNIT is a session stopped on purpose
  local id reg st n=0 s evidence
  case "$UNIT" in claude-session@?*.service) ;; *) return 1 ;; esac
  id="${UNIT#claude-session@}"; id="${id%.service}"
  case "$id" in */*) return 1 ;; esac
  [ -n "${HOME:-}" ] || return 1
  reg="$HOME/.cc-sessions"
  [ -d "$reg" ] || return 1
  st=$(systemctl --user is-active "$UNIT" 2>&1)
  while [ "$st" = deactivating ] && [ "$n" -lt "$STOP_POLLS" ]; do
    sleep "$STOP_INTERVAL"
    n=$((n + 1))
    st=$(systemctl --user is-active "$UNIT" 2>&1)
  done
  [ "$st" = inactive ] || return 1
  if [ -e "$reg/$id.stopped" ]; then
    # `-f` and not a symlink BEFORE the read, as ccd's `_reg_get` does: a FIFO
    # here would block the read for ever. Present is enough; the read only
    # names the evidence.
    s="not read: not a plain file"
    if [ -f "$reg/$id.stopped" ] && [ ! -L "$reg/$id.stopped" ]; then
      s=""; IFS= read -r s < "$reg/$id.stopped" || :
      s="reads '${s:0:64}'"
    fi
    evidence="ccd's stop stamp ~/.cc-sessions/$id.stopped is present ($s)"
  elif [ ! -e "$reg/$id.uuid" ]; then
    evidence="its registry row is purged (no ~/.cc-sessions/$id.uuid)"
  else
    return 1
  fi
  echo "stopped on purpose: $UNIT settled 'inactive', and $evidence — a deliberate stop, not a crash"
}

fail() {
  # A deliberate supervisor stop is not a failure (wave 10, R12): see
  # stopped_on_purpose above. Only a stop-shaped observation ($2) is classified.
  case "${2:-}" in inactive|deactivating|nopid) stopped_on_purpose && exit 0 ;; esac
  echo "" >&2
  echo "################################################################" >&2
  echo "## DEPLOY FAILED — $UNIT did not come up clean after restart" >&2
  echo "##" >&2
  echo "## $1" >&2
  echo "##" >&2
  echo "## The restart itself SUCCEEDED; systemd returns as soon as it" >&2
  echo "## forks. This check is the difference between that and a" >&2
  echo "## running service. Nothing was rolled back." >&2
  echo "################################################################" >&2
  echo "" >&2
  systemctl --user status --no-pager --lines=0 "$UNIT" >&2 2>&1
  echo "--- last $LOG_LINES journal lines for $UNIT ---" >&2
  journalctl --user -u "$UNIT" -n "$LOG_LINES" --no-pager >&2 2>&1
  exit 1
}

main_pid() {
  # `local x; x=$(cmd)` — `local x=$(cmd)` would return `local`'s status.
  local p
  p=$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null)
  printf '%s' "$p"
}

sleep "$SETTLE"

active_now=$(systemctl --user is-active "$UNIT" 2>&1)
[ "$active_now" = "active" ] || fail "unit is '$active_now', not 'active', ${SETTLE}s after the restart" "$active_now"

p1=$(main_pid)
{ [ -n "$p1" ] && [ "$p1" != "0" ]; } || fail "unit reports no MainPID ${SETTLE}s after the restart — nothing is running" nopid

sleep "$WINDOW"

active_after=$(systemctl --user is-active "$UNIT" 2>&1)
[ "$active_after" = "active" ] \
  || fail "unit was 'active' then became '$active_after' during the ${WINDOW}s observation window" "$active_after"

p2=$(main_pid)
[ "$p1" = "$p2" ] \
  || fail "MainPID changed from $p1 to $p2 during the ${WINDOW}s window — the service is CRASH-LOOPING behind a restart that reported success"

echo "verified: $UNIT active, MainPID $p1 stable across ${WINDOW}s"
