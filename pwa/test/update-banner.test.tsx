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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { buttonVariants } from '@ccrc/ui';
import { useFleetStore } from '../src/stores/fleet';
import { UPDATES_POLL_MS, UPDATES_STALE_TEXT } from '../src/fleet/useUpdatesView';
import { UpdateBanner } from '../src/fleet/UpdateBanner';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
// primitives.css retired in wave 2; the sheet's own styling is the primitive's
// cva in @ccrc/ui. What this file needs from it is the panel rule, which now
// lives as utilities on the component.
const buttonSrc = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'primitives', 'button.tsx'), 'utf8');
const themeCss = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'theme.css'), 'utf8');
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

// The one silent case only a component can show: no answer at all (the render gates on `view !== null`).
describe('UpdateBanner — when it stays silent', () => {
  it('is silent with no answer at all (updates={null})', () => {
    const { container } = render(<UpdateBanner updates={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UpdateBanner — its two buttons', () => {
  it("Update all is ENABLED and opens the move sheet: the banner's tag, the nodes in dispatch order, sent as apply {all: true, tag} (spec §13 \"W4 adds\")", async () => {
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [FLEET_ID, SERVER_ID], skipped: [] });
    const onMoved = vi.fn();
    render(<UpdateBanner updates={view({ nodes: [serverNode(), fleetNode()] })} onMoved={onMoved} />);
    const all = screen.getByRole('button', { name: 'Update all' });
    expect(all).not.toBeDisabled();
    expect(all).not.toHaveAttribute('aria-describedby');
    fireEvent.click(all);
    const list = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1. fleet (fleet) v0.0.7 → v0.0.9',
      '2. server (server) v0.0.7 → v0.0.9',
    ]);
    expect(apply).not.toHaveBeenCalled();   // opening is not confirming
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.9' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls).toEqual([[{ all: true, tag: 'v0.0.9' }]]);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Nodes this moves, in order' })).toBeNull());
  });

  it('self-polling, a confirmed Update all re-polls /api/updates itself', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view());
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [FLEET_ID, SERVER_ID], skipped: [] });
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update v0.0.9' }));
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
  });

  // D-5549: it used to navigate to /settings, whose release list sits far
  // below the fold, so the tap read as doing nothing. It opens the What's-new
  // sheet in place (whats-new-sheet.test.tsx holds what the sheet says).
  it("See what's new opens the What's new sheet in place, never leaving the screen", () => {
    render(<UpdateBanner updates={view()} />);
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    expect(location.pathname).toBe('/');
    expect(screen.getByRole('dialog')).toHaveTextContent("What's new since v0.0.7");
  });
});

