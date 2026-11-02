// Remove and Discard (accounts plan Task A19, D-7742; spec §11; N3, N6): the pre-check measured on the box at open and
// again after every Move and Wake and move, the destructive button held while a live or a sleeping session remains,
// the typed-id confirm, the ledger built from the verb's answer with its revoke rows, the checklist item recorded with
// no value, and Discard offered only where the box measures a lane discardable. A fake box answers every route.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccountRemoveAnswer, AccountRemoveCheckAnswer, AccountsConnect, FleetSession, LaneWire, RosterWire } from '../../shared/api';
import { RemoveSheet, type RemoveClient, type RemoveSheetProps } from '../src/accounts/RemoveSheet';
import {
  DISCARD_LANE, REVOKE_PAGES, discardLine, offlineRefusal, removeButtonLabel, revokeRecord, sleepingBlockText, typedConfirmLabel,
} from '../src/fleet/accountWords';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession, hibernatedSession } from './fleetFixture';

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token', ...over,
});
const ROSTER: RosterWire[] = [lane('lane-a'), lane('lane-b')];
const FRESH = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: Date.now() + 300_000,
});
const LANE: LaneWire = { state: { word: 'signed-in', source: 'checked just now' }, ready: true, keyHint: 'sk-ant-…a3f9' };

const awake = fleetSession({ id: 'lane-b:p-one', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'one' });
const asleep = hibernatedSession(Date.now() - 60_000, { id: 'lane-b:p-two', wrapper: 'lane-b', home: 'lane-b', project: 'p-two', title: 'two' });

type Check = AccountRemoveCheckAnswer['check'];
const check = (over: Partial<Check> = {}): AccountRemoveCheckAnswer => ({
  ok: true,
  check: {
    live: 0, sleeping: [], archived: 0, upstream: false, otherHomeAble: 1, authInProgress: false, discardable: false,
    at: Date.now(), ...over,
  },
  fleetIdentity: null,
});
const REMOVED: AccountRemoveAnswer = {
  ok: true, roster: [lane('lane-a')],
  removed: ['~/.local/bin/lane-b', '~/.cc-secrets/lane-b-oauth.env'],
  kept: ['~/.claude-lane-b'],
  rehomed: [],
  atProvider: [{ kind: 'anthropic-token', state: 'still-valid', revokeAt: 'claude-code-settings' }],
};

const storeWith = (sessions: FleetSession[] = []): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster: ROSTER, usage: [] }); });
  return store;
};

/** A fake box: the pre-check answers each ask from `checks` in turn (the last one repeats). */
function fakeClient(checks: AccountRemoveCheckAnswer[], o: Partial<RemoveClient> = {}): { [K in keyof RemoveClient]: Mock<RemoveClient[K]> } {
  let i = 0;
  return {
    accountRemoveCheck: vi.fn<RemoveClient['accountRemoveCheck']>(async () => checks[Math.min(i++, checks.length - 1)]!),
    accountRemove: vi.fn<RemoveClient['accountRemove']>(o.accountRemove ?? (async () => REMOVED)),
    accountRevokeAck: vi.fn<RemoveClient['accountRevokeAck']>(o.accountRevokeAck ?? (async () => ({ ok: true as const }))),
  };
}

function sheet(client: RemoveClient, over: Partial<RemoveSheetProps> = {}): RemoveSheetProps {
  const props: RemoveSheetProps = {
    id: 'lane-b', open: true, onClose: vi.fn(), lane: LANE, connect: FRESH(), blocked: null,
    refresh: vi.fn(async () => 'ok' as const), readRoster: () => ROSTER, client, wake: vi.fn(async () => {}),
    fleet: storeWith(), ...over,
  };
  render(<RemoveSheet {...props} />);
  return props;
}

const confirmField = (): HTMLInputElement => screen.getByLabelText(typedConfirmLabel('lane-b')) as HTMLInputElement;
const type = (v: string): void => { fireEvent.change(confirmField(), { target: { value: v } }); };
const removeButton = (): HTMLElement => screen.getByRole('button', { name: /^Remove lane-b/ });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({
    sessions: [], conn: 'connecting', notices: [], blocked: false,
    usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
});

