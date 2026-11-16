// The Overlord W1 pool set, PR B2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`, Task 10). L4: the
// server's push when a box that places sessions has lost a capability word while a session on it carries the fact that
// needs it: below `pool-set`, a box's ccd ignores a standing set and serves every account (Table 3's fail-open row).
//
// THE TABLE. `CAP_FLOOR_FACTS` is the twin of `ccd/ccrc#CAP_FLOOR_ROWS`' `fact|word` columns, every row read, so a later
// piece that adds a floor row adds it here too (`pool-set-loss-lane.test.ts` pins the two equal). A fact is a route field
// (`RouteField`), because the server sees a session's facts through the registry's route read and nothing else.
//
// ONCE PER LOSS, an edge and never a level. The key (`poolSetLoss`) names the build and every lost word's sessions. This
// process keeps the last key it raised, so a tick with the same facts sends nothing even when the archive write failed;
// across a restart the archived key (`hasNotice`, read before the write) holds it. A store that cannot answer that read
// costs the dedupe only: a repeat beats silence (the build capture lane's rule). Every push goes through the notice
// funnel (`notify`), whose sender is the push outbox's and whose payload is `noticePayload`'s.
//
// `watch.ts` owns one of these and calls `check()` from its tick, after the registry read, on that read's records and the
// caps the `caps` lane last recorded (`FleetState.ccdVerbs`, in both modes). No clock, no poller, no lane schedule row.
import type { SessionRecord } from './registry.js';
import type { FleetState } from './fleetstate.js';
import type { WatcherCoordPort } from './coord/ports.js';
import { POOL_SET_CAP } from './ccdargv.js';
import { notify, type NoticeDeps } from './notice.js';
import { poolSetLoss, type CapFloorLoss, type CapFloorRow, type CapFloorSession } from './poolrule.js';

/** The capability floor's rows the server reads, the twin of `ccd/ccrc#CAP_FLOOR_ROWS` (fact and word only). */
export const CAP_FLOOR_FACTS: readonly CapFloorRow[] = [
  { fact: 'poolset', word: POOL_SET_CAP },
];

/** At most this many session ids are named per lost word in the push body; the rest are counted. */
const NAMED_MAX = 5;

export interface PoolSetLossLaneDeps extends NoticeDeps {
  readonly coord?: Pick<WatcherCoordPort, 'hasNotice' | 'recordFeedEvent'> | undefined;
  readonly fleetState?: Pick<FleetState, 'ccdVerbs' | 'build'> | undefined;
}

/** A record's route facts as the decider reads them: the fields read, and those listed but unreadable. */
const factsOf = (r: SessionRecord): CapFloorSession =>
  ({ id: r.id, fields: Object.keys(r.route?.fields ?? {}), unreadable: r.route?.unreadable ?? [] });

const named = (ids: readonly string[]): string =>
  ids.length <= NAMED_MAX ? ids.join(', ') : `${ids.slice(0, NAMED_MAX).join(', ')} and ${ids.length - NAMED_MAX} more`;

/** One lost word's sentence: which sessions carry its fact, and which of those could not be read. */
const lostSentence = (l: CapFloorLoss): string =>
  `its ccd lacks ${l.word} while a ${l.fact} stands for ${named(l.sessions)}`
  + (l.unreadable.length > 0 ? ` (unreadable for ${named(l.unreadable)})` : '');

export class PoolSetLossLane {
  /** The key this process last raised: the same facts on the next tick send nothing, whatever the archive did. */
  private lastKey: string | null = null;

  constructor(private readonly deps: () => PoolSetLossLaneDeps, private readonly rows: readonly CapFloorRow[] = CAP_FLOOR_FACTS) {}

  /** One check over this tick's registry records. Never throws: the tick calls it bare. */
  check(records: readonly SessionRecord[]): void {
    try {
      this.pass(records);
    } catch (err) {
      console.warn(`ccrc-server: pool set: loss check failed (${err instanceof Error ? err.message : String(err)}) — the next tick retries`);
    }
  }

  private pass(records: readonly SessionRecord[]): void {
    const d = this.deps();
    const fleet = d.fleetState;
    const v = poolSetLoss(this.rows, fleet?.ccdVerbs ?? null, records.map(factsOf), fleet?.build?.sha ?? null);
    if (!v.raise || v.dedupeKey === this.lastKey) return;
    this.lastKey = v.dedupeKey;
    try { if (d.coord?.hasNotice('coord', '', v.dedupeKey) === true) return; } catch { /* send it */ }
    const words = v.lost.map((l) => l.word).join(', ');
    // Session id '' (the precedent's reason): with a real one the funnel skips the record and the push while the operator
    // views that session, and the dedupe would not hold.
    notify(d, {
      kind: 'coord', sessionId: '', runId: null, title: `The fleet box lost ${words}`,
      body: `The box that places sessions no longer honours what stands on it: ${v.lost.map(lostSentence).join('; ')}. `
        + `Move it up to a release that carries ${words}; Settings shows each box's build.`,
    }, 'push', { tag: 'pool-set-lost', dedupeKey: v.dedupeKey, url: '/settings', lane: 'pool set', degraded: 'loss pushed, feed archive degraded' });
  }
}
