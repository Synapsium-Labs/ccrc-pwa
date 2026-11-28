// The reading-layer flags (native Docs parity, Task P5.4, X2 P5; design 2026-11-18 section 2.3 rows R5, R6, R7, R9 and section 5.6;
// mutation rows M11.39 to M11.41). Every Docs mount's seed carries `features.rules`, `features.inShort` and the vocabulary
// (`addressees` you and operator, the ID qualifiers), merged with a host-bar mount's chrome in one `features` object, and the
// reader lab's `lab-draw` mount carries none of them. The comparison base is kept per doc for this tab, in session storage
// (`readerHistory.ts`'s `changes` records it), and a new body for the same doc in the same tab seeds it back as the library's
// `changesBase`. Which request to record is the library's own rule (its README, "Which request to record"), decided by
// `reader/history.ts#readerChangesBaseToRecord`. Every doc, project and sha is a placeholder.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderInput } from '@synapsium-labs/pinax-lib/frame';
import type { DocFrame, HostAdapters, mountDocFrame } from '@synapsium-labs/pinax-lib/host';
import type { DocsLogOk, DocsPageLocation, DocsShowOk } from '../../shared/docs';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsHistoryAnswer } from '../src/docs/failures';
import { mountReader, type ReaderMountInput } from '../src/docs/reader/bridge';
import { readerChangesBaseToRecord, readerDocChangesBaseKey, readerSeenKey } from '../src/docs/reader/history';
import { READER_QUALIFIERS, readerFeatures, type ReaderChrome } from '../src/docs/reader/policy';
import { startReaderHistory } from '../src/docs/readerHistory';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import type { EnumerableStoragePort } from '../src/lib/storage';
import { fakeLoaders, fileResponse, okFile, pageAt } from './docsFixtures';

const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const C3 = '3'.repeat(40);
const B1 = 'b'.repeat(40);
const B2 = 'c'.repeat(40);
const SEEN = 'd'.repeat(40);
const SERVED = 'refs/remotes/origin/main';
const DOC_KEY = 'demo:specs:a.md';
const BASE_KEY = `${READER_STORE_PREFIX}changes-base:${DOC_KEY}`;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

// ---------------------------------------------------------------- the mount's seed

const STUB_ASSETS = { guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' };
const docOf = (): RenderInput => ({ result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } });

function fakeStore(): EnumerableStoragePort {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

function baseInput(over: Partial<ReaderMountInput> = {}): ReaderMountInput {
  return {
    document: docOf(), bytes: 100, docKey: DOC_KEY, title: 'a.md', prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(), ...over,
  };
}

/** The adapters one spied library mount is given. */
async function adaptersOf(over: Partial<ReaderMountInput> = {}): Promise<HostAdapters> {
  const frame = { destroy: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn(), command: vi.fn() };
  const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => frame as unknown as DocFrame);
  await mountReader(document.createElement('div'), baseInput(over), {
    mount: mount as unknown as typeof mountDocFrame, store: () => fakeStore(), assets: () => Promise.resolve(STUB_ASSETS), e17: 'does-not-hold',
  });
  return mount.mock.calls[0]![1].adapters;
}

interface RealSeed {
  readonly features: { rules?: unknown; inShort?: unknown; chrome?: unknown; vocabulary?: { addressees?: unknown; qualifiers?: unknown } };
  readonly changesBase?: unknown;
}

/** Mounts the installed library for real and reads the seed it wrote into the frame's srcdoc. */
async function realSeed(over: Partial<ReaderMountInput> = {}): Promise<{ seed: RealSeed; onFallback: ReturnType<typeof vi.fn> }> {
  const el = document.createElement('div');
  document.body.append(el);
  const onFallback = vi.fn();
  const m = await mountReader(el, baseInput({ onFallback, ...over }), { store: () => fakeStore() });
  const srcdoc = el.querySelector('iframe')!.getAttribute('srcdoc')!;
  const parsed = new DOMParser().parseFromString(srcdoc, 'text/html');
  const seedEl = [...parsed.querySelectorAll('script')].find((s) => s.getAttribute('type') === 'application/json')!;
  m.destroy();
  return { seed: JSON.parse(seedEl.textContent ?? '{}') as RealSeed, onFallback };
}

const CHROMES: readonly (ReaderChrome | undefined)[] = [undefined, 'frame-bar', 'host-bar'];

