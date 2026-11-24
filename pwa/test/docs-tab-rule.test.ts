// The Docs tab rule (desktop polish wave 174, `lib/docTab.ts`): at a desk a link that crosses between the console and the
// Docs reader opens a new browser tab, and nothing crosses below the desk width. The one definition every caller derives
// from (`useTabLink` for an anchor, `useFollowLink` for a command or a button), pinned here on its own, with what a Docs tab
// is (`isDocsTab`, `keepsDocsOnly`), the title a Docs tab carries and the move `useFollowLink` makes.
//
// Mutation table (each guard, and the case that goes red without it):
//   `!desk` in `opensNewTab` ......................... "below the desk width nothing opens a new tab"
//   `!== docsTab` (crossing, not "is a document") .... "in a Docs tab a document link stays in the tab, a console link opens a new one"
//   the `'/'`/`'//'` refusal in `opensNewTab` ........ "an address that is not an in-app path is never a document link"
//   `pathOf` (search and fragment cut) ............... "a Docs address with a search or a fragment is still a Docs address"
//   `desk ||` in `isDocsTab` ......................... "a Docs page at a desk is a Docs tab whatever the tab showed before"
//   `docsOnly` in `isDocsTab` ........................ "below the desk width a Docs page is a Docs tab only while the tab has shown only Docs"
//   `isDocsHref(path) &&` in `isDocsTab` ............. "a console page is never a Docs tab"
//   `keepsDocsOnly`'s fold (once false, false) ....... "the fold falls at the first page that is not Docs and never rises"
//   `useFollowLink`'s `window.open` arm .............. "at a desk opens one new tab for a document and leaves this tab where it is"
//   `useFollowLink`'s tab kind from the context ...... "in a Docs tab opens the console in a new tab, and moves within the tab to another document"
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { docsTabTitle } from '../src/docs/docsTabTitle';
import { CONSOLE_ROOT, isDocsHref, isDocsTab, keepsDocsOnly, opensNewTab } from '../src/lib/docTab';
import { navigate } from '../src/lib/router';
import { DocsTabContext, useFollowLink } from '../src/lib/useTabLink';

const DOC = '/docs/project-a/specs/2026-11-18-native-docs-parity-design.md';

