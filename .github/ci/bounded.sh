#!/usr/bin/env bash
# bounded.sh <seconds> <command...> — run an install command (npm ci, brew
# install, a browser download) under a hard deadline, at most twice (D-7689).
#
# WHY. An install that waits on the network with no deadline of its own holds
# its job until the job limit cancels it: one night, 28 jobs sat 20 to 30
# minutes in an apt call that the jobs beside them finished in about five
# seconds (D-7686, apt-bounded.sh). npm ci, brew and the playwright download
# wait on a registry or a CDN the same way. The healthy cost of each is
# seconds (npm ci about 10 s per package, measured over 30 runs), so a
# deadline in minutes is generous, and a second attempt is a fresh connection:
# a stall costs one deadline, not the job.
#
# The deadline is `timeout` (Linux), else `gtimeout` (macOS with coreutils),
# else perl's alarm (macOS without coreutils, where SIGALRM ends the command),
# so no runner runs an install with no deadline at all. apt-get needs root and
# a lock cleanup between attempts; it goes through apt-bounded.sh instead.
set -uo pipefail

if [ "$#" -lt 2 ] || ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: bounded.sh <seconds> <command...>" >&2
  exit 2
fi
limit="$1"
shift

if command -v timeout > /dev/null 2>&1; then
  deadline=(timeout -k 10 "$limit")
elif command -v gtimeout > /dev/null 2>&1; then
  deadline=(gtimeout -k 10 "$limit")
else
  # shellcheck disable=SC2016  # the perl program is literal
  deadline=(perl -e 'alarm shift @ARGV; exec @ARGV or die "bounded: cannot run $ARGV[0]: $!\n"' "$limit")
fi

for try in 1 2; do
  if "${deadline[@]}" "$@"; then
    exit 0
  fi
  echo "::warning::bounded: attempt $try of 2 failed or passed ${limit}s: $*"
done
exit 1
