// Child reclamation wave 9 (spec §5.10): the pure rules for what the collector owes when an id LEAVES its population,
// and presence's continuity across an act (L1, `server/src/collectLane.ts`). `collect-lane-leaving.test.ts` pins that
// the watcher applies each. No ccd runs and no HOME is touched: every input is a literal of what the readers hand L1.
import { describe, it, expect } from 'vitest';
import { CHILD_RECLAIM_DEFER_CEILING_MS } from '../src/childReclaimSweep.js';
import {
  COLLECT_FEED_TITLE, collectAfterAct, collectAfterPresence, collectAttentionViewOf, collectAttentionViews,
  collectBoxAfterPopulation, collectEvidenceOf, collectFeedCollectedBody, collectFirstSighting, collectForgottenActRow,
  collectPopulation, type CollectEntry, type CollectJobSettled, type CollectPassClass, type CollectPopulation,
  type CollectResult,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DIE, NO_DOCUMENT, T1, UNREADABLE, collectable, failedAct, refusedAct, step, unmeasured,
  verdict,
} from './collectAnswers.js';

const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const OBS2 = collectable(T1, { witnessRun: 41, leaf: '/home/u/.cc-tmp/demo-a' });
const acted = (result: CollectResult): CollectJobSettled => ({ kind: 'acted', composedMono: 0, result });
/** A population from its two listings and the tick's registry names, through the one L1 rule. */
const pop = (roots: readonly string[] | null, records: readonly string[] = [], registry: readonly string[] = []): CollectPopulation =>
  collectPopulation({
    tmproots: roots === null ? { kind: 'unmeasured', why: 'a link' } : { kind: 'listed', names: roots },
    tmpquarantine: { kind: 'listed', names: records },
    registryNames: new Set(registry),
  });

describe('collectEvidenceOf: what one audit document brings (spec §5.10)', () => {
  it('a collectable, verdict or unmeasured document brings its witness’s run and leaf; no document and an unreadable one bring none', () => {
    expect(collectEvidenceOf(OBS2)).toEqual({ runId: 41, leaf: '/home/u/.cc-tmp/demo-a' });
    expect(collectEvidenceOf(verdict('in-use'))).toEqual({ runId: 7, leaf: '/home/u/.cc-tmp/demo-a' });
    expect(collectEvidenceOf(unmeasured('flock'))).toEqual({ runId: 7, leaf: '/home/u/.cc-tmp/demo-a' });
    expect(collectEvidenceOf(NO_DOCUMENT)).toBeNull();
    expect(collectEvidenceOf(UNREADABLE)).toBeNull();
  });
});

describe('collectForgottenActRow: a forgotten id’s collected act still owes its row (spec §5.10)', () => {
  it('a collected act: the collected row, worded as a remembered id’s, from observation 2’s run and leaf', () => {
    expect(collectForgottenActRow('demo-a', acted(COLLECTED), OBS2)).toEqual({
      runId: 41, title: COLLECT_FEED_TITLE.collected,
      body: collectFeedCollectedBody('demo-a', 41, '/home/u/.cc-tmp/demo-a', COLLECTED as Extract<CollectResult, { kind: 'collected' }>),
    });
  });

  it('every other act outcome, and every outcome that composed nothing, writes nothing for a forgotten id', () => {
    for (const r of [refusedAct('state-changed'), refusedAct('quarantine-kept'), failedAct(), DIE, ACT_NO_DOCUMENT]) {
      expect(collectForgottenActRow('demo-a', acted(r), OBS2), r.kind).toBeNull();
    }
    for (const kind of ['not-asked', 'answered', 'held', 'would-collect'] as const) {
      expect(collectForgottenActRow('demo-a', { kind }, OBS2), kind).toBeNull();
    }
    expect(collectForgottenActRow('demo-a', { kind: 'threw', detail: 'x' }, OBS2)).toBeNull();
  });
});

