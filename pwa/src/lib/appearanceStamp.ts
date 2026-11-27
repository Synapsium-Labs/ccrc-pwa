// The one stamp of the appearance the document root carries (native Docs reader, appearance continuity, Task 3).
//
// L1, and it imports nothing: a pure read of two attributes. `lib/appearance.ts` (the hook, L4) and the reader's
// `readHostAppearance` (L3) both import THIS function, so the stamp has one writer and both edges point inward.
// The stamp is the root's own two stamps, never the stored choices: a "Follow the system" palette flips the root
// while the stored choice stays `system`, and the frame must follow the root.

/** `<data-skin>|<data-theme>` of `root`, an absent attribute reading as `''`. */
export function appearanceStamp(root: HTMLElement): string {
  return `${root.getAttribute('data-skin') ?? ''}|${root.getAttribute('data-theme') ?? ''}`;
}
