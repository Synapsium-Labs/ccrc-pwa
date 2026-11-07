// Delegation broker wave 5, PR10, fix round 1 (review 1615 F9 (a)): a worktree control's confirm keeps its title,
// consequence, label and tone while it closes. jsdom runs no close transition, so the real sheet unmounts the moment it
// closes and a row on it could not see the words it would animate out with. This file records `QuickConfirm`'s props
// instead, open or closed: a PARTIAL mock via `importOriginal` (the card also draws `Button`, `BareRow` and `useNow`),
// which mirrors the real contract: when open, a confirm and a Cancel; Cancel calls `onClose` once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderCard, worldWithLease } from './leaseCardFixture';

vi.mock('@ccrc/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ccrc/ui')>()),
  QuickConfirm: (p: { open: boolean; title: string; consequence: string; confirmLabel: string; tone?: string;
    onConfirm: () => void; onClose: () => void }) => (
    <div data-testid="qc" data-open={String(p.open)} data-title={p.title} data-consequence={p.consequence}
      data-label={p.confirmLabel} data-tone={p.tone ?? 'commit'}>
      {p.open && <button type="button" onClick={p.onClose}>Cancel</button>}
    </div>
  ),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('a worktree control\'s confirm as it closes (delegation broker wave 5, PR10, F9 (a))', () => {
  it('keeps its title, consequence, label and danger tone once Cancel has closed it', async () => {
    renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }));
    const qc = (): HTMLElement => screen.getByTestId('qc');
    expect(qc().dataset['open']).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    expect(qc().dataset['open']).toBe('true');
    const open = { ...qc().dataset };
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(qc().dataset['open']).toBe('false');
    expect({ title: qc().dataset['title'], consequence: qc().dataset['consequence'], label: qc().dataset['label'], tone: qc().dataset['tone'] })
      .toEqual({ title: open['title'], consequence: open['consequence'], label: open['label'], tone: 'danger' });
    expect(open['title']).toBe('Not delegated work?');
  });
});
