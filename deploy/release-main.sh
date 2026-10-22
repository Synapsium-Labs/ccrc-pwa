#!/usr/bin/env bash
# release-main.sh — every merge to main whose BUILD differs from the newest
# release HEAD contains becomes a PRERELEASE; a merge whose build comes out
# identical cuts none (D-6390). A release is born on the `dev` channel (design
# 2026-09-20 §4, decision 2); `stable` is a promotion, release-stable.sh.
#
# THE DECISION IS MADE ON THE BUILT ARTIFACT, not on which paths changed.
# Every merge builds. The build is reproducible: the tarballs of three
# consecutive docs-only releases differed only in build.json and in
# MANIFEST's line for it, so a fingerprint of the extracted tarball that sets
# those aside is equal exactly when nothing that ships changed (D-6390, D-6408).
# A release is skipped only on a positive, exact, non-empty match with the
# base release's fingerprint; every other outcome releases (D-6393).
#
# The build, the decision and the publish are THREE ARMS, because the
# provenance bundle is produced by the workflow's attest ACTION, which has to
# run AFTER the decision and BEFORE the publish, and a bash script cannot run
# an action:
#
#   prepare  — no token, no gh. Refuse a dirty tree, derive the next PATCH tag
#              from the highest release-shaped tag, tag it LOCALLY (never
#              pushed here), build the candidate with build-release.sh (the one
#              builder) into $OUT_DIR/candidate, outside the attest step's
#              glob, and write $OUT_DIR/release-main.state as `built
#              candidate` (D-6499, D-6500).
#   compare  — GH_TOKEN. Pick the base (the newest release tag HEAD contains,
#              D-6392), download its tarball outside the checkout, check it
#              against its own SHA256SUMS, extract both tarballs, fingerprint
#              both (D-6408) and decide (D-6393). A skip deletes the local tag
#              and records `built unchanged`; a release moves the candidate
#              into $OUT_DIR and records `built true`. Prints one line saying
#              which (D-6501) and writes `release=<true|false>` for the attest
#              step's condition. A change to this script or to the workflow
#              releases without comparing (D-6409).
#   publish  — read the state, copy the attest step's bundle
#              ($CCRC_BUNDLE_PATH) to the name every `ccrc update` fetches,
#              refuse without it, write the notes (release-notes.mjs,
#              D-5548), push the tag, `gh release create` naming ALL THREE
#              artifacts `--prerelease --notes-file`, delete the tag again if
#              the publish never completes. A skip, or an already-tagged HEAD,
#              exits 0 having done nothing; an undecided build is refused.
#
# NOTHING REACHES ORIGIN BEFORE publish's push — so a failed attest step, a
# cancelled job between the arms, or a refused publish leaves origin exactly
# as it was and a re-run derives the same number. That is the property the
# one-script version's cleanup trap protected, kept across the split. Each
# state records the HEAD it was measured for, and compare and publish refuse a
# state for another commit (D-6500).
#
# WHY ONE WORKFLOW DOES ALL OF IT: a tag pushed with the workflow's own
# GITHUB_TOKEN never fires release.yml (GitHub suppresses workflow-caused
# events), and this repo carries no Actions secret that could push as someone
# else. So the main-push job must tag AND build AND attest AND publish itself.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-main.sh prepare|compare|publish [--out <dir>] — prepare: on a clean, untagged HEAD derive the next vX.Y.Z patch tag, tag LOCALLY, build the candidate with build-release.sh; compare: set the candidate against the newest release HEAD contains and decide whether this merge releases; publish: push the tag and publish tarball + SHA256SUMS + provenance bundle (\$CCRC_BUNDLE_PATH) as a prerelease"; }
die() { echo "release-main.sh: $*" >&2; exit 1; }

