// The hibernation census's DERIVATION (D-5242, plan Task 17b): every reader in the server tree, `shared` and the PWA
// that can call a session dead, found by scanning for five things — never listed by hand. `hibernate-census.test.ts`
// holds the stance table against this scan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CENSUS_ROOTS = ['server/src', 'shared', 'pwa/src'] as const;

/** The five sources (spec §5.11's census, plan Task 17b), each one pattern over comment- and import-stripped source. */
export const CENSUS_SOURCES = {
  /** 1. a reader of `lifecycleIsDead` or `DEAD_LIFECYCLES` (and `isDeadLifecycle`, the reclaim ladder's alias of it). */
  'dead-lifecycle': /\b(?:lifecycleIsDead|DEAD_LIFECYCLES|isDeadLifecycle)\b/g,
  /** 2. a total `Record<SessionLifecycle, …>` table. */
  'lifecycle-table': /Record<\s*SessionLifecycle\s*,/g,
  /** 3. a comparison of a lifecycle or a claimant cause (or anything else) with `'stopped'`. */
  'stopped-compare': /[!=]==\s*'stopped'|'stopped'\s*[!=]==/g,
  /** 4. a reader of the tmux verdict: a `sessionVerdict(` call, a field typed from `SessionVerdict['verdict']` or
   *  mirroring its words (`'live' | 'gone'`, `PeerProbe.tmux`), and `coord/claims.ts`'s `LivenessVerdict`. */
  'tmux-verdict': /\.sessionVerdict\(|SessionVerdict\['verdict'\]|'live'\s*\|\s*'gone'|\bLivenessVerdict\b/g,
  /** 5. a comparison of `status`, `bucket` or `effectiveStatus` with `'dead'` — the readers that call a row dead with no
   *  lifecycle word at all — and of the two local names the PWA keeps for them (`SessionHeader`'s `st`, the coordinator
   *  `presence` derived from it). */
  'dead-compare': /\b(?:status|bucket|effectiveStatus|st|presence)\s*[!=]==\s*'dead'|'dead'\s*[!=]==\s*[\w.?]*\b(?:status|bucket|effectiveStatus|st|presence)\b/g,
} as const;
export type CensusSource = keyof typeof CENSUS_SOURCES;
export const CENSUS_SOURCE_NAMES = Object.keys(CENSUS_SOURCES) as CensusSource[];

/** Source text with comments and import/re-export statements removed: a name in a comment or an import reads nothing. */
export function stripForCensus(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"][^'"]+['"];?/gm, '');
}

export interface CensusFile { readonly rel: string; readonly text: string }

/** Every `.ts`, `.tsx` and `.mjs` file under the roots (declaration files excluded). */
export function censusFiles(): CensusFile[] {
  const out: CensusFile[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(?:ts|tsx|mjs)$/.test(name) || /\.d\.(?:ts|mts)$/.test(name)) continue;
      out.push({ rel: path.relative(REPO, p).split(path.sep).join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  for (const r of CENSUS_ROOTS) walk(path.join(REPO, r));
  return out;
}

/** `<source> <file>` → the number of hits there. */
export function censusScan(files: readonly CensusFile[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of files) {
    const text = stripForCensus(f.text);
    for (const k of CENSUS_SOURCE_NAMES) {
      const n = (text.match(CENSUS_SOURCES[k]) ?? []).length;
      if (n > 0) out.set(`${k} ${f.rel}`, n);
    }
  }
  return out;
}
