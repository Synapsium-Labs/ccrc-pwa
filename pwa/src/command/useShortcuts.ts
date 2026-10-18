// The global keys (D-5103). ⌘K or Ctrl+K opens the palette from anywhere; the
// single keys and the `g` chords are the registry's own `keys`, so every key
// bound here is a key the shortcut sheet lists, and the other way round.
//
// A SINGLE KEY IS FOR THE PAGE, NEVER FOR A FIELD. `[`, `]`, `?` and the chords
// fire only when no modifier is held and the target is not a text field: a `]`
// typed into the composer is a `]`. A MODIFIER IS CTRL, ALT OR META — never
// Shift, because `?` is Shift+/ on the common layouts, and a Shift that counted
// would make `?` unreachable. Keys match on `e.key` (what the layout types),
// never `e.code` (where the key sits), so a non-QWERTY layout gets its own `?`.
//
// AN EMPTY COMPOSER IS THE ONE FIELD THAT PASSES KEYS ON (D-5457). On a fine
// pointer the composer takes focus every time a session opens, so on a desk
// focus is almost always there, and `]` would step once and then type. While
// the box marked `data-page-keys` is EMPTY, `[`, `]` and `?` go to the page:
// no message starts with a bare bracket or question mark often enough to
// matter, and a box holding text keeps every key. The `g` chords never pass:
// "gr" starts a word. ⌘K reaches every Go to from anywhere.
//
// A WINDOW BUBBLE LISTENER, ON PURPOSE. A surface that owns its keys stops them
// before they get here: the terminal (xterm stops what it handles, so Ctrl+K
// stays the shell's kill-line there), the ask sheet's keys (`useAskKeys`), and
// the palette's own Escape. Listening any earlier would take keys from them.
//
// EVERYTHING IS OFF while auth is lost or the build is blocked: the login and
// block screens cover the app, and a key that navigated behind them would move
// a page nobody can see.
import { useEffect, useRef } from 'react';
import type { Command, CommandContext } from './registry';

/** How long the `g` of a chord waits for its second key. */
export const CHORD_MS = 1500;

/** Ctrl, Alt or Meta. Never Shift (`?` is Shift+/). */
export function modified(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

/** A target that takes typed text: a single key there is text, not a command. */
export function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
}

/** The single keys an empty composer passes to the page (D-5457). */
export const PASS_KEYS: readonly string[] = ['[', ']', '?'];

/** A field that takes the key as text. The composer, while empty, gives up
 *  `PASS_KEYS` (D-5457); every other field keeps every key. */
export function keepsKey(target: EventTarget | null, key: string): boolean {
  if (!inTextField(target)) return false;
  const el = target as HTMLTextAreaElement;
  return !(el.hasAttribute('data-page-keys') && el.value === '' && PASS_KEYS.includes(key));
}

/** An open sheet or dialog: a single key would act on the page beneath it
 *  (D-5457). ⌘K is not held back by one: the palette opens over a sheet. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

export interface ShortcutOptions {
  /** False while auth is lost or the build is blocked: nothing fires. */
  enabled: boolean;
  commands: readonly Command[];
  /** Read at the moment a key fires, so a command never sees a stale path. */
  context: () => CommandContext;
  onPalette: () => void;
}

export function useShortcuts({ enabled, commands, context, onPalette }: ShortcutOptions): void {
  // The latest callbacks, so the listener is bound once per `enabled` flip
  // rather than on every render of the layer.
  const live = useRef({ commands, context, onPalette });
  live.current = { commands, context, onPalette };

  useEffect(() => {
    if (!enabled) return;
    let chordAt: number | null = null;
    const onKey = (e: KeyboardEvent): void => {
      const { commands: list, context: ctx, onPalette: palette } = live.current;
      // ⌘K / Ctrl+K: from anywhere, a text field included. Alt+K is not it.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        chordAt = null;
        palette();
        return;
      }
      if (e.defaultPrevented || e.isComposing || modified(e) || keepsKey(e.target, e.key) || dialogOpen()) {
        chordAt = null;
        return;
      }
      if (e.repeat) return;
      const fire = (c: Command): void => {
        e.preventDefault();
        c.run(ctx());
      };
      if (chordAt !== null && Date.now() - chordAt <= CHORD_MS) {
        chordAt = null;
        const second = list.find((c) => c.keys?.length === 2 && c.keys[0] === 'g' && c.keys[1] === e.key);
        if (second !== undefined) fire(second);
        return;
      }
      chordAt = null;
      if (e.key === 'g' && list.some((c) => c.keys?.length === 2 && c.keys[0] === 'g')) {
        chordAt = Date.now();
        return;
      }
      const single = list.find((c) => c.keys?.length === 1 && c.keys[0] === e.key);
      if (single !== undefined) fire(single);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
