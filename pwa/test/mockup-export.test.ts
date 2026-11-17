// Native Docs reader, completion plan Task 9 (C2): the mockup export's snapshot (`mockup/exportMockup.ts`; base spec
// 2026-10-01 5.6.9 Steps 2-6 and "What is guaranteed"; rows M5.EX1 and M5.EX2). Every page is parsed by the real
// `parseMockup`, every asset result comes from the real planner and loader over a fake reader, and the snapshot's output
// is parsed again by `parseMockup` so this file holds no parser of its own. Placeholders only: the hostile hosts are
// `x.example` (a request to it is a leak), `link.example` (a link target, which the snapshot moves into `title`) and
// `cdn.example`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { docRepoPath, docsApi, type DocPin, type DocsEntry } from '../../shared/docs';
import { EXPORT_MISSING_SENTENCE } from '../src/docs/docsText';
import { DOCS_EXPORT_CSP, EXPORT_PREFIX } from '../src/docs/export/policy';
import { buildMockupSnapshot } from '../src/docs/mockup/exportMockup';
import { extractMockupRefs, loadMockupAssets } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import { MOCKUP_MAX_CSS_DEPTH } from '../src/docs/mockup/policy';
import type { MockupAssetReader, MockupAssetResult, MockupContext } from '../src/docs/mockup/ports';
import { COMMIT_A, SERVED, entry, holder, treeOk } from './docsFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const MIB = 1024 * 1024;
const PAGE_BASE = 'specs/m.html' as const;
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const b64 = (s: string): string => btoa(s);
const repo = (path: string): string => docRepoPath('specs', path);

type Files = Record<string, string | Uint8Array<ArrayBuffer> | { failed: string }>;

const sized = (path: string, size: number): DocsEntry =>
  entry('specs', path, { committed: { kind: 'file', blob: '1'.repeat(40), size } });

function ctxOf(entries: DocsEntry[]): MockupContext {
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'm.html' };
  return { project: 'demo', pin, tree: treeOk({ entries: [entry('specs', 'm.html'), ...entries], drafts: holder() }) };
}

function readerOf(files: Files): MockupAssetReader {
  return {
    read: async (pin) => {
      const r = files[pin.path];
      if (r === undefined) return { kind: 'failed', failure: 'not-found' };
      if (typeof r === 'string') return { kind: 'ok', bytes: enc(r) };
      if (r instanceof Uint8Array) return { kind: 'ok', bytes: r };
      return { kind: 'failed', failure: r.failed };
    },
  };
}

const lengthOf = (r: Files[string]): number => (typeof r === 'string' ? r.length : r instanceof Uint8Array ? r.length : 1);

interface Run {
  readonly doc: Document;
  readonly result: MockupAssetResult;
  readonly out: ReturnType<typeof buildMockupSnapshot>;
  readonly before: string;
}

/** The page parsed, its references planned and loaded through `files`, then snapshotted. `edit` may change the loaded
 *  result before the snapshot (a caller that leaves an asset out). */
async function run(html: string, files: Files = {}, edit?: (r: MockupAssetResult) => MockupAssetResult): Promise<Run> {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('the pre-scan refused the fixture');
  const { doc } = parsed;
  const refs = extractMockupRefs(doc, PAGE_BASE).refs;
  const entries = Object.entries(files).map(([path, f]) => sized(path, lengthOf(f)));
  const plan = planMockupAssets(refs, ctxOf(entries));
  const loaded = await loadMockupAssets(plan, readerOf(files), new AbortController().signal);
  const result = edit === undefined ? loaded : edit(loaded);
  const before = doc.documentElement.outerHTML;
  return { doc, result, out: buildMockupSnapshot(doc, result), before };
}

/** The snapshot's own document, parsed with the one parser. */
function innerOf(html: string): Document {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('the pre-scan refused the snapshot');
  return parsed.doc;
}

const page = (body: string, head = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const attrsOf = (doc: Document): Array<{ el: Element; name: string; value: string }> =>
  [...doc.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => ({ el, name: a.name, value: a.value })));

const decodeDataUrl = (url: string): string => {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(url);
  if (m === null) throw new Error(`not a base64 data: URL: ${url.slice(0, 60)}`);
  return atob(m[1]!);
};

