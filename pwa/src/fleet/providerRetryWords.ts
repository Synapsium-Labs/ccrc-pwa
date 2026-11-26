// The provider-failure ladder in the operator's words (wave 2; plan docs/superpowers/plans/2026-11-25-provider-retry.md). L1, C5:
// pure, the clock comes in. One spelling, read by the owners of the words it takes the place of: the row's and the header's status
// word (`sessionFacts.ts`, `sessionHeaderView.ts`) and the run row's "turn failed" and "quiet" (`runWords.ts#workerSeenNote`).
import type { FleetSession } from '../../../shared/api';
import { providerRetryOf } from '../../../shared/provider-retry-wire';
import { resetClock } from '../lib/clock';
import { paneGone } from './presence';

export interface ProviderRetryNote { readonly text: string; readonly title: string }

const HEAD: Readonly<Record<string, string>> = { overloaded: 'Provider overloaded' };
const OTHER_HEAD = 'Provider error';
const clockAt = (at: number, now: number): string | null => resetClock(Math.floor(at / 1000), new Date(now));

/** What a row says of its retry, or null when it says nothing: none known (`providerRetryOf`), or a pane that is not shown
 *  running. A time is promised only while nothing holds the retry: not when the server says none (`nextAt` null), and not while
 *  the row itself waits on the operator, which the next pass would find. */
export function providerRetryNote(s: Pick<FleetSession, 'status' | 'bucket' | 'providerRetry'>, now: number): ProviderRetryNote | null {
  const r = paneGone(s) ? null : providerRetryOf(s.providerRetry);
  if (r === null) return null;
  const head = r.err !== null && Object.hasOwn(HEAD, r.err) ? HEAD[r.err]! : OTHER_HEAD;
  const at = s.bucket === 'attention' ? null : r.nextAt;
  const since = r.attempts > 1 ? clockAt(r.since, now) : null;
  const title = `${since === null ? 'The turn ended on a provider error' : `${r.attempts} provider errors in a row since ${since}`}. `
    + 'ccrc tells the session to continue by itself'
    + (at === null ? ', but something holds that now: unsent text in its box, an open dialog, a question or a usage limit.' : '.');
  if (at === null) return { text: `${head}, retry waiting`, title };
  return { text: `${head}, retrying ${now >= at ? 'now' : clockAt(at, now) ?? 'now'}`, title };
}
