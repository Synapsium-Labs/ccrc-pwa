// X5 A5.2 (plan 2026-11-19-native-docs-html-artifacts, Task A5.2; spec §3.2 "The scope read, before the mint", §4.1, §4.4, §6.2):
// the launch sheet and its Open link. A fake `ArtifactDoors` answers through `ArtifactDoorsContext`; the sheet is rendered on
// its own for the cases about its own choices, and through the real `MockupView` and `DocsLeaf` for the cases about what the
// leaf hands it (its census, its walls note, its re-list). Placeholders only (`demo`, `.test` hosts).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { DOCS_CLASS_CAP, type DocListPin, type DocPin, type DocsPageLocation, type DocsShowOk } from '../../shared/docs';
import type {
  ArtifactMintAsk, ArtifactMintOk, ArtifactRefusal, ArtifactRevokeOk, ArtifactRow, ArtifactScopeOk,
} from '../../shared/artifacts';
import { ARTIFACT_REFUSAL_TEXT, ARTIFACT_TEXT } from '../src/docs/artifact/artifactWords';
import { ARTIFACT_OPEN_REL, LaunchSheet } from '../src/docs/artifact/LaunchSheet';
import { aboveFolderCount, type ArtifactAnswer, type ArtifactCensusState, type ArtifactDoors } from '../src/docs/artifact/tier';
import { ArtifactDoorsContext, resetArtifactsForTest } from '../src/docs/artifact/useArtifacts';
import { DocsLeaf } from '../src/docs/DocsLeaf';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { MockupView } from '../src/docs/MockupView';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer } from '../src/docs/failures';
import { DOCS_SLOT_SENTENCE, MOCKUP_REFUSAL_SENTENCE, MOCKUP_TEXT, fillSentence, kib } from '../src/docs/docsText';
import { MOCKUP_AUTO_RENDER_BYTES, MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS, MOCKUP_MAX_DEPTH } from '../src/docs/mockup/policy';
import type { MockupAssetReader, MockupContext } from '../src/docs/mockup/ports';
import { buildMockupSrcdoc } from '../src/docs/mockup/load';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import { clearAuthLost } from '../src/lib/auth';
import { parseMarkdown } from '../src/lib/markdownParse';
import { COMMIT_A, COMMIT_B, entry, fakeLoaders, fileResponse, holder, okTree, pageAt, treeOk } from './docsFixtures';

// The real build, wrapped only so a case can make one build too large (as mockup-view's own case does).
vi.mock('../src/docs/mockup/load', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/docs/mockup/load')>();
  return { ...real, buildMockupSrcdoc: vi.fn(real.buildMockupSrcdoc) };
});

beforeEach(() => {
  resetArtifactsForTest();
});
afterEach(() => {
  cleanup();
  clearAuthLost();
  resetArtifactsForTest();
});

const ARTIFACT_HOST = 'art.demo.test:8443';
const CONTENT_HOST = 'content.demo.test:8444';
const SCOPE: ArtifactScopeOk = { ok: true, files: 12, uncommitted: 2, unsized: 0, bytes: 3400, artifactHost: ARTIFACT_HOST, contentHost: CONTENT_HOST };
// A URL no sentence of the console may spell: the case below walks the page for its token.
const MINT_URL = `https://${ARTIFACT_HOST}/a/dG9rZW4tb25seS1pbi10aGUtaHJlZi1vZi10aGUtYW5jaG9y`;
const MINT: ArtifactMintOk = { ok: true, id: 'cap-1', url: MINT_URL, expiresAt: 1, files: 12, uncommitted: 2, unsized: 0 };

const ok = <T,>(value: T): ArtifactAnswer<T> => ({ s: 'ok', value });
const refusedWith = <T,>(word: ArtifactRefusal): ArtifactAnswer<T> => ({ s: 'refused', word });
const liveRow = (id: string): ArtifactRow => ({
  id, project: 'demo', section: 'specs', path: 'other.html', pinLabel: 'main', mintedAt: 1, lastAt: 1, expiresAt: 2, windows: false, origins: [],
});

interface Fake {
  readonly doors: ArtifactDoors;
  readonly scope: Mock<ArtifactDoors['scope']>;
  readonly mint: Mock<ArtifactDoors['mint']>;
  readonly revoke: Mock<ArtifactDoors['revoke']>;
  readonly live: ArtifactRow[];
}
/** Doors whose live list follows the mint and the revoke, and whose scope and mint answers a case may replace. */
function fakeDoors(over: {
  readonly live?: readonly ArtifactRow[];
  readonly scope?: (pin: DocListPin) => ArtifactAnswer<ArtifactScopeOk>;
  readonly mint?: (ask: ArtifactMintAsk) => ArtifactAnswer<ArtifactMintOk> | Promise<ArtifactAnswer<ArtifactMintOk>>;
  /** Replaces the revoke: a failed answer leaves the capability live. */
  readonly revoke?: (id: string) => ArtifactAnswer<ArtifactRevokeOk>;
} = {}): Fake {
  const live = [...(over.live ?? [])];
  const scope = vi.fn<ArtifactDoors['scope']>(async (_project, pin) => (over.scope ?? (() => ok(SCOPE)))(pin));
  const mint = vi.fn<ArtifactDoors['mint']>(async (ask) => {
    const answer = await (over.mint ?? (() => ok(MINT)))(ask);
    if (answer.s === 'ok') live.push(liveRow(answer.value.id));
    return answer;
  });
  const revoke = vi.fn<ArtifactDoors['revoke']>(async (id) => {
    if (over.revoke !== undefined) return over.revoke(id);
    const at = live.findIndex((r) => r.id === id);
    if (at >= 0) live.splice(at, 1);
    return ok<ArtifactRevokeOk>({ ok: true, revoked: at >= 0 ? 1 : 0 });
  });
  const doors: ArtifactDoors = {
    list: async () => ok({ ok: true, available: true, live: [...live] }),
    scope, mint, revoke,
    revokeAll: async () => ok<ArtifactRevokeOk>({ ok: true, revoked: 0 }),
  };
  return { doors, scope, mint, revoke, live };
}

