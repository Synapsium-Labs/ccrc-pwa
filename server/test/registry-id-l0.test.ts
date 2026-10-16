// Path identity W1a (spec §2.1, §2.3): THE ONE PREDICATE of a registry id.
// - `isRegistryId` accepts a string of at most 255 characters with the session-id shape and no leading `-` or `.`.
// - The leading `-` is the server's whole answer to spec §2.1: ccd's verbs read their decision flags from any position,
//   so an id of `--actor` or `--surface` is read as a flag and another token is bound as the id.
// - The collector's `isTmpRootId` and `TMPROOT_ID_MAX_CHARS` derive from it, so the accepted set is unchanged. The
//   collector's own table (`collect-l0.test.ts`) is copied here row for row and asked of the new predicate.
// The type guard is a compile-time fact, so `typecheck-tests.test.ts` is half of this file. Each gate's
// "refused before any argv" half is pinned where that gate is placed, not here.
import { describe, it, expect } from 'vitest';
import { REGISTRY_ID_MAX_CHARS, TMPROOT_ID_MAX_CHARS, isRegistryId, isTmpRootId } from '../../shared/api.js';
import { EDGE_ACCEPTED_IDS, REDIRECT_IDS, REFUSED_IDS } from './registryIdCases.js';

/** `collect-l0.test.ts`'s 18 rows, copied: what the case is, the value, and the answer. */
const TABLE: readonly (readonly [string, unknown, boolean])[] = [
  ['an ordinary child id', 'demo-quiet-mesa', true],
  ['a nested id with dots', 'demo.quiet.mesa', true],
  ['dashes inside', 'a--actor', true],
  ['a dot, then dashes', 'a.--actor', true],
  ['exactly 255 characters', 'a'.repeat(255), true],
  ['256 characters', 'a'.repeat(256), false],
  ['a flag with its value (the shape refuses =)', '--actor=x', false],
  ['.', '.', false],
  ['..', '..', false],
  ['a dot-leading name', '.hidden', false],
  ['the empty string', '', false],
  ['a space', 'demo gone', false],
  ['a slash', 'x/../y', false],
  ['a trailing newline', 'demo\n', false],
  ['null', null, false],
  ['a number', 3, false],
  ['undefined', undefined, false],
  ['an object', {}, false],
];

describe('isRegistryId — the one predicate of a registry id (spec §2.3)', () => {
  it('its cap is 255 characters, hardcoded', () => {
    expect(REGISTRY_ID_MAX_CHARS).toBe(255);
    expect(TMPROOT_ID_MAX_CHARS).toBe(REGISTRY_ID_MAX_CHARS);
  });

  // ccd's verbs read their decision flags from any position, `--session`'s value included, and every such flag begins
  // `--`. An id that begins `-` could be read as one (spec §2.1).
  it.each(REDIRECT_IDS)('a dash-leading id %j is refused', (id) => {
    expect(isRegistryId(id)).toBe(false);
  });

  it.each(TABLE)('%s -> %s', (_what, id, ok) => {
    expect(isRegistryId(id)).toBe(ok);
  });

  it('narrows an unknown to a string', () => {
    const v: unknown = 'demo-quiet-mesa';
    expect(isRegistryId(v) ? v.length : -1).toBe(15);
  });

  it('isTmpRootId agrees with isRegistryId on every case', () => {
    const cases: unknown[] = [...TABLE.map(([, id]) => id), ...REFUSED_IDS, ...EDGE_ACCEPTED_IDS];
    const answers = new Set<boolean>();
    for (const id of cases) {
      expect(isTmpRootId(id), String(JSON.stringify(id))).toBe(isRegistryId(id));
      answers.add(isRegistryId(id));
    }
    expect([...answers].sort(), 'the union holds both answers, so the agreement is not vacuous').toEqual([false, true]);
  });

  // The later W1a gate tests plant these lists. A list that drifted from its name would make every one of those pins
  // vacuous, so the lists are asked here once.
  it('the shared case lists answer as their names say', () => {
    for (const id of REFUSED_IDS) expect(isRegistryId(id), JSON.stringify(id).slice(0, 40)).toBe(false);
    for (const id of EDGE_ACCEPTED_IDS) expect(isRegistryId(id), JSON.stringify(id).slice(0, 40)).toBe(true);
    expect(REFUSED_IDS.slice(0, REDIRECT_IDS.length)).toEqual(REDIRECT_IDS);
  });
});
