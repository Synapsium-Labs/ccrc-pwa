// The tool-activity row (desktop polish wave 168, chat readability part 1): one stretch of a turn's tool activity as ONE
// disclosure, drawn the same way in both skins.
//
// Collapsed by default, it reads "Tool activity · N calls", "running" while the stretch is live, and the newest call's
// one-line summary. What wants the reader is never only inside: the flags ride the row, a live wait no card is
// identified as is a line of the row's own with the transcript's control (open or closed), and the FIRST entry that
// wants the reader (the question asked now, else a failed call) is drawn under the closed row as its own card, with that
// card's own controls (Answer, its disclosure). Opened, the row shows the stretch's rows exactly as the transcript drew them
// before the fold, through the set's own row part (`renderRow`), so a skin's run groups and every tool card are
// unchanged inside it.
//
// The words are `activityWords`' (L1); the decision of what is in the stretch is `foldToolActivity`'s. This component
// only draws them. The open state is the list's `ExpansionMemo`, so it outlives the virtual list unmounting the row,
// and nothing here ever opens a row on its own: a call arriving in a closed stretch leaves it closed.
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '@ccrc/ui';
import { underKey, underRow } from './mailRows';
import { activityWords, waitControlWord, waitWord, type ToolActivityItem } from './toolActivity';
import { useTranscriptRow } from './transcriptRow';

/** A separator the eye reads and the screen reader skips. The spaces around it are what keep the row's spoken name
 *  word by word (a flex row draws no whitespace between its items, so they cost no width). */
function Dot(): ReactNode {
  return <>{' '}<span className="tool-activity-sep" aria-hidden="true">·</span>{' '}</>;
}

export function ToolActivityRow({ item }: { item: ToolActivityItem }): ReactNode {
  const { renderItem, renderRow, expansion, answer } = useTranscriptRow();
  const [open, setOpen] = useState(() => expansion.get(item.key));
  const bodyId = useId();
  const choice = (k: string): boolean | undefined => expansion.choice(k);
  const words = activityWords(item, choice, open);
  const first = item.attention[0];
  const under = open ? [] : underRow(item.mail, choice);
  // A card drawn under the closed row stays there for the view (`underRow`): recorded once it is drawn.
  const drawn = under.map((m) => m.key).join('\u0000');
  useEffect(() => {
    for (const key of drawn === '' ? [] : drawn.split('\u0000')) {
      if (expansion.choice(underKey(key)) !== true) expansion.set(underKey(key), true);
    }
  }, [drawn, expansion]);
  const toggle = (): void => {
    const next = !open;
    expansion.set(item.key, next);
    setOpen(next);
  };
  return (
    <div className="tool-activity" data-live={item.live ? 'true' : undefined}>
      <button
        type="button"
        className={`tool-activity-row ${FOCUS_RING}`}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={toggle}
      >
        <span className="tool-activity-chev" aria-hidden="true">▸</span>
        <span className="tool-activity-title">{words.title}</span>
        <Dot />
        <span className="tool-activity-calls">{words.calls}</span>
        {words.messages !== null && (
          <>
            <Dot />
            <span className="tool-activity-calls tool-activity-messages">{`${words.messages}${words.asks === null ? '' : ','}`}</span>
            {/* The question words never shrink, and wrap to a line of their own before they are cut (B2, `chat.css`). */}
            {words.asks !== null && <>{' '}<span className="tool-activity-asks">{words.asks}</span></>}
          </>
        )}
        {words.state !== null && (
          <>
            <Dot />
            <span className="tool-activity-state">{words.state}</span>
          </>
        )}
        {words.attention.length > 0 && (
          <>
            {' '}
            <span className="tool-activity-attention-count">
              {words.attention.map((w) => <span key={w} className="tool-activity-flag">{`${w} `}</span>)}
            </span>
          </>
        )}
        {' '}
        <span className="tool-activity-latest">{words.latest}</span>
      </button>
      {/* A live wait no card is identified as: the row's own line, open or closed, with the transcript's control, which
          raises the pending sheet or the inline card and sends nothing (`ToolCard`'s ONE CONTROL rule). */}
      {item.waiting && (
        <p className="tool-activity-wait">
          <span>{waitWord(answer.askBelow === true)}</span>
          {answer.onAnswer !== undefined && (
            <button type="button" className={`tool-activity-answer ${FOCUS_RING}`} onClick={answer.onAnswer}>
              {waitControlWord(answer.askBelow === true, answer.answerLabel)}
            </button>
          )}
        </p>
      )}
      {/* Closed, the first entry that wants the reader is drawn as its own card: the question asked now (its card carries
          Answer), else the first failure. Opened, the same cards are in the body, in order. */}
      {!open && first !== undefined && (
        <div className="tool-activity-first" data-attention={first.kind}>{renderItem(first.entry)}</div>
      )}
      {/* Closed, the mail card that opens by default (the newest asking the session shown) is drawn under it too, with
          every card drawn here earlier in this view, in the stretch's order, so a question is never hidden behind a tap
          and nothing moves under the reader (desktop polish wave 176, `underRow`). Opened, they are in the body. */}
      {under.map((m) => (
        <div key={m.key} className="tool-activity-first" data-attention="mail">{renderItem(m)}</div>
      ))}
      {open && (
        <div id={bodyId} className="tool-activity-body">
          {item.inner.map((row) => <div key={row.key}>{renderRow(row)}</div>)}
        </div>
      )}
    </div>
  );
}
