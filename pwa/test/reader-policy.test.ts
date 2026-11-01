// Docs W8a Task 5: the reader's L1 decisions (`docs/reader/policy.ts`, `readerText.ts`), the enumerable storage port
// in `lib/storage.ts` and `replaceFragment` in `lib/router.ts`. Every page is a placeholder (`demo`, `a/b.md`,
// `example-org/example-repo`); control characters are built with `String.fromCharCode`, never written raw.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOC_SECTION_SLUGS } from '../../shared/docs';
import { DOCS_PARSE_BUDGET_MS } from '../src/lib/markdownLimits';
import { enumerablePageStorage } from '../src/lib/storage';
import { replaceFragment } from '../src/lib/router';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import {
  copyDecision, readerBodyReducer, readerDocKey, readerPrefsOf, readerWatchdogMs, routeReaderLink,
  type ReaderBodyState, type ReaderLink,
} from '../src/docs/reader/policy';
import { THEMES } from '@ccrc/ui';
import { READER_FALLBACK_NOTE, READER_SHEET_TEXT } from '../src/docs/reader/readerText';
import { entry, treeOk } from './docsFixtures';

const SECTION = DOC_SECTION_SLUGS[0]!;

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

/** The page every case routes on: `a/b.md` of `demo`, in the first section, with `a/c.md` in the tree. */
function ctx(): DocLinkContextValue {
  return {
    project: 'demo', pageRef: null, view: 'committed', section: SECTION, path: 'a/b.md',
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
    // The two hosts share their last two labels, so only the exact comparison of refinement (h) calls it foreign.
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

  it('an external link whose URL does not parse, or whose scheme is outside the allowlist, is inert', () => {
    expect(routeReaderLink(ctx(), external('not a url', 'x'), 'b.a.example')).toEqual({ kind: 'inert' });
    // The classifier said https; the URL says otherwise: the URL rules.
    expect(routeReaderLink(ctx(), external('ftp://c.a.example/p', 'c.a.example'), 'b.a.example')).toEqual({ kind: 'inert' });
    expect(routeReaderLink(ctx(), external('javascript:alert(1)', 'c.a.example'), 'b.a.example')).toEqual({ kind: 'inert' });
  });

  it('a link to this same page with a fragment becomes a hash', () => {
    expect(routeReaderLink(ctx(), { kind: 'relative', path: 'b.md', fragment: 'h' }, 'b.a.example')).toEqual({ kind: 'hash', id: 'h' });
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

  it('a fragment link becomes a hash', () => {
    expect(routeReaderLink(ctx(), { kind: 'fragment', id: 'sec' }, 'b.a.example')).toEqual({ kind: 'hash', id: 'sec' });
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

  it('text over 64 KiB goes to the sheet', () => {
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
  it('system and an unknown id map to auto', () => {
    expect(readerPrefsOf('system', THEMES)).toEqual({ theme: 'auto' });
    expect(readerPrefsOf('something-else', THEMES)).toEqual({ theme: 'auto' });
    expect(readerPrefsOf('', THEMES)).toEqual({ theme: 'auto' });
    // `system` follows the device even when a palette list carries that id.
    expect(readerPrefsOf('system', [{ id: 'system', mode: 'dark' }])).toEqual({ theme: 'auto' });
  });

  it.each(THEMES.map((t) => [t.id, t.mode] as const))('the palette %s reads %s', (id, mode) => {
    expect(readerPrefsOf(id, THEMES)).toEqual({ theme: mode });
  });

  it('a palette not in the list the caller hands in is unknown', () => {
    expect(readerPrefsOf('nord', [{ id: 'light', mode: 'light' }])).toEqual({ theme: 'auto' });
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
