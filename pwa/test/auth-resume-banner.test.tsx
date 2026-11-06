// The app-level resume banner (accounts plan Task A23, D-7871; spec §6.2 "Closed mid-flow, or the PWA reloaded"): on
// any route's load, an attempt THIS session started that waits for its code shows "A sign-in for lane-x is waiting for
// its code · 7 min left · Continue", and Continue opens the sheet at the code field. Another session's attempt shows
// nothing, and nothing about the attempt is read from storage: the fleet store's in-memory accounts answer is its one
// source. The App is rendered whole, at a phone's width and a desk's, so the banner's two places are both measured.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ACCOUNT_CAPS, type AccountUsage, type AccountsConnect, type FleetSession, type LaneWire, type RosterWire } from '../../shared/api';
import { App } from '../src/app';
import { AuthResumeBanner, authResumeBannerShows } from '../src/accounts/AuthResumeBanner';
import { resumableAttempt } from '../src/accounts/connectFlow';
import { CODE_FIELD_LABEL, resumeBannerText, switchTitle } from '../src/fleet/accountWords';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { sessionPath } from '../src/lib/routes';
import { useFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

const ATTEMPT = 'c'.repeat(32);
const MINT_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=s';
const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token', ...over,
});
const usage = (wrapper: string): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: Math.floor(Date.now() / 1000) - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const CONNECT = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: [...ACCOUNT_CAPS], stepUpFreshUntil: Date.now() + 3_600_000,
});
const OFF: LaneWire = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
/** Lane `id`'s wire with an attempt in `waiting-code`, ending in 7 minutes less a moment. */
const waiting = (mine: boolean, method: 'setup-token' | 'login' = 'setup-token', expiresAt = Date.now() + 7 * 60_000 - 5_000): LaneWire => ({
  ...OFF,
  authAttempt: mine
    ? { state: 'waiting-code', expiresAt, mine: true, attemptId: ATTEMPT, method }
    // Another session's: the server sends it no id or method (D-7871 (1)), and the screen reads `mine` itself, so even a
    // wire that carried both (an older or a confused server) never offers it.
    : { state: 'waiting-code', expiresAt, mine: false, attemptId: ATTEMPT, method } as unknown as LaneWire['authAttempt'],
});
const running = fleetSession({ id: 'lane-a:p-one', wrapper: 'lane-a', home: 'lane-a', project: 'p-one', title: 'one' });

/** A viewport `width` px wide. */
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

/** The App at `at`, with the store holding `lanes` as its last accounts answer: the read that every route's load makes
 *  (the store's one accounts poll), answered here by the store's state, with the network refused. */
function app(at: string, lanes: Record<string, LaneWire>, roster: RosterWire[] = [lane('lane-a'), lane('lane-c')], sessions: FleetSession[] = [running]): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  navigate(at);
  render(<App />);
  useFleetStore.getState().disconnect();
  act(() => {
    useFleetStore.setState({
      conn: 'open', sessions, usage: roster.map((r) => usage(r.id)), projected: null, roster, lanes, accountsConnect: CONNECT(),
    });
  });
}
const banners = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.auth-resume')];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({
    sessions: [], conn: 'connecting', usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
});

