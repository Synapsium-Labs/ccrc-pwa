// Cleanup un-wedge R2 (spec 2026-11-04 §4.3): the pure reader, sentence table and fold of the rows rung's `heldBy`.
import { describe, expect, it } from 'vitest';
import { HELD_BY_WORDS } from '../../shared/api.js';
import type { ChildReclaimAttention, CoordStatus, ExpiryAttention, HeldByWord } from '../../shared/api.js';
import {
  cleanupHeldBy, cleanupHeldByAct, heldOnlyByListed, withCleanupHeldBy,
} from '../src/cleanupHeldBy.js';
import { HELD_BY_ABSENT, heldByOf, heldByFieldOf } from '../src/heldByRead.js';
import type { HeldByRead, HeldByRow, HeldByWorkspace } from '../src/heldByRead.js';
import type { ExpiryReport } from '../src/archivedExpiry.js';
import { parsedFile } from './scan/symbols.js';

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

// Task C15 (D-8111), characterization before the leaf-module move: what a lane parser spreads onto its read.
describe('the spread a lane parser takes', () => {
  it('names heldBy only for a document that names rows, and is empty for every other read', () => {
    const doc = { heldBy: [{ id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' }], heldByOwn: false };
    expect(heldByFieldOf(doc)).toEqual({ heldBy: rows([row('row-a')], false) });
    for (const other of [{}, null, [], { heldBy: null }, { heldBy: [] }, { heldBy: 'row-a' }, { heldBy: [{ id: 'a b', word: 'gone-unrecorded' }] }]) {
      const out = heldByFieldOf(other);
      expect(out).toEqual({});
      expect(Object.keys(out)).toEqual([]);
    }
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
  // Review 1580 F7 and rulings 1-4 and 8: what each sentence says, so a dropped scope, a prune or a pace is a red.
  const sentenceOf = (w: HeldByWord, ws: HeldByWorkspace | null, fleet: string | null): string =>
    cleanupHeldBy([{ lane: 'reclaim', subject: 's', read: rows([row('row-a', w, ws)]) }], () => fleet)[0]!.sentence;
  const PACE = 'usually within minutes for a new hold; a few hours or more for what has been failing a long time; longer when many items are held';
  const PAUSED = 'Nothing is re-read while the cleanup is paused.';
  it('a workspace gone-unrecorded row names the scoped remove and never a prune, and no recreate advice', () => {
    const s = sentenceOf('gone-unrecorded', 'present', '/x/ws');
    expect(s).toContain('`git -C <main> worktree remove <path>`');
    expect(s).toContain('never a repo-wide prune');
    expect(s).not.toContain('<project>');
    expect(s).not.toContain('worktree add');
    expect(s).not.toMatch(/recreate/i);
    expect(s).toContain('If its folder still stands but a directory on its path cannot be searched, make that directory searchable, or restore a link on its path to its original target.');
    expect(s).not.toContain('only cannot be searched');
  });
  it('gone-unrecorded says its folder is gone with no record, or a directory or link on its path cannot be searched', () => {
    for (const s of [sentenceOf('gone-unrecorded', 'present', '/x/ws'), sentenceOf('gone-unrecorded', 'absent', null)]) {
      expect(s).toContain('Its folder is gone with no record, or a directory or link on its path cannot be searched.');
    }
  });
  it('forget says when the cleanup goes ahead, at the held children\'s own pace', () => {
    const s = sentenceOf('gone-unrecorded', 'absent', null);
    expect(s).toContain(`when ccrc next checks what this row holds: ${PACE}. ${PAUSED}`);
    expect(s).not.toContain('next pass');
    expect(s).not.toContain('the children');
  });
  it('under-proc says ccrc never stops that process', () => {
    expect(sentenceOf('under-proc', 'present', '/x/ws')).toContain('ccrc never stops that process');
  });
  it('under-proc and entry-pending keep ccd\'s purge option', () => {
    expect(sentenceOf('under-proc', 'present', '/x/ws')).toContain('Stop and start the session from a plain path, or purge its row.');
    expect(sentenceOf('entry-pending', 'present', '/x/ws')).toContain('Stop and start that session, or purge its row once its session has ended.');
  });
  it('workdir-unreadable names the registry record, not the folder', () => {
    const s = sentenceOf('workdir-unreadable', 'present', '/x/ws');
    expect(s).toContain('This row\'s workdir record in the registry cannot be read (unreadable, or a link).');
    expect(s).toContain('Purge the row once its session has ended, or restore the record to a readable regular file.');
    expect(s).not.toContain('searchable');
  });
  it('not-plain says never replace a link to clear this', () => {
    expect(sentenceOf('not-plain', 'present', '/x/ws')).toContain('never replace a link to clear this');
  });
  it('entry-unmeasured first says remove what stands at that field', () => {
    expect(sentenceOf('entry-unmeasured', 'present', '/x/ws')).toContain('Remove what stands at that field, then stop and start that session.');
  });
  it('a row no longer in the fleet state gets its own sentence, never the workspace one', () => {
    for (const w of HELD_BY_WORDS) {
      const [item] = cleanupHeldBy([{ lane: 'reclaim', subject: 's', read: rows([row('row-a', w)]) }], noFleet);
      expect(item!.act).toBe('recheck');
      expect(item!.sentence).toContain(`The fleet state does not list this row. The line clears as each item it held is checked again, ${PACE}. If it stays after that, a partial registry entry remains for this id; remove it by hand once its session has ended. ${PAUSED}`);
      expect(item!.sentence).not.toContain('no longer registered');
      expect(item!.sentence).not.toContain('only a person removes it');
      expect(item!.sentence).not.toContain('worktree');
    }
  });
  it('with no fleet frame yet, the row\'s state has not been read and no advice is given', () => {
    for (const w of HELD_BY_WORDS) {
      const [item] = cleanupHeldBy([{ lane: 'reclaim', subject: 's', read: rows([row('row-a', w)]) }], null);
      expect(item!.act).toBe('recheck');
      expect(item!.sentence).toContain('This row\'s state in the fleet has not been read yet, so only a re-check is offered.');
      expect(item!.sentence).not.toContain('nothing is offered');
      expect(item!.sentence).not.toContain('only a person removes it');
      expect(item!.sentence).not.toContain('worktree');
      expect(item!.sentence).not.toContain('does not list this row');
    }
  });
  // Review 1585 N4 (the held-pace-two-writers departure): the pace and the pause clause are written in the server's
  // sentences and in the console's confirm words; the two copies must say the same thing.
  it('the pace and the pause clause are the same words on the server and in the console', () => {
    const init = (file: string, name: string): string => {
      const b = parsedFile(file).bindings.filter((x) => x.name === name);
      expect(b, `${file} defines ${name} once`).toHaveLength(1);
      return b[0]!.init;
    };
    for (const name of ['HELD_PACE', 'HELD_PAUSED']) {
      const server = init('server/src/cleanupHeldBy.ts', name);
      expect(server.length).toBeGreaterThan(20);
      expect(init('pwa/src/fleet/heldByRowsWords.ts', name), name).toBe(server);
    }
  });
  // Review 1585 N5: the one L1 edge the fold added, pinned.
  it('cleanupHeldBy imports L0 and only expiryReportStands (and its report type) from archivedExpiry', () => {
    const imports = parsedFile('server/src/cleanupHeldBy.ts').imports;
    expect([...new Set(imports.map((i) => i.specifier))].sort()).toEqual(['../../shared/api.js', './archivedExpiry.js', './heldByRead.js']);
    const edge = imports.filter((i) => i.specifier === './archivedExpiry.js');
    expect(edge.map((i) => ({ names: i.names, typeNames: i.typeNames }))).toEqual([{ names: ['expiryReportStands', 'ExpiryReport'], typeNames: ['ExpiryReport'] }]);
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
// The expiry lane's entries carry `report`, required (review 1585 F5): a lane passed without it does not type-check.
const expLane = (m: Record<string, HeldByRead | undefined>): ReadonlyMap<string, { heldBy?: HeldByRead; report: null }> =>
  new Map(Object.entries(m).map(([k, v]) => [k, v === undefined ? { report: null } : { heldBy: v, report: null }]));
const noExp = expLane({});
const listed = rows([row('row-a')], false);

describe('withCleanupHeldBy', () => {
  it('three held children fold into the row\'s line', () => {
    const ids = ['project-a-child-1', 'project-a-child-2', 'project-a-child-3'];
    const out = withCleanupHeldBy(
      status([...ids.map((i) => failing(i)), stuck('project-a-child-4')].slice(0, 3).concat([stuck('project-a-child-4')])),
      { reclaim: lane({ ...Object.fromEntries(ids.map((i) => [i, listed])), 'project-a-child-4': listed }), expire: noExp, collect: none },
      [{ id: 'row-a', workspace: null }]);
    expect(out.childReclaimAttention).toEqual([]);
    expect(out.cleanupHeldBy).toHaveLength(1);
    expect(out.cleanupHeldBy![0]).toMatchObject({ rowId: 'row-a', holds: { reclaim: 4, expire: 0, collect: 0 }, act: 'forget' });
  });
  it('a child held only by listed rows but with its own fault keeps its item', () => {
    const f = failing('project-a-child-1');
    const out = withCleanupHeldBy(status([f]), { reclaim: lane({ 'project-a-child-1': rows([row('row-a')], true) }), expire: noExp, collect: none }, null);
    expect(out.childReclaimAttention).toEqual([f]);
  });
  it('a child refused for another reason keeps its own item', () => {
    const items = [terminal('c1'), failing('c2', 'pin-failed'), stuck('c3', 'pin-failed')];
    const out = withCleanupHeldBy(status(items), { reclaim: lane({ c1: listed, c2: listed, c3: listed }), expire: noExp, collect: none }, null);
    expect(out.childReclaimAttention).toEqual(items);
  });
  it('items of other children and kinds stay in order', () => {
    const items = [failing('c1'), terminal('c2'), failing('c3'), failing('c4')];
    const out = withCleanupHeldBy(status(items), { reclaim: lane({ c1: listed, c3: none.get('x')?.heldBy }), expire: noExp, collect: none }, null);
    expect(out.childReclaimAttention).toEqual([items[1], items[2], items[3]]);
  });
  it('a child whose read is absent (older ccd) keeps its item', () => {
    const f = failing('c1');
    for (const read of [undefined, HELD_BY_ABSENT]) {
      const out = withCleanupHeldBy(status([f]), { reclaim: lane({ c1: read }), expire: noExp, collect: none }, null);
      expect(out.childReclaimAttention).toEqual([f]);
    }
    expect(withCleanupHeldBy(status([f]), { reclaim: none, expire: noExp, collect: none }, null).childReclaimAttention).toEqual([f]);
  });
  it('a malformed read keeps its item', () => {
    const f = failing('c1');
    const out = withCleanupHeldBy(status([f]), { reclaim: lane({ c1: { kind: 'malformed' } }), expire: noExp, collect: none }, null);
    expect(out.childReclaimAttention).toEqual([f]);
  });
  it('a none or not-reached read keeps its item', () => {
    const f = failing('c1');
    for (const read of [{ kind: 'none' }, { kind: 'not-reached' }] as HeldByRead[]) {
      expect(withCleanupHeldBy(status([f]), { reclaim: lane({ c1: read }), expire: noExp, collect: none }, null).childReclaimAttention).toEqual([f]);
    }
  });
  it('an expiry failing item held only by listed rows folds', () => {
    const out = withCleanupHeldBy(status([], [expFailing('a1'), expHeld('a1')]), { reclaim: none, expire: expLane({ a1: listed }), collect: none }, null);
    expect(out.expiryAttention).toEqual([expHeld('a1')]);
    expect(out.cleanupHeldBy![0]!.holds.expire).toBe(1);
  });
  it('an expiry child with its own fault keeps its item', () => {
    const e = expFailing('a1');
    const out = withCleanupHeldBy(status([], [e]), { reclaim: none, expire: expLane({ a1: rows([row('row-a')], true) }), collect: none }, null);
    expect(out.expiryAttention).toEqual([e]);
  });
  it('an expiry child whose read is absent keeps its item', () => {
    const e = expFailing('a1');
    expect(withCleanupHeldBy(status([], [e]), { reclaim: none, expire: expLane({ a1: undefined }), collect: none }, null).expiryAttention).toEqual([e]);
  });
  it('an expiry child with a malformed read keeps its item', () => {
    const e = expFailing('a1');
    expect(withCleanupHeldBy(status([], [e]), { reclaim: none, expire: expLane({ a1: { kind: 'malformed' } }), collect: none }, null).expiryAttention).toEqual([e]);
  });
  it('expiryAttention is not added when the status had none', () => {
    expect('expiryAttention' in withCleanupHeldBy(status([]), { reclaim: none, expire: noExp, collect: none }, null)).toBe(false);
  });
  it('a forgotten row (no longer in the fleet state) and a missing frame each get their own sentence', () => {
    const lanes = { reclaim: lane({ c1: listed }), expire: noExp, collect: none };
    const forgotten = withCleanupHeldBy(status([]), lanes, [{ id: 'row-b', workspace: null }]).cleanupHeldBy![0]!;
    expect(forgotten).toMatchObject({ rowId: 'row-a', act: 'recheck' });
    expect(forgotten.sentence).toContain('The fleet state does not list this row.');
    const unframed = withCleanupHeldBy(status([]), lanes, null).cleanupHeldBy![0]!;
    expect(unframed.sentence).toContain('has not been read yet');
    expect(unframed.sentence).not.toContain('does not list this row');
  });
  it('an expiry item whose lane report stands keeps its item (a stuck one and a persistent-tier one)', () => {
    const stuckReport: ExpiryReport = { kind: 'stuck', at: 1, detail: 'd', attempts: 2 };
    const tierReport: ExpiryReport = { kind: 'failing', at: 1, detail: 'd', attempts: 4 };
    const passing: ExpiryReport = { kind: 'failing', at: 1, detail: 'd' };
    const exp = new Map<string, { heldBy?: HeldByRead; report: ExpiryReport | null }>([
      ['a1', { heldBy: listed, report: stuckReport }], ['a2', { heldBy: listed, report: tierReport }],
      ['a3', { heldBy: listed, report: passing }],
    ]);
    const out = withCleanupHeldBy(status([], [expFailing('a1'), expFailing('a2'), expFailing('a3')]),
      { reclaim: none, expire: exp, collect: none }, null);
    expect(out.expiryAttention).toEqual([expFailing('a1'), expFailing('a2')]);
  });
  it('the fleet being unknown leaves forget off', () => {
    const out = withCleanupHeldBy(status([]), { reclaim: lane({ c1: listed }), expire: noExp, collect: none }, null);
    expect(out.cleanupHeldBy![0]!.act).toBe('recheck');
  });
});
