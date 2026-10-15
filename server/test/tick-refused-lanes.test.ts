// Path identity W1a, fix round 2 (spec §2.3; slug `tick-lanes-hold-a-refused-id`). A listed-but-refused id — a `.uuid`
// whose basename is not a registry id — is named in `RegistryRead.refused` and is in no `records`, so it is in no
// tick's `sessions` either. The lanes on the main watch's tick that would read that omission as the session's absence
// are handed this tick's `refused` set instead, and hold the id as unmeasured or leave it out:
// - the stall watch's run verdict, for a run's stored WORKER, and its run-less coordinator judge, for a CLAIMANT;
// - the claim lease lanes (`renewClaims`, `lapseClaims`);
// - the divergence census's open-run side.
// Each case plants a fully seeded `--actor` row beside a valid one under a fixture HOME, reads the registry as `tick()`
// reads it (`readRegistryMeasured`), and hands the lane exactly what `tick()` hands it; (A2) and (A3) then unlist it, to
// pin that no clock starts while the id is refused, and (E) and (E') to pin that none is kept: the lane drops a refused
// subject's clocks. That `tick()` hands each lane `registryRead.refused` is pinned in `registry-refused-census.test.ts`.
// Fakes and fixture HOMEs only: no live fleet, no real ccd, no real tmux.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher, STALL_SWEEP_MS } from '../src/watch.js';
import { readRegistryMeasured } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { DEAD_GRACE_MS, MARKER_UNREADABLE_MS, parseStallDetail } from '../src/coord/stall.js';
import type { PushPayload } from '../src/push.js';
import { CLAIM_HARD_CAP_MS, CLAIM_LEASE_MS, type Divergence, type FleetSession } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { storedRun } from './idGateFixture.js';

/** A redirect id (spec §2.1): ccd's loops would read it as a flag. Never the 256-character id: its `.uuid` basename
 *  is over 255 bytes, so it cannot be planted as a file at all. */
const BAD = '--actor';
const GOOD = 'demo-a';
const COORD = 'demo-coordinator';
const T0 = Date.parse('2026-10-01T12:00:00Z');
/** Wave 1 and wave 2 armed, live: a dead or marker-unreadable notice would send, not shadow. Armed through the
 *  registry listing's own names, as `tick()` arms the lane. */
const ARMS: readonly string[] = ['stall-watch-live', 'stall-watch-escalate', 'stall-watch-w2-live'];

const at = (ms: number): void => { vi.setSystemTime(ms); };

/** One registry row as plain files, every identity field non-empty (`registry-refused-callers.test.ts`'s `plant`,
 *  copied). Its workdir `/w/<id>` is outside any fixture projects root. */
const plant = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A COMPLETE fleet row (`stall-sweep.test.ts`'s `fleetRow`, copied), alive and running. */
const fleetRow = (id: string, over: Partial<FleetSession> = {}): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: `/w/${id}`,
  workspace: id, name: null, status: 'idle', statusUpdatedAt: T0, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
  ...over,
});

interface Rig {
  home: string; reg: string; coord: CoordStore; w: FleetWatcher; deps: Deps; bus: Bus;
  /** Every path any read touched, and every runner argv. */
  touched: string[]; calls: string[][]; sent: PushPayload[];
}

/** A watcher primed on an EMPTY but listable registry (`mail-sweep.test.ts`'s order), with a counting io, a recording
 *  runner and a push spy. The rows are planted after priming, so the priming tick's lanes never see them. */
