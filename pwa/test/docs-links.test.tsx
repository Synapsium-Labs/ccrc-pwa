// Docs W5 part 1, Task 6: the docs link policy (spec 2026-10-01 4.11; refinements (n), (o), (q)). `detachUrls` returns
// a copy of a parsed tree with every `html-url-attributes` property moved into a WeakMap (it never writes its input),
// numbers the images and records each `pre`'s highlight decision; `DocLink` is the only thing that puts an `href` in
// the DOM, from `docLinkTarget`'s one decision: a doc link in-app at the page's ref with `view` dropped (M4.U3), an
// external link opened on tap only (M4.U4), a fragment scrolled inside the article with no history entry (M4.U7), an
// in-repo file outside the sections through `githubBlobUrl`, and an inert span for everything else. `docsLocation` is
// the one page-location builder. Every page is a placeholder (`demo`, `ws/a`, `example-org/example-repo`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Element as HastElement, ElementContent, Root as HastRoot, RootContent } from 'hast';
import { urlAttributes } from 'html-url-attributes';
import { docsPageUrl, docsRefText, githubBlobUrl, parseDocsRef, type DocsTreeOk } from '../../shared/docs';
import { SHARED_COMPONENTS } from '../src/lib/markdown';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';
import { DocLink, DocLinkContext, type DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls, docLinkTarget, docsLocation, type Detached } from '../src/docs/docsLinks';
import { DOC_LINK_INERT_SENTENCE, DOC_LINK_OUTSIDE_PAGE, type DocLinkInertReason } from '../src/docs/docsText';
import { pageAt, treeOk } from './docsFixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

const treeOf = (src: string): HastRoot => {
  const o = parseMarkdown(src, 'docs');
  if (o.kind !== 'tree') throw new Error(`expected a tree, got ${o.kind}`);
  return o.tree;
};

/** The page every case renders on: `specs/a.md` of `demo`, at the ref `ws/a`, in the committed view. */
function ctxFor(d: Detached, over: Partial<DocLinkContextValue> = {}): DocLinkContextValue {
  return {
    project: 'demo', pageRef: { kind: 'bare', name: 'ws/a' }, view: 'committed', section: 'specs', path: 'a.md',
    tree: treeOk(), pageSource: 'committed', urls: d.urls, onFragment: vi.fn(), ...over,
  };
}

/** `src` parsed in the docs profile, detached, and rendered with `DocLink` inside an `<article>`, as a Docs page. */
function renderDoc(src: string, over: Partial<DocLinkContextValue> = {}) {
  const detached = detachUrls(treeOf(src));
  const ctx = ctxFor(detached, over);
  const r = render(
    <article>
      <DocLinkContext value={ctx}>
        {renderHast(detached.tree, { components: { ...SHARED_COMPONENTS, a: DocLink } })}
      </DocLinkContext>
    </article>,
  );
  return { ...r, ctx, detached };
}

const firstLink = (c: HTMLElement): HTMLAnchorElement => {
  const a = c.querySelector('a');
  if (a === null) throw new Error('no link rendered');
  return a;
};

/** Every element of `root`, in document pre-order (an element before its children, siblings first to last). */
function elements(root: HastRoot): HastElement[] {
  const out: HastElement[] = [];
  const stack: RootContent[] = [...root.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'element') continue;
    out.push(n);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  return out;
}

function deepFreeze<T>(v: T): T {
  const stack: unknown[] = [v];
  while (stack.length > 0) {
    const o = stack.pop();
    if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) stack.push((o as Record<string, unknown>)[k]);
    }
  }
  return v;
}

const el = (tagName: string, properties: HastElement['properties'], children: ElementContent[] = []): HastElement =>
  ({ type: 'element', tagName, properties, children });

