// The ChatGPT device-code sheet (accounts plan Task A25, D-8051; spec §7.2, §9 row 5, §11 step 4, §3.8), against a fake
// box: OpenAI's frame with nothing to choose, the device-code card and its user code, the pair the server accepted or
// nothing, each ending in the Codex flow's own words, the result frame, Sign in again on a Signed-out lane, a sign-in
// that waits at `url` reaching the resume banner, and the remove sheet's folder line. A22's Anthropic sheets are
// `sign-in-sheet.test.tsx`'s; what the server accepts is `auth-url-allowlist.test.ts`'s. The fake is held to the wire: its
// add goes through the real argv builder, and its lanes' words come from the real `stateWordFor`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ACCOUNT_CAPS, type AccountAuthStatusAnswer, type AccountRemoveAnswer, type AccountRemoveCheckAnswer, type AccountsConnect, type FleetSession, type LaneWire, type RosterWire,
} from '../../shared/api';
import { buildAccountArgv } from '../../shared/account-argv';
import { laneNotReadyReason, stateWordFor, type LaneState, type LaneStateRead } from '../../shared/accounts';
import { AUTH_POLL_MS, ConnectSheet, type ConnectClient, type ConnectSheetProps, type SignInClient } from '../src/accounts/ConnectSheet';
import { ReauthSheet, troubleActs, type ReauthClient } from '../src/accounts/ReauthSheet';
import { RemoveSheet, type RemoveClient } from '../src/accounts/RemoveSheet';
import { heldAttemptOf, managedCodex, recordedOnly, resumableAttempt, resumeSheetFor, waitsOnOperator } from '../src/accounts/connectFlow';
import {
  CANCEL_SIGN_IN, CHATGPT_MODELS, CHATGPT_SIGNED_IN, CODE_FIELD_LABEL, CODEX_FOLDER_KEPT, CODEX_FOLDER_LINE, COMPROMISE_TITLE, COME_BACK,
  COME_BACK_APPROVED, COPIED, COPY_CODE, COPY_LINK, DEVICE_CODE_LABEL, DEVICE_CODE_NOTE, FRAME_SAID, LEDGER, OPEN_CHATGPT, OPEN_LINK, SIGN_IN_AGAIN, SIGN_OUT_RESTART,
  START_AGAIN, chatgptEnd, chatgptSignedInLine, clockHM, credentialUntouched, reauthEnd, reauthIntro, reauthRestartLead, removeConsequence, resumeBannerText, signInLedger, signInStartRefusal, typedConfirmLabel,
} from '../src/fleet/accountWords';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { createFleetStore, useFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'openai', kind: 'codex', ...over,
});
const ROSTER: RosterWire[] = [lane('lane-a', { provider: 'anthropic', kind: 'token' }), lane('lane-g', { managed: true })];
/** An OpenAI lane ccrc only records (`ccrc account declare`): `kind: 'codex'` too, with no folder and no sign-in to install. */
const EXTERNAL = lane('lane-x', { managed: false });
/** The roster before the connect sheet adds lane-g. */
const BEFORE: RosterWire[] = [ROSTER[0]!];
const CONNECT = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: [...ACCOUNT_CAPS], stepUpFreshUntil: Date.now() + 3_600_000,
});
const LANE_NEW: LaneWire = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
/** A lane as the server answers it, through `lanesWire`'s two derivations, so a fake here can't answer what the wire
 *  can't: `stateWordFor` says Off first for a disabled lane, whatever its check found. */
const wired = (disabled: boolean, verdict: string, over: Partial<LaneState> = {}, authDead = false): LaneWire => {
  const check = { verdict, at: Date.now() };
  const read: LaneStateRead = { kind: 'read', state: { check, seedVerifiedAt: 2, lastRunAt: 1, ...over } };
  const notReadyReason = laneNotReadyReason(read);
  return {
    state: stateWordFor({ disabled, authDead, five: null, seven: 12, provider: 'openai', kind: 'codex', lane: read, now: Date.now() }),
    check, ...over, ready: notReadyReason === null, ...(notReadyReason !== null ? { notReadyReason } : {}),
  } as LaneWire;
};
/** A new lane after its passing check: still off, and ready to turn on (spec §7.2 steps 3, 7 and 9). */
const LANE_CHECKED = wired(true, 'ok');
/** The same lane once it is on. */
const LANE_READY = wired(false, 'ok');
const ATTEMPT = 'a'.repeat(32);
// The host is a stand-in: the sheet shows what the server parsed, whatever it is, and names no host of its own.
const HOST = 'auth.example.invalid';
const DEVICE_URL = `https://${HOST}/codex/device`;
const CODE = 'ABCD-EF12';
const PLANTED = 'PLANTED-SENTENCE';

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
function fakeBox(): {
  box: { status: Status; expiresAt: number };
  client: { [K in keyof ConnectClient]: Mock<ConnectClient[K]> };
  sc: { [K in keyof SignInClient]: Mock<SignInClient[K]> };
} {
  const box = { status: null as unknown as Status, expiresAt: Date.now() + 7 * 60_000 };
  box.status = { ok: true, state: 'starting', updatedAt: Date.now(), expiresAt: box.expiresAt };
  const client = {
    // The route's own step: the body goes through the real builder, which refuses what the verb's list doesn't name.
    accountAdd: vi.fn<ConnectClient['accountAdd']>(async ({ id, credential, adopt, ...rest }) => {
      const fields = { ...rest, ...(adopt === true ? { adopt: 'true' } : {}) };
      if (!buildAccountArgv('add', id, fields, credential !== undefined).ok) throw new ApiError(400, { error: 'bad-request' });
      return { ok: true as const, roster: ROSTER, lane: LANE_NEW, fleetIdentity: null };
    }),
    accountCheck: vi.fn<ConnectClient['accountCheck']>(async () => ({ ok: true as const, lane: LANE_CHECKED })),
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
    accountSet: vi.fn<SignInClient['accountSet']>(async () => ({ ok: true as const, roster: ROSTER, lane: LANE_READY })),
    accountSignOut: vi.fn<SignInClient['accountSignOut']>(async () => ({ ok: true as const, signOut: 'removed' as const, lane: LANE_NEW })),
    accountRemove: vi.fn<SignInClient['accountRemove']>(async () => ({ ok: true as const, roster: ROSTER, removed: [], kept: [], rehomed: [], atProvider: [] })),
  };
  return { box, client, sc };
}
type Box = ReturnType<typeof fakeBox>;

