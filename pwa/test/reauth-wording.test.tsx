// What an account sheet may say about a lane's old credential (accounts plan Task A38, D-7872 (10): the operator's
// option-1 ruling of 2026-11-03). After a sign-out the box clears the lane's check and nothing else, and the server never
// reports `no-credential`, so a signed-out lane reads like one never checked. One rule decides (`oldCredentialOf`):
// "keeps its old sign-in/token" only on a lane with a passing check newer than any sign-out this app knows of; "signed
// out on the fleet host" only where that is certain (the box's own word, or the sheet that just ran the sign-out); and
// neutral words, true either way, everywhere else. Each sheet that speaks of the old credential is held to it here:
// the re-auth sheet (intro, endings, refused starts), the method switch sheet (intro, endings, the both-held line) and
// the connect sheet's Sign this lane out and start again, whose sign-out the later sheets must know of.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ACCOUNT_CAPS, type AccountAuthStatusAnswer, type AccountsConnect, type AccountUsage, type LaneWire, type RosterWire,
} from '../../shared/api';
import { AUTH_POLL_MS, ConnectSheet, type ConnectClient, type SignInClient } from '../src/accounts/ConnectSheet';
import { MethodSwitchSheet, type MethodSwitchSheetProps, type SwitchClient } from '../src/accounts/MethodSwitchSheet';
import { ReauthSheet, type ReauthClient, type ReauthSheetProps } from '../src/accounts/ReauthSheet';
import { oldCredentialOf } from '../src/accounts/connectFlow';
import { noteSignOut, resetSignOutsForTests, signOutOf } from '../src/accounts/signOuts';
import {
  CANCEL_SIGN_IN, CODE_FIELD_LABEL, MINT_NEW_TOKEN, NOTHING_INSTALLED, SEND_CODE, SIGN_OUT_RESTART, SWITCH_START,
  bothHeld, credentialUntouched, laneSignedOut, noCheckedCredential, reauthEnd, reauthIntro, reauthStartRefusal,
  switchEnd, switchIntro, type OldCredential, type SignInEndKind,
} from '../src/fleet/accountWords';
import { ApiError } from '../src/lib/api';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';

const now = Date.now();
const ATTEMPT = 'e'.repeat(32);
const LOGIN_CODE = 'A'.repeat(48) + '#' + 'b'.repeat(43);
const MINT_CODE = 'Q'.repeat(30);
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=s';
const rosterRow = (id: string, kind: RosterWire['kind']): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind,
});
const ROSTER: RosterWire[] = [rosterRow('lane-a', 'sign-in'), rosterRow('lane-b', 'token')];
const CONNECT = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: [...ACCOUNT_CAPS], stepUpFreshUntil: Date.now() + 3_600_000,
});
const usageOf = (wrapper: string, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: Math.floor(now / 1000) - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

/** A lane with a passing check `at`: the one shape on which a sheet may say the lane keeps what it has. */
const CHECK_AT = now - 60_000;
const FRESH: LaneWire = {
  state: { word: 'signed-in', source: 'checked a minute ago', at: CHECK_AT }, ready: true, check: { verdict: 'ok', at: CHECK_AT },
  identity: 'someone@example.invalid', identitySource: 'measured',
};
/** Never checked, or checked once and cleared by a sign-out on the box: the wire cannot tell these apart. */
const UNCHECKED: LaneWire = {
  state: { word: 'not-checked', source: 'no check recorded yet' }, ready: false, notReadyReason: 'not-checked',
  identity: 'someone@example.invalid', identitySource: 'measured',
};
/** The box's own word for a lane with no credential. */
const NONE: LaneWire = { state: { word: 'not-checked', source: 'no check recorded yet' }, ready: false, notReadyReason: 'no-credential' };

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const storeWith = (): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions: [], roster: ROSTER, usage: [] }); });
  return store;
};
const poll = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_POLL_MS); }); };
const settle = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

