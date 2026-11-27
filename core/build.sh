#!/usr/bin/env bash
# core/build.sh — the Go core's one build command (spec 2026-11-24 §7).
#
#   bash core/build.sh <out-dir> [<goos>-<goarch> ...]
#
# Builds ccrc-core into <out-dir>/<goos>-<goarch>/ccrc-core (ccrc-core.exe on windows), for each platform named, or for
# every platform a release carries when none is. Its three callers run it rather than spell the command again:
# deploy/build-release.sh (all five, into the release tree), deploy/deploy.sh (the target box's one) and ci.yml's
# `test (core)` (all five). The flags make a build a function of the source and the Go version alone: CGO off, so no
# box needs a C library; -trimpath, so no path of the building machine is inside; -buildvcs=false, so the commit is not
# stamped in (it was, measured: vcs.revision), which would change every release's binaries at every merge and keep
# release-main.sh's compare from ever matching; -s -w, stripped. Go is needed HERE only: no box runs Go.
set -euo pipefail

TARGETS=(linux-amd64 linux-arm64 darwin-amd64 darwin-arm64 windows-amd64)
[ $# -ge 1 ] || { echo "core/build.sh: usage: bash core/build.sh <out-dir> [<goos>-<goarch> ...] (default: ${TARGETS[*]})" >&2; exit 2; }
command -v go >/dev/null 2>&1 \
  || { echo "core/build.sh: Go is not on PATH — ccrc-core is built from core/ on this machine (the version core/go.mod names); install Go and re-run" >&2; exit 1; }
OUT="$1"; shift
[ $# -gt 0 ] || set -- "${TARGETS[@]}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$(dirname "${BASH_SOURCE[0]}")"
for t in "$@"; do
  [[ "$t" =~ ^[a-z0-9]+-[a-z0-9]+$ ]] || { echo "core/build.sh: '$t' is not a platform named <goos>-<goarch>" >&2; exit 2; }
  goos="${t%-*}" goarch="${t#*-}" exe=ccrc-core
  [ "$goos" != windows ] || exe=ccrc-core.exe
  mkdir -p "$OUT/$t"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath -buildvcs=false -ldflags "-s -w" -o "$OUT/$t/$exe" ./cmd/ccrc-core \
    || { echo "core/build.sh: go build of ccrc-core for $t failed" >&2; exit 1; }
done
