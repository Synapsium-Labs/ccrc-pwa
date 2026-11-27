// X5 A5.3 (plan 2026-11-19-native-docs-html-artifacts, Task A5.3; spec §3.3 "Revocation" and "Re-hand", acceptance row AR-A5): the live
// artifact links as the console lists them. Each row shows its page, version, when it was opened, its last request and its end, and
// NEVER a URL; Revoke and Revoke all call their doors and drop the rows; a scoped list (Page details) shows one page's rows and the
// index form every row; a failed revoke keeps the rows and says one sentence. A fake `ArtifactDoors` answers through
// `ArtifactDoorsContext`; the real store, the real Page details panel and the real index run. Placeholders only (`demo`, `lane-a`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DocsIndexRow, DocsProjectsResponse } from '../../shared/docs';
import type { ArtifactListOk, ArtifactRevokeOk, ArtifactRow } from '../../shared/artifacts';
import { ArtifactList } from '../src/docs/artifact/ArtifactList';
import { ARTIFACT_REFUSAL_TEXT } from '../src/docs/artifact/artifactWords';
import { ARTIFACT_LIST_FRESH_MS, ARTIFACT_LIST_TEXT } from '../src/docs/artifact/listWords';
import type { ArtifactAnswer, ArtifactDoors } from '../src/docs/artifact/tier';
import { ArtifactDoorsContext, resetArtifactsForTest, useArtifacts } from '../src/docs/artifact/useArtifacts';
import { DocsIndexView } from '../src/docs/DocsIndexView';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DOCS_HEAD_TEXT, DOCS_SLOT_SENTENCE } from '../src/docs/docsText';
import type { DocsLoaders } from '../src/docs/failures';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import { COMMIT_B, entry, fakeLoaders, okTree, treeOk } from './docsFixtures';

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const MIN = 60000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetArtifactsForTest();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
  resetArtifactsForTest();
});

/** One live row as the server sends it: ids and names only, never a token or a URL. */
function rowOf(id: string, over: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id, project: 'demo', section: 'specs', path: 'm.html', pinLabel: 'aaaaaaaaaaaa',
    mintedAt: NOW - 125 * MIN, lastAt: NOW - 5 * MIN, expiresAt: NOW + 55 * MIN, windows: false, origins: [], ...over,
  };
}
const A = rowOf('aaaaaaaa-A');
const B = rowOf('bbbbbbbb-B', { path: 'other.html', pinLabel: 'draft on lane-a-branch', windows: true, origins: ['https://one.example.test', 'https://two.example.test'] });
const C = rowOf('cccccccc-C', { project: 'demo-two', section: 'plans', path: 'p.html', lastAt: NOW - 3 * 60 * MIN, mintedAt: NOW - 3 * 60 * MIN });

const okList = (live: ArtifactRow[]): ArtifactAnswer<ArtifactListOk> => ({ s: 'ok', value: { ok: true, available: true, live } });
const revoked = (n: number): ArtifactAnswer<ArtifactRevokeOk> => ({ s: 'ok', value: { ok: true, revoked: n } });

/** Fake doors over a mutable live list: revoke and revoke-all remove rows, as the box does, and are counted. */
function fakeDoors(start: ArtifactRow[], over: Partial<ArtifactDoors> = {}) {
  let live = [...start];
  const revoke = vi.fn(async (id: string): Promise<ArtifactAnswer<ArtifactRevokeOk>> => {
    const had = live.some((r) => r.id === id);
    live = live.filter((r) => r.id !== id);
    return revoked(had ? 1 : 0);
  });
  const revokeAll = vi.fn(async (): Promise<ArtifactAnswer<ArtifactRevokeOk>> => {
    const n = live.length;
    live = [];
    return revoked(n);
  });
  const list = vi.fn(async () => okList([...live]));
  const none = (): never => { throw new Error('this case lists and revokes only'); };
  const doors: ArtifactDoors = { list, scope: none, mint: none, revoke, revokeAll, ...over };
  return { doors, revoke, revokeAll, list };
}

