// D-8166 (test box connect plan TC16; spec 2026-11-07 §2.2 "Connected" and "Blocked", §2.6, §2.7, §2.9, §2.10, C6, C7, C9, C13): the
// connected card in jsdom, against a fake fleet whose status the routes answer and every act of which is read at the fetch, so the
// bytes an act sends are what is held. The step-up is the account sheets' own (`useStepUp`), driven through its `deps` seam.
// `browser/testbox-manage.browser.test.ts` holds what only an engine can say: the geometry at each width.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DESK_QUERY } from '@ccrc/ui';
import { TESTBOX_ADMIN_CODE_SENTENCE, TESTBOX_ADMIN_PHASES, type TestboxAdminStatus } from '../../../shared/testbox-admin';
import type { BoxSettingRow } from '../../../shared/api';
import { TESTBOX_PROTO, type StatusAnswer } from '../../../shared/testbox';
import type { StepUpDeps } from '../accounts/useStepUp';
import { SETTINGS_CARDS } from './settingsText';
import { TESTBOX_WIDE_QUERY, TestBoxSection } from './TestBoxSection';
import { TestBoxManage, type TestBoxManageProps } from './TestBoxManage';
import { TESTBOX_CONNECT_TEXT, TESTBOX_MANAGE_TEXT, codeSentence, fleetRowsOf, ledgerLine, manageRowLine } from './testboxAdminWords';
import type { TestboxBlock, TestboxBlockAdmin, TestboxPoll } from './useTestboxView';

const T = TESTBOX_MANAGE_TEXT;
const C = TESTBOX_CONNECT_TEXT;
const ADDRESS = '192.0.2.7';
const FP = `SHA256:${'A'.repeat(43)}`;
const NEW_FP = `SHA256:${'N'.repeat(43)}`;
const LINE = `from="192.0.2.2" ssh-ed25519 ${'B'.repeat(68)} ccrc-testbox`;
const SHA = 'f'.repeat(64);

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const baseStatus = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus => ({
  v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null,
  boxSettings: null, boxSettingsAt: null, parity: null, ...over,
});
const BOX_ROWS: BoxSettingRow[] = [
  { key: 'CCRC_TESTBOX_RUNS', state: 'ok', value: '2', from: 'default' },
  { key: 'CCRC_TESTBOX_WORKERS', state: 'ok', value: '2', from: 'file' },
  { key: 'CCRC_TESTBOX_RUN_MEMORY_MAX', state: 'ok', value: '4G', from: 'file' },
  { key: 'CCRC_TESTBOX_LISTEN', state: 'ok', from: 'file' },
  { key: 'CCRC_TESTBOX_OS_MIRROR', state: 'ok', from: 'default' },
];
const connected = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus => baseStatus({
  connected: true, addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP, boxFileSha256: SHA, boxSettings: BOX_ROWS, boxSettingsAt: 1, ...over,
});
const FLEET_ROWS: BoxSettingRow[] = [
  { key: 'CCRC_TESTBOX_BUDGET', state: 'ok', value: '30m', from: 'file' },
  { key: 'CCRC_TESTBOX_QUEUE_LIMIT', state: 'ok', value: '8', from: 'default' },
  { key: 'CCRC_TESTBOX_URL', state: 'ok', from: 'file' },
  { key: 'CCRC_TESTBOX_TOKEN_FILE', state: 'ok', from: 'default' },
];
const actState = (over: Partial<NonNullable<TestboxAdminStatus['act']>> = {}): NonNullable<TestboxAdminStatus['act']> => ({
  id: 'a'.repeat(32), sub: 'repair', phase: 'copy', phases: [{ name: 'verify', ms: 800 }], outcome: 'running', code: null, startedAt: 1, endedAt: null, ...over,
});
const event = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, at: Date.parse('2026-11-10T12:00:00Z') + id * 60_000, actor: 'phone a1b2c3d4', act: 'repair', actId: null, outcome: 'ok', code: null, fingerprint: null, fleetIdentity: null, ...over,
});

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

