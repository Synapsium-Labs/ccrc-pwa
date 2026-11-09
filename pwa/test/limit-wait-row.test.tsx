// D-8123 (limit-swap-autofix Task 11): the Waiting on you row for a session on a usage limit that no account has room to
// take. It carries its OWN two controls, each one tap and then a confirm sentence: "Swap to…" (the existing SwapSheet,
// narrowed to the accounts with MEASURED room, and updating as limits arrive) and "Wait until reset at HH:MM" (the new
// `api.limitWait`). Neutral names only: the repository is public.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '@ccrc/ui';
import type { AccountUsage, FleetSession } from '../../shared/api';
import { SWAP_REFUSALS } from '../../shared/api';
import { api, ApiError } from '../src/lib/api';
import { LimitWaitRow } from '../src/ledgers/LimitWaitRow';
import { limitRows, type LimitRow } from '../src/ledgers/ledgerWords';
import { useFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';
import { MIN, NOW } from './ledgersFixture';

const usage = (wrapper: string, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five: 20, seven: 30, ts: NOW / 1000, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false,
  sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

/** 15:00 on the page clock's own day, in the zone the test runs in: the row prints it in that same zone. */
const AT_15 = (() => { const d = new Date(NOW); d.setHours(15, 0, 0, 0); return d.getTime(); })();

const stuck = (limitWait: Partial<NonNullable<FleetSession['limitWait']>> = {}): FleetSession => fleetSession({
  id: 'project-a-w1', wrapper: 'claude', home: 'claude', project: 'project-a', title: 'The review worker',
  limitWait: { since: NOW - 12 * MIN, reset: AT_15, account: 'claude', waiting: false, ...limitWait },
});
const rowOf = (s: FleetSession): LimitRow => limitRows([s])[0]!;

const setUsage = (rows: AccountUsage[]): void => { act(() => { useFleetStore.setState({ usage: rows, roster: TEST_ROSTER }); }); };
const nothingHasRoom = (): AccountUsage[] => [
  usage('claude', { seven: 100 }), usage('claude9', { five: 99 }), usage('claude-acme', { seven: 100 }), usage('gpt', { five: null, seven: null }),
];

beforeEach(() => { useFleetStore.setState({ usage: null, roster: TEST_ROSTER, sessions: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); useFleetStore.setState({ usage: null, projected: undefined, roster: [], sessions: [] }); });

const mount = (s: FleetSession): void => {
  render(<><LimitWaitRow limit={rowOf(s)} now={NOW} /><ToastHost /></>);
};
const swapButton = (): HTMLElement => screen.getByRole('button', { name: /swap to|no account has room yet/i });

describe('the row says what is wrong, in the operator\'s words', () => {
  it('names the session and that no account has room, with how long ago it began', () => {
    setUsage(nothingHasRoom());
    mount(stuck());
    const row = screen.getByTestId('limit-wait-row');
    expect(row.textContent).toContain('The review worker is on a usage limit and no account has room');
    expect(row.textContent).toContain('12m ago');
    expect(row.getAttribute('data-session')).toBe('project-a-w1');
  });

  it('draws both controls: one Swap to… and one Wait until reset at HH:MM', () => {
    setUsage(nothingHasRoom());
    mount(stuck());
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['No account has room yet', 'Wait until reset at 15:00']);
  });

  it('a record with no reset says "Wait until the limit resets"', () => {
    mount(stuck({ reset: null }));
    expect(screen.getByRole('button', { name: 'Wait until the limit resets' })).toBeTruthy();
  });
});

describe('Swap to…', () => {
  it('with no account holding measured room it reads "No account has room yet" and is disabled', () => {
    setUsage(nothingHasRoom());
    mount(stuck());
    const b = swapButton() as HTMLButtonElement;
    expect(b.textContent).toBe('No account has room yet');
    expect(b.disabled).toBe(true);
  });

  it('before any accounts answer, nothing is measured, so it is disabled the same way', () => {
    mount(stuck());
    expect((swapButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists ONLY the accounts with measured room, and adds one when a new limits snapshot gives it room', () => {
    setUsage(nothingHasRoom());
    mount(stuck());
    expect((swapButton() as HTMLButtonElement).disabled).toBe(true);

    // team·alt (claude9) gains room: the control wakes and the sheet offers it, and nothing else.
    setUsage([usage('claude', { seven: 100 }), usage('claude9', { five: 40, seven: 50 }), usage('claude-acme', { seven: 100 }),
      usage('gpt', { five: null, seven: null })]);
    const b = swapButton() as HTMLButtonElement;
    expect(b.textContent).toBe('Swap to…');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /team·alt/ })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /team·b/ })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /gpt/ })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /team·max/ })).toBeNull();

    // Another gains room while the sheet is open: it appears without reopening.
    setUsage([usage('claude', { seven: 100 }), usage('claude9', { five: 40, seven: 50 }), usage('claude-acme', { five: 10, seven: 10 }),
      usage('gpt', { five: null, seven: null })]);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /team·b/ })).toBeTruthy();
  });

  it('an unmeasured, a rolled-over, a switched-off and an at-ceiling account are never offered', () => {
    setUsage([
      usage('claude', { seven: 100 }),
      usage('claude9', { five: null, seven: null }),
      usage('claude-acme', { fiveRolledOver: true }),
      usage('gpt', { disabled: true }),
    ]);
    mount(stuck());
    expect((swapButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('the pick needs its confirm before any request, then calls api.swap(id, wrapper) once', async () => {
    setUsage([usage('claude', { seven: 100 }), usage('claude9', { five: 40, seven: 50 })]);
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
    mount(stuck());
    fireEvent.click(swapButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /team·alt/ }));
    expect(swap).not.toHaveBeenCalled();
    expect(await screen.findByText(/Move to team·alt\?/)).toBeTruthy();
    fireEvent.click(document.querySelector('.qc-actions .btn-primary') as HTMLElement);
    await waitFor(() => expect(swap).toHaveBeenCalledTimes(1));
    expect(swap).toHaveBeenCalledWith('project-a-w1', 'claude9');
  });

  it('keeps the existing session-busy second tap: "swap anyway" re-sends with interrupt', async () => {
    setUsage([usage('claude', { seven: 100 }), usage('claude9', { five: 40, seven: 50 })]);
    const swap = vi.spyOn(api, 'swap')
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: SWAP_REFUSALS.sessionBusy }))
      .mockResolvedValue(undefined);
    mount(stuck());
    fireEvent.click(swapButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /team·alt/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }));
    expect(await screen.findByText("It's working — swap anyway?")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Swap anyway' }));
    await waitFor(() => expect(swap).toHaveBeenCalledTimes(2));
    expect(swap.mock.calls[1]).toEqual(['project-a-w1', 'claude9', { interrupt: true }]);
  });
});

