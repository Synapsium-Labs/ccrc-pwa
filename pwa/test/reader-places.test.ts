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
  endVisit, jumpEntryUrl, parseRecord, pushPlace, readEntry, replacedState, seedPage, visitEnds, visitKey, type PopDecision, type Place, type PopTab, type TabRecord,
} from '../src/lib/historyPlaces';
import { onPop, readPlaces, resetPopstateForTests, setPlaceHost, writePlaces } from '../src/lib/popstate';
import { navigate, useLocation, type Loc } from '../src/lib/router';
import { useReaderOnly } from '../src/docs/readerHistory';
import { noteActivated, resetReloadGateForTests, startReloadGate, type ReloadActs } from '../src/lib/swupdate';
import { tabStorage, writeKey } from '../src/lib/storage';
import { mountDocFrame } from '@synapsium-labs/pinax-lib/host';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { ReaderFrame, type ReaderDeps, type ReaderFrameProps } from '../src/docs/ReaderFrame';
import { createFetchQueue } from '../src/docs/fetchQueue';
import { mountReader, type ReaderMount, type ReaderMountInput } from '../src/docs/reader/bridge';
import { startPlaces } from '../src/docs/reader/places';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { fakeLoaders, fileResponse, treeOk } from './docsFixtures';

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

  it('popstate: a host\'s unregister clears only its own host', () => {
    const a = { closeOverlay: vi.fn(), goto: vi.fn() };
    const b = { closeOverlay: vi.fn(), goto: vi.fn() };
    const offA = setPlaceHost(a);
    const offB = setPlaceHost(b);
    onPop(() => {});
    const closeOnce = (): void => {
      writePlaces(rec({ visit: 'now', doc: '/docs/a', places: [{ seq: 1, kind: 'overlay', idx: 1 }], seq: 1, lastIdx: 1, next: 2 }));
      at(entry(0), '/docs/a');
      firePop();
    };
    offA();
    offA();
    closeOnce();
    expect(b.closeOverlay, 'A\'s unregister left B').toHaveBeenCalledTimes(1);
    expect(a.closeOverlay).not.toHaveBeenCalled();
    offB();
    closeOnce();
    expect(b.closeOverlay, 'B\'s unregister cleared it: no host to tell').toHaveBeenCalledTimes(1);
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

  it('navigate: a replaced entry keeps its number', () => {
    const m = mountEverything();
    at({ docsIdx: 3, docsPlace: { visit: 'v', seq: 1, kind: 'overlay' }, other: 1 }, '/docs/a?ref=b');
    writePlaces(rec({ lastIdx: 3, next: 4 }));
    act(() => { navigate('/runs?q=1', { replace: true }); });
    expect(location.pathname + location.search, 'the URL is the new one').toBe('/runs?q=1');
    expect(history.state, 'the number alone is carried: no place, no other key').toEqual({ docsIdx: 3 });
    expect(m.ran, 'the subscribers ran once').toHaveBeenCalledTimes(1);
    expect(readPlaces().lastIdx).toBe(3);
    // An entry with no number is still numbered by the pop, as before.
    at(null, '/docs/b');
    writePlaces(rec({ lastIdx: 3, next: 7 }));
    act(() => { navigate('/runs', { replace: true }); });
    expect(typeof (history.state as Record<string, unknown>).docsIdx, 'numbered by the pop').toBe('number');
    expect(m.ran).toHaveBeenCalledTimes(2);
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

  it('replacedState: the entry\'s valid number alone, else null', () => {
    const rows: readonly [string, unknown, { docsIdx: number } | null][] = [
      ['null', null, null],
      ['undefined', undefined, null],
      ['a string', 'x', null],
      ['an array', [1], null],
      ['an empty record', {}, null],
      ['a number', { docsIdx: 3 }, { docsIdx: 3 }],
      ['zero', { docsIdx: 0 }, { docsIdx: 0 }],
      ['a number, a place and another key', { docsIdx: 3, docsPlace: { visit: 'v', seq: 1, kind: 'overlay' }, other: 1 }, { docsIdx: 3 }],
      ['a negative number', { docsIdx: -1 }, null],
      ['a fractional number', { docsIdx: 1.5 }, null],
      ['a numeric string', { docsIdx: '3' }, null],
      ['a place with no number', { docsPlace: { visit: 'v', seq: 1, kind: 'overlay' } }, null],
    ];
    for (const [name, prev, want] of rows) expect(replacedState(prev), name).toEqual(want);
  });

  it('jumpEntryUrl: an id in the grammar becomes the fragment of the doc\'s path and query; any other keeps the address and is reported', () => {
    const here = { pathname: '/docs/demo/specs/a.md', search: '?ref=feature', href: 'http://h/docs/demo/specs/a.md?ref=feature#sec-3' };
    expect(jumpEntryUrl(here, 'sec-9', true)).toEqual({ url: '/docs/demo/specs/a.md?ref=feature#sec-9', report: false });
    expect(jumpEntryUrl({ ...here, search: '' }, 'é-ü', true)).toEqual({ url: '/docs/demo/specs/a.md#é-ü', report: false });
    expect(jumpEntryUrl(here, 'bad id', false)).toEqual({ url: here.href, report: true });
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

  it('visitKey and visitEnds: a visit is one body, and only a change of address ends it', () => {
    expect(visitKey('/docs/a', '')).toBe('/docs/a\u0000');
    expect(visitKey('/docs/a', 'k\u0000part:1')).toBe('/docs/a\u0000k\u0000part:1');
    const open = rec({ visit: 'v', doc: visitKey('/docs/a', 'k\u0000part:0') });
    expect(visitEnds(open, 'v', '/docs/a'), 'same address, another scope: the next part ends nothing').toBe(false);
    expect(visitEnds(open, 'v', '/docs/b'), 'another address ends it').toBe(true);
    expect(visitEnds(open, 'w', '/docs/b'), 'a visit that is not the record\'s ends nothing').toBe(false);
    expect(visitEnds(open, null, '/docs/b'), 'a body with no visit ends nothing').toBe(false);
    expect(visitEnds(rec({ visit: 'v', doc: '/docs/a' }), 'v', '/docs/a'), 'a doc with no separator, same address').toBe(false);
    expect(visitEnds(rec({ visit: 'v', doc: '/docs/a' }), 'v', '/docs/b'), 'a doc with no separator, another address').toBe(true);
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

// ---------------------------------------------------------------------------------------------------------------------
// Part B: the reader's places (`docs/reader/places.ts`), through the real `ReaderFrame` and the real history.
//
// Each case renders the real `ReaderFrame` under a small shell that routes with the real `useLocation` (a path under
// `/docs/` is a doc, any other path is a screen that is not one), over an injected `reader.mount` that records every
// mount's input and hands back a mount whose `closeOverlay` and `goto` are spies. The frame's own reports are made by
// calling the recorded `input.onPlace` and `input.onHash` as the frame's adapters would. A Back is a real traversal (jsdom
// fires its `popstate` a task later), so a case waits for what the traversal should leave.

const DOC_A = '/docs/demo/specs/a.md';
const DOC_B = '/docs/demo/specs/b.md';

const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, pageAt: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};

interface Mounted {
  readonly input: ReaderMountInput;
  readonly handle: { readonly closeOverlay: ReturnType<typeof vi.fn>; readonly goto: ReturnType<typeof vi.fn>; readonly destroy: ReturnType<typeof vi.fn> };
}
interface PlacesRig {
  readonly mounts: Mounted[];
  readonly assets: DocsAssetContextValue;
  readonly parser: MarkdownParser;
  readonly reader: ReaderDeps;
}

function placesRig(): PlacesRig {
  const mounts: Mounted[] = [];
  const mount = vi.fn<ReaderDeps['mount']>(async (_el, input) => {
    const handle = {
      seed: { hosted: false as const }, follow: vi.fn(), destroy: vi.fn(), setPrefs: vi.fn(), command: vi.fn(),
      closeOverlay: vi.fn(), goto: vi.fn(),
    };
    mounts.push({ input, handle });
    return handle as unknown as ReaderMount;
  });
  const files = fakeLoaders();
  return {
    mounts,
    assets: { loaders: files.loaders, queue: createFetchQueue(), onDraftAsset: () => {} },
    parser: vi.fn<MarkdownParser>(async (): Promise<ParseOutcome> => parseMarkdown('# Formatted', 'docs')),
    reader: { render: async () => RENDERED, mount, images: async () => ({ urls: {}, drafts: 0, auth: 0 }) },
  };
}

const SHOWN = fileResponse('# A\n').show;

/** The shell: a doc under `/docs/` is the real `ReaderFrame`, keyed by its address (and `epoch`, so a re-render with a new
 *  epoch is a remount of the same doc, whose `bodyKey`, and so whose visit's scope, is the same); any other address is a screen that is not a doc. */
function PlacesApp(p: { readonly rig: PlacesRig; readonly epoch: number }): ReactNode {
  const loc = useLocation();
  if (!loc.path.startsWith('/docs/')) return createElement('p', null, `screen ${loc.path}`);
  const key = `${loc.path}${loc.search}:${p.epoch}`;
  const props: ReaderFrameProps = {
    show: SHOWN, bodyKey: `${loc.path}${loc.search}`, link: LINK, parser: p.rig.parser, reader: p.rig.reader,
    pendingFragment: null, onFragmentConsumed: () => {},
  };
  return createElement(DocsAssetContext, { value: p.rig.assets }, createElement(ReaderFrame, { key, ...props }));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
/** Lets every settled promise and every queued traversal run, inside `act`. */
const quiet = async (ms = 40): Promise<void> => { await act(async () => { await sleep(ms); }); };
/** Waits for a condition, then for a little more, so an event the condition does not name would show too. */
async function until(cond: () => void): Promise<void> {
  await waitFor(cond, { timeout: 4000 });
  await quiet();
}

interface Started { readonly rig: PlacesRig; readonly ran: ReturnType<typeof vi.fn>; readonly view: ReturnType<typeof render> }

/** The page: one subscriber that counts the router's pops (it also seeds the dispatcher from the entry the page loaded on,
 *  as the shell's own `useLocation` does in the app), the shell, and, by default, the first reader mount. */
async function start(waitForMount = true): Promise<Started> {
  const rig = placesRig();
  const ran = vi.fn();
  onPop(ran);
  const view = render(createElement(PlacesApp, { rig, epoch: 1 }));
  if (waitForMount) await mountedAt(rig, 1);
  return { rig, ran, view };
}
async function mountedAt(rig: PlacesRig, n: number): Promise<Mounted> {
  await waitFor(() => expect(rig.mounts.length).toBeGreaterThanOrEqual(n), { timeout: 4000 });
  await quiet(10);
  return rig.mounts[n - 1] as Mounted;
}
const latest = (rig: PlacesRig): Mounted => rig.mounts[rig.mounts.length - 1] as Mounted;

const stateNow = (): Record<string, unknown> => (history.state ?? {}) as Record<string, unknown>;
const placeNow = (): { visit: string; seq: number; kind: string; id?: string; from?: string } | undefined =>
  stateNow().docsPlace as { visit: string; seq: number; kind: string; id?: string; from?: string } | undefined;
const idxNow = (): number | undefined => stateNow().docsIdx as number | undefined;
/** How many times any mount of the rig was told to close its overlay or to go to a place. */
const commands = (rig: PlacesRig): { close: number; goto: number } => ({
  close: rig.mounts.reduce((n, m) => n + m.handle.closeOverlay.mock.calls.length, 0),
  goto: rig.mounts.reduce((n, m) => n + m.handle.goto.mock.calls.length, 0),
});
const pushPlaces = (m: Mounted, n: number): void => { for (let i = 0; i < n; i += 1) m.input.onPlace!('overlay'); };

describe('places: the reader\'s places through the real frame and history', () => {
  beforeEach(() => {
    // A screen that is not a doc below the doc, so a Back out of the doc has somewhere known to go.
    history.replaceState(null, '', '/before');
    history.pushState(null, '', DOC_A);
  });

  it('places: overlay Back closes it', async () => {
    const s = await start();
    const m = latest(s.rig);
    const length = history.length;
    m.input.onPlace!('overlay');
    expect(history.length, 'one entry pushed').toBe(length + 1);
    expect(placeNow()).toMatchObject({ kind: 'overlay', seq: 1 });
    expect(location.pathname).toBe(DOC_A);
    history.back();
    await until(() => expect(m.handle.closeOverlay).toHaveBeenCalledTimes(1));
    expect(m.handle.closeOverlay, 'told once').toHaveBeenCalledTimes(1);
    expect(m.handle.goto).not.toHaveBeenCalled();
    expect(placeNow(), 'the page stands on the doc\'s base entry').toBeUndefined();
    expect(location.pathname).toBe(DOC_A);
    expect(s.ran, 'no screen heard the pop').not.toHaveBeenCalled();
    expect(s.rig.mounts, 'the frame stayed').toHaveLength(1);
  });

  it('places: Esc then exactly one Back consumed', async () => {
    const s = await start();
    const m = latest(s.rig);
    m.input.onPlace!('overlay');
    // Esc or Close in the frame: it closes its overlay itself and reports it; the console steps back by itself.
    m.input.onPlace!('overlay-closed');
    await until(() => expect(placeNow()).toBeUndefined());
    expect(idxNow(), 'back on the base entry').toBe(0);
    expect(m.handle.closeOverlay, 'nothing to close: the frame did it').not.toHaveBeenCalled();
    expect(s.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
    // The next Back is the user's, and it leaves the doc.
    history.back();
    await until(() => expect(location.pathname).toBe('/before'));
    expect(s.ran, 'the router heard that one').toHaveBeenCalledTimes(1);
    expect(commands(s.rig)).toEqual({ close: 0, goto: 0 });
  });

  it('places: a hash with push pushes an entry, and Back sends goto with its id and its from token', async () => {
    const s = await start();
    const m = latest(s.rig);
    const length = history.length;
    m.input.onHash('sec-2', { push: true, from: 'tok-1', inGrammar: true });
    expect(history.length).toBe(length + 1);
    expect(placeNow()).toMatchObject({ kind: 'jump', seq: 1, id: 'sec-2', from: 'tok-1' });
    history.back();
    await until(() => expect(m.handle.goto).toHaveBeenCalledTimes(1));
    expect(m.handle.goto).toHaveBeenCalledWith('sec-2', 'tok-1');
    expect(m.handle.closeOverlay).not.toHaveBeenCalled();
    expect(s.ran).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC_A);
  });

  // A jump's entry names its id (D-9117): the document's path and query unchanged, the jump's id as the fragment.
  const urlNow = (): string => location.pathname + location.search + location.hash;
  const FEATURE = `${DOC_A}?ref=feature`;

  it('places: after a jump the address names the id', async () => {
    history.replaceState(null, '', `${FEATURE}#sec-3`);
    const s = await start();
    const m = latest(s.rig);
    m.input.onHash('sec-9', { push: true, from: 'tok', inGrammar: true });
    expect(placeNow()).toMatchObject({ kind: 'jump', id: 'sec-9' });
    expect(urlNow(), 'path and query unchanged, the fragment the id').toBe(`${FEATURE}#sec-9`);
  });

  it('places: Back from a jump restores the earlier address and place', async () => {
    history.replaceState(null, '', `${FEATURE}#sec-3`);
    const s = await start();
    const m = latest(s.rig);
    m.input.onHash('sec-9', { push: true, from: 'tok', inGrammar: true });
    expect(urlNow(), 'the jump\'s entry names its id').toBe(`${FEATURE}#sec-9`);
    history.back();
    await until(() => expect(m.handle.goto).toHaveBeenCalledTimes(1));
    expect(m.handle.goto).toHaveBeenCalledWith('sec-9', 'tok');
    expect(urlNow(), 'the earlier fragment is back in the address').toBe(`${FEATURE}#sec-3`);
    expect(placeNow(), 'on the base entry').toBeUndefined();
    expect(s.ran).not.toHaveBeenCalled();
  });

  it('places: Forward returns to the jump\'s id', async () => {
    history.replaceState(null, '', `${FEATURE}#sec-3`);
    const s = await start();
    const m = latest(s.rig);
    m.input.onHash('sec-9', { push: true, from: 'tok', inGrammar: true });
    history.back();
    await until(() => expect(m.handle.goto).toHaveBeenCalledTimes(1));
    history.forward();
    await until(() => expect(m.handle.goto).toHaveBeenCalledTimes(2));
    expect(urlNow(), 'the address names the id again').toBe(`${FEATURE}#sec-9`);
    expect(m.handle.goto.mock.lastCall, 'the id, and no from').toEqual(['sec-9', undefined]);
    expect(placeNow()).toMatchObject({ kind: 'jump', id: 'sec-9' });
    expect(s.ran).not.toHaveBeenCalled();
  });

  it('places: a reload on the jump\'s entry opens at the id and continues the visit', async () => {
    history.replaceState(null, '', `${FEATURE}#sec-3`);
    const first = await start();
    latest(first.rig).input.onHash('sec-9', { push: true, from: 'tok', inGrammar: true });
    const saved = readPlaces();
    const visit = saved.visit;
    expect(visit).not.toBeNull();
    // The reload, as the case of a reload on a place makes it.
    cleanup();
    resetPopstateForTests();
    writeKey(PLACES_RECORD_KEY, JSON.stringify(saved), tabStorage);
    // The jsdom rig hands the reader no pending fragment of its own (`pendingFragment` is null, and the Docs screen that
    // reads `location.hash` on a direct load is not mounted here), so what is asserted is what that read would find: the
    // address's fragment is the id, on the entry that still holds the jump's place, and the body's start continues the
    // same visit.
    expect(location.hash.slice(1), 'a direct load reads the id from the address').toBe('sec-9');
    const second = await start();
    expect(readPlaces().visit, 'the visit continues').toBe(visit);
    expect(placeNow(), 'the entry kept its place').toMatchObject({ kind: 'jump', id: 'sec-9' });
    expect(urlNow()).toBe(`${FEATURE}#sec-9`);
    history.back();
    await until(() => expect(latest(second.rig).handle.goto).toHaveBeenCalledTimes(1));
    expect(urlNow(), 'Back after the reload restores the earlier address').toBe(`${FEATURE}#sec-3`);
  });

  it('places: a jump id outside the fragment grammar pushes at the current URL and is reported', async () => {
    history.replaceState(null, '', `${FEATURE}#sec-3`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = await start();
    const m = latest(s.rig);
    const length = history.length;
    m.input.onHash('bad id/x', { push: true, from: 'tok', inGrammar: false });
    expect(history.length, 'the place is still pushed').toBe(length + 1);
    expect(placeNow()).toMatchObject({ kind: 'jump', id: 'bad id/x' });
    expect(urlNow(), 'nothing new in the address').toBe(`${FEATURE}#sec-3`);
    const reported = warn.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].startsWith('ccrc:'));
    expect(reported, 'reported, not swallowed').toHaveLength(1);
  });

  it('places: a jump id outside the fragment grammar that pushes nothing never reaches the address', async () => {
    history.replaceState(null, '', `${FEATURE}#sec-3`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = await start();
    const m = latest(s.rig);
    const length = history.length;
    const refuse = vi.spyOn(history, 'pushState').mockImplementation(() => { throw new Error('refused'); });
    try {
      m.input.onHash('bad id/x', { push: true, from: 'tok', inGrammar: false });
    } finally {
      refuse.mockRestore();
    }
    expect(history.length, 'nothing pushed').toBe(length);
    expect(urlNow(), 'no fragment replace either').toBe(`${FEATURE}#sec-3`);
    const reported = warn.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('outside the fragment grammar'));
    expect(reported, 'reported, not swallowed').toHaveLength(1);
  });

  it('places: a hash without push still replaces', async () => {
    const s = await start();
    const m = latest(s.rig);
    const length = history.length;
    const before = stateNow();
    m.input.onHash('sec-3', { push: false, from: null, inGrammar: true });
    m.input.onHash('sec-4');
    expect(history.length, 'no entry pushed').toBe(length);
    expect(location.hash, 'the fragment replaced').toBe('#sec-4');
    expect(stateNow()).toEqual(before);
  });

  it('places: 51 places push 50', async () => {
    const s = await start();
    const m = latest(s.rig);
    const length = history.length;
    pushPlaces(m, 51);
    expect(history.length, 'fifty entries, not fifty-one').toBe(length + 50);
    expect(placeNow()?.seq).toBe(50);
    // A jump past the budget pushes nothing either.
    m.input.onHash('sec-9', { push: true, from: 'tok', inGrammar: true });
    expect(history.length).toBe(length + 50);
    expect(location.hash, 'the jump that was not pushed replaced the fragment instead').toBe('#sec-9');
  });

  it('places: a doc shown in parts keeps each part\'s places to that part', async () => {
    const ran = vi.fn();
    onPop(ran);
    const goto = vi.fn();
    const closeOverlay = vi.fn();
    const part0 = startPlaces({ doc: DOC_A, scope: 'k\u0000part:0' });
    part0.host({ goto, closeOverlay });
    part0.onHash('sec', { push: true, from: 'tok', inGrammar: true });
    expect(placeNow(), 'part 0 pushed its place').toMatchObject({ kind: 'jump', id: 'sec' });
    // Next part: the address is unchanged, so part 0's body ends without ending anything, and part 1 starts its own visit.
    part0.end();
    const part1 = startPlaces({ doc: DOC_A, scope: 'k\u0000part:1' });
    part1.host({ goto, closeOverlay });
    expect(readPlaces().places, 'part 1 starts with no places of part 0\'s').toEqual([]);
    history.back();
    await until(() => expect(idxNow()).toBe(0));
    expect(goto, 'part 0\'s jump is never sent into part 1\'s frame').not.toHaveBeenCalled();
    expect(closeOverlay).not.toHaveBeenCalled();
    expect(ran, 'the one Back was the router\'s').toHaveBeenCalledTimes(1);
    part1.end();
  });

  it('places: a newer visit survives an older body\'s end', () => {
    onPop(vi.fn());
    const older = startPlaces({ doc: DOC_A });
    const first = readPlaces().visit;
    const newer = startPlaces({ doc: DOC_B });
    const second = readPlaces().visit;
    expect(second).not.toBe(first);
    older.end();
    expect(readPlaces().visit, 'B\'s visit is not the older body\'s to end').toBe(second);
    expect(readPlaces().doc).toBe(visitKey(DOC_B, ''));
    newer.end();
  });

  it('places: a frame that falls back is no longer the host', async () => {
    const s = await start();
    const m = latest(s.rig);
    m.input.onPlace!('overlay');
    m.input.onFallback('assets');
    await quiet();
    history.back();
    await until(() => expect(placeNow()).toBeUndefined());
    expect(m.handle.closeOverlay, 'a frame that fell back is told nothing').not.toHaveBeenCalled();
    expect(location.pathname, 'the one Back left the place and the doc stayed').toBe(DOC_A);
    expect(commands(s.rig)).toEqual({ close: 0, goto: 0 });
  });

  it('places: a remount of the same doc keeps the visit\'s budget', async () => {
    const s = await start();
    pushPlaces(latest(s.rig), 25);
    const length = history.length;
    const visit = placeNow()?.visit;
    s.view.rerender(createElement(PlacesApp, { rig: s.rig, epoch: 2 }));
    const second = await mountedAt(s.rig, 2);
    pushPlaces(second, 26);
    expect(history.length, 'fifty in all: the second body shared the first one\'s budget').toBe(length + 25);
    expect(placeNow()?.seq).toBe(50);
    expect(placeNow()?.visit, 'one visit throughout').toBe(visit);
  });

  it('places: stale places after navigating away cost no extra Back', async () => {
    const s = await start();
    const a = latest(s.rig);
    a.input.onPlace!('overlay');
    a.input.onPlace!('overlay');
    a.input.onHash('sec', { push: true, from: 'tok', inGrammar: true });
    act(() => { navigate(DOC_B); });
    await mountedAt(s.rig, 2);
    expect(location.pathname).toBe(DOC_B);
    expect(s.ran, 'navigate ran the subscribers').toHaveBeenCalledTimes(1);
    // One Back: A's three places are stepped over and A shows.
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    await mountedAt(s.rig, 3);
    expect(s.ran, 'one run for the whole move').toHaveBeenCalledTimes(2);
    expect(placeNow()).toBeUndefined();
    expect(commands(s.rig), 'nothing was told to close or to go').toEqual({ close: 0, goto: 0 });
    // A second Back leaves A.
    history.back();
    await until(() => expect(location.pathname).toBe('/before'));
    expect(s.ran).toHaveBeenCalledTimes(3);
  });

  it('places: leaving a doc by a link navigates at once, and one Back shows it', async () => {
    const s = await start();
    const a = latest(s.rig);
    a.input.onPlace!('overlay');
    const length = history.length;
    act(() => { a.input.onLink({ kind: 'relative', path: 'b.md', fragment: null }); });
    expect(location.pathname, 'the move was synchronous, nothing unwound first').toBe(DOC_B);
    expect(history.length, 'one entry pushed, on top of the place').toBe(length + 1);
    await mountedAt(s.rig, 2);
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    expect(placeNow(), 'on the doc\'s base entry').toBeUndefined();
    expect(commands(s.rig)).toEqual({ close: 0, goto: 0 });
  });

  it('places: from a doc with places, navigate to a screen that is not a doc, then one Back shows the doc and nothing closes or jumps', async () => {
    const s = await start();
    const a = latest(s.rig);
    a.input.onPlace!('overlay');
    a.input.onHash('sec', { push: true, from: 'tok', inGrammar: true });
    act(() => { navigate('/runs'); });
    expect(location.pathname).toBe('/runs');
    expect(s.ran).toHaveBeenCalledTimes(1);
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    await mountedAt(s.rig, 2);
    expect(s.ran, 'one run for the whole move').toHaveBeenCalledTimes(2);
    expect(commands(s.rig), 'neither place acted').toEqual({ close: 0, goto: 0 });
    // What only the visit's end decides: the visit that had those places ended when its reader unmounted for the screen,
    // so Forward steps over them (they are stale) and reaches the screen in one step. A visit kept across the screen
    // (the end's rule mutated to never end it) goes red earlier than this step: the first Back is consumed at the doc's
    // base entry, so the reader never mounts again and `mountedAt(s.rig, 2)` above times out.
    history.forward();
    await until(() => expect(location.pathname).toBe('/runs'));
    expect(s.ran).toHaveBeenCalledTimes(3);
    expect(commands(s.rig), 'and still nothing closed or jumped').toEqual({ close: 0, goto: 0 });
    expect(placeNow()).toBeUndefined();
  });

  it('places: a reload on a place continues the visit', async () => {
    const first = await start();
    latest(first.rig).input.onPlace!('overlay');
    const saved = readPlaces();
    const visit = saved.visit;
    expect(visit).not.toBeNull();
    // The reload: nothing mounted, this page's module state gone, the tab's session-stored record kept, the history too.
    cleanup();
    resetPopstateForTests();
    writeKey(PLACES_RECORD_KEY, JSON.stringify(saved), tabStorage);
    expect(placeNow(), 'the page stands on the place\'s entry').toMatchObject({ kind: 'overlay', seq: 1 });
    const second = await start();
    expect(readPlaces().visit, 'the visit is unchanged').toBe(visit);
    expect(placeNow(), 'and the entry kept its place').toMatchObject({ kind: 'overlay', seq: 1 });
    const m = latest(second.rig);
    history.back();
    await until(() => expect(m.handle.closeOverlay).toHaveBeenCalledTimes(1));
    expect(location.pathname).toBe(DOC_A);
    expect(second.ran).not.toHaveBeenCalled();
  });

  it('places: a new visit\'s base entry drops an ended visit\'s docsPlace', async () => {
    history.replaceState({ docsIdx: 5, docsPlace: { visit: 'ended', seq: 1, kind: 'overlay' }, other: 1 }, '', DOC_A);
    await start();
    expect(stateNow().docsPlace, 'the ended visit\'s place is gone').toBeUndefined();
    expect(stateNow(), 'the rest of the entry is kept').toMatchObject({ docsIdx: 5, other: 1 });
    expect(readPlaces().visit).not.toBe('ended');
    expect(readPlaces().visit).not.toBeNull();
  });

  it('places: Forward after Back from B reaches B', async () => {
    const s = await start();
    const a = latest(s.rig);
    a.input.onPlace!('overlay');
    a.input.onHash('sec', { push: true, from: 'tok', inGrammar: true });
    act(() => { navigate(DOC_B); });
    await mountedAt(s.rig, 2);
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    await mountedAt(s.rig, 3);
    expect(s.ran).toHaveBeenCalledTimes(2);
    // Forward: A's two places are stale and are stepped over toward B, never back toward where the user came from.
    history.forward();
    await until(() => expect(location.pathname).toBe(DOC_B));
    expect(s.ran, 'one run for the way forward').toHaveBeenCalledTimes(3);
    expect(placeNow()).toBeUndefined();
    expect(commands(s.rig)).toEqual({ close: 0, goto: 0 });
  });

  it('navigate: a replace above forward entries, then a skip over stale places, reads the right direction', async () => {
    const s = await start();
    const a = latest(s.rig);
    a.input.onPlace!('overlay');
    a.input.onHash('sec', { push: true, from: 'tok', inGrammar: true });
    act(() => { navigate('/runs'); });
    expect(location.pathname).toBe('/runs');
    // Back over the two stale places to A's base entry; the reader shows A again.
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    await mountedAt(s.rig, 2);
    expect(placeNow()).toBeUndefined();
    const idxBase = idxNow();
    expect(typeof idxBase).toBe('number');
    // A replace on A's base entry keeps its number (D-9116): it is not renumbered above the forward entries.
    act(() => { navigate('/accounts', { replace: true }); });
    expect(location.pathname).toBe('/accounts');
    expect(idxNow(), 'the replaced entry kept its number').toBe(idxBase);
    // Forward steps over the stale places to the screen, never back toward where the user came from.
    history.forward();
    await until(() => expect(location.pathname).toBe('/runs'));
    expect(commands(s.rig), 'nothing was told to close or to go').toEqual({ close: 0, goto: 0 });
    expect(placeNow()).toBeUndefined();
  });

  it('places: Back from a screen that is not a doc into stale places costs one Back', async () => {
    // A doc's base, two places of a visit that has ended, and a screen: the shape a reload on the screen leaves.
    history.replaceState(entry(0), '', DOC_A);
    history.pushState(entry(1, { visit: 'old', seq: 1, kind: 'overlay' }), '', DOC_A);
    history.pushState(entry(2, { visit: 'old', seq: 2, kind: 'jump', id: 'j', from: 'f' }), '', DOC_A);
    history.pushState(entry(3), '', '/runs');
    resetPopstateForTests();
    writeKey(PLACES_RECORD_KEY, JSON.stringify(rec({ lastIdx: 3, next: 4 })), tabStorage);
    const s = await start(false);
    expect(location.pathname).toBe('/runs');
    const back = vi.spyOn(history, 'back');
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    await mountedAt(s.rig, 1);
    expect(back, 'the user\'s one Back and one step over each place').toHaveBeenCalledTimes(3);
    expect(s.ran, 'one run for the whole move').toHaveBeenCalledTimes(1);
    expect(commands(s.rig)).toEqual({ close: 0, goto: 0 });
    expect(placeNow()).toBeUndefined();
  });

  it('places: an overlay\'s entry keeps the URL, and a jump\'s entry names its id', async () => {
    history.replaceState(null, '', `${DOC_A}?ref=feature#sec-3`);
    const s = await start();
    const m = latest(s.rig);
    const url = (): string => location.pathname + location.search + location.hash;
    m.input.onPlace!('overlay');
    expect(url(), 'path, search and fragment unchanged').toBe(`${DOC_A}?ref=feature#sec-3`);
    m.input.onHash('sec-9', { push: true, from: 'tok', inGrammar: true });
    expect(url(), 'a jump\'s entry: path and search unchanged, the id as the fragment (D-9117)').toBe(`${DOC_A}?ref=feature#sec-9`);
    // The doc's current URL is what the frame's own scroll reports left in it.
    m.input.onHash('sec-4');
    expect(url()).toBe(`${DOC_A}?ref=feature#sec-4`);
    m.input.onPlace!('overlay');
    expect(url(), 'an overlay\'s entry carries the fragment as it now stands').toBe(`${DOC_A}?ref=feature#sec-4`);
    expect(placeNow()).toMatchObject({ kind: 'overlay', seq: 3 });
  });

  it('places: pushed entry keeps only', async () => {
    history.replaceState({ ccrcReaderOnly: 'day-1', other: 'kept' }, '', DOC_A);
    const s = await start();
    const m = latest(s.rig);
    m.input.onPlace!('overlay');
    expect(stateNow()).toMatchObject({ ccrcReaderOnly: 'day-1', other: 'kept', docsPlace: { kind: 'overlay' } });
    m.input.onHash('sec', { push: true, from: 'tok', inGrammar: true });
    expect(stateNow()).toMatchObject({ ccrcReaderOnly: 'day-1', other: 'kept', docsPlace: { kind: 'jump' } });
  });

  it('places: router synthetic popstate not consumed while the frame\'s own close is pending', async () => {
    const s = await start();
    const m = latest(s.rig);
    m.input.onPlace!('overlay');
    // The frame closes the overlay itself: places.ts calls the real `history.back()` and records what it expects.
    m.input.onPlace!('overlay-closed');
    expect(readPlaces().pendingSeq, 'the console expects the base entry').toBe(0);
    // While that back is pending, the router moves: its own synthetic `popstate` must reach every subscriber.
    act(() => { navigate('/runs'); });
    expect(s.ran, 'the synthetic pop ran the subscribers').toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/runs');
    expect(screenText()).toBe('screen /runs');
    await quiet(80);
  });

  it('places: Back into a doc\'s base entry keeps its docsIdx, with the reader mounted', async () => {
    history.replaceState(null, '', '/before');
    const s = await start(false);
    act(() => { navigate(DOC_A); });
    await mountedAt(s.rig, 1);
    const idxA = idxNow();
    expect(typeof idxA).toBe('number');
    const nextBefore = readPlaces().next;
    // A place on top of the base, and Back to the base with the reader mounted.
    latest(s.rig).input.onPlace!('overlay');
    expect(idxNow()).toBeGreaterThan(idxA as number);
    history.back();
    await until(() => expect(latest(s.rig).handle.closeOverlay).toHaveBeenCalledTimes(1));
    expect(idxNow(), 'the base entry\'s number is what it was before the push').toBe(idxA);
    expect(readPlaces().lastIdx).toBe(idxA);
    // And when its reader mounts afresh on the base entry (the doc reached again by Back from another one).
    act(() => { navigate(DOC_B); });
    await mountedAt(s.rig, 2);
    history.back();
    await until(() => expect(location.pathname).toBe(DOC_A));
    await mountedAt(s.rig, 3);
    expect(idxNow(), 'not restamped when the doc is reached again').toBe(idxA);
    expect(readPlaces().lastIdx, 'and it is the entry last shown').toBe(idxA);
    expect(readPlaces().next, 'the counter only grew').toBeGreaterThanOrEqual(nextBefore);
  });
});

function screenText(): string | null {
  return document.body.querySelector('p')?.textContent ?? null;
}

describe('places: the port nonce', () => {
  it('places: the port nonce never reaches history.state', async () => {
    // Entries a traversal of an earlier case left above this one would be dropped by the first push: start at the top.
    history.pushState(null, '', DOC_B);
    history.replaceState({ ccrcReaderOnly: 'day-1' }, '', DOC_A);
    const places = startPlaces({ doc: location.pathname + location.search });
    const el = document.createElement('div');
    document.body.append(el);
    const caught: { adapters: Parameters<typeof mountDocFrame>[1]['adapters'] | null } = { adapters: null };
    const input: ReaderMountInput = {
      document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } },
      bytes: 100, docKey: null, title: 'b.md', prefs: { theme: 'auto' },
      onLink: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
      onHash: places.onHash, onPlace: places.onPlace,
    };
    const m = await mountReader(el, input, {
      store: () => null,
      mount: ((target, o) => { caught.adapters = o.adapters; return mountDocFrame(target, o); }) as typeof mountDocFrame,
    });
    try {
      const frameEl = el.querySelector('iframe');
      expect(frameEl, 'the installed library mounted its frame').not.toBeNull();
      const parsed = new DOMParser().parseFromString(frameEl!.getAttribute('srcdoc')!, 'text/html');
      const seedEl = [...parsed.querySelectorAll('script')].find((s) => s.getAttribute('type') === 'application/json');
      const seed = JSON.parse(seedEl!.textContent ?? '{}') as { nonce?: unknown; bridge?: { places?: unknown } };
      expect(seed.bridge?.places, 'the seed asks the frame for places').toBe(true);
      const nonce = seed.nonce;
      expect(typeof nonce, 'the seed carries the port\'s nonce').toBe('string');
      expect((nonce as string).length).toBeGreaterThan(8);
      // The real adapters' own `onPlace` and `onHash`, as the library calls them when the frame reports.
      const { adapters } = caught;
      expect(adapters).not.toBeNull();
      const length = history.length;
      const holds = (v: unknown, needle: string): boolean => {
        if (typeof v === 'string') return v.includes(needle);
        if (typeof v === 'object' && v !== null) return Object.entries(v).some(([k, x]) => k.includes(needle) || holds(x, needle));
        return false;
      };
      expect(holds({ a: [`x${nonce as string}`] }, nonce as string), 'the walk sees a nonce planted in it').toBe(true);
      adapters!.onPlace!('overlay');
      expect(holds(history.state, nonce as string), 'nowhere in the first pushed entry').toBe(false);
      adapters!.onHash!('sec', { push: true, from: 'tok' });
      // (the real library adapters: `inGrammar` is added by the bridge, as the library gives no such field)
      expect(history.length, 'both pushed').toBe(length + 2);
      expect(holds(history.state, nonce as string), 'nowhere in the second pushed entry').toBe(false);
      expect(holds(readPlaces(), nonce as string), 'nor in the tab\'s record').toBe(false);
      expect(readPlaces().visit, 'the visit id is not the nonce').not.toBe(nonce);
      expect(placeNow()?.visit).not.toBe(nonce);
      expect(placeNow()).toMatchObject({ kind: 'jump', seq: 2, id: 'sec', from: 'tok' });
      places.end();
    } finally {
      m.destroy();
      el.remove();
    }
  });
});
