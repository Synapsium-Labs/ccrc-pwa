// Settings › Security's Sign-in gate card and the banner every Settings page shows while the gate is open to other
// machines (settings Task R2b2; spec §5.5, §11.1; D-5503). R2d and R5 extend this suite with their cards.
// Neutral fixtures: the exposed host is `ccrc.example`, a reserved name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { SETTINGS_SECTIONS } from '../src/lib/routes';
import { SETTINGS_CARDS, SIGN_IN_GATE_TEXT } from '../src/fleet/settingsText';
import { renderSettings } from './settingsHost';
import { updatesView } from './settingsViewFixture';

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
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Sign-in gate', 'Box token']);
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
