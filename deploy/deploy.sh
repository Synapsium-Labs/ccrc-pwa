#!/usr/bin/env bash
set -euo pipefail
# Everything below is repo-relative: resolve the repo root from this script's
# own location, so the deploy behaves the same from any cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── WHERE THIS DEPLOY IS GOING ───────────────────────────────────────────────
# The coordinates are per-WORKSTATION, not per-fleet: the same repo gets
# deployed from a laptop and from the fleet host itself, which reach the target
# on different keys and sometimes different ports. So there are no literals
# here and NO DEFAULTS to inherit by accident — a deploy that guessed its
# target would ship this working tree to whoever the last committer deployed
# to, which is exactly the bug a public repo makes into everyone's bug.
#
# Set them once per machine in ~/.ccrc/deploy.env — the deploying machine's own
# file, outside every checkout, so it survives worktrees and can never be
# committed — or pass them in the environment:
#
#     CCRC_BOX=user@host                 # required: the target
#     CCRC_SSH_KEY=$HOME/.ssh/id_ed25519 # required: identity file
#     CCRC_SSH_PORT=22                   # optional, default 22
#     CCRC_AGENT_BOX=user@fleet-host     # optional: the agent lane's target
#                                        # when `deploy.sh agent` names no host
#                                        # — NEVER defaulted from CCRC_BOX; a
#                                        # single-box install sets it to the
#                                        # same user@host as CCRC_BOX
#     CCRC_SW_DENYLIST=/docs,/fleet      # optional: paths on the box's origin
#                                        # that are NOT ccrc (see below)
#
CCRC_DEPLOY_ENV="${CCRC_DEPLOY_ENV:-$HOME/.ccrc/deploy.env}"
# shellcheck source=/dev/null
[ -r "$CCRC_DEPLOY_ENV" ] && . "$CCRC_DEPLOY_ENV"

# EXPORTED, and that is the whole point of the line. The PWA is built HERE, on
# the deploying workstation (see the server lane's `cd pwa && npm run build`),
# and `vite.config.ts` reads this out of `process.env` to decide which
# navigations the service worker must leave alone. Sourcing deploy.env makes it
# a shell variable; only exporting it reaches the build. Without the export an
# operator sets the knob, sees no error, ships a worker that has never heard of
# it, and their co-tenant at /docs starts answering with the ccrc shell on
# client-side navigations only — which reads as an intermittent fault in the
# OTHER application. `deploy-coordinates.test.ts` pins the export for that
# reason.
export CCRC_SW_DENYLIST="${CCRC_SW_DENYLIST:-}"

# Refuse, with the fix in the message, rather than guessing. Exit 2 = usage
# error, the same contract `ccrc` states for its own verbs.
# Takes the RESOLVED VALUE, not a variable name: the target can come from
# `$CCRC_BOX` or from `deploy.sh agent <host>`, and only the resolution knows
# which. Exit 2 = usage error, the contract `ccrc` states for its own verbs.
_deploy_need() {
  local value="$1" name="$2" what="$3" example="$4"
  [ -n "$value" ] && return 0
  echo "deploy: FAILED — \$$name is not set ($what)." >&2
  echo "  Set it in $CCRC_DEPLOY_ENV, or pass it in the environment:" >&2
  echo "      $name=$example bash deploy/deploy.sh" >&2
  echo "  There is deliberately no default: a deploy that guessed its target" >&2
  echo "  would ship this tree to someone else's box." >&2
  exit 2
}

# Usage: deploy.sh [server|agent] [host]
#   deploy.sh                 -> deploy server to $CCRC_BOX
#   deploy.sh agent <host>    -> deploy ccrc-agent to <host> ($CCRC_AGENT_BOX
#                                when omitted; NEVER $CCRC_BOX)
#
# The target is RESOLVED BEFORE it is required, because `agent <host>` names
# its box on the command line and must not also demand $CCRC_BOX — requiring
# the file for a target the caller just typed is a refusal with nothing to fix.
TARGET="${1:-server}"
BOX="${CCRC_BOX:-}"
# THE AGENT LANE NEVER FALLS BACK TO $CCRC_BOX. On a two-box fleet $CCRC_BOX
# is the SERVER box, and the `${2:-$BOX}` fallback this replaces committed
# exactly the guess the refusal below forbids: `deploy.sh agent` with no host
# rsynced the agent tree onto the server box and enabled ccrc-agent.service
# there (measured live, 2026-08-25). The agent's target is $2, or
# $CCRC_AGENT_BOX — a key an operator set with the agent in mind — or exit 2.
#
# REVERSED operands (the literal first), on purpose, and this comment
# deliberately does not spell the test either way: agent/test/deploy-verify
# locates both this override and the agent BRANCH far below by the FIRST
# occurrence of each one's exact spelling, so neither form may appear in prose
# before its code — a shadowed probe "proves" orderings the shell never runs,
# the trap this file records twice already.
if [ agent = "$TARGET" ]; then
  BOX="${2:-${CCRC_AGENT_BOX:-}}"
  if [ -z "$BOX" ]; then
    echo "deploy: FAILED — \$CCRC_AGENT_BOX is not set and no <host> was given (the agent lane's target)." >&2
    echo "  Name the fleet host on the command line, or set it in $CCRC_DEPLOY_ENV or the environment:" >&2
    echo "      bash deploy/deploy.sh agent user@fleet-host" >&2
    echo "      CCRC_AGENT_BOX=user@fleet-host" >&2
    echo "  There is deliberately no default, and NO fallback to \$CCRC_BOX — on a two-box" >&2
    echo "  fleet that is the SERVER box: a deploy that guessed its target" >&2
    echo "  would ship this tree to someone else's box. A single-box install (server and" >&2
    echo "  fleet on one machine) says so explicitly: set CCRC_AGENT_BOX to the same user@host, or pass it." >&2
    exit 2
  fi