const rig = async (): Promise<Rig> => {
  const home = mkTmp('ccrc-tick-refused-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const touched: string[] = [];
  const io: FleetIO = {
    ...localIO,
    readFileMeasured: async (p, t, s) => { touched.push(p); return localIO.readFileMeasured(p, t, s); },
    readFile: async (p) => { touched.push(p); return localIO.readFile(p); },
    readFileFromMeasured: async (p, o) => { touched.push(p); return localIO.readFileFromMeasured(p, o); },
    readFileFrom: async (p, o) => { touched.push(p); return localIO.readFileFrom(p, o); },
    readFileB64Measured: async (p) => { touched.push(p); return localIO.readFileB64Measured(p); },
    statMeasured: async (p) => { touched.push(p); return localIO.statMeasured(p); },
    stat: async (p) => { touched.push(p); return localIO.stat(p); },
    lstatMeasured: async (p) => { touched.push(p); return localIO.lstatMeasured(p); },
  };
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push([...args]); return { code: 1, stdout: '', stderr: '' }; };
  const sent: PushPayload[] = [];
  const deps: Deps = {
    ...testDeps(home, run), io, coord, stateCachePath: path.join(home, 'state-cache.json'),
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
  };
  const bus = new Bus();
  const w = new FleetWatcher(deps, bus, 2000);
  await w.tick();
  return { home, reg, coord, w, deps, bus, touched, calls, sent };
};

/** The registry read `tick()` takes, asserted to have refused `--actor` and built the valid row alone. */
const tickRead = async (r: Rig) => {
  const read = await readRegistryMeasured(r.deps.io, r.deps.cfg);
  if (!read.listed) throw new Error('fixture: the registry did not list');
  expect([...read.refused], 'the listing refused --actor').toEqual([BAD]);
  expect(read.records.map((x) => x.id), 'and built the valid row alone').toEqual([GOOD]);
  return read;
};

/** The stall watch's own mail (its sender is the operator role). */
const stallMail = (coord: CoordStore): { toId: string; subject: string }[] =>
  coord.db.prepare("SELECT toId, subject FROM mail WHERE fromId = 'operator' ORDER BY id").all() as unknown as { toId: string; subject: string }[];
const stallRows = (coord: CoordStore, runId: number): string[] =>
  coord.runEvents(runId).flatMap((e) => (parseStallDetail(e.detail) === null ? [] : [e.detail as string]));
