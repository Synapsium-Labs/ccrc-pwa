// node-pty ships `spawn-helper` WITHOUT its executable bit, and on macOS that
// is not cosmetic: every `pty.spawn` fails with `posix_spawnp failed.` — the
// server cannot open a single pane, and 55 tests in this suite fail with a
// message that names neither node-pty nor a permission.
//
// MEASURED, on this repo's own pinned node-pty 1.1.0:
//   prebuilds/darwin-arm64/spawn-helper  ->  -rw-r--r--
// and `chmod +x` on that one file is the whole fix.
//
// WHY A POSTINSTALL AND NOT A COMMITTED PATCH: the file is inside
// node_modules, so `npm ci` recreates it — and recreates the bug — on every
// clean install and in CI. A postinstall is the only hook that runs at the
// moment the file appears.
//
// LINUX IS UNTOUCHED. The helper is a darwin-only part of node-pty (Linux
// builds do not ship one), so on that platform this script finds nothing and
// exits 0 without writing anything.
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

if (process.platform !== 'darwin') process.exit(0);

let root;
try {
  // Resolved through node's own lookup rather than a hardcoded ../node_modules
  // path: this package is installed both at the repo root and, in a release
  // tarball, beside a tree whose layout is not this checkout's.
  root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
} catch {
  process.exit(0);   // not installed (a --omit=optional install, or a pruned tree)
}

const helper = path.join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
if (!existsSync(helper)) process.exit(0);

const mode = statSync(helper).mode & 0o777;
if (mode & 0o111) process.exit(0);            // already executable — nothing to do

chmodSync(helper, mode | 0o755);
console.log(`node-pty: made ${path.relative(process.cwd(), helper)} executable `
  + `(it ships 0${mode.toString(8)}, and pty.spawn fails with "posix_spawnp failed." without this)`);
