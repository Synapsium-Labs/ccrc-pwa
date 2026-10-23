// Fleet disk retention spec 2026-10-23 §2.5 (plan Task DR-2, D-6614): the agent's `disk` op. Two layers:
//  - the wire (a REAL agent over loopback against a fixture HOME, `token-sync-op.test.ts`'s idiom): the op is advertised
//    in `ready.ops`, takes no field, and a frame that names a path is `bad-request` and measures nothing;
//  - the measurement (`measureDisk` with every disk read injected): grouping by device, the deadline, the three ways
//    a root can be unmeasured, and `CCRC_WORK_MOUNTS`. No case stats a real work root or a live HOME.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { measureDisk, type DiskSeams, type DiskStatfs } from '../src/disk.js';
import { DISK_OP, type AgentReady } from '../../shared/agent-protocol.js';
import { DISK_WORK_ROOTS } from '../../shared/disk.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const HOME = '/h';
/** A statfs answer: 1000 blocks of 4096, 400 free to root, 300 available, 5000 inodes of which 2000 free. */
const FS_ANSWER: DiskStatfs = { bsize: 4096, blocks: 1000, bfree: 400, bavail: 300, files: 5000, ffree: 2000 };

/** Linux's device number for major 8, minor `n`: (major << 8) | minor. Written out here, not imported. */
const dev = (n: number): number => (8 << 8) | n;
const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const eio = (): Error => Object.assign(new Error('EIO'), { code: 'EIO' });
const NEVER = (): Promise<never> => new Promise(() => {});

