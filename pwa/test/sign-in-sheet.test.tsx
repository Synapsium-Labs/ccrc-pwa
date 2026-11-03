// Mint a long-lived token (the default) and Sign in with Claude in the connect sheet (accounts plan Task A22, D-7849; spec
// §6.1–§6.3, §3.7, §3.8, §12.3–§12.5), against a fake box: the radio's default, the URL card per width, the untrusted
// answer, the countdown read from `expiresAt`, each terminal state from its code, Cancel, offline mid-attempt, the
// live region, the mint's stated account, and the wrong-account sign-out. The code field's own rules are
// `code-field.test.tsx`'s; Anthropic Paste is `connect-sheet.test.tsx`'s.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ACCOUNT_AUTH_CAP, ACCOUNT_CAPS, type AccountAuthStatusAnswer, type AccountsConnect, type LaneWire, type RosterWire } from '../../shared/api';
import { PROVIDERS } from '../../shared/providers';
import {
  AUTH_POLL_MS, ConnectSheet, type ConnectClient, type ConnectSheetProps, type SignInClient,
} from '../src/accounts/ConnectSheet';
import { methodChoices } from '../src/accounts/connectFlow';
import {
  CANCEL_SIGN_IN, CODE_FIELD_LABEL, COMPROMISE_TITLE, COPY_LINK, OPEN_LINK, OPEN_TO_SIGN_IN, SEND_CODE, SIGN_IN_END,
  SIGN_IN_LEDGER, SIGN_OUT_RESTART, START_AGAIN, STATED_LABEL, clockHM, signInFailed, signInOffline, signInStartRefusal,
} from '../src/fleet/accountWords';
import { ApiError } from '../src/lib/api';
import { useFleetStore } from '../src/stores/fleet';

const lane = (id: string, hue: RosterWire['hue']): RosterWire => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token',
});
const ROSTER: RosterWire[] = [lane('lane-a', 'cyan'), lane('lane-b', 'violet')];
/** The connect a fleet that advertises every word this server knows answers: `ACCOUNT_CAPS`, the server's own list. */
const CONNECT = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: [...ACCOUNT_CAPS], stepUpFreshUntil: Date.now() + 3_600_000,
});
const LANE_NEW: LaneWire = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
const LANE_READY: LaneWire = { state: { word: 'signed-in', source: 'checked just now' }, ready: true };
const ATTEMPT = 'a'.repeat(32);
const LOGIN_CODE = 'A'.repeat(48) + '#' + 'b'.repeat(43);
const URL_OF = (scope: string): string =>
  `https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=${encodeURIComponent(scope)}&state=s`;
const LOGIN_URL = URL_OF('org:create_api_key user:profile user:inference user:sessions:claude_code');
const MINT_URL = URL_OF('user:inference');
const PLANTED = 'PLANTED-SENTENCE';

/** A viewport `width` px wide (connect-sheet.test.tsx's stub). */
function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]));
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

type Status = AccountAuthStatusAnswer | Error;
/** A fake box. `box.status` is what the next status read answers (an `Error` rejects it); `box.expiresAt` the deadline
 *  the start answers. */
function fakeBox(expiresIn = 7 * 60_000): {
  box: { status: Status; expiresAt: number };
  client: { [K in keyof ConnectClient]: Mock<ConnectClient[K]> };
  sc: { [K in keyof SignInClient]: Mock<SignInClient[K]> };
} {
  const box = { status: null as unknown as Status, expiresAt: Date.now() + expiresIn };
  box.status = { ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: box.expiresAt };
  const client = {
    accountAdd: vi.fn<ConnectClient['accountAdd']>(async () => ({ ok: true as const, roster: ROSTER, lane: LANE_NEW, fleetIdentity: null })),
    accountCheck: vi.fn<ConnectClient['accountCheck']>(async () => ({ ok: true as const, lane: { ...LANE_READY, identity: 'someone@example.invalid', identitySource: 'measured' as const } })),
    accountEnable: vi.fn<ConnectClient['accountEnable']>(async () => ({ ok: true as const, roster: ROSTER, lane: LANE_READY })),
  };
  const sc = {
    accountAuthStart: vi.fn<SignInClient['accountAuthStart']>(async () => ({ ok: true as const, attemptId: ATTEMPT, expiresAt: box.expiresAt })),
    accountAuthStatus: vi.fn<SignInClient['accountAuthStatus']>(async () => {
      const s = box.status;
      if (s instanceof Error) throw s;
      return s;
    }),
    accountAuthCode: vi.fn<SignInClient['accountAuthCode']>(async () => ({ ok: true as const })),
    accountAuthCancel: vi.fn<SignInClient['accountAuthCancel']>(async () => ({ ok: true as const })),
    accountSet: vi.fn<SignInClient['accountSet']>(async (_id, body) => ({
      ok: true as const, roster: ROSTER, lane: { ...LANE_READY, identity: body.stated!, identitySource: 'stated' as const },
    })),
    accountSignOut: vi.fn<SignInClient['accountSignOut']>(async () => ({ ok: true as const, signOut: 'removed' as const, lane: LANE_NEW })),
    accountRemove: vi.fn<SignInClient['accountRemove']>(async () => ({ ok: true as const, roster: ROSTER, removed: [], kept: [], rehomed: [], atProvider: [] })),
  };
  return { box, client, sc };
}
type Box = ReturnType<typeof fakeBox>;

