// D-7319 (operator ruling 2026-10-29): a run whose dispatch never came back is abandoned by the server, not left for
// the operator to abandon by hand. This file is the L0 half of that act: its Settings switch's vocabulary and wire view,
// its default bound, and the words the PWA's Automation card shows. L0: the PWA bundles `shared/`, so this file takes no
// value import and no `node:` module; its one import is a type from `./agent-protocol.js`, erased at build. It sits outside
// `shared/api.ts` for `stall-watch.ts`'s reason: other programmes append at that file's foot.
import type { ReadFailure } from './agent-protocol.js';

/** The switch's two stored choices (`dispatch_abandon_settings.choice`). Only an exact `on` arms the act: a token a
 *  newer build writes reads here as not armed, never as on. The seed is `on` (the ruling: default ON). */
export const DISPATCH_ABANDON_CHOICES = ['on', 'off'] as const;
export type DispatchAbandonChoice = (typeof DISPATCH_ABANDON_CHOICES)[number];
export function isDispatchAbandonChoice(v: unknown): v is DispatchAbandonChoice {
  return typeof v === 'string' && (DISPATCH_ABANDON_CHOICES as readonly string[]).includes(v);
}

/** How long a `planned` run may carry a `dispatchStartedAt`, with no session bound, before the server abandons it:
 *  the default of `CCRC_DISPATCH_ABANDON_MS`. Fifteen minutes. The console calls such a dispatch stalled at
 *  `SPAWN_STALL_MS` (6 min); this waits two and a half times that, and three times the `ws-add` verb ceiling the runner
 *  and the agent enforce (300 s), so no `ws-add` started at that stamp can still be running when the act reads it. */
export const DISPATCH_ABANDON_DEFAULT_MS = 900_000;

/** What the server read of the switch, on the wire (`GET /api/coord/dispatch-abandon`).
 *  - `stored`: the row's choice as this build reads it; `unknown` is a row whose token this build does not know,
 *    `absent` a lost row, `unreadable` a read that failed (`detail` says why). Each is its own answer: the card shows
 *    them differently, and none of them arms the act.
 *  - `armed`: whether the act runs, which is `stored === 'on'` and nothing else.
 *  - `boundMs`: the configured bound (`CCRC_DISPATCH_ABANDON_MS`).
 *  - `updatedAt`: the row's last write (epoch ms; 0 is the seed), or null when there is no row to read. */
export interface DispatchAbandonView {
  stored: DispatchAbandonChoice | 'unknown' | ReadFailure;
  detail: string | null;
  armed: boolean;
  boundMs: number;
  updatedAt: number | null;
}

/** `POST /api/coord/dispatch-abandon`'s body. */
export interface DispatchAbandonRequest { choice: DispatchAbandonChoice }

/** The codes the POST refuses with, spelled once. */
export const DISPATCH_ABANDON_REFUSALS = ['bad-request', 'not-configured', 'state-unreadable'] as const;
export type DispatchAbandonRefusal = (typeof DISPATCH_ABANDON_REFUSALS)[number];
export function isDispatchAbandonRefusal(v: unknown): v is DispatchAbandonRefusal {
  return typeof v === 'string' && (DISPATCH_ABANDON_REFUSALS as readonly string[]).includes(v);
}

/** The `run_events.detail` prefix the act journals beside the close, so a run's trail tells this abandon from the
 *  operator's and from the dead-coordinator lane's (all three close `failed`). */
export const DISPATCH_ABANDON_EVENT = 'dispatch-abandoned:never-came-back';

/** D-7563: the `run_events.detail` prefix the same pass journals when it BINDS a run to the one child workspace that came
 *  back for it (its `.child` marker names the run, its pane is live, no run names it yet), so the trail tells that bind
 *  from a dispatch's own. Followed by `session=<id> started=<ms>`. */
export const DISPATCH_BIND_EVENT = 'dispatch-bound:returned-child';

/** The mail's subject: one kebab word, the server's other mail subjects' shape. */
export const DISPATCH_ABANDON_SUBJECT = 'dispatch-abandoned';

/** The coordinator's mail body: what was abandoned, why, and what to do. */
export function dispatchAbandonMailBody(m: {
  runId: number; program: string; wave: number; project: string; startedAt: number; boundMs: number;
}): string {
  const minutes = Math.round(m.boundMs / 60_000);
  return `Run #${m.runId} (${m.program}, wave ${m.wave}, project ${m.project}) was abandoned by the server: its dispatch `
    + `started at ${new Date(m.startedAt).toISOString()} and never came back. After ${minutes} min no workspace names `
    + 'the run and no dispatch for it is still running, so the run is closed failed. '
    + 'Open a new run and dispatch it again if the work is still wanted.';
}

/** The Automation card's words (settings spec §5.4's shape: a title, a purpose, a legend, a note per choice; the scope is
 *  Settings' own `SETTINGS_SCOPE.fleet`). */
export const DISPATCH_ABANDON_TEXT = {
  title: 'Dispatches that never came back',
  purpose: 'A run whose dispatch never came back shows "spawn never completed" on its project card. With this on, '
    + 'the server abandons such a run by itself and mails its coordinator so it can dispatch again.',
  legend: 'Abandon dispatches that never came back',
  on: 'On',
  onNote: 'A planned run whose dispatch started longer ago than the bound, with no workspace for it and no dispatch '
    + 'still running, is abandoned once, its reason journaled, and its coordinator mailed. A run whose one child '
    + 'workspace did come back, with its pane live, is bound to that workspace instead, and the bind journaled.',
  off: 'Off',
  offNote: 'Such a run is left as it is, for you to abandon from Runs.',
  pauseNote: 'Pause all cleanup stops it too while the pause stands.',
  unknown: 'The server holds a choice this build does not know, so nothing is abandoned. Choose On or Off to replace it.',
  absent: 'The server has no stored choice, so nothing is abandoned. Choose On or Off to store one.',
  unreadable: 'The server could not read the switch, so nothing is abandoned.',
  unread: 'Could not read the switch from the server.',
  stale: 'Showing the last answer; the latest read failed.',
  unanswered: 'No answer from the server, so the choice may have been saved; the screen will re-check.',
  refused: 'The server refused the change, so nothing was changed.',
  bound: (text: string): string => `It waits ${text} from the dispatch's start (CCRC_DISPATCH_ABANDON_MS on the server).`,
} as const;
