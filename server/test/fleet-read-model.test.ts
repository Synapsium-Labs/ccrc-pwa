// The tick's one `FleetReadModel` (D-5864; ARCH-51 #786; spec K13's listing half). RED until the model exists and
// the lanes take it: in a steady tick the registry is listed ONCE for selection, by the tick; the lanes that chose
// their rows from a listing of their own (tasks, names, PR, asks, and the mail lane's recipients) take the tick's.
// What stays fresh, by name, is an ACT-time read: the mail lane's switch read (the last one before it delivers) and
// the divergence census's late listing (read after git's records on purpose, `divergencesPass`). `readLimits` takes the
// tick's names (D-8069); only a request-time caller lets it list.
// Fixture homes only.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildFleetReadModel } from '../src/fleetReadModel.js';
import { markerSwitchNames, readSwitches, RECLAIM_PAUSE_MARKER } from '../../shared/switches.js';
import { MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { LATER, MONO_LATER, countBy, primed, rig } from './fleetListingFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

/** The callers whose listing CHOSE rows for a lane: a selection listing. */
const SELECTION = ['tick', 'tasksPass', 'namesPass', 'prPass', 'askPass'];

describe('buildFleetReadModel', () => {
  it('a listed registry keeps its records, names and refused set, and its switches are readSwitches(names)', () => {
    const names = ['demo-a.uuid', RECLAIM_PAUSE_MARKER];
    const read = { listed: true as const, records: [], names, refused: new Set<string>(), listedIds: new Set(['demo-a']), reused: new Set<string>(), cold: new Set<string>() };
    const model = buildFleetReadModel(read);
    expect(model.listed).toBe(true);
    if (model.listed) {
      expect(model.records).toBe(read.records);
      expect(model.names).toBe(names);
      expect(model.refused).toBe(read.refused);
    }
    expect(model.switches).toEqual(readSwitches(names));
    expect(model.switches[RECLAIM_PAUSE_MARKER]).toBe('set');
  });

  it('an unlistable registry is listed: false, and every switch is unmeasurable, never clear', () => {
    const model = buildFleetReadModel({ listed: false });
    expect(model.listed).toBe(false);
    expect(model.switches).toEqual(readSwitches(null));
    expect(markerSwitchNames.every((k) => model.switches[k] === 'unmeasurable')).toBe(true);
  });
});

describe('a steady tick lists the registry once for selection', () => {
  it('one selection listing per steady tick', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(r.listings.filter((c) => SELECTION.includes(c)), 'a lane chose its rows from a listing of its own').toEqual(['tick']);
  });

  it('the act-time reads stay fresh, by name: the mail lane\'s switch read and the divergence census\'s late listing', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const by = countBy(r.listings);
    expect({ mail: by.mailPass, divergences: by.divergencesPass, limits: by.readLimits }).toEqual({ mail: 1, divergences: 1, limits: undefined });
    expect(r.listings.length, 'one selection listing and two act-time ones').toBe(3);
  });
});

describe('a switch raised after the tick\'s listing holds the lane that acts on it (the act-time reads)', () => {
  it('a mail switch raised right after the tick\'s listing holds the mail lane before it reads its queue', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    const due = vi.spyOn(r.coord, 'dueDeliveries');
    r.hooks.afterListing = (caller) => { if (caller === 'tick') r.marker(MAIL_DISABLED_MARKER); };
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(due.mock.calls.length, 'a mail switch raised after the tick\'s listing holds').toBe(0);
  });

  it('CONTROL: the same tick, with no switch raised, lets the mail lane read its queue', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    const due = vi.spyOn(r.coord, 'dueDeliveries');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(due.mock.calls.length).toBeGreaterThan(0);
  });
});
