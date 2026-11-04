// Re-authenticate an existing Anthropic lane (accounts plan Task A38, D-7872; spec §9 rows 1, 2, §4.2, §4.4; Q1): the
// trouble cards' acts in their order (Switch to a long-lived token before Sign in again, Mint a new token before Paste a
// token, Replace token beside Switch to sign-in on the Expiring card), the step-up before any request, the ending every
// re-auth shares (the restart list, the revoke item for a replaced token, a fresh check), and a cancelled re-auth that
// says the old credential is untouched and leaves the card as it was. A fake box answers every route.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ACCOUNT_CAPS, type AccountAuthStatusAnswer, type AccountsConnect, type AccountUsage, type FleetSession, type LaneWire, type RosterWire } from '../../shared/api';
import { AUTH_POLL_MS } from '../src/accounts/ConnectSheet';
import { ReauthSheet, troubleActs, type ReauthClient, type ReauthSheetProps } from '../src/accounts/ReauthSheet';
import { isPastAdding, oldCredentialOf, resumeSheetFor } from '../src/accounts/connectFlow';
import { resetSignOutsForTests } from '../src/accounts/signOuts';
import {
  CANCEL_SIGN_IN, CODE_FIELD_LABEL, LEDGER, MINT_INSTEAD, MINT_NEW_TOKEN, PASTE_A_TOKEN, PASTE_INSTEAD, REAUTH_WRONG, REPLACE_TOKEN,
  NOTHING_INSTALLED, SEND_CODE, SIGN_IN_AGAIN, SIGN_OUT_RESTART, STATED_LABEL, SWITCH_TO_SIGN_IN, SWITCH_TO_TOKEN, credentialUntouched, laneSignedOut,
  reauthEnd, reauthInstalled, reauthIntro, reauthStartRefusal, revokeRecord, switchIntro, switchTitle, type SignInEndKind,
} from '../src/fleet/accountWords';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const now = Date.now();
const DAY = 86_400_000;
const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token', ...over,
});
// lane-a: a sign-in lane, signed out. lane-b: a token lane, signed out. lane-c: a minted token, about 11 months old.
const ROSTER: RosterWire[] = [lane('lane-a', { kind: 'sign-in' }), lane('lane-b'), lane('lane-c')];
const CONNECT = (over: Partial<AccountsConnect> = {}): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: [...ACCOUNT_CAPS], stepUpFreshUntil: Date.now() + 3_600_000, ...over,
});
const OUT = (at: number): LaneWire['state'] => ({ word: 'signed-out', source: 'Signed out · HTTP 401 · checked 2h ago', at });
const MINTED_AT = now - 335 * DAY;
const LANES: Record<string, LaneWire> = {
  'lane-a': { state: OUT(now - 2 * 3_600_000), ready: false, notReadyReason: 'check-failed', identity: 'someone@example.invalid', identitySource: 'measured' },
  'lane-b': { state: OUT(now - 2 * 3_600_000), ready: false, notReadyReason: 'check-failed' },
  'lane-c': {
    state: { word: 'expiring', source: 'token minted 11 months ago · about 4 weeks left · estimated', at: MINTED_AT },
    ready: true, mintedAt: MINTED_AT, identity: 'someone@example.invalid', identitySource: 'stated',
  },
};
const usageOf = (wrapper: string, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: Math.floor(now / 1000) - 120, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
const READY: LaneWire = { state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true };
/** lane-b with a passing check a minute old: the one shape on which the sheet says the lane keeps its token (D-7872 (10)). */
const CHECKED_B: LaneWire = { ...READY, check: { verdict: 'ok', at: now - 60_000 } };
const ATTEMPT = 'a'.repeat(32);
const LOGIN_CODE = 'A'.repeat(48) + '#' + 'b'.repeat(43);
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=s';

const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane="${id}"]`) as HTMLElement;
/** A card's credential acts, in the order drawn, with whether each is the card's primary. */
const actsOf = (id: string): [string, boolean][] =>
  [...card(id).querySelectorAll<HTMLButtonElement>('.acct-trouble-acts button')].map((b) => [b.textContent ?? '', b.className.includes('btn-primary')]);

/** The Accounts screen over the store, with `caps` advertised, and the live session on lane-b. */
function screenWith(connect: AccountsConnect = CONNECT(), sessions: FleetSession[] = []): void {
  vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
  act(() => useFleetStore.setState({
    conn: 'open', usage: [], roster: ROSTER, accountsConnect: connect, lanes: LANES, sessions, accountsReadAt: () => Date.now(),
  }));
  render(<AccountsScreen />);
}

const poll = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_POLL_MS); }); };
const settle = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => {
  cleanup();
  resetSignOutsForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({
    sessions: [], conn: 'connecting', usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
});

describe('the trouble cards hold the acts in the spec\'s order (spec §4.2, Q1)', () => {
  it("a Signed-out sign-in lane's card holds Switch to a long-lived token first and Sign in again second", () => {
    screenWith();
    expect(actsOf('lane-a')).toEqual([[SWITCH_TO_TOKEN, true], [SIGN_IN_AGAIN, false]]);
    // The acts come before the fleet-host command: the card's first action.
    const acts = card('lane-a').querySelector('.acct-trouble-acts')!;
    const command = card('lane-a').querySelector('.acct-fix-command')!;
    expect(acts.compareDocumentPosition(command) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The fold offers Sign in again on a sign-in lane, and no Replace token.
    const fold = within(card('lane-a').querySelector('.acct-fold') as HTMLElement);
    expect(fold.getByRole('button', { name: SIGN_IN_AGAIN })).toBeEnabled();
    expect(fold.queryByRole('button', { name: REPLACE_TOKEN })).toBeNull();
    // The primary opens A23's switch sheet (its Sign the old sign-in out and closing line are there, spec §9).
    fireEvent.click(within(card('lane-a').querySelector('.acct-trouble-acts') as HTMLElement).getByRole('button', { name: SWITCH_TO_TOKEN }));
    expect(screen.getByRole('dialog', { name: switchTitle('lane-a', 'setup-token') })).toBeInTheDocument();
    expect(document.querySelector('.acct-reauth')).toBeNull();
  });

  it("a Signed-out token lane's primary fix is Mint a new token", () => {
    screenWith();
    expect(actsOf('lane-b')).toEqual([[MINT_NEW_TOKEN, true], [PASTE_A_TOKEN, false]]);
    // A fleet that cannot run a sign-in keeps A19's paste arm alone, and offers no re-auth anywhere.
    cleanup();
    act(() => useFleetStore.setState({ accountsConnect: null }));
    screenWith(CONNECT({ caps: ['account-v2'] }));
    expect(actsOf('lane-b')).toEqual([[PASTE_A_TOKEN, false]]);
    expect(actsOf('lane-a')).toEqual([]);
    expect(within(card('lane-a')).queryByRole('button', { name: SIGN_IN_AGAIN })).toBeNull();
    // The rule itself, for every word and kind it answers.
    expect(troubleActs('signed-out', 'token', true).map((a) => a.act)).toEqual(['mint-new-token', 'paste-token']);
    expect(troubleActs('signed-in', 'token', true)).toEqual([]);
    expect(troubleActs('signed-out', 'key', true)).toEqual([]);
  });

  it('the Expiring (minted token) card offers Replace token and Switch to sign-in', () => {
    screenWith();
    expect(card('lane-c')).toHaveTextContent("lane-c's token was minted about 11 months ago.");
    expect(card('lane-c')).toHaveTextContent('Long-lived tokens last about a year. When it lapses the lane signs out.');
    expect(actsOf('lane-c')).toEqual([[REPLACE_TOKEN, true], [SWITCH_TO_SIGN_IN, false]]);
    // The switch is A23's sheet, with its sign-out and closing line, never this one's (D-7872 (7)).
    fireEvent.click(within(card('lane-c').querySelector('.acct-trouble-acts') as HTMLElement).getByRole('button', { name: SWITCH_TO_SIGN_IN }));
    expect(screen.getByRole('dialog', { name: switchTitle('lane-c', 'login') })).toBeInTheDocument();
    expect(document.querySelector('.acct-reauth')).toBeNull();
  });
});

describe('each act asks for step-up before any request (spec §9: "Every one of these needs step-up")', () => {
  const stale = (): AccountsConnect => CONNECT({ stepUpFreshUntil: Date.now() - 1 });
  const cases: [string, string, string, 'login' | 'setup-token'][] = [
    ['lane-a', '.acct-trouble-acts', SIGN_IN_AGAIN, 'login'],
    ['lane-a', '.acct-fold', SIGN_IN_AGAIN, 'login'],
    ['lane-b', '.acct-trouble-acts', MINT_NEW_TOKEN, 'setup-token'],
    ['lane-c', '.acct-trouble-acts', REPLACE_TOKEN, 'setup-token'],
    ['lane-c', '.acct-fold', REPLACE_TOKEN, 'setup-token'],
  ];
  for (const [id, where, name, method] of cases) {
    it(`${id}'s ${name} (${where === '.acct-fold' ? 'the fold' : 'the card'})`, async () => {
      vi.spyOn(api, 'stepUpStart').mockResolvedValue({ challengeB64url: 'c', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] });
      const pass = vi.spyOn(api, 'stepUpPassphrase').mockResolvedValue({ ok: true, stepUpFreshUntil: Date.now() + 300_000 });
      const start = vi.spyOn(api, 'accountAuthStart').mockResolvedValue({ ok: true, attemptId: ATTEMPT, expiresAt: Date.now() + 420_000 });
      vi.spyOn(api, 'accountAuthStatus').mockResolvedValue({ ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: Date.now() + 420_000 });
      screenWith(stale());
      fireEvent.click(within(card(id).querySelector(where) as HTMLElement).getByRole('button', { name }));
      // The step first: the primary is held, and pressing it sends nothing.
      await screen.findByRole('button', { name: 'Confirm with passphrase' });
      const sheetPrimary = within(document.querySelector('.acct-reauth') as HTMLElement)
        .getByRole('button', { name: method === 'login' ? 'Start the sign-in' : MINT_NEW_TOKEN });
      expect(sheetPrimary).toBeDisabled();
      fireEvent.click(sheetPrimary);
      expect(start).not.toHaveBeenCalled();
      // Then the step, then the act, once, with this lane's method.
      fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
      await waitFor(() => expect(sheetPrimary).toBeEnabled());
      expect(pass).toHaveBeenCalledTimes(1);
      fireEvent.click(sheetPrimary);
      await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
      expect(start).toHaveBeenCalledWith(id, { method });
    });
  }
});

