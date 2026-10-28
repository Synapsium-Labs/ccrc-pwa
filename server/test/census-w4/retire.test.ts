// ARCH-44's retire censuses (D-7165, D-7174), held two ways (`consolidation-census.test.ts`'s discipline): against a
// FIXTURE tree, so each query counts what it claims and passes over what it must not, and against the REAL tree.
// REAL rows report and never red before their series starts (spec §5.1 rule 3), except the two the plan pins exact from
// C4h on: `retireActSites` (D-7177: the composers stay three) and `retireNoticeSites` (D-7176: no notice moves).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CensusSite } from '../consolidationCensus.js';
import {
  retireActSites, retireDeciders, retireGateLadders, retireNoticeSites, retirePortReaders, retireQueueOwners, retireQueueSites, retireRowSteps,
} from './retire.js';
import { REPO, sourceFiles } from '../consolidationCensus.js';
import { parsedFile, sourceOfSymbol } from '../scan/symbols.js';
import { identifierReferences, parseSource, type ParsedFile } from '../scan/parse.js';
import { serverRing } from '../rings/ring.js';

const show = (name: string, sites: readonly (CensusSite & { symbol: string })[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.symbol}  (${s.file}:${s.line})`).join('\n')}`);
};
const names = (sites: readonly { symbol: string }[]): string[] => sites.map((s) => s.symbol).sort();

