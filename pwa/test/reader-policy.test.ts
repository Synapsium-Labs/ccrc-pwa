// Docs W8a Task 5: the reader's L1 decisions (`docs/reader/policy.ts`, `readerText.ts`), the enumerable storage port
// in `lib/storage.ts` and `replaceFragment` in `lib/router.ts`. Every page is a placeholder (`demo`, `a/b.md`,
// `example-org/example-repo`); control characters are built with `String.fromCharCode`, never written raw.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ts } from '../../server/test/scan/parse';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_LIMITS } from '@synapsium-labs/docserver/frame';
import { DOC_SECTION_SLUGS } from '../../shared/docs';
import { DOCS_PARSE_BUDGET_MS } from '../src/lib/markdownLimits';
import { READER_COPY_WRITE_MAX_BYTES, READER_LAB_DRAW_WATCHDOG_MS } from '../src/lib/readerLimits';
import { enumerablePageStorage } from '../src/lib/storage';
import { replaceFragment } from '../src/lib/router';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import {
  copyDecision, docsDrawFor, oneBarTools, READER_E17_MERMAID, readerBarTitle, readerBodyReducer, readerChromeFor,
  readerDocKey, readerMountFocusFor, readerMountPlan, readerPrefsOf, readerWatchdogMs, routeReaderLink,
  type ReaderBodyState, type ReaderChrome, type ReaderE17Reading, type ReaderLink,
} from '../src/docs/reader/policy';
import { THEMES } from '@ccrc/ui';
import { markHiddenText, READER_FALLBACK_NOTE, READER_SHEET_TEXT } from '../src/docs/reader/readerText';
import { entry, treeOk } from './docsFixtures';

const SECTION = DOC_SECTION_SLUGS[0]!;

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

/** The page every case routes on: `a/b.md` of `demo`, in the first section, with `a/c.md` in the tree. */
function ctx(): DocLinkContextValue {
  return {
    project: 'demo', pageRef: null, pageAt: null, view: 'committed', section: SECTION, path: 'a/b.md',
    tree: treeOk({ entries: [entry(SECTION, 'a/b.md'), entry(SECTION, 'a/c.md')] }), pageSource: 'committed',
    urls: new WeakMap(), onFragment: vi.fn(),
  };
}

const external = (url: string, host: string, scheme: 'http' | 'https' | 'mailto' = 'https'): ReaderLink =>
  ({ kind: 'external', url, scheme, host });

