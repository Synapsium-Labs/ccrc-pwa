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
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ChatItem } from './chatItems';
import type { TranscriptItem } from './toolSummary';

export interface TranscriptRowValue {
  /** The row to draw: a plain item, or a folded run of tool entries. */
  readonly item: TranscriptItem;
  /** Draw one plain item as the shared list does. */
  readonly renderItem: (item: ChatItem) => ReactNode;
}

export const TranscriptRowContext = createContext<TranscriptRowValue | null>(null);

/** The row a `TranscriptRow` part is drawing. Throws outside `ChatList`'s
 *  provider rather than drawing nothing: a row rendered with no row is a bug. */
export function useTranscriptRow(): TranscriptRowValue {
  const row = useContext(TranscriptRowContext);
  if (row === null) throw new Error('TranscriptRow rendered outside ChatList');
  return row;
}
