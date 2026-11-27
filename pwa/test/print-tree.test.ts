// The print allow-list and the leaf print trees (X2 P6.1 Step 1; spec 4.6, "The print allow-list"). `printAllow` keeps a hast
// tree's elements and attributes by name and answers plain data; the render cases use the shared Markdown library's real output
// (highlight off, as the render job runs it) parsed by `parseRendered`, and the class and element lists are held equal to what
// the library's own conformance goldens emit. Mutation rows M11.46, M11.59, M11.61 and M11.62 each name a case here.
import { render } from '@synapsium-labs/pinax-lib/render';
import type { Element, ElementContent, Root } from 'hast';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leafPrintTree, printOffer } from '../src/docs/print/printTree';
import { PRINT_CLASSES, PRINT_ELEMENTS, PRINT_ID_PREFIX, printAllow, type PrintNode, type PrintTree } from '../src/lib/printAllow';
import { parseRendered } from '../src/lib/renderTree';

const EXPECTED = path.join(import.meta.dirname, '..', 'node_modules', '@synapsium-labs', 'pinax-lib', 'conformance', 'expected');

/** The tree of a Markdown source, as the render job's output goes through the allow-list. */
function printOf(md: string): PrintTree {
  const r = render(md, { highlight: false });
  if (r.outcome !== 'rendered') throw new Error(`fixture: ${r.outcome}`);
  return printAllow(parseRendered(r.html));
}

/** Every kept node, in document order (iterative: a tree can be deep). */
function all(t: PrintTree): PrintNode[] {
  const out: PrintNode[] = [];
  const stack: PrintNode[] = [...t.nodes].reverse();
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    out.push(n);
    if (n.t === 'el') for (let i = n.c.length - 1; i >= 0; i--) stack.push(n.c[i] as PrintNode);
  }
  return out;
}

type El = Extract<PrintNode, { t: 'el' }>;
const els = (t: PrintTree, n?: string): El[] => all(t).filter((x): x is El => x.t === 'el' && (n === undefined || x.n === n));
const textOf = (t: PrintTree): string => all(t).map((x) => (x.t === 'text' ? x.v : '')).join('');

const h = (tagName: string, properties: Element['properties'], ...children: ElementContent[]): Element =>
  ({ type: 'element', tagName, properties, children });
const tx = (value: string): ElementContent => ({ type: 'text', value });
const root = (...children: Root['children']): Root => ({ type: 'root', children });

