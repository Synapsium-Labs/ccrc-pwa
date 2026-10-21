// Settings › Security's Sign-in gate card and the banner every Settings page shows while the gate is open to other
// machines (settings Task R2b2; spec §5.5, §11.1; D-5503). R2d and R5 extend this suite with their cards.
// Neutral fixtures: the exposed host is `ccrc.example`, a reserved name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COSE_ES256 } from '../../shared/api';
import { api } from '../src/lib/api';
import { authLost, clearAuthLost, onAuthPostureChanged } from '../src/lib/auth';
import { PasskeyNotice } from '../src/fleet/PasskeyNotice';
import { navigate } from '../src/lib/router';
import { SETTINGS_SECTIONS } from '../src/lib/routes';
import { SETTINGS_CARDS, SIGN_IN_GATE_TEXT } from '../src/fleet/settingsText';
import { renderSettings } from './settingsHost';
import { SettingsDataProvider, useSettingsView, type SettingsPageView } from '../src/screens/settings/SettingsDataProvider';
import { SettingsScreen } from '../src/screens/settings/SettingsFrame';
import { updatesView } from './settingsViewFixture';
import { SIGN_IN_TEXT, YourSignInCard } from '../src/screens/settings/YourSignInCard';
import { ThisSessionCard } from '../src/screens/settings/ThisSessionCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** GET /api/auth/status answers `answer`; every other fetch is a 404. */
const authStatus = (answer: { status: number; body: unknown } | 'network') => {
  const f = vi.fn(async (url: unknown): Promise<Response> => {
    if (String(url) !== '/api/auth/status') return json(404, { error: 'not-found' });
    if (answer === 'network') throw new TypeError('Failed to fetch');
    return json(answer.status, answer.body);
  });
  vi.stubGlobal('fetch', f);
  return f;
};
/** The page's hostname, everything else the live location (so the router still reads the path it pushes). */
const host = (hostname: string): void => {
  const real = window.location;
  vi.stubGlobal('location', new Proxy(real, {
    get: (t, k) => (k === 'hostname' ? hostname : Reflect.get(t, k, t) as unknown),
  }));
};
const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const quietReads = (): void => {
  vi.spyOn(api, 'updates').mockResolvedValue(updatesView());
  vi.spyOn(api, 'stallWatch').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'collectLane').mockReturnValue(new Promise(() => {}));
};
const gateCard = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.security.gate.title });
const banner = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-gate-banner]');
const OFF = { status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } };

/** Security, with the gate answering `answer` on `hostname`, once the read has landed. */
const security = async (answer: Parameters<typeof authStatus>[0], hostname = 'ccrc.example'): Promise<HTMLElement> => {
  const f = authStatus(answer);
  host(hostname);
  quietReads();
  renderSettings('security');
  await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
  await settle();
  return gateCard();
};

