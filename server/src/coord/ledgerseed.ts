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
 * A wall-clock budget for the SYNCHRONOUS SEED's walk, checked BETWEEN files —
 * `inject/send.ts`'s `CLEAR_BUDGET_MS` idiom, and the same honesty about what
 * it does and does not bound.
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

/**
 * The two lanes' policies, stated rather than defaulted.
 *
 * `onFailure` — what a dir or file that will not read does to the rest of the
 * walk. `'skip'` contributes nothing and CONTINUES; `'abort'` ends the walk and
 * returns the prefix it had.
 *
 * `budgetMs` — a wall-clock bound on the walk, or `null` for none.
 *
 * BOTH FIELDS ARE REQUIRED AND THE PARAMETER IS NOT OPTIONAL, deliberately.
 * This split shipped once with a DEFAULT budget and abort-only semantics, and
 * the hourly sweep silently inherited both: it became bounded for the first
 * time in its life, and a dir that would not list began skipping the whole
 * project where it used to fall through to the next dir (D-1021, found in
 * review). A default is exactly how one lane acquires the other lane's policy
 * without anyone deciding it should.
 */
export interface LedgerReadPolicy {
  readonly onFailure: 'skip' | 'abort';
  readonly budgetMs: number | null;
}

/**
 * The hourly sweep: TAKE WHAT YOU GOT, over the whole corpus, unbounded.
 *
 * Safe here for one reason only, and it is a property of the CALLER, not of the
 * read: nothing downstream of `sweepLedgerFloor` mints a number. A floor it
 * under-measures costs a delay, and the next pass raises it because
 * `raiseLedgerFloor` only ever raises. Unbounded because this lane runs
 * fire-and-forget off a timer with an hour between passes — there is no request
 * waiting on it, and truncating its walk would silently plant a LOW floor,
 * which is the one outcome that is not merely slow.
 */
export const SWEEP_POLICY: LedgerReadPolicy = { onFailure: 'skip', budgetMs: null };

/**
 * The synchronous seed: ANY GAP IS A REFUSAL, and the walk is bounded.
 *
 * The opposite of the sweep, for the opposite reason: this lane mints numbers
 * immediately, from a floor that only ever rises, so a scan that missed the
 * file carrying the highest ref hands out numbers already in use — the bb47c9e
 * reissue class. It also holds an HTTP request open, so it needs a bound the
 * sweep does not.
 */
export const SEED_POLICY: LedgerReadPolicy =
  { onFailure: 'abort', budgetMs: LEDGER_SEED_BUDGET_MS };

/**
 * WHAT ACTUALLY MAKES THE SEED FAIL SHUT IS `complete`, NOT `abort` (D-1022,
 * measured). `measureLedgerFloor` refuses on `!read.complete`, so deleting that
 * one check reds five tests while making the reader tolerant on this lane reds
 * none — `complete` is still false either way and the refusal still happens.
 *
 * `abort` is therefore an EARLY EXIT, not the guard: it stops walking a corpus
 * that has already lost the ability to produce a usable answer, which matters
 * on a lane holding an HTTP request open. Stated because the two look
 * interchangeable and only one of them is load-bearing — an optimisation pass
 * that "simplified" `complete` away would leave `abort` behind looking like the
 * safety it is not.
 */

export interface LedgerSeedDeps {
  io: Pick<FleetIO, 'readdir' | 'readFile'>;
  projectsRoot: string;
  /** Injectable so a test can prove the budget bounds the walk without spending it. */
  now?: () => number;
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
 * The sweep's old docstring used to call a partial scan "the safe direction"
 * because it "can only ever UNDER-seed inside the 50-number gap". That bound
 * does not hold — the gap is added to the max ref the scan FOUND, so if the
 * file carrying the highest ref is the one that failed, the under-seed is
 * bounded only by the distance between the two highest refs in the corpus
 * (D-1018). The sentence was deleted with that docstring rather than reworded,
 * because what actually makes the sweep safe is that it MINTS NOTHING — a
 * property of the caller, not of this reader, which is why this reader reports
 * the fact and decides nothing.
 */
export interface LedgerDocsRead {
  /** False when ANYTHING was missed — under either policy. The sweep reads this
   *  and proceeds anyway; the seed reads it and refuses. */
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
  deps: LedgerSeedDeps, project: string, dirs: readonly string[], policy: LedgerReadPolicy,
): Promise<LedgerDocsRead> {
  const now = deps.now ?? Date.now;
  const deadline = policy.budgetMs === null ? Infinity : now() + policy.budgetMs;

  const root = `${deps.projectsRoot}/${project}/docs/superpowers`;
  const listing = await deps.io.readdir(root);
  // The parent itself did not list: nothing can be told about any child, under
  // either policy. (Under the old watcher this was `listedAny === false`, since
  // a child cannot list when its parent cannot.)
  if (listing === null) return { complete: false, files: [] };

  const files: LedgerDoc[] = [];
  let complete = true;
  for (const d of dirs) {
    if (!listing.includes(d)) continue;      // genuinely absent — measured, contributes nothing
    const dir = `${root}/${d}`;
    const names = await deps.io.readdir(dir);
    if (names === null) {
      complete = false;
      if (policy.onFailure === 'abort') return { complete: false, files };
      continue;                              // skip: this dir contributes nothing, the next still runs
    }
    for (const n of [...names].sort()) {     // sorted: floorFromScan's tie-break is first-wins
      if (!n.endsWith('.md')) continue;
      // Budget expiry always ENDS the walk — a budget that kept going would not
      // be a budget. `SWEEP_POLICY` opts out by carrying no budget at all
      // rather than by ignoring one.
      if (now() > deadline) return { complete: false, files };
      const text = await deps.io.readFile(`${dir}/${n}`);
      if (text === null) {
        complete = false;
        if (policy.onFailure === 'abort') return { complete: false, files };
        continue;                            // skip: this file contributes nothing, the walk goes on
      }
      files.push({ path: `docs/superpowers/${d}/${n}`, text });
    }
  }
  return { complete, files };
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
  const read = await readLedgerDocs(deps, project, LEDGER_FLOOR_DIRS, SEED_POLICY);
  if (!read.complete) return { ok: false, why: 'unmeasurable' };
  const scan = floorFromScan(read.files);
  return scan === null ? { ok: false, why: 'no-refs' } : { ok: true, scan };
}
