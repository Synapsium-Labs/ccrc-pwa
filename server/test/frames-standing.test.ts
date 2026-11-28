// The box frames recipe's STANDING, the new-form alarm (Desktop polish wave 198; plan
// docs/superpowers/plans/2026-11-28-box-frames-alarm.md section 3). Pure: trust records and store rows in, the status read's
// `frames` out, and back through its one reader. No store, no route, no Claude Code.
import { describe, expect, it } from 'vitest';
import type { ClaudeBuildRecord } from '../../shared/claudeBuildTrust.js';
import { newestTrustedBuild } from '../../shared/deliveryLane.js';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { nextFramesJob } from '../../shared/framesLane.js';
import { FRAMES_PARTS, FRAMES_PART_COUNT, framesFrameId, type FramesCaptureResult, type FramesOutcome } from '../../shared/framesResult.js';
import { FRAME_SHAPE_VERSION, frameShape } from '../../shared/framesShape.js';
import {
  FRAMES_STANDING_OLDER, framesShapeToStore, framesStandingAnswerOf, framesStandingBuilds, framesStandingReadOf, readFramesStandingAnswer,
  type FramesShapeRow, type FramesStanding, type FramesStandingAnswer,
} from '../../shared/framesStanding.js';

const rec = (build: string, capture: ClaudeBuildRecord['capture'] = 'pass'): ClaudeBuildRecord => ({ build, capture } as unknown as ClaudeBuildRecord);
const RULE = '─'.repeat(40);
const FORM_A = [RULE, '❯ ', RULE, '  ccrc capture'].join('\n');
const FORM_B = ['──── ↑ 9 more ' + RULE, '  ', RULE, '  ccrc capture'].join('\n');
const ID = (p: number): string => framesFrameId(FRAMES_PARTS[p]!);
const ALL = FRAMES_PARTS.map((_, p) => p);

/** A current result for `build` and `part`, its frame drawn as `text` unless another outcome is named. */
function result(build: string, part: number, text: string = FORM_A, outcome: FramesOutcome = 'drawn'): FramesCaptureResult {
  const carried = outcome === 'drawn' || outcome === 'unsettled';
  const over = outcome === 'over-cap';
  return {
    recipe: 'frames', version: FRAMES_RECIPE_VERSION, build, part, case: FRAMES_PARTS[part]!.case, pane: FRAMES_PARTS[part]!.pane, release: null,
    unmeasured: [], word: outcome === 'drawn' ? 'framed' : 'gaps', sends: [], turns: 0, sideRequests: 0,
    frame: {
      outcome, refusal: outcome === 'refused' ? 'private-shape' : null, rows: over ? 999 : 4, width: 40, bytes: 100, cursor: null,
      replaced: carried ? { cwd: 0, path: 0, model: 0, account: 0 } : null, text: carried ? text : null,
    },
  };
}
/** The store's text-free row for a result, shaped as the lane would shape it (`framesShapeToStore`). */
function row(build: string, part: number, text: string = FORM_A, outcome: FramesOutcome = 'drawn', over: Partial<FramesShapeRow> = {}): FramesShapeRow {
  const r = result(build, part, text, outcome);
  const checked = over.checked ?? 'clear';
  return { build, part, version: r.version, word: r.word, record: { ...r, frame: { ...r.frame, text: null } }, checked, at: 7, shape: framesShapeToStore(r, checked === null ? 'clear' : checked), ...over };
}
const full = (build: string, text: string = FORM_A): FramesShapeRow[] => ALL.map((p) => row(build, p, text));
const standingOf = (a: FramesStandingAnswer): FramesStanding => { expect(a.kind).toBe('standing'); return (a as { standing: FramesStanding }).standing; };
/** The answer through JSON and the one reader: what a reader of the status read gets. */
const wire = (a: FramesStandingAnswer): unknown => readFramesStandingAnswer(JSON.parse(JSON.stringify(a)));

