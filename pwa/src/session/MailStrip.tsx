// Outstanding mail for THIS session, in the TaskStrip idiom: collapsed to one
// headline by default, expanding to rows, and rendering nothing at all when
// there is none — an ordinary conversation must not pay a row for a feature it
// is not using.
//
// It sits ABOVE TaskStrip, which keeps the composer's immediate neighbour: the
// TUI puts the plan directly above the prompt and TaskStrip's own comment
// defends that placement. Mail is ambient state about the session, so it stacks
// on top of the plan rather than displacing it.
//
// NO transcript arm. A mail ChatItem is Build 4's, by the spec — one build owns
// the conversation model — and the local-divider shortcut is refused twice
// over: stores/session.ts:121-124 keeps dividers across a backlog only when
// every event in the store is already one, so a thread rendered that way
// disappears on the next reconnect.
//
// Built against `MailSummary`, not the `MailItem` the plan this file came from
// assumed: PR I shipped no `body` and no `rejectCode` on the wire (see
// stores/session.ts's own `mail` frame comment) — every row here is
// necessarily sender/kind/subject/artifacts only.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MailSummary } from '../../../shared/api';
import './chat.css';

const PLURAL: Record<MailSummary['kind'], [string, string]> = {
  finding: ['finding', 'findings'], question: ['question', 'questions'],
  answer: ['answer', 'answers'], status: ['status', 'statuses'],
  artifact: ['artifact', 'artifacts'], unknown: ['message', 'messages'],
};

/** "1 question · 2 findings" — the counts that matter, zero-count clauses
 *  dropped rather than printed as "0". `summarize`'s rule, one file over. */
export function summarizeMail(mail: readonly MailSummary[]): string {
  const parts: string[] = [];
  for (const kind of Object.keys(PLURAL) as MailSummary['kind'][]) {
    const n = mail.filter((x) => x.kind === kind).length;
    if (n > 0) parts.push(`${n} ${PLURAL[kind][n === 1 ? 0 : 1]}`);
  }
  return parts.join(' · ');
}

export function MailStrip({ mail }: { mail: MailSummary[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (mail.length === 0) return null;

  const newest = [...mail].sort((a, b) => b.at - a.at)[0]!;

  return (
    <section className={open ? 'mail-strip mail-strip--open' : 'mail-strip'} aria-label="Mail">
      <button type="button" className="mail-strip-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mail-strip-mark" aria-hidden="true">✉</span>
        <span className="mail-strip-headline">{newest.subject}</span>
        <span className="mail-strip-count">{mail.length}</span>
        <span className="mail-strip-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      <p className="mail-strip-summary">{summarizeMail(mail)}</p>

      {open && (
        <ol className="mail-strip-rows">
          {mail.map((item) => (
            <li key={item.id} className="mail-strip-row">
              <span className="mail-strip-from">{item.fromId}</span>
              <span className="mail-strip-kind">{item.kind}</span>
              <span className="mail-strip-subject">{item.subject}</span>
              {/* Artifacts are PATHS, never payloads (spec §1) — so they render
                  as paths, in the machine's voice, and nothing here fetches
                  one. */}
              {item.artifacts.length > 0 && (
                <ul className="mail-strip-artifacts">
                  {item.artifacts.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
