// `renderHast` (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10 and section 4.15's M4.P10 and M4.P5).
// M4.P10: a tree from `parseMarkdown`, rendered through `renderHast` with chat's components and react-markdown's
// `defaultUrlTransform`, is byte-identical to `<Markdown remarkPlugins={[remarkGfm, remarkAlerts]}
// components={CHAT_COMPONENTS}>` over the whole chat corpus (Task 1's `markdownCorpus.ts`, its language cases
// re-derived from the grammars `lib/markdown.tsx` registers) and a few cases the corpus does not carry. M4.P5: raw
// HTML is visible text on both paths, never an element. Then renderHast's own contract: the url clause runs only
// when a transform is given, only on url attributes, and never writes the caller's tree.
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import Markdown, { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import type { Root as HastRoot } from 'hast';
import { CHAT_COMPONENTS, ChatMarkdown } from '../src/lib/markdown';
import { remarkAlerts } from '../src/lib/remarkAlerts';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';
import {
  CHAT_ALIAS_TAGS, CHAT_CORPUS, CHAT_UNREGISTERED_TAGS, RECAP_CASE, languageCases, type CorpusCase,
} from './markdownCorpus';

afterEach(cleanup);

const treeOf = (o: ParseOutcome): HastRoot => {
  if (o.kind !== 'tree') throw new Error(`expected a tree, got ${JSON.stringify(o)}`);
  return o.tree;
};

/** The sync path: what chat renders for a message of at most 4 KiB, react-markdown end to end. */
const viaMarkdown = (src: string): string =>
  renderToStaticMarkup(
    <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{src}</Markdown>,
  );

/** The worker path: `parseMarkdown`'s tree through `renderHast`, as chat renders a longer message. */
const viaRenderHast = (src: string): string =>
  renderToStaticMarkup(
    renderHast(treeOf(parseMarkdown(src)), { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }),
  );

// The language cases exactly as the golden builds them: every registered grammar (measured, importing
// lib/markdown.tsx registers them), every alias, every unregistered tag.
const TAGS: readonly string[] = [
  ...new Set([...[...hljs.listLanguages()].sort(), ...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS]),
];

// Parity cases the corpus does not carry, each about a clause post() applies or a shape the parse could split.
const EXTRA: readonly CorpusCase[] = [
  { name: 'javascript-link-and-image', text: '[go](javascript:alert(1)) and ![pic](javascript:alert(1))' },
  { name: 'data-image', text: '![dot](data:image/png;base64,AAAA)' },
  { name: 'nested-lists', text: '- a\n  - b\n    1. c\n    2. d\n       - e\n- f' },
  { name: 'footnote', text: 'Claim.[^n]\n\n[^n]: The note, with [a link](https://example.com/n).' },
  { name: 'colon-in-a-fence-info', text: '```a:b\nx\n```' },
  { name: 'link-title-with-a-colon', text: '[t](https://example.com/t "note: javascript:x")' },
];

describe('M4.P10: renderHast over parseMarkdown equals <Markdown> with chat components', () => {
  const cases: readonly CorpusCase[] = [...CHAT_CORPUS, ...languageCases(TAGS), RECAP_CASE, ...EXTRA];

  it('covers the corpus, every language tag and the extra cases', () => {
    expect(TAGS.length).toBeGreaterThan(CHAT_ALIAS_TAGS.length + CHAT_UNREGISTERED_TAGS.length);
    expect(cases.length).toBe(CHAT_CORPUS.length + TAGS.length + 1 + EXTRA.length);
  });

  it.each(cases)('$name', (c) => {
    expect(viaRenderHast(c.text)).toBe(viaMarkdown(c.text));
  });

  it('the javascript: link and image are blanked on both paths, not just equal', () => {
    const out = viaRenderHast(EXTRA[0]!.text);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href=""');
  });
});

const RAW = '<img src=x onerror=alert(1)>\n\n<script>x</script>\n\nreach <server-host> on port 22';
const RAW_TEXTS: readonly string[] = ['<img src=x onerror=alert(1)>', '<script>x</script>', '<server-host>'];

describe('M4.P5: raw HTML renders as visible text, never as markup', () => {
  const check = (container: HTMLElement): void => {
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('script')).toHaveLength(0);
    for (const t of RAW_TEXTS) expect(container.textContent, t).toContain(t);
  };

  it('through renderHast (the worker path)', () => {
    const tree = treeOf(parseMarkdown(RAW));
    check(render(renderHast(tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform })).container);
  });

  it('through ChatMarkdown (the sync path)', () => {
    check(render(<ChatMarkdown text={RAW} />).container);
  });
});

