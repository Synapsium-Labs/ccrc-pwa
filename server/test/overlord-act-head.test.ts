// Overlord W2, act journal plan Task A3, the pure parts: the head's domain-separated preimage and its signature, the sign verdict,
// and the console's head check. The mutant sets run the same case tables (`sim/actHeadSets.ts`).
import { describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { approvalRulingBytes, type ApprovalRulingRecord } from '../../shared/api.js';
import * as head from '../../shared/actJournalHead.js';
import { ACT_HEAD_DOMAIN, actHeadPreimage, isActHead, type ActHead } from '../../shared/actJournalHead.js';
import { rfc8785Json } from '../src/canonical.js';
import { loadOrCreateApprovalSigner } from '../src/coord/approvalsign.js';
import * as verdict from '../src/coord/overlordActHead.js';
import { actHeadSignVerdictCases, headExtendsCases } from './sim/actHeadSets.js';
import { mkTmp } from './tmpHelpers.js';

const HEAD: ActHead = { day: '2026-11-28', sequence: 1234, journalId: 'a'.repeat(64), digest: 'b'.repeat(64) };

describe('the preimage (question 7)', () => {
  it('is the domain tag, one LF, then the RFC 8785 JSON of the four fields', () => {
    const fail = (d: string): Error => new Error(d);
    expect(actHeadPreimage(HEAD)).toBe(`${ACT_HEAD_DOMAIN}\n${rfc8785Json({ day: HEAD.day, sequence: HEAD.sequence, journalId: HEAD.journalId, digest: HEAD.digest }, fail)}`);
    expect(actHeadPreimage({ digest: HEAD.digest, sequence: HEAD.sequence, journalId: HEAD.journalId, day: HEAD.day })).toBe(actHeadPreimage(HEAD));
    expect(ACT_HEAD_DOMAIN).toBe('ccrc/overlord-act-journal-head/v1');
  });

  it('refuses a head out of shape: a bad day, a sequence of 0 or a float, digests that are not lowercase hex', () => {
    for (const bad of [{ ...HEAD, day: '2026-13-01' }, { ...HEAD, day: '28/11/2026' }, { ...HEAD, sequence: 0 }, { ...HEAD, sequence: 1.5 },
      { ...HEAD, digest: 'B'.repeat(64) }, { ...HEAD, journalId: 'a'.repeat(63) }, { ...HEAD, digest: '"'.repeat(64) }]) {
      expect(isActHead(bad), JSON.stringify(bad)).toBe(false);
      expect(actHeadPreimage(bad)).toBeNull();
    }
  });

  it('is never an approval ruling\'s signed bytes: those are a JSON object, and this starts with the tag and is no JSON', () => {
    const ruling: ApprovalRulingRecord = {
      v: 1, rowId: 7, sessionId: 'lane-a-project-a', agentId: 'agent-1', digest: 'c'.repeat(64), nonce: 'n-1', class: 'write',
      verdict: 'allow', reason: 'ok', expiresAt: 1_800_000_000_000,
    };
    const bytes = approvalRulingBytes(ruling);
    expect(bytes).not.toBeNull();
    expect(bytes!.startsWith('{')).toBe(true);
    expect(bytes).not.toBe(actHeadPreimage(HEAD));
    expect(actHeadPreimage(HEAD)!.startsWith(`${ACT_HEAD_DOMAIN}\n`)).toBe(true);
    expect(() => JSON.parse(actHeadPreimage(HEAD)!)).toThrow();
  });
});

describe('the signer\'s typed method', () => {
  it('signs the preimage with the server\'s one key: the signature verifies with the public key, and fails for another head', () => {
    const signer = loadOrCreateApprovalSigner(mkTmp('ccrc-acthead-'));
    const sig = signer.signActHead(HEAD);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const pub = createPublicKey(signer.publicKeyPem());
    expect(verify(null, Buffer.from(actHeadPreimage(HEAD)!, 'utf8'), pub, Buffer.from(sig!, 'base64'))).toBe(true);
    const other = actHeadPreimage({ ...HEAD, sequence: HEAD.sequence + 1 })!;
    expect(verify(null, Buffer.from(other, 'utf8'), pub, Buffer.from(sig!, 'base64'))).toBe(false);
    // the bare JSON without the tag does not verify either: the tag is in the signed bytes
    const bare = actHeadPreimage(HEAD)!.slice(ACT_HEAD_DOMAIN.length + 1);
    expect(verify(null, Buffer.from(bare, 'utf8'), pub, Buffer.from(sig!, 'base64'))).toBe(false);
  });

  it('signs nothing for a head out of shape', () => {
    expect(loadOrCreateApprovalSigner(mkTmp('ccrc-acthead-')).signActHead({ ...HEAD, digest: 'nope' })).toBeNull();
  });
});

describe('whether the head is signed (question 8)', () => {
  for (const [name, run] of Object.entries(actHeadSignVerdictCases(verdict))) it(name, run);
  it('names each unsigned word with its reason, and nothing else', () => {
    expect(verdict.ACT_HEAD_UNSIGNED_WORDS).toEqual(['approvals-disabled', 'shared-user', 'isolation-unmeasured']);
    expect(verdict.ACT_HEAD_UNSIGNED_WORDS.every(verdict.isActHeadKebab)).toBe(true);
    expect(verdict.isActHeadKebab('separate-user')).toBe(false);
  });
});

describe('the console\'s check, headExtends (question 11)', () => {
  for (const [name, run] of Object.entries(headExtendsCases(head))) it(name, run);
  it('answers one of its four words', () => {
    expect(head.HEAD_EXTENDS_ANSWERS).toEqual(['extends', 'does-not-extend', 'first', 'unmeasured']);
  });
});