describe('detachUrls: a copy with every URL moved into the map (spec 4.11; refinement (n))', () => {
  it('returns a copy and never writes its input: a deep-frozen tree detaches, and its JSON is unchanged', () => {
    const tree = deepFreeze(treeOf('[x](../plans/p.md) ![i](i.png)\n\n```ts\nconst a = 1;\n```\n'));
    const before = JSON.stringify(tree);
    const d = detachUrls(tree);
    expect(JSON.stringify(tree)).toBe(before);
    expect(d.tree).not.toBe(tree);
    const [p] = tree.children;
    const [copy] = d.tree.children;
    expect(copy).not.toBe(p);
    expect(copy?.type === 'element' && p?.type === 'element' && copy.children[0]).not.toBe(
      p?.type === 'element' && p.children[0]);
    // Text nodes are shared: the copy is of the root and every element only.
    const text = (r: HastRoot) => elements(r).find((e) => e.tagName === 'code')?.children[0];
    expect(text(d.tree)).toBe(text(tree));
  });

  it('moves every html-url-attributes key out of the copy, on any tag, into the map, and keeps every other property', () => {
    const keys = Object.keys(urlAttributes);
    const tagOf = (k: string): string => urlAttributes[k]?.[0] ?? 'div';
    const children = keys.map((k) => el(tagOf(k), { [k]: `u-${k}`, id: `i-${k}`, className: ['c'] }));
    children.push(el('div', { href: 'off-tag', title: 't' }));
    // Values hast's types do not expect on these keys, as a hand-built or future tree could carry them.
    children.push(el('a', { ping: ['p1', 'p2'], href: 7, cite: null, src: false } as unknown as HastElement['properties']));
    const tree: HastRoot = { type: 'root', children };
    const d = detachUrls(tree);
    const copies = d.tree.children as HastElement[];
    keys.forEach((k, i) => {
      const c = copies[i]!;
      expect(Object.hasOwn(c.properties, k)).toBe(false);
      expect(c.properties).toEqual({ id: `i-${k}`, className: ['c'] });
      expect(d.urls.get(c)?.attrs).toEqual({ [k]: `u-${k}` });
    });
    const offTag = copies[keys.length]!;
    expect(offTag.properties).toEqual({ title: 't' });
    expect(d.urls.get(offTag)?.attrs).toEqual({ href: 'off-tag' });
    const odd = copies[keys.length + 1]!;
    expect(odd.properties).toEqual({});
    expect(d.urls.get(odd)?.attrs).toEqual({ ping: 'p1 p2', href: '7' });
  });

  it('moves the URL properties html-url-attributes lacks too (srcSet, xLinkHref, longDesc, ...): the move fails closed', () => {
    const extra = ['srcSet', 'imageSrcSet', 'xLinkHref', 'xLinkArcRole', 'xmlBase', 'longDesc', 'lowSrc', 'background',
      'classId', 'codeBase', 'archive', 'useMap', 'profile'];
    const img = el('img', { alt: 'x', srcSet: 'a.png 1x, /api/example/b.png 2x' });
    const use = el('use', { xLinkHref: '/api/example/sprite.svg#a', id: 'u' });
    const others = extra.map((k) => el('div', { [k]: `u-${k}`, title: 't' }));
    const d = detachUrls({ type: 'root', children: [img, use, ...others] });
    const [imgCopy, useCopy, ...otherCopies] = d.tree.children as HastElement[];
    expect(imgCopy!.properties).toEqual({ alt: 'x' });
    expect(Object.hasOwn(imgCopy!.properties, 'srcSet')).toBe(false);
    expect(d.urls.get(imgCopy!)?.attrs).toEqual({ srcSet: 'a.png 1x, /api/example/b.png 2x' });
    expect(useCopy!.properties).toEqual({ id: 'u' });
    expect(d.urls.get(useCopy!)?.attrs).toEqual({ xLinkHref: '/api/example/sprite.svg#a' });
    extra.forEach((k, i) => {
      expect(otherCopies[i]!.properties).toEqual({ title: 't' });
      expect(d.urls.get(otherCopies[i]!)?.attrs).toEqual({ [k]: `u-${k}` });
    });
  });

  it('numbers img elements 0..n-1 in document order, counts them, and records nothing for an element with nothing', () => {
    const d = detachUrls(treeOf('![a](a.png)\n\n- ![b](b.png)\n\n[![c](c.png)](d.md) text'));
    expect(d.images).toBe(3);
    const imgs = elements(d.tree).filter((e) => e.tagName === 'img');
    expect(imgs.map((e) => [e.properties['alt'], d.urls.get(e)?.imageIndex, d.urls.get(e)?.attrs['src']]))
      .toEqual([['a', 0, 'a.png'], ['b', 1, 'b.png'], ['c', 2, 'c.png']]);
    expect(imgs.every((e) => !Object.hasOwn(e.properties, 'src') && d.urls.get(e)?.highlight === null)).toBe(true);
    const a = elements(d.tree).find((e) => e.tagName === 'a')!;
    expect(d.urls.get(a)).toEqual({ attrs: { href: 'd.md' }, imageIndex: null, highlight: null });
    expect(elements(d.tree).filter((e) => e.tagName === 'p' || e.tagName === 'li').some((e) => d.urls.has(e))).toBe(false);
  });

  it('a second detach of the copy finds no URL (part 2 reuses the first copy and its map)', () => {
    const d = detachUrls(treeOf('[x](https://a.example/x)'));
    const again = detachUrls(d.tree);
    const a = elements(again.tree).find((e) => e.tagName === 'a')!;
    expect(again.urls.has(a)).toBe(false);
  });
});

