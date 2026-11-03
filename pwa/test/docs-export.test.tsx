// Docs W5 Export (spec 2026-10-01 4.7, 4.14, 4.17; native Docs reader W5, Export): what an export holds, pure and built.
// Task 1, the words and the name (M4.EX5's and M4.EX18's maps, M4.EX9). Task 2, the stylesheet (M4.EX10, M4.EX14 as
// refinement (b) reads it). Task 3, the provenance and the colouring (M4.T7, M4.EX5, M4.EX6, M4.EX18). Task 5, the
// builder (M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`, `https://a.example`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DOCS_RASTER_TYPES, docsApi, entryView, type DocPin, type DocsEntry, type DocsPageLocation, type DocsShowOk,
  type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';
import {
  DOC_IMAGE_TEXT, DOC_LINK_INERT_SENTENCE, ENTRY_BADGE_TEXT, EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, fillSentence,
} from '../src/docs/docsText';
import { buildExport, type ExportBodyInput, type ExportInput, type ExportLimits, type ExportResult } from '../src/docs/export/buildExport';
import { exportColouring, type ExportColouring } from '../src/docs/export/colouring';
import { createExportAssets, type ExportAssets } from '../src/docs/export/exportAssets';
import { exportLinkTarget } from '../src/docs/export/exportMarkdown';
import { exportFilename } from '../src/docs/export/filename';
import {
  DOCS_EXPORT_CSP, DOCS_EXPORT_MAX_BYTES, EXPORT_FILENAME_MAX, EXPORT_PREFIX, type ExportMissing, type ExportPlain,
} from '../src/docs/export/policy';
import { colouringNotes, exportProvenance, missingNotes, type ExportProvenance } from '../src/docs/export/provenance';
import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';
import { pinFor } from '../src/docs/useDocsVisit';
import type { Highlighter } from '../src/lib/highlightProtocol';
import {
  UNREQUESTED_ENTRY, checkHighlightHtml, codeBlocksOf, createHighlightStore, type CheckedHighlightHtml, type CodeBlockText,
  type HighlightEntry, type HighlightStore, type PlainCause, type SkipCeiling,
} from '../src/lib/highlightStore';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS } from '../src/lib/markdownLimits';
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
      .toEqual(['failed', 'no-worker', 'over-cap', 'page-ceiling', 'part1-bounds', 'timeout', 'too-large']);
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
    const raws = ['ok', 'skipped', 'scan', 'slow', 'big', 'dead', 'threw', 'bad', 'none', 'forged', 'unregistered'];
    const blocks: CodeBlockText[] = [
      ...raws.map((raw) => ({ lang: 'bash', raw })),
      { lang: 'bash', raw: 'x'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1) },
      { lang: 'bash', raw: 'w'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1) },
      { lang: 'nope', raw: 'no grammar' },
    ];
    const c = exportColouring(blocks, storeOf({
      [key('bash', 'ok')]: html(OK_HTML),
      [key('bash', 'skipped')]: { kind: 'skipped', ceiling: 'page-output' },
      [key('bash', 'scan')]: { kind: 'skipped', ceiling: 'part1-scan' },
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
      'over-cap': 1, 'part1-bounds': 2, 'page-ceiling': 1, 'timeout': 1, 'too-large': 1, 'failed': 4, 'no-worker': 1,
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
    project: 'demo', pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree,
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
].join('\n');

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

  it('is inert over a hostile corpus: no active element, no on* or style attribute, URLs only where allowed, the banner first (M4.EX2)', async () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified') }), entry('specs', 'b.md'), entry('specs', 'x.png')], drafts: holder(),
    });
    const url = '/docs/demo/specs/a.md?ref=main';
    const page = leafAt(url);
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture');
    const provenance = exportProvenance({ tree, page, pin, show: null, exportedAt: NOW, readAt: NOW, plainView: true });
    const { doc } = await built(inputOf(treeBody(HOSTILE, tree, url), { provenance, title: HOSTILE_H1 }), WIDE);
    for (const tag of ['script', 'iframe', 'object', 'embed', 'base', 'form', 'button', 'svg', 'link']) {
      expect(doc.querySelectorAll(tag), tag).toHaveLength(0);
    }
    for (const el of doc.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) expect(a.startsWith('on'), `${el.tagName} ${a}`).toBe(false);
      for (const a of ['srcset', 'poster', 'cite', 'background', 'action', 'formaction', 'ping', 'data', 'xlink:href', 'style']) {
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
    expect(doc.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    const style = doc.querySelector('style')?.textContent ?? '';
    expect(style).toBe(EXPORT_CSS);
    expect(style).not.toMatch(/@import|url\(/i);
    expect(doc.body.firstElementChild?.className).toBe('ccrc-export-draft');
    expect(doc.querySelector('title')?.textContent).toBe(HOSTILE_H1);
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
