// The delivery recipe's lane decider (Desktop polish wave 178; `shared/deliveryLane.ts`): which (build, part) is sent next, the
// join of a build's parts, and the list the build list carries. Pure: no store, no transport.
import { describe, expect, it } from 'vitest';
import { BUILD_CAPTURE_RETRY_MS } from '../../shared/claudeBuildTrust.js';
import { deliveryBuildViewOf, deliveryWordOf, deliveryViewsOf, isCurrentDelivery, nextDeliveryJob } from '../../shared/deliveryLane.js';
import { DELIVERY_PART_COUNT, DELIVERY_VIEW_BUILDS_MAX, readDeliveryViews, type DeliveryBuildView } from '../../shared/deliveryResult.js';
import { attemptRow, deliveryResultFor, record, rowOf } from './deliveryLaneHelpers.js';

const AT = 10_000_000;
const parts = Array.from({ length: DELIVERY_PART_COUNT }, (_, i) => i);
const done = (build: string, upTo: number) => parts.filter((p) => p < upTo).map((p) => rowOf(deliveryResultFor(build, p)));

describe('nextDeliveryJob', () => {
  it('a queued build does not hold delivery back: the newest passed build is named beside it, due or not (call 1145 point 2b)', () => {
    const notDue = [record('2.1.320', 'pass'), record('2.1.310', 'queued', { lastAttemptAt: AT - 1 })];
    expect(nextDeliveryJob(notDue, [], AT)).toEqual({ build: '2.1.320', part: 0 });
    const due = [record('2.1.320', 'pass'), record('2.1.330', 'queued', { lastAttemptAt: null })];
    expect(nextDeliveryJob(due, [], AT)).toEqual({ build: '2.1.320', part: 0 });
  });
  it('the newest passed build only: an older passed build is never back-filled, and a failed one never named', () => {
    const records = [record('2.1.330', 'fail'), record('2.1.320', 'pass'), record('2.1.310', 'pass')];
    expect(nextDeliveryJob(records, [], AT)).toEqual({ build: '2.1.320', part: 0 });
    // the newest build is complete: nothing is sent for the older one
    expect(nextDeliveryJob(records, done('2.1.320', DELIVERY_PART_COUNT), AT)).toBeNull();
  });
  it('none when no build has passed', () => { expect(nextDeliveryJob([record('2.1.320', 'fail')], [], AT)).toBeNull(); });
  it('its first part with no current row, in index order', () => {
    const records = [record('2.1.320', 'pass')];
    for (let upTo = 0; upTo < DELIVERY_PART_COUNT; upTo++) {
      expect(nextDeliveryJob(records, done('2.1.320', upTo), AT)).toEqual({ build: '2.1.320', part: upTo });
    }
  });
  it('a part whose last try is within the spacing waits, and the lane never skips ahead to a later part', () => {
    const records = [record('2.1.320', 'pass')];
    const rows = [attemptRow('2.1.320', 0, AT - BUILD_CAPTURE_RETRY_MS + 1)];
    expect(nextDeliveryJob(records, rows, AT)).toBeNull();
    expect(nextDeliveryJob(records, [attemptRow('2.1.320', 0, AT - BUILD_CAPTURE_RETRY_MS)], AT)).toEqual({ build: '2.1.320', part: 0 });
  });
  it('another version\'s row counts as missing, and its spacing still holds', () => {
    const records = [record('2.1.320', 'pass')];
    const old = rowOf(deliveryResultFor('2.1.320', 0, 'intact', '0123456789abcdef'), { lastAttemptAt: AT - 1 });
    expect(nextDeliveryJob(records, [old], AT)).toBeNull();
    expect(nextDeliveryJob(records, [{ ...old, lastAttemptAt: AT - BUILD_CAPTURE_RETRY_MS }], AT)).toEqual({ build: '2.1.320', part: 0 });
  });
  it('a row with no word counts as missing', () => {
    const r = rowOf(deliveryResultFor('2.1.320', 0), { word: null, lastAttemptAt: null });
    expect(nextDeliveryJob([record('2.1.320', 'pass')], [r], AT)).toEqual({ build: '2.1.320', part: 0 });
  });
});

