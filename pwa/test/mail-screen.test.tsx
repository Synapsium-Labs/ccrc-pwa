// /mail — the durable feed's first renderer, and its door (D-2/D-3, Task 4).
//
// Two things this suite pins that are easy to get quietly wrong:
//   * the screen must show BOTH the durable read (`GET /api/feed`) and the
//     live catch-up tail, merged and deduped — a screen that only shows one
//     of the two either loses history across a deploy (D-3) or never shows
//     what just happened;
//   * `MailBadge` is the ONLY door to this screen (D-2) and, exactly like
//     `AccountsStrip` before it, must never render nothing — the state a
//     count of zero describes is not a state the control may vanish in.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { NotifyEvent } from '../../shared/api';
import { MailScreen } from '../src/screens/MailScreen';
import { MailBadge } from '../src/fleet/MailBadge';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { ack, FEED_ACK_KEY, acksSnapshot, resetAcks } from '../src/lib/seen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); resetAcks(); });

// NOTE: `NotifyEvent` carries no `runId` (shared/api.ts) — the plan's own
// Interfaces-assumed-from-PR-I reconciliation (item 2) records that the field
// was never shipped, so a feed row cannot link back to its run without a
// second lookup. This fixture omits it rather than asserting a field that
// does not typecheck.
const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: Date.now() - 60_000, kind: 'mail', sessionId: 'ccrc-pwa-clear-cove',
  title: '✉ finding › clear-cove', body: 'The hold gate re-reads at the decision point.',
  ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