describe('the Sign-in gate card, per state (spec §5.5)', () => {
  it('is the first card on Security, scoped to This box, before Box token', async () => {
    await security({ status: 200, body: { authed: true, passkeysEnrolled: 1, mode: 'passphrase' } });
    await screen.findByRole('region', { name: 'Box token' });
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles[0]).toBe('Sign-in gate');
    expect(titles.at(-1)).toBe('Box token');
    expect(within(gateCard()).getByText('This box')).toBeInTheDocument();
  });

  it('passphrase: one line, sign-in is on', async () => {
    const card = await security({ status: 200, body: { authed: true, passkeysEnrolled: 2, mode: 'passphrase' } });
    expect(within(card).getByText(SIGN_IN_GATE_TEXT.on)).toHaveClass('settings-note');
    expect(card.querySelector('.settings-unarmed')).toBeNull();
  });

  it('locked-out: locked, and it reopens by itself', async () => {
    const card = await security({ status: 200, body: { authed: false, passkeysEnrolled: 1, mode: 'locked-out' } });
    expect(within(card).getByText(SIGN_IN_GATE_TEXT.lockedOut)).toBeInTheDocument();
    expect(within(card).queryByText(SIGN_IN_GATE_TEXT.on)).toBeNull();
  });

  it('off and exposed: the danger tone, the lead, the remedy, and where passkeys and sign-out will appear', async () => {
    const card = await security(OFF);
    const danger = card.querySelector<HTMLElement>('.settings-unarmed');
    expect(danger, 'the danger tone').not.toBeNull();
    expect(within(danger!).getByText(SIGN_IN_GATE_TEXT.exposedLead)).toBeInTheDocument();
    expect(within(danger!).getByText(SIGN_IN_GATE_TEXT.remedy)).toBeInTheDocument();
    for (const word of ['CCRC_AUTH=on', 'CCRC_RP_ID', 'CCRC_ORIGIN', 'ccrc.env']) expect(SIGN_IN_GATE_TEXT.remedy).toContain(word);
    expect(within(card).getByText(SIGN_IN_GATE_TEXT.laterCards)).toBeInTheDocument();
  });

  it('off on loopback: off, reachable from this machine only, in neutral ink, and no banner', async () => {
    const card = await security(OFF, '127.0.0.1');
    expect(within(card).getByText(SIGN_IN_GATE_TEXT.loopback)).toHaveClass('settings-note');
    expect(card.querySelector('.settings-unarmed'), 'not the danger tone').toBeNull();
    expect(banner(), 'no banner for a gate only this machine can reach').toBeNull();
  });

  it('unreadable: a failed read, an older server and a body without a mode all say "could not be read", never on', async () => {
    for (const answer of [{ status: 404, body: { error: 'not-found' } }, 'network', { status: 200, body: { authed: false } }] as const) {
      const card = await security(answer);
      expect(within(card).getByText(SIGN_IN_GATE_TEXT.unread)).toBeInTheDocument();
      expect(within(card).queryByText(SIGN_IN_GATE_TEXT.on)).toBeNull();
      expect(within(card).queryByText(SIGN_IN_GATE_TEXT.loopback)).toBeNull();
      expect(banner()).toBeNull();
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('before the read lands, a skeleton', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    quietReads();
    renderSettings('security');
    expect(within(gateCard()).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});

describe('the gate banner (spec §5.5, §11.1)', () => {
  it('the banner shows on every Settings page only while exposed, with role="alert" once', async () => {
    const f = authStatus(OFF);
    host('ccrc.example');
    quietReads();
    const alerts: Element[] = [];
    const seen = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          for (const el of [n, ...n.querySelectorAll('[role="alert"]')]) if (el.getAttribute('role') === 'alert') alerts.push(el);
        }
      }
    });
    seen.observe(document.body, { childList: true, subtree: true });
    renderSettings(null);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    const first = await waitFor(() => { const b = banner(); expect(b).not.toBeNull(); return b!; });
    expect(first).toHaveAttribute('role', 'alert');
    expect(first).toHaveClass('settings-unarmed');
    expect(first.textContent).toContain(SIGN_IN_GATE_TEXT.exposedLead);
    const link = within(first).getByRole('link', { name: SIGN_IN_GATE_TEXT.bannerLink });
    expect(link).toHaveAttribute('href', '/settings/security');
    // Every page shows it, and it is the same node: mounted, and so announced, once.
    for (const s of SETTINGS_SECTIONS) {
      act(() => navigate(`/settings/${s.id}`));
      expect(banner(), s.id).toBe(first);
      // On Security itself the card below says the same words, so the banner keeps its node and lead but no link to
      // the page it is already on.
      expect(within(first).queryAllByRole('link'), s.id).toHaveLength(s.id === 'security' ? 0 : 1);
    }
    act(() => navigate('/settings'));
    expect(banner()).toBe(first);
    seen.disconnect();
    expect(alerts.filter((a) => a.hasAttribute('data-gate-banner'))).toHaveLength(1);
  });

  it('its link opens Security in place', async () => {
    authStatus(OFF);
    host('ccrc.example');
    quietReads();
    renderSettings('updates');
    const link = await screen.findByRole('link', { name: SIGN_IN_GATE_TEXT.bannerLink });
    act(() => { link.click(); });
    expect(location.pathname).toBe('/settings/security');
    expect(screen.getByRole('heading', { level: 2, name: 'Security' })).toBeInTheDocument();
  });

  it('shows nothing while the gate is on, locked, or unreadable, whatever the hostname', async () => {
    for (const answer of [
      { status: 200, body: { authed: true, passkeysEnrolled: 1, mode: 'passphrase' } },
      { status: 200, body: { authed: false, passkeysEnrolled: 1, mode: 'locked-out' } },
      { status: 404, body: { error: 'not-found' } },
    ] as const) {
      await security(answer);
      expect(banner()).toBeNull();
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("today's top-of-page paragraph is gone: no page names a route in its warning", async () => {
    authStatus(OFF);
    host('ccrc.example');
    quietReads();
    renderSettings(null);
    const shown = await waitFor(() => { const b = banner(); expect(b).not.toBeNull(); return b!; });
    expect(document.body.textContent).not.toContain('POST /api/updates/apply');
    expect(document.body.textContent).not.toContain('reached over a non-loopback address');
    expect(shown.textContent).not.toMatch(/CCRC_AUTH/);   // the remedy is the card's, not the banner's
  });
});

// ── Your sign-in and This session (settings Task R2d; spec §5.5; D-5508) ──────────────────────────────────────────
// The two cards Security received from Accounts. They make no read of their own: the provider reads the passkey list
// once per mount, only while the status says the gate is armed, and `refreshAuth()` is the one way it is read again.

describe('Your sign-in and This session on Security (R2d; D-5508)', () => {
  afterEach(() => { clearAuthLost(); });

  const KEY_A = { credentialIdB64url: 'AQEB', label: 'Device A / Browser', enrolledAt: Date.now() - 86_400_000, lastUsedAt: 0, uvAtEnrollment: true };
  const KEY_B = { credentialIdB64url: 'AgIC', label: 'Device B / Browser', enrolledAt: Date.now() - 86_400_000, lastUsedAt: 0, uvAtEnrollment: true };
  const NEW_KEY = { credentialIdB64url: 'CQkJ', label: 'Device C / Browser', enrolledAt: Date.now(), lastUsedAt: 0, uvAtEnrollment: true };

  /** A box: its mode, and its keys, which DELETE and register/finish change as a server would. */
  const box = (startMode: string, start: (typeof KEY_A)[]) => {
    let keys = [...start];
    let mode = startMode;
    const f = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      if (u === '/api/auth/status') return json(200, { authed: true, passkeysEnrolled: keys.length, mode });
      if (u === '/api/auth/passkeys') return json(200, { credentials: keys, storeUnreadable: false });
      if (u.startsWith('/api/auth/passkey/') && init?.method === 'DELETE') {
        const id = decodeURIComponent(u.slice('/api/auth/passkey/'.length));
        keys = keys.filter((k) => k.credentialIdB64url !== id);
        return new Response(null, { status: 204 });
      }
      if (u.endsWith('/passkey/register/start')) {
        return json(200, { challengeB64url: 'QUJD', rpId: 'localhost', userHandleB64url: 'QUJD' });
      }
      if (u.endsWith('/passkey/register/finish')) { keys = [...keys, NEW_KEY]; return new Response(null, { status: 204 }); }
      if (u === '/api/auth/logout' && init?.method === 'POST') return new Response(null, { status: 204 });
      return json(404, { error: 'not-found' });
    });
    vi.stubGlobal('fetch', f);
    const calls = (path: string, method = 'GET'): number =>
      f.mock.calls.filter(([u, i]) => String(u).startsWith(path) && ((i as RequestInit | undefined)?.method ?? 'GET') === method).length;
    return { f, calls, keys: () => keys, setMode: (m: string) => { mode = m; } };
  };
  /** WebAuthn Level 2, with a ceremony that answers (auth-passkey.test.tsx owns the L1/L2 story). */
  const canEnrol = (): void => {
    vi.stubGlobal('PublicKeyCredential', class { getClientExtensionResults(): unknown { return {}; } });
    vi.stubGlobal('AuthenticatorAttestationResponse', class { getPublicKey(): unknown { return null; } });
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(),
        create: vi.fn(async () => ({
          rawId: new Uint8Array([9, 9, 9]).buffer,
          response: {
            clientDataJSON: new Uint8Array([5, 6, 7]).buffer,
            getPublicKey: () => new Uint8Array([0x30, 0x59, 0x01, 0x02]).buffer,
            getPublicKeyAlgorithm: () => COSE_ES256,
            getAuthenticatorData: () => new Uint8Array([1, 2, 3, 4]).buffer,
          },
        })),
      },
    });
  };
  const armed = async (start: (typeof KEY_A)[] = [KEY_A, KEY_B], hostname = 'ccrc.example') => {
    canEnrol();
    const b = box('passphrase', start);
    host(hostname);
    quietReads();
    renderSettings('security');
    await screen.findByRole('region', { name: 'Your sign-in' });
    await settle();
    return b;
  };
  const signInCard = (): HTMLElement => screen.getByRole('region', { name: 'Your sign-in' });
  const revokeAndConfirm = async (label: string): Promise<void> => {
    fireEvent.click(within(signInCard()).getByRole('button', { name: `Revoke passkey ${label}` }));
    const sheet = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Revoke' })); });
    await settle();
  };

  it('Security renders four cards in order when the gate is armed', async () => {
    await armed();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['Sign-in gate', 'Your sign-in', 'This session', 'Box token']);
    expect(within(signInCard()).getByText('You')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'This session' })).getByText('This browser')).toBeInTheDocument();
    expect(within(signInCard()).getByRole('heading', { level: 4, name: 'Passkeys' })).toBeInTheDocument();
  });

  it('the passkey list is read once per mount, and not at all while the gate is off', async () => {
    const b = await armed();
    expect(b.calls('/api/auth/passkeys')).toBe(1);
    // Moving between the sections keeps the one read.
    act(() => navigate('/settings/updates'));
    act(() => navigate('/settings/security'));
    await settle();
    expect(b.calls('/api/auth/passkeys')).toBe(1);
    // The re-read after a revoke keeps the guard: a box whose gate went off meanwhile is not asked for its list.
    b.setMode('off');
    await revokeAndConfirm(KEY_A.label);
    await waitFor(() => expect(b.calls('/api/auth/status')).toBe(2));
    await settle();
    expect(b.calls('/api/auth/passkeys')).toBe(1);
    cleanup();
    vi.unstubAllGlobals();
    for (const hostname of ['ccrc.example', '127.0.0.1']) {
      const off = box('off', [KEY_A]);
      host(hostname);
      quietReads();
      renderSettings('security');
      await waitFor(() => expect(off.calls('/api/auth/status')).toBe(1));
      await settle();
      expect(off.calls('/api/auth/passkeys'), hostname).toBe(0);
      expect(screen.queryByRole('region', { name: 'Your sign-in' }), hostname).toBeNull();
      expect(screen.queryByRole('region', { name: 'This session' }), hostname).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('the cards make no read of their own', async () => {
    canEnrol();
    const b = box('passphrase', [KEY_A]);
    render(
      <>
        <YourSignInCard
          status={{ authed: true, passkeysEnrolled: 1, mode: 'passphrase' }}
          passkeys={{ kind: 'read', list: { credentials: [KEY_A], storeUnreadable: false } }}
          refreshAuth={() => {}}
        />
        <ThisSessionCard />
      </>,
    );
    await settle();
    expect(screen.getByText(KEY_A.label)).toBeInTheDocument();
    expect(b.f.mock.calls.filter(([, i]) => ((i as RequestInit | undefined)?.method ?? 'GET') === 'GET')).toHaveLength(0);
  });

  it('after Revoke the list re-reads once and the row is gone', async () => {
    const b = await armed();
    await revokeAndConfirm(KEY_A.label);
    expect(b.calls('/api/auth/passkey/', 'DELETE')).toBe(1);
    await waitFor(() => expect(within(signInCard()).queryByText(KEY_A.label)).toBeNull());
    expect(b.calls('/api/auth/passkeys')).toBe(2);
    expect(within(signInCard()).getByText(KEY_B.label)).toBeInTheDocument();
  });

  it('after Add the new row appears', async () => {
    const b = await armed([KEY_A]);
    await act(async () => {
      fireEvent.click(within(signInCard()).getByRole('button', { name: 'Add a passkey on this device' }));
    });
    expect(await within(signInCard()).findByText(NEW_KEY.label)).toBeInTheDocument();
    expect(b.calls('/api/auth/passkeys')).toBe(2);
  });

  it('Add and Revoke each announce authPostureChanged', async () => {
    const heard = vi.fn();
    const off = onAuthPostureChanged(heard);
    try {
      await armed([KEY_A, KEY_B]);
      await act(async () => {
        fireEvent.click(within(signInCard()).getByRole('button', { name: 'Add a passkey on this device' }));
      });
      await within(signInCard()).findByText(NEW_KEY.label);
      expect(heard).toHaveBeenCalledTimes(1);
      await revokeAndConfirm(KEY_A.label);
      await waitFor(() => expect(heard).toHaveBeenCalledTimes(2));
    } finally {
      off();
    }
  });

  it('revoking the last passkey brings back the passphrase-only notice', async () => {
    // The D-161 sidebar mounted beside the pane, as at 1280: the notice reads its own status and hears the writer.
    canEnrol();
    box('passphrase', [KEY_A]);
    host('ccrc.example');
    quietReads();
    navigate('/settings/security');
    render(<><PasskeyNotice /><SettingsDataProvider active><SettingsScreen /></SettingsDataProvider></>);
    await screen.findByRole('region', { name: 'Your sign-in' });
    await settle();
    expect(screen.queryByRole('button', { name: /passphrase only/i })).toBeNull();
    await revokeAndConfirm(KEY_A.label);
    expect(await screen.findByRole('button', { name: /passphrase only/i })).toBeInTheDocument();
  });

  it('Sign out still goes through raiseAuthLost', async () => {
    const b = await armed();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('region', { name: 'This session' })).getByRole('button', { name: 'Sign out' }));
    });
    expect(b.calls('/api/auth/logout', 'POST')).toBe(1);
    expect(authLost()).toEqual({ lost: true, verdict: 'no-session' });
  });

  it('an unreadable status shows no Your sign-in or This session, and never says on', async () => {
    for (const answer of [{ status: 404, body: { error: 'not-found' } }, 'network', { status: 200, body: { authed: true } }] as const) {
      const f = authStatus(answer);
      host('ccrc.example');
      quietReads();
      renderSettings('security');
      await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
      await settle();
      expect(within(gateCard()).getByText(SIGN_IN_GATE_TEXT.unread)).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Your sign-in' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'This session' })).toBeNull();
      expect(document.body.textContent).not.toContain(SIGN_IN_GATE_TEXT.on);
      expect(f.mock.calls.some(([u]) => String(u) === '/api/auth/passkeys')).toBe(false);
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('a failed passkey list read says so under the count, with no rows', async () => {
    canEnrol();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown): Promise<Response> => {
      const u = String(url);
      if (u === '/api/auth/status') return json(200, { authed: true, passkeysEnrolled: 2, mode: 'passphrase' });
      if (u === '/api/auth/passkeys') return json(500, { error: 'internal' });
      return json(404, { error: 'not-found' });
    }));
    host('ccrc.example');
    quietReads();
    renderSettings('security');
    const card = await screen.findByRole('region', { name: 'Your sign-in' });
    await waitFor(() => expect(within(card).getByText(SIGN_IN_TEXT.listFailed)).toBeInTheDocument());
    expect(within(card).getByText(SIGN_IN_TEXT.count(2))).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Revoke passkey/ })).toBeNull();
  });

  it("the newest re-read wins: an older run's late passkey list never overwrites it", async () => {
    const lists: ((r: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown): Promise<Response> => {
      const u = String(url);
      if (u === '/api/auth/status') return json(200, { authed: true, passkeysEnrolled: 1, mode: 'passphrase' });
      if (u === '/api/auth/passkeys') return new Promise<Response>((r) => { lists.push(r); });
      return json(404, { error: 'not-found' });
    }));
    quietReads();
    let seen: SettingsPageView | null = null;
    const Probe = (): null => { seen = useSettingsView(); return null; };
    render(<SettingsDataProvider active><Probe /></SettingsDataProvider>);
    await waitFor(() => expect(lists).toHaveLength(1));
    act(() => { seen!.refreshAuth(); });
    await waitFor(() => expect(lists).toHaveLength(2));
    // The newer run answers first; the older one answers late and must not write.
    await act(async () => { lists[1]!(json(200, { credentials: [KEY_B], storeUnreadable: false })); });
    await settle();
    await act(async () => { lists[0]!(json(200, { credentials: [KEY_A], storeUnreadable: false })); });
    await settle();
    const read = seen!.passkeys;
    expect(read.kind === 'read' ? read.list.credentials.map((c) => c.credentialIdB64url) : read.kind).toEqual([KEY_B.credentialIdB64url]);
  });
});
