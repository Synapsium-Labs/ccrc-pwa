// W2's censuses and their pins (D-8049; spec 2026-10-19 §5.5 exit, §5.1 rule 3), held two ways: against a FIXTURE tree, so
// each query counts what it claims and passes over its look-alike, and against the REAL tree, as a may-only-shrink list.
// The third count, `changeLatchSites()` at 0, is pinned already, with its CONTROL row, in
// `single-definition/advance-switches.test.ts`'s change-latch block.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TURN_POLICIES } from '../../src/sessionReading.js';
import { rawTurnWordReaders, statusLadders } from './sessionReading.js';

describe('W2 census: FIXTURE rows', () => {
  let tree = '';
  const at = (rel: string, lines: readonly string[]): void => {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, lines.join('\n'));
  };
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'census-w2-'));
    at('server/src/ladders.ts', [
      "export function both(f: F) { if (f.pane === 'gone') return lifecycleIsDead(f.life); return false; }",
      "export const compared = (v: V, lc: string) => v.verdict !== 'live' && lc === 'stopped';",
      "export function paneOnly(f: F) { return f.pane === 'gone'; }",
      "export function lifeOnly(f: F) { return lifecycleIsDead(f.life); }",
      "export function otherWord(v: V, lc: string) { return v.verdict === 'allow' && lc === 'stopped'; }",
      "export function repeated(f: F, lc: string) { if (f.pane === 'gone') return 1; if (f.pane === 'gone' && lc === 'stopped') return 2; return lifecycleIsDead(f.life) || lifecycleIsDead(f.life); }",
    ]);
    at('server/src/words.ts', [
      "export function rawLeaf(live: L) { return live.word === 'busy'; }",
      "export function liveFile(r: R) { return r.liveFile.status !== 'idle'; }",
      "export function reversed(r: R) { return 'shell' === r.word.word; }",
      "export function viaTurnWordOf(live: L) { const word = turnWordOf(live.status); return word === 'idle'; }",
      "export function viaReading(r: R) { const word = r.turn.word; return word === 'busy'; }",
      "export function rawBesideBinding(live: L) { const word = turnWordOf(live.status); if (live.status === 'busy') return 1; if (live.word === 'shell') return 2; return word === 'idle'; }",
      "export function statusWord(s: S) { return s.status === 'idle'; }",
      "export function otherLiteral(live: L) { return live.word === 'done'; }",
      "export function repeated(live: L) { if (live.word === 'busy') return 1; if (live.word === 'busy') return 2; return live.status === 'shell'; }",
      "export function routes(app: A) { app.get('/a', (r: R) => r.word === 'idle'); app.get('/b', (r: R) => r.word === 'shell'); }",
    ]);
  });
  afterAll(() => { rmSync(tree, { recursive: true, force: true }); });

  // One row per site, so a second site in a function already listed is a new row. A list of functions would not see it.
  it('statusLadders: each fact in a function that weighs both is a row, a repeated one too; one fact alone, and another word, are none', () => {
    expect(statusLadders(tree)).toEqual([
      "server/src/ladders.ts#both f.pane === 'gone'",
      'server/src/ladders.ts#both lifecycleIsDead(f.life)',
      "server/src/ladders.ts#compared lc === 'stopped'",
      "server/src/ladders.ts#compared v.verdict !== 'live'",
      "server/src/ladders.ts#repeated f.pane === 'gone'",
      "server/src/ladders.ts#repeated f.pane === 'gone'",
      "server/src/ladders.ts#repeated lc === 'stopped'",
      'server/src/ladders.ts#repeated lifecycleIsDead(f.life)',
      'server/src/ladders.ts#repeated lifecycleIsDead(f.life)',
    ]);
  });

  it('rawTurnWordReaders: each comparison of a raw word with idle, busy or shell is a row, a repeated one and one in a route handler too; a raw read beside a Turn binding too; a Turn from the reading, a plain status and another literal are none', () => {
    expect(rawTurnWordReaders(tree)).toEqual([
      "server/src/words.ts#liveFile r.liveFile.status !== 'idle'",
      "server/src/words.ts#rawBesideBinding live.status === 'busy'",
      "server/src/words.ts#rawBesideBinding live.word === 'shell'",
      "server/src/words.ts#rawLeaf live.word === 'busy'",
      "server/src/words.ts#repeated live.status === 'shell'",
      "server/src/words.ts#repeated live.word === 'busy'",
      "server/src/words.ts#repeated live.word === 'busy'",
      "server/src/words.ts#reversed 'shell' === r.word.word",
      "server/src/words.ts#routes r.word === 'idle'",
      "server/src/words.ts#routes r.word === 'shell'",
    ]);
  });
});

