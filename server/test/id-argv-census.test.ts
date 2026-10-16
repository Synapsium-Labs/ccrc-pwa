// THE ID-ARGV CENSUS (path identity W1a, spec §2.3).
//
// Every call of an id-taking `CCD_ARGV` builder in `server/src` is listed below, with where its id comes from and the
// check that stands before it, so that no id ccd could read as a flag reaches an argv the server composes unexamined.
// The scan is the discovery half and the table is the classification half, the same two-way shape as
// `verb-gate.test.ts` and `routes.test.ts`'s knownId census. A new call, or a new builder key, must classify itself
// here, or this suite goes red.
//
// THE CLAIM: 41 id-taking calls across 10 files.
//
// Origins:
//   `request`   a route's own parameter or body;
//   `stored`    a coord.db run row;
//   `registry`  a name the registry listing produced;
//   `collector` the collector's population.
// Gates: each names a check by its HOME (file, scope, text). When the home is the call's own scope, its text must
// stand above the call. When the call's scope reaches a gate that lives elsewhere, the row's `entry` must stand above
// the call. A gate in a caller (close's gates above `closeReviewRun` and `verifyDone`, dispatch's gate above
// `refuseSpentChild`) is pinned at its home only. A row whose gate lives in another scope and that has no `entry` is
// guarded through its callers: `stopArgvFor`'s three call sites and the `childSpent` helpers' callers have a case below.
//
// WHAT THIS DOES NOT COVER, stated plainly:
// - It recognises a call by the literal text `CCD_ARGV.<name>(`. An argv obtained any other way is invisible to it;
//   `ccdargv-brand.test.ts` and `whitelist-subset.test.ts` police argv provenance.
// - A gate is checked by its text standing in place, not by tracing every path. That each gate REFUSES is proved by
//   the behaviour suites: `knownid-registry-id`, `stored-row-id-gates`, `single-read-bad-id`, `registry-refused`,
//   `registry-refused-callers`, `run-open-registry-id`, `run-route-registry-id`, `advance-registry-id`,
//   `expire-id-boundary`, `collect-id-pins` and `ccd-stop-argv-order`.
// - The server gate is not an OS wall: a session can still run `ccd` itself. ccd's own half is a later wave.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_ARGV } from '../src/ccdargv.js';
import type { CollectToken } from '../../shared/api.js';
import { codeOnly } from './sourceScan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

/** Every `CCD_ARGV` key, classified by whether its argv carries a session or temp-root id (spec §2.3's 26). A new key
 *  is a tsc error here (`typecheck-tests`) and a red first case below, until someone decides which it is. */
const ID_BUILDERS = {
  start: 'no-id', enable: 'no-id', startCross: 'no-id', enableCross: 'no-id',
  ensure: 'id', stopId: 'id', stopPair: 'id', forget: 'id', swap: 'id', swapCross: 'id',
  wsAdd: 'no-id', wsAddWorker: 'no-id',
  prStateSession: 'id', prStateProject: 'no-id', prOpen: 'id',
  wsArchive: 'id', wsRestore: 'id', wsAudit: 'id', wsReap: 'id',
  wsReclaimAudit: 'id', wsReclaim: 'id', wsExpireAudit: 'id', wsExpire: 'id',
  wsCollectAudit: 'id', wsCollect: 'id', wsAttic: 'id',
  wsHold: 'id', wsRelease: 'id', wsRename: 'id',
  coordPause: 'no-id', reclaimPause: 'no-id', projectPoolSet: 'no-id', projectPoolClear: 'no-id',
  route: 'id', routeApply: 'id', routeSet: 'id', winSize: 'id',
  docsIndex: 'no-id', docsTree: 'no-id', docsShowCommitted: 'no-id', docsShowDraft: 'no-id', docsFetch: 'no-id',
} as const satisfies Record<keyof typeof CCD_ARGV, 'id' | 'no-id'>;

type IdBuilder = {
  [K in keyof typeof ID_BUILDERS]: (typeof ID_BUILDERS)[K] extends 'id' ? K : never;
}[keyof typeof ID_BUILDERS];

const isIdBuilder = (k: string): k is IdBuilder =>
  (ID_BUILDERS as Readonly<Record<string, 'id' | 'no-id'>>)[k] === 'id';

const ID_KEYS: readonly IdBuilder[] = Object.keys(ID_BUILDERS).filter(isIdBuilder);

/** A dash-leading probe id: each id builder must carry it into its argv. */
const PROBE_ID = '--census-probe-id';

/** One well-typed call per id builder, with PROBE_ID in its id slot. The slot's index is where the scan reads each
 *  call's id argument, so the index is measured, never hand-kept. */
