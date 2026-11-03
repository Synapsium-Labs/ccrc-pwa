// The highlight store (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section 4.10 "The store", "Page
// ceilings", "The line retry"; M4.H11, M4.H12, M4.H13 main half, M4.H18 store half). A fake highlighter records
// every request with its signal and `onPosted`, and answers on demand; a fake clock drives the worker-time ceiling.
// The React side (`CodeBlock` on the store) is Task 6's and Task 7's.
import { describe, expect, it } from 'vitest';
import type { Root as HastRoot } from 'hast';
import type { Highlighter, HighlighterStatus, HighlightJob, HighlightOutcome, HighlightRequest } from '../src/lib/highlightProtocol';
import { createHighlighter, type WorkerLike } from '../src/lib/markdownRunner';
import {
  UNREQUESTED_ENTRY, blockKey, codeBlocksOf, createHighlightStore, type HighlightClock, type HighlightEntry,
  type HighlightStoreOptions,
} from '../src/lib/highlightStore';
import {
  DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS,
  DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS, HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_LINE_RETRY_UNITS,
  HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS,
  MD_HIGHLIGHT_MAX_BLANK_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS, MD_HIGHLIGHT_MAX_LINE_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS,
} from '../src/lib/markdownLimits';

interface Call {
  readonly req: HighlightRequest;
  readonly signal?: AbortSignal;
  readonly onPosted?: () => void;
  readonly resolve: (o: HighlightOutcome) => void;
  aborted: boolean;
  posted: boolean;
}

/** A highlighter that records each request and answers only when told. */
class FakeHighlighter implements Highlighter {
  readonly calls: Call[] = [];
  state: HighlighterStatus = 'live';
  /** A real highlighter rejects an aborted job; a test turns this off to let the abort race an answer that is
   *  already on its way (a detached job's late answer). */
  rejectOnAbort = true;
  highlight(req: HighlightRequest, opts: { signal?: AbortSignal; onPosted?: () => void }): Promise<HighlightOutcome> {
    return new Promise((resolve, reject) => {
      const call: Call = { req, signal: opts.signal, onPosted: opts.onPosted, resolve, aborted: false, posted: false };
      this.calls.push(call);
      opts.signal?.addEventListener('abort', () => { call.aborted = true; if (this.rejectOnAbort) reject(opts.signal!.reason); }, { once: true });
    });
  }
  status(): HighlighterStatus { return this.state; }
  prewarm(): void {}
}

