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
  // `'record-only'` never pushes, so presence decides nothing for it and is not consulted.
  const visible = mode !== 'record-only' && deps.presence?.isVisible(event.sessionId) === true;
  if (visible && mode === 'push') return { recorded: false, archived: 'none' };
  const log = deps.notifyLog;
  let recorded = false;
  let archived: NoticeOutcome['archived'] = 'none';
  if (log) {
    const ev = log.record(event);
    recorded = true;
    void log.flush();
    if (deps.coord) {
      try {
        deps.coord.recordFeedEvent(log.epoch, ev);
        archived = 'landed';
      } catch (err) {
        archived = 'failed';
        console.warn(`ccrc-server: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — `
          + (opts.degraded ?? NOTICE_DEGRADED_DEFAULT));
      }
    }
  }
  if (mode === 'record-only' || visible) return { recorded, archived };
  void deps.push?.notify({
    title: event.title, body: event.body, sessionId: event.sessionId,
    tag: opts.tag ?? `${event.kind}-${event.sessionId}`,
    ...(opts.actions ? { actions: opts.actions } : {}),
    ...(opts.url !== undefined ? { url: opts.url } : {}),
  });
  return { recorded, archived };
}

/** The composition root's one sink over its deps. */
export const noticeSink = (deps: NoticeDeps): NoticeSink => (event, mode, opts) => notify(deps, event, mode, opts);
