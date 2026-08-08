import path from 'node:path';
import type { FleetIO } from '../io.js';
import type { PrLineageEntry } from './store.js';

export type PrHistoryRead =
  | { ok: true; entries: PrLineageEntry[] }
  | { ok: false; error: 'unreadable' };

/**
 * `$REG/<id>.prhistory` — the FIRST server-side reader of this file. It is
 * appended by ccd at exactly one chokepoint, the `prnumber` replacement inside
 * `_pr_py` (`ccd/ccd:849-859`), which is the only line in ccd that ever
 * replaces a persisted `prnumber` and therefore the only place PR lineage can
 * be recorded at all.
 *
 * THE THREE-ANSWER LADDER IS ccd'S OWN (`ccd/ccd:2018-2035`), and it is
 * load-bearing rather than defensive:
 *   - ABSENT      -> `[]`, and it is a MEASURED answer: this workspace has
 *                    retired no PR.
 *   - MALFORMED   -> the lines that parse, in order; a torn tail is one lost
 *                    record. The file on disk is never touched.
 *   - UNREADABLE  -> REFUSAL. A `chmod 000` ledger answering `[]` would put
 *                    "this workspace retired no PRs" into the record that
 *                    closes a run — the SIXTEENTH FORGERY's exact shape.
 *
 * `FleetIO.readFile` maps every error to `null` (`io.ts:41-43`), so present and
 * unreadable are indistinguishable from the read alone. The registry DIRECTORY
 * listing is what separates them — it names `<id>.prhistory` whether or not its
 * bytes can be fetched — which is the same mechanism `registry.ts:26-46` uses
 * for `HOLD_UNREADABLE`. In remote mode both are agent round trips; two is the
 * price of the distinction, and it is paid once per run close, never per sweep.
 */
export async function readPrHistory(
  io: FleetIO, registryDir: string, id: string,
): Promise<PrHistoryRead> {
  const name = `${id}.prhistory`;
  const raw = await io.readFile(path.join(registryDir, name));
  if (raw === null) {
    const listing = await io.readdir(registryDir);
    // A listing we could not take either: refuse. Absence is only absence when
    // something actually looked.
    if (listing === null || listing.includes(name)) return { ok: false, error: 'unreadable' };
    return { ok: true, entries: [] };
  }
  const entries: PrLineageEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o['pr'] !== 'number' || !Number.isInteger(o['pr'])) continue;
      if (typeof o['branch'] !== 'string' || typeof o['phase'] !== 'string') continue;
      if (typeof o['recordedAt'] !== 'number') continue;
      entries.push({ pr: o['pr'], branch: o['branch'], phase: o['phase'], recordedAt: o['recordedAt'] });
    } catch { /* a torn or hand-edited line is one lost record, never a lost history */ }
  }
  return { ok: true, entries };
}
