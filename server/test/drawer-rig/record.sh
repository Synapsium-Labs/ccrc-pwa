#!/usr/bin/env bash
# record.sh — host driver and in-container recorder for the terminal drawer
# capture rig (spec docs/superpowers/specs/2026-10-14-terminal-drawer-every-width-design.md
# §9, plan docs/superpowers/plans/2026-10-14-terminal-drawer-every-width-stage1.md
# Task 6, D-5006).
#
# Records six 220x51 attach-stream / 220x50 capture-pane pairs from real Claude
# Code screens driven by a scripted mock API, a fixture HOME and a fixture repo
# under /rig. The recordings feed the PWA terminal drawer's model and re-wrap
# tests. NEVER run in CI; needs docker, network (apt + nodejs.org + npm), about
# 3 GB of tmpfs RAM, and the cache directory. The captures are SYNTHETIC — no
# live session, no host HOME, no default tmux server, no permission bypass.
#
#   bash server/test/drawer-rig/record.sh [--cc-version X.Y.Z] [--node-version X.Y.Z] [--cache DIR] [--keep] [--dry-run] [<scenario>...]
#   bash server/test/drawer-rig/record.sh --help
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TREE=$(cd "$HERE/../../.." && pwd)

CC_VERSION=2.1.299
NODE_VERSION=22.23.3
NODE_PTY_VERSION=1.1.0
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/ccrc-drawer-rig

VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+$'
SCENARIO_RE='^[a-z0-9-]{1,40}$'

die() { printf 'record: %s\n' "$*" >&2; exit 2; }

usage() {
  sed -n '2,15p' "$0" >&2
  printf '\nusage: %s [--cc-version X.Y.Z] [--node-version X.Y.Z] [--cache DIR] [--keep] [--dry-run] [<scenario>...]\n' "$0" >&2
  printf '       %s --help\n' "$0" >&2
}

# ── host role ─────────────────────────────────────────────────────────────────

