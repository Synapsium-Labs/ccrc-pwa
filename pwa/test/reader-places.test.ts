// Back places, part A (X2 P5.3, D-8763; parity spec 4.7; plan Task P5.3 Step 1): the pure decider (`lib/historyPlaces.ts`),
// the page's one `popstate` dispatcher (`lib/popstate.ts`) and the three listeners moved onto it (`useLocation`,
// `useReaderOnly`, the release gate). The places the reader pushes and the frame's own commands are part B's.
//
// The dispatcher cases drive the real `history` and the real window event. A pop is made either by a real traversal
// (`history.back()`, which jsdom fires a task later) or by standing the page on an entry (`replaceState`) and firing the
// `popstate` the browser would, which is synchronous and lets `history.back`/`history.forward` be spied without stepping.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, Fragment, type ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  EMPTY_RECORD, IDX_KEY, PLACES_MAX, PLACES_RECORD_KEY, PLACE_KEY, afterPop, beginVisit, closedByFrame, decidePop,
  endVisit, parseRecord, pushPlace, readEntry, seedPage, type PopDecision, type Place, type PopTab, type TabRecord,
} from '../src/lib/historyPlaces';
import { onPop, readPlaces, resetPopstateForTests, setPlaceHost, writePlaces } from '../src/lib/popstate';
import { navigate, useLocation, type Loc } from '../src/lib/router';
import { useReaderOnly } from '../src/docs/readerHistory';
import { noteActivated, resetReloadGateForTests, startReloadGate, type ReloadActs } from '../src/lib/swupdate';
import { tabStorage, writeKey } from '../src/lib/storage';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures.

const T0 = 1_000_000;
let now = T0;
let acts: { reload: ReturnType<typeof vi.fn>; go: ReturnType<typeof vi.fn>; now: () => number };

