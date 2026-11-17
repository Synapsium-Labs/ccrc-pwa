// Docs W5 Export (spec 2026-10-01 4.7, 4.14, 4.17; native Docs reader W5, Export): what an export holds, pure and built.
// Task 1, the words and the name (M4.EX5's and M4.EX18's maps, M4.EX9). Task 2, the stylesheet (M4.EX10, M4.EX14 as
// refinement (b) reads it). Task 3, the provenance and the colouring (M4.T7, M4.EX5, M4.EX6, M4.EX18). Task 5, the
// builder (M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18). Completion plan Task 9 (C2): the builder's mockup arm over the real
// snapshot (M5.EX1, M5.EX5, M5.EX7 through the builder) and `exportStateFor`'s class-`html` rows (M5.EX6). Placeholders
// only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`, `https://a.example`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DOCS_RASTER_TYPES, docsApi, entryView, type DocPin, type DocsEntry, type DocsPageLocation, type DocsShowOk,
  type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { exportStateFor } from '../src/docs/DocsHead';
import { ExportSheet } from '../src/docs/ExportSheet';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';
import {
  DOC_IMAGE_TEXT, DOC_LINK_INERT_SENTENCE, ENTRY_BADGE_TEXT, EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT,
  EXPORT_WAIT_TEXT, fillSentence,
} from '../src/docs/docsText';
import { GATE_BODY, READER_BODY, type ExportBody, type MockupLoadEnd } from '../src/docs/exportBody';
import { extractMockupRefs, startMockupLoad } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import { MOCKUP_MAX_ASSET_BYTES } from '../src/docs/mockup/policy';
import type { MockupAssetReader, MockupAssetResult } from '../src/docs/mockup/ports';
import { buildExport, type ExportBodyInput, type ExportInput, type ExportLimits, type ExportResult } from '../src/docs/export/buildExport';
import { exportColouring, type ExportColouring } from '../src/docs/export/colouring';
import { createExportAssets, type ExportAssets } from '../src/docs/export/exportAssets';
import { exportLinkTarget } from '../src/docs/export/exportMarkdown';
import { exportInputOf, type ExportRequest } from '../src/docs/export/exportInput';
import { exportFilename } from '../src/docs/export/filename';
import {
  DOCS_EXPORT_CSP, DOCS_EXPORT_MAX_BYTES, EXPORT_FILENAME_MAX, EXPORT_PREFIX, type ExportMissing, type ExportPlain,
} from '../src/docs/export/policy';
import { colouringNotes, exportProvenance, exportWorktreeLabel, missingNotes, type ExportProvenance } from '../src/docs/export/provenance';
import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';
import { pinFor, type FileSlot } from '../src/docs/useDocsVisit';
import type { Highlighter } from '../src/lib/highlightProtocol';
import {
  UNREQUESTED_ENTRY, checkHighlightHtml, codeBlocksOf, createHighlightStore, type CheckedHighlightHtml, type CodeBlockText,
  type HighlightEntry, type HighlightStore, type PlainCause, type SkipCeiling,
} from '../src/lib/highlightStore';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { docsHighlighter } from '../src/lib/markdownRunner';
import { BLOB_1, COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk } from './docsFixtures';
import { FROZEN_CLOCK, syncTestStore } from './highlightTestStore';

const SHORT_A = COMMIT_A.slice(0, 8);
const committedPin = (path: string, commit = COMMIT_A): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });
const draftPin = (path: string): DocPin =>
  ({ kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path, fp: FP_1 });

describe('the Export words (spec 4.7, 4.17; M4.EX5, M4.EX18)', () => {
  it('EXPORT_MISSING_SENTENCE has one sentence per placeholder word, and none takes a field', () => {
    expect(Object.keys(EXPORT_MISSING_SENTENCE).sort())
      .toEqual(['deferred', 'external', 'failed', 'over-size', 'refused', 'timed-out']);
    for (const s of Object.values(EXPORT_MISSING_SENTENCE)) expect(s).not.toContain('{');
  });

  it('EXPORT_PLAIN_SENTENCE has one sentence per class of plain block, and none takes a field', () => {
    expect(Object.keys(EXPORT_PLAIN_SENTENCE).sort())
      .toEqual(['failed', 'no-worker', 'over-cap', 'page-ceiling', 'timeout', 'too-large']);
    for (const s of Object.values(EXPORT_PLAIN_SENTENCE)) expect(s).not.toContain('{');
  });

  it("the sheet's failure and wait sentences are spec 4.17's", () => {
    expect(EXPORT_TEXT.tooLarge).toBe('Too large to export; use Download.');
    expect(fillSentence(EXPORT_TEXT.couldNotStart, { error: 'TypeError' })).toBe('Export could not start (TypeError).');
    expect(fillSentence(EXPORT_TEXT.failed, { error: 'RangeError' })).toBe('Export failed (RangeError).');
    expect(fillSentence(EXPORT_TEXT.deferred, { k: 2, s: 's' })).toBe('2 images not loaded; tap Load image first.');
  });
});

describe('exportFilename (spec 4.17 "Filename"; M4.EX9)', () => {
  const SAFE = /^[A-Za-z0-9._-]+$/;

  it("is <project>_<section>_<path with '/' as '__'>_<short8>.html", () => {
    expect(exportFilename('demo', committedPin('d/a.md'), COMMIT_A)).toBe(`demo_specs_d__a.md_${SHORT_A}.html`);
  });

  it('ends -draft.html for a draft', () => {
    expect(exportFilename('demo', draftPin('a.md'), COMMIT_A)).toBe(`demo_specs_a.md_${SHORT_A}-draft.html`);
  });

  it.each([
    ['non-ASCII letters', 'café/naïve.md', 'caf-__na-ve.md'],
    ['spaces and quotes', 'a b/"c".md', 'a-b__-c-.md'],
    ['a control byte', `a${String.fromCharCode(1)}b.md`, 'a-b.md'],
  ])('turns every character outside [A-Za-z0-9._-] into "-" (%s)', (_name, path, want) => {
    const name = exportFilename('demo', committedPin(path), COMMIT_A);
    expect(name).toMatch(SAFE);
    expect(name).toBe(`demo_specs_${want}_${SHORT_A}.html`);
  });

  it('is at most 150 characters: the path is cut first, and the tail stays whole', () => {
    const name = exportFilename('demo', draftPin(`${'x'.repeat(300)}/a.md`), COMMIT_A);
    expect(name).toHaveLength(EXPORT_FILENAME_MAX);
    expect(name.startsWith('demo_specs_xxx')).toBe(true);
    expect(name.endsWith(`_${SHORT_A}-draft.html`)).toBe(true);
  });
});

// ---- Task 2: the stylesheet ---------------------------------------------------------------------------------------

