// The family rule (auto-advance spec §2.2, D16) as pure functions: `shared/model-advance.mjs`. Neutral model ids
// only: this repository is public.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKED_CAUSES, REASON_MAX, RETIRE_GRACE_MS, canaryEffort, candidateFor, chooseCandidate, compareVersions,
  effortFallbackOf, effortFallbacks, eligibleIds, familyOf, markMissing, parseModelId, pinMissing,
  recordEffortFallbacks, resolveEffort,
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
/** A missing pin's record, and a clock its grace has run on (programme wave 3, backward-move). */
const GRACE_SINCE = '2026-11-10T22:16:58Z';
const GRACE_DUE = Date.parse(GRACE_SINCE) + RETIRE_GRACE_MS;

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
      missing: { model: 'model-8-delta', since: GRACE_SINCE }, nowMs: GRACE_DUE }))
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
    const gone = { missing: { model: 'model-7-gamma', since: GRACE_SINCE }, nowMs: GRACE_DUE };
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

// ── Programme wave 3, backward-move: a pin missing from a fresh catalogue waits out a grace before its class moves to
// an older model. Measured on the fleet box 2026-11-10: one lane's fresh catalogue left out the opus class's pin for
// about two hours; the class moved to the older model of its family and back, each behind a passing canary. The only
// move that may go to an older version is `retired` (the version order is not the cause: 6.1 > 6, pinned above), so
// the grace sits on that move alone.
describe('the retired grace (programme wave 3, backward-move)', () => {
  const PIN = 'model-6.1-sol';
  const r = reg({ opus: PIN });
  /** The measured shape: the pin gone, its older sibling and an older one still listed. */
  const flap = cat([mrow('model-6-sol'), mrow('model-5.6-sol')]);
  const at = (h: number): number => Date.parse(GRACE_SINCE) + h * 3_600_000;
  const mark = { model: PIN, since: GRACE_SINCE };

  it('RETIRE_GRACE_MS is six hours', () => {
    expect(RETIRE_GRACE_MS).toBe(6 * 3_600_000);
  });

  it('the measured flap: no record, or a record younger than the grace, moves nothing; at the grace it retires', () => {
    expect(chooseCandidate({ registry: r, catalogue: flap, cls: 'opus', family: 'sol' }), 'no record, no clock').toEqual(NONE);
    expect(chooseCandidate({ registry: r, catalogue: flap, cls: 'opus', family: 'sol', nowMs: at(9) }), 'no record').toEqual(NONE);
    for (const h of [0, 1, 2, 5.99]) {
      expect(chooseCandidate({ registry: r, catalogue: flap, cls: 'opus', family: 'sol', missing: mark, nowMs: at(h) }), `${h} h`)
        .toEqual(NONE);
    }
    for (const h of [6, 30]) {
      expect(chooseCandidate({ registry: r, catalogue: flap, cls: 'opus', family: 'sol', missing: mark, nowMs: at(h) }), `${h} h`)
        .toEqual({ candidate: 'model-6-sol', reason: 'retired', blocked: null });
    }
  });

  it('a record that names another model than the pin, or is not a record, counts as none', () => {
    for (const missing of [{ model: 'model-6-sol', since: GRACE_SINCE }, { model: PIN, since: 'yesterday' }, null, 'x']) {
      expect(chooseCandidate({ registry: r, catalogue: flap, cls: 'opus', family: 'sol', missing, nowMs: at(9) }))
        .toEqual(NONE);
    }
  });

  it('a stale catalogue never retires, the grace run or not (D-5199)', () => {
    expect(chooseCandidate({ registry: r, catalogue: { ...flap, stale: true }, cls: 'opus', family: 'sol', missing: mark,
      nowMs: at(9) })).toEqual(NONE);
  });

  it('a newer model never waits: a missing pin with a newer model free moves `newer` at once, no record needed', () => {
    const newer = cat([mrow('model-6-sol'), mrow('model-6.2-sol')]);
    expect(chooseCandidate({ registry: r, catalogue: newer, cls: 'opus', family: 'sol' }))
      .toEqual({ candidate: 'model-6.2-sol', reason: 'newer', blocked: null });
  });

  it('candidateFor carries the grace through to the plan and the commit (one computation)', () => {
    expect(candidateFor({ registry: r, catalogue: flap, cls: 'opus', family: 'sol', missing: mark, nowMs: at(1) }))
      .toEqual({ ...NONE, effortTo: null, canaryEffort: null });
    expect(candidateFor({ registry: r, catalogue: flap, cls: 'opus', family: 'sol', missing: mark, nowMs: at(6) }))
      .toMatchObject({ candidate: 'model-6-sol', reason: 'retired', canaryEffort: 'low' });
  });

  it('pinMissing names the class the grace holds: its pin, when it was first seen missing, when it moves, and to what', () => {
    const until = '2026-11-11T04:16:58Z';
    expect(pinMissing({ registry: r, catalogue: flap, cls: 'opus', missing: mark, nowMs: at(2) }))
      .toEqual({ model: PIN, since: GRACE_SINCE, until, older: 'model-6-sol' });
    expect(pinMissing({ registry: r, catalogue: flap, cls: 'opus', missing: undefined, nowMs: at(2) }), 'not yet recorded')
      .toEqual({ model: PIN, since: null, until: null, older: 'model-6-sol' });
    expect(pinMissing({ registry: r, catalogue: flap, cls: 'opus', missing: mark, nowMs: at(6) }), 'the grace has run').toBeNull();
    expect(pinMissing({ registry: r, catalogue: cat([mrow(PIN), mrow('model-6-sol')]), cls: 'opus', missing: mark,
      nowMs: at(2) }), 'listed').toBeNull();
    expect(pinMissing({ registry: r, catalogue: { ...flap, stale: true }, cls: 'opus', missing: mark, nowMs: at(2) }),
      'stale').toBeNull();
    expect(pinMissing({ registry: r, catalogue: cat([mrow('model-6.2-sol')]), cls: 'opus', missing: mark, nowMs: at(2) }),
      'a newer model is free').toBeNull();
    expect(pinMissing({ registry: r, catalogue: cat([mrow('model-6-luna')]), cls: 'opus', missing: mark, nowMs: at(2) }),
      'nothing left in its family').toBeNull();
  });

  it('markMissing: a fresh catalogue records the first sighting, keeps it, clears it when the pin is listed again', () => {
    const adv = backfillAdvance({ registry: r, seedFamilies: null });
    const first = markMissing(adv, r, flap, GRACE_SINCE);
    expect(first.changed).toBe(true);
    expect(first.advance.classes.opus['missing']).toEqual(mark);
    expect(adv.classes.opus['missing'], 'the input is never edited').toBeUndefined();
    for (const c of CLASSES.filter((x) => x !== 'opus')) expect(first.advance.classes[c]['missing'], c).toBeUndefined();
    const again = markMissing(first.advance, r, flap, '2026-11-10T23:16:55Z');
    expect(again.changed, 'the first sighting stands').toBe(false);
    expect(again.advance.classes.opus['missing']).toEqual(mark);
    const back = markMissing(first.advance, r, cat([mrow(PIN)]), '2026-11-11T00:17:04Z');
    expect(back.changed).toBe(true);
    expect(back.advance.classes.opus['missing'], 'listed again').toBeUndefined();
    const moved = markMissing(first.advance, reg({ opus: 'model-6-sol' }), flap, '2026-11-11T00:17:04Z');
    expect(moved.advance.classes.opus['missing'], 'the class moved to a listed pin').toBeUndefined();
    const other = markMissing(first.advance, reg({ opus: 'model-7-sol' }), flap, '2026-11-11T00:17:04Z');
    expect(other.advance.classes.opus['missing'], 'a record of another pin is replaced')
      .toEqual({ model: 'model-7-sol', since: '2026-11-11T00:17:04Z' });
    const emptied = markMissing(first.advance, reg({}), flap, '2026-11-11T00:17:04Z');
    expect(emptied.advance.classes.opus['missing'], 'an empty class has no pin to miss').toBeUndefined();
  });

  it('markMissing reads a stale or absent catalogue as no evidence, either way', () => {
    const adv = backfillAdvance({ registry: r, seedFamilies: null });
    const marked = markMissing(adv, r, flap, GRACE_SINCE).advance;
    for (const c of [{ ...flap, stale: true }, { ...cat([mrow(PIN)]), stale: true }, null]) {
      expect(markMissing(adv, r, c, GRACE_SINCE)).toEqual({ advance: adv, changed: false });
      expect(markMissing(marked, r, c, GRACE_SINCE)).toEqual({ advance: marked, changed: false });
    }
  });
});

