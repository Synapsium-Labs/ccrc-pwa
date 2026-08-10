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

# One local, gitignored token file -> BOTH boxes, so the two copies of the one
# secret are equal by construction rather than by someone remembering. The
# server reads its copy at boot (coord/token.ts); the fleet host's copy is what
# notify.sh and every coordinator/worker session present.
#
# "Equal by construction" also needs both READERS to extract the same value
# from the same bytes, not just receive the same bytes — coord/token.ts's
# `readMailToken` and notify.sh's token line share one extraction rule (first
# non-`#`, non-blank line; whitespace stripped everywhere in it) for exactly
# this reason (fix-round finding 1: the two normalisers used to differ in
# SCOPE, edges-only vs. everywhere, which the shipped .example's `#`-comment
# preamble — interior whitespace throughout — would turn into two different
# secrets from the one file this function ships unchanged).
ship_secret() {
  local local_file="deploy/$1" remote_dir="$2" remote_name="$3"
  if [ -f "$local_file" ]; then
    echo "shipping $local_file -> $BOX:$remote_dir/$remote_name"
    "${SSH[@]}" "$BOX" "mkdir -p $remote_dir && chmod 700 $remote_dir"
    "${SCP[@]}" "$local_file" "$BOX:$remote_dir/$remote_name"
    "${SSH[@]}" "$BOX" "chmod 600 $remote_dir/$remote_name"
  fi
}

if [ "$TARGET" = "agent" ]; then
  # Back up what the previous deploy left before rsync --delete rewrites it,
  # and before ccd/notify.sh/session-hook.sh are overwritten. cp -a keeps
  # modes and mtimes.
  # `[ ! -e X ] || cp` and NOT `[ -e X ] && cp || true`: absent-source is the
  # only skippable case — a cp that FAILS must abort the deploy before
  # --delete destroys the very state it failed to save.
  "${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS ~/.local/bin ~/.cc-sessions \
    && { [ ! -d ~/ccrc/agent/dist ] || cp -a ~/ccrc/agent/dist ~/ccrc-backups/$TS/agent-dist; } \
    && { [ ! -f ~/.local/bin/ccd ] || cp -a ~/.local/bin/ccd ~/ccrc-backups/$TS/ccd; } \
    && { [ ! -f ~/.cc-sessions/notify.sh ] || cp -a ~/.cc-sessions/notify.sh ~/ccrc-backups/$TS/notify.sh; } \
    && { [ ! -f ~/.cc-sessions/session-hook.sh ] || cp -a ~/.cc-sessions/session-hook.sh ~/ccrc-backups/$TS/session-hook.sh; }"
  # `--exclude 'ccrc-mail.token'`: the token lives at `deploy/ccrc-mail.token`
  # (gitignored) exactly when `ship_secret` below is about to fire, and this
  # rsync ships the whole `deploy/` directory. `--exclude '*.env'` is here for
  # the identical reason on `ship_env`'s secrets — without a matching
  # exclude, `-a` would carry the file over at whatever mode it has on THIS
  # machine (0644 under a plain umask), a second, unmanaged copy sitting
  # right next to the one `ship_secret` deliberately lands at 0600 under a
  # 0700 directory three lines down, re-shipped on every `--delete` run.
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    --exclude 'ccrc-mail.token' \
    agent shared deploy "$BOX":ccrc/
  ship_env ccrc-agent.env .ccrc/agent.env
  ship_secret ccrc-mail.token '~/.cc-secrets' ccrc-mail.token
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
  # The coordinator skill is the FOURTH artifact ccrc ships to the fleet host
  # (ccd, session-hook.sh, install-session-hooks.sh, and now this). rsync with
  # --delete so a reference file deleted in git is deleted on the box too — a
  # stale reference is prose a model will still follow.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.cc-sessions/coordinator-skill'
  rsync -az --delete -e "${SSH[*]}" ccd/coordinator-skill/ "$BOX":.cc-sessions/coordinator-skill/
  "${SCP[@]}" ccd/install-coordinator-skill.sh "$BOX":.cc-sessions/install-coordinator-skill.sh
  "${SSH[@]}" "$BOX" 'chmod +x ~/.cc-sessions/install-coordinator-skill.sh && bash ~/.cc-sessions/install-coordinator-skill.sh'
  # `systemctl restart` returns success the moment systemd FORKS, so without a
  # post-restart check an agent that throws during ESM evaluation — which
  # `whitelist.ts` does BY DESIGN via `refuseToBoot`, and which is the one
  # residual class no type can catch at build time — crash-loops every 3
  # seconds behind a deploy that exited 0 (final review round 2, gates finding
  # 5). `verify-service.sh` closes that: it samples `is-active`/MainPID across
  # a window longer than `RestartSec` and fails loudly with the journal tail.
  # The server chain below (build7-core Task 1) runs the SAME script, then
  # ALSO curls `$HEALTH_URL` — the two answer different questions
  # (verify-service.sh proves the process stayed up; the curl proves Fastify
  # is actually listening), and the server is the only unit with an HTTP
  # route to curl. The agent has none, so this is its only post-restart
  # check. Because it is the last link of an `&&` chain, its exit status is
  # the ssh exit status, and `set -e` at the top of this file aborts the
  # deploy on it.
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
  # See the agent path's identical exclude, above, for why: this rsync also
  # ships `deploy/` whole, and without the exclude the token rides along a
  # second time, unhardened, next to `ship_secret`'s 0600 copy three lines down.
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    --exclude 'ccrc-mail.token' \
    server shared deploy "$BOX":ccrc/
  ship_env ccrc.env .ccrc/ccrc.env
  ship_secret ccrc-mail.token '~/.ccrc' mail.token
  # verify-service.sh here closes the same crash-loop gap it closes on the
  # agent path above (see that chain's comment) — a restart that "succeeds"
  # the moment systemd forks, then dies every RestartSec. The curl AFTER it
  # is not redundant: verify-service.sh proves the process survived the
  # window, the curl proves Fastify is actually listening — different
  # questions, both cheap here because (unlike the agent) this unit has an
  # HTTP route to ask. agent/test/deploy-verify.test.ts pins both the
  # ordering (restart -> verify -> curl) and that neither call is dropped.
  REMOTE_CMD='cd ~/ccrc/server && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc.service ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc.service \
    && systemctl --user restart ccrc.service \
    && bash ~/ccrc/deploy/verify-service.sh ccrc.service \
    && curl -fsS '"$HEALTH_URL"
  "${SSH[@]}" "$BOX" "$REMOTE_CMD"
fi