describe('the fold and the trouble card on the Accounts screen (spec §4.2, §4.4)', () => {
  // The last accounts answer is one fixed instant, as the store keeps it: a reader that re-ran `Date.now()` on every
  // call drifted a millisecond past the screen's own clock (`useNow`, read at mount) and read "3m ago".
  let readAt = 0;
  const screenWith = (conn: 'open' | 'down'): void => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    readAt = Date.now() - 240_000;
    act(() => useFleetStore.setState({
      conn, usage: [], roster: [lane('lane-a'), lane('lane-b', { kind: 'sign-in' })], accountsConnect: FRESH(),
      accountsReadAt: () => readAt,
      lanes: {
        'lane-a': { state: { word: 'signed-out', source: 'checked 1h ago' }, ready: false, notReadyReason: 'check-failed' },
        'lane-b': LANE,
      },
    }));
    render(<AccountsScreen />);
  };
  const card = (id: string): HTMLElement => document.querySelector(`[data-lane="${id}"]`) as HTMLElement;

  it('Remove… on every lane and Replace token on a token lane only; Paste a token on a signed-out token card; each opens its sheet', async () => {
    const removeCheck = vi.spyOn(api, 'accountRemoveCheck').mockResolvedValue(check());
    screenWith('open');
    expect(within(card('lane-a')).getByRole('button', { name: 'Replace token' })).toBeEnabled();
    expect(within(card('lane-b')).queryByRole('button', { name: 'Replace token' })).toBeNull();
    expect(within(card('lane-a')).getByRole('button', { name: 'Paste a token' })).toBeEnabled();
    const remove = within(card('lane-b')).getByRole('button', { name: 'Remove…' });
    expect(remove).toHaveClass('btn-danger-ghost');
    fireEvent.click(remove);
    expect(await screen.findByRole('dialog', { name: 'Remove lane-b' })).toBeInTheDocument();
    await waitFor(() => expect(removeCheck).toHaveBeenCalledWith('lane-b'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(card('lane-a')).getByRole('button', { name: 'Paste a token' }));
    expect(await screen.findByRole('dialog', { name: "Replace lane-a's token" })).toBeInTheDocument();
  });

  it('offline, Remove and Replace are refused with the sentence, and nothing is sent', () => {
    const sent = [vi.spyOn(api, 'accountRemoveCheck'), vi.spyOn(api, 'accountRemove'), vi.spyOn(api, 'accountCredential')];
    screenWith('down');
    const sentence = offlineRefusal(readAt, Date.now());
    expect(sentence).toBe("You're offline: nothing was sent. Read 4m ago.");
    for (const [id, name] of [['lane-a', 'Replace token'], ['lane-a', 'Remove…'], ['lane-b', 'Remove…']] as const) {
      const b = within(card(id)).getByRole('button', { name });
      expect(b, `${id} ${name}`).toBeDisabled();
      expect(document.getElementById(b.getAttribute('aria-describedby')!)).toHaveTextContent(sentence);
    }
    expect(within(card('lane-a')).queryByRole('button', { name: 'Paste a token' })).toBeNull();
    for (const f of sent) expect(f).not.toHaveBeenCalled();
  });
});