/** A clock whose timers fire only when the test advances it. */
function fakeClock(): HighlightClock & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn, ms) => { const h = next++; timers.set(h, { at: now + ms, fn }); return h; },
    clearTimer: (h) => { timers.delete(h as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
const HTML = (html: string, mode: 'block' | 'line' = 'block'): HighlightOutcome => ({ kind: 'html', html, mode });
const TIMEOUT: HighlightOutcome = { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS };
const OK = '<span class="hljs-keyword">x</span>';

function setup(options: HighlightStoreOptions = { mode: 'docs' }) {
  const h = new FakeHighlighter();
  const clock = fakeClock();
  const store = createHighlightStore(h, options, clock);
  const key = (lang: string, raw: string): string => {
    const k = store.keyOf(lang, raw);
    if (k.kind !== 'key') throw new Error(`no key: ${JSON.stringify(k)}`);
    return k.key;
  };
  /** Posts call `i` once (its onPosted runs), as the highlighter does when the job reaches the worker. */
  const post = (i: number): void => {
    const call = h.calls[i]!;
    if (call.posted) return;
    call.posted = true;
    call.onPosted?.();
  };
  /** Posts call `i` if it was not, then answers it, then lets the store hear it. */
  const answer = async (i: number, o: HighlightOutcome): Promise<void> => {
    post(i);
    h.calls[i]!.resolve(o);
    await flush();
  };
  return { h, clock, store, key, post, answer };
}

/** `n` characters of python, distinct by `tag`, in lines under 100 characters, with no long word or blank run. */
const py = (n: number, tag: string): string =>
  (tag + ' ' + 'x '.repeat(n)).replace(/(.{80})/g, '$1\n').slice(0, n);
const kinds = (store: { peek(k: string): HighlightEntry }, keys: string[]): string[] => keys.map((k) => store.peek(k).kind);

describe('M4.H11: a content-keyed store', () => {
  it('two blocks with equal (lang, raw) make one request; peek is synchronous and never requests', () => {
    const { h, store, key } = setup();
    const k = key('ts', 'const a = 1;');
    expect(store.peek(k)).toBe(UNREQUESTED_ENTRY);
    expect(h.calls).toHaveLength(0);
    store.request(k);
    store.request(k);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.req).toEqual({ lang: 'ts', code: 'const a = 1;' });
    expect(store.peek(k).kind).toBe('pending');
  });

  it('a re-request of an answered key (a re-render, a Copy click) makes no request', async () => {
    const { h, store, key, answer } = setup();
    const k = key('ts', 'a');
    const release = store.request(k);
    await answer(0, HTML(OK));
    release();
    store.request(k)();
    store.request(k);
    expect(h.calls).toHaveLength(1);
    expect(store.peek(k).kind).toBe('html');
  });

  it('releasing one of two references keeps the job; releasing the last detaches it and the key is unrequested again', () => {
    const { h, store, key } = setup();
    const k = key('ts', 'a');
    const one = store.request(k);
    const two = store.request(k);
    one();
    one();
    expect(h.calls[0]!.aborted).toBe(false);
    two();
    expect(h.calls[0]!.aborted).toBe(true);
    expect(store.peek(k)).toBe(UNREQUESTED_ENTRY);
  });

  it('peek returns the same object until the entry changes; subscribe(key) returns the same function for a key', async () => {
    const { store, key, answer } = setup();
    const k = key('ts', 'a');
    expect(store.peek('never-seen')).toBe(store.peek('never-seen-either'));
    store.request(k);
    const pending = store.peek(k);
    expect(store.peek(k)).toBe(pending);
    await answer(0, HTML(OK));
    const html = store.peek(k);
    expect(html).not.toBe(pending);
    expect(store.peek(k)).toBe(html);
    expect(store.subscribe(k)).toBe(store.subscribe(k));
    expect(store.subscribe()).toBe(store.subscribe());
  });

  it('a listener on a key hears its change, and a store-wide listener hears every change', async () => {
    const { store, key, answer } = setup();
    const k = key('ts', 'a');
    const heard: string[] = [];
    store.subscribe(k)(() => heard.push('key'));
    store.subscribe()(() => heard.push('all'));
    store.request(k);
    await answer(0, HTML(OK));
    expect(heard).toEqual(['key', 'all', 'key', 'all']);
  });

  it('releaseAll detaches every outstanding job', () => {
    const { h, store, key } = setup();
    store.request(key('ts', 'a'));
    store.request(key('ts', 'b'));
    store.releaseAll();
    expect(h.calls.map((c) => c.aborted)).toEqual([true, true]);
  });

  it('a chat store evicts every key no block references after a commit', async () => {
    const { store, key, answer } = setup({ mode: 'chat' });
    const a = key('ts', 'a');
    const b = key('ts', 'b');
    const releaseA = store.request(a);
    store.request(b);
    await answer(0, HTML(OK));
    releaseA();
    store.evictUnreferenced();
    expect(store.peek(a)).toBe(UNREQUESTED_ENTRY);
    expect(store.peek(b).kind).toBe('pending');
  });

  describe('M4.C5 (F2): a chat store keeps no row for a key no block references', () => {
    /** One mounted block's hooks, in React's order for a changed key: the old key's subscription, show and request
     *  end (cleanups), the new key is subscribed and shown, requested at once only the first time (the debounce
     *  window otherwise), then the message's store evicts. */
    function streamingFence(store: ReturnType<typeof setup>['store'], text: (n: number) => string, settles: number) {
      let end: (() => void)[] = [];
      for (let n = 1; n <= settles; n += 1) {
        for (const f of end.reverse()) f();
        const k = store.keyOf('ts', text(n));
        if (k.kind !== 'key') throw new Error('no key');
        end = [store.subscribe(k.key)(() => undefined), store.show(k.key)];
        if (n === 1) end.push(store.request(k.key));
        store.evictUnreferenced();
      }
      return end;
    }

    it('a fence that grows over many settles leaves a constant number of rows, not one per settle', () => {
      const { store } = setup({ mode: 'chat' });
      streamingFence(store, (n) => 'x'.repeat(n), 40);
      const kept = store.retainedKeys();
      expect(kept.entries).toBeLessThanOrEqual(2);
      expect(kept.subscribers).toBeLessThanOrEqual(2);
      expect(kept.listeners).toBeLessThanOrEqual(2);
    });

    it('unsubscribing the last listener of a key drops its listener Set at once, before any eviction', () => {
      const { store, key } = setup({ mode: 'chat' });
      const a = key('ts', 'a');
      const off1 = store.subscribe(a)(() => undefined);
      const off2 = store.subscribe(a)(() => undefined);
      expect(store.retainedKeys().listeners).toBe(1);
      off1();
      expect(store.retainedKeys().listeners).toBe(1);
      off2();
      expect(store.retainedKeys().listeners).toBe(0);
      // The cached function stays until eviction, and a later subscription starts a fresh Set that is notified.
      let heard = 0;
      store.subscribe(a)(() => { heard += 1; });
      store.request(a);
      expect(heard).toBeGreaterThan(0);
    });

    it('an unreferenced key that still has a live listener keeps its rows until the listener goes', () => {
      const { store, key } = setup({ mode: 'chat' });
      const a = key('ts', 'a');
      const offA = store.subscribe(a)(() => undefined);
      store.evictUnreferenced();
      expect(store.retainedKeys()).toEqual({ entries: 0, subscribers: 1, listeners: 1 });
      offA();
      store.evictUnreferenced();
      expect(store.retainedKeys()).toEqual({ entries: 0, subscribers: 0, listeners: 0 });
    });
  });

  it('keyOf: a key, or why the block can never be requested, in BASE\'s order; part 1\'s bounds only with part1', () => {
    expect(blockKey('ts', 'a')).toEqual({ kind: 'key', key: 'ts\u0000a' });
    expect(blockKey('nope', 'a')).toEqual({ kind: 'unregistered' });
    expect(blockKey('', 'a')).toEqual({ kind: 'unregistered' });
    const big = 'a\n'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    expect(blockKey('python', big)).toEqual({ kind: 'over-cap', chars: big.length });
    const ts = 'a\n'.repeat(MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS);
    expect(blockKey('ts', ts)).toEqual({ kind: 'part1', bound: 'grammar-cap', chars: ts.length });
    expect(blockKey('ts', ts, false).kind).toBe('key');
    const word = 'a'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1);
    expect(blockKey('python', word)).toEqual({ kind: 'part1', bound: 'word', chars: word.length });
    const line = 'a '.repeat(MD_HIGHLIGHT_MAX_LINE_CHARS);
    expect(blockKey('python', line)).toEqual({ kind: 'part1', bound: 'line', chars: line.length });
    const blank = `a${'\n'.repeat(MD_HIGHLIGHT_MAX_BLANK_CHARS + 1)}b`;
    expect(blockKey('python', blank)).toEqual({ kind: 'part1', bound: 'blank', chars: MD_HIGHLIGHT_MAX_BLANK_CHARS + 1 });
    expect(blockKey('python', blank, false).kind).toBe('key');
  });
});

