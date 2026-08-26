import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PrState } from '../../shared/api';
import { PrKeycap } from '../src/session/PrKeycap';

// No `globals: true` in this package, so RTL's auto-cleanup never registers.
// vi.useRealTimers() undoes the one test below that freezes the clock to pin
// an exact-boundary case — harmless for every other test, which never fakes
// timers at all (same convention as primitives.test.tsx's shared afterEach).
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const pr = (over: Partial<PrState> = {}): PrState => ({
  phase: 'open', number: 42, url: 'https://github.com/o/r/pull/42', title: 'the work',
  checks: null, checkNames: null, ahead: 3, reason: null,
  checkedAt: Date.now() - 6 * 60_000, mergedAt: null, retryAt: null, ...over,
});

describe('legend', () => {
  it.each([
    ['unchecked', pr({ phase: 'unchecked', number: null }), 'PR'],
    ['none', pr({ phase: 'none', number: null }), 'PR'],
    ['no-commits', pr({ phase: 'no-commits', number: null }), 'PR'],
    ['open', pr({ phase: 'open' }), '#42'],
    ['draft', pr({ phase: 'draft' }), '#42'],
    ['merged', pr({ phase: 'merged' }), '#42'],
    ['closed', pr({ phase: 'closed' }), '#42'],
  ])('%s reads %s', (_n, state, legend) => {
    render(<PrKeycap pr={state} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(legend);
  });

  it('keeps the last known number in unknown, falling back to PR', () => {
    // Greying out the number too would throw away the one fact we still have.
    render(<PrKeycap pr={pr({ phase: 'unknown', number: 42, reason: 'timeout' })} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('#42');
    cleanup();
    render(<PrKeycap pr={pr({ phase: 'unknown', number: null, reason: 'offline' })} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('PR');
  });
});

describe('the cap renders even when nothing is known', () => {
  it('renders for a null pr — "not checked yet" is a state, not an absence', () => {
    // Keying visibility on pr !== null makes the control's ABSENCE an
    // affirmative claim, and hides Retry behind a control that is not there.
    render(<PrKeycap pr={null} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('PR');
    expect(screen.getByRole('button')).toHaveAttribute('data-phase', 'unchecked');
  });
});

describe('a tap only ever opens the sheet', () => {
  it.each(['unchecked', 'none', 'no-commits', 'open', 'draft', 'merged', 'closed', 'unknown'] as const)(
    'in phase %s', (phase) => {
      const onOpen = vi.fn();
      render(<PrKeycap pr={pr({ phase })} onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

  it('is never disabled — the sheet is where the explanation lives', () => {
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'unauthenticated' })} onOpen={() => {}} />);
    expect(screen.getByRole('button')).not.toBeDisabled();
  });
});

describe('CI status is never colour-only', () => {
  it('carries a glyph beside the dot for pass, fail and pending', () => {
    for (const [checks, glyph] of [['pass', '✓'], ['fail', '✕'], ['pending', '▲']] as const) {
      render(<PrKeycap pr={pr({ checks })} onOpen={() => {}} />);
      expect(screen.getByRole('button')).toHaveTextContent(glyph);
      cleanup();
    }
  });

  it('shows no glyph when no checks are configured', () => {
    render(<PrKeycap pr={pr({ checks: null })} onOpen={() => {}} />);
    for (const g of ['✓', '✕', '▲']) expect(screen.getByRole('button')).not.toHaveTextContent(g);
  });
});

describe('the accessible name carries the whole sentence', () => {
  it.each([
    [pr({ phase: 'unchecked', number: null }), /not checked yet/i],
    [pr({ phase: 'no-commits', number: null }), /no commits past/i],
    [pr({ phase: 'none', number: null }), /no pull request yet/i],
    [pr({ phase: 'open', checks: 'fail' }), /checks failing/i],
    [pr({ phase: 'merged', mergedAt: Date.now() - 12 * 60_000 }), /merged/i],
    [pr({ phase: 'closed' }), /closed without merging/i],
    [pr({ phase: 'unknown', reason: 'unauthenticated' }), /isn.t logged in/i],
    // draft/open's own word, distinct from checkText's " No checks
    // configured." tail that already covers the rest of the sentence.
    [pr({ phase: 'draft' }), /: draft\./i],
    [pr({ phase: 'open' }), /: open\./i],
    [pr({ phase: 'closed' }), /commits are not on main/i],
  ])('%#', (state, re) => {
    render(<PrKeycap pr={state} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(re);
  });

  it('names the exact "ago" for a merged PR, not just the word "merged"', () => {
    render(<PrKeycap pr={pr({ phase: 'merged', mergedAt: Date.now() - 12 * 60_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/merged 12m ago\./);
  });

  it('names the branch fallback exactly — PrKeycap passes no branch through yet', () => {
    render(<PrKeycap pr={pr({ phase: 'no-commits', number: null })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label'))
      .toBe('Pull request: `this branch` has no commits past its base.');
  });

  it('carries the checks value as a data attribute, for the CSS to key off', () => {
    render(<PrKeycap pr={pr({ checks: 'fail' })} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-checks', 'fail');
    cleanup();
    render(<PrKeycap pr={pr({ checks: null })} onOpen={() => {}} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-checks');
  });

  it('renders the dot, legend and glyph as their own elements, for the CSS to key off', () => {
    const { container } = render(<PrKeycap pr={pr({ checks: 'pass' })} onOpen={() => {}} />);
    expect(container.querySelector('.pr-dot')).not.toBeNull();
    expect(container.querySelector('.pr-legend')).not.toBeNull();
    expect(container.querySelector('.pr-glyph')).not.toBeNull();
  });

  it('says when it last checked, from checkedAt', () => {
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'timeout', checkedAt: Date.now() - 6 * 60_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/last checked 6m ago/);
  });

  it('says nothing about "last checked" under a minute — rel(x) stays null, not "0m"', () => {
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'timeout', checkedAt: Date.now() - 10_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/last checked/i);
  });

  it('formats hours as a whole number, not a fraction of a minute', () => {
    // 125 minutes = 2h5m; rel() rounds down to whole hours (Math.floor), so
    // this must read "2h", never "2.0833333333333335h".
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'timeout', checkedAt: Date.now() - 125 * 60_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/last checked 2h ago/);
  });

  it('crosses from hours to days exactly at 24h, not at-or-before it', () => {
    // Exactly 1440 minutes (24h) must read "1d" — the boundary the code
    // guards is `h < 24`, not `h <= 24`.
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'timeout', checkedAt: Date.now() - 24 * 60 * 60_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/last checked 1d ago/);
  });

  it('draws the retrying-now boundary at ms <= 0 exactly, not ms < 0', () => {
    // A frozen clock is the only reliable way to land ms EXACTLY on the
    // boundary — any real-time gap between building retryAt and rendering
    // makes ms strictly negative regardless of which operator ships.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'rate-limit', retryAt: 1_700_000_000_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/retrying now/i);
  });

  it('says when it will retry, from retryAt — the other half of §6 rate-limit row', () => {
    // Rate limiting is a flat 15-minute backoff. Naming the reason and NOT the
    // wait leaves a greyed cap that is indistinguishable from a broken one.
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'rate-limit', retryAt: Date.now() + 14 * 60_000 })} onOpen={() => {}} />);
    const label = screen.getByRole('button').getAttribute('aria-label')!;
    expect(label).toMatch(/rate-limiting/i);
    expect(label).toMatch(/retrying in 14m/i);
  });

  it('promises no retry when none is scheduled', () => {
    // A ROUTE read failure backs nothing off, so retryAt is null and the
    // sentence must not invent a time.
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'agent-down', retryAt: null })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/retrying/i);
  });

  // Task 3 review finding 9's docket: the registry persists `prPhase` and
  // `prNumber` but not `reason`, so a server restart rebuilds `unknown` with
  // `reason: null` even when the live read had a real reason (including
  // `merge-unproven`, which is not a failed read at all). Defaulting that to
  // the 'error' sentence ("GitHub could not be read") would be a lie for the
  // merge-unproven case and a guess for every other one — so a null reason
  // gets its own honest-stale sentence instead of borrowing 'error'.
  it('gives a null reason under unknown its own honest-stale sentence, not the error one', () => {
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: null })} onOpen={() => {}} />);
    const label = screen.getByRole('button').getAttribute('aria-label')!;
    expect(label).not.toMatch(/could not be read/i);
    expect(label).toMatch(/restart/i);
  });

  it('says nothing about "last checked" when checkedAt itself is null', () => {
    // rel(null) must stay null, not fall through to a bogus multi-decade "ago".
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'timeout', checkedAt: null })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/last checked/i);
  });

  it('omits "ago" when a merged PR has no recorded mergedAt', () => {
    render(<PrKeycap pr={pr({ phase: 'merged', mergedAt: null })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Pull request #42: merged.');
  });

  it('says "retrying now" once the backoff has already elapsed', () => {
    render(<PrKeycap pr={pr({ phase: 'unknown', reason: 'rate-limit', retryAt: Date.now() - 60_000 })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/retrying now/i);
  });
});

// Every REASON_TEXT entry, individually — the brief's own tests exercise only
// 'unauthenticated' and 'rate-limit' by wording; the rest ship with no
// assertion on their actual copy, which is exactly the shape of survivor
// CONSTRAINTS.md warns about (a shipped string whose removal leaves the suite
// green).
describe('every reason under unknown carries its own sentence', () => {
  it.each([
    ['timeout', /did not answer in time/i],
    ['offline', /could not reach github/i],
    ['unauthenticated', /isn.t logged in/i],
    ['rate-limit', /rate-limiting/i],
    ['no-remote', /no `origin` remote/i],
    ['unsupported', /does not have this verb yet/i],
    ['agent-down', /could not reach the sessions box/i],
    ['error', /could not be read/i],
    ['merge-unproven', /named no usable merge commit/i],
    // The two that split off `error`. Their whole purpose is to say something
    // "GitHub could not be read." could not, so the assertion is on the part
    // that differs: one blames GitHub's server, the other says the answer was
    // cut off and ccrc will retry. Wording either of them back into the
    // catch-all's sentence is a red here.
    ['unavailable', /server error/i],
    ['truncated', /cut off/i],
  ] as const)('%s', (reason, re) => {
    render(<PrKeycap pr={pr({ phase: 'unknown', reason })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(re);
  });
});

// checkText's four branches, and both phases it decorates (open AND draft) —
// the brief's own tests only pin 'fail' via the loose /checks failing/i.
describe('CI text accompanies open and draft phases', () => {
  it.each([
    ['pass', /checks passing/i],
    ['pending', /checks running/i],
    [null, /no checks configured/i],
  ] as const)('checks=%s reads its own line', (checks, re) => {
    render(<PrKeycap pr={pr({ phase: 'open', checks })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(re);
  });

  it('names the failing checks when ccd reported them', () => {
    render(<PrKeycap pr={pr({ phase: 'open', checks: 'fail', checkNames: ['lint', 'unit'] })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/checks failing: lint, unit/i);
  });

  it('says plain "checks failing" with no trailing colon when no names are known', () => {
    render(<PrKeycap pr={pr({ phase: 'open', checks: 'fail', checkNames: null })} onOpen={() => {}} />);
    const label = screen.getByRole('button').getAttribute('aria-label')!;
    expect(label).toMatch(/checks failing\./i);
    expect(label).not.toMatch(/checks failing:/i);
  });

  it('applies the same check text to a draft PR', () => {
    render(<PrKeycap pr={pr({ phase: 'draft', checks: 'pass' })} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/checks passing/i);
  });
});
