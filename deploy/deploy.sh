#!/usr/bin/env bash
set -euo pipefail
# Everything below is repo-relative: resolve the repo root from this script's
# own location, so the deploy behaves the same from any cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BOX="${CCRC_BOX:-you@203.0.113.7}"
# The key is per-workstation, not per-fleet: the laptop calls it your-key-a,
# openclaw itself calls it your-key-b. Overridable so a deploy can be driven from
# whichever box you happen to be on, including the fleet host deploying to itself.
CCRC_SSH_KEY="${CCRC_SSH_KEY:-$HOME/.ssh/your-key-a}"
CCRC_SSH_PORT="${CCRC_SSH_PORT:-2222}"
SSH=(ssh -p "$CCRC_SSH_PORT" -i "$CCRC_SSH_KEY")
SCP=(scp -P "$CCRC_SSH_PORT" -i "$CCRC_SSH_KEY")
HEALTH_URL="${CCRC_HEALTH_URL:-http://203.0.113.7:7788/health}"

# Usage: deploy.sh [server|agent] [host]
#   deploy.sh                 -> deploy server to $CCRC_BOX (default)
#   deploy.sh agent <host>    -> deploy ccrc-agent to <host> (falls back to $CCRC_BOX if omitted)
TARGET="${1:-server}"
[ "$TARGET" = "agent" ] && BOX="${2:-$BOX}"

# One timestamp per run: every backup this run takes lands under the same
# ~/ccrc-backups/<ts>/ on the target, so a rollback is one directory, not a hunt.
TS="$(date +%Y%m%d-%H%M%S)"

# Ship a local, gitignored, real-token env file to the box if one exists.
# Only the committed *.env.example templates are ever in git.
ship_env() {
  local local_file="deploy/$1" remote_path="$2"
  if [ -f "$local_file" ]; then
    echo "shipping $local_file -> $BOX:$remote_path"
    "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
    "${SCP[@]}" "$local_file" "$BOX:$remote_path"
  fi
}

if [ "$TARGET" = "agent" ]; then
  # Back up what the previous deploy left before rsync --delete rewrites it,
  # and before ccd/notify.sh are overwritten. cp -a keeps modes and mtimes.
  # `[ ! -e X ] || cp` and NOT `[ -e X ] && cp || true`: absent-source is the
  # only skippable case — a cp that FAILS must abort the deploy before
  # --delete destroys the very state it failed to save.
  "${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS ~/.local/bin ~/.cc-sessions \
    && { [ ! -d ~/ccrc/agent/dist ] || cp -a ~/ccrc/agent/dist ~/ccrc-backups/$TS/agent-dist; } \
    && { [ ! -f ~/.local/bin/ccd ] || cp -a ~/.local/bin/ccd ~/ccrc-backups/$TS/ccd; } \
    && { [ ! -f ~/.cc-sessions/notify.sh ] || cp -a ~/.cc-sessions/notify.sh ~/ccrc-backups/$TS/notify.sh; }"
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    agent shared deploy "$BOX":ccrc/
  ship_env ccrc-agent.env .ccrc/agent.env
  # ccd installs BEFORE the agent restart, never after: the agent caches
  # `ccd caps` at boot (the 113-second lesson), so an agent restarted against
  # yesterday's ccd pins yesterday's verb set until someone restarts it again.
  # notify.sh is the ccd swap hook and lives outside the rsync tree.
  "${SCP[@]}" ccd/ccd "$BOX":.local/bin/ccd
  "${SCP[@]}" deploy/notify.sh "$BOX":.cc-sessions/notify.sh
  "${SSH[@]}" "$BOX" 'chmod +x ~/.local/bin/ccd ~/.cc-sessions/notify.sh'
  # session-hook.sh + its installer ship every deploy too — the installer is
  # idempotent (it backs up settings.json itself before touching it) and
  # safe to re-run against homes it already converged.
  "${SCP[@]}" ccd/session-hook.sh "$BOX":.cc-sessions/session-hook.sh
  "${SCP[@]}" ccd/install-session-hooks.sh "$BOX":.cc-sessions/install-session-hooks.sh
  "${SSH[@]}" "$BOX" 'chmod +x ~/.cc-sessions/session-hook.sh ~/.cc-sessions/install-session-hooks.sh && bash ~/.cc-sessions/install-session-hooks.sh'
  # The trailing `verify-service.sh` is the agent's equivalent of the server
  # path's `curl -fsS "$HEALTH_URL"` (final review round 2, gates finding 5).
  # `systemctl restart` returns success the moment systemd FORKS, so without it
  # an agent that throws during ESM evaluation — which `whitelist.ts` does BY
  # DESIGN via `refuseToBoot`, and which is the one residual class no type can
  # catch at build time — crash-loops every 3 seconds behind a deploy that
  # exited 0. The script is read-only and fails loudly with the journal tail;
  # because it is the last link of an `&&` chain, its exit status is the ssh
  # exit status, and `set -e` at the top of this file aborts the deploy on it.
  AGENT_CMD='cd ~/ccrc/agent && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc-agent.service ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc-agent.service \
    && systemctl --user restart ccrc-agent.service \
    && bash ~/ccrc/deploy/verify-service.sh ccrc-agent.service'
  "${SSH[@]}" "$BOX" "$AGENT_CMD"
else
  # The server serves whatever server/dist-pwa holds, and rsync's
  # `--exclude dist` never matched dist-pwa — which is how a green deploy
  # shipped a stale bundle twice. Build the PWA HERE, in this run, and refuse
  # to ship a bundle this run did not produce.
  RUN_START="$(date +%s)"
  (cd pwa && npm ci && npm run build)
  [ -f server/dist-pwa/index.html ] \
    || { echo "deploy: PWA build produced no server/dist-pwa/index.html" >&2; exit 1; }
  IDX_MTIME="$(stat -c %Y server/dist-pwa/index.html)"
  [ "$IDX_MTIME" -ge "$RUN_START" ] \
    || { echo "deploy: server/dist-pwa/index.html predates this run — refusing to ship a stale bundle" >&2; exit 1; }
  # Back up the served bundle before rsync --delete replaces it. Same rule as
  # the agent path: only an ABSENT source is skippable, a failed cp aborts.
  "${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS \
    && { [ ! -d ~/ccrc/server/dist-pwa ] || cp -a ~/ccrc/server/dist-pwa ~/ccrc-backups/$TS/dist-pwa; }"
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    server shared deploy "$BOX":ccrc/
  ship_env ccrc.env .ccrc/ccrc.env
  REMOTE_CMD='cd ~/ccrc/server && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc.service ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc.service \
    && systemctl --user restart ccrc.service && sleep 1 && curl -fsS '"$HEALTH_URL"
  "${SSH[@]}" "$BOX" "$REMOTE_CMD"
fi
