#!/usr/bin/env bash
# release-artifact.sh — the hand-over between the release workflow's two jobs
# (D-6649, D-6650, D-6657). The build job runs every line of the checkout's
# own code (the installs, the builder, the comparison) and holds NO write
# credential; the publish job holds the write token and runs none of it. What
# crosses between them is one uploaded artifact, the tarball and its
# SHA256SUMS, and one step output, the tarball's digest. This script is both
# ends of that crossing:
#
#   record — the build job, after the build and before the upload. Checks
#            that the tarball in --dir is named after --tag, that SHA256SUMS
#            is exactly its one line, and that the build.json inside it is
#            the builder's one-line shape naming this tag and this HEAD; then
#            prints one line and hands the digest on as `digest=<hex>` in
#            $GITHUB_OUTPUT. The only verb that reads inside the tarball, and
#            it runs where the build already ran (D-6650).
#   verify — the publish job, on the downloaded artifact. Checks that --in
#            holds exactly the tarball and SHA256SUMS, each a regular file,
#            that the tarball hashes to the digest the build job recorded and
#            that SHA256SUMS is byte-identical to the one line that digest
#            makes. It never opens the tarball: the write side decodes nothing
#            it received (D-6657). Only once every check has passed does it
#            write into --out — the tarball, copied, and a SHA256SUMS written
#            from the digest — so a refusal leaves --out as it was.
#
# A digest that never reached the publish job (a lost step output) is an empty
# --digest, which verify refuses as not a sha256 digest.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-artifact.sh record --tag <tag> --dir <dir> | verify --tag <tag> --digest <hex> --in <dir> --out <dir> — record: in the build job, check ccrc-<tag>.tar.gz, its SHA256SUMS and its build.json, and hand the digest on as a step output; verify: in the publish job, check the downloaded artifact against that digest without opening it, then copy it into --out"; }
die() { echo "release-artifact.sh: $*" >&2; exit 1; }
bad_usage() { echo "release-artifact.sh: $*" >&2; usage >&2; exit 2; }

SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'

# The temporary file a SHA256SUMS is compared against, outside both
# directories; removed on exit.
SCRATCH=""
cleanup() { [ -z "$SCRATCH" ] || rm -f -- "$SCRATCH"; }
trap cleanup EXIT

# The digest handed to the publish job. A step output that cannot be written
# never fails the run (release-main.sh's set_output); verify refuses the empty
# --digest that a lost one becomes.
put_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    { printf 'digest=%s\n' "$1" >> "$GITHUB_OUTPUT"; } 2>/dev/null || :
  fi
}