function sheet(b: Box, over: Partial<ConnectSheetProps> = {}): { props: ConnectSheetProps; rerender: (p: Partial<ConnectSheetProps>) => void } {
  const props: ConnectSheetProps = {
    open: true, onClose: vi.fn(), roster: ROSTER, connect: CONNECT(), offline: null,
    refresh: vi.fn(async () => 'ok' as const), readRoster: () => ROSTER, client: b.client, signInClient: b.sc, ...over,
  };
  const r = render(<ConnectSheet {...props} />);
  return { props, rerender: (p) => { Object.assign(props, p); r.rerender(<ConnectSheet {...props} />); } };
}

/** Provider → Name it → Method, with the lane named `lane-c`, and the method picked when it is not the default. */
function toMethod(pick?: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'lane-c' } });
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lane C' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  if (pick !== undefined) fireEvent.click(screen.getByRole('radio', { name: pick }));
}
/** The next poll, and everything it settles. */
const poll = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_POLL_MS); }); };
const settle = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
/** Add the lane and start the sign-in; the first status read has answered. */
async function start(pick?: RegExp): Promise<void> {
  toMethod(pick);
  fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
  await settle();
  await settle();
}
const waitingCode = (b: Box, url = MINT_URL, expiresAt = b.box.expiresAt): void => {
  b.box.status = { ok: true, state: 'waiting-code', url, host: 'claude.com', updatedAt: Date.now(), expiresAt };
};
const refusal = (status: number, error: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(status, { error, detail: PLANTED, ...extra });
const paste = (code: string): void => {
  fireEvent.paste(screen.getByLabelText(CODE_FIELD_LABEL), { clipboardData: { getData: () => code } });
};
const alertText = (): string => screen.getByTestId('connect-alert').textContent ?? '';
const statusText = (): string => screen.getByTestId('connect-status').textContent ?? '';
const links = (): HTMLAnchorElement[] => [...document.querySelectorAll<HTMLAnchorElement>('.acct-connect a[href]')];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => useFleetStore.setState({ roster: [], lanes: null, accountsConnect: null }));
});

describe('Method (spec §6.1, Q1)', () => {
  it('Mint is selected by default when `account-auth-v1` is present', () => {
    // The server's list offers the word now (D-7849 (1)), and the radio reads the real provider table.
    expect(ACCOUNT_CAPS as readonly string[]).toContain(ACCOUNT_AUTH_CAP);
    expect(methodChoices('anthropic', CONNECT()).selected).toBe('setup-token');
    expect(PROVIDERS.anthropic.connect[0]).toBe('setup-token');
    sheet(fakeBox());
    toMethod();
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName(/Mint a long-lived token/);
    expect(screen.getByRole('radio', { name: /Mint a long-lived token/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Mint a long-lived token/ }).closest('label'))
      .toHaveTextContent("Inference only: Remote Control won't work on this lane.");
    // The sheet can run it: no "needs an app update", and its primary is enabled.
    expect(screen.queryByText(/can't run it yet/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add lane and sign in' })).toBeEnabled();
  });

  it('the lane is added with no credential, then the attempt starts for the chosen method', async () => {
    const b = fakeBox();
    sheet(b);
    await start(/Sign in with Claude/);
    expect(b.client.accountAdd).toHaveBeenCalledWith({ provider: 'anthropic', id: 'lane-c', label: 'Lane C', hue: 'blue', method: 'login' });
    expect(b.sc.accountAuthStart).toHaveBeenCalledWith('lane-c', { method: 'login' });
    expect(b.sc.accountAuthStatus).toHaveBeenCalled();
  });
});

