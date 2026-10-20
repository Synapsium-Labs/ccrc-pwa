/**
 * D-6045 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-04 (#545), stage 1). The
 * ring rules' one file walk, with a floor. Every rule under `server/test/rings/` lists its files here, never with a
 * walk of its own, and states the fewest files it expects: a walk that silently stepped outside its tree (a moved
 * directory, a wrong root, a narrowed pattern) visits nothing, and a rule over nothing passes. The floor makes that
 * case red instead.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A repo-relative path with `/` separators. */
export const rel = (abs: string): string => path.relative(REPO, abs).split(path.sep).join('/');

/** Source files a rule reads: TypeScript, TSX and ES modules. Declarations, tests and stories are not sources. */
export const SOURCE_RE = /\.(?:ts|tsx|mjs)$/;
const NOT_SOURCE_RE = /\.d\.[cm]?ts$|\.test\.tsx?$|\.stories\.tsx?$/;

export interface WalkOptions {
  /** Repo-relative directories to walk. */
  roots: readonly string[];
  /** The fewest files the walk must return; below it the walk throws. */
  min: number;
  /** Walk only the roots' own files, not their subdirectories (`shared/` is flat). */
  flat?: boolean;
  /** Narrows the source files kept (tested against the repo-relative path). */
  match?: RegExp;
}

/** Every source file under `roots`, repo-relative and sorted. `node_modules` is never entered. Throws, naming the
 *  roots, when fewer than `min` files are found. */
export function walkSrc({ roots, min, flat = false, match }: WalkOptions): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!flat && e.name !== 'node_modules') visit(abs, depth + 1);
      } else if (SOURCE_RE.test(e.name) && !NOT_SOURCE_RE.test(e.name)) {
        const r = rel(abs);
        if (!match || match.test(r)) out.push(r);
      }
    }
  };
  for (const r of roots) visit(path.join(REPO, r), 0);
  out.sort();
  if (out.length < min) {
    throw new Error(`walkSrc(${roots.join(', ')}): ${out.length} files, below the floor of ${min}; the walk is over `
      + 'the wrong tree, or the floor needs a reviewed edit');
  }
  return out;
}
