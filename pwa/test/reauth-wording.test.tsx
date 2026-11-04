// What an account sheet may say about a lane's old credential (accounts plan Task A38, D-7872 (10): the operator's
// option-1 ruling of 2026-11-03). After a sign-out the box clears the lane's check and nothing else, and the server never
// reports `no-credential`, so a signed-out lane reads like one never checked. One rule decides (`oldCredentialOf`):
// "keeps its old sign-in/token" only on a lane with a passing check newer than any sign-out this app knows of; "signed
// out on the fleet host" only where that is certain (the box's own word, or the sheet that just ran the sign-out); and
// neutral words, true either way, everywhere else. Each sheet that speaks of the old credential is held to it here:
// the re-auth sheet (intro, endings, refused starts, the mint's restart and revoke lines), the method switch sheet (intro,
// endings, the both-held line, the restart lead and the danger confirm) and the connect sheet's Sign this lane out and
// start again, whose sign-out the later sheets must know of. A19's paste sheet is held to it in `replace-token.test.tsx`.
// The answer is read when a sentence is written, from the lane as the screen holds it then, and moves only away from
// `kept` (`useOldCredential`).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ACCOUNT_CAPS, type AccountAuthStatusAnswer, type AccountsConnect, type AccountUsage, type FleetSession, type LaneWire,
  type RosterWire,
} from '../../shared/api';
import { AUTH_POLL_MS, ConnectSheet, type ConnectClient, type SignInClient } from '../src/accounts/ConnectSheet';
import { MethodSwitchSheet, type MethodSwitchSheetProps, type SwitchClient } from '../src/accounts/MethodSwitchSheet';
import { ReauthSheet, type ReauthClient, type ReauthSheetProps } from '../src/accounts/ReauthSheet';
import { oldCredentialOf } from '../src/accounts/connectFlow';
import { noteSignOut, resetSignOutsForTests, signOutOf } from '../src/accounts/signOuts';
import {
  CANCEL_SIGN_IN, CODE_FIELD_LABEL, MINT_NEW_TOKEN, NOTHING_INSTALLED, SEND_CODE, SIGN_OLD_OUT, SIGN_OUT_RESTART, SWITCH_START,
  bothHeld, credentialUntouched, laneSignedOut, noCheckedCredential, reauthEnd, reauthIntro, reauthRestartLead,
  reauthStartRefusal, restartLead, revokeOldWords, revokeRecord, signInStartRefusal, signOldOutDanger, signOldOutRefused,
  signOutRefused, signOutUnknown, switchEnd, switchIntro, switchRestartLead, type OldCredential, type SignInEndKind,
} from '../src/fleet/accountWords';
import { ApiError } from '../src/lib/api';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

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

/** The ways a sign-out's answer goes missing: the box may have signed the lane out, so none is a refusal. The second is
 *  the route's own word (`routeOutcomeOf` on a timeout, a lost answer or an output past its cap, and the sign-out route
 *  on stdout it cannot read), as the client delivers it. The last two are its `lane-act-refused`: the verb's report
 *  failed after it removed the credential ("Lane was signed out; only this report failed", verb code `no-answer`), or a
 *  killed verb left no envelope, so the code is gone. */
const UNKNOWN_ANSWERS: ReadonlyArray<readonly [string, () => unknown]> = [
  ['the request never completes', () => new TypeError('Failed to fetch')],
  ['the route answers outcome-unknown', () => new ApiError(502, { ok: false, error: 'outcome-unknown' })],
  ['the verb signed the lane out and its report failed', () => new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'no-answer' })],
  ['the verb was killed', () => new ApiError(409, { ok: false, error: 'lane-act-refused' })],
];

/** A session live on each lane: the ones an ending lists to restart. */
const ON_A = fleetSession({ id: 'lane-a:p-one', wrapper: 'lane-a', home: 'lane-a', project: 'p-one', title: 'one' });
const ON_B = fleetSession({ id: 'lane-b:p-one', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'one' });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const storeWith = (sessions: FleetSession[] = []): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster: ROSTER, usage: [] }); });
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