const PIN: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' };
const PIN_B: DocPin = { ...PIN, commit: COMMIT_B };
const NO_CENSUS: ArtifactCensusState = null;

interface SheetOver {
  readonly pin?: DocListPin;
  readonly census?: ArtifactCensusState;
  readonly wallsNote?: string | null;
  readonly retryTree?: () => void;
  readonly onClose?: () => void;
}
function sheetOf(doors: ArtifactDoors, over: SheetOver = {}): ReactNode {
  return (
    <ArtifactDoorsContext value={doors}>
      <LaunchSheet
        project="demo" pin={over.pin ?? PIN} census={over.census === undefined ? NO_CENSUS : over.census}
        wallsNote={over.wallsNote ?? null} retryTree={over.retryTree ?? (() => {})} onClose={over.onClose ?? (() => {})}
      />
    </ArtifactDoorsContext>
  );
}

const whatRuns = (n: number, m: number): string => fillSentence(ARTIFACT_TEXT.whatRuns, { host: ARTIFACT_HOST, n, m });
const dialogOf = (): Promise<HTMLElement> => screen.findByRole('dialog');
const prepareButton = (): HTMLElement => screen.getByRole('button', { name: ARTIFACT_TEXT.prepare });
const checkboxes = (d: HTMLElement): HTMLInputElement[] => within(d).queryAllByRole<HTMLInputElement>('checkbox');
/** The sheet's actions other than Cancel and the sheet's own close mark. */
const actionsOf = (d: HTMLElement): string[] => within(d).queryAllByRole('button')
  .filter((b) => b.textContent !== ARTIFACT_TEXT.cancel && b.getAttribute('aria-label') !== 'Close')
  .map((b) => b.textContent ?? '');

async function opened(node: ReactNode): Promise<HTMLElement> {
  render(node);
  const d = await dialogOf();
  await within(d).findByText(/can read the/);
  return d;
}

describe('the sheet: its choices', () => {
  it('every origin checkbox and the windows checkbox start unticked', async () => {
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors, { census: { origins: ['https://cdn.a.test', 'https://cdn.b.test'], above: 0 } }));
    const boxes = checkboxes(d);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box.checked).toBe(false);
    expect(within(d).getByRole('checkbox', { name: new RegExp(ARTIFACT_TEXT.windows.slice(0, 20)) })).not.toBeChecked();
  });

  it('offers at most 8 origins, none on the console\'s, the artifact\'s or the content host, taken in order after that filter', async () => {
    const f = fakeDoors();
    const own = [`https://${location.hostname}`, 'https://art.demo.test:9000', 'https://content.demo.test'];
    const others = Array.from({ length: 10 }, (_v, i) => `https://h${i}.demo.test`);
    const d = await opened(sheetOf(f.doors, { census: { origins: [...own, ...others], above: 0 } }));
    const offered = checkboxes(d).map((b) => b.closest('label')?.textContent ?? '').filter((t) => t.includes(ARTIFACT_TEXT.originNote));
    expect(offered).toHaveLength(8);
    expect(offered.map((t) => t.split(' ')[0])).toEqual(others.slice(0, 8));
    expect(d.textContent).not.toContain(location.hostname + ' ');
    expect(d.textContent).not.toContain('art.demo.test:9000');
  });

  it('each origin is a label holding its checkbox, the origin and the spec\'s note', async () => {
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors, { census: { origins: ['https://cdn.a.test'], above: 0 } }));
    const label = within(d).getByText(/^https:\/\/cdn\.a\.test/).closest('label');
    expect(label?.className).toBe('docs-artifact-check');
    expect(label?.querySelector('input')?.getAttribute('class')).toBeNull();
    expect(label?.textContent).toContain(ARTIFACT_TEXT.originNote);
  });

  it('shows the scope read\'s host, file count and uncommitted count before Prepare, and its Why line', async () => {
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors, { wallsNote: 'The walls refused this page.' }));
    expect(within(d).getByText(whatRuns(12, 2))).toBeInTheDocument();
    expect(within(d).getByText(ARTIFACT_TEXT.why)).toBeInTheDocument();
    expect(within(d).getByText('The walls refused this page.')).toBeInTheDocument();
    expect(f.mint).not.toHaveBeenCalled();
    expect(f.scope).toHaveBeenCalledTimes(1);
    expect(f.scope.mock.calls[0]![0]).toBe('demo');
    expect(f.scope.mock.calls[0]![1]).toBe(PIN);
  });

  it('says how many files could not be measured only when some could not', async () => {
    const f = fakeDoors({ scope: () => ok({ ...SCOPE, unsized: 3 }) });
    const d = await opened(sheetOf(f.doors));
    expect(within(d).getByText(fillSentence(ARTIFACT_TEXT.unsized, { n: 3 }))).toBeInTheDocument();
    cleanup();
    resetArtifactsForTest();
    const g = fakeDoors();
    const e = await opened(sheetOf(g.doors));
    expect(within(e).queryByText(/could not be measured/)).toBeNull();
  });

  it('shows the Others open line only when a capability other than this sheet\'s own is live', async () => {
    const withOther = fakeDoors({ live: [liveRow('other')] });
    const d = await opened(sheetOf(withOther.doors));
    await within(d).findByText(ARTIFACT_TEXT.othersOpen);
    cleanup();
    resetArtifactsForTest();
    const alone = fakeDoors();
    const e = await opened(sheetOf(alone.doors));
    fireEvent.click(prepareButton());
    await within(e).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    await new Promise((r) => { setTimeout(r, 20); });
    // Its own, just minted and now in the live list, is not "another".
    expect(within(e).queryByText(ARTIFACT_TEXT.othersOpen)).toBeNull();
  });
});