function sheet(b: Box, over: Partial<ConnectSheetProps> = {}): void {
  render(
    <ConnectSheet
      open onClose={vi.fn()} roster={BEFORE} connect={CONNECT()} offline={null} refresh={vi.fn(async () => 'ok' as const)}
      readRoster={() => BEFORE} client={b.client} signInClient={b.sc} {...over}
    />,
  );
}
const toFrame = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'lane-g' } });
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lane G' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};
const poll = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_POLL_MS); }); };
const settle = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const start = async (): Promise<void> => {
  toFrame();
  fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
  await settle();
  await settle();
};
/** The helper's state for a device sign-in: it stays at `url` until the operator approves (ccgpt-auth prints no prompt
 *  the helper reads as `waiting-code`). */
const showing = (b: Box, over: Partial<AccountAuthStatusAnswer> = {}): void => {
  b.box.status = { ok: true, state: 'url', url: DEVICE_URL, host: HOST, userCode: CODE, updatedAt: Date.now(), expiresAt: b.box.expiresAt, ...over };
};
const at = (b: Box, state: AccountAuthStatusAnswer['state'], over: Partial<AccountAuthStatusAnswer> = {}): void => {
  b.box.status = { ok: true, state, updatedAt: Date.now(), expiresAt: b.box.expiresAt, ...over };
};
const refusal = (status: number, error: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(status, { error, detail: PLANTED, ...extra });
const alertText = (): string => screen.getByTestId('connect-alert').textContent ?? '';
const links = (): HTMLAnchorElement[] => [...document.querySelectorAll<HTMLAnchorElement>('.acct-connect a[href]')];
const ledgerText = (): string => document.querySelector('.acct-ledger')?.textContent ?? '';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', usage: null, roster: [], lanes: null, accountsConnect: null, lanesUnread: {} }));
});

describe('OpenAI has no method step (spec §7.2 steps 1–4)', () => {
  it('states its models where a radio would be, then adds the lane and starts the ChatGPT sign-in', async () => {
    const b = fakeBox();
    sheet(b);
    toFrame();
    expect(screen.getByText(CHATGPT_MODELS)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
    await settle();
    await settle();
    expect(b.client.accountAdd).toHaveBeenCalledWith({ provider: 'openai', id: 'lane-g', label: 'Lane G', hue: expect.any(String) });
    expect(b.sc.accountAuthStart).toHaveBeenCalledWith('lane-g', { method: 'openai-login' });
    expect(ledgerText()).toContain(signInLedger('openai-login').starting);
  });

  it("the add's exact body is one the real builder writes: `openai-login` is the sign-in's method, and `add` refuses it", async () => {
    const b = fakeBox();
    sheet(b);
    await start();
    const { id, ...fields } = b.client.accountAdd.mock.calls[0]![0];
    expect(buildAccountArgv('add', id, fields, false)).toEqual({
      ok: true, argv: ['account', 'add', '--id=lane-g', '--provider=openai', '--label=Lane G', `--hue=${fields.hue}`],
    });
    expect(buildAccountArgv('add', id, { ...fields, method: 'openai-login' }, false)).toEqual({ ok: false, why: 'bad-field' });
  });

  it('narrows in place while the fleet does not offer its cap word', () => {
    const b = fakeBox();
    sheet(b, { connect: { ...CONNECT(), caps: ['account-v2', 'account-auth-v1'] } });
    expect(screen.queryByRole('button', { name: /OpenAI/ })).toBeNull();
  });

  it("says why an add the Codex arm refused didn't happen, from the verb's code", async () => {
    const b = fakeBox();
    b.client.accountAdd.mockRejectedValue(refusal(409, 'lane-act-refused', { verbCode: 'codex-runtime-absent' }));
    sheet(b);
    await start();
    expect(alertText()).toContain('no Codex runtime');
    expect(alertText()).toContain('Nothing was added');
    expect(alertText()).not.toContain(PLANTED);
  });
});

describe("a folder an earlier lane left (spec §5, G20): Use what's there on a ChatGPT lane", () => {
  const found = async (b: Box): Promise<void> => {
    const real = b.client.accountAdd.getMockImplementation()!;
    b.client.accountAdd.mockImplementationOnce(async () => { throw new ApiError(409, { error: 'config-dir-exists', signedIn: false }); });
    b.client.accountAdd.mockImplementation(real);
    sheet(b);
    toFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
    await settle();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: "Use what's there" }));
    await settle();
  };

  it('says what this flow does: a ChatGPT lane has no token field, so nothing tells the operator to paste one', async () => {
    const b = fakeBox();
    await found(b);
    const said = screen.getByTestId('connect-status').textContent ?? '';
    expect(said).toBe(FRAME_SAID.chatgpt);
    expect(said).not.toMatch(/token|paste/i);
    expect(screen.queryByRole('textbox', { name: /token/i })).toBeNull();
    expect(screen.getByText(CHATGPT_MODELS)).toBeInTheDocument();
  });

  it('and the add takes the folder over through the real builder, then starts the ChatGPT sign-in', async () => {
    const b = fakeBox();
    await found(b);
    fireEvent.click(screen.getByRole('button', { name: 'Add lane and sign in' }));
    await settle();
    await settle();
    expect(b.client.accountAdd).toHaveBeenCalledTimes(2);
    expect(b.client.accountAdd.mock.calls[1]![0]).toMatchObject({ provider: 'openai', adopt: true });
    expect(b.sc.accountAuthStart).toHaveBeenCalledWith('lane-g', { method: 'openai-login' });
  });
});

