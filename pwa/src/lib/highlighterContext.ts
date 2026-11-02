// The highlighting seam (native Docs reader, W5h-a Task 6; base spec 2026-10-01 section 4.10 "Tests"). One context,
// `HighlighterContext`, whose default is the production value, `HIGHLIGHTER_DEFAULT`: the two singletons
// (`docsHighlighter`, `chatHighlighter`) and `createProductionStore`, which builds a store on the real clock.
// `DocParse`, `TextBody`, `ChatMarkdown` and the tool wells create their stores through it; tests replace it with
// `pwa/test/highlightTestStore.tsx`'s values, never as the default (M4.H17). The default needs no provider, so the
// app root has none (the W5h-a plan's refinement (o)). A Docs page's store and a text leaf's are also published
// through the optional `publish` slot, which Export's sheet will read; nothing provides the slot in production yet
// (refinement (h)).
//
// Ring L4 composition: it binds the production singletons and the store's real clock (timers).
import { createContext } from 'react';
import { createHighlightStore, type HighlightClock, type HighlightStore } from './highlightStore';
import type { Highlighter } from './highlightProtocol';
import { chatHighlighter, docsHighlighter } from './markdownRunner';

export interface HighlighterContextValue {
  readonly docs: Highlighter;
  readonly chat: Highlighter;
  readonly createStore: (highlighter: Highlighter, mode: 'docs' | 'chat') => HighlightStore;
  /** The page's or text leaf's store, handed up for the leaf's actions; `null` when that store is gone. Absent:
   *  nobody reads it. */
  readonly publish?: (store: HighlightStore | null) => void;
}

const REAL_CLOCK: HighlightClock = {
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A production store: part 1's bounds and the ceilings on, chat's debounce for a chat store (section 4.10). */
export function createProductionStore(highlighter: Highlighter, mode: 'docs' | 'chat'): HighlightStore {
  return createHighlightStore(highlighter, { mode }, REAL_CLOCK);
}

export const HIGHLIGHTER_DEFAULT: HighlighterContextValue = {
  docs: docsHighlighter, chat: chatHighlighter, createStore: createProductionStore,
};

export const HighlighterContext = createContext<HighlighterContextValue>(HIGHLIGHTER_DEFAULT);