describe('the sheet: the census', () => {
  it('shows the references above the page\'s folder from the census it is handed, and none without a count', async () => {
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors, { census: { origins: [], above: 3 } }));
    expect(within(d).getByText(fillSentence(ARTIFACT_TEXT.above, { n: 3 }))).toBeInTheDocument();
    cleanup();
    resetArtifactsForTest();
    const e = await opened(sheetOf(fakeDoors().doors, { census: { origins: [], above: 0 } }));
    expect(within(e).queryByText(/point above/)).toBeNull();
    expect(within(e).queryByText(ARTIFACT_TEXT.notScanned)).toBeNull();
  });
});

describe('the sheet: Prepare and Open', () => {
  it('Prepare mints with the ticked origins in the census order and the windows choice, then shows one Open link', async () => {
    const f = fakeDoors();
    const census = { origins: ['https://cdn.a.test', 'https://cdn.b.test', 'https://cdn.c.test'], above: 0 };
    const d = await opened(sheetOf(f.doors, { census }));
    const [a, b, c, windows] = checkboxes(d);
    fireEvent.click(c!);
    fireEvent.click(a!);
    fireEvent.click(windows!);
    fireEvent.click(prepareButton());
    const link = await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(f.mint).toHaveBeenCalledTimes(1);
    expect(f.mint.mock.calls[0]![0]).toEqual({ pin: PIN, project: 'demo', origins: ['https://cdn.a.test', 'https://cdn.c.test'], windows: true });
    expect(b!.checked).toBe(false);
    expect(within(d).getAllByRole('link')).toHaveLength(1);
    expect(link.getAttribute('href')).toBe(MINT_URL);
  });

  it('after Prepare the What runs line shows the mint\'s own counts, and the unsized line the mint\'s', async () => {
    const f = fakeDoors({ mint: () => ok({ ...MINT, files: 14, uncommitted: 5, unsized: 2 }) });
    const d = await opened(sheetOf(f.doors));
    fireEvent.click(prepareButton());
    await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(within(d).getByText(whatRuns(14, 5))).toBeInTheDocument();
    expect(within(d).getByText(fillSentence(ARTIFACT_TEXT.unsized, { n: 2 }))).toBeInTheDocument();
    expect(within(d).queryByText(whatRuns(12, 2))).toBeNull();
  });

  it('changing a tick after Prepare revokes the minted capability and hides Open until Prepare again', async () => {
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors, { census: { origins: ['https://cdn.a.test'], above: 0 } }));
    fireEvent.click(prepareButton());
    await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(f.revoke).not.toHaveBeenCalled();
    fireEvent.click(checkboxes(d)[0]!);
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-1'));
    expect(within(d).queryByRole('link')).toBeNull();
    expect(prepareButton()).toBeEnabled();
    fireEvent.click(prepareButton());
    await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(f.mint).toHaveBeenCalledTimes(2);
    // The windows tick revokes as well.
    f.mint.mockClear();
    fireEvent.click(checkboxes(d)[1]!);
    await waitFor(() => expect(f.revoke).toHaveBeenCalledTimes(2));
    expect(within(d).queryByRole('link')).toBeNull();
  });

  it('sheet: the Open anchor\'s rel', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors));
    fireEvent.click(prepareButton());
    const link = await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(ARTIFACT_OPEN_REL).toBe('noopener noreferrer');
    fireEvent.click(link);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    const dir = path.join(import.meta.dirname, '..', 'src', 'docs', 'artifact');
    const files = readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n));
    expect(files).toContain('LaunchSheet.tsx');
    for (const name of files) expect(readFileSync(path.join(dir, name), 'utf8'), name).not.toContain('window.open');
  });

  it('has no Copy link control, and the URL is in the anchor\'s href and nowhere else on the page', async () => {
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors));
    fireEvent.click(prepareButton());
    const link = await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
    expect(screen.queryByText(/copy/i)).toBeNull();
    const token = MINT_URL.slice(MINT_URL.lastIndexOf('/') + 1);
    const holders: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        if ((el.getAttribute(attr) ?? '').includes(token)) holders.push(`${el.tagName.toLowerCase()}[${attr}]`);
      }
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes(token)) holders.push('text');
    }
    expect(holders).toEqual(['a[href]']);
    expect(link.getAttribute('href')).toBe(MINT_URL);
  });

  it('Cancel closes the sheet and never mints', async () => {
    const onClose = vi.fn();
    const f = fakeDoors();
    const d = await opened(sheetOf(f.doors, { onClose }));
    fireEvent.click(within(d).getByRole('button', { name: ARTIFACT_TEXT.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(f.mint).not.toHaveBeenCalled();
  });
});

describe('the sheet: refusals', () => {
  it('a mint refusal shows its sentence and no link, and Prepare stays for another try', async () => {
    const f = fakeDoors({ mint: () => refusedWith('too-many') });
    const d = await opened(sheetOf(f.doors));
    fireEvent.click(prepareButton());
    expect(await within(d).findByText(ARTIFACT_REFUSAL_TEXT['too-many'])).toBeInTheDocument();
    expect(within(d).queryByRole('link')).toBeNull();
    expect(prepareButton()).toBeEnabled();
  });

  it('a scope refusal shows its sentence, no link and no Prepare', async () => {
    const f = fakeDoors({ scope: () => refusedWith('draft-too-large') });
    render(sheetOf(f.doors));
    const d = await dialogOf();
    expect(await within(d).findByText(ARTIFACT_REFUSAL_TEXT['draft-too-large'])).toBeInTheDocument();
    expect(ARTIFACT_REFUSAL_TEXT['draft-too-large']).toBe(
      'This draft is above 4 MiB, so it cannot be pinned for an artifact. Commit it, then open it again.');
    expect(within(d).queryByRole('link')).toBeNull();
    expect(within(d).queryByRole('button', { name: ARTIFACT_TEXT.prepare })).toBeNull();
    expect(within(d).queryByText(/can read the/)).toBeNull();
  });

  it('a docs slot (the sign-in lapsed) shows the docs views\' sentence and no link', async () => {
    const f = fakeDoors({});
    f.scope.mockResolvedValue({ s: 'auth' });
    render(sheetOf(f.doors));
    const d = await dialogOf();
    expect(await within(d).findByText(DOCS_SLOT_SENTENCE.auth)).toBeInTheDocument();
    expect(within(d).queryByRole('link')).toBeNull();
  });

  it('every refusal has a non-empty sentence of its own, and pin-moved\'s is the words constant', () => {
    expect(ARTIFACT_REFUSAL_TEXT['pin-moved']).toBe('This page changed since you opened it.');
    expect(ARTIFACT_TEXT.pinMoved).toBe(ARTIFACT_REFUSAL_TEXT['pin-moved']);
    for (const [word, text] of Object.entries(ARTIFACT_REFUSAL_TEXT)) expect(text.length, word).toBeGreaterThan(10);
  });
});

describe('sheet: pin-moved reloads and opens again', () => {
  it('a scope read answering pin-moved shows the sentence and one action; tapping it re-lists once; a new pin reads the scope again and offers Prepare', async () => {
    const retryTree = vi.fn();
    const f = fakeDoors({ scope: (pin) => (pin === PIN ? refusedWith('pin-moved') : ok(SCOPE)) });
    const { rerender } = render(sheetOf(f.doors, { retryTree }));
    const d = await dialogOf();
    expect(await within(d).findByText(ARTIFACT_TEXT.pinMoved)).toBeInTheDocument();
    expect(actionsOf(d)).toEqual([ARTIFACT_TEXT.reloadOpen]);
    expect(within(d).queryByRole('link')).toBeNull();
    // The sentence names no other remedy.
    expect(d.textContent).not.toMatch(/retry|try again|commit|revoke|refresh/i);
    const reload = within(d).getByRole('button', { name: ARTIFACT_TEXT.reloadOpen });
    fireEvent.click(reload);
    fireEvent.click(reload);
    expect(retryTree).toHaveBeenCalledTimes(1);
    expect(reload).toBeDisabled();
    expect(f.scope).toHaveBeenCalledTimes(1);
    rerender(sheetOf(f.doors, { retryTree, pin: PIN_B }));
    await within(d).findByText(/can read the/);
    expect(f.scope).toHaveBeenCalledTimes(2);
    expect(f.scope.mock.calls[1]![1]).toBe(PIN_B);
    expect(prepareButton()).toBeEnabled();
    expect(within(d).queryByText(ARTIFACT_TEXT.pinMoved)).toBeNull();
    expect(actionsOf(d)).toEqual([ARTIFACT_TEXT.prepare]);
    expect(retryTree).toHaveBeenCalledTimes(1);
  });

  it('a mint answering pin-moved shows the sentence and the same one action', async () => {
    const retryTree = vi.fn();
    const f = fakeDoors({ mint: () => refusedWith('pin-moved') });
    const { rerender } = render(sheetOf(f.doors, { retryTree }));
    const d = await dialogOf();
    await within(d).findByText(/can read the/);
    fireEvent.click(prepareButton());
    expect(await within(d).findByText(ARTIFACT_TEXT.pinMoved)).toBeInTheDocument();
    expect(actionsOf(d)).toEqual([ARTIFACT_TEXT.reloadOpen]);
    expect(within(d).queryByRole('link')).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: ARTIFACT_TEXT.reloadOpen }));
    expect(retryTree).toHaveBeenCalledTimes(1);
    rerender(sheetOf(f.doors, { retryTree, pin: PIN_B }));
    await waitFor(() => expect(f.scope).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(actionsOf(d)).toEqual([ARTIFACT_TEXT.prepare]));
    expect(prepareButton()).toBeEnabled();
  });
});

