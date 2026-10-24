// L1 policy (D-6799): which sessions a run's spend is added up over, and the
// sum. Pure — the sweep file is read by `shares.ts`, the route only calls this.
import type { RunSpend } from '../../../shared/api.js';
import type { SessionSpendRead } from '../shares.js';

/** `routes.ts`'s open route writes `session-rebound: <predecessor> -> <heir>, <n>
 *  re-issued` when a run's worker changes (the one writer of that detail). */
const REBOUND = /^session-rebound: (\S+) -> (\S+), \d+ re-issued$/;

/** Every session this run has had bound: the predecessors its rebound events
 *  name, in order, then the current one, each once. A session bound to a second
 *  run (a worker reused across waves) is counted in each run it served — the
 *  sweep groups by session, not by run, so the figure is the spend of the run's
 *  sessions, an upper bound on the run's own. */
export function boundSessionsOf(current: string | null, events: readonly { detail: string | null }[]): string[] {
  const out: string[] = [];
  const push = (id: string): void => { if (!out.includes(id)) out.push(id); };
  for (const e of events) {
    const m = e.detail === null ? null : REBOUND.exec(e.detail);
    if (m !== null) { push(m[1]!); push(m[2]!); }
  }
  if (current !== null) push(current);
  return out;
}

export function joinRunSpend(sessionIds: readonly string[], read: SessionSpendRead): RunSpend {
  if (sessionIds.length === 0) return { measured: false, reason: 'no-session' };
  if (read.kind === 'absent') return { measured: false, reason: 'no-sweep' };
  if (read.kind === 'unreadable') return { measured: false, reason: 'unreadable' };
  if (read.kind === 'malformed') return { measured: false, reason: 'malformed' };
  const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let proxyUsd = 0; let seen = 0;
  for (const id of sessionIds) {
    const s = read.bySession[id];
    if (s === undefined) continue;
    seen += 1;
    tokens.input += s.tokens.input; tokens.cacheWrite += s.tokens.cacheWrite;
    tokens.cacheRead += s.tokens.cacheRead; tokens.output += s.tokens.output;
    proxyUsd += s.proxyUsd;
  }
  if (seen === 0) return { measured: false, reason: 'not-swept' };
  return { measured: true, tokens, proxyUsd, measuredAt: read.measuredAt };
}
