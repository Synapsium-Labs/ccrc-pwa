// "Archive all (N)" inside a card's `Released (N)` fold (workspace lifecycle spec §5.1).
//
// PLAIN archives, one at a time: never `force`, and never any other option — the server's door decides every
// refusal, and this loop only reports it. Children are skipped (CCR-15 reclaims them itself; its spec §5.9
// assumes a child is never archived), and every row is re-read from the CURRENT frame just before its own
// request, because a row can stop being released while the loop is still working through the rows above it.
import { releasedFromOf, type FleetSession } from '../../../shared/api';
import { inReleasedFold } from './groupFleet';

export interface ArchiveReleasedDeps {
  /** The row as the newest frame has it, or `undefined` if it has left the fleet. */
  current: (id: string) => FleetSession | undefined;
  /** `api.archive` with its id alone — the loop never passes a second argument. */
  archive: (id: string) => Promise<unknown>;
  /** `apiErrorText`: ccd's own refusal sentence when there is one. */
  errorText: (err: unknown) => string;
}

export interface ArchiveReleasedResult {
  archived: string[];
  /** Left alone by the loop: a child, or a row no longer in the fold (or gone) when its turn came. The screen hands
   *  the loop EVERY folded id, children included, so this count is the fold's whole remainder. */
  skipped: string[];
  /** Sent, and the server said no — each with the reason it gave. */
  refused: { id: string; reason: string }[];
}

/** Whether "Archive all" would send this row at all — a folded row that is not a child. `releasedFrom.child` is
 *  the one reading used, never `FleetSession.child`: one decision, one field. */
export function archivableReleased(s: FleetSession): boolean {
  return inReleasedFold(s) && releasedFromOf(s)?.child === false;
}

export async function archiveReleased(ids: readonly string[], deps: ArchiveReleasedDeps): Promise<ArchiveReleasedResult> {
  const out: ArchiveReleasedResult = { archived: [], skipped: [], refused: [] };
  for (const id of ids) {
    const row = deps.current(id);
    if (row === undefined || !archivableReleased(row)) {
      out.skipped.push(id);
      continue;
    }
    try {
      await deps.archive(id);
      out.archived.push(id);
    } catch (err) {
      out.refused.push({ id, reason: deps.errorText(err) });
    }
  }
  return out;
}

/** The one summary toast. Counts first, then each refusal with its reason, so nothing the server said is lost. */
export function archiveReleasedSummary(r: ArchiveReleasedResult): string {
  const head = `Archived ${r.archived.length}, skipped ${r.skipped.length}, refused ${r.refused.length}`;
  return r.refused.length === 0 ? `${head}.` : `${head}: ${r.refused.map((x) => `${x.id} — ${x.reason}`).join('; ')}`;
}