describe('docsLocation: the one page-location builder (refinement (q))', () => {
  const page = pageAt('/docs/demo/specs/a.md?ref=ws/a&view=committed');

  it('keeps the page project and ref and applies the target; view is effective unless the target names it', () => {
    expect(docsLocation(page, { kind: 'index' })).toEqual({ kind: 'index' });
    expect(docsLocation(page, { kind: 'project' })).toEqual({ kind: 'project', project: 'demo', ref: { kind: 'bare', name: 'ws/a' } });
    expect(docsLocation(page, { kind: 'section', section: 'plans' }))
      .toEqual({ kind: 'section', project: 'demo', section: 'plans', ref: { kind: 'bare', name: 'ws/a' } });
    expect(docsLocation(page, { kind: 'path', section: 'plans', path: 'd', dirSlash: true })).toEqual({
      kind: 'path', project: 'demo', section: 'plans', path: 'd', dirSlash: true, ref: { kind: 'bare', name: 'ws/a' },
      view: 'effective', frame: 'inline',
    });
    expect(docsPageUrl(docsLocation(page, { kind: 'path', section: 'specs', path: 'a.md', dirSlash: false, view: 'committed' })))
      .toBe('/docs/demo/specs/a.md?ref=ws/a&view=committed');
  });

  it("default-view opens another project's default view from any page, the index included", () => {
    expect(docsLocation(pageAt('/docs'), { kind: 'default-view', project: 'b' })).toEqual({ kind: 'project', project: 'b', ref: null });
    expect(docsLocation(page, { kind: 'default-view', project: 'b' })).toEqual({ kind: 'project', project: 'b', ref: null });
  });

  it('the index names no project: any target that keeps one is a programming error', () => {
    expect(() => docsLocation(pageAt('/docs'), { kind: 'section', section: 'specs' })).toThrow(/index names no project/);
  });
});

