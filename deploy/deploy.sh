#!/usr/bin/env bash
set -euo pipefail
BOX="${CCRC_BOX:-you@203.0.113.7}"
SSH=(ssh -p 2222 -i "$HOME/.ssh/your-key-a")
rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist \
  infra/ccrc/server infra/ccrc/shared infra/ccrc/deploy "$BOX":ccrc/
"${SSH[@]}" "$BOX" 'cd ~/ccrc/server && npm ci && npm run build \
  && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc.service ~/.config/systemd/user/ \
  && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
  && systemctl --user daemon-reload && systemctl --user enable --now ccrc.service \
  && systemctl --user restart ccrc.service && sleep 1 && curl -fsS http://203.0.113.7:7788/health'
