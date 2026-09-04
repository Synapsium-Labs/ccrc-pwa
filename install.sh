#!/usr/bin/env bash
# install.sh — the bootstrap, two modes, one script (stage 4, spec §3):
#   - CHECKOUT mode (default, stage 2's, unchanged): build from this
#     checkout, then hand off to `ccrc install` (ccd/ccrc), which owns every
#     converge decision.
#   - RELEASE mode (`--release [vX.Y.Z]`): download the CI-built tarball +
#     SHA256SUMS from GitHub Releases (latest, or the named tag), verify
#     `sha256sum -c`, extract to a staging dir, and hand off to the STAGED
#     `ccrc install` — no build step on the box, prebuilt dists ship in the
#     tarball. Everything after `--release [tag]` passes through to the
#     staged verb verbatim (`--role …` rides here).
# Neither mode touches ~/.ccrc, ~/.local/bin or systemd — bootstrap
# builds/fetches, the verb installs. Re-running is safe: npm ci and the
# builds are idempotent and the verb converges.
set -euo pipefail
HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}" && pwd)"

# ── The release identity — ONE owner/repo pair, spelled nowhere else.
# Stage 5 de-brands it. `CCRC_RELEASE_BASE_URL` overrides the derived
# `…/releases` prefix — the deliberate test seam, and an escape hatch for a
# mirror.
CCRC_RELEASE_OWNER="Synapsium-Labs"
CCRC_RELEASE_REPO="ccrc-pwa"

usage() { echo "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)"; }

# `cmd_install`'s own loop (ccd/ccrc:1619-1624), one layer up: an install that
# half-ran because argument 2 was a typo is worse than one that did not
# start, and install.sh is now the OUTERMOST entry point a new operator
# types — so it must refuse an argument it does not understand rather than
# silently discard it and run a full install anyway. `--release` breaks out:
# every later argument belongs to the staged `ccrc install`, whose own loop
# applies the same discipline one layer down.
RELEASE_MODE=false
RELEASE_TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --release)
      RELEASE_MODE=true; shift
      if [ $# -gt 0 ] && [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then RELEASE_TAG="$1"; shift; fi
      break ;;
    *) echo "install.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$RELEASE_MODE" = true ]; then
  command -v curl >/dev/null 2>&1 \
    || { echo "install.sh: curl is not installed — install curl, then re-run" >&2; exit 1; }
  BASE="${CCRC_RELEASE_BASE_URL:-https://github.com/$CCRC_RELEASE_OWNER/$CCRC_RELEASE_REPO/releases}"
  if [ -n "$RELEASE_TAG" ]; then URL_DIR="$BASE/download/$RELEASE_TAG"; else URL_DIR="$BASE/latest/download"; fi

  # AN EXPLICIT TEMPLATE, because BSD `mktemp` IGNORES `$TMPDIR` when given
  # none — measured: macOS answers inside its own per-user Darwin temp dir
  # while GNU honours the variable. This is the directory a release tarball is
  # downloaded and extracted into, so an operator who points TMPDIR at a volume
  # with room, or at a directory they control, must not be silently overruled.
  STAGING="$(mktemp -d "${TMPDIR:-/tmp}/ccrc.XXXXXXXXXX")"
  # `|| :` — the fixture harness PATH may lack rm; a failed cleanup must
  # never override the refusal's own exit code (set -e in an EXIT trap does).
  trap 'rm -rf "$STAGING" 2>/dev/null || :' EXIT
  # Every refusal below exits through this trap, so a failed or TAMPERED
  # download never lingers in /tmp; the success path disarms it right before
  # the exec — the staged tree must outlive install.sh exactly then.
  # `|| :` — the fixture harness PATH may lack rm; a failed cleanup must
  # never override the refusal's own exit code (set -e in an EXIT trap does).
  # SHA256SUMS first: under `latest/` the tag is unknown until the sums file
  # names the tarball. A missing release is curl's own failure, surfaced —
  # `-f` turns the 404 into exit 22 and the message below names the URL.
  echo "install.sh: fetching $URL_DIR/SHA256SUMS …"
  curl -fsSL -o "$STAGING/SHA256SUMS" "$URL_DIR/SHA256SUMS" \
    || { echo "install.sh: download failed: $URL_DIR/SHA256SUMS (is there a release?)" >&2; exit 1; }
  read -r _sum TARNAME < "$STAGING/SHA256SUMS" \
    || { echo "install.sh: SHA256SUMS is empty — refusing" >&2; exit 1; }
  TARNAME="${TARNAME#\*}"
  case "$TARNAME" in
    ccrc-*.tar.gz) ;;
    *) echo "install.sh: SHA256SUMS names no ccrc tarball (got: $TARNAME) — refusing" >&2; exit 1 ;;
  esac
  echo "install.sh: fetching $URL_DIR/$TARNAME …"
  curl -fsSL -o "$STAGING/$TARNAME" "$URL_DIR/$TARNAME" \
    || { echo "install.sh: download failed: $URL_DIR/$TARNAME" >&2; exit 1; }

  # Verify BEFORE extracting: a tarball that fails its checksum never gets
  # to put a single file on disk, let alone run one.
  #
  # THE DIGEST TOOL IS CHOSEN BY PLATFORM, the same two-line shim
  # `deploy/build-release.sh` uses (BR_SHA256), because this file is the
  # bootstrap and can source nothing: `_plat_sha256_check` lives inside the
  # tarball that has not been verified yet. `sha256sum` is GNU coreutils and
  # macOS does not ship it — and because the check swallows its own stderr,
  # a missing tool exits the subshell 127 and lands in the `||` arm: the
  # first thing a macOS operator ever saw from ccrc was a FABRICATED
  # supply-chain accusation about an intact download. `shasum -a 256 -c`
  # reads the GNU-written two-space SHA256SUMS unchanged (measured against
  # the published release). Unquoted on use, so the two words split.
  SUM=sha256sum
  [ "$(uname -s 2>/dev/null)" = Darwin ] && SUM="shasum -a 256"
  ( cd "$STAGING" && $SUM -c SHA256SUMS >/dev/null 2>&1 ) \
    || { echo "install.sh: checksum verification FAILED for $TARNAME — refusing to extract or install" >&2; exit 1; }

  mkdir "$STAGING/tree"
  tar -xzf "$STAGING/$TARNAME" -C "$STAGING/tree"
  echo "install.sh: verified $TARNAME — handing off to the staged 'ccrc install'"
  trap - EXIT
  exec bash "$STAGING/tree/ccd/ccrc" install "$@"
