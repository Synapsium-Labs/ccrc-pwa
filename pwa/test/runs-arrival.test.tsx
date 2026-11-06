// Chat reading Task L (D-8062; spec 2026-11-06 R10): a run named in chat opens the board at `/runs?run=<n>`. The board scrolls
// that run's row into view, focuses it and marks it, through `useArrival` (the accounts screen's `?lane=` mechanism), or says the
// run is not among those loaded once both of its sources have answered. Placeholders only: project `project-a`, session `sess-a`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { CoordCapsView, RunSpend, RunSummary, RunsPageAnswer } from '../../shared/api';
import { FINISHED_FOLD, runNotLoadedLine } from '../src/fleet/runWords';
import { navigate } from '../src/lib/router';
import { runsRunHref } from '../src/lib/routes';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { atBlock, declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

beforeEach(() => { navigate('/runs', { replace: true }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'prog-a', programTitle: 'Programme A',
  wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'sess-a', workspace: 'ws-a', branch: 'ws/a',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'sess-coord', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 2 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, ...over,
});
const closed = (id: number, ageMs: number): RunSummary => run(id, { state: 'done', closedAt: Date.now() - ageMs });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});
const NO_SPEND = (): Promise<RunSpend> => new Promise(() => {});

/** One archive read the test settles by hand. */
interface Read { readonly before: number | undefined; resolve(a: RunsPageAnswer): Promise<void> }

/** The board, mounted at `search`, with a live frame of `live` (none: no frame yet) and archive reads the test answers. `held`:
 *  archive pages the store already holds from an earlier mount. */
function board(search: string, live: RunSummary[] | null, strict = false, held: RunSummary[] | null = null) {
  const store = makeStore();
  act(() => {
    store.setState({ runs: live ?? [], runsFrameSeen: live !== null, sessions: [], fleetFrameSeen: true });
    if (held !== null) store.setState({ runPages: { runs: held, nextBefore: null, at: Date.now() } });
  });
  const reads: Read[] = [];
  const loadRuns = vi.fn((_limit: number, before?: number): Promise<RunsPageAnswer> => new Promise((res) => {
    reads.push({ before, resolve: async (a) => { await act(async () => { res(a); }); } });
  }));
  navigate(search);
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  const screenEl = <RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />;
  const r = render(strict ? <StrictMode>{screenEl}</StrictMode> : screenEl);
  return { ...r, store, reads, loadRuns, scroll, scrolled: (): Element[] => scroll.mock.contexts as Element[] };
}

const rowOf = (id: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`.run-row[title^="run ${id} "]`);
  expect(el, `the row of run ${id}`).not.toBeNull();
  return el!;
};
const notLoaded = (id: number): HTMLElement | null => screen.queryByText(runNotLoadedLine(id));

