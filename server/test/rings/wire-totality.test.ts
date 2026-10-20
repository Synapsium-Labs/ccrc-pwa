// D-6048 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-12 (#552)). Wire
// totality: every exported literal union in `shared/*.ts` has a runtime list that fails to compile when the union
// gains a member — a sibling `Record<X, true>` map (the `SESSION_ROLE_MAP` idiom: a missing key is TS2741, a stray one
// TS2353) — or an `is X` guard beside it. Without one, a new member is a silent wire change: a reader that spells the
// members by hand drops the new one's frames with nothing red.
//
// The scan is syntax only, through `../scan/parse.js` (ARCH-00's one parser wrapper; never a parser imported here).
// A union counts when it is a top-level `export type X = 'a' | 'b' | …` of two or more literals. The map or guard
// must be in the SAME file (that is what "sibling" means), and the map must type a variable or a `satisfies`.
// Stated limits: the map alone satisfies the rule (a list derived from it is the convention, not checked); a union
// with a `null` member is not scanned; a type-only guard signature, an `asserts v is X` predicate or a `declare const`
// map would count although none gives a runtime list.
//
// EXEMPT is the merge-day debt. It started at the merge-day count (31) minus this PR's three lists, it may only
// shrink, and every entry carries its reason. Adding a list to an exempt union makes the stale-entry row red until its
// entry goes and `EXEMPT_PINNED` drops with it; adding a new listless union is red until it gets a list.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import {
  POOLS_ENFORCEMENTS, SESSION_BUCKETS, SESSION_STATUSES, isPoolsEnforcement,
} from '../../../shared/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHARED = path.join(ROOT, 'shared');

/** The merge-day count of listless exported literal unions in `shared/*.ts` was 31; this PR lists three. LOWER IT,
 *  NEVER RAISE IT: a new listless union gets a list, not an entry. */
const EXEMPT_PINNED = 28;

/** `file:Name` → why the union has no list yet. One reason per entry. */
const EXEMPT: Record<string, string> = {
  'agent-protocol.ts:ReadFailure': 'merge-day debt: the agent read verbs\' failure word, built by the agent and read by the server; no list yet',
  'api.ts:IdentityField': 'merge-day debt: the registry identity triple, carried as `unmeasured`; read back only through `unmeasuredFields`; no list yet',
  'api.ts:TaskStatus': 'merge-day debt: Claude Code\'s own task-list status word, relayed as it reads; no list yet',
  'api.ts:PreconditionCell': 'merge-day debt: one precondition\'s cell in a server-built aggregate; no list yet',
  'api.ts:UnnamedSpawnWord': 'merge-day debt: the snapshot reviver\'s fold word for an unnamed spawn; no list yet',
  'api.ts:BuildAgreement': 'merge-day debt: the build-skew word of the divergence census; no list yet',
  'api.ts:SystemOrigin': 'merge-day debt: which system prompt started a turn, shown as a pill; no list yet',
  'api.ts:ProgramKickoffField': 'merge-day debt: the field a programme kickoff refusal names; no list yet',
  'api.ts:CollectArmedBy': 'merge-day debt: what armed the temp-root collector lane, as the resolver measured it; no list yet',
  'api.ts:DigestRowKind': 'merge-day debt: which table a digest line came from (its sibling `DigestLineKind` is derived from a tuple); no list yet',
  'api.ts:AccountOriginClass': 'merge-day debt: the origin class the accounts gate decides on; no list yet',
  'base-url.ts:BaseUrlRefusal': 'merge-day debt: why an endpoint was refused, one sentence each on the add sheet; no list yet',
  'docs.ts:DocsRetryClass': 'merge-day debt: the docs reader\'s retry class per failure; no list yet',
  'docs.ts:DocsFetchFailure': 'merge-day debt: the docs fetch failure words from ccd; no list yet',
  'docs.ts:DocsNotAFileKind': 'merge-day debt: why a docs path is not a regular file; no list yet',
  'docs.ts:DocsVerb': 'merge-day debt: the four docs verbs\' names on a ccd answer; no list yet',
  'docs.ts:DocContentClass': 'merge-day debt: how a docs leaf renders; no list yet',
  'docs.ts:EntryMode': 'merge-day debt: whether a docs page carries a ref; no list yet',
  'docs.ts:EntryBadge': 'merge-day debt: a docs tree row\'s draft badge; no list yet',
  'docs.ts:WithheldReason': 'merge-day debt: why a docs leaf body is withheld; no list yet',
  'docs.ts:DocsPageParseFailure': 'merge-day debt: why a docs page URL did not parse; no list yet',
  'poolrule.ts:PoolOrigin': 'merge-day debt: which source a pool answer measured; no list yet',
  'providers.ts:ConnectMethod': 'merge-day debt: a provider\'s connect methods, branched on only by the auth helper; no list yet',
  'providers.ts:ProbeKind': 'merge-day debt: what an account check asks of a lane; a hand array (`PROBE_KINDS`) lives in models.mjs, not a derived map',
  'roster.ts:RosterKind': 'merge-day debt: the roster lane kind; no list yet',
  'workflows.ts:WorkflowState': 'merge-day debt: where a workflow row stands; no list yet',
  'workflows.ts:WorkflowAgentState': 'merge-day debt: where a workflow agent stands; no list yet',
  'workflows.ts:WorkflowControlAct': 'merge-day debt: the workflow control acts; the server holds the measured table; no list yet',
};

interface Union { key: string; name: string; literals: string[]; line: number }

/** Every exported literal union of two or more members in one parsed file. */
function literalUnions(file: string, p: ParsedFile): Union[] {
  return p.exportedTypeAliases
    .filter((a): a is typeof a & { literals: string[] } => a.literals !== null && a.literals.length >= 2)
    .map((a) => ({ key: `${file}:${a.name}`, name: a.name, literals: a.literals, line: a.line }));
}

/** The unions in one parsed file with neither a sibling `Record<X, true>` map nor an `is X` guard. */
function listless(file: string, p: ParsedFile): Union[] {
  return literalUnions(file, p).filter((u) => !p.recordTrueKeys.includes(u.name) && !p.guardedTypes.includes(u.name));
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

  it('every exemption carries its own reason', () => {
    for (const [k, why] of Object.entries(EXEMPT)) expect(why.trim().length, k).toBeGreaterThan(20);
    expect(new Set(Object.values(EXEMPT)).size).toBe(EXEMPT_PINNED);
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

  it('pwa/src/stores/fleet.ts no longer spells the PoolsEnforcement members: it reads the shared guard', () => {
    const fleet = parseFile(path.join(ROOT, 'pwa', 'src', 'stores', 'fleet.ts'));
    const members = PARSED.get('api.ts')!.exportedTypeAliases.find((a) => a.name === 'PoolsEnforcement')!.literals!;
    expect(fleet.comparedLiterals.filter((l) => members.includes(l))).toEqual([]);
    const shared = fleet.imports.filter((i) => /shared\/api$/.test(i.specifier)).flatMap((i) => i.names);
    expect(shared).toContain('isPoolsEnforcement');
  });
});
