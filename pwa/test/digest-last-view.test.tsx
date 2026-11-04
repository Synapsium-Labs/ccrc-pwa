// Console speed, task C2 ("the last view kept"; spec 2026-11-04 §2.4): the Digest keeps each day's last answer in the
// screen cache (`src/lib/screenCache.ts`), so a return to the same day draws it at once and re-reads, and a failed
// re-read keeps it beside the error, as the screen already does across a day change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    put(digestKey(DAY), { v: 2, junk: true }, 1);
    render(<DigestScreen day={DAY} load={never} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
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
