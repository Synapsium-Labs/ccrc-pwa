// CommandPalette — the ⌘K overlay: one input, then the options that match it
// (D-5103). Shared by both skins; what the options ARE is the app's registry
// (`pwa/src/command/registry.ts`), and this draws them and moves among them.
//
// vaul's `Drawer`, as `Sheet` uses it, but from the TOP: a palette drops from
// the edge the eye is already at, and a bottom sheet's spring would put the
// input under the thumb and the results above it, the wrong way round on a
// keyboard. `sheet.tsx` is not touched; this is a second consumer of the same
// library, not a variant of the sheet.
//
// FOCUS NEVER LEAVES THE INPUT. It is a `combobox` that owns a `listbox`; ↑ and
// ↓ move `aria-activedescendant`, never focus. Each option is a `role="option"`
// at `tabIndex={-1}` wearing `ListRow`'s shape on a <div>, never `ListRow`
// itself, which renders a tabbable <button>: Tab would walk out of the input
// into twenty buttons. A pointer press prevents its default, so a click runs
// the option without first moving focus off the input.
//
// ESCAPE STOPS HERE (D-5103, D-5456). Radix's dismiss layer (1.1.16, the one
// vaul 1.1.2 mounts) handles Escape in a DOCUMENT CAPTURE listener: it calls
// `onEscapeKeyDown` first, then prevents the default and closes. Preventing
// the default does not stop the event, so without the stop below the same
// keystroke goes on to the target and bubbles to every window listener — the
// session header's interrupt among them, whose own guard (D-5235) is one
// listener's courtesy, not the palette's contract. Stopped in the capture
// phase at the document, the key never reaches the target or the window.
//
// NO STYLESHEET OF ITS OWN, so no colour rule for the contrast gate to census
// and no hook class for the boundary census to own: every ground and ink here
// is a token utility (`bg-sheet`, `bg-phosphor-tint`, `text-ink-*`), the pairs
// the gate already measures for the sheet and the selected row.
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { cn } from '../lib/cn';
import { Icon } from './icon';
import { KEYCAP } from './keycap';
import { LIST_ROW } from './list-row';
import { TextInput } from './text-input';

export interface CommandPaletteOption {
  /** Unique within the list; handed back to `onRun`. */
  id: string;
  title: string;
  /** A short word said after the title: where the command belongs. */
  group?: string;
  /** The key hint, one entry per key pressed in turn: `['g', 'r']`, `[']']`. */
  keys?: readonly string[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Already ranked: the palette draws them in this order. */
  options: readonly CommandPaletteOption[];
  onRun: (id: string) => void;
  /** Backspace in an empty input: a page of options goes back to the list
   *  it was opened from. Absent at the top level, where it does nothing. */
  onBack?: () => void;
  /** The dialog's and the input's accessible name. */
  label?: string;
  placeholder?: string;
  /** Said when no option matches the query. */
  empty?: ReactNode;
}

/** The key-hint spelling of ⌘, drawn as lucide's command icon. */
export const COMMAND_KEY = '⌘';

/** A key, drawn as a key: `KEYCAP`'s shape on a <kbd>, never `Keycap`, which
 *  is a <button> and would put a tab stop inside an option (D-5457). Shrunk from the
 *  tap square to a hint. The palette hides it on a coarse pointer, where
 *  there is no keyboard for the hint to describe; the shortcut sheet does not,
 *  because that sheet is the hint. */
export function KeyHint(
  { keys, hideOnTouch = false }: { keys: readonly string[]; hideOnTouch?: boolean },
): ReactNode {
  return (
    <span className={cn('flex flex-none items-center gap-1', hideOnTouch && 'pointer-coarse:hidden')}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className={cn(KEYCAP, 'min-w-6 min-h-6 px-1.5 border-edge-strong bg-raised text-ink-secondary')}
        >
          {k === COMMAND_KEY
            ? <><Icon name="command" size={16} /><span className="sr-only">Command</span></>
            : k}
        </kbd>
      ))}
    </span>
  );
}

/** THE ACTIVE OPTION: Task 9's selected-row recipe, the accent tint plus a
 *  2px phosphor rail inset on the leading edge (D-5101, D-5457). The option
 *  Enter runs is the keyboard user's focus, which never leaves the input, so
 *  it needs an indicator that reaches 3:1: `bg-hover` alone measured 1.07 to
 *  1.16:1 on the sheet. The rail is the accent, which the gate holds at 3:1
 *  and above on every ground; the tint keeps the inks the gate measures on
 *  `--accent-tint`. Forced colours drop both the fill and the inset shadow,
 *  so an inset outline carries it there, as `.sess-line--active` does. */
export const PALETTE_ACTIVE =
  'bg-phosphor-tint shadow-[inset_2px_0_0_var(--accent)]'
  + ' forced-colors:outline-2 forced-colors:outline-[CanvasText] forced-colors:-outline-offset-2';

/** The palette's entrance and exit, on vaul's keyframes (D-5457): the
 *  content's slide and the overlay's fade both run at the tokens' pace.
 *  `command-layer.test.tsx` reads it off the open palette. */
