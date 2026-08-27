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
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/ccrc-rel.XXXXXXXXXX")"
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

# ── build.json: the artifact carries its own identity (stage 4, Task 6) ───
# An extracted release tree is not a git repository, so the box-side stamper
# (`ccd/ccrc`'s `_inst_stamp`) cannot measure it — it installs THIS file
# instead (its shipped-stamp arm), and `ccrc update` reports from → to off
# the same fields. sha/ref are measured here, on the release machine, from
# the same HEAD `git archive` just shipped; `dirty` is false BY THE REFUSAL
# at the top (a dirty tree never reaches this line); `version` is the
# artifact's own name. Written before the MANIFEST, so the per-file digests
# cover it like everything else in the set. The field shape is the two
# stampers' exact shape (deploy.sh `stamp_build`, `_inst_stamp`), which
# `shared/buildinfo.ts` and `_box_build_fields` both validate.
printf '{"sha":"%s","ref":"%s","builtAt":"%s","dirty":false,"version":"%s"}\n' \
  "$(git -C "$ROOT" rev-parse HEAD)" \
  "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$VERSION" > "$TOP/build.json"

# ── MANIFEST: every file, per-file sha256 ─────────────────────────────────
# Generated OUTSIDE the tree then moved in, so `find` can never race its own
# output; `LC_ALL=C sort` so the line order is a property of the set, not of
# the builder's locale. The outer checksum (SHA256SUMS) guards transport; this
# guards the set after extraction (`ccrc update` runs `sha256sum -c MANIFEST`
# in the staging dir).
# `xargs -r -d` AND `sha256sum` ARE BOTH GNU, and this line used neither
# portably: BSD xargs has no `-d` at all (it rejects the option outright, so
# the MANIFEST came out EMPTY on a macOS builder) and BSD ships `shasum`
# rather than `sha256sum`. `-0` is in both, so the separator is switched to
# NUL via `tr`; `-r` becomes an explicit emptiness guard, because BSD xargs
# runs its utility once even with no input where GNU's `-r` skips it.
#
# Both tools print the SAME "<digest>  <name>" line, so a MANIFEST written on
# either platform verifies on either — which is the property that matters
# here, since `ccrc update` checks this file on the box, not on the builder.
# A COMMAND, not a shell function: `xargs` execs a binary and cannot call
# one. Unquoted on use, so `shasum -a 256` splits into its two words.
BR_SHA256=sha256sum
[ "$(uname -s 2>/dev/null)" = Darwin ] && BR_SHA256="shasum -a 256"
( cd "$TOP" && find . -type f | sed 's|^\./||' | LC_ALL=C sort > "$STAGE/.manifest-names"
  if [ -s "$STAGE/.manifest-names" ]; then
    # shellcheck disable=SC2086  # deliberate word split: see BR_SHA256 above
    tr '\n' '\0' < "$STAGE/.manifest-names" | xargs -0 $BR_SHA256
  fi
  rm -f "$STAGE/.manifest-names" ) > "$STAGE/MANIFEST"
mv "$STAGE/MANIFEST" "$TOP/MANIFEST"

# ── The artifact pair ─────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/ccrc-$VERSION.tar.gz"
# ── THE TARBALL MUST BE REPRODUCIBLE, and that is why this needs GNU tar ──
# `--sort=name --mtime=@0 --owner=0 --group=0` is what makes two builds of the
# same tree produce the same BYTES, which is the whole basis of `SHA256SUMS`
# being a statement about the tree rather than about the builder. BSD tar
# (libarchive, macOS's `tar`) has none of those four options — it rejects
# `--sort` outright — so a macOS builder would silently emit a DIFFERENT
# tarball for identical input: same contents, different digest, and a checksum
# that no longer means what it says.
#
# So this REFUSES rather than degrading. Downloading and verifying a release
# is a `curl` plus a platform-chosen digest check on the box (install.sh and
# `_plat_sha256_check` both switch to `shasum -a 256` on Darwin, exactly as
# BR_SHA256 above does — the earlier draft of this sentence claimed the
# verify side "stays platform-neutral", which was false twelve lines below
# the file's own Darwin switch); BUILDING
# one is a maintainer's job, and requiring the tool that makes the output
# deterministic is the honest price. `gtar` is what Homebrew's `gnu-tar`
# installs.
BR_TAR=""
if tar --version 2>/dev/null | grep -qi 'gnu tar'; then BR_TAR=tar
elif command -v gtar >/dev/null 2>&1; then BR_TAR=gtar
fi
[ -n "$BR_TAR" ] || {
  echo "build-release.sh: GNU tar is required to build a release — the archive is made reproducible with --sort/--mtime/--owner/--group, and BSD tar (macOS's) has none of them, so it would emit a different tarball for identical input. Install it: brew install gnu-tar" >&2
  exit 1
}
"$BR_TAR" --sort=name --mtime=@0 --owner=0 --group=0 -C "$TOP" -cf - . | gzip -n > "$TARBALL"
# shellcheck disable=SC2086  # deliberate word split: see BR_SHA256 above
( cd "$OUT_DIR" && $BR_SHA256 "ccrc-$VERSION.tar.gz" > SHA256SUMS )

echo "build-release.sh: wrote $TARBALL"
echo "build-release.sh: wrote $OUT_DIR/SHA256SUMS"
