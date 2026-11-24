// D-5857 `notify-funnel` (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1c;
// ARCH-54 (#789); spec K6). The ONE way a notice is raised: the presence gate, the ring record, its flush, the guarded
// archive and the push, in that order, owned here instead of hand-written beside each writer.
//
// - The ring (`NotifyLog`) is the catch-up authority (O11 (a)). The caller's record object is handed to it UNCHANGED, so
//   each writer's key order reaches catch-up exactly as it builds it.
// - The archive (`CoordStore.recordFeedEvent`) mirrors a ring record: with no `notifyLog` there is no `{epoch, seq}` to
//   mirror, and a feed row that mirrors nothing is not an archive of anything. With no `coord` the ring and catch-up
//   still work. `node:sqlite` throws SYNCHRONOUSLY (a full disk, a held write lock), so the archive is guarded: a failure
//   costs the archive row only, never the ring or the push, and prints the writer's own degrade sentence.
// - The push happens only in `'push'` and `'record-always'`, and never for a session the operator is looking at.
//
// SYNCHRONOUS: the archive has landed or failed when `notify` returns, so a caller can act on `NoticeOutcome` (a batch
// writer stops at its first failed archive). The flush is a chained async write; where it sits relative to the archive
// is unobservable (spec K6, rev 2.1). `NotifyLog.record` is in-memory and cannot throw.
import type { NotifyEvent } from '../../shared/api.js';
import type { NotifyLog } from './notifylog.js';
import type { CoordStore } from './coord/store.js';
import type { PayloadMasker, PushPayload } from './push.js';
import { noticePayload, noticeTitle, pushDue, type PushDue } from './pushOutbox.js';
import { outboxSettledOf, senderFor, type BoundRowTarget, type OutboxStorePort, type SettledOf } from './pushSender.js';
import type { QuestionOutbox, QuestionPush, Questions } from './coord/questions.js';
import type { TimePorts } from './time/ports.js';
import type { ResponseStamp } from '../../shared/responses.js';
import type { Viewers } from './viewer.js';
import type { Bus } from './bus.js';

/** The record gate and the push: the three combinations a writer can reach (there is no record-unless-visible-and-never-
 *  push writer).
 *  - `'push'`: record and push, both only when no one is looking at the session (`ask`, `done`, `merged`).
 *  - `'record-always'`: record whatever the presence (a message the operator watching must not erase); push only when
 *    no one is looking.
 *  - `'record-only'`: record whatever the presence; never push. */
export const NOTICE_MODES = ['push', 'record-always', 'record-only'] as const;
export type NoticeMode = typeof NOTICE_MODES[number];

/** D-5858: the modes are spelled as literals by every writer that calls the sink, `coord/routes.ts`'s five among them,
 *  so the coord kebab scan (`mail-routes.test.ts`) admits them through this guard, derived from the table above. */
export const isNoticeMode = (tok: string): tok is NoticeMode => (NOTICE_MODES as readonly string[]).includes(tok);

/** The ring record as the caller builds it. */
export type NoticeRecord = Omit<NotifyEvent, 'seq' | 'at'>;

