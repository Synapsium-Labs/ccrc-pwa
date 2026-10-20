// path-identity W2 (spec 2026-10-12 §3.4; TR1 A, TR2 A): a kept-leaf item's temp-root half ends only when a later
// `collect` `done` says the collection removed the leaf. The store passes each collect line's `measJson` and cut flag
// RAW, and L1's one reader answers four kinds: a word of ccd's, `keyless` (an older ccd's uncut line, or the store's
// own `"leaf":null`, the departure present-null-leaf-reads-as-legacy), `truncated-keyless` (a cut line with no `leaf`)
// and `malformed`. The decision is MONOTONE: any `removed` or `keyless` row ends the half, whatever its place;
// otherwise any `absent` keeps the line to the horizon with the found-nothing clause, and such an item never joins the
// kept-many collapse; a cut keyless row and a malformed one end nothing and add nothing. Pure, except the last two
// describes, which read the source text and a fixture store.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECT_LEAF_END_WORDS, type ChildReclaimCollectAttention, type ChildReclaimStuckAttention,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, reviveMeas, type JournalRow } from '../src/coord/journalparse.js';
import {
  CHILD_RECLAIM_COLLECT_NONE, CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_LEAF_END_ACTS,
  childReclaimAttentionWithLeaves, childReclaimLeafEndRead, childReclaimLeafFoundNothing, childReclaimLeafKept,
  childReclaimLeafKeptManySentence,
  type ChildReclaimLeafEndRead, type ChildReclaimLeafEndRow, type ChildReclaimLeafSourceRow,
} from '../src/childReclaimSweep.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
const ID = 'demo-gone';

let mid = 1000;
const src = (o: {
  sessionId?: string; at?: number; truncated?: boolean; meas?: Record<string, unknown> | null; detail?: string | null;
} = {}): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId: o.sessionId ?? ID, at: o.at ?? NOW - DAY, outcome: 'done', refusal: null,
  truncated: o.truncated ?? false, meas: o.meas === null ? null : reviveMeas(o.meas ?? {}), detail: o.detail ?? null,
});
/** A reclaim that kept the temp root, in use, for run 41. */
const TMP_IN_USE_MEAS = { childOf: '41', tmpRootKept: 'in-use' };

const REMOVED: ChildReclaimLeafEndRead = { kind: 'word', word: 'removed' };
const ABSENT: ChildReclaimLeafEndRead = { kind: 'word', word: 'absent' };
const KEYLESS: ChildReclaimLeafEndRead = { kind: 'keyless' };
const CUT_KEYLESS: ChildReclaimLeafEndRead = { kind: 'truncated-keyless' };
const MALFORMED: ChildReclaimLeafEndRead = { kind: 'malformed' };

/** The source row's later `collect` `done` rows, in mirror order, each following it and dated after it. */
const collects = (r: ChildReclaimLeafSourceRow, ...leaves: ChildReclaimLeafEndRead[]): Map<string, readonly ChildReclaimLeafEndRow[]> =>
  new Map<string, readonly ChildReclaimLeafEndRow[]>([[r.sessionId,
    leaves.map((leaf, k): ChildReclaimLeafEndRow => ({ id: r.id + 1 + k, act: 'collect', at: NOW - 1, leaf }))]]);
const derive = (rows: readonly ChildReclaimLeafSourceRow[],
  ends: ReadonlyMap<string, readonly ChildReclaimLeafEndRow[]> = new Map()) => childReclaimLeafKept({ rows, ends, nowMs: NOW });
/** Each item the source row lists, as [its sentence, its found-nothing mark]. */
const listed = (r: ChildReclaimLeafSourceRow, ...leaves: ChildReclaimLeafEndRead[]): [string, boolean][] =>
  derive([r], collects(r, ...leaves)).map((k): [string, boolean] => [k.item.sentence, k.foundNothing]);