// ── The sheet itself, against a fake box ────────────────────────────────────────────────────────────────────────────

type Status = AccountAuthStatusAnswer;
function fakeBox(checked: LaneWire = READY): {
  box: { status: Status; expiresAt: number };
  client: { [K in keyof ReauthClient]: Mock<ReauthClient[K]> };
} {
  const box = { status: null as unknown as Status, expiresAt: Date.now() + 7 * 60_000 };
  box.status = { ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: box.expiresAt };
  const client = {
    accountAuthStart: vi.fn<ReauthClient['accountAuthStart']>(async () => ({ ok: true as const, attemptId: ATTEMPT, expiresAt: box.expiresAt })),
    accountAuthStatus: vi.fn<ReauthClient['accountAuthStatus']>(async () => box.status),
    accountAuthCode: vi.fn<ReauthClient['accountAuthCode']>(async () => ({ ok: true as const })),
    accountAuthCancel: vi.fn<ReauthClient['accountAuthCancel']>(async () => ({ ok: true as const })),
    accountCheck: vi.fn<ReauthClient['accountCheck']>(async () => ({ ok: true as const, lane: checked })),
    accountSet: vi.fn<ReauthClient['accountSet']>(async (_id, body) => ({
      ok: true as const, roster: ROSTER, lane: { ...checked, identity: body.stated!, identitySource: 'stated' as const },
    })),
    accountSignOut: vi.fn<ReauthClient['accountSignOut']>(async () => ({ ok: true as const, signOut: 'removed' as const, lane: READY })),
    accountRevokeAck: vi.fn<ReauthClient['accountRevokeAck']>(async () => ({ ok: true as const })),
    stop: vi.fn<ReauthClient['stop']>(async () => undefined as never),
  };
  return { box, client };
}
type Box = ReturnType<typeof fakeBox>;