describe('M4.H12: page ceilings and settled()', () => {
  it('the input ceiling skips at seed, in document order, a shared key counted at each occurrence (F1)', () => {
    const { store, key } = setup();
    const blocks = Array.from({ length: 9 }, (_, i) => ({ lang: 'python', raw: py(60000, `b${i}`) }));
    expect(8 * 60000).toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    // The repeat of b0 is the third occurrence in the sum: eight occurrences (b0, b1, b0, b2 .. b6) fit, b7 passes.
    store.seed([...blocks.slice(0, 2), blocks[0]!, ...blocks.slice(2)]);
    const keys = blocks.map((b) => key(b.lang, b.raw));
    expect(kinds(store, keys)).toEqual([...Array(7).fill('unrequested'), 'skipped', 'skipped']);
    expect(store.peek(keys[7]!)).toEqual({ kind: 'skipped', ceiling: 'page-input' });
    expect(store.peek(keys[8]!)).toEqual({ kind: 'skipped', ceiling: 'page-input' });
  });

  it('the output ceiling: the answer that would pass the page HTML cap is skipped, and every later request', async () => {
    const { store, key, answer } = setup();
    const big = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
    const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / big.length);
    const raws = Array.from({ length: fit + 2 }, (_, i) => `b${i}`);
    store.seed(raws.map((raw) => ({ lang: 'python', raw })));
    const ks = raws.map((r) => key('python', r));
    for (const k of ks) store.request(k);
    for (let i = 0; i <= fit; i += 1) await answer(i, HTML(big));
    expect(kinds(store, ks)).toEqual([...Array(fit).fill('html'), 'skipped', 'skipped']);
    expect(store.peek(ks[fit]!)).toEqual({ kind: 'skipped', ceiling: 'page-output' });
  });

  // F1 (review 1364): a page's ceilings count every DRAWN copy of a shared key. One job still serves the key; the store
  // answers each copy's verdict (`copySkip`), keyed by the copy's own `at`.
  describe('F1: the page ceilings count every drawn copy of a shared key', () => {
    const copiesOf = (n: number): object[] => Array.from({ length: n }, () => ({}));
    const verdicts = (store: { copySkip(at: object): unknown }, ats: object[]): unknown[] => ats.map((at) => store.copySkip(at));

    it('OUTPUT: copies of one block are drawn until the page HTML cap, the first copy past it and every later one are skipped, one job, the store latched', async () => {
      const { h, store, key, answer } = setup();
      const html = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
      expect(html.length).toBeLessThan(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS);
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / html.length);
      expect(fit).toBeGreaterThan(1);
      const ats = copiesOf(fit + 2);
      store.seed(ats.map((at) => ({ lang: 'python', raw: 'same', at })));
      const k = key('python', 'same');
      expect(verdicts(store, ats)).toEqual(ats.map(() => null));
      store.request(k);
      store.request(k);
      await answer(0, HTML(html));
      expect(h.calls).toHaveLength(1);
      expect(store.peek(k)).toMatchObject({ kind: 'html', mode: 'block' });
      expect(verdicts(store, ats)).toEqual([...Array(fit).fill(null), 'page-output', 'page-output']);
      const other = key('python', 'other');
      store.request(other);
      expect(store.peek(other)).toEqual({ kind: 'skipped', ceiling: 'page-output' });
      expect(h.calls).toHaveLength(1);
    });

    it('OUTPUT: the verdicts are readable when the key\'s listeners run (recorded before the entry is set)', async () => {
      const { store, key, answer } = setup();
      const html = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / html.length);
      const ats = copiesOf(fit + 1);
      store.seed(ats.map((at) => ({ lang: 'python', raw: 'same', at })));
      const k = key('python', 'same');
      let seen: unknown = 'never';
      store.subscribe(k)(() => { if (store.peek(k).kind === 'html') seen = store.copySkip(ats[fit]!); });
      store.request(k);
      await answer(0, HTML(html));
      expect(seen).toBe('page-output');
    });

    it('OUTPUT: when the first copy is the one that passes, the entry itself is skipped (as before), and no copy verdict is needed', async () => {
      const { store, key, answer } = setup();
      const html = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / html.length);
      const fill = Array.from({ length: fit }, (_, i) => key('python', `fill${i}`));
      const ats = copiesOf(2);
      store.seed([...fill.map((_, i) => ({ lang: 'python', raw: `fill${i}` })), ...ats.map((at) => ({ lang: 'python', raw: 'late', at }))]);
      for (const k of fill) store.request(k);
      for (let i = 0; i < fit; i += 1) await answer(i, HTML(html));
      const late = key('python', 'late');
      store.request(late);
      await answer(fit, HTML(html));
      expect(store.peek(late)).toEqual({ kind: 'skipped', ceiling: 'page-output' });
    });

    it('OUTPUT: a line retry\'s html answer counts every copy too', async () => {
      const { h, store, key, answer } = setup();
      const raw = 'a\n'.repeat(HIGHLIGHT_LINE_RETRY_UNITS);
      const html = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / html.length);
      const ats = copiesOf(fit + 1);
      store.seed(ats.map((at) => ({ lang: 'python', raw, at })));
      const k = key('python', raw);
      store.request(k);
      await answer(0, TIMEOUT);
      expect(h.calls[1]!.req.mode).toBe('line');
      await answer(1, HTML(html, 'line'));
      expect(store.peek(k)).toMatchObject({ kind: 'html', mode: 'line' });
      expect(verdicts(store, ats)).toEqual([...Array(fit).fill(null), 'page-output']);
    });

    it('INPUT: copies of one block are admitted until their combined length passes the page input ceiling, then skipped as copies; the key is still requestable, one job (part1 off: no per-block bound applies)', async () => {
      const { h, store, key, answer } = setup({ mode: 'docs', part1: false });
      const raw = py(MD_HIGHLIGHT_BLOCK_MAX_CHARS, 'same');
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_MAX_CHARS / raw.length);
      expect(fit).toBeGreaterThan(1);
      const ats = copiesOf(fit + 2);
      store.seed(ats.map((at) => ({ lang: 'python', raw, at })));
      const k = key('python', raw);
      expect(verdicts(store, ats)).toEqual([...Array(fit).fill(null), 'page-input', 'page-input']);
      expect(store.peek(k)).toBe(UNREQUESTED_ENTRY);
      store.request(k);
      store.request(k);
      await answer(0, HTML(OK));
      expect(h.calls).toHaveLength(1);
      expect(store.peek(k).kind).toBe('html');
    });

    it('INPUT: the same with part 1 on (the block is within every per-block bound of its grammar)', () => {
      const { store } = setup();
      const raw = py(MD_HIGHLIGHT_BLOCK_MAX_CHARS, 'same');
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_MAX_CHARS / raw.length);
      const ats = copiesOf(fit + 1);
      store.seed(ats.map((at) => ({ lang: 'python', raw, at })));
      expect(verdicts(store, ats)).toEqual([...Array(fit).fill(null), 'page-input']);
    });

    it('SCAN: copies of one typescript block count in part 1\'s scan sum too: the first copy past it is skipped by part1-scan', () => {
      const { store, key } = setup();
      const raw = py(MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, 'same');
      const fit = Math.floor(DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS / raw.length);
      expect((fit + 2) * raw.length).toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
      const ats = copiesOf(fit + 2);
      store.seed(ats.map((at) => ({ lang: 'typescript', raw, at })));
      expect(verdicts(store, ats)).toEqual([...Array(fit).fill(null), 'part1-scan', 'part1-scan']);
      expect(store.peek(key('typescript', raw))).toBe(UNREQUESTED_ENTRY);
    });

    it('MARKDOWN: copies of one markdown block count in part 1\'s markdown sum too', () => {
      const { store } = setup();
      const raw = py(MD_HIGHLIGHT_BLOCK_MAX_CHARS, 'same');
      const fit = Math.floor(DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS / raw.length);
      const ats = copiesOf(fit + 1);
      store.seed(ats.map((at) => ({ lang: 'markdown', raw, at })));
      expect(verdicts(store, ats)).toEqual([...Array(fit).fill(null), 'part1-markdown']);
    });

    it('a key whose first occurrence is past a ceiling is skipped as an entry from the first commit, and no copy verdict is recorded', () => {
      const { store, key } = setup();
      const fillers = Array.from({ length: Math.floor(DOCS_HIGHLIGHT_PAGE_MAX_CHARS / MD_HIGHLIGHT_BLOCK_MAX_CHARS) }, (_, i) => ({ lang: 'python', raw: py(MD_HIGHLIGHT_BLOCK_MAX_CHARS, `f${i}`) }));
      const ats = copiesOf(2);
      store.seed([...fillers, ...ats.map((at) => ({ lang: 'python', raw: 'late', at }))]);
      expect(store.peek(key('python', 'late'))).toEqual({ kind: 'skipped', ceiling: 'page-input' });
      expect(verdicts(store, ats)).toEqual([null, null]);
    });

    it('a chat store, and a copy never seeded, answer null', () => {
      const { store } = setup({ mode: 'chat' });
      expect(store.copySkip({})).toBeNull();
      expect(setup().store.copySkip({})).toBeNull();
    });
  });

  it('the timeout ceiling: at HIGHLIGHT_PAGE_MAX_TIMEOUTS timeouts every unanswered key is skipped, the running job detached', async () => {
    const { h, store, key, answer } = setup();
    const ks = ['a', 'b', 'c', 'd'].map((s) => key('python', s));
    store.seed(['a', 'b', 'c', 'd'].map((raw) => ({ lang: 'python', raw })));
    for (const k of ks) store.request(k);
    for (let i = 0; i < HIGHLIGHT_PAGE_MAX_TIMEOUTS; i += 1) await answer(i, TIMEOUT);
    expect(store.peek(ks[0]!)).toEqual({ kind: 'plain', first: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, retry: null });
    expect(kinds(store, ks.slice(HIGHLIGHT_PAGE_MAX_TIMEOUTS))).toEqual(['skipped', 'skipped']);
    expect(store.peek(ks[3]!)).toEqual({ kind: 'skipped', ceiling: 'page-timeouts' });
    expect(h.calls.slice(HIGHLIGHT_PAGE_MAX_TIMEOUTS).every((c) => c.aborted)).toBe(true);
    expect(store.settled()).toBe(true);
  });

  it('the worker-time ceiling fires mid-job: the running job is detached and the rest skipped', async () => {
    const { h, clock, store, key, post, answer } = setup();
    const ks = ['a', 'b', 'c'].map((s) => key('python', s));
    store.seed(['a', 'b', 'c'].map((raw) => ({ lang: 'python', raw })));
    for (const k of ks) store.request(k);
    post(0);
    clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 1);
    await answer(0, HTML(OK));
    post(1);
    clock.advance(1);
    await flush();
    expect(h.calls[1]!.aborted).toBe(true);
    expect(kinds(store, ks)).toEqual(['html', 'skipped', 'skipped']);
    expect(store.peek(ks[1]!)).toEqual({ kind: 'skipped', ceiling: 'page-worker-time' });
  });

  it('a detached job\'s timeout counts against no ceiling', async () => {
    const { h, store, key, answer } = setup({ mode: 'chat' });
    h.rejectOnAbort = false;
    const release = store.request(key('python', 'a'));
    release();
    expect(h.calls[0]!.aborted).toBe(true);
    h.calls[0]!.resolve(TIMEOUT);
    await flush();
    for (const s of ['b', 'c']) store.request(key('python', s));
    await answer(1, TIMEOUT);
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]!.aborted).toBe(false);
    expect(store.peek(key('python', 'c')).kind).toBe('pending');
  });

  it('settled(): false while a seeded key is unanswered, from creation; true once every one is html, plain or skipped', async () => {
    const { store, key, answer } = setup();
    store.seed([{ lang: 'python', raw: 'a' }, { lang: 'python', raw: 'b' }]);
    expect(store.settled()).toBe(false);
    store.request(key('python', 'a'));
    store.request(key('python', 'b'));
    await answer(0, HTML(OK));
    expect(store.settled()).toBe(false);
    await answer(1, { kind: 'threw', error: 'Error' });
    expect(store.settled()).toBe(true);
  });

  it('a Docs store seeded with nothing is settled; a chat store is settled when no referenced key is waiting', async () => {
    expect(setup().store.settled()).toBe(true);
    const { store, key, answer } = setup({ mode: 'chat' });
    store.request(key('python', 'a'));
    expect(store.settled()).toBe(false);
    await answer(0, HTML(OK));
    expect(store.settled()).toBe(true);
  });

  it('a chat store applies neither page cap: no input skip at any size, no output skip', async () => {
    const { store, key, answer } = setup({ mode: 'chat' });
    const huge = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
    const ks = Array.from({ length: Math.ceil(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / huge.length) + 1 }, (_, i) => key('python', `k${i}`));
    for (const [i, k] of ks.entries()) { store.request(k); await answer(i, HTML(huge)); }
    expect(kinds(store, ks).every((s) => s === 'html')).toBe(true);
  });

  it('part 1\'s scan page budget skips at seed with its own ceiling, and only its grammars; part1 off, never', () => {
    const { store, key } = setup();
    const n = Math.floor(DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS / MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS);
    const ts = Array.from({ length: n + 1 }, (_, i) => ({ lang: 'ts', raw: py(MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, `t${i}`) }));
    const json = { lang: 'json', raw: py(1000, 'j') };
    store.seed([...ts, json]);
    expect(store.peek(key('ts', ts[n]!.raw))).toEqual({ kind: 'skipped', ceiling: 'part1-scan' });
    expect(store.peek(key('ts', ts[n - 1]!.raw)).kind).toBe('unrequested');
    expect(store.peek(key('json', json.raw)).kind).toBe('unrequested');
    const off = setup({ mode: 'docs', part1: false }).store;
    off.seed(ts);
    expect(off.peek(`ts\u0000${ts[n]!.raw}`).kind).toBe('unrequested');
  });

  it('part 1\'s markdown page budget skips at seed with its own ceiling, and only markdown', () => {
    const { store, key } = setup();
    const md = Array.from({ length: 3 }, (_, i) => ({ lang: i === 1 ? 'md' : 'markdown', raw: py(DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS / 2, `m${i}`) }));
    const yaml = { lang: 'yaml', raw: py(1000, 'y') };
    store.seed([...md, yaml]);
    expect(kinds(store, md.map((b) => key(b.lang, b.raw)))).toEqual(['unrequested', 'unrequested', 'skipped']);
    expect(store.peek(key('markdown', md[2]!.raw))).toEqual({ kind: 'skipped', ceiling: 'part1-markdown' });
    expect(store.peek(key('yaml', yaml.raw)).kind).toBe('unrequested');
  });

  it('a chat store is not settled while a shown key waits for its request (the debounce window)', async () => {
    const { store, key, answer } = setup({ mode: 'chat' });
    const k = key('python', 'a');
    const unshow = store.show(k);
    expect(store.settled()).toBe(false);
    store.request(k);
    expect(store.settled()).toBe(false);
    await answer(0, HTML(OK));
    expect(store.settled()).toBe(true);
    unshow();
    expect(store.settled()).toBe(true);
  });

  it('with ceilings off nothing is skipped, at seed or live (R19\'s store)', async () => {
    const { store, key, answer } = setup({ mode: 'docs', ceilings: false });
    const blocks = Array.from({ length: 10 }, (_, i) => ({ lang: 'python', raw: py(60000, `c${i}`) }));
    store.seed(blocks);
    const ks = blocks.map((b) => key(b.lang, b.raw));
    expect(kinds(store, ks).every((s) => s === 'unrequested')).toBe(true);
    for (const k of ks) store.request(k);
    for (let i = 0; i < 4; i += 1) await answer(i, TIMEOUT);
    expect(kinds(store, ks.slice(4)).every((s) => s === 'pending')).toBe(true);
  });
});

