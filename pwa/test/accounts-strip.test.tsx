import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AccountUsage } from '../../shared/api';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { api } from '../src/lib/api';

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: 1785231736,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('AccountsStrip', () => {
  it('shows an inferred zero as "reset" and a measured zero as 0%', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [
        acct({ wrapper: 'claude', five: 0, fiveRolledOver: true, seven: 57, sevenRolledOver: false }),
        acct({ wrapper: 'claude2', five: 0, fiveRolledOver: false, seven: 93, sevenRolledOver: false }),
      ],
    });
    render(<AccountsStrip />);
    // claude's 5h rolled over; claude2's 5h was really measured at zero.
    expect(await screen.findByText('reset')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
  });
});