export interface NoticeOpts {
  /** The push's collapse key; the default is `${kind}-${sessionId}`. */
  readonly tag?: string;
  readonly actions?: PushPayload['actions'];
  /** A same-origin path the service worker opens on tap (`PushPayload.url`). */
  readonly url?: string;
  /** The writer's degrade sentence: the text after `— ` in the archive-failure warning. */
  readonly degraded?: string;
  /** D-7041 (departure `notice-lane-prefix`): the writer's lane, printed after `ccrc-server: ` in the archive-failure
   *  warning (`ccrc-server: stop-done: recordFeedEvent failed (…) — …`). Absent, the line is the funnel's own. */
  readonly lane?: string;
  /** D-5860: the notice's once-only key, archived beside its row (`CoordStore.hasNotice` reads it). Passed through to
   *  the archive and nothing else: the funnel never suppresses the ring or the push on it, and the archive refuses
   *  nothing; whether to raise the notice at all is the caller's read, made before the write. */
  readonly dedupeKey?: string;
  /** The push outbox (Overlord W1, Task 4): a bound row its move already wrote, with the `pushDue` answer and the presence
   *  answer read once before the move, and the read `sendRow` re-asks before the claim. With it the funnel reads no
   *  presence and asks no `pushDue`: `viewing` is the record gate, as presence is for an unbound notice whatever the
   *  push service (review 2150 F1), and on `now` the row is sent. */
  readonly bound?: { readonly row: BoundRowTarget; readonly due: PushDue; readonly viewing: boolean; readonly settledOf: SettledOf };
  /** An approval push's source (`approval:<n>` or `census:<n>`, approvals plan 2026-11-18, Task 1.4), kept on its outbox
   *  row. It decides nothing here. */
  readonly source?: string;
}

/** What happened: whether the ring recorded it, and the archive's fate (`'none'`: no `notifyLog` or no `coord`, or
 *  nothing was recorded). */
export interface NoticeOutcome {
  readonly recorded: boolean;
  readonly archived: 'landed' | 'failed' | 'none';
}

/** The sinks, each independently optional. */
export interface NoticeDeps {
  readonly notifyLog?: NotifyLog | undefined;
  /** The archive, and the push outbox's members the sender reads when present (`pushSender.ts#OutboxStorePort`). */
  readonly coord?: (Pick<CoordStore, 'recordFeedEvent'> & Partial<OutboxStorePort>) | undefined;
  /** Widened from `Pick<PushService, 'notify'>` (the push outbox, Task 3): `PushService.notify` answers a
   *  `PushSendVerdict`, which the sender reads, and a double that answers `void` still types. */
  readonly push?: { notify(p: PushPayload): Promise<unknown>; readonly payloadMasker?: PayloadMasker } | undefined;
  readonly viewers?: Pick<Viewers, 'isVisible'> | undefined;
  /** The sender's clock, scheduler and chance (`Deps.time`); without them a push is sent with no row. */
  readonly time?: TimePorts | undefined;
  /** The wired masker (`Deps.masker`); absent, the sender masks with the shape-only one, as `PushService` is built. */
  readonly masker?: PayloadMasker | undefined;
  /** The response record's stamp (`Deps.responseStamp`, Overlord W1): with it, a push this funnel sends gets a response
   *  row; without it, none (slug no-stamp-no-response-row). */
  readonly responseStamp?: (() => ResponseStamp) | undefined;
}

/** The port a writer outside `watch.ts` receives: `notify` bound to the composition root's sinks. */
export type NoticeSink = (event: NoticeRecord, mode: NoticeMode, opts?: NoticeOpts) => NoticeOutcome;

/** `pushOne`'s degrade sentence, the default for a writer that names none. */
export const NOTICE_DEGRADED_DEFAULT = 'feed archive degraded, ring/push unaffected';

/** Raise one notice (D-5857). See the module comment for the order and the guard. */
export function notify(deps: NoticeDeps, event: NoticeRecord, mode: NoticeMode, opts: NoticeOpts = {}): NoticeOutcome {
  return raise(deps, event, mode, opts, true);
}

/** D-5859: raise a batch of notices (departure `funnel-batch-one-flush`), each through `notify`'s gate, ring, guarded
 *  archive and push, for a writer that writes several rows in one try (`endDeadCoordinator.ts`): the batch STOPS at
 *  its first failed archive, so the rows after it reach neither the ring nor the archive and the caller's sentence is
 *  printed once, and the ring is flushed once, after the records. The outcome is the batch's: `recorded` if any row
 *  was, `archived` the failed row's `'failed'`, else `'landed'` if any row's archive landed, else `'none'`.
 *  D-5860: a batch carries no once-only key (one key on every row would make each row "already sent" for the others),
 *  so `dedupeKey` is not in its opts and is stripped if forced in. */
