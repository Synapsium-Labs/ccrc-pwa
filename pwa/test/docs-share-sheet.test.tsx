// Docs W5 Share, Task 5: the share sheet (spec 2026-10-01 4.16; M4.SH4, M4.SH5, and M4.SH6 as the sheet shows it).
// The sheet renders the `ShareTarget` it is given. `copyText` is a spy here (the module's other exports are the real
// ones); `navigator.share` and `navigator.canShare` are defined per case and removed after each, since jsdom has
// neither. The last describe is the Share chrome's colour guard. Placeholders only: `example-org/example-repo`, `demo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ShareSheet } from '../src/docs/ShareSheet';
import { SHARE_EXPORT_CLAUSE, SHARE_SENTENCE, SHARE_SHEET_TEXT } from '../src/docs/docsText';
import { copyText, type ShareRefusal, type ShareTarget } from '../src/docs/share';
import { COMMIT_A } from './docsFixtures';
import { stripComments } from './cssRule';

vi.mock('../src/docs/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/docs/share')>()),
  copyText: vi.fn(async () => {}),
}));

const SHORT = COMMIT_A.slice(0, 8);
const URL_A = `https://github.com/example-org/example-repo/blob/${COMMIT_A}/docs/superpowers/specs/a.md`;
const ACCESS = "Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.";
const ACCESS_NOTE = [{ note: 'access', fields: { slug: 'example-org/example-repo' } }] as const;
const LINK: Extract<ShareTarget, { ok: true }> = {
  ok: true, url: URL_A, commit: COMMIT_A, title: 'a.md', text: `demo · docs/superpowers/specs/a.md at ${SHORT}`,
  notes: ACCESS_NOTE,
};

/** Gives this page Web Share for one case: `navigator.share`, and `navigator.canShare` when one is passed. */
function webShare(share: (this: unknown, data: unknown) => Promise<void>, canShare?: (data: unknown) => boolean): void {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
  if (canShare !== undefined) Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: canShare });
}

function sheet(target: ShareTarget = LINK, exportOffered = false): void {
  render(<ShareSheet target={target} exportOffered={exportOffered} onClose={() => {}} />);
}

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(undefined);
});

describe('the share sheet: the link, its notes, and Copy link where there is no Web Share (M4.SH5)', () => {
  it('shows the link and the access note, and offers Copy link only', async () => {
    sheet();
    expect(await screen.findByText(URL_A)).toBeInTheDocument();
    expect(screen.getByText(ACCESS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.share })).toBeNull();
    expect(screen.getByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeInTheDocument();
  });

  it.each([
    ['says no', (): boolean => false],
    ['throws', (): boolean => { throw new TypeError('no'); }],
  ])('offers no Share… where navigator.canShare %s', async (_name, canShare) => {
    webShare(() => Promise.resolve(), canShare);
    sheet();
    expect(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.share })).toBeNull();
  });

  it('Copy link writes the link through copyText and says so', async () => {
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy }));
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith(URL_A);
    expect(await screen.findByText(SHARE_SHEET_TEXT.copied)).toBeInTheDocument();
  });

  it('a refused copy leaves a read-only field holding the link, focused and selected', async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error('denied'));
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy }));
    const field = await screen.findByRole('textbox', { name: SHARE_SHEET_TEXT.field });
    if (!(field instanceof HTMLInputElement)) throw new Error('the field is not an input');
    expect(field).toHaveValue(URL_A);
    expect(field).toHaveAttribute('readonly');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, URL_A.length]);
    expect(screen.getByText(SHARE_SHEET_TEXT.copyRefused)).toBeInTheDocument();
  });

  it('a second refused copy focuses and selects the field again, and announces the refusal anew', async () => {
    vi.mocked(copyText).mockRejectedValue(new Error('denied'));
    sheet();
    const copy = await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy });
    fireEvent.click(copy);
    const field = await screen.findByRole('textbox', { name: SHARE_SHEET_TEXT.field });
    if (!(field instanceof HTMLInputElement)) throw new Error('the field is not an input');
    const firstAlert = screen.getByText(SHARE_SHEET_TEXT.copyRefused);
    expect(document.activeElement).toBe(field);
    copy.focus();
    field.setSelectionRange(0, 0);
    expect(document.activeElement).toBe(copy);
    fireEvent.click(copy);
    await settle();
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, URL_A.length]);
    // The repeat refusal is a new alert node, so a screen reader announces it again.
    expect(screen.getByText(SHARE_SHEET_TEXT.copyRefused)).not.toBe(firstAlert);
  });
});

