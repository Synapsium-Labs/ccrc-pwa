// Doctor's `cap-floor` check (the Overlord W1 pool set, plan Task 8): a standing `~/.cc-sessions/<id>.poolset` entry
// needs a ccd that advertises `pool-set` in `ccd caps`; a box that got below it fails open, so the check FAILs naming
// the word and the ids. Fixture HOMEs only (`healthy()`), a stub ccd, the check run alone, sourced.
import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, runDoctor, shq } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const restore: string[] = [];
afterEach(() => { for (const p of restore.splice(0)) { try { chmodSync(p, 0o700); } catch { /* gone */ } } });

function box(prefix: string, o: { registry?: boolean; env?: string[]; sets?: string[]; ccd?: string | null } = {}): { home: string; reg: string; marker: string } {
  const home = healthy(prefix);
  const reg = join(home, '.cc-sessions');
  const marker = join(home, 'ccd-ran');
  if (o.registry ?? true) mkdirSync(reg, { recursive: true });
  for (const id of o.sets ?? []) writeFileSync(join(reg, `${id}.poolset`), 'pool-a\n');
  if (o.env) appendFileSync(join(home, '.ccrc', 'ccrc.env'), o.env.map((l) => `${l}\n`).join(''));
  // healthy() plants a `~/.local/bin/ccd` of its own (it answers Docs); `ccd: null` is a box with no ccd at all.
  if (o.ccd === null) rmSync(join(home, '.local', 'bin', 'ccd'), { force: true });
  if (o.ccd !== null) {
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const p = join(home, '.local', 'bin', 'ccd');
    writeFileSync(p, `#!/bin/sh\n: > ${shq(marker)}\n${o.ccd ?? 'printf "ws-add\\nhibernate\\n"'}\n`, { mode: 0o755 });
  }
  return { home, reg, marker };
}
function check(home: string): { out: string; line: string; remedy: string; code: number } {
  const r = spawnSyncGroup(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_check_cap-floor`],
    { env: doctorEnv(home), encoding: 'utf8', timeout: 30_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) cap-floor: /.test(l));
  expect(i, `a cap-floor line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { out: r.stdout ?? '', line: lines[i]!, remedy: lines[i + 1] ?? '', code: r.status ?? -1 };
}

describe('cap-floor: a standing set needs a ccd that advertises pool-set', () => {
  it('FAIL naming pool-set and the id, with a remedy naming the update and the Settings step', () => {
    const b = box('ccrc-doctor-capfloor-fail-', { sets: ['lane-b-overlord'] });
    const r = check(b.home);
    expect(r.code).toBe(1);
    expect(r.line).toMatch(/^FAIL cap-floor: /);
    expect(r.line).toContain('pool-set');
    expect(r.line).toContain('lane-b-overlord');
    expect(r.remedy).toMatch(/^ {2}remedy: /);
    expect(r.remedy).toMatch(/ccrc\s+update/);
    expect(r.remedy).toContain('Settings');
  });

  it('names every id that stands', () => {
    const b = box('ccrc-doctor-capfloor-ids-', { sets: ['lane-b-overlord', 'lane-b-two'] });
    const r = check(b.home);
    expect(r.line).toContain('lane-b-overlord');
    expect(r.line).toContain('lane-b-two');
  });

  it('PASS when the ccd advertises pool-set', () => {
    const b = box('ccrc-doctor-capfloor-pass-', { sets: ['lane-b-overlord'], ccd: 'printf "ws-add\\npool-set\\n"' });
    const r = check(b.home);
    expect(r.code).toBe(0);
    expect(r.line).toMatch(/^PASS cap-floor: /);
  });

  it('a token that merely contains pool-set does not satisfy it', () => {
    const b = box('ccrc-doctor-capfloor-sub-', { sets: ['lane-b-overlord'], ccd: 'printf "pool-set-x\\nmy-pool-set\\n"' });
    expect(check(b.home).line).toMatch(/^FAIL cap-floor: /);
  });

  it('no entry: PASS without running ccd', () => {
    const b = box('ccrc-doctor-capfloor-none-', { ccd: 'exit 1' });
    const r = check(b.home);
    expect(r.line).toMatch(/^PASS cap-floor: /);
    expect(existsSync(b.marker)).toBe(false);
  });

  it('caps exits non-zero while an entry stands: FAIL unmeasured', () => {
    const b = box('ccrc-doctor-capfloor-unm-', { sets: ['lane-b-overlord'], ccd: 'exit 1' });
    const r = check(b.home);
    expect(r.code).toBe(1);
    expect(r.line).toMatch(/^FAIL cap-floor: unmeasured: /);
    expect(r.remedy).toMatch(/^ {2}remedy: /);
  });

  it('no ccd at all while an entry stands: FAIL unmeasured', () => {
    const b = box('ccrc-doctor-capfloor-noccd-', { sets: ['lane-b-overlord'], ccd: null });
    expect(check(b.home).line).toMatch(/^FAIL cap-floor: unmeasured: /);
  });

  it('a registry that can be searched but not listed: its own FAIL unmeasured', () => {
    const b = box('ccrc-doctor-capfloor-nor-', { sets: ['lane-b-overlord'] });
    chmodSync(b.reg, 0o300); restore.push(b.reg);
    const r = check(b.home);
    expect(r.code).toBe(1);
    expect(r.line).toMatch(/^FAIL cap-floor: unmeasured: ~\/\.cc-sessions can be searched but not listed/);
    expect(r.remedy).toContain('chmod u+r');
  });

  it('a registry that cannot be searched: SKIP (the pools check reports it)', () => {
    const b = box('ccrc-doctor-capfloor-nox-', { sets: ['lane-b-overlord'] });
    chmodSync(b.reg, 0o600); restore.push(b.reg);
    const r = check(b.home);
    expect(r.code).toBe(3);
    expect(r.line).toMatch(/^SKIP cap-floor: /);
  });

  it('no registry at all: PASS', () => {
    expect(check(box('ccrc-doctor-capfloor-noreg-', { registry: false, ccd: 'exit 1' }).home).line).toMatch(/^PASS cap-floor: /);
  });

  it('a server-role box with no registry: PASS', () => {
    const b = box('ccrc-doctor-capfloor-server-', { registry: false, env: ['CCRC_ROLE=server'], ccd: 'exit 1' });
    const r = check(b.home);
    expect(r.line).toMatch(/^PASS cap-floor: /);
    expect(existsSync(b.marker)).toBe(false);
  });

  it('a dangling symlink at the poolset path counts as standing', () => {
    const b = box('ccrc-doctor-capfloor-link-');
    symlinkSync(join(b.home, 'nowhere'), join(b.reg, 'lane-b-overlord.poolset'));
    const r = check(b.home);
    expect(r.line).toMatch(/^FAIL cap-floor: /);
    expect(r.line).toContain('lane-b-overlord');
  });

  it('a directory at the poolset path counts as standing', () => {
    const b = box('ccrc-doctor-capfloor-dir-');
    mkdirSync(join(b.reg, 'lane-b-overlord.poolset'));
    expect(check(b.home).line).toMatch(/^FAIL cap-floor: /);
  });

  it('a full doctor run prints a cap-floor verdict line', () => {
    const home = healthy('ccrc-doctor-capfloor-full-');
    expect(anyVerdictFor(runDoctor(home).stdout, 'cap-floor')).toMatch(/^(PASS|SKIP|WARN|FAIL) cap-floor: /);
  });
});
