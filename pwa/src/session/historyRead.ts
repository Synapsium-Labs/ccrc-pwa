// What a pane-history READ turned out to be — the four states the drawer's
// history layer can sit in, and the two pure readings that produce the last
// two of them.
//
// The reasoning came out of `TerminalDrawer.openHistory`, where it was wrapped
// around a request counter and two state guards. Those stay there: they are
// about THIS drawer's refs and which answer is still wanted. What is here is
// the part that only ever looked at the reply.
import type { PaneHistoryReply } from '../../../shared/api';
import { ApiError } from '../lib/api';
import type { HistoryPane } from './terminalFactory';

export type Hist =
  | { at: 'live' }
  | { at: 'reading' }
  | { at: 'history'; text: string; lines: number; pane?: HistoryPane }
  | { at: 'empty'; why: string; detail?: string };

/**
 * NOTHING ABOVE THE SCREEN IS NOT A HISTORY. `capture-pane` answers with the
 * visible screen even when no line has ever scrolled off, so a successful read
 * alone would put up a second copy of what the reader is already looking at —
 * with an empty scrollbar on it and a wheel that moves nothing. Measured on
 * this fleet: four of ten live panes hold no scrollback at all.
 *
 * The COUNT decides, never the screen the pane is on: a pane on the alternate
 * screen keeps the scrollback it already had (measured on a private socket —
 * 453 stored lines still captured at `alternate_on=1`), so refusing on that
 * flag would hide a real history behind a full-screen app. The flag only says
 * a zero will stay zero while the app is up.
 *
 * `=== 0` and not `!r.scrollback`: an older server omits the field and an
 * unmeasurable pane sends nothing, and neither is a zero. Both keep the
 * behaviour this drawer shipped with.
 *
 * ABSENT IS NOT ZERO, one last time: only a probe that answered `ok` gives the
 * reader two numbers to size itself by, and an older server or an unmeasurable
 * pane leaves it on the `lines * 3` fallback that shipped before either field
 * existed.
 */
export function histFromPane(r: Extract<PaneHistoryReply, { ok: true }>): Hist {
  if (r.scrollback === 0) {
    return {
      at: 'empty',
      why: r.alternate === true
        ? 'a full-screen app is up — nothing scrolls off while it is'
        : 'nothing has scrolled off this pane yet',
    };
  }
  const pane = typeof r.scrollback === 'number' && typeof r.width === 'number'
    ? { history: r.scrollback, width: r.width }
    : undefined;
  return { at: 'history', text: r.text, lines: r.lines, pane };
}

/**
 * WHY, not just "failed": a dead pane, a tmux that could not answer and an
 * unreachable box are three different facts to the reader, and the server
 * already told them apart. `ApiError.body` carries the route's own word for it
 * AND, for a 502, the tmux message underneath.
 */
export function histFromReadError(e: unknown): Hist {
  const body = e instanceof ApiError ? (e.body as { error?: unknown; detail?: unknown }) : null;
  const why = typeof body?.error === 'string' ? body.error : 'unreachable';
  const detail = typeof body?.detail === 'string' ? body.detail : undefined;
  return { at: 'empty', why, detail };
}