describe('the retire executors\' censuses (ARCH-44, C4h)', () => {
  let tree = '';
  const at = (rel: string, body: readonly string[]): void => {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body.join('\n'));
  };
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-retire-'));
    // ── retireGateLadders ──
    at('server/src/staleShape.ts', [                                          // (1) the stale-archive shape: wsArchive
      'export async function act(deps: Deps, id: string): Promise<void> {',
      "  if (!ccdCan(deps.fleetState, 'wsArchive')) return;",
      '  if (deps.viewers?.isVisible(id) === true) return;',
      '}',
    ]);
    at('server/src/portBuilder.ts', [                                         // (2) a port builder: separate nested readers
      'export function collectRetirePort(deps: Deps, job: Job): Port {',
      '  return {',
      "    capability: () => ccdCan(deps.fleetState, 'wsCollect'),",
      '    presence: () => deps.viewers?.isVisible(job.id) === true,',
      '    async audit() { return collectAudit(deps, job.id); },',
      '  };',
      '}',
      'export function namedReaders(deps: Deps, id: string): void {',      // named nested functions: not its own body
      "  function cap(): boolean { return ccdCan(deps.fleetState, 'wsExpire'); }",
      '  const seen = (): boolean => deps.viewers?.isVisible(id) === true;',
      '  void cap; void seen;',
      '}',
    ]);
    at('server/src/coord/ladder.ts', [                                         // (3) both calls in one body, an early return between
      'export async function ladder(deps: Deps, id: string): Promise<Out> {',
      "  if (!ccdCan(deps.fleetState, 'wsReclaim')) return { kind: 'unsupported' };",
      "  if (id === '') return { kind: 'bad' };",
      "  if (deps.viewers?.isVisible(id) === true) return { kind: 'presence' };",
      "  return { kind: 'go' };",
      '}',
      'export const arrowLadder = async (deps: Deps, id: string): Promise<Out> => {',  // a const arrow ladder counts too
      "  if (!ccdCan(deps.fleetState, 'wsCollectLoose')) return { kind: 'unsupported' };",
      "  return deps.viewers?.isVisible(id) === true ? { kind: 'presence' } : { kind: 'go' };",
      '};',
    ]);
    at('server/src/retireLane.ts', [                                         // (4) the generic loop: no literal key
      'export async function retireAct(port: Port, reason: Reason, req: Req): Promise<Out> {',
      '  for (const step of reason.decide) await port.read[step](req);',
      "  const key = reason.key; if (!ccdCan(port.fleetState, key)) return { kind: 'unsupported' };",
      '  return port.viewers.isVisible(req.id) ? { kind: \'presence\' } : { kind: \'go\' };',
      '}',
    ]);
    // ── retireActSites ──
    at('server/src/acts.ts', [
      'export async function inlineAct(deps: Deps, tok: CollectToken, id: string): Promise<void> {',
      "  await deps.runCcd(CCD_ARGV.wsCollect(tok, id, sweepDec(deps.fleetState, 'collect sweep')));",            // inline
      '}',
      'async function boundAct(deps: Deps, tok: string, id: string) {',
      "  const argv = CCD_ARGV.wsExpire(tok, id, sweepDec(deps.fleetState, 'expire sweep'));",                     // bound
      '  return deps.runCcd(argv);',
      '}',
      'async function auditOnly(deps: Deps, id: string) {',
      '  return deps.runCcd(CCD_ARGV.wsReclaimAudit(id, false));',                                                  // an audit: no act
      '}',
      'function question(deps: Deps, id: string): boolean {',
      "  return verbSupported(deps.fleetState, CCD_ARGV.wsExpire('t', id, null));",                                 // a verb question
      '}',
      '// await deps.runCcd(CCD_ARGV.wsReclaim(t, 1, id, false, null));',                                           // a comment
    ]);
    // ── retireQueueSites / retireQueueOwners ──
    at('server/src/watchShape.ts', [
      'export class Watcher {',
      '  learn(id: string): void {',
      '    void this.deps.queue.run(id, () => learnCollect({ coord: this.coord }, id));',                            // (1) audit-only job
      '  }',
      '  act(id: string): void {',
      '    void retireExecutor(this.deps.queue, id, () => collectTempRoot({ coord: this.coord }, { id, epoch: 0 }));', // (3) via retireExecutor
      '  }',
      '  lanes(): object {',
      '    return { queueRun: (id: string, fn: () => Promise<void>) => this.deps.queue.run(id, fn) };',              // (4) the generic forwarder
      '  }',
      '}',
    ]);
    at('server/src/retireExecutor.ts', [                                       // (2) the queue owner by (b), no site
      "import type { KeyedQueue } from './inject/queue.js';",
      'type RetireEntryAnswer = Awaited<ReturnType<typeof reclaimChild>> | Awaited<ReturnType<typeof expireArchived>>',
      '  | Awaited<ReturnType<typeof collectTempRoot>> | Awaited<ReturnType<typeof childReclaimUnlessDisabled>>;',
      'export type RetireEntryRun<T extends RetireEntryAnswer> = () => Promise<T>;',
      "export function retireExecutor<T extends RetireEntryAnswer>(queue: Pick<KeyedQueue, 'run'>, id: string, run: RetireEntryRun<T>): Promise<T> {",
      '  return queue.run(id, run);',
      '}',
    ]);
    at('server/src/notAnOwner.ts', [                                           // (2b) its answer names only the close wrapper
      "import type { KeyedQueue } from './inject/queue.js';",
      'type RetireEntryAnswer = Awaited<ReturnType<typeof childReclaimUnlessDisabled>>;',
      'type RetireEntryRun<T extends RetireEntryAnswer> = () => Promise<T>;',
      "export function wrapperQueue<T extends RetireEntryAnswer>(queue: Pick<KeyedQueue, 'run'>, id: string, run: RetireEntryRun<T>): Promise<T> {",
      '  return queue.run(id, run);',
      '}',
    ]);
    at('server/src/coord/routesShape.ts', [
      'function closePort(deps: Deps, coord: CoordStore): (req: Req) => void {',
      '  return (req) => {',
      '    void deps.queue.run(req.sessionId, () => childReclaimUnlessDisabled(',                                   // (5) the nested shape
      '      { io: deps.io }, () => reclaimChild({ coord }, req))).catch(() => {});',
      '  };',
      '}',
      'function closePortAfter(deps: Deps, coord: CoordStore): (req: Req) => void {',
      '  return (req) => {',
      '    void retireExecutor(deps.queue, req.sessionId, () => childReclaimUnlessDisabled(',                       // (6) the nested shape, via retireExecutor
      '      { io: deps.io }, () => reclaimChild({ coord }, req))).catch(() => {});',
      '  };',
      '}',
      'async function awaited(deps: Deps, id: string): Promise<void> {',
      '  await deps.queue.run(id, () => expireArchived({ coord: deps.coord }, { sessionId: id }));',              // a plain awaited site
      '}',
    ]);
    // ── retireNoticeSites ──
    at('server/src/coord/feeds.ts', [
      "const CHILD_RECLAIM_FEED_TITLE = { reclaimed: 'child reclaimed' };",
      'function ownTitle(deps: Deps, o: Out): void {',                                                              // (i) names the constant
      "  notify(deps, { kind: 'run', title: CHILD_RECLAIM_FEED_TITLE[o.kind], body: '' }, 'record-only');",
      '}',
      'function boundTitle(deps: Deps, o: Out): void {',                                                            // (i) through a local
      '  const title = o.child ? CHILD_RECLAIM_FEED_TITLE.reclaimed : CHILD_RECLAIM_FEED_TITLE[o.kind];',
      "  notify(deps, { kind: 'run', title, body: '' }, 'record-only');",
      '}',
      'function otherTitle(deps: Deps): void {',                                                                    // another lane's title
      "  notify(deps, { kind: 'run', title: ORPHAN_FEED_TITLE.left, body: '' }, 'record-only');",
      '}',
    ]);
    at('server/src/feedWatch.ts', [
      'export class Lane {',
      '  private record(row: { title: string; body: string }): void {',                                            // (ii) fed a title
      "    notify({ coord: this.coord }, { kind: 'run', title: row.title, body: row.body }, 'record-only');",
      '  }',
      '  private recordOther(title: string): void {',                                                              // fed another lane's title
      "    notify({ coord: this.coord }, { kind: 'coord', title, body: '' }, 'record-only');",
      '  }',
      '  pass(): void {',
      "    this.record({ title: COLLECT_FEED_TITLE.switch, body: '' });",
      '    this.recordOther(ORPHAN_FEED_TITLE.left);',
      '  }',
      '}',
    ]);
    // ── retireDeciders (C4i) ──
    at('server/src/deciders.ts', [
      'export function decide(f: Facts, r: Row, req: Req): RetireDecision<Out> {',                    // a declared RetireDecision: counted
      '  return { act: true };',
      '}',
      'export function firstAgentAfter(s: State, at: number): { at: number | null } | { need: string } {', // the `{ need }` shape: not counted
      "  return { need: 'agent-a' };",
      '}',
      'export const arrowDecide = (f: Facts, r: Row, req: Req): RetireDecision<Out> => ({ act: true });', // an arrow const: counted
      'function inferred(f: Facts) { return { need: f.next }; }',                                        // an inferred return: not counted
      'export class Holder { decide(f: Facts): RetireDecision<Out> { return { act: true }; } }',        // a method: not top-level
    ]);
  });
  afterAll(() => { rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE retireGateLadders: one body asking a retire key and presence counts; separate readers, wsArchive and a generic loop do not', () => {
    expect(names(retireGateLadders(tree))).toEqual(['server/src/coord/ladder.ts#arrowLadder', 'server/src/coord/ladder.ts#ladder']);
  });

  // D-7301 (C4k): `RetireActPort` holds its readers in its `read` member, a literal nested in
  // the one the port builder returns. Its own tree, so the row above stays byte-identical.
  it('FIXTURE retireGateLadders: readers in a literal nested in the returned one do not count; the same calls as member values do', () => {
    const nest = mkdtempSync(path.join(tmpdir(), 'consolidation-census-retire-nested-'));
    try {
      const p = path.join(nest, 'server/src/coord/nestedPort.ts');
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, [
        'export function nestedPort(deps: Deps, job: Job): Port {',              // the port's shape: readers under `read`
        '  return {',
        '    read: {',
        "      [STEPS.capability]: () => ccdCan(deps.fleetState, 'wsCollect'),",
        '      [STEPS.presence]: () => deps.viewers?.isVisible(job.id) === true,',
        '    },',
        '    act: (f: Facts) => act(deps, job, f),',
        '  };',
        '}',
        'export function eagerPort(deps: Deps, job: Job): Port {',               // both read in the builder's own body
        '  return {',
        '    read: {',
        "      cap: ccdCan(deps.fleetState, 'wsCollect'),",
        '      seen: deps.viewers?.isVisible(job.id) === true,',
        '    },',
        '  };',
        '}',
      ].join('\n'));
      expect(names(retireGateLadders(nest))).toEqual(['server/src/coord/nestedPort.ts#eagerPort']);
    } finally {
      rmSync(nest, { recursive: true, force: true });
    }
  });

  it('FIXTURE retireActSites: an inline or bound retire verb passed to runCcd counts; an audit, a verb question and a comment do not', () => {
    expect(names(retireActSites(tree))).toEqual(['server/src/acts.ts#boundAct', 'server/src/acts.ts#inlineAct']);
  });

  it('FIXTURE retireQueueSites: rows (1)-(6), one site per queued entry, with its via', () => {
    expect(retireQueueSites(tree).map((s) => [s.symbol, s.via, s.entry]).sort()).toEqual([
      ['server/src/coord/routesShape.ts#awaited', 'queue.run', 'expireArchived'],
      ['server/src/coord/routesShape.ts#closePort', 'queue.run', 'reclaimChild'],
      ['server/src/coord/routesShape.ts#closePortAfter', 'retireExecutor', 'reclaimChild'],
      ['server/src/watchShape.ts#act', 'retireExecutor', 'collectTempRoot'],
    ]);
  });

  it('FIXTURE retireQueueOwners: (a) a queue.run site, (b) the retireExecutor shape through its aliases; (2b), a caller and a forwarder are not', () => {
    expect(retireQueueOwners(tree).map((s) => [s.symbol, s.by]).sort()).toEqual([
      ['server/src/coord/routesShape.ts#awaited', 'a'],
      ['server/src/coord/routesShape.ts#closePort', 'a'],
      ['server/src/retireExecutor.ts#retireExecutor', 'b'],
    ]);
  });

  it('FIXTURE retireNoticeSites: a unit naming a retire title, or fed one by a call in its file; another lane\'s title is not', () => {
    expect(names(retireNoticeSites(tree))).toEqual([
      'server/src/coord/feeds.ts#boundTitle', 'server/src/coord/feeds.ts#ownTitle', 'server/src/feedWatch.ts#record',
    ]);
  });

  it('FIXTURE retireDeciders: a function or an arrow const declared to answer RetireDecision counts; the { need } shape, an inferred return and a method do not', () => {
    expect(names(retireDeciders(tree))).toEqual(['server/src/deciders.ts#arrowDecide', 'server/src/deciders.ts#decide']);
  });

  it('REAL retireGateLadders is pinned exact: 2 -> 1 at C4l, archive-expired through retireAct after C4k (D-7169; 1 -> 0 at C4m)', () => {
    const sites = retireGateLadders();
    show('retireGateLadders', sites);
    expect(names(sites)).toEqual([
      'server/src/coord/childReclaim.ts#childReclaimOutcome',
    ]);
  });

  it('REAL retireActSites is pinned exact: three composers, by name (D-7177)', () => {
    const sites = retireActSites();
    show('retireActSites', sites);
    expect(names(sites)).toEqual([
      'server/src/coord/childReclaim.ts#childReclaimAct',
      'server/src/coord/collectTempRoot.ts#collectTempRootAct',
      'server/src/coord/expireArchived.ts#expireAct',
    ]);
  });

  it('REAL retireQueueSites reports (4 via queue.run at the C4h base; 4 via retireExecutor after C4n)', () => {
    const sites = retireQueueSites();
    show('retireQueueSites', sites);
    expect(Array.isArray(sites)).toBe(true);
  });

  it('REAL retireQueueOwners reports (4 by (a) at the C4h base; 1 by (b) after C4n)', () => {
    const sites = retireQueueOwners();
    show('retireQueueOwners', sites);
    expect(Array.isArray(sites)).toBe(true);
  });

  it('REAL retireNoticeSites is pinned exact, as measured at C4h (D-7176: no notice moves)', () => {
    const sites = retireNoticeSites();
    show('retireNoticeSites', sites);
    expect(names(sites)).toEqual([
      'server/src/coord/childReclaim.ts#recordChildReclaimFeed',
      'server/src/coord/childReclaim.ts#recordChildReclaimKeptFeed',
      'server/src/coord/childReclaim.ts#recordChildReclaimKeptReason',
      'server/src/coord/childReclaim.ts#recordChildReclaimLeafKeptFeed',
      'server/src/coord/childReclaimDisabled.ts#childReclaimDisabledStops',
      'server/src/coord/expireArchived.ts#recordExpireFeed',
      'server/src/watch.ts#collectRecordCoordFeed',
      'server/src/watch.ts#collectRecordFeed',
    ]);
  });

  it('REAL retireDeciders is exactly retire.ts#decideRetire (0 at the C4i base; 1 after it)', () => {
    const sites = retireDeciders();
    show('retireDeciders', sites);
    expect(names(sites)).toEqual(['server/src/retire.ts#decideRetire']);
  });
});