describe('sheet: pin-moved and the other stops, again and retry', () => {
  it('Reload and open again is re-enabled when the leaf hands a new pin object, even for the same page version', async () => {
    const retryTree = vi.fn();
    const f = fakeDoors({ scope: () => refusedWith('pin-moved') });
    const { rerender } = render(sheetOf(f.doors, { retryTree }));
    const d = await dialogOf();
    await within(d).findByText(ARTIFACT_TEXT.pinMoved);
    const reload = within(d).getByRole('button', { name: ARTIFACT_TEXT.reloadOpen });
    fireEvent.click(reload);
    expect(retryTree).toHaveBeenCalledTimes(1);
    expect(reload).toBeDisabled();
    rerender(sheetOf(f.doors, { retryTree, pin: { ...PIN } }));
    await waitFor(() => expect(within(d).getByRole('button', { name: ARTIFACT_TEXT.reloadOpen })).toBeEnabled());
    fireEvent.click(within(d).getByRole('button', { name: ARTIFACT_TEXT.reloadOpen }));
    expect(retryTree).toHaveBeenCalledTimes(2);
  });

  it('a scope the box could not list (unmeasured) or a docs slot shows a Retry that reads the scope again; pin-moved and the page\'s own refusals show none', async () => {
    let answers = 0;
    const f = fakeDoors({ scope: () => (answers++ === 0 ? refusedWith('unmeasured') : ok(SCOPE)) });
    render(sheetOf(f.doors));
    const d = await dialogOf();
    await within(d).findByText(ARTIFACT_REFUSAL_TEXT.unmeasured);
    expect(actionsOf(d)).toEqual([ARTIFACT_TEXT.retry]);
    fireEvent.click(within(d).getByRole('button', { name: ARTIFACT_TEXT.retry }));
    await within(d).findByText(/can read the/);
    expect(f.scope).toHaveBeenCalledTimes(2);
    expect(prepareButton()).toBeEnabled();
    cleanup();
    resetArtifactsForTest();
    const slot = fakeDoors();
    slot.scope.mockResolvedValueOnce({ s: 'unreachable' });
    render(sheetOf(slot.doors));
    const e = await dialogOf();
    await within(e).findByText(DOCS_SLOT_SENTENCE.unreachable);
    expect(actionsOf(e)).toEqual([ARTIFACT_TEXT.retry]);
    fireEvent.click(within(e).getByRole('button', { name: ARTIFACT_TEXT.retry }));
    await within(e).findByText(/can read the/);
    expect(slot.scope).toHaveBeenCalledTimes(2);
    for (const word of ['pin-moved', 'draft-too-large'] as const) {
      cleanup();
      resetArtifactsForTest();
      render(sheetOf(fakeDoors({ scope: () => refusedWith(word) }).doors));
      const g = await dialogOf();
      await within(g).findByText(ARTIFACT_REFUSAL_TEXT[word]);
      expect(within(g).queryByRole('button', { name: ARTIFACT_TEXT.retry }), word).toBeNull();
    }
  });

  it('says nothing of a remedy beside pin-moved\'s one action in the words file\'s comments either', () => {
    const words = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'artifact', 'artifactWords.ts'), 'utf8');
    expect(words).not.toMatch(/names no remedy beside pin-moved/);
  });
});

