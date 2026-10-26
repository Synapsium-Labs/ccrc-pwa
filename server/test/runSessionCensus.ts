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
import { identifierReferences, parseSource } from './scan/parse.js';
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
  { file: 'server/src/coord/routes.ts', text: 'r.id === sessionId',
    why: 'a lookup of a REGISTRY record by its id (the approval route\'s child gate): no run is read' },
  { file: 'server/src/coord/routes.ts', text: 's.sessionId === byId',
    why: 'a row of the intent checkpoint\'s own session list, matched to the id the intent was declared for: no run is read' },
  { file: 'server/src/coord/openRun.ts', text: 'c.target!.claimedBy !== c.b.claimedBy',
    why: 'a review run names the coordinator of the run it reviews: one run row\'s claimant against the request\'s, no session is asked about' },
  { file: 'server/src/coord/openRun.ts', text: 'x !== c.b.claimedBy',
    why: 'drops the opener itself from claimantsOfSession\'s answer (a self-claimed run is admitted, D-3012): the binding is decided in claimantsOf' },
  { file: 'server/src/coord/dispatchDecide.ts', text: 'r.id === f.sessionId',
    why: 'a lookup of a REGISTRY record by its id, to measure the wrapper and identity of the session: no run is read' },
  { file: 'server/src/coord/closeDecide.ts', text: 'fresh.run.claimedBy === f.claimedBy',
    why: 'the sweep\'s compare-and-set: the claimant of ONE re-read run must still be the one the sweep measured, whichever session works it' },
  { file: 'server/src/coord/childReclaim.ts', text: 'v.id !== sessionId', count: 2,
    why: 'a ccd verb\'s JSON answer must name the session the server asked about: validation of an adapter reply, no run is read' },
  { file: 'server/src/childReclaimSweep.ts', text: 'a.sessionId === sessionId',
    why: 'an attention row of the feed names the session it is about: an alert\'s subject, no run is read' },
  { file: 'server/src/coord/childReclaim.ts', text: 'v.reclaimed !== sessionId',
    why: 'the reclaim verb\'s JSON answer must name the session the server asked it to reclaim: validation of an adapter reply, no run is read' },
  // ARCH-62 slice 4 (#797): the rest of the tree, named by what the site compares. Nothing below asks which run is a session's
  // that `bindingOf`/`childrenOf` could answer: each is the decider itself, a binding writer or counted reader of the store, an
  // attribute read, or a comparison of a record that is no run (mail, a path claim, a hook, a delegation checkpoint row, a transcript line).
  { file: 'server/src/archivedExpiry.ts', text: 'v.session !== sessionId',
    why: "a ccd verb's JSON answer must name the session the server asked about: validation of an adapter reply, no run is read" },
  { file: 'server/src/archivedExpiry.ts', text: 'v.expired !== sessionId',
    why: "a ccd verb's JSON answer must name the session the server asked about: validation of an adapter reply, no run is read" },
  { file: 'server/src/collectLane.ts', text: 'v.session !== sessionId',
    why: "a ccd verb's JSON answer must name the session the server asked about: validation of an adapter reply, no run is read" },
  { file: 'server/src/collectLane.ts', text: 'v.collected !== sessionId',
    why: "a ccd verb's JSON answer must name the session the server asked about: validation of an adapter reply, no run is read" },
  { file: 'server/src/coord/childSpent.ts', text: 'read.run.sessionBornFor !== read.run.sessionId',
    why: "one run's two own columns against each other (a birth recorded for another session is unplaceable): no session is asked which run is its" },
  { file: 'server/src/coord/claims.ts', text: 'c.heldBy === req.sessionId',
    why: "a path claim's holder against the requesting session: the claims table, no run is read" },
  { file: 'server/src/coord/close.ts', text: 'verifiedLine.id === sessionId',
    why: "a registry line's id against the session it was fetched for: a registry record, no run is read" },
  { file: 'server/src/coord/delegation-correlation.ts', text: 'a.parentId === e.sessionId',
    why: "a delegation checkpoint row or transcript event against the owner session it was read for: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/delegation-correlation.ts', text: 'w.sessionId === mine.sessionId',
    why: "a delegation checkpoint row or transcript event against the owner session it was read for: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/delegation-correlation.ts', text: 'a.parentId === mine.sessionId',
    why: "a delegation checkpoint row or transcript event against the owner session it was read for: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/delegation-correlation.ts', text: 'event.sessionId === mine.sessionId',
    why: "a delegation checkpoint row or transcript event against the owner session it was read for: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/delegation-ingest.ts', text: 'sessionId !== owner.sessionId',
    why: "a delegation checkpoint row or transcript event against the owner session it was read for: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/delegation-ingest.ts', text: 'r.sessionId === id.sessionId',
    why: "a delegation checkpoint row or transcript event against the owner session it was read for: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/delegation-model.ts', text: 's.sessionId === request.sessionId',
    why: "a delegation checkpoint row against the session of the request: the delegation lane's own records, no run is read" },
  { file: 'server/src/coord/fingerprint.ts', text: 'r.id === run.sessionId',
    why: 'a lookup of a REGISTRY record by the id the run names: the run is the one in hand and the record is what is read' },
  { file: 'server/src/coord/heldFor.ts', text: 'minting.run.claimedBy !== parent',
    why: "the minting run's claimant against the parent childParentRead already decided: two claimants compared, no session is asked which run is its" },
  { file: 'server/src/coord/runBinding.ts', text: 'run.sessionId === sessionId',
    why: "the binding module's own rule, the one place a run is told to bind a session: this is the decider the other sites route through (the id-string test of bindsRun)" },
  { file: 'server/src/coord/runBinding.ts', text: 'run.sessionBornFor === incarnation.sessionId',
    why: "the binding module's own rule, the one place a run is told to bind a session: this is the decider the other sites route through (the birth test of bindsRun)" },
  { file: 'server/src/coord/runBinding.ts', text: 'r.claimedBy === minter',
    why: "the binding module's own rule, the one place a run is told to bind a session: this is the decider the other sites route through (parentOrMinter: an undecided run of the minting claimant)" },
  { file: 'server/src/coord/runBinding.ts', text: 'r.claimedBy === coordinatorId',
    why: "the binding module's own rule, the one place a run is told to bind a session: this is the decider the other sites route through (childrenOf: the runs a coordinator claims)" },
  { file: 'server/src/coord/stall.ts', text: "hook.sessionId === ''",
    why: "a hook fact's session id tested for empty: a Claude Code hook record, no run is read" },
  { file: 'server/src/coord/stall.ts', text: "hook.sessionId !== ''",
    why: "a hook fact's session id tested for empty: a Claude Code hook record, no run is read" },
  { file: 'server/src/coord/stall.ts', text: 'm.toId === input.sessionId', count: 2,
    why: "a mail row or delivery addressed to the session under judgement: the mail ledger's recipient, no run is read" },
  { file: 'server/src/coord/stall.ts', text: "r.claimedBy === ''",
    why: 'an empty claimant skipped when runs are grouped by claimant: the run rows are the input, nothing is bound by this test' },
  { file: 'server/src/coord/stall.ts', text: 'x.toId === input.sessionId',
    why: "a mail row or delivery addressed to the session under judgement: the mail ledger's recipient, no run is read" },
  { file: 'server/src/coord/stall.ts', text: 'd.toId === input.sessionId',
    why: "a mail row or delivery addressed to the session under judgement: the mail ledger's recipient, no run is read" },
  { file: 'server/src/coord/stall.ts', text: 'd.toId !== input.sessionId',
    why: "a delivery not addressed to the coordinator under judgement is skipped (the coord-blocked arm's held mail): the mail ledger's recipient, no run is read" },
  { file: 'server/src/coord/stall.ts', text: 'x.toId === who.sessionId',
    why: "a mail row or delivery addressed to the session under judgement: the mail ledger's recipient, no run is read" },
  { file: 'server/src/coord/store.ts', text: 'existing.claimedBy !== input.claimedBy',
    why: "the open path's own duplicate and claimant decision inside its transaction: a binding WRITER (BINDING_WRITER_VERBS), not a reader" },
  { file: 'server/src/coord/store.ts', text: '"SELECT CAST(id AS TEXT) AS idText, state FROM runs " +"WHERE program = ? AND wave = ? AND (waveOf IS ?) " +"AND claimed',
    why: "the open path's own duplicate and claimant decision inside its transaction: a binding WRITER (BINDING_WRITER_VERBS), not a reader (the planned-run dup arm)" },
  { file: 'server/src/coord/store.ts', text: 'SELECT project FROM runs WHERE sessionId = ? ORDER BY id LIMIT 1',
    why: 'an attribute read (ATTRIBUTE_READS): the project of the first run naming a session, no run is returned' },
  { file: 'server/src/coord/store.ts', text: "'SELECT CAST(id AS TEXT) AS idText, program, CAST(wave AS TEXT) AS waveText, ' +'CAST(waveOf AS TEXT) AS waveOfText, CAS",
    why: 'the series fetch itself (bindingRunsOf, one of the four counted readers): it selects the rows bindingOf and childrenOf decide over' },
  { file: 'server/src/coord/store.ts', text: 'row.claimedBy !== input.expectClaimedBy',
    why: "closeRun's compare-and-set: the claimant of ONE re-read run against the one the caller measured, whichever session works it" },
  { file: 'server/src/coord/store.ts', text: 'predecessor !== sessionId',
    why: "the open path's own duplicate and claimant decision inside its transaction: a binding WRITER (BINDING_WRITER_VERBS), not a reader (bindSession: whether the bind replaces the occupant, asked once and reused by the birth clear and the occupant stamp)" },
  { file: 'server/src/coord/store.ts', text: 'predecessor === sessionId',
    why: "the open path's own duplicate and claimant decision inside its transaction: a binding WRITER (BINDING_WRITER_VERBS), not a reader (bindSession: a same-session re-statement)" },
  { file: 'server/src/coord/store.ts', text: "'SELECT 1 AS x FROM run_events e JOIN runs r ON r.id = e.runId ' +`WHERE r.sessionId = ? AND e.detail = ? AND r.state NO",
    why: 'an attribute read (ATTRIBUTE_READS): strandedClear answers a boolean about the runs, no run is returned' },
  { file: 'server/src/coord/store.ts', text: 'SELECT MAX(at) AS t FROM run_events WHERE runId = ? OR runId IN (SELECT id FROM runs WHERE sessionId = ?)',
    why: 'an attribute read (ATTRIBUTE_READS): childStaleActivity answers a time, no run is returned' },
  { file: 'server/src/coord/store.ts', text: "'SELECT CAST(r.id AS TEXT) AS idText, r.sessionId, r.state, r.program, p.title AS programTitle, ' +'r.claimedBy, CAST(r.",
    why: "lastRunBySession's newest-run query, one of the four counted readers (last closed, any state): its own query, not a caller's decision" },
  { file: 'server/src/coord/store.ts', text: '`SELECT DISTINCT sessionId FROM runs WHERE sessionId IN (${ph}) AND state NOT IN ` +(activeOnly ? INACTIVE_RUN_STATES_SQ',
    why: "lastRunBySession's open-worker set, part of the counted last-closed reader: its own query, not a caller's decision" },
  { file: 'server/src/coord/store.ts', text: '`SELECT DISTINCT sessionId FROM runs WHERE sessionId IN (${ph}) AND state IN ${IDLE_RUN_STATES_SQL} AND state <> ?`',
    why: "lastRunBySession's parked-worker set, part of the counted last-closed reader: its own query, not a caller's decision" },
  { file: 'server/src/coord/store.ts', text: "`SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +'JOIN runs rr ON rr.id = m.runId ' ",
    why: "mail of a PROGRAM, joined to its runs by the mail's run id: the detector reads the templated WHERE, and no session or claimant is asked" },
  { file: 'server/src/coord/store.ts', text: 'c.heldBy === input.sessionId',
    why: "a path claim's holder against the declaring session: the claims table, no run is read" },
  { file: 'server/src/hookstate.ts', text: 'sessionId === currentUuid',
    why: "a hook record's Claude Code session uuid against the pane's current uuid: pane identity, no run is read" },
  { file: 'server/src/stopDoneSweep.ts', text: 'l.sessionId === id',
    why: 'indexes the batched answer of lastRunBySession by the session it was asked about (the store did the last-closed decision): a keyed row, no series is decided' },
  { file: 'server/src/tmpSweepLane.ts', text: 'read.id !== sessionId',
    why: 'excludes a self-claimed run from the coordinators to mail: a claimant against the session whose coordinator is asked, the run having been chosen by survivorOf' },
  { file: 'server/src/transcript/parse.ts', text: "r['sessionId'] === ofUuid",
    why: "a transcript line's session uuid against the transcript's own: transcript parsing, no run is read" },
  { file: 'server/src/turnmark.ts', text: 'sessionId !== currentUuid',
    why: "a turn marker's Claude Code session uuid against the pane's current uuid: pane identity, no run is read" },
  { file: 'server/src/watch.ts', text: 'r.sessionId === s.id',
    why: "a delegation checkpoint row (observation interval, bucket cursor or activity) against the owner session of the pass: the delegation lane's own records, no run is read" },
  { file: 'server/src/watch.ts', text: 'r.sessionId === id', count: 5,
    why: "a delegation checkpoint row (observation interval, bucket cursor or activity) against the owner session of the pass: the delegation lane's own records, no run is read" },
  { file: 'server/src/watch.ts', text: 'r.sessionId !== p.id',
    why: "a delegation checkpoint row (observation interval, bucket cursor or activity) against the owner session of the pass: the delegation lane's own records, no run is read" },
  { file: 'server/src/watch.ts', text: 'r.sessionId !== owner.id',
    why: "a delegation checkpoint row (observation interval, bucket cursor or activity) against the owner session of the pass: the delegation lane's own records, no run is read" },
  { file: 'server/src/watch.ts', text: 'r.sessionId === owner.id',
    why: "a delegation checkpoint row (observation interval, bucket cursor or activity) against the owner session of the pass: the delegation lane's own records, no run is read" },
  { file: 'server/src/watch.ts', text: 'a.parentId === event.sessionId',
    why: "a delegation checkpoint row (observation interval, bucket cursor or activity) against the owner session of the pass: the delegation lane's own records, no run is read" },
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

