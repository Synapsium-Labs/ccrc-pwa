#!/usr/bin/env bash
# Post-restart verification for a ccrc systemd --user unit.
#
# WHY THIS EXISTS (final review round 2, gates finding 5).
# `deploy.sh server` ended its chain with `sleep 1 && curl -fsS "$HEALTH_URL"`.
# `deploy.sh agent` ended at `systemctl --user restart ccrc-agent.service`,
# which returns SUCCESS the moment systemd forks — it says nothing about whether
# the process that was forked stayed up.
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
# WHY NOT A HEALTH CURL, like the server. The agent has no HTTP routes: its
# `createServer()` exists to carry a WebSocket upgrade, and it binds
# `CCRC_AGENT_HOST` (127.0.0.1) behind a bearer token. There is nothing to GET.
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
# Read-only throughout: `is-active`, `show`, `status`, `journalctl`. It never
# starts, stops, restarts or resets anything.
#
# Pinned by agent/test/deploy-verify.test.ts, which runs this script against a
# stubbed `systemctl` for the healthy, crash-looping, inactive and
# never-started cases.
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

fail() {
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
[ "$active_now" = "active" ] || fail "unit is '$active_now', not 'active', ${SETTLE}s after the restart"

p1=$(main_pid)
{ [ -n "$p1" ] && [ "$p1" != "0" ]; } || fail "unit reports no MainPID ${SETTLE}s after the restart — nothing is running"

sleep "$WINDOW"

active_after=$(systemctl --user is-active "$UNIT" 2>&1)
[ "$active_after" = "active" ] \
  || fail "unit was 'active' then became '$active_after' during the ${WINDOW}s observation window"

p2=$(main_pid)
[ "$p1" = "$p2" ] \
  || fail "MainPID changed from $p1 to $p2 during the ${WINDOW}s window — the service is CRASH-LOOPING behind a restart that reported success"

echo "verified: $UNIT active, MainPID $p1 stable across ${WINDOW}s"
