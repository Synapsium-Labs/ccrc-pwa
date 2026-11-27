// Reader mode's place (X6 XR1.3, spec §3.3 "One place, one Back"): the history half. A place of kind `reader` rides X2's
// tab record, decider and dispatcher (`lib/historyPlaces.ts`, `lib/popstate.ts`, `docs/reader/places.ts`); the reader-mode
// hook that registers the host and calls the step-back is built later, so these cases stand a small fake host in its place.
//
// The cases drive the real `history` and the real `popstate` events of jsdom (a traversal fires its event a task later, so a
// case waits for what it should leave). The fixture: the previous screen is entry 0 (numbered by the page's seed), the doc's
// own entry B is entry 1 (numbered by the visit's start, its `baseIdx`), and every place pushed takes the next number.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_RECORD, IDX_KEY, PLACES_MAX, PLACE_KEY, SKIPS_MAX, afterPop, beginVisit, decidePop, endVisit, landedBelowReader, parseRecord,
  pushPlace, readerPlaceFree, readerPlaceOf, readerStepBack, seedPage, stampVisitBase, standingOnDeadReader, visitKey, withExitPending,
  type PopDecision, type Place, type PopTab, type TabRecord,
} from '../src/lib/historyPlaces';
import { onPop, readPlaces, resetPopstateForTests, setPlaceHost, setReaderPlaceHost } from '../src/lib/popstate';
import {
  landedBelowReaderPlace, markReaderExitPending, pushReaderPlace, readerPlaceFreeNow, standingOnDeadReaderEntry, startPlaces,
  stepBelowReaderPlace, type Places,
} from '../src/docs/reader/places';

const DOC_A = '/docs/demo/specs/a.md';

beforeEach(() => {
  resetPopstateForTests();
  history.replaceState(null, '', '/');
});

