// Console speed, task C2 ("the last view kept"; spec 2026-11-04 §2.4): the Digest keeps each day's last answer in the
// screen cache (`src/lib/screenCache.ts`), so a visit to a kept day, on mount or by Previous and Next, draws it at once
// and re-reads, and a failed re-read of that day keeps it beside the error.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DigestAnswer, DigestLine } from '../../shared/api';
import { DigestScreen } from '../src/screens/DigestScreen';
import { digestKey, peek, put } from '../src/lib/screenCache';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const DAY = '2026-10-18';
const line = (id: number, text: string): DigestLine => ({
  rowKind: 'ask', id, kind: 'answer', at: Date.parse('2026-10-17T08:00:00Z') + id * 60_000,
  coordinator: 'project-a-calm-mesa', childId: 'project-a-quiet-basin', text, tool: null, class: null, answer: 'Red',
  reason: null, corrected: false,
} as DigestLine);
const digest = (day: string, text: string): DigestAnswer => ({
  v: 1, day, hourUtc: 7, fromMs: Date.parse(`${day}T07:00:00Z`) - 86_400_000, toMs: Date.parse(`${day}T07:00:00Z`),
  totals: { decisions: 1, answers: 1, allows: 0, denies: 0, handOvers: 0, lapses: 0, guardForbidden: 0 },
  byCoordinator: [{ coordinator: 'project-a-calm-mesa', decisions: 1 }],
  lines: [line(1, text)], sentAt: Date.parse(`${day}T07:00:30Z`), pushed: true,
} as DigestAnswer);

const never = (): Promise<never> => new Promise<never>(() => undefined);
const rowTexts = (): string[] =>
  [...document.querySelectorAll('.digest-row .digest-text')].map((n) => n.textContent ?? '');

/** A first visit to `day` whose read lands, then leave. */
async function firstVisit(day: string | null, answer: DigestAnswer): Promise<void> {
  const r = render(<DigestScreen day={day} load={vi.fn().mockResolvedValue(answer)} />);
  await waitFor(() => expect(rowTexts()).toHaveLength(1));
  r.unmount();
}

