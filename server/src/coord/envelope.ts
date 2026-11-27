import { MAIL_ENVELOPE_FENCE, type MailKind } from '../../../shared/api.js';
import { INJECTED_PROMPTS } from '../../../shared/injected-prompts.mjs';
import { MAIL_INBOX_FENCE_INFO, parseMailEnvelope } from '../../../shared/api.js';
import { OPERATOR_MESSAGE_SENDER, isOperatorMessageMail, operatorMessageIdOf, operatorMessageNudgeLine } from '../../../shared/operatorMessages.js';
import { squash } from '../../../shared/whitespace.js';
import { SPOT_PROBE_SUBJECT } from '../continuity/renewalFeed.js';
import { isProviderRetryMail, renderProviderRetryLine } from '../../../shared/provider-retry.js';
import { OVERLORD_IDENTITY, type DesignationFact } from '../roleOf.js';
import { TIMER_MAIL_SENDER } from '../../../shared/continuity-timers.js';
import {
  isInboxWakeMail, readInboxWakeBody, renderInboxWakeLine, renderSpotProbeLine,
} from '../../../shared/overlordInbox.js';

export interface EnvelopeInput {
  /** The DELIVERY id (`mail_deliveries.id`), not the mail id (`mail.id`) —
   *  two separate `AUTOINCREMENT` sequences (`schema.ts`). This is what the
   *  rendered `ack:` line tells the recipient to POST to, and the ack route
   *  resolves its `:id` param against `mail_deliveries` (`coord.delivery(id)`,
   *  `routes.ts`) — so this field MUST be the id `queueDelivery` returned,
   *  never `mail.id` (fix-round finding 5 / D-41: the two sequences only
   *  happen to walk together while every mail resolves to exactly one
   *  delivery, and desynchronise permanently the first time it does not). */
  id: number; fromId: string; toId: string;
  runId: number | null; program: string | null; wave: number | null; waveOf: number | null;
  kind: MailKind; subject: string; body: string; artifacts: readonly string[];
}

/** A fence long enough that the body cannot close it. Markdown's own rule: a
 *  fenced block ends only on a fence AT LEAST as long as the opener, so one
 *  backtick more than the longest run inside is always safe. Three is the floor
 *  because a shorter fence is not a fence. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The text that gets typed into the recipient's input box.
 *
 * SELF-DESCRIBING BY REQUIREMENT (spec:173-177): the receiving agent must be
 * able to act on this with no tooling — it can see who sent it, which run it
 * belongs to, what the artifacts are, and exactly how to acknowledge it. There
 * is no client, no library and no MCP server on the other end; there is a
 * language model reading its own terminal.
 *
 * RENDERED ONCE, AT QUEUE TIME, AND STORED (`mail_deliveries.envelope`). A
 * replay is byte-identical because it is the same string, not because this
 * function is deterministic — which it is today and might not be after the next
 * edit. spec:176-177 says "verbatim, never re-rendered", and storing the bytes
 * is the only way to make that a property of the system rather than of
 * everyone's care.
 *
 * COST, stated because it is real: `sendPrompt` types one `tmux send-keys` per
 * line plus an `M-Enter` between lines (`inject/send.ts:304-309`), each an
 * agent round trip in remote mode. An 8KB body of short lines is a few hundred
 * round trips inside one KeyedQueue slot. That blocks ONLY this session — the
 * lane is `void`-dispatched and per-session — and it is the price of a message
 * an agent can read. Do not "optimise" it by shortening the body: the cap is
 * the spec's, the header is what makes it actionable.
 *
 * `MAIL_BODY_MAX_BYTES` ALONE DOES NOT BOUND THIS COST (fix-round finding 8 /
 * D-44): `subject` renders as ONE line above and `artifacts` renders ONE LINE
 * PER ENTRY, so an uncapped subject or artifact list could smuggle this cost
 * two orders of magnitude past "a few hundred" through a request that never
 * touches the body cap at all. The ingress caps both at check 4
 * (`MAIL_SUBJECT_MAX_BYTES`, `MAIL_ARTIFACTS_MAX`, `MAIL_ARTIFACT_PATH_MAX_BYTES`
 * — `shared/api.ts`), precisely so this paragraph's "a few hundred" stays the
 * true worst case rather than an aspiration nothing enforces.
 */
