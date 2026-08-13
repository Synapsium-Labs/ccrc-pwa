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

# Usage: deploy.sh [server|agent] [host]
#   deploy.sh                 -> deploy server to $CCRC_BOX (default)
#   deploy.sh agent <host>    -> deploy ccrc-agent to <host> (falls back to $CCRC_BOX if omitted)
TARGET="${1:-server}"
[ "$TARGET" = "agent" ] && BOX="${2:-$BOX}"

# Derived from the RESOLVED $BOX — i.e. AFTER the agent-target override just
# above, so it tracks $2 — never a literal. A literal here meant
# `CCRC_BOX=newbox bash deploy/deploy.sh` still curled the OLD box: if both
# boxes happened to sit at the same sha (a re-deploy, a rollback), the sha
# grep at the bottom of the server branch would pass WITHOUT EVER CONTACTING
# THE TARGET (I4, final review). `${BOX#*@}` strips the `user@` prefix BOX
# always carries. CCRC_HEALTH_URL remains the explicit override for a box
# whose health route isn't at the tailnet-IP:7788 shape.
HEALTH_URL="${CCRC_HEALTH_URL:-http://${BOX#*@}:7788/health}"

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

# The roster a box that has none gets SEEDED with. `~/.ccrc/accounts.json` is
# USER-OWNED config (stage-2a design §5): ccrc creates it once and never
# overwrites it, so an operator's edit on the box survives every later deploy.
# That is the exact opposite rule to `install_atomic`, which is for ccrc-OWNED
# files a deploy replaces wholesale — `~/.ccrc/accounts.sh`, the generated bash
# projection of this file, goes through that path instead.
#   deploy/accounts.migration.json — this fleet's five accounts, byte for byte,
#     so the reference installation keeps its identity across the flip.
#   deploy/accounts.default.json   — the single-`claude` roster a fresh,
#     unrelated install should start from.
# Point CCRC_ACCOUNTS_JSON at either, or at a roster of your own.
ACCOUNTS_JSON="${CCRC_ACCOUNTS_JSON:-deploy/accounts.migration.json}"

# `node` ON THE DEPLOYING MACHINE is NEW as of this branch — no earlier deploy
# needed a local interpreter at all (the remote build runs node on the BOX).
# Both branches below now run `deploy/gen-accounts.mjs` locally, and both
# report any nonzero exit from it as "the roster is not one ccrc can use" —
# including 127, `node: command not found`. That sends an operator to debug a
# roster file that is perfectly fine, on a machine whose actual problem is a
# missing interpreter (F2, final review). Ask the question separately, with
# its own answer, and ask it BEFORE the first ssh so a workstation that cannot
# run the deploy at all learns it without touching the box.
require_node() {
  command -v node >/dev/null 2>&1 || {
    echo "deploy: FAILED — no \`node\` on PATH on THIS machine (the one running deploy.sh)." >&2
    echo "  deploy/gen-accounts.mjs projects the roster into bash and needs node >=22.13.0 locally;" >&2
    echo "  this is NOT a problem with $ACCOUNTS_JSON or with the roster on $BOX. Install node and re-run." >&2
    exit 1
  }
}
require_node

# The roster `ship_roster` may be about to SEED, proven usable BEFORE it is
# seeded (F1, final review). `~/.ccrc/accounts.json` is USER-OWNED and
# create-if-missing (see the block above), so ccrc never overwrites a seed it
# already placed: seeding an unusable roster onto a box that had none poisons
# that box PERMANENTLY. The deploy would abort loudly at the read-back a few
# lines further down — and so would every later deploy, until a human ssh'd in
# and deleted the file by hand. Validate the LOCAL bytes here, where the only
# cost of being wrong is an exit code.
#
# Callers guard on `[ -f "$ACCOUNTS_JSON" ]`: an absent local roster is a
# legitimate deploy (the box already has one, which is what the guard beside
# each call site allows), and it is the BOX's copy — read back over ssh — that
# gets validated in that case.
check_local_roster() {
  node deploy/gen-accounts.mjs "$ACCOUNTS_JSON" >/dev/null \
    || { echo "deploy: FAILED — local $ACCOUNTS_JSON is not a roster ccrc can use (see above); refusing to seed it onto $BOX, where it would be permanent" >&2; exit 1; }
}

