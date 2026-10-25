// The installed ccd body's provenance stamp (install-time stamping, ARCH root-cause rank 3).
//
// CHARACTERIZATION (green on the old code, unchanged by the move): the installed pair is the proof the
// stamp serves. `ccd/ccd-entry-install.py` publishes the body at `~/.local/libexec/ccrc/ccd` and a launcher
// rendered with the body's sha256; an installed body reads `ccrc-unmodified`, a hand-edited one reads
// `ccrc-edited`, and a launcher refuses a body whose digest is not the one it was rendered for.
//
// The committed `ccd/ccd` used to carry the marker on its line 2, which changed in every PR that touched
// the file and conflicted in 85 of 98 conflicted absorptions. The marker is now written INTO THE INSTALLED
// COPY by the installer, so the cases below read the installer's output, never the committed file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { CCD, canonicalPython3 } from './ccdWsHelpers.js';
import { verifyMarker, markGenerated } from '../../shared/mark.mjs';

const REPO = path.resolve(__dirname, '..', '..');
const PYTHON = canonicalPython3();

let home: string;
beforeEach(() => { home = mkTmp('ccrc-install-stamp-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const tree = (): string => path.join(home, 'ccrc');
const entry = (): string => path.join(home, '.local', 'bin', 'ccd');
const body = (): string => path.join(home, '.local', 'libexec', 'ccrc', 'ccd');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A shipped-tree copy at `<home>/ccrc` holding THIS checkout's real ccd body, template and installer. */
function plantTree(ccdText: string = fs.readFileSync(CCD, 'utf8')): void {
  const dir = path.join(tree(), 'ccd');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ccd'), ccdText, { mode: 0o755 });
  for (const f of ['ccd-entry.py', 'ccd-entry-install.py']) fs.copyFileSync(path.join(REPO, 'ccd', f), path.join(dir, f));
}
function install(): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(PYTHON, ['-IS', path.join(tree(), 'ccd', 'ccd-entry-install.py'), 'install', tree(), home],
    { encoding: 'utf8', cwd: home, env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
  return { code: r.status ?? -1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

describe('the installed ccd body (characterization: unchanged by the move)', () => {
  it('verifies as ccrc-unmodified', () => {
    plantTree();
    const r = install();
    expect(r.code, r.stderr).toBe(0);
    expect(verifyMarker(fs.readFileSync(body(), 'utf8'))).toBe('ccrc-unmodified');
  });

  it('a hand-edited installed copy reads as ccrc-edited', () => {
    plantTree();
    expect(install().code).toBe(0);
    fs.appendFileSync(body(), 'echo hand-edited\n');
    expect(verifyMarker(fs.readFileSync(body(), 'utf8'))).toBe('ccrc-edited');
  });

  it('the launcher refuses a body whose digest is not the one it was rendered for', () => {
    plantTree();
    expect(install().code).toBe(0);
    fs.appendFileSync(body(), 'echo hand-edited\n');
    const r = spawnSync(entry(), ['--version'], { encoding: 'utf8', cwd: home, env: { HOME: home, PATH: '/usr/bin:/bin' } });
    expect(r.status).toBe(125);
    expect(r.stderr).toContain('refused (entry-body-digest)');
  });

  it('the launcher is rendered with the sha256 of the installed bytes, not of the source file', () => {
    plantTree();
    expect(install().code).toBe(0);
    expect(fs.readFileSync(entry(), 'utf8')).toContain(`BODY_SHA256 = '${sha(fs.readFileSync(body(), 'utf8'))}'`);
  });
});
