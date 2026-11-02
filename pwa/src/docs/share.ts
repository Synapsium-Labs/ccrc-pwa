// Share (spec 2026-10-01 4.5, 4.16; native Docs reader W5, Share) and the Docs screen's one clipboard writer.
//
// `copyText` is the ONE place under `pwa/src/docs` that writes the clipboard (spec 4.5's "One clipboard writer";
// M4.SH7): the truth line's "copy commit", the share sheet's Copy link and the reader frame's copy op all call it.
//
// `shareTargetFor` is what Share sends: a GitHub permalink at the commit the page opened (L0 `githubPermalink`), its
// title and text, and the notes the sheet shows, or the closed word for why there is no link. It reads the tree
// answer, the page and what the leaf opened, never a document's bytes, so no h1, `<title>` or body text reaches a
// link (M4.SH1); every draft word it carries is `entryView`'s, through `ENTRY_BADGE_TEXT` and `WITHHELD_SENTENCE`
// (M4.T7); and a worktree is named only by its closed label. Its sentences are docsText.ts's; the sheet is
// ShareSheet.tsx. It makes no request and keeps no state. (`downloadExport` goes beside `saveBytes` in
// `docs/objectUrls.ts`, spec 4.1 and 5.4.)

/** Writes `text` to the clipboard. Resolves once it is written; rejects when the clipboard refuses, or when the page
 *  has none (`navigator.clipboard` is absent outside a secure context, whatever the DOM types say). */
export async function copyText(text: string): Promise<void> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined) throw new Error('The clipboard is not available here.');
  await clipboard.writeText(text);
}

/** Why Share sends no link (spec 4.16 "Refusal words"). Each `GithubPermalink` refusal keeps its own word except
 *  `uncommitted`, which splits by what the leaf opens: `new-draft`, a readable new draft; `new-withheld`, a new file
 *  Docs did not read. They need different sentences, so they are different words. */
export type ShareRefusal =
  | 'no-github-origin' | 'bad-slug' | 'bad-target' | 'not-on-origin' | 'unmeasured' | 'new-draft' | 'new-withheld';

/** The sheet's notes (spec 4.16 "Note words"), one word per note. */
export type ShareNote =
  | 'access' | 'html-source' | 'onRef-not-contained' | 'onRef-unmeasured' | 'drafts-excluded' | 'view-committed'
  | 'admitted-committed' | 'dir-drafts';

/** The values a Share sentence names (`fillSentence`'s fields). */
export type ShareFields = Readonly<Record<string, string | number>>;

/** One note on the sheet: its word, and the values its sentence names. */
export interface ShareNoteLine {
  readonly note: ShareNote;
  readonly fields: ShareFields;
}
