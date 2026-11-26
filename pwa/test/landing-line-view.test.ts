// Landing order wave 5k, Task 4: the console's view of one project's line (`fleet/landingLineView.ts`, L1): the wire
// guard, the card, the withdraw preview, the per-card state one read leaves, the equality and the view-hold part.
import { describe, it, expect } from 'vitest';
import type { LandingEntry, LandingLineView, LandingOrder } from '../../shared/landingLine';
import { ApiError } from '../src/lib/apiError';
import {
  landingCardOf, landingCardStateOf, landingLineHoldPart, landingRunless, readLandingLine, sameLandingState, withdrawPreviewOf,
  type LandingCardState,
} from '../src/fleet/landingLineView';
import { LANDING_ROUTE_WORDS, STALE_PREFIX, UNREADABLE_ANSWER_TEXT } from '../src/fleet/landingWords';

const P = 'project-a';
/** Entry ids are the PR plus 900, so a test that confuses an id with a PR goes red. */
const e = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => ({
  id: pr + 900, project: P, pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'c'.repeat(40), runId: pr, state: 'pinned', baseSha: null,
  ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: 1000 + pr, ...over });

/** Section 5's first sketch: #101 the head (fixes main), #104 in line, #107 waits on the withdrawn #103, #102 sent back
 *  (its head moved), #109 set aside, and #110 a run-less pinned entry declared after #104. */
const E101 = e(101, { fixesMain: true });
const E104 = e(104, { afterIds: [1001] });
const E107 = e(107, { afterIds: [1003] });
const E102 = e(102, { state: 'ejected', ejectionKind: 'new-head', ejections: 1 });
const E109 = e(109, { state: 'unknown' });
const view = (over: Partial<LandingLineView> = {}, order: Partial<LandingOrder> = {}): LandingLineView => ({
  project: P, operatorPaused: false, mainRedHold: false, entriesScope: 'open',
  entries: [E101, E102, E104, E107, E109],
  order: { paused: false, order: [E101, E104, E107], head: E101, waits: [{ entryId: 1007, reason: 'withdrawn', on: [{ entryId: 1003, pr: 103 }] }], ...order } as LandingOrder,
  ...over });
const paused = (by: ('operator' | 'main-red')[], extra: Partial<LandingOrder> = {}): LandingLineView =>
  view({ operatorPaused: by.includes('operator'), mainRedHold: by.includes('main-red') },
    { paused: true, by, head: undefined, ...extra } as Partial<LandingOrder>);
const wire = (v: LandingLineView, extra: Record<string, unknown> = {}): unknown => JSON.parse(JSON.stringify({ ok: true, ...v, ...extra }));
const card = (v: LandingLineView) => landingCardOf(v)!;

describe('readLandingLine, the wire guard', () => {
  const binding = { mode: 'ready', entryId: 1001, pr: 101, pinnedSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), landerAt: 'x', probeAt: 'y', healthAt: 'z', fixesMain: true };
  it('a real answer passes, and its result has no binding and no recovery key', () => {
    const got = readLandingLine(wire(view(), { binding, recovery: { subjects: [], hold: null } }));
    expect(got).toEqual(view());
    expect(got).not.toHaveProperty('binding');
    expect(got).not.toHaveProperty('recovery');
  });
  it('an older answer without waits, binding, recovery or entriesScope passes', () => {
    const old = view({}, { waits: undefined });
    delete (old as { entriesScope?: unknown }).entriesScope;
    const raw = wire(old) as Record<string, unknown>;
    delete (raw['order'] as Record<string, unknown>)['waits'];
    expect(readLandingLine(raw)).toEqual(old);
  });
  it('a missing ok, a state outside the vocabulary, a non-array entries and a non-boolean operatorPaused each answer null', () => {
    const raw = wire(view()) as Record<string, unknown>;
    expect(readLandingLine({ ...raw, ok: undefined })).toBeNull();
    expect(readLandingLine({ ...raw, entries: [{ ...E101, state: 'brand-new-state' }] })).toBeNull();
    expect(readLandingLine({ ...raw, entries: 'none' })).toBeNull();
    expect(readLandingLine({ ...raw, operatorPaused: 'yes' })).toBeNull();
    expect(readLandingLine(null)).toBeNull();
  });
});

