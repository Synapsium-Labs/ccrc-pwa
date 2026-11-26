// Landing order wave 5k, Task 7: `LandingWithdrawSheet` (`fleet/LandingWithdrawSheet.tsx`, L4): its words, the pin time it
// sends, its snapshot (R3), its answer and its refusals. The withdraw door is a fake passed as a prop.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LandingLineView } from '../../shared/landingLine';
import { ApiError } from '../src/lib/apiError';
import { LandingWithdrawSheet, type LandingWithdrawer } from '../src/fleet/LandingWithdrawSheet';
import {
  LANDING_ROUTE_WORDS, OUTCOME_UNKNOWN_TAIL, UNKNOWN_WORD_TEXT, UNREACHABLE_WRITE_TEXT,
} from '../src/fleet/landingWords';
import { E101, E104, E107, E109, P, e, lineView, onlyView, withdrawn } from './landingLineFixture';

afterEach(cleanup);
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

const sheet = (view: LandingLineView | null, entryId: number, pr: number, withdraw: LandingWithdrawer, onReload = vi.fn(), onClose = vi.fn()) =>
  <LandingWithdrawSheet project={P} view={view} entryId={entryId} pr={pr} withdraw={withdraw} onReload={onReload} onClose={onClose} />;
const dialog = (pr = 104): HTMLElement => screen.getByRole('dialog', { name: `Withdraw #${pr}?` });
const confirmButton = (pr = 104): HTMLButtonElement => within(dialog(pr)).getByRole('button', { name: `Withdraw #${pr}` }) as HTMLButtonElement;
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => Promise.reject(new ApiError(status, { ok: false, error, ...extra }));
/** #104 re-pinned at 5555 with a new dependant #111. */
const moved = (): LandingLineView => lineView({ entries: [E101, { ...E104, pinnedAt: 5555 }, E107, E109, e(111, { afterIds: [1004] })] });

describe('the confirm phase', () => {
  it('a run-bound entry with one dependant: every sentence, and the confirm sends the read\'s pin time', async () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => new Promise(() => {}));
    render(sheet(lineView(), 1004, 104, withdraw));
    const ps = [...dialog().querySelectorAll('.landing-withdraw-sheet p')].map((p) => p.textContent);
    expect(ps).toEqual([
      '#104 leaves project-a\'s landing line and will not land from it.',
      'Nothing that waits on it is freed. An entry declared after it keeps waiting until a session declares its order again without it, or until it comes back and then lands or is closed.',
      'As this page read the line, these open entries wait on it directly: #107.',
      'After you confirm, the server names everyone it told.',
      'Its coordinator, and the coordinator of each entry that waits on it, are told by mail where one is recorded and reads.',
      'It comes back if its run is pinned at merging again.',
      'It does not stop a merge GitHub has already queued.',
    ]);
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(confirmButton());
    expect(withdraw.mock.calls).toEqual([[P, 104, 1104]]);
    expect(within(dialog()).getByRole('button', { name: 'Withdrawing…' })).toBeTruthy();
  });

  it('a run-less entry with nothing waiting on it', () => {
    render(sheet(onlyView([e(110, { runId: null })]), 1010, 110, vi.fn()));
    const text = dialog(110).textContent!;
    expect(text).toContain('It has no run, so it cannot come back into the line.');
    expect(text).toContain('As this page read the line, no open entry waits on it directly.');
    expect(text).not.toContain('It comes back if its run is pinned at merging again.');
  });

  it('a set-aside row opens with its preview, and its confirm sends that row\'s pin time (R1)', () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => new Promise(() => {}));
    render(sheet(lineView(), 1009, 109, withdraw));
    expect(dialog(109).textContent).toContain('#109 leaves project-a\'s landing line');
    fireEvent.click(confirmButton(109));
    expect(withdraw.mock.calls).toEqual([[P, 109, 1109]]);
  });
});

describe('the snapshot (R3)', () => {
  it('a new view while open changes neither what the sheet shows nor what it sends', () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => new Promise(() => {}));
    const { rerender } = render(sheet(lineView(), 1004, 104, withdraw));
    rerender(sheet(moved(), 1004, 104, withdraw));
    expect(dialog().textContent).toContain('wait on it directly: #107.');
    fireEvent.click(confirmButton());
    expect(withdraw.mock.calls).toEqual([[P, 104, 1104]]);
  });
});

