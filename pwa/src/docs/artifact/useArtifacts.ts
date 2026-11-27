// The artifact tier's one client store (X5 A5.1; spec 2026-11-19 §3.2, §6.1). Ring L4: a module store, read with
// `useSyncExternalStore`, shared by the offer beside every HTML page, the launch sheet (A5.2) and the lists (A5.3), so the
// availability is read once for all of them and a mint or a revoke refreshes every reader at once.
//   - `list`: the availability read's answer. A FIRST read that is not ok (a failed read, a 401, a rejection, an unavailable answer
//     with no known reason) is `failed`, and the offer is hidden then: no sentence about a box state the console could not measure.
//     A failed list is read again by the next consumer that mounts and when a sign-in returns. A RE-read that is not ok never
//     replaces the last good answer: the store keeps that ok list and marks it `stale: true`, so the offer, an open sheet (and the
//     capability it minted) and the lists with their Revoke stay as they were, and the list says it could not read again. A good read
//     replaces it (`stale: false`); a consumer that mounts while it is stale reads again.
//   - `known`: the capabilities this console minted and has not seen revoked. A stale list lacks one minted while the re-read after
//     the mint failed, so the list draws it from here, with its Revoke, until a good read settles it or a revoke of it ends. A good
//     read settles only what was noted BEFORE that read started (a read that began earlier may not hold a capability minted after
//     it): each note takes the next number, a read records the last number at its start, and a good read keeps the later notes.
//   - `sheetFor`: the page key whose launch sheet is open. It lives here and not in the offer, because `MockupView` is keyed by a
//     draft's fingerprint and remounts, and a remount must not close a sheet the operator is using.
// The doors come from `ArtifactDoorsContext`; its default is `api.docs.artifacts`, and tests provide a fake.
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { ARTIFACT_OFF_WHYS, type ArtifactListOk, type ArtifactRow } from '../../../../shared/artifacts';
import { api } from '../../lib/api';
import { useAuthLost } from '../../lib/auth';
import type { ArtifactAvailability, ArtifactDoors, ArtifactKnown } from './tier';

export type ArtifactListState =
  | { readonly s: 'idle' }
  | { readonly s: 'loading' }
  | { readonly s: 'ok'; readonly avail: ArtifactAvailability; readonly live: readonly ArtifactRow[]; readonly stale: boolean }
  | { readonly s: 'failed' };

export interface ArtifactsState {
  readonly list: ArtifactListState;
  readonly sheetFor: string | null;
  /** The capabilities this console minted and has not seen revoked: a stale list that lacks one still lists it. A good read clears
   *  the ones noted before it started. */
  readonly known: readonly ArtifactKnown[];
}

/** `api.docs.artifacts`, looked up at call time (never at import), so a suite that replaces `api` still imports this module. */
const API_DOORS: ArtifactDoors = {
  list: () => api.docs.artifacts.list(),
  scope: (project, pin, signal) => api.docs.artifacts.scope(project, pin, signal),
  mint: (ask) => api.docs.artifacts.mint(ask),
  revoke: (id) => api.docs.artifacts.revoke(id),
  revokeAll: () => api.docs.artifacts.revokeAll(),
};

/** The doors the offer, the sheet and the lists call. The default is `api.docs.artifacts`; tests provide a fake. */
export const ArtifactDoorsContext = createContext<ArtifactDoors>(API_DOORS);

/** A page's key: its project, section and path, joined by U+0000. */
export const artifactPageKey = (project: string, section: string, path: string): string => [project, section, path].join('\u0000');

const IDLE: ArtifactsState = { list: { s: 'idle' }, sheetFor: null, known: [] };
let state: ArtifactsState = IDLE;
// Bumped by a reset, so a read that started before it never publishes into the next test's store.
let generation = 0;
// Each read takes the next number and only the newest publishes, so answers that arrive out of order never leave the older one standing.
let newest = 0;
// How many reads are in flight now: a consumer that mounts, or a sign-in that returns, starts none while one is.
let inflight = 0;
// When the last ok answer was published (`Date.now()`), or null before one: the one clock `ensureFresh` reads.
let readAt: number | null = null;
// Each noted capability takes the next number: a read records the last one at its start, and a good read settles only the notes
// numbered at or below it. `notedAt` holds the number of every id in `state.known`.
let notedSeq = 0;
const notedAt = new Map<string, number>();
const listeners = new Set<() => void>();

function publish(next: ArtifactsState): void {
  state = next;
  for (const fn of [...listeners]) fn();
}
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
const snapshot = (): ArtifactsState => state;

/** The list answer as the store holds it. An unavailable answer must name a reason this build knows: a missing or unknown `why` is a
 *  read the console cannot word, so it is `failed` and the offer stays hidden, never the setup sentence by default. */
function listOf(value: ArtifactListOk): ArtifactListState {
  if (value.available) return { s: 'ok', avail: { available: true }, live: value.live, stale: false };
  const why = value.why;
  if (why === undefined || !(ARTIFACT_OFF_WHYS as readonly string[]).includes(why)) return { s: 'failed' };
  return { s: 'ok', avail: { available: false, why }, live: value.live, stale: false };
}