/** A consumer of the store that shows its list state, so a case can wait for the answer a list is drawn from. */
function Probe(): ReactNode {
  const a = useArtifacts();
  return <output data-testid="store">{a.state.list.s}</output>;
}
const storeState = (): string => screen.getByTestId('store').textContent ?? '';

const within_ = (doors: ArtifactDoors, ui: ReactNode): ReactNode => <ArtifactDoorsContext value={doors}>{ui}</ArtifactDoorsContext>;
const rowsShown = (): HTMLElement[] => screen.queryAllByRole('listitem');
const revokeButtons = (): HTMLElement[] => screen.queryAllByRole('button', { name: /^Revoke (?!all)/ });

describe('list: what a row shows', () => {
  it('list: each row shows its page, version, minted, last request and expiry', async () => {
    const { doors } = fakeDoors([A, B]);
    render(within_(doors, <ArtifactList scope={undefined} />));
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = items[0]!;
    expect(first.textContent).toContain('specs/m.html');
    expect(first.textContent).toContain('Pinned to aaaaaaaaaaaa');
    expect(first.textContent).toContain('Opened 2h ago');
    expect(first.textContent).toContain('Last request 5m ago');
    expect(first.textContent).toContain('Ends in 55m');
    expect(first.textContent).toContain(ARTIFACT_LIST_TEXT.windowsClosed);
    expect(first.textContent).toContain('Outside hosts: 0');
    const second = items[1]!;
    expect(second.textContent).toContain('specs/other.html');
    expect(second.textContent).toContain('Pinned to draft on lane-a-branch');
    expect(second.textContent).toContain(ARTIFACT_LIST_TEXT.windowsAllowed);
    expect(second.textContent).toContain('Outside hosts: 2');
  });

  it('a capability nobody has requested yet says so, and one past its end says it ends now', async () => {
    const { doors } = fakeDoors([C, rowOf('late0000-L', { expiresAt: NOW - 1 })]);
    render(within_(doors, <ArtifactList />));
    const items = await screen.findAllByRole('listitem');
    expect(items[0]!.textContent).toContain(ARTIFACT_LIST_TEXT.lastNone);
    expect(items[0]!.textContent).toContain('Ends in');
    expect(items[1]!.textContent).toContain(ARTIFACT_LIST_TEXT.expiresNow);
  });

  it('list: never a URL', async () => {
    const { doors } = fakeDoors([A, B, C]);
    const { container } = render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/https?:|\/a\/|\/c\//);
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        expect(`${attr}=${el.getAttribute(attr)}`, `${el.tagName} ${attr}`).not.toMatch(/https?:|\/a\/|\/c\/|href=|src=/);
      }
    }
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('list: Revoke and Revoke all', () => {
  it('list: Revoke calls revoke(id) once and the row drops after the refresh', async () => {
    const { doors, revoke, revokeAll } = fakeDoors([A, B]);
    render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke specs/other.html in demo (bbbbbbbb)' }));
    await waitFor(() => expect(rowsShown()).toHaveLength(1));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('bbbbbbbb-B');
    expect(revokeAll).not.toHaveBeenCalled();
    expect(rowsShown()[0]!.textContent).toContain('specs/m.html');
    expect(screen.queryByText(ARTIFACT_LIST_TEXT.failed)).toBeNull();
  });

  it('list: Revoke all calls revokeAll() once and every row drops', async () => {
    const { doors, revoke, revokeAll } = fakeDoors([A, B, C]);
    const { container } = render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    expect(screen.getByText(ARTIFACT_LIST_TEXT.revokeAllNote.replace('{n}', '3'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ARTIFACT_LIST_TEXT.revokeAllLabel }));
    await waitFor(() => expect(container.querySelector('li')).toBeNull());
    expect(revokeAll).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: ARTIFACT_LIST_TEXT.revokeAllLabel })).toBeNull();
  });

  it('list: a failed revoke keeps the rows and says one sentence', async () => {
    const { doors } = fakeDoors([A, B], { revoke: vi.fn(async () => ({ s: 'unreachable' as const })) });
    render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke specs/m.html in demo (aaaaaaaa)' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(DOCS_SLOT_SENTENCE.unreachable));
    expect(rowsShown()).toHaveLength(2);
    expect(revokeButtons()).toHaveLength(2);
  });

  it('list: an unauthenticated refusal says its own words and never "Try again"; a thrown door says the plain sentence', async () => {
    const refused = fakeDoors([A, B], { revokeAll: vi.fn(async () => ({ s: 'refused' as const, word: 'unauthenticated' as const })) });
    const { unmount } = render(within_(refused.doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: ARTIFACT_LIST_TEXT.revokeAllLabel }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ARTIFACT_REFUSAL_TEXT.unauthenticated));
    expect(screen.getByRole('status').textContent).not.toMatch(/try again/i);
    expect(rowsShown()).toHaveLength(2);
    unmount();
    resetArtifactsForTest();
    const rejected = fakeDoors([A, B], { revokeAll: vi.fn(async () => { throw new Error('defect'); }) });
    render(within_(rejected.doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: ARTIFACT_LIST_TEXT.revokeAllLabel }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ARTIFACT_LIST_TEXT.failedAll));
    expect(rowsShown()).toHaveLength(2);
  });

  it('list: the status line stays mounted and empty until it has a sentence, and clears on the next try', async () => {
    let fail = true;
    const { doors } = fakeDoors([A, B], {
      revoke: vi.fn(async () => (fail ? { s: 'unreachable' as const } : revoked(1))),
    });
    render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke specs/m.html in demo (aaaaaaaa)' }));
    await waitFor(() => expect(status).toHaveTextContent(DOCS_SLOT_SENTENCE.unreachable));
    expect(screen.getByRole('status')).toBe(status);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Revoke specs/m.html in demo (aaaaaaaa)' }));
    await waitFor(() => expect(status.textContent).toBe(''));
  });

  it('list: after a revoke that ended, focus moves to the list heading', async () => {
    const { doors } = fakeDoors([A, B]);
    render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    const button = screen.getByRole('button', { name: 'Revoke specs/m.html in demo (aaaaaaaa)' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(rowsShown()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: ARTIFACT_LIST_TEXT.heading })));
  });

  it('list: a double tap on Revoke calls the door once, and a double tap on Revoke all calls it once', async () => {
    const one = fakeDoors([A, B]);
    const first = render(within_(one.doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    const button = screen.getByRole('button', { name: 'Revoke specs/m.html in demo (aaaaaaaa)' });
    // One act: both taps land before React draws the disabled state, so only the in-flight ref can stop the second.
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(rowsShown()).toHaveLength(1));
    expect(one.revoke).toHaveBeenCalledTimes(1);
    first.unmount();
    resetArtifactsForTest();
    const all = fakeDoors([A, B]);
    render(within_(all.doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    const everyone = screen.getByRole('button', { name: ARTIFACT_LIST_TEXT.revokeAllLabel });
    act(() => { everyone.click(); everyone.click(); });
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0));
    expect(all.revokeAll).toHaveBeenCalledTimes(1);
  });
});