type Status = AccountAuthStatusAnswer;
/** One fake box for the re-auth and the switch sheets (their routes are the same set). */
function fakeBox(checked: LaneWire = FRESH): {
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
    accountSignOut: vi.fn<ReauthClient['accountSignOut']>(async () => ({ ok: true as const, signOut: 'removed' as const, lane: UNCHECKED })),
    accountRevokeAck: vi.fn<ReauthClient['accountRevokeAck']>(async () => ({ ok: true as const })),
    stop: vi.fn<ReauthClient['stop']>(async () => undefined as never),
  };
  return { box, client };
}
type Box = ReturnType<typeof fakeBox>;

const reauth = (b: Box, over: Partial<ReauthSheetProps> = {}): void => {
  const props: ReauthSheetProps = {
    id: 'lane-a', method: 'login', open: true, onClose: vi.fn(), connect: CONNECT(), blocked: null, lane: FRESH,
    usage: usageOf('lane-a'), roster: ROSTER, refresh: vi.fn(async () => 'ok' as const), client: b.client,
    ensure: vi.fn(async () => {}), fleet: storeWith(), ...over,
  };
  render(<ReauthSheet {...props} />);
};
const switcher = (b: Box, over: Partial<MethodSwitchSheetProps> = {}): void => {
  const props: MethodSwitchSheetProps = {
    id: 'lane-a', to: 'setup-token', open: true, onClose: vi.fn(), connect: CONNECT(), blocked: null, roster: ROSTER,
    lane: FRESH, usage: usageOf('lane-a'), refresh: vi.fn(async () => 'ok' as const), client: b.client as SwitchClient,
    ensure: vi.fn(async () => {}), fleet: storeWith(), ...over,
  };
  render(<MethodSwitchSheet {...props} />);
};
const text = (): string => document.body.textContent ?? '';
const alertOf = (sheet: 'reauth' | 'switch' | 'connect'): string => screen.getByTestId(`${sheet}-alert`).textContent ?? '';
/** No sentence on screen claims the lane still holds its old credential. */
const claimsNothing = (): void => {
  expect(text()).not.toMatch(/keeps (its|the) (old )?(sign-in|token)|keeps its old|Nothing changed|still uses its|holds both|was not replaced/);
};

/** Start, then Cancel: the ending a cancelled attempt says. */
async function startThenCancel(b: Box, primary: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: primary }));
  await settle();
  fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
  await waitFor(() => expect(b.client.accountAuthCancel).toHaveBeenCalled());
  await settle();
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => {
  cleanup();
  resetSignOutsForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => useFleetStore.setState({ roster: [], lanes: null, accountsConnect: null }));
});

