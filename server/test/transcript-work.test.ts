// D-7898: doctor's `transcript_work` check, its bash twins of `shared/disk.ts`, and its agreement with the agent's walk.
// Work kept inside Claude Code's transcript folders (a config dir's `projects/<slug>/...`) is counted and sized; a
// planted scratch repository WARNs by name, a tree holding only the shapes Claude Code writes PASSes, and a walk out of
// time is unmeasured, never a PASS. Fixture HOMEs only (`healthy()`), the check sourced alone as `carry-copies`' suite
// does. Large files are SPARSE (`truncate`): their apparent size is what both twins count, and they cost no disk.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, REPO, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, linkReal, runDoctor, shq, stub } from './ccrc-doctorFixture.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import {
  TRANSCRIPT_SHAPES, TRANSCRIPT_WORK_DEADLINE_MS, TRANSCRIPT_WORK_TOP, TRANSCRIPT_WORK_WARN_ENTRY_BYTES,
  TRANSCRIPT_WORK_WARN_TOTAL_BYTES, isTranscriptShape,
} from '../../shared/disk.js';
import { realWalkSeams, walkTranscriptWork } from '../../agent/src/transcriptWork.js';
import { readDiskHealth, readDiskMeasured, type DiskMeasured, type TranscriptWorkMeasured } from '../../shared/disk.js';
import { transcriptWorkBlock } from '../src/disk.js';
import { localIO, type FleetIO, type MeasuredDisk } from '../src/io.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const U1 = '0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6';
const U2 = '1c7d2e3f-4051-4b62-9c73-8d94ea5fb607';
const SLUG = '-w-project-a';
const MIB = 1024 ** 2;
const IS_DARWIN = process.platform === 'darwin';

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'Lane A', configDirSuffix: '.claude-lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'Lane B', configDirSuffix: '.claude-lane-b', exec: { kind: 'external' }, homeAble: true, hue: 'amber', telemetry: 'none' },
  ],
};

const put = (p: string, bytes: number): void => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');
  truncateSync(p, bytes);
};

/** Only the shapes Claude Code writes, in both lanes' config dirs. */
function transcripts(home: string): void {
  for (const cfg of ['.claude-lane-a', '.claude-lane-b']) {
    const s = join(home, cfg, 'projects', SLUG);
    put(join(s, `${U1}.jsonl`), 4096);
    put(join(s, U1, 'subagents', 'agent-a.jsonl'), 100);
    put(join(s, U1, 'tool-results', 'r.txt'), 100);
    put(join(s, U1, 'workflows', 'w.json'), 100);
    put(join(s, `${U2}.jsonl`), 10);
    put(join(s, 'memory', 'MEMORY.md'), 10);
  }
  mkdirSync(join(home, '.claude-lane-b', 'projects', '-w-project-b'), { recursive: true });
  symlinkSync(join(home, 'shared-memory'), join(home, '.claude-lane-b', 'projects', '-w-project-b', 'memory'));
}

/** A box with the two-lane roster projected and the tools the check sizes with on this platform. */
/** `_plat_bytes`' tools on this platform: `du -sb | head | cut` on Linux, `find -ls | awk` with its temp file on macOS
 *  (`awk` and `stat` are `healthy()`'s). The first one is the walk's own reader. */
const SIZERS = IS_DARWIN ? ['find', 'mktemp', 'cat'] : ['du', 'head', 'cut'];

/** A box with the two-lane roster projected and the sizing tools: real, or with the reader stubbed to hang. */
function box(prefix: string, sizer: 'real' | 'hangs' = 'real'): string {
  const home = healthy(prefix);
  seedAccountsSh(home, ROSTER);
  // Never a stub written through a link to the real binary: the hanging reader is a fresh file, the rest are links.
  for (const t of sizer === 'hangs' ? SIZERS.slice(1) : SIZERS) linkReal(home, t);
  if (sizer === 'hangs') { linkReal(home, 'sleep'); stub(home, SIZERS[0]!, 'sleep 10'); }
  return home;
}

/** The check alone, sourced: its verdict line and its remedy. */
function check(home: string, env: NodeJS.ProcessEnv = {}): { line: string; remedy: string; code: number } {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_check_transcript_work`],
    { env: { ...doctorEnv(home), ...env }, encoding: 'utf8', timeout: 60_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) transcript_work: /.test(l));
  expect(i, `a transcript_work line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, remedy: lines[i + 1] ?? '', code: r.status ?? -1 };
}

const agentWalk = (home: string) => walkTranscriptWork(
  [{ account: 'lane-a', dir: join(home, '.claude-lane-a') }, { account: 'lane-b', dir: join(home, '.claude-lane-b') }], realWalkSeams());