describe('landingCardOf: nothing to say', () => {
  const empty = (over: Partial<LandingLineView> = {}): LandingLineView =>
    ({ project: P, operatorPaused: false, mainRedHold: false, entries: [], order: { paused: false, order: [], head: null }, ...over });
  it('no entries and both flags off is null', () => { expect(landingCardOf(empty())).toBeNull(); });
  it('no entries and main red alone is null (Q2)', () => {
    expect(landingCardOf(empty({ mainRedHold: true, order: { paused: true, by: ['main-red'], order: [] } }))).toBeNull();
  });
  it('a read whose only entries are terminal (an older server) is null', () => {
    expect(landingCardOf(empty({ entries: [e(1, { state: 'landed' }), e(2, { state: 'withdrawn' }), e(3, { state: 'closed' })] }))).toBeNull();
  });
  it('paused by you with no entries is a card with no rows', () => {
    const c = card(empty({ operatorPaused: true, order: { paused: true, by: ['operator'], order: [] } }));
    expect(c.rows).toEqual([]);
    expect(c.statusText).toBe('Paused by you. Nothing lands.');
    expect(c.pauseLabel).toBe('Resume line');
  });
});

describe('landingCardOf: a running line (section 5\'s first sketch)', () => {
  const c = card(view());
  it('rows are the order first, then the other open entries in the read\'s order, each with its exact text', () => {
    expect(c.rows.map((r) => [r.pr, r.role, r.text])).toEqual([
      [101, 'head', 'next to land'],
      [104, 'in-line', 'in line'],
      [107, 'waits', 'waits on #103 (withdrawn)'],
      [102, 'ejected', 'sent back for a fix round (its head moved)'],
      [109, 'unknown', 'set aside: its record does not read as a current pin, so it is not in the order'],
    ]);
    expect(c.rows.map((r) => r.entryId)).toEqual([1001, 1004, 1007, 1002, 1009]);
    expect(c.statusText).toBe('Next to land: #101.');
    expect(c.status).toEqual({ kind: 'running', headPr: 101 });
    expect(c.rows.filter((r) => r.fixesMain).map((r) => r.pr)).toEqual([101]);
    expect(c.pauseLabel).toBe('Pause line');
    expect(c.pauseBusyLabel).toBe('Pausing…');
    expect(c.pauseNext).toBe(true);
  });
  it('only order.head is the head', () => {
    expect(c.rows.filter((r) => r.role === 'head').map((r) => r.pr)).toEqual([101]);
  });
  it('a run-less entry is runless, through the one reader', () => {
    const r = card(view({ entries: [E101, e(110, { runId: null })] }, { order: [E101], waits: undefined })).rows;
    expect(r.map((x) => [x.pr, x.runless])).toEqual([[101, false], [110, true]]);
    expect(landingRunless({ runId: null })).toBe(true);
    expect(landingRunless({ runId: 7 })).toBe(false);
  });
  it('a waits row with two targets names both, in the read\'s order', () => {
    const r = card(view({}, { waits: [{ entryId: 1007, reason: 'withdrawn', on: [{ entryId: 1003, pr: 103 }, { entryId: 1004, pr: 104 }] }] })).rows;
    expect(r.find((x) => x.pr === 107)!.text).toBe('waits on #103 (withdrawn), #104 (withdrawn)');
  });
  it('an ejected row with no kind, and with each kind', () => {
    const ej = (kind: LandingEntry['ejectionKind']) => card(view({ entries: [e(102, { state: 'ejected', ejectionKind: kind })] }, { order: [], head: null, waits: undefined })).rows[0]!.text;
    expect(ej(null)).toBe('sent back for a fix round');
    expect(ej('dequeued')).toBe('sent back for a fix round (dequeued by the merge queue)');
    expect(ej('conflict')).toBe('sent back for a fix round (it conflicts with main)');
  });
  it('an inconsistent read that lists the ejected and unknown entries in order.order still gives them their own roles', () => {
    const r = card(view({}, { order: [E101, E102, E109, E104, E107] })).rows;
    expect(r.map((x) => [x.pr, x.role])).toEqual([[101, 'head'], [102, 'ejected'], [109, 'unknown'], [104, 'in-line'], [107, 'waits']]);
  });
  it('a running line with no head says none can land', () => {
    const c2 = card(view({}, { head: null }));
    expect(c2.statusText).toBe('No entry can land yet.');
    expect(c2.rows.some((r) => r.role === 'head')).toBe(false);
  });
});