cmd_host() {
  local scenarios=() keep=0 dry=0
  while (( $# )); do
    case $1 in
      --cc-version)
        shift; [[ ${1:-} =~ $VERSION_RE ]] || die "bad --cc-version '$1'"
        CC_VERSION=$1 ;;
      --node-version)
        shift; [[ ${1:-} =~ $VERSION_RE ]] || die "bad --node-version '$1'"
        NODE_VERSION=$1 ;;
      --cache)
        shift; CACHE=${1:-}; [[ -n $CACHE ]] || die "--cache needs a directory" ;;
      --keep) keep=1 ;;
      --dry-run) dry=1 ;;
      --help) usage; exit 0 ;;
      --*) die "unknown option '$1'" ;;
      -*) die "unknown option '$1'" ;;
      *)
        [[ $1 =~ $SCENARIO_RE ]] || die "bad scenario name '$1'"
        [[ -f $HERE/scenarios/$1.json ]] || die "no scenario file for '$1'"
        scenarios+=("$1") ;;
    esac
    shift
  done

  if (( ${#scenarios[@]} == 0 )); then
    for f in "$HERE"/scenarios/*.json; do
      [[ -f $f ]] || continue
      scenarios+=("$(basename "$f" .json)")
    done
    mapfile -t scenarios < <(printf '%s\n' "${scenarios[@]}" | sort)
  fi
  (( ${#scenarios[@]} )) || die "no scenarios found"

  # Validate every selected scenario before touching disks or docker.
  for s in "${scenarios[@]}"; do
    node "$HERE/drive.mjs" --check "$HERE/scenarios/$s.json" || die "scenario '$s' failed validation"
  done

  # Refuse a cache inside the source tree (it is bind-mounted into the container). An absent cache is judged
  # by its parent, so a dry run makes nothing.
  local cache_phys tree_phys
  tree_phys=$(cd -P -- "$TREE" && pwd) || die "cannot resolve tree '$TREE'"
  if [[ -d $CACHE ]]; then cache_phys=$(cd -P -- "$CACHE" && pwd) || die "cannot resolve --cache '$CACHE'"
  else cache_phys=$(cd -P -- "$(dirname -- "$CACHE")" 2>/dev/null && pwd)/$(basename -- "$CACHE") || die "cannot resolve --cache '$CACHE'"; fi
  [[ $cache_phys != "$tree_phys" && $cache_phys != "$tree_phys"/* ]] || die "refusing --cache inside the source tree"

  if (( dry )); then
    printf 'record: dry run: nothing is made and nothing is run\n'
    printf 'record: 1. mktemp -d %s/ccrc-drawer-raw.XXXXXX  (<work>)\n' "${TMPDIR:-/tmp}"
    printf 'record: 2. docker run --rm --hostname rig --tmpfs /tmp:exec,size=1g --tmpfs /rig:exec,size=2g -v %s:/rig/cache -v %s:/rig/src/drawer-rig:ro -v %s:/rig/src/mockapi.mjs:ro -v %s:/rig/src/tmux.conf:ro -v <work>/raw:/rig/out -e CC_VERSION=%s -e NODE_VERSION=%s -e NODE_PTY_VERSION=%s -e RIG_UID=%s -e RIG_GID=%s -e RIG_SCENARIOS=%q ubuntu:24.04 bash /rig/src/drawer-rig/record.sh --in-container\n' \
      "$cache_phys" "$HERE" "$TREE/server/test/delegation-rig/mockapi.mjs" "$TREE/ccd/tmux.conf" "$CC_VERSION" "$NODE_VERSION" "$NODE_PTY_VERSION" "$(id -u)" "$(id -g)" "${scenarios[*]}"
    printf 'record: 3. node %s --scan <work>/raw   (any finding refuses the whole run; nothing is copied)\n' "$TREE/server/test/delegation-rig/sanitize.mjs"
    printf 'record: 4. copy <work>/raw/%s/{%s}.json -> pwa/test/fixtures/drawer/recorded/%s/\n' "$CC_VERSION" "$(IFS=,; printf '%s' "${scenarios[*]}")" "$CC_VERSION"
    printf 'record: 5. node %s --scan pwa/test/fixtures/drawer/recorded\n' "$TREE/server/test/delegation-rig/sanitize.mjs"
    exit 0
  fi
  mkdir -p -- "$CACHE"

  command -v docker >/dev/null 2>&1 || die "record.sh needs docker (a container runtime)"

  local WORK
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-drawer-raw.XXXXXX") || die "mktemp failed"
  local work_phys
  work_phys=$(cd -P -- "$WORK" && pwd) || die "cannot resolve work dir '$WORK'"
  [[ $work_phys != "$tree_phys" && $work_phys != "$tree_phys"/* ]] || die "refusing work dir inside the source tree"
  mkdir -p "$WORK/raw"

  export CC_VERSION NODE_VERSION NODE_PTY_VERSION
  local RIG_SCENARIOS="${scenarios[*]}"

  # Run the container foreground, teeing its output to the log. Preserve docker's
  # exit status through the pipe with PIPESTATUS.
  local docker_status=0
  docker run --rm --hostname rig --name "ccrc-drawer-rig-$$" \
    --tmpfs /tmp:exec,size=1g \
    --tmpfs /rig:exec,size=2g \
    -v "$CACHE":/rig/cache \
    -v "$HERE":/rig/src/drawer-rig:ro \
    -v "$TREE/server/test/delegation-rig/mockapi.mjs":/rig/src/mockapi.mjs:ro \
    -v "$TREE/ccd/tmux.conf":/rig/src/tmux.conf:ro \
    -v "$WORK/raw":/rig/out \
    -e CC_VERSION -e NODE_VERSION -e NODE_PTY_VERSION \
    -e RIG_UID="$(id -u)" -e RIG_GID="$(id -g)" \
    -e RIG_SCENARIOS="$RIG_SCENARIOS" \
    ubuntu:24.04 bash /rig/src/drawer-rig/record.sh --in-container 2>&1 | tee -a "$WORK/record.log"
  docker_status=${PIPESTATUS[0]}

  if (( docker_status != 0 )); then
    printf 'record: the recording failed (exit %d); the raw root %s is kept\n' "$docker_status" "$WORK" >&2
    exit 1
  fi

  for s in "${scenarios[@]}"; do
    [[ -f $WORK/raw/$CC_VERSION/$s.json ]] || die "missing output for scenario '$s'"
  done

  # Fail-closed residue scan before anything enters the tree.
  if ! node "$TREE/server/test/delegation-rig/sanitize.mjs" --scan "$WORK/raw"; then
    printf 'record: the run is REFUSED WHOLE — nothing is patched or rewritten.\n' >&2
    printf 'record: fix the scenario and re-record; the raw root %s is kept for inspection and must never be committed.\n' "$WORK" >&2
    exit 1
  fi

  local DEST="$TREE/pwa/test/fixtures/drawer/recorded/$CC_VERSION"
  mkdir -p "$DEST"
  for s in "${scenarios[@]}"; do
    cp "$WORK/raw/$CC_VERSION/$s.json" "$DEST/"
  done

  # Scan the committed corpus.
  if ! node "$TREE/server/test/delegation-rig/sanitize.mjs" --scan "$TREE/pwa/test/fixtures/drawer/recorded"; then
    exit 1
  fi

  if (( keep )); then
    printf 'record: kept raw root: %s\n' "$WORK"
  else
    rm -rf "$WORK"
  fi

  printf 'record: written fixtures:\n'
  for s in "${scenarios[@]}"; do
    printf '  pwa/test/fixtures/drawer/recorded/%s/%s.json\n' "$CC_VERSION" "$s"
  done
  printf 'record: read every byte under pwa/test/fixtures/drawer/recorded/ before committing (the residue review).\n'
}

# ── container role ────────────────────────────────────────────────────────────

cmd_in_container() {
  # Only root inside the rig container may run this, and the bind-mounted scripts
  # must be present.
  [[ $(id -u) -eq 0 ]] || die "--in-container must run as root"
  [[ -f /rig/src/drawer-rig/drive.mjs ]] || die "drive.mjs is not bind-mounted"
  [[ -n ${RIG_UID:-} && -n ${RIG_GID:-} && -n ${RIG_SCENARIOS:-} ]] || die "missing RIG_UID / RIG_GID / RIG_SCENARIOS"

  export DEBIAN_FRONTEND=noninteractive

  # apt's lists and archives live on the container's tmpfs, and apt runs as root: measured on a docker VM whose
  # disk was full for unprivileged writers, the default `_apt` sandbox user could not write its downloads and apt
  # reported "At least one invalid signature was encountered". The packages: tmux 3.4 (the fleet's), git for the
  # fixture repo, g++/make/python3 for node-pty's build, curl for Node, libfaketime for the clock.
  mkdir -p /tmp/apt/lists/partial /tmp/apt/archives/partial
  apt-get update -qq \
    -o APT::Sandbox::User=root \
    -o Dir::State::Lists=/tmp/apt/lists \
    -o Dir::Cache::Archives=/tmp/apt/archives
  apt-get install -y -qq \
    -o APT::Sandbox::User=root \
    -o Dir::State::Lists=/tmp/apt/lists \
    -o Dir::Cache::Archives=/tmp/apt/archives \
    --no-install-recommends \
    tmux git g++ make python3 curl ca-certificates faketime

  # Create an unprivileged user whose uid/gid match the host user, so cache files
  # stay owned by the host user.
  groupadd -o -g "$RIG_GID" rig 2>/dev/null || true
  useradd -o -u "$RIG_UID" -g "$RIG_GID" -M -d /rig/home -s /bin/bash rig

  # libfaketime's path is per architecture; tmux's version goes into every fixture.
  local arch faketime_lib tmux_version
  arch=$(dpkg --print-architecture)
  case $arch in
    arm64) NODE_ARCH=arm64 ;;
    amd64) NODE_ARCH=x64 ;;
    *) die "unsupported architecture '$arch'" ;;
  esac
  faketime_lib=$(dpkg -L libfaketime | grep '/libfaketime\.so\.1$' | head -n1)
  [[ -n $faketime_lib ]] || die "libfaketime.so.1 not found"
  tmux_version=$(tmux -V)

  # Node 22 (Ubuntu's apt has an older one), from nodejs.org, checked against its SHASUMS256.txt, installed as
  # `rig`, whose uid is the host user's, so the bind-mounted cache stays the host user's.
  local NODE_TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"
  local NODE_DIR="/rig/cache/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
  local NODE_BIN="${NODE_DIR}/bin"
  if [[ ! -x ${NODE_BIN}/node ]]; then
    # shellcheck disable=SC2016
    /usr/sbin/runuser -u rig -- env -i PATH=/usr/bin:/bin HOME=/rig/home LANG=C.UTF-8 LC_ALL=C.UTF-8 bash -c '
      set -euo pipefail
      cd /tmp
      curl -fsSL -o "$1" "https://nodejs.org/dist/v$2/$1"
      curl -fsSL "https://nodejs.org/dist/v$2/SHASUMS256.txt" | grep " $1$" | sha256sum -c -
      tar -xzf "/tmp/$1" -C /rig/cache
    ' -- "$NODE_TARBALL" "$NODE_VERSION"
  fi
  [[ -x ${NODE_BIN}/node ]] || die "node did not install"

  # Claude Code at the version under test, and node-pty (the server's version; it compiles here), cached.
  local CLAUDE_PREFIX="/rig/cache/claude-code-${CC_VERSION}"
  local CLAUDE_BIN="${CLAUDE_PREFIX}/node_modules/.bin/claude"
  local NODE_PTY_PREFIX="/rig/cache/node-pty-${NODE_PTY_VERSION}-node${NODE_VERSION}"

  npm_as_rig() {
    /usr/sbin/runuser -u rig -- env -i \
      PATH="${NODE_BIN}:/usr/bin:/bin" \
      HOME=/rig/home \
      LANG=C.UTF-8 LC_ALL=C.UTF-8 \
      npm_config_cache=/rig/cache/npm-cache \
      npm_config_devdir=/rig/cache/node-gyp \
      npm_config_update_notifier=false \
      npm_config_fund=false \
      npm_config_audit=false \
      "$@"
  }

  if [[ ! -x ${CLAUDE_BIN} ]]; then
    npm_as_rig npm install --prefix "$CLAUDE_PREFIX" "@anthropic-ai/claude-code@${CC_VERSION}"
  fi
  if [[ ! -d ${NODE_PTY_PREFIX}/node_modules/node-pty ]]; then
    npm_as_rig npm install --prefix "$NODE_PTY_PREFIX" "node-pty@${NODE_PTY_VERSION}"
  fi

  # Verify the Claude Code version before spending time recording.
  local installed_version
  installed_version=$(/usr/sbin/runuser -u rig -- env -i PATH="${NODE_BIN}:/usr/bin:/bin" HOME=/rig/home "$CLAUDE_BIN" --version | head -n1)
  [[ $installed_version == "$CC_VERSION "* ]] || die "claude --version is '$installed_version', expected '$CC_VERSION *'"

  local failed=0
  for name in $RIG_SCENARIOS; do
    # Seed a fresh fixture HOME and repo for every scenario.
    # drive.mjs waits for its Claude Code to exit; a late write can still race the removal, so retry it.
    for _ in 1 2 3 4 5 6 7 8 9 10; do rm -rf /rig/home /rig/project-a /rig/run 2>/dev/null && break; sleep 0.5; done
    [[ ! -e /rig/home && ! -e /rig/project-a && ! -e /rig/run ]] || die "cannot clear the previous scenario's /rig/home"
    mkdir -p /rig/run /rig/home/.claude /rig/project-a/src
    chown -R rig:rig /rig/run /rig/home /rig/project-a

    # A key-SHAPED placeholder, built at run time, written 0600, never into the tree and never onto an argv
    # (the pane's shell reads it); the mock ignores it. As the delegation rig's `rig_key`.
    ( umask 077; printf 'sk-ant-api03-%sAA' "$(printf 'r%.0s' $(seq 93))" > /rig/run/key )
    chown rig:rig /rig/run/key
    chmod 0600 /rig/run/key

    # Fixture repo with one commit.
    run_git() {
      /usr/sbin/runuser -u rig -- env -i PATH=/usr/bin:/bin HOME=/rig/home GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -C /rig/project-a "$@"
    }
    run_git init -q -b main
    run_git config user.name 'Rig Fixture'
    run_git config user.email 'you@example.com'
    run_git config commit.gpgsign false

    cat > /rig/project-a/README.md <<'EOF'
# project-a

A small synthetic project for the drawer rig.
EOF
    cat > /rig/project-a/src/app.ts <<'EOF'
export function greet(name: string): string {
  return `hello, ${name}`;
}
EOF
    cat > /rig/project-a/package.json <<'EOF'
{
  "name": "project-a",
  "version": "0.0.0",
  "private": true
}
EOF
    chown -R rig:rig /rig/project-a
    /usr/sbin/runuser -u rig -- env -i PATH=/usr/bin:/bin HOME=/rig/home GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z bash -c 'git -C /rig/project-a add -A && git -C /rig/project-a commit -q -m "fixture: initial commit"'

    # Measured on 2.1.299: the alternate screen the fleet's panes are on (spec W1) comes only from the fullscreen
    # renderer for a seeded config (`tui`), and without `hasSeenAutoDefaultNudge` an auto-mode dialog opens
    # first. No permission bypass anywhere, and nothing allowed: the permission and Write prompts must show.
    # The model is Claude Code's default; a scenario may name another (`model`, which drive.mjs passes as
    # `--model`): see THE EFFORT HINT in drive.mjs.
    cat > /rig/home/.claude/settings.json <<'EOF'
{"env":{"DISABLE_AUTOUPDATER":"1"},"tui":"fullscreen","permissions":{"defaultMode":"default","allow":[]}}
EOF
    local key_tail
    key_tail=$(tail -c 20 /rig/run/key)
    "${NODE_BIN}/node" - "$key_tail" "$CC_VERSION" > /rig/home/.claude/.claude.json <<'EOF'
const [,, tail, cc] = process.argv;
const o = {
  numStartups: 5,
  hasCompletedOnboarding: true,
  firstStartTime: '2026-01-01T00:00:00.000Z',
  lastOnboardingVersion: cc,
  lastReleaseNotesSeen: cc,
  lastClawdEntranceVersion: cc,
  fullscreenUpsellSeenCount: 3,
  hasSeenAutoDefaultNudge: true,
  officialMarketplaceAutoInstallAttempted: true,
  customApiKeyResponses: { approved: [tail], rejected: [] },
  projects: {
    '/rig/project-a': {
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
      projectOnboardingSeenCount: 5,
      allowedTools: []
    }
  }
};
process.stdout.write(JSON.stringify(o) + '\n');
EOF
    chown -R rig:rig /rig/home

    # Run the scenario as rig with a clean environment.
    if ! /usr/sbin/runuser -u rig -- env -i \
      PATH="${NODE_BIN}:/usr/bin:/bin" \
      HOME=/rig/home \
      LANG=C.UTF-8 \
      LC_ALL=C.UTF-8 \
      RIG_CLAUDE="$CLAUDE_BIN" \
      RIG_NODE_PTY="$NODE_PTY_PREFIX" \
      RIG_FAKETIME_LIB="$faketime_lib" \
      RIG_CC_VERSION="$CC_VERSION" \
      RIG_TMUX_VERSION="$tmux_version" \
      node /rig/src/drawer-rig/drive.mjs "/rig/src/drawer-rig/scenarios/${name}.json" "/rig/out/${CC_VERSION}/${name}.json"; then
      printf 'record: scenario %s failed\n' "$name" >&2
      failed=1
    fi
  done

  return "$failed"
}

case ${1:-} in
  --help|-h) usage; exit 0 ;;
  --in-container) shift; cmd_in_container "$@" ;;
  *) cmd_host "$@" ;;
esac