describe('list: scope and presence', () => {
  it('list: a scoped list shows only its page\'s rows, and the index form shows every row and names each project', async () => {
    const { doors } = fakeDoors([A, B, C]);
    const scoped = render(within_(doors, <ArtifactList scope={{ project: 'demo', section: 'specs', path: 'm.html' }} />));
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('specs/m.html');
    expect(items[0]!.textContent).not.toContain('demo-two');
    // The note still counts the whole box, because Revoke all ends every link on it.
    expect(screen.getByText(ARTIFACT_LIST_TEXT.revokeAllNote.replace('{n}', '3'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke specs/m.html (aaaaaaaa)' })).toBeInTheDocument();
    scoped.unmount();
    render(within_(doors, <ArtifactList />));
    const all = await screen.findAllByRole('listitem');
    expect(all).toHaveLength(3);
    expect(all.map((li) => li.textContent).join('|')).toContain('demo-two');
    expect(screen.getByRole('button', { name: 'Revoke plans/p.html in demo-two (cccccccc)' })).toBeInTheDocument();
  });

  it('a scope no row matches draws nothing, though other rows are live (an unscoped list beside it shows them)', async () => {
    const { doors } = fakeDoors([A, C]);
    render(within_(doors, (
      <>
        <ArtifactList scope={{ project: 'demo', section: 'specs', path: 'none.html' }} />
        <ArtifactList />
      </>
    )));
    // The sentinel: the unscoped list's rows are on the page, so the store is ok and the scoped list had its chance.
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: ARTIFACT_LIST_TEXT.heading })).toHaveLength(1);
  });

  it('nothing renders when the list is empty, or failed (the store has answered, which a probe shows)', async () => {
    const empty = fakeDoors([]);
    const first = render(within_(empty.doors, <><Probe /><ArtifactList /></>));
    await waitFor(() => expect(storeState()).toBe('ok'));
    expect(first.container.querySelector('section')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    first.unmount();
    resetArtifactsForTest();
    const failed = fakeDoors([A], { list: vi.fn(async () => ({ s: 'unreachable' as const })) });
    const second = render(within_(failed.doors, <><Probe /><ArtifactList /></>));
    await waitFor(() => expect(storeState()).toBe('failed'));
    expect(second.container.querySelector('section')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('nothing renders before the list answers (a probe shows it loading)', async () => {
    const doors = fakeDoors([A], { list: () => new Promise<never>(() => {}) }).doors;
    const { container } = render(within_(doors, <><Probe /><ArtifactList /></>));
    await waitFor(() => expect(storeState()).toBe('loading'));
    expect(container.querySelector('section')).toBeNull();
  });

  it('list: two links of one page are told apart by their short id, on the row and in the Revoke name', async () => {
    const twin1 = rowOf('abcdefgh-one');
    const twin2 = rowOf('ijklmnop-two');
    const { doors, revoke } = fakeDoors([twin1, twin2]);
    render(within_(doors, <ArtifactList scope={{ project: 'demo', section: 'specs', path: 'm.html' }} />));
    const items = await screen.findAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Link abcdefgh');
    expect(items[0]!.textContent).not.toContain('abcdefgh-one');
    expect(items[1]!.textContent).toContain('Link ijklmnop');
    const names = revokeButtons().map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Revoke specs/m.html (abcdefgh)', 'Revoke specs/m.html (ijklmnop)']);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke specs/m.html (ijklmnop)' }));
    await waitFor(() => expect(rowsShown()).toHaveLength(1));
    expect(revoke).toHaveBeenCalledWith('ijklmnop-two');
  });

  it('list: under a minute left says so, and a full minute says 1m', async () => {
    const { doors } = fakeDoors([rowOf('soon0000-S', { expiresAt: NOW + 30_000 }), rowOf('min00000-M', { expiresAt: NOW + 60_000 })]);
    render(within_(doors, <ArtifactList />));
    const items = await screen.findAllByRole('listitem');
    expect(items[0]!.textContent).toContain(ARTIFACT_LIST_TEXT.expiresSoon);
    expect(items[0]!.textContent).not.toContain('0m');
    expect(items[1]!.textContent).toContain('Ends in 1m');
  });

  it('list: the section is named by its heading (aria-labelledby), not by a copy of its text', async () => {
    const { doors } = fakeDoors([A]);
    const { container } = render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    const section = container.querySelector('section')!;
    const heading = screen.getByRole('heading', { name: ARTIFACT_LIST_TEXT.heading });
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
    expect(section.hasAttribute('aria-label')).toBe(false);
    expect(screen.getByRole('region', { name: ARTIFACT_LIST_TEXT.heading })).toBe(section);
  });
});

describe('list: a list left standing is read again', () => {
  it('list: a list that mounts finds the store older than the fresh age and reads again; a younger one is left alone', async () => {
    const { doors, list } = fakeDoors([A]);
    const first = render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    expect(list).toHaveBeenCalledTimes(1);
    first.unmount();
    // Nine seconds on: younger than the fresh age, so a mounting list reads nothing.
    vi.setSystemTime(NOW + ARTIFACT_LIST_FRESH_MS - 1000);
    const second = render(within_(doors, <ArtifactList />));
    await screen.findAllByRole('listitem');
    expect(list).toHaveBeenCalledTimes(1);
    second.unmount();
    // Eleven seconds on: older, so it reads, and the row another tab minted in the meantime appears.
    vi.setSystemTime(NOW + ARTIFACT_LIST_FRESH_MS + 1000);
    const fresh = fakeDoors([A, B]);
    render(within_(fresh.doors, <ArtifactList />));
    await waitFor(() => expect(fresh.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rowsShown()).toHaveLength(2));
  });
});

/** The matchMedia of a phone, so a leaf draws the compact head and its Page details panel. */
function phone(): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || 412 >= Number(min[1])) && (max === null || 412 <= Number(max[1])) && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
function Routed(p: { readonly loaders: DocsLoaders }): ReactNode {
  const { path: at, search } = useLocation();
  return <DocsScreen path={at} search={search} loaders={p.loaders} parser={parser} reader={null} />;
}

