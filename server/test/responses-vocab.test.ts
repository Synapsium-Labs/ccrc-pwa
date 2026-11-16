// The response record's vocabulary (Overlord W1, the response record, Task 1: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md).
import { describe, expect, it } from 'vitest';
import { DIGEST_ROW_KINDS } from '../../shared/api.js';
import {
  DIGEST_KEY_ROW_KINDS, RECEIPT_KINDS, RECEIPT_SOURCES, RECEIPT_WORKER_VERSION, RECEIPTS_MAX_PER_BODY, RECEIPTS_PER_PUSH_MAX,
  PUSH_RESPONSE_DELIVERY, RECEIPT_DROPS, RESPONSE_DELIVERIES, RESPONSE_KINDS, RESPONSE_ROW_STATES, digestLineKey, isDigestLineKey, isReceiptDrop,
  parseDigestLineKey,
} from '../../shared/responses.js';

describe('the response record vocabulary', () => {
  it('each derived list names exactly the members of its union, in order', () => {
    expect(RESPONSE_KINDS).toEqual(['push', 'waiting', 'digest', 'reply']);
    expect(RECEIPT_KINDS).toEqual(['shown', 'opened']);
    expect(RECEIPT_SOURCES).toEqual(['worker', 'console']);
    expect(RESPONSE_DELIVERIES).toEqual(['at-once', 'in-batch']);
    expect(RESPONSE_ROW_STATES).toEqual(['pending', 'delivered', 'sealed']);
    expect(RECEIPT_DROPS).toEqual(['no-row', 'sealed', 'wrong-source', 'not-accepted', 'full', 'repeat']);
  });
  it('a W1 push row is written at-once, and the drop guard admits a drop word and nothing else', () => {
    expect(PUSH_RESPONSE_DELIVERY).toBe('at-once');
    expect(RECEIPT_DROPS.every(isReceiptDrop)).toBe(true);
    expect(['at-once', 'kept', 'no-rows', ''].some(isReceiptDrop)).toBe(false);
  });
  it('the digest key row kinds are the digest correction door\'s, exactly', () => {
    expect([...DIGEST_KEY_ROW_KINDS].sort()).toEqual([...DIGEST_ROW_KINDS].sort());
  });
  it('a digest line key parses back to its parts, and nothing digestLineKey could not have made parses (review 2260 F6)', () => {
    expect(parseDigestLineKey(digestLineKey('2026-11-16', 'call', 7))).toEqual({ day: '2026-11-16', rowKind: 'call', id: 7 });
    for (const bad of ['', '2026-11-16:call', '2026-11-16:nope:7', '2026-11-16:ask:07', '2026-11-16:ask:0', '16-11-2026:ask:7',
      '2026-11-16:ask:7:1', '2026-11-16:ask:99999999999999999']) {
      expect(parseDigestLineKey(bad), bad).toBeNull();
      expect(isDigestLineKey(bad), bad).toBe(false);
    }
  });
  it('the bounds are the plan\'s', () => {
    expect([RECEIPTS_MAX_PER_BODY, RECEIPT_WORKER_VERSION, RECEIPTS_PER_PUSH_MAX]).toEqual([50, 1, 8]);
  });
});
