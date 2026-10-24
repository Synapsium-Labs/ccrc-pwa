// D-6616 (fleet disk retention plan Task DR-4, spec §2.5): the disk notice. `diskNotice(prev, next)` is the pure L1
// decision (what to say when the fleet's level moves); the second block proves what `sweepDisk` does with it through the
// notice funnel: one push per new level in an episode, a clear recorded and never pushed, and the key read before the
// write so a restarted watcher inside the same episode says nothing twice.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { readDiskEpisode } from '../src/diskepisode.js';
import { diskMarkFate, diskNotice, diskVerdict, type DiskVerdict } from '../src/disk.js';
import { localIO, type FleetIO, type MeasuredDisk } from '../src/io.js';
import { NotifyLog } from '../src/notifylog.js';
import type { PushPayload } from '../src/push.js';
import { FleetWatcher } from '../src/watch.js';
import type { DiskFilesystem, DiskLevel, DiskMeasured } from '../../shared/disk.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const GIB = 1024 ** 3;
const fsAt = (usedPct: number, dev = '8:1', roots: string[] = ['home', 'projects']): DiskFilesystem => ({
  dev, mount: '/srv/secret-mount', fsType: 'ext4', roots, sizeBytes: 100 * GIB, availBytes: (100 - usedPct) * GIB,
  freeBytes: (100 - usedPct) * GIB, files: 1_000_000, filesFree: 900_000, readOnly: false,
});
/** A verdict as the decider leaves it, built by hand so each case names exactly the level it starts from. */
const verdict = (level: DiskLevel, usedPct: number, episode = 100, mountsDown: string[] = []): DiskVerdict => ({
  at: episode + 1, level, episode, mountsDown, expectedMounts: mountsDown.map((p) => ({ path: p, mounted: false })),
  filesystems: [{ ...fsAt(usedPct), level, pending: null }],
});

describe('diskMarkFate: what a process with no episode does with the durable mark', () => {
  const m = (...fs: DiskFilesystem[]): DiskMeasured => ({ filesystems: fs, expectedMounts: [], missing: [] });
  const fate = (devs: string[], ...fs: DiskFilesystem[]) => diskMarkFate(devs, diskVerdict(null, m(...fs), 10), m(...fs));
  it('resumes while a marked filesystem stands at warn/critical, whatever another reads', () => {
    expect(fate(['1'], fsAt(86, '1'), fsAt(40, '2'))).toBe('resume');
    expect(fate(['2'], fsAt(86, '1'), fsAt(93, '2'))).toBe('resume');
  });
  it('forgets once every marked filesystem is below the clear band or absent, whatever another reads', () => {
    expect(fate(['1'], fsAt(80, '1'), fsAt(84, '2'))).toBe('forget');
    expect(fate(['9'], fsAt(40, '1'))).toBe('forget');
    expect(fate(['1', '2'], fsAt(40, '1'), fsAt(84, '2'))).toBe('keep');
  });
  it('keeps a marked filesystem inside the band, and inodes count', () => {
    expect(fate(['1'], fsAt(84, '1'))).toBe('keep');
    expect(fate(['1'], { ...fsAt(40, '1'), filesFree: 160_000 })).toBe('keep');
  });
  it('a read with nothing measurable forgets nothing, and a mark with no filesystem is stale', () => {
    expect(fate(['1'])).toBe('keep');
    expect(fate(['1'], { ...fsAt(40, '1'), sizeBytes: 0, files: 0 })).toBe('keep');
    expect(fate([], fsAt(86, '1'))).toBe('forget');
  });
});

