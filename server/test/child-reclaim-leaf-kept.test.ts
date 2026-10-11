// Child-reclamation wave 8: the kept leaves (spec §5.6, §5.9). ccd's shared reclaim tail keeps a
// clips directory or a temp root it cannot prove gone and journals the word on the reclaim's `done`
// row, or on a purge failure's. After a `done` the registry row is gone, so no arm that reads the
// listing can name the child: this item comes from the lifecycle mirror alone. The word classifier,
// `leafKeptWord`, is L0's and is pinned beside its declaration; this file only reads through it.
import { describe, it, expect } from 'vitest';
import {
  CHILD_RECLAIM_KEPT_WORDS, LC_LINE_MAX, type ChildReclaimAttention, type ChildReclaimLeafKeptAttention,
  type LifecycleOutcome,
} from '../../shared/api.js';
import { reviveMeas } from '../src/coord/journalparse.js';
import { CHILD_RECLAIM_PURGE_INCOMPLETE, childReclaimLeafKeptFeedBody } from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_LEAF_FAILED_TOKENS, CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS,
  CHILD_RECLAIM_LEAF_KEPT_MANY_WORD, childReclaimAttentionWithLeaves, childReclaimDetailText, childReclaimLeafKept,
  childReclaimLeafKeptManySentence, childReclaimLeafKeptSince, childReclaimMirrorLeaf,
  type ChildReclaimLeafEndRow, type ChildReclaimLeafSourceRow,
} from '../src/childReclaimSweep.js';
const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
const ID = 'demo-gone';

let mid = 1000;
const src = (o: {
  sessionId?: string; outcome?: LifecycleOutcome; refusal?: string | null; at?: number; truncated?: boolean;
  meas?: Record<string, unknown> | null; detail?: string | null;
} = {}): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId: o.sessionId ?? ID, at: o.at ?? NOW - DAY, outcome: o.outcome ?? 'done',
  refusal: o.refusal ?? null, truncated: o.truncated ?? false,
  meas: o.meas === null ? null : reviveMeas(o.meas ?? {}), detail: o.detail ?? null,
});
const ends = (rows: readonly ChildReclaimLeafEndRow[]): Map<string, readonly ChildReclaimLeafEndRow[]> =>
  new Map([[ID, rows]]);
const derive = (rows: readonly ChildReclaimLeafSourceRow[],
  e: ReadonlyMap<string, readonly ChildReclaimLeafEndRow[]> = new Map()) =>
  childReclaimLeafKept({ rows, ends: e, nowMs: NOW });

const HORIZON = 'This line ends when the id is used for a new workspace, or 7 days after ccd recorded the reclaim; '
  + 'the feed keeps the record.';
const KEPT_TAIL = 'What was kept stays on disk and ccrc deletes nothing more of it; a person removes it once nothing '
  + 'still uses it.';
const TMP_IN_USE = 'The reclaim of this child completed, but ccd kept its temp root ~/.cc-tmp/demo-gone (in-use: a '
  + `process still used it after the bounded wait). ${KEPT_TAIL} The temp root leaves this line once it is collected. `
  + HORIZON;
const CLIPS_REFUSED = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + `(refused: its removal helper refused it). ${KEPT_TAIL} ${HORIZON}`;
const BOTH = 'The reclaim of this child completed, but ccd kept its clips directory ~/.cc-clips/demo-gone '
  + '(unmeasured: whether it could be removed could not be measured) and its temp root ~/.cc-tmp/demo-gone '
  + `(refused: its removal helper refused it). ${KEPT_TAIL} The temp root leaves this line once it is collected. `
  + HORIZON;
const CUT = 'The reclaim of this child completed, but the journal line ccd wrote for it was cut to fit, so whether '
  + 'its clips directory or its temp root was kept is not known; the feed row for it carries what ccd said.';
const TRUNCATED = `${CUT} ${HORIZON}`;
const TRUNCATED_COLLECTED = `${CUT} Its temp root has since been collected. ${HORIZON}`;
/** A cut line whose `detail` is gone too, ccd's last-resort line, never points at the feed. */
const CUT_BARE = 'The reclaim of this child completed, but the journal line ccd wrote for it was cut to fit, so whether '
  + "its clips directory or its temp root was kept is not known; ccd's line kept no detail either, so the feed "
  + 'cannot name it; look for ~/.cc-clips/demo-gone and ~/.cc-tmp/demo-gone on the fleet box.';

