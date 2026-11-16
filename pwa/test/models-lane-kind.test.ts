// D-8686 (re-plan R1, the 2026-11-16 route's row R1): a lane's model list is chosen by the roster's lane kind, and the
// effort picker offers only the levels the catalogue lists for the model of the class the session runs. A managed Codex
// lane gets the dedicated list; a lane whose row says `telemetry: 'anthropic'` gets the Anthropic one; only a row that
// says neither (or no row) keeps the wrapper check, the route's TEMPORARY exception to D17.
//
// This repository is public, so every fixture here is neutral: `lane-a`, `lane-b`, `project-a`, and made-up model ids
// and labels. A fixture that spells a real lane, account or model name is a leak.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FleetSession } from '../../shared/api';
import type { LaneModelsRead } from '../../shared/models';
import {
  asLaneModelsRead, classReadbackMeasurable, effortIsKnown, effortOptions, laneClassEfforts, modelListProvider,
  modelOptions, type LaneKindFacts,
} from '../src/lib/models';
import { routeView } from '../src/session/routeView';
import { fleetSession } from './fleetFixture';

const CODEX: LaneKindFacts = { kind: 'codex', managed: true, telemetry: 'codex' };
const CODEX_UNMANAGED: LaneKindFacts = { kind: 'codex', managed: false, telemetry: 'codex' };
const CODEX_UNSAID: LaneKindFacts = { kind: 'codex', telemetry: 'codex' };
const ANTHROPIC: LaneKindFacts = { kind: 'sign-in', telemetry: 'anthropic' };

/** `lane-b`'s files: opus lists four levels, haiku two, sonnet lists none (`[]`), fable has no catalogue row (`null`). */
const LANE_B: LaneModelsRead = {
  kind: 'read',
  classes: {
    fable: { model: 'model-6-delta', label: 'Delta 6', efforts: null },
    opus: { model: 'model-6.1-gamma', label: 'Gamma 6.1', efforts: ['low', 'medium', 'high', 'xhigh'] },
    sonnet: { model: 'model-6.1-alpha', label: 'Alpha 6.1', efforts: [] },
    haiku: { model: 'model-6-beta', label: 'Beta 6', efforts: ['low', 'medium'] },
  },
};
const routes = (o: readonly { route: { value: string } }[]): string[] => o.map((x) => `class=${x.route.value}`);
const labels = (o: readonly { label: string }[]): string[] => o.map((x) => x.label);

describe('modelListProvider: the roster decides, the wrapper only when it does not say', () => {
  it.each([
    ['lane-b', CODEX, 'openai'],
    ['lane-b', CODEX_UNSAID, 'anthropic'],
    ['lane-b', CODEX_UNMANAGED, 'anthropic'],
    ['gpt', ANTHROPIC, 'anthropic'], // the roster beats the fallback
    ['gpt', undefined, 'openai'], // the fallback, kept
    ['gpt', CODEX_UNMANAGED, 'openai'], // the fallback, kept
    ['lane-a', ANTHROPIC, 'anthropic'],
    ['lane-a', undefined, 'anthropic'],
  ] as const)('%s with %j gives %s', (wrapper, entry, want) => {
    expect(modelListProvider(wrapper, entry)).toBe(want);
  });
});

describe('a managed Codex lane that the fallback does not name gets the dedicated list', () => {
  it('has the four class rows in the dedicated order, no Default row, and the lane\'s own labels', () => {
    const rows = modelOptions('lane-b', CODEX, LANE_B, null);
    expect(routes(rows)).toEqual(['class=fable', 'class=opus', 'class=sonnet', 'class=haiku']);
    expect(labels(rows)).toEqual(['Delta 6', 'Gamma 6.1', 'Alpha 6.1', 'Beta 6']);
  });

  it('control: the same lane with an unsaid row gets the Anthropic list, ending in Default', () => {
    const rows = modelOptions('lane-b', CODEX_UNSAID, LANE_B, null);
    expect(routes(rows)).toEqual(['class=opus', 'class=sonnet', 'class=fable', 'class=haiku', 'class=default']);
  });
});