/** Each draws the sheet and answers how to hand it a newer read of the lane while it stays open. */
const reauth = (b: Box, over: Partial<ReauthSheetProps> = {}): ((next: Partial<ReauthSheetProps>) => void) => {
  const props: ReauthSheetProps = {
    id: 'lane-a', method: 'login', open: true, onClose: vi.fn(), connect: CONNECT(), blocked: null, lane: FRESH,
    usage: usageOf('lane-a'), roster: ROSTER, refresh: vi.fn(async () => 'ok' as const), client: b.client,
    ensure: vi.fn(async () => {}), fleet: storeWith(), ...over,
  };
  const drawn = render(<ReauthSheet {...props} />);
  return (next) => drawn.rerender(<ReauthSheet {...props} {...next} />);
};
const switcher = (b: Box, over: Partial<MethodSwitchSheetProps> = {}): ((next: Partial<MethodSwitchSheetProps>) => void) => {
  const props: MethodSwitchSheetProps = {
    id: 'lane-a', to: 'setup-token', open: true, onClose: vi.fn(), connect: CONNECT(), blocked: null, roster: ROSTER,
    lane: FRESH, usage: usageOf('lane-a'), refresh: vi.fn(async () => 'ok' as const), client: b.client as SwitchClient,
    ensure: vi.fn(async () => {}), fleet: storeWith(), ...over,
  };
  const drawn = render(<MethodSwitchSheet {...props} />);
  return (next) => drawn.rerender(<MethodSwitchSheet {...props} {...next} />);
};
const text = (): string => document.body.textContent ?? '';
const alertOf = (sheet: 'reauth' | 'switch' | 'connect'): string => screen.getByTestId(`${sheet}-alert`).textContent ?? '';
/** No sentence on screen claims the lane still holds its old credential. */
const claimsNothing = (): void => {
  expect(text()).not.toMatch(/keeps? (its|the) (old )?(credential|sign-in|token)|keeps its old|Nothing changed|still uses? (its|the sign-in)|holds both|was not replaced|Revoke the old token|I revoked the old token|Record: old token/);
};