describe('childReclaimMirrorLeaf — the mirror reader: kept:<word>, none-or-unreported, truncated', () => {
  it('reads a word on the key as kept', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'kept', word: 'in-use' });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'none-or-unreported' });
  });

  it('reads a value ccd does not print as kept, unmeasured', () => {
    expect(childReclaimMirrorLeaf(src({ meas: { clipsKept: 'held-open' } }), 'clipsKept'))
      .toEqual({ kind: 'kept', word: 'unmeasured' });
  });

  it('reads an absent key as none-or-unreported: the encoder omits an empty value, and an older ccd wrote none', () => {
    const r = src({ meas: { childOf: '41' } });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'none-or-unreported' });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'none-or-unreported' });
  });

  it('reads a line cut to fit that lost its meas as truncated, on both keys', () => {
    const r = src({ truncated: true, meas: null });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'truncated' });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'truncated' });
  });

  it('reads a line with no meas that was not cut as none-or-unreported', () => {
    expect(childReclaimMirrorLeaf(src({ meas: null }), 'tmpRootKept')).toEqual({ kind: 'none-or-unreported' });
  });

  it('reads a cut line that kept its meas from its meas: the encoder drops meas last', () => {
    const r = src({ truncated: true, meas: { clipsKept: 'refused' } });
    expect(childReclaimMirrorLeaf(r, 'clipsKept')).toEqual({ kind: 'kept', word: 'refused' });
    expect(childReclaimMirrorLeaf(r, 'tmpRootKept')).toEqual({ kind: 'none-or-unreported' });
  });
});

describe('childReclaimLeafKept — one item per id, from its latest reclaim row that carries the keys', () => {
  it('lists a done row that kept the temp root, with the minting run, ccd\'s at, the sentence and ccd\'s line', () => {
    const r = src({ meas: { childOf: '41', tmpRootKept: 'in-use' }, detail: 'temp root kept (in-use): pid 7' });
    expect(derive([r])).toEqual([{
      item: { kind: 'leaf-kept', sessionId: ID, runId: 41, sentence: TMP_IN_USE, at: NOW - DAY },
      source: r.id, detail: 'temp root kept (in-use): pid 7',
    }]);
  });

  it('lists both leaves in one item', () => {
    const got = derive([src({ meas: { childOf: '41', clipsKept: 'unmeasured', tmpRootKept: 'refused' } })]);
    expect(got.map((k) => k.item.sentence)).toEqual([BOTH]);
  });

  it('raises nothing for a done row that kept nothing, or whose ccd did not say', () => {
    expect(derive([src({ meas: { childOf: '41' } }), src({ sessionId: 'demo-b', meas: null })])).toEqual([]);
  });

  it('lists the three purge failures, whose act completed, and no other failure or refusal', () => {
    expect([...CHILD_RECLAIM_LEAF_FAILED_TOKENS]).toEqual(['purge-incomplete', 'purge-mechanism-absent', 'purge-refused']);
    const kept = { tmpRootKept: 'unmeasured' };
    const rows = [
      ...CHILD_RECLAIM_LEAF_FAILED_TOKENS.map((t, k) => src({ sessionId: `demo-p${k}`, outcome: 'failed', refusal: t, meas: kept })),
      src({ sessionId: 'demo-x', outcome: 'failed', refusal: 'worktree-remove-failed', meas: kept }),
      src({ sessionId: 'demo-y', outcome: 'failed', refusal: null, meas: kept }),
      src({ sessionId: 'demo-z', outcome: 'refused', refusal: 'purge-refused', meas: kept }),
    ];
    expect(derive(rows).map((k) => k.item.sessionId)).toEqual(['demo-p0', 'demo-p1', 'demo-p2']);
  });

  it('the purge-failure set holds the executor\'s purge-incomplete word: L1 spells it, typed against L0, and this ties the two', () => {
    expect(CHILD_RECLAIM_LEAF_FAILED_TOKENS as readonly string[]).toContain(CHILD_RECLAIM_PURGE_INCOMPLETE);
  });

  it('lists a line cut to fit, with no run and its own sentence', () => {
    const r = src({ truncated: true, meas: null, detail: 'clips kept (refused)' });
    expect(derive([r])).toEqual([{
      item: { kind: 'leaf-kept', sessionId: ID, runId: null, sentence: TRUNCATED, at: NOW - DAY }, source: r.id,
      detail: 'clips kept (refused)',
    }]);
  });

  it('a line cut to fit that kept no detail either never points at the feed: it names where to look', () => {
    for (const detail of [null, '']) {
      const got = derive([src({ truncated: true, meas: null, detail })]);
      expect(got.map((k) => k.item.sentence), JSON.stringify(detail)).toEqual([`${CUT_BARE} ${HORIZON}`]);
      expect(got[0]!.item.sentence).not.toContain('carries what ccd said');
    }
  });

  it('reads the LATEST row of the id by the mirror\'s id: a later done that kept nothing ends an earlier kept one', () => {
    const kept = src({ outcome: 'failed', refusal: 'purge-refused', meas: { tmpRootKept: 'in-use' } });
    const clean = src({ meas: { childOf: '41' } });
    expect(derive([kept, clean])).toEqual([]);
    expect(derive([clean, kept]), 'array order decided "latest"').toEqual([]);
  });

  it('takes the run from childOf only when it is a run id', () => {
    const run = (childOf?: string): number | null =>
      derive([src({ meas: { tmpRootKept: 'in-use', ...(childOf === undefined ? {} : { childOf }) } })])[0]!.item.runId;
    expect(run('41')).toBe(41);
    for (const v of ['0', 'x', '12345678901', undefined]) expect(run(v), String(v)).toBeNull();
  });
});

