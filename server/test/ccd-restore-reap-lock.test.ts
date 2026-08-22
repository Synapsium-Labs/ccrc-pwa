// server/test/ccd-restore-reap-lock.test.ts
//
// The emit must be INSIDE the flock region (opened ccd:3073, closed ccd:3127),
// or a concurrent `ws-reap` can change `.archived` between the read and the
// unlink and the record describes a state that never existed at once.
//
// It must also never `return` non-zero from inside that region: ccd:3118-3123
// records that any new `return` between 3073 and 3127 leaks the reap lock in the
// SOURCING shell for ever. `_lc_done` returns 0 on every path, which is exactly
// what makes this site safe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');

describe('ws-restore\'s supersede emit lives inside the reap flock region', () => {
  const from = src.indexOf('cmd_ws_restore() {');
  const body = src.slice(from, src.indexOf('cmd_ws_attic() {'));

  it('found the function body, and it is substantial', () => {
    expect(from, 'cmd_ws_restore not found').toBeGreaterThan(-1);
    expect(body.length, 'the slice collapsed — every assertion below is vacuous')
      .toBeGreaterThan(5000);
  });

  it('emits AFTER the lock is taken and BEFORE the rm -f', () => {
    const lockAt = body.indexOf('flock -n "$lfd"');
    const emitAt = body.indexOf('_lc_done restore');
    const rmAt = body.indexOf('rm -f "$REG/$id.archived"');
    const closeAt = body.indexOf('exec {lfd}>&-', rmAt);
    expect(lockAt).toBeGreaterThan(-1);
    expect(rmAt, 'the erase moved — re-measure before trusting this').toBeGreaterThan(-1);
    expect(emitAt, '_lc_done restore not found in cmd_ws_restore').toBeGreaterThan(-1);
    expect(emitAt, 'the emit must be under the lock').toBeGreaterThan(lockAt);
    expect(emitAt, 'the emit must read the values BEFORE they are unlinked').toBeLessThan(rmAt);
    expect(closeAt, 'the region must still close after the erase').toBeGreaterThan(rmAt);
  });

  it('adds no `return` between the lock and its release', () => {
    // Mutant: give the emit a `|| return 1` -> this fails, and the reap lock is
    // held for ever in the shell that sourced ccd.
    const lockAt = body.indexOf('flock -n "$lfd"');
    const rmAt = body.indexOf('rm -f "$REG/$id.archived"');
    const window = body.slice(lockAt, rmAt);
    expect(window).not.toMatch(/_lc_done restore[\s\S]{0,400}\|\|\s*return/);
    expect(window, 'a refusal inside the region would exit through die, not the close')
      .not.toMatch(/_lc_fail/);
  });

  it('the spawn-failure emits are OUTSIDE the region — after the descriptor is closed', () => {
    const closeAt = body.indexOf('exec {lfd}>&-', body.indexOf('rm -f "$REG/$id.archived"'));
    const failAt = body.indexOf('_lc_fail restore');
    expect(failAt, '_lc_fail restore not found').toBeGreaterThan(-1);
    expect(failAt, 'a spawn-failure emit inside the region would sit on a return path')
      .toBeGreaterThan(closeAt);
  });
});