describe('sheet: the pre-scan is pending', () => {
  it('shows the reading line and holds Prepare while the census is pending, then offers the origins', async () => {
    const f = fakeDoors();
    const { rerender } = render(sheetOf(f.doors, { census: 'pending' }));
    const d = await dialogOf();
    await within(d).findByText(/can read the/);
    expect(within(d).getByText(ARTIFACT_TEXT.reading)).toBeInTheDocument();
    expect(prepareButton()).toBeDisabled();
    expect(within(d).queryByText(ARTIFACT_TEXT.notScanned)).toBeNull();
    expect(checkboxes(d)).toHaveLength(1);
    rerender(sheetOf(f.doors, { census: { origins: ['https://cdn.a.test'], above: 1 } }));
    await waitFor(() => expect(prepareButton()).toBeEnabled());
    expect(within(d).queryByText(ARTIFACT_TEXT.reading)).toBeNull();
    expect(checkboxes(d)).toHaveLength(2);
    expect(within(d).getByText(fillSentence(ARTIFACT_TEXT.above, { n: 1 }))).toBeInTheDocument();
  });
});

describe('sheet: what the sheet holds, and when it lets go', () => {
  const census = { origins: ['https://cdn.a.test', 'https://cdn.b.test'], above: 0 };
  async function prepared(f: Fake, over: SheetOver = {}) {
    const view = render(sheetOf(f.doors, { census, ...over }));
    const d = await dialogOf();
    await within(d).findByText(/can read the/);
    fireEvent.click(checkboxes(d)[0]!);
    fireEvent.click(prepareButton());
    const link = await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    return { ...view, d, link };
  }

  it('I1: a stale mint answer revokes its own id and never touches the capability the sheet holds', async () => {
    const waiting: ((a: ArtifactAnswer<ArtifactMintOk>) => void)[] = [];
    const f = fakeDoors({ mint: () => new Promise((resolve) => { waiting.push(resolve); }) });
    const { rerender } = render(sheetOf(f.doors, { census }));
    const d = await dialogOf();
    await within(d).findByText(/can read the/);
    fireEvent.click(prepareButton());
    await waitFor(() => expect(waiting).toHaveLength(1));
    rerender(sheetOf(f.doors, { census, pin: PIN_B }));
    await waitFor(() => expect(f.scope).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(prepareButton()).toBeEnabled());
    fireEvent.click(prepareButton());
    await waitFor(() => expect(waiting).toHaveLength(2));
    const second = `https://${ARTIFACT_HOST}/a/second`;
    await act(async () => { waiting[1]!(ok({ ...MINT, id: 'cap-2', url: second })); });
    const link = await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(link.getAttribute('href')).toBe(second);
    await act(async () => { waiting[0]!(ok({ ...MINT, id: 'cap-1', url: `https://${ARTIFACT_HOST}/a/first` })); });
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-1'));
    expect(f.revoke).not.toHaveBeenCalledWith('cap-2');
    expect(within(d).getByRole('link', { name: ARTIFACT_TEXT.openLink }).getAttribute('href')).toBe(second);
    fireEvent.click(checkboxes(d)[0]!);
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-2'));
    expect(within(d).queryByRole('link')).toBeNull();
  });

  it('I2-unmount: a held capability whose Open was never tapped is revoked when the sheet unmounts, and so is a mint that answers late', async () => {
    const f = fakeDoors();
    const p = await prepared(f);
    p.unmount();
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-1'));
    cleanup();
    resetArtifactsForTest();
    const waiting: ((a: ArtifactAnswer<ArtifactMintOk>) => void)[] = [];
    const g = fakeDoors({ mint: () => new Promise((resolve) => { waiting.push(resolve); }) });
    const view = render(sheetOf(g.doors, { census }));
    const d = await dialogOf();
    await within(d).findByText(/can read the/);
    fireEvent.click(prepareButton());
    await waitFor(() => expect(waiting).toHaveLength(1));
    view.unmount();
    await act(async () => { waiting[0]!(ok(MINT)); });
    await waitFor(() => expect(g.revoke).toHaveBeenCalledWith('cap-1'));
  });

  it('I2-opened: once Open was tapped, the capability lives on: an unmount or a pin change revokes nothing, and the list\'s Revoke ends it', async () => {
    const f = fakeDoors();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const p = await prepared(f);
    fireEvent.click(p.link);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    p.rerender(sheetOf(f.doors, { census, pin: PIN_B }));
    await waitFor(() => expect(f.scope).toHaveBeenCalledTimes(2));
    await within(p.d).findByText(/can read the/);
    expect(within(p.d).queryByRole('link')).toBeNull();
    expect(prepareButton()).toBeEnabled();
    p.unmount();
    await new Promise((r) => { setTimeout(r, 20); });
    expect(f.revoke).not.toHaveBeenCalled();
    expect(f.live.map((r) => r.id)).toEqual(['cap-1']);
  });

  it('I2-pin: a held capability never opened is revoked when the pin changes, and Open is gone', async () => {
    const f = fakeDoors();
    const p = await prepared(f);
    p.rerender(sheetOf(f.doors, { census, pin: PIN_B }));
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-1'));
    await within(p.d).findByText(/can read the/);
    expect(within(p.d).queryByRole('link')).toBeNull();
  });

  it('I2-tick: a tick changed after Open was tapped hides Open and needs Prepare again, and revokes nothing', async () => {
    const f = fakeDoors();
    const p = await prepared(f);
    fireEvent.click(p.link);
    fireEvent.click(checkboxes(p.d)[1]!);
    await waitFor(() => expect(within(p.d).queryByRole('link')).toBeNull());
    expect(prepareButton()).toBeEnabled();
    expect(f.revoke).not.toHaveBeenCalled();
  });

  it.each([
    ['null (not scanned)', null],
    ['pending', 'pending' as const],
    ['a census that no longer names the origin', { origins: ['https://cdn.b.test'], above: 0 }],
  ])('I3: a census that becomes %s drops the capability minted with an origin that left, as a tick change', async (_name, next) => {
    const f = fakeDoors();
    const p = await prepared(f);
    p.rerender(sheetOf(f.doors, { census: next }));
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-1'));
    expect(within(p.d).queryByRole('link')).toBeNull();
    expect(within(p.d).queryByRole('button', { name: ARTIFACT_TEXT.prepare })).not.toBeNull();
  });

  it('I3: a census that changes while every minted origin stays offered keeps the link', async () => {
    const f = fakeDoors();
    const p = await prepared(f);
    p.rerender(sheetOf(f.doors, { census: { origins: ['https://cdn.a.test'], above: 4 } }));
    await within(p.d).findByText(fillSentence(ARTIFACT_TEXT.above, { n: 4 }));
    expect(within(p.d).getByRole('link', { name: ARTIFACT_TEXT.openLink })).toBeInTheDocument();
    expect(f.revoke).not.toHaveBeenCalled();
  });

  it('I3: a revoke that failed leaves the capability live, so the Others open line shows it after the list is read again', async () => {
    const f = fakeDoors({ revoke: () => ({ s: 'unreachable' }) });
    const p = await prepared(f);
    expect(within(p.d).queryByText(ARTIFACT_TEXT.othersOpen)).toBeNull();
    fireEvent.click(checkboxes(p.d)[1]!);
    await waitFor(() => expect(f.revoke).toHaveBeenCalledWith('cap-1'));
    await within(p.d).findByText(ARTIFACT_TEXT.othersOpen);
    expect(f.live.map((r) => r.id)).toEqual(['cap-1']);
  });
});

