// X5 A5.1 (plan 2026-11-19-native-docs-html-artifacts, Task A5.1; spec §2.5, §6.1 Figure 4): the offer drawn beside every
// HTML page's walls view, and on the three HTML branches that never mount it, and the store it reads (one availability read for
// every consumer, read again when it failed or a sign-in returns, newest answer wins, an unwordable answer is a failed read).
// A fake `ArtifactDoors` answers through `ArtifactDoorsContext`; the real views, visit and pre-scan run. Placeholders only (`demo`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DOCS_CLASS_CAP, type DocPin, type DocsPageLocation, type DocsShowOk } from '../../shared/docs';
import type { ArtifactListOk, ArtifactOffWhy } from '../../shared/artifacts';
import { ARTIFACT_TEXT } from '../src/docs/artifact/artifactWords';
import type { ArtifactAnswer, ArtifactDoors } from '../src/docs/artifact/tier';
import { ArtifactDoorsContext, artifactPageKey, resetArtifactsForTest, useArtifacts, type UseArtifacts } from '../src/docs/artifact/useArtifacts';
import { DocsLeaf } from '../src/docs/DocsLeaf';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { MockupView } from '../src/docs/MockupView';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer } from '../src/docs/failures';
import { DOCS_RANGE_TEXT, DOCS_VIEW_TEXT, MOCKUP_REFUSAL_SENTENCE, MOCKUP_TEXT, fillSentence, mib } from '../src/docs/docsText';
import { MOCKUP_AUTO_RENDER_BYTES, MOCKUP_MAX_DEPTH } from '../src/docs/mockup/policy';
import type { MockupAssetReader, MockupContext } from '../src/docs/mockup/ports';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { RangeLoader } from '../src/docs/range/readRange';
import { BLOB_2, COMMIT_A, entry, failedAnswer, fakeLoaders, fileResponse, holder, okTree, pageAt, treeOk } from './docsFixtures';

afterEach(() => {
  cleanup();
  clearAuthLost();
  resetArtifactsForTest();
});
beforeEach(() => {
  resetArtifactsForTest();
});

const OPEN = ARTIFACT_TEXT.open;
const enc = new TextEncoder();
const okList = (list: ArtifactListOk): ArtifactAnswer<ArtifactListOk> => ({ s: 'ok', value: list });
const AVAILABLE_LIST: ArtifactListOk = { ok: true, available: true, live: [] };
const flushTimers = (): Promise<void> => new Promise((r) => { setTimeout(r, 10); });

/** Doors whose availability read is `list` (counted); the other four are never reached by these cases. */
function doorsWith(list: () => Promise<ArtifactAnswer<ArtifactListOk>>): { readonly doors: ArtifactDoors; readonly lists: () => number } {
  let lists = 0;
  const none = (): never => { throw new Error('this case reads the availability only'); };
  const doors: ArtifactDoors = { list: () => { lists += 1; return list(); }, scope: none, mint: none, revoke: none, revokeAll: none };
  return { doors, lists: () => lists };
}
const doorsOf = (list: ArtifactListOk) => doorsWith(async () => okList(list));
const availableDoors = () => doorsOf(AVAILABLE_LIST);
const unavailableDoors = (why: ArtifactOffWhy) => doorsOf({ ok: true, available: false, why, live: [] });

/** Holds one availability read until the test answers it. */
function held() {
  const waiting: ((a: ArtifactAnswer<ArtifactListOk>) => void)[] = [];
  const list = (): Promise<ArtifactAnswer<ArtifactListOk>> => new Promise((resolve) => { waiting.push(resolve); });
  return { list, answer: (i: number, a: ArtifactAnswer<ArtifactListOk>) => waiting[i]!(a), reads: () => waiting.length };
}

/** A consumer of the store that shows its list state and hands the test its latest hook value. */
const seen: { current: UseArtifacts | null } = { current: null };
function Probe(): ReactNode {
  const a = useArtifacts();
  seen.current = a;
  return <output data-testid="list">{a.state.list.s === 'ok' ? JSON.stringify(a.state.list.avail) : a.state.list.s}</output>;
}
const listState = (): string => screen.getByTestId('list').textContent ?? '';

