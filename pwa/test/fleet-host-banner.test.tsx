// FleetHostBanner — degraded-mode banner: hidden while the fleet is local or
// the remote host is reachable; when unreachable it names how long and offers
// a Reboot action gated behind a QuickConfirm whose copy names the collateral
// (the fleet box also runs the rp-llm services).
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

  it('Reboot opens a confirm naming the rp-llm collateral, and only calls the API on confirm', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health());
    const reboot = vi.spyOn(api, 'rebootFleet').mockResolvedValue(undefined);
    render(<FleetHostBanner />);
    await screen.findByRole('button', { name: 'Reboot' });

    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    expect(
      screen.getByText(/Reboots the whole fleet box \(also restarts the rp-llm services on it\)/),
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
