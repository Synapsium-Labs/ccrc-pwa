#!/usr/bin/env bash
# release-main.sh — every merge to main that changes what ships becomes a
# PRERELEASE; a merge whose every changed path deploy/release-scope.mjs calls
# not shipped, by HEAD's copy and by the base tag's own, cuts none (D-6390,
# D-6402). A release is born on the `dev` channel (design 2026-09-20 §4,
# decision 2); `stable` is a promotion, release-stable.sh. The build and the
# publish are TWO ARMS, because the provenance bundle is produced by the
# workflow's attest ACTION, which has to run AFTER the build and BEFORE the
# publish, and a bash script cannot run an action. Four arms in all:
#
#   decide   — runs first, installs nothing: does this merge change what ships?
#              Records $OUT_DIR/release-main.decision (`release` or `same-as
#              <tag>`), prints one line saying why, and appends it to the job
#              summary (D-6392 to D-6395).
#   measure  — `--base <tag>`: the same question against any release tag, one
#              answer line (`unchanged <n>`, `changed <n> <first>` or
#              `unmeasured <why>`), no file written, no gh call.
#   prepare  — refuse dirty/tagged, derive the next PATCH tag from the highest
#              release-shaped tag, tag it LOCALLY (never pushed here), build
#              with build-release.sh (the one builder), write
#              $OUT_DIR/release-main.state. When decide recorded `same-as`,
#              it tags and builds nothing and records `built unchanged`.
#   publish  — read the state, copy the attest step's bundle
#              ($CCRC_BUNDLE_PATH) to the name every `ccrc update` fetches,
#              refuse without it, write the notes (release-notes.mjs,
#              D-5548), push the tag, `gh release create` naming ALL THREE
#              artifacts `--prerelease --notes-file`, delete the tag again if
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

usage() { echo "usage: bash deploy/release-main.sh decide|prepare|publish [--out <dir>] | measure --base <tag> — decide runs first: does this merge change what ships? prepare: on a clean, untagged HEAD derive the next vX.Y.Z patch tag, tag LOCALLY, build with build-release.sh; publish: push the tag and publish tarball + SHA256SUMS + provenance bundle (\$CCRC_BUNDLE_PATH) as a prerelease; measure: print what changed since a release tag, one line"; }
die() { echo "release-main.sh: $*" >&2; exit 1; }

ARM=""
OUT_DIR=""
BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    decide|prepare|publish|measure)
      [ -z "$ARM" ] || { echo "release-main.sh: one arm, not two: $ARM and $1" >&2; usage >&2; exit 2; }
      ARM="$1"; shift ;;
    --out)
      [ $# -ge 2 ] || { echo "release-main.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    --base)
      [ $# -ge 2 ] || { echo "release-main.sh: --base needs a release tag" >&2; usage >&2; exit 2; }
      BASE="$2"; shift 2 ;;
    *) echo "release-main.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$ARM" ] || { echo "release-main.sh: an arm is required: decide, prepare, publish or measure" >&2; usage >&2; exit 2; }
[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"
STATE="$OUT_DIR/release-main.state"
SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'
DECISION="$OUT_DIR/release-main.decision"
if [ "$ARM" = measure ]; then
  [ -n "$BASE" ] && [[ "$BASE" =~ $SHAPE ]] \
    || { echo "release-main.sh: measure needs --base <release tag> (vX.Y.Z), not '$BASE'" >&2; usage >&2; exit 2; }
elif [ -n "$BASE" ]; then
  echo "release-main.sh: --base belongs to the measure arm only" >&2; usage >&2; exit 2
fi

# ── the decision (D-6390 to D-6403) ───────────────────────────────────────
# One line per outcome: printed, and appended to the job summary when there is
# one. A summary that cannot be written never fails the run (D-6395).
say() {
  printf '%s\n' "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; } 2>/dev/null || :
  fi
}

# The setup-node step's gate: `build=false` only when decide recorded a skip.
set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    { printf 'build=%s\n' "$1" >> "$GITHUB_OUTPUT"; } 2>/dev/null || :
  fi
}

