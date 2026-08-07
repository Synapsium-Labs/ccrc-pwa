import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AccountUsage } from '../../shared/api';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const nowSec = Math.floor(Date.now() / 1000);

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: nowSec - 3600,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, ...over,
});

/** Stubs GET /api/accounts the way every test in this file needs it stubbed —
 *  `projected` is a fixed, irrelevant fixture because AccountsStrip never
 *  reads it (see useProjectedHome for the component that does). */
const stubAccounts = (accounts: AccountUsage[]): void => {
  vi.spyOn(api, 'accounts').mockResolvedValue({
    accounts,
    projected: { wrapper: 'claude', score: 0 },
  });
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); navigate('/'); });

describe('AccountsStrip', () => {
  it('shows an inferred zero as "reset" and a measured zero as 0%', async () => {
    // Both fixtures are states the server can actually emit: readLimits sets
    // fiveRolledOver only when fiveResetAt is non-null and has passed (and then
    // forces five to 0), so an inferred zero always comes with a past reset
    // stamp and a measured one with a window still running. Without the stamps
    // this test would assert on data no server could produce.
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [
        acct({ wrapper: 'claude', five: 0, fiveResetAt: nowSec - 60, fiveRolledOver: true, seven: 57, sevenRolledOver: false }),
        acct({ wrapper: 'claude2', five: 0, fiveResetAt: nowSec + 9000, fiveRolledOver: false, seven: 93, sevenRolledOver: false }),
      ],
      // The strip ignores it; the route always sends it (see useProjectedHome).
      projected: { wrapper: 'claude', score: 57 },
    });
    render(<AccountsStrip />);
    // claude's 5h rolled over; claude2's 5h was really measured at zero.
    expect(await screen.findByText('reset')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
  });

  it('hides an account whose lane is switched off', async () => {
    // ccd will not route work there, so showing a gauge invites a tap that
    // cannot succeed.
    stubAccounts([acct({ wrapper: 'claude' }), acct({ wrapper: 'gpt', disabled: true })]);
    render(<AccountsStrip />);
    expect(await screen.findByText('team·max')).toBeInTheDocument();
    expect(screen.queryByText('gpt')).not.toBeInTheDocument();
  });

  // The strip is now the app's ONLY door to /accounts (Task 6 review fix).
  // It used to `return null` in exactly these states, which used to also take
  // the desktop top bar down with it (shell.css's `.shell-accounts:empty`).
  // Losing the gauges is fine — losing the one way to REACH the screen that
  // explains why the gauges are gone is the bug.
  describe('never disappears, even with nothing to gauge (Task 6 review fix)', () => {
    it('stays a tappable link when every reporting lane is disabled', async () => {
      stubAccounts([acct({ wrapper: 'claude', disabled: true }), acct({ wrapper: 'claude2', disabled: true })]);
      render(<AccountsStrip />);
      const link = await screen.findByRole('link', { name: 'account usage — open accounts' });
      expect(screen.getByText(/all lanes disabled/i)).toBeInTheDocument();
      fireEvent.click(link);
      expect(location.pathname).toBe('/accounts');
    });

    it('stays a tappable link when the poll resolves with zero accounts (fresh host)', async () => {
      stubAccounts([]);
      render(<AccountsStrip />);
      const link = await screen.findByRole('link', { name: 'account usage — open accounts' });
      expect(screen.getByText(/no accounts reporting/i)).toBeInTheDocument();
      fireEvent.click(link);
      expect(location.pathname).toBe('/accounts');
    });

    it('stays a tappable link before the first poll has landed (and if it never does), naming that state distinctly from a landed-empty poll', () => {
      // A promise that never resolves — the same shape a permanently-failing
      // /api/accounts leaves the component in, since the poller's `.catch`
      // never sets state either. Asserted synchronously, right after mount,
      // with nothing awaited: this is the render BEFORE any microtask from
      // the fetch could have run. This is a DIFFERENT fact from "the poll
      // landed and reported zero accounts" (below) — collapsing the two into
      // one string would erase the difference between "still waiting" and
      // "asked, and got nothing back".
      vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
      render(<AccountsStrip />);
      expect(screen.getByRole('link', { name: 'account usage — open accounts' })).toBeInTheDocument();
      expect(screen.getByText(/checking accounts…/i)).toBeInTheDocument();
      expect(screen.queryByText(/no accounts reporting/i)).not.toBeInTheDocument();
    });
  });

  // Task 6 (Build 3 PR G, Rider A): the strip is the nav affordance onto the
  // new /accounts screen — "both mounts, one behaviour" (it's rendered twice,
  // desktop top bar + mobile fleet list, but there's one component to make
  // tappable). It was a plain `<div role="group">` before this; a real
  // interactive element earns the tap-target gate.
  describe('nav affordance (Task 6)', () => {
    it('is a link to /accounts, reachable by tap or keyboard', async () => {
      stubAccounts([acct({ wrapper: 'claude' })]);
      render(<AccountsStrip />);
      const link = await screen.findByRole('link', { name: 'account usage — open accounts' });
      fireEvent.click(link);
      expect(location.pathname).toBe('/accounts');
    });

    it('activates on Enter (keyboard-only reachable, not just tap)', async () => {
      stubAccounts([acct({ wrapper: 'claude' })]);
      render(<AccountsStrip />);
      const link = await screen.findByRole('link', { name: 'account usage — open accounts' });
      fireEvent.keyDown(link, { key: 'Enter' });
      expect(location.pathname).toBe('/accounts');
    });

    // jsdom evaluates no stylesheet (vitest runs with `css: false`), so a
    // computed 44px cannot be asserted directly — the scrape proves the rule
    // exists off the shared token, and the render proves the class is still
    // on the element the scrape describes. See test/cssRule.ts for why a text
    // scrape is the right tool here at all.
    it('is at least one tap tall, off the shared token — the whole strip is now a link', () => {
      expect(declValue(ruleIn(fleetCss, '.accounts-strip'), 'min-height')).toBe('var(--tap-min)');
    });

    it('is the class the rendered link actually carries', async () => {
      stubAccounts([acct({ wrapper: 'claude' })]);
      render(<AccountsStrip />);
      const link = await screen.findByRole('link', { name: 'account usage — open accounts' });
      expect(link).toHaveClass('accounts-strip');
    });
  });

  // DIRECTION.md's routing bands are `ok < 50`, `warn 50–75`, `crit > 75`
  // (LimitBar.tsx's `limitBand`, test-pinned at primitives.test.tsx:105). The
  // strip carried its own copy that read `crit` at `>= 75`, so the exact same
  // account rendered two different colours depending on which surface you
  // looked at. This is the flip: 75 itself is warn, never crit.
  it('bands exactly 75 as warn, not crit (one writer: limitBand)', async () => {
    stubAccounts([acct({ wrapper: 'claude', five: 75, seven: 10 })]);
    const { container } = render(<AccountsStrip />);
    await screen.findByText('75%');
    const meters = container.querySelectorAll('.acct-meter');
    expect(meters[0]).toHaveAttribute('data-band', 'warn');
  });
});
