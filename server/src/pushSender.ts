// THE ONE SENDER (Overlord spec §6.7 "Pushes go through an outbox", §4.3 C67; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md`, Task 4). Context C6. Its ring is the funnel's
// (`notice.ts`), by its facts: every effect it has (the store, the push service, the clock, the scheduler, chance) is
// reached through the deps it is handed, never imported, so the funnel may call it (slug sender-ring-is-the-funnels).
//
// Every Web Push the server sends goes through here, and this file holds the ONE `PushService.notify` call
// (`notify-push.test.ts` counts it). A push becomes a row of `push_outbox` (`coord/pushOutboxStore.ts`): an unbound push is
// written claimed (`sending`) and sent at once; a bound row (an ask or an item that reached the operator, written `pending`
// by the move that raised it) is re-read, claimed and sent. Each attempt's verdict lands only on the claim it answers
// (`claimSeq`), so no attempt is ever sent twice (slug a-claimed-row-is-never-sent-again). The lane row `pushOutbox` drains
// what is due, and `bootPushOutbox`, run once by `index.ts` before anything can push, seals what a dead process left.
//
// Decide in L1, act here: `pushDue`, `outboxNextState` and `outboxBootVerdict` (`pushOutbox.ts`) decide; this file gathers
// their facts, asks them, and writes what they answer.
//
// Per-call deps (slug per-call-deps): the `WeakMap` below, keyed on the push service, holds only per-service state (the
// change latch and the attempts in flight). `coord`, `time` and `masker` are read from the deps each call is given, so
// no caller's deps fix another caller's behaviour.
import { changeLatch, type ChangeLatch } from './changeLatch.js';
import type { CoordStore } from './coord/store.js';
import type { BoundOf, BoundWrite, OutboxPayload, OutboxRow } from './coord/pushOutboxStore.js';
import type { NeededBy } from '../../shared/ledgers.js';
import {
  OUTBOX_KEEP_MS, OUTBOX_SEND_DEADLINE_MS, PUSH_ID_BYTES, type OutboxSource, type PushSendVerdict,
} from '../../shared/push-outbox.js';
import type { PayloadMasker, PushPayload } from './push.js';
import {
  asSendVerdict, itemPushPayload, outboxBootVerdict, outboxNextState, pushDue, type PreparedPush, type PushDueFacts,
} from './pushOutbox.js';
import type { Clock, TimePorts } from './time/ports.js';

/** The outbox members the sender reaches, declared by this consumer (a `Pick` of `CoordStore`, as `WatcherCoordPort` is). */
export type OutboxStorePort = Pick<CoordStore,
  | 'claimOutboxRow' | 'dueOutboxRows' | 'firstBootAt' | 'heldItemsReached' | 'insertUnboundRow' | 'markFirstBoot'
  | 'markOutboxVerdict' | 'openOutboxRows' | 'purgeOutbox' | 'reachHeldItem' | 'sealAtBoot' | 'silenceOutboxRow' | 'supersededUnbound'>;

/** The deps every funnel site already passes, read at each call. */
export interface SenderDeps {
  /** The funnel's own type, so a double that answers `void` still types (F10). `payloadMasker` is the masker the
   *  service masks with (`PushService`'s); a double without one has its payloads sent unmasked, as before. */
  readonly push?: { notify(p: PushPayload): Promise<unknown>; readonly payloadMasker?: PayloadMasker } | undefined;
  /** The store; one without every outbox member (a narrow double, a narrower port) sends with no row. Read by `portOf`. */
  readonly coord?: object | undefined;
  /** Every production funnel site carries it; a caller without it sends with no row and no deadline timer. */
  readonly time?: TimePorts | undefined;
  /** Absent until `index.ts` sets it: meanwhile the push service's own masker (the shape-only one it is built with). */
  readonly masker?: PayloadMasker | undefined;
}

/** A bound row's source as it stands at the claim: settled (answered, withdrawn, closed, or an item the operator ticked),
 *  and its level now, so a lowered item's retry is silenced (review 2150 F2, slug claim-rereads-the-level). */
