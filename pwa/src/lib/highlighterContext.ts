// The highlighting seam (native Docs reader, W5h-a Task 6; base spec 2026-10-01 section 4.10 "Tests"). One context,
// `HighlighterContext`, whose default is the production value, `HIGHLIGHTER_DEFAULT`: the two singletons
// (`docsHighlighter`, `chatHighlighter`) and `createProductionStore`, which builds a store on the real clock.
// `DocTree`, `TextBody`, `ChatMarkdown` and the tool wells create their stores through it, by the two hooks below
// (`useDocsHighlightStore`, `useChatHighlightStore`), the one place a store's lifecycle is written; tests replace it with
// `pwa/test/highlightTestStore.tsx`'s values, never as the default (M4.H17). The default needs no provider, so the
// app root has none (the W5h-a plan's refinement (o)). A Docs page's store and a text leaf's are also published
// through the optional `publish` slot, which Export's sheet will read; nothing provides the slot in production yet
// (refinement (h)).
//
// Ring L4 composition: it binds the production singletons and the store's real clock (timers).
import { createContext, useContext, useEffect, useMemo } from 'react';
import { createHighlightStore, type CodeBlockText, type HighlightClock, type HighlightStore } from './highlightStore';
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

/** A production store: the page ceilings on, chat's debounce for a chat store (section 4.10). */
export function createProductionStore(highlighter: Highlighter, mode: 'docs' | 'chat'): HighlightStore {
  return createHighlightStore(highlighter, { mode }, REAL_CLOCK);
}

export const HIGHLIGHTER_DEFAULT: HighlighterContextValue = {
  docs: docsHighlighter, chat: chatHighlighter, createStore: createProductionStore,
};

export const HighlighterContext = createContext<HighlighterContextValue>(HIGHLIGHTER_DEFAULT);

/** A Docs store for `blocks` (a parsed tree's code blocks, or a text leaf's one block): created on the Docs
 *  highlighter and seeded with `blocks` when they change, before any request; published through `publish` while it
 *  lives; released and withdrawn when `blocks` change or the caller unmounts. `null`: nothing to highlight, so no
 *  store. The caller memoises `blocks`, one array per parsed tree or per leaf text, which is what keys the store's
 *  lifetime (refinement (o)). Call it inside the boundary that draws the blocks, so a body that falls back to plain
 *  text publishes no store that would never settle. */
export function useDocsHighlightStore(blocks: readonly CodeBlockText[]): HighlightStore;
export function useDocsHighlightStore(blocks: readonly CodeBlockText[] | null): HighlightStore | null;
export function useDocsHighlightStore(blocks: readonly CodeBlockText[] | null): HighlightStore | null {
  const highlighters = useContext(HighlighterContext);
  const store = useMemo(() => {
    if (blocks === null) return null;
    const s = highlighters.createStore(highlighters.docs, 'docs');
    s.seed(blocks);
    return s;
  }, [highlighters, blocks]);
  useEffect(() => {
    if (store === null) return undefined;
    highlighters.publish?.(store);
    return () => {
      store.releaseAll();
      highlighters.publish?.(null);
    };
  }, [highlighters, store]);
  return store;
}

/** A chat store (a message's, a tool well's) on chat's highlighter, released when it goes. Eviction stays the
 *  caller's `useEvictAfterCommit`, called after its blocks' effects: bundled here it would run before the block's
 *  own request effect. */
export function useChatHighlightStore(): HighlightStore {
  const highlighters = useContext(HighlighterContext);
  const store = useMemo(() => highlighters.createStore(highlighters.chat, 'chat'), [highlighters]);
  useEffect(() => () => store.releaseAll(), [store]);
  return store;
}
