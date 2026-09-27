// Routing spec 2026-09-14 §5.3 (slice 4, Task 3) — `parseRouteFields` is
// SHAPE only: known keys, non-empty strings, no control characters, <= 32
// bytes each. VALUES themselves (is `opus` a real class?) are ccd's to
// refuse (`_route_valid` on the box, pinned by `ccd-route-fields.test.ts`) —
// this suite never asserts a value judgement, only the wire shape.
import { describe, it, expect } from 'vitest';
import {
  ROUTE_WRITABLE_FIELDS, parseRouteFields, routeFieldsOrNull, routeParseDetail, type RouteField,
} from '../../shared/api.js';

/**
 * A COMPILE-TIME exhaustiveness check and NOTHING ELSE (fix round 2, finding
 * #4 / controller ruling S4-R6). `Record<RouteField, true>` is not satisfied
 * until every member of the union has a key, so adding a sixth field to
 * `ROUTE_WRITABLE_FIELDS` makes THIS FILE fail to typecheck
 * (`typecheck-tests.test.ts` runs `tsc` over this directory) until someone
 * comes here and decides what the new field's cases are.
 *
 * It is deliberately NOT compared to `Object.keys(ROUTE_WRITABLE_FIELDS)` at
 * runtime any more. That assertion respelled the five names and then checked
 * the respelling against the list it was copied from — a tautology that could
 * only ever red if someone edited one of the two copies and not the other,
 * which is the defect the IMPORT already makes impossible. The runtime claims
 * that matter — the list's length, and that every member of it actually
 * parses — are below, derived from the imported list.
 */
const ALL_FIELDS: Record<RouteField, true> = {
  class: true, effort: true, subagent: true, workflow: true, compact: true,
};
void ALL_FIELDS;   // its whole job is the type error above, not a runtime read

describe('ROUTE_WRITABLE_FIELDS', () => {
  // A LITERAL RATCHET, not a value computed from the thing under test: `5` is
  // typed out here, so a sixth field (or a lost one) reds this line and forces
  // the author past it, rather than the expectation moving with the code.
  it('is exactly five fields', () => {
    expect(ROUTE_WRITABLE_FIELDS).toHaveLength(5);
  });

  it('every field the list names is one parseRouteFields accepts', () => {
    // Iterates the IMPORTED list — a field added to the array but not handled
    // by the parser reds here without anyone respelling a name.
    for (const f of ROUTE_WRITABLE_FIELDS) {
      expect(parseRouteFields({ [f]: 'x' }), f).toEqual({ ok: true, route: { [f]: 'x' } });
    }
  });

  it('does not carry ccd\'s own fields — degraded/inert are never body-settable, and neither is a made-up word', () => {
    expect(ROUTE_WRITABLE_FIELDS).not.toContain('degraded');
    expect(ROUTE_WRITABLE_FIELDS).not.toContain('inert');
    for (const f of ['degraded', 'inert', 'bogus']) {
      expect(parseRouteFields({ [f]: 'x' }), f).toEqual({ ok: false, why: 'unknown-field', field: f });
    }
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

// The two helpers that exist so `server.ts`'s operator doors and
// `dispatch.ts`'s run dispatch cannot drift into two dialects of one refusal
// (fix round 2, finding #2 / controller ruling S4-R6). Both were written out
// verbatim at both call sites before this round.
describe('routeParseDetail — one refusal grammar for both callers', () => {
  it('renders why plus the offending field, and omits the field when there is none', () => {
    expect(routeParseDetail({ ok: false, why: 'unknown-field', field: 'colour' }))
      .toBe('route: unknown-field colour');
    expect(routeParseDetail({ ok: false, why: 'bad-value', field: 'effort' }))
      .toBe('route: bad-value effort');
    // `not-object` names no field — there was no object to have one — and the
    // rendering must not say the word `undefined`.
    expect(routeParseDetail({ ok: false, why: 'not-object' })).toBe('route: not-object');
  });

  it('renders a real parse, end to end, exactly as both callers send it', () => {
    const parsed = parseRouteFields({ class: 'opus', colour: 'blue' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(routeParseDetail(parsed)).toBe('route: unknown-field colour');
  });
});

describe('routeFieldsOrNull — one collapse of "parsed, but named nothing"', () => {
  it('a route naming no field is null; one naming any field is itself, unchanged', () => {
    expect(routeFieldsOrNull({})).toBeNull();
    const one = { class: 'opus' };
    expect(routeFieldsOrNull(one)).toBe(one);
    const all = { class: 'opus', effort: 'high', subagent: 'haiku', workflow: 'on', compact: '40' };
    expect(routeFieldsOrNull(all)).toBe(all);
  });
});