describe('one reading of a session: the W2 pins (D-8049; each may only shrink)', () => {
  const functionsIn = (sites: readonly string[]): number => new Set(sites.map((s) => s.split(' ')[0])).size;

  // `presenceOf` is `readSession`'s ladder. `mailPass` is what is left of the seven: mail delivery weighs the pane, the
  // `.hibernated` stamp and the lifecycle itself to choose its gate. Moving it is a change of its own.
  it('statusLadders(): 2 functions, readSession\'s and the mail pass\'s, weighing 10 facts between them', () => {
    const sites = statusLadders();
    expect(sites.length).toBeLessThanOrEqual(10);
    expect(functionsIn(sites)).toBeLessThanOrEqual(2);
    expect(sites).toEqual([
      "server/src/sessionReading.ts#presenceOf f.pane === 'live'",
      "server/src/sessionReading.ts#presenceOf f.pane === 'unknown'",
      "server/src/sessionReading.ts#presenceOf lc === 'stopped'",
      "server/src/sessionReading.ts#presenceOf lc === 'unmeasurable'",
      'server/src/sessionReading.ts#presenceOf lc === null',
      'server/src/sessionReading.ts#presenceOf lifecycleIsDead(lc)',
      'server/src/watch.ts#FleetWatcher.mailPass lifecycleIsDead(lc)',
      "server/src/watch.ts#FleetWatcher.mailPass sv.verdict === 'gone'",
      "server/src/watch.ts#FleetWatcher.mailPass sv.verdict === 'gone'",
      "server/src/watch.ts#FleetWatcher.mailPass sv.verdict === 'unknown'",
    ]);
  });

  // The one reading is `turnWordOf`. The rest still compare the word they hold: the stall lane's rungs, which ask only for
  // `doubt` through `stallWatchSays`; the idle-compact nudge; and the interrupt door's verdict and its route. ARCH-50 moved
  // the mail gate, the stop verdict, the sleep verdict and the display collapse, none of which may come back here.
  it('rawTurnWordReaders(): 14 comparisons in 10 functions, turnWordOf and the nine readers not yet on it', () => {
    const sites = rawTurnWordReaders();
    expect(sites.length).toBeLessThanOrEqual(14);
    expect(functionsIn(sites)).toBeLessThanOrEqual(10);
    expect(sites).toEqual([
      "server/src/coord/stall.ts#stallCoordBusySince live.word !== 'busy'",
      "server/src/coord/stall.ts#stallCoordGate live.word !== 'busy'",
      "server/src/coord/stall.ts#stallIdleStart live.word === 'busy'",
      "server/src/coord/stall.ts#stallOrphanEInner live.word !== 'idle'",
      "server/src/coord/stall.ts#stallVerdictInner live.word === 'busy'",
      "server/src/coord/stall.ts#stallWaveOneLadder word === 'busy'",
      "server/src/idlenudge.ts#decideIdleCompactNudge f.live.word !== 'idle'",
      "server/src/inject/send.ts#interruptVerdict r.word.word === 'busy'",
      "server/src/inject/send.ts#interruptVerdict r.word.word === 'idle'",
      "server/src/inject/send.ts#interruptVerdict r.word.word === 'shell'",
      "server/src/server.ts#buildServer word.word === 'idle'",
      "server/src/sessionReading.ts#turnWordOf raw === 'busy'",
      "server/src/sessionReading.ts#turnWordOf raw === 'idle'",
      "server/src/sessionReading.ts#turnWordOf raw === 'shell'",
    ]);
  });

  it('the named turn policies are the spec\'s four', () => {
    expect(TURN_POLICIES).toEqual(['mail-gate', 'keystroke', 'sleep', 'stall-watch']);
  });
});
