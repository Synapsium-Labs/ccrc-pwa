// Child reclamation wave 8, X1 at the lane (spec §5.5, §5.7). A licence the sweep judged over ONE
// workspace generation never reaches a re-mint of the same name, wherever the re-mint falls: before the
// sweep reads the generation, between that read and the queue, or while the request waits on the
// session's queue. The licence here is the presence-only kind: fifteen presence answers, measured by the
// executor before any argv, and not one audit. Its generation is the sweep's own read, so it is bound all
// the same. The executor's half of the later points (the audit, the act, two queued requests) is in
// `child-reclaim-licence-executor.test.ts`. FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { G1, G2, laneFixture, modelCcd, type Lane } from './childReclaimGenerationFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

const G = (v: string) => ({ kind: 'value', v }) as const;
const model = (reg: string) => modelCcd({ reg, id: 'demo-a', wave7: true, hooks: {} });

/** demo-a, watched until its presence episode over G1 spans the ceiling: fifteen unlicensed asks, each
 *  answered `presence` by the executor before any argv, and the next ask is licensed
 *  (`child-reclaim-sweep.test.ts`'s L17 shape, on the real executor). Leaves the clock one pass on. */
const ripen = async (f: Lane): Promise<void> => {
  f.finishedChild('demo-a', G1);
  await f.pass();
  while (f.requests.length < 15) { f.next(); await f.pass(); }
  expect(f.requests.map((q) => q.deferExpired), 'fifteen unlicensed asks').toEqual(Array.from({ length: 15 }, () => false));
  expect(f.outcomes.map((o) => (o.kind === 'deferred' ? o.why : o.kind)), 'each answered presence')
    .toEqual(Array.from({ length: 15 }, () => 'presence'));
  expect(f.requests.map((q) => q.licenceGeneration), 'each judged over G1').toEqual(Array.from({ length: 15 }, () => G(G1)));
  expect(f.calls, 'a presence-only episode: not one audit ran').toEqual([]);
  f.next();
};

describe('X1 at the lane: a licence judged over one generation never reaches a re-mint (spec §5.5, §5.7)', () => {
  it('the CONTROL: with no re-mint, the licence reaches ccd and reclaims G1', async () => {
    const f = laneFixture({ visible: () => true, ccd: model });
    await ripen(f);
    await f.pass();
    expect(f.requests[15]).toMatchObject({ deferExpired: true, licenceGeneration: G(G1) });
    expect(f.outcomes[15]).toMatchObject({ kind: 'reclaimed' });
    expect(f.calls.map((c) => c[0])).toEqual(['ws-audit', 'ws-reclaim']);
  });

  it('a re-mint BEFORE the sweep reads: the pass reads G2, the G1 episode is dropped, and the next ask is unlicensed over G2', async () => {
    const f = laneFixture({ visible: () => true, ccd: model });
    await ripen(f);
    f.remint('demo-a', G2);
    await f.pass();
    expect(f.requests, 'another generation is a first sighting: nothing is asked').toHaveLength(15);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(16);
    expect(f.requests[15]).toMatchObject({ deferExpired: false, licenceGeneration: G(G2) });
    expect(f.calls, 'presence still holds the new workspace: no argv').toEqual([]);
  });

  it('a re-mint BETWEEN the sweep’s read and the queue: the licensed request carries G1, and the executor’s re-read defers generation-changed before any argv', async () => {
    let armed = false;
    let f!: Lane;
    f = laneFixture({ visible: () => true, ccd: model,
      afterRead: (p) => { if (armed && path.basename(p) === 'demo-a.generation') { armed = false; f.remint('demo-a', G2); } } });
    await ripen(f);
    const l = await f.listing();
    armed = true;
    await f.sweepOn(l);
    expect(armed, 'the re-mint fell right after the sweep’s own read').toBe(false);
    expect(f.requests[15]).toMatchObject({ deferExpired: true, licenceGeneration: G(G1) });
    expect(f.outcomes[15]).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(f.calls, 'the licence never reached ccd').toEqual([]);
    f.next(); await f.pass();                                 // the sweep reads G2: a first sighting
    f.next(); await f.pass();
    expect(f.requests[16], 'G2 is asked unlicensed, from a fresh episode').toMatchObject({ deferExpired: false, licenceGeneration: G(G2) });
  });

  it('a re-mint WHILE the licensed request waits on the session’s queue: generation-changed, before any argv', async () => {
    const f = laneFixture({ visible: () => true, ccd: model });
    await ripen(f);
    let free!: () => void;
    const occupied = f.queue.run('demo-a', () => new Promise<void>((resolve) => { free = resolve; }));
    const passing = f.pass();
    await vi.waitFor(() => expect(f.requests).toHaveLength(16));   // queued behind the occupier
    f.remint('demo-a', G2);
    free(); await occupied; await passing;
    expect(f.requests[15]).toMatchObject({ deferExpired: true, licenceGeneration: G(G1) });
    expect(f.outcomes[15]).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(f.calls, 'the licence never reached ccd').toEqual([]);
  });
});
