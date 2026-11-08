// D-8120 in the account pickers. `AccountRow` is the row SwapSheet's targets and
// NewSessionSheet's step 1 both draw, and before this a lane whose row carried
// the statusline writer's no-5h-window marker drew an empty "—" 5h gauge — the
// glyph for "nobody measured this" — beside a weekly gauge that the same picker
// ranks it on. It now says the Accounts card's words; a Codex lane, an
// unmarked five-less lane and an ordinary lane keep exactly today's rows.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AccountUsage, RosterWire } from '../../shared/api';
import { AccountRow } from '../src/fleet/AccountRow';
import { NO_FIVE_HOUR, WEEKLY_ONLY } from '../src/fleet/accountWords';
import { TEST_ROSTER } from './rosterFixture';

afterEach(cleanup);

const ROSTER: readonly RosterWire[] = TEST_ROSTER.map((r) =>
  r.id === 'gpt' ? { ...r, provider: 'openai', kind: 'codex' } : { ...r, provider: 'anthropic', kind: 'sign-in' });

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude-acme', five: 20, seven: 30, ts: null,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

const row = (facts: AccountUsage): HTMLElement => {
  const { container } = render(
    <AccountRow wrapper={facts.wrapper} facts={facts} onPick={vi.fn()} roster={ROSTER} />);
  return container;
};

const gaugeTexts = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.acct-gauge')].map((g) => g.textContent ?? '');

describe('AccountRow — a lane with no 5-hour window (D-8120)', () => {
  it('a marked Anthropic lane says "No 5-hour limit" in place of the 5h gauge, and keeps its weekly gauge', () => {
    const c = row(acct({ five: null, seven: 12, fiveResetAt: 1, fiveWindowMinutes: 0 }));
    const five = c.querySelector('.acct-gauge[data-five="none"]');
    expect(five?.textContent).toBe(`5h${NO_FIVE_HOUR}`);
    expect(five?.querySelector('[data-band]')).toBeNull();   // no meter track: the words are the reading
    expect(gaugeTexts(c)).toHaveLength(2);
    expect(gaugeTexts(c)[1]).toContain('12%');
    expect(c.textContent).not.toContain('—');
  });

  it('an unmarked five-less lane keeps the empty gauge: one unreported reading is not the fact', () => {
    const c = row(acct({ five: null, seven: 12 }));
    expect(c.querySelector('[data-five]')).toBeNull();
    expect(c.textContent).not.toContain(NO_FIVE_HOUR);
    expect(gaugeTexts(c)[0]).toContain('—');
  });

  it('a Codex lane keeps the row it draws today: no words, the gauge', () => {
    const c = row(acct({ wrapper: 'gpt', five: null, seven: 40, fiveWindowMinutes: 0 }));
    expect(c.querySelector('[data-five]')).toBeNull();
    expect(c.textContent).not.toContain(NO_FIVE_HOUR);
    expect(c.textContent).not.toContain(WEEKLY_ONLY);
    expect(gaugeTexts(c)[0]).toContain('—');
  });

  it('an ordinary lane is untouched', () => {
    const c = row(acct({}));
    expect(c.querySelector('[data-five]')).toBeNull();
    expect(gaugeTexts(c)[0]).toContain('20%');
    expect(c.querySelectorAll('.acct-gauge [data-band]')).toHaveLength(2);
  });
});
