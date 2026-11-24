// The console's one reader of the Overlord (Overlord W1 home, Task 2; plan Global Constraints, "One reader per fact"): L4. It
// reads the server's capability words (`GET /health`'s `caps`), the designation and the ladder, and keeps each as a
// `ReadState`. The bars, the home route, the place and the Settings rows all read this store; none fetches on its own.
//
// WHEN IT READS. At start, when the page comes back to the front, every `OVERLORD_POLL_MS` while the page is visible, and at
// once after any of the Overlord's doors answers (`refreshOverlord`). Each visible tick reads the designation and the ladder
// (with the word); the capability words are read at start, on the page coming back to the front, and on a tick while their
// last read failed (`readFailed`), so a failed first read recovers with no reload and no second timer. An answer without the
// word is an answer, not a failure: it is read again only when the page comes back. A hidden page does not poll.
//
// NO OVERLORD READ WITHOUT THE WORD (plan question 9). While the server does not advertise `overlord-v1`, only the caps are
// read, so a server without the word sees none of the Overlord's reads.
//
// IT DECIDES NOTHING. Each answer becomes its next state through `nextReadState` (L1), and every hook below derives through
// the L1 deciders (`homePlace.ts`). A late answer of an earlier call never overwrites a later one (`seq`).
import { useMemo } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { DesignationView } from '../../../shared/overlord-designation';
import type { LadderWire } from '../../../shared/overlord-ladder';
import { api, ApiError, ApiTimeout } from '../lib/api';
import { onPageVisible } from '../lib/pageClock';
import {
  capReadOf, designationStateOf, homePlace, homeSettled, overlordShown, rungReadOf,
  type DesignationState, type HomeAnswer, type RungRead,
} from '../overlord/homePlace';
import { nextReadState, readFailed, type ReadOutcome } from '../overlord/readOutcome';
import type { ReadState } from '../overlord/readState';

/** How often a visible page re-reads the designation and the ladder. */
export const OVERLORD_POLL_MS = 60_000;

type Absent = { readonly absent: true };
/** The three calls, injectable for tests; the default is `lib/api.ts`'s. */
export interface OverlordReads {
  caps(): Promise<{ readonly caps?: readonly string[] }>;
  designation(): Promise<{ readonly designation: DesignationView | null } | Absent>;
  ladder(): Promise<LadderWire | Absent>;
}

export interface OverlordStoreDeps {
  readonly reads?: OverlordReads;
  readonly now?: () => number;
}

export interface OverlordState {
  readonly caps: ReadState<readonly string[]>;
  readonly designation: ReadState<DesignationView | null>;
  readonly ladder: ReadState<LadderWire>;
  /** Start reading; the answer stops it. Counted, so two starters share one poll and the last stop ends it. */
  start(): () => void;
  /** Re-read the designation and the ladder now (after a door answered), when the word is advertised. */
  refresh(): Promise<void>;
  /** Re-read everything now, the caps first. */
  readAll(): Promise<void>;
}

export type OverlordStore = UseBoundStore<StoreApi<OverlordState>>;

const DEFAULT_READS: OverlordReads = {
  caps: () => api.serverCaps(),
  designation: () => api.overlordDesignation(),
  ladder: () => api.overlordLadder(),
};

