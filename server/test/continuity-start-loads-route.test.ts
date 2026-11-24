// Overlord W1 sandbox, Task 5 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`; spec §3.6 H4, Table 11.1e):
// `POST /api/sessions/:id/start/loads`, the hook's loads report. The box token first, then the path's session is the sender,
// then `startLoadsOf` (the body's one narrowing, `bad-request` naming the field), then the registry's attribution of the
// sender, then `insertStartLoads`, which finds the start the `reportId` names (`unknown-start`, 404) and keeps the first body.
// The read side (`startLoadsOfNewestStart`, `startLoadsRowOf`) is pinned here too. Fixture HOMEs only.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import * as startLoadsModule from '../src/continuity/startLoads.js';
import { startLoadsRowOf } from '../src/continuity/startLoads.js';
import { UNMEASURED as SERVER_UNMEASURED } from '../src/unmeasured.js';
import { UNMEASURED as L0_UNMEASURED } from '../../shared/overlord-sandbox.js';
import { FAKE_T0 } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { goodLoads, startLoadsCases } from './sim/startLoadsSets.js';
import { expectedSurfaceOf } from '../src/continuity/sandboxCheck.js';
import { settleLoads, type SandboxSettlePort, type SettleOutcome } from '../src/continuity/routes.js';
import { BUILD, FIXTURE_OWN_LISTS } from './sim/sandboxSets.js';
import type { OverlordAuthorityJournal } from '../src/coord/overlordAuthorityJournal.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { KEEP_AWAKE_CAP, POOL_SET_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import type { FleetState } from '../src/fleetstate.js';

