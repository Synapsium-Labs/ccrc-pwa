// The temp-root collector's population (child-reclamation spec §5.10, "the population"). The lane lists
// `$REG/tmproots` and `$REG/tmpquarantine`, never `~/.cc-tmp`. These rows pin the PURE half (L1,
// `server/src/collectLane.ts`): which names become ids, which ids this pass may audit, and which are forgotten. The
// two reads are the executor's (`coord/collectTempRoot.ts`'s `readCollectPopulation`); here the listings are
// literals. No ccd runs and no HOME is touched: ccd/ccd is read as TEXT only, for the record grammar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TMPROOT_ID_MAX_CHARS } from '../../shared/api.js';
import {
  COLLECT_POPULATION_MAX, COLLECT_RECORD_NAME_RE, collectForgets, collectPopulation, parseCollectRecordName,
  type CollectListing, type CollectPopulation,
} from '../src/collectLane.js';
import { CCD } from './ccdWsHelpers.js';

const listed = (...names: string[]): CollectListing => ({ kind: 'listed', names });
const ABSENT: CollectListing = { kind: 'absent' };
const unmeasured = (why: string): CollectListing => ({ kind: 'unmeasured', why });
const pop = (tmproots: CollectListing, tmpquarantine: CollectListing = ABSENT, registry: readonly string[] = []):
  CollectPopulation => collectPopulation({ tmproots, tmpquarantine, registryNames: new Set(registry) });
/** `n` distinct ids that each pass the predicate. */
const many = (n: number, prefix = 'id-'): string[] => Array.from({ length: n }, (_, k) => `${prefix}${k}`);

/** The ONE `re='…'` inside ccd's `_ws_collect_rec_id`, as written there. */
const ccdRecordGrammar = (): string => {
  const src = readFileSync(CCD, 'utf8');
  const at = src.indexOf('\n_ws_collect_rec_id() {');
  if (at < 0) throw new Error('_ws_collect_rec_id not found in ccd/ccd');
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error('_ws_collect_rec_id has no closing brace');
  const found = [...src.slice(at, end).matchAll(/ re='([^']+)'/g)];
  if (found.length !== 1) throw new Error(`expected one re='…' in _ws_collect_rec_id, found ${found.length}`);
  return found[0]![1]!;
};

describe('a quarantine record\'s name (parseCollectRecordName)', () => {
  it('is ccd\'s `_ws_collect_rec_id` grammar, verbatim, and carries no flag', () => {
    expect(COLLECT_RECORD_NAME_RE.source).toBe(ccdRecordGrammar());
    expect(COLLECT_RECORD_NAME_RE.flags, 'a g flag makes .exec stateful').toBe('');
  });

  const A255 = 'a'.repeat(TMPROOT_ID_MAX_CHARS);
  it.each<readonly [string, string, string | null]>([
    ['a dotted id keeps its dots', 'a.b.17.42', 'a.b'],
    ['a plain id', 'demo-a.1790000000000000000.4242', 'demo-a'],
    ['greedy: only the two trailing fields go', 'a.1.2.3', 'a.1'],
    ['an all-digit id', '1.2.3', '1'],
    ['one trailing field is no record', 'a-b.17', null],
    ['a field that is not all digits', 'a-b.17.x', null],
    ['nothing after the last digits', 'a.1.2x', null],
    ['a dot-leading id', '.a.1.2', null],
    ['a dash-leading id', '-x.1.2', null],
    ['a redirect flag', '--actor.1.2', null],
    ['a space', 'a b.1.2', null],
    ['a newline', 'a\n.1.2', null],
    ['an id of the cap', `${A255}.1.2`, A255],
    ['an id one over the cap', `${A255}a.1.2`, null],
  ])('%s', (_label, name, id) => {
    expect(parseCollectRecordName(name)).toBe(id);
  });
});

describe('the two listings', () => {
  it('a proven-absent listing is empty and MEASURED', () => {
    expect(pop(ABSENT, ABSENT)).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 0, unmeasured: [], bothMeasured: true,
    });
  });

  it('an unmeasured listing gives no id and names itself; the measured side is still read', () => {
    expect(pop(unmeasured('symlink'), listed('b.1.2'))).toEqual({
      ids: ['b'], candidates: ['b'], recordIds: new Set(['b']), refusedNames: 0,
      unmeasured: [{ listing: 'tmproots', kind: 'unmeasured', why: 'symlink' }], bothMeasured: false,
    });
    expect(pop(listed('a'), unmeasured('read-failed'))).toEqual({
      ids: ['a'], candidates: ['a'], recordIds: new Set(), refusedNames: 0,
      unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: 'read-failed' }], bothMeasured: false,
    });
  });

  it('a dot-leading name (a writer\'s temp file) and a name that is not a string are dropped, uncounted', () => {
    const odd = [42, null, undefined, { name: 'a' }] as unknown as string[];
    expect(pop(listed('.a.123.456.tmp', '.a.drop.9', 'a', ...odd), listed('.b.1.2', '.tmp'))).toMatchObject({
      ids: ['a'], refusedNames: 0, bothMeasured: true,
    });
  });

  it(`a listing of ${COLLECT_POPULATION_MAX} names is read, and one more makes it unmeasured, by its count alone`, () => {
    expect(COLLECT_POPULATION_MAX, 'HARDCODED on purpose: the mutation control for the cap').toBe(1024);
    const full = pop(listed(...many(COLLECT_POPULATION_MAX)));
    expect(full.ids).toHaveLength(COLLECT_POPULATION_MAX);
    expect(full.bothMeasured).toBe(true);
    const over = pop(listed(...many(COLLECT_POPULATION_MAX + 1)), listed(...many(COLLECT_POPULATION_MAX + 1, 'r').map((n) => `${n}.1.2`)));
    expect(over).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 0, bothMeasured: false,
      unmeasured: [
        { listing: 'tmproots', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 },
        { listing: 'tmpquarantine', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 },
      ],
    });
  });

  it("the cap counts the RAW listing: dot-leading names cost the lane's memory as much as any other", () => {
    const names = [...many(COLLECT_POPULATION_MAX).map((n) => `.${n}.tmp`), 'a'];
    expect(pop(listed(...names)).unmeasured).toEqual([{ listing: 'tmproots', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 }]);
  });
});

