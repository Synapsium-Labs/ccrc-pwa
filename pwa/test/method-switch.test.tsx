// The two method switches (accounts plan Task A23, D-7871; spec §9, §4.2, §4.4; Q1, N5), against a fake box: a
// Signed-out sign-in lane's primary fix is Switch to a long-lived token; the switch to the token mints, checks, asks the
// stated identity with the readable email as its default text, lists the lane's sessions with Restart, and ends on Sign
// the old sign-in out, a danger confirm while a listed session predates the switch (§9 is unmeasured, the OA1 record)
// and a plain button after; a cancelled switch to sign-in changes nothing, and the card stays a token lane's.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { stateWordFor } from '../../shared/accounts';
import {
  ACCOUNT_CAPS, type AccountAuthStatusAnswer, type AccountUsage, type AccountsConnect, type FleetSession, type LaneWire,
  type RosterWire,
} from '../../shared/api';
import { MethodSwitchSheet, type MethodSwitchSheetProps, type SwitchClient } from '../src/accounts/MethodSwitchSheet';
import { AUTH_POLL_MS } from '../src/accounts/useSignInAttempt';
import {
  CODE_FIELD_LABEL, LEDGER, SEND_CODE, SIGN_OLD_OUT, SIGN_OLD_OUT_ANYWAY, STATED_LABEL, SWITCH_CLOSE_TOKEN, SWITCH_START, SWITCH_TO_SIGN_IN,
  SWITCH_TO_TOKEN, signOldOutDanger, switchEnd, switchTitle,
} from '../src/fleet/accountWords';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { FAILED_CHECKS, SEED_UNVERIFIED, SEED_UNVERIFIED_LINE } from './failedChecks';
import { fleetSession } from './fleetFixture';

const ATTEMPT = 'd'.repeat(32);
const MINT_CODE = 'Q'.repeat(30);
const LOGIN_CODE = 'A'.repeat(48) + '#' + 'b'.repeat(43);
const URL_OF = (scope: string): string =>
  `https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=${encodeURIComponent(scope)}&state=s`;
const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in', ...over,
});
const CONNECT = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: [...ACCOUNT_CAPS], stepUpFreshUntil: Date.now() + 3_600_000,
});
/** A lane with a passing check: the one shape on which the switch says the lane keeps what it has (D-7872 (10)). */
const SIGNED_IN: LaneWire = {
  state: { word: 'signed-in', source: 'checked just now' }, ready: true, check: { verdict: 'ok', at: Date.now() - 60_000 },
  identity: 'someone@example.invalid', identitySource: 'measured',
};
const onB = fleetSession({ id: 'lane-b:p-one', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'one' });
const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const storeWith = (sessions: FleetSession[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions }); });
  return store;
};

type Status = AccountAuthStatusAnswer;
function fakeBox(): { box: { status: Status }; client: { [K in keyof SwitchClient]: Mock<SwitchClient[K]> } } {
  const expiresAt = Date.now() + 7 * 60_000;
  const box = { status: { ok: true, state: 'starting', updatedAt: Date.now(), expiresAt } as Status };
  const client = {
    accountAuthStart: vi.fn<SwitchClient['accountAuthStart']>(async () => ({ ok: true as const, attemptId: ATTEMPT, expiresAt })),
    accountAuthStatus: vi.fn<SwitchClient['accountAuthStatus']>(async () => box.status),
    accountAuthCode: vi.fn<SwitchClient['accountAuthCode']>(async () => ({ ok: true as const })),
    accountAuthCancel: vi.fn<SwitchClient['accountAuthCancel']>(async () => ({ ok: true as const })),
    accountCheck: vi.fn<SwitchClient['accountCheck']>(async () => ({ ok: true as const, lane: SIGNED_IN })),
    accountSet: vi.fn<SwitchClient['accountSet']>(async (_id, body) => ({
      ok: true as const, roster: [], lane: { ...SIGNED_IN, identity: body.stated!, identitySource: 'stated' as const },
    })),
    accountSignOut: vi.fn<SwitchClient['accountSignOut']>(async () => ({ ok: true as const, signOut: 'removed' as const, lane: SIGNED_IN })),
    accountRevokeAck: vi.fn<SwitchClient['accountRevokeAck']>(async () => ({ ok: true as const })),
    stop: vi.fn<SwitchClient['stop']>(async () => undefined as never),
  };
  return { box, client };
}
type Box = ReturnType<typeof fakeBox>;