describe('effortOptions on the dedicated list offers the levels the catalogue lists', () => {
  const lv = (efforts: readonly string[] | null) => labels(effortOptions('lane-b', CODEX, efforts, null, false));
  it('the listed rungs in ladder order, then Auto', () => {
    expect(lv(['low', 'medium', 'high', 'xhigh'])).toEqual(['Low', 'Medium', 'High', 'Xhigh', 'Auto']);
    expect(lv(['xhigh', 'low'])).toEqual(['Low', 'Xhigh', 'Auto']);
  });
  it('null (not known) and [] (the row lists none) constrain nothing: all five rungs', () => {
    const all = ['Low', 'Medium', 'High', 'Xhigh', 'Max', 'Auto'];
    expect(lv(null)).toEqual(all);
    expect(lv([])).toEqual(all);
  });
  it('a list with no ladder rung leaves Auto alone', () => {
    expect(lv(['minimal'])).toEqual(['Auto']);
  });
  it('never offers Ultracode there', () => {
    expect(labels(effortOptions('lane-b', CODEX, null, null, false))).not.toContain('Ultracode');
  });
});

describe('effortOptions off the dedicated list ignores the catalogue\'s levels', () => {
  it('an Anthropic lane keeps all its rows', () => {
    expect(labels(effortOptions('lane-a', ANTHROPIC, ['low'], null, false)))
      .toEqual(['Low', 'Medium', 'High', 'Xhigh', 'Ultracode', 'Max', 'Auto']);
  });
});

describe('effortIsKnown follows the narrowed list', () => {
  it('max is unknown under a list without it, known when the lane does not say', () => {
    expect(effortIsKnown('lane-b', CODEX, ['low', 'medium', 'high', 'xhigh'], 'max')).toBe(false);
    expect(effortIsKnown('lane-b', CODEX, null, 'max')).toBe(true);
  });
  it('ultracode is unknown on a managed Codex lane and known on an Anthropic one', () => {
    expect(effortIsKnown('lane-b', CODEX, null, 'ultracode')).toBe(false);
    expect(effortIsKnown('lane-a', ANTHROPIC, null, 'ultracode')).toBe(true);
  });
});

