// D12: no session-side heartbeat. renewClaims/lapseClaims ride FleetWatcher's
// EXISTING tick off rows it has already read; run close releases the run's
// claims INSIDE the close transaction; a live claim naming a closed run is
// the alarm `divergence.claim-orphan`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { CLAIM_LEASE_MS, CLAIM_HARD_CAP_MS, type Divergence } from '../../shared/api.js';

const NOW = 1_785_300_000_000;

afterEach(() => { vi.restoreAllMocks(); });

/** Move the watcher's clock. First call of each lane runs regardless (the
 *  `!== 0` first-sweep rule); later calls need the jump past CLAIM_SWEEP_MS. */
const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

const fixture = () => {
  const home = mkTmp('ccrc-claim-sweep-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const watcher = new FleetWatcher({ ...testDeps(home), cfg, io: localIO, coord } as never, bus, 10_000);
  const claim = (over: Partial<Parameters<CoordStore['claimAttempt']>[0]> = {}) => {
    const r = coord.claimAttempt({
      project: 'demo', paths: ['server/src/io.ts'], sessionId: 'demo-quiet-basin',
      uuid: 'u-1', runId: null, intent: 'measured-read seam', now: NOW, ...over,
    });
    if (!r.ok) throw new Error('fixture claim refused');
    return r.claims[0]!;
  };
  /** A registry row, `hold-gate.test.ts`'s idiom — what makes `demo` a
   *  project the divergence census asks about. */
  const plantRecord = (id: string): void => {
    const reg = path.join(home, '.cc-sessions');
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const running = (id: string) => ({ id, status: 'idle' as const, unmeasured: [] as const });
  return { home, cfg, coord, bus, watcher, claim, plantRecord, running,
           records: () => readRegistry(localIO, cfg) };
};

describe('the store-side sweep writers', () => {
  it('renewClaimRow re-arms a LIVE lease, never past the hard cap, never a lapsed row', () => {
    const h = fixture();
    const c = h.claim();
    h.coord.renewClaimRow(c.id, NOW + 600_000 + CLAIM_LEASE_MS, NOW + 600_000);
    expect(h.coord.activeClaims()[0]).toMatchObject(
      { renewedAt: NOW + 600_000, expiresAt: NOW + 600_000 + CLAIM_LEASE_MS });
    h.coord.renewClaimRow(c.id, NOW + CLAIM_HARD_CAP_MS + 999_999, NOW);
    expect(h.coord.activeClaims()[0]!.expiresAt).toBe(NOW + CLAIM_HARD_CAP_MS);
    h.coord.lapseClaimRow(c.id, 'session-gone', NOW + 1);
    h.coord.renewClaimRow(c.id, NOW + 2 * CLAIM_HARD_CAP_MS, NOW + 2);
    // not resurrected — and the dead row's lease RECORD did not move either
    // (renewedAt still the live renew's stamp): without the `state = 'live'`
    // guard the write is invisible through `expiresAt` (the MIN clamp already
    // pins that), so this is the assertion that sees it.
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', renewedAt: NOW });
  });

  it('lapseClaimRow LAPSES, NEVER DELETES — the row survives with endedAt/endedBy', () => {
    const h = fixture();
    const c = h.claim();
    h.coord.lapseClaimRow(c.id, 'session-gone', NOW + 5);
    expect(h.coord.activeClaims()).toEqual([]);
    expect(h.coord.claimsForProject('demo', true)).toHaveLength(1);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedAt: NOW + 5, endedBy: 'session-gone' });
  });
});

describe('run close releases the claims — inside the close transaction', () => {
  it('a successful close releases every live claim naming that run', () => {
    const h = fixture();
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    const closed = h.coord.closeRun({ runId: open.id, finalState: 'failed',
      causedBy: 'operator', handoffCommit: null, program: 'build9b', viaClosing: false });
    expect(closed.ok).toBe(true);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'released', endedBy: 'run-closed' });
  });

  it('a REFUSED close releases NOTHING — the release lives after the transition, in the same tx', () => {
    const h = fixture();
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    // planned has no `closing` edge — viaClosing:true refuses at the first hop
    const refused = h.coord.closeRun({ runId: open.id, finalState: 'done',
      causedBy: 'coordinator', handoffCommit: null, program: 'build9b', viaClosing: true });
    expect(refused.ok).toBe(false);
    expect(h.coord.activeClaims()).toHaveLength(1);        // still held
  });
});

