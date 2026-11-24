// The caps control's usage reading, in words (spec 2026-11-19 "waiting workers sleep and hold no slot", Part 3, D-8792).
// Pure: `CapsControl` renders what this answers and decides nothing itself.
//
// The ONE READER of `CoordCapsUsage.waiting` and `workingOnly`, the server's count of active runs whose worker was
// measured waiting or asleep, and whether the cap leaves them out (the `cap-counts-working` Shadow lanes row armed).
// Both fields are additive: an older server omits them, and then the reading is today's `running / cap`, never a guessed
// zero.
import type { CoordCapsUsage, CoordCapsView } from '../../../shared/api';
import { readCapNow, type CoordCapDerived } from '../../../shared/runCap';
import type { HostUnmeasuredWhy } from '../../../shared/pressure';

/** The usage against the cap, as one reading. Armed: `3 / 4 working, 2 waiting`, the runs that hold a slot and then the
 *  ones left out. Shadow: `5 / 4, 2 of them waiting`, the count the cap still uses, and how many of it wait. Without a
 *  usable `waiting` (an older server): `5 / 4`, as before. */
export function capsUsageWords(usage: CoordCapsUsage, cap: number): string {
  const waiting = usage.waiting;
  if (typeof waiting !== 'number' || !Number.isInteger(waiting) || waiting < 0) return `${usage.running} / ${cap}`;
  if (usage.workingOnly === true) return `${Math.max(0, usage.running - waiting)} / ${cap} working, ${waiting} waiting`;
  return `${usage.running} / ${cap}, ${waiting} of them waiting`;
}

// ── the cap in force, and where it comes from (D-8920) ────────────────────────────────────────────────
// The run cap is derived from the machine the fleet runs on (the operator's ruling of 2026-11-22), so the control shows
// that number and what it was derived from, and the number box is only the operator's override. `readCapNow`
// (`shared/runCap.ts`) is the one reader of the server's `capNow`; the functions below are its only callers in the console.
// An older server sends no `capNow`, and then the control reads as it did before: the stored number, no sentence.
/** The cap in force: the server's `capNow.cap`, or the stored number when the server sends none (an older server). */
export function capInForce(view: CoordCapsView): number {
  return readCapNow(view)?.cap ?? view.caps.maxConcurrentWorkers;
}

/** Whether the operator's own number stands, which is when "use automatic" has something to clear. False for an older
 *  server: it has no automatic cap to return to, and is never sent a `mode`. */
export function capIsOverride(view: CoordCapsView): boolean {
  return readCapNow(view)?.mode === 'override';
}

/** Whether the number on screen is the server's own (derived, or the stored number an unmeasured host falls back to)
 *  and not one the operator set. Then ANY number saved from the box is a new fact, the one on screen included: that is
 *  how the operator fixes the cap at the number they see. False for an older server, whose number is the operator's. */
export function capIsAutomatic(view: CoordCapsView): boolean {
  return readCapNow(view)?.mode === 'automatic';
}

const GIB = 2 ** 30;
/** Memory in GB as system tools print it (1 GB = 2^30 bytes): whole above ten, one decimal below. */
const memoryWords = (bytes: number): string => {
  const gb = bytes / GIB;
  return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
};
/** What the cap was derived from. With a limit on the sessions' memory below the box's own, BOTH figures are said: the
 *  box has one amount and the sessions may use another, and a reader who saw only the smaller would take it for the
 *  box. A limit at or above the box's memory limits nothing, and is not said. */
const derivedFrom = (d: Extract<CoordCapDerived, { kind: 'measured' }>): string => {
  const cores = `${d.cores} ${d.cores === 1 ? 'core' : 'cores'}`;
  const limit = d.sessionMemLimitBytes;
  return limit !== undefined && limit < d.memTotalBytes
    ? `from ${memoryWords(d.memTotalBytes)}, of which sessions may use ${memoryWords(limit)}, and ${cores}`
    : `from ${memoryWords(d.memTotalBytes)} and ${cores}`;
};

/** Why there is no automatic number, one sentence per remedy (`HostUnmeasuredWhy`): wait, update the agent, or look at
 *  the box. A `Record` over the type, so a reason added to it is a compile error until it has words here. */
const UNMEASURED_WORDS: Record<HostUnmeasuredWhy, { readonly why: string; readonly until: string }> = {
  'no-reading': { why: 'the fleet host has not been measured yet', until: ', until it is' },
  'agent-older': { why: 'the fleet agent is too old to measure its host', until: ', until the agent is updated' },
  'read-failed': { why: 'the fleet host\'s size could not be read', until: '' },
};

/** One sentence saying what the cap is and why, or `null` for an older server (no sentence, as before). */
export function capSourceWords(view: CoordCapsView): string | null {
  const now = readCapNow(view);
  if (now === null) return null;
  const d = now.derived;
  if (now.mode === 'override') {
    return d.kind === 'measured'
      ? `Set by hand: ${now.cap}. Automatic would be ${d.cap} (${derivedFrom(d)}).`
      : `Set by hand: ${now.cap}. There is no automatic number: ${UNMEASURED_WORDS[d.why].why}.`;
  }
  if (d.kind === 'measured') return `Automatic: ${now.cap} (${derivedFrom(d)})`;
  const w = UNMEASURED_WORDS[d.why];
  return `Automatic, but ${w.why}. Using the stored number, ${now.cap}${w.until}.`;
}
