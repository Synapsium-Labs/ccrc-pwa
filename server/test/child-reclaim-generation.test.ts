// `childReclaimGeneration` and `childReclaimLatest` — the ONE generation fence
// and the ONE latest-event rule (child-reclamation spec §5.6: session ids are
// slugs and slugs recycle; §5.9: the attention item and the chip read the
// lifecycle mirror). "The latest `reclaim` event for a session" is only ever
// read within ONE workspace generation: from the last `create` row (outcome
// `done`) at or before T to the first `create` `done` after it — and NOTHING
// when no such `create` exists, never another generation's rows. Only ccd's
// own `at` places a boundary: `ingestedAt` is the server's clock and never an
// event time (D8, `server/src/coord/schema.ts`), so a `done` create whose line
// carried no `at` opens nothing and closes nothing, and rows between two
// boundaries are kept by the mirror's id order whatever their `at`. Within it,
// the latest `reclaim` event of ANY outcome decides, `intent` included. The
// attention list reads both at T = now (wave 4); the run chip at T = the run's
// `closedAt` (wave 5). One table each, one implementation each — the last case
// scans for a second.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { childReclaimGeneration, childReclaimLatest } from '../src/coord/childReclaim.js';
import type { LifecycleAct, LifecycleOutcome, MirroredLifecycleEvent } from '../../shared/api.js';

const T = 1_790_000_000_000;
let uidN = 0;
/** One mirrored row of session `demo-a`, labelled through `detail` so a row
 *  list reads as the table. `ingestedAt` is a FIXTURE VALUE, 5 ms after ccd's
 *  clock (after T for a clockless row, so it falls inside every window below);
 *  no row reads it as a time and no expectation depends on it — it is there
 *  so that reading it would red the clockless rows (D8). */
const ev = (label: string, act: LifecycleAct, outcome: LifecycleOutcome, at: number | null):
  MirroredLifecycleEvent => ({
  uid: `g.${++uidN}`, at, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
  verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal: null, detail: label, truncated: false,
  obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: (at ?? T) + 5,
});
const labels = (xs: readonly MirroredLifecycleEvent[]): (string | null)[] => xs.map((e) => e.detail);

/** A RECYCLED SLUG: the first demo-a was refused and then removed by a human;
 *  ws-add minted a second demo-a under the same id (its `intent`, then its
 *  `done`), and that one was refused too. */
const RECYCLED: readonly MirroredLifecycleEvent[] = [
  ev('old-create', 'create', 'done', T),
  ev('old-refused', 'reclaim', 'refused', T + 10),
  ev('new-create-intent', 'create', 'intent', T + 20),
  ev('new-create', 'create', 'done', T + 21),
  ev('new-refused', 'reclaim', 'refused', T + 30),
];

const ROWS: readonly [string, readonly MirroredLifecycleEvent[], number, (string | null)[]][] = [
  ['recycled slug, T = now: the NEW workspace only', RECYCLED, T + 100, ['new-create', 'new-refused']],
  ['recycled slug, T between the creates: the OLD workspace, ending before the new done create',
    RECYCLED, T + 15, ['old-create', 'old-refused', 'new-create-intent']],
  ['T exactly at a done create: that create opens the generation', RECYCLED, T + 21, ['new-create', 'new-refused']],
  ['T before every create: no done create at or before T, so nothing', RECYCLED, T - 1, []],
  ['no done create in the history at all: nothing — never another generation\'s rows',
    [ev('r1', 'reclaim', 'refused', T), ev('r2', 'reclaim', 'done', T + 1)], T + 100, []],
  ['a create that never completed opens nothing',
    [ev('ci', 'create', 'intent', T), ev('r', 'reclaim', 'refused', T + 1)], T + 100, []],
  ['an empty history is an empty generation', [], T, []],
  ['rows before the first done create stay out of the generation it opens',
    [ev('pre', 'reclaim', 'done', T), ev('c', 'create', 'done', T + 1), ev('post', 'reclaim', 'refused', T + 2)],
    T + 100, ['c', 'post']],
  ['a REFUSED create opens nothing and closes nothing — ws-add minted nothing',
    [ev('c', 'create', 'done', T), ev('r', 'reclaim', 'refused', T + 1), ev('c2', 'create', 'refused', T + 2),
      ev('r2', 'reclaim', 'refused', T + 3)], T + 100, ['c', 'r', 'c2', 'r2']],
  ['a done create with no ccd clock CLOSES nothing — the rows after it stay in the generation before it, by id order',
    [ev('c0', 'create', 'done', T), ev('c1', 'create', 'done', null), ev('r', 'reclaim', 'refused', T + 60)],
    T + 40, ['c0', 'c1', 'r']],
  ['a done create with no ccd clock OPENS nothing — with no placed create at or before T, nothing',
    [ev('c0', 'create', 'done', null), ev('r', 'reclaim', 'refused', T + 20)], T + 100, []],
  ['a clockless create is skipped as a boundary: the next PLACED done create still closes the generation',
    [ev('c0', 'create', 'done', T), ev('c1', 'create', 'done', null), ev('r', 'reclaim', 'refused', T + 20),
      ev('c2', 'create', 'done', T + 30), ev('r2', 'reclaim', 'refused', T + 40)], T + 25, ['c0', 'c1', 'r']],
  ['the mirror\'s id order is kept — never re-sorted by ccd\'s clock',
    [ev('c', 'create', 'done', T + 10), ev('r', 'reclaim', 'refused', T)], T + 100, ['c', 'r']],
];

