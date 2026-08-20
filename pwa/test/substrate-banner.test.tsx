// One fault, one banner (spec §4, Task 9). When EVERY running row reports a
// substrate fault inside one snapshot, that is one event, not seventeen — the
// banner states it once, names the remedy, and the per-row chips keep the
// partial case. DERIVED from the rows the fleet frame already carries (the
// CoordBanner store-injection harness below), never its own wire fact — the
// deliberate contrast with FleetHostBanner's health poll. TDD red-first: this
// file is written BEFORE SubstrateBanner.tsx exists and run once to confirm it
// fails for the right reason (missing module), then again once the
// implementation lands.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SubstrateBanner } from '../src/fleet/SubstrateBanner';
import { FleetScreen } from '../src/screens/FleetScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => cleanup());

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless
 *  and never actually invoked by these tests, which drive the store directly
 *  via `setState`; the coord-banner.test.tsx idiom verbatim. */
const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

/** RUNNING by default — the banner's population is `lifecycle === 'running'`,
 *  so the base row is a member and each test opts rows out explicitly. */
const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo', workdir: '/w',
  workspace: 'quiet-basin', name: null, status: 'busy', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'working', bucketSince: null, unmeasured: [],
  lifecycle: 'running', stoppedBy: null, swapBlocked: null, substrate: null, started: true,
  spawnState: null, ...over,
});

const FAULT = { at: 1755620112000, text: 'protocol version mismatch' } as const;

describe('the substrate banner — one fault, one banner (spec §4)', () => {
  it('states the fault ONCE when every running row reports it, naming the most-common reason and the remedy — and offers no button', () => {
    const store = makeStore();
    act(() => {
      store.setState({ sessions: [
        s({ id: 'a', substrate: FAULT }),
        s({ id: 'b', substrate: { at: 1755620113000, text: 'protocol version mismatch' } }),
        s({ id: 'c', substrate: { at: 0, text: 'no server running on /tmp/x' } }),
      ] });
    });
    render(<SubstrateBanner store={store} />);

    // One event, not three: a single banner, counting the rows that report it.
    expect(document.querySelectorAll('.substrate-banner')).toHaveLength(1);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('tmux unreachable on the fleet host — 3 sessions report it');
    expect(banner).toHaveTextContent('sessions are still running unattached');
    expect(banner).toHaveTextContent('Remedy: restart tmux or reboot.');

    // The most-common fault text, shown once; the minority reason stays on its
    // row's own chip, never a second sentence here.
    expect(screen.getByText('protocol version mismatch')).toBeInTheDocument();
    expect(screen.queryByText('no server running on /tmp/x')).toBeNull();

    // No button: recovery is a human at a terminal (spec §1's no-escalation
    // rule) — the one banner action the PWA could offer (reboot) lives on
    // FleetHostBanner's own, different fault.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders NOTHING while even one running row is unfaulted — the partial case belongs to the chips', () => {
    const store = makeStore();
    act(() => {
      store.setState({ sessions: [
        s({ id: 'a', substrate: FAULT }),
        s({ id: 'b', substrate: FAULT }),
        s({ id: 'c', substrate: null }),   // one supervisor still reaches tmux
      ] });
    });
    const { container } = render(<SubstrateBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING with zero running rows — a faulted marker on a stopped row is not a fleet-wide event', () => {
    const store = makeStore();
    act(() => {
      // A stopped row can still carry a marker (its supervisor died mid-fault);
      // with no running population the all-of-them derivation has no subject.
      store.setState({ sessions: [s({ id: 'a', lifecycle: 'stopped', substrate: FAULT })] });
    });
    const { container } = render(<SubstrateBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
    // The degenerate fleet, too.
    act(() => { store.setState({ sessions: [] }); });
    expect(container).toBeEmptyDOMElement();
  });

  // The live `fleet` frame is cast, not revived (`stores/fleet.ts`'s
  // `asFleetMsg`), so a row from an older server can lack the `substrate` or
  // `lifecycle` KEY entirely at runtime — `s()` always sets both, so this is
  // simulated via `delete`, the session-line.test.tsx idiom. Also the test
  // that pins the read going through `substrateFault` (shared/api.ts), never
  // `session.substrate` directly.
  it('does not throw on rows lacking the substrate or lifecycle key — cast, not revived', () => {
    const noSubstrate = s({ id: 'a', substrate: FAULT }) as unknown as Record<string, unknown>;
    delete noSubstrate['substrate'];
    const noLifecycle = s({ id: 'b', substrate: FAULT }) as unknown as Record<string, unknown>;
    delete noLifecycle['lifecycle'];
    const store = makeStore();
    act(() => {
      store.setState({ sessions: [noSubstrate, noLifecycle] as unknown as FleetSession[] });
    });
    expect(() => render(<SubstrateBanner store={store} />)).not.toThrow();
    // The keyless-substrate row reads as unfaulted — the partial case, no banner.
    expect(document.querySelector('.substrate-banner')).toBeNull();
  });

  it('mounts on the fleet screen, beside the host banner — driven by the SAME injected store', () => {
    const store = makeStore();
    act(() => {
      store.setState({ conn: 'open', sessions: [s({ id: 'a', substrate: FAULT })] });
    });
    render(<FleetScreen store={store} />);
    expect(document.querySelector('.substrate-banner')).not.toBeNull();
  });
});
