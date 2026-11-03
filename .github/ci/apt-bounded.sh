#!/usr/bin/env bash
# apt-bounded.sh <seconds> <command...> — run an apt-using command as root
# under a hard deadline, at most twice (D-7686).
#
# WHY. On some hosted runners the image's first apt mirror stops answering:
# every index from it is `Ign`, apt falls over to the next mirror, fetches
# the InRelease files and then waits on the package indexes with no output
# and no end. Each such job sat in `apt-get update` until its 20- or
# 30-minute job limit cancelled it (28 jobs in one night: 25 in server-deps,
# 3 in storybook-a11y's `playwright install --with-deps`), while the jobs
# beside it in the same run finished the same update in about five seconds.
# A second attempt is a fresh connection, so a stall costs one deadline, not
# the job.
#
# The deadline runs AS ROOT (`sudo … timeout`), so it can kill apt-get and
# its method children, which a deadline running as the runner user cannot
# reliably reach through sudo. PATH is passed through because sudo's
# secure_path drops setup-node's node, which `playwright install-deps` needs.
# Between attempts any apt-get the deadline left behind is killed, so the
# retry does not fail on the lists lock it holds.
set -uo pipefail

if [ "$#" -lt 2 ] || ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: apt-bounded.sh <seconds> <command...>" >&2
  exit 2
fi
limit="$1"
shift

for try in 1 2; do
  if sudo env "PATH=$PATH" timeout -k 10 "$limit" "$@"; then
    exit 0
  fi
  echo "::warning::apt-bounded: attempt $try of 2 failed or passed ${limit}s: $*"
  sudo pkill -KILL -x apt-get 2>/dev/null || true
  sudo pkill -KILL -f '^/usr/lib/apt/methods/' 2>/dev/null || true
done
exit 1
