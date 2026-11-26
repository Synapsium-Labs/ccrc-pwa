// The provider-failure ladder's beat (plan docs/superpowers/plans/2026-11-25-provider-retry.md). L4, context Coordination
// (C5). It runs inside the stall watch's pass, on the facts that pass already read for each live session, so it adds no timer and
// no marker read. `coord/providerRetry.ts` decides a session's nudge, `coord/providerOutage.ts` the operator's one notice; this
// queues the mail through the run-less notice door, takes a queued one back, sends the notice as the disk alarm lane does, and
// publishes what the console is told of each session (wave 2).
import type { SessionRecord } from './registry.js';
import type { FleetSession } from '../../shared/api.js';
import type { WatcherDeps } from './deps.js';
import type { WatcherCoordPort } from './coord/ports.js';
import { PROVIDER_RETRY_BODY, providerRetrySubject } from '../../shared/provider-retry.js';
import { type ProviderRetryWire } from '../../shared/provider-retry-wire.js';
import {
  PROVIDER_RETRY_WITHDRAWN, providerRetryArmed, providerRetryHoldsQuiet, providerRetryMailSince, providerRetryOwed, providerRetryVerdict, providerRetryWire,
} from './coord/providerRetry.js';
import { outageProviderOf, providerOutageStep, type OwingSession, type ProviderOutage } from './coord/providerOutage.js';
import { BACKLOG_HORIZON_MS, stallCurrentMark, stallMarkUnreadable, type StallArming, type StallSessionInput, type TurnMarkRead } from './coord/stall.js';
import type { StallResolved } from './coord/stallsettings.js';
import { queueRunlessNotice } from './coord/rundefsTx.js';
import { readOutageMarks, writeOutageMarks } from './providerOutageMark.js';
import { notify } from './notice.js';

type Deps = Pick<WatcherDeps, 'cfg' | 'coord' | 'notifyLog' | 'push' | 'viewers' | 'time' | 'masker'>;

export class ProviderRetryLane {
  private armed = false;
  /** The sessions that owed a retry when last measured. A session whose marker could not be read keeps its entry. */
  private readonly owing = new Map<string, OwingSession>();
  /** Sessions with a nudge this process queued and has not seen settled: their marker is read though it owes nothing now, so a
   *  queued nudge the session has moved past is taken back. */
  private readonly queued = new Set<string>();
  private outages: Map<string, ProviderOutage> | null = null;
  /** What the console is told, as the last pass said it, and what this one has said so far. A pass says it afresh, so a session
   *  no pass could judge is not said to be retrying. */
  private said: ReadonlyMap<string, ProviderRetryWire> = new Map();
  private saying = new Map<string, ProviderRetryWire>();

  constructor(private readonly deps: () => Deps) {}

  /** The pass's arming, resolved once. A stopped ladder says nothing from here on, whatever becomes of the pass. */
  begin(arming: StallArming, levelSource: StallResolved['levelSource']): void {
    this.armed = providerRetryArmed(arming, levelSource);
    this.saying = new Map();
    if (!this.armed) this.said = this.saying;
  }

  /** The map the fleet assembly reads (`FleetSession.providerRetry`). */
  wire(): ReadonlyMap<string, ProviderRetryWire> { return this.said; }

  /** The quiet ladder's fact for one worker. */
  holdsQuiet(mark: TurnMarkRead): boolean { return providerRetryHoldsQuiet(mark, this.armed); }

  /** Whether a registry row no other arm judges is worth its live read: it owes a retry, or a nudge of its is still out. */
  candidate(id: string, mark: Extract<TurnMarkRead, { readonly ok: true }>): boolean {
    return providerRetryOwed(mark) !== null || this.owing.has(id) || this.queued.has(id);
  }

  /** One live session: the outage's count, then the ladder's answer, applied. */
  judge(store: WatcherCoordPort, session: StallSessionInput, s: FleetSession | undefined, rec: SessionRecord | undefined, now: number): void {
    const id = session.sessionId;
    this.measure(id, session, s);
    const since = providerRetryMailSince(session.mark, now);
    let si = session;
    if (since < now - BACKLOG_HORIZON_MS) {
      const read = store.stallMailFor(id, [], since);
      if (!read.ok) { console.warn(`ccrc-server: provider-retry ${id} mail unreadable (${read.kind}: ${read.detail}) — held this sweep`); return; }
      si = { ...session, mail: read.mail, deliveries: read.deliveries };
    }
    const input = { session: si, archived: (s?.archivedAt ?? null) !== null, hibernated: (rec?.hibernatedAt ?? null) !== null, armed: this.armed };
    const told = providerRetryWire(input, now);
    if (told !== null) this.saying.set(id, told);
    const v = providerRetryVerdict(input, now);
    if (v.act === 'withdraw') {
      const w = store.rejectDelivery(v.deliveryId, 'undeliverable', PROVIDER_RETRY_WITHDRAWN);
      if (!w.changed) console.warn(`ccrc-server: provider-retry delivery ${v.deliveryId}: withdraw refused (${w.state})`);
      this.queued.delete(id);
    } else if (v.act === 'nudge') {
      const q = queueRunlessNotice(store, { toId: id, kind: 'status', subject: providerRetrySubject(v.dueAt), body: PROVIDER_RETRY_BODY, wake: 'never' });
      if (q.queued) this.queued.add(id);
    } else if (v.act === 'none') {
      if (session.mark.ok && providerRetryOwed(session.mark) === null) this.queued.delete(id);
    }
  }

  /** The session's place in the outage count. An unreadable marker or live read keeps what was last measured. */
  private measure(id: string, session: StallSessionInput, s: FleetSession | undefined): void {
    if (stallMarkUnreadable(session.mark)) return;
    if (session.mark.ok && (session.worker.present !== true || !session.worker.live.ok)) return;
    const mark = stallCurrentMark(session);
    const owed = mark === null ? null : providerRetryOwed(mark);
    if (owed === null || s === undefined) { this.owing.delete(id); return; }
    this.owing.set(id, { provider: outageProviderOf(s.wrapper, this.deps().cfg.roster.byId.get(s.wrapper)?.telemetry), at: owed.at, since: owed.since });
  }

  /** The end of a pass: a session with no live pane owes nothing, and the outage steps. An unarmed pass raises nothing. */
  end(live: (id: string) => boolean, now: number): void {
    this.said = this.saying;
    for (const id of [...this.owing.keys()]) if (!live(id)) this.owing.delete(id);
    for (const id of [...this.queued]) if (!live(id)) this.queued.delete(id);
    if (!this.armed) return;
    const d = this.deps();
    const standing = this.outages ?? new Map(readOutageMarks(d.cfg.ccrcDir).map((m): [string, ProviderOutage] =>
      [m.key, { since: m.since, lastOwedAt: now, name: m.name, offered: false }]));
    const step = providerOutageStep(standing, [...this.owing.values()], now);
    this.outages = new Map(step.next);
    if (step.notices.length === 0) return;
    // The mark BEFORE the push, so a restart between the two finds it.
    writeOutageMarks(d.cfg.ccrcDir, [...step.next].map(([key, o]) => ({ key, name: o.name, since: o.since })));
    for (const n of step.notices) {
      try { if (d.coord?.hasNotice('coord', '', n.dedupeKey) === true) continue; } catch { /* send it: a repeat beats silence */ }
      notify(d, { kind: 'coord', sessionId: '', runId: null, title: n.title, body: n.body }, n.mode,
        { tag: `provider-outage-${n.key}`, dedupeKey: n.dedupeKey, degraded: 'feed archive degraded, ring/push unaffected' });
    }
  }
}
