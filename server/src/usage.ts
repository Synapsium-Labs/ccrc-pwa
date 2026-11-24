import path from 'node:path';
import type { FleetIO } from './io.js';
import { tokenCountOf, type SessionUsage } from '../../shared/api.js';
import { familyClassOf } from '../../shared/models.js';
import type { SpendTurnRead } from '../../shared/programmeFacts.js';
import type { TurnMarkRead } from './coord/stall.js';

/** A sidecar older than this is STALE: carried, but flagged. Thirty minutes,
 *  the bound `HOOKSTATE_FRESH_MS` gives the hook state, in the sidecar's own
 *  unit (seconds — the hook writes `date +%s`). */
export const USAGE_FRESH_S = 30 * 60;

export type UsageRead =
  /** `uuid`: the sidecar's `session_id`, the conversation the reading was taken in (Overlord W2 forecasts B: the spend
   *  arm counts a reading only in the run's own conversation, `clear-restarts-cost-by-session-id`); null when the
   *  sidecar has none. Beside `usage`, not inside it, so the fleet wire's `SessionUsage` is unchanged. */
  | { kind: 'reading'; usage: SessionUsage; uuid: string | null }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' };

/** `~/.cc-sessions/usage/<ccd-id>.json` — under the agent's `.cc-sessions/`
 *  read root (`agent/src/whitelist.ts`), so the remote adapter reads it with
 *  no whitelist change. */
export function usageSidecarPath(registryDir: string, id: string): string {
  return path.join(registryDir, 'usage', `${id}.json`);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Pure. `nowS` in epoch seconds, the sidecar's unit. A row with no numeric
 *  `ts` is MALFORMED, not a reading: without a clock nothing can tell it fresh
 *  from stale, and a reading that cannot be aged would be shown as current
 *  forever. */
export function parseUsageSidecar(content: string, nowS: number): Extract<UsageRead, { kind: 'reading' | 'malformed' }> {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { kind: 'malformed' }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'malformed' };
  const o = raw as Record<string, unknown>;
  const ts = num(o['ts']);
  if (ts === null) return { kind: 'malformed' };
  const model = str(o['model']);
  return { kind: 'reading', uuid: str(o['uuid']), usage: {
    ts, model,
    class: model === null ? null : familyClassOf(model),
    effort: str(o['effort']),
    ctxPct: num(o['ctxPct']),
    ctxTokens: tokenCountOf(o['ctxTokens']),     // Overlord W0-18: `context_window.total_input_tokens`
    ctxWindow: tokenCountOf(o['ctxWindow']),     // Overlord W0-18: `context_window.context_window_size`
    cost: num(o['cost']),
    cacheExpiresAt: num(o['cacheExpiresAt']),   // D-8267: `prompt_cache.expires_at`, epoch seconds
    stale: nowS - ts > USAGE_FRESH_S,
  } };
}

/** Four answers, never three: absent and unreadable come from `readFileMeasured`
 *  and are not narrowed here (an adapter may not narrow a distinction it
 *  received); malformed is this reader's own. */
export async function readUsageMeasured(io: FleetIO, registryDir: string, id: string, nowS: number): Promise<UsageRead> {
  const r = await io.readFileMeasured(usageSidecarPath(registryDir, id));
  if (!r.ok) return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  return parseUsageSidecar(r.content, nowS);
}

/** The convenience fold, and it IS a collapse: absent, unreadable and
 *  malformed all read `null` here, deliberately — the fleet wire carries one
 *  `usage` slot per session and every consumer of that slot renders the three
 *  the same way (no reading). A caller that must tell them apart uses
 *  `readUsageMeasured`. Same shape as `io.ts`'s `readFile` over
 *  `readFileMeasured`, named for the same reason. */
export async function readUsage(io: FleetIO, registryDir: string, id: string, nowS: number): Promise<SessionUsage | null> {
  const r = await readUsageMeasured(io, registryDir, id, nowS);
  return r.kind === 'reading' ? r.usage : null;
}

/** The turn marker of each session with a usage reading (Overlord W2 forecasts B, fix round 1, F2), judged against the
 *  registry's conversation the reading was taken beside (`conversations`, the usage sweep's own map): `read` with its
 *  newest turn's start and its newest Stop's live background count (fix round 2, F2-b), or `unread` for any answer that
 *  cannot vouch (absent, unmeasured, malformed, foreign, a throw).
 *  `readMark` is the marker's one reader (`turnmark.ts#readTurnMarkMeasured`), handed in by the watcher. */
export async function readSpendTurns(readMark: (id: string, registryUuid: string) => Promise<TurnMarkRead>,
  conversations: ReadonlyMap<string, { readonly registry: string }>): Promise<Map<string, SpendTurnRead>> {
  const out = new Map<string, SpendTurnRead>();
  await Promise.all([...conversations].map(async ([id, c]) => {
    const mark = await readMark(id, c.registry).catch((): TurnMarkRead => ({ ok: false, reason: 'unmeasured' }));
    out.set(id, mark.ok ? { kind: 'read', turnAt: mark.turnAt, background: mark.bg } : { kind: 'unread' });
  }));
  return out;
}
