// _account_ok generalizes the gpt-only kill-switch (`_gpt_enabled`) to every
// wrapper: a lane is a legal AUTOMATIC destination iff its wrapper binary is
// executable AND its <w>-disabled marker is absent. Manual verbs (start/swap/
// prefer) deliberately bypass this — a named wrapper is an operator override
// by construction, not a rotation candidate. This file also pins the two
// placement rules that consume it (_ws_least_loaded, _swap_target) and the
// re-expressed _gpt_enabled, which must keep exactly its old behavior.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';

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
    disable('claude2');
    disable('claude-corp');
    expect(sh('_ws_least_loaded')).toBe('claude');
  });

  it('skips a lane with no executable', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude2', 5, 5);        // best score, but no executable
    writeLimits('claude-corp', 40, 40);
    fs.rmSync(path.join(home, '.local', 'bin', 'claude2'));
    expect(sh('_ws_least_loaded')).toBe('claude-corp');
  });
});

describe('_swap_target never returns a disabled home', () => {
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
    disable('claude-corp');
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude2');
  });

  it('the must-leave candidate loop still skips a candidate over the rate ceiling', () => {
    // _account_ok gates existence+enablement only; it must not swallow the
    // pre-existing pressure gate (_avail) the loop already had.
    writeLimits('claude', 99, 99);       // cur==home, over SWAP_CEILING: must leave
    writeLimits('claude2', 99, 99);      // account_ok is fine, but also over the ceiling
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