/** Start, then the code, then `done`: the ending of an attempt that installed its credential. */
async function ranToDone(b: Box, primary: string, code: string): Promise<void> {
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
  await waitFor(() => expect(b.client.accountCheck).toHaveBeenCalled());
  await settle();
}

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

  it('a sign-out with no answer, the route\'s outcome-unknown and lane-act-refused among them, is never worded as a refusal', () => {
    for (const word of [undefined, 'outcome-unknown', 'lane-act-refused', 'Not a word']) {
      expect(signOutUnknown(word)).toBe(true);
      expect(signOutRefused('lane-a', word)).toBe(signOutRefused('lane-a', undefined));
      expect(signOutRefused('lane-a', word)).toMatch(/is unknown/);
      expect(signOutRefused('lane-a', word)).not.toMatch(/was not signed out|refused/);
      expect(signOldOutRefused('lane-a', word)).toBe(signOldOutRefused('lane-a', undefined));
      expect(signOldOutRefused('lane-a', word)).toMatch(/is unknown/);
      expect(signOldOutRefused('lane-a', word)).not.toMatch(/was not signed out|refused/);
    }
    expect(signOutUnknown('lane-busy')).toBe(false);
    expect(signOutRefused('lane-a', 'lane-busy')).toMatch(/refused \(lane-busy\): lane-a was not signed out/);
    expect(signOldOutRefused('lane-a', 'lane-busy')).toMatch(/refused \(lane-busy\): lane-a's old sign-in was not signed out/);
  });

  it('the leads and the danger confirm name the old credential only on kept, in the singular and the plural', () => {
    expect(switchRestartLead(1, 'kept')).toBe('1 session on this lane still uses the sign-in until it restarts.');
    expect(switchRestartLead(2, 'kept')).toBe('2 sessions on this lane still use the sign-in until they restart.');
    expect(signOldOutDanger(1, 'lane-a', 'kept')).toBe('1 session on lane-a still uses the sign-in and may fail its next turn.');
    expect(signOldOutDanger(2, 'lane-a', 'kept')).toBe('2 sessions on lane-a still use the sign-in and may fail their next turn.');
    expect(restartLead(1, 'kept')).toBe('1 session on this lane keeps the old token until it restarts.');
    expect(reauthRestartLead(2, 'setup-token', 'kept')).toBe('2 sessions on this lane keep the old credential until they restart.');
    for (const s of ['unsure', 'signed-out'] as OldCredential[]) {
      for (const lead of [switchRestartLead, restartLead, (n: number, o: OldCredential) => reauthRestartLead(n, 'setup-token', o)]) {
        expect(lead(1, s)).toBe('1 session on this lane started before this change. Restart it to run on the new credential.');
        expect(lead(2, s)).toBe('2 sessions on this lane started before this change. Restart them to run on the new credential.');
      }
      expect(signOldOutDanger(1, 'lane-a', s)).toBe('1 session on lane-a started before this change. If it still uses the old sign-in, it may fail its next turn.');
      expect(signOldOutDanger(2, 'lane-a', s)).toBe('2 sessions on lane-a started before this change. If they still use the old sign-in, they may fail their next turn.');
    }
    // A sign-in is read at the next request: that lead names no old credential, whatever the lane holds.
    for (const s of ['kept', 'unsure', 'signed-out'] as OldCredential[]) expect(reauthRestartLead(1, 'login', s)).toMatch(/picks up the new sign-in/);
  });

  it('the revoke item names the old token only on kept; elsewhere it asks about any old token', () => {
    const kept = revokeOldWords('lane-a', 'kept');
    expect([kept.lead, kept.label, kept.old]).toEqual(['Revoke the old token at', 'I revoked the old token', true]);
    for (const s of ['unsure', 'signed-out'] as OldCredential[]) {
      const w = revokeOldWords('lane-a', s);
      expect([w.lead, w.label, w.old]).toEqual(['If lane-a had an old token, revoke it at', 'I revoked any old token', 'any']);
      expect(w.tail).toBe(kept.tail);
    }
    expect(revokeRecord(false, 'any')).toBe('Record: any old token not marked revoked.');
    expect(revokeRecord(true, 'any')).toBe('Record: any old token marked revoked.');
    expect(revokeRecord(false, true)).toBe('Record: old token not marked revoked.');
    expect(revokeRecord(true, false)).toBe('Record: token marked revoked.');
  });

  it('a start refused not-found says the roster sentence alone: the lane has left, and its credential with it', () => {
    for (const method of ['login', 'setup-token'] as const) {
      for (const s of ['kept', 'unsure', 'signed-out'] as OldCredential[]) {
        expect(reauthStartRefusal('lane-a', method, 'not-found', undefined, s)).toBe(signInStartRefusal('lane-a', 'not-found', undefined));
      }
    }
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

    it(`${method}: the lane left the roster, on the Confirm frame or a terminal one: the refused start says only that`, async () => {
      const gone = signInStartRefusal(id, 'not-found', undefined);
      const b = fakeBox();
      b.client.accountAuthStart.mockRejectedValueOnce(new ApiError(404, { ok: false, error: 'not-found' }));
      reauth(b, { id, method, usage: usageOf(id) });
      expect(screen.getByText(reauthIntro(id, method, 'kept'))).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: primary }));
      await settle();
      expect(alertOf('reauth')).toBe(gone);
      claimsNothing();
      cleanup();
      const c = fakeBox();
      reauth(c, { id, method, usage: usageOf(id) });
      await startThenCancel(c, primary);
      c.client.accountAuthStart.mockRejectedValueOnce(new ApiError(404, { ok: false, error: 'not-found' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
      await settle();
      // The ledger still holds the cancel's line, true when it was written: the alert is what this refusal says.
      expect(alertOf('reauth')).toBe(gone);
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

  /** Sign in again reads back another account, and the sheet offers Sign this lane out and start again. */
  async function readBackAnother(b: Box): Promise<(next: Partial<ReauthSheetProps>) => void> {
    const again = reauth(b, { lane: FRESH });
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
    return again;
  }
  /** Press Sign this lane out and start again, through its confirm. */
  async function pressSignOut(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    fireEvent.click(await screen.findByRole('button', { name: SIGN_OUT_RESTART }));
  }
  /** The sign-out runs to its end: the lane is signed out and a new attempt has started. */
  async function signedOutHere(b: Box): Promise<(next: Partial<ReauthSheetProps>) => void> {
    const again = await readBackAnother(b);
    await pressSignOut();
    await waitFor(() => expect(b.client.accountAuthStart).toHaveBeenCalledTimes(2));
    await settle();
    return again;
  }
  /** Sign-in and switch sheets opened later on the lane as last read: the passing check from before the sign-out. */
  function laterSheetsAreNeutral(b: Box, lane: LaneWire): void {
    reauth(b, { lane });
    expect(screen.getByText(reauthIntro('lane-a', 'login', 'unsure'))).toBeInTheDocument();
    claimsNothing();
    cleanup();
    switcher(b, { lane });
    expect(screen.getByText(switchIntro('lane-a', 'setup-token', 'unsure'))).toBeInTheDocument();
    claimsNothing();
    cleanup();
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

  it('after a sign-out in this sheet, a newer read of the lane does not change what its endings say', async () => {
    const b = fakeBox(OTHER);
    const again = await signedOutHere(b);
    again({ lane: { ...OTHER, check: { verdict: 'ok', at: CHECK_AT + 60_000 } } });
    fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(alertOf('reauth')).toBe(reauthEnd('lane-a', 'login', 'cancelled', undefined, 'signed-out'));
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

  describe('a sign-out the sheet did not see the end of is still recorded', () => {
    /** The sign-out request in flight, answered only when the test says. */
    function heldSignOut(b: Box): { answer: (word: 'removed' | 'absent') => void; fail: (e: unknown) => void } {
      let answer = (_: 'removed' | 'absent'): void => {};
      let fail = (_: unknown): void => {};
      b.client.accountSignOut.mockReturnValueOnce(new Promise((resolve, reject) => {
        answer = (signOut) => resolve({ ok: true as const, signOut, lane: UNCHECKED });
        fail = reject;
      }));
      return { answer: (word) => answer(word), fail: (e) => fail(e) };
    }
    async function closedMidSignOut(b: Box): Promise<ReturnType<typeof heldSignOut>> {
      const held = heldSignOut(b);
      await readBackAnother(b);
      await pressSignOut();
      await waitFor(() => expect(b.client.accountSignOut).toHaveBeenCalledWith('lane-a'));
      cleanup();
      return held;
    }

    for (const word of ['removed', 'absent'] as const) {
      it(`closed while the sign-out is in flight, then the box answers ${word}: later sheets are neutral`, async () => {
        const b = fakeBox(OTHER);
        const held = await closedMidSignOut(b);
        expect(signOutOf('lane-a')).toBeUndefined();
        held.answer(word);
        await settle();
        expect(signOutOf('lane-a')).toEqual({ checkAt: OTHER.check!.at });
        expect(b.client.accountAuthStart).toHaveBeenCalledTimes(1);
        laterSheetsAreNeutral(b, OTHER);
      });
    }

    for (const [how, failure] of UNKNOWN_ANSWERS) {
      it(`closed while the sign-out is in flight, and ${how}: later sheets are neutral`, async () => {
        const b = fakeBox(OTHER);
        const held = await closedMidSignOut(b);
        held.fail(failure());
        await settle();
        expect(signOutOf('lane-a')).toEqual({ checkAt: OTHER.check!.at });
        laterSheetsAreNeutral(b, OTHER);
      });

      it(`${how} with the sheet open: it says so, and later sheets are neutral, never signed out`, async () => {
        const b = fakeBox(OTHER);
        b.client.accountSignOut.mockRejectedValueOnce(failure());
        await readBackAnother(b);
        await pressSignOut();
        await settle();
        expect(alertOf('reauth')).toBe(signOutRefused('lane-a', undefined));
        expect(alertOf('reauth')).not.toMatch(/was not signed out|refused/);
        expect(signOutOf('lane-a')).toEqual({ checkAt: OTHER.check!.at });
        expect(b.client.accountAuthStart).toHaveBeenCalledTimes(1);
        cleanup();
        laterSheetsAreNeutral(b, OTHER);
      });
    }

    it('a refusal the box worded, or a step-up, signed nothing out: nothing is recorded, open or closed', async () => {
      for (const refusal of [new ApiError(409, { error: 'lane-busy' }), new ApiError(403, { ok: false, error: 'step-up-required' })]) {
        const b = fakeBox(OTHER);
        const held = await closedMidSignOut(b);
        held.fail(refusal);
        await settle();
        expect(signOutOf('lane-a')).toBeUndefined();
        reauth(b, { lane: OTHER });
        expect(screen.getByText(reauthIntro('lane-a', 'login', 'kept'))).toBeInTheDocument();
        cleanup();
      }
      const c = fakeBox(OTHER);
      c.client.accountSignOut.mockRejectedValueOnce(new ApiError(409, { error: 'lane-busy' }));
      await readBackAnother(c);
      await pressSignOut();
      await settle();
      expect(alertOf('reauth')).toBe(signOutRefused('lane-a', 'lane-busy'));
      expect(signOutOf('lane-a')).toBeUndefined();
    });
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
  const switchedToToken = (b: Box): Promise<void> => ranToDone(b, SWITCH_START['setup-token'], MINT_CODE);

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

  for (const [how, failure] of UNKNOWN_ANSWERS) {
    it(`Sign the old sign-in out, and ${how}: whether it was signed out is unknown, never refused`, async () => {
      const b = fakeBox();
      b.client.accountSignOut.mockRejectedValueOnce(failure());
      switcher(b);
      await switchedToToken(b);
      fireEvent.click(await screen.findByRole('button', { name: SIGN_OLD_OUT }));
      expect(await screen.findByText(signOldOutRefused('lane-a', undefined))).toBeInTheDocument();
      expect(text()).not.toMatch(/was not signed out|refused/);
    });
  }

  it('Sign the old sign-in out, refused with a word: the old sign-in was not signed out', async () => {
    const b = fakeBox();
    b.client.accountSignOut.mockRejectedValueOnce(new ApiError(409, { error: 'lane-busy' }));
    switcher(b);
    await switchedToToken(b);
    fireEvent.click(await screen.findByRole('button', { name: SIGN_OLD_OUT }));
    expect(await screen.findByText(signOldOutRefused('lane-a', 'lane-busy'))).toBeInTheDocument();
    expect(text()).toMatch(/refused \(lane-busy\): lane-a's old sign-in was not signed out/);
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

// ── Read when the sentence is written ──────────────────────────────────────────────────────────────────────────────

describe('a lane signed out elsewhere while the sheet is open: read when written, and only away from keeps (D-7872 (10))', () => {
  /** What the screen hands an open sheet once the lane is signed out elsewhere: each is a newer read of the lane. */
  const GONE: ReadonlyArray<readonly [string, { lane?: LaneWire; usage?: AccountUsage }]> = [
    ['its check cleared', { lane: UNCHECKED }],
    ['a 401 after its passing check', { usage: usageOf('lane-a', { authDead: true }) }],
  ];
  const NEWER: LaneWire = { ...FRESH, check: { verdict: 'ok', at: CHECK_AT + 60_000 } };
  const busy = (): ApiError => new ApiError(409, { error: 'lane-busy' });
  const expire = async (b: Box): Promise<void> => {
    b.box.status = { ok: true, state: 'expired', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    await settle();
  };

  for (const [id, method, primary] of [['lane-a', 'login', 'Start the sign-in'], ['lane-b', 'setup-token', MINT_NEW_TOKEN]] as const) {
    describe(`the re-auth sheet, ${method}`, () => {
      for (const [how, gone] of GONE) {
        it(`${how} on the Confirm frame: the intro and a refused start are neutral`, async () => {
          const b = fakeBox();
          const again = reauth(b, { id, method });
          expect(screen.getByText(reauthIntro(id, method, 'kept'))).toBeInTheDocument();
          again(gone);
          expect(screen.getByText(reauthIntro(id, method, 'unsure'))).toBeInTheDocument();
          claimsNothing();
          b.client.accountAuthStart.mockRejectedValueOnce(busy());
          fireEvent.click(screen.getByRole('button', { name: primary }));
          await settle();
          expect(alertOf('reauth')).toBe(reauthStartRefusal(id, method, 'lane-busy', undefined, 'unsure'));
          claimsNothing();
        });

        it(`${how} mid-attempt: Cancel, then Start again and its expiry, are neutral`, async () => {
          const b = fakeBox();
          const again = reauth(b, { id, method });
          fireEvent.click(screen.getByRole('button', { name: primary }));
          await settle();
          again(gone);
          fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
          await settle();
          expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'unsure'));
          claimsNothing();
          fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
          await settle();
          await expire(b);
          expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'expired', undefined, 'unsure'));
          claimsNothing();
        });

        it(`${how} after an ending: a refused Start again is neutral`, async () => {
          const b = fakeBox();
          const again = reauth(b, { id, method });
          await startThenCancel(b, primary);
          expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'kept'));
          again(gone);
          b.client.accountAuthStart.mockRejectedValueOnce(busy());
          fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
          await settle();
          expect(alertOf('reauth')).toBe(reauthStartRefusal(id, method, 'lane-busy', undefined, 'unsure'));
        });

        it(`${how}, then a passing check: the sheet does not go back to keeps`, async () => {
          const b = fakeBox();
          const again = reauth(b, { id, method });
          again(gone);
          again({ lane: NEWER, usage: usageOf('lane-a') });
          expect(screen.getByText(reauthIntro(id, method, 'unsure'))).toBeInTheDocument();
          await startThenCancel(b, primary);
          expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'unsure'));
          claimsNothing();
        });
      }

      it('the box says no-credential while it is open: signed out', async () => {
        const b = fakeBox();
        const again = reauth(b, { id, method });
        again({ lane: NONE });
        expect(screen.getByText(reauthIntro(id, method, 'signed-out'))).toBeInTheDocument();
        await startThenCancel(b, primary);
        expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'signed-out'));
      });

      it('opened neutral, a passing check while it is open does not make it say keeps', async () => {
        const b = fakeBox();
        const again = reauth(b, { id, method, lane: UNCHECKED });
        again({ lane: NEWER });
        expect(screen.getByText(reauthIntro(id, method, 'unsure'))).toBeInTheDocument();
        await startThenCancel(b, primary);
        expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'unsure'));
      });

      it('a re-read with nothing new leaves it saying keeps', async () => {
        const b = fakeBox();
        const again = reauth(b, { id, method });
        again({ lane: { ...FRESH }, usage: usageOf(id) });
        expect(screen.getByText(reauthIntro(id, method, 'kept'))).toBeInTheDocument();
        await startThenCancel(b, primary);
        expect(alertOf('reauth')).toBe(reauthEnd(id, method, 'cancelled', undefined, 'kept'));
      });
    });
  }

  for (const [id, to, usageId] of [['lane-a', 'setup-token', 'lane-a'], ['lane-b', 'login', 'lane-b']] as const) {
    describe(`the method switch sheet, to ${to}`, () => {
      for (const [how, gone] of GONE) {
        it(`${how} on the intro: the intro and a refused start are neutral`, async () => {
          const b = fakeBox();
          const again = switcher(b, { id, to, usage: usageOf(usageId) });
          expect(screen.getByText(switchIntro(id, to, 'kept'))).toBeInTheDocument();
          again(gone);
          expect(screen.getByText(switchIntro(id, to, 'unsure'))).toBeInTheDocument();
          claimsNothing();
        });

        it(`${how} mid-attempt: Cancel, then Start again and its expiry, are neutral`, async () => {
          const b = fakeBox();
          const again = switcher(b, { id, to, usage: usageOf(usageId) });
          fireEvent.click(screen.getByRole('button', { name: SWITCH_START[to] }));
          await settle();
          again(gone);
          fireEvent.click(await screen.findByRole('button', { name: CANCEL_SIGN_IN }));
          await settle();
          expect(alertOf('switch')).toBe(switchEnd(id, to, 'cancelled', undefined, 'unsure'));
          claimsNothing();
          fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
          await settle();
          await expire(b);
          expect(alertOf('switch')).toBe(switchEnd(id, to, 'expired', undefined, 'unsure'));
          claimsNothing();
        });

        it(`${how}, then a passing check: the sheet does not go back to keeps`, async () => {
          const b = fakeBox();
          const again = switcher(b, { id, to, usage: usageOf(usageId) });
          again(gone);
          again({ lane: NEWER, usage: usageOf(usageId) });
          expect(screen.getByText(switchIntro(id, to, 'unsure'))).toBeInTheDocument();
          claimsNothing();
        });
      }

      it('the box says no-credential while it is open: signed out', async () => {
        const b = fakeBox();
        const again = switcher(b, { id, to, usage: usageOf(usageId) });
        again({ lane: NONE });
        expect(screen.getByText(switchIntro(id, to, 'signed-out'))).toBeInTheDocument();
        await startThenCancel(b, SWITCH_START[to]);
        expect(alertOf('switch')).toBe(switchEnd(id, to, 'cancelled', undefined, 'signed-out'));
      });
    });
  }

  it('once a switch lands, a later read of the lane is about the new token: what it said of the old sign-in stays', async () => {
    const b = fakeBox();
    const again = switcher(b, { fleet: storeWith([ON_A]) });
    await ranToDone(b, SWITCH_START['setup-token'], MINT_CODE);
    expect(await screen.findByText(bothHeld('lane-a', 'kept'))).toBeInTheDocument();
    again({ lane: UNCHECKED, usage: usageOf('lane-a', { authDead: true }) });
    expect(screen.getByText(bothHeld('lane-a', 'kept'))).toBeInTheDocument();
    expect(screen.getByText(switchRestartLead(1, 'kept'))).toBeInTheDocument();
  });

  it('a lane gone before the switch landed stays neutral at its ending', async () => {
    const b = fakeBox();
    const again = switcher(b, { fleet: storeWith([ON_A]) });
    fireEvent.click(screen.getByRole('button', { name: SWITCH_START['setup-token'] }));
    await settle();
    again({ lane: UNCHECKED });
    b.box.status = { ok: true, state: 'waiting-code', url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => MINT_CODE } });
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    b.box.status = { ok: true, state: 'done', updatedAt: Date.now(), expiresAt: b.box.expiresAt };
    await poll();
    await settle();
    expect(await screen.findByText(bothHeld('lane-a', 'unsure'))).toBeInTheDocument();
    expect(screen.getByText(switchRestartLead(1, 'unsure'))).toBeInTheDocument();
    claimsNothing();
  });

  it('once a mint installs, a later read of the lane is about the new token: its revoke item stays', async () => {
    const b = fakeBox();
    const again = reauth(b, { id: 'lane-b', method: 'setup-token', fleet: storeWith([ON_B]) });
    await ranToDone(b, MINT_NEW_TOKEN, MINT_CODE);
    expect(await screen.findByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    again({ lane: UNCHECKED });
    expect(screen.getByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    expect(screen.getByText(reauthRestartLead(1, 'setup-token', 'kept'))).toBeInTheDocument();
    expect(text()).toContain('Revoke the old token at');
  });
});

// ── The endings' other lines: the restart lead, the danger confirm and the revoke item ──────────────────────────────

describe('an ending names the old credential only behind the rule (D-7872 (10))', () => {
  const UNSURE: ReadonlyArray<readonly [string, { lane?: LaneWire; usage?: AccountUsage }]> = [
    ['a never-checked lane', { lane: UNCHECKED }],
    ['a 401 lane', { usage: usageOf('lane-a', { authDead: true }) }],
  ];

  for (const [how, over] of UNSURE) {
    it(`${how}, switched to the token: the lead and the danger confirm are neutral, with the neutral line below them`, async () => {
      const b = fakeBox();
      switcher(b, { ...over, fleet: storeWith([ON_A]) });
      await ranToDone(b, SWITCH_START['setup-token'], MINT_CODE);
      expect(await screen.findByText(switchRestartLead(1, 'unsure'))).toBeInTheDocument();
      expect(screen.getByText(bothHeld('lane-a', 'unsure'))).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: SIGN_OLD_OUT }));
      expect(await screen.findByText(signOldOutDanger(1, 'lane-a', 'unsure'))).toBeInTheDocument();
      claimsNothing();
    });

    it(`${how}, switched to sign-in: the lead and the revoke item ask about any old token`, async () => {
      const b = fakeBox();
      switcher(b, { id: 'lane-b', to: 'login', ...over, fleet: storeWith([ON_B]) });
      await ranToDone(b, SWITCH_START.login, LOGIN_CODE);
      expect(await screen.findByRole('checkbox', { name: 'I revoked any old token' })).toBeInTheDocument();
      expect(screen.getByText(restartLead(1, 'unsure'))).toBeInTheDocument();
      expect(text()).toContain('If lane-b had an old token, revoke it at');
      expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, 'any'));
      claimsNothing();
    });

    it(`${how}, minted: the lead and the revoke item ask about any old token`, async () => {
      const b = fakeBox();
      reauth(b, { id: 'lane-b', method: 'setup-token', ...over, fleet: storeWith([ON_B]) });
      await ranToDone(b, MINT_NEW_TOKEN, MINT_CODE);
      expect(await screen.findByRole('checkbox', { name: 'I revoked any old token' })).toBeInTheDocument();
      expect(screen.getByText(reauthRestartLead(1, 'setup-token', 'unsure'))).toBeInTheDocument();
      expect(text()).toContain('If lane-b had an old token, revoke it at');
      expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, 'any'));
      claimsNothing();
    });
  }

  it("a lane the box says has no credential: the same neutral lines, and the switch's danger confirm too", async () => {
    const b = fakeBox();
    switcher(b, { lane: NONE, fleet: storeWith([ON_A]) });
    await ranToDone(b, SWITCH_START['setup-token'], MINT_CODE);
    expect(await screen.findByText(switchRestartLead(1, 'signed-out'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: SIGN_OLD_OUT }));
    expect(await screen.findByText(signOldOutDanger(1, 'lane-a', 'signed-out'))).toBeInTheDocument();
    claimsNothing();
    cleanup();
    const c = fakeBox();
    reauth(c, { id: 'lane-b', method: 'setup-token', lane: NONE, fleet: storeWith([ON_B]) });
    await ranToDone(c, MINT_NEW_TOKEN, MINT_CODE);
    expect(await screen.findByRole('checkbox', { name: 'I revoked any old token' })).toBeInTheDocument();
    claimsNothing();
  });

  it('a lane with a passing check keeps the spec\'s words: the sign-in in the lead and the confirm, the old token in the mint', async () => {
    const b = fakeBox();
    switcher(b, { fleet: storeWith([ON_A]) });
    await ranToDone(b, SWITCH_START['setup-token'], MINT_CODE);
    expect(await screen.findByText('1 session on this lane still uses the sign-in until it restarts.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: SIGN_OLD_OUT }));
    expect(await screen.findByText('1 session on lane-a still uses the sign-in and may fail its next turn.')).toBeInTheDocument();
    cleanup();
    const c = fakeBox();
    reauth(c, { id: 'lane-b', method: 'setup-token', fleet: storeWith([ON_B]) });
    await ranToDone(c, MINT_NEW_TOKEN, MINT_CODE);
    expect(await screen.findByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    expect(text()).toContain('Revoke the old token at');
    expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, true));
  });
});

