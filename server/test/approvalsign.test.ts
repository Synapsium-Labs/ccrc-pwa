// The server box's approval signing key (coordinator-first routing plan Task 16, spec §6.4, D-5298): created once at
// mode 0600 and reused, served as its public half, and the single-box gate. The key pair is generated in the test's
// own fixture directory, never committed.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { approvalKeyPath, loadOrCreateApprovalSigner, rulingsAllowedHere, APPROVALS_SINGLE_BOX_FILE } from '../src/coord/approvalsign.js';
import { approvalRulingBytes, type ApprovalRulingRecord } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { standardFixture, TOK } from './approvalsHarness.js';

const RECORD: ApprovalRulingRecord = {
  v: 1, rowId: 7, sessionId: 'project-a-quiet-basin', agentId: '', digest: 'd'.repeat(64), nonce: 'e'.repeat(32),
  class: 'ordinary', verdict: 'allow', reason: 'inside the worktree', expiresAt: 1_784_600_060_000,
};

describe('the approval signing key (spec §6.4)', () => {
  it('is created once, mode 0600, and reused across restarts', () => {
    const dir = path.join(mkTmp('ccrc-aprsign-'), '.ccrc');
    const a = loadOrCreateApprovalSigner(dir);
    const file = approvalKeyPath(dir);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const before = readFileSync(file, 'utf8');
    const b = loadOrCreateApprovalSigner(dir);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(b.publicKeyPem()).toBe(a.publicKeyPem());
  });

  it('signs a record\'s canonical bytes, verifiable with the public key it serves', () => {
    const s = loadOrCreateApprovalSigner(path.join(mkTmp('ccrc-aprsign-'), '.ccrc'));
    const sig = s.signRuling(RECORD)!;
    const ok = verify(null, Buffer.from(approvalRulingBytes(RECORD)!, 'utf8'), createPublicKey(s.publicKeyPem()), Buffer.from(sig, 'base64'));
    expect(ok).toBe(true);
  });

  it('a key file that is not an Ed25519 private key is refused, never replaced', () => {
    const dir = path.join(mkTmp('ccrc-aprsign-'), '.ccrc');
    loadOrCreateApprovalSigner(dir);
    writeFileSync(approvalKeyPath(dir), 'not a key\n');
    expect(() => loadOrCreateApprovalSigner(dir)).toThrow();
    expect(readFileSync(approvalKeyPath(dir), 'utf8')).toBe('not a key\n');
  });

  it('rulingsAllowedHere: role server yes; both only with the operator\'s opt-in file', () => {
    const dir = path.join(mkTmp('ccrc-aprsign-'), '.ccrc');
    loadOrCreateApprovalSigner(dir);
    expect(rulingsAllowedHere('server', dir)).toBe(true);
    expect(rulingsAllowedHere('both', dir)).toBe(false);
    writeFileSync(path.join(dir, APPROVALS_SINGLE_BOX_FILE), '');
    expect(rulingsAllowedHere('both', dir)).toBe(true);
    expect(rulingsAllowedHere('server', dir)).toBe(true);
  });

  it('GET /api/approvals/key serves the public half, box-token gated', async () => {
    const f = await standardFixture();
    try {
      const r = await f.app.inject({ method: 'GET', url: '/api/approvals/key', headers: TOK });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { v: number; alg: string; publicKey: string };
      expect({ v: body.v, alg: body.alg }).toEqual({ v: 1, alg: 'ed25519' });
      expect(body.publicKey).toBe(loadOrCreateApprovalSigner(path.join(f.home, '.ccrc')).publicKeyPem());
      expect(body.publicKey).not.toMatch(/PRIVATE/);
      const anon = await f.app.inject({ method: 'GET', url: '/api/approvals/key' });
      expect(anon.statusCode).toBe(401);
    } finally { await f.close(); }
  });
});
