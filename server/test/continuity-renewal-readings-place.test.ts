// Overlord W1, the renewal readings, PR G (plan `w1-renewal-readings.md`, Task 10, question 7, slug place-hidden-is-a-mark): the
// place hidden. The soft `placeHiddenObservedMs` of the Overlord's generation is the `@overlord-place` mark's observed quiet (the
// mark the console's visible place refreshes, home B's `placeMarkReport.ts`), read by the lane through `placeHiddenOf` from the
// same one read of the marks it gives the operator's quiet, after the pass aged them. A real coord.db, fixture HOMEs and the fake
// time ports; the visible report is home B's own reporter over the real store's mark reader and writer.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { generationsPass, type GenReadings, type GenerationsDeps, type RegistryFacts } from '../src/continuity/generationsLane.js';
import * as readings from '../src/continuity/renewalReadings.js';
import { placeHiddenOf } from '../src/continuity/renewalReadings.js';
import { placeMarkReporter } from '../src/continuity/placeMarkReport.js';
import { softRenewalMay, type SoftInputs } from '../src/continuity/softRenewal.js';
import type { FleetRole } from '../../shared/fleetRoles.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import {
  BREAK_NO_MESSAGE_MS, BREAK_PLACE_HIDDEN_MS, LEAST_AGE_MS, OPERATOR_MARK_MS, OVERLORD_PLACE_MARK, RENEWAL_LANE_PERIOD_MS,
} from '../../shared/continuity.js';
import { OVERLORD_OPERATOR_MARK } from '../../shared/operatorMessages.js';
import { placeHiddenCases } from './sim/renewalPlaceReadingSets.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const OVERLORD = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const MIN = 60_000;

describe('placeHiddenOf: the place mark\'s quiet as the soft reading (PR G, Task 10)', () => {
  for (const [name, fn] of Object.entries(placeHiddenCases(readings))) it(name, fn);
});

// ── The lane ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface LaneFx {
  s: CoordStore; t: ReturnType<typeof fakeTime>; soft: SoftInputs[]; marksRead: () => number;
  pass(): ReturnType<typeof generationsPass>;
  /** A visible frame of the bound session's place, through home B's reporter: the mark's one writer, the server's clock. */
  visible(): void;
}

const base: GenReadings = { usage: { kind: 'absent' }, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
  behind: { kind: 'measured', value: false } };

/** One generation of `role` at rest in shadow past its least age, with a soft due every pass and a free hold table; the
 *  permit's inputs are recorded, and the permit is held (`no-break`) so every pass asks again. The store's mark reader is
 *  counted. */