export function renderEnvelope(m: EnvelopeInput): string {
  const lines: string[] = [
    `id: ${m.id}`,
    `from: ${m.fromId}`,
    `to: ${m.toId}`,
  ];
  if (m.runId !== null) {
    const wave = m.wave === null ? '' : ` wave ${m.wave}${m.waveOf === null ? '' : `/${m.waveOf}`}`;
    lines.push(`run: ${m.runId}${m.program === null ? '' : ` (program:${m.program}${wave})`}`);
  } else if (m.program !== null) {
    // D-8077: a run-less system mail that names a programme (the run-close lane's warning) carries the slug in its envelope.
    lines.push(`program: ${m.program}`);
  }
  lines.push(`kind: ${m.kind}`, `subject: ${m.subject}`);
  if (m.artifacts.length > 0) {
    lines.push('artifacts:');
    for (const p of m.artifacts) lines.push(`  ${p}`);
  }
  lines.push(
    // The ack instruction the recipient actually reads. It names the CLIENT and
    // not a header, because the header — and the token behind it — stopped being
    // the reader's business: `ccrc-api` reads `~/.cc-secrets/ccrc-mail.token`
    // itself. A session on a repo that denies `Bash(curl:*)` could not follow the
    // old wording at all, which is the fault this whole slice exists to fix (D-738).
    // `${m.id}` is the DELIVERY id, which is what this route wants and what the
    // mail row's own id is NOT (two sequences that agree only for a single
    // recipient) — so it is spelled out rather than left to be inferred.
    `ack: ccrc-api mail ack ${m.id} --json -   (${m.id} is this DELIVERY id, not the`,
    '  mail row\'s own id) with body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.',
    '  Until you ack, this message is redelivered on later sweeps, up to a bounded number of',
    '  attempts — after that the lane gives up and marks it undeliverable. Ack it promptly.',
    '--',
  );
  const head = lines.join('\n');
  const fence = fenceFor(`${head}\n${m.body}`);
  // The info string comes from `shared/api.ts`, not a literal here (Build 4
  // Task 15): the same constant `parseMailEnvelope` reads the grammar back
  // with, so `parse(render(x)) === x` is a property of the system rather than
  // of two files happening to spell the same nine characters.
  return `${fence}${MAIL_ENVELOPE_FENCE}\n${head}\n${m.body}\n${fence}`;
}

/**
 * D-6778 (mail inbox, spec §3.4): one inbox entry, rendered from the STORED envelope, parsed back with
 * `parseMailEnvelope`, so it shows what was queued and keeps "rendered once, never re-rendered" for every field.
 * Only the `ack:` instruction is left out (the inbox acks for the reader), and the id shown is the DELIVERY id,
 * never the mail row's. An envelope that does not parse is printed verbatim, never dropped. Pure.
 *
 * The fence is `fenceFor`'s (longer than any backtick run inside), and its info string is `ccrc-inbox`, not
 * `MAIL_ENVELOPE_FENCE`, so `parseFetchedMailEnvelope` never mistakes an inbox print for one fetched envelope.
 */
export function renderInboxEntry(deliveryId: number, storedEnvelope: string): string {
  const p = parseMailEnvelope(storedEnvelope);
  if (!p.ok) return storedEnvelope;
  const e = p.envelope;
  const lines: string[] = [`delivery: ${deliveryId}`, `from: ${e.fromId}`, `to: ${e.toId}`, `kind: ${e.kind}`,
                           `subject: ${e.subject}`];
  if (e.runId !== null) {
    const wave = e.wave === null ? '' : ` wave ${e.wave}${e.waveOf === null ? '' : `/${e.waveOf}`}`;
    lines.push(`run: ${e.runId}${e.program === null ? '' : ` (program:${e.program}${wave})`}`);
  } else if (e.program !== null) {
    lines.push(`program: ${e.program}`);
  }
  if (e.artifacts.length > 0) {
    lines.push('artifacts:');
    for (const a of e.artifacts) lines.push(`  ${a}`);
  }
  lines.push('--');
  const head = lines.join('\n');
  const fence = fenceFor(`${head}\n${e.body}`);
  return `${fence}${MAIL_INBOX_FENCE_INFO}\n${head}\n${e.body}\n${fence}`;
}