describe('DocLink: doc links in-app (M4.U3; refinement (o))', () => {
  const want = docsPageUrl(docsLocation(pageAt('/docs/demo/specs/a.md?ref=ws/a&view=committed'),
    { kind: 'path', section: 'plans', path: 'p.md', dirSlash: false }));

  it('[x](../plans/p.md) from specs/a.md at ref ws/a links in-app with the ref kept and view dropped', () => {
    expect(want).toBe('/docs/demo/plans/p.md?ref=ws/a');
    const { container } = renderDoc('[x](../plans/p.md)');
    const a = firstLink(container);
    expect(a.getAttribute('href')).toBe(want);
    expect(a.hasAttribute('target')).toBe(false);
  });

  it('a plain click is prevented and pushes the page URL, and never opens a window', () => {
    const push = vi.spyOn(history, 'pushState');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = renderDoc('[x](../plans/p.md)');
    expect(fireEvent.click(firstLink(container))).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[2]).toBe(want);
    expect(location.pathname + location.search).toBe(want);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([['meta', { metaKey: true }], ['ctrl', { ctrlKey: true }], ['shift', { shiftKey: true }],
    ['alt', { altKey: true }], ['middle', { button: 1 }]] as const)('a %s click is left to the browser', (_name, init) => {
    const push = vi.spyOn(history, 'pushState');
    const { container } = renderDoc('[x](../plans/p.md)');
    let prevented: boolean | null = null;
    // Runs after React's root listener: it reads DocLink's decision, then stops jsdom's own navigation.
    window.addEventListener('click', (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true });
    fireEvent.click(firstLink(container), init);
    expect(prevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('a cross-doc fragment: the href carries #part-2, a plain click navigates without it and hands it to onFragment', () => {
    const push = vi.spyOn(history, 'pushState');
    const { container, ctx } = renderDoc('[x](../plans/p.md#part-2)');
    const a = firstLink(container);
    expect(a.getAttribute('href')).toBe(`${want}#part-2`);
    fireEvent.click(a);
    expect(push.mock.calls[0]?.[2]).toBe(want);
    expect(ctx.onFragment).toHaveBeenCalledWith('part-2', want);
    expect(location.hash).toBe('');
  });

  it('a link to THIS page spelled with its file name and a fragment is a fragment link: a click scrolls and pushes nothing', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const push = vi.spyOn(history, 'pushState');
    const d = detachUrls(treeOf('x'));
    for (const raw of ['a.md#sec', './a.md#sec', '../specs/a.md#sec']) {
      expect(docLinkTarget(ctxFor(d), raw)).toEqual({ kind: 'fragment', fragment: 'sec' });
    }
    const { container, ctx } = renderDoc('[x](a.md#sec)');
    const a = firstLink(container);
    expect(a.getAttribute('href')).toBe('#sec');
    const target = document.createElement('h2');
    target.id = 'sec';
    container.querySelector('article')!.append(target);
    expect(fireEvent.click(a)).toBe(false);
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(push).not.toHaveBeenCalled();
    expect(ctx.onFragment).not.toHaveBeenCalled();
  });

  it.each([
    ['the committed view (view=committed)', { kind: 'bare', name: 'ws/a' }, '/docs/demo/specs/a.md?ref=ws/a&view=committed'],
    ['a ref view, a bare ref', { kind: 'bare', name: 'ws/a' }, '/docs/demo/specs/a.md?ref=ws/a'],
    ['a ref view, a qualified ref', { kind: 'qualified', ref: 'refs/heads/ws/a' }, '/docs/demo/specs/a.md?ref=refs/heads/ws/a'],
  ] as const)('a same-page anchor on %s scrolls inside the view being read: no navigation, no history entry, and the href is the bare fragment', (_name, pageRef, url) => {
    expect(parseDocsRef(docsRefText(pageRef))).toEqual(pageRef);
    const view = url.endsWith('view=committed') ? 'committed' : 'effective';
    history.replaceState(null, '', url);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const push = vi.spyOn(history, 'pushState');
    const replace = vi.spyOn(history, 'replaceState');
    const before = history.length;
    const d = detachUrls(treeOf('x'));
    for (const raw of ['a.md#sec', '../specs/a.md#sec']) {
      expect(docLinkTarget(ctxFor(d, { pageRef, view }), raw)).toEqual({ kind: 'fragment', fragment: 'sec' });
    }
    const { container, ctx } = renderDoc('[x](a.md#sec)', { pageRef, view });
    const a = firstLink(container);
    // A bare fragment resolves against the URL being read, so the page's own view and ref stay in it.
    expect(a.getAttribute('href')).toBe('#sec');
    const target = document.createElement('h2');
    target.id = 'sec';
    container.querySelector('article')!.append(target);
    expect(fireEvent.click(a)).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(history.length).toBe(before);
    expect(ctx.onFragment).not.toHaveBeenCalled();
    expect(location.pathname + location.search + location.hash).toBe(url);
  });

  it('a link to this page with NO fragment stays a doc link, and a link to another page with the same file name too', () => {
    const d = detachUrls(treeOf('x'));
    expect(docLinkTarget(ctxFor(d), 'a.md')).toMatchObject({ kind: 'in-app', fragment: null });
    expect(docLinkTarget(ctxFor(d), '../plans/a.md#sec')).toMatchObject({ kind: 'in-app', fragment: 'sec' });
    expect(docLinkTarget(ctxFor(d), 'b.md#sec')).toMatchObject({ kind: 'in-app', fragment: 'sec' });
    expect(docLinkTarget(ctxFor(d, { path: 'dir/b.md' }), 'a.md#sec')).toMatchObject({ kind: 'in-app', fragment: 'sec' });
  });

  it('a doc link with no fragment hands none over', () => {
    const { container, ctx } = renderDoc('[x](../plans/p.md)');
    fireEvent.click(firstLink(container));
    expect(ctx.onFragment).not.toHaveBeenCalled();
  });
});

describe('DocLink: external links on tap only (M4.U4)', () => {
  it('an https link has target _blank and rel noopener noreferrer, and opens a window only when tapped', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const push = vi.spyOn(history, 'pushState');
    const { container } = renderDoc('[x](https://a.example/p)');
    const a = firstLink(container);
    expect(a.getAttribute('href')).toBe('https://a.example/p');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    expect(open).not.toHaveBeenCalled();
    expect(fireEvent.click(a)).toBe(false);
    expect(open).toHaveBeenCalledWith('https://a.example/p', '_blank', 'noopener,noreferrer');
    expect(push).not.toHaveBeenCalled();
  });

  const INERT: readonly (readonly [string, DocLinkInertReason])[] = [
    ['javascript:alert(1)', 'scheme'],
    ['/api/example/x', 'root-relative'],
    ['//evil.example/x', 'protocol-relative'],
    ['data:text/html,x', 'data'],
    ['blob:https://a.example/x', 'blob'],
    ['../../../../x.md', 'above-root'],
    ['', 'empty'],
  ];

  it.each(INERT)('[x](%s) renders span.doc-link-inert with no href, titled with its sentence and the raw target', (raw, why) => {
    const { container } = renderDoc(`[x](${raw})`);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelectorAll('[href]')).toHaveLength(0);
    const span = container.querySelector('span.doc-link-inert');
    expect(span?.textContent).toBe('x');
    expect(span?.getAttribute('title')).toBe(`${DOC_LINK_INERT_SENTENCE[why]}: ${raw}`);
  });

  it('[x](https://) is malformed because new URL refuses it, and its sentence says so (not only space, control or backslash)', () => {
    const { container } = renderDoc('[x](https://)');
    expect(container.querySelector('a')).toBeNull();
    const title = container.querySelector('span.doc-link-inert')?.getAttribute('title') ?? '';
    expect(title.startsWith('This link is not a well-formed URL')).toBe(true);
    expect(title).toBe(`${DOC_LINK_INERT_SENTENCE.malformed}: https://`);
    expect(DOC_LINK_INERT_SENTENCE.malformed).toMatch(/space.*control character.*backslash/);
    const d = detachUrls(treeOf('x'));
    expect(docLinkTarget(ctxFor(d), 'http://a:99999'))
      .toEqual({ kind: 'inert', title: `${DOC_LINK_INERT_SENTENCE.malformed}: http://a:99999` });
    expect(docLinkTarget(ctxFor(d), 'a b.md'))
      .toEqual({ kind: 'inert', title: `${DOC_LINK_INERT_SENTENCE.malformed}: a b.md` });
  });

  it('docLinkTarget answers the same words without rendering', () => {
    const d = detachUrls(treeOf('x'));
    expect(docLinkTarget(ctxFor(d), 'javascript:alert(1)'))
      .toEqual({ kind: 'inert', title: `${DOC_LINK_INERT_SENTENCE.scheme}: javascript:alert(1)` });
    expect(docLinkTarget(ctxFor(d), '#a')).toEqual({ kind: 'fragment', fragment: 'a' });
    expect(docLinkTarget(ctxFor(d), 'mailto:you@example.com')).toEqual({ kind: 'external', href: 'mailto:you@example.com' });
  });
});

describe('DocLink: an in-repo file outside the sections links to GitHub (spec 4.11 repo arm, 3.11)', () => {
  it('[r](../../../README.md) is a GitHub link built by githubBlobUrl, with the trailing mark, opened on tap', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const t = treeOk();
    const link = githubBlobUrl(t.github, t.ref, { kind: 'repo', repoPath: 'README.md' });
    expect(link).toEqual({ ok: true, url: 'https://github.com/example-org/example-repo/blob/main/README.md', note: null });
    const { container } = renderDoc('[r](../../../README.md)');
    const a = firstLink(container);
    expect(a.getAttribute('href')).toBe(link.ok ? link.url : null);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    expect(a.textContent).toBe('r ↗ GitHub');
    fireEvent.click(a);
    expect(open).toHaveBeenCalledWith(link.ok ? link.url : null, '_blank', 'noopener,noreferrer');
  });

  it('with no GitHub origin it is inert and says why', () => {
    const tree: DocsTreeOk = { ...treeOk(), github: { state: 'none' } };
    const { container } = renderDoc('[r](../../../README.md)', { tree });
    expect(container.querySelectorAll('[href]')).toHaveLength(0);
    expect(container.querySelector('span.doc-link-inert')?.getAttribute('title'))
      .toBe(`${DOC_LINK_INERT_SENTENCE['no-github-origin']}: ../../../README.md`);
  });
});

