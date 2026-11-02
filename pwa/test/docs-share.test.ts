// Docs W5 Share (spec 2026-10-01 4.5, 4.7, 4.16; native Docs reader W5, Share): what Share sends and when, pure.
// Task 1, the words: the refusal and note maps, exhaustive by key; Export's clause as a seam no page takes yet; the
// closed worktree label. Task 2, `shareTargetFor` over hand-built tree answers and pins (M4.SH1, M4.SH2, M4.SH3's
// Share half, M4.SH6, M4.EX12's pure half, M4.T7's Share clause). Task 3, `shareStateFor` (M4.SH8's pure half and
// M4.EX12's "disabled while the pin differs"). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import {
  DOCS_API_PREFIX, DOCS_CLASS_CAP, DOCS_PAGE_PREFIX, type DocPin, type DocsEntry, type DocsShowOk, type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { shareStateFor } from '../src/docs/DocsHead';
import { DocsTreeView } from '../src/docs/DocsTreeView';
import {
  DOCS_HEAD_TEXT, SHARE_EXPORT_CLAUSE, SHARE_EXPORT_CLAUSE_FOR, SHARE_NOTE, SHARE_SENTENCE, closedWorktreeLabel,
  shareNoteSentence, shareRefusalSentence, worktreeLabel,
} from '../src/docs/docsText';
import { shareTargetFor, type ShareOpened, type ShareRefusal, type ShareTarget } from '../src/docs/share';
import { pinFor, type FileSlot } from '../src/docs/useDocsVisit';
import {
  BLOB_1, BLOB_2, COMMIT_A, COMMIT_B, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk,
} from './docsFixtures';

const SHORT_A = 'a'.repeat(8);

describe('the Share words (spec 4.7, 4.16; M4.SH6)', () => {
  const REFUSALS: ShareRefusal[] =
    ['bad-slug', 'bad-target', 'new-draft', 'new-withheld', 'no-github-origin', 'not-on-origin', 'unmeasured'];
  const NOTES = ['access', 'admitted-committed', 'dir-drafts', 'drafts-excluded', 'html-source', 'onRef-not-contained',
    'onRef-unmeasured', 'view-committed'];
  const FIELDS = { short: SHORT_A, withheld: 'The draft is too large for Docs to read' };

  it('SHARE_SENTENCE has one sentence per refusal word, and SHARE_NOTE one per note word', () => {
    expect(Object.keys(SHARE_SENTENCE).sort()).toEqual(REFUSALS);
    expect(Object.keys(SHARE_NOTE).sort()).toEqual(NOTES);
  });

  it("no refusal sentence carries Export's clause while no page offers Export (refinement (c))", () => {
    for (const why of REFUSALS) expect(shareRefusalSentence(why, FIELDS, false), why).not.toContain('Export makes');
  });

  it('the Export seam: a page that offers Export adds the clause to exactly the four refusals the spec gives it', () => {
    const takers = REFUSALS.filter((why) => shareRefusalSentence(why, FIELDS, true).endsWith(' ' + SHARE_EXPORT_CLAUSE));
    expect(takers).toEqual(['bad-slug', 'bad-target', 'new-draft', 'no-github-origin']);
    expect([...SHARE_EXPORT_CLAUSE_FOR].sort()).toEqual(takers);
  });

  it("the refusal sentences are spec 4.16's, without Export's clause", () => {
    expect(shareRefusalSentence('no-github-origin', {}, false)).toBe('No GitHub link for this project.');
    expect(shareRefusalSentence('bad-slug', {}, false)).toBe('No GitHub link for this project.');
    expect(shareRefusalSentence('bad-target', {}, false)).toBe('Docs could not build a GitHub link for this page.');
    expect(shareRefusalSentence('not-on-origin', { short: SHORT_A }, false))
      .toBe(`Commit ${SHORT_A} is not on origin; push it to share.`);
    expect(shareRefusalSentence('unmeasured', { short: SHORT_A }, false))
      .toBe(`Docs could not measure whether origin has ${SHORT_A}; Refresh, then share.`);
    expect(shareRefusalSentence('new-draft', {}, false)).toBe('Not committed yet, so GitHub has nothing to show.');
    expect(shareRefusalSentence('new-withheld', FIELDS, false))
      .toBe('Not committed yet, and Docs did not read it (The draft is too large for Docs to read); nothing to share or export.');
  });

  it("the notes are spec 4.16's", () => {
    expect(shareNoteSentence({ note: 'access', fields: { slug: 'example-org/example-repo' } }))
      .toBe("Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.");
    expect(shareNoteSentence({ note: 'html-source', fields: {} })).toBe('GitHub shows this page as source.');
    expect(shareNoteSentence({ note: 'view-committed', fields: { label: 'main checkout' } }))
      .toBe('Uncommitted changes in main checkout are not included.');
  });

  it('dir-drafts counts in words: one doc is, three docs are (refinement (i))', () => {
    expect(shareNoteSentence({ note: 'dir-drafts', fields: { k: 1, s: '', be: 'is' } }))
      .toBe('1 uncommitted doc here is not included.');
    expect(shareNoteSentence({ note: 'dir-drafts', fields: { k: 3, s: 's', be: 'are' } }))
      .toBe('3 uncommitted docs here are not included.');
  });

  it('closedWorktreeLabel names a worktree from a closed set, never another segment of its path (refinement (b))', () => {
    expect(closedWorktreeLabel({ path: '/repo/demo', class: 'main' })).toBe('main checkout');
    expect(closedWorktreeLabel({ path: '/repo/demo/.ws/ws-a/', class: 'workspace' })).toBe('workspace ws-a');
    expect(closedWorktreeLabel({ path: '/', class: 'workspace' })).toBe(DOCS_HEAD_TEXT.worktreeOther);
    expect(closedWorktreeLabel({ path: '/repo/elsewhere/wt-b', class: 'other' })).toBe('another worktree');
    // The truth line's label is unchanged: it stays in the browser and may name the last two segments.
    expect(worktreeLabel({ path: '/repo/elsewhere/wt-b', class: 'other' })).toBe('elsewhere/wt-b');
  });
});

