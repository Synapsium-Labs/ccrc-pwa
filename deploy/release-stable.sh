#!/usr/bin/env bash
# release-stable.sh — a push to `stable` PROMOTES the release already cut for
# the commit at its HEAD (design 2026-09-20 §4, decision 3). Two flags flip
# and one read-back; NO BUILD — a rebuild of the same tree is a different
# build.json (builtAt), a different MANIFEST, a different digest: two byte
# strings claiming one version, and the promoted one is the one nobody ran.
#
# THE TAG AT HEAD IS THE WHOLE INPUT. `stable` is fast-forward-only (its
# ruleset requires linear history), so its HEAD is always a commit that was
# on main and was released there by release-main.sh; a merge commit carries
# no release tag and is refused here (exit 2) — "promote a tree nobody
# built" is unexpressible. The ruleset is the other half of the enforcement.
# D-3129: HEAD may carry MORE THAN ONE release-shaped tag (e.g. an
# auto-tagged patch sitting on the same commit as a hand-cut minor) — a
# `head -n1` over `git tag --points-at HEAD` would silently promote
# whichever tag sorts first and make IT latest. Collect every release tag at
# HEAD and refuse (exit 2) unless there is exactly one: a promotion names
# ONE release, and picking for the operator is worse than asking.
#
# TWO EDITS, NOT ONE: the REST doc says drafts and prereleases cannot be set
# as latest, and one PATCH carrying both fields would be validated against a
# state this design has not measured. `--latest` is deliberate: GitHub's
# automatic "latest" is the newest non-prerelease by the COMMIT's date, so
# an older commit promoted after a newer one would not win by itself.
# Because `--latest` can therefore point latest/download at an OLDER tag by
# a routine act, every node's floor (design §9) is keyed to the version it
# resolved, not to the presence of --to.
#
# THE READ-BACK is `gh api …/releases/latest`: `gh release view` has no
# isLatest field and neither does the REST release object — "latest" is a
# property of that endpoint's answer. `{owner}/{repo}` are gh's own
# placeholders, filled from the checkout: this file spells no org.
#
# D-3128: "already stable" is IDEMPOTENT in the sense of CONVERGING to the
# promoted state — stable AND latest — not in the sense of a bare early
# return. A prior run can flip --prerelease=false and then die before
# --latest ever lands (a killed process, a transient gh failure); the next
# run must finish that job, not print "already stable" over an unfinished
# one and exit 0 while latest/download still serves another tag.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-stable.sh — on the stable branch's HEAD: flip the release tagged here from prerelease to stable and make it latest; never builds"; }
die() { echo "release-stable.sh: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) echo "release-stable.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# The read-back the promotion and the idempotent-convergence path share —
# ONE `gh api` line, never pasted twice.
read_latest() { gh api 'repos/{owner}/{repo}/releases/latest' --jq .tag_name; }

SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'
mapfile -t TAGS < <(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" || true)
if [ "${#TAGS[@]}" -eq 0 ]; then
  echo "release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD $(git -C "$ROOT" rev-parse --short HEAD) carries no vX.Y.Z tag)" >&2
  exit 2
fi
if [ "${#TAGS[@]}" -gt 1 ]; then
  echo "release-stable.sh: HEAD carries more than one release tag (${TAGS[*]}) — a promotion names one release; delete the tag that is not the release (git push origin --delete <tag>) and re-push stable. Nothing was changed" >&2
  exit 2
fi
TAG="${TAGS[0]}"

VIEW="$(gh release view "$TAG" --json isPrerelease,isDraft --jq '[.isPrerelease, .isDraft] | @tsv')" \
  || die "no GitHub release at $TAG — release-main.sh's trap exists to prevent a release-less tag, and this one exists anyway; cut the release by hand or move stable to a released commit. Nothing was changed"
IFS=$'\t' read -r PRE DRAFT <<< "$VIEW"
[ "$DRAFT" = true ] || [ "$DRAFT" = false ] || die "unexpected answer from gh release view for $TAG: '$VIEW'. Nothing was changed"
[ "$DRAFT" != true ] || die "$TAG is a DRAFT release — publish it before promoting. Nothing was changed"

if [ "$PRE" = true ]; then
  gh release edit "$TAG" --prerelease=false \
    || die "gh release edit $TAG --prerelease=false failed — $TAG is still a prerelease"
  gh release edit "$TAG" --latest \
    || die "gh release edit $TAG --latest failed — $TAG is stable, but latest/download may still serve another tag; re-run"
  LATEST="$(read_latest)" \
    || die "promoted $TAG to stable, but the latest read-back failed — check: gh api repos/{owner}/{repo}/releases/latest"
  [ "$LATEST" = "$TAG" ] \
    || die "promoted $TAG to stable, but GitHub's latest is $LATEST — re-run (a second --latest is idempotent), then check the release page"
  echo "release-stable.sh: promoted $TAG to stable (latest: $LATEST)"
  exit 0
fi
[ "$PRE" = false ] || die "unexpected answer from gh release view for $TAG: '$VIEW'. Nothing was changed"

# PRE = false: already stable. Read latest too — a run that flipped the flag
# earlier but never reached --latest left this unfinished (D-3128).
LATEST="$(read_latest)" \
  || die "$TAG is stable, but the latest read-back failed — check: gh api repos/{owner}/{repo}/releases/latest"
if [ "$LATEST" = "$TAG" ]; then
  echo "release-stable.sh: already stable $TAG (latest: $TAG)"
  exit 0
fi
echo "release-stable.sh: $TAG is stable but GitHub's latest is $LATEST — finishing the promotion"
gh release edit "$TAG" --latest \
  || die "gh release edit $TAG --latest failed — $TAG is stable, but latest/download may still serve another tag; re-run"
LATEST="$(read_latest)" \
  || die "promoted $TAG to stable, but the latest read-back failed — check: gh api repos/{owner}/{repo}/releases/latest"
[ "$LATEST" = "$TAG" ] \
  || die "promoted $TAG to stable, but GitHub's latest is $LATEST — re-run (a second --latest is idempotent), then check the release page"
echo "release-stable.sh: promoted $TAG to stable (latest: $LATEST)"
