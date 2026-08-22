/**
 * L1: pure, clock-free where it can be (`nowMs` is an INPUT), `fs`-free,
 * fastify-free. It DECIDES what the sweep should do; `mirror.ts` does it.
 *
 * The ring rule this file must keep: no `./db.js`, no `node:sqlite`, and no
 * `store.db` receiver — `single-definition.test.ts`'s coord-ring scan fails
 * the build on any of the three. The names of the journal's files and its
 * ordering are L0's (`LC_DIR_NAME`, `LC_GEN_PREFIX`, `LC_GEN_SUFFIX`,
 * `LC_ERRORS_NAME`, `looksLikeGenerationFile`, `parseLifecycleGeneration`,
 * `compareGenerations`); this file imports them and declares none of them.
 */

/** What one `readFileFrom` answer means. */
export interface FramedRead {
  /** The COMPLETE lines in this payload, in order. Blank lines are dropped:
   *  `_lc_emit` writes one `printf '%s\n'` per event, so a blank line carries
   *  no event, and its bytes are still stepped over by `nextCursor`. */
  readonly lines: readonly string[];
  /** The BYTE offset just past the last complete line. `Buffer.byteLength`,
   *  never `String.length` — `hookstate.ts:150` takes the same care with its
   *  own cap, and a multibyte `--reason` would otherwise shift every later
   *  cursor by the difference between chars and bytes. */
  readonly nextCursor: number;
  /** The generation got SMALLER than we last measured it: a truncation on an
   *  immutably-named file. The caller records `gap{reason:'shrank'}` and
   *  re-reads from 0; `uid` dedupes what comes back, so only genuinely-lost
   *  bytes are lost. Separate from an empty payload, which is a cursor at EOF
   *  and a positive answer — two conditions a caller handles differently must
   *  not collapse to one value. */
  readonly shrank: boolean;
}

/**
 * FRAMING IS COMPLETE INSIDE ONE CALL (spec D5). `readFileFrom` returns
 * `[cursor, size)` in one shot; a trailing partial line is not consumed and
 * the cursor advances only to the end of the last complete line. There is no
 * cross-call carry buffer anywhere in the mirror, so there is no splice class.
 *
 * `lastSize` is the size the LAST SUCCESSFUL READ reported for this
 * generation, straight off `lifecycle_generations.size`. It is the second half
 * of the shrink test and not decoration: `size < cursor` catches a truncation
 * below the cursor, and `size < lastSize` catches one ABOVE it — a file cut
 * from 4096 to 200 while the cursor sits at 100 is ordinary growth to a
 * cursor-only test, and ingesting its tail as if it were the same file is the
 * silent skip D6 forbids.
 */
export function frameRead(
  cursor: number, data: string, size: number, lastSize: number,
): FramedRead {
  if (size < cursor || size < lastSize) return { lines: [], nextCursor: 0, shrank: true };
  const lastLf = data.lastIndexOf('\n');
  if (lastLf < 0) return { lines: [], nextCursor: cursor, shrank: false };
  const complete = data.slice(0, lastLf + 1);
  return {
    lines: complete.split('\n').slice(0, -1).filter((l) => l !== ''),
    nextCursor: cursor + Buffer.byteLength(complete, 'utf8'),
    shrank: false,
  };
}

import {
  compareGenerations, looksLikeGenerationFile, parseLifecycleGeneration,
  type LifecycleGapReason,
} from '../../../shared/api.js';

/** One generation as the mirror last left it. */
export interface KnownGeneration {
  readonly gen: string;
  readonly cursor: number;
  readonly size: number;
  readonly retired: boolean;
}

export interface PlannedGap {
  readonly gen: string;
  readonly reason: LifecycleGapReason;
  readonly detail: string;
  readonly lostFrom: number | null;
  readonly lostTo: number | null;
}

export interface SweepPlan {
  /** False when `readdir` answered null. NOTHING is read and — the half that
   *  matters — nothing is RETIRED: a dropped agent socket is not evidence
   *  that a generation was rotated away, and it is the same fail-shut
   *  direction `sweepDivergences` takes on its own registry listing. A field
   *  rather than an empty array, because the two are different facts. */
  readonly listed: boolean;
  /** Oldest generation first. `lastSize` is what `lifecycle_generations.size`
   *  said, and `frameRead` needs it to see a truncation that stayed ahead of
   *  the cursor. */
  readonly reads: readonly { readonly gen: string; readonly from: number; readonly lastSize: number }[];
  readonly gaps: readonly PlannedGap[];
  readonly retire: readonly string[];
  /** Names that LOOK like generations and cannot be ORDERED
   *  (`looksLikeGenerationFile` true, `parseLifecycleGeneration` null). Not
   *  read — placing them in the sequence is exactly what cannot be done — and
   *  not ignored either. The caller turns each into ONE gap row per process;
   *  a row per sweep would be an alarm that fires every five seconds, which is
   *  an alarm nobody reads. */
  readonly unorderable: readonly string[];
}

/**
 * Couples `lostFrom`/`lostTo` at the one point in this file that constructs a
 * `PlannedGap` (task 31 ruling). `LifecycleGap`'s wire type (`shared/api.ts`)
 * keeps them as two INDEPENDENT nullable fields — deliberately, to match
 * Task 27's already-reviewed schema, which has two separate columns — so
 * nothing in the type stops `{lostFrom: 500, lostTo: null}`, or a precise
 * range alongside `reason:'unknown'`. This file is the only producer of a
 * `LifecycleGap`, so the invariant is enforced HERE rather than in the type:
 * `lostFrom`/`lostTo` are always set as one pair, never independently, and a
 * `reason` of `'unknown'` always carries a null pair — there is no bounded
 * range for a hole the mirror could not place at all.
 */
