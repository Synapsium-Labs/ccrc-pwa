// Routing spec 2026-09-14 §5.3, slice 4, Task 5 — the model/effort pickers'
// write. A tap sends `POST /api/sessions/:id/route` (`api.route`) instead of
// a slash command, and the header chip wears a `queued` badge until the live
// fleet frame reads the write back (or 60s pass with no confirmation).
//
// The harness is `session-lifecycle.test.tsx`'s own shape: the Virtuoso
// stand-in jsdom needs, and `act`-wrapped `fireEvent`s against a real
// `SessionScreen`. This file additionally mocks `../src/lib/api` — the one
// module `SessionScreen`'s picker calls reach directly, never through the
// session store's own `api` (that only serves the composer's `prompt`/
// `resolve`) — so `route`/`prompt` are both spies this file controls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { SessionScreen } from '../src/screens/SessionScreen';
import { ToastHost } from '../src/components/Toast';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: {
      totalCount: number;
      itemContent: (i: number) => ReactNode;
      computeItemKey?: (i: number) => string | number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)),
        ),
      ),
  };
});

// `vi.mock`'s factory is hoisted above every top-level statement in this
// file, so the spies it closes over have to be created through `vi.hoisted`
// — a bare `const route = vi.fn()` above this call would still run AFTER the
// factory, and `route` inside it would throw on the temporal-dead-zone read
// (measured: "Cannot access 'route' before initialization").
const { route, prompt } = vi.hoisted(() => ({
  route: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { ...actual.api, route, prompt } };
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  route.mockClear();
  route.mockResolvedValue(undefined);
  prompt.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ID = 'claude:OpenClawHetzner';
const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
  id: ID, wrapper: 'claude', home: 'claude', project: 'OpenClawHetzner',
  workdir: '/root/projects/OpenClawHetzner', workspace: null, name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  // Non-null model/effort — the header's model/effort chips only render at
  // all once one of model/branch/effort/ultracode is truthy (`SessionHeader`'s
  // `hasMeta`), and the `queued` badge for a field rides that field's own
  // chip. `Sonnet 5`/`medium`, deliberately neither of the values these
  // tests pick, so a tap is a real change to read back.
  version: null, model: 'Sonnet 5', effort: 'medium', ultracode: false, branch: null,
  ctxPct: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, ...patch,
});

const makeStore = (): SessionStore =>
  createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });

const makeFleet = (patch: Partial<FleetSession> = {}): FleetStore => {
  const store = createFleetStore();
  act(() => { store.setState({ roster: TEST_ROSTER, conn: 'open', sessions: [fleetSession(patch)] }); });
  return store;
};

/** `patch` (routing slice 6, Task 4) seeds the ONE fleet session this screen
 *  renders against — every existing call site passes none, so this stays
 *  `route: null` and every test below it is unaffected. */
const renderScreen = (patch: Partial<FleetSession> = {}): { store: SessionStore; fleet: FleetStore } => {
  const store = makeStore();
  const fleet = makeFleet(patch);
  render(
    <>
      <SessionScreen id={ID} store={store} fleet={fleet} />
      <ToastHost />
    </>,
  );
  act(() => { store.setState({ uuid: 'u1', status: 'idle' }); });
  return { store, fleet };
};

/** Live-frame read-back: replaces the one session in the fleet store. */
const updateLive = (fleet: FleetStore, patch: Partial<FleetSession>): void => {
  act(() => { fleet.setState({ sessions: [fleetSession(patch)] }); });
};

const openEffortSheet = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: /Change effort/ }));
};

const openModelSheet = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: /Change model/ }));
};

