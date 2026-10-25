// `_ver_verdicts`' rc 1 reaches its callers' WARN arms (centralised update management, wave 16, R8g). `_ver_verdicts`
// answers 1 only when a numeric test of <keep> ERRORS, a belt over `_keep_ok`, which every caller asks first; so no
// input from outside reaches those arms, and `ccrc-update-*.test.ts` pins only the belt itself. Here the belt is
// stubbed to answer 1, and each of the three arms that read it is run and its line pinned: `_ver_gc`'s auto arm (the
// install's and the update's prune), its prune arm (`ccrc versions --prune`), and `cmd_versions`' listing. The six
// shadowed readers are the price of reaching arms no input can reach: a change to what one of them sets reds this file
// without any change in behaviour, and the fix is to the shadow, not to the arm.
//
// SAFETY. `ccd/ccrc` is SOURCED on `sweepFixture.ts`'s fixture HOME and env (built from scratch, every tool that is not
// a stub a recording POISON), `assertContained` runs on the spawn's final env, and every reader the arms would reach
// first is a shell function: no service manager, no lock, no real `$HOME/ccrc` or `$HOME/ccrc-versions`. The only files
// are the fixture's own `ccrc-versions/<name>/.ccrc-installed` records, which make the versions "complete".
import { describe, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { itLinux } from './platformFixtures.js';
import { BASH, CCRC_SRC, assertContained, makeBox, poisonFiles, type Box } from './sweepFixture.js';

const NAMES = ['v0.0.3', 'v0.0.2', 'v0.0.1', 'v0.0.0'];
const WHY = 'the stubbed belt answered 1';

/** Every reader `_ver_gc` and `cmd_versions` consult before the arms, as a function; `_ver_verdicts` is the belt
 *  answering 1 exactly as the real one does: every verdict `kept: unmeasured`, nothing doomed, VER_WHY set. */
const SHADOWS = [
  '_ver_layout() { VER_LAYOUT=linked; }',
  `_ver_list() { VER_NAMES=(${NAMES.join(' ')}); VER_CURRENT=${NAMES[0]}; return 0; }`,
  '_ver_protect() { declare -gA VER_PROTECT=(); return 0; }',
  '_ver_sweep_leftovers() { return 0; }',
  '_box_build_fields() { return 1; }',
  '_ver_kept() { return 0; }',
  '_ver_verdicts() {',
  '  echo "belt: $1 $2" >> "$HOME/belt-calls"',
  '  declare -gA VER_VERDICT=(); local n',
  '  for n in "${VER_NAMES[@]}"; do VER_VERDICT[$n]="kept: unmeasured"; done',
  `  VER_DOOMED=(); VER_DOOMED_WHY=(); VER_WHY=${JSON.stringify(WHY)}; return 1`,
  '}',
].join('\n');

function box(): Box {
  const b = makeBox({ units: [] });
  // Three COMPLETE versions beside the pointed-at one, so `ncomp` (3) > KEEP (1) and `_ver_gc` does not return early.
  for (const n of NAMES) {
    mkdirSync(join(b.home, 'ccrc-versions', n), { recursive: true });
    writeFileSync(join(b.home, 'ccrc-versions', n, '.ccrc-installed'), 'fixture record\n');
  }
  return b;
}

function run(b: Box, body: string): { code: number; stdout: string; stderr: string; belt: string } {
  const env = { ...b.env, CCRC_VERSIONS_KEEP: '1' };
  assertContained({ home: b.home, env });
  const r = spawnSync(BASH, ['-c', ['. "$1"', SHADOWS, body].join('\n'), 'ccrc-under-test', CCRC_SRC],
    { env, encoding: 'utf8', timeout: 45_000 });
  const f = join(b.home, 'belt-calls');
  const belt = existsSync(f) ? readFileSync(f, 'utf8') : '';
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', belt };
}

describe('_ver_verdicts answering 1 reaches each caller\'s WARN arm (wave 16, R8g)', () => {
  itLinux.each([
    ['update', 'update: versions:'],
    ['install', 'install: versions:'],
  ])('VW1 the %s prune (auto): one WARN line, nothing pruned, rc 1', (pfx, lead) => {
    const b = box();
    const r = run(b, `_ver_gc ${pfx} auto; echo "rc=$?"`);
    expect(r.belt, r.stderr).toBe('belt: auto 1\n');
    expect(r.stdout.split('\n')).toEqual([`${lead} WARN: nothing pruned — ${WHY}`, 'rc=1', '']);
    expect(poisonFiles(b)).toEqual([]);
  }, 60_000);

  itLinux('VW2 the hand-run prune (`ccrc versions --prune`\'s _ver_gc): prune skipped, nothing removed, rc 1', () => {
    const b = box();
    const r = run(b, '_ver_gc versions prune; echo "rc=$?"');
    expect(r.belt, r.stderr).toBe('belt: prune 1\n');
    expect(r.stdout.split('\n')).toEqual([`versions: prune skipped — ${WHY}; nothing was removed`, 'rc=1', '']);
  }, 60_000);

  itLinux('VW3 the listing (`ccrc versions`): one WARN line, every version kept as unmeasured, rc 0', () => {
    const b = box();
    const r = run(b, 'cmd_versions; echo "rc=$?"');
    expect(r.belt, r.stderr).toBe('belt: prune 1\n');
    const out = r.stdout.split('\n');
    expect(out).toContain(`versions: WARN: ${WHY} — nothing would be pruned`);
    for (const n of NAMES) expect(out.some((l) => l.includes(` ${n}  complete  kept: unmeasured`)), `${n}: ${r.stdout}`).toBe(true);
    expect(out).toContain('rc=0');
  }, 60_000);
});

// Wave 24 (D-6596): CCRC_VERSIONS_KEEP is read through `_keep_knob`, so the box's ccrc.env reaches both readers. Here
// the belt is NOT stubbed: `_ver_verdicts` decides for real, over the same four complete versions, with the pointed-at
// one protected as `_ver_protect` protects it, and `~/ccrc` a link to it, so `_ver_gc`'s removal belt lets a prune run.
const REAL_BELT = [
  '_ver_layout() { VER_LAYOUT=linked; }',
  `_ver_list() { VER_NAMES=(${NAMES.join(' ')}); VER_CURRENT=${NAMES[0]}; return 0; }`,
  `_ver_protect() { declare -gA VER_PROTECT=([${NAMES[0]}]=pointed-at); return 0; }`,
  '_ver_sweep_leftovers() { return 0; }',
  '_box_build_fields() { return 1; }',
  '_ver_kept() { return 0; }',
].join('\n');

/** `body` under the real belt, with `ccrc.env` holding `file` and CCRC_VERSIONS_KEEP in the environment only when `keep` names it. */
function runKeep(file: string, body: string, keep?: string): { code: number; stdout: string; stderr: string; left: string[] } {
  const b = box();
  rmSync(join(b.home, 'ccrc'), { recursive: true, force: true });
  symlinkSync(join(b.home, 'ccrc-versions', NAMES[0]!), join(b.home, 'ccrc'));
  mkdirSync(join(b.home, '.ccrc'), { recursive: true });
  writeFileSync(join(b.home, '.ccrc', 'ccrc.env'), file);
  const env: NodeJS.ProcessEnv = { ...b.env };
  delete env['CCRC_VERSIONS_KEEP'];
  if (keep !== undefined) env['CCRC_VERSIONS_KEEP'] = keep;
  assertContained({ home: b.home, env });
  const r = spawnSync(BASH, ['-c', ['. "$1"', REAL_BELT, body].join('\n'), 'ccrc-under-test', CCRC_SRC],
    { env, encoding: 'utf8', timeout: 45_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', left: readdirSync(join(b.home, 'ccrc-versions')).sort() };
}

describe('W24: CCRC_VERSIONS_KEEP is read through _keep_knob (D-6596)', () => {
  itLinux('W24-P4: CCRC_VERSIONS_KEEP from ccrc.env reaches _ver_gc and cmd_versions; the environment wins; an export line refuses the prune and lets the listing run', () => {
    const [current, ...older] = NAMES;
    // ccrc.env alone: one complete version kept beyond the pointed-at one.
    let r = runKeep('CCRC_VERSIONS_KEEP=1\n', '_ver_gc update auto; echo "rc=$?"');
    expect(r.stdout, r.stderr).toContain('rc=0');
    expect(r.left, r.stdout).toEqual([older[0]!, current!].sort());
    r = runKeep('CCRC_VERSIONS_KEEP=1\n', 'cmd_versions; echo "rc=$?"');
    expect(r.stdout.split('\n').filter((l) => l.includes('kept: newest 1')), r.stdout).toHaveLength(1);
    expect(r.stdout, r.stderr).toContain('CCRC_VERSIONS_KEEP=1 plus the protected set');
    // The environment wins over the file: two.
    r = runKeep('CCRC_VERSIONS_KEEP=1\n', '_ver_gc update auto; echo "rc=$?"', '2');
    expect(r.stdout, r.stderr).toContain('rc=0');
    expect(r.left, r.stdout).toEqual([older[0]!, older[1]!, current!].sort());
    r = runKeep('CCRC_VERSIONS_KEEP=1\n', 'cmd_versions; echo "rc=$?"', '2');
    expect(r.stdout.split('\n').filter((l) => l.includes('kept: newest 2')), r.stdout).toHaveLength(2);
    expect(r.stdout, r.stderr).toContain('CCRC_VERSIONS_KEEP=2 plus the protected set');
    // An export line: the prune refuses, saying the knob cannot be measured; the listing WARNs and lists.
    r = runKeep('export CCRC_VERSIONS_KEEP=1\n', '_ver_gc update auto; echo "rc=$?"');
    expect(r.stdout, r.stderr).toMatch(/^update: versions: WARN: CCRC_VERSIONS_KEEP cannot be measured: .* — nothing pruned$/m);
    expect(r.stdout).toContain('rc=1');
    expect(r.left, 'nothing pruned').toEqual([...NAMES].sort());
    r = runKeep('export CCRC_VERSIONS_KEEP=1\n', 'cmd_versions; echo "rc=$?"');
    expect(r.stdout, r.stderr).toContain('versions: WARN: CCRC_VERSIONS_KEEP cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line) — listing only; nothing would be pruned');
    for (const n of NAMES) expect(r.stdout.split('\n').some((l) => l.includes(` ${n}  complete  kept: CCRC_VERSIONS_KEEP could not be used (the WARN above says why)`)), `${n}: ${r.stdout}`).toBe(true);
    expect(r.stdout).toContain('CCRC_VERSIONS_KEEP=(could not be used) plus the protected set');
    expect(r.stdout, 'a value that may be valid is never called invalid').not.toMatch(/is not a whole number/);
    expect(r.stdout).toContain('rc=0');
  }, 120_000);
});
