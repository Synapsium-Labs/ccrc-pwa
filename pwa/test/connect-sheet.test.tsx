// The Add account door and the connect sheet (accounts plan Task A18, D-5522, D-7740; spec §5, §6.1, §6.3, §12.3–§12.5).
// Anthropic Paste end to end against a fake box: the door per width and each of its narrowings, the provider and method
// rows narrowed by their cap words, the radio read from the provider table, the hue default, `config-dir-exists`, an
// outcome unknown, the result frame, offline, and the live region. The secret field's own rules are
// `secret-field.test.tsx`'s.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccountAddBody, AccountsConnect, LaneWire, RosterWire } from '../../shared/api';
import { newLaneConfigSuffix } from '../../shared/roster';
import { PROVIDERS } from '../../shared/providers';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { ConnectSheet, type ConnectClient, type ConnectSheetProps } from '../src/accounts/ConnectSheet';
import { defaultHue, methodChoices } from '../src/accounts/connectFlow';
import {
  DOOR_NARROWED, LEDGER, METHOD_LINES, NEEDS_FLEET_UPDATE, OUTCOME_UNKNOWN, notFoundAfterUnknown, offlineRefusal,
  resultDone,
} from '../src/fleet/accountWords';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

const lane = (id: string, hue: RosterWire['hue']): RosterWire => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token',
});
const ROSTER: RosterWire[] = [lane('lane-a', 'cyan'), lane('lane-b', 'violet')];
const FRESH = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: Date.now() + 300_000,
});
const LANE_READY: LaneWire = { state: { word: 'signed-in', source: 'checked just now' }, ready: true };
const LANE_NEW: LaneWire = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
const TOKEN = 'sk-ant-oat01-' + 'Q'.repeat(60);

/** A viewport `width` px wide: every `(min-width: Npx)` answers from it (inspector-hide.test.tsx's stub). */
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

/** A fake box: each route a spy, answering what the case says. */
function fakeClient(o: Partial<ConnectClient> = {}): { [K in keyof ConnectClient]: Mock<ConnectClient[K]> } {
  return {
    accountAdd: vi.fn<ConnectClient['accountAdd']>(o.accountAdd ?? (async () => ({ ok: true as const, roster: ROSTER, lane: LANE_NEW, fleetIdentity: null }))),
    accountCheck: vi.fn<ConnectClient['accountCheck']>(o.accountCheck ?? (async () => ({ ok: true as const, lane: LANE_READY }))),
    accountEnable: vi.fn<ConnectClient['accountEnable']>(o.accountEnable ?? (async () => ({ ok: true as const, roster: ROSTER, lane: LANE_READY }))),
  };
}

function sheet(over: Partial<ConnectSheetProps> = {}): { props: ConnectSheetProps; rerender: (p: Partial<ConnectSheetProps>) => void } {
  const props: ConnectSheetProps = {
    open: true, onClose: vi.fn(), roster: ROSTER, connect: FRESH(), offline: null,
    refresh: vi.fn(async () => {}), readRoster: () => ROSTER, client: fakeClient(), ...over,
  };
  const r = render(<ConnectSheet {...props} />);
  return { props, rerender: (p) => { Object.assign(props, p); r.rerender(<ConnectSheet {...props} />); } };
}

/** Provider → Name it → Method, with the lane named `id`. */
function toMethod(id = 'lane-c'): void {
  fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lane C' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}
const field = (): HTMLInputElement => screen.getByLabelText('Paste the token') as HTMLInputElement;
const paste = (v = TOKEN): void => { fireEvent.input(field(), { target: { value: v } }); };
const addLane = (): void => { fireEvent.click(screen.getByRole('button', { name: 'Add lane' })); };
/** The one element showing `text` on the sheet, outside the live region (which repeats what it announces). */
const shown = async (text: string | RegExp): Promise<HTMLElement> => {
  let el: HTMLElement | undefined;
  await waitFor(() => {
    const all = screen.getAllByText(text).filter((e) => e.closest('.sr-only') === null);
    expect(all).toHaveLength(1);
    el = all[0];
  });
  return el!;
};
const later = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 5));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({
    sessions: [], conn: 'connecting', notices: [], blocked: false,
    usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
});

