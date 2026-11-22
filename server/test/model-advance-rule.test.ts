// The family rule (auto-advance spec §2.2, D16) as pure functions: `shared/model-advance.mjs`. Neutral model ids
// only: this repository is public.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKED_CAUSES, REASON_MAX, RETIRE_GAP_MS, RETIRE_GRACE_MS, canaryEffort, candidateFor, chooseCandidate, classWaits,
  clearEffortFallback, compareVersions, effortDroppedDetail, effortFallbackOf, effortFallbacks, eligibleIds, familyOf,
  markMissing, observedAt, parseModelId, pinMissing, recordEffortFallbacks, refreshRecord, resolveEffort,
} from '../../shared/model-advance.mjs';
import { backfillAdvance } from '../../shared/model-advance.mjs';
import { CLASSES } from '../../shared/models.js';
import { ADV_CATALOGUE, ADV_REGISTRY, EFFORTS4, EFFORTS5, cat, mrow, reg } from './fixtures/advanceCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const MODULE = path.join(REPO, 'shared', 'model-advance.mjs');
const DECL = path.join(REPO, 'shared', 'model-advance.d.mts');
const PROBE = path.join(here, 'types', 'ok', 'model-advance.ts');
const NONE = { candidate: null, reason: null, blocked: null };
/** The measured first sighting of the 2026-11-10 flap (programme wave 3, backward-move). */
const GRACE_SINCE = '2026-11-10T22:16:58Z';
/** An epoch in ms in the advance file's time form. */
const isoS = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** A run of sightings that has qualified `model` to retire on catalogue `c` (D-8838): six hours of them, ending at
 *  `c`'s own observation time, and a plan clock at that time. */
const qualified = (model: string, c: { fetchedAt: number }) => ({
  missing: { model, since: isoS(c.fetchedAt * 1000 - RETIRE_GRACE_MS), seen: isoS(c.fetchedAt * 1000) },
  nowMs: c.fetchedAt * 1000,
});

describe('parseModelId — exactly <vendor>-<version>-<family> (D16)', () => {
  it.each([
    ['model-6.1-alpha', { vendor: 'model', version: [6, 1], family: 'alpha' }],
    ['model-6-beta', { vendor: 'model', version: [6], family: 'beta' }],
    ['vendor2-10.0.3.1-gamma', { vendor: 'vendor2', version: [10, 0, 3, 1], family: 'gamma' }],
    ['model-0.9-delta2', { vendor: 'model', version: [0, 9], family: 'delta2' }],
  ] as [string, unknown][])('takes %s', (id, want) => {
    expect(parseModelId(id)).toEqual(want);
  });

  it.each([
    ['two parts', 'model-alpha'],
    ['four parts', 'vendor-6-alpha-mini'],
    ['a word for a version', 'model-auto-alpha'],
    ['a leading zero', 'model-06-alpha'],
    ['a leading zero after a dot', 'model-6.01-alpha'],
    ['an empty version part', 'model-6.-alpha'],
    ['five version parts', 'model-10.0.0.0.1-alpha'],
    ['a seven-digit part', 'model-1234567-alpha'],
    ['an uppercase vendor', 'Model-6-alpha'],
    ['an uppercase family', 'model-6-Alpha'],
    ['a family with a dot', 'model-6-alpha.mini'],
    ['a family with a colon', 'model-6-alpha:beta'],
    ['a family with a slash', 'model-6-alpha/beta'],
    ['a vendor that starts with a digit', '2model-6-alpha'],
    ['the empty string', ''],
  ])('refuses %s (%s): never a candidate, never a crash', (_why, id) => {
    expect(parseModelId(id)).toBeNull();
    expect(familyOf(id)).toBeNull();
  });

  it.each([[null], [undefined], [6], [{}], [['model-6-alpha']], [true]])(
    'reads %j, which is no string, as no id at all: never a candidate, never a crash', (id) => {
      expect(parseModelId(id as never)).toBeNull();
      expect(familyOf(id as never)).toBeNull();
    },
  );

  it('familyOf takes the last part, and an empty class has no family of its own', () => {
    expect(familyOf('model-6.1-alpha')).toBe('alpha');
    expect(familyOf(null)).toBeNull();
  });
});

describe('compareVersions — integers part by part, a missing part reads as 0', () => {
  it.each([
    [[6, 1], [6], 1], [[6], [5, 6], 1], [[10], [9], 1], [[6, 0], [6], 0], [[5, 6], [6], -1], [[6], [6, 0, 0, 1], -1],
  ] as [number[], number[], number][])('%j against %j is %i, and the other way round its opposite', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
    expect(compareVersions(b, a)).toBe(want === 0 ? 0 : -want);
  });
});

describe('eligibleIds — visible in the catalogue AND inside the discovery scope', () => {
  const c = cat([mrow('model-6-alpha'), mrow('model-6.1-alpha', { hidden: true }), mrow('model-7-alpha')]);

  it('a whole-catalogue scope offers the visible rows only', () => {
    expect(eligibleIds(reg({}), c)).toEqual(['model-6-alpha', 'model-7-alpha']);
  });

  it('an explicit list offers its visible members only: a hidden row it names, and an id the catalogue lacks, are not eligible', () => {
    expect(eligibleIds(reg({}, { discovery: ['model-6-alpha', 'model-6.1-alpha', 'model-9-alpha'] }), c))
      .toEqual(['model-6-alpha']);
  });

  it('a never-probed lane has nothing eligible', () => {
    expect(eligibleIds(reg({}), null)).toEqual([]);
  });
});