fi

_deploy_need "$BOX"               CCRC_BOX     "the deploy target, user@host"           "user@fleet-host"
_deploy_need "${CCRC_SSH_KEY:-}"  CCRC_SSH_KEY "the ssh identity file used to reach it" "\$HOME/.ssh/id_ed25519"

CCRC_SSH_PORT="${CCRC_SSH_PORT:-22}"
SSH=(ssh -p "$CCRC_SSH_PORT" -i "$CCRC_SSH_KEY")
SCP=(scp -P "$CCRC_SSH_PORT" -i "$CCRC_SSH_KEY")

# Derived from the RESOLVED $BOX — i.e. AFTER the agent-target override just
# above, so it tracks $2 — never a literal. A literal here meant
# `CCRC_BOX=newbox bash deploy/deploy.sh` still curled the OLD box: if both
# boxes happened to sit at the same sha (a re-deploy, a rollback), the sha
# grep at the bottom of the server branch would pass WITHOUT EVER CONTACTING
# THE TARGET (I4, final review). `${BOX#*@}` strips the `user@` prefix BOX
# always carries. CCRC_HEALTH_URL remains the explicit override for a box
# whose health route isn't at the `<host>:7788` shape.
# ── D-169: the default probes an address an EXPOSED box stops answering on ─
# The `<host>:7788` shape is right for a plain box and wrong for every box
# behind caddy: exposure means the server binds LOOPBACK and the public name
# is the only way in. Measured 2026-08-22, and the failure is worse than a
# false alarm — the deploy that broke the public path PASSED this gate,
# because the same bad ccrc.env that caused the outage also re-bound the
# server onto the address the gate probes. The gate agreed with the breakage
# it had just shipped.
#
# So it is derived from the box, not from this workstation: if the box has an
# exposure file naming an origin, that origin's /health IS this box's front
# door, and probing it measures the whole path — caddy, the proxy hop, and
# the server — instead of one hop of it. Read over the same ssh the rest of
# the script uses; falls back to the old shape for a box with no exposure.
# CCRC_HEALTH_URL still overrides both (a box fronted by something ccrc did
# not configure).
# THE TWO CURLS ASK DIFFERENT QUESTIONS AND NEED DIFFERENT URLS. Until now
# they shared one, which is why this went unnoticed. The curl inside
# REMOTE_CMD runs ON THE BOX and means "is Fastify listening?" — it must
# target whatever the server actually binds, and pointing it at the public
# name would make it depend on NAT hairpin, i.e. on a thing that has nothing
# to do with the question. The curl at the bottom runs HERE and means "does
# the box serve the build I just shipped, through the door its users use?"
# — that one is the public origin, and its whole value is that it traverses
# caddy and the proxy hop.
#
# Both are read from the box rather than assumed, in the order systemd reads
# them: ccrc.env, then exposure.env, last line wins (the unit's two
# EnvironmentFile lines). One ssh, both answers.
derive_health_urls() {
  local raw host port origin
  # The remote snippet is a SECOND READER of files `ccd/ccrc`'s
  # `_box_env_value` already reads, and single-definition.test.ts names
  # deploy.sh as a holder because of it. It therefore copies that reader's
  # rules deliberately — skip leading whitespace, require a bare `KEY=` (never
  # `export KEY=`, which systemd does not accept either), take the LAST
  # occurrence across both files in the unit's own order, strip a trailing CR
  # and one layer of surrounding quotes — and a test feeds both readers the
  # same awkward lines and asserts they agree. Sent on stdin (`bash -s`) so
  # the quoting is the remote shell's problem and not a nest of escapes.
  raw="$("${SSH[@]}" "$BOX" bash -s <<'EOSH' 2>/dev/null || true
v() {
  sed -n "s/^[[:space:]]*$1=//p" ~/.ccrc/ccrc.env ~/.ccrc/exposure.env 2>/dev/null \
    | tail -n1 \
    | sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
for k in CCRC_HOST CCRC_PORT CCRC_ORIGIN; do printf '%s=%s\n' "$k" "$(v "$k")"; done
EOSH
  )"
  host="$(printf '%s\n' "$raw" | sed -n 's/^CCRC_HOST=//p' | tail -n1)"
  port="$(printf '%s\n' "$raw" | sed -n 's/^CCRC_PORT=//p' | tail -n1)"
  origin="$(printf '%s\n' "$raw" | sed -n 's/^CCRC_ORIGIN=//p' | tail -n1)"
  # config.ts's own defaults, restated here because a box with no ccrc.env at
  # all is a legal (if rare) shape and must not produce `http://:/health`.
  [ -n "$port" ] || port=7788
  case "$host" in
    ''|0.0.0.0|'::'|'[::]') host=127.0.0.1 ;;   # wildcards answer on loopback
  esac
  BOX_HEALTH_URL="http://$host:$port/health"
  origin="${origin%/}"
  case "$origin" in
    https://?*|http://?*) HEALTH_URL="$origin/health" ;;
    # No exposure: the box's own address IS the front door, which is the
    # shape this gate has always had.
    *) HEALTH_URL="http://${BOX#*@}:$port/health" ;;
  esac
}
BOX_HEALTH_URL=""
HEALTH_URL=""
derive_health_urls
[ -z "${CCRC_HEALTH_URL:-}" ] || HEALTH_URL="$CCRC_HEALTH_URL"
echo "deploy: health gates — on the box: $BOX_HEALTH_URL; from here: $HEALTH_URL" >&2

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
# Stage 4, Task 1: the release tag rides as an ADDITIVE fifth field, present
# iff a vX.Y.Z tag points at the built commit — MEASURED, like every other
# field in this stamp. Only the release shape qualifies (a `wip` tag at HEAD is not
# an identity claim), and the grep exiting 1 on no match is the ordinary case,
# hence the `|| BUILD_VERSION=""` that keeps set -e out of it.
BUILD_VERSION="$(git tag --points-at HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1)" || BUILD_VERSION=""
stamp_build() {
  local stamp
  stamp="$(mktemp)"
  # `vfield` is deliberately NOT `local`: server/test/buildinfo.test.ts runs
  # the lines between the mktemp above and the ssh below verbatim, at top
  # level, in a fixture repo — the one way this derivation stays measured.
  vfield=""
  if [ -n "$BUILD_VERSION" ]; then vfield=",\"version\":\"$BUILD_VERSION\""; fi
  printf '{"sha":"%s","ref":"%s","builtAt":"%s","dirty":%s%s}\n' \
    "$BUILD_SHA" "$BUILD_REF" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BUILD_DIRTY" "$vfield" > "$stamp"
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
  install_atomic "$stamp" .ccrc/build.json 644
  rm -f "$stamp"
}

