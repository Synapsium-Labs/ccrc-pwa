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

# scp writes the destination INODE in place, and bash executes scripts lazily
# from a saved byte offset — so overwriting a script that a process is
# executing makes that process resume inside the NEW bytes at the OLD offset.
# Measured on ccd: a verb prints its correct result, then exits 2 on a syntax
# error, which lifecycle.ts maps to ok:false — a 409 for a destructive action
# that already completed. And ccd is never idle here: every claude-session@
# supervisor IS a long-running invocation of it.
#
# `mv -f` replaces the DIRECTORY ENTRY instead (rename(2), atomic): running
# readers keep the old inode to EOF, new invocations get the new file. chmod
# runs before the mv so the file is never live at its final name without its
# final mode — a supervisor exec'ing ccd in that window would get EACCES and
# systemd's Restart=always would turn it into a crash loop.
install_atomic() {   # <local src> <HOME-relative dest> <mode>
  local src="$1" dest="$2" mode="$3"
  "${SCP[@]}" "$src" "$BOX:$dest.incoming-$TS"
  # The trailing rm sweeps strays that ABORTED runs left (deploy died between
  # scp and mv): by the time it runs, THIS run's temp has already been renamed
  # away, so the glob can only match leftovers — which are executable (scp
  # copies source mode) and, for ccd, sit on PATH. Review finding, reproduced.
  "${SSH[@]}" "$BOX" "chmod $mode $dest.incoming-$TS && mv -f $dest.incoming-$TS $dest && rm -f $dest.incoming-*"
}

