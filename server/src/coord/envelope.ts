import { MAIL_ENVELOPE_FENCE, type MailKind } from '../../../shared/api.js';

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
 * line plus an `M-Enter` between lines (`inject/send.ts:300-305`), each an
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
  return `ccrc-mail: you have new mail. Use the client, never curl or raw HTTP: ` +
    `${api} mail list --to ${toId} ; then per row use its deliveryId, NOT id: ` +
    `${api} mail fetch <deliveryId> and ${api} mail ack <deliveryId> --json - ` +
    `with body {"fromId":"${toId}","fromUuid":"<your uuid>"}. ` +
    `Invoke by that exact path — ~/.local/bin is not on this unit's PATH. ` +
    `The client resolves the server address and reads the box token itself, so you ` +
    `handle neither, and it works in a repo whose settings deny curl.`;
}