interface Rig { seams: Partial<DiskSeams>; statfsCalls: string[]; statCalls: string[] }
/** Every read injected. `devs` maps a path prefix (longest wins) to a device; a path in `broken` fails with its error. */
function rig(opts: {
  devs?: Record<string, number>;
  broken?: Record<string, () => Promise<never> | Error>;
  mountinfo?: string | null;
  env?: NodeJS.ProcessEnv;
  files?: Record<string, string>;
  deadlineMs?: number;
} = {}): Rig {
  const statfsCalls: string[] = [];
  const statCalls: string[] = [];
  const devs = opts.devs ?? {};
  const devOf = (p: string): number => {
    const hit = Object.keys(devs).filter((k) => p === k || p.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
    return hit === undefined ? dev(1) : devs[hit]!;
  };
  const trip = async (p: string): Promise<void> => {
    const f = opts.broken?.[p];
    if (f === undefined) return;
    const r = f();
    if (r instanceof Error) throw r;
    await r;
  };
  const seams: Partial<DiskSeams> = {
    statfs: async (p) => { statfsCalls.push(p); await trip(p); return FS_ANSWER; },
    stat: async (p) => { statCalls.push(p); await trip(p); return { dev: devOf(p) }; },
    readMountinfo: () => (opts.mountinfo === undefined ? null : opts.mountinfo),
    readFile: (p) => {
      const t = opts.files?.[p];
      if (t === undefined) throw enoent();
      return t;
    },
    env: opts.env ?? {},
    deadlineMs: opts.deadlineMs ?? 50,
  };
  return { seams, statfsCalls, statCalls };
}

describe('measureDisk', () => {
  it('two roots on one dev are one filesystem with both labels', async () => {
    const r = rig({ devs: { [HOME]: dev(1), '/h/projects': dev(2), '/h/.cc-tmp': dev(2) } });
    const out = await measureDisk(HOME, r.seams);
    const shared = out.filesystems.filter((f) => f.roots.includes('projects'));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.roots).toEqual(expect.arrayContaining(['projects', 'cc-tmp']));
    expect(shared[0]!.roots).not.toContain('home');
    // The numbers are the statfs answer: df's inputs, in bytes.
    expect(shared[0]).toMatchObject({
      sizeBytes: 1000 * 4096, freeBytes: 400 * 4096, availBytes: 300 * 4096, files: 5000, filesFree: 2000, readOnly: false,
    });
    // Three devices in play (home, the shared one, and the temp roots / config on the default dev(1)): the home
    // filesystem is a different one from the shared one.
    expect(out.filesystems.find((f) => f.roots.includes('home'))!.dev).not.toBe(shared[0]!.dev);
  });

  it('names every DISK_WORK_ROOTS label that exists, and nothing else', async () => {
    const out = await measureDisk(HOME, rig({ files: { '/h/.ccrc/accounts.json': ROSTER } }).seams);
    const labels = new Set(out.filesystems.flatMap((f) => f.roots));
    expect([...labels].sort()).toEqual(DISK_WORK_ROOTS.map((r) => r.label).sort());
    expect(out.missing).toEqual([]);
  });

  it('a statfs that never answers lands in missing within the deadline', async () => {
    const r = rig({ broken: { '/h/worktrees': NEVER }, deadlineMs: 50 });
    const t0 = Date.now();
    const out = await measureDisk(HOME, r.seams);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.missing).toContainEqual({ label: 'worktrees', why: 'timeout' });
    // The other roots were still measured.
    expect(out.filesystems.flatMap((f) => f.roots)).toContain('projects');
    expect(out.filesystems.flatMap((f) => f.roots)).not.toContain('worktrees');
  });

  it('a missing root lands in missing, not as zero', async () => {
    const r = rig({ broken: { '/h/worktrees': enoent } });
    const out = await measureDisk(HOME, r.seams);
    expect(out.missing).toContainEqual({ label: 'worktrees', why: 'absent' });
    expect(out.filesystems.flatMap((f) => f.roots)).not.toContain('worktrees');
    expect(out.filesystems.every((f) => f.sizeBytes > 0)).toBe(true);
  });

  it('an erroring root is failed, and the worst why of a label wins (timeout over failed over absent)', async () => {
    const env = { TMPDIR: '/scratch' };
    const failed = await measureDisk(HOME, rig({ env, broken: { '/scratch': eio, '/tmp': enoent } }).seams);
    expect(failed.missing).toContainEqual({ label: 'claude-tmp', why: 'failed' });
    const timeout = await measureDisk(HOME, rig({ env, broken: { '/scratch': eio, '/tmp': NEVER } }).seams);
    expect(timeout.missing).toContainEqual({ label: 'claude-tmp', why: 'timeout' });
    const absent = await measureDisk(HOME, rig({ env, broken: { '/scratch': enoent, '/tmp': enoent } }).seams);
    expect(absent.missing).toContainEqual({ label: 'claude-tmp', why: 'absent' });
    // A label with one good path and one failed one is still reported: the failed path may hold bytes nobody read.
    const partial = await measureDisk(HOME, rig({ env, broken: { '/tmp': eio } }).seams);
    expect(partial.missing).toContainEqual({ label: 'claude-tmp', why: 'failed' });
    expect(partial.filesystems.flatMap((f) => f.roots)).toContain('claude-tmp');
  });

  it('resolves the temp root from TMPDIR, else /tmp, and every roster config dir', async () => {
    const r = rig({ env: { TMPDIR: '/scratch' }, files: { '/h/.ccrc/accounts.json': ROSTER } });
    await measureDisk(HOME, r.seams);
    expect(r.statfsCalls).toEqual(expect.arrayContaining(['/h', '/h/projects', '/scratch', '/tmp', '/h/.lane-a', '/h/.lane-b', '/h/.ccrc']));
    const noTmp = rig({ files: { '/h/.ccrc/accounts.json': ROSTER } });
    await measureDisk(HOME, noTmp.seams);
    expect(noTmp.statfsCalls.filter((p) => p === '/tmp')).toHaveLength(1);
  });

  it('a roster that cannot be read leaves config-dirs unmeasured: failed when malformed, absent when there is none', async () => {
    const bad = await measureDisk(HOME, rig({ files: { '/h/.ccrc/accounts.json': '{not json' } }).seams);
    expect(bad.missing).toContainEqual({ label: 'config-dirs', why: 'failed' });
    const none = await measureDisk(HOME, rig().seams);
    expect(none.missing).toContainEqual({ label: 'config-dirs', why: 'absent' });
  });

  it('reads each dev\'s mount point, type and read-only flag from mountinfo', async () => {
    const mountinfo = [
      '25 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw',
      '40 25 8:2 / /h/projects ro,relatime shared:2 - xfs /dev/sdb1 rw',
    ].join('\n');
    const out = await measureDisk(HOME, rig({ devs: { '/h/projects': dev(2) }, mountinfo }).seams);
    const projects = out.filesystems.find((f) => f.roots.includes('projects'))!;
    expect(projects).toMatchObject({ mount: '/h/projects', fsType: 'xfs', readOnly: true });
    const home = out.filesystems.find((f) => f.roots.includes('home'))!;
    expect(home).toMatchObject({ mount: '/', fsType: 'ext4', readOnly: false });
  });

  it('CCRC_WORK_MOUNTS names a path that is not a mount point: mounted false', async () => {
    const mountinfo = '25 1 8:1 / / rw - ext4 /dev/sda1 rw\n41 25 8:3 / /srv/work rw - ext4 /dev/sdc1 rw';
    const env = { CCRC_WORK_MOUNTS: '/srv/work /srv/other' };
    const out = await measureDisk(HOME, rig({ env, mountinfo }).seams);
    expect(out.expectedMounts).toEqual([{ path: '/srv/work', mounted: true }, { path: '/srv/other', mounted: false }]);
  });

  it('mounted is read from mountinfo, never from whether the path exists', async () => {
    // A directory that exists but is not a mount point: an unmounted volume leaves exactly this behind.
    const fx = makeFixture();
    const dir = path.join(fx.outside, 'work');
    mkdirSync(dir);
    const mountinfo = '25 1 8:1 / / rw - ext4 /dev/sda1 rw';
    const out = await measureDisk(HOME, rig({ env: { CCRC_WORK_MOUNTS: dir }, mountinfo }).seams);
    expect(out.expectedMounts).toEqual([{ path: dir, mounted: false }]);
  });

  it('an unset or empty CCRC_WORK_MOUNTS names no expected mount', async () => {
    expect((await measureDisk(HOME, rig({ env: {} }).seams)).expectedMounts).toEqual([]);
    expect((await measureDisk(HOME, rig({ env: { CCRC_WORK_MOUNTS: '  ' } }).seams)).expectedMounts).toEqual([]);
  });
});

