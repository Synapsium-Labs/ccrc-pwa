// D-7898: the walk that counts and sizes work kept inside Claude Code's transcript folders, and its place in the `disk`
// op. The walk runs on real fixture trees (a tmp HOME, never a live one); the faults (a read that fails, a read that
// never answers, a clock past the bound) are injected. `server/test/transcript-work.test.ts` holds doctor's bash twin
// equal to this walk on the same tree.
import { describe, expect, it } from 'vitest';
import { linkSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { realWalkSeams, walkTranscriptWork, type WalkSeams } from '../src/transcriptWork.js';
import { measureDisk, transcriptWorkSettled, type DiskSeams } from '../src/disk.js';
import { TRANSCRIPT_WORK_TOP } from '../../shared/disk.js';

const U1 = '0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6';
const U2 = '1c7d2e3f-4051-4b62-9c73-8d94ea5fb607';
const SLUG = '-w-project-a';

const put = (p: string, bytes: number): void => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, 'x'.repeat(bytes));
};

/** A config dir whose `projects/` holds only the shapes Claude Code writes. */
function transcriptsOnly(dir: string): void {
  const s = path.join(dir, 'projects', SLUG);
  put(path.join(s, `${U1}.jsonl`), 100);
  put(path.join(s, U1, 'subagents', 'agent-a.jsonl'), 10);
  put(path.join(s, U1, 'tool-results', 'r.txt'), 10);
  put(path.join(s, U1, 'workflows', 'w.json'), 10);
  put(path.join(s, 'memory', 'MEMORY.md'), 10);
  mkdirSync(path.join(dir, 'projects', '-w-project-b'), { recursive: true });
  symlinkSync(path.join(dir, 'shared-memory'), path.join(dir, 'projects', '-w-project-b', 'memory'));
}

const walk = (roots: { account: string; dir: string }[], over: Partial<WalkSeams> = {}) =>
  walkTranscriptWork(roots, { ...realWalkSeams(), ...over });

