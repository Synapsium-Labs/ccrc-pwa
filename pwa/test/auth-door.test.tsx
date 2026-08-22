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
//
// FIX ROUND. Three properties the first version of this file left as prose,
// each measured green under the mutation that breaks it:
//   4. THE ABSENT-FIELD HALVES OF THE GUARD. All four fixtures spelled every
//      field, so `mode` absent → nag and `(passkeysEnrolled ?? 0) === 0` both
//      passed the full 1770-test suite — including the collapse the
//      component's own docstring forbids.
//   5. THE SELF-RETIRING MECHANISM. ~35 lines in lib/auth.ts plus both call
//      sites in AccountsScreen could be deleted in either direction with the
//      suite green, and non-dismissibility is only defensible if retiring
//      works. Pinned END TO END here — the notice and /accounts rendered in ONE
//      document, which is the real desktop arrangement (sidebar + detail pane),
//      enrolling and revoking through the screen's own buttons.
//   6. ENROLMENT MUST BE POSSIBLE. A non-dismissible nag pointing at a button
//      the destination hides is a trap.
//
// HONESTY PASS (the round after that one):
//   7. `mode` WAS STILL A NEGATIVE LIST while the guard's docstring claimed
//      positive evidence for it, so `mode: null` and `mode: 'wat'` both bought
//      the nag with the suite green — the same failure class as 4, one field
//      over, hidden behind prose that said it could not happen. Now a positive
//      roster (`ARMED_MODES`), with the unreadable-mode fixtures and the
//      `'locked-out'` control that keeps them from passing vacuously.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COSE_ES256 } from '../../shared/api';
import { authPostureChanged } from '../src/lib/auth';
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

/** The fleet screen's own routes, `GET /api/auth/status`, the passkey list and
 *  the two enrolment/revocation calls. A fresh Response per call, never one
 *  shared instance: AccountsStrip, FleetHostBanner, the store's roster poll and
 *  the notice all fetch on mount, and a body can only be read once
 *  (fleet-screen.test.tsx's helper carries the same warning).
 *
 *  `status` and `list` may be GETTERS, so a test can change what the box says
 *  about itself half-way through — which is the whole point of the retiring
 *  tests: the posture the notice re-reads has to be the posture the enrolment
 *  just created. `hooks` is where that state flips, keyed on the WRITE landing
 *  rather than on the ceremony finishing, so the fixture behaves like a server. */
const stubFetch = (
  status: unknown | (() => unknown),
  list: unknown | (() => unknown) = { credentials: [], storeUnreadable: false },
  hooks: { onEnrolled?: () => void; onRevoked?: () => void } = {},
) => vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  const now = (v: unknown): unknown => (typeof v === 'function' ? (v as () => unknown)() : v);
  if (u.startsWith('/api/auth/status')) return json(200, now(status));
  if (u === '/api/auth/passkeys') return json(200, now(list));
  if (u.endsWith('/passkey/register/start')) {
    return json(200, { challengeB64url: 'QUJD', rpId: 'localhost', userHandleB64url: 'QUJD' });
  }
  if (u.endsWith('/passkey/register/finish')) {
    hooks.onEnrolled?.();
    return new Response(null, { status: 204 });
  }
  if (u.startsWith('/api/auth/passkey/') && init?.method === 'DELETE') {
    hooks.onRevoked?.();
    return new Response(null, { status: 204 });
  }
  if (u.startsWith('/api/accounts')) {
    return json(200, { accounts: [], projected: null, roster: TEST_ROSTER });
  }
  return json(200, {});
}));

/** A browser that can run BOTH ceremonies — WebAuthn LEVEL 2, i.e. with the
 *  response methods this design needs. Every notice test needs it now that the
 *  guard consults `passkeyEnrollSupported()`: jsdom has no
 *  `navigator.credentials` at all, so an unstubbed environment is the
 *  insecure-context box and the line is correctly silent there. Same fixture as
 *  auth-passkey.test.tsx's `supportBrowser`, which owns the L1/L2 story. */
