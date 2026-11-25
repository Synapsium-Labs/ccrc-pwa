// The console's authority witness (Overlord W1 authority journal plan, Task 6; spec §7.6): what this device keeps of the server's
// journals, so a restore of the server's volume shows as the console holding more than the server. L3 by `pwaRing` (it names the
// browser's storage and the clock) and the one writer of the key below. The tuple's parse and keep rule are L0 (`shared/`).
//
// By the plan, unreadable storage, no stored value and an unparseable value all send `held: null` ("no witness"). The exchange never
// throws: a refused call, a failed call and an offer that does not parse are distinct answers.
import { parseWitnessTuple, witnessKeep, type WitnessTuple } from '../../../shared/authorityWitness';
import { ApiError } from './apiError';
import { api } from './api';
import { onPageHidden, onPageVisible } from './pageClock';
import { pageStorage, readKey, writeKey, UNREADABLE, type StorageSource } from './storage';

// Not `ccrc:authority-witness:v1` as the plan words it: the resume banner's guard refuses any storage key that reads `auth`
// (departure `witness-key-avoids-auth`).
export const WITNESS_KEY = 'ccrc:overlord-witness:v1';
export const WITNESS_EVERY_MS = 60_000;

export type WitnessOutcome =
  | { kind: 'offer'; kept: WitnessTuple; wrote: boolean }
  | { kind: 'refused'; status: number; error: string | null }
  | { kind: 'malformed' }
  | { kind: 'failed' };

export interface WitnessDeps { ask?: (held: WitnessTuple | null) => Promise<unknown>; from?: StorageSource }

/** What this device holds: a tuple, or `null` for unreadable storage, nothing stored and a value that does not parse. */
function heldTuple(from: StorageSource): WitnessTuple | null {
  const raw = readKey(WITNESS_KEY, from, UNREADABLE);
  if (raw === null || raw === UNREADABLE) return null;
  try {
    const p = parseWitnessTuple(JSON.parse(raw));
    return p.ok ? p.tuple : null;
  } catch {
    return null;
  }
}

/** Exchange what was held when the call started; apply the keep rule to what is held when the answer is written. */
export async function exchangeWitness({ ask = api.overlordWitness, from = pageStorage }: WitnessDeps = {}): Promise<WitnessOutcome> {
  let answer: unknown;
  try {
    answer = await ask(heldTuple(from));
  } catch (e) {
    if (!(e instanceof ApiError)) return { kind: 'failed' };
    const word = (e.body as { error?: unknown } | null)?.error;
    return { kind: 'refused', status: e.status, error: typeof word === 'string' ? word : null };
  }
  const p = parseWitnessTuple((answer as { offer?: unknown } | null)?.offer);
  if (!p.ok) return { kind: 'malformed' };
  const keep = (): WitnessOutcome => {
    const latest = heldTuple(from);
    const kept = witnessKeep(latest, p.tuple);
    const wrote = kept !== latest && writeKey(WITNESS_KEY, JSON.stringify(kept), from);
    return { kind: 'offer', kept, wrote };
  };
  try {
    // Only the storage read and write need the origin-wide lock. Browsers without Web Locks still re-read immediately before writing.
    const locks = globalThis.navigator?.locks;
    return locks === undefined ? keep() : await locks.request(WITNESS_KEY, keep);
  } catch {
    return { kind: 'failed' };
  }
}

export interface WitnessSchedule {
  exchange?: () => Promise<unknown>;
  /** The page's visibility: the page clock's two subscriptions (the one owner of `visibilitychange`) and a read. */
  page?: { visible: () => boolean; onVisible: (h: () => void) => () => void; onHidden: (h: () => void) => () => void };
}
const PAGE = { visible: () => document.visibilityState === 'visible', onVisible: onPageVisible, onHidden: onPageHidden };
let nudgeActive: (() => void) | null = null;

/** Exchange now, then every 60 s while the document is visible (no timer while hidden; one more at once on visible). At most one
 *  exchange is in flight; a nudge or tick during one schedules exactly one more. Returns the stop. */
export function startWitnessExchange({ exchange = () => exchangeWitness(), page = PAGE }: WitnessSchedule = {}): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let flying = false;
  let again = false;
  const run = (): void => {
    if (flying) { again = true; return; }
    flying = true;
    void exchange().catch(() => undefined).finally(() => {
      flying = false;
      if (again) { again = false; run(); }
    });
  };
  const sync = (): void => {
    if (timer !== null) { clearInterval(timer); timer = null; }
    if (page.visible()) { run(); timer = setInterval(run, WITNESS_EVERY_MS); }
  };
  const stops = [page.onVisible(sync), page.onHidden(sync)];
  sync();
  const nudge = (): void => run();
  nudgeActive = nudge;
  return () => {
    for (const stop of stops) stop();
    if (timer !== null) clearInterval(timer);
    if (nudgeActive === nudge) nudgeActive = null;
  };
}

/** Another piece calls this after a narrowing door; a no-op while no exchange runs (signed out). */
export const nudgeWitness = (): void => nudgeActive?.();
