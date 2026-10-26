// W3's approval signing pin (D-TBD-question-census; Task Q3a; plan 2026-10-26-consolidation-w3-questions.md, §What W3
// must not change; spec 2026-10-19 §5.6's W3 gate: "A pin holds `approval-verify.mjs`'s SHA and a signed-ruling
// fixture"). No W3 task edits `ccd/approval-verify.mjs` or `server/src/coord/approvalsign.ts`, and the signed ruling's
// bytes do not change: this file holds both. A later change to the verifier (coordinator-first round 2) updates this pin
// as an intended change, in a commit of its own, never inside a move.
//
// The fixture key is DERIVED in the test from a fixed, public 32-byte seed (Ed25519 signs deterministically), so the
// signature below is a constant. It signs nothing real: no box pins its public half.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, createPrivateKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { APPROVAL_SIGNING_KEY_FILE, approvalRulingBytes, type ApprovalRulingRecord } from '../../shared/api.js';
import { loadOrCreateApprovalSigner } from '../src/coord/approvalsign.js';
import { verdictFor } from '../../ccd/approval-verify.mjs';

const VERIFY = path.resolve(__dirname, '../../ccd/approval-verify.mjs');

/** The verifier's SHA-256 at the base. A one-byte change to it reds this row. */
const VERIFY_SHA256 = '20aa0cff3edb4f0f9acf44a8cc340c688f07dafd9b203f7d35bdb1f68cb8d480';

/** PKCS#8 DER for an Ed25519 private key is this 16-byte prefix and the 32-byte seed. */
const SEED = Buffer.alloc(32, 0x5a);
const FIXTURE_KEY = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]), format: 'der', type: 'pkcs8',
});

const NOW = 1_760_000_000_000;
const RECORD: ApprovalRulingRecord = {
  v: 1, rowId: 7, sessionId: 'project-a-quiet-basin', agentId: '', digest: 'a'.repeat(64),
  nonce: '0123456789abcdef0123456789abcdef', class: 'ordinary', verdict: 'allow',
  reason: 'a cleanup inside your worktree', expiresAt: NOW + 60_000,
};
const EXPECTED = { sessionId: RECORD.sessionId, agentId: '', digest: RECORD.digest, nonce: RECORD.nonce, rowId: 7, now: NOW };

/** The record's canonical bytes, as the server signs them and the verifier re-derives them. */
const RECORD_BYTES = '{"agentId":"","class":"ordinary","digest":"' + 'a'.repeat(64) + '","expiresAt":1760000060000,'
  + '"nonce":"0123456789abcdef0123456789abcdef","reason":"a cleanup inside your worktree","rowId":7,'
  + '"sessionId":"project-a-quiet-basin","v":1,"verdict":"allow"}';

/** The signature the server's signer makes over `RECORD` with the fixture key. */
const RECORD_SIG = 'y4lZkqAPrLeeLVCTbm7P3OTdtcM+hYouUN0KOBFwgPAKZmFEMl+Y04k2ftDZg5ApekYEwcyszcssokJ9LOR+Ag==';

let home = '';
let pub = '';
beforeAll(() => {
  home = mkTmp('approval-signing-pin-');
  const ccrc = path.join(home, '.ccrc');
  mkdirSync(ccrc, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(ccrc, APPROVAL_SIGNING_KEY_FILE), FIXTURE_KEY.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
  pub = loadOrCreateApprovalSigner(ccrc).publicKeyPem();
  writeFileSync(path.join(ccrc, 'approval-signing.pub'), pub);
});
afterAll(() => { if (home) rmSync(home, { recursive: true, force: true }); });

/** The verifier CLI's output for `ruling` under the fixture HOME, as the session hook runs it. */
const cli = (ruling: unknown): string => {
  const r = spawnSync(process.execPath, [VERIFY, EXPECTED.sessionId, EXPECTED.agentId, EXPECTED.digest, EXPECTED.nonce, '7', String(NOW)], {
    input: JSON.stringify(ruling), encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  expect(r.status).toBe(0);
  return r.stdout;
};

describe('approval signing pin (W3 changes no signing byte)', () => {
  it('approval-verify.mjs is byte-identical to the base (its SHA-256)', () => {
    expect(createHash('sha256').update(readFileSync(VERIFY)).digest('hex')).toBe(VERIFY_SHA256);
  });

  it('the record\'s canonical bytes are the fixture\'s', () => {
    expect(approvalRulingBytes(RECORD)).toBe(RECORD_BYTES);
  });

  it('the server\'s signer signs the fixture record to the fixture signature', () => {
    const signer = loadOrCreateApprovalSigner(path.join(home, '.ccrc'));
    expect(signer.signRuling(RECORD)).toBe(RECORD_SIG);
  });

  it('the verifier prints the ruling for the signed fixture, in-process and as the CLI', () => {
    const ruling = { record: RECORD, sig: RECORD_SIG };
    expect(verdictFor(ruling, EXPECTED, pub)).toBe('allow a cleanup inside your worktree');
    expect(cli(ruling)).toBe('allow a cleanup inside your worktree\n');
  });

  it('a one-byte tamper of the record or of the signature prints nothing', () => {
    const tampers: Array<[string, unknown]> = [
      ['reason', { record: { ...RECORD, reason: 'b cleanup inside your worktree' }, sig: RECORD_SIG }],
      ['verdict', { record: { ...RECORD, verdict: 'deny' }, sig: RECORD_SIG }],
      ['rowId', { record: { ...RECORD, rowId: 8 }, sig: RECORD_SIG }],
      ['expiresAt', { record: { ...RECORD, expiresAt: RECORD.expiresAt + 1 }, sig: RECORD_SIG }],
      ['sig', { record: RECORD, sig: (RECORD_SIG[0] === 'A' ? 'B' : 'A') + RECORD_SIG.slice(1) }],
    ];
    for (const [what, ruling] of tampers) {
      expect(verdictFor(ruling, EXPECTED, pub), what).toBeNull();
      expect(cli(ruling), what).toBe('');
    }
  });
});
