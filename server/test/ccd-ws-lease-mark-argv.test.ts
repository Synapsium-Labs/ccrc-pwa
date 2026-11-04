// Delegation broker wave 5, PR1 (Task 5.1.4, W5-G6): `CCD_ARGV.leaseMark`, the server's one composer of `ws-lease-mark`'s
// argv, and the capability that gates it. Nothing in the server calls it yet (PR6 does).
import { describe, it, expect } from 'vitest';
import { CCD_ARGV, CCD_CAN, capSupported, LEASE_MARK_CAP } from '../src/ccdargv.js';

const A = { leaseId: '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab', generation: 2, project: 'demo', adminRecord: '-dash',
  parentId: 'lane-a-demo', parentIncarnation: '11111111-2222-4333-8444-555555555555', activityId: 'act-1',
  source: 'agent' as const, state: 'adopted' as const, journalSeq: 9, expiresAtMs: 1767225600000, releaseReason: null,
  promoted: null };

describe('CCD_ARGV.leaseMark', () => {
  it('W5-G6: leads with --lease, carries the record as hex and never a path', () => {
    const a = [...CCD_ARGV.leaseMark(A)];
    expect(a.slice(0, 3)).toEqual(['ws-lease-mark', '--lease', A.leaseId]);
    expect(a).toContain('--admin-record-hex');
    expect(a[a.indexOf('--admin-record-hex') + 1]).toBe(Buffer.from('-dash').toString('hex'));
    expect(a.join(' ')).not.toMatch(/\/|-dash\b/);
    expect(a.slice(a.indexOf('--expires-at'), a.indexOf('--expires-at') + 2)).toEqual(['--expires-at', '1767225600000']);
    expect(a).not.toContain('--release-reason');
    expect(a).not.toContain('--promoted-run');
  });
  it('W5-G6: a release carries its reason and a promotion its run and session, each only with its state', () => {
    const rel = [...CCD_ARGV.leaseMark({ ...A, state: 'released', releaseReason: 'foreign', expiresAtMs: null })];
    expect(rel.slice(rel.indexOf('--release-reason'), rel.indexOf('--release-reason') + 2)).toEqual(['--release-reason', 'foreign']);
    expect(rel).not.toContain('--expires-at');
    const pro = [...CCD_ARGV.leaseMark({ ...A, state: 'promoted', promoted: { runId: 12, sessionId: 'demo-bright-fern' } })];
    expect(pro.slice(pro.indexOf('--promoted-run'), pro.indexOf('--promoted-run') + 4))
      .toEqual(['--promoted-run', '12', '--promoted-session', 'demo-bright-fern']);
  });
  it('W5-G6b: refuses what the verb would refuse as usage', () => {
    expect(() => CCD_ARGV.leaseMark({ ...A, leaseId: 'not-a-uuid' })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, generation: 0 })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, project: '-p' })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, adminRecord: '..' })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, parentId: '--flag' })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, state: 'released', releaseReason: null })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, state: 'adopted', releaseReason: 'foreign' })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, state: 'promoted', promoted: null })).toThrow();
    expect(() => CCD_ARGV.leaseMark({ ...A, promoted: { runId: 12, sessionId: 'demo-bright-fern' } })).toThrow();
  });
  it('W5-G6c: no evidence refuses', () => {
    expect(capSupported({ ccdVerbs: null }, LEASE_MARK_CAP)).toBe(false);
    expect(capSupported({ ccdVerbs: ['lease-mark-v1'] }, LEASE_MARK_CAP)).toBe(true);
    expect(CCD_CAN.leaseMark).toEqual({ token: 'lease-mark-v1', default: 'refuse' });
  });
});
