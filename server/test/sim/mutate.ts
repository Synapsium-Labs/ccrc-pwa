// A small in-tree mutation runner for deciders (Overlord W1a, D-8217). It copies mutation-run.py's contract
// (ccd/coordinator-skill/references/mutation-run.py) into TypeScript: a mutant is `old` -> `new` on a module's source, `old`
// must occur exactly once, a baseline copy must pass first, and a suite case that throws kills the mutant. Every copy is
// written under one mkTmp directory, never into server/src, and loaded with a dynamic import of a file name unique to it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkTmp } from '../tmpHelpers.js';

export interface Mutant { readonly id: string; readonly old: string; readonly new: string }
export type MutantStatus = 'killed' | 'survived' | 'invalid';
export interface MutantResult { readonly id: string; readonly status: MutantStatus; readonly detail: string }
/** score = killed / results.length; baselineCases = the suite cases the unmutated copy ran and passed. */
export interface MutationReport {
  readonly results: readonly MutantResult[]; readonly score: number; readonly baselineCases: number;
}
export interface MutantSet<M> {
  readonly modulePath: string; readonly mutants: readonly Mutant[];
  suite(mod: M): Readonly<Record<string, () => void>>;   // method syntax, so sets of different M share one record
}

const RELATIVE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"\n]*)\2/g;

/** Relative `from '…'` and `import('…')` specifiers become absolute paths, resolved against fromDir. (A file URL for a
 *  `.js` specifier naming a `.ts` source is not resolved by vitest's loader; an absolute path is.) */
export function rewriteRelativeImports(source: string, fromDir: string): string {
  return source.replace(RELATIVE, (_all, head: string, quote: string, spec: string) =>
    `${head}${quote}${path.resolve(fromDir, spec)}${quote}`);
}

function occurrences(text: string, needle: string): number {
  if (needle === '') return 0;
  let n = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) n++;
  return n;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** mutation-run.py's contract in TypeScript: `old` must occur exactly once; a baseline copy must pass first, else it
 *  throws; each mutant is written under one mkTmp directory, imported, and handed to `suite`; a suite case that
 *  throws kills it. A mutant whose `old` is absent or repeated, or whose copy fails to import, is `invalid`, and the
 *  run then throws `invalid: <id>: <detail>` after the last mutant. */
export async function runMutants<M>(set: MutantSet<M>): Promise<MutationReport> {
  const source = readFileSync(set.modulePath, 'utf8');
  const fromDir = path.dirname(set.modulePath);
  const dir = mkTmp('ccrc-mutants-');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const load = async (id: string, text: string): Promise<M> => {
    const file = path.join(dir, `m${++n}-${id.replace(/[^A-Za-z0-9_-]/g, '_')}${path.extname(set.modulePath)}`);
    writeFileSync(file, rewriteRelativeImports(text, fromDir));
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as M;
  };
  const errText = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  const runCases = (cases: Readonly<Record<string, () => void>>): string | null => {
    for (const [name, fn] of Object.entries(cases)) {
      try { fn(); } catch (err) { return `${name}: ${errText(err)}`; }
    }
    return null;
  };

  let baselineCases: number;
  try {
    const base = await load('baseline', source);
    const cases = set.suite(base);
    baselineCases = Object.keys(cases).length;
    if (baselineCases === 0) throw new Error('the suite ran no case');
    const failed = runCases(cases);
    if (failed !== null) throw new Error(failed);
  } catch (err) {
    throw new Error(`baseline failed: ${message(err)}`);
  }

  const results: MutantResult[] = [];
  for (const m of set.mutants) {
    const count = occurrences(source, m.old);
    if (count !== 1) {
      results.push({ id: m.id, status: 'invalid', detail: `old text occurs ${count} times, not once` });
      continue;
    }
    let mod: M;
    try {
      mod = await load(m.id, source.replace(m.old, () => m.new));
    } catch (err) {
      results.push({ id: m.id, status: 'invalid', detail: `syntax: ${message(err)}` });
      continue;
    }
    let cases: Readonly<Record<string, () => void>>;
    try {
      cases = set.suite(mod);
    } catch (err) {
      results.push({ id: m.id, status: 'invalid', detail: `suite: ${errText(err)}` });
      continue;
    }
    const failed = runCases(cases);
    results.push(failed === null
      ? { id: m.id, status: 'survived', detail: 'every suite case passed' }
      : { id: m.id, status: 'killed', detail: failed });
  }
  const invalid = results.filter((r) => r.status === 'invalid');
  if (invalid.length > 0) throw new Error(invalid.map((r) => `invalid: ${r.id}: ${r.detail}`).join('; '));
  const killed = results.filter((r) => r.status === 'killed').length;
  return { results, score: results.length === 0 ? 1 : killed / results.length, baselineCases };
}

/** The keys whose floor fell from `was` to `now`, a missing key included. */
export function floorsFallen(was: Readonly<Record<string, number>>, now: Readonly<Record<string, number>>): string[] {
  return Object.keys(was).filter((k) => !(k in now) || now[k]! < was[k]!);
}
