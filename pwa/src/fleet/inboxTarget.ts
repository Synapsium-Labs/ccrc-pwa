// Where an Inbox record leads (D-5585, U3's model). Pure: P4's rows navigate to
// `path`, and a `none` row says `why` instead of looking tappable.
//
// A record opens its SESSION when the fleet still lists it. Archived rows are
// listed (`archivedAt` set, bucket `archived`) and `/s/:id` opens an archived
// session's page, so an archived session is a target like any other. Failing
// that, a record that names a run the board can show opens the RUN BOARD: a
// run has no route of its own until F3's drill-down (W4). Otherwise it leads
// nowhere, and says why in one word.
//
// The run is read through `eventRunId`, never off the record directly: that is
// the render boundary `NotifyEvent.runId`'s own comment (shared/api.ts) fixes,
// for a store row that reached a renderer without crossing the wire's reviver.
//
// THE FIELD MAP (Step 0), from each kind's server writer. "session" is whether
// `sessionId` names one (a non-empty id) or is `''`; "run" is whether the
// writer can fill `runId` with a number (`pushOne` folds an omitted `runId`
// into null).
//
//   kind       sessionId                         runId
//   ask        the asking session                null (`pushOne` omits it; server.ts passes null)
//   done       the finished session              null
//   merged     the session whose PR merged       null
//   mail       the recipient (or the blocked     the mail's run, or null
//              sender); never ''
//   run        the run's session; the            the run's id; null on the
//              stop-done sweep's and the         archived-expiry rows
//              archived-expiry rows name theirs
//   coord      '' (a config change)              null
//   update     '' (a leased update move)         null
//   queue      the landing workspace's session   the dequeued run's id, or null
//   interrupt  the interrupted session           null
//   nudge      the nudged session                null
//   unknown    whatever a newer server sent: never recorded by the server; a
//              newer kind degraded on revival, so any of the above shapes
//
// So `sessionId` is empty exactly for `coord` and `update` (and possibly
// `unknown`), and only `mail`, `run` and `queue` carry a run.
import type { FleetSession, NotifyEvent, RunSummary } from '../../../shared/api';
import { eventRunId } from '../lib/feed';

export type InboxTarget =
  | { readonly kind: 'session'; readonly path: string }
  | { readonly kind: 'runs'; readonly path: '/runs' }
  | { readonly kind: 'none'; readonly why: 'session gone' | 'no target' };

export function inboxTarget(
  ev: NotifyEvent,
  sessionsById: ReadonlyMap<string, FleetSession>,
  runsById: ReadonlyMap<number, Pick<RunSummary, 'id'>>,
): InboxTarget {
  const named = ev.sessionId !== '';
  if (named && sessionsById.has(ev.sessionId)) {
    return { kind: 'session', path: `/s/${encodeURIComponent(ev.sessionId)}` };
  }
  const run = eventRunId(ev);
  if (run !== null && runsById.has(run)) return { kind: 'runs', path: '/runs' };
  return { kind: 'none', why: named ? 'session gone' : 'no target' };
}