// ---- Task 2: shareTargetFor -------------------------------------------------------------------------------------

const GH = 'https://github.com/example-org/example-repo';
const NONE: ShareOpened = { kind: 'none' };
const ACCESS = "Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.";

const committedPin = (commit: string, path = 'a.md'): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });
const opened = (pin: DocPin, show: DocsShowOk | null = null): ShareOpened => ({ kind: 'file', pin, show });

/** A committed answer at `commit` whose text is a hostile h1 (a URL, a bidi override) that Share must never read. */
function showAt(commit: string, over: Partial<DocsShowOk> = {}): DocsShowOk {
  const h1 = `# Re-authenticate at https://a.example ${String.fromCharCode(0x202e)}gpj.exe\n`;
  return { ...fileResponse(h1).show, commit, blob: BLOB_1, onRef: 'contains', ...over };
}

/** An entry under `specs` with a draft over it: by default a modified regular file over a committed one. */
function drafted(path: string, draft = draftOf('modified'),
  committed: DocsEntry['committed'] = { kind: 'file', blob: BLOB_2, size: 100 }): DocsEntry {
  return { section: 'specs', path, committed, draft };
}

/** The pin the tree implies for `url`'s leaf; throws when it opens nothing (a fixture defect). */
function pinOf(tree: DocsTreeOk, url: string): DocPin {
  const pin = pinFor(tree, pageAt(url));
  if (pin === null) throw new Error(`fixture: ${url} opens no file`);
  return pin;
}

function linkOf(t: ShareTarget | null): Extract<ShareTarget, { ok: true }> {
  if (t === null || !t.ok) throw new Error(`expected a link, got ${JSON.stringify(t)}`);
  return t;
}

function refusalOf(t: ShareTarget | null): Extract<ShareTarget, { ok: false }> {
  if (t === null || t.ok) throw new Error(`expected a refusal, got ${JSON.stringify(t)}`);
  return t;
}

const noteWords = (t: ShareTarget): string[] => t.notes.map((n) => n.note);

function noteText(t: ShareTarget, note: string): string | undefined {
  const line = t.notes.find((n) => n.note === note);
  return line === undefined ? undefined : shareNoteSentence(line);
}

const withRef = (tree: DocsTreeOk, over: Partial<DocsTreeOk['ref']>): DocsTreeOk => ({ ...tree, ref: { ...tree.ref, ...over } });

