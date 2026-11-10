// Test box connect plan TC13 (spec §2.7, §2.8, §2.10, D-8166): the lane's side of the connect surface. Each pass asks the
// `status` op and carries the answer in the block's optional `admin`; `read` is asked at most every six hours while
// connected; a long act whose `endedAt` is new writes its end row(s) to the ledger, keyed by `actId`, so a restart never
// writes them twice. No box is touched: the ops port is a fake and the ledger is a real coord.db in a temp directory.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { TestboxHostTools } from '../../shared/agent-protocol.js';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox.js';
import type { TestboxActState, TestboxAdminStatus, TestboxParityRecord, TestboxAdminSub } from '../../shared/testbox-admin.js';
import { openCoordDb } from '../src/coord/db.js';
import { actorOf } from '../src/accounts/audit.js';
import { loadConfig } from '../src/config.js';
import type { FleetIdentityCell } from '../src/fleetidentity.js';
import { localIOFor, type FleetIO, type MeasuredTestbox } from '../src/io.js';
import { adminOfBlock, NOT_CONNECTED_ADMIN } from '../src/testbox.js';
import type { TestboxAdminOps, TestboxAdminOutcome } from '../src/testboxAdmin.js';
import { TestboxAudit } from '../src/testboxAudit.js';
import { TESTBOX_POLL_DEFAULT_MS, TESTBOX_SETTINGS_READ_MS, TestboxLane } from '../src/testboxLane.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const NODE = '0a17a17a-0000-4000-8000-0000000012c1';
const FP = `SHA256:${'A'.repeat(43)}`;
const SHA = 'a'.repeat(64);
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const HOST = { tools: TOOLS as TestboxHostTools, release: 'v0.0.900', measuredAt: '2026-11-10T11:59:59Z' };
const BOX: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0, pristine: [],
  failedKeys: [], heldRunUsers: [], repositories: [],
};
const MEASURED: MeasuredTestbox = { ok: true, reply: { host: HOST, pollMs: 30_000, box: { ok: true, status: BOX } } };

const RECORD: TestboxParityRecord = {
  v: 1, result: 'pass', prs: [], fixtures: [], release: 'v0.0.900', toolsKey: 'k1', fingerprint: FP, boxFileSha256: SHA, at: 1,
};
const STATUS: TestboxAdminStatus = {
  v: 1, connected: true, addressSet: true, login: 'root', fingerprint: FP, hostKey: 'pinned', boxFileSha256: SHA, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: RECORD,
};
const act = (over: Partial<TestboxActState>): TestboxActState => ({
  id: 'c'.repeat(32), sub: 'connect', phase: null, phases: [], outcome: 'ok', code: null, startedAt: 1, endedAt: 2, ...over,
});

interface Rig {
  lane: () => TestboxLane; clock: { t: number }; audit: TestboxAudit; asked: (sub: TestboxAdminSub) => number;
  setStatus: (s: TestboxAdminStatus | 'no-op') => void; rows: () => Record<string, unknown>[];
}