// C4j (D-7167; ARCH-44): the one executor loop, `retireLane.ts#retireAct`. APPENDED; nothing above is edited, and no
// query of `retire.ts` changes. These rows read the source through `scan/symbols.ts` and `scan/parse.ts` only.
describe('the one retire executor loop, retireAct (ARCH-44, C4j)', () => {
  const LOOP = 'server/src/retireLane.ts';
  const UNITS = new Set(['function', 'variable-function', 'method', 'arrow-property']);
  /** The innermost named code unit of each `decideRetire(` call in a parsed file, as `file#name`. */
  const callersIn = (file: string, p: ParsedFile): string[] => p.calls.filter((c) => c.callee === 'decideRetire').map((c) => {
    const unit = p.symbols.filter((u) => UNITS.has(u.kind) && u.start <= c.start && c.end <= u.end).sort((a, b) => b.start - a.start)[0];
    return `${file}#${unit === undefined ? '(module)' : unit.name.slice(unit.name.lastIndexOf('.') + 1)}`;
  });

  it('CONTROL: the caller walk names the unit holding a decideRetire( call, a nested arrow by its own name', () => {
    const p = parseSource([
      'export async function loop(r) { for (;;) { const d = decideRetire({}, r, {}); if (d) return d; } }',
      'const helper = (r) => decideRetire({}, r, {});',
      'export function quiet() { return decideRetireLater(); }',
    ].join('\n'), 'control.ts');
    expect(callersIn('control.ts', p)).toEqual(['control.ts#loop', 'control.ts#helper']);
  });

  it('REAL the one loop is retireLane.ts#retireAct: the only server/src function that calls decideRetire(', () => {
    const callers = sourceFiles(REPO, 'server/src').flatMap((f) => {
      const file = path.relative(REPO, f).split(path.sep).join('/');
      return callersIn(file, parsedFile(f));
    });
    console.log(`census decideRetire callers: ${callers.length}\n${callers.map((c) => `  ${c}`).join('\n')}`);
    expect(callers).toEqual([`${LOOP}#retireAct`]);
  });

  it('REAL retire.ts and retireLane.ts are L1', () => {
    expect(serverRing('server/src/retire.ts')).toEqual({ ring: 'L1', why: 'no outer-ring fact' });
    expect(serverRing(LOOP)).toEqual({ ring: 'L1', why: 'no outer-ring fact' });
  });

  it('REAL retireAct never reads a reason\'s name: the identifier `name` is referenced nowhere in its body', () => {
    const CONTROL = "async function f(reason) { if (reason.name === 'child-spent') return 1; return 0; }";
    expect(identifierReferences(CONTROL, 'control.ts', new Set(['name'])), 'CONTROL: the scan sees a name compare').toHaveLength(1);
    expect(identifierReferences(sourceOfSymbol(LOOP, 'retireAct'), 'retireLane.ts', new Set(['name']))).toEqual([]);
  });
});

