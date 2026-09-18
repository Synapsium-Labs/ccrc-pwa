// Task 9: AccountPoolSheet — the account-side pool editor, and the one sheet
// in this app allowed to accept a pool name no account yet carries. Unlike
// PoolSheet (the project side, which offers roster-derived names only), a
// pool does not exist until some account is in it — the account side is
// where a pool is CREATED — so this sheet's free-text field is principled,
// not a shortcut PoolSheet was too careful to take.
//
// `fireEvent`, not `userEvent`, for every interaction below — matching this
// suite's own established idiom for Sheet-rendered controls
// (`session-actions-sheet.test.tsx` states the reason in its own comment,
// verbatim): vaul's Drawer attaches its own pointer/drag handlers to its
// content, and `userEvent`'s realistic pointerdown/pointerup sequence walks
// straight into them under jsdom (`getTranslate` reads a `transform` jsdom
// never sets) — an uncaught exception vitest reports separately from the
// assertions (and fails the process on), real but orthogonal to anything
// this suite tests. The task brief's own Step-1 snippet used `userEvent`;
// this is a mechanical substitution onto the codebase's already-established
// pattern, not a behavioural change to what is asserted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RosterWire } from '../../shared/api';
import { AccountPoolSheet } from '../src/fleet/AccountPoolSheet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rosterWith = (id: string, pool: string | null): RosterWire[] => [
  { id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool },
];

describe('AccountPoolSheet', () => {
  it('the account sheet ACCEPTS A NAME NO ACCOUNT CARRIES — unlike PoolSheet', () => {
    const onSet = vi.fn();
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', null)}
        open
        onClose={() => {}}
        onSet={onSet}
      />,
    );
    fireEvent.change(screen.getByLabelText('New pool name'), { target: { value: 'pool-new' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSet).toHaveBeenCalledWith('acct-a', ['pool-new']);
  });

  it('refuses a name off POOL_NAME_RE before it reaches the wire', () => {
    const onSet = vi.fn();
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', null)}
        open
        onClose={() => {}}
        onSet={onSet}
      />,
    );
    fireEvent.change(screen.getByLabelText('New pool name'), { target: { value: 'Pool_A' } });
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSet).not.toHaveBeenCalled();
  });

  it('the create button starts disabled on an empty field', () => {
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', null)}
        open
        onClose={() => {}}
        onSet={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('picking an existing pool option calls onSet with that single name', () => {
    const onSet = vi.fn();
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-b', 'pool-existing')}
        open
        onClose={() => {}}
        onSet={onSet}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-existing' }));
    expect(onSet).toHaveBeenCalledWith('acct-a', ['pool-existing']);
  });

  it('"no pool" clears with an empty array', () => {
    const onSet = vi.fn();
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', 'pool-roster')}
        current={{ state: 'tagged', pools: ['pool-roster'], origin: 'declared' }}
        open
        onClose={() => {}}
        onSet={onSet}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /no pool/i }));
    expect(onSet).toHaveBeenCalledWith('acct-a', []);
  });

  it('renders nothing while no account is selected', () => {
    const { container } = render(
      <AccountPoolSheet account={null} roster={[]} open onClose={() => {}} onSet={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
