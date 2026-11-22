// testbox-sync-home, stale-tree-recovery-over-admin-lane (programme overlord, run 3211): a box whose installed tool sync
// predates `_tbt_home` (deploy/testbox/bin/tools-sync#@tbt-home) fails every release step with `HOME: unbound variable`, and
// cannot fetch the release that fixes it. The tool sync's call (`POST /api/testbox/tools-sync`, through
// `TestboxLane.toolsSync`) then asks the admin lane's `tools-home` first, which gives the box's tools unit a HOME, and sends
// the sync as before. The decision is the pure `toolsSyncNeedsHome` (L1); the lane only acts on it (L4).
//
// No box is touched: the fleet io and the admin ops port are fakes, and the ledger is a real coord.db in a temp directory.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { TestboxHostTools } from '../../shared/agent-protocol.js';
import { TESTBOX_PROTO, type StatusAnswer, type TestboxSync } from '../../shared/testbox.js';
import { TESTBOX_ADMIN_SUBS, type TestboxAdminStatus, type TestboxAdminSub } from '../../shared/testbox-admin.js';
import { actorOf } from '../src/accounts/audit.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import type { FleetIdentityCell } from '../src/fleetidentity.js';
import { localIOFor, type FleetIO, type MeasuredTestbox } from '../src/io.js';
import { testboxBlock, toolsSyncNeedsHome, type TestboxBlock } from '../src/testbox.js';
import type { FastifyRequest } from 'fastify';
import { toolsSyncCallerOf, type TestboxAdminOps, type TestboxAdminOutcome } from '../src/testboxAdmin.js';
import { TestboxAudit } from '../src/testboxAudit.js';
import { TestboxLane } from '../src/testboxLane.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const NODE = '0a17a17a-0000-4000-8000-0000000012c1';
const FP = `SHA256:${'A'.repeat(43)}`;
const SHA = 'a'.repeat(64);
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const HOST = { tools: TOOLS as TestboxHostTools, release: 'v0.0.901', measuredAt: '2026-11-21T11:59:59Z' };
/** What the box's driver records when its installed tool sync died at the release step for want of a HOME. */
const STALE: TestboxSync = {
  state: 'failed', detail: 'release: /opt/tools/release/installed/ccd/ccrc: line 103: HOME: unbound variable', at: '2026-11-21T11:00:00Z',
};
const boxWith = (sync: TestboxSync): StatusAnswer => ({
  t: 'status', state: 'degraded', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync, runs: { inProgress: 0, limit: 2 }, queueDepth: 0, pristine: [], failedKeys: [], heldRunUsers: [], repositories: [],
});
const measured = (sync: TestboxSync): MeasuredTestbox => ({ ok: true, reply: { host: HOST, pollMs: 30_000, box: { ok: true, status: boxWith(sync) } } });
const STATUS: TestboxAdminStatus = {
  v: 1, connected: true, addressSet: true, login: 'root', fingerprint: FP, hostKey: 'pinned', boxFileSha256: SHA, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: null, endedActs: [],
};
const NOT_CONNECTED: TestboxAdminStatus = { ...STATUS, connected: false, hostKey: 'none', fingerprint: null, boxFileSha256: null };
const blockOf = (sync: TestboxSync, admin: TestboxAdminStatus | null): TestboxBlock =>
  testboxBlock({ answer: measured(sync), listing: [], logs: [], now: NOW, admin });

describe('toolsSyncNeedsHome: the one decision (L1)', () => {
  it('is true for a connected box whose last sync failed at the release step with HOME unbound', () => {
    expect(toolsSyncNeedsHome(blockOf(STALE, STATUS))).toBe(true);
  });

  it.each([
    ['the sync is idle', { state: 'idle', detail: null, at: null }],
    ['the sync is running', { state: 'syncing', detail: 'release', at: STALE.at }],
    ['another tool failed', { ...STALE, detail: 'node: checksum mismatch' }],
    ['the release failed another way', { ...STALE, detail: 'release: the release could not be fetched or verified' }],
    ['another step names HOME', { ...STALE, detail: 'chrome: HOME: unbound variable' }],
  ] as const)('is false when %s', (_n, sync) => {
    expect(toolsSyncNeedsHome(blockOf(sync as TestboxSync, STATUS))).toBe(false);
  });

  it('is false with no connected admin lane, no box answer, or no block', () => {
    expect(toolsSyncNeedsHome(blockOf(STALE, NOT_CONNECTED))).toBe(false);
    expect(toolsSyncNeedsHome(blockOf(STALE, null))).toBe(false);
    expect(toolsSyncNeedsHome(testboxBlock({ answer: { ok: false, reason: 'unanswered' }, listing: [], logs: [], now: NOW, admin: STATUS }))).toBe(false);
    expect(toolsSyncNeedsHome(null)).toBe(false);
  });

  it('tools-home is a short sub with no field and no step-up, recorded as a repair', () => {
    expect(TESTBOX_ADMIN_SUBS['tools-home']).toEqual({ fields: {}, stepUp: false, long: false, act: 'repair' });
  });
});