describe('session pickers write the routing record', () => {
  it('a tap on High calls api.route once, never api.prompt, and renders queued', async () => {
    renderScreen();
    openEffortSheet();
    fireEvent.click(screen.getByRole('button', { name: /^High/ }));

    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(ID, 'effort', 'high');
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());
  });

  it('a fleet frame with effort:"high" clears the queued badge', async () => {
    const { fleet } = renderScreen();
    openEffortSheet();
    fireEvent.click(screen.getByRole('button', { name: /^High/ }));
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());

    updateLive(fleet, { effort: 'high' });
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
  });

  it('a tap on Opus 5 calls api.route(id, "class", "opus"), and clears on model:"Opus 5"', async () => {
    const { fleet } = renderScreen();
    openModelSheet();
    fireEvent.click(screen.getByRole('button', { name: /Opus 5/ }));

    expect(route).toHaveBeenCalledWith(ID, 'class', 'opus');
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());

    updateLive(fleet, { model: 'Opus 5' });
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
  });

  it('Auto clears on the response — no live frame needed, absence is not readable', async () => {
    renderScreen();
    openEffortSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));

    expect(route).toHaveBeenCalledWith(ID, 'effort', 'auto');
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
  });

  it('a read-back that lands while the write is still in flight leaves no orphan timer (fix round 1, finding 1)', async () => {
    vi.useFakeTimers();
    let resolveRoute: (() => void) | undefined;
    route.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRoute = resolve; }));
    try {
      const { fleet } = renderScreen();
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^High/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('queued')).toBeInTheDocument();

      // The fleet frame (e.g. `route --apply`'s own pane keystroke) reads
      // the value back WHILE the HTTP request is still unresolved.
      updateLive(fleet, { effort: 'high' });
      expect(screen.queryByText('queued')).not.toBeInTheDocument();

      // The write resolves after the read-back already cleared it.
      await act(async () => { resolveRoute?.(); await Promise.resolve(); });

      // The orphaned timer must not fire the false "not confirmed" toast for
      // a write that already confirmed.
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.queryByText('Routing queued; the pane has not confirmed it yet')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second pick before the first resolves cancels the first timer instead of leaking it (fix round 1, finding 1)', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst: (() => void) | undefined;
      route.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
      renderScreen();
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^High/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('queued')).toBeInTheDocument();

      // A second pick lands before the first HTTP request resolves. `Low`,
      // not `Medium` — the live fixture already carries `effort: 'medium'`,
      // which would satisfy the read-back effect immediately and confound
      // this test's own measurement of the timer, not the write.
      route.mockResolvedValueOnce(undefined);
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^Low/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(route).toHaveBeenLastCalledWith(ID, 'effort', 'low');

      // The first write resolves after being superseded.
      await act(async () => { resolveFirst?.(); await Promise.resolve(); });

      // Only ONE timer should be live: the second pick's. Advancing past 60s
      // without a read-back fires exactly one unconfirmed toast, not a stray
      // one from the abandoned first pick clearing the second's badge early.
      await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
      expect(screen.getByText('queued')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(screen.queryByText('queued')).not.toBeInTheDocument();
      expect(screen.getAllByText('Routing queued; the pane has not confirmed it yet')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after 60s with no read-back, queued clears with the unconfirmed toast', async () => {
    vi.useFakeTimers();
    try {
      renderScreen();
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^High/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('queued')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.queryByText('queued')).not.toBeInTheDocument();
      expect(screen.getByText('Routing queued; the pane has not confirmed it yet')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Routing slice 6, Task 4: once `FleetSession.route` rides the wire, the
// pickers' active row and the header's `queued` badge are DERIVED from it —
// no tap, no local timer, no `api.route` call anywhere in this describe
// block. Every test above this one leaves `route: null` (the fixture's own
// default) and is the "route: null, nothing changes" control for these.
describe('the routing record on the wire drives the pickers directly (routing slice 6, Task 4)', () => {
  it('the active row follows the intended record, not the live read-back', () => {
    renderScreen({
      effort: 'medium', // the live pane has not caught up yet
      route: { fields: { effort: 'high' }, degraded: null, inert: [], unreadable: [] },
    });
    openEffortSheet();

    expect(screen.getByRole('button', { name: /^High/ }).className).toContain('opt--selected');
    expect(screen.getByRole('button', { name: /^Medium/ }).className).not.toContain('opt--selected');
    expect(route).not.toHaveBeenCalled();
  });

  it('the queued badge derives from the wire alone — no tap required to show or clear it', () => {
    const { fleet } = renderScreen({
      effort: 'medium',
      route: { fields: { effort: 'high' }, degraded: null, inert: [], unreadable: [] },
    });
    // Mismatch between the intended record and the live read-back: queued,
    // with nobody ever having tapped a row.
    expect(screen.getByText('queued')).toBeInTheDocument();

    // The pane catches up; the SAME route record rides the next frame.
    act(() => {
      fleet.setState({
        sessions: [fleetSession({
          effort: 'high',
          route: { fields: { effort: 'high' }, degraded: null, inert: [], unreadable: [] },
        })],
      });
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
  });

  it('an inert field renders its intended value with a marker, never a badge', () => {
    renderScreen({
      effort: 'medium', // still mismatched — would be "queued" if it weren't inert
      route: { fields: { effort: 'high' }, degraded: null, inert: ['effort'], unreadable: [] },
    });

    // No badge: ccd will never apply this field on the current lane, so
    // there is nothing for a queued badge to wait on.
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openEffortSheet();
    const high = screen.getByRole('button', { name: /^High/ });
    expect(high.className).toContain('opt--selected');
    expect(high.textContent).toContain('inert on this lane');
  });

  // Fix round 1, finding 1: `effort: 'auto'` and `class: 'default'` are
  // ccd's absent-equivalents — `_route_apply_now` types nothing for either,
  // so the pane can never read either back. Both must AGREE unconditionally,
  // never light a permanent badge.
  it('effort:"auto" never lights the badge — ccd types nothing back for it', () => {
    renderScreen({
      effort: 'medium', // the live pane can never read "auto" back, ever
      route: { fields: { effort: 'auto' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openEffortSheet();
    expect(screen.getByRole('button', { name: 'Auto' }).className).toContain('opt--selected');
  });

  it('class:"default" never lights the badge — no model string distinguishes it', () => {
    renderScreen({
      model: 'Sonnet 5', // no model string this row could ever match
      route: { fields: { class: 'default' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openModelSheet();
    expect(screen.getByRole('button', { name: 'Default' }).className).toContain('opt--selected');
  });

  // Fix round 1, finding 1: a routing value naming no row on this wrapper's
  // own option list (a rejected/stale/foreign-build registry value — the
  // registry read behind `route` is deliberately unvalidated) is
  // UNMEASURABLE, not permanently queued: nothing on this pane can ever
  // confirm it, and no picker row highlights it either.
  it('an out-of-vocabulary effort value is unmeasurable, not permanently queued', () => {
    renderScreen({
      effort: 'medium',
      route: { fields: { effort: 'ludicrous' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openEffortSheet();
    for (const name of ['Low', 'Medium', 'High', 'Xhigh', 'Max', 'Ultracode', 'Auto']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }).className).not.toContain('opt--selected');
    }
  });

  it('an out-of-vocabulary class value is unmeasurable, not permanently queued', () => {
    renderScreen({
      model: 'Sonnet 5',
      route: { fields: { class: 'ludicrous' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openModelSheet();
    for (const name of ['Opus 5.5', 'Sonnet 5', 'Fable 5', 'Haiku 4.5', 'Default']) {
      expect(screen.getByRole('button', { name })).not.toHaveClass('opt--selected');
    }
  });

  // Fix round 2, finding 1 (controller ruling S6-R5): a field this pass
  // could not read (`route.unreadable`) is UNKNOWN — not "never routed".
  // It is ALSO absent from `route.fields` (never both), which already skips
  // the queued badge (no `intended` to compare); the row-level behaviour
  // this pair covers is that an unreadable field must not fall back to the
  // loose live-pane match either — that would light a row on a claim the
  // read never established.
  it('an unreadable effort field renders no active row and no badge, even though the live pane would otherwise match one', () => {
    renderScreen({
      effort: 'high', // would highlight "High" under the ordinary live-match fallback
      route: { fields: {}, degraded: null, inert: [], unreadable: ['effort'] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openEffortSheet();
    for (const name of ['Low', 'Medium', 'High', 'Xhigh', 'Max', 'Ultracode', 'Auto']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }).className).not.toContain('opt--selected');
    }
  });

  it('an unreadable class field renders no active row and no badge, even though the live pane would otherwise match one', () => {
    renderScreen({
      model: 'Opus 5', // would highlight "Opus 5" under the ordinary live-match fallback
      route: { fields: {}, degraded: null, inert: [], unreadable: ['class'] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();

    openModelSheet();
    for (const name of ['Opus 5.5', 'Sonnet 5', 'Fable 5', 'Haiku 4.5', 'Default']) {
      expect(screen.getByRole('button', { name })).not.toHaveClass('opt--selected');
    }
  });

  // Whole-branch review M1: `route.degraded` rode the wire with no PWA
  // reader at all — ccd's own record of the class it IS serving because no
  // candidate lane could serve the intended one (spec §5.4's
  // `measured-unservable` arm). The intended class stays the active row (it
  // is still what was asked for, and ccd restores it at the next settle on
  // a lane that can serve it); the served class is said BESIDE it.
  it('the degraded class is named beside the intended one — "serving <class> (share ceiling)"', () => {
    renderScreen({
      model: 'Haiku 4.5', // the pane is serving the degraded class
      route: { fields: { class: 'opus' }, degraded: 'haiku', inert: [], unreadable: [] },
    });
    openModelSheet();

    const opus = screen.getByRole('button', { name: /Opus 5/ });
    expect(opus.className).toContain('opt--selected');
    expect(opus.textContent).toContain('serving Haiku 4.5 (share ceiling)');
    // On the INTENDED row and nowhere else — the Haiku row is not active and
    // says nothing about itself.
    expect(screen.getByRole('button', { name: /Haiku 4\.5$/ }).textContent).not.toContain('share ceiling');
  });

  it('a degraded stamp naming the intended class itself says nothing — "serving Opus 5" beside active Opus 5 is no claim', () => {
    renderScreen({
      model: 'Opus 5',
      route: { fields: { class: 'opus' }, degraded: 'opus', inert: [], unreadable: [] },
    });
    openModelSheet();

    expect(screen.getByRole('button', { name: /Opus 5/ }).className).toContain('opt--selected');
    expect(screen.queryByText(/share ceiling/)).not.toBeInTheDocument();
  });

  it('degraded: null renders no note at all — the control', () => {
    renderScreen({
      model: 'Sonnet 5',
      route: { fields: { class: 'opus' }, degraded: null, inert: [], unreadable: [] },
    });
    openModelSheet();

    expect(screen.getByRole('button', { name: /Opus 5/ }).className).toContain('opt--selected');
    expect(screen.queryByText(/share ceiling/)).not.toBeInTheDocument();
  });

  it('the note rides the CLASS picker only — `.degraded` is a class, so the effort sheet never shows it', () => {
    renderScreen({
      effort: 'medium',
      route: { fields: { effort: 'high' }, degraded: 'haiku', inert: [], unreadable: [] },
    });
    openEffortSheet();

    expect(screen.getByRole('button', { name: /^High/ }).className).toContain('opt--selected');
    expect(screen.queryByText(/share ceiling/)).not.toBeInTheDocument();
  });

  it('a degraded class field that is ALSO inert says both — two facts, two lines', () => {
    renderScreen({
      model: 'Haiku 4.5',
      route: { fields: { class: 'opus' }, degraded: 'haiku', inert: ['class'], unreadable: [] },
    });
    openModelSheet();

    const opus = screen.getByRole('button', { name: /Opus 5/ });
    expect(opus.textContent).toContain('serving Haiku 4.5 (share ceiling)');
    expect(opus.textContent).toContain('inert on this lane');
  });

  it('an unreadable class field lights no row, so it names no degradation either', () => {
    // `route.unreadable` naming `class` means nothing is known about the
    // intended class this pass — there is no intended row to put the note
    // beside, and a note floating alone would read as a claim about a class
    // nobody measured.
    renderScreen({
      model: 'Haiku 4.5',
      route: { fields: {}, degraded: 'haiku', inert: [], unreadable: ['class'] },
    });
    openModelSheet();

    expect(screen.queryByText(/share ceiling/)).not.toBeInTheDocument();
  });

  // Fix round 2, finding 2: once `route` rides the wire, it is the WHOLE
  // STORY for every field on this session — a tap must never ALSO arm the
  // local 60s "not confirmed" toast, which would contradict the very
  // sheet/badge the same tap just updated (or, for a field on `route.inert`,
  // promise a confirmation ccd will never send).
  it("a routed session's tap arms no local toast — the wire is the whole story, not the local queued state", async () => {
    vi.useFakeTimers();
    try {
      renderScreen({
        effort: 'high',
        route: { fields: { effort: 'high' }, degraded: null, inert: [], unreadable: [] },
      });
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^Low/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(route).toHaveBeenCalledWith(ID, 'effort', 'low');
      // No badge from either source: the wire's own record still agrees
      // (`effort: 'high'` === live `effort: 'high'`) until a NEW frame
      // arrives, and the tap armed no local timer to race it.
      expect(screen.queryByText('queued')).not.toBeInTheDocument();

      // 60s pass with no fleet frame at all — the false "not confirmed"
      // toast a local timer would have fired must never appear.
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.queryByText('Routing queued; the pane has not confirmed it yet')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a tap on a field the wire already marks inert also arms no local toast", async () => {
    vi.useFakeTimers();
    try {
      renderScreen({
        effort: 'medium',
        route: { fields: { effort: 'high' }, degraded: null, inert: ['effort'], unreadable: [] },
      });
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^Low/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(route).toHaveBeenCalledWith(ID, 'effort', 'low');
      expect(screen.queryByText('queued')).not.toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.queryByText('Routing queued; the pane has not confirmed it yet')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Whole-branch review #1 fix wave (2026-09-17) — four minors against the
// wire-derived queued badge and the local-timer carve-out.
describe('routing slice 6 whole-branch review fix wave', () => {
  // Item #3: ccd's own `_route_wanted` types the SERVED class into the pane
  // while a degrade stands, never the intended one — so the class arm has
  // to agree on EITHER the intended class's readback or the degraded (served)
  // class's, or the badge can never clear for as long as the degrade lasts.
  it('#3: a degraded session\'s badge clears once the live model matches the SERVED class', () => {
    renderScreen({
      model: 'Opus 5', // serving the degraded class, not the intended fable
      route: { fields: { class: 'fable' }, degraded: 'opus', inert: [], unreadable: [] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
  });

  it('#3 control: the same live Opus model queues once `degraded` is dropped', () => {
    renderScreen({
      model: 'Opus 5',
      route: { fields: { class: 'fable' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.getByText('queued')).toBeInTheDocument();
  });

  // Item #2: `xhigh` and `ultracode` share the same `live.effort: 'xhigh'`
  // wire value — `ultracode` is a separate boolean. An intended `xhigh`
  // must never read a live ultracode pane's `effort: 'xhigh'` as agreement,
  // mirroring `effortOptions`'s own `!ultracode` guard (models.ts:151-153).
  it('#2: intended xhigh never agrees with a live ultracode pane', () => {
    renderScreen({
      effort: 'xhigh', ultracode: true,
      route: { fields: { effort: 'xhigh' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.getByText('queued')).toBeInTheDocument();
  });

  it('#2 control: intended ultracode agrees with the same live ultracode pane', () => {
    renderScreen({
      effort: 'xhigh', ultracode: true,
      route: { fields: { effort: 'ultracode' }, degraded: null, inert: [], unreadable: [] },
    });
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
  });

  // Item #4: `pick()` decides the local-timer carve-out from `routeInfo` at
  // TAP TIME. A tap on a never-routed session (`route: null`) arms the 60s
  // local toast same as always — but nothing used to disarm it once the
  // session's FIRST routing record showed up on a later fleet frame, even
  // though the wire owns the badge from that point on.
  it('#4: the local 60s toast is disarmed once the wire\'s first routing record arrives, before it would fire', async () => {
    vi.useFakeTimers();
    try {
      const { fleet } = renderScreen(); // route: null at tap time
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^High/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('queued')).toBeInTheDocument();

      // The fleet sweep's first-ever routing record for this session lands
      // before 60s — still disagreeing with the live pane, so it is this
      // effect (not the pre-existing local read-back effect) disarming the
      // timer.
      act(() => {
        fleet.setState({
          sessions: [fleetSession({
            effort: 'medium',
            route: { fields: { effort: 'low' }, degraded: null, inert: [], unreadable: [] },
          })],
        });
      });

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.queryByText('Routing queued; the pane has not confirmed it yet')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Item #5: the live `fleet` WS frame is never revived (`stores/fleet.ts`'s
  // `asFleetMsg` casts the raw frame), so an older server's frame can carry
  // `route` non-null with `unreadable` genuinely absent — unlike every test
  // above, which goes through this file's own typed `fleetSession()`
  // fixture and always supplies the array. `routeInfo?.unreadable
  // .includes(...)` alone throws in that case; the fix reads it through one
  // tolerant `routeUnreadable = routeInfo?.unreadable ?? []`.
  it('#5: a live route object missing `unreadable` renders without throwing', () => {
    const rawRoute = { fields: { class: 'opus' }, degraded: null, inert: [] } as unknown as FleetSession['route'];
    expect(() => renderScreen({ model: 'Opus 5', route: rawRoute })).not.toThrow();
    openModelSheet();
    expect(screen.getByRole('button', { name: /Opus 5/ }).className).toContain('opt--selected');
  });
});