ARM=""
OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    prepare|compare|publish)
      [ -z "$ARM" ] || { echo "release-main.sh: one arm, not two: $ARM and $1" >&2; usage >&2; exit 2; }
      ARM="$1"; shift ;;
    --out)
      [ $# -ge 2 ] || { echo "release-main.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    *) echo "release-main.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$ARM" ] || { echo "release-main.sh: an arm is required: prepare, compare or publish" >&2; usage >&2; exit 2; }
[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"
STATE="$OUT_DIR/release-main.state"
SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'
# The two files that judge a comparison (D-6409): the workflow that runs it and
# the script that holds it.
JUDGES=(.github/workflows/release-main.yml deploy/release-main.sh)

# One line per outcome (D-6395, D-6501): printed, and appended to the job
# summary when there is one. A summary that cannot be written never fails the
# run.
say() {
  printf '%s\n' "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; } 2>/dev/null || :
  fi
}

# The attest step's condition: `release=true` only on an explicit release
# decision (D-6499).
set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    { printf 'release=%s\n' "$1" >> "$GITHUB_OUTPUT"; } 2>/dev/null || :
  fi
}

# Tag names on stdin; prints the highest release-shaped one. A version sort and
# not a lexical one: v1.9.10 outranks v1.9.9, which a lexical sort gets
# backwards. The script's only version sort. Exits 1 when no name is
# release-shaped; callers turn that into an empty answer.
newest() { grep -E "$SHAPE" | sort -V | tail -n1; }

# Highest release-shaped tag, patch + 1. Sets HIGHEST (empty when there is
# none) and NEXT; prepare reads it from here.
derive_tags() {
  local major minor patch
  HIGHEST="$(git -C "$ROOT" tag --list 'v*' | newest)" || HIGHEST=""
  if [ -n "$HIGHEST" ]; then
    IFS=. read -r major minor patch <<< "${HIGHEST#v}"
    NEXT="v$major.$minor.$((patch + 1))"
  else
    NEXT="v0.0.1"
  fi
}

# Reads $STATE into BUILT, TAG, SAME and HEAD_AT (empty when a key is absent).
read_state() {
  local k v
  BUILT=""; TAG=""; SAME=""; HEAD_AT=""
  while read -r k v; do
    case "$k" in built) BUILT="$v" ;; tag) TAG="$v" ;; same-as) SAME="$v" ;; head) HEAD_AT="$v" ;; esac
  done < "$STATE"
}

# ── the fingerprint (D-6408) ─────────────────────────────────────────────
# One line per entry below an extracted tarball's root, sorted in the C
# locale: <JSON path> TAB <type f|d|l> TAB <octal mode> TAB <size> TAB <sha256
# of a regular file, else empty> TAB <JSON link target, else empty>. A
# directory's size is written as 0 (its on-disk size is the filesystem's, not
# the tarball's). Exactly two entries are normalised, both at the top level:
# build.json loses sha, builtAt and version and is hashed as key-sorted JSON;
# MANIFEST loses its one line for build.json. A tree with entries but without
# both of them, any other entry type, a build.json that is not an object, or a
# MANIFEST that names build.json other than once, fails (rc 1, a message on
# stderr). An empty tree prints nothing, and the caller treats that as no match
# (D-6393).
read -r -d '' FP_JS <<'JS' || :
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[1];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : (v !== null && typeof v === 'object')
    ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
    : JSON.stringify(v);