# `ccrc` ON PATH — A SHIM INTO THE SHIPPED TREE, NEVER A COPY OF THE SCRIPT.
#
# `ccd/ccrc` is the lifecycle CLI (version/doctor/status/adopt) and until this
# task no deploy installed it, so it existed on neither box. Installing it is
# NOT one `install_atomic ccd/ccrc .local/bin/ccrc 755` by imitation of the
# `ccd` line above, and the two reasons are structural:
#
#   1. `ccrc` is not self-contained. It sources `ccrc-doctor-checks`, which
#      sources `ccrc-wrapper-shape`, and `cmd_adopt` execs `ccrc-adopt` — all
#      resolved through `${BASH_SOURCE[0]}`. bash does NOT resolve that through
#      a symlink, so a lone copy (or a symlink) at ~/.local/bin/ccrc leaves
#      `ccrc doctor` dead on every box: "doctor's check table is missing".
#   2. Installing all four files into ~/.local/bin fixes (1) and BREAKS the
#      node check instead: `_dr_pkg_candidates` reads the shipped node floor at
#      `$CCRC_HERE/../{server,agent}/package.json`, which would become
#      `~/.local/{server,agent}/package.json` — neither of which exists.
#
# Both constraints point at the same place: `ccrc` has to RUN from inside the
# shipped tree at ~/ccrc/ccd/, which is what its own code already assumes (that
# path is the remedy `_check_node` prints). So PATH gets a launcher and the
# rsync above does the shipping. That also settles versioning: all four files
# arrive in ONE rsync of ONE tree and can never come from two different
# deploys, where four independent install_atomic calls plus one aborted run
# would leave a new `ccrc` beside a stale `ccrc-doctor-checks` for good.
#
# The shim itself carries no version and no logic, so it is not backed up
# before it is replaced (unlike ccd, the unit files and dist-pwa, whose
# previous bytes are a restore path): every deploy regenerates these same
# lines, and the thing worth rolling back is the tree it points at.
#
# The mkdir lives HERE, not at the two call sites: `install_atomic` does not
# create its destination directory and the SERVER lane never creates
# ~/.local/bin at all — the agent lane only does so incidentally, in its backup
# step. Same discipline as `stamp_build`'s own `mkdir -p ~/.ccrc`.
install_ccrc_shim() {
  local shim
  shim="$(mktemp)"
  # QUOTED heredoc: every expansion below must happen on the BOX, at run time,
  # against the box's own $HOME — not here, against the deploying machine's.
  cat > "$shim" <<'CCRC_SHIM'
#!/usr/bin/env bash
# GENERATED — by deploy/deploy.sh's install_ccrc_shim or ccrc install's
# _inst_shim; the two emit identical bytes and a test pins it. Do not edit on
# the box. Edit ccd/ccrc or deploy/deploy.sh in the repo and re-run whichever
# generator made this file; this file is only a launcher.
#
# `ccrc` finds its check table, its wrapper-shape library, its adopt script and
# the shipped package.json RELATIVE TO ITSELF, so it has to be run from inside
# the tree the deploy rsyncs. That is why this is an exec into ~/ccrc/ccd and
# not a copy of the script: bash does not resolve ${BASH_SOURCE[0]} through a
# symlink, and a copy on PATH would resolve every one of those to ~/.local.
#
# `if`, not `|| { … }`: a `}` in column 1 would end the enclosing shell
# function as far as every `/name\(\) \{([\s\S]*?)\n\}/` probe in
# agent/test/deploy-verify.test.ts is concerned — that is the idiom this file's
# helpers are all read with, and a heredoc that quietly truncates the body
# those tests see is worse than a slightly longer refusal.
CCRC_SHIPPED="$HOME/ccrc/ccd/ccrc"
if [ ! -x "$CCRC_SHIPPED" ]; then
  echo "ccrc: $CCRC_SHIPPED is missing or not executable — this box's shipped ccrc tree is gone, so there is nothing for this launcher to run. Re-install: run 'bash install.sh' from a ccrc checkout on this box, or (on a fleet-deployed box) re-run deploy/deploy.sh against it." >&2
  exit 1
fi
exec "$CCRC_SHIPPED" "$@"
CCRC_SHIM
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.local/bin'
  install_atomic "$shim" .local/bin/ccrc 755
  rm -f "$shim"
}

