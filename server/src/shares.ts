import path from 'node:path';
import type { FleetIO } from './io.js';
import type { ShareReading } from '../../shared/serviceability.js';

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