const rows = [];
const seen = { build: false, manifest: false };
const normalise = (rel, body) => {
  if (rel === 'build.json') {
    const j = JSON.parse(body.toString('utf8'));
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new Error('build.json is not an object');
    for (const k of ['sha', 'builtAt', 'version']) {
      if (!Object.prototype.hasOwnProperty.call(j, k)) throw new Error('build.json has no ' + k);
      delete j[k];
    }
    seen.build = true;
    return Buffer.from(canon(j) + '\n');
  }
  if (rel === 'MANIFEST') {
    const lines = body.toString('utf8').split('\n');
    const at = [];
    lines.forEach((l, i) => { if (l.endsWith('  build.json')) at.push(i); });
    if (at.length !== 1) throw new Error('MANIFEST names build.json ' + at.length + ' times');
    lines.splice(at[0], 1);
    seen.manifest = true;
    return Buffer.from(lines.join('\n'));
  }
  return body;
};
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    const st = fs.lstatSync(full);
    const mode = (st.mode & 0o7777).toString(8);
    if (st.isSymbolicLink()) {
      rows.push([rel, 'l', mode, st.size, '', JSON.stringify(fs.readlinkSync(full))]);
    } else if (st.isDirectory()) {
      rows.push([rel, 'd', mode, 0, '', '']);
      walk(full);
    } else if (st.isFile()) {
      const top = rel.indexOf('/') < 0;
      const body = top ? normalise(rel, fs.readFileSync(full)) : fs.readFileSync(full);
      rows.push([rel, 'f', mode, body.length, sha(body), '']);
    } else {
      throw new Error('unsupported entry type: ' + JSON.stringify(rel));
    }
  }
};
try {
  walk(root);
  if (rows.length > 0 && !(seen.build && seen.manifest)) throw new Error('the tree holds no top-level build.json and MANIFEST');
  process.stdout.write(rows.map((r) => [JSON.stringify(r[0]), r[1], r[2], String(r[3]), r[4], r[5]].join('\t') + '\n').join(''));
} catch (e) {
  process.stderr.write('fingerprint: ' + e.message + '\n');
  process.exit(1);
}
JS

fingerprint() { node -e "$FP_JS" "$1" | LC_ALL=C sort; }

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

  derive_tags
  local highest="$HIGHEST" next="$NEXT"
  echo "release-main.sh: highest release tag: ${highest:-none}; next: $next"

  # A tag-stale checkout: local tags behind origin would derive a number
  # origin already has. Refuse rather than guess; nothing was tagged.
  if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$next" >/dev/null 2>&1; then
    die "origin already holds $next — this checkout's tags are behind origin; fetch tags (git fetch --tags origin) and re-run. Nothing was tagged, pushed or deleted"
  fi

  # The attest step signs every tarball in the out directory, and only an
  # explicit release decision may put one there (D-6499); one planted before
  # compare would be signed and published by no release.
  if compgen -G "$OUT_DIR/ccrc-*.tar.gz" >/dev/null; then
    die "a tarball is already in $OUT_DIR — the attest step would sign an artifact no release publishes; remove it and re-run. Nothing was tagged or built"
  fi

  # Tag LOCALLY (build-release.sh names the artifact by the tag at HEAD), build
  # into the candidate directory, and drop the local tag again if the build
  # fails so a re-run derives the same number.
  git -C "$ROOT" tag "$next" || die "git tag $next failed"
  if ! bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR/candidate"; then
    git -C "$ROOT" tag -d "$next" >/dev/null 2>&1 || :
    die "build-release.sh failed — the local tag $next was removed; nothing reached origin"
  fi
  printf 'built candidate\ntag %s\nhead %s\n' "$next" "$(git -C "$ROOT" rev-parse HEAD)" > "$STATE"
  echo "release-main.sh: built $next as a candidate in $OUT_DIR/candidate — tagged locally (NOT pushed); next: compare"
}

