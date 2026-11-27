// The test box status read's delivery standing (Desktop polish wave 184; option A, the capture owner's calls 1446 and 37541,
// the coordinator's 37537): the cut from the one view, its reader, and the decider that names the same build as the lane.
// Pure: no store, no route (the route's cases are in delivery-lane-capture.test.ts).
import { describe, expect, it } from 'vitest';
import { deliveryBuildViewOf, deliveryStandingAnswerOf, deliveryViewsOf, newestTrustedBuild, nextDeliveryJob } from '../../shared/deliveryLane.js';
import {
  DELIVERY_CASE_VERDICTS, DELIVERY_PART_COUNT, DELIVERY_WORD_MAP, deliveryJoinWord, deliveryParts, deliveryStandingOf, deliveryWord, deliveryWordFitsCounts,
  readDeliveryStandingAnswer, type DeliveryCaptureResult, type DeliveryCaseVerdict, type DeliveryStanding, type DeliveryWord,
} from '../../shared/deliveryResult.js';
import { attemptRow, deliveryResultFor, record, rowOf } from './deliveryLaneHelpers.js';

const AT = 10_000_000;
const B = '2.1.320';
const WORDS = Object.keys(DELIVERY_WORD_MAP) as DeliveryWord[];
const parts = Array.from({ length: DELIVERY_PART_COUNT }, (_, i) => i);
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** A result for `B`'s `part` whose first case is altered and whose divergence carries `received`, as a build that rewrote its
 *  turn would leave it (`received` is the build's own text). */
function withReceived(part: number, received: string): DeliveryCaptureResult {
  const r = deliveryResultFor(B, part, 'altered');
  return { ...r, cases: r.cases.map((c, i) => (i === 0 ? { ...c, divergence: { ...c.divergence!, received } } : c)) };
}

/** Every verdict list of length `k` over the recipe's verdicts. */
function* verdictLists(k: number): Generator<DeliveryCaseVerdict[]> {
  if (k === 0) { yield []; return; }
  for (const rest of verdictLists(k - 1)) for (const v of DELIVERY_CASE_VERDICTS) yield [...rest, v];
}

/** A standing holding only `part` measured with these values, the rest unmeasured, its word the join. */
function onePart(part: number, word: DeliveryWord, intact: number, notIntact: number): DeliveryStanding {
  return {
    build: B,
    word: deliveryJoinWord(parts.map((p) => (p === part ? word : null))),
    parts: [{ part, word, release: 'v0.0.1500', at: AT, intact, notIntact }],
    unmeasured: parts.filter((p) => p !== part).map((p) => ({ part: p, notSent: null, attempts: 0 })),
  };
}
const readsOne = (s: DeliveryStanding): boolean => readDeliveryStandingAnswer(wire({ kind: 'standing', standing: s })) !== null;

describe('the standing is cut from the one view, and carries nothing of a case', () => {
  it('a view whose divergence holds a build\'s text: none of it reaches the serialised standing, and the counts do', () => {
    const marker = 'BUILD-TEXT-MARKER /home/someone/capture';
    const rows = [rowOf(withReceived(0, marker)), rowOf(deliveryResultFor(B, 1)), attemptRow(B, 2, AT, { attempts: 2, notSent: 'recipe-not-run' })];
    const answer = deliveryStandingAnswerOf([record(B, 'pass')], rows);
    const text = JSON.stringify(answer);
    expect(JSON.stringify(deliveryViewsOf(rows))).toContain(marker);
    expect(text).not.toContain(marker);
    expect(text).not.toContain('abc');
    for (const id of deliveryParts()[0]!) expect(text).not.toContain(`"${id}"`);
    expect(answer).toEqual({ kind: 'standing', standing: {
      build: B, word: 'fault',
      parts: [
        { part: 0, word: 'fault', release: 'v0.0.1500', at: 5, intact: deliveryParts()[0]!.length - 1, notIntact: 1 },
        { part: 1, word: 'intact', release: 'v0.0.1500', at: 5, intact: deliveryParts()[1]!.length, notIntact: 0 },
      ],
      unmeasured: [{ part: 2, notSent: 'recipe-not-run', attempts: 2 }],
    } });
    expect(readDeliveryStandingAnswer(wire(answer))).toEqual(answer);
  });

  it('a closed key list: the cut writes exactly its keys, a key the view grows is not carried, and the reader refuses any other', () => {
    const view = deliveryBuildViewOf([rowOf(deliveryResultFor(B, 0)), attemptRow(B, 1, AT)], B);
    const grown = { ...view, extra: 1, parts: view.parts.map((p) => ({ ...p, extra: 1 })), unmeasured: view.unmeasured.map((u) => ({ ...u, extra: 1 })) };
    const s = deliveryStandingOf(grown as typeof view);
    expect(Object.keys(s).sort()).toEqual(['build', 'parts', 'unmeasured', 'word']);
    expect(Object.keys(s.parts[0]!).sort()).toEqual(['at', 'intact', 'notIntact', 'part', 'release', 'word']);
    for (const u of s.unmeasured) expect(Object.keys(u).sort()).toEqual(['attempts', 'notSent', 'part']);
    const answer = { kind: 'standing', standing: s };
    expect(readDeliveryStandingAnswer(wire(answer))).toEqual(answer);
    expect(readDeliveryStandingAnswer({ ...answer, extra: 1 })).toBeNull();
    expect(readDeliveryStandingAnswer({ kind: 'standing', standing: { ...s, extra: 1 } })).toBeNull();
    expect(readDeliveryStandingAnswer({ kind: 'standing', standing: { ...s, parts: [{ ...s.parts[0]!, cases: [] }] } })).toBeNull();
    expect(readDeliveryStandingAnswer({ kind: 'standing', standing: { ...s, parts: [{ ...s.parts[0]!, divergence: null }] } })).toBeNull();
    expect(readDeliveryStandingAnswer({ kind: 'standing', standing: { ...s, unmeasured: s.unmeasured.map((u) => ({ ...u, extra: 1 })) } })).toBeNull();
    const { release: _r, ...noRelease } = s.parts[0]!;
    expect(readDeliveryStandingAnswer({ kind: 'standing', standing: { ...s, parts: [noRelease] } })).toBeNull();
  });

  it('the reader keeps the view reader\'s checks: the build, the release, the time, every part once, the join', () => {
    const s = deliveryStandingOf(deliveryBuildViewOf([rowOf(deliveryResultFor(B, 0)), attemptRow(B, 1, AT)], B));
    const bad = (over: Partial<DeliveryStanding>): unknown => ({ kind: 'standing', standing: { ...s, ...over } });
    const part0 = (over: Record<string, unknown>): Partial<DeliveryStanding> => ({ parts: [{ ...s.parts[0]!, ...over } as never] });
    expect(readDeliveryStandingAnswer(bad({ build: 'latest' }))).toBeNull();
    expect(readDeliveryStandingAnswer(bad({ word: 'intact' }))).toBeNull();
    expect(readDeliveryStandingAnswer(bad({ unmeasured: s.unmeasured.slice(1) }))).toBeNull();
    expect(readDeliveryStandingAnswer(bad({ unmeasured: [{ part: 0, notSent: null, attempts: 0 }, ...s.unmeasured] }))).toBeNull();
    expect(readDeliveryStandingAnswer(bad(part0({ release: 'main' })))).toBeNull();
    expect(readDeliveryStandingAnswer(bad(part0({ at: -1 })))).toBeNull();
    expect(readDeliveryStandingAnswer(bad(part0({ at: Number.MAX_SAFE_INTEGER })))).not.toBeNull();
    expect(readDeliveryStandingAnswer(bad(part0({ release: null })))).not.toBeNull();
    expect(readDeliveryStandingAnswer(bad({ unmeasured: s.unmeasured.map((u) => ({ ...u, attempts: -1 })) }))).toBeNull();
    // the standing's unmeasured attempts, absent, read as unknown, as the view's do
    const older = bad({ unmeasured: s.unmeasured.map(({ part, notSent }) => ({ part, notSent })) as never });
    expect((readDeliveryStandingAnswer(older) as { standing: DeliveryStanding }).standing.unmeasured.every((u) => u.attempts === null)).toBe(true);
  });
});

describe('a part\'s word and counts are one the word\'s own function could give (the capture owner\'s 37541)', () => {
  it('over the whole small domain: every word against every count pair, and the sum against each part\'s case count', () => {
    for (const part of parts) {
      const k = deliveryParts()[part]!.length;
      // what the builder can produce: the word and counts of every verdict list a part of k cases can hold
      const produced = new Set<string>();
      for (const vs of verdictLists(k)) {
        const intact = vs.filter((v) => v === 'intact').length;
        produced.add(`${deliveryWord(vs)}/${intact}/${k - intact}`);
      }
      for (const word of WORDS) {
        for (let intact = 0; intact <= k + 1; intact++) {
          for (let notIntact = 0; notIntact <= k + 1; notIntact++) {
            const can = intact + notIntact === k && produced.has(`${word}/${intact}/${notIntact}`);
            expect(readsOne(onePart(part, word, intact, notIntact)), `part ${part} ${word} ${intact}/${notIntact}`).toBe(can);
          }
        }
      }
    }
  });
  it('refused never stands with every case intact: the function cannot give it, so the reader refuses it', () => {
    expect(deliveryWordFitsCounts('refused', 3, 0)).toBe(false);
    expect(readsOne(onePart(0, 'refused', deliveryParts()[0]!.length, 0))).toBe(false);
    expect(readsOne(onePart(0, 'intact', deliveryParts()[0]!.length - 1, 1))).toBe(false);
    expect(readsOne(onePart(0, 'fault', deliveryParts()[0]!.length, 0))).toBe(false);
  });
});

describe('the read and the lane name the same build', () => {
  it('for every order of a mixed record list, the standing names the build the next job is for, and neither names one with none passed', () => {
    const lists = [
      [record('2.1.330', 'fail'), record('2.1.320', 'pass'), record('2.1.99', 'pass'), record('2.1.302', 'pass'), record('2.1.340', 'queued')],
      [record('2.1.9', 'pass'), record('2.1.10', 'pass')],
      [record('3.0.0', 'pass'), record('2.99.999', 'pass'), record('latest', 'pass')],
    ];
    for (const list of lists) {
      for (const order of [list, [...list].reverse(), [...list.slice(1), list[0]!]]) {
        const job = nextDeliveryJob(order, [], AT);
        const answer = deliveryStandingAnswerOf(order, []);
        expect(answer.kind).toBe('standing');
        expect(answer.kind === 'standing' && answer.standing.build).toBe(job!.build);
        expect(newestTrustedBuild(order)).toBe(job!.build);
      }
    }
    expect(deliveryStandingAnswerOf([record('2.1.320', 'fail'), record('2.1.330', 'queued')], [])).toEqual({ kind: 'no-trusted-build' });
    expect(nextDeliveryJob([record('2.1.320', 'fail'), record('2.1.330', 'queued')], [], AT)).toBeNull();
  });
  it('a trusted build with no row yet stands with every part unmeasured, never asked', () => {
    expect(deliveryStandingAnswerOf([record(B, 'pass')], [rowOf(deliveryResultFor('2.1.310', 0))])).toEqual({ kind: 'standing', standing: {
      build: B, word: 'incomplete', parts: [], unmeasured: parts.map((p) => ({ part: p, notSent: null, attempts: 0 })),
    } });
  });
});

describe('the three answers stay apart, and an older server\'s reads as unknown', () => {
  it('each kind reads with exactly its own keys; absent is unknown; anything else is refused', () => {
    expect(readDeliveryStandingAnswer(undefined)).toEqual({ kind: 'unknown' });
    expect(readDeliveryStandingAnswer({ kind: 'no-trusted-build' })).toEqual({ kind: 'no-trusted-build' });
    expect(readDeliveryStandingAnswer({ kind: 'unreadable' })).toEqual({ kind: 'unreadable' });
    for (const bad of [null, 'standing', [], { kind: 'unknown' }, { kind: 'unreadable', detail: 'x' }, { kind: 'no-trusted-build', standing: null }, { kind: 'standing' }, { kind: 'standing', standing: null }]) {
      expect(readDeliveryStandingAnswer(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the standing\'s size (the status read\'s callers read at most 65536 bytes)', () => {
  it('its worst case, at 64-character names, is under 1 KiB: three parts at the largest counts and times, or three unmeasured at the largest tally', () => {
    const build = `2.1.${'9'.repeat(60)}`;
    const release = `v0.0.${'9'.repeat(59)}`;
    expect([build.length, release.length]).toEqual([64, 64]);
    const measured: DeliveryStanding = {
      build, word: 'fault',
      parts: parts.map((p) => ({ part: p, word: 'fault', release, at: Number.MAX_SAFE_INTEGER, intact: 0, notIntact: deliveryParts()[p]!.length })),
      unmeasured: [],
    };
    const unmeasured: DeliveryStanding = { build, word: 'incomplete', parts: [], unmeasured: parts.map((p) => ({ part: p, notSent: 'recipe-not-run', attempts: Number.MAX_SAFE_INTEGER })) };
    for (const s of [measured, unmeasured]) {
      const answer = { kind: 'standing', standing: s };
      expect(readDeliveryStandingAnswer(wire(answer))).toEqual(answer);
      expect(new TextEncoder().encode(JSON.stringify({ delivery: answer })).length).toBeLessThan(1024);
    }
  });
});