# ~/ccrc-backups grows without bound otherwise (18MB/13 dirs measured on the
# server box before this existed), and it sits OUTSIDE the only disk guard,
# which watches WORKTREES_ROOT alone. Timestamped dirs only: the directory
# also holds hand-made siblings (a real `pre-flip-agent-dist` exists on the
# fleet host today) that a bare `ls | head` sweep would silently destroy.
# Callers append `|| echo …` rather than letting set -e abort: by the time
# this runs the deploy has verifiably succeeded, and a nonzero exit here
# would report failure for services that are live and green.
prune_backups() {   # keep the newest $CCRC_BACKUP_KEEP (default 10) timestamped backups
  local keep="${CCRC_BACKUP_KEEP:-10}"
  "${SSH[@]}" "$BOX" "cd ~/ccrc-backups 2>/dev/null || exit 0
    ls -d [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null \
      | sort | head -n -$keep | xargs -r rm -rf --"
}

# The build stamp: what a box is RUNNING, stated by the box itself. Computed
# from the LOCAL checkout — the rsynced ~/ccrc tree on the target is not a git
# repository, so `git rev-parse` must run here, before anything ships. A dirty
# tree deploys (stage 1 does not forbid it; stage 4's release pipeline will)
# but the stamp SAYS so: sha + "-dirty" is a fact, a clean sha nobody measured
# is the forgery class this repo bans by name. Shipped via install_atomic so
# no reader ever sees a torn stamp.
BUILD_SHA="$(git rev-parse HEAD)"
git diff --quiet && git diff --cached --quiet && BUILD_DIRTY=false || BUILD_DIRTY=true
BUILD_REF="$(git rev-parse --abbrev-ref HEAD)"
stamp_build() {
  local stamp
  stamp="$(mktemp)"
  printf '{"sha":"%s","ref":"%s","builtAt":"%s","dirty":%s}\n' \
    "$BUILD_SHA" "$BUILD_REF" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BUILD_DIRTY" > "$stamp"
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
  install_atomic "$stamp" .ccrc/build.json 644
  rm -f "$stamp"
}

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
  # All executables go through install_atomic — see its comment for why a
  # plain scp over these exact files is a live correctness bug.
  install_atomic ccd/ccd .local/bin/ccd 755
  install_atomic deploy/notify.sh .cc-sessions/notify.sh 755
  # session-hook.sh + its installer ship every deploy too — the installer is
  # idempotent (it backs up settings.json itself before touching it) and
  # safe to re-run against homes it already converged.
  install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh 755
  install_atomic ccd/install-session-hooks.sh .cc-sessions/install-session-hooks.sh 755
  # Stage 1: the artifacts the fleet host runs but no deploy ever shipped.
  # The cap-scopes enforcer is the OOM guardrail (see its own header for the
  # 13-days-silently-broken postmortem); tmux.conf is how truecolor survives
  # to the attaching client; statusline is what writes ~/.cc-limits telemetry.
  install_atomic ccd/ccd-cap-scopes .local/bin/ccd-cap-scopes 755
  install_atomic ccd/tmux.conf .tmux.conf 644
  install_atomic ccd/statusline-command.sh .claude/statusline-command.sh 755
  stamp_build
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-session-hooks.sh'
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
  # The supervisor unit and every drop-in land BEFORE daemon-reload so the
  # sweep below restarts supervisors under the new unit set. The slice
  # drop-in's target dir carries systemd's \x2d escape — the repo source dir
  # is plainly named, the DESTINATION must be the escaped name or systemd
  # never reads it. Inside this single-quoted block, "\x2d" sits in remote
  # double quotes, where bash preserves the backslash.
  AGENT_CMD='cd ~/ccrc/agent && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user \
    && cp ~/ccrc/deploy/ccrc-agent.service ~/.config/systemd/user/ \
    && cp ~/ccrc/ccd/claude-session@.service ~/.config/systemd/user/ \
    && mkdir -p ~/.config/systemd/user/claude-session@.service.d "$HOME/.config/systemd/user/app-claude\x2dsession.slice.d" ~/.config/systemd/user/ccrc-agent.service.d \
    && cp ~/ccrc/deploy/systemd/claude-session@.service.d/limits.conf ~/.config/systemd/user/claude-session@.service.d/ \
    && cp ~/ccrc/deploy/systemd/app-claude-session.slice.d/limits.conf "$HOME/.config/systemd/user/app-claude\x2dsession.slice.d/" \
    && cp ~/ccrc/deploy/systemd/ccrc-agent.service.d/protect.conf ~/.config/systemd/user/ccrc-agent.service.d/ \
    && cp ~/ccrc/deploy/systemd/ccd-cap-scopes.service ~/ccrc/deploy/systemd/ccd-cap-scopes.timer ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc-agent.service \
    && systemctl --user enable --now ccd-cap-scopes.timer \
    && systemctl --user restart ccrc-agent.service \
    && bash ~/ccrc/deploy/verify-service.sh ccrc-agent.service'
  "${SSH[@]}" "$BOX" "$AGENT_CMD"
  # THE SUPERVISOR SWEEP. Every claude-session@ unit is a LONG-LIVED `ccd
  # supervise` — even after the atomic install above, each live supervisor
  # keeps executing the PRE-deploy ccd (the old inode) until restarted, so
  # auto-swap, auto-compact and uuid-sync run yesterday's logic for days, and
  # the agent's `ccd caps` cache (which stats the file on disk) is
  # structurally blind to it. The unit is built for exactly this:
  # KillMode=process keeps the tmux substrate — the sessions themselves —
  # alive across the restart, and `cmd_supervise` re-enters via `cmd_ensure`,
  # which ATTACHES to a live session rather than spawning a second one.
  # try-restart touches only units that are already active (a fresh box with
  # zero sessions is a no-op), and each restarted supervisor is then held to
  # the same standard as the agent itself: verify-service.sh, per unit —
  # after the agent chain, so a broken agent fails the deploy before any
  # supervisor is touched.
  # The export is NOT decorative: this is a FRESH ssh session (AGENT_CMD's own
  # export died with its shell), and `systemctl --user` without
  # XDG_RUNTIME_DIR fails "Failed to connect to bus" on any box where
  # pam_systemd doesn't populate it — the same contingency both sibling
  # chains carry the export for. Review finding.
  SWEEP_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user try-restart "claude-session@*" \
    && for u in $(systemctl --user list-units "claude-session@*" --plain --no-legend | awk "{print \$1}"); do \
         bash ~/ccrc/deploy/verify-service.sh "$u" || exit 1; done'
  "${SSH[@]}" "$BOX" "$SWEEP_CMD"
  # The box's own statement of what it now runs, compared to what this run
  # shipped. `ccd version` reads ~/.ccrc/build.json (stamp_build, above);
  # a mismatch means the atomic install or the stamp itself went sideways —
  # fail the deploy, loudly, with both values in view.
  "${SSH[@]}" "$BOX" '~/.local/bin/ccd version' | tee /dev/stderr | grep -qF "$BUILD_SHA" \
    || { echo "deploy: FAILED — the box's ccd version does not carry the shipped sha $BUILD_SHA" >&2; exit 1; }
  prune_backups || echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2
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
  #
  # coord.db joins the set — it is the one artifact on either box whose loss
  # is not free, and it was the one file no deploy ever backed up. The
  # snapshot is VACUUM INTO via backup-coord.mjs (see its header for why cp
  # of a WAL database is worse than nothing), shipped fresh THIS run — the
  # backup cannot depend on a previous deploy having landed the tool — and
  # guarded the same way as dist-pwa: only a MISSING coord.db is skippable, a
  # failed snapshot aborts before rsync touches anything.
  "${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS"
  "${SCP[@]}" deploy/backup-coord.mjs "$BOX":ccrc-backups/backup-coord.mjs
  "${SSH[@]}" "$BOX" "{ [ ! -d ~/ccrc/server/dist-pwa ] || cp -a ~/ccrc/server/dist-pwa ~/ccrc-backups/$TS/dist-pwa; } \
    && { [ ! -f ~/.ccrc/coord.db ] || node --no-warnings ~/ccrc-backups/backup-coord.mjs ~/.ccrc/coord.db ~/ccrc-backups/$TS/coord.db; }"
  # See the agent path's identical exclude, above, for why: this rsync also
  # ships `deploy/` whole, and without the exclude the token rides along a
  # second time, unhardened, next to `ship_secret`'s 0600 copy three lines down.
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    --exclude 'ccrc-mail.token' \
    server shared deploy "$BOX":ccrc/
  ship_env ccrc.env .ccrc/ccrc.env
  stamp_build
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
  # /health's build stamp must equal what this run shipped. The curl inside
  # REMOTE_CMD proved "something answers"; this proves it answers AS the
  # build we deployed — the assertion the 2026-08-10 stale-binary afternoon
  # was missing. -f on a fresh curl: a dead server here is also a failure.
  curl -fsS "$HEALTH_URL" | grep -qF "\"sha\":\"$BUILD_SHA\"" \
    || { echo "deploy: FAILED — /health does not report the shipped sha $BUILD_SHA" >&2; exit 1; }
  prune_backups || echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2
fi
