// The run cap's wire vocabulary (D-8920; the operator's ruling of 2026-11-22: the run cap is derived from
// the machine the fleet runs on, never typed). L0: the server decides these values (`server/src/coord/caps.ts`), the caps
// view carries them as `CoordCapsView.capNow` (`shared/api.ts`), and the console reads them through `readCapNow` alone.
// It lives here and not in `shared/api.ts`, which is capped (`server/test/growth-caps/`).
//
// Imports L0 only (types, and `shared/pressure.ts`'s list of reasons): the PWA bundles this file.
import type { CoordCaps } from './api.js';
import { HOST_UNMEASURED_WHYS, type HostUnmeasuredWhy } from './pressure.js';

/** `automatic`: the cap is derived from the fleet host's memory and cores. `override`: the operator set a number, which
 *  stands until they choose automatic again. A fresh box is `automatic`. A box upgraded onto this field keeps a number
 *  somebody set as an `override` (so the upgrade moves no cap), and is `automatic` when it still held the untouched
 *  seed (`coordinator_state.capMode`, migration 121). */
export type CapMode = 'automatic' | 'override';
const CAP_MODE_MAP: Record<CapMode, true> = { automatic: true, override: true };
/** Every `CapMode`, derived from the type. */
export const CAP_MODES: readonly CapMode[] = Object.keys(CAP_MODE_MAP) as CapMode[];

/** Which term of the formula set the derived cap (`server/src/coord/caps.ts#deriveCap`): the box's memory, the
 *  sessions' memory limit, the cores, or one of the two clamps (`floor`: the terms came to less than one run;
 *  `ceiling`: to more than the most a cap may be). */
export type CapBound = 'memory' | 'session-limit' | 'cores' | 'floor' | 'ceiling';
const CAP_BOUND_MAP: Record<CapBound, true> = { memory: true, 'session-limit': true, cores: true, floor: true, ceiling: true };
/** Every `CapBound`, derived from the type. */
export const CAP_BOUNDS: readonly CapBound[] = Object.keys(CAP_BOUND_MAP) as CapBound[];

/** What the automatic cap is, and what it was derived from.
 *  - `measured`: the cap, the term that set it, and the measured figures: the box's total memory, its cores, and
 *    `sessionMemLimitBytes` when the sessions have a memory limit (absent: they have none).
 *  - `unmeasured`: there is no derived cap, and `why` says which remedy applies (`HostUnmeasuredWhy`: nothing has
 *    answered yet, the fleet agent is too old to say, or the read failed). Never a cap of zero. */
export type CoordCapDerived =
  | { readonly kind: 'measured'; readonly cap: number; readonly bound: CapBound; readonly memTotalBytes: number;
      readonly cores: number; readonly sessionMemLimitBytes?: number }
  | { readonly kind: 'unmeasured'; readonly why: HostUnmeasuredWhy };

/** The cap in force (`cap`), by `mode` and by what the host measured (`derived`):
 *  - `override`: `cap` is the operator's number; `derived` says what automatic would be.
 *  - `automatic`, `derived.kind` `measured`: `cap` is `derived.cap`.
 *  - `automatic`, `derived.kind` `unmeasured`: `cap` is the STORED number (`CoordCapsView.caps`), used until the host
 *    is measured. The console says so, and why. */
export interface CoordCapNow { readonly mode: CapMode; readonly cap: number; readonly derived: CoordCapDerived }

/** `POST /api/coord/caps`'s body. `{ maxConcurrentWorkers: n }` sets the operator's override; `{ mode: 'automatic' }`
 *  clears it. ADDITIVE: a body from an older console carries the number alone, which is an override. */
export type CoordCapsWrite = Partial<CoordCaps> & { mode?: CapMode };

/** THE ONE READER of `CoordCapsView.capNow` (a wire boundary: validated, never trusted). Absent (an older server) and
 *  malformed alike are `null`, and the caller then shows the stored number as it did before the field existed. An
 *  `unmeasured` answer whose `why` is absent or unknown reads `no-reading`, the reason that asks nothing of anyone. */
export function readCapNow(view: unknown): CoordCapNow | null {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!obj(view)) return null;
  const n = view['capNow'];
  if (!obj(n)) return null;
  const { mode, cap, derived } = n;
  if (typeof mode !== 'string' || !(CAP_MODES as readonly string[]).includes(mode) || !count(cap) || !obj(derived)) return null;
  if (derived['kind'] === 'unmeasured') {
    const why = derived['why'];
    const known = typeof why === 'string' && (HOST_UNMEASURED_WHYS as readonly string[]).includes(why);
    return { mode: mode as CapMode, cap, derived: { kind: 'unmeasured', why: known ? why as HostUnmeasuredWhy : 'no-reading' } };
  }
  if (derived['kind'] !== 'measured') return null;
  const { cap: derivedCap, bound, memTotalBytes, cores, sessionMemLimitBytes: limit } = derived;
  if (!count(derivedCap) || !count(memTotalBytes) || !count(cores)) return null;
  if (limit !== undefined && !count(limit)) return null;
  if (typeof bound !== 'string' || !(CAP_BOUNDS as readonly string[]).includes(bound)) return null;
  return { mode: mode as CapMode, cap,
    derived: { kind: 'measured', cap: derivedCap, bound: bound as CapBound, memTotalBytes, cores, ...(limit === undefined ? {} : { sessionMemLimitBytes: limit }) } };
}
