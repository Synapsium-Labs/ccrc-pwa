// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.7): the Settings section shows would-collect and held
// counts from existing attention state. The PWA counts nothing, so the server counts, by the items' own precedence
// (`collectItemOf`), never by a second ladder: these cases hold `collectLaneCounts` to what `collectAttentionItems`
// publishes, unvouched holds included, and the box lines other than the unvouched one.
import { describe, it, expect } from 'vitest';
import type { ChildReclaimCollectAttention } from '../../shared/api.js';
import { CHILD_RECLAIM_TIER_NONE, childReclaimTierFrom } from '../src/childReclaimSweep.js';
import {
  collectAttentionItems, collectLaneCounts,
  type CollectAttentionView, type CollectBoxFacts, type CollectRunView,
} from '../src/collectLane.js';

const NO_RUN: CollectRunView = { tier: CHILD_RECLAIM_TIER_NONE, word: null, detail: null };
const runOf = (cls: string, word: string, n: number, stuck = false): CollectRunView =>
  ({ tier: childReclaimTierFrom(cls, n, stuck), word, detail: null });
const view = (over: Partial<CollectAttentionView> = {}): CollectAttentionView => ({
  witnessRun: 41, leaf: '/h/tmp-root/demo-a', failing: NO_RUN, verbFailed: NO_RUN, terminal: NO_RUN, deferral: null,
  presenceSince: null, hold: null, changedRecentlySince: null, die: null, wouldCollect: false, ...over,
});
const holdOf = (why: 'run-open' | 'run-absent' | 'run-after-witness' | 'id-in-open-run'): CollectAttentionView =>
  view({ hold: { why, since: 0 } });
const BOX: CollectBoxFacts = {
  unmeasured: [], refusedNames: 0, boxProbes: new Map(), passAudits: new Map(), flockLatched: false, unsettled: new Map(),
};
interface Lane { readonly entries: ReadonlyMap<string, CollectAttentionView>; readonly box: CollectBoxFacts }
const lane = (entries: Readonly<Record<string, CollectAttentionView>>, box: Partial<CollectBoxFacts> = {}): Lane =>
  ({ entries: new Map(Object.entries(entries)), box: { ...BOX, ...box } });
/** The unvouched count, read from the one box line that states it. */
const unvouchedOf = (box: readonly ChildReclaimCollectAttention[]): number => {
  const line = box.find((a) => a.word === 'unvouched');
  if (line === undefined) return 0;
  const m = /^(\d+) temp roots are held/.exec(line.sentence);
  expect(m, 'CONTROL: the unvouched line states its count').not.toBeNull();
  return Number(m![1]);
};

const STATES: readonly (readonly [string, Lane])[] = [
  ['nothing remembered', lane({})],
  ['a mixed lane', lane({
    'demo-a': view({ wouldCollect: true }),
    'demo-b': holdOf('run-open'),
    'demo-c': holdOf('run-absent'),
    'demo-d': view({ deferral: { word: 'in-use', detail: 'pid 7', since: 0 }, wouldCollect: true }),
    'demo-e': view({ presenceSince: 0 }),
    'demo-f': view({ terminal: runOf('terminal', 'witness-mismatch', 1, true) }),
    'demo-g': view({ verbFailed: runOf('verb-failed', 'probe-unmeasured', 4) }),
    'demo-h': view({ changedRecentlySince: 0, wouldCollect: true }),
  })],
  ['a records failure while the record listing is in doubt yields to its would-collect', lane(
    { 'demo-a': view({ failing: runOf('failing', 'records', 4), wouldCollect: true }) },
    { unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: 'a symbolic link' }] })],
  ['the same records failure with the listing measured is a failing item', lane(
    { 'demo-a': view({ failing: runOf('failing', 'records', 4), wouldCollect: true }) })],
  ['box lines beside unvouched holds', lane(
    { 'demo-1': holdOf('run-absent'), 'demo-2': holdOf('run-after-witness'), 'demo-3': view({ wouldCollect: true }) },
    { flockLatched: true, refusedNames: 3, unsettled: new Map([['demo-9', 'audit']]) })],
];

describe("the counts come from the items' own precedence (§5.7)", () => {
  it('would-collect ids are counted', () => {
    expect(collectLaneCounts(lane({ 'demo-a': view({ wouldCollect: true }), 'demo-b': view({ wouldCollect: true }),
      'demo-c': view() }))).toEqual({ wouldCollect: 2, held: 0, boxLines: 0 });
  });

  it('held counts per-id held items plus unvouched ids', () => {
    expect(collectLaneCounts(lane({
      'demo-1': holdOf('run-open'),
      'demo-2': holdOf('run-absent'),
      'demo-3': holdOf('run-after-witness'),
      'demo-4': view({ hold: { why: 'run-open', since: 0 }, deferral: { word: 'in-use', detail: 'pid 7', since: 0 } }),
      'demo-5': view({ hold: { why: 'id-in-open-run', since: 0 }, wouldCollect: true }),
    }))).toEqual({ wouldCollect: 0, held: 4, boxLines: 0 });
  });

  it('boxLines excludes the unvouched line', () => {
    const l = lane({ 'demo-1': holdOf('run-absent'), 'demo-2': holdOf('run-after-witness') },
      { flockLatched: true, refusedNames: 2 });
    expect(collectAttentionItems({ ...l, nowMono: 0 }).box.map((a) => a.word), 'CONTROL: three lines stand, the unvouched among them')
      .toEqual(['refused-names', 'flock', 'unvouched']);
    expect(collectLaneCounts(l)).toEqual({ wouldCollect: 0, held: 2, boxLines: 2 });
  });

  it('an id failing the id predicate is not counted', () => {
    expect(collectLaneCounts(lane({ '-demo': view({ wouldCollect: true }), '.demo': holdOf('run-absent'),
      'demo-a': view({ wouldCollect: true }) }))).toEqual({ wouldCollect: 1, held: 0, boxLines: 0 });
  });

  it('a terminal item is never counted, even when ccd’s word is spelled like this build’s', () => {
    const l = lane({
      'demo-a': view({ terminal: runOf('terminal', 'would-collect', 1, true), wouldCollect: true }),
      'demo-b': view({ terminal: runOf('terminal', 'held', 1, true), hold: { why: 'run-open', since: 0 } }),
    });
    expect(collectAttentionItems({ ...l, nowMono: 0 }).perId.map((a) => a.word), 'CONTROL: the items carry ccd’s words')
      .toEqual(['would-collect', 'held']);
    expect(collectLaneCounts(l)).toEqual({ wouldCollect: 0, held: 0, boxLines: 0 });
  });

  it('parity with the published items over a table of lane states', () => {
    const seen = { wouldCollect: 0, held: 0, boxLines: 0 };
    for (const [what, l] of STATES) {
      const items = collectAttentionItems({ ...l, nowMono: 0 });
      const counts = collectLaneCounts(l);
      expect(counts, what).toEqual({
        wouldCollect: items.perId.filter((a) => a.word === 'would-collect').length,
        held: items.perId.filter((a) => a.word === 'held').length + unvouchedOf(items.box),
        boxLines: items.box.filter((a) => a.word !== 'unvouched').length,
      });
      seen.wouldCollect += counts.wouldCollect;
      seen.held += counts.held;
      seen.boxLines += counts.boxLines;
    }
    for (const [k, n] of Object.entries(seen)) expect(n, `CONTROL: the table exercises ${k}`).toBeGreaterThan(0);
  });
});
