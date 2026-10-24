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
//   D-6326: the scope is the nearest `[data-ask-surface]` (the desk's inline card), else the nearest dialog (the phone's
//   `Sheet` cannot carry a data attribute: it forwards none). INLINE the page-body arm does not apply: the card blocks
//   nothing and is no modal, so a digit, an arrow or Enter with nothing focused, or focused on the transcript, is the
//   page's own and never answers; a key acts only when its target is inside the card.
// - FOCUS moves into the sheet on open and on each new screen only under a fine pointer, or once a key has been
//   handled inside the sheet: a phone is never pulled out of its composer by a sheet that slid up. INLINE the rule is
//   narrower, exactly: focus moves ONLY when `engaged` is true (a key has been handled inside the card) AND focus is
//   lost (`body`, `documentElement` or nothing) or already inside the card, and then it goes to the new screen's
//   highlighted row. That is the next question after a key answered one: the focused row unmounted with its screen,
//   and without this the keyboard would be dead until a click. With `engaged` false (an ask arriving beside the
//   composer) it moves not at all, and focus enters the card only through `raise` (`AskSurface`), a Tab or a click;
//   with focus anywhere outside the card (the composer, the transcript, another field) it is never taken.
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
  /** The free-text row's digit was pressed (D-6325, R5): the sheet chooses `Other`, which opens the field. The row (or the
   *  field, once open) is focused first; the sheet puts the cursor in the field when it opens. */
  readonly onWords?: () => void;
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

/** The surface the keys are scoped to: the desk's inline card, else the phone's dialog (D-6326). */
const surfaceOf = (el: Element | null): Element | null =>
  el?.closest('[data-ask-surface]') ?? el?.closest('[role="dialog"]') ?? null;

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
  // Was the keyboard engaged inside the desk's inline card (D-6326)? An inline engagement ends with its ask: this hook
  // outlives the card (`DialogSheet` keeps it across asks), and a later ask arriving at the desk takes no focus. A phone's
  // engagement is left as it always was. The ask has ended when the keys go off or the surface closes (`DialogSheet`'s
  // closed hold keeps the last screen's keys while its content is inert, so `open` is the one that falls then).
  const engagedInline = useRef(false);
  const ended = !open || screen === null;
  useEffect(() => {
    if (!ended || !engagedInline.current) return;
    engaged.current = false;
    engagedInline.current = false;
  }, [ended]);
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
  // `preventScroll` (D-6325, as `Sheet`'s own open-time focus does, D-5610): the sheet has one scroller, and a long
  // question above the options is not to be scrolled away on open. An arrow key's `focusRow` keeps the normal scroll.
  useEffect(() => {
    if (!open || screen === null || hl === null) return undefined;
    if (!finePointer() && !engaged.current) return undefined;
    const key = hl;
    const t = setTimeout(() => {
      // Read here, where the ref is attached (the card mounts with its screen). INLINE (D-6326) focus is moved only on
      // a screen change inside a card the keyboard is already in: a key answered question 1, its focused row left the
      // DOM with it, and focus fell to the page body, where no key acts. Then (and only then) the new screen's
      // highlighted row takes it back, never from anything outside the card: the composer, the transcript, a field.
      const scope = surfaceOf(root.current);
      if (scope?.getAttribute('data-ask-surface') === 'inline') {
        const at = document.activeElement;
        const lost = at === null || at === document.body || at === document.documentElement;
        if (!engaged.current || !(lost || scope.contains(at))) return;
      }
      els.current.get(key)?.focus({ preventScroll: true });
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, screenId, screen === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { opts: o, hl: at } = latest.current;
      if (e.defaultPrevented || !o.open || o.screen === null) return;
      const scope = surfaceOf(root.current);
      const inline = scope?.getAttribute('data-ask-surface') === 'inline';
      const target = e.target instanceof Element ? e.target : null;
      // The page-body arm is the modal's alone (D-6326): inline, only a key inside the card acts.
      const onPage = !inline && (target === null || target === document.body || target === document.documentElement);
      if (!onPage && (scope === null || !scope.contains(target))) return;
      // `words` is the `Other` row while the field is closed and the field once it is open (D-6325, R5): only the field is
      // text, so only the field keeps the keys a caret and a digit need.
      const wordsEl = els.current.get('words');
      const inWords = target !== null && wordsEl !== undefined && target === wordsEl && typingInto(wordsEl);
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
      engagedInline.current = inline;
      if (action.type === 'move') {
        focusRow(action.to);
        return;
      }
      if (action.type === 'answer') o.onAnswer(action.index);
      else if (action.type === 'toggle') o.onToggle?.(action.index);
      else if (action.type === 'tab') o.onTab?.(action.to);
      else if (action.type === 'words') {
        focusRow('words');
        o.onWords?.();
      }
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
