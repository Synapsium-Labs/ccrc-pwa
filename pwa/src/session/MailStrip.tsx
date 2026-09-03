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
  TERMINAL_DELIVERY_STATES,
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
  // The sharper half of the same measurement (D-309 refined): `tmux-gone` is
  // "the pane is missing, it may come back"; this is "the registry proves it is
  // not coming back". An operator acts on them completely differently — wait,
  // versus go and look at why a message is addressed to a session somebody
  // archived — which is the whole argument for splitting the rung.
  // NOT "it was stopped or archived": this one gate covers `stopped`, `orphan`
  // AND `never-started`, and the latter two were never stopped and never
  // archived. Naming a cause that did not happen is the same class of small
  // lie the rest of this table exists to avoid, so the phrase states the
  // CONSEQUENCE — which is true of all three — and leaves the cause to the
  // row's own `lastError`, which carries the exact lifecycle word.
  'session-dead': 'the session is gone for good — nothing will bring it back on its own',
  'tmux-unknown': 'tmux could not be asked',
  'pending-ask': 'the session is waiting on a prompt of its own',
  'no-pane': 'the session has no pane',
  'no-config-dir': 'this wrapper resolves to no config dir',
  // "busy" IS the right word here even though the gate folds a genuine busy
  // status together with a live-state read that answered nothing, and the
  // decision is recorded rather than left to be re-litigated. Three of the four
  // conditions `readLiveState` folds are MEASUREMENTS by `livestate.ts`'s own
  // ledger ("the reader looked at the file, or proved there is none"), not
  // failed reads; and for the fourth, D-115 installed `busy` as the fail-shut
  // word for an unmeasured live read at BOTH sibling seams — the fleet card
  // (fleet.ts) and the chat header directly above this strip (sessionws.ts),
  // the latter saying explicitly that the two are "two renderings of one
  // measurement". A third rendering of that same measurement disagreeing with
  // them would be worse than the imprecision it fixed.
  'not-idle': 'the session is busy',
  // NOT "has only just gone quiet", which is what this said first and which
  // contradicts the duration printed beside it. The gate is
  // `statusUpdatedAt === null || now - statusUpdatedAt < MAIL_QUIET_MS`, and
  // the second arm resolves itself inside a minute BY CONSTRUCTION — so it can
  // essentially never survive to `MAIL_GATE_HELD_MS`. The arm that does reach
  // this line is the first one, which never resolves on its own at all, and
  // "held 3h 12m · the session has only just gone quiet" was measured. The
  // phrase now covers both arms and points at the one an operator can act on.
  'not-quiet': 'the session has no usable quiet-time stamp',
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
 * recognise revives as, keeps its gate line instead of losing it. It reads
 * those two words from `TERMINAL_DELIVERY_STATES` rather than respelling them:
 * this file held a copy of that pair, and the server's own guards are built
 * from the same list, so a member added there can never again mean one thing to
 * the lane and another to the strip. The server clears all four columns on
 * send, ack and reject, but a client must not depend on a server having done
 * that, and the row's terminal arm outranks this one anyway (there is one
 * status line per row, by design).
 *
 * Returns `null`, not a flag: the caller needs the gate AND the span, and
 * computing the span twice is how the headline and the row come to disagree.
 */
export function heldGate(item: MailSummary, now: number): { gate: string; forMs: number } | null {
  if ((TERMINAL_DELIVERY_STATES as readonly string[]).includes(item.state)) return null;
  // `== null`, NOT `=== null`, and the difference is the entire absence-permits
  // rule in one operator. A server that predates these columns omits them, so
  // they arrive `undefined` — and `undefined === null` is false, so the first
  // cut of this function walked straight past this line. What followed was
  // worse than a crash: `undefined < 3` is false, `now - undefined` is NaN,
  // and NaN is false for BOTH `<` and `>`, so every remaining guard PASSED and
  // the row rendered `held moments · undefined` on a fleet where nothing at
  // all was wrong. Reproduced before this line was written, and pinned below.
  if (item.lastGate == null || item.gateSince == null || item.gateAt == null) return null;
  // `gateCount` is NOT in the line above, and cannot be: it is typed `number`
  // rather than `number | null`, so there is no null to compare against — and
  // an absent one therefore arrives here as `undefined` having passed every
  // check so far. `undefined < 3` is FALSE, which passes the guard; `!(undefined
  // >= 3)` is TRUE, which stops it. Same fact, opposite failure, and only one
  // of them is safe for a console whose whole purpose is not lying. Measured:
  // spelling this `item.gateCount < MAIL_GATE_HELD_COUNT` reds the absent-field
  // test below.
  if (!(item.gateCount >= MAIL_GATE_HELD_COUNT)) return null;
  // The remaining two are the ORDINARY spelling, deliberately, and this comment
  // is here to stop a future reader "fixing" them to match the line above. By
  // this point `gateAt` and `gateSince` have both survived `== null`, so
  // neither subtraction can be NaN and there is no unsafe direction left to
  // guard against. Inverting them was measured and changed nothing — a guard
  // no test can red is a comment wearing a mechanism's clothes, which is the
  // one thing this repo asks a guard not to be.
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
 * THE ORDER IS THE CLAIM, and `held` sits ABOVE `blocked` — which is the
 * opposite of where it started, and the reason is a timestamp.
 *
 * `lastError` has no clock. NOTHING clears it: `markDelivered` clears the four
 * gate columns and leaves it (store.ts), `noteGate` touches neither it nor
 * `attempts`. So a `queued` row that once failed a send with `draft-present`
 * carries that token for ever — and if the ladder afterwards starts returning
 * at `tmux-gone`, `no-pane` or `no-config-dir`, gates that return BEFORE any
 * send is attempted, nothing ever writes it again.
 *
 * `gateAt` does have a clock, and `heldGate` has already required it to be
 * recent. That is the whole argument: the ladder runs BEFORE the send, so a
 * FRESH gate is positive evidence that no send was attempted this sweep, which
 * makes `lastError` stale by at least one sweep by construction. Between an
 * undated fact and a dated one that proves the undated fact is old, the dated
 * one wins.
 *
 * What the old order actually printed, measured end-to-end from a real sweep:
 * a row with `attempts: 1, lastError: 'draft-present'` left over from hours ago
 * and a fresh `tmux-gone` rendered "blocked · attempt 1 of 6 — this session's
 * input box has unsent text", titled "The lane is still retrying. Clear this
 * session's input box and it will land." Every clause false. There is no pane,
 * so there is no input box to clear; nothing is being retried, because the
 * ladder returns before the send; and `attempts` is frozen at 1, so "of 6"
 * describes a countdown that will never move. Meanwhile the one fact that
 * would have told the operator the session was gone was the fact this
 * precedence suppressed.
 *
 * `abandoned` stays first: `rejected` is terminal and outranks any reading of
 * a row that is still in play. One line per row, one place that decides which.
 */
type StatusArm = 'abandoned' | 'blocked' | 'held' | null;

function statusArm(item: MailSummary, held: { gate: string; forMs: number } | null): StatusArm {
  if (item.state === 'rejected') return 'abandoned';
  if (held !== null) return 'held';
  return isBlocked(item) ? 'blocked' : null;
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
          <span
            className="mail-strip-held-mark"
            title={heldCount === 1
              ? 'One gate has been holding a message for a while. Open the strip for which, and how long.'
              : `${heldCount} messages are each being held at a gate. Open the strip for which, and how long.`}
          >
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