const storeWith = (sessions: FleetSession[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster: ROSTER, usage: [] }); });
  return store;
};

function sheet(b: Box, over: Partial<ReauthSheetProps> = {}): ReauthSheetProps {
  const props: ReauthSheetProps = {
    id: 'lane-b', method: 'setup-token', open: true, onClose: vi.fn(), connect: CONNECT(), blocked: null,
    lane: LANES['lane-b'], roster: ROSTER, refresh: vi.fn(async () => 'ok' as const), client: b.client,
    ensure: vi.fn(async () => {}), fleet: storeWith([]), ...over,
  };
  render(<ReauthSheet {...props} />);
  return props;
}
const alertText = (): string => screen.getByTestId('reauth-alert').textContent ?? '';

/** Start, the URL, the code, and `done`: the run as the operator walks it. */
async function walk(b: Box, primary: string, code: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: primary }));
  await settle();
  b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
  await poll();
  fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => code } });
  fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
  await settle();
  b.box.status = { ok: true, state: 'done', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
  await poll();
  await settle();
}

describe('every re-auth ends the same way (spec §9)', () => {
  it('each ends with the restart list, the revoke item for a replaced token, and a fresh check', async () => {
    // Mint a new token on a token lane, with one live session on it.
    const live = fleetSession({ id: 'lane-b:p-one', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'one' });
    const b = fakeBox();
    const ensure = vi.fn(async () => {});
    const props = sheet(b, { fleet: storeWith([live]), ensure, onPaste: vi.fn(), lane: { ...LANES['lane-b']!, identity: 'someone@example.invalid', identitySource: 'stated' } });
    expect(screen.getByRole('button', { name: PASTE_INSTEAD })).toBeInTheDocument();
    await walk(b, MINT_NEW_TOKEN, 'C'.repeat(40));
    expect(b.client.accountAuthStart).toHaveBeenCalledWith('lane-b', { method: 'setup-token' });
    // The fresh check, after the install, and the store asked again.
    await waitFor(() => expect(b.client.accountCheck).toHaveBeenCalledWith('lane-b'));
    expect(await screen.findByText(LEDGER.checked)).toBeInTheDocument();
    expect(screen.getByText(reauthInstalled('setup-token'))).toBeInTheDocument();
    await waitFor(() => expect(props.refresh).toHaveBeenCalled());
    // The restart list: one tap, stop then ensure.
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(ensure).toHaveBeenCalledWith('lane-b:p-one'));
    expect(b.client.stop).toHaveBeenCalledWith('lane-b:p-one');
    // The revoke item for the replaced token, unticked by default.
    expect(screen.getByRole('checkbox', { name: 'I revoked the old token' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, true));
    // The stated identity, asked again with the old one as its default text.
    expect((screen.getByLabelText(STATED_LABEL) as HTMLInputElement).value).toBe('someone@example.invalid');
    cleanup();

    // Sign in again on a sign-in lane: the restart list and the fresh check, no revoke item (no token was replaced), and
    // the identity read back, which here is another account than the lane had.
    const b2 = fakeBox({ ...READY, identity: 'other@example.invalid', identitySource: 'measured' });
    const on = fleetSession({ id: 'lane-a:p-one', wrapper: 'lane-a', home: 'lane-a', project: 'p-one', title: 'one' });
    sheet(b2, { id: 'lane-a', method: 'login', lane: LANES['lane-a'], fleet: storeWith([on]) });
    expect(screen.queryByRole('button', { name: PASTE_INSTEAD })).toBeNull();
    await walk(b2, 'Start the sign-in', LOGIN_CODE);
    await waitFor(() => expect(b2.client.accountCheck).toHaveBeenCalledWith('lane-a'));
    expect(await screen.findByText('Signed in as other@example.invalid')).toBeInTheDocument();
    expect(screen.getByText(/pick(s)? up the new sign-in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'I revoked the old token' })).toBeNull();
    expect(screen.queryByLabelText(STATED_LABEL)).toBeNull();
    expect(screen.getByText(new RegExp(REAUTH_WRONG.replace('?', '\\?')))).toHaveTextContent('It had someone@example.invalid.');
    // Sign this lane out and start again: N5's sign-out, then a new attempt of the same method.
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    fireEvent.click(await screen.findByRole('button', { name: SIGN_OUT_RESTART }));
    await waitFor(() => expect(b2.client.accountSignOut).toHaveBeenCalledWith('lane-a'));
    await waitFor(() => expect(b2.client.accountAuthStart).toHaveBeenCalledTimes(2));
  });

  it('the same identity read back offers no sign-out', async () => {
    const b = fakeBox({ ...READY, identity: 'someone@example.invalid', identitySource: 'measured' });
    sheet(b, { id: 'lane-a', method: 'login', lane: LANES['lane-a'] });
    await walk(b, 'Start the sign-in', LOGIN_CODE);
    expect(await screen.findByText('Signed in as someone@example.invalid')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(REAUTH_WRONG.replace('?', '\\?')))).toBeNull();
  });
});

