#!/usr/bin/env bash
# Puts the shellcheck server/test/shellcheck-baseline.json pins on PATH, on a Linux runner
# (D-7995). The image ships an older shellcheck, and a count from another version means nothing, so the ratchet
# refuses to judge with one. The baseline is the one place the version and the tarball's sha256 live.
#
# The caller gives this a deadline (bounded.sh) and goes on if it fails: the ratchet then fails on the shard that holds
# it, naming the version, and no other job waits on a download it does not need.
set -euo pipefail

baseline="$(dirname "$0")/../../server/test/shellcheck-baseline.json"
version="$(jq -er .shellcheckVersion "$baseline")"
sum="$(jq -er .shellcheckSha256 "$baseline")"
dir="$RUNNER_TEMP/ccrc-shellcheck"
tarball="shellcheck-v$version.linux.x86_64.tar.xz"

mkdir -p "$dir"
curl --fail --location --silent --show-error --max-time 30 -o "$dir/$tarball" \
  "https://github.com/koalaman/shellcheck/releases/download/v$version/$tarball"
(cd "$dir" && printf '%s  %s\n' "$sum" "$tarball" | shasum -a 256 -c -)
tar -xJf "$dir/$tarball" -C "$dir" --strip-components=1 "shellcheck-v$version/shellcheck"
echo "$dir" >> "$GITHUB_PATH"