describe('RunsScreen arrives at ?run=<n> (chat reading Task L, D-8062)', () => {
  it('/runs?run=1527 scrolls the row into view, focuses it and marks it data-arrived', async () => {
    const b = board(runsRunHref(1527), [run(1526, { sessionId: 'sess-b', workspace: 'ws-b' }), run(1527)]);
    await waitFor(() => expect(b.loadRuns).toHaveBeenCalledTimes(1));
    await act(async () => {});
    const row = rowOf(1527);
    expect(b.scrolled()).toEqual([row]);
    expect(b.scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(row);
    expect(row).toHaveAttribute('data-arrived', 'true');
    expect(rowOf(1526)).not.toHaveAttribute('data-arrived');
    // Once: a re-render (a store change) moves neither the scroll nor the focus again.
    (document.activeElement as HTMLElement).blur();
    act(() => { b.store.setState({ sessions: [] }); });
    expect(b.scrolled()).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
    expect(notLoaded(1527)).toBeNull();
  });

  // The once-per-value record (`useArrival`'s `arrivedAt`): the effect is keyed on the run and on whether its row exists, so a
  // plain re-render never runs it again, but React runs a new effect twice in StrictMode, and the record is what keeps that
  // second run from scrolling and focusing again.
  it('under StrictMode, where React runs the effect twice, the row still arrives once', async () => {
    const b = board(runsRunHref(1527), [run(1527)], true);
    await waitFor(() => expect(b.loadRuns).toHaveBeenCalled());
    await act(async () => {});
    expect(b.scrolled()).toEqual([rowOf(1527)]);
    expect(rowOf(1527)).toHaveAttribute('data-arrived', 'true');
  });

  it('a run that is not loaded says runNotLoadedLine(1527) once the frame and the archive read have answered', async () => {
    expect(runNotLoadedLine(1527)).toBe('Run 1527 is not among the runs loaded here.');
    const b = board(runsRunHref(1527), [run(1526)]);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: [closed(900, 60_000)] });
    expect(notLoaded(1527)).not.toBeNull();
    expect(b.scrolled()).toHaveLength(0);
    expect(document.querySelector('[data-arrived]')).toBeNull();
  });

  it('before they answer it says nothing', async () => {
    const b = board(runsRunHref(1527), null);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    expect(notLoaded(1527)).toBeNull();
    // The frame answers with no such run; the archive read is still out.
    act(() => { b.store.setState({ runs: [run(1526)], runsFrameSeen: true }); });
    expect(notLoaded(1527)).toBeNull();
    await b.reads[0]!.resolve({ runs: [] });
    expect(notLoaded(1527)).not.toBeNull();
  });

  // Review 1586 F7: the archive has answered but no runs frame has been seen: the active half has not answered, so nothing is
  // said yet.
  it('with the archive answered and no frame seen, a run it lacks is not said missing', async () => {
    const b = board(runsRunHref(1527), null);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: [] });
    expect(notLoaded(1527)).toBeNull();
  });

  // Review 1586 F4: the arrived run closes while its own page is open. The live frame drops it, the archive re-read goes out, and
  // the row comes back in Finished: one scroll and one focus in all, the mark kept, and no line while the re-read is out.
  it('a run that closes under its own page keeps its one arrival, and says no line while the re-read is out', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const rowFocuses = (): number => focus.mock.contexts.filter((el) => (el as Element).classList.contains('run-row')).length;
    const b = board(runsRunHref(1527), [run(1527)]);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: [run(1527)] });
    expect(b.scrolled()).toEqual([rowOf(1527)]);
    expect(rowFocuses()).toBe(1);
    act(() => { b.store.setState({ runs: [] }); });
    await waitFor(() => expect(b.reads).toHaveLength(2));
    expect(notLoaded(1527)).toBeNull();
    await b.reads[1]!.resolve({ runs: [closed(1527, 1_000)] });
    expect(rowOf(1527)).toHaveAttribute('data-arrived', 'true');
    expect(b.scrolled()).toHaveLength(1);
    expect(rowFocuses()).toBe(1);
    expect(notLoaded(1527)).toBeNull();
  });

  // Review 1586 F4: a mount over archive pages the store already holds re-reads them; a run they lack is said missing only once
  // this mount's own read has answered.
  it('over pages the store holds, a run they lack is said missing only once this mount\'s read answers', async () => {
    const b = board(runsRunHref(1527), [run(1526)], false, [closed(900, 60_000)]);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    expect(notLoaded(1527)).toBeNull();
    await b.reads[0]!.resolve({ runs: [closed(900, 60_000)] });
    expect(notLoaded(1527)).not.toBeNull();
  });

  // Review 1586 F6: the line answers a followed link with no focus move, so it is announced.
  it('the not-loaded line is a polite status', async () => {
    const b = board(runsRunHref(1527), [run(1526)]);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: [] });
    expect(notLoaded(1527)!.closest('[role="status"]')).not.toBeNull();
  });

  it('a second ?run= on the same mount arrives again', async () => {
    const b = board(runsRunHref(1527), [run(1526, { sessionId: 'sess-b', workspace: 'ws-b' }), run(1527)]);
    await waitFor(() => expect(b.loadRuns).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(b.scrolled()).toEqual([rowOf(1527)]);
    act(() => { navigate(runsRunHref(1526)); });
    expect(b.scrolled()).toEqual([rowOf(1527), rowOf(1526)]);
    expect(document.activeElement).toBe(rowOf(1526));
    expect(rowOf(1526)).toHaveAttribute('data-arrived', 'true');
    expect(rowOf(1527)).not.toHaveAttribute('data-arrived');
  });

  it('loading older pages that bring the run arrives then', async () => {
    const b = board(runsRunHref(800), []);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: [closed(900, 60_000)], nextBefore: 900 });
    expect(notLoaded(800)).not.toBeNull();
    act(() => { screen.getByRole('button', { name: 'Show older' }).click(); });
    await waitFor(() => expect(b.reads).toHaveLength(2));
    expect(b.reads[1]!.before).toBe(900);
    await b.reads[1]!.resolve({ runs: [closed(800, 120_000)] });
    await act(async () => {});
    expect(b.scrolled()).toEqual([rowOf(800)]);
    expect(document.activeElement).toBe(rowOf(800));
    expect(notLoaded(800)).toBeNull();
  });

  it('a finished run past the fold is unfolded so it can arrive', async () => {
    const rows = Array.from({ length: FINISHED_FOLD + 5 }, (_, i) => closed(500 - i, (i + 1) * 60_000));
    const target = rows[FINISHED_FOLD + 2]!.id;
    const b = board(runsRunHref(target), []);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: rows });
    await act(async () => {});
    expect(b.scrolled()).toEqual([rowOf(target)]);
    expect(rowOf(target)).toHaveAttribute('data-arrived', 'true');
  });

  it('with no ?run= nothing scrolls or takes focus, and no line is said', async () => {
    const b = board('/runs', [run(1527)]);
    await waitFor(() => expect(b.reads).toHaveLength(1));
    await b.reads[0]!.resolve({ runs: [] });
    expect(b.scrolled()).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
    expect(rowOf(1527)).toHaveAttribute('tabindex', '-1');
    expect(document.querySelector('[data-arrived]')).toBeNull();
  });

  it('the arrived run row shares the accounts row\'s accent edge and its forced-colours outline', () => {
    const forced = atBlock(fleetCss, '@media (forced-colors: active)');
    const outside = fleetCss.replace(forced, '');
    expect(declValue(ruleIn(outside, '.run-row[data-arrived]'), 'box-shadow')).toBe('inset 2px 0 0 var(--accent)');
    expect(declValue(ruleIn(outside, '.run-row[tabindex="-1"]:focus'), 'outline')).toBe('none');
    for (const sel of ['.run-row[data-arrived]', '.run-row[data-arrived][tabindex="-1"]:focus']) {
      const rule = ruleIn(forced, sel);
      expect(declValue(rule, 'outline'), sel).toBe('2px solid CanvasText');
      expect(declValue(rule, 'outline-offset'), sel).toBe('-2px');
    }
  });
});