describe('a refused, cancelled or expired attempt leaves the lane as it was', () => {
  it('a cancelled re-auth on a Signed-out lane installs nothing, claims nothing of its old sign-in, and leaves the card as it was', async () => {
    const start = vi.spyOn(api, 'accountAuthStart').mockResolvedValue({ ok: true, attemptId: ATTEMPT, expiresAt: Date.now() + 420_000 });
    vi.spyOn(api, 'accountAuthStatus').mockResolvedValue({ ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: Date.now() + 420_000 });
    const cancel = vi.spyOn(api, 'accountAuthCancel').mockResolvedValue({ ok: true });
    const check = vi.spyOn(api, 'accountCheck');
    screenWith();
    const before = actsOf('lane-a');
    fireEvent.click(within(card('lane-a').querySelector('.acct-trouble-acts') as HTMLElement).getByRole('button', { name: SIGN_IN_AGAIN }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the sign-in' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('lane-a', { method: 'login' }));
    fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('lane-a', { attemptId: ATTEMPT }));
    // lane-a has no passing check (its sign-in was refused), so the ending is the neutral one (D-7872 (10)).
    const said = reauthEnd('lane-a', 'login', 'cancelled', undefined, 'unsure');
    expect(said).toContain(NOTHING_INSTALLED);
    expect(said).not.toContain(credentialUntouched('lane-a', 'login'));
    await waitFor(() => expect(screen.getByTestId('reauth-alert')).toHaveTextContent(said));
    expect(screen.getAllByText(said).length).toBeGreaterThan(0);
    // Nothing was checked, and the card is the one it was.
    expect(check).not.toHaveBeenCalled();
    fireEvent.click(within(document.querySelector('.acct-reauth') as HTMLElement).getByRole('button', { name: 'Close' }));
    expect(card('lane-a')).toHaveAttribute('data-state', 'signed-out');
    expect(actsOf('lane-a')).toEqual(before);
  });

  it('an expired or refused attempt says so, each from its code', async () => {
    const b = fakeBox();
    sheet(b, { lane: CHECKED_B });
    fireEvent.click(screen.getByRole('button', { name: MINT_NEW_TOKEN }));
    await settle();
    b.box.status = { ok: true, state: 'expired', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    expect(alertText()).toBe(reauthEnd('lane-b', 'setup-token', 'expired', undefined, 'kept'));
    expect(alertText()).toContain('Nothing changed: lane-b keeps its old token.');
    expect(b.client.accountCheck).not.toHaveBeenCalled();
    cleanup();

    const r = fakeBox();
    r.client.accountAuthStart.mockRejectedValue(new (await import('../src/lib/api')).ApiError(409, { error: 'lane-busy', detail: 'PLANTED' }));
    sheet(r, { lane: CHECKED_B });
    fireEvent.click(screen.getByRole('button', { name: MINT_NEW_TOKEN }));
    await settle();
    expect(alertText()).toContain('lane-b is busy with another account change.');
    expect(alertText()).toContain('Nothing changed: lane-b keeps its old token.');
    expect(alertText()).not.toContain('PLANTED');
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  });
});

/** The fresh check after a sign-in that read back another account: a passing check, a minute old, as the box records it. */
const OTHER_AT = now - 60_000;
const OTHER: LaneWire = { ...READY, check: { verdict: 'ok', at: OTHER_AT }, identity: 'other@example.invalid', identitySource: 'measured' };

describe('after Sign this lane out and start again, every ending says the lane is signed out (D-7872 (2))', () => {
  /** Sign in again on lane-a reads back another account; Sign this lane out and start again runs N5's sign-out and a
   *  second start. `refuse` makes that second start refused with a word. */
  async function signedOutAndStarted(refuse?: ApiError): Promise<Box> {
    const b = fakeBox(OTHER);
    sheet(b, { id: 'lane-a', method: 'login', lane: LANES['lane-a'] });
    await walk(b, 'Start the sign-in', LOGIN_CODE);
    expect(await screen.findByText('Signed in as other@example.invalid')).toBeInTheDocument();
    b.box.status = { ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    if (refuse !== undefined) b.client.accountAuthStart.mockRejectedValueOnce(refuse);
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    fireEvent.click(await screen.findByRole('button', { name: SIGN_OUT_RESTART }));
    await waitFor(() => expect(b.client.accountSignOut).toHaveBeenCalledWith('lane-a'));
    await waitFor(() => expect(b.client.accountAuthStart).toHaveBeenCalledTimes(2));
    await settle();
    return b;
  }
  const saysSignedOut = (said: string): void => {
    expect(alertText()).toBe(said);
    expect(said).toContain(laneSignedOut('lane-a'));
    expect(said).not.toContain(credentialUntouched('lane-a', 'login'));
    expect(said).not.toMatch(/Nothing changed|keeps its old/);
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  };

  it('a cancelled attempt after the sign-out says the lane is signed out, and so does the next one Start again runs', async () => {
    const b = await signedOutAndStarted();
    fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
    await waitFor(() => expect(b.client.accountAuthCancel).toHaveBeenCalledWith('lane-a', { attemptId: ATTEMPT }));
    await settle();
    saysSignedOut(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'signed-out'));
    // Start again: the lane is still signed out, so its ending says so too.
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(b.client.accountAuthStart).toHaveBeenCalledTimes(3));
    fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
    await waitFor(() => expect(b.client.accountAuthCancel).toHaveBeenCalledTimes(2));
    await settle();
    saysSignedOut(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'signed-out'));
  });

  it('an expired attempt after the sign-out says the lane is signed out', async () => {
    const b = await signedOutAndStarted();
    b.box.status = { ok: true, state: 'expired', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    saysSignedOut(reauthEnd('lane-a', 'login', 'expired', undefined, 'signed-out'));
  });

  it('a refused code after the sign-out says the lane is signed out', async () => {
    const b = await signedOutAndStarted();
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => LOGIN_CODE } });
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    b.box.status = { ok: true, state: 'failed', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    saysSignedOut(reauthEnd('lane-a', 'login', 'code-refused', undefined, 'signed-out'));
  });

  it("the helper's own failure after the sign-out says the lane is signed out", async () => {
    const b = await signedOutAndStarted();
    b.box.status = { ok: true, state: 'failed', failure: 'helper-exited', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    saysSignedOut(reauthEnd('lane-a', 'login', 'failed', 'helper-exited', 'signed-out'));
  });

  it('a start refused with a word after the sign-out says the lane is signed out', async () => {
    await signedOutAndStarted(new ApiError(409, { error: 'lane-busy' }));
    expect(alertText()).toContain('lane-a is busy with another account change.');
    saysSignedOut(reauthStartRefusal('lane-a', 'login', 'lane-busy', undefined, 'signed-out'));
  });

  it('signed out in one sheet and resumed in a fresh one, its cancel claims nothing of the old sign-in (D-7872 (10))', async () => {
    const b = await signedOutAndStarted();
    // Closed mid-attempt: the sheet goes, the attempt keeps running, and the screen reads the lanes again. The box
    // cleared the sign-in lane's check when it signed it out, so the lane holds no check now.
    cleanup();
    const reread: LaneWire = {
      state: { word: 'not-checked', source: 'no check recorded yet' }, ready: false, notReadyReason: 'not-checked',
      identity: 'other@example.invalid', identitySource: 'measured',
    };
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    sheet(b, { id: 'lane-a', method: 'login', lane: reread, resume: { attemptId: ATTEMPT, method: 'login', expiresAt: b.box.expiresAt } });
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(b.client.accountAuthStart).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: CANCEL_SIGN_IN }));
    await waitFor(() => expect(b.client.accountAuthCancel).toHaveBeenCalledWith('lane-a', { attemptId: ATTEMPT }));
    await settle();
    // A fresh sheet cannot be sure the lane is still signed out (it may have been signed in elsewhere): neutral.
    expect(alertText()).toBe(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'unsure'));
    expect(alertText()).not.toMatch(/Nothing changed|keeps its old/);
  });

  it('Sign in again opened later on the lane it signed out never says it keeps one, until a newer passing check', async () => {
    const b = await signedOutAndStarted();
    cleanup();
    // The screen has not read the lanes again yet: the lane is the one the sheet last checked, before its sign-out.
    sheet(b, { id: 'lane-a', method: 'login', lane: OTHER });
    expect(screen.getByText(reauthIntro('lane-a', 'login', 'unsure'))).toBeInTheDocument();
    expect(document.querySelector('.acct-reauth')?.textContent).not.toMatch(/keeps the sign-in it has/);
    cleanup();
    // A passing check newer than that one: a credential went back in on the fleet host, so the lane keeps it.
    sheet(b, { id: 'lane-a', method: 'login', lane: { ...OTHER, check: { verdict: 'ok', at: OTHER_AT + 1_000 } } });
    expect(screen.getByText(reauthIntro('lane-a', 'login', 'kept'))).toBeInTheDocument();
  });

  it('no ending after a sign-out says the old credential is untouched; before one, every ending that can says so', () => {
    const kinds: SignInEndKind[] = ['expired', 'code-refused', 'untrusted', 'cancelled', 'unknown', 'lost', 'node-changed', 'failed'];
    for (const method of ['login', 'setup-token'] as const) {
      for (const k of kinds) {
        const after = reauthEnd('lane-a', method, k, undefined, 'signed-out');
        expect(after).not.toContain(credentialUntouched('lane-a', method));
        expect(after).not.toMatch(/Nothing changed|keeps its old|was not replaced/);
        if (k !== 'lost') expect(after).toContain(laneSignedOut('lane-a'));
        const before = reauthEnd('lane-a', method, k, undefined, 'kept');
        if (k !== 'unknown' && k !== 'lost') expect(before).toContain(credentialUntouched('lane-a', method));
      }
      expect(reauthStartRefusal('lane-a', method, 'lane-busy', undefined, 'signed-out')).not.toContain(credentialUntouched('lane-a', method));
      expect(reauthStartRefusal('lane-a', method, 'lane-busy', undefined, 'kept')).toContain(credentialUntouched('lane-a', method));
    }
  });
});

