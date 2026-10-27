import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ts from 'typescript';
import type { AccountUsage } from '../../shared/api';
import { CommandLayer } from '../src/command/CommandLayer';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { ACCOUNTS_DOOR_LABEL } from '../src/fleet/laneWords';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { declValue, ruleIn } from './cssRule';
import { isSpecifier, parseTs } from './literalWalker';
import { TEST_ROSTER } from './rosterFixture';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const nowSec = Math.floor(Date.now() / 1000);

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: nowSec - 3600,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

/** Puts an accounts answer in the fleet store, where the strip reads it: the store is the one `/api/accounts` reader
 *  and the strip runs no poll (C8, D-6440). `act`, because a case may call it after the strip is mounted. */
const stubAccounts = (accounts: AccountUsage[]): void => {
  act(() => { useFleetStore.setState({ usage: accounts, roster: TEST_ROSTER }); });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  useFleetStore.setState({ usage: null, roster: [] });
});

describe('AccountsStrip', () => {
  it('a rolled-over window reads 0% with its countdown', async () => {
    // Both fixtures are states the server can actually emit: readLimits sets
    // fiveRolledOver only when fiveResetAt is non-null and has passed (and then
    // forces five to 0), so an inferred zero always comes with a past reset
    // stamp and a measured one with a window still running. Without the stamps
    // this test would assert on data no server could produce.
    stubAccounts([
      acct({ wrapper: 'claude', five: 0, fiveResetAt: nowSec - 60, fiveRolledOver: true, seven: 57, sevenRolledOver: false }),
      acct({ wrapper: 'claude9', five: 0, fiveResetAt: nowSec + 9000, fiveRolledOver: false, seven: 93, sevenRolledOver: false }),
    ]);
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
    stubAccounts([acct({ wrapper: 'claude', five: 40, fiveResetAt: nowSec + 9000, fiveRolledOver: false, seven: 57, sevenRolledOver: false })]);
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
    const first = [acct({ wrapper: 'lane-a', five: 10 }), acct({ wrapper: 'lane-b', five: 20 }), acct({ wrapper: 'lane-c', five: 30 })];
    stubAccounts(first);
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const stops = (): string[] => cardsOf(container).filter((c) => c.tabIndex === 0).map(nameOf);
    const byName = (n: string): HTMLElement => cardsOf(container).find((c) => nameOf(c) === n)!;
    act(() => { byName('lane-a').focus(); });
    fireEvent.keyDown(byName('lane-a'), { key: 'ArrowRight' });   // lane-b holds the stop
    expect(stops()).toEqual(['lane-b']);
    // lane-b becomes the fullest on the next poll: it moves to the end, and the stop stays on it.
    stubAccounts([first[0]!, acct({ wrapper: 'lane-b', five: 90 }), first[2]!]);
    expect(cardsOf(container).map(nameOf)).toEqual(['lane-a', 'lane-c', 'lane-b']);
    expect(stops()).toEqual(['lane-b']);
    // lane-b leaves: the stop falls to the first card.
    stubAccounts([first[0]!, first[2]!]);
    expect(cardsOf(container).map(nameOf)).toEqual(['lane-a', 'lane-c']);
    expect(stops()).toEqual(['lane-a']);
  });

  it('focus stays on the same lane\'s card through a re-sort, not only its tab stop', async () => {
    const first = [acct({ wrapper: 'lane-a', five: 10 }), acct({ wrapper: 'lane-b', five: 20 }), acct({ wrapper: 'lane-c', five: 30 })];
    stubAccounts(first);
    const { container } = render(<AccountsStrip />);
    await screen.findByText('lane-a');
    const byName = (n: string): HTMLElement => cardsOf(container).find((c) => nameOf(c) === n)!;
    act(() => { byName('lane-b').focus(); });
    expect(document.activeElement).toBe(byName('lane-b'));
    // lane-b becomes the fullest on the next poll: it moves from the middle to last, and focus must go with it.
    stubAccounts([first[0]!, acct({ wrapper: 'lane-b', five: 90 }), first[2]!]);
    expect(cardsOf(container).map(nameOf)).toEqual(['lane-a', 'lane-c', 'lane-b']);
    expect(document.activeElement).toBe(byName('lane-b'));
    expect(byName('lane-b').tabIndex).toBe(0);
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
      // The store before any good answer (`usage: null`) — the same state a
      // permanently-failing /api/accounts leaves it in, since a failed read
      // writes nothing. This is a DIFFERENT fact from "the poll landed and
      // reported zero accounts" (below) — collapsing the two into one string
      // would erase the difference between "still waiting" and "asked, and
      // got nothing back".
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