function fakeFleet(first: TestboxAdminStatus = connected(), events: Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const box = {
    status: first,
    events,
    on: {} as Record<string, (body: { fields?: Record<string, unknown> }) => { result?: Record<string, unknown>; refuse?: Response } | void>,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === '/api/testbox/admin' && method === 'GET') return json(200, { ok: true, status: box.status, events: box.events });
    const sub = /^\/api\/testbox\/admin\/([a-z-]+)$/.exec(path)?.[1];
    if (sub !== undefined && method === 'POST') {
      const out = box.on[sub]?.(body as { fields?: Record<string, unknown> });
      if (out?.refuse !== undefined) return out.refuse;
      return json(200, { ok: true, status: box.status, events: box.events, result: out?.result ?? {} });
    }
    return json(404, { ok: false, error: 'not-found' });
  }));
  const posts = (sub?: string): Call[] => calls.filter((c) => c.method === 'POST' && (sub === undefined || c.path === `/api/testbox/admin/${sub}`));
  return { box, calls, posts };
}
const refused = (status: number, error: string, extra: Record<string, unknown> = {}): Response => json(status, { ok: false, error, ...extra });

const stepUpDeps = (): StepUpDeps => ({
  client: {
    stepUpStart: async () => ({ challengeB64url: 'AAAA', rpId: 'box.invalid', allowCredentialIdsB64url: [] }),
    stepUpFinish: async () => ({ ok: true, stepUpFreshUntil: Date.now() + 300_000 }),
    stepUpPassphrase: async () => ({ ok: true, stepUpFreshUntil: Date.now() + 300_000 }),
  } as unknown as NonNullable<StepUpDeps['client']>,
});

const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const manage = (): HTMLElement => document.querySelector<HTMLElement>('[data-testbox="manage"]')!;
const mount = async (props: Partial<TestBoxManageProps> = {}): Promise<ReturnType<typeof render>> => {
  const out = render(<TestBoxManage band="laptop" stepUpDeps={stepUpDeps()} {...props} />);
  await settle();
  return out;
};
const q = (sel: string): HTMLElement | null => manage().querySelector<HTMLElement>(sel);
const press = async (el: HTMLElement | null): Promise<void> => { expect(el).not.toBeNull(); fireEvent.click(el!); await settle(); };
const sheet = (): HTMLElement => document.querySelector<HTMLElement>('[data-testbox="sheet"]')!;
const setting = (key: string): HTMLInputElement => manage().querySelector<HTMLInputElement>(`[data-setting="${key}"] input`)!;
const openSettings = async (): Promise<void> => { await press(q('[data-testbox="settings-toggle"]')); };
const typeIn = (input: HTMLInputElement, value: string): void => { fireEvent.change(input, { target: { value } }); };

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the connected card: what it shows', () => {
  it('the address shows as set and never as text, and no answer carries it', async () => {
    fakeFleet(connected(), [event(1)]);
    await mount();
    expect(q('[data-testbox="address"]')!.textContent).toBe(T.addressSet);
    expect(manage().textContent).not.toContain(ADDRESS);
  });

  it('the fingerprint and the last act show', async () => {
    fakeFleet(connected(), [event(2, { act: 'settings-box', outcome: 'failed', code: 'install-failed' }), event(1)]);
    await mount();
    expect(q('[data-testbox="manage-fingerprint"]')!.textContent).toBe(FP);
    const last = q('[data-testbox="last-act"]')!.textContent!;
    expect(last).toContain('Box settings failed');
    expect(last).toContain(codeSentence('install-failed'));
    expect(last).not.toContain('Repair');
  });

  it('a card with no act yet says so, and a pinned key that is not there says not pinned', async () => {
    fakeFleet(connected({ fingerprint: null, hostKey: 'none' }));
    await mount();
    expect(q('[data-testbox="last-act"]')!.textContent).toBe(T.noActs);
    expect(q('[data-testbox="manage-fingerprint"]')!.textContent).toBe(T.hostKeyNone);
  });

  it('a card with no box connected draws nothing (the connect flow is the card then)', async () => {
    fakeFleet(baseStatus());
    await mount();
    expect(document.querySelector('[data-testbox="manage"]')).toBeNull();
  });

  it('the ledger shows one act on a phone and a laptop and ten on a wide screen', async () => {
    const events = Array.from({ length: 12 }, (_, i) => event(12 - i));
    fakeFleet(connected(), events);
    const phone = await mount({ band: 'phone' });
    expect(q('[data-testbox="manage-ledger"]')).toBeNull();
    expect(q('[data-testbox="last-act"]')!.textContent).toBe(ledgerLine(events[0] as never));
    phone.unmount();
    const laptop = await mount({ band: 'laptop' });
    expect(q('[data-testbox="manage-ledger"]')).toBeNull();
    laptop.unmount();
    await mount({ band: 'wide' });
    expect(q('[data-testbox="manage-ledger"]')!.querySelectorAll('li')).toHaveLength(10);
  });
});