/** D-6778 (spec §3.3 step 4): take entries in order while the running byte total fits `budget`, and always at
 *  least one, so one oversized entry still goes out. `remaining` is how many the budget left out. Pure. */
export function pageInbox<T extends { text: string }>(entries: readonly T[], budget: number): { page: T[]; remaining: number } {
  const page: T[] = [];
  let used = 0;
  for (const e of entries) {
    const n = Buffer.byteLength(e.text, 'utf8');
    if (page.length > 0 && used + n > budget) break;
    page.push(e);
    used += n;
  }
  return { page, remaining: entries.length - page.length };
}

/** The single-line reference the delivery lane types instead of the body.
 *  Fixed 24-char sentinel head so `sendPrompt`'s needle is CONSTANT across
 *  every delivery; the only variable part (toId) lands after the needle, so
 *  it can never split or wrap the needle. Deliberately ID-AGNOSTIC: it points
 *  at the LISTING endpoint, not one delivery, so one nudge drains all of a
 *  session's outstanding mail and re-injecting it is idempotent. The body,
 *  headers and ack instruction all live in the fetched envelope
 *  (`GET /api/mail/<deliveryId>`, `routes.ts`) — this line teaches the worker
 *  nothing the old typed lane didn't, it just tells it where to look instead
 *  of handing it the bytes.
 *
 *  MUST SAY `deliveryId`, NEVER BARE `id` (blocking finding, both review
 *  rounds / re-opened D-41): `GET /api/mail?to=` returns `MailSummary` rows
 *  carrying BOTH `id` (`mail.id`) and `deliveryId` (`mail_deliveries.id`) —
 *  two independent `AUTOINCREMENT` sequences (`schema.ts`) that only walk
 *  together while every mail resolves to exactly one delivery, and diverge
 *  permanently the moment one mail fans out to more than one recipient
 *  (`store.ts`'s own `MAIL_ROW_COLUMNS` comment). Both `GET /api/mail/:id`
 *  (`deliveryEnvelope`, `store.ts`) and `POST /api/mail/:id/ack`
 *  (`coord.delivery(id)`, `routes.ts`) key on the DELIVERY id. A nudge that
 *  told the worker to use the listing's bare `id` would send it to fetch and
 *  ack a DIFFERENT delivery (or 404) the instant that fan-out happens — the
 *  worker's own delivery would then replay forever, never acked. Naming
 *  `deliveryId` explicitly, and flagging it against `id` by name, is what
 *  keeps that failure from depending on the worker guessing correctly.
 *
 *  ONE LINE, NO `\n` — `composePrompt`'s `split('\n')` in `sendPrompt` then
 *  yields exactly one part, so the M-Enter loop that joins multi-line prompts
 *  never runs and there is nothing for the pane to wrap between rows. See
 *  `inject/send.ts`'s own `ECHO_NEEDLE`/`ECHO_NEEDLE`-sized head comment for
 *  why the constant 24-char prefix is what makes the echo/submit checks
 *  trivial regardless of terminal width.
 *
 *  SELF-SUFFICIENT BY INCIDENT (2026-08-25, a live worker): this line is the
 *  ONLY protocol text guaranteed CURRENT in the recipient's pane — a skill
 *  loaded into a session goes stale across deploys, and a peer-mail recipient
 *  may have no skill loaded at all. That property is why every gap in it has
 *  cost a live wedge, and it has now cost three.
 *
 *  The first two: the old line named the routes and the token PATH but not the
 *  server ADDRESS (a worker guessed a wrong host) nor the EXTRACTION rule (it
 *  `cat`ed the token file — a `#`-comment preamble above ONE value line — into
 *  the header, an illegal value that fails at the socket before any route runs).
 *
 *  The third, and the reason this now names a CLIENT instead of routes: the
 *  nudge told the reader to speak raw HTTP. A repo may legitimately deny
 *  `Bash(curl:*)` in its committed settings, and one does. Its worker received
 *  this nudge every ten minutes for hours and refused every one of them —
 *  correctly, because the only thing the nudge taught it was a command its repo
 *  forbids. The mail lane looked healthy from every angle: the delivery sat
 *  `delivered`, `GET /api/peers` reported the session `deliverable: yes`, and
 *  the run showed a tidy `unreadMail: 1`. Nothing anywhere said that the one
 *  wake-up call the design depends on had been silently refused hundreds of
 *  times. (The sibling `renderEnvelope` above was converted for this in D-738;
 *  THIS function was missed in the same change, which is the whole lesson —
 *  they are twelve lines apart and only one of them was searched for. D-791.)
 *
 *  So the nudge now names `ccrc-api`, by explicit path because `~/.local/bin`
 *  is not on the `claude-session@` unit PATH. That is strictly MORE
 *  self-sufficient, not less: the client resolves the address and reads the
 *  token itself, so the two teachings that used to be in this line — derive the
 *  base from `CCRC_SERVER_URL`, extract the token and never `cat` it — are now
 *  properties of the one binary rather than instructions a stale reader has to
 *  follow correctly. No token VALUE, no secret of any kind, ever belongs here.
 *
 *  The 24-char head stays byte-identical: `sendPrompt`'s echo needle is the
 *  first 24 characters, and the only variable part (toId) must land after it. */