const LATEST: readonly [string, readonly MirroredLifecycleEvent[], string | null][] = [
  ['an empty generation has no latest event', [], null],
  ['a generation with no reclaim act has none', [ev('c', 'create', 'done', T), ev('h', 'hold', 'done', T + 1)], null],
  ['the newest reclaim event wins, whatever its outcome',
    [ev('r1', 'reclaim', 'refused', T), ev('r2', 'reclaim', 'done', T + 1)], 'r2'],
  ['an INTENT after a refusal IS the latest — an attempt in flight, or one that died mid-way',
    [ev('ref', 'reclaim', 'refused', T), ev('int', 'reclaim', 'intent', T + 1)], 'int'],
  ['a refusal after an intent is the latest', [ev('int', 'reclaim', 'intent', T), ev('ref', 'reclaim', 'refused', T + 1)], 'ref'],
  ['a failure is an outcome like any other', [ev('ref', 'reclaim', 'refused', T), ev('f', 'reclaim', 'failed', T + 1)], 'f'],
  ['later rows of other acts are read past',
    [ev('ref', 'reclaim', 'refused', T), ev('h', 'hold', 'done', T + 1), ev('s', 'supervise', 'done', T + 2)], 'ref'],
  ['id order decides, never ccd\'s clock', [ev('a', 'reclaim', 'refused', T + 10), ev('b', 'reclaim', 'done', T)], 'b'],
];

describe('childReclaimGeneration', () => {
  it.each(ROWS)('%s', (_name, events, at, want) => {
    expect(labels(childReclaimGeneration(events, at))).toEqual(want);
  });

  it('the birth fence\'s own use: over a CREATE-ONLY list, [0] IS the opening create', () => {
    // `childReclaimBornAt` reads `childReclaimGeneration(coord.lifecycleCreatesFor(id), now)[0]?.at`
    // — a single-row slice whose one element is the opening create itself,
    // because a create-only list has no later row to close it early.
    const creates = [
      ev('c0', 'create', 'done', T), ev('c1', 'create', 'done', T + 100), ev('c2', 'create', 'done', T + 200),
    ];
    expect(childReclaimGeneration(creates, T + 150)[0]?.detail).toBe('c1');
    expect(childReclaimGeneration(creates, T + 150)[0]?.at).toBe(T + 100);
  });
});

describe('childReclaimLatest', () => {
  it.each(LATEST)('%s', (_name, events, want) => {
    expect(childReclaimLatest(events)?.detail ?? null).toBe(want);
  });
});