const supportBrowser = (): void => {
  vi.stubGlobal('PublicKeyCredential', class {
    getClientExtensionResults(): unknown { return {}; }
  });
  vi.stubGlobal('AuthenticatorAttestationResponse', class {
    getPublicKey(): unknown { return null; }
  });
  vi.stubGlobal('navigator', { ...navigator, credentials: { create: vi.fn(), get: vi.fn() } });
};

/** WebAuthn LEVEL 1: it can sign in with a key enrolled elsewhere and cannot
 *  CREATE one — `AuthenticatorAttestationResponse.prototype.getPublicKey` is
 *  missing. The reachable shape of this on a real box is an insecure context
 *  (plain http, which `cookieSecure: false` sanctions), where
 *  `navigator.credentials` is absent outright. */
const level1Browser = (): void => {
  vi.stubGlobal('PublicKeyCredential', class {
    getClientExtensionResults(): unknown { return {}; }
  });
  vi.stubGlobal('AuthenticatorAttestationResponse', undefined);
  vi.stubGlobal('navigator', { ...navigator, credentials: { create: vi.fn(), get: vi.fn() } });
};

/** What `navigator.credentials.create` hands back — the three Level 2
 *  extraction methods `enrollPasskey` reads, and nothing else. */
const fakeCredential = () => ({
  rawId: new Uint8Array([9, 9, 9]).buffer,
  response: {
    clientDataJSON: new Uint8Array([5, 6, 7]).buffer,
    getPublicKey: () => new Uint8Array([0x30, 0x59, 0x01, 0x02]).buffer,
    getPublicKeyAlgorithm: () => COSE_ES256,
    getAuthenticatorData: () => new Uint8Array([1, 2, 3, 4]).buffer,
  },
});

/** One enrolled key, as `GET /api/auth/passkeys` lists it. */
const CRED = {
  credentialIdB64url: 'AQEB',
  label: 'Pixel 8 / Chrome',
  enrolledAt: Date.now() - 86_400_000,
  lastUsedAt: Date.now() - 3_600_000,
  uvAtEnrollment: true,
};

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

/** The notice's accessible name, and NOT /add a passkey/i: /accounts' own
 *  "Add a passkey on this device" matches that too, and the two are on screen
 *  together in the two-pane tests below. Both halves of the sentence, so the
 *  line still has to say WHY it is there. */
const NOTICE = /passphrase only.*add a passkey/i;

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
    supportBrowser();
    stubFetch({ authed: true, passkeysEnrolled: 0, mode: 'off' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('nags once when the gate is armed, we are signed in, and no passkey exists', async () => {
    supportBrowser();
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
    supportBrowser();
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
    supportBrowser();
    stubFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });
});

// ── 2b. absence is never permission ─────────────────────────────────────────