describe('Settings', () => {
  it('shows the box rows by their display class: a value as typed, a path or an address as set, an unmeasured row as such', async () => {
    fakeFleet();
    await mount({ fleetRows: FLEET_ROWS });
    await openSettings();
    expect(setting('CCRC_TESTBOX_WORKERS').value).toBe('2');
    expect(setting('CCRC_TESTBOX_LISTEN').value).toBe('');
    expect(setting('CCRC_TESTBOX_LISTEN').placeholder).toBe(T.keepSet);
    const now = (key: string): string => q(`[data-setting="${key}"] [data-testbox="setting-now"]`)!.textContent!;
    expect(now('CCRC_TESTBOX_LISTEN')).toBe(T.shownSet);
    expect(now('CCRC_TESTBOX_OS_MIRROR')).toBe(T.shownNotSet);
    expect(now('CCRC_TESTBOX_RUNS')).toBe(`2 (${T.shownDefault})`);
    expect(now('CCRC_TESTBOX_ROOT')).toBe(T.shownUnmeasured);
    // The twelve editable fleet rows and the four pairing keys, set or not set.
    expect(manage().querySelectorAll('[data-group="fleet"] [data-family="fleet"] input')).toHaveLength(12);
    expect(q('[data-pairing="CCRC_TESTBOX_URL"] dd')!.textContent).toBe(T.pairingSet);
    expect(q('[data-pairing="CCRC_TESTBOX_TOKEN_FILE"] dd')!.textContent).toBe(T.pairingNotSet);
    expect(manage().querySelectorAll('[data-pairing]')).toHaveLength(4);
  });

  it('Settings sends only changed keys and shows the re-read values', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = (b) => {
      f.box.status = connected({ boxSettings: BOX_ROWS.map((r) => (r.key === 'CCRC_TESTBOX_WORKERS' ? { ...r, value: '3' } as BoxSettingRow : r)), boxSettingsAt: 2 });
      expect(b.fields).toEqual({ settings: { CCRC_TESTBOX_WORKERS: '3' } });
    };
    await mount();
    await openSettings();
    expect(q('[data-testbox="settings-save"]')).toBeDisabled();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '3');
    typeIn(setting('CCRC_TESTBOX_RUN_MEMORY_MAX'), '4G'); // the value it already has: not a change
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-box')).toHaveLength(1);
    expect(f.posts('settings-fleet')).toHaveLength(0);
    expect(f.posts('settings-box')[0]!.body).toEqual({ fields: { settings: { CCRC_TESTBOX_WORKERS: '3' } } });
    // The form shows what the box answered, not what was typed.
    expect(setting('CCRC_TESTBOX_WORKERS').value).toBe('3');
    expect(screen.getByText(T.saved)).toBeInTheDocument();
  });

  it('a value off its key\'s shape is refused as typed, and a row only shown as set sends only what was typed', async () => {
    const f = fakeFleet();
    await mount();
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), 'many');
    expect(q('[data-testbox="settings-save"]')).toBeDisabled();
    expect(within(q('[data-setting="CCRC_TESTBOX_WORKERS"]')!).getByRole('status').textContent).toContain('whole number');
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '2');
    typeIn(setting('CCRC_TESTBOX_LISTEN'), '192.0.2.7:8740');
    expect(q('[data-testbox="settings-save"]')).toBeEnabled();
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-box')[0]!.body).toEqual({ fields: { settings: { CCRC_TESTBOX_LISTEN: '192.0.2.7:8740' } } });
  });

  it('a fleet change goes to settings-fleet alone, and asks the page to re-read its nodes', async () => {
    const f = fakeFleet();
    const onFleetChanged = vi.fn();
    await mount({ fleetRows: FLEET_ROWS, onFleetChanged });
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_BUDGET'), '45m');
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-fleet')[0]!.body).toEqual({ fields: { settings: { CCRC_TESTBOX_BUDGET: '45m' } } });
    expect(f.posts('settings-box')).toHaveLength(0);
    expect(onFleetChanged).toHaveBeenCalledTimes(1);
  });

  it('a fleet key ccrc.env sets is read-only with its note, once the route says so, and is never sent again', async () => {
    const f = fakeFleet();
    f.box.on['settings-fleet'] = () => ({ refuse: refused(409, 'testbox-admin-refused', { code: 'key-in-ccrc-env', keys: ['CCRC_TESTBOX_BUDGET'] }) });
    await mount({ fleetRows: FLEET_ROWS });
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_BUDGET'), '45m');
    typeIn(setting('CCRC_TESTBOX_QUEUE_LIMIT'), '9');
    await press(q('[data-testbox="settings-save"]'));
    expect(screen.getByText(TESTBOX_ADMIN_CODE_SENTENCE['key-in-ccrc-env'])).toBeInTheDocument();
    expect(setting('CCRC_TESTBOX_BUDGET')).toBeDisabled();
    expect(q('[data-setting="CCRC_TESTBOX_BUDGET"] [data-testbox="ccrc-env-note"]')!.textContent).toBe(T.setInCcrcEnv);
    expect(setting('CCRC_TESTBOX_QUEUE_LIMIT')).toBeEnabled();
    // The other key's edit is kept; the read-only key's is dropped, so the next save sends only the one.
    f.box.on['settings-fleet'] = () => undefined;
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-fleet')[1]!.body).toEqual({ fields: { settings: { CCRC_TESTBOX_QUEUE_LIMIT: '9' } } });
  });

  it('with no fleet rows reported the panel says so and offers no guess', async () => {
    fakeFleet();
    await mount({ fleetRows: null });
    await openSettings();
    expect(q('[data-testbox="fleet-none"]')!.textContent).toBe(T.fleetNone);
  });

  it('a run-shaping change says parity is needed again, and another does not', async () => {
    fakeFleet();
    await mount();
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_LISTEN'), '192.0.2.7:8740');
    expect(q('[data-testbox="parity-again"]')).toBeNull();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '3');
    expect(q('[data-testbox="parity-again"]')!.textContent).toBe(T.parityAgain);
  });

  it('runs in progress offer Apply when idle, then Cancel while it waits', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = (b) => {
      expect(b.fields).toEqual({ settings: { CCRC_TESTBOX_WORKERS: '3' }, whenIdle: true });
      f.box.status = connected({ act: actState({ sub: 'settings-box', phase: 'wait', phases: [] }) });
      return { result: { act: 'a'.repeat(32) } };
    };
    f.box.on.cancel = () => { f.box.status = connected({ act: actState({ sub: 'settings-box', outcome: 'failed', code: 'cancelled', phase: 'wait', phases: [] }) }); return { result: { cancelled: true } }; };
    await mount({ runsInProgress: 2 });
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '3');
    expect(q('[data-testbox="runs-note"]')!.textContent).toBe(T.runsNote);
    expect(q('[data-testbox="settings-save"]')!.textContent).toBe(T.applyWhenIdle);
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-box')).toHaveLength(1);
    expect(q('[data-testbox="waiting"]')!.textContent).toBe(T.waiting);
    expect(q('[data-testbox="phases"]')).not.toBeNull();
    await press(q('[data-testbox="cancel-wait"]'));
    expect(f.posts('cancel')).toHaveLength(1);
    expect(q('[data-testbox="cancel-wait"]')).toBeNull();
  });

  it('a runs-in-progress refusal from the verb offers Apply when idle too', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = () => ({ refuse: refused(409, 'testbox-admin-refused', { code: 'runs-in-progress' }) });
    await mount();
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '3');
    expect(q('[data-testbox="settings-save"]')!.textContent).toBe(T.save);
    await press(q('[data-testbox="settings-save"]'));
    expect(screen.getByText(TESTBOX_ADMIN_CODE_SENTENCE['runs-in-progress'])).toBeInTheDocument();
    expect(q('[data-testbox="settings-save"]')!.textContent).toBe(T.applyWhenIdle);
    // What was typed is still there to apply.
    expect(setting('CCRC_TESTBOX_WORKERS').value).toBe('3');
  });
});

