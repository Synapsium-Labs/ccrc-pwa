// ARCH-62 (#797), the W0 census of the consolidation wave (spec 2026-10-19 §5.9, §5.1 rule 3): the server's run/session
// equality sites, and the store's binding readers, as NAMED queries over the tree. `run-session-census.test.ts` pins
// each count and shows each query against a fixture, so a later slice can only lower them.
//
// WHAT COUNTS AS AN EQUALITY SITE. A comparison (`===`, `!==`, `==`, `!=`) one of whose operands is a field or a bare
// name `sessionId`, `claimedBy` or `coordinatorId` (the three words the server uses for "which session is this run's
// worker or claimant"), in a `.ts` file under `server/src`; plus a store query (`db.prepare(...)`) that selects `runs`
// rows by one of the first two columns (through `prepare` or any local wrapper that is handed the SQL string) (`sessionId = ?`, `sessionId IN (...)`, `claimedBy = ?`, `OR` of the two, and the
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

/** An argument that STARTS with a quote or backtick: the SQL itself (a literal, a template, a concatenation), not a lambda or a
 *  call that merely holds it, which would count one site twice. */
const isLiteralArg = (a: { kind: string; text: string }): boolean => a.kind === 'string' || /^['"`]/.test(a.text.trimStart());

/** The equality sites of one source text, `file` being the label they carry. */
export function equalitySitesOf(text: string, file: string): EqualitySite[] {
  const parsed = parseSource(text, file);
  const out: EqualitySite[] = [];
  for (const c of parsed.comparisons) {
    const named = (c.leftLeaf !== null && WORDS.has(c.leftLeaf)) || (c.rightLeaf !== null && WORDS.has(c.rightLeaf));
    if (named && !c.absent) out.push({ file, line: c.line, kind: 'comparison', text: c.text.slice(0, 120) });
  }
  for (const c of parsed.calls) {
    // Any call, not only `prepare`: a local wrapper (`t(sql)`) that runs the query is the same site. The first argument that
    // is a runs query by the session columns is the site.
    const q = c.args.find((a) => isLiteralArg(a) && isRunsQuery(a.text, true));
    if (q !== undefined) out.push({ file, line: c.line, kind: 'query', text: q.text.slice(0, 120) });
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

/** A site the census sees that is NOT a decision about which run a session works: named with the reason, so a new one is a
 *  deliberate entry and a stale one is red. `text` is the site's own text (`EqualitySite.text`); `count` the number of sites
 *  with that text in `file` (default 1). ARCH-62 slice 3: the exit's "all through `bindingOf`/`childrenOf`" is about the
 *  sites that ask which run is a session's; a comparison of a registry row's id, a verb's reported id, the claimant of one
 *  run row (a compare-and-set or a reviewed run's own coordinator) or a checkpoint row asks something else. */
export interface NotBindingSite { readonly file: string; readonly text: string; readonly count?: number; readonly why: string }

export const NOT_BINDING_SITES: readonly NotBindingSite[] = [
  { file: 'server/src/coord/childReclaim.ts', text: 'v.id !== sessionId', count: 2,
    why: 'a ccd verb\'s JSON answer must name the session the server asked about: validation of an adapter reply, no run is read' },
  { file: 'server/src/childReclaimSweep.ts', text: 'a.sessionId === sessionId',
    why: 'an attention row of the feed names the session it is about: an alert\'s subject, no run is read' },
  { file: 'server/src/coord/childReclaim.ts', text: 'v.reclaimed !== sessionId',
    why: 'the reclaim verb\'s JSON answer must name the session the server asked it to reclaim: validation of an adapter reply, no run is read' },
];

/** The sites that still decide a binding by hand: every site but the `NOT_BINDING_SITES` ones. */
export function unroutedSites(sites: readonly EqualitySite[], notBinding: readonly NotBindingSite[] = NOT_BINDING_SITES): EqualitySite[] {
  const budget = new Map(notBinding.map((n) => [`${n.file}\u0000${n.text}`, n.count ?? 1]));
  return sites.filter((s) => {
    const k = `${s.file}\u0000${s.text}`;
    const left = budget.get(k) ?? 0;
    if (left === 0) return true;
    budget.set(k, left - 1);
    return false;
  });
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
    if (!c.args.some((a) => isLiteralArg(a) && isRunsQuery(a.text))) continue;
    const m = inside(c.start).sort((a, b) => (b.start - a.start))[0];
    if (m !== undefined && !text.slice(m.start, m.end).startsWith('private')) hits.add(m.name);
  }
  return [...hits].map((n) => n.slice('CoordStore.'.length))
    .filter((n) => !ATTRIBUTE_READS.includes(n) && !BINDING_WRITER_VERBS.includes(n)).sort();
}

/** The store methods that read the runs by session or claimant for an ATTRIBUTE, not for a run (see above). Named, so a
 *  new one is a deliberate entry. */
export const ATTRIBUTE_READS: readonly string[] = ['sessionProject', 'strandedClear', 'childStaleActivity'];

/** The store binding readers the spec's reader list (K10) names that select by a RUN id, not by a session or claimant: they
 *  read one run's own `claimedBy` / `sessionId` column. The raw detector never sees them (no session-keyed query), but they
 *  COUNT among the store's binding readers (orchestrator ruling on ARCH-62 slice 2); slice 4 folds them onto `run(id)`.
 *  Named here so the census number is honest until then: the session-keyed readers plus these. */
export const RUN_KEYED_READS: readonly string[] = ['resolveCoordinator', 'resolveWorker'];
