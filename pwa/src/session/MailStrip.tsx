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
import type { MailGate, MailSummary } from '../../../shared/api';
import {
  MAIL_MAX_ATTEMPTS, MAIL_GATE_HELD_MS, MAIL_GATE_HELD_COUNT, MAIL_GATE_FRESH_MS,
} from '../../../shared/api';
import { useNow } from '../lib/useNow';
import { elapsedWords } from '../lib/elapsed';
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

/**
 * A delivery the lane is actively failing to hand over because the box already
 * holds something. RAW `lastError`, branched on the ONE literal token the
 * server writes for this case — never a total `Record` lookup, which is a fresh
 * way for a new server value to break an old client, and never a display of the
 * raw string, which is free text (four writers, one of them an English
 * sentence). Both halves of that rule are scanned for in mail-strip.test.tsx.
 *
 * `state === 'queued'` is load-bearing and not belt-and-braces: a `rejected`
 * row keeps its last `lastError`, so without it a parked delivery would answer
 * to both this and the abandoned line.
 */
const isBlocked = (item: MailSummary): boolean =>
  item.state === 'queued' && item.lastError === 'draft-present';

/** "attempt 3 of 6" — the ceiling comes from L0, not from a `6` typed here.
 *  Naming the ceiling is what makes "visible BEFORE it is lost" true: without
 *  it the operator cannot tell a first hiccup from the last attempt.
 *
 *  "this session's input box", not the spec's sender-side "the recipient's":
 *  this strip renders mail addressed TO the session whose screen this is, so
 *  the recipient IS this session. It names the box by WHOSE it is and points
 *  at nothing, and both hover titles say the same (review, W4c finding 3 —
 *  they used to say "the input box below"). The box holding the unsent text is
 *  the one `sendPrompt` types into and reads `draft-present` back from; the
 *  control below this strip is the PWA composer, a different box, and an empty
 *  one. Pointing down sends the operator to look at the wrong thing. */
const blockedLine = (item: MailSummary): string =>
  `blocked · attempt ${item.attempts} of ${MAIL_MAX_ATTEMPTS} — this session's input box has unsent text`;

/**
 * D-792 — the words for each gate, and THE OPPOSITE RULE TO `lastError` ABOVE.
 *
 * `lastGate` is a CLOSED union on the wire, so a total `Record<MailGate, …>` is
 * not merely allowed here, it is the point: a member added to `MailGate` with
 * no phrase is a TS2739 at this table rather than a blank in the console. That
 * is exactly what `lastError`'s own docstring forbids for itself, forty lines
 * up, and the two fields sit adjacent in one interface — so the difference is
 * stated at both ends rather than left for a reader to infer from one.
 *
 * The phrases are the OPERATOR'S question, not the ladder's spelling: what
 * they would do about it. "the session is busy" and "the pane is gone" are
 * acted on completely differently, which is the whole argument for splitting
 * `no-pane` from `no-config-dir` in the first place.
 */
const GATE_PHRASE: Record<MailGate, string> = {
  'same-sweep': 'another message went first this sweep',
  'in-flight': 'an earlier message to this session is still landing',
  cooldown: 'the lane is spacing messages out',
  'registry-absent': 'this session is not in the registry',
  'registry-unmeasurable': 'the registry could not be read',
  'tmux-gone': 'the tmux session is gone',
  'tmux-unknown': 'tmux could not be asked',
  'pending-ask': 'the session is waiting on a prompt of its own',
  'no-pane': 'the session has no pane',
  'no-config-dir': 'this wrapper resolves to no config dir',
  'not-idle': 'the session is busy',
  'not-quiet': 'the session has only just gone quiet',
};

/** An UNKNOWN member renders the raw token rather than `undefined` — an older
 *  client against a newer server is an ordinary state on this fleet (the wire
 *  is additive and absence-permits), and a blank where a reason belongs is the
 *  silence this whole deviation was written against. */
const gatePhrase = (gate: string): string =>
  (GATE_PHRASE as Record<string, string | undefined>)[gate] ?? gate;

/**
 * Is ONE gate holding this delivery long enough to be worth saying out loud?
 *
 * All three thresholds, and every one of them earns its place: `gateSince` is
 * how long (a busy worker is not a fault), `gateCount` is that it is a pattern
 * rather than one observation, and `gateAt` is that the SWEEP IS STILL RUNNING
 * — a lane that stopped leaves an ageing `gateSince` that looks identical to
 * one still being refused, and saying "held for 3h" about a sweep that died
 * two hours ago is a new lie in place of the old silence.
 *
 * The state test is an EXCLUSION of the two terminal words, not an allow-list
 * of the live ones — so `unknown`, which is what a state this client does not
 * recognise revives as, keeps its gate line instead of losing it. The server
 * clears all four columns on send, ack and reject, but a client must not
 * depend on a server having done that, and the row's terminal arm outranks
 * this one anyway (there is one status line per row, by design).
 *
 * Returns `null`, not a flag: the caller needs the gate AND the span, and
 * computing the span twice is how the headline and the row come to disagree.
 */
export function heldGate(item: MailSummary, now: number): { gate: string; forMs: number } | null {
  if (item.state === 'acked' || item.state === 'rejected') return null;
  if (item.lastGate === null || item.gateSince === null || item.gateAt === null) return null;
  if (item.gateCount < MAIL_GATE_HELD_COUNT) return null;
  if (now - item.gateAt > MAIL_GATE_FRESH_MS) return null;
  const forMs = now - item.gateSince;
  return forMs < MAIL_GATE_HELD_MS ? null : { gate: item.lastGate, forMs };
}