# Ship a local, gitignored, real-token env file to the box if one exists.
# Only the committed *.env.example templates are ever in git.
ship_env() {
  local local_file="deploy/$1" remote_path="$2"
  if [ -f "$local_file" ]; then
    env_drop_guard "$local_file" "$remote_path"
    echo "shipping $local_file -> $BOX:$remote_path"
    "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
    "${SCP[@]}" "$local_file" "$BOX:$remote_path"
  fi
}

# ── env_drop_guard — a deploy may change a value, never silently un-set one ─
# D-168, and the whole reason this function exists is one measured incident
# (2026-08-22). These env files are LOCAL and GITIGNORED — one per
# workstation, shared with nobody, and therefore quietly divergent. A deploy
# from a checkout whose copy predated the box being armed shipped a ccrc.env
# with no CCRC_AUTH line at all. scp does not merge; the key did not change
# value, it CEASED TO EXIST, and a publicly-reachable box came back up
# unauthenticated. Nothing in the pipeline noticed: the unit was active, the
# process was stable, and the sha gate at the bottom of this script passed.
#
# The rule is narrow on purpose. Shipping config is FOR changing values, so a
# differing value is never questioned. Dropping a key the box is currently
# running with is a different act — it hands the box back to a default it was
# deliberately moved off — so it stops the deploy before anything is touched.
#
# KEY NAMES ONLY, both ends. These files are the tokens; a guard that printed
# a value to explain itself would put secrets in every CI log that ever runs
# a deploy.
env_drop_guard() {
  local local_file="$1" remote_path="$2" remote_keys="" local_keys="" dropped=""
  # `|| true`: no file on the box (a first deploy) is not a drop — there is
  # nothing yet for this shipment to take away.
  remote_keys="$("${SSH[@]}" "$BOX" "sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' $remote_path 2>/dev/null | sort -u" 2>/dev/null || true)"
  [ -n "$remote_keys" ] || return 0
  local_keys="$(sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$local_file" | sort -u)"
  dropped="$(comm -23 <(printf '%s\n' "$remote_keys") <(printf '%s\n' "$local_keys") | tr '\n' ' ')"
  dropped="${dropped% }"
  [ -n "$dropped" ] || return 0
  echo "deploy: FAILED — $local_file would un-set keys that $BOX:$remote_path currently sets: $dropped" >&2
  echo "deploy: shipping this file REPLACES the box's copy, so those keys would revert to their built-in defaults. That is how a public box silently went dark on 2026-08-22 (CCRC_AUTH)." >&2
  echo "deploy: add them to $local_file (it is gitignored and per-workstation, so it drifts from the box by design), or remove them from the box if they are genuinely obsolete. Nothing was shipped." >&2
  exit 1
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
#   deploy/accounts.default.json — the seed a box with no roster starts from,
#     and the DEFAULT here on purpose. Seeding is permanent (never overwritten),
#     so the default has to be the roster that is right for a box we know
#     nothing about; anything else silently installs one operator's account
#     list onto a stranger's machine on their first deploy.
# Point CCRC_ACCOUNTS_JSON at a roster of your own to seed something else — a
# box that already has ~/.ccrc/accounts.json keeps it either way.
ACCOUNTS_JSON="${CCRC_ACCOUNTS_JSON:-deploy/accounts.default.json}"

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

