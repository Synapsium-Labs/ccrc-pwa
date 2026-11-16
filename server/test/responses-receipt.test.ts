// The response record's receipt rule and body parser (Overlord W1, the response record, Task 1: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md). `receiptVerdict`'s cases live in `sim/responsesSets.ts`,
// so this suite and the mutation floors run the same ones.
import { describe, expect, it } from 'vitest';
import * as responses from '../src/responses.js';
import { receiptVerdictCases } from './sim/responsesSets.js';
import { digestLineKey, parseReceiptBody, RECEIPTS_MAX_PER_BODY } from '../../shared/responses.js';

describe('receiptVerdict', () => {
  for (const [title, run] of Object.entries(receiptVerdictCases(responses))) it(title, run);
});

const PUSH = '0123456789abcdef0123456789abcdef';
const HASH = 'ab'.repeat(32);
const worker = { source: 'worker', version: 1, endpointHash: HASH };
const ok = (ref: unknown, from: unknown = worker, receipt: unknown = 'shown'): unknown => ({ v: 1, receipts: [{ ref, receipt, from }] });

describe('parseReceiptBody: what it takes', () => {
  it('reads a receipt of each ref kind and each source', () => {
    const refs = [
      { kind: 'push', pushId: PUSH }, { kind: 'item', id: 3 }, { kind: 'ask', id: 4 }, { kind: 'reply', id: 5 },
      { kind: 'digest', key: '2026-11-14:approval:12' },
    ];
    for (const ref of refs) for (const from of [worker, { source: 'console' }]) {
      expect(parseReceiptBody(ok(ref, from, 'opened')), JSON.stringify(ref)).toEqual({ ok: true, receipts: [{ ref, receipt: 'opened', from }] });
    }
  });
  it('reads an empty list and exactly the largest body', () => {
    expect(parseReceiptBody({ v: 1, receipts: [] })).toEqual({ ok: true, receipts: [] });
    const r = { ref: { kind: 'item', id: 1 }, receipt: 'opened', from: { source: 'console' } };
    expect(parseReceiptBody({ v: 1, receipts: Array.from({ length: RECEIPTS_MAX_PER_BODY }, () => r) }).ok).toBe(true);
  });
  it('digestLineKey round-trips through the parser, for each row kind', () => {
    for (const kind of ['ask', 'approval', 'call'] as const) {
      const key = digestLineKey('2026-11-14', kind, 9);
      expect(key).toBe(`2026-11-14:${kind}:9`);
      expect(parseReceiptBody(ok({ kind: 'digest', key }, { source: 'console' }, 'opened')).ok).toBe(true);
    }
  });
});

describe('parseReceiptBody: each refusal names its field and never echoes the value', () => {
  const SECRET = 'zzSECRETzz';
  const refused = (body: unknown, field: string): void => {
    const r = parseReceiptBody(body);
    expect(r.ok, JSON.stringify(body)).toBe(false);
    if (r.ok) return;
    expect(r.detail).toContain(field);
    expect(r.detail).not.toContain(SECRET);
    expect(r.detail).not.toContain(HASH);
    expect(r.detail).not.toContain(PUSH);
  };
  it('a body that is not an object', () => { for (const b of [null, 'x', 3, []]) refused(b, 'body'); });
  it('an unknown version', () => { refused({ v: 2, receipts: [] }, 'v'); refused({ receipts: [] }, 'v'); });
  it('receipts that is not a list', () => { refused({ v: 1, receipts: SECRET }, 'receipts'); });
  it('more than the bound', () => {
    const r = { ref: { kind: 'item', id: 1 }, receipt: 'opened', from: { source: 'console' } };
    refused({ v: 1, receipts: Array.from({ length: RECEIPTS_MAX_PER_BODY + 1 }, () => r) }, 'receipts');
  });
  it('a field beyond the body', () => { refused({ v: 1, receipts: [], [SECRET]: 1 }, 'the body holds a field'); });
  it('a receipt that is not an object', () => { refused({ v: 1, receipts: [SECRET] }, 'receipts[0]'); });
  it('a field beyond the receipt', () => {
    refused({ v: 1, receipts: [{ ref: { kind: 'item', id: 1 }, receipt: 'opened', from: { source: 'console' }, [SECRET]: 1 }] }, 'holds a field a receipt has not');
  });
  it('a ref outside the five kinds', () => { refused(ok({ kind: SECRET }), 'ref.kind'); refused(ok(SECRET), 'ref'); });
  it('a push id that is not 32 lowercase hex', () => {
    for (const id of [SECRET, PUSH.toUpperCase(), PUSH.slice(1), PUSH + 'a', 7]) refused(ok({ kind: 'push', pushId: id }), 'pushId');
  });
  it('an id that is not a positive integer', () => {
    for (const kind of ['item', 'ask', 'reply']) for (const id of [0, -1, 1.5, SECRET, null]) refused(ok({ kind, id }), 'ref.id');
  });
  it('a digest key that digestLineKey could not have produced', () => {
    for (const key of [SECRET, '2026-11-14:other:1', '2026-11-14:ask:0', '2026-11-14:ask:01', '2026-1-14:ask:1', '2026-11-14:ask:1:x', 5]) {
      refused(ok({ kind: 'digest', key }), 'ref.key');
    }
  });
  it('a field beyond a ref', () => {
    for (const ref of [{ kind: 'push', pushId: PUSH }, { kind: 'item', id: 1 }, { kind: 'digest', key: '2026-11-14:ask:1' }]) {
      refused(ok({ ...ref, [SECRET]: 1 }), 'holds a field a');
    }
  });
  it('a receipt kind outside shown and opened', () => { refused(ok({ kind: 'item', id: 1 }, worker, SECRET), 'receipt'); });
  it('a source outside worker and console', () => { refused(ok({ kind: 'item', id: 1 }, { source: SECRET }), 'from.source'); });
  it('an endpoint hash that is not 64 lowercase hex', () => {
    for (const h of [SECRET, HASH.toUpperCase(), HASH.slice(1), 9]) refused(ok({ kind: 'item', id: 1 }, { ...worker, endpointHash: h }), 'endpointHash');
  });
  it('a worker version below 1', () => {
    for (const version of [0, -1, 1.5, SECRET]) refused(ok({ kind: 'item', id: 1 }, { ...worker, version }), 'from.version');
  });
  it('a field beyond a source', () => {
    refused(ok({ kind: 'item', id: 1 }, { ...worker, [SECRET]: 1 }), 'holds a field a worker source has not');
    refused(ok({ kind: 'item', id: 1 }, { source: 'console', [SECRET]: 1 }), 'holds a field a console source has not');
  });
  it('the index of the failing receipt is named', () => {
    const good = { ref: { kind: 'item', id: 1 }, receipt: 'opened', from: { source: 'console' } };
    refused({ v: 1, receipts: [good, good, { ...good, receipt: SECRET }] }, 'receipts[2].receipt');
  });
});
