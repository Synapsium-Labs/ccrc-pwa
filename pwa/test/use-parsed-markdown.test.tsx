// `useParsedMarkdown` (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clause 3, the W4 plan's
// refinements (g) and (i)). The hook keeps at most one job running and one queued, the queued one replaced; applies
// a result only while its job is still the hook's running job; keeps the last good tree through any later outcome;
// aborts the running job and drops the queued one on unmount; parses again on a changed budget or attempt; and
// swallows a rejection. Every case drives a deferred fake parser that IGNORES its signal, so a job settles only
// when the test says so, even after the hook has aborted it (a parser that answers late).
import { afterEach, describe, expect, it } from 'vitest';
import { useLayoutEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Root as HastRoot } from 'hast';
import type { ParseOutcome } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { useParsedMarkdown } from '../src/lib/useParsedMarkdown';

afterEach(cleanup);

interface Call {
  readonly src: string;
  readonly opts: Parameters<MarkdownParser>[1];
  readonly resolve: (o: ParseOutcome) => void;
  readonly reject: (e: unknown) => void;
}

/** A parser whose every call waits for the test: `calls[i].resolve(...)` or `.reject(...)`. */
function deferredParser(): { parser: MarkdownParser; calls: Call[] } {
  const calls: Call[] = [];
  const parser: MarkdownParser = (src, opts) =>
    new Promise<ParseOutcome>((resolve, reject) => {
      calls.push({ src, opts, resolve, reject });
    });
  return { parser, calls };
}

/** A one-paragraph tree whose only text is `label`, so two trees are told apart by identity and by content. */
const treeOf = (label: string): HastRoot => ({
  type: 'root',
  children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: label }] }],
});
const tree = (t: HastRoot): ParseOutcome => ({ kind: 'tree', tree: t, depth: 2 });
const TIMEOUT: ParseOutcome = { kind: 'timeout', budgetMs: 2000 };

interface Props {
  readonly text: string;
  readonly budgetMs?: number;
  readonly attempt?: number;
  readonly profile?: 'chat' | 'docs';
}

function mount(parser: MarkdownParser, initialProps: Props, strict = false) {
  return renderHook(
    (p: Props) =>
      useParsedMarkdown(p.text, parser, { profile: p.profile ?? 'chat', budgetMs: p.budgetMs ?? 2000, attempt: p.attempt }),
    { initialProps, reactStrictMode: strict },
  );
}

/** Settles a call inside `act`, so the hook's state update and the next job's start are flushed. */
async function settle(call: Call | undefined, outcome: ParseOutcome): Promise<void> {
  if (call === undefined) throw new Error('no such call');
  await act(async () => {
    call.resolve(outcome);
  });
}

