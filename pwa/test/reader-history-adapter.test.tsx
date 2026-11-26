// Docs reader completion plan Task 12 (part B): `readerHistory.ts`, one body's history lifecycle, and its wiring through
// `ReaderFrame` (the rich-docs spec's G5, G6, M8.22 and M9.10). Every case uses the real `ReaderFrame` with injected
// `ReaderDeps` (a fake render, mount and images, and a fake history loader), the real asset context with fake loaders and a
// real fetch queue. The router's `navigate` is a module mock: a case that needs a real move gives it an implementation that
// pushes the entry and fires `popstate`, as the router does. Every address, hash and project is a placeholder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DocPin, DocsLogEntry, DocsLogOk, DocsPageLocation, DocsShowOk } from '../../shared/docs';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { DocsLeaf } from '../src/docs/DocsLeaf';
import { ReaderFrame, type ReaderDeps, type ReaderFrameProps } from '../src/docs/ReaderFrame';
import type { DocsVisit } from '../src/docs/useDocsVisit';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import { readerDiff } from '../src/docs/reader/diff';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer, DocsHistoryAnswer, DocsHistoryLoader } from '../src/docs/failures';
import { READER_ONLY_STATE_KEY, resetReaderOnlyForTests, startReaderHistory, useReaderOnly } from '../src/docs/readerHistory';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { navigate } from '../src/lib/router';
import { NO_RANGE_VISIT, fakeLoaders, fileResponse, pageAt, treeOk, treeResponse } from './docsFixtures';

vi.mock('../src/lib/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/router')>()),
  navigate: vi.fn(),
  replaceFragment: vi.fn(),
}));

const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const C3 = '3'.repeat(40);
const BASE = 'b'.repeat(40);
const SERVED = 'refs/remotes/origin/main';
const DATE = '2026-01-02T03:04:05+00:00';

type Leaf = DocsPageLocation & { kind: 'path' };
const leafAt = (url: string): Leaf => pageAt(url) as Leaf;

const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};

interface Deferred<T> { readonly promise: Promise<T>; resolve(v: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const entry = (sha: string, parent: string | null, subject = `change ${sha.slice(0, 4)}`): DocsLogEntry =>
  ({ sha, parent, date: DATE, author: 'someone', subject });

function logOf(entries: DocsLogEntry[], over: Partial<DocsLogOk> = {}): DocsLogOk {
  return { v: 1, verb: 'docs-show' as never, ok: true, elapsedMs: 1, commit: C1, section: 'specs', path: 'a.md', entries, truncated: false, ...over } as DocsLogOk;
}
const okHistory = (log: DocsLogOk): DocsHistoryAnswer => ({ s: 'ok', value: { ok: true, log } });

/** The log most cases serve: three commits, newest first. */
const LOG = logOf([entry(C1, C2), entry(C2, C3), entry(C3, null)]);
const SEEDED = [
  { sha: C1, subject: `change ${C1.slice(0, 4)}`, date: DATE, parents: [C2] },
  { sha: C2, subject: `change ${C2.slice(0, 4)}`, date: DATE, parents: [C3] },
  { sha: C3, subject: `change ${C3.slice(0, 4)}`, date: DATE, parents: [] },
];

function committedShow(text: string, commit: string | null = C1): DocsShowOk {
  const show = fileResponse(text).show;
  return commit === null ? show : { ...show, source: 'committed', commit };
}
function draftShow(text: string, head = C1): DocsShowOk {
  return { ...fileResponse(text).show, source: 'draft', head, fp: 'f'.repeat(64) };
}

const headPin = (commit = C1): DocPin => ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path: 'a.md' });
const basePin = (commit = BASE): DocPin => headPin(commit);
const draftPin = (): DocPin => ({ kind: 'draft', branch: 'main', head: C1, section: 'specs', path: 'a.md', fp: 'f'.repeat(64) });

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, pageAt: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};

/** A file loader that answers each commit from `texts`; a commit it does not hold answers `unreachable`. */
function fileFrom(texts: Record<string, DocsFileAnswer | string>): ReturnType<typeof fakeLoaders> {
  const f = fakeLoaders();
  f.file.mockImplementation(async (_project, pin) => {
    const a = pin.kind === 'committed' ? texts[pin.commit] : undefined;
    if (a === undefined) return { s: 'unreachable' };
    return typeof a === 'string' ? { s: 'ok', value: fileResponse(a) } : a;
  });
  return f;
}

