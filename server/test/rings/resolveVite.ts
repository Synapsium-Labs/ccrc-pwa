/**
 * D-6045 (Task C0l; ARCH-04 (#545), stage 1), shared by stage 3 (D-6118). The one place the ring rules resolve a
 * `pwa/src` or `ui/src` specifier the way the PWA's bundler does: Vite tries an extension-less specifier as `.mjs`
 * before `.ts`, and the `@/` and `@ccrc/ui` doors lead into `ui/src`. `mjs-node.test.ts` walks the bundle's reach
 * with it, and `pwa-rings.test.ts` reads where an edge lands with it, never with a resolver of its own.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './walkSrc.js';

/** Vite's default `resolve.extensions`, in its order. */
const VITE_EXTS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
/** What a `.js`-style specifier may name in a TypeScript tree. */
const TS_TWINS: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'] };

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

/** The absolute file a specifier names from `fromAbs`, `'external'` for a bare package, or `null` when a relative
 *  or aliased specifier names no file. */
export function resolveVite(fromAbs: string, spec: string): string | 'external' | null {
  const s = spec.replace(/[?#].*$/, '');
  let base: string;
  if (s === '@ccrc/ui') return path.join(REPO, 'ui', 'src', 'index.ts');
  if (s.startsWith('@/')) base = path.join(REPO, 'ui', 'src', s.slice(2));
  else if (s.startsWith('./') || s.startsWith('../')) base = path.resolve(path.dirname(fromAbs), s);
  else return 'external';
  if (isFile(base)) return base;
  const ext = path.extname(base);
  for (const twin of TS_TWINS[ext] ?? []) if (isFile(base.slice(0, -ext.length) + twin)) return base.slice(0, -ext.length) + twin;
  for (const e of VITE_EXTS) if (isFile(base + e)) return base + e;
  for (const e of VITE_EXTS) if (isFile(path.join(base, `index${e}`))) return path.join(base, `index${e}`);
  return null;
}
