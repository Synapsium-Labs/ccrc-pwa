// The drawer rig's recorded corpus (`pwa/test/fixtures/drawer/recorded/<claude-version>/*.json`) is
// scanned by the delegation rig's existing allowlist scanner (`sanitize.mjs --scan`), the same scan
// `record.sh` runs before anything enters the tree (spec 2026-10-14 §9, plan Task 6, D-5006); there is
// no second sanitiser. Hermetic: it starts no Claude Code, no docker and no tmux.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const SANITIZE = path.resolve(__dirname, 'delegation-rig/sanitize.mjs');
const CORPUS = path.resolve(__dirname, '../../pwa/test/fixtures/drawer/recorded');

const SCENARIOS = ['permission', 'write-preview', 'multiselect', 'markdown-table-code', 'busy', 'reply-done'];
const VERSION_RE = /^\d+\.\d+\.\d+$/;

describe('drawer fixtures corpus', () => {
  it('the committed corpus scans clean, and holds at least the six recorded scenarios', () => {
    const r = spawnSync(process.execPath, [SANITIZE, '--scan', CORPUS], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    const m = /^sanitize: scanned (\d+) file\(s\)/.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(6);

    const versions = fs.readdirSync(CORPUS).filter((n) => VERSION_RE.test(n));
    for (const name of SCENARIOS) {
      const found = versions.some((v) => fs.existsSync(path.join(CORPUS, v, `${name}.json`)));
      expect(found, `missing scenario ${name}`).toBe(true);
    }
  });

  it('every fixture names its own scenario and its own Claude Code version', () => {
    const versions = fs.readdirSync(CORPUS).filter((n) => VERSION_RE.test(n));
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      const files = fs.readdirSync(path.join(CORPUS, v)).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const p = path.join(CORPUS, v, file);
        const f = JSON.parse(fs.readFileSync(p, 'utf8')) as { scenario: unknown; claudeCode: unknown };
        expect(f.scenario, p).toBe(file.replace(/\.json$/, ''));
        expect(f.claudeCode, p).toBe(v);
      }
    }
  });

  it('liveness: a home path planted in one string of a copy of the corpus is a finding', () => {
    const tmp = mkTmp('ccrc-drawer-scan-');
    const copyDir = path.join(tmp, 'recorded');
    fs.cpSync(CORPUS, copyDir, { recursive: true });

    // The unplanted copy scans clean first, so the later finding is the plant's.
    const clean = spawnSync(process.execPath, [SANITIZE, '--scan', copyDir], { encoding: 'utf8' });
    expect(clean.status, clean.stderr).toBe(0);

    const versions = fs.readdirSync(copyDir).filter((n) => VERSION_RE.test(n)).sort();
    expect(versions.length).toBeGreaterThan(0);
    const firstVersion = versions[0]!;
    const files = fs.readdirSync(path.join(copyDir, firstVersion)).filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBeGreaterThan(0);
    const firstFile = files[0]!;
    const fixturePath = path.join(copyDir, firstVersion, firstFile);

    const f = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as { capture: string[] };
    f.capture[0] += ' /home/someone';
    fs.writeFileSync(fixturePath, `${JSON.stringify(f, null, 1)}\n`);

    const r = spawnSync(process.execPath, [SANITIZE, '--scan', copyDir], { encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^sanitize: residue in \S+ \/capture\/0$/m);
  });
});
