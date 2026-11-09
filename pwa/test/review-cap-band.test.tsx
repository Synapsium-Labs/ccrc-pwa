// D-6911: the run board's "Waiting on you" band for the review cap. TDD red-first.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { CoordLiftRecord, ReviewCapStatus, RunSummary } from '../../shared/api';
import { ReviewCapBand } from '../src/fleet/ReviewCapBand';
import { NOW, MIN, run } from './rollupFixture';

afterEach(() => { cleanup(); });

const cap = (over: Partial<ReviewCapStatus> = {}): ReviewCapStatus =>
  ({ rounds: 3, cap: 3, askedAt: NOW - 30 * MIN, liftedAt: null, granted: 0, askHandledAt: null, coordLift: null, ...over });
const waiting = run(12, 'coord', 'w-12', { programTitle: 'Port the API', wave: 2, reviewCap: cap() });
const lifted = run(14, 'coord', 'w-14', { reviewCap: cap({ liftedAt: NOW - 5 * MIN }) });
const closed = run(16, 'coord', 'w-16', { state: 'done', reviewCap: cap() });
const review = run(18, 'coord', 'r-18', { kind: 'review', reviews: 12 });
const older = (): RunSummary => {
  const r: Partial<RunSummary> = { ...run(20, 'coord', 'w-20') };
  delete r.reviewCap;
  return r as RunSummary;
};

describe('ReviewCapBand', () => {
  it('lists a waiting run and a lifted one, and nothing for a closed run, a review run or an unmeasured cap', () => {
    render(<ReviewCapBand runs={[waiting, lifted, closed, review, older()]} nowMs={NOW} onLift={() => {}} />);
    const band = screen.getByRole('group', { name: /waiting on you/i });
    expect(within(band).getByText('Waiting on you')).toBeInTheDocument();
    const rows = within(band).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Run 12 · Port the API wave 2: review cap reached, 3 of 3 rounds');
    expect(within(rows[0]!).getByRole('button', { name: /lift cap/i })).toBeInTheDocument();
    expect(rows[1]!.textContent).toContain('Run 14: review cap lifted 5m ago');
    expect(within(rows[1]!).queryByRole('button')).toBeNull();
  });

  it('Lift cap hands the run to onLift', () => {
    const onLift = vi.fn();
    render(<ReviewCapBand runs={[waiting]} nowMs={NOW} onLift={onLift} />);
    fireEvent.click(screen.getByRole('button', { name: /lift cap/i }));
    expect(onLift).toHaveBeenCalledWith(waiting);
  });

  it('renders nothing when no run is waiting or lifted', () => {
    const { container } = render(<ReviewCapBand runs={[closed, review, older()]} nowMs={NOW} onLift={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('ReviewCapBand, a cap its coordinator lifted (D-8125)', () => {
  const lift: CoordLiftRecord = { at: NOW - MIN, by: 'coord-a', reason: 'two major findings, converging', rounds: 3, capBefore: 3, capAfter: 6, count: 1 };
  const handled = run(22, 'coord', 'w-22', { reviewCap: cap({ cap: 6, granted: 3, askHandledAt: NOW - MIN, coordLift: lift }) });

  it('is not an action: a cap its coordinator lifted never sits under Waiting on you (the run page shows it)', () => {
    const { container } = render(<ReviewCapBand runs={[handled]} nowMs={NOW} onLift={() => {}} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('group', { name: /waiting on you/i })).toBeNull();
  });

  it('beside a run that does wait, only the waiting run is listed', () => {
    const waiting = run(23, 'coord', 'w-23', { reviewCap: cap({ rounds: 3, cap: 3 }) });
    render(<ReviewCapBand runs={[handled, waiting]} nowMs={NOW} onLift={() => {}} />);
    const rows = within(screen.getByRole('group', { name: /waiting on you/i })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Run 23');
  });
});