describe('chooseCandidate — one class, one family, forwards (§2.2)', () => {
  const gamma = cat([mrow('model-5.6-gamma'), mrow('model-6.1-gamma')]);

  it('takes the newest eligible model of the class\'s family that is newer than its pin', () => {
    expect(chooseCandidate({ registry: reg({ opus: 'model-5.6-gamma' }), catalogue: gamma, cls: 'opus', family: 'gamma' }))
      .toEqual({ candidate: 'model-6.1-gamma', reason: 'newer', blocked: null });
  });

  it('a missing family is derived from the pin', () => {
    expect(chooseCandidate({ registry: reg({ opus: 'model-5.6-gamma' }), catalogue: gamma, cls: 'opus', family: null }))
      .toEqual({ candidate: 'model-6.1-gamma', reason: 'newer', blocked: null });
  });

  it("a pinned class follows its pin's own family, never a stored family that disagrees with it (D-5992)", () => {
    // A stored family goes stale when a pin moves and the family is not rewritten: a hand set-class by a build from
    // before the advance file, after a rollback; a hand-edited registry; a revert by a build that did not rewrite it.
    const r = reg({ opus: 'model-6-delta' });
    expect(chooseCandidate({ registry: r, catalogue: cat([mrow('model-6-delta'), mrow('model-6.1-gamma')]), cls: 'opus',
      family: 'gamma' }), 'a newer model of the stored family is no candidate for a pin of another').toEqual(NONE);
    // …and the pin's own family is the one it moves in.
    const both = cat([mrow('model-6-delta'), mrow('model-6.1-gamma'), mrow('model-7-delta')]);
    expect(chooseCandidate({ registry: r, catalogue: both, cls: 'opus', family: 'gamma' }))
      .toEqual({ candidate: 'model-7-delta', reason: 'newer', blocked: null });
    // A pin gone from the catalogue moves within its own family too, never into the stored one: to a newer model at
    // once (`newer`, programme wave 3), and to an older one only once its grace has run (`retired`).
    expect(chooseCandidate({ registry: reg({ opus: 'model-5-delta' }), catalogue: both, cls: 'opus', family: 'gamma' }))
      .toEqual({ candidate: 'model-7-delta', reason: 'newer', blocked: null });
    expect(chooseCandidate({ registry: reg({ opus: 'model-8-delta' }), catalogue: both, cls: 'opus', family: 'gamma',
      ...qualified('model-8-delta', both) }))
      .toEqual({ candidate: 'model-7-delta', reason: 'retired', blocked: null });
  });

  it('the stored family decides for an empty class, which is what it exists for, beside a pinned class of another family (D-5992)', () => {
    const c = cat([mrow('model-6-delta'), mrow('model-6.1-gamma'), mrow('model-7-delta')]);
    const r = reg({ opus: 'model-6-delta' });
    expect(chooseCandidate({ registry: r, catalogue: c, cls: 'fable', family: 'gamma' }))
      .toEqual({ candidate: 'model-6.1-gamma', reason: 'empty', blocked: null });
    expect(chooseCandidate({ registry: r, catalogue: c, cls: 'fable', family: null }), 'no stored family: no guess')
      .toEqual(NONE);
  });

  it('forwards only: a pin with only an older model listed gets no candidate', () => {
    expect(chooseCandidate({ registry: reg({ opus: 'model-6.1-gamma' }), catalogue: gamma, cls: 'opus', family: 'gamma' }))
      .toEqual(NONE);
  });

  it('a newer model of another family is never a candidate', () => {
    const c = cat([mrow('model-5.6-gamma'), mrow('model-7-beta')]);
    expect(chooseCandidate({ registry: reg({ opus: 'model-5.6-gamma' }), catalogue: c, cls: 'opus', family: 'gamma' }))
      .toEqual(NONE);
  });

  it('a retired pin falls back to the newest eligible model left in its family, on a fresh catalogue only (D-5199)', () => {
    const r = reg({ opus: 'model-7-gamma' });
    const gone = qualified('model-7-gamma', gamma);
    expect(chooseCandidate({ registry: r, catalogue: gamma, cls: 'opus', family: 'gamma', ...gone }))
      .toEqual({ candidate: 'model-6.1-gamma', reason: 'retired', blocked: null });
    expect(chooseCandidate({ registry: r, catalogue: { ...gamma, stale: true }, cls: 'opus', family: 'gamma', ...gone }))
      .toEqual(NONE);
    expect(chooseCandidate({ registry: r, catalogue: null, cls: 'opus', family: 'gamma', ...gone })).toEqual(NONE);
  });

  it("a stale catalogue still names a newer or an empty class's candidate: that stale gate is the op's (W2 Tasks 8 and 9), never this function's", () => {
    const stale = { ...gamma, stale: true };
    expect(chooseCandidate({ registry: reg({ opus: 'model-5.6-gamma' }), catalogue: stale, cls: 'opus', family: 'gamma' }))
      .toEqual({ candidate: 'model-6.1-gamma', reason: 'newer', blocked: null });
    expect(chooseCandidate({ registry: reg({}), catalogue: stale, cls: 'fable', family: 'gamma' }))
      .toEqual({ candidate: 'model-6.1-gamma', reason: 'empty', blocked: null });
  });

  it('a tie is never a candidate; the next untied version above the pin may be', () => {
    const r = reg({ opus: 'model-5.6-omega' });
    const tied = cat([mrow('model-5.6-omega'), mrow('model-6-omega'), mrow('model-6.2-omega'), mrow('model-6.2.0-omega')]);
    expect(chooseCandidate({ registry: r, catalogue: tied, cls: 'opus', family: 'omega' }))
      .toEqual({ candidate: 'model-6-omega', reason: 'newer', blocked: null });
    const onlyTied = cat([mrow('model-5.6-omega'), mrow('model-6-omega'), mrow('model-6.0-omega')]);
    expect(chooseCandidate({ registry: r, catalogue: onlyTied, cls: 'opus', family: 'omega' })).toEqual(NONE);
  });

  it('a hidden newer row, or one outside an explicit discovery list, is not eligible', () => {
    const c = cat([mrow('model-6.1-gamma'), mrow('model-7-gamma', { hidden: true })]);
    expect(chooseCandidate({ registry: reg({ opus: 'model-6.1-gamma' }, { discovery: ['model-6.1-gamma', 'model-7-gamma'] }),
      catalogue: c, cls: 'opus', family: 'gamma' })).toEqual(NONE);
    expect(chooseCandidate({ registry: reg({ opus: 'model-5.6-gamma' }, { discovery: ['model-5.6-gamma'] }),
      catalogue: gamma, cls: 'opus', family: 'gamma' })).toEqual(NONE);
  });

  it('a pin that breaks the grammar is blocked and never advances, whatever family it is given', () => {
    expect(chooseCandidate({ registry: reg({ opus: 'model-x-gamma' }), catalogue: gamma, cls: 'opus', family: 'gamma' }))
      .toEqual({ candidate: null, reason: null, blocked: 'pin-grammar' });
  });

  it('an empty class with a family takes the newest eligible model of it; with no family it stays empty', () => {
    const delta = cat([mrow('model-5.6-delta'), mrow('model-6-delta')]);
    expect(chooseCandidate({ registry: reg({}), catalogue: delta, cls: 'fable', family: 'delta' }))
      .toEqual({ candidate: 'model-6-delta', reason: 'empty', blocked: null });
    expect(chooseCandidate({ registry: reg({}), catalogue: delta, cls: 'fable', family: null })).toEqual(NONE);
  });

  it('a model another class pins is never a candidate; a family whose newest model another class pins is blocked shared-family', () => {
    const alpha = cat([mrow('model-5.6-alpha'), mrow('model-6-alpha'), mrow('model-6.1-alpha')]);
    const r = reg({ haiku: 'model-6.1-alpha', opus: 'model-5.6-alpha' });
    expect(chooseCandidate({ registry: r, catalogue: alpha, cls: 'opus', family: 'alpha' }))
      .toEqual({ candidate: null, reason: null, blocked: 'shared-family' });
    // The class that pins the newest is not blocked: it simply has nothing newer.
    expect(chooseCandidate({ registry: r, catalogue: alpha, cls: 'haiku', family: 'alpha' })).toEqual(NONE);
  });

  it('runs over a live-shaped catalogue (two-part, four-part and word-version ids listed beside the real rows) without throwing, and names each class its candidate', () => {
    // ADV_CATALOGUE lists `model-6`, `vendor-6-alpha-mini` and `model-auto-alpha`: ids `parseModelId` refuses. A
    // guard that let one through to `.family` would throw a TypeError here, on every hourly pass of a real lane.
    const run = (cls: Parameters<typeof chooseCandidate>[0]['cls'], family: string) =>
      chooseCandidate({ registry: ADV_REGISTRY, catalogue: ADV_CATALOGUE, cls, family });
    expect(run('haiku', 'alpha')).toEqual({ candidate: 'model-6.1-alpha', reason: 'newer', blocked: null });
    expect(run('sonnet', 'beta')).toEqual({ candidate: 'model-6.1-beta', reason: 'newer', blocked: null });
    expect(run('opus', 'gamma')).toEqual({ candidate: 'model-6.1-gamma', reason: 'newer', blocked: null });
    expect(run('fable', 'delta')).toEqual({ candidate: 'model-6-delta', reason: 'empty', blocked: null });
    expect(run('fable', 'omega')).toEqual(NONE);
  });

  it('a pin the catalogue lists HIDDEN is listed, so never retired; and a visible twin of a hidden pin is not newer than it', () => {
    // A hidden pin beside an older visible sibling: read as retired, it would move BACKWARDS to model-5.6-gamma.
    const older = cat([mrow('model-5.6-gamma'), mrow('model-6.1-gamma', { hidden: true })]);
    expect(chooseCandidate({ registry: reg({ opus: 'model-6.1-gamma' }), catalogue: older, cls: 'opus', family: 'gamma' }))
      .toEqual(NONE);
    // A hidden pin and a visible twin at its version (6 and 6.0): the strict comparison names no move to the twin.
    const twin = cat([mrow('model-6-omega', { hidden: true }), mrow('model-6.0-omega')]);
    expect(chooseCandidate({ registry: reg({ opus: 'model-6-omega' }), catalogue: twin, cls: 'opus', family: 'omega' }))
      .toEqual(NONE);
  });

  it('a hidden twin, or one outside the discovery list, is no tie: only eligible ids count toward one (D-5819)', () => {
    const r = reg({ opus: 'model-5.6-alpha' });
    const visibleTwin = cat([mrow('model-5.6-alpha'), mrow('model-6-alpha'), mrow('model-6.0-alpha')]);
    expect(chooseCandidate({ registry: r, catalogue: visibleTwin, cls: 'opus', family: 'alpha' })).toEqual(NONE);
    const hiddenTwin = cat([mrow('model-5.6-alpha'), mrow('model-6-alpha'), mrow('model-6.0-alpha', { hidden: true })]);
    expect(chooseCandidate({ registry: r, catalogue: hiddenTwin, cls: 'opus', family: 'alpha' }))
      .toEqual({ candidate: 'model-6-alpha', reason: 'newer', blocked: null });
    const scoped = reg({ opus: 'model-5.6-alpha' }, { discovery: ['model-5.6-alpha', 'model-6-alpha'] });
    expect(chooseCandidate({ registry: scoped, catalogue: visibleTwin, cls: 'opus', family: 'alpha' }))
      .toEqual({ candidate: 'model-6-alpha', reason: 'newer', blocked: null });
  });

  describe('shared-family reads the family\'s newest version with its ties (D-5819)', () => {
    const SHARED = { candidate: null, reason: null, blocked: 'shared-family' };
    const ids = (...v: string[]) => cat(v.map((x) => mrow(`model-${x}-alpha`)));

    it('A1: ids 5.6, 6 and 6.0, one class on 6 and another on 5.6: the one on 5.6 is blocked, as it is without the twin', () => {
      const r = reg({ haiku: 'model-6-alpha', opus: 'model-5.6-alpha' });
      expect(chooseCandidate({ registry: r, catalogue: ids('5.6', '6', '6.0'), cls: 'opus', family: 'alpha' })).toEqual(SHARED);
      expect(chooseCandidate({ registry: r, catalogue: ids('5.6', '6'), cls: 'opus', family: 'alpha' })).toEqual(SHARED);
    });

    it('A2: the same ids, one class on 6, and an empty class with that family: the empty class is blocked', () => {
      const r = reg({ haiku: 'model-6-alpha' });
      expect(chooseCandidate({ registry: r, catalogue: ids('5.6', '6', '6.0'), cls: 'fable', family: 'alpha' })).toEqual(SHARED);
      expect(chooseCandidate({ registry: r, catalogue: ids('5.6', '6'), cls: 'fable', family: 'alpha' })).toEqual(SHARED);
    });

    it('A3: a tied newest pair (6.1 and 6.1.0), one class on 6 and another on 6.1: the one on 6 is blocked, the one on 6.1 has nothing', () => {
      const r = reg({ haiku: 'model-6-alpha', sonnet: 'model-6.1-alpha' });
      const c = ids('5.6', '6', '6.1', '6.1.0');
      expect(chooseCandidate({ registry: r, catalogue: c, cls: 'haiku', family: 'alpha' })).toEqual(SHARED);
      expect(chooseCandidate({ registry: r, catalogue: c, cls: 'sonnet', family: 'alpha' })).toEqual(NONE);
    });

    it('a model two classes pin (a hand-edited registry) is silent for both', () => {
      const r = reg({ haiku: 'model-6-alpha', opus: 'model-6-alpha' });
      const c = ids('5.6', '6');
      expect(chooseCandidate({ registry: r, catalogue: c, cls: 'haiku', family: 'alpha' })).toEqual(NONE);
      expect(chooseCandidate({ registry: r, catalogue: c, cls: 'opus', family: 'alpha' })).toEqual(NONE);
    });
  });

  it("a model another class pins is excluded from the candidates even when it is not the newest: with the tied newest pair 6.1 and 6.1.0 nobody pins, the class on 5.6 has nothing", () => {
    // Step 3 stays quiet (nobody pins 6.1 or 6.1.0), and the untied ids are 5.6 and 6: without the exclusion the
    // class on 5.6 would be offered model-6-alpha, the model the class on 6 holds.
    const c = cat([mrow('model-5.6-alpha'), mrow('model-6-alpha'), mrow('model-6.1-alpha'), mrow('model-6.1.0-alpha')]);
    const r = reg({ haiku: 'model-6-alpha', opus: 'model-5.6-alpha' });
    expect(chooseCandidate({ registry: r, catalogue: c, cls: 'opus', family: 'alpha' })).toEqual(NONE);
  });

  it('every blocked word it answers is one of BLOCKED_CAUSES: measured by running it over cases that block', () => {
    const alpha = cat([mrow('model-5.6-alpha'), mrow('model-6-alpha')]);
    const answers = [
      chooseCandidate({ registry: reg({ opus: 'model-x-alpha' }), catalogue: alpha, cls: 'opus', family: 'alpha' }),
      chooseCandidate({ registry: reg({ haiku: 'model-6-alpha', opus: 'model-5.6-alpha' }), catalogue: alpha, cls: 'opus', family: 'alpha' }),
      chooseCandidate({ registry: reg({ opus: 'model-5.6-alpha' }), catalogue: alpha, cls: 'opus', family: 'alpha' }),
      chooseCandidate({ registry: reg({}), catalogue: alpha, cls: 'fable', family: null }),
    ];
    const words = [...new Set(answers.map((a) => a.blocked).filter((w) => w !== null))].sort();
    expect(words).toEqual(['pin-grammar', 'shared-family']);
    for (const w of words) expect(BLOCKED_CAUSES).toContain(w);
    expect(Object.isFrozen(BLOCKED_CAUSES)).toBe(true);
  });
});

