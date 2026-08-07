// The dormant handshake's constants (shared/api.ts) — pinned once, here,
// because nothing else in the tree pins a shared/api.ts export's raw VALUE
// (PRESENCE_REFRESH_MS/PRESENCE_TTL_MS are only ever consumed, never
// asserted-on). MIN <= PROTO is the one invariant the design leans on: it is
// what makes "no hello" and "hello with min <= this build's proto" both mean
// "usable" rather than leaving a gap a future edit could invert by accident.
import { describe, it, expect } from 'vitest';
import { FLEET_PROTO, FLEET_PROTO_MIN } from '../../shared/api.js';

describe('fleet protocol constants (shared/api.ts)', () => {
  it('FLEET_PROTO_MIN never exceeds FLEET_PROTO — a server cannot demand a client newer than itself', () => {
    expect(FLEET_PROTO_MIN).toBeLessThanOrEqual(FLEET_PROTO);
  });

  it('both start at 1 — the handshake is dormant until MIN is deliberately raised', () => {
    expect(FLEET_PROTO).toBe(1);
    expect(FLEET_PROTO_MIN).toBe(1);
  });
});
