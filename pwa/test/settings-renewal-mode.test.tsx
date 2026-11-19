// Settings › Automation › When soft renewals happen (Overlord W1a hand-offs): `when-away` (the default) or `on-schedule`,
// each with its note. The card reads `GET /api/coord/renewal-mode` and writes `POST`; the api object is spied.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenewalModeView } from '../../shared/continuity';
import { api } from '../src/lib/api';
import { RenewalModeSection } from '../src/fleet/RenewalModeSection';
import { COLLECT_SECTION_TEXT } from '../src/fleet/collectLaneWords';
import { RENEWAL_MODE_TEXT as T, SETTINGS_CARDS, UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const view = (mode: RenewalModeView['mode']): RenewalModeView & { ok: true } =>
  ({ ok: true, mode, default: 'when-away', choices: ['when-away', 'on-schedule'] });
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe('When soft renewals happen', () => {
  it('offers both choices with their words and notes under its heading, the server\'s choice checked', async () => {
    vi.spyOn(api, 'renewalMode').mockResolvedValue(view('when-away'));
    render(<RenewalModeSection />);
    await settle();
    expect(SETTINGS_CARDS.automation.renewalMode.title).toBe('When soft renewals happen');
    expect(screen.getByRole('heading', { level: 3, name: 'When soft renewals happen' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(["When I'm away", 'On schedule']);
    expect(screen.getByRole('radio', { name: "When I'm away" })).toBeChecked();
    expect(screen.getByText('A long-lived session renews at a break in your activity.')).toBeInTheDocument();
    expect(screen.getByText('A long-lived session renews when due, waiting at most 30 minutes for a break.')).toBeInTheDocument();
    expect(screen.getByText(T.purpose)).toBeInTheDocument();
  });

  it('choosing On schedule posts it and shows what the server stored', async () => {
    vi.spyOn(api, 'renewalMode').mockResolvedValue(view('when-away'));
    const set = vi.spyOn(api, 'setRenewalMode').mockResolvedValue(view('on-schedule'));
    render(<RenewalModeSection />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'On schedule' }));
    await settle();
    expect(set).toHaveBeenCalledWith('on-schedule');
    expect(screen.getByRole('radio', { name: 'On schedule' })).toBeChecked();
  });

  it('an answer that could not be read says so, and does not claim the choice', async () => {
    vi.spyOn(api, 'renewalMode').mockResolvedValue(view('when-away'));
    vi.spyOn(api, 'setRenewalMode').mockResolvedValue('unreadable');
    render(<RenewalModeSection />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'On schedule' }));
    await settle();
    expect(screen.getByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: "When I'm away" })).toBeChecked();
  });

  it('a stored word that did not read says so, with nothing checked', async () => {
    vi.spyOn(api, 'renewalMode').mockResolvedValue(view(null));
    render(<RenewalModeSection />);
    await settle();
    expect(screen.getByText(T.unread)).toBeInTheDocument();
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it('answers that carry no field read as absent, with no throw', async () => {
    vi.spyOn(api, 'renewalMode').mockResolvedValue({} as never);
    render(<RenewalModeSection />);
    await settle();
    expect(screen.getByText(T.unread)).toBeInTheDocument();
  });

  it('an older server without the door says so and offers no choice', async () => {
    vi.spyOn(api, 'renewalMode').mockRejectedValue(new Error('404'));
    render(<RenewalModeSection />);
    await settle();
    expect(screen.getByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });
});
