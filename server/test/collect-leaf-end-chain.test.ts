// path-identity W2 (spec 2026-10-12 §3.4): the kept-leaf end, from ccd's encoder to L1's decision. A `collect` `done`
// line cut to fit at the encoder's meas rung keeps `meas.leaf`; the parser, the store and L1's reader carry it; and the
// decision reads it exactly as it reads an uncut line, which is the spec's "still drives the same decision": `removed`
// ends the temp-root half, `absent` keeps the line with the found-nothing clause. One residual is pinned as it stands:
// a `meas` that is not a JSON object is stored as no `meas` at all, reads as an older ccd's keyless line, and ends the
// half (`non-object-meas-reads-as-keyless`; ccd's encoder never writes one, so that line is built by hand).
// FIXTURE HOME ONLY (`makeCcdHarness`): `_lc_emit` writes into the harness HOME's journal, never the live one. No
// collector runs, so no case walks `/proc`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LC_LINE_MAX } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import {
  childReclaimLeafFoundNothing, childReclaimLeafKept, childReclaimLeafKeptSince, type ChildReclaimLeafKept,
} from '../src/childReclaimSweep.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { NO_TMUX, generationsOf, lcDir } from './lifecycleHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-basin';
const GEN = '1790000000000000000';
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-leaf-end-chain-'), '.ccrc', 'coord.db')));
/** Every journal line in the harness HOME, RAW and in generation order: the bytes the server's sweep parses. */
const rawLines = (h: CcdHarness): string[] => generationsOf(h.home)
  .flatMap((f) => fs.readFileSync(path.join(lcDir(h.home), f), 'utf8').split('\n').filter(Boolean));
/** Parse each raw line as the sweep does, and ingest them in order. */
const ingest = (s: CoordStore, lines: readonly string[]): void => {
  const rows = lines.map((l) => parseJournalLine(l));
  s.ingestJournal({ gen: GEN, rows, cursor: 100 * rows.length, size: 100 * rows.length, at: 9 });
};
/** L1's decision over the store's two reads, as `watch.ts` composes it. */
const decide = (s: CoordStore): ChildReclaimLeafKept[] => {
  const nowMs = Date.now();
  return childReclaimLeafKept({
    rows: s.lifecycleReclaimRowsSince(childReclaimLeafKeptSince(nowMs)), ends: s.lifecycleLeafEndsFor([ID]), nowMs });
};
/** The source: a reclaim `done` that kept the temp root. */
const SOURCE = `${NO_TMUX} _lc_emit reclaim done ${ID} "" verb ws-reclaim meas.childOf 41 meas.tmpRootKept in-use`;
/** A collect `done` carrying `meas.leaf <word>`. CUT: a 2100-byte `resumed` pushes the line past the cap, so the meas
 *  rung fires and the short `detail` survives. Uncut: a short `resumed`. */
const COLLECT = (word: string, cut: boolean): string => `${NO_TMUX} _lc_emit collect done ${ID} "" verb ws-collect `
  + `meas.resumed '${cut ? 'r'.repeat(2100) : 'rec-1'}' meas.leaf ${word} detail short`;

describe('the kept-leaf end, from the encoder to the decision (path-identity spec §3.4)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-leaf-end-chain-'); });
  afterEach(() => { h.cleanup(); });

  it.each([
    ['removed', true], ['absent', true], ['removed', false], ['absent', false],
  ] as const)('meas.leaf %s, cut %s: the line carries the word, and the decision reads it', (word, cut) => {
    h.sh(SOURCE);
    h.sh(COLLECT(word, cut));
    const lines = rawLines(h).filter((l) => (JSON.parse(l) as Record<string, unknown>)['id'] === ID);
    expect(lines.map((l) => (JSON.parse(l) as Record<string, unknown>)['act'])).toEqual(['reclaim', 'collect']);
    const done = JSON.parse(lines[1]!) as Record<string, unknown>;
    if (cut) {
      expect(done['truncated'], 'the line was cut to fit').toBe(true);
      expect(done['meas'], 'the meas rung kept the leaf, and the leaf alone').toEqual({ leaf: word });
      expect(done['detail'], 'the meas rung fired, not the last resort').toBe('short');
      expect(Buffer.byteLength(lines[1]!)).toBeLessThanOrEqual(LC_LINE_MAX);
    } else {
      expect(done['truncated'], 'CONTROL: the line was not cut').toBeUndefined();
      expect(done['meas']).toEqual({ resumed: 'rec-1', leaf: word });
    }
    const s = store();
    ingest(s, lines);
    const got = decide(s);
    if (word === 'removed') {
      expect(got, 'a removal ends the temp-root half, and no clips directory was kept').toEqual([]);
    } else {
      expect(got.map((k) => [k.item.sessionId, k.foundNothing])).toEqual([[ID, true]]);
      expect(got[0]!.item.sentence).toContain(childReclaimLeafFoundNothing(ID));
    }
  }, 60_000);
});

describe('a meas that is not a JSON object: the residual non-object-meas-reads-as-keyless, pinned as it stands', () => {
  const line = (uid: string, o: Record<string, unknown>): string =>
    JSON.stringify({ v: 1, uid, at: Date.now() - 1000, id: ID, outcome: 'done', ...o });
  const source = (): string =>
    line('w2chain.1', { act: 'reclaim', verb: 'ws-reclaim', meas: { childOf: '41', tmpRootKept: 'in-use' } });

  it('is stored as no meas, reads as an older ccd’s keyless line, and ends the temp-root half', () => {
    const s = store();
    ingest(s, [source(), line('w2chain.2', { act: 'collect', verb: 'ws-collect', meas: 7 })]);
    const row = s.db.prepare('SELECT measJson, truncated FROM lifecycle_events WHERE act = ?')
      .get('collect') as { measJson: string | null; truncated: number };
    expect(row.measJson, 'the reviver reads a non-object meas as none, so the store keeps none').toBeNull();
    expect(row.truncated).toBe(0);
    expect(decide(s), 'keyless and uncut: the half ends, as an older ccd’s line ends it').toEqual([]);
    // CONTROL: the same source beside an `absent` collect keeps its line, so the source row was read.
    const c = store();
    ingest(c, [source(), line('w2chain.3', { act: 'collect', verb: 'ws-collect', meas: { leaf: 'absent' } })]);
    expect(decide(c).map((k) => k.foundNothing)).toEqual([true]);
  });
});
