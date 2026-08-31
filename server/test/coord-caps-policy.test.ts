// The caps decision's pure half. `CoordStore.setCaps` binds both fields straight
// into an UPDATE with no integer check, no bounds and no NaN guard (D-1164) —
// 0, -5, 1.5 and 1e9 all persist today — and nothing in server/src had ever
// called it, so the absence never showed. This is the check that has to exist
// before a route does, and it REFUSES rather than clamps: a clamp would store a
// number the operator did not ask for and answer 200.
import { describe, it, expect } from 'vitest';
import { CAP_MAX, CAP_MIN, decideCaps } from '../src/coord/caps.js';
import type { CoordCaps } from '../../shared/api.js';

const CURRENT: CoordCaps = { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 };

describe('decideCaps', () => {
  it('takes a partial: an omitted field keeps its current value', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 5 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 } });
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 20 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 3, maxSessionsPerDay: 20 } });
  });

  it('takes both at once', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 } });
  });

  it('refuses a body that asks for nothing — a no-op write is a caller bug, not a write', () => {
    // Not an overloaded success: answering ok to a request that changes nothing
    // makes "the caps are now what you sent" and "you sent nothing" the same 200.
    const r = decideCaps(CURRENT, {});
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ detail: expect.stringContaining('at least one of') });
  });

  it.each([
    ['zero workers — the wedge no door can undo', { maxConcurrentWorkers: 0 }],
    ['negative', { maxConcurrentWorkers: -1 }],
    ['fractional', { maxConcurrentWorkers: 1.5 }],
    ['above the ceiling', { maxConcurrentWorkers: CAP_MAX + 1 }],
    ['a numeric string', { maxConcurrentWorkers: '4' }],
    ['null', { maxConcurrentWorkers: null }],
    ['NaN', { maxConcurrentWorkers: Number.NaN }],
    ['Infinity', { maxConcurrentWorkers: Number.POSITIVE_INFINITY }],
    ['zero per day', { maxSessionsPerDay: 0 }],
    ['per day above the ceiling', { maxSessionsPerDay: CAP_MAX + 1 }],
    ['per day fractional', { maxSessionsPerDay: 2.5 }],
  ])('refuses %s', (_label, body) => {
    expect(decideCaps(CURRENT, body).ok).toBe(false);
  });

  it('accepts exactly the boundary values', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MIN, maxSessionsPerDay: CAP_MAX }).ok).toBe(true);
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MAX, maxSessionsPerDay: CAP_MIN }).ok).toBe(true);
  });

  it('refuses a non-object body without throwing, and SAYS it was not an object', () => {
    // The detail is the assertion, not just `ok:false`. Every one of these
    // bodies also has no settable field, so they all reach the asks-for-nothing
    // refusal too — measured: asserting `ok === false` alone leaves the
    // shape guard unwitnessed, and an unwitnessed guard is the absence-assertion
    // -whose-fixture-cannot-produce-the-presence defect this program keeps
    // finding. Telling a caller who posted `4` that it is missing a field would
    // be true and useless.
    for (const body of [null, undefined, 4, 'caps', [], true]) {
      expect(decideCaps(CURRENT, body), `body ${JSON.stringify(body) ?? 'undefined'}`)
        .toEqual({ ok: false, detail: 'body must be an object' });
    }
  });

  it('an ARRAY is refused as a non-object, not as a body missing its fields', () => {
    // `typeof [] === 'object'` and an array is not null, so without the
    // `Array.isArray` arm this lands on the asks-for-nothing refusal and reads
    // as a caller who forgot a field rather than one who sent the wrong shape.
    expect(decideCaps(CURRENT, [])).toEqual({ ok: false, detail: 'body must be an object' });
    expect(decideCaps(CURRENT, [{ maxConcurrentWorkers: 4 }]))
      .toEqual({ ok: false, detail: 'body must be an object' });
  });

  it('ignores an unknown extra key rather than refusing over it', () => {
    // Additive tolerance, per the wire rule: a newer client's third field must
    // not be a 400 from an older server.
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSomethingElse: 9 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4, maxSessionsPerDay: 12 } });
  });

  it('names the offending field in the detail', () => {
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 0 }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('maxSessionsPerDay') });
  });

  it('CAP_MIN is one, because zero workers is a wedge with no release valve', () => {
    // The number itself is the guard: dispatch refuses on `running >= cap`, so a
    // stored 0 refuses every dispatch for ever, and unlike the pause marker there
    // is no ungated door to lower it again.
    expect(CAP_MIN).toBe(1);
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MIN - 1 }).ok).toBe(false);
  });
});
