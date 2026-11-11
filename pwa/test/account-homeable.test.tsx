// The "Start new sessions here" switch on the Accounts card (D-8195): whether new sessions may start on a lane (the
// roster's `homeAble`), written through `POST /api/accounts/:id/set {placement}`, the route `ccrc account set
// --placement` answers. It is NOT the kill switch: a different label, its own row under the knob, and a tap asks first
// (`QuickConfirm`) with a sentence that says what changes. It moves only on the server's ack, a refusal is worded from
// its code, and a screen that cannot act draws it disabled.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { stateWordFor } from '../../shared/accounts';
import type { AccountsConnect, AccountUsage, LaneWire, RosterWire } from '../../shared/api';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { HOME_ABLE_LABEL, homeAbleConfirm, homeAbleRow, laneActRefusal } from '../src/fleet/accountWords';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const CONNECT: AccountsConnect = { accountOps: 'available', gate: 'armed', origin: 'https' };

const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in', ...over,
});
const usage = (wrapper: string): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: nowSec - 120, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const wire = (u: AccountUsage): LaneWire => ({
  state: stateWordFor({
    disabled: false, authDead: false, five: u.five, seven: u.seven, fiveResetAt: null, sevenResetAt: null,
    provider: 'anthropic', kind: 'sign-in', lane: { kind: 'read', state: { check: { verdict: 'ok', at: now - 60_000 } } }, now,
  }),
  check: { verdict: 'ok', at: now - 60_000 },
  ready: true,
});

