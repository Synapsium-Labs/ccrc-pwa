// Routing spec 2026-09-14 §6 "Arms" (routing slice 5, Task 3): the run's own
// event trail carries two new facts an operator/console reads apart from the
// wall-time signals `run-signals.test.ts` already pins — the `arm:` a
// dispatch actually seeded, and every `route:` change since. Both are parsed
// off `run_events.detail`, never thrown on a malformed row (`arm: null` /
// `routingUnparsed` are the honest answers to "this file could not read
// that", never a crash that would take the rest of `RunSignals` down with
// it).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import {
  armEventDetail, parseArmEventDetail, parseRouteEventDetail, routeEventDetail,
} from '../../shared/api.js';

afterEach(removeTmpFixtures);

const open = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-run-signals-routing-'), 'coord.db')));

/** `run-signals.test.ts`'s own `seedRun` — a run driven planned → dispatched,
 *  copied rather than imported (that file has no exports; the pair stays
 *  small and self-evident to duplicate). */
function seedRun(coord: CoordStore): number {
  const opened = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'ccrc-pwa-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, 'demo-worker', 'worker', 'ws/worker', false);
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  return opened.id;
}

describe('CoordStore.runSignals — arm and routing (routing spec §6, slice 5)', () => {
  it('a run with no arm/route events answers arm: null, armUnparsed: 0, routing: [], routingUnparsed: 0', () => {
    const coord = open(); const id = seedRun(coord);
    expect(coord.runSignals(id)).toMatchObject({ arm: null, armUnparsed: 0, routing: [], routingUnparsed: 0 });
  });

  it('an arm: event and two route: events answer both, in order, with the event rows\' own at/causedBy', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRunEvent(id, 'coordinator', 'arm:class=opus effort=high', 1_000_000);
    coord.recordRunEvent(id, 'coordinator', 'route:escalate:effort:medium->high:shallow', 1_100_000);
    coord.recordRunEvent(id, 'operator', 'route:manual:class:?->sonnet:manual', 1_200_000);
    const s = coord.runSignals(id)!;
    expect(s.arm).toEqual({ class: 'opus', effort: 'high' });
    expect(s.routingUnparsed).toBe(0);
    expect(s.routing).toEqual([
      { at: 1_100_000, mode: 'escalate', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', causedBy: 'coordinator', session: null },
      { at: 1_200_000, mode: 'manual', field: 'class', from: '?', to: 'sonnet', kind: 'manual', causedBy: 'operator', session: null },
    ]);
  });

  it('a malformed route: detail is skipped and counted, never thrown', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRunEvent(id, 'coordinator', 'route:bogus:field:a->b:shallow', 1_000_000);
    expect(coord.runSignals(id)).toMatchObject({ arm: null, routing: [], routingUnparsed: 1 });
  });

  it('a malformed route: detail beside a well-formed one: the good one still lands, the bad one is only counted', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRunEvent(id, 'coordinator', 'route:bogus:field:a->b:shallow', 1_000_000);
    coord.recordRunEvent(id, 'coordinator', 'route:demote:class:opus->sonnet:manual', 1_100_000);
    const s = coord.runSignals(id)!;
    expect(s.routingUnparsed).toBe(1);
    expect(s.routing).toEqual([
      { at: 1_100_000, mode: 'demote', field: 'class', from: 'opus', to: 'sonnet', kind: 'manual', causedBy: 'coordinator', session: null },
    ]);
  });

  it('only the FIRST arm: event is read; a later one never overwrites it', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRunEvent(id, 'coordinator', 'arm:class=opus effort=high', 1_000_000);
    coord.recordRunEvent(id, 'coordinator', 'arm:class=sonnet', 1_100_000);
    expect(coord.runSignals(id)!.arm).toEqual({ class: 'opus', effort: 'high' });
  });

  // Fix round 2, finding #2, controller ruling S5-R9: `arm: null` must not
  // collapse "no routing was seeded" with "the arm event could not be
  // parsed" — `armUnparsed` is the field that tells them apart.
  it('a malformed first arm: row followed by a well-formed one: arm is the second, armUnparsed: 1', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRunEvent(id, 'coordinator', 'arm:bogus', 1_000_000);
    coord.recordRunEvent(id, 'coordinator', 'arm:class=opus effort=high', 1_100_000);
    const s = coord.runSignals(id)!;
    expect(s.arm).toEqual({ class: 'opus', effort: 'high' });
    expect(s.armUnparsed).toBe(1);
  });

  it('a run with no arm rows answers arm: null, armUnparsed: 0', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRunEvent(id, 'coordinator', 'route:escalate:effort:medium->high:shallow', 1_000_000);
    const s = coord.runSignals(id)!;
    expect(s.arm).toBeNull();
    expect(s.armUnparsed).toBe(0);
  });
});

// Fix round 2, finding #4, controller ruling S5-R8: a grammar with a parser
// in `shared/api.ts` gets a formatter beside it, round-tripped — a mutation
// to either side's separator reds these.
describe('armEventDetail / routeEventDetail round-trip their own parsers (shared/api.ts)', () => {
  it('armEventDetail(f) parses back to f — a two-field object', () => {
    const f = { class: 'opus', effort: 'high' } as const;
    expect(parseArmEventDetail(armEventDetail(f))).toEqual(f);
  });

  it('armEventDetail(f) parses back to f — a five-field object', () => {
    const f = { class: 'opus', effort: 'high', subagent: 'sonnet', workflow: 'haiku', compact: 'on' } as const;
    expect(parseArmEventDetail(armEventDetail(f))).toEqual(f);
  });

  it('routeEventDetail(e) parses back to e — an escalate event, with a session', () => {
    const e = { mode: 'escalate', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', session: 'demo-worker' } as const;
    expect(parseRouteEventDetail(routeEventDetail(e))).toEqual(e);
  });

  it('routeEventDetail(e) parses back to e — a manual event, with a session', () => {
    const e = { mode: 'manual', field: 'class', from: '?', to: 'sonnet', kind: 'manual', session: 'demo-coord' } as const;
    expect(parseRouteEventDetail(routeEventDetail(e))).toEqual(e);
  });

  // Routing slice 6, Task 1: the sixth segment is ADDITIVE — a five-segment
  // detail (every `route:` event this door ever wrote before this task) is
  // still a valid parse, and its `session` is `null`, never the same value
  // a caller would read off a MEASURED-absent session (there is no such
  // thing here — the point is this event named no session at all).
  it('a five-segment route: detail (pre-slice-6) still parses, with session: null', () => {
    expect(parseRouteEventDetail('route:escalate:effort:medium->high:shallow')).toEqual(
      { mode: 'escalate', field: 'effort', from: 'medium', to: 'high', kind: 'shallow', session: null },
    );
  });
});