describe('diskNotice: what to say when the fleet level moves', () => {
  it('ok -> warn pushes, once, with a key that names the filesystem, the level and the episode', () => {
    const n = diskNotice(verdict('ok', 40), verdict('warn', 86))!;
    expect(n.mode).toBe('push');
    expect(n.dedupeKey).toBe('disk:8:1:warn:100');
  });

  it('a first sighting already at warn or critical pushes too', () => {
    expect(diskNotice(null, verdict('critical', 95))!.mode).toBe('push');
    expect(diskNotice(null, verdict('ok', 40))).toBeNull();
  });

  it('warn -> critical pushes again, under a key of its own', () => {
    const a = diskNotice(verdict('ok', 40), verdict('warn', 86))!;
    const b = diskNotice(verdict('warn', 86), verdict('critical', 93))!;
    expect(b.mode).toBe('push');
    expect(b.dedupeKey).not.toBe(a.dedupeKey);
  });

  it('a level that does not move says nothing, and neither does a fall from critical to warn', () => {
    expect(diskNotice(verdict('warn', 86), verdict('warn', 87))).toBeNull();
    expect(diskNotice(verdict('critical', 93), verdict('warn', 88))).toBeNull();
  });

  it('critical -> warn -> critical in one episode reuses the keys, so each level is pushed once', () => {
    const w1 = diskNotice(verdict('ok', 40), verdict('warn', 86))!;
    const c1 = diskNotice(verdict('warn', 86), verdict('critical', 93))!;
    const c2 = diskNotice(verdict('warn', 88), verdict('critical', 93))!;
    expect(c2.dedupeKey).toBe(c1.dedupeKey);
    expect(new Set([w1.dedupeKey, c1.dedupeKey]).size).toBe(2);
  });

  it('a new episode (a rise from ok) has a new key', () => {
    const a = diskNotice(verdict('ok', 40, 100), verdict('warn', 86, 100))!;
    const b = diskNotice(verdict('ok', 40, 900), verdict('warn', 86, 900))!;
    expect(b.dedupeKey).not.toBe(a.dedupeKey);
  });

  it('a clear to ok is recorded, never pushed', () => {
    const n = diskNotice(verdict('warn', 86), verdict('ok', 70))!;
    expect(n.mode).toBe('record-only');
    expect(n.dedupeKey).toBe('disk:fleet:clear:100');
  });

  it('ok -> unmeasured and unmeasured -> ok say nothing', () => {
    expect(diskNotice(verdict('ok', 40), verdict('unmeasured', 40))).toBeNull();
    expect(diskNotice(verdict('unmeasured', 40), verdict('ok', 40))).toBeNull();
  });

  it('the title names the percentage and the free bytes; the body names labels, never an absolute path', () => {
    const n = diskNotice(verdict('ok', 40), verdict('critical', 93))!;
    expect(n.title).toBe('Fleet disk 93% full · 7 GiB free');
    expect(n.body).toContain('home');
    expect(n.body).toContain('projects');
    expect(`${n.title} ${n.body}`).not.toMatch(/\/srv|\/secret-mount|\/home\//);
  });

  it('a missing expected mount pages without naming its path', () => {
    const next = { ...verdict('ok', 40), level: 'critical' as const, mountsDown: ['/data/vol'], expectedMounts: [{ path: '/data/vol', mounted: false }] };
    const n = diskNotice(verdict('ok', 40), next)!;
    expect(n.mode).toBe('push');
    expect(`${n.title} ${n.body}`).not.toContain('/data/vol');
    expect(n.body).toMatch(/not mounted/);
  });

  it('a missing expected mount is named by its position, and still named when a filesystem is critical too', () => {
    const exp = [{ path: '/a', mounted: true }, { path: '/b', mounted: false }];
    const only = diskNotice(verdict('ok', 40), { ...verdict('ok', 40), level: 'critical', mountsDown: ['/b'], expectedMounts: exp, filesystems: [] })!;
    expect(only.body).toContain('#2');
    const both = diskNotice(verdict('ok', 40), { ...verdict('critical', 93), mountsDown: ['/b'], expectedMounts: exp })!;
    expect(both.body).toContain('#2');
    expect(both.body).not.toMatch(/\/b/);
  });

  it('an episode opens at a rise to warn/critical only: ok and unmeasured verdicts carry none', () => {
    const m = (f: number): DiskMeasured => ({ filesystems: [fsAt(f)], expectedMounts: [], missing: [] });
    const ok = diskVerdict(null, m(40), 10);
    expect(ok.episode).toBeUndefined();
    const warn1 = diskVerdict(diskVerdict(ok, m(86), 20), m(86), 30);
    expect(warn1.episode).toBe(30);
    const miss = diskVerdict(ok, { filesystems: [fsAt(40)], expectedMounts: [{ path: '/m', mounted: false }], missing: [] }, 40);
    expect(miss.level).toBe('unmeasured');
    expect(miss.episode).toBeUndefined();
  });
});

/** A watcher over a real coord store and notify log, whose fleet io answers from `answers` (the last repeats). */
async function rig(home: string, answers: MeasuredDisk[], now: () => number) {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const push = { notify: vi.fn(async (_p: PushPayload) => undefined) };
  let n = 0;
  const io: FleetIO = { ...localIO, statfsMeasured: async () => answers[Math.min(n++, answers.length - 1)]! };
  const deps = { ...testDeps(home), io, coord, notifyLog, push, presence: { isVisible: () => false } };
  vi.spyOn(Date, 'now').mockImplementation(now);
  const watcher = new FleetWatcher(deps as never, new Bus());
  const rewind = (): void => { (watcher as unknown as { lastDiskSweep: number }).lastDiskSweep = 1; };
  const sweep = async (): Promise<void> => { rewind(); await watcher.sweepDisk(); };
  return { watcher, coord, push, sweep };
}
const reading = (pct: number): MeasuredDisk => ({ ok: true, measured: { filesystems: [fsAt(pct)], expectedMounts: [], missing: [] } satisfies DiskMeasured });
/** Two equal readings make a level hold (the decider's debounce). */
const hold = (pct: number): MeasuredDisk[] => [reading(pct), reading(pct)];

describe('sweepDisk sends the notice through the funnel', () => {
  it('ok -> warn -> critical pushes once at each level, and the rest of the episode is quiet', async () => {
    const r = await rig(mkTmp('ccrc-dn-'), [...hold(40), ...hold(86), ...hold(86), ...hold(93), ...hold(93)], () => 5_000_000);
    for (let i = 0; i < 4; i += 1) await r.sweep();
    expect(r.push.notify.mock.calls.length).toBe(1);
    expect(r.push.notify.mock.calls[0]![0]).toMatchObject({ title: 'Fleet disk 86% full · 14 GiB free', sessionId: '' });
    for (let i = 0; i < 4; i += 1) await r.sweep();
    expect(r.push.notify.mock.calls.length).toBe(2);
    expect(r.push.notify.mock.calls[1]![0]).toMatchObject({ title: 'Fleet disk 93% full · 7 GiB free' });
    expect(r.coord.feedEvents(10).map((e) => [e.kind, e.sessionId])).toEqual([['coord', ''], ['coord', '']]);
  });

  it('a clear to ok is recorded in the feed and never pushed', async () => {
    const r = await rig(mkTmp('ccrc-dn-'), [...hold(40), ...hold(86), ...hold(40)], () => 5_000_000);
    for (let i = 0; i < 4; i += 1) await r.sweep();
    expect(r.push.notify.mock.calls.length).toBe(1);
    for (let i = 0; i < 3; i += 1) await r.sweep();
    expect(r.push.notify.mock.calls.length).toBe(1);
    expect(r.coord.feedEvents(10).map((e) => e.title)).toContain('Fleet disk back to normal');
  });

  it('a rise after a clear is a new episode and pushes again', async () => {
    let clock = 5_000_000;
    const r = await rig(mkTmp('ccrc-dn-'), [...hold(40), ...hold(86), ...hold(40), ...hold(86)], () => clock);
    for (let i = 0; i < 8; i += 1) { clock += 60_000; await r.sweep(); }
    expect(r.push.notify.mock.calls.length).toBe(2);
  });

  it('a restarted watcher inside the same episode re-sends nothing, though the clock moved on: the episode is durable', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const first = await rig(home, [...hold(40), ...hold(86)], () => clock);
    for (let i = 0; i < 4; i += 1) await first.sweep();
    expect(first.push.notify.mock.calls.length).toBe(1);
    clock += 6 * 3_600_000;
    const again = await rig(home, [...hold(86), ...hold(86)], () => clock);
    for (let i = 0; i < 4; i += 1) await again.sweep();
    expect(again.push.notify.mock.calls.length).toBe(0);
    expect(again.coord.feedEvents(10).length).toBe(1);
  });

  it('a clear forgets the episode: a restart after it that meets a new warn pushes', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const first = await rig(home, [...hold(40), ...hold(86), ...hold(40)], () => clock);
    for (let i = 0; i < 6; i += 1) { clock += 60_000; await first.sweep(); }
    expect(first.push.notify.mock.calls.length).toBe(1);
    clock += 3_600_000;
    const again = await rig(home, [...hold(86)], () => clock);
    for (let i = 0; i < 2; i += 1) { clock += 60_000; await again.sweep(); }
    expect(again.push.notify.mock.calls.length).toBe(1);
  });

  const missingMount = (): MeasuredDisk => ({
    ok: true, measured: { filesystems: [fsAt(40)], expectedMounts: [{ path: '/data/vol', mounted: false }], missing: [] } satisfies DiskMeasured,
  });

  it('a restart with a mount still missing re-sends nothing: the first pass after boot is unmeasured, the second critical', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const first = await rig(home, [missingMount()], () => clock);
    for (let i = 0; i < 3; i += 1) { clock += 60_000; await first.sweep(); }
    expect(first.push.notify.mock.calls.length).toBe(1);
    clock += 6 * 3_600_000;
    const again = await rig(home, [missingMount()], () => clock);
    for (let i = 0; i < 3; i += 1) { clock += 60_000; await again.sweep(); }
    expect(again.push.notify.mock.calls.length).toBe(0);
  });

  it('a restart inside the clear band does not erase the mark: the next standing pass after it is still the same episode', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const first = await rig(home, [...hold(40), ...hold(86)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await first.sweep(); }
    expect(first.push.notify.mock.calls.length).toBe(1);
    const again = await rig(home, [reading(84)], () => clock);
    await again.sweep();
    expect(readDiskEpisode(path.join(home, '.ccrc'))).not.toBeNull();
  });

  it('a boot reading below the clear band forgets the mark, though this process held no episode of its own', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const first = await rig(home, [...hold(40), ...hold(86)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await first.sweep(); }
    const again = await rig(home, [reading(40)], () => clock);
    await again.sweep();
    expect(readDiskEpisode(path.join(home, '.ccrc'))).toBeNull();
  });

  it('a stale mark never silences a new episode: warn, a restart inside the band, days at 40%, then a restart at a new rise', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const p1 = await rig(home, [...hold(40), ...hold(86)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await p1.sweep(); }
    expect(p1.push.notify.mock.calls.length).toBe(1);
    clock += 3_600_000;
    const p2 = await rig(home, [reading(84), reading(40), reading(40), reading(86)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(0);
    clock += 6 * 3_600_000;
    const p3 = await rig(home, [...hold(86)], () => clock);
    for (let i = 0; i < 2; i += 1) { clock += 60_000; await p3.sweep(); }
    expect(p3.push.notify.mock.calls.length).toBe(1);
  });

  it('a restart at 84% that then sees 86% stays quiet: the rise is the marked episode, not a new one', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const first = await rig(home, [...hold(40), ...hold(86)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await first.sweep(); }
    expect(first.push.notify.mock.calls.length).toBe(1);
    clock += 3_600_000;
    const again = await rig(home, [reading(84), ...hold(86)], () => clock);
    for (let i = 0; i < 3; i += 1) { clock += 60_000; await again.sweep(); }
    expect(again.push.notify.mock.calls.length).toBe(0);
  });

  it('a clear of the alarmed filesystem forgets the mark though another filesystem sits inside the band: a later restart at a new rise pushes', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const two = (a: number, b: number): MeasuredDisk => ({
      ok: true, measured: { filesystems: [fsAt(a, '1'), fsAt(b, '2')], expectedMounts: [], missing: [] } satisfies DiskMeasured,
    });
    const both = (a: number, b: number): MeasuredDisk[] => [two(a, b), two(a, b)];
    const p1 = await rig(home, [...both(40, 84), ...both(86, 84), ...both(70, 84)], () => clock);
    for (let i = 0; i < 6; i += 1) { clock += 60_000; await p1.sweep(); }
    expect(p1.push.notify.mock.calls.length).toBe(1);
    clock += 24 * 3_600_000;
    const p2 = await rig(home, both(86, 84), () => clock);
    for (let i = 0; i < 2; i += 1) { clock += 60_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(1);
  });

  const two = (a: number, b: number): MeasuredDisk => ({
    ok: true, measured: { filesystems: [fsAt(a, '1'), fsAt(b, '2')], expectedMounts: [], missing: [] } satisfies DiskMeasured,
  });
  const both = (a: number, b: number): MeasuredDisk[] => [two(a, b), two(a, b)];

  it('a restart that boots with the alarmed filesystem clear forgets the mark though another sits in the band: a later rise pushes', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const p1 = await rig(home, [...both(40, 84), ...both(86, 84)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await p1.sweep(); }
    expect(p1.push.notify.mock.calls.length).toBe(1);
    const p2 = await rig(home, [...both(80, 84), ...both(80, 84), ...both(86, 84)], () => clock);
    for (let i = 0; i < 6; i += 1) { clock += 24 * 3_600_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(1);
  });

  it('with no restart gap: the first process dies holding warn at 84%, the second sees the real fall, and a later rise pushes', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const p1 = await rig(home, [...both(40, 83), ...both(86, 83), ...both(84, 83)], () => clock);
    for (let i = 0; i < 6; i += 1) { clock += 60_000; await p1.sweep(); }
    expect(p1.push.notify.mock.calls.length).toBe(1);
    const p2 = await rig(home, [...both(80, 84), ...both(80, 83), ...both(86, 84)], () => clock);
    for (let i = 0; i < 6; i += 1) { clock += 6 * 3_600_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(1);
  });

  it('a restart while the marked filesystem stands re-sends nothing, whatever another filesystem reads', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const p1 = await rig(home, [...both(40, 84), ...both(86, 84)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await p1.sweep(); }
    const p2 = await rig(home, both(86, 40), () => clock);
    for (let i = 0; i < 2; i += 1) { clock += 6 * 3_600_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(0);
  });

  it('the mark names the filesystem whose rise pushed it, and a mark with no filesystem is stale: a restart at warn pushes', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const p1 = await rig(home, [...both(40, 40), ...both(86, 40)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await p1.sweep(); }
    const markFile = path.join(home, '.ccrc', 'disk-episode');
    expect(readFileSync(markFile, 'utf8').trim()).toMatch(/^\d+ 1$/);
    writeFileSync(markFile, '1\n');
    const p2 = await rig(home, both(86, 40), () => clock);
    for (let i = 0; i < 2; i += 1) { clock += 60_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(1);
  });

  it('a restart resumes the marked episode only for the marked filesystem: another one standing is a new episode and pushes', async () => {
    const home = mkTmp('ccrc-dn-');
    let clock = 5_000_000;
    const p1 = await rig(home, [...both(40, 40), ...both(86, 40)], () => clock);
    for (let i = 0; i < 4; i += 1) { clock += 60_000; await p1.sweep(); }
    expect(p1.push.notify.mock.calls.length).toBe(1);
    const p2 = await rig(home, both(84, 86), () => clock);
    for (let i = 0; i < 2; i += 1) { clock += 60_000; await p2.sweep(); }
    expect(p2.push.notify.mock.calls.length).toBe(1);
  });
});