describe('an OLDER SERVER omitting a field never buys the nag (D-161 fix round)', () => {
  // `AuthStatus` is `Partial` on this wire for two reasons at once: the server
  // MINIMIZES the body for a caller it does not know, and a server older than
  // the field (or a proxy answering its own 200) never had it to send. Both
  // arrive as `undefined`, and each of these three is the fixture that was
  // missing while the corresponding collapse passed the whole suite green.
  const settle = async (): Promise<void> => {
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
  };

  it.each([
    // The one the component's own docstring forbids: absent `mode` read as
    // armed puts "add a passkey" on every box with no gate at all.
    ['mode', { authed: true, passkeysEnrolled: 0 }],
    // `(passkeysEnrolled ?? 0) === 0` — an absent count is "it didn't say",
    // never "no key exists".
    ['passkeysEnrolled', { authed: true, mode: 'passphrase' }],
    // Anonymous by omission rather than by `authed: false`.
    ['authed', { passkeysEnrolled: 0, mode: 'passphrase' }],
  ])('says nothing when the body omits %s', async (_field, body) => {
    supportBrowser();
    stubFetch(body);
    render(<FleetScreen store={makeStore()} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });
});

// ── 2d. a mode this build cannot read is not a gate ─────────────────────────

describe('an UNREADABLE mode never buys the nag (D-161 honesty pass)', () => {
  // The guard's `mode` test used to be a NEGATIVE list — anything that was
  // neither `undefined` nor `'off'` counted as armed — while the component's
  // docstring claimed every field was read as positive evidence. So the two
  // absent-field fixtures above passed, the docstring read as satisfied, and
  // `mode: null` or a mode from a newer server still put a non-dismissible
  // "add a passkey" on a box that may have no gate at all. The reachable source
  // is the one that docstring already names: anything between us and the server
  // answering its own 200, or a build newer than this bundle.
  const settle = async (): Promise<void> => {
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
  };

  it.each([
    // `null` is not `undefined`: `?? 'off'` and `=== undefined` are different
    // questions, and JSON has both spellings of nothing.
    ['null', null],
    // A fourth mode from a server newer than this bundle. Silence is the only
    // honest answer — this build cannot know whether that gate takes passkeys.
    ['a mode this build has never heard of', 'device-bound'],
    // Not pedantry: a proxy or a mock answering `{}`-shaped JSON can put any
    // type here, and the field is `Partial<AuthStatus>` on this wire only
    // because TypeScript cannot check what a `fetch` returns.
    ['not even a string', 3],
  ])('says nothing when mode is %s', async (_what, mode) => {
    supportBrowser();
    stubFetch({ authed: true, passkeysEnrolled: 0, mode });
    render(<FleetScreen store={makeStore()} />);
    await settle();
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('DOES nag on a LOCKED-OUT box — that gate is armed, and a passkey is the way past it', async () => {
    // The vacuity control for the three above (they must not be passing because
    // nothing renders in this arrangement) AND the ruling itself: `'locked-out'`
    // is `AuthStatus`'s third mode, it means armed with the login rate-limiter's
    // window closed, and it is on the positive list. Enrolment rides the session
    // cookie, not the limited login route, so on a box we are already signed in
    // to the advice is actionable — and this is the box that most wants a second
    // way in. A guard that only knew `'passphrase'` would go quiet exactly then.
    supportBrowser();
    stubFetch({ authed: true, passkeysEnrolled: 0, mode: 'locked-out' });
    render(<FleetScreen store={makeStore()} />);
    expect(await screen.findByRole('button', { name: NOTICE })).toBeInTheDocument();
  });
});

// ── 2c. the nag must point at something reachable ───────────────────────────

describe('the notice does not nag when enrolling is IMPOSSIBLE (D-161 fix round)', () => {
  it('stays silent on a browser that cannot CREATE a passkey', async () => {
    // The destination gates its Add button on `passkeyEnrollSupported()`
    // (AccountsScreen; auth-passkey.test.tsx pins that half — "hides only the
    // ADD button on a Level 1 browser"). A notice that cannot be dismissed,
    // pointing at a button that is not on the screen it opens, is a trap: the
    // operator's only move is to stop trusting the line.
    level1Browser();
    stubFetch(PASSPHRASE_ONLY);
    render(<FleetScreen store={makeStore()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('and the two are consistent — the same posture WITH support does nag', async () => {
    // The vacuity guard on the test above: without this, deleting the notice
    // entirely would satisfy it.
    supportBrowser();
    stubFetch(PASSPHRASE_ONLY);
    render(<FleetScreen store={makeStore()} />);
    expect(await screen.findByRole('button', { name: NOTICE })).toBeInTheDocument();
  });
});

// ── 2d. it really does retire itself ────────────────────────────────────────

describe('the notice retires and returns with the box\'s posture (D-161 fix round)', () => {
  it('goes the moment a passkey exists and the posture is announced', async () => {
    supportBrowser();
    let keys = 0;
    stubFetch(() => ({ authed: true, passkeysEnrolled: keys, mode: 'passphrase' }));
    render(<FleetScreen store={makeStore()} />);
    await screen.findByRole('button', { name: NOTICE });
    keys = 1;
    await act(async () => { authPostureChanged(); });
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('COMES BACK when the last key is revoked — the nudge is needed both ways', async () => {
    supportBrowser();
    let keys = 1;
    stubFetch(() => ({ authed: true, passkeysEnrolled: keys, mode: 'passphrase' }));
    render(<FleetScreen store={makeStore()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
    keys = 0;
    await act(async () => { authPostureChanged(); });
    expect(await screen.findByRole('button', { name: NOTICE })).toBeInTheDocument();
  });

  it('the NEWEST read wins, even when an older one lands after it', async () => {
    // Two posture announcements inside one round-trip. Without a generation
    // guard the stale answer is the last `setStatus` and the line shows the
    // posture from BEFORE the change — the exact failure the "no poll, no
    // dismiss-state" design cannot tolerate, since nothing would correct it.
    supportBrowser();
    const pending: ((body: unknown) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/api/auth/status')) {
        return new Promise<Response>((resolve) => {
          pending.push((body) => resolve(json(200, body)));
        });
      }
      if (u.startsWith('/api/accounts')) {
        return json(200, { accounts: [], projected: null, roster: TEST_ROSTER });
      }
      return json(200, {});
    }));
    render(<FleetScreen store={makeStore()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => { authPostureChanged(); });
    await waitFor(() => expect(pending).toHaveLength(2));
    // Out of order: read #2 answers first with the CURRENT posture (a key now
    // exists), then read #1's stale "none enrolled" lands.
    await act(async () => { pending[1]!({ authed: true, passkeysEnrolled: 1, mode: 'passphrase' }); });
    await act(async () => { pending[0]!(PASSPHRASE_ONLY); });
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
  });
});

// ── 2e. the writer half: /accounts announces, the sidebar hears it ──────────

describe('enrolling on /accounts retires the notice in the same document (D-161 fix round)', () => {
  // THE REAL DESKTOP ARRANGEMENT: the fleet sidebar and the detail pane are on
  // screen together (app.tsx), so the notice and the enrolment button are in one
  // document and the operator watches one change the other. Both halves of the
  // nudge are under test here — the `authPostureChanged()` call at the WRITER
  // (AccountsScreen) and the subscription at the READER (PasskeyNotice) — which
  // is why this renders both rather than calling the announcement by hand.
  const bothPanes = (
    keysAtStart: number,
  ): { keys: () => number } => {
    let keys = keysAtStart;
    stubFetch(
      () => ({ authed: true, passkeysEnrolled: keys, mode: 'passphrase' }),
      () => ({ credentials: keys > 0 ? [CRED] : [], storeUnreadable: false }),
      { onEnrolled: () => { keys = 1; }, onRevoked: () => { keys = 0; } },
    );
    render(<><FleetScreen store={makeStore()} /><AccountsScreen /></>);
    return { keys: () => keys };
  };

  it('the nag goes when the ADD button on the other pane succeeds', async () => {
    supportBrowser();
    (navigator.credentials as unknown as { create: ReturnType<typeof vi.fn> }).create =
      vi.fn(async () => fakeCredential());
    const box = bothPanes(0);
    await screen.findByRole('button', { name: NOTICE });
    // The full name, not /add a passkey/i: that also matches the notice itself
    // ("Passphrase only — add a passkey"), which is the button we are watching.
    const add = await screen.findByRole('button', { name: /add a passkey on this device/i });
    await act(async () => { fireEvent.click(add); });
    await waitFor(() => expect(box.keys()).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument());
  });

  it('the nag RETURNS when the last key is revoked on the other pane', async () => {
    supportBrowser();
    bothPanes(1);
    const revoke = await screen.findByRole('button', { name: /revoke passkey/i });
    expect(screen.queryByRole('button', { name: NOTICE })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(revoke); });
    expect(await screen.findByRole('button', { name: NOTICE })).toBeInTheDocument();
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
