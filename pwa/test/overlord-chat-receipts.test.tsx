// The Overlord chat's `opened` receipt for a recorded reply (Overlord W1 chat, PR B, Task 5; spec §4.3, C67): a reply on screen, at
// least half visible for one second while the document is visible, posts ONE receipt for `{ kind: 'reply', id }`, once per reply
// per page load, batched, at most one request a second, never on render, never for a reply scrolled past in under a second,
// never while the document is hidden; a failed post changes nothing on screen. Over a fake IntersectionObserver and fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { OverlordReplyRow } from '../../shared/operatorMessages';
import type { ChatEntry } from '../../shared/overlordChat';
import { api } from '../src/lib/api';
import { ChatReply, resetReplyReceipts } from '../src/overlord/ChatReply';

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const row = (id: number): OverlordReplyRow => ({
  id, at: T0, turnAt: T0, term: 1, entryUuid: `e0e0e0e0-0000-4000-8000-${String(id).padStart(12, '0')}`, text: `fixture reply ${id}`,
  cut: false, sha256: 'b'.repeat(64), inReplyTo: null, offRecord: false,
});
const entry = (id: number): Extract<ChatEntry, { kind: 'reply' }> => ({ kind: 'reply', row: row(id), response: { kind: 'row', id: id * 10, handledAt: null } });