describe('landingCardOf: paused, held, red', () => {
  it.each([
    [['operator'], 'Paused by you. Nothing lands.', 'Resume line'],
    [['main-red'], 'Paused because main is red. Nothing lands.', 'Pause line'],
    [['operator', 'main-red'], 'Paused by you and because main is red. Nothing lands.', 'Resume line'],
  ] as const)('paused %j: its sentence, no head row, and the label', (by, text, label) => {
    const c = card(paused([...by]));
    expect(c.statusText).toBe(text);
    expect(c.status).toEqual({ kind: 'paused', by: [...by], held: false });
    expect(c.rows.some((r) => r.role === 'head')).toBe(false);
    expect(c.pauseLabel).toBe(label);
    expect(c.pauseNext).toBe(label === 'Pause line');
  });
  it('held: no head, a non-empty order, the held status and no head row', () => {
    const c = card(view({}, { head: null, held: { reason: 'landing-recovery-unresolved', subjectIds: [3] } }));
    expect(c.status).toEqual({ kind: 'held' });
    expect(c.statusText).toBe('Held: some of this line\'s records are being recovered. Nothing lands until they are.');
    expect(c.rows.some((r) => r.role === 'head')).toBe(false);
  });
  it('held with main red and a literal fixing head is still held', () => {
    const c = card(view({ mainRedHold: true }, { head: E101, held: { reason: 'landing-recovery-unresolved', subjectIds: [3] } }));
    expect(c.status).toEqual({ kind: 'held' });
  });
  it('paused by you and held says both, the pause first', () => {
    const c = card(paused(['operator'], { held: { reason: 'landing-recovery-unresolved', subjectIds: [3] } }));
    expect(c.statusText).toBe('Paused by you. Nothing lands. Held: some of this line\'s records are being recovered. Nothing lands until they are.');
    expect(c.status).toEqual({ kind: 'paused', by: ['operator'], held: true });
  });
  it('red with a fixing head: its own status and sentence, and the head row', () => {
    const c = card(view({ mainRedHold: true }));
    expect(c.status).toEqual({ kind: 'red-fixes-main', headPr: 101 });
    expect(c.statusText).toBe('Main is red. Only #101, which fixes main, may land.');
    expect(c.rows[0]).toMatchObject({ pr: 101, role: 'head', fixesMain: true });
  });
});

describe('withdrawPreviewOf', () => {
  it('direct dependants only, each with its PR; runless; the view it was read from', () => {
    const v = view({ entries: [E101, E102, E104, E107, E109, e(111, { afterIds: [1004] })] });
    const p = withdrawPreviewOf(v, 1001)!;
    expect(p.entry).toBe(E101);
    expect(p.dependants).toEqual([{ entryId: 1004, pr: 104 }]);   // #111 waits on #104, not directly on #101
    expect(p.runless).toBe(false);
    expect(p.view).toBe(v);
    expect(withdrawPreviewOf(v, 1004)!.dependants).toEqual([{ entryId: 1011, pr: 111 }]);
  });
  it('a run-less entry is runless; an id not open is null', () => {
    const v = view({ entries: [e(110, { runId: null }), e(103, { state: 'withdrawn' })] }, { order: [], head: null, waits: undefined });
    expect(withdrawPreviewOf(v, 1010)!.runless).toBe(true);
    expect(withdrawPreviewOf(v, 1003)).toBeNull();
    expect(withdrawPreviewOf(v, 4242)).toBeNull();
  });
  it('an unknown entry has a preview, with its pinnedAt (R1)', () => {
    const p = withdrawPreviewOf(view(), 1009)!;
    expect(p.entry.state).toBe('unknown');
    expect(p.entry.pinnedAt).toBe(1109);
  });
});

const ok = (v: LandingLineView, extra: Record<string, unknown> = {}) => ({ ok: true as const, raw: wire(v, extra) });
const fail = (status: number, body: unknown) => ({ ok: false as const, err: new ApiError(status, body) });
const line = (v: LandingLineView = view()): LandingCardState => landingCardStateOf(undefined, ok(v));

