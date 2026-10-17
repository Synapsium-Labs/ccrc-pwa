// The ask sheets' keyboard, bound to the DOM (decision `ask-sheet-keyboard-model`; the model is `askKeys.ts`, pure).
//
// - A ROVING TABINDEX over the sheet's real rows: the highlighted row is the one tab stop of the group (tabIndex 0,
//   the rest -1), ↑/↓ move DOM focus between them, and the row keeps being the real `OptionRow` button a click or a
//   screen reader activates. (The planned ⌘K palette uses `aria-activedescendant` because its focus must stay in a text
//   input; these rows have none to hold it.) The ❯ cursor and the ↵ mark follow the highlight; the rows draw them.
// - ONE listener for the sheet, on the document, acting only on keys whose target is inside the sheet's dialog, or on
//   the page itself with nothing focused (a hardware keyboard on a phone, where the sheet never took focus). A key in
//   any text field outside the sheet (the composer, the terminal) is never read. Every key it handles is stopped there
//   (`stopPropagation`), so the header's Escape binding, the composer and any page shortcut never see it.
// - FOCUS moves into the sheet on open and on each new screen only under a fine pointer, or once a key has been
//   handled inside the sheet: a phone is never pulled out of its composer by a sheet that slid up.
// - A held-down digit or arrow across tabs is no key at all (`askKeyAction` reads `repeat`), and a send the sheet
//   already has in flight refuses another at the ONE gate every send passes, its `claim` (a box's toggle reads the
//   same `sending`), so this hook keeps no second gate of its own.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { askKeyAction, type KeyScreen } from './askKeys';

export interface AskKeysOptions {
  /** The screen's identity (the pane dialog's id, or the envelope's question); a new one resets the highlight. */
  readonly screenId: string | null;
  /** What the keys work over; null switches them off. */
  readonly screen: KeyScreen | null;
  /** The row the highlight starts on: the pane's own cursor row, when the sheet shows it. */
  readonly start: string | null;
  /** Is the sheet open? A hidden sheet handles nothing. */
  readonly open: boolean;
  readonly onAnswer: (index: number) => void;
  readonly onToggle?: (index: number) => void;
  readonly onTab?: (to: 'prev' | 'next') => void;
}

export interface AskKeys {
  /** The highlighted row's key (`KeyRow.key`). */
  readonly hl: string | null;
  /** Put on an element inside the sheet; its dialog is where keys are read. */
  readonly root: RefObject<HTMLDivElement | null>;
  /** A row's focus wiring: its element, and its place in the roving tab order. */
  readonly bind: (key: string) => { ref: (el: HTMLElement | null) => void; tabIndex: number };
}

/** Is `el` a field the operator types into? Keys there are text, unless it is the sheet's own-words field. */
function typingInto(el: Element): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT');
}

/** How long after a screen renders its row takes focus: about a frame, so the sheet's portal and rows are mounted. */
const FOCUS_DELAY_MS = 16;

const finePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: fine)').matches;

export function useAskKeys(opts: AskKeysOptions): AskKeys {
  const { screenId, screen, start, open } = opts;
  const [mark, setMark] = useState<{ id: string | null; hl: string | null }>({ id: screenId, hl: start });
  if (mark.id !== screenId) setMark({ id: screenId, hl: start });
  const rows = screen?.rows ?? [];
  const wanted = mark.id === screenId ? mark.hl : start;
  // A highlight on a row the screen no longer has falls back to the start, then to the first row.
  const hl = rows.some((r) => r.key === wanted) ? wanted
    : rows.some((r) => r.key === start) ? start : (rows[0]?.key ?? null);

  const root = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const engaged = useRef(false);
  const latest = useRef({ opts, hl });
  useLayoutEffect(() => {
    latest.current = { opts, hl };
  });

  const focusRow = (key: string): void => {
    setMark({ id: latest.current.opts.screenId, hl: key });
    els.current.get(key)?.focus();
  };

  // A new screen (or the sheet opening) puts focus on its highlighted row, under a fine pointer or once the keyboard
  // has been used in the sheet. About a frame on (`FOCUS_DELAY_MS`), so the rows the screen renders are mounted.
  useEffect(() => {
    if (!open || screen === null || hl === null) return undefined;
    if (!finePointer() && !engaged.current) return undefined;
    const key = hl;
    const t = setTimeout(() => els.current.get(key)?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, screenId, screen === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { opts: o, hl: at } = latest.current;
      if (e.defaultPrevented || !o.open || o.screen === null) return;
      const dialog = root.current?.closest('[role="dialog"]') ?? null;
      const target = e.target instanceof Element ? e.target : null;
      const onPage = target === null || target === document.body || target === document.documentElement;
      if (!onPage && (dialog === null || !dialog.contains(target))) return;
      const wordsEl = els.current.get('words');
      const inWords = target !== null && wordsEl !== undefined && target === wordsEl;
      if (!inWords && target !== null && typingInto(target)) return;
      // Where the highlight is, as the keyboard sees it: the focused row, else nothing focused in the sheet yet.
      let focused: string | null = null;
      for (const [k, el] of els.current) if (target !== null && (el === target || el.contains(target))) focused = k;
      const action = askKeyAction(o.screen, focused, at, {
        key: e.key, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, repeat: e.repeat, inWords,
      });
      if (action.type === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      engaged.current = true;
      if (action.type === 'move') {
        focusRow(action.to);
        return;
      }
      if (action.type === 'answer') o.onAnswer(action.index);
      else if (action.type === 'toggle') o.onToggle?.(action.index);
      else if (action.type === 'tab') o.onTab?.(action.to);
      else if (action.type === 'words') focusRow('words');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return {
    hl,
    root,
    bind: (key) => ({
      ref: (el) => {
        if (el === null) els.current.delete(key);
        else els.current.set(key, el);
      },
      tabIndex: key === hl ? 0 : -1,
    }),
  };
}