describe('useParsedMarkdown', () => {
  it('starts one job for the first text, with its profile, budget and a live signal; nothing has settled yet', () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.src).toBe('a');
    expect(calls[0]!.opts.profile).toBe('chat');
    expect(calls[0]!.opts.budgetMs).toBe(2000);
    expect(calls[0]!.opts.signal?.aborted).toBe(false);
    expect(result.current).toEqual({ outcome: null, lastGood: null, pending: true });
  });

  it('a settled tree is the outcome and the last good tree, and nothing is pending', async () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    expect(result.current.outcome).toEqual(tree(a));
    expect(result.current.lastGood).toBe(a);
    expect(result.current.pending).toBe(false);
  });

  it('three changes while one job runs leave one queued, the last: the parser sees 2 calls, not 4', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    rerender({ text: 'abc' });
    rerender({ text: 'abcd' });
    expect(calls.map((c) => c.src)).toEqual(['a']);
    await settle(calls[0], tree(treeOf('a')));
    expect(calls.map((c) => c.src)).toEqual(['a', 'abcd']);
    expect(result.current.pending).toBe(true);
    const abcd = treeOf('abcd');
    await settle(calls[1], tree(abcd));
    expect(calls).toHaveLength(2);
    expect(result.current.lastGood).toBe(abcd);
    expect(result.current.pending).toBe(false);
  });

  it('keeps the last good tree, and the settled outcome, while a newer text parses', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    rerender({ text: 'ab' });
    expect(calls).toHaveLength(2);
    expect(result.current).toEqual({ outcome: tree(a), lastGood: a, pending: true });
  });

  it('reports a non-tree latest outcome while the last good tree stays', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    rerender({ text: 'ab' });
    await settle(calls[1], TIMEOUT);
    expect(result.current.outcome).toEqual(TIMEOUT);
    expect(result.current.lastGood).toBe(a);
    expect(result.current.pending).toBe(false);
  });

  it('a result for a job the hook no longer runs never overwrites a newer one (StrictMode remount)', async () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a' }, true);
    // StrictMode mounts, unmounts and mounts again: the first job is aborted, the second runs.
    expect(calls.map((c) => c.src)).toEqual(['a', 'a']);
    expect(calls[0]!.opts.signal?.aborted).toBe(true);
    expect(calls[1]!.opts.signal?.aborted).toBe(false);
    const second = treeOf('second');
    await settle(calls[1], tree(second));
    await settle(calls[0], tree(treeOf('first')));
    expect(result.current.outcome).toEqual(tree(second));
    expect(result.current.lastGood).toBe(second);
    expect(calls).toHaveLength(2);
  });

  it('unmount aborts the running job and drops the queued one', async () => {
    const { parser, calls } = deferredParser();
    const { rerender, unmount } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    unmount();
    expect(calls[0]!.opts.signal?.aborted).toBe(true);
    await settle(calls[0], tree(treeOf('a')));
    expect(calls).toHaveLength(1);
  });

  it('the same request again starts nothing; a changed budget parses again, and so does a changed attempt', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    await settle(calls[0], TIMEOUT);
    rerender({ text: 'a' });
    expect(calls).toHaveLength(1);
    expect(result.current.pending).toBe(false);
    rerender({ text: 'a', budgetMs: 30000 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.opts.budgetMs).toBe(30000);
    expect(result.current.pending).toBe(true);
    await settle(calls[1], TIMEOUT);
    expect(result.current.pending).toBe(false);
    rerender({ text: 'a', budgetMs: 30000, attempt: 1 });
    expect(calls).toHaveLength(3);
    expect(result.current.pending).toBe(true);
  });

  it('swallows an AbortError rejection, applies nothing, and runs the queued job next', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    await act(async () => {
      calls[0]!.reject(new DOMException('disposed', 'AbortError'));
    });
    expect(result.current.outcome).toBeNull();
    expect(calls.map((c) => c.src)).toEqual(['a', 'ab']);
  });
});

describe('T11 review 3-3: a non-current job that rejects clobbers nothing', () => {
  it('under StrictMode, the aborted first job rejecting does not strand the second: its tree still applies', async () => {
    // The real runner rejects an aborted job with the signal's reason; this parser does the same.
    const calls: Call[] = [];
    const parser: MarkdownParser = (src, opts) =>
      new Promise<ParseOutcome>((resolve, reject) => {
        calls.push({ src, opts, resolve, reject });
        opts.signal?.addEventListener('abort', () => { reject(opts.signal?.reason); }, { once: true });
      });
    const { result } = mount(parser, { text: 'a' }, true);
    expect(calls).toHaveLength(2);
    await act(async () => {
      await Promise.resolve();
    });
    const second = treeOf('second');
    await settle(calls[1], tree(second));
    expect(result.current.pending).toBe(false);
    expect(result.current.outcome).toEqual(tree(second));
  });
});

describe('T11 review 3-5: text A -> B -> A never shows B under A', () => {
  const treeText = (o: ParseOutcome | null): string | undefined => {
    if (o?.kind !== 'tree') return undefined;
    const p = o.tree.children[0];
    const t = p?.type === 'element' ? p.children[0] : undefined;
    return t?.type === 'text' ? t.value : undefined;
  };

  it('A settled, B running, A again: A stays the outcome, nothing is queued, B only becomes the last good tree', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'A' });
    await settle(calls[0], tree(treeOf('A')));
    rerender({ text: 'B' });
    rerender({ text: 'A' });
    expect(result.current.pending).toBe(false);
    expect(treeText(result.current.outcome)).toBe('A');
    await settle(calls[1], tree(treeOf('B')));
    expect(calls.map((c) => c.src)).toEqual(['A', 'B']);
    expect(treeText(result.current.outcome)).toBe('A');
    expect(result.current.pending).toBe(false);
    expect(result.current.lastGood).toEqual(treeOf('B'));
  });

  it('a result for a text that is no longer current is kept as the last good tree only, never as the outcome', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    expect(result.current).toEqual({ outcome: null, lastGood: a, pending: true });
    await settle(calls[1], tree(treeOf('ab')));
    expect(treeText(result.current.outcome)).toBe('ab');
    expect(result.current.pending).toBe(false);
  });

  it('A running, B waiting, A again: the waiting B is dropped and A, when it settles, is the outcome', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'A' });
    rerender({ text: 'B' });
    rerender({ text: 'A' });
    await settle(calls[0], tree(treeOf('A')));
    expect(calls.map((c) => c.src)).toEqual(['A']);
    expect(treeText(result.current.outcome)).toBe('A');
    expect(result.current.pending).toBe(false);
  });
});