describe('DocLink: fragments scroll inside the article (M4.U7)', () => {
  const FOOTNOTE = 'See [1](#user-content-fn-1).\n\nA claim.[^1]\n\n[^1]: The note.\n';

  it('[1](#user-content-fn-1) scrolls the matching element inside the article and makes no history entry', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const push = vi.spyOn(history, 'pushState');
    const before = history.length;
    const { container } = renderDoc(FOOTNOTE);
    const a = firstLink(container);
    expect(a.getAttribute('href')).toBe('#user-content-fn-1');
    expect(fireEvent.click(a)).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('li#user-content-fn-1'));
    expect(history.length).toBe(before);
    expect(push).not.toHaveBeenCalled();
    expect(location.hash).toBe('');
  });

  it('a modifier click on an anchor is handled the same way: scrolled in the article, no history entry', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const before = history.length;
    const { container } = renderDoc(FOOTNOTE);
    expect(fireEvent.click(firstLink(container), { metaKey: true })).toBe(false);
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('li#user-content-fn-1'));
    expect(history.length).toBe(before);
  });

  it('the footnote reference keeps its id, so the back-reference finds it', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { container } = renderDoc(FOOTNOTE);
    const back = container.querySelector('a[href="#user-content-fnref-1"]');
    expect(back).not.toBeNull();
    fireEvent.click(back!);
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('a#user-content-fnref-1'));
  });

  it('an element with that id outside the article is never scrolled', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const outside = document.createElement('div');
    outside.id = 'elsewhere';
    document.body.append(outside);
    try {
      const { container } = renderDoc('[x](#elsewhere)');
      expect(fireEvent.click(firstLink(container))).toBe(false);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });
});

