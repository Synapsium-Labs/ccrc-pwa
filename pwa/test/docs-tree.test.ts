// Docs W5 part 1, Task 9: the listing's pure rules (spec 2026-10-01 4.4). `listDir` lists what `entryView` lists, folders
// first with their listed counts, in `SECTION_ORDER` (specs and plans newest first, the other two alphabetical);
// `docsPathKind` decides a path page from the tree answer, never from the URL; `sectionCountsText` and the two
// section tables are derived from L0's `DOC_SECTION_SLUGS`. Placeholders only (`demo`, `main`, `/repo/demo`).
import { describe, expect, it } from 'vitest';
import { DOC_SECTION_SLUGS, type DocsEntry } from '../../shared/docs';
import {
  SECTION_LABEL, SECTION_ORDER, docsPathKind, leafName, listDir, sectionCountsText,
} from '../src/docs/docsTree';
import { draftOf, entry, holder, treeOk } from './docsFixtures';

const NONE = treeOk().drafts;
const names = (xs: readonly { entry: DocsEntry }[]): string[] => xs.map((x) => x.entry.path);

describe('the section tables are derived from DOC_SECTION_SLUGS', () => {
  it('SECTION_LABEL and SECTION_ORDER each have exactly the four slugs, in L0 order', () => {
    expect(Object.keys(SECTION_LABEL)).toEqual([...DOC_SECTION_SLUGS]);
    expect(Object.keys(SECTION_ORDER)).toEqual([...DOC_SECTION_SLUGS]);
  });

  it('specs and plans list newest first, product-design and conventions alphabetically', () => {
    expect(SECTION_ORDER).toEqual({
      specs: 'newest-first', plans: 'newest-first', 'product-design': 'alphabetical', conventions: 'alphabetical',
    });
  });

  it("sectionCountsText reads '12 specs · 40 plans · 3 design · 0 conventions', in L0 order", () => {
    expect(sectionCountsText({ specs: 12, plans: 40, 'product-design': 3, conventions: 0 }))
      .toBe('12 specs · 40 plans · 3 design · 0 conventions');
  });

  it('a null count renders ?, never 0', () => {
    expect(sectionCountsText({ specs: null, plans: 1, 'product-design': null, conventions: 0 }))
      .toBe('? specs · 1 plans · ? design · 0 conventions');
  });
});

describe('listDir (spec 4.4)', () => {
  const entries = [
    entry('specs', '2026-01-02-b.md'),
    entry('specs', '2026-03-04-a.md'),
    entry('specs', 'old/2025-01-01-x.md'),
    entry('specs', 'old/2025-02-01-y.md'),
    entry('specs', 'new/z.md'),
    entry('conventions', 'b.md'),
    entry('conventions', 'a.md'),
    entry('conventions', 'c/d.md'),
    entry('conventions', 'a/e.md'),
  ];

  it('specs: folders first with their listed counts, then files, each newest first', () => {
    const l = listDir(entries, 'specs', '', 'default', NONE);
    expect(l.folders).toEqual([{ name: 'old', count: 2 }, { name: 'new', count: 1 }]);
    expect(names(l.files)).toEqual(['2026-03-04-a.md', '2026-01-02-b.md']);
  });

  it('conventions: folders and files alphabetical', () => {
    const l = listDir(entries, 'conventions', '', 'default', NONE);
    expect(l.folders).toEqual([{ name: 'a', count: 1 }, { name: 'c', count: 1 }]);
    expect(names(l.files)).toEqual(['a.md', 'b.md']);
  });

  it('a directory lists what lies directly under it, newest first in specs', () => {
    const l = listDir(entries, 'specs', 'old', 'default', NONE);
    expect(l.folders).toEqual([]);
    expect(names(l.files)).toEqual(['old/2025-02-01-y.md', 'old/2025-01-01-x.md']);
  });

  it('a directory prefix is a whole segment: "ol" lists nothing of "old/"', () => {
    const l = listDir(entries, 'specs', 'ol', 'default', NONE);
    expect(l.folders).toEqual([]);
    expect(l.files).toEqual([]);
  });

  it('the default view never lists a draft-only file; a ref view over an admitted holder lists it with its view', () => {
    const drafted = [entry('specs', 'a.md'), { section: 'specs' as const, path: 'n.md', committed: null, draft: draftOf('untracked') }];
    expect(names(listDir(drafted, 'specs', '', 'default', holder()).files)).toEqual(['a.md']);
    const ref = listDir(drafted, 'specs', '', 'ref', holder());
    expect(names(ref.files)).toEqual(['n.md', 'a.md']);
    expect(ref.files[0]!.view.badge).toBe('new');
  });

  it('a committed symlink is listed (and opens nothing)', () => {
    const l = listDir([entry('specs', 'l.md', { committed: { kind: 'symlink', blob: '1'.repeat(40), size: 4 } })],
      'specs', '', 'default', NONE);
    expect(names(l.files)).toEqual(['l.md']);
    expect(l.files[0]!.view.opens).toBe('none');
  });

  it('a folder counts only listed entries: a draft-only file under it does not count in the default view', () => {
    const drafted = [entry('specs', 'd/a.md'), { section: 'specs' as const, path: 'd/n.md', committed: null, draft: draftOf('added') }];
    expect(listDir(drafted, 'specs', '', 'default', holder()).folders).toEqual([{ name: 'd', count: 1 }]);
    expect(listDir(drafted, 'specs', '', 'ref', holder()).folders).toEqual([{ name: 'd', count: 2 }]);
  });
});

describe('docsPathKind: the tree answer decides, never the URL (spec 3.1, 4.4)', () => {
  const tree = treeOk({
    entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md'), { section: 'specs', path: 'n.md', committed: null, draft: draftOf('untracked') }],
    drafts: holder(),
  });

  it('an exact listed entry is a leaf, a listed entry under path/ makes a directory, anything else is missing', () => {
    expect(docsPathKind(tree, 'specs', 'a.md', 'default').kind).toBe('leaf');
    expect(docsPathKind(tree, 'specs', 'd', 'default').kind).toBe('dir');
    expect(docsPathKind(tree, 'specs', 'zzz', 'default').kind).toBe('missing');
    expect(docsPathKind(tree, 'plans', 'a.md', 'default').kind).toBe('missing');
  });

  it('a draft-only file is missing in the default view and a leaf in a ref view', () => {
    expect(docsPathKind(tree, 'specs', 'n.md', 'default').kind).toBe('missing');
    expect(docsPathKind(tree, 'specs', 'n.md', 'ref').kind).toBe('leaf');
  });

  it('leafName is the last segment', () => {
    expect(leafName('a/b/c.md')).toBe('c.md');
    expect(leafName('c.md')).toBe('c.md');
  });
});
