#!/usr/bin/env bash
# release-main.sh — every merge to main becomes a release (spec §3).
#
# On a clean HEAD that carries no vX.Y.Z tag: derive the next PATCH tag from
# the highest existing release-shaped tag, push it, build the artifact with
# build-release.sh (the one builder — this script adds no second build path),
# and publish it with gh. A HEAD that already carries a release tag is
# release.yml's (a hand-cut minor/major), so this exits 0 having done nothing.
#
# WHY ONE SCRIPT DOES ALL THREE: a tag pushed with the workflow's own
# GITHUB_TOKEN never fires release.yml (GitHub suppresses workflow-caused
# events), and this repo carries no Actions secret that could push as someone
# else. So the main-push job must tag AND build AND publish itself.
#
# THE CLEANUP TRAP: a tag that reached origin while the publish did not is a
# tag `ccrc update --to` can only fail against ("is there a release?"). If
# `gh release create` does not complete, the pushed tag is deleted again and
# a re-run derives the same number.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-main.sh [--out <dir>] — on a clean, untagged HEAD: derive the next vX.Y.Z patch tag, push it, build with build-release.sh, publish with gh"; }
die() { echo "release-main.sh: $*" >&2; exit 1; }

OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --out)
      [ $# -ge 2 ] || { echo "release-main.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    *) echo "release-main.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"

# ── Refusals, before anything is written ─────────────────────────────────
[ -z "$(git -C "$ROOT" status --porcelain)" ] \
  || die "refusing a dirty tree — a release is built from a commit; commit or stash, then re-run (git status --porcelain is non-empty)"

SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'
AT_HEAD="$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" || AT_HEAD=""
if [ -n "$AT_HEAD" ]; then
  echo "release-main.sh: already tagged $AT_HEAD; release.yml owns it — nothing to do"
  exit 0
fi

# ── Derive: highest release-shaped tag, patch + 1 ────────────────────────
# `sort -V` and not `sort`: v1.9.10 outranks v1.9.9, which a lexical sort
# gets backwards. Non-release tags (wip, backup/*, rescue/*) never qualify.
HIGHEST="$(git -C "$ROOT" tag --list 'v*' | grep -E "$SHAPE" | sort -V | tail -n1)" || HIGHEST=""
if [ -n "$HIGHEST" ]; then
  IFS=. read -r MAJOR MINOR PATCH <<< "${HIGHEST#v}"
  NEXT="v$MAJOR.$MINOR.$((PATCH + 1))"
else
  NEXT="v0.0.1"
fi
echo "release-main.sh: highest release tag: ${HIGHEST:-none}; next: $NEXT"

# ── Tag and push, push BEFORE publish (gh --verify-tag checks the remote) ─
git -C "$ROOT" tag "$NEXT" || die "git tag $NEXT failed"
if ! git -C "$ROOT" push origin "refs/tags/$NEXT"; then
  git -C "$ROOT" tag -d "$NEXT" >/dev/null 2>&1 || :
  die "git push origin $NEXT failed — the local tag was removed; nothing was published"
fi

PUBLISHED=false
cleanup() {
  [ "$PUBLISHED" = true ] && return 0
  echo "release-main.sh: the publish did not complete — deleting tag $NEXT from origin so no release-less tag remains" >&2
  git -C "$ROOT" push origin --delete "refs/tags/$NEXT" >/dev/null 2>&1 \
    || echo "release-main.sh: could not delete $NEXT from origin — delete it by hand: git push origin --delete $NEXT" >&2
  git -C "$ROOT" tag -d "$NEXT" >/dev/null 2>&1 || :
}
trap cleanup EXIT

# ── Build (the one builder) and publish ──────────────────────────────────
bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR"
# Both artifacts NAMED, not globbed: a glob's order follows the locale's
# collation (C puts SHA256SUMS first, en_US puts ccrc-… first), and the test
# pins the argv. --verify-tag against origin, as release.yml does.
gh release create "$NEXT" "$OUT_DIR/ccrc-$NEXT.tar.gz" "$OUT_DIR/SHA256SUMS" --verify-tag
PUBLISHED=true
echo "release-main.sh: published $NEXT"