describe('fragments are compared as strings: no selector is built from document text', () => {
  it('a footnote label holding a dot: a tap on its reference scrolls the footnote li', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { container } = renderDoc('A claim.[^a.b]\n\n[^a.b]: The note.\n');
    const ref = container.querySelector('a[href="#user-content-fn-a.b"]');
    expect(ref).not.toBeNull();
    fireEvent.click(ref!);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('li[id="user-content-fn-a.b"]'));
  });

  it('an id that matches only once the fragment is percent-decoded is found (#%C3%A9 names the id "\u00e9")', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { container } = renderDoc('[x](#%C3%A9)');
    const h = document.createElement('h2');
    h.id = '\u00e9';
    container.querySelector('article')!.append(h);
    fireEvent.click(firstLink(container));
    expect(scroll.mock.contexts[0]).toBe(h);
  });

  it.each(['#%E0%A4%A', '#100%', '#a%zz', '#[x]', '#a%20b'])(
    'a fragment that is not a valid selector (%s) neither throws nor scrolls',
    (raw) => {
      const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent): void => { errors.push(e.error); e.preventDefault(); };
      window.addEventListener('error', onError);
      try {
        const { container } = renderDoc(`[x](${raw})`);
        expect(() => fireEvent.click(firstLink(container))).not.toThrow();
        expect(errors).toEqual([]);
        expect(scroll).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('error', onError);
      }
    },
  );
});

