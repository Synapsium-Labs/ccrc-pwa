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
//   handled inside the sheet: a phone is never pulled out of its composer by a sheet that slid up. INLINE (D-6326, R64)
//   the rule is narrower, exactly: focus moves ONLY while the ask's ONE engagement (`useAskEngagement`, held by the
//   controller and shared by every `useAskKeys` it renders: the question screens', the review's and a menu's) is
//   engaged for the CURRENT ask AND focus is lost (`body`, `documentElement` or nothing) or already inside the card,
//   and then it goes to the new screen's highlighted row. That is the next question after a key answered one, the
//   review after the last question, and a question after ← from the review: the focused row unmounted with its
//   screen, and without this the keyboard would be dead until a click. The engagement belongs to the ask's identity
//   (`DialogSheet`'s `askIdentity`), not to a hook instance and not to the card's mount: it ends when the identity
//   changes or goes (even when the card stays mounted and the clear and the new ask arrive in one batch, and for
//   good: the ask that comes back later with equal content starts unengaged), and on a deliberate move out of the
//   card (a pointerdown or a focusin outside it: the composer, the transcript, the fleet column, the body). With it
//   not engaged (an ask arriving beside the composer, a successor ask, a skin switch) focus moves not at all, and
//   enters the card only through `raise` (`AskSurface`), a Tab or a click. A reconnect does not disengage by itself:
//   the held gap keeps the same `askIdentity`, and the new connection's first frames keep it too, except when the
//   store holds an envelope that the new connection's first `ask_cleared` clears: the server then stated no envelope
//   at that moment (the ask ended during the drop, or the server flapped: a failed hook-state read, or an
//   aged-envelope keep decision restarting), and either releases the keys, the safe direction. If the store holds no
//   envelope, that frame counts nothing. The engagement of the SAME ask stands; it never takes focus from outside the
//   card, and may move focus from the body, or from within the card, to a repainted screen's highlighted row. The
//   identity is a lifecycle generation (the store's `askEpoch`, raised by every `ask_cleared` that clears an envelope
//   the store holds, and every `dialog_cleared` while it holds none; so a clear is seen even in one batch with a
//   byte-identical ask, and a transient `dialog_cleared` under a hooked ask's envelope is not one) joined to the
//   envelope for a hooked ask, to one word for an ask-backed surface with no envelope (the transcript's copy of a
//   question, its review, an unreadable ask: the ask frames this controller reads carry no per-ask id and the pane
//   dialog's id changes per screen), and to the pane dialog's id for a plain menu or the terminal door (each such
//   screen is its own ask). One known gap, kept plain: two DIFFERENT aged asks back to back with no clear between
//   them cannot be told from two screens of one aged ask, so they share an identity and the engagement continues into
//   the second (the transcript's events hold the AskUserQuestion call's `toolId`, which this controller deliberately
//   does not read: the transcript lags and rotates, and it would add a coupling and a parser); it only ever takes
//   focus that the engaged control's replacement dropped to the body, never focus that is outside the card.
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
  /** The ask's shared engagement (`useAskEngagement`). Absent, the INLINE focus rule behaves as never engaged. */
  readonly engagement?: AskEngagement;
}

/** The keyboard's engagement with ONE logical ask, shared by every `useAskKeys` the controller renders (R64). */
export interface AskEngagement {
  /** Is the keyboard engaged with the ask showing now? Read at the moment of asking. */
  readonly engaged: () => boolean;
  /** A key was handled inside the inline card: engage with the ask showing now (the owner's layout effect compares). */
  readonly engage: () => void;
}

/**
 * The ONE owner of the inline engagement (D-6326, R64, R69). `identity` is the ask's (`DialogSheet`'s `askIdentity`):
 * the store's lifecycle generation (`askEpoch`, a count of the clears that end an ask) joined to the hook's envelope
 * for every question and the review of it, to one word for an aged ask (no envelope; its pane dialog id changes per
 * screen), or to the pane dialog's id for a plain menu; null when nothing is asked. The owner treats it as an opaque
 * string. It holds the identity engaged and lets go, in one layout effect, as soon as the identity is any other (a
 * replacement, a clear, even in the same batch), so an ask that comes back later with equal content starts unengaged.
 * It also lets go on deliberate movement out of the card. Focus that falls to the body because the focused row
 * unmounted fires neither event, so that case stays engaged: it is the one continuation.
 */
export function useAskEngagement(identity: string | null): AskEngagement {
  const held = useRef<string | null>(null);
  const now = useRef<string | null>(identity);
  // ONE release: whenever the identity is not the one engaged (a different ask, a replacement, a clear), the engagement is
  // gone for good, in the commit that shows the new identity and before any focus timer reads it. Comparing at read time
  // instead would let a replaced ask regain it when byte-identical content came back (A -> B -> A, no clear between).
  useLayoutEffect(() => {
    now.current = identity;
    if (held.current !== identity) held.current = null;
  }, [identity]);
  useEffect(() => {
    const away = (e: Event): void => {
      const t = e.target instanceof Element ? e.target : null;
      if (t === null || t.closest('[data-ask-surface="inline"]') === null) held.current = null;
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('focusin', away, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('focusin', away, true);
    };
  }, []);
  const [owner] = useState<AskEngagement>(() => ({
    engaged: () => held.current !== null,
    engage: () => {
      held.current = now.current;
    },
  }));
  return owner;
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
  // INLINE (D-6326, R64) the engagement is not this hook's: it is the ask's, shared (`opts.engagement`), so it survives
  // the screen change to the review and back, and ends with the ask. This `engaged` is the phone's alone: only a key handled
  // outside the inline card sets it, so this hook, which outlives an ask and a crossing below 900, carries nothing from an
  // inline key. A phone's own engagement still carries across asks, as it always has.
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
    if (!finePointer() && !engaged.current && !latest.current.opts.engagement?.engaged()) return undefined;
    const key = hl;
    const t = setTimeout(() => {
      // Read here, where the ref is attached (the card mounts with its screen). INLINE (D-6326, R64) focus is moved only
      // on a screen change inside a card the keyboard is already in, for THIS ask: a key answered a question, its
      // focused row left the DOM with it, and focus fell to the page body, where no key acts. Then (and only then) the
      // new screen's highlighted row takes it back, never from anything outside the card: the composer, the transcript,
      // a field. Without the shared engagement (absent, or not engaged for the ask showing now) it moves not at all.
      // The position test below (`lost || scope.contains(at)`) is defence in depth behind the engagement's `focusin`
      // release, which is the guard today: a realistic move of focus out of the card fires `focusin` first and ends the
      // engagement, so the engagement test has already returned before this position is read. The arm is equivalent to
      // its absence for every realistic focus move, and no test can observe it without faking an event; it stays for a
      // focus move that skips the listener.
      const scope = surfaceOf(root.current);
      if (scope?.getAttribute('data-ask-surface') === 'inline') {
        const at = document.activeElement;
        const lost = at === null || at === document.body || at === document.documentElement;
        if (!latest.current.opts.engagement?.engaged() || !(lost || scope.contains(at))) return;
      } else if (!finePointer() && !engaged.current) {
        // The phone path is exactly as it was: the shared (inline) engagement lets the effect run, never a Sheet's row.
        return;
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
      if (inline) o.engagement?.engage();
      else engaged.current = true;
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
