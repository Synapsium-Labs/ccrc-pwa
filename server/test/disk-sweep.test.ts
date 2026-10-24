// D-6615 (fleet disk retention plan Task DR-3, spec §2.5): the watcher's `sweepDisk` lane and the two `statfsMeasured`
// adapters. The decider's own rules are `disk-verdict.test.ts`'s; this file proves what the SWEEP does with a read, and
// what the block says when no read could be taken.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import os from 'node:os';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { createIo } from '../src/remote/io.js';
import { localIO, localIOFor, type FleetIO, type MeasuredDisk } from '../src/io.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { DISK_OP } from '../../shared/agent-protocol.js';
import type { DiskFilesystem, DiskMeasured } from '../../shared/disk.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

const fixtureHome = (): string => mkTmp('ccrc-diskhome-');
const GIB = 1024 ** 3;
const fsAt = (usedPct: number, dev = '1'): DiskFilesystem => ({
  dev, mount: '/work', fsType: 'ext4', roots: ['home'], sizeBytes: 100 * GIB, availBytes: (100 - usedPct) * GIB,
  freeBytes: (100 - usedPct) * GIB, files: 1_000_000, filesFree: 900_000, readOnly: false,
});
const measured = (usedPct: number): DiskMeasured => ({ filesystems: [fsAt(usedPct)], expectedMounts: [], missing: [] });
const ok = (m: DiskMeasured): MeasuredDisk => ({ ok: true, measured: m });

/** A watcher whose fleet io answers `statfsMeasured` from the script (the last answer repeats). */
function watcherWith(answers: MeasuredDisk[]): { watcher: FleetWatcher; calls: () => number } {
  let n = 0;
  const io: FleetIO = { ...localIO, statfsMeasured: async () => answers[Math.min(n++, answers.length - 1)]! };
  const watcher = new FleetWatcher({ ...testDeps(), io }, new Bus());
  return { watcher, calls: () => n };
}

/** `sweepDisk` has a 60 s clock; rewind it so the next call measures. */
const rewind = (w: FleetWatcher): void => { (w as unknown as { lastDiskSweep: number }).lastDiskSweep = 1; };

describe('sweepDisk — the watcher holds the verdict', () => {
  it('the block is absent before the first sweep', () => {
    const { watcher } = watcherWith([ok(measured(50))]);
    expect(watcher.disk()).toBeNull();
  });

  it('a first read of a healthy disk is an ok block with no holders yet', async () => {
    const { watcher } = watcherWith([ok(measured(50))]);
    await watcher.sweepDisk();
    const d = watcher.disk()!;
    expect(d.level).toBe('ok');
    expect(d.pressure).toBe(false);
    expect(d.filesystems.map((f) => [f.dev, f.level])).toEqual([['1', 'ok']]);
    expect(d.holders, '`holders` is empty until the holder census fills it').toEqual([]);
    expect(Object.keys(d.filesystems[0]!), 'the decider\'s memory (`pending`) is not wire').not.toContain('pending');
  });

  it('an older agent (the op is not in its ready list) gives level unmeasured, never ok', async () => {
    const { watcher } = watcherWith([{ ok: false, reason: 'unmeasured' }]);
    await watcher.sweepDisk();
    expect(watcher.disk()!.level).toBe('unmeasured');
  });

  it('a transport failure after an ok read marks the block unmeasured, never ok', async () => {
    const { watcher } = watcherWith([ok(measured(50)), { ok: false, reason: 'unreadable' }]);
    await watcher.sweepDisk();
    rewind(watcher);
    await watcher.sweepDisk();
    expect(watcher.disk()!.level).toBe('unmeasured');
  });

  it('a transport failure keeps a known critical level (the alarm does not go dark when the link does)', async () => {
    const { watcher } = watcherWith([ok(measured(95)), ok(measured(95)), { ok: false, reason: 'unreadable' }]);
    await watcher.sweepDisk();
    rewind(watcher); await watcher.sweepDisk();
    expect(watcher.disk()!.level).toBe('critical');
    rewind(watcher); await watcher.sweepDisk();
    expect(watcher.disk()!.level).toBe('critical');
  });

  it('measures at most once a minute', async () => {
    const { watcher, calls } = watcherWith([ok(measured(50))]);
    await watcher.sweepDisk();
    await watcher.sweepDisk();
    expect(calls()).toBe(1);
    rewind(watcher);
    await watcher.sweepDisk();
    expect(calls()).toBe(2);
  });

  it('the watcher\'s own tick runs the sweep (nobody has to call it)', async () => {
    const { watcher } = watcherWith([ok(measured(50))]);
    await watcher.tick();
    await vi.waitFor(() => expect(watcher.disk()?.level).toBe('ok'), { timeout: 3000 });
  });

  it('an io that throws is an unmeasured block, and the sweep itself does not reject', async () => {
    const io: FleetIO = { ...localIO, statfsMeasured: async () => { throw new Error('boom'); } };
    const watcher = new FleetWatcher({ ...testDeps(), io }, new Bus());
    await expect(watcher.sweepDisk()).resolves.toBeUndefined();
    expect(watcher.disk()!.level).toBe('unmeasured');
  });
});

