// path-identity W2 (path-identity spec §3.6, TR6 A, rule S2): the temp-root collector's population admits an id that a
// compare-and-drop aside is for. A crash inside ccd's compare-and-drop can leave `$REG/tmproots/.<id>.drop.<pid>` with
// no witness beside it. Until this wave the population dropped every dot-leading name uncounted, so that id was never
// audited and its leaf leaked silently. Now an aside NAME whose id passes `isTmpRootId` folds that id into `ids`, with
// no field of its own: at least one name must parse, and ccd, never the server, decides from the bodies whether the
// aside is the sole parseable one. These rows pin the PURE half (L1, `server/src/collectLane.ts`); the listings are
// literals. No ccd runs and no HOME is touched: ccd/ccd is read as TEXT only, for `_ws_collect_aside_id`'s grammar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TMPROOT_ID_MAX_CHARS } from '../../shared/api.js';
import {
  COLLECT_ASIDE_NAME_RE, COLLECT_POPULATION_MAX, collectForgets, collectPopulation, parseCollectAsideName,
  type CollectListing, type CollectPopulation,
} from '../src/collectLane.js';
import { CCD } from './ccdWsHelpers.js';

const listed = (...names: string[]): CollectListing => ({ kind: 'listed', names });
const ABSENT: CollectListing = { kind: 'absent' };
const pop = (tmproots: CollectListing, tmpquarantine: CollectListing = ABSENT, registry: readonly string[] = []):
  CollectPopulation => collectPopulation({ tmproots, tmpquarantine, registryNames: new Set(registry) });
/** `n` aside names, each for its own id `id-<k>`. */
const asideNames = (n: number): string[] => Array.from({ length: n }, (_, k) => `.id-${k}.drop.${k + 1}`);

/** The ONE `re='…'` inside ccd's `_ws_collect_aside_id`, as written there (`collect-population.test.ts`'s
 *  `ccdRecordGrammar`, read for this function). */
const ccdAsideGrammar = (): string => {
  const src = readFileSync(CCD, 'utf8');
  const at = src.indexOf('\n_ws_collect_aside_id() {');
  if (at < 0) throw new Error('_ws_collect_aside_id not found in ccd/ccd');
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error('_ws_collect_aside_id has no closing brace');
  const found = [...src.slice(at, end).matchAll(/ re='([^']+)'/g)];
  if (found.length !== 1) throw new Error(`expected one re='…' in _ws_collect_aside_id, found ${found.length}`);
  return found[0]![1]!;
};

describe('a compare-and-drop aside\'s name (parseCollectAsideName)', () => {
  it('is ccd\'s `_ws_collect_aside_id` grammar, verbatim, and carries no flag', () => {
    expect(COLLECT_ASIDE_NAME_RE.source).toBe(ccdAsideGrammar());
    expect(COLLECT_ASIDE_NAME_RE.flags, 'a g flag makes .exec stateful').toBe('');
  });

  const A255 = 'a'.repeat(TMPROOT_ID_MAX_CHARS);
  it.each<readonly [string, string, string | null]>([
    ['a plain id', '.b-x.drop.9', 'b-x'],
    ['a dotted id keeps its dots', '.a.b.drop.7', 'a.b'],
    ['greedy: only the last .drop.<pid> goes', '.a-b.drop.1.drop.2', 'a-b.drop.1'],
    ['a pid that is not all digits', '.b-x.drop.x', null],
    ['no pid at all', '.b-x.drop.', null],
    ['an id that leads with a dot', '..x.drop.1', null],
    ['an id that leads with a dash', '.-x.drop.1', null],
    ['no leading dot', 'b-x.drop.9', null],
    ['a writer\'s temp file', '.b-x.123.456.tmp', null],
    ['a trailing newline', '.b-x.drop.9\n', null],
    ['an id of the cap', `.${A255}.drop.9`, A255],
    ['an id one over the cap', `.${A255}a.drop.9`, null],
  ])('%s', (_label, name, id) => {
    expect(parseCollectAsideName(name)).toBe(id);
  });
});

