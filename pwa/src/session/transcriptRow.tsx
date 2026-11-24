// What a skin's transcript row reads (D-5475, W2 Task S13b).
//
// A skin's part takes no props (D-5678): it reads what it shows from shared
// stores, hooks and models, so it can never be handed a value the other skin
// computes differently. A transcript row is the one part placed once PER ROW,
// so its row arrives through this context, which `ChatList` provides around
// each item it renders — the item (a plain `ChatItem`, or a `tool-group` that
// `groupToolRun` folded), and `renderItem`, the shared renderer that draws a
// plain item exactly as the list does today (a message, a tool card, a pending
// send, each behind its own render boundary). A row draws a group itself and
// hands everything else, the group's own entries included, to `renderItem`,
// so no skin re-implements a card (W2 Global constraints, "One data model").
// A tool-activity row (desktop polish wave 168) draws its expansion through
// `renderRow`, so a folded run inside it is the set's own row again.
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatItem } from './chatItems';
import type { TranscriptItem } from './toolActivity';

export interface TranscriptRowValue {
  /** The row to draw: a plain item, a folded run of tool entries, or a stretch of tool activity. */
  readonly item: TranscriptItem;
  /** Draw one plain item as the shared list does. */
  readonly renderItem: (item: ChatItem) => ReactNode;
  /** Draw one row of a tool-activity row's expansion (a plain item or a folded run) through the set's own row part, as
   *  the list draws a top-level row. */
  readonly renderRow: (item: TranscriptItem) => ReactNode;
  /** Which tool-activity rows the reader opened, kept for as long as the session view is open (`ExpansionMemo`). */
  readonly expansion: ExpansionMemo;
  /** The transcript's answer control, which a tool-activity row offers on its line for a live wait no call is identified
   *  as (an approval, a menu, a question it does not single out): `onAnswer` raises the sheet (or, with `askBelow`, the
   *  inline card below the transcript) and answers nothing itself. */
  readonly answer: AnswerControl;
}

/** What the transcript's answer control needs: the list's own `onAnswer`, `answerLabel` and `askBelow`. */
export interface AnswerControl {
  readonly onAnswer?: () => void;
  readonly answerLabel?: string;
  readonly askBelow?: boolean;
}

/** The reader's open or closed choice per tool-activity row, by the row's key. It lives in the list, not in a row: the
 *  virtual list unmounts a row scrolled out of reach, and the row's choice must outlive that. */
export interface ExpansionMemo {
  get(key: string): boolean;
  set(key: string, open: boolean): void;
}

/** The list's memo for the session `id`: held in state, so React never drops it, and fresh when the session changes. */
export function useExpansionMemo(id: string): ExpansionMemo {
  const [held, setHeld] = useState(() => ({ id, memo: expansionMemo() }));
  if (held.id === id) return held.memo;
  const next = { id, memo: expansionMemo() };
  setHeld(next);
  return next.memo;
}

/** A fresh memo: every row closed until the reader opens it. */
export function expansionMemo(): ExpansionMemo {
  const open = new Set<string>();
  return {
    get: (key) => open.has(key),
    set: (key, o) => { if (o) open.add(key); else open.delete(key); },
  };
}

export const TranscriptRowContext = createContext<TranscriptRowValue | null>(null);

/** The row a `TranscriptRow` part is drawing. Throws outside `ChatList`'s
 *  provider rather than drawing nothing: a row rendered with no row is a bug. */
export function useTranscriptRow(): TranscriptRowValue {
  const row = useContext(TranscriptRowContext);
  if (row === null) throw new Error('TranscriptRow rendered outside ChatList');
  return row;
}
