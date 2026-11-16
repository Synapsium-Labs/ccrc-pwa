// The ask sheets' keyboard, like Claude Code's own (decision `ask-sheet-keyboard-model`). PURE: what a key does on a
// screen, from the rows the sheet shows and where the highlight is; `useAskKeys.ts` binds it to the DOM.
//
// Claude Code's keys, measured on 2.1.302 and 2.1.296 (the recordings under server/test/fixtures/panes/cc302-ask-* and
// cc296-ask-2q-long-*):
//  - ↑/↓ move the cursor. On a question ↓ runs options → free-text row → `Chat about this` and STOPS there; ↑ from
//    option 1 wraps to the free-text row. On the free-text row ↑ is the last option and ↓ is Chat. On the review ↑/↓
//    swap Submit and Cancel, wrapping.
//  - ←/→ switch tabs: question to question, the last question to the review, the review back to the last question; no
//    wrap at either end. They are the PANE's tabs, so here they move the pane (`POST /dialog/tab`), and the sheet
//    follows the screen it lands on. On the free-text row they move the text caret, so the own-words field keeps them.
//  - A digit answers that option at once; on a multiSelect question it toggles that box and the cursor stays; on the
//    review `1` submits and `2` cancels at once (the operator ruled "Match Claude Code"). The free-text row's digit
//    puts the cursor there (the sheet: focus in the own-words field), and Chat's digit only highlights Chat here: it
//    declines the whole ask, so it takes Enter or a click.
//  - Enter answers the highlighted row. On the sheet that is the native activation of the focused row's button, so
//    this model leaves Enter and Space to the browser (Space activates a button too: a deviation for accessibility,
//    with the same outcome as Enter). An empty own-words field never sends (`ownWordsHeld`'s `blank`), never Claude
//    Code's empty-Enter decline.
//  - Escape hides the sheet and never interrupts (decision `ask-sheet-escape-never-interrupts`), where Claude Code
//    declines the whole ask. Tab and Shift+Tab keep the browser's focus order, a departure: in Claude Code they are the
//    next and previous tab, which here are ←/→ and the tab strip. Neither is handled here.
//  - No letter is bound: a preview question's `n` (notes) is the terminal's.

/** One row the keyboard can reach, in screen order. `key` names it across renders: `o<k>` for a printed row k (an
 *  option, `Chat about this`, a box, a review row), `words` for the own-words field, `commit` for a multiSelect commit. */
export interface KeyRow {
  readonly key: string;
  readonly kind: 'option' | 'chat' | 'words' | 'box' | 'commit';
  /** The printed digit, for `option`, `chat`, `box` and `words` (the free-text row's). */
  readonly index?: number;
}

/** What the sheet is showing, as the keyboard sees it. */
export interface KeyScreen {
  readonly kind: 'question' | 'review' | 'multi';
  readonly rows: readonly KeyRow[];
  /** ←/→ across the ask's tabs, or null where the pane paints none (a one-question ask). `prev`/`next` false at an edge
   *  the sheet can see (question 1, the review), where Claude Code does nothing either. `held`: a multiSelect question's
   *  boxes were changed on the sheet and not committed, which a tab move would lose, so ←/→ wait. */
  readonly tabs: { readonly prev: boolean; readonly next: boolean; readonly held: boolean } | null;
}

/** A key, as the model needs it. `inWords`: the event's target is the sheet's own-words field. */
export interface KeyPress {
  readonly key: string;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly repeat?: boolean;
  readonly inWords?: boolean;
}

export type KeyAction =
  | { readonly type: 'move'; readonly to: string }
  | { readonly type: 'answer'; readonly index: number }
  | { readonly type: 'toggle'; readonly index: number }
  | { readonly type: 'tab'; readonly to: 'prev' | 'next' }
  | { readonly type: 'words' }
  | { readonly type: 'none' };

const NONE: KeyAction = { type: 'none' };
const move = (to: string): KeyAction => ({ type: 'move', to });

/** The row key for printed row `k`. */
export const rowKey = (k: number): string => `o${k}`;

/**
 * What `press` does on `screen` with the highlight on row `at` (a `KeyRow.key`; null when nothing in the sheet has
 * focus yet, and then an arrow only puts the highlight on `start`). `none` means the key is not the sheet's: the
 * browser keeps it, and it propagates.
 */