/** The store binding readers the spec's reader list (K10) names that select by a RUN id, not by a session or claimant, were
 *  `resolveCoordinator` and `resolveWorker` (they read one run's own `claimedBy` / `sessionId` column, which the raw detector
 *  never saw). ARCH-62 slice 4 (orchestrator ruling: they count) folded them onto `run(id)` (`coordinatorOfRun`,
 *  `workerOfRun`, `coord/bindingReads.ts`), and `FOLDED_RUN_KEYED_READS` names them so the census can show they are gone
 *  from the store: the exit's number is the detector's alone. */
export const FOLDED_RUN_KEYED_READS: readonly string[] = ['resolveCoordinator', 'resolveWorker'];

/** A caller of `runNamesSession` outside `runBinding.ts`. The helper is `run.sessionId === id` behind a name, which the
 *  equality detector cannot see, so wrapping a site in it must not lower the census silently: each caller is pinned here with
 *  its exact count and a reason. A call counts under the helper's name, a local alias of its import or a namespace; any
 *  other reference (a re-export, a copy, a value passed on) is red in `runNamesSessionEscapes`, so no name can hide a call. These are id-string decisions by name, NOT routing through `bindingOf`/`childrenOf`; the
 *  exit measurement of the final routing slice accounts for them. */
export interface NamesSessionCaller { readonly file: string; readonly count: number; readonly why: string }

