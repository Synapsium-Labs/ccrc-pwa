// `$REG/pool-epoch` — the account-pool PROJECTION's reader, the account side's
// answer to `_project_pool_state`'s question. Modelled on
// `server/test/ccd-project-pool.test.ts:1-88` — see that file's own header
// for why a fresh `CcdHarness` per test (not a shared one with a `.reset()`)
// is the idiom: `CcdHarness` exposes no `reset()`, only `cleanup()`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('acct-pool-state'); });
afterEach(() => { h.cleanup(); });

/** Plant the projection with the given body; returns its path. */
function plant(body: string): string {
  const reg = path.join(h.home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const f = path.join(reg, 'pool-epoch');
  writeFileSync(f, body, 'utf8');
  return f;
}
const state = (id: string): string => h.sh(`_acct_pool_state ${id}`);

describe('_acct_pool_state', () => {
  it('answers `unreadable` when the file does not exist — absence is NOT untagged', () => {
    expect(state('acct-a')).toBe('unreadable');
  });

  it('answers `untagged` for a synced document that tags nobody', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\n');
    expect(state('acct-a')).toBe('untagged');
  });

  it('answers `named <n>` for a tagged account', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('named pool-a');
  });

  it('answers `untagged` for an account the document does not name', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-b')).toBe('untagged');
  });

  it('answers `stale` past the lease — and `stale` is NOT `unreadable`', () => {
    plant('epoch 43\nissued 1000\nlease 1001\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('stale');
  });

  it('answers `malformed` for a pool name off the grammar', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a Pool_A\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `malformed` when the document carries no epoch line', () => {
    plant('acct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `unreadable` when the file exists but cannot be read', () => {
    const f = plant('epoch 43\nissued 1000\nlease 9999999999\n');
    chmodSync(f, 0o000);
    expect(state('acct-a')).toBe('unreadable');
  });

  // A `$REG`-unsearchable case was deliberately NOT included here (pre-flight
  // ruling 2, task-1-report.md): with no `pool-epoch` file planted, the
  // `-e "$f"` file-absence check ALSO reads false under an unsearchable
  // `$REG` (the OS denies the stat before the reader's own `-d && -x` guard
  // is even reached), so the verdict comes out `unreadable` whether or not
  // that guard exists — verified by neutralising the guard directly (`true
  // || { …unreadable… }`) and observing every case, including this shape,
  // stay green. A test that cannot fail for the reason it names is worse
  // than no test; deleted rather than kept as decoration.

  it('reads the file ONCE across repeated calls (the loop-cost rule)', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    const out = h.sh(
      '_acct_pool_state acct-a >/dev/null; ' +
      '_acct_pool_state acct-b >/dev/null; ' +
      'echo "$_APS_LOADED"');
    expect(out).toBe('1');
  });
});
