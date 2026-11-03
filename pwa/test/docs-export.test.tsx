// Docs W5 Export (spec 2026-10-01 4.7, 4.14, 4.17; native Docs reader W5, Export): what an export holds, pure and built.
// Task 1, the words and the name (M4.EX5's and M4.EX18's maps, M4.EX9). Task 2, the stylesheet (M4.EX10, M4.EX14 as
// refinement (b) reads it). Task 3, the provenance and the colouring (M4.T7, M4.EX5, M4.EX6, M4.EX18). Task 5, the
// builder (M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`, `https://a.example`.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  entryView, type DocPin, type DocsEntry, type DocsPageLocation, type DocsShowOk, type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { ENTRY_BADGE_TEXT, EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, fillSentence } from '../src/docs/docsText';
import { exportColouring, type ExportColouring } from '../src/docs/export/colouring';
import { exportFilename } from '../src/docs/export/filename';
import { EXPORT_FILENAME_MAX, type ExportMissing, type ExportPlain } from '../src/docs/export/policy';
import { colouringNotes, exportProvenance, missingNotes, type ExportProvenance } from '../src/docs/export/provenance';
import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';
import { pinFor } from '../src/docs/useDocsVisit';
import {
  UNREQUESTED_ENTRY, checkHighlightHtml, type CheckedHighlightHtml, type CodeBlockText, type HighlightEntry,
  type HighlightStore, type PlainCause, type SkipCeiling,
} from '../src/lib/highlightStore';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS } from '../src/lib/markdownLimits';
import { BLOB_1, COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk } from './docsFixtures';
import { syncTestStore } from './highlightTestStore';

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