describe('deliveryWordOf: the join', () => {
  const b = '2.1.320';
  const all = (first: 'intact' | 'refused' | 'altered', rest: 'intact' | 'refused' | 'altered' = 'intact') =>
    parts.map((p) => rowOf(deliveryResultFor(b, p, p === 0 ? first : rest)));
  it('no row is incomplete', () => { expect(deliveryWordOf([], b)).toBe('incomplete'); });
  it('every part intact is intact', () => { expect(deliveryWordOf(all('intact'), b)).toBe('intact'); });
  it('any refused part, the rest intact, is refused', () => { expect(deliveryWordOf(all('refused'), b)).toBe('refused'); });
  it('any fault part is fault', () => { expect(deliveryWordOf(all('altered'), b)).toBe('fault'); });
  it('a missing part is incomplete, never intact', () => { expect(deliveryWordOf(all('intact').slice(1), b)).toBe('incomplete'); });
  it('a fault dominates a missing part and a refused one', () => {
    expect(deliveryWordOf([all('altered')[0]!], b)).toBe('fault');
    expect(deliveryWordOf(all('refused', 'altered'), b)).toBe('fault');
  });
  it('a missing part dominates refused', () => { expect(deliveryWordOf(all('refused').slice(0, 1), b)).toBe('incomplete'); });
  it('another version\'s row counts as missing, even a fault', () => {
    const old = rowOf(deliveryResultFor(b, 0, 'altered', '0123456789abcdef'));
    expect(deliveryWordOf([old, ...all('intact').slice(1)], b)).toBe('incomplete');
  });
  it('another build\'s rows do not count', () => { expect(deliveryWordOf(done('2.1.319', DELIVERY_PART_COUNT), b)).toBe('incomplete'); });
});