describe('whether to shape (plan 3.5): exactly a drawn frame with its text whose check was clear', () => {
  it('a drawn, cleared frame is shaped at this shape version, with the hash of the part\'s own shape', () => {
    const r = result('2.1.332', 0);
    expect(framesShapeToStore(r, 'clear')).toEqual({ version: FRAME_SHAPE_VERSION, hash: frameShape(FORM_A, null, ['ccrc frames: ok']).hash });
  });
  it('an unsettled, over-cap or refused frame, or one the server\'s check refused, is not', () => {
    for (const o of ['unsettled', 'over-cap', 'refused'] as const) expect(framesShapeToStore(result('2.1.332', 0, FORM_A, o), 'clear')).toBeNull();
    expect(framesShapeToStore(result('2.1.332', 0), 'private-name')).toBeNull();
    expect(framesShapeToStore(result('2.1.332', 0), 'masked')).toBeNull();
  });
});

describe('the builds the read is bounded to (the capture owner\'s change B)', () => {
  it('the newest trusted build, then the four newest trusted ones older than it, newest first', () => {
    const records = ['2.1.320', '2.1.321', '2.1.322', '2.1.323', '2.1.324', '2.1.325', '2.1.326'].map((b) => rec(b));
    expect(framesStandingBuilds(records)).toEqual(['2.1.326', '2.1.325', '2.1.324', '2.1.323', '2.1.322']);
    expect(FRAMES_STANDING_OLDER).toBe(4);
  });
  it('an untrusted build, a build off the grammar and fewer builds than the bound', () => {
    expect(framesStandingBuilds([rec('2.1.330'), rec('2.1.331', 'fail'), rec('nope'), rec('2.1.329')])).toEqual(['2.1.330', '2.1.329']);
    expect(framesStandingBuilds([rec('2.1.331', 'fail')])).toEqual([]);
    expect(framesStandingBuilds([])).toEqual([]);
  });
  it('the first is the build the lanes name, for every order of a mixed record list', () => {
    const base = [rec('2.1.330'), rec('2.1.333', 'fail'), rec('2.1.332'), rec('2.1.331', 'queued' as ClaudeBuildRecord['capture'])];
    for (let i = 0; i < base.length; i++) {
      const records = [...base.slice(i), ...base.slice(0, i)];
      expect(framesStandingBuilds(records)[0]).toBe(newestTrustedBuild(records));
      const a = framesStandingAnswerOf(records, []);
      expect(standingOf(a).build).toBe(nextFramesJob(records, [], 0)!.build);
    }
  });
});

