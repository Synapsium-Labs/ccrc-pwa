// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC10; spec §2.8, T9): `ccd testbox-remote
// --state on` raises the marker only when the parity record passes and still matches the pin and the box file. The
// fleet-side gate, `_testbox_parity_armable`, and the server's `parityArmable` (shared/testbox-admin.ts) read the same
// two files and must agree on every row of one corpus. `--state off` is never gated. Fixture HOME only: ccd runs
// under `makeCcdHarness` with systemd and tmux contained (`ghContainedEnv`), and no box is touched.
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CCD, ccdSource, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { parityArmable, type TestboxParityRecord } from '../../shared/testbox-admin.js';

const FP = `SHA256:${'A'.repeat(43)}`;
const FP2 = `SHA256:${'B'.repeat(43)}`;
const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const WORDS = 'parity-required: run parity on the Test box card first — remote runs are NOT on';

const harnesses: CcdHarness[] = [];
afterEach(() => { for (const h of harnesses.splice(0)) h.cleanup(); });

function record(over: Partial<TestboxParityRecord> = {}): TestboxParityRecord {
  return {
    v: 1, result: 'pass', prs: [{ repo: 'app', number: 7, rev: 'c'.repeat(40) }],
    fixtures: [{ name: 'git-state', result: 'pass' }, { name: 'socket', result: 'pass' }, { name: 'workers', result: 'pass' }],
    release: 'v0.0.900', toolsKey: 'k1', fingerprint: FP, boxFileSha256: SHA, at: 1_700_000_000_000, ...over,
  };
}

interface Files { rec?: TestboxParityRecord | string | null; fp?: string | null; sha?: string | null; stale?: boolean }

/** Write the fleet-side files the verb owns under the fixture HOME: the record, and the state file's pin, box digest and stale mark. */
function seed(h: CcdHarness, f: Files): void {
  const dir = path.join(h.home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  if (f.rec !== undefined && f.rec !== null) writeFileSync(path.join(dir, 'testbox-parity.json'), typeof f.rec === 'string' ? f.rec : `${JSON.stringify(f.rec)}\n`);
  const lines: string[] = ['connected=1'];
  if (f.fp !== undefined && f.fp !== null) lines.push(`fingerprint=${f.fp}`);
  if (f.sha !== undefined && f.sha !== null) lines.push(`box_sha256=${f.sha}`);
  if (f.stale === true) lines.push('parity_stale=1');
  writeFileSync(path.join(dir, 'testbox-admin.state'), `${lines.join('\n')}\n`);
}

const GOOD: Files = { rec: record(), fp: FP, sha: SHA };

function ccd(h: CcdHarness, args: string[]): { code: number; out: string; err: string } {
  const env = ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true });
  const r = spawnSync('bash', [CCD, ...args], { cwd: h.home, env, encoding: 'utf8' });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
}
const marker = (h: CcdHarness): string => path.join(h.home, '.cc-sessions', 'testbox-remote-live');
const fresh = (): CcdHarness => { const h = makeCcdHarness('ccrc-tc10-'); harnesses.push(h); return h; };

describe('ccd testbox-remote --state on needs a passing parity record (D-8166)', () => {
  it('on is refused with no record', () => {
    const h = fresh();
    seed(h, { fp: FP, sha: SHA });
    const r = ccd(h, ['testbox-remote', '--state', 'on']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(WORDS);
    expect(existsSync(marker(h))).toBe(false);
  });

  it('on is refused with a fail record', () => {
    const h = fresh();
    seed(h, { ...GOOD, rec: record({ result: 'fail' }) });
    expect(ccd(h, ['testbox-remote', '--state', 'on']).err).toContain(WORDS);
    expect(existsSync(marker(h))).toBe(false);
  });

  it('on is refused when the fingerprint moved', () => {
    const h = fresh();
    seed(h, { ...GOOD, fp: FP2 });
    expect(ccd(h, ['testbox-remote', '--state', 'on']).err).toContain(WORDS);
    expect(existsSync(marker(h))).toBe(false);
  });

  it('on is refused when the box file sha256 moved', () => {
    const h = fresh();
    seed(h, { ...GOOD, sha: SHA2 });
    expect(ccd(h, ['testbox-remote', '--state', 'on']).err).toContain(WORDS);
    expect(existsSync(marker(h))).toBe(false);
  });

  it('on is refused when parity is stale', () => {
    const h = fresh();
    seed(h, { ...GOOD, stale: true });
    expect(ccd(h, ['testbox-remote', '--state', 'on']).err).toContain(WORDS);
    expect(existsSync(marker(h))).toBe(false);
  });

  it('on raises the marker with a matching pass', () => {
    const h = fresh();
    seed(h, GOOD);
    const r = ccd(h, ['testbox-remote', '--state', 'on']);
    expect([r.code, r.out.trim()]).toEqual([0, 'on']);
    expect(existsSync(marker(h))).toBe(true);
  });

  it('off is never refused', () => {
    const h = fresh();
    // No record, no state: off still works, and lowers a raised marker.
    writeFileSync(marker(h), '');
    const r = ccd(h, ['testbox-remote', '--state', 'off']);
    expect([r.code, r.out.trim()]).toEqual([0, 'off']);
    expect(existsSync(marker(h))).toBe(false);
  });

  it('the gate is in the one function, and ccd is read through ccdSource', () => {
    expect(ccdSource()).toMatch(/^_testbox_parity_armable\(\) \{/m);
  });

  it('_testbox_parity_armable and parityArmable agree on every corpus row', () => {
    const rows: { name: string; files: Files }[] = [
      { name: 'matching pass', files: GOOD },
      { name: 'no record', files: { fp: FP, sha: SHA } },
      { name: 'fail record', files: { ...GOOD, rec: record({ result: 'fail' }) } },
      { name: 'fingerprint moved', files: { ...GOOD, fp: FP2 } },
      { name: 'box file moved', files: { ...GOOD, sha: SHA2 } },
      { name: 'stale', files: { ...GOOD, stale: true } },
      { name: 'no pin', files: { rec: record(), sha: SHA } },
      { name: 'no box file digest', files: { rec: record(), fp: FP } },
      { name: 'record is not JSON', files: { ...GOOD, rec: 'not json' } },
      { name: 'record is an empty object', files: { ...GOOD, rec: '{}' } },
    ];
    for (const row of rows) {
      const h = fresh();
      seed(h, row.files);
      const rec = row.files.rec;
      const parsed: TestboxParityRecord | null = rec !== undefined && rec !== null && typeof rec === 'object' ? rec : null;
      const server = parityArmable(parsed, { fingerprint: row.files.fp ?? null, boxFileSha256: row.files.sha ?? null, stale: row.files.stale === true });
      let shell = true;
      try { h.sh('_testbox_parity_armable'); } catch { shell = false; }
      expect(shell, row.name).toBe(server);
    }
  });
});
