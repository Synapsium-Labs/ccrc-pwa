// Landing order wave 5k, Task 7: `LandingLine` (`fleet/LandingLine.tsx`, L4), one project's line on its card: the block,
// the pause control, the sheet that outlives the block (F1), and where focus goes (m7, R6). The doors are fakes passed as
// props; the card's section is a stand-in that holds the fallback ref.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '../src/lib/apiError';
import { LandingLine, type LandingPauser } from '../src/fleet/LandingLine';
import type { LandingWithdrawer } from '../src/fleet/LandingWithdrawSheet';
import type { LandingCardState } from '../src/fleet/landingLineView';
import { LANDING_ROUTE_WORDS, SHEET_DONE, SHEET_GONE, STALE_PREFIX } from '../src/fleet/landingWords';
import { E101, E104, NONE, P, deferred, e, lineView, onlyView, pausedEmpty, stateOf, withdrawn } from './landingLineFixture';

afterEach(cleanup);
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

function Card({ state, onReload, pause, withdraw }: {
  state: LandingCardState; onReload?: () => void; pause?: LandingPauser; withdraw?: LandingWithdrawer;
}): ReactNode {
  const ref = useRef<HTMLElement>(null);
  return (
    <section ref={ref} tabIndex={-1} data-testid="card" aria-label="the card">
      <LandingLine project={P} state={state} onReload={onReload} focusFallback={ref} pause={pause} withdraw={withdraw} />
      <button type="button">elsewhere</button>
    </section>
  );
}
const region = (): HTMLElement => screen.getByRole('region', { name: `Landing line of ${P}` });
const pauseButton = (label: string): HTMLElement => screen.getByRole('button', { name: `${label} for ${P}` });
const withdrawButton = (pr: number): HTMLElement => screen.getByRole('button', { name: `Withdraw #${pr} from ${P}'s landing line` });
const never = (): Promise<never> => new Promise(() => {});