describe('no trusted build, incomplete and first-form, cased as carefully as new-form (the coordinator\'s 40919)', () => {
  it('no record, only failed records, and frames rows of a build that is not trusted: no-trusted-build', () => {
    expect(framesStandingAnswerOf([], [])).toEqual({ kind: 'no-trusted-build' });
    expect(framesStandingAnswerOf([rec('2.1.332', 'fail')], full('2.1.332'))).toEqual({ kind: 'no-trusted-build' });
  });
  it('a trusted build with no row at all: incomplete, against null, every list empty', () => {
    expect(standingOf(framesStandingAnswerOf([rec('2.1.332')], []))).toEqual({
      build: '2.1.332', against: null, word: 'incomplete', differing: [], refusals: 'none', refused: [], overCap: [],
    });
  });
  it('rows that hold attempts only, and rows at another recipe version: incomplete', () => {
    const attempts = ALL.map((p): FramesShapeRow => ({ build: '2.1.332', part: p, version: null, word: null, record: null, checked: null, at: null, shape: null }));
    expect(standingOf(framesStandingAnswerOf([rec('2.1.332')], attempts)).word).toBe('incomplete');
    const older = full('2.1.332').map((r) => ({ ...r, version: '0123456789abcdef' }));
    expect(standingOf(framesStandingAnswerOf([rec('2.1.332')], older)).word).toBe('incomplete');
    expect(standingOf(framesStandingAnswerOf([rec('2.1.332')], full('2.1.332').slice(1))).word).toBe('incomplete');
  });
  it('a complete newest build with no older one: first-form, against null', () => {
    expect(standingOf(framesStandingAnswerOf([rec('2.1.332')], full('2.1.332')))).toMatchObject({ word: 'first-form', against: null, differing: [] });
  });
  it('a complete older build past the read\'s bound is not found: first-form, against null', () => {
    const builds = ['2.1.326', '2.1.327', '2.1.328', '2.1.329', '2.1.330', '2.1.331'];
    const records = builds.map((b) => rec(b));
    const rows = [...full('2.1.326', FORM_B), ...full('2.1.331')];
    expect(standingOf(framesStandingAnswerOf(records, rows))).toMatchObject({ build: '2.1.331', word: 'first-form', against: null });
  });
  it('an older complete build that compares nothing: not-compared, against names it (the coordinator\'s ruling 4)', () => {
    const records = [rec('2.1.331'), rec('2.1.332')];
    const otherVersion = full('2.1.331', FORM_B).map((r) => ({ ...r, shape: { version: '0123456789abcdef', hash: r.shape!.hash } }));
    expect(standingOf(framesStandingAnswerOf(records, [...otherVersion, ...full('2.1.332')]))).toMatchObject({ word: 'not-compared', against: '2.1.331' });
    const unshaped = full('2.1.331', FORM_B).map((r) => ({ ...r, shape: null }));
    expect(standingOf(framesStandingAnswerOf(records, [...unshaped, ...full('2.1.332')]))).toMatchObject({ word: 'not-compared', against: '2.1.331' });
    const allRefused = ALL.map((p) => row('2.1.332', p, FORM_A, 'refused'));
    const s = standingOf(framesStandingAnswerOf(records, [...full('2.1.331', FORM_B), ...allRefused]));
    expect(s).toMatchObject({ word: 'not-compared', against: '2.1.331', refusals: 'refused', differing: [] });
    expect(s.refused).toEqual(ALL.map(ID));
    const olderRefused = ALL.map((p) => row('2.1.331', p, FORM_B, 'over-cap'));
    expect(standingOf(framesStandingAnswerOf(records, [...olderRefused, ...full('2.1.332')]))).toMatchObject({ word: 'not-compared', against: '2.1.331', refusals: 'none' });
  });
});