ship_roster() {
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
  if ! "${SSH[@]}" "$BOX" '[ -f ~/.ccrc/accounts.json ]'; then
    echo "seeding $ACCOUNTS_JSON -> $BOX:~/.ccrc/accounts.json (first install only; never overwritten again)"
    "${SCP[@]}" "$ACCOUNTS_JSON" "$BOX:.ccrc/accounts.json"
  fi
}

if [ "$TARGET" = "agent" ]; then
  # THE ROSTER COMES FIRST, before this branch's first mutation — the same
  # posture, for the same reason, as the server branch's ccrc.env guard far
  # below. From the moment the new ccd lands it runs `[[ -r
  # ~/.ccrc/accounts.sh ]] || die` on EVERY invocation, and the supervisor
  # sweep at the bottom of this branch restarts every live claude-session@
  # unit, each of which IS a long-running ccd. A roster problem discovered
  # halfway down would be discovered with `rsync --delete` already run, the
  # new ccd already installed, and no rollback path.
  [ -f "$ACCOUNTS_JSON" ] || "${SSH[@]}" "$BOX" '[ -f ~/.ccrc/accounts.json ]' \
    || { echo "deploy: FAILED — no roster at $ACCOUNTS_JSON locally and no ~/.ccrc/accounts.json already on $BOX; ccd dies on every invocation without one" >&2; exit 1; }
  # …and if there IS a local roster, it is the one `ship_roster` may seed onto
  # a box that has none — permanently, since ccrc never overwrites it. Prove
  # it parses before it can land. `[ ! -f X ] || …` (the file's own
  # absent-source-is-the-only-skippable-case idiom): an absent local roster is
  # handled by the guard above, a present-but-broken one must abort here.
  [ ! -f "$ACCOUNTS_JSON" ] || check_local_roster
  ship_roster
  # Generated from the roster THE BOX WILL BOOT WITH — read back over ssh,
  # never from the local file — so that the generated file's own first claim
  # ("Generated from ~/.ccrc/accounts.json") is true on a box whose operator
  # has since edited that file, and so ccd's routing can never disagree with
  # what the server serves from that same box's copy. `ship_roster` above has
  # just guaranteed the file exists. Generation runs HERE rather than beside
  # the install below so that an unusable roster fails the deploy before
  # anything is replaced; the resulting temp file is what gets installed.
  BOX_ROSTER="$(mktemp)"
  ACCOUNTS_SH="$(mktemp)"
  "${SSH[@]}" "$BOX" 'cat ~/.ccrc/accounts.json' > "$BOX_ROSTER"
  node deploy/gen-accounts.mjs "$BOX_ROSTER" > "$ACCOUNTS_SH" \
    || { echo "deploy: FAILED — the roster at $BOX:~/.ccrc/accounts.json is not one ccrc can use (see above); refusing to ship a ccd that cannot read it" >&2; exit 1; }
  # Back up what the previous deploy left before rsync --delete rewrites it,
  # and before ccd/notify.sh/session-hook.sh are overwritten. cp -a keeps
  # modes and mtimes.
  # `[ ! -e X ] || cp` and NOT `[ -e X ] && cp || true`: absent-source is the
  # only skippable case — a cp that FAILS must abort the deploy before
  # --delete destroys the very state it failed to save.
  # The two unit files join the set here (I2, final review): AGENT_CMD below
  # `cp`s straight over ~/.config/systemd/user/{ccrc-agent,claude-session@}.service
  # with no backup ever taken, so a bad unit had no on-box restore path —
  # unlike agent-dist/ccd/notify.sh/session-hook.sh, which always did.
  "${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS ~/.local/bin ~/.cc-sessions \
    && { [ ! -d ~/ccrc/agent/dist ] || cp -a ~/ccrc/agent/dist ~/ccrc-backups/$TS/agent-dist; } \
    && { [ ! -f ~/.local/bin/ccd ] || cp -a ~/.local/bin/ccd ~/ccrc-backups/$TS/ccd; } \
    && { [ ! -f ~/.cc-sessions/notify.sh ] || cp -a ~/.cc-sessions/notify.sh ~/ccrc-backups/$TS/notify.sh; } \
    && { [ ! -f ~/.cc-sessions/session-hook.sh ] || cp -a ~/.cc-sessions/session-hook.sh ~/ccrc-backups/$TS/session-hook.sh; } \
    && { [ ! -f ~/.config/systemd/user/ccrc-agent.service ] || cp -a ~/.config/systemd/user/ccrc-agent.service ~/ccrc-backups/$TS/ccrc-agent.service; } \
    && { [ ! -f ~/.config/systemd/user/claude-session@.service ] || cp -a ~/.config/systemd/user/claude-session@.service ~/ccrc-backups/$TS/claude-session@.service; }"
  # `--exclude 'ccrc-mail.token'`: the token lives at `deploy/ccrc-mail.token`
  # (gitignored) exactly when `ship_secret` below is about to fire, and this
  # rsync ships the whole `deploy/` directory. `--exclude '*.env'` is here for
  # the identical reason on `ship_env`'s secrets — without a matching
  # exclude, `-a` would carry the file over at whatever mode it has on THIS
  # machine (0644 under a plain umask), a second, unmanaged copy sitting
  # right next to the one `ship_secret` deliberately lands at 0600 under a
  # 0700 directory three lines down, re-shipped on every `--delete` run.
  # `ccd` joins the source list here: AGENT_BUILD_CMD below `cp`s
  # `~/ccrc/ccd/claude-session@.service` into place, and until this line that
  # directory never reached the box at all — confirmed live, `ls ~/ccrc/` on
  # the fleet host showed only `agent deploy shared`, so `AGENT_BUILD_CMD`
  # failed at that exact `cp` with "No such file or directory" (deploy-verify's
  # general ~/ccrc/<dir> reachability test, this task). This is a SEPARATE
  # tree from the coordinator skill rsync below, whose destination sits under
  # `.cc-sessions`, not under `~/ccrc/ccd` — the two `--delete` runs cannot
  # step on each other.
  #
  # That sentence deliberately does NOT spell the skill's directory name with
  # a trailing slash. install-coordinator-skill.test.ts locates its rsync by
  # scanning this file for the FIRST line containing that exact spelling, so
  # any COMMENT carrying it shadows the real invocation and fails the suite.
  # Measured twice: once when CI caught this fix's first push, and again when
  # this very note quoted the token while trying to explain it.
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    --exclude 'ccrc-mail.token' \
    agent shared deploy ccd "$BOX":ccrc/
  ship_env ccrc-agent.env .ccrc/agent.env
  ship_secret ccrc-mail.token '~/.cc-secrets' ccrc-mail.token
  # THE ROSTER LANDS BEFORE ccd, and that ordering is the whole point of this
  # block. The ccd installed on the next line refuses to run AT ALL without
  # ~/.ccrc/accounts.sh (its own `|| die`, naming the remedy), so shipping ccd
  # first would kill every ccd invocation in the gap — including the ones the
  # supervisor sweep at the bottom of this branch makes, across every live
  # session on the box.
  # `install_atomic` does NOT create its destination directory, and the only
  # unconditional `mkdir -p ~/.ccrc` on this path lives inside the build-stamp
  # helper, which runs AFTER ccd. The mkdir here is what this call depends on
  # — not `ship_roster`'s earlier one, which belongs to a step that could move.
  #
  # agent/test/deploy-verify.test.ts pins the order by comparing these two
  # `install_atomic` invocations, and this comment deliberately does NOT
  # spell the build-stamp helper's name: two assertions there locate that
  # helper's CALL with `indexOf(<name>, agentBranchStart)`, so any earlier
  # mention of it in prose shadows the real invocation and fails the suite.
  # Measured, on this exact comment, on this task's first run.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
  install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644
  rm -f "$ACCOUNTS_SH" "$BOX_ROSTER"
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
  # The supervisor unit and every drop-in land BEFORE daemon-reload so the
  # sweep below restarts supervisors under the new unit set. The slice
  # drop-in's target dir carries systemd's \x2d escape — the repo source dir
  # is plainly named, the DESTINATION must be the escaped name or systemd
  # never reads it. Inside this single-quoted block, "\x2d" sits in remote
  # double quotes, where bash preserves the backslash.
  AGENT_BUILD_CMD='cd ~/ccrc/agent && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user \
    && cp ~/ccrc/deploy/ccrc-agent.service ~/.config/systemd/user/ \
    && cp ~/ccrc/ccd/claude-session@.service ~/.config/systemd/user/ \
    && mkdir -p ~/.config/systemd/user/claude-session@.service.d "$HOME/.config/systemd/user/app-claude\x2dsession.slice.d" ~/.config/systemd/user/ccrc-agent.service.d \
    && cp ~/ccrc/deploy/systemd/claude-session@.service.d/limits.conf ~/.config/systemd/user/claude-session@.service.d/ \
    && cp ~/ccrc/deploy/systemd/app-claude-session.slice.d/limits.conf "$HOME/.config/systemd/user/app-claude\x2dsession.slice.d/" \
    && cp ~/ccrc/deploy/systemd/ccrc-agent.service.d/protect.conf ~/.config/systemd/user/ccrc-agent.service.d/ \
    && cp ~/ccrc/deploy/systemd/ccd-cap-scopes.service ~/ccrc/deploy/systemd/ccd-cap-scopes.timer ~/.config/systemd/user/'
  "${SSH[@]}" "$BOX" "$AGENT_BUILD_CMD"
  # STAMP HERE — after the build that can fail, before the restart that makes
  # it live (I1, final review). Stamping earlier (this chain's shape until
  # now) let a failed remote `npm ci && npm run build` — a registry hiccup,
  # the common case — abort the deploy with build.json already claiming the
  # NEW sha while the box's dist/ was never rebuilt to match: the box's own
  # version read (checked below, against the box's own ccd) lies
  # immediately, and /health lies the moment Restart=always next cycles the
  # unit onto that untouched dist/. That is exactly the measurement-forgery
  # class stamp_build's own header above bans by name. Do not "simplify"
  # this back to before the build chain — the whole point of splitting
  # AGENT_BUILD_CMD from AGENT_CMD is to give the stamp a place to sit that
  # only a SUCCESSFUL build reaches. `set -euo pipefail` plus the ssh above
  # means this line is never reached if the build failed.
  stamp_build
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-session-hooks.sh'
  # The coordinator skill is the FIFTH artifact ccrc ships to the fleet host
  # (ccd, notify.sh, session-hook.sh + its installer, and now this). The TREE
  # rides rsync --delete so a reference file deleted in git is deleted on the
  # box too — a stale reference is prose a model will still follow, and prose
  # is read whole on the next open, so tree-level atomicity is not load-bearing
  # for it. The INSTALLER is different: it gets EXECUTED, which is exactly the
  # class install_atomic exists for — a deploy dying between scp and chmod must
  # not leave a half-written script that the next deploy (or a curious
  # operator) runs.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.cc-sessions/coordinator-skill'
  rsync -az --delete -e "${SSH[*]}" ccd/coordinator-skill/ "$BOX":.cc-sessions/coordinator-skill/
  install_atomic ccd/install-coordinator-skill.sh .cc-sessions/install-coordinator-skill.sh 755
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-coordinator-skill.sh'
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
  AGENT_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \
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
  # Capture, THEN test — no pipe (I7, final review): `tee /dev/stderr | grep
  # -qF` races `grep -q`'s early exit on a match against `tee`'s write of the
  # REMAINING lines, and under `set -o pipefail` a `tee` killed by SIGPIPE
  # after `grep` already matched turns a successful deploy into a reported
  # FAILURE. Measured on this exact shape: 0/1500 false failures at 1 output
  # line, climbing with line count. `ccd version` is one line today, so this
  # was latent, not live — but spec §3 plans to grow this surface, and a
  # failing ssh inside `$( )` still aborts the script under `set -e`, which is
  # the behaviour we want.
  ccd_version_out="$("${SSH[@]}" "$BOX" '~/.local/bin/ccd version')"
  printf '%s\n' "$ccd_version_out" >&2
  printf '%s' "$ccd_version_out" | grep -qF "$BUILD_SHA" \
    || { echo "deploy: FAILED — the box's ccd version does not carry the shipped sha $BUILD_SHA" >&2; exit 1; }
  prune_backups || echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2
