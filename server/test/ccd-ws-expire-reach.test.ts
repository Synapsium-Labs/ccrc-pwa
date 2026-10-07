// `ws-expire` made REACHABLE (workspace lifecycle spec 2026-09-24 §5.3): the dispatcher arm, the verb's name in
// `ccd caps` and its capability token `expire-v1`. The direct-entry boundary both protected shapes cross — `ws-expire`
// and `ws-audit --session <id> --expire` — is held in `ccd-child-reclaim-entry.test.ts`'s one grammar table, beside
// ws-reclaim's. FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-reach-'); });
afterEach(() => { h.cleanup(); });

/** The dispatcher, not the function, under `bash -p` — the installed launcher's start for a protected argv. */
const runCcd = (...args: string[]): { code: number; stderr: string } => {
  try {
    execFileSync('bash', ['-p', CCD, ...args], { encoding: 'utf8', cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { code: 0, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

describe('reachable: the capability token and the dispatcher arm', () => {
  it('ccd caps advertises the verb AND its capability token', () => {
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('ws-expire');
    expect(advertised).toContain('expire-v1');
  });

  it('the dispatcher routes ws-expire (its own usage, not the unknown-verb line) and the usage line names it', () => {
    const r = runCcd('ws-expire');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-expire');
    expect(r.stderr).not.toContain('usage: ccd {start|');
    expect(runCcd('no-such-verb').stderr).toContain('|ws-expire|');
  });

  it('an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs', () => {
    for (const argv of [['ws-expire'], ['ws-audit', '--session', 'x', '--expire']]) {
      let code = 0; let stderr = '';
      try {
        execFileSync('bash', [CCD, ...argv], { encoding: 'utf8', cwd: h.home,
          env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
      } catch (e) { const err = e as { status?: number; stderr?: string }; code = err.status ?? 1; stderr = String(err.stderr ?? ''); }
      expect(code, argv.join(' ')).toBe(125);
      expect(stderr).toContain('refused (entry-unprivileged)');
    }
  });
});
