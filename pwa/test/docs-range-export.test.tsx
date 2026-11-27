// X2 P6.1 Step 0c (spec 2026-11-18 4.3 "The pin", "Markdown in parts"; 4.6 row PR12): what P1 left for a document read by
// range. Export acts on the part on screen (the whole text only when the document was read whole), with the drafts banner
// from the opened pin for a stat-pinned draft and none for a committed document, and the sheet says it is the part. The truth
// line says "as read at <time>" for a stat-pinned draft once its range read finished. The visit keeps the read's facts for the
// page it read. Placeholders only (`demo`, `specs/...`, `/repo/demo`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import {
  DOCS_CLASS_CAP, DOCS_MAX_DOC_BYTES, DOCS_PDF_INLINE_MAX_BYTES, contentClass, type DocContentClass, type DocListPin, type DocPin, type DocsTreeOk,
} from '../../shared/docs';
import { DocsHead, exportStateFor, type ExportInputs, type ExportState } from '../src/docs/DocsHead';
import { actsOnPart, openedRangePin, rangeHasTextView, rangePinOf, rangeReadKey } from '../src/docs/range/rangePolicy';
import { decodeRangeBytes } from '../src/docs/range/rangeText';
import { RangeLeaf } from '../src/docs/range/RangeLeaf';
import { MarkdownParts, type PartsPrePass } from '../src/docs/range/MarkdownParts';
import type { RangeLoader, RangeTarget } from '../src/docs/range/readRange';
import { DOC_NOT_UTF8_NOTE } from '../src/docs/DocMarkdown';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import { DOCS_RANGE_TEXT, EXPORT_WAIT_TEXT } from '../src/docs/docsText';
import { answerRenderJob, type ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { DocsScreen } from '../src/screens/DocsScreen';
import { ExportSheet, EXPORT_PART_NOTE, type ExportBuilder } from '../src/docs/ExportSheet';
import type { ExportBody } from '../src/docs/exportBody';
import { exportInputOf, type ExportRequest } from '../src/docs/export/exportInput';
import { pinFor, useDocsVisit, type DocsVisit, type FileSlot, type RangeOpened } from '../src/docs/useDocsVisit';
import { HighlighterContext } from '../src/lib/highlighterContext';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import { BLOB_1, COMMIT_A, COMMIT_B, NO_RANGE_VISIT, draftOf, entry, fakeLoaders, holder, okTree, pageAt, servingLoader, treeOk, treeResponse } from './docsFixtures';
import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

// The sheet loads the builder's chunk; here every build is recorded and answers a one-byte file, so no case builds a real page.
const built: unknown[] = [];
vi.mock('../src/docs/export/buildExport', () => ({
  buildExport: async (input: { readonly name: string }) => {
    built.push(input);
    return { ok: true, name: input.name, bytes: new Uint8Array(1), size: 1, notes: [], deferred: 0, mockup: null };
  },
}));

afterEach(() => { cleanup(); built.length = 0; });

const DIGEST = 'ab12cd34ef56'.repeat(5) + 'abcd';
const READ_AT = Date.UTC(2026, 10, 27, 10, 15, 42);
const MTIME = '1700000000000000000';
const enc = new TextEncoder();
/** The bytes a fixture's range read gave to the visit. */
const BYTES = enc.encode('hello\n') as Uint8Array<ArrayBuffer>;

/** A stat-pinned draft of `path`, `size` bytes, in a worktree that holds drafts. */
const statTree = (path: string, size: number): DocsTreeOk => treeOk({
  drafts: holder(), entries: [entry('specs', path, { draft: draftOf('modified', { fp: null, size, mtimeNs: MTIME }) })],
});
/** A committed `path` of `size` bytes, above its class cap when `size` is. */
const committedTree = (path: string, size: number): DocsTreeOk => treeOk({
  entries: [entry('specs', path, { committed: { kind: 'file', blob: BLOB_1, size } })],
});

interface Held {
  readonly page: ReturnType<typeof pageAt> & { kind: 'path' };
  readonly tree: DocsTreeOk;
  readonly file: FileSlot;
  readonly ranged: RangeOpened;
}

/** The leaf a range read of `path` opened: its listing pin, the file slot the visit holds for it and what the read gave (`text`: the
 *  text of the bytes it gave, whose bytes the visit holds and which a body is compared with). */
function held(tree: DocsTreeOk, url: string, text: string = TEXT_READ): Held {
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error('fixture: not a leaf');
  const pin = pinFor(tree, page);
  if (pin === null) throw new Error('fixture: nothing opens');
  const size = pin.kind === 'draft' ? entryDraftSize(tree, page.path) : entryCommittedSize(tree, page.path);
  const file: FileSlot = pin.kind === 'draft' && pin.fp === null
    ? { s: 'stat-pinned', pin, size } : { s: 'too-large', pin, size, cap: DOCS_MAX_DOC_BYTES };
  return { page, tree, file, ranged: { pin: openedRangePin(pin, DIGEST), readAt: READ_AT, bytes: enc.encode(text) as Uint8Array<ArrayBuffer> } };
}
/** The text the fixtures' range reads gave: `TEXT`'s own, the whole text on screen. */
const TEXT_READ = 'the whole text on screen\n';
const entryDraftSize = (tree: DocsTreeOk, path: string): number => tree.entries.find((e) => e.path === path)?.draft?.size ?? 0;
const entryCommittedSize = (tree: DocsTreeOk, path: string): number => tree.entries.find((e) => e.path === path)?.committed?.size ?? 0;

/** The read's identity (`rangeReadKey`) of the listing slot a range read was made for: what the leaf hands the visit with its facts. */
function readKeyOf(tree: DocsTreeOk, slot: Extract<FileSlot, { s: 'stat-pinned' | 'too-large' }>): string {
  const e = tree.entries.find((x) => x.section === slot.pin.section && x.path === slot.pin.path);
  const range = e === undefined ? null : rangePinOf(slot.pin, e);
  if (range === null) throw new Error('fixture: no range pin');
  return rangeReadKey({ project: 'demo', pin: slot.pin, range, size: slot.size });
}

const inputs = (body: ExportBody | null, ranged: RangeOpened | null): ExportInputs =>
  ({ body, store: null, settled: true, assets: null, ranged });
const readyOf = (state: ExportState): Extract<ExportState, { s: 'ready' }> => {
  if (state.s !== 'ready') throw new Error('not ready: ' + JSON.stringify(state));
  return state;
};
const TEXT: ExportBody = { kind: 'text', text: TEXT_READ, lang: null };
/** What a part of a text above 2 MiB publishes: the body drawn inside the parts says it is one. */
const PART: ExportBody = { kind: 'text', text: 'the part on screen\n', lang: null, part: true };

describe('export of a document read by range: exportStateFor', () => {
  it('export: a document read by range exports the part on screen, and says so', async () => {
    const h = held(committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10), '/docs/demo/specs/big.txt');
    const state = readyOf(exportStateFor(h.page, h.tree, h.file, inputs(PART, h.ranged)));
    expect(state.source).toMatchObject({ kind: 'text', show: null, body: PART });
    expect(state.source.pin, 'the opened pin').toBe(h.ranged.pin);
    expect(state.part, 'a body that says it is a part is the part on screen').toBe(true);
    // A body that is the whole text (not drawn inside the parts) says nothing, whatever the file's size.
    const whole = readyOf(exportStateFor(h.page, h.tree, h.file, inputs(TEXT, h.ranged)));
    expect(whole.part).toBeUndefined();
    // A leaf that shows no text offers no Export.
    expect(exportStateFor(h.page, h.tree, h.file, inputs({ kind: 'none' }, h.ranged))).toEqual({ s: 'absent' });
    // And the sheet says it only for the part.
    const request: ExportRequest = { page: h.page, tree: h.tree, source: state.source, assets: null, readAt: h.ranged.readAt, part: true };
    const load = async (): Promise<ExportBuilder> => ({
      buildExport: async (input) => ({ ok: true, name: input.name, bytes: new Uint8Array(1), size: 1, notes: [], deferred: 0, mockup: null }),
    });
    const { unmount } = render(<ExportSheet request={request} onClose={() => {}} load={load} />);
    await screen.findByText(EXPORT_PART_NOTE);
    unmount();
    render(<ExportSheet request={{ ...request, part: undefined }} onClose={() => {}} load={load} />);
    await screen.findByRole('button', { name: /^Save / });
    expect(screen.queryByText(EXPORT_PART_NOTE)).toBeNull();
  });

  it('export: a stat-pinned draft read by range exports with the drafts banner and its snapshot digest', () => {
    const h = held(statTree('a.txt', 40), '/docs/demo/specs/a.txt?ref=main');
    const state = readyOf(exportStateFor(h.page, h.tree, h.file, inputs(TEXT, h.ranged)));
    expect(state.source.pin).toMatchObject({ kind: 'draft', fp: DIGEST });
    const input = exportInputOf(
      { page: h.page, tree: h.tree, source: state.source, assets: null, readAt: h.ranged.readAt },
      { exportedAt: READ_AT + 5000, theme: null },
    );
    expect(input.provenance.draft).toBe(true);
    expect(input.provenance.banner, 'the banner names the digest\'s first 12 hex').toContain(DIGEST.slice(0, 12));
    expect(input.provenance.banner, 'and the time the bytes were read, not the export time').toContain(new Date(READ_AT).toISOString());
    expect(input.provenance.banner).not.toContain(new Date(READ_AT + 5000).toISOString());
  });

  it('export: a committed document read by range exports with no banner', () => {
    const h = held(committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10), '/docs/demo/specs/big.txt');
    const state = readyOf(exportStateFor(h.page, h.tree, h.file, inputs(TEXT, h.ranged)));
    const input = exportInputOf(
      { page: h.page, tree: h.tree, source: state.source, assets: null, readAt: h.ranged.readAt },
      { exportedAt: READ_AT, theme: null },
    );
    expect(input.provenance.draft).toBe(false);
    expect(input.provenance.banner).toBeNull();
  });

  it('export: a range read that gave no bytes offers no Export, a body not yet published is formatting, the reader is the plain view', () => {
    const h = held(statTree('a.md', 40), '/docs/demo/specs/a.md?ref=main');
    expect(exportStateFor(h.page, h.tree, h.file, inputs(TEXT, null)), 'nothing read: nothing to export (refinement (k))').toEqual({ s: 'absent' });
    expect(exportStateFor(h.page, h.tree, h.file, inputs(null, h.ranged))).toEqual({ s: 'waiting', why: 'formatting' });
    expect(exportStateFor(h.page, h.tree, h.file, inputs({ kind: 'reader' }, h.ranged))).toEqual({ s: 'plain-view' });
    // A read opened at another pin (a re-list moved it) is not this page's.
    const other = { pin: { ...h.ranged.pin, head: 'f'.repeat(40) } as DocPin, readAt: READ_AT, bytes: enc.encode(TEXT_READ) as Uint8Array<ArrayBuffer> };
    expect(exportStateFor(h.page, h.tree, h.file, inputs(TEXT, other))).toEqual({ s: 'absent' });
    // A class with no view above its cap offers no Export, as before.
    const html = held(committedTree('m.html', DOCS_MAX_DOC_BYTES + 10), '/docs/demo/specs/m.html');
    expect(exportStateFor(html.page, html.tree, html.file, inputs(TEXT, html.ranged))).toEqual({ s: 'absent' });
    // And a file past the range ceiling is read by nothing: no Export either.
    const huge = held(committedTree('huge.txt', 80 * 1048576), '/docs/demo/specs/huge.txt');
    expect(exportStateFor(huge.page, huge.tree, huge.file, inputs(TEXT, null))).toEqual({ s: 'absent' });
  });

  it('export: a body that is not the text the read gave, and is no part, waits as the whole-read path waits (review F1)', () => {
    // A part that fell back to the plain view or the tree publishes the PART's text with no mark: it is not the whole text.
    const md = held(statTree('a.md', 40), '/docs/demo/specs/a.md?ref=main');
    const plainOf = (text: string, part?: true): ExportBody => ({ kind: 'plain', text, note: 'a note', ...(part === true ? { part } : {}) });
    expect(exportStateFor(md.page, md.tree, md.file, inputs(plainOf('one part only\n'), md.ranged))).toEqual({ s: 'waiting', why: 'formatting' });
    // The text the read gave is shown whole, so it is ready, and no part.
    const whole = readyOf(exportStateFor(md.page, md.tree, md.file, inputs(plainOf(TEXT_READ), md.ranged)));
    expect(whole.source).toMatchObject({ kind: 'plain', show: null });
    expect(whole.part).toBeUndefined();
    // A body that says it is a part (drawn inside the parts of a text above 2 MiB) is ready as one, whatever its text.
    expect(readyOf(exportStateFor(md.page, md.tree, md.file, inputs(plainOf('one part only\n', true), md.ranged))).part).toBe(true);
    // A text leaf: the same comparison.
    const txt = held(statTree('a.txt', 40), '/docs/demo/specs/a.txt?ref=main');
    expect(exportStateFor(txt.page, txt.tree, txt.file, inputs({ kind: 'text', text: 'one part only\n', lang: null }, txt.ranged)))
      .toEqual({ s: 'waiting', why: 'formatting' });
    expect(readyOf(exportStateFor(txt.page, txt.tree, txt.file, inputs(TEXT, txt.ranged))).part).toBeUndefined();
    // A read of other bytes (the text moved under a re-list that kept the pin) is not the text on screen either.
    const moved = held(statTree('a.md', 40), '/docs/demo/specs/a.md?ref=main', 'the new text\n');
    expect(exportStateFor(moved.page, moved.tree, moved.file, inputs(plainOf(TEXT_READ), moved.ranged))).toEqual({ s: 'waiting', why: 'formatting' });
  });
});