/** A failure's words, as the place prints them: never a value. */
function failureWords(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status}`;
  if (err instanceof ApiTimeout) return 'timeout';
  return err instanceof Error ? err.message : String(err);
}

const isAbsent = (v: object): v is Absent => 'absent' in v && (v as Absent).absent === true;
/** A 2xx body without the read's own field: not a value, so it is a failure the place prints, never a row read as nothing. */
const UNREADABLE = { kind: 'failed', error: 'unreadable answer' } as const;

export function createOverlordStore(deps: OverlordStoreDeps = {}): OverlordStore {
  const reads = deps.reads ?? DEFAULT_READS;
  const now = deps.now ?? Date.now;
  const seq = { caps: 0, designation: 0, ladder: 0 };
  let starters = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopVisible: (() => void) | null = null;

  return create<OverlordState>()((set, get) => {
    /** One call, its outcome folded into its state; a later call's answer wins over an earlier one's. */
    async function read<K extends 'caps' | 'designation' | 'ladder'>(
      key: K, call: () => Promise<ReadOutcome<OverlordState[K] extends ReadState<infer T> ? T : never>>,
    ): Promise<void> {
      const mine = ++seq[key];
      const outcome = await call().catch((err: unknown) => ({ kind: 'failed', error: failureWords(err) }) as const);
      if (mine !== seq[key]) return;
      set({ [key]: nextReadState(get()[key] as ReadState<never>, outcome as ReadOutcome<never>, now()) } as Partial<OverlordState>);
    }
    const shown = (): boolean => overlordShown(capReadOf(get().caps));

    const refresh = async (): Promise<void> => {
      if (!shown()) return;
      await Promise.all([
        read('designation', async () => {
          const body = await reads.designation();
          if (isAbsent(body)) return { kind: 'absent' };
          return 'designation' in body ? { kind: 'value', value: body.designation } : UNREADABLE;
        }),
        read('ladder', async () => {
          const body = await reads.ladder();
          if (isAbsent(body)) return { kind: 'absent' };
          return typeof body.operatorRung === 'string' ? { kind: 'value', value: body } : UNREADABLE;
        }),
      ]);
    };
    const readAll = async (): Promise<void> => {
      // An older server's `/health` carries no `caps`: it advertises no word, which is an answer, not a failure.
      await read('caps', async () => ({ kind: 'value', value: (await reads.caps()).caps ?? [] }));
      await refresh();
    };

    return {
      caps: { state: 'loading' },
      designation: { state: 'loading' },
      ladder: { state: 'loading' },
      refresh,
      readAll,
      start: () => {
        starters += 1;
        if (starters === 1) {
          void readAll();
          timer = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            void (readFailed(get().caps) ? readAll() : refresh());
          }, OVERLORD_POLL_MS);
          stopVisible = onPageVisible(() => { void readAll(); });
        }
        let stopped = false;
        return () => {
          if (stopped) return;
          stopped = true;
          starters -= 1;
          if (starters > 0) return;
          if (timer !== null) clearInterval(timer);
          timer = null;
          stopVisible?.();
          stopVisible = null;
        };
      },
    };
  });
}

export const useOverlordStore: OverlordStore = createOverlordStore();

/** Re-read the designation and the ladder now: every Overlord door calls it after its answer. */
export function refreshOverlord(): Promise<void> {
  return useOverlordStore.getState().refresh();
}

/** Whether the server advertises `overlord-v1` (an answered read naming it). */
export function useOverlordShown(): boolean {
  return useOverlordStore((s) => overlordShown(capReadOf(s.caps)));
}

export function useDesignationState(): DesignationState {
  const read = useOverlordStore((s) => s.designation);
  return useMemo(() => designationStateOf(read), [read]);
}

export function useLadder(): ReadState<LadderWire> {
  return useOverlordStore((s) => s.ladder);
}

export function useRungRead(): RungRead {
  const read = useOverlordStore((s) => s.ladder);
  return useMemo(() => rungReadOf(read), [read]);
}

/** Where the console's home is, from the three reads through `homePlace` alone. */
export function useHome(): HomeAnswer {
  const caps = useOverlordStore((s) => s.caps);
  const designation = useOverlordStore((s) => s.designation);
  const ladder = useOverlordStore((s) => s.ladder);
  return useMemo(
    () => homePlace(capReadOf(caps), designationStateOf(designation), rungReadOf(ladder)),
    [caps, designation, ladder],
  );
}

/** Whether no read the home depends on is still loading (`homeSettled`). */
export function useHomeSettled(): boolean {
  return useOverlordStore((s) => homeSettled(s.caps, s.designation, s.ladder));
}