describe('the bash twins of shared/disk.ts\'s transcript vocabulary (D-7898)', () => {
  const doctor = readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8');
  const bashInt = (name: string): number | null => {
    const m = new RegExp(`^${name}=(\\d+)\\s*$`, 'm').exec(doctor);
    return m ? Number(m[1]) : null;
  };

  it('the bounds, the top count and the walk\'s bound are L0\'s', () => {
    expect(bashInt('_DR_TW_WARN_TOTAL_BYTES')).toBe(TRANSCRIPT_WORK_WARN_TOTAL_BYTES);
    expect(bashInt('_DR_TW_WARN_ENTRY_BYTES')).toBe(TRANSCRIPT_WORK_WARN_ENTRY_BYTES);
    expect(bashInt('_DR_TW_TOP')).toBe(TRANSCRIPT_WORK_TOP);
    expect(bashInt('_DR_TW_DEADLINE_S')).toBe(TRANSCRIPT_WORK_DEADLINE_MS / 1000);
  });

  it('the shape table is L0\'s, level, name and kinds in order', () => {
    const m = /^_DR_TW_SHAPES=\(([^)]*)\)/m.exec(doctor);
    expect(m, '_DR_TW_SHAPES=( ... ) in ccd/ccrc-doctor-checks').not.toBeNull();
    const bash = [...m![1]!.matchAll(/'([^']*)'/g)].map((e) => e[1]!.split('|'));
    expect(bash).toEqual(TRANSCRIPT_SHAPES.map((s) => [s.level, s.name, s.kinds.join(',')]));
  });

  it('the bash matcher answers as L0\'s on every shape, kind and near miss', () => {
    const names = [`${U1}.jsonl`, U1, 'memory', 'subagents', 'tool-results', 'workflows', `${U1.toUpperCase()}.jsonl`,
      `${U1}xjsonl`, `${U1}.jsonl.bak`, `x${U1}`, 'memory.pre-ccrc-20260910', 'probe.txt', 'scratchpad'];
    const cases = (['slug', 'session'] as const).flatMap((level) => names.flatMap((n) =>
      (['file', 'dir', 'link', 'other'] as const).map((kind) => ({ level, n, kind }))));
    const script = cases.map((c) => `_dr_tw_shape ${c.level} ${shq(c.n)} ${c.kind} && echo 1 || echo 0`).join('\n');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n${script}`], { encoding: 'utf8', env: doctorEnv(healthy('tw-match-')) });
    expect(r.stdout.trim().split('\n')).toEqual(cases.map((c) => (isTranscriptShape(c.level, c.n, c.kind) ? '1' : '0')));
  });
});

describe('doctor transcript_work (D-7898)', () => {
  it('PASS in a full doctor run on the healthy fixture, which projects no roster yet', () => {
    const home = healthy('tw-healthy-');
    expect(anyVerdictFor(runDoctor(home).stdout, 'transcript_work'))
      .toBe('PASS transcript_work: no roster config dir is projected yet (~/.ccrc/accounts.sh), so no transcript folder holds work');
  });

  it('PASS when the projects/ trees hold only the shapes Claude Code writes', () => {
    const home = box('tw-only-');
    transcripts(home);
    expect(check(home)).toMatchObject({
      line: 'PASS transcript_work: 0 entries, 0 bytes (0 B), outside Claude Code\'s transcript shapes under 2 config dir(s)\' projects/ folders, within the warn bound (1.00 GiB in all, or 256 MiB in one entry)',
      code: 0,
    });
  });

  it('WARN names a planted scratch git repository, largest first, over the one-entry bound', () => {
    const home = box('tw-repo-');
    transcripts(home);
    const repo = join(home, '.claude-lane-a', 'projects', SLUG, 'scratch-repo');
    put(join(repo, '.git', 'HEAD'), 23);
    put(join(repo, '.git', 'objects', 'pack', 'pack-1.pack'), 300 * MIB);
    put(join(home, '.claude-lane-b', 'projects', SLUG, U1, 'report.md'), 2048);
    const r = check(home);
    expect(r.line).toBe(`WARN transcript_work: 2 entries, ${300 * MIB + 23 + 2048} bytes (300 MiB), outside Claude Code's transcript shapes under 2 config dir(s)' projects/ folders`
      + ` — over the warn bound (1.00 GiB in all, or 256 MiB in one entry); largest: lane-a/${SLUG}/scratch-repo 300 MiB; lane-b/${SLUG}/${U1}/report.md 2 KiB`);
    expect(r.remedy).toMatch(/^ {2}remedy: move each into its workspace or the session's temp root .* doctor deletes nothing;/);
    expect(r.code).toBe(2);
  });

  it('the bounds, at the edge: an entry AT 256 MiB PASSes and one byte over WARNs; the total over 1 GiB WARNs', () => {
    const at = box('tw-edge-at-');
    put(join(at, '.claude-lane-a', 'projects', SLUG, 'out'), TRANSCRIPT_WORK_WARN_ENTRY_BYTES);
    expect(check(at).line).toMatch(/^PASS transcript_work: 1 entries, 268435456 bytes /);
    const over = box('tw-edge-over-');
    put(join(over, '.claude-lane-a', 'projects', SLUG, 'out'), TRANSCRIPT_WORK_WARN_ENTRY_BYTES + 1);
    expect(check(over).line).toMatch(/^WARN transcript_work: 1 entries, 268435457 bytes /);
    const total = box('tw-edge-total-');
    for (const n of ['a', 'b', 'c', 'd', 'e']) put(join(total, '.claude-lane-a', 'projects', SLUG, n), 220 * MIB);
    expect(check(total).line).toMatch(/^WARN transcript_work: 5 entries, 1153433600 bytes \(1\.07 GiB\)/);
  });

  it('a walk out of time is unmeasured: a WARN, never a PASS', () => {
    const home = box('tw-slow-', 'hangs');
    put(join(home, '.claude-lane-a', 'projects', SLUG, 'scratch', 'f'), 10);
    const r = check(home, { CCRC_DOCTOR_TRANSCRIPT_WORK_TIMEOUT: '1' });
    expect(r.line).toBe('WARN transcript_work: the walk of the config dirs\' projects/ transcript folders did not finish within 1s, so the work kept there is unmeasured');
    expect(r.code).toBe(2);
  });

  it('a directory it cannot list is unmeasured, named by its account and slug', () => {
    if (process.getuid?.() === 0) return;   // root lists anything
    const home = box('tw-unlistable-');
    const s = join(home, '.claude-lane-a', 'projects', SLUG);
    put(join(s, 'x'), 1);
    chmodSync(s, 0o000);
    try {
      expect(check(home).line).toBe(`WARN transcript_work: lane-a/${SLUG} could not be read under a config dir's projects/ folder, so the work kept in transcript folders is unmeasured`);
    } finally { chmodSync(s, 0o755); }
  });

  it('an unreadable roster projection is unmeasured', () => {
    const home = box('tw-roster-');
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'this is not bash (\n');
    expect(check(home).line).toBe('WARN transcript_work: the roster projection at ~/.ccrc/accounts.sh could not be read, so the work kept in transcript folders is unmeasured');
  });

  it('SKIP on a server-role box', () => {
    const home = box('tw-server-');
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    expect(check(home)).toMatchObject({ line: 'SKIP transcript_work: this box records CCRC_ROLE=server, so it hosts no sessions and keeps no transcripts', code: 3 });
  });
});