describe("renderHast's url clause", () => {
  /** Components that print what they were given, so React's own handling of a URL cannot hide it. */
  const PROBE: Components = {
    a: ({ href, title, children }) => <span data-href={href} data-title={title}>{children}</span>,
    img: ({ src }) => <span data-src={typeof src === 'string' ? src : ''} />,
  };
  const src = '[go](javascript:alert(1) "note: javascript:x") ![pic](javascript:alert(2))';

  it('without urlTransform, every URL reaches the components as written (the caller decides)', () => {
    const out = renderToStaticMarkup(renderHast(treeOf(parseMarkdown(src)), { components: PROBE }));
    expect(out).toContain('data-href="javascript:alert(1)"');
    expect(out).toContain('data-src="javascript:alert(2)"');
  });

  it('with defaultUrlTransform, url attributes are blanked and other attributes are untouched', () => {
    const out = renderToStaticMarkup(
      renderHast(treeOf(parseMarkdown(src)), { components: PROBE, urlTransform: defaultUrlTransform }),
    );
    expect(out).toContain('data-href=""');
    expect(out).toContain('data-src=""');
    expect(out).toContain('data-title="note: javascript:x"');
  });

  it('calls the transform once per url attribute, with the key and the element, as post() does', () => {
    const calls: string[] = [];
    const spy: UrlTransform = (url, key, node) => {
      calls.push(`${node.tagName} ${key} ${url}`);
      return url;
    };
    const md = '[a](https://example.com/a "t: x") ![b](https://example.com/b.png "u: y")\n\n```ts\nx\n```';
    renderToStaticMarkup(renderHast(treeOf(parseMarkdown(md)), { components: CHAT_COMPONENTS, urlTransform: spy }));
    expect(calls.sort()).toEqual(['a href https://example.com/a', 'img src https://example.com/b.png']);
  });

  it('applies a url key only to the elements html-url-attributes lists it for', () => {
    // `cite` is a url attribute of blockquote, del, ins and q only. Markdown never puts one on a div, so the tree is
    // built by hand; the components print what they receive through `node`.
    const tree: HastRoot = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'blockquote', properties: { cite: 'javascript:a' }, children: [] },
        { type: 'element', tagName: 'div', properties: { cite: 'javascript:b' }, children: [] },
      ],
    };
    const PRINT: Components = {
      blockquote: ({ node }) => <span data-cite={String(node?.properties['cite'])} />,
      div: ({ node }) => <span data-cite={String(node?.properties['cite'])} />,
    };
    expect(renderToStaticMarkup(renderHast(tree, { components: PRINT, urlTransform: defaultUrlTransform }))).toBe(
      '<span data-cite=""></span><span data-cite="javascript:b"></span>',
    );
  });

  it('passes each element to the components as `node`', () => {
    const NODE: Components = { p: ({ node, children }) => <p data-tag={node?.tagName}>{children}</p> };
    expect(renderToStaticMarkup(renderHast(treeOf(parseMarkdown('hi')), { components: NODE }))).toBe(
      '<p data-tag="p">hi</p>',
    );
  });
});

describe('renderHast never writes the tree it is given', () => {
  it('a tree rendered with a transform deep-equals its clone from before, and renders the same twice', () => {
    const md = [
      '[go](javascript:alert(1)) ![pic](https://example.com/p.png) <https://example.com/auto>',
      '',
      '> [!NOTE]',
      '> A callout with a footnote.[^f]',
      '',
      '[^f]: The note.',
    ].join('\n');
    const tree = treeOf(parseMarkdown(md));
    const before = structuredClone(tree);
    const first = renderToStaticMarkup(
      renderHast(tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }),
    );
    expect(tree).toEqual(before);
    expect(
      renderToStaticMarkup(renderHast(tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform })),
    ).toBe(first);
    expect(renderToStaticMarkup(renderHast(tree, { components: CHAT_COMPONENTS }))).toContain('javascript:');
  });
});

/** `levels` nested emphasis spans (root > p > em x levels > text), as `markdown-parse.test.ts` builds them. */
function nestedEmphasis(levels: number): string {
  let open = '';
  let close = '';
  for (let i = 0; i < levels; i += 1) {
    const mark = i % 2 === 0 ? '*' : '_';
    open += `${mark}a `;
    close = ` a${mark}${close}`;
  }
  return `${open}x${close}`;
}

describe('a tree at the depth cap renders', () => {
  it('62 nested emphasis spans, a tree 64 deep, render 62 em elements', () => {
    const outcome = parseMarkdown(nestedEmphasis(62));
    expect(outcome).toMatchObject({ kind: 'tree', depth: 64 });
    const out = renderToStaticMarkup(
      renderHast(treeOf(outcome), { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }),
    );
    expect(out.match(/<em>/g)).toHaveLength(62);
  });
});
