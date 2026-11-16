// The organization label on the Accounts card (plan 2026-11-16-account-organization.md Task B1, #2909): the operator's
// name for an account's Claude organization, never the organization's id (`org-is-an-operator-label`,
// `org-label-refuses-id-shapes`). The card reads "Organization: org-a" or "Organization: not set"; Set opens a sheet
// that writes it through `POST /api/accounts/:id/set {org}` (PR A's facts door), or clears it with `none`. The line
// moves only on the server's ack, and a refusal is worded from its code: `org-looks-like-an-id` has words of its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { stateWordFor } from '../../shared/accounts';
import type { AccountsConnect, AccountUsage, LaneWire, RosterWire } from '../../shared/api';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { laneActRefusal } from '../src/fleet/accountWords';
import { ORG_CLEAR, ORG_HINT, ORG_SAVE, ORG_SET, orgRow, orgSaveRefusal } from '../src/fleet/accountOrgWords';
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

/** lane-a labelled `org-a`, lane-b unlabelled (its label differs from its id). Both on and ready. */
const ROSTER: RosterWire[] = [lane('lane-a', { org: 'org-a' }), lane('lane-b', { label: 'Lane B' })];
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

const show = (o: { connect?: AccountsConnect | null } = {}): void => {
  act(() => {
    useFleetStore.setState({
      usage: USAGE, projected: { wrapper: 'lane-a', score: 1 }, roster: ROSTER, lanes: LANES,
      accountsConnect: o.connect === undefined ? CONNECT : o.connect, sessions: [],
    });
  });
  render(<><AccountsScreen /><ToastHost /></>);
};
const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane='${id}']`) as HTMLElement;
const line = (id: string): HTMLElement => card(id).querySelector('.acct-org') as HTMLElement;
const setButton = (id: string): HTMLElement => within(line(id)).getByRole('button', { name: new RegExp(ORG_SET) });
const openSheet = async (id: string): Promise<HTMLElement> => {
  fireEvent.click(setButton(id));
  return screen.findByRole('dialog');
};
const field = (dialog: HTMLElement): HTMLInputElement => within(dialog).getByRole('textbox') as HTMLInputElement;
const sends = (f: ReturnType<typeof vi.fn>): unknown[] => f.mock.calls.filter(([u]) => String(u).endsWith('/set'));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null }));
});

describe('the words (account organization B1)', () => {
  it('the line names the label, or says it is not set; the hint says never the id', () => {
    expect(orgRow('org-a')).toBe('Organization: org-a');
    expect(orgRow(null)).toBe('Organization: not set');
    expect(ORG_HINT).toBe("A name you choose, the same for accounts in one Claude organization. Never paste the organization's id.");
  });

  it('a refusal is worded from its code: org-looks-like-an-id has its own words, the rest are the lane acts\'', () => {
    const e = (body: unknown): unknown => ({ body });
    expect(orgSaveRefusal('lane-a', e({ ok: false, error: 'org-looks-like-an-id' }))).toBe(
      "That looks like an organization's id, so lane-a's organization was not changed. Use a name you choose, such as org-a: ccrc never stores the id.",
    );
    expect(orgSaveRefusal('lane-a', e({ ok: false, error: 'bad-request' }))).toBe(
      "lane-a's organization was not changed: a name is lowercase letters, digits and hyphens, starting with a letter, at most 32 characters.",
    );
    expect(orgSaveRefusal('lane-a', e({ ok: false, error: 'lane-busy' }))).toBe(laneActRefusal('org', 'lane-a', e({ error: 'lane-busy' })));
    expect(orgSaveRefusal('lane-a', new TypeError('Failed to fetch')))
      .toBe("The request didn't complete, so whether lane-a was changed is unknown. The screen reads it again.");
    // A body word that is a sentence is never printed.
    expect(orgSaveRefusal('lane-a', e({ error: 'Some Sentence here.' }))).toBe("lane-a couldn't be changed.");
  });
});

describe('the line on the card (account organization B1)', () => {
  it('reads the label, or not set, under the placement row', () => {
    stubFetch(() => ROSTER, {});
    show();
    expect(line('lane-a')).toHaveTextContent(orgRow('org-a'));
    expect(line('lane-b')).toHaveTextContent(orgRow(null));
    const home = card('lane-a').querySelector('.acct-home')!;
    expect(home.compareDocumentPosition(line('lane-a')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Set opens a sheet with the hint and the label; an off-shape name cannot be saved, and Cancel sends nothing', async () => {
    const f = stubFetch(() => ROSTER, {});
    show();
    const dialog = await openSheet('lane-a');
    expect(within(dialog).getByText(ORG_HINT)).toBeInTheDocument();
    expect(field(dialog).value).toBe('org-a');
    for (const bad of ['', 'Org A', '9org', `o${'x'.repeat(32)}`]) {
      fireEvent.change(field(dialog), { target: { value: bad } });
      expect(within(dialog).getByRole('button', { name: ORG_SAVE }), JSON.stringify(bad)).toBeDisabled();
    }
    fireEvent.change(field(dialog), { target: { value: 'org-b' } });
    expect(within(dialog).getByRole('button', { name: ORG_SAVE })).toBeEnabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sends(f)).toEqual([]);
    expect(line('lane-a')).toHaveTextContent(orgRow('org-a'));
  });

  it('Save sends the label, and the line moves only on the ack', async () => {
    let roster = ROSTER;
    let ack!: (r: Response) => void;
    const bodies: unknown[] = [];
    stubFetch(() => roster, {
      '/api/accounts/lane-b/set': (init) => { bodies.push(JSON.parse(String(init?.body))); return new Promise<Response>((res) => { ack = res; }); },
    });
    show();
    const dialog = await openSheet('lane-b');
    expect(field(dialog).value).toBe('');
    fireEvent.change(field(dialog), { target: { value: ' org-b ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ORG_SAVE }));
    await waitFor(() => expect(bodies).toEqual([{ org: 'org-b' }]));
    // In flight: the line has not moved, the sheet is still open, and nothing can be sent again.
    expect(line('lane-b')).toHaveTextContent(orgRow(null));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: ORG_SAVE })).toBeDisabled();
    // The sheet is modal, so the card is hidden from the accessibility tree while it is open.
    expect(within(line('lane-b')).getByRole('button', { name: new RegExp(ORG_SET), hidden: true })).toBeDisabled();
    roster = [ROSTER[0]!, lane('lane-b', { label: 'Lane B', org: 'org-b' })];
    await act(async () => { ack(json(200, { ok: true, roster, lane: LANES['lane-b'] })); });
    await waitFor(() => expect(line('lane-b')).toHaveTextContent(orgRow('org-b')));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the line shows what the ack read back, not what was typed', async () => {
    stubFetch(() => ROSTER, {
      // The box answered a roster that still has no label: the line says so.
      '/api/accounts/lane-b/set': async () => json(200, { ok: true, roster: ROSTER, lane: LANES['lane-b'] }),
    });
    show();
    const dialog = await openSheet('lane-b');
    fireEvent.change(field(dialog), { target: { value: 'org-b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ORG_SAVE }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(line('lane-b')).toHaveTextContent(orgRow(null));
  });

  it('Clear sends none, and the line reads not set on the ack', async () => {
    const bodies: unknown[] = [];
    let roster = ROSTER;
    stubFetch(() => roster, {
      '/api/accounts/lane-a/set': async (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        roster = [lane('lane-a'), ROSTER[1]!];
        return json(200, { ok: true, roster, lane: LANES['lane-a'] });
      },
    });
    show();
    const dialog = await openSheet('lane-a');
    fireEvent.click(within(dialog).getByRole('button', { name: ORG_CLEAR }));
    await waitFor(() => expect(bodies).toEqual([{ org: 'none' }]));
    await waitFor(() => expect(line('lane-a')).toHaveTextContent(orgRow(null)));
  });

  it('an unlabelled lane offers no Clear', async () => {
    stubFetch(() => ROSTER, {});
    show();
    const dialog = await openSheet('lane-b');
    expect(within(dialog).queryByRole('button', { name: ORG_CLEAR })).toBeNull();
  });

  it('org-looks-like-an-id toasts its own words, never moves the line, and leaves the sheet open', async () => {
    stubFetch(() => ROSTER, {
      '/api/accounts/lane-a/set': async () => json(400, { ok: false, error: 'org-looks-like-an-id' }),
    });
    show();
    const dialog = await openSheet('lane-a');
    fireEvent.change(field(dialog), { target: { value: 'abcdef0123456789abcdef0123456789' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ORG_SAVE }));
    expect(await screen.findByText(
      "That looks like an organization's id, so lane-a's organization was not changed. Use a name you choose, such as org-a: ccrc never stores the id.",
    )).toBeInTheDocument();
    expect(line('lane-a')).toHaveTextContent(orgRow('org-a'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: ORG_SAVE })).toBeEnabled();
  });

  it('a screen that cannot act draws Set disabled, named by the knob row\'s reason; no connect draws the line alone', () => {
    stubFetch(() => ROSTER, {});
    show({ connect: { accountOps: 'unsupported', gate: 'armed', origin: 'https' } });
    expect(setButton('lane-a')).toBeDisabled();
    expect(setButton('lane-a')).toHaveAttribute('aria-describedby', 'acct-knob-reason-lane-a');
    cleanup();
    show({ connect: null });
    expect(line('lane-a')).toHaveTextContent(orgRow('org-a'));
    expect(within(line('lane-a')).queryByRole('button')).toBeNull();
  });
});
