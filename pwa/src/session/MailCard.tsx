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
// answering anything.
import type { ReactNode } from 'react';
import type { MailEnvelope } from '../../../shared/api';
import './chat.css';

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

export function MailCard({ envelope }: { envelope: MailEnvelope }): ReactNode {
  const run = runLabel(envelope);
  return (
    <article className="mail-card">
      <p className="mail-card-from">
        <span className="mail-card-glyph" aria-hidden="true">✉</span>
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
        <ul className="mail-card-artifacts">
          {/* Keyed by INDEX, not by path: nothing upstream forbids a sender
              listing the same path twice, and a duplicate key would drop a
              row from a list whose whole job is to be complete. The list is
              static per card, so the index is a stable key. */}
          {envelope.artifacts.map((p, i) => (
            <li className="mail-card-artifact" key={`${i}-${p}`}>{p}</li>
          ))}
        </ul>
      )}
      {envelope.body !== '' && <pre className="well mail-card-body">{envelope.body}</pre>}
    </article>
  );
}