describe('Wait until reset', () => {
  it('needs its confirm before any request, then calls api.limitWait(id) once', async () => {
    setUsage(nothingHasRoom());
    const wait = vi.spyOn(api, 'limitWait').mockResolvedValue(undefined);
    mount(stuck());
    fireEvent.click(screen.getByRole('button', { name: 'Wait until reset at 15:00' }));
    expect(wait).not.toHaveBeenCalled();
    // The confirm sentence says what happens, and what does not.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/stays where it is/i);
    expect(dialog.textContent).toContain('15:00');
    fireEvent.click(document.querySelector('.qc-actions .btn-primary') as HTMLElement);
    await waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    expect(wait).toHaveBeenCalledWith('project-a-w1');
  });

  it('cancelling the confirm sends nothing', async () => {
    setUsage(nothingHasRoom());
    const wait = vi.spyOn(api, 'limitWait').mockResolvedValue(undefined);
    mount(stuck());
    fireEvent.click(screen.getByRole('button', { name: 'Wait until reset at 15:00' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(wait).not.toHaveBeenCalled();
  });

  it('a record that closed before the tap (409 not-waiting) is said in words, not as a failure', async () => {
    setUsage(nothingHasRoom());
    vi.spyOn(api, 'limitWait').mockRejectedValue(new ApiError(409, { ok: false, error: 'not-waiting' }));
    mount(stuck());
    fireEvent.click(screen.getByRole('button', { name: 'Wait until reset at 15:00' }));
    await screen.findByRole('dialog');
    fireEvent.click(document.querySelector('.qc-actions .btn-primary') as HTMLElement);
    expect(await screen.findByText(/moved on its own|limit has cleared/i)).toBeTruthy();
  });

  it('waiting: true reads "Waiting until 15:00", has no wait control, and keeps Swap to…', () => {
    setUsage(nothingHasRoom());
    mount(stuck({ waiting: true }));
    const row = screen.getByTestId('limit-wait-row');
    expect(row.textContent).toContain('Waiting until 15:00');
    expect(screen.queryByRole('button', { name: /wait until/i })).toBeNull();
    expect(swapButton()).toBeTruthy();
  });

  it('waiting with no reset says it without a clock', () => {
    mount(stuck({ waiting: true, reset: null }));
    expect(screen.getByTestId('limit-wait-row').textContent).toContain('Waiting until the limit resets');
  });
});

describe('the row sends no keystroke of its own', () => {
  it('its source never reaches the terminal doors', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.join(__dirname, '../src/ledgers/LimitWaitRow.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.(sendKeys|keys|send|sendText|submitEnter|paneKey|ask|answer|inject)\(/);
    expect(src).not.toMatch(/api\.(send|keys|ask|answer|submit)/);
  });
});