export const RUN_NAMES_SESSION_CALLERS: readonly NamesSessionCaller[] = [
  { file: 'server/src/coord/childReclaim.ts', count: 1,
    why: 'the minting run of a child marker is ONE run with no series in hand: it names the session or it does not (not-a-child)' },
  { file: 'server/src/coord/childSpent.ts', count: 1,
    why: 'the minting run is ONE run with no series in hand: childBirthOf asks only whether it names the session before it places a birth' },
  { file: 'server/src/childReclaimSweep.ts', count: 2,
    why: 'a hold candidate and a minting run are single runs with no series in hand: the sweep asks only whether the run names the session' },
];

const HELPER = 'runNamesSession';

/** Every reference to the helper in one source text, sorted into the CALLS (`runNamesSession(…)`, a call through a local
 *  alias of an aliased import `import { runNamesSession as n }`, or `ns.runNamesSession(…)` through a namespace import)
 *  and the ESCAPES: any other reference (a re-export under any name, a copy into a local, a destructure, a value passed
 *  on), each of which would let a call be made under a name the call count cannot see. An import specifier is neither. */
function runNamesSessionUsesOf(text: string, file: string): { calls: number; escapes: string[] } {
  const refs = identifierReferences(text, file, new Set([HELPER]));
  return {
    calls: refs.filter((r) => r.role === 'call').length,
    escapes: refs.filter((r) => r.role === 'other').map((r) => `${file}:${r.line}: ${r.context.slice(0, 120)}`),
  };
}

