// The caps decision's pure half. `CoordStore.setCaps` binds both fields straight
// into an UPDATE with no integer check, no bounds and no NaN guard (D-1164) —
// 0, -5, 1.5 and 1e9 all persist today — and nothing in server/src had ever
// called it, so the absence never showed. This is the check that has to exist
// before a route does, and it REFUSES rather than clamps: a clamp would store a
// number the operator did not ask for and answer 200.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * D-1219 — THE L1 PURITY CLAIM, WITH A MECHANISM UNDER IT.
 *
 * `caps.ts`'s opening docstring said "L1: pure — the DECISION about a caps
 * write, with no clock, no fs and no `reply` (`single-definition.test.ts`'s
 * coord-ring scan)". The parenthesis was a miscitation: that scan asserts three
 * things and none of them is any of these — no `./db.js` import, no
 * `node:sqlite` import, no `coord.db`/`store.db` receiver. Measured by the
 * coordinator's review: adding an `fs` import and a module-scope `Date.now()` to
 * this file left `single-definition` 99/99 green.
 *
 * A citation is load-bearing in a way a bare claim is not — a maintainer reads
 * "checked by X" and stops looking. So either the claim stands down to a stated
 * convention or it gets a check. It gets a check, because D-1169's own next step
 * is to move the moment of the write INTO the decision, and that is exactly the
 * change that would quietly make this file impure.
 *
 * ONE FILE, not a ring-wide sweep: this is the property `caps.ts` asserts about
 * itself. Widening it to every L1 module in `coord/` would be a different
 * change, with a different blast radius, and is not what the miscited sentence
 * promised.
 */
describe('caps.ts is the pure module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'caps.ts'),
    'utf8');

  /** Comments blanked, positions preserved — `dispatch-mutex-gate.test.ts`'s
   *  helper in miniature. Without it this file's own docstring, which NAMES
   *  `fs` and `reply` while promising not to use them, reds every assertion
   *  below. Measured: it did, on the first run. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    // The floor every negative assertion below needs: `''` contains none of them.
    expect(code()).toContain('export function decideCaps');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock', () => {
    // D-1169 wants the write's moment inside the decision. When that lands, the
    // moment arrives as an ARGUMENT — this red is the reminder, not an obstacle.
    expect(code(), 'caps.ts reads the clock — the decision is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
  });

  it('has no fs and no other node builtin', () => {
    expect(code(), 'caps.ts imports a node builtin').not.toMatch(/from\s+'node:/);
    expect(code(), 'caps.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });

  it('has no fastify, no reply, no store', () => {
    expect(code(), 'caps.ts names a reply — an L1 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
    expect(code(), 'caps.ts reaches the store — an L1 decision does not read rows')
      .not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\./);
  });

  it('imports TYPES only, which is what L1 may take from L2', () => {
    // `architecture:78-81` allows L1 to import L2 as types. Every import line in
    // this file must therefore be a type import — a value import from anywhere is
    // the thing this ring rule forbids.
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!);
    expect(imports.length, 'no imports found — the scan is over nothing')
      .toBeGreaterThan(0);
    for (const line of imports) {
      expect(line, `caps.ts takes a VALUE import: ${line.trim()}`).toMatch(/^\s*import\s+type\b/);
    }
  });
});
