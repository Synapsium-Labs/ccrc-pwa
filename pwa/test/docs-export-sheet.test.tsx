// Docs W5 Export, Task 7: the export sheet (spec 2026-10-01 4.17 "Save", "Failures and limits"; decision 7; M4.EX13;
// refinements (e), (l), (u)). The sheet builds as soon as it opens, through an injected builder (or, in one case, the real
// chunk), and its Save calls `downloadExport` inside the click. `setup.ts` stubs `URL.createObjectURL`; the anchor's
// `click` is spied so jsdom never navigates. Task 9 appends the Export chrome's colour guard. Placeholders only:
// project `demo`, `specs/...`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DocPin, DocsPageLocation } from '../../shared/docs';
import { ExportSheet, type ExportBuilder } from '../src/docs/ExportSheet';
import { EXPORT_FACT, EXPORT_TEXT, fillSentence } from '../src/docs/docsText';
import type { ExportInput, ExportResult } from '../src/docs/export/buildExport';
import { exportInputOf, firstHeading, type ExportRequest } from '../src/docs/export/exportInput';
import { detachUrls } from '../src/docs/docsLinks';
import { parseMarkdown } from '../src/lib/markdownParse';
import { COMMIT_A, SERVED, fileResponse, pageAt, treeOk } from './docsFixtures';
import { syncTestStore } from './highlightTestStore';
import { stripComments } from './cssRule';

type Leaf = DocsPageLocation & { kind: 'path' };
const PAGE = pageAt('/docs/demo/specs/a.md') as Leaf;
const PIN: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' };
const NAME = `demo_specs_a.md_${COMMIT_A.slice(0, 8)}.html`;
const REQUEST: ExportRequest = {
  page: PAGE, tree: treeOk(), assets: null, readAt: 0,
  source: { kind: 'plain', pin: PIN, show: fileResponse('# A').show, body: { kind: 'plain', text: '# A', note: 'a note' } },
};

/** A builder that records each input and answers `answer` (by default a one-byte file). */
function builder(answer?: (input: ExportInput) => ExportResult | Promise<ExportResult>): ExportBuilder & { inputs: ExportInput[] } {
  const inputs: ExportInput[] = [];
  return {
    inputs,
    buildExport: async (input) => {
      inputs.push(input);
      return answer === undefined
        ? { ok: true, name: input.name, bytes: new TextEncoder().encode('x'), size: 2048, notes: ['a note', 'one more'], deferred: 0 }
        : answer(input);
    },
  };
}

