// D-6048 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-12 (#552)). Wire
// totality: every exported literal union in `shared/*.ts` has a runtime list that fails to compile when the union
// gains a member — a sibling `Record<X, true>` map (the `SESSION_ROLE_MAP` idiom: a missing key is TS2741, a stray one
// TS2353) — or an `is X` guard beside it. Without one, a new member is a silent wire change: a reader that spells the
// members by hand drops the new one's frames with nothing red.
//
// The scan is syntax only, through `../scan/parse.js` (ARCH-00's one parser wrapper; never a parser imported here).
// A union counts when it is a top-level `export type X = 'a' | 'b' | …` of two or more literals. The map or guard
// must be in the SAME file (that is what "sibling" means), and the map must type a variable or a `satisfies`.
// Only forms that exist at runtime count: a `declare` map, an `asserts v is X` predicate and a type-only guard
// signature do not. Stated limits: the map alone satisfies the rule (a list derived from it is the convention, not
// checked); a literal union with a `null` member (today `api.ts:PrChecks`) is not scanned; a guard's body is not
// checked, so a hand-written `is X` guard satisfies the rule without being total (prefer the map).
//
// EXEMPT (`wire-totality.data.ts#WIRE_TOTALITY_EXEMPTIONS`, D-6045's entry shape, stamped in
// `exemption-age.data.ts`) is the merge-day debt. It started at the merge-day count (31) minus this PR's three lists, it may only
// shrink, and every entry carries its reason. Adding a list to an exempt union makes the stale-entry row red until its
// entry goes and `EXEMPT_PINNED` drops with it; adding a new listless union is red until it gets a list.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, parseSource, wireFacts, type ParsedFile } from '../scan/parse.js';
import { malformedEntries } from './exemptions.js';
import { WIRE_TOTALITY_EXEMPTIONS as EXEMPT } from './wire-totality.data.js';
import {
  POOLS_ENFORCEMENTS, SESSION_BUCKETS, SESSION_STATUSES, isPoolsEnforcement,
} from '../../../shared/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHARED = path.join(ROOT, 'shared');

/** The merge-day count of listless exported literal unions in `shared/*.ts` was 31; this PR lists three. LOWER IT,
 *  NEVER RAISE IT: a new listless union gets a list, not an entry. */
const EXEMPT_PINNED = 28;


interface Union { key: string; name: string; literals: string[]; line: number }

/** Every exported literal union of two or more members in one parsed file. */
function literalUnions(file: string, p: ParsedFile): Union[] {
  return p.exportedTypeAliases
    .filter((a): a is typeof a & { literals: string[] } => a.literals !== null && a.literals.length >= 2)
    .map((a) => ({ key: `${file}:${a.name}`, name: a.name, literals: a.literals, line: a.line }));
}

/** The unions in one parsed file with neither a sibling `Record<X, true>` map nor an `is X` guard. */
function listless(file: string, p: ParsedFile): Union[] {
  const f = wireFacts(p);
  return literalUnions(file, p).filter((u) => !f.recordTrueKeys.includes(u.name) && !f.guardedTypes.includes(u.name));
}

const SHARED_FILES = readdirSync(SHARED).filter((f) => /\.ts$/.test(f) && !/\.d\.ts$/.test(f)).sort();
const PARSED = new Map(SHARED_FILES.map((f) => [f, parseFile(path.join(SHARED, f))] as const));
const ALL_LISTLESS = [...PARSED].flatMap(([f, p]) => listless(f, p));

