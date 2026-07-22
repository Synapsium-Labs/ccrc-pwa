#!/usr/bin/env bash
set -euo pipefail
BOX="${CCRC_BOX:-you@203.0.113.7}"
SSH=(ssh -p 2222 -i "$HOME/.ssh/your-key-a")
SCP=(scp -P 2222 -i "$HOME/.ssh/your-key-a")
HEALTH_URL="${CCRC_HEALTH_URL:-http://203.0.113.7:7788/health}"

# Usage: deploy.sh [server|agent] [host]
#   deploy.sh                 -> deploy server to $CCRC_BOX (default)
#   deploy.sh agent <host>    -> deploy ccrc-agent to <host> (falls back to $CCRC_BOX if omitted)
TARGET="${1:-server}"
[ "$TARGET" = "agent" ] && BOX="${2:-$BOX}"

# Ship a local, gitignored, real-token env file to the box if one exists.
# Only the committed *.env.example templates are ever in git.
ship_env() {
  local local_file="infra/ccrc/deploy/$1" remote_path="$2"
  if [ -f "$local_file" ]; then
    echo "shipping $local_file -> $BOX:$remote_path"
    "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
    "${SCP[@]}" "$local_file" "$BOX:$remote_path"
  fi
}

if [ "$TARGET" = "agent" ]; then
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist \
    infra/ccrc/agent infra/ccrc/shared infra/ccrc/deploy "$BOX":ccrc/
  ship_env ccrc-agent.env .ccrc/agent.env
  "${SSH[@]}" "$BOX" 'cd ~/ccrc/agent && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc-agent.service ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc-agent.service \
    && systemctl --user restart ccrc-agent.service'
else
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist \
    infra/ccrc/server infra/ccrc/shared infra/ccrc/deploy "$BOX":ccrc/
  ship_env ccrc.env .ccrc/ccrc.env
  REMOTE_CMD='cd ~/ccrc/server && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc.service ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc.service \
    && systemctl --user restart ccrc.service && sleep 1 && curl -fsS '"$HEALTH_URL"
  "${SSH[@]}" "$BOX" "$REMOTE_CMD"
fi