const ROSTER = JSON.stringify({
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'Lane A', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'Lane B', configDirSuffix: '.lane-b', exec: { kind: 'external' }, homeAble: true, hue: 'amber', telemetry: 'none' },
  ],
});

describe('the disk op on the wire', () => {
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await agent?.close();
    agent = undefined;
  });
  async function connect(fx: Fixture, r: Rig): Promise<TestClient> {
    agent = await boot(fx, { diskSeams: r.seams });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }

  it('the op is in ready.ops', async () => {
    const c = await connect(makeFixture(), rig());
    expect((await c.hello() as AgentReady).ops).toContain(DISK_OP);
  });

  it('answers the measurement, with no request field', async () => {
    const r = rig();
    const c = await connect(makeFixture(), r);
    await c.hello();
    c.send({ t: 'req', id: 7, op: 'disk' });
    const res = await c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === 7) as
      { ok: boolean; filesystems: unknown[]; expectedMounts: unknown[]; missing: unknown[] };
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.filesystems) && Array.isArray(res.expectedMounts) && Array.isArray(res.missing)).toBe(true);
    expect(res.filesystems.length).toBeGreaterThan(0);
  });

  it('a request with any field is a bad request, and nothing is statted', async () => {
    const r = rig();
    const c = await connect(makeFixture(), r);
    await c.hello();
    for (const [id, extra] of [[8, { path: '/etc' }], [9, { roots: ['/'] }], [10, { x: 1 }]] as const) {
      c.send({ t: 'req', id, op: 'disk', ...extra });
      const res = await c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as
        { ok: boolean; err?: string };
      expect(res).toMatchObject({ ok: false, err: 'bad-request' });
    }
    expect(r.statfsCalls).toEqual([]);
    expect(r.statCalls).toEqual([]);
  });

  it('every path the op ever stats comes from the work roots, none from the request', async () => {
    const fx = makeFixture();
    const r = rig();
    const c = await connect(fx, r);
    await c.hello();
    c.send({ t: 'req', id: 11, op: 'disk' });
    await c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === 11);
    const fromRoots = (p: string): boolean => p === '/tmp' || p === fx.home || p.startsWith(`${fx.home}/`);
    expect(r.statfsCalls.length).toBeGreaterThan(0);
    expect(r.statfsCalls.filter((p) => !fromRoots(p))).toEqual([]);
    expect(r.statCalls.filter((p) => !fromRoots(p))).toEqual([]);
  });
});