describe('collectBoxAfterPopulation: no box-wide line outlives the ids behind it (spec §5.10)', () => {
  const audits = (...ids: string[]): ReadonlyMap<string, CollectPassClass> => new Map(ids.map((id) => [id, 'no-document']));
  const probes: ReadonlyMap<string, string> = new Map([['flock', 'missing']]);

  it('the pass-scoped audits drop once none of their ids is a candidate, and stand while any one is', () => {
    expect(collectBoxAfterPopulation(pop([]), audits('demo-a', 'demo-b'), new Map()).passAudits.size, 'both gone').toBe(0);
    expect(collectBoxAfterPopulation(pop(['demo-b']), audits('demo-a', 'demo-b'), new Map()).passAudits.size, 'one stays')
      .toBe(2);
    expect(collectBoxAfterPopulation(pop(['demo-a', 'demo-b'], [], ['demo-a.uuid', 'demo-b.child']), audits('demo-a', 'demo-b'),
      new Map()).passAudits.size, 'registered again: no candidate').toBe(0);
    expect(collectBoxAfterPopulation(pop(['demo-a'], ['demo-a.1.2'], ['demo-a.uuid']), audits('demo-a'), new Map())
      .passAudits.size, 'a record keeps it a candidate').toBe(1);
  });

  it('the box probes clear only when the measured population holds no ids at all', () => {
    expect(collectBoxAfterPopulation(pop([]), new Map(), probes).boxProbes.size).toBe(0);
    expect(collectBoxAfterPopulation(pop(['demo-a']), new Map(), probes).boxProbes.size).toBe(1);
    expect(collectBoxAfterPopulation(pop(['demo-a'], [], ['demo-a.uuid']), new Map(), probes).boxProbes.size,
      'an id pre-filtered is still an id').toBe(1);
  });

  it('an unmeasured listing changes nothing: neither absence is read from it', () => {
    const r = collectBoxAfterPopulation(pop(null), audits('demo-a'), probes);
    expect([r.passAudits.size, r.boxProbes.size]).toEqual([1, 1]);
  });
});

describe('collectAttentionViews: only a re-registered id is hidden, and memory is never touched (spec §5.10)', () => {
  const e = collectFirstSighting(1);
  const entries: ReadonlyMap<string, CollectEntry> = new Map([['demo-a', e], ['demo-b', e], ['demo-c', e]]);
  const registry = new Set(['demo-b.uuid', 'demo-c.child']);

  it('an id whose exact registry row stands projects nothing, unless a quarantine record names it', () => {
    const views = collectAttentionViews(entries, pop(['demo-a', 'demo-b'], ['demo-c.1.2'], [...registry]), registry);
    expect([...views.keys()]).toEqual(['demo-a', 'demo-c']);
    expect(views.get('demo-a')).toEqual(collectAttentionViewOf(e));
    expect([...collectAttentionViews(entries, pop([]), new Set(['demo-a.b.uuid'])).keys()], 'never a prefix')
      .toEqual(['demo-a', 'demo-b', 'demo-c']);
  });

  it('a listing in doubt hides nothing: unmeasured, over its cap, or simply not naming the id', () => {
    const over = collectPopulation({ tmproots: { kind: 'listed', names: Array.from({ length: 1025 }, (_, i) => `x${i}`) },
      tmpquarantine: { kind: 'absent' }, registryNames: new Set() });
    for (const [what, p] of [['unmeasured', pop(null)], ['over its cap', over], ['not named', pop([])]] as const) {
      expect([...collectAttentionViews(entries, p, new Set()).keys()], what).toEqual(['demo-a', 'demo-b', 'demo-c']);
    }
  });

  it('with no population measured yet, nothing is projected', () => {
    expect(collectAttentionViews(entries, null, new Set()).size).toBe(0);
  });
});

describe('an act ends presence’s continuity (spec §5.10)', () => {
  it('presence, then any act outcome, then presence: the defer starts again, one count from the later arrival', () => {
    for (const r of [refusedAct('state-changed'), refusedAct('quarantine-kept'), failedAct(), ACT_NO_DOCUMENT, DIE, COLLECTED]) {
      let x = collectAfterPresence(collectFirstSighting(1), step(0, 2));
      x = collectAfterPresence(x, step(C / 2, 3));
      x = collectAfterAct(x, r, step(C / 2 + 1, 4));
      expect(x.presence, `${r.kind}: the act ended it`).toBeNull();
      x = collectAfterPresence(x, step(C, 5));
      expect(x.presence, `${r.kind}: presence starts again`).toEqual({ count: 1, sinceMono: C, atMono: C });
    }
  });
});