# ── compare ──────────────────────────────────────────────────────────────
# Sets VERDICT (skip|release), LINE (D-6501) and, on a skip, BASE for the
# candidate <tag>, using <d> as scratch. Always returns 0: the first check that
# fails releases with its reason, and only a positive, exact, non-empty match
# skips (D-6393).
judge() {
  local tag="$1" d="$2" out rc names first sums digest actual
  local -a sha=(sha256sum)
  [ "$(uname -s 2>/dev/null)" = Darwin ] && sha=(shasum -a 256)
  VERDICT=release; LINE=""; BASE=""

  BASE="$(git -C "$ROOT" tag --merged HEAD | grep -vxF -- "$tag" | newest)" || BASE=""
  if [ -z "$BASE" ]; then LINE="could not compare (HEAD contains no earlier release tag); releasing $tag"; return 0; fi
  local base="$BASE"

  # A comparer never approves its own change (D-6409).
  rc=0
  names="$(git -C "$ROOT" diff --name-only "$base" HEAD -- "${JUDGES[@]}")" || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (git diff against $base failed); releasing $tag"; return 0; fi
  if [ -n "$names" ]; then
    first="${names%%$'\n'*}"
    LINE="could not compare ($base..HEAD changes \"$first\", which judges this comparison); releasing $tag"; return 0
  fi

  # A published, non-draft release (D-6392).
  rc=0
  out="$(cd "$ROOT" && gh release view "$base" --json isDraft --jq .isDraft)" || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (gh release view $base exited $rc); releasing $tag"; return 0; fi
  if [ "$out" != false ]; then
    out="${out//$'\n'/ }"
    LINE="could not compare ($base is not a published release (gh answered '${out:0:80}')); releasing $tag"; return 0
  fi

  mkdir -p "$d/asset" "$d/base" "$d/head"
  rc=0
  (cd "$ROOT" && gh release download "$base" --pattern "ccrc-$base.tar.gz" --pattern SHA256SUMS --dir "$d/asset") >/dev/null || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (gh release download $base exited $rc); releasing $tag"; return 0; fi
  if [ ! -f "$d/asset/ccrc-$base.tar.gz" ] || [ ! -f "$d/asset/SHA256SUMS" ]; then
    LINE="could not compare ($base carries no ccrc-$base.tar.gz and SHA256SUMS); releasing $tag"; return 0
  fi

  # The tarball must match the one line of its own SHA256SUMS.
  sums="$(cat -- "$d/asset/SHA256SUMS"; printf x)"; sums="${sums%x}"
  digest="${sums:0:64}"
  if ! [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || [ "$sums" != "$digest  ccrc-$base.tar.gz"$'\n' ]; then
    LINE="could not compare ($base's SHA256SUMS is malformed); releasing $tag"; return 0
  fi
  rc=0
  actual="$("${sha[@]}" "$d/asset/ccrc-$base.tar.gz")" || rc=$?
  if [ "$rc" -ne 0 ] || [ "${actual%% *}" != "$digest" ]; then
    LINE="could not compare ($base's tarball does not match its SHA256SUMS); releasing $tag"; return 0
  fi

  rc=0; tar -xpzf "$d/asset/ccrc-$base.tar.gz" -C "$d/base" || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (could not extract $base's tarball); releasing $tag"; return 0; fi
  rc=0; tar -xpzf "$OUT_DIR/candidate/ccrc-$tag.tar.gz" -C "$d/head" || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (could not extract the candidate); releasing $tag"; return 0; fi

  rc=0; fingerprint "$d/base" > "$d/fp-base" || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (the fingerprint of $base failed); releasing $tag"; return 0; fi
  rc=0; fingerprint "$d/head" > "$d/fp-head" || rc=$?
  if [ "$rc" -ne 0 ]; then LINE="could not compare (the fingerprint of the candidate failed); releasing $tag"; return 0; fi
  if [ ! -s "$d/fp-base" ]; then LINE="could not compare (the fingerprint of $base is empty); releasing $tag"; return 0; fi
  if [ ! -s "$d/fp-head" ]; then LINE="could not compare (the fingerprint of the candidate is empty); releasing $tag"; return 0; fi

  if cmp -s "$d/fp-base" "$d/fp-head"; then
    VERDICT=skip
    LINE="built unchanged: $(wc -l < "$d/fp-base" | tr -d ' ') entries identical to $base"
    return 0
  fi
  # The paths that differ, JSON-quoted as the fingerprint wrote them. comm
  # leads a path that only the second file holds with a TAB. MANIFEST's digest
  # lines move with every content change and it sorts first, so it is named
  # only when nothing else differs (D-6501): the line names the real change.
  rc=0
  out="$(LC_ALL=C comm -3 "$d/fp-base" "$d/fp-head" | awk -F'\t' '{ p = ($1 == "" ? $2 : $1); if (p != last) { n++; if (n == 1) any = p; if (first == "" && p != "\"MANIFEST\"") first = p; last = p } } END { print n "\t" (first == "" ? any : first) }')" || rc=$?
  if [ "$rc" -ne 0 ] || [[ "$out" != [0-9]*$'\t'* ]]; then
    LINE="could not compare (the fingerprints differ, and listing how failed); releasing $tag"; return 0
  fi
  LINE="differs from $base: ${out%%$'\t'*} entries, first ${out#*$'\t'}; releasing $tag"
  return 0
}