// ---- Through the real views ------------------------------------------------------------------------------------------

const enc = new TextEncoder();
const PAGE: DocsPageLocation & { kind: 'path' } = {
  kind: 'path', project: 'demo', section: 'specs', path: 'm.html', dirSlash: false, ref: null, at: null, view: 'effective', frame: 'inline',
};
function showOf(text: string, size: number = enc.encode(text).byteLength): DocsShowOk {
  return {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 1, source: 'committed', section: 'specs', path: 'm.html', size,
    sha256: 'c'.repeat(64), encoding: 'utf8', text, commit: COMMIT_A,
  };
}
const contextAt = (pagePath: string): MockupContext => ({
  project: 'demo',
  pin: { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: pagePath } satisfies DocPin,
  tree: treeOk({ entries: [entry('specs', pagePath)], drafts: holder() }),
});
const READER: MockupAssetReader = { read: async () => ({ kind: 'ok', bytes: new Uint8Array([1, 2, 3]) }) };
const ASSETS: DocsAssetContextValue = { loaders: fakeLoaders().loaders, queue: createFetchQueue(), onDraftAsset: () => {} };

function mockupOf(p: {
  readonly html: string; readonly doors: ArtifactDoors; readonly size?: number; readonly pagePath?: string; readonly relist?: () => void; readonly key?: string;
}): ReactNode {
  const pagePath = p.pagePath ?? 'm.html';
  return (
    <ArtifactDoorsContext value={p.doors}>
      <DocsAssetContext value={ASSETS}>
        <MockupView
          key={p.key ?? 'one'} show={showOf(p.html, p.size)} context={contextAt(pagePath)} reader={READER} page={{ ...PAGE, path: pagePath }}
          relist={p.relist ?? (() => {})} download={<button type="button">Download</button>}
        />
      </DocsAssetContext>
    </ArtifactDoorsContext>
  );
}
const tapOffer = async (): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole('button', { name: ARTIFACT_TEXT.open }));
  const d = await dialogOf();
  await within(d).findByText(/can read the/);
  return d;
};

