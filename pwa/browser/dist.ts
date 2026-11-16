// The browser leg's one production build: made by the browser config's global setup (`globalSetup.ts`) once per
// vitest run, sealed read-only, served to every file (`app.ts`'s `sharedDist`) and removed at teardown. Node imports
// only, so the global setup can load it in vitest's main process without the app half's browser-side imports.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PWA = path.join(import.meta.dirname, '..');

/** The key the global setup provides the build's directory under, and `sharedDist` injects. */
export const DIST_KEY = 'browserDist';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's one production build of the PWA (`browser/globalSetup.ts`), sealed read-only. */
    browserDist: string;
  }
}

// Runs in a node child, cwd the PWA package, as `test/markdown-worker-built.test.ts` builds: the app's own config, a
// production build (vitest's NODE_ENV=test would build the `development` export conditions), into argv[1]. Not in
// a test file's jsdom realm, whose URL the PWA plugin's file writes reject.
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

/** Build the PWA into a fresh temporary directory and return it. The caller removes it (`removeDist`). A browser file
 *  never calls this: the run builds once (`globalSetup.ts`) and every file serves that build (`sharedDist`). A failed
 *  build removes its directory and throws with the build's own output. */
export function buildDist(): string {
  const out = mkdtempSync(path.join(tmpdir(), 'ccrc-browser-dist-'));
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
      { cwd: PWA, env, encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    removeDist(out);
    throw e;
  }
  return out;
}

/** Every directory and file under `dir`, `dir` itself last. A symbolic link is listed, never followed. */
function treeOf(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...treeOf(p));
    else out.push(p);
  }
  out.push(dir);
  return out;
}

/** Make a build read-only: files 0444, directories 0555, so no file can add, change or remove what another serves.
 *  A per-file build could never see another file's writes; a shared one could, so it refuses them. A symbolic link
 *  (a build makes none) is refused rather than followed out of the tree. */
export function sealDist(dist: string): void {
  for (const p of treeOf(dist)) {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`the PWA build holds a symbolic link, ${path.relative(dist, p)}: refused`);
    chmodSync(p, st.isDirectory() ? 0o555 : 0o444);
  }
}

/** Remove a build, sealed or not: its directories are made writable first, so the walk can enter and empty them.
 *  Undefined, or a directory that is not there, is a no-op. */
export function removeDist(dist: string | undefined): void {
  if (dist === undefined || !existsSync(dist)) return;
  const unseal = (dir: string): void => {
    chmodSync(dir, 0o755);
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) unseal(path.join(dir, e.name));
  };
  unseal(dist);
  rmSync(dist, { recursive: true, force: true });
}