/** Reads the availability once more. The store keeps its last ok answer while it reads, so a refresh never flashes the offer away,
 *  and a re-read that is not ok (a failed answer, a rejection, an unavailable answer with no known reason) keeps it too, marked
 *  `stale`: the last good answer is what is offered and listed until a good read replaces it. With no ok list held (idle, loading,
 *  failed) a not-ok answer is `failed`, as before. */
async function read(doors: ArtifactDoors): Promise<void> {
  const mine = generation;
  const my = ++newest;
  const before = notedSeq;
  inflight += 1;
  if (state.list.s === 'idle' || state.list.s === 'failed') publish({ ...state, list: { s: 'loading' } });
  let next: ArtifactListState;
  try {
    const answer = await doors.list();
    next = answer.s === 'ok' ? listOf(answer.value) : { s: 'failed' };
  } catch {
    // A door never rejects for a server answer; a defect leaves the offer hidden rather than raising in an effect.
    next = { s: 'failed' };
  }
  if (mine !== generation) return;
  inflight -= 1;
  if (my === newest) {
    if (next.s === 'ok') readAt = Date.now();
    const held = state.list;
    // A good read is the server's list at the time it was taken, which settles the capabilities noted before it started; one noted
    // after it (a mint that answered while it was out) may be missing from it, so it stays known until a later good read.
    if (next.s === 'ok') {
      const kept = state.known.filter((k) => (notedAt.get(k.id) ?? 0) > before);
      for (const id of [...notedAt.keys()]) if (!kept.some((k) => k.id === id)) notedAt.delete(id);
      publish({ ...state, list: next, known: kept });
    } else {
      publish({ ...state, list: held.s === 'ok' ? { ...held, stale: true } : next });
    }
  }
}

/** Puts the store back as a fresh page load has it. For tests. */
export function resetArtifactsForTest(): void {
  generation += 1;
  inflight = 0;
  readAt = null;
  notedSeq = 0;
  notedAt.clear();
  state = IDLE;
  for (const fn of [...listeners]) fn();
}

export interface UseArtifacts {
  readonly state: ArtifactsState;
  /** Reads the availability and the live list again (after a mint or a revoke). */
  refresh(): Promise<void>;
  /** Reads again when the last ok answer is older than `maxAgeMs` and no read is in flight: the one rule for a list that was left
   *  standing while the page was open elsewhere (a link another tab minted, or that lapsed). A store with no ok answer yet is left to
   *  the mount's own read. */
  ensureFresh(maxAgeMs: number): void;
  openSheet(key: string): void;
  closeSheet(): void;
  /** Notes a capability this console just minted, so a stale list that lacks it still lists it (no duplicate id). */
  noteMinted(k: ArtifactKnown): void;
  /** Forgets one noted capability (its revoke ended) or every one (Revoke all ended). */
  forgetKnown(id: string): void;
  forgetAllKnown(): void;
}

export function useArtifacts(): UseArtifacts {
  const doors = useContext(ArtifactDoorsContext);
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  // A consumer that mounts finds the list never read, or failed, and reads it (one read in flight at a time); the others find it
  // loading or answered. Read the store, not the render's copy.
  useEffect(() => {
    const held = state.list;
    if (held.s === 'idle' || ((held.s === 'failed' || (held.s === 'ok' && held.stale)) && inflight === 0)) void read(doors);
  }, [doors]);
  // A sign-in that returns reads the list again, whatever it holds (a 401 left it failed). It watches the auth signal as a value
  // (`useAuthLost`) and reads on the lost-to-live edge, not through `onAuthRegained`, whose listeners the mockup view's tests count
  // one by one (review 2378 F1): a listener of this store would be one the view never asked for. The first consumer's read is in
  // flight before the next one's effect runs, so one sign-in is one read.
  const { lost } = useAuthLost();
  const wasLost = useRef(lost);
  useEffect(() => {
    if (wasLost.current && !lost && inflight === 0) void read(doors);
    wasLost.current = lost;
  }, [lost, doors]);
  const refresh = useCallback(() => read(doors), [doors]);
  const ensureFresh = useCallback((maxAgeMs: number): void => {
    if (state.list.s === 'ok' && inflight === 0 && readAt !== null && Date.now() - readAt > maxAgeMs) void read(doors);
  }, [doors]);
  const openSheet = useCallback((key: string) => publish({ ...state, sheetFor: key }), []);
  const closeSheet = useCallback(() => publish({ ...state, sheetFor: null }), []);
  const noteMinted = useCallback((k: ArtifactKnown) => {
    if (state.known.some((n) => n.id === k.id)) return;
    notedSeq += 1;
    notedAt.set(k.id, notedSeq);
    publish({ ...state, known: [...state.known, k] });
  }, []);
  const forgetKnown = useCallback((id: string) => {
    notedAt.delete(id);
    publish({ ...state, known: state.known.filter((n) => n.id !== id) });
  }, []);
  const forgetAllKnown = useCallback(() => {
    notedAt.clear();
    publish({ ...state, known: [] });
  }, []);
  return { state: now, refresh, ensureFresh, openSheet, closeSheet, noteMinted, forgetKnown, forgetAllKnown };
}