const HORIZON = 'This line ends when the id is used for a new workspace, or 7 days after ccd recorded the reclaim; '
  + 'the feed keeps the record.';
const CLIPS_HALF = 'ccrc never removes the clips directory; a person removes it once nothing still uses it.';
const TMP_HALF = 'ccrc’s temp-root collector removes the temp root once it has stood idle, but only while the '
  + 'collector is switched on, the fleet box’s ccd can collect and cleanup is not paused, and only if ccrc recorded '
  + 'handing that directory out; until then, or if the collector lists it for you, a person removes it once nothing '
  + 'still uses it. The temp root leaves this line once it is collected.';
/** The found-nothing clause for ID, verbatim. */
const FOUND = 'The collector found nothing at ~/.cc-tmp/demo-gone and dropped its witness; if ~/.cc-tmp is a mount, '
  + 'check that it is mounted.';
const TMP_LEAD = 'The reclaim of this child completed, but ccd kept its temp root ~/.cc-tmp/demo-gone (in-use: a '
  + `process still used it after the bounded wait). What was kept stays on disk. ${TMP_HALF}`;
const TMP_IN_USE = `${TMP_LEAD} ${HORIZON}`;
const TMP_IN_USE_FOUND = `${TMP_LEAD} ${FOUND} ${HORIZON}`;
const CLIPS_REFUSED = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + `(refused: its removal helper refused it). What was kept stays on disk. ${CLIPS_HALF} ${HORIZON}`;
const BOTH_FOUND = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + '(unmeasured: whether it could be removed could not be measured) and its temp root ~/.cc-tmp/demo-gone '
  + `(refused: its removal helper refused it). What was kept stays on disk. ${CLIPS_HALF} ${TMP_HALF} ${FOUND} ${HORIZON}`;
const CUT = 'The reclaim of this child completed, but the journal line ccd wrote for it was cut to fit, so whether '
  + 'its clips directory or its temp root was kept is not known; the feed row for it carries what ccd said.';
const CUT_FOUND = `${CUT} ${FOUND} ${HORIZON}`;
const TRUNCATED_COLLECTED = `${CUT} Its temp root has since been collected. ${HORIZON}`;

describe('childReclaimLeafEndRead — the raw collect line, read into four kinds (path-identity spec §3.4)', () => {
  it.each([
    ['no meas, uncut: an older ccd’s line', null, false, KEYLESS],
    ['no meas, cut', null, true, CUT_KEYLESS],
    ['the store’s own "leaf":null, uncut (present-null-leaf-reads-as-legacy)', '{"leaf":null}', false, KEYLESS],
    ['a cut line whose meas kept no leaf', '{"resumed":"x"}', true, CUT_KEYLESS],
    ['an older ccd’s finish line: resumed, no leaf, uncut', '{"resumed":"x"}', false, KEYLESS],
    ['removed, on a cut line', '{"leaf":"removed"}', true, REMOVED],
    ['absent, uncut', '{"leaf":"absent"}', false, ABSENT],
    ['a word ccd never writes', '{"leaf":"gone"}', false, MALFORMED],
    ['a number spelled as text', '{"leaf":"7"}', false, MALFORMED],
    ['a number', '{"leaf":7}', false, MALFORMED],
    ['an array, not an object', '[1]', false, MALFORMED],
    ['a number, not an object', '7', false, MALFORMED],
    ['text that does not parse', '{', false, MALFORMED],
    ['a JSON null, cut', 'null', true, CUT_KEYLESS],
    ['a JSON null, uncut', 'null', false, KEYLESS],
  ] as const)('%s', (_what, measJson, truncated, want) => {
    expect(childReclaimLeafEndRead(measJson, truncated)).toEqual(want);
  });

  it('every word of L0’s vocabulary reads as itself, cut or not', () => {
    expect(COLLECT_LEAF_END_WORDS.length).toBeGreaterThan(0);
    for (const word of COLLECT_LEAF_END_WORDS) {
      for (const cut of [false, true]) {
        expect(childReclaimLeafEndRead(JSON.stringify({ leaf: word }), cut), `${word} ${cut}`).toEqual({ kind: 'word', word });
      }
    }
  });
});

