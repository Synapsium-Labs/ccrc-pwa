// D-7858: the backup-health block. Three layers (the decider's rows are `backup-verdict.test.ts`'s):
//  - the lane (`backupLane.ts`) on a scripted io and clock: no block before a read lands, one read a minute, never two
//    asks out, a failed ask keeps the last read, and staleness is judged when the block is read;
//  - the route: `GET /api/fleet/health` carries `backup` once the lane has read, in both modes, and adds nothing else;
//    a failed fixture shows on the first sweep after it is written (one fleet-health cycle), and the watcher's own
//    tick runs that sweep, so nobody has to call it;
//  - the local adapter over a real fixture directory, through this process's environment (D-7859).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type MeasuredBackup } from '../src/io.js';
import { createIo } from '../src/remote/io.js';
import { BACKUP_OP } from '../../shared/agent-protocol.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { BACKUP_SWEEP_MS, BackupLane } from '../src/backupLane.js';
import { readBackupHealth, type BackupRead } from '../../shared/backup.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const H = 3_600_000;
const T = Date.parse('2026-11-03T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const fresh: BackupRead = { state: 'read', files: { 'last-success': `${iso(T - H)} mode=backup` } };

function rig(answers: (MeasuredBackup | 'hang')[], staleHours = 36) {
  let now = T;
  let asks = 0;
  const io = {
    backupMeasured: (): Promise<MeasuredBackup> => {
      const a = answers[Math.min(asks++, answers.length - 1)]!;
      return a === 'hang' ? new Promise(() => {}) : Promise.resolve(a);
    },
  };
  const lane = new BackupLane(() => ({ io, cfg: { backupStaleHours: staleHours } }) as never, () => now);
  return { lane, tick: (ms: number) => { now += ms; }, asks: () => asks };
}

describe('the lane (D-7858)', () => {
  it('no block before a read lands; then the decider\'s block', async () => {
    const r = rig([{ ok: true, read: fresh }]);
    expect(r.lane.block()).toBeNull();
    await r.lane.sweep();
    expect(r.lane.block()).toMatchObject({ status: 'ok', at: T, lastSuccessAt: T - H, staleHours: 36 });
  });

  it('an agent without the op, or an unanswered ask, leaves no block: unknown, never an alarm', async () => {
    for (const reason of ['unsupported', 'unanswered'] as const) {
      const r = rig([{ ok: false, reason }]);
      await r.lane.sweep();
      expect(r.lane.block(), reason).toBeNull();
    }
  });

  it('a failed ask after a read keeps the last read', async () => {
    const r = rig([{ ok: true, read: fresh }, { ok: false, reason: 'unanswered' }]);
    await r.lane.sweep();
    r.tick(BACKUP_SWEEP_MS);
    await r.lane.sweep();
    expect(r.asks()).toBe(2);
    expect(r.lane.block()).toMatchObject({ status: 'ok', at: T });
  });

  it('one read a minute, and never a second ask while one is out', async () => {
    const r = rig([{ ok: true, read: fresh }]);
    await r.lane.sweep();
    r.tick(BACKUP_SWEEP_MS - 1);
    await r.lane.sweep();
    expect(r.asks()).toBe(1);
    r.tick(1);
    await r.lane.sweep();
    expect(r.asks()).toBe(2);
    const h = rig(['hang']);
    void h.lane.sweep();
    h.tick(BACKUP_SWEEP_MS * 3);
    await h.lane.sweep();
    expect(h.asks()).toBe(1);
  });

  it('staleness is judged when the block is read, by the configured hours', async () => {
    const r = rig([{ ok: true, read: fresh }], 2);
    await r.lane.sweep();
    expect(r.lane.block()?.status).toBe('ok');
    r.tick(H + 1);
    expect(r.lane.block()).toMatchObject({ status: 'stale', stale: { ageH: 2 }, staleHours: 2 });
  });
});

describe('/api/fleet/health: the backup block (D-7858)', () => {
  const deadRunner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
  for (const [name, env] of [['local', {}], ['remote', { CCRC_FLEET: 'remote' }]] as const) {
    it(`${name} mode: no \`backup\` key before the first read; a failed fixture shows on the next cycle; nothing else changes`, async () => {
      const home = mkTmp('ccrc-fh-backup-');
      seedRoster(home);
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_BACKUP_STALE_HOURS: '36', ...env });
      let read: BackupRead = { state: 'read', files: { 'last-success': `${iso(Date.now() - H)} mode=backup` } };
      const io = { ...localIO, backupMeasured: async (): Promise<MeasuredBackup> => ({ ok: true, read }) };
      const deps = {
        cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io, queue: new KeyedQueue(),
        fleetState: { connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null },
      } as never as Deps;
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      const app = await buildServer(deps, bus, watcher);
      const health = async (): Promise<Record<string, unknown>> =>
        (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
      try {
        const before = await health();
        expect('backup' in before, 'absent, never `null`: absence is UNKNOWN').toBe(false);
        await watcher.sweepBackup();
        const after = await health();
        expect(readBackupHealth(after)).toMatchObject({ status: 'ok', staleHours: 36 });
        const { backup: _block, ...rest } = after;
        expect(rest).toEqual(before);
        // The box writes a failure; the lane's next cycle carries it.
        read = { state: 'read', files: { ...read.files, 'last-failure': `${iso(Date.now())} mode=backup exit=2 step-a` } };
        (watcher as unknown as { backupLane: { lastSweep: number } }).backupLane.lastSweep -= BACKUP_SWEEP_MS;
        await watcher.sweepBackup();
        expect(readBackupHealth(await health())).toMatchObject({ status: 'failed', lastFailure: { exit: 2, note: 'step-a' } });
      } finally { await app.close(); }
    });

    it(`${name} mode: the watcher's own fleet-health cycle runs the sweep, and its read reaches the route (nobody has to call it)`, async () => {
      const home = mkTmp('ccrc-fh-backup-tick-');
      seedRoster(home);
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_BACKUP_STALE_HOURS: '36', ...env });
      const read: BackupRead = { state: 'read', files: { 'last-success': `${iso(Date.now() - H)} mode=backup` } };
      let asks = 0;
      const io = { ...localIO, backupMeasured: async (): Promise<MeasuredBackup> => { asks++; return { ok: true, read }; } };
      const deps = {
        cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io, queue: new KeyedQueue(),
        fleetState: { connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null },
      } as never as Deps;
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      const app = await buildServer(deps, bus, watcher);
      try {
        await watcher.tick();
        await vi.waitFor(() => expect(asks, 'the tick asked the backup read').toBeGreaterThan(0), { timeout: 3000 });
        await vi.waitFor(async () => {
          const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
          expect(readBackupHealth(body)).toMatchObject({ status: 'ok', staleHours: 36 });
        }, { timeout: 3000 });
      } finally { await app.close(); }
    });
  }
});