const aboutBad = (p: string): boolean => path.basename(p).startsWith(`${BAD}.`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 - 3_600_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the stall lane holds a listed-but-refused id it is handed (tick-lanes-hold-a-refused-id)', () => {
  const END = T0 + Math.max(DEAD_GRACE_MS, MARKER_UNREADABLE_MS) + 2 * STALL_SWEEP_MS;

  it('(A) a run whose stored worker is --actor draws no dead notice, no push and no stall row past DEAD_GRACE_MS and MARKER_UNREADABLE_MS, and no path or argv is composed from it', async () => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    for (const m of ARMS) writeFileSync(path.join(r.reg, m), '');
    const runId = storedRun(r.coord, { state: 'working', sessionId: BAD, claimedBy: COORD });
    const read = await tickRead(r);
    expect(ARMS.every((m) => read.names.includes(m)), 'the arms ride the listing').toBe(true);
    r.touched.length = 0;
    r.calls.length = 0;
    for (let t = T0; t <= END; t += STALL_SWEEP_MS) {
      at(t);
      await r.w.sweepStalls([fleetRow(GOOD)], read.names, { panePids: new Map(), records: read.records, refused: read.refused });
    }
    expect(stallMail(r.coord), 'no stall mail: no dead notice to the coordinator').toEqual([]);
    expect(r.sent, 'no operator push').toEqual([]);
    expect(stallRows(r.coord, runId), 'no stall: row on the run').toEqual([]);
    expect(r.touched.filter(aboutBad), 'no live, marker or hook-state path is composed from --actor').toEqual([]);
    expect(r.calls.filter((a) => a.some((x) => x.includes(BAD))), 'no argv carries --actor').toEqual([]);
  }, 60_000);

  it("(A') a run-less coordinator judge holds a refused claimant: a malformed .turn.json past MARKER_UNREADABLE_MS draws no push, and is never read", async () => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    for (const m of ARMS) writeFileSync(path.join(r.reg, m), '');
    writeFileSync(path.join(r.reg, `${BAD}.turn.json`), '{ not json');
    // The worker is the valid row, present on the tick: with no pane pid its live read holds it, so it draws nothing.
    const runId = storedRun(r.coord, { state: 'working', sessionId: GOOD, claimedBy: BAD });
    const read = await tickRead(r);
    r.touched.length = 0;
    for (let t = T0; t <= END; t += STALL_SWEEP_MS) {
      at(t);
      await r.w.sweepStalls([fleetRow(GOOD)], read.names, { panePids: new Map(), records: read.records, refused: read.refused });
    }
    expect(r.sent, 'no marker-unreadable push for the refused claimant').toEqual([]);
    expect(stallMail(r.coord), 'no stall mail').toEqual([]);
    expect(stallRows(r.coord, runId)).toEqual([]);
    expect(r.touched.filter(aboutBad), 'its marker is never read').toEqual([]);
    // CONTROL: the valid worker WAS judged, so the lane ran: its marker was read on every sweep.
    expect(r.touched.filter((p) => path.basename(p) === `${GOOD}.turn.json`).length).toBeGreaterThan(0);
  }, 60_000);

  // The lane drops a refused subject's clocks, so none starts during the refusal and none is kept across it. A clock
  // that started while the id was refused would show once the id is UNLISTED (its `.uuid` gone, so it is in no
  // `refused` either, and absence is read as on main: `unlisted-non-registry-id-reads-absent-on-the-tick`). The
  // instants, one sweep per STALL_SWEEP_MS: refused from T0 to END (T0 + 62 min), past DEAD_GRACE_MS and
  // MARKER_UNREADABLE_MS; unlisted between END and U = END + STALL_SWEEP_MS (T0 + 63 min), the first sweep that reads it
  // absent, where its clocks start. A clock started in the refused stretch would date from T0 and fire at U.
  const U = END + STALL_SWEEP_MS;
  type Listed = Awaited<ReturnType<typeof tickRead>>;
  /** One sweep per STALL_SWEEP_MS from `from` to `to`, both included, handed what `tick()` hands the lane off `read`. */
  const sweepEach = async (r: Rig, read: Listed, from: number, to: number): Promise<void> => {
    for (let t = from; t <= to; t += STALL_SWEEP_MS) {
      at(t);
      await r.w.sweepStalls([fleetRow(GOOD)], read.names, { panePids: new Map(), records: read.records, refused: read.refused });
    }
  };
  /** Unlists --actor: deletes every `--actor.*` file but `keep`, then reads the registry as `tick()` reads it. */
  const unlist = async (r: Rig, keep: readonly string[] = []): Promise<Listed> => {
    for (const f of readdirSync(r.reg)) if (aboutBad(f) && !keep.includes(f)) rmSync(path.join(r.reg, f));
    const read = await readRegistryMeasured(r.deps.io, r.deps.cfg);
    if (!read.listed) throw new Error('fixture: the registry did not list');
    expect([...read.refused], '--actor is unlisted, so no longer refused').toEqual([]);
    expect(read.records.map((x) => x.id)).toEqual([GOOD]);
    return read;
  };
  const markerPushes = (r: Rig): PushPayload[] => r.sent.filter((p) => (p.tag ?? '').includes('-marker-unreadable-'));

  it('(A2) the absent clock does not run while the worker id is refused: unlisted after the refused stretch, it draws the dead notice DEAD_GRACE_MS after the unlisting, never before', async () => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    for (const m of ARMS) writeFileSync(path.join(r.reg, m), '');
    const runId = storedRun(r.coord, { state: 'working', sessionId: BAD, claimedBy: COORD });
    await sweepEach(r, await tickRead(r), T0, END);
    expect(stallMail(r.coord), 'nothing while refused').toEqual([]);
    expect(stallRows(r.coord, runId)).toEqual([]);
    const after = await unlist(r);
    // U to U + DEAD_GRACE_MS − STALL_SWEEP_MS (T0 + 72 min): absent, inside the grace.
    await sweepEach(r, after, U, U + DEAD_GRACE_MS - STALL_SWEEP_MS);
    expect(stallMail(r.coord), 'no dead notice before DEAD_GRACE_MS has passed since the unlisting').toEqual([]);
    expect(stallRows(r.coord, runId), 'and no stall: row').toEqual([]);
    // CONTROL, U + DEAD_GRACE_MS (T0 + 73 min): the dead notice arrives, so the absent clock started at U.
    await sweepEach(r, after, U + DEAD_GRACE_MS, U + DEAD_GRACE_MS);
    const mail = stallMail(r.coord);
    expect(mail.map((m) => m.toId)).toEqual([COORD]);
    expect(mail[0]!.subject).toContain('registry row absent');
    expect(stallRows(r.coord, runId).map((d) => parseStallDetail(d))).toMatchObject([{ mode: 'live', arm: 'dead', rung: 1 }]);
    expect(r.sent, 'a dead report goes to the coordinator, never a push').toEqual([]);
  }, 60_000);

  it.each([
    { role: 'worker', sessionId: BAD, claimedBy: COORD },
    { role: 'claimant', sessionId: GOOD, claimedBy: BAD },
  ])('(A3) the marker clock does not run while the $role id is refused: unlisted after the refused stretch with its malformed .turn.json kept, it draws the marker-unreadable push MARKER_UNREADABLE_MS after the unlisting, never before', async ({ sessionId, claimedBy }) => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    for (const m of ARMS) writeFileSync(path.join(r.reg, m), '');
    writeFileSync(path.join(r.reg, `${BAD}.turn.json`), '{ not json');
    storedRun(r.coord, { state: 'working', sessionId, claimedBy });
    await sweepEach(r, await tickRead(r), T0, END);
    expect(r.sent, 'nothing while refused').toEqual([]);
    const after = await unlist(r, [`${BAD}.turn.json`]);
    // U to U + MARKER_UNREADABLE_MS − STALL_SWEEP_MS (T0 + 122 min): the marker reads malformed, inside its window.
    await sweepEach(r, after, U, U + MARKER_UNREADABLE_MS - STALL_SWEEP_MS);
    expect(markerPushes(r), 'no marker-unreadable push before MARKER_UNREADABLE_MS has passed since the unlisting').toEqual([]);
    // CONTROL, U + MARKER_UNREADABLE_MS (T0 + 123 min): the push arrives, so the marker clock started at U.
    await sweepEach(r, after, U + MARKER_UNREADABLE_MS, U + MARKER_UNREADABLE_MS);
    expect(markerPushes(r)).toHaveLength(1);
  }, 60_000);

  /** A span as the dead notice prints it, `<h>h <m>m`, floored to the minute (`stallSpan`'s form). */
  const spanOf = (ms: number): string => `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`;

  // (E) pins that no clock is KEPT across a refusal (that (A2) and (A3) pin that none STARTS during one). The instants,
  // one sweep per STALL_SWEEP_MS: unlisted at T0, one sweep, where the absent clock starts; listed and refused from
  // T0 + STALL_SWEEP_MS to END (T0 + 62 min), past DEAD_GRACE_MS, where the lane drops that clock; unlisted again from
  // U (T0 + 63 min). A clock kept across the refusal dates from T0 and fires at U, with "absent for 1h 3m"; dropped, it
  // restarts at U and fires at U + DEAD_GRACE_MS (T0 + 73 min), stating `DEAD_GRACE_MS` counted from the re-unlisting.
  it('(E) the absent clock is dropped by a refused stretch: unlisted, then refused past DEAD_GRACE_MS, then unlisted again, the dead notice comes DEAD_GRACE_MS after the re-unlisting, stating that span', async () => {
    const r = await rig();
    plant(r.home, GOOD);
    for (const m of ARMS) writeFileSync(path.join(r.reg, m), '');
    const runId = storedRun(r.coord, { state: 'working', sessionId: BAD, claimedBy: COORD });
    const unlisted = await unlist(r);
    await sweepEach(r, unlisted, T0, T0);
    expect(stallMail(r.coord), 'the absent clock starts at T0, inside its grace').toEqual([]);
    plant(r.home, BAD);
    await sweepEach(r, await tickRead(r), T0 + STALL_SWEEP_MS, END);
    expect(stallMail(r.coord), 'nothing while refused').toEqual([]);
    expect(stallRows(r.coord, runId), 'and no stall: row while refused').toEqual([]);
    const after = await unlist(r);
    // U to U + DEAD_GRACE_MS − STALL_SWEEP_MS (T0 + 72 min): absent again, inside the grace of the re-unlisting.
    await sweepEach(r, after, U, U + DEAD_GRACE_MS - STALL_SWEEP_MS);
    expect(stallMail(r.coord), 'no dead notice at once after the re-unlisting: the refused stretch is no absence').toEqual([]);
    expect(stallRows(r.coord, runId), 'and no stall: row').toEqual([]);
    // CONTROL, U + DEAD_GRACE_MS (T0 + 73 min): the dead notice arrives, its span counted from the re-unlisting.
    await sweepEach(r, after, U + DEAD_GRACE_MS, U + DEAD_GRACE_MS);
    const mail = stallMail(r.coord);
    expect(mail.map((m) => m.toId)).toEqual([COORD]);
    expect(mail[0]!.subject).toContain(`registry row absent for ${spanOf(DEAD_GRACE_MS)}`);
    expect(stallRows(r.coord, runId).map((d) => parseStallDetail(d))).toMatchObject([{ mode: 'live', arm: 'dead', rung: 1 }]);
    expect(r.sent, 'a dead report goes to the coordinator, never a push').toEqual([]);
  }, 60_000);

  // (E') the same for the marker clock, whose subject is a worker or a claimant: the malformed marker is read at T0 off
  // an unlisted id (`uuid: null`), so the clock starts; the refused stretch drops it; the push waits
  // MARKER_UNREADABLE_MS from U (T0 + 63 min), so it comes at U + MARKER_UNREADABLE_MS (T0 + 123 min), not at U.
  it.each([
    { role: 'worker', sessionId: BAD, claimedBy: COORD },
    { role: 'claimant', sessionId: GOOD, claimedBy: BAD },
  ])("(E') the marker clock is dropped by a refused stretch: the $role id unlisted with a malformed .turn.json, then refused past MARKER_UNREADABLE_MS, then unlisted again, the push comes MARKER_UNREADABLE_MS after the re-unlisting", async ({ sessionId, claimedBy }) => {
    const r = await rig();
    plant(r.home, GOOD);
    for (const m of ARMS) writeFileSync(path.join(r.reg, m), '');
    writeFileSync(path.join(r.reg, `${BAD}.turn.json`), '{ not json');
    storedRun(r.coord, { state: 'working', sessionId, claimedBy });
    const unlisted = await unlist(r, [`${BAD}.turn.json`]);
    await sweepEach(r, unlisted, T0, T0);
    expect(markerPushes(r), 'the marker clock starts at T0, inside its window').toEqual([]);
    plant(r.home, BAD);
    await sweepEach(r, await tickRead(r), T0 + STALL_SWEEP_MS, END);
    expect(markerPushes(r), 'nothing while refused').toEqual([]);
    const after = await unlist(r, [`${BAD}.turn.json`]);
    // U to U + MARKER_UNREADABLE_MS − STALL_SWEEP_MS (T0 + 122 min): the marker reads malformed, inside the new window.
    await sweepEach(r, after, U, U + MARKER_UNREADABLE_MS - STALL_SWEEP_MS);
    expect(markerPushes(r), 'no marker-unreadable push at once after the re-unlisting: the refused stretch read no marker').toEqual([]);
    // CONTROL, U + MARKER_UNREADABLE_MS (T0 + 123 min): the push arrives, so the marker clock restarted at U.
    await sweepEach(r, after, U + MARKER_UNREADABLE_MS, U + MARKER_UNREADABLE_MS);
    expect(markerPushes(r)).toHaveLength(1);
  }, 60_000);
});