describe('Share…: navigator.share, called in the click itself (M4.SH4, M4.SH5)', () => {
  it('calls navigator.share on navigator, with url, title and text, before any microtask runs', async () => {
    const calls: { receiver: unknown; data: unknown; afterMicrotask: boolean }[] = [];
    let microtaskRan = false;
    webShare(function share(this: unknown, data: unknown) {
      calls.push({ receiver: this, data, afterMicrotask: microtaskRan });
      return Promise.resolve();
    });
    sheet();
    const button = await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share });
    queueMicrotask(() => { microtaskRan = true; });
    fireEvent.click(button);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.receiver).toBe(navigator);
    expect(calls[0]?.data).toEqual({ url: URL_A, title: 'a.md', text: LINK.text });
    expect(calls[0]?.afterMicrotask).toBe(false);
  });

  it('AbortError (the reader closed the native sheet) does nothing', async () => {
    webShare(() => Promise.reject(new DOMException('closed', 'AbortError')));
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share }));
    await settle();
    expect(screen.queryByText(SHARE_SHEET_TEXT.shareFailed)).toBeNull();
  });

  it.each([
    ['a rejection', (): Promise<void> => Promise.reject(new DOMException('denied', 'NotAllowedError'))],
    ['a throw', (): Promise<void> => { throw new TypeError('no'); }],
  ])('any other refusal (%s) shows the notice, and Copy link stays', async (_name, share) => {
    webShare(share);
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share }));
    expect(await screen.findByText(SHARE_SHEET_TEXT.shareFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeInTheDocument();
  });

  it('a double tap: the second call is refused while the first is open, and the first finishing clears the notice', async () => {
    let finish: () => void = () => {};
    const first = new Promise<void>((r) => { finish = r; });
    const share = vi.fn<(data: unknown) => Promise<void>>()
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new DOMException('an earlier share has not completed', 'InvalidStateError'));
    webShare(share);
    sheet();
    const button = await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(share).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(SHARE_SHEET_TEXT.shareFailed)).toBeInTheDocument();
    finish();
    await settle();
    expect(screen.queryByText(SHARE_SHEET_TEXT.shareFailed)).toBeNull();
  });
});

describe('a refusal on the sheet (M4.SH6; refinement (c))', () => {
  it('shows its sentence and the access note, and offers neither Share… nor Copy link', async () => {
    webShare(() => Promise.resolve());
    sheet({ ok: false, why: 'not-on-origin', fields: { short: SHORT }, notes: ACCESS_NOTE });
    expect(await screen.findByText(`Commit ${SHORT} is not on origin; push it to share.`)).toBeInTheDocument();
    expect(screen.getByText(ACCESS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.share })).toBeNull();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeNull();
  });

  it.each(Object.keys(SHARE_SENTENCE) as ShareRefusal[])('%s says nothing of Export while the page offers none', async (why) => {
    sheet({ ok: false, why, fields: { short: SHORT, withheld: 'x' }, notes: [] });
    await screen.findByRole('dialog');
    expect(document.body.textContent).not.toContain('Export');
  });

  it('the seam reaches the sheet: a page that offers Export shows the clause on a refusal that takes it', async () => {
    sheet({ ok: false, why: 'new-draft', fields: {}, notes: [] }, true);
    expect(await screen.findByText(`Not committed yet, so GitHub has nothing to show. ${SHARE_EXPORT_CLAUSE}`)).toBeInTheDocument();
  });
});

// ---- Task 7: the Share chrome paints no colour of its own (M4.S1's Share clause, as refinement (e) reads it) ------

// NOT EXHAUSTIVE. Evasions it does not see: a Share rule nested in an at-rule (`@media (…) { .docs-share { … } }`) is
// read by its at-rule prelude, not by its own selector, and is missed; and a colour set through a property outside the
// regex's list (the list below names the ones this chrome could plausibly use).
describe('the Share chrome paints no colour of its own (M4.S1 Share clause; refinement (e))', () => {
  const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8'));
  const shareRules = css.split('}').map((chunk) => chunk.split('{')).filter(([sel]) => /\.docs-share\b/.test(sel ?? ''));

  it('every rule naming .docs-share sets no ink, ground or border colour, so design/audit.mjs owes it no entry', () => {
    expect(shareRules.map(([sel]) => (sel ?? '').trim()).sort()).toEqual([
      '.docs-share', '.docs-share-field', '.docs-share-note', '.docs-share-sheet', '.docs-share-url', '.docs-share:disabled',
    ]);
    for (const [sel, body] of shareRules) {
      expect(body ?? '', sel)
        .not.toMatch(/(?:^|[;{\s])(?:color|background[a-z-]*|border[a-z-]*|outline[a-z-]*|fill|stroke|text-decoration-color|opacity|filter|box-shadow|accent-color|caret-color)\s*:/);
    }
  });
});