/** A desk (or not): `(min-width: 900px)` answers `desk`. */
function stubWidth(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('the Docs tab rule (opensNewTab)', () => {
  it('at a desk, from the console, a document link opens a new tab and a console link does not', () => {
    expect(opensNewTab(DOC, true, false)).toBe(true);
    expect(opensNewTab('/docs', true, false)).toBe(true);
    expect(opensNewTab('/docs/project-a?ref=ws/a-branch', true, false)).toBe(true);
    expect(opensNewTab('/s/lane-a-project-a', true, false)).toBe(false);
    expect(opensNewTab('/runs/12', true, false)).toBe(false);
    expect(opensNewTab('/', true, false)).toBe(false);
  });

  it('in a Docs tab a document link stays in the tab, a console link opens a new one', () => {
    expect(opensNewTab(DOC, true, true)).toBe(false);
    expect(opensNewTab('/docs/project-a', true, true)).toBe(false);
    expect(opensNewTab(CONSOLE_ROOT, true, true)).toBe(true);
    expect(opensNewTab('/s/lane-a-project-a', true, true)).toBe(true);
    expect(opensNewTab('/runs/12', true, true)).toBe(true);
  });

  it('below the desk width nothing opens a new tab', () => {
    for (const docsTab of [false, true]) {
      for (const href of [DOC, '/docs', '/s/lane-a-project-a', CONSOLE_ROOT]) {
        expect(opensNewTab(href, false, docsTab), `${href} from ${docsTab ? 'a Docs tab' : 'the console'}`).toBe(false);
      }
    }
  });

  it('an address that is not an in-app path is never a document link', () => {
    for (const href of ['https://example.com/docs/x', '//example.com/docs/x', '#docs', 'docs/superpowers/specs/x.md', '']) {
      expect(isDocsHref(href), href).toBe(false);
      expect(opensNewTab(href, true, false), href).toBe(false);
      // In a Docs tab too: an outside link is not a console page, so the rule leaves it to its own owner.
      expect(opensNewTab(href, true, true), `${href} from a Docs tab`).toBe(false);
    }
  });

  it('a Docs address with a search or a fragment is still a Docs address; /docsearch is not one', () => {
    expect(isDocsHref(`${DOC}?ref=ws/a#in-short`)).toBe(true);
    expect(isDocsHref(`${DOC}#in-short`)).toBe(true);
    expect(isDocsHref('/docs?x=1')).toBe(true);
    expect(isDocsHref('/docsearch')).toBe(false);
  });

  it('a Docs page at a desk is a Docs tab whatever the tab showed before', () => {
    expect(isDocsTab('/docs', true, false)).toBe(true);
    expect(isDocsTab(DOC, true, false)).toBe(true);
    expect(isDocsTab(DOC, true, true)).toBe(true);
  });

  it('below the desk width a Docs page is a Docs tab only while the tab has shown only Docs', () => {
    expect(isDocsTab(DOC, false, true)).toBe(true);
    expect(isDocsTab(DOC, false, false)).toBe(false);
  });

  it('a console page is never a Docs tab', () => {
    for (const desk of [true, false]) {
      for (const docsOnly of [true, false]) expect(isDocsTab('/fleet', desk, docsOnly)).toBe(false);
    }
  });

  it('the fold falls at the first page that is not Docs and never rises', () => {
    const fold = (pages: string[]): boolean => pages.reduce(keepsDocsOnly, true);
    expect(fold([DOC])).toBe(true);
    expect(fold([DOC, '/docs', '/docs/project-a?ref=b'])).toBe(true);
    expect(fold(['/fleet'])).toBe(false);
    expect(fold([DOC, '/', DOC])).toBe(false);
    expect(fold(['/docsearch'])).toBe(false);
  });

  it('the link back opens the console at its root', () => {
    expect(CONSOLE_ROOT).toBe('/');
  });
});

describe('a Docs tab title (docsTabTitle)', () => {
  it('names the document first, then its project', () => {
    expect(docsTabTitle(DOC, '')).toBe('2026-11-18-native-docs-parity-design.md · project-a · Docs · ccrc');
    expect(docsTabTitle('/docs/project-a/plans/2026-11/one.md', '?ref=ws/a')).toBe('one.md · project-a · Docs · ccrc');
  });

  it('names a directory by its own name, a section by its label, a project by its name, and the index as Docs', () => {
    expect(docsTabTitle('/docs/project-a/plans/2026-11/', '')).toBe('2026-11 · project-a · Docs · ccrc');
    expect(docsTabTitle('/docs/project-a/specs', '')).toBe('specs · project-a · Docs · ccrc');
    expect(docsTabTitle('/docs/project-a', '')).toBe('project-a · Docs · ccrc');
    expect(docsTabTitle('/docs', '')).toBe('Docs · ccrc');
  });

  it('two documents of one project read apart, and an address the reader refuses reads Docs', () => {
    expect(docsTabTitle('/docs/project-a/specs/a.md', '')).not.toBe(docsTabTitle('/docs/project-a/specs/b.md', ''));
    expect(docsTabTitle('/docs/project-a/specs/a.md', '?bogus=1')).toBe('Docs · ccrc');
  });
});

/** `useFollowLink` as a component drawn in a Docs tab (or the console) would hold it. */
function follower(docsTab: boolean): (href: string) => void {
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => createElement(DocsTabContext, { value: docsTab }, children);
  return renderHook(() => useFollowLink(), { wrapper }).result.current;
}

describe('useFollowLink, the rule for a control that is not an anchor', () => {
  it('at a desk opens one new tab for a document and leaves this tab where it is', () => {
    stubWidth(true);
    navigate('/fleet');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    follower(false)(DOC);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(DOC, '_blank', 'noopener,noreferrer');
    expect(location.pathname).toBe('/fleet');
  });

  it('below the desk width moves within the app', () => {
    stubWidth(false);
    navigate('/fleet');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    follower(false)(DOC);
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC);
  });

  it('in a Docs tab opens the console in a new tab, and moves within the tab to another document', () => {
    stubWidth(true);
    history.replaceState(null, '', DOC);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const follow = follower(true);
    follow('/fleet');
    expect(open).toHaveBeenCalledWith('/fleet', '_blank', 'noopener,noreferrer');
    expect(location.pathname).toBe(DOC);
    follow('/docs/project-a/specs/other.md');
    expect(open).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/docs/project-a/specs/other.md');
  });

  it('in a narrow Docs tab moves in place, to the console too', () => {
    stubWidth(false);
    history.replaceState(null, '', DOC);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    follower(true)('/fleet');
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/fleet');
  });

  it('at a desk moves within the console for a console page', () => {
    stubWidth(true);
    navigate('/fleet');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    follower(false)('/runs');
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');
  });
});