# Prints the fingerprint of a generated accounts.sh — the digest of its BODY,
# which is exactly what `markGenerated` (shared/mark.mjs) already wrote into
# the file's own line 2. Extracted rather than recomputed: no second node
# invocation, and no second definition of which bytes get hashed.
#
# Why it is printed at all, given the server and agent now compare these
# continuously over the WS link (`rosterAgreement`, server/src/fleetstate.ts):
# the two boxes are deployed by two separate runs of this script, minutes or
# days apart, and this is the operator's read on whether the run they just did
# agrees with the run they did last time — before the fleet is up to say so.
# It is also the ONLY signal in the single-box and agent-only cases, where
# there is no server on the other end of a socket to disagree with.
roster_fp() {
  sed -n '2s/^# ccrc:generated 1 sha256=//p' "$1"
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
  echo "roster fingerprint on $BOX: $(roster_fp "$ACCOUNTS_SH")"
  # ── THE SECOND SEED-ONCE FACT, AND WHY IT HAS TO BE HERE ─────────────────
  # `~/.ccrc/remote-control` is what the ccd installed further down asks, on
  # EVERY spawn, to decide whether a session comes up with `--remote-control`
  # (claude.ai discoverability) or as a plain pane. Absent means off. Same
  # ownership rule as the roster above — created when the box has none, NEVER
  # overwritten, because it is the operator's switch — and one ssh, guarded, in
  # that helper's shape.
  #
  # `on`, WHICH IS THE OPPOSITE OF WHAT `ccrc install` SEEDS, deliberately.
  # This lane ships to the reference fleet host, which has run every one of its
  # ~11 live sessions with `--remote-control` since long before there was a
  # flag: here the file DESCRIBES the box rather than deciding something new
  # about it. Seeding `off` would silently strip the flag from every one of
  # those sessions at its next respawn — an outage with a config-shaped
  # trigger. A fresh single-box install has no such history and no claim on
  # claude.ai, which is why the other lane defaults the other way.
  #
  # BEFORE EVERY INSTALL BELOW, and that is the whole reason it sits up here
  # rather than beside the other file steps. The gap between a new ccd landing
  # and the flag being written IS the strip: the supervisor sweep at the bottom
  # of this branch restarts every live session, and a respawn inside that gap
  # would see new-ccd on an unseeded box. deploy-verify pins the order.
  #
  # THE TRAILING NEWLINE IS THE CONTRACT, not formatting. ccd reads the first
  # line with `IFS= read -r`, and bash's `read` returns NON-ZERO at
  # EOF-before-delimiter, so a file holding `on` with no newline reads as OFF —
  # the exact strip this block exists to prevent, dressed as a green deploy.
  # deploy-verify extracts the format string below and asserts the newline.
  #
  # ONE LINE AND ONE ssh: the guard, the write and the transcript line all run
  # on the box, so the deploy reports what it actually did rather than what it
  # would have done — and a box that already had the file is silent, which is
  # what "seed once" looks like from here. `mkdir -p` OF ITS OWN, inside the
  # guard, rather than leaning on the roster helper's: the directory has to
  # exist for the redirect, and the ordering note further down records what
  # happens when a step depends on a mkdir that belongs to something that
  # could move.
  "${SSH[@]}" "$BOX" '[ -e ~/.ccrc/remote-control ] || { mkdir -p ~/.ccrc && printf "on\n" > ~/.ccrc/remote-control && echo "seeded ~/.ccrc/remote-control = on (first install only; never overwritten again)"; }'
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
  # The coordination client, beside ccd because the fleet host is where sessions
  # run and a session-side client on the server box is a copy nobody invokes. A
  # plain install_atomic and NOT a shim: it sources nothing, so one file is the
  # whole program (pinned — `ccrc-api-ship.test.ts`, and the shim's own header
  # above for what changes the day that stops being true).
  install_atomic ccd/ccrc-api .local/bin/ccrc-api 755
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
  # graphify Task 10 (O3/O6b): the per-tree AST sweep executable, unconditional
  # here exactly as its sibling above — the agent lane only ever ships to a
  # fleet host, so there is no server-role branch to gate it against the way
  # `ccd/ccrc`'s own `_inst_bins` has to.
  install_atomic ccd/ccd-graph-sweep .local/bin/ccd-graph-sweep 755
  # D-1160: the sweep's DEFAULT noise list — ccrc's own footprint, kept out of
  # every corpus. Shipped on this lane and not only by `ccrc install`, because a
  # fleet host is DEPLOYED day to day and installed rarely; without it the box
  # keeps refusing builds over `.remember/` and `.superpowers/` files that ccrc
  # itself wrote there. 644, not 755: it is data the sweep reads, never run.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc/graph-noise'
  install_atomic ccd/graph-noise.default.list .ccrc/graph-noise/_default.list 644
  install_atomic ccd/tmux.conf .tmux.conf 644
  install_atomic ccd/statusline-command.sh .claude/statusline-command.sh 755
  # `ccrc` joins ccd on PATH, in the same ordering class: after the roster it
  # reads, after the rsync that lands the tree it launches, and before the
  # restart chain that can abort the deploy. See the helper's own header for
  # why this is a launcher rather than another install_atomic of a script.
  #
  # THIS COMMENT DELIBERATELY SPELLS NO HELPER NAME AT ALL — not this
  # launcher's, and not the build-stamp helper's either: deploy-verify locates
  # both calls with `indexOf(<name>)` from the top of this branch, so any
  # earlier prose mention shadows the real invocation and the test then
  # "proves" an ordering the shell never runs. Measured twice on this task —
  # once naming this helper here, and again in the note that explained it,
  # which shadowed the STAMP assertion instead. Same trap the roster note below
  # records.
  install_ccrc_shim
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
    && cp ~/ccrc/deploy/systemd/ccd-cap-scopes.service ~/ccrc/deploy/systemd/ccd-cap-scopes.timer ~/.config/systemd/user/ \
    && cp ~/ccrc/deploy/systemd/ccd-graph-sweep.service ~/ccrc/deploy/systemd/ccd-graph-sweep.timer ~/.config/systemd/user/'
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
  # The two SKILLS are the FIFTH and SIXTH artifacts ccrc ships to the fleet
  # host (ccd, notify.sh, session-hook.sh + its installer, and now these two).
  # Each rides the same four lines for the same reasons. The TREE rides rsync
  # --delete so a reference file deleted in git is deleted on the box too — a
  # stale reference is prose a model will still follow, and prose is read whole
  # on the next open, so tree-level atomicity is not load-bearing for it. The
  # INSTALLER is different: it gets EXECUTED, which is exactly the class
  # install_atomic exists for — a deploy dying between scp and chmod must not
  # leave a half-written script that the next deploy (or a curious operator)
  # runs.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.cc-sessions/coordinator-skill'
  rsync -az --delete -e "${SSH[*]}" ccd/coordinator-skill/ "$BOX":.cc-sessions/coordinator-skill/
  install_atomic ccd/install-coordinator-skill.sh .cc-sessions/install-coordinator-skill.sh 755
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-coordinator-skill.sh'
  # THE WORKER SKILL SHIPS SECOND, AND THE ORDER IS LOAD-BEARING, not a
  # grouping: its SKILL.md carries no references/ of its own and points a live
  # worker at the coordinator's installed tree by relative path
  # (`../ccrc-coordinator/references/…`, both skills sitting side by side under
  # one config dir). Landing it first would put a skill on the box naming
  # reference files nothing there provides yet — for the width of one ssh round
  # trip on a good deploy, and permanently on one that dies in between.
  # server/test/install-worker-skill.test.ts pins that ordering against the
  # coordinator's RUN line.
  #
  # Like the note above this branch's tree rsync, this comment deliberately
  # does NOT spell this skill's directory name with a trailing slash: that test
  # locates the rsync by scanning the agent arm for the FIRST line containing
  # that exact spelling, so any COMMENT carrying it shadows the real invocation
  # and fails the suite. That note records the two times the trap was measured.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.cc-sessions/worker-skill'
  rsync -az --delete -e "${SSH[*]}" ccd/worker-skill/ "$BOX":.cc-sessions/worker-skill/
  install_atomic ccd/install-worker-skill.sh .cc-sessions/install-worker-skill.sh 755
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-worker-skill.sh'
  # graphify Task 10 (O3/O6b): the assembled-SRC skill installer, AFTER both
  # roster-reading skill arms above (spec §B: its SRC is the INSTALLED
  # package, never vendored, which is what makes it a plain `install_atomic` +
  # remote run rather than the rsync-a-tree-then-run shape its two neighbours
  # need).
  #
  # R-8 (fix round, F1): GATED on ~/.ccrc/graphify.pin existing on the box —
  # `install-graphify-skill.sh` exits 1 with "no pin" when the venv engine
  # step (`ccrc install`'s `_inst_graphify_engine`) has never run there, and
  # this file runs under `set -euo pipefail`: an ungated call would ABORT the
  # entire agent lane before AGENT_CMD's daemon-reload/enables ever run, on
  # any box whose only provisioning has ever been `deploy.sh agent`. The
  # `install_atomic` line above stays unconditional — shipping the installer
  # file is harmless; only RUNNING it without its precondition is not.
  install_atomic ccd/install-graphify-skill.sh .cc-sessions/install-graphify-skill.sh 755
  "${SSH[@]}" "$BOX" '[ -f ~/.ccrc/graphify.pin ] && bash ~/.cc-sessions/install-graphify-skill.sh || echo "graphify: no pin on box — run ccrc install once; skill deferred"'
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
    && systemctl --user enable --now ccd-graph-sweep.timer \
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
  #
  # THE VERIFY LOOP IS FILTERED TO `--state=active`, AND THAT FILTER IS LOAD-
  # BEARING (final review, finding 6). `ccd/claude-session@.service` gained
  # StartLimitIntervalSec=120/StartLimitBurst=5, which made `failed` a state a
  # session unit can actually reach — before it, every unit ran the 10s default
  # window against RestartUSec=3s, so the limit was unreachable and a
  # crash-looping session looped invisibly for ever. `systemctl list-units`
  # INCLUDES failed units (per its own man page), and `try-restart` is a no-op
  # on one, so the unfiltered loop below handed verify-service.sh a unit that
  # was never restarted and could not be active: reproduced with a stubbed
  # systemctl — `DEPLOY FAILED — claude-session@boom.service did not come up
  # clean after restart`, exit 1, and `set -e` aborting the agent target AFTER
  # ccd, the units, the hooks and the agent are installed but BEFORE the
  # `ccd version` sha check. Every subsequent deploy then failed identically
  # until somebody cleared the unit by hand. A pre-existing failed session is
  # not this deploy's doing and must not fail it — but it must not be silent
  # either, so it is named first, with the remedy, on stderr.
  #
  # PRE-FLIGHT, AND IT IS THE POINT OF THE WHOLE BLOCK. This script copied the
  # unit file and daemon-reloaded a few lines up, in THIS run — so a bad edit is
  # already live and the next line would exercise it against every supervisor on
  # the box. systemd's DEFAULT KillMode is control-group, all 21 sessions are
  # children of ONE tmux server, and that server sits inside whichever
  # claude-session@ unit happened to create it: without KillMode=process the
  # sweep below is a fleet kill, not a restart.
  #
  # Same ordering principle the sweep's own placement already encodes ("after
  # the agent chain, so a broken agent fails the deploy before any supervisor is
  # touched") — one step earlier. `set -e` at the top of this file turns the
  # non-zero exit into an aborted deploy.
  #
  # IT ASKS SYSTEMD, IT DOES NOT GREP THE UNIT FILE (review finding). The first
  # cut of this guard ran `grep -qE "^KillMode=process$"` over
  # ~/.config/systemd/user/claude-session@.service — the BASE unit, which is a
  # PROXY for the effective value and not the value. systemd merges
  # `claude-session@.service.d/*.conf` on top of the base unit, THIS DEPLOY
  # copies such a drop-in (`limits.conf`, twenty lines up), and that drop-in
  # already carries a `[Service]` section: one `KillMode=control-group` line
  # added there passes a base-file grep untouched and still turns the sweep into
  # a fleet kill. `systemctl show` resolves the whole override chain — base,
  # drop-ins, lexical order, last wins — so it answers the question the guard is
  # actually asking. Comparing the full `KillMode=process` line (not `--value`,
  # which is systemd >=230 and needless here) makes an empty answer from a
  # failed call a refusal rather than a pass.
  #
  # EVERY UNIT THE SWEEP WOULD TOUCH, plus an uninstantiated instance of the
  # template. Drop-ins can be per-instance (`claude-session@<id>.service.d/`),
  # so the effective value is a property of each unit, not of the template; and
  # on a fresh box with no active session the loop would otherwise be empty and
  # check nothing at all, which is when a broken unit file is most likely.
  #
  # THE PRE-FLIGHT'S LISTING IS UNFILTERED, and that is the opposite decision
  # from the VERIFY loop's `--state=active` two lines below — deliberately, and
  # for the reason each loop exists. `--state=active` matches the ActiveState
  # `active` EXACTLY: `activating` and `deactivating` are their own values and
  # are absent from that listing. `try-restart` is not filtered that way — it
  # acts on any unit that is not inactive/failed, a unit still starting up
  # included. So a filtered pre-flight left a gap that neither half covered: the
  # loop could not see a unit in that state, and the trailing template probe
  # resolves the TEMPLATE and so cannot see a PER-INSTANCE drop-in on it. One
  # unit in that gap is enough — the tmux server every session on this box is a
  # child of sits in whichever claude-session@ cgroup created it.
  # This loop is a CONFIG gate, not a liveness check, so over-listing is the
  # cheap direction: the worst a `failed` unit (which try-restart skips) can do
  # here is refuse a deploy on a box whose unit config is already wrong, while
  # under-listing costs the fleet. The verify loop cannot be widened the same
  # way — handing verify-service.sh a unit that was never restarted is exactly
  # final review finding 6, above.
  # `claude-session@ccrc-deploy-preflight.service` is a CONFIG probe, not a
  # liveness probe — `systemctl show` reporting `LoadState=loaded` for an id
  # with no unit is exactly the trap the build4 ledger's F8 correction records,
  # and the reason this reads a property value and never infers existence from
  # it. Showing a template instance loads the unit read-only; it starts nothing.
  #
  # The cgroup print is INFORMATIONAL and non-fatal (`2>/dev/null`, and the echo
  # succeeds even when `pgrep` finds nothing): a box with no tmux server yet is
  # an ordinary fresh box, and refusing there would break the first deploy to a
  # new fleet host. What it buys is that the operator reading an abort — or a
  # successful sweep — sees the blast radius instead of inferring it.
  #
  # DOUBLE quotes around the pgrep pattern and no apostrophes in the refusal
  # message: this is a single-quoted assignment and bash has no escape for a
  # single quote inside one, so either would end SWEEP_CMD early and ship the
  # remainder as shell code in the deploy script itself.
  #
  # `pgrep -x`, NOT `pgrep -x -f`, and the difference is the whole line working
  # or silently printing nothing. `-f` matches the FULL COMMAND LINE, which for
  # the tmux server is `tmux start-server`; `-x` demands an exact match. Together
  # they ask for a command line exactly equal to `tmux: server`, which nothing
  # has. `-x` alone matches `comm`, which IS `tmux: server`. Measured both ways
  # on the fleet host 2026-08-18: `-x -f` returns empty, `-x` returns the server.
  # It shipped broken because the print is deliberately non-fatal, so an empty
  # answer looks the same as a fresh box with no server — the one case this
  # was written to tolerate hid the bug for the case it was written to serve.
  #
  # THE KillMode GUARD SURVIVES THE PLACEMENT FIX, and a reader who checks the
  # box will need this. Since D-303 (was D-B8-7) the server normally sits in
  # `ccrc-tmux-server.scope`, not in any `claude-session@` cgroup, so the
  # refusal above reads stale — but `_tmux_new_session` places the server only
  # when `systemd-run` is available and accepts, and its documented degraded
  # mode is a bare create in the caller's cgroup (a missing session is worse
  # than a misplaced one). That fallback is exactly the state this guard is
  # written for, and it is unobservable from here. Do not delete it because a
  # healthy box makes it look unnecessary.
  SWEEP_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && for u in $(systemctl --user list-units "claude-session@*" --plain --no-legend | awk "{print \$1}") claude-session@ccrc-deploy-preflight.service; do \
         km=$(systemctl --user show -p KillMode "$u" 2>/dev/null); \
         [ "$km" = "KillMode=process" ] \
           || { echo "deploy: FAILED — $u resolves to ${km:-no answer from systemd}, and the sweep needs KillMode=process. systemds default is control-group, and whenever the tmux server placement falls back to a bare create — no systemd-run, no D-Bus, or a scope name not yet collected — every session on this box is a child of ONE tmux server sitting in a claude-session@ cgroup, so try-restart would kill the lot. A drop-in under ~/.config/systemd/user/claude-session@.service.d/ can set this without the base unit changing a byte. REFUSING to sweep." >&2; exit 1; }; \
       done \
    && echo "deploy: the tmux server currently lives in: $(cat /proc/$(pgrep -x "tmux: server")/cgroup 2>/dev/null | tr "\n" " ")" >&2 \
    && systemctl --user try-restart "claude-session@*" \
    && for u in $(systemctl --user list-units "claude-session@*" --state=failed --plain --no-legend | awk "{print \$1}"); do \
         echo "deploy: warning: $u is FAILED — try-restart skipped it and this sweep did not verify it. On the box: systemctl --user reset-failed $u, then ccd start the session" >&2; done \
    && for u in $(systemctl --user list-units "claude-session@*" --state=active --plain --no-legend | awk "{print \$1}"); do \
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
  # 127.0.0.1. A reverse proxy in front is configured to forward to one
  # address and forwards there LITERALLY, so when that address is the box's
  # own rather than loopback, a loopback bind takes the PWA dark on every
  # device — and
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
  SERVER_ACCOUNTS_SH="$(mktemp)"
  "${SSH[@]}" "$BOX" 'cat ~/.ccrc/accounts.json' > "$BOX_ROSTER"
  # Generated to a FILE rather than /dev/null. The server never installs an
  # accounts.sh — it reads accounts.json directly — so this projection exists
  # only to be validated and fingerprinted. The fingerprint is the point: it is
  # the same value the agent lane prints for the fleet host, so two deploy runs
  # print two lines an operator can compare, and it is what the running server
  # computes for itself to compare against the agent's over the WS link.
  node deploy/gen-accounts.mjs "$BOX_ROSTER" > "$SERVER_ACCOUNTS_SH" \
    || { echo "deploy: FAILED — the roster at $BOX:~/.ccrc/accounts.json is not one ccrc can use (see above); the server would crash-loop on it" >&2; exit 1; }
  echo "roster fingerprint on $BOX: $(roster_fp "$SERVER_ACCOUNTS_SH")"
  rm -f "$BOX_ROSTER" "$SERVER_ACCOUNTS_SH"
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
  # `ccd` joins the SERVER lane's source list here, and it is not symmetry for
  # its own sake: `ccrc doctor` has to answer on this box too — it is how the
  # server reports its own fitness — and the ccrc launcher installed below runs
  # ~/ccrc/ccd/ccrc, which does not exist unless that tree ships. Nothing on
  # the server INSTALLS anything out of it (no ccd, no session hooks; those are
  # the agent lane's); it is the four ccrc files' home, shipped whole so they
  # can never be half a version apart.
  rsync -az --delete -e "${SSH[*]}" --exclude node_modules --exclude dist --exclude '*.env' \
    --exclude 'ccrc-mail.token' \
    server shared deploy ccd "$BOX":ccrc/
  ship_env ccrc.env .ccrc/ccrc.env
  ship_secret ccrc-mail.token '~/.ccrc' mail.token
  # Same ordering class as the agent lane's: after the roster (`ship_roster`,
  # above), after the rsync that lands the tree it launches, and before the
  # build/restart chain that can abort the deploy. The helper is not named in
  # this comment for the reason the agent lane's twin records.
  install_ccrc_shim
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
    && curl -fsS '"$BOX_HEALTH_URL"
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
