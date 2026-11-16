// Overlord W1, answer marks (plan w1-delegation-marks.md Task 4): the two boxes, optimistic on a tap, settled by the door's
// answer (F14) and rolled back on any refusal or failure. `api.setAnswerMark` is stubbed; the storage is a memory store.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnswerMarkView, AnswerMarksView } from '../../shared/answerMarks';
import { ApiError, api } from '../src/lib/api';
import { memoryStorage, type StoragePort } from '../src/lib/storage';
import { AnswerMarkBoxes } from '../src/ledgers/AnswerMarkBox';
import { ANSWER_MARK_EXPLAINER, ANSWER_MARK_LABEL, TASK_COULD_HANDLE_LABEL } from '../src/ledgers/answerMarkWords';
import { LEDGER_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { NOW, MIN } from './ledgersFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NEVER: AnswerMarkView = { state: 'never' };
const marks = (o: Partial<AnswerMarksView> = {}): AnswerMarksView => ({ couldAnswer: NEVER, unsure: NEVER, ...o });
const box = (name: 'could-answer' | 'unsure') => screen.getByLabelText(ANSWER_MARK_LABEL[name]) as HTMLInputElement;
const deferred = <T,>() => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
type Answer = Awaited<ReturnType<typeof api.setAnswerMark>>;
const store = (): (() => StoragePort) => { const s = memoryStorage(); return () => s; };

const draw = (m: AnswerMarksView | undefined, o: { current?: boolean; storage?: () => StoragePort | null; kind?: string } = {}) => {
  const storage = o.storage ?? store();
  const ui = (v: AnswerMarksView | undefined) => (
    <AnswerMarkBoxes
      item={{ id: 7, ...(o.kind === undefined ? {} : { kind: o.kind }), ...(v === undefined ? {} : { answerMarks: v }) }}
      current={o.current ?? true} storage={storage}
    />
  );
  const r = render(ui(m));
  return { rerender: (v: AnswerMarksView | undefined) => r.rerender(ui(v)) };
};

describe('the answer-mark boxes', () => {
  it('draw nothing when the field is absent (an older server)', () => {
    draw(undefined);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a tap checks the box at once and disables it while the call is pending', async () => {
    const call = deferred<Answer>();
    const spy = vi.spyOn(api, 'setAnswerMark').mockReturnValue(call.promise);
    draw(marks());
    fireEvent.click(box('could-answer'));
    expect(spy).toHaveBeenCalledWith('item', 7, 'could-answer', true);
    expect(box('could-answer').checked).toBe(true);
    expect(box('could-answer').disabled).toBe(true);
    await act(async () => { call.resolve({ ok: true, mark: 'could-answer', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } }); });
  });

  it('a resolved call leaves it checked, and a later view carrying marked keeps it checked and enabled', async () => {
    vi.spyOn(api, 'setAnswerMark').mockResolvedValue({ ok: true, mark: 'could-answer', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } });
    const d = draw(marks());
    await act(async () => { fireEvent.click(box('could-answer')); });
    expect(box('could-answer').checked).toBe(true);
    expect(box('could-answer').disabled).toBe(false);
    d.rerender(marks({ couldAnswer: { state: 'marked', id: 5, at: NOW, signedIn: true } }));
    expect(box('could-answer').checked).toBe(true);
    expect(box('could-answer').disabled).toBe(false);
  });

  it('a view frame older than the resolved answer does not uncheck the box (F14)', async () => {
    vi.spyOn(api, 'setAnswerMark').mockResolvedValue({ ok: true, mark: 'unsure', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } });
    const d = draw(marks({ unsure: { state: 'withdrawn', id: 3, at: NOW - 2 * MIN, signedIn: true } }));
    await act(async () => { fireEvent.click(box('unsure')); });
    d.rerender(marks({ unsure: { state: 'withdrawn', id: 3, at: NOW - 2 * MIN, signedIn: true } }));
    expect(box('unsure').checked).toBe(true);
    d.rerender(marks());
    expect(box('unsure').checked).toBe(true);
    // A newer view wins: the mark was withdrawn elsewhere after this tap.
    d.rerender(marks({ unsure: { state: 'withdrawn', id: 6, at: NOW + MIN, signedIn: true } }));
    expect(box('unsure').checked).toBe(false);
  });

  it('a rejected call with not-markable unchecks it again and shows the sentence', async () => {
    vi.spyOn(api, 'setAnswerMark').mockRejectedValue(new ApiError(409, { ok: false, error: 'not-markable', detail: 'past-window' }));
    draw(marks());
    await act(async () => { fireEvent.click(box('could-answer')); });
    expect(box('could-answer').checked).toBe(false);
    expect(box('could-answer').disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe(LEDGER_REFUSAL_TEXT['not-markable']);
  });

  it('a rejected network call unchecks it again', async () => {
    vi.spyOn(api, 'setAnswerMark').mockRejectedValue(new TypeError('Failed to fetch'));
    draw(marks({ couldAnswer: { state: 'marked', id: 5, at: NOW, signedIn: true } }));
    await act(async () => { fireEvent.click(box('could-answer')); });
    expect(box('could-answer').checked).toBe(true);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('ticking unsure sends mark unsure and leaves the could-answer box as it was', async () => {
    const spy = vi.spyOn(api, 'setAnswerMark').mockResolvedValue({ ok: true, mark: 'unsure', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } });
    draw(marks({ couldAnswer: { state: 'marked', id: 4, at: NOW - MIN, signedIn: true } }));
    await act(async () => { fireEvent.click(box('unsure')); });
    expect(spy).toHaveBeenCalledWith('item', 7, 'unsure', true);
    expect(box('could-answer').checked).toBe(true);
    expect(box('unsure').checked).toBe(true);
  });

  it('an unmeasured mark is a disabled box with a short reason', () => {
    draw(marks({ unsure: { state: 'unmeasured', detail: 'x' } }));
    expect(box('unsure').disabled).toBe(true);
    expect(screen.getByText('Could not read this mark')).toBeTruthy();
    expect(box('could-answer').disabled).toBe(false);
  });

  it('a page that is not current disables both boxes', () => {
    draw(marks(), { current: false });
    expect(box('could-answer').disabled).toBe(true);
    expect(box('unsure').disabled).toBe(true);
  });

  it('the explainer shows on the first use on this device and not on the second', async () => {
    vi.spyOn(api, 'setAnswerMark').mockResolvedValue({ ok: true, mark: 'unsure', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } });
    const storage = store();
    draw(marks(), { storage });
    expect(screen.queryByText(ANSWER_MARK_EXPLAINER)).toBeNull();
    await act(async () => { fireEvent.click(box('unsure')); });
    expect(screen.getByText(ANSWER_MARK_EXPLAINER)).toBeTruthy();
    cleanup();
    draw(marks(), { storage });
    await act(async () => { fireEvent.click(box('could-answer')); });
    expect(screen.queryByText(ANSWER_MARK_EXPLAINER)).toBeNull();
  });

  // Answer marks C (#2900): a task draws one box, worded for a task, with the same tick, settle and rollback.
  describe('on a do item', () => {
    const task = () => screen.getByLabelText(TASK_COULD_HANDLE_LABEL) as HTMLInputElement;

    it('draws one box, "The Overlord could handle this", and no unsure box', () => {
      draw({ couldAnswer: NEVER }, { kind: 'do' });
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      expect(task().checked).toBe(false);
      expect(screen.queryByLabelText(ANSWER_MARK_LABEL['could-answer'])).toBeNull();
      expect(screen.queryByLabelText(ANSWER_MARK_LABEL.unsure)).toBeNull();
    });

    it('a tap sends could-answer on the item, checks at once, and settles by the record id', async () => {
      const call = deferred<Answer>();
      const spy = vi.spyOn(api, 'setAnswerMark').mockReturnValue(call.promise);
      const d = draw({ couldAnswer: NEVER }, { kind: 'do' });
      fireEvent.click(task());
      expect(spy).toHaveBeenCalledWith('item', 7, 'could-answer', true);
      expect([task().checked, task().disabled]).toEqual([true, true]);
      await act(async () => { call.resolve({ ok: true, mark: 'could-answer', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } }); });
      d.rerender({ couldAnswer: NEVER });
      expect([task().checked, task().disabled]).toEqual([true, false]);
    });

    it('a refusal unchecks it again and shows the sentence', async () => {
      vi.spyOn(api, 'setAnswerMark').mockRejectedValue(new ApiError(409, { ok: false, error: 'not-markable', detail: 'past-window' }));
      draw({ couldAnswer: NEVER }, { kind: 'do' });
      await act(async () => { fireEvent.click(task()); });
      expect(task().checked).toBe(false);
      expect(screen.getByRole('alert').textContent).toBe(LEDGER_REFUSAL_TEXT['not-markable']);
    });

    it('is disabled on a page that is not current, and draws nothing when the field is absent', () => {
      draw({ couldAnswer: NEVER }, { kind: 'do', current: false });
      expect(task().disabled).toBe(true);
      cleanup();
      draw(undefined, { kind: 'do' });
      expect(screen.queryByRole('checkbox')).toBeNull();
    });
  });

  it('a storage that throws changes nothing else: the tap still goes through', async () => {
    const spy = vi.spyOn(api, 'setAnswerMark').mockResolvedValue({ ok: true, mark: 'unsure', answerMark: { state: 'marked', id: 5, at: NOW, signedIn: true } });
    const throwing: StoragePort = {
      getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); },
    } as unknown as StoragePort;
    draw(marks(), { storage: () => throwing });
    await act(async () => { fireEvent.click(box('unsure')); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(box('unsure').checked).toBe(true);
  });
});