describe('one implementation each', () => {
  it('each is defined ONCE, in server/src/coord/childReclaim.ts — no second implementation at any wave', () => {
    const root = path.resolve(__dirname, '../..');
    const files = ['server/src', 'shared', 'pwa/src'].flatMap((r) =>
      (fs.readdirSync(path.join(root, r), { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => [path.join(r, f), fs.readFileSync(path.join(root, r, f), 'utf8')] as const));
    for (const [name, re] of [
      ['childReclaimGeneration', /function childReclaimGeneration\b|\bchildReclaimGeneration\s*=\s*\(/],
      ['childReclaimLatest', /function childReclaimLatest\b|\bchildReclaimLatest\s*=\s*\(/],
    ] as const) {
      expect(files.filter(([, text]) => re.test(text)).map(([f]) => f), name)
        .toEqual(['server/src/coord/childReclaim.ts']);
    }
  });

  // K8 — ONE coordination fence, ONE store read, ONE birth placement (spec §1
  // rule 4; spec §5.6: slugs recycle). The close, the executor's step 2a and
  // the hold-release job's step 5 decide through `childReclaimHasCoordinated`;
  // the sweep reaches the same `childReclaimCoordinated` through its verdict.
  // A consumer that read the store's claims itself, or placed the birth with
  // its own spelling, would be a second reader that can disagree.
  it('K8: the coordination fence, its store read and its birth placement each have ONE home', () => {
    const root = path.resolve(__dirname, '../..');
    const under = (dirs: readonly string[]) => dirs.flatMap((r) =>
      (fs.readdirSync(path.join(root, r), { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.split(path.sep).includes('node_modules'))
        .map((f) => [path.join(r, f), fs.readFileSync(path.join(root, r, f), 'utf8')] as const));
    const src = under(['server/src']).sort(([a], [b]) => a.localeCompare(b));
    const count = (text: string, needle: string): number => text.split(needle).length - 1;
    const holders = (needle: string) => src.filter(([, t]) => t.includes(needle)).map(([f]) => f);
    for (const [name, home] of [
      ['childReclaimCoordinated', 'server/src/childReclaimSweep.ts'],
      ['childReclaimBornAt', 'server/src/coord/childReclaim.ts'],
      ['childReclaimHasCoordinated', 'server/src/coord/childReclaim.ts'],
    ] as const) {
      const re = new RegExp(`function ${name}\\b|\\b${name}\\s*=\\s*\\(`);
      expect(src.filter(([, t]) => re.test(t)).map(([f]) => f), `${name} is defined once`).toEqual([home]);
    }
    expect(holders('.childReclaimCoordinatorClaims()'), 'the store read is called only by the fence\'s two homes')
      .toEqual(['server/src/coord/childReclaim.ts', 'server/src/watch.ts']);
    const hasCoordinated = 'childReclaimHasCoordinated(';
    expect(src.map(([f, t]) => [f, count(t, hasCoordinated)] as const).filter(([, n]) => n > 0),
      'its definition, step 2a and step 5; and the close').toEqual([
      ['server/src/coord/childReclaim.ts', 3], ['server/src/coord/close.ts', 1],
    ]);
    const placement = 'childReclaimGeneration(coord.lifecycleCreatesFor';
    expect(src.map(([f, t]) => [f, count(t, placement)] as const).filter(([, n]) => n > 0), 'one birth placement')
      .toEqual([['server/src/coord/childReclaim.ts', 1]]);
    const childReclaimTs = src.find(([f]) => f === 'server/src/coord/childReclaim.ts')![1];
    const bornAtBody = /export function childReclaimBornAt\([^]*?\n}\n/.exec(childReclaimTs)?.[0] ?? '';
    expect(bornAtBody, 'the placement lives inside childReclaimBornAt').toContain(placement);
    const watchTs = src.find(([f]) => f === 'server/src/watch.ts')![1];
    expect(count(watchTs, 'childReclaimBornAt(coord, r.id, now)'), 'the sweep places the birth through the helper').toBe(1);
    // The reader this fence replaced is gone from every file under server/ —
    // the needle is built in two halves so this file does not name it either.
    const retired = 'childReclaim' + 'CoordinatorIds';
    expect(under(['server/src', 'server/test', 'server/test-e2e', 'server/scripts'])
      .filter(([, t]) => t.includes(retired)).map(([f]) => f), 'no file names the retired reader').toEqual([]);
  });
});
