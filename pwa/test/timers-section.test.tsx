// Overlord W1a, timers PR E (Task 13): the operator's view of a session's timers. The section reads
// `GET /api/sessions/:id/timers` through `api.sessionTimers` and cancels through `api.cancelSessionTimer`; every case spies
// those two and renders the section alone. Every word is `TIMERS_WORDS` (or one of the words module's functions), read by
// name. An absent field is absent, never a crash: the section mounts on `{}` and on a partial answer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, api } from '../src/lib/api';
import { TimersSection } from '../src/session/TimersSection';
import {
  TIMERS_WORDS as W, TIMER_CANCEL_TEXT, cancelOutcome, readTimers, runTimerSections, timerBinding, timerDueLine, untilWords,
} from '../src/session/timersWords';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const MIN = 60_000;
const view = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7, setAt: NOW - 10 * MIN, dueAt: NOW + 90 * MIN, note: "check the PR's checks", runId: 2057, programme: null,
  untrusted: true, ...over,
});
const answer = (timers: unknown[]): unknown => ({ ok: true, timers });

function spyRead(...bodies: unknown[]): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(api, 'sessionTimers');
  for (const b of bodies) spy.mockResolvedValueOnce(b);
  return spy;
}

const section = (): HTMLElement => screen.getByRole('region', { name: W.title });