/** The qualifier words this task owns, built here apart from the policy's own list: the four plain words, then `v1` to `v20`, each as
 *  itself, with `'s` and with the typographic `’s` (U+2019). */
function expectedQualifiers(): string[] {
  const out = ['programme', 'program', 'at-scale', 'addendum'];
  for (let n = 1; n <= 20; n += 1) out.push(`v${n}`, `v${n}'s`, `v${n}’s`);
  return out;
}

describe('the reading-layer flags in the seed (X2 P5.4)', () => {
  it('flags: rules on in the seed', async () => {
    for (const chrome of CHROMES) {
      const a = await adaptersOf(chrome === undefined ? {} : { chrome });
      expect(a.features?.rules, `adapters, chrome ${String(chrome)}`).toBe(true);
    }
    const real = await realSeed();
    expect(real.onFallback).not.toHaveBeenCalled();
    expect(real.seed.features.rules).toBe(true);
  });

  it('flags: addressees you and operator, qualifiers', async () => {
    const want = expectedQualifiers();
    expect(want).toHaveLength(64);
    expect(READER_QUALIFIERS).toEqual(want);
    // The library takes at most 200 words of 1 to 64 code units each, with no white space at either end.
    expect(READER_QUALIFIERS.length).toBeLessThanOrEqual(200);
    for (const w of READER_QUALIFIERS) {
      expect(w.length, w).toBeGreaterThanOrEqual(1);
      expect(w.length, w).toBeLessThanOrEqual(64);
      expect(w, w).toBe(w.trim());
    }
    expect(new Set(READER_QUALIFIERS).size).toBe(READER_QUALIFIERS.length);
    for (const chrome of CHROMES) {
      const a = await adaptersOf(chrome === undefined ? {} : { chrome });
      expect(a.features?.vocabulary, `adapters, chrome ${String(chrome)}`).toEqual({ addressees: ['you', 'operator'], qualifiers: want });
    }
    // The library judges the whole vocabulary host-side before it writes the seed: a word outside its bounds would be a fallback.
    const real = await realSeed();
    expect(real.onFallback).not.toHaveBeenCalled();
    expect(real.seed.features.vocabulary).toEqual({ addressees: ['you', 'operator'], qualifiers: want });
  });

  it('flags: In short switch on', async () => {
    for (const chrome of CHROMES) {
      const a = await adaptersOf(chrome === undefined ? {} : { chrome });
      expect(a.features?.inShort, `adapters, chrome ${String(chrome)}`).toBe(true);
    }
    const real = await realSeed();
    expect(real.seed.features.inShort).toBe(true);
  });

  it('flags: a host-bar mount merges the chrome switches with the flags in one features object, fresh each time', async () => {
    const a = await adaptersOf({ chrome: 'host-bar' });
    const b = await adaptersOf({ chrome: 'host-bar' });
    expect(a.features).toEqual({
      chrome: { bar: false, topSpace: false }, rules: true, inShort: true,
      vocabulary: { addressees: ['you', 'operator'], qualifiers: expectedQualifiers() },
    });
    expect(Object.getPrototypeOf(a.features)).toBe(Object.prototype);
    expect(a.features).not.toBe(b.features);
    expect(a.features?.vocabulary).not.toBe(b.features?.vocabulary);
    const frameBar = await adaptersOf({ chrome: 'frame-bar' });
    expect(Object.keys(frameBar.features ?? {}).sort()).toEqual(['inShort', 'rules', 'vocabulary']);
    expect(readerFeatures(undefined, 'host-bar')).toEqual(a.features);
  });

  it('flags: a remount and openAt each seed the tab\'s latest base', async () => {
    // The input's base answers a different value at each ask: every library mount reads it afresh, never once for the whole mount.
    let latest: string | null = B1;
    const frame = { destroy: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn(), command: vi.fn(), setReading: vi.fn() };
    const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => frame as unknown as DocFrame);
    const m = await mountReader(document.createElement('div'), baseInput({ changesBase: () => latest }), {
      mount: mount as unknown as typeof mountDocFrame, store: () => fakeStore(), assets: () => Promise.resolve(STUB_ASSETS), e17: 'does-not-hold',
    });
    expect(mount.mock.calls[0]![1].adapters.changesBase, 'the first mount').toBe(B1);
    latest = B2;
    m.openAt!('x');
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[1]![1].adapters.changesBase, 'a mount after openAt').toBe(B2);
    latest = C3;
    m.remount!({ layout: 'classic' });
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(3); });
    expect(mount.mock.calls[2]![1].adapters.changesBase, 'a mount after remount').toBe(C3);
    // A base that went away is no longer seeded.
    latest = null;
    m.openAt!('y');
    expect(Object.keys(mount.mock.calls[3]![1].adapters)).not.toContain('changesBase');
    m.destroy();
  });

  it('flags: the reader lab\'s mount seeds none of the flags', async () => {
    for (const chrome of CHROMES) {
      const a = await adaptersOf({ profile: 'lab-draw', ...(chrome === undefined ? {} : { chrome }), changesBase: () => B1 });
      expect(Object.keys(a), `chrome ${String(chrome)}`).not.toContain('features');
      expect(Object.keys(a)).not.toContain('changesBase');
    }
    expect(readerFeatures('lab-draw', 'host-bar')).toBeNull();
    expect(readerFeatures('lab-draw', 'frame-bar')).toBeNull();
  });
});