export function renderMailNudge(toId: string): string {
  const api = '~/.local/bin/ccrc-api';
  return `${INJECTED_PROMPTS['mail-nudge'].text} Use the client, never curl or raw HTTP: ` +
    `${api} mail list --to ${toId} ; then per row use its deliveryId, NOT id: ` +
    `${api} mail fetch <deliveryId> and ${api} mail ack <deliveryId> --json - ` +
    `with body {"fromId":"${toId}","fromUuid":"<your uuid>"}. ` +
    `Invoke by that exact path — ~/.local/bin is not on this unit's PATH. ` +
    `The client resolves the server address and reads the box token itself, so you ` +
    `handle neither, and it works in a repo whose settings deny curl.`;
}

/** The operator-message nudge (open question 3, slug `message-nudge-rides-the-mail-lane`): the mail nudge's generic head, so
 *  `sendPrompt`'s 24-character echo needle and the injected-prompt census are unchanged, then the message's id and its door.
 *  One line, no `ccrc-api` and no mail-client words: the Overlord reads the message through its `messages` door, and the words
 *  themselves are never typed. */
export function renderOperatorMessageNudge(id: number): string {
  // The line's grammar is L0's (`operatorMessageNudgeLine`), so the chat's recogniser reads back exactly what is typed.
  return operatorMessageNudgeLine(id);
}

/** One kind of mail the lane types a fixed line for (Overlord W1, inbox piece, question 8): the ONE table the mail lane reads, so
 *  a further kind is a row, never a parallel mechanism. `matches` names the mail; `designatedOnly` says the row types its line only
 *  to the designated session (any other recipient keeps the generic nudge); `line` is typed with the resume rule of
 *  `resumeRuleOf`, from the mail and the mail pass's clock (read once at the pass's start, so at most one pass before typing); `firstDelivery` is what the first delivery moves besides the delivery's
 *  ack: the operator message's `delivered`, or nothing. `draft` says what a person's unsent text does to the send: absent, it is
 *  stashed and given back (D-5912); `refuse` types nothing while it stands (D-9090). */