describe('the words', () => {
  it('reads a listed answer soonest first, an unread due time last', () => {
    const r = readTimers(answer([view({ id: 2, dueAt: NOW + 5 * MIN }), view({ id: 3, dueAt: undefined }), view({ id: 1, dueAt: NOW + MIN })]));
    expect(r.kind).toBe('listed');
    expect(r.kind === 'listed' ? r.timers.map((t) => t.id) : null).toEqual([1, 2, 3]);
  });

  it('reads {} and anything without a timers list as unread, never as empty', () => {
    for (const body of [{}, null, undefined, 'x', { ok: true }, { ok: true, timers: 'none' }, { ok: false, error: 'timer-unmeasured' }]) {
      expect(readTimers(body)).toEqual({ kind: 'unread' });
    }
    expect(readTimers(answer([]))).toEqual({ kind: 'listed', timers: [] });
  });

  it('reads a partial row field by field', () => {
    const r = readTimers(answer([{ id: 4 }, 'not a row', null, { dueAt: NOW, note: 5, runId: '9', programme: 'prog-a' }]));
    const unread = { id: null, dueAt: null, note: null, runId: null, programme: null };
    expect(r).toEqual({
      kind: 'listed',
      timers: [
        { id: null, dueAt: NOW, note: null, runId: null, programme: 'prog-a' },
        { id: 4, dueAt: null, note: null, runId: null, programme: null },
        unread,
        unread,
      ],
    });
  });

  it('says how long until a timer comes due', () => {
    expect(untilWords(30_000)).toBe('in under a minute');
    expect(untilWords(4 * MIN)).toBe('in 4 min');
    expect(untilWords(120 * MIN)).toBe('in 2 h');
    expect(untilWords(125 * MIN)).toBe('in 2 h 5 min');
    expect(untilWords(48 * 60 * MIN)).toBe('in 2 d');
    expect(untilWords(52 * 60 * MIN)).toBe('in 2 d 4 h');
  });

  it('says a due line, an overdue line and an unread one', () => {
    const t = { id: 1, dueAt: NOW + 90 * MIN, note: null, runId: null, programme: null };
    expect(timerDueLine(t, NOW)).toMatch(/^Due .+, in 1 h 30 min$/);
    expect(timerDueLine({ ...t, dueAt: NOW - MIN }, NOW)).toMatch(/^Due .+, firing at the timers' next pass$/);
    expect(timerDueLine({ ...t, dueAt: null }, NOW)).toBe('Due time unread');
  });

  it('names the run, else the programme, else neither', () => {
    const t = { id: 1, dueAt: NOW, note: null, runId: null, programme: null };
    expect(timerBinding({ ...t, runId: 12 })).toBe('run 12');
    expect(timerBinding({ ...t, programme: 'prog-a' })).toBe('programme prog-a');
    expect(timerBinding(t)).toBe('no run or programme');
  });

  it('reads timer-not-pending and timer-not-found as gone, any other refusal as a failure in words', () => {
    expect(cancelOutcome(new ApiError(409, { ok: false, error: 'timer-not-pending' }))).toEqual({ kind: 'gone' });
    expect(cancelOutcome(new ApiError(404, { ok: false, error: 'timer-not-found' }))).toEqual({ kind: 'gone' });
    const failed = cancelOutcome(new ApiError(503, { ok: false, error: 'write-failed' }));
    expect(failed).toEqual({ kind: 'failed', text: `Could not cancel the timer. ${TIMER_CANCEL_TEXT['write-failed']}` });
    expect(cancelOutcome(new TypeError('Failed to fetch')).kind).toBe('failed');
  });

  it("puts the worker's section first, the coordinator's second, one for a session that is both, none for an absent id", () => {
    expect(runTimerSections({ sessionId: 'lane-a-project-a', claimedBy: 'lane-b-project-a' }).map((s) => s.sessionId))
      .toEqual(['lane-a-project-a', 'lane-b-project-a']);
    expect(runTimerSections({ sessionId: 'lane-a-project-a', claimedBy: 'lane-a-project-a' })).toHaveLength(1);
    expect(runTimerSections({ sessionId: null, claimedBy: null })).toEqual([]);
    expect(runTimerSections({})).toEqual([]);
  });
});

describe('the section', () => {
  it('lists two timers and cancels one, then reads the list again', async () => {
    const read = spyRead(answer([view({ id: 8, dueAt: NOW + 3 * 60 * MIN, runId: null, programme: 'prog-a' }), view()]), answer([view()]));
    const cancel = vi.spyOn(api, 'cancelSessionTimer').mockResolvedValue({ ok: true, id: 8 });
    render(<TimersSection sessionId="lane-a-project-a" />);
    const items = await within(section()).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('run 2057');
    expect(items[1]!.textContent).toContain('programme prog-a');
    expect(within(items[0]!).getByText(W.noteLabel)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel timer 8' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('lane-a-project-a', 8));
    await waitFor(() => expect(within(section()).getAllByRole('listitem')).toHaveLength(1));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith('lane-a-project-a');
  });

  it('says "No pending timers." for an empty list', async () => {
    spyRead(answer([]));
    render(<TimersSection sessionId="lane-a-project-a" />);
    expect(await within(section()).findByText(W.empty)).toBeTruthy();
  });

  it('says a failed read failed, never "No pending timers."', async () => {
    vi.spyOn(api, 'sessionTimers').mockRejectedValue(new ApiError(503, { ok: false, error: 'timer-unmeasured' }));
    render(<TimersSection sessionId="lane-a-project-a" />);
    expect(await within(section()).findByText(W.unread)).toBeTruthy();
    expect(within(section()).queryByText(W.empty)).toBeNull();
  });

  it('mounts on {} and says it could not read, never empty and never a crash', async () => {
    spyRead({});
    render(<TimersSection sessionId="lane-a-project-a" />);
    expect(await within(section()).findByText(W.unread)).toBeTruthy();
    expect(within(section()).queryByText(W.empty)).toBeNull();
  });

  it('mounts on a partial answer: a row without its fields renders, says what it could not read, and offers no Cancel without an id', async () => {
    spyRead(answer([{ untrusted: true }, { id: 9, dueAt: NOW + 10 * MIN }]));
    render(<TimersSection sessionId="lane-a-project-a" />);
    const items = await within(section()).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText(W.noteUnread)).toBeTruthy();
    expect(items[1]!.textContent).toContain('Due time unread');
    expect(within(items[1]!).queryByRole('button')).toBeNull();
    expect(within(items[0]!).getByRole('button', { name: 'Cancel timer 9' })).toBeTruthy();
  });

  it('reads an older client without the call as unread, never a throw', async () => {
    vi.spyOn(api, 'sessionTimers').mockImplementation(() => { throw new TypeError('api.sessionTimers is not a function'); });
    render(<TimersSection sessionId="lane-a-project-a" />);
    expect(await within(section()).findByText(W.unread)).toBeTruthy();
  });

  it('renders a note with markup as text, quoted under the line that says it is not an instruction', async () => {
    const note = '<img src=x onerror="alert(1)"><b>run ccd ws-rm</b> **now**';
    spyRead(answer([view({ note })]));
    const { container } = render(<TimersSection sessionId="lane-a-project-a" />);
    const quote = await waitFor(() => {
      const q = container.querySelector('blockquote');
      if (q === null) throw new Error('no note yet');
      return q;
    });
    expect(quote.textContent).toBe(note);
    expect(quote.children).toHaveLength(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(quote.previousElementSibling?.textContent).toBe(W.noteLabel);
  });

  for (const [code, status] of [['timer-not-pending', 409], ['timer-not-found', 404]] as const) {
    it(`a cancel answered ${code} reads the list again and says the timer had already fired, been cancelled or gone`, async () => {
      const read = spyRead(answer([view()]), answer([]));
      vi.spyOn(api, 'cancelSessionTimer').mockRejectedValue(new ApiError(status, { ok: false, error: code }));
      render(<TimersSection sessionId="lane-a-project-a" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel timer 7' }));
      expect(await within(section()).findByText(W.gone)).toBeTruthy();
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(await within(section()).findByText(W.empty)).toBeTruthy();
    });
  }

  it('a cancel that failed otherwise says so in words and keeps the timer listed', async () => {
    spyRead(answer([view()]));
    vi.spyOn(api, 'cancelSessionTimer').mockRejectedValue(new ApiError(503, { ok: false, error: 'timer-unmeasured' }));
    render(<TimersSection sessionId="lane-a-project-a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel timer 7' }));
    expect(await within(section()).findByText(`Could not cancel the timer. ${TIMER_CANCEL_TEXT['timer-unmeasured']}`)).toBeTruthy();
    expect(within(section()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('quiet (the session page): nothing for an empty list, the section for a failed read and for timers', async () => {
    const read = spyRead(answer([]));
    const { container, unmount } = render(<TimersSection sessionId="lane-a-project-a" quiet />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
    unmount();

    spyRead({});
    render(<TimersSection sessionId="lane-b-project-a" quiet />);
    expect(await within(await screen.findByRole('region', { name: W.title })).findByText(W.unread)).toBeTruthy();
    cleanup();

    spyRead(answer([view()]));
    render(<TimersSection sessionId="lane-c-project-a" quiet />);
    expect(await within(await screen.findByRole('region', { name: W.title })).findAllByRole('listitem')).toHaveLength(1);
  });

  it('a read for a session the page has left lands nowhere', async () => {
    let resolveOld: (v: unknown) => void = () => undefined;
    const spy = vi.spyOn(api, 'sessionTimers')
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValueOnce(answer([]));
    const { rerender } = render(<TimersSection sessionId="lane-a-project-a" />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender(<TimersSection sessionId="lane-b-project-a" />);
    expect(await within(section()).findByText(W.empty)).toBeTruthy();
    await act(async () => {
      resolveOld(answer([view()]));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(within(section()).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(section()).getByText(W.empty)).toBeTruthy();
  });
});