describe('routeReaderLink', () => {
  it('relative /api/x is inert', () => {
    expect(routeReaderLink(ctx(), { kind: 'relative', path: '/api/x', fragment: null }, 'b.a.example')).toEqual({ kind: 'inert' });
  });

  it('a path above the root is inert', () => {
    // The page sits four directories deep (three of the section's path and `a`): five climbs leave the repository.
    const up = ['..', '..', '..', '..', '..'].join('/');
    expect(routeReaderLink(ctx(), { kind: 'relative', path: `${up}/x.md`, fragment: null }, 'b.a.example')).toEqual({ kind: 'inert' });
  });

  it('a doc link routes in-app with its query dropped and its fragment kept', () => {
    // The library dropped `?x=1` before it handed the link over: only a path and a fragment arrive.
    const r = routeReaderLink(ctx(), { kind: 'relative', path: 'c.md', fragment: 'h' }, 'b.a.example');
    expect(r.kind).toBe('in-app');
    if (r.kind !== 'in-app') return;
    expect(r.href).not.toContain('?');
    expect(r.href).toContain('a/c.md');
    expect(r.fragment).toBe('h');
  });

  it('an external https link opens the sheet, foreign, with its host', () => {
    // The two hosts share their last two labels, so only the exact comparison of the W8a plan's refinement (h) calls it foreign.
    expect(routeReaderLink(ctx(), external('https://c.a.example/p', 'c.a.example'), 'b.a.example')).toEqual({
      kind: 'sheet', url: 'https://c.a.example/p', scheme: 'https', host: 'c.a.example', foreign: true,
    });
  });

  it('the console\'s own host is not foreign', () => {
    const r = routeReaderLink(ctx(), external('https://b.a.example/p', 'b.a.example'), 'b.a.example');
    expect(r).toMatchObject({ kind: 'sheet', host: 'b.a.example', foreign: false });
  });

  it('an external link with a port compares and reports its hostname, without the port', () => {
    const r = routeReaderLink(ctx(), external('https://b.a.example:8443/p', 'b.a.example:8443'), 'b.a.example');
    expect(r).toEqual({ kind: 'sheet', url: 'https://b.a.example:8443/p', scheme: 'https', host: 'b.a.example', foreign: false });
  });

  it('a mailto external link opens the sheet with its scheme and its host', () => {
    expect(routeReaderLink(ctx(), external('mailto:x@c.a.example', 'c.a.example', 'mailto'), 'b.a.example')).toEqual({
      kind: 'sheet', url: 'mailto:x@c.a.example', scheme: 'mailto', host: 'c.a.example', foreign: true,
    });
  });

  it('a mailto with no host (empty, or recipients only in ?to=) still opens a sheet, and its warning never reads "goes to ."', () => {
    for (const url of ['mailto:', 'mailto:?to=x@c.a.example']) {
      const r = routeReaderLink(ctx(), external(url, '', 'mailto'), 'b.a.example');
      expect(r).toEqual({ kind: 'sheet', url, scheme: 'mailto', host: '', foreign: true });
      const warning = READER_SHEET_TEXT.linkForeign('');
      expect(warning).not.toMatch(/goes to\s*\./);
      expect(warning).toContain('mail');
    }
    expect(READER_SHEET_TEXT.linkForeign('c.a.example'), 'a named host is still named').toContain('goes to c.a.example.');
  });

  it('an external link whose URL does not parse, or whose scheme is outside the allowlist, is inert', () => {
    expect(routeReaderLink(ctx(), external('not a url', 'x'), 'b.a.example')).toEqual({ kind: 'inert' });
    // The classifier said https; the URL says otherwise: the URL rules.
    expect(routeReaderLink(ctx(), external('ftp://c.a.example/p', 'c.a.example'), 'b.a.example')).toEqual({ kind: 'inert' });
    expect(routeReaderLink(ctx(), external('javascript:alert(1)', 'c.a.example'), 'b.a.example')).toEqual({ kind: 'inert' });
  });

  it('a link to this same page with a fragment becomes a hash that reopens the frame (the frame sent it to the host as a navigate)', () => {
    expect(routeReaderLink(ctx(), { kind: 'relative', path: 'b.md', fragment: 'h' }, 'b.a.example'))
      .toEqual({ kind: 'hash', id: 'h', reopen: true });
  });

  it('a relative link to another page stays in-app, and carries no reopen', () => {
    const r = routeReaderLink(ctx(), { kind: 'relative', path: 'c.md', fragment: 'h' }, 'b.a.example');
    expect(r.kind).toBe('in-app');
    expect(r).not.toHaveProperty('reopen');
  });

  it('the comparison is exact and lower-cased', () => {
    expect(routeReaderLink(ctx(), external('https://B.A.Example/p', 'B.A.Example'), 'b.a.example'))
      .toMatchObject({ foreign: false });
  });

  it('a repo resolution opens the sheet on the GitHub blob URL', () => {
    // Four climbs reach the repository root: `README.md` there is outside the four sections.
    const up = ['..', '..', '..', '..'].join('/');
    const r = routeReaderLink(ctx(), { kind: 'relative', path: `${up}/README.md`, fragment: null }, 'b.a.example');
    expect(r.kind).toBe('sheet');
    if (r.kind !== 'sheet') return;
    expect(r.url).toMatch(/^https:\/\/github\.com\/example-org\/example-repo\/blob\/.*README\.md$/);
    expect(r).toMatchObject({ scheme: 'https', host: 'github.com', foreign: true });
  });

  it('a fragment link becomes a hash that does not reopen (the frame scrolls to an anchor it finds by itself)', () => {
    expect(routeReaderLink(ctx(), { kind: 'fragment', id: 'sec' }, 'b.a.example')).toEqual({ kind: 'hash', id: 'sec', reopen: false });
  });
});