describe('how the item ends', () => {
  it('a later PLACED create of the id ends both halves', () => {
    const r = src({ meas: { clipsKept: 'refused', tmpRootKept: 'in-use' } });
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: NOW - 1 }]))).toEqual([]);
  });

  it('a create that is not placed ends nothing: no at, or an at ahead of the server clock', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: null }]))).toHaveLength(1);
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: NOW + 1 }]))).toHaveLength(1);
  });

  it('a create that does not follow the row ends nothing: ccd\'s own clock puts it first, or the mirror holds it earlier', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    expect(derive([r], ends([{ id: r.id + 1, act: 'create', at: r.at - 1 }])), 'clock').toHaveLength(1);
    expect(derive([r], ends([{ id: r.id - 1, act: 'create', at: r.at + 1 }])), 'mirror id').toHaveLength(1);
  });

  it('a later collect ends the temp-root half only, never the clips half', () => {
    const tmpOnly = src({ meas: { childOf: '41', tmpRootKept: 'in-use' } });
    expect(derive([tmpOnly], ends([{ id: tmpOnly.id + 1, act: 'collect', at: NOW - 1 }]))).toEqual([]);
    const both = src({ meas: { childOf: '41', clipsKept: 'refused', tmpRootKept: 'in-use' } });
    expect(derive([both], ends([{ id: both.id + 1, act: 'collect', at: NOW - 1 }])).map((k) => k.item.sentence))
      .toEqual([CLIPS_REFUSED]);
    const cut = src({ truncated: true, meas: null, detail: 'clips kept (refused)' });
    expect(derive([cut], ends([{ id: cut.id + 1, act: 'collect', at: null }])).map((k) => k.item.sentence))
      .toEqual([TRUNCATED_COLLECTED]);
  });

  it('a collect that does not follow the row ends nothing', () => {
    const r = src({ meas: { tmpRootKept: 'in-use' } });
    for (const e of [{ id: r.id + 1, act: 'collect' as const, at: r.at - 1 }, { id: r.id - 1, act: 'collect' as const, at: r.at + 1 }]) {
      expect(derive([r], ends([e])).map((k) => k.item.sentence), JSON.stringify(e)).toEqual([TMP_IN_USE]);
    }
  });

  it('ends 7 days after ccd\'s line: listed at the horizon, gone a millisecond past it', () => {
    expect(CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS).toBe(7 * DAY);
    expect(childReclaimLeafKeptSince(NOW)).toBe(NOW - 7 * DAY);
    expect(derive([src({ at: NOW - 7 * DAY, meas: { tmpRootKept: 'in-use' } })])).toHaveLength(1);
    expect(derive([src({ at: NOW - 7 * DAY - 1, meas: { tmpRootKept: 'in-use' } })])).toEqual([]);
  });
});