const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
/** The stop the drain composes for the Overlord's body: one call, naming that session alone. */
const STOP_OV = ['stop', 'lane-a-overlord'];

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
beforeEach(() => { home = mkTmp('ccrc-loads-route-'); seedRow(home, ID, { uuid: UUID, project: 'project-a' }); });
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});
// Migrating a fresh coord.db per case is slow under load: migrate ONE, keep its bytes (closed, so the WAL is folded in; the
// teardown removes every fixture directory after each case), and write them into each case's HOME before the server opens it.
let template: Buffer = Buffer.alloc(0);
beforeAll(() => { const f = path.join(mkTmp('ccrc-loads-template-'), 'coord.db'); openCoordDb(f).close(); template = readFileSync(f); });
const migrated = (): void => { mkdirSync(path.join(home, '.ccrc'), { recursive: true }); writeFileSync(path.join(home, '.ccrc', 'coord.db'), template); };
const open = async (): Promise<FastifyInstance> => {
  migrated();
  const r = await appFor(home, recorder().run, {});
  coord = r.coord;
  await r.app.ready();
  return r.app;
};
const start = (a: FastifyInstance, reportId = 'r-0001-abcd', source = 'startup', reportedAt = FAKE_T0 - 50) => a.inject({
  method: 'POST', url: `/api/sessions/${ID}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
  payload: { fromId: ID, fromUuid: UUID, reportId, source, reportedAt },
});
const post = (a: FastifyInstance, b: unknown, id = ID, token: string | null = ID_GATE_TOKEN) => a.inject({
  method: 'POST', url: `/api/sessions/${id}/start/loads`, payload: b as never,
  headers: token === null ? {} : { 'x-ccrc-mail-token': token },
});
const rows = (): Record<string, unknown>[] => coord!.db.prepare('SELECT * FROM continuity_start_loads ORDER BY startId').all() as Record<string, unknown>[];

describe('startLoadsOf: the body\'s one narrowing (Task 5)', () => {
  for (const [name, run] of Object.entries(startLoadsCases(startLoadsModule))) it(name, run);
});

describe('POST /api/sessions/:id/start/loads', () => {
  it('records the first body as sent (202, fresh), joined to its start, unmeasured kept as a word', async () => {
    app = await open();
    expect((await start(app)).statusCode).toBe(202);
    const res = await post(app, goodLoads({}, { agents: 'unmeasured' }));
    expect([res.statusCode, res.json()]).toEqual([202, { ok: true, startId: 1, fresh: true }]);
    const [r] = rows();
    expect(r).toMatchObject({ startId: 1, profileRole: 'overlord', profileDigest: 'a'.repeat(64), launchRc: 'off', claudeVersion: '2.1.325',
      permissionMode: 'bypassPermissions', cwdInWorkspace: 1, carriedFrom: null, conflicted: 0, reportedAt: 1000, receivedAt: FAKE_T0 });
    expect(JSON.parse(r!['loaded'] as string).agents).toBe('unmeasured');
  });
  it('a resend of the same bytes, or the same body at another reportedAt, answers fresh: false and is no conflict', async () => {
    app = await open();
    await start(app);
    await post(app, goodLoads());
    for (const b of [goodLoads(), goodLoads({ reportedAt: 5000 })]) {
      const res = await post(app, b);
      expect([res.statusCode, res.json()]).toEqual([202, { ok: true, startId: 1, fresh: false }]);
    }
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!['conflicted']).toBe(0);
  });
  it('a second body that differs sets conflicted and keeps the first', async () => {
    app = await open();
    await start(app);
    await post(app, goodLoads());
    const res = await post(app, goodLoads({}, { skills: ['ccrc-overlord', 'other'] }));
    expect([res.statusCode, res.json()]).toEqual([202, { ok: true, startId: 1, fresh: false }]);
    expect(rows()[0]).toMatchObject({ conflicted: 1 });
    expect(JSON.parse(rows()[0]!['loaded'] as string).skills).toStrictEqual(['ccrc-overlord']);
  });
  it('refuses in order: the token, the sender, the body, the attribution, then a start nobody recorded', async () => {
    app = await open();
    await start(app);
    expect((await post(app, goodLoads(), ID, null)).statusCode).toBe(401);
    const notOwner = await post(app, goodLoads({ fromId: 'lane-b-project-a' }));
    expect([notOwner.statusCode, notOwner.json().error]).toEqual([403, 'not-owner']);
    const bad = await post(app, goodLoads({ profileDigest: 'x' }));
    expect([bad.statusCode, bad.json().error, bad.json().detail]).toEqual([400, 'bad-request', 'profileDigest']);
    const stale = await post(app, goodLoads({ fromUuid: '99999999-2222-3333-4444-555555555555' }));
    expect(stale.json().error).toBe('stale-uuid');
    const unknown = await post(app, goodLoads({ reportId: 'r-9999-zzzz' }));
    expect([unknown.statusCode, unknown.json().error]).toEqual([404, 'unknown-start']);
    expect(rows()).toStrictEqual([]);
  });
  it('a report naming a clear or compact start is unknown-start: only a startup or resume start takes one (review 2135 nit)', async () => {
    app = await open();
    for (const [rid, source] of [['r-0005-abcd', 'clear'], ['r-0006-abcd', 'compact']] as const) {
      await start(app, rid, source, FAKE_T0 - 5);
      const res = await post(app, goodLoads({ reportId: rid }));
      expect([res.statusCode, res.json().error], source).toEqual([404, 'unknown-start']);
    }
    expect(rows()).toStrictEqual([]);
  });
  it('the L0 word and the server\'s are one word (the second spelling\'s reason, review 2135 nit)', () => {
    expect(L0_UNMEASURED).toBe(SERVER_UNMEASURED);
  });
  it('a report for another session\'s start is unknown-start: the join is by this session\'s own start', async () => {
    app = await open();
    await start(app);
    seedRow(home, 'lane-b-project-a', { uuid: '22222222-2222-3333-4444-555555555555', project: 'project-a' });
    const res = await post(app, goodLoads({ fromId: 'lane-b-project-a', fromUuid: '22222222-2222-3333-4444-555555555555' }), 'lane-b-project-a');
    expect([res.statusCode, res.json().error]).toEqual([404, 'unknown-start']);
  });
});

describe('the read side (Task 5)', () => {
  it('startLoadsOfNewestStart answers a newer start with a null report over an older start\'s held report', async () => {
    app = await open();
    await start(app, 'r-0001-abcd', 'startup', FAKE_T0 - 100);
    await post(app, goodLoads());
    expect(coord!.startLoadsOfNewestStart(ID)).toMatchObject({ ok: true, newest: { start: { reportId: 'r-0001-abcd' }, report: { startId: 1 } } });
    await start(app, 'r-0002-abcd', 'resume', FAKE_T0 - 10);
    const r = coord!.startLoadsOfNewestStart(ID);
    expect(r).toMatchObject({ ok: true, newest: { start: { reportId: 'r-0002-abcd', source: 'resume' }, report: null } });
  });
  it('a clear or compact start is never the newest: only startup and resume are read; no start reads null', async () => {
    app = await open();
    expect(coord!.startLoadsOfNewestStart(ID)).toStrictEqual({ ok: true, newest: null });
    await start(app, 'r-0001-abcd', 'startup', FAKE_T0 - 100);
    await start(app, 'r-0003-abcd', 'clear', FAKE_T0 - 5);
    expect(coord!.startLoadsOfNewestStart(ID)).toMatchObject({ ok: true, newest: { start: { reportId: 'r-0001-abcd' } } });
  });
  it('startLoadsRowOf reads an unknown stored kind, a malformed value or an unparsable column as unmeasured', () => {
    const base = { startId: 1, profileRole: 'overlord', profileDigest: 'a'.repeat(64), launchRc: 'off', claudeVersion: '2.1.325',
      permissionMode: 'bypassPermissions', cwdInWorkspace: 1, carriedFrom: null, conflicted: 0 };
    const r = startLoadsRowOf({ ...base, loaded: JSON.stringify({ skills: ['a'], agents: 'nonsense', futureKind: ['x'] }) });
    expect(r.loaded).toStrictEqual({ instructions: 'unmeasured', hooks: 'unmeasured', skills: ['a'], agents: 'unmeasured',
      tools: 'unmeasured', toolServers: 'unmeasured' });
    expect(startLoadsRowOf({ ...base, loaded: '{not json', launchRc: 'sideways', conflicted: 1 })).toMatchObject({
      launchRc: null, conflicted: true, loaded: { skills: 'unmeasured' } });
  });
});

// ── The settle step (W1 sandbox PR B, Task 9; spec §3.2 C2): the first report of a pending designation decides it ──────────
// Each case waits on the settle's own completion signal (`overlordSandbox.settled`, review 3325 F6), which names the act it
// decided, so a case that expects nothing proves the settle ran and decided `none`. The positive surface is an isolated
// fixture build and its own lists (F4); the release's table lists no build.
describe('the settle step at the loads door (Task 9)', { timeout: 90_000 }, () => {
  const OV = 'lane-a-overlord';
  const OV_UUID = '22222222-3333-4444-5555-666666666666';
  const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
  const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
    .operator(gateActorOf('operator-a', '0123456789abcdef'));
  const e = expectedSurfaceOf('overlord', FIXTURE_OWN_LISTS)!;
  let calls: string[][];
  let journalRefuses = false;
  let stopThrows = false;
  let waiting: ((o: SettleOutcome) => void)[] = [];
  const journal = { appendInTx: () => (journalRefuses ? { ok: false, error: 'authority-rolled-back', detail: 'refused for the test' }
    : { ok: true, kind: 'appended', record: { sequence: 1 } }) } as unknown as OverlordAuthorityJournal;
  const openOv = async (): Promise<FastifyInstance> => {
    migrated();
    seedRow(home, OV, { uuid: OV_UUID, project: 'overlord' });
    const rec = recorder();
    calls = rec.calls;
    // keep-awake answers its `released <id>` line, so the drain clears the set and the profile digest before the stop.
    const run: typeof rec.run = async (cmd, args) => {
      if (args[0] === 'keep-awake') { rec.calls.push([...args]); return { ran: true, code: 0, stdout: `released ${args[2]}\n`, stderr: '' }; }
      if (args[0] === 'stop' && stopThrows) { rec.calls.push([...args]); throw new Error('the stop threw for the test'); }
      return rec.run(cmd, args);
    };
    const r = await appFor(home, run, { overlordAuthority: journal,
      fleetState: { ccdVerbs: [ROUTE_CAP, KEEP_AWAKE_CAP, POOL_SET_CAP] } as unknown as FleetState,
      overlordSandbox: { ownLists: FIXTURE_OWN_LISTS, settled: (o) => { waiting.shift()?.(o); } } });
    coord = r.coord;
    await r.app.ready();
    return r.app;
  };
  const pend = (): void => {
    expect(coord!.designatePending(journal, { sessionId: OV, deadlineAt: FAKE_T0 + 600_000, model: 'opus', accountPools: { pools: [], untagged: true },
      actor: OPERATOR, at: FAKE_T0 - 1000, opKey: 'designate-settle' }).ok).toBe(true);
    expect(coord!.bindPendingGeneration(OV, GEN, FAKE_T0 - 900).ok).toBe(true);
  };
  const startAs = (a: FastifyInstance, sid: string, uuid: string, reportId: string, source = 'startup', gen = GEN) => a.inject({
    method: 'POST', url: `/api/sessions/${sid}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
    payload: { fromId: sid, fromUuid: uuid, reportId, source, reportedAt: FAKE_T0 - 50, rowIncarnation: gen },
  });
  const startOv = (a: FastifyInstance, reportId = 'r-ov1-abcd', source = 'startup') => startAs(a, OV, OV_UUID, reportId, source);
  const loads = (over: Record<string, unknown> = {}, reportId = 'r-ov1-abcd') => ({
    fromId: OV, fromUuid: OV_UUID, reportId, profileRole: 'overlord', profileDigest: e.digest, launchRc: 'off', claudeVersion: BUILD,
    permissionMode: 'bypassPermissions', cwdInWorkspace: true, reportedAt: FAKE_T0 - 40,
    loaded: { instructions: [{ type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: e.constitutionSha256 }], hooks: [e.hookSha256],
      skills: ['ccrc-overlord'], agents: ['Explore', 'overlord-reader'], tools: ['Agent', 'Skill', 'mcp__door__read'], toolServers: ['door'] },
    ...over,
  });
  /** Posts a loads report and waits for the settle the door queued after its 202: the outcome it reports. */
  const report = async (a: FastifyInstance, body: unknown, id = OV): Promise<SettleOutcome> => {
    const done = new Promise<SettleOutcome>((res) => { waiting.push(res); });
    const r = await post(a, body, id);
    expect(r.statusCode, r.body).toBe(202);
    return done;
  };
  const view = () => { const d = coord!.designationRead(); if (d.kind === 'unmeasured') throw new Error(d.why); return d; };
  const stops = () => calls.filter((c) => c[0] === 'stop');
  beforeEach(() => { journalRefuses = false; stopThrows = false; waiting = []; });

  it('go-live: a held first report binds the pending session, once', async () => {
    app = await openOv(); pend();
    await startOv(app);
    expect(await report(app, loads())).toStrictEqual({ sessionId: OV, startId: 1, act: 'go-live' });
    expect(view()).toMatchObject({ kind: 'designated', sessionId: OV });
    const term = view().kind === 'designated' ? (view() as { term: number }).term : -1;
    expect((await report(app, loads())).act).toBe('none');
    expect(view()).toMatchObject({ kind: 'designated', sessionId: OV, term });
    expect(stops()).toStrictEqual([]);
  });

  it('fail-pending: an unheld report records overlord-sandbox-unmet, clears profiledigest and stops that one session', async () => {
    app = await openOv(); pend();
    await startOv(app);
    expect((await report(app, loads({ launchRc: 'on' }))).act).toBe('fail-pending');
    const d = view();
    expect(d.kind).toBe('not-designated');
    expect(d.kind === 'not-designated' && d.row?.pending).toBeNull();
    expect(d.kind === 'not-designated' && d.row?.lastAttempt).toMatchObject({ sessionId: OV, outcome: 'overlord-sandbox-unmet' });
    expect(d.kind === 'not-designated' && d.row?.stopsOwed).toStrictEqual([]);
    expect(calls.some((c) => c.join(' ').includes('profiledigest=') && c.join(' ').includes(OV)), JSON.stringify(calls)).toBe(true);
    expect(stops(), JSON.stringify(calls)).toStrictEqual([STOP_OV]);
  });

  it('a stop that throws keeps the failure record, leaves the stop owed and logs it', async () => {
    app = await openOv(); pend();
    await startOv(app);
    stopThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await report(app, loads({ launchRc: 'on' }))).act).toBe('fail-pending');
      const d = view();
      expect(d.kind === 'not-designated' && d.row?.lastAttempt).toMatchObject({ sessionId: OV, outcome: 'overlord-sandbox-unmet' });
      expect(d.kind === 'not-designated' && d.row?.stopsOwed).toStrictEqual([OV]);
      expect(stops()).toStrictEqual([STOP_OV]);
      expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes(OV) && l.includes('stays owed')), JSON.stringify(warn.mock.calls)).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it('an unreadable designation writes nothing and stops nothing', async () => {
    app = await openOv(); pend();
    await startOv(app);
    coord!.db.prepare("UPDATE overlord_designation SET stopsOwed = 'not json' WHERE id = 1").run();
    expect(coord!.designationRead().kind).toBe('unmeasured');
    const before = JSON.stringify(coord!.db.prepare('SELECT * FROM overlord_designation').all());
    expect((await report(app, loads({ launchRc: 'on' }))).act).toBe('unread');
    expect(JSON.stringify(coord!.db.prepare('SELECT * FROM overlord_designation').all())).toBe(before);
    expect(calls).toStrictEqual([]);
  });

  const HELD_OR_FAILED = [['held', {}], ['failed', { launchRc: 'on' }]] as const;

  for (const [which, over] of HELD_OR_FAILED) {
    it(`a ${which} report for a start older than one with its own stored report settles nothing (review 3346 F2)`, async () => {
      app = await openOv();
      await startOv(app, 'r-ov1-abcd');
      await startOv(app, 'r-ov2-abcd', 'resume');
      expect((await report(app, loads({}, 'r-ov2-abcd'))).act).toBe('none');
      pend();
      expect(coord!.startLoadsOfNewestStart(OV)).toMatchObject({ ok: true, newest: { start: { id: 2 }, report: { startId: 2 } } });
      expect(await report(app, loads(over, 'r-ov1-abcd'))).toStrictEqual({ sessionId: OV, startId: 1, act: 'none' });
      expect(view().kind === 'not-designated' && view().row?.pending?.sessionId).toBe(OV);
      expect(calls).toStrictEqual([]);
    });

    it(`another session's ${which} report settles nothing (review 3346 F10)`, async () => {
      app = await openOv(); pend();
      await startOv(app);
      seedRow(home, ID, { uuid: UUID, project: 'overlord' });
      await startAs(app, ID, UUID, 'r-pa1-abcd');
      expect(await report(app, { ...loads(over, 'r-pa1-abcd'), fromId: ID, fromUuid: UUID }, ID)).toMatchObject({ sessionId: ID, act: 'none' });
      expect(view().kind === 'not-designated' && view().row?.pending?.sessionId).toBe(OV);
      expect(calls).toStrictEqual([]);
    });
  }

  it('a report for an older start when the newest has no report yet is no-report, told apart from a stale start', async () => {
    app = await openOv(); pend();
    await startOv(app, 'r-ov1-abcd');
    await startOv(app, 'r-ov2-abcd', 'resume');
    expect((await report(app, loads({ launchRc: 'on' }, 'r-ov1-abcd'))).act).toBe('no-report');
    expect(view().kind === 'not-designated' && view().row?.pending?.sessionId).toBe(OV);
    expect(calls).toStrictEqual([]);
  });

  it('a go-live the authority journal refuses leaves the attempt pending and stops nothing', async () => {
    app = await openOv(); pend();
    await startOv(app);
    journalRefuses = true;
    expect((await report(app, loads())).act).toBe('refused');
    expect(view().kind === 'not-designated' && view().row?.pending?.sessionId).toBe(OV);
    expect(calls).toStrictEqual([]);
  });

  it('with no pending designation the report only records', async () => {
    app = await openOv();
    await startOv(app);
    expect((await report(app, loads({ launchRc: 'on' }))).act).toBe('none');
    expect(view()).toMatchObject({ kind: 'not-designated', row: null });
    expect(calls).toStrictEqual([]);
    expect(rows()).toHaveLength(1);
  });

  it('the carry the read answers: none, absent, or the carried start with its report', async () => {
    app = await openOv();
    await startOv(app, 'r-ov1-abcd');
    await report(app, loads());
    await startOv(app, 'r-ov2-abcd', 'resume');
    await report(app, loads({ carriedFrom: 'r-ov1-abcd' }, 'r-ov2-abcd'));
    const n = coord!.startLoadsOfNewestStart(OV);
    expect(n).toMatchObject({ ok: true, newest: { carry: { kind: 'read', source: 'startup', report: { profileDigest: e.digest, claudeVersion: BUILD, conflicted: false } } } });
    await startOv(app, 'r-ov3-abcd', 'resume');
    await report(app, loads({ carriedFrom: 'r-nosuch-ab' }, 'r-ov3-abcd'));
    expect(coord!.startLoadsOfNewestStart(OV)).toMatchObject({ ok: true, newest: { carry: { kind: 'absent' } } });
    await startOv(app, 'r-ov4-abcd', 'resume');
    await report(app, loads({}, 'r-ov4-abcd'));
    expect(coord!.startLoadsOfNewestStart(OV)).toMatchObject({ ok: true, newest: { carry: { kind: 'none' } } });
  });

  // ── A re-run from the stored report (review 3325 F2, ruled in fix round 1; review 3346 F1-F3, F10, F11, F13). A 202 clears
  // the hook's spool, so nothing resends an answered report; a settle lost after the answer is re-run by designation B's
  // deadline sweep, which is not in this tree. These cases call the one settle path directly over the stored evidence, with
  // the store's own writers or stub ports and a recorded drain, so recovery is pinned at the function, not end to end.
  describe('a re-run of the settle from the stored report (the sweep is designation B\'s)', () => {
    let drained: [string, boolean][];
    let wsAsked: number;
    const portOf = (over: Partial<SandboxSettlePort> = {}): SandboxSettlePort => ({
      serial: (fn) => fn(), expected: () => e, read: () => coord!.designationRead(),
      goLive: (id, g, at) => { const r = coord!.goLive(journal, id, g, at); return r.ok ? { ok: true } : { ok: false, detail: r.detail }; },
      failPending: (id, at) => coord!.failPending(id, 'overlord-sandbox-unmet', at, true),
      drain: async (id, unrecorded) => { drained.push([id, unrecorded]); },
      workspaceOf: async () => { wsAsked += 1; return { kind: 'measured', project: 'overlord' }; }, ...over,
    });
    const rerun = (id = OV, startId = 1, port = portOf()) => settleLoads(port, coord!, id, startId, () => FAKE_T0);
    /** The server with no settle wired: the loads door answers 202 and records, and no settle runs (one lost after the answer). */
    const openLost = async (): Promise<FastifyInstance> => {
      migrated();
      seedRow(home, OV, { uuid: OV_UUID, project: 'overlord' });
      const rec = recorder();
      calls = rec.calls;
      const r = await appFor(home, rec.run, {});
      coord = r.coord;
      await r.app.ready();
      return r.app;
    };
    /** Stores a loads body through the door: a 202, and nothing settled (review 3346 F11). */
    const store = async (a: FastifyInstance, body: unknown, id = OV): Promise<void> => {
      const r = await post(a, body, id);
      expect(r.statusCode, r.body).toBe(202);
    };
    const pendingId = () => { const d = view(); return d.kind === 'not-designated' ? d.row?.pending?.sessionId ?? null : null; };
    beforeEach(() => { drained = []; wsAsked = 0; });

    it('an accepted report survives a lost settle without a resend; the re-run goes live once, and a duplicate does nothing', async () => {
      app = await openLost(); pend();
      await startOv(app);
      await store(app, loads());
      expect(pendingId()).toBe(OV);
      expect(coord!.startLoadsOfNewestStart(OV)).toMatchObject({ ok: true, newest: { start: { id: 1 }, report: { startId: 1 } } });
      expect(await rerun()).toStrictEqual({ sessionId: OV, startId: 1, act: 'go-live' });
      expect(view()).toMatchObject({ kind: 'designated', sessionId: OV });
      expect(await rerun()).toMatchObject({ act: 'none' });
      expect(view()).toMatchObject({ kind: 'designated', sessionId: OV });
      expect(drained).toStrictEqual([]);
      expect(calls).toStrictEqual([]);
    });

    it('a stored failed report takes the same fail-pending and drain on the re-run, once', async () => {
      app = await openLost(); pend();
      await startOv(app);
      await store(app, loads({ launchRc: 'on' }));
      expect(await rerun()).toMatchObject({ act: 'fail-pending' });
      expect(view().kind === 'not-designated' && view().row?.lastAttempt).toMatchObject({ sessionId: OV, outcome: 'overlord-sandbox-unmet' });
      expect(drained).toStrictEqual([[OV, false]]);
      expect(await rerun()).toMatchObject({ act: 'none' });
      expect(drained).toStrictEqual([[OV, false]]);
    });

    for (const [which, over] of HELD_OR_FAILED) {
      it(`a stale start whose newer start has its own ${which} report decides nothing; a newest start with no report is no-report`, async () => {
        app = await openLost(); pend();
        await startOv(app, 'r-ov1-abcd');
        await store(app, loads(over));
        await startOv(app, 'r-ov2-abcd', 'resume');
        expect(await rerun(OV, 2)).toMatchObject({ act: 'no-report' });
        await store(app, loads(over, 'r-ov2-abcd'));
        expect(await rerun(OV, 1)).toMatchObject({ act: 'none' });
        expect(pendingId()).toBe(OV);
        expect(drained).toStrictEqual([]);
      });

      it(`another session's ${which} report, and a ${which} report of another generation, decide nothing`, async () => {
        app = await openLost(); pend();
        seedRow(home, ID, { uuid: UUID, project: 'overlord' });
        await startAs(app, ID, UUID, 'r-pa1-abcd');
        await store(app, { ...loads(over, 'r-pa1-abcd'), fromId: ID, fromUuid: UUID }, ID);
        expect(await rerun(ID, 1)).toMatchObject({ sessionId: ID, act: 'none' });
        await startAs(app, OV, OV_UUID, 'r-ov1-abcd', 'startup', '0189abcd-1234-5678-9abc-0123456789ff');
        await store(app, loads(over));
        expect(await rerun(OV, 2)).toMatchObject({ act: 'none' });
        expect(pendingId()).toBe(OV);
        expect(drained).toStrictEqual([]);
      });
    }

    it('missing or unmeasured facts never go live: an unreadable read is unread, an unmeasured workspace fails the attempt', async () => {
      app = await openLost(); pend();
      await startOv(app);
      await store(app, loads());
      expect(await rerun(OV, 1, portOf({ read: () => ({ kind: 'unmeasured', why: 'locked' }) }))).toMatchObject({ act: 'unread' });
      expect(await rerun(OV, 1, portOf({ expected: () => null }))).toMatchObject({ act: 'unread' });
      const noRead = { startLoadsOfNewestStart: () => ({ ok: false, detail: 'locked' }) } as unknown as CoordStore;
      expect(await settleLoads(portOf(), noRead, OV, 1, () => FAKE_T0)).toMatchObject({ act: 'unread' });
      expect(pendingId()).toBe(OV);
      expect(await rerun(OV, 1, portOf({ workspaceOf: async () => ({ kind: 'unmeasured', reason: 'registry' }) }))).toMatchObject({ act: 'fail-pending' });
      expect(view().kind).toBe('not-designated');
      expect(drained).toStrictEqual([[OV, false]]);
    });

    // ── review 3346 F1: a failed check whose record cannot be written still stops the measured body, unrecorded ──────────
    describe('a failed check whose record is refused, throws or is a no-op (review 3346 F1)', () => {
      const failing = async (): Promise<void> => {
        app = await openLost(); pend();
        seedRow(home, ID, { uuid: UUID, project: 'overlord' });
        await startOv(app);
        await store(app, loads({ launchRc: 'on' }));
      };
      let warn: ReturnType<typeof vi.spyOn>;
      beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
      afterEach(() => { warn.mockRestore(); });
      const warned = (frag: string) => warn.mock.calls.map((c: unknown[]) => String(c[0])).some((l: string) => l.includes(frag));

      it('a refused record stops exactly the attempted body through the drain as unrecorded, and says so', async () => {
        await failing();
        expect(await rerun(OV, 1, portOf({ failPending: () => ({ ok: false }) }))).toMatchObject({ act: 'fail-refused' });
        expect(drained).toStrictEqual([[OV, true]]);
        expect(pendingId()).toBe(OV);
        expect(warned('could not be recorded; stopping it unrecorded')).toBe(true);
      });

      it('a record that throws stops exactly the attempted body, unrecorded, and is told apart from a refusal', async () => {
        await failing();
        expect(await rerun(OV, 1, portOf({ failPending: () => { throw new Error('database is locked'); } }))).toMatchObject({ act: 'fail-threw' });
        expect(drained).toStrictEqual([[OV, true]]);
        expect(warned('database is locked')).toBe(true);
      });

      it('a no-op record (no longer pending) stops nothing: changed:false alone never authorises a stop', async () => {
        await failing();
        expect(await rerun(OV, 1, portOf({ failPending: () => ({ ok: true, changed: false }) }))).toMatchObject({ act: 'fail-noop' });
        expect(drained).toStrictEqual([]);
      });

      it('a recorded failure owes its stop and drains it as recorded', async () => {
        await failing();
        expect(await rerun()).toMatchObject({ act: 'fail-pending' });
        expect(drained).toStrictEqual([[OV, false]]);
      });

      it('a drain that throws after a refused record is logged, and the settle reports it threw', async () => {
        await failing();
        const r = await rerun(OV, 1, portOf({ failPending: () => ({ ok: false }), drain: async () => { throw new Error('the drain fell over'); } }));
        expect(r).toMatchObject({ act: 'threw' });
        expect(warned('the drain fell over')).toBe(true);
      });

      it('negative controls: another session\'s stored report, a start id the session never had and an unreadable designation never reach the write or the drain', async () => {
        await failing();
        let wrote = 0;
        const counting = portOf({ failPending: () => { wrote += 1; return { ok: false }; } });
        await startAs(app!, ID, UUID, 'r-pa1-abcd');
        await store(app!, { ...loads({ launchRc: 'on' }, 'r-pa1-abcd'), fromId: ID, fromUuid: UUID }, ID);
        expect(await rerun(ID, 2, counting)).toMatchObject({ act: 'none' });
        expect(await rerun(OV, 9, counting)).toMatchObject({ act: 'none' });
        expect(await rerun(OV, 1, portOf({ failPending: counting.failPending, read: () => ({ kind: 'unmeasured', why: 'x' }) }))).toMatchObject({ act: 'unread' });
        expect(wrote).toBe(0);
        expect(drained).toStrictEqual([]);
      });
    });

    // ── review 3346 F3: evidence that changes during the registry read is obsolete ──────────────────────────────────────
    it('a newer start with its report landing during the registry read leaves the obsolete snapshot unsettled', async () => {
      app = await openLost(); pend();
      await startOv(app);
      await store(app, loads({ launchRc: 'on' }));
      const r = await rerun(OV, 1, portOf({ workspaceOf: async () => {
        await startOv(app!, 'r-ov2-abcd', 'resume');
        await store(app!, loads({}, 'r-ov2-abcd'));
        return { kind: 'measured', project: 'overlord' };
      } }));
      expect(r).toMatchObject({ act: 'stale' });
      expect(pendingId()).toBe(OV);
      expect(drained).toStrictEqual([]);
    });

    it('a second, different body for the same start landing during the registry read leaves it unsettled', async () => {
      app = await openLost(); pend();
      await startOv(app);
      await store(app, loads());
      const r = await rerun(OV, 1, portOf({ workspaceOf: async () => {
        await store(app!, loads({ launchRc: 'on' }));
        return { kind: 'measured', project: 'overlord' };
      } }));
      expect(r).toMatchObject({ act: 'stale' });
      expect(pendingId()).toBe(OV);
      expect(coord!.startLoadsOfNewestStart(OV)).toMatchObject({ ok: true, newest: { report: { conflicted: true } } });
    });

    // ── review 3346 F13: the settle runs on the serialiser it is handed ─────────────────────────────────────────────────
    it('the settle waits on its serialiser: a step already holding it runs first, and the settle reads nothing until it ends', async () => {
      app = await openLost(); pend();
      await startOv(app);
      await store(app, loads());
      let tail: Promise<unknown> = Promise.resolve();
      const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const r = tail.then(fn); tail = r.then(() => undefined, () => undefined); return r; };
      let release!: () => void;
      const order: string[] = [];
      void serial(() => new Promise<void>((res) => { release = () => { order.push('holder'); res(); }; }));
      const p = rerun(OV, 1, portOf({ serial, read: () => { order.push('settle-read'); return coord!.designationRead(); } }));
      await new Promise((res) => setImmediate(res));
      expect(order).toStrictEqual([]);
      expect(wsAsked).toBe(0);
      release();
      expect(await p).toMatchObject({ act: 'go-live' });
      expect(order[0]).toBe('holder');
      expect(order.slice(1).every((x) => x === 'settle-read')).toBe(true);
    });
  });
});