describe('the digest keeps its last view (console speed C2)', () => {
  it('a first visit with an empty cache says Loading', () => {
    render(<DigestScreen day={DAY} load={never} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('a second visit to the same day draws the last digest at once', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    const load = vi.fn(never);
    render(<DigestScreen day={DAY} load={load} />);
    // the first render, with the re-read still in flight
    expect(rowTexts()).toEqual(['questionWhich colour?']);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(load).toHaveBeenCalledWith(DAY);
  });

  it('a different day draws nothing cached', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    expect(peek(digestKey('2026-10-19'))).toBeUndefined();   // kept under its own day only
    render(<DigestScreen day="2026-10-19" load={never} />);
    expect(rowTexts()).toEqual([]);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('the server\'s default day is kept apart from every named day', async () => {
    await firstVisit(null, digest(DAY, 'Default day'));
    render(<DigestScreen day={DAY} load={never} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    cleanup();
    render(<DigestScreen day={null} load={never} />);
    expect(rowTexts()).toEqual(['questionDefault day']);
  });

  it('a failed re-read keeps it and says the error beside it', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    render(<DigestScreen day={DAY} load={vi.fn().mockRejectedValue(new TypeError('network down'))} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(rowTexts()).toEqual(['questionWhich colour?']);
    expect(peek(digestKey(DAY))).toBeDefined();
  });

  it('a newer answer replaces the kept one', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    render(<DigestScreen day={DAY} load={vi.fn().mockResolvedValue(digest(DAY, 'Which size?'))} />);
    expect(rowTexts()).toEqual(['questionWhich colour?']);
    await waitFor(() => expect(rowTexts()).toEqual(['questionWhich size?']));
    expect((peek(digestKey(DAY))?.raw as DigestAnswer).lines[0]!.text).toBe('Which size?');
  });

  it('a kept answer the reader refuses draws Loading', () => {
    // a whole answer for this day, but of a version this build cannot read: drawn only through the guard, it is refused
    put(digestKey(DAY), { ...digest(DAY, 'From a newer server'), v: 2 }, 1);
    render(<DigestScreen day={DAY} load={never} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(rowTexts()).toEqual([]);
  });

  it('a correction forgets the kept day, so the next visit never draws the line before it', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    const load = vi.fn().mockImplementationOnce(never);
    const correct = vi.fn().mockResolvedValue({ ok: true, mailId: 9, deliveryId: 11 });
    render(<DigestScreen day={DAY} load={load} correct={correct} />);
    fireEvent.click(screen.getByRole('button', { name: 'Correct ask 1' }));
    const form = screen.getByRole('form', { name: 'Correction for ask 1' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Blue.' } });
    load.mockImplementation(never);
    fireEvent.click(within(form).getByRole('button', { name: 'Send correction' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(peek(digestKey(DAY))).toBeUndefined();
  });
});

// Fix round 1 (review of the C2 tip).
describe('the digest keeps its last view: fix round 1', () => {
  it('a correction forgets every kept answer for the corrected day, the default key included', async () => {
    await firstVisit(null, digest(DAY, 'Which colour?'));
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    await firstVisit('2026-10-17', digest('2026-10-17', 'Another day'));
    const load = vi.fn(never);
    const correct = vi.fn().mockResolvedValue({ ok: true, mailId: 9, deliveryId: 11 });
    // corrected from the named day (a push opens `?day=D`), while the default view's kept answer is for the same day
    render(<DigestScreen day={DAY} load={load} correct={correct} />);
    fireEvent.click(screen.getByRole('button', { name: 'Correct ask 1' }));
    const form = screen.getByRole('form', { name: 'Correction for ask 1' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Blue.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send correction' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(peek(digestKey(null))).toBeUndefined();
    expect(peek(digestKey(DAY))).toBeUndefined();
    expect(peek(digestKey('2026-10-17'))).toBeDefined();   // another day's answer stays
  });

  it('an empty ?day= reads as the default day', async () => {
    expect(digestKey('')).toBe(digestKey(null));
    await firstVisit(null, digest(DAY, 'Default day'));
    const load = vi.fn(never);
    render(<DigestScreen day="" load={load} />);
    expect(rowTexts()).toEqual(['questionDefault day']);
    expect(load).toHaveBeenCalledWith(undefined);
  });

  it('a return to a kept day draws it at once (Previous and Next change the day without a remount)', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    const load = vi.fn(never);
    const r = render(<DigestScreen day="2026-10-19" load={load} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    r.rerender(<DigestScreen day={DAY} load={load} />);
    expect(rowTexts()).toEqual(['questionWhich colour?']);
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('a refused answer after a good one keeps the earlier kept answer', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    render(<DigestScreen day={DAY} load={vi.fn().mockResolvedValue({ v: 2, junk: true })} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect((peek(digestKey(DAY))?.raw as DigestAnswer).lines[0]!.text).toBe('Which colour?');
    expect(rowTexts()).toEqual(['questionWhich colour?']);
  });
});

// Fix round 2 (review of the fix round 1 tip).
describe('the digest keeps its last view: fix round 2', () => {
  it('a correction from the default view forgets the named day too, and another day survives', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    await firstVisit('2026-10-17', digest('2026-10-17', 'Another day'));
    await firstVisit(null, digest(DAY, 'Which colour?'));
    const load = vi.fn(never);
    const correct = vi.fn().mockResolvedValue({ ok: true, mailId: 9, deliveryId: 11 });
    render(<DigestScreen day={null} load={load} correct={correct} />);
    fireEvent.click(screen.getByRole('button', { name: 'Correct ask 1' }));
    const form = screen.getByRole('form', { name: 'Correction for ask 1' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Blue.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send correction' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(peek(digestKey(null))).toBeUndefined();
    expect(peek(digestKey(DAY))).toBeUndefined();
    expect(peek(digestKey('2026-10-17'))).toBeDefined();
  });

  it('a read that started before a correction never keeps its answer, even when it settles before the re-read starts', async () => {
    await firstVisit(DAY, digest(DAY, 'Which colour?'));
    let settleOld: (v: unknown) => void = () => undefined;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { settleOld = r; }))   // the read in flight when Correct is tapped
      .mockImplementation(never);                                           // the correction's re-read never lands
    // The old read settles in the same turn the correction's answer lands, before React has run the effect cleanup
    // that the correction's re-read starts with (the review lens's interleaving).
    const correct = vi.fn(() => Promise.resolve({ ok: true, mailId: 9, deliveryId: 11 })
      .then((a) => { queueMicrotask(() => settleOld(digest(DAY, 'Which colour?'))); return a; }));
    render(<DigestScreen day={DAY} load={load} correct={correct as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Correct ask 1' }));
    const form = screen.getByRole('form', { name: 'Correction for ask 1' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Blue.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send correction' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(peek(digestKey(DAY))).toBeUndefined();   // the pre-correction lines were not put back
  });
});
