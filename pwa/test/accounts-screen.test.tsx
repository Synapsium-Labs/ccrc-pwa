// AccountsScreen (route `/accounts`, Task 6 of Build 3 PR G) — the expansion
// of the existing /api/accounts pipeline the strip already renders compactly.
// Reuses accounts-strip.test.tsx's own fixture shape and %/reset/— cases
// deliberately: the three-way is the strip's contract, not a new one, and a
// second copy of the fixtures would only let the two drift apart unnoticed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AccountUsage, FleetSession } from '../../shared/api';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { declValue, ruleIn } from './cssRule';
import { TEST_ROSTER } from './rosterFixture';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const nowSec = Math.floor(Date.now() / 1000);

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: nowSec - 3600,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo', workdir: '/w',
  workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, started: true, spawnState: null, ...over,
});

const stubAccounts = (accounts: AccountUsage[], projected: { wrapper: string; score: number } | null = null): void => {
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts, projected, roster: TEST_ROSTER });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

// Review fix: `accounts === null` ("no poll has landed yet") used to fall
// through to the same row-rendering path as a landed, empty response — every
// row found `a === null` and printed "last reported —", stating as fact that
// no telemetry has EVER landed when the truth is the screen never got an
// answer. Mirrors the projection line's own three-state discipline a few
// lines up in the component, which this used to be the one place that broke.
describe('AccountsScreen — the waiting state, before any poll answers (review fix)', () => {
  it('never asserts "last reported —" before the first poll resolves', () => {
    // A promise that never resolves, asserted on synchronously right after
    // render — nothing awaited, so this is the render before any microtask
    // from the fetch could have run. Robust against microtask-timing
    // assumptions in a way `mockResolvedValue` + a bare synchronous check
    // would not be.
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    render(<AccountsScreen />);
    expect(screen.queryByText(/last reported/i)).not.toBeInTheDocument();
    // The house waiting state (Skeleton), not four confident "—" rows.
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);
  });

  it('stays in the waiting state when /api/accounts fails, rather than reporting on accounts it never heard from', async () => {
    // The reviewer's exact scenario: the fleet host is up but the route
    // 500s (or the PWA opened offline / mid restart). The poller's own
    // `.catch(() => {})` never sets state on failure, so `accounts` stays
    // `null` for as long as every attempt keeps failing.
    vi.spyOn(api, 'accounts').mockRejectedValue(new Error('fleet host down'));
    render(<AccountsScreen />);
    // Let the rejected promise's microtask (and the effect's state-setting
    // branch it does NOT take) settle before asserting the negative.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText(/last reported —/i)).not.toBeInTheDocument();
  });
});

describe('AccountsScreen — every account, never hidden', () => {
  it('renders a row for every known account, including one with no telemetry at all', async () => {
    // Only claude ever reported; claude2/claude-corp/gpt are absent from the
    // wire entirely (never run, never markered) — the strip would simply
    // never show them, but "show me my accounts" means they still get a row.
    stubAccounts([acct({ wrapper: 'claude', five: 12, seven: 4 })]);
    render(<AccountsScreen />);
    expect(await screen.findByText('team·max')).toBeInTheDocument();
    expect(screen.getByText('alt·max')).toBeInTheDocument();
    expect(screen.getByText('team·shared')).toBeInTheDocument();
    expect(screen.getByText('gpt')).toBeInTheDocument();
  });

  it('shows a disabled lane greyed with its reason — never drops the row', async () => {
    stubAccounts([
      acct({ wrapper: 'claude', five: 30 }),
      acct({ wrapper: 'claude2', five: null, seven: null, ts: null, disabled: true }),
    ]);
    render(<AccountsScreen />);
    expect(await screen.findByText('alt·max')).toBeInTheDocument();
    expect(screen.getByText(/disabled on the fleet host/i)).toBeInTheDocument();
    // The enabled account carries no such note.
    const claudeRow = screen.getByText('team·max').closest('[data-disabled]');
    expect(claudeRow).toHaveAttribute('data-disabled', 'false');
  });

  // Whole-branch review: `data-disabled` had no CSS consumer at all (the two
  // row-selector assertions above were its only reason to exist) — a lane
  // disabled while its own telemetry sat at crit-red kept a solid red 5h/7d
  // bar forever, since nothing runs on a disabled lane to refresh it. The
  // row's loudest element reported live pressure on an account the same row
  // calls switched off. `limitBand`/`data-band` are untouched on purpose —
  // the frozen reading is real data, not something to hide — only the
  // row-level override neutralizes its COLOR.
  it('mutes a disabled lane\'s meter fill even when its frozen reading is crit-red', async () => {
    stubAccounts([acct({ wrapper: 'claude', five: 92, disabled: true })]);
    render(<AccountsScreen />);
    const claudeRow = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(claudeRow).toHaveAttribute('data-disabled', 'true');
    // The band itself still reports crit (proves this is a row-level CSS
    // override, not a change to limitBand's own classification).
    expect(claudeRow.querySelector(".acct-meter[data-band='crit']")).not.toBeNull();
    expect(declValue(ruleIn(fleetCss, ".accounts-row[data-disabled='true'] .acct-fill"), 'background'))
      .toBe('var(--edge-subtle)');
  });
});