// ---------------------------------------------------------------------------------------------------------------
// M5.EX1: one planted element per strip step, each with its own assertion
// ---------------------------------------------------------------------------------------------------------------
describe('M5.EX1: every strip step, one planted element each (base 5.6.9 Step 3 and 4)', () => {
  type Check = (inner: Document, html: string) => void;
  const cases: Array<[string, string, string, Check]> = [
    ['script (inline, external and SVG)',
      '<script>window.leak = "https://x.example/inline"</script><script src="https://x.example/a.js"></script><svg><script>1</script></svg><p id="k">kept</p>', '',
      (d) => {
        expect(d.querySelectorAll('script')).toHaveLength(0);
        expect(d.getElementById('k')?.textContent).toBe('kept');
      }],
    ['an on* attribute',
      '<p id="p" onclick="alert(1)" onmouseover="x()" ONFOCUS="y()" title="t">text</p><svg><circle onload="z()" r="1"/></svg>', '',
      (d) => {
        expect(attrsOf(d).filter((a) => a.name.toLowerCase().startsWith('on'))).toEqual([]);
        expect(d.getElementById('p')?.getAttribute('title')).toBe('t');
        expect(d.getElementById('p')?.textContent).toBe('text');
      }],
    ['template',
      '<template><p id="in-template">template-text</p></template><p id="out">out</p>', '',
      (d, html) => {
        expect(d.querySelectorAll('template')).toHaveLength(0);
        expect(html).not.toContain('template-text');
        expect(d.getElementById('out')).not.toBeNull();
      }],
    ['noscript (unwrapped, its child kept)',
      '<noscript><p id="ns">inside-noscript</p></noscript>', '',
      (d) => {
        expect(d.querySelectorAll('noscript')).toHaveLength(0);
        expect(d.getElementById('ns')?.textContent).toBe('inside-noscript');
      }],
    ['<base href>', '<p>b</p>', '<base href="https://x.example/base/" target="_top">',
      (d) => { expect(d.querySelectorAll('base')).toHaveLength(0); }],
    ['<meta http-equiv=refresh>', '<p>m</p>', '<meta http-equiv="refresh" content="0;url=https://x.example/">',
      (d) => { expect(d.querySelectorAll('meta[http-equiv="refresh" i]')).toHaveLength(0); }],
    ['an author <meta http-equiv=Content-Security-Policy>', '<p>c</p>',
      '<meta http-equiv="Content-Security-Policy" content="default-src *; script-src *">',
      (d) => {
        const all = [...d.querySelectorAll('meta[http-equiv]')];
        expect(all).toHaveLength(1);
        expect(all[0]!.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
      }],
    ['iframe srcdoc and src', '<iframe srcdoc="<p>nested</p>" src="https://x.example/f.html"></iframe><p>i</p>', '',
      (d, html) => {
        expect(d.querySelectorAll('iframe, frame')).toHaveLength(0);
        expect(html).not.toContain('srcdoc');
      }],
    ['object data', '<object data="https://x.example/o.swf" type="application/x-shockwave-flash">fallback</object>', '',
      (d) => { expect(d.querySelectorAll('object')).toHaveLength(0); }],
    ['embed src', '<embed src="https://x.example/e.swf">', '',
      (d) => { expect(d.querySelectorAll('embed')).toHaveLength(0); }],
    ['link rel=preload to https', '<p>p</p>', '<link rel="preload" href="https://x.example/p.css" as="style">',
      (d) => { expect(d.querySelectorAll('link[rel~="preload" i]')).toHaveLength(0); }],
    ['link rel=prefetch to https', '<p>p</p>', '<link rel="prefetch" href="https://x.example/next.html"><link rel="icon" href="https://x.example/i.ico">',
      (d) => { expect(d.querySelectorAll('link')).toHaveLength(0); }],
    ['a ping', '<a id="a" href="https://link.example/p" ping="https://x.example/ping">p</a>', '',
      (d) => {
        expect(d.getElementById('a')?.hasAttribute('ping')).toBe(false);
        expect(attrsOf(d).filter((a) => a.name === 'ping')).toEqual([]);
      }],
    ['form action', '<form id="f" action="https://x.example/f" method="post"><input name="q"></form>', '',
      (d) => {
        expect(d.getElementById('f')).not.toBeNull();
        expect(attrsOf(d).filter((a) => a.name === 'action')).toEqual([]);
      }],
    ['button formaction', '<form><button id="b" formaction="https://x.example/b">go</button><input type="submit" formaction="https://x.example/s"></form>', '',
      (d) => {
        expect(d.getElementById('b')?.textContent).toBe('go');
        expect(attrsOf(d).filter((a) => a.name === 'formaction')).toEqual([]);
      }],
    ['video poster to https', '<video id="v" poster="https://x.example/poster.png" src="https://x.example/v.mp4" controls></video>', '',
      (d) => {
        const v = d.getElementById('v')!;
        expect(v.hasAttribute('poster')).toBe(false);
        expect(v.hasAttribute('src')).toBe(false);
      }],
    ['a mixed srcset', '<img id="i" srcset="data:image/png;base64,AAAA 1x, https://x.example/2.png 2x" alt="m">', '',
      (d) => { expect(d.getElementById('i')?.hasAttribute('srcset')).toBe(false); }],
    // The srcset grammar (`parseSrcset`, load.ts) drops a candidate whose descriptors it cannot read; its URL is not
    // known to be data:, so the attribute goes (coordinator mail 22461: the extractor's grammar, one srcset parser).
    ['a srcset whose non-data candidate has a descriptor the grammar drops', '<img id="i" srcset="data:image/png;base64,AAAA 1x, https://x.example/2.png 2q" alt="m">', '',
      (d) => { expect(d.getElementById('i')?.hasAttribute('srcset')).toBe(false); }],
    ['an SMIL href animation',
      '<svg><rect id="r" width="1" height="1"><animate attributeName="href" to="https://x.example/a"/><set attributeName="xlink:href" to="https://x.example/b"/>'
      + '<animateMotion attributeName="href" to="https://x.example/c"/><animateTransform attributeName="href" to="https://x.example/d"/>'
      + '<animate id="ok" attributeName="opacity" from="0" to="1"/></rect></svg>', '',
      (d) => {
        expect(d.querySelectorAll('animate, set, animateMotion, animateTransform')).toHaveLength(1);
        expect(d.getElementById('ok')).not.toBeNull();
      }],
    ['SVG <image href="https://x.example/p.png">', '<svg><image id="im" href="https://x.example/p.png" xlink:href="https://x.example/q.png" width="1" height="1"/></svg>', '',
      (d) => {
        const im = d.getElementById('im')!;
        expect(im.hasAttribute('href')).toBe(false);
        expect(im.hasAttribute('xlink:href')).toBe(false);
      }],
    ['SVG <image href="#local"> (a fragment stays only off a and image)', '<svg><symbol id="a"/><image id="im" href="#a" xlink:href="#a" width="1" height="1"/></svg>', '',
      (d) => {
        expect(d.getElementById('im')?.hasAttribute('href')).toBe(false);
        expect(d.getElementById('im')?.hasAttribute('xlink:href')).toBe(false);
      }],
    ['SVG <use href="https://x.example/s.svg#a"> (and a same-document one that stays)',
      '<svg><symbol id="a"><circle r="1"/></symbol><use id="u1" href="https://x.example/s.svg#a"/><use id="u2" href="#a"/><use id="u3" xlink:href="https://x.example/s.svg#a"/><use id="u4" xlink:href="#a"/></svg>', '',
      (d) => {
        expect(d.getElementById('u1')?.hasAttribute('href')).toBe(false);
        expect(d.getElementById('u2')?.getAttribute('href')).toBe('#a');
        expect(d.getElementById('u3')?.hasAttribute('xlink:href')).toBe(false);
        expect(d.getElementById('u4')?.getAttribute('xlink:href')).toBe('#a');
      }],
    ['fill="url(https://x.example/g.svg#g)"', '<svg><rect id="r" width="1" height="1" fill="url(https://x.example/g.svg#g)" stroke="url(#local)"/></svg>', '',
      (d) => {
        expect(d.getElementById('r')?.getAttribute('fill')).toBe('url("data:,")');
        expect(d.getElementById('r')?.getAttribute('stroke')).toBe('url(#local)');
      }],
    ['background:url(https://x.example/p.png)', '<div id="d" style="color:red;background:url(https://x.example/p.png) no-repeat">x</div>', '',
      (d) => { expect(d.getElementById('d')?.getAttribute('style')).toBe('color:red;background:url("data:,") no-repeat'); }],
    ['@import url(https://x.example/a.css) in a <style>', '<p>s</p>', '<style>@import url(https://x.example/a.css); @import "https://x.example/b.css" screen; p{color:red}</style>',
      (d) => {
        const css = d.querySelector('style')!.textContent!;
        expect(css).not.toContain('@import');
        expect(css).toContain('p{color:red}');
      }],
    ['@import in a data: stylesheet (percent-encoded)', '<p>s</p>',
      `<link rel="stylesheet" href="data:text/css,${encodeURIComponent('@import url(https://x.example/a.css); p{color:red}')}">`,
      (d) => {
        const href = d.querySelector('link')!.getAttribute('href')!;
        expect(href.startsWith('data:text/css')).toBe(true);
        const css = decodeDataUrl(href);
        expect(css).not.toContain('@import');
        expect(css).toContain('p{color:red}');
      }],
    ['@import in a data: stylesheet (base64)', '<p>s</p>',
      `<link rel="stylesheet" href="data:text/css;base64,${b64('@import "https://x.example/a.css"; p{color:red} i{background:url(https://x.example/i.png)}')}">`,
      (d) => {
        const css = decodeDataUrl(d.querySelector('link')!.getAttribute('href')!);
        expect(css).not.toContain('@import');
        expect(css).toContain('p{color:red}');
        expect(css).toContain('i{background:url("data:,")}');
      }],
  ];

  it.each(cases)('%s is gone or neutralised, and no x.example survives', async (_name, body, head, check) => {
    const { out } = await run(page(body, head));
    check(innerOf(out.html), out.html);
    expect(out.html).not.toContain('x.example');
  });

  it('an all-data srcset and a data: stylesheet link stay (the strip is not a blanket)', async () => {
    const { out } = await run(page(
      '<img id="i" srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x" alt="d">',
      '<link rel="stylesheet" href="data:text/css;base64,cHtjb2xvcjpyZWR9">',
    ));
    const d = innerOf(out.html);
    expect(d.getElementById('i')?.getAttribute('srcset')).toBe('data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x');
    expect(d.querySelector('link')?.getAttribute('href')).toBe('data:text/css;base64,cHtjb2xvcjpyZWR9');
  });

  it('every other URL attribute of the allowlist is dropped unless it is data:', async () => {
    const names = ['archive', 'background', 'cite', 'classid', 'codebase', 'data', 'icon', 'itemid', 'longdesc', 'manifest', 'profile', 'usemap', 'src'];
    const attrs = names.map((n) => `${n}="https://x.example/${n}"`).join(' ');
    const dataAttrs = names.map((n) => `${n}="data:text/plain,${n}"`).join(' ');
    const { out } = await run(page(`<div id="bad" ${attrs}>b</div><div id="ok" ${dataAttrs}>o</div>`));
    const d = innerOf(out.html);
    for (const n of names) {
      expect(d.getElementById('bad')!.hasAttribute(n), `${n} dropped`).toBe(false);
      expect(d.getElementById('ok')!.getAttribute(n), `${n} kept as data:`).toBe(`data:text/plain,${n}`);
    }
  });

  it('the strip normalises how a browser reads a data: scheme (tab, newline, leading space) and never trusts a look-alike', async () => {
    const { out } = await run(page(
      '<img id="a" src="  da\tta:image/png;base64,AAAA" alt="a"><img id="b" src="data.example/x.png" alt="b"><img id="c" src="https://x.example/data:x.png" alt="c">',
    ));
    const d = innerOf(out.html);
    expect(d.getElementById('a')!.hasAttribute('src')).toBe(true);
    expect(d.getElementById('b')!.hasAttribute('src')).toBe(false);
    expect(d.getElementById('c')!.hasAttribute('src')).toBe(false);
  });

  it('a stylesheet whose inlined sheet carries a hostile @import is stripped by the nested rule too (a data: import inside a data: sheet)', async () => {
    const inner = encodeURIComponent('@import url(https://x.example/deep.css); b{color:blue}');
    const outerCss = `@import url("data:text/css,${inner}"); p{color:red}`;
    const { out } = await run(page('<p>x</p>', `<link rel="stylesheet" href="data:text/css;base64,${b64(outerCss)}">`));
    const d = innerOf(out.html);
    const outer = decodeDataUrl(d.querySelector('link')!.getAttribute('href')!);
    expect(outer).toContain('p{color:red}');
    const nested = /url\("?(data:[^")]+)"?\)/.exec(outer)!;
    expect(nested).not.toBeNull();
    const nestedCss = nested[1]!.includes(';base64,') ? decodeDataUrl(nested[1]!) : decodeURIComponent(nested[1]!.slice(nested[1]!.indexOf(',') + 1));
    expect(nestedCss).not.toContain('@import');
    expect(nestedCss).toContain('b{color:blue}');
    expect(out.html).not.toContain('x.example');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The inner document, links, and the guarantee that no URL leaves
// ---------------------------------------------------------------------------------------------------------------
describe('the inner document and the links (base 5.6.9 Steps 5 and 6)', () => {
  it('starts with the one doctype and its first head child is the CSP meta, content exactly DOCS_EXPORT_CSP', async () => {
    const { out } = await run(page('<p>x</p>', '<title>t</title>'));
    expect(out.html.startsWith(EXPORT_PREFIX)).toBe(true);
    const d = innerOf(out.html);
    const first = d.head.firstElementChild!;
    expect(first.localName).toBe('meta');
    expect(first.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(first.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
    expect(out.html.indexOf('Content-Security-Policy')).toBeLessThan(out.html.indexOf('<title>'));
  });

  it('a page whose head is empty still gets the CSP meta first', async () => {
    const { out } = await run('<p>no head markup</p>');
    expect(innerOf(out.html).head.firstElementChild?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
  });

  const LINKS = `<p><a id="a1" href="https://link.example/1" title="orig">one</a></p>
<svg><a id="a2" href="https://link.example/2"><text>two</text></a><a id="a3" xlink:href="https://link.example/3"><text>three</text></a></svg>
<map><area id="ar" href="https://link.example/4" alt="four"></map>
<a id="a5" href="#sec">frag</a><a id="a6" href="mailto:me@link.example">mail</a><a id="a7" name="noref">anchor</a>
<noscript><a id="a8" href="https://link.example/8">in noscript</a></noscript>
<template><a href="https://link.example/never">tpl</a></template>
<iframe><a href="https://link.example/never2">fr</a></iframe>`;

  it('no a or area keeps href or xlink:href; the text stays; the target moves into title; links lists them in DOM order', async () => {
    const { out } = await run(page(LINKS));
    const d = innerOf(out.html);
    expect(out.links).toEqual([
      'https://link.example/1', 'https://link.example/2', 'https://link.example/3', 'https://link.example/4',
      '#sec', 'mailto:me@link.example', 'https://link.example/8',
    ]);
    for (const el of d.querySelectorAll('a, area')) {
      expect(el.hasAttribute('href'), el.id).toBe(false);
      expect(el.hasAttribute('xlink:href'), el.id).toBe(false);
    }
    expect(d.getElementById('a1')!.textContent).toBe('one');
    expect(d.getElementById('a1')!.getAttribute('title')).toBe('orig (https://link.example/1)');
    expect(d.getElementById('a2')!.getAttribute('title')).toBe('https://link.example/2');
    expect(d.getElementById('a3')!.getAttribute('title')).toBe('https://link.example/3');
    expect(d.getElementById('ar')!.getAttribute('title')).toBe('https://link.example/4');
    expect(d.getElementById('a5')!.getAttribute('title')).toBe('#sec');
    expect(d.getElementById('a7')!.hasAttribute('title')).toBe(false);
    expect(d.getElementById('a8')!.getAttribute('title')).toBe('https://link.example/8');
    expect(out.html).not.toContain('link.example/never');
  });

  it('NO URL LEAVES: across a hostile page, no attribute holds a URL but data: (and a same-document fragment, and the link target in title)', async () => {
    const hostile = page(
      `${LINKS}
<img src="https://x.example/i.png" srcset="https://x.example/a.png 1x" alt="i"><video poster="https://x.example/p.png"></video>
<svg><image href="https://x.example/p.png"/><use href="https://x.example/s.svg#a"/><use href="#a"/><rect fill="url(https://x.example/g.svg#g)" style="background:url(https://x.example/b.png)"/></svg>
<form action="https://x.example/f"><button formaction="https://x.example/b">b</button></form>
<object data="https://x.example/o"></object><embed src="https://x.example/e"><iframe src="https://x.example/f"></iframe>
<div style="background:url('https://x.example/q.png')" background="https://x.example/bg" onclick="x()"></div>`,
      `<base href="https://x.example/"><link rel="stylesheet" href="https://x.example/s.css"><link rel="preload" href="https://x.example/p">
<meta http-equiv="refresh" content="1;url=https://x.example/"><style>@import "https://x.example/i.css"; a{background:url(https://x.example/z.png)}</style>`,
    );
    const { out } = await run(hostile);
    const d = innerOf(out.html);
    const urlLike = /(?:^|[^a-z0-9])(?:https?:|ftp:|mailto:)|^\s*\/\//i;
    for (const { el, name, value } of attrsOf(d)) {
      if (name.startsWith('xmlns')) continue;
      if ((el.localName === 'a' || el.localName === 'area') && name === 'title') continue;
      if (value.startsWith('data:')) continue;
      expect(urlLike.test(value), `${el.localName}[${name}]="${value}"`).toBe(false);
    }
    const URL_ATTRS = ['archive', 'background', 'cite', 'classid', 'codebase', 'data', 'href', 'icon', 'itemid', 'longdesc', 'manifest', 'poster', 'profile', 'src', 'usemap', 'xlink:href'];
    for (const { el, name, value } of attrsOf(d)) {
      if (!URL_ATTRS.includes(name)) continue;
      const svg = el.namespaceURI === 'http://www.w3.org/2000/svg';
      const fragment = svg && value.startsWith('#') && el.localName !== 'a' && el.localName !== 'image';
      expect(value.startsWith('data:') || fragment, `${el.localName}[${name}]="${value}"`).toBe(true);
    }
    expect(out.html).not.toContain('x.example');
    for (const el of d.querySelectorAll('style')) expect(el.textContent).not.toContain('x.example');
  });

  it('never builds a node by parsing: DOMParser is not constructed while the snapshot is built', async () => {
    const parsed = parseMockup(page('<p><a href="https://link.example/x">l</a></p><style>a{background:url(https://x.example/a.png)}</style>'));
    if (!parsed.ok) throw new Error('refused');
    const ctor = vi.fn(() => { throw new Error('a second parser'); });
    vi.stubGlobal('DOMParser', ctor);
    const plan = planMockupAssets(extractMockupRefs(parsed.doc, PAGE_BASE).refs, ctxOf([]));
    const result: MockupAssetResult = { plan, actualBytes: 0, assets: new Map() };
    expect(buildMockupSnapshot(parsed.doc, result).links).toEqual(['https://link.example/x']);
    expect(ctor).not.toHaveBeenCalled();
  });

  it('the input document is byte-identical after the call (it works on a clone)', async () => {
    const html = page(`${LINKS}<script>1</script><img src="a.png"><style>p{background:url(a.png)}</style><noscript><p>n</p></noscript><template><p>t</p></template>`,
      '<base href="https://x.example/">');
    const { doc, before, out } = await run(html, { 'a.png': 'PNG' });
    expect(doc.documentElement.outerHTML).toBe(before);
    const hostile = 'script, template, noscript, base';
    expect(doc.querySelectorAll(hostile).length).toBe(innerOf(html).querySelectorAll(hostile).length);
    expect(doc.querySelectorAll(hostile).length).toBeGreaterThan(0);
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://link.example/1');
    expect(out.html).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// M5.EX2: a synthetic template-shaped spec
// ---------------------------------------------------------------------------------------------------------------
describe('M5.EX2: a template-shaped spec (synthetic: never a copy of a real spec or template)', () => {
  const SPEC = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic spec</title>
<style>:root{--ink:#222} .mermaid{white-space:pre} nav#toc:empty{display:none}</style>
<script type="module">
  try {
    const m = await import('https://cdn.example/m.mjs');
    m.default.initialize({ startOnLoad: false });
    await m.default.run({ querySelector: '.mermaid' });
  } catch (err) { console.warn('diagrams stay as source', err); }
  const toc = document.getElementById('toc');
  document.querySelectorAll('h2').forEach((h) => { const a = document.createElement('a'); a.href = '#' + h.id; toc.append(a); });
</script></head><body>
<nav id="toc" aria-label="Contents"></nav>
<h1>Synthetic design</h1>
<h2 id="s1">One</h2>
<pre class="mermaid">flowchart TD
  A[Start] --> B[Finish]</pre>
<h2 id="s2">Two</h2>
<pre class="mermaid">sequenceDiagram
  Alice->>Bob: hello</pre>
</body></html>`;

  it('keeps the diagram source and the headings, drops the module and its CDN, and leaves the table of contents empty', async () => {
    const { out } = await run(SPEC);
    const d = innerOf(out.html);
    const pres = [...d.querySelectorAll('pre.mermaid')].map((p) => p.textContent);
    expect(pres).toEqual(['flowchart TD\n  A[Start] --> B[Finish]', 'sequenceDiagram\n  Alice->>Bob: hello']);
    expect(d.querySelectorAll('script')).toHaveLength(0);
    expect(d.getElementById('toc')?.childElementCount).toBe(0);
    expect([...d.querySelectorAll('h2')].map((h) => h.id)).toEqual(['s1', 's2']);
    expect(out.html).not.toContain('cdn.example');
    expect(out.html).not.toContain('import(');
    expect(out.links).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Inlining, the row MIME, missing assets
// ---------------------------------------------------------------------------------------------------------------
describe('inlining (base 5.6.9 Step 2): a held file becomes data: with the ROW MIME; a file not held is omitted and listed', () => {
  const SVGISH = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

  it('an admitted image is inlined with the extension table\'s MIME, whatever its bytes look like, and a duplicate use inlines too', async () => {
    const { out } = await run(page('<img id="a" src="a.png" alt="a"><img id="b" src="sub/../a.png" alt="b">'), { 'a.png': SVGISH });
    const d = innerOf(out.html);
    expect(d.getElementById('a')!.getAttribute('src')).toBe(`data:image/png;base64,${b64(SVGISH)}`);
    expect(d.getElementById('b')!.getAttribute('src')).toBe(`data:image/png;base64,${b64(SVGISH)}`);
    expect(out.omitted).toEqual([]);
  });

  it('the MIME is the row\'s even when the loaded entry carries another (a response\'s type is never read)', async () => {
    const { out } = await run(page('<img id="a" src="a.png" alt="a"><img id="s" src="s.svg" alt="s">'), { 'a.png': 'PNG', 's.svg': SVGISH }, (r) => ({
      ...r, assets: new Map([...r.assets].map(([k, v]) => [k, { ...v, mime: 'text/html' }])),
    }));
    const d = innerOf(out.html);
    expect(d.getElementById('a')!.getAttribute('src')!.startsWith('data:image/png;base64,')).toBe(true);
    expect(d.getElementById('s')!.getAttribute('src')!.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(out.html).not.toContain('text/html');
  });

  it('a stylesheet is inlined with its own references rewritten first; its nested image is inlined inside it, and one it cannot inline is neutralised', async () => {
    const css = 'body{background:url(bg.jpg)} h1{background:url(nowhere.png)} @font-face{font-family:f;src:url("f.woff2")}';
    const { out } = await run(page('<p>x</p>', '<link rel="stylesheet" href="s.css">'), { 's.css': css, 'bg.jpg': 'JPEG', 'f.woff2': 'WOFF' });
    const link = innerOf(out.html).querySelector('link')!;
    const href = link.getAttribute('href')!;
    expect(href.startsWith('data:text/css;base64,')).toBe(true);
    const inlined = decodeDataUrl(href);
    expect(inlined).toContain(`body{background:url(data:image/jpeg;base64,${b64('JPEG')})}`);
    expect(inlined).toContain(`url("data:font/woff2;base64,${b64('WOFF')}")`);
    expect(inlined).toContain('h1{background:url("data:,")}');
    expect(inlined).not.toContain('nowhere.png');
    expect(out.omitted).toEqual([repo('nowhere.png')]);
  });

  it('a page-level <style> reference and a style attribute are inlined where the file is held and neutralised where it is not', async () => {
    const { out } = await run(
      page('<div id="d" style="background:url(a.png)">x</div><div id="e" style="background:url(gone.png)">y</div>', '<style>p{background:url(b.png)} q{background:url(gone2.png)}</style>'),
      { 'a.png': 'A', 'b.png': 'B' },
    );
    const d = innerOf(out.html);
    expect(d.getElementById('d')!.getAttribute('style')).toBe(`background:url(data:image/png;base64,${b64('A')})`);
    expect(d.getElementById('e')!.getAttribute('style')).toBe('background:url("data:,")');
    expect(d.querySelector('style')!.textContent).toBe(`p{background:url(data:image/png;base64,${b64('B')})} q{background:url("data:,")}`);
    expect(out.omitted).toEqual([repo('gone2.png'), repo('gone.png')]);
  });

  it('a file that FAILED is omitted: no URL, the closed missing sentence as alt, and its repo path listed once for a duplicate use', async () => {
    const { out } = await run(
      page('<img id="ok" src="a.png" alt="author"><img id="x1" src="x.png" alt="author text"><img id="x2" src="./x.png"><input id="in" type="image" src="x.png">'),
      { 'a.png': 'A', 'x.png': { failed: 'unreachable' } },
    );
    const d = innerOf(out.html);
    expect(d.getElementById('ok')!.getAttribute('alt')).toBe('author');
    for (const id of ['x1', 'x2', 'in']) {
      expect(d.getElementById(id)!.hasAttribute('src'), id).toBe(false);
      expect(d.getElementById(id)!.getAttribute('alt'), id).toBe(EXPORT_MISSING_SENTENCE.failed);
    }
    expect(out.omitted).toEqual([repo('x.png')]);
  });

  it('a row failed with the word timed-out gets the still-loading sentence, and any other failed word keeps the did-not-load one', async () => {
    const stall = (r: MockupAssetResult): MockupAssetResult => ({
      ...r,
      plan: {
        ...r.plan,
        rows: r.plan.rows.map((row) => (row.ref.raw === 'a.png' ? { ...row, verdict: { v: 'failed', failure: 'timed-out' } as const } : row)),
      },
      assets: new Map([...r.assets].filter(([k]) => !k.includes('a.png'))),
    });
    const { out } = await run(
      page('<img id="a" src="a.png" alt="a"><img id="b" src="b.png" alt="b"><img id="c" src="c.png" alt="c">'),
      { 'a.png': 'A', 'b.png': { failed: 'unreachable' }, 'c.png': 'C' }, stall,
    );
    const d = innerOf(out.html);
    expect(d.getElementById('a')!.hasAttribute('src')).toBe(false);
    expect(d.getElementById('a')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['timed-out']);
    expect(d.getElementById('b')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.failed);
    expect(d.getElementById('c')!.getAttribute('src')!.startsWith('data:image/png')).toBe(true);
    expect(out.omitted).toEqual([repo('a.png'), repo('b.png')]);
  });

  it('a file the caller LEFT OUT of the result is omitted the same way (the builder keeps assets in DOM order while the file fits)', async () => {
    const drop = (r: MockupAssetResult): MockupAssetResult => ({ ...r, assets: new Map([...r.assets].filter(([k]) => !k.includes('b.png'))) });
    const { out } = await run(
      page('<img id="a" src="a.png" alt="a"><img id="b" src="b.png" alt="b"><img id="c" src="c.png" alt="c">'),
      { 'a.png': 'A', 'b.png': 'B', 'c.png': 'C' }, drop,
    );
    const d = innerOf(out.html);
    expect(d.getElementById('a')!.getAttribute('src')!.startsWith('data:image/png')).toBe(true);
    expect(d.getElementById('c')!.getAttribute('src')!.startsWith('data:image/png')).toBe(true);
    expect(d.getElementById('b')!.hasAttribute('src')).toBe(false);
    expect(d.getElementById('b')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE['over-size']);
    expect(out.omitted).toEqual([repo('b.png')]);
  });

  it('every other reason an asset is not shown keeps its own closed sentence, and omitted holds the raw reference where it does not resolve', async () => {
    const { out } = await run(page(
      '<img id="ext" src="https://x.example/e.png"><img id="gone" src="gone.png"><img id="up" src="../../../../outside.png"><img id="odd" src="ftp://x.example/o.png"><video id="v" poster="p.png"></video>',
    ));
    const d = innerOf(out.html);
    expect(d.getElementById('ext')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.external);
    expect(d.getElementById('gone')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.refused);
    expect(d.getElementById('up')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.refused);
    expect(d.getElementById('odd')!.getAttribute('alt')).toBe(EXPORT_MISSING_SENTENCE.refused);
    expect(d.getElementById('v')!.hasAttribute('poster')).toBe(false);
    expect(out.omitted).toEqual(['https://x.example/e.png', repo('gone.png'), '../../../../outside.png', 'ftp://x.example/o.png', repo('p.png')]);
    expect(out.html).not.toContain('x.example');
  });

  it('omitted is in DOM order, a stylesheet\'s own missing references at the stylesheet\'s place, each once', async () => {
    const { out } = await run(
      page('<img src="first.png"><img src="first.png"><p style="background:url(second.png)"></p>', '<link rel="stylesheet" href="s.css">'),
      { 's.css': 'a{background:url(css1.png)} b{background:url(css2.png)}' },
    );
    // The head's link comes first in the document, so the sheet's references precede the body's.
    expect(out.omitted).toEqual([repo('css1.png'), repo('css2.png'), repo('first.png'), repo('second.png')]);
  });

  it('a stylesheet chain nests only to MOCKUP_MAX_CSS_DEPTH: the deepest sheet\'s own references are neutralised and listed', async () => {
    const { out } = await run(page('<p>x</p>', '<link rel="stylesheet" href="a.css">'), {
      'a.css': '@import "b.css";', 'b.css': '@import "c.css";', 'c.css': '@import "d.css";', 'd.css': 'p{background:url(e.png)}', 'e.png': 'E',
    });
    const a = decodeDataUrl(innerOf(out.html).querySelector('link')!.getAttribute('href')!);
    const b = decodeDataUrl(/data:text\/css;base64,[A-Za-z0-9+/=]+/.exec(a)![0]);
    const c = decodeDataUrl(/data:text\/css;base64,[A-Za-z0-9+/=]+/.exec(b)![0]);
    const d = decodeDataUrl(/data:text\/css;base64,[A-Za-z0-9+/=]+/.exec(c)![0]);
    expect(d).toBe('p{background:url("data:,")}');
    expect(out.omitted).toEqual([repo('e.png')]);
  });

  it('a stylesheet cycle nests only to MOCKUP_MAX_CSS_DEPTH and ends: the reference that would close the loop past it is neutralised', async () => {
    // a.css and b.css import each other. Both are held, so only the depth bound (not a missing file) stops the nesting.
    const { out } = await run(page('<p>x</p>', '<link rel="stylesheet" href="a.css">'), {
      'a.css': '@import "b.css"; p{color:red}', 'b.css': '@import "a.css"; q{color:blue}',
    });
    const levels: string[] = [];
    let text = innerOf(out.html).querySelector('link')!.getAttribute('href')!;
    for (;;) {
      const sheet = decodeDataUrl(text);
      levels.push(sheet);
      const next = /data:text\/css;base64,[A-Za-z0-9+/=]+/.exec(sheet);
      if (next === null) break;
      text = next[0];
    }
    // The page-level sheet is use depth 0; its references nest while their depth stays within MOCKUP_MAX_CSS_DEPTH.
    expect(levels).toHaveLength(MOCKUP_MAX_CSS_DEPTH + 1);
    expect(levels[levels.length - 1]).not.toContain('@import "');
  });

  it('a link whose href is a data: URL loses it too: the links step, not the URL allowlist (which keeps data:), removes it', async () => {
    const { out } = await run(page('<a id="d1" href="data:text/plain,one">one</a><svg><a id="d2" href="data:text/plain,two"><text>two</text></a></svg>'));
    const d = innerOf(out.html);
    for (const id of ['d1', 'd2']) {
      expect(d.getElementById(id)!.hasAttribute('href'), id).toBe(false);
      expect(d.getElementById(id)!.hasAttribute('xlink:href'), id).toBe(false);
    }
    expect(out.links).toEqual(['data:text/plain,one', 'data:text/plain,two']);
  });

  it('a page that keeps no external reference holds none in the result of a held stylesheet either (no x.example anywhere)', async () => {
    const { out } = await run(page('<p>x</p>', '<link rel="stylesheet" href="s.css">'), {
      's.css': '@import url(https://x.example/a.css); a{background:url(https://x.example/b.png)} @font-face{src:url(https://x.example/f.woff2)}',
    });
    expect(out.html).not.toContain('x.example');
    expect(decodeDataUrl(innerOf(out.html).querySelector('link')!.getAttribute('href')!)).toContain('url("data:,")');
  });

  it('the inlined bytes are bounded: past DOCS_EXPORT_MAX_BYTES of data: URLs every later use is omitted, in DOM order, and listed once', async () => {
    const big = new Uint8Array(2 * MIB).fill(7);
    const { out } = await run(page('<img id="i1" src="big.png" alt="1"><img id="i2" src="big.png" alt="2"><img id="i3" src="big.png" alt="3"><img id="i4" src="big.png" alt="4"><img id="i5" src="big.png" alt="5">'), { 'big.png': big });
    const uses = out.html.match(/src="data:image\/png;base64,/g) ?? [];
    expect(uses).toHaveLength(3);
    expect(out.html.split(EXPORT_MISSING_SENTENCE['over-size'])).toHaveLength(3);
    expect(out.omitted).toEqual([repo('big.png')]);
    expect(out.html.length).toBeLessThan(10 * MIB);
  });

  it('keys the asset by its own pin: the result\'s entry is read through docsApi.file', async () => {
    const parsed = parseMockup(page('<img id="a" src="a.png">'));
    if (!parsed.ok) throw new Error('refused');
    const plan = planMockupAssets(extractMockupRefs(parsed.doc, PAGE_BASE).refs, ctxOf([sized('a.png', 3)]));
    const row = plan.rows[0]!;
    if (row.verdict.v !== 'inline') throw new Error('not admitted');
    const key = docsApi.file('demo', row.verdict.pin);
    const out = buildMockupSnapshot(parsed.doc, { plan, actualBytes: 3, assets: new Map([[key, { mime: 'image/png', bytes: enc('abc') }]]) });
    expect(innerOf(out.html).getElementById('a')!.getAttribute('src')).toBe(`data:image/png;base64,${b64('abc')}`);
  });
});