// ---------------------------------------------------------------- the comparison base

type Leaf = DocsPageLocation & { kind: 'path' };
const entry = (sha: string, parent: string | null) => ({ sha, parent, date: '2026-01-02T03:04:05+00:00', author: 'someone', subject: `change ${sha.slice(0, 4)}` });
const LOG = {
  v: 1, verb: 'docs-show', ok: true, elapsedMs: 1, commit: C1, section: 'specs', path: 'a.md',
  entries: [entry(C1, C2), entry(C2, C3), entry(C3, null)], truncated: false,
} as unknown as DocsLogOk;
const okHistory = (log: DocsLogOk): DocsHistoryAnswer => ({ s: 'ok', value: { ok: true, log } });

/** One body's history for the doc `path` of project `demo`, as `ReaderFrame` starts it. */
function body(o: { path?: string; only?: string | null; log?: boolean; ac?: AbortController; draft?: boolean } = {}) {
  const ac = o.ac ?? new AbortController();
  const path = o.path ?? 'a.md';
  const base = fileResponse('# A\n').show;
  const show = (o.draft === true
    ? { ...base, path, source: 'draft', head: C1, fp: 'f'.repeat(64) }
    : { ...base, path, source: 'committed', commit: C1 }) as DocsShowOk;
  const history = startReaderHistory({
    project: 'demo', show, text: '# A\n',
    pin: o.draft === true
      ? { kind: 'draft', branch: 'main', head: C1, section: 'specs', path, fp: 'f'.repeat(64) }
      : { kind: 'committed', commit: C1, servedRef: SERVED, section: 'specs', path },
    page: () => pageAt(`/docs/demo/specs/${path}`) as Leaf, only: o.only ?? null,
    history: o.log === true ? { history: async () => okHistory(LOG) } : null,
    loaders: fakeLoaders({ file: okFile('# A\n') }).loaders, queue: createFetchQueue(), signal: ac.signal,
  });
  return { ac, history };
}

const stored = (key = BASE_KEY): string | null => window.sessionStorage.getItem(key);
const keyOf = (path: string): string => `${READER_STORE_PREFIX}changes-base:demo:specs:${path}`;

