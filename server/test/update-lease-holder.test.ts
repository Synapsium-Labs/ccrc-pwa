// Design 2026-09-20 §10 — `leaseHolder` (server/src/update/dispatch.ts, L1): the LIVE row that holds the lease a
// dispatch run acquired, found by identity (label + updateStartedAt), never by the node id acquired — a revive
// mid-op hands the lease to the heir. Pure: plain `Pick` rows in, an id or `null` out.
// `update-converge.test.ts` pins this end to end, over a real CoordStore and the reviewer's revive interleaving
// (residue R5, review 176 F1).
import { describe, expect, it } from 'vitest';
import { leaseHolder, type DispatchRow } from '../src/update/dispatch.js';

type Row = Pick<DispatchRow, 'nodeId' | 'label' | 'updateState' | 'updateStartedAt'>;

const row = (over: Partial<Row> & { nodeId: string }): Row => ({
  label: 'fleet', updateState: 'pending', updateStartedAt: 1000, ...over,
});

describe('leaseHolder — the live busy row with this label and this lease\'s time (residue R5, review 176 F1)', () => {
  it('(a) one live busy row with the label and the time: its id', () => {
    const rows: Row[] = [row({ nodeId: 'U1' })];
    expect(leaseHolder(rows, 'fleet', 1000)).toBe('U1');
  });

  it('(b) a row with another label and the same time, busy, beside a matching row: the matching one', () => {
    const rows: Row[] = [
      row({ nodeId: 'OTHER', label: 'server' }),
      row({ nodeId: 'U1', label: 'fleet' }),
    ];
    expect(leaseHolder(rows, 'fleet', 1000)).toBe('U1');
  });

  it('(c) the same label with another time, busy: null', () => {
    const rows: Row[] = [row({ nodeId: 'U1', updateStartedAt: 2000 })];
    expect(leaseHolder(rows, 'fleet', 1000)).toBeNull();
  });

  it('(d) the same label and time but idle, and separately failed: null', () => {
    expect(leaseHolder([row({ nodeId: 'U1', updateState: 'idle' })], 'fleet', 1000)).toBeNull();
    expect(leaseHolder([row({ nodeId: 'U1', updateState: 'failed' })], 'fleet', 1000)).toBeNull();
  });

  it('(e) unknown (busy, out of vocabulary): its id', () => {
    const rows: Row[] = [row({ nodeId: 'U1', updateState: 'unknown' })];
    expect(leaseHolder(rows, 'fleet', 1000)).toBe('U1');
  });

  it('(f) two matching busy rows: null', () => {
    const rows: Row[] = [row({ nodeId: 'U1' }), row({ nodeId: 'U2' })];
    expect(leaseHolder(rows, 'fleet', 1000)).toBeNull();
  });

  it('(g) no rows: null', () => {
    expect(leaseHolder([], 'fleet', 1000)).toBeNull();
  });
});
