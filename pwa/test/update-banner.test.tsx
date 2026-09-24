// UpdateBanner (centralised-update design 2026-09-20 §13; programme wave 3) —
// the fleet screen's "a release is out" line. The spec's four pins (renders on
// newer, not on equal, not on lastOkAt: null, not on an unmeasured node), the
// arrow predicate's other half (channel: null), semver order across the
// v0.0.9/v0.0.10 boundary, the disabled Update all, the door to /settings, and
// the FleetHostBanner idiom's injected/self-polling split.
//
// Found by CLASS and TEXT, never by a bare getByRole('status'): FleetHostBanner,
// BuildLine, SubstrateBanner and the mark-seen note are status regions too,
// and a screen showing two of them makes that query ambiguous.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { api, MOVE_DISABLED_TEXT } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { UPDATES_POLL_MS } from '../src/fleet/useUpdatesView';
import { bannerRelease, UpdateBanner, updateBannerText } from '../src/fleet/UpdateBanner';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
const primitivesCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'components', 'primitives.css'), 'utf8');
const bannerSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'UpdateBanner.tsx'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const NOW = Date.now();
const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';

/** A stamp; `version` omitted = an unversioned (deploy.sh) build. */
const stamp = (version?: string): BuildInfo => ({
  sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});

/** A measured, reachable, stable-channel fleet node on v0.0.7 whose desired is
 *  v0.0.9 — every case edits the one field it is about. */
const fleetNode = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.7'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: 'v0.0.7', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
/** The server's own row: no agent by construction (`agentOps: null`). */
const serverNode = (over: Partial<NodeWire> = {}): NodeWire =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });

const view = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: NOW - 4 * 60_000, lastError: null },
  releases: [],
  nodes: [fleetNode(), serverNode()],
  intent: [],
  ...over,
});

const banner = (): Element | null => document.querySelector('.update-banner');

