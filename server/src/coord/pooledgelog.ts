import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The flat-file ground truth under `pool_edges` (D8, the `ledger_alloc` shape):
 * every epoch is appended HERE first and committed to coord.db second, and
 * recovery takes MAX(file, db) — so an epoch is SKIPPED, NEVER REISSUED. This
 * is genuinely load-bearing today: it is the entire reason a lost/rebuilt
 * coord.db cannot make a node accept an older pool document as a newer one.
 *
 * WHAT THIS FILE DOES **NOT** DO (corrected item 2, wave-1 fix round A — this
 * comment, spec §5.1/§5.3 and the plan's matching step all previously claimed
 * a lost coord.db "reconstructs" from this journal, or that recovery
 * "replays" it; none of that is true of the code in this tree).
 * {@link PoolEdgeLog.maxEpoch} below is the ONLY reader anywhere in
 * `server/src`, and it extracts nothing but the maximum `epoch` NUMBER —
 * never the `accountId`/`pools`/`addedBy` fields each line also carries, and
 * nothing anywhere replays those fields back into `pool_edges`/`pool_epoch`.
 * A coord.db lost today genuinely loses every CENTRAL edge — `pool_edges`
 * comes back empty, so every account's resolution falls through to its
 * DECLARED `accounts.json` default (only an account with no declared pool of
 * its own lands on the fail-open `untagged`) — and re-establishing the
 * CENTRAL rows is a by-hand operator task (reading these NDJSON lines) or a
 * future automatic replay, carried as an open item rather than built here
 * (`docs/superpowers/specs/2026-09-18-account-pool-membership-design.md` §7).
 * What survives automatically, and is the real reason this file exists: the
 * epoch NUMBER, so whichever path re-establishes membership cannot hand out
 * an epoch already committed once — the reissue this file's first paragraph
 * describes.
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

  /** Refuses an EMPTY batch (out-of-scope note, fix round 2) rather than
   *  silently no-op — `appendFileSync(path, '')` still CREATES a zero-length
   *  file when none existed, and `maxEpoch()` now throws on exactly that
   *  shape (F6/T6-R5). `setAccountPools` is the sole caller today and always
   *  passes one entry, so this is unreachable in the current tree — but
   *  `append` is public and a later caller wedging every subsequent read off
   *  a call this file could not have anticipated is worse than a thrown
   *  guard here, closest to the mistake. */
  append(entries: readonly PoolEdgeLogEntry[]): void {
    if (entries.length === 0) {
      throw new Error('PoolEdgeLog.append called with an empty batch — refused: this would ' +
        'create (or leave unchanged) a file maxEpoch() cannot then distinguish from a torn write');
    }
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
   * journal, restore `coord.db` from a snapshot taken between the two writes
   * (so `dbMax` reads back as the FIRST epoch), and the OLD `return null`
   * handed the SECOND epoch — already issued and journaled once — out again,
   * with no unreadable file anywhere in the sequence (M1, fix round 2:
   * corrected from "epoch 1" — the snapshot postdates epoch 1, so epoch 1
   * itself never reissues; it is the epoch AFTER the snapshot that comes
   * back). ONLY `ENOENT` may answer `null`; every other "no epoch found"
   * shape must fail as loudly as an unreadable file does.
   *
   * NO AUTOMATIC REPAIR: this throw wedges every subsequent pool write until
   * an operator acts, by design — the alternative is the reissue above. The
   * operator's move is to RECONSTRUCT the journal from `coord.db`'s own
   * `pool_edges`/`pool_epoch` (which already hold the last-committed epoch
   * and membership) rather than delete the file outright: deleting it drops
   * straight to `dbMax` with no file-side floor at all, which is correct
   * only if `coord.db` is also known current — the harder fact to establish
   * during exactly the incident this throw fires in.
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
