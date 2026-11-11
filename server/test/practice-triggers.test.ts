// The L0 trigger table (Overlord spec §9.7, W1a): one row per stall arm, one persisted signature form, one reader.
import { describe, it, expect } from 'vitest';
import { STALL_ARMS } from '../../shared/stall-watch.js';
import { TRIGGER_KINDS, TRIGGER_TABLE, parseSignature, signatureText } from '../../shared/practice-triggers.js';

describe('the trigger table (Overlord spec §9.7, W1a)', () => {
  it('is one row per stall arm, in the arms\' order, under one kind', () => {
    expect(TRIGGER_KINDS).toEqual(['stall-arm']);
    expect(TRIGGER_TABLE.map(signatureText)).toEqual(STALL_ARMS.map((a) => `stall-arm:${a}`));
  });
  it('reads back every signature it writes', () => {
    for (const s of TRIGGER_TABLE) expect(parseSignature(signatureText(s))).toEqual(s);
  });
  it('reads anything else as null, a later wave\'s kind included', () => {
    for (const t of ['', 'stall-arm', 'stall-arm:', 'stall-arm:limit-capp', 'stall-arm:quiet:1', 'stall:quiet',
      'refusal:capability-missing', 'constructor', 'stall-arm:constructor', 'stall-arm:toString']) {
      expect(parseSignature(t), t).toBeNull();
    }
  });
});