describe('readerMountFocusFor', () => {
  it('the Docs reader focuses its frame at mount when no outside element owns focus', () => {
    expect(readerMountFocusFor(undefined, false)).toBe(true);
  });

  it('the Docs reader leaves focus alone when an element outside the reader owns it', () => {
    expect(readerMountFocusFor(undefined, true)).toBe(false);
  });

  it('the reader lab focuses unconditionally, whoever owns focus', () => {
    expect(readerMountFocusFor('lab-draw', false)).toBe(true);
    expect(readerMountFocusFor('lab-draw', true)).toBe(true);
  });
});

describe('copyDecision', () => {
  it('clean text is written', () => {
    expect(copyDecision('plain text', [])).toEqual({ kind: 'write', text: 'plain text' });
  });

  it('ESC, U+202E and U+200B each send the text to the sheet with their indices', () => {
    const esc = String.fromCharCode(27);
    const rlo = String.fromCharCode(0x202e);
    const zws = String.fromCharCode(0x200b);
    const text = `a${esc}b${rlo}c${zws}d`;
    const hidden: { index: number; codePoint: number; name: string }[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code === 27) hidden.push({ index: i, codePoint: code, name: 'ESCAPE' });
      if (code === 0x202e) hidden.push({ index: i, codePoint: code, name: 'RIGHT-TO-LEFT OVERRIDE' });
      if (code === 0x200b) hidden.push({ index: i, codePoint: code, name: 'ZERO WIDTH SPACE' });
    }
    const d = copyDecision(text, hidden);
    expect(d.kind).toBe('sheet');
    if (d.kind !== 'sheet') return;
    expect(d.text).toBe(text);
    expect(d.hidden.map((h) => h.index)).toEqual([1, 3, 5]);
  });

  it('the write cap is the library\'s own copy cap, so the library refuses an over-cap copy first and this is its backstop', () => {
    expect(READER_COPY_WRITE_MAX_BYTES).toBe(BRIDGE_LIMITS.copyMaxBytes);
  });

  it('text over the cap goes to the sheet (a backstop: the library refuses an over-cap copy before the adapter is asked)', () => {
    expect(copyDecision('a'.repeat(65536), []).kind).toBe('write');
    expect(copyDecision('a'.repeat(65537), []).kind).toBe('sheet');
    // Bytes, not code units: 32 769 two-byte characters are 65 538 bytes.
    expect(copyDecision('é'.repeat(32769), []).kind).toBe('sheet');
  });
});

describe('readerDocKey', () => {
  it('demo:<section>:a/b.md is the doc key', () => {
    expect(readerDocKey('demo', SECTION, 'a/b.md')).toBe(`demo:${SECTION}:a/b.md`);
  });

  it('a key over 1024 code units is null', () => {
    expect(readerDocKey('demo', SECTION, 'a'.repeat(1024))).toBeNull();
    const fits = 1024 - `demo:${SECTION}:`.length;
    expect(readerDocKey('demo', SECTION, 'a'.repeat(fits))).not.toBeNull();
  });

  it('a key with a control character is null', () => {
    for (const code of [0, 9, 27, 0x7f, 0x80, 0x9f]) {
      expect(readerDocKey('demo', SECTION, `a${String.fromCharCode(code)}b.md`), `U+${code.toString(16)}`).toBeNull();
    }
    expect(readerDocKey('demo', SECTION, 'a b.md')).not.toBeNull();
  });
});

describe('readerPrefsOf', () => {
  it('the choice system gives auto', () => {
    expect(readerPrefsOf('system', THEMES)).toEqual({ theme: 'auto' });
  });

  it('the choice system gives auto even when a palette carries that id', () => {
    // `system` follows the device even when a palette list carries that id.
    expect(readerPrefsOf('system', [{ id: 'system', mode: 'dark' }])).toEqual({ theme: 'auto' });
  });

  it('the choice light passes through as light', () => {
    expect(readerPrefsOf('light', THEMES)).toEqual({ theme: 'light' });
  });

  it('the choice dark passes through as dark', () => {
    expect(readerPrefsOf('dark', [{ id: 'dark', mode: 'dark' }])).toEqual({ theme: 'dark' });
  });

  it('a named dark palette gives dark', () => {
    expect(readerPrefsOf('nord', THEMES)).toEqual({ theme: 'dark' });
    expect(readerPrefsOf('dracula', THEMES)).toEqual({ theme: 'dark' });
  });

  it('a named light palette gives light', () => {
    expect(readerPrefsOf('github-light', THEMES)).toEqual({ theme: 'light' });
    expect(readerPrefsOf('catppuccin-latte', THEMES)).toEqual({ theme: 'light' });
  });

  it('an unknown id gives auto', () => {
    expect(readerPrefsOf('something-else', THEMES)).toEqual({ theme: 'auto' });
  });

  it('the empty id gives auto', () => {
    expect(readerPrefsOf('', THEMES)).toEqual({ theme: 'auto' });
  });

  it('a palette not in the list the caller hands in is unknown, so it gives auto', () => {
    expect(readerPrefsOf('nord', [{ id: 'light', mode: 'light' }])).toEqual({ theme: 'auto' });
  });

  it.each(THEMES.map((t) => [t.id, t.mode] as const))('every shipped palette: %s reads %s', (id, mode) => {
    expect(readerPrefsOf(id, THEMES)).toEqual({ theme: mode });
  });
});