function sheet(b: Box, over: Partial<MethodSwitchSheetProps> = {}): MethodSwitchSheetProps {
  const props: MethodSwitchSheetProps = {
    id: 'lane-b', to: 'setup-token', open: true, onClose: vi.fn(), connect: CONNECT(), blocked: null,
    roster: [lane('lane-b')], lane: SIGNED_IN, refresh: vi.fn(async () => 'ok' as const), client: b.client,
    ensure: vi.fn(async () => {}), fleet: storeWith([onB]), ...over,
  };
  render(<MethodSwitchSheet {...props} />);
  return props;
}
const poll = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_POLL_MS); }); };
const settle = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const waitingCode = (b: Box, url: string): void => {
  b.box.status = { ok: true, state: 'waiting-code', url, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.status.expiresAt };
};
/** Paste the code and press Send code. */
const paste = (code: string): void => {
  fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => code } });
  fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
};

/** Start the switch, reach the code field, send the code, and let the helper say `done`. */
async function runToDone(b: Box, to: 'setup-token' | 'login'): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: SWITCH_START[to] }));
  await settle();
  waitingCode(b, URL_OF(to === 'setup-token' ? 'user:inference' : 'user:profile user:inference user:sessions:claude_code'));
  await poll();
  paste(to === 'setup-token' ? MINT_CODE : LOGIN_CODE);
  await settle();
  b.box.status = { ...b.box.status, state: 'done' };
  await poll();
  await settle();
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({
    sessions: [], conn: 'connecting', usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
});

// ── The Accounts screen: where each switch is offered ────────────────────────────────────────────────────────────

