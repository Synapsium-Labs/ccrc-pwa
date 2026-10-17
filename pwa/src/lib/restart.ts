// `interrupt-and-restart-causes-recorded` (D-5237, spec 2026-10-16 §5.6): the
// one spelling of "restarted · out of memory · 3m ago", shared by the card's
// qualifier (`SessionMeta`) and the session header (`SessionHeader`). Shown for
// `LAST_END_SHOWN_MS` after the end (`recentLastEnd`, which also tolerates a
// live frame from a server that predates the field).
import { elapsedShort } from '@ccrc/ui';
import { RESTART_CAUSE_WORDS, recentLastEnd, type FleetSession } from '../../../shared/api';

export interface RestartWords { text: string; title: string; cause: keyof typeof RESTART_CAUSE_WORDS }

export function restartWords(s: Pick<FleetSession, 'lastEnd'>, now: number): RestartWords | null {
  const e = recentLastEnd(s, now);
  if (e === null) return null;
  const words = RESTART_CAUSE_WORDS[e.cause];
  const ago = elapsedShort(now - e.at);
  return {
    text: `restarted · ${words} · ${ago === null ? 'just now' : `${ago} ago`}`,
    title: `The previous process ended at ${new Date(e.at).toLocaleTimeString()}: ${words}.`,
    cause: e.cause,
  };
}
