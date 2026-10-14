// Docs W5 part 1, Task 10: the banners (spec 2026-10-01 4.5's table; M4.T2, M4.T3, M4.T4, M4.T5; spec 2 rows 54 and
// 67). The default view never overlays and its hint links the QUALIFIED `refs/heads/<branch>`; a ref view overlays
// only when the holder's HEAD is the served commit, and otherwise says what the drafts are based on; each drafts
// state that shows no drafts says why; a leaf's withheld, deleted, type-changed and conflicted drafts, a commit the
// branch no longer contains, a page's drafted images and `view=committed` each have their banner. Unit cases render
// `DocsBanners`; rows 67 and M4.T2-T3 mount `DocsScreen` with injected loaders. Placeholders only: project `demo`,
// branches `main` and `ws/a`, `/repo/...`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocPin, DocsEntry, DocsTreeOk, DraftsFacts } from '../../shared/docs';
import { DocsBanners } from '../src/docs/DocsBanners';
import type { DocsLoaders } from '../src/docs/failures';
import type { FileSlot } from '../src/docs/useDocsVisit';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import { DocsScreen } from '../src/screens/DocsScreen';
import { COMMIT_A, COMMIT_B, SERVED, draftOf, entry, fakeLoaders, fileResponse, holder, okTree, pageAt, treeOk } from './docsFixtures';

const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

function Routed(p: { readonly loaders: DocsLoaders }): ReactNode {
  const { path, search } = useLocation();
  return <DocsScreen path={path} search={search} loaders={p.loaders} parser={parser} />;
}