describe('the claim lease lanes hold a claim whose holder is a listed-but-refused id (tick-lanes-hold-a-refused-id)', () => {
  /** A LEGACY active claim held by `sessionId`: made through the store, as a claim made before the id gate was (the
   *  claims route's `requireAttribution` now refuses such an id, so only such a claim can be held by one). */
  const legacyClaim = (coord: CoordStore, sessionId: string, now: number): { id: number } => {
    const res = coord.claimAttempt({
      project: 'demo', paths: ['server/src/io.ts'], sessionId, uuid: 'u-legacy', runId: null, intent: 'a legacy claim', now,
    });
    if (!res.ok) throw new Error(`fixture claim refused: ${JSON.stringify(res)}`);
    return res.claims[0]!;
  };
  /** The tick's `sessions`, as the claim lanes read them: the valid row, running. `--actor` is in none. */
  const SESSIONS: readonly Pick<FleetSession, 'id' | 'status' | 'unmeasured'>[] = [{ id: GOOD, status: 'idle', unmeasured: [] }];
  const rowOf = (coord: CoordStore, id: number) => {
    const row = coord.claimsForProject('demo', true).find((c) => c.id === id);
    if (row === undefined) throw new Error('fixture: the claim row is gone');
    return { state: row.state, endedBy: row.endedBy, expiresAt: row.expiresAt };
  };

  it('(C) past CLAIM_LEASE_MS, a legacy active claim held by --actor is renewed, never lapsed session-gone', async () => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    at(T0);
    const c = legacyClaim(r.coord, BAD, T0);
    const read = await tickRead(r);
    at(T0 + CLAIM_LEASE_MS + 1);
    r.w.renewClaims(SESSIONS, read.refused);
    r.w.lapseClaims(SESSIONS, read.refused);
    expect(rowOf(r.coord, c.id)).toEqual({ state: 'live', endedBy: null, expiresAt: T0 + CLAIM_LEASE_MS + 1 + CLAIM_LEASE_MS });
  });

  it('(C) renewed on doubt every sweep, it still lapses at the 8 h hard cap, never before it', async () => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    at(T0);
    const c = legacyClaim(r.coord, BAD, T0);
    const read = await tickRead(r);
    for (let t = T0 + 30 * 60_000; t < T0 + CLAIM_HARD_CAP_MS; t += 30 * 60_000) {
      at(t);
      r.w.renewClaims(SESSIONS, read.refused);
      r.w.lapseClaims(SESSIONS, read.refused);
      expect(rowOf(r.coord, c.id).state, `still held at +${(t - T0) / 60_000} min`).toBe('live');
    }
    at(T0 + CLAIM_HARD_CAP_MS + 1);
    r.w.renewClaims(SESSIONS, read.refused);
    r.w.lapseClaims(SESSIONS, read.refused);
    expect(rowOf(r.coord, c.id)).toMatchObject({ state: 'lapsed', endedBy: 'hard-cap' });
  });
});

