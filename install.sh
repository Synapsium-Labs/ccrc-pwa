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
CCRC_RELEASE_OWNER="example-org"
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

  STAGING="$(mktemp -d)"
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
  ( cd "$STAGING" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ) \
    || { echo "install.sh: checksum verification FAILED for $TARNAME — refusing to extract or install" >&2; exit 1; }

  mkdir "$STAGING/tree"
  tar -xzf "$STAGING/$TARNAME" -C "$STAGING/tree"
  echo "install.sh: verified $TARNAME — handing off to the staged 'ccrc install'"
  trap - EXIT
  exec bash "$STAGING/tree/ccd/ccrc" install "$@"
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

exec bash "$ROOT/ccd/ccrc" install
