import type { FleetIO } from '../io.js';
import { floorFromScan, type LedgerFloorScan } from './ledger.js';

/**
 * The floor measurement, lifted out of `FleetWatcher` so a request can run it
 * (program-leverage wave 2, F2).
 *
 * L1-with-ports, in `coord/dispatch.ts`'s shape: consumer-declared deps, real
 * IO through them, a typed union out, no `reply` and no clock of its own. It
 * imports neither `./db.js` nor `node:sqlite` and names no store handle — the
 * coord ring's own rule. It is deliberately NOT in `coord/ledger.ts`, whose
 * header declares that file pure: "the allocator's DECISION and the floor SCAN,
 * with no clock, no fs and no handle".
 *
 * The DECISION about what to do with each answer belongs to the caller, and the
 * two callers decide DIFFERENTLY on purpose. See `LedgerDocsRead.complete`.
 */

/**
 * A wall-clock budget for the walk, checked BETWEEN files — `inject/send.ts`'s
 * `CLEAR_BUDGET_MS` idiom, and the same honesty about what it does and does not
 * bound.
 *
 * It bounds the WALK, not one read: in remote fleet mode a single `readFile` is
 * an agent round trip with its own 15 s ceiling and no knob below this layer,
 * so one pathological file can overrun this budget by that much. What it buys
 * is that a 100-file corpus cannot hold an HTTP request open for the SUM of
 * those ceilings — which for ccrc's own corpus would be about 25 minutes.
 * Measured locally at ~53 ms for those same 100 files, so this is roughly 200x
 * headroom on the local path and a real bound on the remote one.
 */
export const LEDGER_SEED_BUDGET_MS = 10_000;

export interface LedgerSeedDeps {
  io: Pick<FleetIO, 'readdir' | 'readFile'>;
  projectsRoot: string;
  /** Injectable so a test can prove the budget bounds the walk without spending it. */
  now?: () => number;
  budgetMs?: number;
}

export interface LedgerDoc { readonly path: string; readonly text: string }

/**
 * `complete` is the field that lets ONE reader serve TWO policies.
 *
 * The hourly sweep takes whatever it got and seeds from it: it mints nothing,
 * so a floor it under-measures costs a delay and the next pass raises it. A
 * SYNCHRONOUS seed cannot reason that way — it mints numbers immediately, from
 * a floor that only ever rises, so a scan missing the file with the highest ref
 * hands out numbers that are already in use.
 *
 * `watch.ts`'s own comment calls a partial scan "the safe direction" because it
 * "can only ever UNDER-seed inside the 50-number gap". The bound in that
 * sentence does not hold — the gap is added to the max ref the scan FOUND, so
 * if the file carrying the highest ref is the one that failed, the under-seed
 * is bounded only by the distance between the two highest refs in the corpus
 * (D-1018). What actually makes the sweep safe is that it mints nothing. That
 * property is the caller's, not this reader's, which is why this reader reports
 * the fact and decides nothing.
 */
export interface LedgerDocsRead {
  readonly complete: boolean;
  readonly files: readonly LedgerDoc[];
}

export type FloorMeasurement =
  | { readonly ok: true; readonly scan: LedgerFloorScan }
  /** Measured, and there is no global `D-<n>` anywhere to seed from. */
  | { readonly ok: false; readonly why: 'no-refs' }
  /** No answer was obtained: a listing failed, a file would not read, the
   *  budget expired, or the project name was not safe to walk. */
  | { readonly ok: false; readonly why: 'unmeasurable' };

/**
 * The project name reaches this module from an HTTP body and is interpolated
 * into a path, so it is validated as a single path SEGMENT before any walk
 * (D-1017). The sweep's own projects come from the registry and are trusted;
 * the route's are not. The box token gates that route, but a token is a
 * credential rather than a sandbox, and this tree's own rule is that the HTTP
 * chokepoint is a contract the coordinator honors, not an OS wall.
 */
export function isSafeProjectSegment(project: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) && project !== '.' && project !== '..';
}

/**
 * Absent and unreadable collapse in `readdir` — there is no measured variant,
 * and adding one is an agent protocol change (D-114, D-1019). So this walks the
 * PARENT first and uses its listing as the evidence ladder, the same shape
 * `registry.ts` uses for a field that is listed but will not read: a dir the
 * parent does not name is genuinely absent and contributes nothing; a dir the
 * parent DOES name and that then will not list is a failure, and says so.
 */
export async function readLedgerDocs(
  deps: LedgerSeedDeps, project: string, dirs: readonly string[],
): Promise<LedgerDocsRead> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.budgetMs ?? LEDGER_SEED_BUDGET_MS);

  const root = `${deps.projectsRoot}/${project}/docs/superpowers`;
  const listing = await deps.io.readdir(root);
  if (listing === null) return { complete: false, files: [] };

  const files: LedgerDoc[] = [];
  for (const d of dirs) {
    if (!listing.includes(d)) continue;      // genuinely absent — measured, contributes nothing
    const dir = `${root}/${d}`;
    const names = await deps.io.readdir(dir);
    if (names === null) return { complete: false, files };
    for (const n of [...names].sort()) {     // sorted: floorFromScan's tie-break is first-wins
      if (!n.endsWith('.md')) continue;
      if (now() > deadline) return { complete: false, files };
      const text = await deps.io.readFile(`${dir}/${n}`);
      if (text === null) return { complete: false, files };
      files.push({ path: `docs/superpowers/${d}/${n}`, text });
    }
  }
  return { complete: true, files };
}

/** The dirs the floor is measured from. Named once; the sweep and the
 *  synchronous seed both read it. (Reconcile scans `['plans']` alone — a
 *  different list for a different question, not a second copy of this one.) */
export const LEDGER_FLOOR_DIRS: readonly string[] = ['plans', 'specs'];

/**
 * Three outcomes, kept distinct because a caller acts on them differently: seed
 * and proceed; refuse because there is genuinely nothing to seed from; refuse
 * because nothing was measured. Only the first may ever mint a number.
 */
export async function measureLedgerFloor(
  deps: LedgerSeedDeps, project: string,
): Promise<FloorMeasurement> {
  if (!isSafeProjectSegment(project)) return { ok: false, why: 'unmeasurable' };
  const read = await readLedgerDocs(deps, project, LEDGER_FLOOR_DIRS);
  if (!read.complete) return { ok: false, why: 'unmeasurable' };
  const scan = floorFromScan(read.files);
  return scan === null ? { ok: false, why: 'no-refs' } : { ok: true, scan };
}