fi

# ── macOS PREFLIGHT, BEFORE THE BUILD ────────────────────────────────────
# `ccrc install` checks these too, and checks them again for a reason — it is
# also reached from `--release`, which never runs this file's build. But this
# script is the documented entry point, and the two minutes of `npm ci` and a
# vite build sit between here and there: a box that cannot run ccd should
# learn it now, not after paying for a bundle it will not use.
#
# AND THIS SCRIPT IS THE ONLY PLACE THE BASH CHECK CAN LIVE AT ALL. macOS
# ships bash 3.2.57 (2007, GPLv2) as /bin/bash, and `ccd` needs 4.4+ — it uses
# `local -A`, `[[ -v arr[k] ]]`, `mapfile`, BASHPID, and (the fact that sets
# the floor at 4.4, not 4.2) empty-array "${a[@]}" expansions under `set -u`,
# which bash treated as a fatal unbound variable until 4.4 relaxed it. A 3.2
# box running `ccd` gets a SYNTAX ERROR at a line number, mid-session, after
# a pane has already been started; a 4.2/4.3 box dies at the first empty
# array instead. install.sh itself is deliberately written to the 3.2
# subset so that this refusal is the thing that runs.
if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
  bmaj="${BASH_VERSINFO[0]:-0}"; bmin="${BASH_VERSINFO[1]:-0}"
  if [ "$bmaj" -lt 4 ] || { [ "$bmaj" -eq 4 ] && [ "$bmin" -lt 4 ]; }; then
    echo "install.sh: bash $bmaj.$bmin is too old — ccd needs 4.4 or newer, and macOS ships 3.2.57 as /bin/bash for licensing reasons." >&2
    echo "install.sh: fix it with:  brew install bash    (then make sure /opt/homebrew/bin comes before /bin on PATH, and re-run this script)" >&2
    exit 1
  fi
  for t in tmux flock; do
    command -v "$t" >/dev/null 2>&1 || {
      echo "install.sh: $t is required by ccrc and macOS does not ship it — install it: brew install $t" >&2
      exit 1
    }
  done
fi

command -v node >/dev/null 2>&1 || { echo "install.sh: node is not installed — install Node (nodesource or nvm), then re-run" >&2; exit 1; }
# The floor is READ from the shipped package.json — never a second copy
# (node-floor.test.ts pins the three package.jsons identical; the server does
# not degrade below it, it fails to boot on node:sqlite).
floor="$(node -e 'process.stdout.write(require(process.argv[1]).engines.node)' "$ROOT/server/package.json" 2>/dev/null)" \
  || { echo "install.sh: cannot read engines.node from $ROOT/server/package.json — is this a complete checkout?" >&2; exit 1; }
node -e '
const floor = process.argv[1].replace(/^>=/,"").trim();
const cur = process.versions.node;
const at = s => s.split(".").map(Number);
const [a,b,c] = at(cur), [x,y,z] = at(floor);
const ok = a>x || (a===x && (b>y || (b===y && c>=z)));
if (!ok) { console.error(`install.sh: node ${cur} is below the required ${floor}`); process.exit(1); }
' "$floor" || exit 1

echo "install.sh: building (server deps, PWA bundle, server dist)…"
( cd "$ROOT/server" && npm ci --no-audit --no-fund )
( cd "$ROOT/pwa" && npm ci --no-audit --no-fund && npm run build )
( cd "$ROOT/server" && npm run build )
# D-1159: the agent is the FOURTH artifact `ccrc install` refuses without, for
# every role but `server` — `ccrc-agent.service` runs
# `agent/dist/agent/src/index.js`. It is built unconditionally here because this
# script does not know the role: `--role` rides on the staged verb, and for a
# source install it is not passed at all (the verb's own default is `both`,
# which needs an agent). Building it for a server-only box costs one tsc run;
# NOT building it cost a live fleet its agent.
( cd "$ROOT/agent" && npm ci --no-audit --no-fund && npm run build )

exec bash "$ROOT/ccd/ccrc" install