describe('UpdateBanner — the FleetHostBanner idiom: injected, or self-polling', () => {
  it('never polls when the view is injected — FleetChromeProvider polls once for the whole shell (D-5468)', () => {
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
    // The tap floor moved from a `min-height` declaration to the `min-h-tap`
    // utility on Button's cva base, so BOTH variants inherit it from one place
    // instead of repeating it. The chain is pinned end to end — the class on
    // the component, and the mapping that gives it the token — so breaking
    // either link still reds this.
    expect(buttonSrc, 'the shared button no longer carries the tap floor')
      .toContain('min-h-tap');
    expect(themeCss, '--spacing-tap no longer maps to --tap-min')
      .toContain('--spacing-tap:  var(--tap-min)');
    // Both action buttons sized to their label through a fleet.css rule. That
    // rule is gone: it was Button's `fit` written out, in one of six sheets
    // that each wrote it out. Asserted on the cva, and on the rule's absence.
    const fit = buttonVariants({ size: 'fit' });
    expect(fit).toContain('w-auto');
    expect(fit).toContain('min-h-tap');
    expect(fit).not.toMatch(/\bh-\d|max-h-/);
    for (const sel of ['.update-banner-actions .btn-primary', '.update-banner-actions .btn-ghost']) {
      expect(() => ruleIn(fleetCss, sel), sel).toThrow();
    }
  });

  it('puts wire text into the DOM only as text children', () => {
    expect(bannerSrc).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

// Programme wave 14, R15(b): on a halted fleet, Update all is disabled and says why and where the remedy is, so a
// tap can no longer come back as a 202 the operator cannot act on (the 2026-10-05 12:18:59 and 12:19:15 taps).
describe('UpdateBanner — Update all while a node halts the fleet (R15(b))', () => {
  const halted = (): NodeWire => fleetNode({ update: { state: 'failed', target: 'v0.0.9', startedAt: NOW - 60_000, detail: 'gate: unit not up' } });

  it('is disabled, described by a line that names the halting node and the Ack, and opens no sheet', () => {
    const apply = vi.spyOn(api, 'applyUpdate');
    render(<UpdateBanner updates={view({ nodes: [halted(), serverNode()] })} />);
    const all = screen.getByRole('button', { name: 'Update all' });
    expect(all).toBeDisabled();
    const reasonId = all.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    const reason = document.getElementById(reasonId!);
    expect(reason?.textContent).toBe('Update all waits: nothing moves until fleet is acknowledged — tap Ack on it in the halt banner.');
    expect(reason?.className, 'an existing class: no new rule for the contrast audit').toBe('update-banner-msg');
    expect(all).toHaveAccessibleDescription(reason!.textContent!);
    fireEvent.click(all);
    expect(screen.queryByRole('list', { name: 'Nodes this moves, in order' })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    // The release line still speaks; only the move waits.
    expect(screen.getByText(/^v0\.0\.9 is out on stable/)).toBeInTheDocument();
  });

  it('a reverted server row halts it too, and a failed provenance verdict does not', () => {
    render(<UpdateBanner updates={view({ nodes: [fleetNode(), serverNode({ update: { state: 'reverted', target: 'v0.0.9', startedAt: null, detail: null } })] })} />);
    expect(screen.getByRole('button', { name: 'Update all' })).toBeDisabled();
    expect(screen.getByText(/^Update all waits: nothing moves until server is acknowledged/)).toBeInTheDocument();
    cleanup();
    render(<UpdateBanner updates={view({ nodes: [fleetNode({ update: { state: 'failed', target: 'v0.0.9', startedAt: null, detail: 'provenance: unsigned bundle' } }), serverNode()] })} />);
    const all = screen.getByRole('button', { name: 'Update all' });
    expect(all).not.toBeDisabled();
    expect(all).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/^Update all waits/)).toBeNull();
  });

  it('wave 19, R24(b): a stale view says so beside the release line, injected or self-polled; Update all is unchanged', async () => {
    render(<UpdateBanner updates={view()} stale />);
    expect([...banner()!.querySelectorAll('.update-banner-msg')].map((e) => e.textContent)).toEqual([
      'v0.0.9 is out on stable — fleet and server are on v0.0.7.', UPDATES_STALE_TEXT,
    ]);
    expect(screen.getByText(UPDATES_STALE_TEXT), 'shown, not announced (D-5124)').toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Update all' }), 'staleness is said, never a gate').not.toBeDisabled();
    cleanup();
    render(<UpdateBanner updates={view()} />);
    expect(screen.queryByText(UPDATES_STALE_TEXT)).toBeNull();
    cleanup();
    vi.useFakeTimers();
    try {
      vi.spyOn(api, 'updates').mockResolvedValueOnce(view()).mockRejectedValueOnce(new Error('offline'));
      render(<UpdateBanner />);
      await act(async () => {});
      expect(screen.queryByText(UPDATES_STALE_TEXT), 'the first read landed').toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS); });
      await act(async () => {});
      expect(screen.getByText(UPDATES_STALE_TEXT)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables again on the poll after the ack, with no reason line', () => {
    const { rerender } = render(<UpdateBanner updates={view({ nodes: [halted(), serverNode()] })} />);
    expect(screen.getByRole('button', { name: 'Update all' })).toBeDisabled();
    rerender(<UpdateBanner updates={view({ nodes: [fleetNode({ update: { state: 'idle', target: 'v0.0.9', startedAt: null, detail: 'acknowledged by the operator' } }), serverNode()] })} />);
    expect(screen.getByRole('button', { name: 'Update all' })).not.toBeDisabled();
    expect(screen.queryByText(/^Update all waits/)).toBeNull();
  });
});