describe('resolveEffort — the class keeps its level, or the highest the new model offers below it (D-5200)', () => {
  it.each([
    ['a stored level the new model offers is kept',
      { stored: 'max', oldEfforts: [...EFFORTS5], newEfforts: [...EFFORTS5] }, 'max'],
    ['otherwise the highest new level below it, by the OLD row\'s order',
      { stored: 'max', oldEfforts: [...EFFORTS5], newEfforts: [...EFFORTS4] }, 'xhigh'],
    ['ranked by the old row, skipping the levels the new one lacks',
      { stored: 'high', oldEfforts: [...EFFORTS5], newEfforts: ['low', 'xhigh', 'max'] }, 'low'],
    ['with no old row, the new model\'s lowest',
      { stored: 'max', oldEfforts: null, newEfforts: ['low', 'medium'] }, 'low'],
    ['a stored level the old row does not list: the new model\'s lowest',
      { stored: 'ultra', oldEfforts: [...EFFORTS5], newEfforts: ['low', 'medium'] }, 'low'],
    ['nothing below it: the new model\'s lowest',
      { stored: 'low', oldEfforts: ['low', 'medium', 'high'], newEfforts: ['medium', 'high'] }, 'medium'],
    ['an empty new list (unknown) keeps the stored level',
      { stored: 'max', oldEfforts: [...EFFORTS5], newEfforts: [] }, 'max'],
    ['a class with no stored level stays without one',
      { stored: undefined, oldEfforts: [...EFFORTS5], newEfforts: [...EFFORTS4] }, undefined],
  ] as [string, Parameters<typeof resolveEffort>[0], string | undefined][])('%s', (_why, a, want) => {
    expect(resolveEffort(a)).toBe(want);
  });

  it('the canary asks for the lowest level the model offers, and none for an empty list', () => {
    expect(canaryEffort(['low', 'medium'])).toBe('low');
    expect(canaryEffort([])).toBeNull();
  });
});