describe('no URL reaches the DOM except through DocLink (spec 4.11)', () => {
  const HOSTILE = [
    '[a](javascript:alert(1)) [b](/api/example/x) [c](//evil.example/x) [d](data:text/html,x)',
    '[e](blob:https://a.example/x) [f](../../../../x.md) [g](\\\\evil.example/x) [h](%01javascript:x)',
    'www.a.example <https://a.example/auto> [i](../plans/p.md) [j](#k) [r](../../../README.md)',
    '![m](/api/example/x.png) ![n](https://evil.example/x.png) ![o](../../README.png)',
  ].join('\n\n');

  it('control: without detachUrls the same tree draws an img whose src is an /api/ path', () => {
    const { container } = render(renderHast(treeOf(HOSTILE), { components: SHARED_COMPONENTS }));
    expect(container.querySelector('img[src="/api/example/x.png"]')).not.toBeNull();
  });

  it('detached and rendered with DocLink: no src anywhere, and every href is an a DocLink built', () => {
    const { container } = renderDoc(HOSTILE);
    expect(container.querySelectorAll('[src],[srcset],[action],[formaction],[poster],[cite],[ping],[data]')).toHaveLength(0);
    const hrefs = [...container.querySelectorAll('[href]')].map((e) => [e.tagName, e.getAttribute('href')]);
    // The backslash form arrives percent-encoded (`%5C`), so it names a file under specs: an in-app page, never a host.
    expect(hrefs).toEqual([
      ['A', '/docs/demo/specs/%5Cevil.example/x?ref=ws/a'],
      ['A', 'http://www.a.example/'],
      ['A', 'https://a.example/auto'],
      ['A', '/docs/demo/plans/p.md?ref=ws/a'],
      ['A', '#k'],
      ['A', 'https://github.com/example-org/example-repo/blob/main/README.md'],
    ]);
    expect(container.querySelectorAll('span.doc-link-inert')).toHaveLength(7);
  });
});

describe('DocLink outside a Docs page', () => {
  it('renders inert, with no href, when no DocLinkContext is provided', () => {
    const d = detachUrls(treeOf('[x](https://a.example/x)'));
    const { container } = render(renderHast(d.tree, { components: { ...SHARED_COMPONENTS, a: DocLink } }));
    expect(container.querySelectorAll('[href]')).toHaveLength(0);
    expect(container.querySelector('span.doc-link-inert')?.getAttribute('title')).toBe(DOC_LINK_OUTSIDE_PAGE);
  });
});