describe('the block', () => {
  it('none renders nothing', () => {
    render(<Card state={NONE} />);
    expect(screen.queryByRole('region', { name: `Landing line of ${P}` })).toBeNull();
    expect(screen.getByTestId('card').querySelector('.landing-line')).toBeNull();
  });

  it('a line renders the named region, the status, each row, the chips, and a Withdraw on every row, the set-aside one too', () => {
    const view = lineView({ entries: [E101, e(102, { state: 'ejected', ejectionKind: 'new-head' }), E104, e(107, { afterIds: [1003] }), e(109, { state: 'unknown' }), e(110, { runId: null })] });
    render(<Card state={stateOf(view)} />);
    const r = region();
    expect(within(r).getByRole('status').textContent).toBe('Next to land: #101.');
    expect(within(r).getByText('Landing line')).toBeTruthy();
    const rows = [...r.querySelectorAll('.landing-line-row')].map((li) => li.querySelector('.landing-line-pr')!.textContent + ' ' + li.querySelector('.landing-line-role > span')!.textContent);
    expect(rows).toEqual([
      '#101 next to land', '#104 in line', '#107 waits on #103 (withdrawn)', '#102 sent back for a fix round (its head moved)',
      '#109 set aside: its record does not read as a current pin, so it is not in the order', '#110 in line']);
    const row = (pr: number): HTMLElement => withdrawButton(pr).closest('li')!;
    expect(within(row(101)).getByText('fixes main')).toBeTruthy();
    expect(within(row(110)).getByText('no run')).toBeTruthy();
    expect(within(row(104)).queryByText('fixes main')).toBeNull();
    for (const pr of [101, 104, 107, 102, 109, 110]) expect(withdrawButton(pr).textContent).toBe('Withdraw…');
    expect(pauseButton('Pause line').textContent).toBe('Pause line');
    expect(r.textContent).not.toContain(STALE_PREFIX);
  });

  it('a stale line shows the prefix and the failure under the status', () => {
    const prev = stateOf(lineView());
    const stale: LandingCardState = prev.kind === 'line'
      ? { ...prev, stale: { text: LANDING_ROUTE_WORDS['landing-fenced'].text, scope: 'box', outcomeUnknown: false } } : prev;
    render(<Card state={stale} />);
    expect(region().textContent).toContain(`Not read again: ${LANDING_ROUTE_WORDS['landing-fenced'].text}`);
  });

  it('with no onReload prop a tap and its answer do not throw (F12)', async () => {
    const pause = vi.fn<LandingPauser>(() => Promise.resolve({ ok: true, project: P, operatorPaused: true, changed: true, seq: 1 }));
    render(<Card state={stateOf(lineView())} pause={pause} />);
    fireEvent.click(pauseButton('Pause line'));
    await flush();
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

describe('the pause control', () => {
  it('Pause sends true once, shows the busy label, re-reads on the answer, and keeps its label until a read changes it', async () => {
    const d = deferred<{ ok: true; project: string; operatorPaused: boolean; changed: boolean; seq: number | null }>();
    const pause = vi.fn<LandingPauser>(() => d.promise);
    const onReload = vi.fn();
    const { rerender } = render(<Card state={stateOf(lineView())} pause={pause} onReload={onReload} />);
    fireEvent.click(pauseButton('Pause line'));
    expect(pause.mock.calls).toEqual([[P, true]]);
    expect(pauseButton('Pausing…').textContent).toBe('Pausing…');
    fireEvent.click(pauseButton('Pausing…'));   // a second tap while busy sends nothing
    expect(pause).toHaveBeenCalledTimes(1);
    expect((pauseButton('Pausing…') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { d.resolve({ ok: true, project: P, operatorPaused: true, changed: true, seq: 3 }); });
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(pauseButton('Pause line').textContent).toBe('Pause line');
    rerender(<Card state={stateOf(lineView({ operatorPaused: true }, { paused: true, by: ['operator'], head: undefined } as never))} pause={pause} onReload={onReload} />);
    expect(pauseButton('Resume line').textContent).toBe('Resume line');
    fireEvent.click(pauseButton('Resume line'));
    expect(pause.mock.calls.at(-1)).toEqual([P, false]);
  });

  it('a refusal shows its sentence in an alert, never a changed label, and re-reads', async () => {
    const pause = vi.fn<LandingPauser>(() => Promise.reject(new ApiError(404, { ok: false, error: 'landing-project-unknown' })));
    const onReload = vi.fn();
    render(<Card state={stateOf(pausedEmpty())} pause={pause} onReload={onReload} />);
    fireEvent.click(pauseButton('Resume line'));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-project-unknown'].text);
    expect(pauseButton('Resume line').textContent).toBe('Resume line');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('unmounting before the answer lands calls nothing', async () => {
    const d = deferred<never>();
    const onReload = vi.fn();
    const { unmount } = render(<Card state={stateOf(lineView())} pause={() => d.promise} onReload={onReload} />);
    fireEvent.click(pauseButton('Pause line'));
    unmount();
    await act(async () => { d.reject(new Error('late')); });
    await flush();
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe('the sheet outlives the line (F1)', () => {
  const one = onlyView([E104]);
  it('a withdrawal of the only entry: the sheet keeps its answer after the re-read empties the line; Done leaves nothing, focus on the card', async () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => Promise.resolve(withdrawn(E104, [{ word: 'landing-withdrawn', entryId: 1004, kind: 'queued', toId: 'lane-a-project-a', mailId: 1, deliveryId: 2 }])));
    const onReload = vi.fn();
    const { rerender } = render(<Card state={stateOf(one)} withdraw={withdraw} onReload={onReload} />);
    fireEvent.click(withdrawButton(104));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    await flush();
    expect(withdraw.mock.calls).toEqual([[P, 104, 1104]]);
    rerender(<Card state={NONE} withdraw={withdraw} onReload={onReload} />);
    const dialog = screen.getByRole('dialog', { name: 'Withdraw #104?' });
    expect(dialog.textContent).toContain(SHEET_DONE(104));
    expect(dialog.textContent).toContain('Told lane-a-project-a, its coordinator.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('card').querySelector('.landing-line')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('card'));
  });

  it('landing-entry-terminal on the only entry, then an empty read: the sentence and the gone line stay until closed, confirm off', async () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => Promise.reject(new ApiError(409, { ok: false, error: 'landing-entry-terminal' })));
    const { rerender } = render(<Card state={stateOf(one)} withdraw={withdraw} onReload={() => {}} />);
    fireEvent.click(withdrawButton(104));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    await flush();
    rerender(<Card state={NONE} withdraw={withdraw} onReload={() => {}} />);
    await flush();
    const dialog = screen.getByRole('dialog', { name: 'Withdraw #104?' });
    expect(within(dialog).getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-entry-terminal'].text);
    expect(dialog.textContent).toContain(SHEET_GONE(104));
    expect((within(dialog).getByRole('button', { name: 'Withdraw #104' }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.textContent).not.toContain('Withdrawn:');
  });

  it('a refusal followed by an empty read keeps its sentence', async () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => Promise.reject(new ApiError(409, { ok: false, error: 'landing-recovery-unresolved' })));
    const { rerender } = render(<Card state={stateOf(one)} withdraw={withdraw} onReload={() => {}} />);
    fireEvent.click(withdrawButton(104));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    await flush();
    rerender(<Card state={NONE} withdraw={withdraw} onReload={() => {}} />);
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-recovery-unresolved'].text);
  });
});

describe('focus on close (m7, R6)', () => {
  const withoutRow = lineView({ entries: [e(101, { fixesMain: true }), e(102, { state: 'ejected', ejectionKind: 'new-head' }), e(107, { afterIds: [1003] }), e(109, { state: 'unknown' })] },
    { order: [E101, e(107, { afterIds: [1003] })] });
  const open = (pr: number): void => { withdrawButton(pr).focus(); fireEvent.click(withdrawButton(pr)); };
  const cancel = async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); await flush(); };

  it('Cancel with the row still drawn: its Withdraw', async () => {
    render(<Card state={stateOf(lineView())} withdraw={never} />);
    open(104);
    await cancel();
    expect(document.activeElement).toBe(withdrawButton(104));
  });
  it('Cancel with the row gone and the block drawn: the pause button', async () => {
    const { rerender } = render(<Card state={stateOf(lineView())} withdraw={never} />);
    open(104);
    rerender(<Card state={stateOf(withoutRow)} withdraw={never} />);
    await cancel();
    expect(document.activeElement).toBe(pauseButton('Pause line'));
  });
  it('Cancel with the block gone: the card', async () => {
    const { rerender } = render(<Card state={stateOf(lineView())} withdraw={never} />);
    open(104);
    rerender(<Card state={NONE} withdraw={never} />);
    await cancel();
    expect(document.activeElement).toBe(screen.getByTestId('card'));
  });
  it('Done after the re-read removed the row: the pause button', async () => {
    const { rerender } = render(<Card state={stateOf(lineView())} withdraw={() => Promise.resolve(withdrawn(E104))} onReload={() => {}} />);
    open(104);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    await flush();
    rerender(<Card state={stateOf(withoutRow)} withdraw={never} onReload={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await flush();
    expect(document.activeElement).toBe(pauseButton('Pause line'));
  });
  it('Done before the re-read lands: the pause button, and still the pause button once the re-read removes the row', async () => {
    const { rerender } = render(<Card state={stateOf(lineView())} withdraw={() => Promise.resolve(withdrawn(E104))} onReload={() => {}} />);
    open(104);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await flush();
    expect(document.activeElement).toBe(pauseButton('Pause line'));
    rerender(<Card state={stateOf(withoutRow)} withdraw={never} onReload={() => {}} />);
    await flush();
    expect(document.activeElement).toBe(pauseButton('Pause line'));
  });
});

describe('the block removes itself (R6)', () => {
  it('Resume on a line with no entries, then an empty read: focus on the card', async () => {
    const pause = vi.fn<LandingPauser>(() => Promise.resolve({ ok: true, project: P, operatorPaused: false, changed: true, seq: 2 }));
    const { rerender } = render(<Card state={stateOf(pausedEmpty())} pause={pause} onReload={() => {}} />);
    pauseButton('Resume line').focus();
    fireEvent.click(pauseButton('Resume line'));
    await flush();
    rerender(<Card state={NONE} pause={pause} onReload={() => {}} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId('card'));
  });
  it('the same empty read while focus is outside the block moves no focus', async () => {
    const { rerender } = render(<Card state={stateOf(pausedEmpty())} onReload={() => {}} />);
    pauseButton('Resume line').focus();
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    elsewhere.focus();
    rerender(<Card state={NONE} onReload={() => {}} />);
    await flush();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('accessibility', () => {
  it('the region, the status, every control\'s name, and the sheet is a dialog named by its title', () => {
    render(<Card state={stateOf(lineView())} withdraw={never} />);
    expect(region().getAttribute('aria-label')).toBe(`Landing line of ${P}`);
    expect(within(region()).getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(pauseButton('Pause line')).toBeTruthy();
    fireEvent.click(withdrawButton(104));
    expect(screen.getByRole('dialog', { name: 'Withdraw #104?' })).toBeTruthy();
  });
});