const usage = (wrapper: string, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: Math.floor(Date.now() / 1000) - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
function screenWith(roster: RosterWire[], usageRows: AccountUsage[], lanes: Record<string, LaneWire>): void {
  act(() => {
    useFleetStore.setState({
      conn: 'open', sessions: [], usage: usageRows, projected: null, roster, lanes, accountsConnect: CONNECT(),
    });
  });
  render(<><AccountsScreen /><ToastHost /></>);
}
const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane='${id}']`) as HTMLElement;

describe('where the switches are offered (spec §4.2, §4.4; Q1)', () => {
  it("a Signed-out sign-in lane's primary fix is Switch to a long-lived token", () => {
    const now = Date.now();
    const check = { verdict: 'auth-dead', at: now - 2 * 3_600_000 };
    const state = stateWordFor({
      disabled: false, authDead: true, five: 10, seven: 20, fiveResetAt: null, sevenResetAt: null, provider: 'anthropic',
      kind: 'sign-in', lane: { kind: 'read', state: { check } }, now,
    });
    expect(state.word).toBe('signed-out');
    screenWith([lane('lane-b')], [usage('lane-b', { authDead: true })], { 'lane-b': { state, check, ready: true } });
    const trouble = within(card('lane-b')).getByText(/sign-in was refused/).closest('.acct-trouble') as HTMLElement;
    // The card's first act, and its one primary.
    const acts = within(trouble).getAllByRole('button');
    expect(acts[0]).toHaveTextContent(SWITCH_TO_TOKEN);
    expect(acts[0]!.className).toMatch(/btn-primary/);
    expect(acts.filter((a) => /btn-primary/.test(a.className))).toHaveLength(1);
    fireEvent.click(acts[0]!);
    expect(screen.getByRole('dialog', { name: switchTitle('lane-b', 'setup-token') })).toBeInTheDocument();
  });

  it("a sign-in lane's fold offers Switch to a long-lived token, a token lane's Switch to sign-in", () => {
    screenWith([lane('lane-a'), lane('lane-c', { kind: 'token' })], [usage('lane-a'), usage('lane-c')], { 'lane-a': SIGNED_IN, 'lane-c': SIGNED_IN });
    const foldA = card('lane-a').querySelector('.acct-fold') as HTMLElement;
    const foldC = card('lane-c').querySelector('.acct-fold') as HTMLElement;
    expect(within(foldA).getByRole('button', { name: SWITCH_TO_TOKEN })).toBeEnabled();
    expect(within(foldA).queryByRole('button', { name: SWITCH_TO_SIGN_IN })).toBeNull();
    expect(within(foldC).getByRole('button', { name: SWITCH_TO_SIGN_IN })).toBeEnabled();
    expect(within(foldC).queryByRole('button', { name: SWITCH_TO_TOKEN })).toBeNull();
  });

  it('a cancelled switch to sign-in leaves the card as a token lane', async () => {
    const b = fakeBox();
    for (const k of Object.keys(b.client) as (keyof SwitchClient)[]) vi.spyOn(api, k).mockImplementation(b.client[k] as never);
    screenWith([lane('lane-c', { kind: 'token' })], [usage('lane-c')], { 'lane-c': SIGNED_IN });
    const fold = card('lane-c').querySelector('.acct-fold') as HTMLElement;
    fireEvent.click(within(fold).getByRole('button', { name: SWITCH_TO_SIGN_IN }));
    fireEvent.click(screen.getByRole('button', { name: SWITCH_START.login }));
    await settle();
    expect(b.client.accountAuthStart).toHaveBeenCalledWith('lane-c', { method: 'login' });
    waitingCode(b, URL_OF('user:profile user:inference user:sessions:claude_code'));
    await poll();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(b.client.accountAuthCancel).toHaveBeenCalledWith('lane-c', { attemptId: ATTEMPT });
    // What did not happen, said; nothing checked, set or signed out.
    const said = switchEnd('lane-c', 'login', 'cancelled', undefined, 'kept');
    expect(said).toContain('still uses its token');
    expect(screen.getAllByText(said).length).toBeGreaterThan(0);
    expect(b.client.accountCheck).not.toHaveBeenCalled();
    expect(b.client.accountSet).not.toHaveBeenCalled();
    expect(b.client.accountSignOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // The card is still a token lane's: its kind chip and its token acts.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(card('lane-c')).getByText('claude · token')).toBeInTheDocument();
    expect(within(card('lane-c').querySelector('.acct-fold') as HTMLElement).getByRole('button', { name: 'Replace token' })).toBeInTheDocument();
  });
});

// ── The switch sheet ─────────────────────────────────────────────────────────────────────────────────────────────

describe('Switch to a long-lived token (spec §9, N5)', () => {
  it('Sign the old sign-in out is a danger confirm while a listed session predates the switch, and a plain button after', async () => {
    const b = fakeBox();
    const props = sheet(b);
    await runToDone(b, 'setup-token');
    expect(b.client.accountAuthStart).toHaveBeenCalledWith('lane-b', { method: 'setup-token' });
    expect(b.client.accountAuthCode).toHaveBeenCalledWith('lane-b', { attemptId: ATTEMPT, code: MINT_CODE });
    // Every switch ends with a fresh check (spec §9).
    await waitFor(() => expect(b.client.accountCheck).toHaveBeenCalledWith('lane-b'));
    expect(await screen.findByText(SWITCH_CLOSE_TOKEN)).toBeInTheDocument();
    // The stated identity, with the sign-in's readable email as its default text.
    expect(screen.getByLabelText(STATED_LABEL)).toHaveValue('someone@example.invalid');

    // A session that started on the sign-in is listed: the sign-out is a danger confirm, which sends nothing yet.
    fireEvent.click(screen.getByRole('button', { name: SIGN_OLD_OUT }));
    expect(screen.getByText(signOldOutDanger(1, 'lane-b', 'kept'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SIGN_OLD_OUT_ANYWAY }).className).toMatch(/btn-danger/);
    expect(b.client.accountSignOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    // Restart it onto the token: stop, then ensure. Nothing predates the switch now, so the button is plain.
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(props.ensure).toHaveBeenCalledWith('lane-b:p-one'));
    expect(b.client.stop).toHaveBeenCalledWith('lane-b:p-one', { restart: true });
    expect(await screen.findByText('restarted')).toBeInTheDocument();
    expect(screen.queryByText(signOldOutDanger(1, 'lane-b', 'kept'))).toBeNull();
    expect(screen.queryByRole('button', { name: SIGN_OLD_OUT_ANYWAY })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SIGN_OLD_OUT }));
    await waitFor(() => expect(b.client.accountSignOut).toHaveBeenCalledWith('lane-b'));
    // G23 unmeasured: the provider's side is not claimed.
    expect(await screen.findByText(/Whether that also ended the sign-in at Anthropic is unmeasured/)).toBeInTheDocument();
  });

  it.each(FAILED_CHECKS)('a fresh check answered %s says what it found, never "Checked", and the alert says it (D-8051 (12))', async (_name, failed, line) => {
    const b = fakeBox();
    b.client.accountCheck.mockResolvedValue({ ok: true, lane: failed });
    sheet(b);
    await runToDone(b, 'setup-token');
    await waitFor(() => expect(b.client.accountCheck).toHaveBeenCalledWith('lane-b'));
    await waitFor(() => expect(document.querySelector('.acct-ledger')).toHaveTextContent(line));
    expect(document.querySelector('.acct-ledger')).not.toHaveTextContent(LEDGER.checked);
    await waitFor(() => expect(screen.getByTestId('switch-alert')).toHaveTextContent(line));
  });

  it('a probe that passed over a seed that refused says Not ready, and the alert says it (D-8051 (18))', async () => {
    const b = fakeBox();
    b.client.accountCheck.mockResolvedValue({ ok: true, lane: SEED_UNVERIFIED });
    sheet(b);
    await runToDone(b, 'setup-token');
    await waitFor(() => expect(document.querySelector('.acct-ledger')).toHaveTextContent(SEED_UNVERIFIED_LINE));
    expect(document.querySelector('.acct-ledger')).not.toHaveTextContent(LEDGER.checked);
    await waitFor(() => expect(screen.getByTestId('switch-alert')).toHaveTextContent(SEED_UNVERIFIED_LINE));
  });

  it('with no session on the lane, the sign-out is a plain button from the start', async () => {
    const b = fakeBox();
    sheet(b, { fleet: storeWith([]) });
    await runToDone(b, 'setup-token');
    await screen.findByText(SWITCH_CLOSE_TOKEN);
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SIGN_OLD_OUT }));
    await waitFor(() => expect(b.client.accountSignOut).toHaveBeenCalledTimes(1));
  });

  it('a refused mint changes nothing and says so', async () => {
    const b = fakeBox();
    sheet(b);
    fireEvent.click(screen.getByRole('button', { name: SWITCH_START['setup-token'] }));
    await settle();
    waitingCode(b, URL_OF('user:inference'));
    await poll();
    paste(MINT_CODE);
    await settle();
    b.box.status = { ...b.box.status, state: 'failed' };
    await poll();
    expect(screen.getAllByText(switchEnd('lane-b', 'setup-token', 'code-refused', undefined, 'kept')).length).toBeGreaterThan(0);
    expect(switchEnd('lane-b', 'setup-token', 'code-refused', undefined, 'kept')).toContain('still uses its sign-in');
    expect(b.client.accountCheck).not.toHaveBeenCalled();
    expect(b.client.accountSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  });
});

describe('Switch to sign-in (spec §9)', () => {
  it('ends with the sessions to restart and the revoke item for the old token', async () => {
    const b = fakeBox();
    sheet(b, { to: 'login', roster: [lane('lane-b', { kind: 'token' })], lane: { ...SIGNED_IN, identity: undefined } });
    await runToDone(b, 'login');
    expect(b.client.accountAuthStart).toHaveBeenCalledWith('lane-b', { method: 'login' });
    await waitFor(() => expect(b.client.accountCheck).toHaveBeenCalledWith('lane-b'));
    expect(await screen.findByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    // No sign-out step and no stated identity: the lane now reads its own account.
    expect(screen.queryByRole('button', { name: SIGN_OLD_OUT })).toBeNull();
    expect(screen.queryByLabelText(STATED_LABEL)).toBeNull();
  });
});

describe('resume (spec §6.2)', () => {
  it('opened with a held attempt, the sheet starts nothing and offers its code field', async () => {
    const b = fakeBox();
    waitingCode(b, URL_OF('user:inference'));
    sheet(b, { resume: { attemptId: ATTEMPT, method: 'setup-token', expiresAt: b.box.status.expiresAt } });
    await settle();
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(b.client.accountAuthStart).not.toHaveBeenCalled();
    paste(MINT_CODE);
    await settle();
    expect(b.client.accountAuthCode).toHaveBeenCalledWith('lane-b', { attemptId: ATTEMPT, code: MINT_CODE });
  });
});