describe('the door (D-5522)', () => {
  const show = (connect: AccountsConnect | null, landed = true): void => {
    act(() => useFleetStore.setState({ usage: landed ? [] : null, roster: ROSTER, accountsConnect: connect, lanes: null }));
  };

  it('one door per width, and it narrows in place with each reason', () => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    // A phone: the lane list's last row, and nowhere else.
    show(FRESH());
    const { unmount } = render(<AccountsScreen />);
    const doors = screen.getAllByRole('button', { name: /Add account/ });
    expect(doors).toHaveLength(1);
    const list = document.querySelector('.accounts-list')!;
    expect(list.lastElementChild?.matches('.acct-door') || list.querySelector(':scope > .acct-door') === doors[0]).toBe(true);
    expect(doors[0]!).not.toHaveAttribute('aria-disabled');
    unmount();

    // A desk: the page header's action, and nowhere else.
    stubWidth(1280);
    const desk = render(<AccountsScreen />);
    const deskDoors = screen.getAllByRole('button', { name: /Add account/ });
    expect(deskDoors).toHaveLength(1);
    expect(deskDoors[0]!.closest('.accounts-list')).toBeNull();
    desk.unmount();
    vi.unstubAllGlobals();

    // Each narrowing: the door stays, aria-disabled, its reason beneath it and named by it; a tap opens nothing.
    const cases: [AccountsConnect | null, boolean, string][] = [
      [null, true, DOOR_NARROWED['gate-dark'].text],
      [{ ...FRESH(), origin: 'insecure' }, true, DOOR_NARROWED['insecure-origin'].text],
      [{ ...FRESH(), accountOps: 'unsupported', caps: [] }, true, DOOR_NARROWED.unsupported.text],
      [FRESH(), false, DOOR_NARROWED.waiting.text],
    ];
    for (const [connect, landed, text] of cases) {
      show(connect, landed);
      const r = render(<AccountsScreen />);
      const door = screen.getByRole('button', { name: /Add account/ });
      expect(door, text).toHaveAttribute('aria-disabled', 'true');
      const reason = document.getElementById(door.getAttribute('aria-describedby')!)!;
      expect(reason).toHaveTextContent(text);
      fireEvent.click(door);
      expect(screen.queryByRole('dialog'), text).toBeNull();
      r.unmount();
    }
  });

  it('opens the sheet at the provider frame when nothing narrows it', () => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    show(FRESH());
    render(<AccountsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Add account/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /Anthropic/ })).toBeInTheDocument();
    // OpenAI and OpenRouter narrow in place: their cap words are later waves'.
    expect(within(dialog).getAllByText(NEEDS_FLEET_UPDATE)).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: /OpenAI/ })).toBeNull();
  });
});

describe('offline (spec §12.5)', () => {
  it('offline, every act on the screen and in the sheet is refused with its sentence and the read-line, and no request is sent', () => {
    const accounts = vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    const writes = [vi.spyOn(api, 'accountAdd'), vi.spyOn(api, 'accountCheck'), vi.spyOn(api, 'accountEnable'),
      vi.spyOn(api, 'accountDisable'), vi.spyOn(api, 'stepUpStart')];
    const readAt = Date.now() - 4 * 60_000;
    act(() => useFleetStore.setState({
      conn: 'down', usage: [], roster: ROSTER, accountsConnect: FRESH(), accountsReadAt: () => readAt,
      lanes: {
        'lane-a': LANE_READY,
        'lane-b': { state: { word: 'signed-out', source: 'checked 1h ago' }, ready: false, notReadyReason: 'check-failed' },
      },
    }));
    const sentence = offlineRefusal(readAt, Date.now());
    expect(sentence).toBe("You're offline: nothing was sent. Read 4m ago.");
    render(<AccountsScreen />);
    // The door: narrowed in place with the sentence.
    const door = screen.getByRole('button', { name: /Add account/ });
    expect(door).toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById(door.getAttribute('aria-describedby')!)).toHaveTextContent(sentence);
    fireEvent.click(door);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The knob and Check on every card: disabled or gone, each with the sentence beneath.
    for (const sw of screen.getAllByRole('switch')) expect(sw).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Check/ })).toBeNull();
    expect(screen.getAllByText(sentence).length).toBeGreaterThanOrEqual(3);
    for (const w of writes) expect(w).not.toHaveBeenCalled();
    accounts.mockRestore();

    // The sheet, opened before the link dropped: every frame's primary refused, the sentence above them.
    cleanup();
    const client = fakeClient();
    sheet({ offline: sentence, client });
    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anthropic/ })).toBeNull();
    for (const f of Object.values(client)) expect(f).not.toHaveBeenCalled();
  });

  it('offline, no secret field is rendered', () => {
    const { rerender } = sheet();
    toMethod();
    expect(field()).toBeInTheDocument();
    paste();
    rerender({ offline: offlineRefusal(null, Date.now()) });
    expect(screen.queryByLabelText('Paste the token')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add lane' })).toBeDisabled();
  });
});

