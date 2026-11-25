// Overlord W1, designation B, fix round 1 (review 3695 F2): the wiring that switches the deadline sweep, the write-set before
// each renewal and the old-body drain on, measured through the production composition. The server is built by `buildServer`
// with a real `FleetWatcher`, so the lane port is the one `server.ts` installs with `useOverlordLane`, the settle port is the
// production one (its go-live adapter answers `previous`), and the pass is the watcher's own `sweepGenerations`. Each case goes
// red when one seam is dropped: the install, the attempt handed to the pass, the attempt's run, the before-renew step handed to
// the renewal acts, and `previous` in the go-live adapter. Fixture HOMEs only.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { OverlordAuthorityJournal } from '../src/coord/overlordAuthorityJournal.js';
import type { FleetState } from '../src/fleetstate.js';
import type { SettleOutcome } from '../src/continuity/routes.js';
import { expectedSurfaceOf } from '../src/continuity/sandboxCheck.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { KEEP_AWAKE_CAP, POOL_SET_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { RENEWAL_LANE_PERIOD_MS } from '../../shared/continuity.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import { BUILD, FIXTURE_OWN_LISTS } from './sim/sandboxSets.js';
import { FAKE_T0, fakeTime, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// The renewal acts the watcher builds each pass are the production ones; this wrapper only keeps the before-renew step the
// watcher hands them (its eighth argument), so a case can ask it as a renewal would.
const handed = vi.hoisted(() => ({ beforeRenew: [] as unknown[] }));
vi.mock('../src/continuity/renewalWiring.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/continuity/renewalWiring.js')>();
  return { ...m, renewalActsOf: (...a: Parameters<typeof m.renewalActsOf>) => { handed.beforeRenew.push(a[7]); return m.renewalActsOf(...a); } };
});

const OLD = 'lane-a-overlord';
const OLD_UUID = '22222222-3333-4444-5555-666666666666';
const NEW = 'lane-b-overlord';
const NEW_UUID = '33333333-4444-5555-6666-777777777777';
const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
const GEN2 = '0189abcd-1234-5678-9abc-0123456789cd';
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));
const e = expectedSurfaceOf('overlord', FIXTURE_OWN_LISTS)!;

let template: Buffer = Buffer.alloc(0);
beforeAll(() => { const f = path.join(mkTmp('ccrc-lane-wiring-template-'), 'coord.db'); openCoordDb(f).close(); template = readFileSync(f); });

let app: FastifyInstance | undefined;
let watcher: FleetWatcher | undefined;
let coord: CoordStore | undefined;
afterEach(async () => {
  if (app) await app.close();
  if (watcher) await quietWatcher(watcher);
  coord?.db.close();
  app = undefined; watcher = undefined; coord = undefined;
  handed.beforeRenew.length = 0;
  removeTmpFixtures();
});

interface Rig { calls: string[][]; journal: { refuses: boolean }; settled: SettleOutcome[]; time: FakeTime }

