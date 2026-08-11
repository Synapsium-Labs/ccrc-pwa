// `ccd version` — the fleet host's half of build identity (stage 1). The
// stamp is deploy.sh's ~/.ccrc/build.json; an unstamped HOME (dev checkout)
// gets an honest "unstamped", exit 0 — not an invented version and not an
// error. Harness: the ccd-forget.test.ts dispatcher pattern, verbatim.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-version-'); });
afterEach(() => { h.cleanup(); });

const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    return {
      code: 0, stderr: '',
      stdout: execFileSync('bash', [CCD, ...args], {
        encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
      }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

describe('ccd version', () => {
  it('routes, takes no argv, and advertises itself in caps', () => {
    const r = runCcd('version', 'extra');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd version');
    expect(runCcd('caps').stdout.split('\n')).toContain('version');
  });

  it('prints the stamp when the box was deployed', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'c'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false,
    }));
    const r = runCcd('version');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('c'.repeat(40));
    expect(r.stdout).toContain('main');
    expect(r.stdout).toContain('2026-08-11T11:00:00Z');
    expect(r.stdout).not.toContain('dirty');
  });

  it('a dirty stamp says dirty — a working-tree deploy cannot masquerade', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'd'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: true,
    }));
    expect(runCcd('version').stdout).toContain('dirty');
  });

  it('an unstamped HOME answers honestly, exit 0', () => {
    const r = runCcd('version');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('unstamped');
  });

  it('a corrupt stamp is named, not parsed around', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), '{torn');
    const r = runCcd('version');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('unreadable');
  });
});