describe('statfsMeasured — the two adapters', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await fleet?.close(); fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) { rmSync(fixture.home, { recursive: true, force: true }); rmSync(fixture.projectsRoot, { recursive: true, force: true }); }
    fixture = undefined;
  });

  it('the remote adapter sends nothing to an agent whose ready list lacks the op', async () => {
    const request = vi.fn();
    const io = createIo({ state: { agentOps: ['update'] }, request } as never);
    expect(await io.statfsMeasured()).toEqual({ ok: false, reason: 'unmeasured' });
    expect(request).not.toHaveBeenCalled();
  });

  it('the remote adapter maps a wire fault to unmeasured', async () => {
    const io = createIo({ state: { agentOps: [DISK_OP] }, request: async () => { throw new Error('disconnected'); } } as never);
    expect(await io.statfsMeasured()).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('the remote adapter refuses a reply that is not a disk reply (no half-measured ok)', async () => {
    const io = createIo({ state: { agentOps: [DISK_OP] }, request: async () => ({ filesystems: 'x' }) } as never);
    expect(await io.statfsMeasured()).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('remote and local adapters measure the same fixture home and agree on the values', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    await vi.waitFor(() => expect(fleet!.state.agentOps).toContain(DISK_OP), { timeout: 3000 });
    const remote = await fleet.io.statfsMeasured();
    const local = await localIOFor(fixture.home).statfsMeasured();
    expect(remote.ok).toBe(true);
    expect(local.ok).toBe(true);
    if (!remote.ok || !local.ok) return;
    const stable = (m: DiskMeasured) => ({
      fs: m.filesystems.map((f) => [f.dev, f.mount, f.fsType, f.roots, f.sizeBytes, f.files, f.readOnly]),
      expectedMounts: m.expectedMounts, missing: m.missing,
    });
    expect(stable(remote.measured)).toEqual(stable(local.measured));
    expect(remote.measured.filesystems.length).toBeGreaterThan(0);
  });

  it('a tick measures the configured home and never the process home', async () => {
    const home = fixtureHome();
    const deps = testDeps(home);
    const spy = vi.spyOn(os, 'homedir').mockImplementation(() => { throw new Error('process home read'); });
    try {
      const watcher = new FleetWatcher(deps, new Bus());
      await watcher.sweepDisk();
      expect(watcher.disk()!.level, 'a read of the process home would be unreadable, hence unmeasured').not.toBe('unmeasured');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); rmSync(home, { recursive: true, force: true }); }
  });

  for (const [name, bad] of [
    ['a filesystem lacking freeBytes', (() => { const { freeBytes: _f, ...rest } = fsAt(99); return { filesystems: [rest], expectedMounts: [], missing: [] }; })()],
    ['a non-numeric sizeBytes', { filesystems: [{ ...fsAt(50), sizeBytes: '100' }], expectedMounts: [], missing: [] }],
    ['an empty filesystem element', { filesystems: [{}], expectedMounts: [], missing: [] }],
    ['an empty expected-mount element', { filesystems: [], expectedMounts: [{}], missing: [] }],
    ['a missing row with an unknown why', { filesystems: [], expectedMounts: [], missing: [{ label: 'home', why: 'odd' }] }],
  ] as const) {
    it(`the remote adapter reads ${name} as unmeasured`, async () => {
      const io = createIo({ state: { agentOps: [DISK_OP] }, request: async () => bad } as never);
      expect(await io.statfsMeasured()).toEqual({ ok: false, reason: 'unmeasured' });
    });
  }

  it('the remote adapter keeps a well-formed reply whole', async () => {
    const good = measured(99);
    const io = createIo({ state: { agentOps: [DISK_OP] }, request: async () => good } as never);
    expect(await io.statfsMeasured()).toEqual({ ok: true, measured: good });
  });
});