describe('the URL card (spec §6.2 step 5, §12.4)', () => {
  it('on a phone Copy link is the primary, at ≥900 Open is', async () => {
    for (const width of [360, 1280]) {
      stubWidth(width);
      const b = fakeBox();
      waitingCode(b, LOGIN_URL);
      sheet(b);
      await start(/Sign in with Claude/);
      const copy = await screen.findByRole('button', { name: COPY_LINK });
      const open = links();
      expect(open).toHaveLength(1);
      expect(open[0]!.href).toBe(LOGIN_URL);
      expect(open[0]!).toHaveAttribute('target', '_blank');
      expect(open[0]!).toHaveAttribute('rel', 'noopener noreferrer');
      // The host label is the server's `host`.
      expect(document.querySelector('.acct-url-host')).toHaveTextContent('claude.com');
      if (width >= 900) {
        expect(open[0]!).toHaveTextContent(OPEN_TO_SIGN_IN);
        expect(open[0]!.className).toMatch(/btn-primary/);
        expect(copy.className).not.toMatch(/btn-primary/);
      } else {
        expect(copy.className).toMatch(/btn-primary/);
        expect(open[0]!).toHaveTextContent(OPEN_LINK);
        expect(open[0]!.className).not.toMatch(/btn-primary/);
        expect(screen.getByText(/Paste it into a private tab to sign in as a different account/)).toBeInTheDocument();
      }
      // What this grants: the URL's scopes, Remote Control's marked.
      expect(screen.getByText('What this grants')).toBeInTheDocument();
      expect(screen.getByText('user:sessions:claude_code').closest('li')).toHaveTextContent('Remote Control');
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('"Copied" only when the clipboard promise resolves; a refusal selects the link with its sentence', async () => {
    const writes: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: () => new Promise<void>((resolve, reject) => { writes.push({ resolve, reject }); }) },
    });
    const b = fakeBox();
    waitingCode(b);
    sheet(b);
    await start();
    fireEvent.click(await screen.findByRole('button', { name: COPY_LINK }));
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    await act(async () => { writes[0]!.resolve(); });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
    await act(async () => { writes[1]!.reject(new Error('denied')); });
    expect(screen.getByText("Couldn't copy: press and hold to copy")).toBeInTheDocument();
    expect(document.querySelector('.acct-url-field')).toHaveTextContent(MINT_URL);
  });

  it('an `auth-url-untrusted` answer shows its sentence and no link', async () => {
    const b = fakeBox();
    waitingCode(b, LOGIN_URL);
    sheet(b);
    await start(/Sign in with Claude/);
    expect(links()).toHaveLength(1);
    // The status file is rewritten on the box: the server refuses it, and the link it showed before goes too.
    b.box.status = refusal(409, 'auth-url-untrusted', { url: 'https://evil.example.invalid/' });
    await poll();
    expect(links()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('evil.example.invalid');
    expect(document.body.textContent).not.toContain(PLANTED);
    expect(screen.queryByLabelText(CODE_FIELD_LABEL)).toBeNull();
    expect(alertText()).toBe(SIGN_IN_END.untrusted('lane-c'));
    expect(screen.getAllByText(SIGN_IN_END.untrusted('lane-c')).filter((e) => e.closest('.sr-only') === null)).toHaveLength(1);
    expect(screen.getByRole('button', { name: START_AGAIN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard this lane' })).toBeInTheDocument();
  });
});

describe('the deadline has one source (spec §3.7)', () => {
  it('the countdown reads `expiresAt` and no duration is hard-coded', async () => {
    // The sources that draw or decide a sign-in name no duration: every deadline is the attempt's `expiresAt`.
    // `useSignInAttempt.tsx` runs the attempt for both sheets, and the switch sheet and the resume banner read the same
    // deadline (Task A23, D-7871).
    const files = ['src/accounts/ConnectSheet.tsx', 'src/accounts/RunFrame.tsx', 'src/accounts/CodeField.tsx',
      'src/accounts/ResultFrame.tsx', 'src/accounts/connectFlow.ts', 'src/fleet/accountWords.ts',
      'src/accounts/useSignInAttempt.tsx', 'src/accounts/MethodSwitchSheet.tsx', 'src/accounts/AuthResumeBanner.tsx'];
    for (const f of files) {
      const src = readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(src, f).not.toMatch(/\b600\b|600_?000|\b10\s*min|ten minutes|AUTH_HELPER_BOUND_MS/i);
    }
    // A deadline 3 min 17 s away, then a later one the server answers: the countdown follows each.
    const b = fakeBox(197_000);
    waitingCode(b);
    sheet(b);
    await start();
    const first = b.box.expiresAt;
    expect(document.querySelector('.acct-countdown')).toHaveTextContent(`Expires at ${clockHM(first)} · 3:1`);
    const later = first + 90_000;
    waitingCode(b, MINT_URL, later);
    await poll();
    expect(document.querySelector('.acct-countdown')).toHaveTextContent(`Expires at ${clockHM(later)} · 4:4`);
    // Amber while it waits on the operator, and the ledger's last line pulses rather than breathes.
    expect(document.querySelector('.acct-countdown')).toHaveAttribute('data-wait', 'true');
    expect(document.querySelector('.acct-ledger > li:last-child')).toHaveAttribute('data-wait', 'true');
    expect(document.querySelector('.acct-ledger > li:last-child')).not.toHaveAttribute('data-live');
  });

  it('at `expiresAt` the sheet says the sign-in timed out, and stops reading', async () => {
    const b = fakeBox(5_000);
    waitingCode(b);
    sheet(b);
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(alertText()).toBe(SIGN_IN_END.expired('lane-c'));
    const reads = b.sc.accountAuthStatus.mock.calls.length;
    await poll();
    await poll();
    expect(b.sc.accountAuthStatus.mock.calls.length).toBe(reads);
  });
});

describe('the terminal states (spec §6.2)', () => {
  it('each terminal state says what did not happen, from its code', async () => {
    type Case = { name: string; run: (b: Box) => Promise<void>; text: string };
    const cases: Case[] = [
      { name: 'expired', text: SIGN_IN_END.expired('lane-c'), run: async (b) => { b.box.status = { ok: true, state: 'expired', updatedAt: 0, expiresAt: b.box.expiresAt }; await poll(); } },
      { name: 'cancelled on the box', text: SIGN_IN_END.cancelled('lane-c'), run: async (b) => { b.box.status = { ok: true, state: 'cancelled', updatedAt: 0, expiresAt: b.box.expiresAt }; await poll(); } },
      {
        name: 'code refused', text: SIGN_IN_END['code-refused']('lane-c'), run: async (b) => {
          waitingCode(b); await poll();
          paste('Q'.repeat(30)); fireEvent.click(screen.getByRole('button', { name: SEND_CODE })); await settle();
          b.box.status = { ok: true, state: 'failed', failure: 'exchange-failed', updatedAt: 0, expiresAt: b.box.expiresAt }; await poll();
        },
      },
      { name: 'failed before a code', text: signInFailed('pane-unsupported-here'), run: async (b) => { b.box.status = { ok: true, state: 'failed', failure: 'pane-unsupported-here', updatedAt: 0, expiresAt: b.box.expiresAt }; await poll(); } },
      { name: 'failed with a sentence', text: signInFailed(undefined), run: async (b) => { b.box.status = { ok: true, state: 'failed', failure: 'the mint exited 1', updatedAt: 0, expiresAt: b.box.expiresAt }; await poll(); } },
      { name: 'link untrusted', text: SIGN_IN_END.untrusted('lane-c'), run: async (b) => { b.box.status = refusal(409, 'auth-url-untrusted'); await poll(); } },
      { name: 'node changed', text: SIGN_IN_END['node-changed']('lane-c'), run: async (b) => { b.box.status = refusal(409, 'node-changed'); await poll(); } },
      { name: 'attempt lost', text: SIGN_IN_END.lost('lane-c'), run: async (b) => { b.box.status = refusal(409, 'no-auth-attempt'); await poll(); } },
    ];
    for (const c of cases) {
      const b = fakeBox();
      sheet(b);
      await start();
      await c.run(b);
      expect(alertText(), c.name).toBe(c.text);
      expect(document.body.textContent, c.name).not.toContain(PLANTED);
      expect(document.body.textContent, c.name).not.toContain('the mint exited 1');
      expect(screen.queryByRole('button', { name: CANCEL_SIGN_IN }), c.name).toBeNull();
      expect(screen.getByRole('button', { name: START_AGAIN }), c.name).toBeInTheDocument();
      cleanup();
    }
  });

  it('a refused start says why from its code; one that never answered is outcome unknown', async () => {
    const cases: Array<[unknown, string]> = [
      [refusal(409, 'auth-in-progress'), signInStartRefusal('lane-c', 'auth-in-progress', undefined)],
      [refusal(501, 'auth-unsupported-here', { reason: 'no-systemd-run' }), signInStartRefusal('lane-c', 'auth-unsupported-here', 'no-systemd-run')],
      [refusal(501, 'auth-unsupported-here', { reason: `${PLANTED} with words` }), signInStartRefusal('lane-c', 'auth-unsupported-here', undefined)],
      [refusal(409, 'method-unmeasured'), signInStartRefusal('lane-c', 'method-unmeasured', undefined)],
      [refusal(409, 'lane-act-refused', { verbCode: 'auth-start-unanswered' }), signInStartRefusal('lane-c', 'lane-act-refused', undefined)],
      [new TypeError('network'), SIGN_IN_END.unknown('lane-c')],
      [refusal(502, 'outcome-unknown'), SIGN_IN_END.unknown('lane-c')],
    ];
    for (const [err, text] of cases) {
      const b = fakeBox();
      b.sc.accountAuthStart.mockRejectedValueOnce(err);
      sheet(b);
      await start();
      expect(alertText()).toBe(text);
      expect(document.body.textContent).not.toContain(PLANTED);
      expect(b.sc.accountAuthStatus).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('a start whose answer was lost but whose attempt the server kept is polled, not ended', async () => {
    const b = fakeBox();
    b.sc.accountAuthStart.mockRejectedValueOnce(refusal(502, 'outcome-unknown', { attemptId: ATTEMPT, expiresAt: b.box.expiresAt }));
    waitingCode(b);
    sheet(b);
    await start();
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(document.querySelector('.acct-ledger')).toHaveTextContent(SIGN_IN_LEDGER.waiting);
    expect(b.sc.accountAuthStart).toHaveBeenCalledTimes(1);
  });

  it('Start the sign-in again takes a new attempt; Discard this lane removes it in discard mode', async () => {
    const b = fakeBox();
    sheet(b);
    await start();
    b.box.status = { ok: true, state: 'expired', updatedAt: 0, expiresAt: b.box.expiresAt };
    await poll();
    b.box.status = { ok: true, state: 'starting', updatedAt: 0, expiresAt: b.box.expiresAt };
    fireEvent.click(screen.getByRole('button', { name: START_AGAIN }));
    await settle();
    expect(b.sc.accountAuthStart).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeInTheDocument();
    b.box.status = { ok: true, state: 'cancelled', updatedAt: 0, expiresAt: b.box.expiresAt };
    await poll();
    fireEvent.click(screen.getByRole('button', { name: 'Discard this lane' }));
    await settle();
    expect(b.sc.accountRemove).toHaveBeenCalledWith('lane-c', { mode: 'discard' });
    expect(alertText()).toBe('lane-c is discarded.');
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});

describe('Cancel (spec §6.2)', () => {
  it('Cancel is present in every non-terminal frame', async () => {
    const b = fakeBox();
    sheet(b);
    await start();
    // Starting: no URL yet.
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeEnabled();
    // Waiting on the code.
    waitingCode(b);
    await poll();
    expect(screen.getByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeEnabled();
    // Exchanging.
    paste('Q'.repeat(30));
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    b.box.status = { ok: true, state: 'exchanging', updatedAt: 0, expiresAt: b.box.expiresAt };
    await poll();
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(b.sc.accountAuthCancel).toHaveBeenCalledWith('lane-c', { attemptId: ATTEMPT });
    expect(alertText()).toBe(SIGN_IN_END.cancelled('lane-c'));
    expect(screen.queryByRole('button', { name: CANCEL_SIGN_IN })).toBeNull();
  });

  it('a cancel the box could not carry out keeps the attempt and Cancel', async () => {
    const b = fakeBox();
    b.sc.accountAuthCancel.mockRejectedValueOnce(refusal(409, 'lane-act-refused', { verbCode: 'auth-cancel-failed' }));
    sheet(b);
    await start();
    fireEvent.click(screen.getByRole('button', { name: CANCEL_SIGN_IN }));
    await settle();
    expect(screen.getByText("The fleet host couldn't stop the sign-in (lane-act-refused). Press Cancel again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeEnabled();
  });
});

describe('offline (spec §12.5)', () => {
  it('offline mid-attempt, the sheet shows the server-isn\'t-answering sentence with the last-known `expiresAt` time, and no code field, URL or Send', async () => {
    const b = fakeBox(4 * 60_000);
    waitingCode(b);
    const { rerender } = sheet(b);
    await start();
    // The server answers a later deadline than the start's: that one is the last known.
    const known = b.box.expiresAt + 2 * 60_000 + 13_000;
    waitingCode(b, MINT_URL, known);
    await poll();
    expect(links()).toHaveLength(1);
    rerender({ offline: "You're offline: nothing was sent. Read 5 s ago." });
    expect(screen.getByText(signInOffline(known))).toBeInTheDocument();
    expect(signInOffline(known)).toContain(clockHM(known));
    expect(screen.queryByLabelText(CODE_FIELD_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: SEND_CODE })).toBeNull();
    expect(screen.queryByRole('button', { name: COPY_LINK })).toBeNull();
    expect(links()).toHaveLength(0);
    // Nothing is read while offline, and the one act left is refused in place.
    const reads = b.sc.accountAuthStatus.mock.calls.length;
    await poll();
    await poll();
    expect(b.sc.accountAuthStatus.mock.calls.length).toBe(reads);
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeDisabled();
    // Back online: the poll resumes and the code field returns.
    rerender({ offline: null });
    await settle();
    expect(screen.getByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
  });

  it('a code already sent stays sent across a remount: offline and back, or the sheet closed and reopened, offers no second Send', async () => {
    const b = fakeBox();
    const { rerender } = sheet(b);
    await start();
    waitingCode(b);
    await poll();
    paste('Q'.repeat(30));
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    expect(b.sc.accountAuthCode).toHaveBeenCalledTimes(1);
    // Offline unmounts the field; back online it mounts again, and the attempt's own latch keeps it shut.
    rerender({ offline: "You're offline: nothing was sent. Read 5 s ago." });
    expect(screen.queryByLabelText(CODE_FIELD_LABEL)).toBeNull();
    rerender({ offline: null });
    await settle();
    expect(screen.getByLabelText(CODE_FIELD_LABEL)).toBeDisabled();
    expect(screen.getByRole('button', { name: SEND_CODE })).toBeDisabled();
    paste('R'.repeat(30));
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    fireEvent.keyDown(screen.getByLabelText(CODE_FIELD_LABEL), { key: 'Enter' });
    await settle();
    // Closed and reopened: the same.
    rerender({ open: false });
    await settle();
    rerender({ open: true });
    await settle();
    expect(screen.getByLabelText(CODE_FIELD_LABEL)).toBeDisabled();
    paste('S'.repeat(30));
    fireEvent.keyDown(screen.getByLabelText(CODE_FIELD_LABEL), { key: 'Enter' });
    await settle();
    expect(b.sc.accountAuthCode).toHaveBeenCalledTimes(1);
  });
});

describe('announcements (spec §12.4)', () => {
  it('each step change is `role="status"` and each terminal state `role="alert"`', async () => {
    const b = fakeBox();
    sheet(b);
    toMethod();
    fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
    await waitFor(() => expect(statusText()).toBe(SIGN_IN_LEDGER.starting));
    waitingCode(b);
    await poll();
    expect(statusText()).toBe(SIGN_IN_LEDGER.waiting);
    paste('Q'.repeat(30));
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    expect(statusText()).toBe(SIGN_IN_LEDGER.exchanging);
    expect(alertText()).toBe('');
    b.box.status = { ok: true, state: 'failed', updatedAt: 0, expiresAt: b.box.expiresAt };
    await poll();
    expect(alertText()).toBe(SIGN_IN_END['code-refused']('lane-c'));
    expect(screen.getByTestId('connect-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('connect-alert')).toHaveAttribute('role', 'alert');
  });
});

describe('the code and the result (spec §3.7, §6.2 steps 6–10, §6.3)', () => {
  it('Mint: one code, then the check, the stated account, Turn it on and the compromise disclosure', async () => {
    const b = fakeBox();
    b.client.accountCheck.mockResolvedValue({ ok: true, lane: LANE_READY });
    sheet(b);
    await start();
    waitingCode(b);
    await poll();
    paste(`  ${'Q'.repeat(30)}  `);
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    expect(b.sc.accountAuthCode).toHaveBeenCalledTimes(1);
    expect(b.sc.accountAuthCode).toHaveBeenCalledWith('lane-c', { attemptId: ATTEMPT, code: 'Q'.repeat(30) });
    // Once the code went, the URL card goes and the field stays, disabled.
    expect(links()).toHaveLength(0);
    expect(screen.getByLabelText(CODE_FIELD_LABEL)).toBeDisabled();
    b.box.status = { ok: true, state: 'done', updatedAt: 0, expiresAt: b.box.expiresAt };
    await poll();
    await settle();
    expect(b.client.accountCheck).toHaveBeenCalledWith('lane-c');
    expect(screen.getByText(SIGN_IN_LEDGER.minted)).toBeInTheDocument();
    const stated = await screen.findByLabelText(STATED_LABEL);
    fireEvent.change(stated, { target: { value: 'someone@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(b.sc.accountSet).toHaveBeenCalledWith('lane-c', { stated: 'someone@example.invalid' });
    expect(screen.getByText('Approved as someone@example.invalid · stated by you')).toBeInTheDocument();
    expect(screen.getByText(COMPROMISE_TITLE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SIGN_OUT_RESTART })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn it on' }));
    await settle();
    expect(b.client.accountEnable).toHaveBeenCalledWith('lane-c');
    // Once on, the lane is not signed out from here.
    expect(screen.queryByRole('button', { name: SIGN_OUT_RESTART })).toBeNull();
    // The poll stopped with the attempt.
    const reads = b.sc.accountAuthStatus.mock.calls.length;
    await poll();
    expect(b.sc.accountAuthStatus.mock.calls.length).toBe(reads);
  });

  it("a code off the method's shape is never sent, and a fresh field takes the next paste", async () => {
    const b = fakeBox();
    waitingCode(b, LOGIN_URL);
    sheet(b);
    await start(/Sign in with Claude/);
    paste('not-a-login-code');
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    expect(b.sc.accountAuthCode).not.toHaveBeenCalled();
    expect(screen.getByText(/That doesn't look like the code claude.ai shows/)).toBeInTheDocument();
    paste(LOGIN_CODE);
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    expect(b.sc.accountAuthCode).toHaveBeenCalledWith('lane-c', { attemptId: ATTEMPT, code: LOGIN_CODE });
  });

  it('Sign in: the identity, and "Sign this lane out and start again" signs out then takes a new attempt', async () => {
    const b = fakeBox();
    waitingCode(b, LOGIN_URL);
    sheet(b);
    await start(/Sign in with Claude/);
    paste(LOGIN_CODE);
    fireEvent.click(screen.getByRole('button', { name: SEND_CODE }));
    await settle();
    b.box.status = { ok: true, state: 'done', updatedAt: 0, expiresAt: b.box.expiresAt };
    await poll();
    await settle();
    expect(await screen.findByText('Signed in as someone@example.invalid')).toBeInTheDocument();
    expect(screen.getByText(SIGN_IN_LEDGER.signedIn)).toBeInTheDocument();
    // A sign-in lane's result has no compromise disclosure and no stated field.
    expect(screen.queryByText(COMPROMISE_TITLE)).toBeNull();
    expect(screen.queryByLabelText(STATED_LABEL)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SIGN_OUT_RESTART }));
    expect(b.sc.accountSignOut).not.toHaveBeenCalled();
    b.box.status = { ok: true, state: 'starting', updatedAt: 0, expiresAt: b.box.expiresAt };
    fireEvent.click(screen.getAllByRole('button', { name: SIGN_OUT_RESTART }).at(-1)!);
    await settle();
    expect(b.sc.accountSignOut).toHaveBeenCalledWith('lane-c');
    expect(b.sc.accountAuthStart).toHaveBeenCalledTimes(2);
    expect(b.sc.accountAuthStart).toHaveBeenLastCalledWith('lane-c', { method: 'login' });
    expect(screen.getByText(SIGN_IN_LEDGER.signedOut('lane-c', true))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeInTheDocument();
  });
});