/** lane-a home-able, lane-b overflow only (its label differs from its id). Both on and ready. */
const ROSTER: RosterWire[] = [lane('lane-a'), lane('lane-b', { label: 'Lane B', homeAble: false })];
const USAGE = [usage('lane-a'), usage('lane-b')];
const LANES = { 'lane-a': wire(USAGE[0]!), 'lane-b': wire(USAGE[1]!) };

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(roster: () => RosterWire[], routes: Record<string, (init: RequestInit | undefined) => Promise<Response>>): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === '/api/accounts') {
      return json(200, { accounts: USAGE, projected: { wrapper: 'lane-a', score: 1 }, roster: roster(), lanes: LANES, connect: CONNECT });
    }
    const r = routes[url];
    if (r !== undefined) return r(init);
    return json(404, {});
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const show = (o: { connect?: AccountsConnect | null; roster?: RosterWire[] } = {}): void => {
  act(() => {
    useFleetStore.setState({
      usage: USAGE, projected: { wrapper: 'lane-a', score: 1 }, roster: o.roster ?? ROSTER, lanes: LANES,
      accountsConnect: o.connect === undefined ? CONNECT : o.connect, sessions: [],
    });
  });
  render(<><AccountsScreen /><ToastHost /></>);
};
const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane='${id}']`) as HTMLElement;
const homeSwitch = (id: string): HTMLElement => within(card(id)).getByRole('switch', { name: new RegExp(HOME_ABLE_LABEL, 'i') });
const killSwitch = (id: string): HTMLElement => within(card(id)).getByRole('switch', { name: /lane on or off/i });
const confirmButton = (): HTMLElement => document.querySelector<HTMLElement>('.qc-actions .btn-primary')!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null }));
});

describe('the words (D-8195)', () => {
  it('the row and the confirm say what changes, by the lane\'s label', () => {
    expect(HOME_ABLE_LABEL).toBe('Start new sessions here');
    expect(homeAbleRow(true)).toBe('New sessions can start on it.');
    expect(homeAbleRow(false)).toBe('Overflow only: new sessions start on other accounts.');
    expect(homeAbleConfirm('Lane B', true)).toEqual({
      title: 'Start new sessions on Lane B?', consequence: 'New sessions can start on Lane B.', confirmLabel: 'Start new sessions here',
    });
    expect(homeAbleConfirm('Lane B', false)).toEqual({
      title: 'Stop new sessions on Lane B?', consequence: 'New sessions will not start on Lane B; running sessions stay.',
      confirmLabel: 'Stop new sessions here',
    });
  });

  it('a refusal is worded from its code', () => {
    const e = (body: unknown): unknown => ({ body });
    expect(laneActRefusal('placement', 'lane-a', e({ error: 'last-home-able' })))
      .toBe('lane-a is the only lane new sessions can start on, so it stays. Let another start them first.');
    expect(laneActRefusal('placement', 'lane-a', e({ error: 'lane-busy' }))).toBe('lane-a is busy with another account change. Try again in a moment.');
    expect(laneActRefusal('placement', 'lane-a', new TypeError('Failed to fetch')))
      .toBe("The request didn't complete, so whether lane-a was changed is unknown. The screen reads it again.");
  });
});

describe('the switch on the card (D-8195)', () => {
  it('is its own labelled switch beside the kill switch, drawn as the roster has it', () => {
    stubFetch(() => ROSTER, {});
    show();
    expect(homeSwitch('lane-a')).toHaveAttribute('aria-checked', 'true');
    expect(homeSwitch('lane-b')).toHaveAttribute('aria-checked', 'false');
    expect(homeSwitch('lane-a')).not.toBe(killSwitch('lane-a'));
    expect(within(card('lane-a')).getByText(HOME_ABLE_LABEL)).toBeInTheDocument();
    expect(within(card('lane-a')).getByText(homeAbleRow(true))).toBeInTheDocument();
    expect(within(card('lane-b')).getByText(homeAbleRow(false))).toBeInTheDocument();
    // Under the kill switch's row, never inside it.
    const knob = card('lane-a').querySelector('.acct-knob')!;
    const row = card('lane-a').querySelector('.acct-home')!;
    expect(knob.contains(row)).toBe(false);
    expect(knob.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('one tap asks first; Cancel sends nothing', async () => {
    const f = stubFetch(() => ROSTER, {});
    show();
    fireEvent.click(homeSwitch('lane-b'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New sessions can start on Lane B.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(f.mock.calls.filter(([u]) => String(u).includes('/set'))).toEqual([]);
    expect(homeSwitch('lane-b')).toHaveAttribute('aria-checked', 'false');
  });

  it('confirming sends the placement and the switch moves only on the ack', async () => {
    let roster = ROSTER;
    let ack!: (r: Response) => void;
    const bodies: unknown[] = [];
    const f = stubFetch(() => roster, {
      '/api/accounts/lane-a/set': (init) => { bodies.push(JSON.parse(String(init?.body))); return new Promise<Response>((res) => { ack = res; }); },
    });
    show();
    fireEvent.click(homeSwitch('lane-a'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New sessions will not start on lane-a; running sessions stay.')).toBeInTheDocument();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/accounts/lane-a/set', expect.objectContaining({ method: 'POST' })));
    expect(bodies).toEqual([{ placement: 'overflow' }]);
    // In flight: not moved, busy, and neither switch can be pressed again.
    expect(homeSwitch('lane-a')).toHaveAttribute('aria-checked', 'true');
    expect(homeSwitch('lane-a')).toHaveAttribute('aria-busy', 'true');
    expect(homeSwitch('lane-a')).toBeDisabled();
    expect(killSwitch('lane-a')).toBeDisabled();
    roster = [lane('lane-a', { homeAble: false }), ROSTER[1]!];
    await act(async () => { ack(json(200, { ok: true, roster, lane: LANES['lane-a'] })); });
    await waitFor(() => expect(homeSwitch('lane-a')).toHaveAttribute('aria-checked', 'false'));
    expect(homeSwitch('lane-a')).not.toHaveAttribute('aria-busy');
    expect(within(card('lane-a')).getByText(homeAbleRow(false))).toBeInTheDocument();
    // The kill switch never moved: it is a different act.
    expect(killSwitch('lane-a')).toHaveAttribute('aria-checked', 'true');
  });

  it('turning it on sends full', async () => {
    const bodies: unknown[] = [];
    let roster = ROSTER;
    stubFetch(() => roster, {
      '/api/accounts/lane-b/set': async (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        // The box wrote it: the refreshed answer agrees with the ack.
        roster = [ROSTER[0]!, lane('lane-b', { label: 'Lane B', homeAble: true })];
        return json(200, { ok: true, roster, lane: LANES['lane-b'] });
      },
    });
    show();
    fireEvent.click(homeSwitch('lane-b'));
    await screen.findByRole('dialog');
    fireEvent.click(confirmButton());
    await waitFor(() => expect(bodies).toEqual([{ placement: 'full' }]));
    await waitFor(() => expect(homeSwitch('lane-b')).toHaveAttribute('aria-checked', 'true'));
  });

  it('a refusal never moves it, and the toast says why', async () => {
    stubFetch(() => ROSTER, { '/api/accounts/lane-a/set': async () => json(409, { ok: false, error: 'last-home-able' }) });
    show();
    fireEvent.click(homeSwitch('lane-a'));
    await screen.findByRole('dialog');
    fireEvent.click(confirmButton());
    expect(await screen.findByText('lane-a is the only lane new sessions can start on, so it stays. Let another start them first.')).toBeInTheDocument();
    expect(homeSwitch('lane-a')).toHaveAttribute('aria-checked', 'true');
  });

  it('a screen that cannot act draws it disabled, named by the knob row\'s reason; no connect draws none', () => {
    stubFetch(() => ROSTER, {});
    show({ connect: { accountOps: 'unsupported', gate: 'armed', origin: 'https' } });
    const sw = homeSwitch('lane-a');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-describedby', 'acct-knob-reason-lane-a');
    cleanup();
    show({ connect: null });
    expect(card('lane-a').querySelector('.acct-home')).toBeNull();
  });
});
