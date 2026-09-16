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
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { NotifyEvent, RunSummary } from '../../shared/api';
import { MailScreen } from '../src/screens/MailScreen';
import { MailBadge } from '../src/fleet/MailBadge';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { ack, FEED_ACK_KEY, acksSnapshot, resetAcks } from '../src/lib/seen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); resetAcks(); });

// NOTE: `NotifyEvent` now carries `runId` (cross-repo programmes, design
// 2026-09-08 §4 — superseding the earlier "no second lookup" call the plan's
// PR I reconciliation item 2 made). This fixture builds a run-less event.
const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: Date.now() - 60_000, kind: 'mail', sessionId: 'ccrc-pwa-clear-cove',
  title: '✉ finding › clear-cove', body: 'The hold gate re-reads at the decision point.',
  runId: null,
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

  // TASK 412's other half. The SENDER-side block and park signals land in the
  // FEED, not in the session's mail strip, because the strip is recipient-side
  // — the sender is a different session on a different screen. They reuse the
  // existing `mail` kind ON PURPOSE: `KIND_WORD` and `KIND_GLYPH` are TOTAL
  // maps over `NotifyEvent['kind']`, so a seventh kind means editing both plus
  // `NOTIFY_KINDS`, and every older client renders `undefined`.
  //
  // THE FIXTURE IS A HAND COPY, and nothing links it to the producer (review,
  // W4c finding 2). This comment used to claim the strings were "copied
  // verbatim... so this fixture stays a measurement of the shipped producer";
  // they are copied verbatim, but a copied string is not a measurement —
  // `✉ blocked › ` exists in `watch.ts` and in this file and nowhere else, with
  // nothing holding the two together. What each side really measures:
  //  - THE PRODUCER is measured server-side, where it lives: `mail-sweep`'s
  //    Task 409 tests drive the real `tellSender` calls and assert a blocked
  //    body `toContain('input box')` and a park matching /gave up|undeliverable/.
  //  - THIS TEST measures the RENDERER, and only that — that whatever `title`
  //    and `body` ride a `mail`-kind feed row are rendered WHOLE, under the
  //    total kind maps' own glyph and word.
  // So the assertions below match the fixture's OWN bytes exactly rather than
  // a paraphrase of them, which is a real guard and not bookkeeping: with a
  // loose regex, a row that rendered most of a body passed — measured, by
  // dropping `${subject}: ` in `MailScreen`, which left this whole suite
  // green. If `watch.ts` rewords, this fixture goes stale as PROSE and nothing
  // here reds, correctly: none of these assertions are claims about what the
  // producer says. The bytes are `watch.ts`'s own as of this commit
  // (`✉ blocked › ${d.toId}` and `${origin.subject}: ${why}`), kept faithful so
  // the fixture reads like the thing it stands in for.
  // The SEVENTH kind. A coordination-config change is none of the six: 'run'
  // would be the nearest and would be a lie, because there is no run. The maps
  // are TOTAL, so a missing entry is a TS2739 at the table — but at RUNTIME a
  // missing entry renders as NOTHING, not as the string "undefined", so this
  // asserts the rendered word and glyph are actually there. (Measured: a first
  // draft asserting `not.toContain('undefined')` passed against the defect.)
  // The fixture's title deliberately carries no glyph of its own, so the glyph
  // assertion cannot be satisfied by the title.
  it('renders a coord-kind feed record with its own word and glyph', async () => {
    const store = makeStore();
    const ev = e({ seq: 9, kind: 'coord', sessionId: '', title: 'caps changed',
                   body: 'workers 3 → 5, per day 12 → 12' });
    act(() => { store.setState({ feed: [ev] }); });
    const { container } = render(
      <MailScreen store={store} loadFeed={vi.fn().mockResolvedValue({ events: [] })} />);
    expect(await screen.findByText('caps changed')).toBeInTheDocument();
    const kind = container.querySelector('.mail-kind');
    expect(kind, 'the coord row rendered no kind cell at all').not.toBeNull();
    expect(kind!.querySelector('.mail-kind-glyph')!.textContent, 'no glyph for coord').toBe('⚙');
    expect(kind!.textContent, 'no word for coord').toContain('config');
  });

  const BLOCKED_TITLE = '✉ blocked › w1';
  const BLOCKED_BODY = "wave-brief: the recipient's input box has unsent text in it";

  it('renders a blocked-mail record with the ordinary mail glyph and word', async () => {
    const store = makeStore();
    const blocked = e({ seq: 4, sessionId: 'boss', title: BLOCKED_TITLE, body: BLOCKED_BODY });
    act(() => { store.setState({ feed: [blocked] }); });
    render(<MailScreen store={store} loadFeed={vi.fn().mockResolvedValue({ events: [] })} />);
    expect(await screen.findByText(BLOCKED_TITLE)).toBeInTheDocument();
    // The kind word an unknown kind would NOT produce — the map stayed total.
    expect(screen.getByText(/^mail$/)).toBeInTheDocument();
    // WHOLE, not "contains the interesting part": the `${subject}: ` half is
    // how the sender knows WHICH of its messages is the blocked one.
    expect(screen.getByText(BLOCKED_BODY)).toBeInTheDocument();
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

// ── cross-repo wave 2: the feed reads by programme (spec §4) ─────────────────
//
// One fleet, several programmes, and — since wave 1 — waves in more than one
// repo per programme. A flat feed makes "what happened on build9b" a scrolling
// exercise. The KEY is the record's own `runId`; the TITLE comes from the runs
// read this app already makes.
//
// THREE cases, not two, and that is the point of the third: a record with no
// `runId` (an ask, a merge, anything not run-scoped) and a record whose `runId`
// names a run this read did not return (a rebuilt coord.db, a run older than
// the read, a failed read) are DIFFERENT facts. Folding them would put "this is
// not part of a programme" over a record that certainly is.
const RUNS = [
  { id: 5, program: 'build9b', programTitle: 'Build 9b: peers and claims' },
  { id: 6, program: 'crossrepo', programTitle: 'Cross-repo programmes' },
] as unknown as RunSummary[];

const loadRuns = (): Promise<{ runs: RunSummary[] }> => Promise.resolve({ runs: RUNS });

describe('the feed, grouped by programme', () => {
  const mount = (events: NotifyEvent[], runs = loadRuns): void => {
    const store = makeStore();
    render(<MailScreen store={store} loadFeed={async () => ({ events })} loadRuns={runs} />);
  };

  it('puts each record under its programme’s own title', async () => {
    // Queried by SELECTOR, not by text: the chip row (`groups.size > 1`, so it
    // renders here) puts the exact same string on a `<button>` beside the
    // `<p class="mail-group-head">`, and `findByText`/`getByText` throw on
    // "Found multiple elements" the moment both are on the page. The header
    // list is what this case is actually about; the chip's own text is
    // asserted by role, in "filters to one programme on its chip" below.
    //
    // Explicit, well-separated `at` values (D-2583): the two fixtures below
    // used to rely on `e()`'s default `at: Date.now() - 60_000`, which ties
    // (or nearly ties) across two calls in the same tick and leaves the
    // group ORDER hostage to `Date.now()` monotonicity and `mergeBySeq`'s
    // seq tiebreak rather than to anything this case states. Stated here
    // instead: wave 2 is the MORE RECENT record, so under this screen's own
    // "newest first on screen; oldest-first in the store" convention — the
    // comment on `MailScreen.tsx`'s `rows = [...feed].reverse()` line, cited
    // by that text rather than a line number so a later move cannot
    // falsify this the way D-2586 found (backed by `mergeBySeq`'s ascending
    // sort in `lib/feed.ts`) — its programme heads the list — group order
    // follows first-appearance in that same newest-first order, never the
    // order the events were constructed in.
    const now = Date.now();
    mount([e({ seq: 1, runId: 5, at: now - 120_000, title: 'wave 1 dispatched' }),
           e({ seq: 2, runId: 6, at: now - 60_000, title: 'wave 2 dispatched' })]);
    await waitFor(() => {
      const heads = [...document.querySelectorAll('.mail-group-head')].map((h) => h.textContent);
      expect(heads).toEqual(['Cross-repo programmes', 'Build 9b: peers and claims']);
    });
  });

  it('puts a record with NO runId under its own header, never under a programme', async () => {
    // Same reason as the case above: `groups.size` is 2 here too (one
    // programme group, one programless group), so the chip row renders and
    // both headers' text is duplicated onto a `<button>`. Querying
    // `.mail-group-head` directly is what keeps this a claim about the
    // HEADERS rather than about however many elements happen to carry the
    // string.
    //
    // Explicit `at`, same reason as above (D-2583): the ask is the MORE
    // RECENT record, so under `MailScreen.tsx`'s own "newest first on
    // screen" comment its header comes first — the order below states that
    // rather than leaning on construction order or the clock.
    const now = Date.now();
    mount([e({ seq: 1, runId: 5, at: now - 120_000, title: 'wave 1 dispatched' }),
           e({ seq: 2, runId: null, at: now - 60_000, title: 'an ask' })]);
    await waitFor(() => {
      expect([...document.querySelectorAll('.mail-group-head')].map((h) => h.textContent))
        .toEqual(['Not part of a programme', 'Build 9b: peers and claims']);
    });
    const programGroup = [...document.querySelectorAll('.mail-group')]
      .find((g) => g.querySelector('.mail-group-head')?.textContent === 'Build 9b: peers and claims');
    expect(programGroup!.textContent).not.toContain('an ask');
  });

  it('says a runId it could not resolve is UNRESOLVED, not programless', async () => {
    mount([e({ seq: 1, runId: 99, title: 'from a run this read never saw' })]);
    expect(await screen.findByText('run 99 — programme not measured')).toBeInTheDocument();
    expect(screen.queryByText('Not part of a programme')).toBeNull();
  });

  it('keeps rendering every record when the runs read fails — grouping is a nicety, the feed is not', async () => {
    // D-2587: the previous fixture mounted exactly ONE record, so "every
    // record" was asserted over a population of one — a mutation that
    // dropped every record but the first on a failed read would have stayed
    // green. Widened to three, with explicit `at` values 60 seconds apart
    // (D-2583's own lesson: state the order, never lean on the clock): an
    // ask (no runId, the NEWEST), a run this read might otherwise have
    // resolved (runId 6), and an older one (runId 5) — measured newest-first
    // heads below.
    const now = Date.now();
    mount(
      [
        e({ seq: 1, runId: 5, at: now - 180_000, title: 'wave 1 dispatched' }),
        e({ seq: 2, runId: 6, at: now - 120_000, title: 'wave 2 dispatched' }),
        e({ seq: 3, runId: null, at: now - 60_000, title: 'an ask' }),
      ],
      () => Promise.reject(new Error('offline')),
    );
    expect(await screen.findByText('wave 1 dispatched')).toBeInTheDocument();
    expect(screen.getByText('wave 2 dispatched')).toBeInTheDocument();
    expect(screen.getByText('an ask')).toBeInTheDocument();
    await waitFor(() => {
      expect([...document.querySelectorAll('.mail-group-head')].map((h) => h.textContent)).toEqual([
        'Not part of a programme',
        'run 6 — programme not measured',
        'run 5 — programme not measured',
      ]);
    });
  });

  it('filters to one programme on its chip, and restores on All', async () => {
    mount([e({ seq: 1, runId: 5, title: 'wave 1 dispatched' }),
           e({ seq: 2, runId: 6, title: 'wave 2 dispatched' })]);
    const build9bChip = await screen.findByRole('button', { name: 'Build 9b: peers and claims' });
    expect(screen.getByRole('group', { name: 'filter by programme' })).toBeInTheDocument();
    const allChip = screen.getByRole('button', { name: 'All' });
    const crossrepoChip = screen.getByRole('button', { name: 'Cross-repo programmes' });
    // Before any tap: All carries both the accessible and the visible cue
    // (`aria-pressed`, `data-on`); the two programme chips carry neither.
    // Both attributes are otherwise unwitnessed anywhere in the suite, even
    // though a CSS rule (`.mail-chip[data-on]`) and an `INHERITED_GROUNDS`
    // entry both document the pressed chip's look.
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('data-on', 'true');
    expect(build9bChip).toHaveAttribute('aria-pressed', 'false');
    expect(build9bChip).not.toHaveAttribute('data-on');
    fireEvent.click(build9bChip);
    expect(screen.getByText('wave 1 dispatched')).toBeInTheDocument();
    expect(screen.queryByText('wave 2 dispatched')).toBeNull();
    // The tapped chip now carries both cues; All and its sibling carry
    // neither.
    expect(build9bChip).toHaveAttribute('aria-pressed', 'true');
    expect(build9bChip).toHaveAttribute('data-on', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
    expect(allChip).not.toHaveAttribute('data-on');
    expect(crossrepoChip).toHaveAttribute('aria-pressed', 'false');
    expect(crossrepoChip).not.toHaveAttribute('data-on');
    fireEvent.click(allChip);
    expect(screen.getByText('wave 2 dispatched')).toBeInTheDocument();
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(build9bChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('a filter pinned to a group key that later vanishes never blanks the screen (D-2584)', async () => {
    // The runs read can land AFTER a chip is tapped: the SAME record's group
    // key moves from `run:5` (unresolved) to `program:build9b` (resolved)
    // out from under an already-set filter. `shown` would filter to nothing,
    // and the empty-state branch above reads `rows.length`, never
    // `shown.length`, so without `activeFilter`'s fallback the screen would
    // go blank with no message at all — "there is no mail" and "nothing
    // matches this filter" collapsing to one silent render.
    let resolveRuns!: (v: { runs: RunSummary[] }) => void;
    const deferred = new Promise<{ runs: RunSummary[] }>((resolve) => { resolveRuns = resolve; });
    const now = Date.now();
    const store = makeStore();
    render(
      <MailScreen
        store={store}
        loadFeed={async () => ({
          events: [
            e({ seq: 1, runId: 5, at: now - 120_000, title: 'wave 1 dispatched' }),
            e({ seq: 2, runId: null, at: now - 60_000, title: 'an ask' }),
          ],
        })}
        loadRuns={() => deferred}
      />,
    );
    // Before the runs read resolves, runId 5's key is `run:5` — filter on it.
    fireEvent.click(await screen.findByRole('button', { name: 'run 5 — programme not measured' }));
    expect(screen.getByText('wave 1 dispatched')).toBeInTheDocument();
    expect(screen.queryByText('an ask')).toBeNull();
    // The runs read lands: runId 5's key changes from `run:5` to
    // `program:build9b`. The filter, still pinned to the now-vanished
    // `run:5` key, must fall back to All rather than leaving the screen
    // blank.
    await act(async () => { resolveRuns({ runs: RUNS }); });
    await waitFor(() => {
      expect(screen.getByText('wave 1 dispatched')).toBeInTheDocument();
    });
    expect(screen.getByText('an ask')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('resolves a CLOSED wave\'s own header through the shipping default, `api.runs(true)`', async () => {
    // Every other case in this block supplies its own `loadRuns` fixture and
    // never exercises `loadRunsDefault` at all — the sibling default-loader
    // case above spies on `api.feed` for the same reason. `loadRunsDefault`'s
    // own docstring says the WHOLE POINT of the `true` argument is that a
    // feed record outlives its run; answer the two arguments differently so a
    // silently dropped `true` reverts this header to "not measured" instead
    // of naming the programme.
    const runsSpy = vi.spyOn(api, 'runs').mockImplementation((closed?: boolean) =>
      Promise.resolve({
        runs: closed
          ? [{ id: 9, program: 'build9b', programTitle: 'Build 9b: peers and claims' } as unknown as RunSummary]
          : [],
      }));
    const store = makeStore();
    render(<MailScreen store={store}
                        loadFeed={async () => ({ events: [e({ runId: 9, title: 'wave 5 merged' })] })} />);
    expect(await screen.findByText('Build 9b: peers and claims')).toBeInTheDocument();
    expect(runsSpy).toHaveBeenCalledWith(true);
  });

  it('reads the runs loader exactly once per mount, regardless of the caller\'s identity discipline', async () => {
    // A STABLE spy alone cannot fail for the reason this effect's own comment
    // names ("'once per mount' has to hold regardless of the CALLER's
    // identity discipline") — it never drives a re-render at all, so `[store]`
    // and a hypothetical `[loadRuns]` would look identical. Copy the sibling
    // durable-feed case's shape instead: re-render with a FRESH `loadRuns`
    // identity (an inline arrow a future caller might mint each render, same
    // as `loadFeedRef`'s own docstring worries about) and confirm the ref-held
    // read still does not restart.
    let calls = 0;
    const store = makeStore();
    const { rerender } = render(
      <MailScreen store={store} loadFeed={async () => ({ events: [e()] })}
                  loadRuns={(): Promise<{ runs: RunSummary[] }> => { calls += 1; return loadRuns(); }} />);
    await screen.findByText('Not part of a programme');
    expect(calls).toBe(1);
    rerender(
      <MailScreen store={store} loadFeed={async () => ({ events: [e()] })}
                  loadRuns={(): Promise<{ runs: RunSummary[] }> => { calls += 1; return loadRuns(); }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(calls).toBe(1);
  });

  it('protects a record that reached the renderer without going through revival (D-2585)', async () => {
    // `eventRunId`'s own docstring (`lib/feed.ts`) states its purpose as
    // "belt to that braces for a row that reached the renderer without
    // proving it went through revival" — every OTHER case in this describe
    // block mounts via `loadFeed`, which always revives
    // (`reviveNotifyEvents` -> `reviveNotifyEvent`), so none of them can
    // tell `eventRunId(ev)` apart from a bare `ev.runId` read (see the
    // Step-5 mutation-3 finding in the task report). This case puts a row
    // into the store DIRECTLY — the idiom the older
    // `describe('the mail feed', ...)` block above already uses
    // (`act(() => { store.setState({ feed: [...] }); })`) — bypassing
    // revival on purpose.
    const store = makeStore();
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} loadRuns={loadRuns} />);
    // Wait for the empty state FIRST: the durable read's own (empty) resolve
    // must land before this case writes `feed` itself, so nothing else can
    // clobber it afterward.
    await screen.findByText('Nothing yet.');
    act(() => {
      // Omit the key entirely, not merely set it to `null` — a real
      // `NotifyEvent` object literal cannot omit `runId` (`number | null`,
      // not optional) without failing `tsc`, so the `as unknown as
      // NotifyEvent` cast is LOAD-BEARING: it is what lets this case build
      // exactly the shape revival forbids and `eventRunId`'s fallback
      // exists for, measuring the RUNTIME guard rather than the type
      // checker.
      const { runId: _bypassed, ...withoutRunId } = e();
      store.setState({ feed: [withoutRunId as unknown as NotifyEvent] });
    });
    expect(await screen.findByText('Not part of a programme')).toBeInTheDocument();
  });
});