export interface FixedLineMailRow {
  readonly name: 'operator-message' | 'spot-probe' | 'inbox-wake' | 'provider-retry' | 'timer';
  /** `mailToId` is the MAIL ROW's recipient (a role's word, kept on the row), never the delivery's session (Overlord W1). */
  readonly matches: (m: { readonly fromId: string; readonly subject: string; readonly mailToId?: string }) => boolean;
  readonly designatedOnly: boolean;
  readonly line: (m: { readonly subject: string; readonly body: string }, now: number) => string;
  readonly firstDelivery: 'message-delivered' | 'none';
  /** True when the row's delivery waits until the designated session's live generation has read its card (C62; the timer row
   *  only): while it holds, nothing is typed and no attempt is spent. */
  readonly waitsForCard: boolean;
  readonly draft?: 'refuse';
}
export const FIXED_LINE_MAIL: readonly FixedLineMailRow[] = [
  // Only the designated session is ever sent an operator message, so its row needs no designation.
  { name: 'operator-message', matches: isOperatorMessageMail, designatedOnly: false, firstDelivery: 'message-delivered', waitsForCard: false,
    line: (m) => renderOperatorMessageNudge(operatorMessageIdOf(m.subject)!) },
  // The renewal act's spot-probe notice names `ccrc-api probe`, which the Overlord cannot run; a coordinator keeps the notice's own text.
  { name: 'spot-probe', matches: (m) => m.fromId === OPERATOR_MESSAGE_SENDER && m.subject === SPOT_PROBE_SUBJECT, designatedOnly: true, firstDelivery: 'none',
    line: () => renderSpotProbeLine(), waitsForCard: false },
  // The time left is read at the mail pass's clock, taken once at the pass's start (at most one pass before typing), never at queueing.
  { name: 'inbox-wake', matches: isInboxWakeMail, designatedOnly: true, firstDelivery: 'none', waitsForCard: false,
    line: (m, now) => renderInboxWakeLine(readInboxWakeBody(m.body), now) },
  // A session whose turn ended on a provider error (`providerRetry.ts`): the line says it all and is acked as typed, so no replay
  // stands beside the ladder's own repeat. A person writing in that box is about to continue the session themselves.
  { name: 'provider-retry', matches: isProviderRetryMail, designatedOnly: false, firstDelivery: 'none', draft: 'refuse', waitsForCard: false,
    line: () => renderProviderRetryLine() },
  // The Overlord's timers (W1): the timer lane's mail to the role, matched on the MAIL ROW's recipient, so a session-keyed
  // timer mail keeps the generic nudge. The Overlord has no mail verb: the line names its timer list door, and waits for the card.
  { name: 'timer', matches: (m) => m.fromId === TIMER_MAIL_SENDER && m.mailToId === OVERLORD_IDENTITY, designatedOnly: true,
    firstDelivery: 'none', waitsForCard: true, line: (m) => renderTimerFiredLine(m.subject) },
];

/** The fixed line of the role's timer mail (Overlord W1, question 3): the mail nudge's head, then how many timers came due,
 *  read from the subject's `timer: <n> due` (an unreadable subject types the line without the count), and the door that reads
 *  them. No `ccrc-api`, no mail verb, and no part of a note. */
export function renderTimerFiredLine(subject: string): string {
  const n = /^timer: ([1-9][0-9]*) due/.exec(subject)?.[1];
  return `${INJECTED_PROMPTS['mail-nudge'].text} ${n === undefined ? 'Your timers' : `${n} of your timers`} came due: read them with your timer list door.`;
}


/** The designation as the mail sweep read it once for its pass. */
export type SweepDesignation = { readonly kind: 'designated'; readonly sessionId: string } | { readonly kind: 'not-designated' } | { readonly kind: 'unmeasured' };

/** The sweep's designation read (`DesignationEpisode.observe`'s answer) as the table takes it: the live bound session, none, or unmeasured. */
export function sweepDesignationOf(d: DesignationFact | 'unmeasured'): SweepDesignation {
  if (d === 'unmeasured') return { kind: 'unmeasured' };
  return d.kind === 'row' && d.live !== null ? { kind: 'designated', sessionId: d.live } : { kind: 'not-designated' };
}

/** The table's row for a mail, or 'generic'. A `designatedOnly` row answers only for a mail to the designated session, and
 *  never under an `unmeasured` designation. */
export function fixedLineMailOf(
  m: { readonly fromId: string; readonly subject: string; readonly toId: string; readonly mailToId?: string }, designated: SweepDesignation,
): FixedLineMailRow | 'generic' {
  const row = FIXED_LINE_MAIL.find((r) => r.matches(m));
  if (row === undefined) return 'generic';
  if (row.designatedOnly && !(designated.kind === 'designated' && designated.sessionId === m.toId)) return 'generic';
  return row;
}

/** What the mail lane types for one due delivery, and what its first delivery moves. `firstDelivery` is set only for a fixed line whose
 *  first delivery moves nothing but the ack (a spot-probe notice, the wake); an operator message names its id instead. */
export interface MailNudge {
  readonly line: string;
  readonly operatorMessageId: number | null;
  readonly firstDelivery?: 'none';
  /** Set for a row that waits for the designated session's card (the timer row): the lane asks `cardHoldVerdict` first. */
  readonly waitsForCard?: true;
  readonly draft?: 'refuse';
}