export function askKeyAction(screen: KeyScreen, at: string | null, start: string | null, press: KeyPress): KeyAction {
  if (press.alt || press.ctrl || press.meta || press.shift) return NONE;
  const { rows } = screen;
  const pos = rows.findIndex((r) => r.key === at);
  const words = rows.findIndex((r) => r.kind === 'words');

  // In the own-words field only ↑/↓ are the sheet's; everything else is text, the caret, or the form's own Enter.
  if (press.inWords) {
    if (words < 0) return NONE;
    if (press.key === 'ArrowUp') return words > 0 ? move(rows[words - 1]!.key) : NONE;
    if (press.key === 'ArrowDown') return words + 1 < rows.length ? move(rows[words + 1]!.key) : NONE;
    return NONE;
  }

  if (press.key === 'ArrowUp' || press.key === 'ArrowDown') {
    if (rows.length === 0) return NONE;
    if (pos < 0) return start !== null && rows.some((r) => r.key === start) ? move(start) : move(rows[0]!.key);
    const down = press.key === 'ArrowDown';
    if (screen.kind === 'review') return move(rows[(pos + (down ? 1 : rows.length - 1)) % rows.length]!.key);
    if (down) return pos + 1 < rows.length ? move(rows[pos + 1]!.key) : NONE;
    if (pos > 0) return move(rows[pos - 1]!.key);
    // ↑ from option 1 wraps to the free-text row, as Claude Code's does; nowhere to go without one.
    return screen.kind === 'question' && words > 0 ? move(rows[words]!.key) : NONE;
  }

  if (press.key === 'ArrowLeft' || press.key === 'ArrowRight') {
    if (press.repeat || screen.tabs === null || screen.tabs.held) return NONE;
    const prev = press.key === 'ArrowLeft';
    if (prev ? !screen.tabs.prev : !screen.tabs.next) return NONE;
    return { type: 'tab', to: prev ? 'prev' : 'next' };
  }

  if (/^[1-9]$/.test(press.key)) {
    if (press.repeat) return NONE;
    const row = rows.find((r) => r.index === Number(press.key));
    if (row === undefined) return NONE;
    switch (row.kind) {
      case 'option':
        return { type: 'answer', index: row.index! };
      case 'box':
        return { type: 'toggle', index: row.index! };
      case 'words':
        return { type: 'words' };
      case 'chat':
        return move(row.key);
      default:
        return NONE;
    }
  }
  return NONE;
}

/** The ask's tabs as the keyboard reads them: where the sheet knows it is (`active`, a 0-based question, or null when
 *  it cannot tell), and whether the boxes hold an uncommitted change. Null when the pane paints no tab row. */
export function keyTabs(
  count: number | null, active: number | null, onReview: boolean, held = false,
): KeyScreen['tabs'] {
  if (count === null) return null;
  return { prev: onReview || active === null || active > 0, next: !onReview, held };
}

/** A question screen's rows: its options, the own-words field at the free-text row's digit, then Chat. */
export function questionKeys(
  options: readonly number[], words: number | null, chat: number | null, tabs: KeyScreen['tabs'],
): KeyScreen {
  const rows: KeyRow[] = options.map((k) => ({ key: rowKey(k), kind: 'option', index: k }));
  if (words !== null) rows.push({ key: 'words', kind: 'words', index: words });
  if (chat !== null) rows.push({ key: rowKey(chat), kind: 'chat', index: chat });
  return { kind: 'question', rows, tabs };
}

/** The review screen's two rows, Submit then Cancel, each answered by its printed digit. */
export function reviewKeys(submit: number, cancel: number, tabs: KeyScreen['tabs']): KeyScreen {
  return {
    kind: 'review',
    rows: [submit, cancel].map((k) => ({ key: rowKey(k), kind: 'option', index: k })),
    tabs,
  };
}

/** A multiSelect question's boxes, then its commit. */
export function multiKeys(boxes: readonly number[], tabs: KeyScreen['tabs']): KeyScreen {
  const rows: KeyRow[] = boxes.map((k) => ({ key: rowKey(k), kind: 'box', index: k }));
  rows.push({ key: 'commit', kind: 'commit' });
  return { kind: 'multi', rows, tabs };
}