describe('REASON_MAX — the one cap on a history reason', () => {
  it("is 200 characters: the number the advance file's reader, its writers and the canary all import", () => {
    expect(REASON_MAX).toBe(200);
  });
});

describe('shared/model-advance.mjs is a pure module that spells no class word', () => {
  it('imports only ./models.mjs, and nothing of node:*', () => {
    const src = readFileSync(MODULE, 'utf8');
    // STATEMENTS only, each opening its line, in single or double quotes: `import … from '…'` and
    // `export … from '…'` (the clause between is a name, `* as ns`, a `{ … }` list that may span lines, or a name
    // and then one of those), and a bare `import '…'`, which has no `from`. Anchored, so a message that quotes a
    // key named "from" is never read as an import; the controls below pin both halves of that.
    const FROM = /^\s*(?:import|export)\s+(?:[\w$]+\s*,\s*)?(?:[\w$]+|\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\1/gm;
    const BARE = /^\s*import\s*(['"])([^'"]+)\1/gm;
    const scan = (s: string): string[] => [...s.matchAll(FROM), ...s.matchAll(BARE)].map((m) => m[2]!);
    expect(scan(src)).toEqual(['./models.mjs']);
    expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    expect(scan(`  if (!x) bad('pending.from', 'is not {"from": <level|null>, "to": <level|null>}.');\n`)).toEqual([]);
    expect(scan(`import { a,\n  b } from "m1";\nexport * from 'm2';\n  import x, * as y from 'm3';\nimport 'm4';\n`))
      .toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('neither it nor its .d.mts spells a class word, in code or prose: the four come from CLASSES', () => {
    for (const f of [MODULE, DECL]) {
      const src = readFileSync(f, 'utf8');
      for (const c of CLASSES) expect(src, `${path.basename(f)} spells "${c}"`).not.toMatch(new RegExp(`\\b${c}\\b`));
    }
    expect(readFileSync(MODULE, 'utf8')).toMatch(/import\s*\{[^}]*\bCLASSES\b[^}]*\}\s*from\s*'\.\/models\.mjs'/);
  });

  it('every runtime export is declared in the .d.mts, and the .d.mts declares nothing that does not run', () => {
    // The names a source exports: `export const|let|var|function|async function|class` (after `declare` in the
    // .d.mts) and the names inside `export { … }`, an `as` alias exporting the alias. `export type` is no runtime name.
    const namesOf = (src: string, declare: boolean): string[] => {
      const kw = declare ? 'declare\\s+' : '';
      const decl = [...src.matchAll(new RegExp(
        `^export\\s+${kw}(?:const|let|var|function|async\\s+function|class)\\s+([A-Za-z_$][\\w$]*)`, 'gm'))].map((m) => m[1]);
      const lists = [...src.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((m) => m[1].split(',')
        .map((x) => x.trim()).filter((x) => x !== '' && !x.startsWith('type ')).map((x) => x.split(/\s+as\s+/).pop() ?? x));
      return [...decl, ...lists].sort();
    };
    const mod = readFileSync(MODULE, 'utf8');
    const runs = namesOf(mod, false);
    expect(namesOf(readFileSync(DECL, 'utf8'), true)).toEqual(runs);
    expect(runs).toContain('chooseCandidate');
    expect(mod).not.toMatch(/^export\s+(?:default\b|\*)/m);
  });

  it('the tsc probe drives the rule half, with no cast', () => {
    const src = readFileSync(PROBE, 'utf8');
    expect(src).toContain('chooseCandidate({ registry: reg, catalogue: cat, cls, family: fam })');
    expect(src).toContain("resolveEffort({ stored: 'max', oldEfforts: null, newEfforts: ['low'] })");
    expect(src).not.toContain(' as ');
  });
});

// ── Programme wave 3, backward-move (D-8838): a pin missing from a fresh catalogue waits out a span of continuous
// sightings before its class moves to an older model. Measured on the fleet box 2026-11-10: one lane's fresh catalogue
// left out the opus class's pin for about two hours; the class moved to the older model of its family and back, each
// behind a passing canary. The only move that may go to an older version is `retired` (the version order is not the
// cause: 6.1 > 6, pinned above), so the grace sits on that move alone. The grace counts the catalogue's own
// observation times (`fetchedAt`), never the plan's clock, so hours the lane was not observed never count.
describe('the retired grace (programme wave 3, backward-move, D-8838)', () => {
  const PIN = 'model-6.1-sol';
  const r = reg({ opus: PIN });
  const T0 = Date.parse(GRACE_SINCE);
  const H = 3_600_000;
  /** The measured shape, observed `ms` after the first sighting: the pin gone, its older siblings still listed. */
  const flap = (ms: number) => cat([mrow('model-6-sol'), mrow('model-5.6-sol')], { fetchedAt: (T0 + ms) / 1000 });
  const listed = (ms: number) => cat([mrow(PIN), mrow('model-6-sol')], { fetchedAt: (T0 + ms) / 1000 });
  const fresh = () => backfillAdvance({ registry: r, seedFamilies: null });
  /** One hourly refresh: the materialise records the sighting, then the plan reads it at `late` ms after it. */
  const hour = (adv: ReturnType<typeof fresh>, c: ReturnType<typeof flap>, late = 30_000) => {
    const nowMs = c.fetchedAt * 1000 + late;
    const next = markMissing(adv, r, c, nowMs).advance;
    return { adv: next, choice: chooseCandidate({ registry: r, catalogue: c, cls: 'opus', family: 'sol',
      missing: next.classes.opus['missing'], nowMs }) };
  };
  const run = (since: number, seen: number) => ({ model: PIN, since: isoS(T0 + since), seen: isoS(T0 + seen) });
  const RETIRED = { candidate: 'model-6-sol', reason: 'retired', blocked: null };

  it('RETIRE_GRACE_MS is six hours, and RETIRE_GAP_MS one hourly refresh plus half an hour', () => {
    expect(RETIRE_GRACE_MS).toBe(6 * H);
    expect(RETIRE_GAP_MS).toBe(90 * 60_000);
  });

  it('observedAt is a fresh catalogue\'s fetchedAt in the file\'s time form, and null for anything else', () => {
    expect(observedAt(flap(0))).toBe(GRACE_SINCE);
    expect(observedAt({ ...flap(0), stale: true })).toBeNull();
    expect(observedAt(null)).toBeNull();
    expect(observedAt({ ...flap(0), fetchedAt: 1e15 })).toBeNull();
  });

  it('the measured flap through the hourly order: two sightings without the pin, listed again on the third, moves nothing', () => {
    let adv = fresh();
    for (const [ms, c] of [[0, flap(0)], [H - 3_000, flap(H - 3_000)], [2 * H + 6_000, listed(2 * H + 6_000)]] as const) {
      const step = hour(adv, c);
      expect(step.choice, `${ms} ms`).toEqual(NONE);
      adv = step.adv;
    }
    expect(adv.classes.opus['missing'], 'listed again ends the run').toBeUndefined();
  });

  it('six hours of hourly sightings, with ordinary jitter, retire at the sighting that completes six hours, not before', () => {
    let adv = fresh();
    const times = [0, 62, 121, 183, 242, 301, 359].map((m) => m * 60_000);   // minutes, gaps of 58 to 62
    for (const ms of times) {
      const step = hour(adv, flap(ms));
      expect(step.choice, `${ms / 60_000} min`).toEqual(NONE);
      adv = step.adv;
    }
    expect(adv.classes.opus['missing']).toEqual(run(0, 359 * 60_000));
    const due = hour(adv, flap(6 * H));
    expect(due.choice, 'the boundary itself qualifies').toEqual(RETIRED);
    expect(hour(adv, flap(6 * H - 1_000)).choice, 'a second short').toEqual(NONE);
  });

  it('the plan clock never counts: a run of one sighting, read twelve hours later, does not retire', () => {
    const adv = hour(fresh(), flap(0)).adv;
    expect(chooseCandidate({ registry: r, catalogue: flap(0), cls: 'opus', family: 'sol',
      missing: adv.classes.opus['missing'], nowMs: T0 + 12 * H })).toEqual(NONE);
  });

  it('a sighting whose record was not written proposes nothing: the run must end at this catalogue\'s own time', () => {
    const missing = run(0, 6 * H);
    expect(chooseCandidate({ registry: r, catalogue: flap(7 * H), cls: 'opus', family: 'sol', missing, nowMs: T0 + 7 * H }),
      'the write of the 7 h sighting failed').toEqual(NONE);
    expect(chooseCandidate({ registry: r, catalogue: flap(6 * H), cls: 'opus', family: 'sol', missing, nowMs: T0 + 6 * H }))
      .toEqual(RETIRED);
  });

  it('a missed interval restarts the run; ordinary jitter, up to RETIRE_GAP_MS, continues it', () => {
    const adv = fresh();
    adv.classes.opus['missing'] = run(0, 3 * H);
    const at = (ms: number) => markMissing(adv, r, flap(ms), T0 + ms + 1_000).advance.classes.opus['missing'];
    expect(at(3 * H + 70 * 60_000), 'a 70 min gap').toEqual(run(0, 3 * H + 70 * 60_000));
    expect(at(3 * H + RETIRE_GAP_MS), 'the gap itself').toEqual(run(0, 3 * H + RETIRE_GAP_MS));
    expect(at(3 * H + RETIRE_GAP_MS + 1_000), 'a second past it').toEqual(run(3 * H + RETIRE_GAP_MS + 1_000, 3 * H + RETIRE_GAP_MS + 1_000));
    expect(at(5 * H), 'a missed hour').toEqual(run(5 * H, 5 * H));
    expect(at(27 * H), 'a day-long outage, then one sighting').toEqual(run(27 * H, 27 * H));
  });

  it('a stale catalogue, or the same catalogue read again, changes nothing', () => {
    const adv = fresh();
    adv.classes.opus['missing'] = run(0, 3 * H);
    for (const c of [{ ...flap(4 * H), stale: true }, { ...listed(4 * H), stale: true }, flap(3 * H), null]) {
      expect(markMissing(adv, r, c, T0 + 4 * H)).toEqual({ advance: adv, changed: false });
    }
  });

  it('a clock that went back, or forward past the gap, restarts the run; a sighting later than now is no sighting', () => {
    const adv = fresh();
    adv.classes.opus['missing'] = run(0, 3 * H);
    const at = (ms: number, nowMs: number) => markMissing(adv, r, flap(ms), nowMs);
    expect(at(2 * H, T0 + 4 * H).advance.classes.opus['missing'], 'back').toEqual(run(2 * H, 2 * H));
    expect(at(30 * H, T0 + 30 * H).advance.classes.opus['missing'], 'forward').toEqual(run(30 * H, 30 * H));
    expect(at(4 * H, T0 + 3.5 * H), 'in the future').toEqual({ advance: adv, changed: false });
    expect(chooseCandidate({ registry: r, catalogue: flap(6 * H), cls: 'opus', family: 'sol', missing: run(0, 6 * H),
      nowMs: T0 + 5 * H }), 'a qualifying run whose last sighting is after now').toEqual(NONE);
  });

  it('a record of the first shape, or of another model, restarts and never qualifies', () => {
    const first = { model: PIN, since: GRACE_SINCE };
    expect(chooseCandidate({ registry: r, catalogue: flap(9 * H), cls: 'opus', family: 'sol', missing: first,
      nowMs: T0 + 9 * H })).toEqual(NONE);
    for (const m of [first, { model: 'model-6-sol', since: GRACE_SINCE, seen: isoS(T0 + 8.5 * H) }, null, 'x']) {
      const adv = fresh();
      if (m !== null) adv.classes.opus['missing'] = m as never;
      expect(markMissing(adv, r, flap(9 * H), T0 + 9 * H).advance.classes.opus['missing']).toEqual(run(9 * H, 9 * H));
    }
  });

  // Review 2999 N3: one case per guard of the run's identity. The three model checks each red when that term alone is
  // removed (measured). The first-shape case pins the BEHAVIOUR, a record with no `seen` restarts within 90 minutes:
  // `isAt(m.seen)`, the order and the gap term each enforce it, so removing one of them alone keeps it green (review 3015 F2).
  const other = (since: number, seen: number) => ({ ...run(since, seen), model: 'model-7-sol' });

  it('retireDue: a record of another model, six hours long and ending at this catalogue\'s sighting, never retires the pin', () => {
    expect(chooseCandidate({ registry: r, catalogue: flap(6 * H), cls: 'opus', family: 'sol', missing: other(0, 6 * H),
      nowMs: T0 + 6 * H })).toEqual(NONE);
  });

  it('pinMissing: a record of another model is no run of this pin, so no start and no earliest move are named', () => {
    expect(pinMissing({ registry: r, catalogue: flap(2 * H), cls: 'opus', missing: other(0, 2 * H), nowMs: T0 + 2 * H }))
      .toEqual({ model: PIN, since: null, until: null, older: 'model-6-sol' });
  });

  it('markMissing: a record of another model at this very sighting is no repeat of it; the pin\'s run starts there', () => {
    const adv = fresh();
    adv.classes.opus['missing'] = other(0, 9 * H);
    const back = markMissing(adv, r, flap(9 * H), T0 + 9 * H);
    expect(back.changed).toBe(true);
    expect(back.advance.classes.opus['missing']).toEqual(run(9 * H, 9 * H));
  });

  it('markMissing: a first-shape record half an hour before this sighting restarts the run, never continues it', () => {
    const adv = fresh();
    adv.classes.opus['missing'] = { model: PIN, since: isoS(T0 + 8.5 * H) } as never;
    expect(markMissing(adv, r, flap(9 * H), T0 + 9 * H).advance.classes.opus['missing']).toEqual(run(9 * H, 9 * H));
  });

  it('a listed pin or an empty class loses its record, and the input is never edited', () => {
    const adv = fresh();
    adv.classes.opus['missing'] = run(0, 3 * H);
    const back = markMissing(adv, r, listed(4 * H), T0 + 4 * H);
    expect(back.changed).toBe(true);
    expect(back.advance.classes.opus['missing']).toBeUndefined();
    expect(adv.classes.opus['missing'], 'the input').toEqual(run(0, 3 * H));
    expect(markMissing(adv, reg({}), flap(4 * H), T0 + 4 * H).advance.classes.opus['missing']).toBeUndefined();
    expect(markMissing(adv, reg({ opus: 'model-6-sol' }), flap(4 * H), T0 + 4 * H).advance.classes.opus['missing'],
      'the class moved to a listed pin').toBeUndefined();
    for (const c of CLASSES.filter((x) => x !== 'opus')) {
      expect(markMissing(fresh(), r, flap(0), T0).advance.classes[c]['missing'], c).toBeUndefined();
    }
  });

  it('a stale catalogue never retires, the run qualified or not (D-5199)', () => {
    expect(chooseCandidate({ registry: r, catalogue: { ...flap(6 * H), stale: true }, cls: 'opus', family: 'sol',
      missing: run(0, 6 * H), nowMs: T0 + 6 * H })).toEqual(NONE);
  });

  it('a newer model never waits on a fresh catalogue (D-8839); on a stale one an unlisted pin gets nothing, as before', () => {
    const newer = cat([mrow('model-6-sol'), mrow('model-6.2-sol')]);
    expect(chooseCandidate({ registry: r, catalogue: newer, cls: 'opus', family: 'sol' }))
      .toEqual({ candidate: 'model-6.2-sol', reason: 'newer', blocked: null });
    expect(chooseCandidate({ registry: r, catalogue: { ...newer, stale: true }, cls: 'opus', family: 'sol' }),
      'an unlisted pin on a stale catalogue').toEqual(NONE);
    expect(chooseCandidate({ registry: r, catalogue: cat([mrow(PIN), mrow('model-6.2-sol')], { stale: true }), cls: 'opus',
      family: 'sol' }), 'a listed pin on a stale catalogue still names it; the op refuses the stale catalogue')
      .toEqual({ candidate: 'model-6.2-sol', reason: 'newer', blocked: null });
  });

  it('candidateFor carries the grace through to the plan and the commit (one computation)', () => {
    expect(candidateFor({ registry: r, catalogue: flap(H), cls: 'opus', family: 'sol', missing: run(0, H), nowMs: T0 + H }))
      .toEqual({ ...NONE, effortTo: null, canaryEffort: null });
    expect(candidateFor({ registry: r, catalogue: flap(6 * H), cls: 'opus', family: 'sol', missing: run(0, 6 * H),
      nowMs: T0 + 6 * H })).toMatchObject({ candidate: 'model-6-sol', reason: 'retired', canaryEffort: 'low' });
  });

  it('pinMissing names a waiting class: its pin, the run\'s start, the earliest move, and to what', () => {
    const at = (c: ReturnType<typeof flap> | ReturnType<typeof cat>, missing: unknown) =>
      pinMissing({ registry: r, catalogue: c, cls: 'opus', missing, nowMs: T0 + 2 * H });
    expect(at(flap(2 * H), run(0, 2 * H))).toEqual({ model: PIN, since: GRACE_SINCE, until: '2026-11-11T04:16:58Z',
      older: 'model-6-sol' });
    expect(at(flap(2 * H), undefined), 'no run yet').toEqual({ model: PIN, since: null, until: null, older: 'model-6-sol' });
    expect(at(flap(2 * H), { model: PIN, since: GRACE_SINCE }), 'the first shape').toMatchObject({ since: null, until: null });
    expect(pinMissing({ registry: r, catalogue: flap(6 * H), cls: 'opus', missing: run(0, 6 * H), nowMs: T0 + 6 * H }),
      'qualified').toBeNull();
    expect(at(listed(2 * H), run(0, H)), 'listed').toBeNull();
    expect(at({ ...flap(2 * H), stale: true }, run(0, 2 * H)), 'stale').toBeNull();
    expect(at(cat([mrow('model-6.2-sol')]), run(0, 2 * H)), 'a newer model is free').toBeNull();
    expect(at(cat([mrow('model-6-luna')]), run(0, 2 * H)), 'nothing left in its family').toBeNull();
  });

  it('classWaits names a waiting unheld class, and a held one stays quiet (D-8840)', () => {
    const c = { ...fresh().classes.opus, missing: run(0, 2 * H) };
    const rows = classWaits({ registry: r, catalogue: flap(2 * H), cls: 'opus', c, nowMs: T0 + 2 * H });
    expect(rows).toEqual([{ cause: 'pin-missing', detail: `${PIN} is missing from the lane's catalogue since ${GRACE_SINCE}; `
      + 'the class moves to model-6-sol, an older model, once every hourly sighting has missed it for six hours '
      + '(2026-11-11T04:16:58Z at the earliest), and any sighting that lists it again ends the wait' }]);
    expect(classWaits({ registry: r, catalogue: flap(2 * H), cls: 'opus', c: { ...c, hold: { at: GRACE_SINCE, by: 'hand' } },
      nowMs: T0 + 2 * H }), 'held').toEqual([]);
    expect(classWaits({ registry: r, catalogue: flap(0), cls: 'opus', c: null, nowMs: T0 })[0]?.detail)
      .toContain('(counted from the next sighting the refresh records)');
  });
});

// ── Programme wave 3, effort-level-dropped (D-8842): a stored level the class's model no longer offers ────────────
describe('effortFallbacks (programme wave 3, effort-level-dropped, D-8842)', () => {
  const json = (effort: Record<string, string>, classes: Record<string, string | null> = { opus: 'model-7-sol', sonnet: 'model-6-terra' }) =>
    ({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null, ...classes }, subagent: 'sonnet',
      discovery: 'catalogue', effort });
  const dropped = cat([mrow('model-7-sol', { efforts: [...EFFORTS4] }), mrow('model-6-terra'), mrow('model-6-luna')]);
  const FB = { class: 'opus', model: 'model-7-sol', from: 'max', to: 'xhigh' } as const;

  it('falls back to the next level down the model offers, ranked by a row that still lists the old one (D-5991)', () => {
    const got = effortFallbacks(json({ opus: 'max', sonnet: 'high' }), dropped);
    expect(got?.fallbacks).toEqual([FB]);
    expect(got?.registry.effort).toEqual({ opus: 'xhigh', sonnet: 'high' });
  });

  it('with no row listing the level, the model\'s lowest (resolveEffort\'s own fallback)', () => {
    const none = cat([mrow('model-7-sol', { efforts: ['minimal', 'low'] }), mrow('model-6-terra', { efforts: ['low'] })]);
    expect(effortFallbacks(json({ opus: 'max' }), none)?.fallbacks)
      .toEqual([{ class: 'opus', model: 'model-7-sol', from: 'max', to: 'minimal' }]);
  });

  it('a fallback can rank ABOVE the old level: nothing below it offered gives the model\'s lowest, never a refusal', () => {
    const up = cat([mrow('model-7-sol', { efforts: ['low', 'medium', 'high'] }), mrow('model-6-terra')]);
    expect(effortFallbacks(json({ opus: 'minimal' }), up)?.fallbacks)
      .toEqual([{ class: 'opus', model: 'model-7-sol', from: 'minimal', to: 'low' }]);
  });

  it('null for a registry that parses, one refused for anything else, or one still refused after the fallback', () => {
    expect(effortFallbacks(json({ opus: 'xhigh' }), dropped), 'parses as it is').toBeNull();
    expect(effortFallbacks({ ...json({ opus: 'max' }), stray: 1 }, dropped), 'an unknown key too').toBeNull();
    expect(effortFallbacks(json({ opus: 'max', bogus: 'high' }), dropped), 'still refused after the fallback').toBeNull();
    expect(effortFallbacks('not a registry', dropped)).toBeNull();
  });

  it('a recorded fallback stands only while the pin, the level and the drop do', () => {
    const r2 = reg({ opus: 'model-7-sol' }, { effort: { opus: 'xhigh' } });
    const adv = recordEffortFallbacks(backfillAdvance({ registry: r2, seedFamilies: null }), [FB], GRACE_SINCE);
    const fb = { at: GRACE_SINCE, model: 'model-7-sol', from: 'max', to: 'xhigh' };
    expect(adv.classes.opus['effortFallback']).toEqual(fb);
    expect(effortFallbackOf(adv.classes.opus, r2, 'opus', dropped)).toEqual(fb);
    expect(effortFallbackOf(adv.classes.opus, r2, 'opus', null), 'no catalogue to say otherwise').toEqual(fb);
    expect(effortFallbackOf(adv.classes.opus, reg({ opus: 'model-7-sol' }, { effort: { opus: 'high' } }), 'opus', dropped),
      'another level').toBeNull();
    expect(effortFallbackOf(adv.classes.opus, reg({ opus: 'model-8-sol' }, { effort: { opus: 'xhigh' } }), 'opus', dropped),
      'a move').toBeNull();
    expect(effortFallbackOf(adv.classes.opus, r2, 'opus', cat([mrow('model-7-sol')])), 'the old level offered again')
      .toBeNull();
    expect(effortFallbackOf(adv.classes.sonnet, r2, 'sonnet', dropped)).toBeNull();
    expect(effortFallbackOf(null, r2, 'opus', dropped)).toBeNull();
  });

  it('clearEffortFallback ends the record after a hand level, and changes nothing on a class without one', () => {
    const r2 = reg({ opus: 'model-7-sol' }, { effort: { opus: 'xhigh' } });
    const adv = recordEffortFallbacks(backfillAdvance({ registry: r2, seedFamilies: null }), [FB], GRACE_SINCE);
    const c = clearEffortFallback(adv, 'opus');
    expect(c.changed).toBe(true);
    expect(c.advance.classes.opus['effortFallback']).toBeUndefined();
    expect(adv.classes.opus['effortFallback'], 'the input').toBeDefined();
    expect(clearEffortFallback(c.advance, 'opus')).toEqual({ advance: c.advance, changed: false });
  });

  it('refreshRecord writes the sightings and the new fallbacks in one, and ends a fallback that no longer stands', () => {
    const r2 = reg({ opus: 'model-7-sol', sonnet: 'model-9-terra' }, { effort: { opus: 'xhigh' } });
    const base = backfillAdvance({ registry: r2, seedFamilies: null });
    const nowMs = dropped.fetchedAt * 1000;
    const one = refreshRecord(base, { registry: r2, catalogue: dropped, fallbacks: [FB], nowMs });
    expect(one.changed).toBe(true);
    expect(one.advance.classes.opus['effortFallback']).toEqual({ at: isoS(nowMs), model: 'model-7-sol', from: 'max', to: 'xhigh' });
    expect(one.advance.classes.sonnet['missing'], 'the sonnet pin is not listed')
      .toEqual({ model: 'model-9-terra', since: isoS(nowMs), seen: isoS(nowMs) });
    expect(refreshRecord(one.advance, { registry: r2, catalogue: dropped, fallbacks: [], nowMs }),
      'the same hour again').toEqual({ advance: one.advance, changed: false });
    const back = cat([mrow('model-7-sol'), mrow('model-9-terra')], { fetchedAt: dropped.fetchedAt + 3600 });
    const two = refreshRecord(one.advance, { registry: r2, catalogue: back, fallbacks: [], nowMs: nowMs + 3_600_000 });
    expect(two.advance.classes.opus['effortFallback'], 'max is offered again; xhigh is kept').toBeUndefined();
    expect(two.advance.classes.sonnet['missing'], 'listed again').toBeUndefined();
  });

  it('classWaits and effortDroppedDetail say what the class runs at, and what the refused registry waits for', () => {
    const r2 = reg({ opus: 'model-7-sol' }, { effort: { opus: 'xhigh' } });
    const adv = recordEffortFallbacks(backfillAdvance({ registry: r2, seedFamilies: null }), [FB], GRACE_SINCE);
    expect(classWaits({ registry: r2, catalogue: dropped, cls: 'opus', c: adv.classes.opus, nowMs: 0 })).toEqual([{
      cause: 'effort-fallback',
      detail: `model-7-sol no longer offers effort max, so since ${GRACE_SINCE} it runs at xhigh, the fallback the hourly refresh chose`,
    }]);
    expect(effortDroppedDetail(FB)).toBe('model-7-sol no longer offers effort max, so the lane\'s registry is refused '
      + 'until the hourly refresh writes the fallback, xhigh');
  });

  it('the three new blocked words are BLOCKED_CAUSES words', () => {
    for (const w of ['pin-missing', 'effort-dropped', 'effort-fallback']) expect(BLOCKED_CAUSES).toContain(w);
  });
});
