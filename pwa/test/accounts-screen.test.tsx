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
  bucket: 'idle', bucketSince: null, ...over,
});

const stubAccounts = (accounts: AccountUsage[], projected: { wrapper: string; score: number } | null = null): void => {
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts, projected });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
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
});

describe('AccountsScreen — the projection line', () => {
  it('names the account ccd would land the next workspace on', async () => {
    stubAccounts([acct({ wrapper: 'claude', five: 10 })], { wrapper: 'claude', score: 10 });
    render(<AccountsScreen />);
    expect(await screen.findByText(/next workspace lands on team·max/i)).toBeInTheDocument();
  });

  it('falls back to naming the refusal when every account is disabled', async () => {
    stubAccounts([acct({ wrapper: 'claude', disabled: true })], null);
    render(<AccountsScreen />);
    expect(await screen.findByText(/all accounts disabled/i)).toBeInTheDocument();
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
