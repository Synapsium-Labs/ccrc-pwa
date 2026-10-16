// THE SKIN'S APP HALF: storage -> document, at boot and on a choice (D-5093).
//
// `skin-catalogue.test.ts` covers @ccrc/ui's pure half. This covers what the
// app owns: the stored choice and its fallbacks when storage throws, the
// `useSkin()` subscription W2's shells will branch on, and the pre-paint
// snippet in `index.html`, which runs before the bundle exists and so cannot
// import a single constant. That snippet is a second copy by necessity, so it
// is BOUND here: it is run for real, against the same stored values `initSkin`
// sees, and the two must stamp the same thing — except for garbage, where the
// snippet stamps verbatim (it never re-lists the catalogue) and the frame
// renders `:root`, which is Refined, until `initSkin` corrects the attribute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { INSTRUMENT, REFINED, SKINS, SKIN_STORAGE_KEY } from '@ccrc/ui';
import { initSkin, setSkin, useSkin } from '../src/lib/skin';

const INDEX = path.join(import.meta.dirname, '..', 'index.html');
const SKINS_CSS = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'skins.css');

const stamped = (): string | null => document.documentElement.getAttribute('data-skin');

/** The one inline pre-paint script that stamps `data-skin`. Exactly one: a
 *  second would be a second copy of the rule, and none is a page whose first
 *  frame cannot know the stored skin. */
function skinSnippet(): string {
  const html = readFileSync(INDEX, 'utf8');
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1] as string);
  const hits = inline.filter((s) => /data-skin/.test(s));
  expect(hits, 'index.html carries no pre-paint skin stamp').toHaveLength(1);
  return hits[0] as string;
}

/** What the snippet stamps, run as the browser runs it: against a storage
 *  stub and a fresh <html>. `null` from `getItem` is a missing value. */
function runSnippet(getItem: (key: string) => string | null): string | null {
  const el = document.createElement('html');
  new Function('localStorage', 'document', skinSnippet())({ getItem }, { documentElement: el });
  return el.getAttribute('data-skin');
}

/** The ids skins.css answers — a stamped value outside this set renders `:root`. */
const answered = (): string[] =>
  [...readFileSync(SKINS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/\[data-skin='([^']+)'\]/g)].map((m) => m[1] as string);

const throwingStorage = {
  getItem(): never { throw new Error('denied'); },
  setItem(): never { throw new Error('denied'); },
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  initSkin();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  initSkin();
});

describe('the skin at boot', () => {
  it('initSkin stamps the stored choice', () => {
    localStorage.setItem(SKIN_STORAGE_KEY, INSTRUMENT);
    initSkin();
    expect(stamped()).toBe(INSTRUMENT);
    localStorage.setItem(SKIN_STORAGE_KEY, REFINED);
    initSkin();
    expect(stamped()).toBe(REFINED);
  });

  it('with nothing stored, refined is stamped — never left absent', () => {
    localStorage.removeItem(SKIN_STORAGE_KEY);
    document.documentElement.removeAttribute('data-skin');
    initSkin();
    expect(stamped()).toBe(REFINED);
  });

  it('storage that throws leaves refined stamped, and nothing throws', () => {
    // Private windows, previews and thumbnail capture throw on storage, and
    // this runs before first render: an exception here is a blank app.
    document.documentElement.setAttribute('data-skin', INSTRUMENT);
    vi.stubGlobal('localStorage', throwingStorage);
    expect(() => initSkin()).not.toThrow();
    expect(stamped()).toBe(REFINED);
    // A choice still applies for the session; it just will not survive a reload.
    expect(() => setSkin(INSTRUMENT)).not.toThrow();
    expect(stamped()).toBe(INSTRUMENT);
  });
});

