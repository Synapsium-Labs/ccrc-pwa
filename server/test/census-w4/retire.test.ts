// ARCH-44's retire censuses (D-7165, D-7174), held two ways (`consolidation-census.test.ts`'s discipline): against a
// FIXTURE tree, so each query counts what it claims and passes over what it must not, and against the REAL tree.
// REAL rows report and never red before their series starts (spec §5.1 rule 3), except the two the plan pins exact from
// C4h on: `retireActSites` (D-7177: the composers stay three) and `retireNoticeSites` (D-7176: no notice moves).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CensusSite } from '../consolidationCensus.js';
import { retireActSites, retireGateLadders, retireNoticeSites, retireQueueOwners, retireQueueSites } from './retire.js';

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
  });
  afterAll(() => { rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE retireGateLadders: one body asking a retire key and presence counts; separate readers, wsArchive and a generic loop do not', () => {
    expect(names(retireGateLadders(tree))).toEqual(['server/src/coord/ladder.ts#arrowLadder', 'server/src/coord/ladder.ts#ladder']);
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

  it('REAL retireGateLadders reports (3 at the C4h base; 3 -> 2 -> 1 -> 0 through C4k, C4l, C4m)', () => {
    const sites = retireGateLadders();
    show('retireGateLadders', sites);
    expect(Array.isArray(sites)).toBe(true);
  });

  it('REAL retireActSites is pinned exact: three composers, by name (D-7177)', () => {
    const sites = retireActSites();
    show('retireActSites', sites);
    expect(names(sites)).toEqual([
      'server/src/coord/childReclaim.ts#childReclaimAct',
      'server/src/coord/collectTempRoot.ts#collectTempRoot',
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
});
