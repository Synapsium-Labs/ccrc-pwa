// D-6911: the sheet that shows a review cap's ask and lifts it, posting only on confirm. TDD red-first.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReviewCapView } from '../../shared/api';
import { LiftCapSheet } from '../src/fleet/LiftCapSheet';
import { ApiError, REVIEW_CAP_REFUSAL_TEXT } from '../src/lib/api';
import { run } from './rollupFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const work = (id = 12) => run(id, 'coord', `w-${id}`, {
  programTitle: 'Port the API', wave: 2, reviewCap: { rounds: 3, cap: 3, askedAt: 1_000, liftedAt: null },
});
const view = (id = 12, summary = '2 findings, 1 needs a ruling'): ReviewCapView => ({
  ok: true, askedAt: 1_000, liftedAt: null,
  ask: { run: id, rounds: 3, cap: 3, lastReview: { reviewRunId: 15, summary, report: null,
    findings: { state: 'read', lines: ['F1 needs a ruling: keep or drop?', 'F2 no case'] } } },
});
const lifted = (id = 12) => ({ ok: true as const, run: id, rounds: 3, cap: 3, lifted: true as const });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('LiftCapSheet', () => {
  it('reads the ask once on open and shows the rounds, the last review and its findings', async () => {
    const loadAsk = vi.fn().mockResolvedValue(view());
    const lift = vi.fn();
    render(<LiftCapSheet run={work()} onClose={() => {}} onDone={() => {}} loadAsk={loadAsk} lift={lift} />);
    expect(await screen.findByText(/3 of 3 review rounds/)).toBeInTheDocument();
    expect(loadAsk).toHaveBeenCalledTimes(1);
    expect(loadAsk).toHaveBeenCalledWith(12);
    expect(screen.getByText(/run 15/i)).toBeInTheDocument();
    expect(screen.getByText(/2 findings, 1 needs a ruling/)).toBeInTheDocument();
    expect(screen.getByText('F1 needs a ruling: keep or drop?')).toBeInTheDocument();
    expect(screen.getByText('F2 no case')).toBeInTheDocument();
    expect(lift).not.toHaveBeenCalled();
  });

  it('Lift cap posts once with the run id, then calls onDone and onClose', async () => {
    const lift = vi.fn().mockResolvedValue(lifted());
    const onDone = vi.fn(); const onClose = vi.fn();
    render(<LiftCapSheet run={work()} onClose={onClose} onDone={onDone} loadAsk={vi.fn().mockResolvedValue(view())} lift={lift} />);
    fireEvent.click(screen.getByRole('button', { name: /^lift cap$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(lift).toHaveBeenCalledTimes(1);
    expect(lift).toHaveBeenCalledWith(12);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Cancel lifts nothing and reports nothing done', async () => {
    const lift = vi.fn(); const onDone = vi.fn(); const onClose = vi.fn();
    render(<LiftCapSheet run={work()} onClose={onClose} onDone={onDone} loadAsk={vi.fn().mockResolvedValue(view())} lift={lift} />);
    await screen.findByText(/3 of 3 review rounds/);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(lift).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    [404, { ok: false, error: 'not-found' }, REVIEW_CAP_REFUSAL_TEXT['not-found']],
    [400, { ok: false, error: 'bad-request' }, REVIEW_CAP_REFUSAL_TEXT['bad-request']],
    [501, { ok: false, error: 'not-configured' }, REVIEW_CAP_REFUSAL_TEXT['not-configured']],
  ])('a %i from the lift is said in its table word, and the sheet stays open', async (status, body, words) => {
    const lift = vi.fn().mockRejectedValue(new ApiError(status, body));
    const onClose = vi.fn(); const onDone = vi.fn();
    render(<LiftCapSheet run={work()} onClose={onClose} onDone={onDone} loadAsk={vi.fn().mockResolvedValue(view())} lift={lift} />);
    fireEvent.click(screen.getByRole('button', { name: /^lift cap$/i }));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^lift cap$/i })).toBeEnabled();
  });

  it('a refused read of the ask says the refusal\'s table word', async () => {
    const loadAsk = vi.fn().mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<LiftCapSheet run={work()} onClose={() => {}} onDone={() => {}} loadAsk={loadAsk} lift={vi.fn()} />);
    expect(await screen.findByText(/the ask could not be read/i)).toHaveTextContent(REVIEW_CAP_REFUSAL_TEXT['not-found']);
  });

  it('a 503 run-unreadable from the read of the ask says its table word, and still offers the lift (D-6912)', async () => {
    const loadAsk = vi.fn().mockRejectedValue(new ApiError(503, { ok: false, error: 'run-unreadable' }));
    render(<LiftCapSheet run={work()} onClose={() => {}} onDone={() => {}} loadAsk={loadAsk} lift={vi.fn()} />);
    expect(await screen.findByText(/the ask could not be read/i)).toHaveTextContent(REVIEW_CAP_REFUSAL_TEXT['run-unreadable']);
    expect(screen.getByRole('button', { name: /^lift cap$/i })).toBeEnabled();
  });

  it('a failed read of the ask says so, and still offers the lift: the lift does not need the ask', async () => {
    const lift = vi.fn().mockResolvedValue(lifted());
    const onClose = vi.fn();
    render(<LiftCapSheet run={work()} onClose={onClose} onDone={() => {}} loadAsk={vi.fn().mockRejectedValue(new ApiError(503, {}))} lift={lift} />);
    expect(await screen.findByText(/the ask could not be read/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^lift cap$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(lift).toHaveBeenCalledWith(12);
  });

  it('a second lift (another tab got there first) answers 200 and closes cleanly', async () => {
    const lift = vi.fn().mockResolvedValue(lifted());
    const onClose = vi.fn(); const onDone = vi.fn();
    const already = { ...view(), liftedAt: 2_000 };
    render(<LiftCapSheet run={work()} onClose={onClose} onDone={onDone} loadAsk={vi.fn().mockResolvedValue(already)} lift={lift} />);
    await screen.findByText(/3 of 3 review rounds/);
    fireEvent.click(screen.getByRole('button', { name: /^lift cap$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.abandon-error')).toBeNull();
  });

  it('an ask that lands after the sheet moved to another run neither renders nor closes it', async () => {
    const first = deferred<ReviewCapView>();
    const loadAsk = vi.fn((id: number) => (id === 12 ? first.promise : Promise.resolve(view(14, 'the second run'))));
    const onClose = vi.fn();
    const { rerender } = render(<LiftCapSheet run={work(12)} onClose={onClose} onDone={() => {}} loadAsk={loadAsk} lift={vi.fn()} />);
    rerender(<LiftCapSheet run={work(14)} onClose={onClose} onDone={() => {}} loadAsk={loadAsk} lift={vi.fn()} />);
    expect(await screen.findByText(/the second run/)).toBeInTheDocument();
    await act(async () => { first.resolve(view(12, 'the first run')); await first.promise; });
    expect(screen.queryByText(/the first run/)).toBeNull();
    expect(screen.getByText(/the second run/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a lift that lands after the sheet moved to another run does not close it', async () => {
    const pending = deferred<ReturnType<typeof lifted>>();
    const lift = vi.fn(() => pending.promise);
    const onClose = vi.fn(); const onDone = vi.fn();
    const loadAsk = vi.fn((id: number) => Promise.resolve(view(id)));
    const { rerender } = render(<LiftCapSheet run={work(12)} onClose={onClose} onDone={onDone} loadAsk={loadAsk} lift={lift} />);
    fireEvent.click(screen.getByRole('button', { name: /^lift cap$/i }));
    rerender(<LiftCapSheet run={work(14)} onClose={onClose} onDone={onDone} loadAsk={loadAsk} lift={lift} />);
    await act(async () => { pending.resolve(lifted(12)); await pending.promise; });
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^lift cap$/i })).toBeEnabled();
  });

  it('renders nothing while closed', () => {
    const loadAsk = vi.fn();
    const { container } = render(<LiftCapSheet run={null} onClose={() => {}} onDone={() => {}} loadAsk={loadAsk} lift={vi.fn()} />);
    expect(container.textContent).toBe('');
    expect(loadAsk).not.toHaveBeenCalled();
  });
});
