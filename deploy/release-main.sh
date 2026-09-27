#!/usr/bin/env bash
# release-main.sh — every merge to main becomes a PRERELEASE (design 2026-09-20
# §4, decision 2: every release is born on the `dev` channel; `stable` is a
# promotion, release-stable.sh). TWO ARMS, because the provenance bundle is
# produced by the workflow's attest ACTION, which has to run AFTER the build
# and BEFORE the publish, and a bash script cannot run an action:
#
#   prepare  — refuse dirty/tagged, derive the next PATCH tag from the highest
#              release-shaped tag, tag it LOCALLY (never pushed here), build
#              with build-release.sh (the one builder), write
#              $OUT_DIR/release-main.state.
#   publish  — read the state, copy the attest step's bundle
#              ($CCRC_BUNDLE_PATH) to the name every `ccrc update` fetches,
#              refuse without it, push the tag, `gh release create` naming
#              ALL THREE artifacts `--prerelease`, delete the tag again if
#              the publish never completes.
#
# NOTHING REACHES ORIGIN BEFORE publish's push — so a failed attest step, a
# cancelled job between the arms, or a refused publish leaves origin exactly
# as it was and a re-run derives the same number. That is the property the
# one-script version's cleanup trap protected, kept across the split.
#
# WHY ONE WORKFLOW DOES ALL OF IT: a tag pushed with the workflow's own
# GITHUB_TOKEN never fires release.yml (GitHub suppresses workflow-caused
# events), and this repo carries no Actions secret that could push as someone
# else. So the main-push job must tag AND build AND attest AND publish itself.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-main.sh prepare|publish [--out <dir>] — prepare: on a clean, untagged HEAD derive the next vX.Y.Z patch tag, tag LOCALLY, build with build-release.sh; publish: push the tag and publish tarball + SHA256SUMS + provenance bundle (\$CCRC_BUNDLE_PATH) as a prerelease"; }
die() { echo "release-main.sh: $*" >&2; exit 1; }

