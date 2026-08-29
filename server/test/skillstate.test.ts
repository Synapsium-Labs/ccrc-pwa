// program-leverage wave 2 (F2), spec section 4 item 1
// (`docs/superpowers/plans/2026-08-28-program-leverage-wave2-f2.md`).
//
// The whole feature is one distinction: `absent` is evidence ABOUT the fleet (a
// proven ENOENT — the installer has not run on that home), `unmeasurable` is an
// admission about the MEASUREMENT (no path to read, or a read that failed).
// Every test below exists to keep one of the two from turning into the other.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { localIO } from '../src/io.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';
import { readWorkerSkillState, workerSkillPath } from '../src/skillstate.js';

/** A config dir with the skills/ tree the installer creates, but no SKILL.md yet. */
const plant = (): string => {
  const configDir = mkTmp('ccrc-skillstate-');
  mkdirSync(path.join(configDir, 'skills', 'ccrc-worker'), { recursive: true });
  return configDir;
};

/** Matches only the worker skill's own file, never the rest of a fixture home. */
const skillFile = (p: string): boolean => p.endsWith(path.join('ccrc-worker', 'SKILL.md'));

describe('readWorkerSkillState — three answers, and they never collapse', () => {
  it('answers present for an installed SKILL.md', async () => {
    const configDir = plant();
    writeFileSync(workerSkillPath(configDir), '---\nname: ccrc-worker\n---\n');
    expect(await readWorkerSkillState(localIO, configDir)).toBe('present');
  });

  it('answers absent when the installer never ran on this home', async () => {
    // The ordinary case, not an alarm: `install-worker-skill.sh` skips a
    // rostered account whose config dir does not exist on this box, so a home
    // with no skills/ tree is a normal, measured fact.
    const configDir = mkTmp('ccrc-skillstate-');
    expect(await readWorkerSkillState(localIO, configDir)).toBe('absent');
  });

  it('answers unmeasurable when the read FAILED rather than proved nothing is there', async () => {
    // `unreadable` covers EACCES, EISDIR, an agent whitelist `forbidden`, a 15 s
    // remote timeout and a dropped agent socket. None of those is evidence the
    // path is clear, so none of them may answer `absent`.
    const configDir = plant();
    expect(await readWorkerSkillState(degradedReadIO(skillFile), configDir)).toBe('unmeasurable');
  });

  it('answers unmeasurable when there is no config dir to read at all', async () => {
    // `configDirFor` answers undefined for a wrapper this box's roster does not
    // carry, and dispatch's resume arm tolerates a session whose registry row is
    // gone. Neither measured a file; neither may say `absent`.
    expect(await readWorkerSkillState(localIO, undefined)).toBe('unmeasurable');
  });

  it('still answers absent when the failure is a PROVEN ENOENT', async () => {
    // The other direction of the same guard: a real absence must not get
    // laundered into `unmeasurable` either, or the field stops meaning anything.
    const configDir = plant();
    expect(await readWorkerSkillState(absentReadIO(skillFile), configDir)).toBe('absent');
  });

  it('reads a DIRECTORY at the skill path as unmeasurable, on the real filesystem', async () => {
    // Root-safe real-fs twin of the degradedReadIO case (io.test.ts's own EISDIR
    // precedent): no privilege dependence, so it is real under every runner.
    const configDir = plant();
    mkdirSync(workerSkillPath(configDir), { recursive: true });
    expect(await readWorkerSkillState(localIO, configDir)).toBe('unmeasurable');
  });

  it.skipIf(process.getuid?.() === 0)(
    'reads a chmod 000 SKILL.md as unmeasurable (EACCES)', async () => {
      // D-116: chmod 000 denies root nothing, so an unguarded case would quietly
      // assert the OPPOSITE of its own name. Chmod back in a finally so the tmp
      // cleanup can remove it.
      const configDir = plant();
      const file = workerSkillPath(configDir);
      writeFileSync(file, 'x');
      chmodSync(file, 0o000);
      try {
        expect(await readWorkerSkillState(localIO, configDir)).toBe('unmeasurable');
      } finally {
        chmodSync(file, 0o644);
      }
    });

  it('joins the path the installer actually writes to', async () => {
    // ccd/install-worker-skill.sh: NAME=ccrc-worker, dest="$dir/skills/$NAME",
    // REQUIRED_FILES=(SKILL.md). Drift here makes every dispatch on a correctly
    // installed fleet report `absent`, which is worse than no field at all.
    expect(workerSkillPath('/cfg')).toBe(path.join('/cfg', 'skills', 'ccrc-worker', 'SKILL.md'));
  });
});
