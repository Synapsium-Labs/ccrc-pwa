// Settings › Automation › Auto memory for plain sessions (Overlord W1a launch profiles PR B; spec §3.3.7 H14, Table 11.1d): Off
// (the default on a fleet host) or On, each with its note. The card reads `GET /api/coord/plain-auto-memory` and writes `POST`;
// the api object is spied, so no fetch runs. It sits under Roll idle sessions on the Automation screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PLAIN_AUTO_MEMORY_TEXT as T, type PlainAutoMemoryView } from '../../shared/plainAutoMemory';
import { api } from '../src/lib/api';
import { PlainAutoMemorySection } from '../src/fleet/PlainAutoMemorySection';
import { COLLECT_SECTION_TEXT } from '../src/fleet/collectLaneWords';
import { SETTINGS_CARDS, UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const view = (choice: PlainAutoMemoryView['choice']): PlainAutoMemoryView & { ok: true } => ({ ok: true, choice, default: 'off', choices: ['off', 'on'] });
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe('Auto memory for plain sessions (Overlord W1a launch profiles PR B, Task 6)', () => {
  it('offers Off and On, each with its note, under its own heading, and shows the server\'s choice checked', async () => {
    vi.spyOn(api, 'plainAutoMemory').mockResolvedValue(view('off'));
    render(<PlainAutoMemorySection />);
    await settle();
    expect(screen.getByRole('heading', { level: 3, name: SETTINGS_CARDS.automation.plainMemory.title })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([T.choices.off, T.choices.on]);
    expect(screen.getByRole('radio', { name: T.choices.off })).toBeChecked();
    expect(screen.getByText(T.notes.off)).toBeInTheDocument();
    expect(screen.getByText(T.notes.on)).toBeInTheDocument();
    expect(screen.getByText(T.shadow)).toBeInTheDocument();
  });

  it('choosing On posts it and shows what the server stored', async () => {
    vi.spyOn(api, 'plainAutoMemory').mockResolvedValue(view('off'));
    const set = vi.spyOn(api, 'setPlainAutoMemory').mockResolvedValue(view('on'));
    render(<PlainAutoMemorySection />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: T.choices.on }));
    await settle();
    expect(set).toHaveBeenCalledWith('on');
    expect(screen.getByRole('radio', { name: T.choices.on })).toBeChecked();
  });

  it('an answer that could not be read says so, and does not claim the choice', async () => {
    vi.spyOn(api, 'plainAutoMemory').mockResolvedValue(view('off'));
    vi.spyOn(api, 'setPlainAutoMemory').mockResolvedValue('unreadable');
    render(<PlainAutoMemorySection />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: T.choices.on }));
    await settle();
    expect(screen.getByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: T.choices.off })).toBeChecked();
  });

  it('a row the server could not read says plain sessions are left as they are, with nothing checked', async () => {
    vi.spyOn(api, 'plainAutoMemory').mockResolvedValue(view(null));
    render(<PlainAutoMemorySection />);
    await settle();
    expect(screen.getByText(T.unread)).toBeInTheDocument();
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it('an older server without the door says so and offers no choice', async () => {
    vi.spyOn(api, 'plainAutoMemory').mockRejectedValue(new Error('404'));
    render(<PlainAutoMemorySection />);
    await settle();
    expect(screen.getByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });
});
