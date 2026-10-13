// Path identity W1a (spec §2.3): the temp-root collector's two id gates, pinned with no source change. The collector
// already refuses a dash-leading, dot-leading or over-long id twice before any argv:
// - the POPULATION gate (`collectPopulation`, `server/src/collectLane.ts`): a name under `$REG/tmproots` that fails
//   `isTmpRootId` is counted in `refusedNames` and never becomes an id. So the learning audit (`learnCollect`, which
//   asks no predicate of its own) never names it;
// - the EXECUTOR's step 1 (`collectTempRoot`, `server/src/coord/collectTempRoot.ts`): `isTmpRootId(job.id)` again, on
//   the job's own id, before `wsCollectAudit` or `wsCollect` is built.
// `isTmpRootId` derives from L0's `isRegistryId`, so these cases read the shared lists of `registryIdCases.ts`. They
// pass at once; their mutation rows are the proof.
// FIXTURE HOME ONLY: the lane case runs `collectLaneFixture.ts`'s scripted ccd, the executor cases
// `collectTempRootFixture.ts`'s. Nothing reaches a box.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  COLLECT_BOX_LABELS, REGISTRY_ID_MAX_CHARS, isTmpRootId, type ChildReclaimCollectAttention,
} from '../../shared/api.js';
import type { CollectPopulation } from '../src/collectLane.js';
import { collectTempRoot } from '../src/coord/collectTempRoot.js';
import { collectRig } from './collectLaneFixture.js';
import { rig } from './collectTempRootFixture.js';
import { EDGE_ACCEPTED_IDS, REDIRECT_IDS, REFUSED_IDS } from './registryIdCases.js';

afterEach(() => { vi.restoreAllMocks(); });

/** The refused ids a fixture HOME can hold as a witness file. A name longer than one file-name component cannot be
 *  created, so the 256-character case is pinned at the executor below, and in `collect-population.test.ts`'s pure
 *  table, and is never planted. */
const PLANTABLE: readonly string[] = REFUSED_IDS.filter((id) => id.length <= REGISTRY_ID_MAX_CHARS);

describe("the collector's two id gates (spec §2.3)", () => {
  it('a dash- or dot-leading witness name never reaches the learning audit', async () => {
    const f = await collectRig({ armed: true });
    for (const id of PLANTABLE) f.witness(id);
    f.witness('demo-a');                                    // the control: a witnessed id the same pass DOES audit
    await f.pass(); await f.settled();
    expect(f.audits().filter((c) => PLANTABLE.includes(c.id)).map((c) => c.id),
      'no ws-audit … --collect names a refused witness').toEqual([]);
    expect(f.audits().map((c) => c.id), 'the pass audited its one id').toEqual(['demo-a']);
    expect(f.collects(), 'and composed no act').toEqual([]);
    expect([...f.lane().entries.keys()], 'the lane remembers no refused name').toEqual(['demo-a']);
    // The count. Every dash-leading name is refused and counted. A dot-leading one is a writer's temp file by the
    // population's own rule, and is dropped before the gate, uncounted.
    const pop = (f.watcher as unknown as { collectPop: CollectPopulation | null }).collectPop;
    expect(pop?.ids, 'only the control became an id').toEqual(['demo-a']);
    expect(pop?.refusedNames, 'each dash-leading witness counts as a refused name').toBe(REDIRECT_IDS.length);
    const items = await f.attention();
    const prefix = `${REDIRECT_IDS.length} names under ${COLLECT_BOX_LABELS.tmproots} or `;
    const line = f.boxWide(items).find((a) => a.word === 'refused-names');
    expect(line?.sentence.slice(0, prefix.length), 'the refused-names line carries the count').toBe(prefix);
    const perId = items.filter((a): a is ChildReclaimCollectAttention =>
      a.kind === 'collect' && PLANTABLE.includes(a.sessionId));
    expect(perId, 'and no refused name is an item of its own').toEqual([]);
  });

  it.each([...REFUSED_IDS])('the executor refuses %s at step 1', async (id) => {
    expect(isTmpRootId(id), 'the case is one the predicate refuses').toBe(false);
    const r = rig();
    expect(await collectTempRoot(r.deps, { id })).toMatchObject({ kind: 'not-asked', step: 1, why: 'id-refused' });
    expect(r.attempts.filter((a) => a[0] === 'ws-audit'), 'no ws-audit').toEqual([]);
    expect(r.attempts.filter((a) => a[0] === 'ws-collect'), 'no ws-collect').toEqual([]);
    expect(r.attempts, 'no argv at all').toEqual([]);
    expect(r.lane.clears, 'a refused id clears no pair').toEqual([]);
  });

  it.each([...EDGE_ACCEPTED_IDS])('control: the executor audits %s as itself', async (id) => {
    expect(isTmpRootId(id), 'the case is one the predicate accepts').toBe(true);
    const r = rig();
    await collectTempRoot(r.deps, { id });
    expect(r.attempts[0]).toEqual(['ws-audit', '--session', id, '--collect']);
  });
});
