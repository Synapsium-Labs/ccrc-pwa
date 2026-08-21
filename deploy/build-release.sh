#!/usr/bin/env bash
# build-release.sh — the release pipeline's testable core (stage 4, spec §2).
#
# Builds ONE tarball, `ccrc-<version>.tar.gz`, holding the matched set a box
# installs from — prebuilt dists, the three package.json+lock pairs (for
# `npm ci --omit=dev` on the box), `shared/`, `ccd/`, `deploy/`'s units and
# helpers, `install.sh` — plus a MANIFEST (per-file sha256, verified by
# `ccrc update` after extraction) inside it and `SHA256SUMS` (sha256sum -c
# compatible, guards transport) beside it. CI (`release.yml`) merely invokes
# this script: no logic lives in YAML that the script doesn't own, and every
# promise the artifact makes is testable locally (build-release.test.ts).
#
# Two refusals, both BEFORE anything is written or built:
#   - a dirty tree (`git status --porcelain` non-empty): a release is built
#     from a commit, not from whatever the working tree holds this afternoon.
#     This is where deploy.sh:78's "stage 4's release pipeline will [forbid
#     it]" promise lands.
#   - an untagged HEAD, unless --untagged: the version IS the tag (`vX.Y.Z`,
#     the same shape both build.json stampers recognise — deploy.sh:90,
#     ccd/ccrc's `_inst_stamp`). `--untagged` names the artifact
#     `untagged-<shortsha>` instead; CI never passes it.
#
# The tracked set is staged via `git archive HEAD` — tracked content ONLY, so
# a gitignored secret (deploy/ccrc-mail.token lives in this very directory on
# a live box) can never ride into a release, no matter what the working tree
# holds. The dists are build output, not tracked files, so they are copied in
# after the archive. The tar flags (--sort=name --mtime=@0 --owner=0
# --group=0, gzip -n) make the bytes reproducible-ish — same commit, same
# artifact — and are pinned by a test so a casual edit cannot silently make
# artifacts unstable.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/build-release.sh [--untagged] [--out <dir>] — build ccrc-<version>.tar.gz + SHA256SUMS from a clean, tagged checkout"; }
die() { echo "build-release.sh: $*" >&2; exit 1; }

# install.sh's argument discipline, one release up: this is an entry point an
# operator types, so an argument it does not understand is a refusal, never a
# silent discard followed by a full build.
ALLOW_UNTAGGED=false
OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --untagged) ALLOW_UNTAGGED=true; shift ;;
    --out)
      [ $# -ge 2 ] || { echo "build-release.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    *) echo "build-release.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ── The two refusals, before anything is written ──────────────────────────
# `--porcelain` includes UNTRACKED files deliberately: an untracked straggler
# is exactly the thing that must not decide what a release contains — and
# `git archive` below would silently omit it, shipping a tarball that differs
# from what the builder was looking at.
[ -z "$(git -C "$ROOT" status --porcelain)" ] \
  || die "refusing a dirty tree — a release is built from a commit; commit or stash, then re-run (git status --porcelain is non-empty)"

# The tag derivation is deploy.sh:90's, verbatim: only the release shape
# qualifies (a `wip` tag at HEAD is not an identity claim), and grep exiting
# 1 on no match is the ordinary case — hence the `|| TAG=""` keeping
# `set -e` out of it.
TAG="$(git -C "$ROOT" tag --points-at HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1)" || TAG=""
if [ -n "$TAG" ]; then
  VERSION="$TAG"
elif [ "$ALLOW_UNTAGGED" = true ]; then
  VERSION="untagged-$(git -C "$ROOT" rev-parse --short HEAD)"
else
  die "HEAD carries no vX.Y.Z tag — tag the release (git tag vX.Y.Z), or pass --untagged for a dev artifact"
fi

[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"

# ── Build all three packages — the RELEASE machine builds, boxes don't ────
# (E2: a box's install/update lane is `npm ci --omit=dev`, no compiler.)
# The pwa build lands in server/dist-pwa (vite outDir), same as deploy.sh's
# lane; the artifact checks after the builds refuse BY ARTIFACT, because a
# green npm exit is a promise and the file on disk is a fact.
echo "build-release.sh: building $VERSION (server, PWA, agent)…"
( cd "$ROOT/server" && npm ci --no-audit --no-fund && npm run build )
( cd "$ROOT/pwa"    && npm ci --no-audit --no-fund && npm run build )
( cd "$ROOT/agent"  && npm ci --no-audit --no-fund && npm run build )
[ -f "$ROOT/server/dist/server/src/index.js" ] \
  || die "no server build at $ROOT/server/dist after npm run build"
[ -f "$ROOT/server/dist-pwa/index.html" ] \
  || die "no PWA bundle at $ROOT/server/dist-pwa after npm run build"
[ -d "$ROOT/agent/dist" ] \
  || die "no agent build at $ROOT/agent/dist after npm run build"

# ── Stage the matched set ─────────────────────────────────────────────────
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
TOP="$STAGE/tree"
mkdir -p "$TOP"

# Tracked content only (see header). The pathspec is spec §2's layout: a path
# missing from HEAD makes git archive fail loudly, which is an incomplete
# checkout refusing rather than a thinner tarball shipping.
git -C "$ROOT" archive --format=tar HEAD -- \
  install.sh shared ccd deploy \
  server/package.json server/package-lock.json \
  agent/package.json agent/package-lock.json \
  pwa/package.json pwa/package-lock.json \
  | tar -x -C "$TOP"

cp -a "$ROOT/server/dist"     "$TOP/server/dist"
cp -a "$ROOT/server/dist-pwa" "$TOP/server/dist-pwa"
cp -a "$ROOT/agent/dist"      "$TOP/agent/dist"

# ── MANIFEST: every file, per-file sha256 ─────────────────────────────────
# Generated OUTSIDE the tree then moved in, so `find` can never race its own
# output; `LC_ALL=C sort` so the line order is a property of the set, not of
# the builder's locale. The outer checksum (SHA256SUMS) guards transport; this
# guards the set after extraction (`ccrc update` runs `sha256sum -c MANIFEST`
# in the staging dir).
( cd "$TOP" && find . -type f | sed 's|^\./||' | LC_ALL=C sort \
    | xargs -r -d '\n' sha256sum ) > "$STAGE/MANIFEST"
mv "$STAGE/MANIFEST" "$TOP/MANIFEST"

# ── The artifact pair ─────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/ccrc-$VERSION.tar.gz"
tar --sort=name --mtime=@0 --owner=0 --group=0 -C "$TOP" -cf - . | gzip -n > "$TARBALL"
( cd "$OUT_DIR" && sha256sum "ccrc-$VERSION.tar.gz" > SHA256SUMS )

echo "build-release.sh: wrote $TARBALL"
echo "build-release.sh: wrote $OUT_DIR/SHA256SUMS"