describe('walkTranscriptWork (D-7898)', () => {
  it('a projects tree holding only the transcript shapes counts nothing', async () => {
    const dir = mkTmp('tw-only-');
    transcriptsOnly(dir);
    expect(await walk([{ account: 'lane-a', dir }])).toMatchObject({ measured: true, entries: 0, bytes: 0, top: [] });
  });

  it('a config dir with no projects/ holds nothing; one that is absent too', async () => {
    const dir = mkTmp('tw-none-');
    expect(await walk([{ account: 'lane-a', dir }, { account: 'lane-b', dir: path.join(dir, 'gone') }]))
      .toMatchObject({ measured: true, entries: 0, bytes: 0 });
  });

  it('a planted scratch git repo under a slug is counted, named and sized', async () => {
    const dir = mkTmp('tw-repo-');
    transcriptsOnly(dir);
    const repo = path.join(dir, 'projects', SLUG, 'scratch-repo');
    put(path.join(repo, '.git', 'HEAD'), 23);
    put(path.join(repo, 'src', 'a.ts'), 1000);
    const r = await walk([{ account: 'lane-a', dir }]);
    expect(r).toMatchObject({ measured: true, entries: 1, bytes: 1023, top: [{ name: `lane-a/${SLUG}/scratch-repo`, bytes: 1023 }] });
  });

  it('an entry inside a session directory that Claude Code does not write is counted, with the session in its name', async () => {
    const dir = mkTmp('tw-session-');
    transcriptsOnly(dir);
    put(path.join(dir, 'projects', SLUG, U1, 'recovery', 'notes.md'), 40);
    put(path.join(dir, 'projects', SLUG, U1, 'report.html'), 7);
    const r = await walk([{ account: 'lane-a', dir }]);
    expect(r).toMatchObject({ measured: true, entries: 2, bytes: 47 });
    if (!r.measured) throw new Error('unmeasured');
    expect(r.top.map((e) => e.name)).toEqual([`lane-a/${SLUG}/${U1}/recovery`, `lane-a/${SLUG}/${U1}/report.html`]);
  });

  it('the shapes are exact: a wrong kind, a near-uuid and a stray file each count', async () => {
    const dir = mkTmp('tw-kinds-');
    const s = path.join(dir, 'projects', SLUG);
    mkdirSync(path.join(s, `${U2}.jsonl`), { recursive: true });          // a directory named like a transcript
    put(path.join(s, U1), 3);                                              // a file named like a session directory
    put(path.join(s, `${U1.toUpperCase()}.jsonl`), 5);                     // not the lowercase form
    put(path.join(s, U2, 'subagents'), 2);                                 // a file where a directory belongs
    put(path.join(s, 'probe.txt'), 1);
    put(path.join(dir, 'projects', 'stray.txt'), 4);                       // a file directly under projects/
    const r = await walk([{ account: 'lane-a', dir }]);
    if (!r.measured) throw new Error('unmeasured');
    expect(r.entries).toBe(6);
    expect(r.bytes).toBe(15);
    expect(r.top.length).toBe(TRANSCRIPT_WORK_TOP);
  });

  it('a link is never followed: it counts as itself, and memory may be one', async () => {
    const dir = mkTmp('tw-link-');
    transcriptsOnly(dir);
    const big = mkTmp('tw-link-target-');
    put(path.join(big, 'large.bin'), 50_000);
    const link = path.join(dir, 'projects', SLUG, 'build-out');
    symlinkSync(big, link);
    const r = await walk([{ account: 'lane-a', dir }]);
    if (!r.measured) throw new Error('unmeasured');
    expect(r.entries).toBe(1);
    expect(r.bytes).toBe(big.length);   // a link's own size is its target's length
  });

  it('a hardlinked file inside one entry is sized once', async () => {
    const dir = mkTmp('tw-hard-');
    const e = path.join(dir, 'projects', SLUG, 'out');
    put(path.join(e, 'a.bin'), 300);
    linkSync(path.join(e, 'a.bin'), path.join(e, 'b.bin'));
    expect(await walk([{ account: 'lane-a', dir }])).toMatchObject({ measured: true, entries: 1, bytes: 300 });
  });

  it('names the largest five, by bytes and then by name', async () => {
    const dir = mkTmp('tw-top-');
    const s = path.join(dir, 'projects', SLUG);
    for (const [n, b] of [['a', 5], ['b', 9], ['c', 9], ['d', 1], ['e', 7], ['f', 2], ['g', 3]] as const) put(path.join(s, n), b);
    const r = await walk([{ account: 'lane-a', dir }]);
    if (!r.measured) throw new Error('unmeasured');
    expect(r.entries).toBe(7);
    expect(r.bytes).toBe(36);
    expect(r.top.map((e) => `${e.name.split('/').pop()}:${e.bytes}`)).toEqual(['b:9', 'c:9', 'e:7', 'a:5', 'g:3']);
  });

  it('a read that fails anywhere makes the whole walk unmeasured, never a smaller count', async () => {
    const dir = mkTmp('tw-fail-');
    put(path.join(dir, 'projects', SLUG, 'out', 'a'), 1);
    const real = realWalkSeams();
    const r = await walk([{ account: 'lane-a', dir }], {
      readdir: async (p) => {
        if (p.endsWith(`${path.sep}out`)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        return real.readdir(p);
      },
    });
    expect(r).toMatchObject({ measured: false, why: 'failed' });
  });

  it('a walk past its bound is unmeasured (timeout)', async () => {
    const dir = mkTmp('tw-slow-');
    transcriptsOnly(dir);
    let t = 0;
    const r = await walk([{ account: 'lane-a', dir }], { now: () => (t += 1000), deadlineMs: 3000 });
    expect(r).toMatchObject({ measured: false, why: 'timeout' });
  });

  it('a read that never answers ends the walk at its bound (timeout)', async () => {
    const dir = mkTmp('tw-hang-');
    transcriptsOnly(dir);
    const t0 = Date.now();
    const r = await walk([{ account: 'lane-a', dir }], { readdir: () => new Promise<never>(() => {}), deadlineMs: 100 });
    expect(r).toMatchObject({ measured: false, why: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

const ROSTER = (suffixA: string, suffixB: string): string => JSON.stringify({
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'Lane A', configDirSuffix: suffixA, exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'Lane B', configDirSuffix: suffixB, exec: { kind: 'external' }, homeAble: true, hue: 'amber', telemetry: 'none' },
  ],
});

/** `measureDisk`'s seams with the statfs side answered and the walk real; each call to this makes a fresh walk memory. */
function seamsFor(home: string, roster: string | null, over: Partial<DiskSeams> = {}): Partial<DiskSeams> {
  const stat = async (): Promise<{ dev: number }> => ({ dev: 2049 });
  return {
    stat,
    statfs: async () => ({ bsize: 4096, blocks: 1000, bfree: 400, bavail: 300, files: 5000, ffree: 2000 }),
    readMountinfo: () => null,
    readFile: (p) => {
      if (roster === null || p !== path.join(home, '.ccrc', 'accounts.json')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return roster;
    },
    env: {},
    deadlineMs: 50,
    ...over,
  };
}

describe('the disk op carries the latest walk (D-7898)', () => {
  it('the first reply carries none, and the next one carries the walk of every roster config dir', async () => {
    const home = mkTmp('tw-op-');
    put(path.join(home, '.lane-a', 'projects', SLUG, 'scratch', 'f'), 11);
    put(path.join(home, '.lane-b', 'projects', SLUG, U1, 'report.md'), 4);
    const seams = seamsFor(home, ROSTER('.lane-a', '.lane-b'));
    expect((await measureDisk(home, seams)).transcriptWork).toBeUndefined();
    await transcriptWorkSettled(seams.stat!);
    const r = (await measureDisk(home, seams)).transcriptWork;
    expect(r).toMatchObject({ measured: true, entries: 2, bytes: 15 });
    expect(r?.measured === true && r.top.map((e) => e.name)).toEqual([`lane-a/${SLUG}/scratch`, `lane-b/${SLUG}/${U1}/report.md`]);
  });

  it('a roster that cannot be parsed is a walk that failed; an absent roster has nothing to count', async () => {
    const home = mkTmp('tw-op-roster-');
    const bad = seamsFor(home, '{not json');
    await measureDisk(home, bad);
    await transcriptWorkSettled(bad.stat!);
    expect((await measureDisk(home, bad)).transcriptWork).toMatchObject({ measured: false, why: 'failed' });
    const none = seamsFor(home, null);
    await measureDisk(home, none);
    await transcriptWorkSettled(none.stat!);
    expect((await measureDisk(home, none)).transcriptWork).toMatchObject({ measured: true, entries: 0 });
  });

  it('walks again only once the last walk is older than the refresh interval', async () => {
    const home = mkTmp('tw-op-refresh-');
    put(path.join(home, '.lane-a', 'projects', SLUG, 'scratch'), 3);
    let now = 1_000_000;
    const real = realWalkSeams();
    const seams = seamsFor(home, ROSTER('.lane-a', '.lane-b'), { walk: { ...real, now: () => now }, walkRefreshMs: 60_000 });
    await measureDisk(home, seams);
    await transcriptWorkSettled(seams.stat!);
    put(path.join(home, '.lane-a', 'projects', SLUG, 'more'), 4);
    now += 59_000;
    await measureDisk(home, seams);
    await transcriptWorkSettled(seams.stat!);
    expect((await measureDisk(home, seams)).transcriptWork).toMatchObject({ entries: 1, at: 1_000_000 });
    now += 2_000;
    await measureDisk(home, seams);
    await transcriptWorkSettled(seams.stat!);
    expect((await measureDisk(home, seams)).transcriptWork).toMatchObject({ entries: 2, at: 1_061_000 });
  });
});

describe('the walk reads only paths the roster on this box names (D-7898)', () => {
  it('every directory it lists and every entry it stats is under a roster config dir', async () => {
    const home = mkTmp('tw-op-paths-');
    put(path.join(home, '.lane-a', 'projects', SLUG, 'scratch', 'f'), 1);
    transcriptsOnly(path.join(home, '.lane-b'));
    const real = realWalkSeams();
    const seen: string[] = [];
    const seams = seamsFor(home, ROSTER('.lane-a', '.lane-b'), {
      walk: { ...real, readdir: (p) => { seen.push(p); return real.readdir(p); }, lstat: (p) => { seen.push(p); return real.lstat(p); } },
    });
    await measureDisk(home, seams);
    await transcriptWorkSettled(seams.stat!);
    expect(seen.length).toBeGreaterThan(0);
    const roots = ['.lane-a', '.lane-b'].map((s) => path.join(home, s, 'projects'));
    expect(seen.filter((p) => !roots.some((r) => p === r || p.startsWith(`${r}${path.sep}`)))).toEqual([]);
  });
});