export interface SourceNow { readonly settled: boolean; readonly blocking: boolean }
/** A bound row's source re-read through its owner, or null when the read failed (the row is left for the next drain). */
export type SettledOf = (source: OutboxSource, sourceId: number) => SourceNow | null;
/** A bound row by id, with its source, which `sendRow` re-reads before each attempt (slug re-read-before-claim). */
export interface BoundRowTarget { readonly id: number; readonly source: OutboxSource; readonly sourceId: number }

export interface PushSender {
  /** Mask the payload and mint its push id. No I/O, so a caller may run it inside its transaction. With no push service
   *  it still mints the id and answers `payload: null, service: false` (F4). Throws without time ports: a bound caller
   *  always holds them. */
  prepare(payload: PushPayload | null): PreparedPush;
  /** An unbound push: insert it claimed, send it now. `failed` is the caller's sentence for a rejected send. */
  send(payload: PushPayload, opts?: { readonly failed?: string }): void;
  /** A bound row its raising or arming transaction wrote `pending`: re-read its source, claim it, send it now. */
  sendRow(row: BoundRowTarget, settledOf: SettledOf): void;
  /** The lane's pass: the held items' reach, every due row sent in parallel, the purge. Resolves when the pass's attempts
   *  have landed or timed out. */
  drain(now: number, settledOf: SettledOf): Promise<void>;
  /** Resolves once every attempt now in flight for this push service has landed (its verdict, its deadline or its
   *  rejection). */
  idle(): Promise<void>;
}

/** Per push service (or, on a box with none, per store, so a standing read failure there is latched too; review 2150
 *  F10): the latch that logs a standing failure once per cause, and the attempts in flight. */