describe('main.tsx', () => {
  /** Boot the real `main.tsx` once, from a fresh module registry, with the
   *  page as the pre-paint snippet left it. The mount is a stub that records
   *  the stamp at the moment React would first render; the app itself and the
   *  service worker are not this test's business (`main-bootstrap` has them). */
  async function boot(stored: string | null, prestamped: string | null): Promise<string | null | undefined> {
    let atRender: string | null | undefined;
    vi.resetModules();
    vi.doMock('virtual:pwa-register', () => ({ registerSW: () => {} }));
    vi.doMock('react-dom/client', () => ({
      createRoot: () => ({ render: () => { atRender = stamped(); }, unmount: () => {} }),
    }));
    vi.doMock('../src/app', () => ({ App: () => null }));
    try {
      document.body.innerHTML = '<div id="root"></div>';
      localStorage.clear();
      if (stored !== null) localStorage.setItem(SKIN_STORAGE_KEY, stored);
      if (prestamped === null) document.documentElement.removeAttribute('data-skin');
      else document.documentElement.setAttribute('data-skin', prestamped);
      await import('../src/main');
      return atRender;
    } finally {
      vi.doUnmock('virtual:pwa-register');
      vi.doUnmock('react-dom/client');
      vi.doUnmock('../src/app');
      vi.resetModules();
      document.body.innerHTML = '';
    }
  }

  it('resolves the stored skin before the app first renders', async () => {
    // WIRED, not just written: `initSkin` is correct in isolation (above), and
    // nothing in that proves `main.tsx` calls it. Without the call, the
    // snippet's verbatim stamp of an unknown value stays on the page — `:root`
    // renders, while `useSkin()` answers Refined from its own state — and a
    // page whose snippet never ran (blocked inline script) boots unstamped.
    // Recorded AT the render, so a call moved after `render(...)` reds too.
    const stale = 'skin-from-a-newer-build';
    expect(await boot(stale, stale), 'an unknown stored value is corrected before render').toBe(REFINED);
    expect(await boot(INSTRUMENT, null), 'the stored choice is stamped before render').toBe(INSTRUMENT);
    expect(await boot(null, null), 'nothing stored is stamped refined, never left absent').toBe(REFINED);
  });
});

describe('a choice', () => {
  function Probe(): ReactNode {
    return <span data-testid="skin">{useSkin()}</span>;
  }

  it('setSkin re-renders a useSkin consumer with the new id', () => {
    render(<Probe />);
    expect(screen.getByTestId('skin').textContent).toBe(REFINED);
    act(() => setSkin(INSTRUMENT));
    expect(screen.getByTestId('skin').textContent).toBe(INSTRUMENT);
    expect(stamped()).toBe(INSTRUMENT);
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(INSTRUMENT);
    act(() => setSkin(REFINED));
    expect(screen.getByTestId('skin').textContent).toBe(REFINED);
    expect(stamped()).toBe(REFINED);
  });

  it('an unknown id resolves to refined rather than stamping an attribute no block answers', () => {
    act(() => setSkin('soft-glass'));
    expect(stamped()).toBe(REFINED);
  });
});

describe("index.html's pre-paint stamp", () => {
  it('the index.html pre-paint snippet renders what initSkin renders', () => {
    const cases: [string, (key: string) => string | null][] = [
      [INSTRUMENT, (k) => (k === SKIN_STORAGE_KEY ? INSTRUMENT : null)],
      [REFINED, (k) => (k === SKIN_STORAGE_KEY ? REFINED : null)],
      ['missing', () => null],
      ['empty', (k) => (k === SKIN_STORAGE_KEY ? '' : null)],
    ];
    for (const [name, getItem] of cases) {
      const fromSnippet = runSnippet(getItem);
      localStorage.clear();
      const v = getItem(SKIN_STORAGE_KEY);
      if (v !== null) localStorage.setItem(SKIN_STORAGE_KEY, v);
      initSkin();
      expect(fromSnippet, name).toBe(stamped());
    }

    // Throwing storage: both stamp refined, and the snippet does not throw.
    let fromSnippet: string | null = null;
    expect(() => { fromSnippet = runSnippet(() => { throw new Error('denied'); }); }).not.toThrow();
    vi.stubGlobal('localStorage', throwingStorage);
    initSkin();
    expect(fromSnippet).toBe(REFINED);
    expect(stamped()).toBe(REFINED);
    vi.unstubAllGlobals();

    // Garbage: the snippet stamps it VERBATIM (it never re-lists the
    // catalogue), no block in skins.css answers it, so the first frame is
    // `:root` — Refined — and initSkin then corrects the attribute.
    const garbage = 'skin-from-a-newer-build';
    expect(runSnippet((k) => (k === SKIN_STORAGE_KEY ? garbage : null))).toBe(garbage);
    expect(answered()).not.toContain(garbage);
    localStorage.setItem(SKIN_STORAGE_KEY, garbage);
    initSkin();
    expect(stamped()).toBe(REFINED);
  });

  it('the snippet names SKIN_STORAGE_KEY and REFINED, and no other skin id', () => {
    // The bound literals. The snippet cannot import the catalogue, so the key
    // and the default are a second copy by necessity, and are checked here;
    // any OTHER id would be the start of a re-listed catalogue, which
    // single-definition forbids and which this file refuses first.
    const code = skinSnippet().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const literals = [...code.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((m) => m[1] ?? m[2]);
    expect(literals).toContain(SKIN_STORAGE_KEY);
    expect(literals).toContain(REFINED);
    const others = new Set<string>(SKINS.map((s) => s.id).filter((id) => id !== REFINED));
    expect(literals.filter((l) => l !== undefined && others.has(l))).toEqual([]);
  });
});