const banner = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-banner="${id}"]`);
const bannerIds = (): string[] => [...document.querySelectorAll('[data-banner]')].map((n) => n.getAttribute('data-banner') ?? '');
const textOf = (id: string): string => banner(id)?.querySelector('.docs-banner-text')?.textContent ?? '';

const NONE: FileSlot = { s: 'none' };

function banners(url: string, tree: DocsTreeOk, file: FileSlot = NONE, draftAssets = 0, onRelist = vi.fn()): ReturnType<typeof render> {
  return render(<DocsBanners page={pageAt(url)} tree={tree} file={file} draftAssets={draftAssets} onRelist={onRelist} />);
}

/** A holder of `ws/a`, a branch that is NOT the served ref's name (`main`): a hint that took the served ref's name
 *  instead of the holder's branch would say `main` and link `refs/heads/main`. */
const BRANCH = 'ws/a';
function holderOnBranch(head = COMMIT_A, baseEqual = true): DraftsFacts {
  return { ...(holder(head, baseEqual) as Extract<DraftsFacts, { state: 'holder' }>), branch: BRANCH };
}

/** Three drafts in the holder's worktree: a modified committed doc and two new ones. */
const THREE: DocsEntry[] = [
  entry('specs', 'a.md', { draft: draftOf('modified') }),
  { section: 'specs', path: 'n1.md', committed: null, draft: draftOf('untracked') },
  { section: 'specs', path: 'n2.md', committed: null, draft: draftOf('added') },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('the default view never overlays; its hint is qualified (M4.T2, row 67)', () => {
  it('a holder on local main with 3 dirty docs: zero draft rows, and a hint (n = 3) linking ?ref=refs/heads/main', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: THREE, drafts: holderOnBranch() })) });
    navigate('/docs/demo/specs');
    render(<Routed loaders={f.loaders} />);
    expect(await screen.findByText('3 uncommitted docs in main checkout on ws/a')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the draft view' })).toHaveAttribute('href', '/docs/demo/specs?ref=refs/heads/ws/a');
    expect([...document.querySelectorAll('.docs-listing .docs-row-name')].map((n) => n.textContent)).toEqual(['a.md']);
    expect(document.querySelector('.docs-badge')).toBeNull();
    expect(banner('default-hint')).toHaveAttribute('data-tone', 'info');
    expect(banner('default-hint')).toHaveAttribute('role', 'status');
  });

  it('a default-view leaf reads the committed pin; loaders.file never receives a DraftPin', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: THREE, drafts: holderOnBranch() })) });
    navigate('/docs/demo/specs/a.md');
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(f.file).toHaveBeenCalled());
    expect(f.file.mock.calls.every((c) => c[1].kind === 'committed')).toBe(true);
    expect(await screen.findByText('3 uncommitted docs in main checkout on ws/a')).toBeInTheDocument();
  });

  it('one draft says doc, not docs; no drafts, no hint', () => {
    banners('/docs/demo/specs', treeOk({ entries: [THREE[0] as DocsEntry], drafts: holderOnBranch() }));
    expect(textOf('default-hint')).toBe('1 uncommitted doc in main checkout on ws/a');
    cleanup();
    banners('/docs/demo/specs', treeOk({ entries: [entry('specs', 'a.md')], drafts: holderOnBranch() }));
    expect(banner('default-hint')).toBeNull();
  });
});

describe('a ref view overlays only when the base is equal (M4.T3, row 67)', () => {
  it('baseEqual false: the base hint linking refs/heads/<b>, and no overlay', async () => {
    const drafts = holderOnBranch(COMMIT_B, false);
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: THREE, drafts })) });
    navigate('/docs/demo/specs?ref=main');
    render(<Routed loaders={f.loaders} />);
    expect(await screen.findByText(
      '3 uncommitted docs in main checkout are based on local ws/a at bbbbbbbb; this page shows origin/main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the local view' })).toHaveAttribute('href', '/docs/demo/specs?ref=refs/heads/ws/a');
    expect([...document.querySelectorAll('.docs-listing .docs-row-name')].map((n) => n.textContent)).toEqual(['a.md']);
    expect(document.querySelector('.docs-badge')).toBeNull();
    expect(banner('default-hint')).toBeNull();
  });

  it('baseEqual true: the overlay appears, and neither hint', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: THREE, drafts: holder() })) });
    navigate('/docs/demo/specs?ref=main');
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(document.querySelectorAll('.docs-listing .docs-badge')).toHaveLength(3));
    expect([...document.querySelectorAll('.docs-listing .docs-badge')].map((n) => n.textContent).sort())
      .toEqual(['draft · modified', 'draft · new', 'draft · new']);
    expect(banner('default-hint')).toBeNull();
    expect(banner('base-hint')).toBeNull();
  });
});

describe('each drafts state that shows no drafts says why (M4.T4)', () => {
  const cases: readonly [string, DraftsFacts, string, 'info' | 'warn'][] = [
    ['ambiguous', { state: 'ambiguous', branch: 'main', candidates: ['/repo/wt/a', '/repo/wt/b'] },
      'Two or more worktrees hold main, so drafts are not shown:', 'warn'],
    ['untrusted', { state: 'untrusted', branch: 'main', worktree: '/repo/wt/a', why: 'foreign-owner' },
      'The worktree holding main failed the ownership check (foreign-owner); drafts are not shown.', 'warn'],
    ['unreadable', { state: 'unreadable', branch: 'main', worktree: '/repo/wt/a', step: 'status', detail: 'x' },
      'Drafts could not be read (status); showing committed only.', 'warn'],
    ['unsettled', { state: 'unsettled', branch: 'main', worktree: '/repo/wt/a' },
      'The worktree changed while Docs read it; showing committed only.', 'info'],
    ['too-many', { state: 'too-many', branch: 'main', worktree: '/repo/wt/a', count: 1200, bytes: 9 },
      '1200 uncommitted files is over the limit; showing committed only.', 'info'],
    ['skipped', { state: 'none', branch: 'main', skipped: [
      { path: '/repo/wt/a', why: 'prunable' }, { path: '/repo/wt/b', why: 'missing-dir' }, { path: '/repo/wt/c', why: 'prunable' },
    ] }, '3 worktree records for main were skipped (prunable, missing-dir).', 'info'],
  ];

  it.each(cases)('%s', (id, drafts, text, tone) => {
    banners('/docs/demo/specs?ref=main', treeOk({ drafts }));
    expect(textOf(id)).toBe(text);
    expect(banner(id)).toHaveAttribute('data-tone', tone);
    expect(bannerIds()).toEqual([id]);
  });

  it('ambiguous lists its candidates', () => {
    banners('/docs/demo', treeOk({ drafts: { state: 'ambiguous', branch: 'main', candidates: ['/repo/wt/a', '/repo/wt/b'] } }));
    expect([...(banner('ambiguous')?.querySelectorAll('li') ?? [])].map((n) => n.textContent)).toEqual(['/repo/wt/a', '/repo/wt/b']);
  });

  it('unsettled offers Retry, which re-lists', () => {
    const onRelist = vi.fn();
    banners('/docs/demo', treeOk({ drafts: { state: 'unsettled', branch: 'main', worktree: '/repo/wt/a' } }), NONE, 0, onRelist);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRelist).toHaveBeenCalledTimes(1);
  });

  it('none with nothing skipped says nothing', () => {
    banners('/docs/demo', treeOk());
    expect(bannerIds()).toEqual([]);
  });

  const CAVEAT_TEXT: Readonly<Record<'caveat-hash' | 'caveat-filters', string>> = {
    'caveat-hash': 'Some drafts were found by content hash.',
    'caveat-filters': 'Clean/smudge filters were bypassed; drafts show raw working-tree bytes.',
  };

  it.each([
    [['assume-unchanged'], ['caveat-hash']],
    [['skip-worktree', 'assume-unchanged'], ['caveat-hash']],
    [['filters-bypassed'], ['caveat-filters']],
    [['skip-worktree', 'filters-bypassed'], ['caveat-hash', 'caveat-filters']],
  ] as const)('a holder with caveats %j says %j', (caveats, ids) => {
    const h = holder() as Extract<DraftsFacts, { state: 'holder' }>;
    banners('/docs/demo?ref=main', treeOk({ drafts: { ...h, caveats: [...caveats] } }));
    expect(bannerIds()).toEqual(ids);
    expect(ids.map(textOf)).toEqual(ids.map((id) => CAVEAT_TEXT[id]));
  });

  it('the index has no banners', () => {
    const { container } = banners('/docs', treeOk({ drafts: { state: 'unsettled', branch: 'main', worktree: '/repo/wt/a' } }));
    expect(container.innerHTML).toBe('');
  });
});

describe("a leaf's draft banners (spec 4.5, row 54)", () => {
  const leafTree = (draft: NonNullable<DocsEntry['draft']>, committed: DocsEntry['committed'] = entry('specs', 'a.md').committed): DocsTreeOk =>
    treeOk({ entries: [{ section: 'specs', path: 'a.md', committed, draft }], drafts: holder() });

  it.each([
    ['too-large', draftOf('modified', { fp: null }), 'The draft is too large for Docs to read. Showing the committed version.'],
    ['unreadable', draftOf('modified', { kind: 'unreadable', fp: null }), 'The draft could not be read on the fleet box. Showing the committed version.'],
    ['not-a-file', draftOf('modified', { kind: 'directory', fp: null }), 'The draft is not a regular file. Showing the committed version.'],
  ] as const)('withheld (%s)', (_reason, draft, text) => {
    banners('/docs/demo/specs/a.md?ref=main', leafTree(draft));
    expect(textOf('withheld')).toBe(text);
    expect(banner('withheld')).toHaveAttribute('data-tone', 'info');
  });

  it('a withheld NEW file has no committed version to show, so it does not claim one', () => {
    banners('/docs/demo/specs/a.md?ref=main', leafTree(draftOf('untracked', { fp: null }), null));
    expect(textOf('withheld')).toBe('The draft is too large for Docs to read.');
  });

  it('deleted and type-changed name the worktree and show the committed version; conflicted warns', () => {
    banners('/docs/demo/specs/a.md?ref=main', leafTree(draftOf('deleted', { kind: 'absent', fp: null, size: null })));
    expect(textOf('deleted')).toBe('Deleted in main checkout (uncommitted). Showing the committed version.');
    cleanup();
    banners('/docs/demo/specs/a.md?ref=main', leafTree(draftOf('typechange', { kind: 'symlink', fp: null })));
    expect(textOf('typechange')).toBe('Its type changed in main checkout; the draft is not read. Showing the committed version.');
    cleanup();
    banners('/docs/demo/specs/a.md?ref=main', leafTree(draftOf('conflicted')));
    expect(textOf('conflicted')).toBe('Contains unresolved merge-conflict markers.');
    expect(banner('conflicted')).toHaveAttribute('data-tone', 'warn');
  });

  it('the default view shows none of them (it never overlays)', () => {
    banners('/docs/demo/specs/a.md', leafTree(draftOf('conflicted')));
    expect(bannerIds()).toEqual(['default-hint']);
  });
});

describe('a commit the branch no longer contains (M4.T5)', () => {
  // The page read at COMMIT_A; the served ref has since moved on to COMMIT_B (the tree commit), so the banner must
  // name the commit the PAGE read, never the served ref's tip.
  const movedTree = (): DocsTreeOk => treeOk({ commit: COMMIT_B });
  const ok = (onRef: 'contains' | 'not-contained' | 'unmeasured', over: { commit?: string | null; pin?: DocPin } = {}): FileSlot => {
    const r = fileResponse('# A');
    const { commit, ...rest } = { ...r.show, onRef };
    const show = over.commit === null ? rest : { ...rest, commit: over.commit ?? COMMIT_A };
    return {
      s: 'ok', pin: over.pin ?? { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' },
      answer: { ...r, show }, receivedAt: 0,
    };
  };

  it('not-contained warns, naming the short commit the page read and the served ref, with Re-list', () => {
    const onRelist = vi.fn();
    banners('/docs/demo/specs/a.md', movedTree(), ok('not-contained'), 0, onRelist);
    expect(textOf('not-contained')).toBe('Commit aaaaaaaa is no longer on origin/main (the branch was rewritten).');
    expect(banner('not-contained')).toHaveAttribute('data-tone', 'warn');
    fireEvent.click(screen.getByRole('button', { name: 'Re-list' }));
    expect(onRelist).toHaveBeenCalledTimes(1);
  });

  it("an answer that names no commit falls back to the committed pin's own commit, never the tree's", () => {
    banners('/docs/demo/specs/a.md', movedTree(), ok('not-contained', { commit: null }));
    expect(textOf('not-contained')).toBe('Commit aaaaaaaa is no longer on origin/main (the branch was rewritten).');
  });

  it('no commit anywhere (no answer commit, a draft pin): no banner rather than a guessed commit', () => {
    const draft = { kind: 'draft', branch: 'ws/a', head: COMMIT_B, section: 'specs', path: 'a.md', fp: 'f'.repeat(64) } as const;
    banners('/docs/demo/specs/a.md', movedTree(), ok('not-contained', { commit: null, pin: draft }));
    expect(banner('not-contained')).toBeNull();
  });

  it.each(['contains', 'unmeasured'] as const)('%s says nothing', (onRef) => {
    banners('/docs/demo/specs/a.md', movedTree(), ok(onRef));
    expect(bannerIds()).toEqual([]);
  });
});

describe('drafted assets and view=committed (spec 4.5)', () => {
  it('a page embedding drafted images counts them', () => {
    banners('/docs/demo/specs/a.md?ref=main', treeOk(), NONE, 2);
    expect(textOf('draft-assets')).toBe('This draft page embeds 2 uncommitted assets.');
    cleanup();
    banners('/docs/demo/specs/a.md?ref=main', treeOk(), NONE, 1);
    expect(textOf('draft-assets')).toBe('This draft page embeds 1 uncommitted asset.');
    cleanup();
    banners('/docs/demo/specs/a.md?ref=main', treeOk(), NONE, 0);
    expect(banner('draft-assets')).toBeNull();
  });

  it('view=committed says so at the short commit, with Back to the draft', () => {
    banners('/docs/demo/specs/a.md?ref=main&view=committed', treeOk());
    expect(textOf('view-committed')).toBe('Showing the committed version at aaaaaaaa.');
    expect(screen.getByRole('link', { name: 'Back to the draft' })).toHaveAttribute('href', '/docs/demo/specs/a.md?ref=main');
  });
});

describe('T13 review 5-1: a deleted draft counts in the default-view hint', () => {
  // A committed doc the holder's worktree has deleted is an entry with a draft (spec 4.5: `n` counts entries with a
  // draft at all). Counting it only as a held-variable `dr.state !== 'deleted'` test would drop it.
  it('a tree whose drafts include a deletion counts it in n', () => {
    const entries: DocsEntry[] = [
      entry('specs', 'a.md', { draft: draftOf('modified') }),
      entry('specs', 'gone.md', { draft: draftOf('deleted') }),
    ];
    banners('/docs/demo/specs', treeOk({ entries, drafts: holderOnBranch() }));
    expect(textOf('default-hint')).toBe('2 uncommitted docs in main checkout on ws/a');
  });

  it('a tree whose ONLY draft is a deletion still shows the banner, with n = 1', () => {
    const entries: DocsEntry[] = [entry('specs', 'gone.md', { draft: draftOf('deleted') })];
    banners('/docs/demo/specs', treeOk({ entries, drafts: holderOnBranch() }));
    expect(textOf('default-hint')).toBe('1 uncommitted doc in main checkout on ws/a');
  });
});

describe('Review 439 F3: the not-contained banner describes the pin', () => {
  const slot = (answerCommit: string, pinCommit: string): FileSlot => {
    const r = fileResponse('# A');
    return {
      s: 'ok', pin: { kind: 'committed', commit: pinCommit, servedRef: SERVED, section: 'specs', path: 'a.md' },
      answer: { ...r, show: { ...r.show, onRef: 'not-contained', commit: answerCommit } }, receivedAt: 0,
    };
  };

  it("an answer read at an older commit than the leaf's pin says nothing", () => {
    banners('/docs/demo/specs/a.md', treeOk({ commit: COMMIT_B }), slot(COMMIT_A, COMMIT_B));
    expect(banner('not-contained')).toBeNull();
  });

  it("an answer read at the leaf's pin shows the banner, naming that commit", () => {
    banners('/docs/demo/specs/a.md', treeOk({ commit: COMMIT_B }), slot(COMMIT_B, COMMIT_B));
    expect(textOf('not-contained')).toBe('Commit bbbbbbbb is no longer on origin/main (the branch was rewritten).');
  });
});
