// Routing spec 2026-09-14 §5.3 (slice 4, Task 3) — `parseRouteFields` is
// SHAPE only: known keys, non-empty strings, no control characters, <= 32
// bytes each. VALUES themselves (is `opus` a real class?) are ccd's to
// refuse (`_route_valid` on the box, pinned by `ccd-route-fields.test.ts`) —
// this suite never asserts a value judgement, only the wire shape.
import { describe, it, expect } from 'vitest';
import { ROUTE_WRITABLE_FIELDS, parseRouteFields, type RouteField } from '../../shared/api.js';

/** Derived from the union, `wave-done-signals.test.ts`'s own idiom: a sixth
 *  field added to the type forces a key here (this directory is typechecked). */
const ALL_FIELDS: Record<RouteField, true> = {
  class: true, effort: true, subagent: true, workflow: true, compact: true,
};

describe('ROUTE_WRITABLE_FIELDS', () => {
  it('is the five body-writable fields, and the array is the type', () => {
    expect([...ROUTE_WRITABLE_FIELDS].sort()).toEqual(Object.keys(ALL_FIELDS).sort());
  });

  it('does not carry ccd\'s own fields — degraded/inert are never body-settable', () => {
    expect(ROUTE_WRITABLE_FIELDS).not.toContain('degraded');
    expect(ROUTE_WRITABLE_FIELDS).not.toContain('inert');
  });
});

describe('parseRouteFields', () => {
  it('a valid five-field object parses ok, verbatim', () => {
    const body = { class: 'opus', effort: 'high', subagent: 'haiku', workflow: 'on', compact: '40' };
    expect(parseRouteFields(body)).toEqual({ ok: true, route: body });
  });

  it('an empty object parses ok with no fields', () => {
    expect(parseRouteFields({})).toEqual({ ok: true, route: {} });
  });

  it('not an object: null, an array, a primitive — all not-object', () => {
    for (const v of [null, [], ['class', 'opus'], 'class=opus', 42, true]) {
      expect(parseRouteFields(v), JSON.stringify(v)).toEqual({ ok: false, why: 'not-object' });
    }
  });

  it('an unknown key is refused, naming the field', () => {
    expect(parseRouteFields({ class: 'opus', colour: 'blue' }))
      .toEqual({ ok: false, why: 'unknown-field', field: 'colour' });
  });

  it('a ccd-only field (degraded/inert) is unknown-field, never accepted', () => {
    expect(parseRouteFields({ degraded: 'opus' })).toEqual({ ok: false, why: 'unknown-field', field: 'degraded' });
    expect(parseRouteFields({ inert: 'effort' })).toEqual({ ok: false, why: 'unknown-field', field: 'inert' });
  });

  it('a non-string value is bad-value', () => {
    expect(parseRouteFields({ class: 42 })).toEqual({ ok: false, why: 'bad-value', field: 'class' });
  });

  it('an empty string is bad-value', () => {
    expect(parseRouteFields({ effort: '' })).toEqual({ ok: false, why: 'bad-value', field: 'effort' });
  });

  it('a control character is bad-value', () => {
    expect(parseRouteFields({ class: 'op\nus' })).toEqual({ ok: false, why: 'bad-value', field: 'class' });
    expect(parseRouteFields({ class: 'op\x00us' })).toEqual({ ok: false, why: 'bad-value', field: 'class' });
  });

  it('32 bytes is the cap, exactly: 32 ok, 33 bad-value', () => {
    expect(parseRouteFields({ effort: 'a'.repeat(32) })).toEqual({ ok: true, route: { effort: 'a'.repeat(32) } });
    expect(parseRouteFields({ effort: 'a'.repeat(33) })).toEqual({ ok: false, why: 'bad-value', field: 'effort' });
  });

  it('measures BYTES, not UTF-16 units: a multi-byte value can exceed the cap under 32 characters', () => {
    // Each 'é' is one UTF-16 unit but two UTF-8 bytes — 20 characters is 40
    // bytes, over the cap, which `.length` alone would miss.
    const value = 'é'.repeat(20);
    expect(value.length).toBe(20);
    expect(parseRouteFields({ class: value })).toEqual({ ok: false, why: 'bad-value', field: 'class' });
  });

  it('the first offending field wins, in the object\'s own key order', () => {
    expect(parseRouteFields({ class: 'opus', colour: 'blue', effort: '' }))
      .toEqual({ ok: false, why: 'unknown-field', field: 'colour' });
  });
});