describe('the export stylesheet (spec 4.14, 4.17; M4.EX10, M4.EX14 as refinement (b) reads it)', () => {
  const read = (...parts: string[]): string => readFileSync(path.join(import.meta.dirname, '..', ...parts), 'utf8');

  it('is tokens.css, prose.css and export.css, in that order, each less its comments and @font-face blocks', () => {
    const parts = [read('..', 'ui', 'src', 'styles', 'tokens.css'), read('..', 'ui', 'src', 'components', 'prose.css'),
      read('src', 'docs', 'export', 'export.css')];
    expect(EXPORT_CSS).toBe(parts.map(exportStylesheetPart).join('\n'));
    expect(EXPORT_CSS).toContain("[data-theme='light']");
    expect(EXPORT_CSS).toContain('.msg-assist');
    expect(EXPORT_CSS).toContain('.ccrc-export-draft');
  });

  it('holds no comment, no @font-face, no @import, no url( and no </style', () => {
    expect(EXPORT_CSS).not.toMatch(/\/\*/);
    expect(EXPORT_CSS).not.toMatch(/@font-face/i);
    expect(EXPORT_CSS).not.toMatch(/@import/i);
    expect(EXPORT_CSS).not.toMatch(/url\(/i);
    expect(EXPORT_CSS).not.toMatch(/<\/style/i);
  });

  it('exportStylesheetPart drops comments and every @font-face block, and nothing else', () => {
    const css = "/* a url() */\n@font-face { font-family: X; src: url('x.woff2'); }\n.a { margin: 0; }\n@font-face{src:url(y)}";
    expect(exportStylesheetPart(css)).toBe('.a { margin: 0; }');
  });

  it('no hex colour in docs/export/*.ts or *.tsx, comments aside (M4.EX10)', () => {
    const dir = path.join(import.meta.dirname, '..', 'src', 'docs', 'export');
    const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
    expect(files).toEqual(expect.arrayContaining(['policy.ts', 'stylesheet.ts']));
    for (const name of files) {
      const code = readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});

// ---- Task 3: the provenance and the colouring --------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const GH = 'https://github.com/example-org/example-repo';
type Leaf = DocsPageLocation & { kind: 'path' };

function leafAt(url: string): Leaf {
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error(`fixture: ${url} is not a leaf`);
  return page;
}

/** The provenance of `url`'s leaf at the pin its tree implies (the page has read it). */
function provenanceAt(tree: DocsTreeOk, url: string, show: DocsShowOk | null = null): ExportProvenance {
  const page = leafAt(url);
  const pin = pinFor(tree, page);
  if (pin === null) throw new Error(`fixture: ${url} opens nothing`);
  return exportProvenance({ tree, page, pin, show, exportedAt: NOW, readAt: NOW - 1000, plainView: true });
}

const factOf = (p: ExportProvenance, label: string): string | undefined => p.facts.find((f) => f.label === label)?.value;
const metaOf = (p: ExportProvenance, name: string): string | undefined => p.metas.find((m) => m.name === name)?.content;

/** `holder()`'s record at another worktree, narrowed to the holder arm before the spread (as docs-share.test.ts does). */
function holderAt(worktree: { readonly path: string; readonly class: 'main' | 'workspace' | 'other' }): DraftsFacts {
  const h = holder();
  if (h.state !== 'holder') throw new Error('fixture: holder() is not a holder');
  return { ...h, worktree: { ...h.worktree, ...worktree } };
}

const DRAFT_STATES: [string, Partial<DocsEntry>][] = [
  ['modified', { draft: draftOf('modified') }],
  ['added', { committed: null, draft: draftOf('added') }],
  ['untracked', { committed: null, draft: draftOf('untracked') }],
  ['conflicted', { draft: draftOf('conflicted') }],
  ['deleted', { draft: draftOf('deleted', { kind: 'absent', size: null, fp: null }) }],
  ['typechange', { draft: draftOf('typechange', { kind: 'symlink', fp: null }) }],
  ['withheld', { draft: draftOf('modified', { fp: null }) }],
];

describe('the export\'s worktree label has ONE owner, exportWorktreeLabel in provenance.ts (review minor 5)', () => {
  it('is the label the draft banner, the Source fact and the ccrc:worktree meta carry, for every class of worktree', () => {
    const cases: Array<[{ readonly path: string; readonly class: 'main' | 'workspace' | 'other' }, string]> = [
      [{ path: '/repo/demo', class: 'main' }, 'main checkout'],
      [{ path: '/repo/demo/.ws/ws-a/', class: 'workspace' }, 'workspace ws-a'],
      [{ path: '/repo/elsewhere/wt-b', class: 'other' }, 'another worktree'],
    ];
    for (const [worktree, want] of cases) {
      const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holderAt(worktree) });
      const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
      expect(exportWorktreeLabel(tree)).toBe(want);
      expect(metaOf(p, 'ccrc:worktree')).toBe(want);
      expect(p.banner).toContain(`uncommitted changes from ${want} on main`);
      expect(factOf(p, 'Source')).toContain(want);
    }
    expect(exportWorktreeLabel(treeOk())).toBe('another worktree');
  });

  it('no other file of Export builds the label: the choice between closedWorktreeLabel and the other-worktree words stands once, in provenance.ts', () => {
    const dir = path.join(import.meta.dirname, '..', 'src', 'docs');
    const files = [
      ...readdirSync(path.join(dir, 'export')).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(dir, 'export', f)),
      path.join(dir, 'ExportSheet.tsx'),
    ];
    const holders = files.filter((f) => /closedWorktreeLabel\(|worktreeOther/.test(readFileSync(f, 'utf8')));
    expect(holders.map((f) => path.relative(dir, f))).toEqual([path.join('export', 'provenance.ts')]);
    expect(readFileSync(path.join(dir, 'export', 'provenance.ts'), 'utf8').match(/closedWorktreeLabel\(/g)).toHaveLength(1);
  });
});

describe('exportProvenance: what the file says it is (spec 4.17 "Provenance", "Drafts"; M4.T7, M4.EX5, M4.EX6)', () => {
  it('a committed leaf: project, repo path, served ref and how, the full commit, its permalink, its source, the time and the view', () => {
    const p = provenanceAt(treeOk(), '/docs/demo/specs/a.md');
    expect(p.commit).toBe(COMMIT_A);
    expect(p.facts).toEqual([
      { label: 'Project', value: 'demo' },
      { label: 'Path', value: 'docs/superpowers/specs/a.md' },
      { label: 'Served', value: 'origin/main (default branch (origin/HEAD))' },
      { label: 'Commit', value: COMMIT_A },
      { label: 'On GitHub', value: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md` },
      { label: 'Source', value: 'committed' },
      { label: 'Exported', value: '2026-11-03T12:00:00.000Z' },
      { label: 'View', value: EXPORT_TEXT.plainView },
    ]);
    expect(metaOf(p, 'ccrc:commit')).toBe(COMMIT_A);
    expect(metaOf(p, 'ccrc:link')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(p.banner).toBeNull();
    expect(p.notes).toEqual([]);
  });

  it('a draft leaf is the draft, under the banner, its worktree named by its closed label (M4.EX6)', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
    expect(p.draft).toBe(true);
    expect(factOf(p, 'Source')).toBe('draft · modified in main checkout');
    expect(factOf(p, 'Committed version on GitHub')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(p.banner).toBe('Draft, not committed. This copy includes uncommitted changes from main checkout on main. '
      + `Based on commit ${COMMIT_A} (${SERVED}). It is not on GitHub. Content fingerprint sha256:${FP_1.slice(0, 12)}. `
      + 'Read 2026-11-03T11:59:59.000Z.');
  });

  it('view=committed on an admitted entry is the committed bytes, with no banner and the not-included note (M4.EX6)', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main&view=committed');
    expect(p.draft).toBe(false);
    expect(p.banner).toBeNull();
    expect(factOf(p, 'Source')).toBe('committed (view=committed)');
    expect(p.notes).toEqual(['draft · modified in main checkout; not included.']);
  });

  it.each(DRAFT_STATES)("names the rows' badge for a %s draft (M4.T7 Export clause)", (_state, over) => {
    const e = entry('specs', 'a.md', over);
    const tree = treeOk({ entries: [e], drafts: holder() });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    if (badge === null) throw new Error('fixture: no badge');
    const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
    expect([...p.facts.map((f) => f.value), ...p.notes].join('\n')).toContain(`${ENTRY_BADGE_TEXT[badge]} in main checkout`);
  });

  it('names a worktree by its closed label only, and carries no path, user, candidate or failure detail (M4.EX5)', () => {
    const HOME = '/repo/home-x/user-x/wrapper-a-demo/ws-x';
    const base = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holderAt({ path: HOME, class: 'workspace' }) });
    const tree: DocsTreeOk = { ...base, mainCheckout: { path: HOME, branch: 'main', head: COMMIT_A } };
    const drafted = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
    expect(factOf(drafted, 'Source')).toBe('draft · modified in workspace ws-x');
    const others: DraftsFacts[] = [
      { state: 'ambiguous', branch: 'main', candidates: [HOME, `${HOME}-2`] },
      { state: 'unreadable', branch: 'main', worktree: HOME, step: 'status', detail: `fatal: ${HOME}: user-x` },
      { state: 'untrusted', branch: 'main', worktree: HOME, why: 'foreign-owner' },
    ];
    const all = [drafted, ...others.map((d) => provenanceAt({ ...tree, drafts: d }, '/docs/demo/specs/a.md?ref=main'))];
    for (const p of all) {
      const text = JSON.stringify(p);
      for (const leak of ['home-x', 'user-x', 'wrapper-a-demo', '/repo/']) expect(text).not.toContain(leak);
    }
  });

  it('says what Share says of onRef, measured at the opened commit', () => {
    const show: DocsShowOk = { ...fileResponse('# A').show, commit: COMMIT_A, blob: BLOB_1, onRef: 'not-contained' };
    const p = provenanceAt(treeOk(), '/docs/demo/specs/a.md', show);
    expect(p.notes).toEqual([`Commit ${SHORT_A} is no longer on origin/main; GitHub may stop serving it.`]);
  });

  it('with no GitHub origin, the reason stands in for the link, and its meta is the closed word', () => {
    const p = provenanceAt({ ...treeOk(), github: { state: 'none' } }, '/docs/demo/specs/a.md');
    expect(factOf(p, 'No GitHub link')).toBe('No GitHub link for this project.');
    expect(metaOf(p, 'ccrc:no-link')).toBe('no-github-origin');
  });

  it("names the commit the leaf opened, not the tree's (M4.EX12)", () => {
    const p = exportProvenance({
      tree: treeOk({ commit: COMMIT_B }), page: leafAt('/docs/demo/specs/a.md'), pin: committedPin('a.md', COMMIT_A),
      show: null, exportedAt: NOW, readAt: NOW, plainView: false,
    });
    expect(p.commit).toBe(COMMIT_A);
    expect(factOf(p, 'On GitHub')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(p.facts.some((f) => f.label === 'View')).toBe(false);
  });
});

describe('exportColouring and its notes: each drawn block counted by the entry it draws (spec 4.17; M4.EX18)', () => {
  const OK_HTML = checkHighlightHtml('<span class="hljs-keyword">const</span>');
  if (OK_HTML === null) throw new Error('fixture: the check refused plain hljs markup');
  const html = (checked: object): HighlightEntry => ({ kind: 'html', mode: 'block', checked: checked as CheckedHighlightHtml });
  const plain = (first: PlainCause): HighlightEntry => ({ kind: 'plain', first, retry: null });
  const key = (lang: string, raw: string): string => `${lang}\u0000${raw}`;
  /** A Docs store over fixed entries, with per-copy skips, that never asks a highlighter. */
  function storeOf(entries: Readonly<Record<string, HighlightEntry>>, skips: ReadonlyMap<object, SkipCeiling> = new Map()): HighlightStore {
    return { ...syncTestStore('docs'), peek: (k) => entries[k] ?? UNREQUESTED_ENTRY, copySkip: (at) => skips.get(at) ?? null };
  }

  it('counts each plain class under its closed word, a coloured block not at all, and an unregistered one not at all', () => {
    const raws = ['ok', 'skipped', 'slow', 'big', 'dead', 'threw', 'bad', 'none', 'forged', 'unregistered'];
    const blocks: CodeBlockText[] = [
      ...raws.map((raw) => ({ lang: 'bash', raw })),
      { lang: 'bash', raw: 'x'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1) },
      { lang: 'nope', raw: 'no grammar' },
    ];
    const c = exportColouring(blocks, storeOf({
      [key('bash', 'ok')]: html(OK_HTML),
      [key('bash', 'skipped')]: { kind: 'skipped', ceiling: 'page-output' },
      [key('bash', 'slow')]: plain({ kind: 'timeout', budgetMs: 750 }),
      [key('bash', 'big')]: plain({ kind: 'too-large' }),
      [key('bash', 'dead')]: plain({ kind: 'worker-failed', error: 'Error' }),
      [key('bash', 'threw')]: plain({ kind: 'threw', error: 'TypeError' }),
      [key('bash', 'bad')]: plain({ kind: 'malformed' }),
      [key('bash', 'none')]: plain({ kind: 'worker-unavailable' }),
      [key('bash', 'forged')]: html({ html: '<img src=x onerror=alert(1)>' }),
      [key('bash', 'unregistered')]: plain({ kind: 'unregistered' }),
    }), false);
    expect(c.coloured).toBe(1);
    expect(Object.fromEntries(c.plain)).toEqual({
      'over-cap': 1, 'page-ceiling': 1, 'timeout': 1, 'too-large': 1, 'failed': 4, 'no-worker': 1,
    });
  });

  it('a later copy of a coloured block that the page skipped counts as past a page ceiling, by its own pre', () => {
    const first = {};
    const second = {};
    const c = exportColouring([{ lang: 'bash', raw: 'ok', at: first }, { lang: 'bash', raw: 'ok', at: second }],
      storeOf({ [key('bash', 'ok')]: html(OK_HTML) }, new Map([[second, 'page-output']])), false);
    expect(c.coloured).toBe(1);
    expect(Object.fromEntries(c.plain)).toEqual({ 'page-ceiling': 1 });
  });

  it('colouring dropped to fit says that, and nothing else', () => {
    const c = exportColouring([{ lang: 'bash', raw: 'slow' }], storeOf({ [key('bash', 'slow')]: plain({ kind: 'timeout', budgetMs: 750 }) }), true);
    expect(colouringNotes(c)).toEqual({ notes: [EXPORT_TEXT.colouringDropped], metas: [{ name: 'ccrc:colouring', content: 'dropped' }] });
  });

  it('the notes count each class in closed words, in a fixed order, and say nothing when every block is coloured', () => {
    const c: ExportColouring = { coloured: 3, plain: new Map<ExportPlain, number>([['timeout', 2], ['over-cap', 1]]), dropped: false };
    expect(colouringNotes(c)).toEqual({
      notes: ['1 code block left plain: over the block size limit.', '2 code blocks left plain: highlighting took too long.'],
      metas: [{ name: 'ccrc:plain-over-cap', content: '1' }, { name: 'ccrc:plain-timeout', content: '2' }],
    });
    expect(colouringNotes({ coloured: 3, plain: new Map(), dropped: false })).toEqual({ notes: [], metas: [] });
  });

  it('missingNotes counts the images not included, each class in its own meta', () => {
    expect(missingNotes(new Map<ExportMissing, number>([['deferred', 2], ['external', 1]]))).toEqual({
      notes: ['3 images not included.'],
      metas: [{ name: 'ccrc:missing-deferred', content: '2' }, { name: 'ccrc:missing-external', content: '1' }],
    });
    expect(missingNotes(new Map())).toEqual({ notes: [], metas: [] });
  });
});

// ---- Task 5: the builder ------------------------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

const PNG = new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);
const BIG = (n: number): Uint8Array<ArrayBuffer> => { const b = new Uint8Array(n); b.set(PNG); return b; };
const WIDE: ExportLimits = { maxBytes: 1e9, imageWaitMs: 20 };

/** A Markdown body for `src`, parsed in this thread and detached as `DocTree` holds it, on `url`'s leaf of `tree`. */
function treeBody(src: string, tree: DocsTreeOk = treeOk(), url = '/docs/demo/specs/a.md',
  store: HighlightStore = syncTestStore('docs')): Extract<ExportBodyInput, { kind: 'tree' }> {
  const outcome = parseMarkdown(src, 'docs');
  if (outcome.kind !== 'tree') throw new Error(`fixture: ${outcome.kind}`);
  const detached = detachUrls(outcome.tree);
  const page = leafAt(url);
  const link: Omit<DocLinkContextValue, 'urls'> = {
    project: 'demo', pageRef: page.ref, pageAt: null, view: page.view, section: page.section, path: page.path, tree,
    pageSource: pinFor(tree, page)?.kind === 'draft' ? 'draft' : 'committed', onFragment: () => {},
  };
  return { kind: 'tree', tree: detached.tree, urls: detached.urls, link, store };
}

/** An export of `body` from the committed leaf `specs/a.md` of the default tree, unless `over` says otherwise. */
function inputOf(body: ExportBodyInput, over: Partial<ExportInput> = {}): ExportInput {
  const provenance = exportProvenance({
    tree: treeOk(), page: leafAt('/docs/demo/specs/a.md'), pin: committedPin('a.md'), show: null,
    exportedAt: NOW, readAt: NOW, plainView: body.kind === 'tree' || body.kind === 'plain',
  });
  return {
    title: 'a.md', name: exportFilename('demo', committedPin('a.md'), COMMIT_A), theme: null, commit: COMMIT_A,
    provenance, body, assets: null, ...over,
  };
}

async function built(input: ExportInput, limits?: ExportLimits): Promise<{ text: string; doc: Document; result: Extract<ExportResult, { ok: true }> }> {
  const result = await buildExport(input, limits);
  if (!result.ok) throw new Error('expected a file');
  const text = new TextDecoder().decode(result.bytes);
  return { text, doc: new DOMParser().parseFromString(text, 'text/html'), result };
}

const imageKey = (path: string): string =>
  docsApi.file('demo', { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path });
function loaded(assets: ExportAssets, path: string, bytes: Uint8Array<ArrayBuffer> = PNG): void {
  assets.track(imageKey(path)).report({ s: 'loaded', asset: { kind: 'raster', bytes, mime: 'image/png' } });
}

const HOSTILE_H1 = '</title><meta http-equiv=refresh content="0;url=https://a.example/r"><style>.ccrc-export-draft{display:none}</style>';
/** A workspace worktree whose last segment holds markup characters: the closed label carries it as text, never markup. */
const HOSTILE_WORKTREE_PATH = '/repo/wt<b>"x';
const HOSTILE_WORKTREE_LABEL = 'workspace wt<b>"x';
const HOSTILE = [
  `# ${HOSTILE_H1}`,
  '',
  '<script>fetch("https://a.example/s")</script>',
  '',
  '<iframe src="https://a.example/f"></iframe> <form action="https://a.example/x"><button>go</button></form>',
  '',
  'a<br>b<br class=x>c',
  '',
  '[js](javascript:alert(1)) [data](data:text/html,x) [api](/api/docs/demo/file) [far](https://a.example/far) [doc](b.md) [frag](#top)',
  '',
  '![ext](https://a.example/i.png) ![api](/api/x.png) ![local](x.png)',
  '',
  '```bash',
  'echo <b>hi</b>',
  '```',
  '',
  '| left | mid | right | plain |',
  '| :-- | :-: | --: | --- |',
  '| <script>x</script> | [js](javascript:alert(1)) | ![ext](https://a.example/t.png) | <b onclick=x>y</b> |',
  '',
].join('\n');

/** Every `style` attribute of `doc`, each parsed as ONE declaration `text-align: <left|center|right>` (GFM column alignment). */
function styleAttributes(doc: Document): string[] {
  const seen: string[] = [];
  for (const el of doc.querySelectorAll('[style]')) {
    const v = el.getAttribute('style') ?? '';
    const decls = v.split(';').map((d) => d.trim()).filter((d) => d !== '');
    expect(decls, `${el.tagName} style=${v}`).toHaveLength(1);
    const [prop, val, ...rest] = decls[0]!.split(':').map((t) => t.trim());
    expect(rest, v).toEqual([]);
    expect(prop, v).toBe('text-align');
    expect(['left', 'center', 'right'], v).toContain(val);
    expect(['TH', 'TD'], v).toContain(el.tagName);
    seen.push(`${el.tagName}:${val}`);
  }
  return seen;
}

describe('buildExport: one React <html>, inert by construction (spec 4.17; M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18)', () => {
  it('begins with one <!doctype html>, then meta charset, the CSP meta (exactly DOCS_EXPORT_CSP), the title, the metas and one style (M4.EX1)', async () => {
    const { text, doc } = await built(inputOf(treeBody('# A\n\ntext\n')));
    expect(text.startsWith(EXPORT_PREFIX)).toBe(true);
    expect(text.match(/<!doctype/gi)).toHaveLength(1);
    const head = [...doc.head.children];
    expect(head[0]?.getAttribute('charset')).toBe('utf-8');
    expect(head[1]?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(head[1]?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
    expect(head[2]?.tagName).toBe('TITLE');
    expect(head.at(-1)?.tagName).toBe('STYLE');
    expect(head.slice(3, -1).every((e) => e.tagName === 'META' && e.hasAttribute('name'))).toBe(true);
    expect(doc.querySelector('meta[name="generator"]')?.getAttribute('content')).toBe('ccrc-docs-export/1');
  });

  it("DOCS_EXPORT_CSP, re-tokenised: default-src 'none'; no script, connect, frame, child or worker source; no 'self'; exact img, style and font sources (M4.EX1)", () => {
    const directives = new Map(DOCS_EXPORT_CSP.split(';').map((d) => d.trim().split(/\s+/)).filter((t) => t[0] !== '')
      .map((t) => [t[0]!, t.slice(1)] as const));
    expect(directives.get('default-src')).toEqual(["'none'"]);
    for (const banned of ['script-src', 'script-src-elem', 'script-src-attr', 'connect-src', 'frame-src', 'child-src', 'worker-src']) {
      expect(directives.has(banned), banned).toBe(false);
    }
    expect(DOCS_EXPORT_CSP).not.toContain("'self'");
    expect(directives.get('img-src')).toEqual(['data:']);
    expect(directives.get('style-src')).toEqual(["'unsafe-inline'", 'data:']);
    expect(directives.get('font-src')).toEqual(['data:']);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it('is inert over a hostile corpus: no active element, no on* attribute, only closed text-align styles, URLs only where allowed, the banner first (M4.EX2)', async () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified') }), entry('specs', 'b.md'), entry('specs', 'x.png')],
      drafts: holderAt({ path: HOSTILE_WORKTREE_PATH, class: 'workspace' }),
    });
    const url = '/docs/demo/specs/a.md?ref=main';
    const page = leafAt(url);
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture');
    const provenance = exportProvenance({ tree, page, pin, show: null, exportedAt: NOW, readAt: NOW, plainView: true });
    const { doc, text } = await built(inputOf(treeBody(HOSTILE, tree, url), { provenance, title: HOSTILE_H1 }), WIDE);
    for (const tag of ['script', 'iframe', 'object', 'embed', 'base', 'form', 'button', 'svg', 'link']) {
      expect(doc.querySelectorAll(tag), tag).toHaveLength(0);
    }
    for (const el of doc.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) expect(a.startsWith('on'), `${el.tagName} ${a}`).toBe(false);
      for (const a of ['srcset', 'poster', 'cite', 'background', 'action', 'formaction', 'ping', 'data', 'xlink:href']) {
        expect(el.hasAttribute(a), `${el.tagName} ${a}`).toBe(false);
      }
      const src = el.getAttribute('src');
      if (src !== null) {
        expect(el.tagName, src).toBe('IMG');
        expect(src.startsWith('data:image/'), src).toBe(true);
      }
      const href = el.getAttribute('href');
      if (href !== null) {
        expect(el.tagName, href).toBe('A');
        expect(href, href).toMatch(/^(#|https:|http:|mailto:)/);
        expect(href, href).not.toContain('/api/');
      }
    }
    // The table meets the scan: its three aligned columns carry the only style attributes, each text-align in a closed set.
    expect(doc.querySelectorAll('article table')).toHaveLength(1);
    expect(styleAttributes(doc).sort()).toEqual(['TD:center', 'TD:left', 'TD:right', 'TH:center', 'TH:left', 'TH:right']);
    expect(doc.querySelectorAll('article table [style]')).toHaveLength(6);
    expect(doc.querySelector('article table script, article table b')).toBeNull();
    // The worktree segment is text wherever the file shows it: banner, Source fact and the ccrc:worktree meta; no element comes of it.
    expect(doc.querySelectorAll('b')).toHaveLength(0);
    expect(doc.body.firstElementChild?.textContent).toContain(`uncommitted changes from ${HOSTILE_WORKTREE_LABEL} on main`);
    expect(doc.body.textContent).toContain(`draft · modified in ${HOSTILE_WORKTREE_LABEL}`);
    expect(text).not.toContain('/repo/wt');
    // The meta's attribute value, as written: a `"` would end it early, so the raw value (read up to the first `"`)
    // decodes to the whole label only if the quote was escaped, and the raw segment appears nowhere unescaped.
    const raw = /<meta name="ccrc:worktree" content="([^"]*)"/.exec(text);
    expect(raw, 'the ccrc:worktree meta, as written').not.toBeNull();
    const decoded = new DOMParser().parseFromString(`<p title="${raw![1]!}"></p>`, 'text/html').querySelector('p')?.getAttribute('title');
    expect(decoded).toBe(HOSTILE_WORKTREE_LABEL);
    expect(raw![1]).not.toContain('<');
    expect(doc.querySelector('meta[name="ccrc:worktree"]')?.getAttribute('content')).toBe(HOSTILE_WORKTREE_LABEL);
    expect(text).not.toContain('wt<b>');
    expect(doc.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    const style = doc.querySelector('style')?.textContent ?? '';
    expect(style).toBe(EXPORT_CSS);
    expect(style).not.toMatch(/@import|url\(/i);
    expect(doc.body.firstElementChild?.className).toBe('ccrc-export-draft');
    expect(doc.querySelector('title')?.textContent).toBe(HOSTILE_H1);
  });

  it('a git failure the tree carries (its detail and path) is nowhere in the finished file, text or attributes (M4.EX5)', async () => {
    const STDERR = 'fatal: unsafe repository /repo/home-x/user-x/secret-stderr-head (owned by someone else)';
    const drafts: DraftsFacts[] = [
      { state: 'unreadable', branch: 'main', worktree: '/repo/home-x/user-x/wt-x', step: 'status', detail: STDERR },
      { state: 'unreadable', branch: 'main', worktree: null, step: 'worktree-list', detail: STDERR },
      { state: 'ambiguous', branch: 'main', candidates: ['/repo/home-x/user-x/wt-x', '/repo/home-x/user-x/wt-y'] },
      { state: 'untrusted', branch: 'main', worktree: '/repo/home-x/user-x/wt-x', why: 'dubious-ownership' },
    ];
    for (const d of drafts) {
      const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: d });
      const url = '/docs/demo/specs/a.md?ref=main';
      const provenance = exportProvenance({ tree, page: leafAt(url), pin: committedPin('a.md'), show: null, exportedAt: NOW, readAt: NOW, plainView: false });
      const { text } = await built(inputOf(treeBody('# A\n\ntext\n', tree, url), { provenance }), WIDE);
      for (const leak of ['secret-stderr-head', 'unsafe repository', 'fatal:', 'home-x', 'user-x', 'wt-x', 'wt-y', '/repo/']) {
        expect(text, `${d.state}: ${leak}`).not.toContain(leak);
      }
    }
  });

  it('an SVG leaf is exactly one img of a data:image/ URL, never markup (M4.EX2)', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'https://a.example/o\')">'
      + '<script>fetch("https://a.example/s")</script><image href="https://a.example/i.png"/></svg>');
    const { doc } = await built(inputOf({ kind: 'image', alt: 'x.svg', draft: false, image: { kind: 'svg', bytes: svg } }));
    const imgs = doc.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(doc.querySelectorAll('svg, script, image')).toHaveLength(0);
  });

  it('an SVG registry src that is not the data: URL Docs builds becomes a placeholder: no preload link, no https: in the file (M4.EX1, M4.EX2)', async () => {
    const assets = createExportAssets();
    assets.track(imageKey('s.svg')).report({ s: 'loaded', asset: { kind: 'svg', src: 'https://a.example/x.svg' } });
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 's.svg')] });
    const { text, doc } = await built(inputOf(treeBody('![s](s.svg)\n', tree), { assets }), WIDE);
    expect(doc.querySelectorAll('link')).toHaveLength(0);
    expect(text).not.toContain('<link');
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE.failed);
    expect(doc.head.children[1]?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(text.replace(/https:\/\/github\.com\/[^"<\s]*/g, '')).not.toMatch(/https?:/);
  });

  it('a raster leaf is one img of its bytes, typed from the raster table', async () => {
    const { doc } = await built(inputOf({ kind: 'image', alt: 'x.png', draft: false, image: { kind: 'raster', bytes: PNG, mime: 'image/png' } }));
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')?.slice(0, 22))).toEqual(['data:image/png;base64,']);
  });

  it("images come from the page's registry only: loaded ones inline, the rest closed placeholders, no fetch (M4.EX3)", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const assets = createExportAssets();
    loaded(assets, 'x.png');
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png'), entry('specs', 'y.png')] });
    const body = treeBody('![x](x.png) ![y](y.png) ![e](https://a.example/e.png)\n', tree);
    const { doc, result } = await built(inputOf(body, { assets }), WIDE);
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')?.slice(0, 22))).toEqual(['data:image/png;base64,']);
    expect([...doc.querySelectorAll('.ccrc-export-missing')].map((s) => s.textContent))
      .toEqual([EXPORT_MISSING_SENTENCE.failed, EXPORT_MISSING_SENTENCE.external]);
    expect(result.notes).toContain('2 images not included.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an image the page is still loading is awaited, inlined when it lands, a timed-out placeholder when it does not (M4.EX3)', async () => {
    const assets = createExportAssets();
    const hold = assets.track(imageKey('x.png'));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });
    const body = treeBody('![x](x.png)\n', tree);
    setTimeout(() => hold.report({ s: 'loaded', asset: { kind: 'raster', bytes: PNG, mime: 'image/png' } }), 5);
    expect((await built(inputOf(body, { assets }), { maxBytes: 1e9, imageWaitMs: 1000 })).doc.querySelectorAll('img')).toHaveLength(1);
    const slow = createExportAssets();
    slow.track(imageKey('x.png'));
    const { doc } = await built(inputOf(body, { assets: slow }), { maxBytes: 1e9, imageWaitMs: 10 });
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['timed-out']);
  });

  it('an image past the page limit that the page did not load is a deferred placeholder, and the sheet is told (M4.EX3)', async () => {
    const names = Array.from({ length: 31 }, (_, i) => `x${i}.png`);
    const assets = createExportAssets();
    for (const n of names.slice(0, 30)) loaded(assets, n);
    const tree = treeOk({ entries: [entry('specs', 'a.md'), ...names.map((n) => entry('specs', n))] });
    const body = treeBody(names.map((n) => `![${n}](${n})`).join(' ') + '\n', tree);
    const { doc, result } = await built(inputOf(body, { assets }), WIDE);
    expect(doc.querySelectorAll('img')).toHaveLength(30);
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE.deferred);
    expect(result.deferred).toBe(1);
  });

  it('links follow spec 4.17\'s table (M4.EX4)', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md'), entry('specs', 'n.md', { committed: null, draft: draftOf('added') })] });
    const at = { section: 'specs' as const, path: 'a.md', tree };
    expect(exportLinkTarget(at, COMMIT_A, 'b.md#sec')).toEqual({ kind: 'permalink', href: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/b.md` });
    expect(exportLinkTarget(at, COMMIT_A, 'gone.md')).toEqual({ kind: 'inert', title: `not in this listing at ${SHORT_A}` });
    expect(exportLinkTarget(at, COMMIT_A, 'n.md')).toEqual({ kind: 'inert', title: `not in this listing at ${SHORT_A}` });
    expect(exportLinkTarget(at, COMMIT_A, '../../../README.md')).toEqual({ kind: 'permalink', href: `${GH}/blob/${COMMIT_A}/README.md` });
    expect(exportLinkTarget(at, COMMIT_A, '#top')).toEqual({ kind: 'fragment', href: '#top' });
    expect(exportLinkTarget(at, COMMIT_A, 'https://a.example/x')).toEqual({ kind: 'external', href: 'https://a.example/x' });
    expect(exportLinkTarget(at, COMMIT_A, 'mailto:someone').kind).toBe('external');
    expect(exportLinkTarget(at, COMMIT_A, '/api/x')).toEqual({ kind: 'inert', title: DOC_LINK_INERT_SENTENCE['root-relative'] });
    expect(exportLinkTarget(at, COMMIT_A, 'data:text/html,x')).toEqual({ kind: 'inert', title: DOC_LINK_INERT_SENTENCE.data });
    expect(exportLinkTarget({ ...at, tree: { ...tree, github: { state: 'none' } } }, COMMIT_A, 'b.md'))
      .toEqual({ kind: 'inert', title: 'No GitHub link for this project.' });
  });

  it('renders a permalink with rel and no target, an external link in a new tab, and an inert span with no href (M4.EX4)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md')] });
    const { doc } = await built(inputOf(treeBody('[doc](b.md) [far](https://a.example/far) [gone](gone.md)\n', tree)));
    const [doc1, far] = [...doc.querySelectorAll('article a')];
    expect(doc1?.getAttribute('href')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/b.md`);
    expect(doc1?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(doc1?.hasAttribute('target')).toBe(false);
    expect(far?.getAttribute('target')).toBe('_blank');
    expect(far?.getAttribute('rel')).toBe('noopener noreferrer');
    const inert = doc.querySelector('.ccrc-export-inert');
    expect(inert?.tagName).toBe('SPAN');
    expect(inert?.textContent).toBe('gone');
  });

  it('inlines images in document order while the file fits: the first that does not, and every later one, stay out (M4.EX7)', async () => {
    const assets = createExportAssets();
    loaded(assets, 'x.png', BIG(3000));
    loaded(assets, 'y.png', BIG(3000));
    loaded(assets, 'z.png', BIG(10));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png'), entry('specs', 'y.png'), entry('specs', 'z.png')] });
    const body = treeBody('![x](x.png) ![y](y.png) ![z](z.png)\n', tree);
    const all = await built(inputOf(body, { assets }), WIDE);
    expect(all.doc.querySelectorAll('img')).toHaveLength(3);
    const cut = await built(inputOf(body, { assets }), { maxBytes: all.result.size - 2000, imageWaitMs: 20 });
    expect(cut.result.size).toBeLessThanOrEqual(all.result.size - 2000);
    expect([...cut.doc.querySelectorAll('img')].map((i) => i.getAttribute('alt'))).toEqual(['x']);
    expect([...cut.doc.querySelectorAll('.ccrc-export-missing')].map((s) => s.getAttribute('aria-label'))).toEqual(['y', 'z']);
    expect(cut.doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['over-size']);
  });

  it('when the estimate runs low (a long image title), the loop pops the last images until the file fits, and the result stays a prefix (M4.EX7)', async () => {
    const assets = createExportAssets();
    loaded(assets, 'x.png', BIG(3000));
    loaded(assets, 'y.png', BIG(3000));
    loaded(assets, 'z.png', BIG(10));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png'), entry('specs', 'y.png'), entry('specs', 'z.png')] });
    const title = 't'.repeat(400);
    const body = treeBody(`![x](x.png) ![y](y.png "${title}") ![z](z.png)\n`, tree);
    const all = await built(inputOf(body, { assets }), WIDE);
    expect(all.doc.querySelectorAll('img')).toHaveLength(3);
    // Every image's data URL is admitted by the estimate (it counts the src only), but the title makes the real file bigger.
    const limits: ExportLimits = { maxBytes: all.result.size - 1, imageWaitMs: 20 };
    const cut = await built(inputOf(body, { assets }), limits);
    expect(cut.result.size).toBeLessThanOrEqual(limits.maxBytes);
    const imgs = [...cut.doc.querySelectorAll('img')].map((i) => i.getAttribute('alt'));
    const missed = [...cut.doc.querySelectorAll('.ccrc-export-missing')].map((s) => s.getAttribute('aria-label'));
    expect(imgs.length).toBeLessThan(3);
    expect(['x', 'y', 'z'].slice(0, imgs.length)).toEqual(imgs);
    expect(missed).toEqual(['x', 'y', 'z'].slice(imgs.length));
    expect(cut.doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['over-size']);
    expect(cut.result.notes).toContain(`${3 - imgs.length} image${3 - imgs.length === 1 ? '' : 's'} not included.`);
  });

  it('never cuts the body: over the limit it drops colouring, says so and asks nothing; still over, too large (M4.EX7)', async () => {
    const store = syncTestStore('docs');
    // Twenty coloured lines: their spans outweigh the colouring-dropped line the plain file gains.
    const body = treeBody(`\`\`\`bash\n${Array.from({ length: 20 }, () => 'echo hi').join('\n')}\n\`\`\`\n`, treeOk(), '/docs/demo/specs/a.md', store);
    const full = await built(inputOf(body), WIDE);
    expect(full.doc.querySelector('pre code span')).not.toBeNull();
    const dropped = await built(inputOf(body), { maxBytes: full.result.size - 1, imageWaitMs: 20 });
    expect(dropped.doc.querySelector('pre code span')).toBeNull();
    expect(dropped.result.notes).toContain(EXPORT_TEXT.colouringDropped);
    expect(dropped.doc.querySelector('meta[name="ccrc:colouring"]')?.getAttribute('content')).toBe('dropped');
    expect(store.requests).toEqual([]);
    expect(await buildExport(inputOf(body), { maxBytes: 100, imageWaitMs: 20 })).toEqual({ ok: false, why: 'too-large' });
  });

  it('at the real limit, an image that would pass 10 MiB is a placeholder and the file fits (M4.EX7)', async () => {
    const assets = createExportAssets();
    loaded(assets, 'x.png', BIG(8 * 1048576));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });
    const { doc, result } = await built(inputOf(treeBody('![x](x.png)\n', tree), { assets }));
    expect(result.size).toBeLessThanOrEqual(DOCS_EXPORT_MAX_BYTES);
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['over-size']);
  });

  it.each([
    ['light', 'light'], ['nord', 'nord'], ['the dark default', null],
  ])("pins the exporter's palette: %s (M4.EX10; refinement (e))", async (_name, theme) => {
    const { doc } = await built(inputOf(treeBody('# A\n'), { theme }));
    expect(doc.documentElement.getAttribute('data-theme')).toBe(theme);
  });

  it("colours code from the page's store by peek only: no request, no job, every block's HTML the store's (M4.EX18)", async () => {
    const job = vi.spyOn(docsHighlighter, 'highlight');
    const store = syncTestStore('docs');
    const body = treeBody('```bash\necho one\n```\n\n```bash\necho two\n```\n', treeOk(), '/docs/demo/specs/a.md', store);
    const { doc } = await built(inputOf(body));
    const codes = [...doc.querySelectorAll('pre code')];
    expect(codes).toHaveLength(2);
    for (const [i, raw] of ['echo one', 'echo two'].entries()) {
      const entryOf = store.peek(`bash\u0000${raw}`);
      if (entryOf.kind !== 'html') throw new Error('fixture: not coloured');
      expect(codes[i]?.innerHTML).toBe(entryOf.checked.html);
    }
    expect(store.requests).toEqual([]);
    expect(job).not.toHaveBeenCalled();
  });

  it("a later copy of one block that the page skipped is drawn plain by its own pre, and counted once as a page ceiling (M4.EX18)", async () => {
    const probe = treeBody('```bash\necho one\n```\n\n```bash\necho one\n```\n');
    const second = codeBlocksOf(probe.tree)[1]?.at;
    if (second === undefined) throw new Error('fixture: no second block');
    const store: HighlightStore = { ...syncTestStore('docs'), copySkip: (at) => (at === second ? 'page-output' : null) };
    const { doc, result } = await built(inputOf({ ...probe, store }));
    const codes = [...doc.querySelectorAll('article pre code')];
    expect(codes).toHaveLength(2);
    expect(codes[0]?.querySelector('span')).not.toBeNull();
    expect(codes[1]?.querySelector('span')).toBeNull();
    const labels = [...doc.querySelectorAll('.code-block-lang')].map((l) => l.textContent ?? '');
    expect(labels[1]?.endsWith('(page highlighting limit)')).toBe(true);
    expect(labels[0]?.endsWith('(page highlighting limit)')).toBe(false);
    expect(doc.querySelector('meta[name="ccrc:plain-page-ceiling"]')?.getAttribute('content')).toBe('1');
    expect(result.notes.some((n) => n.startsWith('1 code block left plain'))).toBe(true);
  });

  it('a draft image is captioned "draft", and the banner of a draft file says how many uncommitted images it embeds (spec 4.17 "The banner", "Images")', async () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified') }), entry('specs', 'x.png', { draft: draftOf('modified') }),
        entry('specs', 'y.png')],
      drafts: holder(),
    });
    const url = '/docs/demo/specs/a.md?ref=main';
    const page = leafAt(url);
    const pin = pinFor(tree, page);
    const xPin = pinFor(tree, leafAt('/docs/demo/specs/x.png?ref=main'));
    if (pin === null || xPin === null) throw new Error('fixture');
    expect(xPin.kind).toBe('draft');
    const provenance = exportProvenance({ tree, page, pin, show: null, exportedAt: NOW, readAt: NOW, plainView: true });
    const assets = createExportAssets();
    const raster = { s: 'loaded', asset: { kind: 'raster', bytes: PNG, mime: 'image/png' } } as const;
    assets.track(docsApi.file('demo', xPin)).report(raster);
    const yPin = pinFor(tree, leafAt('/docs/demo/specs/y.png?ref=main'));
    if (yPin === null) throw new Error('fixture');
    assets.track(docsApi.file('demo', yPin)).report(raster);
    const { doc } = await built(inputOf(treeBody('![x](x.png) ![y](y.png)\n', tree, url), { provenance, assets }), WIDE);
    expect(doc.querySelectorAll('article img')).toHaveLength(2);
    const captions = [...doc.querySelectorAll('.ccrc-export-caption')];
    expect(captions.map((c) => c.textContent)).toEqual([DOC_IMAGE_TEXT.draft]);
    expect(captions[0]?.previousElementSibling?.getAttribute('alt')).toBe('x');
    const banner = doc.querySelector('.ccrc-export-draft')?.textContent ?? '';
    expect(banner.endsWith(fillSentence(EXPORT_TEXT.bannerImages, { k: 1, s: '' }))).toBe(true);
    const noImages = await built(inputOf(treeBody('# A\n', tree, url), { provenance }), WIDE);
    expect(noImages.doc.querySelector('.ccrc-export-draft')?.textContent).not.toContain('uncommitted image');
  });

  it('a draft raster leaf carries the "draft" caption after its image', async () => {
    const { doc } = await built(inputOf({ kind: 'image', alt: 'x.png', draft: true, image: { kind: 'raster', bytes: PNG, mime: 'image/png' } }));
    expect(doc.querySelector('.ccrc-export-caption')?.textContent).toBe(DOC_IMAGE_TEXT.draft);
    expect(doc.querySelector('img')?.nextElementSibling?.className).toBe('ccrc-export-caption');
  });

  it("a worker's hostile HTML is refused on receipt, and a forged plain string is drawn as text: either way plain, counted failed (M4.EX18)", async () => {
    const hostile: Highlighter = {
      highlight: async () => ({ kind: 'html', html: '<img src=x onerror=alert(1)>', mode: 'block' }),
      status: () => 'live', prewarm: () => undefined,
    };
    const src = '```bash\necho one\n```\n';
    const probe = treeBody(src);
    const real = createHighlightStore(hostile, { mode: 'docs' }, FROZEN_CLOCK);
    real.seed(codeBlocksOf(probe.tree));
    real.request('bash\u0000echo one');
    await vi.waitFor(() => expect(real.settled()).toBe(true));
    const forged: HighlightStore = {
      ...syncTestStore('docs'),
      peek: () => ({ kind: 'html', mode: 'block', checked: { html: '<img src=x onerror=alert(1)>' } as CheckedHighlightHtml }),
    };
    for (const store of [real, forged]) {
      const { doc } = await built(inputOf({ ...probe, store }));
      expect(doc.querySelectorAll('img')).toHaveLength(0);
      expect(doc.querySelector('pre code')?.textContent).toBe('echo one');
      expect(doc.querySelector('meta[name="ccrc:plain-failed"]')?.getAttribute('content')).toBe('1');
    }
  });

  it('a text leaf exports its one block from its store, or plain text when no grammar matched; a plain body keeps its note', async () => {
    const store = syncTestStore('docs');
    const coloured = await built(inputOf({ kind: 'text', text: 'echo hi\n', lang: 'bash', store }));
    const entryOf = store.peek('bash\u0000echo hi');
    if (entryOf.kind !== 'html') throw new Error('fixture: not coloured');
    expect(coloured.doc.querySelector('pre code')?.innerHTML).toBe(entryOf.checked.html);
    const bare = await built(inputOf({ kind: 'text', text: 'a\nb\n', lang: null, store: null }));
    expect(bare.doc.querySelector('pre.ccrc-export-plain')?.textContent).toBe('a\nb\n');
    const plain = await built(inputOf({ kind: 'plain', text: '# not formatted', note: 'Formatting took longer than 2 s; shown as plain text.' }));
    expect(plain.doc.querySelector('.ccrc-export-note')?.textContent).toBe('Formatting took longer than 2 s; shown as plain text.');
    expect(plain.doc.querySelector('pre.ccrc-export-plain')?.textContent).toBe('# not formatted');
  });
});