describe('renewClaims / lapseClaims on the FleetWatcher tick', () => {
  it('a MEASURED-RUNNING holder is renewed', () => {
    const h = fixture();
    const c = h.claim();
    at(NOW + 600_000);
    h.watcher.renewClaims([h.running('demo-quiet-basin')]);
    expect(h.coord.activeClaims()[0]!.expiresAt).toBe(NOW + 600_000 + CLAIM_LEASE_MS);
    expect(h.coord.activeClaims()[0]!.id).toBe(c.id);
  });

  it('DOUBT READS AS HELD: an unmeasurable holder is renewed too — a fleet hiccup cannot mass-expire', () => {
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_LEASE_MS + 1);                          // past the lease…
    h.watcher.renewClaims([{ id: 'demo-quiet-basin', status: 'idle', unmeasured: ['uuid'] }]);
    h.watcher.lapseClaims([{ id: 'demo-quiet-basin', status: 'idle', unmeasured: ['uuid'] }]);
    expect(h.coord.activeClaims()).toHaveLength(1);        // …and still held
    expect(h.coord.activeClaims()[0]!.expiresAt).toBe(NOW + CLAIM_LEASE_MS + 1 + CLAIM_LEASE_MS);
  });

  it('DOUBT, END TO END: an unmeasurable holder rides through lease expiry AND the next attempt', () => {
    // The composed property the two halves guarantee together: the sweep
    // renews on doubt (D12), so a later claim attempt's in-tx expiry finds a
    // fresh lease and the doubted holder still wins the conflict.
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_LEASE_MS + 1);
    h.watcher.renewClaims([{ id: 'demo-quiet-basin', status: 'idle', unmeasured: ['uuid'] }]);
    const rival = h.coord.claimAttempt({
      project: 'demo', paths: ['server/src/io.ts'], sessionId: 'demo-calm-mesa',
      uuid: 'u-2', runId: null, intent: 'rival', now: NOW + CLAIM_LEASE_MS + 2,
    });
    expect(rival).toMatchObject({ ok: false, why: 'conflict' });
  });

  it("a GONE holder lapses at the STANDING expiresAt — 'session-gone', not at once", () => {
    const h = fixture();
    h.claim();
    at(NOW + 60_000);                                      // gone, but the lease still stands
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toHaveLength(1);
    at(NOW + CLAIM_LEASE_MS + 1);                          // the standing expiry has passed
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toEqual([]);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'session-gone' });
  });

  it('a DEAD pane reads gone — dead is a measurement, not doubt', () => {
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_LEASE_MS + 1);
    h.watcher.lapseClaims([{ id: 'demo-quiet-basin', status: 'dead', unmeasured: [] }]);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'session-gone' });
  });

  it("the HARD CAP lapses even a measured-running holder — doubt cannot hold forever", () => {
    const h = fixture();
    h.claim();
    at(NOW + CLAIM_HARD_CAP_MS + 1);
    h.watcher.renewClaims([h.running('demo-quiet-basin')]);   // must NOT resurrect
    h.watcher.lapseClaims([h.running('demo-quiet-basin')]);
    expect(h.coord.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'hard-cap' });
  });

  it('own clock: a second sweep inside CLAIM_SWEEP_MS does not act', () => {
    const h = fixture();
    at(NOW);
    h.watcher.lapseClaims([]);                             // first sweep runs (the !== 0 rule), arms the clock
    // a claim whose lease is ALREADY past due the next time anyone looks:
    const c = h.claim({ now: NOW - CLAIM_LEASE_MS - 1 });
    expect(c.expiresAt).toBeLessThan(NOW);
    at(NOW + 30_000);                                      // 30 s later: inside the interval
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toHaveLength(1);        // the gate held — no read, no lapse
    at(NOW + 60_001);                                      // past CLAIM_SWEEP_MS (module-private, 60 s)
    h.watcher.lapseClaims([]);
    expect(h.coord.activeClaims()).toEqual([]);            // now it acted: gone + expired => lapsed
  });

  it('runs with NO coord at all — the testDeps shape every watcher test depends on', () => {
    const home = mkTmp('ccrc-claim-sweep-');
    const w = new FleetWatcher(testDeps(home), new Bus(), 10_000);
    expect(() => { w.renewClaims([]); w.lapseClaims([]); }).not.toThrow();
  });
});

describe('sweepDivergences feeds claim-orphan from what it already read', () => {
  it('a live claim naming a closed run reaches the census', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin');
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    // The crash shape the alarm exists for: the run reached terminal WITHOUT
    // closeRun's release (simulated by writing the state directly).
    h.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(open.id);
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(seen.at(-1) ?? []).toContainEqual(
      expect.objectContaining({ kind: 'claim-orphan', id: 'demo-quiet-basin' }));
  });

  it('a RELEASED claim raises nothing — the ordinary close is quiet', async () => {
    const h = fixture();
    h.plantRecord('demo-quiet-basin');
    const open = h.coord.openRun({ program: 'build9b', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-calm-mesa' });
    if ('refused' in open) throw new Error('unreachable');
    h.claim({ runId: open.id });
    h.coord.closeRun({ runId: open.id, finalState: 'failed', causedBy: 'operator',
      handoffCommit: null, program: 'build9b', viaClosing: false });
    const seen: Divergence[][] = [];
    h.bus.on('divergence', (d: Divergence[]) => seen.push(d));
    await h.watcher.sweepDivergences(await h.records());
    expect(seen.at(-1) ?? []).not.toContainEqual(
      expect.objectContaining({ kind: 'claim-orphan' }));
  });
});
