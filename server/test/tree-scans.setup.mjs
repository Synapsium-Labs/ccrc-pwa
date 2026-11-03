// The tree-scan capture (D-7455; the design is in the header of .github/ci/tree-scanners.mjs). A setup file only
// when `CCRC_TREE_SCANS_OUT` names a file, which ci.yml sets in a full-suite run's server shards
// (vitest.select.config.ts adds this file then, and only then). It wraps fs's directory listers once per worker
// process and records, for the test file running now, which source roots it listed; at the end of that file it
// appends one line to `CCRC_TREE_SCANS_OUT` when it listed any. A developer's run never loads it.
//
// Blind spots (the plan unions this record with its static detector for them): a listing in a child process the
// test spawned, a listing through a mocked fs, and a listing of an ANCESTOR of the roots — the repository root, `server/`, a `readdirSync(REPO, { recursive: true })` or a `glob('**/*.ts', { cwd: REPO })` that walks into them — is matched against the path listed, which sits above every root, so it is not recorded.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { appendScan, rootOf, wrapListers } from '../../.github/ci/tree-scanners.mjs';

const out = process.env.CCRC_TREE_SCANS_OUT;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = Symbol.for('ccrc.treeScans.state');

if (out) {
  /** @type {{ roots: Set<string> }} */
  let state = globalThis[KEY];
  if (!state) {
    // Once per worker process: a worker that runs several files keeps its wrapped fs, and each file resets `roots`.
    const match = rootOf(REPO);
    state = globalThis[KEY] = { roots: new Set() };
    wrapListers(fs, (listed, cwd) => {
      const r = match(listed, cwd);
      if (r !== null) state.roots.add(r);
    });
    syncBuiltinESMExports();
  }
  // This file's listings: from here (before the test file is imported, so a scan at collection counts) to its end.
  state.roots = new Set();
  afterAll(({}, suite) => {
    const file = suite?.filepath ?? suite?.file?.filepath;
    if (state.roots.size === 0 || typeof file !== 'string') return;
    appendScan(out, path.relative(REPO, file).split(path.sep).join('/'), state.roots);
  });
}