/** "held 3h 12m · the session is busy" — a DESCRIPTION, deliberately, with no
 *  word in it that calls the state a failure. The operator decides that; three
 *  hours at `not-idle` on a session running a long suite is fine and three
 *  hours at `no-pane` is not, and the console cannot tell them apart. */
const heldLine = (h: { gate: string; forMs: number }): string =>
  `held ${elapsedWords(h.forMs)} · ${gatePhrase(h.gate)}`;

/**
 * WHICH of the three status lines this row gets — computed ONCE, because the
 * collapsed head and the expanded row both need the answer and the first
 * version of this file let them disagree: the head counted every row a gate
 * was holding, including rows whose own line said `blocked` instead, so
 * "held 1" opened onto a strip with no held line in it. Caught by the
 * precedence test below rather than in review, which is the argument for the
 * function existing at all.
 *
 * The ORDER is the claim, and it is the ternary's order because it is the same
 * decision: a terminal delivery has a fate and says it; a blocked one is still
 * being retried and says how much room is left; only a row with neither is
 * merely being held. One line per row, one place that decides which.
 */
type StatusArm = 'abandoned' | 'blocked' | 'held' | null;

function statusArm(item: MailSummary, held: { gate: string; forMs: number } | null): StatusArm {
  if (item.state === 'rejected') return 'abandoned';
  if (isBlocked(item)) return 'blocked';
  return held === null ? null : 'held';
}

/** `now` is injectable for the same reason `heldGate` takes it rather than
 *  reading the clock: three thresholds compared against `Date.now()` are not
 *  testable at a fixed epoch otherwise. The hook is called UNCONDITIONALLY and
 *  overridden after — a hook behind a `??` would be a hook behind a condition,
 *  which React forbids and which no test would catch until the prop was used. */
export function MailStrip({ mail, now: nowProp }: { mail: MailSummary[]; now?: number }): ReactNode {
  const [open, setOpen] = useState(false);
  // 30s, matching FleetHostBanner: the coarsest span `elapsedWords` prints is
  // a minute, so a faster tick would re-render without ever changing a word.
  const tick = useNow(30_000);
  const now = nowProp ?? tick;
  if (mail.length === 0) return null;

  const newest = [...mail].sort((a, b) => b.at - a.at)[0]!;
  const held = mail.map((item) => heldGate(item, now));
  const arm = mail.map((item, i) => statusArm(item, held[i]!));
  const heldCount = arm.filter((a) => a === 'held').length;

  return (
    <section className={open ? 'mail-strip mail-strip--open' : 'mail-strip'} aria-label="Mail">
      <button type="button" className="mail-strip-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mail-strip-mark" aria-hidden="true">✉</span>
        <span className="mail-strip-headline">{newest.subject}</span>
        <span className="mail-strip-count">{mail.length}</span>
        {/* THE STRIP OPENS CLOSED, so a flag that only exists in the expanded
            rows is invisible in the state the operator is actually in. */}
        {mail.some(isBlocked) && (
          <span className="mail-strip-blocked-mark" title="A message can't be delivered — this session's input box has unsent text.">
            blocked
          </span>
        )}
        {/* Same argument as the blocked mark directly above, for the same
            reason: the strip OPENS CLOSED, so a gate named only in an
            expanded row is invisible in the state the operator is in. It is a
            COUNT and not a reason — the reason is per-row and there may be
            more than one, and picking one to promote would be the console
            choosing which of two true things to say. */}
        {heldCount > 0 && (
          <span className="mail-strip-held-mark" title="One gate has been holding a message for a while. Open the strip for which, and how long.">
            held {heldCount}
          </span>
        )}
        <span className="mail-strip-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      <p className="mail-strip-summary">{summarizeMail(mail)}</p>

      {open && (
        <ol className="mail-strip-rows">
          {mail.map((item, i) => (
            <li key={item.id} className="mail-strip-row" data-state={item.state}>
              <span className="mail-strip-from">{item.fromId}</span>
              <span className="mail-strip-kind">{item.kind}</span>
              <span className="mail-strip-subject">{item.subject}</span>
              {/* Review finding 2: `outstandingMailFor` now also carries a
                  delivery the lane gave up retrying past its own replay
                  ceiling, never acked, never acted on — a distinct
                  `state:'rejected'` row that must not read as an ordinary
                  pending message, or a coordinator would keep waiting for a
                  reply the lane has already stopped attempting to deliver.

                  ONE status line per row, written as a ternary rather than two
                  independent guards: a rejected delivery is terminal and says
                  so, a queued-but-blocked one is still being retried and says
                  how much room is left. Rendering both would state two
                  different fates for one message. */}
              {/* ONE status line per row, and `statusArm` — not this JSX — is
                  where the precedence lives, so the head's count and the row's
                  line cannot drift apart. Reading the arm here rather than
                  re-deciding it is the whole point. */}
              {arm[i] === 'abandoned' ? (
                <span className="mail-strip-abandoned" title="The delivery lane gave up retrying this before it was acked.">
                  undeliverable — act on it directly
                </span>
              ) : arm[i] === 'blocked' ? (
                <span className="mail-strip-blocked" title="The lane is still retrying. Clear this session's input box and it will land.">
                  {blockedLine(item)}
                </span>
              ) : arm[i] === 'held' ? (
                <span className="mail-strip-held" title="Nothing has failed. The delivery lane keeps re-offering this message and one gate keeps declining it.">
                  {heldLine(held[i]!)}
                </span>
              ) : null}
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
