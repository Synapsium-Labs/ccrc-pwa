// Characterization (green on main, before the rung 9 rescue lands): a nested checkout of ANOTHER repository that holds commits
// on no remote answers containment-unproven at the reclaim audit and at the expiry audit, and nothing is removed. The rescue
// (D-6632) changes this only behind its marker; `ccd-nested-rescue.test.ts` pins the marker-less answer beside the new one.
// FIXTURE HOME only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, evalOf, makeChild } from './childReclaimFixture.js';
import { expireAudit, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-nested-char-'); });
afterEach(() => { h.cleanup(); });

function plantNested(wt: string): string {
  const dir = path.join(wt, 'vendor', 'other');
  fs.mkdirSync(dir, { recursive: true });
  h.git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'n1.txt'), 'nested\n');
  h.git(dir, 'add', 'n1.txt');
  h.git(dir, 'commit', '-q', '-m', 'nested');
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'not committed\n');
  return dir;
}

describe('a nested repository of another project with work on no remote', () => {
  it('the reclaim audit answers containment-unproven and the tree stays', () => {
    const c = makeChild(h);
    const dir = plantNested(c.wt);
    expect(evalOf(h).verdict).toBe('containment-unproven');
    expect(fs.existsSync(path.join(dir, 'untracked.txt'))).toBe(true);
    expect(h.reg(CHILD_ID, 'uuid')).not.toBeNull();
  }, 90_000);

  it('the expiry audit answers containment-unproven too', () => {
    const a = makeArchived(h);
    plantNested(a.wt);
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('containment-unproven');
  }, 90_000);
});