describe('announcements (spec §12.4)', () => {
  it('a step change lands in a role="status" region and a terminal state in a role="alert" one, each once', async () => {
    const said: { kind: string; text: string }[] = [];
    const watch = new MutationObserver(() => {
      for (const kind of ['status', 'alert'] as const) {
        const t = screen.getByTestId(`connect-${kind}`).textContent ?? '';
        const last = [...said].reverse().find((s) => s.kind === kind);
        if (t !== '' && last?.text !== t) said.push({ kind, text: t });
      }
    });
    const { rerender } = sheet({ client: fakeClient({
      accountAdd: () => later({ ok: true as const, roster: ROSTER, lane: LANE_NEW, fleetIdentity: null }),
      accountCheck: () => later({ ok: true as const, lane: LANE_READY }),
    }) });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    expect(screen.getByTestId('connect-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('connect-alert')).toHaveAttribute('role', 'alert');
    toMethod();
    paste();
    addLane();
    await screen.findByRole('button', { name: 'Turn it on' });
    rerender({});
    rerender({});
    await act(async () => { await Promise.resolve(); });
    watch.disconnect();
    const statuses = said.filter((s) => s.kind === 'status').map((s) => s.text);
    const alerts = said.filter((s) => s.kind === 'alert').map((s) => s.text);
    expect(statuses).toContain(LEDGER.adding('lane-c'));
    expect(statuses).toContain(LEDGER.checking('lane-c'));
    expect(statuses).not.toContain(resultDone('lane-c', false));
    // The terminal state, as an alert, once; the re-renders after it announced nothing.
    expect(alerts).toEqual([resultDone('lane-c', false)]);
    expect(statuses.filter((t) => t === LEDGER.checking('lane-c'))).toHaveLength(1);
  });
});

describe('Name it (spec §5)', () => {
  it('a taken hue is selectable and the least-used is the default', () => {
    // Every hue is worn; cyan and green twice. The least-used, in HUES order, is violet: never cyan, the first hue.
    const worn: RosterWire[] = [
      lane('lane-a', 'cyan'), lane('lane-b', 'cyan'), lane('lane-c', 'violet'), lane('lane-d', 'blue'),
      lane('lane-e', 'magenta'), lane('lane-f', 'amber'), lane('lane-g', 'green'), lane('lane-h', 'green'),
    ];
    expect(defaultHue(worn)).toBe('violet');
    expect(defaultHue([lane('lane-a', 'cyan')])).toBe('violet');
    expect(defaultHue([lane('lane-a', 'violet'), lane('lane-b', 'blue')])).toBe('cyan');
    sheet({ roster: worn });
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    expect(screen.getByRole('radio', { name: /violet/ })).toBeChecked();
    const cyan = screen.getByRole('radio', { name: /cyan/ });
    expect(cyan).toBeEnabled();
    expect(cyan.closest('label')).toHaveTextContent('also lane-a, lane-b');
    fireEvent.click(cyan);
    expect(cyan).toBeChecked();
  });

  it('the id is checked live against the rule, the reserved ids and the roster; the folder is derived read-only', () => {
    sheet();
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'L' } });
    const name = screen.getByLabelText('Name');
    const cont = screen.getByRole('button', { name: 'Continue' });
    for (const [v, text] of [['Lane', /Lowercase letters/], ['auth', /reserved/], ['lane-a', /already a lane named lane-a/]] as const) {
      fireEvent.change(name, { target: { value: v } });
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(cont).toBeDisabled();
    }
    fireEvent.change(name, { target: { value: 'claude-x' } });
    expect(screen.getByText('Config folder ~/.claude-x · wrapper claude-x')).toBeInTheDocument();
    expect(cont).toBeEnabled();
    // The verb's rule, held to its cases (G4): `.<id>` when the id already starts `claude-`.
    expect(newLaneConfigSuffix('claude-a')).toBe('.claude-a');
    expect(newLaneConfigSuffix('lane-b')).toBe('.claude-lane-b');
  });

  it("`config-dir-exists` offers both choices, and Use what's there asks for step-up", async () => {
    const add = vi.fn<ConnectClient['accountAdd']>()
      .mockRejectedValueOnce(new ApiError(409, { error: 'config-dir-exists', signedIn: false }))
      .mockResolvedValue({ ok: true, roster: ROSTER, lane: LANE_NEW, fleetIdentity: null });
    const passphrase = vi.fn(async () => ({ ok: true as const, stepUpFreshUntil: Date.now() + 300_000 }));
    const stepUpDeps = {
      client: {
        stepUpStart: vi.fn(async () => ({ challengeB64url: 'c', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] })),
        stepUpFinish: vi.fn(), stepUpPassphrase: passphrase,
      },
    };
    const { rerender } = sheet({ client: fakeClient({ accountAdd: add }), stepUpDeps });
    toMethod();
    paste();
    addLane();
    // Both choices, Pick another name first (the default) and primary.
    const pick = await screen.findByRole('button', { name: 'Pick another name' });
    const use = screen.getByRole('button', { name: "Use what's there" });
    expect(pick.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pick.className).toMatch(/btn-primary/);
    await shown(/still there · signed out/);
    // The step-up lapses before the operator chooses.
    rerender({ connect: { ...FRESH(), stepUpFreshUntil: Date.now() - 1 } });
    fireEvent.click(use);
    // Back at the method frame: Confirm it's you before the add, and the add waits for it.
    paste();
    await screen.findByRole('button', { name: 'Confirm with passphrase' });
    expect(screen.getByRole('button', { name: 'Add lane' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add lane' })).toBeEnabled());
    addLane();
    await screen.findByRole('button', { name: 'Turn it on' });
    expect(add).toHaveBeenCalledTimes(2);
    expect((add.mock.calls[1]![0] as AccountAddBody).adopt).toBe(true);
    expect((add.mock.calls[0]![0] as AccountAddBody).adopt).toBeUndefined();
  });
});

describe('Method (spec §6.1)', () => {
  /** A20's order: Mint first. */
  const A20 = { ...PROVIDERS, anthropic: { connect: ['setup-token', 'login', 'paste'] as const } };
  const withAuth = { ...FRESH(), caps: ['account-v2', 'account-auth-v1'] } as unknown as AccountsConnect;

  it('Mint is the default when `account-auth-v1` is present, and narrowed with Paste selected when it is not', () => {
    expect(methodChoices('anthropic', withAuth, A20).selected).toBe('setup-token');
    const today = methodChoices('anthropic', FRESH());
    expect(today.selected).toBe('paste');
    expect(today.choices.filter((c) => c.narrowed !== null).map((c) => c.value).sort()).toEqual(['login', 'setup-token']);
    // Drawn: Paste checked; Mint and Sign in disabled in place, with their reason.
    sheet({ table: A20 });
    toMethod();
    expect(screen.getByRole('radio', { name: /Paste a token/ })).toBeChecked();
    for (const n of [/Mint a long-lived token/, /Sign in with Claude/]) {
      const r = screen.getByRole('radio', { name: n });
      expect(r).toBeDisabled();
      expect(r.closest('label')).toHaveTextContent(NEEDS_FLEET_UPDATE);
    }
    cleanup();
    sheet({ table: A20, connect: withAuth });
    toMethod();
    expect(screen.getByRole('radio', { name: /Mint a long-lived token/ })).toBeChecked();
  });

  it("the radio order is the table's", () => {
    const names = (): string[] => screen.getAllByRole('radio').map((r) => {
      const t = r.closest('label')?.textContent ?? '';
      return (Object.values(METHOD_LINES).find((m) => t.includes(m.name))?.name) ?? t;
    });
    sheet({ table: { ...PROVIDERS, anthropic: { connect: ['paste', 'setup-token', 'login'] } } });
    toMethod();
    expect(names()).toEqual(['Paste a token', 'Mint a long-lived token', 'Sign in with Claude']);
    cleanup();
    sheet({ table: { ...PROVIDERS, anthropic: { connect: ['login', 'paste', 'setup-token'] } } });
    toMethod();
    expect(names()).toEqual(['Sign in with Claude', 'Paste a token', 'Mint a long-lived token']);
  });
});

describe('Run and Result (spec §6.2, §6.3, §12.3)', () => {
  it('outcome unknown re-reads the roster and resumes; no second add is sent', async () => {
    const client = fakeClient({ accountAdd: async () => { throw new ApiError(502, { error: 'outcome-unknown' }); } });
    let held = ROSTER;
    const refresh = vi.fn(async () => { held = [...ROSTER, lane('lane-c', 'blue')]; });
    sheet({ client, refresh, readRoster: () => held });
    toMethod();
    paste();
    addLane();
    await screen.findByRole('button', { name: 'Turn it on' });
    await shown(OUTCOME_UNKNOWN);
    await shown(LEDGER.found('lane-c'));
    expect(client.accountAdd).toHaveBeenCalledTimes(1);
    expect(client.accountCheck).toHaveBeenCalledWith('lane-c');
  });

  it('outcome unknown with no lane on the re-read says nothing was added, and sends nothing again', async () => {
    const client = fakeClient({ accountAdd: async () => { throw new TypeError('network'); } });
    sheet({ client });
    toMethod();
    paste();
    addLane();
    await shown(notFoundAfterUnknown('lane-c'));
    expect(field().value).toBe('');
    expect(client.accountAdd).toHaveBeenCalledTimes(1);
    expect(client.accountCheck).not.toHaveBeenCalled();
  });

  it('the result frame offers Turn it on and never closes itself', async () => {
    const client = fakeClient();
    const { props } = sheet({ client });
    toMethod();
    paste();
    addLane();
    const on = await screen.findByRole('button', { name: 'Turn it on' });
    expect(screen.getByRole('button', { name: 'Leave it off for now' })).toBeInTheDocument();
    await shown(/Checked: one test reply in \d+\.\d s/);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(on);
    await shown(LEDGER.on);
    expect(client.accountEnable).toHaveBeenCalledWith('lane-c');
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    // The add carried the paste, the provider, the name and the hue, and nothing a later wave adds.
    const body = client.accountAdd.mock.calls[0]![0] as AccountAddBody;
    expect(body).toEqual({ provider: 'anthropic', id: 'lane-c', label: 'Lane C', hue: 'blue', method: 'paste', credential: TOKEN });
  });

  it('a refused check holds Turn it on, with the refusal beneath it and Check again beside it (D-7740 (4))', async () => {
    let refuse = true;
    const client = fakeClient({
      accountCheck: async () => {
        if (refuse) throw new ApiError(409, { error: 'lane-act-refused', verbCode: 'probe-failed' });
        return { ok: true as const, lane: LANE_READY };
      },
    });
    sheet({ client });
    toMethod();
    paste();
    addLane();
    const on = await screen.findByRole('button', { name: 'Turn it on' });
    const text = 'The fleet host refused (probe-failed): lane-c was not checked.';
    await waitFor(() => expect(screen.getByTestId('connect-alert')).toHaveTextContent(text));
    expect(screen.getByTestId('connect-alert')).not.toHaveTextContent(resultDone('lane-c', false));
    expect(on).toBeDisabled();
    const reason = document.getElementById(on.getAttribute('aria-describedby')!)!;
    expect(reason).toHaveTextContent(text);
    // The words stand in the ledger and once on the result, beneath the held primary.
    expect(screen.getAllByText(text).filter((e) => e.closest('.sr-only') === null)).toHaveLength(2);
    expect(screen.queryByText(/Checked: one test reply/)).toBeNull();
    fireEvent.click(on);
    expect(client.accountEnable).not.toHaveBeenCalled();

    // Check again: this time the box answers ready, and Turn it on opens.
    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn it on' })).toBeEnabled());
    expect(client.accountCheck).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    await shown(/Checked: one test reply in \d+\.\d s/);
  });

  it('a check that never answers holds Turn it on the same way, and says so', async () => {
    const client = fakeClient({ accountCheck: async () => { throw new TypeError('network'); } });
    sheet({ client });
    toMethod();
    paste();
    addLane();
    const on = await screen.findByRole('button', { name: 'Turn it on' });
    const text = "The request didn't complete, so whether lane-c was checked is unknown. The screen reads it again.";
    await waitFor(() => expect(screen.getByTestId('connect-alert')).toHaveTextContent(text));
    expect(on).toBeDisabled();
    expect(document.getElementById(on.getAttribute('aria-describedby')!)).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
  });

  it('a refused paste says why from its code, and never the response text', async () => {
    const client = fakeClient({ accountAdd: async () => { throw new ApiError(400, { error: 'key-rejected', detail: 'PLANTED-TEXT' }); } });
    sheet({ client });
    toMethod();
    paste();
    addLane();
    await shown('That token was refused (HTTP 401). Nothing was saved.');
    expect(document.body.textContent).not.toContain('PLANTED-TEXT');
    expect(screen.getByTestId('connect-alert')).toHaveTextContent('That token was refused');
  });
});