describe('same-form and new-form (plan 3.2)', () => {
  const records = [rec('2.1.331'), rec('2.1.332')];
  it('every compared frame alike: same-form', () => {
    expect(standingOf(framesStandingAnswerOf(records, [...full('2.1.331'), ...full('2.1.332')]))).toEqual({
      build: '2.1.332', against: '2.1.331', word: 'same-form', differing: [], refusals: 'none', refused: [], overCap: [],
    });
  });
  it('one frame drawn otherwise: new-form, naming it', () => {
    const rows = [...full('2.1.331'), ...full('2.1.332').map((r) => (r.part === 10 ? row('2.1.332', 10, FORM_B) : r))];
    expect(standingOf(framesStandingAnswerOf(records, rows))).toMatchObject({ word: 'new-form', differing: [ID(10)] });
  });
  it('new-form wins over incomplete: the first differing part says so before the other 51', () => {
    const s = standingOf(framesStandingAnswerOf(records, [...full('2.1.331'), row('2.1.332', 0, FORM_B)]));
    expect(s).toMatchObject({ word: 'new-form', differing: [ID(0)], against: '2.1.331' });
    expect(standingOf(framesStandingAnswerOf(records, [...full('2.1.331'), row('2.1.332', 0)])).word).toBe('incomplete');
  });
  it('against is the newest COMPLETE older build: an incomplete one between is passed over', () => {
    const three = [rec('2.1.330'), ...records];
    const rows = [...full('2.1.330', FORM_B), ...full('2.1.331').slice(3), ...full('2.1.332')];
    expect(standingOf(framesStandingAnswerOf(three, rows))).toMatchObject({ against: '2.1.330', word: 'new-form', differing: ALL.map(ID) });
  });
  it('a frame refused, over the cap, unsettled or unshaped on either side is not compared', () => {
    const newest = full('2.1.332', FORM_B).map((r) => (r.part < 4 ? r : row('2.1.332', r.part)));
    newest[0] = row('2.1.332', 0, FORM_B, 'refused');
    newest[1] = row('2.1.332', 1, FORM_B, 'over-cap');
    newest[2] = row('2.1.332', 2, FORM_B, 'unsettled');
    newest[3] = { ...row('2.1.332', 3, FORM_B), shape: null };
    expect(standingOf(framesStandingAnswerOf(records, [...full('2.1.331'), ...newest]))).toMatchObject({ word: 'same-form', differing: [] });
  });
  it('the standing over a table of many builds equals the standing over the bounded rows', () => {
    const builds = Array.from({ length: 12 }, (_, i) => `2.1.${320 + i}`);
    const many = builds.flatMap((b, i) => full(b, i % 2 === 0 ? FORM_A : FORM_B));
    const bounded = framesStandingBuilds(builds.map((b) => rec(b)));
    const only = many.filter((r) => bounded.includes(r.build));
    expect(framesStandingAnswerOf(builds.map((b) => rec(b)), many)).toEqual(framesStandingAnswerOf(builds.map((b) => rec(b)), only));
    expect(only.length).toBe((1 + FRAMES_STANDING_OLDER) * FRAMES_PART_COUNT);
  });
});

describe('the refusals word (plan 3.3, the coordinator\'s addition)', () => {
  const records = [rec('2.1.332')];
  const with_ = (over: Record<number, FramesShapeRow>): FramesShapeRow[] => full('2.1.332').map((r) => over[r.part] ?? r);
  it('none, refused, over-cap, both; a refusal by the server\'s check counts as refused; unsettled is in neither', () => {
    expect(standingOf(framesStandingAnswerOf(records, with_({ 5: row('2.1.332', 5, FORM_A, 'unsettled') })))).toMatchObject({ refusals: 'none', refused: [], overCap: [] });
    expect(standingOf(framesStandingAnswerOf(records, with_({ 5: row('2.1.332', 5, FORM_A, 'refused') })))).toMatchObject({ refusals: 'refused', refused: [ID(5)] });
    expect(standingOf(framesStandingAnswerOf(records, with_({ 6: row('2.1.332', 6, FORM_A, 'over-cap') })))).toMatchObject({ refusals: 'over-cap', overCap: [ID(6)] });
    expect(standingOf(framesStandingAnswerOf(records, with_({ 5: row('2.1.332', 5, FORM_A, 'refused'), 6: row('2.1.332', 6, FORM_A, 'over-cap') }))))
      .toMatchObject({ refusals: 'refused-and-over-cap', refused: [ID(5)], overCap: [ID(6)] });
    expect(standingOf(framesStandingAnswerOf(records, with_({ 7: row('2.1.332', 7, FORM_A, 'drawn', { checked: 'masked' }) })))).toMatchObject({ refusals: 'refused', refused: [ID(7)] });
  });
  it('only the newest build\'s current parts count: an older build\'s refusals and a stale row are not news', () => {
    const two = [rec('2.1.331'), rec('2.1.332')];
    const older = full('2.1.331').map((r) => (r.part === 3 ? row('2.1.331', 3, FORM_A, 'refused') : r));
    const stale = { ...row('2.1.332', 4, FORM_A, 'refused'), version: '0123456789abcdef' };
    expect(standingOf(framesStandingAnswerOf(two, [...older, ...full('2.1.332').map((r) => (r.part === 4 ? stale : r))]))).toMatchObject({ refusals: 'none' });
  });
});