export const PALETTE_MOTION =
  'data-[state=open]:[animation-duration:var(--dur-base)]!'
  + ' data-[state=open]:[animation-timing-function:var(--curve-swift)]!'
  + ' data-[state=closed]:[animation-duration:var(--dur-fast)]!'
  + ' data-[state=closed]:[animation-timing-function:var(--curve-swift)]!';

export function CommandPalette({
  open,
  onClose,
  query,
  onQueryChange,
  options,
  onRun,
  onBack,
  label = 'Command palette',
  placeholder = 'Type a command',
  empty = 'No command matches.',
}: CommandPaletteProps): ReactNode {
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (i: number): string => `${base}-opt-${i}`;
  const [active, setActive] = useState(0);
  // A new query or a new page is a new list: the first match is the one Enter
  // runs. `options` is compared by identity, so a caller memoises it.
  useEffect(() => { setActive(0); }, [query, options]);
  const at = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  useEffect(() => {
    if (!open || at < 0) return;
    // jsdom has no scrollIntoView; a browser keeps the active row in view.
    document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' });
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((Math.max(at, 0) + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[at];
      if (o !== undefined) onRun(o.id);
    } else if (e.key === 'Backspace' && query === '' && onBack !== undefined) {
      e.preventDefault();
      onBack();
    }
  };

  return (
    <Drawer.Root
      open={open}
      direction="top"
      // vaul holds Radix's open auto-focus back by default (a sheet should not
      // raise a phone's keyboard by itself). A palette is its input, so it
      // takes focus on open and the keyboard comes with it (D-5457).
      autoFocus
      // vaul's input repositioning is for a sheet whose input sits above the
      // keyboard; this one is at the top edge, which the keyboard never covers.
      repositionInputs={false}
      onOpenChange={(next) => { if (!next) onClose(); }}
    >
      <Drawer.Portal>
        {/* The toast layer (D-5457): above a sheet (40) and the terminal drawer (50), so
            the palette opens over either without closing it, and below the
            block screen (100), which nothing outranks. */}
        <Drawer.Overlay className={cn('fixed inset-0 z-toast bg-scrim', PALETTE_MOTION)} onClick={onClose} />
        <Drawer.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { e.stopPropagation(); }}
          className={cn(
            'fixed inset-x-0 top-0 z-toast mx-auto flex w-full flex-col outline-none',
            'max-h-[calc(100dvh-var(--sp-12))] rounded-b-xl bg-sheet shadow-sheet',
            'px-4 pb-3 pt-[calc(var(--sp-3)+var(--safe-top))]',
            // A phone's palette is the full width; from 900 it is a 640px
            // column centred under the top edge.
            'min-[900px]:max-w-[640px]',
            // THE MOTION IS vaul's KEYFRAME, so it is the keyframe that is
            // retimed (D-5457). vaul 1.1.2 opens and closes a drawer with a
            // CSS animation (`slideFromTop` / `slideToTop`, 500ms on its own
            // curve), not a transition, so a `duration-*` utility, which sets
            // only `transition-duration`, moves nothing. A palette is summoned
            // by a keystroke and read at once: it lands at `--dur-base` on the
            // swift curve and leaves at `--dur-fast`. Both are tokens, so
            // Instrument's 120ms (skins.css) and the reduced-motion 1ms
            // (tokens.css) reach it. Important because vaul's rule carries an
            // attribute selector of higher specificity than one utility.
            PALETTE_MOTION,
          )}
        >
          <Drawer.Title className="sr-only">{label}</Drawer.Title>
          <div className="relative flex-none">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-tertiary">
              <Icon name="search" size={16} />
            </span>
            <TextInput
              role="combobox"
              aria-label={label}
              aria-expanded={options.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={at >= 0 ? optionId(at) : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={placeholder}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="pl-10"
            />
          </div>
          <div
            role="listbox"
            id={listId}
            aria-label={label}
            className="mt-2 min-h-0 overflow-y-auto overscroll-contain"
          >
            {options.map((o, i) => (
              <div
                key={o.id}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === at}
                onMouseDown={(e) => { e.preventDefault(); }}
                onMouseMove={() => { if (i !== at) setActive(i); }}
                onClick={() => onRun(o.id)}
                className={cn(LIST_ROW, 'px-2', i === at && PALETTE_ACTIVE)}
              >
                <span className="min-w-0 flex-1 truncate font-ui text-base text-ink-primary">{o.title}</span>
                {o.group !== undefined
                  ? <span className="flex-none font-mono text-xs text-ink-tertiary">{o.group}</span>
                  : null}
                {o.keys !== undefined && o.keys.length > 0 ? <KeyHint keys={o.keys} hideOnTouch /> : null}
              </div>
            ))}
          </div>
          {options.length === 0
            ? <p className="px-1 py-6 text-center font-ui text-sm text-ink-secondary">{empty}</p>
            : null}
          <p className="mt-2 hidden flex-none items-center gap-4 font-mono text-xs text-ink-tertiary pointer-fine:flex">
            <span>↑ ↓ to move</span>
            <span className="flex items-center gap-1"><Icon name="corner-down-left" size={16} /> to run</span>
            <span>esc to close</span>
          </p>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