describe('decodeRangeBytes: the one decoder of a range read\'s bytes (L1)', () => {
  const asBytes = (...n: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(n);

  it('range text: UTF-8 bytes decode as UTF-8, text and all', () => {
    const d = decodeRangeBytes(enc.encode('héllo\n') as Uint8Array<ArrayBuffer>);
    expect(d).toEqual({ utf8: true, text: 'héllo\n' });
  });

  it('range text: bytes that are not UTF-8 give the lossy text and utf8 false, never a throw', () => {
    const d = decodeRangeBytes(asBytes(0x61, 0xff, 0x62));
    expect(d.utf8).toBe(false);
    expect(d.text).toBe('a�b');
  });

  it('range text: the same bytes array gives the same answer, so the leaf and the head hold one string; another array decodes anew', () => {
    const a = enc.encode('same\n') as Uint8Array<ArrayBuffer>;
    const first = decodeRangeBytes(a);
    expect(decodeRangeBytes(a), 'one answer object per array').toBe(first);
    const b = enc.encode('same\n') as Uint8Array<ArrayBuffer>;
    expect(decodeRangeBytes(b)).not.toBe(first);
    expect(decodeRangeBytes(b)).toEqual(first);
  });
});

describe('RangeLeaf: what a finished read tells the visit', () => {
  it('range facts: the read gives the visit its bytes, so the head has the text of the read', async () => {
    const src = enc.encode('hello\n') as Uint8Array<ArrayBuffer>;
    const rangeRead = vi.fn();
    const target: RangeTarget = {
      project: 'demo', size: src.length, range: { kind: 'blob', sha: BLOB_1 },
      pin: { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' },
    };
    render(
      <RangeLeaf target={target} cls="markdown" name="a.md" loader={servingLoader(src).loader} visit={{ ...NO_RANGE_VISIT, rangeRead }}>
        {() => <p>shown</p>}
      </RangeLeaf>,
    );
    await screen.findByText('shown');
    expect(rangeRead).toHaveBeenCalledTimes(1);
    const facts = rangeRead.mock.calls[0]![0] as { key: string; digest: string; bytes: Uint8Array<ArrayBuffer> };
    expect(facts.key).toBe(rangeReadKey(target));
    expect(decodeRangeBytes(facts.bytes).text, 'the bytes the leaf shows').toBe('hello\n');
  });

  it('range facts: unmounting the leaf drops the read\'s facts, so the visit holds no bytes past the page (review: the bytes were kept)', async () => {
    const src = enc.encode('hello\n') as Uint8Array<ArrayBuffer>;
    const tree = statTree('a.log', src.length);
    const f = fakeLoaders({ tree: okTree(tree) });
    const range = servingLoader(src);
    const seen: { visit: DocsVisit | null } = { visit: null };
    function Harness(p: { readonly show: boolean }): ReactNode {
      const visit = useDocsVisit(pageAt('/docs/demo/specs/a.log?ref=main'), f.loaders);
      seen.visit = visit;
      const file = visit.file;
      const e = tree.entries[0]!;
      if (!p.show || file.s !== 'stat-pinned') return null;
      const rangePin = rangePinOf(file.pin, e);
      if (rangePin === null) throw new Error('fixture: no range pin');
      const target: RangeTarget = { project: 'demo', size: file.size, range: rangePin, pin: file.pin };
      return (
        <RangeLeaf key={rangeReadKey(target)} target={target} cls="text" name="a.log" loader={range.loader} visit={visit}>
          {() => <p>shown</p>}
        </RangeLeaf>
      );
    }
    const { rerender } = render(<Harness show />);
    await screen.findByText('shown');
    await waitFor(() => expect(seen.visit?.rangeOpened, 'the read stands while the leaf is on screen').not.toBeNull());
    expect(decodeRangeBytes(seen.visit!.rangeOpened!.bytes!).text, 'the bytes the leaf read').toBe('hello\n');
    rerender(<Harness show={false} />);
    await waitFor(() => expect(seen.visit?.rangeOpened, 'the leaf left: nothing is held').toBeNull());
  });

  // Review 4126 F1: a leaf with NO view (HTML or SVG above its cap, a PDF above the inline ceiling, any other class) saves the bytes
  // and stays mounted, so whatever the visit was handed it holds until the page is left. Only a class with a text view (Markdown,
  // text) has the bytes handed over; the other facts (key, digest, readAt) reach the visit for every class.
  describe('the bytes reach the visit only for a class with a text view (review 4126 F1)', () => {
    /** `name` read by range at `size` bytes through a real visit and a leaf mounted as `DocsLeaf` mounts it: with the view `withView`
     *  gives (none: a Download-only leaf that saves as it opens). Resolves with the visit once its read finished. */
    async function readOf(name: string, size: number, withView: boolean): Promise<{ visit: DocsVisit; saved: number }> {
      const src = new Uint8Array(size).fill(0x41) as Uint8Array<ArrayBuffer>;
      const tree = committedTree(name, size);
      const f = fakeLoaders({ tree: okTree(tree) });
      const range = servingLoader(src);
      const seen: { visit: DocsVisit | null } = { visit: null };
      const clicks: HTMLAnchorElement[] = [];
      const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
      function Harness(): ReactNode {
        const visit = useDocsVisit(pageAt(`/docs/demo/specs/${name}`), f.loaders);
        seen.visit = visit;
        const file = visit.file;
        if (file.s !== 'too-large') return null;
        const rangePin = rangePinOf(file.pin, tree.entries[0]!);
        if (rangePin === null) throw new Error('fixture: no range pin');
        const target: RangeTarget = { project: 'demo', size: file.size, range: rangePin, pin: file.pin };
        return withView
          ? <RangeLeaf key={rangeReadKey(target)} target={target} cls={contentClass(name)} name={name} loader={range.loader} visit={visit}>{() => <p>shown</p>}</RangeLeaf>
          : <RangeLeaf key={rangeReadKey(target)} target={target} cls={contentClass(name)} name={name} loader={range.loader} visit={visit} saveOnOpen />;
      }
      try {
        render(<Harness />);
        await waitFor(() => expect(seen.visit?.rangeOpened, name + ': the read finished').not.toBeNull(), { timeout: 20000 });
        if (!withView) await waitFor(() => expect(clicks, name + ': saved').toHaveLength(1));
        return { visit: seen.visit!, saved: clicks.length };
      } finally {
        spy.mockRestore();
      }
    }

    const noView: ReadonlyArray<readonly [string, string, number]> = [
      ['an HTML page above its cap', 'a.html', DOCS_CLASS_CAP.html + 1],
      ['an SVG above its cap', 'a.svg', DOCS_CLASS_CAP.svg + 1],
      ['a PDF above the inline ceiling', 'a.pdf', DOCS_PDF_INLINE_MAX_BYTES + 1],
      ['a file of a class with no view (other)', 'a.bin', DOCS_CLASS_CAP.other + 1],
    ];
    for (const [label, name, size] of noView) {
      it(`range facts: ${label}, read with no view and saved, hands the visit no bytes, and its other facts still stand`, async () => {
        const { visit } = await readOf(name, size, false);
        const opened = visit.rangeOpened!;
        expect('bytes' in opened, name + ': the visit holds no bytes no view can use').toBe(false);
        expect(opened.readAt, 'the truth line\'s read time still stands').toBeGreaterThan(0);
        expect(opened.pin).toMatchObject({ kind: 'committed', path: name });
      }, 60000);
    }

    for (const [label, name] of [['a Markdown text', 'a.md'], ['a text file', 'a.txt']] as const) {
      it(`range facts: ${label} above its cap still hands the visit its bytes, the head compares a body with their text`, async () => {
        const { visit } = await readOf(name, DOCS_CLASS_CAP.markdown + 1, true);
        const bytes = visit.rangeOpened!.bytes;
        expect(bytes?.length, name + ': the bytes the leaf read').toBe(DOCS_CLASS_CAP.markdown + 1);
      }, 60000);
    }

    it('rangeHasTextView: Markdown and text have a text view above their cap, no other class does', () => {
      const classes: Record<DocContentClass, boolean> = {
        markdown: true, text: true, raster: false, svg: false, html: false, pdf: false, other: false,
      };
      for (const [cls, has] of Object.entries(classes) as [DocContentClass, boolean][]) expect(rangeHasTextView(cls), cls).toBe(has);
    });
  });
});

describe('actsOnPart: the one measure of "Changes since and Export act on the part" (spec 4.3)', () => {
  it('is false up to 2 MiB of UTF-8 bytes and true one byte over, whatever the characters', () => {
    expect(actsOnPart('a'.repeat(DOCS_MAX_DOC_BYTES))).toBe(false);
    expect(actsOnPart('a'.repeat(DOCS_MAX_DOC_BYTES + 1))).toBe(true);
    // Bytes, not characters: 2 MiB / 2 two-byte characters fit, one more does not.
    expect(actsOnPart('é'.repeat(DOCS_MAX_DOC_BYTES / 2))).toBe(false);
    expect(actsOnPart('é'.repeat(DOCS_MAX_DOC_BYTES / 2 + 1))).toBe(true);
  });
});

describe('the truth line: as read at <time> (spec 4.3 "The pin")', () => {
  const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
  function visitOf(tree: DocsTreeOk, over: Partial<DocsVisit>): DocsVisit {
    return {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: NOW }, file: { s: 'none' }, freshness: { s: 'idle' }, updatedTo: null,
      pendingFragment: null, ...NO_RANGE_VISIT, retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(),
      setFragment: vi.fn(), ...over,
    };
  }
  const truth = (h: Held, ranged: RangeOpened | null): string => {
    render(<DocsHead page={h.page} visit={visitOf(h.tree, { file: h.file, rangeOpened: ranged })} tree={h.tree} />);
    return document.querySelector('.docs-truth')?.textContent ?? '';
  };

  it('truth line: a stat-pinned draft read by range says as read at its read time', () => {
    const h = held(statTree('a.txt', 40), '/docs/demo/specs/a.txt?ref=main');
    expect(truth(h, null), 'not before the read finished').not.toContain('as read at');
    cleanup();
    const line = truth(h, h.ranged);
    expect(line).toContain('as read at 2026-11-27 10:15 UTC');
    expect(line, 'beside the source, before the freshness chip').toMatch(/draft.*as read at .*(never fetched|ago|no origin)/i);
  });

  it('truth line: a committed document read by range says nothing of a read time', () => {
    const h = held(committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10), '/docs/demo/specs/big.txt');
    expect(truth(h, h.ranged)).not.toContain('as read at');
  });

  it('truth line: another page\'s range read is not this page\'s', async () => {
    const two = treeOk({
      drafts: holder(),
      entries: [
        entry('specs', 'a.txt', { draft: draftOf('modified', { fp: null, size: 40, mtimeNs: MTIME }) }),
        entry('specs', 'b.txt', { draft: draftOf('modified', { fp: null, size: 41, mtimeNs: MTIME }) }),
      ],
    });
    const f = { ...fakeLoaders({ tree: okTree(two) }), treeValue: two };
    const pageA = pageAt('/docs/demo/specs/a.txt?ref=main');
    const pageB = pageAt('/docs/demo/specs/b.txt?ref=main');
    const { result, rerender } = renderHook(({ page }) => useDocsVisit(page, f.loaders), { initialProps: { page: pageA } });
    await waitFor(() => expect(result.current.file.s).toBe('stat-pinned'));
    expect(result.current.rangeOpened, 'nothing read yet').toBeNull();
    const listed = result.current.file;
    if (listed.s !== 'stat-pinned') throw new Error('fixture');
    act(() => { result.current.rangeRead({ key: readKeyOf(f.treeValue, listed), digest: DIGEST, readAt: READ_AT, bytes: BYTES }); });
    expect(result.current.rangeOpened).toEqual({ pin: openedRangePin(listed.pin, DIGEST), readAt: READ_AT, bytes: BYTES });
    expect(result.current.rangeOpened?.pin).toMatchObject({ kind: 'draft', fp: DIGEST });
    rerender({ page: pageB });
    await waitFor(() => expect(result.current.file).toMatchObject({ s: 'stat-pinned', pin: { path: 'b.txt' } }));
    expect(result.current.rangeOpened, 'another page').toBeNull();
    rerender({ page: pageA });
    await waitFor(() => expect(result.current.file).toMatchObject({ s: 'stat-pinned', pin: { path: 'a.txt' } }));
    // The leaf drops what an earlier read gave when it opens or a read starts: then none stands.
    act(() => { result.current.rangeDropped(); });
    expect(result.current.rangeOpened, 'a read starting leaves none').toBeNull();
    // Other bytes (a read whose stat is not the one the page lists) are not the page's read either.
    const other = { ...listed.pin, stat: { size: 99, mtimeNs: MTIME } } as DocListPin;
    act(() => { result.current.rangeRead({ key: readKeyOf(f.treeValue, { ...listed, pin: other, size: 99 }), digest: 'e'.repeat(64), readAt: READ_AT, bytes: BYTES }); });
    expect(result.current.rangeOpened, 'other bytes').toBeNull();
  });

  it('range facts: the page check is the visit\'s own, so the same bytes under another ref are not this page\'s read', async () => {
    const tree = committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10);
    const f = fakeLoaders({ tree: okTree(tree) });
    const pageA = pageAt('/docs/demo/specs/big.txt');
    const pageB = pageAt('/docs/demo/specs/big.txt?ref=main');
    const { result, rerender } = renderHook(({ page }) => useDocsVisit(page, f.loaders), { initialProps: { page: pageA } });
    await waitFor(() => expect(result.current.file.s).toBe('too-large'));
    const listed = result.current.file;
    if (listed.s !== 'too-large') throw new Error('fixture');
    act(() => { result.current.rangeRead({ key: readKeyOf(tree, listed), digest: DIGEST, readAt: READ_AT, bytes: BYTES }); });
    expect(result.current.rangeOpened).not.toBeNull();
    // Same project, section, path, blob and size: the read's key is equal, and only the page differs.
    rerender({ page: pageB });
    await waitFor(() => expect(result.current.file.s).toBe('too-large'));
    expect(result.current.rangeOpened, 'another ref is another page').toBeNull();
  });

  it('range facts: the visit holds the bytes the read gave, and the head compares a body with their decoding, the lossy one for bytes that are not UTF-8', async () => {
    const tree = committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10);
    const f = fakeLoaders({ tree: okTree(tree) });
    const { result } = renderHook(() => useDocsVisit(pageAt('/docs/demo/specs/big.txt'), f.loaders));
    await waitFor(() => expect(result.current.file.s).toBe('too-large'));
    const listed = result.current.file;
    if (listed.s !== 'too-large') throw new Error('fixture');
    const bad = new Uint8Array([0x61, 0xff, 0x62]);
    act(() => { result.current.rangeRead({ key: readKeyOf(tree, listed), digest: DIGEST, readAt: READ_AT, bytes: bad }); });
    expect(result.current.rangeOpened?.bytes, 'the very array the leaf got').toBe(bad);
    // The head's comparison: the lossy text of those bytes is what the body must show.
    const h = held(committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10), '/docs/demo/specs/big.txt');
    const ranged = { ...h.ranged, bytes: bad };
    expect(readyOf(exportStateFor(h.page, h.tree, h.file, inputs({ kind: 'text', text: 'a�b', lang: null }, ranged))).part).toBeUndefined();
    expect(exportStateFor(h.page, h.tree, h.file, inputs(TEXT, ranged))).toEqual({ s: 'waiting', why: 'formatting' });
  });

  it('range facts: a read of a file that is neither Markdown nor text is never decoded, by the visit or the head (review: 64 MiB of an image)', async () => {
    // The 1234 bytes are told from any other decode by their length, so a decode of anything else on the page does not count.
    const blob = new Uint8Array(1234).fill(0x80) as Uint8Array<ArrayBuffer>;
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    const decodedBlob = (): number => decode.mock.calls.filter(([b]) => (b as Uint8Array | undefined)?.byteLength === blob.length).length;
    try {
      // (A raster image is never read through the visit's range facts: `wantedFile` leaves it to the image's own read.)
      for (const name of ['a.pdf', 'a.bin']) {
        const tree = statTree(name, blob.length);
        const f = fakeLoaders({ tree: okTree(tree) });
        const { result, unmount } = renderHook(() => useDocsVisit(pageAt(`/docs/demo/specs/${name}?ref=main`), f.loaders));
        await waitFor(() => expect(result.current.file.s).toBe('stat-pinned'));
        const listed = result.current.file;
        if (listed.s !== 'stat-pinned') throw new Error('fixture');
        act(() => { result.current.rangeRead({ key: readKeyOf(tree, listed), digest: DIGEST, readAt: READ_AT, bytes: blob }); });
        expect(result.current.rangeOpened, name + ': the read stands').not.toBeNull();
        const page = pageAt(`/docs/demo/specs/${name}?ref=main`);
        exportStateFor(page, tree, listed, inputs(null, result.current.rangeOpened));
        expect(decodedBlob(), name + ': nothing decoded the bytes').toBe(0);
        unmount();
      }
      // HTML and SVG above their cap, with a NON-NULL ranged fact that carries bytes (built here: the visit itself hands none for a
      // class with no text view, review 4126 F1). `exportStateFor` goes on past its own class check for these (they have an Export
      // outside a range read), so only `rangeExportState`'s own class check, before any decode, keeps the bytes undecoded (A1).
      for (const name of ['a.html', 'a.svg']) {
        const h = held(committedTree(name, DOCS_CLASS_CAP[contentClass(name)] + 1), `/docs/demo/specs/${name}`);
        const ranged: RangeOpened = { ...h.ranged, bytes: blob };
        expect(ranged.bytes, name + ': a read that carries bytes').toBe(blob);
        expect(exportStateFor(h.page, h.tree, h.file, inputs(null, ranged)), name + ': no Export of a range read').toEqual({ s: 'absent' });
        expect(decodedBlob(), name + ': nothing decoded the bytes').toBe(0);
      }
      // The control: a text file's bytes are decoded, once, however often the head asks.
      const h = held(statTree('a.txt', blob.length), '/docs/demo/specs/a.txt?ref=main');
      const ranged = { ...h.ranged, bytes: blob };
      exportStateFor(h.page, h.tree, h.file, inputs(TEXT, ranged));
      exportStateFor(h.page, h.tree, h.file, inputs(TEXT, ranged));
      expect(decodedBlob(), 'a text file is decoded, once (the memo)').toBeGreaterThan(0);
      expect(decodedBlob()).toBeLessThanOrEqual(2);
    } finally {
      decode.mockRestore();
    }
  });

  describe('a re-list that leaves the bytes alone keeps the page\'s read', () => {
    it('range facts: a committed file read by blob keeps its read when a re-list moves the commit (another file changed)', async () => {
      const tree = committedTree('big.txt', DOCS_MAX_DOC_BYTES + 10);
      const f = fakeLoaders({ tree: okTree(tree) });
      const { result } = renderHook(() => useDocsVisit(pageAt('/docs/demo/specs/big.txt'), f.loaders));
      await waitFor(() => expect(result.current.file.s).toBe('too-large'));
      const listed = result.current.file;
      if (listed.s !== 'too-large') throw new Error('fixture');
      const key = readKeyOf(tree, listed);
      act(() => { result.current.rangeRead({ key, digest: DIGEST, readAt: READ_AT, bytes: BYTES }); });
      expect(result.current.rangeOpened?.pin).toMatchObject({ kind: 'committed', commit: COMMIT_A });
      // A re-list answers another commit (an unrelated file changed); the blob is the same.
      const moved = treeOk({ commit: COMMIT_B, entries: [...tree.entries, entry('specs', 'other.md')] });
      f.tree.mockResolvedValue(okTree(moved));
      act(() => { result.current.retryTree(); });
      await waitFor(() => expect(result.current.file).toMatchObject({ s: 'too-large', pin: { commit: COMMIT_B } }));
      expect(result.current.rangeOpened, 'the read stands').toMatchObject({ readAt: READ_AT, pin: { kind: 'committed', commit: COMMIT_B } });
      // A read in flight when the re-list lands gives its facts after it, under the same key: they stand too.
      act(() => { result.current.rangeDropped(); });
      expect(result.current.rangeOpened).toBeNull();
      act(() => { result.current.rangeRead({ key, digest: DIGEST, readAt: READ_AT + 1, bytes: BYTES }); });
      expect(result.current.rangeOpened).toMatchObject({ readAt: READ_AT + 1, pin: { commit: COMMIT_B }, bytes: BYTES });
    });

    it('range facts: a stat-pinned draft keeps its read when its worktree\'s head moves, and its opened pin names the new head', async () => {
      const tree = statTree('a.txt', 40);
      const f = fakeLoaders({ tree: okTree(tree) });
      const { result } = renderHook(() => useDocsVisit(pageAt('/docs/demo/specs/a.txt?ref=main'), f.loaders));
      await waitFor(() => expect(result.current.file.s).toBe('stat-pinned'));
      const listed = result.current.file;
      if (listed.s !== 'stat-pinned') throw new Error('fixture');
      act(() => { result.current.rangeRead({ key: readKeyOf(tree, listed), digest: DIGEST, readAt: READ_AT, bytes: BYTES }); });
      expect(result.current.rangeOpened?.pin).toMatchObject({ kind: 'draft', head: COMMIT_A, fp: DIGEST });
      const moved = treeOk({ drafts: holder(COMMIT_B), entries: tree.entries });
      f.tree.mockResolvedValue(okTree(moved));
      act(() => { result.current.retryTree(); });
      await waitFor(() => expect(result.current.file).toMatchObject({ s: 'stat-pinned', pin: { head: COMMIT_B } }));
      expect(result.current.rangeOpened, 'the read stands, at the new head').toMatchObject({ readAt: READ_AT, pin: { kind: 'draft', head: COMMIT_B, fp: DIGEST } });
    });
  });
});

