// Native Docs reader C1, fix round 1 (review run 2259, F1): planning is LINEAR in the references. Each reference is
// derived exactly once, when it is first decided, and the listing is searched a constant number of times per plan, never
// once per reference or per extension. Pinned by counters, not by the clock: `resolveDocRef` is counted through a
// wrapping mock (every derivation past the depth check calls it once), and the tree's `entries` array is a proxy that
// counts each whole-listing pass (`find`, or iteration). Placeholders only (`demo`, `main`).
import { describe, expect, it, vi } from 'vitest';
import type { DocPin, DocsEntry } from '../../shared/docs';
import { extendMockupAssetPlan, planMockupAssets } from '../src/docs/mockup/plan';
import type { MockupContext, MockupRef } from '../src/docs/mockup/ports';
import { COMMIT_A, SERVED, entry, holder, treeOk } from './docsFixtures';

const calls = vi.hoisted(() => ({ resolve: 0 }));
vi.mock('../../shared/docs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/docs')>();
  return {
    ...real,
    resolveDocRef: (...a: Parameters<typeof real.resolveDocRef>) => {
      calls.resolve += 1;
      return real.resolveDocRef(...a);
    },
  };
});

const PAGE = 'm.html';
let n = 0;
const ref = (raw: string, basePath: MockupRef['basePath'] = 'specs/m.html', depth = 0): MockupRef => {
  n += 1;
  return { key: `k${n}`, raw, basePath, kind: 'image', depth };
};
const png = (path: string): DocsEntry => entry('specs', path, { committed: { kind: 'file', blob: '1'.repeat(40), size: 10 } });

/** Every array method that walks a listing, and iteration (fix round 2, review run 2281 F4: `findIndex`, `indexOf`,
 *  `includes`, `map`, `reduce` and `every` were invisible to the first counter). */
const WALKERS: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  'find', 'findIndex', 'findLast', 'findLastIndex', 'filter', 'some', 'every', 'forEach', 'map', 'flatMap', 'reduce',
  'reduceRight', 'indexOf', 'lastIndexOf', 'includes', 'entries', 'keys', 'values', 'slice', 'concat', 'join', 'at',
  Symbol.iterator,
]);

/** A committed page's context over `listing` more entries, whose `entries` counts every whole-listing pass (a walking
 *  method or iteration) and every element read (a numeric index or `length`, which every walk, a native one included,
 *  makes through the proxy, and which an indexed loop makes alone). */
function countedCtx(listing: number): { ctx: MockupContext; passes: () => number; reads: () => number } {
  const entries = [entry('specs', PAGE), ...Array.from({ length: listing }, (_, i) => png(`p${i}.png`))];
  let passes = 0;
  let reads = 0;
  const counted = new Proxy(entries, {
    get(t, k, r) {
      if (WALKERS.has(k)) passes += 1;
      else if (k === 'length' || (typeof k === 'string' && /^\d+$/.test(k))) reads += 1;
      return Reflect.get(t, k, r);
    },
  });
  const tree = treeOk({ entries: counted, drafts: holder() });
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: PAGE };
  return { ctx: { project: 'demo', pin, tree }, passes: () => passes, reads: () => reads };
}

describe('planning is linear in the references (fix round 1, F1)', () => {
  it('derives each reference once across a plan and its extensions, the inline duplicates of earlier rows included', () => {
    const { ctx } = countedCtx(100);
    calls.resolve = 0;
    // The review's shape: many uses of one admitted image (inline duplicates keep their size), then extensions.
    let plan = planMockupAssets(Array.from({ length: 2000 }, () => ref('p0.png')), ctx);
    let planned = 2000;
    for (let s = 0; s < 63; s += 1) {
      const refs = [ref(`p${(s % 50) + 1}.png`, 'specs/s.css', 1), ref('p0.png', 'specs/s.css', 1)];
      plan = extendMockupAssetPlan(plan, refs);
      planned += refs.length;
    }
    expect(plan.rows).toHaveLength(planned);
    expect(calls.resolve).toBe(planned);
    expect(plan.rows.filter((r) => r.verdict.v === 'inline')).toHaveLength(planned);
  });

  it('the review\'s page: 190 000 uses of one image, then 63 stylesheets\' references, each derived once', () => {
    // One `<style>` of 190 000 `url(x.png)` (2.09 M chars, admitted by the pre-scan) over a 100-entry listing, then one
    // extension per stylesheet up to the 64-asset cap. The time is printed for Results (a local figure); the counter
    // is what is asserted.
    const { ctx } = countedCtx(100);
    calls.resolve = 0;
    const t0 = performance.now();
    let plan = planMockupAssets(Array.from({ length: 190_000 }, () => ref('p0.png')), ctx);
    for (let s = 1; s <= 63; s += 1) plan = extendMockupAssetPlan(plan, [ref(`p${s}.png`, 'specs/s.css', 1)]);
    const ms = performance.now() - t0;
    process.stdout.write(`C1-FR1 F1 row: 190 000 uses + 63 extensions planned in ${Math.round(ms)} ms, ${plan.rows.length} rows\n`);
    expect(plan.rows).toHaveLength(190_063);
    expect(calls.resolve).toBe(190_063);
  });

  it('searches the listing a constant number of times per plan, however many references and extensions', () => {
    const one = countedCtx(100);
    planMockupAssets([ref('p0.png')], one.ctx);
    const base = one.passes();

    const big = countedCtx(100);
    let plan = planMockupAssets(Array.from({ length: 500 }, (_, i) => ref(`p${i % 100}.png`)), big.ctx);
    for (let s = 0; s < 20; s += 1) plan = extendMockupAssetPlan(plan, [ref(`p${s}.png`, 'specs/s.css', 1)]);
    expect(big.passes()).toBe(base);
    expect(base).toBeLessThanOrEqual(4);
    // An indexed loop or a native walk reads elements through the proxy: the reads are constant per plan too.
    expect(big.reads()).toBe(one.reads());
    expect(one.reads()).toBeLessThanOrEqual(4 * (101 + 1));
  });
});