describe('the found-nothing clause (path-identity spec §3.4)', () => {
  it('names the path the collector found nothing at, and the mount to check, verbatim', () => {
    expect(childReclaimLeafFoundNothing(ID)).toBe(FOUND);
  });
});

describe('childReclaimLeafKept — the temp-root half ends only on a removal (TR1 A, TR2 A)', () => {
  it('1: removed ends the temp-root half', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), REMOVED)).toEqual([]);
  });

  it('2: absent keeps the line to the horizon, with the clause before the horizon, and marks the item', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), ABSENT)).toEqual([[TMP_IN_USE_FOUND, true]]);
  });

  it('3: a malformed leaf ends nothing and adds nothing: the line reads as if no collect had happened', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), MALFORMED)).toEqual([[TMP_IN_USE, false]]);
  });

  it('4: an older ccd’s uncut keyless line ends it, as before (TR2 A)', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), KEYLESS)).toEqual([]);
  });

  it('5: a cut keyless line ends nothing and adds nothing', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), CUT_KEYLESS)).toEqual([[TMP_IN_USE, false]]);
  });

  it('6: both leaves kept, then absent: the clips half, the temp-root half and the clause', () => {
    const r = src({ meas: { childOf: '41', clipsKept: 'unmeasured', tmpRootKept: 'refused' } });
    expect(listed(r, ABSENT)).toEqual([[BOTH_FOUND, true]]);
  });

  it('7: clips only, then absent: the clips sentence alone, with no clause', () => {
    expect(listed(src({ meas: { childOf: '41', clipsKept: 'refused' } }), ABSENT)).toEqual([[CLIPS_REFUSED, false]]);
  });

  it('8: a cut source, then absent: the cut sentence, the clause and the horizon; then removed: collected', () => {
    const cut = src({ truncated: true, meas: null, detail: 'clips kept (refused)' });
    expect(listed(cut, ABSENT)).toEqual([[CUT_FOUND, true]]);
    expect(listed(cut, REMOVED)).toEqual([[TRUNCATED_COLLECTED, false]]);
  });

  it('9a: absent, then removed: ended', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), ABSENT, REMOVED)).toEqual([]);
  });

  it('9b: removed, then absent: ended — an earlier end still ends', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), REMOVED, ABSENT)).toEqual([]);
  });

  it('9c: malformed, then keyless: ended', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), MALFORMED, KEYLESS)).toEqual([]);
  });

  it('9d: keyless, then malformed: ended — a later unread row never re-opens it', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), KEYLESS, MALFORMED)).toEqual([]);
  });

  it('9e: absent, then malformed: the clause', () => {
    expect(listed(src({ meas: TMP_IN_USE_MEAS }), ABSENT, MALFORMED)).toEqual([[TMP_IN_USE_FOUND, true]]);
  });

  it('10: absent, at the horizon and a millisecond past it: listed, then ended by the horizon', () => {
    expect(listed(src({ at: NOW - 7 * DAY, meas: TMP_IN_USE_MEAS }), ABSENT)).toEqual([[TMP_IN_USE_FOUND, true]]);
    expect(listed(src({ at: NOW - 7 * DAY - 1, meas: TMP_IN_USE_MEAS }), ABSENT)).toEqual([]);
  });

  it('11: absent, then a placed create of the id: ended', () => {
    const r = src({ meas: TMP_IN_USE_MEAS });
    const ends = new Map<string, readonly ChildReclaimLeafEndRow[]>([[ID, [
      { id: r.id + 1, act: 'collect', at: NOW - 2, leaf: ABSENT }, { id: r.id + 2, act: 'create', at: NOW - 1 }]]]);
    expect(derive([r], ends)).toEqual([]);
  });
});

