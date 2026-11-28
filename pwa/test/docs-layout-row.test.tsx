// The Layout row in Page details and reader mode's layout rule on the Docs head (native Docs parity, X2 P5.1, spec 2026-11-18 4.2;
// reader-mode plan rows X6.70 and the Layout row's cases). The head is drawn over the REAL reader-mode hook, handed a stand-in frame
// that says which layout it carries, so what the head draws is `readerModeDrawn`'s and `readerModeLayoutNote`'s answer, not a stand-in
// context's. `READER_LAYOUT_RULE` is one constant, shipped as `default-only` (the coordinator's ruling of 2026-11-28), and every case here
// reads it through a holder that every case leaves at `remount`, so every case runs under `remount` unless it sets the holder to
// `default-only` itself (the hook reads the constant through the module, and the mock hands it the holder's value).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocsBanners } from '../src/docs/DocsBanners';
import { DocsHead } from '../src/docs/DocsHead';
import { DocsScreen } from '../src/screens/DocsScreen';
import { ReaderFrame, type ReaderDeps } from '../src/docs/ReaderFrame';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { DOCS_BANNER_TEXT, DOCS_HEAD_TEXT } from '../src/docs/docsText';
import { createReaderProgress, type ReaderBar } from '../src/docs/readerBar';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import { chooseReaderLayout, onReaderLayout, resetReaderLayoutChoiceForTests } from '../src/docs/reader/layoutPref';
import { READER_LAYOUTS, type ReaderLayout } from '../src/docs/reader/policy';
import { READER_LAYOUT_TEXT, READER_MODE_TEXT, readerLayoutCommandTitle } from '../src/docs/reader/readerModeWords';
import { baseCommands } from '../src/command/commands';
import { available, type CommandContext } from '../src/command/registry';
import { readerLayoutHandle } from '../src/docs/readerLayoutHandle';
import { NO_READER_PLACES, ReaderModeContext, useReaderMode, type ReaderModeContextValue, type ReaderModeFrame } from '../src/docs/useReaderMode';
import type { DocsVisit } from '../src/docs/useDocsVisit';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { navigate } from '../src/lib/router';
import {
  COMMIT_B, NO_RANGE_VISIT, draftOf, entry, fakeLoaders, fileResponse, holder, okFile, okTree, pageAt, treeOk, treeResponse,
} from './docsFixtures';

vi.mock('../src/lib/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/router')>()),
  navigate: vi.fn(),
  replaceFragment: vi.fn(),
}));

const layoutRule = vi.hoisted(() => ({ value: 'remount' as 'remount' | 'default-only' }));
vi.mock('../src/docs/reader/readerMode', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/docs/reader/readerMode')>();
  return { ...orig, get READER_LAYOUT_RULE() { return layoutRule.value; } };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resetReaderLayoutChoiceForTests();
  window.history.replaceState(null, '', '/');
  layoutRule.value = 'remount';
});

