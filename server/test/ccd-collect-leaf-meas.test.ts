// path-identity W2 (spec 2026-10-12 §3.4, TR1 A): a `collect` `done` journals the leaf it ended on. The witness-only
// arm's `done` and a real removal's `done` carried the same keys, so a reader could not tell a collection that removed
// a leaf from one that found nothing there. `meas.leaf` tells them apart: `removed` on `_ws_collect_finish`'s line (the
// slot's leaf proven gone after this collection removed it), `absent` on `_ws_collect_witness_only`'s (no leaf stood at
// the witness's path). The encoder's meas rung keeps `leaf` when it drops every other meas field, and so does its
// last-resort line, so a collect line cut twice still says which it was; a line that passed no `leaf` is cut as before.
// The reviver carries `leaf` and never folds a PRESENT value into null. The words are L0's (`COLLECT_LEAF_END_WORDS`),
// and ccd writes exactly those, both directions.
// FIXTURE HOME ONLY (`makeCcdHarness`, `makePrHarness`): every path derives from `h.home`, and ccd runs as SOURCED
// functions, never through the installed launcher and never against the live HOME. The encoder, census and reviver
// cases run everywhere. The verb cases run on Linux where `mv --no-copy` exists (`collectRaceFixture.ts`), and every
// audit and verb there carries that fixture's `COLLECT_STUBS`, so no case walks the real /proc.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { COLLECT_LEAF_END_WORDS, LIFECYCLE_MEAS_KEYS, isCollectLeafEndWord } from '../../shared/api.js';
import { parseJournalLine, reviveMeas } from '../src/coord/journalparse.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { NO_TMUX, eventsOf, readJournal } from './lifecycleHelpers.js';
import {
  COL_ID, LINUX, NO_COPY, collectVerb, crashAt, crashedAt, docOf, leafOf, orphanLeaf, recordsOf, tokenOf,
} from './collectRaceFixture.js';

/** The last `collect` `done` line in a fixture HOME's journal. */
const lastDone = (home: string): Record<string, unknown> => {
  const done = eventsOf(home, 'collect').filter((e) => e['outcome'] === 'done');
  expect(done.length, 'the CONTROL: a collect done line was journaled').toBeGreaterThan(0);
  return done[done.length - 1]!;
};

describe.skipIf(!LINUX || !NO_COPY)('a collect done journals the leaf it ended on (path-identity spec §3.4): the verb', () => {
  let h: PrHarness;
  beforeEach(() => { h = makePrHarness('ccrc-collect-leaf-meas-'); });
  afterEach(() => { h.cleanup(); });

  it('case 1: a collection that removes the leaf journals meas.leaf removed, and no resumed', () => {
    orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, resumed: false, witness: 'dropped' });
    expect(fs.existsSync(leafOf(h)), 'the CONTROL: the leaf went').toBe(false);
    const done = lastDone(h.home);
    expect(done['verb']).toBe('ws-collect');
    expect(done['meas'], 'a fresh collection passes an empty resumed, which the encoder omits').toEqual({ leaf: 'removed' });
  }, 60_000);

  it('case 2: the witness-only arm journals meas exactly { leaf: absent }', () => {
    orphanLeaf(h);
    fs.rmSync(leafOf(h), { recursive: true });
    const r = collectVerb(h, tokenOf(h));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout), 'the CONTROL: the witness-only arm answered')
      .toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(lastDone(h.home)['meas']).toEqual({ leaf: 'absent' });
  }, 60_000);

  for (const point of ['moved', 'removed', 'emptied', 'witnessed'] as const) {
    it(`case 3: killed at ${point}, the resume journals meas.leaf removed beside the record it finished`, () => {
      orphanLeaf(h);
      collectVerb(h, tokenOf(h), COL_ID, crashAt(point));
      expect(crashedAt(h), 'the CONTROL: the kill fired where it was aimed').toBe(point);
      const recs = recordsOf(h);
      expect(recs, 'the CONTROL: the record stands, for the resume to finish from').toHaveLength(1);
      const r = collectVerb(h, tokenOf(h));
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)).toMatchObject({ collected: COL_ID, record: recs[0], resumed: true });
      expect(lastDone(h.home)['meas']).toEqual({ resumed: recs[0], leaf: 'removed' });
    }, 90_000);
  }
});