export function notifyEach(
  deps: NoticeDeps, events: readonly NoticeRecord[], mode: NoticeMode, batchOpts: Omit<NoticeOpts, 'dedupeKey'> = {},
): NoticeOutcome {
  const { dedupeKey: _unkeyed, ...opts } = batchOpts as NoticeOpts;
  let recorded = false;
  let archived: NoticeOutcome['archived'] = 'none';
  try {
    for (const event of events) {
      const out = raise(deps, event, mode, opts, false);
      recorded ||= out.recorded;
      if (out.archived !== 'none') archived = out.archived;
      if (out.archived === 'failed') break;
    }
  } finally {
    if (recorded) void deps.notifyLog?.flush();
  }
  return { recorded, archived };
}

/** The gate, the ring record (flushed after it when `flush`; a batch flushes once itself), the guarded archive and the
 *  push for one notice. */
function raise(deps: NoticeDeps, event: NoticeRecord, mode: NoticeMode, opts: NoticeOpts, flush: boolean): NoticeOutcome {
  // `'record-only'` never pushes, so presence decides nothing for it and is not consulted. A bound row's presence was
  // asked once, before its move (slug presence-read-once), and its answer is the gate.
  const bound = opts.bound;
  const visible = mode !== 'record-only'
    && (bound === undefined ? deps.viewers?.isVisible(event.sessionId) === true : bound.viewing);
  if (visible && mode === 'push') return { recorded: false, archived: 'none' };
  const log = deps.notifyLog;
  let recorded = false;
  let archived: NoticeOutcome['archived'] = 'none';
  if (log) {
    const ev = log.record(event);
    recorded = true;
    if (flush) void log.flush();
    if (deps.coord) {
      try {
        // ONE call line: the feed-writer ratchet (D-5859) counts call lines. No key, no third argument.
        deps.coord.recordFeedEvent(log.epoch, ev, ...(opts.dedupeKey === undefined ? [] : [opts.dedupeKey] as const));
        archived = 'landed';
      } catch (err) {
        archived = 'failed';
        console.warn(`ccrc-server: ${opts.lane === undefined ? '' : `${opts.lane}: `}recordFeedEvent failed (${
          err instanceof Error ? err.message : String(err)}) — ` + (opts.degraded ?? NOTICE_DEGRADED_DEFAULT));
      }
    }
  }
  if (mode === 'record-only' || visible) return { recorded, archived };
  if (bound !== undefined) {
    if (bound.due.due === 'now') senderFor(deps).sendRow(bound.row, bound.settledOf);
    return { recorded, archived };
  }
  // The payload's one builder (the push outbox, Task 2): the default tag or the caller's, and `actions` and `url` when given.
  const due = pushDue({ event: 'reach', service: deps.push !== undefined, source: 'none', blocking: true, viewing: visible,
    settled: false, superseded: false, payload: true });
  // The notifier kind is the push's response-row label (Overlord W1, questions 2 and 18).
  if (due.due === 'now') senderFor(deps).send(noticePayload(event, opts), { label: event.kind, ...(opts.source === undefined ? {} : { source: opts.source }) });
  return { recorded, archived };
}

/** D-6732 (ARCH-59 (#794)): a push that is no `NotifyEvent`, for the two writers that have no ring row to make.
 *  - The `notify.sh` banner's model-class push (`POST /api/notify` with `push: true`). Its missing feed record is a
 *    residual of W2 that D-5211 states, and no `NotifyEvent` kind fits a model-class line (a new kind widens
 *    `shared/api.ts`'s union and the PWA's per-kind tables).
 *  - The new-release push (`FleetWatcher.pushRelease`, D-3296): a release has no session, so there is nothing for the
 *    presence gate to ask and no row to keep. Its once-per-release guard is the caller's persisted mark.
 *  So it takes neither the gate, the ring nor the archive: passing through here gates NOTHING. The caller's policy has
 *  already decided it is pushable, and this only sends it, through the one sender (`pushSender.ts`), as every push is.
 *  A rejected send is logged under `failed` (the text before ` (reason)`) and never thrown, because the caller has
 *  already answered. */
