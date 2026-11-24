// The mail lane's rows in a session's chat (desktop polish wave 176): a fetched card, closed to one line by default; the
// lane's own prompt as one quiet line; and a run of prompts as one line with a count. What each row is and says is
// `mailRows.ts`' (L1); this draws them through the design system's `MailCard` and `MailPromptLine`.
//
// THE OPEN STATE IS THE LIST'S `ExpansionMemo`, keyed by the row's key, exactly as a tool-activity row's is: it outlives
// the virtual list unmounting the row and live rows arriving, and it ends with the session view (a reload starts
// fresh). A row draws the reader's choice when they made one, else its default (`openOf`), so a card that opens by
// default and that the reader closed stays closed, and a card stops opening by default once newer mail arrives below.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MailCard, MailPromptLine, MailPromptText } from '@ccrc/ui';
import type { ChatItem } from './chatItems';
import { cardTime, openOf, promptWords, promptsOf, type MailPromptItem } from './mailRows';
import { expansionMemo, type ExpansionMemo } from './transcriptRow';

type MailRowItem = Extract<ChatItem, { kind: 'mail' | 'mail-prompt' | 'mail-prompts' }>;

/** The row's open state, read from the memo and written back to it on a toggle. */
function useOpen(item: MailRowItem, memo: ExpansionMemo): [boolean, () => void] {
  const [, redraw] = useState(0);
  const open = openOf((k) => memo.choice(k), item);
  const toggle = (): void => {
    memo.set(item.key, !open);
    redraw((n) => n + 1);
  };
  return [open, toggle];
}

function PromptLine({ item, memo }: { item: MailPromptItem; memo: ExpansionMemo }): ReactNode {
  const [open, toggle] = useOpen(item, memo);
  const words = promptWords([item]);
  return (
    <MailPromptLine {...words} open={open} onToggle={toggle}>
      <MailPromptText text={item.event.text} />
    </MailPromptLine>
  );
}

function PromptRun({ item, memo }: { item: Extract<ChatItem, { kind: 'mail-prompts' }>; memo: ExpansionMemo }): ReactNode {
  const [open, toggle] = useOpen(item, memo);
  const words = promptWords(promptsOf(item));
  return (
    <MailPromptLine {...words} open={open} onToggle={toggle}>
      {item.members.map((m) => (m.kind === 'divider'
        ? <p key={m.key} className="ts-divider">{m.label}</p>
        : <PromptLine key={m.key} item={m} memo={memo} />))}
    </MailPromptLine>
  );
}

function Card({ item, memo }: { item: Extract<ChatItem, { kind: 'mail' }>; memo: ExpansionMemo }): ReactNode {
  const [open, toggle] = useOpen(item, memo);
  return <MailCard envelope={item.envelope} fold={{ open, onToggle: toggle, time: cardTime(item) }} />;
}

/** One mail row of the chat, by its kind. */
export function MailRow({ item, expansion }: { item: MailRowItem; expansion?: ExpansionMemo }): ReactNode {
  // A row drawn outside any list (a test, a story) keeps its own memo for as long as it is mounted.
  const [own] = useState(expansionMemo);
  const memo = expansion ?? own;
  switch (item.kind) {
    case 'mail': return <Card item={item} memo={memo} />;
    case 'mail-prompt': return <PromptLine item={item} memo={memo} />;
    case 'mail-prompts': return <PromptRun item={item} memo={memo} />;
  }
}