describe('on the list: a found-nothing item never collapses, and yields to a collector item or a reclaim item (path-identity spec §3.4)', () => {
  it(`an absent-ended item stays single with its clause, and the kept-many line counts only the other ${CHILD_RECLAIM_KEPT_MANY_OVER + 1}`, () => {
    const ids = Array.from({ length: CHILD_RECLAIM_KEPT_MANY_OVER + 2 }, (_, k) => `demo-${String.fromCharCode(97 + k)}`);
    const rows = ids.map((sessionId) => src({ sessionId, meas: TMP_IN_USE_MEAS }));
    const odd = rows[3]!;
    const leaves = derive(rows, collects(odd, ABSENT));
    expect(leaves.map((l) => [l.item.sessionId, l.foundNothing]), 'CONTROL: one found-nothing item among the kept ones')
      .toEqual(ids.map((id) => [id, id === odd.sessionId]));
    const lone = leaves.find((l) => l.foundNothing)!.item;
    expect(lone.sentence).toContain(childReclaimLeafFoundNothing(odd.sessionId));
    const rest = leaves.filter((l) => !l.foundNothing);
    expect(childReclaimAttentionWithLeaves([], leaves, CHILD_RECLAIM_COLLECT_NONE)).toEqual([
      lone,
      { kind: 'kept-many', word: 'leaf-kept', members: rest.map((l) => ({ sessionId: l.item.sessionId, runId: 41 })),
        sentence: childReclaimLeafKeptManySentence(CHILD_RECLAIM_KEPT_MANY_OVER + 1) },
    ]);
  });

  it('found-nothing-clause-yields-to-a-collector-item: the collector’s per-id item wins whole, and no item carries the clause (a stated residual, pinned as it stands)', () => {
    const r = src({ meas: TMP_IN_USE_MEAS });
    const leaves = derive([r], collects(r, ABSENT));
    expect(leaves.map((l) => l.foundNothing), 'CONTROL: the leaf item is a found-nothing one').toEqual([true]);
    const c: ChildReclaimCollectAttention = { kind: 'collect', sessionId: ID, runId: 41, word: 'in-use', sentence: 'c demo-gone.' };
    const merged = childReclaimAttentionWithLeaves([], leaves, { perId: [c], manyLead: { 'in-use': 'lead in-use' }, box: [] });
    expect(merged).toEqual([c]);
    expect(JSON.stringify(merged)).not.toContain('The collector found nothing');
  });

  it('found-nothing-clause-yields-to-a-reclaim-item: a reclaim item that holds the id wins whole, and no item carries the clause (a stated residual, pinned as it stands)', () => {
    // The reclaim arm takes its ids first and carries only the collector's quarantine-kept sentence and the leaf's
    // clips clause as second clauses, never the found-nothing clause. This leaf kept no clips directory, so the stuck
    // item comes through byte-identical.
    const r = src({ meas: TMP_IN_USE_MEAS });
    const leaves = derive([r], collects(r, ABSENT));
    expect(leaves.map((l) => l.foundNothing), 'CONTROL: the leaf item is a found-nothing one').toEqual([true]);
    const stuck: ChildReclaimStuckAttention = {
      kind: 'stuck', sessionId: ID, runId: 41, token: 'containment-refuted', sentence: 's', at: NOW };
    const merged = childReclaimAttentionWithLeaves([stuck], leaves, CHILD_RECLAIM_COLLECT_NONE);
    expect(merged).toEqual([stuck]);
    expect(JSON.stringify(merged)).not.toContain('The collector found nothing');
  });
});