// ── The connect sheet's Sign this lane out and start again ─────────────────────────────────────────────────────────

describe("the connect sheet's sign-out is one the later sheets know of (D-7872 (10))", () => {
  const CHECKED: LaneWire = { ...FRESH, identity: 'someone@example.invalid' };
  /** A lane added and signed in on the connect sheet, at the result frame that offers Sign this lane out and start again. */
  async function addedAndSignedIn(): Promise<{ accountSignOut: Mock<SignInClient['accountSignOut']> }> {
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
    return sc;
  }
  const pressSignOut = (): void => {
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    fireEvent.click(screen.getAllByRole('button', { name: SIGN_OUT_RESTART }).at(-1)!);
  };
  /** A re-auth (or a switch) opened later on the lane the screen read before the sign-out. */
  const laterSheetIsNeutral = (): void => {
    reauth(fakeBox(), { id: 'lane-c', lane: CHECKED, usage: usageOf('lane-c') });
    expect(screen.getByText(reauthIntro('lane-c', 'login', 'unsure'))).toBeInTheDocument();
    claimsNothing();
  };

  it('signed out there, a re-auth opened later on the lane as last read is neutral, never keeps', async () => {
    const sc = await addedAndSignedIn();
    pressSignOut();
    await settle();
    expect(sc.accountSignOut).toHaveBeenCalledWith('lane-c');
    expect(signOutOf('lane-c')).toEqual({ checkAt: CHECK_AT });
    cleanup();
    laterSheetIsNeutral();
  });

  it('closed while the sign-out is in flight, then the box answers removed: a later re-auth is neutral', async () => {
    const sc = await addedAndSignedIn();
    let answer = (): void => {};
    sc.accountSignOut.mockReturnValueOnce(new Promise((resolve) => {
      answer = () => resolve({ ok: true as const, signOut: 'removed' as const, lane: UNCHECKED });
    }));
    pressSignOut();
    await waitFor(() => expect(sc.accountSignOut).toHaveBeenCalledWith('lane-c'));
    cleanup();
    expect(signOutOf('lane-c')).toBeUndefined();
    answer();
    await settle();
    expect(signOutOf('lane-c')).toEqual({ checkAt: CHECK_AT });
    laterSheetIsNeutral();
  });

  it('a step-up signed nothing out: nothing is recorded', async () => {
    const sc = await addedAndSignedIn();
    sc.accountSignOut.mockRejectedValueOnce(new ApiError(403, { ok: false, error: 'step-up-required' }));
    pressSignOut();
    await settle();
    expect(sc.accountSignOut).toHaveBeenCalledWith('lane-c');
    expect(signOutOf('lane-c')).toBeUndefined();
  });

  for (const [how, failure] of UNKNOWN_ANSWERS) {
    it(`${how}: recorded, so a later re-auth is neutral; a refusal the box worded records nothing`, async () => {
      const sc = await addedAndSignedIn();
      sc.accountSignOut.mockRejectedValueOnce(new ApiError(409, { error: 'lane-busy' }));
      pressSignOut();
      await settle();
      expect(alertOf('connect')).toBe(signOutRefused('lane-c', 'lane-busy'));
      expect(signOutOf('lane-c')).toBeUndefined();
      sc.accountSignOut.mockRejectedValueOnce(failure());
      pressSignOut();
      await settle();
      expect(alertOf('connect')).toBe(signOutRefused('lane-c', undefined));
      expect(alertOf('connect')).not.toMatch(/was not signed out|refused/);
      expect(signOutOf('lane-c')).toEqual({ checkAt: CHECK_AT });
      cleanup();
      laterSheetIsNeutral();
    });

    it(`closed while the sign-out is in flight, and ${how}: recorded, so a later re-auth is neutral`, async () => {
      const sc = await addedAndSignedIn();
      let fail = (): void => {};
      sc.accountSignOut.mockReturnValueOnce(new Promise((_, reject) => { fail = () => reject(failure()); }));
      pressSignOut();
      await waitFor(() => expect(sc.accountSignOut).toHaveBeenCalledWith('lane-c'));
      cleanup();
      expect(signOutOf('lane-c')).toBeUndefined();
      fail();
      await settle();
      expect(signOutOf('lane-c')).toEqual({ checkAt: CHECK_AT });
      laterSheetIsNeutral();
    });
  }
});
