/**
 * THE PROVIDER OUTAGE'S ONE NOTICE (the provider-failure ladder, wave 1, D-TBD-provider-retry-notice; plan
 * `docs/superpowers/plans/2026-11-25-provider-retry.md`). L1, pure: it decides which notice is due, and
 * `providerRetryLane.ts` (L4) sends it in the disk alarm lane's shape.
 *
 * One notice per PROVIDER per outage, never one per session: an outage stops many sessions at once and the retries are
 * ccrc's own, so the operator needs the fact and no act. Raised when PROVIDER_OUTAGE_SESSIONS sessions owe a retry on one
 * provider within PROVIDER_OUTAGE_WINDOW_MS; cleared, record-only, when none has owed one for PROVIDER_OUTAGE_CLEAR_MS.
 */
export const PROVIDER_OUTAGE_SESSIONS = 3;
export const PROVIDER_OUTAGE_WINDOW_MS = 10 * 60_000;
export const PROVIDER_OUTAGE_CLEAR_MS = 10 * 60_000;

/** The provider a lane's turns run on: every lane of the Anthropic array is one provider, every lane of the Codex array is
 *  another (the roster's `telemetry`, which is what those two arrays are generated from), and any other lane is its own. */
export interface OutageProvider { readonly key: string; readonly name: string }
export function outageProviderOf(lane: string, telemetry: string | undefined): OutageProvider {
  if (telemetry === 'anthropic') return { key: 'anthropic', name: 'Anthropic' };
  if (telemetry === 'codex') return { key: 'codex', name: 'Codex' };
  return { key: `lane:${lane}`, name: lane };
}

/** A session that owes a retry, and when its newest failure was. */
export interface OwingSession { readonly provider: OutageProvider; readonly at: number }
/** A standing outage: when it was raised, when a session last owed a retry on it, and whether this process has offered its
 *  notice. One resumed from its durable mark has not: the notice is offered once more under its first key, and the lane's
 *  once-only read drops it when it was archived, so a server that stopped between the mark and the push still tells. */
export interface ProviderOutage { readonly since: number; readonly lastOwedAt: number; readonly name: string; readonly offered: boolean }
export type ProviderOutages = ReadonlyMap<string, ProviderOutage>;
export interface ProviderOutageNotice {
  readonly mode: 'push' | 'record-only'; readonly key: string; readonly dedupeKey: string; readonly title: string; readonly body: string;
}

const minutes = (ms: number): string => `${ms / 60_000} minutes`;
const raised = (key: string, o: Pick<ProviderOutage, 'since' | 'name'>): ProviderOutageNotice => ({
  mode: 'push', key, dedupeKey: `provider-outage:${key}:${o.since}`, title: `${o.name} is returning errors`,
  body: `${PROVIDER_OUTAGE_SESSIONS} or more sessions stopped on a provider error within ${minutes(PROVIDER_OUTAGE_WINDOW_MS)}. ccrc tells each one to continue until it can, so there is nothing for you to do.`,
});

/** One pass: the next set of standing outages, and the notices it makes due, in key order. */
export function providerOutageStep(standing: ProviderOutages, owing: readonly OwingSession[], now: number):
  { readonly next: ProviderOutages; readonly notices: readonly ProviderOutageNotice[] } {
  const next = new Map<string, ProviderOutage>();
  const notices: ProviderOutageNotice[] = [];
  const keys = [...new Set([...standing.keys(), ...owing.map((o) => o.provider.key)])].sort();
  for (const key of keys) {
    const here = owing.filter((o) => o.provider.key === key);
    const was = standing.get(key);
    if (was !== undefined) {
      if (!was.offered) notices.push(raised(key, was));
      if (here.length > 0) next.set(key, { ...was, lastOwedAt: now, offered: true });
      else if (now - was.lastOwedAt < PROVIDER_OUTAGE_CLEAR_MS) next.set(key, { ...was, offered: true });
      else {
        notices.push({ mode: 'record-only', key, dedupeKey: `provider-outage:${key}:${was.since}:clear`, title: `${was.name} errors have stopped`,
          body: `No session has been waiting on a provider error for ${minutes(PROVIDER_OUTAGE_CLEAR_MS)}.` });
      }
      continue;
    }
    const recent = here.filter((o) => now - o.at <= PROVIDER_OUTAGE_WINDOW_MS);
    if (recent.length < PROVIDER_OUTAGE_SESSIONS) continue;
    const name = recent[0]!.provider.name;
    next.set(key, { since: now, lastOwedAt: now, name, offered: true });
    notices.push(raised(key, { since: now, name }));
  }
  return { next, notices };
}
