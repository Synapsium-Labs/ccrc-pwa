// Approvals PR 3 ships inert (the coordinator's rulings of 2026-11-19: the split into PR 3b, and the verifier's change into
// PR 3v). Two pins hold it:
//  - the park's Shadow lanes row is GATED, so `live` is refused at the card and reads as not live everywhere, and the mint
//    stores `shadow` (`approval-park.test.ts`'s "inert" cases pin the mint and the lapse);
//  - the hook's ruling verifier is unchanged in PR 3, and it prints NOTHING for a v2 record, signed or not, so a v2 operator
//    record could not be printed even if one were signed: the menu paints (Table 3b's older-verifier row). PR 3v changes this
//    case, by design, when it lands (`docs/superpowers/programs/overlord/approvals-pr3-verifier-patch.md`).
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { approvalRulingBytes, type ApprovalRulingRecordV2 } from '../../shared/api.js';
import { APPROVAL_PARK_LANE, LANE_ARM_LANES, laneArmGate, laneArmLive } from '../../shared/lane-arm.js';
import { verdictFor } from '../../ccd/approval-verify.mjs';

describe('the lane is gated in PR 3', () => {
  it('the approval-park row is on the card, and its gate stands', () => {
    expect(LANE_ARM_LANES).toContain(APPROVAL_PARK_LANE);
    expect(laneArmGate(APPROVAL_PARK_LANE)).not.toBeNull();
  });
  it('a row stored live is not live while the gate stands', () => {
    expect(laneArmLive('live', laneArmGate(APPROVAL_PARK_LANE))).toBe(false);
  });
});

describe('an unchanged verifier prints nothing for a v2 record (PR 3v changes this)', () => {
  const kp = generateKeyPairSync('ed25519');
  const pem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const expected = { sessionId: 'project-a-quiet-basin', agentId: '', digest: 'a'.repeat(64), nonce: 'b'.repeat(32), rowId: 7, now: 1_000 };
  const base = { rowId: 7, sessionId: 'project-a-quiet-basin', agentId: '', digest: 'a'.repeat(64), nonce: 'b'.repeat(32), reason: 'ok', expiresAt: 2_000 };
  const signed = (record: Record<string, unknown>): { record: Record<string, unknown>; sig: string } => ({
    record, sig: sign(null, Buffer.from(approvalRulingBytes(record as never) ?? '', 'utf8'), kp.privateKey).toString('base64'),
  });
  it('a signed v1 ordinary allow prints (the control)', () => {
    expect(verdictFor(signed({ v: 1, ...base, class: 'ordinary', verdict: 'allow' }), expected, pem)).toBe('allow ok');
  });
  it.each(['allow', 'deny'] as const)('a signed v2 operator %s prints nothing', (verdict) => {
    const v2: ApprovalRulingRecordV2 = { v: 2, ...base, class: 'escalate', verdict, authority: 'operator', denyCurrent: true, family: 'none' };
    expect(verdictFor(signed(v2 as unknown as Record<string, unknown>), expected, pem)).toBeNull();
  });
});