interface ServiceState { readonly latch: ChangeLatch<string>; readonly inflight: Set<Promise<void>> }
const SERVICES = new WeakMap<object, ServiceState>();
function serviceState(push: object): ServiceState {
  let st = SERVICES.get(push);
  if (st === undefined) { st = { latch: changeLatch<string>(), inflight: new Set() }; SERVICES.set(push, st); }
  return st;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Every member of `OutboxStorePort`, spelled once as a record's keys, so a member added to the port and not here is TS2741. */
const OUTBOX_MEMBER_MAP: Readonly<Record<keyof OutboxStorePort, true>> = {
  claimOutboxRow: true, dueOutboxRows: true, firstBootAt: true, heldItemsReached: true, insertUnboundRow: true, markFirstBoot: true,
  markOutboxVerdict: true, openOutboxRows: true, purgeOutbox: true, reachHeldItem: true, sealAtBoot: true, silenceOutboxRow: true,
  supersededUnbound: true,
};
const OUTBOX_MEMBERS = Object.keys(OUTBOX_MEMBER_MAP) as (keyof OutboxStorePort)[];
/** The store as the outbox port, or null when the deps' `coord` lacks a member (a narrow double, or none at all). */
function portOf(coord: object | undefined): OutboxStorePort | null {
  if (coord === undefined) return null;
  const c = coord as Partial<OutboxStorePort>;
  return OUTBOX_MEMBERS.every((m) => typeof c[m] === 'function') ? c as OutboxStorePort : null;
}

/** The sender for one call's deps. A thin view: nothing here outlives the call but the per-service state. */
export function senderFor(deps: SenderDeps): PushSender {
  const push = deps.push;
  const keyed: object | undefined = push ?? deps.coord;
  const st = keyed === undefined ? null : serviceState(keyed);
  const port = portOf(deps.coord);
  const time = deps.time;
  const masker: PayloadMasker = deps.masker ?? push?.payloadMasker ?? { maskDeep: (v) => v };
  const warnByCause = (cause: string, line: string): void => {
    if (st === null || st.latch.changed(cause)) console.warn(`ccrc-server: push outbox: ${line}`);
  };

  /** One attempt of one payload. With a row, its verdict (or a deadline's null, or a rejection's null) lands on the row
   *  by `claimSeq` through `outboxNextState`; with none, the send is today's. Never rejects. */
  const attempt = (payload: PushPayload, row: { id: number; claimSeq: number; attempts: number; armedAt: number } | null,
    failed?: string): Promise<void> => {
    if (push === undefined || st === null) return Promise.resolve();
    let sent: Promise<unknown>;
    // A double that answers no promise (a bare mock) is read as an answer, never as a throw: today's funnel tolerated it.
    try { sent = Promise.resolve(push.notify(payload)); } catch (e) { sent = Promise.reject(e); }
    let cancel: (() => void) | null = null;
    let settle!: () => void;
    const done = new Promise<void>((resolve) => { settle = resolve; });
    let landed = false;
    const land = (v: PushSendVerdict | null): void => {
      if (landed) return;
      landed = true;
      cancel?.();
      if (row !== null && port !== null && time !== undefined) {
        const at = time.clock.wall();
        const next = outboxNextState(v, row, at);
        try {
          // The move's shape follows the decider: `sent` and `retrying` always carry the verdict that decided them.
          const move = next.to === 'retrying' ? { to: next.to, verdict: v!, nextAttemptAt: next.nextAttemptAt }
            : next.to === 'sent' ? { to: next.to, verdict: v! } : { to: next.to, verdict: v };
          port.markOutboxVerdict(row.id, row.claimSeq, move, at);
        } catch (e) {
          warnByCause(`verdict:${message(e)}`,
            `the verdict of row ${row.id} was not written (${message(e)}); the row stays sending and the next boot seals it unknown`);
        }
      }
      settle();
    };
    if (row !== null && time !== undefined) cancel = time.scheduler.after(OUTBOX_SEND_DEADLINE_MS, () => { land(null); });
    sent.then((x) => { land(asSendVerdict(x)); }, (err: unknown) => {
      if (failed !== undefined) console.warn(`${failed} (${message(err)})`);
      land(null);
    });
    st.inflight.add(done);
    void done.then(() => { st.inflight.delete(done); });
    return done;
  };

  /** A row: its source re-read (an unbound row's: whether a newer push replaced it), `pushDue` at the claim, then the
   *  claim and the attempt. A lost claim is normal. */
  const sendBound = (row: BoundRowTarget | { id: number; source: null; sourceId: null }, settledOf: SettledOf): Promise<void> => {
    if (port === null || time === undefined) return Promise.resolve();
    const src = row.source === null ? { settled: false, blocking: true } : settledOf(row.source, row.sourceId);
    if (src === null) return Promise.resolve();              // the read failed: the next drain reads again
    const at = time.clock.wall();
    let claim: ReturnType<OutboxStorePort['claimOutboxRow']>;
    try {
      const due = pushDue({ event: 'claim', service: push !== undefined, source: row.source ?? 'none', blocking: src.blocking,
        viewing: false, settled: src.settled, superseded: row.source === null && port.supersededUnbound(row.id), payload: true });
      if (due.due === 'silent') { port.silenceOutboxRow(row.id, due.why, at); return Promise.resolve(); }
      claim = port.claimOutboxRow(row.id, at);
    } catch (e) {
      warnByCause(`claim:${message(e)}`, `row ${row.id} was neither claimed nor silenced (${message(e)}); the next drain reads it again`);
      return Promise.resolve();
    }
    if (!claim.changed) return Promise.resolve();            // a drain or a boot won it
    if (claim.payload !== null) return attempt(claim.payload, { id: row.id, ...claim });
    try {
      port.markOutboxVerdict(row.id, claim.claimSeq, { to: 'failed', verdict: null }, at);
      warnByCause(`payload:${row.id}`, `row ${row.id} was claimed with no readable payload and is sealed failed`);
    } catch (e) {
      warnByCause(`verdict:${message(e)}`, `row ${row.id} was claimed with no readable payload and its seal was not written `
        + `(${message(e)}); the next boot seals it unknown`);
    }
    return Promise.resolve();
  };

  const sender: PushSender = {
    prepare(payload) {
      if (time === undefined) throw new Error('push outbox: prepare needs the time ports');
      const pushId = time.entropy.hex(PUSH_ID_BYTES);
      if (push === undefined || payload === null) return { payload: null, pushId, service: push !== undefined };
      return { payload: masker.maskDeep(payload), pushId, service: true };
    },
    send(payload, opts = {}) {
      if (push === undefined || st === null) return;          // no push service: no row and no send, as today
      const masked = masker.maskDeep(payload);
      let row: { id: number; claimSeq: number; attempts: number; armedAt: number } | null = null;
      if (port !== null && time !== undefined) {
        const at = time.clock.wall();
        let w: ReturnType<OutboxStorePort['insertUnboundRow']>;
        try {
          w = typeof masked.tag === 'string'
            ? port.insertUnboundRow({ pushId: time.entropy.hex(PUSH_ID_BYTES), payload: masked as OutboxPayload, at })
            : { ok: false, detail: 'the payload has no tag' };
        } catch (e) { w = { ok: false, detail: message(e) }; }
        if (w.ok) { st.latch.clear(); row = { id: w.id, claimSeq: w.claimSeq, attempts: 1, armedAt: at }; }
        else warnByCause(`insert:${w.detail}`, `${w.detail} — the push is sent with no row`);
      }
      void attempt(masked, row, opts.failed);
    },
    sendRow(row, settledOf) { void sendBound(row, settledOf); },
    async drain(now, settledOf) {
      if (port === null || time === undefined) return;
      reachHeldItems(port, now, push !== undefined, () => time.entropy.hex(PUSH_ID_BYTES), warnByCause);
      const due = port.dueOutboxRows(now);
      if (!due.ok) { warnByCause(`due:${due.detail}`, `${due.detail}; the next drain reads again`); return; }
      // The boot's horizon, applied again here, so a row the boot pass could not seal is never sent stale (review 2150 F6):
      // such a row is failed by the boot pass's own seal (slug drain-applies-the-boot-horizon).
      const failStale = (id: number): Promise<void> => {
        try { port.sealAtBoot(id, 'failed', now); } catch (e) {
          warnByCause(`stale:${message(e)}`, `the stale row ${id} was not failed (${message(e)}); the next drain tries again`);
        }
        return Promise.resolve();
      };
      await Promise.all(due.rows.map((r) => (pastHorizon(r, now) ? failStale(r.id) : sendBound(targetOf(r), settledOf))));
      port.purgeOutbox(now - OUTBOX_KEEP_MS);
    },
    idle() {
      return st === null ? Promise.resolve() : Promise.all([...st.inflight]).then(() => undefined);
    },
  };
  return sender;
}

/** Whether the boot's verdict fails a due row now (`outboxBootVerdict`, the horizon's one rule). */
const pastHorizon = (r: OutboxRow, now: number): boolean => (r.state === 'pending' || r.state === 'retrying')
  && outboxBootVerdict({ state: r.state, armedAt: r.armedAt }, now) === 'fail-stale';

const targetOf = (r: OutboxRow): BoundRowTarget | { id: number; source: null; sourceId: null } =>
  (r.sourceKind === null || r.sourceId === null ? { id: r.id, source: null, sourceId: null }
    : { id: r.id, source: r.sourceKind, sourceId: r.sourceId });

/** The held drain (slug item-held-until-is-a-hold): every held item whose hold has passed, shown to the operator and
 *  not stamped, gets its stamp, at its `heldUntil` (review 2150 F3), and one `silent` row in one transaction each.
 *  `pushDue` on `held` never answers `now` (slug held-drain-is-silent), so this sends nothing; an answer it does not
 *  expect leaves the item unstamped and is logged once (review 2150 F10). */
function reachHeldItems(port: OutboxStorePort, now: number, service: boolean, mint: () => string,
  warnByCause: (cause: string, line: string) => void): void {
  const first = port.firstBootAt();
  if (first === null) return;                                // the boot pass has not run: no stamp before it
  const held = port.heldItemsReached(now, first);
  if (!held.ok) { warnByCause(`held:${held.detail}`, `${held.detail}; the next drain reads again`); return; }
  for (const item of held.rows) {
    const due = pushDue({ event: 'held', service, source: 'item', blocking: item.neededBy === 'blocking', viewing: false,
      settled: false, superseded: false, payload: true });
    switch (due.due) {
      case 'silent':
        try { port.reachHeldItem(item.id, mint(), due.why, item.heldUntil); } catch (e) {
          warnByCause(`reach:${message(e)}`, `the held item ${item.id} was not stamped (${message(e)}); the next drain retries`);
        }
        break;
      case 'now':
        warnByCause('held:now', `pushDue answered now for the held item ${item.id}, which the held drain never sends; it is left unstamped`);
        break;
      default: { const unknown: never = due; void unknown; }
    }
  }
}

/** The boot pass (slug boot-after-the-store-opens), run once by `index.ts`, synchronously, right after the store opens and
 *  the landing replay passes, before anything can push: so every `sending` row it finds belongs to a process that died.
 *  It writes `firstBootAt` if absent, then seals each open row by `outboxBootVerdict`: a claimed attempt `unknown`, a
 *  stale row `failed`, and the rest are left for the first drain. A row it cannot read is still sealed by state and id.
 *  A failed read logs and seals nothing; the drain applies the same horizon to every due row. */
export function bootPushOutbox(coord: OutboxStorePort, clock: Clock): void {
  const now = clock.wall();
  let open: ReturnType<OutboxStorePort['openOutboxRows']>;
  try { coord.markFirstBoot(now); open = coord.openOutboxRows(); } catch (e) { open = { ok: false, detail: message(e) }; }
  if (!open.ok) { console.warn(`ccrc-server: push outbox: the boot pass read nothing (${open.detail})`); return; }
  // One row's failed seal never stops the rest (review 2150 F6); the drain fails a stale row the boot left.
  const seal = (id: number, to: 'unknown' | 'failed'): void => {
    try { coord.sealAtBoot(id, to, now); } catch (e) {
      console.warn(`ccrc-server: push outbox: the boot pass did not seal row ${id} ${to} (${message(e)})`);
    }
  };
  for (const row of open.rows) {
    if (row.state !== 'pending' && row.state !== 'sending' && row.state !== 'retrying') continue;
    const v = outboxBootVerdict({ state: row.state, armedAt: row.armedAt }, now);
    if (v === 'seal-unknown') seal(row.id, 'unknown');
    else if (v === 'fail-stale') seal(row.id, 'failed');
  }
  for (const bad of open.unreadable) seal(bad.id, 'unknown');
}

/** An item's bound write (Overlord W1 Task 5): its push copy (`itemPushPayload`, the one item copy), prepared through
 *  the sender, and `pushDue`'s answer for the event. An item's notice has no session, so it is never viewed. */
export function itemBoundOf(deps: SenderDeps, item: { readonly title: string; readonly neededBy: NeededBy },
  event: Extract<PushDueFacts['event'], 'reach' | 'arm'>): BoundOf {
  return (id): BoundWrite => {
    const prepared = senderFor(deps).prepare(itemPushPayload(id, item.title));
    return { prepared, viewing: false, due: pushDue({ event, service: prepared.service, source: 'item',
      blocking: item.neededBy === 'blocking', viewing: false, settled: false, superseded: false, payload: true }) };
  };
}

/** The `settledOf` read every bound send uses: an ask is unsettled while released or declined and not answered, read
 *  through the questions owner, and always pushes; an item only while the operator waits on it, `open`, as
 *  `shared/ledgers.ts#waitingCount` counts it (a ticked item, `checking`, is the coordinator's), at its level now
 *  (review 2150 F2). A failed read answers null. */
export function outboxSettledOf(questions: { askSettled(askId: number): boolean | null },
  coord: Pick<CoordStore, 'itemById'> | undefined): SettledOf {
  return (source, sourceId) => {
    if (source === 'ask') {
      const settled = questions.askSettled(sourceId);
      return settled === null ? null : { settled, blocking: true };
    }
    if (coord === undefined) return null;
    try {
      const item = coord.itemById(sourceId);
      return item === null ? { settled: true, blocking: false } : { settled: item.state !== 'open', blocking: item.neededBy === 'blocking' };
    } catch { return null; }
  };
}

/** The outbox view a route or a lane is handed: the deps the sender reads, and the re-read its bound sends use. */
export interface OutboxView { readonly deps: SenderDeps; readonly settledOf: SettledOf }
