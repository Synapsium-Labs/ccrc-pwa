import type { MailKind } from '../../../shared/api.js';

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
    `ack: POST /api/mail/${m.id}/ack with header x-ccrc-mail-token (the value in`,
    '  ~/.cc-secrets/ccrc-mail.token) and body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.',
    '  Until you ack, this message will be delivered to you again.',
    '--',
  );
  const head = lines.join('\n');
  const fence = fenceFor(`${head}\n${m.body}`);
  return `${fence}ccrc-mail\n${head}\n${m.body}\n${fence}`;
}