describe('laneClassEfforts', () => {
  it('gives the class\'s own list, [] for a row that lists none, null for a class with no catalogue row', () => {
    expect(laneClassEfforts(LANE_B, 'opus')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(laneClassEfforts(LANE_B, 'haiku')).toEqual(['low', 'medium']);
    expect(laneClassEfforts(LANE_B, 'sonnet')).toEqual([]);
    expect(laneClassEfforts(LANE_B, 'fable')).toBeNull();
  });
  it('is null for a value that is not a class, and for a lane that has not been read', () => {
    for (const c of ['', 'default', 'ludicrous', null]) expect(laneClassEfforts(LANE_B, c), String(c)).toBeNull();
    for (const l of [null, { kind: 'absent' }, { kind: 'unreadable' }] as const) expect(laneClassEfforts(l, 'opus')).toBeNull();
  });
});

describe('classReadbackMeasurable follows the roster row', () => {
  it('is true where the provider is the list\'s own, false for no row or the other provider', () => {
    expect(classReadbackMeasurable('lane-b', CODEX, 'openai')).toBe(true);
    expect(classReadbackMeasurable('lane-b', undefined, 'openai')).toBe(false);
    expect(classReadbackMeasurable('lane-b', CODEX, 'anthropic')).toBe(false);
  });
});

describe('asLaneModelsRead: the one reader of the wire, and absence permits', () => {
  const body = (efforts: Record<string, unknown>) => ({
    ok: true, lane: 'lane-b',
    models: {
      kind: 'read',
      classes: Object.fromEntries(['fable', 'opus', 'sonnet', 'haiku'].map((c) => [
        c, { model: `m-${c}`, label: `L ${c}`, ...(c in efforts ? { efforts: efforts[c] } : {}) },
      ])),
    },
  });
  const effortsOf = (r: LaneModelsRead | null) =>
    r?.kind === 'read' ? Object.values(r.classes).map((c) => c.efforts) : 'not a read';
  it('an older server sends no efforts: each label is kept and efforts is null', () => {
    const r = asLaneModelsRead(body({}));
    expect(effortsOf(r)).toEqual([null, null, null, null]);
    expect(r?.kind === 'read' && r.classes.opus.label).toBe('L opus');
  });
  it('a string array is copied; null stays null', () => {
    const sent = ['low', 'high'];
    const r = asLaneModelsRead(body({ opus: sent, haiku: null, sonnet: [] }));
    expect(r?.kind === 'read' && r.classes.opus.efforts).toEqual(['low', 'high']);
    expect(r?.kind === 'read' && r.classes.opus.efforts).not.toBe(sent);
    expect(r?.kind === 'read' && r.classes.haiku.efforts).toBeNull();
    expect(r?.kind === 'read' && r.classes.sonnet.efforts).toEqual([]);
  });
  it('anything else makes the whole answer null', () => {
    expect(asLaneModelsRead(body({ opus: 7 }))).toBeNull();
    expect(asLaneModelsRead(body({ opus: ['low', 1] }))).toBeNull();
  });
});

describe('routeView.effortLevels: the levels of the class the picker lights', () => {
  const fields = (f: NonNullable<FleetSession['route']>['fields']): FleetSession['route'] =>
    ({ fields: f, degraded: null, inert: [], unreadable: [] });
  const sess = (over: Partial<FleetSession>) => fleetSession({ wrapper: 'lane-b', ...over });
  it('with no route, the live model\'s class names the levels', () => {
    const v = routeView(sess({ model: 'model-6.1-gamma' }), 'lane-b', CODEX, 'openai', LANE_B);
    expect(v.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh']);
  });
  it('a routed class names its own levels', () => {
    const v = routeView(sess({ model: 'model-6.1-gamma', route: fields({ class: 'haiku' }) }), 'lane-b', CODEX, 'openai', LANE_B);
    expect(v.effortLevels).toEqual(['low', 'medium']);
  });
  it('class default, or no row lit, is null', () => {
    expect(routeView(sess({ model: 'model-6.1-gamma', route: fields({ class: 'default' }) }), 'lane-b', CODEX, 'openai', LANE_B).effortLevels)
      .toBeNull();
    expect(routeView(sess({ model: 'something-else' }), 'lane-b', CODEX, 'openai', LANE_B).effortLevels).toBeNull();
  });
  it('an intended effort the lit class does not list is unmeasurable, not queued; a listed one still queues', () => {
    const max = sess({ model: 'model-6.1-gamma', effort: 'low', route: fields({ effort: 'max' }) });
    expect(routeView(max, 'lane-b', CODEX, 'openai', LANE_B).effortPending).toBe(false);
    const high = sess({ model: 'model-6.1-gamma', effort: 'low', route: fields({ effort: 'high' }) });
    expect(routeView(high, 'lane-b', CODEX, 'openai', LANE_B).effortPending).toBe(true);
  });
});

describe('the wrapper fallback census (TEMPORARY, D17\'s exception)', () => {
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
  /** CODE only: whole-line comments and trailing ` //` comments dropped, as `whitelist-subset.test.ts`'s `code()`. */
  const code = (src: string): string =>
    src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const PATTERNS = [
    /\bwrapper\s*[!=]==?\s*(['"`])[^'"`\n]+\1/g,
    /(['"`])[^'"`\n]+\1\s*[!=]==?\s*wrapper\b/g,
  ];
  const hits = (src: string): { index: number; text: string }[] =>
    PATTERNS.flatMap((re) => [...src.matchAll(re)].map((m) => ({ index: m.index ?? 0, text: m[0] })));
  const files = sources(SRC);
  const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');
  const found = files.flatMap((f) => hits(code(readFileSync(f, 'utf8'))).map((h) => `${rel(f)}: ${h.text}`));

  it('CONTROL: the walk found the source tree and read the file whose empty-literal test it must not count', () => {
    expect(files.length).toBeGreaterThan(100);
    const header = files.find((f) => rel(f) === 'session/sessionHeaderView.ts');
    expect(header, 'sessionHeaderView.ts was read').toBeDefined();
    expect(readFileSync(header as string, 'utf8')).toMatch(/\bwrapper\s*[!=]==?\s*''/);
    expect(hits(code(readFileSync(header as string, 'utf8')))).toEqual([]);
  });

  // When the definition of done's item 4 lands ("No `=== 'gpt'` wrapper check is left in `pwa/src`"), this expectation
  // becomes `[]` and the position test below goes.
  it('exactly one wrapper-name comparison is left, in modelListProvider', () => {
    expect(found).toEqual(["lib/models.ts: wrapper === 'gpt'"]);
  });

  it('it sits after both roster checks inside modelListProvider\'s body', () => {
    const src = code(readFileSync(path.join(SRC, 'lib/models.ts'), 'utf8'));
    const start = src.indexOf('export function modelListProvider');
    const end = src.indexOf('\n}', start);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end);
    const at = hits(body);
    expect(at).toHaveLength(1);
    expect(body.indexOf('managedCodex(entry)')).toBeGreaterThan(-1);
    expect(body.indexOf("entry?.telemetry === 'anthropic'")).toBeGreaterThan(-1);
    expect(at[0]!.index).toBeGreaterThan(body.indexOf('managedCodex(entry)'));
    expect(at[0]!.index).toBeGreaterThan(body.indexOf("entry?.telemetry === 'anthropic'"));
  });
});