function coupledLoss(
  reason: LifecycleGapReason, range: { readonly from: number; readonly to: number } | null,
): Pick<PlannedGap, 'lostFrom' | 'lostTo'> {
  const bounded = reason === 'unknown' ? null : range;
  return bounded === null
    ? { lostFrom: null, lostTo: null }
    : { lostFrom: bounded.from, lostTo: bounded.to };
}

/**
 * A rotation is "a new name appeared", never "the same file got smaller" —
 * which is the reason the generation lives in the filename (D1). So a
 * generation that stops being listed can only have been rotated away, and the
 * only question left is whether the mirror had finished draining it.
 *
 * A DRAINED generation that disappears records no gap: `_lc_rotate` deletes
 * oldest-first and only ever removes a generation that stopped growing when
 * the live one was minted, so `cursor === size` means there was nothing left
 * to lose. DISCLOSED RESIDUAL: bytes appended to a drained generation and
 * rotated away inside one sweep interval would be lost unrecorded. That
 * cannot happen while `_lc_rotate` mints rather than appends, and the
 * alternative — a gap row on every ordinary rotation — is an alarm that fires
 * when nothing is wrong.
 */
export function planSweep(
  names: readonly string[] | null, known: readonly KnownGeneration[],
): SweepPlan {
  if (names === null) {
    return { listed: false, reads: [], gaps: [], retire: [], unorderable: [] };
  }

  const unorderable = names.filter(
    (nm) => looksLikeGenerationFile(nm) && parseLifecycleGeneration(nm) === null,
  );
  // TWO QUESTIONS, TWO READERS (wave 1's own rule for this pair): "is it a
  // generation at all" and "can it be ordered". Only names that answer yes to
  // both are read; the ones that answer yes-then-no are reported above.
  const present = [...new Set(
    names.map(parseLifecycleGeneration).filter((g): g is string => g !== null),
  )].sort(compareGenerations);
  const presentSet = new Set(present);

  const gaps: PlannedGap[] = [];
  const retire: string[] = [];
  for (const k of known) {
    if (presentSet.has(k.gen) || k.retired) continue;
    retire.push(k.gen);
    if (k.cursor >= k.size) continue;
    gaps.push({
      gen: k.gen, reason: 'rotated-away',
      detail: `generation ${k.gen} stopped being listed with ${k.size - k.cursor} byte(s) undrained`,
      ...coupledLoss('rotated-away', { from: k.cursor, to: k.size }),
    });
  }

  const byGen = new Map(known.map((k) => [k.gen, k]));
  return {
    listed: true,
    reads: present.map((gen) => {
      const k = byGen.get(gen);
      return { gen, from: k?.cursor ?? 0, lastSize: k?.size ?? 0 };
    }),
    gaps, retire, unorderable,
  };
}

import type { LifecycleHealthState } from '../../../shared/api.js';

/**
 * THE ONE READER of this token in the whole server, and it stays one: wave 6
 * lands `capSupported(state, token)` in `ccdargv.ts` with the flag threading
 * that needs it, and this call site becomes its first caller then. A second
 * `verbs.includes('lifecycle-v1')` anywhere before that is a copy.
 *
 * Caps tokens negotiate a SERVER DECISION, not a file (spec §5): `lifecycle-v1`
 * decides "sweep at all".
 */
export const LC_CAP_TOKEN = 'lifecycle-v1';

/**
 * PURE, and deliberately clock-free: `nowMs` and `staleAfterMs` are inputs, so
 * the whole table is testable with no timers and this L1 file needs nothing
 * from `watch.ts`.
 *
 * THE NO-EVIDENCE DEFAULT IS NOT `unavailable`, and the three-way split is the
 * point. `unavailable` is a MEASURED absence — ccd answered `caps` and the
 * token was not there — and an operator may act on it. A null caps list is NO
 * EVIDENCE, so it degrades to whatever the sweep's own freshness says;
 * `unknown` is not knowing, and a reader must stay silent on it, exactly as
 * `FleetHealth.roster`'s own docstring requires of its third state.
 */
export function lifecycleState(input: {
  readonly ccdVerbs: readonly string[] | null;
  readonly lastOkAt: number | null;
  readonly nowMs: number;
  readonly staleAfterMs: number;
}): LifecycleHealthState {
  if (input.ccdVerbs !== null && !input.ccdVerbs.includes(LC_CAP_TOKEN)) return 'unavailable';
  if (input.lastOkAt === null) return 'unknown';
  const age = input.nowMs - input.lastOkAt;
  // `age >= 0` is not a style tic: without it a future-dated stamp stays
  // "< staleAfterMs" for the life of the process and reads fresh forever.
  // `sessionLifecycle` carries the identical guard, and states why at length.
  return age >= 0 && age < input.staleAfterMs ? 'ok' : 'stale';
}

/** Sweep on everything but a measured absence of the capability. `unknown` is
 *  no evidence, and the cost of guessing wrong there is one `readdir` per
 *  sweep that answers null — `verbSupported`'s permit-on-no-evidence trade,
 *  not `stopSurfaceSupported`'s inverted one, because the wrong guess here
 *  costs a cheap failed read rather than a silent success. */
export function shouldSweep(state: LifecycleHealthState): boolean {
  return state !== 'unavailable';
}
