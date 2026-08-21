// D-161, the second half: the auth controls existed and could not be FOUND.
//
// Three defects, one cause — nothing on the fleet screen ever said the word
// "sign-in". `/runs`, `/archive` and `/mail` each had an explicit control;
// `/accounts` had only the AccountsStrip tap target, whose own comment calls
// itself "the ONLY door to /accounts" and whose accessible name is "account
// usage — open accounts". A full-width usage readout reads as DATA, so the
// operator hunting for passkey enrolment on a laptop never found the screen it
// lives on (and the pane it lives in was clipped at the fold — the sibling
// defect, pinned in shell-css.test.ts).
//
// What these tests hold, and each is a mutation away from the state that
// shipped:
//   1. a NAMED door in the fleet header that routes to /accounts;
//   2. a self-retiring notice on a passphrase-only box — and, above all, its
//      `mode !== 'off'` guard: `CCRC_AUTH` is off for every OSS install by
//      default, so nagging about passkeys there would be nonsense on the
//      majority of boxes this ships to;
//   3. the auth blocks on /accounts no longer wearing the classes of a Claude
//      account row, which made "Passkeys" scan as a fleet account named
//      Passkeys.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { navigate } from '../src/lib/router';
import { resetAcks } from '../src/lib/seen';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { TEST_ROSTER } from './rosterFixture';

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // The path is module-global (lib/router reads location), so a test that
  // navigated leaves the next one starting somewhere else.
  navigate('/');
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

/** The fleet screen's own routes plus `GET /api/auth/status`. A fresh Response
 *  per call, never one shared instance: AccountsStrip, FleetHostBanner, the
 *  store's roster poll and the notice all fetch on mount, and a body can only
 *  be read once (fleet-screen.test.tsx's helper carries the same warning). */
const stubFetch = (status: unknown, list: unknown = { credentials: [], storeUnreadable: false }) =>
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.startsWith('/api/auth/status')) return json(200, status);
    if (u === '/api/auth/passkeys') return json(200, list);
    if (u.startsWith('/api/accounts')) {
      return json(200, { accounts: [], projected: null, roster: TEST_ROSTER });
    }
    return json(200, {});
  }));

const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });

/** Armed gate, signed in, no passkey — the one posture the notice is for. */
const PASSPHRASE_ONLY = { authed: true, passkeysEnrolled: 0, mode: 'passphrase' };

// ── 1. the door ─────────────────────────────────────────────────────────────

describe('the durable door to /accounts (D-161)', () => {
  it('sits in the fleet header, says what it is, and routes there', async () => {
    stubFetch({ authed: true, passkeysEnrolled: 1, mode: 'passphrase' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    const door = screen.getByRole('button', { name: 'Your sign-in and accounts' });
    // In the header's control cluster, beside the mail badge and the bell —
    // not somewhere down the list where it would be a second strip.
    expect(door.closest('.fleet-head-right')).not.toBeNull();
    // NOT icon-only. An unlabelled glyph would be exactly as undiscoverable as
    // the strip this exists to replace, which is the whole defect.
    expect(door.textContent).toMatch(/account/i);
    fireEvent.click(door);
    expect(location.pathname).toBe('/accounts');
  });

  it('renders on a fleet with no sessions at all — the first-run state needs it most', () => {
    // D-2's rule, the one AccountsStrip and the runs row are both already
    // moved out of the populated arm for: the only door must never render
    // nothing. A brand-new box has zero sessions and an operator who has
    // never signed in anywhere.
    stubFetch({ authed: true, passkeysEnrolled: 1, mode: 'passphrase' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    act(() => { store.setState({ conn: 'open', sessions: [] }); });
    expect(screen.getByRole('button', { name: 'Your sign-in and accounts' })).toBeInTheDocument();
  });
});

// ── 2. the self-retiring notice ─────────────────────────────────────────────

const NOTICE = /add a passkey/i;

describe('the passphrase-only notice (D-161)', () => {
  /** Every "absent" case needs the SAME wait as a present one, or it passes
   *  before the status read has landed and would pass with the guard deleted.
   *  Mirrors auth-passkey.test.tsx's dark-box test. */
  const settle = async (): Promise<void> => {
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
  };

  it('says NOTHING on a box with no gate — CCRC_AUTH is off by default', async () => {
    // THE GUARD THAT MATTERS MOST. This fixture is otherwise identical to the
    // one below — signed in, zero passkeys — so `mode: 'off'` is the only
    // thing keeping the line off the screen. Every default OSS install is
    // this box, and "add a passkey" on a box with no gate at all is advice
    // about a lock that does not exist.
    stubFetch({ authed: true, passkeysEnrolled: 0, mode: 'off' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('nags once when the gate is armed, we are signed in, and no passkey exists', async () => {
    stubFetch(PASSPHRASE_ONLY);
    const store = makeStore();
    render(<FleetScreen store={store} />);
    const line = await screen.findByRole('button', { name: NOTICE });
    // ONE line, not one per render path.
    expect(screen.getAllByRole('button', { name: NOTICE })).toHaveLength(1);
    // Tappable, and it goes where the enrolment button actually is.
    fireEvent.click(line);
    expect(location.pathname).toBe('/accounts');
  });

  it('retires itself the instant a passkey exists — there is no dismiss to persist', async () => {
    stubFetch({ authed: true, passkeysEnrolled: 1, mode: 'passphrase' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('says nothing to an anonymous caller — it is advice for the operator who is in', async () => {
    // A gate that is armed and has refused us is the login screen's business,
    // not this line's: the body the server sends an unknown caller is
    // deliberately minimized, so `passkeysEnrolled: 0` there is not evidence
    // that no passkey exists.
    stubFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });
});

// ── 3. the auth blocks are not account rows ─────────────────────────────────

describe('the /accounts auth blocks say whose they are (D-161)', () => {
  it('does not dress the sign-in block as a Claude account row', async () => {
    stubFetch(PASSPHRASE_ONLY);
    render(<AccountsScreen />);
    const title = await screen.findByText('Your sign-in');
    const block = title.closest('section');
    expect(block).not.toBeNull();
    // `.accounts-row` + `.account-gauge-label` are what a claude2/gpt row
    // wears. Wearing them made "Passkeys" scan as a fifth fleet account.
    expect(block!.className).not.toContain('accounts-row');
    expect(title.className).not.toContain('account-gauge-label');
    // "Passkeys" stays — as the LIST's own label underneath, not as the
    // block's identity.
    expect(screen.getByText(/^Passkeys$/)).toBeInTheDocument();
  });

  it('does not dress the session block as one either', async () => {
    stubFetch(PASSPHRASE_ONLY);
    render(<AccountsScreen />);
    const title = await screen.findByText('This session');
    const block = title.closest('section');
    expect(block).not.toBeNull();
    expect(block!.className).not.toContain('accounts-row');
    expect(title.className).not.toContain('account-gauge-label');
  });
});