else
  # `ship_env` below silently no-ops when deploy/ccrc.env is absent, and the
  # unit's `EnvironmentFile=-%h/.ccrc/ccrc.env` tolerates a missing file too
  # — so nothing stopped a deploy with neither from landing a unit with
  # NOTHING to configure it, and config.ts's `host` then defaults to
  # 127.0.0.1. The live `tailscale serve` proxies to the tailnet IP
  # LITERALLY, so a loopback bind takes the PWA dark on every device, and
  # verify-service.sh still passes (the PROCESS is up) — only the health curl
  # at the bottom of this branch would catch it, AFTER the unit is already
  # replaced and restarted. Refuse before touching anything (I2, final
  # review): a config already on the box is fine, an absent one on both ends
  # is not.
  if [ ! -f deploy/ccrc.env ]; then
    "${SSH[@]}" "$BOX" '[ -f ~/.ccrc/ccrc.env ]' \
      || { echo "deploy: FAILED — no deploy/ccrc.env locally and no ~/.ccrc/ccrc.env already on $BOX; refusing to ship a config-less unit" >&2; exit 1; }
  fi
  # The same refusal for the roster, and a sharper one. `loadConfig`
  # (server/src/config.ts) REFUSES TO BOOT without ~/.ccrc/accounts.json — by
  # design, so a fleet never runs against a roster that is not the box's — and
  # ccrc.service is Restart=always with RestartSec=3 and NO StartLimit. A
  # post-restart health check would come too late BY CONSTRUCTION: this branch
  # replaces dist/ and stamps build.json before the curl at the bottom runs,
  # with no rollback, so a late failure leaves the box mutated and crash-looping
  # every three seconds. Refuse first, seed second, and only then prove the
  # roster the box will actually boot with parses — all before the PWA build
  # and every mutation below it.
  [ -f "$ACCOUNTS_JSON" ] || "${SSH[@]}" "$BOX" '[ -f ~/.ccrc/accounts.json ]' \
    || { echo "deploy: FAILED — no roster at $ACCOUNTS_JSON locally and no ~/.ccrc/accounts.json already on $BOX; the server refuses to boot without one" >&2; exit 1; }
  # Same seed-time proof as the agent branch, for the same reason: a bad local
  # roster seeded onto a fresh box is never overwritten again, so it has to be
  # rejected while it is still only a local file (F1, final review).
  [ ! -f "$ACCOUNTS_JSON" ] || check_local_roster
  ship_roster
  BOX_ROSTER="$(mktemp)"
  "${SSH[@]}" "$BOX" 'cat ~/.ccrc/accounts.json' > "$BOX_ROSTER"
  node deploy/gen-accounts.mjs "$BOX_ROSTER" > /dev/null \
    || { echo "deploy: FAILED — the roster at $BOX:~/.ccrc/accounts.json is not one ccrc can use (see above); the server would crash-loop on it" >&2; exit 1; }
  rm -f "$BOX_ROSTER"
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
  # The unit file joins the set here too (I2, final review): REMOTE_CMD below
  # `cp`s straight over ~/.config/systemd/user/ccrc.service with no backup
  # ever taken, unlike dist-pwa and coord.db beside it.
  "${SSH[@]}" "$BOX" "mkdir -p ~/ccrc-backups/$TS"
  "${SCP[@]}" deploy/backup-coord.mjs "$BOX":ccrc-backups/backup-coord.mjs
  "${SSH[@]}" "$BOX" "{ [ ! -d ~/ccrc/server/dist-pwa ] || cp -a ~/ccrc/server/dist-pwa ~/ccrc-backups/$TS/dist-pwa; } \
    && { [ ! -f ~/.config/systemd/user/ccrc.service ] || cp -a ~/.config/systemd/user/ccrc.service ~/ccrc-backups/$TS/ccrc.service; } \
    && { [ ! -f ~/.ccrc/coord.db ] || node --no-warnings ~/ccrc-backups/backup-coord.mjs ~/.ccrc/coord.db ~/ccrc-backups/$TS/coord.db; }"
  # See the agent path's identical exclude, above, for why: this rsync also
  # ships `deploy/` whole, and without the exclude the token rides along a
  # second time, unhardened, next to `ship_secret`'s 0600 copy three lines down.
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    --exclude 'ccrc-mail.token' \
    server shared deploy "$BOX":ccrc/
  ship_env ccrc.env .ccrc/ccrc.env
  ship_secret ccrc-mail.token '~/.ccrc' mail.token
  REMOTE_BUILD_CMD='cd ~/ccrc/server && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc.service ~/.config/systemd/user/'
  "${SSH[@]}" "$BOX" "$REMOTE_BUILD_CMD"
  # STAMP HERE — after the build that can fail, before the restart that makes
  # it live (I1, final review; see the agent chain's identical comment above
  # for the full failure mode). Stamping before a remote `npm ci && npm run
  # build` that can fail let build.json claim a sha the box's dist/ was never
  # rebuilt to run — /health then lies the moment Restart=always next cycles
  # ccrc.service onto the untouched dist/, the exact measurement-forgery
  # class stamp_build's own header bans by name. Do not "simplify" this back
  # to before REMOTE_BUILD_CMD: the split exists so only a successful build
  # reaches this line. `set -euo pipefail` plus the ssh above means this line
  # is never reached if the build failed.
  stamp_build
  # verify-service.sh here closes the same crash-loop gap it closes on the
  # agent path above (see that chain's comment) — a restart that "succeeds"
  # the moment systemd forks, then dies every RestartSec. The curl AFTER it
  # is not redundant: verify-service.sh proves the process survived the
  # window, the curl proves Fastify is actually listening — different
  # questions, both cheap here because (unlike the agent) this unit has an
  # HTTP route to ask. agent/test/deploy-verify.test.ts pins both the
  # ordering (restart -> verify -> curl) and that neither call is dropped.
  REMOTE_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc.service \
    && systemctl --user restart ccrc.service \
    && bash ~/ccrc/deploy/verify-service.sh ccrc.service \
    && curl -fsS '"$HEALTH_URL"
  "${SSH[@]}" "$BOX" "$REMOTE_CMD"
  # /health's build stamp must equal what this run shipped. The curl inside
  # REMOTE_CMD proved "something answers"; this proves it answers AS the
  # build we deployed — the assertion the 2026-08-10 stale-binary afternoon
  # was missing. -f on a fresh curl: a dead server here is also a failure.
  # Capture, THEN test — same shape as the agent branch's ccd-version
  # assertion above, for the same reason (I7, final review): a bare `curl |
  # grep -qF` pipe can report failure after a successful deploy if `grep -q`
  # exits on an early match while `curl` is still writing. `set -e` still
  # aborts on a failing curl inside `$( )`.
  health_out="$(curl -fsS "$HEALTH_URL")"
  printf '%s\n' "$health_out" >&2
  printf '%s' "$health_out" | grep -qF "\"sha\":\"$BUILD_SHA\"" \
    || { echo "deploy: FAILED — /health does not report the shipped sha $BUILD_SHA" >&2; exit 1; }
  prune_backups || echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2
fi
