// The Overlord W1 pool set, PR B2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`, Task 10). L4: the
// server's push when a box that places sessions has lost a capability word while a session on it carries the fact that
// needs it: below `pool-set`, a box's ccd ignores a standing set and serves every account (Table 3's fail-open row).
//
// THE TABLE. `CAP_FLOOR_FACTS` is the twin of `ccd/ccrc#CAP_FLOOR_ROWS`' `fact|word` columns, every row read, so a later
// piece that adds a floor row adds it here too (`pool-set-loss-lane.test.ts` pins the two equal). A fact is a route field
// (`RouteField`), because the server sees a session's facts through the registry's route read and nothing else.
//
// ONCE PER LOSS, an edge and never a level. A loss belongs to an EPISODE (fix round 1, F2): it opens on the first raising
// tick after a quiet one and closes on the next quiet measured tick, which archives a record-only clear notice, so the
// same build and sessions after a clear push again (`poolrule.ts#poolSetLossKey`). The episode's first push is keyed by
// the episode, which marks it open in the archive: a restart inside a loss reads that and sends nothing, folding a set or
// build that changed while it was down into the standing loss (slug `restart-folds-into-the-episode`). Within an episode
// a new build or a new set pushes again, keyed by its facts; this process keeps what it pushed, so the same facts send
// nothing even when the archive write failed. A store that cannot answer a read costs the dedupe only: a repeat beats
// silence (the build capture lane's rule). Every push goes through the notice funnel (`notify`), whose sender is the
// push outbox's and whose payload is `noticePayload`'s.
//
// `watch.ts` owns one of these and calls `check()` from its tick, after the registry read, on that read's records and the
// caps the `caps` lane last recorded (`FleetState.ccdVerbs`, in both modes). No clock, no poller, no lane schedule row.
import type { SessionRecord } from './registry.js';
import type { FleetState } from './fleetstate.js';
import type { WatcherCoordPort } from './coord/ports.js';
import { KEEP_AWAKE_CAP, POOL_SET_CAP } from './ccdargv.js';
import { notify, type NoticeDeps } from './notice.js';
import { LOSS_EPISODE_PROBE_MAX, poolSetClearKey, poolSetLoss, poolSetLossKey, type CapFloorLoss, type CapFloorRow, type CapFloorSession } from './poolrule.js';

/** The capability floor's rows the server reads, the twin of `ccd/ccrc#CAP_FLOOR_ROWS` (fact and word only). */
export const CAP_FLOOR_FACTS: readonly CapFloorRow[] = [
  { fact: 'poolset', word: POOL_SET_CAP },
  // The Overlord W1 ccd arms (X8): the ordered list is written for the Overlord's row only, by the designation's create,
  // which also sets its keep-awake markers, so it stands exactly while a box needs `ccd keep-awake`.
  { fact: 'acctorder', word: KEEP_AWAKE_CAP },
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
  /** The current loss episode, probed from the archive once (`null`: not yet, or the store could not answer). */
  private episode: number | null = null;
  /** Whether the episode has pushed (`null`: not yet read from the archive). */
  private open: boolean | null = null;
  /** The facts keys this process pushed in the episode: the same facts on a later tick send nothing, whatever the archive did. */
  private readonly pushed = new Set<string>();

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
    const caps = d.fleetState?.ccdVerbs ?? null;
    if (caps === null) return; // unmeasured: neither a loss nor its clear
    const v = poolSetLoss(this.rows, caps, records.map(factsOf), d.fleetState?.build?.sha ?? null);
    const n = this.episode ?? this.probe(d);
    if (!v.raise) { this.clear(d, n); return; }
    if (this.pushed.has(v.dedupeKey)) return;
    const open = this.isOpen(d, n);
    if (open && this.pushed.size === 0) { this.pushed.add(v.dedupeKey); return; } // a restart inside the loss
    const key = poolSetLossKey(n, open ? v.dedupeKey : null);
    let sent = false;
    try { sent = d.coord?.hasNotice('coord', '', key) === true; } catch { /* send it */ }
    const words = v.lost.map((l) => l.word).join(', ');
    // Session id '' (the precedent's reason): with a real one the funnel skips the record and the push while the operator
    // views that session, and the dedupe would not hold.
    if (!sent) {
      notify(d, {
        kind: 'coord', sessionId: '', runId: null, title: `The fleet box lost ${words}`,
        body: `The box that places sessions no longer honours what stands on it: ${v.lost.map(lostSentence).join('; ')}. `
          + `Move it up to a release that carries ${words}; Settings shows each box's build.`,
      }, 'push', { tag: 'pool-set-lost', dedupeKey: key, url: '/settings', lane: 'pool set', degraded: 'loss pushed, feed archive degraded' });
    }
    this.pushed.add(v.dedupeKey); // after the send (F6): a throw before it leaves the next tick to retry
    this.open = true;
  }

  /** The first episode with no archived clear; an unanswerable store answers 0 for this tick and is asked again. */
  private probe(d: PoolSetLossLaneDeps): number {
    try {
      let n = 0;
      while (n < LOSS_EPISODE_PROBE_MAX && d.coord?.hasNotice('coord', '', poolSetClearKey(n)) === true) n++;
      return (this.episode = n);
    } catch { return 0; }
  }

  /** Whether episode `n` has pushed, read from the archive once; an unanswerable store reads not open (a repeat beats silence). */
  private isOpen(d: PoolSetLossLaneDeps, n: number): boolean {
    if (this.open !== null) return this.open;
    try { return (this.open = d.coord?.hasNotice('coord', '', poolSetLossKey(n, null)) === true); } catch { return false; }
  }

  /** A quiet measured tick closes an open episode: a record-only notice archives its clear, and the next loss is new. */
  private clear(d: PoolSetLossLaneDeps, n: number): void {
    if (!this.isOpen(d, n)) return;
    notify(d, {
      kind: 'coord', sessionId: '', runId: null, title: 'The fleet box honours the capability floor again',
      body: 'No standing fact on the box that places sessions needs a capability word its ccd lacks; a later loss pushes again.',
    }, 'record-only', { dedupeKey: poolSetClearKey(n), lane: 'pool set', degraded: 'loss cleared, feed archive degraded' });
    this.episode = n + 1;
    this.open = false;
    this.pushed.clear();
  }
}
