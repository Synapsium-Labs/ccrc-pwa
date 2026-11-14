// Doctor's `auto-memory` check (Overlord W1a launch profiles PR B, Task 7; spec §3.3.7 H14): every rostered config dir's
// `projects/<slug>/memory/` directories that hold a file, listed and never read or deleted. Fixture HOMEs only (`healthy()`,
// a two-lane roster projected by `seedAccountsSh`); the check runs alone, sourced, and once in a full doctor run for its place
// in the table.
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { BASH, CCRC_SRC, CHECKS_SRC, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, runDoctor, shq } from './ccrc-doctorFixture.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'Lane A', configDirSuffix: '.claude-lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'Lane B', configDirSuffix: '.claude-lane-b', exec: { kind: 'external' }, homeAble: true, hue: 'amber', telemetry: 'none' },
  ],
};

function box(prefix: string): string {
  const home = healthy(prefix);
  seedAccountsSh(home, ROSTER);
  return home;
}
/** A memory directory under `<cfg>/projects/<slug>/memory`, with the files named (none: an empty directory). */
function memory(home: string, cfg: string, slug: string, files: string[] = []): string {
  const d = join(home, cfg, 'projects', slug, 'memory');
  mkdirSync(d, { recursive: true });
  for (const f of files) writeFileSync(join(d, f), 'remember\n');
  return d;
}
function check(home: string, env: NodeJS.ProcessEnv = {}): { line: string; remedy: string; code: number } {
  const r = spawnSyncGroup(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_check_auto-memory`],
    { env: { ...doctorEnv(home), ...env }, encoding: 'utf8', timeout: 30_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) auto-memory: /.test(l));
  expect(i, `an auto-memory line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, remedy: lines[i + 1] ?? '', code: r.status ?? -1 };
}
const NONE = 'PASS auto-memory: no rostered config dir holds an auto-memory directory with a file in it';

describe('doctor auto-memory (Task 7: lists, never reads, never deletes)', () => {
  it('none: PASS', () => {
    const home = box('ccrc-doctor-automem-none-');
    mkdirSync(join(home, '.claude-lane-a', 'projects', '-w-project-a'), { recursive: true });
    expect(check(home)).toEqual({ line: NONE, remedy: '', code: 0 });
  });

  it('an empty memory directory is PASS: nothing is stored there', () => {
    const home = box('ccrc-doctor-automem-empty-');
    memory(home, '.claude-lane-a', '-w-project-a');
    expect(check(home).line).toBe(NONE);
  });

  it('one that holds a file: WARN naming the count and its path relative to the account, and the remedy deletes nothing', () => {
    const home = box('ccrc-doctor-automem-one-');
    memory(home, '.claude-lane-a', '-w-project-a', ['MEMORY.md']);
    const r = check(home);
    expect(r.line).toBe('WARN auto-memory: 1 auto-memory directory holds files: lane-a/projects/-w-project-a/memory');
    expect(r.code).toBe(2);
    expect(r.remedy).toMatch(/^ {2}remedy: nothing is deleted here: once the launch-profile lane is live/);
  });

  it('a directory two accounts reach by a link is listed once', () => {
    const home = box('ccrc-doctor-automem-link-');
    const real = memory(home, '.claude-lane-a', '-w-project-a', ['MEMORY.md']);
    mkdirSync(join(home, '.claude-lane-b', 'projects', '-w-project-a'), { recursive: true });
    symlinkSync(real, join(home, '.claude-lane-b', 'projects', '-w-project-a', 'memory'));
    expect(check(home).line).toBe('WARN auto-memory: 1 auto-memory directory holds files: lane-a/projects/-w-project-a/memory');
  });

  it('more than three: the count, the first three, and an ellipsis', () => {
    const home = box('ccrc-doctor-automem-many-');
    for (const s of ['-w-a', '-w-b', '-w-c']) memory(home, '.claude-lane-a', s, ['MEMORY.md']);
    memory(home, '.claude-lane-b', '-w-d', ['notes.md']);
    expect(check(home).line).toBe('WARN auto-memory: 4 auto-memory directories hold files: lane-a/projects/-w-a/memory, lane-a/projects/-w-b/memory, lane-a/projects/-w-c/memory, …');
  });

  it('never opens a file: one its owner cannot read is still listed; and nothing is removed', () => {
    const home = box('ccrc-doctor-automem-noread-');
    const d = memory(home, '.claude-lane-a', '-w-project-a', ['MEMORY.md']);
    chmodSync(join(d, 'MEMORY.md'), 0o000);
    try {
      expect(check(home).line).toBe('WARN auto-memory: 1 auto-memory directory holds files: lane-a/projects/-w-project-a/memory');
      expect(existsSync(join(d, 'MEMORY.md'))).toBe(true);
      expect(readdirSync(d)).toEqual(['MEMORY.md']);
    } finally { chmodSync(join(d, 'MEMORY.md'), 0o644); }
  });

  it('a server-role box is SKIP', () => {
    const home = box('ccrc-doctor-automem-server-');
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n', { flag: 'a' });
    expect(check(home)).toMatchObject({ line: 'SKIP auto-memory: this box records CCRC_ROLE=server, so it hosts no sessions and keeps no auto memory', code: 3 });
  });

  it('a roster projection that cannot be read is WARN unmeasured, never PASS', () => {
    const home = box('ccrc-doctor-automem-roster-');
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'this is not bash (\n');
    expect(check(home).line).toBe('WARN auto-memory: the roster projection at ~/.ccrc/accounts.sh could not be read, so the auto-memory directories are unmeasured');
  });

  it('the full doctor run reports it, after the account checks', () => {
    const home = box('ccrc-doctor-automem-full-');
    memory(home, '.claude-lane-a', '-w-project-a', ['MEMORY.md']);
    const out = runDoctor(home).stdout;
    expect(anyVerdictFor(out, 'auto-memory')).toBe('WARN auto-memory: 1 auto-memory directory holds files: lane-a/projects/-w-project-a/memory');
    const at = (name: string): number => out.split('\n').findIndex((l) => new RegExp(`^(PASS|WARN|FAIL|SKIP) ${name}: `).test(l));
    expect(at('auto-memory')).toBeGreaterThan(at('credentials'));
  });
});