# Highest release-shaped tag, patch + 1. A version sort and not a lexical one:
# v1.9.10 outranks v1.9.9, which a lexical sort gets backwards. Sets HIGHEST (empty
# when there is none) and NEXT; decide and prepare both read it from here.
derive_tags() {
  local major minor patch
  HIGHEST="$(git -C "$ROOT" tag --list 'v*' | grep -E "$SHAPE" | sort -V | tail -n1)" || HIGHEST=""
  if [ -n "$HIGHEST" ]; then
    IFS=. read -r major minor patch <<< "${HIGHEST#v}"
    NEXT="v$major.$minor.$((patch + 1))"
  else
    NEXT="v0.0.1"
  fi
}

# Ask one copy of release-scope.mjs what changed since <base>. Only a lone
# `unchanged <n>` at rc 0 is unchanged, and only a lone `changed <n> <first>`
# at rc 0 is changed; every other answer is unmeasured, with its reason
# (D-6393). Always returns 0; the answer is CHANGE, CHANGE_N, CHANGE_FIRST and
# CHANGE_WHY.
scope_ask() {
  local helper="$1" base="$2" label="$3" out rc=0
  CHANGE=unmeasured; CHANGE_N=""; CHANGE_FIRST=""; CHANGE_WHY=""
  out="$(node "$helper" --repo "$ROOT" --base "$base")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    CHANGE_WHY="$label exited $rc"
  elif [[ "$out" == *$'\n'* ]]; then
    CHANGE_WHY="$label answered more than one line"
  elif [[ "$out" =~ ^unchanged\ ([0-9]+)$ ]]; then
    CHANGE=unchanged; CHANGE_N="${BASH_REMATCH[1]}"
  elif [[ "$out" =~ ^changed\ ([0-9]+)\ (.+)$ ]]; then
    CHANGE=changed; CHANGE_N="${BASH_REMATCH[1]}"; CHANGE_FIRST="${BASH_REMATCH[2]}"
  else
    CHANGE_WHY="$label answered '${out:0:80}'"
  fi
  return 0
}