describe('only fixed words, build names and frame ids leave the server (plan 3.4)', () => {
  it('a frame whose text holds a marker, in a rule label and in a row of our text: the marker, the tokens and the hashes reach no answer', () => {
    const MARK = 'QMARKQ';
    const marked = [`${RULE} ${MARK} 12`, `❯ ${MARK} ccrc frames: ok`, RULE, '  ccrc capture'].join('\n');
    const rows = [...full('2.1.331'), ...full('2.1.332').map((r) => (r.part === 0 ? row('2.1.332', 0, marked) : r))];
    const a = framesStandingAnswerOf([rec('2.1.331'), rec('2.1.332')], rows);
    const s = JSON.stringify(a);
    expect(standingOf(a).word).toBe('new-form');
    expect(s).not.toContain(MARK);
    for (const r of rows) expect(s).not.toContain(r.shape!.hash);
    for (const t of frameShape(marked, null, []).tokens) if (t.length > 3) expect(s).not.toContain(t);
  });
  it('the worst case, at 64-digit build names and every frame listed, is under 4 KiB', () => {
    const big = (n: number): string => `2.1.${String(n).padStart(64, '9')}`;
    const worst: FramesStanding[] = [
      { build: big(2), against: big(1), word: 'new-form', differing: ALL.map(ID), refusals: 'none', refused: [], overCap: [] },
      { build: big(2), against: big(1), word: 'not-compared', differing: [], refusals: 'refused-and-over-cap', refused: ALL.slice(0, 26).map(ID), overCap: ALL.slice(26).map(ID) },
    ];
    for (const standing of worst) {
      const a: FramesStandingAnswer = { kind: 'standing', standing };
      expect(wire(a)).toEqual(a);
      expect(new TextEncoder().encode(JSON.stringify(a)).length).toBeLessThan(4096);
    }
  });
});

describe('the recipe\'s hold (packet 4): held is answered before either store read is made (the capture owner\'s condition 1)', () => {
  it('held: neither read is asked, so a held recipe never answers unreadable; up: the standing over what the reads give', () => {
    let asked = 0;
    const throwing = { records: () => { asked++; throw new Error('disk'); }, rows: () => { asked++; throw new Error('disk'); } };
    expect(framesStandingReadOf(throwing, false)).toEqual({ kind: 'held' });
    expect(asked).toBe(0);
    expect(() => framesStandingReadOf(throwing, true)).toThrow('disk');
    const asks: string[][] = [];
    const records = [rec('2.1.331'), rec('2.1.332')];
    const a = framesStandingReadOf({ records: () => records, rows: (b) => { asks.push([...b]); return [...full('2.1.331'), ...full('2.1.332')]; } }, true);
    expect(a).toEqual(framesStandingAnswerOf(records, [...full('2.1.331'), ...full('2.1.332')]));
    expect(asks).toEqual([framesStandingBuilds(records)]);
    expect(framesStandingReadOf({ records: () => records, rows: () => [] })).toEqual(framesStandingAnswerOf(records, []));
  });
});