const ID_PROBE = {
  ensure: [PROBE_ID],
  stopId: [PROBE_ID, 'pwa'],
  stopPair: [PROBE_ID, 'demo', 'pwa'],
  forget: [PROBE_ID],
  swap: [PROBE_ID, 'acct-a'],
  swapCross: [PROBE_ID, 'acct-a'],
  prStateSession: [PROBE_ID],
  prOpen: [PROBE_ID, 'a title', 'Ym9keQ==', false],
  wsArchive: [PROBE_ID, null],
  wsRestore: [PROBE_ID, null],
  wsAudit: [PROBE_ID],
  wsReap: ['probe-token', PROBE_ID],
  wsReclaimAudit: [PROBE_ID, false],
  wsReclaim: ['probe-token', 7, PROBE_ID, false, null],
  wsExpireAudit: [PROBE_ID],
  wsExpire: ['probe-token', PROBE_ID, null],
  wsCollectAudit: [PROBE_ID],
  wsCollect: ['probe-token' as CollectToken, PROBE_ID, null],
  wsAttic: [PROBE_ID],
  wsHold: [PROBE_ID, 'a reason', null],
  wsRelease: [PROBE_ID, null],
  wsRename: [PROBE_ID, 'a-branch', null],
  route: [PROBE_ID, 'class', 'x', null],
  routeApply: [PROBE_ID, 'class', 'x', null],
  routeSet: [PROBE_ID, { effort: 'high' }, null],
  winSize: [PROBE_ID, 'smallest'],
} satisfies { [K in IdBuilder]: Parameters<(typeof CCD_ARGV)[K]> };

const ID_ARG_AT: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(ID_PROBE).map(([k, args]) => [k, (args as readonly unknown[]).indexOf(PROBE_ID)]),
);

/** A scope head: a route registration, a function, a nested function, an async const arrow, or a class method. The
 *  scope of a call is the last head at or above its line. */
const HEADS: readonly (readonly [RegExp, (m: RegExpExecArray) => string | null])[] = [
  [/^ {2}app\.(get|post)\(\s*'([^']+)'/, (m) => `${m[1]!.toUpperCase()} ${m[2]!}`],
  [/^(?:export )?(?:async )?function (\w+)/, (m) => m[1]!],
  [/^ {2}(?:async )?function (\w+)/, (m) => m[1]!],
  [/^(?: {2})?(?:export )?const (\w+) = async \(/, (m) => m[1]!],
  [/^ {2}(?:private |public |protected )?(?:static )?(?:async )?(\w+)\([^)]*\)[^{;]*\{\s*$/,
    (m) => (/^(?:if|for|while|switch|catch)$/.test(m[1]!) ? null : m[1]!)],
];

interface Head { readonly name: string; readonly line: number }

function headOf(line: string): string | null {
  for (const [re, name] of HEADS) {
    const m = re.exec(line);
    if (m !== null) {
      const n = name(m);
      if (n !== null) return n;
    }
  }
  return null;
}

function headsOf(lines: readonly string[]): Head[] {
  const out: Head[] = [];
  lines.forEach((l, i) => {
    const n = headOf(l);
    if (n !== null) out.push({ name: n, line: i });
  });
  return out;
}

function lastHeadAtOrBefore(heads: readonly Head[], line: number): Head | null {
  let found: Head | null = null;
  for (const h of heads) {
    if (h.line > line) break;
    found = h;
  }
  return found;
}

/** `codeOnly`'s output with every string and template body blanked to spaces, line for line and length for length,
 *  so a quoted builder name is not a call and a quoted comma or bracket does not split an argument. */
const STRING = /'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const blankStrings = (code: string): string =>
  code.replace(STRING, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1]);

/** The top-level arguments of the call whose `(` ends just before `open`, and the index of its closing paren. */
function argsFrom(bare: string, open: number): { readonly args: string[]; readonly close: number } | null {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = open; i < bare.length; i++) {
    const c = bare[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        args.push(cur);
        return { args, close: i };
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  return null;
}

interface Site {
  readonly file: string;
  readonly scope: string | null;
  readonly builder: IdBuilder;
  readonly id: string;
  readonly line: number;
  /** The scope's code from its head down to the call's own line, comments dropped, strings kept. */
  readonly before: string;
}

function scanSource(src: string, file: string): Site[] {
  const code = codeOnly(src);
  const bare = blankStrings(code);
  const lines = code.split('\n');
  const heads = headsOf(lines);
  const sites: Site[] = [];
  const re = /CCD_ARGV\.([A-Za-z]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare)) !== null) {
    const builder = m[1]!;
    if (!isIdBuilder(builder)) continue;
    const call = argsFrom(bare, m.index + m[0].length);
    if (call === null) throw new Error(`${file}: CCD_ARGV.${builder}( never closes`);
    // A NAME READ IS NOT A CALL: `CCD_ARGV.<name>(…)[0]` takes the verb and throws the argv away, as verb-gate reads it.
    if (bare.slice(call.close + 1, call.close + 4) === '[0]') continue;
    const line = bare.slice(0, m.index).split('\n').length - 1;
    const head = lastHeadAtOrBefore(heads, line);
    sites.push({
      file,
      scope: head === null ? null : head.name,
      builder,
      id: (call.args[ID_ARG_AT[builder]!] ?? '').replace(/\s+/g, ' ').trim(),
      line: line + 1,
      before: head === null ? '' : lines.slice(head.line, line + 1).join('\n'),
    });
  }
  return sites;
}