compare() {
  [ -f "$STATE" ] || { echo "release-main.sh: no $STATE — run 'release-main.sh prepare' first" >&2; exit 2; }
  read_state
  if [ "$BUILT" = false ]; then
    echo "release-main.sh: nothing to compare — HEAD was already tagged; release.yml owns it"
    set_output false
    return 0
  fi
  local head; head="$(git -C "$ROOT" rev-parse HEAD)"
  [ "$BUILT" = candidate ] && [[ "$TAG" =~ $SHAPE ]] \
    || die "$STATE does not read 'built candidate' with a release tag — re-run prepare"
  [ "$HEAD_AT" = "$head" ] \
    || die "$STATE was measured for ${HEAD_AT:-no commit}, not HEAD $head — re-run prepare"
  local tag="$TAG" cand="$OUT_DIR/candidate/ccrc-$TAG.tar.gz" d
  [ -f "$cand" ] && [ -f "$OUT_DIR/candidate/SHA256SUMS" ] \
    || die "prepare's candidate is missing from $OUT_DIR/candidate — re-run prepare"

  d="$(mktemp -d)" || die "mktemp -d failed"
  judge "$tag" "$d"
  chmod -R u+rwx "$d" 2>/dev/null || :
  rm -rf -- "$d"

  if [ "$VERDICT" = skip ]; then
    # Nothing is pushed, attested or published; the provisional tag goes, so
    # the next merge derives the same number (D-6499).
    git -C "$ROOT" tag -d "$tag" >/dev/null || die "could not delete the local tag $tag"
    printf 'built unchanged\nsame-as %s\nhead %s\n' "$BASE" "$head" > "$STATE"
    set_output false
  else
    mv -- "$cand" "$OUT_DIR/ccrc-$tag.tar.gz"
    mv -- "$OUT_DIR/candidate/SHA256SUMS" "$OUT_DIR/SHA256SUMS"
    printf 'built true\ntag %s\nhead %s\n' "$tag" "$head" > "$STATE"
    set_output true
  fi
  say "$LINE"
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
  read_state
  local built="$BUILT" tag="$TAG" same="$SAME" head
  head="$(git -C "$ROOT" rev-parse HEAD)"
  if [ "$built" = unchanged ]; then
    [[ "$same" =~ $SHAPE ]] || die "malformed $STATE — re-run prepare"
    git -C "$ROOT" merge-base --is-ancestor "$same" HEAD 2>/dev/null \
      || die "$STATE names $same as the unchanged base, and HEAD does not contain it — re-run prepare"
    [ "$HEAD_AT" = "$head" ] \
      || die "$STATE was measured for ${HEAD_AT:-no commit}, not HEAD $head — re-run prepare"
    echo "release-main.sh: no release for this merge — built unchanged, the same as $same; nothing to push, attest or publish"
    return 0
  fi
  if [ "$built" = false ]; then
    echo "release-main.sh: nothing to publish — $tag was already tagged at checkout; release.yml owns it"
    return 0
  fi
  if [ "$built" = candidate ]; then
    die "compare never decided on $tag — refusing to publish an undecided build; nothing was pushed"
  fi
  [ "$built" = true ] && [[ "$tag" =~ $SHAPE ]] || die "malformed $STATE — re-run prepare"
  [ "$HEAD_AT" = "$head" ] \
    || die "$STATE was measured for ${HEAD_AT:-no commit}, not HEAD $head — re-run prepare"

  local tarball="$OUT_DIR/ccrc-$tag.tar.gz" sums="$OUT_DIR/SHA256SUMS" bundle="$OUT_DIR/ccrc-$tag.tar.gz.sigstore.json"
  [ -f "$tarball" ] && [ -f "$sums" ] || die "compare's artifacts are missing from $OUT_DIR — re-run prepare"

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
    || die "no provenance bundle at $bundle — the attest step must run between compare and publish (CCRC_BUNDLE_PATH names its output); refusing to publish an unattested release; nothing was pushed"

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
  prepare) prepare ;;
  compare) compare ;;
  publish) publish ;;
esac