// ── The rule ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the rule: keeps only behind a passing check newer than any known sign-out (D-7872 (10))', () => {
  it('a fresh passing check keeps; no check, a failed check or a 401 is neutral; the box\'s no-credential is signed out', () => {
    expect(oldCredentialOf(FRESH, usageOf('lane-a'), undefined)).toBe('kept');
    expect(oldCredentialOf(FRESH, null, undefined)).toBe('kept');
    expect(oldCredentialOf(UNCHECKED, usageOf('lane-a'), undefined)).toBe('unsure');
    expect(oldCredentialOf(undefined, undefined, undefined)).toBe('unsure');
    expect(oldCredentialOf({ ...FRESH, check: { verdict: 'auth-dead', at: CHECK_AT } }, null, undefined)).toBe('unsure');
    // Signed out elsewhere: the provider refused it after the check passed (ccd's 401 marker).
    expect(oldCredentialOf(FRESH, usageOf('lane-a', { authDead: true }), undefined)).toBe('unsure');
    expect(oldCredentialOf(NONE, null, undefined)).toBe('signed-out');
    expect(oldCredentialOf({ ...FRESH, notReadyReason: 'no-credential' }, null, undefined)).toBe('signed-out');
  });

  it('a sign-out this app knows of: neutral until a newer passing check; signed out only in the sheet that ran it', () => {
    // The lane as last read before the sign-out still holds that check: it is no evidence the credential is there.
    expect(oldCredentialOf(FRESH, null, { checkAt: CHECK_AT })).toBe('unsure');
    expect(oldCredentialOf(FRESH, null, { checkAt: CHECK_AT - 1 })).toBe('kept');
    expect(oldCredentialOf({ ...FRESH, check: { verdict: 'ok', at: CHECK_AT + 1 } }, null, { checkAt: CHECK_AT })).toBe('kept');
    expect(oldCredentialOf(UNCHECKED, null, {})).toBe('unsure');
    expect(oldCredentialOf(FRESH, null, {})).toBe('kept');
    // Certain only where the sheet itself just had the box's answer.
    expect(oldCredentialOf(FRESH, null, { checkAt: CHECK_AT }, true)).toBe('signed-out');
    expect(oldCredentialOf(FRESH, null, undefined, true)).toBe('signed-out');
  });

  it('every word built on it: kept says the lane keeps it, signed-out says signed out, unsure neither', () => {
    const kinds: SignInEndKind[] = ['expired', 'code-refused', 'untrusted', 'cancelled', 'unknown', 'lost', 'node-changed', 'failed'];
    for (const method of ['login', 'setup-token'] as const) {
      const cred = method === 'login' ? 'sign-in' : 'token';
      expect(reauthIntro('lane-a', method, 'kept')).toMatch(new RegExp(`keeps the ${cred} it has`));
      expect(reauthIntro('lane-a', method, 'unsure')).toContain(noCheckedCredential('lane-a', cred));
      expect(reauthIntro('lane-a', method, 'signed-out')).toContain(laneSignedOut('lane-a'));
      for (const s of ['unsure', 'signed-out'] as OldCredential[]) {
        expect(reauthIntro('lane-a', method, s)).not.toMatch(/keeps/);
        for (const k of kinds) expect(reauthEnd('lane-a', method, k, undefined, s)).not.toMatch(/keeps|Nothing changed|was not replaced|which credential/);
        expect(reauthStartRefusal('lane-a', method, 'lane-busy', undefined, s)).not.toContain(credentialUntouched('lane-a', method));
      }
      for (const k of kinds) {
        if (k !== 'lost') expect(reauthEnd('lane-a', method, k, undefined, 'unsure')).toContain(k === 'unknown' ? 'Nothing was installed here.' : NOTHING_INSTALLED);
        if (k !== 'lost' && k !== 'unknown') expect(reauthEnd('lane-a', method, k, undefined, 'kept')).toContain(credentialUntouched('lane-a', method));
      }
      expect(reauthStartRefusal('lane-a', method, 'lane-busy', undefined, 'unsure')).toContain(NOTHING_INSTALLED);
    }
    for (const to of ['setup-token', 'login'] as const) {
      const from = to === 'setup-token' ? 'sign-in' : 'token';
      expect(switchIntro('lane-a', to, 'kept')).toMatch(/keeps its/);
      expect(switchIntro('lane-a', to, 'unsure')).toContain(noCheckedCredential('lane-a', from));
      expect(switchIntro('lane-a', to, 'signed-out')).toContain(laneSignedOut('lane-a'));
      for (const s of ['unsure', 'signed-out'] as OldCredential[]) {
        expect(switchIntro('lane-a', to, s)).not.toMatch(/keeps/);
        for (const k of kinds) expect(switchEnd('lane-a', to, k, undefined, s)).not.toMatch(/still uses|Nothing changed|which credential/);
      }
      for (const k of kinds) if (k !== 'lost') expect(switchEnd('lane-a', to, k, undefined, 'kept')).toContain(`still uses its ${from}`);
    }
    expect(bothHeld('lane-a', 'kept')).toMatch(/holds both/);
    expect(bothHeld('lane-a', 'unsure')).not.toMatch(/holds both/);
    expect(bothHeld('lane-a', 'signed-out')).not.toMatch(/holds both/);
  });
});

// ── The re-auth sheet ──────────────────────────────────────────────────────────────────────────────────────────────

