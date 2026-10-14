// The Docs screen's clipboard writer (spec 2026-10-01 4.5's "One clipboard writer"; refinement (t); W5 part 1 Task
// 10). `copyText` is the ONE place under `pwa/src/docs` that writes the clipboard: the truth line's "copy commit" in
// part 1, and part 2's share sheet ("Copy link") beside it, which adds `shareTargetFor` here (`downloadExport` goes
// beside `saveBytes` in `docs/objectUrls.ts`, spec 4.1 and 5.4).

/** Writes `text` to the clipboard. Resolves once it is written; rejects when the clipboard refuses, or when the page
 *  has none (`navigator.clipboard` is absent outside a secure context, whatever the DOM types say). */
export async function copyText(text: string): Promise<void> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined) throw new Error('The clipboard is not available here.');
  await clipboard.writeText(text);
}