describe('a document read by range, on the Docs screen', () => {
  const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
  const hex = async (b: Uint8Array<ArrayBuffer>): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

  /** `url` opened on the screen over `tree`, its range read served from `src`; the reader is off (the plain view). */
  function open(url: string, tree: DocsTreeOk, src: Uint8Array<ArrayBuffer>, withParser: MarkdownParser = parser, range?: RangeLoader) {
    const f = fakeLoaders({ tree: okTree(tree) });
    const s = servingLoader(src);
    navigate(url);
    function Screen(): ReactNode {
      const { path, search } = useLocation();
      return (
        <HighlighterContext value={inThreadContext(inThreadHighlighter())}>
          <DocsScreen path={path} search={search} loaders={{ ...f.loaders, range: range ?? s.loader }} parser={withParser} reader={null} />
        </HighlighterContext>
      );
    }
    return { f, s, ...render(<Screen />) };
  }
  const truthLine = (): string => document.querySelector('.docs-truth')?.textContent ?? '';
  const settle = (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

  const exportButton = (): HTMLButtonElement => screen.getByRole('button', { name: /^Export/ }) as HTMLButtonElement;

  it('export: a document read by range exports the part on screen, and says so (on the screen: a 2 MiB text and ten bytes)', async () => {
    const src = enc.encode('z'.repeat(DOCS_MAX_DOC_BYTES + 10)) as Uint8Array<ArrayBuffer>;
    open('/docs/demo/specs/one.log', committedTree('one.log', src.length), src);
    await waitFor(() => expect(screen.getByText('Part 1 of 2')).toBeTruthy(), { timeout: 20000 });
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await screen.findByText(EXPORT_PART_NOTE);
    const first = built.at(-1) as { body: { text: string }; provenance: { banner: string | null } };
    expect(first.body.text.length, 'part 1 is the first 2 MiB').toBe(DOCS_MAX_DOC_BYTES);
    expect(first.provenance.banner, 'a committed document has no banner').toBeNull();
    cleanup();
    built.length = 0;
    open('/docs/demo/specs/one.log', committedTree('one.log', src.length), src);
    await waitFor(() => expect(screen.getByText('Part 1 of 2')).toBeTruthy(), { timeout: 20000 });
    fireEvent.click(screen.getByText('Next part'));
    await waitFor(() => expect(screen.getByText('Part 2 of 2')).toBeTruthy());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await screen.findByText(EXPORT_PART_NOTE);
    expect((built.at(-1) as { body: { text: string } }).body.text, 'part 2 is the ten bytes left').toBe('z'.repeat(10));
  }, 60000);

  it('export: a stat-pinned draft read by range exports with the drafts banner and its snapshot digest (on the screen)', async () => {
    const src = enc.encode('hello\n') as Uint8Array<ArrayBuffer>;
    const digest = await hex(src);
    open('/docs/demo/specs/a.log?ref=main', statTree('a.log', src.length), src);
    await waitFor(() => expect(document.querySelector('pre.doc-plain')?.textContent).toBe('hello\n'));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    expect(document.querySelector('.docs-truth')?.textContent, 'the head says when its bytes were read').toMatch(/as read at \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    fireEvent.click(exportButton());
    await screen.findByRole('button', { name: /^Save / });
    const input = built.at(-1) as { provenance: { banner: string | null; draft: boolean } };
    expect(input.provenance.draft).toBe(true);
    expect(input.provenance.banner).toContain(digest.slice(0, 12));
    expect(screen.queryByText(EXPORT_PART_NOTE), 'one part is the whole text: nothing to say').toBeNull();
  }, 60000);

  const line = (i: number): string => `Paragraph number ${String(i).padStart(6, '0')} of the document\n\n`;
  /** Markdown text of at least `min` bytes, paragraph by paragraph. */
  const markdownOf = (min: number): string => {
    let text = '';
    for (let i = 0; text.length <= min; i += 1) text += line(i);
    return text;
  };
  /** Parses each text alone and records it; the first line names what was parsed, so the export's title says which text it was. */
  const recording = (sources: string[]): MarkdownParser => async (text) => {
    sources.push(text);
    return parseMarkdown('# ' + (text.split('\n')[0] ?? ''), 'docs');
  };

  it('export: the plain view of a Markdown text above 2 MiB shows its parts, and Export exports the part on screen', async () => {
    const src = enc.encode(markdownOf(DOCS_MAX_DOC_BYTES + 4096)) as Uint8Array<ArrayBuffer>;
    const sources: string[] = [];
    open('/docs/demo/specs/big.md?ref=main', statTree('big.md', src.length), src, recording(sources));
    await waitFor(() => expect(screen.getByText(/^Part 1 of \d+$/)).toBeTruthy(), { timeout: 30000 });
    expect(screen.queryByText(/Format anyway|Show as text/), 'no gate: each part is under it').toBeNull();
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));
    for (const s of sources) expect(enc.encode(s).length, 'a part is parsed, never the whole text').toBeLessThanOrEqual(DOCS_RENDER_GATE_BYTES);
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await screen.findByText(EXPORT_PART_NOTE);
    expect((built.at(-1) as { title: string }).title).toBe('Paragraph number 000000 of the document');
    fireEvent.click(screen.getByText('Next part'));
    await waitFor(() => expect(screen.getByText(/^Part 2 of \d+$/)).toBeTruthy());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(built.length).toBe(2));
    expect((built.at(-1) as { title: string }).title, 'part 2\'s own first line').not.toBe('Paragraph number 000000 of the document');
  }, 90000);

  it('export: the plain view of a 600 KiB Markdown text keeps the gate, and Export of its Format-anyway tree exports the whole text', async () => {
    const text = markdownOf(600 * 1024);
    const src = enc.encode(text) as Uint8Array<ArrayBuffer>;
    const sources: string[] = [];
    open('/docs/demo/specs/mid.md?ref=main', statTree('mid.md', src.length), src, recording(sources));
    fireEvent.click(await screen.findByRole('button', { name: /Format anyway/ }, { timeout: 30000 }));
    expect(screen.queryByText(/Part 1 of/), 'no parts at or below 2 MiB').toBeNull();
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await screen.findByRole('button', { name: /^Save / });
    expect(screen.queryByText(EXPORT_PART_NOTE), 'the whole text: nothing to say').toBeNull();
    expect(sources, 'the whole text was formatted').toEqual([text]);
  }, 90000);

  it('range facts: the banner\'s time is the range read\'s, not the export\'s', async () => {
    const src = enc.encode('hello\n') as Uint8Array<ArrayBuffer>;
    const before = Date.now();
    open('/docs/demo/specs/a.log?ref=main', statTree('a.log', src.length), src);
    await waitFor(() => expect(document.querySelector('pre.doc-plain')?.textContent).toBe('hello\n'));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    await settle();
    const clicked = Date.now();
    fireEvent.click(exportButton());
    await screen.findByRole('button', { name: /^Save / });
    const banner = (built.at(-1) as { provenance: { banner: string | null } }).provenance.banner ?? '';
    const at = Date.parse(/\d{4}-\d\d-\d\dT[\d:.]+Z/.exec(banner)?.[0] ?? '');
    expect(at, 'the banner names a time').not.toBeNaN();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at, 'the read finished before the settle, well before the tap').toBeLessThan(clicked - 30);
  }, 60000);

  /** A range loader that serves `src` until a test says to hold the frames (they never answer) or to fail them. */
  function steered(src: Uint8Array<ArrayBuffer>) {
    const s = servingLoader(src);
    const mode = { now: 'serve' as 'serve' | 'hold' | 'fail' };
    const loader: RangeLoader = {
      prepare: s.loader.prepare,
      frame: (t, snapshot, offset, length, signal) => mode.now === 'hold' ? new Promise(() => undefined)
        : mode.now === 'fail' ? Promise.resolve({ s: 'failed' as const, body: { ok: false as const, failure: 'snapshot-gone' as const } })
          : s.loader.frame(t, snapshot, offset, length, signal),
    };
    return { loader, mode };
  }
  const twoDrafts: DocsTreeOk = treeOk({
    drafts: holder(),
    entries: ['a.log', 'b.log'].map((p) => entry('specs', p, { draft: draftOf('modified', { fp: null, size: 6, mtimeNs: MTIME }) })),
  });

  it('range facts: a page read again says nothing of the old read while it reads, and a Cancel or a failure leaves none', async () => {
    const src = enc.encode('hello\n') as Uint8Array<ArrayBuffer>;
    const range = steered(src);
    open('/docs/demo/specs/a.log?ref=main', twoDrafts, src, parser, range.loader);
    await waitFor(() => expect(truthLine()).toContain('as read at'));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    // Away to a page that reads nothing by range (the section's listing), then back to the same page, read again.
    navigate('/docs/demo/specs?ref=main');
    await screen.findByRole('searchbox');
    range.mode.now = 'hold';
    navigate('/docs/demo/specs/a.log?ref=main');
    await screen.findByText(DOCS_RANGE_TEXT.cancel);
    expect(truthLine(), 'a read in progress has no time').not.toContain('as read at');
    expect(document.querySelector('.docs-export'), 'and no Export').toBeNull();
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.cancel));
    await screen.findByRole('alert');
    expect(truthLine(), 'a Cancel leaves none').not.toContain('as read at');
    expect(document.querySelector('.docs-export')).toBeNull();
    // And a failure: the page read and served once more, away, then back with failing frames.
    range.mode.now = 'serve';
    navigate('/docs/demo/specs/b.log?ref=main');
    await waitFor(() => expect(truthLine()).toContain('as read at'));
    navigate('/docs/demo/specs?ref=main');
    await screen.findByRole('searchbox');
    range.mode.now = 'fail';
    navigate('/docs/demo/specs/b.log?ref=main');
    await screen.findByRole('alert');
    await settle();
    expect(truthLine(), 'a failed read leaves none').not.toContain('as read at');
    expect(document.querySelector('.docs-export')).toBeNull();
  }, 60000);

  it('export: a text above 2 MiB that is not UTF-8 offers no Export, where it showed a Formatting… that never ends', async () => {
    const src = new Uint8Array(DOCS_MAX_DOC_BYTES + 1).fill(0x61);
    src[10] = 0xff;
    open('/docs/demo/specs/a.log?ref=main', statTree('a.log', src.length), src);
    await waitFor(() => expect(screen.queryByText(DOCS_RANGE_TEXT.cancel)).toBeNull(), { timeout: 30000 });
    await screen.findByText(/offers it as a Download/);
    await settle();
    expect(document.querySelector('.docs-export'), 'no body will come, so no Export').toBeNull();
  }, 60000);

  it('export: a Markdown text above 2 MiB that is not UTF-8 exports its whole plain text, and the sheet does not say it is a part', async () => {
    const src = new Uint8Array(DOCS_MAX_DOC_BYTES + 1).fill(0x61);
    src[10] = 0xff;
    open('/docs/demo/specs/a.md?ref=main', statTree('a.md', src.length), src);
    await screen.findByText(DOC_NOT_UTF8_NOTE, undefined, { timeout: 30000 });
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await screen.findByRole('button', { name: /^Save / });
    expect(screen.queryByText(EXPORT_PART_NOTE), 'the whole file is exported: nothing is a part').toBeNull();
  }, 60000);
});