describe('sheet: counts references above the page\'s folder', () => {
  const html = [
    '<img src="../shared/a.png">', '<img src="own.png">', '<img src="sub/own.png">', '<img src="../../../logo.png">',
    '<img src="https://cdn.demo.test/x.png">', '<img src="#frag">',
  ].join('');

  it('the census over the page\'s own rows counts the references above its folder', () => {
    // Two of the four relative references leave `pages/`: one into the section above, one to a repo path outside the docs.
    const pageRow = (raw: string) => (
      { ref: { key: raw, raw, basePath: 'specs/pages/m.html', kind: 'img', depth: 0 }, verdict: { v: 'missing' }, size: null }
    ) as unknown as Parameters<typeof aboveFolderCount>[0][number];
    expect(aboveFolderCount(['../shared/a.png', 'own.png', 'sub/own.png', '../../../logo.png'].map(pageRow), { section: 'specs', path: 'pages/m.html' })).toBe(2);
  });

  it('the sheet opened from the walls view shows that count and the page\'s outside origin', async () => {
    const f = fakeDoors();
    const { container } = render(mockupOf({ html, doors: f.doors, pagePath: 'pages/m.html' }));
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const d = await tapOffer();
    expect(within(d).getByText(fillSentence(ARTIFACT_TEXT.above, { n: 2 }))).toBeInTheDocument();
    expect(checkboxes(d).map((b) => b.closest('label')?.textContent ?? '').filter((t) => t.includes(ARTIFACT_TEXT.originNote)))
      .toEqual([`https://cdn.demo.test ${'—'} ${ARTIFACT_TEXT.originNote}`]);
    expect(within(d).queryByText(ARTIFACT_TEXT.notScanned)).toBeNull();
  });

  it('a sheet opened beside the over-budget answer repeats that sentence under the Why line (the same value, computed once)', async () => {
    const f = fakeDoors();
    const MIB = 1048576;
    const sizes: Record<string, number> = { 'a.json': 2 * MIB, 'b.json': 2 * MIB, 'c.json': MIB + 1 };
    const html = "<!doctype html><html><head><script>fetch('a.json');fetch('b.json');fetch('c.json');</script></head><body></body></html>";
    const context: MockupContext = {
      ...contextAt('m.html'),
      tree: treeOk({
        entries: [entry('specs', 'm.html'), ...Object.keys(sizes).map((p) => entry('specs', p, { committed: { kind: 'file', blob: '1'.repeat(40), size: sizes[p]! } }))],
        drafts: holder(),
      }),
    };
    const { container } = render(
      <ArtifactDoorsContext value={f.doors}>
        <DocsAssetContext value={ASSETS}>
          <MockupView show={showOf(html)} context={context} reader={READER} page={PAGE} relist={() => {}} download={<button type="button">Download</button>} />
        </DocsAssetContext>
      </ArtifactDoorsContext>,
    );
    fireEvent.click(await screen.findByRole('button', { name: MOCKUP_TEXT.runScripts }));
    const sentence = fillSentence(MOCKUP_TEXT.overBudget, { n: MOCKUP_MAX_ASSETS, size: kib(MOCKUP_MAX_ASSET_BYTES) });
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    const d = await tapOffer();
    expect(within(d).getByText(sentence)).toBeInTheDocument();
  });
});

describe('sheet: what the walls view hands it before and after its load', () => {
  it('M1: before the view\'s load has answered the census is pending (the reading line, Prepare held), never "not scanned"', async () => {
    const f = fakeDoors();
    const stuck: MockupAssetReader = { read: () => new Promise(() => undefined) };
    const context: MockupContext = {
      ...contextAt('m.html'),
      tree: treeOk({ entries: [entry('specs', 'm.html'), entry('specs', 'a.png')], drafts: holder() }),
    };
    const { container } = render(
      <ArtifactDoorsContext value={f.doors}>
        <DocsAssetContext value={ASSETS}>
          <MockupView
            show={showOf('<img src="a.png">')} context={context} reader={stuck} page={PAGE} relist={() => {}}
            download={<button type="button">Download</button>}
          />
        </DocsAssetContext>
      </ArtifactDoorsContext>,
    );
    const d = await tapOffer();
    expect(container.querySelector('iframe')).toBeNull();
    expect(within(d).getByText(ARTIFACT_TEXT.reading)).toBeInTheDocument();
    expect(within(d).queryByText(ARTIFACT_TEXT.notScanned)).toBeNull();
    expect(prepareButton()).toBeDisabled();
  });

  it('M4: a build over the size cap is the walls note the sheet repeats', async () => {
    const f = fakeDoors();
    const real = await vi.importActual<typeof import('../src/docs/mockup/load')>('../src/docs/mockup/load');
    vi.mocked(buildMockupSrcdoc).mockImplementationOnce((doc, assets, extra, scripted) => {
      const built = real.buildMockupSrcdoc(doc, assets, extra, scripted);
      return { ok: false, why: 'too-large', chars: 9, cap: 8, plan: built.plan };
    });
    render(mockupOf({ html: '<img src="a.png">', doors: f.doors }));
    expect(await screen.findByText(MOCKUP_TEXT.tooLarge)).toBeInTheDocument();
    const d = await tapOffer();
    expect(within(d).getByText(MOCKUP_TEXT.tooLarge)).toBeInTheDocument();
  });
});