const PAGE: DocsPageLocation & { kind: 'path' } = {
  kind: 'path', project: 'demo', section: 'specs', path: 'm.html', dirSlash: false, ref: null, at: null, view: 'effective', frame: 'inline',
};
function showOf(text: string, size: number = enc.encode(text).byteLength): DocsShowOk {
  return {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 1, source: 'committed', section: 'specs', path: 'm.html', size,
    sha256: 'c'.repeat(64), encoding: 'utf8', text, commit: COMMIT_A,
  };
}
const CONTEXT: MockupContext = {
  project: 'demo',
  pin: { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' } satisfies DocPin,
  tree: treeOk({ entries: [entry('specs', 'm.html')], drafts: holder() }),
};
const READER: MockupAssetReader = { read: async () => ({ kind: 'ok', bytes: new Uint8Array([1, 2, 3]) }) };
const ASSETS: DocsAssetContextValue = { loaders: fakeLoaders().loaders, queue: createFetchQueue(), onDraftAsset: () => {} };

function mockupOf(p: { readonly html: string; readonly size?: number; readonly page?: typeof PAGE; readonly doors: ArtifactDoors }): ReactNode {
  return (
    <ArtifactDoorsContext value={p.doors}>
      <Probe />
      <DocsAssetContext value={ASSETS}>
        <MockupView
          show={showOf(p.html, p.size)} context={CONTEXT} reader={READER} page={p.page ?? PAGE} relist={() => {}}
          download={<button type="button">Download</button>}
        />
      </DocsAssetContext>
    </ArtifactDoorsContext>
  );
}

describe('offer: beside the walls, refused or not', () => {
  it('a page the pre-scan runs shows the frame toolbar and the button', async () => {
    const { doors } = availableDoors();
    const { container } = render(mockupOf({ html: '<p>hi</p>', doors }));
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(container.querySelector('.docs-mockup-toolbar')).not.toBeNull();
    expect(container.querySelector('.docs-mockup')?.getAttribute('data-state')).not.toBe('refused');
  });

  it('a page the pre-scan refuses under the budgets shows its refusal line and the button', async () => {
    const { doors } = availableDoors();
    const { container } = render(mockupOf({ html: '<div>'.repeat(MOCKUP_MAX_DEPTH + 1), doors }));
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
    expect(container.querySelector('.docs-mockup')?.getAttribute('data-state')).toBe('refused');
    expect(screen.getByText(fillSentence(MOCKUP_TEXT.refusal, { reason: MOCKUP_REFUSAL_SENTENCE['too-deep'] }))).toBeInTheDocument();
  });

  it('the gated view, before Render, shows the button', async () => {
    const { doors } = availableDoors();
    const { container } = render(mockupOf({ html: '<p>a</p>', size: MOCKUP_AUTO_RENDER_BYTES + 1, doors }));
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
    expect(container.querySelector('.docs-mockup')?.getAttribute('data-state')).toBe('gated');
  });

  it('the full-screen view shows no offer, after the availability read has answered ok', async () => {
    const { doors } = availableDoors();
    const { container } = render(mockupOf({ html: '<p>hi</p>', doors, page: { ...PAGE, frame: 'full' } }));
    await waitFor(() => expect(listState()).toBe('{"available":true}'));
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
  });
});

describe('offer: the button, the sentences', () => {
  it('a version page shows the version sentence and no button', async () => {
    const { doors } = availableDoors();
    render(mockupOf({ html: '<p>hi</p>', doors, page: { ...PAGE, at: COMMIT_A } }));
    expect(await screen.findByText(ARTIFACT_TEXT.version)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
  });

  it('offer: a version page gets its sentence, and the same page at its current version gets the button', async () => {
    const { doors } = availableDoors();
    const { unmount } = render(mockupOf({ html: '<p>hi</p>', doors, page: { ...PAGE, at: COMMIT_A } }));
    expect(await screen.findByText(ARTIFACT_TEXT.version)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
    unmount();
    resetArtifactsForTest();
    render(mockupOf({ html: '<p>hi</p>', doors }));
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
    expect(screen.queryByText(ARTIFACT_TEXT.version)).toBeNull();
  });

  it('an unavailable box shows a disabled button described by the setup sentence', async () => {
    const { doors } = unavailableDoors('unset');
    render(mockupOf({ html: '<p>hi</p>', doors }));
    const reason = await screen.findByText(ARTIFACT_TEXT.setup);
    const button = screen.getByRole('button', { name: OPEN });
    expect(button).toBeDisabled();
    expect(reason.id).not.toBe('');
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('the live button says it opens a dialog (the launch sheet), and the disabled one does not', async () => {
    const { doors } = availableDoors();
    render(mockupOf({ html: '<p>hi</p>', doors }));
    expect((await screen.findByRole('button', { name: OPEN })).getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('sign-in dark shows nothing', async () => {
    const { doors } = unavailableDoors('auth-off');
    render(mockupOf({ html: '<p>hi</p>', doors }));
    await waitFor(() => expect(listState()).toBe('{"available":false,"why":"auth-off"}'));
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
    expect(screen.queryByText(ARTIFACT_TEXT.setup)).toBeNull();
  });

  it('a failed availability read shows nothing, after exactly one read', async () => {
    const { doors, lists } = doorsWith(async () => ({ s: 'unreachable' }));
    render(mockupOf({ html: '<p>hi</p>', doors }));
    await waitFor(() => expect(listState()).toBe('failed'));
    await flushTimers();
    expect(lists()).toBe(1);
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
  });

  it('opening the offer sets the store\'s sheet-for key to the page, with no window and no further read', async () => {
    const { doors, lists } = availableDoors();
    const open = vi.spyOn(window, 'open');
    render(mockupOf({ html: '<p>hi</p>', doors }));
    const btn = await screen.findByRole('button', { name: OPEN });
    expect(seen.current?.state.sheetFor).toBeNull();
    act(() => btn.click());
    expect(seen.current?.state.sheetFor).toBe(artifactPageKey('demo', 'specs', 'm.html'));
    expect(open).not.toHaveBeenCalled();
    expect(lists()).toBe(1);
    open.mockRestore();
  });
});

describe('the store: reads, re-reads and answers', () => {
  it('S-1a: a consumer that mounts while the list is failed reads it again, one read in flight at a time', async () => {
    const h = held();
    const { doors, lists } = doorsWith(h.list);
    const first = render(<ArtifactDoorsContext value={doors}><Probe /></ArtifactDoorsContext>);
    await waitFor(() => expect(h.reads()).toBe(1));
    await act(async () => h.answer(0, { s: 'unreachable' }));
    expect(listState()).toBe('failed');
    first.unmount();
    // Two consumers mount together on a failed list: one read between them.
    render(<ArtifactDoorsContext value={doors}><Probe /><Probe /></ArtifactDoorsContext>);
    await waitFor(() => expect(h.reads()).toBe(2));
    await flushTimers();
    expect(lists()).toBe(2);
    await act(async () => h.answer(1, okList(AVAILABLE_LIST)));
    expect(screen.getAllByTestId('list').map((n) => n.textContent)).toEqual(['{"available":true}', '{"available":true}']);
  });

  it('S-1b: a sign-in regained reads the list again, and the last ok answer stands while it reads', async () => {
    const h = held();
    const { doors, lists } = doorsWith(h.list);
    render(<ArtifactDoorsContext value={doors}><Probe /></ArtifactDoorsContext>);
    await waitFor(() => expect(h.reads()).toBe(1));
    await act(async () => h.answer(0, okList(AVAILABLE_LIST)));
    expect(listState()).toBe('{"available":true}');
    act(() => raiseAuthLost('expired'));
    act(() => clearAuthLost());
    await waitFor(() => expect(h.reads()).toBe(2));
    expect(listState(), 'kept while the read is out').toBe('{"available":true}');
    await act(async () => h.answer(1, okList({ ok: true, available: false, why: 'listener-down', live: [] })));
    expect(listState()).toBe('{"available":false,"why":"listener-down"}');
    expect(lists()).toBe(2);
  });

  it('S-2: reads that answer out of order publish the newest read\'s answer, never the older one', async () => {
    const h = held();
    const { doors } = doorsWith(h.list);
    render(<ArtifactDoorsContext value={doors}><Probe /></ArtifactDoorsContext>);
    await waitFor(() => expect(h.reads()).toBe(1));
    act(() => { void seen.current?.refresh(); });
    await waitFor(() => expect(h.reads()).toBe(2));
    await act(async () => h.answer(1, okList({ ok: true, available: false, why: 'unset', live: [] })));
    expect(listState()).toBe('{"available":false,"why":"unset"}');
    await act(async () => h.answer(0, okList(AVAILABLE_LIST)));
    expect(listState(), 'the older read answered last and is dropped').toBe('{"available":false,"why":"unset"}');
  });

  it.each([
    ['no reason', { ok: true, available: false, live: [] } satisfies ArtifactListOk],
    ['an unknown reason', { ok: true, available: false, why: 'new-reason' as ArtifactOffWhy, live: [] } satisfies ArtifactListOk],
  ])('S-3: an unavailable answer with %s is a failed read, never the setup sentence', async (_name, list) => {
    const { doors } = doorsOf(list);
    render(mockupOf({ html: '<p>hi</p>', doors }));
    await waitFor(() => expect(listState()).toBe('failed'));
    expect(screen.queryByText(ARTIFACT_TEXT.setup)).toBeNull();
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
  });
});

describe('the leaf branches that never mount the walls view', () => {
  const parser = async (src: string) => parseMarkdown(src, 'docs');
  const fileAs = (text: string): DocsFileAnswer => {
    const r = fileResponse(text);
    return { s: 'ok', value: { ...r, contentClass: 'html', show: { ...r.show, path: 'm.html', size: text.length } } };
  };
  function leafOf(
    f: ReturnType<typeof fakeLoaders>, doors: ArtifactDoors, assets: DocsAssetContextValue | null, rangeLoader?: RangeLoader,
    url = '/docs/demo/specs/m.html',
  ): ReactNode {
    const located = pageAt(url);
    if (located.kind !== 'path') throw new Error('fixture: not a leaf');
    const page = located;
    function Harness(): ReactNode {
      const visit = useDocsVisit(page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={rangeLoader} />;
    }
    const body = <ArtifactDoorsContext value={doors}><Harness /></ArtifactDoorsContext>;
    return assets === null ? body : <DocsAssetContext value={assets}>{body}</DocsAssetContext>;
  }
  const NEVER: RangeLoader = { prepare: () => new Promise(() => undefined), frame: () => new Promise(() => undefined) };

  it('offer: a page above 2 MiB shows the too-large sentence, Download and the button, and no walls view', async () => {
    const { doors } = availableDoors();
    const size = DOCS_CLASS_CAP.html + 1;
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'm.html', { committed: { kind: 'file', blob: '1'.repeat(40), size } })] })) });
    const { container } = render(leafOf(f, doors, ASSETS, NEVER));
    expect(await screen.findByText(fillSentence(DOCS_RANGE_TEXT.downloadOnly, { size: mib(size) }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.download })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
    expect(container.querySelector('.docs-mockup')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('offer: a version page above 2 MiB reads by range and shows the version sentence, with no button', async () => {
    const { doors } = availableDoors();
    const size = DOCS_CLASS_CAP.html + 1;
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'm.html')] })) });
    f.file.mockResolvedValue(failedAnswer('too-large', { size, cap: DOCS_CLASS_CAP.html, blob: BLOB_2 }));
    const { container } = render(leafOf(f, doors, ASSETS, NEVER, `/docs/demo/specs/m.html?at=${'9'.repeat(40)}`));
    expect(await screen.findByText(fillSentence(DOCS_RANGE_TEXT.downloadOnly, { size: mib(size) }))).toBeInTheDocument();
    expect(await screen.findByText(ARTIFACT_TEXT.version)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
    expect(container.querySelector('.docs-mockup')).toBeNull();
  });

  it('offer: the stand-in shows Source, Download and the button when there is no asset reader', async () => {
    const { doors } = availableDoors();
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'm.html')] })), file: fileAs('<p>mock</p>') });
    const { container } = render(leafOf(f, doors, null));
    expect(await screen.findByRole('button', { name: DOCS_VIEW_TEXT.source })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.download })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
    expect(container.querySelector('.docs-standin')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