describe('the pre-check and what holds a removal (spec §11.1, §11.2; N3)', () => {
  it('the destructive button is disabled while a live or sleeping session remains, and recounts as they move', async () => {
    const client = fakeClient([
      check({ live: 1, sleeping: ['lane-b:p-two'] }),
      check({ live: 0, sleeping: ['lane-b:p-two'] }),
      check({ live: 0, sleeping: [] }),
    ]);
    const store = storeWith([awake, asleep]);
    sheet(client, { fleet: store });
    // The line is the box's, measured at open.
    expect(await screen.findByText(/^1 live session · not the upstream lane · 1 other lane can take new sessions · no sign-in in progress · read just now$/)).toBeInTheDocument();
    type('lane-b');
    expect(removeButton()).toHaveTextContent(removeButtonLabel('lane-b', 2));
    expect(removeButton()).toBeDisabled();

    // Move the live one: the mover opens over that session alone, and closing it asks the box again.
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    const mover = await screen.findByRole('dialog', { name: 'Move sessions off lane-b' });
    expect(within(mover).getByText('one')).toBeInTheDocument();
    expect(within(mover).queryByText('two')).toBeNull();
    fireEvent.keyDown(mover, { key: 'Escape' });
    await waitFor(() => expect(client.accountRemoveCheck).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(removeButton()).toHaveTextContent(removeButtonLabel('lane-b', 1)));
    // A sleeping session alone still holds it: it is counted, not just listed.
    expect(removeButton()).toBeDisabled();

    // Wake and move the sleeping one, then close the mover: the box reads none, and the button is the plain act.
    fireEvent.click(screen.getByRole('button', { name: 'Wake and move' }));
    const mover2 = await screen.findByRole('dialog', { name: 'Move sessions off lane-b' });
    fireEvent.keyDown(mover2, { key: 'Escape' });
    await waitFor(() => expect(client.accountRemoveCheck).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(removeButton()).toHaveTextContent(removeButtonLabel('lane-b', 0)));
    expect(removeButton()).toBeEnabled();
  });

  it('sleeping sessions are listed apart and offer Wake and move', async () => {
    const client = fakeClient([check({ live: 0, sleeping: ['lane-b:p-two', 'lane-b:p-three'] })]);
    let release: () => void = () => {};
    const wake = vi.fn((id: string) => (id === 'lane-b:p-two'
      ? new Promise<void>((r) => { release = r; }) : Promise.resolve()));
    const store = storeWith([asleep]);
    sheet(client, { wake, fleet: store });
    const block = (await screen.findByText(sleepingBlockText('lane-b', 2))).closest('section') as HTMLElement;
    expect(block).toHaveAttribute('data-sleeping', 'true');
    expect(within(block).getByText('lane-b:p-two')).toBeInTheDocument();
    expect(within(block).getByText('lane-b:p-three')).toBeInTheDocument();
    // Removing the lane would wake them elsewhere without their place: the sentence says so.
    expect(block).toHaveTextContent('without their place in the conversation');

    fireEvent.click(within(block).getByRole('button', { name: 'Wake and move' }));
    // One at a time: the second wake waits for the first.
    await waitFor(() => expect(wake).toHaveBeenCalledTimes(1));
    expect(wake).toHaveBeenLastCalledWith('lane-b:p-two');
    expect(screen.getByText('Waking 1 of 2…')).toBeInTheDocument();
    await act(async () => { release(); });
    await waitFor(() => expect(wake).toHaveBeenCalledTimes(2));
    expect(wake).toHaveBeenLastCalledWith('lane-b:p-three');
    // Then A3's mover, over the woken sessions only.
    const mover = await screen.findByRole('dialog', { name: 'Move sessions off lane-b' });
    expect(within(mover).getByText('two')).toBeInTheDocument();
  });

  it('offline, nothing is asked and every act is refused with the sentence', async () => {
    const client = fakeClient([check()]);
    const text = offlineRefusal(Date.now() - 240_000, Date.now());
    sheet(client, { blocked: text });
    expect(screen.getByText(text)).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(client.accountRemoveCheck).not.toHaveBeenCalled();
    expect(client.accountRemove).not.toHaveBeenCalled();
  });
});

describe('the act (spec §11.5)', () => {
  it('the typed confirm must equal the id', async () => {
    const client = fakeClient([check()]);
    sheet(client);
    await screen.findByTestId('remove-check');
    for (const wrong of ['Lane-B', 'LANE-B', 'lane-b ', ' lane-b', 'lane-', '']) {
      type(wrong);
      expect(removeButton(), JSON.stringify(wrong)).toBeDisabled();
    }
    type('lane-b');
    expect(removeButton()).toBeEnabled();
    fireEvent.click(removeButton());
    await waitFor(() => expect(client.accountRemove).toHaveBeenCalledTimes(1));
    expect(client.accountRemove).toHaveBeenCalledWith('lane-b', { mode: 'remove', confirmId: 'lane-b' });
    // The danger tone, as every destructive confirm wears it.
    expect(await screen.findByText('lane-b is removed.')).toBeInTheDocument();
  });

  it('Discard is offered only for a never-enabled lane with no sessions', async () => {
    // Never enabled, nothing on it: Discard, one tap, no typed confirm.
    const yes = fakeClient([check({ discardable: true })]);
    sheet(yes);
    const discard = await screen.findByRole('button', { name: DISCARD_LANE });
    expect(discard).toHaveClass('btn-danger');
    expect(screen.getByText(discardLine('lane-b'))).toBeInTheDocument();
    expect(screen.queryByLabelText(typedConfirmLabel('lane-b'))).toBeNull();
    fireEvent.click(discard);
    await waitFor(() => expect(yes.accountRemove).toHaveBeenCalledWith('lane-b', { mode: 'discard' }));
    cleanup();

    // Ever enabled (the box says not discardable): no Discard; the typed remove.
    const no = fakeClient([check({ discardable: false })]);
    sheet(no);
    await screen.findByTestId('remove-check');
    expect(screen.queryByRole('button', { name: DISCARD_LANE })).toBeNull();
    expect(screen.getByLabelText(typedConfirmLabel('lane-b'))).toBeInTheDocument();
    cleanup();

    // A session asleep on it: no Discard either, whatever else the box said.
    const sleepy = fakeClient([check({ discardable: true, sleeping: ['lane-b:p-two'] })]);
    sheet(sleepy);
    await screen.findByTestId('remove-check');
    expect(screen.queryByRole('button', { name: DISCARD_LANE })).toBeNull();
  });
});