/** The calls of `runNamesSession` in one source text, under its own name, a local alias or a namespace (an import is not a call). */
export function runNamesSessionCallsOf(text: string, file: string): number {
  return runNamesSessionUsesOf(text, file).calls;
}

/** The references to `runNamesSession` in one source text that are neither its import nor a call (see `runNamesSessionUsesOf`). */
export function runNamesSessionEscapesOf(text: string, file: string): string[] {
  return runNamesSessionUsesOf(text, file).escapes;
}

/** Every escaping reference to `runNamesSession` under `server/src` outside `runBinding.ts`: the census of its callers is
 *  every way the helper is reached only while this is empty. */
export function runNamesSessionEscapes(root: string = REPO): string[] {
  const out: string[] = [];
  for (const f of tsFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    if (file === 'server/src/coord/runBinding.ts') continue;
    out.push(...runNamesSessionEscapesOf(readFileSync(f, 'utf8'), file));
  }
  return out;
}

/** The callers of `runNamesSession` under `server/src` outside `runBinding.ts`: file -> count. */
export function runNamesSessionCallers(root: string = REPO): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of tsFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    if (file === 'server/src/coord/runBinding.ts') continue;
    const n = runNamesSessionCallsOf(readFileSync(f, 'utf8'), file);
    if (n > 0) out[file] = n;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