describe('the encoder keeps leaf through its truncation ladder (path-identity spec §3.4)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-collect-leaf-enc-'); });
  afterEach(() => { h.cleanup(); });
  const R = 'r'.repeat(2100);
  const D = 'd'.repeat(4000);
  /** The one line `snippet` journaled. */
  const only = (snippet: string): Record<string, unknown> => {
    h.sh(`${NO_TMUX} ${snippet}`);
    const all = readJournal(h.home);
    expect(all, 'the CONTROL: exactly one line was written').toHaveLength(1);
    return all[0]!;
  };

  it('case 4: the meas rung drops every meas field but leaf, and keeps detail', () => {
    const e = only(`_lc_emit collect done demo-quiet-basin "" verb ws-collect meas.resumed '${R}' meas.leaf removed detail short`);
    expect(e['truncated'], 'the line was cut').toBe(true);
    expect(e['meas'], 'the meas rung kept leaf alone').toEqual({ leaf: 'removed' });
    expect(e['detail'], 'the meas rung fired, not the last resort').toBe('short');
    expect(Buffer.byteLength(JSON.stringify(e), 'utf8')).toBeLessThanOrEqual(2048);
    const row = parseJournalLine(JSON.stringify(e));
    expect([row.truncated, row.meas?.leaf, row.meas?.resumed], 'the mirror reads the cut line decided')
      .toEqual([true, 'removed', null]);
  });

  it('case 5: the last-resort line keeps leaf, and nothing else of meas', () => {
    const e = only(`_lc_emit collect done demo-quiet-basin "" verb ws-collect meas.resumed '${R}' meas.leaf absent detail '${D}'`);
    expect(e['truncated']).toBe(true);
    expect(e['detail'], 'the last resort fired: it keeps no detail').toBeUndefined();
    expect(e['meas'], 'the last resort keeps leaf').toEqual({ leaf: 'absent' });
    expect(Buffer.byteLength(JSON.stringify(e), 'utf8')).toBeLessThanOrEqual(2048);
    expect(parseJournalLine(JSON.stringify(e)).meas?.leaf).toBe('absent');
  });

  it('case 5b: a last-resort line that passed no leaf writes no meas key, as before', () => {
    const e = only(`_lc_emit collect done demo-quiet-basin "" verb ws-collect detail '${D}'`);
    expect(e['truncated']).toBe(true);
    expect(e['detail']).toBeUndefined();
    expect(Object.keys(e), 'the last resort of a leafless line is the joinable minimum it always was').not.toContain('meas');
  });

  it('case 6: a cut line that passed no leaf writes meas null at the meas rung, never {}', () => {
    // `childReclaimMirrorLeaf`'s truncated arm reads `meas === null` on a cut reclaim line; a `{}` there would read the
    // cut line as "nothing kept", and drop a kept-leaf item in silence.
    const e = only(`_lc_emit reclaim done demo-x "" verb ws-reclaim meas.workdir '${'w'.repeat(2100)}'`);
    expect(e['truncated']).toBe(true);
    expect(e['meas']).toBeNull();
  });
});

describe('the leaf words ccd writes are L0s, both directions (path-identity spec §3.4)', () => {
  it('case 7: every meas.leaf word in ccd is in COLLECT_LEAF_END_WORDS, and every one of them is written', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const written = [...src.matchAll(/\bmeas\.leaf\s+([a-z-]+)/g)].map((m) => m[1]!);
    expect(written, 'the two `_lc_done collect` lines, each naming one word').toHaveLength(2);
    expect(COLLECT_LEAF_END_WORDS, 'the CONTROL: L0 declares two words').toHaveLength(2);
    expect([...new Set(written)].sort()).toEqual([...COLLECT_LEAF_END_WORDS].sort());
    for (const w of written) expect(isCollectLeafEndWord(w), w).toBe(true);
  });

  it('case 7b: isCollectLeafEndWord admits the two words and nothing else, the audit document’s present included', () => {
    for (const w of COLLECT_LEAF_END_WORDS) expect(isCollectLeafEndWord(w), w).toBe(true);
    for (const v of ['present', 'gone', '', 'REMOVED', 'toString', 7, null, undefined, {}]) {
      expect(isCollectLeafEndWord(v), String(v)).toBe(false);
    }
  });
});

describe('the reviver carries leaf, and never folds a present value into null (path-identity spec §3.4)', () => {
  it.each<readonly [string, Record<string, unknown>, string | null]>([
    ['absent key', {}, null],
    ['JSON null', { leaf: null }, null],
    ['removed', { leaf: 'removed' }, 'removed'],
    ['absent', { leaf: 'absent' }, 'absent'],
    ['a word ccd never writes', { leaf: 'gone' }, 'gone'],
    ['the empty string', { leaf: '' }, ''],
    ['a number', { leaf: 7 }, '7'],
    ['an object', { leaf: {} }, '{}'],
    ['a boolean', { leaf: true }, 'true'],
  ])('case 8: %s', (_what, meas, want) => {
    const once = reviveMeas(meas);
    expect(once!.leaf).toBe(want);
    // The store keeps `JSON.stringify` of the REVIVED object and revives it again on every read: one definition, both
    // directions, and a stored `"leaf":null` must read back as the key it was, not carried.
    expect(reviveMeas(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('case 8: a collect done line carries its leaf through parseJournalLine, and a line without one reads null', () => {
    const lineWith = (meas: unknown): string => JSON.stringify({
      v: 1, uid: '1790000000000000000.1.1', atNs: '1790000000000000000', at: 1_790_000_000_000, act: 'collect',
      outcome: 'done', id: 'demo-quiet-basin', dec: { surface: 'none' }, meas,
    });
    expect(parseJournalLine(lineWith({ leaf: 'absent' })).meas?.leaf).toBe('absent');
    expect(parseJournalLine(lineWith({ resumed: 'x' })).meas?.leaf).toBeNull();
    expect(parseJournalLine(lineWith(null)).meas).toBeNull();
  });

  it('case 9: the revived key list is the derived L0 list, and it holds leaf', () => {
    expect(LIFECYCLE_MEAS_KEYS).toContain('leaf');
    expect(Object.keys(reviveMeas({})!).sort()).toEqual([...LIFECYCLE_MEAS_KEYS].sort());
  });
});