describe('the population admits an id an aside is for (path-identity spec §3.6, rule S2)', () => {
  it('an aside alone admits its id, audited, with no name counted', () => {
    expect(pop(listed('.b-x.drop.9'))).toEqual({
      ids: ['b-x'], candidates: ['b-x'], recordIds: new Set(), refusedNames: 0, unmeasured: [], bothMeasured: true,
    });
  });

  it('two asides of one id admit it once', () => {
    const p = pop(listed('.b-x.drop.1', '.b-x.drop.2'));
    expect(p.ids).toEqual(['b-x']);
    expect(p.candidates).toEqual(['b-x']);
  });

  it('an aside\'s id sorts in among the witnessed and the record ids, and is no record\'s', () => {
    expect(pop(listed('a', '.m-x.drop.3'), listed('z.1.2'))).toMatchObject({
      ids: ['a', 'm-x', 'z'], candidates: ['a', 'm-x', 'z'], recordIds: new Set(['z']), refusedNames: 0,
    });
  });

  it('an aside beside its own witness changes nothing', () => {
    expect(pop(listed('.a.drop.9', 'a'))).toMatchObject({ ids: ['a'], candidates: ['a'], refusedNames: 0 });
  });

  it('the pre-filter holds an aside\'s id back as it holds a witnessed one: a registry row stands, so it is not audited and not forgotten', () => {
    for (const row of ['b-x.uuid', 'b-x.child']) {
      const p = pop(listed('.b-x.drop.9'), ABSENT, [row]);
      expect(p.ids, row).toEqual(['b-x']);
      expect(p.candidates, `${row}: an aside lifts nothing, as a record does`).toEqual([]);
      expect(p.recordIds, row).toEqual(new Set());
      expect(collectForgets(p, 'b-x'), row).toBe(false);
    }
  });

  it('an id only an aside names is never forgotten, and an id nothing names is', () => {
    const p = pop(listed('.b-x.drop.9'), listed());
    expect(collectForgets(p, 'b-x'), 'an id with only an aside is not forgotten').toBe(false);
    expect(collectForgets(p, 'c'), 'CONTROL: both listings measured, and nothing names c').toBe(true);
  });

  it('every other dot-leading name under tmproots is dropped, uncounted', () => {
    expect(pop(listed('.junk', '..x.drop.1', '.b-x.drop.x', '.-x.drop.1'))).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 0, unmeasured: [], bothMeasured: true,
    });
  });

  it('an aside\'s name under tmpquarantine is dropped, uncounted: asides are read from tmproots alone', () => {
    expect(pop(ABSENT, listed('.b-x.drop.9'))).toMatchObject({ ids: [], candidates: [], refusedNames: 0 });
  });

  it(`a listing of ${COLLECT_POPULATION_MAX} aside names admits ${COLLECT_POPULATION_MAX} ids`, () => {
    const p = pop(listed(...asideNames(COLLECT_POPULATION_MAX)));
    expect(p.ids).toHaveLength(COLLECT_POPULATION_MAX);
    expect(p.bothMeasured).toBe(true);
  });

  it(`the cap counts the raw listing: ${COLLECT_POPULATION_MAX + 1} aside names make tmproots unmeasured, and admit nothing`, () => {
    expect(pop(listed(...asideNames(COLLECT_POPULATION_MAX + 1)))).toEqual({
      ids: [], candidates: [], recordIds: new Set(), refusedNames: 0, bothMeasured: false,
      unmeasured: [{ listing: 'tmproots', kind: 'over-cap', count: COLLECT_POPULATION_MAX + 1 }],
    });
  });

  it('the population\'s shape is unchanged: an aside\'s id folds into ids, with no field of its own', () => {
    expect(Object.keys(pop(listed('.b-x.drop.9'))).sort())
      .toEqual(['bothMeasured', 'candidates', 'ids', 'recordIds', 'refusedNames', 'unmeasured']);
  });
});