describe('the re-auth sheet follows the rule (D-7872 (10))', () => {
  const cases = [['lane-a', 'login', 'Start the sign-in'], ['lane-b', 'setup-token', MINT_NEW_TOKEN]] as const;

  for (const [id, method, primary] of cases) {
    it(`${method}: a fresh lane with a passing check says it keeps what it has, in the intro and the ending`, async () => {
      const b = fakeBox();
      reauth(b, { id, method, usage: usageOf(id) });
      expect(screen.getByText(reauthIntro(id, method, 'kept'))).toBeInTheDocument();
      await startThenCancel(b, primary);
      expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'kept'));
      expect(alertOf('reauth')).toContain(credentialUntouched(id, method));
    });

    it(`${method}: a never-checked lane gets the neutral words, in the intro, a cancel and a refused start`, async () => {
      const b = fakeBox();
      reauth(b, { id, method, lane: UNCHECKED, usage: usageOf(id) });
      expect(screen.getByText(reauthIntro(id, method, 'unsure'))).toBeInTheDocument();
      claimsNothing();
      await startThenCancel(b, primary);
      expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'unsure'));
      expect(alertOf('reauth')).toContain(NOTHING_INSTALLED);
      b.client.accountAuthStart.mockRejectedValueOnce(new ApiError(409, { error: 'lane-busy' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
      await settle();
      expect(alertOf('reauth')).toBe(reauthStartRefusal(id, method, 'lane-busy', undefined, 'unsure'));
      claimsNothing();
    });

    it(`${method}: a lane signed out elsewhere (a 401 after its passing check, or its check cleared) is neutral`, async () => {
      const b = fakeBox();
      reauth(b, { id, method, lane: FRESH, usage: usageOf(id, { authDead: true }) });
      expect(screen.getByText(reauthIntro(id, method, 'unsure'))).toBeInTheDocument();
      await startThenCancel(b, primary);
      expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'unsure'));
      claimsNothing();
      cleanup();
      const c = fakeBox();
      reauth(c, { id, method, lane: { ...UNCHECKED, state: { word: 'signed-out', source: 'HTTP 401' } }, usage: usageOf(id, { authDead: true }) });
      expect(screen.getByText(reauthIntro(id, method, 'unsure'))).toBeInTheDocument();
      claimsNothing();
    });
  }

  /** Sign in again reads back another account; Sign this lane out and start again signs it out and starts anew. */
  async function signedOutHere(b: Box): Promise<void> {
    reauth(b, { lane: FRESH });
    fireEvent.click(screen.getByRole('button', { name: 'Start the sign-in' }));
    await settle();
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => LOGIN_CODE } });
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    b.box.status = { ok: true, state: 'done', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    await settle();
    expect(await screen.findByText('Signed in as other@example.invalid')).toBeInTheDocument();
    b.box.status = { ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    fireEvent.click(await screen.findByRole('button', { name: SIGN_OUT_RESTART }));
    await waitFor(() => expect(b.client.accountAuthStart).toHaveBeenCalledTimes(2));
    await settle();
  }
  const OTHER: LaneWire = { ...FRESH, check: { verdict: 'ok', at: CHECK_AT + 5_000 }, identity: 'other@example.invalid' };

  it('after a sign-out in this sheet, its endings say the lane is signed out on the fleet host', async () => {
    const b = fakeBox(OTHER);
    await signedOutHere(b);
    fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(alertOf('reauth')).toBe(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'signed-out'));
    expect(alertOf('reauth')).toContain(laneSignedOut('lane-a'));
    expect(signOutOf('lane-a')).toEqual({ checkAt: OTHER.check!.at });
  });

  it('resumed after the sheet unmounts, on the lane as last read or as read again: neutral, never keeps', async () => {
    const b = fakeBox(OTHER);
    await signedOutHere(b);
    cleanup();
    const resume = { attemptId: ATTEMPT, method: 'login' as const, expiresAt: b.box.expiresAt };
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    // The screen has not read the lanes again: the lane still shows the check from before the sign-out.
    reauth(b, { lane: OTHER, resume });
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(alertOf('reauth')).toBe(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'unsure'));
    claimsNothing();
    cleanup();
    // Read again: the box cleared the check with the sign-in.
    reauth(b, { lane: UNCHECKED, resume });
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(alertOf('reauth')).toBe(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'unsure'));
    claimsNothing();
    cleanup();
    // Sign in again opened later on the stale lane: neutral too, until a passing check newer than the sign-out.
    reauth(b, { lane: OTHER });
    expect(screen.getByText(reauthIntro('lane-a', 'login', 'unsure'))).toBeInTheDocument();
    cleanup();
    reauth(b, { lane: { ...OTHER, check: { verdict: 'ok', at: OTHER.check!.at + 1 } } });
    expect(screen.getByText(reauthIntro('lane-a', 'login', 'kept'))).toBeInTheDocument();
    expect(signOutOf('lane-a')).toBeUndefined();
  });

  it('resumed after a reload (the app forgot its sign-outs): neutral, never keeps', async () => {
    const b = fakeBox(OTHER);
    await signedOutHere(b);
    cleanup();
    resetSignOutsForTests();
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    reauth(b, { lane: UNCHECKED, resume: { attemptId: ATTEMPT, method: 'login', expiresAt: b.box.expiresAt } });
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(alertOf('reauth')).toBe(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'unsure'));
    claimsNothing();
  });
});

