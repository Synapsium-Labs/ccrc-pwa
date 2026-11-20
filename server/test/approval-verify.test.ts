/**
 * The child's ruling verifier, `ccd/approval-verify.mjs` (plan Task 14, spec §6.3 hook step 5, D-5297): it prints a
 * verdict only for a ruling whose Ed25519 signature verifies against the pinned key and which names this session,
 * agent, digest, nonce and row, has not expired, and for an allow carries class `ordinary`. Its canonical form is the
 * documented second copy of `approvalRulingBytes` (shared/api.ts), held equal here over a corpus of records.
 *
 * The key pair is generated in the test, never committed. The CLI runs under a fixture HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { approvalRulingBytes, canonicalJson, type ApprovalRulingRecord, type ApprovalRulingRecordV1 } from '../../shared/api.js';
import { canonical, recordBytes, verdictFor, RECORD_KEYS, RECORD_KEYS_V2, AUTHORITIES, FAMILIES } from '../../ccd/approval-verify.mjs';
import { APPROVAL_RULING_AUTHORITIES, APPROVAL_RULING_FAMILIES } from '../../shared/approval-park.js';

const VERIFY = path.resolve(__dirname, '../../ccd/approval-verify.mjs');
const NOW = 1_760_000_000_000;
const DIGEST = 'a'.repeat(64);
const NONCE = '0123456789abcdef0123456789abcdef';

const pair = (): { pub: string; priv: KeyObject } => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey };
};
const ours = pair();
const theirs = pair();

const record = (over: Partial<ApprovalRulingRecordV1> = {}): ApprovalRulingRecordV1 => ({
  v: 1, rowId: 7, sessionId: 'project-a-quiet-basin', agentId: '', digest: DIGEST, nonce: NONCE,
  class: 'ordinary', verdict: 'allow', reason: 'a cleanup inside your worktree', expiresAt: NOW + 60_000, ...over,
});
const signed = (r: ApprovalRulingRecord, key: KeyObject = ours.priv): { record: ApprovalRulingRecord; sig: string } => ({
  record: r, sig: sign(null, Buffer.from(approvalRulingBytes(r) as string, 'utf8'), key).toString('base64'),
});
const expected = { sessionId: 'project-a-quiet-basin', agentId: '', digest: DIGEST, nonce: NONCE, rowId: 7, now: NOW };

describe('approval-verify: the canonical record bytes equal approvalRulingBytes', () => {
  const corpus: ApprovalRulingRecord[] = [
    record(),
    record({ agentId: 'a0000000000000001', verdict: 'deny', class: 'escalate', reason: 'not this one' }),
    record({ reason: 'é \u007f \u0001 / " \\ \n\t 😀 ！' }),
    record({ rowId: 9_007_199_254_740_991, expiresAt: 0 }),
    record({ sessionId: 'project-a-still-cove', reason: '' }),
  ];
  it.each(corpus.map((r, i) => [i, r] as const))('record %i', (_i, r) => {
    expect(recordBytes(r)).toBe(approvalRulingBytes(r));
    expect(canonical(r)).toBe(canonicalJson(r));
  });
  it('the record has exactly its ten fields, in both copies', () => {
    expect([...RECORD_KEYS].sort()).toEqual(Object.keys(record()).sort());
    expect(recordBytes({ ...record(), extra: 1 }), 'an eleventh field').toBeNull();
    const { reason: _r, ...nine } = record();
    expect(recordBytes(nine), 'a missing field').toBeNull();
  });
  it('a non-integer number has no canonical form in either copy', () => {
    expect(canonical({ x: 0.5 })).toBeNull();
    expect(canonicalJson({ x: 0.5 })).toBeNull();
    expect(canonical({ x: 2 ** 53 })).toBeNull();
    expect(canonical({ x: -0 })).toBe('{"x":0}');
  });
});

describe('approval-verify: what it accepts', () => {
  it('a signed ordinary allow for this session, agent, digest, nonce and row: `allow <reason>`', () => {
    expect(verdictFor(signed(record()), expected, ours.pub)).toBe('allow a cleanup inside your worktree');
  });
  it('a signed deny, any class: `deny <reason>`, on one line', () => {
    expect(verdictFor(signed(record({ verdict: 'deny', class: 'escalate', reason: 'no\nsir' })), expected, ours.pub))
      .toBe('deny no sir');
  });
  it('a subagent ruling names its agent', () => {
    const r = record({ agentId: 'a0000000000000001' });
    expect(verdictFor(signed(r), { ...expected, agentId: 'a0000000000000001' }, ours.pub)).toMatch(/^allow /);
    expect(verdictFor(signed(r), expected, ours.pub), 'the main thread is not that agent').toBeNull();
  });
});

describe('approval-verify: a forged or misdirected ruling prints nothing', () => {
  const cases: Array<[string, unknown]> = [
    ['signed by another key', signed(record(), theirs.priv)],
    ['unsigned', { record: record() }],
    ['an empty signature', { record: record(), sig: '' }],
    ['a good signature over another digest', { record: record(), sig: signed(record({ digest: 'b'.repeat(64) })).sig }],
    ['another digest', signed(record({ digest: 'b'.repeat(64) }))],
    ['another nonce', signed(record({ nonce: 'f'.repeat(32) }))],
    ['another session', signed(record({ sessionId: 'project-a-still-cove' }))],
    ['another row', signed(record({ rowId: 8 }))],
    ['another agent', signed(record({ agentId: 'a0000000000000002' }))],
    ['expired', signed(record({ expiresAt: NOW }))],
    ['an allow of class escalate', signed(record({ class: 'escalate' }))],
    ['an allow of class forbidden', signed(record({ class: 'forbidden' }))],
    ['an unknown verdict', signed({ ...record(), verdict: 'maybe' } as unknown as ApprovalRulingRecord)],
    ['a version 2 record', signed({ ...record(), v: 2 } as unknown as ApprovalRulingRecord)],
    ['not an object', 'allow'],
  ];
  it.each(cases)('%s', (_name, ruling) => {
    expect(verdictFor(ruling, expected, ours.pub)).toBeNull();
  });
  it('a key that is not Ed25519 verifies nothing', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    expect(verdictFor(signed(record()), expected, publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBeNull();
  });
});

// Approvals PR 3v (plan 2026-11-18, §3.6 Table 3b; the patch in docs/superpowers/programs/overlord/
// approvals-pr3-verifier-patch.md, applied as written): a v2 record is v1's ten fields plus `authority`, `denyCurrent` and
// `family`. Only the operator's authority is issued, family `none`; an operator allow admits `ordinary` or `escalate`,
// never `forbidden`, at any deny currency.
describe('approval-verify: record v2 (approvals PR 3v)', () => {
  type V2 = Omit<ApprovalRulingRecordV1, 'v'> & { v: 2; authority: string; denyCurrent: unknown; family: string };
  const v2 = (over: Partial<V2> = {}): V2 => ({
    ...record(), v: 2, authority: 'operator', denyCurrent: false, family: 'none', ...over,
  });
  const sv2 = (r: Record<string, unknown>, key: KeyObject = ours.priv) => signed(r as unknown as ApprovalRulingRecord, key);

  it('case 1: v1 rows are unchanged (ordinary allow prints, escalate allow prints nothing, deny prints)', () => {
    expect(verdictFor(signed(record()), expected, ours.pub)).toBe('allow a cleanup inside your worktree');
    expect(verdictFor(signed(record({ class: 'escalate' })), expected, ours.pub)).toBeNull();
    expect(verdictFor(signed(record({ verdict: 'deny', reason: 'no' })), expected, ours.pub)).toBe('deny no');
  });
  it.each(['allow', 'deny'] as const)('case 2: a v2 coordinator %s prints nothing', (verdict) => {
    expect(verdictFor(sv2(v2({ authority: 'coordinator', verdict })), expected, ours.pub)).toBeNull();
  });
  it('case 3: a v2 operator allow of escalate, denyCurrent false, prints allow:operator', () => {
    expect(verdictFor(sv2(v2({ class: 'escalate', denyCurrent: false, reason: 'go ahead' })), expected, ours.pub))
      .toBe('allow:operator go ahead');
  });
  it('case 4: a v2 operator allow of ordinary prints allow:operator', () => {
    expect(verdictFor(sv2(v2({ denyCurrent: true })), expected, ours.pub)).toBe('allow:operator a cleanup inside your worktree');
  });
  it('case 5: a v2 operator allow of forbidden prints nothing', () => {
    expect(verdictFor(sv2(v2({ class: 'forbidden' })), expected, ours.pub)).toBeNull();
  });
  it('case 6: a v2 operator deny prints deny:operator, on one line', () => {
    expect(verdictFor(sv2(v2({ verdict: 'deny', class: 'forbidden', reason: 'not\nthis' })), expected, ours.pub))
      .toBe('deny:operator not this');
  });
  it.each(['allow', 'deny'] as const)('case 7: a v2 overlord %s prints nothing', (verdict) => {
    expect(verdictFor(sv2(v2({ authority: 'overlord', verdict })), expected, ours.pub)).toBeNull();
  });
  it.each<[string, Partial<V2>]>([
    ['family read-only', { family: 'read-only' }],
    ['an unknown family', { family: 'all' }],
    ['an unknown authority', { authority: 'someone' }],
    ['denyCurrent not a boolean', { denyCurrent: 'yes' }],
  ])('case 8: %s prints nothing', (_name, over) => {
    expect(verdictFor(sv2(v2(over)), expected, ours.pub)).toBeNull();
  });
  it('case 9: a fourteenth field, or a missing one of the thirteen, prints nothing', () => {
    const extra = { ...v2(), extra: 1 };
    expect(recordBytes(extra)).toBeNull();
    expect(verdictFor({ record: extra, sig: sign(null, Buffer.from(canonical(extra) as string, 'utf8'), ours.priv).toString('base64') },
      expected, ours.pub)).toBeNull();
    const { family: _f, ...twelve } = v2();
    expect(recordBytes(twelve)).toBeNull();
    expect(verdictFor({ record: twelve, sig: sign(null, Buffer.from(canonical(twelve) as string, 'utf8'), ours.priv).toString('base64') },
      expected, ours.pub)).toBeNull();
  });
  it('case 10: a v2 record signed by another key prints nothing', () => {
    expect(verdictFor(sv2(v2(), theirs.priv), expected, ours.pub)).toBeNull();
  });
  it('case 11: the second copies equal the shared lists, and v2 bytes equal approvalRulingBytes', () => {
    expect([...AUTHORITIES]).toEqual([...APPROVAL_RULING_AUTHORITIES]);
    expect([...FAMILIES]).toEqual([...APPROVAL_RULING_FAMILIES]);
    expect([...RECORD_KEYS_V2].sort()).toEqual(Object.keys(v2()).sort());
    for (const r of [v2(), v2({ verdict: 'deny', denyCurrent: true, reason: 'é 😀' })]) {
      expect(recordBytes(r)).toBe(approvalRulingBytes(r as unknown as ApprovalRulingRecord));
    }
  });
});

describe('approval-verify: the CLI the hook runs', () => {
  let home: string;
  beforeAll(() => {
    home = mkTmp('ccrc-aprverify-');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'approval-signing.pub'), ours.pub);
  });
  afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });
  const run = (stdin: string, args: string[], h = home) =>
    spawnSync(process.execPath, [VERIFY, ...args], { input: stdin, encoding: 'utf8', env: { ...process.env, HOME: h } });
  const args = ['project-a-quiet-basin', '', DIGEST, NONCE, '7', String(NOW)];
  it('prints the one verdict line for a good ruling, and exits 0', () => {
    const r = run(JSON.stringify(signed(record())), args);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('allow a cleanup inside your worktree\n');
  });
  it('prints nothing for a forged one, or for garbage on stdin, and exits 0', () => {
    for (const input of [JSON.stringify(signed(record(), theirs.priv)), 'not json', '']) {
      const r = run(input, args);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
  });
  it('prints nothing with no pinned key', () => {
    const bare = mkTmp('ccrc-aprverify-nokey-');
    try {
      const r = run(JSON.stringify(signed(record())), args, bare);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    } finally { fs.rmSync(bare, { recursive: true, force: true }); }
  });
  it('a usage error is exit 2 with nothing on stdout', () => {
    const r = run('{}', ['too', 'few']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
});
