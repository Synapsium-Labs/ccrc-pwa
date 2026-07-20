import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CcrcConfig } from './config.js';

export interface AccountLimits { five: number | null; seven: number | null; ts: number | null }

const FIVE_WINDOW = 18000;      // ccd: a five reading older than its own 5h window has rolled over
const SEVEN_WINDOW = 604800;

export async function readLimits(cfg: CcrcConfig, now = Math.floor(Date.now() / 1000)): Promise<Record<string, AccountLimits>> {
  let names: string[] = [];
  try { names = await readdir(cfg.limitsDir); } catch { /* no dir yet */ }
  const out: Record<string, AccountLimits> = {};
  for (const n of names.filter((n) => n.endsWith('.json') && !n.startsWith('.'))) {
    const wrapper = n.slice(0, -'.json'.length);
    try {
      const raw = JSON.parse(await readFile(path.join(cfg.limitsDir, n), 'utf8')) as { five?: number; seven?: number; ts?: number };
      const ts = typeof raw.ts === 'number' ? raw.ts : null;
      let five = typeof raw.five === 'number' ? raw.five : null;
      let seven = typeof raw.seven === 'number' ? raw.seven : null;
      if (ts !== null) {
        if (five !== null && now - ts > FIVE_WINDOW) five = 0;
        if (seven !== null && now - ts > SEVEN_WINDOW) seven = 0;
      }
      out[wrapper] = { five, seven, ts };
    } catch {
      out[wrapper] = { five: null, seven: null, ts: null };
    }
  }
  return out;
}
