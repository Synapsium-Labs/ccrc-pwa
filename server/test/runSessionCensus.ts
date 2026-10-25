// ARCH-62 (#797), the W0 census of the consolidation wave (spec 2026-10-19 §5.9, §5.1 rule 3): the server's run/session
// equality sites, and the store's binding readers, as NAMED queries over the tree. `run-session-census.test.ts` pins
// each count and shows each query against a fixture, so a later slice can only lower them.
//
// WHAT COUNTS AS AN EQUALITY SITE. A comparison (`===`, `!==`, `==`, `!=`) one of whose operands is a field or a bare
// name `sessionId`, `claimedBy` or `coordinatorId` (the three words the server uses for "which session is this run's
// worker or claimant"), in a `.ts` file under `server/src`; plus a store query (`db.prepare(...)`) that selects `runs`
// rows by one of the first two columns (`sessionId = ?`, `sessionId IN (...)`, `claimedBy = ?`, `OR` of the two, and the
// `seriesRows` template whose column rides in `${where}`). An `.includes` or `Set.has` test is not a comparison here.
// KNOWN WIDTH: a comparison through a differently named local (`const sid = run.sessionId; sid === x`), a destructured
// name and a call assembled from pieces are not seen; the census is a floor on the sites a reader of the code would
// find by searching those three words, not a proof that no other site exists.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from './scan/parse.js';
import { BINDING_WRITER_VERBS } from '../src/coord/runBinding.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface EqualitySite { readonly file: string; readonly line: number; readonly kind: 'comparison' | 'query'; readonly text: string }

const WORDS = new Set(['sessionId', 'claimedBy', 'coordinatorId']);

/** Every `.ts` file under `dir` (relative to `root`), sorted; declaration files and `__`-prefixed mutants skipped. */
function tsFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.ts$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
    }
  };
  walk(path.join(root, dir));
  return out;
}

const QUERY_COLUMN = /\b(?:r\.)?(?:sessionId|claimedBy)\s*(?:=|IN)\s*[?(]/;

/** A `prepare(...)` argument that selects `runs` rows by the session or claimant column. The one query whose column rides
 *  in a template (`seriesRows`' `WHERE ${where}`) is told by that token, and only the site census counts it. */
const isRunsQuery = (arg: string, templated = false): boolean =>
  /\bruns\b/.test(arg) && /\bSELECT\b/.test(arg) && (QUERY_COLUMN.test(arg) || (templated && /WHERE \$\{where\}/.test(arg)));

/** The equality sites of one source text, `file` being the label they carry. */
export function equalitySitesOf(text: string, file: string): EqualitySite[] {
  const parsed = parseSource(text, file);
  const out: EqualitySite[] = [];
  for (const c of parsed.comparisons) {
    const named = (c.leftLeaf !== null && WORDS.has(c.leftLeaf)) || (c.rightLeaf !== null && WORDS.has(c.rightLeaf));
    if (named && !c.absent) out.push({ file, line: c.line, kind: 'comparison', text: c.text.slice(0, 120) });
  }
  for (const c of parsed.calls) {
    if (c.name === 'prepare' && c.args.length > 0 && isRunsQuery(c.args[0]!.text, true)) {
      out.push({ file, line: c.line, kind: 'query', text: c.args[0]!.text.slice(0, 120) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every equality site under `server/src` of `root`, by file then line. */
export function equalitySites(root: string = REPO): EqualitySite[] {
  const out: EqualitySite[] = [];
  for (const f of tsFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    out.push(...equalitySitesOf(readFileSync(f, 'utf8'), file));
  }
  return out;
}

/** The count per file, files with no site left out. */
export function countsByFile(sites: readonly EqualitySite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sites) out[s.file] = (out[s.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The store's BINDING READERS: the public methods of `CoordStore` that return runs, claimants or a parent selected by a
 * session or claimant id (a method whose body reads `seriesRows`, or holds a `runs` query on the columns above, and
 * whose answer is a run, a list of runs or the id of a coordinator). Not counted: a binding WRITER (`BINDING_WRITER_VERBS`,
 * whose own duplicate-run read is a decision inside its transaction) and a method that answers an attribute of the runs
 * (a project, a boolean), named in `ATTRIBUTE_READS`: it decides nothing about which run is a session's.
 */
export function storeBindingReaders(text: string, file = 'server/src/coord/store.ts'): string[] {
  const parsed = parseSource(text, file);
  const methods = parsed.symbols.filter((s) => s.kind === 'method' && s.name.startsWith('CoordStore.'));
  const hits = new Set<string>();
  const inside = (pos: number) => methods.filter((m) => m.start <= pos && pos < m.end);
  for (const m of methods) {
    if (!text.slice(m.start, m.end).startsWith('private') && /\bseriesRows\b/.test(text.slice(m.start, m.end))) hits.add(m.name);
  }
  for (const c of parsed.calls) {
    if (c.name !== 'prepare' || c.args.length === 0 || !isRunsQuery(c.args[0]!.text)) continue;
    const m = inside(c.start).sort((a, b) => (b.start - a.start))[0];
    if (m !== undefined && !text.slice(m.start, m.end).startsWith('private')) hits.add(m.name);
  }
  return [...hits].map((n) => n.slice('CoordStore.'.length))
    .filter((n) => !ATTRIBUTE_READS.includes(n) && !BINDING_WRITER_VERBS.includes(n)).sort();
}

/** The store methods that read the runs by session or claimant for an ATTRIBUTE, not for a run (see above). Named, so a
 *  new one is a deliberate entry. */
export const ATTRIBUTE_READS: readonly string[] = ['sessionProject', 'strandedClear'];

/** The store methods the spec's reader list names that select by a RUN id, not by a session or claimant: they read one run's
 *  own `claimedBy` / `sessionId` column (the run is already chosen), so they decide nothing about which run is a session's.
 *  The raw detector never sees them (no session-keyed query); named here so a final slice measuring "readers <= 4" cannot
 *  mistake them for folded. Legitimately different, pending an orchestrator ruling. */
export const RUN_KEYED_READS: readonly string[] = ['resolveCoordinator', 'resolveWorker'];
