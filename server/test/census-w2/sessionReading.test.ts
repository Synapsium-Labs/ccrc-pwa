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
    ]);
    at('server/src/words.ts', [
      "export function rawLeaf(live: L) { return live.word === 'busy'; }",
      "export function liveFile(r: R) { return r.liveFile.status !== 'idle'; }",
      "export function reversed(r: R) { return 'shell' === r.word.word; }",
      "export function viaTurnWordOf(live: L) { const word = turnWordOf(live.status); return word === 'idle'; }",
      "export function viaReading(r: R) { const word = r.turn.word; return word === 'busy'; }",
      "export function statusWord(s: S) { return s.status === 'idle'; }",
      "export function otherLiteral(live: L) { return live.word === 'done'; }",
    ]);
  });
  afterAll(() => { rmSync(tree, { recursive: true, force: true }); });

  it('statusLadders: a pane word and a lifecycle fact in one function count; one fact alone, and another word, do not', () => {
    expect(statusLadders(tree)).toEqual(['server/src/ladders.ts#both', 'server/src/ladders.ts#compared']);
  });

  it('rawTurnWordReaders: a raw word compared with idle, busy or shell counts; a Turn from the reading, a plain status and another literal do not', () => {
    expect(rawTurnWordReaders(tree)).toEqual(['server/src/words.ts#liveFile', 'server/src/words.ts#rawLeaf', 'server/src/words.ts#reversed']);
  });
});

describe('one reading of a session: the W2 pins (D-8049; each may only shrink)', () => {
  // `presenceOf` is `readSession`'s ladder. `mailPass` is what is left of the seven: mail delivery weighs the pane, the
  // `.hibernated` stamp and the lifecycle itself to choose its gate. Moving it is a change of its own.
  it('statusLadders(): 2, readSession\'s and the mail pass\'s', () => {
    const sites = statusLadders();
    expect(sites.length).toBeLessThanOrEqual(2);
    expect(sites).toEqual(['server/src/sessionReading.ts#presenceOf', 'server/src/watch.ts#FleetWatcher.mailPass']);
  });

  // The one reading is `turnWordOf`. The rest still compare the word they hold: the stall lane's rungs, which ask only for
  // `doubt` through `stallWatchSays`; the idle-compact nudge; and the interrupt door's verdict and its route. ARCH-50 moved
  // the mail gate, the stop verdict, the sleep verdict and the display collapse, none of which may come back here.
  it('rawTurnWordReaders(): 10, turnWordOf and the nine readers not yet on it', () => {
    const sites = rawTurnWordReaders();
    expect(sites.length).toBeLessThanOrEqual(10);
    expect(sites).toEqual([
      'server/src/coord/stall.ts#stallCoordBusySince',
      'server/src/coord/stall.ts#stallCoordGate',
      'server/src/coord/stall.ts#stallIdleStart',
      'server/src/coord/stall.ts#stallOrphanEInner',
      'server/src/coord/stall.ts#stallVerdictInner',
      'server/src/coord/stall.ts#stallWaveOneLadder',
      'server/src/idlenudge.ts#decideIdleCompactNudge',
      'server/src/inject/send.ts#interruptVerdict',
      'server/src/server.ts#buildServer',
      'server/src/sessionReading.ts#turnWordOf',
    ]);
  });

  it('the named turn policies are the spec\'s four', () => {
    expect(TURN_POLICIES).toEqual(['mail-gate', 'keystroke', 'sleep', 'stall-watch']);
  });
});
