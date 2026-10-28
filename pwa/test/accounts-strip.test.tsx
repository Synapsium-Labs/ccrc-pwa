import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ts from 'typescript';
import type { AccountUsage } from '../../shared/api';
import { CommandLayer } from '../src/command/CommandLayer';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { ACCOUNTS_DOOR_LABEL } from '../src/fleet/laneWords';
import { lanesByFree } from '../src/fleet/laneOrder';
import { FLYOUT_CLOSE_MS, FLYOUT_LABEL, FLYOUT_OPEN_MS, LANE_CARD_MIN } from '../src/fleet/stripFold';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { declValue, ruleIn } from './cssRule';
import { isSpecifier, parseTs } from './literalWalker';
import { TEST_ROSTER } from './rosterFixture';
import { seventeenLanes } from './seventeenLanes';

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

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); navigate('/'); });

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

  // ── the lanes row (T2c, D-6329, R48): sorted, each card a door, one tab stop, All accounts at the end ──
  const cardsOf = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.account-gauge')];
  const nameOf = (card: HTMLElement): string => card.querySelector('.account-gauge-label')?.textContent ?? '';
  const threeLanes = (): AccountUsage[] => [
    acct({ wrapper: 'lane-a', five: 60, seven: 80, fiveResetAt: nowSec + 3600, sevenResetAt: nowSec + 86400 }),
    acct({ wrapper: 'lane-b', five: 10, seven: null, fiveResetAt: nowSec + 7200 + 1800 }),
    acct({ wrapper: 'lane-c', five: 30, seven: 20, fiveResetAt: nowSec + 600, sevenResetAt: nowSec + 2 * 86400 }),
  ];

  it('the cards draw lanesByFree\'s order: most free first', async () => {
    stubAccounts(threeLanes());
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    expect(cardsOf(container).map(nameOf)).toEqual(['lane-b', 'lane-c', 'lane-a']);
  });

  it('each card is its lane\'s door: a tap and Enter open /accounts?lane=<id>, and it carries data-action open-lane and no data-command', async () => {
    stubAccounts(threeLanes());
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    for (const card of cardsOf(container)) {
      expect(card).toHaveAttribute('role', 'link');
      expect(card).toHaveAttribute('data-action', 'open-lane');
      expect(card).not.toHaveAttribute('data-command');
    }
    const c = cardsOf(container).find((x) => nameOf(x) === 'lane-c')!;
    fireEvent.click(c);
    expect(location.pathname + location.search).toBe('/accounts?lane=lane-c');
    navigate('/');
    fireEvent.keyDown(cardsOf(container).find((x) => nameOf(x) === 'lane-a')!, { key: 'Enter' });
    expect(location.pathname + location.search).toBe('/accounts?lane=lane-a');
    // A link: Space does not activate it.
    navigate('/');
    fireEvent.keyDown(c, { key: ' ' });
    expect(location.pathname).toBe('/');
  });

  it('a card is named by laneDoorLabel and holds no interactive control of its own', async () => {
    stubAccounts(threeLanes());
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const b = cardsOf(container).find((x) => nameOf(x) === 'lane-b')!;
    expect(b).toHaveAccessibleName(/^lane-b: 5h 10%, resets in 2h (29|30)m — opens lane-b on the Accounts screen$/);
    expect(b.querySelector('a, button, input, select, textarea, [tabindex], [role="button"], [role="link"]')).toBeNull();
  });

  it('the label carries the lane\'s full name as its title', async () => {
    stubAccounts([acct({ wrapper: 'lane-with-a-much-longer-name', five: 5 })]);
    const { container } = render(<AccountsStrip />);
    const label = await screen.findByText('lane-with-a-much-longer-name');
    expect(label).toHaveAttribute('title', 'lane-with-a-much-longer-name');
    expect(cardsOf(container)).toHaveLength(1);
  });

  it('the strip builds no /accounts path of its own', () => {
    // Parsed with TypeScript: the header comment that names /accounts is not a literal. The one builder is imported.
    const src = parseTs(path.join(import.meta.dirname, '..', 'src', 'fleet', 'AccountsStrip.tsx'));
    const literals: string[] = [];
    let importsBuilder = false;
    const visit = (n: ts.Node): void => {
      // A module specifier names a module, not a path the strip builds.
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) && !isSpecifier(n)) literals.push(n.text);
      if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) literals.push(n.text);
      if (ts.isImportDeclaration(n)) {
        const b = n.importClause?.namedBindings;
        if (b !== undefined && ts.isNamedImports(b) && b.elements.some((e) => (e.propertyName ?? e.name).text === 'accountsLaneHref')) importsBuilder = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
    expect(literals.filter((l) => l.includes('/accounts'))).toEqual([]);
    expect(importsBuilder).toBe(true);
  });

  it('after the last card, All accounts is the go-accounts door', async () => {
    stubAccounts(threeLanes());
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const all = screen.getByRole('button', { name: 'All accounts' });
    expect(all).toHaveAttribute('data-command', 'go-accounts');
    expect(all).not.toHaveAttribute('data-action');
    expect(all).not.toHaveAttribute('aria-label');
    expect(all.closest('.accounts-end')).not.toBeNull();
    const last = cardsOf(container).at(-1)!;
    expect(last.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(all.closest('.accounts-end')!.parentElement).toBe(container.querySelector('.accounts-strip'));
  });

  it('with lanes to show the strip is a group named over every live lane, no link and no tab stop; with none it is the go-accounts door', async () => {
    // The fullest lane is the last in sort order, so a name read over a subset would name another lane.
    const lanes = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => acct({ wrapper: `lane-${x}`, five: 5 + i * 10, seven: null }));
    // Six lanes fold to four on a phone (S5b), and this case counts every card: it reads the stored choice, expanded.
    window.localStorage.setItem('ccrc-accounts-strip', 'expanded');
    stubAccounts([...lanes, acct({ wrapper: 'lane-off', five: 99, seven: null, disabled: true })]);
    const { container } = render(<AccountsStrip />);
    const group = await screen.findByRole('group', { name: 'account usage, highest lane-f 55%' });
    expect(group).toHaveClass('accounts-strip');
    expect(group).not.toHaveAttribute('tabindex');
    expect(group).not.toHaveAttribute('data-command');
    expect(group).not.toHaveAttribute('data-action');
    expect(screen.queryByRole('link', { name: 'account usage — open accounts' })).toBeNull();
    expect(container.querySelectorAll('[role="link"]')).toHaveLength(lanes.length);
    // With none (every lane disabled), the strip is the one go-accounts door: a link, a tab stop, named for where it goes.
    cleanup();
    stubAccounts([acct({ wrapper: 'lane-a', disabled: true }), acct({ wrapper: 'lane-b', disabled: true })]);
    render(<AccountsStrip />);
    const door = await screen.findByRole('link', { name: ACCOUNTS_DOOR_LABEL });
    expect(door).toHaveClass('accounts-strip');
    expect(door).toHaveAttribute('role', 'link');
    expect(door.tabIndex).toBe(0);
    expect(door).toHaveAttribute('data-command', 'go-accounts');
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('the cards are one tab stop: arrows, Home and End move focus and the stop, stop at either end, and Tab goes on to All accounts', async () => {
    stubAccounts(threeLanes());
    const user = userEvent.setup();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const cards = (): HTMLElement[] => cardsOf(container);
    const stops = (): string[] => cards().filter((c) => c.tabIndex === 0).map(nameOf);
    // Sorted: lane-b, lane-c, lane-a. The first card holds the stop at mount.
    expect(stops()).toEqual(['lane-b']);
    expect(cards().filter((c) => c.tabIndex === -1)).toHaveLength(2);
    await user.tab();
    expect(document.activeElement).toBe(cards()[0]);
    await user.keyboard('{ArrowLeft}');           // no wrap at the start
    expect(document.activeElement).toBe(cards()[0]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cards()[1]);
    expect(stops()).toEqual(['lane-c']);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cards()[2]);
    await user.keyboard('{ArrowRight}');          // no wrap at the end
    expect(document.activeElement).toBe(cards()[2]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cards()[1]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cards()[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cards()[2]);
    expect(stops()).toEqual(['lane-a']);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'All accounts' }));
    // Shift+Tab comes back to the card that holds the stop.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cards()[2]);
  });

  it('the stop follows its lane through a re-sort, and falls to the first card when that lane leaves', async () => {
    // Fake timers from before the mount, so the strip's 20 s poll interval is the fake one.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const first = [acct({ wrapper: 'lane-a', five: 10 }), acct({ wrapper: 'lane-b', five: 20 }), acct({ wrapper: 'lane-c', five: 30 })];
      const reply = (accounts: AccountUsage[]) => ({ accounts, projected: { wrapper: 'lane-a', score: 0 }, roster: TEST_ROSTER });
      const spy = vi.spyOn(api, 'accounts').mockResolvedValue(reply(first));
      const { container } = render(<AccountsStrip />);
      await screen.findByText('lane-a');
      const stops = (): string[] => cardsOf(container).filter((c) => c.tabIndex === 0).map(nameOf);
      const byName = (n: string): HTMLElement => cardsOf(container).find((c) => nameOf(c) === n)!;
      act(() => { byName('lane-a').focus(); });
      fireEvent.keyDown(byName('lane-a'), { key: 'ArrowRight' });   // lane-b holds the stop
      expect(stops()).toEqual(['lane-b']);
      // lane-b becomes the fullest on the next poll: it moves to the end, and the stop stays on it.
      spy.mockResolvedValue(reply([first[0]!, acct({ wrapper: 'lane-b', five: 90 }), first[2]!]));
      await act(async () => { await vi.advanceTimersByTimeAsync(20_100); });
      expect(cardsOf(container).map(nameOf)).toEqual(['lane-a', 'lane-c', 'lane-b']);
      expect(stops()).toEqual(['lane-b']);
      // lane-b leaves: the stop falls to the first card.
      spy.mockResolvedValue(reply([first[0]!, first[2]!]));
      await act(async () => { await vi.advanceTimersByTimeAsync(20_100); });
      expect(cardsOf(container).map(nameOf)).toEqual(['lane-a', 'lane-c']);
      expect(stops()).toEqual(['lane-a']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('focus stays on the same lane\'s card through a re-sort, not only its tab stop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const first = [acct({ wrapper: 'lane-a', five: 10 }), acct({ wrapper: 'lane-b', five: 20 }), acct({ wrapper: 'lane-c', five: 30 })];
      const reply = (accounts: AccountUsage[]) => ({ accounts, projected: { wrapper: 'lane-a', score: 0 }, roster: TEST_ROSTER });
      const spy = vi.spyOn(api, 'accounts').mockResolvedValue(reply(first));
      const { container } = render(<AccountsStrip />);
      await screen.findByText('lane-a');
      const byName = (n: string): HTMLElement => cardsOf(container).find((c) => nameOf(c) === n)!;
      act(() => { byName('lane-b').focus(); });
      expect(document.activeElement).toBe(byName('lane-b'));
      // lane-b becomes the fullest on the next poll: it moves from the middle to last, and focus must go with it.
      spy.mockResolvedValue(reply([first[0]!, acct({ wrapper: 'lane-b', five: 90 }), first[2]!]));
      await act(async () => { await vi.advanceTimersByTimeAsync(20_100); });
      expect(cardsOf(container).map(nameOf)).toEqual(['lane-a', 'lane-c', 'lane-b']);
      expect(document.activeElement).toBe(byName('lane-b'));
      expect(byName('lane-b').tabIndex).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('arrow keys pressed on All accounts leave the cards\' tab stop where it was', async () => {
    stubAccounts(threeLanes());
    const user = userEvent.setup();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const stops = (): string[] => cardsOf(container).filter((c) => c.tabIndex === 0).map(nameOf);
    await user.tab();
    await user.keyboard('{ArrowRight}');          // lane-c holds the stop
    expect(stops()).toEqual(['lane-c']);
    await user.tab();                              // on to All accounts
    const all = screen.getByRole('button', { name: 'All accounts' });
    expect(document.activeElement).toBe(all);
    for (const key of ['{ArrowLeft}', '{ArrowRight}', '{ArrowUp}', '{ArrowDown}', '{Home}', '{End}']) await user.keyboard(key);
    expect(document.activeElement).toBe(all);
    expect(stops()).toEqual(['lane-c']);
  });

  it('every card shows each window it has, with its meter, percentage and countdown', async () => {
    stubAccounts(threeLanes());
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const byName = (n: string): HTMLElement => cardsOf(container).find((c) => nameOf(c) === n)!;
    const rows = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.acct-row')];
    expect(rows(byName('lane-a')).map((r) => r.querySelector('.acct-win')!.textContent)).toEqual(['5h', '7d']);
    expect(rows(byName('lane-b')).map((r) => r.querySelector('.acct-win')!.textContent)).toEqual(['5h']);
    for (const r of rows(byName('lane-a'))) {
      expect(r.querySelector('.acct-meter')).not.toBeNull();
      expect(r.querySelector('.acct-pct')!.textContent).toMatch(/^\d+%$/);
      expect(r.querySelector('.acct-reset')!.textContent).toMatch(/↻ \S/);
    }
    expect(rows(byName('lane-a'))[0]!.querySelector('.acct-pct')).toHaveTextContent('60%');
    expect(rows(byName('lane-a'))[1]!.querySelector('.acct-pct')).toHaveTextContent('80%');
  });

  it('a lane never read shows no reading and draws no meter', async () => {
    stubAccounts([acct({ wrapper: 'lane-a', five: null, seven: null }), acct({ wrapper: 'lane-b', five: 25, seven: null })]);
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-b');
    const cards = cardsOf(container);
    // Sorted last: a lane never read.
    expect(cards.map(nameOf)).toEqual(['lane-b', 'lane-a']);
    const never = cards[1]!;
    expect(never).toHaveTextContent('no reading');
    expect(never.querySelector('.acct-row, .acct-meter, .acct-fill')).toBeNull();
    expect(never).not.toHaveTextContent('0%');
    expect(never).toHaveAccessibleName('lane-a: no reading — opens lane-a on the Accounts screen');
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
    // The expired lane sorts last (neither has a use that says it is free), so find each card by its lane.
    const gauges = [...container.querySelectorAll<HTMLElement>('.account-gauge')];
    expect(gauges).toHaveLength(2);
    const expired = gauges.find((g) => g.querySelector('.account-gauge-label')?.textContent === 'team·max')!;
    const live = gauges.find((g) => g.querySelector('.account-gauge-label')?.textContent === 'team·alt')!;
    expect(gauges[1]).toBe(expired);
    const fills = (g: Element) => [...g.querySelectorAll('.acct-fill')];
    expect(fills(expired).map((f) => f.classList.contains('limit-fill--off'))).toEqual([true, true]);
    expect(expired.querySelector('.acct-meter')).toHaveAttribute('data-band', 'crit');
    expect(fills(live).map((f) => f.classList.contains('limit-fill--off'))).toEqual([false, false]);
    expect(fills(live)[0]).toHaveClass('limit-fill--crit');
  });
});

// ── the fold (desktop polish S5b, D-6530): four lanes on a phone, one measured line at the desk, "+n more" ──
// jsdom lays nothing out and applies no media query, so a phone is the default `matchMedia` (nothing matches) and a
// desk is a stub for `(min-width: 900px)` plus a `ResizeObserver` that answers one content width at once.
describe('the lanes fold (S5b, D-6530)', () => {
  const WORDS = '+13 more · 1 sign-in expired · 1 rate-limited';
  const SHOWN = ['lane-a', 'lane-f', 'lane-with-a-very-long-name-q', 'lane-e'];
  const cardsOf = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.account-gauge')];
  const nameOf = (card: HTMLElement): string => card.querySelector('.account-gauge-label')?.textContent ?? '';
  const stubLanes = (accounts: AccountUsage[], roster = seventeenLanes(nowSec).roster): void => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts, projected: { wrapper: 'w0', score: 0 }, roster });
  };
  const stubSeventeen = (): void => stubLanes(seventeenLanes(nowSec).accounts);
  /** A desk whose cards' group measures `width` px of content (jsdom has no stylesheet, so its column-gap is not a number
   *  unless `gap` gives the group one, in px, as the lanes row's stylesheet does). */
  const stubDesk = (width: number, gap: number | null = null): void => {
    if (gap !== null) {
      const real = window.getComputedStyle.bind(window);
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => (
        el.classList.contains('accounts-strip') ? ({ columnGap: `${gap}px` } as CSSStyleDeclaration) : real(el, pseudo)));
    }
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('min-width: 900px'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    vi.stubGlobal('ResizeObserver', class {
      private readonly cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(target: Element): void {
        this.cb([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    });
  };
  const control = (name: string | RegExp = /more|Show fewer/): HTMLElement => screen.getByRole('button', { name });
  const stops = (container: HTMLElement): string[] => cardsOf(container).filter((c) => c.tabIndex === 0).map(nameOf);

  it('the folded strip mounts only the shown cards', async () => {
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    // Counted in the DOM, rendered or not: a hidden card must not be mounted and hidden by CSS.
    expect(container.querySelectorAll('.account-gauge')).toHaveLength(4);
    expect(cardsOf(container).map(nameOf)).toEqual(SHOWN);
  });

  it('the control sits in the end cell, after the last shown card and before All accounts, and follows the cards\' one tab stop in tab order', async () => {
    stubSeventeen();
    const user = userEvent.setup();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const more = control(WORDS);
    const all = screen.getByRole('button', { name: 'All accounts' });
    const end = more.closest('.accounts-end')!;
    expect(end).not.toBeNull();
    expect(all.closest('.accounts-end')).toBe(end);
    expect(end.parentElement).toBe(container.querySelector('.accounts-strip'));
    expect([...end.children]).toEqual([more, all]);
    expect(cardsOf(container).at(-1)!.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(cardsOf(container)[0]);
    await user.tab();
    expect(document.activeElement).toBe(more);
    await user.tab();
    expect(document.activeElement).toBe(all);
  });

  it('each shown card stays its lane\'s open-lane door: a tap and Enter open /accounts?lane=<id>', async () => {
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    for (const card of cardsOf(container)) {
      expect(card).toHaveAttribute('role', 'link');
      expect(card).toHaveAttribute('data-action', 'open-lane');
    }
    fireEvent.click(cardsOf(container).find((c) => nameOf(c) === 'lane-f')!);
    expect(location.pathname + location.search).toBe('/accounts?lane=w5');
    navigate('/');
    fireEvent.keyDown(cardsOf(container).find((c) => nameOf(c) === 'lane-e')!, { key: 'Enter' });
    expect(location.pathname + location.search).toBe('/accounts?lane=w4');
  });

  it('the arrow keys move across the shown cards only, and a stop on a card that folds away goes to the first shown card', async () => {
    stubSeventeen();
    const user = userEvent.setup();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    await user.tab();
    await user.keyboard('{End}');
    expect(nameOf(document.activeElement as HTMLElement)).toBe('lane-e');
    await user.keyboard('{ArrowRight}');          // the fifth lane is folded away: End and the arrow stop at the fourth card
    expect(nameOf(document.activeElement as HTMLElement)).toBe('lane-e');
    // Expanded, the stop can sit on the last lane; folding again takes the stop to the first shown card.
    fireEvent.click(control());
    expect(cardsOf(container)).toHaveLength(17);
    act(() => { cardsOf(container).find((c) => nameOf(c) === 'lane-q')!.focus(); });
    expect(stops(container)).toEqual(['lane-q']);
    fireEvent.click(control('Show fewer'));
    expect(cardsOf(container)).toHaveLength(4);
    expect(stops(container)).toEqual(['lane-a']);
  });

  it('at the desk the row folds to the measured fit: three cards at 1248 px, then the end cell with the control and All accounts', async () => {
    stubDesk(1248);
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    // The control, not the first card: lane-a is on the page unfolded too, and the fold takes two more renders (the
    // ref callback's state, then the observer effect's measure), which under load a bare card wait does not outlast.
    await screen.findByRole('button', { name: /more/ });
    const group = container.querySelector('.accounts-strip')!;
    expect(cardsOf(container).map(nameOf)).toEqual(SHOWN.slice(0, 3));
    expect([...group.children].map((c) => c.className)).toEqual(['account-gauge', 'account-gauge', 'account-gauge', 'accounts-end']);
    const end = group.querySelector('.accounts-end')!;
    // 17 lanes less 3 shown.
    expect([...end.children]).toEqual([control('+14 more · 1 sign-in expired · 1 rate-limited'), screen.getByRole('button', { name: 'All accounts' })]);
    expect(group.getAttribute('style')).toContain(`--lane-card-min: ${LANE_CARD_MIN}px`);
  });

  it("the desk's fit counts the column gap the group computes: 1050 px with an 8 px gap holds three tracks, so two cards (a gap read as 0 would hold four, and show three)", async () => {
    stubDesk(1050, 8);
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByRole('button', { name: /more/ });
    expect(cardsOf(container).map(nameOf)).toEqual(SHOWN.slice(0, 2));
    expect(control()).toHaveTextContent(/^\+15 more/);
  });

  it('an unmeasured desk row folds nothing: every lane and no control', async () => {
    stubDesk(0);
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    expect(cardsOf(container)).toHaveLength(17);
    expect(screen.queryByRole('button', { name: /more|Show fewer/ })).toBeNull();
  });

  it('the desk row\'s observer is disconnected when the strip unmounts', async () => {
    stubDesk(1248);
    // The stub's own class, wrapped so every instance's `disconnect` is counted.
    const Stub = globalThis.ResizeObserver;
    const made: { disconnected: number }[] = [];
    vi.stubGlobal('ResizeObserver', class extends Stub {
      private readonly seen = { disconnected: 0 };
      constructor(cb: ResizeObserverCallback) { super(cb); made.push(this.seen); }
      override disconnect(): void { this.seen.disconnected += 1; super.disconnect(); }
    });
    stubSeventeen();
    const { unmount } = render(<AccountsStrip />);
    await screen.findByRole('button', { name: /more/ });
    expect(made.length).toBeGreaterThan(0);
    unmount();
    // Every observer made has been let go: none is left watching a detached group.
    expect(made.every((o) => o.disconnected >= 1)).toBe(true);
  });

  it('folded, the group\'s name names the fullest lane, which is hidden', async () => {
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    // lane-q (w16, at its 5h limit) is the fullest, and sorts last: it is not among the four cards.
    expect(screen.getByRole('group', { name: /^account usage, highest lane-q 100%/ })).toBeInTheDocument();
    expect(cardsOf(container).map(nameOf)).not.toContain('lane-q');
  });

  it('a tap on the control folds and unfolds and never navigates, and the control carries no data-command and no data-action', async () => {
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const more = control(WORDS);
    expect(more).not.toHaveAttribute('data-command');
    expect(more).not.toHaveAttribute('data-action');
    fireEvent.click(more);
    expect(cardsOf(container)).toHaveLength(17);
    expect(more).toHaveTextContent('Show fewer');
    fireEvent.click(more);
    expect(cardsOf(container)).toHaveLength(4);
    expect(more).toHaveTextContent(WORDS);
    expect(location.pathname).toBe('/');
    expect(more).not.toHaveAttribute('data-command');
    expect(more).not.toHaveAttribute('data-action');
  });

  it('the control\'s name is its words (no aria-label), with aria-expanded and aria-controls naming the cards\' element', async () => {
    stubSeventeen();
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const more = control(WORDS);
    expect(more).not.toHaveAttribute('aria-label');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const group = container.querySelector('.accounts-strip')!;
    expect(group.id).not.toBe('');
    expect(more).toHaveAttribute('aria-controls', group.id);
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveAccessibleName('Show fewer');
    expect(more).toHaveAttribute('aria-controls', group.id);
  });

  it('focus stays on the control across Show fewer and +n more', async () => {
    stubSeventeen();
    render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const more = control(WORDS);
    act(() => more.focus());
    fireEvent.click(more);
    expect(document.activeElement).toBe(more);
    expect(more).toHaveTextContent('Show fewer');
    fireEvent.click(more);
    expect(document.activeElement).toBe(more);
    expect(more).toHaveTextContent(/^\+13 more/);
  });

  it('Show fewer scrolls the control into view with block nearest; mounting expanded or folded scrolls nothing', async () => {
    stubSeventeen();
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<AccountsStrip />);
    await screen.findByText('lane-a');
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(control());                   // +n more: no scroll
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(control('Show fewer'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(spy.mock.contexts[0]).toBe(control());
    cleanup();
    spy.mockClear();
    window.localStorage.setItem('ccrc-accounts-strip', 'expanded');
    render(<AccountsStrip />);
    await screen.findByText('lane-a');
    await screen.findByText('Show fewer');
    expect(spy).not.toHaveBeenCalled();
  });

  it("another tab's choice to fold, arriving after the load, scrolls nothing: only this page's own Show fewer does", async () => {
    stubSeventeen();
    window.localStorage.setItem('ccrc-accounts-strip', 'expanded');
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<AccountsStrip />);
    await screen.findByText('lane-a');
    await screen.findByText('Show fewer');
    expect(spy).not.toHaveBeenCalled();
    // The other tab folds the strip: its write reaches this page as a storage event for the key the hook listens on.
    act(() => {
      window.localStorage.setItem('ccrc-accounts-strip', 'folded');
      window.dispatchEvent(new StorageEvent('storage', { key: 'ccrc-accounts-strip', newValue: 'folded' }));
    });
    expect(control()).toHaveTextContent(/^\+13 more/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('five lanes, folded or expanded: every card and no control', async () => {
    stubLanes(seventeenLanes(nowSec).accounts.slice(0, 5));
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    expect(cardsOf(container)).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /more|Show fewer/ })).toBeNull();
    cleanup();
    window.localStorage.setItem('ccrc-accounts-strip', 'expanded');
    const again = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    expect(cardsOf(again.container)).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /more|Show fewer/ })).toBeNull();
  });

  it('five lanes render no fold control at all, folded or expanded: the only button in the strip is All accounts', async () => {
    stubLanes(seventeenLanes(nowSec).accounts.slice(0, 5));
    for (const stored of ['folded', 'expanded']) {
      window.localStorage.setItem('ccrc-accounts-strip', stored);
      const { container, unmount } = render(<AccountsStrip />);
      await screen.findByText('lane-a');
      // Every button, by element and not by name: a control with no words has no accessible name, so a query by name
      // cannot see a nameless one.
      const buttons = [...container.querySelectorAll<HTMLElement>('button, [role="button"]')];
      expect(buttons.map((b) => b.textContent), stored).toEqual(['All accounts']);
      expect(container.querySelectorAll('[aria-expanded], [aria-controls]'), stored).toHaveLength(0);
      expect(container.querySelector('.accounts-end')!.children, stored).toHaveLength(1);
      unmount();
    }
  });

  it('no control in the placeholder states', async () => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    render(<AccountsStrip />);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    stubLanes([]);
    render(<AccountsStrip />);
    await screen.findByText(/no accounts reporting/);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    stubLanes([acct({ wrapper: 'lane-a', disabled: true })]);
    render(<AccountsStrip />);
    await screen.findByText(/all lanes disabled/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  // ── the desk's hover and focus flyout (R120, strip-hover-flyout) ──
  // The folded desk line opens a panel under it holding every lane. The delays are fake timers; the strip is rendered
  // and its poll read under real ones, since `findBy` polls with timers a fake clock would starve.
  describe('the flyout (strip-hover-flyout)', () => {
    afterEach(() => { vi.useRealTimers(); });
    const flyoutOf = (container: HTMLElement): HTMLElement | null => container.querySelector<HTMLElement>('.accounts-flyout');
    const groupOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('.accounts-strip')!;
    const flyCardsOf = (container: HTMLElement): HTMLElement[] => [...(flyoutOf(container)?.querySelectorAll<HTMLElement>('.account-gauge') ?? [])];
    const lineCardsOf = (container: HTMLElement): HTMLElement[] => [...groupOf(container).children].filter((c): c is HTMLElement => c.classList.contains('account-gauge'));
    const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
    /** A folded desk strip, mounted and read, with the fake clock installed after the poll landed. */
    const mountDesk = async (): Promise<HTMLElement> => {
      stubDesk(1248);
      stubSeventeen();
      const { container } = render(<AccountsStrip />);
      await screen.findByText('lane-a');
      // The poll lands before the row is measured: wait for the fold, whose control is the sign of it.
      await waitFor(() => expect(control()).toBeInTheDocument());
      vi.useFakeTimers();
      return container;
    };
    const openByHover = async (): Promise<HTMLElement> => {
      const container = await mountDesk();
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
      return container;
    };
    const names = seventeenLanes(nowSec);
    const labelOf = (id: string): string => names.roster.find((r) => r.id === id)!.label;

    it('at the desk, folded, hovering the line opens the flyout after FLYOUT_OPEN_MS, holding every lane in lanesByFree\'s order', async () => {
      const container = await mountDesk();
      expect(flyoutOf(container)).toBeNull();
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS - 1);
      expect(flyoutOf(container)).toBeNull();
      advance(1);
      const fly = flyoutOf(container)!;
      expect(fly).not.toBeNull();
      expect(flyCardsOf(container).map(nameOf)).toEqual(lanesByFree(names.accounts).map((a) => labelOf(a.wrapper)));
      expect(flyCardsOf(container)).toHaveLength(17);
      // In the strip's group, after the line's cards and before the end cell.
      expect([...groupOf(container).children].map((c) => c.className)).toEqual(
        ['account-gauge', 'account-gauge', 'account-gauge', 'accounts-flyout', 'accounts-end']);
      expect(fly).toHaveAttribute('role', 'group');
      // Named for what it holds, and not as the line is: a screen reader never meets two groups of one name.
      expect(fly.getAttribute('aria-label')).toBe(FLYOUT_LABEL);
      expect(fly.getAttribute('aria-label')).not.toBe(groupOf(container).getAttribute('aria-label'));
      // Not a dialog, and it took no focus.
      expect(fly).not.toHaveAttribute('aria-modal');
      expect(fly.contains(document.activeElement)).toBe(false);
    });

    it('focus moving into the line opens the flyout', async () => {
      const container = await mountDesk();
      act(() => { lineCardsOf(container)[0]!.focus(); });
      expect(flyoutOf(container)).toBeNull();
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
      expect(flyCardsOf(container)).toHaveLength(17);
    });

    it('a pointer passing by does not open it', async () => {
      const container = await mountDesk();
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS - 1);
      expect(flyoutOf(container)).toBeNull();
      fireEvent.pointerLeave(groupOf(container));
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
    });

    it('leaving the line and the flyout closes it after FLYOUT_CLOSE_MS; coming back within the grace keeps it', async () => {
      const container = await openByHover();
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      fireEvent.pointerEnter(groupOf(container));
      advance(5000);
      expect(flyoutOf(container)).not.toBeNull();
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      advance(1);
      expect(flyoutOf(container)).toBeNull();
    });

    it('Escape closes it and returns focus to the card it came from', async () => {
      const container = await openByHover();
      const fromLine = lineCardsOf(container)[0]!;
      const card = flyCardsOf(container)[9]!;
      act(() => { card.focus(); });
      expect(document.activeElement).toBe(card);
      fireEvent.keyDown(card, { key: 'Escape' });
      expect(flyoutOf(container)).toBeNull();                 // at once, no grace
      expect(document.activeElement).toBe(fromLine);
      // The focus it gave back does not open it again, and it stays shut under the grace and the delay alike.
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
      // Escape with focus on a line card closes it too, and leaves focus there.
      act(() => { fromLine.blur(); });
      act(() => { fromLine.focus(); });
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
      fireEvent.keyDown(fromLine, { key: 'Escape' });
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(fromLine);
    });

    it('an Escape that closes it is handled there: the key press is default-prevented, so the desk\'s Escape interrupt skips it', async () => {
      const container = await openByHover();
      const card = flyCardsOf(container)[0]!;
      act(() => { card.focus(); });
      // `fireEvent` answers false when a listener prevented the default; the desk's `useEscapeInterrupt` stands down on that.
      expect(fireEvent.keyDown(card, { key: 'Escape' })).toBe(false);
      expect(flyoutOf(container)).toBeNull();
      // With no flyout to close an Escape is not this strip's, and passes on.
      expect(fireEvent.keyDown(lineCardsOf(container)[0]!, { key: 'Escape' })).toBe(true);
    });

    it('an Escape while the open is still pending cancels the open', async () => {
      const container = await mountDesk();
      act(() => { lineCardsOf(container)[0]!.focus(); });
      advance(FLYOUT_OPEN_MS - 1);
      expect(fireEvent.keyDown(lineCardsOf(container)[0]!, { key: 'Escape' })).toBe(false);
      advance(FLYOUT_OPEN_MS * 4);
      expect(flyoutOf(container)).toBeNull();
    });

    it('Escape stays shut for a keyboard user: an arrow move between the line\'s cards does not open it again', async () => {
      const container = await mountDesk();
      const first = lineCardsOf(container)[0]!;
      act(() => { first.focus(); });
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
      fireEvent.keyDown(first, { key: 'Escape' });
      expect(flyoutOf(container)).toBeNull();
      fireEvent.keyDown(first, { key: 'ArrowRight' });         // focus moves to the next card, inside the strip
      expect(document.activeElement).toBe(lineCardsOf(container)[1]);
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
      // Focus arriving from outside the strip is still an opening.
      act(() => { lineCardsOf(container)[1]!.blur(); });
      act(() => { lineCardsOf(container)[1]!.focus(); });
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
    });

    it('focus leaving the strip closes it, and focus moving between the line and the flyout does not', async () => {
      const container = await mountDesk();
      const fromLine = lineCardsOf(container)[0]!;
      act(() => { fromLine.focus(); });
      advance(FLYOUT_OPEN_MS);
      const inside = flyCardsOf(container)[4]!;
      // A focusout whose destination is inside the strip is a move, not a leave.
      fireEvent.focusOut(fromLine, { relatedTarget: inside });
      advance(5000);
      expect(flyoutOf(container)).not.toBeNull();
      act(() => { fromLine.blur(); });                         // out of the document: no destination
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      advance(1);
      expect(flyoutOf(container)).toBeNull();
    });

    it('it stays open while either the pointer or focus is inside the line or the flyout, and closes when neither is', async () => {
      const container = await openByHover();
      const card = lineCardsOf(container)[1]!;
      act(() => { card.focus(); });
      act(() => { card.blur(); });
      advance(5000);
      expect(flyoutOf(container)).not.toBeNull();             // focus left, the pointer is still on the strip
      // Focus inside, the pointer leaves: a card of the line, then a card of the flyout. Nothing is scheduled.
      for (const inside of [lineCardsOf(container)[0]!, flyCardsOf(container)[5]!]) {
        act(() => { inside.focus(); });
        fireEvent.pointerLeave(groupOf(container));
        advance(5000);
        expect(flyoutOf(container)).not.toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        // The pointer coming back changes nothing either.
        fireEvent.pointerEnter(groupOf(container));
        advance(5000);
        expect(flyoutOf(container)).not.toBeNull();
        fireEvent.pointerLeave(groupOf(container));
      }
      // Neither: focus leaves with the pointer outside, and the grace runs.
      act(() => { (document.activeElement as HTMLElement).blur(); });
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      advance(1);
      expect(flyoutOf(container)).toBeNull();
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
    });

    it('a pointer passing over the strip while the open delay that focus started is pending does not cancel the open', async () => {
      const container = await mountDesk();
      act(() => { lineCardsOf(container)[0]!.focus(); });
      advance(FLYOUT_OPEN_MS - 50);
      expect(flyoutOf(container)).toBeNull();
      fireEvent.pointerEnter(groupOf(container));
      fireEvent.pointerLeave(groupOf(container));
      advance(50);
      expect(flyoutOf(container)).not.toBeNull();
    });

    it('the flyout\'s cards are one tab stop, and the arrow keys, Home and End step across all of them without wrapping', async () => {
      const container = await openByHover();
      const cards = (): HTMLElement[] => flyCardsOf(container);
      expect(cards().filter((c) => c.tabIndex === 0).map(nameOf)).toEqual([nameOf(cards()[0]!)]);
      expect(cards().filter((c) => c.tabIndex === -1)).toHaveLength(16);
      act(() => { cards()[0]!.focus(); });
      fireEvent.keyDown(cards()[0]!, { key: 'ArrowLeft' });    // no wrap at the start
      expect(document.activeElement).toBe(cards()[0]);
      fireEvent.keyDown(cards()[0]!, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(cards()[1]);
      fireEvent.keyDown(cards()[1]!, { key: 'End' });
      expect(document.activeElement).toBe(cards()[16]);
      fireEvent.keyDown(cards()[16]!, { key: 'ArrowDown' });   // no wrap at the end
      expect(document.activeElement).toBe(cards()[16]);
      expect(cards().filter((c) => c.tabIndex === 0)).toEqual([cards()[16]]);
      fireEvent.keyDown(cards()[16]!, { key: 'Home' });
      expect(document.activeElement).toBe(cards()[0]);
    });

    it('the tab order is the line\'s stop, the flyout\'s stop, the control, then All accounts', async () => {
      const container = await openByHover();
      const tabbable = [...container.querySelectorAll<HTMLElement>('[tabindex="0"], button')].filter((e) => e.tabIndex >= 0);
      expect(tabbable.map((e) => e.className.includes('account-gauge') ? `${flyoutOf(container)!.contains(e) ? 'fly' : 'line'}:${nameOf(e)}` : e.textContent))
        .toEqual(['line:lane-a', `fly:${nameOf(flyCardsOf(container)[0]!)}`, '+14 more · 1 sign-in expired · 1 rate-limited', 'All accounts']);
    });

    it('each flyout card is its lane\'s open-lane door: a tap and Enter open /accounts?lane=<id>', async () => {
      const container = await openByHover();
      for (const card of flyCardsOf(container)) {
        expect(card).toHaveAttribute('role', 'link');
        expect(card).toHaveAttribute('data-action', 'open-lane');
        expect(card).not.toHaveAttribute('data-command');
      }
      const order = lanesByFree(names.accounts).map((a) => a.wrapper);
      fireEvent.click(flyCardsOf(container)[12]!);
      expect(location.pathname + location.search).toBe(`/accounts?lane=${order[12]}`);
      navigate('/');
      fireEvent.keyDown(flyCardsOf(container)[3]!, { key: 'Enter' });
      expect(location.pathname + location.search).toBe(`/accounts?lane=${order[3]}`);
    });

    it('no flyout while expanded, and none below 900', async () => {
      const container = await mountDesk();
      // Expanded: the control pins the strip open, and the open flyout goes with it.
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
      fireEvent.click(control());
      expect(flyoutOf(container)).toBeNull();
      expect(cardsOf(container)).toHaveLength(17);
      fireEvent.pointerLeave(groupOf(container));
      fireEvent.pointerEnter(groupOf(container));
      act(() => { lineCardsOf(container)[0]!.focus(); });
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
      // Folded again under the pointer: the pointer entered while expanded, so nothing re-opens until it comes back.
      fireEvent.click(control('Show fewer'));
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
      cleanup();
      // A phone has no hover: nothing mounts at any width below the desk's.
      vi.useRealTimers();
      vi.unstubAllGlobals();
      stubSeventeen();
      const phone = render(<AccountsStrip />);
      await screen.findByText('lane-a');
      vi.useFakeTimers();
      fireEvent.pointerEnter(groupOf(phone.container));
      act(() => { lineCardsOf(phone.container)[0]!.focus(); });
      advance(5000);
      expect(flyoutOf(phone.container)).toBeNull();
    });

    it("a flyout made moot while a card of it holds focus hands the focus to the line's tab stop, never to the page: another tab expands the strip", async () => {
      const container = await openByHover();
      const stopCard = lineCardsOf(container)[0]!;
      const held = flyCardsOf(container)[5]!;
      act(() => { held.focus(); });
      expect(document.activeElement).toBe(held);
      // The other tab expands the strip: its write reaches this page as a storage event, and the flyout goes with it.
      act(() => {
        window.localStorage.setItem('ccrc-accounts-strip', 'expanded');
        window.dispatchEvent(new StorageEvent('storage', { key: 'ccrc-accounts-strip', newValue: 'expanded' }));
      });
      expect(flyoutOf(container)).toBeNull();
      expect(cardsOf(container)).toHaveLength(17);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(stopCard);
      // The hand-back is a move inside the strip, not an arrival: nothing opens (there is no flyout while expanded).
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
    });

    // ── fix round 2 (review 1106): only KEYBOARD focus holds the flyout, and who started an open decides what a pointer does ──
    // jsdom's `:focus-visible` (its selector engine's) follows a heuristic over the last key event and the focus history, so
    // whether a script `focus()` matches it depends on the order of the calls before it: a first focus from the page does,
    // a move from one card to another with no key event often does not. These cases need the plain rule instead: keyboard
    // focus unless a click gave it. So `beforeEach` makes `matches(':focus-visible')` answer as `:focus` does, and false
    // for an element a case has focused as a click (`clickFocus`: a pointer-down, a mouse-down, a focus), as Chrome does;
    // every other focus in this file is keyboard focus. The browser leg proves the shape in real Chrome (lanes-row, "a
    // click's focus never holds the flyout …").
    const mouseFocused = new WeakSet<Element>();
    beforeEach(() => {
      const real = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string): boolean {
        if (!selector.includes(':focus-visible')) return real.call(this, selector);
        return !mouseFocused.has(this) && real.call(this, selector.replace(':focus-visible', ':focus'));
      });
    });
    const clickFocus = (el: HTMLElement): void => {
      fireEvent.pointerDown(el);
      fireEvent.mouseDown(el);
      mouseFocused.add(el);
      act(() => { el.focus(); });
    };
    const strays: HTMLElement[] = [];
    afterEach(() => { for (const el of strays.splice(0)) el.remove(); });
    /** A field outside the strip, in the document. */
    const outsideField = (): HTMLInputElement => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      strays.push(input);
      return input;
    };
    const allAccounts = (): HTMLElement => screen.getByRole('button', { name: 'All accounts' });

    it("focus a click leaves behind never holds the flyout: hover-open, click a card, the pointer leaves, and it closes after FLYOUT_CLOSE_MS", async () => {
      const container = await openByHover();
      clickFocus(lineCardsOf(container)[0]!);
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      advance(1);
      expect(flyoutOf(container)).toBeNull();
    });

    it('nor does the end cell: hover-open, click All accounts, the pointer leaves, and it closes after FLYOUT_CLOSE_MS', async () => {
      const container = await openByHover();
      clickFocus(allAccounts());
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      advance(1);
      expect(flyoutOf(container)).toBeNull();
    });

    it('keyboard focus in the end cell holds nothing either', async () => {
      const container = await openByHover();
      act(() => { allAccounts().focus(); });
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
    });

    it('keyboard focus moving from a card of the flyout to the end cell, with the pointer outside, starts the grace', async () => {
      const container = await openByHover();
      act(() => { flyCardsOf(container)[3]!.focus(); });
      fireEvent.pointerLeave(groupOf(container));
      advance(5000);
      expect(flyoutOf(container)).not.toBeNull();             // keyboard focus on a card holds it
      act(() => { allAccounts().focus(); });                  // Tab to All accounts: the card no longer holds it
      advance(FLYOUT_CLOSE_MS - 1);
      expect(flyoutOf(container)).not.toBeNull();
      advance(1);
      expect(flyoutOf(container)).toBeNull();
    });

    it('focus arriving at the end cell from outside the strip opens nothing', async () => {
      const container = await mountDesk();
      act(() => { allAccounts().focus(); });
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
    });

    it("an open the pointer started is cancelled when the pointer leaves, whatever focus is parked in the strip: after Escape the flyout stays shut", async () => {
      const container = await openByHover();
      const fromLine = lineCardsOf(container)[0]!;
      act(() => { flyCardsOf(container)[9]!.focus(); });
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(fromLine);          // parked on the line card Escape handed it to, by keyboard
      // A pointer passes: it enters and leaves before the open delay runs out.
      fireEvent.pointerLeave(groupOf(container));
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS - 50);
      fireEvent.pointerLeave(groupOf(container));
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
      // A pointer that stays still opens it: the pointer enters again.
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
    });

    it('keyboard focus arriving while the pointer\'s open delay is pending takes the open over: a pointer then leaving does not cancel it', async () => {
      const container = await mountDesk();
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS - 50);
      act(() => { lineCardsOf(container)[0]!.focus(); });
      fireEvent.pointerLeave(groupOf(container));
      advance(50);
      expect(flyoutOf(container)).not.toBeNull();
    });

    it("a poll that drops the lane of the flyout card holding focus leaves no stale hold: a field focused elsewhere keeps its focus when the flyout closes", async () => {
      // The poll's interval must run on the fake clock, so this case installs it before the strip mounts (`mountDesk` does it after).
      stubDesk(1248);
      stubSeventeen();
      vi.useFakeTimers();
      const { container } = render(<AccountsStrip />);
      await act(async () => { await Promise.resolve(); });
      expect(control()).toBeInTheDocument();
      fireEvent.pointerEnter(groupOf(container));
      advance(FLYOUT_OPEN_MS);
      expect(flyoutOf(container)).not.toBeNull();
      const dropped = lanesByFree(names.accounts)[5]!.wrapper;
      const card = flyCardsOf(container)[5]!;
      act(() => { card.focus(); });
      // The next poll answers without that lane: its card leaves the DOM while it holds focus, and no blur is fired.
      stubLanes(names.accounts.filter((a) => a.wrapper !== dropped));
      await act(async () => { vi.advanceTimersByTime(20_000); });
      expect(card.isConnected).toBe(false);
      expect(flyCardsOf(container)).toHaveLength(16);
      expect(document.activeElement).toBe(document.body);
      const field = outsideField();
      act(() => { field.focus(); });
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(field);
    });

    it('a window that loses focus while a flyout card holds it: the close hands nothing back, and throws nothing', async () => {
      const container = await openByHover();
      const card = flyCardsOf(container)[5]!;
      act(() => { card.focus(); });
      fireEvent.pointerLeave(groupOf(container));
      advance(5000);
      expect(flyoutOf(container)).not.toBeNull();             // keyboard focus holds it
      // The window blurs: the card keeps `document.activeElement`, and its focusout carries no destination.
      expect(() => { fireEvent.focusOut(card, { relatedTarget: null }); }).not.toThrow();
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
      expect(lineCardsOf(container)).not.toContain(document.activeElement);
      expect(document.activeElement).toBe(document.body);
    });

    it('a window that loses focus, then a field outside the strip taking it: the close leaves the field its focus', async () => {
      const container = await openByHover();
      const card = flyCardsOf(container)[5]!;
      act(() => { card.focus(); });
      fireEvent.pointerLeave(groupOf(container));
      fireEvent.focusOut(card, { relatedTarget: null });
      const field = outsideField();
      act(() => { field.focus(); });
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(field);
    });

    it('focus outside the strip stays put when the pointer leaves and the grace runs', async () => {
      const container = await openByHover();
      const field = outsideField();
      act(() => { field.focus(); });
      expect(document.activeElement).toBe(field);
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(field);
    });

    it('a hover-only flyout hands no focus to the line when it closes: nothing held it, so nothing is handed back', async () => {
      const container = await openByHover();
      expect(document.activeElement).toBe(document.body);
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });

    it('focus that left the flyout is not handed back: a card focused then blurred, the close finds focus on the page and leaves it there', async () => {
      const container = await openByHover();
      const card = flyCardsOf(container)[2]!;
      act(() => { card.focus(); });
      act(() => { card.blur(); });                            // the flyout's blur says it no longer holds focus
      fireEvent.pointerLeave(groupOf(container));
      advance(FLYOUT_CLOSE_MS);
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });

    it('Escape with focus on All accounts, which a flyout card left, closes the flyout and leaves the focus there', async () => {
      const container = await openByHover();
      act(() => { flyCardsOf(container)[2]!.focus(); });
      const end = allAccounts();
      act(() => { end.focus(); });
      fireEvent.keyDown(end, { key: 'Escape' });
      expect(flyoutOf(container)).toBeNull();
      expect(document.activeElement).toBe(end);
    });

    it('unmounting with the open delay pending, or the close grace pending, leaves no timer behind', async () => {
      for (const pending of ['open', 'close']) {
        const container = await mountDesk();
        const idle = vi.getTimerCount();
        fireEvent.pointerEnter(groupOf(container));
        expect(vi.getTimerCount(), `${pending}: the open delay is pending`).toBe(idle + 1);
        if (pending === 'close') {
          advance(FLYOUT_OPEN_MS);
          expect(flyoutOf(container)).not.toBeNull();
          fireEvent.pointerLeave(groupOf(container));
          expect(vi.getTimerCount(), `${pending}: the close grace is pending`).toBe(idle + 1);
        }
        cleanup();
        expect(vi.getTimerCount(), `${pending}: no timer outlives the strip`).toBe(idle);
        vi.useRealTimers();
      }
    });

    it('no flyout when nothing is folded away', async () => {
      stubDesk(1248);
      stubLanes(seventeenLanes(nowSec).accounts.slice(0, 3));    // three lanes fit the line with the end cell
      const { container } = render(<AccountsStrip />);
      await screen.findByText('lane-a');
      vi.useFakeTimers();
      expect(screen.queryByRole('button', { name: /more|Show fewer/ })).toBeNull();
      fireEvent.pointerEnter(groupOf(container));
      act(() => { lineCardsOf(container)[0]!.focus(); });
      advance(5000);
      expect(flyoutOf(container)).toBeNull();
    });
  });

  // The two source scans read the component's CODE, comments out, so its own header may name what it must not do.
  const stripSrc = (): string => readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'AccountsStrip.tsx'), 'utf8');
  // Whole-line comments first: one of them names `~/.cc-limits/*.json`, whose `/*` is no block comment's start.
  const codeOf = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the control renders from foldLanes alone: the component imports foldLanes and foldWords, no FOLD_SHOWN, and compares no lane count', () => {
    const code = codeOf(stripSrc());
    expect(code).toMatch(/import \{[^}]*\bfoldLanes\b[^}]*\} from '\.\/stripFold'/);
    expect(code).toMatch(/import \{[^}]*\bfoldWords\b[^}]*\} from '\.\/stripFold'/);
    expect(code).not.toContain('FOLD_SHOWN');
    expect(code).not.toMatch(/\.length\s*(>=?|<=?)/);
  });

  it('the control\'s words are foldWords\': the component builds no sentence of its own', () => {
    const src = parseTs(path.join(import.meta.dirname, '..', 'src', 'fleet', 'AccountsStrip.tsx'));
    const literals: string[] = [];
    const visit = (n: ts.Node): void => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) && !isSpecifier(n)) literals.push(n.text);
      if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) literals.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(src);
    expect(literals.filter((l) => /more|Show fewer|sign-in expired|rate-limited/.test(l))).toEqual([]);
    expect(codeOf(stripSrc())).toMatch(/foldWords\(/);
  });

  it('the flyout\'s cards render through the line\'s own card code: one card markup in the component', () => {
    const code = codeOf(stripSrc());
    expect(code.match(/className="account-gauge"/g)).toHaveLength(1);
    // The flyout is one element of its own, and its cards are the same function's output as the line's.
    expect(code.match(/className="accounts-flyout"/g)).toHaveLength(1);
  });
});