describe('the answer', () => {
  it('Withdrawn, one line per notice, the line about coming back, Done, and one re-read', async () => {
    const onReload = vi.fn();
    const withdraw = vi.fn<LandingWithdrawer>(() => Promise.resolve(withdrawn(E104, [
      { word: 'landing-withdrawn', entryId: 1004, kind: 'queued', toId: 'lane-a-project-a', mailId: 1, deliveryId: 2 },
      { word: 'landing-held', entryId: 1007, kind: 'queued', toId: 'lane-b-project-a', mailId: 3, deliveryId: 4 },
      { word: 'landing-held', entryId: 1099, kind: 'unreadable' },
    ])));
    render(sheet(lineView(), 1004, 104, withdraw, onReload));
    fireEvent.click(confirmButton());
    await flush();
    const d = dialog();
    expect(d.textContent).toContain('Withdrawn: #104 is out of the line. Nothing that waited on it was freed.');
    expect([...d.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Told lane-a-project-a, its coordinator.',
      'Told lane-b-project-a, coordinator of #107, which now waits on it.',
      'Could not tell the coordinator of entry 1099: its run could not be read.',
    ]);
    expect(d.textContent).toContain('It comes back if its run is pinned at merging again.');
    expect(within(d).getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('an answer whose entry has no run says it cannot come back', async () => {
    const runless = e(110, { runId: null });
    render(sheet(onlyView([runless]), 1010, 110, () => Promise.resolve(withdrawn(runless))));
    fireEvent.click(confirmButton(110));
    await flush();
    expect(dialog(110).textContent).toContain('It has no run, so it cannot come back into the line.');
  });
});

describe('the refusals', () => {
  it('landing-entry-moved: stays in confirm, says so, re-reads, adopts the next read with the sentence above, and sends its pin time', async () => {
    const onReload = vi.fn();
    const withdraw = vi.fn<LandingWithdrawer>(() => refuse(409, 'landing-entry-moved'));
    const { rerender } = render(sheet(lineView(), 1004, 104, withdraw, onReload));
    fireEvent.click(confirmButton());
    await flush();
    expect(within(dialog()).getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-entry-moved'].text);
    expect(onReload).toHaveBeenCalledTimes(1);
    rerender(sheet(moved(), 1004, 104, withdraw, onReload));
    await flush();
    expect(dialog().textContent).toContain('wait on it directly: #107, #111.');
    expect(within(dialog()).getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-entry-moved'].text);
    fireEvent.click(confirmButton());
    expect(withdraw.mock.calls.map((c) => c[2])).toEqual([1104, 5555]);
  });

  it('landing-entry-moved then a re-read equal to the snapshot\'s view (the same object) keeps the snapshot and its pin time', async () => {
    const view = lineView();
    const withdraw = vi.fn<LandingWithdrawer>(() => refuse(409, 'landing-entry-moved'));
    const { rerender } = render(sheet(view, 1004, 104, withdraw));
    fireEvent.click(confirmButton());
    await flush();
    rerender(sheet(view, 1004, 104, withdraw));
    await flush();
    fireEvent.click(confirmButton());
    expect(withdraw.mock.calls.map((c) => c[2])).toEqual([1104, 1104]);
  });

  it('a view that was already new when the refusal lands is adopted at once', async () => {
    let fail!: (e: unknown) => void;
    const withdraw = vi.fn<LandingWithdrawer>()
      .mockImplementationOnce(() => new Promise((_res, rej) => { fail = rej; }))
      .mockImplementation(() => new Promise(() => {}));
    const { rerender } = render(sheet(lineView(), 1004, 104, withdraw));
    fireEvent.click(confirmButton());
    rerender(sheet(moved(), 1004, 104, withdraw));
    await act(async () => { fail(new ApiError(409, { ok: false, error: 'landing-entry-moved' })); });
    await flush();
    fireEvent.click(confirmButton());
    expect(withdraw.mock.calls.map((c) => c[2])).toEqual([1104, 5555]);
  });

  it('a refusal after which the next read still holds the entry unchanged keeps the snapshot, the sentence and an enabled confirm (section 11, C2)', async () => {
    const set = lineView();
    const withdraw = vi.fn<LandingWithdrawer>(() => refuse(409, 'landing-entry-terminal'));
    const { rerender } = render(sheet(set, 1009, 109, withdraw));
    fireEvent.click(confirmButton(109));
    await flush();
    rerender(sheet(lineView(), 1009, 109, withdraw));   // a new object, the entry unchanged
    await flush();
    expect(within(dialog(109)).getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-entry-terminal'].text);
    expect(dialog(109).textContent).toContain('#109 leaves project-a\'s landing line');
    expect(confirmButton(109).disabled).toBe(false);
    fireEvent.click(confirmButton(109));
    expect(withdraw.mock.calls.map((c) => c[2])).toEqual([1109, 1109]);
  });

  it('landing-entry-terminal then a read without the entry: the gone line, the confirm off', async () => {
    const withdraw = vi.fn<LandingWithdrawer>(() => refuse(409, 'landing-entry-terminal'));
    const { rerender } = render(sheet(lineView(), 1004, 104, withdraw));
    fireEvent.click(confirmButton());
    await flush();
    rerender(sheet(lineView({ entries: [E101, E107, E109] }), 1004, 104, withdraw));
    await flush();
    expect(dialog().textContent).toContain('#104 is no longer in the line as last read, so there is nothing to withdraw.');
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it('an unknown word at 409 names it, with no tail', async () => {
    render(sheet(lineView(), 1004, 104, () => refuse(409, 'brand-new-word')));
    fireEvent.click(confirmButton());
    await flush();
    expect(within(dialog()).getByRole('alert').textContent).toBe(UNKNOWN_WORD_TEXT('brand-new-word'));
  });

  it('an unreachable server says the outcome is not known', async () => {
    render(sheet(lineView(), 1004, 104, () => Promise.reject(new Error('network'))));
    fireEvent.click(confirmButton());
    await flush();
    expect(within(dialog()).getByRole('alert').textContent).toBe(UNREACHABLE_WRITE_TEXT + OUTCOME_UNKNOWN_TAIL);
  });

  it('a refusal whose body says it may have applied carries the tail', async () => {
    render(sheet(lineView(), 1004, 104, () => refuse(503, 'landing-db-commit', { recovery: 'replay', mayApply: true })));
    fireEvent.click(confirmButton());
    await flush();
    expect(within(dialog()).getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-db-commit'].text + OUTCOME_UNKNOWN_TAIL);
  });

  it.each(['landing-entry-moved', 'landing-entry-terminal', 'landing-recovery-unresolved', 'brand-new-word'])('%s never says Withdrawn', async (word) => {
    render(sheet(lineView(), 1004, 104, () => refuse(409, word)));
    fireEvent.click(confirmButton());
    await flush();
    expect(dialog().textContent).not.toContain('Withdrawn:');
  });
});
