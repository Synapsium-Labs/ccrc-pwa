// Native Docs reader, completion plan Task 7 (C1): the mockup's origins, CSP, click guard and srcdoc build (`origins.ts`,
// `policy.ts`, and `buildMockupSrcdoc` in `load.ts`; base spec 2026-10-01 5.6.2 step 6, 5.6.3's script-text census, 5.6.4,
// 5.6.6; rows M5.10, M5.11, M5.21, M5.EX3). Placeholders only (`a.example`, `cdn.example`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_MAX_DOC_BYTES, type DocPin, type DocsEntry } from '../../shared/docs';
import { buildMockupSrcdoc, extractMockupRefs, loadMockupAssets } from '../src/docs/mockup/load';
import { parseMockupOrigin, SCRIPT_TEXT_ORIGIN_MAX, scriptTextOrigins } from '../src/docs/mockup/origins';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import {
  MOCKUP_ASSET_MIME, MOCKUP_CLICK_GUARD, MOCKUP_CSP, MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS, MOCKUP_MAX_CSS_DEPTH, MOCKUP_MAX_SRCDOC_CHARS, MOCKUP_SANDBOX_SCRIPTED,
  MOCKUP_SANDBOX_STATIC, isMockupOrigin, metaFor, mockupCsp,
} from '../src/docs/mockup/policy';
import type { HttpsOrigin, MockupAssetPlan, MockupAssetReader, MockupContext } from '../src/docs/mockup/ports';
import { COMMIT_A, SERVED, entry, holder, treeOk } from './docsFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const own = 'ccrc.example';
const origin = (raw: string): HttpsOrigin => {
  const o = parseMockupOrigin(raw, own);
  if (o === null) throw new Error(`fixture origin refused: ${raw}`);
  return o;
};

describe('the constants (base 5.6.4, 5.6.5, 5.6.6)', () => {
  it('the sandbox values: static is empty, scripted is exactly allow-scripts', () => {
    expect(MOCKUP_SANDBOX_STATIC).toBe('');
    expect(MOCKUP_SANDBOX_SCRIPTED).toBe('allow-scripts');
  });

  it('MOCKUP_CSP is exactly base 5.6.4\'s string', () => {
    expect(MOCKUP_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'",
    );
  });

  it('MOCKUP_CLICK_GUARD is exactly base 5.6.6\'s script', () => {
    expect(MOCKUP_CLICK_GUARD).toBe(
      "<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href],area[href]');if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';if(h.charAt(0)==='#'&&h.length>1){var id=decodeURIComponent(h.slice(1));var t=document.getElementById(id)||document.getElementsByName(id)[0];if(t)t.scrollIntoView();}},true);</script>",
    );
  });

  it('metaFor builds the CSP meta with the content attribute escaped', () => {
    expect(metaFor("default-src 'none'")).toBe('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">');
    const meta = metaFor('a "b" & <c>');
    expect(meta).toBe('<meta http-equiv="Content-Security-Policy" content="a &quot;b&quot; &amp; &lt;c&gt;">');
    const doc = parseMockup(`<!doctype html>${meta}`);
    expect(doc.ok && doc.doc.querySelector('meta')!.getAttribute('content')).toBe('a "b" & <c>');
  });
});

describe('parseMockupOrigin: an exact https origin or null (M5.21)', () => {
  it.each([
    ['https://a.example'],
    ['https://a.example:8443'],
    ['https://cdn.example.net'],
    ['https://a-b.c.example'],
    // A host that merely STARTS with the current hostname's text is another host (a prefix compare is wrong).
    ['https://ccrc.example.net'],
    ['https://ccrc.examples'],
    ['https://xccrc.example'],
    ['https://sub.ccrc.example'],
    ['https://xn--nxasmq6b.example'],
    [`https://${'a'.repeat(63)}.example`],
    ['https://a--b.example'],
    ['https://1a.example'],
  ])('accepts %s', (raw) => {
    expect(parseMockupOrigin(raw, own)).toBe(raw);
  });

  it.each([
    ['http://', 'http://a.example'],
    ['a wildcard', 'https://*.example'],
    ['a wildcard origin alone', '*'],
    ['a semicolon injection', 'https://a.example;script-src *'],
    ['a single-quote injection', "https://a.example' 'unsafe-eval"],
    ['a double-quote injection', 'https://a.example" x'],
    ['leading whitespace', ' https://a.example'],
    ['trailing whitespace', 'https://a.example '],
    ['an inner space', 'https://a.example b.example'],
    ['a newline', 'https://a.example\nhttps://b.example'],
    ['a trailing slash (not an exact origin)', 'https://a.example/'],
    ['a path', 'https://a.example/x.js'],
    ['a query', 'https://a.example?x'],
    ['a fragment', 'https://a.example#x'],
    ['userinfo', 'https://user@a.example'],
    ['the default port written out', 'https://a.example:443'],
    ['an IPv4 literal', 'https://127.0.0.1'],
    ['an IPv4 literal with a port', 'https://10.0.0.1:8443'],
    ['an IPv4 literal in another spelling', 'https://0x7f.0.0.1'],
    ['an IPv6 literal', 'https://[::1]'],
    ['an IPv6 literal with a port', 'https://[2001:db8::1]:8443'],
    ['localhost', 'https://localhost'],
    ['localhost with a port', 'https://localhost:8443'],
    ['a subdomain of localhost', 'https://a.localhost'],
    ['a single label', 'https://intranet'],
    ['an upper-case host (not canonical)', 'https://A.EXAMPLE'],
    ['the current hostname', `https://${own}`],
    ['the current hostname at another port', `https://${own}:8443`],
    ['the current hostname at yet another port', `https://${own}:9`],
    ['the empty string', ''],
    ['no scheme', 'a.example'],
    ['a non-web scheme', 'ftp://a.example'],
    ['data:', 'data:text/plain,x'],
    // The host grammar: LDH labels of 1-63 characters, no edge hyphen, at least two labels. `new URL` keeps all of these.
    ['a comma in the host', 'https://a,b.example'],
    ['a parenthesis in the host', 'https://a(b).example'],
    ['a closing parenthesis in the host', 'https://ab).example'],
    ['a dollar in the host', 'https://a$b.example'],
    ['a template-looking host', 'https://$' + '{x}.example'],
    ['a brace in the host', 'https://a{b.example'],
    ['an underscore in the host', 'https://a_b.example'],
    ['an empty first label', 'https://.example'],
    ['an empty inner label', 'https://a..example'],
    ['a trailing dot (new URL keeps it, and a CSP host-source has no such form)', 'https://a.example.'],
    ['a 64-character label', `https://${'a'.repeat(64)}.example`],
    ['a leading hyphen', 'https://-a.example'],
    ['a trailing hyphen', 'https://a-.example'],
    ['a host over 253 characters', `https://${Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.')}.example`],
    ['a plus in the host', 'https://a+b.example'],
    ['an exclamation in the host', 'https://a!b.example'],
  ])('refuses %s', (_name, raw) => {
    expect(parseMockupOrigin(raw, own)).toBeNull();
  });

  it('one source of truth: an origin parseMockupOrigin accepts never makes mockupCsp throw', () => {
    const specials = Array.from({ length: 0x7e - 0x20 }, (_, i) => String.fromCharCode(0x21 + i));
    const candidates: string[] = ['https://a.example', 'https://a.example:8443', 'https://a-b.example:1'];
    for (const c of specials) {
      for (const tpl of [`https://a${c}b.example`, `https://${c}a.example`, `https://a${c}.example`, `https://a.example${c}`, `https://a.ex${c}`, `https://a.example:8${c}`, `https://${c}`]) candidates.push(tpl);
    }
    let accepted = 0;
    for (const raw of candidates) {
      const o = parseMockupOrigin(raw, own);
      if (o === null) continue;
      accepted += 1;
      expect(() => mockupCsp([o])).not.toThrow();
    }
    expect(accepted).toBeGreaterThanOrEqual(3);
    // Every character the grammar refuses is refused by parseMockupOrigin too (the two checks are one function).
    for (const c of ',()$_{}+!~=&%^|`<>@[]\\;\'"*') expect(parseMockupOrigin(`https://a${c}b.example`, own)).toBeNull();
  });

  it('the current hostname is compared whole and in lower case, with no regard for a trailing dot or the case it was given in', () => {
    expect(parseMockupOrigin('https://a.example', 'A.Example')).toBeNull();
    expect(parseMockupOrigin('https://a.example:8443', 'a.example')).toBeNull();
    expect(parseMockupOrigin('https://a.example.net', 'a.example')).toBe('https://a.example.net');
  });
});