beforeEach(() => {
  now = T0;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => true);
  acts = { reload: vi.fn(), go: vi.fn(), now: () => now };
  resetPopstateForTests();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  resetReloadGateForTests();
  resetPopstateForTests();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

const rec = (o: Partial<TabRecord> = {}): TabRecord => ({ ...EMPTY_RECORD, places: [], ...o });
const OVL: Place = { seq: 1, kind: 'overlay', idx: 1 };
const JMP: Place = { seq: 2, kind: 'jump', idx: 2, id: 'j2', from: 'f2' };
/** A history entry's state: numbered, and a place of `visit` when `place` says so. */
const entry = (idx: number, place?: { visit: string; seq: number; kind: 'overlay' | 'jump'; id?: string; from?: string }): object => ({
  [IDX_KEY]: idx,
  ...(place === undefined ? {} : { [PLACE_KEY]: place }),
});
const stale = (idx: number, seq = 1): object => entry(idx, { visit: 'old', seq, kind: 'overlay' });

/** Stand the page on an entry, without a pop. */
const at = (state: unknown, url = '/docs/a'): void => history.replaceState(state, '', url);
/** The pop a browser fires on a traversal, synchronously. */
const firePop = (): void => { act(() => { dispatchEvent(new PopStateEvent('popstate')); }); };

/** Records every value `useLocation()` hands a render. */
function LocProbe({ seen }: { seen: Loc[] }): ReactNode {
  seen.push(useLocation());
  return null;
}
function OnlyProbe({ seen }: { seen: (string | null)[] }): ReactNode {
  seen.push(useReaderOnly());
  return null;
}
const last = <T,>(xs: readonly T[]): T => {
  expect(xs.length).toBeGreaterThan(0);
  return xs[xs.length - 1] as T;
};

/** The mounted listeners the dispatcher serves: three `useLocation` probes, a `useReaderOnly` probe, the release gate,
 *  and a plain subscriber that counts every run. The gate is armed (activated, then quiet past its window), so a pop it
 *  hears across a path move reloads: its `reload` act is its evidence. */
function mountEverything(armed = false): { locs: Loc[][]; only: (string | null)[]; ran: ReturnType<typeof vi.fn> } {
  const locs: Loc[][] = [[], [], []];
  const only: (string | null)[] = [];
  render(
    createElement(
      Fragment,
      null,
      createElement(LocProbe, { seen: locs[0] as Loc[] }),
      createElement(LocProbe, { seen: locs[1] as Loc[] }),
      createElement(LocProbe, { seen: locs[2] as Loc[] }),
      createElement(OnlyProbe, { seen: only }),
    ),
  );
  startReloadGate(acts as ReloadActs);
  if (armed) {
    noteActivated();
    now = T0 + 20_000;
  }
  const ran = vi.fn();
  onPop(ran);
  return { locs, only, ran };
}
const locCounts = (m: ReturnType<typeof mountEverything>): number[] => m.locs.map((l) => l.length);
const renders = (m: ReturnType<typeof mountEverything>): number[] => [...locCounts(m), m.only.length];

// ---------------------------------------------------------------------------------------------------------------------
// The dispatcher.

describe('popstate: the one dispatcher', () => {
  it('popstate: a skipped or consumed pop runs no listener and steps history once', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const forward = vi.spyOn(history, 'forward').mockImplementation(() => undefined);
    at(entry(0), '/docs/a');
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 0, next: 5 }));
    const m = mountEverything(true);
    const before = renders(m);

    // A stale place popped going Back: one `history.back()`, nothing else hears it.
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 3, next: 5 }));
    at(stale(2), '/runs');                   // another screen: a pop the gate heard would reload
    firePop();
    expect(back, 'one step back').toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(m.ran, 'no subscriber ran').not.toHaveBeenCalled();
    expect(acts.reload, 'the release gate did not hear it').not.toHaveBeenCalled();
    expect(renders(m), 'no hook re-rendered').toEqual(before);

    // The same going Forward: one `history.forward()`.
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 1, next: 5 }));
    at(stale(2), '/runs');
    firePop();
    expect(forward, 'one step forward').toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(m.ran).not.toHaveBeenCalled();
    expect(renders(m)).toEqual(before);

    // A consumed pop: the console's own back landed where it expected. No step, no listener.
    writePlaces(rec({
      visit: 'now', doc: '/docs/a', places: [{ seq: 1, kind: 'overlay', idx: 1 }], seq: 1, pendingSeq: 0, lastIdx: 1, next: 5,
    }));
    at(entry(0), '/runs');
    firePop();
    expect(m.ran).not.toHaveBeenCalled();
    expect(acts.reload).not.toHaveBeenCalled();
    expect(renders(m)).toEqual(before);
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(readPlaces().pendingSeq, 'the landing ended the wait').toBeNull();

    // The control: an ordinary pop on the same page runs every listener (the entry carries a day filter, so the
    // reader's probe has something to change to).
    at({ ...entry(0), ccrcReaderOnly: 'day' }, '/runs');
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 3, next: 5 }));
    firePop();
    expect(m.ran).toHaveBeenCalledTimes(1);
    expect(acts.reload).toHaveBeenCalledTimes(1);
    expect(locCounts(m), 'each location hook re-rendered once').toEqual(before.slice(0, 3).map((n) => n + 1));
    expect(last(m.only), 'and the reader\'s hook read the entry').toBe('day');
  });

  it('popstate: a router pop runs every listener once, in subscription order', () => {
    const order: string[] = [];
    onPop(() => order.push('a'));
    onPop(() => order.push('b'));
    const m = mountEverything(true);
    onPop(() => order.push('c'));
    const before = renders(m);
    at({ ccrcReaderOnly: 'day' }, '/docs/b');
    firePop();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(m.ran).toHaveBeenCalledTimes(1);
    expect(acts.reload, 'the gate heard the path move once').toHaveBeenCalledTimes(1);
    expect(locCounts(m), 'each location hook re-rendered once').toEqual(before.slice(0, 3).map((n) => n + 1));
    expect(last(m.only), 'and the reader\'s hook read the entry').toBe('day');
    expect(last(m.locs[0] as Loc[])).toEqual({ path: '/docs/b', search: '' });
    firePop();
    expect(order, 'a second pop is a second run, not a repeat of the first').toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('popstate: navigate updates every mounted hook before it returns', () => {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const m = mountEverything();
    history.replaceState({ ccrcReaderOnly: 'day' }, '', '/docs/p');
    firePop();
    expect(last(m.only)).toBe('day');
    env.IS_REACT_ACT_ENVIRONMENT = false;      // no act(): the update must be flushed by navigate's own flushSync
    try {
      navigate('/docs/q?ref=x');
      for (const l of m.locs) expect(last(l)).toEqual({ path: '/docs/q', search: '?ref=x' });
      expect(last(m.only), 'the reader\'s hook read the new entry, which holds no filter').toBeNull();
      expect(m.ran, 'the setup pop, then navigate\'s').toHaveBeenCalledTimes(2);
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it('popstate: a place\'s pop acts on the host and runs no listener', () => {
    const host = { closeOverlay: vi.fn(), goto: vi.fn() };
    setPlaceHost(host);
    const m = mountEverything();
    const before = renders(m);
    // Back off an overlay place onto the base.
    writePlaces(rec({ visit: 'now', doc: '/docs/a', places: [{ seq: 1, kind: 'overlay', idx: 1 }], seq: 1, lastIdx: 1, next: 2 }));
    at(entry(0), '/docs/a');
    firePop();
    expect(host.closeOverlay).toHaveBeenCalledTimes(1);
    // Back off a jump place: the frame goes back to its from token.
    writePlaces(rec({ visit: 'now', doc: '/docs/a', places: [{ seq: 1, kind: 'jump', idx: 1, id: 'sec-2', from: 'tok' }], seq: 1, lastIdx: 1, next: 2 }));
    at(entry(0), '/docs/a');
    firePop();
    expect(host.goto).toHaveBeenCalledWith('sec-2', 'tok');
    expect(m.ran).not.toHaveBeenCalled();
    expect(renders(m)).toEqual(before);
  });

  it('popstate: only lib/popstate.ts adds a popstate listener in pwa/src', () => {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const listed = execFileSync('git', ['ls-files', 'pwa/src'], { cwd: top, encoding: 'utf8' }).split('\n').filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f));
    expect(listed.length, 'the listing found the sources').toBeGreaterThan(100);
    const adds = (src: string): boolean =>
      /(?:add|remove)EventListener(?:\?\.)?\(\s*['"`]popstate['"`]/.test(src) || /\bonpopstate\b/.test(src);
    const offenders = (files: Record<string, string>): string[] =>
      Object.keys(files).filter((f) => f !== 'pwa/src/lib/popstate.ts' && adds(files[f] as string));
    // `git ls-files` names the tracked files; an untracked new one is read too, so a copy not yet added cannot hide.
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'pwa/src'], { cwd: top, encoding: 'utf8' })
      .split('\n').filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f));
    const files: Record<string, string> = {};
    for (const f of [...listed, ...untracked]) files[f] = readFileSync(join(top, f), 'utf8');
    expect(offenders(files)).toEqual([]);
    expect(adds(files['pwa/src/lib/popstate.ts'] as string), 'the dispatcher is the one that does').toBe(true);
    // The control: the same matcher over planted sources sees each shape red.
    for (const planted of [
      "window.addEventListener('popstate', on);",
      'addEventListener("popstate", on)',
      "addEventListener(\n  'popstate', on)",
      'window.onpopstate = on;',
      "window.addEventListener?.('popstate', on);",
      "removeEventListener('popstate', on);",
    ]) {
      expect(offenders({ ...files, 'pwa/src/lib/planted.ts': planted }), planted).toEqual(['pwa/src/lib/planted.ts']);
    }
    expect(offenders({ ...files, 'pwa/src/lib/planted.ts': "dispatchEvent(new PopStateEvent('popstate'));" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The places, through the real history.

describe('places: the dispatcher over real history', () => {
  it('places: an entry with no docsPlace goes to the router', () => {
    const host = { closeOverlay: vi.fn(), goto: vi.fn() };
    setPlaceHost(host);
    const m = mountEverything();
    // With a record that holds places and a host, an unnumbered entry and a numbered one with no place are still the router's.
    writePlaces(rec({ visit: 'now', doc: '/docs/a', places: [OVL], seq: 1, lastIdx: 5, next: 6 }));
    at({ other: 1 }, '/docs/b');
    firePop();
    expect(m.ran).toHaveBeenCalledTimes(1);
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 5, next: 6 }));
    at(entry(2), '/docs/c');
    firePop();
    expect(m.ran).toHaveBeenCalledTimes(2);
    expect(host.closeOverlay).not.toHaveBeenCalled();
    expect(host.goto).not.toHaveBeenCalled();
  });

  it('places: router synthetic popstate not consumed', () => {
    const m = mountEverything();
    // A pending back is set; the router's own `navigate` pops on a fresh unnumbered entry, and every listener runs.
    writePlaces(rec({
      visit: 'now', doc: '/docs/a', places: [{ seq: 1, kind: 'overlay', idx: 1 }], seq: 1, pendingSeq: 0, lastIdx: 1, next: 2,
    }));
    act(() => { navigate('/runs'); });
    expect(m.ran, 'the synthetic pop ran the subscribers').toHaveBeenCalledTimes(1);
    expect(last(m.locs[0] as Loc[]).path).toBe('/runs');
    // And the decider says so for an entry with no index, however the tab stands.
    for (const pendingSeq of [null, 0, 3]) {
      expect(decidePop(null, { visit: 'now', places: [OVL], pendingSeq, lastIdx: 1, skips: 0, skipDir: null, host: true })).toEqual({ kind: 'router' });
      expect(decidePop({ other: 1 }, { visit: 'now', places: [OVL], pendingSeq, lastIdx: 1, skips: 0, skipDir: null, host: true })).toEqual({ kind: 'router' });
    }
  });

  it('places: every routed entry gains a docsIdx and keeps its state', () => {
    mountEverything();
    at({ other: 1 }, '/docs/a?ref=b#frag');
    firePop();
    const first = history.state as Record<string, unknown>;
    expect(first.other, 'its own state kept').toBe(1);
    expect(typeof first.docsIdx).toBe('number');
    expect(location.pathname + location.search + location.hash, 'its URL kept').toBe('/docs/a?ref=b#frag');
    at({ other: 2 }, '/docs/b');
    firePop();
    const second = history.state as Record<string, unknown>;
    expect(second.other).toBe(2);
    expect(second.docsIdx as number).toBeGreaterThan(first.docsIdx as number);
    // A router pop on a numbered entry restamps nothing.
    const kept = history.state;
    firePop();
    expect(history.state).toEqual(kept);
  });

  it('places: Back into a doc\'s base entry keeps its docsIdx', async () => {
    const m = mountEverything();
    act(() => { navigate('/docs/a'); });
    const idxA = (history.state as Record<string, unknown>).docsIdx;
    expect(typeof idxA).toBe('number');
    act(() => { navigate('/docs/b'); });
    const idxB = (history.state as Record<string, unknown>).docsIdx as number;
    expect(idxB).toBeGreaterThan(idxA as number);
    const nextBefore = readPlaces().next;
    history.back();
    await waitFor(() => expect(location.pathname).toBe('/docs/a'));
    expect((history.state as Record<string, unknown>).docsIdx, 'not restamped').toBe(idxA);
    expect(readPlaces().next, 'nothing handed out for it').toBe(nextBefore);
    expect(readPlaces().lastIdx).toBe(idxA);
    expect(last(m.locs[0] as Loc[]).path).toBe('/docs/a');
  });

  it('places: after a reload, stale places are skipped in both directions', async () => {
    // Four entries: an earlier doc's base, two places its ended visit left, and the doc now shown (a new visit).
    history.replaceState(entry(0), '', '/docs/a');
    history.pushState(entry(1, { visit: 'old', seq: 1, kind: 'overlay' }), '', '/docs/a');
    history.pushState(entry(2, { visit: 'old', seq: 2, kind: 'jump', id: 'j', from: 'f' }), '', '/docs/a');
    history.pushState(entry(3), '', '/docs/b');
    // A fresh page: this module state is new and the tab's record is read from storage.
    resetPopstateForTests();
    writeKey(PLACES_RECORD_KEY, JSON.stringify(rec({ visit: 'now', doc: '/docs/b', lastIdx: 3, next: 4 })), tabStorage);
    setPlaceHost({ closeOverlay: vi.fn(), goto: vi.fn() });
    const m = mountEverything();
    const back = vi.spyOn(history, 'back');
    const forward = vi.spyOn(history, 'forward');

    history.back();
    await waitFor(() => expect(location.pathname).toBe('/docs/a'));
    await waitFor(() => expect((history.state as Record<string, unknown>).docsIdx).toBe(0));
    expect(back, 'the test\'s step and one skip for each of the two places').toHaveBeenCalledTimes(3);
    expect(m.ran, 'one run for the whole move').toHaveBeenCalledTimes(1);

    history.forward();
    await waitFor(() => expect((history.state as Record<string, unknown>).docsIdx).toBe(3));
    expect(location.pathname).toBe('/docs/b');
    expect(forward, 'the test\'s step and one skip for each of the two places').toHaveBeenCalledTimes(3);
    expect(m.ran, 'one more run for the way forward').toHaveBeenCalledTimes(2);
    expect(back).toHaveBeenCalledTimes(3);
  });

  it('places: stale places at the top of history: a skip that cannot step updates lastIdx, so the next Back skips back', async () => {
    history.replaceState(entry(0), '', '/docs/a');
    history.pushState(entry(1, { visit: 'old', seq: 1, kind: 'overlay' }), '', '/docs/a');
    history.pushState(entry(2, { visit: 'old', seq: 2, kind: 'overlay' }), '', '/docs/a');
    // Stand on the base again before anything listens, then read the record as a fresh page would.
    const landed = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    history.go(-2);
    await landed;
    expect((history.state as Record<string, unknown>).docsIdx).toBe(0);
    resetPopstateForTests();
    writeKey(PLACES_RECORD_KEY, JSON.stringify(rec({ visit: 'now', doc: '/docs/a', lastIdx: 0, next: 3 })), tabStorage);
    setPlaceHost({ closeOverlay: vi.fn(), goto: vi.fn() });
    const m = mountEverything();
    const forward = vi.spyOn(history, 'forward');
    const back = vi.spyOn(history, 'back');

    history.forward();                       // the test's step; the dispatcher then skips twice, the second at the top
    await waitFor(() => expect(forward).toHaveBeenCalledTimes(3));
    await waitFor(() => expect((history.state as Record<string, unknown>).docsIdx).toBe(2));
    expect(m.ran).not.toHaveBeenCalled();
    expect(readPlaces().lastIdx, 'the skip that could not step still counted as shown').toBe(2);

    history.back();                          // one Back from the top: the stale place below is stepped over to the base
    await waitFor(() => expect((history.state as Record<string, unknown>).docsIdx).toBe(0));
    expect(back, 'the test\'s step and one skip').toHaveBeenCalledTimes(2);
    expect(forward, 'no step forward again: the Back was read as a Back').toHaveBeenCalledTimes(3);
    expect(m.ran).toHaveBeenCalledTimes(1);
  });

  it('places: the skip loop stops after PLACES_MAX skips in a row and routes', () => {
    // The pure loop: a run of stale places longer than the bound. Each pop is one entry lower than the last.
    let r = rec({ visit: 'now', lastIdx: 1000, next: 1001 });
    const kinds: string[] = [];
    for (let i = 1; i <= PLACES_MAX + 5; i += 1) {
      const popped = entry(1000 - i, { visit: 'old', seq: 1, kind: 'overlay' });
      const d = decidePop(popped, { visit: r.visit, places: r.places, pendingSeq: r.pendingSeq, lastIdx: r.lastIdx, skips: r.skips, skipDir: r.skipDir, host: true });
      kinds.push(d.kind);
      r = afterPop(r, popped, d).rec;
      if (d.kind === 'router') break;
    }
    expect(kinds.filter((k) => k === 'skip')).toHaveLength(PLACES_MAX);
    expect(kinds[kinds.length - 1]).toBe('router');
    expect(kinds).toHaveLength(PLACES_MAX + 1);
    expect(r.skips, 'a routed pop ends the run').toBe(0);

    // And through the dispatcher: at the bound the pop runs the listeners and steps nothing.
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const m = mountEverything();
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 9, next: 10, skips: PLACES_MAX, skipDir: 'back' }));
    at(stale(8), '/docs/b');
    firePop();
    expect(back).not.toHaveBeenCalled();
    expect(m.ran).toHaveBeenCalledTimes(1);
    expect(readPlaces().skips).toBe(0);
    writePlaces(rec({ visit: 'now', doc: '/docs/a', lastIdx: 9, next: 10, skips: PLACES_MAX - 1, skipDir: 'back' }));
    at(stale(8), '/docs/b');
    firePop();
    expect(back, 'one short of the bound still skips').toHaveBeenCalledTimes(1);
    expect(readPlaces().skips).toBe(PLACES_MAX);
  });

  it('places: a lost record seeds next above the shown entry\'s docsIdx', () => {
    // A tab whose record is gone, standing on an entry numbered 7.
    expect(afterPop(rec(), entry(7), { kind: 'router' })).toEqual({ rec: rec({ lastIdx: 7, next: 8 }), stamp: null });
    mountEverything();
    at(entry(7), '/docs/a');
    firePop();
    expect(readPlaces().next).toBe(8);
    act(() => { navigate('/docs/q'); });
    expect((history.state as Record<string, unknown>).docsIdx, 'a new entry takes a number no shown entry has').toBe(8);
    // Through a reader body too: the visit begins on a numbered entry with a record that lost its counter.
    expect(beginVisit(rec(), '/docs/a', 'v1', { idx: 7 }).rec.next).toBe(8);
    expect(pushPlace(rec({ visit: 'v1', lastIdx: 7 }), { kind: 'overlay' }, { idx: 7 }).push?.idx).toBe(8);
  });

  it('places: a page that loads on a numbered entry reads it as the entry last shown, record lost or older', () => {
    // Pure: a numbered entry sets lastIdx and raises the counter; an unnumbered one counts as the next number.
    expect(seedPage(rec({ lastIdx: 9, next: 12 }), entry(3))).toEqual(rec({ lastIdx: 3, next: 12 }));
    expect(seedPage(rec(), entry(3))).toEqual(rec({ lastIdx: 3, next: 4 }));
    expect(seedPage(rec({ lastIdx: 2, next: 6 }), null)).toEqual(rec({ lastIdx: 6, next: 6 }));
    // Through the dispatcher: the record is gone, the page stands on entry 3, and Back pops a stale place numbered 2.
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const forward = vi.spyOn(history, 'forward').mockImplementation(() => undefined);
    at(entry(3), '/docs/b');
    const m = mountEverything();
    expect(readPlaces().lastIdx, 'seeded from the entry the page loaded on').toBe(3);
    at(stale(2), '/docs/a');
    firePop();
    expect(back, 'read as a Back: one step back').toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(m.ran).not.toHaveBeenCalled();
  });

  it('popstate: a history call the browser refuses while numbering an entry still routes', () => {
    const m = mountEverything();
    at({ other: 1 }, '/docs/z');
    vi.spyOn(history, 'replaceState').mockImplementation(() => { throw new DOMException('too fast', 'SecurityError'); });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    firePop();
    expect(m.ran, 'the router\'s pop ran its listeners').toHaveBeenCalledTimes(1);
    for (const l of m.locs) expect(last(l)).toEqual({ path: '/docs/z', search: '' });
  });

  it('popstate: every listener runs when an earlier one throws, and each throw is reported', () => {
    const seen: unknown[] = [];
    const onError = (e: ErrorEvent): void => { e.preventDefault(); seen.push(e.error); };
    addEventListener('error', onError);
    // Where the page has `reportError` the later throw goes there (an `error` event); jsdom has none, so it is logged.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const a = new Error('a');
      const b = new Error('b');
      onPop(() => { throw a; });
      onPop(() => { throw b; });
      const ran = vi.fn();
      onPop(ran);
      at(null, '/docs/z');
      firePop();
      expect(ran, 'the third ran').toHaveBeenCalledTimes(1);
      const reported = [...seen, ...logged.mock.calls.flat()];
      expect(reported, 'both throws were reported').toEqual(expect.arrayContaining([a, b]));
    } finally {
      removeEventListener('error', onError);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The decider's table (rules 1 to 9, both directions).

const base: PopTab = { visit: 'v', places: [OVL, JMP], pendingSeq: null, lastIdx: 2, skips: 0, skipDir: null, host: true };
const here = (visit: string, seq: number, kind: 'overlay' | 'jump' = 'overlay'): { visit: string; seq: number; kind: 'overlay' | 'jump' } => ({ visit, seq, kind });
interface Row { name: string; popped: unknown; tab?: Partial<PopTab>; want: PopDecision }
const ROUTER: PopDecision = { kind: 'router' };
const CONSUME: PopDecision = { kind: 'consume' };

const TABLE: Row[] = [
  // 1: no index
  { name: '1: no state is the router\'s', popped: null, want: ROUTER },
  { name: '1: state with no docsIdx is the router\'s, with a pending back (M11.27)', popped: { other: 1 }, tab: { pendingSeq: 0 }, want: ROUTER },
  { name: '1: a place with no index is the router\'s', popped: { [PLACE_KEY]: here('v', 1) }, want: ROUTER },
  { name: '1: a docsIdx that is not a non-negative safe integer is no index', popped: { [IDX_KEY]: '3' }, want: ROUTER },
  { name: '1: a negative docsIdx is no index', popped: { [IDX_KEY]: -1 }, want: ROUTER },
  { name: '1: a fractional docsIdx is no index', popped: { [IDX_KEY]: 1.5 }, want: ROUTER },
  // 2: the entry last shown
  { name: '2: the entry last shown is the router\'s', popped: entry(2), want: ROUTER },
  { name: '2: even a place of the visit, when it is the entry last shown', popped: entry(2, here('v', 2, 'jump')), want: ROUTER },
  // 4: a pending back
  { name: '4: pendingSeq 0 lands on the base entry: consumed', popped: entry(0), tab: { pendingSeq: 0, lastIdx: 1 }, want: CONSUME },
  { name: '4: pendingSeq 1 lands on place 1 of the visit: consumed', popped: entry(1, here('v', 1)), tab: { pendingSeq: 1 }, want: CONSUME },
  { name: '4: a pending back is not consumed going Forward', popped: entry(3), tab: { pendingSeq: 0, lastIdx: 1 }, want: ROUTER },
  { name: '4: pendingSeq 0 does not consume a landing on a place: that is the frame\'s', popped: entry(1, here('v', 1)), tab: { pendingSeq: 0 }, want: { kind: 'goto', id: 'j2', from: 'f2' } },
  { name: '4: pendingSeq 2 does not consume a landing on place 1', popped: entry(1, here('v', 1)), tab: { pendingSeq: 2 }, want: { kind: 'goto', id: 'j2', from: 'f2' } },
  { name: '4: pendingSeq 1 does not consume a landing on another visit\'s place 1: stale', popped: entry(1, here('old', 1)), tab: { pendingSeq: 1 }, want: { kind: 'skip', dir: 'back' } },
  // 5: stale places
  { name: '5: a place of another visit, going Back: skip back', popped: entry(1, here('old', 1)), want: { kind: 'skip', dir: 'back' } },
  { name: '5: a place of another visit, going Forward: skip forward (M11.57)', popped: entry(3, here('old', 1)), want: { kind: 'skip', dir: 'forward' } },
  { name: '5: a place when no visit stands: skip, toward the direction of travel', popped: entry(3, here('v', 1)), tab: { visit: null }, want: { kind: 'skip', dir: 'forward' } },
  { name: '5: a place when no visit stands, going Back', popped: entry(1, here('v', 1)), tab: { visit: null }, want: { kind: 'skip', dir: 'back' } },
  { name: '5: the skip bound: PLACES_MAX in a row routes', popped: entry(1, here('old', 1)), tab: { skips: PLACES_MAX, skipDir: 'back' }, want: ROUTER },
  { name: '5: one short of the bound still skips', popped: entry(1, here('old', 1)), tab: { skips: PLACES_MAX - 1, skipDir: 'back' }, want: { kind: 'skip', dir: 'back' } },
  { name: '5: the bound applies going Forward too', popped: entry(3, here('old', 1)), tab: { skips: PLACES_MAX, skipDir: 'forward' }, want: ROUTER },
  { name: '5: the bound counts one direction: a run of skips back does not stop a skip forward', popped: entry(3, here('old', 1)), tab: { skips: PLACES_MAX, skipDir: 'back' }, want: { kind: 'skip', dir: 'forward' } },
  // 6: a place of the visit with no host
  { name: '6: a place of the visit with no host registered is stale, going Back', popped: entry(1, here('v', 1)), tab: { host: false }, want: { kind: 'skip', dir: 'back' } },
  { name: '6: a place of the visit with no host registered is stale, going Forward', popped: entry(3, here('v', 1)), tab: { host: false }, want: { kind: 'skip', dir: 'forward' } },
  { name: '6: the bound applies to it too', popped: entry(1, here('v', 1)), tab: { host: false, skips: PLACES_MAX, skipDir: 'back' }, want: ROUTER },
  // 7: Back inside the visit
  { name: '7: Back off an overlay onto the base: close the overlay', popped: entry(0), tab: { lastIdx: 1 }, want: { kind: 'close-overlay' } },
  { name: '7: Back off a jump onto a lower place: go to its from', popped: entry(1, here('v', 1)), want: { kind: 'goto', id: 'j2', from: 'f2' } },
  { name: '7: Back off a jump onto the base: go to its from', popped: entry(0), tab: { places: [JMP], lastIdx: 2 }, want: { kind: 'goto', id: 'j2', from: 'f2' } },
  { name: '7: Back of several entries at once undoes the lowest place left: two jumps, the first one\'s from', popped: entry(0), tab: { places: [{ seq: 1, kind: 'jump', idx: 1, id: 'j1', from: 'f1' }, JMP], lastIdx: 2 }, want: { kind: 'goto', id: 'j1', from: 'f1' } },
  { name: '7: Back of several entries at once over an overlay and a jump: the lowest, the overlay, closes', popped: entry(0), want: { kind: 'close-overlay' } },
  { name: '7: a jump with no from goes to its id with no from', popped: entry(0), tab: { places: [{ seq: 1, kind: 'jump', idx: 2, id: 'j1' }] }, want: { kind: 'goto', id: 'j1' } },
  { name: '7: with no host the base landing is consumed (nothing to undo)', popped: entry(0), tab: { lastIdx: 1, host: false }, want: CONSUME },
  { name: '7: no place of the visit left, landing on a place of the visit: consumed', popped: entry(1, here('v', 1)), tab: { places: [OVL], lastIdx: 5 }, want: CONSUME },
  { name: '7: no place of the visit left (the visit\'s places are above), landing on the base: the router\'s', popped: entry(0), tab: { places: [{ seq: 1, kind: 'overlay', idx: 6 }], lastIdx: 5 }, want: ROUTER },
  { name: '7: no places at all, landing on the base: the router\'s', popped: entry(0), tab: { places: [], lastIdx: 1 }, want: ROUTER },
  // 8: Forward inside the visit
  { name: '8: Forward onto a jump place: go to its id again, with no from', popped: entry(2, here('v', 2, 'jump')), tab: { lastIdx: 0 }, want: { kind: 'goto', id: 'j2' } },
  { name: '8: Forward onto an overlay place: consumed, nothing reopens it', popped: entry(1, here('v', 1)), tab: { lastIdx: 0 }, want: CONSUME },
  { name: '8: Forward onto a place the record does not hold: stale, skip forward', popped: entry(3, here('v', 9)), tab: { lastIdx: 0 }, want: { kind: 'skip', dir: 'forward' } },
  { name: '8: that skip stops at the bound', popped: entry(3, here('v', 9)), tab: { lastIdx: 0, skips: PLACES_MAX, skipDir: 'forward' }, want: ROUTER },
  // 9: the rest
  { name: '9: Forward onto a base entry: the router\'s', popped: entry(3), tab: { lastIdx: 0 }, want: ROUTER },
  { name: '9: Forward onto a base entry with a pending back: the router\'s, and not consumed', popped: entry(3), tab: { lastIdx: 0, pendingSeq: 0 }, want: ROUTER },
];

describe('decidePop: the table', () => {
  it.each(TABLE)('$name', ({ popped, tab, want }) => {
    expect(decidePop(popped, { ...base, ...tab })).toEqual(want);
  });

  it('every rule 1 to 9 has a row', () => {
    for (const n of [1, 2, 4, 5, 6, 7, 8, 9]) expect(TABLE.some((r) => r.name.startsWith(`${n}:`)), `rule ${n}`).toBe(true);
    // Rule 3, the direction, is read by every skip row: both directions appear.
    const dirs = TABLE.flatMap((r) => (r.want.kind === 'skip' ? [r.want.dir] : []));
    expect(new Set(dirs)).toEqual(new Set(['back', 'forward']));
  });

  it('a goto never carries an undefined from (the key is absent)', () => {
    const d = decidePop(entry(0), { ...base, places: [{ seq: 1, kind: 'jump', idx: 2, id: 'j1' }] });
    expect(Object.keys(d)).toEqual(['kind', 'id']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The rest of the pure module.

describe('historyPlaces: readEntry and parseRecord are tolerant', () => {
  it('readEntry: a numbered entry and a place, and every malformed half reads null', () => {
    expect(readEntry(null)).toEqual({ idx: null, place: null });
    expect(readEntry('x')).toEqual({ idx: null, place: null });
    expect(readEntry([1])).toEqual({ idx: null, place: null });
    expect(readEntry({ docsIdx: 3 })).toEqual({ idx: 3, place: null });
    expect(readEntry({ docsIdx: 3, docsPlace: { visit: 'v', seq: 2, kind: 'jump', id: 'a', from: 'b' } }))
      .toEqual({ idx: 3, place: { visit: 'v', seq: 2, kind: 'jump', id: 'a', from: 'b' } });
    for (const bad of [
      { visit: '', seq: 1, kind: 'overlay' }, { visit: 'v', seq: 0, kind: 'overlay' }, { visit: 'v', seq: 1.5, kind: 'overlay' },
      { visit: 'v', seq: 1, kind: 'other' }, { visit: 'v', seq: 1, kind: 'jump', id: 4 }, { visit: 'v', seq: 1, kind: 'jump', from: {} },
      { seq: 1, kind: 'overlay' }, 'place', [],
    ]) expect(readEntry({ docsIdx: 1, docsPlace: bad }), JSON.stringify(bad)).toEqual({ idx: 1, place: null });
    expect(readEntry({ docsIdx: Number.MAX_SAFE_INTEGER + 2 })).toEqual({ idx: null, place: null });
  });

  it('parseRecord: a stored record round-trips; absent, unparsable or a field off reads the whole empty record', () => {
    const full = rec({ visit: 'v', doc: '/docs/a', places: [OVL, JMP], seq: 2, pendingSeq: 1, lastIdx: 2, next: 3, skips: 1 });
    expect(parseRecord(JSON.stringify(full))).toEqual(full);
    expect(parseRecord(null)).toEqual(EMPTY_RECORD);
    expect(parseRecord('{')).toEqual(EMPTY_RECORD);
    expect(parseRecord('[]')).toEqual(EMPTY_RECORD);
    for (const broken of [
      { ...full, visit: 3 }, { ...full, doc: 3 }, { ...full, places: 'x' }, { ...full, places: [{ ...OVL, idx: 'a' }] },
      { ...full, seq: -1 }, { ...full, pendingSeq: 'x' }, { ...full, lastIdx: -2 }, { ...full, next: 1.5 }, { ...full, skips: null },
    ]) expect(parseRecord(JSON.stringify(broken)), JSON.stringify(broken)).toEqual(EMPTY_RECORD);
    const empty = parseRecord(null);
    expect(empty, 'a record of its own, never the shared constant').not.toBe(EMPTY_RECORD);
    empty.places.push(OVL);
    expect(EMPTY_RECORD.places).toHaveLength(0);
  });

  it('the exported limits and keys', () => {
    expect(PLACES_MAX).toBe(50);
    expect([IDX_KEY, PLACE_KEY, PLACES_RECORD_KEY]).toEqual(['docsIdx', 'docsPlace', 'ccrc:docs:v1:places']);
  });
});

describe('historyPlaces: afterPop, the index rule', () => {
  it('every decision sets lastIdx to the popped entry\'s index; a skip counts, anything else resets the count', () => {
    const r0 = rec({ lastIdx: 5, next: 9, skips: 3, skipDir: 'back', pendingSeq: 1 });
    const skip = afterPop(r0, entry(2), { kind: 'skip', dir: 'back' });
    expect(skip.rec).toMatchObject({ lastIdx: 2, skips: 4, skipDir: 'back', pendingSeq: 1, next: 9 });
    const turned = afterPop(r0, entry(7), { kind: 'skip', dir: 'forward' });
    expect(turned.rec, 'a skip the other way starts the count again').toMatchObject({ lastIdx: 7, skips: 1, skipDir: 'forward' });
    for (const d of [{ kind: 'router' }, { kind: 'consume' }, { kind: 'close-overlay' }, { kind: 'goto', id: 'x' }] as PopDecision[]) {
      const a = afterPop(r0, entry(2), d);
      expect(a.rec, d.kind).toMatchObject({ lastIdx: 2, skips: 0, skipDir: null, pendingSeq: null, next: 9 });
      expect(a.stamp, d.kind).toBeNull();
    }
    expect(r0, 'the input is not changed').toEqual(rec({ lastIdx: 5, next: 9, skips: 3, skipDir: 'back', pendingSeq: 1 }));
  });

  it('the router on an entry with no index stamps it with next, and everything else on one stamps nothing', () => {
    const a = afterPop(rec({ lastIdx: 3, next: 4 }), null, { kind: 'router' });
    expect(a).toEqual({ rec: rec({ lastIdx: 4, next: 5 }), stamp: 4 });
    const b = afterPop(rec({ lastIdx: 3, next: 4 }), { other: 1 }, { kind: 'consume' });
    expect(b.stamp).toBeNull();
    expect(b.rec).toMatchObject({ lastIdx: 3, next: 4 });
  });

  it('next never falls to or below a shown index', () => {
    expect(afterPop(rec({ next: 2 }), entry(10), { kind: 'router' }).rec.next).toBe(11);
    expect(afterPop(rec({ next: 20 }), entry(10), { kind: 'router' }).rec.next).toBe(20);
  });
});

describe('historyPlaces: visits, pushes and the frame closing its overlay', () => {
  it('beginVisit: the same doc continues; another starts a new visit; the base entry is stamped when it has no index', () => {
    const open = rec({ visit: 'v1', doc: '/docs/a', places: [OVL], seq: 1, pendingSeq: 0, lastIdx: 1, next: 2 });
    const cont = beginVisit(open, '/docs/a', 'v2', { idx: 1 });
    expect(cont).toMatchObject({ continued: true, stamp: null });
    expect(cont.rec).toEqual(open);
    expect(beginVisit(open, '/docs/a', 'v2', { idx: 6 }).rec.next, 'seeded from the entry\'s index').toBe(7);
    const moved = beginVisit(open, '/docs/b', 'v2', { idx: 4 });
    expect(moved).toMatchObject({ continued: false, stamp: null });
    expect(moved.rec).toEqual(rec({ visit: 'v2', doc: '/docs/b', places: [], seq: 0, pendingSeq: null, lastIdx: 4, next: 5, skips: 0 }));
    const unnumbered = beginVisit(open, '/docs/b', 'v2', { idx: null });
    expect(unnumbered.stamp).toBe(2);
    expect(unnumbered.rec).toMatchObject({ lastIdx: 2, next: 3, visit: 'v2' });
    expect(beginVisit(EMPTY_RECORD, '/docs/a', 'v1', { idx: null })).toMatchObject({ continued: false, stamp: 0, rec: { lastIdx: 0, next: 1 } });
  });

  it('endVisit clears the visit and keeps the counters', () => {
    const open = rec({ visit: 'v1', doc: '/docs/a', places: [OVL], seq: 1, pendingSeq: 0, lastIdx: 1, next: 2, skips: 2 });
    expect(endVisit(open)).toEqual(rec({ lastIdx: 1, next: 2, skips: 2 }));
  });

  it('pushPlace: stamps an unnumbered current entry, numbers the new one, and 51 pushes are 50 places', () => {
    const open = rec({ visit: 'v1', doc: '/docs/a', lastIdx: 0, next: 1 });
    const first = pushPlace(open, { kind: 'jump', id: 'a', from: 'f' }, { idx: 0 });
    expect(first.stamp).toBeNull();
    expect(first.push).toEqual({ idx: 1, place: { visit: 'v1', seq: 1, kind: 'jump', id: 'a', from: 'f' } });
    expect(first.rec).toMatchObject({ seq: 1, lastIdx: 1, next: 2, places: [{ seq: 1, kind: 'jump', idx: 1, id: 'a', from: 'f' }] });
    const unnumbered = pushPlace(open, { kind: 'overlay' }, { idx: null });
    expect(unnumbered.stamp).toBe(1);
    expect(unnumbered.push?.idx).toBe(2);
    expect(Object.keys(unnumbered.push?.place ?? {}), 'absent id and from are absent keys').toEqual(['visit', 'seq', 'kind']);
    let r = open;
    let cur = 0;
    let pushed = 0;
    for (let i = 0; i < PLACES_MAX + 1; i += 1) {
      const p = pushPlace(r, { kind: 'overlay' }, { idx: cur });
      if (p.push === null) { expect(p.rec).toBe(r); continue; }
      pushed += 1;
      r = p.rec;
      cur = p.push.idx;
    }
    expect(pushed).toBe(PLACES_MAX);
    expect(r.places).toHaveLength(PLACES_MAX);
    expect(pushPlace(rec(), { kind: 'overlay' }, { idx: 0 }).push, 'no visit, no place').toBeNull();
    expect(open, 'the input is not changed').toEqual(rec({ visit: 'v1', doc: '/docs/a', lastIdx: 0, next: 1 }));
  });

  it('pushPlace: a push removes the entries above the current one, so their places leave the record, and an Esc then expects the base', () => {
    // A jump (seq 1, entry 5) above the base (entry 4), then Back: the page stands on the base, the jump above it.
    const j1: Place = { seq: 1, kind: 'jump', idx: 5, id: 'p', from: 't' };
    const r = rec({ visit: 'v', places: [j1], seq: 1, lastIdx: 4, next: 6 });
    const pushed = pushPlace(r, { kind: 'overlay' }, { idx: 4 });
    expect(pushed.rec.places, 'the jump above was removed from history by the push').toEqual([{ seq: 2, kind: 'overlay', idx: 6 }]);
    expect(pushed.rec.seq, 'the budget still counts it').toBe(2);
    expect(closedByFrame(pushed.rec).rec.pendingSeq, 'Esc expects the base, not the dropped jump').toBe(0);
  });

  it('closedByFrame: only from the visit\'s overlay place, expecting the place pushed before it, or the base', () => {
    const jump: Place = { seq: 1, kind: 'jump', idx: 1, id: 'a' };
    const ovl: Place = { seq: 2, kind: 'overlay', idx: 2 };
    const two = rec({ visit: 'v', places: [jump, ovl], seq: 2, lastIdx: 2, next: 3 });
    expect(closedByFrame(two)).toEqual({ rec: { ...two, pendingSeq: 1 }, back: true });
    const one = rec({ visit: 'v', places: [{ seq: 1, kind: 'overlay', idx: 1 }], seq: 1, lastIdx: 1, next: 2 });
    expect(closedByFrame(one)).toEqual({ rec: { ...one, pendingSeq: 0 }, back: true });
    const onJump = { ...two, lastIdx: 1 };
    expect(closedByFrame(onJump)).toEqual({ rec: onJump, back: false });
    const onBase = { ...two, lastIdx: 0 };
    expect(closedByFrame(onBase)).toEqual({ rec: onBase, back: false });
    expect(closedByFrame(rec())).toEqual({ rec: rec(), back: false });
  });
});
