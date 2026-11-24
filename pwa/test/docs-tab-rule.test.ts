// The Docs tab rule (desktop polish wave 174, `lib/docTab.ts`): at a desk a link that crosses between the console and the
// Docs reader opens a new browser tab, and nothing crosses below the desk width. The one definition every caller derives
// from (`useTabLink` for an anchor, `followLink` for a command or a button), pinned here on its own, with the title a Docs
// tab carries and the move `followLink` makes.
//
// Mutation table (each guard, and the case that goes red without it):
//   `!desk` in `opensNewTab` ......................... "below the desk width nothing opens a new tab"
//   `!== docsTab` (crossing, not "is a document") .... "in a Docs tab a document link stays in the tab, a console link opens a new one"
//   the `'/'`/`'//'` refusal in `opensNewTab` ........ "an address that is not an in-app path is never a document link"
//   `pathOf` (search and fragment cut) ............... "a Docs address with a search or a fragment is still a Docs address"
//   `followLink`'s `window.open` arm ................. "followLink at a desk opens one new tab for a document and leaves this tab where it is"
//   `followLink`'s tab kind from its own path ........ "followLink in a Docs tab opens the console in a new tab, and moves within the tab to another document"
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_PATH, docsTabTitle, isDocsHref, isDocsTab, opensNewTab } from '../src/lib/docTab';
import { followLink, navigate } from '../src/lib/router';

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
    expect(opensNewTab(CONSOLE_PATH, true, true)).toBe(true);
    expect(opensNewTab('/s/lane-a-project-a', true, true)).toBe(true);
    expect(opensNewTab('/runs/12', true, true)).toBe(true);
  });

  it('below the desk width nothing opens a new tab', () => {
    for (const docsTab of [false, true]) {
      for (const href of [DOC, '/docs', '/s/lane-a-project-a', CONSOLE_PATH]) {
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

  it('a tab is a Docs tab exactly when it shows a Docs route at a desk', () => {
    expect(isDocsTab('/docs', true)).toBe(true);
    expect(isDocsTab(DOC, true)).toBe(true);
    expect(isDocsTab(DOC, false)).toBe(false);
    expect(isDocsTab('/fleet', true)).toBe(false);
  });

  it('the link back opens the console at its root', () => {
    expect(CONSOLE_PATH).toBe('/');
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

describe('followLink, the rule for a control that is not an anchor', () => {
  it('followLink at a desk opens one new tab for a document and leaves this tab where it is', () => {
    stubWidth(true);
    navigate('/fleet');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    followLink(DOC);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(DOC, '_blank', 'noopener');
    expect(location.pathname).toBe('/fleet');
  });

  it('followLink below the desk width moves within the app', () => {
    stubWidth(false);
    navigate('/fleet');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    followLink(DOC);
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC);
  });

  it('followLink in a Docs tab opens the console in a new tab, and moves within the tab to another document', () => {
    stubWidth(true);
    history.replaceState(null, '', DOC);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    followLink('/fleet');
    expect(open).toHaveBeenCalledWith('/fleet', '_blank', 'noopener');
    expect(location.pathname).toBe(DOC);
    followLink('/docs/project-a/specs/other.md');
    expect(open).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/docs/project-a/specs/other.md');
  });

  it('followLink at a desk moves within the console for a console page', () => {
    stubWidth(true);
    navigate('/fleet');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    followLink('/runs');
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');
  });
});