describe('M4.H13 (main half) and M4.H18 (store half): the receipt re-check and the line retry', () => {
  const long = 'a\n'.repeat(HIGHLIGHT_LINE_RETRY_UNITS);

  it('an answer over MD_HIGHLIGHT_MAX_HTML_CHARS is too-large on receipt, and a long block is retried in line mode, pending meanwhile', async () => {
    const { h, store, key, answer } = setup();
    const k = key('python', long);
    store.seed([{ lang: 'python', raw: long }]);
    store.request(k);
    await answer(0, HTML(`<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS)}</span>`));
    expect(h.calls[1]!.req).toEqual({ lang: 'python', code: long, mode: 'line' });
    expect(store.peek(k).kind).toBe('pending');
    expect(store.settled()).toBe(false);
    await answer(1, HTML(OK, 'line'));
    expect(store.peek(k)).toMatchObject({ kind: 'html', mode: 'line' });
  });

  it('a block of exactly the unit gets no retry and stays plain under its first failure; one unit more is retried', async () => {
    const at = 'a '.repeat(HIGHLIGHT_LINE_RETRY_UNITS / 2);
    const { h, store, key, answer } = setup({ mode: 'chat', ceilings: false });
    store.request(key('python', at));
    await answer(0, TIMEOUT);
    expect(h.calls).toHaveLength(1);
    expect(store.peek(key('python', at))).toEqual({ kind: 'plain', first: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, retry: null });
    store.request(key('python', `${at}b`));
    await answer(1, TIMEOUT);
    expect(h.calls[2]!.req.mode).toBe('line');
  });

  it('an answer both over the per-block cap and malformed is too-large (length first, refinement (e)), and a long block is retried', async () => {
    const { h, store, key, answer } = setup({ mode: 'chat', ceilings: false });
    const bad = `<img src=x>${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS)}`;
    const short = key('python', 'a');
    store.request(short);
    await answer(0, HTML(bad));
    expect(store.peek(short)).toEqual({ kind: 'plain', first: { kind: 'too-large' }, retry: null });
    const k = key('python', long);
    store.request(k);
    await answer(1, HTML(bad));
    expect(h.calls[2]!.req).toEqual({ lang: 'python', code: long, mode: 'line' });
    expect(store.peek(k).kind).toBe('pending');
  });

  it('a retry that fails differently leaves the block plain under its first failure, the retry\'s outcome recorded', async () => {
    const { store, key, answer } = setup({ mode: 'chat', ceilings: false });
    const k = key('python', long);
    store.request(k);
    await answer(0, { kind: 'too-large', htmlChars: MD_HIGHLIGHT_MAX_HTML_CHARS + 1 });
    await answer(1, TIMEOUT);
    expect(store.peek(k)).toEqual({ kind: 'plain', first: { kind: 'too-large' }, retry: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS } });
  });

  it('a retry the ceilings refuse leaves the block plain under its first failure, never skipped', async () => {
    const { store, key, answer } = setup({ mode: 'chat' });
    const ks = Array.from({ length: HIGHLIGHT_PAGE_MAX_TIMEOUTS }, (_, i) => key('python', `${long}${i}`));
    for (const k of ks) store.request(k);
    for (let i = 0; i < ks.length; i += 1) await answer(i, TIMEOUT);
    for (const k of ks) expect(store.peek(k)).toMatchObject({ kind: 'plain', first: { kind: 'timeout' } });
    expect(store.peek(ks[ks.length - 1]!)).toMatchObject({ retry: { kind: 'refused' } });
  });

  it('threw and unregistered get no retry; a block coloured whole is never sent in line mode', async () => {
    const { h, store, key, answer } = setup({ mode: 'chat' });
    store.request(key('python', `${long}x`));
    await answer(0, { kind: 'threw', error: 'Error' });
    store.request(key('python', `${long}y`));
    await answer(1, { kind: 'unregistered' });
    store.request(key('python', `${long}z`));
    await answer(2, HTML(OK));
    expect(h.calls.map((c) => c.req.mode ?? 'block')).toEqual(['block', 'block', 'block']);
  });

  it('the retry counts against the page ceilings: its timeout is counted', async () => {
    const { store, key, answer } = setup({ mode: 'chat' });
    const k = key('python', long);
    const other = key('python', 'other');
    store.request(k);
    store.request(other);
    await answer(0, TIMEOUT);
    await answer(2, TIMEOUT);
    expect(store.peek(other)).toEqual({ kind: 'skipped', ceiling: 'page-timeouts' });
  });
});

