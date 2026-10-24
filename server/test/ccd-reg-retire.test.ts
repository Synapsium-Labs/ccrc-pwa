// ARCH-46 (#781): one `_reg_retire` helper for the registry-retire sequence the
// five destructive callers (`ws-rm`, `ws-reap`'s tail, `ws-gc --prune`,
// `forget`, `ws-reclaim`) each spelled by hand: run `_reg_purge`, keep its
// status, and, for the one status that carries a remedy, render that remedy
// before anything can clobber the token. The helper sets two globals and
// decides nothing else: each caller still words its own failure.
//
// FIXTURE HOMES ONLY: every call below runs in a harness HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-reg-retire-'); });
afterEach(() => { h.cleanup(); });

/** Run `_reg_retire` against a stubbed `_reg_purge` and print what it set. */
const retire = (purge: string, why = ''): string[] => h.sh(
  `${purge} COMPACT_LOCK_WHY='${why}'; _reg_retire demo-slug 'ws-rm' && echo called; ` +
  `echo "rc=$REG_RETIRE_RC"; echo "why=$REG_RETIRE_WHY"`,
).split('\n');

describe('_reg_retire', () => {
  it('status 0: rc 0, no remedy rendered', () => {
    const out = retire('_reg_purge() { return 0; };');
    expect(out).toContain('rc=0');
    expect(out).toContain('why=');
  });

  it('status 3 and 2 are passed through whole and render no remedy', () => {
    for (const rc of [2, 3]) {
      const out = retire(`_reg_purge() { REG_PURGE_UNREMOVED=x; return ${rc}; };`, 'lock-path-occupied');
      expect(out, `rc ${rc}`).toContain(`rc=${rc}`);
      expect(out, `rc ${rc} renders no remedy`).toContain('why=');
    }
  });

  it('status 1 renders the shared remedy for ITS verb and id, from the token in force', () => {
    const out = retire('_reg_purge() { COMPACT_LOCK_WHY=lock-path-occupied; return 1; };');
    expect(out).toContain('rc=1');
    const want = h.sh(`COMPACT_LOCK_WHY=lock-path-occupied; _compact_lock_why_remedy demo-slug 'ws-rm'`);
    expect(want.length).toBeGreaterThan(20);
    expect(out.join('\n')).toContain(`why=${want}`);
  });

  it('always returns 0 (ccd has no set -e), so a caller reads the globals', () => {
    const out = retire('_reg_purge() { return 1; };');
    expect(out).toContain('called');
  });

  it('the five durable callers go through it and none calls _reg_purge by hand', () => {
    const src = readFileSync(CCD, 'utf8').split('\n')
      .filter((l) => !/^\s*#/.test(l));
    const direct = src.filter((l) => /\b_reg_purge "/.test(l));
    expect(direct, 'only the helper itself calls _reg_purge with an id').toHaveLength(1);
    expect(src.filter((l) => /^\s*_reg_retire "/.test(l))).toHaveLength(5);
  });
});
