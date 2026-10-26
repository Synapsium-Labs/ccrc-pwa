// D-6911: the run board's "Waiting on you" band for the review cap. TDD red-first.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { ReviewCapStatus, RunSummary } from '../../shared/api';
import { ReviewCapBand } from '../src/fleet/ReviewCapBand';
import { NOW, MIN, run } from './rollupFixture';

afterEach(() => { cleanup(); });

const cap = (over: Partial<ReviewCapStatus> = {}): ReviewCapStatus =>
  ({ rounds: 3, cap: 3, askedAt: NOW - 30 * MIN, liftedAt: null, ...over });
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
