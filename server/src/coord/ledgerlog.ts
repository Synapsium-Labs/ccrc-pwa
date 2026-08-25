import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The flat-file ground truth under `ledger_alloc` (D8): every allocation is
 * appended HERE first and committed to coord.db second, and recovery takes
 * MAX(file, db) — so a number is SKIPPED, NEVER REISSUED. Gaps cost nothing
 * (the ledger is prose, parsed by nothing); a reissue cost 394 rewritten
 * D-ref lines across 30 files under merge pressure (bb47c9e).
 *
 * `~/.ccrc/ledger-alloc.log` on the SERVER box — beside `coord.db`, and the
 * same stance as `defaultCoordDbPath`: local-box housekeeping, never proxied
 * through FleetIO. NDJSON, one line per allocated NUMBER, `project` spelled
 * before `n` so a torn tail still names both — see `maxAllocated`'s salvage
 * arm. Synchronous on purpose: `allocateDeviations` calls this INSIDE a
 * `tx()`, and `DatabaseSync`'s no-async invariant is the allocator's whole
 * correctness argument (D11).
 */
export function defaultLedgerLogPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'ledger-alloc.log');
}

export interface LedgerLogEntry {
  project: string; n: number; title: string; allocatedTo: string; at: number;
}

export class LedgerLog {
  constructor(readonly logPath: string) {}

  /** One O_APPEND write for the whole batch — the `swap.log` serialisation
   *  argument, though this file has exactly one writer (the single server
   *  process) by construction. */
  append(entries: readonly LedgerLogEntry[]): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    const lines = entries.map((e) => JSON.stringify({
      project: e.project, n: e.n, title: e.title, allocatedTo: e.allocatedTo, at: e.at,
    }) + '\n').join('');
    appendFileSync(this.logPath, lines, 'utf8');
  }

  /**
   * The file's half of MAX(file, db). A missing file is `null` (nothing was
   * ever allocated); an UNREADABLE file THROWS — reading it as empty is
   * exactly the reissue this file exists to prevent, so the allocation must
   * fail loudly instead.
   *
   * THE SALVAGE ARM: a line that does not parse (a crash tore the final
   * append) still counts when an `"n":<digits>` can be read out of the
   * fragment. Over-counting is the safe direction — a fragment whose
   * `project` cannot be recovered counts for EVERY project, because a
   * skipped number costs a gap and a reissued one costs the incident.
   */
  maxAllocated(project: string): number | null {
    let text: string;
    try {
      text = readFileSync(this.logPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let max: number | null = null;
    const take = (n: number): void => { if (max === null || n > max) max = n; };
    for (const line of text.split('\n')) {
      if (line === '') continue;
      let parsed: unknown = null;
      try { parsed = JSON.parse(line); } catch { parsed = null; }
      if (parsed !== null && typeof parsed === 'object') {
        const p = parsed as { project?: unknown; n?: unknown };
        if (p.project === project && typeof p.n === 'number') take(p.n);
        if (typeof p.n === 'number') continue;   // parsed, other project: not ours, not torn
      }
      const n = /"n":(\d+)/.exec(line);
      if (n === null) continue;
      const pm = /"project":"([^"]*)"/.exec(line);
      if (pm === null || pm[1] === project) take(Number(n[1]));
    }
    return max;
  }
}
