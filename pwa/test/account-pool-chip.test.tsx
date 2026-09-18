// Task 9: `accountPoolState` — the single reader of `RosterWire.pool` /
// `resolvedPool` — plus the two surfaces that consume it: the AccountsScreen
// chip (which must surface WHICH carrier decided, via `data-origin`, so
// clearing a central tag never reads as a no-op) and the fleet head's
// epoch/observed lag indicator (a STALENESS signal, rendered only when the
// two numbers actually differ — never a health tick).
//
// Ruling T9-R1 (mid-task correction, 2026-09-18): the PWA cannot fold the
// central/declared precedence itself — the central `pool_edges` rows live
// only in the server's coord.db, and nothing puts them on the wire on its
// own. So `accountPoolState` no longer takes an `edges` map; it reads ONE
// resolved field, `RosterWire.resolvedPool?: AccountPoolWire` (precedence
// already folded server-side), and falls back to the declared-only read when
// that field is absent. Task 7's fix round (T7-R2) landed
// `RosterWire.resolvedPool` while this task was mid-flight, so the
// `origin: 'central'` cases below now exercise the real, shipped field shape
// — no cast needed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { AccountUsage, RosterWire } from '../../shared/api';
import type { AccountPoolWire } from '../../shared/poolrule';
import { accountPoolState } from '../src/lib/accounts';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

/** A minimal one-account roster, built directly (not off `TEST_ROSTER`, which
 *  carries no `acct-a`) — the fixture id this wave's plan uses throughout. */
const rosterWith = (id: string, pool: string | null): RosterWire[] => [
  { id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool },
];

/** A roster entry carrying the server-resolved `resolvedPool` field (T9-R1,
 *  shipped by Task 7's T7-R2 fix round). */
const rosterWithResolved = (id: string, resolvedPool: AccountPoolWire, declared: string | null = null): RosterWire[] => [
  { id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: declared, resolvedPool },
];

describe('accountPoolState — the single reader (no client-side precedence fold, T9-R1)', () => {
  it('returns the server-resolved CENTRAL tag verbatim, when present', () => {
    const w = accountPoolState(
      rosterWithResolved('acct-a', { state: 'tagged', pools: ['pool-central'], origin: 'central' }, 'pool-roster'),
      'acct-a',
    );
    expect(w).toEqual({ state: 'tagged', pools: ['pool-central'], origin: 'central' });
  });

  it('returns the server-resolved DECLARED tag verbatim too — the server may resolve to declared itself', () => {
    const w = accountPoolState(
      rosterWithResolved('acct-a', { state: 'tagged', pools: ['pool-roster'], origin: 'declared' }, 'pool-roster'),
      'acct-a',
    );
    expect(w).toEqual({ state: 'tagged', pools: ['pool-roster'], origin: 'declared' });
  });

  it('falls back to the DECLARED tag when resolvedPool is absent — an older server, or nothing central to resolve', () => {
    const w = accountPoolState(rosterWith('acct-a', 'pool-roster'), 'acct-a');
    expect(w).toEqual({ state: 'tagged', pools: ['pool-roster'], origin: 'declared' });
  });

  it('answers untagged, declared, when neither the resolved field nor the roster has a tag', () => {
    const w = accountPoolState(rosterWith('acct-a', null), 'acct-a');
    expect(w).toEqual({ state: 'untagged', origin: 'declared' });
  });

  it('normalizes an off-grammar declared value to untagged, same as accountPool always did', () => {
    const w = accountPoolState(
      [{ id: 'acct-a', label: 'acct-a', hue: 'cyan', homeAble: true, hidden: false, pool: 'Pool A' }],
      'acct-a',
    );
    expect(w).toEqual({ state: 'untagged', origin: 'declared' });
  });
});

describe('AccountsScreen — the account pool chip', () => {
  const acct = (over: Partial<AccountUsage>): AccountUsage => ({
    wrapper: 'acct-a', five: 0, seven: 0, ts: null,
    fiveResetAt: null, sevenResetAt: null,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
  });

  const stubAccounts = (roster: RosterWire[], accounts: AccountUsage[] = []): void => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts, projected: null, roster });
  };

  it('renders the origin, so clearing a central tag does not look like a no-op', async () => {
    stubAccounts(rosterWith('acct-a', 'pool-roster'), [acct({})]);
    render(<AccountsScreen />);
    const chip = await screen.findByTestId('acct-pool-chip-acct-a');
    expect(chip).toHaveTextContent('pool-roster');
    expect(chip).toHaveAttribute('data-origin', 'declared');
  });

  it('renders "no pool" for an untagged account, with no origin lie', async () => {
    stubAccounts(rosterWith('acct-a', null), [acct({})]);
    render(<AccountsScreen />);
    const chip = await screen.findByTestId('acct-pool-chip-acct-a');
    expect(chip).toHaveTextContent('no pool');
    expect(chip).toHaveAttribute('data-origin', 'declared');
  });

  it('renders the CENTRAL origin now that the wire carries resolvedPool (Task 7 T7-R2)', async () => {
    stubAccounts(
      rosterWithResolved('acct-a', { state: 'tagged', pools: ['pool-central'], origin: 'central' }, 'pool-roster'),
      [acct({})],
    );
    render(<AccountsScreen />);
    const chip = await screen.findByTestId('acct-pool-chip-acct-a');
    expect(chip).toHaveTextContent('pool-central');
    expect(chip).toHaveAttribute('data-origin', 'central');
  });
});

describe('FleetScreen — the epoch/observed lag indicator (staleness, not health)', () => {
  const makeStore = (): FleetStore => createFleetStore({
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });

  it('the fleet head shows epoch/observed ONLY when they differ', () => {
    const store = makeStore();
    const { rerender } = render(<FleetScreen store={store} epoch={3} observedEpoch={3} />);
    expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
    rerender(<FleetScreen store={store} epoch={4} observedEpoch={3} />);
    expect(screen.getByTestId('pool-epoch-lag')).toHaveTextContent('epoch 4 / observed 3');
  });

  it('says nothing at all when the agent cannot tell us (absent, not null)', () => {
    const store = makeStore();
    render(<FleetScreen store={store} epoch={4} observedEpoch={undefined} />);
    expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
  });

  it('says nothing when there is no epoch to compare against either', () => {
    const store = makeStore();
    render(<FleetScreen store={store} observedEpoch={3} />);
    expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
  });
});
