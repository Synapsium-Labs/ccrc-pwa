// Settings › Automation › Roll idle sessions (D-7453; D-8276): Every idle session (the default since the operator's
// ruling of 2026-11-10), Coordinators only (the 2026-10-29 rule, kept as a choice) or Off. The card reads
// `GET /api/coord/roll-idle` and writes `POST`; the api object is spied, so no fetch runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api, type RollIdleView } from '../src/lib/api';
import { ROLL_IDLE_LABELS, ROLL_IDLE_TEXT, RollIdleSection } from '../src/fleet/RollIdleSection';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const view = (targets: RollIdleView['targets']): RollIdleView => ({ ok: true, targets, default: 'all', choices: ['all', 'coordinators', 'off'] });
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe('Roll idle sessions (D-7453; D-8276)', () => {
  it('offers Every idle session, Coordinators only and Off, and shows the server\'s default checked', async () => {
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view('all'));
    render(<RollIdleSection />);
    await settle();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([ROLL_IDLE_LABELS.all, ROLL_IDLE_LABELS.coordinators, ROLL_IDLE_LABELS.off]);
    expect([ROLL_IDLE_LABELS.all, ROLL_IDLE_LABELS.coordinators]).toEqual(['Every idle session', 'Coordinators only']);
    expect(screen.getByRole('radio', { name: ROLL_IDLE_LABELS.all })).toBeChecked();
  });

  it('a row an operator set to coordinators reads as Coordinators only, and choosing every idle session posts all', async () => {
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view('coordinators'));
    const set = vi.spyOn(api, 'setRollIdle').mockResolvedValue(view('all'));
    render(<RollIdleSection />);
    await settle();
    expect(screen.getByRole('radio', { name: ROLL_IDLE_LABELS.coordinators })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: ROLL_IDLE_LABELS.all }));
    await settle();
    expect(set).toHaveBeenCalledWith('all');
    expect(screen.getByRole('radio', { name: ROLL_IDLE_LABELS.all })).toBeChecked();
  });

  it('choosing Off posts it and shows what the server stored', async () => {
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view('all'));
    const set = vi.spyOn(api, 'setRollIdle').mockResolvedValue(view('off'));
    render(<RollIdleSection />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: ROLL_IDLE_LABELS.off }));
    await settle();
    expect(set).toHaveBeenCalledWith('off');
    expect(screen.getByRole('radio', { name: ROLL_IDLE_LABELS.off })).toBeChecked();
  });

  it('a row the server could not read says nothing is rolled, with nothing checked', async () => {
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view(null));
    render(<RollIdleSection />);
    await settle();
    expect(screen.getByText(ROLL_IDLE_TEXT.unreadable)).toBeInTheDocument();
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it('an older server without the door says so and offers no choice', async () => {
    vi.spyOn(api, 'rollIdle').mockRejectedValue(new Error('404'));
    render(<RollIdleSection />);
    await settle();
    expect(screen.getByText(ROLL_IDLE_TEXT.unavailable)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });

  it('says who is never rolled in the operator\'s words, never a registry path', async () => {
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view('all'));
    const { container } = render(<RollIdleSection />);
    await settle();
    const text = container.textContent ?? '';
    expect(text).toContain('A session you have opted out by hand (a no-roll marker on the fleet box) is never rolled.');
    expect(text).not.toMatch(/\$REG|<id>|\.no-roll/);
  });
});
