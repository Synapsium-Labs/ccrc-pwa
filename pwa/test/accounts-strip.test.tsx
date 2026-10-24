import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AccountUsage } from '../../shared/api';
import { CommandLayer } from '../src/command/CommandLayer';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { declValue, ruleIn } from './cssRule';
import { TEST_ROSTER } from './rosterFixture';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const nowSec = Math.floor(Date.now() / 1000);

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: nowSec - 3600,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

/** Stubs GET /api/accounts the way every test in this file needs it stubbed —
 *  `projected` is a fixed, irrelevant fixture because AccountsStrip never
 *  reads it (see useProjectedHome for the component that does). */
const stubAccounts = (accounts: AccountUsage[]): void => {
  vi.spyOn(api, 'accounts').mockResolvedValue({
    accounts,
    projected: { wrapper: 'claude', score: 0 },
    roster: TEST_ROSTER,
  });
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); navigate('/'); });

describe('AccountsStrip', () => {
  it('a rolled-over window reads 0% with its countdown', async () => {
    // Both fixtures are states the server can actually emit: readLimits sets
    // fiveRolledOver only when fiveResetAt is non-null and has passed (and then
    // forces five to 0), so an inferred zero always comes with a past reset
    // stamp and a measured one with a window still running. Without the stamps
    // this test would assert on data no server could produce.
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [
        acct({ wrapper: 'claude', five: 0, fiveResetAt: nowSec - 60, fiveRolledOver: true, seven: 57, sevenRolledOver: false }),
        acct({ wrapper: 'claude9', five: 0, fiveResetAt: nowSec + 9000, fiveRolledOver: false, seven: 93, sevenRolledOver: false }),
      ],
      // The strip ignores it; the route always sends it (see useProjectedHome).
      projected: { wrapper: 'claude', score: 57 },
      roster: TEST_ROSTER,
    });
    render(<AccountsStrip />);
    // claude's 5h rolled over (R48: it reads 0%, its sr-only words say it reset and the 0% is inferred);
    // claude9's 5h was really measured at zero, which speaks no "inferred".
    const inferred = await screen.findByText(/inferred/);
    expect(inferred).toHaveTextContent('0%, inferred: the window reset');
    const rolledRow = inferred.closest('.acct-row') as HTMLElement;
    expect(rolledRow.querySelector('.acct-pct [aria-hidden="true"]')).toHaveTextContent('0%');
    // …beside its countdown (the stamp has passed, so the window reads as resetting now).
    expect(rolledRow.querySelector('.acct-reset')).toHaveTextContent(/↻/);
    // Two 0% nodes show: the rolled-over one and the measured one.
    expect(screen.getAllByText('0%')).toHaveLength(2);
    expect(screen.getByText('57%')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
  });

  it('a measured window prints its percentage once: no sr-only span and nothing aria-hidden beside it', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [acct({ wrapper: 'claude', five: 40, fiveResetAt: nowSec + 9000, fiveRolledOver: false, seven: 57, sevenRolledOver: false })],
      projected: { wrapper: 'claude', score: 57 },
      roster: TEST_ROSTER,
    });
    render(<AccountsStrip />);
    const pct = (await screen.findByText('57%')).closest('.acct-pct') as HTMLElement;
    expect(pct.querySelector('.sr-only')).toBeNull();
    expect(pct.querySelector('[aria-hidden]')).toBeNull();
    expect(pct.textContent).toBe('57%');
    // One element holds the text: the query above would have thrown on two.
    expect(screen.getAllByText('40%')).toHaveLength(1);
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
    // These two click the strip, a command door now (desktop-polish S5a): they mount the layer that navigates.
    it('stays a tappable link when every reporting lane is disabled', async () => {
      stubAccounts([acct({ wrapper: 'claude', disabled: true }), acct({ wrapper: 'claude9', disabled: true })]);
      render(<><CommandLayer openNewSession={() => {}} /><AccountsStrip /></>);
      const link = await screen.findByRole('link', { name: 'account usage — open accounts' });
      expect(screen.getByText(/all lanes disabled/i)).toBeInTheDocument();
      fireEvent.click(link);
      expect(location.pathname).toBe('/accounts');
    });

    it('stays a tappable link when the poll resolves with zero accounts (fresh host)', async () => {
      stubAccounts([]);
      render(<><CommandLayer openNewSession={() => {}} /><AccountsStrip /></>);
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

  // Task 6 (Build 3 PR G, Rider A) made the strip the nav affordance onto /accounts; T2c (D-6329, R48) splits that
  // door: with lanes to show, each CARD is the door to its own lane (`actionDoor('open-lane', …)`: it navigates by
  // itself, so no command layer is needed), and the end cell's All accounts button is the `go-accounts` command door
  // (the layer navigates). The placeholder strip, with no lane to show, stays the one `go-accounts` door.
  describe('nav affordance (Task 6, T2c)', () => {
    it('a card is a link to its lane, reachable by tap, and no command layer is mounted to take it there', async () => {
      stubAccounts([acct({ wrapper: 'claude' })]);
      render(<AccountsStrip />);
      const card = await screen.findByRole('link', { name: /^team·max:/ });
      fireEvent.click(card);
      expect(location.pathname).toBe('/accounts');
      expect(location.search).toBe('?lane=claude');
    });

    it('a card activates on Enter (keyboard-only reachable, not just tap)', async () => {
      stubAccounts([acct({ wrapper: 'claude' })]);
      render(<AccountsStrip />);
      const card = await screen.findByRole('link', { name: /^team·max:/ });
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(location.pathname).toBe('/accounts');
      expect(location.search).toBe('?lane=claude');
    });

    it('All accounts goes through the command layer: without one a tap goes nowhere, with one it opens /accounts', async () => {
      stubAccounts([acct({ wrapper: 'claude' })]);
      render(<AccountsStrip />);
      fireEvent.click(await screen.findByRole('button', { name: 'All accounts' }));
      expect(location.pathname).toBe('/');
      cleanup();
      render(<><CommandLayer openNewSession={() => {}} /><AccountsStrip /></>);
      fireEvent.click(await screen.findByRole('button', { name: 'All accounts' }));
      expect(location.pathname).toBe('/accounts');
      expect(location.search).toBe('');
    });

    // jsdom evaluates no stylesheet (vitest runs with `css: false`), so a
    // computed 44px cannot be asserted directly — the scrape proves the rule
    // exists off the shared token, and the render proves the class is still
    // on the element the scrape describes. See test/cssRule.ts for why a text
    // scrape is the right tool here at all.
    it('the placeholder door and a card are each at least one tap tall, off the shared token', () => {
      expect(declValue(ruleIn(fleetCss, '.accounts-strip[role="link"]'), 'min-height')).toBe('var(--tap-min)');
      expect(declValue(ruleIn(fleetCss, '.account-gauge'), 'min-height')).toBe('var(--tap-min)');
      expect(declValue(ruleIn(fleetCss, '.account-gauge'), 'cursor')).toBe('pointer');
    });

    it('the placeholder is the class the rendered link actually carries', async () => {
      stubAccounts([]);
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

  // The strip hides a switched-off lane, but a lane whose sign-in expired stays
  // on it. Its numbers are frozen at the last moment anything ran there, so its
  // fills take the `off` band, as the Accounts screen's do (D-5494): a crit bar
  // on a lane nothing can refresh reads as live pressure.
  it('greys the fills of a sign-in-expired lane, keeping its band, and leaves a live lane coloured', async () => {
    stubAccounts([
      acct({ wrapper: 'claude', five: 91, seven: 40, authDead: true }),
      acct({ wrapper: 'claude9', five: 91, seven: 40 }),
    ]);
    const { container } = render(<AccountsStrip />);
    await screen.findAllByText('91%');
    const gauges = container.querySelectorAll('.account-gauge');
    expect(gauges).toHaveLength(2);
    const fills = (g: Element) => [...g.querySelectorAll('.acct-fill')];
    expect(fills(gauges[0]!).map((f) => f.classList.contains('limit-fill--off'))).toEqual([true, true]);
    expect(gauges[0]!.querySelector('.acct-meter')).toHaveAttribute('data-band', 'crit');
    expect(fills(gauges[1]!).map((f) => f.classList.contains('limit-fill--off'))).toEqual([false, false]);
    expect(fills(gauges[1]!)[0]).toHaveClass('limit-fill--crit');
  });
});