describe('Repair and Apply release to box', () => {
  it('Repair sends one repair and shows its phases from the status', async () => {
    const f = fakeFleet();
    f.box.on.repair = () => { f.box.status = connected({ act: actState() }); return { result: { act: 'a'.repeat(32) } }; };
    await mount();
    await press(q('[data-testbox="repair"]'));
    expect(f.posts('repair')[0]!.body).toEqual({ fields: {} });
    expect(q('[data-testbox="phases"]')!.querySelectorAll('li')).toHaveLength(TESTBOX_ADMIN_PHASES.repair.length);
    expect(q('[data-testbox="repair"]')).toBeDisabled();
    expect(q('[data-testbox="disconnect"]')).toBeDisabled();
  });

  it('Apply release to box shows only when the release differs', async () => {
    fakeFleet();
    const view = await mount({ releaseDiffers: false });
    expect(q('[data-testbox="apply-release"]')).toBeNull();
    view.unmount();
    const f = fakeFleet();
    f.box.on['apply-release'] = () => { f.box.status = connected({ act: actState({ sub: 'apply-release' }) }); };
    await mount({ releaseDiffers: true });
    expect(q('[data-testbox="apply-release-why"]')).not.toBeNull();
    await press(q('[data-testbox="apply-release"]'));
    expect(f.posts('apply-release')).toHaveLength(1);
  });
});