describe('the two end acts are spelled once (leaf-end-acts-spelled-twice, closed)', () => {
  const readRel = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('L1 declares them, and both L1’s decision and the store’s read take them from there', () => {
    expect(CHILD_RECLAIM_LEAF_END_ACTS).toEqual({ create: 'create', collect: 'collect' });
    const sweep = readRel('server/src/childReclaimSweep.ts');
    expect(sweep).toContain('const LEAF_END_CREATE = CHILD_RECLAIM_LEAF_END_ACTS.create;');
    expect(sweep).toContain('const LEAF_END_COLLECT = CHILD_RECLAIM_LEAF_END_ACTS.collect;');
    const store = readRel('server/src/coord/store.ts');
    const at = store.indexOf('  lifecycleLeafEndsFor(sessionIds: readonly string[])');
    const body = at === -1 ? '' : store.slice(at, store.indexOf('\n  }\n', at));
    expect(body.length, 'the read could not be sliced').toBeGreaterThan(200);
    expect(body).toContain('CHILD_RECLAIM_LEAF_END_ACTS');
    expect(body, 'no act is spelled inside the read').not.toMatch(/'(?:create|collect)'/);
  });
});

describe('CoordStore.lifecycleLeafEndsFor — the collect line passed raw, read by L1 (path-identity spec §3.4)', () => {
  const store = (): CoordStore =>
    new CoordStore(openCoordDb(path.join(mkTmp('ccrc-leaf-end-store-'), '.ccrc', 'coord.db')));
  const GEN = '1790000000000000000';
  const T = 1_790_000_000_000;
  let seq = 0;
  const line = (act: string, at: number, over: Record<string, unknown> = {}): JournalRow =>
    parseJournalLine(JSON.stringify({ uid: `w2leafend.1.${++seq}`, at, act, outcome: 'done', id: 'demo-a', ...over }));
  const ingest = (s: CoordStore, rows: JournalRow[]): void => {
    s.ingestJournal({ gen: GEN, rows, cursor: 100 * rows.length, size: 100 * rows.length, at: 9 });
  };

  it('each collect done row carries the reader’s answer over its line; a create row carries no leaf', () => {
    const s = store();
    ingest(s, [
      line('create', T),
      line('collect', T + 1, { meas: { leaf: 'removed' } }),
      line('collect', T + 2, { meas: { leaf: 'absent' } }),
      line('collect', T + 3, { meas: { leaf: 'bogus' } }),
      line('collect', T + 4),                                              // no meas, not cut
      line('collect', T + 5, { truncated: true }),                         // cut, no meas
      line('collect', T + 6, { truncated: true, meas: { leaf: 'removed' } }),
      line('collect', T + 7, { meas: { leaf: 7 } }),                       // P3 through the store
      line('collect', T + 8, { meas: { leaf: null } }),                    // the departure, through the store
      line('collect', T + 9, { meas: { resumed: 'rec-1' } }),              // an older ccd's finish line
    ]);
    const got = s.lifecycleLeafEndsFor(['demo-a']).get('demo-a')!;
    expect(got.map((e) => [e.act, e.at]))
      .toEqual([['create', T], ...Array.from({ length: 9 }, (_, k) => ['collect', T + 1 + k])]);
    expect(Object.keys(got[0]!).sort(), 'a create row carries no leaf').toEqual(['act', 'at', 'id']);
    expect(got.slice(1).map((e) => (e.act === 'collect' ? e.leaf : 'not a collect row'))).toEqual([
      REMOVED, ABSENT, MALFORMED, KEYLESS, CUT_KEYLESS, REMOVED, MALFORMED, KEYLESS, KEYLESS,
    ]);
  });

  it('a stored "leaf":null is the store’s own spelling: the revived meas writes every key, and it reads keyless', () => {
    const s = store();
    ingest(s, [line('collect', T, { meas: { resumed: 'rec-1' } })]);
    const row = s.db.prepare('SELECT measJson FROM lifecycle_events WHERE act = ?').get('collect') as { measJson: string | null };
    expect(row.measJson).toContain('"leaf":null');
    expect(s.lifecycleLeafEndsFor(['demo-a']).get('demo-a')!.map((e) => (e.act === 'collect' ? e.leaf : null)))
      .toEqual([KEYLESS]);
  });
});