/** Every `.ts` file under `dir`. `__`-prefixed entries are TRANSIENT mutants written by a parallel suite (`boot.test.ts`
 *  writes `server/src/__boot_control_mutant__.ts` for about 15 s): the same skip, for the same reason, as
 *  `single-definition.test.ts`'s `sources`. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.name.startsWith('__') ? []
      : e.isDirectory() ? sourcesUnder(path.join(dir, e.name))
        : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  ));
}

const rel = (f: string): string => path.relative(srcRoot, f).split(path.sep).join('/');

const SITES: readonly Site[] = sourcesUnder(srcRoot).sort()
  .flatMap((f) => scanSource(readFileSync(f, 'utf8'), rel(f)));

/** The named scope's code, from its head to the next head. Take the LAST head of that name: an overloaded function's
 *  body follows its signatures (`closeRun` has two). */
function scopeText(file: string, name: string): string | null {
  const lines = codeOnly(readFileSync(path.join(srcRoot, file), 'utf8')).split('\n');
  const heads = headsOf(lines);
  let at = -1;
  for (let i = 0; i < heads.length; i++) if (heads[i]!.name === name) at = i;
  if (at < 0) return null;
  const end = at + 1 < heads.length ? heads[at + 1]!.line : lines.length;
  return lines.slice(heads[at]!.line, end).join('\n');
}

interface GateHome { readonly file: string; readonly scope: string; readonly re: RegExp }

const EXPIRY_STEP_0 = /!isRegistryId\(sessionId\)[^;]*EXPIRE_ID_REFUSED[\s\S]*?capSupported\(deps\.fleetState, EXPIRE_CAP\)/;