# The sha256 of <file>, read on stdin so no file name is ever escaped into the
# answer. Returns 1 when the hasher fails or answers anything but 64 hex.
digest_of() {
  local out
  local -a sha=(sha256sum)
  [ "$(uname -s 2>/dev/null)" = Darwin ] && sha=(shasum -a 256)
  out="$("${sha[@]}" < "$1")" || return 1
  out="${out%% *}"
  [[ "$out" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$out"
}

# Writes the one SHA256SUMS line <digest> makes for <name> into $SCRATCH.
expected_sums() {
  [ -n "$SCRATCH" ] || SCRATCH="$(mktemp "${TMPDIR:-/tmp}/release-artifact.XXXXXX")"
  printf '%s  %s\n' "$1" "$2" > "$SCRATCH"
}

# Names in <dir> matching <glob>, sorted in the C locale and joined by spaces;
# empty when none match. Dot files count.
names_in() {
  local p
  local -a names=()
  shopt -s nullglob dotglob
  for p in "$1"/$2; do names+=("${p##*/}"); done
  shopt -u nullglob dotglob
  [ "${#names[@]}" -gt 0 ] || return 0
  printf '%s\n' "${names[@]}" | LC_ALL=C sort | paste -sd' ' -
}

# ── record ───────────────────────────────────────────────────────────────
record() {
  local tag="$1" dir="$2" name tarball others digest rc json re sha version head
  [[ "$tag" =~ $SHAPE ]] || die "$tag is not a release tag"
  name="ccrc-$tag.tar.gz"
  tarball="$dir/$name"

  # The builder names the tarball after the release tag at HEAD; a HEAD that
  # carries another one built that one's (D-6649).
  others="$(names_in "$dir" 'ccrc-*.tar.gz')"
  if [ ! -f "$tarball" ] || [ "$others" != "$name" ]; then
    die "no $name in $dir (it holds ${others:-no ccrc-*.tar.gz}) — the builder named the tarball after another release tag at HEAD"
  fi

  rc=0; digest="$(digest_of "$tarball")" || rc=$?
  [ "$rc" -eq 0 ] || die "could not hash $name"
  expected_sums "$digest" "$name"
  if [ ! -f "$dir/SHA256SUMS" ] || ! cmp -s -- "$SCRATCH" "$dir/SHA256SUMS"; then
    die "SHA256SUMS is not exactly one line for $name at $digest"
  fi

  # build.json in build-release.sh's exact one-line shape (its printf).
  rc=0; json="$(tar -xzOf "$tarball" ./build.json)" || rc=$?
  [ "$rc" -eq 0 ] || die "could not read build.json from $name, or it is not the builder's one-line shape"
  re='^\{"sha":"([0-9a-f]{40})","ref":"[^"]*","builtAt":"[^"]*","dirty":false,"version":"([^"]*)"\}$'
  if [[ "$json" == *$'\n'* ]] || ! [[ "$json" =~ $re ]]; then
    die "could not read build.json from $name, or it is not the builder's one-line shape"
  fi
  sha="${BASH_REMATCH[1]}"; version="${BASH_REMATCH[2]}"
  [ "$version" = "$tag" ] || die "build.json says version $version, not $tag"
  rc=0; head="$(git -C "$ROOT" rev-parse HEAD)" || rc=$?
  [ "$rc" -eq 0 ] || die "could not read HEAD in $ROOT"
  [ "$sha" = "$head" ] || die "build.json was built from $sha, not HEAD $head"

  echo "release-artifact.sh: recorded $name, sha256 $digest (build.json: version $tag, sha $head)"
  put_output "$digest"
}

# ── verify ───────────────────────────────────────────────────────────────
verify() {
  local tag="$1" want="$2" in="$3" out="$4" name names f digest rc
  [[ "$tag" =~ $SHAPE ]] || die "$tag is not a release tag"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "$want is not a sha256 digest"
  name="ccrc-$tag.tar.gz"

  # The attest step signs every tarball in --out; one already there would be
  # signed beside this release's and published by none.
  [ -z "$(names_in "$out" 'ccrc-*.tar.gz')" ] || die "$out already holds a tarball — the attest step would sign an artifact no release publishes"
  # Defence in depth, with no row of its own: whenever it fires, the tarball check above or the file-set check below refuses that call too.
  if [ -e "$out" ] && [ "$out" -ef "$in" ]; then die "$out is the build's artifact directory — the copy needs a directory of its own"; fi

  # Exactly the two names, each a regular file and not a symlink.
  names="$(names_in "$in" '*')"
  [ "$names" = "SHA256SUMS $name" ] || die "the build's artifact holds ${names:-nothing} — expected exactly $name and SHA256SUMS"
  for f in "$name" SHA256SUMS; do
    [ ! -L "$in/$f" ] || die "$f in the build's artifact is not a regular file"
    [ -f "$in/$f" ] || die "$f in the build's artifact is not a regular file"
  done

  rc=0; digest="$(digest_of "$in/$name")" || rc=$?
  [ "$rc" -eq 0 ] || die "could not hash $name"
  [ "$digest" = "$want" ] || die "$name hashes to $digest, not the $want the build job recorded"
  expected_sums "$digest" "$name"
  cmp -s -- "$SCRATCH" "$in/SHA256SUMS" || die "SHA256SUMS is not exactly one line for $name at $digest"

  # Every check has passed: the first write into --out.
  mkdir -p -- "$out"
  cp -- "$in/$name" "$out/$name"
  printf '%s  %s\n' "$digest" "$name" > "$out/SHA256SUMS"
  echo "release-artifact.sh: verified $name (sha256 $digest): the build's record and its SHA256SUMS agree; the tarball was not opened"
}

# ── arguments ────────────────────────────────────────────────────────────
VERB=""
TAG="" DIR="" DIGEST="" IN="" OUT=""
HAVE=" "
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    record|verify)
      [ -z "$VERB" ] || bad_usage "one verb, not two: $VERB and $1"
      VERB="$1"; shift ;;
    --tag|--dir|--digest|--in|--out)
      [ $# -ge 2 ] || bad_usage "$1 needs a value"
      case "$1" in
        --tag) TAG="$2" ;; --dir) DIR="$2" ;; --digest) DIGEST="$2" ;; --in) IN="$2" ;; --out) OUT="$2" ;;
      esac
      HAVE="$HAVE$1 "; shift 2 ;;
    *) bad_usage "unknown argument: $1" ;;
  esac
done

case "$VERB" in
  record) want=(--tag --dir) ;;
  verify) want=(--tag --digest --in --out) ;;
  *) bad_usage "a verb is required: record or verify" ;;
esac
for flag in --tag --dir --digest --in --out; do
  case " ${want[*]} " in
    *" $flag "*) [[ "$HAVE" == *" $flag "* ]] || bad_usage "$VERB needs $flag" ;;
    *) [[ "$HAVE" != *" $flag "* ]] || bad_usage "$flag is not a flag of $VERB" ;;
  esac
done

case "$VERB" in
  record) record "$TAG" "$DIR" ;;
  verify) verify "$TAG" "$DIGEST" "$IN" "$OUT" ;;
esac