/** matchMedia at `width`: a min-width or max-width query answered as an engine at that width answers it. */
function atWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = q === '(pointer: coarse)' ? false
      : (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

function fakeFrame(layout: ReaderLayout, ready = true): ReaderModeFrame {
  return {
    ready, layout, planned: 'off', focus: vi.fn(), setReading: vi.fn(), command: vi.fn(), title: 'a.md', progress: createReaderProgress(),
  };
}

const URL_A = '/docs/demo/specs/a.md';
function leafVisit(tree: ReturnType<typeof treeOk>): DocsVisit {
  return {
    tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
    file: { s: 'loading', pin: { kind: 'committed', commit: COMMIT_B, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' } },
    freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
    ...NO_RANGE_VISIT, retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
  };
}

/** The head over the real hook, with `frame` published as the body would publish it (`null`: no frame stands). `oneBar`: the head is
 *  drawn on ccrc's bar (a host-bar mount). */
function Harness(p: {
  readonly frame: ReaderModeFrame | null; readonly url?: string; readonly oneBar?: true;
  /** Hands the hook's context out (to enter reader mode from a case). */
  readonly onValue?: (v: ReaderModeContextValue) => void;
}): ReactNode {
  const { value, container } = useReaderMode({ doc: 'doc-a', plainView: false, places: NO_READER_PLACES });
  p.onValue?.(value);
  const setFrame = value.setFrame;
  const { frame } = p;
  useEffect(() => { setFrame(frame); }, [setFrame, frame]);
  const tree = treeOk({ entries: [entry('specs', 'a.md')] });
  const bar: ReaderBar = { title: 'Doc title', command: vi.fn(), progress: createReaderProgress() };
  return (
    <ReaderModeContext value={value}>
      {/* The reading container reader mode is entered over (a case that enters needs one). */}
      <div ref={(el) => { container.setContainer(el); }} />
      <DocsHead page={pageAt(p.url ?? URL_A)} visit={leafVisit(tree)} tree={tree} {...(p.oneBar === true ? { readerBar: bar } : {})} />
    </ReaderModeContext>
  );
}

/** The palette's context on a Docs page, open. */
const paletteCtx: CommandContext = {
  path: '/docs/demo/specs/a.md', sessions: [], runs: [], navigate: () => {}, setSkin: () => {}, setTheme: () => {}, setCharacter: () => {},
  openShortcuts: () => {}, openNewSession: () => {}, openPalette: () => {}, paletteOpen: true, session: null, inspector: null,
  home: { place: 'fleet', why: 'not-advertised' }, overlordShown: false,
};

/** A reader frame body beside the head, over a fake `ReaderMount` whose `remount` is a spy (one per mount, in `remounts`): what a
 *  Layout choice does to the frame is the body's own. It stands outside the reader-mode context (reads as reader mode off), so the head
 *  keeps the stand-in frame it is given. */
const PROBE_LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, pageAt: null, pageVariant: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => undefined,
};
function RemountProbe(p: { readonly remounts: Array<ReturnType<typeof vi.fn>> }): ReactNode {
  const [reader] = useState<ReaderDeps>(() => ({
    render: async () => RENDERED,
    images: async () => ({ urls: {}, drafts: 0, auth: 0 }),
    mount: async () => {
      const remount = vi.fn();
      p.remounts.push(remount);
      return { seed: { hosted: false }, follow: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn(), command: vi.fn(), layout: 'default', remount } as unknown as ReaderMount;
    },
  }));
  return (
    <ReaderFrame
      show={fileResponse('# A').show} bodyKey="probe" link={PROBE_LINK} parser={parser} reader={reader}
      pendingFragment={null} onFragmentConsumed={() => undefined}
    />
  );
}

const readerAction = (): HTMLElement | null => screen.queryByRole('button', { name: READER_MODE_TEXT.enter, hidden: true });
const layoutSelect = (): HTMLSelectElement | null => screen.queryByRole('combobox', { name: READER_LAYOUT_TEXT.label, hidden: true });

describe('the Docs head and the layout rule (X2 P5.1)', () => {
  it('desk head and one bar: under default-only, outside the default layout, no Reader mode action is drawn, and Page details shows the note beside the Layout row', () => {
    // X6.70: a head that draws the action outside the default layout under `default-only` reds here.
    layoutRule.value = 'default-only';
    for (const form of ['desk', 'one bar', 'compact'] as const) {
      atWidth(form === 'desk' ? 1280 : 412);
      const mountIt = (layout: ReaderLayout): ReturnType<typeof render> => render(
        <Harness frame={fakeFrame(layout)} {...(form === 'one bar' ? { oneBar: true as const } : {})} />,
      );
      // Outside the default layout: the action is not drawn, in the row, on the bar, or in the compact row.
      mountIt('review');
      expect(readerAction(), `${form}: Reader mode drawn in review under default-only`).toBeNull();
      if (form === 'desk') {
        // D-9180: the desk's row has no Layout control; the note is its own line under the head's row, where the Print note sits,
        // in the desk's words (the palette is where the layout is chosen).
        expect(layoutSelect(), 'desk: a Layout control in the head').toBeNull();
        const deskNote = screen.getByText(READER_LAYOUT_TEXT.deskNote, { selector: 'p', exact: true });
        expect(deskNote.closest('.docs-actions'), 'desk: the note is inside the actions row').toBeNull();
        expect(deskNote.parentElement?.classList.contains('docs-head'), 'desk: the note is a line of the head').toBe(true);
        expect(screen.queryByText(READER_LAYOUT_TEXT.note), 'desk: Page details\' words on the desk').toBeNull();
      } else {
        // Page details (the panel the bar and the compact row open) holds the Layout row and the note beside it, tied to the select.
        const select = layoutSelect();
        expect(select, `${form}: the Layout row`).not.toBeNull();
        expect(select!.value).toBe('review');
        const note = screen.getByText(READER_LAYOUT_TEXT.note, { selector: 'p', exact: true });
        expect(note.closest('.docs-layout-row')?.contains(select!), `${form}: the note is beside the row`).toBe(true);
        expect(select!.getAttribute('aria-describedby')).toBe(note.id);
        expect(screen.queryByText(READER_LAYOUT_TEXT.deskNote), `${form}: the desk's words in Page details`).toBeNull();
      }
      cleanup();
      // In the default layout the action is drawn and the note is not.
      mountIt('default');
      expect(readerAction(), `${form}: Reader mode in the default layout`).not.toBeNull();
      expect(screen.queryByText(READER_LAYOUT_TEXT.note), `${form}: a note in the default layout`).toBeNull();
      expect(screen.queryByText(READER_LAYOUT_TEXT.deskNote), `${form}: a desk note in the default layout`).toBeNull();
      cleanup();
      // Under `remount` it is drawn in every layout, and says nothing.
      layoutRule.value = 'remount';
      mountIt('review');
      expect(readerAction(), `${form}: Reader mode in review under remount`).not.toBeNull();
      expect(screen.queryByText(READER_LAYOUT_TEXT.note)).toBeNull();
      expect(screen.queryByText(READER_LAYOUT_TEXT.deskNote)).toBeNull();
      cleanup();
      layoutRule.value = 'default-only';
    }
  });

  it('page details: the Layout row lists five layouts and a choice remounts the frame in it', async () => {
    atWidth(412);
    const remounts: Array<ReturnType<typeof vi.fn>> = [];
    render(<><Harness frame={fakeFrame('classic')} /><RemountProbe remounts={remounts} /></>);
    await waitFor(() => { expect(remounts).toHaveLength(1); });
    const select = layoutSelect();
    expect(select, 'the Layout row is drawn in Page details over a ready reader frame').not.toBeNull();
    expect(select!.tagName).toBe('SELECT');
    // Five layouts, `default` first, each worded; the value is the layout the live mount carries.
    expect([...select!.options].map((o) => [o.value, o.textContent])).toEqual([
      ['default', 'Default'], ['classic', 'Classic'], ['editorial', 'Editorial'], ['review', 'Review'], ['guided', 'Guided'],
    ]);
    expect(select!.value).toBe('classic');
    expect(within(select!.closest('.docs-layout-row') as HTMLElement).getByText(READER_LAYOUT_TEXT.label)).toBeInTheDocument();
    // A choice is the device's: stored in the prefs, and handed to whoever mounts the frame (the body's listener), in the same task.
    const heard: string[] = [];
    const stop = onReaderLayout((l) => { heard.push(`${l} stored ${window.localStorage.getItem('ccrc:reader:v1:pref:prefs')}`); });
    act(() => { fireEvent.change(select!, { target: { value: 'guided' } }); });
    expect(heard).toEqual(['guided stored {"layout":"guided"}']);
    stop();
    // The frame is mounted again in it: the body's mount is asked for the chosen layout (the frame's own remount, not a stand-in's word).
    expect(remounts[0], 'the choice did not reach the frame\'s mount').toHaveBeenCalledTimes(1);
    expect(remounts[0]).toHaveBeenCalledWith(expect.objectContaining({ layout: 'guided' }));
    // The same layout chosen again keeps the stored prefs exactly as they were.
    const before = window.localStorage.getItem('ccrc:reader:v1:pref:prefs');
    act(() => { chooseReaderLayout('guided'); });
    expect(window.localStorage.getItem('ccrc:reader:v1:pref:prefs')).toBe(before);
  });

  it('palette: a pick updates the Layout select\'s shown value at once, so an open Page details never shows the old layout', () => {
    // m-9: the row hears the choice itself (`onReaderLayout`), not only through its own select, so a palette pick made while Page details
    // is open (or before it is) shows the layout chosen, not the one the frame still carries while it loads.
    atWidth(412);
    render(<Harness frame={fakeFrame('classic')} />);
    expect(layoutSelect()!.value, 'CONTROL: the frame\'s layout').toBe('classic');
    const row = baseCommands().find((c) => c.title === readerLayoutCommandTitle('guided'))!;
    act(() => { row.run(paletteCtx); });
    expect(layoutSelect()!.value, 'the select kept showing the old layout after a palette pick').toBe('guided');
    // A choice made through the module (any other door) is heard the same way.
    act(() => { chooseReaderLayout('editorial'); });
    expect(layoutSelect()!.value).toBe('editorial');
  });

  it('page details: no Layout row without a ready reader frame, and none on a listing', () => {
    for (const width of [412, 1280]) {
      atWidth(width);
      // No frame stands.
      render(<Harness frame={null} />);
      expect(layoutSelect(), `${width}: a Layout row with no frame`).toBeNull();
      cleanup();
      // A frame still loading.
      render(<Harness frame={fakeFrame('default', false)} />);
      expect(layoutSelect(), `${width}: a Layout row over a frame that is not ready`).toBeNull();
      cleanup();
      // A listing draws no leaf actions at all.
      render(<Harness frame={fakeFrame('default')} url="/docs/demo/specs" />);
      expect(layoutSelect(), `${width}: a Layout row on a listing`).toBeNull();
      cleanup();
    }
    expect(DOCS_HEAD_TEXT.back).toBeTruthy();
  });

  it('desk head: no Layout control in the actions row (D-9180)', () => {
    // The desk's row is crowded at its widths: the layout is chosen from the command palette on every width, and Page details keeps
    // the row. Over a ready frame in every layout the desk head draws no combobox and no Layout row anywhere.
    atWidth(1280);
    for (const layout of READER_LAYOUTS) {
      render(<Harness frame={fakeFrame(layout)} />);
      expect(layoutSelect(), `${layout}: a Layout select in the desk head`).toBeNull();
      expect(document.querySelector('.docs-layout-row'), `${layout}: a Layout row in the desk head`).toBeNull();
      expect(document.querySelector('.docs-actions')?.textContent ?? '', `${layout}: the word Layout in the actions row`).not.toContain(READER_LAYOUT_TEXT.label);
      cleanup();
    }
    // CONTROL: Page details (the phone) still draws it over the same frame.
    atWidth(412);
    render(<Harness frame={fakeFrame('editorial')} />);
    expect(layoutSelect(), 'CONTROL: Page details has the Layout select').not.toBeNull();
  });

  it('desk head: the desk note is drawn under the head row by one rule, and says what the palette does', () => {
    // One rule for when the note shows (`layoutNote`, the same as Page details'): under `default-only`, outside the default layout,
    // over a ready frame; never under `remount`, in the default layout, with no ready frame, or while reader mode is on.
    layoutRule.value = 'default-only';
    atWidth(1280);
    expect(READER_LAYOUT_TEXT.deskNote).toBe(
      'Reader mode reads in the default layout. Choose Layout: Default in the command palette to use reader mode.',
    );
    const view = render(<Harness frame={fakeFrame('guided')} />);
    const note = screen.getByText(READER_LAYOUT_TEXT.deskNote, { selector: 'p', exact: true });
    // Beside the Print note and the update note: a line of the head after its row, never inside it.
    const head = note.parentElement as HTMLElement;
    expect(head.classList.contains('docs-head')).toBe(true);
    expect(head.querySelector('.docs-actions')?.contains(note)).toBe(false);
    expect(head.querySelectorAll('p.docs-note').length).toBeGreaterThanOrEqual(1);
    view.rerender(<Harness frame={fakeFrame('guided', false)} />);
    expect(screen.queryByText(READER_LAYOUT_TEXT.deskNote), 'a note over a frame that is not ready').toBeNull();
    view.rerender(<Harness frame={null} />);
    expect(screen.queryByText(READER_LAYOUT_TEXT.deskNote), 'a note with no frame').toBeNull();
    layoutRule.value = 'remount';
    view.rerender(<Harness frame={fakeFrame('guided')} />);
    expect(screen.queryByText(READER_LAYOUT_TEXT.deskNote), 'a note under remount').toBeNull();
  });

  it('palette: a Layout command writes the same pref as the Layout row and remounts the frame', async () => {
    // D-9180: one path (`chooseReaderLayout`), so a palette pick and a Page details pick cannot disagree.
    atWidth(412);
    const remounts: Array<ReturnType<typeof vi.fn>> = [];
    render(<><Harness frame={fakeFrame('classic')} /><RemountProbe remounts={remounts} /></>);
    await waitFor(() => { expect(remounts).toHaveLength(1); });
    const pick = (how: 'row' | 'palette', layout: ReaderLayout): { heard: string[]; stored: string | null } => {
      window.localStorage.clear();
      const heard: string[] = [];
      const stop = onReaderLayout((l) => { heard.push(l); });
      if (how === 'row') act(() => { fireEvent.change(layoutSelect()!, { target: { value: layout } }); });
      else {
        const row = baseCommands().find((c) => c.title === readerLayoutCommandTitle(layout))!;
        expect(available([row], paletteCtx), `${layout}: offered with the row drawn`).toHaveLength(1);
        act(() => { row.run(paletteCtx); });
      }
      stop();
      return { heard, stored: window.localStorage.getItem('ccrc:reader:v1:pref:prefs') };
    };
    for (const layout of ['guided', 'editorial'] as const) {
      const viaRow = pick('row', layout);
      const viaPalette = pick('palette', layout);
      expect(viaPalette, `${layout}: the palette's pick`).toEqual(viaRow);
      expect(viaPalette.heard, `${layout}: the frame's mount is told`).toEqual([layout]);
    }
    // The layout already shown still writes the pref (the desk's way to store a `?variant` visit's layout for the device).
    const shown = pick('palette', 'classic');
    expect(shown.stored).toBe('{"layout":"classic"}');
    expect(shown.heard).toEqual(['classic']);
    // The frame's mount was asked once for each layout the body was not already on its way to: the row's pick, then the palette's pick
    // of the same layout (nothing to do), and so on.
    expect(remounts[0]!.mock.calls.map((c) => (c[0] as { layout: ReaderLayout }).layout), 'the frame was not mounted again in each chosen layout')
      .toEqual(['guided', 'editorial', 'classic']);
    // While reader mode is on the row is not drawn and the commands are not offered.
    const held: { ctx: ReaderModeContextValue | null } = { ctx: null };
    cleanup();
    render(<Harness frame={fakeFrame('default')} onValue={(v) => { held.ctx = v; }} />);
    expect(readerLayoutHandle()?.layoutRowDrawn(), 'CONTROL: drawn while reader mode is off').toBe(true);
    act(() => { held.ctx!.enter('button'); });
    expect(readerLayoutHandle()?.layoutRowDrawn(), 'drawn while reader mode is on').toBe(false);
    expect(available(baseCommands(), paletteCtx).filter((c) => c.title.startsWith('Layout:')), 'offered in reader mode').toEqual([]);
  });

  it('page details: the Layout select is never drawn while reader mode is on', () => {
    atWidth(412);
    const held: { ctx: ReaderModeContextValue | null } = { ctx: null };
    render(<Harness frame={fakeFrame('default')} onValue={(v) => { held.ctx = v; }} />);
    expect(layoutSelect(), 'CONTROL: drawn while reader mode is off').not.toBeNull();
    act(() => { held.ctx!.enter('button'); });
    expect(held.ctx!.state.on, 'CONTROL: reader mode is on').toBe(true);
    expect(layoutSelect(), 'drawn while reader mode is on').toBeNull();
  });

  it('layouts: the Layout select shows the layout just chosen, and the frame that stands is the one it follows', () => {
    // M7: a choice is shown at once, while the frame is still loading that layout; the next frame published says what is shown, so a
    // frame that was kept (the texts did not load) puts the old layout back. Page details holds the one control.
    atWidth(412);
    const first = fakeFrame('classic');
    const view = render(<Harness frame={first} />);
    const select = layoutSelect()!;
    expect(select.value).toBe('classic');
    act(() => { fireEvent.change(select, { target: { value: 'guided' } }); });
    expect(layoutSelect()!.value, 'the chosen layout is shown at once, before the new frame is ready').toBe('guided');
    // The new frame is ready: it names the layout it carries.
    view.rerender(<Harness frame={fakeFrame('guided')} />);
    expect(layoutSelect()!.value).toBe('guided');
    // A choice whose frame was kept: the same layout is published again, and the select follows the frame.
    act(() => { fireEvent.change(layoutSelect()!, { target: { value: 'review' } }); });
    expect(layoutSelect()!.value).toBe('review');
    view.rerender(<Harness frame={fakeFrame('guided')} />);
    expect(layoutSelect()!.value, 'a kept frame\'s layout is shown again').toBe('guided');
  });
});

// ---- the page's own links, and the visit's variant ---------------------------------------------------------------------------------

const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};
const SERVED_REF = 'refs/remotes/origin/main';
const parser: MarkdownParser = async () => parseMarkdown('# Formatted', 'docs');

/** The real Docs screen at `url` over a ready Markdown file, its reader mount recorded (`inputs`): the screen derives the page it hands
 *  down (I-2), so the doc links, the head and the banners all read the one page. */
function ScreenOf(p: { readonly url: string; readonly inputs: ReaderMountInput[] }): ReactNode {
  const q = p.url.indexOf('?');
  const [setup] = useState(() => ({
    loaders: fakeLoaders({ tree: okTree(treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md')] })), file: okFile('# A\n') }).loaders,
    reader: {
      render: async () => RENDERED,
      images: async () => ({ urls: {}, drafts: 0, auth: 0 }),
      mount: async (_el, input) => {
        p.inputs.push(input);
        return { seed: { hosted: false }, follow: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn(), command: vi.fn() } as unknown as ReaderMount;
      },
    } satisfies ReaderDeps,
  }));
  return (
    <DocsScreen
      path={q < 0 ? p.url : p.url.slice(0, q)} search={q < 0 ? '' : p.url.slice(q)} loaders={setup.loaders} parser={parser} reader={setup.reader}
    />
  );
}

/** The href the page's reader hands the router for a link to `b.md`, as the frame reports it. */
function hrefOfLinkToB(input: ReaderMountInput): string {
  vi.mocked(navigate).mockClear();
  act(() => { input.onLink({ kind: 'relative', path: 'b.md', fragment: null }); });
  return String(vi.mocked(navigate).mock.calls.at(-1)?.[0]);
}

describe('the visit\'s variant on the page\'s links (X2 P5.1, I4, M6)', () => {
  it('layouts: after a Layout choice on a ?variant page, its doc links carry no variant', async () => {
    // I4: a choice from the Layout row ends the visit's variant for the rest of the page; the address is left as it is.
    window.history.replaceState(null, '', '/docs/demo/specs/a.md?variant=B');
    const inputs: ReaderMountInput[] = [];
    render(<ScreenOf url="/docs/demo/specs/a.md?variant=B" inputs={inputs} />);
    await waitFor(() => { expect(inputs).toHaveLength(1); });
    expect(inputs[0]!.layout, 'CONTROL: the visit\'s variant is the mount\'s layout').toBe('review');
    expect(hrefOfLinkToB(inputs[0]!), 'CONTROL: before a choice the links carry the variant').toBe('/docs/demo/specs/b.md?variant=B');
    act(() => { chooseReaderLayout('guided'); });
    await waitFor(() => { expect(hrefOfLinkToB(inputs[0]!)).toBe('/docs/demo/specs/b.md'); });
    expect(window.location.pathname + window.location.search, 'the address was changed').toBe('/docs/demo/specs/a.md?variant=B');
  });

  it('layouts: a reload of a ?variant address after a Layout choice shows the variant again', async () => {
    window.history.replaceState(null, '', '/docs/demo/specs/a.md?variant=B');
    const inputs: ReaderMountInput[] = [];
    render(<ScreenOf url="/docs/demo/specs/a.md?variant=B" inputs={inputs} />);
    await waitFor(() => { expect(inputs).toHaveLength(1); });
    act(() => { chooseReaderLayout('guided'); });
    expect(window.localStorage.getItem('ccrc:reader:v1:pref:prefs'), 'the stored pref holds the choice').toBe('{"layout":"guided"}');
    cleanup();
    // A reload: the page's module state starts empty (`resetReaderLayoutChoiceForTests`; `reader-layouts.test.ts` loads a fresh module
    // for the same fact). A new visit on the same address reads its `?variant` again, whatever the device chose.
    resetReaderLayoutChoiceForTests();
    const again: ReaderMountInput[] = [];
    render(<ScreenOf url="/docs/demo/specs/a.md?variant=B" inputs={again} />);
    await waitFor(() => { expect(again).toHaveLength(1); });
    expect(again[0]!.layout, 'the reloaded visit did not open in its variant').toBe('review');
    expect(hrefOfLinkToB(again[0]!)).toBe('/docs/demo/specs/b.md?variant=B');
    expect(window.localStorage.getItem('ccrc:reader:v1:pref:prefs')).toBe('{"layout":"guided"}');
  });

  it('layouts: Back to the draft keeps the page\'s variant', () => {
    // M6: the same page in its other view stays in the visit's layout, as it stays at its ref.
    const e = entry('specs', 'a.md', { draft: draftOf('modified') });
    const tree = treeOk({ entries: [e], drafts: holder() });
    const page = pageAt('/docs/demo/specs/a.md?ref=main&view=committed&variant=B');
    expect(page.kind === 'path' && page.variant, 'CONTROL: the page names a variant').toBe('review');
    render(
      <DocsBanners
        page={page} tree={tree} file={{ s: 'loading', pin: { kind: 'committed', commit: COMMIT_B, servedRef: SERVED_REF, section: 'specs', path: 'a.md' } }}
        draftAssets={0} onRelist={() => undefined}
      />,
    );
    const link = screen.getByRole('link', { name: DOCS_BANNER_TEXT.backToDraft });
    expect(link.getAttribute('href')).toBe('/docs/demo/specs/a.md?ref=main&variant=B');
  });
});
