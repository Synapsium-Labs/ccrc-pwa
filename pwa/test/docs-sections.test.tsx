// Docs W5b-1, Task 4: the Docs screen over a four- or six-section fleet (refinement (d); rich-docs M9.3, the PWA half).
// A fleet box without the sections token serves four doc sections, a new one six. The screen shows what the box serves,
// never `?` for a section it lacks, and says so on a page under a section the tree answer does not hold. Placeholders
// only: project `demo`.
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import {
  DOC_SECTION_SLUGS, type DocSectionSlug, type DocsIndexOk, type DocsIndexRow, type DocsProjectsResponse, type DocsTreeOk,
} from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import type { DocsLoaders } from '../src/docs/failures';
import { COMMIT_B, entry, fakeLoaders, okTree, treeOk, type FakeLoaders } from './docsFixtures';

const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

function Routed(p: { readonly loaders: DocsLoaders }): ReactNode {
  const { path, search } = useLocation();
  return <DocsScreen path={path} search={search} loaders={p.loaders} parser={parser} />;
}

function open(url: string, f: FakeLoaders): void {
  navigate(url);
  render(<Routed loaders={f.loaders} />);
}

afterEach(() => { cleanup(); });

const FOUR: readonly DocSectionSlug[] = ['specs', 'plans', 'product-design', 'conventions'];

/** The tree answer of a fleet box that serves only the first four sections. */
function fourSectionTree(): DocsTreeOk {
  const t = treeOk({ entries: [entry('specs', 'a.md')] });
  t.sections = t.sections.filter((s) => FOUR.includes(s.slug));
  return t;
}

const row = (sections: Partial<Record<DocSectionSlug, number | null>>): DocsIndexRow => ({
  project: 'demo', state: 'ready', github: { state: 'none' },
  default: { name: 'main', via: 'default:origin-head', commit: COMMIT_B }, sections,
});

function indexOf(...rows: DocsIndexRow[]): DocsProjectsResponse {
  const index: DocsIndexOk = {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, unwalked: 0, duplicates: [], projects: rows,
  };
  return { ok: true, index, cacheAgeMs: 10 };
}

function openIndex(...rows: DocsIndexRow[]): void {
  const f = fakeLoaders();
  f.projects.mockResolvedValue({ s: 'ok', value: indexOf(...rows) });
  open('/docs', f);
}

describe('the index over a four- or six-section fleet (M9.3)', () => {
  it('an index row from a four-section fleet counts four sections, with no ? for vision or promise', async () => {
    openIndex(row({ specs: 3, plans: 2, 'product-design': 1, conventions: 0 }));
    const r = (await screen.findByText('demo', { selector: '.docs-row-name' })).closest('.docs-row') as HTMLElement;
    expect(r).toHaveTextContent('3 specs · 2 plans · 1 design · 0 conventions');
    expect(r).not.toHaveTextContent('vision');
    expect(r).not.toHaveTextContent('promise');
    expect(r).not.toHaveTextContent('?');
  });

  it('an index row from a six-section fleet counts six, vision and promise last', async () => {
    openIndex(row({ specs: 3, plans: 2, 'product-design': 1, conventions: 0, vision: 4, promise: 1 }));
    const r = (await screen.findByText('demo', { selector: '.docs-row-name' })).closest('.docs-row') as HTMLElement;
    expect(r).toHaveTextContent('3 specs · 2 plans · 1 design · 0 conventions · 4 vision · 1 promise');
  });

  it('a ready row whose only docs are in vision is listed with the docs', async () => {
    openIndex(
      row({ specs: 0, plans: 0, 'product-design': 0, conventions: 0, vision: 2, promise: 0 }),
      { ...row({ specs: 0, plans: 0, 'product-design': 0, conventions: 0 }), project: 'none' },
    );
    await screen.findByText('demo', { selector: '.docs-row-name' });
    const main = [...document.querySelectorAll('.docs-index > .docs-rows .docs-row-name')].map((n) => n.textContent);
    expect(main).toEqual(['demo']);
    const fold = document.querySelector('details.docs-nodocs') as HTMLElement;
    expect([...fold.querySelectorAll('.docs-row-name')].map((n) => n.textContent)).toEqual(['none']);
  });
});

describe('the project, section and leaf pages over a four- or six-section tree', () => {
  const rowNames = (): (string | null | undefined)[] =>
    [...document.querySelectorAll('.docs-project .docs-row')].map((r) => r.querySelector('.docs-row-name')?.textContent);

  it('a project page over a four-section tree draws four section rows', async () => {
    open('/docs/demo', fakeLoaders({ tree: okTree(fourSectionTree()) }));
    await screen.findByText('specs');
    expect(rowNames()).toEqual(['specs', 'plans', 'design', 'conventions']);
  });

  it('a project page over a six-section tree draws six rows in DOC_SECTIONS order', async () => {
    open('/docs/demo', fakeLoaders({ tree: okTree(treeOk()) }));
    await screen.findByText('specs');
    expect(DOC_SECTION_SLUGS).toHaveLength(6);
    expect(rowNames()).toEqual(['specs', 'plans', 'design', 'conventions', 'vision', 'promise']);
  });

  it('a vision page over a four-section tree says the fleet box does not serve it', async () => {
    const f = fakeLoaders({ tree: okTree(fourSectionTree()) });
    open('/docs/demo/vision', f);
    expect(await screen.findByText(/The fleet box does not serve this section yet/)).toBeInTheDocument();
    expect(screen.queryByText('Nothing is listed here.')).toBeNull();
    // No file read goes out for a section the box does not serve (`file` is the loader that asks ccd's docs-show).
    expect(f.file).not.toHaveBeenCalled();
    expect(f.raster).not.toHaveBeenCalled();
  });

  it('a vision leaf over a four-section tree says the same, not Not in this listing', async () => {
    const f = fakeLoaders({ tree: okTree(fourSectionTree()) });
    open('/docs/demo/vision/a.md', f);
    expect(await screen.findByText(/The fleet box does not serve this section yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Not in this listing/)).toBeNull();
    expect(f.file).not.toHaveBeenCalled();
    expect(f.raster).not.toHaveBeenCalled();
  });
});