ARM=""
OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    prepare|publish)
      [ -z "$ARM" ] || { echo "release-main.sh: one arm, not two: $ARM and $1" >&2; usage >&2; exit 2; }
      ARM="$1"; shift ;;
    --out)
      [ $# -ge 2 ] || { echo "release-main.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    *) echo "release-main.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$ARM" ] || { echo "release-main.sh: an arm is required: prepare or publish" >&2; usage >&2; exit 2; }
[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"
STATE="$OUT_DIR/release-main.state"
SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'

# ── prepare ──────────────────────────────────────────────────────────────
prepare() {
  [ -z "$(git -C "$ROOT" status --porcelain)" ] \
    || die "refusing a dirty tree — a release is built from a commit; commit or stash, then re-run (git status --porcelain is non-empty)"

  local at_head
  at_head="$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" || at_head=""
  mkdir -p "$OUT_DIR"
  if [ -n "$at_head" ]; then
    # Origin holds it → a hand-pushed tag, release.yml's. Origin does NOT →
    # a previous prepare's local tag on this checkout: say so, never build a
    # second artifact for it and never let publish mistake it for release.yml's.
    if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$at_head" >/dev/null 2>&1; then
      echo "release-main.sh: already tagged $at_head; release.yml owns it — nothing to do"
      printf 'built false\ntag %s\n' "$at_head" > "$STATE"
      return 0
    fi
    die "HEAD carries $at_head which origin does not hold — a previous prepare's local tag; delete it (git tag -d $at_head) and re-run. Nothing was built or pushed"
  fi

  # Derive: highest release-shaped tag, patch + 1. `sort -V` and not `sort`:
  # v1.9.10 outranks v1.9.9, which a lexical sort gets backwards.
  local highest next major minor patch
  highest="$(git -C "$ROOT" tag --list 'v*' | grep -E "$SHAPE" | sort -V | tail -n1)" || highest=""
  if [ -n "$highest" ]; then
    IFS=. read -r major minor patch <<< "${highest#v}"
    next="v$major.$minor.$((patch + 1))"
  else
    next="v0.0.1"
  fi
  echo "release-main.sh: highest release tag: ${highest:-none}; next: $next"

  # A tag-stale checkout: local tags behind origin would derive a number
  # origin already has. Refuse rather than guess; nothing was tagged.
  if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$next" >/dev/null 2>&1; then
    die "origin already holds $next — this checkout's tags are behind origin; fetch tags (git fetch --tags origin) and re-run. Nothing was tagged, pushed or deleted"
  fi

  # Tag LOCALLY (build-release.sh names the artifact by the tag at HEAD), build,
  # and drop the local tag again if the build fails so a re-run derives the
  # same number.
  git -C "$ROOT" tag "$next" || die "git tag $next failed"
  if ! bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR"; then
    git -C "$ROOT" tag -d "$next" >/dev/null 2>&1 || :
    die "build-release.sh failed — the local tag $next was removed; nothing reached origin"
  fi
  printf 'built true\ntag %s\n' "$next" > "$STATE"
  echo "release-main.sh: prepared $next — tagged locally (NOT pushed), artifacts in $OUT_DIR; next: the attest step, then 'release-main.sh publish'"
}

# ── publish ──────────────────────────────────────────────────────────────
PUBLISHED=false
TAG_TO_CLEAN=""
cleanup() {
  [ "$PUBLISHED" = true ] && return 0
  [ -n "$TAG_TO_CLEAN" ] || return 0
  echo "release-main.sh: the publish did not complete — deleting tag $TAG_TO_CLEAN from origin so no release-less tag remains" >&2
  git -C "$ROOT" push origin --delete "refs/tags/$TAG_TO_CLEAN" >/dev/null 2>&1 \
    || echo "release-main.sh: could not delete $TAG_TO_CLEAN from origin — delete it by hand: git push origin --delete $TAG_TO_CLEAN" >&2
  git -C "$ROOT" tag -d "$TAG_TO_CLEAN" >/dev/null 2>&1 || :
}

publish() {
  [ -f "$STATE" ] || { echo "release-main.sh: no $STATE — run 'release-main.sh prepare' first" >&2; exit 2; }
  local built="" tag="" k v
  while read -r k v; do
    case "$k" in built) built="$v" ;; tag) tag="$v" ;; esac
  done < "$STATE"
  if [ "$built" = false ]; then
    echo "release-main.sh: nothing to publish — $tag was already tagged at checkout; release.yml owns it"
    return 0
  fi
  [ "$built" = true ] && [[ "$tag" =~ $SHAPE ]] || die "malformed $STATE — re-run prepare"

  local tarball="$OUT_DIR/ccrc-$tag.tar.gz" sums="$OUT_DIR/SHA256SUMS" bundle="$OUT_DIR/ccrc-$tag.tar.gz.sigstore.json"
  [ -f "$tarball" ] && [ -f "$sums" ] || die "prepare's artifacts are missing from $OUT_DIR — re-run prepare"

  # THE BUNDLE: the attest step's own output file, copied to the name every
  # `ccrc update` fetches (`<tarball>.sigstore.json`, design §5). Absent, the
  # release is unattested and is not published — a release-less tag is
  # recoverable (nothing was pushed), an unattested release is not.
  if [ -n "${CCRC_BUNDLE_PATH:-}" ]; then
    [ -f "$CCRC_BUNDLE_PATH" ] \
      || die "CCRC_BUNDLE_PATH names no file: $CCRC_BUNDLE_PATH — the attest step did not produce a bundle; nothing was pushed"
    cp -- "$CCRC_BUNDLE_PATH" "$bundle"
  fi
  [ -f "$bundle" ] \
    || die "no provenance bundle at $bundle — the attest step must run between prepare and publish (CCRC_BUNDLE_PATH names its output); refusing to publish an unattested release; nothing was pushed"

  [ "$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" = "$tag" ] \
    || die "HEAD no longer carries $tag — re-run prepare"
  if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    git -C "$ROOT" tag -d "$tag" >/dev/null 2>&1 || :
    die "origin already holds $tag — another run published it between prepare and publish; the local tag was removed, nothing was pushed"
  fi

  # Push BEFORE publish (gh --verify-tag checks the remote); from here the
  # cleanup trap owns the tag until the publish completes.
  if ! git -C "$ROOT" push origin "refs/tags/$tag"; then
    git -C "$ROOT" tag -d "$tag" >/dev/null 2>&1 || :
    die "git push origin $tag failed — the local tag was removed; nothing was published"
  fi
  TAG_TO_CLEAN="$tag"
  trap cleanup EXIT

  # All three artifacts NAMED, not globbed: a glob's order follows the
  # locale's collation, and the test pins the argv. `--prerelease` trailing:
  # this release is born on `dev` (decision 2); release-stable.sh promotes it.
  gh release create "$tag" "$tarball" "$sums" "$bundle" --verify-tag --prerelease
  PUBLISHED=true
  echo "release-main.sh: published $tag as a prerelease (dev) — promotion to stable is a fast-forward push of this commit to the stable branch (deploy/release-stable.sh)"
}

case "$ARM" in
  prepare) prepare ;;
  publish) publish ;;
esac
