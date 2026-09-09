// D-2016 — the wedge's other half. `turnStall` is a pure predicate over the
// two fields already on the wire (`status`, `statusUpdatedAt`); no FleetSession
// literal needed, just the `TurnStallInput` shape it actually reads.
import { describe, it, expect } from 'vitest';
import { turnStall, TURN_STALL_MS, type TurnStallInput } from '../../shared/api';

const NOW = 1_800_000_000_000;

const s = (over: Partial<TurnStallInput>): TurnStallInput =>
  ({ status: 'busy', statusUpdatedAt: NOW, ...over });

describe('turnStall (D-2016)', () => {
  it('trips for a long busy turn — well past the measured 90-minute threshold', () => {
    // 95 minutes since the last busy<->idle transition, still busy: this is
    // the wedge's own shape (a turn that climbed to 91.5% context and never
    // crossed an idle boundary for 80.7 minutes).
    const row = s({ status: 'busy', statusUpdatedAt: NOW - 95 * 60_000 });
    expect(turnStall(row, NOW)).toBe(true);
  });

  it('does NOT trip for a normal long subagent fan-out — long turns are ordinary on this fleet', () => {
    // 35 minutes is comfortably inside the measured distribution's ordinary
    // range (p93 ~35m) — a real Workflow fan-out, not a wedge.
    const row = s({ status: 'busy', statusUpdatedAt: NOW - 35 * 60_000 });
    expect(turnStall(row, NOW)).toBe(false);
  });

  it('never trips an idle row, no matter how long it has sat there', () => {
    const row = s({ status: 'idle', statusUpdatedAt: NOW - 200 * 60_000 });
    expect(turnStall(row, NOW)).toBe(false);
  });

  it('never trips a dead row', () => {
    const row = s({ status: 'dead', statusUpdatedAt: NOW - 200 * 60_000 });
    expect(turnStall(row, NOW)).toBe(false);
  });

  it('never trips when statusUpdatedAt is null — no evidence a turn even started', () => {
    const row = s({ status: 'busy', statusUpdatedAt: null });
    expect(turnStall(row, NOW)).toBe(false);
  });

  it('sits exactly at the measured threshold — >= trips, one ms under does not', () => {
    expect(turnStall(s({ statusUpdatedAt: NOW - TURN_STALL_MS }), NOW)).toBe(true);
    expect(turnStall(s({ statusUpdatedAt: NOW - (TURN_STALL_MS - 1) }), NOW)).toBe(false);
  });
});