describe('the device-code card (spec §7.2 step 5)', () => {
  it('tells the operator not to share the code: the library running this flow warns the same, and spec §3.8 names the threat', () => {
    expect(DEVICE_CODE_NOTE).toBe("Type this code on the page. Don't share it.");
    expect(DEVICE_CODE_NOTE).not.toMatch(/not a secret/i);
  });

  it('shows the link, the host the server parsed and the user code, with no code field and nothing to send', async () => {
    stubWidth(1280);
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    const open = screen.getByRole('link', { name: new RegExp(OPEN_CHATGPT) });
    expect(open).toHaveAttribute('href', DEVICE_URL);
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(open.className).toContain('btn-primary');
    expect(screen.getByLabelText(DEVICE_CODE_LABEL)).toHaveTextContent(CODE);
    expect(screen.getByText(DEVICE_CODE_NOTE)).toBeInTheDocument();
    expect(screen.queryByLabelText(CODE_FIELD_LABEL)).toBeNull();
    expect(screen.getByRole('button', { name: CANCEL_SIGN_IN })).toBeEnabled();
    expect(ledgerText()).toContain('… waiting for you to approve');
    expect(document.querySelector('.acct-ledger > li[data-wait="true"]')).not.toBeNull();
    expect(document.querySelector('.acct-countdown')).toHaveAttribute('data-wait', 'true');
    expect(b.sc.accountAuthCode).not.toHaveBeenCalled();
  });

  it("the host label is the parsed URL's host", async () => {
    stubWidth(1280);
    const b = fakeBox();
    showing(b, { url: 'https://other.example.invalid/codex/device?x=auth.example.invalid', host: 'other.example.invalid' });
    sheet(b);
    await start();
    expect(document.querySelector('.acct-url-host')).toHaveTextContent(/^other\.example\.invalid$/);
  });

  it('on a phone Copy link is the primary, and nothing says to paste a code', async () => {
    stubWidth(360);
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    expect(screen.getByRole('button', { name: COPY_LINK }).className).toContain('btn-primary');
    expect(screen.getByRole('link', { name: new RegExp(OPEN_LINK) }).className).not.toContain('btn-primary');
    expect(screen.getByText(COME_BACK_APPROVED)).toBeInTheDocument();
    expect(screen.queryByText(COME_BACK)).toBeNull();
  });

  it('the user code at 24px fits eight characters and a hyphen in 296px', () => {
    const css = (f: string): string => readFileSync(path.resolve(__dirname, f), 'utf8');
    const tokens = css('../../ui/src/styles/tokens.css');
    const theme = css('../../ui/src/styles/theme.css');
    const rule = /\.acct-device-code \{([^}]*)\}/.exec(css('../src/fleet/fleet.css'))![1]!;
    const sizeVar = /font-size:\s*var\((--[\w-]+)\)/.exec(rule)![1]!;
    const trackVar = /letter-spacing:\s*var\((--[\w-]+)\)/.exec(rule)![1]!;
    expect(trackVar).toBe('--tracking-caps');
    expect(rule).toMatch(/white-space:\s*nowrap/);
    const px = Number(new RegExp(`${sizeVar}:\\s*([\\d.]+)px`).exec(tokens)![1]);
    const tracking = Number(/--ls-caps:\s*([\d.]+)em/.exec(tokens)![1]);
    expect(theme).toMatch(/--tracking-caps:\s*var\(--ls-caps\)/);
    expect(px).toBe(24);
    // A mono face advances 0.6em a glyph; each of the nine glyphs carries the tracking too. Copy's row needs its share.
    const code = 9 * (0.6 * px + tracking * px);
    const copy = 72;
    expect(code + copy).toBeLessThanOrEqual(296);
  });

  it('its Copy says Copied only once the clipboard took it, and copies the code alone', async () => {
    stubWidth(1280);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    fireEvent.click(screen.getByRole('button', { name: COPY_CODE }));
    await settle();
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(screen.getByRole('button', { name: COPIED })).toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('a URL with no device code beside it shows neither, and the sheet does not yet say it waits on you', async () => {
    const b = fakeBox();
    showing(b, { userCode: undefined });
    sheet(b);
    await start();
    expect(links()).toEqual([]);
    expect(document.querySelector('.acct-device-code')).toBeNull();
    expect(ledgerText()).not.toContain('waiting for you');
    // The helper publishes the URL a line before the code: the next answer brings the pair.
    showing(b);
    await poll();
    expect(screen.getByLabelText(DEVICE_CODE_LABEL)).toHaveTextContent(CODE);
    expect(ledgerText()).toContain('waiting for you');
  });

  it('a later answer that brings a URL with no code takes the card down: the code outlives no URL', async () => {
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    expect(links().length).toBeGreaterThan(0);
    showing(b, { userCode: undefined });
    await poll();
    expect(links()).toEqual([]);
    expect(document.querySelector('.acct-device-code')).toBeNull();
  });

  it('an untrusted `userCode` shows no code and no link', async () => {
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    expect(document.querySelector('.acct-device-code')).not.toBeNull();
    // The server's N2 refused the file: it answers the word and no URL, whatever the sheet held.
    b.box.status = refusal(409, 'auth-url-untrusted');
    await poll();
    expect(document.querySelector('.acct-device-code')).toBeNull();
    expect(links()).toEqual([]);
    expect(document.body.textContent).not.toContain(CODE);
    expect(alertText()).toBe(chatgptEnd('lane-g', 'untrusted', undefined, undefined));
    expect(alertText()).not.toContain('claude.ai');
  });

  it('offline shows the sentence and neither the card nor the code', async () => {
    const b = fakeBox();
    showing(b);
    const props = {
      open: true, onClose: vi.fn(), roster: BEFORE, connect: CONNECT(), refresh: vi.fn(async () => 'ok' as const), readRoster: () => BEFORE,
      client: b.client, signInClient: b.sc,
    };
    const r = render(<ConnectSheet {...props} offline={null} />);
    await start();
    expect(document.querySelector('.acct-device-code')).not.toBeNull();
    r.rerender(<ConnectSheet {...props} offline="You're offline: nothing was sent." />);
    await settle();
    expect(document.querySelector('[data-sign-in-offline="true"]')).not.toBeNull();
    expect(document.querySelector('.acct-device-code')).toBeNull();
    expect(links()).toEqual([]);
  });
});

describe("each ending says what didn't happen, in this flow's words (spec §7.2)", () => {
  it("expiry reads the code's `expiresAt` time", async () => {
    const b = fakeBox();
    const later = b.box.expiresAt + 90_000;
    showing(b, { expiresAt: later });
    sheet(b);
    await start();
    at(b, 'expired', { expiresAt: later });
    await poll();
    expect(alertText()).toBe(`The sign-in code expired at ${clockHM(later)}. Nothing was signed in. The lane is still there, off.`);
    expect(screen.getByRole('button', { name: START_AGAIN })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discard this lane' })).toBeEnabled();
  });

  it("a failure carries the helper's plain word and never a sentence, and never speaks of a code that was sent", async () => {
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    at(b, 'failed', { failure: 'credential-write' });
    await poll();
    expect(alertText()).toBe('The ChatGPT sign-in stopped on the fleet host (credential-write). Nothing was signed in. The lane is still there, off.');
    expect(chatgptEnd('lane-g', 'failed', `${PLANTED} line`, undefined)).not.toContain(PLANTED);
  });

  it("a fleet host that can't run a sign-in offers no token to paste", () => {
    expect(signInStartRefusal('lane-g', 'auth-unsupported-here', 'no-user-manager', 'openai-login')).toBe("This fleet host can't run a sign-in (no-user-manager). Nothing was started.");
    expect(signInStartRefusal('lane-g', 'auth-unsupported-here', undefined)).toContain('Paste a token instead');
  });

  it('none of them names claude.ai', () => {
    for (const k of ['expired', 'code-refused', 'untrusted', 'cancelled', 'unknown', 'lost', 'failed', 'node-changed'] as const) {
      expect(chatgptEnd('lane-g', k, undefined, Date.now())).not.toContain('claude.ai');
      expect(reauthEnd('lane-g', 'openai-login', k, undefined, 'kept', Date.now())).not.toContain('claude.ai');
    }
  });
});

describe('the result frame (spec §7.2 steps 6–9)', () => {
  it('after `done` the check starts the gateway, then the frame holds the compromise disclosure and no wrong-account act', async () => {
    const b = fakeBox();
    showing(b);
    sheet(b);
    await start();
    at(b, 'done');
    await poll();
    await settle();
    expect(b.client.accountCheck).toHaveBeenCalledWith('lane-g');
    expect(ledgerText()).toContain('✓ signed in');
    expect(document.querySelector('[data-frame="result"]')).not.toBeNull();
    // A new lane is off until it is turned on, so Off is the word here, and the sign-in line reads the check.
    expect(document.querySelector('.acct-result-word')).toHaveAttribute('data-state', 'off');
    expect(screen.getByText(CHATGPT_SIGNED_IN)).toBeInTheDocument();
    expect(screen.getByText(COMPROMISE_TITLE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn it on' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: SIGN_OUT_RESTART })).toBeNull();
    expect(b.sc.accountAuthCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn it on' }));
    await settle();
    expect(document.querySelector('.acct-result-word')).toHaveAttribute('data-state', 'signed-in');
    expect(screen.getByText(CHATGPT_SIGNED_IN)).toBeInTheDocument();
  });

  it('a check that did not pass never says the lane is signed in', async () => {
    for (const verdict of ['auth-dead', 'unreachable']) {
      const b = fakeBox();
      b.client.accountCheck.mockResolvedValue({ ok: true, lane: wired(true, verdict) });
      showing(b);
      sheet(b);
      await start();
      at(b, 'done');
      await poll();
      await settle();
      expect(document.querySelector('.acct-result-word'), verdict).toHaveAttribute('data-state', 'off');
      expect(screen.queryByText(CHATGPT_SIGNED_IN), verdict).toBeNull();
      cleanup();
    }
  });

  it('the line reads what the lane proves, and whatever else the lane says of its sign-in beats the check', () => {
    expect(chatgptSignedInLine(LANE_CHECKED)).toBe(CHATGPT_SIGNED_IN);
    expect(chatgptSignedInLine(LANE_READY)).toBe(CHATGPT_SIGNED_IN);
    expect(chatgptSignedInLine(LANE_NEW)).toBeNull();
    expect(chatgptSignedInLine(wired(false, 'auth-dead'))).toBeNull();
    expect(chatgptSignedInLine(wired(false, 'ok', {}, true)), 'an HTTP 401 since the check').toBeNull();
    expect(chatgptSignedInLine(wired(true, 'ok', { signedOutAt: 1 })), 'signed out on the box').toBeNull();
    expect(chatgptSignedInLine(wired(true, 'ok', { credential: 'none' })), 'no sign-in on the box').toBeNull();
  });

  it('says the check starts the gateway while it runs', async () => {
    const b = fakeBox();
    let answer: (v: Awaited<ReturnType<ConnectClient['accountCheck']>>) => void = () => {};
    b.client.accountCheck.mockReturnValue(new Promise((r) => { answer = r; }));
    showing(b);
    sheet(b);
    await start();
    at(b, 'done');
    await poll();
    expect(ledgerText()).toContain(LEDGER.checkingCodex('lane-g'));
    expect(ledgerText()).toContain("starts this lane's gateway");
    await act(async () => { answer({ ok: true, lane: LANE_CHECKED }); await vi.advanceTimersByTimeAsync(0); });
  });
});

describe('Sign in again on a Codex lane (spec §9 row 5)', () => {
  const OUT: LaneWire = { state: { word: 'signed-out', source: 'Signed out · HTTP 401 · checked 2h ago', at: Date.now() - 7_200_000 }, ready: false, notReadyReason: 'check-failed' };
  const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane="${id}"]`) as HTMLElement;
  const screenWith = (connect: AccountsConnect, roster: RosterWire[] = ROSTER, lanes: Record<string, LaneWire> = { 'lane-a': LANE_READY, 'lane-g': OUT }): void => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    act(() => useFleetStore.setState({
      conn: 'open', usage: [], roster, accountsConnect: connect, lanes, sessions: [], accountsReadAt: () => Date.now(),
    }));
    render(<AccountsScreen />);
  };
  const reauthClient = (b: Box): { [K in keyof ReauthClient]: Mock<ReauthClient[K]> } => ({
    accountAuthStart: b.sc.accountAuthStart, accountAuthStatus: b.sc.accountAuthStatus, accountAuthCode: b.sc.accountAuthCode, accountAuthCancel: b.sc.accountAuthCancel,
    accountCheck: b.client.accountCheck, accountSet: b.sc.accountSet, accountSignOut: b.sc.accountSignOut,
    accountRevokeAck: vi.fn(async () => ({ ok: true as const })), stop: vi.fn<ReauthClient['stop']>(async () => {}),
  });
  const live: FleetSession = fleetSession({ id: 'lane-g:p-one', wrapper: 'lane-g', home: 'lane-g', project: 'p-one', title: 'one' });
  const reauth = (b: Box, freshUntil: number | null = Date.now() + 3_600_000): void => {
    const store = createFleetStore({ makeSocket: () => ({ close: () => {}, send: () => {} }) as never });
    act(() => { store.setState({ conn: 'open', sessions: [live], roster: ROSTER, usage: [] }); });
    render(
      <ReauthSheet
        id="lane-g" method="openai-login" open onClose={vi.fn()} blocked={null} lane={OUT} roster={ROSTER} fleet={store}
        connect={{ ...CONNECT(), ...(freshUntil === null ? { stepUpFreshUntil: undefined } : { stepUpFreshUntil: freshUntil }) }}
        refresh={vi.fn(async () => 'ok' as const)} client={reauthClient(b)} ensure={vi.fn(async () => {})}
        stepUpDeps={{ fetchOptions: vi.fn(() => new Promise(() => {})) } as never}
      />,
    );
  };

  it("a Signed-out Codex lane's primary fix is Sign in again, it asks for step-up, and it ends with the restart list and a fresh check", async () => {
    screenWith(CONNECT());
    const acts = [...card('lane-g').querySelectorAll<HTMLButtonElement>('.acct-trouble-acts button')];
    expect(acts.map((x) => [x.textContent, x.className.includes('btn-primary')])).toEqual([[SIGN_IN_AGAIN, true]]);
    fireEvent.click(acts[0]!);
    expect(screen.getByRole('dialog', { name: 'Sign lane-g in again' })).toBeInTheDocument();
    cleanup();

    // The step-up: with its stamp lapsed nothing starts.
    const lapsed = fakeBox();
    reauth(lapsed, null);
    expect(screen.getByRole('button', { name: /Start the sign-in|Sign in/ })).toBeDisabled();
    expect(lapsed.sc.accountAuthStart).not.toHaveBeenCalled();
    cleanup();

    const b = fakeBox();
    showing(b);
    reauth(b);
    fireEvent.click(screen.getByRole('button', { name: /Start the sign-in|Sign in/ }));
    await settle();
    await settle();
    expect(b.sc.accountAuthStart).toHaveBeenCalledWith('lane-g', { method: 'openai-login' });
    expect(screen.getByLabelText(DEVICE_CODE_LABEL)).toHaveTextContent(CODE);
    at(b, 'done');
    await poll();
    await settle();
    expect(b.client.accountCheck).toHaveBeenCalledWith('lane-g');
    expect(screen.getByText(reauthRestartLead(1, 'openai-login', 'unsure'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restart/ })).toBeEnabled();
    expect(screen.getByText(COMPROMISE_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('an Off lane signed in again says so from its check, and a check that failed does not', async () => {
    const off = fakeBox();
    showing(off);
    reauth(off);
    fireEvent.click(screen.getByRole('button', { name: /Start the sign-in|Sign in/ }));
    await settle();
    await settle();
    at(off, 'done');
    await poll();
    await settle();
    expect(document.querySelector('[data-frame="reauthed"] .acct-result-word')).toHaveAttribute('data-state', 'off');
    expect(screen.getByText(CHATGPT_SIGNED_IN)).toBeInTheDocument();
    cleanup();

    const dead = fakeBox();
    dead.client.accountCheck.mockResolvedValue({ ok: true, lane: wired(true, 'auth-dead') });
    showing(dead);
    reauth(dead);
    fireEvent.click(screen.getByRole('button', { name: /Start the sign-in|Sign in/ }));
    await settle();
    await settle();
    at(dead, 'done');
    await poll();
    await settle();
    expect(document.querySelector('[data-frame="reauthed"]')).not.toBeNull();
    expect(screen.queryByText(CHATGPT_SIGNED_IN)).toBeNull();
  });

  it('a cancelled one says what the lane keeps, and a lane with none is offered no token', async () => {
    expect(reauthEnd('lane-g', 'openai-login', 'cancelled', undefined, 'kept')).toBe(`Cancelled. ${credentialUntouched('lane-g', 'openai-login')}`);
    expect(credentialUntouched('lane-g', 'openai-login')).toBe('Nothing changed: lane-g keeps its old sign-in.');
    for (const k of ['expired', 'untrusted', 'cancelled', 'failed'] as const) {
      expect(reauthEnd('lane-g', 'openai-login', k, undefined, 'signed-out')).toContain('until it has a sign-in again');
      expect(reauthEnd('lane-g', 'openai-login', k, undefined, 'signed-out')).not.toContain('token');
    }
    expect(reauthIntro('lane-g', 'openai-login', 'signed-out')).not.toContain('token');
  });

  it('the card and the fold offer it only where the fleet runs the ChatGPT sign-in', () => {
    expect(troubleActs('signed-out', 'codex', true, true).map((a) => [a.act, a.primary])).toEqual([['sign-in-again', true]]);
    expect(troubleActs('signed-out', 'codex', true, false)).toEqual([]);
    expect(troubleActs('signed-out', 'codex', false, true)).toEqual([]);
    expect(troubleActs('signed-in', 'codex', true, true)).toEqual([]);
    screenWith({ ...CONNECT(), caps: ['account-v2', 'account-auth-v1'] });
    expect(within(card('lane-g')).queryByRole('button', { name: SIGN_IN_AGAIN })).toBeNull();
  });

  it("neither offers it on an OpenAI lane ccrc only records: the verb's install step would refuse the sign-in", () => {
    const roster = [...ROSTER, EXTERNAL, lane('lane-y')];
    screenWith(CONNECT(), roster, { 'lane-a': LANE_READY, 'lane-g': LANE_READY, 'lane-x': OUT, 'lane-y': OUT });
    expect(within(card('lane-g')).getAllByRole('button', { name: SIGN_IN_AGAIN })).toHaveLength(1);
    for (const id of ['lane-x', 'lane-y']) {
      expect(card(id).querySelector('.acct-trouble'), id).not.toBeNull();
      expect(within(card(id)).queryByRole('button', { name: SIGN_IN_AGAIN }), id).toBeNull();
    }
    expect(managedCodex(EXTERNAL)).toBe(false);
    expect(managedCodex(lane('lane-y')), 'an older server does not say').toBe(false);
    expect(managedCodex(ROSTER[1])).toBe(true);
    expect(managedCodex(undefined)).toBe(false);
  });
});

describe('resume (spec §6.2): a device sign-in waits at `url`', () => {
  const held = (state: 'url' | 'waiting-code' | 'starting', method: 'openai-login' | 'login'): LaneWire => ({
    ...LANE_NEW, authAttempt: { state, expiresAt: Date.now() + 300_000, mine: true, attemptId: ATTEMPT, method },
  });

  it('counts as waiting on the operator at `url`, which a pasted-code method does not', () => {
    expect(waitsOnOperator('openai-login', 'url')).toBe(true);
    expect(waitsOnOperator('login', 'url')).toBe(false);
    expect(waitsOnOperator('login', 'waiting-code')).toBe(true);
    expect(waitsOnOperator('openai-login', 'starting')).toBe(false);
    expect(resumableAttempt({ 'lane-g': held('url', 'openai-login') }, Date.now())?.id).toBe('lane-g');
    expect(resumableAttempt({ 'lane-a': held('url', 'login') }, Date.now())).toBeNull();
  });

  it('the banner says what it waits for, and the sheet it reopens is the one that started it', () => {
    expect(resumeBannerText('lane-g', 4, 'openai-login')).toBe('A sign-in for lane-g is waiting for you to approve it · 4 min left');
    expect(resumeSheetFor('codex', 'openai-login', false)).toBe('connect');
    expect(resumeSheetFor('codex', 'openai-login', true)).toBe('reauth');
  });

  it("a resumed connect sheet is OpenAI's, and brings back the card with its first poll", async () => {
    const b = fakeBox();
    showing(b);
    const h = heldAttemptOf(held('url', 'openai-login'), Date.now())!;
    sheet(b, { resume: { id: 'lane-g', held: h } });
    await settle();
    await settle();
    expect(b.sc.accountAuthStart).not.toHaveBeenCalled();
    expect(screen.getByLabelText(DEVICE_CODE_LABEL)).toHaveTextContent(CODE);
    expect(ledgerText()).toContain('… waiting for you to approve');
  });
});

describe("Remove's Codex line (spec §11 step 4, G20)", () => {
  const CHECK: AccountRemoveCheckAnswer = {
    ok: true, fleetIdentity: null,
    check: { live: 0, sleeping: [], archived: 0, upstream: false, otherHomeAble: 1, authInProgress: false, discardable: false, at: Date.now() },
  };
  const REMOVED: AccountRemoveAnswer = {
    ok: true, roster: [ROSTER[0]!], removed: ['~/.local/share/ccrc/codex/lane-g-abc123'], kept: [], rehomed: [],
    atProvider: [{ kind: 'codex', state: 'still-valid', revokeAt: 'chatgpt-settings' }],
  };
  const open = async (id: string, onLane: LaneWire = LANE_READY, extra?: RosterWire): Promise<{ [K in keyof RemoveClient]: Mock<RemoveClient[K]> }> => {
    const rows = [...ROSTER, EXTERNAL, ...(extra === undefined ? [] : [extra])];
    const client = {
      accountRemoveCheck: vi.fn<RemoveClient['accountRemoveCheck']>(async () => CHECK),
      accountRemove: vi.fn<RemoveClient['accountRemove']>(async () => REMOVED),
      accountRevokeAck: vi.fn<RemoveClient['accountRevokeAck']>(async () => ({ ok: true as const })),
    };
    const store = createFleetStore({ makeSocket: () => ({ close: () => {}, send: () => {} }) as never });
    act(() => { store.setState({ conn: 'open', sessions: [], roster: rows, usage: [] }); });
    render(
      <RemoveSheet
        id={id} open onClose={vi.fn()} lane={onLane} connect={CONNECT()} blocked={null} refresh={vi.fn(async () => 'ok' as const)}
        readRoster={() => rows} client={client} wake={vi.fn(async () => {})} fleet={store}
      />,
    );
    await settle();
    await settle();
    return client;
  };
  const remove = async (id: string): Promise<void> => {
    fireEvent.change(screen.getByLabelText(typedConfirmLabel(id)), { target: { value: id } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Remove ${id}`) }));
    await settle();
    await settle();
  };

  it('the remove sheet\'s Codex line is on by default, and what it sends is what it says', async () => {
    const c = await open('lane-g');
    expect(screen.getByRole('checkbox', { name: CODEX_FOLDER_LINE })).toHaveAttribute('aria-checked', 'true');
    await remove('lane-g');
    expect(c.accountRemove).toHaveBeenCalledWith('lane-g', { mode: 'remove', confirmId: 'lane-g', codexAuth: 'delete' });
  });

  it('turned off, it says the folder stays and asks the verb to keep it', async () => {
    const c = await open('lane-g');
    fireEvent.click(screen.getByRole('checkbox', { name: CODEX_FOLDER_LINE }));
    expect(screen.getByText(CODEX_FOLDER_KEPT)).toBeInTheDocument();
    await remove('lane-g');
    expect(c.accountRemove).toHaveBeenCalledWith('lane-g', { mode: 'remove', confirmId: 'lane-g', codexAuth: 'keep' });
  });

  it('the sentence above the line follows it: turned off, nothing on the frame says the credential is deleted', async () => {
    await open('lane-g');
    const on = removeConsequence('lane-g', 'delete');
    const off = removeConsequence('lane-g', 'keep');
    expect(screen.getByText(on)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: CODEX_FOLDER_LINE }));
    expect(screen.getByText(off)).toBeInTheDocument();
    expect(screen.queryByText(on)).toBeNull();
    expect(document.querySelector('[data-frame="remove"]')?.textContent).not.toMatch(/deletes[^.]*(credential|sign-in)/i);
    expect(off).toBe('Removing lane-g deletes everything that runs it on the fleet host. Its ChatGPT sign-in folder, config folder and transcripts stay.');
    fireEvent.click(screen.getByRole('checkbox', { name: CODEX_FOLDER_LINE }));
    expect(screen.getByText(on)).toBeInTheDocument();
  });

  it('turned on, it claims no more than the verb: a folder that is not safe to delete stays, so it says "if"', async () => {
    await open('lane-g');
    const on = removeConsequence('lane-g', 'delete');
    expect(on).toContain("its ChatGPT sign-in folder if that's safe to delete");
    expect(on).not.toMatch(/credential/i);
  });

  it('a lane with no such line keeps its own sentence', async () => {
    await open('lane-a');
    expect(screen.getByText(removeConsequence('lane-a'))).toBeInTheDocument();
    expect(removeConsequence('lane-a')).toMatch(/deletes its credential/);
  });

  it("a lane ccrc only records keeps its launcher and its credential, which is what the verb does, and the sentence says so (D-8051 (13))", async () => {
    await open('lane-x');
    const line = 'Removing lane-x takes it off the fleet host\'s roster, with the records kept about it. '
      + 'Its launcher, whatever credential that launcher uses, its config folder and its transcripts stay: ccrc only records this lane.';
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(document.querySelector('[data-frame="remove"]')?.textContent).not.toMatch(/deletes/i);
  });

  it('every lane ccrc only records reads that way, whichever provider its row names, or none', async () => {
    const line = /^Removing lane-w takes it off/;
    const { provider: _p, kind: _k, ...undeclared } = lane('lane-w', { managed: false });
    const rows: RosterWire[] = [
      lane('lane-w', { provider: 'anthropic', kind: 'token', managed: false }), lane('lane-w', { provider: 'openrouter', kind: 'key', managed: false }), undeclared,
    ];
    for (const row of rows) {
      await open('lane-w', LANE_READY, row);
      expect(screen.getByText(line), row.provider).toBeInTheDocument();
      cleanup();
    }
    // A row that doesn't say is not a recorded lane: `managed` is absent on every lane ccrc runs but a Codex one.
    expect(recordedOnly(lane('lane-w', { provider: 'anthropic', kind: 'token' }))).toBe(false);
    expect(recordedOnly(undefined)).toBe(false);
    expect(recordedOnly(ROSTER[1])).toBe(false);
    expect(recordedOnly(EXTERNAL)).toBe(true);
  });

  it("turned off, it promises only what the box does: on a Signed-out lane too, it never says the sign-in works", async () => {
    await open('lane-g', wired(false, 'auth-dead'));
    fireEvent.click(screen.getByRole('checkbox', { name: CODEX_FOLDER_LINE }));
    expect(screen.getByText(CODEX_FOLDER_KEPT)).toBeInTheDocument();
    expect(CODEX_FOLDER_KEPT).toBe('The folder stays on the fleet host, and whatever sign-in it holds is not deleted.');
    expect(CODEX_FOLDER_KEPT).not.toMatch(/work|valid|signed in/i);
  });

  it('an OpenAI lane ccrc only records has no folder step, so it has no such line and sends no such field', async () => {
    const c = await open('lane-x');
    expect(screen.queryByRole('checkbox', { name: CODEX_FOLDER_LINE })).toBeNull();
    expect(screen.queryByText(CODEX_FOLDER_KEPT)).toBeNull();
    await remove('lane-x');
    expect(c.accountRemove).toHaveBeenCalledWith('lane-x', { mode: 'remove', confirmId: 'lane-x' });
  });

  it('the line is held while the remove is in flight, so the sentence cannot disagree with what was sent', async () => {
    const c = await open('lane-g');
    c.accountRemove.mockReturnValue(new Promise(() => {}));
    const line = screen.getByRole('checkbox', { name: CODEX_FOLDER_LINE });
    expect(line).toBeEnabled();
    await remove('lane-g');
    expect(c.accountRemove).toHaveBeenCalledWith('lane-g', { mode: 'remove', confirmId: 'lane-g', codexAuth: 'delete' });
    expect(line).toBeDisabled();
    fireEvent.click(line);
    expect(line).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(removeConsequence('lane-g', 'delete'))).toBeInTheDocument();
  });

  it('the ledger links chatgpt.com, and any other lane has no such line', async () => {
    await open('lane-g');
    await remove('lane-g');
    expect(screen.getByRole('link', { name: /chatgpt\.com/ })).toBeInTheDocument();
    expect(document.body.textContent).toContain('Remove it at');
    cleanup();
    const c = await open('lane-a');
    expect(screen.queryByRole('checkbox', { name: CODEX_FOLDER_LINE })).toBeNull();
    await remove('lane-a');
    expect(c.accountRemove).toHaveBeenCalledWith('lane-a', { mode: 'remove', confirmId: 'lane-a' });
  });
});
