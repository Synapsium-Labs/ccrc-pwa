// FleetHostBanner — degraded-mode banner: hidden while the fleet is local or
// the remote host is reachable; when unreachable it names how long and offers
// a Reboot action gated behind a QuickConfirm whose copy names the collateral.
// The copy states the property EVERY fleet host has — a reboot takes the whole
// box down — rather than naming one fleet's co-tenant services, which on any
// other box was a false claim about the reader's machine.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetHealth } from '../../shared/api';
import { api } from '../src/lib/api';
import { FleetHostBanner } from '../src/fleet/FleetHostBanner';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const health = (over: Partial<FleetHealth> = {}): FleetHealth => ({
  mode: 'remote',
  connected: false,
  downSince: Date.now() - 5 * 60_000,
  ...over,
});

describe('FleetHostBanner', () => {
  it('renders nothing while the fleet is local', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ mode: 'local', connected: true, downSince: null }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it('renders nothing while remote and connected', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ connected: true, downSince: null }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it('renders an unreachable banner + Reboot button when remote and disconnected', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health());
    render(<FleetHostBanner />);
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reboot' })).toBeInTheDocument();
  });

  it('warns when the host is UP but the two boxes disagree about the roster', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, roster: 'divergent' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    // No action button: the fix is a deploy or an edit on one of the two
    // boxes, and offering a button that cannot do either is worse than none.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stays silent on an unknown roster answer — an older agent reports no digest', async () => {
    // The distinction that makes `roster` a three-state and not a boolean. A
    // banner that fires whenever nothing was checked is a banner nobody reads
    // by the time something IS wrong.
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, roster: 'unknown' }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/different account rosters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it('an unreachable host outranks a roster warning — nothing can be fixed until it is back', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ roster: 'divergent' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/different account rosters/i)).not.toBeInTheDocument();
  });

  it('Reboot opens a confirm naming the whole-box collateral, and only calls the API on confirm', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health());
    const reboot = vi.spyOn(api, 'rebootFleet').mockResolvedValue(undefined);
    render(<FleetHostBanner />);
    await screen.findByRole('button', { name: 'Reboot' });

    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    expect(
      screen.getByText(/Reboots the whole fleet box — everything else running on it goes down too/),
    ).toBeInTheDocument();
    expect(reboot).not.toHaveBeenCalled();

    // Cancel path does not reboot.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reboot).not.toHaveBeenCalled();

    // Confirm path fires the reboot.
    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reboot the fleet host' }));
    expect(reboot).toHaveBeenCalledTimes(1);
  });
});
