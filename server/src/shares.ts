import path from 'node:path';
import type { FleetIO } from './io.js';
import type { ShareReading } from '../../shared/serviceability.js';
import type { RunSpendTokens } from '../../shared/api.js';

/** `~/.cc-sessions/usage/sweep/latest.json` — what `ccd/ccd-usage-sweep`
 *  writes (`OUT_DIR="$REG/usage/sweep"`), under the agent's `.cc-sessions/`
 *  read root, so the remote adapter reads it with no whitelist change — the
 *  same reason `usage.ts` reads the sidecars from there. `~/.ccrc/usage-sweep.json`
 *  is the PASS census (started/finished/status per pass), not the data. */
export function sweepLatestPath(registryDir: string): string {
  return path.join(registryDir, 'usage', 'sweep', 'latest.json');
}

/** Four answers, never three (the `readUsageMeasured` shape): absent and
 *  unreadable come from `readFileMeasured` and are not narrowed; malformed is
 *  this reader's own. A `reading` carries every account the pass saw, each
 *  with an integer percent or null (the sweep writes `null` when the account
 *  had no priced usage to take a share of). */
export type SharesRead =
  | { kind: 'reading'; finishedAtS: number; byAccount: Record<string, number | null> }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' };

const pct = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v * 100 + 0.5) : null);

/** Pure. `finishedAt` is the sweep's `%Y-%m-%dT%H:%M:%SZ`; a file without a
 *  parseable one is MALFORMED — a pass that cannot be aged cannot be called
 *  fresh, and `serviceability` would read a fresh 0 as servable. */
export function parseSweepShares(content: string): Extract<SharesRead, { kind: 'reading' | 'malformed' }> {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { kind: 'malformed' }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'malformed' };
  const o = raw as Record<string, unknown>;
  const fin = typeof o['finishedAt'] === 'string' ? Date.parse(o['finishedAt']) : NaN;
  if (!Number.isFinite(fin)) return { kind: 'malformed' };
  const per = o['perAccount'];
  if (typeof per !== 'object' || per === null || Array.isArray(per)) return { kind: 'malformed' };
  const byAccount: Record<string, number | null> = {};
  for (const [account, row] of Object.entries(per as Record<string, unknown>)) {
    const fs = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)['fableShare'] : undefined;
    const est = typeof fs === 'object' && fs !== null ? (fs as Record<string, unknown>)['estimate'] : undefined;
    byAccount[account] = pct(est);
  }
  return { kind: 'reading', finishedAtS: Math.floor(fin / 1000), byAccount };
}

export async function readSharesMeasured(io: FleetIO, registryDir: string): Promise<SharesRead> {
  const r = await io.readFileMeasured(sweepLatestPath(registryDir));
  if (!r.ok) return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  return parseSweepShares(r.content);
}

/** The clause's input for ONE account: null unless the read is a reading that
 *  saw this account. (`serviceability` turns null into `unmeasured`.) */
export function shareFor(read: SharesRead, account: string): ShareReading | null {
  if (read.kind !== 'reading' || !(account in read.byAccount)) return null;
  return { estimatePct: read.byAccount[account] ?? null, finishedAtS: read.finishedAtS };
}

/** One registry session's spend as the sweep wrote it (D-6799): the sweep's
 *  `perCcdSession` block, every transcript uuid that maps to the session already
 *  summed, message ids already deduplicated. `proxyUsd` is the PRICED-only dollar
 *  proxy (`apiUsd`). */
export interface SessionSpend {
  tokens: RunSpendTokens;
  proxyUsd: number;
}

/** The same four answers `SharesRead` gives. A `reading` whose sweep predates the
 *  block carries `bySession: {}` — a file that cannot name a session is not a
 *  file that cannot be read, and the join says `not-swept` for it. */
export type SessionSpendRead =
  | { kind: 'reading'; measuredAt: string; bySession: Record<string, SessionSpend> }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' };

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Pure. A session row with any count that is not a non-negative number is
 *  DROPPED, never zeroed: a row the join cannot read must not read as a session
 *  that cost nothing. */
export function parseSweepSessionSpend(content: string): Extract<SessionSpendRead, { kind: 'reading' | 'malformed' }> {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { kind: 'malformed' }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'malformed' };
  const o = raw as Record<string, unknown>;
  const fin = o['finishedAt'];
  if (typeof fin !== 'string' || !Number.isFinite(Date.parse(fin))) return { kind: 'malformed' };
  const per = o['perCcdSession'];
  if (per === undefined) return { kind: 'reading', measuredAt: fin, bySession: {} };
  if (typeof per !== 'object' || per === null || Array.isArray(per)) return { kind: 'malformed' };
  // Null prototype: the keys are untrusted JSON, and `__proto__` / `constructor` must stay plain data.
  const bySession: Record<string, SessionSpend> = Object.create(null) as Record<string, SessionSpend>;
  for (const [id, r] of Object.entries(per as Record<string, unknown>)) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;
    const input = count(row['input']); const output = count(row['output']);
    const cacheWrite = count(row['cacheWrite']); const cacheRead = count(row['cacheRead']);
    const proxyUsd = count(row['apiUsd']);
    if (input === null || output === null || cacheWrite === null || cacheRead === null || proxyUsd === null) continue;
    bySession[id] = { tokens: { input, cacheWrite, cacheRead, output }, proxyUsd };
  }
  return { kind: 'reading', measuredAt: fin, bySession };
}

/** The sweep rewrites its file once per pass (hours apart), but a board open sends one request
 *  per run row, and each read crosses the agent link. So one parsed read is shared for a short
 *  window per registry, and concurrent callers share the same in-flight read. */
export const SESSION_SPEND_TTL_MS = 30_000;
const spendCache = new Map<string, { at: number; read: Promise<SessionSpendRead> }>();
export function clearSessionSpendCache(): void { spendCache.clear(); }

export function readSessionSpendMeasured(io: FleetIO, registryDir: string, now: number = Date.now()): Promise<SessionSpendRead> {
  const hit = spendCache.get(registryDir);
  if (hit !== undefined && now - hit.at < SESSION_SPEND_TTL_MS) return hit.read;
  const read = (async (): Promise<SessionSpendRead> => {
    const r = await io.readFileMeasured(sweepLatestPath(registryDir));
    if (!r.ok) return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
    return parseSweepSessionSpend(r.content);
  })();
  spendCache.set(registryDir, { at: now, read });
  return read;
}