/** The line the mail lane types for one due delivery. A mail the table names types its own fixed line; every other mail types the
 *  id-agnostic `renderMailNudge`. `operatorMessageId` is set exactly for an operator message, for the lane's move on the private
 *  store. `designated` is the sweep's one designation read (default: none designated) and `now` the mail pass's clock, read once at its start. Pure: it
 *  decides nothing about delivery. */
export function mailNudgeOf(
  toId: string, origin: { readonly fromId: string; readonly subject: string; readonly body?: string; readonly toId?: string } | null,
  designated: SweepDesignation = { kind: 'not-designated' }, now = 0,
): MailNudge {
  // `toId` is the delivery's session; the origin's `toId` is the mail row's recipient, which the table matches as `mailToId`.
  const row = origin === null ? 'generic' : fixedLineMailOf({ fromId: origin.fromId, subject: origin.subject, mailToId: origin.toId, toId }, designated);
  if (origin === null || row === 'generic') return { line: renderMailNudge(toId), operatorMessageId: null };
  const line = row.line({ subject: origin.subject, body: origin.body ?? '' }, now);
  return row.firstDelivery === 'message-delivered' ? { line, operatorMessageId: operatorMessageIdOf(origin.subject) }
    : { line, operatorMessageId: null, firstDelivery: row.firstDelivery, ...(row.draft === undefined ? {} : { draft: row.draft }),
      ...(row.waitsForCard ? { waitsForCard: true as const } : {}) };
}

/** One due delivery of a fixed line whose first delivery moves nothing but the ack (`firstDelivery: 'none'`), already delivered
 *  once: the line was typed and its ack did not land (the process stopped between `markDelivered` and the ack, review 3389 F1). Its
 *  replay finishes the ack and types nothing, so the recipient is never told twice. Every other delivery is typed as before. */
const FIXED_LINE_REPLAY_MAP = {
  'ack-only': 'the line was typed once and its ack never landed: ack it and type nothing',
  type: 'type the line',
} as const;
export type FixedLineReplay = keyof typeof FIXED_LINE_REPLAY_MAP;
export const FIXED_LINE_REPLAYS = Object.keys(FIXED_LINE_REPLAY_MAP) as FixedLineReplay[];
export function fixedLineReplayOf(nudge: Pick<MailNudge, 'firstDelivery'>, deliveredAt: number | null): FixedLineReplay {
  return nudge.firstDelivery === 'none' && deliveredAt !== null ? 'ack-only' : 'type';
}

/** `sendPrompt`'s resume rule for a nudge, given what the box holds now (`null`: unread). The generic nudge is id-agnostic, so any
 *  leftover nudge may be resumed (`true`, the prefix mode). An operator message's line names its id, so only THIS delivery's own
 *  line may be: `'whole'` presses Enter on a box that renders exactly the line and NEVER types (an empty box is
 *  `nothing-to-submit`), so it is passed only when the box already holds the line, and otherwise no resume is asked: the line
 *  is typed into an empty box, and any other text, another message's line included, is a draft (slug `whole-mode-never-types`).
 *  This holds for every fixed line of the table (a wake's and a spot-probe notice's too), each compared to its OWN line, typed
 *  with the time left at the mail pass's clock. The box is compared up to whitespace (`squash`, as `sendPrompt`'s own wrap-tolerant comparison does), so a pane narrower than the
 *  line, which wraps it, still reads as the line (review 2550 F4). A row with `draft: 'refuse'` adds `onDraft: 'refuse'`, which the
 *  lane spreads over its own `stash` (D-9090). */
export function resumeRuleOf(nudge: MailNudge, box: string | null):
  { readonly resumeIfOwn: true } | { readonly resumeIfOwn?: 'whole'; readonly onDraft?: 'refuse' } {
  if (nudge.operatorMessageId === null && nudge.firstDelivery === undefined) return { resumeIfOwn: true };
  return { ...(box !== null && squash(box) === squash(nudge.line) ? { resumeIfOwn: 'whole' as const } : {}),
    ...(nudge.draft === undefined ? {} : { onDraft: nudge.draft }) };
}
