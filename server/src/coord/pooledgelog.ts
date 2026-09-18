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
   * The file's half of MAX(file, db). A missing file is `null` — nothing was
   * ever tagged. An UNREADABLE file THROWS, and so, as of T6-R5 (fix round
   * 1), does an EXISTING file that yields no epoch: zero-length (the ext4
   * delayed-allocation crash shape — the file was created but no data landed
   * before the crash) or content with no `"epoch":<digits>` anywhere in it.
   * Reading any of those as "nothing allocated" is exactly the reissue this
   * file exists to prevent — measured: write two epochs, zero-length the
   * journal, restore `coord.db` from an older snapshot, and the OLD `return
   * null` handed epoch 1 out again with no unreadable file anywhere in the
   * sequence. ONLY `ENOENT` may answer `null`; every other "no epoch found"
   * shape must fail as loudly as an unreadable file does.
   *
   * Regex-only, unlike `ledgerlog.ts`'s two-arm JSON-parse-then-regex reader:
   * `maxAllocated` parses first because it must attribute each line to the
   * right PROJECT, and only falls back to the regex for a line that fails to
   * parse. This file has no per-subject filter to get right on a well-formed
   * line — it wants the max epoch across every line, full stop — so a
   * JSON.parse arm would buy nothing here that the regex doesn't already do.
   * A torn final append still counts when an `"epoch":<digits>` can be read
   * out of the fragment; over-counting is the safe direction.
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
    if (max === null) {
      throw new Error(
        `pool-edges journal exists at ${this.logPath} but yields no epoch — ` +
        'zero-length or unparseable is not the same as absent; answering ' +
        'null here would be the reissue this file exists to prevent',
      );
    }
    return max;
  }
}