describe('doctor and the agent agree on the same tree (D-7898)', () => {
  it('the count, the bytes and the names doctor reports are the agent walk\'s', async () => {
    const home = box('tw-twins-');
    transcripts(home);
    const a = join(home, '.claude-lane-a', 'projects', SLUG);
    put(join(a, 'scratch-repo', '.git', 'HEAD'), 23);
    put(join(a, 'scratch-repo', 'src', 'main.ts'), 5000);
    put(join(a, U1, 'recovery', 'notes.md'), 700);
    put(join(a, U1, 'scratchpad', 'out.log'), 300);
    put(join(a, 'probe.txt'), 88);
    mkdirSync(join(a, 'memory.pre-ccrc-20260910-141413'), { recursive: true });
    put(join(a, 'memory.pre-ccrc-20260910-141413', 'MEMORY.md'), 12);
    put(join(home, '.claude-lane-b', 'projects', 'stray.txt'), 3);
    symlinkSync(join(home, 'elsewhere'), join(home, '.claude-lane-b', 'projects', SLUG, 'build-out'));
    put(join(home, '.claude-lane-b', 'projects', SLUG, U2, 'landing-baseline', 'a', 'b.json'), 64);

    const w = await agentWalk(home);
    if (!w.measured) throw new Error(`the agent walk did not measure: ${w.why}`);
    expect(w.entries).toBe(8);
    const r = check(home);
    const m = /^PASS transcript_work: (\d+) entries, (\d+) bytes .*; largest: (.*)$/.exec(r.line);
    expect(m, r.line).not.toBeNull();
    expect(Number(m![1])).toBe(w.entries);
    expect(Number(m![2])).toBe(w.bytes);
    expect(m![3]!.split('; ').map((e) => e.replace(/ \d+(\.\d+)? (B|KiB|MiB|GiB)$/, ''))).toEqual(w.top.map((e) => e.name));
  });
});

const walked = (bytes: number, top: number[] = [bytes]): TranscriptWorkMeasured => ({
  measured: true, at: 5, entries: top.length, bytes, top: top.map((b, i) => ({ name: `lane-a/${SLUG}/e${i}`, bytes: b })),
});