describe('a lane that says it has no credential: the intro and every ending say it is signed out (D-7872 (2))', () => {
  const NONE: LaneWire = { state: { word: 'not-checked', source: 'no check recorded yet' }, ready: false, notReadyReason: 'no-credential' };
  const cases = [['lane-a', 'login', 'Start the sign-in'], ['lane-b', 'setup-token', MINT_NEW_TOKEN]] as const;

  for (const [id, method, primary] of cases) {
    it(`${id} (${method}): the intro, a cancel, an expiry and a refused start each say ${id} is signed out`, async () => {
      const b = fakeBox();
      sheet(b, { id, method, lane: NONE });
      expect(screen.getByText(reauthIntro(id, method, 'signed-out'))).toBeInTheDocument();
      expect(document.querySelector('.acct-reauth')?.textContent).not.toMatch(/keeps the (sign-in|token) it has|Nothing changed/);
      fireEvent.click(screen.getByRole('button', { name: primary }));
      await settle();
      fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
      await waitFor(() => expect(b.client.accountAuthCancel).toHaveBeenCalledTimes(1));
      await settle();
      expect(alertText()).toBe(reauthEnd(id, method, 'cancelled', undefined, 'signed-out'));
      expect(alertText()).not.toContain(credentialUntouched(id, method));
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
      await waitFor(() => expect(b.client.accountAuthStart).toHaveBeenCalledTimes(2));
      b.box.status = { ok: true, state: 'expired', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
      await poll();
      expect(alertText()).toBe(reauthEnd(id, method, 'expired', undefined, 'signed-out'));
      b.client.accountAuthStart.mockRejectedValueOnce(new ApiError(409, { error: 'lane-busy' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
      await settle();
      expect(alertText()).toBe(reauthStartRefusal(id, method, 'lane-busy', undefined, 'signed-out'));
      expect(alertText()).toContain(laneSignedOut(id));
    });
  }

  it('a lane with a passing check keeps the wording it had: the intro and a cancel say the old one is untouched', async () => {
    for (const [id, method, primary] of cases) {
      const b = fakeBox();
      // A passing check a minute old, and no sign-out this app knows of (D-7872 (10)).
      sheet(b, { id, method, lane: { ...LANES[id]!, check: { verdict: 'ok', at: now - 60_000 } } });
      expect(screen.getByText(reauthIntro(id, method, 'kept'))).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: primary }));
      await settle();
      fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
      await waitFor(() => expect(b.client.accountAuthCancel).toHaveBeenCalledTimes(1));
      await settle();
      expect(alertText()).toBe(reauthEnd(id, method, 'cancelled', undefined, 'kept'));
      expect(alertText()).toContain(credentialUntouched(id, method));
      cleanup();
    }
  });

  it("the rule: signed out on the box's no-credential word or the sheet's own sign-out; kept only behind a newer passing check", () => {
    const at = now - 60_000;
    const checked = (verdict: string, t: number): LaneWire => ({ ...READY, check: { verdict, at: t } });
    expect(oldCredentialOf(NONE, undefined, undefined)).toBe('signed-out');
    expect(oldCredentialOf({ ...READY, notReadyReason: 'no-credential' }, undefined, undefined)).toBe('signed-out');
    expect(oldCredentialOf(checked('ok', at), undefined, undefined, true)).toBe('signed-out');
    // No passing check on record: neutral, whatever the word (reauth-wording.test.tsx holds the rest of the rule).
    for (const l of [LANES['lane-a'], LANES['lane-b'], READY, undefined, { ...NONE, notReadyReason: 'not-checked' as const }]) {
      expect(oldCredentialOf(l, undefined, undefined)).toBe('unsure');
    }
    expect(oldCredentialOf(checked('auth-dead', now), undefined, { checkAt: at })).toBe('unsure');
    expect(oldCredentialOf(checked('ok', at), undefined, { checkAt: at })).toBe('unsure');
    expect(oldCredentialOf(checked('ok', at + 1), undefined, { checkAt: at })).toBe('kept');
    expect(oldCredentialOf(checked('ok', at), undefined, {})).toBe('kept');
  });
});

describe("the screen hands each sheet the lane's 401 marker (D-7872 (10))", () => {
  // The Signed-out sign-in card's own shape: the provider refused lane-a (ccd's 401 marker in its telemetry row) after
  // an older check passed. Only the marker says the old sign-in may be gone, so a sheet opened without it would say
  // lane-a keeps the sign-in it has.
  const PASSED_THEN_401: LaneWire = { ...LANES['lane-a']!, check: { verdict: 'ok', at: now - 3 * 3_600_000 } };
  function screenWithMarker(): void {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    act(() => useFleetStore.setState({
      conn: 'open', usage: [usageOf('lane-a', { authDead: true })], roster: ROSTER, accountsConnect: CONNECT(),
      lanes: { ...LANES, 'lane-a': PASSED_THEN_401 }, sessions: [], accountsReadAt: () => Date.now(),
    }));
    render(<AccountsScreen />);
  }
  const acts = (): HTMLElement => card('lane-a').querySelector('.acct-trouble-acts') as HTMLElement;

  it("the card's Sign in again: the re-auth sheet's intro is the neutral one", () => {
    expect(oldCredentialOf(PASSED_THEN_401, null, undefined)).toBe('kept');
    screenWithMarker();
    expect(actsOf('lane-a')).toEqual([[SWITCH_TO_TOKEN, true], [SIGN_IN_AGAIN, false]]);
    fireEvent.click(within(acts()).getByRole('button', { name: SIGN_IN_AGAIN }));
    const sheet = document.querySelector('.acct-reauth') as HTMLElement;
    expect(within(sheet).getByText(reauthIntro('lane-a', 'login', 'unsure'))).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/keeps/);
  });

  it("the card's primary, Switch to a long-lived token: the switch sheet's intro is the neutral one", () => {
    screenWithMarker();
    fireEvent.click(within(acts()).getByRole('button', { name: SWITCH_TO_TOKEN }));
    const sheet = screen.getByRole('dialog', { name: switchTitle('lane-a', 'setup-token') });
    expect(within(sheet).getByText(switchIntro('lane-a', 'setup-token', 'unsure'))).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/keeps its|still uses its/);
  });
});