// ---- Completion plan Task 9 (C2): the builder's mockup arm, over the real snapshot --------------------------------------

/** A file's reply: its bytes (or text), a failure word, or `STALL`, a read that never answers (an asset still loading). */
type MockupFiles = Record<string, Uint8Array<ArrayBuffer> | string | { failed: string } | typeof STALL>;
const STALL = Symbol('a read that never answers');
const lenOfFile = (f: MockupFiles[string]): number => (typeof f === 'string' ? f.length : f instanceof Uint8Array ? f.length : 1);
const specsRepo = (name: string): string => `docs/superpowers/specs/${name}`;
const NO_LIMIT: ExportLimits = { maxBytes: 1e9, imageWaitMs: 1000 };

interface MockupOpts {
  /** The page is opened as a draft (`?ref=main`, a draft row for `m.html`). */
  readonly draftPage?: boolean;
  /** Assets that also have a draft side (a draft page opens them as drafts). */
  readonly draftAssets?: readonly string[];
  /** How the attempt's load ends: `ended` (aborted); the default is the real load over the fake reader. */
  readonly end?: 'ended';
  /** A change to the loaded result (a hostile MIME on a loaded entry). */
  readonly edit?: (r: MockupAssetResult) => MockupAssetResult;
  /** More listed files (a link target's document). */
  readonly more?: readonly string[];
}