describe('the comparison base, kept per doc for this tab (X2 P5.4)', () => {
  it('flags: reload keeps the comparison base', async () => {
    const first = body();
    await first.history.seed;
    expect(first.history.changesBase(), 'no comparison picked yet').toBeNull();
    await first.history.changes(B1);
    expect(stored(), 'the pick is kept in session storage under the reader prefix').toBe(B1);
    first.ac.abort();
    // The body ends (a reload, a new commit's body): a new body for the same doc in the same tab seeds it.
    const second = body();
    await second.history.seed;
    expect(second.history.changesBase()).toBe(B1);
    const a = await adaptersOf({ changesBase: () => second.history.changesBase() });
    expect(a.changesBase).toBe(B1);
    // A later pick replaces it.
    await second.history.changes(B2);
    expect(stored()).toBe(B2);
    expect(body().history.changesBase()).toBe(B2);
  });

  it('flags: a link back to the doc keeps the comparison base in this tab', async () => {
    const doc = body();
    await doc.history.changes(B1);
    doc.ac.abort();
    // Another doc in the same tab: its own base, and the first doc's is not seen there.
    const other = body({ path: 'b.md' });
    expect(other.history.changesBase()).toBeNull();
    await other.history.changes(B2);
    expect(stored(keyOf('b.md'))).toBe(B2);
    other.ac.abort();
    // The link back to the first doc: seeded, and the other doc's pick left alone.
    const back = body();
    expect(back.history.changesBase()).toBe(B1);
    expect(body({ path: 'b.md' }).history.changesBase()).toBe(B2);
  });

  it('flags: another tab starts without it', async () => {
    const doc = body();
    await doc.history.changes(B1);
    expect(stored()).toBe(B1);
    // The base is the tab's: page storage (shared by every tab of the device) holds none of it.
    expect(window.localStorage.length).toBe(0);
    // A fresh tab has a fresh session storage.
    window.sessionStorage.clear();
    expect(body().history.changesBase()).toBeNull();
    expect((await adaptersOf({ changesBase: () => body().history.changesBase() })).changesBase).toBeUndefined();
  });

  it('flags: a request for a seeded sha is not recorded', async () => {
    // The last visit's sha: the per-doc `seen` field the library keeps in page storage, in either case.
    window.localStorage.setItem(readerSeenKey(DOC_KEY), JSON.stringify({ sha: SEEN, at: 1 }));
    const doc = body();
    doc.history.changesBase(); // the mount, seeded with SEEN as the last visit
    await doc.history.changes(SEEN);
    await doc.history.changes(SEEN.toUpperCase());
    expect(stored(), 'the last visit\'s sha is a measure the host seeded, never a pick').toBeNull();
    // A pick is recorded, and is the base the next mount seeds: a request for it is no new pick.
    await doc.history.changes(B1);
    expect(stored()).toBe(B1);
    expect(doc.history.changesBase()).toBe(B1);
    await doc.history.changes(B1.toUpperCase());
    expect(stored(), 'the base itself, in the other case').toBe(B1);
    // The pure rule: the seeded shas, compared in lower case; any other sha is recorded in lower case.
    const ctx = { seeded: [SEEN, B1], only: null };
    expect(readerChangesBaseToRecord(SEEN, ctx)).toBeNull();
    expect(readerChangesBaseToRecord(SEEN.toUpperCase(), ctx)).toBeNull();
    expect(readerChangesBaseToRecord(B1, ctx)).toBeNull();
    expect(readerChangesBaseToRecord(B1.toUpperCase(), ctx)).toBeNull();
    expect(readerChangesBaseToRecord(B2, ctx)).toBe(B2);
    expect(readerChangesBaseToRecord(B2.toUpperCase(), ctx)).toBe(B2);
    expect(readerChangesBaseToRecord(B2, { seeded: new Set<string>(), only: null })).toBe(B2);
    // A value that is no full sha is never recorded.
    for (const bad of ['', 'abc', 'b'.repeat(39), 'b'.repeat(41), 'g'.repeat(40), ` ${B2}`]) {
      expect(readerChangesBaseToRecord(bad, { seeded: [], only: null }), bad).toBeNull();
    }
    expect(readerChangesBaseToRecord('e'.repeat(64), { seeded: [], only: null })).toBe('e'.repeat(64));
  });

  const writeSeen = (sha: string): void => window.localStorage.setItem(readerSeenKey(DOC_KEY), JSON.stringify({ sha, at: 1 }));

  it('flags: the last visit\'s comparison the frame asks after writing seen is not recorded', async () => {
    // The library writes `seen := the body's own commit` BEFORE it asks `changes(prior)`: a reading of `seen` made at the request is
    // the commit itself, never the sha the mount was seeded with. The body started with no `seen` (another tab wrote SEEN after).
    const doc = body();
    await doc.history.seed;
    writeSeen(SEEN);
    expect(doc.history.changesBase(), 'the mount is made (the bridge asks the base right before it)').toBeNull();
    writeSeen(C1);
    await doc.history.changes(SEEN);
    await doc.history.changes(SEEN.toUpperCase());
    expect(stored(), 'the sha the mount was seeded as the last visit is not a pick').toBeNull();
    // The usual order too: `seen` stored before the body starts.
    window.localStorage.clear();
    writeSeen(SEEN);
    const usual = body();
    usual.history.changesBase();
    writeSeen(C1);
    await usual.history.changes(SEEN);
    expect(stored()).toBeNull();
    // A sha that was seeded into no mount is a pick.
    await usual.history.changes(B2);
    expect(stored()).toBe(B2);
  });

  it('flags: a sha seeded into a later mount of the body is not recorded, one picked is', async () => {
    const doc = body();
    await doc.history.seed;
    writeSeen(SEEN);
    doc.history.changesBase(); // the first library mount: seeded SEEN as the last visit
    writeSeen(C1);
    // Another tab's open moves `seen` between the two mounts of this body (a layout swap, an `openAt`).
    writeSeen(B1);
    doc.history.changesBase(); // the second library mount: seeded B1 as the last visit
    writeSeen(C1);
    await doc.history.changes(B1);
    expect(stored(), 'the second mount\'s seeded sha').toBeNull();
    await doc.history.changes(SEEN);
    expect(stored(), 'the first mount\'s seeded sha').toBeNull();
    await doc.history.changes(B2);
    expect(stored(), 'a sha in none of the mounts\' seeds is a pick').toBe(B2);
    // Once recorded, the base is seeded into the next mount, and the request that is that base is no new pick.
    expect(doc.history.changesBase()).toBe(B2);
    await doc.history.changes(B2.toUpperCase());
    expect(stored()).toBe(B2);
  });

  it('flags: the last visit is read as a value, never trusted for its shape', async () => {
    const doc = body();
    for (const raw of ['not json', '[]', '"x"', 'null', JSON.stringify({ sha: 7 }), JSON.stringify({ sha: 'abc' }), JSON.stringify({ at: 1 })]) {
      window.localStorage.setItem(readerSeenKey(DOC_KEY), raw);
      doc.history.changesBase(); // a mount that reads the stored `seen` as a value: none of these is a sha to seed
      await doc.history.changes(B1);
      expect(stored(), raw).toBe(B1);
      window.sessionStorage.clear();
    }
  });

  it('flags: a one-day version records nothing', async () => {
    const day = body({ only: C2, log: true });
    expect((await day.history.seed)?.only, 'the day filter is valid, so the mount is a one-day version').toBe(C2);
    await day.history.changes(B1);
    expect(stored()).toBeNull();
    expect(readerChangesBaseToRecord(B1, { seeded: [], only: C2 })).toBeNull();
    // A day filter the seed drops (no commit of the log has it) is no one-day version: the pick records.
    const dropped = body({ only: C3.replace(/3/g, '9'), log: true });
    expect((await dropped.history.seed)?.only).toBeNull();
    await dropped.history.changes(B1);
    expect(stored()).toBe(B1);
  });

  it('flags: a malformed stored base seeds nothing', async () => {
    const bad = ['', 'abc', B1.toUpperCase(), `${B1}0`, B1.slice(1), ` ${B1}`, `${B1}\n`, JSON.stringify({ sha: B1 }), JSON.stringify(B1), 'g'.repeat(40), '\u0000'];
    // The body hands the bridge the stored text as it read it; the policy's one judgement (`readerSeedChangesBase`) seeds only a full sha.
    for (const raw of bad) {
      window.sessionStorage.setItem(BASE_KEY, raw);
      const asked = body().history.changesBase();
      expect((await adaptersOf({ changesBase: () => asked })).changesBase, JSON.stringify(raw)).toBeUndefined();
    }
    // A value that is a full sha is seeded as it is: 40 or 64 lower-case hex digits.
    for (const ok of [B1, 'e'.repeat(64)]) {
      window.sessionStorage.setItem(BASE_KEY, ok);
      const asked = body().history.changesBase();
      expect(asked).toBe(ok);
      expect((await adaptersOf({ changesBase: () => asked })).changesBase).toBe(ok);
    }
    // The bridge passes on a full sha only, and only to a mount that carries history, whatever the input hands it.
    for (const raw of ['zzz', '', B1.toUpperCase(), B1.slice(1), null]) {
      expect((await adaptersOf({ changesBase: () => raw })).changesBase, String(raw)).toBeUndefined();
    }
    expect((await adaptersOf({ changesBase: () => B1 })).changesBase).toBe(B1);
    expect((await adaptersOf()).changesBase, 'no input, no seed').toBeUndefined();
  });

  it('flags: the base key is the reader prefix\'s, per doc', () => {
    expect(readerDocChangesBaseKey(DOC_KEY)).toBe(BASE_KEY);
    expect(readerSeenKey(DOC_KEY)).toBe(`${READER_STORE_PREFIX}doc:${DOC_KEY}:seen`);
  });
});