describe('list: where it is drawn', () => {
  it('Page details shows the page\'s live row and not another page\'s', async () => {
    phone();
    const { doors } = fakeDoors([rowOf('here0000-H', { path: 'a.md' }), rowOf('there000-T', { path: 'b.md' })]);
    navigate('/docs/demo/specs/a.md');
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md')] })) });
    render(within_(doors, <Routed loaders={f.loaders} />));
    fireEvent.click(await screen.findByRole('button', { name: /^Page details/ }));
    const region = screen.getByRole('region', { name: DOCS_HEAD_TEXT.more });
    await waitFor(() => expect(within(region).queryAllByRole('button', { name: /^Revoke specs\// }).length).toBeGreaterThan(0));
    expect(within(region).getByRole('button', { name: 'Revoke specs/a.md (here0000)' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Revoke specs/b.md (there000)' })).toBeNull();
  });

  it('Page details shows no list when the page has no live row', async () => {
    phone();
    const { doors, list } = fakeDoors([rowOf('there000-T', { path: 'b.md' })]);
    navigate('/docs/demo/specs/a.md');
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md')] })) });
    render(within_(doors, <Routed loaders={f.loaders} />));
    fireEvent.click(await screen.findByRole('button', { name: /^Page details/ }));
    await waitFor(() => expect(list).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    const region = screen.getByRole('region', { name: DOCS_HEAD_TEXT.more });
    expect(within(region).queryByRole('button', { name: /^Revoke/ })).toBeNull();
  });

  it('the Docs index shows the list of every live row, naming each project', async () => {
    const { doors } = fakeDoors([A, C]);
    const row: DocsIndexRow = {
      project: 'demo', state: 'ready', github: { state: 'none' }, default: { name: 'main', via: 'default:origin-head', commit: COMMIT_B },
      sections: { specs: 8, plans: 0, 'product-design': 1, conventions: 2 },
    };
    const answer: DocsProjectsResponse = {
      ok: true, cacheAgeMs: 1,
      index: { v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [], projects: [row] },
    };
    render(within_(doors, <DocsIndexView answer={answer} />));
    const section = await screen.findByRole('region', { name: ARTIFACT_LIST_TEXT.heading });
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByRole('button', { name: 'Revoke plans/p.html in demo-two (cccccccc)' })).toBeInTheDocument();
  });
});
