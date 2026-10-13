// `useParsedMarkdown` (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clause 3, the W4 plan's
// refinements (g) and (i)). The hook keeps at most one job running and one queued, the queued one replaced; applies
// a result only while its job is still the hook's running job; keeps the last good tree through any later outcome;
// aborts the running job and drops the queued one on unmount; parses again on a changed budget or attempt; and
// swallows a rejection. Every case drives a deferred fake parser that IGNORES its signal, so a job settles only
// when the test says so, even after the hook has aborted it (a parser that answers late).
import { afterEach, describe, expect, it } from 'vitest';
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
}

function mount(parser: MarkdownParser, initialProps: Props, strict = false) {
  return renderHook(
    (p: Props) => useParsedMarkdown(p.text, parser, { profile: 'chat', budgetMs: p.budgetMs ?? 2000, attempt: p.attempt }),
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