describe('one ceiling wins before any listener runs (decision 4)', () => {
  /** Calls `store.request(late)` from inside the notification of `watch` once it shows `kind`. */
  function requestFromListener(store: ReturnType<typeof setup>['store'], watch: string, kind: string, late: string): void {
    store.subscribe(watch)(() => { if (store.peek(watch).kind === kind) store.request(late); });
  }

  it('the output ceiling latches before the skipped key\'s listener runs: a request made from it starts no job', async () => {
    const { h, store, key, answer } = setup();
    const big = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
    const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / big.length);
    const ks = Array.from({ length: fit + 1 }, (_, i) => key('python', `b${i}`));
    const late = key('python', 'late');
    for (const k of ks) store.request(k);
    requestFromListener(store, ks[fit]!, 'skipped', late);
    const calls = h.calls.length;
    for (let i = 0; i <= fit; i += 1) await answer(i, HTML(big));
    expect(store.peek(ks[fit]!)).toEqual({ kind: 'skipped', ceiling: 'page-output' });
    expect(h.calls).toHaveLength(calls);
    expect(store.peek(late)).toEqual({ kind: 'skipped', ceiling: 'page-output' });
  });

  it('the worker-time ceiling, reached by an html answer, latches before that key\'s listener runs', async () => {
    const h = new FakeHighlighter();
    let now = 0;
    const store = createHighlightStore(h, { mode: 'chat' }, { now: () => now, setTimer: () => 0, clearTimer: () => undefined });
    const k = (s: string): string => { const r = store.keyOf('python', s); if (r.kind !== 'key') throw new Error('no key'); return r.key; };
    const first = k('a');
    const late = k('late');
    store.request(first);
    requestFromListener(store, first, 'html', late);
    h.calls[0]!.posted = true;
    h.calls[0]!.onPosted?.();
    now = HIGHLIGHT_PAGE_WORKER_MS;
    h.calls[0]!.resolve(HTML(OK));
    await flush();
    expect(store.peek(first).kind).toBe('html');
    expect(h.calls).toHaveLength(1);
    expect(store.peek(late)).toEqual({ kind: 'skipped', ceiling: 'page-worker-time' });
  });
});

