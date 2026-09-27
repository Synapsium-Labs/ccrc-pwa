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

  // Review round 1, I5: the guard's only prior caller was a button jsdom
  // (like a real browser) never dispatches a click on while `disabled`, so
  // "refuses a name off POOL_NAME_RE" above proved the guard existed for a
  // reason unrelated to the guard — measured by deleting the line and
  // re-running: the whole suite stayed green. Enter-to-submit is a second,
  // real caller the button's `disabled` attribute does not gate, so these
  // two actually exercise `if (!validNew) return;` and its positive twin.
  it('Enter on an off-grammar name does NOT submit — the guard has a real caller now', () => {
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
    const input = screen.getByLabelText('New pool name');
    fireEvent.change(input, { target: { value: 'Pool_A' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).not.toHaveBeenCalled();
  });

  it('Enter on a valid name submits, same as clicking Create', () => {
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
    const input = screen.getByLabelText('New pool name');
    fireEvent.change(input, { target: { value: 'pool-new' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('acct-a', ['pool-new']);
  });

  it('renders nothing while no account is selected', () => {
    const { container } = render(
      <AccountPoolSheet account={null} roster={[]} open onClose={() => {}} onSet={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // Review round 1, I4: `malformed`/`unreadable`/`stale` used to all collapse
  // into "This app is older than the fleet; reload" — the wrong remedy for
  // every one of them (that sentence is reserved for a genuinely
  // UNRECOGNISED future state). Not producible by today's server, so this is
  // forward-looking coverage for the `never`-guarded switch, on the same
  // terms the AccountsScreen chip test below exercises.
  it.each([
    ['malformed', "acct-a's pool tag is malformed and cannot be read as a name."],
    ['unreadable', "acct-a's pool tag could not be read — check permissions on the fleet host."],
    ['stale', "acct-a's pool projection is stale — the control-plane link may be down."],
  ] as const)('gives %s its own remedy, not the reload sentence', (state, expected) => {
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', null)}
        current={{ state }}
        open
        onClose={() => {}}
        onSet={vi.fn()}
      />,
    );
    expect(screen.getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByText(/older than the fleet/)).not.toBeInTheDocument();
  });

  // Item 3 (I1, wave-1 fix round A): the sheet's own disclosure that nothing
  // on the fleet enforces an account tag yet — the ONE place this fact
  // reaches the operator, since `AccountsScreen`'s dimmed chip stays
  // clickable specifically so this sheet still opens (see
  // `ACCOUNT_POOL_UNAVAILABLE_TEXT`'s own docstring).
  it('discloses nothing-enforces-this-yet when the caller measured accountPools:unavailable', () => {
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', null)}
        unenforced
        open
        onClose={() => {}}
        onSet={vi.fn()}
      />,
    );
    expect(screen.getByTestId('account-pool-unenforced-notice')).toHaveTextContent(
      /nothing on the fleet enforces it yet/,
    );
  });

  it.each([undefined, false] as const)('says nothing when unenforced is %s — no evidence, no claim', (unenforced) => {
    render(
      <AccountPoolSheet
        account="acct-a"
        roster={rosterWith('acct-a', null)}
        unenforced={unenforced}
        open
        onClose={() => {}}
        onSet={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('account-pool-unenforced-notice')).not.toBeInTheDocument();
  });
});