describe("the divergence census leaves a listed-but-refused id out of rule 3's open-run side (tick-lanes-hold-a-refused-id)", () => {
  /** A non-registry id with NO listed row: not refused, so it still reads as carrying no hold (carried, unchanged:
   *  `unlisted-non-registry-id-reads-absent-on-the-tick`). */
  const UNLISTED = '--unlisted';

  it('(D) an open run whose stored worker is --actor reports no claim-divergence', async () => {
    const r = await rig();
    plant(r.home, GOOD);
    plant(r.home, BAD);
    at(T0);
    storedRun(r.coord, { state: 'working', sessionId: BAD, claimedBy: COORD });
    // CONTROLS: an open run on the valid row, which carries no hold, and one on an unlisted id are both named, so the
    // census reached rule 3's open-run side on this very sweep.
    storedRun(r.coord, { state: 'working', sessionId: GOOD, claimedBy: COORD });
    storedRun(r.coord, { state: 'working', sessionId: UNLISTED, claimedBy: COORD });
    const read = await tickRead(r);
    const frames: Divergence[][] = [];
    r.bus.on('divergence', (d: Divergence[]) => frames.push(d));
    await r.w.sweepDivergences(read.records, read.refused);
    const named = (frames.at(-1) ?? []).filter((d) => d.kind === 'claim-divergence').map((d) => d.id).sort();
    expect(named).toEqual([UNLISTED, GOOD].sort());
  });
});
