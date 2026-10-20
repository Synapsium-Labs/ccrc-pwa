// The consolidation wave's census module (D-5849; ARCH-40 (#775); spec 2026-10-19 §5.1 rule 3). Every count a wave's
// exit or a PR body quotes comes from one of these NAMED queries, run on the PR's tip, never typed. Each query returns
// the sites it found (`{ file, line, text }`), so a count is the list's length and a PR body can print the list.
// `consolidation-census.test.ts` holds each query against a fixture tree and finds its cited site on the real one.
// No count is pinned here: a census reports until its series reaches its target, and the may-only-shrink pin lands in
// the commit that reaches it (spec §5.1 rule 3, rev 2).
//
// KNOWN WIDTH, every query: comments are dropped LINE by line. A line whose first token is `//`, `*` or `/*` is prose,
// and a trailing `// …` on a code line is cut. A line inside a block comment that does not start with `*`, and a call
// assembled from pieces, are not seen.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: every query's default tree. A fixture tree passes its own root in its place. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One site a query found: the repo-relative file, the 1-based line and the line's text as written. */
export interface CensusSite { readonly file: string; readonly line: number; readonly text: string }

/** Every `.ts`/`.tsx`/`.mjs` file under `root/dir`, sorted; declaration files and `__`-prefixed transient mutants
 *  (the `boot.test.ts` precedent in `single-definition.test.ts`'s `sources`) are skipped. */
function sourceFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(?:tsx?|mjs)$/.test(e) && !/\.d\.[mc]?ts$/.test(e)) out.push(p);
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** A line as code: `''` for a comment line, and a trailing `// …` cut (a `//` after `:` or a quote is a URL or a
 *  string, and stays). Line numbers are kept, because the caller indexes by them. */
export function codeOf(line: string): string {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return '';
  return line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
}

/** Every match of `re` (global) on a code line of each file under `dirs`, one site per match. */
function sitesOf(root: string, dirs: readonly string[], re: RegExp, skip: (rel: string) => boolean = () => false): CensusSite[] {
  const out: CensusSite[] = [];
  for (const dir of dirs) {
    for (const f of sourceFiles(root, dir)) {
      const file = path.relative(root, f).split(path.sep).join('/');
      if (skip(file)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
        for (const _ of codeOf(text).matchAll(re)) out.push({ file, line: i + 1, text });
      });
    }
  }
  return out;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `recordFeedEvent(` call expressions under `server/src`, outside `coord/store.ts` (which defines the door and may
 *  call itself). A method SIGNATURE (`recordFeedEvent(epoch: number, …)` opening a line) is a declaration, not a call.
 *  16 on `f64c27b65`. The feed's writer set is NOT pinned here; C1e lands it (D-5849). */
export function feedRecordCallSites(root: string = REPO): CensusSite[] {
  return sitesOf(root, ['server/src'], /\brecordFeedEvent\s*\(/g, (f) => f === 'server/src/coord/store.ts')
    .filter((s) => !/^\s*(?:(?:public|private|protected|async)\s+)*recordFeedEvent\s*\([^)]*:/.test(s.text));
}

/** `includes(RECLAIM_PAUSE_MARKER)` expressions under `server/src`: the private parsers of the pause switch. Files
 *  that merely NAME the marker (an import, a sentence template, a comment) are not parsers; `filesNaming` counts
 *  those. 10 expressions in 6 files on `f64c27b65`, against 12 files naming it. */
export function reclaimPauseParseSites(root: string = REPO): CensusSite[] {
  return sitesOf(root, ['server/src'], /\bincludes\(\s*RECLAIM_PAUSE_MARKER\s*\)/g);
}

/** `const <X> = '<name>'` (either quote, optionally typed, optionally exported) under `server/src` and `shared/`:
 *  the definitions of one marker literal. `mail-disabled`: 2 on `f64c27b65` (`coord/rundefs.ts`, exported;
 *  `watch.ts`, private). */
export function markerDefinitions(name: string, root: string = REPO): CensusSite[] {
  const re = new RegExp(`\\bconst\\s+[A-Za-z_$][\\w$]*\\s*(?::[^=]+)?=\\s*(['"])${esc(name)}\\1`, 'g');
  return sitesOf(root, ['server/src', 'shared'], re);
}

/** The `$REG` marker vocabulary: the kebab-case values of every `const <X>_MARKER = '<name>'` on a code line under
 *  `server/src` and `shared/`. KNOWN WIDTH: a marker named outside a `_MARKER` constant (the stall watch's map keys)
 *  is not in it. */
function markerVocabulary(root: string): string[] {
  const re = /\bconst\s+[A-Z0-9_]*_MARKER\s*(?::[^=]+)?=\s*(['"])([a-z][a-z0-9-]*)\1/g;
  const names = new Set<string>();
  for (const s of sitesOf(root, ['server/src', 'shared'], re)) {
    for (const m of codeOf(s.text).matchAll(re)) names.add(m[2]!);
  }
  return [...names].sort();
}

/** Quoted marker-name literals (`'<name>'`, `"<name>"` or `` `<name>` ``, the whole name) on code lines under
 *  `server/src`, ONE SITE PER LITERAL (not per file, despite the name; group by `file` for files). Recorded; it gates
 *  nothing yet. NARROWER than the spec's "46 marker-name literals in server/src": the vocabulary is only the names a
 *  `const *_MARKER = '…'` defines (`markerVocabulary`), not the wider `$REG` vocabulary the spec counted (swap, usage,
 *  pool-epoch, tmproots and the other switches), so whoever first quotes this census records that gap (D-5849). */
export function markerLiteralFiles(root: string = REPO): CensusSite[] {
  const vocab = markerVocabulary(root);
  if (vocab.length === 0) return [];
  const re = new RegExp(`(['"\`])(?:${vocab.map(esc).join('|')})\\1`, 'g');
  return sitesOf(root, ['server/src'], re);
}

/** Files under `server/src` that name any of `needles` on ANY line, comments included: the "files that name it"
 *  count a parse census is told apart from. */
export function filesNaming(needles: readonly string[], root: string = REPO): string[] {
  return sourceFiles(root, 'server/src')
    .filter((f) => { const t = readFileSync(f, 'utf8'); return needles.some((n) => t.includes(n)); })
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
}