describe('the one reader (plan 3.4): each kind with exactly its keys, the standing with the delivery standing\'s checks', () => {
  const good: FramesStanding = { build: '2.1.332', against: '2.1.331', word: 'new-form', differing: [ID(3)], refusals: 'refused', refused: [ID(4)], overCap: [] };
  const read = (s: unknown): unknown => readFramesStandingAnswer({ kind: 'standing', standing: s });
  it('absent is unknown; the two plain kinds read with exactly their key; anything else is refused', () => {
    expect(readFramesStandingAnswer(undefined)).toEqual({ kind: 'unknown' });
    expect(readFramesStandingAnswer({ kind: 'no-trusted-build' })).toEqual({ kind: 'no-trusted-build' });
    expect(readFramesStandingAnswer({ kind: 'unreadable' })).toEqual({ kind: 'unreadable' });
    expect(readFramesStandingAnswer({ kind: 'held' })).toEqual({ kind: 'held' });
    for (const bad of [null, 'standing', [], { kind: 'unknown' }, { kind: 'unreadable', why: 'x' }, { kind: 'held', standing: good }, { kind: 'standing' }, { kind: 'standing', standing: good, x: 1 }]) {
      expect(readFramesStandingAnswer(bad)).toBeNull();
    }
  });
  it('a good standing reads; every answer the decider gives in these cases reads back as itself', () => {
    expect(read(good)).toEqual({ kind: 'standing', standing: good });
    const answers = [
      framesStandingAnswerOf([rec('2.1.332')], []), framesStandingAnswerOf([rec('2.1.332')], full('2.1.332')),
      framesStandingAnswerOf([rec('2.1.331'), rec('2.1.332')], [...full('2.1.331'), ...full('2.1.332')]),
      framesStandingAnswerOf([rec('2.1.331'), rec('2.1.332')], [...full('2.1.331'), ...full('2.1.332', FORM_B)]),
    ];
    for (const a of answers) expect(wire(a)).toEqual(a);
  });
  it('refuses a standing whose keys, builds, words or lists are wrong, or that disagrees with itself', () => {
    const bad: unknown[] = [
      { ...good, extra: 1 }, (({ refused: _r, ...rest }) => rest)(good),
      { ...good, build: 'nope' }, { ...good, against: '2.1.332' }, { ...good, against: '2.1.333' }, { ...good, against: 'x' },
      { ...good, word: 'fine' }, { ...good, refusals: 'some' },
      { ...good, differing: [] }, { ...good, word: 'same-form' }, { ...good, word: 'first-form', differing: [ID(3)] },
      { ...good, against: null }, { ...good, against: null, word: 'same-form', differing: [] },
      { ...good, refusals: 'none' }, { ...good, overCap: [ID(5)] },
      { ...good, differing: [ID(4)] }, { ...good, differing: [ID(3), ID(3)] }, { ...good, differing: [ID(5), ID(3)] },
      { ...good, differing: ['rows-3@1x1'] }, { ...good, differing: 'x' }, { ...good, refused: [ID(3)] },
      { ...good, differing: Array.from({ length: FRAMES_PART_COUNT + 1 }, (_, i) => ID(i % FRAMES_PART_COUNT)) },
    ];
    for (const b of bad) expect(read(b)).toBeNull();
  });
  it('incomplete stands with or without an against build; first-form only without; same-form and not-compared only with', () => {
    const ok = (word: string, against: string | null): boolean => read({ ...good, word, against, differing: [] }) !== null;
    expect([ok('incomplete', null), ok('incomplete', '2.1.331')]).toEqual([true, true]);
    expect([ok('first-form', null), ok('first-form', '2.1.331')]).toEqual([true, false]);
    expect([ok('same-form', null), ok('same-form', '2.1.331')]).toEqual([false, true]);
    expect([ok('not-compared', null), ok('not-compared', '2.1.331')]).toEqual([false, true]);
  });
  it('the five form words over the decider\'s table: each row of plan 3.2 gives its own word', () => {
    const two = [rec('2.1.331'), rec('2.1.332')];
    const words = [
      framesStandingAnswerOf(two, [...full('2.1.331'), ...full('2.1.332', FORM_B)]),
      framesStandingAnswerOf(two, [...full('2.1.331'), ...full('2.1.332').slice(1)]),
      framesStandingAnswerOf([rec('2.1.332')], full('2.1.332')),
      framesStandingAnswerOf(two, [...full('2.1.331').map((r) => ({ ...r, shape: null })), ...full('2.1.332')]),
      framesStandingAnswerOf(two, [...full('2.1.331'), ...full('2.1.332')]),
    ].map((a) => standingOf(a).word);
    expect(words).toEqual(['new-form', 'incomplete', 'first-form', 'not-compared', 'same-form']);
  });
});