interface Opened { readonly pin: DocPin; readonly page: Leaf; readonly only: string | null }

interface Rig {
  readonly renderFn: ReturnType<typeof vi.fn<ReaderDeps['render']>>;
  readonly mountFn: ReturnType<typeof vi.fn<ReaderDeps['mount']>>;
  readonly inputs: ReaderMountInput[];
  readonly files: ReturnType<typeof fakeLoaders>;
  readonly historyFn: ReturnType<typeof vi.fn<DocsHistoryLoader['history']>>;
  readonly assets: DocsAssetContextValue;
  readonly parser: MarkdownParser;
  reader(history?: boolean): ReaderDeps;
}

function rig(over: { files?: ReturnType<typeof fakeLoaders>; history?: DocsHistoryLoader['history'] } = {}): Rig {
  const inputs: ReaderMountInput[] = [];
  const handle = { destroy: vi.fn(), setPrefs: vi.fn(), command: vi.fn(), seed: { hosted: false as const }, follow: vi.fn() };
  const renderFn = vi.fn<ReaderDeps['render']>(async () => RENDERED);
  const mountFn = vi.fn<ReaderDeps['mount']>(async (_el, input) => {
    inputs.push(input);
    return handle as ReaderMount;
  });
  const historyFn = vi.fn<DocsHistoryLoader['history']>(over.history ?? (async () => okHistory(LOG)));
  const files = over.files ?? fakeLoaders();
  const assets: DocsAssetContextValue = { loaders: files.loaders, queue: createFetchQueue(), onDraftAsset: () => {} };
  const parser = vi.fn<MarkdownParser>(async (): Promise<ParseOutcome> => parseMarkdown('# Formatted', 'docs'));
  return {
    renderFn, mountFn, inputs, files, historyFn, assets, parser,
    reader: (history = true) => ({
      render: renderFn, mount: mountFn, images: async () => ({ urls: {}, drafts: 0, auth: 0 }),
      ...(history ? { history: { history: historyFn } } : {}),
    }),
  };
}

function frame(r: Rig, over: {
  show?: DocsShowOk; opened?: Opened | null; history?: boolean; bodyKey?: string; link?: Partial<Omit<DocLinkContextValue, 'urls'>>;
} = {}): ReactNode {
  const show = over.show ?? committedShow('# A\n');
  const opened = over.opened === undefined
    ? { pin: show.source === 'draft' ? draftPin() : headPin(), page: leafAt('/docs/demo/specs/a.md'), only: null }
    : over.opened;
  const props: ReaderFrameProps = {
    show, bodyKey: over.bodyKey ?? 'k1', link: { ...LINK, ...over.link }, parser: r.parser, reader: r.reader(over.history),
    pendingFragment: null, onFragmentConsumed: () => {},
    ...(opened === null ? {} : { opened }),
  };
  return <DocsAssetContext value={r.assets}><ReaderFrame key={props.bodyKey} {...props} /></DocsAssetContext>;
}

async function mounted(r: Rig, n = 1): Promise<ReaderMountInput> {
  await waitFor(() => expect(r.inputs.length).toBeGreaterThanOrEqual(n));
  return r.inputs[n - 1] as ReaderMountInput;
}

