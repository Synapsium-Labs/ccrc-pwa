import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AccountUsage } from '../../shared/api';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { api } from '../src/lib/api';

const nowSec = Math.floor(Date.now() / 1000);

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: nowSec - 3600,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('AccountsStrip', () => {
  it('shows an inferred zero as "reset" and a measured zero as 0%', async () => {
    // Both fixtures are states the server can actually emit: readLimits sets
    // fiveRolledOver only when fiveResetAt is non-null and has passed (and then
    // forces five to 0), so an inferred zero always comes with a past reset
    // stamp and a measured one with a window still running. Without the stamps
    // this test would assert on data no server could produce.
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [
        acct({ wrapper: 'claude', five: 0, fiveResetAt: nowSec - 60, fiveRolledOver: true, seven: 57, sevenRolledOver: false }),
        acct({ wrapper: 'claude2', five: 0, fiveResetAt: nowSec + 9000, fiveRolledOver: false, seven: 93, sevenRolledOver: false }),
      ],
      // The strip ignores it; the route always sends it (see useProjectedHome).
      projected: { wrapper: 'claude', score: 57 },
    });
    render(<AccountsStrip />);
    // claude's 5h rolled over; claude2's 5h was really measured at zero.
    expect(await screen.findByText('reset')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
  });
});