function laneFx(role: FleetRole = 'overlord'): LaneFx {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-rr-g-lane-'), '.ccrc', 'coord.db')));
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const st = s.insertStart({ sessionId: OVERLORD, reportId: 'r-1', uuid: U1, source: 'startup', model: 'claude-opus-5-5', rowIncarnation: 'inc',
    reportedAt: t.ports.clock.wall(), receivedAt: t.ports.clock.wall() });
  if (!st.ok) throw new Error('start');
  const w = s.mintGeneration({ identity: OVERLORD, sessionId: OVERLORD, role, term: 1, rowIncarnation: 'inc',
    startId: st.id, startReportedAt: t.ports.clock.wall(), resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null,
    outcome: 'woken', mono: 1_000, proc: 'p1', now: t.ports.clock.wall() }, null, false);
  if (!w.ok) throw new Error('mint');
  s.db.prepare('UPDATE continuity_generations SET shadowState = NULL, walk = NULL, shadowDeadlineAt = NULL, mintedObservedMs = ? WHERE id = ?')
    .run(-LEAST_AGE_MS, w.id);
  s.advanceCursor({ lane: 'generations', from: 0, to: st.id });
  let reads = 0;
  const readMarks = s.operatorMarks.bind(s);
  s.operatorMarks = () => { reads += 1; return readMarks(); };
  const registry: RegistryFacts[] = [{ id: OVERLORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  const soft: SoftInputs[] = [];
  const pass = () => {
    const r: GenReadings = { ...base, drain: { held: false } };
    const d: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null, decide: {
        renewalDue: () => ({ due: true, cls: 'soft', why: 'turns', blind: [] }),
        softRenewalMay: (i) => { soft.push(i); return { start: false, waitFor: 'no-break' }; },
      } };
    return generationsPass(d, { registry, readings: new Map([[w.id, r]]), listedAt: t.ports.clock.wall() + 1, canRenew: true });
  };
  const bound: DesignationRead = { kind: 'designated', sessionId: OVERLORD, term: 1, row: null as never };
  const report = placeMarkReporter({ designationRead: () => bound, operatorMarks: readMarks,
    putOperatorMark: (p, at) => s.putOperatorMark(p, at) }, () => t.ports.clock.wall(), () => {});
  return { s, t, soft, marksRead: () => reads, pass, visible: () => { report(OVERLORD, true); } };
}

const lastPlace = (f: LaneFx): unknown => f.soft.at(-1)?.placeHiddenObservedMs;
const placeMs = (f: LaneFx): number => {
  const p = lastPlace(f) as { kind: string; value: number };
  expect(p.kind).toBe('measured');
  return p.value;
};
/** Passes every lane period for `ms` of observed time, the first at once. */
const passFor = (f: LaneFx, ms: number, each?: () => void): void => {
  f.pass();
  for (let at = RENEWAL_LANE_PERIOD_MS; at <= ms; at += RENEWAL_LANE_PERIOD_MS) { f.t.advance(RENEWAL_LANE_PERIOD_MS); each?.(); f.pass(); }
};
/** The recorded inputs with readers measured none (PR E's reading), decided by the real `softRenewalMay`. */
const decide = (i: SoftInputs, over: Partial<SoftInputs> = {}) => softRenewalMay({ ...i, readersRunning: { kind: 'measured', value: 0 }, ...over });

describe('the Overlord\'s place hidden: the `@overlord-place` mark, read in the lane (PR G, Task 10)', () => {
  it('five minutes hidden opens the break; a visible report resets it, and a place kept visible never opens it', () => {
    const f = laneFx();
    // The operator spoke just now, so the quiet disjunct stays shut for the whole case: the break is the place's alone.
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    f.visible();
    f.pass();
    expect(lastPlace(f)).toEqual({ kind: 'measured', value: 0 });
    passFor(f, BREAK_PLACE_HIDDEN_MS - 2 * RENEWAL_LANE_PERIOD_MS);
    expect(placeMs(f)).toBeLessThan(BREAK_PLACE_HIDDEN_MS);
    expect(decide(f.soft.at(-1)!)).toEqual({ start: false, waitFor: 'no-break' });
    passFor(f, 3 * RENEWAL_LANE_PERIOD_MS);
    expect(placeMs(f)).toBeGreaterThanOrEqual(BREAK_PLACE_HIDDEN_MS);
    expect((f.soft.at(-1)!.operatorQuietObservedMs as { value: number }).value).toBeLessThan(BREAK_NO_MESSAGE_MS);
    expect(decide(f.soft.at(-1)!)).toEqual({ start: true });
    // The place comes back on screen: its next visible frame refreshes the mark, and the next pass reads 0.
    f.visible();
    f.pass();
    expect(lastPlace(f)).toEqual({ kind: 'measured', value: 0 });
    expect(decide(f.soft.at(-1)!)).toEqual({ start: false, waitFor: 'no-break' });
    // Visible frames every 15 s keep it under five minutes for as long as the place stays open.
    passFor(f, 3 * BREAK_PLACE_HIDDEN_MS, () => { f.visible(); });
    expect(placeMs(f)).toBeLessThan(BREAK_PLACE_HIDDEN_MS);
  });

  it('marks that cannot be read make the place unmeasured: the permit waits `unmeasured` unless the quiet disjunct passes', () => {
    const f = laneFx();
    f.visible();
    f.s.db.prepare('UPDATE operator_marks SET at = ? WHERE programme = ?').run('not a time', OVERLORD_PLACE_MARK);
    passFor(f, 10 * MIN);
    expect(lastPlace(f)).toEqual({ kind: 'unmeasured', why: 'place-mark: the marks could not be read' });
    const i = f.soft.at(-1)!;
    expect(decide(i)).toEqual({ start: false, waitFor: 'unmeasured' });
    // The same unread place beside a measured quiet: short of 20 minutes it still waits, and at 20 the quiet alone is the break.
    expect(decide(i, { operatorQuietObservedMs: { kind: 'measured', value: BREAK_NO_MESSAGE_MS - 1 } })).toEqual({ start: false, waitFor: 'unmeasured' });
    expect(decide(i, { operatorQuietObservedMs: { kind: 'measured', value: BREAK_NO_MESSAGE_MS } })).toEqual({ start: true });
    expect(decide({ ...i, placeHiddenObservedMs: placeHiddenOf('unmeasured', 0) },
      { operatorQuietObservedMs: { kind: 'measured', value: 4 * MIN } })).toEqual({ start: false, waitFor: 'unmeasured' });
  });

  it('the marks are read once per pass for the permit: the place adds no read beside the operator\'s quiet', () => {
    const f = laneFx();
    f.visible();
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    const before = f.marksRead();
    f.pass();
    // Step ONE ages the marks (one read), and step FOUR reads them once, after that aging, for every soft due it permits.
    expect(f.marksRead() - before).toBe(2);
    expect(f.soft).toHaveLength(1);
    expect(f.soft[0]!.placeHiddenObservedMs).toEqual({ kind: 'measured', value: 0 });
  });

  it('a place mark never written reads as long hidden, as the operator\'s quiet reads no mark: never visible just now', () => {
    const f = laneFx();
    f.s.putOperatorMark(OVERLORD_OPERATOR_MARK, f.t.ports.clock.wall());
    f.pass();
    expect(lastPlace(f)).toEqual({ kind: 'measured', value: OPERATOR_MARK_MS });
    expect(decide(f.soft.at(-1)!)).toEqual({ start: true });
  });

  it('a place mark dated after the pass is not trusted as visible: unmeasured, until a visible frame refreshes it', () => {
    const f = laneFx();
    f.s.putOperatorMark(OVERLORD_PLACE_MARK, f.t.ports.clock.wall() + 3_600_000);
    f.pass();
    expect(lastPlace(f)).toEqual({ kind: 'unmeasured', why: 'place-mark: dated after this pass' });
    f.visible();   // home B's reporter rewrites a mark from the future at once (`placeMarkDue`)
    f.pass();
    expect(lastPlace(f)).toEqual({ kind: 'measured', value: 0 });
  });

  it('the place is the Overlord\'s only: a coordinator\'s and a worker\'s generation read not applicable, whatever the mark', () => {
    for (const role of ['coordinator', 'worker'] as const) {
      const f = laneFx(role);
      f.visible();
      f.pass();
      expect(f.soft.at(-1)?.placeHiddenObservedMs).toEqual({ kind: 'not-applicable' });
      passFor(f, 2 * BREAK_PLACE_HIDDEN_MS);
      expect(f.soft.at(-1)?.placeHiddenObservedMs).toEqual({ kind: 'not-applicable' });
    }
  });
});