/** Lets the render, the images walk and every settled promise run, so a mount that was going to happen has. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((res) => setTimeout(res, 10));
  });
}

/** The router's own move: push the entry, then `popstate`. */
function realNavigate(): void {
  vi.mocked(navigate).mockImplementation((href) => {
    history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

/** The real `DocsLeaf` over a ready Markdown file: `useReaderOnly()` and the frame's key are the leaf's own. */
function Host(p: { readonly r: Rig; readonly show?: DocsShowOk }): ReactNode {
  const show = p.show ?? committedShow('# A\n');
  const tree = treeOk({ commit: C1 });
  const page = leafAt('/docs/demo/specs/a.md');
  const visit: DocsVisit = {
    tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
    file: { s: 'ok', pin: headPin(), answer: { ...fileResponse(show.text ?? ''), show }, receivedAt: Date.now() },
    freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
    ...NO_RANGE_VISIT, retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
  };
  return (
    <DocsAssetContext value={p.r.assets}>
      <DocsLeaf visit={visit} tree={tree} page={page} parser={p.r.parser} reader={p.r.reader()} />
    </DocsAssetContext>
  );
}

beforeEach(() => {
  vi.mocked(navigate).mockReset();
  history.replaceState(null, '', '/docs/demo/specs/a.md');
});

afterEach(() => {
  cleanup();
  resetReaderOnlyForTests();
  vi.restoreAllMocks();
});

describe('the body seed (rich-docs spec G6, M8.22)', () => {
  it('1: a committed body reads the log once at its opened pin, seeds the mapped commits, and the mount waits for it', async () => {
    const held = deferred<DocsHistoryAnswer>();
    const r = rig({ history: () => held.promise });
    render(frame(r));
    await waitFor(() => expect(r.historyFn).toHaveBeenCalledTimes(1));
    expect(r.historyFn).toHaveBeenCalledWith('demo', { commit: C1, section: 'specs', path: 'a.md' });
    await settle();
    expect(r.mountFn).not.toHaveBeenCalled();
    held.resolve(okHistory(LOG));
    const input = await mounted(r);
    expect(input.version).toEqual({ sha: C1, draft: false, commits: SEEDED, only: null });
    expect(r.historyFn).toHaveBeenCalledTimes(1);
  });

  it('2: a draft body reads no log; its seed is the draft with no commits, and its changes answer null with no file read', async () => {
    const r = rig();
    render(frame(r, { show: draftShow('# A\n', C2) }));
    const input = await mounted(r);
    expect(r.historyFn).not.toHaveBeenCalled();
    expect(input.version).toEqual({ sha: C2, draft: true, commits: null, only: null });
    await expect(input.changes!(BASE)).resolves.toBeNull();
    expect(r.files.file).not.toHaveBeenCalled();
  });

  it('1b: a history read that is not a complete answer (a failure word, a client slot, a rejection) mounts the body with no commits and no filter', async () => {
    const answers: Array<[string, DocsHistoryLoader['history']]> = [
      ['failure word', async () => ({ s: 'failed', body: { ok: false, failure: 'unknown-commit' } as never })],
      ['auth slot', async () => ({ s: 'auth' })],
      ['unreachable slot', async () => ({ s: 'unreachable' })],
      ['rejection', () => Promise.reject(new Error('boom'))],
    ];
    for (const [name, history] of answers) {
      const r = rig({ history });
      // The page stands on an entry whose filter is set: with no commits it is never kept.
      render(frame(r, { opened: { pin: headPin(), page: leafAt('/docs/demo/specs/a.md'), only: C2 } }));
      const input = await mounted(r);
      expect(r.historyFn, name).toHaveBeenCalledTimes(1);
      expect(input.version, name).toEqual({ sha: C1, draft: false, commits: null, only: null });
      cleanup();
    }
  });

  it('1c: startReaderHistory\'s seed resolves, never rejects, when the history loader rejects', async () => {
    const body = startReaderHistory({
      project: 'demo', show: committedShow('# Doc\n'), text: '# Doc\n', pin: headPin(),
      page: () => leafAt('/docs/demo/specs/a.md'), only: C2,
      history: { history: () => Promise.reject(new Error('boom')) }, loaders: null, queue: null,
      signal: new AbortController().signal,
    });
    await expect(body.seed).resolves.toEqual({ sha: C1, draft: false, commits: null, only: null });
  });

  it('11: the mount carries changes and openVersion only when opened is given, and version whenever the served hash is valid', async () => {
    const r1 = rig();
    render(frame(r1, { opened: null }));
    const bare = await mounted(r1);
    expect(bare.changes).toBeUndefined();
    expect(bare.openVersion).toBeUndefined();
    expect(bare.version).toEqual({ sha: C1, draft: false, commits: null, only: null });
    expect(r1.historyFn).not.toHaveBeenCalled();
    cleanup();
    const r2 = rig();
    render(frame(r2));
    const full = await mounted(r2);
    expect(typeof full.changes).toBe('function');
    expect(typeof full.openVersion).toBe('function');
    expect(full.version).toBeDefined();
    cleanup();
    // A served hash that is not a full commit seeds nothing, and reads no log.
    const r3 = rig();
    render(frame(r3, { show: committedShow('# A\n', null) }));
    expect((await mounted(r3)).version).toBeUndefined();
    expect(r3.historyFn).not.toHaveBeenCalled();
  });

  it('12: with no history loader and opened given, no log is read, the seed has no commits and no filter, and changes still work', async () => {
    const f = fileFrom({ [C1]: '# A\nb\n', [BASE]: '# A\n' });
    const r = rig({ files: f });
    render(frame(r, { show: committedShow('# A\nb\n'), history: false }));
    const input = await mounted(r);
    expect(r.historyFn).not.toHaveBeenCalled();
    expect(input.version).toEqual({ sha: C1, draft: false, commits: null, only: null });
    expect(input.version?.commits).not.toEqual([]);
    await expect(input.changes!(BASE)).resolves.toEqual({ ranges: [[2, 2]], removedAfter: [] });
  });
});

describe('changes(sha) (rich-docs spec G5)', () => {
  it('3: reads exactly the opened pin and the base pin through the loader, and answers readerDiff\'s marks', async () => {
    const head = '# A\nb\nc\n';
    const base = '# A\nx\nb\n';
    const f = fileFrom({ [C1]: head, [BASE]: base });
    const r = rig({ files: f });
    render(frame(r, { show: committedShow(head) }));
    const input = await mounted(r);
    const answer = await input.changes!(BASE);
    expect(f.file).toHaveBeenCalledTimes(2);
    const pins = f.file.mock.calls.map((c) => c[1]);
    expect(pins).toEqual(expect.arrayContaining([headPin(), basePin()]));
    expect(f.file.mock.calls.every((c) => c[0] === 'demo')).toBe(true);
    expect(answer).toEqual({ ranges: [[3, 3]], removedAfter: [1] });
    const d = readerDiff(base, head);
    expect(d.kind === 'available' && { ranges: d.ranges, removedAfter: d.removedAfter }).toEqual(answer);
    // Identical texts are a true answer: empty marks.
    f.file.mockImplementation(async () => ({ s: 'ok', value: fileResponse(head) }));
    await expect(input.changes!(BASE)).resolves.toEqual({ ranges: [], removedAfter: [] });
  });

  it('3b: a base that does not exist at its commit (absent-path) reads as the empty text, so every line of the head is marked new', async () => {
    const head = '# A\nb\nc\n';
    const f = fileFrom({ [C1]: head, [BASE]: { s: 'failed', body: { ok: false, failure: 'absent-path' } as never } });
    const r = rig({ files: f });
    render(frame(r, { show: committedShow(head) }));
    const input = await mounted(r);
    const answer = await input.changes!(BASE);
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(f.file.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining([headPin(), basePin()]));
    expect(answer).toEqual({ ranges: [[1, 3]], removedAfter: [] });
    const d = readerDiff('', head);
    expect(d.kind === 'available' && { ranges: d.ranges, removedAfter: d.removedAfter }).toEqual(answer);
  });

  it('4: answers null for a failed read, a client slot, a non-UTF-8 show, a head that is not the rendered text, a diff over the line bound and a short sha', async () => {
    const text = '# A\nb\n';
    const bad = { ...fileResponse('x').show, encoding: 'base64' as const, b64: '/w==', size: 1 };
    delete (bad as { text?: string }).text;
    const f = fileFrom({
      [C1]: text, [BASE]: text, [C2]: { s: 'unreachable' }, [C3]: { s: 'auth' },
      ['4'.repeat(40)]: { s: 'ok', value: { ...fileResponse(text), show: bad } },
      ['5'.repeat(40)]: { s: 'failed', body: { ok: false, failure: 'unknown-commit' } as never },
    });
    const r = rig({ files: f });
    render(frame(r, { show: committedShow(text) }));
    const input = await mounted(r);
    for (const sha of [C2, C3, '4'.repeat(40), '5'.repeat(40), 'abc', BASE.slice(0, 39)]) {
      await expect(input.changes!(sha)).resolves.toBeNull();
    }
    // The head file answers other text than the frame rendered.
    f.file.mockImplementation(async (_p, pin) => ({
      s: 'ok', value: fileResponse(pin.kind === 'committed' && pin.commit === C1 ? 'other\n' : text),
    }));
    await expect(input.changes!(BASE)).resolves.toBeNull();
    cleanup();
    // A diff over 20 000 lines is unavailable, never an empty answer.
    const long = 'x\n'.repeat(20001);
    const f2 = fileFrom({ [C1]: long, [BASE]: 'y\n' });
    const r2 = rig({ files: f2 });
    render(frame(r2, { show: committedShow(long) }));
    await expect((await mounted(r2)).changes!(BASE)).resolves.toBeNull();
  });
});

describe('changes(sha): absent-path is the empty text at the base only (rich-docs spec G5)', () => {
  it('4b: any other base answer is null, and a head that is absent is null even for an empty rendered text', async () => {
    const text = '# A\nb\n';
    const bad = { ...fileResponse('x').show, encoding: 'base64' as const, b64: '/w==', size: 1 };
    delete (bad as { text?: string }).text;
    const f = fileFrom({
      [C1]: text,
      [C2]: { s: 'failed', body: { ok: false, failure: 'unknown-commit' } as never },
      [C3]: { s: 'failed', body: { ok: false, failure: 'a-word-from-a-newer-server' } as never },
      ['4'.repeat(40)]: { s: 'auth' },
      ['5'.repeat(40)]: { s: 'unreachable' },
      ['6'.repeat(40)]: { s: 'ok', value: { ...fileResponse(text), show: bad } },
      ['7'.repeat(40)]: { s: 'failed', body: { ok: false, failure: 'not-a-file' } as never },
    });
    const rejecting = '8'.repeat(40);
    const inner = f.file.getMockImplementation()!;
    f.file.mockImplementation(async (project, pin, signal) => {
      if (pin.kind === 'committed' && pin.commit === rejecting) throw new Error('loader rejected');
      return inner(project, pin, signal);
    });
    const r = rig({ files: f });
    render(frame(r, { show: committedShow(text) }));
    const input = await mounted(r);
    for (const sha of [C2, C3, '4'.repeat(40), '5'.repeat(40), '6'.repeat(40), '7'.repeat(40), rejecting]) {
      await expect(input.changes!(sha), `base ${sha.slice(0, 4)}`).resolves.toBeNull();
    }
    cleanup();
    // A body whose rendered text is empty, its own head pin answering absent-path: the empty text is never read for a head.
    const absent: DocsFileAnswer = { s: 'failed', body: { ok: false, failure: 'absent-path' } as never };
    const f2 = fileFrom({ [C1]: absent, [BASE]: '# A\n' });
    const r2 = rig({ files: f2 });
    render(frame(r2, { show: committedShow('') }));
    await expect((await mounted(r2)).changes!(BASE)).resolves.toBeNull();
    expect(f2.file).toHaveBeenCalledTimes(2);
  });
});

describe('a body that has ended (stale answers)', () => {
  it('5: late answers of a body that ended resolve null for it, mount nothing, and change nothing in the next body', async () => {
    const text = '# A\nb\n';
    const gate = deferred<void>();
    const f = fileFrom({ [C1]: text, [BASE]: '# A\n' });
    const real = f.file.getMockImplementation()!;
    f.file.mockImplementation(async (p, pin, s) => { await gate.promise; return real(p, pin, s); });
    const r = rig({ files: f });
    const view = render(frame(r, { show: committedShow(text) }));
    const old = await mounted(r);
    const pending = old.changes!(BASE);
    await waitFor(() => expect(f.file).toHaveBeenCalled());
    view.unmount();
    gate.resolve();
    await expect(pending).resolves.toBeNull();
    // A body that ended also opens nothing.
    old.openVersion!({ sha: BASE });
    expect(navigate).not.toHaveBeenCalled();

    // The log held while the body's key changes: the old body mounts nothing, the new body's seed is its own.
    cleanup();
    const first = deferred<DocsHistoryAnswer>();
    let calls = 0;
    const r2 = rig({ history: () => (calls++ === 0 ? first.promise : Promise.resolve(okHistory(logOf([entry(C3, null)])))) });
    const view2 = render(frame(r2, { bodyKey: 'k1' }));
    await waitFor(() => expect(r2.historyFn).toHaveBeenCalledTimes(1));
    view2.rerender(frame(r2, { bodyKey: 'k2' }));
    const next = await mounted(r2);
    expect(next.version?.commits).toEqual([{ sha: C3, subject: `change ${C3.slice(0, 4)}`, date: DATE, parents: [] }]);
    first.resolve(okHistory(LOG));
    await settle();
    expect(r2.inputs).toHaveLength(1);
    expect(r2.inputs[0]).toBe(next);
    expect(next.version?.commits).toHaveLength(1);
  });

  // ReaderFrame checks its own abort after the seed, so the history body's contract is pinned on `startReaderHistory`
  // itself: a body that ends while its log is held settles its seed at once, and never seeds once the log answers.
  it('5b: the seed of a body that ends while its log is held resolves null at once, and stays null when the log answers', async () => {
    const held = deferred<DocsHistoryAnswer>();
    const ac = new AbortController();
    const body = startReaderHistory({
      project: 'demo', show: committedShow('# Doc\n'), text: '# Doc\n',
      pin: { kind: 'committed', commit: C1, servedRef: SERVED, section: 'specs', path: 'a.md' },
      page: () => leafAt('/docs/demo/specs/a.md'), only: null,
      history: { history: () => held.promise }, loaders: null, queue: null, signal: ac.signal,
    });
    let seen: unknown = 'pending';
    void body.seed.then((s) => { seen = s; });
    await act(async () => { await Promise.resolve(); });
    expect(seen, 'the log is held, so the seed waits').toBe('pending');
    ac.abort();
    await waitFor(() => expect(seen).toBeNull());
    held.resolve(okHistory(LOG));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(seen).toBeNull();
    expect(await body.seed).toBeNull();
  });
});

describe('openVersion (rich-docs spec G6, M8.22)', () => {
  it('6: opens the page at the sha with its ref kept and no only in the URL; no sha opens the latest; a refused move and an ended body open nothing', async () => {
    const r = rig();
    const page = leafAt('/docs/demo/specs/six.md?ref=ws/a');
    const view = render(frame(r, { opened: { pin: headPin(), page, only: null } }));
    const input = await mounted(r);
    act(() => { input.openVersion!({ sha: BASE, only: C2 }); });
    expect(navigate).toHaveBeenLastCalledWith('/docs/demo/specs/six.md?ref=ws/a&at=' + BASE);
    expect(vi.mocked(navigate).mock.calls.at(-1)?.[0]).not.toContain('only');
    act(() => { input.openVersion!({}); });
    expect(navigate).toHaveBeenLastCalledWith('/docs/demo/specs/six.md?ref=ws/a');
    expect(navigate).toHaveBeenCalledTimes(2);
    act(() => { input.openVersion!({ sha: 'abc' }); });
    act(() => { input.openVersion!({ sha: BASE, only: 'abc' }); });
    expect(navigate).toHaveBeenCalledTimes(2);
    view.unmount();
    input.openVersion!({ sha: BASE });
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('6b: the move reads the page as it is now, not as the body opened', async () => {
    const r = rig();
    const view = render(frame(r, { opened: { pin: headPin(), page: leafAt('/docs/demo/specs/six-b.md'), only: null } }));
    const input = await mounted(r);
    view.rerender(frame(r, { opened: { pin: headPin(), page: leafAt('/docs/demo/specs/six-b.md?ref=ws/a'), only: null } }));
    act(() => { input.openVersion!({ sha: BASE }); });
    expect(navigate).toHaveBeenLastCalledWith('/docs/demo/specs/six-b.md?ref=ws/a&at=' + BASE);
  });

  it('7: the day filter lands in the new history entry\'s state, never in the URL, and the next body is seeded with it', async () => {
    realNavigate();
    const r = rig();
    render(<Host r={r} />);
    const first = await mounted(r);
    expect(first.version?.only).toBeNull();
    act(() => { first.openVersion!({ sha: C1, only: C2 }); });
    const next = await mounted(r, 2);
    expect(location.search).not.toContain('only');
    expect(location.search).toContain(`at=${C1}`);
    expect((history.state as Record<string, unknown>)[READER_ONLY_STATE_KEY]).toBe(C2);
    expect(next.version?.only).toBe(C2);
    expect(r.inputs).toHaveLength(2);
  });

  it('7b: a filter the log does not admit is dropped from the seed', async () => {
    realNavigate();
    const r = rig();
    render(<Host r={r} />);
    const first = await mounted(r);
    act(() => { first.openVersion!({ sha: C1, only: '9'.repeat(40) }); });
    const next = await mounted(r, 2);
    expect(next.version?.only).toBeNull();
  });
});

describe('the visit\'s own filter (history.state, rich-docs spec M8.22)', () => {
  it('8: back and forward answer each entry\'s own filter, two entries of one URL included, and a new filter remounts the leaf\'s body', async () => {
    history.replaceState({ [READER_ONLY_STATE_KEY]: C1 }, '', '/docs/demo/specs/a.md?at=' + C3);
    history.pushState({ [READER_ONLY_STATE_KEY]: C2 }, '', '/docs/demo/specs/a.md?at=' + C3);
    const r = rig();
    render(<Host r={r} />);
    const first = await mounted(r);
    expect(first.version?.only).toBe(C2);
    expect(r.mountFn).toHaveBeenCalledTimes(1);
    act(() => { history.back(); });
    await waitFor(() => expect(r.inputs.at(-1)?.version?.only).toBe(C1));
    expect(r.mountFn).toHaveBeenCalledTimes(2);
    expect(r.inputs[1]).not.toBe(first);
    act(() => { history.forward(); });
    await waitFor(() => expect(r.inputs.at(-1)?.version?.only).toBe(C2));
    expect(r.mountFn).toHaveBeenCalledTimes(3);
    // An entry with no filter answers none.
    act(() => { history.pushState(null, '', '/docs/demo/specs/a.md?at=' + C3); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(r.inputs.at(-1)?.version?.only).toBeNull());
    expect(r.mountFn).toHaveBeenCalledTimes(4);
  });

  it('8b: a pending filter is spent once: the same URL pushed again as a new entry answers none, and back answers the earlier entry\'s own', async () => {
    realNavigate();
    const r = rig();
    render(<Host r={r} />);
    const first = await mounted(r);
    act(() => { first.openVersion!({ sha: C1, only: C2 }); });
    const next = await mounted(r, 2);
    expect(next.version?.only).toBe(C2);
    const url = location.pathname + location.search;
    // An ordinary link to the same page: a new entry with no state, then `popstate`, as the router fires it.
    act(() => { history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(r.inputs.at(-1)?.version?.only).toBeNull());
    expect(history.state).toBeNull();
    const probed: Array<string | null> = [];
    function Probe(): ReactNode { probed.push(useReaderOnly()); return null; }
    render(<Probe />);
    await settle();
    expect(probed.at(-1)).toBeNull();
    act(() => { history.back(); });
    await waitFor(() => expect(r.inputs.at(-1)?.version?.only).toBe(C2));
  });

  it('9: a reload on an entry whose state already holds a filter seeds the body with it', async () => {
    history.replaceState({ other: 1, [READER_ONLY_STATE_KEY]: C2 }, '', '/docs/demo/specs/a.md?at=' + C3);
    const r = rig();
    render(<Host r={r} />);
    expect((await mounted(r)).version?.only).toBe(C2);
    expect(r.inputs).toHaveLength(1);
    expect((history.state as Record<string, unknown>).other).toBe(1);
  });

  it('9b: a pending filter belongs to the entry it was set for, not to another URL', async () => {
    const r = rig();
    render(frame(r, { opened: { pin: headPin(), page: leafAt('/docs/demo/specs/nine-b.md'), only: null } }));
    const input = await mounted(r);
    act(() => { input.openVersion!({ sha: C1, only: C2 }); });
    // navigate is the bare mock: nothing moved. A different entry does not take the filter.
    history.replaceState(null, '', '/docs/demo/specs/elsewhere.md');
    const seen: Array<string | null> = [];
    function Probe(): ReactNode { seen.push(useReaderOnly()); return null; }
    render(<Probe />);
    await settle();
    expect(seen.every((x) => x === null)).toBe(true);
    expect(history.state).toBeNull();
  });
});

describe('links on a version page (refinement (o), M9.10)', () => {
  it('10: a doc link keeps the page\'s at and ref', async () => {
    const r = rig();
    render(frame(r, { link: { pageRef: { kind: 'bare', name: 'ws/a' }, pageAt: C3 } }));
    const input = await mounted(r);
    act(() => { input.onLink({ kind: 'relative', path: 'b.md', fragment: null }); });
    expect(navigate).toHaveBeenCalledWith(`/docs/demo/specs/b.md?ref=ws/a&at=${C3}`);
  });
});