/** `holder()`'s record with another worktree. `holder()` answers the whole `DraftsFacts` union, so it is narrowed to the
 *  holder arm before the spread (a spread over the union would keep arms whose `worktree` is a string). */
function holderAt(worktree: { readonly path: string; readonly class: 'main' | 'workspace' | 'other' }): DraftsFacts {
  const h = holder();
  if (h.state !== 'holder') throw new Error('fixture: holder() is not a holder');
  return { ...h, worktree: { ...h.worktree, ...worktree } };
}

/** A placeholder in a session id's shape (`<wrapper>-<project>`), planted where a fleet name could sit in Share's
 *  inputs: a worktree path segment that is not its last (refinement (p)). */
const SESSION_ID = 'wrapper-a-demo';

describe('shareTargetFor: the link, its title and its text, by page (spec 4.16; M4.SH1)', () => {
  it('the project page: /tree/<C>, titled by the project, its text "<project> at <short>"', () => {
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo'), NONE));
    expect(t).toMatchObject({ url: `${GH}/tree/${COMMIT_A}`, commit: COMMIT_A, title: 'demo', text: `demo at ${SHORT_A}` });
    expect(noteWords(t)).toEqual(['access']);
    expect(noteText(t, 'access')).toBe(ACCESS);
  });

  it("a section page: /tree/<C>/<section path>, titled by its last segment", () => {
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo/specs'), NONE));
    expect(t).toMatchObject({
      url: `${GH}/tree/${COMMIT_A}/docs/superpowers/specs`, title: 'specs', text: `demo · docs/superpowers/specs at ${SHORT_A}`,
    });
  });

  it('a directory page: /tree/<C>/<its repo path>', () => {
    const tree = treeOk({ entries: [entry('specs', 'd/x.md')] });
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/d/'), NONE));
    expect(t).toMatchObject({
      url: `${GH}/tree/${COMMIT_A}/docs/superpowers/specs/d`, title: 'd', text: `demo · docs/superpowers/specs/d at ${SHORT_A}`,
    });
  });

  it("a leaf: /blob/<the opened commit>/<repo path>, titled by its basename even when the doc's h1 is hostile", () => {
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo/specs/a.md'), opened(committedPin(COMMIT_A), showAt(COMMIT_A))));
    expect(t).toMatchObject({
      url: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`, title: 'a.md',
      text: `demo · docs/superpowers/specs/a.md at ${SHORT_A}`,
    });
  });

  it("a leaf that opens nothing (a committed symlink) links at the tree's commit (refinement (r))", () => {
    const tree = treeOk({ entries: [entry('specs', 'l.md', { committed: { kind: 'symlink', blob: BLOB_1, size: 10 } })] });
    expect(pinFor(tree, pageAt('/docs/demo/specs/l.md'))).toBeNull();
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/l.md'), NONE));
    expect(t).toMatchObject({ url: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/l.md`, title: 'l.md' });
  });

  it('a raster leaf links the commit of the pin its image settled at', () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png')] });
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/x.png'), opened(committedPin(COMMIT_A, 'x.png'))));
    expect(t).toMatchObject({ url: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`, title: 'x.png' });
  });

  it('every argument over the page fixtures is a permalink at a full commit and carries nothing of ccrc (refinement (p))', () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md'), entry('specs', 'x.png'), drafted('m.md')],
      drafts: holderAt({ path: `/repo/${SESSION_ID}/ws-a`, class: 'workspace' }),
    });
    const PERMALINK = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:blob|tree)\/(?:[0-9a-f]{40}|[0-9a-f]{64})(?:\/|$)/;
    const cases: [string, ShareOpened][] = [
      ['/docs/demo', NONE],
      ['/docs/demo/specs', NONE],
      ['/docs/demo/specs/d/', NONE],
      ['/docs/demo/specs/a.md', opened(committedPin(COMMIT_A), showAt(COMMIT_A))],
      ['/docs/demo/specs/x.png', opened(committedPin(COMMIT_A, 'x.png'))],
      ['/docs/demo/specs/m.md?ref=main', opened(pinOf(tree, '/docs/demo/specs/m.md?ref=main'))],
      ['/docs/demo/specs/m.md?ref=main&view=committed', opened(committedPin(COMMIT_A, 'm.md'))],
    ];
    for (const [url, o] of cases) {
      const page = pageAt(url);
      const t = linkOf(shareTargetFor(tree, page, o));
      expect(t.url, url).toMatch(PERMALINK);
      const sentences = t.notes.map(shareNoteSentence);
      for (const arg of [t.url, t.title, t.text, ...sentences]) {
        expect(arg, url).not.toContain(location.origin);
        expect(arg, url).not.toContain(`${DOCS_PAGE_PREFIX}/demo`);
        expect(arg, url).not.toContain(DOCS_API_PREFIX);
        expect(arg, url).not.toContain('/api/');
        expect(arg, url).not.toContain('/repo/');
        expect(arg, url).not.toContain(SESSION_ID);
        expect(arg, url).not.toContain('a.example');
        expect(arg, url).not.toContain(String.fromCharCode(0x202e));
      }
      // The repository path in the URL starts with `docs/`; nothing else Share sends may hold `/docs/` at all.
      for (const words of [t.title, t.text, ...sentences]) expect(words, url).not.toContain('/docs/');
    }
    // The planted session id does reach Share's input, and the label that leaves names only the last segment.
    const draftLink = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/m.md?ref=main'),
      opened(pinOf(tree, '/docs/demo/specs/m.md?ref=main'))));
    expect(noteText(draftLink, 'drafts-excluded')).toContain('workspace ws-a has uncommitted changes');
  });

  it('the index and a path this listing does not hold have no Share target', () => {
    expect(shareTargetFor(treeOk(), pageAt('/docs'), NONE)).toBeNull();
    expect(shareTargetFor(treeOk(), pageAt('/docs/demo/specs/zzz.md'), NONE)).toBeNull();
  });
});

describe('shareTargetFor: drafts (the drafts ruling; M4.SH2, M4.SH3 Share half)', () => {
  it('a ref-view leaf opening a draft with a committed side sends the committed permalink at C, and says drafts are not included (M4.SH2)', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holder() });
    const url = '/docs/demo/specs/a.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(t.url).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(noteWords(t)).toEqual(['drafts-excluded', 'access']);
    expect(noteText(t, 'drafts-excluded')).toBe(
      `Drafts are not included: the link opens the committed version at ${SHORT_A}; main checkout has uncommitted changes to this doc.`);
  });

  it('the default view of the same leaf gives no warning (M4.SH2)', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holder() });
    const url = '/docs/demo/specs/a.md';
    expect(noteWords(linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url)))))).toEqual(['access']);
  });

  it('view=committed on an admitted entry: the permalink, and the uncommitted changes are not included', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holder() });
    const url = '/docs/demo/specs/a.md?ref=main&view=committed';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(noteWords(t)).toEqual(['view-committed', 'access']);
    expect(noteText(t, 'view-committed')).toBe('Uncommitted changes in main checkout are not included.');
  });

  it.each([
    ['deleted', draftOf('deleted', { kind: 'absent', fp: null, size: null }), 'draft · deleted'],
    ['typechange', draftOf('typechange', { kind: 'symlink', fp: null }), 'draft · type changed'],
    ['withheld', draftOf('modified', { fp: null }), 'draft · withheld'],
  ] as const)('admitted but opening committed (%s): the permalink, and the badge the row shows', (_name, draft, badge) => {
    const tree = treeOk({ entries: [drafted('a.md', draft)], drafts: holder() });
    const url = '/docs/demo/specs/a.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(noteWords(t)).toEqual(['admitted-committed', 'access']);
    expect(noteText(t, 'admitted-committed')).toBe(`${badge} in main checkout; the link opens the committed version.`);
  });

  it.each(['added', 'untracked'] as const)('a readable new draft (%s, fp set) sends no link: new-draft, with the access note (M4.SH3)', (state) => {
    const tree = treeOk({ entries: [drafted('n.md', draftOf(state), null)], drafts: holder() });
    const url = '/docs/demo/specs/n.md?ref=main';
    const t = refusalOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(t.why).toBe('new-draft');
    expect(noteWords(t)).toEqual(['access']);
  });

  it('a withheld new file (it opens nothing) sends no link: new-withheld, naming why Docs did not read it (M4.SH3)', () => {
    const tree = treeOk({ entries: [drafted('n.md', draftOf('added', { fp: null }), null)], drafts: holder() });
    const url = '/docs/demo/specs/n.md?ref=main';
    expect(pinFor(tree, pageAt(url))).toBeNull();
    const t = refusalOf(shareTargetFor(tree, pageAt(url), NONE));
    expect(t.why).toBe('new-withheld');
    expect(shareRefusalSentence(t.why, t.fields, false)).toBe(
      'Not committed yet, and Docs did not read it (The draft is too large for Docs to read); nothing to share or export.');
    expect(noteWords(t)).toEqual(['access']);
  });

  it('a worktree outside the closed set is named "another worktree", never by its path', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holderAt({ path: '/repo/elsewhere/wt-b', class: 'other' }) });
    const url = '/docs/demo/specs/a.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(noteText(t, 'drafts-excluded')).toContain('another worktree has uncommitted changes');
    expect(t.notes.map(shareNoteSentence).join(' ')).not.toContain('wt-b');
  });
});

describe('shareTargetFor: the notes and the refusals (spec 4.16; M4.SH6)', () => {
  it('an html leaf: the permalink, and GitHub shows it as source', () => {
    const tree = treeOk({ entries: [entry('specs', 'm.html')] });
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/m.html'), opened(committedPin(COMMIT_A, 'm.html'))));
    expect(noteWords(t)).toEqual(['html-source', 'access']);
    expect(noteText(t, 'html-source')).toBe('GitHub shows this page as source.');
  });

  it.each([
    ['not-contained', 'onRef-not-contained', `Commit ${SHORT_A} is no longer on origin/main; GitHub may stop serving it.`],
    ['unmeasured', 'onRef-unmeasured', `Docs could not tell whether ${SHORT_A} is still on origin/main.`],
  ] as const)('a file answer whose onRef is %s: the permalink and its note', (onRef, note, text) => {
    const o = opened(committedPin(COMMIT_A), showAt(COMMIT_A, { onRef }));
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo/specs/a.md'), o));
    expect(noteWords(t)).toEqual([note, 'access']);
    expect(noteText(t, note)).toBe(text);
  });

  it.each([
    ['not-on-origin', withRef(treeOk(), { side: 'local', relation: 'local-only', via: 'local' }), { short: SHORT_A }],
    ['unmeasured', withRef(treeOk(), { side: 'local', relation: 'unmeasured', via: 'local' }), { short: SHORT_A }],
    ['bad-target', withRef(treeOk(), { commit: 'a'.repeat(39) }), {}],
  ] as const)('%s: no link, its fields, and the access note, since the slug is usable', (why, tree, fields) => {
    const t = refusalOf(shareTargetFor(tree, pageAt('/docs/demo/specs'), NONE));
    expect(t.why).toBe(why);
    expect(t.fields).toEqual(fields);
    expect(noteWords(t)).toEqual(['access']);
  });

  it('no-github-origin and bad-slug: no link and no access note, for there is no usable slug to name', () => {
    const none: DocsTreeOk = { ...treeOk(), github: { state: 'none' } };
    const badSlug: DocsTreeOk = { ...treeOk(), github: { state: 'named', slug: '../x' } };
    expect(refusalOf(shareTargetFor(none, pageAt('/docs/demo/specs'), NONE))).toMatchObject({ why: 'no-github-origin', notes: [] });
    expect(refusalOf(shareTargetFor(badSlug, pageAt('/docs/demo/specs'), NONE))).toMatchObject({ why: 'bad-slug', notes: [] });
  });
});

describe('shareTargetFor: which commit (spec 4.16; M4.EX12, refinement (a))', () => {
  it("a leaf links the commit its opened pin names, never the tree's newer commit (M4.EX12)", () => {
    const o = opened(committedPin(COMMIT_A), showAt(COMMIT_A));
    const t = linkOf(shareTargetFor(treeOk({ commit: COMMIT_B }), pageAt('/docs/demo/specs/a.md'), o));
    expect(t.commit).toBe(COMMIT_A);
    expect(t.url).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
  });

  it("a same-blob re-list: the pin is at C2 and the answer still says C1; the link names C2, and C1's onRef is not said of it", () => {
    const o = opened(committedPin(COMMIT_B), showAt(COMMIT_A, { onRef: 'not-contained' }));
    const t = linkOf(shareTargetFor(treeOk({ commit: COMMIT_B }), pageAt('/docs/demo/specs/a.md'), o));
    expect(t.commit).toBe(COMMIT_B);
    expect(noteWords(t)).toEqual(['access']);
  });
});

describe('shareTargetFor: a listing in a ref view says how many uncommitted docs its link leaves out (dir-drafts)', () => {
  const tree = treeOk({
    drafts: holder(),
    entries: [
      drafted('a.md'), drafted('d/x.md', draftOf('added'), null), entry('specs', 'd/y.md'),
      { ...drafted('p.md'), section: 'plans' }, drafted('guide/g.md'), drafted('guidebook/h.md'),
    ],
  });

  it.each([
    ['/docs/demo?ref=main', 5], ['/docs/demo/specs?ref=main', 4], ['/docs/demo/specs/d/?ref=main', 1],
    ['/docs/demo/specs/guide/?ref=main', 1],
  ] as const)('%s counts %i', (url, k) => {
    const t = linkOf(shareTargetFor(tree, pageAt(url), NONE));
    expect(noteWords(t)).toEqual(['dir-drafts', 'access']);
    expect(t.notes[0]?.fields).toEqual({ k, s: k === 1 ? '' : 's', be: k === 1 ? 'is' : 'are' });
  });

  it.each(['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/'])('the default view %s says nothing of drafts', (url) => {
    expect(noteWords(linkOf(shareTargetFor(tree, pageAt(url), NONE)))).toEqual(['access']);
  });
});

describe('one badge function: Share names the badge the row shows (M4.T7, Share clause)', () => {
  const COMMITTED = { kind: 'file', blob: BLOB_2, size: 100 } as const;
  it.each([
    ['deleted', draftOf('deleted', { kind: 'absent', fp: null, size: null })],
    ['typechange', draftOf('typechange', { kind: 'symlink', fp: null })],
    ['withheld, too large', draftOf('modified', { fp: null })],
    ['withheld, unreadable', draftOf('modified', { kind: 'unreadable', fp: null })],
    ['withheld, not a file', draftOf('modified', { kind: 'special', fp: null })],
  ] as const)('%s', (_name, draft) => {
    const e: DocsEntry = { section: 'specs', path: 'x.md', committed: COMMITTED, draft };
    const tree = treeOk({ entries: [e], drafts: holder() });
    const row = render(createElement(DocsTreeView, { tree, page: pageAt('/docs/demo/specs?ref=main') }));
    const rowText = row.container.querySelector('.docs-badge')?.textContent;
    row.unmount();
    expect(rowText).toBeTruthy();
    const url = '/docs/demo/specs/x.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(t.notes.find((n) => n.note === 'admitted-committed')?.fields['badge']).toBe(rowText);
  });
});

// ---- Task 3: shareStateFor --------------------------------------------------------------------------------------

describe('shareStateFor: where Share is offered, and when it waits (spec 4.5, 4.16; M4.SH8 pure half, M4.EX12)', () => {
  const tree = treeOk({
    entries: [
      entry('specs', 'a.md'), entry('specs', 'm.html'), entry('specs', 'x.png'), entry('specs', 'o.pdf'),
      entry('specs', 'big.png', { committed: { kind: 'file', blob: BLOB_2, size: DOCS_CLASS_CAP.raster + 1 } }),
      entry('specs', 'l.md', { committed: { kind: 'symlink', blob: BLOB_1, size: 10 } }),
      entry('specs', 'd/x.md'),
    ],
  });
  const NO_FILE: FileSlot = { s: 'none' };
  const okAt = (pin: DocPin): FileSlot => ({ s: 'ok', pin, answer: { ...fileResponse(), show: showAt(COMMIT_A) }, receivedAt: 0 });
  const readyAt = (pin: DocPin, show: DocsShowOk | null = null) => ({ s: 'ready', opened: { kind: 'file', pin, show } });

  it.each(['/docs', '/docs/demo/specs/m.html?ref=main&frame=full', '/docs/demo/specs/zzz.md'])('%s: no Share', (url) => {
    expect(shareStateFor(pageAt(url), tree, NO_FILE, null)).toEqual({ s: 'absent' });
  });

  it.each(['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/', '/docs/demo/specs/l.md'])(
    '%s: ready, having opened no file', (url) => {
      expect(shareStateFor(pageAt(url), tree, NO_FILE, null)).toEqual({ s: 'ready', opened: { kind: 'none' } });
    });

  it("a leaf whose read answered at pinFor's pin is ready, with that pin and that answer", () => {
    const pin = pinOf(tree, '/docs/demo/specs/a.md');
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), tree, okAt(pin), null)).toEqual(readyAt(pin, showAt(COMMIT_A)));
  });

  it("a leaf whose first read is in flight is updating, to pinFor's commit (refinement (h))", () => {
    const pin = pinOf(tree, '/docs/demo/specs/a.md');
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), tree, { s: 'loading', pin }, null))
      .toEqual({ s: 'updating', to: COMMIT_A });
  });

  it('a leaf still showing C1 while the tree is at C2 is updating, to C2 (M4.EX12)', () => {
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), treeOk({ commit: COMMIT_B }), okAt(committedPin(COMMIT_A)), null))
      .toEqual({ s: 'updating', to: COMMIT_B });
  });

  it("a leaf whose read failed at pinFor's pin is ready, with no answer", () => {
    const pin = pinOf(tree, '/docs/demo/specs/a.md');
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), tree, { s: 'unreachable', pin }, null)).toEqual(readyAt(pin));
  });

  it("a class Docs does not preview reads nothing, so it is ready at pinFor's pin (refinement (q))", () => {
    const pin = pinOf(tree, '/docs/demo/specs/o.pdf');
    expect(shareStateFor(pageAt('/docs/demo/specs/o.pdf'), tree, NO_FILE, null)).toEqual(readyAt(pin));
  });

  it('a raster leaf waits for its own image, and is ready at the pin the image settled at (refinement (f))', () => {
    const page = pageAt('/docs/demo/specs/x.png');
    const pin = pinOf(tree, '/docs/demo/specs/x.png');
    expect(shareStateFor(page, tree, NO_FILE, null)).toEqual({ s: 'updating', to: COMMIT_A });
    expect(shareStateFor(page, tree, NO_FILE, committedPin(COMMIT_B, 'x.png'))).toEqual({ s: 'updating', to: COMMIT_A });
    expect(shareStateFor(page, tree, NO_FILE, pin)).toEqual(readyAt(pin));
  });

  it("a raster over its class cap is never loaded, so it is ready at pinFor's pin at once (refinement (f))", () => {
    const pin = pinOf(tree, '/docs/demo/specs/big.png');
    expect(shareStateFor(pageAt('/docs/demo/specs/big.png'), tree, NO_FILE, null)).toEqual(readyAt(pin));
  });

  // A same-blob re-list moves the tree from C1 to C2 and rebinds only an `ok` slot's pin, so a settled slot that is not
  // `ok` still carries its C1 pin: it shows no bytes, so the page serves the tree's commit and Share is ready at C2.
  describe('a same-blob re-list over a settled slot that is not ok', () => {
    const c2 = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md')] });
    const stale = committedPin(COMMIT_A);
    const slots: [string, FileSlot][] = [
      ['failed', { s: 'failed', pin: stale, body: { ok: false, failure: 'unreadable-path' } }],
      ['changing', { s: 'changing', pin: stale, word: 'draft-changed' }],
      ['too-large', { s: 'too-large', pin: stale, size: 10, cap: 5 }],
      ['unreachable', { s: 'unreachable', pin: stale }],
      ['auth', { s: 'auth', pin: stale }],
    ];
    it.each(slots)('%s at the C1 pin under a C2 tree: ready at C2, with no answer', (_name, slot) => {
      const pin = pinOf(c2, '/docs/demo/specs/a.md');
      expect(pin.kind === 'committed' && pin.commit).toBe(COMMIT_B);
      expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), c2, slot, null)).toEqual(readyAt(pin));
    });
    it('control: an ok slot at the C1 pin under a C2 tree stays updating (its held body is in flight)', () => {
      expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), c2, okAt(stale), null)).toEqual({ s: 'updating', to: COMMIT_B });
    });
  });
});