describe('deliveryViewsOf and its reader', () => {
  it('one entry for each build with any row, newest first, its parts by index; the reader accepts it exactly', () => {
    const rows = [...done('2.1.310', 1), attemptRow('2.1.320', 0, 3), ...done('2.1.320', 0).slice(0)];
    const views = deliveryViewsOf(rows);
    expect(views.map((v) => `${v.build}:${v.word}:${v.parts.length}`)).toEqual(['2.1.320:incomplete:0', '2.1.310:incomplete:1']);
    expect(readDeliveryViews(JSON.parse(JSON.stringify(views)))).toEqual(views);
  });
  // THE LANE'S OWN CLOCK (review 3898 F1): the lane stores `at` as a millisecond clock reading, so the reader takes any
  // non-negative safe integer there, never the count bound, or it would refuse every true view.
  it('views built from rows with a real millisecond `at` are read back exactly', () => {
    const now = Date.UTC(2026, 10, 26, 9, 0, 0);
    const rows = done('2.1.320', DELIVERY_PART_COUNT).map((r) => ({ ...r, at: now, lastAttemptAt: now }));
    const views = deliveryViewsOf(rows);
    expect(views[0]!.parts.map((p) => p.at)).toEqual(rows.map(() => now));
    expect(readDeliveryViews(JSON.parse(JSON.stringify(views)))).toEqual(views);
    expect(readDeliveryViews(JSON.parse(JSON.stringify([{ ...views[0]!, parts: views[0]!.parts.map((p) => ({ ...p, at: Number.MAX_SAFE_INTEGER })) }])))).not.toBeNull();
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '5', null]) {
      expect(readDeliveryViews([{ ...views[0]!, parts: views[0]!.parts.map((p, i) => (i === 0 ? { ...p, at: bad } : p)) }]), String(bad)).toBeNull();
    }
  });
  it('each part with no current result is listed with its last not-sent word, or null', () => {
    const rows = [attemptRow('2.1.320', 0, 3, { notSent: 'recipe-not-run' }), attemptRow('2.1.320', 1, 3, { notSent: 'no-test-box' }), ...done('2.1.320', DELIVERY_PART_COUNT).slice(2)];
    const [v] = deliveryViewsOf(rows);
    expect(v!.unmeasured.slice(0, 2)).toEqual([{ part: 0, notSent: 'recipe-not-run', attempts: 1 }, { part: 1, notSent: 'no-test-box', attempts: 1 }]);
    expect(deliveryViewsOf([attemptRow('2.1.320', 0, 3)])[0]!.unmeasured[0]).toEqual({ part: 0, notSent: null, attempts: 1 });
    expect(readDeliveryViews(JSON.parse(JSON.stringify([v])))).toEqual([v]);
    expect(readDeliveryViews([{ ...v, unmeasured: [{ part: 0, notSent: 'copied' }] }])).toBeNull();
  });
  it('the reader permits absence, and refuses a list off its shape', () => {
    expect(readDeliveryViews(undefined)).toEqual([]);
    expect(readDeliveryViews('x')).toBeNull();
    const [v] = deliveryViewsOf(done('2.1.320', 1));
    expect(readDeliveryViews([{ ...v, extra: 1 }])).toBeNull();
    expect(readDeliveryViews([{ ...v, word: 'maybe' }])).toBeNull();
    expect(readDeliveryViews([v, v])).toBeNull();
  });
  it('the reader refuses a view at odds with itself: a part listed twice or not at all, or a word that is not the join of the list (call 1253)', () => {
    const [v] = deliveryViewsOf(done('2.1.320', 1));
    expect(v!.unmeasured.length).toBeGreaterThan(0);
    // a part both measured and unmeasured
    expect(readDeliveryViews([{ ...v, unmeasured: [{ part: 0, notSent: null }, ...v!.unmeasured] }])).toBeNull();
    // a part neither
    expect(readDeliveryViews([{ ...v, unmeasured: v!.unmeasured.slice(1) }])).toBeNull();
    // `intact` or `refused` beside an unmeasured part
    expect(readDeliveryViews([{ ...v, word: 'intact' }])).toBeNull();
    expect(readDeliveryViews([{ ...v, word: 'refused' }])).toBeNull();
    // `fault` with no faulted part, and `incomplete` with every part measured
    expect(readDeliveryViews([{ ...v, word: 'fault' }])).toBeNull();
    const [all] = deliveryViewsOf(done('2.1.320', DELIVERY_PART_COUNT));
    expect(all!.word).toBe('intact');
    expect(readDeliveryViews([{ ...all, word: 'incomplete' }])).toBeNull();
  });
});

