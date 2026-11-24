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
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '@ccrc/ui';
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
  const words = activityWords(item);
  const first = item.attention[0];
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
            <span className="tool-activity-calls tool-activity-messages">{words.messages}</span>
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
      {/* Closed, a mail card that opens by default (the newest, asking the session shown) is drawn under it too, so a
          question is never hidden behind a tap (desktop polish wave 176). Opened, it is in the body, in order. */}
      {!open && item.surfaced !== null && (
        <div className="tool-activity-first" data-attention="mail">{renderItem(item.surfaced)}</div>
      )}
      {open && (
        <div id={bodyId} className="tool-activity-body">
          {item.inner.map((row) => <div key={row.key}>{renderRow(row)}</div>)}
        </div>
      )}
    </div>
  );
}
