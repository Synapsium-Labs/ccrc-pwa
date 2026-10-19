// Doctor's two server-side approval checks (coordinator-first routing plan Task 16, spec §6.1 and §6.3, D-5298,
// D-5490): `approval-key-colocated` (the server's private key beside session rows, opted in or not) and
// `approval-digest-mismatch` (the journal's count of `409 digest-mismatch` in the last seven days). Each check is run
// alone under a fixture HOME, the `ccrc-approval-key.test.ts` harness.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { APPROVAL_REFUSALS_LOG, APPROVAL_SIGNING_KEY_FILE } from '../../shared/api.js';

const REPO = path.resolve(__dirname, '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const CHECKS = path.join(REPO, 'ccd', 'ccrc-doctor-checks');
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

let home: string;
const put = (rel: string, text: string): void => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
beforeEach(() => { home = mkTmp('ccrc-aprdoc-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
const run = (fn: string, role = 'both', more = ''): { code: number; out: string } => {
  put('.ccrc/box.env', `CCRC_ROLE=${role}\n${more}`);
  const script = `source ${shq(CCRC)}; source ${shq(CHECKS)}; BOX_ENV_FILE=${shq(path.join(home, '.ccrc', 'box.env'))}; ${fn}`;
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: ghContainedEnv(home, { ...process.env, HOME: home }) });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};

describe('doctor: approval-key-colocated (spec §6.1)', () => {
  it('the server\'s key file beside a session row: a WARN with the word, not opted in', () => {
    put(`.ccrc/${APPROVAL_SIGNING_KEY_FILE}`, 'key\n');
    put('.cc-sessions/project-a-quiet-basin.uuid', 'u-1\n');
    const r = run('_check_approval-key-colocated');
    expect(r.out).toMatch(/^WARN approval-key-colocated: approval-key-colocated: .*1 session row\(s\).*has not opted in/m);
    expect(r.code).toBe(2);
  });
  it('reported whether or not the operator opted in', () => {
    put(`.ccrc/${APPROVAL_SIGNING_KEY_FILE}`, 'key\n');
    put('.cc-sessions/project-a-quiet-basin.uuid', 'u-1\n');
    put('.ccrc/approvals-single-box', '');
    const r = run('_check_approval-key-colocated');
    expect(r.out).toMatch(/^WARN approval-key-colocated: .*the operator opted in/m);
  });
  it('follows the server\'s own gate: a server role over CCRC_FLEET=remote mints without the opt-in; over local it does not', () => {
    put(`.ccrc/${APPROVAL_SIGNING_KEY_FILE}`, 'key\n');
    put('.cc-sessions/project-a-quiet-basin.uuid', 'u-1\n');
    expect(run('_check_approval-key-colocated', 'server', 'CCRC_FLEET=remote\n').out)
      .toMatch(/^WARN approval-key-colocated: .*CCRC_FLEET=remote, so this server mints and signs rulings here without the opt-in/m);
    expect(run('_check_approval-key-colocated', 'server', 'CCRC_FLEET=local\n').out)
      .toMatch(/^WARN approval-key-colocated: .*has not opted in, so this server mints no rulings/m);
    expect(run('_check_approval-key-colocated', 'both', 'CCRC_FLEET=remote\n').out)
      .toMatch(/^WARN approval-key-colocated: .*has not opted in, so this server mints no rulings/m);
  });
  it('silent on a server-only HOME: the key and no session rows is a PASS', () => {
    put(`.ccrc/${APPROVAL_SIGNING_KEY_FILE}`, 'key\n');
    const r = run('_check_approval-key-colocated', 'server');
    expect(r.out).toMatch(/^PASS approval-key-colocated:/m);
    expect(r.code).toBe(0);
  });
  it('no key at all: a SKIP', () => {
    put('.cc-sessions/project-a-quiet-basin.uuid', 'u-1\n');
    expect(run('_check_approval-key-colocated', 'fleet').out).toMatch(/^SKIP approval-key-colocated:/m);
  });
});

describe('doctor: approval-digest-mismatch (spec §6.3, D-5490)', () => {
  const nowMs = (): number => Date.now();
  it('no journal: PASS', () => {
    expect(run('_check_approval-digest-mismatch', 'server').out).toMatch(/^PASS approval-digest-mismatch:/m);
  });
  it('a refusal in the last seven days is a WARN with the count; an older one is not counted', () => {
    put(`.ccrc/${APPROVAL_REFUSALS_LOG}`,
      `${nowMs() - 8 * 86_400_000} digest-mismatch project-a-quiet-basin\n` +
      `${nowMs() - 60_000} digest-mismatch project-a-quiet-basin\n` +
      `${nowMs() - 30_000} digest-mismatch project-a-still-cove\n` +
      'garbage line\n');
    const r = run('_check_approval-digest-mismatch', 'server');
    expect(r.out).toMatch(/^WARN approval-digest-mismatch: approval-digest-mismatch: 2 approval request\(s\)/m);
    expect(r.code).toBe(2);
  });
  it('only old refusals: PASS', () => {
    put(`.ccrc/${APPROVAL_REFUSALS_LOG}`, `${nowMs() - 8 * 86_400_000} digest-mismatch project-a-quiet-basin\n`);
    expect(run('_check_approval-digest-mismatch', 'server').out).toMatch(/^PASS approval-digest-mismatch:/m);
  });
  it('a fleet-role box: SKIP', () => {
    expect(run('_check_approval-digest-mismatch', 'fleet').out).toMatch(/^SKIP approval-digest-mismatch:/m);
  });
});