describe('the reader\'s checks of a part view (review 3882 A5)', () => {
  const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const full = (): DeliveryBuildView => wire(deliveryViewsOf(done('2.1.320', DELIVERY_PART_COUNT))[0]!);
  const ALTERED = { verdict: 'altered', receivedChars: [9], divergence: { turn: 0, index: 3, expected: 'abc', received: 'abd' } };
  it('the unaltered view is read whole', () => {
    expect(readDeliveryViews([full()])).toEqual([full()]);
  });
  it('a part whose word is not its cases\' word is refused: an intact part beside an altered case', () => {
    const v = full();
    Object.assign(v.parts[0]!.cases[0]!, ALTERED);
    expect(v.parts[0]!.word).toBe('intact');
    expect(v.word).toBe('intact');
    expect(readDeliveryViews([v])).toBeNull();
    // the same case with the part's word and the build's word following it is read
    const ok = full();
    Object.assign(ok.parts[0]!.cases[0]!, ALTERED);
    Object.assign(ok.parts[0]!, { word: 'fault' });
    Object.assign(ok, { word: 'fault' });
    expect(readDeliveryViews([ok])).not.toBeNull();
  });
  it('a case verdict its counts cannot give is refused: intact with two received turns, false-confirmation with one', () => {
    const twoTurns = full();
    Object.assign(twoTurns.parts[0]!.cases[0]!, { receivedChars: [10, 10] });
    expect(readDeliveryViews([twoTurns])).toBeNull();
    const oneTurn = full();
    Object.assign(oneTurn.parts[0]!.cases[0]!, { verdict: 'false-confirmation' });
    Object.assign(oneTurn.parts[0]!, { word: 'fault' });
    Object.assign(oneTurn, { word: 'fault' });
    expect(readDeliveryViews([oneTurn])).toBeNull();
  });
  it('a divergence on an intact case, or none on an altered one, is refused', () => {
    const a = full();
    Object.assign(a.parts[0]!.cases[0]!, { divergence: ALTERED.divergence });
    expect(readDeliveryViews([a])).toBeNull();
    const b = full();
    Object.assign(b.parts[0]!.cases[0]!, { verdict: 'altered' });
    Object.assign(b.parts[0]!, { word: 'fault' });
    Object.assign(b, { word: 'fault' });
    expect(readDeliveryViews([b])).toBeNull();
  });
  it('cases repeated, or out of order, are refused', () => {
    const rep = full();
    (rep.parts[0]!.cases as unknown[])[1] = rep.parts[0]!.cases[0];
    expect(readDeliveryViews([rep])).toBeNull();
    const swapped = full();
    const c = swapped.parts[0]!.cases as unknown[];
    [c[0], c[1]] = [c[1], c[0]];
    expect(readDeliveryViews([swapped])).toBeNull();
  });
  it('a part with no cases, or a case the recipe does not have, is refused', () => {
    const none = full();
    Object.assign(none.parts[0]!, { cases: [] });
    expect(readDeliveryViews([none])).toBeNull();
    const unknown = full();
    Object.assign(unknown.parts[0]!.cases[0]!, { id: 'c9' });
    expect(readDeliveryViews([unknown])).toBeNull();
  });
  it('more than the bound\'s builds is refused, and exactly the bound is read', () => {
    const build = (n: number): DeliveryBuildView => ({ ...full(), build: `2.1.${n}` });
    const atBound = Array.from({ length: DELIVERY_VIEW_BUILDS_MAX }, (_, i) => build(1000 - i));
    expect(readDeliveryViews(atBound)).toHaveLength(DELIVERY_VIEW_BUILDS_MAX);
    expect(readDeliveryViews([...atBound, build(1)])).toBeNull();
  });
  it('a part view\'s release: absent reads null, a tag as given, a non-tag refused', () => {
    const v = full();
    expect(v.parts[0]!.release).toBe('v0.0.1500');
    const absent = full();
    delete (absent.parts[0] as { release?: unknown }).release;
    expect(readDeliveryViews([absent])![0]!.parts[0]!.release).toBeNull();
    for (const bad of ['main', 'v1', 7]) {
      const w = full();
      Object.assign(w.parts[0]!, { release: bad });
      expect(readDeliveryViews([w]), String(bad)).toBeNull();
    }
    const nul = full();
    Object.assign(nul.parts[0]!, { release: null });
    expect(readDeliveryViews([nul])![0]!.parts[0]!.release).toBeNull();
  });
});

describe('deliveryViewsOf carries each part\'s release and cuts to the newest builds (review 3882 A5, F5)', () => {
  it('each part view carries the release of the box that ran it, and null where it was unknown', () => {
    const rows = [rowOf(deliveryResultFor('2.1.320', 0, 'intact', undefined, 'v0.0.1500')), rowOf(deliveryResultFor('2.1.320', 1, 'intact', undefined, null))];
    const [v] = deliveryViewsOf(rows);
    expect(v!.parts.map((p) => [p.part, p.release])).toEqual([[0, 'v0.0.1500'], [1, null]]);
    expect(readDeliveryViews(JSON.parse(JSON.stringify([v])))).toEqual([v]);
  });
  it('65 builds in, 64 out, the oldest dropped, and the reader reads the lane\'s own view', () => {
    const rows = Array.from({ length: DELIVERY_VIEW_BUILDS_MAX + 1 }, (_, i) => attemptRow(`2.1.${1000 + i}`, 0, 3));
    const views = deliveryViewsOf(rows);
    expect(views).toHaveLength(DELIVERY_VIEW_BUILDS_MAX);
    expect(views[0]!.build).toBe(`2.1.${1000 + DELIVERY_VIEW_BUILDS_MAX}`);
    expect(views.map((v) => v.build)).not.toContain('2.1.1000');
    expect(readDeliveryViews(JSON.parse(JSON.stringify(views)))).toEqual(views);
  });
});