function rig(first: TestboxAdminStatus | 'no-op' = STATUS): Rig {
  const home = mkTmp('ccrc-testbox-admin-lane-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const audit = new TestboxAudit(db);
  const io: FleetIO = { ...localIOFor(home), testboxMeasured: async () => MEASURED };
  const clock = { t: NOW };
  let status: TestboxAdminStatus | 'no-op' = first;
  const calls: TestboxAdminSub[] = [];
  const ops: TestboxAdminOps = {
    arm: 'remote',
    run: async (sub): Promise<TestboxAdminOutcome> => {
      calls.push(sub);
      if (status === 'no-op') return { kind: 'unsupported' };
      return { kind: 'exited', code: 0, stdout: sub === 'status' ? `${JSON.stringify(status)}\n` : '{"ok":true}\n' };
    },
  };
  const fleetIdentity = { current: () => ({ kind: 'known', connectionEpoch: 1, nodeId: NODE, measuredAt: 0 }) } as unknown as FleetIdentityCell;
  // A "restart" is a new lane over the same ledger.
  const lane = (): TestboxLane => new TestboxLane(() => ({ io, cfg, testboxAdmin: ops, testboxAudit: audit, fleetIdentity }), () => clock.t);
  return {
    lane, clock, audit, asked: (sub) => calls.filter((c) => c === sub).length, setStatus: (s) => { status = s; },
    rows: () => audit.recent(50).reverse() as unknown as Record<string, unknown>[],
  };
}

const shape = (rows: Record<string, unknown>[]) => rows.map((r) => [r['act'], r['outcome'], r['code'], r['actId']]);

describe('the block carries admin (D-8166)', () => {
  it('a connected box with a matching pass reads admin.parity pass', async () => {
    const r = rig();
    const lane = r.lane();
    await lane.sweep();
    expect(lane.block()?.admin).toEqual({ connected: true, hostKey: 'pinned', act: null, parity: 'pass' });
  });

  it('the parity word is none, fail or stale', async () => {
    for (const [parity, boxFileSha256, want] of [
      [null, SHA, 'none'], [{ ...RECORD, result: 'fail' as const }, SHA, 'fail'], [RECORD, 'b'.repeat(64), 'stale'],
    ] as const) {
      const r = rig({ ...STATUS, parity, boxFileSha256 });
      const lane = r.lane();
      await lane.sweep();
      expect(lane.block()?.admin?.parity, String(want)).toBe(want);
    }
  });

  it('the block and an older PWA: admin is the one added key, and the rest is as today', async () => {
    const r = rig();
    const lane = r.lane();
    await lane.sweep();
    const block = JSON.parse(JSON.stringify(lane.block())) as Record<string, unknown>;
    // The PWA's guard (`asTestboxBlock`) reads named fields and ignores the rest, so a key it does not know is read past; the
    // field set it draws from is unchanged. (The guard's own rows are `pwa/src/fleet/TestBoxSection.test.tsx`'s.)
    expect(Object.keys(block).filter((k) => k !== 'admin').sort()).toEqual(
      ['at', 'box', 'cells', 'counts', 'host', 'reasons', 'state', 'summary', 'switch']);
    expect(block['admin']).toEqual({ connected: true, hostKey: 'pinned', act: null, parity: 'pass' });
  });

  it('a block with no admin reads as not connected (an older server, or an agent without the op)', async () => {
    const r = rig('no-op');
    const lane = r.lane();
    await lane.sweep();
    const block = lane.block()!;
    expect('admin' in block).toBe(false);
    expect(adminOfBlock(block)).toEqual(NOT_CONNECTED_ADMIN);
    expect(NOT_CONNECTED_ADMIN).toEqual({ connected: false, hostKey: 'none', act: null, parity: 'none' });
  });
});

describe('the lane asks read at most every six hours while connected (D-8166)', () => {
  it('first pass reads, then not until six hours have passed', async () => {
    const r = rig();
    const lane = r.lane();
    await lane.sweep();
    expect(r.asked('read')).toBe(1);
    r.clock.t += TESTBOX_SETTINGS_READ_MS - 1;
    await lane.sweep(true);
    expect(r.asked('read')).toBe(1);
    r.clock.t += 1;
    await lane.sweep(true);
    expect(r.asked('read')).toBe(2);
    expect(r.asked('status')).toBe(3);
  });

  it('is six hours, and a box that is not connected is never read', async () => {
    expect(TESTBOX_SETTINGS_READ_MS).toBe(6 * 3_600_000);
    const r = rig({ ...STATUS, connected: false, hostKey: 'none', fingerprint: null, boxFileSha256: null, parity: null });
    const lane = r.lane();
    await lane.sweep();
    r.clock.t += TESTBOX_SETTINGS_READ_MS * 2;
    await lane.sweep(true);
    expect(r.asked('read')).toBe(0);
    expect(r.asked('status')).toBe(2);
  });

  it('the status is asked on the poll\'s clock, like the rest of the pass', async () => {
    const r = rig();
    const lane = r.lane();
    await lane.sweep();
    r.clock.t += TESTBOX_POLL_DEFAULT_MS - 1;
    await lane.sweep();
    expect(r.asked('status')).toBe(1);
  });
});

describe('an ended long act writes its end rows once, across a restart (D-8166)', () => {
  it('a connect that ended ok writes install (keyed by the act) then pair', async () => {
    const r = rig({ ...STATUS, act: act({ phases: [{ name: 'install', ms: 5 }, { name: 'pair', ms: 5 }] }) });
    await r.lane().sweep();
    expect(shape(r.rows())).toEqual([['install', 'ok', null, 'c'.repeat(32)], ['pair', 'ok', null, null]]);
    const row = r.rows()[0]!;
    expect(row['fleetIdentity']).toBe(NODE);
    expect(row['actor']).toBe(actorOf('ccrc server', '').toString());
  });

  it('a new lane over the same ledger writes nothing more, and a second pass writes nothing more', async () => {
    const r = rig({ ...STATUS, act: act({}) });
    const a = r.lane();
    await a.sweep();
    await a.sweep(true);
    const b = r.lane();
    await b.sweep();
    expect(r.rows().length).toBe(2);
  });

  it('a connect that failed before the install writes one failed install row with its code and no pair row', async () => {
    const r = rig({ ...STATUS, act: act({ outcome: 'failed', phase: 'copy', code: 'copy-failed' }) });
    await r.lane().sweep();
    expect(shape(r.rows())).toEqual([['install', 'failed', 'copy-failed', 'c'.repeat(32)]]);
  });

  it('a connect that failed at the pair writes install ok and pair failed', async () => {
    const r = rig({ ...STATUS, act: act({ outcome: 'failed', phase: 'pair', code: 'pair-failed' }) });
    await r.lane().sweep();
    expect(shape(r.rows())).toEqual([['install', 'ok', null, 'c'.repeat(32)], ['pair', 'failed', 'pair-failed', null]]);
  });

  it('a parity, repair or apply-release act writes the one row its sub names', async () => {
    for (const [sub, want] of [['parity', 'parity'], ['repair', 'repair'], ['apply-release', 'apply-release']] as const) {
      const r = rig({ ...STATUS, act: act({ sub }) });
      await r.lane().sweep();
      expect(shape(r.rows()), sub).toEqual([[want, 'ok', null, 'c'.repeat(32)]]);
    }
  });

  it('a running act writes nothing, and its end row is written when it ends', async () => {
    const r = rig({ ...STATUS, act: act({ outcome: 'running', endedAt: null }) });
    const lane = r.lane();
    await lane.sweep();
    expect(r.rows()).toEqual([]);
    r.setStatus({ ...STATUS, act: act({ sub: 'parity' }) });
    await lane.sweep(true);
    expect(shape(r.rows())).toEqual([['parity', 'ok', null, 'c'.repeat(32)]]);
  });

  it('no row holds an address, a path or free text', async () => {
    const r = rig({ ...STATUS, act: act({ outcome: 'failed', phase: 'install', code: 'install-failed' }) });
    await r.lane().sweep();
    expect(JSON.stringify(r.rows())).not.toMatch(/\/|@|\d+\.\d+\.\d+\.\d+/);
  });
});