describe('the resume banner, on any route (spec §6.2)', () => {
  for (const width of [360, 1920]) {
    it(`loading \`/\` (not \`/accounts\`) with a \`mine\` attempt in waiting-code shows the banner, and Continue opens the code field (${width})`, async () => {
      stubWidth(width);
      const status = vi.spyOn(api, 'accountAuthStatus').mockResolvedValue({
        ok: true, state: 'waiting-code', url: MINT_URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: Date.now() + 400_000,
      });
      const start = vi.spyOn(api, 'accountAuthStart');
      app('/', { 'lane-a': OFF, 'lane-c': waiting(true) });
      // One banner on screen, at the fleet's own route, naming the lane and the minutes its deadline leaves.
      expect(banners()).toHaveLength(1);
      expect(banners()[0]).toHaveTextContent(resumeBannerText('lane-c', 7));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(location.pathname).toBe('/accounts');
      expect(new URLSearchParams(location.search).get('resume')).toBe('lane-c');
      // The sheet adopts the attempt the server holds (no new start), and its first status read brings the code field.
      expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
      expect(status).toHaveBeenCalledWith('lane-c');
      expect(start).not.toHaveBeenCalled();
    });
  }

  it('on a phone, a session and Settings show it at the top of the detail pane; a desk shows it in the banner stack', () => {
    stubWidth(360);
    app(sessionPath(running.id), { 'lane-c': waiting(true) });
    expect(banners()).toHaveLength(1);
    expect(document.querySelector('.shell-detail')!.firstElementChild).toBe(banners()[0]);
    cleanup();
    app('/settings', { 'lane-c': waiting(true) });
    expect(banners()).toHaveLength(1);
    expect(document.querySelector('.shell-detail')!.firstElementChild).toBe(banners()[0]);
    cleanup();
    stubWidth(1920);
    app(sessionPath(running.id), { 'lane-c': waiting(true) });
    expect(banners()).toHaveLength(1);
    expect(document.querySelector('.shell-detail')!.contains(banners()[0]!)).toBe(false);
    expect(banners()[0]!.closest('.banner-slot')).toHaveAttribute('data-banner', 'resume');
  });

  it("another session's attempt shows no banner", () => {
    stubWidth(360);
    app('/', { 'lane-c': waiting(false) });
    expect(banners()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    // The predicate the stack folds on says the same.
    expect(authResumeBannerShows({ 'lane-c': waiting(false) }, Date.now())).toBe(false);
    expect(authResumeBannerShows({ 'lane-c': waiting(true) }, Date.now())).toBe(true);
  });

  it('nothing about the attempt is read from storage', () => {
    stubWidth(360);
    // Storage holding an attempt, and every read of it watched: the banner follows the server's answer alone.
    const planted = JSON.stringify({ laneId: 'lane-c', attemptId: ATTEMPT, state: 'waiting-code', expiresAt: Date.now() + 400_000 });
    for (const k of ['auth-attempt', 'authAttempt', 'resume', 'lane-c']) {
      try { localStorage.setItem(k, planted); sessionStorage.setItem(k, planted); } catch { /* storage refused: nothing planted */ }
    }
    app('/', { 'lane-c': OFF });
    expect(banners()).toHaveLength(0);
    cleanup();
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    app('/', { 'lane-c': waiting(true) });
    expect(banners()).toHaveLength(1);
    expect(reads.mock.calls.map((c) => c[0]).filter((k) => /auth|attempt|resume/i.test(String(k)))).toEqual([]);
    localStorage.clear();
    sessionStorage.clear();
    // And by source: no file that decides or draws the resume names a browser store.
    for (const f of ['src/accounts/AuthResumeBanner.tsx', 'src/accounts/useSignInAttempt.tsx', 'src/accounts/MethodSwitchSheet.tsx', 'src/accounts/connectFlow.ts',
      'src/accounts/ReauthSheet.tsx', 'src/accounts/useOldCredential.ts']) {
      const src = readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
      expect(src, f).not.toMatch(/localStorage|sessionStorage|indexedDB|lib\/storage/);
    }
  });

  it('Continue on a switch to the token opens the switch sheet at its code field', async () => {
    stubWidth(390);
    vi.spyOn(api, 'accountAuthStatus').mockResolvedValue({
      ok: true, state: 'waiting-code', url: MINT_URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: Date.now() + 400_000,
    });
    // A sign-in lane whose attempt mints: the switch (spec §9), not a new lane's sign-in.
    app('/', { 'lane-b': waiting(true, 'setup-token') }, [lane('lane-b', { kind: 'sign-in' })], []);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText(CODE_FIELD_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: switchTitle('lane-b', 'setup-token') })).toBeInTheDocument();
  });
});

describe('which attempt it names (resumableAttempt)', () => {
  const now = Date.now();
  it('only this session\'s, waiting for its code, before its deadline, of a method the sheets run; the soonest first', () => {
    expect(resumableAttempt(null, now)).toBeNull();
    expect(resumableAttempt({ a: waiting(true, 'login', now - 1) }, now)).toBeNull();
    expect(resumableAttempt({ a: { ...OFF, authAttempt: { state: 'starting', expiresAt: now + 60_000, mine: true, attemptId: ATTEMPT, method: 'login' } } }, now)).toBeNull();
    expect(resumableAttempt({ a: { ...OFF, authAttempt: { state: 'waiting-code', expiresAt: now + 60_000, mine: true, attemptId: ATTEMPT, method: 'openrouter-pkce' } } }, now)).toBeNull();
    const r = resumableAttempt({ b: waiting(true, 'login', now + 300_000), a: waiting(true, 'setup-token', now + 120_000) }, now);
    expect(r).toEqual({ id: 'a', held: { attemptId: ATTEMPT, method: 'setup-token', expiresAt: now + 120_000 } });
  });

  it('draws exactly when its check says it shows', () => {
    for (const lanes of [null, { a: OFF }, { a: waiting(false) }, { a: waiting(true) }]) {
      const { container } = render(<AuthResumeBanner lanes={lanes} />);
      expect(container.innerHTML.trim() !== '', JSON.stringify(lanes)).toBe(authResumeBannerShows(lanes, Date.now()));
      cleanup();
    }
  });
});