describe('Replace and Disconnect', () => {
  const fillPassphrase = async (): Promise<void> => {
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await settle();
  };

  it('Disconnect confirms in one sheet that names what is removed, asks for step-up, and sends one disconnect', async () => {
    const f = fakeFleet();
    let first = true;
    f.box.on.disconnect = () => {
      if (first) { first = false; return { refuse: refused(403, 'step-up-required') }; }
      f.box.status = baseStatus();
    };
    await mount();
    await press(q('[data-testbox="disconnect"]'));
    const text = sheet().textContent!;
    expect(text).toContain(T.removedBox);
    expect(text).toContain(T.removedFleet);
    expect(text).toContain(T.kept);
    expect(f.posts('disconnect')).toHaveLength(0);
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    expect(f.posts('disconnect')[0]!.body).toEqual({ fields: {} });
    expect(document.querySelector('[data-step-up]')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[data-testbox="sheet-confirm"]')).toBeDisabled();
    await fillPassphrase();
    expect(f.posts('disconnect')).toHaveLength(1);
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    expect(f.posts('disconnect')).toHaveLength(2);
    expect(manage()).toBeNull();
  });

  it('Cancel on the sheet sends nothing', async () => {
    const f = fakeFleet();
    await mount();
    await press(q('[data-testbox="replace"]'));
    expect(sheet().textContent).toContain(T.replaceThen);
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-cancel"]'));
    expect(f.posts()).toHaveLength(0);
  });

  it('Replace sends disconnect with replace and tells the section to open step 1', async () => {
    const f = fakeFleet();
    f.box.on.disconnect = () => { f.box.status = baseStatus(); };
    const onReplaced = vi.fn();
    await mount({ onReplaced });
    await press(q('[data-testbox="replace"]'));
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    expect(f.posts('disconnect')[0]!.body).toEqual({ fields: { replace: true } });
    expect(onReplaced).toHaveBeenCalledTimes(1);
  });

  it('a disconnect whose box side was skipped says so, reads the status again and closes', async () => {
    const f = fakeFleet();
    f.box.on.disconnect = () => { f.box.status = baseStatus(); return { refuse: refused(409, 'testbox-admin-refused', { code: 'box-side-skipped' }) }; };
    const onChanged = vi.fn();
    await mount({ onChanged });
    await press(q('[data-testbox="disconnect"]'));
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('[data-testbox="manage"]')).toBeNull());
  });
});

