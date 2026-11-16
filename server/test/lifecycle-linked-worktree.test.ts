// D-5967 (#530, ARCH-08): `listProjects` folds out a linked worktree — a
// workdir whose `.git` is a FILE — and nothing else. The probe is
// `lstatMeasured` on `<workdir>/.git`: a measured `regular` file excludes, a
// directory includes, and a probe that could not answer KEEPS the project.
// Before this the probe was `readdir(.git) === null`, which read a remote
// timeout as "it is a file" and dropped a real project from both doors.
import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { listProjects } from '../src/lifecycle.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const seedSession = (home: string, id: string, fields: Record<string, string>) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A remote-shaped io over the real disk whose every read of a `.git` path
 *  fails: `readdir` null, `lstatMeasured` the given reason (`unmeasured` is a
 *  timed-out agent request, `unreadable` a permission error, `absent` a `.git`
 *  removed between the readdir and the lstat). Everything else is the real disk. */
const gitProbeFails = (lstatReason: 'unmeasured' | 'unreadable' | 'absent'): FleetIO => {
  const isGit = (p: string) => path.basename(p) === '.git';
  return {
    ...localIO,
    async readdir(p, t, s) { return isGit(p) ? null : localIO.readdir(p, t, s); },
    async readdirMeasured(p, t, s) {
      return isGit(p) ? { ok: false, reason: 'unreadable' } : localIO.readdirMeasured(p, t, s);
    },
    async lstatMeasured(p) { return isGit(p) ? { ok: false, reason: lstatReason } : localIO.lstatMeasured(p); },
    async statMeasured(p) { return isGit(p) ? { ok: false, reason: 'unreadable' } : localIO.statMeasured(p); },
  };
};

/** One project under the root (`inroot`) and one only in the registry
 *  (`regonly`), each given the same `.git` shape by `shape`. */
const fixture = (shape: (workdir: string) => void) => {
  const home = mkTmp('ccrc-bl102-home-');
  seedRoster(home);
  const root = mkTmp('ccrc-bl102-root-');
  const inRoot = path.join(root, 'inroot');
  mkdirSync(inRoot);
  shape(inRoot);
  const regOnly = mkTmp('ccrc-bl102-reg-');
  shape(regOnly);
  seedSession(home, 'demo-regonly', {
    wrapper: 'demo', project: 'regonly', workdir: regOnly, uuid: '7'.repeat(36), started: '1',
  });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: root });
  return { cfg, inRoot, regOnly };
};

const gitDir = (wd: string) => { mkdirSync(path.join(wd, '.git')); };
const gitFile = (wd: string) => { writeFileSync(path.join(wd, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n'); };

describe('listProjects — the linked-worktree fold keeps what it could not measure (D-5967)', () => {
  it.each(['unmeasured', 'unreadable', 'absent'] as const)(
    'a .git probe that fails (%s) keeps the project, through both doors', async (reason) => {
    const { cfg, inRoot, regOnly } = fixture(gitDir);
    const out = await listProjects(gitProbeFails(reason), cfg);
    expect(out.projects).toEqual([
      { name: 'inroot', workdir: inRoot },
      { name: 'regonly', workdir: regOnly },
    ]);
  },
  );

  it('a .git FILE (linked worktree) is excluded, through both doors', async () => {
    const { cfg } = fixture(gitFile);
    const out = await listProjects(localIO, cfg);
    expect(out.projects).toEqual([]);
  });

  it('a .git DIRECTORY (main checkout) is included, through both doors', async () => {
    const { cfg, inRoot, regOnly } = fixture(gitDir);
    const out = await listProjects(localIO, cfg);
    expect(out.projects).toEqual([
      { name: 'inroot', workdir: inRoot },
      { name: 'regonly', workdir: regOnly },
    ]);
  });

  it('a .git SYMLINK is kept, as the readdir probe kept one pointing at a directory', async () => {
    const { cfg, inRoot, regOnly } = fixture((wd) => {
      const target = mkTmp('ccrc-bl102-gitdir-');
      symlinkSync(target, path.join(wd, '.git'));
    });
    const out = await listProjects(localIO, cfg);
    expect(out.projects).toEqual([
      { name: 'inroot', workdir: inRoot },
      { name: 'regonly', workdir: regOnly },
    ]);
  });
});
