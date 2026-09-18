import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The flat-file ground truth under `pool_edges` (D8, the `ledger_alloc` shape):
 * every epoch is appended HERE first and committed to coord.db second, and
 * recovery takes MAX(file, db) — so an epoch is SKIPPED, NEVER REISSUED.
 *
 * WHY THIS FILE EXISTS AT ALL, in one sentence: a lost coord.db that could not
 * reconstruct would answer "untagged" for every account, and untagged is
 * unconstrained — the fail-OPEN direction, and the one outcome the whole design
 * exists to prevent. Gaps cost nothing; a reissued epoch would let a node accept
 * an older document as newer.
 *
 * `~/.ccrc/pool-edges.log` on the SERVER box — beside `coord.db`, same stance as
 * `defaultLedgerLogPath`: local-box housekeeping, never proxied through FleetIO.
 * NDJSON, one line per EPOCH. Synchronous on purpose: `setAccountPools` calls
 * this INSIDE a `tx()`, and `DatabaseSync`'s no-async invariant is the whole
 * correctness argument.
 */
export function defaultPoolEdgeLogPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'pool-edges.log');
}

export interface PoolEdgeLogEntry {
  epoch: number; accountId: string; pools: readonly string[]; addedBy: string | null; at: number;
}

export class PoolEdgeLog {
  constructor(readonly logPath: string) {}

  append(entries: readonly PoolEdgeLogEntry[]): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    const lines = entries.map((e) => JSON.stringify({
      epoch: e.epoch, accountId: e.accountId, pools: e.pools, addedBy: e.addedBy, at: e.at,
    }) + '\n').join('');
    appendFileSync(this.logPath, lines, 'utf8');
  }

  /**
   * The file's half of MAX(file, db). A missing file is `null`; an UNREADABLE
   * file THROWS — reading it as empty is exactly the reissue this file exists to
   * prevent, so the write must fail loudly instead.
   *
   * THE SALVAGE ARM: a torn final append still counts when an `"epoch":<digits>`
   * can be read out of the fragment. Over-counting is the safe direction.
   */
  maxEpoch(): number | null {
    let text: string;
    try {
      text = readFileSync(this.logPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let max: number | null = null;
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const m = /"epoch":(\d+)/.exec(line);
      if (m === null) continue;
      const n = Number(m[1]);
      if (max === null || n > max) max = n;
    }
    return max;
  }
}
