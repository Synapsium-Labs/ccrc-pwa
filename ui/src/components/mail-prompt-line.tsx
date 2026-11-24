// Mail prompt line (desktop polish wave 176): the line the mail lane types into a session's pane, drawn as one quiet
// line instead of a bubble from the person.
//
// The lane types a fixed head and a few words ("ccrc-mail: you have new mail. …") every time mail reaches a session, so
// a coordinator's chat was mostly the same paragraph, filed as the operator's words. The line says what it is ("Mail
// arrived"), how many when it stands for a run of them, and when; its full text, or the run's own lines, open under it
// on a tap or Enter. Which turns are prompts, and which run together, is the app's decision (its words arrive as props);
// this draws them and reports a tap. It answers, acks and fetches nothing.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '../lib/focus';
import { Icon } from '../primitives/icon';
import './mail-prompt-line.css';

export interface MailPromptLineProps {
  /** "Mail arrived". */
  readonly title: string;
  /** "3 times" for a run, else null. */
  readonly count: string | null;
  /** "14:02", or "14:02–14:40" for a run. */
  readonly time: string;
  /** The spoken name: what the line is, how many and when. Whether it is open is the button's `aria-expanded`. */
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** What opens under the line: the prompt's full text, or the run's lines. Drawn only while open. */
  readonly children: ReactNode;
}

export function MailPromptLine({ title, count, time, label, open, onToggle, children }: MailPromptLineProps): ReactNode {
  const bodyId = useId();
  return (
    <div className={`mail-prompt${open ? ' mail-prompt--open' : ''}`}>
      <button
        type="button"
        className={`mail-prompt-line ${FOCUS_RING}`}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        aria-label={label}
        onClick={onToggle}
      >
        <span className="mail-prompt-chev" aria-hidden="true">▸</span>
        <span className="mail-prompt-glyph self-center" aria-hidden="true"><Icon name="mail" /></span>
        <span className="mail-prompt-title">{title}</span>
        {count !== null && <span className="mail-prompt-count">{count}</span>}
        <span className="mail-prompt-time">{time}</span>
      </button>
      {open && <div className="mail-prompt-body" id={bodyId}>{children}</div>}
    </div>
  );
}

/** A prompt's full text, as it was typed: verbatim, never Markdown (the lane's line is not Markdown, and a `*` or a `|`
 *  in it must read as written). */
export function MailPromptText({ text }: { text: string }): ReactNode {
  return <pre className="mail-prompt-text">{text}</pre>;
}
