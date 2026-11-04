// Delegation broker wave 5, PR1 (Task 5.1.4, W5-G6): `CCD_ARGV.leaseMark`, the server's one composer of `ws-lease-mark`'s
// argv, and the capability that gates it. Nothing in the server calls it yet (PR6 does).
import { describe, it, expect } from 'vitest';
import { CCD_ARGV, CCD_CAN, capSupported, LEASE_MARK_CAP, WS_ADD_BASE_CAP } from '../src/ccdargv.js';

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

// Delegation broker wave 5, PR3 (Task 5.3.2, W5-G17): `CCD_ARGV.wsAddWorkerBase`, a promoting dispatch's ws-add with a start point,
// and the capability that gates it. Its one composer is PR9's dispatch arm; nothing calls it yet.
describe('CCD_ARGV.wsAddWorkerBase', () => {
  it('W5-G17: wsAddWorkerBase leads with --child and --base, refuses a short id, and is a separate key', () => {
    const tip = 'a'.repeat(40);
    const a = [...CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, tip, null, false)];
    expect(a.slice(0, 6)).toEqual(['ws-add', '--no-rc', '--child', '12', '--base', tip]);
    expect(a.indexOf('demo')).toBeGreaterThan(a.indexOf(tip));
    expect(() => CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, 'abc', null, false)).toThrow();
    expect(() => CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, 'A'.repeat(40), null, false)).toThrow();
    expect(CCD_CAN.wsAddWorkerBase).toEqual({ token: 'ws-add-base-v1', default: 'refuse' });
    expect(CCD_CAN.wsAddWorker).toBe('none');
  });
  it('W5-G17b: a 64-hex id is accepted; 39, 41 and 63 hex, a ref and a newline-suffixed id are refused', () => {
    expect([...CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, 'b'.repeat(64), null, false)]).toContain('b'.repeat(64));
    for (const bad of ['a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'origin/main', `${'a'.repeat(40)}\n`, '']) {
      expect(() => CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, bad, null, false), JSON.stringify(bad)).toThrow();
    }
  });
  it('W5-G17c: every other flag stays where wsAddWorker puts it, and only --base is added', () => {
    const dec = { surface: 'agent' as const, actor: 'run:12 dispatch', reason: null };
    const tip = 'c'.repeat(40);
    const base = [...CCD_ARGV.wsAddWorkerBase('demo', dec, { class: 'opus' }, 12, tip, 'quiet-mesa', true)];
    const plain = [...CCD_ARGV.wsAddWorker('demo', dec, { class: 'opus' }, 12, 'quiet-mesa', true)];
    const at = base.indexOf('--base');
    expect([...base.slice(0, at), ...base.slice(at + 2)]).toEqual(plain);
    expect(base.indexOf('--route')).toBeGreaterThan(at);
    expect(base.indexOf('--route')).toBeLessThan(base.indexOf('demo'));
  });
  it('W5-G17d: no evidence refuses', () => {
    expect(WS_ADD_BASE_CAP).toBe('ws-add-base-v1');
    expect(capSupported({ ccdVerbs: null }, WS_ADD_BASE_CAP)).toBe(false);
    expect(capSupported({ ccdVerbs: ['ws-add'] }, WS_ADD_BASE_CAP), 'the verb alone is not the flag').toBe(false);
    expect(capSupported({ ccdVerbs: ['ws-add-base-v1'] }, WS_ADD_BASE_CAP)).toBe(true);
  });
});