// Review F1 (spec 4.3): with the reader on, a document read by range above the render gate is shown one reader frame per part. A
// frame that falls back (a render job that refuses) draws the plain view of the PART, which publishes the part's text. At 2 MiB or
// less Export acts on the whole text, so a part is not its text: Export waits, as the whole-read path waits for a body that is not
// the text. Above 2 MiB the part on screen is the export, marked as one, and the sheet says so.
describe('a document read by range, on the Docs screen, with the reader on and a part that falls back', () => {
  /** A reader whose render job refuses: the frame falls back to the plain view (`worker-unavailable`), and the cut is the line cutter's. */
  const refusing = (): ReaderDeps => ({
    render: vi.fn(async () => ({ kind: 'worker-unavailable' })), mount: vi.fn(), images: vi.fn(),
  }) as unknown as ReaderDeps;
  const line = (i: number): string => `Paragraph number ${String(i).padStart(6, '0')} of the document\n\n`;
  const markdownOf = (min: number): string => {
    let text = '';
    for (let i = 0; text.length <= min; i += 1) text += line(i);
    return text;
  };
  /** Parses each text alone and records it; the first line names what was parsed, so the export's title says which text it was. */
  const recording = (sources: string[]): MarkdownParser => async (text) => {
    sources.push(text);
    return parseMarkdown('# ' + (text.split('\n')[0] ?? ''), 'docs');
  };
  const FIRST = 'Paragraph number 000000 of the document';

  function openWith(url: string, tree: DocsTreeOk, src: Uint8Array<ArrayBuffer>, parser: MarkdownParser) {
    const f = fakeLoaders({ tree: okTree(tree) });
    const s = servingLoader(src);
    const reader = refusing();
    navigate(url);
    function Screen(): ReactNode {
      const { path, search } = useLocation();
      return (
        <HighlighterContext value={inThreadContext(inThreadHighlighter())}>
          <DocsScreen path={path} search={search} loaders={{ ...f.loaders, range: s.loader }} parser={parser} reader={reader} />
        </HighlighterContext>
      );
    }
    return { reader, ...render(<Screen />) };
  }
  const exportButton = (): HTMLButtonElement => screen.getByRole('button', { name: /^Export/ }) as HTMLButtonElement;
  const settle = (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

  it('export: a fallen-back part of a text read by range up to 2 MiB is not the whole text, so Export waits, never exporting the part as the file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const src = enc.encode(markdownOf(600 * 1024)) as Uint8Array<ArrayBuffer>;
      expect(actsOnPart(new TextDecoder().decode(src)), 'a text the page exports whole').toBe(false);
      const sources: string[] = [];
      const { reader } = openWith('/docs/demo/specs/mid.md?ref=main', statTree('mid.md', src.length), src, recording(sources));
      await waitFor(() => expect(sources.length).toBeGreaterThan(0), { timeout: 30000 });
      // The part's tree is on screen: the frame fell back and the plain view parsed the part.
      await waitFor(() => expect(screen.getByRole('heading', { name: FIRST })).toBeTruthy());
      expect(reader.render, 'the reader was asked, and refused').toHaveBeenCalled();
      for (const s of sources) expect(enc.encode(s).length, 'a part, not the whole text').toBeLessThanOrEqual(DOCS_RENDER_GATE_BYTES);
      await settle();
      await settle();
      expect(exportButton().disabled, 'the part is not the whole text: Export waits').toBe(true);
      expect(exportButton().getAttribute('aria-label')).toContain(EXPORT_WAIT_TEXT.formatting);
      expect(built, 'nothing was built').toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  }, 90000);

  it('export: a fallen-back part of a text read by range above 2 MiB exports as the part on screen, and the sheet says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const src = enc.encode(markdownOf(DOCS_MAX_DOC_BYTES + 4096)) as Uint8Array<ArrayBuffer>;
      expect(actsOnPart(new TextDecoder().decode(src)), 'a text the page shows in parts').toBe(true);
      const sources: string[] = [];
      openWith('/docs/demo/specs/big.md?ref=main', statTree('big.md', src.length), src, recording(sources));
      await waitFor(() => expect(sources.length).toBeGreaterThan(0), { timeout: 60000 });
      await waitFor(() => expect(screen.getByRole('heading', { name: FIRST })).toBeTruthy(), { timeout: 30000 });
      await waitFor(() => expect(exportButton().disabled, 'the part on screen is the export').toBe(false), { timeout: 10000 });
      fireEvent.click(exportButton());
      await screen.findByText(EXPORT_PART_NOTE);
      expect((built.at(-1) as { title: string }).title).toBe(FIRST);
    } finally {
      vi.restoreAllMocks();
    }
  }, 120000);
});

