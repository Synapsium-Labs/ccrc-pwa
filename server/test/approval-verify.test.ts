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
import { approvalRulingBytes, canonicalJson, type ApprovalRulingRecord } from '../../shared/api.js';
import { canonical, recordBytes, verdictFor, RECORD_KEYS } from '../../ccd/approval-verify.mjs';

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

const record = (over: Partial<ApprovalRulingRecord> = {}): ApprovalRulingRecord => ({
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
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    expect(verdictFor(signed(record()), expected, publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBeNull();
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