describe('sameLandingState', () => {
  const binding = (t: string) => ({ binding: { mode: 'ready', entryId: 1001, pr: 101, pinnedSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), landerAt: t, probeAt: t, healthAt: t, fixesMain: true } });
  it('two reads that differ only in the binding\'s times are equal', () => {
    expect(sameLandingState(landingCardStateOf(undefined, ok(view(), binding('t1'))), landingCardStateOf(undefined, ok(view(), binding('t2'))))).toBe(true);
  });
  it('a different pinnedAt on one entry is not equal, nor a different afterIds', () => {
    const moved = view({ entries: [E101, E102, { ...E104, pinnedAt: 9999 }, E107, E109] });
    expect(sameLandingState(line(), line(moved))).toBe(false);
    const reordered = view({ entries: [E101, E102, { ...E104, afterIds: [] }, E107, E109] });
    expect(sameLandingState(line(), line(reordered))).toBe(false);
  });
  it('none equals none, and none never equals a line', () => {
    expect(sameLandingState({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(sameLandingState({ kind: 'none' }, line())).toBe(false);
  });
});

describe('landingLineHoldPart (R8)', () => {
  it('empty for no state and for none', () => {
    expect(landingLineHoldPart(undefined)).toBe('');
    expect(landingLineHoldPart({ kind: 'none' })).toBe('');
  });
  it('the row count, the status letter and the stale mark', () => {
    expect(landingLineHoldPart(line())).toBe('5r');
    expect(landingLineHoldPart(landingCardStateOf(line(), fail(503, { ok: false, error: 'landing-fenced', recovery: 'restart' })))).toBe('5rs');
    expect(landingLineHoldPart(line(paused(['operator'])))).toBe('5p');
    expect(landingLineHoldPart(line(paused(['operator'], { held: { reason: 'landing-recovery-unresolved', subjectIds: [1] } })))).toBe('5q');
    expect(landingLineHoldPart(line(view({}, { head: null, held: { reason: 'landing-recovery-unresolved', subjectIds: [1] } })))).toBe('5h');
    expect(landingLineHoldPart(line(view({ mainRedHold: true })))).toBe('5m');
    expect(landingLineHoldPart(line(view({}, { head: null })))).toBe('5n');
  });
});

describe('landingCardStateOf (D-9109, round 2)', () => {
  const fenced = fail(503, { ok: false, error: 'landing-fenced', recovery: 'restart' });
  const projection = fail(503, { ok: false, error: 'landing-projection-unreadable', recovery: 'repair' });
  it('a good answer is a line with no stale sentence; nothing to say is none', () => {
    const s = line();
    expect(s).toMatchObject({ kind: 'line', stale: null });
    expect(s.kind === 'line' && s.card.statusText).toBe('Next to land: #101.');
    expect(landingCardStateOf(s, ok({ project: P, operatorPaused: false, mainRedHold: false, entries: [], order: { paused: false, order: [], head: null } })))
      .toEqual({ kind: 'none' });
  });
  it('a box failure over a previous line keeps its view and card with the failure as stale', () => {
    const prev = line();
    const next = landingCardStateOf(prev, fenced);
    expect(next.kind).toBe('line');
    if (next.kind !== 'line' || prev.kind !== 'line') throw new Error('not a line');
    expect(next.view).toBe(prev.view);
    expect(next.card).toBe(prev.card);
    expect(next.stale).toEqual({ text: LANDING_ROUTE_WORDS['landing-fenced'].text, scope: 'box', outcomeUnknown: false });
    expect(STALE_PREFIX + next.stale!.text).toBe('Not read again: The landing line is stopped after an earlier failure. It reads and changes nothing until the server replays its journal or restarts.');
  });
  it('a box failure with no previous line is none', () => {
    expect(landingCardStateOf(undefined, fenced)).toEqual({ kind: 'none' });
    expect(landingCardStateOf({ kind: 'none' }, fenced)).toEqual({ kind: 'none' });
    expect(landingCardStateOf(undefined, { ok: false, err: new Error('offline') })).toEqual({ kind: 'none' });
  });
  it('landing-projection-unreadable: none with no previous line, and over a line keeps it with its sentence as stale (R2)', () => {
    expect(landingCardStateOf(undefined, projection)).toEqual({ kind: 'none' });
    const next = landingCardStateOf(line(), projection);
    expect(next.kind === 'line' && next.stale?.text).toBe(LANDING_ROUTE_WORDS['landing-projection-unreadable'].text);
  });
  it('not-configured over a previous line is none', () => {
    expect(landingCardStateOf(line(), fail(501, { ok: false, error: 'not-configured' }))).toEqual({ kind: 'none' });
  });
  it('an unreadable raw over a previous line keeps it with the unreadable-answer sentence', () => {
    const next = landingCardStateOf(line(), { ok: true, raw: { ok: true, project: P } });
    expect(next.kind === 'line' && next.stale).toEqual({ text: UNREADABLE_ANSWER_TEXT, scope: 'box', outcomeUnknown: false });
    expect(landingCardStateOf(undefined, { ok: true, raw: 'garbage' })).toEqual({ kind: 'none' });
  });
});