describe('the mail feed', () => {
  it('renders the durable read AND the live tail, deduped by record identity', async () => {
    const store = makeStore();
    // ONE event object for the "seq:2" record, reused at both call sites —
    // lib/feed.ts's `recordKey` identifies a record by `${at}:${seq}`, not
    // `seq` alone (seq resets every epoch), so two SEPARATE `e()` calls each
    // minting their own `Date.now()`-based `at` can land a millisecond apart
    // and dedupe would flake open. A real event has one `at`, minted once and
    // carried unchanged across the catch-up and durable reads; this fixture
    // matches that rather than the accident of two nearby clock reads.
    const live = e({ seq: 2, title: 'live' });
    act(() => { store.setState({ feed: [live] }); });
    const feed = vi.fn().mockResolvedValue({ events: [e({ seq: 1, title: 'durable' }), live] });
    render(<MailScreen store={store} loadFeed={feed} />);
    expect(await screen.findByText('durable')).toBeInTheDocument();
    expect(screen.getAllByText('live')).toHaveLength(1);
  });

  // Fix round 1, Task 4, finding 2c: the store holds the feed oldest-first
  // (`mergeBySeq` sorts ascending by `at`), and the screen's own comment says
  // it renders "newest first on screen" via `.reverse()` — but nothing
  // asserted an order at all, so dropping `.reverse()` left every other test
  // green. This picks the screen's stated order and pins it.
  it('renders newest first on screen, per the screen\'s own stated order', () => {
    const store = makeStore();
    const now = Date.now();
    act(() => {
      store.setState({
        feed: [
          e({ seq: 1, at: now - 120_000, title: 'oldest' }),
          e({ seq: 2, at: now - 60_000, title: 'middle' }),
          e({ seq: 3, at: now, title: 'newest' }),
        ],
      });
    });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    const titles = [...document.querySelectorAll('.mail-row-title')].map((el) => el.textContent);
    expect(titles).toEqual(['newest', 'middle', 'oldest']);
  });

  it('says the presence-gate truth in words, permanently', () => {
    // Spec §6: a record lands whether or not you were watching; only the PUSH
    // is gated. An operator who learns that from a missing phone ping learns
    // the wrong lesson.
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByText(/whether or not you were watching/i)).toBeInTheDocument();
  });

  it('renders a kind from a newer build rather than hiding the record', () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e({ kind: 'unknown', title: 'something new', body: 'from a newer build' })] }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByText('something new')).toBeInTheDocument();
    expect(screen.getByText('from a newer build')).toBeInTheDocument();
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it('says how many records it could not read at all', () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e()], feedDropped: 2 }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByText(/2 records this build could not read/i)).toBeInTheDocument();
  });

  it('marks unread rows before the ack and none after it', async () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e({ seq: 1 }), e({ seq: 2 })] }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    // Opening the screen IS the ack — the same rule SessionScreen's mount ack
    // follows (SessionScreen.tsx:78-95).
    await vi.waitFor(() => expect(acksSnapshot()[FEED_ACK_KEY]).toBeGreaterThan(0));
    expect(document.querySelectorAll('[data-unseen="true"]')).toHaveLength(0);
  });

  // Fix round 1, Task 4, finding 4: the test above only ever asserted the
  // AFTER half — a row that is NEVER marked unread satisfies it trivially,
  // and a mutant that hardcodes `data-unseen="false"` (deleting the
  // `isUnseenAt` comparison outright) left the whole suite green. This pins
  // the BEFORE half: `isUnseenAt` must render `true` for a row whose `at` is
  // newer than the ack watermark.
  //
  // The mount effect floors the watermark to `max(now, newest)` on every
  // commit that has a non-null `newest` — including this screen's own first
  // one — so by the time `render()` returns the whole visible feed is
  // already acked (measured: opening the screen really does self-ack
  // instantly in this harness, since React flushes the mount effect
  // synchronously inside `render()`'s own `act()`). A watermark set AFTER
  // mount is the deterministic way to observe the comparison's TRUE branch:
  // the ack effect's own dependency is `[newest]` alone, which this does not
  // touch, so the rollback survives the next render rather than being
  // immediately re-clobbered.
  it('marks a row unseen when the ack watermark sits behind it', () => {
    const store = makeStore();
    const at = Date.now() - 60_000;
    act(() => { store.setState({ feed: [e({ seq: 1, at })] }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    act(() => { ack(FEED_ACK_KEY, at - 1); });
    expect(document.querySelectorAll('[data-unseen="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-unseen="false"]')).toHaveLength(0);
  });

  it('has a back control at the tap floor and an empty state that is not a blank screen', async () => {
    // `findByText`, not `getByText`: before this screen's own read resolves,
    // "loading" and "confirmed empty" are no longer the same render (review
    // finding 19) — a synchronous assertion would hit the loading state.
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('mail-back');
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument();
  });

  it('says it could not read, not "Nothing yet", when the read fails (review finding 19)', async () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => { throw new Error('offline'); }} />);
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/^nothing yet\.?$/i)).toBeNull();
  });

  // Fix round 1, Task 4, findings 1 and 3: the shipped default was an inline
  // arrow used as a DEFAULT PARAMETER (`loadFeed = () => api.feed(100)`) — a
  // fresh identity on every render — sitting in the effect's own dependency
  // array. The cycle closed through the store: `mergeFeed` -> `mergeBySeq`
  // (lib/feed.ts) allocates a fresh `feed` array even for a no-op merge, so
  // every merge re-rendered this screen, re-minted the default, and re-fired
  // the effect — an unbounded `GET /api/feed` loop with no test anywhere on
  // the DEFAULT path (every shipped test passed its own stable `loadFeed`).
  //
  // Every call past the first is left permanently unresolved rather than
  // answered: a real regression would refire the effect synchronously,
  // inside the SAME microtask chain, for as long as something keeps handing
  // it a freshly-resolved promise — an unbounded, ever-growing chain that
  // starves the event loop rather than erroring (measured elsewhere: an
  // unbounded probe of this exact shape ran long enough to OOM the worker
  // before any timer-based assertion ever got scheduled). A promise that
  // never settles cannot feed that chain a second link, so a regression here
  // fails fast — as a call count greater than 1 — instead of hanging the
  // suite.
  it('reads the default loader exactly once per mount — a merge-induced re-render must not refire it', async () => {
    const store = makeStore();
    let calls = 0;
    const feedSpy = vi.spyOn(api, 'feed').mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ events: [] }) : new Promise<never>(() => {});
    });
    render(<MailScreen store={store} />); // no `loadFeed` prop — the shipping default
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(feedSpy).toHaveBeenCalledTimes(1);
    // Drive the exact identity churn `mergeFeed` produces even on a no-op
    // merge — the trigger that used to restart the effect.
    act(() => { store.getState().mergeFeed([]); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(feedSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the door', () => {
  it('is always rendered — with a count, and without one', () => {
    // AccountsStrip.tsx:9-15's rule, inherited: the ONLY door to a screen may
    // never render nothing, or the screen is unreachable in exactly the state
    // it exists to explain.
    const { rerender } = render(<MailBadge unread={0} />);
    expect(screen.getByRole('button', { name: /mail — nothing unread/i })).toBeInTheDocument();
    rerender(<MailBadge unread={3} />);
    expect(screen.getByRole('button', { name: /mail — 3 unread/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('navigates rather than toggling anything', () => {
    render(<MailBadge unread={1} />);
    fireEvent.click(screen.getByRole('button', { name: /mail/i }));
    expect(location.pathname).toBe('/mail');
  });

  it('nests no control inside another', () => {
    // The standing rule (commit ce313de). The bell is a separate button beside
    // this one, never inside it.
    render(<MailBadge unread={1} />);
    const btn = screen.getByRole('button', { name: /mail/i });
    expect(btn.querySelector('button')).toBeNull();
  });

  it('caps the printed count so a three-digit number cannot blow the head open', () => {
    render(<MailBadge unread={412} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mail — 412 unread/i })).toBeInTheDocument();
  });
});
