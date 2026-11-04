// Delegation broker wave 5, PR1 (Tasks 5.1.2 and 5.1.3): the lease library and `ccd ws-lease-mark`, the carrier's one writer.
// Every case runs on a FIXTURE HOME (`makeCcdHarness`): nothing here reads or writes the live `~/.cc-sessions`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lease-mark-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

describe('the lease library arrives, loaded beside the other two', () => {
  it('W5-A1: a source checkout loads the lease library beside the other two', () => {
    expect(h.sh('declare -F _dl_leases_dir >/dev/null && echo defined').trim()).toBe('defined');
  });

  it('W5-A1b: the leases directory is made 0700 with .locks and by-tree, and refused through a link', () => {
    const reg = path.join(h.home, '.cc-sessions');
    expect(h.sh('_dl_leases_dir; echo "rc=$?"').trim().split('\n').pop()).toBe('rc=0');
    expect(fs.readdirSync(path.join(reg, 'delegation', 'leases')).sort()).toEqual(['.locks', 'by-tree']);
    expect(fs.statSync(path.join(reg, 'delegation', 'leases')).mode & 0o777).toBe(0o700);
    fs.rmSync(path.join(reg, 'delegation'), { recursive: true });
    const elsewhere = fs.mkdtempSync(path.join(h.home, 'elsewhere-'));
    fs.symlinkSync(elsewhere, path.join(reg, 'delegation'));
    expect(h.sh('_dl_leases_dir; echo "rc=$?"').trim().split('\n').pop()).toBe('rc=1');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});