function sheet(load: () => Promise<ExportBuilder>, request: ExportRequest = REQUEST): void {
  render(<ExportSheet request={request} onClose={() => {}} load={load} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('the export sheet: build on open, then Save (spec 4.17; M4.EX13)', () => {
  it('says Building…, then the provenance, the notes and Save <name> (<size>)', async () => {
    const b = builder();
    sheet(async () => b);
    expect(screen.getByText(EXPORT_TEXT.building)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: `Save ${NAME} (2 KiB)` })).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('one more')).toBeInTheDocument();
    expect(b.inputs).toHaveLength(1);
  });

  it('Save clicks the download anchor inside the click itself, before any microtask runs (M4.EX13)', async () => {
    const clicks: boolean[] = [];
    let microtaskRan = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { clicks.push(microtaskRan); });
    sheet(async () => builder());
    const save = await screen.findByRole('button', { name: `Save ${NAME} (2 KiB)` });
    queueMicrotask(() => { microtaskRan = true; });
    fireEvent.click(save);
    expect(clicks).toEqual([false]);
  });

  it('a chunk that does not load says so with Retry, and Retry loads again', async () => {
    let tries = 0;
    sheet(async () => {
      tries += 1;
      if (tries === 1) throw new TypeError('failed to fetch a module');
      return builder();
    });
    expect(await screen.findByText(fillSentence(EXPORT_TEXT.couldNotStart, { error: 'TypeError' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EXPORT_TEXT.retry }));
    expect(await screen.findByRole('button', { name: `Save ${NAME} (2 KiB)` })).toBeInTheDocument();
  });

  it('a build that throws says Export failed with its name, and offers neither Save nor Retry', async () => {
    sheet(async () => builder(() => { throw new RangeError('too deep'); }));
    expect(await screen.findByText(fillSentence(EXPORT_TEXT.failed, { error: 'RangeError' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull();
    expect(screen.queryByRole('button', { name: EXPORT_TEXT.retry })).toBeNull();
  });

  it('a body too large says to use Download, and offers no Save', async () => {
    sheet(async () => builder(() => ({ ok: false, why: 'too-large' })));
    expect(await screen.findByText(EXPORT_TEXT.tooLarge)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull();
  });

  it("images waiting for Load image are named in the sheet", async () => {
    sheet(async () => builder((input) => ({ ok: true, name: input.name, bytes: new Uint8Array(1), size: 1, notes: [], deferred: 2 })));
    expect(await screen.findByText('2 images not loaded; tap Load image first.')).toBeInTheDocument();
  });

  it("builds with the exporter's palette, read from the document (refinement (e))", async () => {
    document.documentElement.setAttribute('data-theme', 'nord');
    const b = builder();
    sheet(async () => b);
    await screen.findByRole('button', { name: /^Save / });
    expect(b.inputs[0]?.theme).toBe('nord');
  });

  it('loads the real builder chunk and saves what it built', async () => {
    render(<ExportSheet request={REQUEST} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: new RegExp(`^Save ${NAME.replace(/\./g, '\\.')} \\(\\d+ KiB\\)$`) })).toBeInTheDocument();
  });
});

describe('exportInputOf (spec 4.17; refinement (l))', () => {
  it("titles a Markdown export by its first h1, else the file name, and names the file by the opened pin", () => {
    const outcome = parseMarkdown('Intro\n\n# The title\n\n# Later\n', 'docs');
    if (outcome.kind !== 'tree') throw new Error('fixture');
    const d = detachUrls(outcome.tree);
    expect(firstHeading(d.tree)).toBe('The title');
    const link = { project: 'demo', pageRef: null, view: 'effective' as const, section: 'specs' as const, path: 'a.md', tree: treeOk(), pageSource: 'committed' as const, onFragment: () => {} };
    const input = exportInputOf({
      ...REQUEST, source: { kind: 'tree', pin: PIN, show: fileResponse('x').show, body: { kind: 'tree', text: 'x', tree: d.tree, urls: d.urls, link }, store: syncTestStore('docs') },
    }, { exportedAt: 0, theme: null });
    expect(input.title).toBe('The title');
    expect(input.name).toBe(NAME);
    expect(input.commit).toBe(COMMIT_A);
    expect(exportInputOf(REQUEST, { exportedAt: 0, theme: null }).title).toBe('a.md');
  });

  it("every Markdown export says it is Docs' plain view, a tree or a plain body alike; a text leaf's does not (refinement (a))", () => {
    const view = (r: ExportRequest): string | undefined =>
      exportInputOf(r, { exportedAt: 0, theme: null }).provenance.facts.find((f) => f.label === EXPORT_FACT.view)?.value;
    expect(REQUEST.source.kind).toBe('plain');
    expect(view(REQUEST)).toBe(EXPORT_TEXT.plainView);
    const text: ExportRequest = {
      ...REQUEST, page: pageAt('/docs/demo/specs/a.txt') as Leaf,
      source: { kind: 'text', pin: { ...PIN, path: 'a.txt' }, show: fileResponse('a').show, body: { kind: 'text', text: 'a', lang: null }, store: null },
    };
    expect(view(text)).toBeUndefined();
  });
});

// ---- Task 9: the Export chrome paints no colour of its own (M4.S1's Export clause) ------------------------------

describe('the Export chrome paints no colour of its own (M4.S1 Export clause; spec 4.14)', () => {
  const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8'));
  const exportRules = css.split('}').map((chunk) => chunk.split('{')).filter(([sel]) => /\.docs-export\b/.test(sel ?? ''));

  it('every rule naming .docs-export sets no ink, ground, border, outline, fill or shadow, so design/audit.mjs owes it no entry', () => {
    expect(exportRules.map(([sel]) => (sel ?? '').trim()).sort()).toEqual([
      '.docs-export', '.docs-export-facts', '.docs-export-facts > div', '.docs-export-facts dt, .docs-export-facts dd',
      '.docs-export-note', '.docs-export-sheet', '.docs-export:disabled',
    ]);
    for (const [sel, body] of exportRules) {
      expect(body ?? '', sel).not.toMatch(
        /(?:^|[;{\s])(?:color|background[a-z-]*|border[a-z-]*|outline[a-z-]*|fill|stroke|text-decoration-color|opacity|filter|box-shadow|accent-color|caret-color)\s*:/);
    }
  });
});