// ── The method switch sheet ────────────────────────────────────────────────────────────────────────────────────────

describe('the method switch sheet follows the rule (D-7872 (10))', () => {
  /** The switch to a token, run to its ending: the line about the old sign-in. */
  async function switchedToToken(b: Box): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: SWITCH_START['setup-token'] }));
    await settle();
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => MINT_CODE } });
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    b.box.status = { ok: true, state: 'done', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    await settle();
    await waitFor(() => expect(b.client.accountCheck).toHaveBeenCalled());
  }

  it('a fresh lane with a passing check: the intro, a cancel and the both-held line say it keeps its sign-in', async () => {
    const b = fakeBox();
    switcher(b);
    expect(screen.getByText(switchIntro('lane-a', 'setup-token', 'kept'))).toBeInTheDocument();
    await startThenCancel(b, SWITCH_START['setup-token']);
    expect(alertOf('switch')).toBe(switchEnd('lane-a', 'setup-token', 'cancelled', undefined, 'kept'));
    cleanup();
    const c = fakeBox();
    switcher(c);
    await switchedToToken(c);
    expect(await screen.findByText(bothHeld('lane-a', 'kept'))).toBeInTheDocument();
  });

  it('a never-checked lane: neutral in the intro, a cancel and the both-held line', async () => {
    const b = fakeBox();
    switcher(b, { lane: UNCHECKED });
    expect(screen.getByText(switchIntro('lane-a', 'setup-token', 'unsure'))).toBeInTheDocument();
    claimsNothing();
    await startThenCancel(b, SWITCH_START['setup-token']);
    expect(alertOf('switch')).toBe(switchEnd('lane-a', 'setup-token', 'cancelled', undefined, 'unsure'));
    claimsNothing();
    cleanup();
    const c = fakeBox();
    switcher(c, { lane: UNCHECKED });
    await switchedToToken(c);
    expect(await screen.findByText(bothHeld('lane-a', 'unsure'))).toBeInTheDocument();
    claimsNothing();
  });

  it('the Signed-out card\'s primary (a 401 after the passing check), and a token lane signed out elsewhere: neutral', async () => {
    const b = fakeBox();
    switcher(b, { usage: usageOf('lane-a', { authDead: true }) });
    expect(screen.getByText(switchIntro('lane-a', 'setup-token', 'unsure'))).toBeInTheDocument();
    claimsNothing();
    cleanup();
    const c = fakeBox();
    switcher(c, { id: 'lane-b', to: 'login', lane: UNCHECKED, usage: usageOf('lane-b', { authDead: true }) });
    expect(screen.getByText(switchIntro('lane-b', 'login', 'unsure'))).toBeInTheDocument();
    await startThenCancel(c, SWITCH_START.login);
    expect(alertOf('switch')).toBe(switchEnd('lane-b', 'login', 'cancelled', undefined, 'unsure'));
    claimsNothing();
  });

  it('after a sign-out this app ran, on the lane as last read: neutral; the box\'s no-credential: signed out', async () => {
    noteSignOut('lane-a', CHECK_AT);
    const b = fakeBox();
    switcher(b, { lane: FRESH });
    expect(screen.getByText(switchIntro('lane-a', 'setup-token', 'unsure'))).toBeInTheDocument();
    claimsNothing();
    cleanup();
    const c = fakeBox();
    switcher(c, { lane: NONE });
    expect(screen.getByText(switchIntro('lane-a', 'setup-token', 'signed-out'))).toBeInTheDocument();
    await startThenCancel(c, SWITCH_START['setup-token']);
    expect(alertOf('switch')).toBe(switchEnd('lane-a', 'setup-token', 'cancelled', undefined, 'signed-out'));
    claimsNothing();
  });
});

