// `agent/src/server.ts` imports `shared/mark.mjs` for `bodyDigest`, so this
// package has the same emit hazard `server/test/module-format.test.ts` covers
// on the other side — and until this file existed, agent/tsconfig.json had no
// pin of any kind on its include list.
//
// The hazard: those imports resolve at type level through the hand-written
// `shared/mark.d.mts`, so dropping `"allowJs"` or `"../shared/**/*.mjs"` from
// agent/tsconfig.json leaves `tsc --noEmit` clean, leaves all 253 agent tests
// green (vitest transpiles sources and never reads `dist/`), and leaves
// `npm run build` exiting 0 — while `dist/shared/mark.mjs` silently stops
// existing. The built agent then throws ERR_MODULE_NOT_FOUND at startup.
//
// That failure is quieter here than on the server. `agent/CLAUDE.md`: the
// agent has NO HTTP routes, so the deploy's `verify-service.sh` (MainPID
// stability across a window longer than RestartSec) is the only post-restart
// check there is — the same mechanism that catches a `refuseToBoot`. A
// green-looking `systemctl restart` would otherwise hide it, and a fleet host
// with no agent is a PWA that can see nothing.
//
// The `.mjs` list is DERIVED from the imports rather than written out, so a
// future `.mjs` import is covered the day someone writes it. An empty set is a
// legitimate state and asserts nothing: the guard is "whatever you import, you
// emit", never "you must import these".
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.resolve(here, '..');
const repoRoot = path.resolve(agentRoot, '..');

/** Absolute paths of every `.mjs` module imported by a `.ts` file under `dir`,
 *  resolved against the importing file. */
function mjsImportsUnder(dir: string): string[] {
  const found = new Set<string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/from\s+'([^']+\.mjs)'/g)) {
        found.add(path.resolve(path.dirname(p), m[1]!));
      }
    }
  };
  walk(dir);
  return [...found].sort();
}

describe('emitted module format', () => {
  it('every shared/*.mjs imported by src/ is present in a real emit', () => {
    const imported = mjsImportsUnder(path.join(agentRoot, 'src'));
    const outDir = mkTmp('ccrc-agent-emit-');
    const r = spawnSync(
      process.execPath,
      [path.join(agentRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', outDir],
      { cwd: agentRoot, encoding: 'utf8' },
    );
    expect(r.stdout + r.stderr, 'the real build does not compile').toBe('');
    for (const abs of imported) {
      // rootDir is `..` (the repo root), so <repo>/shared/x.mjs emits to
      // <outDir>/shared/x.mjs.
      const emitted = path.join(outDir, path.relative(repoRoot, abs));
      expect(existsSync(emitted), `${path.relative(repoRoot, abs)} is imported by agent/src but `
        + 'not emitted — check "allowJs" and the "../shared/**/*.mjs" include in '
        + 'agent/tsconfig.json; the built agent dies at startup without it').toBe(true);
    }
  }, 180_000);
});