describe('AccountsScreen — the %/reset/— three-way (accounts-strip.test.tsx\'s own fixtures)', () => {
  it('shows an inferred zero as "reset", a measured zero as 0%, and an unmeasured window as —', async () => {
    stubAccounts([
      acct({
        wrapper: 'claude', five: 0, fiveResetAt: nowSec - 60, fiveRolledOver: true,
        seven: 57, sevenRolledOver: false,
      }),
      acct({
        wrapper: 'claude2', five: 0, fiveResetAt: nowSec + 9000, fiveRolledOver: false,
        seven: null, sevenRolledOver: false,
      }),
    ]);
    render(<AccountsScreen />);
    // Rows are scoped with `within` — the screen also renders claude-corp and
    // gpt as blank (never-reported) rows in the same fixture, each carrying
    // its OWN unmeasured "—", so an unscoped getByText('—') is ambiguous by
    // construction here. That is exactly the "never hides it" behaviour under
    // test elsewhere in this file; this block only asserts the three-way.
    const claudeRow = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(within(claudeRow).getByText('reset')).toBeInTheDocument();  // rolled-over 5h
    expect(within(claudeRow).getByText('57%')).toBeInTheDocument();    // measured 7d

    const claude2Row = screen.getByText('alt·max').closest('[data-disabled]') as HTMLElement;
    expect(within(claude2Row).getByText('0%')).toBeInTheDocument();   // really-measured-at-zero 5h
    expect(within(claude2Row).getByText('—')).toBeInTheDocument();    // never-measured 7d
  });
});

describe('AccountsScreen — freshness ("last reported")', () => {
  it('renders the age since the last telemetry sample', async () => {
    stubAccounts([acct({ wrapper: 'claude', ts: nowSec - 2 * 3600 })]);
    render(<AccountsScreen />);
    expect(await screen.findByText(/last reported 2h ago/i)).toBeInTheDocument();
  });

  it('renders — when a sample has never landed', async () => {
    stubAccounts([acct({ wrapper: 'claude', ts: null, five: null, seven: null })]);
    render(<AccountsScreen />);
    // Scoped to claude's row: claude2/claude-corp/gpt never reported at all in
    // this fixture either, so an unscoped query is ambiguous by construction
    // (the exact "never hides it" behaviour under test elsewhere in this file).
    const claudeRow = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(within(claudeRow).getByText(/last reported —/i)).toBeInTheDocument();
  });
});

