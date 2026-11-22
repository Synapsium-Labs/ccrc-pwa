// The console's places, derived (Overlord W1 home, Task 1): `placesFor` (the phone's order), `deskPlacesFor` (the desk bars)
// and `phoneDoorsFit` (the phone bar at its width, plan question 13).
import { describe, expect, it } from 'vitest';
import type { DesignationState, HomeAnswer } from '../src/overlord/homePlace';
import {
  deskPlacesFor, FLEET_PLACE, OVERLORD_PLACE, PHONE_DOOR_FIT_PX, PHONE_DOOR_MIN_PX, phoneDoorsFit, placesFor, type Place,
} from '../src/lib/places';
import { ROUTES } from '../src/lib/routes';

const TODAY = ['fleet', 'waiting', 'inbox', 'runs', 'accounts', 'docs'];
const ids = (ps: readonly Place[]): string[] => ps.map((p) => p.id);

const STATES: Readonly<Record<DesignationState['kind'], DesignationState>> = {
  unmeasured: { kind: 'unmeasured', why: 'loading' },
  none: { kind: 'none' },
  'failed-start': { kind: 'failed-start', outcome: 'create-failed' },
  pending: { kind: 'pending', sessionId: 'lane-a-overlord' },
  bound: { kind: 'bound', sessionId: 'lane-a-overlord' },
};
const HOME_OVERLORD: HomeAnswer = { place: 'overlord', why: 'designated' };
const HOME_RUNG_OFF: HomeAnswer = { place: 'fleet', why: 'rung-off' };
const HOME_FAILED: HomeAnswer = { place: 'fleet', why: 'failed-start' };
const HOME_NONE: HomeAnswer = { place: 'fleet', why: 'none' };

describe('placesFor', () => {
  it("answers today's six places, in today's order, with no Overlord door without the word", () => {
    for (const d of Object.values(STATES)) expect(ids(placesFor(false, d))).toEqual(TODAY);
  });
  it('puts the Overlord first for bound, pending and a failed first start', () => {
    for (const k of ['bound', 'pending', 'failed-start'] as const) expect(ids(placesFor(true, STATES[k]))).toEqual(['overlord', ...TODAY]);
  });
  it('draws no Overlord door for none or unmeasured, even with the word', () => {
    expect(ids(placesFor(true, STATES.none))).toEqual(TODAY);
    expect(ids(placesFor(true, STATES.unmeasured))).toEqual(TODAY);
  });
  it('every place, the Overlord included, is a top row of ROUTES, so a bar never throws', () => {
    for (const p of [...placesFor(true, STATES.bound), OVERLORD_PLACE]) {
      expect(ROUTES.find((r) => r.id === p.id)?.top, p.id).toBe(true);
    }
  });
});

describe('deskPlacesFor (ruled F5, plan question 14)', () => {
  it('has no Fleet door while no Overlord door is drawn (D25)', () => {
    for (const d of Object.values(STATES)) expect(ids(deskPlacesFor(false, d, HOME_NONE))).toEqual(TODAY.slice(1));
    expect(ids(deskPlacesFor(true, STATES.none, HOME_NONE))).toEqual(TODAY.slice(1));
    expect(ids(deskPlacesFor(true, STATES.unmeasured, { place: 'fleet', why: 'designation-unmeasured' }))).toEqual(TODAY.slice(1));
  });
  it('adds the Fleet door second, after the Overlord, while the home is the Overlord', () => {
    for (const k of ['bound', 'pending'] as const) {
      expect(ids(deskPlacesFor(true, STATES[k], HOME_OVERLORD))).toEqual(['overlord', FLEET_PLACE, ...TODAY.slice(1)]);
      expect(ids(deskPlacesFor(true, STATES[k], { place: 'overlord', why: 'rung-unmeasured' })))
        .toEqual(['overlord', FLEET_PLACE, ...TODAY.slice(1)]);
    }
  });
  it('has no Fleet door with no Overlord door, whatever the home answers', () => {
    expect(ids(deskPlacesFor(false, STATES.bound, HOME_OVERLORD))).toEqual(TODAY.slice(1));
  });
  it('has no Fleet door while the rung is off or a first start failed: the home, and the wordmark, are the Fleet then', () => {
    expect(ids(deskPlacesFor(true, STATES.bound, HOME_RUNG_OFF))).toEqual(['overlord', ...TODAY.slice(1)]);
    expect(ids(deskPlacesFor(true, STATES['failed-start'], HOME_FAILED))).toEqual(['overlord', ...TODAY.slice(1)]);
  });
});

describe('phoneDoorsFit (plan question 13)', () => {
  const eight = placesFor(true, STATES.bound);
  const seven = placesFor(false, STATES.none);
  it('with the Overlord: six doors at 320 px (Accounts and Docs drop), seven at 360 (Docs drops), all eight from 384', () => {
    expect(ids(phoneDoorsFit(320, eight))).toEqual(['overlord', ...TODAY.slice(0, -2)]);
    expect(ids(phoneDoorsFit(360, eight))).toEqual(['overlord', ...TODAY.slice(0, -1)]);
    expect(ids(phoneDoorsFit(384, eight))).toEqual(ids(eight));
    expect(ids(phoneDoorsFit(390, eight))).toEqual(ids(eight));
  });
  it("without it: today's seven doors from 336 px, and Docs drops at 320, where Accounts' word was cut", () => {
    expect(ids(phoneDoorsFit(360, seven))).toEqual(TODAY);
    expect(ids(phoneDoorsFit(336, seven))).toEqual(TODAY);
    expect(ids(phoneDoorsFit(320, seven))).toEqual(TODAY.slice(0, -1));
  });
  it('every kept door, Search beside them, is at least the tap minimum wide', () => {
    for (const w of [240, 280, 300, 320, 352, 360, 390, 899]) {
      for (const list of [eight, seven]) {
        const kept = phoneDoorsFit(w, list);
        const doors = kept.length + 1;
        // The Overlord and the Fleet are kept even past the minimum; any other kept door means the minimum held.
        const droppable = kept.filter((p) => p.id !== 'overlord' && p.id !== FLEET_PLACE).length;
        if (droppable > 0) expect(w / doors, `${w}px, ${doors} doors`).toBeGreaterThanOrEqual(PHONE_DOOR_FIT_PX);
      }
    }
    expect(PHONE_DOOR_MIN_PX).toBe(44);
    expect(PHONE_DOOR_FIT_PX).toBeGreaterThanOrEqual(PHONE_DOOR_MIN_PX);
  });
  it('drops from the end, and never drops the Overlord or the Fleet', () => {
    expect(ids(phoneDoorsFit(132, eight))).toEqual(['overlord', 'fleet']);
    expect(ids(phoneDoorsFit(88, eight))).toEqual(['overlord', 'fleet']);
    expect(ids(phoneDoorsFit(192, eight))).toEqual(['overlord', 'fleet', 'waiting']);
    expect(ids(phoneDoorsFit(240, eight))).toEqual(['overlord', 'fleet', 'waiting', 'inbox']);
    expect(ids(phoneDoorsFit(88, seven))).toEqual(['fleet']);
  });
});
