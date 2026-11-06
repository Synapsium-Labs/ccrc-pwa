// Cleanup un-wedge R2 (spec 2026-11-04 §4.3): the pure reader, sentence table and fold of the rows rung's `heldBy`.
import { describe, expect, it } from 'vitest';
import { HELD_BY_WORDS } from '../../shared/api.js';
import type { ChildReclaimAttention, CoordStatus, ExpiryAttention, HeldByWord } from '../../shared/api.js';
import {
  HELD_BY_ABSENT, cleanupHeldBy, cleanupHeldByAct, heldByOf, heldOnlyByListed, withCleanupHeldBy,
} from '../src/cleanupHeldBy.js';
import type { HeldByRead, HeldByRow, HeldByWorkspace } from '../src/cleanupHeldBy.js';

const row = (id: string, word: HeldByWord = 'gone-unrecorded', workspace: HeldByWorkspace | null = 'absent'): HeldByRow =>
  ({ id, word, workspace });
const rows = (rs: HeldByRow[], own = false): HeldByRead => ({ kind: 'rows', rows: rs, own });
const subjects = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
const noFleet = (): undefined => undefined;

describe('heldByOf', () => {
  it('a document without heldBy is absent', () => {
    expect(heldByOf({})).toEqual({ kind: 'absent' });
    expect(heldByOf(null)).toEqual({ kind: 'absent' });
    expect(heldByOf([])).toEqual({ kind: 'absent' });
    expect(heldByOf({ heldByOwn: false })).toEqual({ kind: 'absent' });
    expect(HELD_BY_ABSENT).toEqual({ kind: 'absent' });
  });
  it('null is not-reached and adds no item', () => {
    const read = heldByOf({ heldBy: null });
    expect(read).toEqual({ kind: 'not-reached' });
    expect(cleanupHeldBy([{ lane: 'reclaim', subject: 's', read }], noFleet)).toEqual([]);
  });
  it('[] is none', () => {
    expect(heldByOf({ heldBy: [], heldByOwn: false })).toEqual({ kind: 'none' });
  });
  it('rows are read with their workspace word, or null', () => {
    const read = heldByOf({
      heldBy: [{ id: 'row-a', word: 'not-plain', workspace: 'present' }, { id: 'row-b', word: 'under-proc', workspace: 'weird' },
        { id: 'row-c', word: 'entry-moved' }],
      heldByOwn: false,
    });
    expect(read).toEqual(rows([row('row-a', 'not-plain', 'present'), row('row-b', 'under-proc', null), row('row-c', 'entry-moved', null)]));
  });
  it('an unknown word is malformed', () => {
    expect(heldByOf({ heldBy: [row('row-a'), { id: 'row-b', word: 'mystery', workspace: 'absent' }] })).toEqual({ kind: 'malformed' });
  });
  it('a non-array is malformed', () => {
    expect(heldByOf({ heldBy: 'row-a' })).toEqual({ kind: 'malformed' });
    expect(heldByOf({ heldBy: {} })).toEqual({ kind: 'malformed' });
  });
  it('a member whose id is null is malformed', () => {
    expect(heldByOf({ heldBy: [{ id: null, word: 'gone-unrecorded', workspace: 'absent' }] })).toEqual({ kind: 'malformed' });
    expect(heldByOf({ heldBy: [{ id: 'a b', word: 'gone-unrecorded' }] })).toEqual({ kind: 'malformed' });
    expect(heldByOf({ heldBy: ['row-a'] })).toEqual({ kind: 'malformed' });
  });
  it('heldByOwn true, or missing, is own', () => {
    const base = [{ id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' }];
    expect(heldByOf({ heldBy: base, heldByOwn: true })).toMatchObject({ kind: 'rows', own: true });
    expect(heldByOf({ heldBy: base })).toMatchObject({ kind: 'rows', own: true });
    expect(heldByOf({ heldBy: base, heldByOwn: 'no' })).toMatchObject({ kind: 'rows', own: true });
    expect(heldByOf({ heldBy: base, heldByOwn: false })).toMatchObject({ kind: 'rows', own: false });
  });
});

describe('heldOnlyByListed', () => {
  it('is true only for rows with own false', () => {
    expect(heldOnlyByListed(rows([row('row-a')], false))).toBe(true);
    expect(heldOnlyByListed(rows([row('row-a')], true))).toBe(false);
    expect(heldOnlyByListed(rows([], false))).toBe(false);
    expect(heldOnlyByListed(undefined)).toBe(false);
    for (const k of ['absent', 'not-reached', 'none', 'malformed'] as const) expect(heldOnlyByListed({ kind: k })).toBe(false);
  });
});

describe('cleanupHeldByAct', () => {
  it('forget is offered only for gone-unrecorded with workspace absent in ccd and null in the fleet state', () => {
    expect(cleanupHeldByAct('gone-unrecorded', 'absent', null)).toBe('forget');
    for (const w of HELD_BY_WORDS.filter((x) => x !== 'gone-unrecorded')) expect(cleanupHeldByAct(w, 'absent', null)).toBe('recheck');
  });
  it('a workspace row is offered no forget', () => {
    expect(cleanupHeldByAct('gone-unrecorded', 'absent', '/x/ws')).toBe('recheck');
    expect(cleanupHeldByAct('gone-unrecorded', 'present', null)).toBe('recheck');
  });
  it('a row whose workspace field is unreadable is offered no forget', () => {
    expect(cleanupHeldByAct('gone-unrecorded', 'unreadable', null)).toBe('recheck');
    expect(cleanupHeldByAct('gone-unrecorded', null, null)).toBe('recheck');
  });
  it('a row missing from the fleet state is offered no forget', () => {
    expect(cleanupHeldByAct('gone-unrecorded', 'absent', undefined)).toBe('recheck');
  });
});

describe('cleanupHeldBy', () => {
  it('two rows holding 270 children make two items with counts per lane', () => {
    const inputs = [
      ...subjects('project-a-child', 268).map((s) => ({ lane: 'reclaim' as const, subject: s, read: rows([row('row-a')]) })),
      { lane: 'collect' as const, subject: 'tmp-1', read: rows([row('row-a')]) },
      ...subjects('project-b-child', 2).map((s) => ({ lane: 'reclaim' as const, subject: s, read: rows([row('row-b')]) })),
      { lane: 'expire' as const, subject: 'arch-1', read: rows([row('row-b')]) },
    ];
    const items = cleanupHeldBy(inputs, () => null);
    expect(items.map((i) => [i.rowId, i.holds])).toEqual([
      ['row-a', { reclaim: 268, expire: 0, collect: 1 }],
      ['row-b', { reclaim: 2, expire: 1, collect: 0 }],
    ]);
    expect(items[0]!.sentence).toContain('It holds 268 child workspaces, 0 archived workspaces and 1 temp root from being cleaned up.');
    expect(items[1]!.sentence).toContain('It holds 2 child workspaces, 1 archived workspace and 0 temp roots from being cleaned up.');
  });
  it('the same subject named twice counts once', () => {
    const r = rows([row('row-a')]);
    const items = cleanupHeldBy([{ lane: 'reclaim', subject: 's', read: r }, { lane: 'reclaim', subject: 's', read: r }], noFleet);
    expect(items[0]!.holds.reclaim).toBe(1);
  });
  it('a row named in all three lanes is one item', () => {
    const r = rows([row('row-a')]);
    const items = cleanupHeldBy([
      { lane: 'reclaim', subject: 'c1', read: r }, { lane: 'expire', subject: 'c2', read: r }, { lane: 'collect', subject: 'c3', read: r },
    ], () => null);
    expect(items).toHaveLength(1);
    expect(items[0]!.holds).toEqual({ reclaim: 1, expire: 1, collect: 1 });
    expect(items[0]!.act).toBe('forget');
  });
  it('items are sorted by row id', () => {
    const items = cleanupHeldBy([
      { lane: 'reclaim', subject: 'c1', read: rows([row('row-c'), row('row-a'), row('row-b')]) },
    ], noFleet);
    expect(items.map((i) => i.rowId)).toEqual(['row-a', 'row-b', 'row-c']);
  });
  it('only rows reads contribute', () => {
    const reads: HeldByRead[] = [{ kind: 'absent' }, { kind: 'not-reached' }, { kind: 'none' }, { kind: 'malformed' }];
    expect(cleanupHeldBy(reads.map((read, i) => ({ lane: 'reclaim' as const, subject: `s${i}`, read })), noFleet)).toEqual([]);
  });
  it('each word has its own sentence', () => {
    const sentences = HELD_BY_WORDS.map((w) => {
      const [item] = cleanupHeldBy([{ lane: 'reclaim', subject: 's', read: rows([row('row-a', w, 'present')]) }], () => '/x/ws');
      expect(item!.word).toBe(w);
      expect(item!.act).toBe('recheck');
      expect(item!.sentence.length).toBeGreaterThan(40);
      return item!.sentence;
    });
    expect(new Set(sentences).size).toBe(HELD_BY_WORDS.length);
    const forget = cleanupHeldBy([{ lane: 'reclaim', subject: 's', read: rows([row('row-a')]) }], () => null)[0]!;
    expect(forget.act).toBe('forget');
    expect(sentences).not.toContain(forget.sentence);
  });
  it('a row named with two words takes the first in table order and says so', () => {
    const items = cleanupHeldBy([
      { lane: 'reclaim', subject: 'c1', read: rows([row('row-a', 'entry-moved', 'present')]) },
      { lane: 'reclaim', subject: 'c2', read: rows([row('row-a', 'not-plain', 'present')]) },
    ], noFleet);
    expect(items).toHaveLength(1);
    expect(items[0]!.word).toBe('not-plain');
    expect(items[0]!.sentence).toContain('entry-moved');
  });
  it('forget needs every read of the row to say absent', () => {
    const items = cleanupHeldBy([
      { lane: 'reclaim', subject: 'c1', read: rows([row('row-a', 'gone-unrecorded', 'absent')]) },
      { lane: 'expire', subject: 'c2', read: rows([row('row-a', 'gone-unrecorded', 'unreadable')]) },
    ], () => null);
    expect(items[0]!.act).toBe('recheck');
  });
});

const failing = (id: string, token = 'probe-unmeasured'): ChildReclaimAttention =>
  ({ kind: 'failing', sessionId: id, runId: null, token, sentence: 's', at: 1 });
const stuck = (id: string, token = 'probe-unmeasured'): ChildReclaimAttention =>
  ({ kind: 'stuck', sessionId: id, runId: null, token, sentence: 's', at: 1 });
const terminal = (id: string): ChildReclaimAttention =>
  ({ kind: 'terminal', sessionId: id, runId: null, token: 'probe-unmeasured', sentence: 's', at: 1 });
const expFailing = (id: string): ExpiryAttention =>
  ({ sessionId: id, kind: 'failing', sentence: 's', archivedAt: 1, expiresAt: 2, at: 3 });
const expHeld = (id: string): ExpiryAttention =>
  ({ sessionId: id, kind: 'held', sentence: 's', archivedAt: 1, expiresAt: 2, at: 3 });
const status = (r: ChildReclaimAttention[], e?: ExpiryAttention[]): CoordStatus =>
  ({ childReclaimAttention: r, ...(e ? { expiryAttention: e } : {}) }) as unknown as CoordStatus;
const lane = (m: Record<string, HeldByRead | undefined>): ReadonlyMap<string, { heldBy?: HeldByRead }> =>
  new Map(Object.entries(m).map(([k, v]) => [k, v === undefined ? {} : { heldBy: v }]));
const none = lane({});
const listed = rows([row('row-a')], false);

describe('withCleanupHeldBy', () => {
  it('three held children fold into the row\'s line', () => {
    const ids = ['project-a-child-1', 'project-a-child-2', 'project-a-child-3'];
    const out = withCleanupHeldBy(
      status([...ids.map((i) => failing(i)), stuck('project-a-child-4')].slice(0, 3).concat([stuck('project-a-child-4')])),
      { reclaim: lane({ ...Object.fromEntries(ids.map((i) => [i, listed])), 'project-a-child-4': listed }), expire: none, collect: none },
      [{ id: 'row-a', workspace: null }]);
    expect(out.childReclaimAttention).toEqual([]);
    expect(out.cleanupHeldBy).toHaveLength(1);
    expect(out.cleanupHeldBy![0]).toMatchObject({ rowId: 'row-a', holds: { reclaim: 4, expire: 0, collect: 0 }, act: 'forget' });
  });
  it('a child held only by listed rows but with its own fault keeps its item', () => {
    const f = failing('project-a-child-1');
    const out = withCleanupHeldBy(status([f]), { reclaim: lane({ 'project-a-child-1': rows([row('row-a')], true) }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention).toEqual([f]);
  });
  it('a child refused for another reason keeps its own item', () => {
    const items = [terminal('c1'), failing('c2', 'pin-failed'), stuck('c3', 'pin-failed')];
    const out = withCleanupHeldBy(status(items), { reclaim: lane({ c1: listed, c2: listed, c3: listed }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention).toEqual(items);
  });
  it('items of other children and kinds stay in order', () => {
    const items = [failing('c1'), terminal('c2'), failing('c3'), failing('c4')];
    const out = withCleanupHeldBy(status(items), { reclaim: lane({ c1: listed, c3: none.get('x')?.heldBy }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention).toEqual([items[1], items[2], items[3]]);
  });
  it('a child whose read is absent (older ccd) keeps its item', () => {
    const f = failing('c1');
    for (const read of [undefined, HELD_BY_ABSENT]) {
      const out = withCleanupHeldBy(status([f]), { reclaim: lane({ c1: read }), expire: none, collect: none }, null);
      expect(out.childReclaimAttention).toEqual([f]);
    }
    expect(withCleanupHeldBy(status([f]), { reclaim: none, expire: none, collect: none }, null).childReclaimAttention).toEqual([f]);
  });
  it('a malformed read keeps its item', () => {
    const f = failing('c1');
    const out = withCleanupHeldBy(status([f]), { reclaim: lane({ c1: { kind: 'malformed' } }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention).toEqual([f]);
  });
  it('a none or not-reached read keeps its item', () => {
    const f = failing('c1');
    for (const read of [{ kind: 'none' }, { kind: 'not-reached' }] as HeldByRead[]) {
      expect(withCleanupHeldBy(status([f]), { reclaim: lane({ c1: read }), expire: none, collect: none }, null).childReclaimAttention).toEqual([f]);
    }
  });
  it('an expiry failing item held only by listed rows folds', () => {
    const out = withCleanupHeldBy(status([], [expFailing('a1'), expHeld('a1')]), { reclaim: none, expire: lane({ a1: listed }), collect: none }, null);
    expect(out.expiryAttention).toEqual([expHeld('a1')]);
    expect(out.cleanupHeldBy![0]!.holds.expire).toBe(1);
  });
  it('an expiry child with its own fault keeps its item', () => {
    const e = expFailing('a1');
    const out = withCleanupHeldBy(status([], [e]), { reclaim: none, expire: lane({ a1: rows([row('row-a')], true) }), collect: none }, null);
    expect(out.expiryAttention).toEqual([e]);
  });
  it('an expiry child whose read is absent keeps its item', () => {
    const e = expFailing('a1');
    expect(withCleanupHeldBy(status([], [e]), { reclaim: none, expire: lane({ a1: undefined }), collect: none }, null).expiryAttention).toEqual([e]);
  });
  it('an expiry child with a malformed read keeps its item', () => {
    const e = expFailing('a1');
    expect(withCleanupHeldBy(status([], [e]), { reclaim: none, expire: lane({ a1: { kind: 'malformed' } }), collect: none }, null).expiryAttention).toEqual([e]);
  });
  it('expiryAttention is not added when the status had none', () => {
    expect('expiryAttention' in withCleanupHeldBy(status([]), { reclaim: none, expire: none, collect: none }, null)).toBe(false);
  });
  it('the fleet being unknown leaves forget off', () => {
    const out = withCleanupHeldBy(status([]), { reclaim: lane({ c1: listed }), expire: none, collect: none }, null);
    expect(out.cleanupHeldBy![0]!.act).toBe('recheck');
  });
});
