// Delegation broker wave 5, PR1 (Task 5.1.4, W5-G6): `CCD_ARGV.leaseMark`, the server's one composer of `ws-lease-mark`'s
// argv, and the capability that gates it. Nothing in the server calls it yet (PR6 does).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_ARGV, CCD_CAN, capSupported, LEASE_AUDIT_CAP, LEASE_MARK_CAP, WS_ADD_BASE_CAP } from '../src/ccdargv.js';
import { FORBIDDEN_CCD_VERBS } from '../src/coord/approvalguard.js';
import { CHILD_DENY_RULES, childDenyRules } from '../../shared/api.js';
import { timeoutMsFor } from '../src/remote/runner.js';
import { ccdSource } from './ccdWsHelpers.js';

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

// PR2 (Task 5.2.2): `CCD_ARGV.leaseAudit`, the server's one composer of `ws-lease-audit`'s argv. Nothing calls it yet (PR7 and
// PR9 do).
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEASE = '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab';
describe('CCD_ARGV.leaseAudit', () => {
  it('W5-G13: leads with --lease, adds --holders only when asked, and refuses a malformed id or a generation below 1', () => {
    expect([...CCD_ARGV.leaseAudit(LEASE, 3, false)]).toEqual(['ws-lease-audit', '--lease', LEASE, '--generation', '3']);
    expect([...CCD_ARGV.leaseAudit(LEASE, 1, true)]).toEqual(['ws-lease-audit', '--lease', LEASE, '--generation', '1', '--holders']);
    expect(() => CCD_ARGV.leaseAudit('not-a-uuid', 1, false)).toThrow();
    expect(() => CCD_ARGV.leaseAudit(LEASE.toUpperCase(), 1, false)).toThrow();
    expect(() => CCD_ARGV.leaseAudit(`--${LEASE.slice(2)}`, 1, false)).toThrow();
    expect(() => CCD_ARGV.leaseAudit(LEASE, 0, false)).toThrow();
    expect(() => CCD_ARGV.leaseAudit(LEASE, -1, false)).toThrow();
    expect(() => CCD_ARGV.leaseAudit(LEASE, 1.5, false)).toThrow();
    expect(() => CCD_ARGV.leaseAudit(LEASE, 10_000_000_000, false)).toThrow();
  });
  it('W5-G13: its row refuses on no evidence', () => {
    expect(LEASE_AUDIT_CAP).toBe('lease-audit-v1');
    expect(capSupported({ ccdVerbs: null }, LEASE_AUDIT_CAP)).toBe(false);
    expect(capSupported({ ccdVerbs: ['lease-mark-v1'] }, LEASE_AUDIT_CAP)).toBe(false);
    expect(capSupported({ ccdVerbs: ['lease-audit-v1'] }, LEASE_AUDIT_CAP)).toBe(true);
    expect(CCD_CAN.leaseAudit).toEqual({ token: 'lease-audit-v1', default: 'refuse' });
  });
  it('W5-G14: ws-lease-audit is in no forbidden or deny list, and no skill names it', () => {
    expect(FORBIDDEN_CCD_VERBS).not.toContain('ws-lease-audit');
    expect(FORBIDDEN_CCD_VERBS).toContain('ws-lease-mark');   // CONTROL: the writer is forbidden
    for (const rules of [CHILD_DENY_RULES, childDenyRules('lane-a')]) {
      expect(rules.filter((r) => r.includes('ws-lease-audit'))).toEqual([]);
      expect(rules.filter((r) => r.includes('ws-lease-mark')).length).toBeGreaterThan(0);   // CONTROL
    }
    const hook = fs.readFileSync(path.join(REPO, 'ccd', 'session-hook.sh'), 'utf8');
    const installer = fs.readFileSync(path.join(REPO, 'ccd', 'install-session-hooks.sh'), 'utf8');
    expect(hook).not.toMatch(/ws-lease-audit/);
    expect(installer).not.toMatch(/ws-lease-audit/);
    expect(hook).toMatch(/"ws-lease-mark"/);   // CONTROL: the hook's lists name the writer
    // review 1446 F10: every skill ccd ships and installs into a home, not a named three
    const skills = fs.readdirSync(path.join(REPO, 'ccd'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith('-skill')).map((e) => e.name);
    expect(skills).toEqual(expect.arrayContaining(['coordinator-skill', 'worker-skill', 'reviewer-skill', 'history-skill',
      'linear-skill']));
    for (const skill of skills) {
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
        .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      for (const f of walk(path.join(REPO, 'ccd', skill))) {
        expect(fs.readFileSync(f, 'utf8'), path.relative(REPO, f)).not.toMatch(/ws-lease-audit|lease-audit-v1/);
      }
    }
  });
  it('W5-G15: the runner bounds an audit with --holders at two /proc walks and the git reads, within the agent\'s maximum', () => {
    const ms = timeoutMsFor('ccd', ['ws-lease-audit', '--lease', LEASE, '--generation', '1', '--holders']);
    const ccd = ccdSource();
    const bound = (name: string): number => Number(new RegExp(`^${name}=(\\d+)`, 'm').exec(ccd)?.[1] ?? NaN);
    const walks = bound('WS_PATH_USERS_SCAN_S') + bound('WS_CWD_USERS_SCAN_S');
    expect(walks).toBe(20);
    // the two walks, plus at least as long again for the git reads of one tree and the carrier read
    expect(ms).toBeGreaterThanOrEqual(walks * 1000 * 2);
    // `MAX_EXEC_TIMEOUT_MS` in agent/src/server.ts: a longer runner bound would be clamped by the agent
    const agent = fs.readFileSync(path.join(REPO, 'agent', 'src', 'server.ts'), 'utf8');
    const max = Number(/^const MAX_EXEC_TIMEOUT_MS = ([\d_]+);/m.exec(agent)?.[1]?.replace(/_/g, '') ?? NaN);
    expect(max).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(max);
    // review 1446 F14: the row exists and is below the flat default, which an unlisted verb gets
    const flat = timeoutMsFor('ccd', ['ws-lease-mark', '--lease', LEASE]);
    expect(flat).toBe(90_000);
    expect(ms).toBeLessThan(flat);
    expect(timeoutMsFor('ccd', ['ws-lease-audit', '--lease', LEASE, '--generation', '1'])).toBe(ms);   // the key is the verb
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