afterEach(async () => {
  await sleep(20);
  resetPopstateForTests();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
/** Waits for a condition, then a little more, so an event the condition does not name would show too. */
async function until(cond: () => void): Promise<void> {
  await vi.waitFor(cond, { timeout: 4000, interval: 10 });
  await sleep(30);
}

const rec = (o: Partial<TabRecord> = {}): TabRecord => ({ ...EMPTY_RECORD, places: [], ...o });
const tab = (o: Partial<PopTab> = {}): PopTab => ({
  visit: 'v', places: [], pendingSeq: null, lastIdx: 2, skips: 0, skipDir: null, host: true, top: null, baseIdx: 1, exitPending: false,
  readerHost: true, ...o,
});
const entry = (idx: number, place?: { visit: string; seq: number; kind: 'overlay' | 'jump' | 'reader'; id?: string; from?: string }): object => ({
  [IDX_KEY]: idx,
  ...(place === undefined ? {} : { [PLACE_KEY]: place }),
});
const here = (seq: number, kind: 'overlay' | 'jump' | 'reader', visit = 'v', id?: string, from?: string): object =>
  entry(seq + 1, { visit, seq, kind, ...(id !== undefined ? { id } : {}), ...(from !== undefined ? { from } : {}) });

const R: Place = { seq: 1, kind: 'reader', idx: 2 };
const O: Place = { seq: 2, kind: 'overlay', idx: 3 };
const J: Place = { seq: 2, kind: 'jump', idx: 3, id: 'j', from: 'f' };

/** What the dispatcher reads of the record, as it hands it to the decider. */
const tabOf = (r: TabRecord, host = false, readerHost = true): PopTab => ({
  visit: r.visit, places: r.places, pendingSeq: r.pendingSeq, lastIdx: r.lastIdx, skips: r.skips, skipDir: r.skipDir, host, top: r.top,
  baseIdx: r.baseIdx, exitPending: r.exitPending, readerHost,
});

// ---------------------------------------------------------------------------------------------------------------------
// The rig: the real history and dispatcher, a fake reader host and (when asked) a fake frame host.

interface Rig {
  readonly places: Places;
  readonly order: string[];
  readonly ran: ReturnType<typeof vi.fn>;
  readonly frame: { closeOverlay: ReturnType<typeof vi.fn>; goto: ReturnType<typeof vi.fn>; gotoTop: ReturnType<typeof vi.fn> };
  readonly reader: { on: boolean; exits: boolean[]; dead: number };
}

function rig(o: { frameHost?: boolean; readerHost?: boolean; url?: string } = {}): Rig {
  const order: string[] = [];
  history.replaceState(null, '', '/before');
  const ran = vi.fn(() => { order.push('router'); });
  onPop(ran);
  history.pushState(null, '', o.url ?? DOC_A);
  const places = startPlaces({ doc: DOC_A });
  const frame = { closeOverlay: vi.fn(() => { order.push('close'); }), goto: vi.fn(), gotoTop: vi.fn() };
  const reader = { on: false, exits: [] as boolean[], dead: 0 };
  if (o.frameHost !== false) setPlaceHost(frame);
  if (o.readerHost !== false) {
    setReaderPlaceHost({
      on: () => reader.on,
      exitReader: (close) => { reader.exits.push(close); reader.on = false; order.push('exit'); },
      // As the hook's `leaveDead` does: the landing is marked expected first, then the step is made.
      leaveDead: () => { reader.dead += 1; markReaderExitPending(true); stepBelowReaderPlace(); },
    });
  }
  return { places, order, ran, frame, reader };
}
/** The hook's enter: the place is pushed, reader mode is on. */
function enter(r: Rig): void {
  expect(pushReaderPlace(), 'the place was pushed').toBe(true);
  r.reader.on = true;
}
const stateNow = (): Record<string, unknown> => (history.state ?? {}) as Record<string, unknown>;
const idxNow = (): number | undefined => stateNow()[IDX_KEY] as number | undefined;
const lastIdx = (): number => readPlaces().lastIdx;
const landed = (n: number): Promise<void> => until(() => { expect(lastIdx()).toBe(n); });
/** One Exit, as the hook makes it: reader mode off, then the recorded step-back. */
function exitByHook(r: Rig): number {
  r.reader.on = false;
  markReaderExitPending(true);
  return stepBelowReaderPlace();
}

// ---------------------------------------------------------------------------------------------------------------------
// The history, through the real dispatcher.

describe('reader place: Back, Exit and the engine', () => {
  it('reader place: Back exits reader mode and stays on the doc', async () => {
    const r = rig();
    enter(r);
    expect(lastIdx()).toBe(2);
    history.back();
    await landed(1);
    expect(r.reader.exits).toEqual([false]);
    expect(r.ran, 'no router subscriber ran').not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    expect(readPlaces().exitPending).toBe(false);
    expect(r.frame.closeOverlay).not.toHaveBeenCalled();
  });

  it('reader place: after an exit by Exit, one Back leaves the doc for the previous screen', async () => {
    const r = rig();
    enter(r);
    expect(exitByHook(r)).toBe(1);
    expect(readPlaces().exitPending, 'the step-back expects its landing').toBe(true);
    await landed(1);
    expect(readPlaces().exitPending, 'the landing was consumed').toBe(false);
    expect(r.ran).not.toHaveBeenCalled();
    const exitsAfterExit = r.reader.exits.length;
    // The next Back is no exit: the decider answers the router's, and the reader host is never asked.
    expect(decidePop(entry(0), tabOf(readPlaces(), true), false)).toEqual({ kind: 'router' });
    history.back();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(r.reader.exits.length, 'exitReader is never called by that Back').toBe(exitsAfterExit);
    expect(location.pathname).toBe('/before');
  });

  it('reader place: after an exit by Back, the next Back leaves the doc', async () => {
    const r = rig();
    enter(r);
    history.back();
    await landed(1);
    expect(r.reader.exits).toEqual([false]);
    history.back();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(location.pathname).toBe('/before');
    expect(r.reader.exits, 'the second Back is no exit').toEqual([false]);
  });

  it('reader place: a Back two entries deep from reader mode exits and routes in one event', async () => {
    const r = rig();
    enter(r);
    const d = decidePop(entry(0), tabOf(readPlaces(), true), true);
    expect(d).toEqual({ kind: 'exit-reader', closeOverlay: false, route: true });
    history.go(-2);
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(r.order, 'reader mode ends first, then the router runs').toEqual(['exit', 'router']);
    expect(r.reader.exits).toEqual([false]);
    expect(location.pathname).toBe('/before');
    expect(lastIdx()).toBe(0);
    expect(readPlaces().exitPending).toBe(false);
  });

  it('reader place: the doc\'s own entry and the previous screen\'s are told apart by baseIdx', async () => {
    const r = rig();
    expect(readPlaces().baseIdx, 'the visit\'s base is the doc\'s own entry').toBe(1);
    enter(r);
    const t = tabOf(readPlaces(), true);
    expect(decidePop(entry(1), t, true)).toEqual({ kind: 'exit-reader', closeOverlay: false, route: false });
    expect(decidePop(entry(0), t, true)).toEqual({ kind: 'exit-reader', closeOverlay: false, route: true });
    expect(decidePop(entry(0), { ...t, baseIdx: null }, true), 'an older record knows no base: routed, never consumed').toEqual({
      kind: 'exit-reader', closeOverlay: false, route: true,
    });
    // The numbers are not adjacent by construction: a base at 5 with the previous screen at 3.
    const far = tab({ places: [{ seq: 1, kind: 'reader', idx: 6 }], lastIdx: 6, baseIdx: 5 });
    expect(decidePop(entry(5), far, true)).toMatchObject({ route: false });
    expect(decidePop(entry(4), far, true)).toMatchObject({ route: true });
    expect(decidePop(entry(3), far, true)).toMatchObject({ route: true });
    // Real: the Back lands on the base and the router stays quiet.
    history.back();
    await landed(1);
    expect(r.ran).not.toHaveBeenCalled();
    // And two entries deep, past the doc's own: the previous screen's entry routes, the doc's own never does.
    enter(r);
    history.go(-2);
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(location.pathname).toBe('/before');
  });

  it('reader place: B, enter, Back, Forward, enter, Back, Back: every Back has a visible effect and the last leaves the doc', async () => {
    const r = rig();
    enter(r);
    history.back(); // exits reader mode, stays on the doc
    await landed(1);
    expect(r.reader.exits).toEqual([false]);
    history.forward(); // onto the dead reader entry: stepped back below it at once
    await until(() => { expect(r.reader.dead).toBe(1); expect(lastIdx()).toBe(1); });
    expect(r.ran, 'the dead entry\'s landing is consumed').not.toHaveBeenCalled();
    expect(readPlaces().exitPending).toBe(false);
    expect(location.pathname).toBe(DOC_A);
    enter(r); // the re-entry's push drops the dead entry from the record
    expect(readPlaces().places.filter((p) => p.kind === 'reader')).toHaveLength(1);
    history.back(); // exits reader mode
    await landed(1);
    expect(r.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    history.back(); // leaves the doc
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(location.pathname).toBe('/before');
  });

  it('reader place: a crossing while off that is not the exit that just happened is X2\'s answer', () => {
    const open = [R, O];
    const without = (p: readonly Place[]): Place[] => p.filter((q) => q.kind !== 'reader');
    for (const [popped, lastIdx] of [[entry(1), 3], [entry(1), 2], [entry(0), 3]] as const) {
      const t = tab({ places: open, lastIdx });
      const x2 = decidePop(popped, tab({ places: without(open), lastIdx }), false);
      expect(decidePop(popped, t, false), `lastIdx ${lastIdx}`).toEqual(x2);
      expect(decidePop(popped, t, false).kind).not.toBe('exit-reader');
    }
    // With the exit pending, the same crossing is the exit's own landing.
    expect(decidePop(entry(1), tab({ places: open, lastIdx: 3, exitPending: true }), false)).toEqual({
      kind: 'exit-reader', closeOverlay: true, route: false,
    });
  });

  it('reader place: decidePop takes readerOn as input and never calls the host', () => {
    const frozen = <T,>(x: T): T => Object.freeze(x);
    const rows: readonly { name: string; popped: unknown; t: Partial<PopTab>; on: boolean; want: PopDecision }[] = [
      { name: 'on, Back past the reader place', popped: entry(1), t: { places: [R] }, on: true, want: { kind: 'exit-reader', closeOverlay: false, route: false } },
      { name: 'on, a figure open above it', popped: entry(1), t: { places: [R, O], lastIdx: 3 }, on: true, want: { kind: 'exit-reader', closeOverlay: true, route: false } },
      { name: 'on, a jump above it is left with the reader mode', popped: entry(1), t: { places: [R, J], lastIdx: 3 }, on: true, want: { kind: 'exit-reader', closeOverlay: false, route: false } },
      { name: 'on, landing below the base', popped: entry(0), t: { places: [R] }, on: true, want: { kind: 'exit-reader', closeOverlay: false, route: true } },
      { name: 'on, no base known: routed', popped: entry(0), t: { places: [R], baseIdx: null }, on: true, want: { kind: 'exit-reader', closeOverlay: false, route: true } },
      { name: 'off, Forward over a reader place the record holds but history discarded: X2 goes to the place', popped: entry(4, { visit: 'v', seq: 2, kind: 'jump', id: 'sec' }), t: { places: [R, { seq: 2, kind: 'jump', idx: 4, id: 'sec' }], lastIdx: 3 }, on: false, want: { kind: 'goto', id: 'sec' } },
      { name: 'on, Back onto the reader place from a jump above: X2 returns from the jump', popped: here(1, 'reader'), t: { places: [R, J], lastIdx: 3 }, on: true, want: { kind: 'goto', id: 'j', from: 'f' } },
      { name: 'on, Back onto the reader place from a figure above: X2 closes it', popped: here(1, 'reader'), t: { places: [R, O], lastIdx: 3 }, on: true, want: { kind: 'close-overlay' } },
      { name: 'on, Forward onto the reader place is no frame place: stale', popped: here(1, 'reader'), t: { places: [R], lastIdx: 1 }, on: true, want: { kind: 'skip', dir: 'forward' } },
      { name: 'on, but lastIdx already below the place: X2', popped: entry(0), t: { places: [R], lastIdx: 1 }, on: true, want: { kind: 'router' } },
      { name: 'off, exitPending set: the exit\'s landing', popped: entry(1), t: { places: [R], exitPending: true }, on: false, want: { kind: 'exit-reader', closeOverlay: false, route: false } },
      { name: 'off, exitPending set, a figure open: close-overlay rides the landing', popped: entry(1), t: { places: [R, O], lastIdx: 3, exitPending: true }, on: false, want: { kind: 'exit-reader', closeOverlay: true, route: false } },
      { name: 'off, exitPending set, landing below the base', popped: entry(0), t: { places: [R], exitPending: true }, on: false, want: { kind: 'exit-reader', closeOverlay: false, route: true } },
      { name: 'off, exitPending clear: X2', popped: entry(1), t: { places: [R] }, on: false, want: { kind: 'router' } },
      { name: 'off, exitPending clear, a figure open: X2 closes it', popped: entry(1), t: { places: [R, O], lastIdx: 3 }, on: false, want: { kind: 'close-overlay' } },
      { name: 'off, exitPending set but lastIdx already below the place: X2', popped: entry(0), t: { places: [R], lastIdx: 1, exitPending: true }, on: false, want: { kind: 'router' } },
      { name: 'off, Forward onto the dead reader entry', popped: here(1, 'reader'), t: { places: [R], lastIdx: 1 }, on: false, want: { kind: 'leave-dead-reader' } },
      { name: 'off, Forward onto a place above a dead reader entry', popped: here(2, 'jump', 'v', 'j', 'f'), t: { places: [R, J], lastIdx: 1 }, on: false, want: { kind: 'leave-dead-reader' } },
      { name: 'off, Forward onto the dead reader entry with an exit pending: the exit\'s own, X2 answers', popped: here(1, 'reader'), t: { places: [R], lastIdx: 1, exitPending: true }, on: false, want: { kind: 'skip', dir: 'forward' } },
      { name: 'off, Forward onto the dead reader entry with no reader host: X2 answers', popped: here(1, 'reader'), t: { places: [R], lastIdx: 1, readerHost: false }, on: false, want: { kind: 'skip', dir: 'forward' } },
      { name: 'off, Forward onto a plain entry above a dead reader entry: the router\'s', popped: entry(3), t: { places: [R], lastIdx: 1 }, on: false, want: { kind: 'router' } },
      { name: 'off, Forward onto a reader place of another visit: stale', popped: entry(2, { visit: 'old', seq: 1, kind: 'reader' }), t: { places: [R], lastIdx: 1 }, on: false, want: { kind: 'skip', dir: 'forward' } },
      { name: 'off, a Back onto a place above a dead reader entry is not leave-dead-reader: X2 closes the figure above', popped: here(2, 'jump', 'v', 'j', 'f'), t: { places: [R, J, { seq: 3, kind: 'overlay', idx: 4 }], lastIdx: 4 }, on: false, want: { kind: 'close-overlay' } },
      { name: 'off, a place of another visit is stale, a reader place too', popped: entry(2, { visit: 'old', seq: 1, kind: 'reader' }), t: { places: [], lastIdx: 3 }, on: false, want: { kind: 'skip', dir: 'back' } },
      { name: 'no reader place in the record: X2 whatever readerOn says (on)', popped: entry(1), t: { places: [J], lastIdx: 3 }, on: true, want: { kind: 'goto', id: 'j', from: 'f' } },
      { name: 'no reader place in the record: X2 whatever readerOn says (off)', popped: entry(1), t: { places: [J], lastIdx: 3 }, on: false, want: { kind: 'goto', id: 'j', from: 'f' } },
      { name: 'rule 2 first: the entry last shown', popped: entry(2), t: { places: [R], exitPending: true }, on: true, want: { kind: 'router' } },
      { name: 'rule 1 first: no number', popped: null, t: { places: [R] }, on: true, want: { kind: 'router' } },
    ];
    for (const row of rows) {
      const t = frozen(tab({ ...row.t, places: frozen((row.t.places ?? []).slice()) }));
      expect(decidePop(row.popped, t, row.on), row.name).toEqual(row.want);
    }
    // A tab that carries neither new field (an older caller) reads no base and no pending mark.
    const { baseIdx: _b, exitPending: _e, ...older } = tab({ places: [R] });
    expect(decidePop(entry(0), older, true)).toEqual({ kind: 'exit-reader', closeOverlay: false, route: true });
    expect(decidePop(entry(1), older, false)).toEqual({ kind: 'router' });
    // The two-argument call is the old one: readerOn reads false.
    expect(decidePop(entry(1), tab({ places: [R], lastIdx: 2 }))).toEqual(decidePop(entry(1), tab({ places: [R], lastIdx: 2 }), false));
  });

  it('reader place: Forward onto a dead reader entry answers leave-dead-reader and steps back once', async () => {
    const r = rig();
    enter(r);
    history.back();
    await landed(1);
    const go = vi.spyOn(history, 'go');
    history.forward();
    await until(() => { expect(go).toHaveBeenCalledTimes(1); });
    expect(go).toHaveBeenCalledWith(-1);
    expect(r.reader.dead).toBe(1);
    await landed(1);
    expect(r.reader.on, 'reader mode does not reopen').toBe(false);
    expect(r.ran).not.toHaveBeenCalled();
  });

  it('reader place: with two reader places in the visit, the topmost at or below lastIdx counts', () => {
    const R1: Place = { seq: 1, kind: 'reader', idx: 2 };
    const R2: Place = { seq: 3, kind: 'reader', idx: 5 };
    const j: Place = { seq: 2, kind: 'jump', idx: 3, id: 'a' };
    const both = rec({ visit: 'v', places: [R1, j, R2], seq: 3, lastIdx: 3, next: 6, baseIdx: 1 });
    expect(readerPlaceOf(both), 'the live one is below lastIdx').toEqual(R1);
    expect(readerPlaceOf({ ...both, lastIdx: 5 })).toEqual(R2);
    expect(readerPlaceOf({ ...both, lastIdx: 1 }), 'none at or below').toBeNull();
    expect(readerStepBack(both).n, 'R1 and the jump').toBe(2);
    expect(readerStepBack({ ...both, lastIdx: 5 }).n, 'R2 alone').toBe(1);
    const t = tabOf(both, true);
    expect(decidePop(entry(1), t, true), 'a Back crossing R1').toEqual({ kind: 'exit-reader', closeOverlay: false, route: false });
    expect(decidePop(entry(4), { ...t, lastIdx: 5 }, true), 'a Back crossing R2').toEqual({ kind: 'exit-reader', closeOverlay: false, route: false });
    // The reader place's own entry is not below it: X2's, with the readers left out.
    expect(decidePop(here(1, 'reader'), t, true)).toEqual({ kind: 'goto', id: 'a', toTop: true });
  });

  it('reader place: leaveDead\'s landing is consumed and no router subscriber runs', async () => {
    const r = rig();
    enter(r);
    history.back();
    await landed(1);
    history.forward();
    await until(() => { expect(r.reader.dead).toBe(1); expect(lastIdx()).toBe(1); });
    expect(readPlaces().exitPending, 'the landing was consumed').toBe(false);
    expect(r.ran).not.toHaveBeenCalled();
    expect(r.frame.goto).not.toHaveBeenCalled();
    expect(r.frame.closeOverlay).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    expect(idxNow()).toBe(1);
  });

  it('reader place: a record outliving its visit never swallows a Back on another screen', async () => {
    const r = rig();
    enter(r);
    history.back(); // exit by Back: R(2) stays in the record as a dead entry
    await landed(1);
    // The release gate's full-page load never runs `end()`: the record keeps its visit and its dead reader place, and the
    // screens the user moves to are routed pushes numbered above it.
    history.pushState(null, '', '/other');
    dispatchEvent(new PopStateEvent('popstate')); // seeded 3
    history.pushState(null, '', '/third');
    dispatchEvent(new PopStateEvent('popstate')); // 4
    expect(r.ran).toHaveBeenCalledTimes(2);
    expect(readPlaces().places.map((p) => p.kind)).toEqual(['reader']);
    history.back(); // onto /other: PH alone answers the router's
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(3); });
    expect(location.pathname).toBe('/other');
    history.forward();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(4); });
    expect(location.pathname).toBe('/third');
    expect(r.reader.dead, 'the reader host was never asked to step').toBe(0);
    // The decider, with and without a reader host, on the same numbers.
    const stale = tab({ places: [R], lastIdx: 4, host: false, top: 4 });
    expect(decidePop(entry(3), stale, false)).toEqual({ kind: 'router' });
    expect(decidePop(entry(3), { ...stale, places: [] }, false), 'X2 alone').toEqual({ kind: 'router' });
  });

  it('reader place: Forward onto a dead reader entry left by the gate\'s replace on another screen routes', async () => {
    const r = rig();
    enter(r);
    history.back();
    await landed(1);
    // The reader-mode hook belongs to the doc screen: the page that loaded on another screen has none, and the gate's
    // replace gave the doc's own entry (1) the other screen's address, leaving R(2) as forward history.
    setReaderPlaceHost(null);
    history.replaceState({ [IDX_KEY]: 1 }, '', '/other');
    history.forward();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(r.reader.dead).toBe(0);
    expect(location.pathname, 'the entry forward of it is shown, and nothing steps it back').toBe(DOC_A);
    expect(lastIdx()).toBe(2);
  });

  it('reader place: Forward over a dead reader entry the router discarded reaches the newer entry', async () => {
    const r = rig();
    enter(r);
    history.back();
    await landed(1);
    // A routed push in the same doc discards the dead entry from history; the record still holds it.
    history.pushState(null, '', `${DOC_A}#x`);
    dispatchEvent(new PopStateEvent('popstate'));
    expect(lastIdx()).toBe(3);
    expect(r.ran).toHaveBeenCalledTimes(1);
    history.back();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(2); expect(lastIdx()).toBe(1); });
    history.forward();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(3); });
    expect(lastIdx(), 'the newer entry, not stepped back from').toBe(3);
    expect(location.hash).toBe('#x');
    expect(r.reader.dead).toBe(0);
  });

  it('reader place: a long Back past the doc with a jump or an overlay above the reader place runs the router once and sends the frame nothing but one close', async () => {
    for (const above of ['jump', 'overlay'] as const) {
      resetPopstateForTests();
      const r = rig();
      enter(r);
      if (above === 'jump') r.places.onHash('sec', { push: true, from: 'f', inGrammar: true });
      else r.places.onPlace('overlay');
      expect(lastIdx(), above).toBe(3);
      history.go(-3); // to the previous screen's entry, past the doc, the reader place and the place above it
      await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
      expect(r.reader.exits, above).toEqual([above === 'overlay']);
      expect(r.frame.goto, `${above}: the frame is not sent to a place of a visit that is over`).not.toHaveBeenCalled();
      expect(r.frame.gotoTop, above).not.toHaveBeenCalled();
      expect(r.frame.closeOverlay, above).toHaveBeenCalledTimes(above === 'overlay' ? 1 : 0);
      expect(location.pathname, above).toBe('/before');
      expect(lastIdx(), above).toBe(0);
      expect(r.order, above).toEqual(above === 'overlay' ? ['close', 'exit', 'router'] : ['exit', 'router']);
    }
  });

  it('reader place: with an overlay open, a lost full screen and the engine\'s Back in either order close the overlay and exit once', async () => {
    for (const order of ['full screen first', 'pop first'] as const) {
      resetPopstateForTests();
      const r = rig();
      enter(r);
      r.places.onPlace('overlay'); // O, idx 3, open
      if (order === 'full screen first') {
        r.reader.on = false;
        markReaderExitPending(true); // the hook, on `fullscreenchange`
      }
      history.back(); // the engine's own Back, from the overlay's entry onto the reader place
      await until(() => { expect(r.frame.closeOverlay, order).toHaveBeenCalledTimes(1); expect(lastIdx(), order).toBe(2); });
      expect(r.reader.dead, `${order}: not a dead entry`).toBe(0);
      expect(r.reader.exits, `${order}: the pop landed on the place, not below it`).toEqual([]);
      expect(r.ran, order).not.toHaveBeenCalled();
      if (order === 'pop first') {
        r.reader.on = false;
        markReaderExitPending(true);
      }
      // The settle: no pop has landed below the place, so the one step-back is made, over the place alone (the figure's
      // entry is above the entry last shown now).
      expect(landedBelowReaderPlace(), order).toBe(false);
      expect(stepBelowReaderPlace(), order).toBe(1);
      await landed(1);
      expect(r.reader.exits, `${order}: exactly one exit`).toEqual([false]);
      expect(r.frame.closeOverlay, `${order}: the figure closed once`).toHaveBeenCalledTimes(1);
      expect(readPlaces().exitPending, order).toBe(false);
      expect(r.ran, order).not.toHaveBeenCalled();
      expect(location.pathname, order).toBe(DOC_A);
    }
  });

  it('reader place: a reader host whose on() throws reads as off, is warned, and the pop is still answered', async () => {
    const r = rig();
    enter(r);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setReaderPlaceHost({ on: () => { throw new Error('gone'); }, exitReader: () => { r.order.push('exit'); }, leaveDead: () => undefined });
    history.back();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(warn).toHaveBeenCalled();
    expect(r.order, 'off and no exit pending: X2\'s answer, no exit').toEqual(['router']);
  });

  it('reader place: a new commit of the same document while reader mode is on keeps the reader place, and Back still exits', async () => {
    const r = rig();
    enter(r);
    const old = readPlaces();
    // The blob changed: the body remounts and starts a visit under another scope, standing on the reader place.
    startPlaces({ doc: DOC_A, scope: 'blob-2' });
    const now = readPlaces();
    expect(now.visit, 'a visit of its own').not.toBe(old.visit);
    expect(now.places, 'the reader place was taken over').toEqual([{ seq: 1, kind: 'reader', idx: 2 }]);
    expect(now.baseIdx, 'with the old visit\'s base').toBe(1);
    expect(now.lastIdx).toBe(2);
    expect((stateNow()[PLACE_KEY] as { visit: string }).visit, 'its entry is re-tagged, not stripped').toBe(now.visit);
    expect(r.reader.on).toBe(true);
    history.back();
    await landed(1);
    expect(r.reader.exits, 'reader mode exits').toEqual([false]);
    expect(r.ran, 'the doc stays shown').not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    expect(readPlaces().exitPending).toBe(false);
  });

  it('reader place: a new visit at another address carries no reader place', async () => {
    const r = rig();
    enter(r);
    startPlaces({ doc: '/docs/demo/specs/other.md' });
    const now = readPlaces();
    expect(now.places).toEqual([]);
    expect(now.baseIdx, 'the entry stood on is its base').toBe(2);
    expect(stateNow()[PLACE_KEY], 'the ended visit\'s place is stripped').toBeUndefined();
    r.reader.on = false;
    history.back();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(1); });
    expect(r.reader.exits).toEqual([]);
  });

  it('reader place: the reload check does not step again while its step is on its way', async () => {
    const r = rig();
    enter(r);
    r.reader.on = false; // the page reloaded while its reader entry was live: reader mode is off, the entry still R
    const go = vi.spyOn(history, 'go');
    // The hook's registration runs twice before the first step lands (StrictMode, or a remount inside the window).
    for (let i = 0; i < 2; i += 1) {
      if (standingOnDeadReaderEntry(false)) {
        markReaderExitPending(true);
        stepBelowReaderPlace();
      }
    }
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    await landed(1);
    expect(r.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    expect(standingOnDeadReaderEntry(false), 'on the doc\'s own entry now').toBe(false);
    // A stored mark never crosses a page load.
    expect(seedPage(rec({ visit: 'v', places: [R], lastIdx: 2, next: 3, exitPending: true }), entry(2), '/x').rec.exitPending).toBe(false);
  });

  it('reader place: Forward over a reader place the record holds but history discarded is not a dead entry', async () => {
    const r = rig();
    enter(r);
    history.back();
    await landed(1);
    // A routed push discards R's entry from history; the record still holds R(2). A jump pushed after it is place 4.
    history.pushState(null, '', `${DOC_A}#x`);
    dispatchEvent(new PopStateEvent('popstate'));
    r.places.onHash('sec', { push: true, from: null, inGrammar: true });
    expect(readPlaces().places.map((p) => p.idx)).toEqual([2, 4]);
    history.back();
    await until(() => { expect(r.frame.gotoTop).toHaveBeenCalledTimes(1); expect(lastIdx()).toBe(3); });
    history.forward();
    await until(() => { expect(r.frame.goto).toHaveBeenCalledWith('sec', undefined); expect(lastIdx()).toBe(4); });
    expect(r.reader.dead, 'nothing stepped back over a discarded entry').toBe(0);
  });

  it('reader place: a jump then Exit leaves no place behind', async () => {
    const r = rig();
    enter(r);
    r.places.onHash('sec', { push: true, from: null, inGrammar: true });
    expect(lastIdx()).toBe(3);
    const go = vi.spyOn(history, 'go');
    expect(exitByHook(r), 'the reader place and the jump').toBe(2);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-2);
    await landed(1);
    expect(stateNow()[PLACE_KEY], 'on the doc\'s own entry').toBeUndefined();
    expect(location.hash).toBe('');
    expect(r.ran).not.toHaveBeenCalled();
    expect(r.frame.goto, 'the jump is not returned from: the reader place decided').not.toHaveBeenCalled();
  });

  it('reader place: overlay, Back, then a jump, then Exit steps over the two live entries only', async () => {
    const r = rig();
    enter(r);
    r.places.onPlace('overlay'); // O, idx 3
    expect(lastIdx()).toBe(3);
    history.back(); // X2 closes the figure; the page stands on R
    await until(() => { expect(r.frame.closeOverlay).toHaveBeenCalledTimes(1); expect(lastIdx()).toBe(2); });
    expect(r.reader.exits, 'Back onto the reader place is not an exit').toEqual([]);
    r.places.onHash('sec', { push: true, from: null, inGrammar: true }); // J, idx 4: O leaves the record with the entry
    expect(readPlaces().places.map((p) => p.idx)).toEqual([2, 4]);
    const go = vi.spyOn(history, 'go');
    expect(exitByHook(r), 'R and J, the two live entries').toBe(2);
    expect(go).toHaveBeenCalledWith(-2);
    await landed(1);
    expect(location.pathname).toBe(DOC_A);
    expect(idxNow(), 'the doc\'s own entry, not the one before it').toBe(1);
    expect(r.ran).not.toHaveBeenCalled();
  });

  it('places: a push drops the recorded places above lastIdx', async () => {
    const r = rig();
    r.places.onHash('a', { push: true, from: null, inGrammar: true }); // J1, idx 2
    r.places.onHash('b', { push: true, from: 'a', inGrammar: true }); // J2, idx 3
    expect(readPlaces().places.map((p) => p.idx)).toEqual([2, 3]);
    history.back(); // lands on J1: the frame is told to go back to where J2 left from
    await until(() => { expect(lastIdx()).toBe(2); expect(r.frame.goto).toHaveBeenCalledTimes(1); });
    r.places.onPlace('overlay');
    const places = readPlaces().places;
    expect(places.map((p) => p.idx), 'J2\'s entry was discarded by the push, so it left the record').toEqual([2, 4]);
    expect(readPlaces().seq, 'the budget still counts it').toBe(3);
    // The pure step: places above the entry pushed from leave, whatever their kind.
    const pushed = pushPlace(rec({ visit: 'v', places: [R, O], seq: 2, lastIdx: 2, next: 4 }), { kind: 'reader' }, { idx: 2 });
    expect(pushed.rec.places.map((p) => p.idx)).toEqual([2, 4]);
    expect(pushed.push).toEqual({ idx: 4, place: { visit: 'v', seq: 3, kind: 'reader' } });
  });

  it('reader place: Back with a figure overlay open closes it first, the next Back leaves reader mode', async () => {
    const r = rig();
    enter(r);
    r.places.onPlace('overlay');
    history.back();
    await until(() => { expect(r.frame.closeOverlay).toHaveBeenCalledTimes(1); expect(lastIdx()).toBe(2); });
    expect(r.reader.exits).toEqual([]);
    expect(r.reader.on, 'reader mode stays on').toBe(true);
    expect(r.ran).not.toHaveBeenCalled();
    history.back();
    await landed(1);
    expect(r.reader.exits).toEqual([false]);
    expect(r.frame.closeOverlay, 'nothing more to close').toHaveBeenCalledTimes(1);
    expect(r.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
  });

  it('reader place: Exit with a figure overlay open sends close-overlay once, on the step-back\'s pop', async () => {
    const r = rig();
    enter(r);
    r.places.onPlace('overlay');
    expect(exitByHook(r), 'the reader place and the figure').toBe(2);
    expect(r.frame.closeOverlay, 'not before the landing').not.toHaveBeenCalled();
    await landed(1);
    expect(r.frame.closeOverlay).toHaveBeenCalledTimes(1);
    expect(r.order, 'the figure closes before reader mode is told').toEqual(['close', 'exit']);
    expect(r.reader.exits).toEqual([true]);
    expect(readPlaces().exitPending).toBe(false);
    expect(r.ran).not.toHaveBeenCalled();
  });

  it('reader place: a Back during a same-document remount still exits', async () => {
    const r = rig({ frameHost: false });
    enter(r);
    history.back();
    await landed(1);
    expect(r.reader.exits, 'the reader host answered, the frame\'s slot being empty').toEqual([false]);
    expect(r.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    // With a figure open too, the empty frame slot simply sends nothing.
    enter(r);
    r.places.onPlace('overlay');
    history.go(-2);
    await landed(1);
    expect(r.reader.exits).toEqual([false, true]);
    expect(r.ran).not.toHaveBeenCalled();
  });

  it('reader place: a stale reader place after leaving the doc costs no Back', async () => {
    const r = rig();
    enter(r);
    r.reader.on = false;
    // The user follows the page to another screen: a routed push, then the doc's body ends and the visit with it.
    history.pushState(null, '', '/other');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(r.ran).toHaveBeenCalledTimes(1);
    r.places.end();
    expect(readPlaces().visit, 'the visit ended').toBeNull();
    // Back lands on the dead reader entry of an ended visit: stepped over at once, onto the doc's own entry.
    history.back();
    await until(() => { expect(r.ran).toHaveBeenCalledTimes(2); });
    expect(location.pathname).toBe(DOC_A);
    expect(idxNow()).toBe(1);
    expect(r.reader.exits).toEqual([]);
    expect(r.reader.dead).toBe(0);
  });

  it('reader place: a pop below the reader place after Chromium skipped it still exits', async () => {
    const r = rig();
    r.places.onHash('sec', { push: true, from: null, inGrammar: true }); // J, idx 2
    enter(r); // R, idx 3
    expect(lastIdx()).toBe(3);
    history.go(-2); // an engine that stepped over the entry between lands two below the place
    await landed(1);
    expect(r.reader.exits).toEqual([false]);
    expect(r.ran).not.toHaveBeenCalled();
    expect(readPlaces().exitPending).toBe(false);
    expect(location.pathname).toBe(DOC_A);
  });

  it('reader place: counts toward PLACES_MAX', () => {
    const r = rig();
    for (let i = 0; i < PLACES_MAX - 1; i += 1) r.places.onPlace('overlay');
    expect(readPlaces().seq).toBe(PLACES_MAX - 1);
    expect(readerPlaceFreeNow(), 'one place of the budget is left').toBe(true);
    const length = history.length;
    expect(pushReaderPlace(), 'the 20th, a reader place').toBe(true);
    expect(history.length).toBe(length + 1);
    expect(readerPlaceFreeNow()).toBe(false);
    expect(pushReaderPlace(), 'the 21st is refused').toBe(false);
    r.places.onPlace('overlay');
    expect(history.length, 'a frame place is refused too').toBe(length + 1);
    expect(readPlaces().places).toHaveLength(PLACES_MAX);
    expect(readPlaces().places.filter((p) => p.kind === 'reader')).toHaveLength(1);
  });

  it('reader place: the pushed entry\'s URL is the doc\'s current URL and keeps the only base', () => {
    const r = rig({ url: `${DOC_A}?ref=x#sec-1` });
    history.replaceState({ ...stateNow(), day: 'mon' }, '');
    const before = location.href;
    enter(r);
    expect(location.href, 'the same address, fragment included').toBe(before);
    expect(stateNow().day, 'the current state is copied').toBe('mon');
    expect(idxNow(), 'a number of its own').toBe(2);
    const place = stateNow()[PLACE_KEY] as { visit: string; seq: number; kind: string };
    expect(place).toMatchObject({ seq: 1, kind: 'reader' });
    expect(place.visit).toBe(readPlaces().visit);
    expect(readPlaces().baseIdx, 'the base is the doc\'s own entry, not the reader\'s').toBe(1);
    expect(readPlaces().places).toEqual([{ seq: 1, kind: 'reader', idx: 2 }]);
  });

  it('reader place: losing full screen with no engine pop and a figure overlay open consumes the step-back\'s landing and sends close-overlay once', async () => {
    const r = rig();
    enter(r);
    r.places.onPlace('overlay');
    // Full screen is lost: reader mode ends and the record expects the exit's landing through the settle.
    r.reader.on = false;
    markReaderExitPending(true);
    expect(readPlaces().exitPending).toBe(true);
    expect(landedBelowReaderPlace(), 'no engine pop landed below the place').toBe(false);
    // The settle ends: the step-back is made, and the record still expects its landing.
    expect(stepBelowReaderPlace()).toBe(2);
    expect(readPlaces().exitPending, 'kept set through the step-back').toBe(true);
    await landed(1);
    expect(r.frame.closeOverlay).toHaveBeenCalledTimes(1);
    expect(r.reader.exits, 'the landing was the exit\'s, not X2\'s').toEqual([true]);
    expect(readPlaces().exitPending).toBe(false);
    expect(r.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
  });

  it('reader place: an engine\'s own Back within the settle is the exit, and the settle then steps nothing', async () => {
    const r = rig();
    enter(r);
    r.reader.on = false;
    markReaderExitPending(true); // full screen lost
    history.back(); // the engine's own Back, inside the settle
    await landed(1);
    expect(r.reader.exits).toEqual([false]);
    expect(readPlaces().exitPending).toBe(false);
    expect(landedBelowReaderPlace(), 'the settle finds the pop already landed below').toBe(true);
    expect(r.ran).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The pure half and the record.

describe('reader place: the record and its helpers', () => {
  it('parseRecord: baseIdx and exitPending round-trip, and an older record without them reads null and false', () => {
    const full = rec({ visit: 'v', doc: '/docs/a', places: [R], seq: 1, lastIdx: 2, next: 3, baseIdx: 1, exitPending: true });
    expect(parseRecord(JSON.stringify(full))).toEqual(full);
    expect(parseRecord(JSON.stringify({ ...full, baseIdx: null, exitPending: false }))).toMatchObject({ baseIdx: null, exitPending: false });
    const { baseIdx: _b, exitPending: _e, ...older } = full;
    expect(parseRecord(JSON.stringify(older))).toEqual({ ...full, baseIdx: null, exitPending: false });
    for (const broken of [
      { ...full, baseIdx: -1 }, { ...full, baseIdx: 'x' }, { ...full, baseIdx: 1.5 }, { ...full, exitPending: 1 }, { ...full, exitPending: 'true' },
      { ...full, exitPending: null }, { ...full, places: [{ ...R, kind: 'figure' }] },
    ]) expect(parseRecord(JSON.stringify(broken)), JSON.stringify(broken)).toEqual(EMPTY_RECORD);
    expect(EMPTY_RECORD).toMatchObject({ baseIdx: null, exitPending: false });
  });

  it('reader place: the visit\'s start resets the base and the pending mark, and stamps no base itself', () => {
    const open = rec({ visit: 'v1', doc: '/docs/a', places: [R], seq: 1, lastIdx: 2, next: 3, baseIdx: 1, exitPending: true });
    const cont = beginVisit(open, '/docs/a', 'v2', { idx: 2 });
    expect(cont.rec, 'a continued visit leaves both as they were').toMatchObject({ baseIdx: 1, exitPending: true });
    const fresh = beginVisit(open, '/docs/b', 'v2', { idx: 4 });
    expect(fresh.rec).toMatchObject({ baseIdx: null, exitPending: false });
    expect(stampVisitBase(fresh, { idx: 4 })).toEqual({ ...fresh.rec, baseIdx: 4 });
    expect(fresh.rec.baseIdx, 'the input is not changed').toBeNull();
    expect(stampVisitBase(cont, { idx: 2 }), 'a continued visit is left as it was').toBe(cont.rec);
    const numbered = beginVisit(open, '/docs/b', 'v2', { idx: null });
    expect(numbered.stamp).toBe(3);
    expect(stampVisitBase(numbered, { idx: null }).baseIdx, 'an entry numbered by the start: the stamp').toBe(3);
    expect(stampVisitBase({ rec: open, continued: false, stamp: null }, { idx: null }), 'no number at all: untouched').toBe(open);
    expect(endVisit(open)).toMatchObject({ baseIdx: null, exitPending: false, visit: null });
  });

  it('reader place: the pure helpers answer from the record alone', () => {
    const open = rec({ visit: 'v', doc: '/docs/a', places: [R, O], seq: 2, lastIdx: 3, next: 4, baseIdx: 1 });
    expect(readerPlaceOf(open)).toEqual(R);
    expect(readerPlaceOf(rec({ places: [O], lastIdx: 3 }))).toBeNull();
    expect(readerStepBack(open), 'n only: the mark is the hook\'s to set').toEqual({ rec: open, n: 2 });
    expect(readerStepBack(rec({ places: [O], lastIdx: 3 }))).toMatchObject({ n: 0 });
    expect(open.exitPending, 'the input is not changed').toBe(false);
    const below = { ...open, lastIdx: 1 };
    expect(landedBelowReader(below), 'a pop already landed below the place').toBe(true);
    expect(landedBelowReader(open)).toBe(false);
    expect(landedBelowReader(rec({ places: [O], lastIdx: 0 }))).toBe(false);
    const mine = { visit: 'v', seq: 1, kind: 'reader' as const };
    expect(standingOnDeadReader(open, false, mine), 'reader mode off, on a place of this visit above a reader place').toBe(true);
    expect(standingOnDeadReader(open, true, mine)).toBe(false);
    expect(standingOnDeadReader(withExitPending(open, true), false, mine), 'a step is already on its way').toBe(false);
    expect(standingOnDeadReader(below, false, mine)).toBe(false);
    expect(standingOnDeadReader(open, false, null), 'a plain entry is no dead reader entry').toBe(false);
    expect(standingOnDeadReader(open, false, { ...mine, visit: 'old' }), 'a place of another visit is not either').toBe(false);
    expect(readerPlaceFree(open)).toBe(true);
    expect(readerPlaceFree({ ...open, seq: PLACES_MAX })).toBe(false);
    expect(readerPlaceFree(rec())).toBe(false);
    expect(withExitPending(open, true)).toEqual({ ...open, exitPending: true });
    expect(withExitPending({ ...open, exitPending: true }, false).exitPending).toBe(false);
  });

  it('reader place: afterPop clears exitPending for exit-reader only, and numbers like any decision with an index', () => {
    const pending = rec({ visit: 'v', places: [R], lastIdx: 2, next: 3, exitPending: true, pendingSeq: 1, skips: 2, skipDir: 'back' });
    const exit = afterPop(pending, entry(1), { kind: 'exit-reader', closeOverlay: false, route: false });
    expect(exit).toEqual({ rec: { ...pending, lastIdx: 1, next: 3, exitPending: false, pendingSeq: null, skips: 0, skipDir: null, top: null }, stamp: null });
    const dead = afterPop(pending, entry(3), { kind: 'leave-dead-reader' });
    expect(dead.rec).toMatchObject({ lastIdx: 3, next: 4, exitPending: true, pendingSeq: null, skips: 0, skipDir: null });
    for (const d of [{ kind: 'router' }, { kind: 'consume' }, { kind: 'close-overlay' }, { kind: 'skip', dir: 'back' }] as PopDecision[]) {
      expect(afterPop(pending, entry(1), d).rec.exitPending, d.kind).toBe(true);
    }
  });

  it('reader place: the place helpers of the page read and write the record through the dispatcher', () => {
    const r = rig();
    expect(standingOnDeadReaderEntry(false), 'no reader place yet').toBe(false);
    enter(r);
    expect(standingOnDeadReaderEntry(false)).toBe(true);
    expect(standingOnDeadReaderEntry(true)).toBe(false);
    markReaderExitPending(true);
    expect(readPlaces().exitPending).toBe(true);
    markReaderExitPending(false);
    expect(readPlaces().exitPending).toBe(false);
  });

  it('reader place: an exit steps over the entry the tab stands on when no recorded place holds it (X6 XR fix round 1, item 4)', () => {
    const address = '/docs/demo/specs/a.md';
    // The visit starts on entry 1, reader mode pushes R at entry 2, a jump pushes J at entry 3.
    let r = beginVisit(rec({ next: 0 }), visitKey(address, 'k1'), 'v1', { idx: 1 }).rec;
    r = stampVisitBase({ rec: r, continued: false, stamp: null }, { idx: 1 });
    r = pushPlace(r, { kind: 'reader' }, { idx: 1 }).rec;
    r = pushPlace(r, { kind: 'jump', id: 'j' }, { idx: 2 }).rec;
    expect(r).toMatchObject({ lastIdx: 3, top: 3, baseIdx: 1 });
    // Back to R, then a new commit of the same document: the new visit carries only R across.
    const toR = entry(2, { visit: 'v1', seq: 1, kind: 'reader' });
    r = afterPop(r, toR, decidePop(toR, tabOf(r, true), true)).rec;
    expect(r.lastIdx).toBe(2);
    r = beginVisit(r, visitKey(address, 'k2'), 'v2', { idx: 2, place: { visit: 'v1', seq: 1, kind: 'reader' } }).rec;
    expect(r.places.map((p) => p.kind), 'only the reader place was carried').toEqual(['reader']);
    // Forward onto the jump's entry: a place of the old visit, the newest entry the tab holds, so the router's.
    const toJ = entry(3, { visit: 'v1', seq: 2, kind: 'jump', id: 'j' });
    const forward = decidePop(toJ, tabOf(r, true), false);
    expect(forward, 'CONTROL: the router\'s, as the stale newest entry is').toEqual({ kind: 'router' });
    r = afterPop(r, toJ, forward).rec;
    expect(r.lastIdx).toBe(3);
    // Exit: one step over R is not enough, the tab stands on an entry above it. Two land on entry 1, below the reader place.
    expect(readerStepBack(r).n).toBe(2);
  });

  // ── X6 XR fix round 1, item 4, review I1: more than one entry the record does not hold above the reader place ──

  const ADDRESS = '/docs/demo/specs/a.md';
  const RETAGGED = { visit: 'v2', seq: 1, kind: 'reader' as const };
  /** A live history entry: its number and the place its state carries. */
  interface Live { readonly idx: number; readonly place?: { visit: string; seq: number; kind: 'overlay' | 'jump' | 'reader'; id?: string } }

  /** The path of item 4: the visit starts on entry 1, R is pushed at 2, one jump per id above it, then Back to R and a new commit
   *  of the same document (the new visit carries only R across). Answers the record and the entries the tab's history holds. */
  function reopenedAtReader(ids: readonly string[]): { rec: TabRecord; live: Live[] } {
    let r = beginVisit(rec({ next: 0 }), visitKey(ADDRESS, 'k1'), 'v1', { idx: 1 }).rec;
    r = stampVisitBase({ rec: r, continued: false, stamp: null }, { idx: 1 });
    const live: Live[] = [{ idx: 1 }];
    r = pushPlace(r, { kind: 'reader' }, { idx: 1 }).rec;
    live.push({ idx: 2, place: { visit: 'v1', seq: 1, kind: 'reader' } });
    ids.forEach((id, i) => {
      r = pushPlace(r, { kind: 'jump', id }, { idx: 2 + i }).rec;
      live.push({ idx: 3 + i, place: { visit: 'v1', seq: 2 + i, kind: 'jump', id } });
    });
    const toR = entry(2, live[1]!.place);
    r = afterPop(r, toR, decidePop(toR, tabOf(r, true), true)).rec;
    r = beginVisit(r, visitKey(ADDRESS, 'k2'), 'v2', { idx: 2, place: { visit: 'v1', seq: 1, kind: 'reader' } }).rec;
    live[1] = { idx: 2, place: RETAGGED };   // the new visit re-tags the reader place it took over (`startPlaces`'s `retag`)
    return { rec: r, live };
  }

  /** Forward through every entry above the tab's, as the dispatcher answers each, up to the newest. */
  function forwardTo(r: TabRecord, live: readonly Live[], idx: number): TabRecord {
    let at = live.findIndex((e) => e.idx === r.lastIdx);
    let now = r;
    for (let i = 0; i < 6 && live[at]!.idx !== idx; i += 1) {
      const popped = entry(live[at + 1]!.idx, live[at + 1]!.place);
      const d = decidePop(popped, tabOf(now, true), false);
      now = afterPop(now, popped, d).rec;
      at = d.kind === 'skip' ? at + 1 : live.findIndex((e) => e.idx === now.lastIdx);
    }
    return now;
  }

  /** An exit that is not a pop, as the hook makes it: the mark is set, one `history.go(-n)` over the entries, and every pop that
   *  follows is decided and recorded as the dispatcher does, a skip stepping once more, until a decision that is not a skip. */
  function exitWalk(r: TabRecord, live: readonly Live[]): { kinds: string[]; final: PopDecision } {
    let now = withExitPending(r, true);
    let at = live.findIndex((e) => e.idx === now.lastIdx) - readerStepBack(now).n;
    const kinds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const popped = entry(live[at]!.idx, live[at]!.place);
      const d = decidePop(popped, tabOf(now, true), false);
      kinds.push(d.kind);
      now = afterPop(now, popped, d).rec;
      if (d.kind !== 'skip') return { kinds, final: d };
      at += d.dir === 'back' ? -1 : 1;
    }
    throw new Error('the exit never settled');
  }

  it('reader place: two entries the record does not hold above the reader place: an exit still lands below it (review I1 a)', () => {
    const { rec: opened, live } = reopenedAtReader(['j1', 'j2']);
    // Forward: the first jump is stale below the newest entry (skipped over), the second is stale and newest (the router's).
    const r = forwardTo(opened, live, 4);
    expect(r.lastIdx, 'CONTROL: the tab stands on the second jump').toBe(4);
    expect(r.places.map((p) => p.kind), 'CONTROL: the record holds only the reader place').toEqual(['reader']);
    const walk = exitWalk(r, live);
    expect(walk.final, `the exit crossed the reader place (${walk.kinds.join(', ')})`).toEqual({ kind: 'exit-reader', closeOverlay: false, route: false });
    expect(walk.kinds.at(-2), 'the landing on the reader place was stepped over').toBe('skip');
  });

  it('reader place: a frame jump above an entry the record does not hold: an exit lands below the reader place and scrolls nothing (review I1 b)', () => {
    const { rec: opened, live } = reopenedAtReader(['j']);
    let r = forwardTo(opened, live, 3);
    expect(r.lastIdx, 'CONTROL: the tab stands on the jump').toBe(3);
    // One more jump of the frame: the push drops the places above the entry it is pushed from, and the entry it stands on is not recorded.
    r = pushPlace(r, { kind: 'jump', id: 'j2', from: 'f' }, { idx: 3, place: { visit: 'v1', seq: 2, kind: 'jump', id: 'j' } }).rec;
    live.push({ idx: r.lastIdx, place: { visit: 'v2', seq: r.seq, kind: 'jump', id: 'j2' } });
    expect(r.places.map((p) => p.kind), 'CONTROL: the record holds the reader place and the new jump').toEqual(['reader', 'jump']);
    const walk = exitWalk(r, live);
    expect(walk.kinds, 'a landing on the reader place answered the frame (a scroll)').not.toContain('goto');
    expect(walk.final, `the exit crossed the reader place (${walk.kinds.join(', ')})`).toEqual({ kind: 'exit-reader', closeOverlay: false, route: false });
  });

  it('reader place: the exit\'s extra step over unheld entries is a skip, bounded by SKIPS_MAX like any other (review I1)', () => {
    const t = tab({ visit: 'v', places: [R], lastIdx: 9, exitPending: true, skips: 0, skipDir: null });
    const landing = entry(2, { visit: 'v', seq: 1, kind: 'reader' });
    expect(decidePop(landing, t, false), 'CONTROL: seven entries crossed, none held').toEqual({ kind: 'skip', dir: 'back' });
    expect(decidePop(landing, { ...t, skips: SKIPS_MAX, skipDir: 'back' }, false).kind, 'the run of skips is spent').not.toBe('skip');
    expect(decidePop(landing, { ...t, exitPending: false }, false).kind, 'no exit is pending: not the exit\'s').not.toBe('skip');
    expect(decidePop(landing, { ...t, places: [R, { seq: 2, kind: 'jump', idx: 3, id: 'j' }], lastIdx: 3 }, false).kind,
      'every entry crossed is held: X2\'s answer').not.toBe('skip');
  });
});