// ── The connect sheet's Sign this lane out and start again ─────────────────────────────────────────────────────────

describe("the connect sheet's sign-out is one the later sheets know of (D-7872 (10))", () => {
  it('signed out there, a re-auth opened later on the lane as last read is neutral, never keeps', async () => {
    const CHECKED: LaneWire = { ...FRESH, identity: 'someone@example.invalid' };
    const NEW: LaneWire = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
    const expiresAt = Date.now() + 7 * 60_000;
    let status: Status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: 0, expiresAt };
    const client = {
      accountAdd: vi.fn<ConnectClient['accountAdd']>(async () => ({ ok: true as const, roster: ROSTER, lane: NEW, fleetIdentity: null })),
      accountCheck: vi.fn<ConnectClient['accountCheck']>(async () => ({ ok: true as const, lane: CHECKED })),
      accountEnable: vi.fn<ConnectClient['accountEnable']>(async () => ({ ok: true as const, roster: ROSTER, lane: CHECKED })),
    };
    const sc = {
      accountAuthStart: vi.fn<SignInClient['accountAuthStart']>(async () => ({ ok: true as const, attemptId: ATTEMPT, expiresAt })),
      accountAuthStatus: vi.fn<SignInClient['accountAuthStatus']>(async () => status),
      accountAuthCode: vi.fn<SignInClient['accountAuthCode']>(async () => ({ ok: true as const })),
      accountAuthCancel: vi.fn<SignInClient['accountAuthCancel']>(async () => ({ ok: true as const })),
      accountSet: vi.fn<SignInClient['accountSet']>(async () => ({ ok: true as const, roster: ROSTER, lane: CHECKED })),
      accountSignOut: vi.fn<SignInClient['accountSignOut']>(async () => ({ ok: true as const, signOut: 'removed' as const, lane: NEW })),
      accountRemove: vi.fn<SignInClient['accountRemove']>(async () => ({ ok: true as const, roster: ROSTER, removed: [], kept: [], rehomed: [], atProvider: [] })),
    };
    render(
      <ConnectSheet
        open onClose={vi.fn()} roster={ROSTER} connect={CONNECT()} offline={null} refresh={vi.fn(async () => 'ok' as const)}
        readRoster={() => ROSTER} client={client} signInClient={sc}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'lane-c' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lane C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('radio', { name: /Sign in with Claude/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
    await settle();
    await settle();
    fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => LOGIN_CODE } });
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    status = { ok: true, state: 'done', updatedAt: 0, expiresAt };
    await poll();
    await settle();
    expect(await screen.findByText('Signed in as someone@example.invalid')).toBeInTheDocument();
    status = { ok: true, state: 'starting', updatedAt: 0, expiresAt };
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    fireEvent.click(screen.getAllByRole('button', { name: SIGN_OUT_RESTART }).at(-1)!);
    await settle();
    expect(sc.accountSignOut).toHaveBeenCalledWith('lane-c');
    expect(signOutOf('lane-c')).toEqual({ checkAt: CHECK_AT });
    cleanup();
    // A re-auth (or a switch) opened later on the lane the screen read before the sign-out.
    const b = fakeBox();
    reauth(b, { id: 'lane-c', lane: CHECKED, usage: usageOf('lane-c') });
    expect(screen.getByText(reauthIntro('lane-c', 'login', 'unsure'))).toBeInTheDocument();
    claimsNothing();
  });
});