describe('the ledger (spec §11.3; N6; the OA1 record)', () => {
  it('the ledger shows the token as still valid with its checklist item, and the tick sends revoke-ack with no value', async () => {
    const client = fakeClient([check()]);
    sheet(client);
    await screen.findByTestId('remove-check');
    type('lane-b');
    fireEvent.click(removeButton());
    await screen.findByText('lane-b is removed.');

    const removed = screen.getByRole('region', { name: 'Removed' });
    expect(within(removed).getByText('~/.cc-secrets/lane-b-oauth.env')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Kept on the box' })).getByText('~/.claude-lane-b')).toBeInTheDocument();
    const at = screen.getByRole('region', { name: 'Still valid at the provider until you revoke it' });
    expect(at).toHaveTextContent('The token still works at Anthropic for up to about a year.');
    expect(within(at).getByRole('link', { name: REVOKE_PAGES['claude-code-settings'].label }))
      .toHaveAttribute('href', 'https://claude.ai/settings/claude-code');

    const box = within(at).getByRole('checkbox', { name: 'I revoked it' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(within(at).getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, false));
    fireEvent.click(box);
    await waitFor(() => expect(box).toHaveAttribute('aria-checked', 'true'));
    // The lane and the kind, and nothing else: no token, no hint, no value.
    expect(client.accountRevokeAck).toHaveBeenCalledTimes(1);
    expect(client.accountRevokeAck.mock.calls[0]![0]).toStrictEqual({ laneId: 'lane-b', kind: 'anthropic-token' });
    expect(JSON.stringify(client.accountRevokeAck.mock.calls)).not.toContain('a3f9');
    expect(within(at).getByTestId('revoke-record')).toHaveTextContent(revokeRecord(true, false));
  });

  it("a sign-in's row says unmeasured, never ended and never still valid (G23 not run)", async () => {
    const client = fakeClient([check()], {
      accountRemove: async () => ({
        ...REMOVED, atProvider: [{ kind: 'anthropic-sign-in', state: 'unmeasured', revokeAt: 'claude-account-settings' }],
      }),
    });
    sheet(client);
    await screen.findByTestId('remove-check');
    type('lane-b');
    fireEvent.click(removeButton());
    // The heading claims nothing either: the spec's "Still valid…" is for a measured row only.
    const at = await screen.findByRole('region', { name: 'At the provider' });
    expect(at).toHaveTextContent('unmeasured');
    expect(at.textContent).not.toMatch(/ended at Anthropic|still valid|still works/i);
    expect(within(at).queryByRole('checkbox')).toBeNull();
  });

  it('a refusal says why from its code, and a refused confirm empties the field', async () => {
    const client = fakeClient([check()], {
      accountRemove: async () => { throw new ApiError(400, { ok: false, error: 'confirm-mismatch' }); },
    });
    sheet(client);
    await screen.findByTestId('remove-check');
    type('lane-b');
    fireEvent.click(removeButton());
    expect(await screen.findByText("The name typed isn't lane-b, so nothing was removed.")).toBeInTheDocument();
    expect(confirmField().value).toBe('');
  });
});
