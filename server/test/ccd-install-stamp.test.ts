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

describe('the committed ccd/ccd carries no generated stamp (install-time stamping)', () => {
  const committed = fs.readFileSync(CCD, 'utf8');

  it('has no line claiming provenance and no literal digest on line 2', () => {
    expect(committed.split('\n').filter((l) => l.startsWith('# ccrc:generated'))).toEqual([]);
    expect(verifyMarker(committed)).toBe('foreign');
    expect(committed.split('\n')[0]).toBe('#!/usr/bin/env bash');
  });

  it('keeps line 2 as one fixed placeholder, so the installed copy has the committed copy\'s line numbers', () => {
    expect(committed.split('\n')[1]).toBe('# ccrc:stamp-at-install — written into the installed copy by ccd/ccd-entry-install.py; never committed');
  });

  it('install output carries a FRESH marker: the digest of the installed body minus its own marker line', () => {
    plantTree();
    expect(install().code).toBe(0);
    const text = fs.readFileSync(body(), 'utf8');
    const lines = text.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines[1]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
    expect(lines.length, 'the marker replaced the placeholder in place').toBe(committed.split('\n').length);
    expect(text).toBe(markGenerated(committed.split('\n').filter((_l, i) => i !== 1).join('\n')));
    expect(verifyMarker(text)).toBe('ccrc-unmodified');
  });

  it('a body edit changes the installed marker with no committed digest to restamp', () => {
    plantTree();
    expect(install().code).toBe(0);
    const before = fs.readFileSync(body(), 'utf8').split('\n')[1];
    plantTree(`${fs.readFileSync(CCD, 'utf8')}# one more line\n`);
    expect(install().code).toBe(0);
    const after = fs.readFileSync(body(), 'utf8');
    expect(after.split('\n')[1]).not.toBe(before);
    expect(verifyMarker(after)).toBe('ccrc-unmodified');
  });

  it('stamps a body with no placeholder by inserting after the shebang, exactly as markGenerated does', () => {
    const plain = '#!/usr/bin/env bash\necho fixture\n';
    plantTree(plain);
    expect(install().code).toBe(0);
    expect(fs.readFileSync(body(), 'utf8')).toBe(markGenerated(plain));
  });

  it('re-stamps a body that still carries a legacy marker, hashing the body without it', () => {
    const legacy = markGenerated('#!/usr/bin/env bash\necho fixture\n').replace(/sha256=[0-9a-f]{64}/, `sha256=${'0'.repeat(64)}`);
    plantTree(legacy);
    expect(install().code).toBe(0);
    expect(fs.readFileSync(body(), 'utf8')).toBe(markGenerated('#!/usr/bin/env bash\necho fixture\n'));
  });
});