/** Where each check is written, and its text (spec §2.3). */
const GATES = {
  /** `knownId`'s first statement: a non-registry id is unknown before any listing. */
  knownId: { file: 'server.ts', scope: 'knownId', re: /Promise<boolean> => \{\s*if \(!isRegistryId\(id\)\) return false;/ },
  /** `/ensure`'s own check, right after it reads its id. */
  'ensure-route-head': {
    file: 'server.ts', scope: 'POST /api/sessions/:id/ensure',
    re: /const \{ id \} = req\.params as \{ id: string \};\s*if \(!isRegistryId\(id\)\)/,
  },
  /** The cross-pool arm's first statement, ahead of its skew gate. */
  'cross-arm-head': {
    file: 'server.ts', scope: 'POST /api/sessions/:id/swap',
    re: /if \(body\.crossPool === true\) \{\s*if \(!isRegistryId\(id\)\)/,
  },
  /** This refuses a legacy row whose stop-pair part is not a registry id, or whose pair is not its id, so the wrapper
   *  `stopPair` carries is always a prefix of a vetted id (the row's `.wrapper` fallback never reaches it), and the
   *  project is the row's `.project`, which this vets; a workspace row stops by its id, which the callers' id gates have
   *  vetted. Both of `stopArgvFor`'s callers ask it in their identity arm (pinned in the callers case below). */
  'stop-pair-refused': {
    file: 'server.ts', scope: 'stopPairRefused',
    re: /if \(rec\.workspace !== null\) return false;\s*const wrapper = stopPairWrapper\(id, rec, identity\);\s*return !isRegistryId\(wrapper\) \|\| !isRegistryId\(rec\.project\) \|\| `\$\{wrapper\}-\$\{rec\.project\}` !== id;/,
  },
  /** `readSessionRecord` answers `bad-id` before any listing, so a caller only ever holds a found row's valid id. */
  readSessionRecord: {
    file: 'registry.ts', scope: 'readSessionRecord',
    re: /Promise<SingleRead> \{\s*if \(!isRegistryId\(id\)\) return \{ kind: 'bad-id' \};/,
  },
  /** `readRegistryMeasured` refuses a non-registry name: it is never read, built or composed. */
  'registry-refused': { file: 'registry.ts', scope: 'readRegistryMeasured', re: /\bisRegistryId\(/ },
  /** `POST /api/runs` checks `claimedBy`, then `sessionId`, as given. */
  'run-open-checks': {
    file: 'coord/routes.ts', scope: 'POST /api/runs',
    re: /!isRegistryId\(claimedBy\)[\s\S]*?!isRegistryId\(sessionId\)/,
  },
  /** The routing door asks the predicate of the stored id it is about to write. */
  'routing-door': { file: 'coord/routes.ts', scope: 'POST /api/runs/:id/route', re: /if \(!isRegistryId\(sid\)\) \{/ },
  /** Advance re-checks the stored id before `verifyDone`, and only there. */
  'advance-gate': {
    file: 'coord/routes.ts', scope: 'POST /api/runs/:id/advance',
    re: /if \(to === 'awaiting-review' \|\| to === 'merging'\) \{\s*if \(!isRegistryId\(run\.sessionId\)\) return reply\.code\(409\)\.send\(\{ ok: false, reject: \{ code: 'bad-session' \} \}\);/,
  },
  /** Dispatch re-checks the stored id straight after the hold verdict, before any read. */
  'dispatch-gate': {
    file: 'coord/dispatch.ts', scope: 'dispatchRun',
    re: /if \(!hold\.ok\) return hold;\s*if \(run\.sessionId !== null && !isRegistryId\(run\.sessionId\)\) return \{ ok: false, kind: 'bad-session' \};/,
  },
  /** The abandon arm closes a bad stored id `failed` with no fleet act, and records its one event. */
  'close-abandon-branch': {
    file: 'coord/close.ts', scope: 'closeRun',
    re: /isRegistryId\(run\.sessionId\)[\s\S]*?'fleet-act-omitted:bad-session'/,
  },
  /** Every other close refuses `bad-session`, straight above the review hand-off. */
  'close-gate': {
    file: 'coord/close.ts', scope: 'closeRun',
    re: /!isRegistryId\(run\.sessionId\)\)[^;]*kind: 'bad-session'[^;]*;\s*\}?\s*if \(run\.kind === 'review'\) return closeReviewRun\(/,
  },
  /** `resolveDoneBranch` holds a refused id (`tip-unmeasurable`), so a review close reaches no `pr-state` for it. */
  'fingerprint-check': {
    file: 'coord/fingerprint.ts', scope: 'resolveDoneBranch',
    re: /if \(!isRegistryId\(run\.sessionId\)\) \{\s*return \{ ok: false, code: 'tip-unmeasurable'/,
  },
  /** The child-reclaim executor defers a bad id before either of its builders. */
  'child-reclaim-outcome': {
    file: 'coord/childReclaim.ts', scope: 'childReclaimOutcome',
    re: /deferred\('marker-unreadable', 'the session id is not a registry id'\)/,
  },
  /** Expiry's step 0, before its capability read. */
  'expiry-step-0': { file: 'coord/expireArchived.ts', scope: 'expireArchived', re: EXPIRY_STEP_0 },
  /** The learning audit's own step 0, before its capability read. */
  'learn-expiry-step-0': { file: 'coord/expireArchived.ts', scope: 'learnExpiry', re: EXPIRY_STEP_0 },
  /** The collector executor's step 1. */
  'collector-step-1': {
    file: 'coord/collectTempRoot.ts', scope: 'collectTempRoot',
    re: /if \(!isTmpRootId\(job\.id\)\) return \{ kind: 'not-asked', step: 1, why: 'id-refused'/,
  },
  /** The population gate's witness half; with the record half below, the learning audit's only id check. */
  'collector-population': {
    file: 'collectLane.ts', scope: 'collectPopulation',
    re: /if \(isTmpRootId\(n\)\) witnessed\.add\(n\); else refusedNames \+= 1;/,
  },
  /** The population gate's record half: a quarantine record names an id only when that id passes the predicate. */
  'collector-record-name': {
    file: 'collectLane.ts', scope: 'parseCollectRecordName',
    re: /return id !== undefined && isTmpRootId\(id\) \? id : null;/,
  },
} as const satisfies Readonly<Record<string, GateHome>>;

type Gate = keyof typeof GATES;

type Origin = 'request' | 'stored' | 'registry' | 'collector';

interface CensusRow {
  readonly file: string;
  readonly scope: string;
  readonly builder: IdBuilder;
  /** The id argument's source text, whitespace collapsed. */
  readonly id: string;
  readonly origin: readonly Origin[];
  readonly gate: readonly Gate[];
  /** When the gate lives outside the call's scope: the call the scope makes to it, above the call. */
  readonly entry?: RegExp;
}

const KNOWN_ID = /\bknownId\(\s*id\s*\)/;

/** `sweepNames` walks `readRegistry`'s own output, which never carries a refused row. */
const SWEEP_NAMES_LISTING = /\bconst records = await readRegistry\(this\.deps\.io, this\.deps\.cfg\);\s*for \(const r of records\) \{/;

/** The 41 calls. Rows of one key (file, scope, builder, id) are in source order. */
const CENSUS: readonly CensusRow[] = [
  // coord/childReclaim.ts: the close path's child gate (masked by close's gates) and the sweep both reach the one executor.
  { file: 'coord/childReclaim.ts', scope: 'childReclaimAudit', builder: 'wsReclaimAudit', id: 'req.sessionId', origin: ['stored', 'registry'], gate: ['child-reclaim-outcome'] },
  { file: 'coord/childReclaim.ts', scope: 'childReclaimAct', builder: 'wsReclaim', id: 'req.sessionId', origin: ['stored', 'registry'], gate: ['child-reclaim-outcome'] },
  { file: 'coord/childReclaim.ts', scope: 'releaseRetiredChildHold', builder: 'wsRelease', id: 'sessionId', origin: ['registry'], gate: ['readSessionRecord'], entry: /\breadSessionRecord\(deps\.io, deps\.cfg, sessionId\)/ },
  // coord/childSpent.ts: `rec` is a FOUND row of `readSessionRecord` (childBindGate, childGateAtClose). The read is in
  // the callers, so the row has no `entry`: the callers case below pins who calls `childSpent` and `childSpentLive`, and
  // the read above each caller's call.
  { file: 'coord/childSpent.ts', scope: 'childSpentLive', builder: 'prStateSession', id: 'rec.id', origin: ['stored', 'request'], gate: ['readSessionRecord'] },
  // coord/close.ts: the abandon arm's fleet act, then the coordinator close's three acts, then the review close's two.
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsHold', id: 'run.sessionId', origin: ['stored'], gate: ['close-abandon-branch'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsRelease', id: 'run.sessionId', origin: ['stored'], gate: ['close-abandon-branch'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsArchive', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsRelease', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsHold', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeReviewRun', builder: 'wsHold', id: 'sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeReviewRun', builder: 'wsRelease', id: 'sessionId', origin: ['stored'], gate: ['close-gate'] },
  // coord/collectTempRoot.ts: the learning audit is reached from the population and from the executor's step 1.
  { file: 'coord/collectTempRoot.ts', scope: 'collectAudit', builder: 'wsCollectAudit', id: 'id', origin: ['collector'], gate: ['collector-step-1', 'collector-population', 'collector-record-name'] },
  { file: 'coord/collectTempRoot.ts', scope: 'collectTempRoot', builder: 'wsCollect', id: 'job.id', origin: ['collector'], gate: ['collector-step-1'] },
  // coord/dispatch.ts: refuseSpentChild's only caller is dispatchRun, below its gate; the fresh winner is a listed, valid row.
  { file: 'coord/dispatch.ts', scope: 'refuseSpentChild', builder: 'wsHold', id: 'run.sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  { file: 'coord/dispatch.ts', scope: 'refuseSpentChild', builder: 'wsRelease', id: 'run.sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  { file: 'coord/dispatch.ts', scope: 'dispatchRun', builder: 'ensure', id: 'sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  { file: 'coord/dispatch.ts', scope: 'dispatchRun', builder: 'wsHold', id: 'sessionId', origin: ['stored', 'registry'], gate: ['dispatch-gate', 'registry-refused'] },
  { file: 'coord/dispatch.ts', scope: 'dispatchRun', builder: 'routeSet', id: 'sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  // coord/expireArchived.ts: the audit serves both the executor and the learning read.
  { file: 'coord/expireArchived.ts', scope: 'expireAudit', builder: 'wsExpireAudit', id: 'sessionId', origin: ['registry'], gate: ['expiry-step-0', 'learn-expiry-step-0'] },
  { file: 'coord/expireArchived.ts', scope: 'expireAct', builder: 'wsExpire', id: 'sessionId', origin: ['registry'], gate: ['expiry-step-0'] },
  // coord/fingerprint.ts: reached from close (below close's gate) and advance (below advance's gate).
  { file: 'coord/fingerprint.ts', scope: 'verifyDone', builder: 'prStateSession', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate', 'advance-gate', 'fingerprint-check'], entry: /\bresolveDoneBranch\(deps, run\)/ },
  // coord/routes.ts
  { file: 'coord/routes.ts', scope: 'POST /api/runs', builder: 'wsHold', id: 'sessionId', origin: ['request'], gate: ['run-open-checks'] },
  { file: 'coord/routes.ts', scope: 'POST /api/runs/:id/route', builder: 'route', id: 'sid', origin: ['stored'], gate: ['routing-door'] },
  { file: 'coord/routes.ts', scope: 'POST /api/runs/:id/route', builder: 'routeSet', id: 'sid', origin: ['stored'], gate: ['routing-door'] },
  // server.ts
  { file: 'server.ts', scope: 'POST /api/sessions/:id/route', builder: 'routeApply', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/ensure', builder: 'ensure', id: 'id', origin: ['request'], gate: ['ensure-route-head'] },
  // stopArgvFor's two callers gate the id: /stop by readSessionRecord, /archive by knownId (pinned in their own case below).
  { file: 'server.ts', scope: 'stopArgvFor', builder: 'stopId', id: 'id', origin: ['request'], gate: ['readSessionRecord', 'knownId'] },
  // The wrapper is a prefix of the vetted request id: `stopPairRefused`'s pair clause refuses every row whose id does
  // not end in `-<project>`, so the row's `.wrapper` fallback never reaches this builder. The project is the row's
  // `.project`, which `stopPairRefused` vets, asked in each caller's identity arm (the callers case below). The `entry`
  // ties what it vets (`stopPairWrapper(id, rec, identity)` and `rec.project`) to the two arguments composed here.
  { file: 'server.ts', scope: 'stopArgvFor', builder: 'stopPair', id: 'originalWrapper', origin: ['request', 'registry'], gate: ['stop-pair-refused'], entry: /\bconst originalWrapper = stopPairWrapper\(id, rec, identity\);\s*return CCD_ARGV\.stopPair\(originalWrapper, rec\.project, surface\);/ },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/swap', builder: 'swapCross', id: 'id', origin: ['request'], gate: ['cross-arm-head'] },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/swap', builder: 'swap', id: 'id', origin: ['request'], gate: ['readSessionRecord'], entry: /\breadSessionRecord\(deps\.io, deps\.cfg, id\)/ },
  { file: 'server.ts', scope: 'GET /api/sessions/:id/pr', builder: 'prStateSession', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/pr', builder: 'prOpen', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/archive', builder: 'wsArchive', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/restore', builder: 'wsRestore', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/forget', builder: 'forget', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/hold', builder: 'wsHold', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/release', builder: 'wsRelease', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'GET /api/sessions/:id/workspace/audit', builder: 'wsAudit', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/workspace/reap', builder: 'wsReap', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  // watch.ts: the naming sweep's rows come from the listing, which never builds a refused name; the `entry` ties the
  // loop's `r` to `readRegistry`'s output.
  { file: 'watch.ts', scope: 'sweepNames', builder: 'wsRename', id: 'r.id', origin: ['registry'], gate: ['registry-refused'], entry: SWEEP_NAMES_LISTING },
  { file: 'watch.ts', scope: 'sweepNames', builder: 'wsRename', id: 'r.id', origin: ['registry'], gate: ['registry-refused'], entry: SWEEP_NAMES_LISTING },
];

/** The files whose gates ask the predicate themselves. */
const GATE_FILES = [
  'server.ts', 'registry.ts', 'watch.ts',
  'coord/routes.ts', 'coord/dispatch.ts', 'coord/close.ts', 'coord/reclaim.ts', 'coord/fingerprint.ts', 'coord/expireArchived.ts',
] as const;

const IMPORTS_PREDICATE = /import\s*\{[^}]*\bisRegistryId\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/api\.js'/;

const keyOf = (r: { readonly file: string; readonly scope: string | null; readonly builder: string; readonly id: string }): string =>
  `${r.file} | ${r.scope ?? '(no scope)'} | ${r.builder} | ${r.id}`;

/** Each scanned call with its row: the k-th call of a key takes the k-th row of that key. */
function paired(): { readonly site: Site; readonly row: CensusRow }[] {
  const queues = new Map<string, CensusRow[]>();
  for (const row of CENSUS) queues.set(keyOf(row), [...(queues.get(keyOf(row)) ?? []), row]);
  return SITES.map((site) => {
    const row = queues.get(keyOf(site))?.shift();
    if (row === undefined) throw new Error(`unclassified id-taking call: ${keyOf(site)} (line ${site.line})`);
    return { site, row };
  });
}

describe('every id-taking argv call has an origin and a gate (spec §2.3)', () => {
  it('every CCD_ARGV key is classified id or no-id', () => {
    expect(Object.keys(ID_BUILDERS).sort()).toEqual(Object.keys(CCD_ARGV).sort());
    expect(ID_KEYS).toHaveLength(26);
    expect(Object.keys(ID_PROBE).sort()).toEqual([...ID_KEYS].sort());
    for (const k of ID_KEYS) {
      const args = ID_PROBE[k] as readonly unknown[];
      expect(args.filter((a) => a === PROBE_ID), `${k}'s probe names its id once`).toHaveLength(1);
      const built = (CCD_ARGV[k] as (...a: unknown[]) => readonly string[])(...args);
      expect(built, `${k} carries the id it is given into its argv`).toContain(PROBE_ID);
    }
  });

  it('the id-taking calls are exactly these', () => {
    expect(SITES.filter((s) => s.scope === null).map(keyOf), 'a call outside every function or route').toEqual([]);
    expect(SITES.map(keyOf).sort()).toEqual(CENSUS.map(keyOf).sort());
    for (const row of CENSUS) {
      expect(row.origin.length, `${keyOf(row)} names its origin`).toBeGreaterThan(0);
      expect(row.gate.length, `${keyOf(row)} names its gate`).toBeGreaterThan(0);
    }
  });

  it('the header claim, "41 id-taking calls across 10 files", matches the scan', () => {
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const claim = /^\/\/ THE CLAIM: (\d+) id-taking calls across (\d+) files\b/m.exec(self);
    expect(claim, 'the census claim was removed or reworded without its guard').not.toBeNull();
    expect([Number(claim![1]), Number(claim![2])]).toEqual([SITES.length, new Set(SITES.map((s) => s.file)).size]);
    expect(CENSUS).toHaveLength(SITES.length);
  });

  it('every gate stands where the census says, above the call it guards', () => {
    for (const [name, g] of Object.entries(GATES)) {
      const text = scopeText(g.file, g.scope);
      expect(text, `${name}: ${g.file} has no scope ${g.scope}`).not.toBeNull();
      expect(text, `${name}: the gate's text is gone from ${g.file} ${g.scope}`).toMatch(g.re);
    }
    for (const { site, row } of paired()) {
      for (const gate of row.gate) {
        const g = GATES[gate];
        if (g.file === site.file && g.scope === site.scope) {
          expect(site.before, `${keyOf(site)} (line ${site.line}): ${gate} must stand above the call`).toMatch(g.re);
        }
      }
      if (row.entry !== undefined) {
        expect(site.before, `${keyOf(site)} (line ${site.line}): its scope must reach its gate above the call`).toMatch(row.entry);
      }
    }
    const used = new Set<string>(CENSUS.flatMap((r) => r.gate));
    expect(Object.keys(GATES).filter((g) => !used.has(g)), 'a gate no call names').toEqual([]);
  });

  it("stopArgvFor's three call sites each stand below their id gate and the pair-part refusal", () => {
    const lines = codeOnly(readFileSync(path.join(srcRoot, 'server.ts'), 'utf8')).split('\n');
    const heads = headsOf(lines);
    const callers = lines.flatMap((l, i) => (/\bstopArgvFor\(/.test(l) && !/\bfunction stopArgvFor\(/.test(l)
      ? [{ head: lastHeadAtOrBefore(heads, i), line: i }]
      : []));
    expect(callers.map((c) => c.head?.name ?? null)).toEqual([
      'POST /api/sessions/:id/stop',
      'POST /api/sessions/:id/archive',
      'POST /api/sessions/:id/archive',
    ]);
    // The identity arm, which both routes share: `stopPairRefused` (the `stopPair` row's gate) answers 503 with no argv
    // composed. It vets the row's `.project` and refuses the `.wrapper` fallback, so the wrapper is the vetted id's prefix.
    const IDENTITY_ARM = /if \(identity === null \|\| stopPairRefused\(id, read\.record, identity\)\) \{\s*return reply\.code\(503\)\.send\(\{ ok: false, error: 'registry-unmeasurable' \}\);/;
    const GATES_OF: Readonly<Record<string, readonly (readonly [string, RegExp])[]>> = {
      'POST /api/sessions/:id/stop': [['its id gate', /\breadSessionRecord\(deps\.io, deps\.cfg, id\)/], ['stopPairRefused', IDENTITY_ARM]],
      'POST /api/sessions/:id/archive': [['its id gate', KNOWN_ID], ['stopPairRefused', IDENTITY_ARM]],
    };
    for (const c of callers) {
      const before = lines.slice(c.head!.line, c.line + 1).join('\n');
      for (const [what, re] of GATES_OF[c.head!.name]!) {
        expect(before, `${c.head!.name} (line ${c.line + 1}): ${what} stands above stopArgvFor(`).toMatch(re);
      }
    }
  });

  it('every gate file imports isRegistryId from shared/api.js and calls it', () => {
    for (const f of GATE_FILES) {
      const code = codeOnly(readFileSync(path.join(srcRoot, f), 'utf8'));
      expect(code, `${f} imports isRegistryId from shared/api.js`).toMatch(IMPORTS_PREDICATE);
      expect(code.replace(IMPORTS_PREDICATE, ''), `${f} calls isRegistryId`).toMatch(/\bisRegistryId\s*\(/);
    }
    const importers = sourcesUnder(srcRoot)
      .filter((f) => IMPORTS_PREDICATE.test(codeOnly(readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    expect(importers).toEqual([...GATE_FILES].sort());
  });

  it('each helper whose gate stands in its caller is called only from that caller', () => {
    // A row whose gate's home is another scope, and that carries no `entry`, is guarded only through its callers, as
    // `stopArgvFor` is (the case above). A new CALL of a builder is the scan's to find; a new CALLER of such a helper,
    // one that skips the gate, is this case's. `childSpent` and `childSpentLive` take a ROW, not an id: the
    // `readSessionRecord` that vets it stands in their callers `childBindGate` and `childGateAtClose`, which pass the
    // found read's `record`, so each of those callers is also pinned to read first (READ_ABOVE). `childSpent` handing its
    // own parameter on to `childSpentLive` adds no gate of its own: its callers vet it.
    const CALLERS: Readonly<Record<string, readonly string[]>> = {
      closeReviewRun: ['coord/close.ts | closeRun'],
      refuseSpentChild: ['coord/dispatch.ts | dispatchRun'],
      expireAudit: ['coord/expireArchived.ts | expireArchived', 'coord/expireArchived.ts | learnExpiry'],
      expireAct: ['coord/expireArchived.ts | expireArchived'],
      childReclaimAudit: ['coord/childReclaim.ts | childReclaimOutcome'],
      childReclaimAct: ['coord/childReclaim.ts | childReclaimOutcome'],
      collectAudit: ['coord/collectTempRoot.ts | collectTempRoot', 'coord/collectTempRoot.ts | learnCollect'],
      childSpent: ['coord/childBind.ts | childBindGate', 'coord/close.ts | childGateAtClose'],
      childSpentLive: ['coord/childSpent.ts | childSpent', 'coord/close.ts | childGateAtClose'],
    };
    /** `<callee> <- <file> | <scope>`: the caller reads the row first and passes the found read's `record`. */
    const READ_ABOVE: Readonly<Record<string, RegExp>> = {
      'childSpent <- coord/childBind.ts | childBindGate':
        /\breadSessionRecord\(deps\.io, deps\.cfg, sessionId\)[\s\S]*\bchildSpent\(deps, read\.record, birth\)/,
      'childSpent <- coord/close.ts | childGateAtClose':
        /\breadSessionRecord\(deps\.io, deps\.cfg, sessionId\)[\s\S]*\bchildSpent\(deps, read\.record, birth, line\)/,
      'childSpentLive <- coord/close.ts | childGateAtClose':
        /\breadSessionRecord\(deps\.io, deps\.cfg, sessionId\)[\s\S]*\bchildSpentLive\(deps, read\.record, birth\)/,
    };
    const readChecked = new Set<string>();
    for (const [callee, want] of Object.entries(CALLERS)) {
      const call = new RegExp(`\\b${callee}\\(`);
      const def = new RegExp(`\\bfunction ${callee}\\(`);
      const sites = sourcesUnder(srcRoot).flatMap((f) => {
        const code = codeOnly(readFileSync(f, 'utf8'));
        const lines = code.split('\n');
        const heads = headsOf(lines);
        return blankStrings(code).split('\n').flatMap((l, i) => {
          if (!call.test(l) || def.test(l)) return [];
          const head = lastHeadAtOrBefore(heads, i);
          return [{
            where: `${rel(f)} | ${head?.name ?? '(no scope)'}`,
            line: i + 1,
            before: head === null ? '' : lines.slice(head.line, i + 1).join('\n'),
          }];
        });
      });
      expect(sites.map((s) => s.where).sort(), `${callee}'s callers`).toEqual([...want].sort());
      for (const s of sites) {
        const key = `${callee} <- ${s.where}`;
        const need = READ_ABOVE[key];
        if (need === undefined) continue;
        readChecked.add(key);
        expect(s.before, `${key} (line ${s.line}): its readSessionRecord stands above the call, which passes read.record`).toMatch(need);
      }
    }
    expect([...readChecked].sort(), 'every READ_ABOVE pin was exercised by a call').toEqual(Object.keys(READ_ABOVE).sort());
  });

  it('CONTROL: the scan sees a call, and ignores a comment, a string and a definition', () => {
    const src = [
      'export async function sample(deps: Deps, id: string): Promise<void> {',
      '  // CCD_ARGV.wsRelease(id, null) is prose',
      '  /* CCD_ARGV.forget(id) in a block comment */',
      "  const quoted = 'CCD_ARGV.wsAudit(id)';",
      '  const templated = `CCD_ARGV.ensure(${id})`;',
      '  const verb = CCD_ARGV.wsArchive(id, null)[0];',
      '  await deps.runCcd(CCD_ARGV.wsAdd(id));',
      '  await deps.runCcd(CCD_ARGV.wsHold(',
      "    id, 'a reason, with a comma', null));",
      '}',
      'const BUILDERS = {',
      "  wsHold: (id: string, reason: string) => argv(['ws-hold', '--session', id, '--reason', reason]),",
      '};',
      'export function register(app: App): void {',
      "  app.post('/api/x/:id', async (req, reply) => {",
      '    return send(CCD_ARGV.forget(req.id));',
      '  });',
      '}',
      'class Watcher {',
      '  async sweep(): Promise<void> {',
      '    await this.run(CCD_ARGV.wsReap(token, r.id));',
      '  }',
      '}',
    ].join('\n');
    expect(scanSource(src, 'control.ts').map(({ file, scope, builder, id, line }) => ({ file, scope, builder, id, line })))
      .toEqual([
        { file: 'control.ts', scope: 'sample', builder: 'wsHold', id: 'id', line: 8 },
        { file: 'control.ts', scope: 'POST /api/x/:id', builder: 'forget', id: 'req.id', line: 16 },
        { file: 'control.ts', scope: 'sweep', builder: 'wsReap', id: 'r.id', line: 21 },
      ]);
  });
});
