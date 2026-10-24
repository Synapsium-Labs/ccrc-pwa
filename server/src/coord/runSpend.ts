// L1 policy (D-6799): which sessions a run's spend is added up over, and the
// sum. Pure — the sweep file is read by `shares.ts`, the route only calls this.
import type { RunSpend } from '../../../shared/api.js';
import type { SessionSpendRead } from '../shares.js';

/** `routes.ts`'s open route writes `session-rebound: <predecessor> -> <heir>, <n>
 *  re-issued` when a run's worker changes (the one writer of that detail). */
const REBOUND = /^session-rebound: (\S+) -> (\S+), \d+ re-issued$/;

/** The workspace-spent path (`dispatch.ts` calling `store.clearSession`) nulls the
 *  run's session and journals `session-unbound: <id> (workspace-spent #<pr>)`; the
 *  next dispatch binds a fresh session with no predecessor, so no rebound event
 *  follows. The unbound id is the only trace that session ever served this run. */
const UNBOUND = /^session-unbound: (\S+) \(/;

/** Every session this run has had bound: those its rebound and unbound events
 *  name, in journal order, then the current one, each once. A session bound to a
 *  second run (a worker reused across waves) is counted in each run it served —
 *  the sweep groups by session, not by run — so the figure can OVER-count a run
 *  whose worker was reused. It can also UNDER-count: see the sweep's own note on
 *  which uuids it can attribute. It is a measurement of the sessions' spend, not
 *  an exact per-run figure. */
export function boundSessionsOf(current: string | null, events: readonly { detail: string | null }[]): string[] {
  const out: string[] = [];
  const push = (id: string): void => { if (!out.includes(id)) out.push(id); };
  for (const e of events) {
    if (e.detail === null) continue;
    const m = REBOUND.exec(e.detail);
    if (m !== null) { push(m[1]!); push(m[2]!); continue; }
    const u = UNBOUND.exec(e.detail);
    if (u !== null) push(u[1]!);
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