/** The page parsed by the real parser, planned and loaded over a fake reader, and handed to `exportInputOf` as the header
 *  would, for the leaf `specs/m.html`. */
async function mockupRequest(html: string, files: MockupFiles = {}, o: MockupOpts = {}): Promise<ExportRequest> {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('the pre-scan refused the fixture');
  const entries = [
    entry('specs', 'm.html', o.draftPage === true ? { draft: draftOf('modified') } : {}),
    ...Object.entries(files).map(([path, f]) => entry('specs', path, {
      committed: { kind: 'file', blob: BLOB_1, size: lenOfFile(f) },
      ...(o.draftAssets?.includes(path) === true ? { draft: draftOf('modified', { size: lenOfFile(f) }) } : {}),
    })),
    ...(o.more ?? []).map((path) => entry('specs', path)),
  ];
  const tree = treeOk({ entries, drafts: holder() });
  const page = leafAt(o.draftPage === true ? '/docs/demo/specs/m.html?ref=main' : '/docs/demo/specs/m.html');
  const pin = pinFor(tree, page);
  if (pin === null) throw new Error('fixture');
  const plan = planMockupAssets(extractMockupRefs(parsed.doc, 'specs/m.html').refs, { project: 'demo', pin, tree });
  const reader: MockupAssetReader = {
    read: async (p) => {
      const f = files[p.path];
      if (f === undefined) return { kind: 'failed', failure: 'not-found' };
      if (f === STALL) return new Promise<never>(() => {});
      if (typeof f === 'string') return { kind: 'ok', bytes: new TextEncoder().encode(f) };
      return f instanceof Uint8Array ? { kind: 'ok', bytes: f } : { kind: 'failed', failure: f.failed };
    },
  };
  // The view's own wiring (`MockupView`): the real load, its end, and `now`, the load as it stands.
  const load = startMockupLoad(plan, reader, new AbortController().signal);
  const loadedEnd = load.result
    .then((result): MockupLoadEnd => ({ s: 'loaded', result: o.edit === undefined ? result : o.edit(result) }));
  const settled = o.end === 'ended' ? Promise.resolve<MockupLoadEnd>({ s: 'ended' }) : loadedEnd;
  return {
    page, tree, assets: null, readAt: NOW,
    source: { kind: 'mockup', pin, show: fileResponse(html).show, doc: parsed.doc, assets: { plan, settled, now: load.now } },
  };
}