describe('isCurrentDelivery', () => {
  it('a row with a word but no result or no time is no current result: the join, the next job and the view treat it as missing', () => {
    const records = [record('2.1.320', 'pass')];
    for (const over of [{ result: null }, { at: null }, { word: null }, { version: '0123456789abcdef' }]) {
      const rows = [rowOf(deliveryResultFor('2.1.320', 0), { ...over, lastAttemptAt: AT - BUILD_CAPTURE_RETRY_MS })];
      expect(isCurrentDelivery(rows[0]!), JSON.stringify(over)).toBe(false);
      expect(deliveryWordOf(rows, '2.1.320')).toBe('incomplete');
      expect(nextDeliveryJob(records, rows, AT)).toEqual({ build: '2.1.320', part: 0 });
      expect(deliveryViewsOf(rows)[0]!.unmeasured[0]).toMatchObject({ part: 0 });
    }
    expect(isCurrentDelivery(rowOf(deliveryResultFor('2.1.320', 0)))).toBe(true);
  });
});

// Proposal 1 of wave 184 (review 3898 F4; the capture owner's call 1444, the coordinator's 37528): each unmeasured part carries
// how many delivery jobs went out for it, so a part a box faults on again and again is told from a part never asked. The count
// is all time for the (build, part) row; the read says how many times, never when.
describe('an unmeasured part\'s attempts (wave 184 proposal 1)', () => {
  const b = '2.1.320';
  it('a part never asked carries 0, written by the view, not left out', () => {
    expect(deliveryBuildViewOf([], b).unmeasured).toEqual(parts.map((p) => ({ part: p, notSent: null, attempts: 0 })));
    const [v] = deliveryViewsOf(done(b, 1));
    expect(v!.unmeasured.every((u) => u.attempts === 0)).toBe(true);
  });
  it('a part the box faulted on three times carries 3: the view never writes 0 for a count above 0', () => {
    const [v] = deliveryViewsOf([attemptRow(b, 0, AT, { attempts: 3 })]);
    expect(v!.unmeasured[0]).toEqual({ part: 0, notSent: null, attempts: 3 });
    expect(readDeliveryViews(JSON.parse(JSON.stringify([v])))![0]!.unmeasured[0]!.attempts).toBe(3);
  });
  it('a part faulted on, then measured, leaves the unmeasured list', () => {
    const [v] = deliveryViewsOf([rowOf(deliveryResultFor(b, 0), { attempts: 4 })]);
    expect(v!.unmeasured.map((u) => u.part)).not.toContain(0);
    expect(v!.parts.map((p) => p.part)).toEqual([0]);
  });
  it('absent, an older server\'s view, reads as unknown (null), never 0; a count off its shape is refused', () => {
    const [v] = deliveryViewsOf([attemptRow(b, 0, AT, { attempts: 2 })]);
    const older = JSON.parse(JSON.stringify([{ ...v!, unmeasured: v!.unmeasured.map(({ part, notSent }) => ({ part, notSent })) }]));
    expect(readDeliveryViews(older)![0]!.unmeasured.map((u) => u.attempts)).toEqual(parts.map(() => null));
    expect(readDeliveryViews([{ ...v!, unmeasured: v!.unmeasured.map((u, i) => (i === 0 ? { ...u, attempts: Number.MAX_SAFE_INTEGER } : u)) }])).not.toBeNull();
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
      expect(readDeliveryViews([{ ...v!, unmeasured: v!.unmeasured.map((u, i) => (i === 0 ? { ...u, attempts: bad } : u)) }]), String(bad)).toBeNull();
    }
  });
});
