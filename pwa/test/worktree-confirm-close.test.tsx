// Delegation broker wave 5, PR10, fix round 1 (review 1615 F9 (a)) and fix round 2 (review 1623 F1, F4): a worktree
// control's confirm as it closes. jsdom runs no close transition, so the real sheet unmounts the moment it closes, and a
// row on it could neither see the words it would animate out with nor tap its confirm while it closes. This file records
// `QuickConfirm`'s props on every render instead, open or closed: a PARTIAL mock via `importOriginal` (the card also draws
// `Button`, `BareRow` and `useNow`), which mirrors the real contract: when open, a confirm and a Cancel; the confirm calls
// `onConfirm` then `onClose`, and Cancel calls `onClose` once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COORD_A, cardElement, okJson, renderCard, worldWithLease } from './leaseCardFixture';

interface ConfirmProps {
  open: boolean; title: string; consequence: string; confirmLabel: string; tone?: string;
  onConfirm: () => void; onClose: () => void;
}
/** Every render's props, in order. */
const seen: ConfirmProps[] = [];

vi.mock('@ccrc/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ccrc/ui')>()),
  QuickConfirm: (p: ConfirmProps) => {
    seen.push(p);
    return (
      <div data-testid="qc" data-open={String(p.open)} data-title={p.title} data-consequence={p.consequence}
        data-label={p.confirmLabel} data-tone={p.tone ?? 'commit'}>
        {p.open && <button type="button" onClick={p.onClose}>Cancel</button>}
      </div>
    );
  },
}));

beforeEach(() => { seen.length = 0; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const last = (): ConfirmProps => seen.at(-1)!;
const qc = (): HTMLElement => screen.getByTestId('qc');
const words = (): Record<string, string | undefined> =>
  ({ title: qc().dataset['title'], consequence: qc().dataset['consequence'], label: qc().dataset['label'], tone: qc().dataset['tone'] });
const accepted = (): Response => okJson({ ok: true, lease: 'x', generation: 2, disposition: 'retained', expiresAt: null, carrier: 'pending' });

describe('a worktree control\'s confirm as it closes (delegation broker wave 5, PR10, F9 (a))', () => {
  it('keeps its title, consequence, label and danger tone once Cancel has closed it', async () => {
    renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }));
    expect(qc().dataset['open']).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    expect(qc().dataset['open']).toBe('true');
    const open = words();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(qc().dataset['open']).toBe('false');
    expect(words()).toEqual({ ...open, tone: 'danger' });
    expect(open['title']).toBe('Not delegated work?');
  });
});

describe('one confirm posts once (review 1623 F1)', () => {
  // A tap on the confirm, then a second tap on the same panel while it animates out: the real sheet keeps its confirm
  // mounted through the exit, so the second tap calls the onConfirm the closed render handed it.
  const tapTwice = async (): Promise<void> => {
    const first = last();
    expect(first.open).toBe(true);
    await act(async () => { first.onConfirm(); first.onClose(); });
    const closing = last();
    expect(closing.open).toBe(false);
    await act(async () => { closing.onConfirm(); closing.onClose(); });
    // And the first render's own handler again, as a stale closure would hold it.
    await act(async () => { first.onConfirm(); });
  };

  it('Not delegated posts once however often its closing confirm is tapped', async () => {
    const fetch = vi.fn(async () => accepted());
    renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }), { fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await tapTwice();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('Attach posts once however often its closing confirm is tapped', async () => {
    const fetch = vi.fn(async () => accepted());
    renderCard(worldWithLease({ sourceKind: 'raw' }), { fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(last().title).toBe('Attach this worktree to coord-a?');
    await tapTwice();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('an ask its row stops offering (review 1623 F4)', () => {
  it('closes at once with its words kept, and its confirm, tapped as it closes, posts nothing', async () => {
    const fetch = vi.fn(async () => accepted());
    const world = worldWithLease({ sourceKind: 'raw' }, [COORD_A]);
    const { rerender } = renderCard(world, { fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    const open = words();
    expect(open['title']).toBe('Attach this worktree to coord-a?');
    const asked = last();
    const from = seen.length;
    // The worktree's session leaves the list: Attach is no longer offered; Keep and Not delegated stay.
    rerender(cardElement({ ...world, sessions: [] }));
    expect(seen.slice(from).map((p) => p.open), 'no render after the row stopped offering it draws the confirm open')
      .not.toContain(true);
    expect(words(), 'the words it animates out with').toEqual(open);
    await act(async () => { asked.onConfirm(); last().onConfirm(); });
    expect(fetch).not.toHaveBeenCalled();
  });
});
