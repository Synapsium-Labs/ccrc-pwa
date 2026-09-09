// The home-project decision, as a pure function, driven over every branch —
// including the one the shipped constant does not currently take. `POST
// /api/runs`'s route test (run-routes.test.ts) proves the LIVE branch; this file
// proves the RULE, and it is the only place the legacy flip can be measured
// before it happens.
import { describe, it, expect } from 'vitest';
import { HOME_PROJECT_LEGACY_ACCEPTED, homeProjectVerdict } from '../src/coord/routes.js';

describe('homeProjectVerdict', () => {
  it('writes the body home on a programme this box has never seen', () => {
    expect(homeProjectVerdict({ body: 'demo', known: false, stored: null, legacyAccepted: true }))
      .toEqual({ kind: 'write' });
  });

  it('backfills a stored NULL home, first writer wins', () => {
    expect(homeProjectVerdict({ body: 'demo', known: true, stored: null, legacyAccepted: true }))
      .toEqual({ kind: 'backfill', home: 'demo' });
  });

  it('says nothing to do when the stored home already agrees', () => {
    expect(homeProjectVerdict({ body: 'demo', known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'agrees' });
  });

  it('refuses a differing home and names the STORED one', () => {
    // `by` is the stored value, not the body's: the caller already knows what it
    // sent, and what it needs told is what this programme has said since wave 1.
    expect(homeProjectVerdict({ body: 'other-project', known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'mismatch', by: 'demo' });
  });

  it('flips on the legacy constant, and BOTH branches are real', () => {
    // THE FLIP, measured before it ships (design §3 F2, §9 wave 3). The route
    // passes `HOME_PROJECT_LEGACY_ACCEPTED` here; wave 3's PR changes that one
    // constant and nothing else, and this case is what says the other branch
    // already works.
    const absent = { body: undefined, known: false, stored: null };
    expect(homeProjectVerdict({ ...absent, legacyAccepted: true })).toEqual({ kind: 'legacy' });
    expect(homeProjectVerdict({ ...absent, legacyAccepted: false })).toEqual({ kind: 'required' });
    // An absent home is decided by the constant ALONE — never by whether the
    // programme is known or what it stores, because the column stays NULL
    // either way and nothing is guessed into it.
    expect(homeProjectVerdict({ body: undefined, known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'legacy' });
  });

  it('is shipped in the legacy generation — and this is the line wave 3 changes', () => {
    expect(HOME_PROJECT_LEGACY_ACCEPTED).toBe(true);
  });
});
