#!/usr/bin/env bash
# install.sh — stage-2 bootstrap: build from this checkout, then hand off to
# `ccrc install` (ccd/ccrc), which owns every converge decision. This script
# never touches ~/.ccrc, ~/.local/bin or systemd — bootstrap builds, the verb
# installs. Re-running is safe: npm ci and the builds are idempotent and the
# verb converges.
set -euo pipefail
HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "usage: bash install.sh — build this checkout and run 'ccrc install' (single box, localhost)"
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "install.sh: node is not installed — install Node (nodesource or nvm), then re-run" >&2; exit 1; }
# The floor is READ from the shipped package.json — never a second copy
# (node-floor.test.ts pins the three package.jsons identical; the server does
# not degrade below it, it fails to boot on node:sqlite).
floor="$(node -e 'process.stdout.write(require(process.argv[1]).engines.node)' "$ROOT/server/package.json" 2>/dev/null)" \
  || { echo "install.sh: cannot read engines.node from $ROOT/server/package.json — is this a complete checkout?" >&2; exit 1; }
node -e '
const floor = process.argv[1].replace(/^>=/,"").trim();
const cur = process.versions.node;
const at = s => s.split(".").map(Number);
const [a,b,c] = at(cur), [x,y,z] = at(floor);
const ok = a>x || (a===x && (b>y || (b===y && c>=z)));
if (!ok) { console.error(`install.sh: node ${cur} is below the required ${floor}`); process.exit(1); }
' "$floor" || exit 1

echo "install.sh: building (server deps, PWA bundle, server dist)…"
( cd "$ROOT/server" && npm ci --no-audit --no-fund )
( cd "$ROOT/pwa" && npm ci --no-audit --no-fund && npm run build )
( cd "$ROOT/server" && npm run build )

exec bash "$ROOT/ccd/ccrc" install
