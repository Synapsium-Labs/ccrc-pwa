import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AutoMode, NotifyMode, UpdateChannel } from '../../../shared/api.js';

/**
 * The flat-file floor under `update_epoch` (design 2026-09-20 §6 "Journal"):
 * `PoolEdgeLog`'s twin (`pooledgelog.ts`), for its reason. Every intent write
 * is appended HERE first and committed to coord.db second, and the next epoch
 * is MAX(file, db) + 1 — so an epoch is SKIPPED, NEVER REISSUED. A fleet node's
 * projection reader compares epochs; an epoch it has already seen must never
 * come back carrying different intent, which is exactly what a coord.db
 * restored from a snapshot would otherwise hand out.
 *
 * WHAT THIS FILE DOES NOT DO, said up front because `pooledgelog.ts` once
 * claimed otherwise about itself: nothing replays these lines into
 * `update_intent`. {@link UpdateIntentLog.maxEpoch} is the only reader, and it
 * extracts the maximum `epoch` NUMBER and nothing else. A lost coord.db comes
 * back with the migration's seed row (`'*'` → `stable`, `auto` off) — the safe
 * direction — and re-establishing a node's own scope is an operator act, read
 * from these lines by hand.
 *
 * `~/.ccrc/update-intent.log` on the SERVER box, beside `coord.db`: local-box
 * housekeeping, never proxied through FleetIO, and not in the agent's
 * exact-basename read set (design 2026-09-20 §8 — `update-intent`, the
 * projection, is; this `.log` is not). NDJSON, one line per epoch. Synchronous
 * on purpose: `CoordStore.setIntent` calls it INSIDE a `tx()`, and
 * `DatabaseSync`'s no-async invariant is the whole correctness argument.
 */
export function defaultUpdateIntentLogPath(ccrcDir: string): string {
  return path.join(ccrcDir, 'update-intent.log');
}

/** One epoch's line: the whole intent row as it stands AFTER the write, so a
 *  line read by hand says what the scope was set to, not only what changed. */
export interface UpdateIntentLogEntry {
  epoch: number; scope: string; channel: UpdateChannel; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setBy: string; at: number;
}

export class UpdateIntentLog {
  constructor(readonly logPath: string) {}

  /** One entry per call, so the empty-batch hazard `PoolEdgeLog.append`
   *  refuses cannot arise here. Throws on a write failure — `setIntent` turns
   *  that into `journal-unwritable`, and its transaction rolls back. */
  append(entry: UpdateIntentLogEntry): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, JSON.stringify({
      epoch: entry.epoch, scope: entry.scope, channel: entry.channel, pinnedTag: entry.pinnedTag,
      auto: entry.auto, notify: entry.notify, setBy: entry.setBy, at: entry.at,
    }) + '\n', 'utf8');
  }

  /**
   * The file's half of MAX(file, db). A missing file is `null` — no intent was
   * ever journalled. An UNREADABLE file THROWS, and so does an EXISTING file
   * that yields no epoch (zero-length — the ext4 delayed-allocation crash shape
   * — or content with no `"epoch":<digits>` anywhere): reading either as
   * "nothing issued" is the reissue this file exists to prevent, measured for
   * the pool journal in `pooledgelog.ts`'s own docstring and identical here.
   * ONLY `ENOENT` may answer `null`.
   *
   * NO AUTOMATIC REPAIR: the throw refuses every intent write (`setIntent`
   * answers `journal-unreadable`, the route 503) until an operator acts — by
   * RECONSTRUCTING the journal from `coord.db`'s `update_epoch` row, one line
   * carrying its epoch, rather than deleting the file.
   *
   * Regex-only, as `PoolEdgeLog.maxEpoch` is: it wants the max epoch across
   * every line, full stop, and a torn final append still counts when an
   * `"epoch":<digits>` can be read out of the fragment — over-counting is the
   * safe direction.
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
        `update-intent journal exists at ${this.logPath} but yields no epoch — ` +
        'zero-length or unparseable is not the same as absent; answering ' +
        'null here would be the reissue this file exists to prevent',
      );
    }
    return max;
  }
}
