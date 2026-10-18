// The approval key pin and the two doctor checks (coordinator-first routing, plan Task 14, spec §6.4 and §6.3 step 1,
// D-5297). `_inst_approval_key` (ccd/ccrc, run at the end of `_inst_files`) pins the server's Ed25519 public key once,
// into `~/.ccrc/approval-signing.pub`, and never replaces a different pinned key: it records the offer and doctor's
// `approval-key` check reports `approval-key-changed`. `approval-verifier-runnable` names each missing piece the hook
// needs before it may ask for a ruling: node, the verifier, the pinned key.
//
// HOW IT RUNS. `ccd/ccrc` is sourced (its dispatch sits under the `BASH_SOURCE` guard), then the checks file, then one
// function alone, under a fixture HOME whose `~/.local/bin/ccrc-api` is a stub answering from a file. The key pairs
// are generated here. Nothing reaches the live HOME and no network is touched.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(__dirname, '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const CHECKS = path.join(REPO, 'ccd', 'ccrc-doctor-checks');
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const pub = (): string => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_A = pub();
const KEY_B = pub();

let home: string;
const put = (rel: string, text: string, mode = 0o644): void => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { mode });
};
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$HOME/stub.calls"
cat "$HOME/stub.body"
printf 'http %s\\n' "$(cat "$HOME/stub.code")" >&2
`;
beforeEach(() => {
  home = mkTmp('ccrc-aprkey-');
  put('.local/bin/ccrc-api', STUB, 0o755);
  put('stub.code', '200');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const offer = (key: string): void => put('stub.body', JSON.stringify({ v: 1, alg: 'ed25519', publicKey: key }));
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
/** Sources the two files, then sets `vars` (sourcing `ccrc` sets its own `INST_ROLE` and `BOX_ENV_FILE`), then runs `fn`. */
const run = (fn: string, vars: Record<string, string> = {}, env: Record<string, string> = {}): { code: number; out: string } => {
  const set = Object.entries({ INST_ROLE: 'fleet', ...vars }).map(([k, v]) => `${k}=${shq(v)}`).join('; ');
  const script = `source ${shq(CCRC)}; source ${shq(CHECKS)}; ${set}; ${fn}`;
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { ...process.env, HOME: home, ...env } });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};
const pinned = (): string | null => {
  const p = path.join(home, '.ccrc', 'approval-signing.pub');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

describe('install: the server\'s approval key is pinned once, and never replaced', () => {
  it('a key is pinned when absent, mode 0644, and the run says so', () => {
    offer(KEY_A);
    const r = run('_inst_approval_key');
    expect(r.code).toBe(0);
    expect(pinned()).toBe(KEY_A);
    expect(fs.statSync(path.join(home, '.ccrc', 'approval-signing.pub')).mode & 0o777).toBe(0o644);
    expect(r.out).toMatch(/approval key: pinned/);
    expect(fs.readFileSync(path.join(home, 'stub.calls'), 'utf8')).toBe('approvals key\n');
  });
  it('the same key again: nothing changes', () => {
    offer(KEY_A);
    run('_inst_approval_key');
    const r = run('_inst_approval_key');
    expect(pinned()).toBe(KEY_A);
    expect(r.out).toMatch(/the pinned key is the server's/);
  });
  it('a different key is refused and reported: the pinned key stays, the offer is recorded', () => {
    offer(KEY_A);
    run('_inst_approval_key');
    offer(KEY_B);
    const r = run('_inst_approval_key');
    expect(r.code, 'never fatal').toBe(0);
    expect(pinned(), 'the pinned key was not replaced').toBe(KEY_A);
    expect(r.out).toMatch(/REFUSED .*approval-key-changed/);
    expect(fs.readFileSync(path.join(home, '.ccrc', 'approval-key-offered'), 'utf8')).toBe(KEY_B);
    const d = run('_check_approval-key');
    expect(d.out).toMatch(/^FAIL approval-key: approval-key-changed/m);
    expect(d.code).toBe(1);
  });
  it.each([
    ['an older server (404)', '404', '{"message":"Route GET:/api/approvals/key not found"}'],
    ['a refusal (409)', '409', '{"ok":false,"error":"single-box"}'],
    ['a 200 that is not an Ed25519 key', '200', '{"v":1,"alg":"rsa","publicKey":"x"}'],
    ['a 200 that is not JSON', '200', 'nope'],
  ])('%s pins nothing and fails nothing', (_n, code, body) => {
    put('stub.code', code);
    put('stub.body', body);
    const r = run('_inst_approval_key');
    expect(r.code).toBe(0);
    expect(pinned()).toBeNull();
    expect(r.out).toMatch(/approval key: not pinned/);
  });
  it('a server-role box pins nothing and asks nothing', () => {
    offer(KEY_A);
    run('_inst_approval_key', { INST_ROLE: 'server' });
    expect(pinned()).toBeNull();
    expect(fs.existsSync(path.join(home, 'stub.calls'))).toBe(false);
  });
  it('_inst_files places the verifier at 644 before the hook and then pins the key', () => {
    const src = fs.readFileSync(CCRC, 'utf8');
    const body = /\n_inst_files\(\) \{([\s\S]*?)\n\}\n/.exec(src)?.[1] ?? '';
    const verifier = body.indexOf('_inst_atomic "$tree/ccd/approval-verify.mjs" "$HOME/.cc-sessions/approval-verify.mjs" 644');
    const hook = body.indexOf('_inst_atomic "$tree/ccd/session-hook.sh"');
    expect(verifier).toBeGreaterThan(-1);
    expect(verifier).toBeLessThan(hook);
    expect(body.trimEnd().endsWith('_inst_approval_key')).toBe(true);
    expect(src).toContain('_upd_backup_copy "$HOME/.cc-sessions/approval-verify.mjs" approval-verify.mjs');
    expect(src).toMatch(/"\$reg\/approval-verify\.mjs"/);
  });
});

describe('doctor: approval-verifier-runnable names each missing piece', () => {
  const ready = (): void => {
    put('.cc-sessions/approval-verify.mjs', '// verifier\n');
    put('.ccrc/approval-signing.pub', KEY_A);
  };
  it('all three present: PASS', () => {
    ready();
    const r = run('_check_approval-verifier-runnable');
    expect(r.out).toMatch(/^PASS approval-verifier-runnable:/m);
    expect(r.code).toBe(0);
  });
  it('no verifier: a WARN naming the verifier, and only it', () => {
    ready();
    fs.rmSync(path.join(home, '.cc-sessions', 'approval-verify.mjs'));
    const r = run('_check_approval-verifier-runnable');
    expect(r.out).toMatch(/^WARN approval-verifier-runnable: .*missing: the verifier/m);
    expect(r.out).not.toMatch(/pinned key \(/);
    expect(r.out).not.toMatch(/node \(not on PATH\)/);
  });
  it('no pinned key alone: a SKIP, not a WARN, so a fresh install still ends green (D-139)', () => {
    // A key not pinned yet is the rollout's expected state (D-5487 (1)): the server had not served one when this box
    // last updated. Nothing here is broken, and every prompt goes to the operator as today.
    ready();
    fs.rmSync(path.join(home, '.ccrc', 'approval-signing.pub'));
    const r = run('_check_approval-verifier-runnable');
    expect(r.out).toMatch(/^SKIP approval-verifier-runnable: no approval key is pinned yet/m);
    expect(r.code).toBe(3);
  });
  it('no verifier and no pinned key: a WARN naming both', () => {
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const r = run('_check_approval-verifier-runnable');
    expect(r.out).toMatch(/^WARN approval-verifier-runnable: .*missing: the verifier .*, the pinned key/m);
  });
  it('node not on PATH: a WARN naming node', () => {
    ready();
    // A PATH holding only the tools the two sourced files need to load, and no node.
    const bin = path.join(home, 'nonode');
    fs.mkdirSync(bin);
    for (const t of ['cat', 'dirname', 'uname', 'id', 'tr', 'sed', 'awk', 'grep', 'head', 'date', 'mkdir', 'rm', 'jq']) {
      const p = spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
      if (p !== '') fs.symlinkSync(p, path.join(bin, t));
    }
    const r = run('_check_approval-verifier-runnable', {}, { PATH: bin });
    expect(r.out).toMatch(/^WARN approval-verifier-runnable: .*missing: node \(not on PATH\)/m);
  });
  it('a server-role box: SKIP', () => {
    put('.ccrc/box.env', 'CCRC_ROLE=server\n');
    const r = run('_check_approval-verifier-runnable', { BOX_ENV_FILE: path.join(home, '.ccrc', 'box.env') });
    expect(r.out).toMatch(/^SKIP approval-verifier-runnable:/m);
  });
  it('a box with no session registry: SKIP, not a WARN, even with the key pinned', () => {
    put('.ccrc/approval-signing.pub', KEY_A);
    const r = run('_check_approval-verifier-runnable');
    expect(r.out).toMatch(/^SKIP approval-verifier-runnable: .*no session registry/m);
    expect(r.code).toBe(3);
  });
  it('approval-key: PASS when no other key was offered, SKIP with none pinned', () => {
    expect(run('_check_approval-key').out).toMatch(/^SKIP approval-key:/m);
    put('.ccrc/approval-signing.pub', KEY_A);
    expect(run('_check_approval-key').out).toMatch(/^PASS approval-key:/m);
  });
});