describe('toolsSyncCallerOf: who the repair row names (box-token-runs-fixed-repair)', () => {
  const req = (headers: Record<string, string>): FastifyRequest => ({ headers }) as unknown as FastifyRequest;
  it('a session is its device; the box token is `box token`; neither is the unlabelled actor, and never the server', () => {
    const session = toolsSyncCallerOf(req({ cookie: 'ccrc_session=abc' }), { reason: 'session', device: 'phone-a' });
    expect(session.label).toBe('phone-a');
    const token = toolsSyncCallerOf(req({ 'x-ccrc-mail-token': 'redacted' }), { reason: 'refused', device: null });
    expect(String(token)).toBe('box token 00000000');
    const neither = toolsSyncCallerOf(req({}), { reason: 'refused', device: null });
    expect(neither.label).not.toBe('box token');
    for (const a of [session, token, neither]) expect(a.label).not.toBe('ccrc server');
  });
});

interface Rig { lane: TestboxLane; calls: string[]; rows: () => Record<string, unknown>[] }

/** A lane over fakes: `order` records the admin subs and the sync in the order they ran. */
function rig(o: { sync?: TestboxSync; admin?: TestboxAdminStatus; homeAnswer?: TestboxAdminOutcome } = {}): Rig {
  const home = mkTmp('ccrc-testbox-tools-home-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  const audit = new TestboxAudit(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[] = [];
  const io: FleetIO = {
    ...localIOFor(home),
    testboxMeasured: async () => measured(o.sync ?? STALE),
    testboxToolsSync: async () => { calls.push('sync'); return { ok: true, reply: { outcome: 'sent', detail: null, frame: null } }; },
  };
  const ops: TestboxAdminOps = {
    arm: 'remote',
    run: async (sub: TestboxAdminSub): Promise<TestboxAdminOutcome> => {
      if (sub === 'status') return { kind: 'exited', code: 0, stdout: `${JSON.stringify(o.admin ?? STATUS)}\n` };
      calls.push(sub);
      if (sub === 'tools-home') return o.homeAnswer ?? { kind: 'exited', code: 0, stdout: '{"ok":true,"home":"written"}\n' };
      return { kind: 'exited', code: 0, stdout: '{"ok":true}\n' };
    },
  };
  const fleetIdentity = { current: () => ({ kind: 'known', connectionEpoch: 1, nodeId: NODE, measuredAt: 0 }) } as unknown as FleetIdentityCell;
  const lane = new TestboxLane(() => ({ io, cfg, testboxAdmin: ops, testboxAudit: audit, fleetIdentity }), () => NOW);
  return { lane, calls, rows: () => audit.recent(50).reverse() as unknown as Record<string, unknown>[] };
}
const repairRows = (r: Rig): unknown[][] => r.rows().filter((x) => x['act'] === 'repair').map((x) => [x['outcome'], x['code'] ?? null]);

describe('the tool sync\'s call gives a stale box\'s tools unit a HOME first (L4)', () => {
  it('a box whose sync died for want of a HOME: tools-home runs once, before the sync, and is recorded as the server\'s repair', async () => {
    const r = rig();
    await r.lane.sweep(true);
    const asked = await r.lane.toolsSync();
    expect(asked).toEqual({ ok: true, reply: { outcome: 'sent', detail: null, frame: null } });
    expect(r.calls.filter((c) => c !== 'read')).toEqual(['tools-home', 'sync']);
    const rows = r.rows().filter((x) => x['act'] === 'repair');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ act: 'repair', outcome: 'ok' });
    expect(JSON.stringify(rows[0])).toContain('ccrc server');
  });

  // Review 3223 F2: the row names the caller the route measured (a session, or the box token), not the server.
  it('the repair row names the caller the route hands the lane', async () => {
    const r = rig();
    await r.lane.sweep(true);
    await r.lane.toolsSync(actorOf('box token', ''));
    const rows = r.rows().filter((x) => x['act'] === 'repair');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).toContain('box token');
    expect(JSON.stringify(rows[0])).not.toContain('ccrc server');
  });

  // Review 3223 F3: a drop-in already in place changed nothing on the box, so it is no repair and writes no row.
  it('a kept answer runs the sync and writes no repair row', async () => {
    const r = rig({ homeAnswer: { kind: 'exited', code: 0, stdout: '{"ok":true,"home":"kept"}\n' } });
    await r.lane.sweep(true);
    await r.lane.toolsSync();
    expect(r.calls.filter((c) => c !== 'read')).toEqual(['tools-home', 'sync']);
    expect(repairRows(r)).toEqual([]);
  });

  it('a refused tools-home is recorded with its code, and the sync is still sent', async () => {
    const r = rig({ homeAnswer: { kind: 'exited', code: 0, stdout: '{"ok":false,"code":"tools-home-failed"}\n' } });
    await r.lane.sweep(true);
    await r.lane.toolsSync();
    expect(r.calls.filter((c) => c !== 'read')).toEqual(['tools-home', 'sync']);
    expect(repairRows(r)).toEqual([['refused', 'tools-home-failed']]);
  });

  it.each([
    ['a box whose sync failed another way', { sync: { ...STALE, detail: 'node: checksum mismatch' } }],
    ['a box whose sync is idle', { sync: { state: 'idle', detail: null, at: null } as TestboxSync }],
    ['an admin lane that is not connected', { admin: NOT_CONNECTED }],
  ] as const)('%s: no tools-home, the sync alone, and no row', async (_n, o) => {
    const r = rig(o);
    await r.lane.sweep(true);
    await r.lane.toolsSync();
    expect(r.calls.filter((c) => c !== 'read')).toEqual(['sync']);
    expect(repairRows(r)).toEqual([]);
  });

  it('before any pass (no block yet): the sync alone', async () => {
    const r = rig();
    await r.lane.toolsSync();
    expect(r.calls.filter((c) => c !== 'read')).toEqual(['sync']);
  });
});