/** The `.html` goldens under conformance/expected, every directory. */
function goldens(): string[] {
  return readdirSync(EXPECTED, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.html')).map((f) => path.join(EXPECTED, f));
}

describe('print tree', () => {
  it('print tree: the allow-list drops style, handlers and foreign URLs', () => {
    const t = printAllow(root(
      h('p', { style: 'color:red', onClick: 'alert(1)', onclick: 'alert(2)', dataLine: '3-4', xmlns: 'http://x' }, tx('plain '),
        h('a', { href: 'https://other.example/x', onMouseOver: 'x()' }, tx('away')),
        tx(' '),
        h('a', { href: '#top' }, tx('here')),
        tx(' '),
        h('img', { src: 'https://other.example/p.png', srcSet: 'a.png 1x', alt: 'pic' }),
        tx(' '),
        h('svg', { xmlns: 'http://www.w3.org/2000/svg', onLoad: 'x()' }, h('rect', { style: 'fill:red' }), h('text', {}, tx('in svg'))),
      ),
    ));
    const p = els(t, 'p')[0] as El;
    expect(p.a).toEqual({ dataLine: '3-4' });
    const links = els(t, 'a');
    expect(links[0]?.a).toEqual({ target: 'https://other.example/x' });
    expect(links[0]?.a.href).toBeUndefined();
    expect(links[1]?.a).toEqual({ href: '#docs-print-top' });
    const img = els(t, 'img')[0] as El;
    expect(img.a).toEqual({ alt: 'pic', imgRef: 'https://other.example/p.png' });
    expect(els(t, 'svg')).toEqual([]);
    expect(els(t, 'rect')).toEqual([]);
    expect(textOf(t)).toBe('plain away here  in svg');
    const json = JSON.stringify(t);
    for (const bad of ['style', 'onclick', 'onClick', 'onMouseOver', 'onLoad', 'srcSet', 'srcset', 'xmlns', 'src"']) expect(json).not.toContain(bad);
  });

  it('print tree: details open, sup, sub, kbd and comment anchors are elements', () => {
    const t = printOf([
      '<details>', '<summary>More</summary>', '', 'Inside text', '', '</details>', '',
      'x<sup>2</sup> and H<sub>2</sub>O, press <kbd>Ctrl</kbd>.', '',
      '<!-- id:top -->', '', 'After the anchor.', '',
    ].join('\n'));
    const det = els(t, 'details');
    expect(det).toHaveLength(1);
    expect((det[0] as El).a.open).toBe(true);
    expect(els(t, 'summary')).toHaveLength(1);
    expect(textOf({ nodes: (els(t, 'summary')[0] as El).c })).toBe('More');
    expect(els(t, 'sup').map((e) => textOf({ nodes: e.c }))).toEqual(['2']);
    expect(els(t, 'sub').map((e) => textOf({ nodes: e.c }))).toEqual(['2']);
    expect(els(t, 'kbd').map((e) => textOf({ nodes: e.c }))).toEqual(['Ctrl']);
    const anchor = els(t, 'span').find((e) => e.a.className?.includes('doc-anchor'));
    expect(anchor?.a.id).toBe('docs-print-top');
  });

  it('print tree: every id is prefixed and in-doc links follow', () => {
    const t = printOf(['## Location', '', '<!-- id:top -->', '', 'Back to [the top](#top) and [here](#location).', ''].join('\n'));
    expect(PRINT_ID_PREFIX).toBe('docs-print-');
    const heading = els(t, 'h2')[0] as El;
    expect(heading.a.id).toBe('docs-print-location');
    expect(els(t, 'span').find((e) => e.a.className?.includes('doc-anchor'))?.a.id).toBe('docs-print-top');
    expect(els(t, 'a').map((e) => e.a.href)).toEqual(['#docs-print-top', '#docs-print-location']);
    // Every id in the tree carries the prefix; none lands bare.
    const ids = els(t).flatMap((e) => (e.a.id === undefined ? [] : [e.a.id]));
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(id.startsWith('docs-print-')).toBe(true);
    // A caller's own prefix replaces the default, links and ids alike.
    const own = printAllow(root(h('h2', { id: 'a' }, tx('A')), h('p', {}, h('a', { href: '#a' }, tx('x')))), { idPrefix: 'p1-' });
    expect(els(own, 'h2')[0]?.a.id).toBe('p1-a');
    expect(els(own, 'a')[0]?.a.href).toBe('#p1-a');
  });

  it('print tree: a class outside the library\'s vocabulary is dropped', () => {
    const t = printAllow(root(
      h('div', { className: ['gh-alert', 'console-sidebar', 'gh-note', 'doc-anchor-x'] }, tx('x')),
      h('p', { className: ['evil'] }, tx('y')),
      h('p', { class: 'gh-tip bad' }, tx('z')),
      h('input', { type: 'checkbox', className: ['task-list-item-checkbox', 'bad'] }),
    ));
    expect(els(t, 'div')[0]?.a.className).toEqual(['gh-alert', 'gh-note']);
    expect(els(t, 'p')[0]?.a.className).toBeUndefined();
    expect('className' in (els(t, 'p')[0] as El).a).toBe(false);
    expect(els(t, 'p')[1]?.a.className).toEqual(['gh-tip']);
    expect(els(t, 'input')[0]?.a.className).toEqual(['task-list-item-checkbox']);
  });

  it('print tree: the class vocabulary equals the classes the library\'s conformance output emits', () => {
    const files = goldens();
    expect(files.length).toBeGreaterThan(30);
    const seen = new Set<string>();
    for (const f of files) {
      const stack: unknown[] = [parseRendered(readFileSync(f, 'utf8'))];
      for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
        const node = n as { type: string; properties?: { className?: unknown }; children?: unknown[] };
        if (node.type === 'element' && Array.isArray(node.properties?.className)) for (const c of node.properties.className) seen.add(String(c));
        if (node.children) stack.push(...node.children);
      }
    }
    expect([...seen].sort()).toEqual([...PRINT_CLASSES].sort());
    expect(Object.isFrozen(PRINT_CLASSES)).toBe(true);
    expect(new Set(PRINT_CLASSES).size).toBe(PRINT_CLASSES.length);
  });

  it('print tree: the element list equals the elements the library\'s conformance output emits', () => {
    const seen = new Set<string>();
    for (const f of goldens()) {
      const stack: unknown[] = [parseRendered(readFileSync(f, 'utf8'))];
      for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
        const node = n as { type: string; tagName?: string; children?: unknown[] };
        if (node.type === 'element' && node.tagName !== undefined) seen.add(node.tagName);
        if (node.children) stack.push(...node.children);
      }
    }
    expect([...seen].sort()).toEqual([...PRINT_ELEMENTS].sort());
    expect(Object.isFrozen(PRINT_ELEMENTS)).toBe(true);
    expect(new Set(PRINT_ELEMENTS).size).toBe(PRINT_ELEMENTS.length);
    // A task list's checkbox is kept, and only ever as a disabled checkbox.
    const t = printOf('- [x] done\n- [ ] open\n');
    const boxes = els(t, 'input');
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.a)).toEqual([
      { type: 'checkbox', disabled: true, checked: true, className: ['task-list-item-checkbox'] },
      { type: 'checkbox', disabled: true, className: ['task-list-item-checkbox'] },
    ]);
    // An input that is not a checkbox is dropped, and a checkbox the document made enabled prints disabled.
    const odd = printAllow(root(h('p', {}, h('input', { type: 'text', value: 'x' }), h('input', { type: 'checkbox', checked: false, onChange: 'x()' }))));
    expect(els(odd, 'input').map((b) => b.a)).toEqual([{ type: 'checkbox', disabled: true }]);
  });

  it('print tree: a table cell\'s alignment survives as align, its style does not', () => {
    const t = printOf('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n');
    const heads = els(t, 'th');
    expect(heads.map((e) => e.a.align)).toEqual(['left', 'center', 'right']);
    expect(JSON.stringify(t)).not.toContain('style');
    const hand = printAllow(root(
      h('td', { style: 'text-align:center' }, tx('a')),
      h('td', { style: ' text-align : right ; ' }, tx('b')),
      h('td', { style: 'text-align:center;color:red' }, tx('c')),
      h('td', { style: 'text-align:justify' }, tx('d')),
      h('td', { align: 'RIGHT', style: 'text-align:left' }, tx('e')),
      h('td', { colSpan: 2, rowSpan: '3' }, tx('f')),
      h('td', { colSpan: 0, rowSpan: 1001 }, tx('g')),
      h('td', { colspan: 'x', rowspan: -1 }, tx('h')),
    ));
    expect(els(hand, 'td').map((e) => e.a)).toEqual([
      { align: 'center' }, { align: 'right' }, {}, {}, { align: 'right' }, { colSpan: 2, rowSpan: 3 }, {}, {},
    ]);
  });

  it('print tree: an ordered list keeps its start', () => {
    const t = printOf('3. three\n4. four\n\n- bullet\n');
    expect(els(t, 'ol')[0]?.a.start).toBe(3);
    expect(els(t, 'ul')[0]?.a.start).toBeUndefined();
    const hand = printAllow(root(
      h('ol', { start: '0' }), h('ol', { start: -2 }), h('ol', { start: 'x' }), h('ol', { start: 5 }), h('ul', { start: 9 }),
    ));
    expect(els(hand).map((e) => e.a.start)).toEqual([0, undefined, undefined, 5, undefined]);
  });

  it('print tree: an img keeps its ref, never its src', () => {
    const t = printOf('![the alt](pic.png "the title") and ![d](data:image/png;base64,AAAA)\n');
    const imgs = els(t, 'img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]?.a).toMatchObject({ alt: 'the alt', title: 'the title', imgRef: 'pic.png' });
    for (const i of imgs) expect('src' in i.a).toBe(false);
    expect(JSON.stringify(t)).not.toContain('"src"');
    // A src on any other element is not a ref.
    const other = printAllow(root(h('div', { src: 'x.png' }), h('a', { src: 'y.png', href: '#z' })));
    expect(JSON.stringify(other)).not.toContain('png');
  });

  it('print tree: script and style subtrees print nothing', () => {
    const t = printAllow(root(
      h('p', {}, tx('keep '), h('script', {}, tx('steal()')), h('style', {}, tx('p{}')), tx('this')),
      h('template', {}, h('p', {}, tx('tpl'))), h('noscript', {}, tx('ns')), h('iframe', {}, tx('fr')),
      h('object', {}, tx('ob')), h('embed', {}), h('font', {}, tx(' and font text')), h('del', {}, tx(' struck')),
      { type: 'comment', value: 'gone' }, { type: 'doctype' },
    ));
    expect(textOf(t)).toBe('keep this and font text struck');
    expect(els(t).map((e) => e.n)).toEqual(['p']);
  });

  it('print tree: printAllow never throws on a malformed tree', () => {
    const bad = (x: unknown): PrintTree => printAllow(x as Root);
    expect(bad(null).nodes).toEqual([]);
    expect(bad(undefined).nodes).toEqual([]);
    expect(bad(7).nodes).toEqual([]);
    expect(bad({}).nodes).toEqual([]);
    expect(bad({ type: 'root' }).nodes).toEqual([]);
    expect(bad({ type: 'root', children: 'x' }).nodes).toEqual([]);
    expect(bad({ type: 'root', children: [null, 3, 'x', [], { type: 'text' }, { type: 'text', value: 4 }, { type: 'element' }, { type: 'element', tagName: 7 }] }).nodes).toEqual([]);
    // Properties of the wrong types, or none at all.
    const wrong = bad(root(
      h('p', null as never, tx('a')),
      h('p', { id: 3, className: 7, dataLine: 5, alt: {}, title: [], href: 4, src: 1, colSpan: {}, start: null, align: 9, style: 3 } as never, tx('b')),
      h('a', { href: '#' }, tx('c')),
      h('a', { href: '' }, tx('d')),
      { type: 'element', tagName: 'div', children: [{ type: 'element', tagName: 'p' }] } as never,
      { type: 'element', tagName: 'p', properties: 'x', children: null } as never,
    ));
    expect(els(wrong, 'a').map((e) => e.a)).toEqual([{ target: '#' }, { target: '' }]);
    expect(els(wrong, 'p').slice(0, 2).map((e) => e.a)).toEqual([{}, {}]);
    // A cycle and a throwing getter do not loop or throw.
    const loop = h('div', {});
    loop.children = [loop, tx('x')];
    expect(textOf(bad(root(loop)))).toBe('x');
    const trap = { type: 'element', tagName: 'p', get children(): never { throw new Error('boom'); }, get properties(): never { throw new Error('boom'); } };
    expect(() => bad(root(trap as never))).not.toThrow();
    // 5 000 levels of nesting: the walk is iterative.
    let deep: Element = h('p', {}, tx('bottom'));
    for (let i = 0; i < 5000; i++) deep = h('div', {}, deep);
    const t = bad(root(deep));
    let depth = 0;
    for (let n: PrintNode | undefined = t.nodes[0]; n !== undefined && n.t === 'el'; n = n.c[0]) depth++;
    expect(depth).toBe(5001);
    expect(textOf(t)).toBe('bottom');
  });
});