/** The production server and a real watcher over one fixture HOME, the old body live and a rebind pending for the new one. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-lane-wiring-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'coord.db'), template);
  seedRow(home, OLD, { uuid: OLD_UUID, project: 'overlord' });
  seedRow(home, NEW, { uuid: NEW_UUID, project: 'overlord' });
  const rec = recorder();
  // keep-awake answers its `released <id>` line, so the drain clears the set and the profile digest before the stop.
  const run: typeof rec.run = async (cmd, args) => {
    if (args[0] === 'keep-awake') { rec.calls.push([...args]); return { ran: true, code: 0, stdout: `released ${args[2]}\n`, stderr: '' }; }
    return rec.run(cmd, args);
  };
  const flags = { refuses: false };
  const journal = { appendInTx: () => (flags.refuses ? { ok: false, error: 'authority-rolled-back', detail: 'refused for the test' }
    : { ok: true, kind: 'appended', record: { sequence: 1 } }) } as unknown as OverlordAuthorityJournal;
  const settled: SettleOutcome[] = [];
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const time = fakeTime();
  const deps = { ...testDeps(home, run), time: time.ports, monotonicMs: () => time.ports.clock.mono(), mailToken: ID_GATE_TOKEN, coord, overlordAuthority: journal,
    fleetState: { ccdVerbs: [ROUTE_CAP, KEEP_AWAKE_CAP, POOL_SET_CAP] } as unknown as FleetState,
    overlordSandbox: { ownLists: FIXTURE_OWN_LISTS, settled: (o: SettleOutcome) => { settled.push(o); } } };
  const bus = new Bus();
  watcher = new FleetWatcher(deps as never, bus, 10_000);
  app = await buildServer(deps as never, bus, watcher);
  await app.ready();
  // The old body designated and live, then a rebind pending for the new body with its generation bound.
  expect(coord.designatePending(journal, { sessionId: OLD, deadlineAt: FAKE_T0 + 600_000, model: 'opus', accountPools: { pools: [], untagged: true },
    actor: OPERATOR, at: FAKE_T0 - 1000, opKey: 'designate-wiring' }).ok).toBe(true);
  expect(coord.bindPendingGeneration(OLD, GEN, FAKE_T0 - 900).ok).toBe(true);
  expect(coord.goLive(journal, OLD, GEN, FAKE_T0 - 800).ok).toBe(true);
  expect(coord.rebindPending({ sessionId: NEW, deadlineAt: FAKE_T0 + 600_000, actor: OPERATOR, at: FAKE_T0 - 700 }).ok).toBe(true);
  expect(coord.bindPendingGeneration(NEW, GEN2, FAKE_T0 - 600).ok).toBe(true);
  return { calls: rec.calls, journal: flags, settled, time };
}

/** The new body's start and its held loads report, through the real doors; the door's settle is awaited by its signal. */
async function reportNew(r: Rig): Promise<SettleOutcome> {
  const s = await app!.inject({ method: 'POST', url: `/api/sessions/${NEW}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
    payload: { fromId: NEW, fromUuid: NEW_UUID, reportId: 'r-nw1-abcd', source: 'startup', reportedAt: FAKE_T0 - 50, rowIncarnation: GEN2 } });
  expect(s.statusCode, s.body).toBe(202);
  const before = r.settled.length;
  const l = await app!.inject({ method: 'POST', url: `/api/sessions/${NEW}/start/loads`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
    payload: { fromId: NEW, fromUuid: NEW_UUID, reportId: 'r-nw1-abcd', profileRole: 'overlord', profileDigest: e.digest, launchRc: 'off',
      claudeVersion: BUILD, permissionMode: 'bypassPermissions', cwdInWorkspace: true, reportedAt: FAKE_T0 - 40,
      loaded: { instructions: [{ type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: e.constitutionSha256 }], hooks: [e.hookSha256],
        skills: ['ccrc-overlord'], agents: ['Explore', 'overlord-reader'], tools: ['Agent', 'Skill', 'mcp__door__read'], toolServers: ['door'] } } });
  expect(l.statusCode, l.body).toBe(202);
  await vi.waitFor(() => { expect(r.settled.length).toBeGreaterThan(before); });
  return r.settled.at(-1)!;
}

const read = () => { const d = coord!.designationRead(); if (d.kind === 'unmeasured') throw new Error(d.why); return d; };
const stops = (r: Rig) => r.calls.filter((c) => c[0] === 'stop');

describe('designation B\'s wiring, through the production server and a real watcher (review 3695 F2)', { timeout: 90_000 }, () => {
  it('the production go-live adapter answers the previous body: the door\'s settle binds the new body and stops the old one', async () => {
    const r = await rig();
    expect(await reportNew(r)).toMatchObject({ sessionId: NEW, act: 'go-live' });
    expect(read()).toMatchObject({ kind: 'designated', sessionId: NEW });
    // The old body is stopped by the settle's drain, which runs only on the adapter's `previous`.
    expect(stops(r), JSON.stringify(r.calls)).toStrictEqual([['stop', OLD]]);
    expect(read().row?.stopsOwed).toStrictEqual([]);
  });

  it('a live pass of the watcher settles a lost go-live again through the installed lane, binds the new body and stops the old one', async () => {
    const r = await rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The door's settle is refused by the journal: the rebind stays pending with its held report stored.
      r.journal.refuses = true;
      expect((await reportNew(r)).act).not.toBe('go-live');
      expect(read()).toMatchObject({ kind: 'designated', sessionId: OLD });
      expect(read().row?.pending).toMatchObject({ sessionId: NEW, kind: 'rebind' });
      r.journal.refuses = false;
      // In shadow the pass only records what it would do.
      await watcher!.sweepGenerations([], FAKE_T0);
      expect(read().row?.pending).toMatchObject({ sessionId: NEW });
      expect(warn.mock.calls.flat().some((l) => String(l).includes('the Overlord\'s attempt would resettle'))).toBe(true);
      expect(stops(r)).toStrictEqual([]);
      // Live, the pass's action is run through the lane `server.ts` installed: the settle is re-run from the stored report.
      coord!.setLaneArm(CONTINUITY_LANE, 'live', 1);
      r.time.advance(RENEWAL_LANE_PERIOD_MS);   // the lane's cadence, on its own clock
      await watcher!.sweepGenerations([], r.time.ports.clock.wall());
      expect(read(), JSON.stringify(warn.mock.calls)).toMatchObject({ kind: 'designated', sessionId: NEW });
      expect(warn.mock.calls.flat().some((l) => String(l).includes(`overlord attempt: settled ${NEW} again from start 1: go-live`))).toBe(true);
      expect(stops(r), JSON.stringify(r.calls)).toStrictEqual([['stop', OLD]]);
      expect(warn.mock.calls.flat().filter((l) => String(l).includes('generations lane failed'))).toEqual([]);
    } finally { warn.mockRestore(); }
  });

  it('the watcher hands the renewal acts the installed lane\'s before-renew step, which writes the bound body\'s set and class', async () => {
    const r = await rig();
    expect((await reportNew(r)).act).toBe('go-live');
    r.calls.length = 0;
    await watcher!.sweepGenerations([], FAKE_T0);
    const step = handed.beforeRenew.at(-1);
    expect(typeof step, 'the before-renew step was not handed to the renewal acts').toBe('function');
    const w = await (step as (t: { sessionId: string }) => Promise<{ ok: boolean; detail?: string }>)({ sessionId: NEW });
    expect(w, JSON.stringify(r.calls)).toMatchObject({ ok: true });
    const written = r.calls.map((c) => c.join(' '));
    expect(written.some((c) => c.includes(NEW) && c.includes('poolset=')), JSON.stringify(r.calls)).toBe(true);
    // A body the designation does not bind is refused, and nothing is written for it.
    r.calls.length = 0;
    expect(await (step as (t: { sessionId: string }) => Promise<{ ok: boolean }>)({ sessionId: OLD })).toMatchObject({ ok: false });
    expect(r.calls).toStrictEqual([]);
  });
});
