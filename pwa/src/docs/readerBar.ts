// The reader's bar, published for the Docs header (the library 1.1 take-up plan, refinements (f), (i)): what the one bar
// needs of a ready frame that was mounted with ccrc's bar: the document's title, the frame's commands and how far it has
// been read. `DocsScreen` provides the slot: which bar a mount asks for (decided by the screen's width, through
// `policy.ts#readerChromeFor`) and where the bar is published. `ReaderFrame` reads the bar when its mount starts,
// publishes the handle while that frame is ready, and withdraws it (`null`) when the frame falls back or goes; the screen
// hands it to `DocsHead`, as it hands Export's body. The reader lab mounts without `ReaderFrame`, so it never sees the
// slot. Progress is a small store, read by the head's reading line alone, so a report re-renders one element.
// Ring L4: a context, a hook and a store; it decides nothing.
import { createContext, useContext, useEffect } from 'react';
import type { ReaderChrome, ReaderCommand } from './reader/policy';

/** How far the document has been read, 0 to 1: the frame's latest report. */
export interface ReaderProgress {
  read(): number;
  subscribe(listener: () => void): () => void;
}

/** A ready frame on ccrc's bar, as the head drives it. */
export interface ReaderBar {
  readonly title: string;
  /** Runs one of the reader's tools as a toggle; call it from the tap's own handler. */
  command(name: ReaderCommand): void;
  readonly progress: ReaderProgress;
}

/** Which bar a mount asks for, and where its handle is published. `null` context: no Docs screen above (the frame's own bar). */
export interface ReaderBarSlot {
  readonly chrome: ReaderChrome;
  publish(bar: ReaderBar | null): void;
}

export const ReaderBarContext = createContext<ReaderBarSlot | null>(null);

/** A progress store starting at 0; `set` stores a share and tells every listener. */
export function createReaderProgress(): ReaderProgress & { set(share: number): void } {
  let share = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => share,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next) {
      share = next;
      for (const l of listeners) l();
    },
  };
}

/** Publishes `bar` while it stands and the component is mounted, and withdraws it after. The caller keeps `bar` stable. */
export function usePublishReaderBar(bar: ReaderBar): void {
  const slot = useContext(ReaderBarContext);
  useEffect(() => {
    if (slot === null) return undefined;
    slot.publish(bar);
    return () => slot.publish(null);
  }, [slot, bar]);
}
