// `ccd skill-ensure --wrapper <id>` (D-8126, wave A7, F10): put the coordinator and the worker skill into ONE rostered
// account's config dir, through the two installers the deploy already ships, and answer one JSON line. It is the server's
// self-heal for a dispatch that measured the skill absent (row 38), so its reach is the pin: it resolves the home through
// the roster, installs into that home and no other, and refuses an id the roster does not name before it writes anything.
//
// Everything runs under the harness's fixture HOME, as a PROGRAM (`bash ccd skill-ensure …`): the dispatcher arm, the exit
// code and the stream are what is asserted. The installers and their sources are copied to where the deploy puts them
// (`~/.cc-sessions`), so the verb runs the same files a box runs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { CCD_ARGV } from '../src/ccdargv.js';

const REPO_CCD = path.resolve(__dirname, '../../ccd');

let h: CcdHarness;
let home: string;
let reg: string;

beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-skill-ensure-');
  home = h.home; reg = path.join(home, '.cc-sessions');
  for (const f of ['install-coordinator-skill.sh', 'install-worker-skill.sh']) {
    fs.copyFileSync(path.join(REPO_CCD, f), path.join(reg, f));
  }
  for (const d of ['coordinator-skill', 'worker-skill']) fs.cpSync(path.join(REPO_CCD, d), path.join(reg, d), { recursive: true });
  for (const d of ['.claude-a', '.claude-b']) fs.mkdirSync(path.join(home, d), { recursive: true });
});
afterEach(() => { h.cleanup(); });

interface Ran { status: number | null; stdout: string; stderr: string }

const ccd = (args: string[], extra: NodeJS.ProcessEnv = {}): Ran => {
  const r = spawnSync('bash', [CCD, 'skill-ensure', ...args], {
    encoding: 'utf8', cwd: home,
    env: ghContainedEnv(home, { ...inheritedEnv(), HOME: home, ...extra }, { systemd: true, tmux: true, net: true }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const answer = (r: Ran): { wrapper: string; result: string; detail: string } => {
  expect(r.stdout.trim().split('\n')).toHaveLength(1);
  return JSON.parse(r.stdout);
};
const skillDir = (cfg: string, name: string): string => path.join(home, cfg, 'skills', name);

describe('ccd skill-ensure', () => {
  it('installs both skills into the named account home and touches no other', () => {
    const r = ccd(['--wrapper', 'claude-a']);
    expect(r.status).toBe(0);
    expect(answer(r)).toMatchObject({ wrapper: 'claude-a', result: 'installed' });
    expect(fs.readFileSync(path.join(skillDir('.claude-a', 'ccrc-coordinator'), 'SKILL.md'), 'utf8'))
      .toBe(fs.readFileSync(path.join(REPO_CCD, 'coordinator-skill', 'SKILL.md'), 'utf8'));
    expect(fs.existsSync(path.join(skillDir('.claude-a', 'ccrc-worker'), 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude-b', 'skills'))).toBe(false);
  });

  it('answers converged for a home that already holds both, and changes no mtime', () => {
    expect(answer(ccd(['--wrapper', 'claude-a'])).result).toBe('installed');
    const files = [path.join(skillDir('.claude-a', 'ccrc-coordinator'), 'SKILL.md'), path.join(skillDir('.claude-a', 'ccrc-worker'), 'SKILL.md'),
      skillDir('.claude-a', 'ccrc-coordinator'), skillDir('.claude-a', 'ccrc-worker')];
    const before = files.map((f) => [fs.statSync(f).mtimeMs, fs.statSync(f).ino]);
    const r = ccd(['--wrapper', 'claude-a']);
    expect(r.status).toBe(0);
    expect(answer(r).result).toBe('converged');
    expect(files.map((f) => [fs.statSync(f).mtimeMs, fs.statSync(f).ino])).toEqual(before);
  });

  it('answers installed when one of the two skills is stale and rewrites only that one', () => {
    ccd(['--wrapper', 'claude-a']);
    fs.writeFileSync(path.join(skillDir('.claude-a', 'ccrc-worker'), 'SKILL.md'), 'an older generation');
    const coordIno = fs.statSync(skillDir('.claude-a', 'ccrc-coordinator')).ino;
    expect(answer(ccd(['--wrapper', 'claude-a'])).result).toBe('installed');
    expect(fs.readFileSync(path.join(skillDir('.claude-a', 'ccrc-worker'), 'SKILL.md'), 'utf8')).toContain('name: ccrc-worker');
    expect(fs.statSync(skillDir('.claude-a', 'ccrc-coordinator')).ino).toBe(coordIno);
  });

  it('refuses a wrapper the roster does not name with exit 2 and writes nothing', () => {
    for (const id of ['nobody', 'Claude-A', '../.claude-a', 'claude-a/x', '']) {
      const r = ccd(['--wrapper', id]);
      expect(r.status, `id ${JSON.stringify(id)}`).toBe(2);
      expect(r.stdout).toBe('');
    }
    expect(fs.existsSync(path.join(home, '.claude-a', 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'ccrc-backups'))).toBe(false);
  });

  it('answers failed with the installer refusal when a source is missing', () => {
    fs.rmSync(path.join(reg, 'coordinator-skill'), { recursive: true });
    const r = ccd(['--wrapper', 'claude-a']);
    expect(r.status).toBe(0);
    const a = answer(r);
    expect(a).toMatchObject({ wrapper: 'claude-a', result: 'failed' });
    expect(a.detail).toContain('no SKILL.md');
  });

  it('answers failed for a rostered account whose config dir is not on this box', () => {
    fs.rmSync(path.join(home, '.claude-a'), { recursive: true });
    const a = answer(ccd(['--wrapper', 'claude-a']));
    expect(a.result).toBe('failed');
    expect(fs.existsSync(path.join(home, '.claude-a'))).toBe(false);
  });

  it('takes exactly --wrapper <id>: any other argv is the usage line', () => {
    for (const args of [[], ['--wrapper'], ['claude-a'], ['--wrapper', 'claude-a', 'claude-b'], ['--wrapper', 'claude-a', '--all'], ['--homes', 'x']]) {
      const r = ccd(args);
      expect(r.status, JSON.stringify(args)).toBe(1);
      expect(r.stderr).toContain('usage: ccd skill-ensure --wrapper <id>');
      expect(r.stdout).toBe('');
    }
  });

  it('the server builds exactly [skill-ensure, --wrapper, id]', () => {
    expect([...CCD_ARGV.skillEnsure('claude-a')]).toEqual(['skill-ensure', '--wrapper', 'claude-a']);
  });
});