describe('UpdateBanner — when it speaks', () => {
  it('renders on a newer release: the tag, the channel, and what the fleet runs', () => {
    render(<UpdateBanner updates={view()} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
    expect(banner()).not.toBeNull();
    expect(banner()!.getAttribute('role')).toBe('status');
  });

  it('names each side when the two boxes disagree — the per-node form', () => {
    render(<UpdateBanner updates={view({
      nodes: [fleetNode(), serverNode({ current: stamp('v0.0.9'), highestVersion: 'v0.0.9' })],
    })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet v0.0.7 · server v0.0.9.')).toBeInTheDocument();
  });

  it('counts an unversioned node as behind, and the summary says unversioned', () => {
    render(<UpdateBanner updates={view({
      nodes: [fleetNode({ current: stamp() }), serverNode({ current: stamp('v0.0.9') })],
    })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet unversioned · server v0.0.9.')).toBeInTheDocument();
  });

  it('reports a never-measured row as a MISSING side, not as an unversioned one', () => {
    // The server is measured and behind, so the banner speaks; the fleet row is
    // a placeholder nobody has measured. "unversioned" would state a
    // measurement nobody made — the summary says the side is missing instead.
    render(<UpdateBanner updates={view({
      nodes: [fleetNode({ measuredAt: null, current: null, stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown', caps: [], os: 'unknown', highestVersion: null, floorRead: 'unmeasured', previousRead: 'unmeasured', reachable: false, unreachableSince: NOW - 60_000 }), serverNode()],
    })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet — · server v0.0.7.')).toBeInTheDocument();
  });

  it('renders in local mode: the one node that is both reads as both sides', () => {
    render(<UpdateBanner updates={view({ nodes: [serverNode({ role: 'both' })] })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
  });

  it("picks the NEWEST pending tag in semver order — v0.0.10 over v0.0.9 — with that node's channel", () => {
    // String order puts 'v0.0.9' above 'v0.0.10'; both node orders are checked,
    // so neither first-wins nor last-wins can pass by accident.
    render(<UpdateBanner updates={view({
      nodes: [fleetNode({ desiredTag: 'v0.0.9' }), serverNode({ channel: 'dev', desiredTag: 'v0.0.10' })],
    })} />);
    expect(screen.getByText('v0.0.10 is out on dev — fleet and server are on v0.0.7.')).toBeInTheDocument();
    expect(bannerRelease(view({
      nodes: [serverNode({ channel: 'dev', desiredTag: 'v0.0.10' }), fleetNode({ desiredTag: 'v0.0.9' })],
    }))).toEqual({ tag: 'v0.0.10', channel: 'dev' });
  });
});

describe('UpdateBanner — when it stays silent (unreachable is not current, spec §7 and §18)', () => {
  it('is silent when every node runs its desired tag, and when a desired is OLDER than what runs', () => {
    const equal = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.9' }),
        serverNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.9' }),
      ],
    })} />);
    expect(equal.container).toBeEmptyDOMElement();
    expect(updateBannerText(view({
      nodes: [fleetNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.7' })],
    }))).toBeNull();
  });

  it('is silent while the catalogue has never been reached since the server started (lastOkAt: null)', () => {
    const { container } = render(<UpdateBanner updates={view({
      catalogue: { lastOkAt: null, lastError: { at: NOW - 30_000, reason: 'rate-limited' } },
    })} />);
    expect(container).toBeEmptyDOMElement();
    expect(updateBannerText(view({ catalogue: { lastOkAt: null, lastError: null } }))).toBeNull();
  });

  it('is silent when the only node behind has never been measured (measuredAt: null)', () => {
    // measuredAt is the ONLY field between this fleet row and an arrow: its
    // stamp was read (stampRead 'ok'), it runs v0.0.7 and desires v0.0.9 on
    // stable. A placeholder-shaped row (current null, stampRead 'unreadable') would
    // also be silenced by pendingTag's read-stamp guard, and would keep this
    // case green over a predicate that lost its measuredAt clause (Step 8, 7).
    const { container } = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ measuredAt: null }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent when the only node behind is a macOS node — not centrally managed, so it has no arrow', () => {
    // D-3309: pendingTag answers null for os 'darwin', so
    // this banner, BuildLine and the /settings row (which reads the macOS
    // sentence in place of a desired) say the same thing about the same node.
    const { container } = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ os: 'darwin' }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent when the only node behind has a channel this build cannot name (channel: null)', () => {
    const { container } = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ channel: null, resolveDetail: 'the stored channel is not one this build can read' }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent with no answer at all (updates={null})', () => {
    const { container } = render(<UpdateBanner updates={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UpdateBanner — its two buttons', () => {
  it('renders Update all DISABLED, described by the one W3 sentence (spec §18 "the move controls are disabled in W3")', () => {
    render(<UpdateBanner updates={view()} />);
    const all = screen.getByRole('button', { name: 'Update all' });
    expect(all).toBeDisabled();
    expect(all).toHaveAccessibleDescription(MOVE_DISABLED_TEXT);
    expect(screen.getByText(MOVE_DISABLED_TEXT)).toBeInTheDocument();
  });

  it("See what's new lands on /settings", () => {
    render(<UpdateBanner updates={view()} />);
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    expect(location.pathname).toBe('/settings');
  });
});

describe('UpdateBanner — the FleetHostBanner idiom: injected, or self-polling', () => {
  it('never polls when the view is injected — FleetScreen polls once for the whole screen', () => {
    const updates = vi.spyOn(api, 'updates');
    render(<UpdateBanner updates={view()} />);
    render(<UpdateBanner updates={null} />);
    expect(updates).not.toHaveBeenCalled();
  });

  it('self-polls /api/updates when nothing is injected', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view());
    render(<UpdateBanner />);
    expect(await screen.findByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
  });

  it('keeps the banner when a poll fails after a newer-release poll — a failure never clears the last good view', async () => {
    vi.useFakeTimers();
    try {
      const updates = vi.spyOn(api, 'updates')
        .mockResolvedValueOnce(view())
        .mockRejectedValueOnce(new Error('offline'));
      render(<UpdateBanner />);
      await act(async () => {});
      expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS); });
      await act(async () => {});
      expect(updates).toHaveBeenCalledTimes(2);
      expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('UpdateBanner — a class of its own, a tap floor, and text only', () => {
  it('is self-grounded under its own class, never the fleet-host warn modifier', () => {
    render(<UpdateBanner updates={view()} />);
    expect(banner()!.className).toBe('update-banner');
    const rule = ruleIn(fleetCss, '.update-banner');
    expect(declValue(rule, 'background')).toBe('var(--accent-tint)');
    expect(declValue(rule, 'color')).toBe('var(--ink-primary)');
  });

  it('keeps the shared buttons at the tap floor: the banner override resizes their width, never their height', () => {
    expect(declValue(ruleIn(primitivesCss, '.btn-primary'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(primitivesCss, '.btn-ghost'), 'min-height')).toBe('var(--tap-min)');
    for (const sel of ['.update-banner-actions .btn-primary', '.update-banner-actions .btn-ghost']) {
      const rule = ruleIn(fleetCss, sel);
      expect(declValue(rule, 'width'), sel).toBe('auto');
      expect(declValue(rule, 'min-height'), sel).toBeNull();
      expect(declValue(rule, 'height'), sel).toBeNull();
    }
  });

  it('puts wire text into the DOM only as text children', () => {
    expect(bannerSrc).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
