// The highlighting seam's test values (native Docs reader, W5h-a Task 6; base spec 2026-10-01 section 4.10 "Tests" and
// section 4.12's chat table). jsdom has no `Worker`, so the production highlighters answer `worker-unavailable` there
// and every block stays plain. A test that needs colours renders under one of these:
//   - `syncTestStore(mode)`: a store whose `peek` colours a key in-thread, at once, on the highlight worker's own
//     instance (`highlightGrammars.ts#HLJS`), and runs the main thread's check on the result, so the sink receives a
//     `CheckedHighlightHtml`. It never asks a highlighter and is always settled. `renderToStaticMarkup` reads it, so
//     `markdown-golden.test.tsx`'s stored files stay byte-identical (M4.M1) and M4.P10 holds over settled output.
//     `vi.spyOn(HLJS, 'highlight')` counts what it colours.
//   - `SYNC_HIGHLIGHT` / `withSyncHighlight(node)`: a `HighlighterContext` value whose stores are `syncTestStore`s.
//   - `withSyncStore(node, store?)`: a `PreHighlightContext` provider, for a `CodeBlock` or a renderer drawn directly.
//   - `inThreadHighlighter({hold})`: a `Highlighter` that answers through the worker's own answerer in-thread, one
//     microtask later, or when the test calls `release()`; `inThreadContext(...)`: production stores over two of them,
//     so a test runs the real store, its ceilings and its check, and waits for the colours.
// This file is under `pwa/test`; nothing under `pwa/src` imports it (M4.H17, `docs-scans.test.ts`).
import type { ReactNode } from 'react';
import { HLJS } from '../src/lib/highlightGrammars';
import { createHighlightAnswerer } from '../src/lib/highlightJob';
import type { Highlighter, HighlighterStatus, HighlightOutcome, HighlightReply, HighlightRequest } from '../src/lib/highlightProtocol';
import { HighlighterContext, createProductionStore, type HighlighterContextValue } from '../src/lib/highlighterContext';
import { UNREQUESTED_ENTRY, blockKey, checkHighlightHtml, type HighlightEntry, type HighlightStore } from '../src/lib/highlightStore';
import { PreHighlightContext } from '../src/lib/markdown';
import { MD_HIGHLIGHT_MAX_HTML_CHARS } from '../src/lib/markdownLimits';

const NO_SUBSCRIPTION = (_listener: () => void): (() => void) => () => undefined;

/** A store whose `peek` colours a key in-thread, once (a later peek reads what it kept). `requests` lists every key
 *  a block requested. */
export function syncTestStore(mode: 'docs' | 'chat' = 'chat'): HighlightStore & { readonly requests: readonly string[] } {
  const kept = new Map<string, HighlightEntry>();
  const requests: string[] = [];
  const peek = (key: string): HighlightEntry => {
    const held = kept.get(key);
    if (held !== undefined) return held;
    const sep = key.indexOf('\u0000');
    if (sep === -1) return UNREQUESTED_ENTRY;
    let entry: HighlightEntry;
    try {
      const html = HLJS.highlight(key.slice(sep + 1), { language: key.slice(0, sep), ignoreIllegals: true }).value;
      const checked = html.length > MD_HIGHLIGHT_MAX_HTML_CHARS ? null : checkHighlightHtml(html);
      entry = checked !== null
        ? { kind: 'html', mode: 'block', checked }
        : { kind: 'plain', first: html.length > MD_HIGHLIGHT_MAX_HTML_CHARS ? { kind: 'too-large' } : { kind: 'malformed' }, retry: null };
    } catch (e) {
      // Not `highlightJob.ts`'s `errorName` (private to the worker's closure), and only the Error case matters here.
      entry = { kind: 'plain', first: { kind: 'threw', error: e instanceof Error ? e.name : typeof e }, retry: null };
    }
    kept.set(key, entry);
    return entry;
  };
  return {
    mode, debounceMs: 0, keyOf: (lang, raw) => blockKey(lang, raw), seed: () => undefined, peek,
    request: (key) => { requests.push(key); return () => undefined; }, show: () => () => undefined,
    subscribe: () => NO_SUBSCRIPTION, settled: () => true, evictUnreferenced: () => undefined,
    releaseAll: () => undefined, requests,
  };
}

export interface InThreadHighlighter extends Highlighter {
  /** Every request, in order, and the signal each came with. */
  readonly calls: HighlightRequest[];
  readonly signals: (AbortSignal | undefined)[];
  /** What `status()` answers. */
  state: HighlighterStatus;
  /** With `hold`: posts and answers every waiting request now. */
  release(): void;
}

/** A highlighter that answers through the worker's own answerer, in-thread: one microtask later, or, with `hold`, when
 *  the test calls `release()`. Its `onPosted` runs just before the answer. */
export function inThreadHighlighter(opts: { readonly hold?: boolean } = {}): InThreadHighlighter {
  const answer = createHighlightAnswerer();
  const waiting: (() => void)[] = [];
  let id = 0;
  const h: InThreadHighlighter = {
    calls: [],
    signals: [],
    state: 'live',
    highlight(request, o) {
      h.calls.push(request);
      h.signals.push(o.signal);
      return new Promise<HighlightOutcome>((resolve, reject) => {
        if (o.signal?.aborted) {
          reject(o.signal.reason);
          return;
        }
        o.signal?.addEventListener('abort', () => reject(o.signal!.reason), { once: true });
        const run = (): void => {
          o.onPosted?.();
          id += 1;
          answer({ id, ...request }, (r: HighlightReply) => { if ('result' in r) resolve(r.result); });
        };
        if (opts.hold === true) waiting.push(run);
        else queueMicrotask(run);
      });
    },
    status: () => h.state,
    prewarm: () => undefined,
    release: () => { for (const run of waiting.splice(0)) run(); },
  };
  return h;
}

/** Synchronous test stores for every store the tree creates. */
export const SYNC_HIGHLIGHT: HighlighterContextValue = {
  docs: inThreadHighlighter(), chat: inThreadHighlighter(), createStore: (_h, mode) => syncTestStore(mode),
};

/** Production stores over in-thread highlighters (by default two fresh ones), and, when given, a `publish` slot. */
export function inThreadContext(
  docs: Highlighter = inThreadHighlighter(), chat: Highlighter = inThreadHighlighter(),
  publish?: (store: HighlightStore | null) => void,
): HighlighterContextValue {
  return publish === undefined
    ? { docs, chat, createStore: createProductionStore }
    : { docs, chat, createStore: createProductionStore, publish };
}

export function withSyncHighlight(node: ReactNode): ReactNode {
  return <HighlighterContext value={SYNC_HIGHLIGHT}>{node}</HighlighterContext>;
}

export function withSyncStore(node: ReactNode, store: HighlightStore = syncTestStore()): ReactNode {
  return <PreHighlightContext value={store}>{node}</PreHighlightContext>;
}