describe('sheet: an unscanned page', () => {
  const parser = async (src: string) => parseMarkdown(src, 'docs');
  const leafPage = (): DocsPageLocation & { kind: 'path' } => {
    const located = pageAt('/docs/demo/specs/m.html');
    if (located.kind !== 'path') throw new Error('fixture: not a leaf');
    return located;
  };
  async function expectUnscanned(f: Fake, d: HTMLElement): Promise<void> {
    expect(within(d).getByText(ARTIFACT_TEXT.notScanned)).toBeInTheDocument();
    expect(within(d).queryByText(/point above/)).toBeNull();
    expect(checkboxes(d)).toHaveLength(1);
    expect(within(d).getByRole('checkbox', { name: new RegExp(ARTIFACT_TEXT.windows.slice(0, 20)) })).toBeInTheDocument();
    fireEvent.click(prepareButton());
    await within(d).findByRole('link', { name: ARTIFACT_TEXT.openLink });
    expect(f.mint).toHaveBeenCalledTimes(1);
    expect(f.mint.mock.calls[0]![0]).toMatchObject({ origins: [], windows: false });
  }

  it('opened from the too-large view', async () => {
    const f = fakeDoors();
    const size = DOCS_CLASS_CAP.html + 1;
    const fl = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'm.html', { committed: { kind: 'file', blob: '1'.repeat(40), size } })] })) });
    const located = leafPage();
    function Harness(): ReactNode {
      const visit = useDocsVisit(located, fl.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return (
        <DocsLeaf
          visit={visit} tree={visit.tree.answer.tree} page={located} parser={parser}
          rangeLoader={{ prepare: () => new Promise(() => undefined), frame: () => new Promise(() => undefined) }}
        />
      );
    }
    render(<ArtifactDoorsContext value={f.doors}><DocsAssetContext value={ASSETS}><Harness /></DocsAssetContext></ArtifactDoorsContext>);
    const d = await tapOffer();
    await expectUnscanned(f, d);
  });

  it('opened from the stand-in with no asset reader', async () => {
    const f = fakeDoors();
    const r = fileResponse('<p>mock</p>');
    const file: DocsFileAnswer = { s: 'ok', value: { ...r, contentClass: 'html', show: { ...r.show, path: 'm.html', size: 11 } } };
    const fl = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'm.html')] })), file });
    const located = leafPage();
    function Harness(): ReactNode {
      const visit = useDocsVisit(located, fl.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={located} parser={parser} />;
    }
    render(<ArtifactDoorsContext value={f.doors}><Harness /></ArtifactDoorsContext>);
    const d = await tapOffer();
    await expectUnscanned(f, d);
  });

  it('opened from the gated view, before Render', async () => {
    const f = fakeDoors();
    const { container } = render(mockupOf({ html: '<p>a</p>', size: MOCKUP_AUTO_RENDER_BYTES + 1, doors: f.doors }));
    const d = await tapOffer();
    expect(container.querySelector('.docs-mockup')?.getAttribute('data-state')).toBe('gated');
    await expectUnscanned(f, d);
  });

  it('opened from a pre-scan refusal, with its refusal line as the walls note', async () => {
    const f = fakeDoors();
    const { container } = render(mockupOf({ html: '<div>'.repeat(MOCKUP_MAX_DEPTH + 1), doors: f.doors }));
    const d = await tapOffer();
    expect(container.querySelector('.docs-mockup')?.getAttribute('data-state')).toBe('refused');
    expect(within(d).getByText(fillSentence(MOCKUP_TEXT.refusal, { reason: MOCKUP_REFUSAL_SENTENCE['too-deep'] }))).toBeInTheDocument();
    await expectUnscanned(f, d);
  });
});

describe('the sheet and the leaf\'s remount', () => {
  it('stays open when the walls view is remounted, and reads the scope again for the view it now holds', async () => {
    const f = fakeDoors();
    const { container, rerender } = render(mockupOf({ html: '<p>hi</p>', doors: f.doors, key: 'fp-1' }));
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const first = await tapOffer();
    expect(f.scope).toHaveBeenCalledTimes(1);
    act(() => { rerender(mockupOf({ html: '<p>hi</p>', doors: f.doors, key: 'fp-2' })); });
    const again = await dialogOf();
    await within(again).findByText(/can read the/);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(f.scope.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(again.isConnected).toBe(true);
    expect(first.isConnected).toBe(false);
  });

  it('retryTree is the visit\'s re-list: the sheet\'s Reload and open again calls the view\'s relist once', async () => {
    const relist = vi.fn();
    const f = fakeDoors({ scope: () => refusedWith('pin-moved') });
    const { container } = render(mockupOf({ html: '<p>hi</p>', doors: f.doors, relist }));
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: ARTIFACT_TEXT.open }));
    const d = await dialogOf();
    await within(d).findByText(ARTIFACT_TEXT.pinMoved);
    const before = relist.mock.calls.length;
    fireEvent.click(within(d).getByRole('button', { name: ARTIFACT_TEXT.reloadOpen }));
    expect(relist.mock.calls.length - before).toBe(1);
  });
});
