// The outside door to the Layout row's rule (X2 P5.1, D-9180), beside `readerModeHandle.ts` and of the same shape: the Docs screen's
// reader-mode hook (`useReaderMode.ts`, which the screen calls) sets it while it is mounted, and the command palette's Layout commands
// read it at the moment they are listed and again when one runs. `layoutRowDrawn()` is `readerLayoutRowDrawn`'s answer now (a ready
// reader frame for a Markdown leaf, outside the plain view, reader mode not on), so the palette offers a Layout command exactly where
// Page details draws the Layout row. Ring L4 delivery: a module-scope slot and no decision. Empty on every other screen:
// `readerLayoutHandle()` answers `null` there.

/** What the Docs screen's hook offers the palette. */
export interface ReaderLayoutHandle {
  layoutRowDrawn(): boolean;
}

let current: ReaderLayoutHandle | null = null;

/** Set by `useReaderMode` while the Docs screen is mounted, and cleared by it on unmount, only if the slot is still its own. */
export function setReaderLayoutHandle(h: ReaderLayoutHandle | null): void {
  current = h;
}

/** The mounted Docs screen's handle, or `null` on any other screen. */
export function readerLayoutHandle(): ReaderLayoutHandle | null {
  return current;
}
