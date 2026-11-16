// The response record's vocabulary (Overlord W1, the response record, Task 1: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md).
import { describe, expect, it } from 'vitest';
import { DIGEST_ROW_KINDS } from '../../shared/api.js';
import {
  DIGEST_KEY_ROW_KINDS, RECEIPT_KINDS, RECEIPT_SOURCES, RECEIPT_WORKER_VERSION, RECEIPTS_MAX_PER_BODY, RECEIPTS_PER_PUSH_MAX,
  RESPONSE_DELIVERIES, RESPONSE_KINDS, RESPONSE_ROW_STATES,
} from '../../shared/responses.js';

describe('the response record vocabulary', () => {
  it('each derived list names exactly the members of its union, in order', () => {
    expect(RESPONSE_KINDS).toEqual(['push', 'waiting', 'digest', 'reply']);
    expect(RECEIPT_KINDS).toEqual(['shown', 'opened']);
    expect(RECEIPT_SOURCES).toEqual(['worker', 'console']);
    expect(RESPONSE_DELIVERIES).toEqual(['at-once', 'in-batch']);
    expect(RESPONSE_ROW_STATES).toEqual(['pending', 'delivered', 'sealed']);
  });
  it('the digest key row kinds are the digest correction door\'s, exactly', () => {
    expect([...DIGEST_KEY_ROW_KINDS].sort()).toEqual([...DIGEST_ROW_KINDS].sort());
  });
  it('the bounds are the plan\'s', () => {
    expect([RECEIPTS_MAX_PER_BODY, RECEIPT_WORKER_VERSION, RECEIPTS_PER_PUSH_MAX]).toEqual([50, 1, 8]);
  });
});