describe('wire totality: every exported literal union in shared/*.ts has a derived runtime list (D-6048; ARCH-12)', () => {
  it('CONTROL: the scan sees shared/ and its unions (a scan that reads nothing passes everything)', () => {
    expect(SHARED_FILES).toContain('api.ts');
    const unions = [...PARSED].flatMap(([f, p]) => literalUnions(f, p));
    expect(unions.length).toBeGreaterThan(80);
    expect(unions.map((u) => u.key)).toEqual(expect.arrayContaining(['api.ts:SessionRole', 'api.ts:PoolsEnforcement']));
  });

  it('CONTROL: a new exported literal union with no list is listed; a map, a satisfies or a guard clears it', () => {
    const src = (extra: string): ParsedFile => parseSource(`export type Fresh = 'one' | 'two';\n${extra}\n`);
    expect(listless('fixture.ts', src('')).map((u) => u.key)).toEqual(['fixture.ts:Fresh']);
    expect(listless('fixture.ts', src('const M: Record<Fresh, true> = { one: true, two: true };'))).toEqual([]);
    expect(listless('fixture.ts', src('const M = { one: true, two: true } satisfies Record<Fresh, true>;'))).toEqual([]);
    expect(listless('fixture.ts', src('export const isFresh = (v: unknown): v is Fresh => true;'))).toEqual([]);
    // Not a list: a hand array is not total, a type alias of the map is not a value.
    expect(listless('fixture.ts', src("const L: readonly Fresh[] = ['one', 'two'];"))).toHaveLength(1);
    expect(listless('fixture.ts', src('type M = Record<Fresh, true>;'))).toHaveLength(1);
    // Out of scope: a lone literal, a non-literal type, an unexported union.
    expect(listless('fixture.ts', parseSource("export type One = 'one';\nexport type S = string;\ntype H = 'a' | 'b';"))).toEqual([]);
  });

  it('every exported literal union has a sibling Record<X, true> map or an is-guard, unless exempt', () => {
    const offenders = ALL_LISTLESS.filter((u) => !(u.key in EXEMPT))
      .map((u) => `shared/${u.key.replace(':', ` ≈:${u.line} `)} (${u.literals.join(' | ')})`);
    expect(offenders, 'give each a `Record<X, true>` map and a derived list beside it (SESSION_ROLE_MAP)').toEqual([]);
  });

  it('every exemption still names a listless union (a listed or deleted one leaves the list)', () => {
    const live = new Set(ALL_LISTLESS.map((u) => u.key));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });

  it(`the exemption list is pinned at ${EXEMPT_PINNED}: it only shrinks`, () => {
    expect(Object.keys(EXEMPT)).toHaveLength(EXEMPT_PINNED);
  });

  it('every exemption carries its own one-line reason and a real date (D-6045\'s entry shape)', () => {
    expect(malformedEntries(EXEMPT)).toEqual([]);
    for (const [k, e] of Object.entries(EXEMPT)) expect(e.reason.trim().length, k).toBeGreaterThan(20);
    expect(new Set(Object.values(EXEMPT).map((e) => e.reason)).size).toBe(EXEMPT_PINNED);
  });

  it('the three lists this slice adds carry exactly their unions\' members, in declaration order', () => {
    const members = (name: string): string[] =>
      PARSED.get('api.ts')!.exportedTypeAliases.find((a) => a.name === name)!.literals!;
    expect([...POOLS_ENFORCEMENTS]).toEqual(members('PoolsEnforcement'));
    expect([...SESSION_STATUSES]).toEqual(members('SessionStatus'));
    expect([...SESSION_BUCKETS]).toEqual(members('SessionBucket'));
  });

  it('isPoolsEnforcement accepts exactly the members and nothing else', () => {
    for (const v of POOLS_ENFORCEMENTS) expect(isPoolsEnforcement(v), v).toBe(true);
    for (const v of [undefined, null, '', 'Enforced', 'enforced ', 0, true, {}, ['enforced']]) {
      expect(isPoolsEnforcement(v), String(v)).toBe(false);
    }
  });

  // Any member word quoted in fleet.ts fails this row, in a comparison or not, even an unrelated `=== 'unknown'`: the
  // acceptance is that the store spells none of them, so such a use reads its word from a list too.
  it('pwa/src/stores/fleet.ts no longer spells the PoolsEnforcement members: it reads the shared guard', () => {
    const fleet = parseFile(path.join(ROOT, 'pwa', 'src', 'stores', 'fleet.ts'));
    const members = PARSED.get('api.ts')!.exportedTypeAliases.find((a) => a.name === 'PoolsEnforcement')!.literals!;
    expect(wireFacts(fleet).comparedLiterals.filter((l) => members.includes(l))).toEqual([]);
    // Not only comparisons: no quoted member word anywhere in the file (a hand array passed to `.includes` too).
    expect(members.filter((m) => new RegExp(`(['"\`])${m}\\1`).test(fleet.text))).toEqual([]);
    const shared = fleet.imports.filter((i) => /shared\/api$/.test(i.specifier)).flatMap((i) => i.names);
    expect(shared).toContain('isPoolsEnforcement');
  });
});