// ── Programme wave 3, effort-level-dropped: a stored level the class's model no longer offers ──────────────────────
describe('effortFallbacks (programme wave 3, effort-level-dropped)', () => {
  const json = (effort: Record<string, string>, classes: Record<string, string | null> = { opus: 'model-7-sol', sonnet: 'model-6-terra' }) =>
    ({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null, ...classes }, subagent: 'sonnet',
      discovery: 'catalogue', effort });
  const dropped = cat([mrow('model-7-sol', { efforts: [...EFFORTS4] }), mrow('model-6-terra'), mrow('model-6-luna')]);

  it('lowers a level the model no longer offers to the next one down, ranked by a row that still lists it (D-5991)', () => {
    const got = effortFallbacks(json({ opus: 'max', sonnet: 'high' }), dropped);
    expect(got?.fallbacks).toEqual([{ class: 'opus', model: 'model-7-sol', from: 'max', to: 'xhigh' }]);
    expect(got?.registry.effort).toEqual({ opus: 'xhigh', sonnet: 'high' });
  });

  it('with no row listing the level, the model\'s lowest (resolveEffort\'s own fallback)', () => {
    const none = cat([mrow('model-7-sol', { efforts: ['minimal', 'low'] }), mrow('model-6-terra', { efforts: ['low'] })]);
    expect(effortFallbacks(json({ opus: 'max' }), none)?.fallbacks)
      .toEqual([{ class: 'opus', model: 'model-7-sol', from: 'max', to: 'minimal' }]);
  });

  it('null for a registry that parses, one refused for anything else, or one still refused after lowering', () => {
    expect(effortFallbacks(json({ opus: 'xhigh' }), dropped), 'parses as it is').toBeNull();
    expect(effortFallbacks({ ...json({ opus: 'max' }), stray: 1 }, dropped), 'an unknown key too').toBeNull();
    expect(effortFallbacks(json({ opus: 'max', bogus: 'high' }), dropped), 'still refused after lowering').toBeNull();
    expect(effortFallbacks('not a registry', dropped)).toBeNull();
  });

  it('records each fallback on its class, and it stands only while the pin and the lowered level do', () => {
    const r2 = reg({ opus: 'model-7-sol' }, { effort: { opus: 'xhigh' } });
    const adv = recordEffortFallbacks(backfillAdvance({ registry: r2, seedFamilies: null }),
      [{ class: 'opus', model: 'model-7-sol', from: 'max', to: 'xhigh' }], GRACE_SINCE);
    const fb = { at: GRACE_SINCE, model: 'model-7-sol', from: 'max', to: 'xhigh' };
    expect(adv.classes.opus['effortFallback']).toEqual(fb);
    expect(effortFallbackOf(adv.classes.opus, r2, 'opus')).toEqual(fb);
    expect(effortFallbackOf(adv.classes.opus, reg({ opus: 'model-7-sol' }, { effort: { opus: 'high' } }), 'opus'),
      'a hand set-effort ends it').toBeNull();
    expect(effortFallbackOf(adv.classes.opus, reg({ opus: 'model-8-sol' }, { effort: { opus: 'xhigh' } }), 'opus'),
      'a move ends it').toBeNull();
    expect(effortFallbackOf(adv.classes.sonnet, r2, 'sonnet')).toBeNull();
    expect(effortFallbackOf(null, r2, 'opus')).toBeNull();
  });

  it('the two new blocked words are BLOCKED_CAUSES words', () => {
    expect(BLOCKED_CAUSES).toContain('pin-missing');
    expect(BLOCKED_CAUSES).toContain('effort-dropped');
  });
});
