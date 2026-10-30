// One accounts answer for the W7 pins that render `AccountsScreen` (C7a, D-7179).
//
// The screen has read its rows two ways across the trees these pins must hold on: its own `api.accounts()` poll,
// and the fleet store's one `/api/accounts` read (`usage`, `projected`, `roster`), which a pending change makes the
// screen's only source. A pin driven through only one seam renders no row on the other tree, so the verdict reads
// `not-listed` for a reason that has nothing to do with presence. This helper feeds the SAME answer through both:
// the `api.accounts` spy for the poll, and the store fields for the subscriber. The seed is a plain object, not a
// literal, so a store without a `projected` field still type-checks; the extra key is inert there.
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { AccountUsage } from '../../shared/api';
import { api } from '../src/lib/api';
import { useFleetStore, type FleetState } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

/** The one account row every AccountsScreen pin lists its sessions under. */
export function claudeAccount(): AccountUsage {
  return { wrapper: 'claude', five: 0, seven: 0, ts: Math.floor(Date.now() / 1000) - 60, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false };
}

/** Seeds `accounts` through both seams and returns the undo (the spy restored, the store fields put back). */
export function seedAccountsAnswer(accounts: readonly AccountUsage[] = [claudeAccount()]): () => void {
  const answer = { accounts: [...accounts], projected: null, roster: TEST_ROSTER };
  const spy = vi.spyOn(api, 'accounts').mockResolvedValue(answer);
  const held = useFleetStore.getState() as unknown as Record<string, unknown>;
  const before = { usage: held.usage, projected: held.projected, roster: held.roster } as unknown as Partial<FleetState>;
  const seed = { usage: answer.accounts, projected: answer.projected, roster: answer.roster };
  act(() => { useFleetStore.setState(seed); });
  return () => {
    spy.mockRestore();
    act(() => { useFleetStore.setState(before); });
  };
}