// C4k (D-7168, D-7200; ARCH-44): the port's readers and the row's declared steps, which the re-pointed source checks of
// the temp-orphan move read. APPENDED; nothing above is edited.
describe('a reason\'s port readers and row steps, as the re-pointed checks read them (ARCH-44, C4k)', () => {
  const PLANT = [
    'export function aPort(deps: Deps, job: Job): Port {',
    '  return {',
    '    read: {',
    "      [RETIRE_STEPS.capability]: () => ccdCan(deps.fleetState, 'wsCollect'),",
    '      [RETIRE_STEPS.switchesLast]: async () => ({ listedUnder: deps.link.epochNow(), last: await list() }),',
    '      plain: (f) => f.x,',
    '    },',
    '    act: (f) => anAct(deps, job, f),',
    '  };',
    '}',
    'export const A_RETIRE = {',
    '  decide: [',
    '    { step: RETIRE_STEPS.capability, sync: true, onReject: \'propagate\' },',
    '  ],',
    '  audit: { step: RETIRE_STEPS.audit, sync: false, onReject: \'propagate\' },',
    '  act: [',
    '    { step: RETIRE_STEPS.switchesLast, sync: false, onReject: \'propagate\', markers: M },',
    '    { step: RETIRE_STEPS.looseMarker, sync: true, onReject: \'propagate\' },',
    '  ],',
    '};',
    '',
  ].join('\n');
  let dir = '';
  let file = '';
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'consolidation-census-retire-port-'));
    file = path.join(dir, 'aPort.ts');
    writeFileSync(file, PLANT);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('FIXTURE retirePortReaders: each member of the read literal, by step (a computed RETIRE_STEPS name read as its step), with its kind, async flag and span', () => {
    const readers = retirePortReaders(file, 'aPort');
    expect(readers.map((r) => [r.step, r.kind, r.async])).toEqual([
      ['capability', 'arrow', false], ['switches-last', 'arrow', true], ['plain', 'arrow', false]]);
    expect(PLANT.slice(readers[0]!.start, readers[0]!.end)).toBe(readers[0]!.text);
    expect(readers[0]!.text.startsWith('[RETIRE_STEPS.capability]: () => ccdCan(')).toBe(true);
    expect(() => retirePortReaders(file, 'A_RETIRE'), 'a const is no port builder').toThrow(/returns no object literal/);
  });

  it('FIXTURE retireRowSteps: the row\'s steps in decide, audit, act order, each with its sync flag as written', () => {
    expect(retireRowSteps(file, 'A_RETIRE')).toEqual([
      { step: 'capability', sync: true, phase: 'decide' },
      { step: 'audit', sync: false, phase: 'audit' },
      { step: 'switches-last', sync: false, phase: 'act' },
      { step: 'loose-marker', sync: true, phase: 'act' },
    ]);
  });
});