describe('print leaves', () => {
  it('print: an image leaf prints its loaded image through printAllow', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const t = leafPrintTree({ kind: 'image', src: svg, name: 'logo.svg' });
    expect(t.nodes).toHaveLength(1);
    const fig = t.nodes[0] as El;
    expect(fig.n).toBe('figure');
    const img = els(t, 'img')[0] as El;
    expect(img.a).toEqual({ alt: 'logo.svg', imgRef: svg });
    expect('src' in img.a).toBe(false);
    expect(textOf({ nodes: (els(t, 'figcaption')[0] as El).c })).toBe('logo.svg');
  });

  it('print: a text leaf holding markup prints it as text in one pre', () => {
    const src = '<b>x</b> & <script>';
    const t = leafPrintTree({ kind: 'text', text: src, name: 'a.txt', part: null });
    expect(t.nodes).toHaveLength(1);
    const pre = t.nodes[0] as El;
    expect(pre.n).toBe('pre');
    expect(pre.c).toEqual([{ t: 'text', v: src }]);
    expect(els(t).map((e) => e.n)).toEqual(['pre']);
    // A text read in parts says which part, as plain text in a paragraph above the pre.
    const part = leafPrintTree({ kind: 'text', text: '<i>', name: 'a.txt', part: { k: 2, n: 5 } });
    expect(part.nodes.map((n) => (n.t === 'el' ? n.n : 'text'))).toEqual(['p', 'pre']);
    expect(textOf({ nodes: [part.nodes[0] as PrintNode] })).toBe('Part 2 of 5');
  });

  it('print: a PDF or an HTML page offers Download to print', () => {
    expect(printOffer('pdf')).toBe('download-to-print');
    expect(printOffer('html')).toBe('download-to-print');
    for (const c of ['markdown', 'raster', 'svg', 'text', 'other'] as const) expect(printOffer(c)).toBe('print');
  });
});