# The runner's own node is trusted only at or above the engines floor of
# server/package.json (D-6403), compared field by field here, so the version
# sort stays spelled once, in derive_tags. Returns 0 at or above the floor; otherwise sets FLOOR_WHY.
node_floor_ok() {
  local hits floor nv rc=0 i
  local -a f v
  hits="$(grep -oE '"node"[[:space:]]*:[[:space:]]*">=[0-9]+\.[0-9]+\.[0-9]+"' "$ROOT/server/package.json" 2>/dev/null)" || hits=""
  if [ -z "$hits" ] || [[ "$hits" == *$'\n'* ]]; then
    FLOOR_WHY="server/package.json names no readable engines floor"; return 1
  fi
  floor="$(printf '%s' "$hits" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
  nv="$(node --version 2>/dev/null)" || rc=$?
  if [ "$rc" -ne 0 ]; then FLOOR_WHY="node --version exited $rc"; return 1; fi
  if ! [[ "$nv" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    FLOOR_WHY="node --version answered '${nv:0:80}'"; return 1
  fi
  v=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")
  IFS=. read -r -a f <<< "$floor"
  for i in 0 1 2; do
    if (( 10#${v[i]} > 10#${f[i]} )); then return 0; fi
    if (( 10#${v[i]} < 10#${f[i]} )); then
      FLOOR_WHY="node $nv is below server/package.json's engines floor >=$floor"; return 1
    fi
  done
  return 0
}

# What changed since <base>, by two classifiers that must agree (D-6402): HEAD's
# release-scope.mjs, then the base tag's own copy. A merge that changes the
# classifier changes deploy/, so the old copy answers `changed` whatever HEAD's
# says. Always returns 0; CHANGE_BY_BASE is 1 when only the base's copy
# answered `changed`.
measure_change() {
  local base="$1" d
  CHANGE_BY_BASE=0
  if ! node_floor_ok; then
    CHANGE=unmeasured; CHANGE_N=""; CHANGE_FIRST=""; CHANGE_WHY="$FLOOR_WHY"
    return 0
  fi
  scope_ask "$ROOT/deploy/release-scope.mjs" "$base" release-scope.mjs
  [ "$CHANGE" = unchanged ] || return 0
  if ! d="$(mktemp -d)"; then
    CHANGE=unmeasured; CHANGE_WHY="mktemp -d failed"
    return 0
  fi
  if ! git -C "$ROOT" show "$base:deploy/release-scope.mjs" > "$d/release-scope.mjs" 2>/dev/null; then
    CHANGE=unmeasured; CHANGE_N=""; CHANGE_FIRST=""; CHANGE_WHY="$base carries no deploy/release-scope.mjs to confirm the answer"
  else
    scope_ask "$d/release-scope.mjs" "$base" "$base's release-scope.mjs"
    if [ "$CHANGE" = changed ]; then CHANGE_BY_BASE=1; fi
  fi
  rm -f "$d/release-scope.mjs"; rmdir "$d" 2>/dev/null || :
  return 0
}

# A tag with no published, non-draft release behind it (a failed release.yml
# run, an orphan tag) is no base to skip against (D-6392). Only decide asks.
base_published() {
  local tag="$1" out rc=0
  out="$(cd "$ROOT" && gh release view "$tag" --json isDraft --jq .isDraft)" || rc=$?
  if [ "$rc" -ne 0 ]; then BASE_WHY="gh release view exited $rc"; return 1; fi
  if [ "$out" != false ]; then BASE_WHY="gh release view answered '${out:0:80}'"; return 1; fi
  return 0
}

# Does this merge change what ships? Reads only committed trees, so the dirty
# and tagged-HEAD refusals stay prepare's. Records `same-as <tag>` only on a
# measured, confirmed, published-base skip; every other path records `release`.
decide() {
  local line
  mkdir -p "$OUT_DIR"
  rm -f "$DECISION"
  derive_tags
  if [ -z "$HIGHEST" ]; then
    line="release-main.sh: releasing $NEXT — no earlier release tag to compare against"
  else
    measure_change "$HIGHEST"
    case "$CHANGE" in
      unchanged)
        if base_published "$HIGHEST"; then
          printf 'same-as %s\n' "$HIGHEST" > "$DECISION"
          set_output false
          say "release-main.sh: no release for this merge — nothing that ships changed since $HIGHEST (paths changed: $CHANGE_N, each on release-scope.mjs's NOT_SHIPPED list); nothing was tagged or built, and the next merge that changes the build takes $NEXT"
          return 0
        fi
        line="release-main.sh: releasing $NEXT — $HIGHEST is not a published release ($BASE_WHY), so nothing is measured against it" ;;
      changed)
        if [ "$CHANGE_BY_BASE" = 1 ]; then
          line="release-main.sh: releasing $NEXT — what ships changed since $HIGHEST, by $HIGHEST's own release-scope.mjs; HEAD's answered unchanged (shipped paths changed: $CHANGE_N; first: $CHANGE_FIRST)"
        else
          line="release-main.sh: releasing $NEXT — what ships changed since $HIGHEST (shipped paths changed: $CHANGE_N; first: $CHANGE_FIRST)"
        fi ;;
      *)
        line="release-main.sh: releasing $NEXT — could not measure what changed since $HIGHEST ($CHANGE_WHY); a merge whose change cannot be measured is released" ;;
    esac
  fi
  printf 'release\n' > "$DECISION"
  set_output true
  say "$line"
}

# One answer line, rc 0, no gh, no file: what changed since a release tag.
measure() {
  measure_change "$BASE"
  case "$CHANGE" in
    unchanged) echo "unchanged $CHANGE_N" ;;
    changed) echo "changed $CHANGE_N $CHANGE_FIRST" ;;
    *) echo "unmeasured $CHANGE_WHY" ;;
  esac
}