describe('AccountsScreen — sessions on this account', () => {
  it('lists live sessions whose wrapper matches, and navigates to /s/:id on tap', async () => {
    stubAccounts([acct({ wrapper: 'claude' })]);
    act(() => useFleetStore.setState({
      conn: 'open',
      sessions: [
        sess({ id: 'a', wrapper: 'claude', project: 'alpha', workspace: 'quiet-basin', name: 'alpha work' }),
        sess({ id: 'b', wrapper: 'claude2', project: 'beta', workspace: 'still-cove', branch: 'ws/still-cove' }),
      ],
    }));
    render(<AccountsScreen />);
    const claudeRow = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    const link = within(claudeRow).getByRole('button', { name: 'alpha work' });
    // The other account's session shows up under ITS OWN row (claude2, tested
    // implicitly by the label existing at all) but must not leak into claude's.
    expect(within(claudeRow).queryByText('ws/still-cove')).not.toBeInTheDocument();
    fireEvent.click(link);
    expect(location.pathname).toBe('/s/a');
  });

  // Review fix: `wrapper` alone used to be the whole predicate, so an
  // archived workspace or a session whose tmux is long gone (`status:
  // 'dead'`) rendered as if it were live load on the account — the exact
  // overstatement this screen exists to correct. Rider A §4 says "live
  // sessions"; `useFleetStore().sessions` is the whole registry-backed
  // array, archived rows and all (ArchiveScreen's own `archivedAt !== null`
  // filter is what pulls them out elsewhere).
  it('excludes archived and dead sessions from the count and list — only live load counts', async () => {
    stubAccounts([acct({ wrapper: 'claude' })]);
    act(() => useFleetStore.setState({
      conn: 'open',
      sessions: [
        sess({ id: 'live', wrapper: 'claude', name: 'still running' }),
        sess({ id: 'gone', wrapper: 'claude', name: 'old workspace', archivedAt: 100 }),
        sess({ id: 'dead', wrapper: 'claude', name: 'crashed pane', status: 'dead' }),
      ],
    }));
    render(<AccountsScreen />);
    const claudeRow = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(within(claudeRow).getByRole('button', { name: 'still running' })).toBeInTheDocument();
    expect(within(claudeRow).queryByText('old workspace')).not.toBeInTheDocument();
    expect(within(claudeRow).queryByText('crashed pane')).not.toBeInTheDocument();
  });
});

describe('AccountsScreen — the projection line', () => {
  it('names the account ccd would land the next workspace on', async () => {
    stubAccounts([acct({ wrapper: 'claude', five: 10 })], { wrapper: 'claude', score: 10 });
    render(<AccountsScreen />);
    expect(await screen.findByText(/next workspace lands on team·max/i)).toBeInTheDocument();
  });

  it('falls back to naming the four HOME_ABLE lanes individually — never "all accounts" — when every one is disabled', async () => {
    stubAccounts([acct({ wrapper: 'claude', disabled: true })], null);
    render(<AccountsScreen />);
    expect(await screen.findByText('Next workspace: team·max, alt·max, team·shared and lab·dev0 all disabled — nothing can take it'))
      .toBeInTheDocument();
  });
});

describe('AccountsScreen — back control', () => {
  it('has a back affordance like SessionScreen\'s (presence, not pixels)', async () => {
    stubAccounts([acct({ wrapper: 'claude' })]);
    render(<AccountsScreen />);
    const back = screen.getByRole('button', { name: /back to fleet/i });
    fireEvent.click(back);
    expect(location.pathname).toBe('/');
  });
});

// The 44px tap floor for the two new controls this screen adds — the back
// chevron and a session chip. jsdom evaluates no stylesheet (vitest runs
// with `css: false`), so the scrape proves the rule exists off the shared
// token and the render proves the class is still on the element it
// describes; see test/cssRule.ts for why a text scrape is the tool here.
describe('AccountsScreen — tap targets', () => {
  it('.accounts-back is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.accounts-back'), 'min-height')).toBe('var(--tap-min)');
  });

  it('.accounts-back is the class the rendered back button carries', async () => {
    stubAccounts([acct({ wrapper: 'claude' })]);
    render(<AccountsScreen />);
    expect(screen.getByRole('button', { name: /back to fleet/i })).toHaveClass('accounts-back');
  });

  it('.accounts-session is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.accounts-session'), 'min-height')).toBe('var(--tap-min)');
  });

  it('.accounts-session is the class a rendered session chip carries', async () => {
    stubAccounts([acct({ wrapper: 'claude' })]);
    act(() => useFleetStore.setState({
      conn: 'open',
      sessions: [sess({ id: 'a', wrapper: 'claude', name: 'alpha work' })],
    }));
    render(<AccountsScreen />);
    expect(await screen.findByRole('button', { name: 'alpha work' })).toHaveClass('accounts-session');
  });
});
