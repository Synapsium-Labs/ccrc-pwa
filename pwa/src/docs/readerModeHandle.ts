// The one outside door to reader mode (native Docs reader, reader-mode plan Task XR1.2, spec 2026-11-20 section 3.2): the Docs
// screen sets it while it is mounted, and whoever acts from outside the screen (the `r` key in the command layer, the palette
// row) reads it at the moment of the act. Ring L4 delivery: a module-scope slot and no decision. `offered()` is the full test at
// call time (a ready frame, outside the plain view, no modal layer mounted, as `readerModeOffered` answers it), `on()` is the
// state now, and `toggle()` enters by `key` when reader mode is off and exits by `key` when it is on. Empty on every other
// screen: `readerModeHandle()` answers `null` there.

/** What the Docs screen offers the outside. */
export interface ReaderModeHandle {
  offered(): boolean;
  on(): boolean;
  toggle(): void;
}

let current: ReaderModeHandle | null = null;

/** Set by `DocsScreen` while mounted, and cleared by it on unmount, only if the slot is still its own. */
export function setReaderModeHandle(h: ReaderModeHandle | null): void {
  current = h;
}

/** The mounted Docs screen's handle, or `null` on any other screen. */
export function readerModeHandle(): ReaderModeHandle | null {
  return current;
}