describe('readerWatchdogMs', () => {
  it('the watchdog equals DOCS_PARSE_BUDGET_MS at 0, 65536 and 524288 bytes', () => {
    for (const bytes of [0, 65536, 524288]) expect(readerWatchdogMs(bytes)).toBe(DOCS_PARSE_BUDGET_MS(bytes));
  });
});

describe('readerBodyReducer', () => {
  const events = [
    { e: 'mount' }, { e: 'ready' }, { e: 'fallback', reason: 'x' }, { e: 'plain', why: 'y' },
  ] as const;

  it('fallback is terminal for a body key', () => {
    const s: ReaderBodyState = { s: 'fallback', reason: 'timeout' };
    for (const ev of events) expect(readerBodyReducer(s, ev)).toBe(s);
  });

  it('plain is terminal', () => {
    const s: ReaderBodyState = { s: 'plain', why: 'gate' };
    for (const ev of events) expect(readerBodyReducer(s, ev)).toBe(s);
  });

  it('plain is chosen only before a mount: from rendering', () => {
    expect(readerBodyReducer({ s: 'rendering' }, { e: 'plain', why: 'gate' })).toEqual({ s: 'plain', why: 'gate' });
    const mounting: ReaderBodyState = { s: 'mounting' };
    const ready: ReaderBodyState = { s: 'ready' };
    expect(readerBodyReducer(mounting, { e: 'plain', why: 'gate' })).toBe(mounting);
    expect(readerBodyReducer(ready, { e: 'plain', why: 'gate' })).toBe(ready);
  });

  it('plain carries the render budget of a timeout, and only then', () => {
    expect(readerBodyReducer({ s: 'rendering' }, { e: 'plain', why: 'timeout', budgetMs: 4000 }))
      .toEqual({ s: 'plain', why: 'timeout', budgetMs: 4000 });
    expect(readerBodyReducer({ s: 'rendering' }, { e: 'plain', why: 'refused' })).not.toHaveProperty('budgetMs');
    const mounting: ReaderBodyState = { s: 'mounting' };
    expect(readerBodyReducer(mounting, { e: 'plain', why: 'timeout', budgetMs: 4000 })).toBe(mounting);
  });

  it('rendering mounts, mounting becomes ready, and a failure falls back', () => {
    expect(readerBodyReducer({ s: 'rendering' }, { e: 'mount' })).toEqual({ s: 'mounting' });
    expect(readerBodyReducer({ s: 'mounting' }, { e: 'ready' })).toEqual({ s: 'ready' });
    expect(readerBodyReducer({ s: 'mounting' }, { e: 'fallback', reason: 'timeout' })).toEqual({ s: 'fallback', reason: 'timeout' });
    expect(readerBodyReducer({ s: 'ready' }, { e: 'fallback', reason: 'late' })).toEqual({ s: 'fallback', reason: 'late' });
    expect(readerBodyReducer({ s: 'rendering' }, { e: 'plain', why: 'gate' })).toEqual({ s: 'plain', why: 'gate' });
  });
});