describe('L3-1: the worker-time ceiling counts a run of back-to-back jobs (the real runner)', () => {
  /** The real runner answers a job, then posts the next queued one in the same tick, before the store hears the
   *  first answer: the store's `onPosted(next)` runs before `answered(previous)`. */
  class Worker implements WorkerLike<HighlightJob> {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessageerror: ((e: unknown) => void) | null = null;
    readonly posts: HighlightJob[] = [];
    postMessage(job: HighlightJob): void { this.posts.push(job); }
    terminate(): void {}
  }

  it('five 700 ms jobs answered back to back: the fifth is skipped by page-worker-time 200 ms into its run', async () => {
    const clock = fakeClock();
    const worker = new Worker();
    const highlighter = createHighlighter({ spawn: () => worker, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const store = createHighlightStore(highlighter, { mode: 'docs' }, clock);
    const raws = ['a', 'b', 'c', 'd', 'e'];
    store.seed(raws.map((raw) => ({ lang: 'python', raw })));
    const ks = raws.map((raw) => { const k = store.keyOf('python', raw); if (k.kind !== 'key') throw new Error('no key'); return k.key; });
    for (const k of ks) store.request(k);
    worker.onmessage?.({ data: { ready: true } });
    for (let i = 1; i <= 4; i += 1) {
      clock.advance(700);
      worker.onmessage?.({ data: { id: i, result: { kind: 'html', html: OK, mode: 'block' } } });
      await flush();
    }
    expect(kinds(store, ks)).toEqual(['html', 'html', 'html', 'html', 'pending']);
    clock.advance(250);
    await flush();
    expect(store.peek(ks[4]!)).toEqual({ kind: 'skipped', ceiling: 'page-worker-time' });
    expect(store.settled()).toBe(true);
  });
});

describe('refinement (g): no worker, no fallback', () => {
  it.each<[HighlighterStatus, unknown]>([
    ['worker-unavailable', { kind: 'worker-unavailable' }],
    ['worker-failed', { kind: 'worker-failed', error: 'boot' }],
  ])('a highlighter that is %s: the block is plain at once with that cause, nothing queued', (state, cause) => {
    const { h, store, key } = setup({ mode: 'chat' });
    h.state = state;
    const k = key('python', 'a');
    store.request(k);
    expect(h.calls).toHaveLength(0);
    expect(store.peek(k)).toEqual({ kind: 'plain', first: cause, retry: null });
  });
});

describe('codeBlocksOf: the seeding walk', () => {
  it('walks pre elements in document order: the code class\'s language, and the text with one trailing newline stripped', () => {
    const code = (cls: string[] | undefined, text: string) => ({
      type: 'element', tagName: 'pre', properties: {},
      children: [{ type: 'element', tagName: 'code', properties: cls === undefined ? {} : { className: cls }, children: [{ type: 'text', value: text }] }],
    });
    const tree = { type: 'root', children: [
      code(['language-TS'], 'a\n\n'),
      { type: 'element', tagName: 'blockquote', properties: {}, children: [code(['x', 'language-md', 'language-ts'], 'b')] },
      code(undefined, 'c\n'),
    ] } as unknown as HastRoot;
    expect(codeBlocksOf(tree).map(({ lang, raw }) => ({ lang, raw }))).toEqual([{ lang: 'ts', raw: 'a\n' }, { lang: 'md', raw: 'b' }, { lang: '', raw: 'c' }]);
    // Each block names its own `pre` element as `at`: the copy's identity (F1).
    const pres = [tree.children[0], (tree.children[1] as { children: unknown[] }).children[0], tree.children[2]];
    expect(codeBlocksOf(tree).map((b) => b.at)).toEqual(pres);
    codeBlocksOf(tree).forEach((b, i) => expect(b.at).toBe(pres[i]));
  });
});