describe('on the list: one item per child, and the collapse', () => {
  const item = (sessionId: string, runId: number | null = 41): ChildReclaimLeafKeptAttention =>
    ({ kind: 'leaf-kept', sessionId, runId, sentence: `s ${sessionId}`, at: NOW });

  it('a leaf item yields to any item the list already holds for the id, a stuck item and a kept-many member included', () => {
    const list: ChildReclaimAttention[] = [
      { kind: 'terminal', sessionId: 'demo-t', runId: 1, token: 'tree-unreadable', sentence: 't', at: NOW },
      { kind: 'failing', sessionId: 'demo-f', runId: 2, token: 'pin-failed', sentence: 'f', at: NOW },
      { kind: 'stuck', sessionId: 'demo-s', runId: 5, token: 'containment-refuted', sentence: 's', at: NOW },
      { kind: 'kept', sessionId: 'demo-k', runId: 3, word: 'coordinating', sentence: 'k' },
      { kind: 'kept-many', word: 'minting-run-absent', members: [{ sessionId: 'demo-m', runId: 4 }], sentence: 'm' },
    ];
    const leaves = ['demo-t', 'demo-f', 'demo-s', 'demo-k', 'demo-m', 'demo-new'].map((id) => item(id));
    expect(childReclaimAttentionWithLeaves(list, leaves)).toEqual([...list, item('demo-new')]);
  });

  it(`collapses more than ${CHILD_RECLAIM_KEPT_MANY_OVER} items with a run into one line of its own word; an item with no run stays single`, () => {
    const six = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f'].map((id) => item(id));
    const orphan = item('demo-0', null);
    expect(childReclaimAttentionWithLeaves([], [...six, orphan].reverse())).toEqual([
      orphan,
      { kind: 'kept-many', word: 'leaf-kept', members: six.map((a) => ({ sessionId: a.sessionId, runId: 41 })),
        sentence: childReclaimLeafKeptManySentence(6) },
    ]);
    expect(childReclaimLeafKeptManySentence(6)).toBe('6 reclaimed child workspaces have a clips directory or a temp '
      + 'root that ccd kept on disk. Each stays until a person removes it, and the feed row of each names what was '
      + 'kept and why. Each one leaves this line when its id is used for a new workspace, or 7 days after ccd '
      + 'recorded its reclaim.');
  });

  it('five with a run and any number without stay single, ordered by session id', () => {
    const five = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e'].map((id) => item(id));
    const loose = [item('demo-x', null), item('demo-y', null)];
    expect(childReclaimAttentionWithLeaves([], [...loose, ...five])).toEqual([...five, ...loose]);
  });

  it('its collapse word is no kept word, so its line never shares a key with another kept-many line', () => {
    expect(CHILD_RECLAIM_LEAF_KEPT_MANY_WORD).toBe('leaf-kept');
    expect(CHILD_RECLAIM_KEPT_WORDS as readonly string[]).not.toContain(CHILD_RECLAIM_LEAF_KEPT_MANY_WORD);
  });
});

describe('childReclaimDetailText — ccd’s detail as one bounded plain line', () => {
  // Built from code points, never written as escapes: an agent's file write decodes a backslash-u escape.
  const NL = String.fromCharCode(10);
  const RLO = String.fromCharCode(0x202e);
  const LONG = `${'x'.repeat(10)}${NL}${RLO}${'y'.repeat(9988)}`;
  const leaf = (detail: string | null) => ({
    item: { kind: 'leaf-kept' as const, sessionId: ID, runId: null, sentence: 's.', at: NOW }, source: 1, detail });

  it('a 10,000-character detail holding a newline and a bidi override reads as one line of at most LC_LINE_MAX + 1 characters', () => {
    expect(LONG).toHaveLength(10_000);
    const t = childReclaimDetailText(LONG);
    expect(t.includes(NL), 'a newline').toBe(false);
    expect(t.includes(RLO), 'a bidi override').toBe(false);
    expect(t.startsWith(`${'x'.repeat(10)} y`), 'one run of unsafe characters is one space').toBe(true);
    expect(t).toHaveLength(LC_LINE_MAX + 1);
    expect(t.endsWith('…')).toBe(true);
    expect(childReclaimDetailText('temp root kept (in-use): pid 7')).toBe('temp root kept (in-use): pid 7');
    expect(childReclaimDetailText(`${NL}${RLO}`)).toBe('');
    expect(childReclaimLeafKeptFeedBody(leaf(LONG))).toBe(`${ID}: s. ccd recorded: ${t}`);
    expect(childReclaimLeafKeptFeedBody(leaf(NL))).toBe(`${ID}: s. ccd recorded no detail.`);
  });
});
