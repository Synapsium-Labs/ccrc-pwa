// _account_ok generalizes the gpt-only kill-switch (`_gpt_enabled`) to every
// wrapper: a lane is a legal AUTOMATIC destination iff its wrapper binary is
// executable AND its <w>-disabled marker is absent. Manual verbs (start/swap/
// prefer) deliberately bypass this — a named wrapper is an operator override
// by construction, not a rotation candidate. This file also pins the two
// placement rules that consume it (_ws_least_loaded, _swap_target) and the
// re-expressed _gpt_enabled, which must keep exactly its old behavior.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';
const reg = (id: string, field: string): string | null => h.reg(id, field);
const makeRepo = (name: string): string => h.makeRepo(name);

const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

const disable = (w: string): void =>
  fs.writeFileSync(path.join(home, '.cc-sessions', `${w}-disabled`), '');

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-account-ok-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_account_ok', () => {
  it('succeeds in a fresh harness (stub binary present, no marker)', () => {
    expect(ok('_account_ok claude')).toBe(true);
  });

  it('fails once the lane is disabled, and recovers when the marker is removed', () => {
    const marker = path.join(home, '.cc-sessions', 'claude-disabled');
    fs.writeFileSync(marker, '');
    expect(ok('_account_ok claude')).toBe(false);
    fs.rmSync(marker);
    expect(ok('_account_ok claude')).toBe(true);
  });

  it('fails when the wrapper is not executable', () => {
    fs.chmodSync(path.join(home, '.local', 'bin', 'claude2'), 0o644);
    expect(ok('_account_ok claude2')).toBe(false);
  });
});

describe('_ws_least_loaded skips excluded lanes', () => {
  it('skips disabled lanes even when their score is best', () => {
    writeLimits('claude', 90, 90);       // worst score, but the only enabled lane
    writeLimits('claude2', 5, 5);
    writeLimits('claude-corp', 5, 5);
    writeLimits('claude-dev0', 5, 5);
    disable('claude2');
    disable('claude-corp');
    disable('claude-dev0');
    expect(sh('_ws_least_loaded')).toBe('claude');
  });

  it('skips a lane with no executable', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude2', 5, 5);        // best score, but no executable
    writeLimits('claude-corp', 40, 40);
    writeLimits('claude-dev0', 60, 60);
    fs.rmSync(path.join(home, '.local', 'bin', 'claude2'));
    expect(sh('_ws_least_loaded')).toBe('claude-corp');
  });
});

describe('_swap_target: disabled excludes a lane as a DESTINATION, never evacuates a session already there', () => {
  it('cur==home, home disabled but under the rate ceiling -> stays (empty stdout)', () => {
    // Spec rule, verbatim: "disabled excludes a lane as a destination; it
    // never evacuates a session already there." The cur==home branch
    // (ccd/ccd ~6406-6407) is `_avail "$home" && return 0` — deliberately no
    // `_account_ok` check. A future edit that hoisted `_account_ok` above
    // that `_avail` would evacuate every session off a lane the operator
    // only meant to stop RECEIVING new work; today this stays green.
    writeLimits('claude', 5, 5);   // well under SWAP_CEILING
    disable('claude');
    expect(sh('_swap_target claude-demo claude claude')).toBe('');
  });

  it('registry home disabled, current wrapper fine -> stays put (empty stdout)', () => {
    // cur (claude2) and home (claude) differ; claude carries no telemetry so
    // the OLD `_avail "$home"` alone would call it free and route back onto it.
    disable('claude');
    expect(sh('_swap_target claude-demo claude2 claude')).toBe('');
  });

  it('the must-leave candidate loop skips a disabled lane even at the best score', () => {
    writeLimits('claude', 99, 99);       // cur==home, over SWAP_CEILING: must leave
    writeLimits('claude-corp', 5, 5);    // best score, but disabled
    writeLimits('claude2', 50, 50);      // worse score, the only eligible candidate
    writeLimits('claude-dev0', 60, 60);  // worse still, so claude2 remains the pick
    disable('claude-corp');
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude2');
  });

  it('the must-leave candidate loop still skips a candidate over the rate ceiling', () => {
    // _account_ok gates existence+enablement only; it must not swallow the
    // pre-existing pressure gate (_avail) the loop already had.
    writeLimits('claude', 99, 99);       // cur==home, over SWAP_CEILING: must leave
    writeLimits('claude2', 99, 99);      // account_ok is fine, but also over the ceiling
    writeLimits('claude-dev0', 99, 99);  // likewise over the ceiling, so no lane qualifies
    disable('claude-corp');              // excluded a different way, to isolate the avail check
    // No candidate qualifies, so the function's own exit code is non-zero
    // (the trailing `[[ -n "$best" ]] && echo` never runs) — `|| true` is the
    // house idiom for capturing that empty stdout without throwing.
    expect(sh('_swap_target claude-demo claude claude || true')).toBe('');
  });
});

describe('_gpt_enabled re-expressed as _account_ok gpt', () => {
  it('fails when the gpt wrapper is not installed (harness never installs it)', () => {
    expect(ok('_gpt_enabled')).toBe(false);
  });

  it('still honors $REG/gpt-disabled once the wrapper exists', () => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    expect(ok('_gpt_enabled')).toBe(true);
    disable('gpt');
    expect(ok('_gpt_enabled')).toBe(false);
  });
});

// cmd_ws_add hoists the account pick into its preflight, beside the disk
// floor: _ws_least_loaded is pure reads, so it is safe to run before anything
// is created. All-excluded must refuse before the worktree/branch/registry
// exist — the same "leave the box exactly as it found it" contract the disk
// floor already keeps (ccd-workspaces.test.ts's disk-floor describe block).
describe('cmd_ws_add preflight — all-excluded refuses before anything exists', () => {
  it('dies and creates no worktree, no branch, no registry entry', () => {
    makeRepo('demo');
    disable('claude'); disable('claude2'); disable('claude-corp'); disable('claude-dev0');
    expect(() => sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`)).toThrow();
    expect(fs.existsSync(path.join(home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    // The branch must not exist either: a preflight that ran after
    // `worktree add` would leave a branch behind on every refusal.
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).toBe('');
  });

  it('names each wrapper with its reason — disabled and missing both appear', () => {
    makeRepo('demo');
    disable('claude'); disable('claude-corp'); disable('claude-dev0');
    fs.rmSync(path.join(home, '.local', 'bin', 'claude2'));
    let stderr = '';
    try {
      sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(stderr).toContain('claude:disabled');
    expect(stderr).toContain('claude2:missing');
    expect(stderr).toContain('claude-corp:disabled');
    expect(stderr).toContain('claude-dev0:disabled');
    expect(stderr).toContain('nothing was touched');
  });

  it('one enabled lane still succeeds and lands on it, even at the worst score', () => {
    // Pressure alone never refuses (the all-pinned fixture rule stands):
    // claude-corp is the only _account_ok lane, despite scoring worst.
    makeRepo('demo');
    writeLimits('claude', 5, 5);
    writeLimits('claude2', 5, 5);
    writeLimits('claude-corp', 90, 90);
    writeLimits('claude-dev0', 5, 5);
    disable('claude'); disable('claude2'); disable('claude-dev0');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'wrapper')).toBe('claude-corp');
  });
});