describe('the section: Replace returns to step 1 and shows the new fingerprint at step 3', () => {
  const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
  const STATUS: StatusAnswer = {
    t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
    sync: { state: 'idle', detail: null, at: '2026-10-30T10:00:00Z' }, runs: { inProgress: 0, limit: 4 }, queueDepth: 0, pristine: [], failedKeys: [],
    heldRunUsers: [], repositories: [],
  };
  const block = (over: Partial<TestboxBlock> = {}): TestboxBlock => ({
    state: 'ok', reasons: [], summary: 'ok', switch: 'off', at: Date.now(), host: { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' },
    box: STATUS, counts: { remote: 0, fallback: 0, refused: 0, unreadable: 0, byReason: {} }, ...over,
  });
  const admin = (over: Partial<TestboxBlockAdmin> = {}): TestboxBlockAdmin => ({ connected: true, hostKey: 'pinned', act: null, parity: 'pass', ...over });
  const poll = (b: TestboxBlock, reload = vi.fn()): TestboxPoll => ({ view: { block: b }, failure: null, reload });
  const atBand = (band: 'phone' | 'laptop' | 'wide'): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: (query === DESK_QUERY && band !== 'phone') || (query === TESTBOX_WIDE_QUERY && band === 'wide'),
      media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
  };
  const card = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.automation.testbox.title });

  it('Replace removes the old box, opens step 1 with no tap first, and its step 3 shows the new fingerprint', async () => {
    atBand('laptop');
    const f = fakeFleet();
    f.box.on.disconnect = () => { f.box.status = baseStatus(); };
    f.box.on.key = (b) => { expect(b.fields).toEqual({ address: ADDRESS, port: '22', user: 'root' }); f.box.status = baseStatus({ addressSet: true, login: 'root' }); return { result: { line: LINE } }; };
    f.box.on.probe = () => ({ result: { fingerprint: NEW_FP } });
    const reload = vi.fn();
    const view = render(<TestBoxSection poll={poll(block({ admin: admin() }), reload)} />);
    await settle();
    expect(card().querySelector('[data-testbox="manage"]')).not.toBeNull();
    expect(card().querySelector('[data-testbox="connect"]')).toBeNull();
    await press(card().querySelector('[data-testbox="replace"]'));
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    // The block re-reads: nothing is connected any more.
    view.rerender(<TestBoxSection poll={poll(block({ state: 'off', box: null, admin: admin({ connected: false, hostKey: 'none', parity: 'none' }) }), reload)} />);
    await settle();
    expect(card().querySelector('[data-testbox="manage"]')).toBeNull();
    // Step 1 is open with no "Connect a test box" tap first.
    expect(screen.queryByRole('button', { name: C.begin })).toBeNull();
    fireEvent.change(within(card()).getByLabelText(C.addressLabel), { target: { value: ADDRESS } });
    await press(within(card()).getByRole('button', { name: C.next }));
    await press(within(card()).getByRole('button', { name: C.makeKey }));
    await press(within(card()).getByRole('button', { name: C.added }));
    await press(within(card()).getByRole('button', { name: C.probe }));
    expect(card().querySelector('[data-testbox="fingerprint"]')!.textContent).toBe(NEW_FP);
  });

  it('Apply release to box shows only when the box\'s release differs from the fleet host\'s', async () => {
    atBand('laptop');
    fakeFleet();
    const view = render(<TestBoxSection poll={poll(block({ admin: admin() }))} />);
    await settle();
    expect(card().querySelector('[data-testbox="apply-release"]')).toBeNull();
    view.rerender(<TestBoxSection poll={poll(block({ box: { ...STATUS, release: 'v0.0.899' }, admin: admin() }))} />);
    await settle();
    expect(card().querySelector('[data-testbox="apply-release"]')).not.toBeNull();
    // An unmeasured fleet release says nothing about a difference.
    view.rerender(<TestBoxSection poll={poll(block({ host: null, admin: admin() }))} />);
    await settle();
    expect(card().querySelector('[data-testbox="apply-release"]')).toBeNull();
  });

  it('the runs in progress on the box reach the settings, and a block with no admin draws no manage card', async () => {
    atBand('laptop');
    fakeFleet();
    const view = render(<TestBoxSection poll={poll(block({ box: { ...STATUS, runs: { inProgress: 1, limit: 4 } }, admin: admin() }))} />);
    await settle();
    await press(card().querySelector('[data-testbox="settings-toggle"]'));
    typeIn(card().querySelector<HTMLInputElement>('[data-setting="CCRC_TESTBOX_WORKERS"] input')!, '3');
    expect(card().querySelector('[data-testbox="runs-note"]')).not.toBeNull();
    view.rerender(<TestBoxSection poll={poll(block())} />);
    await settle();
    expect(card().querySelector('[data-testbox="manage"]')).toBeNull();
  });
});