# ── prepare ──────────────────────────────────────────────────────────────
# The one file decide leaves inside the checkout when --out names a directory
# there (the workflow's release-out is not gitignored): prepare's dirty-tree
# refusal must not read the decision it is about to consume as a straggler.
# Prints the file's path relative to the checkout, or nothing when it lies
# outside it or does not exist yet.
decision_in_tree() {
  local rootp dirp
  [ -f "$DECISION" ] || return 0
  rootp="$(cd "$ROOT" && pwd -P)"; dirp="$(cd "$(dirname "$DECISION")" && pwd -P)"
  case "$dirp/" in "$rootp"/*) printf '%s\n' "${dirp#"$rootp"/}/release-main.decision" ;; esac
  return 0
}

prepare() {
  local dirty rel
  dirty="$(git -C "$ROOT" status --porcelain -uall)"
  rel="$(decision_in_tree)"
  if [ -n "$rel" ]; then dirty="$(printf '%s\n' "$dirty" | grep -vxF -- "?? $rel" || :)"; fi
  [ -z "$dirty" ] \
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

  derive_tags
  local highest="$HIGHEST" next="$NEXT" dec
  echo "release-main.sh: highest release tag: ${highest:-none}; next: $next"

  # A tag-stale checkout: local tags behind origin would derive a number
  # origin already has. Refuse rather than guess; nothing was tagged.
  if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$next" >/dev/null 2>&1; then
    die "origin already holds $next — this checkout's tags are behind origin; fetch tags (git fetch --tags origin) and re-run. Nothing was tagged, pushed or deleted"
  fi

  # The decision decide recorded (D-6394). Only exactly `same-as <highest>`
  # skips: an absent, stale or malformed file releases, and says which. The
  # published-base check and the token belong to decide alone.
  if [ -f "$DECISION" ]; then
    dec="$(cat -- "$DECISION"; printf x)"; dec="${dec%x}"
    if [ -n "$highest" ] && [ "$dec" = "same-as $highest"$'\n' ]; then
      # The attest step signs every tarball in the out directory; one planted
      # before a skip would be signed and published by no release.
      if compgen -G "$OUT_DIR/ccrc-*.tar.gz" >/dev/null; then
        die "a tarball is already in $OUT_DIR — the attest step would sign an artifact no release publishes; remove it and re-run. Nothing was tagged or built"
      fi
      printf 'built unchanged\nsame-as %s\n' "$highest" > "$STATE"
      echo "release-main.sh: decide recorded no release for this merge (same as $highest) — nothing tagged or built"
      return 0
    elif [ "$dec" != $'release\n' ]; then
      say "release-main.sh: releasing $next — $DECISION records neither 'release' nor 'same-as $highest'; a merge whose change cannot be measured is released"
    fi
  else
    say "release-main.sh: releasing $next — no decision was recorded in $DECISION (release-main.sh decide did not run); a merge whose change cannot be measured is released"
  fi

  # Tag LOCALLY (build-release.sh names the artifact by the tag at HEAD), build,
  # and drop the local tag again if the build fails so a re-run derives the
  # same number.
  # The builder refuses a dirty tree too, and a decision file inside the
  # checkout is an untracked file: hold it aside for the build, put it back after.
  local held=""
  if [ -n "$rel" ]; then
    held="$(mktemp)" && mv -f -- "$DECISION" "$held" || held=""
  fi
  git -C "$ROOT" tag "$next" || { [ -z "$held" ] || mv -f -- "$held" "$DECISION"; die "git tag $next failed"; }
  if ! bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR"; then
    git -C "$ROOT" tag -d "$next" >/dev/null 2>&1 || :
    [ -z "$held" ] || mv -f -- "$held" "$DECISION"
    die "build-release.sh failed — the local tag $next was removed; nothing reached origin"
  fi
  [ -z "$held" ] || mv -f -- "$held" "$DECISION"
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
  local built="" tag="" same="" k v
  while read -r k v; do
    case "$k" in built) built="$v" ;; tag) tag="$v" ;; same-as) same="$v" ;; esac
  done < "$STATE"
  if [ "$built" = unchanged ]; then
    [[ "$same" =~ $SHAPE ]] || die "malformed $STATE — re-run prepare"
    echo "release-main.sh: no release for this merge — nothing that ships changed since $same; nothing to push, attest or publish"
    return 0
  fi
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

  # THE NOTES (D-5548, D-5551): what changed since the previous release tag, written
  # by release-notes.mjs from the local tag — commit text goes from git to that
  # file and from the file to gh, and never through this shell. A writer that
  # fails costs the release its body, never the release itself: a release
  # must not stall on a sentence.
  local notes="$OUT_DIR/release-notes.txt"
  if ! node "$ROOT/deploy/release-notes.mjs" --repo "$ROOT" --tag "$tag" --out "$notes"; then
    echo "release-main.sh: could not write the release notes for $tag — publishing with an empty body (re-run deploy/release-notes-backfill.mjs for it later)" >&2
    : > "$notes"
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
  # `--notes-file` last: the body is the file the notes step wrote (D-5548).
  gh release create "$tag" "$tarball" "$sums" "$bundle" --verify-tag --prerelease --notes-file "$notes"
  PUBLISHED=true
  echo "release-main.sh: published $tag as a prerelease (dev) — promotion to stable is a fast-forward push of this commit to the stable branch (deploy/release-stable.sh)"
}

case "$ARM" in
  decide) decide ;;
  measure) measure ;;
  prepare) prepare ;;
  publish) publish ;;
esac
