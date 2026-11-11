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
import { PAIRED_BOX_KEYS, TESTBOX_CONNECT_TEXT, TESTBOX_MANAGE_TEXT, codeSentence, fleetRowsOf, ledgerLine, manageRowLine } from './testboxAdminWords';
import type { TestboxBlock, TestboxBlockAdmin, TestboxPoll } from './useTestboxView';

const T = TESTBOX_MANAGE_TEXT;
const C = TESTBOX_CONNECT_TEXT;
const ADDRESS = '10.0.0.7';
const FP = `SHA256:${'A'.repeat(43)}`;
const NEW_FP = `SHA256:${'N'.repeat(43)}`;
const LINE = `from="192.0.2.2" ssh-ed25519 ${'B'.repeat(68)} ccrc-testbox`;
const SHA = 'f'.repeat(64);
/** An access key's PUBLIC words, as a line-code refusal names them (D-8337), and the line a rotate answers. */
const KEY_WORDS = `ssh-ed25519 ${'K'.repeat(68)} ccrc-testbox-admin`;
const NEW_LINE = `from="192.0.2.2",restrict ssh-ed25519 ${'N'.repeat(68)} ccrc-testbox-admin`;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const baseStatus = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus => ({
  v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: null, ...over,
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
    // A box change is a detached act: the line says it began, and the phases follow from the status.
    expect(screen.getByText(T.applying)).toBeInTheDocument();
  });

  it('the four pairing settings are shown and never sent: read-only, with their reason, and no edit reaches the box', async () => {
    const f = fakeFleet();
    await mount();
    await openSettings();
    for (const key of PAIRED_BOX_KEYS) {
      expect(setting(key), key).toBeDisabled();
      expect(q(`[data-setting="${key}"] [data-testbox="ccrc-env-note"]`)!.textContent, key).toBe(T.pairingLocked);
    }
    expect(PAIRED_BOX_KEYS).toEqual(['CCRC_TESTBOX_LISTEN', 'CCRC_TESTBOX_SERVICE_TOKEN_FILE', 'CCRC_TESTBOX_SERVICE_USER', 'CCRC_TESTBOX_PUSH_USER']);
    // an editable key beside them is not locked
    expect(setting('CCRC_TESTBOX_RETENTION')).toBeEnabled();
    typeIn(setting('CCRC_TESTBOX_RETENTION'), '48h');
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-box')[0]!.body).toEqual({ fields: { settings: { CCRC_TESTBOX_RETENTION: '48h' } } });
  });

  it('a value off its key\'s shape is refused as typed, and a row only shown as set sends only what was typed', async () => {
    const f = fakeFleet();
    await mount();
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), 'many');
    expect(q('[data-testbox="settings-save"]')).toBeDisabled();
    expect(within(q('[data-setting="CCRC_TESTBOX_WORKERS"]')!).getByRole('status').textContent).toContain('whole number');
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '2');
    typeIn(setting('CCRC_TESTBOX_RETENTION'), '48h');
    expect(q('[data-testbox="settings-save"]')).toBeEnabled();
    await press(q('[data-testbox="settings-save"]'));
    expect(f.posts('settings-box')[0]!.body).toEqual({ fields: { settings: { CCRC_TESTBOX_RETENTION: '48h' } } });
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
    typeIn(setting('CCRC_TESTBOX_RETENTION'), '48h');
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

  it('Cancel says too late when the act is past its wait, never Cancelled', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = () => {
      f.box.status = connected({ act: actState({ sub: 'settings-box', phase: 'wait', phases: [] }) });
      return { result: { act: 'a'.repeat(32) } };
    };
    f.box.on.cancel = () => ({ result: { cancelled: false } });
    await mount({ runsInProgress: 2 });
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_WORKERS'), '3');
    await press(q('[data-testbox="settings-save"]'));
    await press(q('[data-testbox="cancel-wait"]'));
    expect(f.posts('cancel')).toHaveLength(1);
    expect(manage().textContent).not.toContain(T.cancelled);
    expect(manage().textContent).toContain(T.cancelTooLate);
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

describe('Reset to default (D-8336)', () => {
  const resetOf = (key: string): HTMLElement | null => q(`[data-setting="${key}"] [data-testbox="reset-default"]`);
  const confirmButton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-testbox="sheet-confirm"]')!;
  const FLEET_FILE_ROWS: BoxSettingRow[] = [...FLEET_ROWS, { key: 'CCRC_TESTBOX_DENY_GLOBS', state: 'ok', from: 'file' }];

  it('shows on a row a settings file sets, and on no default, pairing, unmeasured or ccrc.env row', async () => {
    fakeFleet();
    await mount({ fleetRows: FLEET_FILE_ROWS });
    await openSettings();
    for (const key of ['CCRC_TESTBOX_WORKERS', 'CCRC_TESTBOX_RUN_MEMORY_MAX', 'CCRC_TESTBOX_BUDGET', 'CCRC_TESTBOX_DENY_GLOBS']) {
      expect(resetOf(key), key).not.toBeNull();
      expect(resetOf(key)!.textContent, key).toBe(T.resetToDefault);
    }
    // a default row has nothing to reset; a pairing row is Replace's; an unmeasured row is unknown
    for (const key of ['CCRC_TESTBOX_RUNS', 'CCRC_TESTBOX_OS_MIRROR', 'CCRC_TESTBOX_QUEUE_LIMIT', 'CCRC_TESTBOX_LISTEN', 'CCRC_TESTBOX_ROOT']) {
      expect(resetOf(key), key).toBeNull();
    }
  });

  it('the root and the repository directory have no reset: their declared defaults are paths the installer refuses', async () => {
    fakeFleet(connected({ boxSettings: [...BOX_ROWS, { key: 'CCRC_TESTBOX_ROOT', state: 'ok', from: 'file' }, { key: 'CCRC_TESTBOX_REPOS', state: 'ok', from: 'file' },
      { key: 'CCRC_TESTBOX_TOOLS_DIR', state: 'ok', from: 'file' }] }));
    await mount();
    await openSettings();
    expect(resetOf('CCRC_TESTBOX_ROOT')).toBeNull();
    expect(resetOf('CCRC_TESTBOX_REPOS')).toBeNull();
    expect(resetOf('CCRC_TESTBOX_TOOLS_DIR')).not.toBeNull();
  });

  it('one tap opens the confirm, Cancel sends nothing, and Confirm sends the key alone as the unset list to settings-box', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = () => {
      f.box.status = connected({ boxSettings: BOX_ROWS.map((r) => (r.key === 'CCRC_TESTBOX_WORKERS' ? { ...r, from: 'default' } as BoxSettingRow : r)), boxSettingsAt: 2 });
      return { result: { act: 'a'.repeat(32) } };
    };
    await mount();
    await openSettings();
    await press(resetOf('CCRC_TESTBOX_WORKERS'));
    expect(f.posts()).toHaveLength(0);
    const text = sheet().textContent!;
    expect(text).toContain(T.resetWhat('CCRC_TESTBOX_WORKERS'));
    expect(text).toContain(T.resetBox);
    // a run-shaping key says parity runs again
    expect(text).toContain(T.parityAgain);
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-cancel"]'));
    expect(f.posts()).toHaveLength(0);
    await press(resetOf('CCRC_TESTBOX_WORKERS'));
    expect(confirmButton().textContent).toBe(T.resetToDefault);
    await press(confirmButton());
    expect(f.posts('settings-box')).toHaveLength(1);
    expect(f.posts('settings-box')[0]!.body).toEqual({ fields: { unset: ['CCRC_TESTBOX_WORKERS'] } });
    expect(f.posts('settings-fleet')).toHaveLength(0);
    // the sheet closes, the card says the change is being applied, and the row reads what the box answered: its default
    expect(document.querySelector('[data-testbox="sheet"]')).toBeNull();
    expect(screen.getByText(T.applying)).toBeInTheDocument();
    expect(q('[data-setting="CCRC_TESTBOX_WORKERS"] [data-testbox="setting-now"]')!.textContent).toBe(`2 (${T.shownDefault})`);
    expect(resetOf('CCRC_TESTBOX_WORKERS')).toBeNull();
  });

  it('a key that shapes no run says nothing of parity; a typed edit of the key is dropped by its reset', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = () => ({ result: { act: 'a'.repeat(32) } });
    await mount({ fleetRows: FLEET_FILE_ROWS });
    await openSettings();
    typeIn(setting('CCRC_TESTBOX_BUDGET'), '45m');
    await press(resetOf('CCRC_TESTBOX_BUDGET'));
    expect(sheet().textContent).not.toContain(T.parityAgain);
    expect(sheet().textContent).toContain(T.resetFleet);
    await press(confirmButton());
    expect(f.posts('settings-fleet')[0]!.body).toEqual({ fields: { unset: ['CCRC_TESTBOX_BUDGET'] } });
    expect(setting('CCRC_TESTBOX_BUDGET').value).toBe('30m');
    expect(q('[data-testbox="settings-save"]')).toBeDisabled();
  });

  it('a fleet reset goes to settings-fleet alone and asks the page to re-read its nodes', async () => {
    const f = fakeFleet();
    const onFleetChanged = vi.fn();
    await mount({ fleetRows: FLEET_FILE_ROWS, onFleetChanged });
    await openSettings();
    await press(resetOf('CCRC_TESTBOX_BUDGET'));
    await press(confirmButton());
    expect(f.posts('settings-fleet')).toHaveLength(1);
    expect(f.posts('settings-box')).toHaveLength(0);
    expect(onFleetChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText(T.resetDone)).toBeInTheDocument();
  });

  it('a key ccrc.env sets has no reset: the refusal draws the row read-only, its Reset goes and the confirm is held', async () => {
    const f = fakeFleet();
    f.box.on['settings-fleet'] = () => ({ refuse: refused(409, 'testbox-admin-refused', { code: 'key-in-ccrc-env', keys: ['CCRC_TESTBOX_BUDGET'] }) });
    await mount({ fleetRows: FLEET_FILE_ROWS });
    await openSettings();
    await press(resetOf('CCRC_TESTBOX_BUDGET'));
    await press(confirmButton());
    expect(sheet().textContent).toContain(TESTBOX_ADMIN_CODE_SENTENCE['key-in-ccrc-env']);
    expect(confirmButton()).toBeDisabled();
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-cancel"]'));
    expect(setting('CCRC_TESTBOX_BUDGET')).toBeDisabled();
    expect(resetOf('CCRC_TESTBOX_BUDGET')).toBeNull();
    expect(f.posts('settings-fleet')).toHaveLength(1);
  });

  it('resetting the deny list asks for the step-up in the sheet, as changing it does', async () => {
    const f = fakeFleet();
    let first = true;
    f.box.on['settings-fleet'] = () => (first ? (first = false, { refuse: refused(403, 'step-up-required') }) : undefined);
    await mount({ fleetRows: FLEET_FILE_ROWS });
    await openSettings();
    await press(resetOf('CCRC_TESTBOX_DENY_GLOBS'));
    await press(confirmButton());
    expect(f.posts('settings-fleet')[0]!.body).toEqual({ fields: { unset: ['CCRC_TESTBOX_DENY_GLOBS'] } });
    expect(document.querySelector('[data-step-up]')).not.toBeNull();
    expect(confirmButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await settle();
    await press(confirmButton());
    expect(f.posts('settings-fleet')).toHaveLength(2);
    expect(document.querySelector('[data-testbox="sheet"]')).toBeNull();
  });

  it('with runs in progress a box reset is applied when idle, and a runs-in-progress refusal offers it too', async () => {
    const f = fakeFleet();
    f.box.on['settings-box'] = () => ({ result: { act: 'a'.repeat(32) } });
    await mount({ runsInProgress: 1 });
    await openSettings();
    await press(resetOf('CCRC_TESTBOX_RUN_MEMORY_MAX'));
    expect(sheet().textContent).toContain(T.runsNote);
    expect(confirmButton().textContent).toBe(T.applyWhenIdle);
    await press(confirmButton());
    expect(f.posts('settings-box')[0]!.body).toEqual({ fields: { unset: ['CCRC_TESTBOX_RUN_MEMORY_MAX'], whenIdle: true } });
    cleanup();
    const g = fakeFleet();
    g.box.on['settings-box'] = () => ({ refuse: refused(409, 'testbox-admin-refused', { code: 'runs-in-progress' }) });
    await mount();
    await openSettings();
    await press(resetOf('CCRC_TESTBOX_RUN_MEMORY_MAX'));
    expect(confirmButton().textContent).toBe(T.resetToDefault);
    await press(confirmButton());
    expect(sheet().textContent).toContain(TESTBOX_ADMIN_CODE_SENTENCE['runs-in-progress']);
    expect(confirmButton().textContent).toBe(T.applyWhenIdle);
    g.box.on['settings-box'] = () => ({ result: { act: 'a'.repeat(32) } });
    await press(confirmButton());
    expect(g.posts('settings-box')[1]!.body).toEqual({ fields: { unset: ['CCRC_TESTBOX_RUN_MEMORY_MAX'], whenIdle: true } });
  });

  it('every Reset is held while an act runs', async () => {
    fakeFleet(connected({ act: actState({ sub: 'repair' }) }));
    await mount();
    await openSettings();
    expect(resetOf('CCRC_TESTBOX_WORKERS')).toBeDisabled();
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

  it('Apply release to box shows only when the running release differs from the installer marker', async () => {
    // Equal: nothing to apply. Unread marker or unmeasured box: nothing is said.
    for (const [rel, tag] of [['v1.2.0', 'v1.2.0'], ['v1.2.0', null], [null, 'v1.1.0']] as const) {
      fakeFleet(connected({ installedTag: tag }));
      const view = await mount({ boxRelease: rel });
      expect(q('[data-testbox="apply-release"]'), `${rel} ${tag}`).toBeNull();
      view.unmount();
    }
    // Tool sync moved the running tree on and left the marker behind: the control shows, with its reason.
    const f = fakeFleet(connected({ installedTag: 'v1.1.0' }));
    f.box.on['apply-release'] = () => { f.box.status = connected({ installedTag: 'v1.1.0', act: actState({ sub: 'apply-release' }) }); };
    await mount({ boxRelease: 'v1.2.0' });
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

describe('the box side of a disconnect, and an apply that always detaches (D-8166 review)', () => {
  it('a disconnect whose unpair did not finish says what to do by hand, reads the status again and closes', async () => {
    const f = fakeFleet();
    f.box.on.disconnect = () => { f.box.status = baseStatus(); return { refuse: refused(409, 'testbox-admin-refused', { code: 'unpair-failed' }) }; };
    const onChanged = vi.fn();
    await mount({ onChanged });
    await press(q('[data-testbox="disconnect"]'));
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('[data-testbox="manage"]')).toBeNull());
  });

  it('the wait and its Cancel show only while the act is in its wait phase; once it is writing, the phases alone show', async () => {
    fakeFleet(connected({ act: actState({ sub: 'settings-box', phase: 'wait', phases: [] }) }));
    const waiting = await mount();
    expect(q('[data-testbox="waiting"]')).not.toBeNull();
    expect(q('[data-testbox="cancel-wait"]')).not.toBeNull();
    waiting.unmount();
    fakeFleet(connected({ act: actState({ sub: 'settings-box', phase: 'settings', phases: [{ name: 'wait', ms: 0 }] }) }));
    await mount();
    expect(q('[data-testbox="phases"]')).not.toBeNull();
    expect(q('[data-testbox="waiting"]')).toBeNull();
    expect(q('[data-testbox="cancel-wait"]')).toBeNull();
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

  it('Apply release to box follows the running release against the installer marker, not the fleet host\'s release', async () => {
    atBand('laptop');
    // The marker names the running release: tool sync has not moved the tree, so nothing is owed, whatever the fleet host runs.
    fakeFleet(connected({ installedTag: 'v0.0.899' }));
    const view = render(<TestBoxSection poll={poll(block({ box: { ...STATUS, release: 'v0.0.899' }, admin: admin() }))} />);
    await settle();
    expect(card().querySelector('[data-testbox="apply-release"]')).toBeNull();
    view.unmount();
    // Tool sync moved the tree on and left the marker behind (the fleet host and the box agree): the control is there.
    fakeFleet(connected({ installedTag: 'v0.0.800' }));
    const synced = render(<TestBoxSection poll={poll(block({ host: { ...block().host!, release: STATUS.release }, box: STATUS, admin: admin() }))} />);
    await settle();
    expect(card().querySelector('[data-testbox="apply-release"]')).not.toBeNull();
    synced.unmount();
    // The marker unread says nothing about a difference.
    fakeFleet(connected({ installedTag: null }));
    render(<TestBoxSection poll={poll(block({ box: STATUS, admin: admin() }))} />);
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

  it('a Revoke whose box was not reached leaves the line to remove by hand above the card, after the card is gone, until Done (D-8337)', async () => {
    atBand('phone');
    const f = fakeFleet();
    f.box.on['key-revoke'] = () => { f.box.status = baseStatus(); return { refuse: refused(409, 'testbox-admin-refused', { code: 'revoked-box-skipped', line: KEY_WORDS }) }; };
    const reload = vi.fn();
    const view = render(<TestBoxSection poll={poll(block({ admin: admin() }), reload)} />);
    await settle();
    await press(card().querySelector('[data-testbox="revoke-key"]'));
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    expect(f.posts('key-revoke')[0]!.body).toEqual({ fields: {} });
    expect(reload).toHaveBeenCalled();
    // the block re-reads: nothing is connected, so the connected card is gone; the notice is the section's and stays
    view.rerender(<TestBoxSection poll={poll(block({ state: 'off', box: null, admin: admin({ connected: false, hostKey: 'none', parity: 'none' }) }), reload)} />);
    await settle();
    expect(card().querySelector('[data-testbox="manage"]')).toBeNull();
    const notice = card().querySelector<HTMLElement>('[data-testbox="key-notice"]')!;
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain(TESTBOX_ADMIN_CODE_SENTENCE['revoked-box-skipped']);
    expect(notice.querySelector('[data-testbox="key-notice-line"]')!.textContent).toBe(KEY_WORDS);
    await press(notice.querySelector('[data-testbox="key-notice-copy"]'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(KEY_WORDS);
    await press(notice.querySelector('[data-testbox="key-notice-done"]'));
    expect(card().querySelector('[data-testbox="key-notice"]')).toBeNull();
  });

  it('a Revoke that reached the box says so above the card, with no line (D-8337)', async () => {
    atBand('wide');
    const f = fakeFleet();
    f.box.on['key-revoke'] = () => { f.box.status = baseStatus(); };
    render(<TestBoxSection poll={poll(block({ admin: admin() }))} />);
    await settle();
    await press(card().querySelector('[data-testbox="revoke-key"]'));
    await press(document.querySelector<HTMLElement>('[data-testbox="sheet-confirm"]'));
    const notice = card().querySelector<HTMLElement>('[data-testbox="key-notice"]')!;
    expect(notice.textContent).toContain(T.revoked);
    expect(notice.querySelector('[data-testbox="key-notice-line"]')).toBeNull();
    expect(notice.querySelector('[data-testbox="key-notice-copy"]')).toBeNull();
  });
});

describe('blocked: one line and the one control that resolves it', () => {
  it('a changed host key blocks every control but Confirm and Disconnect', async () => {
    const f = fakeFleet(connected({ hostKey: 'changed', installedTag: 'v1.1.0' }));
    f.box.on.probe = () => ({ result: { fingerprint: NEW_FP } });
    f.box.on.pin = () => { f.box.status = connected(); return { result: { fingerprint: NEW_FP } }; };
    await mount({ boxRelease: 'v1.2.0' });
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

  it('the access form takes the address the box sees ccrc connect from, only when typed, and refuses a public address', async () => {
    const f = fakeFleet(connected({ act: actState({ sub: 'repair', outcome: 'failed', code: 'auth-refused', phase: 'copy' }) }));
    f.box.on.key = () => ({ result: { line: LINE } });
    await mount();
    const form = manage().querySelector<HTMLElement>('[data-blocked="access"]')!;
    typeIn(within(form).getByLabelText(C.addressLabel), '203.0.113.9');
    expect(within(form).getByText(C.badPublicAddress)).toBeInTheDocument();
    expect(q('[data-testbox="show-access"]')).toBeDisabled();
    typeIn(within(form).getByLabelText(C.addressLabel), ADDRESS);
    typeIn(within(form).getByLabelText(C.sourceLabel), '10.0.0.250');
    await press(q('[data-testbox="show-access"]'));
    expect(f.posts('key')[0]!.body).toEqual({ fields: { address: ADDRESS, port: '22', user: 'root', source: '10.0.0.250' } });
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

describe('Rotate key and Revoke key (D-8337)', () => {
  const fillPassphrase = async (): Promise<void> => {
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await settle();
  };
  const confirm = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-testbox="sheet-confirm"]')!;

  it('Rotate opens one sheet on a tap, sends nothing until Confirm, asks for the step-up, then sends one key-rotate with no field', async () => {
    const f = fakeFleet();
    let first = true;
    f.box.on['key-rotate'] = () => {
      if (first) { first = false; return { refuse: refused(403, 'step-up-required') }; }
      return { result: { line: NEW_LINE } };
    };
    const onKeyNotice = vi.fn();
    await mount({ onKeyNotice });
    await press(q('[data-testbox="rotate-key"]'));
    expect(sheet().getAttribute('data-sheet')).toBe('rotate');
    expect(sheet().textContent).toContain(T.rotateHow);
    expect(sheet().textContent).toContain(T.rotateThen);
    expect(f.posts()).toHaveLength(0);
    await press(confirm());
    expect(f.posts('key-rotate')[0]!.body).toEqual({ fields: {} });
    expect(document.querySelector('[data-step-up]')).not.toBeNull();
    expect(confirm()).toBeDisabled();
    await fillPassphrase();
    await press(confirm());
    expect(f.posts('key-rotate')).toHaveLength(2);
    expect(document.querySelector('[data-testbox="sheet"]')).toBeNull();
    expect(manage().textContent).toContain(T.rotated);
    expect(onKeyNotice).not.toHaveBeenCalled();
    // the card never draws the new line: nothing about the key but the sentence
    expect(manage().textContent).not.toContain('N'.repeat(68));
  });

  it('Cancel on either sheet sends nothing', async () => {
    const f = fakeFleet();
    await mount();
    for (const id of ['rotate-key', 'revoke-key']) {
      await press(q(`[data-testbox="${id}"]`));
      await press(document.querySelector<HTMLElement>('[data-testbox="sheet-cancel"]'));
    }
    expect(f.posts()).toHaveLength(0);
  });

  it('a box that did not take the new key says nothing changed, in the sheet, and the card stays as it was', async () => {
    const f = fakeFleet();
    f.box.on['key-rotate'] = () => ({ refuse: refused(409, 'testbox-admin-refused', { code: 'new-key-refused' }) });
    const onKeyNotice = vi.fn();
    await mount({ onKeyNotice });
    await press(q('[data-testbox="rotate-key"]'));
    await press(confirm());
    expect(sheet().textContent).toContain(TESTBOX_ADMIN_CODE_SENTENCE['new-key-refused']);
    expect(onKeyNotice).not.toHaveBeenCalled();
    expect(manage()).not.toBeNull();
  });

  it('a rotate whose old line stayed hands the section the sentence and the old key\'s words, and closes the sheet', async () => {
    const f = fakeFleet();
    f.box.on['key-rotate'] = () => ({ refuse: refused(409, 'testbox-admin-refused', { code: 'old-line-kept', line: KEY_WORDS }) });
    const onKeyNotice = vi.fn();
    const onChanged = vi.fn();
    await mount({ onKeyNotice, onChanged });
    await press(q('[data-testbox="rotate-key"]'));
    await press(confirm());
    expect(onKeyNotice).toHaveBeenCalledWith({ sentence: TESTBOX_ADMIN_CODE_SENTENCE['old-line-kept'], line: KEY_WORDS });
    expect(onChanged).toHaveBeenCalled();
    expect(document.querySelector('[data-testbox="sheet"]')).toBeNull();
    expect(manage().textContent).not.toContain(T.rotated);
  });

  it('Revoke names what goes in its sheet and, once done, hands the section its sentence', async () => {
    const f = fakeFleet();
    f.box.on['key-revoke'] = () => { f.box.status = baseStatus(); };
    const onKeyNotice = vi.fn();
    await mount({ onKeyNotice });
    await press(q('[data-testbox="revoke-key"]'));
    expect(sheet().getAttribute('data-sheet')).toBe('revoke');
    expect(sheet().textContent).toContain(T.revokeBox);
    expect(sheet().textContent).toContain(T.revokeFleet);
    expect(sheet().textContent).not.toContain(T.kept);
    await press(confirm());
    expect(f.posts('key-revoke')[0]!.body).toEqual({ fields: {} });
    expect(onKeyNotice).toHaveBeenCalledWith({ sentence: T.revoked, line: null });
    await waitFor(() => expect(document.querySelector('[data-testbox="manage"]')).toBeNull());
  });

  it('a revoke whose unpair did not finish hands the section its line', async () => {
    const f = fakeFleet();
    f.box.on['key-revoke'] = () => { f.box.status = baseStatus(); return { refuse: refused(409, 'testbox-admin-refused', { code: 'revoked-unpair-failed', line: KEY_WORDS }) }; };
    const onKeyNotice = vi.fn();
    await mount({ onKeyNotice });
    await press(q('[data-testbox="revoke-key"]'));
    await press(confirm());
    expect(onKeyNotice).toHaveBeenCalledWith({ sentence: TESTBOX_ADMIN_CODE_SENTENCE['revoked-unpair-failed'], line: KEY_WORDS });
  });

  it('a changed host key holds Rotate (it needs the box it trusts) and leaves Revoke, as it leaves Disconnect', async () => {
    fakeFleet(connected({ hostKey: 'changed' }));
    await mount();
    expect(q('[data-testbox="rotate-key"]')).toBeDisabled();
    expect(q('[data-testbox="revoke-key"]')).toBeEnabled();
  });

  it('a ledger row of either act reads in words', () => {
    expect(ledgerLine(event(1, { act: 'key-rotate' }) as never)).toContain(T.rotateKey);
    expect(ledgerLine(event(2, { act: 'key-revoke', outcome: 'refused', code: 'revoked-box-skipped' }) as never)).toContain(T.revokeKey);
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