describe('readerText', () => {
  it('the fallback note is the fixed sentence', () => {
    expect(READER_FALLBACK_NOTE).toBe('The rich view did not start; shown in the plain view.');
  });

  it('the copy sheet names a hidden character as U+XXXX NAME in brackets', () => {
    const mark = READER_SHEET_TEXT.copyMarker({ index: 0, codePoint: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE' });
    expect(mark).toBe(`${String.fromCharCode(0x27e6)}U+202E RIGHT-TO-LEFT OVERRIDE${String.fromCharCode(0x27e7)}`);
  });
});

describe('enumerablePageStorage', () => {
  it('is null when naming localStorage throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(enumerablePageStorage()).toBeNull();
  });

  it('exposes key() and length', () => {
    const s = enumerablePageStorage();
    expect(s).not.toBeNull();
    if (s === null) return;
    const before = s.length;
    s.setItem('reader-policy-test', '1');
    try {
      expect(s.length).toBe(before + 1);
      const keys = Array.from({ length: s.length }, (_, i) => s.key(i));
      expect(keys).toContain('reader-policy-test');
      expect(s.key(s.length)).toBeNull();
    } finally {
      s.removeItem('reader-policy-test');
    }
  });
});

describe('replaceFragment', () => {
  it('keeps history.state and does not notify', () => {
    history.replaceState({ a: 1 }, '', '/docs/demo');
    // Two observers, because the router calls the global `dispatchEvent`: a spy on it, and a `popstate` listener.
    const spy = vi.spyOn(globalThis, 'dispatchEvent');
    const heard = vi.fn();
    addEventListener('popstate', heard);
    try {
      replaceFragment('h');
    } finally {
      removeEventListener('popstate', heard);
    }
    expect(heard).not.toHaveBeenCalled();
    expect(history.state).toEqual({ a: 1 });
    expect(location.hash).toBe('#h');
    expect(location.pathname).toBe('/docs/demo');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('markHiddenText', () => {
  const zws = String.fromCharCode(0x200b);
  const esc = String.fromCharCode(27);
  const z = (index: number) => ({ index, codePoint: 0x200b, name: 'ZERO WIDTH SPACE' });
  const e = (index: number) => ({ index, codePoint: 27, name: 'ESCAPE' });
  const mz = READER_SHEET_TEXT.copyMarker(z(0));
  const me = READER_SHEET_TEXT.copyMarker(e(0));

  it('replaces each listed character in place and leaves the text around it', () => {
    expect(markHiddenText(`a${zws}b${esc}c`, [z(1), e(3)], 64)).toEqual({ text: `a${mz}b${me}c`, unnamed: 0 });
  });

  it('takes an unsorted list in text order', () => {
    expect(markHiddenText(`a${zws}b${esc}c`, [e(3), z(1)], 64)).toEqual({ text: `a${mz}b${me}c`, unnamed: 0 });
    expect(markHiddenText(`${zws}${zws}${zws}`, [z(2), z(0), z(1)], 1)).toEqual({ text: `${mz}${READER_SHEET_TEXT.copyMarkerUnnamed}${READER_SHEET_TEXT.copyMarkerUnnamed}`, unnamed: 2 });
  });

  it('marks a duplicate index once', () => {
    expect(markHiddenText(`a${zws}b`, [z(1), z(1)], 64)).toEqual({ text: `a${mz}b`, unnamed: 0 });
  });

  it('takes a two-unit character whole, with no stray surrogate left', () => {
    const astral = String.fromCodePoint(0xe0001);
    const m = READER_SHEET_TEXT.copyMarker({ index: 1, codePoint: 0xe0001, name: 'LANGUAGE TAG' });
    const r = markHiddenText(`a${astral}b`, [{ index: 1, codePoint: 0xe0001, name: 'LANGUAGE TAG' }], 64);
    expect(r).toEqual({ text: `a${m}b`, unnamed: 0 });
    expect(/[\ud800-\udfff]/.test(r.text)).toBe(false);
  });

  it('skips an entry out of range or naming another character, and that character stays as it is', () => {
    expect(markHiddenText(`a${zws}b`, [z(9)], 64)).toEqual({ text: `a${zws}b`, unnamed: 0 });
    expect(markHiddenText(`a${zws}b`, [e(1)], 64)).toEqual({ text: `a${zws}b`, unnamed: 0 });
    expect(markHiddenText(`a${zws}b`, [z(-1)], 64)).toEqual({ text: `a${zws}b`, unnamed: 0 });
    expect(markHiddenText(`a${zws}b${esc}`, [e(1), z(1), e(3)], 64)).toEqual({ text: `a${mz}b${me}`, unnamed: 0 });
  });
});

describe('the library 1.1 take-up: the reader\'s decisions (the take-up plan, Task 3)', () => {
  const READINGS: readonly ReaderE17Reading[] = ['holds', 'does-not-hold', 'not-measured'];
  const CHROMES: readonly ReaderChrome[] = ['frame-bar', 'host-bar'];

  it('docsDrawFor draws after ready only when the E17 Mermaid line holds', () => {
    expect(docsDrawFor('holds')).toBe('after-ready');
    expect(docsDrawFor('does-not-hold')).toBe('on-request');
    expect(docsDrawFor('not-measured')).toBe('on-request');
  });

  it('READER_E17_MERMAID is the reading the operator\'s block gave', () => {
    expect(READER_E17_MERMAID).toBe('does-not-hold');
  });

  it('readerMountPlan: the Docs reader draws as the reading says and has the bar it asked for', () => {
    for (const e17 of READINGS) {
      for (const chrome of CHROMES) {
        expect(readerMountPlan(undefined, 100, chrome, e17))
          .toEqual({ draw: docsDrawFor(e17), watchdogMs: readerWatchdogMs(100), store: true, chrome, history: true });
      }
    }
  });

  it('readerMountPlan: lab-draw draws on open in the auto mode, on the frame\'s own bar, whatever the reading and the bar asked for', () => {
    for (const e17 of READINGS) {
      for (const chrome of CHROMES) {
        expect(readerMountPlan('lab-draw', 100, chrome, e17))
          .toEqual({ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar', history: false });
      }
    }
  });

  it('readerChromeFor: ccrc\'s bar at the compact width, the frame\'s own bar otherwise', () => {
    expect(readerChromeFor(true)).toBe('host-bar');
    expect(readerChromeFor(false)).toBe('frame-bar');
  });

  it('oneBarTools: the quick jump and the contents; a plan\'s Outline on a plans leaf; never the reading settings', () => {
    for (const section of ['specs', 'product-design', 'conventions'] as const) {
      expect(oneBarTools(section)).toEqual(['jump', 'contents']);
    }
    expect(oneBarTools('plans')).toEqual(['jump', 'contents', 'outline']);
    for (const section of DOC_SECTION_SLUGS) expect(oneBarTools(section)).not.toContain('settings');
  });

  it('readerBarTitle: the document\'s first level-1 heading, else the file name', () => {
    expect(readerBarTitle('Path identity design', 'a.md')).toBe('Path identity design');
    expect(readerBarTitle(null, 'a.md')).toBe('a.md');
    expect(readerBarTitle('  ', 'a.md')).toBe('a.md');
  });
});

// The policy ring (the architecture spec's L1, completion plan Task 13): `policy.ts` is pure deciders, so nothing it reaches
// at run time may be a `.tsx`, a module that imports `react` or `react-dom` (a hook module), a store, `lib/api.ts` or
// `@ccrc/ui`. The walk follows every runtime import and re-export through relative specifiers, reading the declarations
// with the TypeScript compiler API; `import type` / `export type` declarations are erased and skipped. Bare package
// specifiers are leaves, but `react`, `react-dom` and `@ccrc/ui` are each a break: `@ccrc/ui` is the design system,
// consumed as source, and its one entry loads its React components (review 2480's A3). A declaration whose named
// specifiers are all `type` is NOT erased: under the package's `verbatimModuleSyntax` it compiles to `import {} from` (or
// `export {} from`), which still loads the module (review of Task 13, minor 2). `docLinkTarget` once lived in
// `docsLinks.ts`, which imports `pinFor` from the `useDocsVisit.ts` hook module: that chain is what this walk turns red on.
const PWA_ROOT = path.join(import.meta.dirname, '..');
const POLICY_FILE = path.join(PWA_ROOT, 'src', 'docs', 'reader', 'policy.ts');

/** The runtime module specifiers one source file names: every import and export declaration but an `import type` or an
 *  `export type` one (an inline `type` on each specifier still leaves an empty import that loads the module), `import x =
 *  require()` and literal dynamic `import()`. */
function runtimeSpecifiers(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (n.importClause?.isTypeOnly !== true) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)
      && ts.isStringLiteral(n.moduleReference.expression) && !n.isTypeOnly) {
      out.push(n.moduleReference.expression.text);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
      && n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0]!)) {
      out.push((n.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The file a relative specifier names, from `from`'s directory: the path itself when it is a file, else with `.ts`, `.tsx`,
 *  `/index.ts` or `/index.tsx`; a `.js` spelling (the shared files' own) also tries its `.ts` and `.tsx` source; `null` when
 *  none exists. `exists` is the walk's file system. */
function resolveRelative(from: string, spec: string, exists: (p: string) => boolean): string | null {
  const base = path.resolve(path.dirname(from), spec);
  const stem = base.endsWith('.js') ? base.slice(0, -3) : null;
  const sources = stem === null ? [] : [`${stem}.ts`, `${stem}.tsx`];
  for (const c of [base, ...sources, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (exists(c)) return c;
  }
  return null;
}

/** What breaks the ring, found by walking from `entry`. Each line names the offending path and the chain that reached it. */
function ringBreaks(entry: string, root: string, fs: { read(p: string): string | null }): string[] {
  const rel = (p: string): string => path.relative(root, p).split(path.sep).join('/');
  const parsed = (p: string): boolean => /\.(?:ts|tsx|mts|js|mjs)$/.test(p);
  const exists = (p: string): boolean => fs.read(p) !== null && /\.[a-z]+$/.test(p);
  const breaks: string[] = [];
  const seen = new Set<string>([entry]);
  const queue: string[][] = [[entry]];
  while (queue.length > 0) {
    const chain = queue.shift()!;
    const file = chain[chain.length - 1]!;
    const via = chain.map(rel).join(' -> ');
    const r = rel(file);
    if (file.endsWith('.tsx')) breaks.push(`${r} is a .tsx (${via})`);
    if (r.startsWith('src/stores/')) breaks.push(`${r} is a store (${via})`);
    if (r === 'src/lib/api.ts') breaks.push(`${r} is lib/api.ts (${via})`);
    const text = fs.read(file);
    if (text === null || !parsed(file)) continue;
    for (const spec of runtimeSpecifiers(file, text)) {
      if (!spec.startsWith('.')) {
        if (spec === 'react' || spec === 'react-dom' || spec.startsWith('react/') || spec.startsWith('react-dom/')) {
          breaks.push(`${r} imports ${spec}, so it is a hook module (${via})`);
        } else if (spec === '@ccrc/ui') {
          breaks.push(`${r} imports ${spec}, the design system, whose one entry loads React components (${via})`);
        }
        continue;
      }
      const next = resolveRelative(file, spec, exists);
      if (next === null) {
        breaks.push(`${r} imports ${spec}, which resolves to no file (${via})`);
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
  return breaks;
}

const diskFs = { read: (p: string): string | null => (existsSync(p) && !p.endsWith('/') ? safeRead(p) : null) };
function safeRead(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

describe('policy.ts stays ring L1: nothing it reaches at run time is a .tsx, a hook module, a store, lib/api.ts or @ccrc/ui', () => {
  it('the real walk finds nothing', () => {
    expect(ringBreaks(POLICY_FILE, PWA_ROOT, diskFs)).toEqual([]);
  });

  it('the walk reaches the shared kernel and the limits files it is meant to cover', () => {
    // A walk that stops at the first hop would pass the test above for the wrong reason.
    const reached: string[] = [];
    const spy = { read: (p: string): string | null => { const t = diskFs.read(p); if (t !== null) reached.push(path.relative(PWA_ROOT, p).split(path.sep).join('/')); return t; } };
    ringBreaks(POLICY_FILE, PWA_ROOT, spy);
    expect(reached).toEqual(expect.arrayContaining([
      'src/docs/reader/policy.ts', 'src/lib/markdownLimits.ts', 'src/lib/readerLimits.ts', '../shared/docs.ts',
    ]));
  });

  // A planted control on a virtual tree (no disk): each shape the walk must find or must skip.
  const root = '/v';
  const at = (p: string): string => `${root}/${p}`;
  const treeOf = (files: Record<string, string>) => ({ read: (p: string): string | null => files[path.relative(root, p)] ?? null });
  const entry = at('src/docs/reader/policy.ts');

  it('a runtime import of a hook module two hops down is found, with the chain', () => {
    const fs = treeOf({
      'src/docs/reader/policy.ts': "import { a } from '../links';\nexport const x = a;",
      'src/docs/links.ts': "import { pin } from './useVisit';\nexport const a = pin;",
      'src/docs/useVisit.ts': "import { useState } from 'react';\nexport const pin = useState;",
    });
    expect(ringBreaks(entry, root, fs)).toEqual([
      'src/docs/useVisit.ts imports react, so it is a hook module (src/docs/reader/policy.ts -> src/docs/links.ts -> src/docs/useVisit.ts)',
    ]);
  });

  it('a re-export, an export star, a dynamic import and an import-equals each count', () => {
    for (const line of [
      "export { b } from '../comp';", "export * from '../comp';", "export const lazy = () => import('../comp');",
      "import comp = require('../comp');",
    ]) {
      const fs = treeOf({ 'src/docs/reader/policy.ts': line, 'src/docs/comp.tsx': 'export const b = 1;' });
      expect(ringBreaks(entry, root, fs), line).toEqual([
        'src/docs/comp.tsx is a .tsx (src/docs/reader/policy.ts -> src/docs/comp.tsx)',
      ]);
    }
  });

  it('a store and lib/api.ts are found; a directory index resolves', () => {
    const fs = treeOf({
      'src/docs/reader/policy.ts': "import { s } from '../../stores';\nimport { f } from '../../lib/api';\nexport const x = [s, f];",
      'src/stores/index.ts': 'export const s = 1;',
      'src/lib/api.ts': 'export const f = 1;',
    });
    expect(ringBreaks(entry, root, fs)).toEqual([
      'src/stores/index.ts is a store (src/docs/reader/policy.ts -> src/stores/index.ts)',
      'src/lib/api.ts is lib/api.ts (src/docs/reader/policy.ts -> src/lib/api.ts)',
    ]);
  });

  it('import type and export type are erased and skipped', () => {
    const fs = treeOf({
      'src/docs/reader/policy.ts': [
        "import type { A } from '../comp';", "export type { B } from '../comp';", "import type React from 'react';",
        "export type { A, B };",
      ].join('\n'),
      'src/docs/comp.tsx': "import { useState } from 'react';\nexport const z = useState;",
    });
    expect(ringBreaks(entry, root, fs)).toEqual([]);
  });

  it('an import or export whose specifiers are each marked type still loads its module (verbatimModuleSyntax keeps the empty import)', () => {
    for (const line of ["import { type C, type D } from '../comp';", "export { type E } from '../comp';"]) {
      const fs = treeOf({
        'src/docs/reader/policy.ts': line,
        'src/docs/comp.tsx': "import { useState } from 'react';\nexport const z = useState;",
      });
      expect(ringBreaks(entry, root, fs), line).toEqual([
        'src/docs/comp.tsx is a .tsx (src/docs/reader/policy.ts -> src/docs/comp.tsx)',
        'src/docs/comp.tsx imports react, so it is a hook module (src/docs/reader/policy.ts -> src/docs/comp.tsx)',
      ]);
    }
  });

  it('a runtime import of @ccrc/ui, the design system consumed as source, is found with the chain; a type import of it is erased', () => {
    const through = (line: string) => treeOf({
      'src/docs/reader/policy.ts': "import { a } from '../links';\nexport const x = a;",
      'src/docs/links.ts': `${line}\nexport const a = 1;`,
    });
    expect(ringBreaks(entry, root, through("import { cn } from '@ccrc/ui';"))).toEqual([
      'src/docs/links.ts imports @ccrc/ui, the design system, whose one entry loads React components (src/docs/reader/policy.ts -> src/docs/links.ts)',
    ]);
    expect(ringBreaks(entry, root, through("import type { SkinId } from '@ccrc/ui';"))).toEqual([]);
  });

  it('a relative specifier that resolves to no file is reported, so the walk cannot go quiet on a typo', () => {
    const fs = treeOf({ 'src/docs/reader/policy.ts': "import { q } from './missing';\nexport const x = q;" });
    expect(ringBreaks(entry, root, fs)).toEqual([
      'src/docs/reader/policy.ts imports ./missing, which resolves to no file (src/docs/reader/policy.ts)',
    ]);
  });
});