export function notifyPushOnly(deps: Pick<NoticeDeps, 'push' | 'coord' | 'time' | 'masker'>, payload: PushPayload, failed: string): void {
  senderFor(deps).send(payload, { failed });
}

/** D-6732 (ARCH-59 (#794)): the `notify.sh` banner, the bus frames `POST /api/notify` raises. A banner is a
 *  transient channel the open sockets read, not a ring record: it writes no `NotifyLog` row and no archive row, and it
 *  has no presence gate (it reaches every open console). It is ONE global `notice` frame, and for a
 *  `cc swap: <id> moved <from> -> <to>` line a second frame on the moved session's own stream, after the global one, so
 *  that session's chat surfaces the account change inline. The route authenticates and parses, and this is the only
 *  writer of either frame (the census in `notify-push.test.ts` reds if `server.ts` emits a `notice` again). */
export function noticeBanner(deps: { readonly bus: Pick<Bus, 'emit'> }, message: string): void {
  deps.bus.emit('notice', { message });
  const swap = /^cc swap: (\S+) moved (\S+) -> (\S+)/.exec(message);
  if (swap) deps.bus.emit(`session:${swap[1]}`, { type: 'notice', message });
}

/** The questions owner's push outbox (Overlord W1, Task 5, F8) over a funnel's deps. `prepare` builds today's ask
 *  payload (`noticeTitle` over the active projects, then `noticePayload`), prepares it through the sender, and asks
 *  `pushDue` once, with presence read here (slug presence-read-once). `sent` records the ask with its bound row and
 *  sends that row on `now`: through `raise` when given (the watcher's `pushOne`), else through this funnel's `notify`
 *  with today's ask record (a composition with no watcher, whose own instance never holds an ask). */
export function questionOutboxOf(
  deps: NoticeDeps & { readonly coord?: Pick<CoordStore, 'itemById'> | undefined }, questions: () => Pick<Questions, 'askSettled'>,
  projects: () => ReadonlySet<string> = () => new Set(),
  raise?: (ev: QuestionPush, bound: NonNullable<NoticeOpts['bound']>) => void,
): QuestionOutbox {
  const settledOf = outboxSettledOf({ askSettled: (id) => questions().askSettled(id) }, deps.coord);
  return {
    prepare: (ev) => {
      const payload = ev === null ? null : noticePayload({ ...ev, title: noticeTitle(ev.title, ev.project, projects()) },
        ev.actions === undefined ? {} : { actions: ev.actions });
      const prepared = senderFor(deps).prepare(payload);
      const viewing = ev !== null && deps.viewers?.isVisible(ev.sessionId) === true;
      return { prepared, viewing, stamp: deps.responseStamp?.(), due: pushDue({ event: 'reach', service: prepared.service, source: 'ask', blocking: true, viewing,
        settled: false, superseded: false, payload: payload !== null }) };
    },
    sent: (ev, askId, row) => {
      const bound = { row: { id: row.id, source: 'ask' as const, sourceId: askId }, due: row.due, viewing: row.viewing, settledOf };
      if (raise !== undefined) { raise(ev, bound); return; }
      notify(deps, { kind: ev.kind, sessionId: ev.sessionId, runId: null, title: noticeTitle(ev.title, ev.project, projects()),
        body: ev.body }, 'push', { ...(ev.actions === undefined ? {} : { actions: ev.actions }), bound });
    },
  };
}

/** The composition root's one sink over its deps. */
export const noticeSink = (deps: NoticeDeps): NoticeSink => (event, mode, opts) => notify(deps, event, mode, opts);
