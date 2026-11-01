#!/usr/bin/env bash
# The shared Markdown library's provenance, checked BEFORE it is installed
# (M8.16 and section 3.6 of docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md,
# amended 2026-10-31; wave 8a).
#
# A registry signature proves a package came from the registry; it does not
# prove WHOSE repository built it. This script closes that gap for the one
# package pwa/ renders documents with: it packs the exact version the lock
# names, proves the packed bytes are the bytes the lock's integrity records,
# and then asks GitHub for the build attestation, pinned to the library's own
# repository, its release workflow, the version's tag and hosted runners. A
# tarball published from any other repository or workflow fails here.
#
# It runs FIRST in `build-pwa`, before ui's and pwa's `npm ci`: an install runs
# every installed package's lifecycle scripts, and a tarball published outside
# the release workflow could use them to plant the `gh` and `openssl` this
# check then runs. So it needs only node, `npm pack`, `openssl`, `gh` and
# pwa/package-lock.json, and never reads node_modules.
#
# Run from the repository root. `gh` reads GH_TOKEN from its own environment.
# Both network calls (the pack and the attestation lookup) run under bounded.sh,
# a 90 s deadline per attempt and one retry, so a stalled registry or API ends
# the step in at most about 3 minutes; a call that never answers is a failure, and
# the script fails closed on it like on any other.
# Exit 0: verified. Any other exit: the library is not what the lock says, or
# the check could not be made; an outage reds the job and the remedy is a re-run.
set -euo pipefail

bounded="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bounded.sh"
REPO=Synapsium-Labs/docserver
SIGNER=Synapsium-Labs/docserver/.github/workflows/release.yml

lock=pwa/package-lock.json
read -r version integrity < <(node -e '
  const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).packages["node_modules/@synapsium-labs/docserver"];
  if (!p || !p.version || !p.integrity) process.exit(1);
  console.log(p.version + " " + p.integrity);
' "$lock") || { echo "library-provenance: $lock does not record the library's version and integrity" >&2; exit 1; }

# Under the runner's temp directory (or the system's), never inside the work tree. Left for the runner to reap.
dest=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lib-prov.XXXXXX")
"$bounded" 90 npm pack "@synapsium-labs/docserver@$version" --pack-destination "$dest" --silent >/dev/null
tgz="$dest/synapsium-labs-docserver-$version.tgz"

actual="sha512-$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)"
if [ "$actual" = "$integrity" ]; then
  echo "library-provenance: the packed tarball matches the lock's integrity"
else
  echo "library-provenance: the packed tarball is not the one the lock records" >&2
  echo "  lock:   $integrity" >&2
  echo "  packed: $actual" >&2
  exit 1
fi

"$bounded" 90 gh attestation verify "$tgz" --repo "$REPO" --signer-workflow "$SIGNER" --source-ref "refs/tags/v$version" --deny-self-hosted-runners
echo "library-provenance: @synapsium-labs/docserver@$version was built by $SIGNER at refs/tags/v$version"