describe('T11 review A-5: a parser that throws synchronously settles its job as threw', () => {
  it('the job answers threw with the error name, and the waiting job still runs', async () => {
    const calls: string[] = [];
    const parser: MarkdownParser = (src) => {
      calls.push(src);
      if (src === 'a') throw new TypeError('no parser here');
      return new Promise<ParseOutcome>(() => undefined);
    };
    const { result, rerender } = mount(parser, { text: 'a' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.outcome).toEqual({ kind: 'threw', error: 'TypeError' });
    expect(result.current.pending).toBe(false);
    rerender({ text: 'b' });
    expect(calls).toEqual(['a', 'b']);
  });
});

describe("W5 N1: the hook's commit-to-effect window is closed (the latest request is recorded at commit)", () => {
  // W4's carried N1 (review 412's R5): the latest request was written in a passive effect, so a reply for the previous
  // text that settled after a newer text committed, but before that commit's passive effects ran, was taken as the
  // latest one's and became the `outcome` while the newer text was pending. In a browser that reply is the worker's
  // message, a task that can run between a commit and its passive effects. Here the window is made deterministic: the
  // parser answers with a thenable whose fulfilment the test calls itself, from a layout effect of the component that
  // renders the hook, which runs after the hook's own layout effects and before any passive effect of that commit.
  it('a reply for text A that lands after text B commits, before its passive effects, is never the outcome for B', () => {
    const srcs: string[] = [];
    const fulfil: ((o: ParseOutcome) => void)[] = [];
    const parser: MarkdownParser = (src) => {
      srcs.push(src);
      return {
        then(onFulfilled: (o: ParseOutcome) => void) {
          fulfil.push(onFulfilled);
        },
      } as unknown as Promise<ParseOutcome>;
    };
    const a = treeOf('A');
    const { result, rerender } = renderHook(
      (p: { readonly text: string }) => {
        const parsed = useParsedMarkdown(p.text, parser, { profile: 'chat', budgetMs: 2000 });
        useLayoutEffect(() => {
          if (p.text === 'B') fulfil[0]?.(tree(a));
        }, [p.text]);
        return parsed;
      },
      { initialProps: { text: 'A' } },
    );
    expect(srcs).toEqual(['A']);
    rerender({ text: 'B' });
    expect(srcs).toEqual(['A', 'B']);
    expect(result.current).toEqual({ outcome: null, lastGood: a, pending: true });
    const b = treeOf('B');
    act(() => {
      fulfil[1]?.(tree(b));
    });
    expect(result.current).toEqual({ outcome: tree(b), lastGood: b, pending: false });
  });

  it('Retry (a changed attempt alone) is the latest request: its reply becomes the outcome, and nothing is pending', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    await settle(calls[0], TIMEOUT);
    rerender({ text: 'a', attempt: 1 });
    expect(calls).toHaveLength(2);
    expect(result.current.pending).toBe(true);
    const a = treeOf('a');
    await settle(calls[1], tree(a));
    expect(result.current).toEqual({ outcome: tree(a), lastGood: a, pending: false });
  });

  // W5 Task 4 review: every case above ran the 'chat' profile, so a latest-request literal with 'chat' written into
  // it left the hook 16/16 green while a docs reply never counted as the latest request's.
  it("the docs profile: its reply is the outcome and nothing stays pending", async () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a', profile: 'docs' });
    expect(calls[0]!.opts.profile).toBe('docs');
    expect(result.current.pending).toBe(true);
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    expect(result.current).toEqual({ outcome: tree(a), lastGood: a, pending: false });
  });

  it('a profile change alone (the same text) is a new request: the newer reply is the one shown, never the earlier', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a', profile: 'chat' });
    rerender({ text: 'a', profile: 'docs' });
    expect(calls).toHaveLength(1);
    expect(result.current.pending).toBe(true);
    const chat = treeOf('chat');
    await settle(calls[0], tree(chat));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.opts.profile).toBe('docs');
    expect(result.current).toEqual({ outcome: null, lastGood: chat, pending: true });
    const docs = treeOf('docs');
    await settle(calls[1], tree(docs));
    expect(result.current).toEqual({ outcome: tree(docs), lastGood: docs, pending: false });
  });
});
