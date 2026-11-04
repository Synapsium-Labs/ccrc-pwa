// The highlight store (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section 4.10 "The store", "Page
// ceilings", "The line retry"; M4.H11, M4.H12, M4.H13 main half, M4.H18 store half). A fake highlighter records
// every request with its signal and `onPosted`, and answers on demand; a fake clock drives the worker-time ceiling.
// The React side (`CodeBlock` on the store) is Task 6's and Task 7's.
import { describe, expect, it } from 'vitest';
import type { Root as HastRoot } from 'hast';
import type { Highlighter, HighlighterStatus, HighlightJob, HighlightOutcome, HighlightRequest } from '../src/lib/highlightProtocol';
import { createHighlighter, type WorkerLike } from '../src/lib/markdownRunner';
import {
  UNREQUESTED_ENTRY, blockKey, codeBlocksOf, createHighlightStore, readHighlightOutcome, type HighlightClock, type HighlightEntry,
  type HighlightStoreOptions,
} from '../src/lib/highlightStore';
import {
  DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS, HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_LINE_RETRY_UNITS,
  HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
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

/** `n` characters of python, distinct by `tag`, in lines under 100 characters. */
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
      // The last key alone: shown and listened to, never requested, so no entry.
      expect(store.heldKeys()).toEqual({ entries: 0, subscribers: 1, listeners: 1 });
    });

    it('unsubscribing the last listener of a key drops its listener Set at once, before any eviction', () => {
      const { store, key } = setup({ mode: 'chat' });
      const a = key('ts', 'a');
      const off1 = store.subscribe(a)(() => undefined);
      const off2 = store.subscribe(a)(() => undefined);
      expect(store.heldKeys().listeners).toBe(1);
      off1();
      expect(store.heldKeys().listeners).toBe(1);
      off2();
      expect(store.heldKeys().listeners).toBe(0);
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
      expect(store.heldKeys()).toEqual({ entries: 0, subscribers: 1, listeners: 1 });
      offA();
      store.evictUnreferenced();
      expect(store.heldKeys()).toEqual({ entries: 0, subscribers: 0, listeners: 0 });
    });
  });

  it('keyOf: a key, or why the block can never be requested (no registered grammar, over the block cap); a block of any shape part 1 refused has a key', () => {
    expect(blockKey('ts', 'a')).toEqual({ kind: 'key', key: 'ts\u0000a' });
    expect(blockKey('nope', 'a')).toEqual({ kind: 'unregistered' });
    expect(blockKey('', 'a')).toEqual({ kind: 'unregistered' });
    const big = 'a\n'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    expect(blockKey('python', big)).toEqual({ kind: 'over-cap', chars: big.length });
    // Literal sizes, just over each retired bound: the grammar cap (8 192), the word (256), the line (2 048), the blank run (2 048).
    for (const [lang, raw] of [
      ['ts', 'a\n'.repeat(4097)], ['python', 'a'.repeat(257)], ['python', 'a '.repeat(1025)], ['python', `a${'\n'.repeat(2049)}b`],
    ] as const) expect(blockKey(lang, raw).kind, `${lang}, ${raw.length} characters`).toBe('key');
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

    // Review 1366 F4: the output walk's `<=` pinned from both sides. Copies whose HTML sums to exactly the page cap are
    // all drawn; one copy more is skipped. The answer is sized from the page cap alone (an eighth of it, within the
    // per-block cap), so the case holds at any value this plan sets.
    it('OUTPUT, at the boundary: copies whose HTML sums to exactly the page cap are all drawn, and one copy more is skipped (review 1366 F4)', async () => {
      const { h, store, key, answer } = setup();
      const size = DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / 8;
      expect(Number.isInteger(size)).toBe(true);
      expect(size).toBeLessThanOrEqual(MD_HIGHLIGHT_MAX_HTML_CHARS);
      const html = `<span class="hljs-a">${'x'.repeat(size - 28)}</span>`;
      expect(html).toHaveLength(size);
      const ats = copiesOf(9);
      store.seed(ats.map((at) => ({ lang: 'python', raw: 'same', at })));
      const k = key('python', 'same');
      store.request(k);
      await answer(0, HTML(html));
      expect(h.calls).toHaveLength(1);
      expect(store.peek(k)).toMatchObject({ kind: 'html', mode: 'block' });
      expect(verdicts(store, ats)).toEqual([...Array(8).fill(null), 'page-output']);
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

    it('INPUT: copies of one block are admitted until their combined length passes the page input ceiling, then skipped as copies; the key is still requestable, one job', async () => {
      const { h, store, key, answer } = setup();
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

  describe('a job released after it was posted stops its worker-time clock at the detach (review 1364 F4)', () => {
    it('its timer cannot latch page-worker-time after the release', async () => {
      const { h, clock, store, key, post, answer } = setup({ mode: 'chat' });
      const release = store.request(key('python', 'a'));
      post(0);
      clock.advance(100);
      release();
      expect(h.calls[0]!.aborted).toBe(true);
      // Well past the ceiling: a timer still armed for the released job would latch the store here.
      clock.advance(HIGHLIGHT_PAGE_WORKER_MS + 1000);
      const b = key('python', 'b');
      store.request(b);
      expect(store.peek(b).kind).toBe('pending');
      // The next job runs 2 899 ms; with the 100 ms the detached job ran that is 2 999, under the ceiling. The 4 000 ms gap
      // between them is nobody's worker time.
      post(1);
      clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 101);
      await answer(1, HTML(OK));
      const c = key('python', 'c');
      store.request(c);
      expect(store.peek(c).kind).toBe('pending');
    });

    it('the next post counts none of the time between the release and the post', async () => {
      const { clock, store, key, post, answer } = setup({ mode: 'chat' });
      const release = store.request(key('python', 'a'));
      post(0);
      clock.advance(100);
      release();
      // Just short of the ceiling since the detached job was posted, so its timer has not fired.
      clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 101);
      store.request(key('python', 'b'));
      post(1);
      clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 101);
      await answer(1, HTML(OK));
      // 100 ms (the detached job) + 2 899 ms (this one) is under the ceiling; counting the gap as well would pass it.
      const c = key('python', 'c');
      store.request(c);
      expect(store.peek(c).kind).toBe('pending');
    });
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

  // W5h-b: derived from HIGHLIGHT_PAGE_WORKER_MS (it was written for the provisional 3 000 ms): as many 700 ms jobs as
  // fit are coloured, and the next is skipped (HIGHLIGHT_PAGE_WORKER_MS - fit x 700) ms into its run, under its deadline.
  it('back-to-back 700 ms jobs: as many as fit the worker-time ceiling are coloured, and the next is skipped by page-worker-time mid-run', async () => {
    const JOB_MS = 700;
    expect(JOB_MS).toBeLessThan(HIGHLIGHT_BLOCK_DEADLINE_MS);
    const fit = Math.floor(HIGHLIGHT_PAGE_WORKER_MS / JOB_MS);
    const left = HIGHLIGHT_PAGE_WORKER_MS - fit * JOB_MS;
    expect(left).toBeGreaterThan(0);
    const clock = fakeClock();
    const worker = new Worker();
    const highlighter = createHighlighter({ spawn: () => worker, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const store = createHighlightStore(highlighter, { mode: 'docs' }, clock);
    const raws = Array.from({ length: fit + 1 }, (_, i) => `b${i}`);
    store.seed(raws.map((raw) => ({ lang: 'python', raw })));
    const ks = raws.map((raw) => { const k = store.keyOf('python', raw); if (k.kind !== 'key') throw new Error('no key'); return k.key; });
    for (const k of ks) store.request(k);
    worker.onmessage?.({ data: { ready: true } });
    for (let i = 1; i <= fit; i += 1) {
      clock.advance(JOB_MS);
      worker.onmessage?.({ data: { id: i, result: { kind: 'html', html: OK, mode: 'block' } } });
      await flush();
    }
    expect(kinds(store, ks)).toEqual([...Array(fit).fill('html'), 'pending']);
    clock.advance(left + 50);
    await flush();
    expect(store.peek(ks[fit]!)).toEqual({ kind: 'skipped', ceiling: 'page-worker-time' });
    expect(store.settled()).toBe(true);
  });
});

describe('A4: an outcome of a shape this build does not know settles its entry, never leaves it pending', () => {
  /** What a first-party worker of another chunk version could send: not an outcome of this build. */
  const SHAPES: ReadonlyArray<readonly [string, unknown]> = [
    ['an unknown kind', { kind: 'bogus' }],
    ['html without html', { kind: 'html', mode: 'block' }],
    ['html with a non-string html', { kind: 'html', html: 7, mode: 'block' }],
    ['html with an unknown mode', { kind: 'html', html: OK, mode: 'span' }],
    ['a timeout without budgetMs', { kind: 'timeout' }],
    ['a threw without a string error', { kind: 'threw', error: 3 }],
  ];

  for (const [name, bad] of SHAPES) {
    it(`${name}: the entry is plain (malformed) and a Docs store seeded with the key reaches settled()`, async () => {
      const { h, store, key, answer } = setup();
      const a = key('python', 'a');
      store.seed([{ lang: 'python', raw: 'a' }]);
      expect(store.settled()).toBe(false);
      let heard = 0;
      store.subscribe(a)(() => { heard += 1; });
      store.request(a);
      await answer(0, bad as HighlightOutcome);
      expect(store.peek(a)).toEqual({ kind: 'plain', first: { kind: 'malformed' }, retry: null });
      expect(heard).toBe(2);
      expect(store.settled()).toBe(true);
      expect(h.calls).toHaveLength(1);
    });
  }

  it('a malformed outcome on a block long enough for a line retry is not retried, and a malformed timeout counts no timeout', async () => {
    const { h, store, key, answer } = setup({ mode: 'chat' });
    const long = key('python', py(HIGHLIGHT_LINE_RETRY_UNITS + 10, 'long'));
    store.request(long);
    await answer(0, { kind: 'timeout' } as unknown as HighlightOutcome);
    expect(h.calls).toHaveLength(1);
    expect(store.peek(long)).toEqual({ kind: 'plain', first: { kind: 'malformed' }, retry: null });
    for (let i = 0; i < HIGHLIGHT_PAGE_MAX_TIMEOUTS; i += 1) {
      store.request(key('python', `m${i}`));
      await answer(1 + i, { kind: 'timeout' } as unknown as HighlightOutcome);
    }
    const next = key('python', 'next');
    store.request(next);
    expect(store.peek(next).kind).toBe('pending');
  });

  it('a malformed outcome of a line retry leaves the first failure and records the retry as malformed', async () => {
    const { h, store, key, answer } = setup({ mode: 'chat' });
    const long = key('python', py(HIGHLIGHT_LINE_RETRY_UNITS + 10, 'long'));
    store.request(long);
    await answer(0, TIMEOUT);
    expect(h.calls[1]!.req.mode).toBe('line');
    await answer(1, { kind: 'bogus' } as unknown as HighlightOutcome);
    expect(store.peek(long)).toEqual({ kind: 'plain', first: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, retry: { kind: 'malformed' } });
  });

  it('readHighlightOutcome accepts exactly the eight arms, each with its fields\' types, and nothing else', () => {
    const good: HighlightOutcome[] = [
      { kind: 'html', html: OK, mode: 'block' }, { kind: 'html', html: '', mode: 'line' },
      { kind: 'too-large', htmlChars: 5 }, { kind: 'line-too-long', chars: 5 }, { kind: 'threw', error: 'RangeError' },
      { kind: 'timeout', budgetMs: 750 }, { kind: 'worker-unavailable' }, { kind: 'worker-failed', error: 'boot' }, { kind: 'unregistered' },
    ];
    for (const o of good) expect(readHighlightOutcome(o)).toEqual(o);
    const bad: unknown[] = [
      null, undefined, 'html', 7, [], {}, { kind: 1 }, { kind: 'bogus' },
      { kind: 'html' }, { kind: 'html', html: 1, mode: 'block' }, { kind: 'html', html: OK }, { kind: 'html', html: OK, mode: 'span' },
      { kind: 'too-large' }, { kind: 'too-large', htmlChars: '5' }, { kind: 'line-too-long' }, { kind: 'line-too-long', chars: null },
      { kind: 'threw' }, { kind: 'threw', error: 1 }, { kind: 'timeout' }, { kind: 'timeout', budgetMs: '750' },
      { kind: 'worker-failed' }, { kind: 'worker-failed', error: 1 },
    ];
    for (const o of bad) expect(readHighlightOutcome(o)).toBeNull();
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