describe('Replace token: mint first, paste second (spec §9 token row)', () => {
  it("the fold's Replace token opens the mint, and each sheet leads to the other", async () => {
    screenWith();
    fireEvent.click(within(card('lane-c').querySelector('.acct-fold') as HTMLElement).getByRole('button', { name: REPLACE_TOKEN }));
    const reauth = await waitFor(() => document.querySelector('.acct-reauth') as HTMLElement);
    const buttons = [...reauth.querySelectorAll<HTMLButtonElement>('.acct-actions button')].map((x) => x.textContent);
    expect(buttons).toEqual([PASTE_INSTEAD, MINT_NEW_TOKEN]);
    expect(within(reauth).getByRole('button', { name: MINT_NEW_TOKEN }).className).toMatch(/btn-primary/);
    fireEvent.click(within(reauth).getByRole('button', { name: PASTE_INSTEAD }));
    // The paste sheet, in its place, with the mint above its field.
    const mint = await screen.findByRole('button', { name: MINT_INSTEAD });
    expect(document.querySelector('.acct-reauth')).toBeNull();
    const field = screen.getByLabelText('Paste the new token');
    expect(mint.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(mint);
    await waitFor(() => expect(document.querySelector('.acct-reauth')).not.toBeNull());
    expect(screen.queryByLabelText('Paste the new token')).toBeNull();
  });
});

describe('a re-auth closed mid-attempt resumes in the re-auth sheet (A23\'s resume, D-7871 (2); D-7872)', () => {
  it('Continue on a checked lane reopens the re-auth sheet at its code field, with no new start', async () => {
    const at = Date.now();
    const expiresAt = at + 400_000;
    const status = vi.spyOn(api, 'accountAuthStatus').mockResolvedValue({
      ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: at, expiresAt,
    });
    const start = vi.spyOn(api, 'accountAuthStart');
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    const held: LaneWire = {
      ...LANES['lane-a']!, check: { verdict: 'auth-dead', at: at - 3_600_000 },
      authAttempt: { state: 'waiting-code', expiresAt, mine: true, attemptId: ATTEMPT, method: 'login' },
    };
    act(() => useFleetStore.setState({
      conn: 'open', usage: [], roster: ROSTER, accountsConnect: CONNECT(), lanes: { ...LANES, 'lane-a': held }, sessions: [],
      accountsReadAt: () => Date.now(),
    }));
    navigate('/accounts?resume=lane-a');
    render(<AccountsScreen />);
    const sheet = await waitFor(() => document.querySelector('.acct-reauth') as HTMLElement);
    expect(sheet).not.toBeNull();
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(status).toHaveBeenCalledWith('lane-a');
    expect(start).not.toHaveBeenCalled();
    // The rule: the same method on a lane that has been checked is a re-auth; on one the connect sheet is still adding
    // (no check yet), the connect sheet's; the other method, the switch.
    expect(resumeSheetFor('sign-in', 'login', true)).toBe('reauth');
    expect(resumeSheetFor('token', 'setup-token', true)).toBe('reauth');
    expect(resumeSheetFor('sign-in', 'login', false)).toBe('connect');
    expect(resumeSheetFor('sign-in', 'setup-token', true)).toBe('switch');
    expect(resumeSheetFor('token', 'login', true)).toBe('switch');
  });

  it("Continue on a Signed-out sign-in lane with no check (the 401 marker alone) reopens the re-auth sheet, not the connect sheet's", async () => {
    // The common Sign in again case: ccd's rescue path writes the `authdead` marker and no check, so the lane's word is
    // Signed out with `check` absent. Its resume is a re-auth, never the new lane's sheet with Discard this lane.
    const at = Date.now();
    const expiresAt = at + 400_000;
    vi.spyOn(api, 'accountAuthStatus').mockResolvedValue({
      ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: at, expiresAt,
    });
    const start = vi.spyOn(api, 'accountAuthStart');
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    const held: LaneWire = {
      ...LANES['lane-a']!, state: { word: 'signed-out', source: 'HTTP 401' },
      authAttempt: { state: 'waiting-code', expiresAt, mine: true, attemptId: ATTEMPT, method: 'login' },
    };
    expect(held.check).toBeUndefined();
    act(() => useFleetStore.setState({
      conn: 'open', usage: [usageOf('lane-a', { authDead: true })], roster: ROSTER, accountsConnect: CONNECT(),
      lanes: { ...LANES, 'lane-a': held }, sessions: [], accountsReadAt: () => Date.now(),
    }));
    navigate('/accounts?resume=lane-a');
    render(<AccountsScreen />);
    const sheet = await waitFor(() => document.querySelector('.acct-reauth') as HTMLElement);
    expect(sheet).not.toBeNull();
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('a lane is past its adding on a check, the 401 marker or any word but Off; an Off lane with neither is one being added', () => {
    const off: LaneWire = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
    // The connect sheet's own lane: added off, never checked, no marker.
    expect(isPastAdding(off, usageOf('lane-n', { disabled: true }))).toBe(false);
    expect(isPastAdding(off, null)).toBe(false);
    expect(isPastAdding(undefined, undefined)).toBe(false);
    // The 401 marker holds under Off's precedence; a check holds whatever the word.
    expect(isPastAdding(off, usageOf('lane-n', { disabled: true, authDead: true }))).toBe(true);
    expect(isPastAdding({ ...off, check: { verdict: 'ok', at: now } }, null)).toBe(true);
    // Turned on: the marker that holds an added lane off is gone, checked or not.
    expect(isPastAdding({ state: { word: 'signed-out', source: 'HTTP 401' }, ready: false }, null)).toBe(true);
    expect(isPastAdding({ state: { word: 'not-checked', source: 'no check recorded yet' }, ready: false }, null)).toBe(true);
  });
});