describe('the id predicate gates the population before any argv', () => {
  const REDIRECTS = ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x'];

  it('a dash-leading name is never an id, as a witness or as a record, and is counted', () => {
    const p = pop(listed(...REDIRECTS), listed(...REDIRECTS.map((r) => `${r}.1.2`)));
    expect(p).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 2 * REDIRECTS.length, unmeasured: [], bothMeasured: true,
    });
  });

  it('a name that only CONTAINS a dash or a dot is audited as itself', () => {
    expect(pop(listed('a--actor', 'a.--actor'), listed('b--actor.1.2')).candidates).toEqual(['a--actor', 'a.--actor', 'b--actor']);
  });

  it(`an id of ${TMPROOT_ID_MAX_CHARS} characters is taken, and one of ${TMPROOT_ID_MAX_CHARS + 1} is refused`, () => {
    expect(TMPROOT_ID_MAX_CHARS, 'HARDCODED on purpose').toBe(255);
    const ok = 'a'.repeat(TMPROOT_ID_MAX_CHARS);
    const long = 'b'.repeat(TMPROOT_ID_MAX_CHARS + 1);
    expect(pop(listed(ok, long))).toMatchObject({ ids: [ok], refusedNames: 1 });
  });

  it('a name outside the session-id shape, or a junk name in the records\' directory, is counted and never an id', () => {
    expect(pop(listed('a b', 'a/b', 'a=b', 'ok'), listed('junk', 'b.1', 'c.1.2'))).toMatchObject({
      ids: ['c', 'ok'], refusedNames: 5,
    });
  });

  it('the population carries the COUNT of refused names, never a name', () => {
    expect(JSON.stringify([...Object.entries(pop(listed('--actor', 'a'), listed('--surface.1.2')))]))
      .not.toMatch(/actor|surface/);
  });
});

describe('the population: the witnessed ids together with the record ids', () => {
  it('is their union, each id once, a record-only id among them', () => {
    expect(pop(listed('a', 'b'), listed('b.1.2', 'b.3.4', 'c.5.6'))).toMatchObject({
      ids: ['a', 'b', 'c'], candidates: ['a', 'b', 'c'], recordIds: new Set(['b', 'c']),
    });
  });

  it('is ordered by id, never by listing order', () => {
    expect(pop(listed('z', 'a', 'm')).candidates).toEqual(['a', 'm', 'z']);
  });
});

describe('the pre-filter: economy, never permission, and never hiding a record', () => {
  it('an id whose EXACT `<id>.child` or `<id>.uuid` is in the registry is not audited, and not forgotten', () => {
    for (const row of ['a.child', 'a.uuid']) {
      const p = pop(listed('a', 'b'), ABSENT, [row]);
      expect(p.candidates, row).toEqual(['b']);
      expect(p.ids, row).toEqual(['a', 'b']);
      expect(collectForgets(p, 'a'), row).toBe(false);
    }
  });

  it('the lookup is exact, never a prefix: `a` is audited while a row of `a.b` stands', () => {
    expect(pop(listed('a'), ABSENT, ['a.b.uuid', 'a.b.child', 'a.uuidx', 'xa.uuid', 'a.hold', 'a.workdir']).candidates)
      .toEqual(['a']);
  });

  it('a record in the MEASURED records\' listing lifts it: a kept record is never silent', () => {
    expect(pop(listed('a'), listed('a.1.2'), ['a.uuid', 'a.child']).candidates).toEqual(['a']);
  });

  it('only a record of the id itself lifts it, and only from a measured listing', () => {
    expect(pop(listed('a'), listed('a.b.1.2'), ['a.uuid']).candidates).toEqual(['a.b']);
    expect(pop(listed('a'), unmeasured('symlink'), ['a.uuid']).candidates).toEqual([]);
  });
});

describe('forgetting', () => {
  it('only when BOTH listings were measured and neither names the id', () => {
    const p = pop(listed('a'), listed('b.1.2'));
    expect(['a', 'b', 'c'].map((id) => collectForgets(p, id))).toEqual([false, false, true]);
  });

  it('never while either listing is unmeasured, whatever the reason', () => {
    for (const p of [
      pop(unmeasured('symlink'), listed()), pop(listed(), unmeasured('read-failed')),
      pop(listed(...many(COLLECT_POPULATION_MAX + 1)), ABSENT),
    ]) {
      expect(collectForgets(p, 'gone'), JSON.stringify(p.unmeasured)).toBe(false);
    }
  });
});