describe('the server\'s level for a walk (D-7898)', () => {
  it('the two bounds, at the edge: AT a bound is ok, one byte past it is warn', () => {
    const T = TRANSCRIPT_WORK_WARN_TOTAL_BYTES;
    const E = TRANSCRIPT_WORK_WARN_ENTRY_BYTES;
    expect(transcriptWorkBlock(walked(E)).level).toBe('ok');
    expect(transcriptWorkBlock(walked(E + 1)).level).toBe('warn');
    expect(transcriptWorkBlock(walked(T, [E, E, E, E])).level).toBe('ok');
    expect(transcriptWorkBlock(walked(T + 1, [E, E, E, E, 1])).level).toBe('warn');
    expect(transcriptWorkBlock(walked(0, [])).level).toBe('ok');
  });

  it('a walk that read nothing is unmeasured, with no count that could read as zero work', () => {
    expect(transcriptWorkBlock({ measured: false, at: 9, why: 'timeout' })).toEqual({ at: 9, level: 'unmeasured', entries: 0, bytes: 0, top: [] });
  });
});

describe('the wire readers drop a malformed walk alone (D-7898)', () => {
  const base = { filesystems: [], expectedMounts: [], missing: [] };
  it('readDiskMeasured keeps a well-formed walk and drops a malformed one without losing the filesystems', () => {
    expect(readDiskMeasured({ ...base, transcriptWork: walked(10) })).toEqual({ ...base, transcriptWork: walked(10) });
    expect(readDiskMeasured({ ...base, transcriptWork: { measured: false, at: 1, why: 'timeout' } })?.transcriptWork).toEqual({ measured: false, at: 1, why: 'timeout' });
    for (const bad of [
      { ...walked(10), bytes: -1 }, { ...walked(10), bytes: 1.5 }, { ...walked(10), entries: 0 },
      walked(60, [10, 10, 10, 10, 10, 10]), { ...walked(10), measured: 'yes' }, { measured: false, at: 1, why: 'slow' }, 'x',
    ]) {
      expect(readDiskMeasured({ ...base, transcriptWork: bad }), JSON.stringify(bad)).toEqual(base);
    }
  });

  it('readDiskHealth carries the block, and a malformed one drops alone', () => {
    const disk = { at: 1, level: 'ok', filesystems: [], expectedMounts: [], pressure: false, holders: [] };
    const tw = transcriptWorkBlock(walked(10));
    expect(readDiskHealth({ disk: { ...disk, transcriptWork: tw } })?.transcriptWork).toEqual(tw);
    expect(readDiskHealth({ disk: { ...disk, transcriptWork: { ...tw, level: 'fine' } } })).toEqual(disk);
  });
});

describe('the disk alarm passes the walk through to GET /api/fleet/health (D-7898)', () => {
  const fs1 = { dev: '1', mount: '/work', fsType: 'ext4', roots: ['home'], sizeBytes: 100, availBytes: 50, freeBytes: 50, files: 10, filesFree: 5, readOnly: false };
  const read = (tw?: TranscriptWorkMeasured): MeasuredDisk => ({ ok: true, measured: { filesystems: [fs1], expectedMounts: [], missing: [], ...(tw === undefined ? {} : { transcriptWork: tw }) } as DiskMeasured });
  function watcherWith(answers: MeasuredDisk[]): FleetWatcher {
    let n = 0;
    const io: FleetIO = { ...localIO, statfsMeasured: async () => answers[Math.min(n++, answers.length - 1)]! };
    return new FleetWatcher({ ...testDeps(), io }, new Bus());
  }

  it('carries the walk with its level; a reply with none, and a read that failed, keep the one held; the disk level never moves for it', async () => {
    const w = watcherWith([read(walked(TRANSCRIPT_WORK_WARN_ENTRY_BYTES + 1)), read(), { ok: false, reason: 'unreadable' }]);
    await w.sweepDisk();
    expect(w.disk()!.transcriptWork).toMatchObject({ level: 'warn', entries: 1, at: 5 });
    expect(w.disk()!.level).toBe('ok');
    w.kick('diskAlarm'); await w.sweepDisk();
    expect(w.disk()!.transcriptWork).toMatchObject({ level: 'warn', entries: 1, at: 5 });
    w.kick('diskAlarm'); await w.sweepDisk();
    expect(w.disk()!.level).toBe('unmeasured');
    expect(w.disk()!.transcriptWork).toMatchObject({ level: 'warn', entries: 1, at: 5 });
  });

  it('an older agent that never sends a walk leaves the block without one (unknown, never zero)', async () => {
    const w = watcherWith([read()]);
    await w.sweepDisk();
    expect(w.disk()).not.toBeNull();
    expect(w.disk()!.transcriptWork).toBeUndefined();
  });
});