describe('blocked: one line and the one control that resolves it', () => {
  it('a changed host key blocks every control but Confirm and Disconnect', async () => {
    const f = fakeFleet(connected({ hostKey: 'changed' }));
    f.box.on.probe = () => ({ result: { fingerprint: NEW_FP } });
    f.box.on.pin = () => { f.box.status = connected(); return { result: { fingerprint: NEW_FP } }; };
    await mount({ releaseDiffers: true });
    expect(q('[data-blocked="host-key"]')!.textContent).toContain(T.blockedHostKey);
    for (const id of ['settings-toggle', 'repair', 'replace', 'apply-release']) expect(q(`[data-testbox="${id}"]`), id).toBeDisabled();
    expect(q('[data-testbox="disconnect"]')).toBeEnabled();
    expect(q('[data-testbox="manage-fingerprint"]')!.textContent).toBe(FP);
    // The new fingerprint is shown first; only Confirm pins it.
    expect(q('[data-testbox="confirm-fingerprint"]')).toBeNull();
    await press(q('[data-testbox="show-fingerprint"]'));
    expect(q('[data-testbox="new-fingerprint"]')!.textContent).toBe(NEW_FP);
    expect(f.posts('pin')).toHaveLength(0);
    await press(q('[data-testbox="confirm-fingerprint"]'));
    expect(f.posts('pin')[0]!.body).toEqual({ fields: { fingerprint: NEW_FP } });
    expect(q('[data-blocked]')).toBeNull();
    expect(q('[data-testbox="repair"]')).toBeEnabled();
  });

  it('a failed act shows its sentence and Try again, which sends the same act', async () => {
    const f = fakeFleet(connected({ act: actState({ sub: 'repair', outcome: 'failed', code: 'copy-failed', phase: 'copy' }) }));
    f.box.on.repair = () => { f.box.status = connected({ act: actState() }); };
    await mount();
    const blocked = q('[data-blocked="failed"]')!;
    expect(blocked.textContent).toContain(codeSentence('copy-failed'));
    expect(blocked.textContent).toContain('Copy it to the box failed');
    await press(q('[data-testbox="blocked-try-again"]'));
    expect(f.posts('repair')).toHaveLength(1);
  });

  it('a failed settings act\'s Try again opens Settings', async () => {
    fakeFleet(connected({ act: actState({ sub: 'settings-box', outcome: 'failed', code: 'box-value-refused', phase: 'settings' }) }));
    await mount();
    await press(q('[data-testbox="blocked-try-again"]'));
    expect(q('[data-testbox="settings"]')).not.toBeNull();
  });

  it('a failed connect or parity is the flow\'s line, not this card\'s', async () => {
    fakeFleet(connected({ act: actState({ sub: 'parity', outcome: 'failed', code: 'parity-differs', phase: 'legs' }) }));
    await mount();
    expect(q('[data-testbox="blocked"]')).toBeNull();
  });

  it('a lost access key shows its line; Show the access line asks the address again, shows the line, and forgets the address', async () => {
    const f = fakeFleet(connected({ act: actState({ sub: 'repair', outcome: 'failed', code: 'auth-refused', phase: 'copy' }) }));
    f.box.on.key = (b) => { expect(b.fields).toEqual({ address: ADDRESS, port: '22', user: 'root' }); return { result: { line: LINE } }; };
    f.box.on.preflight = () => ({ result: { pass: true, checks: [{ check: 'os', ok: true, code: null }] } });
    await mount();
    expect(q('[data-blocked="access"]')!.textContent).toContain(T.blockedAccess);
    expect(q('[data-testbox="show-access"]')).toBeDisabled();
    typeIn(manage().querySelector<HTMLInputElement>('[data-blocked="access"] input')!, ADDRESS);
    await press(q('[data-testbox="show-access"]'));
    expect(q('[data-testbox="access-line"]')!.textContent).toBe(LINE);
    expect(manage().textContent).not.toContain(ADDRESS);
    await press(q('[data-testbox="copy-access"]'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINE);
    await press(q('[data-testbox="check-access"]'));
    expect(f.posts('preflight')).toHaveLength(1);
    expect(screen.getByText(T.accessChecked)).toBeInTheDocument();
    expect(q('[data-blocked]')).toBeNull();
  });

  it('a failed access check names the failing check and keeps the line', async () => {
    const f = fakeFleet(connected({ act: actState({ sub: 'repair', outcome: 'failed', code: 'no-access-key', phase: 'copy' }) }));
    f.box.on.key = () => ({ result: { line: LINE } });
    f.box.on.preflight = () => ({ result: { pass: false, checks: [{ check: 'login', ok: false, code: 'auth-refused' }] } });
    await mount();
    typeIn(manage().querySelector<HTMLInputElement>('[data-blocked="access"] input')!, ADDRESS);
    await press(q('[data-testbox="show-access"]'));
    await press(q('[data-testbox="check-access"]'));
    expect(screen.getByText(`Login: ${TESTBOX_ADMIN_CODE_SENTENCE['auth-refused']}`)).toBeInTheDocument();
    expect(q('[data-testbox="access-line"]')).not.toBeNull();
  });
});

describe('the words', () => {
  it('a row reads as its display class: a value, set, not set, refused, unmeasured', () => {
    expect(manageRowLine({ key: 'CCRC_TESTBOX_WORKERS', state: 'ok', value: '3', from: 'file' })).toEqual({ shown: '3', original: '3' });
    expect(manageRowLine({ key: 'CCRC_TESTBOX_LISTEN', state: 'ok', from: 'file' })).toEqual({ shown: T.shownSet, original: '' });
    expect(manageRowLine({ key: 'CCRC_TESTBOX_LISTEN', state: 'ok', from: 'default' })).toEqual({ shown: T.shownNotSet, original: '' });
    expect(manageRowLine({ key: 'CCRC_TESTBOX_WORKERS', state: 'unmeasured', why: 'not read' }).shown).toBe(T.shownUnmeasured);
    expect(manageRowLine(undefined).shown).toBe(T.shownUnmeasured);
  });

  it('the fleet rows come from the first fleet node whose settings were read, and from nothing else', () => {
    expect(fleetRowsOf(null)).toBeNull();
    expect(fleetRowsOf([])).toBeNull();
    expect(fleetRowsOf([{ nodeId: 'n', role: 'fleet' } as never])).toBeNull();
  });

  it('no sentence of the connected card names an address, a path, a user or a host', () => {
    const all = Object.values(T).flatMap((v) => (typeof v === 'string' ? [v] : [v('a', 'b')]));
    for (const s of all) expect(s).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|@|\.invalid|\/(?:etc|var|root|home)\b/);
  });
});