async function mockupInput(html: string, files: MockupFiles = {}, o: MockupOpts = {}): Promise<ExportInput> {
  return exportInputOf(await mockupRequest(html, files, o), { exportedAt: NOW, theme: null });
}

async function builtMockup(html: string, files: MockupFiles = {}, o: MockupOpts = {}, limits: ExportLimits = NO_LIMIT) {
  const b = await built(await mockupInput(html, files, o), limits);
  const frames = b.doc.querySelectorAll('iframe');
  const srcdoc = frames[0]?.getAttribute('srcdoc') ?? '';
  return { ...b, srcdoc, inner: new DOMParser().parseFromString(srcdoc, 'text/html') };
}

const mockupPage = (body: string, head = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const listOf = (doc: Document, label: string): string[] =>
  [...doc.querySelectorAll(`section[aria-label="${label}"] li`)].map((li) => li.textContent ?? '');

describe('buildExport: the mockup arm (spec 5.6.9; completion plan Task 9; M5.EX1, M5.EX5, M5.EX7)', () => {
  it('the file has exactly one iframe, sandbox="", whose srcdoc is the inner document with the CSP meta first in head (M5.EX1)', async () => {
    const { text, doc, inner, srcdoc } = await builtMockup(mockupPage('<h1>Title</h1><p id="p">body</p>'));
    expect(text.startsWith(EXPORT_PREFIX)).toBe(true);
    expect(text.match(/<iframe/gi)).toHaveLength(1);
    expect(text.match(/srcdoc=/gi)).toHaveLength(1);
    const frames = doc.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.hasAttribute('sandbox')).toBe(true);
    expect(frames[0]?.getAttribute('sandbox')).toBe('');
    expect(frames[0]?.getAttribute('title')).toBe('Snapshot of m.html');
    expect(srcdoc.startsWith(EXPORT_PREFIX)).toBe(true);
    const first = inner.head.firstElementChild;
    expect(first?.tagName).toBe('META');
    expect(first?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(first?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
    expect(inner.getElementById('p')?.textContent).toBe('body');
    // The wrapper holds its own CSP meta first after the charset, and the one doctype.
    expect(doc.head.children[1]?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
    expect(doc.querySelector('.ccrc-export-facts dt')?.textContent).toBe('Project');
  });

  it('carries the provenance and the draft banner as wrapper chrome, outside the frame, on a draft page', async () => {
    const { doc } = await builtMockup(mockupPage('<p>x</p>'), {}, { draftPage: true });
    const banner = doc.body.firstElementChild;
    expect(banner?.className).toBe('ccrc-export-draft');
    expect(banner?.textContent).toContain('Draft, not committed.');
    expect(doc.querySelector('iframe')?.closest('.ccrc-export-draft')).toBeNull();
    const committed = await builtMockup(mockupPage('<p>x</p>'));
    expect(committed.doc.querySelector('.ccrc-export-draft')).toBeNull();
    // The notes name what rests on the file's own policy.
    expect([...committed.doc.querySelectorAll('.ccrc-export-notes li')].map((l) => l.textContent)).toContain(EXPORT_TEXT.mockupCss);
  });

  it('lists each inlined file by repo path, size and committed or draft, one the author hides on screen included, and each asset left out (M5.EX5)', async () => {
    const html = mockupPage(
      '<img id="a" src="a.png" alt="a"><img id="h" class="hide" src="hidden.png" alt="h"><img id="g" src="gone.png" alt="g"><img id="x" src="https://x.example/p.png">',
      '<style>.hide { display: none }</style>',
    );
    const { doc, inner, result } = await builtMockup(html, { 'a.png': BIG(1500), 'hidden.png': BIG(10) }, { draftPage: true, draftAssets: ['hidden.png'] });
    expect(listOf(doc, EXPORT_TEXT.mockupInlined)).toEqual([
      `${specsRepo('a.png')} (2 KiB, committed)`, `${specsRepo('hidden.png')} (1 KiB, uncommitted draft)`,
    ]);
    expect(listOf(doc, EXPORT_TEXT.mockupOmitted)).toEqual([specsRepo('gone.png'), 'https://x.example/p.png']);
    expect(inner.getElementById('h')?.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true);
    expect(inner.getElementById('g')?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.refused);
    expect(result.mockup).toEqual({
      inlined: [{ path: specsRepo('a.png'), size: 1500, draft: false }, { path: specsRepo('hidden.png'), size: 10, draft: true }],
      omitted: [specsRepo('gone.png'), 'https://x.example/p.png'],
    });
  });

  it('lists the links as escaped text, through the link table: a hostile target is text, never markup (spec 5.6.9 step 5)', async () => {
    const hostile = 'https://link.example/q?a=1&b="<b>x</b>';
    const html = mockupPage(
      `<a id="e" href="${hostile.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">far</a> <a id="d" href="other.md#x">doc</a> `
      + '<a id="n" href="gone.md">gone</a> <a id="f" href="#top">frag</a> <a id="j" href="javascript:alert(1)">js</a>',
    );
    const { doc, inner, text } = await builtMockup(html, {}, { more: ['other.md'] });
    expect(listOf(doc, EXPORT_TEXT.mockupLinks)).toEqual([hostile, 'other.md#x', 'gone.md', '#top', 'javascript:alert(1)']);
    expect(doc.querySelectorAll('section[aria-label="Links in this page"] b')).toHaveLength(0);
    const [far, d, gone, frag, js] = [...doc.querySelectorAll('section[aria-label="Links in this page"] li')];
    expect(far?.querySelector('a')?.getAttribute('href')).toBe(new URL(hostile).href);
    expect(far?.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(d?.querySelector('a')?.getAttribute('href')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/other.md`);
    expect(d?.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(gone?.querySelector('a')).toBeNull();
    expect(gone?.querySelector('.ccrc-export-inert')?.getAttribute('title')).toBe(`not in this listing at ${SHORT_A}`);
    expect(frag?.querySelector('a')).toBeNull();
    expect(js?.querySelector('a')).toBeNull();
    // As written in the file: escaped, so the raw text never forms an element.
    expect(text).toContain('a=1&amp;b=&quot;&lt;b&gt;x&lt;/b&gt;');
    expect(text).not.toContain('b="<b>');
    // Inside the frame no link keeps an href, and its target moved into title.
    expect(inner.querySelectorAll('a[href], area[href]')).toHaveLength(0);
    expect(inner.getElementById('e')?.getAttribute('title')).toBe(hostile);
  });

  it('the cap is the FINAL file\'s bytes: with a page heavy in " and & and assets totalling MOCKUP_MAX_ASSET_BYTES, the file fits and later assets are omitted in DOM order, each listed (M5.EX7)', async () => {
    const names = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
    const one = MOCKUP_MAX_ASSET_BYTES / names.length;
    const files: MockupFiles = Object.fromEntries(names.map((n) => [n, BIG(one)]));
    const html = mockupPage(`<p>${'&"'.repeat(60_000)}</p>${names.map((n) => `<img id="${n[0]}" src="${n}" alt="${n[0]}">`).join('')}`);
    const maxBytes = 3_500_000;
    const { result, doc, inner } = await builtMockup(html, files, {}, { maxBytes, imageWaitMs: 1000 });
    expect(result.size).toBe(result.bytes.length);
    expect(result.size).toBeLessThanOrEqual(maxBytes);
    // Measured before it is escaped into the attribute, the inner document with a second asset would have fit.
    const url = 'data:image/png;base64,'.length + 4 * Math.ceil(one / 3);
    expect(inner.documentElement.outerHTML.length + url).toBeLessThan(maxBytes);
    const srcs = ['a', 'b', 'c', 'd', 'e'].map((id) => inner.getElementById(id)?.getAttribute('src') ?? null);
    expect(srcs.map((s) => s?.startsWith('data:image/png;base64,') ?? false)).toEqual([true, false, false, false, false]);
    for (const id of ['b', 'c', 'd', 'e']) expect(inner.getElementById(id)?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['over-size']);
    expect(listOf(doc, EXPORT_TEXT.mockupInlined)).toEqual([`${specsRepo('a.png')} (${Math.ceil(one / 1024)} KiB, committed)`]);
    expect(listOf(doc, EXPORT_TEXT.mockupOmitted)).toEqual(['b.png', 'c.png', 'd.png', 'e.png'].map(specsRepo));
  }, 120_000);

  // Review I1: a file is omitted only when NONE of its uses was written; the builder derives the inlined list, and so the
  // draft count that makes Save ask, from the files it handed in minus `omitted`.
  const FIVE_USES = mockupPage(
    ['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => `<img id="${id}" src="big.png" alt="${id}">`).join(''),
  );

  it('a draft image used five times, three of them written under the size bound, is listed as inlined and counts as a draft (review I1)', async () => {
    const { result, inner } = await builtMockup(FIVE_USES, { 'big.png': BIG(2 * 1024 * 1024) }, { draftPage: true, draftAssets: ['big.png'] });
    expect(inner.querySelectorAll('img[src^="data:image/png;base64,"]')).toHaveLength(3);
    expect(result.mockup).toEqual({
      inlined: [{ path: specsRepo('big.png'), size: 2 * 1024 * 1024, draft: true }],
      omitted: [],
    });
  }, 120_000);

  it('the sheet\'s first Save tap on that file shows the draft confirm and saves nothing (review I1)', async () => {
    const request = await mockupRequest(FIVE_USES, { 'big.png': BIG(2 * 1024 * 1024) }, { draftPage: true, draftAssets: ['big.png'] });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ExportSheet request={request} onClose={() => {}} load={async () => ({ buildExport })} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Save / }, { timeout: 60_000 }));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByText('This file includes 1 uncommitted file from main checkout.')).toBeInTheDocument();
  }, 120_000);

  it('a stylesheet cut by the size bound lists its nested file as omitted too, never as inlined (review I1)', async () => {
    const MIB = 1024 * 1024;
    const html = mockupPage(
      `${['i1', 'i2', 'i3'].map((id) => `<img id="${id}" src="big.png" alt="${id}">`).join('')}<link rel="stylesheet" href="s.css">`,
    );
    const { result } = await builtMockup(html, { 'big.png': BIG(2 * MIB), 's.css': 'p{background:url(bg.png)}', 'bg.png': BIG(2 * MIB) });
    expect(result.mockup?.inlined.map((f) => f.path)).toEqual([specsRepo('big.png')]);
    expect(result.mockup?.omitted).toEqual([specsRepo('s.css'), specsRepo('bg.png')]);
  }, 120_000);

  it('the provenance says how many diagrams appear as source: "2 diagrams", "1 diagram", and nothing when there are none (base 5.6.9; review minor 6)', async () => {
    const diagrams = (n: number): string => mockupPage(
      '<h1>T</h1>' + Array.from({ length: n }, (_, i) => `<pre class="mermaid">graph TD; A${i}-->B</pre>`).join(''),
    );
    const noteIn = (b: Awaited<ReturnType<typeof builtMockup>>): string[] =>
      [...b.doc.querySelectorAll('.ccrc-export-notes li')].map((l) => l.textContent ?? '');
    const two = await builtMockup(diagrams(2));
    expect(noteIn(two)).toContain('2 diagrams appear as source');
    expect(two.result.notes).toContain('2 diagrams appear as source');
    const one = await builtMockup(diagrams(1));
    expect(noteIn(one)).toContain('1 diagram appears as source');
    expect(one.result.notes).toContain('1 diagram appears as source');
    const none = await builtMockup(diagrams(0));
    expect(noteIn(none).some((n) => /as source/.test(n))).toBe(false);
    expect(none.result.notes.some((n) => /as source/.test(n))).toBe(false);
    // The note is the closed word, filled with the count only.
    expect(fillSentence(EXPORT_TEXT.mockupDiagrams, { m: 3, s: 's', es: '' })).toBe('3 diagrams appear as source');
  });

  it('the size cut keeps assets in document order: a stylesheet first on the page, with its nested file, is kept before the page images that come later (review minor 7)', async () => {
    // A stylesheet's nested file sits right after the stylesheet's own use, as the srcdoc build orders uses; the plan lists
    // the nested file after every page use. Room for the stylesheet with its background and one more file at most.
    const html = mockupPage(
      '<img id="a" src="a.png" alt="a"><img id="b" src="b.png" alt="b"><img id="c" src="c.png" alt="c">',
      '<link rel="stylesheet" href="s.css">',
    );
    const files: MockupFiles = { 's.css': 'p{background:url(bg.png)}', 'bg.png': BIG(200_000), 'a.png': BIG(200_000), 'b.png': BIG(200_000), 'c.png': BIG(200_000) };
    const whole = await builtMockup(html, files);
    const one = await builtMockup(html, { ...files, 'bg.png': BIG(100), 'a.png': BIG(100), 'b.png': BIG(100), 'c.png': BIG(100) });
    const maxBytes = one.result.size + 360_000;
    expect(whole.result.size).toBeGreaterThan(maxBytes);
    const { result, inner } = await builtMockup(html, files, {}, { maxBytes, imageWaitMs: 1000 });
    expect(result.size).toBeLessThanOrEqual(maxBytes);
    expect(result.mockup?.inlined.map((f) => f.path)).toEqual([specsRepo('s.css'), specsRepo('bg.png')]);
    expect(result.mockup?.omitted).toEqual(['a.png', 'b.png', 'c.png'].map(specsRepo));
    expect(inner.querySelector('link')?.getAttribute('href')?.startsWith('data:text/css;base64,')).toBe(true);
    for (const id of ['a', 'b', 'c']) expect(inner.getElementById(id)?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['over-size']);
  }, 60_000);

  it('an attempt whose settled REJECTS reads as ended: every asset is listed as did-not-load, and the build neither throws nor waits out the clock (review minor 8)', async () => {
    const input = await mockupInput(mockupPage('<img id="a" src="a.png" alt="a">'), { 'a.png': BIG(100) });
    if (input.body.kind !== 'mockup') throw new Error('not a mockup');
    const rejecting: ExportInput = {
      ...input, body: { ...input.body, assets: { ...input.body.assets, settled: Promise.reject(new Error('the load failed')) } },
    };
    const { result, inner } = await built(rejecting, { maxBytes: 1e9, imageWaitMs: 60_000 }).then((b) => ({
      result: b.result, inner: new DOMParser().parseFromString(b.doc.querySelector('iframe')?.getAttribute('srcdoc') ?? '', 'text/html'),
    }));
    expect(inner.getElementById('a')?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.failed);
    expect(result.mockup?.inlined).toEqual([]);
    expect(result.mockup?.omitted).toEqual([specsRepo('a.png')]);
  }, 10_000);

  it('a stripped body that is over the limit on its own gives too-large; one with room for no asset lists every asset as left out', async () => {
    const html = mockupPage(`<p>${'x'.repeat(100_000)}</p><img src="a.png" alt="a">`);
    const input = await mockupInput(html, { 'a.png': BIG(3000) });
    expect(await buildExport(input, { maxBytes: 50_000, imageWaitMs: 1000 })).toEqual({ ok: false, why: 'too-large' });
    const full = await builtMockup(html, { 'a.png': BIG(3000) });
    const room = await builtMockup(html, { 'a.png': BIG(3000) }, {}, { maxBytes: full.result.size - 1000, imageWaitMs: 1000 });
    expect(room.result.mockup?.inlined).toEqual([]);
    expect(room.result.mockup?.omitted).toEqual([specsRepo('a.png')]);
    expect(room.inner.querySelector('img')?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['over-size']);
  });

  it('a wait that passes imageWaitMs keeps every asset that has loaded and words only the ones still loading (base decision 3, 4.17; review 2361 F2)', async () => {
    const html = mockupPage('<img id="a" src="a.png" alt="a"><img id="b" src="b.png" alt="b"><img id="c" src="c.png" alt="c">');
    const partial = await builtMockup(html, { 'a.png': BIG(100), 'b.png': STALL, 'c.png': BIG(100) }, {}, { maxBytes: 1e9, imageWaitMs: 50 });
    for (const id of ['a', 'c']) expect(partial.inner.getElementById(id)?.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true);
    expect(partial.inner.getElementById('b')?.hasAttribute('src')).toBe(false);
    expect(partial.inner.getElementById('b')?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['timed-out']);
    expect(partial.result.mockup?.inlined.map((f) => f.path)).toEqual([specsRepo('a.png'), specsRepo('c.png')]);
    expect(partial.result.mockup?.omitted).toEqual([specsRepo('b.png')]);
    // Nothing loaded yet: every asset is still loading, never "no room left".
    const stalled = await builtMockup(html, { 'a.png': STALL, 'b.png': STALL, 'c.png': STALL }, {}, { maxBytes: 1e9, imageWaitMs: 15 });
    for (const id of ['a', 'b', 'c']) {
      expect(stalled.inner.getElementById(id)?.hasAttribute('src')).toBe(false);
      expect(stalled.inner.getElementById(id)?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['timed-out']);
    }
    expect(stalled.result.mockup?.inlined).toEqual([]);
    expect(stalled.result.mockup?.omitted).toEqual(['a.png', 'b.png', 'c.png'].map(specsRepo));
    const ended = await builtMockup(html, { 'a.png': BIG(100), 'b.png': BIG(100), 'c.png': BIG(100) }, { end: 'ended' });
    expect(ended.inner.getElementById('a')?.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.failed);
    expect(ended.result.mockup?.inlined).toEqual([]);
  });

  it('an attempt that settles inside the wait is inlined; the wait is awaited, not polled', async () => {
    const input = await mockupInput(mockupPage('<img id="a" src="a.png" alt="a">'), { 'a.png': BIG(100) });
    const { inner } = await built(input, { maxBytes: 1e9, imageWaitMs: 5000 }).then((b) => ({
      inner: new DOMParser().parseFromString(b.doc.querySelector('iframe')?.getAttribute('srcdoc') ?? '', 'text/html'),
    }));
    expect(inner.getElementById('a')?.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('a page the pre-scan refused exports its source as <pre> text with the refused-export note, and no frame (spec 5.6.9 step 1)', async () => {
    const source = '<!doctype html><div>'.repeat(3) + '<p>source & "text"</p>';
    const { doc } = await built(inputOf({ kind: 'plain', text: source, note: EXPORT_TEXT.mockupRefused }), WIDE);
    expect(doc.querySelector('.ccrc-export-note')?.textContent).toBe('This page was too complex to render, so this file holds its source as text.');
    expect(doc.querySelector('pre.ccrc-export-plain')?.textContent).toBe(source);
    expect(doc.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('inlines with the table\'s MIME for the row, never a type the loaded entry carries (M5.EX1 through the builder)', async () => {
    const edit = (r: MockupAssetResult): MockupAssetResult =>
      ({ ...r, assets: new Map([...r.assets].map(([k, v]) => [k, { ...v, mime: 'text/html' }])) });
    const { inner } = await builtMockup(mockupPage('<img id="a" src="a.png" alt="a">'), { 'a.png': BIG(50) }, { edit });
    const src = inner.getElementById('a')?.getAttribute('src') ?? '';
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
    expect(src).not.toContain('text/html');
  });

  it('never carries a script, an on* attribute or an external URL, in the wrapper or the frame, over planted ones (M5.EX1 through the builder)', async () => {
    const html = mockupPage(
      '<script>fetch("https://x.example/s")</script><script src="https://x.example/s.js"></script>'
      + '<p id="p" onclick="fetch(\'https://x.example/o\')" onmouseover="x()">t</p>'
      + '<img id="i" src="https://x.example/p.png" alt="i"><iframe srcdoc="<p>n</p>" src="https://x.example/f"></iframe>'
      + '<a id="a" href="https://link.example/l" ping="https://x.example/ping">l</a><form action="https://x.example/f"><button formaction="https://x.example/g">b</button></form>'
      + '<svg><image href="https://x.example/i.png"/><use href="https://x.example/u.svg#a"/></svg>',
      '<link rel="prefetch" href="https://x.example/l"><meta http-equiv="refresh" content="0;url=https://x.example/r"><base href="https://x.example/">'
      + '<style>p { background: url(https://x.example/b.png) } @import url(https://x.example/a.css);</style>',
    );
    const { doc, inner, srcdoc } = await builtMockup(html);
    for (const d of [doc, inner]) {
      expect(d.querySelectorAll('script'), 'script').toHaveLength(0);
      for (const el of d.querySelectorAll('*')) {
        for (const a of el.getAttributeNames()) {
          if (el.tagName === 'IFRAME' && (a === 'srcdoc' || a === 'sandbox' || a === 'title' || a === 'style')) continue;
          expect(a.startsWith('on'), `${el.tagName} ${a}`).toBe(false);
          expect(el.getAttribute(a), `${el.tagName} ${a}`).not.toContain('x.example');
        }
      }
    }
    expect(doc.querySelectorAll('iframe')).toHaveLength(1);
    expect(inner.querySelectorAll('iframe, object, embed, base, link')).toHaveLength(0);
    expect(inner.querySelectorAll('[action], [formaction], [ping], [href]:not(a), svg image[href], svg use[href]')).toHaveLength(0);
    expect(inner.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
    expect(srcdoc).not.toContain('x.example');
    expect(srcdoc).not.toMatch(/<script/i);
    // The link's target: not in an attribute of the frame (only its title), and listed once outside it.
    expect(inner.getElementById('a')?.hasAttribute('href')).toBe(false);
    expect(listOf(doc, EXPORT_TEXT.mockupLinks)).toEqual(['https://link.example/l']);
  });
});

describe('exportStateFor for a mockup, class html (spec 4.17 "When it is offered"; M5.EX6)', () => {
  const tree = treeOk({ entries: [entry('specs', 'm.html')] });
  const HTML = '<p>m</p>';
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  const assets = { plan: {} as never, settled: Promise.resolve<MockupLoadEnd>({ s: 'ended' }), now: (): never => { throw new Error('not read here'); } };
  const page = leafAt('/docs/demo/specs/m.html');
  const pin = pinFor(tree, page);
  if (pin === null) throw new Error('fixture');
  const file = (over: Partial<FileSlot> = {}): FileSlot =>
    ({ s: 'ok', pin, answer: { ...fileResponse(HTML), contentClass: 'html' }, receivedAt: 0, ...over }) as FileSlot;
  const state = (body: ExportBody | null, p = page, t = tree, f: FileSlot = file()) =>
    exportStateFor(p, t, f, { body, store: null, settled: true, assets: null });

  it('no body is disabled "Preparing…"; the gate is disabled "Render the mockup first"', () => {
    expect(state(null)).toEqual({ s: 'waiting', why: 'preparing' });
    expect(EXPORT_WAIT_TEXT.preparing).toBe('Preparing…');
    expect(state(GATE_BODY)).toEqual({ s: 'waiting', why: 'render-first' });
    expect(EXPORT_WAIT_TEXT['render-first']).toBe('Render the mockup first');
  });

  it('a plain body or a mockup body for the shown text is ready, with the body\'s own objects', () => {
    const plain: ExportBody = { kind: 'plain', text: HTML, note: EXPORT_TEXT.mockupRefused };
    const ready = state(plain);
    expect(ready).toMatchObject({ s: 'ready', source: { kind: 'plain', pin, body: plain } });
    const mockup: ExportBody = { kind: 'mockup', text: HTML, doc, assets };
    const m = state(mockup);
    expect(m.s).toBe('ready');
    if (m.s !== 'ready' || m.source.kind !== 'mockup') throw new Error('not a mockup source');
    expect(m.source.doc).toBe(doc);
    expect(m.source.assets).toBe(assets);
    expect(m.source.pin).toBe(pin);
  });

  it('a body for other text, or another kind of body, is "Preparing…" again', () => {
    expect(state({ kind: 'plain', text: 'other', note: 'n' })).toEqual({ s: 'waiting', why: 'preparing' });
    expect(state({ kind: 'mockup', text: 'other', doc, assets })).toEqual({ s: 'waiting', why: 'preparing' });
    expect(state(READER_BODY)).toEqual({ s: 'waiting', why: 'preparing' });
    expect(state({ kind: 'text', text: HTML, lang: null })).toEqual({ s: 'waiting', why: 'preparing' });
  });

  it('frame=full, a file slot with no answer, the class cap and a file at another pin keep the rules every class has', () => {
    const mockup: ExportBody = { kind: 'mockup', text: HTML, doc, assets };
    expect(state(mockup, { ...page, frame: 'full' })).toEqual({ s: 'absent' });
    expect(state(mockup, page, tree, { s: 'too-large', pin, size: 9, cap: 8 })).toEqual({ s: 'absent' });
    expect(state(mockup, page, tree, { s: 'loading', pin })).toMatchObject({ s: 'updating' });
    expect(state(mockup, page, tree, { s: 'none' })).toMatchObject({ s: 'updating' });
    const moved = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'm.html')] });
    expect(state(mockup, page, moved)).toMatchObject({ s: 'updating', to: COMMIT_B });
    const version = leafAt(`/docs/demo/specs/m.html?at=${COMMIT_B}`);
    const versionPin = pinFor(tree, version);
    if (versionPin === null) throw new Error('fixture');
    expect(state(mockup, version, tree, file({ pin: versionPin }))).toMatchObject({ s: 'ready', source: { kind: 'mockup', pin: { commit: COMMIT_B } } });
    expect(state(mockup, version)).toMatchObject({ s: 'updating' });
  });

  it('a class other leaf still offers no Export', () => {
    const other = treeOk({ entries: [entry('specs', 'o.pdf')] });
    const p = pageAt('/docs/demo/specs/o.pdf');
    expect(exportStateFor(p, other, { s: 'none' }, { body: null, store: null, settled: true, assets: null })).toEqual({ s: 'absent' });
  });
});
