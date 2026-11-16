// The PWA half of the secret canary (accounts plan Task A18, D-5513, D-7740; spec §3.3, §12.4): a pasted token lives
// only in the secret field's own DOM node, and once it has been sent, the sheet closed, the route changed or the page
// hidden, it is in no browser storage, no store and no DOM node. A refused paste re-presents the field empty. The
// server half (the token reaches only the lane's 0600 file) is `server/test/account-canary.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AccountsConnect, LaneWire, RosterWire } from '../../shared/api';
import { ConnectSheet, type ConnectSheetProps } from '../src/accounts/ConnectSheet';
import { ApiError } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { expectSecretInput } from './secretInputAttrs';

const CANARY = 'sk-ant-oat01-CANARY-' + 'k'.repeat(48);
const ROSTER: RosterWire[] = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null }];
const CONNECT: AccountsConnect = {
  accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: Date.now() + 3_600_000,
};
const LANE: LaneWire = { state: { word: 'signed-in', source: 'checked just now' }, ready: true, check: { verdict: 'ok', at: Date.now() } };

function mount(over: Partial<ConnectSheetProps> = {}): { props: ConnectSheetProps; rerender: (p: Partial<ConnectSheetProps>) => void } {
  const props: ConnectSheetProps = {
    open: true, onClose: vi.fn(), roster: ROSTER, connect: CONNECT, offline: null,
    refresh: vi.fn(async () => 'ok' as const), readRoster: () => ROSTER,
    client: {
      accountAdd: vi.fn(async () => ({ ok: true as const, roster: ROSTER, lane: LANE, fleetIdentity: null })),
      accountCheck: vi.fn(async () => ({ ok: true as const, lane: LANE })),
      accountEnable: vi.fn(async () => ({ ok: true as const, roster: ROSTER, lane: LANE })),
    },
    ...over,
  };
  const r = render(<ConnectSheet {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'lane-c' } });
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lane C' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  return { props, rerender: (p) => { Object.assign(props, p); r.rerender(<ConnectSheet {...props} />); } };
}
const field = (): HTMLInputElement | null => screen.queryByLabelText('Paste the token') as HTMLInputElement | null;
const paste = (): void => { fireEvent.input(field()!, { target: { value: CANARY } }); };

/** The canary is nowhere a page could keep it: no storage, no store dump, no DOM node or value. */
function nowhere(when: string): void {
  expect(document.documentElement.outerHTML, `${when}: markup`).not.toContain(CANARY);
  for (const i of document.querySelectorAll('input')) expect(i.value, `${when}: an input's value`).not.toContain(CANARY);
  for (const s of [localStorage, sessionStorage]) {
    for (let k = 0; k < s.length; k += 1) {
      const key = s.key(k)!;
      expect(key + (s.getItem(key) ?? ''), `${when}: browser storage`).not.toContain(CANARY);
    }
  }
  expect(JSON.stringify(useFleetStore.getState()), `${when}: the fleet store`).not.toContain(CANARY);
  // No IndexedDB in this environment, so nothing can have been put there either.
  expect(typeof indexedDB, `${when}: IndexedDB`).toBe('undefined');
}

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  localStorage.clear();
  sessionStorage.clear();
});

describe('the secret field (spec §3.3)', () => {
  it('holds the value in its own node only: never in the markup while it is typed', () => {
    mount();
    paste();
    expect(field()!.value).toBe(CANARY);
    expect(field()!).toHaveAttribute('type', 'password');
    expectSecretInput(field()!);
    expect(field()!).toHaveAttribute('inputmode', 'text');
    expect(document.documentElement.outerHTML).not.toContain(CANARY);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(field()!).toHaveAttribute('type', 'text');
  });

  it('after submit, close, route change and hide, the canary is in no storage, no store dump and no DOM node', async () => {
    // Submit: the field is emptied by the read itself, before any answer.
    let answer: () => void = () => {};
    const add = vi.fn(() => new Promise<never>((_, reject) => { answer = () => reject(new ApiError(503, { error: 'token-unverified' })); }));
    const sent = mount({ client: { accountAdd: add, accountCheck: vi.fn(), accountEnable: vi.fn() } });
    paste();
    fireEvent.click(screen.getByRole('button', { name: 'Add lane' }));
    expect((add.mock.calls[0] as unknown as [{ credential: string }])[0].credential).toBe(CANARY);
    nowhere('submitted, in flight');
    await act(async () => { answer(); });
    await waitFor(() => expect(field()).not.toBeNull());
    nowhere('submitted, refused');
    cleanup();
    void sent;

    // Close.
    const closed = mount();
    paste();
    closed.rerender({ open: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    nowhere('closed');
    cleanup();

    // A route change that keeps the sheet mounted.
    mount();
    paste();
    act(() => navigate('/accounts?lane=lane-a'));
    expect(field()!.value).toBe('');
    nowhere('route change');
    cleanup();

    // The page hidden.
    mount();
    paste();
    act(() => setVisibility('hidden'));
    expect(field()!.value).toBe('');
    nowhere('hidden');
  });

  it('a refused paste re-presents an empty field', async () => {
    mount({
      client: {
        accountAdd: vi.fn(async () => { throw new ApiError(400, { error: 'key-rejected' }); }),
        accountCheck: vi.fn(), accountEnable: vi.fn(),
      },
    });
    paste();
    fireEvent.click(screen.getByRole('button', { name: 'Add lane' }));
    await waitFor(() => expect(field()).not.toBeNull());
    expect(field()!.value).toBe('');
    expect(screen.getByRole('button', { name: 'Add lane' })).toBeDisabled();
    nowhere('refused');
  });
});