/** A fake observer: nothing is seen until the test says so, as the browser would. */
class FakeObserver {
  static all: FakeObserver[] = [];
  target: Element | null = null;
  gone = false;
  cb: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.cb = cb;
    this.options = options;
    FakeObserver.all.push(this);
  }
  observe(el: Element): void { this.target = el; }
  unobserve(): void {}
  disconnect(): void { this.gone = true; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  /** The element is `ratio` visible, `visibleHeight` px of it inside a viewport `rootHeight` px tall. */
  see(ratio: number, visibleHeight = 100, rootHeight = 800): void {
    const e = { target: this.target, intersectionRatio: ratio, isIntersecting: ratio > 0, intersectionRect: { height: visibleHeight }, rootBounds: { height: rootHeight } };
    this.cb([e as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
const live = (): FakeObserver[] => FakeObserver.all.filter((o) => !o.gone);
const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const seeNow = (o: FakeObserver, ...a: [number?, number?, number?]): void => { act(() => { o.see(...(a as [number, number, number])); }); };
const setVisibility = (v: 'visible' | 'hidden'): void => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(v);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};
const opened = (id: number) => ({ ref: { kind: 'reply', id }, receipt: 'opened', from: { source: 'console' } });

let post: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  resetReplyReceipts();
  post = vi.spyOn(api, 'postResponseReceipts').mockResolvedValue({ ok: true, kept: 1, dropped: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('a reply seen for a second posts one opened receipt', () => {
  it('never on render: a reply nobody has seen posts nothing, however long it sits', async () => {
    render(<ChatReply entry={entry(8)} />);
    await tick(10_000);
    expect(post).not.toHaveBeenCalled();
  });

  it('half visible for one second: one receipt for { kind: reply, id }, from the console; not a moment sooner', async () => {
    render(<ChatReply entry={entry(8)} />);
    seeNow(live()[0]!, 0.5);
    await tick(999);
    expect(post).not.toHaveBeenCalled();
    await tick(2); // the second ends at 1000 ms; the request goes in the next moment, so replies seen together ride one
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([opened(8)]);
    await tick(10_000);
    expect(post, 'once').toHaveBeenCalledTimes(1);
  });

  it('less than half visible never posts; a reply taller than the viewport counts when it fills half of it', async () => {
    render(<><ChatReply entry={entry(8)} /><ChatReply entry={entry(9)} /></>);
    const [a, b] = live();
    seeNow(a!, 0.49, 100, 800);
    seeNow(b!, 0.2, 400, 800);
    await tick(5_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([opened(9)]);
  });

  it('scrolled past in under a second posts none', async () => {
    render(<ChatReply entry={entry(8)} />);
    const o = live()[0]!;
    seeNow(o, 1);
    await tick(600);
    seeNow(o, 0);
    await tick(10_000);
    expect(post).not.toHaveBeenCalled();
    // Back in view: the second counts from the new sight, never from the first.
    seeNow(o, 1);
    await tick(600);
    expect(post).not.toHaveBeenCalled();
    await tick(402);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a hidden document posts none: seen while hidden, or hidden before the second ends; shown again, the second starts over', async () => {
    render(<ChatReply entry={entry(8)} />);
    const o = live()[0]!;
    setVisibility('hidden');
    seeNow(o, 1);
    await tick(5_000);
    expect(post).not.toHaveBeenCalled();
    setVisibility('visible');
    await tick(900);
    expect(post).not.toHaveBeenCalled();
    setVisibility('hidden');
    await tick(5_000);
    expect(post).not.toHaveBeenCalled();
    setVisibility('visible');
    await tick(1_002);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('the same reply twice posts one: two renders, a remount, and a second copy on the page', async () => {
    const { rerender, unmount } = render(<ChatReply entry={entry(8)} />);
    rerender(<ChatReply entry={entry(8)} />);
    seeNow(live()[0]!, 1);
    await tick(1_002);
    expect(post).toHaveBeenCalledTimes(1);
    unmount();
    render(<ChatReply entry={entry(8)} />);
    for (const o of live()) seeNow(o, 1);
    await tick(10_000);
    expect(post, 'a remount of the part never posts a reply posted this page load').toHaveBeenCalledTimes(1);
  });

  it('a reply that unmounts before its second is up is not posted', async () => {
    const a = render(<ChatReply entry={entry(8)} />);
    seeNow(live()[0]!, 1);
    await tick(400);
    a.unmount();
    await tick(10_000);
    expect(post).not.toHaveBeenCalled();
  });

  it('a failed post changes nothing on screen, throws nothing, and is not retried', async () => {
    post.mockRejectedValue(new Error('offline'));
    const r = render(<ChatReply entry={entry(8)} />);
    const before = r.container.innerHTML;
    seeNow(live()[0]!, 1);
    await tick(1_002);
    expect(post).toHaveBeenCalledTimes(1);
    expect(r.container.innerHTML).toBe(before);
    await tick(30_000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a post that throws at once changes nothing either', async () => {
    post.mockImplementation(() => { throw new Error('no client'); });
    const r = render(<ChatReply entry={entry(8)} />);
    const before = r.container.innerHTML;
    seeNow(live()[0]!, 1);
    await tick(1_002);
    expect(post).toHaveBeenCalledTimes(1);
    expect(r.container.innerHTML).toBe(before);
  });
});

describe('the receipts are batched, and at most one request a second', () => {
  it('two replies seen together ride one request', async () => {
    render(<><ChatReply entry={entry(8)} /><ChatReply entry={entry(9)} /></>);
    for (const o of live()) seeNow(o, 1);
    await tick(1_002);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([opened(8), opened(9)]);
  });

  it('a second reply seen soon after the first waits out the second: never two requests within a second', async () => {
    render(<><ChatReply entry={entry(8)} /><ChatReply entry={entry(9)} /></>);
    const [a, b] = live();
    seeNow(a!, 1);
    await tick(500);
    seeNow(b!, 1);
    await tick(502);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith([opened(8)]);
    await tick(998);
    expect(post, 'the second reply is ready at 1.5 s, but the last request went at 1 s').toHaveBeenCalledTimes(1);
    await tick(2);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith([opened(9)]);
  });

  it('a request that is due while the document is hidden waits for it to be shown', async () => {
    render(<><ChatReply entry={entry(8)} /><ChatReply entry={entry(9)} /></>);
    const [a, b] = live();
    seeNow(a!, 1);
    await tick(500);
    seeNow(b!, 1);
    await tick(502);
    expect(post).toHaveBeenCalledTimes(1);
    await tick(600);
    setVisibility('hidden');
    await tick(5_000);
    expect(post, 'hidden: nothing goes').toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await tick(2);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