describe('MarkdownParts: the plain view keeps the reader\'s part', () => {
  const section = (n: number): string => `## Part ${n}\n\n` + 'word '.repeat(Math.floor((DOCS_RENDER_GATE_BYTES - 64) / 5)) + '\n\n';
  const TEXT = section(1) + section(2) + section(3);
  const readerJob = (src: string, o: { budgetMs: number; signal?: AbortSignal; blocks?: true }): Promise<ReaderRenderOutcome> =>
    new Promise((resolve) => { answerRenderJob({ id: 1, kind: 'render', src, blocks: o.blocks }, (r) => { resolve(r.outcome); }); });

  it('md parts: on part 2 in the reader, the plain view of the same text and key shows part 2 of the same parts', async () => {
    const shown: string[] = [];
    const view = (pre: PartsPrePass | null, text = TEXT, bodyKey = 'plain-keeps-part'): ReactNode => (
      <MarkdownParts
        bodyKey={bodyKey} text={text} pre={pre} fragment={null}
        renderPart={(part) => { shown.push(part.text.slice(0, 9)); return <p>part {part.index + 1}</p>; }}
      />
    );
    const { rerender, unmount } = render(view(readerJob));
    await waitFor(() => expect(screen.getByText('Part 1 of 3')).toBeTruthy(), { timeout: 30000 });
    fireEvent.click(screen.getByText('Next part'));
    expect(screen.getByText('Part 2 of 3')).toBeTruthy();
    const readerPart = shown.at(-1);
    expect(readerPart).toBe('## Part 2');
    // The reader's tap: the same element, its render job gone.
    rerender(view(null));
    expect(screen.getByText('Part 2 of 3'), 'the same instance keeps the place in the same cut').toBeTruthy();
    expect(shown.at(-1)).toBe(readerPart);
    // And a plain branch that mounts anew for the same text and key does too.
    unmount();
    render(view(null));
    expect(screen.getByText('Part 2 of 3')).toBeTruthy();
    expect(shown.at(-1)).toBe(readerPart);
    cleanup();
    // Another key, or another text, cuts afresh at part 1.
    render(view(null, TEXT, 'another-key'));
    expect(screen.getByText('Part 1 of 3')).toBeTruthy();
    cleanup();
    render(view(null, TEXT + 'tail\n', 'plain-keeps-part'));
    expect(screen.getByText('Part 1 of 3')).toBeTruthy();
  }, 60000);
});