/** A policy's directives by name: the re-tokenised string, never a substring check. */
function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter((t) => t !== '');
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    expect(out.has(name!)).toBe(false);
    out.set(name!, values);
  }
  return out;
}

describe('mockupCsp: the four directives and no other (M5.21, base 5.6.4)', () => {
  it('with no extra origin it is MOCKUP_CSP exactly', () => {
    expect(mockupCsp([])).toBe(MOCKUP_CSP);
  });

  it('a confirmed origin appears in script-src, style-src, img-src and font-src only, once each, and nowhere else', () => {
    const a = origin('https://a.example');
    const b = origin('https://cdn.example:8443');
    const csp = mockupCsp([a, b]);
    const d = directives(csp);
    const base = directives(MOCKUP_CSP);
    for (const name of ['script-src', 'style-src', 'img-src', 'font-src']) {
      expect(d.get(name)).toEqual([...base.get(name)!, a, b]);
    }
    for (const name of base.keys()) {
      if (!['script-src', 'style-src', 'img-src', 'font-src'].includes(name)) expect(d.get(name)).toEqual(base.get(name));
    }
    expect([...d.keys()]).toEqual([...base.keys()]);
    for (const o of [a, b]) expect(csp.split(o).length - 1).toBe(4);
  });

  it('never adds connect-src, frame-src, worker-src, object-src or manifest-src; default-src stays none; base-uri and form-action stay none', () => {
    const d = directives(mockupCsp([origin('https://a.example')]));
    for (const name of ['connect-src', 'frame-src', 'worker-src', 'object-src', 'manifest-src', 'child-src']) expect(d.has(name)).toBe(false);
    expect(d.get('default-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'none'"]);
    expect(d.get('media-src')).toEqual(['data:', 'blob:']);
  });

  it('an origin given twice is listed once per directive', () => {
    const a = origin('https://a.example');
    expect(mockupCsp([a, a])).toBe(mockupCsp([a]));
  });

  it('a value that is not an exact origin cannot be put in the policy, even by a cast', () => {
    expect(() => mockupCsp(["https://a.example; connect-src *" as HttpsOrigin])).toThrow();
    expect(() => mockupCsp(["https://a.example 'unsafe-eval'" as HttpsOrigin])).toThrow();
  });
});

describe('scriptTextOrigins: the script-text census (M5.EX3; base 5.6.3)', () => {
  it('lists the origin of a dynamic import() and of an import ... from, each once, in first-seen order', () => {
    const text = [
      "import mermaid from 'https://cdn.example/mermaid.mjs';",
      "const x = await import('https://cdn.example/other.js');",
      "import { a, b } from \"https://lib.example:8443/lib.js\";",
      "import('https://cdn.example/again.js');",
    ].join('\n');
    expect(scriptTextOrigins(text)).toEqual(['https://cdn.example', 'https://lib.example:8443']);
  });

  it.each([
    ['import(\'https://cdn.example/x.js\')'],
    ['import ( "https://cdn.example/x.js" )'],
    ['import("https://cdn.example")'],
    ["import x from 'https://cdn.example/x.js'"],
    ['import * as x from "https://cdn.example/x.js"'],
    ['import {\n  a,\n  b as c,\n} from `https://cdn.example/x.js`'],
    ['import{a}from"https://cdn.example/x.js"'],
  ])('lists https://cdn.example from %s', (text) => {
    expect(scriptTextOrigins(text)).toEqual(['https://cdn.example']);
  });

  it.each([
    ['an http:// specifier', "import('http://cdn.example/x.js')"],
    ['an http:// specifier in a static import', 'import x from "http://cdn.example/x.js"'],
    ['a relative specifier', "import('./x.js')"],
    ['a bare specifier', "import('mermaid')"],
    ['a method called import', "obj.import('https://cdn.example/x.js')"],
    ['a name ending in import', "reimport('https://cdn.example/x.js')"],
    ['an origin ending at a query', "import('https://cdn.example?x.js')"],
    ['an origin ending at a fragment', "import('https://cdn.example#x')"],
    ['an origin cut by the end of the text', "import('https://cdn.example"],
    ['a host with an inner space', "import('https://cdn .example/x.js')"],
    ['a host with userinfo', "import('https://user@cdn.example/x.js')"],
    ['an export ... from', "export * from 'https://cdn.example/x.js'"],
    ['an https URL that is not an import argument', "fetch('https://cdn.example/x.json')"],
  ])('does not list %s', (_name, text) => {
    expect(scriptTextOrigins(text)).toEqual([]);
  });

  it('never lists a cut host: an origin that runs past the capture is not listed in its place', () => {
    const label = 'a'.repeat(63);
    const longest = `https://${label}.${label}.${label}.${'a'.repeat(61)}`; // a 253-character host: the longest a name can be
    expect(longest.length - 'https://'.length).toBe(253);
    expect(longest.length).toBeLessThanOrEqual(SCRIPT_TEXT_ORIGIN_MAX);
    expect(scriptTextOrigins(`import('${longest}/x.js')`)).toEqual([longest]);
    // Past the capture: twenty labels, so the capture ends inside the host.
    const far = `https://${Array.from({ length: 20 }, () => label).join('.')}.example`;
    expect(far.length).toBeGreaterThan(SCRIPT_TEXT_ORIGIN_MAX);
    expect(scriptTextOrigins(`import('${far}/x.js')`)).toEqual([]);
    // Between 253 characters and the capture: the host grammar refuses it, so it is never a candidate.
    const mid = `https://${label}.${label}.${label}.${label}`;
    expect(mid.length).toBeLessThan(SCRIPT_TEXT_ORIGIN_MAX);
    expect(scriptTextOrigins(`import('${mid}/x.js')`)).toEqual([]);
  });

  it.each([
    ['a comma', 'https://a,b.example'],
    ['a parenthesis', 'https://a(b).example'],
    ['a dollar and braces', 'https://$' + '{x}.example'],
    ['an underscore', 'https://a_b.example'],
    ['an empty label', 'https://a..example'],
    ['a leading hyphen', 'https://-a.example'],
    ['a trailing hyphen', 'https://a-.example'],
    ['a 64-character label', `https://${'a'.repeat(64)}.example`],
    ['localhost', 'https://localhost'],
    ['a subdomain of localhost', 'https://a.localhost'],
    ['an IPv4 literal', 'https://10.0.0.1'],
    ['a single label', 'https://intranet'],
  ])('does not list %s: what parseMockupOrigin refuses is not a census candidate', (_name, origin) => {
    expect(parseMockupOrigin(origin, own)).toBeNull();
    expect(scriptTextOrigins(`import('${origin}/x.js')`)).toEqual([]);
    expect(scriptTextOrigins(`import x from "${origin}"`)).toEqual([]);
  });

  it('the documented caller path (census, then parseMockupOrigin with the current hostname) drops the current hostname and keeps the rest', () => {
    const text = `import('https://${own}/self.js'); import('https://${own}:8443/other.js'); import('https://cdn.example/x.js'); import('https://a,b.example/x.js')`;
    const listed = scriptTextOrigins(text);
    expect(listed).toEqual([`https://${own}`, `https://${own}:8443`, 'https://cdn.example']);
    const kept = listed.map((o) => parseMockupOrigin(o, own)).filter((o): o is HttpsOrigin => o !== null);
    expect(kept).toEqual(['https://cdn.example']);
    expect(() => mockupCsp(kept)).not.toThrow();
  });

  it('fetches nothing', () => {
    const fetchSpy = vi.fn(() => { throw new Error('the census fetched'); });
    vi.stubGlobal('fetch', fetchSpy);
    scriptTextOrigins("import('https://cdn.example/x.js')");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['import( repeated', 'import('],
    ['import ( " repeated', 'import ("'],
    ['import repeated', 'import '],
    ['import(" https:// repeated', 'import("https://'],
    ['import x from repeated', 'import x from '],
    ['import { repeated', 'import {'],
  ])('a 2 MiB repetition of %s scans in linear time', (_name, unit) => {
    const text = unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length));
    const t0 = performance.now();
    scriptTextOrigins(text);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The srcdoc build, through the real extractor, planner and loader.
// ---------------------------------------------------------------------------------------------------------------
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const PAGE_BASE = 'specs/m.html' as const;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 250, 251, 252]) as Uint8Array<ArrayBuffer>;
const FONT = Uint8Array.from([0, 1, 0, 0, 9, 8, 7]) as Uint8Array<ArrayBuffer>;

const HTML = `<!doctype html><html><head><title>Author title</title>
<link rel="stylesheet" href="s.css">
<style>.x{background:url(inline.png)}</style>
<script src="app.js"></script>
</head><body style="background:url(attr.png)">
<img src="i.png"><img src="http://a.example/x.png"><img src="#frag"><img src="missing.png">
<img srcset="i.png 1x, j.jpg 2x">
<a href="i.png">a link</a>
</body></html>`;

const FILES: Record<string, Uint8Array<ArrayBuffer>> = {
  's.css': enc('@import "n.css"; .a{background:url(bg.png)} @font-face{font-family:f;src:url(f.woff2)}'),
  'n.css': enc('.n{background:url(bg.png)}'),
  'app.js': enc('window.ran = 1'),
  'i.png': PNG,
  'j.jpg': enc('JPEG'),
  'inline.png': enc('IN'),
  'attr.png': enc('AT'),
  'bg.png': enc('BG'),
  'f.woff2': FONT,
};

const sized = (path: string, size: number): DocsEntry =>
  entry('specs', path, { committed: { kind: 'file', blob: '1'.repeat(40), size } });

async function prepare(html: string, files: Record<string, Uint8Array<ArrayBuffer>>) {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('fixture refused by the pre-scan');
  const ex = extractMockupRefs(parsed.doc, PAGE_BASE);
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'm.html' };
  const ctx: MockupContext = {
    project: 'demo', pin,
    tree: treeOk({ entries: [entry('specs', 'm.html'), ...Object.entries(files).map(([p, b]) => sized(p, b.length))], drafts: holder() }),
  };
  const reads: string[] = [];
  const reader: MockupAssetReader = {
    read: async (p) => {
      reads.push(p.path);
      return files[p.path] === undefined ? { kind: 'failed', failure: 'not-found' } : { kind: 'ok', bytes: files[p.path]! };
    },
  };
  const assets = await loadMockupAssets(planMockupAssets(ex.refs, ctx), reader, new AbortController().signal);
  return { doc: parsed.doc, assets, reads };
}

/** The uses the cap kept out: admitted rows (size kept) whose verdict the build turned to skipped:over-budget, in row order. */
const skippedKeys = (plan: MockupAssetPlan): string[] =>
  plan.rows.filter((r) => r.verdict.v === 'skipped' && r.size !== null).map((r) => r.ref.key);

async function build(html: string, files: Record<string, Uint8Array<ArrayBuffer>>, extra: readonly HttpsOrigin[], scripted = false) {
  const { doc, assets, reads } = await prepare(html, files);
  const before = doc.documentElement.outerHTML;
  const built = buildMockupSrcdoc(doc, assets, extra, scripted);
  if (!built.ok) throw new Error(`the build was refused: ${built.why}, ${built.chars} chars`);
  return { doc, assets, srcdoc: built.page, plan: built.plan, skipped: skippedKeys(built.plan), reads, before, after: doc.documentElement.outerHTML };
}

const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('buildMockupSrcdoc: the prefix (M5.10)', () => {
  it('starts with metaFor(csp) then MOCKUP_CLICK_GUARD then the doctype, each exactly once, before any author byte', async () => {
    const extra = [origin('https://cdn.example')];
    const { srcdoc } = await build(HTML, FILES, extra);
    const csp = mockupCsp(extra);
    expect(srcdoc.startsWith(metaFor(csp) + MOCKUP_CLICK_GUARD + '<!doctype html>')).toBe(true);
    expect(occurrences(srcdoc, metaFor(csp))).toBe(1);
    expect(occurrences(srcdoc, MOCKUP_CLICK_GUARD)).toBe(1);
    expect(srcdoc.indexOf('Author title')).toBeGreaterThan(metaFor(csp).length + MOCKUP_CLICK_GUARD.length);
    expect(srcdoc.indexOf('<html')).toBeGreaterThan(srcdoc.indexOf('<!doctype html>'));
  });

  it('the meta\'s content equals mockupCsp(extra), with and without a confirmed origin (the frame\'s csp attribute is that same string)', async () => {
    for (const extra of [[], [origin('https://cdn.example'), origin('https://lib.example:8443')]] as HttpsOrigin[][]) {
      const { srcdoc } = await build(HTML, FILES, extra);
      const back = parseMockup(srcdoc);
      expect(back.ok).toBe(true);
      const meta = back.ok ? back.doc.querySelector('meta[http-equiv]') : null;
      expect(meta!.getAttribute('http-equiv')).toBe('Content-Security-Policy');
      expect(meta!.getAttribute('content')).toBe(mockupCsp(extra));
      // The first element the parser meets is the meta, ahead of every author element.
      expect(back.ok && back.doc.head.firstElementChild).toBe(meta);
    }
  });

  it('the bytes do not depend on the mode', async () => {
    const extra = [origin('https://cdn.example')];
    const a = await build(HTML, FILES, extra, false);
    const b = await build(HTML, FILES, extra, true);
    expect(a.srcdoc).toBe(b.srcdoc);
  });

  it('the parsed document is never mutated, and a second build from it gives the same bytes', async () => {
    const r = await build(HTML, FILES, []);
    expect(r.after).toBe(r.before);
    expect(buildMockupSrcdoc(r.doc, r.assets, [], false)).toEqual({ ok: true, page: r.srcdoc, plan: r.plan });
    expect(r.doc.documentElement.outerHTML).toBe(r.before);
    expect(r.srcdoc).toContain('data:image/png;base64,');
  });
});

describe('buildMockupSrcdoc: the rewrite (M5.11)', () => {
  it('replaces each inline asset\'s reference with data:<table MIME>;base64,... decoding to the fixture bytes', async () => {
    const { srcdoc } = await build(HTML, FILES, []);
    const back = parseMockup(srcdoc);
    if (!back.ok) throw new Error('refused');
    const imgs = [...back.doc.querySelectorAll('img')];
    expect(imgs[0]!.getAttribute('src')).toBe(`data:image/png;base64,${b64(PNG)}`);
    expect(fromB64(imgs[0]!.getAttribute('src')!.split(',')[1]!)).toEqual(PNG);
    expect(back.doc.querySelector('script[src]')!.getAttribute('src')).toBe(`data:text/javascript;base64,${b64(enc('window.ran = 1'))}`);
    expect(back.doc.body.getAttribute('style')).toBe(`background:url(data:image/png;base64,${b64(enc('AT'))})`);
    expect(back.doc.querySelector('style')!.textContent).toBe(`.x{background:url(data:image/png;base64,${b64(enc('IN'))})}`);
  });

  it('every inlined value\'s MIME is the table\'s for the file\'s extension, never a response\'s', async () => {
    const { srcdoc } = await build(HTML, FILES, []);
    const back = parseMockup(srcdoc);
    if (!back.ok) throw new Error('refused');
    const second = back.doc.querySelectorAll('img')[4]!.getAttribute('srcset')!;
    expect(second).toBe(`data:${MOCKUP_ASSET_MIME['png']!.mime};base64,${b64(PNG)} 1x, data:${MOCKUP_ASSET_MIME['jpg']!.mime};base64,${b64(enc('JPEG'))} 2x`);
    expect(MOCKUP_ASSET_MIME['jpg']!.mime).toBe('image/jpeg');
  });

  it('a stylesheet\'s nested references are rewritten inside its own data URL, recursively and before it is encoded', async () => {
    const { srcdoc } = await build(HTML, FILES, []);
    const back = parseMockup(srcdoc);
    if (!back.ok) throw new Error('refused');
    const href = back.doc.querySelector('link')!.getAttribute('href')!;
    expect(href.startsWith('data:text/css;base64,')).toBe(true);
    const css = new TextDecoder().decode(fromB64(href.split(',')[1]!));
    const png = `data:image/png;base64,${b64(enc('BG'))}`;
    const nested = `data:text/css;base64,${b64(enc(`.n{background:url(${png})}`))}`;
    expect(css).toBe(`@import "${nested}"; .a{background:url(${png})} @font-face{font-family:f;src:url(data:font/woff2;base64,${b64(FONT)})}`);
  });

  it('leaves every other reference untouched: external, fragment, missing and a link', async () => {
    const { srcdoc } = await build(HTML, FILES, []);
    const back = parseMockup(srcdoc);
    if (!back.ok) throw new Error('refused');
    const imgs = [...back.doc.querySelectorAll('img')];
    expect(imgs[1]!.getAttribute('src')).toBe('http://a.example/x.png');
    expect(imgs[2]!.getAttribute('src')).toBe('#frag');
    expect(imgs[3]!.getAttribute('src')).toBe('missing.png');
    expect(back.doc.querySelector('a')!.getAttribute('href')).toBe('i.png');
  });

  it('a read that failed is left as written (the CSP is the wall)', async () => {
    const files = { ...FILES };
    const parsed = parseMockup('<img src="i.png"><img src="gone.png">');
    if (!parsed.ok) throw new Error('refused');
    const ex = extractMockupRefs(parsed.doc, PAGE_BASE);
    const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'm.html' };
    const ctx: MockupContext = {
      project: 'demo', pin,
      tree: treeOk({ entries: [entry('specs', 'm.html'), sized('i.png', 10), sized('gone.png', 10)], drafts: holder() }),
    };
    const assets = await loadMockupAssets(planMockupAssets(ex.refs, ctx), {
      read: async (p) => (p.path === 'i.png' ? { kind: 'ok', bytes: files['i.png']! } : { kind: 'failed', failure: 'unreachable' }),
    }, new AbortController().signal);
    const built = buildMockupSrcdoc(parsed.doc, assets, [], false);
    if (!built.ok) throw new Error('refused');
    const out = built.page;
    const back = parseMockup(out);
    if (!back.ok) throw new Error('refused');
    const imgs = [...back.doc.querySelectorAll('img')];
    expect(imgs[0]!.getAttribute('src')).toBe(`data:image/png;base64,${b64(PNG)}`);
    expect(imgs[1]!.getAttribute('src')).toBe('gone.png');
  });

  it('a stylesheet cycle is built without looping: the reference that would close the loop is left as written', async () => {
    const files = { 'a.css': enc('@import "b.css"; .a{}'), 'b.css': enc('@import "a.css"; .b{}') };
    const { srcdoc } = await build('<link rel="stylesheet" href="a.css">', files, []);
    const back = parseMockup(srcdoc);
    if (!back.ok) throw new Error('refused');
    const href = back.doc.querySelector('link')!.getAttribute('href')!;
    expect(href.startsWith('data:text/css;base64,')).toBe(true);
    const a = new TextDecoder().decode(fromB64(href.split(',')[1]!));
    expect(a.startsWith('@import "data:text/css;base64,')).toBe(true);
    expect(a.endsWith('.a{}')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Nesting: inlining is bounded by each USE's real depth, whatever depth the planner first met the file at.
// ---------------------------------------------------------------------------------------------------------------
const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const CSS_DATA = /data:text\/css;base64,([A-Za-z0-9+/=]+)/g;

/** How many `data:text/css` URLs deep `url` is: itself, plus the deepest of the stylesheets written inside it. */
function cssLevels(url: string): number {
  const text = latin1(fromB64(url.slice(url.indexOf(',') + 1)));
  let deepest = 0;
  for (const m of text.matchAll(CSS_DATA)) deepest = Math.max(deepest, cssLevels(m[0]));
  return 1 + deepest;
}

async function hrefsOf(html: string, files: Record<string, Uint8Array<ArrayBuffer>>) {
  const t0 = performance.now();
  const r = await build(html, files, []);
  const ms = performance.now() - t0;
  const back = parseMockup(r.srcdoc);
  if (!back.ok) throw new Error('refused');
  return { ...r, ms, hrefs: [...back.doc.querySelectorAll('link')].map((l) => l.getAttribute('href')!) };
}

describe('buildMockupSrcdoc: nesting is bounded by each use\'s depth (MOCKUP_MAX_CSS_DEPTH)', () => {
  it('a 12-stylesheet chain, every sheet linked from the page, nests its data at most MOCKUP_MAX_CSS_DEPTH times, and the deeper reference stays as written', async () => {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (let i = 0; i < 12; i += 1) files[`s${i}.css`] = enc(i < 11 ? `@import "s${i + 1}.css";` : '.end{}');
    const html = Array.from({ length: 12 }, (_, i) => `<link rel="stylesheet" href="s${i}.css">`).join('');
    const r = await hrefsOf(html, files);
    expect(r.hrefs).toHaveLength(12);
    for (const href of r.hrefs) expect(cssLevels(href)).toBeLessThanOrEqual(MOCKUP_MAX_CSS_DEPTH + 1);
    expect(cssLevels(r.hrefs[0]!)).toBe(MOCKUP_MAX_CSS_DEPTH + 1);
    // The sheet used at the deepest allowed depth keeps its own reference as written.
    const deepest = (url: string): string => {
      const text = latin1(fromB64(url.slice(url.indexOf(',') + 1)));
      const m = text.match(CSS_DATA);
      return m === null ? text : deepest(m[0]);
    };
    expect(deepest(r.hrefs[0]!)).toBe('@import "s4.css";');
    expect(r.srcdoc.length).toBeLessThan(20_000);
    expect(r.ms).toBeLessThan(1500);
  });

  it('a 10-level diamond (each sheet imports the next twice) builds in bounded size and time', async () => {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (let i = 0; i < 10; i += 1) files[`g${i}.css`] = enc(i < 9 ? `@import "g${i + 1}.css"; @import "g${i + 1}.css";` : '.end{}');
    const html = Array.from({ length: 10 }, (_, i) => `<link rel="stylesheet" href="g${i}.css">`).join('');
    const r = await hrefsOf(html, files);
    for (const href of r.hrefs) expect(cssLevels(href)).toBeLessThanOrEqual(MOCKUP_MAX_CSS_DEPTH + 1);
    expect(r.srcdoc.length).toBeLessThan(40_000);
    expect(r.ms).toBeLessThan(1500);
  });

  it('a cycle is built in bounded size and time too, and ends at the depth bound', async () => {
    const files = { 'a.css': enc('@import "b.css"; .a{}'), 'b.css': enc('@import "a.css"; .b{}') };
    const r = await hrefsOf('<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">', files);
    for (const href of r.hrefs) expect(cssLevels(href)).toBeLessThanOrEqual(MOCKUP_MAX_CSS_DEPTH + 1);
    expect(cssLevels(r.hrefs[0]!)).toBe(MOCKUP_MAX_CSS_DEPTH + 1);
    expect(r.srcdoc.length).toBeLessThan(20_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A stylesheet keeps its bytes except at the rewritten spans.
// ---------------------------------------------------------------------------------------------------------------
describe('buildMockupSrcdoc: a stylesheet\'s bytes survive outside the rewritten spans', () => {
  const bytes = (...parts: Array<string | number[]>): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? Array.from(new TextEncoder().encode(p)) : p)));
  const BG = `data:image/png;base64,${b64(enc('BG'))}`;
  const hrefBytes = async (css: Uint8Array<ArrayBuffer>): Promise<Uint8Array> => {
    const r = await hrefsOf('<link rel="stylesheet" href="s.css">', { 's.css': css, 'bg.png': enc('BG') });
    return fromB64(r.hrefs[0]!.slice(r.hrefs[0]!.indexOf(',') + 1));
  };

  it('an invalid UTF-8 byte and a lone lead byte are copied, not replaced by U+FFFD', async () => {
    const css = bytes('.a{content:"', [0xff, 0xe9], '"} .b{background:url(bg.png)} /* ', [0xc3], ' */');
    const out = await hrefBytes(css);
    expect(Array.from(out)).toEqual(Array.from(bytes('.a{content:"', [0xff, 0xe9], `"} .b{background:url(${BG})} /* `, [0xc3], ' */')));
  });

  it('a @charset "iso-8859-1" sheet keeps its high bytes, and a multi-byte character before a token does not shift its span', async () => {
    const css = bytes('@charset "iso-8859-1";\n/* ', [0xe9, 0xe8], ' é */ .b{background:url(bg.png)}');
    const out = await hrefBytes(css);
    expect(Array.from(out)).toEqual(Array.from(bytes('@charset "iso-8859-1";\n/* ', [0xe9, 0xe8], ` é */ .b{background:url(${BG})}`)));
  });

  it('a leading BOM is kept', async () => {
    const css = bytes([0xef, 0xbb, 0xbf], '.b{background:url(bg.png)}');
    const out = await hrefBytes(css);
    expect(Array.from(out)).toEqual(Array.from(bytes([0xef, 0xbb, 0xbf], `.b{background:url(${BG})}`)));
  });

  it('a sheet with no rewritten token is inlined as its original bytes, invalid ones included', async () => {
    const css = bytes('.a{content:"', [0xff, 0xfe, 0xc3], '"} .b{background:url(gone.png)}');
    const r = await hrefsOf('<link rel="stylesheet" href="s.css">', { 's.css': css });
    expect(r.hrefs[0]).toBe(`data:text/css;base64,${b64(css)}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The output cap (D-8662): srcdoc.length <= MOCKUP_MAX_SRCDOC_CHARS, always.
// ---------------------------------------------------------------------------------------------------------------
describe('buildMockupSrcdoc: the output cap (D-8662)', () => {
  const CAP = MOCKUP_MAX_SRCDOC_CHARS;
  const png = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n).fill(0x41);
  const dataLen = (mime: string, n: number): number => `data:${mime};base64,`.length + 4 * Math.ceil(n / 3);
  /** The length of the page with nothing inlined: the page built with no asset bytes, so no reference is replaced. */
  async function baseLength(html: string, files: Record<string, Uint8Array<ArrayBuffer>>): Promise<number> {
    const parsed = parseMockup(html);
    if (!parsed.ok) throw new Error('refused');
    const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'm.html' };
    const plan = planMockupAssets(extractMockupRefs(parsed.doc, PAGE_BASE).refs, {
      project: 'demo', pin,
      tree: treeOk({ entries: [entry('specs', 'm.html'), ...Object.entries(files).map(([p, b]) => sized(p, b.length))], drafts: holder() }),
    });
    const built = buildMockupSrcdoc(parsed.doc, { plan, actualBytes: 0, assets: new Map() }, [], false);
    if (!built.ok) throw new Error('refused');
    expect(built.plan.rows).toEqual(plan.rows);
    return built.page.length;
  }
  const comment = (chars: number): string => `<!--${'x'.repeat(Math.max(0, chars - 7))}-->`;

  it('500 uses of one 100 KiB image: the length is at most the cap, exactly what fits is inlined, the rest are skipped:over-budget in DOM order, and the image is read once', async () => {
    const img = png(100 * 1024);
    const html = `<!doctype html><html><body>${'<img src="a.png">'.repeat(500)}</body></html>`;
    const base = await baseLength(html, { 'a.png': img });
    const cost = dataLen('image/png', img.length) - 'a.png'.length;
    const fits = Math.floor((CAP - base) / cost);
    expect(fits).toBeGreaterThan(10);
    expect(fits).toBeLessThan(500);
    const r = await build(html, { 'a.png': img }, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(r.srcdoc.length).toBe(base + fits * cost);
    expect(occurrences(r.srcdoc, 'data:image/png;base64,')).toBe(fits);
    expect(r.skipped).toEqual(Array.from({ length: 500 - fits }, (_, i) => `r${fits + i}`));
    for (const row of r.plan.rows.slice(fits)) {
      expect(row.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
      expect(row.size).toEqual({ kind: 'listed', bytes: img.length });
    }
    expect(r.plan.context).toBe(r.assets.plan.context);
    expect(r.plan.reservedBytes).toBe(r.assets.plan.reservedBytes);
    expect(r.reads).toEqual(['a.png']);
    // The measured length, for the report.
    process.stdout.write(`C1-T7 cap row: 500 x 100 KiB image -> srcdoc length ${r.srcdoc.length}, inlined ${fits}, skipped ${r.skipped.length}\n`);
  });

  it('a use that exactly reaches the cap is inlined and the next is skipped', async () => {
    // Pad the page, with a comment the serializer keeps, so that exactly four uses fill the cap to the character
    // (the image is under the 2 MiB raster cap, so it is admitted and read once).
    const draft = (pad: string): string => `<!doctype html><html><body>${pad}${'<img src="a.png">'.repeat(5)}</body></html>`;
    const room = CAP - (await baseLength(draft(''), { 'a.png': png(3) }));
    const m = Math.floor((room / 4 - 17) / 4) - 1; // bytes = 3m; one use costs 4m + 17; the pad takes the 8 to 31 left over
    const img = png(3 * m);
    expect(img.length).toBeLessThan(2 * 1024 * 1024);
    const cost = dataLen('image/png', img.length) - 'a.png'.length;
    const left = CAP - (await baseLength(draft(''), { 'a.png': img })) - 4 * cost;
    expect(left).toBeGreaterThanOrEqual(7);
    const exact = draft(comment(left));
    expect((await baseLength(exact, { 'a.png': img })) + 4 * cost).toBe(CAP);
    const r = await build(exact, { 'a.png': img }, []);
    expect(r.srcdoc.length).toBe(CAP);
    expect(occurrences(r.srcdoc, 'data:image/png;base64,')).toBe(4);
    expect(r.skipped).toEqual(['r4']);
    expect(r.plan.rows[4]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    // One character less room: the fourth use no longer fits and is skipped too.
    const tight = await build(draft(comment(left - 1)), { 'a.png': img }, []);
    expect(tight.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(occurrences(tight.srcdoc, 'data:image/png;base64,')).toBe(4);
    const less = await build(draft(comment(left + cost - 1)), { 'a.png': img }, []);
    expect(less.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(occurrences(less.srcdoc, 'data:image/png;base64,')).toBe(3);
    expect(less.skipped).toEqual(['r3', 'r4']);
  });

  it('the cut: at the first use that does not fit, that use and every later use are skipped, even a smaller one', async () => {
    const big = png(1_500_000);
    const small = png(30);
    const draft = (pad: string): string => `<!doctype html><html><body>${pad}<img src="big.png"><img src="big.png"><img src="big.png"><img src="big.png"><img src="small.png"></body></html>`;
    const files = { 'big.png': big, 'small.png': small };
    const base = await baseLength(draft(''), files);
    const bigCost = dataLen('image/png', big.length) - 'big.png'.length;
    const smallCost = dataLen('image/png', small.length) - 'small.png'.length;
    // Room for exactly two big uses and the small one: the third big use is the cut, and the small one after it is not tried.
    const pad = comment(CAP - base - 2 * bigCost - smallCost);
    const r = await build(draft(pad), files, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(r.skipped).toEqual(['r2', 'r3', 'r4']);
    expect(occurrences(r.srcdoc, 'data:image/png;base64,')).toBe(2);
    expect(r.srcdoc).toContain('src="small.png"');
  });

  it('a stylesheet whose own URL does not fit is skipped together with its children', async () => {
    const child = png(90);
    const css = enc('a{background:url(c.png)}');
    const draft = (pad: string): string => `<!doctype html><html><head>${pad}<link rel="stylesheet" href="s.css"></head><body></body></html>`;
    const files = { 's.css': css, 'c.png': child };
    const base = await baseLength(draft(''), files);
    const childCost = dataLen('image/png', child.length) - 'c.png'.length;
    const ownCost = dataLen('text/css', css.length - 'c.png'.length + dataLen('image/png', child.length)) - 's.css'.length;
    expect(childCost).toBeLessThan(ownCost);
    const room = childCost + 20;
    expect(room).toBeLessThan(ownCost);
    const html = draft(comment(CAP - base - room));
    const r = await build(html, files, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(r.srcdoc).toContain('href="s.css"');
    expect(r.srcdoc).not.toContain('data:text/css');
    expect(r.srcdoc).not.toContain('data:image');
    expect(r.skipped).toEqual(['r0', 'r0>0']);
    // The same page with room for the sheet inlines it, children and all, and omits nothing.
    const ok = await build(draft(comment(CAP - base - ownCost)), files, []);
    expect(ok.skipped).toEqual([]);
    expect(ok.srcdoc.length).toBe(CAP);
    expect(ok.srcdoc).toContain('href="data:text/css;base64,');
  });

  it('a child that fits alone but whose sheet then does not is not counted twice: the page is the sheet\'s cost, once', async () => {
    const child = png(90);
    const css = enc('a{background:url(c.png)}');
    const draft = (pad: string): string => `<!doctype html><html><head>${pad}<link rel="stylesheet" href="s.css"></head><body></body></html>`;
    const files = { 's.css': css, 'c.png': child };
    const base = await baseLength(draft(''), files);
    const ownCost = dataLen('text/css', css.length - 'c.png'.length + dataLen('image/png', child.length)) - 's.css'.length;
    // Room for the sheet and nothing besides: a child charged on top of its sheet would push it out.
    const r = await build(draft(comment(CAP - base - ownCost)), files, []);
    expect(r.skipped).toEqual([]);
    expect(r.srcdoc.length).toBe(CAP);
  });

  it('a row that was never loaded is not skipped by the cap', async () => {
    const img = png(100 * 1024);
    const html = `<!doctype html><html><body>${'<img src="a.png">'.repeat(200)}<img src="missing.png"><img src="http://a.example/x.png"><img src="gone.png"></body></html>`;
    const r = await build(html, { 'a.png': img, 'gone.png': img }, []);
    expect(r.skipped).not.toContain('r200');
    expect(r.skipped).not.toContain('r201');
    expect(r.skipped.every((k) => Number(k.slice(1)) < 200 || k === 'r202')).toBe(true);
  });

  it('both modes give identical output, skipped rows included', async () => {
    const img = png(100 * 1024);
    const html = `<!doctype html><html><body>${'<img src="a.png">'.repeat(150)}</body></html>`;
    const a = await build(html, { 'a.png': img }, [], false);
    const b = await build(html, { 'a.png': img }, [], true);
    expect(a.srcdoc).toBe(b.srcdoc);
    expect(a.plan).toEqual(b.plan);
    expect(a.skipped.length).toBeGreaterThan(0);
  });
});

describe('MOCKUP_MAX_SRCDOC_CHARS: derived from the spec\'s worst case (D-8662)', () => {
  it('is the worst case the spec states, built from the existing constants, and at most E4\'s measured render ceiling', () => {
    const longestPrefix = Math.max(...Object.values(MOCKUP_ASSET_MIME).map((r) => `data:${r.mime};base64,`.length));
    expect(MOCKUP_MAX_SRCDOC_CHARS).toBe(
      DOCS_MAX_DOC_BYTES + 4 * Math.ceil(MOCKUP_MAX_ASSET_BYTES / 3) + MOCKUP_MAX_ASSETS * longestPrefix
      + metaFor(MOCKUP_CSP).length + MOCKUP_CLICK_GUARD.length + '<!doctype html>'.length,
    );
    expect(MOCKUP_MAX_SRCDOC_CHARS).toBeLessThanOrEqual(11_200_000);
    expect(MOCKUP_MAX_SRCDOC_CHARS).toBeGreaterThan(DOCS_MAX_DOC_BYTES);
  });
});

describe('buildMockupSrcdoc: the page alone against the cap (D-8662, ruled)', () => {
  const CAP = MOCKUP_MAX_SRCDOC_CHARS;
  const comment = (chars: number): string => `<!--${'x'.repeat(Math.max(0, chars - 7))}-->`;

  it('a double-quote-heavy attribute page whose serialization alone passes the cap is refused, with its length and every loaded use skipped', async () => {
    // Each `"` in an attribute serializes as `&quot;`: a page under the 2 MiB source limit can pass the cap by itself.
    const html = `<!doctype html><html><body><img src="a.png"><p title='${'"'.repeat(1_900_000)}'>x</p></body></html>`;
    expect(html.length).toBeLessThanOrEqual(DOCS_MAX_DOC_BYTES);
    const { doc, assets, reads } = await prepare(html, { 'a.png': new Uint8Array(100).fill(1) });
    expect(reads).toEqual(['a.png']);
    const built = buildMockupSrcdoc(doc, assets, [], false);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.why).toBe('too-large');
    expect(built.cap).toBe(CAP);
    expect(built.chars).toBeGreaterThan(CAP);
    expect('srcdoc' in built).toBe(false);
    expect(built.plan.context).toBe(assets.plan.context);
    expect(built.plan.reservedBytes).toBe(assets.plan.reservedBytes);
    const loaded = built.plan.rows.filter((r) => r.ref.raw === 'a.png');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(loaded[0]!.size).toEqual({ kind: 'listed', bytes: 100 });
    expect(built.plan.rows.some((r) => r.verdict.v === 'inline')).toBe(false); // nothing was inlined
    process.stdout.write(`C1-T7 too-large row: source ${html.length} chars -> serialization ${built.chars} chars (cap ${CAP})\n`);
  });

  it('a page whose serialization is exactly at the cap, with no assets, is admitted; one character more is refused', async () => {
    const draft = (pad: string): string => `<!doctype html><html><body>${pad}</body></html>`;
    const room = CAP - (await (async () => {
      const { doc, assets } = await prepare(draft(''), {});
      const b = buildMockupSrcdoc(doc, assets, [], false);
      return b.ok ? b.page.length : b.chars;
    })());
    const at = await prepare(draft(comment(room)), {});
    const exact = buildMockupSrcdoc(at.doc, at.assets, [], false);
    expect(exact.ok).toBe(true);
    expect(exact.ok && exact.page.length).toBe(CAP);
    const over = await prepare(draft(comment(room + 1)), {});
    const refused = buildMockupSrcdoc(over.doc, over.assets, [], false);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.chars).toBe(CAP + 1);
    expect(!refused.ok && refused.cap).toBe(CAP);
  });

  it('a page just UNDER the cap, with no assets, is admitted untouched', async () => {
    const draft = (pad: string): string => `<!doctype html><html><body>${pad}</body></html>`;
    const probe = await prepare(draft(''), {});
    const first = buildMockupSrcdoc(probe.doc, probe.assets, [], false);
    const room = CAP - (first.ok ? first.page.length : first.chars);
    const under = await prepare(draft(comment(room - 1)), {});
    const built = buildMockupSrcdoc(under.doc, under.assets, [], false);
    expect(built.ok).toBe(true);
    expect(built.ok && built.page.length).toBe(CAP - 1);
  });

  it('a heavy 6-sheet diamond (800 KB sheets, each importing the next twice) is bounded by the cap, with the uses past it skipped', async () => {
    const pad = ' '.repeat(800_000);
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (let i = 0; i < 6; i += 1) files[`g${i}.css`] = enc(`/*${pad}*/${i < 5 ? `@import "g${i + 1}.css"; @import "g${i + 1}.css";` : '.end{}'}`);
    const html = Array.from({ length: 6 }, (_, i) => `<link rel="stylesheet" href="g${i}.css">`).join('');
    const r = await build(html, files, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(r.skipped.length).toBeGreaterThan(0);
    for (const row of r.plan.rows.filter((x) => x.size !== null && x.verdict.v === 'skipped')) expect(row.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
  });

  it('a heavy 12-sheet chain is bounded by the cap too', async () => {
    const pad = ' '.repeat(400_000);
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (let i = 0; i < 12; i += 1) files[`s${i}.css`] = enc(`/*${pad}*/${i < 11 ? `@import "s${i + 1}.css";` : '.end{}'}`);
    const html = Array.from({ length: 12 }, (_, i) => `<link rel="stylesheet" href="s${i}.css">`).join('');
    const r = await build(html, files, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 3: the cut keeps every row's verdict in step with the page; the build cannot be made to freeze.
// ---------------------------------------------------------------------------------------------------------------
describe('buildMockupSrcdoc: the cut agrees with the page, and reused sheets stay cheap (round 3)', () => {
  const CAP = MOCKUP_MAX_SRCDOC_CHARS;
  const fill = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n).fill(0x41);
  const comment = (chars: number): string => `<!--${'x'.repeat(Math.max(0, chars - 7))}-->`;
  const dataLen = (mime: string, n: number): number => `data:${mime};base64,`.length + 4 * Math.ceil(n / 3);
  const bigSheet = (head: string, n = 1_900_000): Uint8Array<ArrayBuffer> => enc(`${head}/*${'z'.repeat(n)}*/`);
  async function baseLen(html: string, files: Record<string, Uint8Array<ArrayBuffer>>): Promise<number> {
    const { doc, assets } = await prepare(html, files);
    const b = buildMockupSrcdoc(doc, { ...assets, assets: new Map() }, [], false);
    return b.ok ? b.page.length : b.chars;
  }
  const verdicts = (plan: MockupAssetPlan): Record<string, string> => Object.fromEntries(plan.rows.map((r) => [r.ref.key, r.verdict.v]));

  it('P1: a 2 MB a.css importing b.css (which uses i.png) that does not fit, then c.css importing b.css: nothing is inlined, and every row says so', async () => {
    const files = { 'a.css': bigSheet('@import "b.css";'), 'b.css': enc('x{background:url(i.png)}'), 'i.png': fill(50), 'c.css': enc('@import "b.css";') };
    const html = (pad: string): string => `<!doctype html><html><head>${pad}<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="c.css"></head><body></body></html>`;
    const base = await baseLen(html(''), files);
    const r = await build(html(comment(CAP - base - 200_000)), files, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(r.srcdoc).not.toContain('data:text/css');
    expect(r.srcdoc).not.toContain('data:image');
    for (const row of r.plan.rows) {
      expect(row.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
      expect(row.size).not.toBeNull();
    }
    expect(r.plan.rows.length).toBe(5);
  });

  it('P1 reversed: c.css (small) first is inlined with b.css and i.png; a.css after it is the cut and is skipped with its own use of b.css', async () => {
    const files = { 'a.css': bigSheet('@import "b.css";'), 'b.css': enc('x{background:url(i.png)}'), 'i.png': fill(50), 'c.css': enc('@import "b.css";') };
    const html = (pad: string): string => `<!doctype html><html><head>${pad}<link rel="stylesheet" href="c.css"><link rel="stylesheet" href="a.css"></head><body></body></html>`;
    const base = await baseLen(html(''), files);
    const r = await build(html(comment(CAP - base - 200_000)), files, []);
    expect(r.srcdoc.length).toBeLessThanOrEqual(CAP);
    expect(verdicts(r.plan)).toEqual({ r0: 'inline', r1: 'skipped', 'r0>0': 'inline', 'r0>0>0': 'inline', 'r1>0': 'skipped' });
    const back = parseMockup(r.srcdoc);
    if (!back.ok) throw new Error('refused');
    const [c, a] = [...back.doc.querySelectorAll('link')].map((l) => l.getAttribute('href')!);
    expect(a).toBe('a.css');
    const cText = latin1(fromB64(c!.slice(c!.indexOf(',') + 1)));
    const bUrl = cText.match(CSS_DATA)![0];
    expect(latin1(fromB64(bUrl.slice(bUrl.indexOf(',') + 1)))).toContain('url(data:image/png;base64,');
  });

  it('a sheet reused after the cut is skipped along with its children, unless an earlier use inlined them', async () => {
    const files = { 's.css': enc('x{background:url(i.png)}'), 'i.png': fill(50), 'big.png': fill(1_500_000) };
    const html = (pad: string): string => `<!doctype html><html><body>${pad}<link rel="stylesheet" href="s.css"><img src="big.png"><img src="big.png"><img src="big.png"><img src="big.png"><img src="big.png"><link rel="stylesheet" href="s.css"></body></html>`;
    const base = await baseLen(html(''), files);
    const bigCost = dataLen('image/png', 1_500_000) - 'big.png'.length;
    const r = await build(html(comment(CAP - base - 2 * bigCost - 1000)), files, []);
    expect(verdicts(r.plan)).toEqual({
      r0: 'inline', 'r0>0': 'inline', r1: 'inline', r2: 'inline', r3: 'skipped', r4: 'skipped', r5: 'skipped', r6: 'skipped',
    });
    expect(occurrences(r.srcdoc, 'data:text/css')).toBe(1);
  });

  it('P4: 900 imports of one 2 MiB sheet, each spelled differently, finish in under 2 s with every use skipped', async () => {
    const toks = Array.from({ length: 900 }, (_, k) => `@import "${'./'.repeat(k)}b.css";`);
    const files = { 'a.css': enc(toks.join('\n')), 'b.css': bigSheet('', 2_000_000) };
    const html = '<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body></body></html>';
    const { doc, assets } = await prepare(html, files);
    const t0 = performance.now();
    const built = buildMockupSrcdoc(doc, assets, [], false);
    const ms = performance.now() - t0;
    process.stdout.write(`C1-T7 P4 row: ${Math.round(ms)} ms, a.css ${files['a.css'].length} bytes, ${assets.plan.rows.length} rows\n`);
    expect(ms).toBeLessThan(2000);
    if (!built.ok) throw new Error('refused');
    expect(built.page.length).toBeLessThanOrEqual(CAP);
    expect(built.page).not.toContain('data:text/css');
    expect(built.plan.rows.every((r) => r.verdict.v === 'skipped' && r.size !== null)).toBe(true);
    expect(built.plan.rows).toHaveLength(901);
  });

  it('a sheet used many times at one depth is built once: the built URL is remembered by (file, depth)', async () => {
    const files = { 's.css': enc('a{background:url(i.png)}'), 'i.png': fill(50) };
    const html = `<!doctype html><html><head>${'<link rel="stylesheet" href="s.css">'.repeat(20)}</head><body></body></html>`;
    const { doc, assets } = await prepare(html, files);
    const spy = vi.spyOn(globalThis, 'btoa');
    const built = buildMockupSrcdoc(doc, assets, [], false);
    expect(built.ok).toBe(true);
    // The image once, the sheet once: the other nineteen uses reuse the sheet's URL.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(built.ok && occurrences(built.page, 'data:text/css;base64,')).toBe(20);
  });

  it('a sheet whose cheapest possible URL does not fit is the cut with no build at all', async () => {
    const files = { 's.css': bigSheet('', 1_900_000) };
    const html = (pad: string): string => `<!doctype html><html><head>${pad}<link rel="stylesheet" href="s.css"></head><body></body></html>`;
    const base = await baseLen(html(''), files);
    const { doc, assets } = await prepare(html(comment(CAP - base - 1000)), files);
    const spy = vi.spyOn(globalThis, 'btoa');
    const built = buildMockupSrcdoc(doc, assets, [], false);
    expect(spy).not.toHaveBeenCalled();
    expect(built.ok && built.plan.rows[0]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
  });
});

describe('buildMockupSrcdoc: every row agrees with the page (round 4)', () => {
  const sheetsOf = (n: number): Record<string, Uint8Array<ArrayBuffer>> => {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (let i = 0; i < n; i += 1) files[`s${i}.css`] = enc(i < n - 1 ? `@import "s${i + 1}.css";` : '.end{}');
    return files;
  };
  const links = (names: string[]): string => `<!doctype html><html><head>${names.map((n) => `<link rel="stylesheet" href="${n}">`).join('')}</head><body></body></html>`;

  it('the 12-sheet chain: every row is inline and its data URL is in the page', async () => {
    const files = sheetsOf(12);
    const r = await build(links(Object.keys(files)), files, []);
    expect(r.plan.rows).toHaveLength(23);
    for (const row of r.plan.rows) expect(row.verdict.v).toBe('inline');
    const back = parseMockup(r.srcdoc);
    if (!back.ok) throw new Error('refused');
    const hrefs = [...back.doc.querySelectorAll('link')].map((l) => l.getAttribute('href')!);
    // Row r<j> is link j's data URL; row r<j>>0 is the reference to the next sheet inside it: both are written.
    for (const href of hrefs) expect(href.startsWith('data:text/css;base64,')).toBe(true);
    for (let j = 0; j < 11; j += 1) {
      const text = latin1(fromB64(hrefs[j]!.slice(hrefs[j]!.indexOf(',') + 1)));
      expect(text.startsWith(`@import "data:text/css;base64,`)).toBe(true);
    }
  });

  it('a sheet first reached shallow and also deep: the deep use no use reaches is unsupported:css-depth, its size kept, and the rest stay inline', async () => {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {
      'a.css': enc('@import "b.css";'), 'b.css': enc('@import "c.css";'), 'c.css': enc('@import "d.css";'), 'd.css': enc('@import "e.css";'), 'e.css': enc('.e{}'),
    };
    const { doc, assets } = await prepare(links(['a.css', 'e.css']), files);
    const rows = assets.plan.rows;
    const deepIndex = rows.findIndex((x) => x.ref.key === 'r0>0>0>0>0');
    expect(rows[deepIndex]!.verdict).toEqual({ v: 'unsupported', why: 'css-depth' });
    // The planner is Task 6's; here the row is given the inline verdict of the same file's shallow use, so the build is
    // asked about a row it admitted but can reach at no use within the depth limit.
    const shallow = rows.find((x) => x.ref.key === 'r1')!;
    const patched = { ...assets, plan: { ...assets.plan, rows: rows.map((x, i) => (i === deepIndex ? { ...x, verdict: shallow.verdict, size: shallow.size } : x)) } };
    const built = buildMockupSrcdoc(doc, patched, [], false);
    if (!built.ok) throw new Error('refused');
    const byKey = Object.fromEntries(built.plan.rows.map((x) => [x.ref.key, x]));
    expect(byKey['r0>0>0>0>0']!.verdict).toEqual({ v: 'unsupported', why: 'css-depth' });
    expect(byKey['r0>0>0>0>0']!.size).toEqual(shallow.size);
    for (const k of ['r0', 'r1', 'r0>0', 'r0>0>0', 'r0>0>0>0']) expect(byKey[k]!.verdict.v).toBe('inline');
    expect(built.plan.context).toBe(assets.plan.context);
  });
});

describe('the origin port range', () => {
  it('isMockupOrigin refuses a port over 65535 and accepts 65535', () => {
    expect(isMockupOrigin('https://a.example:65535')).toBe(true);
    expect(isMockupOrigin('https://a.example:65536')).toBe(false);
    expect(isMockupOrigin('https://a.example:70000')).toBe(false);
    expect(isMockupOrigin('https://a.example:')).toBe(false);
    expect(isMockupOrigin('https://a.example:123456')).toBe(false);
  });
});
