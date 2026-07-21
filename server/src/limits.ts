import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CcrcConfig } from './config.js';

export interface AccountLimits {
  five: number | null; seven: number | null; ts: number | null;
  fiveResetAt: number | null; sevenResetAt: number | null;
}

const FIVE_WINDOW = 18000;      // ccd: a five reading older than its own 5h window has rolled over
const SEVEN_WINDOW = 604800;

const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export async function readLimits(cfg: CcrcConfig, now = Math.floor(Date.now() / 1000)): Promise<Record<string, AccountLimits>> {
  let names: string[] = [];
  try { names = await readdir(cfg.limitsDir); } catch { /* no dir yet */ }
  const out: Record<string, AccountLimits> = {};
  for (const n of names.filter((n) => n.endsWith('.json') && !n.startsWith('.'))) {
    const wrapper = n.slice(0, -'.json'.length);
    try {
      const raw = JSON.parse(await readFile(path.join(cfg.limitsDir, n), 'utf8')) as Record<string, unknown>;
      const ts = numOrNull(raw.ts);
      let five = numOrNull(raw.five);
      let seven = numOrNull(raw.seven);
      if (ts !== null) {
        if (five !== null && now - ts > FIVE_WINDOW) five = 0;
        if (seven !== null && now - ts > SEVEN_WINDOW) seven = 0;
      }
      out[wrapper] = { five, seven, ts, fiveResetAt: numOrNull(raw.fiveResetAt), sevenResetAt: numOrNull(raw.sevenResetAt) };
    } catch {
      out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null, sevenResetAt: null };
    }
  }
  return out;
}
