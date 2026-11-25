// Mail card — agent-to-agent mail, attributed to whoever actually sent it.
//
// Spec §2.1/§2.3, Build 4 Task 17, corrected by W-1 / D-296 (was D-B4-23).
//
// Delivered mail has always reached the transcript on its own; what was
// missing was never the EVENT, only the ATTRIBUTION, and this card is that
// attribution. HOW it reaches the transcript changed mid-program, and the two
// ways are both live for a reader today:
//
//   - LEGACY (before 43b2737): `sweepMail` typed the whole rendered envelope
//     into the recipient's input box, so it landed in the JSONL as a `user`
//     turn — and rendered as a "you" bubble full of fenced boilerplate, the
//     machine's words filed as the operator's. Transcripts from waves 1-2
//     still hold these.
//   - LIVE (today): the lane types a one-line reference nudge and the worker
//     fetches the body with `GET /api/mail/:id`, so the envelope arrives as
//     that call's `tool_result`.
//
// `buildChatItems` derives this card from either, and neither mints anything
// into the store. See its own two arms for which guards belong to which door.
//
// A RENDERING, NEVER AN AUTHORIZATION. The transcript is a rank-3 source and a
// session can type a fake envelope into itself. The authoritative mail rows
// come from the database (`{type:'mail'}`, `GET /api/feed`) and are what
// `MailStrip` reads. Consequence of a forgery: one bubble looks like mail.
// Named in the spec, accepted, and stated again here because this file is
// where someone would be tempted to add a check that cannot work.
//
// NO CONTROLS OF ANY KIND. Ack is box-token gated and is the AGENT's act
// (`coord/envelope.ts`'s own `ack:` lines tell it exactly how); composing mail
// from the PWA is a stated non-goal. A control here would be a second door on
// one act — the same reasoning that keeps `Answer` in `ToolCard` from
// answering anything. The one exception is the disclosure of the closable
// form (`fold`, desktop polish wave 176): it opens and closes the card on
// this screen, and acts on nothing else.
import { useId } from 'react';
import { FOCUS_RING } from '../lib/focus';
import { RESET_LIST } from '../lib/text';
import { Icon } from '../primitives/icon';
import type { ReactNode } from 'react';
import type { MailEnvelope } from '../../../shared/api';
import { Well } from '../primitives/well';
import './mail-card.css';

/** The mail glyph's classes, on the card's sender row and on its head line. self-center: a block svg has no baseline in a
 *  baseline row (D-5100). */
const GLYPH = 'mail-card-glyph self-center';

/** `run 5 · build4 wave 4/4`, with each clause independently optional —
 *  mirroring `renderEnvelope`'s own three conditionals. Returns null when
 *  there is no run at all, so the card renders no row rather than an empty
 *  one: a mail that belongs to no run is an ordinary message between two
 *  sessions and saying "run —" about it would be inventing a fact. */
export function runLabel(e: MailEnvelope): string | null {
  if (e.runId === null) return null;
  const program = e.program === null ? '' : ` · ${e.program}`;
  const wave = e.wave === null
    ? ''
    : ` wave ${e.wave}${e.waveOf === null ? '' : `/${e.waveOf}`}`;
  return `run ${e.runId}${program}${wave}`;
}

/** The closed card's spoken name: what it is, who sent it, what it is about, its kind and when (desktop polish wave 176).
 *  Whether it is open is the button's `aria-expanded`, said by the reader's own words. */
export function mailLineLabel(e: MailEnvelope, time: string | null): string {
  return `Mail from ${e.fromId}: ${e.subject}, ${e.kind}${time === null ? '' : `, ${time}`}`;
}

/** The card's disclosure (desktop polish wave 176, the operator's "nicely wrapped up"): closed, one line; open, the head
 *  line and today's card whole under it. The caller keeps the open state (the chat list keeps it across its virtual rows
 *  unmounting a row), so the card only draws it and reports a tap. */
export interface MailCardFold {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** When the mail reached the session (`14:02`), or null when the transcript does not say. */
  readonly time: string | null;
}

/** The rows of today's card, under its head. */
function CardRows({ envelope }: { envelope: MailEnvelope }): ReactNode {
  const run = runLabel(envelope);
  return (
    <>
      <p className="mail-card-from">
        <span className={GLYPH} aria-hidden="true"><Icon name="mail" /></span>
        <span className="mail-card-sender">{envelope.fromId}</span>
        <span className="mail-card-arrow" aria-hidden="true">→</span>
        <span className="mail-card-recipient">{envelope.toId}</span>
      </p>
      <p className="mail-card-meta">
        <span className="mail-card-kind">{envelope.kind}</span>
        <span className="mail-card-subject">{envelope.subject}</span>
        {run !== null && <span className="mail-card-run">{run}</span>}
      </p>
      {envelope.artifacts.length > 0 && (
        // PATHS, NEVER PAYLOADS (spec:52-53) — and rendered as paths, not as
        // links: nothing on this card fetches anything, and a tappable path
        // would promise a fetch this surface does not have.
        <ul className={`mail-card-artifacts ${RESET_LIST}`}>
          {/* Keyed by INDEX, not by path: nothing upstream forbids a sender
              listing the same path twice, and a duplicate key would drop a
              row from a list whose whole job is to be complete. The list is
              static per card, so the index is a stable key. */}
          {envelope.artifacts.map((p, i) => (
            <li className="mail-card-artifact" key={`${i}-${p}`}>{p}</li>
          ))}
        </ul>
      )}
      {envelope.body !== '' && <Well className="mail-card-body">{envelope.body}</Well>}
    </>
  );
}

/** With `fold`, the card is a disclosure: its head is one line (sender, subject, kind, time) and a button that opens it,
 *  the only control the card has; it answers, acks and fetches nothing. Without `fold`, today's card, unchanged. */
export function MailCard({ envelope, fold }: { envelope: MailEnvelope; fold?: MailCardFold }): ReactNode {
  const bodyId = useId();
  if (fold === undefined) {
    return (
      <article className="mail-card">
        <CardRows envelope={envelope} />
      </article>
    );
  }
  const { open, onToggle, time } = fold;
  return (
    <article className={`mail-card mail-card--fold${open ? ' mail-card--open' : ''}`}>
      <button
        type="button"
        className={`mail-card-head ${FOCUS_RING}`}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        aria-label={mailLineLabel(envelope, time)}
        onClick={onToggle}
      >
        <span className="mail-card-chev" aria-hidden="true">▸</span>
        <span className={GLYPH} aria-hidden="true"><Icon name="mail" /></span>
        <span className="mail-card-line-sender">{envelope.fromId}</span>
        <span className="mail-card-line-subject">{envelope.subject}</span>
        <span className="mail-card-kind">{envelope.kind}</span>
        {time !== null && <span className="mail-card-time">{time}</span>}
      </button>
      {open && (
        <div className="mail-card-open" id={bodyId}>
          <CardRows envelope={envelope} />
        </div>
      )}
    </article>
  );
}