describe('the local adapter reads this process\'s CCRC_BACKUP_STATE_DIR (D-7859)', () => {
  const saved = process.env['CCRC_BACKUP_STATE_DIR'];
  afterEach(() => {
    if (saved === undefined) delete process.env['CCRC_BACKUP_STATE_DIR'];
    else process.env['CCRC_BACKUP_STATE_DIR'] = saved;
  });

  it('unset is not-configured; a fixture directory is read', async () => {
    delete process.env['CCRC_BACKUP_STATE_DIR'];
    expect(await localIO.backupMeasured()).toEqual({ ok: true, read: { state: 'not-configured' } });
    const d = path.join(mkTmp('ccrc-backup-dir-'), 'state');
    mkdirSync(d);
    writeFileSync(path.join(d, 'stale'), `${iso(T)} no last-success\n`);
    process.env['CCRC_BACKUP_STATE_DIR'] = d;
    expect(await localIO.backupMeasured()).toEqual({ ok: true, read: { state: 'read', files: { stale: `${iso(T)} no last-success` } } });
  });
});

describe('the remote adapter: the agent\'s backup op (D-7858)', () => {
  it('sends nothing to an agent whose ready list lacks the op: unsupported', async () => {
    const request = vi.fn();
    const io = createIo({ state: { agentOps: ['update'] }, request } as never);
    expect(await io.backupMeasured()).toEqual({ ok: false, reason: 'unsupported' });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps a wire fault to unanswered', async () => {
    const io = createIo({ state: { agentOps: [BACKUP_OP] }, request: async () => { throw new Error('disconnected'); } } as never);
    expect(await io.backupMeasured()).toEqual({ ok: false, reason: 'unanswered' });
  });

  it('refuses a reply that is not a backup read: unanswered, never a made-up read', async () => {
    const io = createIo({ state: { agentOps: [BACKUP_OP] }, request: async () => ({ state: 'read', files: 'x' }) } as never);
    expect(await io.backupMeasured()).toEqual({ ok: false, reason: 'unanswered' });
  });

  it('passes a well-formed reply through as the read, asking the backup op once', async () => {
    const request = vi.fn(async () => ({ state: 'read', files: { stale: 'x' } }));
    const io = createIo({ state: { agentOps: [BACKUP_OP] }, request } as never);
    expect(await io.backupMeasured()).toEqual({ ok: true, read: { state: 'read', files: { stale: 'x' } } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ t: 'req', op: BACKUP_OP });
  });
});
