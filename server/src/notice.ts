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
import type { PushPayload, PushService } from './push.js';
import type { Presence } from './presence.js';
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
  /** D-5860: the notice's once-only key, archived beside its row (`CoordStore.hasNotice` reads it). Passed through to
   *  the archive and nothing else: the funnel never suppresses the ring or the push on it, and the archive refuses
   *  nothing; whether to raise the notice at all is the caller's read, made before the write. */
  readonly dedupeKey?: string;
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
  readonly coord?: Pick<CoordStore, 'recordFeedEvent'> | undefined;
  readonly push?: Pick<PushService, 'notify'> | undefined;
  readonly presence?: Pick<Presence, 'isVisible'> | undefined;
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
  // `'record-only'` never pushes, so presence decides nothing for it and is not consulted.
  const visible = mode !== 'record-only' && deps.presence?.isVisible(event.sessionId) === true;
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
        console.warn(`ccrc-server: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — `
          + (opts.degraded ?? NOTICE_DEGRADED_DEFAULT));
      }
    }
  }
  if (mode === 'record-only' || visible) return { recorded, archived };
  sendPush(deps.push, {
    title: event.title, body: event.body, sessionId: event.sessionId,
    tag: opts.tag ?? `${event.kind}-${event.sessionId}`,
    ...(opts.actions ? { actions: opts.actions } : {}),
    ...(opts.url !== undefined ? { url: opts.url } : {}),
  });
  return { recorded, archived };
}

/** D-TBD-banner-funnel (ARCH-59 (#794)): a push that is no `NotifyEvent`, for the one writer that has no ring row to
 *  make: the `notify.sh` banner's model-class push (`POST /api/notify` with `push: true`). D-5211 rules a feed record
 *  out for it, and no `NotifyEvent` kind fits a model-class line (a new kind widens `shared/api.ts`'s union and the
 *  PWA's per-kind tables), so it takes neither the gate, the ring nor the archive: the caller's policy has already
 *  decided it is pushable, and this only sends it. The push is the funnel's, so the one `PushService.notify` call for a
 *  notice stays in this file. A rejected send is logged under `failed` (the text before ` (reason)`) and never thrown,
 *  because the caller has already answered. */
export function notifyPushOnly(deps: Pick<NoticeDeps, 'push'>, payload: PushPayload, failed: string): void {
  sendPush(deps.push, payload, failed);
}

/** D-TBD-banner-funnel (ARCH-59 (#794)): the `notify.sh` banner, the bus frames `POST /api/notify` raises. A banner is a
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

/** The ONE `PushService.notify` call in this file (the census in `notify-push.test.ts` counts it). `failed` names the
 *  caller's sentence for a rejected send; `raise` names none and keeps its send unguarded, as it always was. */
function sendPush(push: NoticeDeps['push'], payload: PushPayload, failed?: string): void {
  const sent = push?.notify(payload);
  if (failed !== undefined) {
    void sent?.catch((err: unknown) => {
      console.warn(`${failed} (${err instanceof Error ? err.message : String(err)})`);
    });
  }
}

/** The composition root's one sink over its deps. */
export const noticeSink = (deps: NoticeDeps): NoticeSink => (event, mode, opts) => notify(deps, event, mode, opts);
